/**
 * bug-1-tailwind-transform-shorthand.test.js — Bug 1: transform shorthand
 * + directional translate/scale/rotate/skew utilities.
 *
 * S108 v3 baseline (grid/flex/aspect + transition/timing/individual transforms/
 * outline). S191 Phase 3 (§26.7) REWROTE the directional transform utilities to
 * the composing inline-fallback `--tw-*` var model:
 *
 *   - `transform-*` shorthand — `transform-[rotate(45deg)_scale(1.5)]` etc.
 *     (the FULL-SHORTHAND ESCAPE HATCH — the author wrote the whole transform,
 *     so it keeps its literal `transform:` emit; UNCHANGED by Phase 3).
 *   - Directional translate / scale / skew — BEHAVIOR CHANGE (S191 Phase 3):
 *     was modern individual CSS transform props (`translate-x-[v]` -> `translate:
 *     <v> 0`) which last-write-wins clobbered a sibling axis (the bug-1 blocker);
 *     NOW each sets ONE `--tw-*` var + emits the composing `transform:` shorthand
 *     so `translate-x-4 translate-y-2` composes BOTH axes.
 *   - 3D rotate (`rotate-x` / `rotate-y` / `rotate-z`) — STAYS literal `transform:
 *     rotateX(<v>)` (the 2D `--tw-*` model has no 3D-rotate var; escape hatch).
 *
 * Composing families landed under the same inline-fallback model (§26.7) —
 * ALL composing families are now complete:
 *   - `ring-*` / `ring-offset-*` named (box-shadow compose) — Phase 1
 *   - `bg-gradient-*` / `from-*` / `to-*` / `via-*` (gradient compose) — Phase 2
 *   - translate/scale/rotate/skew directional + named (transform compose) — Phase 3
 *   - filter / backdrop-filter families (§26.7.3) — Phase 4 (S191, NET-NEW)
 * Still genuinely deferred (separate bug-1 sub-items):
 *   - arbitrary `ring-offset-[<len>]` (no arbitrary-width offset utility)
 *   - `content-["..."]` / `font-[Inter]` (string-shaped values)
 *   - Safelist / `@apply` mechanism
 *
 * Coverage:
 *   §1  transform shorthand — single function call (escape hatch, literal)
 *   §2  transform shorthand — multi-function list (underscore-as-space)
 *   §3  transform shorthand — matrix() + matrix3d()
 *   §4  translate-x / translate-y (C-style --tw-* compose) [Phase 3 behavior change]
 *   §5  scale-x / scale-y (C-style --tw-* compose)         [Phase 3 behavior change]
 *   §6  rotate-x / rotate-y / rotate-z (3D — STAYS literal transform shorthand)
 *   §7  skew-x / skew-y (C-style --tw-* compose)           [Phase 3 behavior change]
 *   §8  named transform utilities (translate/scale/rotate/skew scale + negatives)
 *   §9  MULTI-AXIS COMPOSE — the bug-1 fix: two axes on one element compose
 *   §10 full-shorthand arbitrary STAYS literal (scale-[1.5]/translate-[10px] escape hatch)
 *   §11 lint regression — directional families no longer fire W-TAILWIND-UNRECOGNIZED-CLASS
 *   §12 still-deferred families STILL fire the lint
 */

import { describe, test, expect } from "bun:test";
import { getAllUsedCSS, findUnrecognizedClasses } from "../../src/tailwind-classes.js";

function cssFor(classNames) {
  return getAllUsedCSS(classNames.split(" "));
}

// The composing transform shorthand emitted by every directional utility.
const COMPOSE =
  "transform: translate(var(--tw-translate-x, 0), var(--tw-translate-y, 0)) rotate(var(--tw-rotate, 0)) skewX(var(--tw-skew-x, 0)) skewY(var(--tw-skew-y, 0)) scaleX(var(--tw-scale-x, 1)) scaleY(var(--tw-scale-y, 1))";

// ---------------------------------------------------------------------------
// §1: transform shorthand — single function call (escape hatch, literal)
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
// §4: translate-x / translate-y — C-style --tw-* compose (Phase 3 BEHAVIOR CHANGE)
//
// WAS (pre-S191): `translate-x-[10px]` -> `translate: 10px 0` (modern individual
// prop; two axes on one element last-write-wins clobbered). NOW each sets one
// `--tw-translate-{x,y}` var + emits the composing shorthand (the other axis
// resolves to its inline `0` fallback), so axes compose.
// ---------------------------------------------------------------------------

