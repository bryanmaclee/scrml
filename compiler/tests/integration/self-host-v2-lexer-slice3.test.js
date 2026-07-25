// lexer-slice3.test.js — self-host-v2 LEXER slice-3 token-diff oracle.
//
// Road-B compiler impl#2 (S234), continuing slices 1-2
// (self-host-v2-lexer-slice{1,2}.test.js). Slice 3 extends the Approach-B
// pure-fold lexer (`compiler/self-host-v2/lex.scrml`) with the last two token
// classes: REGEX bodies (`/pattern/flags` — char-classes + escapes + the
// regex-vs-division disambiguation) and TEMPLATE-INTERP nesting
// (`` `chunk${expr}chunk` `` — the §51.0.Q.1 composite, interp bodies lexed as
// expressions one level deep). This test is the wave ORACLE for that slice: a
// TOKEN-STREAM DIFFERENTIAL against impl#1 (`native-parser/lex.js`) over curated
// regex + template corpora, plus a slice-1/2 no-regression guard.
//
// Pipeline mirrors slices 1-2: compile lex.scrml via the live compiler
// (`<program>` mode -> client.js; the importable library path can't lower
// typed-payload + match today — progress.md finding F1), discover the emitted
// `_scrml_lex_N` fn, eval it (only runtime helper a pure lexer references is
// `_scrml_structural_eq`, stubbed below), and token-diff impl#2 vs impl#1 on
// {kind, text, start, end}.
//
// OUT OF SCOPE (deferred token classes, excluded from the corpus): the `.foo`
// BareVariant production (impl#1 lexes `.length` after a value as BareVariant;
// impl#2 emits Dot+Ident — a slice-1 scoping boundary, not a regex/template
// bug) and value-keyword-then-regex where impl#1's larger keyword table diverges
// from impl#2's subset (`typeof /re/` etc. — impl#2 lexes `typeof` as Ident).

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
// cross-impl canonical tag. RegexLit / TemplateChunk / TemplateInterpStart /
// TemplateInterpEnd are shared kinds on both sides.
function normKind(k) {
  const tag = k && typeof k === "object" ? k.variant : k;
  if (tag === "Eof" || tag === "EOF") return "EOF";
  if (typeof tag === "string" && tag.startsWith("Kw")) return "KW";
  if (tag === "Keyword") return "KW";
  return tag;
}
const norm = (t) => ({ kind: normKind(t.kind), text: t.text, start: t.span.start, end: t.span.end });

// --- REGEX corpus: regex literals in regex-allowed positions (start-of-input,
// after `=`, after `return`, inside `(`/`[`, inside a template interp), with
// char-classes (a `/` inside `[]` does NOT close), escapes (`\/`), flags, and
// unterminated (EOF / line-terminator) bodies. ---
const REGEX_CORPUS = [
  "/abc/",
  "/abc/gi",
  "x = /abc/",
  "return /a.b/",
  "/[a-z]+/g",
  "/[/]/",       // char-class contains a `/` — does not close the regex
  "/a\\/b/",     // escaped slash in the body
  "/[\\]]/g",    // char-class with an escaped `]`
  "/\\//",       // a regex matching a single (escaped) slash
  "(/x/)",
  "[/y/]",
  "y = /ab/ + 1",
  "x ? /a/ : /b/",
  "/abc",        // unterminated — runs to EOF
  "/abc\ndef",   // unterminated — stops at the line terminator
];

// --- DIVISION corpus: a `/` after a value / closing bracket is division, NOT a
// regex (regexAllowedAfter === false). ---
const DIVISION_CORPUS = [
  "a / b",
  "1 / 2",
  "foo() / 2",
  "} / 2",
];

