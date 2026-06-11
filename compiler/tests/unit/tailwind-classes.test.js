/**
 * Tailwind Utility Classes — Unit Tests
 *
 * Tests for src/tailwind-classes.js (SPEC §26).
 *
 * Coverage:
 *   §1  Known utility classes produce correct CSS
 *   §2  Unknown classes return null / are ignored
 *   §3  getAllUsedCSS combines multiple classes
 *   §4  Spacing utilities (padding, margin)
 *   §5  Sizing utilities (width, height)
 *   §6  Flexbox utilities
 *   §7  Grid utilities
 *   §8  Typography utilities
 *   §9  Color utilities (text-*, bg-*)
 *   §10 Border utilities
 *   §11 Effect utilities (shadow, opacity)
 *   §12 Layout utilities (display, position, overflow, z-index)
 *   §13 Responsive prefixes (sm:, md:, lg:, xl:, 2xl:)
 *   §14 State prefixes (hover:, focus:, active:, disabled:)
 *   §15 Combined responsive + state prefixes
 *   §16 scanClassesFromHtml extracts class names
 *   §17 Deduplication in getAllUsedCSS
 *   §18 Edge cases (null, empty, undefined)
 *   §19 Arbitrary values: utility-[<value>] (per §26.4)
 */

import { describe, test, expect } from "bun:test";
import { getTailwindCSS, getTailwindCSSWithDiagnostic, getAllUsedCSS, getAllUsedCSSWithDiagnostics, scanClassesFromHtml, findUnrecognizedClasses, findUnsupportedTailwindShapes } from "../../src/tailwind-classes.js";

// ---------------------------------------------------------------------------
// §1 Known utility classes produce correct CSS
// ---------------------------------------------------------------------------

describe("§1 Known utility classes", () => {
  test("p-4 produces correct padding rule", () => {
    const css = getTailwindCSS("p-4");
    expect(css).toContain("padding: 1rem");
    expect(css).toContain(".p-4");
  });

  test("m-2 produces correct margin rule", () => {
    const css = getTailwindCSS("m-2");
    expect(css).toContain("margin: 0.5rem");
  });

  test("flex produces display: flex", () => {
    const css = getTailwindCSS("flex");
    expect(css).toContain("display: flex");
  });

  test("text-center produces text-align: center", () => {
    const css = getTailwindCSS("text-center");
    expect(css).toContain("text-align: center");
  });

  test("hidden produces display: none", () => {
    const css = getTailwindCSS("hidden");
    expect(css).toContain("display: none");
  });
});

// ---------------------------------------------------------------------------
// §2 Unknown classes return null / are ignored
// ---------------------------------------------------------------------------

describe("§2 Unknown classes", () => {
  test("unknown class returns null", () => {
    expect(getTailwindCSS("not-a-tailwind-class")).toBeNull();
  });

  test("arbitrary class returns null", () => {
    expect(getTailwindCSS("my-custom-class")).toBeNull();
  });

  test("empty string returns null", () => {
    expect(getTailwindCSS("")).toBeNull();
  });

  test("getAllUsedCSS ignores unknown classes", () => {
    const css = getAllUsedCSS(["p-4", "not-real", "flex"]);
    expect(css).toContain("padding: 1rem");
    expect(css).toContain("display: flex");
    expect(css).not.toContain("not-real");
  });
});

// ---------------------------------------------------------------------------
// §3 getAllUsedCSS combines multiple classes
// ---------------------------------------------------------------------------

describe("§3 getAllUsedCSS", () => {
  test("combines multiple classes into one CSS string", () => {
    const css = getAllUsedCSS(["p-4", "m-2", "flex"]);
    expect(css).toContain("padding: 1rem");
    expect(css).toContain("margin: 0.5rem");
    expect(css).toContain("display: flex");
  });

  test("empty array returns empty string", () => {
    expect(getAllUsedCSS([])).toBe("");
  });

  test("all unknown classes returns empty string", () => {
    expect(getAllUsedCSS(["foo", "bar", "baz"])).toBe("");
  });
});

// ---------------------------------------------------------------------------
// §4 Spacing utilities
// ---------------------------------------------------------------------------

describe("§4 Spacing utilities", () => {
  test("p-0 through p-12", () => {
    expect(getTailwindCSS("p-0")).toContain("padding: 0px");
    expect(getTailwindCSS("p-1")).toContain("padding: 0.25rem");
    expect(getTailwindCSS("p-8")).toContain("padding: 2rem");
    expect(getTailwindCSS("p-12")).toContain("padding: 3rem");
  });

  test("px-* sets left and right padding", () => {
    const css = getTailwindCSS("px-4");
    expect(css).toContain("padding-left: 1rem");
    expect(css).toContain("padding-right: 1rem");
  });

  test("py-* sets top and bottom padding", () => {
    const css = getTailwindCSS("py-2");
    expect(css).toContain("padding-top: 0.5rem");
    expect(css).toContain("padding-bottom: 0.5rem");
  });

  test("pt/pr/pb/pl individual sides", () => {
    expect(getTailwindCSS("pt-4")).toContain("padding-top: 1rem");
    expect(getTailwindCSS("pr-4")).toContain("padding-right: 1rem");
    expect(getTailwindCSS("pb-4")).toContain("padding-bottom: 1rem");
    expect(getTailwindCSS("pl-4")).toContain("padding-left: 1rem");
  });

  test("m-0 through m-12", () => {
    expect(getTailwindCSS("m-0")).toContain("margin: 0px");
    expect(getTailwindCSS("m-4")).toContain("margin: 1rem");
    expect(getTailwindCSS("m-12")).toContain("margin: 3rem");
  });

  test("mx-auto", () => {
    const css = getTailwindCSS("mx-auto");
    expect(css).toContain("margin-left: auto");
    expect(css).toContain("margin-right: auto");
  });

  test("my-* sets top and bottom margin", () => {
    const css = getTailwindCSS("my-6");
    expect(css).toContain("margin-top: 1.5rem");
    expect(css).toContain("margin-bottom: 1.5rem");
  });

  test("mt/mr/mb/ml individual sides", () => {
    expect(getTailwindCSS("mt-2")).toContain("margin-top: 0.5rem");
    expect(getTailwindCSS("mr-2")).toContain("margin-right: 0.5rem");
    expect(getTailwindCSS("mb-2")).toContain("margin-bottom: 0.5rem");
    expect(getTailwindCSS("ml-2")).toContain("margin-left: 0.5rem");
  });

  test("space-x-* and space-y-*", () => {
    expect(getTailwindCSS("space-x-4")).toContain("margin-left: 1rem");
    expect(getTailwindCSS("space-y-2")).toContain("margin-top: 0.5rem");
  });
});

