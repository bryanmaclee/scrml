// m67-d7-given-form-parse.test.js — M6.7-D7 FIX-NATIVE.
//
// ROOT CAUSE (Phase-0 verified — see
// docs/changes/m67-phase-a-flag-flip/d7-given-form.md):
//   The native parser lexed `given` -> KwGiven (token.js:213) UNCONDITIONALLY
//   but neither parsePrimary nor the statement dispatcher had a `given` arm, so
//   EVERY statement-position `given x => { body }` (SPEC §42.2.3 presence guard)
//   fired E-EXPR-UNEXPECTED:KwGiven and cascaded to E-STMT-UNEXPECTED-TOKEN
//   ("no statement begins here"), bailing the whole `${...}` logic block. The
//   same fire happened for a `given n` inside a `match { ... }` arm body (the
//   match body uses the shared statement-list parser) — so the standalone gap
//   and the in-match gap (the D3b follow-on) shared ONE root cause.
//
//   LIVE (the oracle) recognizes a STATEMENT-position `given` KEYWORD (it is in
//   the live STMT_KEYWORDS set) and produces a `given-guard` LogicStatement
//   (ast-builder.js:5523 — `{kind:"given-guard", variables, body, span}`):
//     given x => { ... }       -> given-guard{variables:["x"], body:[...]}
//     given a, b => { ... }     -> given-guard{variables:["a","b"], body:[...]}
//   `given` outside a guard lead is a plain identifier (SPEC §4.11.4); native's
//   no-parsePrimary-arm means an expression-position `given` is unaffected.
//
// THE FIX:
//   - ast-stmt.js: StmtKind.GivenGuard + makeGivenGuard(variables, body, span).
//   - parse-stmt.js: a statement-dispatch arm for KwGiven -> parseGivenGuard,
//     which collects comma-separated bare idents (rejecting property paths with
//     E-SYNTAX-044, mirroring live), consumes `=>`, parses the `{ body }` block
//     as a FLAT statement list (the live given-guard body shape).
//   - translate-stmt.js: GivenGuard -> live `given-guard` (variables copied,
//     body translated recursively).
//
// These tests drive BOTH pipelines (LIVE = splitBlocks+buildAST = the oracle;
// NATIVE = nativeParseFile) and assert (a) the previously-failing `given` forms
// now parse native with ZERO errors and (b) the bridged given-guard node MATCHES
// the live oracle's `{kind, variables, body}` shape field-for-field.

import { describe, test, expect } from "bun:test";

import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { nativeParseFile } from "../../native-parser/parse-file.js";

const FP = "m67-d7.scrml";

// Wrap a logic body in a `${ }` block so the ast-builder logic path runs.
function wrap(body) {
  return "${\n" + body + "\n}";
}

// Only real (non-warning, non-info) diagnostics — the `${}` wrapper and the
// default-logic mode emit informational/warning diagnostics in both pipelines.
function realErrors(arr) {
  return (arr || [])
    .filter((e) => !String(e.code || "").startsWith("W-"))
    .filter((e) => !String(e.code || "").startsWith("I-"))
    .map((e) => e.code);
}

function liveParse(body) {
  const bs = splitBlocks(FP, wrap(body));
  const tab = buildAST(bs, null);
  return { ast: tab.ast, errors: realErrors(tab.errors) };
}

function nativeParse(body) {
  const r = nativeParseFile(FP, wrap(body));
  return { ast: r.ast, errors: realErrors(r.errors) };
}

// Depth-first find the first given-guard node anywhere in a FileAST.
function findGivenGuard(ast) {
  if (!ast || !Array.isArray(ast.nodes)) return null;
  const stack = [...ast.nodes];
  while (stack.length > 0) {
    const n = stack.shift();
    if (!n || typeof n !== "object") continue;
    if (n.kind === "given-guard") return n;
    for (const k of Object.keys(n)) {
      const v = n[k];
      if (Array.isArray(v)) stack.push(...v);
      else if (v && typeof v === "object") stack.push(v);
    }
  }
  return null;
}

