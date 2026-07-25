// lexer-slice2.test.js — self-host-v2 LEXER slice-2 token-diff oracle.
//
// Road-B compiler impl#2 (S234), continuing slice-1
// (self-host-v2-lexer-slice1.test.js). Slice 2 extends the Approach-B pure-fold
// lexer (`compiler/self-host-v2/lex.scrml`) with STRINGS (single/double-quoted +
// escapes) and COMMENTS (line `//` + block `/* */`, skipped as trivia). This
// test is the wave ORACLE for that slice: a TOKEN-STREAM DIFFERENTIAL against
// impl#1 (`native-parser/lex.js`) over a curated string/comment corpus.
//
// Regex bodies (`/.../flags`) + template-interp nesting (`` `...${...}...` ``)
// remain DEFERRED to slice-3 and are OUT of the corpus.
//
// Pipeline mirrors slice-1: compile lex.scrml via the live compiler (`<program>`
// mode -> client.js; the importable library path can't lower typed-payload +
// match today — progress.md finding F1), discover the emitted `_scrml_lex_N` fn,
// eval it (only runtime helper a pure lexer references is `_scrml_structural_eq`,
// stubbed below), and token-diff impl#2 vs impl#1 on {kind, text, start, end}.

import { describe, test, expect, beforeAll } from "bun:test";
import { mkdtempSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { compileScrml } from "../../src/api.js";
import { lex as lex1 } from "../../native-parser/lex.js";
import { unwrapChunkScope } from "../helpers/chunk-scope.js";

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

// Normalize a token's kind (impl#1 string OR impl#2 {variant,data}/string) to a
// cross-impl canonical tag. StringLit is a shared literal kind on both sides.
function normKind(k) {
  const tag = k && typeof k === "object" ? k.variant : k;
  if (tag === "Eof" || tag === "EOF") return "EOF";
  if (typeof tag === "string" && tag.startsWith("Kw")) return "KW";
  if (tag === "Keyword") return "KW";
  return tag;
}
const norm = (t) => ({ kind: normKind(t.kind), text: t.text, start: t.span.start, end: t.span.end });

// The slice-2 corpus: STRINGS (single/double, escapes, hex/unicode, unterminated,
// empty) + COMMENTS (line/block, unterminated) + strings/comments MIXED with
// slice-1 tokens. NO regex/templates (deferred slice-3). The hex/unicode-escape
// cases assert raw/span PARITY (the oracle compares text+span, not `cooked`);
// precise hex/unicode cooked-decoding is a deferred fidelity item (progress.md).
const CORPUS = [
  // plain strings
  "'hello'",
  "\"world\"",
  "'a' \"b\"",
  "'' \"\"",
  // escapes — an escaped quote must NOT terminate the string
  "'with \\'escaped\\' quote'",
  "\"tab\\tnewline\\n\"",
  "'back\\\\slash'",
  "'quote\\\"inside'",
  "\"apos'inside\"",
  // hex / unicode escapes — raw/span parity (cooked differs, not compared)
  "'hex\\x41here'",
  "\"uni\\u0041done\"",
  // comments (trivia — no token)
  "x // line comment\ny",
  "/* block */ z",
  "a /* multi\nline\ncomment */ b",
  "// only a comment",
  "/* unterminated",
  // strings + comments mixed with slice-1 tokens
  "const x = 'str' // trailing\nlet y = 42",
  "foo('bar') /* mid */ + baz",
  "'line\\nbreak' + \"and\\ttab\"",
  // unterminated string (runs to EOF)
  "'unterminated string",
];

// A slice-1 regression subset — these MUST stay green under the slice-2 lexer
// (the additive string/comment arms must not perturb core-token lexing).
const SLICE1_GUARD = [
  "const x = 42",
  "a == b != c === d !== e",
  "i++ j-- ++k --m",
  "obj.field.nested",
  "fn double n return n * 2",
  "a ?? b",
  "a ?. b",
];

let lex2;

beforeAll(() => {
  const outDir = mkdtempSync(join(tmpdir(), "self-host-v2-lex2-"));
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
  // The chunk is wrapped in its own scope (chunk-namespacing N3), which makes
  // `_scrml_lex_N` chunk-local and hides it from the `return`. This harness runs
  // the chunk with NO runtime to exercise pure lowering, so unwrap it.
  const factory = new Function("_scrml_structural_eq", unwrapChunkScope(client) + `\nreturn ${m[1]};`);
  lex2 = factory(_scrml_structural_eq);
});

describe("self-host-v2 lexer slice-2 — string + comment token-diff vs impl#1", () => {
  test("lex.scrml compiles and exposes a callable lex()", () => {
    expect(typeof lex2).toBe("function");
  });

  for (const src of CORPUS) {
    test(`string/comment parity: ${JSON.stringify(src)}`, () => {
      const ref = lex1(src).map(norm);
      const got = lex2(src).map(norm);
      expect(got).toEqual(ref);
    });
  }

  for (const src of SLICE1_GUARD) {
    test(`slice-1 no-regression: ${JSON.stringify(src)}`, () => {
      const ref = lex1(src).map(norm);
      const got = lex2(src).map(norm);
      expect(got).toEqual(ref);
    });
  }

  test("every corpus token stream ends in EOF", () => {
    for (const src of CORPUS) {
      const got = lex2(src).map(norm);
      expect(got.length).toBeGreaterThan(0);
      expect(got[got.length - 1].kind).toBe("EOF");
    }
  });

  test("impl#2 emits a StringLit payload kind carrying the raw lexeme", () => {
    const toks = lex2("'hi'");
    const strTok = toks.find((t) => (t.kind && typeof t.kind === "object" ? t.kind.variant : t.kind) === "StringLit");
    expect(strTok).toBeDefined();
    expect(strTok.text).toBe("'hi'"); // text = raw (quotes included), matching impl#1
  });

  test("comments emit NO token (skipped as trivia)", () => {
    const got = lex2("// just a comment").map(norm);
    // only EOF remains
    expect(got).toEqual([{ kind: "EOF", text: "", start: 17, end: 17 }]);
    const blk = lex2("/* c */").map(norm);
    expect(blk).toEqual([{ kind: "EOF", text: "", start: 7, end: 7 }]);
  });
});
