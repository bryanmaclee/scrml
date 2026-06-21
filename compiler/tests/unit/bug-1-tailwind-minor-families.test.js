/**
 * bug-1-tailwind-minor-families.test.js — Bug 1 v2: extend arbitrary-value
 * CSS emission to the deferred minor families surfaced at S108 close.
 *
 * S108 close shipped FLOOR (W-TAILWIND-UNRECOGNIZED-CLASS lint) + FULL fix
 * for grid/flex/aspect families (compiler/tests/unit/bug-1-tailwind-arbitrary-value-emit.test.js).
 * This file covers the remaining minor families enumerated in
 * docs/known-gaps.md under Bug 1's "Remaining open":
 *   transition + duration + delay + ease — animation/transition shorthand
 *   rotate + scale + translate                    — modern individual transform CSS props
 *   outline + outline-offset                       — outline shorthand + offset
 *
 * Plus VALID_MATH_FUNCTIONS extensions:
 *   cubic-bezier + steps                          — transition-timing-function call shapes
 *   matrix + matrix3d + rotate3d + translate3d + scale3d + skew + skewx + skewy
 *                                                 — modern transform function call shapes
 *
 * Out of v2 scope at authoring; ring/shadow + gradient NOW LANDED (S191, §26.7):
 *   ring-* / ring-offset-* named (box-shadow compose)  — Phase 1
 *   bg-gradient-* / from-* / to-* / via-* (gradient compose) — Phase 2
 * Landed since (S210):
 *   font-* / content-*                            — string-shaped values (sub-arc 1)
 *   arbitrary ring-offset-[<len>] / [<color>]     — sub-arc 3
 * Still genuinely deferred:
 *   transform-* shorthand                         — needs transform-function-list validation
 *
 * Coverage:
 *   §1  transition shorthand + transition-* sub-properties
 *   §2  duration / delay + ms unit
 *   §3  ease + bare keyword + cubic-bezier() + steps()
 *   §4  rotate + deg unit
 *   §5  scale + bare number
 *   §6  translate + length list
 *   §7  outline shorthand (list) + outline-* sub-properties
 *   §8  outline-offset + length
 *   §9  lint regression — minor families no longer fire W-TAILWIND-UNRECOGNIZED-CLASS
 *   §10 still-deferred families STILL fire the lint (regression guard)
 */

import { describe, test, expect } from "bun:test";
import { getAllUsedCSS, findUnrecognizedClasses } from "../../src/tailwind-classes.js";

function cssFor(classNames) {
  return getAllUsedCSS(classNames.split(" "));
}

// ---------------------------------------------------------------------------
// §1: transition + transition-property sub-prop shorthand emission
// ---------------------------------------------------------------------------

describe("§1: transition shorthand", () => {
  test("transition-[opacity_0.5s] emits the shorthand declaration", () => {
    const css = cssFor("transition-[opacity_0.5s]");
    expect(css).toContain("transition: opacity 0.5s");
  });

  test("transition-[opacity_0.5s_ease-in-out] emits 3-part shorthand", () => {
    const css = cssFor("transition-[opacity_0.5s_ease-in-out]");
    expect(css).toContain("transition: opacity 0.5s ease-in-out");
  });
});

// ---------------------------------------------------------------------------
// §2: duration + delay (length-with-ms-unit)
// ---------------------------------------------------------------------------

describe("§2: duration + delay (ms unit)", () => {
  test("duration-[200ms] emits transition-duration: 200ms", () => {
    const css = cssFor("duration-[200ms]");
    expect(css).toContain("transition-duration: 200ms");
  });

  test("delay-[100ms] emits transition-delay: 100ms", () => {
    const css = cssFor("delay-[100ms]");
    expect(css).toContain("transition-delay: 100ms");
  });

  test("duration-[0.5s] emits transition-duration: 0.5s (s unit)", () => {
    const css = cssFor("duration-[0.5s]");
    expect(css).toContain("transition-duration: 0.5s");
  });
});

// ---------------------------------------------------------------------------
// §3: ease — keyword + cubic-bezier() + steps()
// ---------------------------------------------------------------------------

describe("§3: ease (transition-timing-function)", () => {
  test("ease-[ease-in-out] emits transition-timing-function: ease-in-out", () => {
    // Bare identifier `ease-in-out` is admitted via the generic ident branch
    // (treated as a CSS keyword/identifier value); CSS accepts it as the
    // transition-timing-function syntax.
    const css = cssFor("ease-[ease-in-out]");
    expect(css).toContain("transition-timing-function: ease-in-out");
  });

  test("ease-[linear] emits transition-timing-function: linear", () => {
    const css = cssFor("ease-[linear]");
    expect(css).toContain("transition-timing-function: linear");
  });

  test("ease-[cubic-bezier(0.4,0,0.2,1)] emits the function call as-is", () => {
    const css = cssFor("ease-[cubic-bezier(0.4,0,0.2,1)]");
    expect(css).toContain("transition-timing-function: cubic-bezier(0.4,0,0.2,1)");
  });

  test("ease-[steps(5,end)] emits the steps function call", () => {
    const css = cssFor("ease-[steps(5,end)]");
    expect(css).toContain("transition-timing-function: steps(5,end)");
  });
});

// ---------------------------------------------------------------------------
// §4: rotate (modern individual transform prop)
// ---------------------------------------------------------------------------

describe("§4: rotate", () => {
  test("rotate-[45deg] emits rotate: 45deg", () => {
    const css = cssFor("rotate-[45deg]");
    expect(css).toContain("rotate: 45deg");
  });

  test("rotate-[0.25turn] emits rotate: 0.25turn (turn unit)", () => {
    const css = cssFor("rotate-[0.25turn]");
    expect(css).toContain("rotate: 0.25turn");
  });
});

