// lexer-slice4a.test.js — self-host-v2 LEXER slice-4a PRECISE COOKED-DECODE oracle.
//
// Road-B compiler impl#2 (S235), continuing slices 1-3
// (self-host-v2-lexer-slice{1,2,3}.test.js). Slices 1-3 diff the token stream on
// {kind, text, start, end} only; the `cooked` value of a StringLit / TemplateChunk
// was approximate for hex/unicode/line-continuation escapes (decoded through the
// single-char identity path). Slice-4a makes cooked PRECISE — `\xHH`, `\uHHHH`,
// `\u{...}`, and `\<newline>` line-continuation now decode exactly, via a shared
// `scanEscape` helper mirroring impl#1's scanStringEscape (which impl#1 reuses for
// template chunks — see native-parser/lex-in-template.js). raw/span are unchanged
// (a backslash still escapes exactly the next code point, so the string/template
// END position — and thus text/span — is the same as slice-2/3).
//
// This test is the wave ORACLE for that fidelity item: the SAME
// compile -> discover `_scrml_lex_N` -> eval -> token-diff harness as slice-3, but
// the per-token comparison ALSO includes the `cooked` field on StringLit /
// TemplateChunk tokens (impl#1 cooked at `token.cooked`, spread top-level by
// makeToken; impl#2 cooked at `token.kind.data.cooked`, the payload variant). The
// corpus is escape-bearing strings (both quotes) + template chunks covering every
// escape form, plus a slice-1/2/3-shape no-regression guard.

