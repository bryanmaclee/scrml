/**
 * bug-1-tailwind-arbitrary-value-emit — S109 dogfood Bug 1 FULL fix
 *
 * Companion to `bug-1-tailwind-unrecognized-class.test.js` (S108 FLOOR
 * fix). The FLOOR shipped a lint that turned silent layout-breakage into
 * compile-time friction; the FULL fix here actually emits CSS for the
 * arbitrary-value classes whose prefix families were previously
 * unsupported, so the layout works without manual `#{}` CSS shims.
 *
 * Source: `handOffs/incoming/read/2026-05-19-0614-side-session-to-scrmlTS-PA-dogfood-bug-surface.md`
 * §"Bug 1". The headline case is `grid-cols-[auto_1fr_auto]` — every
 * modern Tailwind app reaches for these patterns.
 *
 * Families shipped in S109 dispatch (each gets a §):
 *   §1  grid-cols-[<list>]       -> grid-template-columns
 *   §2  grid-rows-[<list>]       -> grid-template-rows
 *   §3  col-span-[<int>]         -> grid-column: span N / span N
 *   §4  row-span-[<int>]         -> grid-row: span N / span N
 *   §5  col-start-/end-/row-start-/end-[<int>] -> grid-{column,row}-{start,end}
 *   §6  aspect-[<ratio>|<num>|<keyword>] -> aspect-ratio
 *   §7  flex-[<shorthand>]       -> flex (3-component shorthand)
 *   §8  grow-/shrink-/order-/basis-[<scalar>] -> flex-grow/shrink, order, flex-basis
 *
 * Cross-cutting:
 *   §9  Underscore-as-space convention applied universally
 *   §10 List-value validator rejects malformed segments
 *   §11 Variant prefix integration (md:/hover:/dark:/etc.) still works
 *   §12 Regression — FLOOR lint stops firing on now-handled classes
 *   §13 Regression — single-value behavior (w-[420px] etc.) unchanged
 *   §14 Regression — list-shape rejection on col-span / row-span
 *   §15 Function-arg support — repeat(), minmax(), fit-content()
 *
 * For deferred families (transition-, transform-, outline-, ring-, scale-,
 * translate-, rotate-, etc.) the FLOOR lint continues to fire and adopters
 * use the `#{}` CSS shim block until those families ship.
 */

import { describe, test, expect } from "bun:test";
import {
  getTailwindCSS,
  getTailwindCSSWithDiagnostic,
  findUnrecognizedClasses,
} from "../../src/tailwind-classes.js";

// ---------------------------------------------------------------------------
// §1 grid-cols-[<list>]
// ---------------------------------------------------------------------------

describe("§1 grid-cols-[<list>] arbitrary-value emit", () => {
  test("dogfood Bug 1 headline — grid-cols-[auto_1fr_auto]", () => {
    const css = getTailwindCSS("grid-cols-[auto_1fr_auto]");
    expect(css).toContain("grid-template-columns: auto 1fr auto");
  });

  test("grid-cols-[200px_1fr]", () => {
    expect(getTailwindCSS("grid-cols-[200px_1fr]"))
      .toContain("grid-template-columns: 200px 1fr");
  });

  test("grid-cols-[1fr_2fr_1fr]", () => {
    expect(getTailwindCSS("grid-cols-[1fr_2fr_1fr]"))
      .toContain("grid-template-columns: 1fr 2fr 1fr");
  });

  test("grid-cols-[repeat(3,1fr)] (function call)", () => {
    expect(getTailwindCSS("grid-cols-[repeat(3,1fr)]"))
      .toContain("grid-template-columns: repeat(3,1fr)");
  });

  test("grid-cols-[repeat(3,minmax(0,1fr))] (nested function)", () => {
    expect(getTailwindCSS("grid-cols-[repeat(3,minmax(0,1fr))]"))
      .toContain("grid-template-columns: repeat(3,minmax(0,1fr))");
  });

  test("grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] (list of functions + keyword)", () => {
    expect(getTailwindCSS("grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]"))
      .toContain("grid-template-columns: minmax(0,1fr) auto minmax(0,1fr)");
  });

  test("emitted selector is properly escaped (`.grid-cols-\\[auto_1fr_auto\\]`)", () => {
    const css = getTailwindCSS("grid-cols-[auto_1fr_auto]");
    expect(css).toContain(".grid-cols-\\[auto_1fr_auto\\]");
  });
});

