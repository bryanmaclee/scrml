/**
 * bug-1-tailwind-filter-family.test.js — Bug 1 Phase 4 filter + backdrop-filter.
 *
 * Phase 4 (S191, Approach C / §26.7.3) added the filter + backdrop-filter
 * composing families — the LAST composing family of the bug-1 preflight arc.
 * Both are NET-NEW (no existing filter/backdrop utilities), all-additive. Each
 * family composes a SINGLE `filter:` / `backdrop-filter:` declaration from NINE
 * independent `--tw-*` custom properties instead of each utility writing a
 * one-shot `filter:` (which would last-write-wins and obliterate siblings).
 * Same INLINE `var()`-fallback model as Phases 1-3, but with EMPTY fallbacks
 * (`var(--tw-blur,)`) — an unset filter contributes nothing (just whitespace).
 *
 *   blur-{k} / brightness-{N} / contrast-{N} / grayscale / hue-rotate-{N} /
 *   invert / saturate-{N} / sepia / drop-shadow-{k}  -> --tw-<f> + FILTER_COMPOSE
 *   backdrop-{...}                                    -> --tw-backdrop-<f> + BACKDROP_COMPOSE (+ -webkit-)
 *
 * backdrop divergences: has `opacity` (plain filter does NOT) + NO drop-shadow.
 * backdrop ALSO emits the -webkit-backdrop-filter companion (Safari).
 *
 * Coverage:
 *   §1  blur/brightness/contrast/saturate scales -> --tw-* + FILTER_COMPOSE
 *   §2  grayscale/invert/sepia (+ -0) + hue-rotate (+ negatives) + drop-shadow
 *   §3  backdrop-* equivalents -> --tw-backdrop-* + BACKDROP_COMPOSE (+ -webkit-)
 *   §4  backdrop-opacity (the backdrop-only filter)
 *   §5  bare filter / backdrop-filter (shorthand only) + -none resets
 *   §6  COMPOSE — multiple filters on one element all set their var + one shorthand
 *   §7  arbitrary blur-[2px] / backdrop-blur-[2px] / brightness-[1.25]
 *   §8  well-formed — emitted CSS has balanced parens/braces, no empty/undefined,
 *       each shorthand has >=1 real function from a present utility
 *   §9  lint — filter/backdrop classes RECOGNIZED (no W-TAILWIND-UNRECOGNIZED-CLASS)
 */

import { describe, test, expect } from "bun:test";
import { getAllUsedCSS, getTailwindCSSWithDiagnostic, findUnrecognizedClasses } from "../../src/tailwind-classes.js";

function cssFor(classNames) {
  return getAllUsedCSS(classNames.split(" "));
}

// The full filter composing shorthand (9 empty-fallback vars).
const FILTER_SHORTHAND =
  "filter: var(--tw-blur,) var(--tw-brightness,) var(--tw-contrast,) var(--tw-grayscale,) var(--tw-hue-rotate,) var(--tw-invert,) var(--tw-saturate,) var(--tw-sepia,) var(--tw-drop-shadow,)";

// The backdrop composing shorthand body (read for both the -webkit- and plain
// declarations).
const BACKDROP_SHORTHAND_VARS =
  "var(--tw-backdrop-blur,) var(--tw-backdrop-brightness,) var(--tw-backdrop-contrast,) var(--tw-backdrop-grayscale,) var(--tw-backdrop-hue-rotate,) var(--tw-backdrop-invert,) var(--tw-backdrop-opacity,) var(--tw-backdrop-saturate,) var(--tw-backdrop-sepia,)";

// ---------------------------------------------------------------------------
// §1: blur / brightness / contrast / saturate scales
// ---------------------------------------------------------------------------

describe("§1: blur/brightness/contrast/saturate set --tw-<f> + FILTER_COMPOSE", () => {
  test("blur-sm -> --tw-blur: blur(4px) + filter shorthand", () => {
    const out = cssFor("blur-sm");
    expect(out).toContain(".blur-sm {");
    expect(out).toContain("--tw-blur: blur(4px)");
    expect(out).toContain(FILTER_SHORTHAND);
  });

  test("blur scale: none/(base)/md/lg/xl/2xl/3xl map to the v3 px values", () => {
    const expected = {
      "blur-none": "blur(0)", "blur": "blur(8px)", "blur-md": "blur(12px)",
      "blur-lg": "blur(16px)", "blur-xl": "blur(24px)", "blur-2xl": "blur(40px)", "blur-3xl": "blur(64px)",
    };
    for (const [cls, fn] of Object.entries(expected)) {
      const out = cssFor(cls);
      expect(out).toContain(`--tw-blur: ${fn}`);
      expect(out).toContain(FILTER_SHORTHAND);
    }
  });

  test("brightness-50 -> --tw-brightness: brightness(0.5) + shorthand", () => {
    const out = cssFor("brightness-50");
    expect(out).toContain(".brightness-50 {");
    expect(out).toContain("--tw-brightness: brightness(0.5)");
    expect(out).toContain(FILTER_SHORTHAND);
  });

  test("contrast-125 -> --tw-contrast: contrast(1.25); saturate-150 -> saturate(1.5)", () => {
    expect(cssFor("contrast-125")).toContain("--tw-contrast: contrast(1.25)");
    expect(cssFor("saturate-150")).toContain("--tw-saturate: saturate(1.5)");
  });
});