describe("§4: translate-x / translate-y — C-style --tw-* compose", () => {
  test("translate-x-[10px] sets --tw-translate-x + the composing shorthand", () => {
    const css = cssFor("translate-x-[10px]");
    expect(css).toContain("--tw-translate-x: 10px");
    expect(css).toContain(COMPOSE);
    expect(css).not.toContain("translate: 10px 0"); // old individual-prop form is gone
  });

  test("translate-y-[20px] sets --tw-translate-y + the composing shorthand", () => {
    const css = cssFor("translate-y-[20px]");
    expect(css).toContain("--tw-translate-y: 20px");
    expect(css).toContain(COMPOSE);
  });

  test("translate-x-[-50%] sets a signed --tw-translate-x", () => {
    const css = cssFor("translate-x-[-50%]");
    expect(css).toContain("--tw-translate-x: -50%");
    expect(css).toContain(COMPOSE);
  });
});

// ---------------------------------------------------------------------------
// §5: scale-x / scale-y — C-style --tw-* compose (Phase 3 BEHAVIOR CHANGE)
// ---------------------------------------------------------------------------

describe("§5: scale-x / scale-y — C-style --tw-* compose", () => {
  test("scale-x-[1.5] sets --tw-scale-x + the composing shorthand", () => {
    const css = cssFor("scale-x-[1.5]");
    expect(css).toContain("--tw-scale-x: 1.5");
    expect(css).toContain(COMPOSE);
    expect(css).not.toContain("scale: 1.5 1"); // old individual-prop form is gone
  });

  test("scale-y-[2] sets --tw-scale-y + the composing shorthand", () => {
    const css = cssFor("scale-y-[2]");
    expect(css).toContain("--tw-scale-y: 2");
    expect(css).toContain(COMPOSE);
  });
});

// ---------------------------------------------------------------------------
// §6: rotate-x / rotate-y / rotate-z (3D — STAYS literal transform shorthand)
//
// The 2D `--tw-*` transform model (Tailwind v3) has NO 3D-rotate var, so the
// 3D rotate utilities keep their self-contained `transform: rotateX(<v>)`
// single-property emit (the ESCAPE HATCH / 3D-EXCLUSION). A 2D rotate uses the
// named `rotate-{N}` / arbitrary `rotate-[<angle>]` form instead (§8 / §10).
// ---------------------------------------------------------------------------