// ---------------------------------------------------------------------------
// §2 grid-rows-[<list>]
// ---------------------------------------------------------------------------

describe("§2 grid-rows-[<list>] arbitrary-value emit", () => {
  test("grid-rows-[auto_1fr]", () => {
    expect(getTailwindCSS("grid-rows-[auto_1fr]"))
      .toContain("grid-template-rows: auto 1fr");
  });

  test("grid-rows-[100px_1fr_50px]", () => {
    expect(getTailwindCSS("grid-rows-[100px_1fr_50px]"))
      .toContain("grid-template-rows: 100px 1fr 50px");
  });

  test("grid-rows-[repeat(2,minmax(50px,1fr))] (nested function)", () => {
    expect(getTailwindCSS("grid-rows-[repeat(2,minmax(50px,1fr))]"))
      .toContain("grid-template-rows: repeat(2,minmax(50px,1fr))");
  });
});

// ---------------------------------------------------------------------------
// §3 col-span-[<int>] — special declaration transform
// ---------------------------------------------------------------------------

describe("§3 col-span-[<int>] — `grid-column: span N / span N`", () => {
  test("col-span-[2] emits `grid-column: span 2 / span 2`", () => {
    expect(getTailwindCSS("col-span-[2]"))
      .toContain("grid-column: span 2 / span 2");
  });

  test("col-span-[5] emits `grid-column: span 5 / span 5`", () => {
    expect(getTailwindCSS("col-span-[5]"))
      .toContain("grid-column: span 5 / span 5");
  });

  test("col-span-[12] (large value)", () => {
    expect(getTailwindCSS("col-span-[12]"))
      .toContain("grid-column: span 12 / span 12");
  });
});

// ---------------------------------------------------------------------------
// §4 row-span-[<int>] — special declaration transform
// ---------------------------------------------------------------------------

describe("§4 row-span-[<int>] — `grid-row: span N / span N`", () => {
  test("row-span-[2] emits `grid-row: span 2 / span 2`", () => {
    expect(getTailwindCSS("row-span-[2]"))
      .toContain("grid-row: span 2 / span 2");
  });

  test("row-span-[6] emits `grid-row: span 6 / span 6`", () => {
    expect(getTailwindCSS("row-span-[6]"))
      .toContain("grid-row: span 6 / span 6");
  });
});

// ---------------------------------------------------------------------------
// §5 col-start-/end-/row-start-/end-[<int>] — line numbers
// ---------------------------------------------------------------------------

describe("§5 grid-{column,row}-{start,end}", () => {
  test("col-start-[1]", () => {
    expect(getTailwindCSS("col-start-[1]"))
      .toContain("grid-column-start: 1");
  });

  test("col-end-[3]", () => {
    expect(getTailwindCSS("col-end-[3]"))
      .toContain("grid-column-end: 3");
  });

  test("row-start-[1]", () => {
    expect(getTailwindCSS("row-start-[1]"))
      .toContain("grid-row-start: 1");
  });

  test("row-end-[4]", () => {
    expect(getTailwindCSS("row-end-[4]"))
      .toContain("grid-row-end: 4");
  });

  test("col-end-[-1] (negative line number)", () => {
    // Per CSS spec, grid-column-end accepts negative integers for
    // counting from the end of the explicit grid.
    expect(getTailwindCSS("col-end-[-1]"))
      .toContain("grid-column-end: -1");
  });
});

// ---------------------------------------------------------------------------
// §6 aspect-[<ratio>|<num>|<keyword>]
// ---------------------------------------------------------------------------

describe("§6 aspect-ratio arbitrary-value emit", () => {
  test("aspect-[16/9] (ratio shape)", () => {
    expect(getTailwindCSS("aspect-[16/9]"))
      .toContain("aspect-ratio: 16/9");
  });

  test("aspect-[4/3]", () => {
    expect(getTailwindCSS("aspect-[4/3]"))
      .toContain("aspect-ratio: 4/3");
  });

  test("aspect-[1.5] (single number — CSS accepts unitless number)", () => {
    expect(getTailwindCSS("aspect-[1.5]"))
      .toContain("aspect-ratio: 1.5");
  });

  test("aspect-[auto] (keyword)", () => {
    expect(getTailwindCSS("aspect-[auto]"))
      .toContain("aspect-ratio: auto");
  });
});

