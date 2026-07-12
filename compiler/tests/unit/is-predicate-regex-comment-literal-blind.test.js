/**
 * §45.5 / GITI-017 — the `is`-predicate preprocess rewrite is regex/comment-safe
 * (g-is-predicate-scanner-regex-literal-blind, S252). `rewriteIsPredicates`
 * (expression-parser.ts) already skipped double/single/backtick string interiors,
 * but NOT regex-literal or comment interiors, so the word `is` inside
 * `/there is no match/i` (or a line/block comment) was read as the `is`
 * operator and spuriously fired E-EQ-005 on valid code.
 *
 * Fix: extend the scanner to skip regex/comment interiors too, reusing the shared
 * GITI-017 fence's context-tracking `regexAllowedAfter` (the ECMA preceding-token
 * regex-vs-division rule — NOT a raw-char heuristic) INLINE in the single forward
 * scan, so `scanLhsLeft` still sees the full string and an `is` LHS may span a
 * literal (`foo("bar") is not`) without being fragmented.
 *
 * E-EQ-005 is a lint/steering diagnostic (not a client/server boundary), so there
 * is no leak surface here; the acceptance bar is "fix the FP without regressing a
 * valid `is` predicate to a parse error or a missed true-positive".
 */

import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

function compile(src, opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-is-lit-"));
  const file = join(dir, "app.scrml");
  writeFileSync(file, src);
  const result = compileScrml({ inputFiles: [file], write: false, log: () => {}, ...opts });
  return { result };
}
const errCodes = (r) => (r.errors ?? []).map((e) => e.code);
const eErrs = (r) => errCodes(r).filter((c) => c.startsWith("E-"));

const webFn = (body) => `<program>
  <button onclick=doIt()>go</button>
  \${ @msg = ""
     function doIt() {
${body}
     } }
  <div>\${@msg}</div>
</program>`;

// ---------------------------------------------------------------------------
// §A — false-positive class GONE: `is` inside a regex/comment interior
// ---------------------------------------------------------------------------

describe("§45.5 — `is` inside a regex/comment is NOT the `is` operator (no false E-EQ-005)", () => {
  test("`/there is no match/i` (regex literal) does NOT fire E-EQ-005", () => {
    const { result } = compile(webFn(`       @msg = "x".replace(/there is no match/i, "ok")`));
    expect(errCodes(result)).not.toContain("E-EQ-005");
    expect(eErrs(result)).toEqual([]);
  });

  test("a regex char-class `/[a-z] is here/` does NOT fire E-EQ-005", () => {
    const { result } = compile(webFn(`       @msg = "x".replace(/[a-z] is here/g, "y")`));
    expect(errCodes(result)).not.toContain("E-EQ-005");
    expect(eErrs(result)).toEqual([]);
  });

  test("`is` inside a // LINE COMMENT does NOT fire E-EQ-005", () => {
    const { result } = compile(webFn(`       // reminder: there is no spoon\n       @msg = "ok"`));
    expect(errCodes(result)).not.toContain("E-EQ-005");
    expect(eErrs(result)).toEqual([]);
  });

  test("`is` inside a /* BLOCK COMMENT */ does NOT fire E-EQ-005", () => {
    const { result } = compile(webFn(`       /* this is a value 0 note */\n       @msg = "ok"`));
    expect(errCodes(result)).not.toContain("E-EQ-005");
    expect(eErrs(result)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §B — true-positive PRESERVED + no valid-code regression
// ---------------------------------------------------------------------------

describe("§45.5 — real `is` predicates still work (no regression)", () => {
  test("CONTROL — a real `x is 0` (value RHS) STILL fires E-EQ-005", () => {
    const { result } = compile(webFn(`       let x = 1\n       @msg = String(x is 0)`));
    expect(errCodes(result)).toContain("E-EQ-005");
  });

  test("`x is not` (absence predicate) still lowers + compiles clean", () => {
    const { result } = compile(webFn(`       let x = 1\n       @msg = String(x is not)`));
    expect(eErrs(result)).toEqual([]);
  });

  test("an `is` LHS spanning a STRING literal (`foo(\"bar\") is not`) is not fragmented", () => {
    const { result } = compile(webFn(`       let foo = (s) => s\n       @msg = String(foo("bar") is not)`));
    expect(eErrs(result)).toEqual([]);
  });

  test("an `is` LHS spanning a REGEX literal (`/a/.test(x) is not`) is not fragmented", () => {
    const { result } = compile(webFn(`       let x = "a"\n       @msg = String(/a/.test(x) is not)`));
    expect(eErrs(result)).toEqual([]);
  });

  test("division is NOT mis-read as regex: `(x / y) is not` processes the `is`", () => {
    const { result } = compile(webFn(`       let x = 4\n       let y = 2\n       @msg = String((x / y) is not)`));
    expect(eErrs(result)).toEqual([]);
  });

  test("ADVERSARIAL — `x++ / y is not` (division after ++) still lowers `is not` (unterminated-regex bail)", () => {
    // `++` makes regexAllowedAfter admit a regex-open, but there is no closing
    // `/` before the line end, so scanRegexLiteralEnd bails and the `/` is
    // treated as code — the `is not` is still processed (no parse error).
    const { result } = compile(webFn(`       let x = 1\n       let y = 2\n       @msg = String(x++ / y is not)`));
    expect(eErrs(result)).toEqual([]);
  });
});