describe("§6: rotate-x / rotate-y / rotate-z (3D — STAYS literal)", () => {
  test("rotate-x-[45deg] emits transform: rotateX(45deg) (literal escape hatch)", () => {
    const css = cssFor("rotate-x-[45deg]");
    expect(css).toContain("transform: rotateX(45deg)");
    expect(css).not.toContain("--tw-rotate"); // 3D does NOT route through the 2D var model
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
// §7: skew-x / skew-y — C-style --tw-* compose (Phase 3 BEHAVIOR CHANGE)
// ---------------------------------------------------------------------------

describe("§7: skew-x / skew-y — C-style --tw-* compose", () => {
  test("skew-x-[10deg] sets --tw-skew-x + the composing shorthand", () => {
    const css = cssFor("skew-x-[10deg]");
    expect(css).toContain("--tw-skew-x: 10deg");
    expect(css).toContain(COMPOSE);
    expect(css).not.toContain("transform: skewX(10deg)"); // old single-prop form is gone
  });

  test("skew-y-[15deg] sets --tw-skew-y + the composing shorthand", () => {
    const css = cssFor("skew-y-[15deg]");
    expect(css).toContain("--tw-skew-y: 15deg");
    expect(css).toContain(COMPOSE);
  });
});

// ---------------------------------------------------------------------------
// §8: named transform utilities (scale + negatives via leading-minus)
// ---------------------------------------------------------------------------

describe("§8: named transform utilities", () => {
  test("translate-x-4 sets --tw-translate-x: 1rem (spacing scale)", () => {
    const css = cssFor("translate-x-4");
    expect(css).toContain("--tw-translate-x: 1rem");
    expect(css).toContain(COMPOSE);
  });

  test("-translate-x-4 negates the spacing value (-1rem)", () => {
    const css = cssFor("-translate-x-4");
    expect(css).toContain("--tw-translate-x: -1rem");
    expect(css).toContain(COMPOSE);
  });

  test("scale-50 sets BOTH --tw-scale-x AND --tw-scale-y (bare = both axes)", () => {
    const css = cssFor("scale-50");
    expect(css).toContain("--tw-scale-x: .5");
    expect(css).toContain("--tw-scale-y: .5");
    expect(css).toContain(COMPOSE);
  });

  test("rotate-45 sets --tw-rotate: 45deg", () => {
    const css = cssFor("rotate-45");
    expect(css).toContain("--tw-rotate: 45deg");
    expect(css).toContain(COMPOSE);
  });

  test("-rotate-45 sets --tw-rotate: -45deg", () => {
    const css = cssFor("-rotate-45");
    expect(css).toContain("--tw-rotate: -45deg");
  });

  test("skew-x-6 sets --tw-skew-x: 6deg (named)", () => {
    const css = cssFor("skew-x-6");
    expect(css).toContain("--tw-skew-x: 6deg");
    expect(css).toContain(COMPOSE);
  });
});

// ---------------------------------------------------------------------------
// §9: MULTI-AXIS COMPOSE — the bug-1 fix
//
// Two directional utilities on ONE element each set their own --tw-* var; both
// rules apply to the same element and the shared `transform:` shorthand reads
// the composed vars, so ALL axes apply (not CSS last-write-wins). This is the
// blocker Phase 3 closes.
// ---------------------------------------------------------------------------

describe("§9: multi-axis compose (the bug-1 fix)", () => {
  test("translate-x-4 translate-y-2 — BOTH axis vars set in one CSS output", () => {
    const css = cssFor("translate-x-4 translate-y-2");
    expect(css).toContain("--tw-translate-x: 1rem");
    expect(css).toContain("--tw-translate-y: 0.5rem");
    expect(css).toContain(COMPOSE);
    // No colliding bare individual-prop `translate:` declaration.
    expect(css).not.toMatch(/[;{ ]translate: /);
  });

  test("scale-x-50 scale-y-75 — both scale axis vars set", () => {
    const css = cssFor("scale-x-50 scale-y-75");
    expect(css).toContain("--tw-scale-x: .5");
    expect(css).toContain("--tw-scale-y: .75");
    expect(css).not.toMatch(/[;{ ]scale: /);
  });

  test("rotate-45 translate-x-4 — rotate + translate compose", () => {
    const css = cssFor("rotate-45 translate-x-4");
    expect(css).toContain("--tw-rotate: 45deg");
    expect(css).toContain("--tw-translate-x: 1rem");
    expect(css).toContain(COMPOSE);
  });
});

// ---------------------------------------------------------------------------
// §10: full-shorthand arbitrary STAYS literal (escape hatch)
//
// `scale-[1.5]` / `translate-[10px]` / `rotate-[45deg]` are the FULL-SHORTHAND
// arbitrary forms — the author supplied the whole value, so they keep the
// literal modern individual-prop emit and do NOT route through the --tw-* model.
// ---------------------------------------------------------------------------

describe("§10: full-shorthand arbitrary stays literal (escape hatch)", () => {
  test("scale-[1.5] STAYS literal `scale: 1.5`", () => {
    const css = cssFor("scale-[1.5]");
    expect(css).toContain("scale: 1.5");
    expect(css).not.toContain("--tw-scale-x");
  });

  test("translate-[10px] STAYS literal `translate: 10px`", () => {
    const css = cssFor("translate-[10px]");
    expect(css).toContain("translate: 10px");
    expect(css).not.toContain("--tw-translate-x");
  });

  test("translate-[10px_20px] STAYS literal `translate: 10px 20px`", () => {
    const css = cssFor("translate-[10px_20px]");
    expect(css).toContain("translate: 10px 20px");
  });
});

// ---------------------------------------------------------------------------
// §11: lint regression — directional families now recognized
// ---------------------------------------------------------------------------

describe("§11: lint regression — directional families no longer fire W-TAILWIND-UNRECOGNIZED-CLASS", () => {
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

  test("named translate-x-4 / scale-50 / rotate-45 / skew-x-6 + negatives not in lintDiagnostics", () => {
    const src = `<div class="translate-x-4 scale-50 rotate-45 skew-x-6 -translate-y-2 -rotate-45">x</div>`;
    const lints = findUnrecognizedClasses(src);
    expect(lints).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §12: still-deferred families STILL fire the lint
// ---------------------------------------------------------------------------

describe("§12: gradient/transform-named now recognized (S191); still-deferred STILL fire", () => {
  test("ring-offset-[2px] STILL fires the lint (Tailwind needs preflight machinery)", () => {
    const src = `<div class="ring-offset-[2px]">x</div>`;
    const lints = findUnrecognizedClasses(src);
    expect(lints.length).toBeGreaterThan(0);
    expect(lints[0].code).toBe("W-TAILWIND-UNRECOGNIZED-CLASS");
  });

  test("from-[#ff0000] is RECOGNIZED — no lint (S191 Phase 2 gradient family landed)", () => {
    const src = `<div class="from-[#ff0000]">x</div>`;
    const lints = findUnrecognizedClasses(src);
    expect(lints).toEqual([]);
  });

  test("bare skew-[10deg] (no axis) STILL fires the lint (no bare-skew utility; use skew-x/skew-y)", () => {
    const src = `<div class="skew-[10deg]">x</div>`;
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
