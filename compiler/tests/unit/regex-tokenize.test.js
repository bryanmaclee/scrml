/**
 * Regex literal tokenization — Unit Tests
 *
 * Tests that tokenizeLogic() correctly recognizes JavaScript regex literals
 * as a single REGEX token rather than splitting them into individual PUNCT
 * and IDENT tokens.
 *
 * Coverage:
 *   §1  Basic regex with flag → single REGEX token
 *   §2  Character class (brackets) inside regex → single REGEX token
 *   §3  Escaped slash inside regex → single REGEX token
 *   §4  Division: IDENT / IDENT → three tokens (IDENT PUNCT IDENT)
 *   §5  Division after closing paren → not regex
 *   §6  Regex after comma (.replace call) → regex
 *   §7  Regex after = (assignment) → regex
 *   §8  Regex after return keyword → regex
 *   §9  Regex after ( → regex
 *   §10 Division operator /= is not a regex
 *   §11 Line comment // is not a regex
 *   §12 Block comment /* is not a regex
 *   §13 Multiple flags: /pattern/gim → single REGEX token
 *   §14 Regex REGEX token text is the full literal including delimiters and flags
 *   §15 Division after NUMBER → not regex
 *   §16 Division after ] → not regex
 *   §17 Complex: .replace(/([A-E][1-5])/g, fn) → regex detected correctly
 */

import { describe, test, expect } from "bun:test";
import { tokenizeLogic } from "../../src/tokenizer.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Tokenize a logic block body string and return non-EOF tokens.
 */
function lex(content) {
  const tokens = tokenizeLogic(content, 0, 1, 1, []);
  return tokens.filter(t => t.kind !== "EOF");
}

/**
 * Get token kinds as a shorthand array.
 */
function kinds(content) {
  return lex(content).map(t => t.kind);
}

/**
 * Get token texts as an array.
 */
function texts(content) {
  return lex(content).map(t => t.text);
}

// ---------------------------------------------------------------------------
// §1  Basic regex with flag → single REGEX token
// ---------------------------------------------------------------------------

