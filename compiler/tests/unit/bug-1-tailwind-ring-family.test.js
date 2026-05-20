/**
 * bug-1-tailwind-ring-family.test.js — Bug 1 partial closure S109: add ring-*
 * arbitrary-value emission with kind-dispatch (length → box-shadow with
 * currentColor; color/var/keyword → box-shadow with default 3px width).
 *
 * Documented limitations (deferred):
 *   - ring-offset-* — needs preflight CSS (custom properties on `*, ::before, ::after`)
 *   - ring-inset    — named utility, not arbitrary-value
 *   - bg-gradient-* / from-* / to-* / via-* — needs preflight + multi-utility coordination
 *   - composing ring-[N] with shadow-[...] — last-write-wins per CSS class order
 *
 * Coverage:
 *   §1  ring-[length] — width with currentColor
 *   §2  ring-[color]  — color with default 3px width
 *   §3  ring-[var()] — var defaults to color shape
 *   §4  ring-[keyword] — currentColor / transparent
 *   §5  lint regression — ring-[N] no longer fires W-TAILWIND-UNRECOGNIZED-CLASS
 *   §6  still-deferred — ring-offset / bg-gradient still fire the lint (regression guard)
 *   §7  responsive + dark variants — md:ring-[3px] / dark:ring-[red] compose
 */

import { describe, test, expect } from "bun:test";
import { getAllUsedCSS, findUnrecognizedClasses } from "../../src/tailwind-classes.js";

function cssFor(classNames) {
  return getAllUsedCSS(classNames.split(" "));
}

// ---------------------------------------------------------------------------
// §1: ring-[length] — set ring width with currentColor
// ---------------------------------------------------------------------------

describe("§1: ring-[length] emits box-shadow with currentColor", () => {
  test("ring-[3px] emits the canonical Tailwind ring default width", () => {
    const css = cssFor("ring-[3px]");
    expect(css).toContain("box-shadow: 0 0 0 3px currentColor");
  });

  test("ring-[1px] emits 1px ring", () => {
    const css = cssFor("ring-[1px]");
    expect(css).toContain("box-shadow: 0 0 0 1px currentColor");
  });

  test("ring-[2.5rem] accepts rem unit", () => {
    const css = cssFor("ring-[2.5rem]");
    expect(css).toContain("box-shadow: 0 0 0 2.5rem currentColor");
  });

  test("ring-[0.5em] accepts em unit", () => {
    const css = cssFor("ring-[0.5em]");
    expect(css).toContain("box-shadow: 0 0 0 0.5em currentColor");
  });
});

// ---------------------------------------------------------------------------
// §2: ring-[color] — set ring color with default 3px width
// ---------------------------------------------------------------------------

describe("§2: ring-[color] emits box-shadow with default 3px width", () => {
  test("ring-[#ff0000] uses hex color with 3px default width", () => {
    const css = cssFor("ring-[#ff0000]");
    expect(css).toContain("box-shadow: 0 0 0 3px #ff0000");
  });

  test("ring-[red] uses bare color keyword with 3px default", () => {
    const css = cssFor("ring-[red]");
    expect(css).toContain("box-shadow: 0 0 0 3px red");
  });

  test("ring-[rgb(255,0,0)] uses rgb() function with 3px default", () => {
    const css = cssFor("ring-[rgb(255,0,0)]");
    expect(css).toContain("box-shadow: 0 0 0 3px rgb(255,0,0)");
  });

  test("ring-[hsl(120,100%,50%)] uses hsl() function with 3px default", () => {
    const css = cssFor("ring-[hsl(120,100%,50%)]");
    expect(css).toContain("box-shadow: 0 0 0 3px hsl(120,100%,50%)");
  });
});

// ---------------------------------------------------------------------------
// §3: ring-[var()] — CSS custom property reference
// ---------------------------------------------------------------------------

describe("§3: ring-[var()] uses CSS variable with default 3px width", () => {
  test("ring-[var(--ring-color)] emits box-shadow with var ref", () => {
    const css = cssFor("ring-[var(--ring-color)]");
    expect(css).toContain("box-shadow: 0 0 0 3px var(--ring-color)");
  });

  test("ring-[var(--my-color,red)] supports fallback in var()", () => {
    const css = cssFor("ring-[var(--my-color,red)]");
    expect(css).toContain("box-shadow: 0 0 0 3px var(--my-color,red)");
  });
});

// ---------------------------------------------------------------------------
// §4: ring-[keyword] — currentColor / transparent / inherit etc.
// ---------------------------------------------------------------------------

