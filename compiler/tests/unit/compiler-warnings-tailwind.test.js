/**
 * compiler-warnings-tailwind — Unit Tests for W-TAILWIND-001
 *
 * Tests for `findUnsupportedTailwindShapes` (compiler/src/tailwind-classes.js)
 * and its wiring through `compileScrml` (compiler/src/api.js).
 *
 * W-TAILWIND-001 fires when a class string in a `class="..."` attribute looks
 * like Tailwind variant or arbitrary-value syntax (contains ':' or '[') AND
 * does not match a registered utility. Supported variants (5 responsive +
 * 11 state pseudo-classes + 4 theme media queries dark/print/motion-* +
 * `group-{state}:` parent-state + arbitrary values) produce CSS today;
 * unsupported variants (`peer-*:` sibling-state, custom prefixes) fire the
 * warning. (`group-*` was un-deferred in ss29 item 3 — flogence S14; `peer-*`
 * remains deferred per §26.5 / SPEC-ISSUE-012, so it is now the canonical
 * unsupported-variant fixture in this suite.)
 *
 * Coverage:
 *   §1  Variant prefixes — supported (no fire) vs unsupported (fire)
 *   §2  Arbitrary values (p-[...], bg-[...]) — always fire
 *   §3  Stacked variants — both supported (no fire) and mixed
 *   §4  Negatives — base utilities never fire
 *   §5  Negatives — user-shaped classes (no `:` or `[`)
 *   §6  Mixed attribute — fires only on offenders
 *   §7  Diagnostic shape (code, severity, message, line, column)
 *   §8  Multi-line / multi-attribute coverage
 *   §9  Integration via compileScrml.lintDiagnostics
 *   §10 ${...} interpolation regions are masked (no false positives on ternaries)
 */

import { describe, test, expect } from "bun:test";
import { findUnsupportedTailwindShapes } from "../../src/tailwind-classes.js";
import { compileScrml } from "../../src/api.js";
import { writeFileSync, unlinkSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function scan(source) {
  return findUnsupportedTailwindShapes(source);
}

function fired(diags, className) {
  return diags.some(d => d.code === "W-TAILWIND-001" && d.className === className);
}

function compileSource(source) {
  const dir = join(tmpdir(), "scrml-tailwind-test-" + Math.random().toString(36).slice(2));
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, "test.scrml");
  writeFileSync(filePath, source, "utf8");
  let result;
  try {
    result = compileScrml({
      inputFiles: [filePath],
      outputDir: join(dir, "dist"),
      write: false,
    });
  } finally {
    try { unlinkSync(filePath); } catch {}
  }
  return result;
}

// ---------------------------------------------------------------------------
// §1 Variant prefixes — supported variants don't fire; unsupported do
// ---------------------------------------------------------------------------

describe("§1 Variant prefixes — supported variants do NOT fire", () => {
  test("md:p-4 does NOT fire (responsive prefix in registry)", () => {
    const diags = scan('<div class="md:p-4"></div>');
    expect(diags.length).toBe(0);
  });

  test("hover:bg-blue-500 does NOT fire (state pseudo-class in registry)", () => {
    const diags = scan('<button class="hover:bg-blue-500">x</button>');
    expect(diags.length).toBe(0);
  });

  test("focus:bg-red-500 does NOT fire (state pseudo-class in registry)", () => {
    const diags = scan('<input class="focus:bg-red-500">');
    expect(diags.length).toBe(0);
  });

  test("lg:flex does NOT fire (responsive prefix in registry)", () => {
    const diags = scan('<div class="lg:flex"></div>');
    expect(diags.length).toBe(0);
  });

  test("dark:bg-gray-800 does NOT fire (theme variant added in S49 Tailwind 3)", () => {
    const diags = scan('<div class="dark:bg-gray-800"></div>');
    expect(diags.length).toBe(0);
  });

  test("print:hidden does NOT fire (theme variant added in S49 Tailwind 3)", () => {
    const diags = scan('<div class="print:hidden"></div>');
    expect(diags.length).toBe(0);
  });

  test("motion-safe:flex does NOT fire (theme variant added in S49 Tailwind 3)", () => {
    const diags = scan('<div class="motion-safe:flex"></div>');
    expect(diags.length).toBe(0);
  });
});