// ---------------------------------------------------------------------------
// §7 flex-[<shorthand>] — 3-component flex shorthand
// ---------------------------------------------------------------------------

describe("§7 flex-[<shorthand>]", () => {
  test("flex-[1_1_0] emits `flex: 1 1 0`", () => {
    expect(getTailwindCSS("flex-[1_1_0]"))
      .toContain("flex: 1 1 0");
  });

  test("flex-[1_1_auto]", () => {
    expect(getTailwindCSS("flex-[1_1_auto]"))
      .toContain("flex: 1 1 auto");
  });

  test("flex-[2_1_50%]", () => {
    expect(getTailwindCSS("flex-[2_1_50%]"))
      .toContain("flex: 2 1 50%");
  });

  test("flex-[0_0_200px]", () => {
    expect(getTailwindCSS("flex-[0_0_200px]"))
      .toContain("flex: 0 0 200px");
  });
});

// ---------------------------------------------------------------------------
// §8 grow-/shrink-/order-/basis- scalar arbitrary values
// ---------------------------------------------------------------------------

describe("§8 Flex track scalars", () => {
  test("grow-[2]", () => {
    expect(getTailwindCSS("grow-[2]"))
      .toContain("flex-grow: 2");
  });

  test("shrink-[0]", () => {
    expect(getTailwindCSS("shrink-[0]"))
      .toContain("flex-shrink: 0");
  });

  test("order-[5]", () => {
    expect(getTailwindCSS("order-[5]"))
      .toContain("order: 5");
  });

  test("order-[-1] (negative for re-ordering)", () => {
    expect(getTailwindCSS("order-[-1]"))
      .toContain("order: -1");
  });

  test("basis-[16rem]", () => {
    expect(getTailwindCSS("basis-[16rem]"))
      .toContain("flex-basis: 16rem");
  });

  test("basis-[33.33%]", () => {
    expect(getTailwindCSS("basis-[33.33%]"))
      .toContain("flex-basis: 33.33%");
  });
});

// ---------------------------------------------------------------------------
// §9 Underscore-as-space — applied universally across the engine
// ---------------------------------------------------------------------------

describe("§9 Underscore-as-space convention applied universally", () => {
  test("m-[1rem_2rem] (multi-side margin shorthand)", () => {
    expect(getTailwindCSS("m-[1rem_2rem]"))
      .toContain("margin: 1rem 2rem");
  });

  test("p-[1rem_2rem_1rem_2rem] (4-side padding shorthand)", () => {
    expect(getTailwindCSS("p-[1rem_2rem_1rem_2rem]"))
      .toContain("padding: 1rem 2rem 1rem 2rem");
  });

  test("shadow-[0_2px_4px_rgba(0,0,0,0.1)] (multi-token box-shadow)", () => {
    expect(getTailwindCSS("shadow-[0_2px_4px_rgba(0,0,0,0.1)]"))
      .toContain("box-shadow: 0 2px 4px rgba(0,0,0,0.1)");
  });

  test("underscores INSIDE function parens are NOT split (function body intact)", () => {
    // `repeat(3,1fr)` contains no `_`, so the parens-aware splitter
    // returns the whole function as a single token. The outer-list
    // splitter operates only at depth 0.
    const css = getTailwindCSS("grid-cols-[repeat(3,1fr)_minmax(0,200px)]");
    expect(css).toContain("grid-template-columns: repeat(3,1fr) minmax(0,200px)");
  });
});

// ---------------------------------------------------------------------------
// §10 List-value validator — rejects malformed segments
// ---------------------------------------------------------------------------

