/**
 * bug-1-tailwind-unrecognized-class — Unit tests for W-TAILWIND-UNRECOGNIZED-CLASS
 *
 * Dogfood Bug 1 FLOOR fix (S108). The full bug surface is at
 * `handOffs/incoming/read/2026-05-19-0614-side-session-to-scrmlTS-PA-dogfood-bug-surface.md`
 * §"Bug 1". This lint converts the silent-no-op layout-breakage surface
 * into compile-time friction: any class-name token in a `class="..."`
 * attribute that does NOT resolve via the embedded Tailwind registry
 * emits a `W-TAILWIND-UNRECOGNIZED-CLASS` info-level diagnostic.
 *
 * Three legitimate causes the lint message points adopters at:
 *   (a) misspelling — `flexx` vs `flex`
 *   (b) Tailwind arbitrary-value class whose particular utility prefix
 *       is not yet supported by the embedded engine — e.g.
 *       `skew-[10deg]` (S109 full fix landed grid-cols-/
 *       grid-rows-/col-span-/row-span-/aspect-/flex-/grow-/shrink-/
 *       order-/basis-/col-start/end-/row-start/end-/aspect- families,
 *       but transition / transform / outline / ring / scale / etc. are
 *       still deferred)
 *   (c) custom user-defined CSS class (acknowledged false positive)
 *
 * S109 amendment: previously the §2 / §7 / §8 cases used
 * `grid-cols-[auto_1fr_auto]` (the dogfood Bug 1 headline) as the
 * canonical unrecognized arbitrary-value class. That family is NOW
 * supported by the engine (`grid-template-columns: auto 1fr auto`); the
 * §1 NEW tests assert it. The unrecognized-arbitrary tests rotated to
 * `skew-[10deg]` (a still-unsupported family).
 *
 * Coverage:
 *   §1  Recognized utilities — no warning (incl. S109-new families)
 *   §2  Arbitrary-value class that engine doesn't handle — warning
 *   §3  Misspelled utility — warning
 *   §4  Mixed recognized + unrecognized — warning only on the unrecognized
 *   §5  Custom (non-tailwind) hyphenated class — warning (acknowledged FP)
 *   §6  Suppression via compilerSettings.lintTailwindUnrecognizedClass="off"
 *   §7  Integration via compileScrml.lintDiagnostics
 *   §8  Diagnostic shape (code, severity, message, line, column)
 *   §9  Dedupe within attribute + sort
 *   §10 ${...} interpolation masking
 */

import { describe, test, expect } from "bun:test";
import { findUnrecognizedClasses } from "../../src/tailwind-classes.js";
import { compileScrml } from "../../src/api.js";
import { writeFileSync, unlinkSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function scan(source) {
  return findUnrecognizedClasses(source);
}

function firedOn(diags, className) {
  return diags.some(
    d => d.code === "W-TAILWIND-UNRECOGNIZED-CLASS" && d.className === className
  );
}

function compileSource(source, options = {}) {
  const dir = join(
    tmpdir(),
    "scrml-bug1-tailwind-test-" + Math.random().toString(36).slice(2),
  );
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, "test.scrml");
  writeFileSync(filePath, source, "utf8");
  let result;
  try {
    result = compileScrml({
      inputFiles: [filePath],
      outputDir: join(dir, "dist"),
      write: false,
      ...options,
    });
  } finally {
    try { unlinkSync(filePath); } catch {}
  }
  return result;
}

// ---------------------------------------------------------------------------
// §1 Recognized utilities — no warning
// ---------------------------------------------------------------------------