describe("§1b Variant prefixes — unsupported variants fire", () => {
  test("peer-focus:bg-blue-500 fires (peer-* sibling-state deferred — §26.5)", () => {
    const diags = scan('<button class="peer-focus:bg-blue-500">x</button>');
    expect(fired(diags, "peer-focus:bg-blue-500")).toBe(true);
    expect(diags.length).toBe(1);
  });

  test("peer-hover:bg-blue-500 fires (peer-* deferred to v2)", () => {
    const diags = scan('<button class="peer-hover:bg-blue-500">x</button>');
    expect(fired(diags, "peer-hover:bg-blue-500")).toBe(true);
  });

  test("custom variant prefix (`weird:p-4`) fires (silent-strip closed S49)", () => {
    const diags = scan('<div class="weird:p-4"></div>');
    expect(fired(diags, "weird:p-4")).toBe(true);
  });

  test("typo'd variant (`hovr:p-4`) fires (not in registry)", () => {
    const diags = scan('<div class="hovr:p-4"></div>');
    expect(fired(diags, "hovr:p-4")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §2 Arbitrary values — DO NOT fire (engine handles them post-Tailwind 3)
// ---------------------------------------------------------------------------
//
// Tailwind 3 (S49) implemented arbitrary-value support per SPEC §26.4.
// Valid bracket content produces CSS via getTailwindCSS; the W-TAILWIND-001
// detector skips it because getTailwindCSS !== null. Invalid arbitrary
// values fire E-TAILWIND-001 (separate compile error, not this warning).

describe("§2 Arbitrary values — do NOT fire (engine handles them)", () => {
  test("p-[1.5rem] does NOT fire (valid CSS length, engine handles)", () => {
    const diags = scan('<div class="p-[1.5rem]"></div>');
    expect(diags.length).toBe(0);
  });

  test("bg-[#ff00ff] does NOT fire (valid hex color, engine handles)", () => {
    const diags = scan('<div class="bg-[#ff00ff]"></div>');
    expect(diags.length).toBe(0);
  });

  test("w-[42px] does NOT fire (valid CSS length, engine handles)", () => {
    const diags = scan('<div class="w-[42px]"></div>');
    expect(diags.length).toBe(0);
  });

  test("text-[14px] does NOT fire (valid CSS length, engine handles)", () => {
    const diags = scan('<span class="text-[14px]">hi</span>');
    expect(diags.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §3 Stacked variants — both-supported don't fire; with arbitrary always fire
// ---------------------------------------------------------------------------

describe("§3 Stacked variants", () => {
  test("sm:hover:bg-blue-500 does NOT fire (both responsive + state in registry)", () => {
    const diags = scan('<button class="sm:hover:bg-blue-500">x</button>');
    expect(diags.length).toBe(0);
  });

  test("md:hover:p-[1.5rem] does NOT fire (stacked supported variants + valid arbitrary)", () => {
    const diags = scan('<div class="md:hover:p-[1.5rem]"></div>');
    expect(diags.length).toBe(0);
  });

  test("lg:bg-[#ff00ff] does NOT fire (supported variant + valid arbitrary)", () => {
    const diags = scan('<div class="lg:bg-[#ff00ff]"></div>');
    expect(diags.length).toBe(0);
  });

  test("dark:hover:bg-blue-500 does NOT fire (theme + state in registry)", () => {
    const diags = scan('<div class="dark:hover:bg-blue-500"></div>');
    expect(diags.length).toBe(0);
  });

  test("weird:hover:p-4 fires (one unsupported variant in chain)", () => {
    const diags = scan('<div class="weird:hover:p-4"></div>');
    expect(fired(diags, "weird:hover:p-4")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §4 Negatives — base utilities never fire
// ---------------------------------------------------------------------------

describe("§4 Base utilities — must NOT fire", () => {
  test("p-4 does not fire (base utility, no variant shape)", () => {
    const diags = scan('<div class="p-4"></div>');
    expect(diags.length).toBe(0);
  });

  test("flex items-center justify-between (multiple base utilities) do not fire", () => {
    const diags = scan('<div class="flex items-center justify-between"></div>');
    expect(diags.length).toBe(0);
  });

  test("bg-blue-500 does not fire (no `:` or `[`)", () => {
    const diags = scan('<div class="bg-blue-500"></div>');
    expect(diags.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §5 Negatives — user-shaped classes (no `:` or `[`)
// ---------------------------------------------------------------------------

describe("§5 User classes — no Tailwind shape, must NOT fire", () => {
  test("my-custom-class does not fire", () => {
    const diags = scan('<div class="my-custom-class"></div>');
    expect(diags.length).toBe(0);
  });

  test("BEM-style (Block__element--modifier) does not fire", () => {
    const diags = scan('<div class="card__header--featured"></div>');
    expect(diags.length).toBe(0);
  });

  test("kebab-case user class with digits does not fire", () => {
    const diags = scan('<div class="user-card-2"></div>');
    expect(diags.length).toBe(0);
  });

  test("empty class= attribute produces no diagnostics", () => {
    const diags = scan('<div class=""></div>');
    expect(diags.length).toBe(0);
  });

  test("element with no class= attribute produces no diagnostics", () => {
    const diags = scan('<div></div><span>hi</span>');
    expect(diags.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §6 Mixed attribute — fires only on offenders
// ---------------------------------------------------------------------------

describe("§6 Mixed attribute — fires only on offenders", () => {
  test("p-4 peer-hover:p-8 my-custom — fires once for peer-hover:p-8", () => {
    const diags = scan('<div class="p-4 peer-hover:p-8 my-custom"></div>');
    expect(fired(diags, "peer-hover:p-8")).toBe(true);
    expect(diags.length).toBe(1);
  });

  test("p-4 md:p-8 my-custom — fires zero times (md:p-8 is supported)", () => {
    const diags = scan('<div class="p-4 md:p-8 my-custom"></div>');
    expect(diags.length).toBe(0);
  });

  test("p-4 p-[1rem] flex — fires zero times (p-[1rem] is valid arbitrary, engine handles)", () => {
    const diags = scan('<div class="p-4 p-[1rem] flex"></div>');
    expect(diags.length).toBe(0);
  });

  test("multiple offenders in one attribute fire once each", () => {
    const diags = scan('<div class="p-4 peer-focus:p-8 peer-hover:flex my-custom"></div>');
    expect(diags.length).toBe(2);
    expect(fired(diags, "peer-focus:p-8")).toBe(true);
    expect(fired(diags, "peer-hover:flex")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §7 Diagnostic shape
// ---------------------------------------------------------------------------

describe("§7 Diagnostic shape", () => {
  test("diagnostic carries code, severity, message, className, line, column", () => {
    const diags = scan('<div class="peer-hover:p-4"></div>');
    expect(diags.length).toBe(1);
    const d = diags[0];
    expect(d.code).toBe("W-TAILWIND-001");
    expect(d.severity).toBe("warning");
    expect(d.className).toBe("peer-hover:p-4");
    expect(typeof d.line).toBe("number");
    expect(typeof d.column).toBe("number");
    expect(d.line).toBeGreaterThan(0);
    expect(d.column).toBeGreaterThan(0);
    expect(d.message).toContain("peer-hover:p-4");
    expect(d.message).toContain("SPEC-ISSUE-012");
  });

  test("message points adopters at supported variants OR custom CSS rule", () => {
    const diags = scan('<div class="peer-hover:p-4"></div>');
    const m = diags[0].message;
    expect(m).toMatch(/supported variant prefix|own CSS rule/i);
  });
});

// ---------------------------------------------------------------------------
// §8 Multi-line / multi-attribute coverage
// ---------------------------------------------------------------------------

describe("§8 Multi-line / multi-attribute coverage", () => {
  test("two class= attributes on different lines both report", () => {
    const source =
      '<div class="peer-focus:p-4">\n' +
      '  <span class="peer-hover:flex">hi</span>\n' +
      '</div>';
    const diags = scan(source);
    expect(fired(diags, "peer-focus:p-4")).toBe(true);
    expect(fired(diags, "peer-hover:flex")).toBe(true);
    expect(diags.length).toBe(2);
  });

  test("diagnostics sorted by line then column", () => {
    const source =
      '<div class="peer-focus:p-4">\n' +
      '  <span class="peer-hover:flex">hi</span>\n' +
      '</div>';
    const diags = scan(source);
    expect(diags.length).toBe(2);
    expect(diags[0].line).toBeLessThanOrEqual(diags[1].line);
    if (diags[0].line === diags[1].line) {
      expect(diags[0].column).toBeLessThan(diags[1].column);
    }
  });

  test("dedupe within a single class= attribute (same offender twice → once)", () => {
    const diags = scan('<div class="peer-hover:p-4 peer-hover:p-4"></div>');
    const count = diags.filter(d => d.className === "peer-hover:p-4").length;
    expect(count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// §9 Integration via compileScrml.lintDiagnostics
// ---------------------------------------------------------------------------

describe("§9 Integration: compileScrml lintDiagnostics field", () => {
  test("compileScrml surfaces W-TAILWIND-001 in lintDiagnostics", () => {
    const source = '<markup name="app">\n  <div class="peer-hover:p-4"></div>\n</>';
    const result = compileSource(source);
    const diags = result.lintDiagnostics || [];
    expect(diags.some(d => d.code === "W-TAILWIND-001" && d.className === "peer-hover:p-4")).toBe(true);
  });

  test("W-TAILWIND-001 is non-fatal — compilation still produces output", () => {
    const source = '<markup name="app">\n  <div class="peer-hover:p-4">x</div>\n</>';
    const result = compileSource(source);
    expect(result.errors.length).toBe(0);
    // Output exists for the file (HTML, client JS) — compilation was not blocked
    const outputs = [...result.outputs.values()];
    expect(outputs.length).toBe(1);
  });

  test("base-utility-only class strings produce no W-TAILWIND-001", () => {
    const source = '<markup name="app">\n  <div class="p-4 flex bg-blue-500">x</div>\n</>';
    const result = compileSource(source);
    const tailwindDiags = (result.lintDiagnostics || []).filter(d => d.code === "W-TAILWIND-001");
    expect(tailwindDiags.length).toBe(0);
  });

  test("supported-variants-only class strings produce no W-TAILWIND-001", () => {
    const source = '<markup name="app">\n  <div class="md:p-4 hover:bg-blue-500 sm:flex">x</div>\n</>';
    const result = compileSource(source);
    const tailwindDiags = (result.lintDiagnostics || []).filter(d => d.code === "W-TAILWIND-001");
    expect(tailwindDiags.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §10 ${...} interpolation regions are masked
// ---------------------------------------------------------------------------
//
// scrml supports dynamic class strings like `class="${cond ? 'a' : 'b'}"`
// (§5.5 dynamic class). The `:` from the ternary inside the interpolation
// must NOT trigger W-TAILWIND-001 — it is JS expression syntax, not a
// Tailwind variant prefix.

describe("§10 ${...} interpolation masking — no false positives", () => {
  test("ternary in dynamic class does not fire", () => {
    const diags = scan(`<div class="\${cond ? 'a' : 'b'}"></div>`);
    expect(diags.length).toBe(0);
  });

  test("nested ternary in dynamic class does not fire", () => {
    const diags = scan(`<div class="\${a ? (b ? 'x' : 'y') : 'z'}"></div>`);
    expect(diags.length).toBe(0);
  });

  test("interpolation with array index does not fire on the bracket", () => {
    const diags = scan(`<div class="\${arr[0]}"></div>`);
    expect(diags.length).toBe(0);
  });

  test("static class outside interpolation still fires", () => {
    // Mixed: static base utility + interpolation. The base utility has no
    // shape so no warning. The interpolation is masked.
    const diags = scan(`<div class="card \${cond ? 'a' : 'b'}"></div>`);
    expect(diags.length).toBe(0);
  });

  test("static peer-hover:p-4 next to a ternary interpolation fires only on peer-hover:p-4", () => {
    // The static portion has peer-hover:p-4 (Tailwind shape, unsupported variant)
    // — should fire. The interpolation is masked so the ternary's `:` is not seen.
    const diags = scan(`<div class="peer-hover:p-4 \${cond ? 'a' : 'b'}"></div>`);
    expect(diags.length).toBe(1);
    expect(fired(diags, "peer-hover:p-4")).toBe(true);
  });

  test("unclosed ${ masks to end of attribute value (no spurious diagnostics)", () => {
    // Defensive: malformed ${... without } should not trip the scanner.
    const diags = scan(`<div class="\${cond ? 'a' : 'b'"></div>`);
    expect(diags.length).toBe(0);
  });
});