describe("§10 List-value validator rejects malformed segments", () => {
  test("empty segment (leading `_`) -> E-TAILWIND-001", () => {
    const r = getTailwindCSSWithDiagnostic("grid-cols-[_auto]");
    expect(r.css).toBeNull();
    expect(r.diagnostic).not.toBeNull();
    expect(r.diagnostic.code).toBe("E-TAILWIND-001");
    expect(r.diagnostic.message).toContain("empty list segment");
  });

  test("empty segment (trailing `_`) -> E-TAILWIND-001", () => {
    const r = getTailwindCSSWithDiagnostic("grid-cols-[auto_]");
    expect(r.css).toBeNull();
    expect(r.diagnostic.code).toBe("E-TAILWIND-001");
  });

  test("empty segment (consecutive `__`) -> E-TAILWIND-001", () => {
    const r = getTailwindCSSWithDiagnostic("grid-cols-[auto__1fr]");
    expect(r.css).toBeNull();
    expect(r.diagnostic.code).toBe("E-TAILWIND-001");
  });

  test("invalid unit in a list segment -> E-TAILWIND-001 names the bad unit", () => {
    const r = getTailwindCSSWithDiagnostic("grid-cols-[auto_1foo]");
    expect(r.css).toBeNull();
    expect(r.diagnostic.code).toBe("E-TAILWIND-001");
    expect(r.diagnostic.message).toContain("invalid CSS unit");
  });

  test("CSS-injection vector in a list segment -> rejected", () => {
    const r = getTailwindCSSWithDiagnostic("grid-cols-[auto_1fr;color:red]");
    expect(r.css).toBeNull();
    expect(r.diagnostic.code).toBe("E-TAILWIND-001");
  });
});

// ---------------------------------------------------------------------------
// §11 Variant prefix integration (responsive / state / theme)
// ---------------------------------------------------------------------------

describe("§11 Variant prefix integration with new arbitrary-value families", () => {
  test("md:grid-cols-[auto_1fr_auto] wraps in @media", () => {
    const css = getTailwindCSS("md:grid-cols-[auto_1fr_auto]");
    expect(css).toContain("@media (min-width: 768px)");
    expect(css).toContain("grid-template-columns: auto 1fr auto");
  });

  test("hover:col-span-[2] applies :hover", () => {
    const css = getTailwindCSS("hover:col-span-[2]");
    expect(css).toContain(":hover");
    expect(css).toContain("grid-column: span 2 / span 2");
  });

  test("md:hover:grid-cols-[auto_1fr_auto] applies both", () => {
    const css = getTailwindCSS("md:hover:grid-cols-[auto_1fr_auto]");
    expect(css).toContain("@media (min-width: 768px)");
    expect(css).toContain(":hover");
    expect(css).toContain("grid-template-columns: auto 1fr auto");
  });

  test("dark:aspect-[16/9] applies dark-media query", () => {
    const css = getTailwindCSS("dark:aspect-[16/9]");
    expect(css).toContain("@media (prefers-color-scheme: dark)");
    expect(css).toContain("aspect-ratio: 16/9");
  });

  test("lg:flex-[1_1_0]", () => {
    const css = getTailwindCSS("lg:flex-[1_1_0]");
    expect(css).toContain("@media (min-width: 1024px)");
    expect(css).toContain("flex: 1 1 0");
  });
});

// ---------------------------------------------------------------------------
// §12 Regression — FLOOR lint stops firing on now-handled classes
// ---------------------------------------------------------------------------

describe("§12 W-TAILWIND-UNRECOGNIZED-CLASS lint sync — engine + lint single SoT", () => {
  test("`grid-cols-[auto_1fr_auto]` no longer triggers the FLOOR lint", () => {
    const diags = findUnrecognizedClasses('<div class="grid-cols-[auto_1fr_auto]"></div>');
    expect(diags).toHaveLength(0);
  });

  test("`col-span-[2]` no longer triggers", () => {
    const diags = findUnrecognizedClasses('<div class="col-span-[2]"></div>');
    expect(diags).toHaveLength(0);
  });

  test("`aspect-[16/9]` no longer triggers", () => {
    const diags = findUnrecognizedClasses('<div class="aspect-[16/9]"></div>');
    expect(diags).toHaveLength(0);
  });

  test("`flex-[1_1_0]` no longer triggers", () => {
    const diags = findUnrecognizedClasses('<div class="flex-[1_1_0]"></div>');
    expect(diags).toHaveLength(0);
  });

  test("still-unsupported family (`ring-offset-[2px]`) DOES trigger", () => {
    // Sanity check — the lint still works for families NOT shipped in this dispatch.
    // S108 v2 (Bug 1 minor families) added transition/duration/delay/ease + rotate/
    // scale/translate + outline + outline-offset. S109 (Bug 1 partial closure)
    // added `ring-[length|color|var|keyword]` via single-property box-shadow
    // emit. `ring-offset-*` and `bg-gradient-*` / `from-*` / `to-*` / `via-*`
    // remain deferred — they need preflight `*, ::before, ::after`
    // custom-property machinery scrml hasn't yet wired up.
    const diags = findUnrecognizedClasses('<div class="ring-offset-[2px]"></div>');
    expect(diags.length).toBeGreaterThan(0);
    expect(diags[0].code).toBe("W-TAILWIND-UNRECOGNIZED-CLASS");
  });
});

