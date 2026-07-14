/**
 * emit-reactive-wiring — pure-keyed-reconcile skips outer _scrml_effect (Bug 5)
 *
 * Root cause: emit-reactive-wiring.ts unconditionally wraps any reactive-deps
 * lift group in `_scrml_effect(function() {...})`. For reactive for-lift
 * (`for (let x of @items) { lift <li>${x}</li> }`), the emitted body already
 * contains `_scrml_effect_static(renderFn)` which registers the render
 * function against `@items` on first run and re-reconciles in place on
 * mutation. The outer `_scrml_effect` wrap re-creates the list wrapper
 * div on every mutation, producing list accumulation — 6nz observed
 * 3 → 8 → 15 `<li>` children on sequential clicks.
 *
 * Fix: detect pure-keyed-reconcile blocks (combinedCode has
 * `_scrml_reconcile_list(` AND no other `_scrml_reactive_get(` outside the
 * reconcile call). For those, skip the outer `_scrml_effect` wrap and emit
 * the body directly with `_scrml_lift_target` set once.
 *
 * Mixed case (keyed reconcile + other reactive reads like
 * `if (@count == 0) { lift... }`) falls through to the general wrap —
 * preserves existing behavior. The mixed case has a pre-existing wrapper-
 * re-creation issue separate from Bug 5.
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compileSource(scrmlSource, testName) {
  const tag = testName ?? `bug5-${++tmpCounter}`;
  const tmpDir = resolve(testDir, `_tmp_bug5_${tag}`);
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

describe("for-lift no outer _scrml_effect (Bug 5)", () => {
  test("pure reactive for-lift emits wrapper outside any _scrml_effect", () => {
    const src = `<program>
\${
  @items = ["a", "b", "c"]
}
<ol>
  \${
    for (let x of @items) {
      lift <li>\${x}</li>
    }
  }
</ol>
</program>`;
    const { clientJs } = compileSource(src, "pure-for-lift");
    expect(clientJs).toBeTruthy();

    // The list wrapper creation should NOT appear inside an _scrml_effect wrap.
    const wrapperIdx = clientJs.indexOf("_scrml_list_wrapper_");
    expect(wrapperIdx).toBeGreaterThan(-1);

    // Between the last `_scrml_effect(function()` and the wrapper, there
    // should be a matching `});` close — i.e. the effect, if any, is closed.
    const prefix = clientJs.slice(0, wrapperIdx);
    const lastEffectOpen = prefix.lastIndexOf("_scrml_effect(function()");
    if (lastEffectOpen !== -1) {
      const between = prefix.slice(lastEffectOpen);
      const opens = (between.match(/_scrml_effect\(function\(\)/g) || []).length;
      const closes = (between.match(/\}\);/g) || []).length;
      expect(closes).toBeGreaterThanOrEqual(opens);
    }
  });

  test("pure for-lift still has _scrml_effect_static for re-reconciliation", () => {
    const src = `<program>
\${
  @items = [1, 2, 3]
}
<ol>
  \${ for (let x of @items) { lift <li>\${x}</li> } }
</ol>
</program>`;
    const { clientJs } = compileSource(src, "effect-static-kept");
    expect(clientJs).toContain("_scrml_effect_static(");
    expect(clientJs).toContain("_scrml_reconcile_list(");
  });

  test("pure for-lift has lift_target set once (not inside an effect)", () => {
    const src = `<program>
\${
  @items = [1, 2]
}
<ol>
  \${ for (let x of @items) { lift <li>\${x}</li> } }
</ol>
</program>`;
    const { clientJs } = compileSource(src, "lift-target-once");
    const wrapperIdx = clientJs.indexOf("_scrml_list_wrapper_");
    const prefix = clientJs.slice(0, wrapperIdx);
    const lastTargetAssign = prefix.lastIndexOf("_scrml_lift_target = document.querySelector");
    expect(lastTargetAssign).toBeGreaterThan(-1);
    const between = prefix.slice(lastTargetAssign);
    const opens = (between.match(/_scrml_effect\(function\(\)/g) || []).length;
    expect(opens).toBe(0);
  });

  test("mixed case (if + for-lift): outer _scrml_effect present, wrapper hoisted before it", () => {
    // Follow-on to Bug 5: the mixed case (keyed reconcile + other reactive
    // reads) still needs the outer _scrml_effect to re-render the conditional
    // content, but the for-lift's one-time setup (wrapper creation, render
    // function, static-effect registration) is hoisted BEFORE the effect.
    // The effect body retains `_scrml_lift(wrapper)` which re-mounts the
    // same wrapper node on each re-fire, preserving reconciled children.
    const src = `<program>
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
    const { clientJs } = compileSource(src, "mixed-if-for-lift");
    // Mixed case should still wrap in _scrml_effect (for the conditional content)
    expect(clientJs).toContain("_scrml_effect(function()");
    // Wrapper creation should now appear BEFORE the _scrml_effect opens (hoisted)
    const effectOpenIdx = clientJs.indexOf("_scrml_effect(function()");
    const wrapperIdx = clientJs.indexOf("_scrml_list_wrapper_");
    expect(effectOpenIdx).toBeGreaterThan(-1);
    expect(wrapperIdx).toBeGreaterThan(-1);
    expect(wrapperIdx).toBeLessThan(effectOpenIdx);
    // _scrml_effect_static must also be outside the outer effect.
    const staticIdx = clientJs.indexOf("_scrml_effect_static(");
    expect(staticIdx).toBeGreaterThan(-1);
    expect(staticIdx).toBeLessThan(effectOpenIdx);
    // The inner effect body should still contain _scrml_lift(wrapper) for re-mount.
    const effectBody = clientJs.slice(effectOpenIdx);
    expect(effectBody).toMatch(/_scrml_lift\(_scrml_list_wrapper_\d+\);/);
  });

  test("two independent pure for-lifts in the same logic block: no outer effect", () => {
    const src = `<program>
\${
  @xs = [1]
  @ys = [2]
}
<div>
  \${
    for (let x of @xs) { lift <span>\${x}</span> }
    for (let y of @ys) { lift <span>\${y}</span> }
  }
</div>
</program>`;
    const { clientJs } = compileSource(src, "two-for-lifts");
    const reconcileCount = (clientJs.match(/_scrml_reconcile_list\(/g) || []).length;
    expect(reconcileCount).toBe(2);
    // Check that no _scrml_effect wraps the final wrapper creation
    const lastWrapperIdx = clientJs.lastIndexOf("_scrml_list_wrapper_");
    const prefix = clientJs.slice(0, lastWrapperIdx);
    const lastTargetAssign = prefix.lastIndexOf("_scrml_lift_target = document.querySelector");
    expect(lastTargetAssign).toBeGreaterThan(-1);
    const between = prefix.slice(lastTargetAssign);
    const opens = (between.match(/_scrml_effect\(function\(\)/g) || []).length;
    expect(opens).toBe(0);
  });

  test("stripReconcileCalls helper handles balanced parens", () => {
    // Internal guard: when the reconcile call itself contains nested parens
    // (key function, create function args), the strip helper must consume the
    // entire call not just up to the first `)`. Compile a synthesized case
    // where this balance matters implicitly — the emitted reconcile always
    // has nested parens (the keyFn `(item, i) => item?.id !== undefined ? item.id : i`).
    const src = `<program>
\${
  @data = [{id: 1}, {id: 2}]
}
<ol>
  \${ for (let d of @data) { lift <li>\${d.id}</li> } }
</ol>
</program>`;
    const { clientJs } = compileSource(src, "balanced-parens");
    const wrapperIdx = clientJs.indexOf("_scrml_list_wrapper_");
    expect(wrapperIdx).toBeGreaterThan(-1);
    const prefix = clientJs.slice(0, wrapperIdx);
    const lastTargetAssign = prefix.lastIndexOf("_scrml_lift_target = document.querySelector");
    expect(lastTargetAssign).toBeGreaterThan(-1);
    const between = prefix.slice(lastTargetAssign);
    const opens = (between.match(/_scrml_effect\(function\(\)/g) || []).length;
    expect(opens).toBe(0);
  });
});