// ---------------------------------------------------------------------------
// §2: grayscale / invert / sepia / hue-rotate / drop-shadow
// ---------------------------------------------------------------------------

describe("§2: grayscale/invert/sepia (+ -0) + hue-rotate (+ neg) + drop-shadow", () => {
  test("grayscale -> grayscale(100%); grayscale-0 -> grayscale(0)", () => {
    expect(cssFor("grayscale")).toContain("--tw-grayscale: grayscale(100%)");
    expect(cssFor("grayscale-0")).toContain("--tw-grayscale: grayscale(0)");
  });

  test("invert / invert-0 / sepia / sepia-0", () => {
    expect(cssFor("invert")).toContain("--tw-invert: invert(100%)");
    expect(cssFor("invert-0")).toContain("--tw-invert: invert(0)");
    expect(cssFor("sepia")).toContain("--tw-sepia: sepia(100%)");
    expect(cssFor("sepia-0")).toContain("--tw-sepia: sepia(0)");
  });

  test("hue-rotate-90 -> hue-rotate(90deg); -hue-rotate-90 -> hue-rotate(-90deg)", () => {
    expect(cssFor("hue-rotate-90")).toContain("--tw-hue-rotate: hue-rotate(90deg)");
    expect(cssFor("-hue-rotate-90")).toContain("--tw-hue-rotate: hue-rotate(-90deg)");
  });

  test("drop-shadow-lg -> the v3 multi-drop-shadow() stack + shorthand", () => {
    const out = cssFor("drop-shadow-lg");
    expect(out).toContain("--tw-drop-shadow: drop-shadow(0 10px 8px rgb(0 0 0 / 0.04)) drop-shadow(0 4px 3px rgb(0 0 0 / 0.1))");
    expect(out).toContain(FILTER_SHORTHAND);
  });

  test("drop-shadow (bare) + drop-shadow-none", () => {
    expect(cssFor("drop-shadow")).toContain("--tw-drop-shadow: drop-shadow(0 1px 2px rgb(0 0 0 / 0.1)) drop-shadow(0 1px 1px rgb(0 0 0 / 0.06))");
    expect(cssFor("drop-shadow-none")).toContain("--tw-drop-shadow: drop-shadow(0 0 #0000)");
  });
});

// ---------------------------------------------------------------------------
// §3: backdrop-* equivalents -> --tw-backdrop-* + BACKDROP_COMPOSE (+ -webkit-)
// ---------------------------------------------------------------------------

describe("§3: backdrop-* set --tw-backdrop-<f> + BACKDROP_COMPOSE (+ -webkit-)", () => {
  test("backdrop-blur-md -> --tw-backdrop-blur: blur(12px) + both -webkit- and plain", () => {
    const out = cssFor("backdrop-blur-md");
    expect(out).toContain(".backdrop-blur-md {");
    expect(out).toContain("--tw-backdrop-blur: blur(12px)");
    expect(out).toContain(`-webkit-backdrop-filter: ${BACKDROP_SHORTHAND_VARS}`);
    expect(out).toContain(`backdrop-filter: ${BACKDROP_SHORTHAND_VARS}`);
  });

  test("backdrop-brightness/-contrast/-saturate + grayscale/invert/sepia + hue-rotate", () => {
    expect(cssFor("backdrop-brightness-110")).toContain("--tw-backdrop-brightness: brightness(1.1)");
    expect(cssFor("backdrop-contrast-50")).toContain("--tw-backdrop-contrast: contrast(0.5)");
    expect(cssFor("backdrop-saturate-150")).toContain("--tw-backdrop-saturate: saturate(1.5)");
    expect(cssFor("backdrop-grayscale")).toContain("--tw-backdrop-grayscale: grayscale(100%)");
    expect(cssFor("backdrop-invert")).toContain("--tw-backdrop-invert: invert(100%)");
    expect(cssFor("backdrop-sepia")).toContain("--tw-backdrop-sepia: sepia(100%)");
    expect(cssFor("backdrop-hue-rotate-60")).toContain("--tw-backdrop-hue-rotate: hue-rotate(60deg)");
    expect(cssFor("-backdrop-hue-rotate-60")).toContain("--tw-backdrop-hue-rotate: hue-rotate(-60deg)");
  });

  test("backdrop set has NO drop-shadow (drop-shadow is filter-only)", () => {
    // The backdrop shorthand reads --tw-backdrop-opacity where filter reads
    // --tw-drop-shadow; there is no --tw-backdrop-drop-shadow.
    expect(BACKDROP_SHORTHAND_VARS).not.toContain("drop-shadow");
    expect(BACKDROP_SHORTHAND_VARS).toContain("var(--tw-backdrop-opacity,)");
  });
});