describe("regex tokenization", () => {
  test("§1 basic regex /abc/g → single REGEX token", () => {
    const toks = lex("/abc/g");
    expect(toks.length).toBe(1);
    expect(toks[0].kind).toBe("REGEX");
    expect(toks[0].text).toBe("/abc/g");
  });

  // ---------------------------------------------------------------------------
  // §2  Character class inside regex → single REGEX token
  // ---------------------------------------------------------------------------

  test("§2 character class /[A-E][1-5]/g → single REGEX token", () => {
    const toks = lex("/([A-E][1-5])/g");
    expect(toks.length).toBe(1);
    expect(toks[0].kind).toBe("REGEX");
    expect(toks[0].text).toBe("/([A-E][1-5])/g");
  });

  // ---------------------------------------------------------------------------
  // §3  Escaped slash inside regex → single REGEX token
  // ---------------------------------------------------------------------------

  test("§3 escaped slash /a\\/b/ → single REGEX token", () => {
    const toks = lex("/a\\/b/");
    expect(toks.length).toBe(1);
    expect(toks[0].kind).toBe("REGEX");
    expect(toks[0].text).toBe("/a\\/b/");
  });

  // ---------------------------------------------------------------------------
  // §4  Division: a / b → three tokens (IDENT PUNCT IDENT)
  // ---------------------------------------------------------------------------

  test("§4 division a / b → IDENT PUNCT IDENT", () => {
    expect(kinds("a / b")).toEqual(["IDENT", "PUNCT", "IDENT"]);
    expect(texts("a / b")).toEqual(["a", "/", "b"]);
  });

  // ---------------------------------------------------------------------------
  // §5  Division after closing paren → not regex
  // ---------------------------------------------------------------------------

  test("§5 division after ) → not regex: (x) / y", () => {
    const k = kinds("(x) / y");
    // Should be: PUNCT(()  IDENT(x)  PUNCT())  PUNCT(/)  IDENT(y)
    expect(k).toContain("PUNCT");
    // The / should NOT be a REGEX — find it
    const toks = lex("(x) / y");
    const slash = toks.find(t => t.text === "/");
    expect(slash).toBeDefined();
    expect(slash.kind).toBe("PUNCT");
  });

  // ---------------------------------------------------------------------------
  // §6  Regex after comma → regex
  // ---------------------------------------------------------------------------

  test("§6 regex after comma: .replace(/x/g, fn) → REGEX token", () => {
    const toks = lex('.replace(/x/g, fn)');
    const regex = toks.find(t => t.kind === "REGEX");
    expect(regex).toBeDefined();
    expect(regex.text).toBe("/x/g");
  });

  // ---------------------------------------------------------------------------
  // §7  Regex after = → regex
  // ---------------------------------------------------------------------------

  test("§7 regex after = assignment: let r = /x/", () => {
    const toks = lex("let r = /x/");
    const regex = toks.find(t => t.kind === "REGEX");
    expect(regex).toBeDefined();
    expect(regex.text).toBe("/x/");
  });

  // ---------------------------------------------------------------------------
  // §8  Regex after return keyword → regex
  // ---------------------------------------------------------------------------

  test("§8 regex after return keyword", () => {
    const toks = lex("return /x/g");
    const regex = toks.find(t => t.kind === "REGEX");
    expect(regex).toBeDefined();
    expect(regex.text).toBe("/x/g");
  });

  // ---------------------------------------------------------------------------
  // §9  Regex after ( → regex
  // ---------------------------------------------------------------------------

  test("§9 regex after opening paren: (/pattern/)", () => {
    const toks = lex("(/pattern/)");
    const regex = toks.find(t => t.kind === "REGEX");
    expect(regex).toBeDefined();
    expect(regex.text).toBe("/pattern/");
  });

  // ---------------------------------------------------------------------------
  // §10 Compound assignment /= is not a regex
  // ---------------------------------------------------------------------------

  test("§10 /= compound assignment is not a regex", () => {
    const toks = lex("x /= 2");
    // Should NOT have a REGEX token
    expect(toks.find(t => t.kind === "REGEX")).toBeUndefined();
    // Should have IDENT, then OPERATOR(/=), then NUMBER
    const op = toks.find(t => t.text === "/=");
    expect(op).toBeDefined();
    expect(op.kind).toBe("OPERATOR");
  });

  // ---------------------------------------------------------------------------
  // §11 Line comment // is not a regex
  // ---------------------------------------------------------------------------

  test("§11 // is a line comment, not a regex", () => {
    const toks = lex("// this is a comment\nx");
    expect(toks.find(t => t.kind === "REGEX")).toBeUndefined();
    expect(toks.find(t => t.kind === "COMMENT")).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // §12 Block comment /* is not a regex
  // ---------------------------------------------------------------------------

  test("§12 /* ... */ is a block comment, not a regex", () => {
    const toks = lex("/* comment */ x");
    expect(toks.find(t => t.kind === "REGEX")).toBeUndefined();
    expect(toks.find(t => t.kind === "COMMENT")).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // §13 Multiple flags /pattern/gim → single REGEX token
  // ---------------------------------------------------------------------------

  test("§13 multiple flags /pattern/gim → single REGEX token", () => {
    const toks = lex("/pattern/gim");
    expect(toks.length).toBe(1);
    expect(toks[0].kind).toBe("REGEX");
    expect(toks[0].text).toBe("/pattern/gim");
  });

  // ---------------------------------------------------------------------------
  // §14 REGEX token text is full literal including delimiters and flags
  // ---------------------------------------------------------------------------

  test("§14 REGEX token text includes delimiters and flags", () => {
    const toks = lex("let r = /[0-9]+/gi");
    const regex = toks.find(t => t.kind === "REGEX");
    expect(regex).toBeDefined();
    // Full literal text must be preserved verbatim
    expect(regex.text).toBe("/[0-9]+/gi");
  });

  // ---------------------------------------------------------------------------
  // §15 Division after NUMBER → not regex
  // ---------------------------------------------------------------------------

  test("§15 division after number: 10 / 2 → PUNCT, not REGEX", () => {
    const toks = lex("10 / 2");
    const slash = toks.find(t => t.text === "/");
    expect(slash).toBeDefined();
    expect(slash.kind).toBe("PUNCT");
  });

  // ---------------------------------------------------------------------------
  // §16 Division after ] → not regex
  // ---------------------------------------------------------------------------

  test("§16 division after ]: arr[0] / 2 → PUNCT, not REGEX", () => {
    const toks = lex("arr[0] / 2");
    const slash = toks.find(t => t.text === "/");
    expect(slash).toBeDefined();
    expect(slash.kind).toBe("PUNCT");
  });

  // ---------------------------------------------------------------------------
  // §17 Complex: expr.replace(/([A-E][1-5])/g, fn) — the gauntlet case
  // ---------------------------------------------------------------------------

  test("§17 spreadsheet gauntlet case: expr.replace(/([A-E][1-5])/g, fn)", () => {
    const src = 'expr.replace(/([A-E][1-5])/g, function(match) {})';
    const toks = lex(src);
    const regex = toks.find(t => t.kind === "REGEX");
    expect(regex).toBeDefined();
    expect(regex.text).toBe("/([A-E][1-5])/g");
    // The regex should appear as a single token, not split into parts
    // If it were split, we'd have multiple PUNCT tokens containing /
    const punctSlashes = toks.filter(t => t.kind === "PUNCT" && t.text === "/");
    expect(punctSlashes.length).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // §18 jwt-auth-bypass (2026-07-11, HIGH) — a regex literal MAY begin with `=`.
  //
  // `/=/g` (the base64url padding strip in stdlib/auth/jwt.scrml:42) is a REGEX
  // in regex context, NOT the `/=` divide-assign operator. Pre-fix the tokenizer
  // excluded `ch(1) === '='` from regex detection, forcing `s.replace(/=/g, "")`
  // to lex `/=` as the operator → corrupted the expression → dropped every
  // subsequent `export function` from the module (STDLIB-EXPORT-SEED never saw
  // signJwt/verifyJwt async → SYNC → unawaited Promise → auth bypass, issue #26
  // class). isRegexContext() disambiguates: `/=` is a regex after `(`/`,`/`=`/
  // return/etc., and the `/=` OPERATOR only after a value (IDENT/`)`/`]`/NUMBER).
  // ---------------------------------------------------------------------------

  test("§18a regex starting with = after ( : .replace(/=/g, \"\") → REGEX", () => {
    const toks = lex('s.replace(/=/g, "")');
    const regex = toks.find(t => t.kind === "REGEX");
    expect(regex).toBeDefined();
    expect(regex.text).toBe("/=/g");
    // No stray `/=` operator token was produced.
    expect(toks.find(t => t.text === "/=")).toBeUndefined();
  });

  test("§18b regex starting with = after assignment: let r = /=x/", () => {
    const toks = lex("let r = /=x/");
    const regex = toks.find(t => t.kind === "REGEX");
    expect(regex).toBeDefined();
    expect(regex.text).toBe("/=x/");
  });

  test("§18c regex starting with = after return: return /=/.test(s)", () => {
    const toks = lex("return /=/.test(s)");
    const regex = toks.find(t => t.kind === "REGEX");
    expect(regex).toBeDefined();
    expect(regex.text).toBe("/=/");
  });

  test("§18d regression: x /= 2 STILL lexes /= as the compound-assign operator", () => {
    // The fix must not regress the operator case — isRegexContext() returns
    // false after an IDENT, so `/=` after a value stays the operator.
    const toks = lex("x /= 2");
    expect(toks.find(t => t.kind === "REGEX")).toBeUndefined();
    const op = toks.find(t => t.text === "/=");
    expect(op).toBeDefined();
    expect(op.kind).toBe("OPERATOR");
  });

  test("§18e regression: arr[0] /= 2 → operator, not regex", () => {
    const toks = lex("arr[0] /= 2");
    expect(toks.find(t => t.kind === "REGEX")).toBeUndefined();
    const op = toks.find(t => t.text === "/=");
    expect(op).toBeDefined();
    expect(op.kind).toBe("OPERATOR");
  });
});
