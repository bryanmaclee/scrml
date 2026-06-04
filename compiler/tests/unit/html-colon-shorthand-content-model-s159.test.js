/**
 * html-colon-shorthand-content-model-s159.test.js — S159 (S154 design ruling (a)).
 *
 * SPEC §4.14 (landed @ 1fb9823f) — a `:`-shorthand body on a lowercase HTML
 * element follows the element's content model (the §24 registry `isVoid` flag,
 * the single source of truth):
 *
 *   - NON-VOID HTML (`isVoid:false` — span/div/p/li/button/label/…): the
 *     `:`-shorthand body IS the element's single-expression body, BYTE-IDENTICAL
 *     to the bare-body form `<tag>${expr}</tag>`. `<span : @label>` renders
 *     exactly as `<span>${@label}</span>`. The body follows §4.18 code-default
 *     grammar: an EXPRESSION body is the interpolated VALUE; a `"..."`
 *     display-text literal (§4.18.3) is the UNQUOTED display text (interior
 *     `${...}` interpolation preserved, §4.18.4).
 *   - VOID HTML (`isVoid:true` — input/img/br/hr + SVG geometry rect/circle/
 *     line/path/polyline/polygon): the `:`-shorthand body is REJECTED with
 *     `E-COLON-SHORTHAND-ON-VOID` (§34). A void element binds a value through
 *     an ATTRIBUTE (`<input bind:value=@x/>`), not a body.
 *
 * This RESOLVES the prior emission gap where `<span : @label>` parsed but
 * emitted an empty `<span></span>` (the expression dropped) and the cell then
 * false-fired `E-DG-002` ("declared but never consumed").
 *
 * Implementation (codegen half, S159):
 *   - ast-builder.js: synthesize the body child via re-parse of the equivalent
 *     `<tag>BODY</tag>` source — guaranteeing byte-identity. Skips components,
 *     void elements, and `@.` bodies (emit-each owns the per-item form).
 *   - block-splitter.js: the `shorthand && !selfClosing` branch precedes the
 *     void/self-closing short-circuit so `<void : expr>` reaches the guard.
 *   - type-system.ts: the E-COLON-SHORTHAND-ON-VOID guard + the
 *     `@.`-shorthand-body outside-each E-SYNTAX-064 fire (R3).
 *
 * Coverage:
 *   §1 — non-void expression body emits interpolated value; NO E-DG-002 false-fire
 *   §2 — byte-identity vs the explicit bare-body `<tag>${expr}</tag>`
 *   §3 — display-text literal body emits unquoted display text (no quotes)
 *   §4 — assorted non-void elements (div/p/button/label)
 *   §5 — void elements (input/br/img + SVG rect) -> E-COLON-SHORTHAND-ON-VOID (fatal)
 *   §6 — `<input/>` + `<input type="text"/>` regression (BS reorder safety)
 *   §7 — component `<MyComp : x>` untouched (no synthesis, no E-COLON)
 *   §8 — `<li : @.name>` inside `<each>` renders per-item; outside -> E-SYNTAX-064
 *   §9 — interior `${...}` interpolation inside a "..." literal body (§4.18.4)
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "s159-colon-shorthand-")); });
afterAll(() => { if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true }); });

function compile(filename, source) {
  const abs = join(TMP, filename);
  mkdirSync(join(abs, "..").replace(/\/$/, ""), { recursive: true });
  writeFileSync(abs, source);
  return compileScrml({ inputFiles: [abs], outputDir: join(TMP, "dist"), write: false, log: () => {} });
}
function realErrors(result) {
  return (result.errors || []).filter((e) => e && e.severity !== "warning" && e.severity !== "info");
}
function codes(arr) { return arr.map((e) => e.code); }
function allDiagnostics(result) { return [...(result.errors || []), ...(result.warnings || [])]; }
function getOut(result, key) {
  const outputs = result.outputs;
  if (!outputs) return "";
  for (const [, v] of outputs) { if (v && typeof v === "object" && v[key]) return v[key]; }
  return "";
}
function getClientJs(result) { return getOut(result, "clientJs"); }
function getHtml(result) { return getOut(result, "html"); }
// Normalize gensym counters so two STRUCTURALLY identical lowerings compare
// equal modulo placeholder ids.
function norm(s) {
  return String(s)
    .replace(/_scrml_[a-z_]+_\d+/g, "_scrml_GEN")
    .replace(/scrml-[a-z]+="[^"]*"/g, "scrml-GEN")
    // Per-fixture noise that is NOT part of the body lowering: the page
    // <title> (from the distinct `title=` we set so two fixtures don't collide)
    // and the per-file client-js <script src> name. Normalize both out so the
    // comparison is byte-identity of the BODY, not of incidental fixture names.
    .replace(/<title>[^<]*<\/title>/g, "<title>T</title>")
    .replace(/<script src="[^"]*\.client\.js"><\/script>/g, '<script src="GEN.client.js"></script>');
}

// ---------------------------------------------------------------------------
// §1 — non-void expression body emits the interpolated VALUE; no E-DG-002
// ---------------------------------------------------------------------------
describe("§1 non-void expression `:`-shorthand body", () => {
  const src = `<program title="S1">
\${
  <label> = "Email"
}
<span : @label>
</program>`;

  test("emits the interpolated body binding (the VALUE, not the literal characters)", () => {
    const result = compile("s1.scrml", src);
    expect(realErrors(result)).toEqual([]);
    const js = getClientJs(result);
    // The body lowers to a reactive read of the cell, exactly as `${@label}`.
    expect(js).toContain('_scrml_reactive_get("label")');
    // NOT the literal characters "@label" as text.
    expect(getHtml(result)).not.toContain(">@label<");
  });

  test("E-DG-002 false-fire is GONE (the expression IS consumed)", () => {
    const result = compile("s1-dg.scrml", src);
    expect(codes(allDiagnostics(result))).not.toContain("E-DG-002");
  });
});

// ---------------------------------------------------------------------------
// §2 — byte-identity vs the explicit bare-body `<span>${@label}</span>`
// ---------------------------------------------------------------------------
describe("§2 byte-identity with the explicit bare-body form", () => {
  test("`<span : @label>` lowers identically to `<span>${@label}</span>` (modulo gensym)", () => {
    const shorthand = compile("s2-sh.scrml", `<program title="S2sh">
\${
  <label> = "Email"
}
<span : @label>
</program>`);
    const explicit = compile("s2-ex.scrml", `<program title="S2ex">
\${
  <label> = "Email"
}
<span>\${@label}</span>
</program>`);
    expect(realErrors(shorthand)).toEqual([]);
    expect(realErrors(explicit)).toEqual([]);
    expect(norm(getHtml(shorthand))).toBe(norm(getHtml(explicit)));
    expect(norm(getClientJs(shorthand))).toBe(norm(getClientJs(explicit)));
  });
});

// ---------------------------------------------------------------------------
// §3 — display-text literal body -> unquoted display text (§4.18.3)
// ---------------------------------------------------------------------------
describe("§3 display-text literal `:`-shorthand body", () => {
  test("`<li : \"Static item\">` emits the unquoted display text `Static item`", () => {
    const result = compile("s3.scrml", `<program title="S3">
\${
  <label> = "x"
}
<ul>
<li : "Static item">
</ul>
</program>`);
    expect(realErrors(result)).toEqual([]);
    const html = getHtml(result);
    expect(html).toContain("<li>Static item</li>");
    // Quotes are stripped (§4.18.3) — the literal characters `"Static item"`
    // (with quotes) must NOT appear in the rendered li body.
    expect(html).not.toContain('<li>"Static item"</li>');
  });

  test("byte-identical to the explicit `<li>Static item</li>`", () => {
    const sh = compile("s3-sh.scrml", `<program title="S3sh">
\${
  <label> = "x"
}
<ul>
<li : "Static item">
</ul>
</program>`);
    const ex = compile("s3-ex.scrml", `<program title="S3ex">
\${
  <label> = "x"
}
<ul>
<li>Static item</li>
</ul>
</program>`);
    expect(realErrors(sh)).toEqual([]);
    expect(realErrors(ex)).toEqual([]);
    expect(norm(getHtml(sh))).toBe(norm(getHtml(ex)));
  });
});

// ---------------------------------------------------------------------------
// §4 — assorted non-void elements
// ---------------------------------------------------------------------------
describe("§4 assorted non-void elements take a `:`-shorthand body", () => {
  for (const tag of ["div", "p", "button", "label"]) {
    test(`<${tag} : @name> emits an interpolated body, no error`, () => {
      const result = compile(`s4-${tag}.scrml`, `<program title="S4">
\${
  <name> = "Ada"
}
<${tag} : @name>
</program>`);
      expect(realErrors(result)).toEqual([]);
      expect(codes(allDiagnostics(result))).not.toContain("E-DG-002");
      expect(getClientJs(result)).toContain('_scrml_reactive_get("name")');
    });
  }
});

// ---------------------------------------------------------------------------
// §5 — void elements reject the `:`-shorthand body (fatal)
// ---------------------------------------------------------------------------
describe("§5 void elements -> E-COLON-SHORTHAND-ON-VOID", () => {
  test("`<input : @label>` -> E-COLON-SHORTHAND-ON-VOID (fatal)", () => {
    const result = compile("s5-input.scrml", `<program title="S5i">
\${
  <label> = "x"
}
<input : @label>
</program>`);
    expect(codes(result.errors || [])).toContain("E-COLON-SHORTHAND-ON-VOID");
    const m = (result.errors || []).find((e) => e.code === "E-COLON-SHORTHAND-ON-VOID");
    expect(m.message).toContain("input");
    expect(m.message).toContain("bind:value");
  });

  test("`<br : x>` -> E-COLON-SHORTHAND-ON-VOID", () => {
    const result = compile("s5-br.scrml", `<program title="S5b">
\${
  <label> = "x"
}
<br : @label>
</program>`);
    expect(codes(result.errors || [])).toContain("E-COLON-SHORTHAND-ON-VOID");
  });

  test("`<img : x>` -> E-COLON-SHORTHAND-ON-VOID", () => {
    const result = compile("s5-img.scrml", `<program title="S5m">
\${
  <label> = "x"
}
<img : @label>
</program>`);
    expect(codes(result.errors || [])).toContain("E-COLON-SHORTHAND-ON-VOID");
  });

  test("SVG geometry void `<rect : x>` -> E-COLON-SHORTHAND-ON-VOID", () => {
    const result = compile("s5-rect.scrml", `<program title="S5r">
\${
  <label> = "x"
}
<svg><rect : @label></svg>
</program>`);
    expect(codes(result.errors || [])).toContain("E-COLON-SHORTHAND-ON-VOID");
  });
});

// ---------------------------------------------------------------------------
// §6 — BS-reorder safety: self-closing void elements are UNAFFECTED
// ---------------------------------------------------------------------------
describe("§6 self-closing void elements regression (BS reorder safety)", () => {
  test("`<input/>` and `<input type=\"text\"/>` do NOT fire E-COLON-SHORTHAND-ON-VOID", () => {
    const result = compile("s6.scrml", `<program title="S6">
<input/>
<input type="text"/>
</program>`);
    expect(codes(allDiagnostics(result))).not.toContain("E-COLON-SHORTHAND-ON-VOID");
  });
});

// ---------------------------------------------------------------------------
// §7 — PascalCase component `:`-shorthand is UNTOUCHED
// ---------------------------------------------------------------------------
describe("§7 component `:`-shorthand untouched", () => {
  test("`<MyComp : x>` does NOT fire E-COLON-SHORTHAND-ON-VOID (component, not void HTML)", () => {
    const result = compile("s7.scrml", `<program title="S7">
\${
  <label> = "x"
}
<MyComp : @label>
</program>`);
    // The component is undefined here so other diagnostics may fire; the
    // load-bearing assertion is that the void-reject guard does NOT engage.
    expect(codes(allDiagnostics(result))).not.toContain("E-COLON-SHORTHAND-ON-VOID");
  });
});

// ---------------------------------------------------------------------------
// §8 — `@.` per-item body: inside `<each>` renders; outside -> E-SYNTAX-064
// ---------------------------------------------------------------------------
describe("§8 `@.` `:`-shorthand body (each per-item ownership)", () => {
  test("`<li : @.name>` INSIDE `<each>` renders per-item (emit-each owns it)", () => {
    const result = compile("s8-in.scrml", `<program title="S8in">
\${
  type Item:struct = { id: int, name: string }
  <items>: Item[] = []
}
<ul>
<each in=@items as item>
<li : @.name>
</each>
</ul>
</program>`);
    expect(realErrors(result)).toEqual([]);
    const js = getClientJs(result);
    expect(js).toContain('document.createElement("li")');
    expect(js).toContain("item.name");
  });

  test("`<li : @.name>` OUTSIDE `<each>` -> E-SYNTAX-064 (not silently swallowed)", () => {
    const result = compile("s8-out.scrml", `<program title="S8out">
\${
  <label> = "x"
}
<li : @.name>
</program>`);
    expect(codes(result.errors || [])).toContain("E-SYNTAX-064");
    const m = (result.errors || []).find((e) => e.code === "E-SYNTAX-064");
    expect(m.message).toContain("@.name");
    expect(m.message).toContain("<each>");
  });
});

// ---------------------------------------------------------------------------
// §9 — interior `${...}` interpolation inside a "..." literal body (§4.18.4)
// ---------------------------------------------------------------------------
describe("§9 interior interpolation inside a display-text literal body", () => {
  test("`<span : \"Hello ${@name}\">` emits display text + reactive interpolation", () => {
    const result = compile("s9.scrml", `<program title="S9">
\${
  <name> = "Ada"
}
<span : "Hello \${@name}">
</program>`);
    expect(realErrors(result)).toEqual([]);
    const html = getHtml(result);
    // The static prefix "Hello " is display text; the ${@name} is a reactive
    // interpolation placeholder (§4.18.4 — one interpolation inside the literal).
    expect(html).toContain("Hello ");
    expect(getClientJs(result)).toContain('_scrml_reactive_get("name")');
  });
});