// ---------------------------------------------------------------------------
// §5 Sizing utilities
// ---------------------------------------------------------------------------

describe("§5 Sizing utilities", () => {
  test.each([
    ["w-0", "width: 0px"],
    ["w-4", "width: 1rem"],
    ["w-full", "width: 100%"],
    ["w-screen", "width: 100vw"],
    ["w-auto", "width: auto"],
  ])("%s produces correct width", (cls, expected) => {
    expect(getTailwindCSS(cls)).toContain(expected);
  });

  test("h-* height values", () => {
    expect(getTailwindCSS("h-0")).toContain("height: 0px");
    expect(getTailwindCSS("h-8")).toContain("height: 2rem");
    expect(getTailwindCSS("h-full")).toContain("height: 100%");
    expect(getTailwindCSS("h-screen")).toContain("height: 100vh");
  });

  test("min-w-*, max-w-*", () => {
    expect(getTailwindCSS("min-w-0")).toContain("min-width: 0px");
    expect(getTailwindCSS("max-w-lg")).toContain("max-width: 32rem");
    expect(getTailwindCSS("max-w-full")).toContain("max-width: 100%");
  });

  test("min-h-*, max-h-*", () => {
    expect(getTailwindCSS("min-h-0")).toContain("min-height: 0px");
    expect(getTailwindCSS("min-h-screen")).toContain("min-height: 100vh");
    expect(getTailwindCSS("max-h-full")).toContain("max-height: 100%");
  });
});

// ---------------------------------------------------------------------------
// §6 Flexbox utilities
// ---------------------------------------------------------------------------

describe("§6 Flexbox utilities", () => {
  test("flex display", () => {
    expect(getTailwindCSS("flex")).toContain("display: flex");
  });

  test("flex-row and flex-col", () => {
    expect(getTailwindCSS("flex-row")).toContain("flex-direction: row");
    expect(getTailwindCSS("flex-col")).toContain("flex-direction: column");
  });

  test("flex-wrap", () => {
    expect(getTailwindCSS("flex-wrap")).toContain("flex-wrap: wrap");
  });

  test("items-center", () => {
    expect(getTailwindCSS("items-center")).toContain("align-items: center");
  });

  test("justify-between", () => {
    expect(getTailwindCSS("justify-between")).toContain("justify-content: space-between");
  });

  test("gap-4", () => {
    expect(getTailwindCSS("gap-4")).toContain("gap: 1rem");
  });

  test("flex-1, flex-auto, flex-none", () => {
    expect(getTailwindCSS("flex-1")).toContain("flex: 1 1 0%");
    expect(getTailwindCSS("flex-auto")).toContain("flex: 1 1 auto");
    expect(getTailwindCSS("flex-none")).toContain("flex: none");
  });

  test("grow and shrink", () => {
    expect(getTailwindCSS("grow")).toContain("flex-grow: 1");
    expect(getTailwindCSS("shrink")).toContain("flex-shrink: 1");
  });
});

// ---------------------------------------------------------------------------
// §7 Grid utilities
// ---------------------------------------------------------------------------

describe("§7 Grid utilities", () => {
  test("grid display", () => {
    expect(getTailwindCSS("grid")).toContain("display: grid");
  });

  test("grid-cols-3", () => {
    expect(getTailwindCSS("grid-cols-3")).toContain("grid-template-columns: repeat(3, minmax(0, 1fr))");
  });

  test("grid-rows-2", () => {
    expect(getTailwindCSS("grid-rows-2")).toContain("grid-template-rows: repeat(2, minmax(0, 1fr))");
  });

  test("col-span-6", () => {
    expect(getTailwindCSS("col-span-6")).toContain("grid-column: span 6 / span 6");
  });

  test("row-span-2", () => {
    expect(getTailwindCSS("row-span-2")).toContain("grid-row: span 2 / span 2");
  });
});

// ---------------------------------------------------------------------------
// §8 Typography utilities
// ---------------------------------------------------------------------------

