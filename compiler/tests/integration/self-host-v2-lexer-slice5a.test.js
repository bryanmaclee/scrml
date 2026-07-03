// lexer-slice5a.test.js — self-host-v2 LEXER slice-5a BAREVARIANT `.foo` oracle.
//
// Road-B compiler impl#2 (S235), continuing slices 1-4b
// (self-host-v2-lexer-slice{1,2,3,4a,4b}.test.js). Slice-5a adds the contextual
// `.foo` BareVariant token: a `.` in VALUE position (regexAllowedAfter — the same
// value-vs-member predicate the regex `/` reuses) immediately followed by an
// ident-start lexes as ONE BareVariant(name) token (text ".name"), matching impl#1;
// in MEMBER position (`obj.foo`, after a value) the `.` stays a plain Dot.
//
// Same compile → discover `_scrml_lex_N` → eval → token-diff harness as slice-4b,
// with the same {kind, text, span, cooked} tuple (cooked is compared for
// StringLit/TemplateChunk in the no-regression guard). Corpus: BareVariant value
// positions (after `=`/`(`/`[`/`,`/`return`/statement-start/in a `${}` interp),
// member-access `.` after a value (`obj.foo`, `a().b`, `x[0].y`), BareVariant then
// member (`.Foo.bar`) + division after a BareVariant (`x = .A / 2` — validates
// regexAllowedAfter(BareVariant)=false), adjacent (`[.A, .B]`), plus a slice-1..4b
// no-regression guard and exact structural anchors.
//
// OUT OF SCOPE (impl#2-internal negative checks below, NOT differential vs impl#1 —
// they diverge on token classes impl#2 does not have yet, orthogonal to BareVariant):
//   .5     — impl#1 one NumberLit(".5"); impl#2 has no leading-dot NumberLit → Dot+Number.
//   ...    — impl#1 one Ellipsis;        impl#2 has no Ellipsis           → three Dots.
//   @.field— impl#1 one ScrmlAt("@.field") via the `@.` sigil handler; impl#2 has no
//            `@`/ScrmlAt → `@` is Unknown, and regexAllowedAfter(Unknown)=false keeps
//            `.field` a plain Dot (NOT a spurious BareVariant). Full `@.field`→one
//            ScrmlAt parity awaits the ScrmlAt sigil slice. What slice-5a GUARANTEES:
//            `.field` after `@` is NOT a BareVariant (the negative check below).

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

// Cross-impl kind tag: impl#1 string OR impl#2 {variant,data}/string -> canonical.
// BareVariant normalizes identically on both sides ("BareVariant"): impl#1 emits the
// string kind TokenKind.BareVariant; impl#2 emits {variant:"BareVariant", data:{name}}.
function normKind(k) {
  const tag = k && typeof k === "object" ? k.variant : k;
  if (tag === "Eof" || tag === "EOF") return "EOF";
  if (typeof tag === "string" && tag.startsWith("Kw")) return "KW";
  if (tag === "Keyword") return "KW";
  return tag;
}

// The `cooked` value, from wherever the impl parks it (guard's string/template cases).
function cookedOf(t) {
  if (t.kind && typeof t.kind === "object" && t.kind.data && "cooked" in t.kind.data) {
    return t.kind.data.cooked;
  }
  return t.cooked;
}

// Per-token tuple. StringLit / TemplateChunk ALSO carry `cooked`; every other kind
// (incl. BareVariant) compares only {kind, text, start, end} — the `name` payload is
// captured by `text` (".name" on both sides).
function normCooked(t) {
  const kind = normKind(t.kind);
  const base = { kind, text: t.text, start: t.span.start, end: t.span.end };
  if (kind === "StringLit" || kind === "TemplateChunk") base.cooked = cookedOf(t);
  return base;
}

