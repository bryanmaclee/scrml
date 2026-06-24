/**
 * g-onmount-async (S217) — a default-logic `on mount {}` (or any bare-expr) that
 * shares its `${...}` logic node with a sibling `lift-expr` must NOT be emitted
 * as a reactive DISPLAY SLOT. It is a fire-and-forget mount EFFECT (SPEC §17.3 +
 * §6.7.1a): it runs ONCE at mount and does NOT render its call's return.
 *
 * The S214 ss15 item-2 fix early-returns a default-logic bare-expr logic node
 * (no render slot) — UNLESS the node ALSO contains a `lift-expr`, in which case
 * the placeholder is legitimately kept for the lift. In that case the per-child
 * binding loop still registered the bare-expr as a logic-binding, so
 * emit-event-wiring.ts emitted `_scrml_render_value(el, boot())` (the call's
 * RETURN renders into the DOM — `[object Promise]` for an async/CPS call) plus,
 * when the body transitively reads a reactive cell, a re-running `_scrml_effect`
 * wrapper. This is the flogence-adopter shape (`function boot() { refresh() }` /
 * `on mount { boot() }` inside the big program-body `${...}` block).
 *
 * Fix (emit-html.ts binding loop): in default-logic mode, skip addLogicBinding
 * for a bare-expr child. The lift keeps its placeholder + lift-target wiring;
 * the bare-expr falls to the file-scope/mount-effect path (`boot();`).
 */

import { describe, test, expect } from "bun:test";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";

const testDir = dirname(new URL(import.meta.url).pathname);
let tmpCounter = 0;

function compileClientJs(source, testName) {
  const tag = testName ?? `g-onmount-async-${++tmpCounter}`;
  const tmpDir = resolve(testDir, `_tmp_onmount_async_${tag}`);
  const tmpInput = resolve(tmpDir, `${tag}.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: false, outputDir: resolve(tmpDir, "out") });
    let clientJs = null;
    for (const [fp, output] of result.outputs) {
      if (fp.includes(tag)) clientJs = output.clientJs ?? null;
    }
    return { errors: result.errors ?? [], clientJs };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

// on-mount as a STATEMENT inside a multi-statement ${} block that ALSO contains
// a lift-expr — the shape that forces placeholder allocation (bodyHasLift) and
// previously mis-registered the on-mount bare-expr as a render binding.
const NON_REACTIVE = `<program>
<items> = [1, 2, 3]
\${
  function boot() { return 99 }
  for (let x of @items) {
    lift <li>\${x}</li>
  }
  on mount { boot() }
}
</program>`;

// boot() transitively reads @items -> reactiveRefs non-empty -> the full smoking
// gun (render_value one-shot + a re-running _scrml_effect wrapper).
const REACTIVE = `<program>
<items> = [1, 2, 3]
\${
  function boot() { return @items.length }
  for (let x of @items) {
    lift <li>\${x}</li>
  }
  on mount { boot() }
}
</program>`;

describe("g-onmount-async — on-mount-in-${}-with-lift is an effect, not a display slot", () => {
  test("on-mount call is NOT rendered as a display slot (no _scrml_render_value of boot())", () => {
    const { clientJs } = compileClientJs(NON_REACTIVE, "non-reactive");
    expect(clientJs).toBeTruthy();
    // The smoking gun: the on-mount call's RETURN must NOT render into the DOM.
    expect(clientJs).not.toMatch(/_scrml_render_value\(el, _scrml_boot_\d+\(\)\)/);
  });

  test("the on-mount runs ONCE as a mount effect (`boot();` present, not effect-wrapped render)", () => {
    const { clientJs } = compileClientJs(NON_REACTIVE, "non-reactive-effect");
    expect(clientJs).toBeTruthy();
    expect(clientJs).toMatch(/_scrml_boot_\d+\(\);/);
  });

  test("the lift sibling KEEPS its placeholder + lift-target wiring (over-fix guard)", () => {
    const { clientJs } = compileClientJs(NON_REACTIVE, "non-reactive-lift");
    expect(clientJs).toBeTruthy();
    expect(clientJs).toContain("_scrml_lift_target = document.querySelector(");
    expect(clientJs).toContain("_scrml_lift(");
  });

  test("reactive on-mount body does NOT get a re-running _scrml_effect render wrapper (smoking gun)", () => {
    const { clientJs } = compileClientJs(REACTIVE, "reactive");
    expect(clientJs).toBeTruthy();
    // Neither the one-shot render nor the re-run effect may reference the on-mount call.
    expect(clientJs).not.toMatch(/_scrml_render_value\(el, _scrml_boot_\d+\(\)\)/);
    expect(clientJs).not.toMatch(/_scrml_effect\(function\(\) \{ _scrml_render_value\(el, _scrml_boot_\d+\(\)\); \}\)/);
    // It still runs once as a mount effect.
    expect(clientJs).toMatch(/_scrml_boot_\d+\(\);/);
  });

  test("a markup-interpolation `<div>${ boot() }</div>` STILL renders (regression guard — not default-logic)", () => {
    const { clientJs } = compileClientJs(`<program>
<items> = [1, 2, 3]
\${ function boot() { return 99 } }
<div>\${ boot() }</div>
</program>`, "markup-interp-renders");
    expect(clientJs).toBeTruthy();
    // Inside a real markup element, the interpolation renders — UNCHANGED.
    expect(clientJs).toMatch(/_scrml_render_value\(el, _scrml_boot_\d+\(\)\)/);
  });

  test("the desugared on-mount bare-expr carries the _onMountEffect marker (any context)", () => {
    // The marker is what makes the effect classification UNCONDITIONAL — it
    // fires even when the enclosing tag is "state" (the <program db=>/<db>
    // flogence shape), where inDefaultLogicMode is false.
    const src = `<program>
<items> = [1, 2, 3]
\${
  function boot() { return 99 }
  on mount { boot() }
}
</program>`;
    const tab = buildAST(splitBlocks("/test/app.scrml", src));
    let found = null;
    function walk(list) {
      for (const n of (list || [])) {
        if (!n) continue;
        if (n.kind === "bare-expr" && /boot/.test(n.expr || "")) found = n;
        if (Array.isArray(n.children)) walk(n.children);
        if (Array.isArray(n.body)) walk(n.body);
        if (Array.isArray(n.nodes)) walk(n.nodes);
      }
    }
    walk(tab.ast.nodes);
    expect(found).toBeTruthy();
    expect(found._onMountEffect).toBe(true);
  });
});