describe("§8 Typography utilities", () => {
  test.each([
    ["text-xs", "font-size: 0.75rem"],
    ["text-sm", "font-size: 0.875rem"],
    ["text-base", "font-size: 1rem"],
    ["text-lg", "font-size: 1.125rem"],
    ["text-xl", "font-size: 1.25rem"],
    ["text-2xl", "font-size: 1.5rem"],
    ["text-9xl", "font-size: 8rem"],
  ])("%s produces correct font-size", (cls, expected) => {
    expect(getTailwindCSS(cls)).toContain(expected);
  });

  test("font-thin through font-black", () => {
    expect(getTailwindCSS("font-thin")).toContain("font-weight: 100");
    expect(getTailwindCSS("font-normal")).toContain("font-weight: 400");
    expect(getTailwindCSS("font-bold")).toContain("font-weight: 700");
    expect(getTailwindCSS("font-black")).toContain("font-weight: 900");
  });

  test("text-left, text-center, text-right", () => {
    expect(getTailwindCSS("text-left")).toContain("text-align: left");
    expect(getTailwindCSS("text-center")).toContain("text-align: center");
    expect(getTailwindCSS("text-right")).toContain("text-align: right");
  });

  test("leading-*", () => {
    expect(getTailwindCSS("leading-tight")).toContain("line-height: 1.25");
    expect(getTailwindCSS("leading-normal")).toContain("line-height: 1.5");
  });

  test("tracking-*", () => {
    expect(getTailwindCSS("tracking-tight")).toContain("letter-spacing: -0.025em");
    expect(getTailwindCSS("tracking-wide")).toContain("letter-spacing: 0.025em");
  });

  test("uppercase, lowercase, capitalize", () => {
    expect(getTailwindCSS("uppercase")).toContain("text-transform: uppercase");
    expect(getTailwindCSS("lowercase")).toContain("text-transform: lowercase");
    expect(getTailwindCSS("capitalize")).toContain("text-transform: capitalize");
  });

  test("truncate", () => {
    const css = getTailwindCSS("truncate");
    expect(css).toContain("overflow: hidden");
    expect(css).toContain("text-overflow: ellipsis");
    expect(css).toContain("white-space: nowrap");
  });
});

// ---------------------------------------------------------------------------
// §9 Color utilities
// ---------------------------------------------------------------------------

