/**
 * bug-1-tailwind-ring-family.test.js — Bug 1 ring/shadow composing family.
 *
 * S109 partial closure added arbitrary `ring-*` (single-property box-shadow).
 * Phase 1 (S191, Approach C / §26.7) made ring + shadow COMPOSE: the COLOR
 * arbitrary forms now set `--tw-ring-color` and emit the composing box-shadow
 * shorthand (`box-shadow: var(--tw-ring-offset-shadow,...), var(--tw-ring-shadow,...),
 * var(--tw-shadow,...)`) with INLINE var() fallbacks (no global preflight block).
 * The WIDTH arbitrary form was also made C-style (S191 consistency fix) so
 * `ring-[<width>]` composes too (was single-property at the original Phase-1 cut).
 *
 * Phase-1 landed (no longer deferred): ring-offset-*, ring-inset, ring-{color},
 * shadow-* composition. Phase 2 (S191, Approach C / §26.7) landed the gradient
 * family (bg-gradient-to-* / from-* / via-* / to-*) — see
 * bug-1-tailwind-gradient-family.test.js. Nothing in the bug-1 filed scope
 * remains deferred (transform/filter are the Phase 3-4 follow-on arc).
 *
 * Coverage:
 *   §1  ring-[length] — C-style: --tw-ring-shadow (currentColor) + compose shorthand (S191 width fix)
 *   §2  ring-[color]  — C-style: sets --tw-ring-color + compose shorthand
 *   §3  ring-[var()] — C-style: var as ring-color + compose shorthand
 *   §4  ring-[keyword] — C-style: currentColor / transparent ring-color + compose shorthand
 *   §5  lint regression — ring-[N] no longer fires W-TAILWIND-UNRECOGNIZED-CLASS
 *   §6  ring-offset-[2px] + bg-gradient/from/to/via ALL now RECOGNIZED (no lint) — Phase 1 + Phase 2
 *   §7  responsive + dark variants — md:ring-[3px] (width) / dark:ring-[red] (C-style color) compose
 */

import { describe, test, expect } from "bun:test";
import { getAllUsedCSS, getTailwindCSS, findUnrecognizedClasses } from "../../src/tailwind-classes.js";

function cssFor(classNames) {
  return getAllUsedCSS(classNames.split(" "));
}

// ---------------------------------------------------------------------------
// §1: ring-[length] — set ring width with currentColor
// ---------------------------------------------------------------------------

describe("§1: ring-[length] sets --tw-ring-shadow (currentColor) and composes", () => {
  // S191 consistency fix: arbitrary ring-[<width>] is now C-style (composes with
  // shadow-*), matching named ring-{w}; was single-property (collided) before.
  test("ring-[3px] sets the width via --tw-ring-shadow + the compose shorthand (now composes)", () => {
    const css = cssFor("ring-[3px]");
    expect(css).toContain("calc(3px + var(--tw-ring-offset-width, 0px))");
    expect(css).toContain("var(--tw-ring-color, currentColor)");
    expect(css).toContain(
      "box-shadow: var(--tw-ring-offset-shadow, 0 0 #0000), var(--tw-ring-shadow, 0 0 #0000), var(--tw-shadow, 0 0 #0000)",
    );
    // the old single-property collision form is gone
    expect(css).not.toContain("box-shadow: 0 0 0 3px currentColor");
  });

  test("ring-[1px] composes with 1px width", () => {
    const css = cssFor("ring-[1px]");
    expect(css).toContain("calc(1px + var(--tw-ring-offset-width, 0px))");
    expect(css).toContain("box-shadow: var(--tw-ring-offset-shadow, 0 0 #0000)");
  });

  test("ring-[2.5rem] accepts rem unit", () => {
    const css = cssFor("ring-[2.5rem]");
    expect(css).toContain("calc(2.5rem + var(--tw-ring-offset-width, 0px))");
  });

  test("ring-[0.5em] accepts em unit", () => {
    const css = cssFor("ring-[0.5em]");
    expect(css).toContain("calc(0.5em + var(--tw-ring-offset-width, 0px))");
  });
});

