// lexer-slice4b.test.js — self-host-v2 LEXER slice-4b TYPED BRACKETSTACK oracle.
//
// Road-B compiler impl#2 (S235), continuing slices 1-4a
// (self-host-v2-lexer-slice{1,2,3,4a}.test.js). Slice-4b swaps the ad-hoc
// `bracketDepth: int` open-bracket COUNTER for a typed `bracketStack: BracketKind[]`
// (an opener `(`/`{`/`[` pushes its kind, a closer `)`/`}`/`]` pops; DEPTH is now
// `bracketStack.length`). The interp-close disambiguation (§51.0.Q.1) — the one
// place the counter was read — now reads `bracketStack.length`; the value is
// identical at every point, so this is a PURE INTERNAL-STATE upgrade with NO change
// to token output.
//
// The correctness contract is therefore NO-REGRESSION: every {kind, text, span,
// cooked} tuple must stay byte-identical to impl#1 (native-parser/lex.js) on
// bracket-heavy + deeply-nested `${…}` inputs — exactly the surface the stack
// drives. Same compile → discover `_scrml_lex_N` → eval → token-diff harness as
// slice-4a, with the same cooked-carrying tuple. Corpus: `[({})]` mixes, nested
// calls/arrays/objects, object-`}`-vs-interp-`}` disambiguation, nested templates,
// regex/division after `}`, plus a slice-1..4a no-regression guard and a few exact
// structural anchors (guarding against a silent impl#1+impl#2 co-drift on the
// disambiguation).

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

// Per-token tuple. StringLit / TemplateChunk ALSO carry `cooked`; every other kind
// compares only {kind, text, start, end} — the full no-regression surface.
function normCooked(t) {
  const kind = normKind(t.kind);
  const base = { kind, text: t.text, start: t.span.start, end: t.span.end };
  if (kind === "StringLit" || kind === "TemplateChunk") base.cooked = cookedOf(t);
  return base;
}

// --- BRACKET-HEAVY (InCode, no templates) — every `[({})]` shape the stack folds.
const BRACKET_CORPUS = [
  "[({})]",                       // all three nested + closed in reverse
  "([{}])({})[[]]",               // adjacent + empty groups
  "foo(bar(baz()))",              // nested calls
  "a[0][1][2]",                   // chained index
  "{ a: [1, 2], b: { c: 3 } }",   // object with array + nested object
  "f({ x: [ (1 + 2) ] })",        // call · object · array · paren, 4 deep
  "[[[[[]]]]]",                   // deep same-kind nesting
  "x(a)(b)(c)",                   // curried-ish call chain
  "arr[fn(obj.k)]",               // index holding a call holding a member
  "({})",                         // paren wrapping an empty object
];

// --- INTERP DISAMBIGUATION — the CORE of slice-4b: an object-literal `}` inside an
// interp must lex as RBrace, the interp-closing `}` as TemplateInterpEnd, told apart
// by bracket-stack DEPTH. Includes deeply-nested interps + nested templates. ---
const INTERP_CORPUS = [
  "`${ {a:1} }`",                 // object literal inside interp (1 nested `}`)
  "`${ {a:{b:2}} }`",             // nested objects inside interp
  "`${f({x:1})}`",                // call with object arg
  "`${ [1,2,{k:3}] }`",           // array holding an object
  "`${ {a:[{b:1}]} }`",           // object → array → object
  "`x${a}y${b}z`",                // adjacent interps, plain bodies
  "`${ `${x}` }`",                // nested template one level deep
  "`a${ `b${ {k:1} }c` }d`",      // template→interp→template→interp→object
  "`${ {} }`",                    // empty object inside interp
  "`${ ({a:1}) }`",               // paren-wrapped object inside interp
  "`outer${ [1,{n:[2,3]},4] }end`", // array·object·array mix inside interp
  "`${ f({a:1}, [2], (3)) }`",    // call with object+array+paren args
  "`${a}${b}${c}`",               // three back-to-back interps
  "`pre${ {a:{b:{c:1}}} }post`",  // triple-nested objects inside interp
  "`${ `${ {z:9} }` }`",          // nested template whose interp holds an object
];

// --- REGEX / DIVISION after `}` — a `}` sets regexAllowedAfter=false, so a
// following `/` is DIVISION (both impls must agree). Interp-close `}` too. ---
const AFTER_BRACE_CORPUS = [
  "x = {} / 2",                   // division right after an object-close `}`
  "if (a) {}\n/re/g",             // after a block `}` -> division, NOT a regex
  "({}) / y",                     // paren-wrapped object then division
  "`${ {a:1} / 2 }`",             // division AFTER an object-`}` INSIDE an interp
  "a = [1,2] / 3",                // division after `]`
  "(x) / (y)",                    // division after `)`
];

// --- MIXED — brackets + interps woven with slice-1..4a tokens (whole-stream). ---
const MIXED_CORPUS = [
  'const cfg = { list: [1, 2], msg: `n=${arr[0]}!` }',
  'let out = `${ users.map((u) => u.id) }`',
  'x = f("s\\x41", [{ k: `${y}` }], /re/gi)',
];

