// lexer-slice1.test.js — self-host-v2 LEXER slice-1 token-diff oracle.
//
// Road-B compiler impl#2 (S234). The lexer is human-authored idiomatic scrml
// (`compiler/self-host-v2/lex.scrml`, Approach B: a pure `fn lex(src) -> Token[]`
// folding `step` over a `match (mode, event)` table). This test is the wave's
// ORACLE per the arch-skeleton RULING §5 + the conformance-driven-build dive:
// a TOKEN-STREAM DIFFERENTIAL against impl#1 (`native-parser/lex.js`) over a
// curated slice-1 corpus (identifiers/keywords, numbers, operators,
// punctuation — NO strings/comments/regex/templates, which are deferred slices).
//
// Pipeline:
//   1. compile lex.scrml via the live compiler (`<program>` mode -> client.js;
//      the importable library-mode path can't lower typed-payload + match today
//      — see compiler/self-host-v2/progress.md finding F1).
//   2. discover the emitted `_scrml_lex_N` fn + eval it (the only runtime helper
//      a pure lexer references is `_scrml_structural_eq`, stubbed below).
//   3. token-diff impl#2 vs impl#1 on {kind, text, start, end}, normalized.
//
// Normalization (D3: token taxonomy is impl freedom; the wave oracle is
// normalized/allowlisted): payload variant -> tag; any `Kw*` (impl#1) and
// `Keyword` (impl#2) collapse to "KW" (the compared `text` discriminates the
// specific keyword); `Eof`/`EOF` -> "EOF".

import { describe, test, expect, beforeAll } from "bun:test";
import { mkdtempSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { compileScrml } from "../../src/api.js";
import { lex as lex1 } from "../../native-parser/lex.js";

const LEX_SCRML = join(import.meta.dir, "..", "..", "self-host-v2", "lex.scrml");

// A structural deep-equal matching the runtime's `_scrml_structural_eq` for the
// value shapes a lexer produces (primitives / arrays / plain objects). The
// pure lexer references no other runtime helper.
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
// cross-impl canonical tag.
function normKind(k) {
  const tag = k && typeof k === "object" ? k.variant : k;
  if (tag === "Eof" || tag === "EOF") return "EOF";
  if (typeof tag === "string" && tag.startsWith("Kw")) return "KW";
  if (tag === "Keyword") return "KW";
  return tag;
}
const norm = (t) => ({ kind: normKind(t.kind), text: t.text, start: t.span.start, end: t.span.end });

// The slice-1 corpus subset: ONLY identifiers/keywords, numbers, operators,
// punctuation. No strings/comments/regex/templates (deferred slices).
const CORPUS = [
  // identifiers + keywords
  "const x = 42",
  "let result = value",
  "var foo",
  "return items",
  "function fn type match import export from",
  "if x else y for while break continue",
  "abc _under $dollar mix123 a1b2",
  // numbers
  "0 1 42 100000",
  "3.14 0.5 10.0",
  "0xFF 0xdeadBEEF 0X10",
  "1e10 2E5 6.022e23 1e-9 3e+4",
  // operators — maximal munch
  "a + b - c * d / e % f",
  "a == b != c === d !== e",
  "a < b <= c > d >= e",
  "i++ j-- ++k --m",
  "a ?? b",
  "a ?. b",
  "x = y => z",
  "!flag !!x",
  // punctuation / brackets
  "( ) { } [ ] ; , . : ?",
  "obj.field.nested",
  "foo(bar, baz)",
  "arr[0][1]",
  "a . b : c",
  // mixed realistic slice-1 lines
  "count = count + 1",
  "total >= threshold",
  "fn double n return n * 2",
  "let ok = a && b || c",
  // whitespace / newline handling (trivia skipped)
  "  spaced   out  ",
  "line1\n  line2\n\tline3",
  "",
];

let lex2;

beforeAll(() => {
  const outDir = mkdtempSync(join(tmpdir(), "self-host-v2-lex-"));
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
  // eval the emitted module body in a fresh scope; return the entry fn.
  const factory = new Function("_scrml_structural_eq", client + `\nreturn ${m[1]};`);
  lex2 = factory(_scrml_structural_eq);
});

describe("self-host-v2 lexer slice-1 — token-diff vs impl#1", () => {
  test("lex.scrml compiles and exposes a callable lex()", () => {
    expect(typeof lex2).toBe("function");
  });

  for (const src of CORPUS) {
    test(`token parity: ${JSON.stringify(src)}`, () => {
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

  test("impl#2 emits payload-carrying kinds (NumberLit / Ident / Keyword)", () => {
    const toks = lex2("const x = 42");
    const kinds = toks.map((t) => (t.kind && typeof t.kind === "object" ? t.kind.variant : t.kind));
    expect(kinds).toContain("Keyword"); // const
    expect(kinds).toContain("Ident"); // x
    expect(kinds).toContain("NumberLit"); // 42
  });
});
