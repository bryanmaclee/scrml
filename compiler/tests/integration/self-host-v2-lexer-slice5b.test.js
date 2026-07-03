// lexer-slice5b.test.js — self-host-v2 LEXER slice-5b VALUE-KEYWORD-THEN-REGEX oracle.
//
// Road-B compiler impl#2 (S235), continuing slices 1-5a
// (self-host-v2-lexer-slice{1,2,3,4a,4b,5a}.test.js). Slice-5b closes the regex-vs-
// division disambiguation for a `/` that FOLLOWS a keyword. impl#1's rule:
//   - after a VALUE-KEYWORD (this/super/true/false/null/undefined) a `/` is DIVISION
//     (a value-keyword produces a value → member/division, not a regex);
//   - after any OTHER reserved word (return/typeof/in/instanceof/new/delete/void/
//     throw/of/await/yield/do) a `/` OPENS A REGEX (the keyword expects a value next);
//   - after an OPERAND (Ident/NumberLit/`)`/`]`/`}`) a `/` is DIVISION.
// Previously impl#2 only reserved a 17-word subset, so `return /re/` regex-opened but
// `typeof /re/` (typeof lexed as Ident → division) diverged. Slice-5b reserves impl#1's
// FULL keyword table (token.js JS_KEYWORDS, minus the contextual `type`) and makes
// regexAllowedAfter TEXT-AWARE for keywords, so impl#2 matches impl#1 on every keyword-
// preceded `/`.
//
// Same compile → discover `_scrml_lex_N` → eval → token-diff harness as slice-5a, with
// the same {kind, text, span, cooked} tuple (the oracle collapses impl#1's per-word
// `Kw*` kinds AND impl#2's single `Keyword` kind to one canonical "KW" + compares `text`,
// so a word made a keyword on ONE side must be a keyword on the OTHER — which is exactly
// what slice-5b guarantees for impl#1's full table). Corpus (all differential vs impl#1,
// empirically probed): operator-keyword-preceded `/` → REGEX, value-keyword-preceded `/`
// → DIVISION, operand-preceded `/` → DIVISION, keyword-not-before-slash sanity, the
// NON-reserved barewords (case/switch/type — impl#1 lexes them as Ident, so `/` after
// them is division), and a slice-1..5a no-regression guard, plus structural anchors.

import { describe, test, expect, beforeAll } from "bun:test";
import { mkdtempSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { compileScrml } from "../../src/api.js";
import { lex as lex1 } from "../../native-parser/lex.js";

const LEX_SCRML = join(import.meta.dir, "..", "..", "self-host-v2", "lex.scrml");

// Structural deep-equal matching the runtime's `_scrml_structural_eq`.
function _scrml_structural_eq(a, b) {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return a === b;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!_scrml_structural_eq(a[i], b[i])) return false;
    return true;
  }
  const ak = Object.keys(a), bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  return ak.every((k) => _scrml_structural_eq(a[k], b[k]));
}

// Cross-impl kind tag: impl#1 per-word `Kw*` (KwTypeof/KwThis/...) OR impl#2
// {variant:"Keyword"} -> canonical "KW"; the `text` field discriminates the word.
function normKind(k) {
  const tag = k && typeof k === "object" ? k.variant : k;
  if (tag === "Eof" || tag === "EOF") return "EOF";
  if (typeof tag === "string" && tag.startsWith("Kw")) return "KW";
  if (tag === "Keyword") return "KW";
  return tag;
}

function cookedOf(t) {
  if (t.kind && typeof t.kind === "object" && t.kind.data && "cooked" in t.kind.data) {
    return t.kind.data.cooked;
  }
  return t.cooked;
}

// Per-token tuple. StringLit / TemplateChunk ALSO carry `cooked`; every other kind
// (incl. Keyword) compares only {kind, text, start, end} — the keyword word is captured
// by `text` (impl#1 spreads it top-level, impl#2 via the `Keyword(name)` payload; the
// oracle compares `text`, which is the bareword on both sides).
function normCooked(t) {
  const kind = normKind(t.kind);
  const base = { kind, text: t.text, start: t.span.start, end: t.span.end };
  if (kind === "StringLit" || kind === "TemplateChunk") base.cooked = cookedOf(t);
  return base;
}

// --- OPERATOR/STATEMENT KEYWORD then `/` -> REGEX (the keyword expects a value next). ---
const REGEX_AFTER_KEYWORD_CORPUS = [
  "return /re/g",         // the already-working case (return was reserved pre-5b)
  "typeof /re/",          // the slice-5b headline: typeof now reserved -> regex
  "in /re/",
  "instanceof /re/",
  "new /re/",
  "delete /re/",
  "void /re/",
  "throw /re/",
  "of /re/",
  "await /re/",
  "yield /re/",
  "do /re/",
];