// The load-bearing parity shape: the variables binding-name array + the body
// statement-kind sequence. (Spans/ids are volatile and excluded — the within-
// node canary covers span-coord parity; this test gates the structural shape.)
function guardShape(g) {
  if (!g) return null;
  return {
    kind: g.kind,
    variables: g.variables,
    bodyKinds: Array.isArray(g.body) ? g.body.map((b) => b.kind) : null,
  };
}

// =============================================================================
// THE GAP — statement-position `given` presence guard now parses native with
// ZERO errors and the bridged given-guard MATCHES the live oracle shape.
// =============================================================================
describe("M6.7-D7 — `given x => { body }` presence guard parses native", () => {
  const FORMS = [
    {
      label: "given single var",
      body: 'let name: string | not = "alice"\ngiven name => {\n  let upper = name\n}',
      variables: ["name"],
    },
    {
      label: "given multi var (all-or-nothing)",
      body: 'let a: string | not = "x"\nlet b: number | not = 2\ngiven a, b => {\n  let _both = a\n}',
      variables: ["a", "b"],
    },
    {
      label: "given with empty body",
      body: 'let name: string | not = "alice"\ngiven name => {\n}',
      variables: ["name"],
    },
    {
      label: "given with nested function in body",
      body: 'let name: string | not = "alice"\ngiven name => {\n  function log(s: string) { let _ = s }\n}',
      variables: ["name"],
    },
  ];

  for (const f of FORMS) {
    test(`native parses ZERO errors — ${f.label}`, () => {
      const nat = nativeParse(f.body);
      expect(nat.errors).toEqual([]);
    });

    test(`bridged given-guard matches live oracle — ${f.label}`, () => {
      const live = liveParse(f.body);
      const nat = nativeParse(f.body);
      const liveG = findGivenGuard(live.ast);
      const natG = findGivenGuard(nat.ast);
      // The live oracle MUST itself produce a given-guard (parity target sanity).
      expect(liveG).not.toBeNull();
      expect(natG).not.toBeNull();
      // Variables array matches the expected binding names.
      expect(natG.variables).toEqual(f.variables);
      // Native shape matches the live oracle shape field-for-field.
      expect(guardShape(natG)).toEqual(guardShape(liveG));
    });
  }
});

// =============================================================================
// IN-MATCH POSITION — a `given n` inside a `match { ... }` arm body produces the
// SAME given-guard node in both pipelines (the D3b follow-on is subsumed: the
// match body shares the statement-list parser, so the same production fires).
// =============================================================================
describe("M6.7-D7 — `given` inside a match arm (subsumes D3b)", () => {
  const body =
    'let name: string | not = "alice"\n' +
    "match name {\n" +
    "  given n => { let _ = n }\n" +
    "}";

  test("native produces a given-guard inside the match body", () => {
    const nat = nativeParse(body);
    const natG = findGivenGuard(nat.ast);
    expect(natG).not.toBeNull();
    expect(natG.variables).toEqual(["n"]);
  });

  test("the in-match given-guard matches the live oracle shape", () => {
    const live = liveParse(body);
    const nat = nativeParse(body);
    const liveG = findGivenGuard(live.ast);
    const natG = findGivenGuard(nat.ast);
    expect(liveG).not.toBeNull();
    expect(guardShape(natG)).toEqual(guardShape(liveG));
  });
});

// =============================================================================
// NON-REGRESSION — `is given` (the presence-check suffix the native parser
// already supported) is UNAFFECTED by the new statement-position given arm.
// =============================================================================
describe("M6.7-D7 — `is given` presence-check unaffected", () => {
  test("`x is given` still parses native with zero errors", () => {
    const nat = nativeParse('let name: string | not = "alice"\nlet b = name is given');
    expect(nat.errors).toEqual([]);
  });
});