// --- TEMPLATE corpus: plain, empty, single / multi-interp, interp-at-start,
// object-literal + expression + string + regex interp bodies, NESTED templates
// (`${` … `}` one and two levels deep), escapes, newlines. ---
const TEMPLATE_CORPUS = [
  "`hello`",
  "``",                          // empty template -> chunk "`"
  "`a${x}b`",
  "`${x}`",                      // interp at start -> empty leading chunk
  "`${a}mid${b}`",
  "`${x}${y}`",                  // adjacent interps, no text between
  "`a${1}b${2}c${3}d`",          // three interps
  "`${}`",                       // empty interp body
  "`${ {a:1} }`",                // object literal inside interp (brace disambig)
  "`${{a:{b:1}}}`",              // deeply nested braces inside interp
  "`sum=${a + b}`",              // expression inside interp
  "`x${ 'y' }z`",                // string inside interp
  "`${ /re/ }`",                 // regex inside interp
  "`${ [1,2].map(x => x) }`",    // arrow + array + call inside interp
  "`${`${x}`}`",                 // nested template inside interp
  "`${`${`${x}`}`}`",            // triple-nested template
  "`outer ${ `inner ${1}` } end`", // nested template with surrounding text
  "`a\\`b`",                     // escaped backtick does not close the template
  "`tab\\t${x}`",                // escape before an interp
  "`line1\nline2`",              // literal newline in the body
];

// --- MIXED: templates + regex woven with slice-1/2 tokens. ---
const MIXED_CORPUS = [
  "const s = `hi ${name}!`",
  "let t = `v=${1 + 2}` + 3",
];

// --- slice-1/2 regression guard — these MUST stay green under the slice-3
// lexer (the additive regex/template arms must not perturb core lexing). ---
const SLICE12_GUARD = [
  "const x = 42",
  "a == b != c === d !== e",
  "i++ j-- ++k --m",
  "obj.field.nested",
  "a ?? b",
  "a ?. b",
  "'str' + \"dbl\"",
  "x // line comment\ny",
  "/* block */ z",
];

let lex2;

beforeAll(() => {
  const outDir = mkdtempSync(join(tmpdir(), "self-host-v2-lex3-"));
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

describe("self-host-v2 lexer slice-3 — regex + template token-diff vs impl#1", () => {
  test("lex.scrml compiles and exposes a callable lex()", () => {
    expect(typeof lex2).toBe("function");
  });

  for (const src of REGEX_CORPUS) {
    test(`regex parity: ${JSON.stringify(src)}`, () => {
      expect(lex2(src).map(norm)).toEqual(lex1(src).map(norm));
    });
  }

  for (const src of DIVISION_CORPUS) {
    test(`division parity: ${JSON.stringify(src)}`, () => {
      expect(lex2(src).map(norm)).toEqual(lex1(src).map(norm));
    });
  }

  for (const src of TEMPLATE_CORPUS) {
    test(`template parity: ${JSON.stringify(src)}`, () => {
      expect(lex2(src).map(norm)).toEqual(lex1(src).map(norm));
    });
  }

  for (const src of MIXED_CORPUS) {
    test(`mixed parity: ${JSON.stringify(src)}`, () => {
      expect(lex2(src).map(norm)).toEqual(lex1(src).map(norm));
    });
  }

  for (const src of SLICE12_GUARD) {
    test(`slice-1/2 no-regression: ${JSON.stringify(src)}`, () => {
      expect(lex2(src).map(norm)).toEqual(lex1(src).map(norm));
    });
  }

  test("every corpus token stream ends in EOF", () => {
    for (const src of [...REGEX_CORPUS, ...DIVISION_CORPUS, ...TEMPLATE_CORPUS, ...MIXED_CORPUS]) {
      const got = lex2(src).map(norm);
      expect(got.length).toBeGreaterThan(0);
      expect(got[got.length - 1].kind).toBe("EOF");
    }
  });

  test("impl#2 emits a RegexLit payload kind carrying the raw lexeme", () => {
    const toks = lex2("/ab/g");
    const rx = toks.find((t) => (t.kind && typeof t.kind === "object" ? t.kind.variant : t.kind) === "RegexLit");
    expect(rx).toBeDefined();
    expect(rx.text).toBe("/ab/g"); // text = raw (both slashes + flags), matching impl#1
  });

  test("impl#2 emits the template token triad (Chunk / InterpStart / InterpEnd)", () => {
    const kinds = lex2("`a${x}b`").map((t) => (t.kind && typeof t.kind === "object" ? t.kind.variant : t.kind));
    expect(kinds).toEqual(["TemplateChunk", "TemplateInterpStart", "Ident", "TemplateInterpEnd", "TemplateChunk", "Eof"]);
  });
});