// --- slice-1/2/3/4a no-regression guard — MUST stay green. ---
const GUARD_CORPUS = [
  "const x = 42",
  "a == b != c === d !== e",
  "i++ j-- ++k --m",
  "obj.field.nested",
  "'str' + \"dbl\"",
  '"hi\\t\\x41!"',            // escapes still decode (cooked)
  "x // line comment\ny",
  "/* block */ z",
  "/abc/gi",                  // regex still lexes
  "`hello`",                  // plain template
  "`a${x}b`",                 // template triad
  "`\\x41${x}\\u{42}`",       // template chunk cooked precision
];

let lex2;

beforeAll(() => {
  const outDir = mkdtempSync(join(tmpdir(), "self-host-v2-lex4b-"));
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

describe("self-host-v2 lexer slice-4b — typed BracketStack no-regression token-diff vs impl#1", () => {
  test("lex.scrml compiles and exposes a callable lex()", () => {
    expect(typeof lex2).toBe("function");
  });

  for (const src of BRACKET_CORPUS) {
    test(`bracket-heavy parity: ${JSON.stringify(src)}`, () => {
      expect(lex2(src).map(normCooked)).toEqual(lex1(src).map(normCooked));
    });
  }

  for (const src of INTERP_CORPUS) {
    test(`interp disambiguation parity: ${JSON.stringify(src)}`, () => {
      expect(lex2(src).map(normCooked)).toEqual(lex1(src).map(normCooked));
    });
  }

  for (const src of AFTER_BRACE_CORPUS) {
    test(`regex/division-after-brace parity: ${JSON.stringify(src)}`, () => {
      expect(lex2(src).map(normCooked)).toEqual(lex1(src).map(normCooked));
    });
  }

  for (const src of MIXED_CORPUS) {
    test(`mixed bracket/interp parity: ${JSON.stringify(src)}`, () => {
      expect(lex2(src).map(normCooked)).toEqual(lex1(src).map(normCooked));
    });
  }

  for (const src of GUARD_CORPUS) {
    test(`slice-1..4a no-regression: ${JSON.stringify(src)}`, () => {
      expect(lex2(src).map(normCooked)).toEqual(lex1(src).map(normCooked));
    });
  }

  // --- Exact structural anchors: guard against a silent impl#1+impl#2 co-drift on
  // the disambiguation (both wrong the same way would pass the differential above). ---

  test("object-`}` vs interp-`}`: `${ {a:1} }` yields exactly one RBrace + one TemplateInterpEnd", () => {
    const kinds = lex2("`${ {a:1} }`").map((t) => normKind(t.kind));
    expect(kinds.filter((k) => k === "RBrace").length).toBe(1);
    expect(kinds.filter((k) => k === "TemplateInterpEnd").length).toBe(1);
    expect(kinds.filter((k) => k === "TemplateInterpStart").length).toBe(1);
  });

  test("nested objects inside interp: `${ {a:{b:2}} }` yields two RBrace + one TemplateInterpEnd", () => {
    const kinds = lex2("`${ {a:{b:2}} }`").map((t) => normKind(t.kind));
    expect(kinds.filter((k) => k === "LBrace").length).toBe(2);
    expect(kinds.filter((k) => k === "RBrace").length).toBe(2);
    expect(kinds.filter((k) => k === "TemplateInterpEnd").length).toBe(1);
  });

  test("nested template: `${ `${x}` }` yields two TemplateInterpStart/End pairs, zero RBrace", () => {
    const kinds = lex2("`${ `${x}` }`").map((t) => normKind(t.kind));
    expect(kinds.filter((k) => k === "TemplateInterpStart").length).toBe(2);
    expect(kinds.filter((k) => k === "TemplateInterpEnd").length).toBe(2);
    expect(kinds.filter((k) => k === "RBrace").length).toBe(0);
  });

  test("deep nesting: `a${ `b${ {k:1} }c` }d` — the innermost object-`}` is an RBrace, both interps close", () => {
    const kinds = lex2("`a${ `b${ {k:1} }c` }d`").map((t) => normKind(t.kind));
    expect(kinds.filter((k) => k === "RBrace").length).toBe(1);            // the {k:1} object close
    expect(kinds.filter((k) => k === "LBrace").length).toBe(1);
    expect(kinds.filter((k) => k === "TemplateInterpStart").length).toBe(2);
    expect(kinds.filter((k) => k === "TemplateInterpEnd").length).toBe(2);
  });

  test("division after `}` is NOT a regex: `x = {} / 2` emits a Slash, no RegexLit", () => {
    const kinds = lex2("x = {} / 2").map((t) => normKind(t.kind));
    expect(kinds).toContain("Slash");
    expect(kinds.filter((k) => k === "RegexLit").length).toBe(0);
  });

  test("bracket balance: `[({})]` emits matched open/close counts", () => {
    const kinds = lex2("[({})]").map((t) => normKind(t.kind));
    expect(kinds.filter((k) => k === "LBracket").length).toBe(1);
    expect(kinds.filter((k) => k === "RBracket").length).toBe(1);
    expect(kinds.filter((k) => k === "LParen").length).toBe(1);
    expect(kinds.filter((k) => k === "RParen").length).toBe(1);
    expect(kinds.filter((k) => k === "LBrace").length).toBe(1);
    expect(kinds.filter((k) => k === "RBrace").length).toBe(1);
  });
});