// --- BAREVARIANT VALUE POSITIONS — a `.` after a value-EXPECTING token is a variant. ---
const VALUE_VARIANT_CORPUS = [
  "x = .Foo",                     // after `=` (Assign)
  "f(.Foo)",                      // after `(` (LParen)
  "[.Foo]",                       // after `[` (LBracket)
  "[a, .Foo]",                    // after `,` (Comma)
  "return .Foo",                  // after a value-keyword (return)
  ".Foo",                         // at statement start (no prior token)
  "`${.Foo}`",                    // in a `${}` interp (after TemplateInterpStart)
  "const t = .Dot",               // after `=` in a decl
  "arr.map(.Foo)",                // member `.map` then a bare-variant arg
  "f(a, .b, c)",                  // variant as a middle argument
  ".Some(x)",                     // bare variant then a call
  "x = .A == .B",                 // variant, `==`, variant (both value positions)
  "match k { .LParen :> 1 }",     // variant after `{` inside a match
  "const k: TokenKind = .Dot",    // annotated decl, variant after `=`
];

// --- MEMBER ACCESS — a `.` after a VALUE token is a plain Dot, NOT a variant. ---
const MEMBER_DOT_CORPUS = [
  "obj.foo",                      // after an Ident
  "a().b",                        // after `)` (RParen)
  "x[0].y",                       // after `]` (RBracket)
  "obj.foo.bar",                  // chained member access
  "point.x.y.z",                  // deep member chain
];

// --- BAREVARIANT THEN MEMBER / DIVISION — validates regexAllowedAfter(BareVariant)=false:
//   after a BareVariant, a `.` is member access and a `/` is division. ---
const VARIANT_THEN_MEMBER_CORPUS = [
  ".Foo.bar",                     // BareVariant(.Foo) then Dot + Ident(bar)
  "x = .A / 2",                   // division after a BareVariant (Slash, NOT a regex)
  ".State.Cape",                  // variant then member
];

// --- ADJACENT — back-to-back variants in an array. ---
const ADJACENT_CORPUS = [
  "[.A, .B]",
  "[.A, .B, .C]",
  "x = .foo\ny = .bar",           // variants across a newline
];

// --- MIXED — variants woven with slice-1..4a tokens (whole-stream). ---
const MIXED_CORPUS = [
  "match tok.kind { .LParen :> 1 .RParen :> 2 _ :> 0 }",  // member `.kind` + variants
  "const cfg = { kind: .Dot, next: .Ident }",             // struct with variant fields
  "f(.A, [.B], `${.C}`)",                                 // variants across call/array/interp
];

// --- slice-1/2/3/4a/4b no-regression guard — MUST stay green. ---
const GUARD_CORPUS = [
  "const x = 42",
  "a == b != c === d !== e",
  "i++ j-- ++k --m",
  "obj.field.nested",          // member chains still Dot+Ident (no BareVariant)
  "'str' + \"dbl\"",
  '"hi\\t\\x41!"',             // escapes still decode (cooked)
  "x // line comment\ny",
  "/* block */ z",
  "/abc/gi",                   // regex still lexes
  "`hello`",                   // plain template
  "`a${x}b`",                  // template triad
  "`\\x41${x}\\u{42}`",        // template chunk cooked precision
  "[({})]",                    // bracket stack
  "`${ {a:1} }`",              // interp disambiguation
];

let lex2;

