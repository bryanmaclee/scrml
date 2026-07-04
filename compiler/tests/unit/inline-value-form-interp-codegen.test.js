/**
 * inline-value-form-interp-codegen.test.js — CODEGEN-SHAPE gate for
 * inline value-form control-flow as the SOLE content of a markup `${...}`
 * interpolation (SPEC §18.0 JS-style value-`match` / §17.6 if-as-expression).
 * change-id: inline-value-form-interp-render-2026-06-30.
 *
 * Asserts the EMITTED SHAPE; the companion RENDER + REACTIVITY R26 lives in
 * compiler/tests/browser/inline-value-form-interp-render.browser.test.js.
 *
 * Pre-fix CLASS-WIDE bug:
 *   - `${ match @x {…} }` got NO `data-scrml-logic` slot and emitted the match as
 *     a value-DISCARDING file-scope IIFE (`(function(){…})()` as a bare stmt).
 *   - `${ if c {a} else {b} }` got a slot but the bare-expr-only binding loop
 *     never wired it (branch values discarded; slot stayed empty).
 *
 * Fix: emit-html.ts detects a value-form match/if sole-content interp, allocates a
 * slot + a `value-control-flow` logic-binding; emit-event-wiring.ts lowers it to
 * the value-returning form (emit-control-flow.ts emitMatchExpr IIFE /
 * emitIfValueExpr ternary) and emits `_scrml_render_value` + a reactive
 * `_scrml_effect`. The file-scope value-discarding emit is suppressed.
 */
import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