// ---------------------------------------------------------------------------
// §2: ring-[color] — set ring color with default 3px width
// ---------------------------------------------------------------------------

describe("§2: ring-[color] sets --tw-ring-color and emits the compose shorthand", () => {
  test("ring-[#ff0000] sets the ring-color var (3px default ring) and composes", () => {
    const css = cssFor("ring-[#ff0000]");
    expect(css).toContain("--tw-ring-color: #ff0000");
    // composing shorthand with the three inline-fallback layers
    expect(css).toContain(
      "box-shadow: var(--tw-ring-offset-shadow, 0 0 #0000), var(--tw-ring-shadow, 0 0 #0000), var(--tw-shadow, 0 0 #0000)",
    );
    // default 3px ring width via --tw-ring-shadow
    expect(css).toContain("calc(3px + var(--tw-ring-offset-width, 0px))");
  });

  test("ring-[red] uses a bare color keyword as the ring color", () => {
    const css = cssFor("ring-[red]");
    expect(css).toContain("--tw-ring-color: red");
    expect(css).toContain("box-shadow: var(--tw-ring-offset-shadow, 0 0 #0000)");
  });

  test("ring-[rgb(255,0,0)] uses an rgb() function color", () => {
    const css = cssFor("ring-[rgb(255,0,0)]");
    expect(css).toContain("--tw-ring-color: rgb(255,0,0)");
    expect(css).toContain("box-shadow: var(--tw-ring-offset-shadow, 0 0 #0000)");
  });

  test("ring-[hsl(120,100%,50%)] uses an hsl() function color", () => {
    const css = cssFor("ring-[hsl(120,100%,50%)]");
    expect(css).toContain("--tw-ring-color: hsl(120,100%,50%)");
    expect(css).toContain("box-shadow: var(--tw-ring-offset-shadow, 0 0 #0000)");
  });
});

// ---------------------------------------------------------------------------
// §3: ring-[var()] — CSS custom property reference
// ---------------------------------------------------------------------------

describe("§3: ring-[var()] uses a CSS variable as the ring color (C-style)", () => {
  test("ring-[var(--ring-color)] sets the ring-color var and composes", () => {
    const css = cssFor("ring-[var(--ring-color)]");
    expect(css).toContain("--tw-ring-color: var(--ring-color)");
    expect(css).toContain("box-shadow: var(--tw-ring-offset-shadow, 0 0 #0000)");
  });

  test("ring-[var(--my-color,red)] supports a fallback inside var()", () => {
    const css = cssFor("ring-[var(--my-color,red)]");
    expect(css).toContain("--tw-ring-color: var(--my-color,red)");
    expect(css).toContain("box-shadow: var(--tw-ring-offset-shadow, 0 0 #0000)");
  });
});

// ---------------------------------------------------------------------------
// §4: ring-[keyword] — currentColor / transparent / inherit etc.
// ---------------------------------------------------------------------------

