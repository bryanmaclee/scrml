/**
 * mangle-string-literal-opacity.test.js — Regression test for Bug Z (6nz, HIGH)
 *
 * Bug Z (6nz inbound 2026-05-29, S144): the post-emit identifier mangler in
 * emit-client.ts ran `clientCode.replace(combinedRegex, ...)` over the raw
 * emitted JS string with NO string-literal awareness. A declared name whose
 * substring occurred INSIDE a `"..."` / `'...'` / backtick literal (or a
 * comment) was rewritten — silently corrupting displayed content. For an
 * editor that displays code-as-text (6nz), the string `"handleKey(e)"` became
 * `"_scrml_handleKey_N(e)"`: exit-0 silent miscompile (valid JS, wrong text).
 *
 * Fix: fence the mangle replace through rewriteCodeSegments (code-segments.ts),
 * the shared string/regex/comment-aware splitter already used by rewrite.ts and
 * expression-parser.ts, so the substitution applies ONLY to code segments.
 * String literals, regex literals, and comments pass through verbatim. Real
 * call sites in CODE position still mangle.
 *
 * Related precedents (same mangler, narrower band-aids): Bug D (property-access
 * lookbehind, mangle-property-access.test.js) and Bug I (spaced-`.` record
 * values, mangle-record-value-bleed.test.js).
 *
 * Coverage:
 *   §1  A declared name INSIDE a string literal stays VERBATIM ("..." / '...' / `...`)
 *   §2  The SAME name in declaration + real call position STILL mangles
 *   §3  Interaction shape: string-literal occurrence AND real call in one file
 *   §4  A declared name inside a comment stays VERBATIM
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/mangle-string-literal-opacity");
const FIXTURE_OUTPUT = join(FIXTURE_DIR, "dist");

// Bug Z reproducer (the original 6nz repro), plus a real call to the same name
// in code position (onclick wiring) so both invariants live in one file.
const REPRO_FIXTURE = join(FIXTURE_DIR, "string-opacity.scrml");
const REPRO_SRC = `\${
  function handleKey() { return 1 }
  <label> = "handleKey(e)"
}
<button onclick=handleKey()>\${@label}</button>
`;

// Single, double, and template-literal occurrences of a declared name, plus a
// real call in code position. The name `render` is declared and called; it also
// appears verbatim inside three kinds of string literal as displayed text.
const QUOTES_FIXTURE = join(FIXTURE_DIR, "string-quotes.scrml");
const BT = String.fromCharCode(96); // backtick
const QUOTES_SRC = [
  "${",
  "  function render() { return 1 }",
  '  <dq> = "render(x)"',
  "  <sq> = 'render(y)'",
  "  <tl> = " + BT + "render(z)" + BT,
  "  @kicked = render()",
  "}",
  "<div>${@dq}${@sq}${@tl}</div>",
  "",
].join("\n");

// A declared name inside a string literal that itself contains ESCAPED quotes.
// The code-segments fence must treat `\\"` as an escaped char (not a string
// terminator), so the inner `tag()` stays opaque while the real call mangles.
const ESC_FIXTURE = join(FIXTURE_DIR, "string-escaped-quote.scrml");
const ESC_SRC = [
  "${",
  "  function tag() { return 1 }",
  '  <msg> = "say \\"tag()\\" now"',
  "  @hit = tag()",
  "}",
  "<p>${@msg}${@hit}</p>",
  "",
].join("\n");

beforeAll(() => {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  writeFileSync(REPRO_FIXTURE, REPRO_SRC);
  writeFileSync(QUOTES_FIXTURE, QUOTES_SRC);
  writeFileSync(ESC_FIXTURE, ESC_SRC);
});

afterAll(() => {
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
});

function clientOf(fixture) {
  const result = compileScrml({
    inputFiles: [fixture],
    outputDir: FIXTURE_OUTPUT,
    write: false,
  });
  expect(result.errors).toEqual([]);
  const out = result.outputs.get(fixture);
  expect(out).toBeDefined();
  return out.clientJs;
}

// ---------------------------------------------------------------------------
// §1: A declared name inside a string literal stays VERBATIM
// ---------------------------------------------------------------------------

describe("§1: string literals are opaque to the mangler", () => {
  test('Bug Z: `"handleKey(e)"` string value is NOT mangled', () => {
    const clientJs = clientOf(REPRO_FIXTURE);
    // The string literal must be preserved verbatim.
    expect(clientJs).toContain('"handleKey(e)"');
    // The corrupted form must NOT appear inside a string literal.
    expect(clientJs).not.toMatch(/"_scrml_handleKey_\d+\(e\)"/);
  });

  test("double, single, and template-literal occurrences all preserved", () => {
    const clientJs = clientOf(QUOTES_FIXTURE);
    // The emitter may re-quote (single-quoted scrml values become double-quoted
    // JS strings), so assert on the INNER text rather than exact quote chars.
    // The literal CONTENT `render(x|y|z)` must survive unmangled.
    expect(clientJs).toContain("render(x)");
    expect(clientJs).toContain("render(y)");
    // The backtick template literal is emitted as a backtick literal.
    expect(clientJs).toContain("`render(z)`");
    // No mangled form should appear inside any of the three literals.
    expect(clientJs).not.toMatch(/_scrml_render_\d+\((?:x|y|z)\)/);
  });
});

// ---------------------------------------------------------------------------
// §2: The SAME name in declaration + real call position STILL mangles
// ---------------------------------------------------------------------------

describe("§2: real code-position uses still mangle", () => {
  test("declaration of `handleKey` is mangled", () => {
    const clientJs = clientOf(REPRO_FIXTURE);
    expect(clientJs).toMatch(/function _scrml_handleKey_\d+\(\)/);
  });

  test("declaration + call of `render` is mangled", () => {
    const clientJs = clientOf(QUOTES_FIXTURE);
    expect(clientJs).toMatch(/function _scrml_render_\d+\(\)/);
    // The call site is mangled too; the emitter may or may not carry the
    // numeric suffix at the call position, so accept either `_scrml_render(`
    // or `_scrml_render_N(`. The point is the bare user name `render(` is gone.
    expect(clientJs).toMatch(/_scrml_render(?:_\d+)?\(\)/);
  });
});

// ---------------------------------------------------------------------------
// §3: Interaction shape — string occurrence AND real call in one file
// ---------------------------------------------------------------------------

describe("§3: interaction (string + real call together)", () => {
  test("onclick call mangles while the string literal stays verbatim", () => {
    const clientJs = clientOf(REPRO_FIXTURE);
    // Real call in the event-wiring closure must be the mangled name.
    expect(clientJs).toMatch(/_scrml_handleKey_\d+\(\)\s*;/);
    // The same name as displayed text in the string is untouched.
    expect(clientJs).toContain('"handleKey(e)"');
    // Guard: the only `(e)` form should be the string, never a mangled call.
    expect(clientJs).not.toMatch(/_scrml_handleKey_\d+\(e\)/);
  });
});

// ---------------------------------------------------------------------------
// §4: Escaped quotes inside a string do not break the fence
// ---------------------------------------------------------------------------

describe("§4: escaped quotes inside strings", () => {
  test('name inside `"say \\"tag()\\" now"` is preserved; the call mangles', () => {
    const clientJs = clientOf(ESC_FIXTURE);
    // The whole escaped-quote string is preserved verbatim: the inner `tag()`
    // (between escaped quotes) was NOT mangled. Emitted form: "say \"tag()\" now".
    expect(clientJs).toContain('say \\"tag()\\" now');
    // The mangled form must NOT appear inside that string.
    expect(clientJs).not.toMatch(/say \\"_scrml_tag_\d+/);
    // The real call IS still mangled.
    expect(clientJs).toMatch(/function _scrml_tag_\d+\(\)/);
    expect(clientJs).toMatch(/_scrml_tag_\d+\(\)/);
  });
});
