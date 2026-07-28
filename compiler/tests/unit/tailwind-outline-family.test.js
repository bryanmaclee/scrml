/**
 * tailwind-outline-family.test.js — D-3: the `outline-*` family is a real
 * Tailwind family that the engine did not recognize, so
 * W-TAILWIND-UNRECOGNIZED-CLASS false-fired on every member of it.
 *
 * `outline-none` is the one adopters hit constantly — it is the standard partner
 * to a custom focus treatment (`focus:outline-none focus:ring-2`). Cosmetic in
 * isolation, but the entire value of that lint is as a TYPO DETECTOR, and a
 * false positive on a real utility trains adopters to ignore it.
 *
 * The second describe block is the load-bearing one: it proves the gate STILL
 * BITES. A lint that stopped firing on everything would be strictly worse than
 * the false positive being fixed here.
 */

import { describe, test, expect } from "bun:test";
import { getTailwindCSS, findUnrecognizedClasses } from "../../src/tailwind-classes.js";

describe("D-3 — the outline family resolves", () => {
  test("`outline-none` resolves", () => {
    expect(getTailwindCSS("outline-none")).not.toBeNull();
  });

  test("`outline-none` uses Tailwind v3 semantics (transparent outline, not `outline-style: none`)", () => {
    // v3 spells outline-none as a 2px TRANSPARENT outline rather than removing
    // the outline, so the focus affordance survives forced-colors / Windows High
    // Contrast mode. v4 renamed that to `outline-hidden` and redefined
    // `outline-none` as `outline-style: none`. This engine is v3 throughout
    // (bare `ring` is 3px, gradients are `bg-gradient-to-*`); emitting the v4
    // meaning here would silently delete an accessibility affordance.
    const css = getTailwindCSS("outline-none");
    expect(css).toContain("outline: 2px solid transparent");
    expect(css).toContain("outline-offset: 2px");
    expect(css).not.toContain("outline-style: none");
  });

  test("bare `outline` is the v3 style utility, not a width", () => {
    expect(getTailwindCSS("outline")).toContain("outline-style: solid");
  });

  test("outline styles resolve", () => {
    expect(getTailwindCSS("outline-dashed")).toContain("outline-style: dashed");
    expect(getTailwindCSS("outline-dotted")).toContain("outline-style: dotted");
    expect(getTailwindCSS("outline-double")).toContain("outline-style: double");
  });

  test("outline widths resolve", () => {
    for (const [cls, px] of [
      ["outline-0", "0px"], ["outline-1", "1px"], ["outline-2", "2px"],
      ["outline-4", "4px"], ["outline-8", "8px"],
    ]) {
      expect(getTailwindCSS(cls)).toContain(`outline-width: ${px}`);
    }
  });

  test("outline offsets resolve", () => {
    for (const [cls, px] of [
      ["outline-offset-0", "0px"], ["outline-offset-1", "1px"],
      ["outline-offset-2", "2px"], ["outline-offset-4", "4px"],
      ["outline-offset-8", "8px"],
    ]) {
      expect(getTailwindCSS(cls)).toContain(`outline-offset: ${px}`);
    }
  });

  test("outline colors resolve (palette + specials)", () => {
    expect(getTailwindCSS("outline-blue-500")).toContain("outline-color: #3b82f6");
    expect(getTailwindCSS("outline-red-600")).toContain("outline-color: #dc2626");
    expect(getTailwindCSS("outline-white")).toContain("outline-color: #ffffff");
    expect(getTailwindCSS("outline-black")).toContain("outline-color: #000000");
    expect(getTailwindCSS("outline-transparent")).toContain("outline-color: transparent");
    expect(getTailwindCSS("outline-current")).toContain("outline-color: currentColor");
  });

  test("variants compose over the new utilities (the real adopter shape)", () => {
    const focus = getTailwindCSS("focus:outline-none");
    expect(focus).not.toBeNull();
    expect(focus).toContain(":focus");
    expect(focus).toContain("outline: 2px solid transparent");
    expect(getTailwindCSS("hover:outline-none")).not.toBeNull();
    const md = getTailwindCSS("md:outline-none");
    expect(md).toContain("@media (min-width: 768px)");
  });

  test("the pre-existing arbitrary-value forms are unchanged", () => {
    // These resolved BEFORE this change via the arbitrary-value property map,
    // not via named registration. Adding named entries must not disturb them.
    expect(getTailwindCSS("outline-[2px]")).toContain("outline: 2px");
    expect(getTailwindCSS("outline-offset-[3px]")).toContain("outline-offset: 3px");
  });

  test("no lint fires on real outline utilities in a class attribute", () => {
    const source = `<button class="outline-none focus:outline-none outline-2 outline-offset-2 outline-blue-500 outline-dashed">x</>`;
    expect(findUnrecognizedClasses(source)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// THE GATE MUST STILL BITE. Registering a family is only safe if a genuinely
// bogus neighbour still fires — otherwise the typo detector has been silenced
// rather than corrected.
// ---------------------------------------------------------------------------

describe("D-3 — W-TAILWIND-UNRECOGNIZED-CLASS still bites", () => {
  test("a misspelled outline class does NOT resolve", () => {
    expect(getTailwindCSS("outlin-none")).toBeNull();
    expect(getTailwindCSS("outline-nonee")).toBeNull();
    expect(getTailwindCSS("outline-bogus")).toBeNull();
    expect(getTailwindCSS("outline-offset-bogus")).toBeNull();
  });

  test("a misspelled outline class STILL fires the lint", () => {
    const source = `<button class="outlin-none">x</>`;
    const diags = findUnrecognizedClasses(source);
    expect(diags.length).toBe(1);
    expect(diags[0].className).toBe("outlin-none");
    expect(diags[0].code).toBe("W-TAILWIND-UNRECOGNIZED-CLASS");
  });

  test("real and bogus outline classes in the SAME attribute are separated correctly", () => {
    const source = `<button class="outline-none outline-bogus outline-2 outlin-none">x</>`;
    const diags = findUnrecognizedClasses(source);
    expect(diags.map((d) => d.className).sort()).toEqual(["outlin-none", "outline-bogus"]);
  });

  test("an unrelated bogus class is untouched by this change", () => {
    const source = `<button class="flex definitely-not-a-utility p-4">x</>`;
    const diags = findUnrecognizedClasses(source);
    expect(diags.map((d) => d.className)).toEqual(["definitely-not-a-utility"]);
  });
});