// ---------------------------------------------------------------------------
// §5: scale (bare number)
// ---------------------------------------------------------------------------

describe("§5: scale", () => {
  test("scale-[1.5] emits scale: 1.5", () => {
    const css = cssFor("scale-[1.5]");
    expect(css).toContain("scale: 1.5");
  });

  test("scale-[2] emits scale: 2 (integer)", () => {
    const css = cssFor("scale-[2]");
    expect(css).toContain("scale: 2");
  });
});

// ---------------------------------------------------------------------------
// §6: translate (length / length list)
// ---------------------------------------------------------------------------

describe("§6: translate", () => {
  test("translate-[10px] emits translate: 10px (single length)", () => {
    const css = cssFor("translate-[10px]");
    expect(css).toContain("translate: 10px");
  });

  test("translate-[10px_20px] emits translate: 10px 20px (length pair via underscore-as-space)", () => {
    const css = cssFor("translate-[10px_20px]");
    expect(css).toContain("translate: 10px 20px");
  });
});

// ---------------------------------------------------------------------------
// §7: outline shorthand (list) + outline-only forms
// ---------------------------------------------------------------------------

describe("§7: outline shorthand", () => {
  test("outline-[2px_solid_red] emits outline: 2px solid red (3-part list)", () => {
    const css = cssFor("outline-[2px_solid_red]");
    expect(css).toContain("outline: 2px solid red");
  });

  test("outline-[#ff0000] emits outline: #ff0000 (single color)", () => {
    const css = cssFor("outline-[#ff0000]");
    expect(css).toContain("outline: #ff0000");
  });
});

// ---------------------------------------------------------------------------
// §8: outline-offset
// ---------------------------------------------------------------------------

describe("§8: outline-offset", () => {
  test("outline-offset-[2px] emits outline-offset: 2px", () => {
    const css = cssFor("outline-offset-[2px]");
    expect(css).toContain("outline-offset: 2px");
  });

  test("outline-offset-[-4px] emits outline-offset: -4px (signed length)", () => {
    const css = cssFor("outline-offset-[-4px]");
    expect(css).toContain("outline-offset: -4px");
  });
});

// ---------------------------------------------------------------------------
// §9: lint regression — minor families no longer fire W-TAILWIND-UNRECOGNIZED-CLASS
// ---------------------------------------------------------------------------

describe("§9: lint regression — minor families now recognized (do NOT fire lint)", () => {
  test("transition-[opacity_0.5s] not in lintDiagnostics", () => {
    const src = `<div class="transition-[opacity_0.5s]">x</div>`;
    const lints = findUnrecognizedClasses(src);
    expect(lints).toEqual([]);
  });

  test("duration-[200ms] not in lintDiagnostics", () => {
    const src = `<div class="duration-[200ms]">x</div>`;
    const lints = findUnrecognizedClasses(src);
    expect(lints).toEqual([]);
  });

  test("ease-[cubic-bezier(0.4,0,0.2,1)] not in lintDiagnostics", () => {
    const src = `<div class="ease-[cubic-bezier(0.4,0,0.2,1)]">x</div>`;
    const lints = findUnrecognizedClasses(src);
    expect(lints).toEqual([]);
  });

  test("rotate-[45deg] / scale-[1.5] / translate-[10px_20px] not in lintDiagnostics", () => {
    const src = `<div class="rotate-[45deg] scale-[1.5] translate-[10px_20px]">x</div>`;
    const lints = findUnrecognizedClasses(src);
    expect(lints).toEqual([]);
  });

  test("outline-[2px_solid_red] + outline-offset-[2px] not in lintDiagnostics", () => {
    const src = `<div class="outline-[2px_solid_red] outline-offset-[2px]">x</div>`;
    const lints = findUnrecognizedClasses(src);
    expect(lints).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §10: still-deferred families STILL fire the lint
// ---------------------------------------------------------------------------

describe("§10: arbitrary ring-offset now recognized (S210); gradient from-[…] recognized (S191 Phase 2)", () => {
  // S109: ring-[length|color|var|keyword] ships via ARBITRARY_DECL_TRANSFORM
  // (see bug-1-tailwind-ring-family.test.js). S210 sub-arc 3: arbitrary
  // ring-offset-[<len>] / ring-offset-[<color>] now ship too, mirroring the
  // named ring-offset-{w}/{color} under the inline-fallback compose model
  // (no preflight layer — the prior "needs preflight" framing was incorrect).
  test("ring-offset-[2px] is now RECOGNIZED — no lint (S210 sub-arc 3)", () => {
    const src = `<div class="ring-offset-[2px]">x</div>`;
    const lints = findUnrecognizedClasses(src);
    expect(lints).toEqual([]);
  });

  test("bare skew-[45deg] (no axis) STILL fires the lint (no bare-skew utility)", () => {
    // Sanity control — a genuinely-unsupported arbitrary family still lints.
    const src = `<div class="skew-[45deg]">x</div>`;
    const lints = findUnrecognizedClasses(src);
    expect(lints.length).toBeGreaterThan(0);
    expect(lints[0].code).toBe("W-TAILWIND-UNRECOGNIZED-CLASS");
  });

  test("from-[#ff0000] is now RECOGNIZED — no lint (S191 Phase 2 gradient family landed)", () => {
    const src = `<div class="from-[#ff0000]">x</div>`;
    const lints = findUnrecognizedClasses(src);
    expect(lints).toEqual([]);
  });
});