function compileToOutputs(source, suffix) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const name = `${suffix}-${uniq}`;
  const tmpDir = resolve("/tmp", `scrml-${name}`);
  const tmpInput = resolve(tmpDir, `${name}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir });
    const clientPath = resolve(outDir, `${name}.client.js`);
    const htmlPath = resolve(outDir, `${name}.html`);
    return {
      errors: result.errors ?? [],
      clientJs: existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "",
      html: existsSync(htmlPath) ? readFileSync(htmlPath, "utf8") : "",
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("inline-value-form-interp — codegen shape", () => {
  test("(match) sole-content value-match → render slot + render_value + effect; NO dead file-scope IIFE", () => {
    const src = `type View:enum = .List | .Grid
<x>: View = .List
<p>\${ match @x { .List :> "list view"  .Grid :> "grid view" } }</p>`;
    const { errors, clientJs, html } = compileToOutputs(src, "ivf-match");
    expect(errors.filter(e => e.code === "E-CODEGEN-INVALID-LOGIC")).toHaveLength(0);
    // A render slot is allocated in the HTML.
    expect(html).toMatch(/data-scrml-logic="_scrml_logic_\d+"/);
    // The value is rendered via the node-aware display helper + a reactive effect.
    expect(clientJs).toContain("_scrml_render_value(el,");
    expect(clientJs).toContain("_scrml_effect(");
    // The match value is captured (the IIFE returns the arm value).
    expect(clientJs).toContain('if (_scrml_match_');
    expect(clientJs).toContain('return "list view"');
    // The pre-fix dead value-discarding file-scope IIFE is GONE: the only
    // occurrence of the match IIFE is INSIDE the render fn (after `return `),
    // never as a bare top-level statement.
    expect(clientJs).not.toMatch(/\n\(function\(\) \{\n\s*const _scrml_match_/);
  });

  test("(if) sole-content value-if → render slot + readable ternary + render_value + effect", () => {
    const src = `<n>: int = 5
<p>\${ if @n > 3 { "big" } else { "small" } }</p>`;
    const { errors, clientJs, html } = compileToOutputs(src, "ivf-if");
    expect(errors.filter(e => e.code === "E-CODEGEN-INVALID-LOGIC")).toHaveLength(0);
    expect(html).toMatch(/data-scrml-logic="_scrml_logic_\d+"/);
    // The if lowers to a readable conditional-expression cascade (a ternary).
    expect(clientJs).toContain('(_scrml_reactive_get("n") > 3 ? "big" : "small")');
    expect(clientJs).toContain("_scrml_render_value(el,");
    expect(clientJs).toContain("_scrml_effect(");
    // Pre-fix the branch values were discarded as a bare file-scope `if(){…}else{…}`
    // with no return — that statement form is GONE.
    expect(clientJs).not.toMatch(/\n\s*"big";/);
    expect(clientJs).not.toMatch(/\n\s*"small";/);
  });

  test("(else-if chain) value-if cascade lowers to a right-associated nested ternary", () => {
    const src = `<n>: int = 5
<p>\${ if @n > 8 { "hi" } else if @n > 3 { "mid" } else { "lo" } }</p>`;
    const { errors, clientJs } = compileToOutputs(src, "ivf-elseif");
    expect(errors.filter(e => e.code === "E-CODEGEN-INVALID-LOGIC")).toHaveLength(0);
    expect(clientJs).toContain('"hi"');
    expect(clientJs).toContain('"mid"');
    expect(clientJs).toContain('"lo"');
    // Nested ternary shape: `(cond0 ? "hi" : (cond1 ? "mid" : "lo"))`.
    expect(clientJs).toMatch(/\?\s*"hi"\s*:\s*\(.*\?\s*"mid"\s*:\s*"lo"\)/);
  });

  test("(non-reactive scrutinee) a static-condition value-if renders once with NO effect", () => {
    const src = `const LIMIT = 10
<p>\${ if LIMIT > 3 { "big" } else { "small" } }</p>`;
    const { errors, clientJs } = compileToOutputs(src, "ivf-static");
    expect(errors.filter(e => e.code === "E-CODEGEN-INVALID-LOGIC")).toHaveLength(0);
    expect(clientJs).toContain("_scrml_render_value(el,");
    // No reactive cell read → no _scrml_effect wrapper for this slot.
    // (The whole client.js may still use _scrml_effect elsewhere, but here the
    // value-control-flow render is one-shot; assert the effect-less render line.)
    const renderLines = clientJs.split("\n").filter(l => l.includes("_scrml_render_value(el,"));
    expect(renderLines.length).toBe(1);
  });

  // ---- ADVERSARIAL (S215): load-bearing non-value shapes must keep prior behavior ----

  test("(ADVERSARIAL — markup match arm) a markup-bodied value-match arm is STEERED (E-MATCH-ARM-MARKUP-IN-VALUE), not silently rendered", () => {
    const src = `type View:enum = .List | .Grid
<x>: View = .List
<div>\${ match @x { .List :> <span>L</span>  .Grid :> <span>G</span> } }</div>`;
    const { errors } = compileToOutputs(src, "ivf-markup-arm");
    // §18.0 steer fires — the shape is rejected (same as the derived-cell twin).
    expect(errors.some(e => e.code === "E-MATCH-ARM-MARKUP-IN-VALUE")).toBe(true);
  });

  test("(ADVERSARIAL — else-less if) an else-less `${ if c { x() } }` is NOT a value-form (no spurious render slot)", () => {
    const src = `<n>: int = 5
fn ping() { log("ping") }
<p>\${ if @n > 3 { ping() } }</p>`;
    const { clientJs } = compileToOutputs(src, "ivf-noelse");
    // No else → not a value-form-if → no value-control-flow render wiring.
    // The side-effecting body keeps its prior (statement) emit path; it must NOT
    // be wrapped in a _scrml_render_value of an if-value.
    expect(clientJs).not.toMatch(/_scrml_render_value\(el, \(_scrml_reactive_get\("n"\) > 3 \?/);
  });

  test("(ADVERSARIAL — plain `${@cell}` unchanged) primitive interp keeps the textContent path, no value-control-flow", () => {
    const src = `<count>: int = 5
<p>\${@count}</p>`;
    const { clientJs } = compileToOutputs(src, "ivf-plain");
    expect(clientJs).toContain("_scrml_render_value(el,");
    // The plain-cell read lowers to the bare cell get, not a control-flow IIFE/ternary.
    expect(clientJs).toContain('_scrml_render_value(el, _scrml_reactive_get("count"))');
    expect(clientJs).not.toContain("_scrml_match_");
  });

  test("(ADVERSARIAL — declaration-only interp) `${ <x> = 0 }` gets NO render slot (phantom-span guard intact)", () => {
    const src = `<p>before\${ <x> = 0 }after</p>`;
    const { html } = compileToOutputs(src, "ivf-decl");
    // A declaration-only logic body is not value-form; it must not stamp a
    // value-control-flow render slot.
    expect(html).not.toMatch(/data-scrml-logic/);
  });
});