describe("§4: ring-[keyword] uses a CSS keyword as the ring color (C-style)", () => {
  test("ring-[currentColor] sets the ring-color var and composes", () => {
    const css = cssFor("ring-[currentColor]");
    expect(css).toContain("--tw-ring-color: currentColor");
    expect(css).toContain("box-shadow: var(--tw-ring-offset-shadow, 0 0 #0000)");
  });

  test("ring-[transparent] sets a transparent ring color", () => {
    const css = cssFor("ring-[transparent]");
    expect(css).toContain("--tw-ring-color: transparent");
    expect(css).toContain("box-shadow: var(--tw-ring-offset-shadow, 0 0 #0000)");
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

describe("§6: ring-offset (Phase 1) + gradient family (Phase 2) ALL recognized — no W-TAILWIND-UNRECOGNIZED-CLASS", () => {
  test("ring-offset-2 is RECOGNIZED — no lint (Phase 1 landed the named utility)", () => {
    const diags = findUnrecognizedClasses(
      '<div class="ring-offset-2">x</div>',
      "test.scrml"
    );
    expect(diags).toEqual([]);
  });

  test("bg-gradient-to-r is now RECOGNIZED — no lint (Phase 2 landed the gradient family)", () => {
    const diags = findUnrecognizedClasses(
      '<div class="bg-gradient-to-r">x</div>',
      "test.scrml"
    );
    expect(diags).toEqual([]);
  });

  test("from-[#ff0000] is now RECOGNIZED — no lint (Phase 2 arbitrary gradient stop)", () => {
    const diags = findUnrecognizedClasses(
      '<div class="from-[#ff0000]">x</div>',
      "test.scrml"
    );
    expect(diags).toEqual([]);
  });

  test("to-[#0000ff] is now RECOGNIZED — no lint (Phase 2 arbitrary gradient stop)", () => {
    const diags = findUnrecognizedClasses(
      '<div class="to-[#0000ff]">x</div>',
      "test.scrml"
    );
    expect(diags).toEqual([]);
  });

  test("via-[#00ff00] is now RECOGNIZED — no lint (Phase 2 arbitrary gradient stop)", () => {
    const diags = findUnrecognizedClasses(
      '<div class="via-[#00ff00]">x</div>',
      "test.scrml"
    );
    expect(diags).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §7: variant prefixes compose (responsive / dark / hover etc.)
// ---------------------------------------------------------------------------

describe("§7: ring-* composes with variant prefixes", () => {
  test("md:ring-[3px] wraps the C-style width emit in @media (min-width: 768px)", () => {
    const css = cssFor("md:ring-[3px]");
    expect(css).toContain("@media (min-width: 768px)");
    expect(css).toContain("calc(3px + var(--tw-ring-offset-width, 0px))");
    expect(css).toContain("box-shadow: var(--tw-ring-offset-shadow, 0 0 #0000)");
  });

  test("dark:ring-[red] wraps the C-style color emit in @media (prefers-color-scheme: dark)", () => {
    const css = cssFor("dark:ring-[red]");
    expect(css).toContain("@media (prefers-color-scheme: dark)");
    expect(css).toContain("--tw-ring-color: red");
    expect(css).toContain("box-shadow: var(--tw-ring-offset-shadow, 0 0 #0000)");
  });

  test("hover:ring-[3px] uses :hover state selector (C-style width)", () => {
    const css = cssFor("hover:ring-[3px]");
    expect(css).toContain(":hover");
    expect(css).toContain("calc(3px + var(--tw-ring-offset-width, 0px))");
    expect(css).toContain("box-shadow: var(--tw-ring-offset-shadow, 0 0 #0000)");
  });

  test("focus:ring-[2px] uses :focus state selector (C-style width)", () => {
    const css = cssFor("focus:ring-[2px]");
    expect(css).toContain(":focus");
    expect(css).toContain("calc(2px + var(--tw-ring-offset-width, 0px))");
    expect(css).toContain("box-shadow: var(--tw-ring-offset-shadow, 0 0 #0000)");
  });
});

// ---------------------------------------------------------------------------
// §8: named ring widths — ring-2 alone sets --tw-ring-shadow + compose shorthand
// ---------------------------------------------------------------------------

describe("§8: named ring-{width} sets --tw-ring-shadow and the compose shorthand", () => {
  test("ring-2 alone emits the --tw-ring-shadow setter with inline fallbacks", () => {
    const css = cssFor("ring-2");
    // the per-utility setter (2px width + offset accounting + currentColor default)
    expect(css).toContain(
      "--tw-ring-shadow: var(--tw-ring-inset,) 0 0 0 calc(2px + var(--tw-ring-offset-width, 0px)) var(--tw-ring-color, currentColor)",
    );
    // the composing shorthand with all three inline-fallback layers
    expect(css).toContain(
      "box-shadow: var(--tw-ring-offset-shadow, 0 0 #0000), var(--tw-ring-shadow, 0 0 #0000), var(--tw-shadow, 0 0 #0000)",
    );
  });

  test("bare ring == 3px default width", () => {
    const css = cssFor("ring");
    expect(css).toContain("calc(3px + var(--tw-ring-offset-width, 0px))");
  });

  test("ring-0 sets a 0px ring", () => {
    const css = cssFor("ring-0");
    expect(css).toContain("calc(0px + var(--tw-ring-offset-width, 0px))");
  });
});

// ---------------------------------------------------------------------------
// §9: shadow-{size} sets --tw-shadow + compose shorthand
// ---------------------------------------------------------------------------

describe("§9: shadow-{size} sets --tw-shadow and the compose shorthand", () => {
  test("shadow-lg alone sets --tw-shadow and emits the shorthand", () => {
    const css = cssFor("shadow-lg");
    expect(css).toContain(
      "--tw-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)",
    );
    expect(css).toContain(
      "box-shadow: var(--tw-ring-offset-shadow, 0 0 #0000), var(--tw-ring-shadow, 0 0 #0000), var(--tw-shadow, 0 0 #0000)",
    );
  });

  test("bare shadow sets the default --tw-shadow", () => {
    const css = cssFor("shadow");
    expect(css).toContain("--tw-shadow: 0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)");
    expect(css).toContain("box-shadow: var(--tw-ring-offset-shadow, 0 0 #0000)");
  });

  test("shadow-none sets the transparent --tw-shadow layer", () => {
    const css = cssFor("shadow-none");
    expect(css).toContain("--tw-shadow: 0 0 #0000");
    expect(css).toContain("box-shadow: var(--tw-ring-offset-shadow, 0 0 #0000)");
  });
});

// ---------------------------------------------------------------------------
// §10: ring + shadow COMPOSE on one element — the bug-1 core fix
// ---------------------------------------------------------------------------

describe("§10: ring-2 shadow-lg compose (both set their var; shorthand stacks)", () => {
  test("ring-2 shadow-lg both emit setters AND the composing shorthand", () => {
    const css = cssFor("ring-2 shadow-lg");
    // ring half
    expect(css).toContain(
      "--tw-ring-shadow: var(--tw-ring-inset,) 0 0 0 calc(2px + var(--tw-ring-offset-width, 0px)) var(--tw-ring-color, currentColor)",
    );
    // shadow half
    expect(css).toContain(
      "--tw-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)",
    );
    // the composing shorthand — all three var() layers present so both compose
    expect(css).toContain("var(--tw-ring-offset-shadow, 0 0 #0000)");
    expect(css).toContain("var(--tw-ring-shadow, 0 0 #0000)");
    expect(css).toContain("var(--tw-shadow, 0 0 #0000)");
    // NO bare single-property collision — every box-shadow is the var() shorthand
    expect(css).not.toContain("box-shadow: 0 10px 15px");
  });
});

// ---------------------------------------------------------------------------
// §11: ring-offset / ring-inset
// ---------------------------------------------------------------------------

describe("§11: ring-offset-{w} and ring-inset", () => {
  test("ring-offset-2 sets the offset width + the offset shadow var", () => {
    const css = cssFor("ring-offset-2");
    expect(css).toContain("--tw-ring-offset-width: 2px");
    expect(css).toContain(
      "--tw-ring-offset-shadow: var(--tw-ring-inset,) 0 0 0 2px var(--tw-ring-offset-color, #fff)",
    );
    expect(css).toContain("box-shadow: var(--tw-ring-offset-shadow, 0 0 #0000)");
  });

  test("ring-inset sets the inset keyword var", () => {
    const css = cssFor("ring-inset");
    expect(css).toContain("--tw-ring-inset: inset");
  });
});

// ---------------------------------------------------------------------------
// §12: ring-{color} / ring-offset-{color} named scales
// ---------------------------------------------------------------------------

describe("§12: ring-{color} and ring-offset-{color} named utilities", () => {
  test("ring-blue-500 sets --tw-ring-color to the blue-500 hex", () => {
    const css = cssFor("ring-blue-500");
    expect(css).toContain("--tw-ring-color: #3b82f6");
  });

  test("ring-offset-white sets --tw-ring-offset-color", () => {
    const css = cssFor("ring-offset-white");
    expect(css).toContain("--tw-ring-offset-color: #ffffff");
  });
});

// ---------------------------------------------------------------------------
// §13: ARBITRARY ring-offset-[<len>] / [<color>] (S210, sub-arc 3)
//
// Mirrors the named ring-offset-{w} (width + offset shadow var + compose
// shorthand) and ring-offset-{color} (offset color var only). The exact-key
// declTransform lookup for prefix `ring-offset` hits these, NOT `ring`.
// Escaped selectors computed by running the engine (not hand-guessed).
// ---------------------------------------------------------------------------

describe("§13: arbitrary ring-offset-[<len>] / [<color>] (S210)", () => {
  test("ring-offset-[2px] — width form: offset width + offset shadow var + compose shorthand", () => {
    const css = getTailwindCSS("ring-offset-[2px]");
    expect(css).toBe(
      ".ring-offset-\\[2px\\] { --tw-ring-offset-width: 2px; --tw-ring-offset-shadow: var(--tw-ring-inset,) 0 0 0 2px var(--tw-ring-offset-color, #fff); box-shadow: var(--tw-ring-offset-shadow, 0 0 #0000), var(--tw-ring-shadow, 0 0 #0000), var(--tw-shadow, 0 0 #0000) }",
    );
  });

  test("ring-offset-[#ff0000] — color form: sets only the offset color var", () => {
    const css = getTailwindCSS("ring-offset-[#ff0000]");
    expect(css).toBe(".ring-offset-\\[\\#ff0000\\] { --tw-ring-offset-color: #ff0000 }");
  });

  test("ring-offset-[var(--c)] — var color form", () => {
    const css = getTailwindCSS("ring-offset-[var(--c)]");
    expect(css).toBe(".ring-offset-\\[var\\(--c\\)\\] { --tw-ring-offset-color: var(--c) }");
  });

  test("ring-offset-[red] — keyword/ident color form", () => {
    const css = getTailwindCSS("ring-offset-[red]");
    expect(css).toBe(".ring-offset-\\[red\\] { --tw-ring-offset-color: red }");
  });

  test("composition — ring-[3px] ring-offset-[2px] both resolve, no single-property collision", () => {
    const css = cssFor("ring-[3px] ring-offset-[2px]");
    // ring half: width accounts for the offset width via calc
    expect(css).toContain("calc(3px + var(--tw-ring-offset-width, 0px))");
    // offset half: its own width var
    expect(css).toContain("--tw-ring-offset-width: 2px");
    // both emit the shared composing shorthand — no bare single-property box-shadow
    expect(css).toContain(
      "box-shadow: var(--tw-ring-offset-shadow, 0 0 #0000), var(--tw-ring-shadow, 0 0 #0000), var(--tw-shadow, 0 0 #0000)",
    );
    expect(css).not.toContain("box-shadow: 0 0 0 ");
  });

  test("lint regression — ring-offset-[2px] no longer fires W-TAILWIND-UNRECOGNIZED-CLASS", () => {
    const diags = findUnrecognizedClasses('<div class="ring-offset-[2px]">x</div>', "test.scrml");
    expect(diags).toEqual([]);
  });

  test("variant integration — md:ring-offset-[2px] wraps in @media", () => {
    const css = getTailwindCSS("md:ring-offset-[2px]");
    expect(css).toContain("@media (min-width: 768px)");
    expect(css).toContain("--tw-ring-offset-width: 2px");
  });

  test("decl-transform rejects a list value (ring-offset width is single-token)", () => {
    // A list value (`ring-offset-[1px_2px]`) is rejected upstream by the
    // declTransform single-token requirement.
    const css = getTailwindCSS("ring-offset-[1px_2px]");
    expect(css).toBeNull();
  });
});
