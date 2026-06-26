/**
 * g-tailwind-group-parent-state-variant.test.js — ss29 item 3 (flogence S14).
 *
 * COVERAGE GAP: `group` + `group-{state}:X` were unsupported. Both fired
 * W-TAILWIND-UNRECOGNIZED-CLASS, `group-{state}:X` also fired W-TAILWIND-001,
 * and NO CSS was generated. Unlike a single-element `hover:X` (a `:pseudo`
 * SUFFIX on the class), `group-hover:X` is a PARENT-STATE variant: it styles X
 * only when an ANCESTOR carrying the `group` marker class is in the named state,
 * which requires a DESCENDANT-COMBINATOR selector — NOT a pseudo suffix.
 *
 * Fix = a new variant KIND ("parent-state"):
 *   - `parseClassName` recognizes a `group-{state}` prefix (for the full
 *     STATE_PSEUDO_CLASSES set) and threads a `parentState` field.
 *   - `wrapWithVariants` wraps the resolved base declarations in a
 *     `.group:<pseudo> .<escaped-full-class> { … }` descendant rule.
 *   - the bare `group` token is a recognized MARKER class — neither tailwind
 *     lint fires, but it emits NO CSS rule (Tailwind emits nothing for
 *     `.group`; it is only an ancestor hook).
 *   - `peer-*` (sibling-state) stays deferred — §26.5 / SPEC-ISSUE-012.
 *
 * Canonical Tailwind v3 emission:
 *   group-hover:p-4 -> `.group:hover .group-hover\:p-4 { padding: 1rem }`
 *
 * Coverage:
 *   §1  group-hover:X -> descendant-combinator rule (NOT pseudo suffix)
 *   §2  the full STATE_PSEUDO_CLASSES set (focus/active/disabled/first/…)
 *   §3  group marker — recognized, emits NO rule
 *   §4  arbitrary value under group-{state}
 *   §5  responsive stacking (md:group-hover:X)
 *   §6  getAllUsedCSS — group + group-hover:X together
 *   §7  lint regression — group / group-{state}:X fire NO W-TAILWIND-001
 *   §8  lint regression — group / group-{state}:X fire NO W-TAILWIND-UNRECOGNIZED-CLASS
 *   §9  still-deferred guard — peer-hover:X / group-bogus:X STILL fire W-TAILWIND-001
 */

import { describe, test, expect } from "bun:test";
import {
  getTailwindCSS,
  getAllUsedCSS,
  findUnrecognizedClasses,
  findUnsupportedTailwindShapes,
} from "../../src/tailwind-classes.js";

// ---------------------------------------------------------------------------
// §1: group-hover -> descendant-combinator rule (NOT a :pseudo suffix)
// ---------------------------------------------------------------------------

describe("§1: group-hover descendant combinator", () => {
  test("group-hover:p-4 emits .group:hover .group-hover\\:p-4 { padding: 1rem }", () => {
    const css = getTailwindCSS("group-hover:p-4");
    expect(css).toBe(".group:hover .group-hover\\:p-4 { padding: 1rem }");
  });

  test("the selector is a descendant combinator, NOT a pseudo suffix on the class", () => {
    const css = getTailwindCSS("group-hover:p-4");
    // descendant: `.group:hover .group-hover\:p-4`
    expect(css).toContain(".group:hover .group-hover\\:p-4");
    // NOT the single-element pseudo-suffix shape `.group-hover\:p-4:hover`
    expect(css).not.toContain(".group-hover\\:p-4:hover");
  });

  test("base utility declarations are preserved verbatim under the combinator", () => {
    const css = getTailwindCSS("group-hover:bg-blue-500");
    expect(css).toBe(
      ".group:hover .group-hover\\:bg-blue-500 { background-color: #3b82f6 }",
    );
  });
});

// ---------------------------------------------------------------------------
// §2: the full STATE_PSEUDO_CLASSES set
// ---------------------------------------------------------------------------

describe("§2: full state-pseudo set under group-{state}", () => {
  test("group-focus:p-4", () => {
    expect(getTailwindCSS("group-focus:p-4")).toBe(
      ".group:focus .group-focus\\:p-4 { padding: 1rem }",
    );
  });

  test("group-active:p-4", () => {
    expect(getTailwindCSS("group-active:p-4")).toBe(
      ".group:active .group-active\\:p-4 { padding: 1rem }",
    );
  });

  test("group-disabled:opacity-50", () => {
    expect(getTailwindCSS("group-disabled:opacity-50")).toBe(
      ".group:disabled .group-disabled\\:opacity-50 { opacity: 0.5 }",
    );
  });

  test("group-first maps to the :first-child pseudo", () => {
    const css = getTailwindCSS("group-first:p-4");
    expect(css).toContain(".group:first-child .group-first\\:p-4");
  });

  test("group-focus-within maps to the :focus-within pseudo", () => {
    const css = getTailwindCSS("group-focus-within:p-4");
    expect(css).toContain(".group:focus-within .group-focus-within\\:p-4");
  });
});

