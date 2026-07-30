/**
 * g-if-guard-inner-effect-not-gated.browser.test.js — ss20 item-1 (HIGH),
 * SUPERSEDED IN MECHANISM by §17.1 if= Phase 2 (S301); the CONTRACT it defends is
 * unchanged and still asserted here.
 *
 * ORIGINAL BUG. An `if=(@cell is some)` element whose subtree carried
 * `${@cell.field}` interpolations fell through to the DISPLAY-TOGGLE path: the
 * element stayed in the DOM with `style.display = "none"`, and its inner
 * interpolation effects fired on mount with `@cell === null` →
 * `null.batch_number` TypeError, crashing the whole mount.
 *
 * ORIGINAL FIX (ss20). emit-html pushed the enclosing `if=`'s predicate onto an
 * `ifGuardStack` and stamped it on each descendant interpolation binding as
 * `ifGuard`; emit-event-wiring gated the inner effect on it.
 *
 * WHAT CHANGED. Phase 2 removed the display-toggle path for `if=` entirely: a
 * false `if=` subtree is not in the DOM (§17.1, SPEC.md:10914), so there is no
 * element to hide and NO inner effect to gate — the crash window is closed
 * STRUCTURALLY rather than by a predicate guard. This file therefore asserts the
 * contract (no crash while the cell is null; correct render on every flip)
 * against the mount/unmount shape. The `ifGuard` machinery itself stays live for
 * §17.1.1 chain branches that lower to display mode, which is a separate arc.
 *
 * Scope guards verified here:
 *   - `show=` (Vue v-show) is NEVER gated and NEVER removed — its element stays
 *     in the DOM, hidden, with its inner effects still running (§17.2).
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

  test("the predicate drives MOUNT/UNMOUNT, and the inner effects keep the lockstep guard", () => {
    const { clientJs: rawJs, html } = compileCase();
    const clientJs = foldChunkNamespacing(rawJs);
    // Same `@cell is some` lowering, now driving mount/unmount instead of display.
    expect(clientJs).toMatch(/if \(\(\(_scrml_reactive_get\("cell"\) !== null && _scrml_reactive_get\("cell"\) !== undefined\)\)\) _scrml_if_mount_/);
    expect(clientJs).toContain("_scrml_mount_template");
    // The display lowering is GONE from the `if=` path.
    expect(clientJs).not.toMatch(/el\.style\.display = \(\(_scrml_reactive_get\("cell"\)/);
    // The `if=` element is NOT in the shipped HTML — it is template content.
    expect(html).not.toContain("data-scrml-bind-if");
    expect(html).toMatch(/<template id="[^"]+"><div id="guarded"/);
    // AND the ss20 guard is STILL emitted on every descendant interpolation, with
    // the identical predicate. Absence alone is not sufficient: on a true->false
    // flip the descendant effects and the controller effect are all live
    // subscribers of `@cell`, and a descendant can run before the controller
    // unmounts it — i.e. predicate already false, node still attached. Measured
    // without the guard: three `TypeError: null is not an object` effect errors
    // per flip. Guard and toggle share ONE lowering, so they cannot drift.
    for (const field of ["batch_number", "recipe_name"]) {
      const re = new RegExp(
        `_scrml_effect\\(function\\(\\) \\{ if \\(!\\(\\(\\(_scrml_reactive_get\\("cell"\\) !== null && _scrml_reactive_get\\("cell"\\) !== undefined\\)\\)\\)\\) return; _scrml_render_value\\(el, _scrml_reactive_get\\("cell"\\)\\.${field}\\);`,
      );
      expect(re.test(clientJs)).toBe(true);
    }
    // The nested chain is guarded as a unit (the whole `.meta.deep` walk).
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

  test("(2) while @cell is null the whole subtree is ABSENT from the DOM (§17.1)", () => {
    mount();
    // Strictly stronger than the pre-Phase-2 assertion (hidden div + empty spans):
    // there is no element and no interpolation slot at all, so nothing can read
    // `null.field` in the first place.
    expect(document.querySelectorAll("#guarded").length).toBe(0);
    expect(document.querySelectorAll("#guarded [data-scrml-logic]").length).toBe(0);
  });

  test("(3) setting @cell to a real object renders all (incl. nested) field values", () => {
    mount();
    globalThis.__set__("cell", { batch_number: 7, recipe_name: "Gouda", meta: { deep: "DEEP" } });
    expect(document.querySelectorAll("#guarded").length).toBe(1);
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
    expect(document.querySelectorAll("#guarded").length).toBe(0);
  });

  test("(adversarial) null→obj→null→obj flip-flop re-renders each time, no crash", () => {
    mount();
    const errs = [];
    const origErr = console.error;
    console.error = (...a) => { errs.push(a.join(" ")); };
    globalThis.__set__("cell", { batch_number: 1, recipe_name: "A", meta: { deep: "d1" } });
    expect(guardedSpan(0).textContent).toBe("1");
    globalThis.__set__("cell", null);
    expect(document.querySelectorAll("#guarded").length).toBe(0);
    globalThis.__set__("cell", { batch_number: 2, recipe_name: "B", meta: { deep: "d2" } });
    console.error = origErr;
    expect(document.querySelectorAll("#guarded").length).toBe(1);
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