// --- VALUE-KEYWORD then `/` -> DIVISION (a value-keyword produces a value). ---
const DIVISION_AFTER_VALUE_KEYWORD_CORPUS = [
  "this / 2",
  "super / 2",
  "true / 2",
  "false / 2",
  "null / 2",
  "undefined / 2",
];

// --- OPERAND then `/` -> DIVISION (unchanged from slice-3; a regression guard here). ---
const DIVISION_AFTER_OPERAND_CORPUS = [
  "x / y",                // after Ident
  "5 / 2",                // after NumberLit
  ") / 2",                // after RParen
  "] / 2",                // after RBracket
  "} / 2",                // after RBrace
];

// --- KEYWORD NOT BEFORE A SLASH — the newly-reserved words lex as KW, and interact
// correctly with member access / operand context (whole-stream parity). ---
const KEYWORD_SANITY_CORPUS = [
  "typeof x",             // typeof is KW, x is Ident (no regex — no `/`)
  "return x",
  "new x",
  "in x",
  "this.foo",             // value-keyword then MEMBER access (`.foo` is Dot, not variant)
  "super.x",
  "true.toString",
  "const t = null",       // value-keyword in an operand position
  "a in b",               // `in` as an infix operator keyword
  "x instanceof y",
  "delete a.b",
];

// --- NON-RESERVED BAREWORDS — impl#1 does NOT reserve case/switch (they lex as Ident),
// and `type` is a CONTEXTUAL identifier (Ident with a ctxKw marker the oracle ignores).
// impl#2 must lex them as Ident too (NOT add them to isKeyword) — else it would flip an
// Ident->KW and diverge. A `/` after them is therefore DIVISION (after an Ident). ---
const NON_KEYWORD_CORPUS = [
  "case /re/",            // `case` is Ident -> `/` is division (NOT regex)
  "switch",
  "type x",               // `type` is a contextual Ident, not KwType
  "case",
];

// --- MIXED — keyword/regex/division woven whole-stream. ---
const MIXED_CORPUS = [
  "typeof x / y",         // typeof x (Ident intervenes) then x / y division
  "delete a.b / c",       // member access then division
  "return typeof /re/",   // return then typeof then a regex
  "b ? c / d : e",        // division inside a ternary
];

// --- slice-1..5a no-regression guard — MUST stay green. ---
const GUARD_CORPUS = [
  "const x = 42",
  "a == b != c === d !== e",
  "i++ j-- ++k --m",
  "obj.field.nested",          // member chains still Dot+Ident
  "'str' + \"dbl\"",
  '"hi\\t\\x41!"',             // escapes still decode (cooked)
  "x // line comment\ny",
  "/* block */ z",
  "/abc/gi",                   // leading regex still lexes
  "`a${x}b`",                  // template triad
  "`\\x41${x}\\u{42}`",        // template chunk cooked precision
  "[({})]",                    // bracket stack
  ".Foo",                      // BareVariant still lexes
  "return .Foo",               // operator-keyword then BareVariant (regexAllowedAfter=true)
  "match k { .LParen :> 1 }",  // `match` keyword + variant
];

let lex2;

