/**
 * component-each-in-prop-scope.browser.test.js
 *
 * Regression gate for change-id `each-in-enclosing-scope-2026-06-01` (S153), Bug B.
 *
 * BUG: an `<each>` in a COMPONENT body iterating a typed prop —
 *   const TodoList = <ul props={ items: Todo[] }>
 *     <each in=items key=@.id> <li>${@.name}</li> </each>
 *   </ul>
 * — failed with E-SCOPE-001 on `key=@.id` + E-CODEGEN-INVALID-LOGIC (`@.name` leaked
 * as bare `.name`). THREE coordinated roots:
 *
 *   1. The component-body re-parse (component-expander.ts) defaulted to the
 *      NATIVE parser, which does NOT promote `<each>` to an `each-block` node —
 *      it left `[markup] tag=each`, so the iteration never rendered + `@.` leaked.
 *   2. `substituteProps` never substituted the prop into the each-block's string
 *      fields → `inExprRaw="items"` (the bare prop name) → `const _items = items;`
 *      (items undefined at module scope).
 *   3. The re-parse left the tokenized `@ . id` (space-padded) in `keyExprRaw`,
 *      which the each codegen's `rewriteContextualSigil` (matches `@.ident` only)
 *      leaked verbatim into the keyFn (invalid JS).
 *
 * FIX (component-expander.ts):
 *   1. sourceNeedsLiveFallback routes `<each>`/`<match>` bodies to the legacy
 *      BS+TAB re-parse (which promotes the structural node).
 *   2. substituteProps gains an each-block/match-block branch (substitute props in
 *      in=/of=/key=/as=/on= string fields + recurse template/body/empty children).
 *   3. normalizeTokenizedRaw collapses the tokenized `@ . ident` → `@.ident`.
 *
 * This test loads the emitted client.js AS-IS in real module-init order and
 * asserts the component's list ACTUALLY renders the items in the DOM.
 *
 * Models: engine-gated-each-populate.browser.test.js.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

// repro: a component with a typed prop iterated by <each>, instantiated with @todos.
const COMPONENT_SRC = `<program>
type Todo:struct = { id: string, name: string }
const TodoList = <ul props={ items: Todo[] }>
  <each in=items key=@.id>
    <li>\${@.name}</li>
  </each>
</ul>
<todos>: Todo[] = [{ id: "1", name: "alpha" }, { id: "2", name: "beta" }]
<TodoList items=@todos />
</program>
`;

const tmpRoot = resolve("/tmp", "scrml-component-each");

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
// §1 — emit shape: each-block survives expansion + prop substituted + key clean
// ---------------------------------------------------------------------------

describe("component-each §1 — emit shape (each survives expansion, prop + @. resolved)", () => {
  test("compiles with no errors (no E-SCOPE-001 on key, no E-CODEGEN-INVALID-LOGIC)", () => {
    const { errors } = compileToOutputs(COMPONENT_SRC, "comp");
    expect(errors.filter((e) => String(e.code || "").includes("SCOPE-001"))).toEqual([]);
    expect(errors.filter((e) => String(e.code || "").includes("CODEGEN-INVALID-JS"))).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("the prop is substituted into the each source (items -> reactive_get(\"todos\"))", () => {
    const { clientJs } = compileToOutputs(COMPONENT_SRC, "comp");
    // FIX 2: no bare module-scope `const _items = items;` — the prop resolved to
    // the caller's reactive cell.
    expect(clientJs).toContain('const _items = _scrml_reactive_get("todos");');
    expect(clientJs).not.toMatch(/const _items = items;/);
  });

  test("the @. sigil resolves in the keyFn + body (no leaked `@ . id` / bare `.name`)", () => {
    const { clientJs } = compileToOutputs(COMPONENT_SRC, "comp");
    // FIX 3: keyFn reads the iter var member, not the tokenized `@ . id`.
    expect(clientJs).toContain("_scrml_each_item.id");
    expect(clientJs).not.toContain("@ . id");
    expect(clientJs).not.toContain("@.id");
    // FIX 1: the body renders the iter var member, not a leaked bare `.name`.
    expect(clientJs).toContain("_scrml_each_item.name");
    expect(clientJs).not.toMatch(/textContent\(String\(\.name\)/);
  });

  test("an each render fn IS emitted (the each-block survived expansion)", () => {
    const { clientJs } = compileToOutputs(COMPONENT_SRC, "comp");
    expect(clientJs).toMatch(/^function _scrml_each_render_\d+\(\) \{/m);
  });
});

// ---------------------------------------------------------------------------
// §2 — happy-dom drive: component list populates in real module-init order
// ---------------------------------------------------------------------------

describe("component-each §2 — list populates (real module-init order)", () => {
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
      rows: () => (function(){var w=document.createTreeWalker(document.body,NodeFilter.SHOW_COMMENT),n;while((n=w.nextNode())){if(String(n.data||'').trim().indexOf('scrml-each:')===0)return n.parentNode.querySelectorAll('li');}return [];})(),
    };
  }

  test("the component each renders the items passed via the prop", () => {
    const app = mount(COMPONENT_SRC, "comp");
    const rows = app.rows();
    expect([...rows].map((n) => n.textContent.trim())).toEqual(["alpha", "beta"]);
  });

  test("prop-cell reactivity: mutating @todos re-renders the component list", () => {
    const app = mount(COMPONENT_SRC, "comp");
    expect(app.rows().length).toBe(2);
    app.set("todos", [{ id: "z", name: "zeta" }]);
    const rows = app.rows();
    expect(rows.length).toBe(1);
    expect(rows[0].textContent.trim()).toBe("zeta");
  });
});