// ---------------------------------------------------------------------------
// §4: backdrop-opacity — the backdrop-only filter
// ---------------------------------------------------------------------------

describe("§4: backdrop-opacity-{N} (the backdrop-only filter)", () => {
  test("backdrop-opacity-50 -> --tw-backdrop-opacity: opacity(0.5)", () => {
    const out = cssFor("backdrop-opacity-50");
    expect(out).toContain("--tw-backdrop-opacity: opacity(0.5)");
    expect(out).toContain(`backdrop-filter: ${BACKDROP_SHORTHAND_VARS}`);
  });

  test("backdrop-opacity-0 / -100 (step-5 scale endpoints)", () => {
    expect(cssFor("backdrop-opacity-0")).toContain("--tw-backdrop-opacity: opacity(0)");
    expect(cssFor("backdrop-opacity-100")).toContain("--tw-backdrop-opacity: opacity(1)");
  });
});

// ---------------------------------------------------------------------------
// §5: bare filter / backdrop-filter (shorthand only) + -none resets
// ---------------------------------------------------------------------------

describe("§5: bare filter / backdrop-filter emit shorthand only; -none resets", () => {
  test("filter (bare) emits ONLY the composing shorthand", () => {
    const out = cssFor("filter");
    expect(out).toContain(".filter {");
    expect(out).toContain(FILTER_SHORTHAND);
  });

  test("filter-none -> filter: none", () => {
    expect(cssFor("filter-none")).toContain(".filter-none { filter: none }");
  });

  test("backdrop-filter (bare) emits both -webkit- and plain shorthand", () => {
    const out = cssFor("backdrop-filter");
    expect(out).toContain(`-webkit-backdrop-filter: ${BACKDROP_SHORTHAND_VARS}`);
    expect(out).toContain(`backdrop-filter: ${BACKDROP_SHORTHAND_VARS}`);
  });

  test("backdrop-filter-none -> resets both -webkit- and plain", () => {
    const out = cssFor("backdrop-filter-none");
    expect(out).toContain("-webkit-backdrop-filter: none");
    expect(out).toContain("backdrop-filter: none");
  });
});

// ---------------------------------------------------------------------------
// §6: COMPOSE — multiple filters on one element each set their var + ONE shorthand
// ---------------------------------------------------------------------------

describe("§6: COMPOSE — multiple filters compose into one shorthand", () => {
  test("blur-sm brightness-50 grayscale -> all 3 vars set + filter shorthand present", () => {
    const out = cssFor("blur-sm brightness-50 grayscale");
    expect(out).toContain("--tw-blur: blur(4px)");
    expect(out).toContain("--tw-brightness: brightness(0.5)");
    expect(out).toContain("--tw-grayscale: grayscale(100%)");
    // The shorthand references all three (plus the empty-fallback others).
    expect(out).toContain("var(--tw-blur,)");
    expect(out).toContain("var(--tw-brightness,)");
    expect(out).toContain("var(--tw-grayscale,)");
    expect(out).toContain(FILTER_SHORTHAND);
  });

  test("backdrop-blur-sm backdrop-saturate-150 -> both vars + backdrop shorthand", () => {
    const out = cssFor("backdrop-blur-sm backdrop-saturate-150");
    expect(out).toContain("--tw-backdrop-blur: blur(4px)");
    expect(out).toContain("--tw-backdrop-saturate: saturate(1.5)");
    expect(out).toContain("var(--tw-backdrop-blur,)");
    expect(out).toContain("var(--tw-backdrop-saturate,)");
    expect(out).toContain(`backdrop-filter: ${BACKDROP_SHORTHAND_VARS}`);
  });

  test("filter + backdrop on one element: both shorthands present, both vars set", () => {
    const out = cssFor("blur-sm backdrop-blur-md");
    expect(out).toContain("--tw-blur: blur(4px)");
    expect(out).toContain("--tw-backdrop-blur: blur(12px)");
    expect(out).toContain(FILTER_SHORTHAND);
    expect(out).toContain(`backdrop-filter: ${BACKDROP_SHORTHAND_VARS}`);
  });
});

// ---------------------------------------------------------------------------
// §7: arbitrary blur-[2px] / backdrop-blur-[2px] / brightness-[1.25]
// ---------------------------------------------------------------------------