import { describe, test, expect, beforeAll } from "bun:test";
import { mkdtempSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { compileScrml } from "../../src/api.js";
import { lex as lex1 } from "../../native-parser/lex.js";

const LEX_SCRML = join(import.meta.dir, "..", "..", "self-host-v2", "lex.scrml");

// Structural deep-equal matching the runtime's `_scrml_structural_eq` for the
// value shapes a lexer produces (primitives / arrays / plain objects).
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

// Cross-impl kind tag: impl#1 string OR impl#2 {variant,data}/string -> canonical.
function normKind(k) {
  const tag = k && typeof k === "object" ? k.variant : k;
  if (tag === "Eof" || tag === "EOF") return "EOF";
  if (typeof tag === "string" && tag.startsWith("Kw")) return "KW";
  if (tag === "Keyword") return "KW";
  return tag;
}

// The `cooked` value, from wherever the impl parks it:
//   impl#1 — top-level `token.cooked` (makeToken spreads the payload object).
//   impl#2 — `token.kind.data.cooked` (the {variant, data} payload variant).
function cookedOf(t) {
  if (t.kind && typeof t.kind === "object" && t.kind.data && "cooked" in t.kind.data) {
    return t.kind.data.cooked;
  }
  return t.cooked;
}

// Per-token tuple. StringLit / TemplateChunk ALSO carry `cooked` (the slice-4a
// surface); every other kind compares only {kind, text, start, end} — identical
// to slice-3, so the guard subset stays a true no-regression check.
function normCooked(t) {
  const kind = normKind(t.kind);
  const base = { kind, text: t.text, start: t.span.start, end: t.span.end };
  if (kind === "StringLit" || kind === "TemplateChunk") base.cooked = cookedOf(t);
  return base;
}

// --- STRING escape corpus (both quote styles). ` -> A`, mixed single-char, and
// the precise forms this slice adds. ---
const STRING_CORPUS = [
  '"\\x41"',              // \xHH -> "A"
  "'\\x41'",              // same, single-quoted
  '"\\x41\\x42\\x43"',    // adjacent \xHH -> "ABC"
  '"\\u0041"',            // \uHHHH -> "A"
  "'\\u0041\\u0042'",     // adjacent \uHHHH -> "AB"
  '"\\u{41}"',            // \u{...} BMP -> "A"
  '"\\u{1F600}"',         // \u{...} astral -> the emoji
  '"a\\u{1F600}b"',       // astral surrounded by text
  '"\\n\\t\\\\\\""',      // single-char mix: newline, tab, backslash, quote
  "'\\r\\b\\f\\v\\0'",    // more single-char escapes
  '"\\q\\z"',             // unknown escapes -> identity ("qz")
  '"plain text"',         // no escapes
  "''",                   // empty string
  '"mix \\x41 and \\u{42} and \\n done"', // hex + brace + single-char woven with text
];

// --- LINE-CONTINUATION corpus — an escaped newline is REMOVED from cooked. The
// JS test string builds `\` immediately followed by a real newline / CRLF. ---
const LINE_CONTINUATION_CORPUS = [
  '"a\\\nb"',             // \<LF>  -> "ab"
  '"a\\\r\nb"',           // \<CR><LF> -> "ab"
  '"a\\\rb"',             // \<CR>  -> "ab"
  '"line1\\\nline2\\\nline3"', // multiple continuations
  '"\\\ntrailing"',       // continuation at the very start
];

// --- TEMPLATE-CHUNK escape corpus — chunks decode escapes identically to strings
// (impl#1 reuses scanStringEscape). Includes chunks split by interps. ---
const TEMPLATE_CORPUS = [
  "`\\x41`",              // chunk \xHH -> "A"
  "`\\u0041`",            // chunk \uHHHH -> "A"
  "`\\u{1F600}`",         // chunk astral
  "`\\u{41}\\u{42}`",     // adjacent brace escapes -> "AB"
  "`tab\\there`",         // single-char escape in a chunk -> "tab\there"
  "`a\\`b`",              // escaped backtick -> "a`b" (does not close)
  "`\\x41${x}\\u{42}`",   // escapes on BOTH sides of an interp -> chunks "A","B"
  "`pre\\ncont${x}post`", // single-char escape + interp
  "`plain${x}plain`",     // no escapes, two chunks
  "`\\\nafter`",          // line-continuation in a chunk -> "after"
  "`sum=${a + b}!`",      // expression interp, plain chunks
];

// --- MIXED — escapes woven with slice-1/2/3 tokens (whole-stream diff). ---
const MIXED_CORPUS = [
  'const s = "hi\\t\\x41!"',
  "let t = `v=${1 + 2}\\u{21}`",
  'x = "\\u{1F600}" + `y\\x5A`',
];

// --- slice-1/2/3 no-regression guard — MUST stay green (cooked precision must
// not perturb non-escape lexing, and single-char escapes still decode). ---
const GUARD_CORPUS = [
  "const x = 42",
  "a == b != c === d !== e",
  "i++ j-- ++k --m",
  "obj.field.nested",
  "'str' + \"dbl\"",         // plain strings, cooked == text-minus-quotes
  "x // line comment\ny",
  "/* block */ z",
  "/abc/gi",                 // regex still lexes
  "`hello`",                 // plain template
  "`a${x}b`",                // template triad
];

let lex2;

beforeAll(() => {
  const outDir = mkdtempSync(join(tmpdir(), "self-host-v2-lex4a-"));
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

describe("self-host-v2 lexer slice-4a — precise cooked-decode token-diff vs impl#1", () => {
  test("lex.scrml compiles and exposes a callable lex()", () => {
    expect(typeof lex2).toBe("function");
  });

  for (const src of STRING_CORPUS) {
    test(`string cooked parity: ${JSON.stringify(src)}`, () => {
      expect(lex2(src).map(normCooked)).toEqual(lex1(src).map(normCooked));
    });
  }

  for (const src of LINE_CONTINUATION_CORPUS) {
    test(`line-continuation cooked parity: ${JSON.stringify(src)}`, () => {
      expect(lex2(src).map(normCooked)).toEqual(lex1(src).map(normCooked));
    });
  }

  for (const src of TEMPLATE_CORPUS) {
    test(`template chunk cooked parity: ${JSON.stringify(src)}`, () => {
      expect(lex2(src).map(normCooked)).toEqual(lex1(src).map(normCooked));
    });
  }

  for (const src of MIXED_CORPUS) {
    test(`mixed cooked parity: ${JSON.stringify(src)}`, () => {
      expect(lex2(src).map(normCooked)).toEqual(lex1(src).map(normCooked));
    });
  }

  for (const src of GUARD_CORPUS) {
    test(`slice-1/2/3 no-regression (incl. cooked): ${JSON.stringify(src)}`, () => {
      expect(lex2(src).map(normCooked)).toEqual(lex1(src).map(normCooked));
    });
  }

  // Anchor a couple of exact cooked values so a silent impl#1+impl#2 co-drift
  // (both wrong the same way) can't pass the differential above.
  test("exact cooked: \\x41 decodes to \"A\"", () => {
    const s = lex2('"\\x41"').find((t) => normKind(t.kind) === "StringLit");
    expect(cookedOf(s)).toBe("A");
  });

  test("exact cooked: \\u{1F600} decodes to the astral codepoint", () => {
    const s = lex2('"\\u{1F600}"').find((t) => normKind(t.kind) === "StringLit");
    expect(cookedOf(s)).toBe(String.fromCodePoint(0x1f600));
  });

  test("exact cooked: line-continuation removes the escaped newline", () => {
    const s = lex2('"a\\\nb"').find((t) => normKind(t.kind) === "StringLit");
    expect(cookedOf(s)).toBe("ab");
  });

  test("exact cooked: template chunk decodes escapes like a string", () => {
    const chunks = lex2("`\\x41${x}\\u{42}`")
      .filter((t) => normKind(t.kind) === "TemplateChunk")
      .map(cookedOf);
    expect(chunks).toEqual(["A", "B"]);
  });

  test("raw/text is unchanged by cooked precision (span still matches impl#1)", () => {
    for (const src of ["\"\\x41\"", "'\\u{1F600}'", "`\\x41${x}b`"]) {
      const g = lex2(src).map((t) => ({ kind: normKind(t.kind), text: t.text, start: t.span.start, end: t.span.end }));
      const e = lex1(src).map((t) => ({ kind: normKind(t.kind), text: t.text, start: t.span.start, end: t.span.end }));
      expect(g).toEqual(e);
    }
  });
});