describe("§9 Color utilities", () => {
  test("text-white and text-black", () => {
    expect(getTailwindCSS("text-white")).toContain("color: #ffffff");
    expect(getTailwindCSS("text-black")).toContain("color: #000000");
  });

  test("text-red-500", () => {
    expect(getTailwindCSS("text-red-500")).toContain("color: #ef4444");
  });

  test("bg-blue-600", () => {
    expect(getTailwindCSS("bg-blue-600")).toContain("background-color: #2563eb");
  });

  test("bg-transparent", () => {
    expect(getTailwindCSS("bg-transparent")).toContain("background-color: transparent");
  });

  test("all named colors have 50-950 shades for text and bg", () => {
    const colors = ["slate", "gray", "red", "orange", "amber", "yellow", "green",
      "emerald", "teal", "cyan", "sky", "blue", "indigo", "violet",
      "purple", "fuchsia", "pink", "rose"];
    for (const color of colors) {
      expect(getTailwindCSS(`text-${color}-500`)).not.toBeNull();
      expect(getTailwindCSS(`bg-${color}-500`)).not.toBeNull();
      expect(getTailwindCSS(`text-${color}-50`)).not.toBeNull();
      expect(getTailwindCSS(`text-${color}-950`)).not.toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// §10 Border utilities
// ---------------------------------------------------------------------------

describe("§10 Border utilities", () => {
  test("border widths", () => {
    expect(getTailwindCSS("border")).toContain("border-width: 1px");
    expect(getTailwindCSS("border-2")).toContain("border-width: 2px");
    expect(getTailwindCSS("border-4")).toContain("border-width: 4px");
  });

  test("border colors", () => {
    expect(getTailwindCSS("border-red-500")).toContain("border-color: #ef4444");
    expect(getTailwindCSS("border-black")).toContain("border-color: #000000");
  });

  test("rounded sizes", () => {
    expect(getTailwindCSS("rounded")).toContain("border-radius: 0.25rem");
    expect(getTailwindCSS("rounded-lg")).toContain("border-radius: 0.5rem");
    expect(getTailwindCSS("rounded-full")).toContain("border-radius: 9999px");
    expect(getTailwindCSS("rounded-none")).toContain("border-radius: 0px");
  });
});

// ---------------------------------------------------------------------------
// §11 Effect utilities
// ---------------------------------------------------------------------------

describe("§11 Effect utilities", () => {
  test("shadow sizes", () => {
    expect(getTailwindCSS("shadow")).toContain("box-shadow:");
    expect(getTailwindCSS("shadow-sm")).toContain("box-shadow:");
    expect(getTailwindCSS("shadow-lg")).toContain("box-shadow:");
    expect(getTailwindCSS("shadow-none")).toContain("box-shadow: 0 0 #0000");
  });

  test("opacity values", () => {
    expect(getTailwindCSS("opacity-0")).toContain("opacity: 0");
    expect(getTailwindCSS("opacity-50")).toContain("opacity: 0.5");
    expect(getTailwindCSS("opacity-100")).toContain("opacity: 1");
  });
});

// ---------------------------------------------------------------------------
// §12 Layout utilities
// ---------------------------------------------------------------------------

describe("§12 Layout utilities", () => {
  test.each([
    ["block", "display: block"],
    ["inline-block", "display: inline-block"],
    ["inline", "display: inline"],
    ["hidden", "display: none"],
    ["table", "display: table"],
  ])("%s produces correct display value", (cls, expected) => {
    expect(getTailwindCSS(cls)).toContain(expected);
  });

  test("position values", () => {
    expect(getTailwindCSS("relative")).toContain("position: relative");
    expect(getTailwindCSS("absolute")).toContain("position: absolute");
    expect(getTailwindCSS("fixed")).toContain("position: fixed");
    expect(getTailwindCSS("sticky")).toContain("position: sticky");
  });

  test("overflow values", () => {
    expect(getTailwindCSS("overflow-hidden")).toContain("overflow: hidden");
    expect(getTailwindCSS("overflow-auto")).toContain("overflow: auto");
    expect(getTailwindCSS("overflow-scroll")).toContain("overflow: scroll");
  });

  test("z-index values", () => {
    expect(getTailwindCSS("z-0")).toContain("z-index: 0");
    expect(getTailwindCSS("z-10")).toContain("z-index: 10");
    expect(getTailwindCSS("z-50")).toContain("z-index: 50");
  });

  test("top/right/bottom/left values", () => {
    expect(getTailwindCSS("top-0")).toContain("top: 0px");
    expect(getTailwindCSS("right-4")).toContain("right: 1rem");
    expect(getTailwindCSS("bottom-auto")).toContain("bottom: auto");
    expect(getTailwindCSS("left-full")).toContain("left: 100%");
  });
});

// ---------------------------------------------------------------------------
// §13 Responsive prefixes
// ---------------------------------------------------------------------------

describe("§13 Responsive prefixes", () => {
  test("sm: prefix wraps in media query", () => {
    const css = getTailwindCSS("sm:flex");
    expect(css).toContain("@media (min-width: 640px)");
    expect(css).toContain("display: flex");
  });

  test("md: prefix wraps in media query", () => {
    const css = getTailwindCSS("md:hidden");
    expect(css).toContain("@media (min-width: 768px)");
    expect(css).toContain("display: none");
  });

  test("lg: prefix wraps in media query", () => {
    const css = getTailwindCSS("lg:grid-cols-3");
    expect(css).toContain("@media (min-width: 1024px)");
    expect(css).toContain("grid-template-columns: repeat(3, minmax(0, 1fr))");
  });

  test("xl: prefix wraps in media query", () => {
    const css = getTailwindCSS("xl:p-8");
    expect(css).toContain("@media (min-width: 1280px)");
    expect(css).toContain("padding: 2rem");
  });

  test("2xl: prefix wraps in media query", () => {
    const css = getTailwindCSS("2xl:text-lg");
    expect(css).toContain("@media (min-width: 1536px)");
    expect(css).toContain("font-size: 1.125rem");
  });

  test("responsive prefix with unknown base returns null", () => {
    expect(getTailwindCSS("sm:not-real")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// §14 State prefixes
// ---------------------------------------------------------------------------

describe("§14 State prefixes", () => {
  test("hover: prefix produces :hover pseudo-class", () => {
    const css = getTailwindCSS("hover:bg-blue-500");
    expect(css).toContain(":hover");
    expect(css).toContain("background-color: #3b82f6");
  });

  test("focus: prefix produces :focus pseudo-class", () => {
    const css = getTailwindCSS("focus:border-blue-500");
    expect(css).toContain(":focus");
    expect(css).toContain("border-color: #3b82f6");
  });

  test("active: prefix produces :active pseudo-class", () => {
    const css = getTailwindCSS("active:bg-red-600");
    expect(css).toContain(":active");
    expect(css).toContain("background-color: #dc2626");
  });

  test("disabled: prefix produces :disabled pseudo-class", () => {
    const css = getTailwindCSS("disabled:opacity-50");
    expect(css).toContain(":disabled");
    expect(css).toContain("opacity: 0.5");
  });

  test("state prefix with unknown base returns null", () => {
    expect(getTailwindCSS("hover:not-real")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// §15 Combined responsive + state prefixes
// ---------------------------------------------------------------------------

describe("§15 Combined prefixes", () => {
  test("sm:hover:bg-blue-500 applies both media query and pseudo-class", () => {
    const css = getTailwindCSS("sm:hover:bg-blue-500");
    expect(css).toContain("@media (min-width: 640px)");
    expect(css).toContain(":hover");
    expect(css).toContain("background-color: #3b82f6");
  });

  test("lg:focus:text-white applies both media query and pseudo-class", () => {
    const css = getTailwindCSS("lg:focus:text-white");
    expect(css).toContain("@media (min-width: 1024px)");
    expect(css).toContain(":focus");
    expect(css).toContain("color: #ffffff");
  });
});

// ---------------------------------------------------------------------------
// §16 scanClassesFromHtml
// ---------------------------------------------------------------------------

describe("§16 scanClassesFromHtml", () => {
  test("extracts class names from a single element", () => {
    const classes = scanClassesFromHtml('<div class="p-4 flex items-center"></div>');
    expect(classes).toContain("p-4");
    expect(classes).toContain("flex");
    expect(classes).toContain("items-center");
  });

  test("extracts from multiple elements", () => {
    const html = '<div class="flex"><span class="text-red-500 font-bold">hi</span></div>';
    const classes = scanClassesFromHtml(html);
    expect(classes).toContain("flex");
    expect(classes).toContain("text-red-500");
    expect(classes).toContain("font-bold");
  });

  test("returns empty array for no class attributes", () => {
    expect(scanClassesFromHtml("<div></div>")).toEqual([]);
  });

  test("returns empty array for empty string", () => {
    expect(scanClassesFromHtml("")).toEqual([]);
  });

  test("returns empty array for null", () => {
    expect(scanClassesFromHtml(null)).toEqual([]);
  });

  test("deduplicates class names", () => {
    const html = '<div class="p-4 flex"><span class="p-4 m-2"></span></div>';
    const classes = scanClassesFromHtml(html);
    const p4Count = classes.filter(c => c === "p-4").length;
    expect(p4Count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// §17 Deduplication in getAllUsedCSS
// ---------------------------------------------------------------------------

describe("§17 Deduplication", () => {
  test("duplicate class names produce CSS only once", () => {
    const css = getAllUsedCSS(["p-4", "p-4", "flex", "flex"]);
    const p4Matches = css.match(/\.p-4/g);
    expect(p4Matches).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// §18 Edge cases
// ---------------------------------------------------------------------------

describe("§18 Edge cases", () => {
  test("getTailwindCSS(null) returns null", () => {
    expect(getTailwindCSS(null)).toBeNull();
  });

  test("getTailwindCSS(undefined) returns null", () => {
    expect(getTailwindCSS(undefined)).toBeNull();
  });

  test("getAllUsedCSS(null) returns empty string", () => {
    expect(getAllUsedCSS(null)).toBe("");
  });

  test("getAllUsedCSS(undefined) returns empty string", () => {
    expect(getAllUsedCSS(undefined)).toBe("");
  });

  test("p-px uses 1px value", () => {
    expect(getTailwindCSS("p-px")).toContain("padding: 1px");
  });

  test("fractional spacing p-0.5", () => {
    expect(getTailwindCSS("p-0.5")).toContain("padding: 0.125rem");
  });
});

// ---------------------------------------------------------------------------
// §19 Arbitrary values (per §26.4)
// ---------------------------------------------------------------------------

describe("§19 Arbitrary values — spacing", () => {
  test("p-[1.5rem] emits padding: 1.5rem", () => {
    const css = getTailwindCSS("p-[1.5rem]");
    expect(css).toContain("padding: 1.5rem");
    expect(css).toContain(".p-\\[1\\.5rem\\]");
  });

  test("px-[42px] emits padding-left and padding-right", () => {
    const css = getTailwindCSS("px-[42px]");
    expect(css).toContain("padding-left: 42px");
    expect(css).toContain("padding-right: 42px");
  });

  test("py-[2rem] emits padding-top and padding-bottom", () => {
    const css = getTailwindCSS("py-[2rem]");
    expect(css).toContain("padding-top: 2rem");
    expect(css).toContain("padding-bottom: 2rem");
  });

  test("pt-[10%], pr-[10%], pb-[10%], pl-[10%]", () => {
    expect(getTailwindCSS("pt-[10%]")).toContain("padding-top: 10%");
    expect(getTailwindCSS("pr-[10%]")).toContain("padding-right: 10%");
    expect(getTailwindCSS("pb-[10%]")).toContain("padding-bottom: 10%");
    expect(getTailwindCSS("pl-[10%]")).toContain("padding-left: 10%");
  });

  test("m-[3.5rem]", () => {
    expect(getTailwindCSS("m-[3.5rem]")).toContain("margin: 3.5rem");
  });

  test("mt-[-10px] (negative value)", () => {
    expect(getTailwindCSS("mt-[-10px]")).toContain("margin-top: -10px");
  });

  test("gap-[2.4rem], gap-x-[1rem], gap-y-[0.5rem]", () => {
    expect(getTailwindCSS("gap-[2.4rem]")).toContain("gap: 2.4rem");
    expect(getTailwindCSS("gap-x-[1rem]")).toContain("column-gap: 1rem");
    expect(getTailwindCSS("gap-y-[0.5rem]")).toContain("row-gap: 0.5rem");
  });
});

describe("§19 Arbitrary values — sizing", () => {
  test("w-[200px], h-[150px]", () => {
    expect(getTailwindCSS("w-[200px]")).toContain("width: 200px");
    expect(getTailwindCSS("h-[150px]")).toContain("height: 150px");
  });

  test("min-w-[10ch], max-w-[80ch]", () => {
    expect(getTailwindCSS("min-w-[10ch]")).toContain("min-width: 10ch");
    expect(getTailwindCSS("max-w-[80ch]")).toContain("max-width: 80ch");
  });

  test("min-h-[100vh], max-h-[50svh]", () => {
    expect(getTailwindCSS("min-h-[100vh]")).toContain("min-height: 100vh");
    expect(getTailwindCSS("max-h-[50svh]")).toContain("max-height: 50svh");
  });
});

describe("§19 Arbitrary values — position", () => {
  test("top-[3.5%], right-[1rem], bottom-[0px], left-[10vw]", () => {
    expect(getTailwindCSS("top-[3.5%]")).toContain("top: 3.5%");
    expect(getTailwindCSS("right-[1rem]")).toContain("right: 1rem");
    expect(getTailwindCSS("bottom-[0px]")).toContain("bottom: 0px");
    expect(getTailwindCSS("left-[10vw]")).toContain("left: 10vw");
  });

  test("inset-[2rem]", () => {
    expect(getTailwindCSS("inset-[2rem]")).toContain("inset: 2rem");
  });
});

describe("§19 Arbitrary values — color (hex)", () => {
  test("bg-[#ff00ff] (6-digit hex)", () => {
    const css = getTailwindCSS("bg-[#ff00ff]");
    expect(css).toContain("background-color: #ff00ff");
    expect(css).toContain(".bg-\\[\\#ff00ff\\]");
  });

  test("bg-[#fff] (3-digit hex)", () => {
    expect(getTailwindCSS("bg-[#fff]")).toContain("background-color: #fff");
  });

  test("bg-[#ffffffff] (8-digit hex with alpha)", () => {
    expect(getTailwindCSS("bg-[#ffffffff]")).toContain("background-color: #ffffffff");
  });

  test("text-[#ef4444]", () => {
    expect(getTailwindCSS("text-[#ef4444]")).toContain("color: #ef4444");
  });

  test("border-[#ccc]", () => {
    expect(getTailwindCSS("border-[#ccc]")).toContain("border-color: #ccc");
  });
});

describe("§19 Arbitrary values — color functions", () => {
  test("bg-[rgb(255,0,0)]", () => {
    const css = getTailwindCSS("bg-[rgb(255,0,0)]");
    expect(css).toContain("background-color: rgb(255,0,0)");
  });

  test("bg-[rgba(0,0,0,0.5)]", () => {
    expect(getTailwindCSS("bg-[rgba(0,0,0,0.5)]")).toContain("background-color: rgba(0,0,0,0.5)");
  });

  test("bg-[hsl(120,100%,50%)]", () => {
    expect(getTailwindCSS("bg-[hsl(120,100%,50%)]")).toContain("background-color: hsl(120,100%,50%)");
  });

  test("text-[oklch(0.7,0.15,200)]", () => {
    expect(getTailwindCSS("text-[oklch(0.7,0.15,200)]")).toContain("color: oklch(0.7,0.15,200)");
  });
});

describe("§19 Arbitrary values — typography (font-size)", () => {
  test("text-[14px] uses font-size", () => {
    expect(getTailwindCSS("text-[14px]")).toContain("font-size: 14px");
  });

  test("text-[1.125rem]", () => {
    expect(getTailwindCSS("text-[1.125rem]")).toContain("font-size: 1.125rem");
  });

  test("leading-[1.7]", () => {
    expect(getTailwindCSS("leading-[1.7]")).toContain("line-height: 1.7");
  });

  test("tracking-[0.05em]", () => {
    expect(getTailwindCSS("tracking-[0.05em]")).toContain("letter-spacing: 0.05em");
  });
});

describe("§19 Arbitrary values — border", () => {
  test("border-[2px] uses border-width", () => {
    expect(getTailwindCSS("border-[2px]")).toContain("border-width: 2px");
  });

  test("rounded-[16px]", () => {
    expect(getTailwindCSS("rounded-[16px]")).toContain("border-radius: 16px");
  });
});

describe("§19 Arbitrary values — effects", () => {
  test("opacity-[0.42]", () => {
    expect(getTailwindCSS("opacity-[0.42]")).toContain("opacity: 0.42");
  });

  test("shadow-[#fff] passes through to box-shadow", () => {
    // S109 amendment: Tailwind's underscore-as-space convention IS now
    // implemented (see Bug 1 full-fix). `shadow-[0_2px_4px_rgba(0,0,0,0.1)]`
    // becomes `box-shadow: 0 2px 4px rgba(0,0,0,0.1)`. Single-value cases
    // like this one (no `_`) emit verbatim — covered here.
    expect(getTailwindCSS("shadow-[#fff]")).toContain("box-shadow: #fff");
  });

  test("S109 — shadow-[0_2px_4px_rgba(0,0,0,0.1)] multi-token list emits with `_` -> ` `", () => {
    // Multi-token box-shadow uses Tailwind's underscore-as-space.
    expect(getTailwindCSS("shadow-[0_2px_4px_rgba(0,0,0,0.1)]"))
      .toContain("box-shadow: 0 2px 4px rgba(0,0,0,0.1)");
  });
});

describe("§19 Arbitrary values — z-index", () => {
  test("z-[42]", () => {
    expect(getTailwindCSS("z-[42]")).toContain("z-index: 42");
  });

  test("z-[-1] (negative)", () => {
    expect(getTailwindCSS("z-[-1]")).toContain("z-index: -1");
  });
});

describe("§19 Arbitrary values — var() and url()", () => {
  test("text-[var(--my-text-color)] defaults to font-size", () => {
    // Per §26.4: var() defaults to font-size for text-, border-width for border-,
    // background-color for bg-.
    expect(getTailwindCSS("text-[var(--my-text-color)]")).toContain("font-size: var(--my-text-color)");
  });

  test("bg-[var(--bg)] defaults to background-color", () => {
    expect(getTailwindCSS("bg-[var(--bg)]")).toContain("background-color: var(--bg)");
  });

  test("p-[var(--gap)]", () => {
    expect(getTailwindCSS("p-[var(--gap)]")).toContain("padding: var(--gap)");
  });

  test("var() with fallback", () => {
    expect(getTailwindCSS("p-[var(--gap,1rem)]")).toContain("padding: var(--gap,1rem)");
  });

  test("bg-[url(/foo.png)] sets background-image", () => {
    const css = getTailwindCSS("bg-[url(/foo.png)]");
    expect(css).toContain("background-image: url(/foo.png)");
  });

  test("bg-[url('foo.png')] (single-quoted)", () => {
    const css = getTailwindCSS("bg-[url('foo.png')]");
    expect(css).toContain("background-image: url('foo.png')");
  });

  test("bg-[url(\"foo.png\")] (double-quoted)", () => {
    const css = getTailwindCSS("bg-[url(\"foo.png\")]");
    expect(css).toContain("background-image: url(\"foo.png\")");
  });
});

describe("§19 Arbitrary values — math functions", () => {
  test("w-[calc(100%-2rem)]", () => {
    expect(getTailwindCSS("w-[calc(100%-2rem)]")).toContain("width: calc(100%-2rem)");
  });

  test("p-[min(1rem,2vw)]", () => {
    expect(getTailwindCSS("p-[min(1rem,2vw)]")).toContain("padding: min(1rem,2vw)");
  });

  test("h-[clamp(1rem,5vw,10rem)]", () => {
    expect(getTailwindCSS("h-[clamp(1rem,5vw,10rem)]")).toContain("height: clamp(1rem,5vw,10rem)");
  });
});

describe("§19 Arbitrary values — keyword + ident", () => {
  test("w-[auto]", () => {
    expect(getTailwindCSS("w-[auto]")).toContain("width: auto");
  });

  test("text-[currentColor]", () => {
    expect(getTailwindCSS("text-[currentColor]")).toContain("color: currentColor");
  });

  test("bg-[transparent]", () => {
    expect(getTailwindCSS("bg-[transparent]")).toContain("background-color: transparent");
  });
});

// ---------------------------------------------------------------------------
// §19b Arbitrary values — validation errors (E-TAILWIND-001)
// ---------------------------------------------------------------------------

describe("§19b Arbitrary value validation errors", () => {
  test("getTailwindCSS returns null on empty []", () => {
    expect(getTailwindCSS("p-[]")).toBeNull();
  });

  test("empty bracket emits E-TAILWIND-001", () => {
    const { css, diagnostic } = getTailwindCSSWithDiagnostic("p-[]");
    expect(css).toBeNull();
    expect(diagnostic).not.toBeNull();
    expect(diagnostic.code).toBe("E-TAILWIND-001");
    expect(diagnostic.message).toContain("empty");
  });

  test("invalid CSS unit emits E-TAILWIND-001", () => {
    const { css, diagnostic } = getTailwindCSSWithDiagnostic("p-[1.5quux]");
    expect(css).toBeNull();
    expect(diagnostic.code).toBe("E-TAILWIND-001");
    expect(diagnostic.message).toContain("invalid CSS unit");
    expect(diagnostic.message).toContain("quux");
  });

  test("malformed hex (5 digits) emits E-TAILWIND-001", () => {
    const { diagnostic } = getTailwindCSSWithDiagnostic("bg-[#abcde]");
    expect(diagnostic.code).toBe("E-TAILWIND-001");
    expect(diagnostic.message).toContain("hex color");
  });

  test("non-hex digit in hex emits E-TAILWIND-001", () => {
    const { diagnostic } = getTailwindCSSWithDiagnostic("bg-[#ggg]");
    expect(diagnostic.code).toBe("E-TAILWIND-001");
    expect(diagnostic.message).toContain("hex color");
  });

  test("unbalanced parens emits E-TAILWIND-001", () => {
    const { diagnostic } = getTailwindCSSWithDiagnostic("bg-[rgb(255,0,0]");
    // Note: outer brackets are balanced (`[...]`) but inner parens are not.
    expect(diagnostic.code).toBe("E-TAILWIND-001");
  });

  test("unknown CSS function emits E-TAILWIND-001", () => {
    const { diagnostic } = getTailwindCSSWithDiagnostic("bg-[notreal(1,2,3)]");
    expect(diagnostic.code).toBe("E-TAILWIND-001");
    expect(diagnostic.message).toContain("unknown CSS function");
    expect(diagnostic.message).toContain("notreal");
  });

  test("malformed var() emits E-TAILWIND-001", () => {
    const { diagnostic } = getTailwindCSSWithDiagnostic("p-[var(notADoubleHyphen)]");
    expect(diagnostic.code).toBe("E-TAILWIND-001");
    expect(diagnostic.message).toContain("var()");
  });

  test("whitespace inside [] emits E-TAILWIND-001", () => {
    const { diagnostic } = getTailwindCSSWithDiagnostic("p-[1.5 rem]");
    expect(diagnostic.code).toBe("E-TAILWIND-001");
    expect(diagnostic.message).toContain("whitespace");
  });

  test("CSS-injection chars emit E-TAILWIND-001", () => {
    expect(getTailwindCSSWithDiagnostic("p-[1px;color:red]").diagnostic.code).toBe("E-TAILWIND-001");
    expect(getTailwindCSSWithDiagnostic("p-[1px}color:red]").diagnostic.code).toBe("E-TAILWIND-001");
    expect(getTailwindCSSWithDiagnostic("p-[<script>]").diagnostic.code).toBe("E-TAILWIND-001");
  });

  test("getAllUsedCSSWithDiagnostics collects diagnostics", () => {
    const result = getAllUsedCSSWithDiagnostics(["p-4", "p-[1.5quux]", "bg-[#ggg]"]);
    expect(result.css).toContain("padding: 1rem");
    expect(result.diagnostics).toHaveLength(2);
    expect(result.diagnostics.every(d => d.code === "E-TAILWIND-001")).toBe(true);
  });

  test("non-arbitrary unknown class produces no diagnostic", () => {
    const result = getAllUsedCSSWithDiagnostics(["not-a-real-class"]);
    expect(result.css).toBe("");
    expect(result.diagnostics).toHaveLength(0);
  });

  test("getAllUsedCSS still drops invalid arbitrary values silently", () => {
    const css = getAllUsedCSS(["p-4", "p-[notreal()]"]);
    expect(css).toContain("padding: 1rem");
    expect(css).not.toContain("notreal");
  });

  test("text-[xy] (non-numeric, non-color) is treated as ident-color (per §26.4)", () => {
    // Bare identifier defaults to color (e.g., `text-[currentColor]`-style).
    const css = getTailwindCSS("text-[xy]");
    expect(css).toContain("color: xy");
  });
});

// ---------------------------------------------------------------------------
// §19c Arbitrary values + variants (cross-feature)
// ---------------------------------------------------------------------------

describe("§19c Arbitrary values + variants", () => {
  test("md:p-[1.5rem] wraps in @media (min-width: 768px)", () => {
    const css = getTailwindCSS("md:p-[1.5rem]");
    expect(css).toContain("@media (min-width: 768px)");
    expect(css).toContain("padding: 1.5rem");
  });

  test("hover:bg-[#ff00ff] applies :hover", () => {
    const css = getTailwindCSS("hover:bg-[#ff00ff]");
    expect(css).toContain(":hover");
    expect(css).toContain("background-color: #ff00ff");
  });

  test("md:hover:bg-[#ff00ff] applies both", () => {
    const css = getTailwindCSS("md:hover:bg-[#ff00ff]");
    expect(css).toContain("@media (min-width: 768px)");
    expect(css).toContain(":hover");
    expect(css).toContain("background-color: #ff00ff");
  });

  test("focus:w-[200px]", () => {
    const css = getTailwindCSS("focus:w-[200px]");
    expect(css).toContain(":focus");
    expect(css).toContain("width: 200px");
  });
});

// ---------------------------------------------------------------------------
// §19d HTML scanning preserves arbitrary-value class names
// ---------------------------------------------------------------------------

describe("§19d scanClassesFromHtml + arbitrary values", () => {
  test("captures p-[1.5rem] from HTML", () => {
    const classes = scanClassesFromHtml('<div class="flex p-[1.5rem] m-2"></div>');
    expect(classes).toContain("p-[1.5rem]");
    expect(classes).toContain("flex");
    expect(classes).toContain("m-2");
  });

  test("captures bg-[#ff00ff] and bg-[rgb(0,255,0)]", () => {
    const classes = scanClassesFromHtml('<span class="bg-[#ff00ff] bg-[rgb(0,255,0)]"></span>');
    expect(classes).toContain("bg-[#ff00ff]");
    expect(classes).toContain("bg-[rgb(0,255,0)]");
  });
});

// ---------------------------------------------------------------------------
// §20 Dynamic-class fragments — `class="prefix-${expr}"` is not validated
//
// `class="driver-${@status}"` is a runtime-concatenation: the static `driver-`
// prefix is glued to a `${...}` interpolation and is NEVER a complete utility.
// Both tailwind scan loops mask `${...}` to whitespace (length-preserving) then
// `/\S+/`-split; before this fix the fragment before the mask (`driver-`) was
// extracted and lint-failed. The fix skips any token glued to (no whitespace
// boundary) or overlapping a `${...}` region.
//
// Boundary contract:
//   - GLUED (adjacent / overlapping) tokens  -> skipped (fragment).
//   - WHITESPACE-SEPARATED standalone tokens  -> still validated.
//   - STATIC tokens with no interpolation     -> unchanged (still fire).
// Covers both findUnrecognizedClasses (W-TAILWIND-UNRECOGNIZED-CLASS) and
// findUnsupportedTailwindShapes (W-TAILWIND-001).
// ---------------------------------------------------------------------------

describe("§20 Dynamic-class fragment skip — W-TAILWIND-UNRECOGNIZED-CLASS", () => {
  const firedOn = (diags, cls) =>
    diags.some(d => d.code === "W-TAILWIND-UNRECOGNIZED-CLASS" && d.className === cls);

  test("prefix glued to a state interpolation does not fire on the prefix", () => {
    const diags = findUnrecognizedClasses('<div class="driver-${@status}"></div>');
    expect(firedOn(diags, "driver-")).toBe(false);
    expect(diags).toHaveLength(0);
  });

  test("recognized utilities pass and the glued prefix is skipped (no fire on any token)", () => {
    const diags = findUnrecognizedClasses('<div class="flex gap-2 badge-${@n}"></div>');
    // flex / gap-2 are recognized; badge- is a fragment -> nothing fires.
    expect(firedOn(diags, "flex")).toBe(false);
    expect(firedOn(diags, "gap-2")).toBe(false);
    expect(firedOn(diags, "badge-")).toBe(false);
    expect(diags).toHaveLength(0);
  });

  test("suffix glued AFTER an interpolation does not fire on the suffix", () => {
    const diags = findUnrecognizedClasses('<div class="${expr}-suffix"></div>');
    expect(firedOn(diags, "-suffix")).toBe(false);
    expect(diags).toHaveLength(0);
  });

  test("Tailwind-shaped dynamic prefix (grid-cols-) does not fire", () => {
    const diags = findUnrecognizedClasses('<div class="grid-cols-${n}"></div>');
    expect(firedOn(diags, "grid-cols-")).toBe(false);
    expect(diags).toHaveLength(0);
  });

  test("STATIC custom classes (no interpolation) STILL fire — no blanket suppression", () => {
    const diags = findUnrecognizedClasses('<div class="counter-app my-card"></div>');
    expect(firedOn(diags, "counter-app")).toBe(true);
    expect(firedOn(diags, "my-card")).toBe(true);
  });

  test("fully-dynamic class (whole value is one interpolation) is unchanged — no fire", () => {
    const diags = findUnrecognizedClasses(`<div class="\${cond ? 'a':'b'}"></div>`);
    expect(diags).toHaveLength(0);
  });

  test("whitespace-separated typo NEXT TO an interpolation still fires (not glued)", () => {
    const diags = findUnrecognizedClasses('<div class="flexx ${x} grid"></div>');
    // flexx is a standalone typo separated by whitespace -> still caught.
    expect(firedOn(diags, "flexx")).toBe(true);
    // grid is recognized; ${x} is masked -> no other fires.
    expect(firedOn(diags, "grid")).toBe(false);
  });
});

describe("§20 Dynamic-class fragment skip — W-TAILWIND-001 (findUnsupportedTailwindShapes)", () => {
  const firedOn = (diags, cls) =>
    diags.some(d => d.code === "W-TAILWIND-001" && d.className === cls);

  test("variant-shaped dynamic prefix (hover:bg-) does not fire", () => {
    // hover:bg- contains ':' so it passes the shape prefilter, fails registry
    // lookup, and pre-fix mis-fired W-TAILWIND-001 on the fragment.
    const diags = findUnsupportedTailwindShapes('<div class="hover:bg-${color}"></div>');
    expect(firedOn(diags, "hover:bg-")).toBe(false);
    expect(diags).toHaveLength(0);
  });

  test("arbitrary-value bracket fragments around an interpolation do not fire", () => {
    // `p-[` is glued to ${...}; `]` is glued after it. Both are fragments.
    const diags = findUnsupportedTailwindShapes('<div class="p-[${size}]"></div>');
    expect(firedOn(diags, "p-[")).toBe(false);
    expect(firedOn(diags, "]")).toBe(false);
    expect(diags).toHaveLength(0);
  });

  test("variant suffix glued AFTER an interpolation does not fire", () => {
    const diags = findUnsupportedTailwindShapes('<div class="${v}:p-4"></div>');
    expect(firedOn(diags, ":p-4")).toBe(false);
    expect(diags).toHaveLength(0);
  });

  test("genuinely-unsupported STATIC variant (group-hover:) STILL fires — no blanket suppression", () => {
    // group-hover: is shape-valid (':') but unsupported by the engine; it is
    // static (no interpolation) so it must still fire.
    const diags = findUnsupportedTailwindShapes('<div class="group-hover:p-4"></div>');
    expect(firedOn(diags, "group-hover:p-4")).toBe(true);
  });

  test("whitespace-separated unsupported variant next to an interpolation still fires", () => {
    const diags = findUnsupportedTailwindShapes('<div class="group-hover:p-4 ${x}"></div>');
    expect(firedOn(diags, "group-hover:p-4")).toBe(true);
  });
});