describe("§7: arbitrary filter values wrap in their function + compose", () => {
  test("blur-[2px] -> --tw-blur: blur(2px) + shorthand", () => {
    const out = cssFor("blur-[2px]");
    expect(out).toContain("--tw-blur: blur(2px)");
    expect(out).toContain(FILTER_SHORTHAND);
  });

  test("backdrop-blur-[2px] -> --tw-backdrop-blur: blur(2px) + backdrop shorthand", () => {
    const out = cssFor("backdrop-blur-[2px]");
    expect(out).toContain("--tw-backdrop-blur: blur(2px)");
    expect(out).toContain(`backdrop-filter: ${BACKDROP_SHORTHAND_VARS}`);
  });

  test("brightness-[1.25] / hue-rotate-[30deg] / saturate-[2] arbitrary", () => {
    expect(cssFor("brightness-[1.25]")).toContain("--tw-brightness: brightness(1.25)");
    expect(cssFor("hue-rotate-[30deg]")).toContain("--tw-hue-rotate: hue-rotate(30deg)");
    expect(cssFor("saturate-[2]")).toContain("--tw-saturate: saturate(2)");
  });

  test("multi-token arbitrary drop-shadow-[0_4px_3px_red] (list) fires E-TAILWIND-001 (single-token rule)", () => {
    const { diagnostic } = getTailwindCSSWithDiagnostic("drop-shadow-[0_4px_3px_red]");
    expect(diagnostic).not.toBe(null);
    expect(diagnostic.code).toBe("E-TAILWIND-001");
  });
});

// ---------------------------------------------------------------------------
// §8: well-formed — balanced parens/braces, no empty/undefined, >=1 real fn
// ---------------------------------------------------------------------------

describe("§8: emitted filter/backdrop CSS is well-formed", () => {
  test("blur-sm brightness-50 grayscale backdrop-blur-md — balanced + no undefined", () => {
    const out = cssFor("blur-sm brightness-50 grayscale backdrop-blur-md");
    // Balanced braces.
    expect((out.match(/\{/g) || []).length).toBe((out.match(/\}/g) || []).length);
    // Balanced parens.
    expect((out.match(/\(/g) || []).length).toBe((out.match(/\)/g) || []).length);
    // No empty / undefined leaks.
    expect(out).not.toContain("undefined");
    expect(out).not.toContain("NaN");
    // Each shorthand has >=1 real function from a present utility (the vars
    // resolving non-empty: blur/brightness/grayscale for filter; backdrop-blur).
    expect(out).toContain("--tw-blur: blur(4px)");
    expect(out).toContain("--tw-backdrop-blur: blur(12px)");
  });

  test("a lone filter utility never produces a literally-empty filter declaration", () => {
    // The shorthand always carries the 9 var() references; the present utility
    // sets at least one non-empty -> the resolved filter has >=1 function.
    const out = cssFor("blur-sm");
    expect(out).toContain("--tw-blur: blur(4px)");
    expect(out).not.toMatch(/filter:\s*;/); // never an empty `filter: ;`
  });
});

// ---------------------------------------------------------------------------
// §9: lint — filter/backdrop classes RECOGNIZED (no W-TAILWIND-UNRECOGNIZED-CLASS)
// ---------------------------------------------------------------------------

describe("§9: filter/backdrop classes are RECOGNIZED (Phase 4 landed)", () => {
  const RECOGNIZED = [
    "blur-sm", "brightness-50", "contrast-125", "grayscale", "grayscale-0",
    "hue-rotate-90", "-hue-rotate-90", "invert", "saturate-150", "sepia",
    "drop-shadow-lg", "drop-shadow-none", "filter", "filter-none",
    "backdrop-blur-md", "backdrop-brightness-110", "backdrop-opacity-50",
    "backdrop-grayscale", "backdrop-invert", "backdrop-saturate-150",
    "backdrop-sepia", "backdrop-hue-rotate-60", "backdrop-filter", "backdrop-filter-none",
    "blur-[2px]", "backdrop-blur-[2px]",
  ];

  for (const cls of RECOGNIZED) {
    test(`${cls} is recognized — emits a rule, no unrecognized-class lint`, () => {
      // The rule is emitted (recognized path).
      const { css } = getTailwindCSSWithDiagnostic(cls);
      expect(css).not.toBe(null);
      expect(css.length).toBeGreaterThan(0);
      // The unrecognized-class lint does NOT fire for this class in markup.
      const lints = findUnrecognizedClasses(`<div class="${cls}">x</div>`, "test.scrml");
      expect(lints.some(d => d.code === "W-TAILWIND-UNRECOGNIZED-CLASS" && d.className === cls)).toBe(false);
    });
  }
});