describe("§4: ring-[keyword] uses CSS keyword as color with 3px default", () => {
  test("ring-[currentColor] is supported", () => {
    const css = cssFor("ring-[currentColor]");
    expect(css).toContain("box-shadow: 0 0 0 3px currentColor");
  });

  test("ring-[transparent] is supported", () => {
    const css = cssFor("ring-[transparent]");
    expect(css).toContain("box-shadow: 0 0 0 3px transparent");
  });
});

// ---------------------------------------------------------------------------
// §5: lint — ring-* no longer fires W-TAILWIND-UNRECOGNIZED-CLASS
// ---------------------------------------------------------------------------

describe("§5: lint regression — ring-* now recognized", () => {
  test("ring-[3px] does not fire W-TAILWIND-UNRECOGNIZED-CLASS", () => {
    const diags = findUnrecognizedClasses(
      '<div class="ring-[3px]">x</div>',
      "test.scrml"
    );
    expect(diags).toEqual([]);
  });

  test("ring-[red] does not fire W-TAILWIND-UNRECOGNIZED-CLASS", () => {
    const diags = findUnrecognizedClasses(
      '<div class="ring-[red]">x</div>',
      "test.scrml"
    );
    expect(diags).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §6: still-deferred families STILL fire the lint (regression guard)
// ---------------------------------------------------------------------------

describe("§6: still-deferred ring/gradient families fire W-TAILWIND-UNRECOGNIZED-CLASS", () => {
  test("ring-offset-[2px] fires the unrecognized-class lint (deferred — needs preflight)", () => {
    const diags = findUnrecognizedClasses(
      '<div class="ring-offset-[2px]">x</div>',
      "test.scrml"
    );
    expect(diags.length).toBeGreaterThan(0);
    expect(diags[0].code).toBe("W-TAILWIND-UNRECOGNIZED-CLASS");
  });

  test("bg-gradient-to-r fires the lint (deferred — needs preflight + multi-utility)", () => {
    const diags = findUnrecognizedClasses(
      '<div class="bg-gradient-to-r">x</div>',
      "test.scrml"
    );
    expect(diags.length).toBeGreaterThan(0);
    expect(diags[0].code).toBe("W-TAILWIND-UNRECOGNIZED-CLASS");
  });

  test("from-[#ff0000] fires the lint (deferred — needs gradient stops)", () => {
    const diags = findUnrecognizedClasses(
      '<div class="from-[#ff0000]">x</div>',
      "test.scrml"
    );
    expect(diags.length).toBeGreaterThan(0);
    expect(diags[0].code).toBe("W-TAILWIND-UNRECOGNIZED-CLASS");
  });

  test("to-[#0000ff] fires the lint (deferred — needs gradient stops)", () => {
    const diags = findUnrecognizedClasses(
      '<div class="to-[#0000ff]">x</div>',
      "test.scrml"
    );
    expect(diags.length).toBeGreaterThan(0);
    expect(diags[0].code).toBe("W-TAILWIND-UNRECOGNIZED-CLASS");
  });

  test("via-[#00ff00] fires the lint (deferred — needs gradient stops)", () => {
    const diags = findUnrecognizedClasses(
      '<div class="via-[#00ff00]">x</div>',
      "test.scrml"
    );
    expect(diags.length).toBeGreaterThan(0);
    expect(diags[0].code).toBe("W-TAILWIND-UNRECOGNIZED-CLASS");
  });
});

// ---------------------------------------------------------------------------
// §7: variant prefixes compose (responsive / dark / hover etc.)
// ---------------------------------------------------------------------------

describe("§7: ring-* composes with variant prefixes", () => {
  test("md:ring-[3px] wraps in @media (min-width: 768px)", () => {
    const css = cssFor("md:ring-[3px]");
    expect(css).toContain("@media (min-width: 768px)");
    expect(css).toContain("box-shadow: 0 0 0 3px currentColor");
  });

  test("dark:ring-[red] wraps in @media (prefers-color-scheme: dark)", () => {
    const css = cssFor("dark:ring-[red]");
    expect(css).toContain("@media (prefers-color-scheme: dark)");
    expect(css).toContain("box-shadow: 0 0 0 3px red");
  });

  test("hover:ring-[3px] uses :hover state selector", () => {
    const css = cssFor("hover:ring-[3px]");
    expect(css).toContain(":hover");
    expect(css).toContain("box-shadow: 0 0 0 3px currentColor");
  });

  test("focus:ring-[2px] uses :focus state selector", () => {
    const css = cssFor("focus:ring-[2px]");
    expect(css).toContain(":focus");
    expect(css).toContain("box-shadow: 0 0 0 2px currentColor");
  });
});