describe("§1 Recognized Tailwind utilities — no warning fires", () => {
  test("base utility `flex` does not fire", () => {
    const diags = scan('<div class="flex"></div>');
    expect(diags).toHaveLength(0);
  });

  test("base utility `p-4` does not fire", () => {
    const diags = scan('<div class="p-4"></div>');
    expect(diags).toHaveLength(0);
  });

  test("multiple recognized utilities do not fire", () => {
    const diags = scan('<div class="flex items-center justify-between p-4 bg-blue-500"></div>');
    expect(diags).toHaveLength(0);
  });

  test("variant-prefixed recognized utility (`md:p-4`) does not fire", () => {
    const diags = scan('<div class="md:p-4"></div>');
    expect(diags).toHaveLength(0);
  });

  test("recognized arbitrary-value utility (`w-[420px]`) does not fire", () => {
    // Per §26.4, valid arbitrary values produce CSS via getTailwindCSS.
    const diags = scan('<div class="w-[420px]"></div>');
    expect(diags).toHaveLength(0);
  });

  test("recognized arbitrary-value with function (`text-[clamp(1rem,2vw,1.5rem)]`) does not fire", () => {
    const diags = scan('<span class="text-[clamp(1rem,2vw,1.5rem)]"></span>');
    expect(diags).toHaveLength(0);
  });

  test("empty `class=` attribute produces no diagnostics", () => {
    const diags = scan('<div class=""></div>');
    expect(diags).toHaveLength(0);
  });

  test("element without `class=` attribute produces no diagnostics", () => {
    const diags = scan('<div></div><span>hi</span>');
    expect(diags).toHaveLength(0);
  });

  // S109 — dogfood Bug 1 FULL fix landed: `grid-cols-[<list>]` etc. now
  // emit real CSS via getTailwindCSS, so the floor lint stops firing on
  // these. Asserted explicitly so a future regression on the engine side
  // is caught immediately (the engine and the lint share a single
  // source-of-truth via getTailwindCSS).
  test("S109 dogfood Bug 1 headline `grid-cols-[auto_1fr_auto]` no longer fires (engine emits CSS)", () => {
    const diags = scan('<div class="grid-cols-[auto_1fr_auto]"></div>');
    expect(diags).toHaveLength(0);
  });

  test("S109 — col-span-[2] no longer fires", () => {
    const diags = scan('<div class="col-span-[2]"></div>');
    expect(diags).toHaveLength(0);
  });

  test("S109 — aspect-[16/9] no longer fires", () => {
    const diags = scan('<div class="aspect-[16/9]"></div>');
    expect(diags).toHaveLength(0);
  });

  test("S109 — flex-[1_1_0] no longer fires", () => {
    const diags = scan('<div class="flex-[1_1_0]"></div>');
    expect(diags).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §2 Arbitrary-value class that engine doesn't handle — warning
// ---------------------------------------------------------------------------

describe("§2 Arbitrary-value class engine doesn't handle — warning fires", () => {
  // S109 — after the full fix landed grid-cols-/col-span-/aspect-/etc.,
  // the canonical unrecognized arbitrary-value pattern is now a
  // still-unsupported family. transition-/transform-/outline-/ring- are
  // viable; transition-[<list>] is a realistic adopter case.
  test("`skew-[10deg]` fires (still-unsupported family)", () => {
    // transition is not in ARBITRARY_PREFIX_MAP (S109 scope is grid/flex
    // families; transition + transform are future expansion).
    const diags = scan('<div class="skew-[10deg]"></div>');
    expect(firedOn(diags, "skew-[10deg]")).toBe(true);
  });

  // S109 update: `ring-[length]` / `ring-[color]` / `ring-[var()]` /
  // `ring-[keyword]` are SHIPPED via ARBITRARY_DECL_TRANSFORM. See
  // `bug-1-tailwind-ring-family.test.js`. S210 sub-arc 3: arbitrary
  // `ring-offset-[<len>]` / `ring-offset-[<color>]` are now ALSO shipped,
  // mirroring the named ring-offset-{w}/{color} utilities under the same
  // inline-fallback compose model (no preflight block — the prior "needs
  // preflight machinery" framing was incorrect; Approach C never needed it).
  test("`ring-offset-[2px]` is now RECOGNIZED — does not fire (S210 sub-arc 3)", () => {
    const diags = scan('<div class="ring-offset-[2px]"></div>');
    expect(firedOn(diags, "ring-offset-[2px]")).toBe(false);
  });

  test("`bare skew-[10deg]` (no axis) still fires (no bare-skew utility)", () => {
    // Sanity control — a genuinely-unsupported arbitrary family still lints.
    const diags = scan('<div class="skew-[45deg]"></div>');
    expect(firedOn(diags, "skew-[45deg]")).toBe(true);
  });

  test("`bg-gradient-to-r` is now RECOGNIZED — does not fire (S191 Phase 2 gradient family)", () => {
    const diags = scan('<div class="bg-gradient-to-r"></div>');
    expect(firedOn(diags, "bg-gradient-to-r")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §3 Misspelled utility — warning
// ---------------------------------------------------------------------------

describe("§3 Misspelled utility — warning fires", () => {
  test("`flexx` (misspelling of `flex`) fires", () => {
    const diags = scan('<div class="flexx"></div>');
    expect(firedOn(diags, "flexx")).toBe(true);
  });

  test("`p-99` (out-of-scale spacing) fires", () => {
    // p-99 is not in the SPACING_SCALE registry (max is p-96 + special
    // entries); adopter likely meant p-9 or p-96.
    const diags = scan('<div class="p-99"></div>');
    expect(firedOn(diags, "p-99")).toBe(true);
  });

  test("`bg-bluuue-500` (color typo) fires", () => {
    const diags = scan('<div class="bg-bluuue-500"></div>');
    expect(firedOn(diags, "bg-bluuue-500")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §4 Mixed recognized + unrecognized — warning only on the unrecognized
// ---------------------------------------------------------------------------

describe("§4 Mixed recognized + unrecognized — fires only on the unrecognized", () => {
  test("`flex flexx items-center` fires once on `flexx` only", () => {
    const diags = scan('<div class="flex flexx items-center"></div>');
    expect(firedOn(diags, "flexx")).toBe(true);
    expect(firedOn(diags, "flex")).toBe(false);
    expect(firedOn(diags, "items-center")).toBe(false);
    expect(diags).toHaveLength(1);
  });

  test("recognized + unrecognized + recognized arbitrary fires only on the unrecognized", () => {
    // S109 — grid-cols-[<list>] now supported, rotated to transition-[...]
    const diags = scan('<div class="flex skew-[10deg] w-[420px]"></div>');
    expect(firedOn(diags, "skew-[10deg]")).toBe(true);
    expect(firedOn(diags, "flex")).toBe(false);
    expect(firedOn(diags, "w-[420px]")).toBe(false);
    expect(diags).toHaveLength(1);
  });

  test("multiple unrecognized fire each", () => {
    const diags = scan('<div class="flex flexx p-99 bg-bluuue-500 items-center"></div>');
    expect(firedOn(diags, "flexx")).toBe(true);
    expect(firedOn(diags, "p-99")).toBe(true);
    expect(firedOn(diags, "bg-bluuue-500")).toBe(true);
    expect(firedOn(diags, "flex")).toBe(false);
    expect(firedOn(diags, "items-center")).toBe(false);
    expect(diags).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// §5 Custom (non-tailwind) hyphenated class — warning (acknowledged FP)
// ---------------------------------------------------------------------------

describe("§5 Custom hyphenated class — warning fires (acknowledged false-positive)", () => {
  test("`counter-app` fires (false-positive acceptable at floor level)", () => {
    // Adopters whose codebase relies on custom CSS class names will hit
    // this; they can suppress via compilerSettings (see §6).
    const diags = scan('<div class="counter-app"></div>');
    expect(firedOn(diags, "counter-app")).toBe(true);
  });

  test("BEM-style class (`card__header--featured`) fires (FP acceptable)", () => {
    const diags = scan('<div class="card__header--featured"></div>');
    expect(firedOn(diags, "card__header--featured")).toBe(true);
  });

  test("camelCase class (`myCustomClass`) fires (FP acceptable)", () => {
    const diags = scan('<div class="myCustomClass"></div>');
    expect(firedOn(diags, "myCustomClass")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §6 Suppression via compilerSettings.lintTailwindUnrecognizedClass="off"
// ---------------------------------------------------------------------------

describe("§6 Suppression — compilerSettings opt-out", () => {
  test("default behavior (no compilerSettings passed) surfaces the lint", () => {
    const source = '<markup name="app">\n  <div class="flexx"></div>\n</>';
    const result = compileSource(source);
    const diags = (result.lintDiagnostics || []).filter(
      d => d.code === "W-TAILWIND-UNRECOGNIZED-CLASS",
    );
    expect(diags.length).toBeGreaterThan(0);
    expect(diags.some(d => d.className === "flexx")).toBe(true);
  });

  test("compilerSettings.lintTailwindUnrecognizedClass='off' suppresses the lint", () => {
    const source = '<markup name="app">\n  <div class="flexx"></div>\n</>';
    const result = compileSource(source, {
      compilerSettings: { lintTailwindUnrecognizedClass: "off" },
    });
    const diags = (result.lintDiagnostics || []).filter(
      d => d.code === "W-TAILWIND-UNRECOGNIZED-CLASS",
    );
    expect(diags).toHaveLength(0);
  });

  test("compilerSettings.lintTailwindUnrecognizedClass='warn' (explicit) surfaces the lint", () => {
    const source = '<markup name="app">\n  <div class="flexx"></div>\n</>';
    const result = compileSource(source, {
      compilerSettings: { lintTailwindUnrecognizedClass: "warn" },
    });
    const diags = (result.lintDiagnostics || []).filter(
      d => d.code === "W-TAILWIND-UNRECOGNIZED-CLASS",
    );
    expect(diags.length).toBeGreaterThan(0);
  });

  test("suppression does not affect W-TAILWIND-001 (independent code)", () => {
    // The opt-out is per-code; W-TAILWIND-001 keeps firing on its own scope.
    const source = '<markup name="app">\n  <div class="group-hover:p-4"></div>\n</>';
    const result = compileSource(source, {
      compilerSettings: { lintTailwindUnrecognizedClass: "off" },
    });
    const tailwind001 = (result.lintDiagnostics || []).filter(
      d => d.code === "W-TAILWIND-001",
    );
    expect(tailwind001.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// §7 Integration via compileScrml.lintDiagnostics
// ---------------------------------------------------------------------------

describe("§7 Integration — compileScrml surfaces the lint in lintDiagnostics", () => {
  test("`skew-[10deg]` shows up in lintDiagnostics (S109 rotated case)", () => {
    // Previously this asserted grid-cols-[auto_1fr_auto], which is now
    // a recognized class per S109. transition-[...] is the rotated case.
    const source =
      '<markup name="app">\n' +
      '  <div class="skew-[10deg]"></div>\n' +
      '</>';
    const result = compileSource(source);
    const diags = (result.lintDiagnostics || []).filter(
      d => d.code === "W-TAILWIND-UNRECOGNIZED-CLASS",
    );
    expect(diags.some(d => d.className === "skew-[10deg]")).toBe(true);
  });

  test("lint is non-fatal — compilation still succeeds", () => {
    const source =
      '<markup name="app">\n' +
      '  <div class="flexx skew-[10deg]"></div>\n' +
      '</>';
    const result = compileSource(source);
    // The unrecognized-class lint is info-level: no E-* code, no fatal exit.
    const fatalErrors = result.errors.filter(e => !e.code?.startsWith("W-") && !e.code?.startsWith("I-"));
    expect(fatalErrors).toHaveLength(0);
    const outputs = [...result.outputs.values()];
    expect(outputs.length).toBe(1);
  });

  test("recognized-only source produces no W-TAILWIND-UNRECOGNIZED-CLASS diagnostics", () => {
    const source =
      '<markup name="app">\n' +
      '  <div class="flex items-center p-4 bg-blue-500"></div>\n' +
      '</>';
    const result = compileSource(source);
    const diags = (result.lintDiagnostics || []).filter(
      d => d.code === "W-TAILWIND-UNRECOGNIZED-CLASS",
    );
    expect(diags).toHaveLength(0);
  });

  test("lintDiagnostics entry carries filePath (consumed by dev-server formatter)", () => {
    const source =
      '<markup name="app">\n' +
      '  <div class="flexx"></div>\n' +
      '</>';
    const result = compileSource(source);
    const diags = (result.lintDiagnostics || []).filter(
      d => d.code === "W-TAILWIND-UNRECOGNIZED-CLASS",
    );
    expect(diags.length).toBeGreaterThan(0);
    expect(typeof diags[0].filePath).toBe("string");
    expect(diags[0].filePath.endsWith(".scrml")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §8 Diagnostic shape
// ---------------------------------------------------------------------------

describe("§8 Diagnostic shape", () => {
  test("carries code, severity, className, line, column, message", () => {
    // S109 — rotated from grid-cols-[auto_1fr_auto] (now supported) to
    // skew-[10deg] (still unsupported family).
    const diags = scan('<div class="skew-[10deg]"></div>');
    expect(diags).toHaveLength(1);
    const d = diags[0];
    expect(d.code).toBe("W-TAILWIND-UNRECOGNIZED-CLASS");
    expect(d.severity).toBe("info");
    expect(d.className).toBe("skew-[10deg]");
    expect(typeof d.line).toBe("number");
    expect(typeof d.column).toBe("number");
    expect(d.line).toBeGreaterThan(0);
    expect(d.column).toBeGreaterThan(0);
    expect(typeof d.message).toBe("string");
    // Message names the three legitimate causes to help adopters self-triage.
    expect(d.message).toContain("misspelled");
    expect(d.message).toContain("arbitrary-value");
    expect(d.message).toContain("custom class");
    expect(d.message).toContain("skew-[10deg]");
  });

  test("message points adopters at the #{} CSS shim workaround for arbitrary values", () => {
    const diags = scan('<div class="skew-[10deg]"></div>');
    expect(diags[0].message).toContain("#{}");
  });
});

// ---------------------------------------------------------------------------
// §9 Dedupe within attribute + sort
// ---------------------------------------------------------------------------

describe("§9 Dedupe + sort", () => {
  test("dedupe — same unrecognized class twice in one attribute fires once", () => {
    const diags = scan('<div class="flexx flexx flexx"></div>');
    const count = diags.filter(d => d.className === "flexx").length;
    expect(count).toBe(1);
  });

  test("diagnostics sorted by line then column", () => {
    const source =
      '<div class="flexx"></div>\n' +
      '  <span class="flexyy">x</span>';
    const diags = scan(source);
    expect(diags).toHaveLength(2);
    expect(diags[0].line).toBeLessThanOrEqual(diags[1].line);
    if (diags[0].line === diags[1].line) {
      expect(diags[0].column).toBeLessThan(diags[1].column);
    }
  });
});

// ---------------------------------------------------------------------------
// §10 ${...} interpolation masking
// ---------------------------------------------------------------------------

describe("§10 ${...} interpolation masking — no false positives on JS expr contents", () => {
  test("ternary in dynamic class does not fire on the literal strings", () => {
    // `'a'` and `'b'` are string literals INSIDE a `${...}` block; the mask
    // replaces the block with whitespace before scanning so they don't show
    // up as class-name tokens.
    const diags = scan(`<div class="\${cond ? 'a' : 'b'}"></div>`);
    expect(diags).toHaveLength(0);
  });

  test("static unrecognized class next to a ternary interpolation still fires on the static portion", () => {
    const diags = scan(`<div class="flexx \${cond ? 'a' : 'b'}"></div>`);
    expect(firedOn(diags, "flexx")).toBe(true);
  });

  test("nested ternary in dynamic class does not fire", () => {
    const diags = scan(`<div class="\${a ? (b ? 'x' : 'y') : 'z'}"></div>`);
    expect(diags).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §11 Author-defined `#{}` / `<style>` class selectors — excluded
// (ss15 item-1, g-tailwind-lint-false-fires-on-scoped-class)
//
// A scoped-CSS component that defines `.card` / `.card-title` in a `#{}` block
// and uses `class="card"` previously drew a spurious lint on every
// author-defined class. The lint now text-scans the SAME source for class
// selectors the author defines in their own in-scope CSS and skips them. Typos,
// unsupported arbitrary values, Tailwind utilities, and externally-styled
// classes with NO defining CSS block are UNAFFECTED.
// ---------------------------------------------------------------------------

describe("§11 Author-defined #{}/<style> class selectors — excluded", () => {
  test("class defined in a #{} block used in class=\"\" does NOT fire", () => {
    const source =
      '#{\n' +
      '  .card { padding: 16px; }\n' +
      '  .card-title { font-weight: 600; }\n' +
      '}\n' +
      '<div class="card"><span class="card-title">x</span></div>';
    const diags = scan(source);
    expect(firedOn(diags, "card")).toBe(false);
    expect(firedOn(diags, "card-title")).toBe(false);
    expect(diags).toHaveLength(0);
  });

  test("Tailwind utility still resolves alongside author-defined classes", () => {
    const source =
      '#{ .card { padding: 16px; } }\n' +
      '<div class="card flex p-4"></div>';
    const diags = scan(source);
    expect(firedOn(diags, "card")).toBe(false);
    expect(firedOn(diags, "flex")).toBe(false);
    expect(firedOn(diags, "p-4")).toBe(false);
    expect(diags).toHaveLength(0);
  });

  test("typo still fires even when sibling classes are author-defined", () => {
    const source =
      '#{ .card { padding: 16px; } }\n' +
      '<div class="card crad"></div>';
    const diags = scan(source);
    expect(firedOn(diags, "card")).toBe(false);
    // `crad` is neither a Tailwind utility nor an author-defined selector.
    expect(firedOn(diags, "crad")).toBe(true);
    expect(diags).toHaveLength(1);
  });

  test("class defined in a <style> block is excluded", () => {
    const source =
      '<style>\n' +
      '  .hero { background: navy; }\n' +
      '  .hero-title { color: white; }\n' +
      '</style>\n' +
      '<div class="hero"><h1 class="hero-title">x</h1></div>';
    const diags = scan(source);
    expect(firedOn(diags, "hero")).toBe(false);
    expect(firedOn(diags, "hero-title")).toBe(false);
    expect(diags).toHaveLength(0);
  });

  test("comma-grouped, compound, descendant, child, and pseudo selectors all register", () => {
    const source =
      '#{\n' +
      '  .alpha, .beta { color: red; }\n' +
      '  .gamma.active { color: blue; }\n' +
      '  .parent .child { color: green; }\n' +
      '  .grid > .row { display: flex; }\n' +
      '  .link:hover { text-decoration: underline; }\n' +
      '  .badge::before { content: ""; }\n' +
      '}\n' +
      '<div class="alpha"></div>' +
      '<div class="beta"></div>' +
      '<div class="gamma"></div>' +
      '<div class="active"></div>' +
      '<div class="parent"></div>' +
      '<div class="child"></div>' +
      '<div class="grid"></div>' +
      '<div class="row"></div>' +
      '<div class="link"></div>' +
      '<div class="badge"></div>';
    const diags = scan(source);
    expect(diags).toHaveLength(0);
  });

  test("CSS numeric fractions (`0.5rem`) are NOT mistaken for class selectors", () => {
    // `.5rem` / `0.5rem` start with a digit after the dot — not a class
    // selector. A genuinely-unrecognized class alongside them must still fire.
    const source =
      '#{ .box { margin: 0.5rem; padding: .25rem; } }\n' +
      '<div class="box flexx"></div>';
    const diags = scan(source);
    expect(firedOn(diags, "box")).toBe(false);
    expect(firedOn(diags, "flexx")).toBe(true);
    expect(diags).toHaveLength(1);
  });

  test("externally-styled class with NO defining CSS block STILL fires", () => {
    // No #{}/<style> defines `.counter-app` -> the acknowledged false-positive
    // floor behavior is preserved; only IN-SOURCE author-defined selectors are
    // excluded.
    const source = '<div class="counter-app"></div>';
    const diags = scan(source);
    expect(firedOn(diags, "counter-app")).toBe(true);
  });

  test("component-scope #{} (inside a const X = <div>) is also excluded", () => {
    // Mirrors the R26 repro: a #{} living inside a component definition.
    const source =
      'const Card = <div props={ label: string }>\n' +
      '    #{\n' +
      '        .card { padding: 16px; }\n' +
      '        .card-title { font-weight: 600; }\n' +
      '    }\n' +
      '    <div class="card"><span class="card-title">x</span></div>\n' +
      '</div>';
    const diags = scan(source);
    expect(firedOn(diags, "card")).toBe(false);
    expect(firedOn(diags, "card-title")).toBe(false);
    expect(diags).toHaveLength(0);
  });
});
