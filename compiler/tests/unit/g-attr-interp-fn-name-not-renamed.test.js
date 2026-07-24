/**
 * g-attr-interp-fn-name-not-renamed.test.js
 *
 * Bug (HIGH, silent miscompile): a user `function` called inside an HTML
 * ATTRIBUTE-VALUE interpolation (`class="box box-${tag()}"`) emitted the BARE
 * user name `tag()` instead of the encoded generated name `_scrml_tag_N()`.
 * Compile-clean, runtime ReferenceError (`tag` is not defined; the real fn is
 * `_scrml_tag_N`).
 *
 * Root cause (code-segments.ts rewriteCodeSegments): the whole-buffer fn-name
 * mangle (emit-client.ts post-fn-name-mangle) runs through rewriteCodeSegments,
 * which fenced the rewrite OUT of every string-literal segment — INCLUDING the
 * backtick template literals the attr-interp path emits
 * (`setAttribute("class", `box box-${tag()}`)`). A template literal is a hybrid:
 * its static text is opaque string content, but its `${...}` interpolations are
 * CODE. The fence treated the WHOLE backtick literal as opaque, so the call
 * inside `${...}` was never mangled.
 *
 * Fix: rewriteCodeSegments now descends INTO template-literal `${...}`
 * interpolations (applying the transform to the interpolation code) while
 * keeping the static text + plain `"..."`/`'...'` strings opaque (preserving the
 * S144 Bug Z string-literal opacity fence).
 *
 * Contrast (all confirmed in the SAME file pre-fix):
 *   - textContent `${tag()}`   → CORRECTLY emitted `_scrml_tag_N()` (raw code position).
 *   - attr `@cell` `class="c-${@n}"` → CORRECTLY emitted `_scrml_reactive_get("n")`.
 *   - attr fn  `class="box box-${tag()}"` → WRONG, bare `tag()`.  ← this bug.
 *
 * VALUE-asserting (R26 / S138): synthesizing an AST would bypass the fnNameMap
 * whole-buffer post-pass that is the actual locus, so this compiles real .scrml
 * source end-to-end via compileScrml and asserts the emitted client.js SHAPE.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/g-attr-interp-fn-name");
const FIXTURE_OUTPUT = join(FIXTURE_DIR, "dist");

function fix(name, src) {
  const path = join(FIXTURE_DIR, name);
  writeFileSync(path, src);
  return path;
}

let attrFnFx, textAndCellFx, multiFx;

beforeAll(() => {
  mkdirSync(FIXTURE_DIR, { recursive: true });

  // Mirrors the PA reproducer tmp-ad.scrml.
  attrFnFx = fix("attr-fn.scrml", `<program>
\${
function tag() { return "hi" }
@n = 1
}
<div class="box box-\${tag()}">attr interp</div>
<p>\${tag()}</p>
<span class="c-\${@n}">cell interp in attr</span>
</program>
`);

  // A second fn used ONLY in an attr interp (no textContent use) — proves the
  // attr path mangles independently, not piggy-backing on a textContent site.
  textAndCellFx = fix("attr-only.scrml", `<program>
\${
function label() { return "x" }
}
<button class="btn btn-\${label()}">go</button>
</program>
`);

  // Two interpolated calls in one attr value → both must mangle.
  multiFx = fix("multi.scrml", `<program>
\${
function pre() { return "a" }
function post() { return "b" }
}
<div class="\${pre()}-mid-\${post()}">x</div>
</program>
`);
});

afterAll(() => {
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
});

function compile(path) {
  return compileScrml({ inputFiles: [path], outputDir: FIXTURE_OUTPUT, write: false });
}

// ---------------------------------------------------------------------------
// §1 — the attr-interp fn call is MANGLED to the generated name
// ---------------------------------------------------------------------------

describe("§1 attr-value interpolation mangles the user fn name", () => {
  test("compile succeeds", () => {
    const result = compile(attrFnFx);
    expect(result.errors).toEqual([]);
  });

  test("setAttribute class template literal uses the encoded fn name, NOT bare tag()", () => {
    const js = compile(attrFnFx).outputs.get(attrFnFx).clientJs;
    // The generated name shape is _scrml_tag_<N>.
    const setAttrLine = js.split("\n").find((l) => l.includes('setAttribute("class"') && l.includes("box-"));
    expect(setAttrLine).toBeDefined();
    // BUG ASSERTION: must NOT contain bare `tag()` inside the template literal.
    expect(setAttrLine).not.toMatch(/box-\$\{\s*tag\s*\(/);
    // POSITIVE: must contain the encoded form.
    expect(setAttrLine).toMatch(/box-\$\{_scrml_tag_\d+\(\)\}/);
  });

  test("textContent path still emits the encoded fn name (regression guard)", () => {
    const js = compile(attrFnFx).outputs.get(attrFnFx).clientJs;
    expect(js).toMatch(/_scrml_render_value\([^,]+,\s*_scrml_tag_\d+\(\)\)/);
  });

  test("the @cell attr interp still emits _scrml_reactive_get (regression guard)", () => {
    const js = compile(attrFnFx).outputs.get(attrFnFx).clientJs;
    expect(js).toMatch(/setAttribute\("class",\s*`c-\$\{_scrml_reactive_get\("n"\)\}`\)/);
  });

  test("emitted client.js is parseable", () => {
    const js = compile(attrFnFx).outputs.get(attrFnFx).clientJs;
    expect(() => new Function(js)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// §2 — fn used ONLY in an attr interp still mangles
// ---------------------------------------------------------------------------

describe("§2 fn referenced only in an attr interp", () => {
  test("attr-only fn call is mangled", () => {
    const result = compile(textAndCellFx);
    expect(result.errors).toEqual([]);
    const js = result.outputs.get(textAndCellFx).clientJs;
    const setAttrLine = js.split("\n").find((l) => l.includes('setAttribute("class"') && l.includes("btn-"));
    expect(setAttrLine).toBeDefined();
    expect(setAttrLine).not.toMatch(/btn-\$\{\s*label\s*\(/);
    expect(setAttrLine).toMatch(/btn-\$\{_scrml_label_\d+\(\)\}/);
    expect(() => new Function(js)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// §3 — two interpolated calls in one attr value both mangle
// ---------------------------------------------------------------------------

describe("§3 multiple interpolated calls in one attr value", () => {
  test("both calls mangle", () => {
    const result = compile(multiFx);
    expect(result.errors).toEqual([]);
    const js = result.outputs.get(multiFx).clientJs;
    const setAttrLine = js.split("\n").find((l) => l.includes('setAttribute("class"') && l.includes("-mid-"));
    expect(setAttrLine).toBeDefined();
    expect(setAttrLine).not.toMatch(/\$\{\s*pre\s*\(/);
    expect(setAttrLine).not.toMatch(/\$\{\s*post\s*\(/);
    expect(setAttrLine).toMatch(/_scrml_pre_\d+\(\)/);
    expect(setAttrLine).toMatch(/_scrml_post_\d+\(\)/);
    expect(() => new Function(js)).not.toThrow();
  });
});
