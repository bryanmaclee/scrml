/**
 * g-emit-lift-markup-text-interp.browser.test.js
 *
 * Regression gate for change-id `ss20-emit-lift-markup-text-interp-2026-06-25`
 * (sPA ss20 items 4 + 5).
 *
 * BUG (shared root, items 4 + 5): emit-lift's `emitCreateElementFromMarkup`
 * TEXT-child branch rendered a markup text child's `${...}` interpolation
 * LITERALLY (`appendChild(document.createTextNode("Saved ${@cell}"))`) for the
 * non-each callers whose UPSTREAM parser does NOT pre-split text from interp.
 *
 * Empirically the live reproducer for that branch is the TOP-LEVEL emit-expr
 * "markup-value" salvage path (`parseExprWithMarkupValues` → `markup-value`
 * ExprNode → `emitMarkupValueExpr` IIFE) — a ternary markup arm / bare
 * markup-value-in-expression. The const-derived (`const <x> = <span>${@n}</span>`),
 * fn-return (`fn f() -> markup { return <span>${@n}</span> }`), and the in-arm
 * extraction paths all SPLIT text from interp upstream, so the literal branch
 * never saw a `${}`-bearing text child and those render correctly pre-fix.
 *
 * Item 5 (the ternary instance) is the SAME root as item 4 — closing the
 * text-child branch closes both. There is exactly ONE fix.
 *
 * FIX (emit-lift.js text-child branch): when a markup TEXT child's value carries
 * an un-split `${...}` (compact `${}`, tokenizer-spaced `$ { }`, or the `$$`
 * escape), parse it via `parseLiftContentParts` and lower each segment exactly
 * the way the sibling logic-block bare-expr branch + interpolated-attr path do:
 * a static text node for literal segments + `createTextNode(String((expr) ?? ""))`
 * for each `${...}`, routed through `emitExprField`. The interpolation is REACTIVE
 * because the enclosing display/derived `_scrml_effect` re-evaluates the whole
 * markup-value IIFE on cell change. The reconcile-ctx (each live-keying) +
 * request-state seams are honoured for defence-in-depth. Genuinely-static text
 * (no `${}`) keeps the byte-identical literal append.
 *
 * Compile-clean is NOT enough (S140/S152): this test loads the emitted client.js
 * AS-IS in real module-init order and asserts the rendered DOM shows the cell
 * VALUE (and updates on cell change), NOT the literal `${@cell}` string. Pre-fix
 * the value assertions FAIL (DOM shows the raw interpolation source).
 *
 * Models: g-bindvalue-wiring-dropped-in-match-arm.browser.test.js (harness).
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

// --- item 4 + 5: top-level ternary markup-value with a `${@cell}` TEXT child. ---
const TERNARY_SRC = `<program>
\${
    <cell> = "hello"
    <show> = true
}
<div id="host">\${ @show ? <span>Saved \${@cell}</span> : "" }</div>
</program>
`;

// --- adversarial (S215): multiple `${}` in one text node + nested object field. ---
const ADVERSARIAL_SRC = `<program>
\${
    <obj> = { name: "Ada", count: 3 }
    <show> = true
}
<div id="host">\${ @show ? <span>\${@obj.name}-\${@obj.count}</span> : "" }</div>
</program>
`;

// --- regression: the SAME ternary INSIDE a <match> arm (in-arm extraction path
//     already splits upstream — must keep rendering the value + updating). ---
const ARM_SRC = `<program>
\${
    type Phase:enum = { Editing, Done }
    <phase>: Phase = .Done
    <cell> = "hello"
    <show> = true
}
<match for=Phase on=@phase>
    <Editing><p>editing</p></>
    <Done><div id="armhost">\${ @show ? <span>Saved \${@cell}</span> : "" }</div></>
</match>
</program>
`;

// --- regression: a genuinely-static markup text child (no `${}`) stays verbatim. ---
const STATIC_SRC = `<program>
\${
    <show> = true
}
<div id="static">\${ @show ? <span>Just static</span> : "" }</div>
</program>
`;

// --- regression: the each-path markup-text interpolation (ss17) still live-keys. ---
const EACH_SRC = `<program>
\${
    <items> = [{ label: "a" }, { label: "b" }]
}
<ul id="list">
    <each in=@items as item>
        <li>Item: \${item.label}</li>
    </each>
</ul>
</program>
`;

const tmpRoot = resolve("/tmp", "scrml-emit-lift-markup-text-interp");

function compileToOutputs(source, baseName) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const tmpDir = resolve(tmpRoot, `case-${uniq}`);
  const tmpInput = resolve(tmpDir, `${baseName}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir });
    const htmlPath = resolve(outDir, `${baseName}.html`);
    const clientPath = resolve(outDir, `${baseName}.client.js`);
    const runtimePath = resolve(outDir, result.runtimeFilename ?? "scrml-runtime.js");
    return {
      errors: result.errors ?? [],
      html: existsSync(htmlPath) ? readFileSync(htmlPath, "utf8") : "",
      clientJs: existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "",
      runtimeJs: existsSync(runtimePath) ? readFileSync(runtimePath, "utf8") : "",
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// §1 — emit shape: the top-level ternary markup TEXT child lowers `${@cell}`
//      reactively (split text node + emitExprField), NOT a literal JSON string.
// ---------------------------------------------------------------------------

describe("g-emit-lift-markup-text-interp §1 — emit shape (text-child `${}` lowered, not literal)", () => {
  test("compiles with no errors", () => {
    expect(compileToOutputs(TERNARY_SRC, "ternary").errors).toEqual([]);
  });

  test("the `${@cell}` text child is NOT shipped as a literal createTextNode string", () => {
    const { clientJs } = compileToOutputs(TERNARY_SRC, "ternary");
    // Pre-fix this exact literal shipped to the DOM.
    expect(clientJs).not.toContain('createTextNode("Saved ${@cell}")');
    expect(clientJs).not.toMatch(/createTextNode\("[^"]*\$\{/);
  });

  test("the `${@cell}` text child lowers to a reactive interpolation (split static + emitExprField)", () => {
    const { clientJs } = compileToOutputs(TERNARY_SRC, "ternary");
    expect(clientJs).toContain('createTextNode("Saved ")');
    expect(clientJs).toContain('createTextNode(String((_scrml_reactive_get("cell")) ?? ""))');
  });

  test("emitted client.js parses (no E-CODEGEN-INVALID-LOGIC)", () => {
    const { errors } = compileToOutputs(TERNARY_SRC, "ternary");
    expect(errors.filter((e) => String(e.code || "").includes("CODEGEN-INVALID-JS"))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §2 — happy-dom drive: the rendered DOM shows the cell VALUE (and updates on
//      cell change), NOT the literal `${@cell}` string. Real module-init order.
// ---------------------------------------------------------------------------

describe("g-emit-lift-markup-text-interp §2 — post-mount render (real module-init order)", () => {
  beforeEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
    GlobalRegistrator.register();
  });
  afterEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing to do */ }
  });

  function mount(source, baseName) {
    const { html, clientJs, runtimeJs } = compileToOutputs(source, baseName);
    document.documentElement.innerHTML = html;
    const exec = new Function(
      "window",
      "document",
      `${runtimeJs}\n${clientJs}\n` +
        `globalThis.__scrml_set__ = _scrml_reactive_set;\n` +
        `globalThis.__scrml_get__ = _scrml_reactive_get;\n`,
    );
    exec(window, document);
    document.dispatchEvent(new Event("DOMContentLoaded"));
    return {
      set: (name, val) => globalThis.__scrml_set__(name, val),
      get: (name) => globalThis.__scrml_get__(name),
      textOf: (id) => (document.getElementById(id)?.textContent ?? ""),
    };
  }

  // --- item 4 + 5: top-level ternary markup-value text-child interpolation. ---

  test("THE bug (item 4+5): the markup text child renders the cell VALUE, not the literal `${@cell}`", () => {
    const app = mount(TERNARY_SRC, "ternary");
    expect(app.textOf("host")).toBe("Saved hello");
    expect(app.textOf("host")).not.toContain("${");
  });

  test("item 4 reactivity: mutating the cell updates the rendered text", () => {
    const app = mount(TERNARY_SRC, "ternary");
    expect(app.textOf("host")).toBe("Saved hello");
    app.set("cell", "world");
    expect(app.textOf("host")).toBe("Saved world");
  });

  test("item 5 ternary: renders span+value when true, empty when false, re-renders on toggle", () => {
    const app = mount(TERNARY_SRC, "ternary");
    expect(app.textOf("host")).toBe("Saved hello");
    app.set("show", false);
    expect(app.textOf("host")).toBe("");
    app.set("cell", "world");      // change while hidden
    app.set("show", true);          // re-show — must pick up the new cell value
    expect(app.textOf("host")).toBe("Saved world");
  });

  // --- adversarial (S215): multiple `${}` + nested object field + late mutation. ---

  test("adversarial: multiple `${}` in one text node + nested object fields render their values", () => {
    const app = mount(ADVERSARIAL_SRC, "adversarial");
    const t = app.textOf("host");
    expect(t).toContain("Ada");
    expect(t).toContain("3");
    expect(t).not.toContain("${");
    expect(t).not.toContain("$ {");
  });

  test("adversarial: re-setting the object cell after first render updates every interpolation", () => {
    const app = mount(ADVERSARIAL_SRC, "adversarial");
    app.set("obj", { name: "Bob", count: 9 });
    const t = app.textOf("host");
    expect(t).toContain("Bob");
    expect(t).toContain("9");
    expect(t).not.toContain("Ada");
  });

  // --- regression: the same ternary INSIDE a <match> arm (in-arm path). ---

  test("regression (in-arm path): the ternary inside a <match> arm renders the value + updates", () => {
    const app = mount(ARM_SRC, "arm");
    expect(app.textOf("armhost")).toBe("Saved hello");
    app.set("cell", "lovelace");
    expect(app.textOf("armhost")).toBe("Saved lovelace");
  });

  // --- regression: genuinely-static text child stays verbatim (no lowering). ---

  test("regression (static): a no-`${}` markup text child renders the literal text verbatim", () => {
    const app = mount(STATIC_SRC, "staticcase");
    expect(app.textOf("static")).toBe("Just static");
  });

  // --- regression: the each-path markup-text interpolation (ss17) still renders. ---

  test("regression (each path, ss17): each-body markup text interpolation still renders item values", () => {
    const app = mount(EACH_SRC, "eachcase");
    const t = app.textOf("list");
    expect(t).toContain("Item: a");
    expect(t).toContain("Item: b");
    expect(t).not.toContain("${");
  });
});
