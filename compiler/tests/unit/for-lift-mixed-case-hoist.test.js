/**
 * Mixed-case for-lift hoist (follow-on to Bug 5)
 *
 * Previously: when a logic block combined a keyed-reconcile for-lift with
 * other reactive content (e.g. `if (@empty) { lift ... } for (let x of @items) ...`
 * in the same block), the outer `_scrml_effect` wrapped everything. Two
 * bugs stacked:
 *   (a) Wrapper div re-created on every outer-effect fire — list accumulation
 *       (same as Bug 5's pattern).
 *   (b) Conditional content re-lifted without `innerHTML=""` clear (because
 *       hasKeyedReconcile correctly skipped the clear to preserve the
 *       wrapper), so the conditional `<li>` accumulated too.
 *
 * Fix: hoist the for-lift's one-time setup (wrapper creation, createFn,
 * renderFn, first renderFn() call, `_scrml_effect_static(renderFn)`) outside
 * the outer `_scrml_effect`. The effect body retains `_scrml_lift(wrapper)`
 * which re-mounts the same wrapper node (appendChild MOVES it rather than
 * duplicating). With the wrapper hoisted, `TARGET.innerHTML = ""` is now
 * SAFE at the top of the effect — it clears TARGET (including conditional
 * content and detaches the wrapper), but the retained `_scrml_lift(wrapper)`
 * immediately re-mounts the wrapper with its reconciled children intact.
 * Result: both (a) and (b) fixed in one pass, order preserved, no DOM
 * accumulation.
 *
 * Runtime verification on the repro (`gauntlet-s79-counter-todo.scrml`-style):
 *  - effect_static re-reconciles wrapper on @items mutation.
 *  - outer effect re-fires on @items mutation (reads @todos.length): clears
 *    TARGET, re-lifts conditional (if empty) or not, re-lifts wrapper.
 *  - Net: TARGET has [EMPTY_LI_maybe, WRAPPER(items)], stable regardless of
 *    mutation count.
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compileSource(scrmlSource, testName) {
  const tag = testName ?? `mixed-${++tmpCounter}`;
  const tmpDir = resolve(testDir, `_tmp_mixed_${tag}`);
  const tmpInput = resolve(tmpDir, `${tag}.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, scrmlSource);
  try {
    const result = compileScrml({
      inputFiles: [tmpInput],
      write: false,
      outputDir: resolve(tmpDir, "out"),
    });
    let clientJs = null;
    for (const [fp, output] of result.outputs) {
      if (fp.includes(tag)) {
        clientJs = output.clientJs ?? null;
      }
    }
    return { errors: result.errors ?? [], clientJs };
  } finally {
    if (existsSync(tmpInput)) rmSync(tmpInput);
  }
}

const MIXED_CASE_SRC = `<program>
\${
  @todos = []
}
<ol>
  \${
    if (@todos.length == 0) {
      lift <li class="empty">none</li>
    }
    for (let t of @todos) {
      lift <li>\${t}</li>
    }
  }
</ol>
</program>`;

describe("Mixed-case for-lift hoist (follow-on Bug 5)", () => {
  test("wrapper creation is hoisted before _scrml_effect", () => {
    const { clientJs } = compileSource(MIXED_CASE_SRC, "wrapper-hoisted");
    const effectIdx = clientJs.indexOf("_scrml_effect(function()");
    const wrapperIdx = clientJs.indexOf("const _scrml_list_wrapper_");
    expect(effectIdx).toBeGreaterThan(-1);
    expect(wrapperIdx).toBeGreaterThan(-1);
    expect(wrapperIdx).toBeLessThan(effectIdx);
  });

  test("_scrml_effect_static registration is hoisted before _scrml_effect", () => {
    const { clientJs } = compileSource(MIXED_CASE_SRC, "static-hoisted");
    const effectIdx = clientJs.indexOf("_scrml_effect(function()");
    const staticIdx = clientJs.indexOf("_scrml_effect_static(");
    expect(staticIdx).toBeGreaterThan(-1);
    expect(staticIdx).toBeLessThan(effectIdx);
  });

  test("innerHTML clear restored inside effect (safe: wrapper re-mounts)", () => {
    const { clientJs } = compileSource(MIXED_CASE_SRC, "innerhtml-clear");
    const effectIdx = clientJs.indexOf("_scrml_effect(function()");
    const effectBody = clientJs.slice(effectIdx);
    expect(effectBody).toMatch(/_scrml_lift_tgt_\d+\.innerHTML = "";/);
  });

  test("effect body retains _scrml_lift(wrapper) for re-mount", () => {
    const { clientJs } = compileSource(MIXED_CASE_SRC, "wrapper-remount");
    const effectIdx = clientJs.indexOf("_scrml_effect(function()");
    const effectBody = clientJs.slice(effectIdx);
    expect(effectBody).toMatch(/_scrml_lift\(_scrml_list_wrapper_\d+\);/);
  });

  test("createFn and renderFn are hoisted outside effect", () => {
    const { clientJs } = compileSource(MIXED_CASE_SRC, "fns-hoisted");
    const effectIdx = clientJs.indexOf("_scrml_effect(function()");
    const createIdx = clientJs.indexOf("function _scrml_create_item_");
    const renderIdx = clientJs.indexOf("function _scrml_render_list_");
    expect(createIdx).toBeGreaterThan(-1);
    expect(renderIdx).toBeGreaterThan(-1);
    expect(createIdx).toBeLessThan(effectIdx);
    expect(renderIdx).toBeLessThan(effectIdx);
  });

  test("first render call is hoisted (so initial state reflects @items)", () => {
    const { clientJs } = compileSource(MIXED_CASE_SRC, "first-render");
    const effectIdx = clientJs.indexOf("_scrml_effect(function()");
    // `_scrml_render_list_N();` standalone call before the effect.
    const firstRenderRegex = /^_scrml_render_list_\d+\(\);$/m;
    const match = clientJs.slice(0, effectIdx).match(firstRenderRegex);
    expect(match).toBeTruthy();
  });

  test("wrapper is NOT re-created inside effect (regression guard for Bug 5 pattern)", () => {
    const { clientJs } = compileSource(MIXED_CASE_SRC, "no-recreation");
    const effectIdx = clientJs.indexOf("_scrml_effect(function()");
    const effectBody = clientJs.slice(effectIdx);
    // The effect body must NOT declare a fresh wrapper with document.createElement("div").
    // (It CAN contain _scrml_lift(wrapper) — that references the outer-scope const.)
    expect(effectBody).not.toMatch(/const _scrml_list_wrapper_\d+ = document\.createElement/);
  });

  test("_scrml_effect_static appears exactly once (no duplicate registrations)", () => {
    const { clientJs } = compileSource(MIXED_CASE_SRC, "static-once");
    const staticMatches = clientJs.match(/_scrml_effect_static\(_scrml_render_list_\d+\)/g) || [];
    expect(staticMatches.length).toBe(1);
  });

  test("conditional lift still INSIDE effect (reactive re-render on @empty change)", () => {
    const { clientJs } = compileSource(MIXED_CASE_SRC, "conditional-inside");
    const effectIdx = clientJs.indexOf("_scrml_effect(function()");
    const effectBody = clientJs.slice(effectIdx);
    // The `if (condition) { _scrml_lift(() => empty <li>) }` body must be
    // inside the effect so it re-runs on @empty changes. The MIXED_CASE_SRC
    // uses class="empty" and text "none" for the conditional <li>.
    expect(effectBody).toContain(`"class", "empty"`);
    expect(effectBody).toContain("none");
  });

  test("two independent for-lifts + conditional: both wrappers hoisted", () => {
    const src = `<program>
\${
  @xs = []
  @ys = []
  @show = true
}
<div>
  \${
    if (@show) { lift <p>header</p> }
    for (let x of @xs) { lift <span>\${x}</span> }
    for (let y of @ys) { lift <span>\${y}</span> }
  }
</div>
</program>`;
    const { clientJs } = compileSource(src, "two-fors-mixed");
    const effectIdx = clientJs.indexOf("_scrml_effect(function()");
    const wrapperMatches = clientJs.slice(0, effectIdx).match(/const _scrml_list_wrapper_\d+/g) || [];
    expect(wrapperMatches.length).toBe(2);
  });

  test("pure for-lift (no other reactive reads) remains on its own path, wrapper outside effect", () => {
    // Regression guard: the pure-case fix (Bug 5 original commit b37769c)
    // must continue to work — skip the outer effect entirely.
    const src = `<program>
\${
  @items = []
}
<ol>
  \${ for (let x of @items) { lift <li>\${x}</li> } }
</ol>
</program>`;
    const { clientJs } = compileSource(src, "pure-case-regression");
    const wrapperIdx = clientJs.indexOf("_scrml_list_wrapper_");
    const effectStaticIdx = clientJs.indexOf("_scrml_effect_static(");
    expect(wrapperIdx).toBeGreaterThan(-1);
    expect(effectStaticIdx).toBeGreaterThan(-1);
    // No outer effect that re-runs on reactive reads — only effect_static.
    const prefix = clientJs.slice(0, wrapperIdx);
    const lastTargetAssign = prefix.lastIndexOf("_scrml_lift_target = document.querySelector");
    expect(lastTargetAssign).toBeGreaterThan(-1);
    const between = prefix.slice(lastTargetAssign);
    const opens = (between.match(/_scrml_effect\(function\(\)/g) || []).length;
    expect(opens).toBe(0);
  });
});
