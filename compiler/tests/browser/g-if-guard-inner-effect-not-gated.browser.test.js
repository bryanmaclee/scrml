/**
 * g-if-guard-inner-effect-not-gated.browser.test.js — ss20 item-1 (HIGH).
 *
 * Bug (g-if-guard-inner-effect-not-gated): an `if=(@cell is some)` element that
 * falls through to the DISPLAY-TOGGLE path (non-clean subtree — it has reactive
 * `${@cell.field}` interpolation children) correctly toggles `style.display`
 * while `@cell` is null, BUT the inner interpolation effects for `${@cell.field}`
 * were emitted UNGATED and fired on mount with `@cell === null` →
 * `null.batch_number` TypeError crashed the whole mount.
 *
 * Fix (emit-html.ts + emit-event-wiring.ts): emit-html pushes the enclosing
 * `if=`'s guard fields onto an `ifGuardStack` while walking the display-toggle
 * subtree and stamps the top of that stack onto each descendant interpolation
 * LogicBinding as `ifGuard`. emit-event-wiring lowers that guard via the SAME
 * shared `computeDisplayToggleCondition` helper the toggle uses (lockstep) and
 * gates the inner effect on it: the initial render is `if (guard) {…}` and the
 * effect body short-circuits `if (!(guard)) return;`. The guard reads its own
 * reactive cell INSIDE the effect, so a false→true flip re-runs the effect (deps
 * are re-tracked each run) and renders the real values.
 *
 * Scope guards verified here:
 *   - `show=` (Vue v-show) is NEVER gated — its inner effects keep running even
 *     while the element is hidden (regression assertion).
 *   - The clean-subtree mount/unmount path is untouched (it never emits inner
 *     effects while absent — out of scope; not exercised here).
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { captureInsideChunkScope, foldChunkNamespacing } from "../helpers/chunk-scope.js";

// `@cell` starts `not` (null) and is NEVER auto-populated — the test drives the
// null→obj→null→obj transitions itself, so the DOMContentLoaded mount runs with
// `@cell === null` (the crash window). Three interpolations exercise: a flat
// field, a second flat field (multiple interpolations in one subtree), and a
// NESTED field chain (`@cell.meta.deep`). A sibling `show=` element renders an
// always-present `@msg` to prove show= inner effects are NOT gated.
const SRC = `<program>
<cell> = not
<vis> = false
<msg> = "always-here"
<div id="guarded" if=(@cell is some)>
  <h1>num: \${@cell.batch_number}</h1>
  <h2>name: \${@cell.recipe_name}</h2>
  <h3>nested: \${@cell.meta.deep}</h3>
</div>
<div id="shown" show=(@vis)>
  <span>msg: \${@msg}</span>
</div>
</program>
`;

const tmpRoot = resolve("/tmp", "scrml-g-if-guard-effect");

function compileCase(src = SRC) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const tmpDir = resolve(tmpRoot, `case-${uniq}`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  const input = resolve(tmpDir, "guard.scrml");
  writeFileSync(input, src);
  try {
    const result = compileScrml({ inputFiles: [input], write: true, outputDir: outDir });
    const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");
    return {
      errors: result.errors ?? [],
      html: read(resolve(outDir, "guard.html")),
      clientJs: read(resolve(outDir, "guard.client.js")),
      runtimeJs: read(resolve(outDir, result.runtimeFilename ?? "scrml-runtime.js")),
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("g-if-guard-inner-effect §1 — codegen gates inner effects on the toggle predicate", () => {
  test("compiles with no errors", () => {
    expect(compileCase().errors).toEqual([]);
  });

  test("each guarded inner effect short-circuits on the SAME predicate as the toggle (lockstep)", () => {
    const clientJs = foldChunkNamespacing(compileCase().clientJs);
    // The display-toggle predicate for `@cell is some`.
    const toggle = /el\.style\.display = \(\(_scrml_reactive_get\("cell"\) !== null && _scrml_reactive_get\("cell"\) !== undefined\)\) \? "" : "none";/;
    expect(toggle.test(clientJs)).toBe(true);
    // Each cell interpolation effect is gated with `if (!(<same predicate>)) return;`.
    for (const field of ["batch_number", "recipe_name"]) {
      const re = new RegExp(
        `_scrml_effect\\(function\\(\\) \\{ if \\(!\\(\\(\\(_scrml_reactive_get\\("cell"\\) !== null && _scrml_reactive_get\\("cell"\\) !== undefined\\)\\)\\)\\) return; _scrml_render_value\\(el, _scrml_reactive_get\\("cell"\\)\\.${field}\\);`,
      );
      expect(re.test(clientJs)).toBe(true);
    }
    // The initial (non-effect) render is also gated so it never reads null.field.
    expect(/if \(\(\(_scrml_reactive_get\("cell"\) !== null && _scrml_reactive_get\("cell"\) !== undefined\)\)\) \{ _scrml_render_value\(el, _scrml_reactive_get\("cell"\)\.batch_number\); \}/.test(clientJs)).toBe(true);
    // Nested chain is gated as a unit (guard protects the whole `.meta.deep` walk).
    expect(/if \(!\(.*\)\) return; _scrml_render_value\(el, _scrml_reactive_get\("cell"\)\.meta\.deep\);/.test(clientJs)).toBe(true);
  });

  test("show= inner effect is NOT gated (Vue v-show keeps running inner effects)", () => {
    const clientJs = foldChunkNamespacing(compileCase().clientJs);
    // The msg interpolation effect must be the plain (ungated) shape.
    expect(/_scrml_effect\(function\(\) \{ _scrml_render_value\(el, _scrml_reactive_get\("msg"\)\); \}\);/.test(clientJs)).toBe(true);
    // It must NOT carry the cell guard.
    expect(/return; _scrml_render_value\(el, _scrml_reactive_get\("msg"\)\)/.test(clientJs)).toBe(false);
  });
});

describe("g-if-guard-inner-effect §2 — runtime: no crash on null mount, renders on flip", () => {
  beforeEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
    GlobalRegistrator.register();
  });
  afterEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing */ }
  });

  function mount() {
    const { html, clientJs, runtimeJs } = compileCase();
    document.documentElement.innerHTML = html;
    const errs = [];
    const origErr = console.error;
    console.error = (...a) => { errs.push(a.join(" ")); };
    let threw = null;
    const exec = new Function("window", "document",
      `${runtimeJs}\n` + captureInsideChunkScope(clientJs, `globalThis.__set__ = (typeof _scrml_reactive_set!=='undefined')?_scrml_reactive_set:null;\n` +
      `globalThis.__get__ = (typeof _scrml_reactive_get!=='undefined')?_scrml_reactive_get:null;`));
    exec(window, document);
    try {
      // The crash window: mount runs with @cell === null. Pre-fix the ungated
      // `_scrml_render_value(el, _scrml_reactive_get("cell").batch_number)` threw
      // a TypeError here.
      document.dispatchEvent(new Event("DOMContentLoaded"));
    } catch (e) {
      threw = e;
    }
    console.error = origErr;
    const crashErrs = errs.filter((e) => /TypeError|Cannot read|of null|of undefined|ReferenceError|effect error/i.test(e));
    return { errs, crashErrs, threw };
  }

  const guardedSpan = (n) => document.querySelectorAll('#guarded [data-scrml-logic]')[n];

  test("(1) NO crash on mount while @cell is null", () => {
    const { crashErrs, threw } = mount();
    expect(threw).toBeNull();
    expect(crashErrs).toEqual([]);
  });

  test("(2) inner content is empty while @cell is null, and the div is hidden", () => {
    mount();
    expect(guardedSpan(0).textContent).toBe("");
    expect(guardedSpan(1).textContent).toBe("");
    expect(guardedSpan(2).textContent).toBe("");
    expect(document.querySelector("#guarded").style.display).toBe("none");
  });

  test("(3) setting @cell to a real object renders all (incl. nested) field values", () => {
    mount();
    globalThis.__set__("cell", { batch_number: 7, recipe_name: "Gouda", meta: { deep: "DEEP" } });
    expect(document.querySelector("#guarded").style.display).toBe("");
    expect(guardedSpan(0).textContent).toBe("7");
    expect(guardedSpan(1).textContent).toBe("Gouda");
    expect(guardedSpan(2).textContent).toBe("DEEP");
  });

  test("(4) setting @cell back to null hides again without crash", () => {
    const errs = [];
    mount();
    globalThis.__set__("cell", { batch_number: 7, recipe_name: "Gouda", meta: { deep: "DEEP" } });
    const origErr = console.error;
    console.error = (...a) => { errs.push(a.join(" ")); };
    let threw = null;
    try {
      globalThis.__set__("cell", null);
    } catch (e) { threw = e; }
    console.error = origErr;
    expect(threw).toBeNull();
    expect(errs.filter((e) => /TypeError|Cannot read|of null|of undefined/i.test(e))).toEqual([]);
    expect(document.querySelector("#guarded").style.display).toBe("none");
  });

  test("(adversarial) null→obj→null→obj flip-flop re-renders each time, no crash", () => {
    mount();
    const errs = [];
    const origErr = console.error;
    console.error = (...a) => { errs.push(a.join(" ")); };
    globalThis.__set__("cell", { batch_number: 1, recipe_name: "A", meta: { deep: "d1" } });
    expect(guardedSpan(0).textContent).toBe("1");
    globalThis.__set__("cell", null);
    expect(document.querySelector("#guarded").style.display).toBe("none");
    globalThis.__set__("cell", { batch_number: 2, recipe_name: "B", meta: { deep: "d2" } });
    console.error = origErr;
    expect(document.querySelector("#guarded").style.display).toBe("");
    expect(guardedSpan(0).textContent).toBe("2");
    expect(guardedSpan(1).textContent).toBe("B");
    expect(guardedSpan(2).textContent).toBe("d2");
    expect(errs.filter((e) => /TypeError|Cannot read|of null|of undefined/i.test(e))).toEqual([]);
  });

  test("(regression) a sibling show= element keeps rendering its inner effect while hidden", () => {
    mount();
    // @vis is false → #shown is display:none, but its inner ${@msg} effect is
    // NOT gated, so it still renders the always-present value.
    const shownSpan = document.querySelector('#shown [data-scrml-logic]');
    expect(document.querySelector("#shown").style.display).toBe("none");
    expect(shownSpan.textContent).toBe("always-here");
  });
});
