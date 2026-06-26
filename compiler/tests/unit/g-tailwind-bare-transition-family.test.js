/**
 * g-tailwind-bare-transition-family.test.js — ss29 item 1 (flogence S14).
 *
 * COVERAGE GAP: the arbitrary-bracket transition forms (`transition-[…]`,
 * `duration-[200ms]`, `ease-[…]`, `delay-[100ms]`) already resolve via
 * ARBITRARY_PROP_MAP (see bug-1-tailwind-minor-families.test.js), but the
 * BARE + NAMED-SCALE forms (`transition`, `transition-colors`, `duration-200`,
 * `ease-in-out`, `delay-150`, …) had NO registry entry — they rendered NOTHING
 * and ghost-lint W-TAILWIND-UNRECOGNIZED-CLASS / W-TAILWIND-001.
 *
 * Fix = static-registry extension (`registerTransition()`), Tailwind v3 values.
 * The transition family is NOT a composing family — each utility writes a
 * DISTINCT CSS property (transition-property / -duration / -timing-function /
 * -delay), so the bare forms coexist on one element with no clobber and the
 * pre-existing bracket forms remain intact.
 *
 * Coverage:
 *   §1  transition-property variants (bare + all/colors/opacity/shadow/transform)
 *   §2  transition-none (property-only, no timing/duration)
 *   §3  duration-{N} scale
 *   §4  ease-{named} timing curves
 *   §5  delay-{N} scale
 *   §6  the arbitrary-bracket forms still coexist (regression guard)
 *   §7  lint regression — bare/named forms fire NO W-TAILWIND-UNRECOGNIZED-CLASS
 *   §8  lint regression — bare/named forms fire NO W-TAILWIND-001
 */

import { describe, test, expect } from "bun:test";
import {
  getTailwindCSS,
  getAllUsedCSS,
  findUnrecognizedClasses,
  findUnsupportedTailwindShapes,
} from "../../src/tailwind-classes.js";

function cssFor(classNames) {
  return getAllUsedCSS(classNames.split(" "));
}

// The Tailwind v3 default timing + duration shared by property-bearing forms.
const DEFAULT_TIMING =
  "transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); transition-duration: 150ms;";

// ---------------------------------------------------------------------------
// §1: transition-property variants
// ---------------------------------------------------------------------------

describe("§1: transition-property variants", () => {
  test("transition (bare) emits the full v3 property list + default timing", () => {
    const css = getTailwindCSS("transition");
    expect(css).toContain(
      "transition-property: color, background-color, border-color, text-decoration-color, fill, stroke, opacity, box-shadow, transform, filter, backdrop-filter;",
    );
    expect(css).toContain(DEFAULT_TIMING);
  });

  test("transition-all emits transition-property: all + default timing", () => {
    const css = getTailwindCSS("transition-all");
    expect(css).toContain("transition-property: all;");
    expect(css).toContain(DEFAULT_TIMING);
  });

  test("transition-colors emits the color/bg/border/decoration/fill/stroke list + default timing", () => {
    const css = getTailwindCSS("transition-colors");
    expect(css).toContain(
      "transition-property: color, background-color, border-color, text-decoration-color, fill, stroke;",
    );
    expect(css).toContain(DEFAULT_TIMING);
  });

  test("transition-opacity emits transition-property: opacity + default timing", () => {
    const css = getTailwindCSS("transition-opacity");
    expect(css).toContain("transition-property: opacity;");
    expect(css).toContain(DEFAULT_TIMING);
  });

  test("transition-shadow emits transition-property: box-shadow + default timing", () => {
    const css = getTailwindCSS("transition-shadow");
    expect(css).toContain("transition-property: box-shadow;");
    expect(css).toContain(DEFAULT_TIMING);
  });

  test("transition-transform emits transition-property: transform + default timing", () => {
    const css = getTailwindCSS("transition-transform");
    expect(css).toContain("transition-property: transform;");
    expect(css).toContain(DEFAULT_TIMING);
  });
});

// ---------------------------------------------------------------------------
// §2: transition-none — property only, NO timing/duration
// ---------------------------------------------------------------------------

describe("§2: transition-none", () => {
  test("transition-none emits transition-property: none and NO timing/duration", () => {
    const css = getTailwindCSS("transition-none");
    expect(css).toContain("transition-property: none;");
    expect(css).not.toContain("transition-duration");
    expect(css).not.toContain("transition-timing-function");
  });
});