beforeAll(() => {
  const outDir = mkdtempSync(join(tmpdir(), "self-host-v2-lex5b-"));
  const result = compileScrml({
    inputFiles: [LEX_SCRML],
    outputDir: outDir,
    write: true,
    validateEmit: true,
    log: () => {},
  });
  const errs = (result.errors ?? []).filter((e) => e && e.code !== undefined);
  if (errs.length > 0) {
    throw new Error("lex.scrml failed to compile: " + errs.map((e) => e.code + " " + (e.message ?? "")).join("; "));
  }
  const client = readFileSync(join(outDir, "lex.client.js"), "utf8");
  const m = client.match(/function (_scrml_lex_\d+)\s*\(/);
  if (!m) throw new Error("could not find emitted _scrml_lex_N in client.js");
  const factory = new Function("_scrml_structural_eq", client + `\nreturn ${m[1]};`);
  lex2 = factory(_scrml_structural_eq);
});

describe("self-host-v2 lexer slice-5b — value-keyword-then-regex token-diff vs impl#1", () => {
  test("lex.scrml compiles and exposes a callable lex()", () => {
    expect(typeof lex2).toBe("function");
  });

  for (const src of REGEX_AFTER_KEYWORD_CORPUS) {
    test(`operator-keyword then regex parity: ${JSON.stringify(src)}`, () => {
      expect(lex2(src).map(normCooked)).toEqual(lex1(src).map(normCooked));
    });
  }

  for (const src of DIVISION_AFTER_VALUE_KEYWORD_CORPUS) {
    test(`value-keyword then division parity: ${JSON.stringify(src)}`, () => {
      expect(lex2(src).map(normCooked)).toEqual(lex1(src).map(normCooked));
    });
  }

  for (const src of DIVISION_AFTER_OPERAND_CORPUS) {
    test(`operand then division parity: ${JSON.stringify(src)}`, () => {
      expect(lex2(src).map(normCooked)).toEqual(lex1(src).map(normCooked));
    });
  }

  for (const src of KEYWORD_SANITY_CORPUS) {
    test(`keyword-not-before-slash parity: ${JSON.stringify(src)}`, () => {
      expect(lex2(src).map(normCooked)).toEqual(lex1(src).map(normCooked));
    });
  }

  for (const src of NON_KEYWORD_CORPUS) {
    test(`non-reserved bareword parity: ${JSON.stringify(src)}`, () => {
      expect(lex2(src).map(normCooked)).toEqual(lex1(src).map(normCooked));
    });
  }

  for (const src of MIXED_CORPUS) {
    test(`mixed keyword/regex/division parity: ${JSON.stringify(src)}`, () => {
      expect(lex2(src).map(normCooked)).toEqual(lex1(src).map(normCooked));
    });
  }

  for (const src of GUARD_CORPUS) {
    test(`slice-1..5a no-regression: ${JSON.stringify(src)}`, () => {
      expect(lex2(src).map(normCooked)).toEqual(lex1(src).map(normCooked));
    });
  }

  // --- Exact structural anchors: guard against a silent impl#1+impl#2 co-drift (both
  // ceasing to regex-open after `typeof`, or both flipping `case` to a keyword, would
  // pass the differential above but break the feature). ---

  test("`typeof /re/` — exactly one RegexLit, zero Slash (regex opens after typeof)", () => {
    const kinds = lex2("typeof /re/").map((t) => normKind(t.kind));
    expect(kinds.filter((k) => k === "RegexLit").length).toBe(1);
    expect(kinds.filter((k) => k === "Slash").length).toBe(0);
    expect(kinds[0]).toBe("KW");
    expect(lex2("typeof /re/")[0].text).toBe("typeof");
  });

  test("`this / 2` — a `/` after `this`(value-keyword) is division (Slash, no RegexLit)", () => {
    const toks = lex2("this / 2");
    const kinds = toks.map((t) => normKind(t.kind));
    expect(kinds.filter((k) => k === "RegexLit").length).toBe(0);
    expect(kinds).toContain("Slash");
    expect(kinds[0]).toBe("KW");
    expect(toks[0].text).toBe("this");
  });

  test("`this.foo` — `this` is a keyword and `.foo` is a member Dot (NOT a BareVariant)", () => {
    const kinds = lex2("this.foo").map((t) => normKind(t.kind));
    expect(kinds[0]).toBe("KW");
    expect(kinds.filter((k) => k === "BareVariant").length).toBe(0);
    expect(kinds.filter((k) => k === "Dot").length).toBe(1);
  });

  test("`typeof` alone lexes as a single Keyword token with text `typeof`", () => {
    const toks = lex2("typeof");
    expect(normKind(toks[0].kind)).toBe("KW");
    expect(toks[0].text).toBe("typeof");
    expect(normKind(toks[1].kind)).toBe("EOF");
  });

  // impl#2-internal negatives: the words impl#1 does NOT reserve must stay Ident, so a
  // `/` after them is division (a keyword-flip would spuriously regex-open).

  test("`case` is an Ident, NOT a keyword (impl#1 does not reserve it)", () => {
    expect(normKind(lex2("case")[0].kind)).toBe("Ident");
  });

  test("`case /re/` — a `/` after `case`(Ident) is division, zero RegexLit", () => {
    const kinds = lex2("case /re/").map((t) => normKind(t.kind));
    expect(kinds.filter((k) => k === "RegexLit").length).toBe(0);
    expect(kinds.filter((k) => k === "Slash").length).toBe(2);  // `case /re/` = case / re /
    expect(kinds[0]).toBe("Ident");
  });

  test("`type` is a contextual Ident, NOT a `KwType` (excluded from isKeyword)", () => {
    expect(normKind(lex2("type")[0].kind)).toBe("Ident");
    expect(lex2("type")[0].text).toBe("type");
  });
});
