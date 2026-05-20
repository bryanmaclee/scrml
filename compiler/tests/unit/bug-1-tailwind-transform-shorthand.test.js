/**
 * bug-1-tailwind-transform-shorthand.test.js — Bug 1 v3: transform shorthand
 * + directional translate/scale/rotate/skew arbitrary-value support.
 *
 * S108 v3 follow-on to v1 (grid/flex/aspect) + v2 (transition/timing/individual
 * transforms/outline). This batch adds:
 *   - `transform-*` shorthand — `transform-[rotate(45deg)_scale(1.5)]` etc.
 *   - Directional translate / scale (modern CSS individual transform props)
 *   - Directional rotate / skew (transform shorthand — no standalone CSS prop)
 *
 * Out of v3 scope (still deferred):
 *   - `ring-*` / `ring-offset-*` (Tailwind compound — box-shadow stack)
 *   - `bg-gradient-*` / `from-*` / `to-*` / `via-*` (gradient compound)
 *   - `content-["..."]` / `font-[Inter]` (string-shaped values)
 *   - Safelist / `@apply` mechanism
 *
 * Coverage:
 *   §1  transform shorthand — single function call
 *   §2  transform shorthand — multi-function list (underscore-as-space)
 *   §3  transform shorthand — matrix() + matrix3d()
 *   §4  translate-x / translate-y (modern individual prop)
 *   §5  scale-x / scale-y (modern individual prop)
 *   §6  rotate-x / rotate-y / rotate-z (transform shorthand)
 *   §7  skew-x / skew-y (transform shorthand; no standalone CSS prop)
 *   §8  lint regression — v3 families no longer fire W-TAILWIND-UNRECOGNIZED-CLASS
 *   §9  still-deferred families STILL fire the lint
 */

import { describe, test, expect } from "bun:test";
import { getAllUsedCSS, findUnrecognizedClasses } from "../../src/tailwind-classes.js";

function cssFor(classNames) {
  return getAllUsedCSS(classNames.split(" "));
}

// ---------------------------------------------------------------------------
// §1: transform shorthand — single function call
// ---------------------------------------------------------------------------

describe("§1: transform shorthand — single function call", () => {
  test("transform-[rotate(45deg)] emits transform: rotate(45deg)", () => {
    const css = cssFor("transform-[rotate(45deg)]");
    expect(css).toContain("transform: rotate(45deg)");
  });

  test("transform-[scale(1.5)] emits transform: scale(1.5)", () => {
    const css = cssFor("transform-[scale(1.5)]");
    expect(css).toContain("transform: scale(1.5)");
  });

  test("transform-[skew(10deg)] emits transform: skew(10deg)", () => {
    const css = cssFor("transform-[skew(10deg)]");
    expect(css).toContain("transform: skew(10deg)");
  });
});

// ---------------------------------------------------------------------------
// §2: transform shorthand — multi-function list
// ---------------------------------------------------------------------------

describe("§2: transform shorthand — multi-function via underscore-as-space", () => {
  test("transform-[rotate(45deg)_scale(1.5)] emits both functions", () => {
    const css = cssFor("transform-[rotate(45deg)_scale(1.5)]");
    expect(css).toContain("transform: rotate(45deg) scale(1.5)");
  });

  test("transform-[translate(10px,_20px)_rotate(30deg)] handles paired call", () => {
    const css = cssFor("transform-[translate(10px,20px)_rotate(30deg)]");
    expect(css).toContain("transform: translate(10px,20px) rotate(30deg)");
  });
});

// ---------------------------------------------------------------------------
// §3: transform shorthand — matrix() + matrix3d()
// ---------------------------------------------------------------------------

describe("§3: transform shorthand — matrix functions", () => {
  test("transform-[matrix(1,0,0,1,0,0)] emits the identity matrix", () => {
    const css = cssFor("transform-[matrix(1,0,0,1,0,0)]");
    expect(css).toContain("transform: matrix(1,0,0,1,0,0)");
  });

  test("transform-[matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)] emits 3D identity", () => {
    const css = cssFor("transform-[matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)]");
    expect(css).toContain("transform: matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)");
  });
});

// ---------------------------------------------------------------------------
// §4: translate-x / translate-y (modern individual prop)
// ---------------------------------------------------------------------------

describe("§4: translate-x / translate-y", () => {
  test("translate-x-[10px] emits translate: 10px 0", () => {
    const css = cssFor("translate-x-[10px]");
    expect(css).toContain("translate: 10px 0");
  });

  test("translate-y-[20px] emits translate: 0 20px", () => {
    const css = cssFor("translate-y-[20px]");
    expect(css).toContain("translate: 0 20px");
  });

  test("translate-x-[-50%] emits translate: -50% 0 (signed length)", () => {
    const css = cssFor("translate-x-[-50%]");
    expect(css).toContain("translate: -50% 0");
  });
});

