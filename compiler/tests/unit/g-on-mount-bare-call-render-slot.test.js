/**
 * ss15 item-2 (S214) — g-on-mount-bare-call-render-slot
 *
 * A bare expression in a DEFAULT-LOGIC body (the body of <program>/<page>/<channel>,
 * or the desugared body of `on mount {}`) is a mount EFFECT per SPEC §17.3 +
 * §6.7.1a: it runs once at initial mount and does NOT render its return as a text
 * node. The compiler previously allocated a spurious `<span data-scrml-logic>`
 * render slot + an addLogicBinding for such a node, so an async fn return surfaced
 * as a visible "[object Promise]" at page top.
 *
 * The fix is POSITIONAL (emit-html.ts DEFAULT_LOGIC_MODE_TAGS guard): a logic node
 * whose enclosing markup parent is <program>/<page>/<channel> (or which sits at the
 * file top-level) is an effect — NO render slot, NO addLogicBinding. A `${...}`
 * logic node nested inside ANY OTHER markup element (<div>, <span>, component root)
 * is a markup-interpolation that DOES render — UNCHANGED (the regression guard).
 *
 * SPEC.md:10347 (normative): "the §40.8 default-logic auto-lift fires only at
 * <program>/<page>/<channel> direct-child roots, never inside nested markup."
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { generateHtml } from "../../src/codegen/emit-html.js";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

// HTML-only path — counts the render-slot placeholders the markup walker emits.
function compileHtml(source) {
  const bsResult = splitBlocks("/test/app.scrml", source);
  const tabResult = buildAST(bsResult);
  const htmlErrors = [];
  const html = generateHtml(tabResult.ast.nodes, htmlErrors, false, null, tabResult.ast);
  return { html, errors: htmlErrors };
}

function renderSlotCount(html) {
  return (html.match(/data-scrml-logic/g) || []).length;
}

// Full-pipeline path — produces client.js so we can assert render-wiring presence.
function compileClientJs(source, testName) {
  const tag = testName ?? `ss15-${++tmpCounter}`;
  const tmpDir = resolve(testDir, `_tmp_ss15_${tag}`);
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

describe("g-on-mount-bare-call-render-slot — default-logic bare-expr is an effect, not a render", () => {
  // ----- DEFAULT-LOGIC MODE: zero render slots (effect only) -----

  test("program-body bare call `${ val() }` emits ZERO render slot", () => {
    const { html } = compileHtml(`<program>
fn val() { return 42 }
\${ val() }
<div>hi</div>
</program>`);
    expect(renderSlotCount(html)).toBe(0);
    expect(html).toContain("<div>hi</div>");
    expect(html).not.toContain("data-scrml-logic");
  });

  test("`on mount { val() }` emits ZERO render slot", () => {
    const { html } = compileHtml(`<program>
<x> = 0
fn val() { return 42 }
on mount { val() }
<div>hi</div>
</program>`);
    expect(renderSlotCount(html)).toBe(0);
    expect(html).not.toContain("data-scrml-logic");
  });

  test("`on mount { @x = val() }` emits ZERO render slot (assignment still runs)", () => {
    const { html } = compileHtml(`<program>
<x> = 0
fn val() { return 42 }
on mount { @x = val() }
<div>hi</div>
</program>`);
    expect(renderSlotCount(html)).toBe(0);
  });

  test("`on mount { @x = 5 }` (pure assignment) emits ZERO render slot", () => {
    const { html } = compileHtml(`<program>
<x> = 0
on mount { @x = 5 }
<div>hi</div>
</program>`);
    expect(renderSlotCount(html)).toBe(0);
  });

  // ----- MARKUP-INTERPOLATION MODE: one render slot each (UNCHANGED — regression guard) -----

  test("markup interp `<div>${ val() }</div>` KEEPS its render slot", () => {
    const { html } = compileHtml(`<program>
fn val() { return 42 }
<div>\${ val() }</div>
</program>`);
    expect(renderSlotCount(html)).toBe(1);
    expect(html).toMatch(/<div><span data-scrml-logic="_scrml_logic_\d+"><\/span><\/div>/);
  });

  test("markup interp `<div>${ @count }</div>` KEEPS its render slot", () => {
    const { html } = compileHtml(`<program>
<count> = 3
<div>\${ @count }</div>
</program>`);
    expect(renderSlotCount(html)).toBe(1);
  });

  test("markup interp `<span>${ items.length }</span>` KEEPS its render slot", () => {
    const { html } = compileHtml(`<program>
const items = [1, 2, 3]
<span>\${ items.length }</span>
</program>`);
    expect(renderSlotCount(html)).toBe(1);
  });

  // ----- client.js wiring: effect call present, render_value absent (default-logic) -----

  test("`on mount { val() }` client.js emits the mount-effect call, ZERO _scrml_render_value", () => {
    const { clientJs } = compileClientJs(`<program>
<x> = 0
fn val() { return 42 }
on mount { val() }
<div>hi</div>
</program>`, "onmount-effect-no-render");
    expect(clientJs).toBeTruthy();
    // The desugared `on mount` body runs as a mount/file-scope effect.
    expect(clientJs).toMatch(/_scrml_val_\d+\(\);/);
    // It must NOT print its return through the reactive-display path.
    expect(clientJs).not.toContain("_scrml_render_value");
  });

  test("markup interp `<div>${ val() }</div>` client.js KEEPS _scrml_render_value (renders 42)", () => {
    const { clientJs } = compileClientJs(`<program>
fn val() { return 42 }
<div>\${ val() }</div>
</program>`, "markup-interp-renders");
    expect(clientJs).toBeTruthy();
    expect(clientJs).toContain("_scrml_render_value");
    expect(clientJs).toMatch(/_scrml_render_value\(el, _scrml_val_\d+\(\)\)/);
  });

  // ----- OVER-FIX GUARD: a default-logic lift-expr is NOT suppressed -----

  test("program-body `${ for/lift }` KEEPS its render slot (lift is not a bare-expr)", () => {
    // SPEC section 17.4 -- the Tier-0 `${ for (...) { lift <li/> } }` iteration
    // form is the canonical program-body iteration. A lift-expr is a DOM-
    // positioning target that renders in ANY context; the default-logic guard
    // must NOT suppress it (it suppresses only the spurious bare-expr slot).
    const { html } = compileHtml(`<program>
<items> = [1, 2, 3]
\${
  for (let item of @items) {
    lift <li>\${item}</li>
  }
}
</program>`);
    expect(renderSlotCount(html)).toBe(1);
  });

  test("program-body `${ for/lift }` client.js KEEPS the lift-target wiring", () => {
    const { clientJs } = compileClientJs(`<program>
\${ @items = [1, 2, 3] }
\${
  for (let item of @items) {
    lift <span>\${item}</span>
  }
}
</program>`, "default-logic-lift-keeps-wiring");
    expect(clientJs).toBeTruthy();
    expect(clientJs).toContain("_scrml_lift_target = document.querySelector(");
    expect(clientJs).toContain("_scrml_lift(");
  });
});
