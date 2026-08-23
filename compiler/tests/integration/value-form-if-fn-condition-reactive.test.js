/**
 * value-form-if-fn-condition-reactive.test.js
 *
 * g-value-form-if-fn-condition-not-reactive — a §17.6 value-form
 * `${ if isOn() { … } else { … } }` whose CONDITION is a fn-call did NOT update
 * reactively when a cell the fn reads changed: the display was rendered once and
 * never re-ran. Root: emit-event-wiring's value-control-flow lowering decided
 * effect-vs-static by string-scanning the LOWERED value for `_scrml_reactive_get`
 * — which sees a DIRECT `${ if @c … }` read but NOT a cell read hidden inside a
 * called fn (`isOn()`), so the fn-condition case fell to the STATIC one-shot path.
 * Found dog-fooding a signup form whose error messages (`${ if emailValid() … }`)
 * never cleared (S369-peter).
 *
 * FIX: also treat the presence of ANY CALL in the lowered value as
 * potentially-reactive → wrap in the region effect. The effect auto-tracks the
 * callee's reactive reads at RUNTIME; a genuinely non-reactive call just yields an
 * effect that never re-fires (fail-safe — a false positive is a needless effect, a
 * false negative is a stale display).
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const D = "$";
let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "vf-if-fncond-")); });
afterAll(() => { if (TMP) rmSync(TMP, { recursive: true, force: true }); });

function compileApp(source, name = "app") {
  const fp = join(TMP, `${name}.scrml`);
  writeFileSync(fp, source.endsWith("\n") ? source : source + "\n");
  const out = join(TMP, `${name}.dist`);
  const r = compileScrml({ inputFiles: [fp], outputDir: out, write: true, validateEmit: true, log: () => {} });
  const errors = (r.errors || []).filter((e) => (e.severity ?? "error") === "error");
  const jsPath = join(out, `${name}.client.js`);
  return { errorCodes: errors.map((e) => e.code), js: existsSync(jsPath) ? readFileSync(jsPath, "utf8") : "" };
}

// The value-form-if for a `<p class="X">` interp lowers to a `_scrml_cf_<logic>`
// render fn RE-RUN under `_scrml_effect` when reactive, or a one-shot
// `_scrml_render_value(el, <ternary>)` with no effect when static.
const reactiveWiring = (js) => /const _scrml_cf__scrml_logic_\d+ = function\(\) \{ return \([\s\S]*?\); \};[\s\S]*?_scrml_effect\(function\(\) \{ _scrml_render_value\(el, _scrml_cf__scrml_logic_\d+\(\)\);/.test(js);

describe("value-form if with a fn-call condition is reactive (g-value-form-if-fn-condition-not-reactive)", () => {
  test("the gap repro: `${ if isOn() { … } else { … } }` (isOn reads @c) is wrapped in a reactive effect", () => {
    const r = compileApp(`<program>
${D}{
  <c>: bool = false
  fn isOn() { return @c }
}
<div><p class="s">${D}{ if isOn() { "ON" } else { "OFF" } }</p></div>
</program>`);
    expect(r.errorCodes).toEqual([]);
    // the fn-condition value-if now re-renders under _scrml_effect (was a one-shot)
    expect(reactiveWiring(r.js)).toBe(true);
    // and it references the (mangled) user fn, not a direct reactive_get
    expect(/_scrml_isOn_\d+\(\)/.test(r.js)).toBe(true);
  });

  test("NON-REGRESSION: a DIRECT `${ if @c … }` value-if is still reactive", () => {
    const r = compileApp(`<program>
${D}{ <c>: bool = false }
<div><p class="s">${D}{ if @c { "ON" } else { "OFF" } }</p></div>
</program>`, "direct");
    expect(r.errorCodes).toEqual([]);
    expect(reactiveWiring(r.js)).toBe(true);
  });

  test("a value-form `match` with a fn-call SCRUTINEE (variant arms) is reactive too", () => {
    // The fix applies to the shared value-control-flow path, so the match-form
    // (emitMatchExpr) benefits identically — a fn-call scrutinee whose fn reads a
    // cell must re-render. (Numeric-literal-arm matches take a different, non-
    // value-control-flow path; variant `.A :>` arms reach this one.)
    const r = compileApp(`<program>
${D}{
  type S:enum = { A, B }
  <s>: S = S.A
  fn cur() { return @s }
}
<div><p class="s">${D}{ match cur() { .A :> "a" .B :> "b" } }</p></div>
</program>`, "matchfn");
    expect(r.errorCodes).toEqual([]);
    expect(reactiveWiring(r.js)).toBe(true);
    expect(/_scrml_cur_\d+\(\)/.test(r.js)).toBe(true);
  });

  test("an else-if cascade with a fn-call condition is reactive", () => {
    const r = compileApp(`<program>
${D}{
  <n>: int = 0
  fn hi() { return @n > 90 }
  fn mid() { return @n > 10 }
}
<div><p class="s">${D}{ if hi() { "H" } else if mid() { "M" } else { "L" } }</p></div>
</program>`, "cascade");
    expect(r.errorCodes).toEqual([]);
    expect(reactiveWiring(r.js)).toBe(true);
  });

  test("NON-REGRESSION: a genuinely-static value-form if (no cell, no call) stays a one-shot render (no effect)", () => {
    // A const-only condition references no cell and makes no call → the static
    // optimization is preserved (no needless effect).
    const r = compileApp(`<program>
${D}{ const FLAG = true }
<div><p class="s">${D}{ if FLAG { "on" } else { "off" } }</p></div>
</program>`, "static");
    expect(r.errorCodes).toEqual([]);
    // rendered once, NOT wrapped in a re-running effect for this logic slot
    expect(reactiveWiring(r.js)).toBe(false);
  });

  test("NON-REGRESSION: a const `if` whose BRANCH TEXT contains call-like syntax stays static (AST-scan, not text-scan)", () => {
    // The reactivity decision scans the AST for a real `call` node, NOT the lowered
    // string — so `"click (here)"` inside a branch value must NOT force reactivity.
    const r = compileApp(`<program>
${D}{ const FLAG = true }
<div><p class="s">${D}{ if FLAG { "click (here)" } else { "" } }</p></div>
</program>`, "strparen");
    expect(r.errorCodes).toEqual([]);
    expect(reactiveWiring(r.js)).toBe(false);
  });
});
