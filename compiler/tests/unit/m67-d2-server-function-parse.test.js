// m67-d2-server-function-parse.test.js — M6.7-D2 FIX-NATIVE.
//
// ROOT CAUSE (Phase-0 verified — see
// docs/changes/m67-phase-a-flag-flip/d2-server-function.md):
//   The native parser recognized the `server` / `pure` function-declaration
//   modifier prefix ONLY when it led to the `fn` keyword. A modifier before the
//   `function` keyword — `server function`, `pure function`, `pure server
//   function` (incl. the PRIMER §6 recipe `server function fetchItems()! ->
//   LoadError`) — was NOT recognized: `fnDeclLeadFollows` (parse-stmt.js)
//   returned false, the bare `server` / `pure` fell through to the
//   expression-statement arm, and the cascade produced E-EXPR-UNEXPECTED +
//   E-STMT-MISSING-SEMICOLON + E-STMT-UNEXPECTED-TOKEN. The live/Acorn pipeline
//   ACCEPTS all three forms (ast-builder.js general-function path L8386-8574,
//   fnKind:"function" + isServer/isPure), and the `server function` form is
//   corpus-pervasive — this was the LARGEST native-flip residual cluster.
//
//   This is parity-COMPLETENESS for a form live already accepts, not a subset
//   expansion. §33.6 (`fn` and `pure function` enforce the same purity
//   contract; `fn` is canonical, `pure function` the deprecated synonym) is
//   respected — the `function`
//   keyword keeps fnKind:"function" (NOT collapsed into "fn"); the two remain
//   distinct fnKinds.
//
// THE FIX (compiler/native-parser/parse-stmt.js only):
//   - isFnDeclKeyword(k): new predicate — KwFn OR KwFunction.
//   - fnDeclLeadFollows: accept KwFunction after the server/pure modifier prefix
//     (a BARE function is still dispatched by the dedicated KwFunction arm).
//   - parseScrmlFunctionDecl: read which keyword follows, set fnKind dynamically
//     ("fn" vs "function"); handle the `function*` generator marker; thread
//     isGenerator into makeFunctionDecl + the body parse.
//   - the statement dispatch + both export paths inherit the fix via the shared
//     predicate (`export server function` now parses clean).
//
// These tests drive BOTH pipelines (LIVE = splitBlocks+buildAST = the Acorn-
// backed oracle; NATIVE = nativeParseFile) and assert (a) the previously-failing
// forms now parse native with ZERO errors and (b) the bridged function-decl
// MATCHES the live ast-builder shape (fnKind / isServer / isPure / canFail /
// errorType / isGenerator). The baseline `function` / `fn` / `server fn` /
// `pure fn` forms are asserted UNCHANGED (no regression).

import { describe, test, expect } from "bun:test";

import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { nativeParseFile } from "../../native-parser/parse-file.js";

const FP = "m67-d2.scrml";

// Wrap a logic body in a `${ }` block so the ast-builder logic-decl path runs
// (a bare top-of-file `server`/`pure` lead is treated as markup `text` by the
// block-splitter in BOTH pipelines — that is a separate, identical-on-both
// concern, not the fn-decl-recognition gap under test here).
function wrap(body) {
  return "${\n" + body + "\n}";
}

function liveParse(body) {
  const bs = splitBlocks(FP, wrap(body));
  const tab = buildAST(bs, null);
  return { ast: tab.ast, errors: (tab.errors || []).map((e) => e.code) };
}

function nativeParse(body) {
  const r = nativeParseFile(FP, wrap(body));
  return { ast: r.ast, errors: (r.errors || []).map((e) => e.code) };
}

// Depth-first find the first function-decl node anywhere in a FileAST.
function findFunctionDecl(ast) {
  if (!ast || !Array.isArray(ast.nodes)) return null;
  const stack = [...ast.nodes];
  while (stack.length > 0) {
    const n = stack.shift();
    if (!n || typeof n !== "object") continue;
    if (n.kind === "function-decl") return n;
    for (const k of Object.keys(n)) {
      const v = n[k];
      if (Array.isArray(v)) stack.push(...v);
      else if (v && typeof v === "object") stack.push(v);
    }
  }
  return null;
}

// The load-bearing modifier fields the native fix must match the live oracle on.
// `isPure` / `errorType` are read raw (live spreads them only when set, so they
// are `undefined` when absent — the comparison below treats absent === absent).
function modShape(fd) {
  if (!fd) return null;
  return {
    fnKind: fd.fnKind,
    isServer: fd.isServer === true,
    isPure: fd.isPure === true,
    canFail: fd.canFail === true,
    errorType: fd.errorType ?? null,
    isGenerator: fd.isGenerator === true,
  };
}