beforeAll(() => {
  const outDir = mkdtempSync(join(tmpdir(), "self-host-v2-lex5a-"));
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

describe("self-host-v2 lexer slice-5a — BareVariant `.foo` token-diff vs impl#1", () => {
  test("lex.scrml compiles and exposes a callable lex()", () => {
    expect(typeof lex2).toBe("function");
  });

  for (const src of VALUE_VARIANT_CORPUS) {
    test(`bare-variant value-position parity: ${JSON.stringify(src)}`, () => {
      expect(lex2(src).map(normCooked)).toEqual(lex1(src).map(normCooked));
    });
  }

  for (const src of MEMBER_DOT_CORPUS) {
    test(`member-access Dot parity: ${JSON.stringify(src)}`, () => {
      expect(lex2(src).map(normCooked)).toEqual(lex1(src).map(normCooked));
    });
  }

  for (const src of VARIANT_THEN_MEMBER_CORPUS) {
    test(`variant-then-member/division parity: ${JSON.stringify(src)}`, () => {
      expect(lex2(src).map(normCooked)).toEqual(lex1(src).map(normCooked));
    });
  }

  for (const src of ADJACENT_CORPUS) {
    test(`adjacent-variant parity: ${JSON.stringify(src)}`, () => {
      expect(lex2(src).map(normCooked)).toEqual(lex1(src).map(normCooked));
    });
  }

  for (const src of MIXED_CORPUS) {
    test(`mixed variant/token parity: ${JSON.stringify(src)}`, () => {
      expect(lex2(src).map(normCooked)).toEqual(lex1(src).map(normCooked));
    });
  }

  for (const src of GUARD_CORPUS) {
    test(`slice-1..4b no-regression: ${JSON.stringify(src)}`, () => {
      expect(lex2(src).map(normCooked)).toEqual(lex1(src).map(normCooked));
    });
  }

  // --- Exact structural anchors: guard against a silent impl#1+impl#2 co-drift (both
  // ceasing to emit BareVariant would pass the differential above but break the feature). ---

  test("`.Foo` yields exactly one BareVariant with text `.Foo`", () => {
    const toks = lex2(".Foo");
    const bare = toks.filter((t) => normKind(t.kind) === "BareVariant");
    expect(bare.length).toBe(1);
    expect(bare[0].text).toBe(".Foo");
    expect(bare[0].span.start).toBe(0);
    expect(bare[0].span.end).toBe(4);
  });

  test("`obj.foo` yields ZERO BareVariant (member access is Dot + Ident)", () => {
    const kinds = lex2("obj.foo").map((t) => normKind(t.kind));
    expect(kinds.filter((k) => k === "BareVariant").length).toBe(0);
    expect(kinds).toContain("Dot");
  });

  test("`[.A, .B]` yields exactly two BareVariant tokens", () => {
    const bare = lex2("[.A, .B]").filter((t) => normKind(t.kind) === "BareVariant");
    expect(bare.length).toBe(2);
    expect(bare.map((t) => t.text)).toEqual([".A", ".B"]);
  });

  test("`.Foo.bar` — one BareVariant then a member Dot (the `.bar` is NOT a variant)", () => {
    const kinds = lex2(".Foo.bar").map((t) => normKind(t.kind));
    expect(kinds.filter((k) => k === "BareVariant").length).toBe(1);
    expect(kinds.filter((k) => k === "Dot").length).toBe(1);
    expect(kinds.filter((k) => k === "Ident").length).toBe(1);
  });

  test("`x = .A / 2` — a `/` after a BareVariant is division (Slash, no RegexLit)", () => {
    const kinds = lex2("x = .A / 2").map((t) => normKind(t.kind));
    expect(kinds.filter((k) => k === "BareVariant").length).toBe(1);
    expect(kinds).toContain("Slash");
    expect(kinds.filter((k) => k === "RegexLit").length).toBe(0);
  });

  // --- impl#2-internal negatives (out of scope for the differential — divergent token
  // classes; see header). What slice-5a GUARANTEES: none of these spawns a BareVariant. ---

  test("`.5` does NOT become a BareVariant (digit after `.`)", () => {
    expect(lex2(".5").filter((t) => normKind(t.kind) === "BareVariant").length).toBe(0);
  });

  test("`...` does NOT become a BareVariant (`.` after `.`)", () => {
    expect(lex2("...").filter((t) => normKind(t.kind) === "BareVariant").length).toBe(0);
  });

  test("`@.field` — `.field` after `@`(Unknown) is a plain Dot, NOT a spurious BareVariant", () => {
    const kinds = lex2("@.field").map((t) => normKind(t.kind));
    expect(kinds.filter((k) => k === "BareVariant").length).toBe(0);
    expect(kinds).toEqual(["Unknown", "Dot", "Ident", "EOF"]);
  });
});