// ---------------------------------------------------------------------------
// §3: duration-{N} scale
// ---------------------------------------------------------------------------

describe("§3: duration-{N} (ms scale)", () => {
  for (const n of ["75", "100", "150", "200", "300", "500", "700", "1000"]) {
    test(`duration-${n} emits transition-duration: ${n}ms`, () => {
      expect(getTailwindCSS(`duration-${n}`)).toContain(`transition-duration: ${n}ms;`);
    });
  }
});

// ---------------------------------------------------------------------------
// §4: ease-{named} timing curves
// ---------------------------------------------------------------------------

describe("§4: ease-{named} (transition-timing-function)", () => {
  test("ease-linear emits transition-timing-function: linear", () => {
    expect(getTailwindCSS("ease-linear")).toContain("transition-timing-function: linear;");
  });

  test("ease-in emits cubic-bezier(0.4, 0, 1, 1)", () => {
    expect(getTailwindCSS("ease-in")).toContain(
      "transition-timing-function: cubic-bezier(0.4, 0, 1, 1);",
    );
  });

  test("ease-out emits cubic-bezier(0, 0, 0.2, 1)", () => {
    expect(getTailwindCSS("ease-out")).toContain(
      "transition-timing-function: cubic-bezier(0, 0, 0.2, 1);",
    );
  });

  test("ease-in-out emits cubic-bezier(0.4, 0, 0.2, 1)", () => {
    expect(getTailwindCSS("ease-in-out")).toContain(
      "transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);",
    );
  });
});

// ---------------------------------------------------------------------------
// §5: delay-{N} scale
// ---------------------------------------------------------------------------

describe("§5: delay-{N} (ms scale)", () => {
  for (const n of ["75", "100", "150", "200", "300", "500", "700", "1000"]) {
    test(`delay-${n} emits transition-delay: ${n}ms`, () => {
      expect(getTailwindCSS(`delay-${n}`)).toContain(`transition-delay: ${n}ms;`);
    });
  }
});

// ---------------------------------------------------------------------------
// §6: the arbitrary-bracket forms still coexist (regression guard)
// ---------------------------------------------------------------------------

describe("§6: arbitrary-bracket forms still resolve (coexist with the named forms)", () => {
  test("transition-[opacity_0.5s] still emits the shorthand", () => {
    expect(cssFor("transition-[opacity_0.5s]")).toContain("transition: opacity 0.5s");
  });

  test("duration-[200ms] still emits transition-duration: 200ms", () => {
    expect(cssFor("duration-[200ms]")).toContain("transition-duration: 200ms");
  });

  test("ease-[linear] still emits transition-timing-function: linear", () => {
    expect(cssFor("ease-[linear]")).toContain("transition-timing-function: linear");
  });

  test("delay-[100ms] still emits transition-delay: 100ms", () => {
    expect(cssFor("delay-[100ms]")).toContain("transition-delay: 100ms");
  });
});

// ---------------------------------------------------------------------------
// §7: lint regression — bare/named forms fire NO W-TAILWIND-UNRECOGNIZED-CLASS
// ---------------------------------------------------------------------------

describe("§7: no W-TAILWIND-UNRECOGNIZED-CLASS on the bare/named forms", () => {
  test("the canonical bare-transition mix produces zero unrecognized-class lints", () => {
    const src = `<div class="transition transition-all transition-colors transition-opacity transition-shadow transition-transform transition-none duration-200 ease-in-out delay-150">x</div>`;
    expect(findUnrecognizedClasses(src)).toEqual([]);
  });

  test("each new utility individually produces zero unrecognized-class lints", () => {
    for (const cls of [
      "transition",
      "transition-all",
      "transition-colors",
      "duration-200",
      "ease-in-out",
      "delay-150",
    ]) {
      const lints = findUnrecognizedClasses(`<div class="${cls}">x</div>`);
      expect(lints).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// §8: lint regression — bare/named forms fire NO W-TAILWIND-001
// ---------------------------------------------------------------------------

describe("§8: no W-TAILWIND-001 on the bare/named forms", () => {
  test("the canonical bare-transition mix produces zero unsupported-shape lints", () => {
    const src = `<div class="transition transition-colors duration-200 ease-in-out delay-150">x</div>`;
    const shapes = findUnsupportedTailwindShapes(src);
    expect(shapes.filter((d) => d.code === "W-TAILWIND-001")).toEqual([]);
  });
});