// ---------------------------------------------------------------------------
// §13 Regression — single-value behavior preserved
// ---------------------------------------------------------------------------

describe("§13 Single-value cases preserved (no regression from the list-shape branch)", () => {
  test("w-[420px] still emits width: 420px", () => {
    expect(getTailwindCSS("w-[420px]"))
      .toContain("width: 420px");
  });

  test("text-[clamp(1rem,2vw,1.5rem)] still emits font-size: clamp(...)", () => {
    expect(getTailwindCSS("text-[clamp(1rem,2vw,1.5rem)]"))
      .toContain("font-size: clamp(1rem,2vw,1.5rem)");
  });

  test("bg-[#1a1a1a] still emits background-color: #1a1a1a", () => {
    expect(getTailwindCSS("bg-[#1a1a1a]"))
      .toContain("background-color: #1a1a1a");
  });

  test("p-[1rem] still emits padding: 1rem", () => {
    expect(getTailwindCSS("p-[1rem]"))
      .toContain("padding: 1rem");
  });

  test("border-[2px] still emits border-width: 2px", () => {
    expect(getTailwindCSS("border-[2px]"))
      .toContain("border-width: 2px");
  });

  test("text-[#fff] still emits color: #fff (color overload)", () => {
    expect(getTailwindCSS("text-[#fff]"))
      .toContain("color: #fff");
  });
});

// ---------------------------------------------------------------------------
// §14 Regression — col-span / row-span reject list values
// ---------------------------------------------------------------------------

describe("§14 col-span / row-span reject list values (decl-transform is single-token)", () => {
  test("col-span-[1_2] -> E-TAILWIND-001", () => {
    // The decl-transform substitutes the value twice (`span N / span N`);
    // a list would expand to nonsense like `span 1 2 / span 1 2`.
    // Validator explicitly rejects to surface the misuse.
    const r = getTailwindCSSWithDiagnostic("col-span-[1_2]");
    expect(r.css).toBeNull();
    expect(r.diagnostic.code).toBe("E-TAILWIND-001");
    expect(r.diagnostic.message).toContain("single token");
  });

  test("row-span-[1_2] -> E-TAILWIND-001", () => {
    const r = getTailwindCSSWithDiagnostic("row-span-[1_2]");
    expect(r.css).toBeNull();
    expect(r.diagnostic.code).toBe("E-TAILWIND-001");
  });
});

// ---------------------------------------------------------------------------
// §15 Function-arg support — repeat(), minmax(), fit-content()
// ---------------------------------------------------------------------------

describe("§15 Grid-track function support — repeat/minmax/fit-content", () => {
  test("repeat() is accepted as a valid CSS function", () => {
    expect(getTailwindCSS("grid-cols-[repeat(4,1fr)]"))
      .toContain("grid-template-columns: repeat(4,1fr)");
  });

  test("minmax() is accepted", () => {
    expect(getTailwindCSS("grid-cols-[minmax(0,1fr)]"))
      .toContain("grid-template-columns: minmax(0,1fr)");
  });

  test("fit-content() is accepted", () => {
    expect(getTailwindCSS("grid-cols-[fit-content(50ch)]"))
      .toContain("grid-template-columns: fit-content(50ch)");
  });

  test("nested function calls work (minmax inside repeat)", () => {
    expect(getTailwindCSS("grid-cols-[repeat(auto-fit,minmax(100px,1fr))]"))
      .toContain("grid-template-columns: repeat(auto-fit,minmax(100px,1fr))");
  });

  test("truly unknown CSS function still rejected", () => {
    const r = getTailwindCSSWithDiagnostic("grid-cols-[notreal(1fr)]");
    expect(r.css).toBeNull();
    expect(r.diagnostic.code).toBe("E-TAILWIND-001");
    expect(r.diagnostic.message).toContain("unknown CSS function");
  });
});