// ---------------------------------------------------------------------------
// §5: scale-x / scale-y (modern individual prop)
// ---------------------------------------------------------------------------

describe("§5: scale-x / scale-y", () => {
  test("scale-x-[1.5] emits scale: 1.5 1", () => {
    const css = cssFor("scale-x-[1.5]");
    expect(css).toContain("scale: 1.5 1");
  });

  test("scale-y-[2] emits scale: 1 2 (integer)", () => {
    const css = cssFor("scale-y-[2]");
    expect(css).toContain("scale: 1 2");
  });
});

// ---------------------------------------------------------------------------
// §6: rotate-x / rotate-y / rotate-z (transform shorthand)
// ---------------------------------------------------------------------------

describe("§6: rotate-x / rotate-y / rotate-z", () => {
  test("rotate-x-[45deg] emits transform: rotateX(45deg)", () => {
    const css = cssFor("rotate-x-[45deg]");
    expect(css).toContain("transform: rotateX(45deg)");
  });

  test("rotate-y-[90deg] emits transform: rotateY(90deg)", () => {
    const css = cssFor("rotate-y-[90deg]");
    expect(css).toContain("transform: rotateY(90deg)");
  });

  test("rotate-z-[180deg] emits transform: rotateZ(180deg)", () => {
    const css = cssFor("rotate-z-[180deg]");
    expect(css).toContain("transform: rotateZ(180deg)");
  });
});

// ---------------------------------------------------------------------------
// §7: skew-x / skew-y (transform shorthand)
// ---------------------------------------------------------------------------

describe("§7: skew-x / skew-y", () => {
  test("skew-x-[10deg] emits transform: skewX(10deg)", () => {
    const css = cssFor("skew-x-[10deg]");
    expect(css).toContain("transform: skewX(10deg)");
  });

  test("skew-y-[15deg] emits transform: skewY(15deg)", () => {
    const css = cssFor("skew-y-[15deg]");
    expect(css).toContain("transform: skewY(15deg)");
  });
});

// ---------------------------------------------------------------------------
// §8: lint regression — v3 families now recognized
// ---------------------------------------------------------------------------

describe("§8: lint regression — v3 families no longer fire W-TAILWIND-UNRECOGNIZED-CLASS", () => {
  test("transform-[rotate(45deg)_scale(1.5)] not in lintDiagnostics", () => {
    const src = `<div class="transform-[rotate(45deg)_scale(1.5)]">x</div>`;
    const lints = findUnrecognizedClasses(src);
    expect(lints).toEqual([]);
  });

  test("translate-x-[10px] / translate-y-[20px] not in lintDiagnostics", () => {
    const src = `<div class="translate-x-[10px] translate-y-[20px]">x</div>`;
    const lints = findUnrecognizedClasses(src);
    expect(lints).toEqual([]);
  });

  test("scale-x-[1.5] / scale-y-[2] / rotate-x-[45deg] / skew-x-[10deg] not in lintDiagnostics", () => {
    const src = `<div class="scale-x-[1.5] scale-y-[2] rotate-x-[45deg] skew-x-[10deg]">x</div>`;
    const lints = findUnrecognizedClasses(src);
    expect(lints).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §9: still-deferred families STILL fire the lint
// ---------------------------------------------------------------------------

describe("§9: still-deferred families STILL fire W-TAILWIND-UNRECOGNIZED-CLASS", () => {
  // S109 update: ring-[length] / ring-[color] / ring-[var()] / ring-[keyword]
  // now ship via ARBITRARY_DECL_TRANSFORM single-property emit (box-shadow
  // single-decl, ring-offset still deferred). See
  // `compiler/tests/unit/bug-1-tailwind-ring-family.test.js` for the
  // shipped surface. ring-offset-* remains deferred (needs preflight CSS).
  test("ring-offset-[2px] STILL fires the lint (Tailwind needs preflight `*, ::before, ::after` machinery)", () => {
    const src = `<div class="ring-offset-[2px]">x</div>`;
    const lints = findUnrecognizedClasses(src);
    expect(lints.length).toBeGreaterThan(0);
    expect(lints[0].code).toBe("W-TAILWIND-UNRECOGNIZED-CLASS");
  });

  test("from-[#ff0000] STILL fires the lint (gradient compound)", () => {
    const src = `<div class="from-[#ff0000]">x</div>`;
    const lints = findUnrecognizedClasses(src);
    expect(lints.length).toBeGreaterThan(0);
    expect(lints[0].code).toBe("W-TAILWIND-UNRECOGNIZED-CLASS");
  });

  test("font-[Inter] STILL fires the lint (string-shaped value; not yet supported)", () => {
    const src = `<div class="font-[Inter]">x</div>`;
    const lints = findUnrecognizedClasses(src);
    expect(lints.length).toBeGreaterThan(0);
    expect(lints[0].code).toBe("W-TAILWIND-UNRECOGNIZED-CLASS");
  });
});