// ---------------------------------------------------------------------------
// §3: the bare `group` marker — recognized, NO CSS rule
// ---------------------------------------------------------------------------

describe("§3: group marker class", () => {
  test("getTailwindCSS('group') resolves (non-null) but emits an empty body", () => {
    const css = getTailwindCSS("group");
    // recognized (non-null so lints clear) but produces no rule
    expect(css).not.toBeNull();
    expect(css).toBe("");
  });

  test("getAllUsedCSS(['group']) emits no rule at all", () => {
    expect(getAllUsedCSS(["group"])).toBe("");
  });
});

// ---------------------------------------------------------------------------
// §4: arbitrary value under a parent-state variant
// ---------------------------------------------------------------------------

describe("§4: arbitrary value under group-{state}", () => {
  test("group-hover:p-[1.5rem] wraps the arbitrary decl in the combinator", () => {
    const css = getTailwindCSS("group-hover:p-[1.5rem]");
    expect(css).toBe(
      ".group:hover .group-hover\\:p-\\[1\\.5rem\\] { padding: 1.5rem }",
    );
  });
});

// ---------------------------------------------------------------------------
// §5: responsive stacking
// ---------------------------------------------------------------------------

describe("§5: responsive stacking with parent-state", () => {
  test("md:group-hover:p-4 nests the combinator rule inside the media query", () => {
    const css = getTailwindCSS("md:group-hover:p-4");
    expect(css).toBe(
      "@media (min-width: 768px) { .group:hover .md\\:group-hover\\:p-4 { padding: 1rem } }",
    );
  });
});

// ---------------------------------------------------------------------------
// §6: getAllUsedCSS — group marker + group-hover together
// ---------------------------------------------------------------------------

describe("§6: combined getAllUsedCSS", () => {
  test("['group', 'group-hover:p-4'] emits only the descendant rule", () => {
    const css = getAllUsedCSS(["group", "group-hover:p-4"]);
    expect(css).toBe(".group:hover .group-hover\\:p-4 { padding: 1rem }");
  });
});

// ---------------------------------------------------------------------------
// §7: lint regression — NO W-TAILWIND-001
// ---------------------------------------------------------------------------

describe("§7: W-TAILWIND-001 clears on group / group-{state}", () => {
  test("group-hover:p-4 in a class attribute fires no W-TAILWIND-001", () => {
    const src = `<div class="group"><span class="group-hover:p-4"></span></div>`;
    expect(findUnsupportedTailwindShapes(src)).toEqual([]);
  });

  test("group-focus:bg-blue-500 fires no W-TAILWIND-001", () => {
    const src = `<div class="group-focus:bg-blue-500"></div>`;
    expect(findUnsupportedTailwindShapes(src)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §8: lint regression — NO W-TAILWIND-UNRECOGNIZED-CLASS
// ---------------------------------------------------------------------------

describe("§8: W-TAILWIND-UNRECOGNIZED-CLASS clears on group / group-{state}", () => {
  test("group marker fires no unrecognized-class lint", () => {
    const src = `<div class="group"></div>`;
    expect(findUnrecognizedClasses(src)).toEqual([]);
  });

  test("group-hover:p-4 fires no unrecognized-class lint", () => {
    const src = `<span class="group-hover:p-4"></span>`;
    expect(findUnrecognizedClasses(src)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §9: still-deferred guard — peer-* and unknown group-states STILL warn
// ---------------------------------------------------------------------------

describe("§9: deferred shapes still fire W-TAILWIND-001", () => {
  test("peer-hover:p-4 (sibling-state, deferred) STILL fires W-TAILWIND-001", () => {
    expect(getTailwindCSS("peer-hover:p-4")).toBeNull();
    const src = `<div class="peer-hover:p-4"></div>`;
    const codes = findUnsupportedTailwindShapes(src).map((d) => d.code);
    expect(codes).toContain("W-TAILWIND-001");
  });

  test("group-bogus:p-4 (unknown state) resolves to null and STILL fires W-TAILWIND-001", () => {
    expect(getTailwindCSS("group-bogus:p-4")).toBeNull();
    const src = `<div class="group-bogus:p-4"></div>`;
    const codes = findUnsupportedTailwindShapes(src).map((d) => d.code);
    expect(codes).toContain("W-TAILWIND-001");
  });
});
