/**
 * g-if-chain-branch-display-null-interp.browser.test.js — ss21 item-3 (MED).
 *
 * Bug (g-if-chain-branch-display-null-interp): an `if=`/`else-if=`/`else` CHAIN
 * branch is a SEPARATE node kind from the single-`if=` display-toggle that ss20
 * item-1 fixed. The chain branch's if=/else-if=/else attrs are STRIPPED before
 * the generic markup walk (stripChainBranchAttrs), so the ss20 single-`if=`
 * ifGuardStack push never fires on chain branches. A chain branch carrying
 * reactive `${@cell.field}` over a null cell therefore emitted its inner
 * interpolation effects UNGATED — and while the branch is HIDDEN (a different
 * branch is active) those effects still ran on mount with `@cell === null` →
 * `null.field` TypeError aborted the whole mount.
 *
 * Fix (emit-html.ts + emit-event-wiring.ts + binding-registry.ts): emit-html
 * pushes a `chainGuard` (this branch's own condition + every PRIOR positive
 * branch condition) onto the `ifGuardStack` while walking each DIRTY
 * (display-mode) chain branch's children, stamping it onto descendant
 * interpolation LogicBindings. emit-event-wiring lowers it via the SAME
 * `computeChainBranchCondition` helper the chain controller's `_next` cascade
 * uses (extracted + shared → byte-identical, lockstep), producing the branch's
 * VISIBILITY predicate: all priors false AND (own true, or it's the else). The
 * inner effect short-circuits (`if (!(guard)) return;`) while the branch is
 * hidden, so a hidden branch never reads `null.field`. The guard reads its own
 * reactive cells INSIDE the effect, so an activation flip re-runs the effect
 * (deps re-tracked each run) and renders the real values.
 *
 * Scope/contract notes verified here:
 *   - The gate protects HIDDEN branches. A VISIBLE branch over a null cell
 *     still throws (adopter contract — identical to a top-level `${@z.c}` with
 *     z absent); the gate neither introduces nor masks that. Tests therefore
 *     keep the active branch's cell present.
 *   - The single-`if=` path (ss20) keeps the computeDisplayToggleCondition gate
 *     (regression); `show=` is NEVER gated (regression).
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { captureInsideChunkScope, foldChunkNamespacing } from "../helpers/chunk-scope.js";

// A 3-branch chain (if=/else-if=/else), each branch over a DIFFERENT cell that
// starts `not` (null). The else also carries a NESTED field chain
// (`@z.meta.deep`). A standalone single-`if=` (`#ssingle`, ss20 path) and a
// sibling `show=` (`#smsg`) follow, for the regression assertions.
const SRC = `<program>
<x> = not
<y> = not
<z> = not
<vis> = false
<msg> = "always"
<div if=(@x is some)>
  <span id="sx">x: \${@x.a}</span>
</div>
<div else-if=(@y is some)>
  <span id="sy">y: \${@y.b}</span>
</div>
<div else>
  <span id="sz">z: \${@z.c}</span>
  <span id="sznest">nested: \${@z.meta.deep}</span>
</div>
<div if=(@x is some)>
  <span id="ssingle">single: \${@x.a}</span>
</div>
<div show=(@vis)>
  <span id="smsg">msg: \${@msg}</span>
</div>
</program>
`;

const tmpRoot = resolve("/tmp", "scrml-g-if-chain-branch-null");

function compileCase(src = SRC) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const tmpDir = resolve(tmpRoot, `case-${uniq}`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  const input = resolve(tmpDir, "chain.scrml");
  writeFileSync(input, src);
  try {
    const result = compileScrml({ inputFiles: [input], write: true, outputDir: outDir });
    const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");
    return {
      errors: result.errors ?? [],
      html: read(resolve(outDir, "chain.html")),
      clientJs: read(resolve(outDir, "chain.client.js")),
      runtimeJs: read(resolve(outDir, result.runtimeFilename ?? "scrml-runtime.js")),
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

// The lowered `@x is some` predicate core (shared by the cascade + the gate).
const X_SOME = `(_scrml_reactive_get("x") !== null && _scrml_reactive_get("x") !== undefined)`;
const Y_SOME = `(_scrml_reactive_get("y") !== null && _scrml_reactive_get("y") !== undefined)`;

describe("g-if-chain-branch-null §1 — codegen gates each chain branch on its visibility predicate", () => {
  test("compiles with no errors", () => {
    expect(compileCase().errors).toEqual([]);
  });

  test("the if= head branch effect is gated on its OWN condition", () => {
    const clientJs = foldChunkNamespacing(compileCase().clientJs);
    // b0: `if=(@x is some)` → gate is `(@x is some)`.
    expect(clientJs).toContain(
      `_scrml_effect(function() { if (!((${X_SOME}))) return; _scrml_render_value(el, _scrml_reactive_get("x").a); });`,
    );
    // Initial (non-effect) render is gated too.
    expect(clientJs).toContain(
      `if ((${X_SOME})) { _scrml_render_value(el, _scrml_reactive_get("x").a); }`,
    );
  });

  test("the else-if= branch effect is gated on priors-false AND own-true", () => {
    const clientJs = foldChunkNamespacing(compileCase().clientJs);
    // b1: `else-if=(@y is some)` → visible iff `!(@x is some) && (@y is some)`.
    expect(clientJs).toContain(
      `_scrml_effect(function() { if (!(!(${X_SOME}) && (${Y_SOME}))) return; _scrml_render_value(el, _scrml_reactive_get("y").b); });`,
    );
  });

  test("the else branch effect is gated on all-priors-false (incl. nested field as a unit)", () => {
    const clientJs = foldChunkNamespacing(compileCase().clientJs);
    // else → visible iff `!(@x is some) && !(@y is some)`.
    const elseGate = `if (!(!(${X_SOME}) && !(${Y_SOME}))) return;`;
    expect(clientJs).toContain(`${elseGate} _scrml_render_value(el, _scrml_reactive_get("z").c);`);
    // The nested chain `${@z.meta.deep}` is guarded as a unit by the same gate.
    expect(clientJs).toContain(`${elseGate} _scrml_render_value(el, _scrml_reactive_get("z").meta.deep);`);
  });

  test("each branch gate is BYTE-IDENTICAL to the chain controller's `_next` cascade (lockstep)", () => {
    const clientJs = foldChunkNamespacing(compileCase().clientJs);
    // Capture the cascade predicate for the if= head (between `_next === null && `
    // and ` _next = "..._b0"`) and assert that exact predicate is the gate.
    const m = clientJs.match(/if \(_next === null && (\(\(_scrml_reactive_get\("x"\) !== null && _scrml_reactive_get\("x"\) !== undefined\)\))\) _next = "[^"]*_b0";/);
    expect(m).not.toBeNull();
    const cascadeCore = m[1]; // ((@x is some))
    // The b0 inner-effect gate negates exactly this core.
    expect(clientJs).toContain(`if (!(${cascadeCore})) return; _scrml_render_value(el, _scrml_reactive_get("x").a);`);
  });

  test("(regression) the standalone single-`if=` keeps the ss20 display-toggle gate", () => {
    const clientJs = foldChunkNamespacing(compileCase().clientJs);
    // `#ssingle` interpolates `${@x.a}` under a standalone `if=(@x is some)`.
    // ss20 gates it via computeDisplayToggleCondition — same predicate shape,
    // NOT a chainGuard. It appears a SECOND time in the file (after the chain).
    const occurrences = clientJs.split(
      `_scrml_effect(function() { if (!((${X_SOME}))) return; _scrml_render_value(el, _scrml_reactive_get("x").a); });`,
    ).length - 1;
    // Once for the chain b0, once for the standalone single-if.
    expect(occurrences).toBe(2);
  });

  test("(regression) the sibling `show=` inner effect is NOT gated", () => {
    const clientJs = foldChunkNamespacing(compileCase().clientJs);
    expect(clientJs).toContain(
      `_scrml_effect(function() { _scrml_render_value(el, _scrml_reactive_get("msg")); });`,
    );
    expect(/return; _scrml_render_value\(el, _scrml_reactive_get\("msg"\)\)/.test(clientJs)).toBe(false);
  });
});

describe("g-if-chain-branch-null §2 — runtime: hidden branches over null cells never crash", () => {
  beforeEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
    GlobalRegistrator.register();
  });
  afterEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing */ }
  });

  // Mount the page. `preset` runs AFTER the runtime/client eval but BEFORE the
  // DOMContentLoaded wiring, so the chosen active branch's cell is present at
  // mount (a VISIBLE branch over a null cell is the adopter's contract, not the
  // gate's job). Returns the crash diagnostics + a `set` handle for post-mount
  // flips.
  function mount(preset) {
    const { html, clientJs, runtimeJs } = compileCase();
    document.documentElement.innerHTML = html;
    const errs = [];
    const origErr = console.error;
    console.error = (...a) => { errs.push(a.join(" ")); };
    let threw = null;
    const exec = new Function("window", "document",
      `${runtimeJs}\n` + captureInsideChunkScope(clientJs, `globalThis.__set__ = (typeof _scrml_reactive_set!=='undefined')?_scrml_reactive_set:null;`));
    exec(window, document);
    if (preset) preset();
    try {
      document.dispatchEvent(new Event("DOMContentLoaded"));
    } catch (e) {
      threw = e;
    }
    console.error = origErr;
    const crashErrs = errs.filter((e) => /TypeError|Cannot read|of null|of undefined|ReferenceError|effect error/i.test(e));
    return { errs, crashErrs, threw };
  }

  const txt = (id) => { const el = document.querySelector(`#${id}`); return el ? el.textContent : null; };
  const disp = (id) => {
    const el = document.querySelector(`#${id}`);
    const w = el && el.closest("[data-scrml-chain-branch]");
    return w ? w.style.display : null;
  };

  test("(1) else active (z present), b0/b1 hidden over null x/y — NO crash, else renders", () => {
    const { threw, crashErrs } = mount(() => globalThis.__set__("z", { c: "C", meta: { deep: "D" } }));
    expect(threw).toBeNull();
    expect(crashErrs).toEqual([]);
    expect(disp("sz")).toBe("");           // else visible
    expect(txt("sz")).toBe("z: C");
    expect(txt("sznest")).toBe("nested: D");
    expect(disp("sx")).toBe("none");       // b0 hidden
    expect(txt("sx")).toBe("x: ");         // gated → empty, no crash
    expect(disp("sy")).toBe("none");       // b1 hidden
    expect(txt("sy")).toBe("y: ");
  });

  test("(2) b0 active (x present), b1/else hidden over null y/z — NO crash, b0 renders", () => {
    const { threw, crashErrs } = mount(() => globalThis.__set__("x", { a: "A" }));
    expect(threw).toBeNull();
    expect(crashErrs).toEqual([]);
    expect(disp("sx")).toBe("");
    expect(txt("sx")).toBe("x: A");
    expect(disp("sy")).toBe("none");
    expect(disp("sz")).toBe("none");
    expect(txt("sz")).toBe("z: ");         // hidden else over null z — gated, no crash
    expect(txt("sznest")).toBe("nested: ");
  });

  test("(3) flip b0 -> else: x null + z present re-renders the else, no crash", () => {
    mount(() => globalThis.__set__("x", { a: "A" }));
    const errs = [];
    const origErr = console.error;
    console.error = (...a) => errs.push(a.join(" "));
    let threw = null;
    try {
      globalThis.__set__("z", { c: "C2", meta: { deep: "D2" } });
      globalThis.__set__("x", null);
    } catch (e) { threw = e; }
    console.error = origErr;
    expect(threw).toBeNull();
    expect(errs.filter((e) => /TypeError|Cannot read|of null|of undefined/i.test(e))).toEqual([]);
    expect(disp("sx")).toBe("none");
    expect(disp("sz")).toBe("");
    expect(txt("sz")).toBe("z: C2");
    expect(txt("sznest")).toBe("nested: D2");
  });

  test("(4) flip else -> b1: y present (x still null) activates the else-if branch", () => {
    mount(() => globalThis.__set__("z", { c: "C", meta: { deep: "D" } }));
    globalThis.__set__("y", { b: "B" });
    expect(disp("sy")).toBe("");
    expect(txt("sy")).toBe("y: B");
    expect(disp("sz")).toBe("none");       // else now hidden
  });

  test("(adversarial) b0 -> else -> b1 -> else flip-flop, nested field, no crash throughout", () => {
    mount(() => globalThis.__set__("x", { a: "A0" }));
    const errs = [];
    const origErr = console.error;
    console.error = (...a) => errs.push(a.join(" "));
    let threw = null;
    try {
      // b0 active.
      expect(txt("sx")).toBe("x: A0");
      // -> else (x null, z present).
      globalThis.__set__("z", { c: "Z1", meta: { deep: "DEEP1" } });
      globalThis.__set__("x", null);
      expect(disp("sz")).toBe("");
      expect(txt("sz")).toBe("z: Z1");
      expect(txt("sznest")).toBe("nested: DEEP1");
      // -> b1 (y present, x null).
      globalThis.__set__("y", { b: "Y1" });
      expect(disp("sy")).toBe("");
      expect(txt("sy")).toBe("y: Y1");
      // -> back to else (y null again; z still present, updated).
      globalThis.__set__("z", { c: "Z2", meta: { deep: "DEEP2" } });
      globalThis.__set__("y", null);
      expect(disp("sz")).toBe("");
      expect(txt("sz")).toBe("z: Z2");
      expect(txt("sznest")).toBe("nested: DEEP2");
    } catch (e) { threw = e; }
    console.error = origErr;
    expect(threw).toBeNull();
    expect(errs.filter((e) => /TypeError|Cannot read|of null|of undefined/i.test(e))).toEqual([]);
  });

  test("(regression) the standalone single-`if=` and `show=` still work", () => {
    mount(() => globalThis.__set__("x", { a: "A" }));
    // single-if (`#ssingle`) is visible (x present) and rendered.
    expect(txt("ssingle")).toBe("single: A");
    // show= (`#smsg`) is hidden (@vis false) — its display-toggle div is
    // display:none — but its inner effect is NOT gated, so it still renders the
    // always-present @msg (the v-show keep-running regression).
    const showDiv = document.querySelector("#smsg").parentElement;
    expect(showDiv.style.display).toBe("none");
    expect(txt("smsg")).toBe("msg: always");
  });
});