// =============================================================================
// THE GAP — `server`/`pure` modifier on `function` now parses native with ZERO
// errors and matches the live AST shape.
// =============================================================================
describe("M6.7-D2 — server/pure modifier on `function` parses native", () => {
  const FORMS = [
    {
      label: "server function",
      body: "server function loadItems() { return 1 }",
      expect: { fnKind: "function", isServer: true, isPure: false, canFail: false, errorType: null, isGenerator: false },
    },
    {
      label: "pure function",
      body: "pure function calc(x) { return x }",
      expect: { fnKind: "function", isServer: false, isPure: true, canFail: false, errorType: null, isGenerator: false },
    },
    {
      label: "pure server function",
      body: "pure server function compute(x) { return x }",
      expect: { fnKind: "function", isServer: true, isPure: true, canFail: false, errorType: null, isGenerator: false },
    },
    {
      label: "server function with failable + named error type (PRIMER §6 recipe)",
      body: "server function fetchItems()! -> LoadError { return 1 }",
      expect: { fnKind: "function", isServer: true, isPure: false, canFail: true, errorType: "LoadError", isGenerator: false },
    },
    {
      label: "server function generator",
      body: "server function* stream() { yield 1 }",
      expect: { fnKind: "function", isServer: true, isPure: false, canFail: false, errorType: null, isGenerator: true },
    },
  ];

  for (const form of FORMS) {
    test(`native parses \`${form.label}\` with zero errors`, () => {
      const n = nativeParse(form.body);
      expect(n.errors).toEqual([]);
    });

    test(`native AST for \`${form.label}\` matches the expected modifier shape`, () => {
      const fd = findFunctionDecl(nativeParse(form.body).ast);
      expect(modShape(fd)).toEqual(form.expect);
    });

    test(`native \`${form.label}\` shape == live oracle shape (parity)`, () => {
      const live = liveParse(form.body);
      const native = nativeParse(form.body);
      // Live oracle parses clean (the gap was native-only).
      expect(live.errors).toEqual([]);
      expect(native.errors).toEqual([]);
      const liveFd = findFunctionDecl(live.ast);
      const nativeFd = findFunctionDecl(native.ast);
      expect(modShape(nativeFd)).toEqual(modShape(liveFd));
    });
  }
});

// =============================================================================
// NO REGRESSION — the baseline forms (bare `function`, `fn`, `server fn`,
// `pure fn`) still parse native with zero errors and the correct fnKind.
// =============================================================================
describe("M6.7-D2 — baseline function/fn forms unchanged", () => {
  const BASELINE = [
    { label: "function", body: "function plain() { return 1 }", fnKind: "function", isServer: false, isPure: false },
    { label: "fn", body: "fn shorthand() { return 1 }", fnKind: "fn", isServer: false, isPure: false },
    { label: "server fn", body: "server fn srv() { return 1 }", fnKind: "fn", isServer: true, isPure: false },
    { label: "pure fn", body: "pure fn calc() { return 1 }", fnKind: "fn", isServer: false, isPure: true },
  ];

  for (const b of BASELINE) {
    test(`native parses baseline \`${b.label}\` with zero errors`, () => {
      const n = nativeParse(b.body);
      expect(n.errors).toEqual([]);
    });

    test(`native baseline \`${b.label}\` keeps fnKind="${b.fnKind}" + flags`, () => {
      const fd = findFunctionDecl(nativeParse(b.body).ast);
      expect(fd).not.toBeNull();
      expect(fd.fnKind).toBe(b.fnKind);
      expect(fd.isServer === true).toBe(b.isServer);
      expect(fd.isPure === true).toBe(b.isPure);
    });

    test(`native baseline \`${b.label}\` fnKind matches live oracle`, () => {
      const liveFd = findFunctionDecl(liveParse(b.body).ast);
      const nativeFd = findFunctionDecl(nativeParse(b.body).ast);
      expect(nativeFd && nativeFd.fnKind).toBe(liveFd && liveFd.fnKind);
    });
  }
});

// =============================================================================
// §33.6 DISTINCTNESS — `function` and `fn` produce DISTINCT fnKinds; the fix
// must NOT collapse the general `function` form into the `fn` shorthand.
// =============================================================================
describe("M6.7-D2 — fnKind distinctness (§33.6)", () => {
  test("`server function` is fnKind=function, `server fn` is fnKind=fn", () => {
    const fnForm = findFunctionDecl(nativeParse("server function a() { return 1 }").ast);
    const fnShort = findFunctionDecl(nativeParse("server fn b() { return 1 }").ast);
    expect(fnForm.fnKind).toBe("function");
    expect(fnShort.fnKind).toBe("fn");
    // Both carry the same isServer flag — the modifier semantics are shared.
    expect(fnForm.isServer).toBe(true);
    expect(fnShort.isServer).toBe(true);
  });
});
