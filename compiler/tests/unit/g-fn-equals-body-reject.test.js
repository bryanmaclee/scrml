// ---------------------------------------------------------------------------
// g-fn-shorthand-tail-match-emits-degenerate-body — E-FN-EQUALS-BODY parse reject
// (change-id g-fn-equals-body-reject-2026-08-04)
// ---------------------------------------------------------------------------
//
// RULING (PA lean A — the form is not sanctioned; sibling of E-FN-ARROW-BODY).
// `fn|function <name>(args) [-> T] = <expr>` — a `fn`/`function` declaration with
// an `=` EXPRESSION body — is NOT a sanctioned scrml form. §48.2's grammar admits
// exactly one body shape: a `{ … }` block (`fn-body ::= '{' fn-statement* '}'`).
// The two valid ways to write a one-expression function are the block body with
// an explicit return (`fn f(args) { return <expr> }`) or the implicit tail return
// (`fn f(args) { <expr> }` — a block body returns its tail expression).
//
// THE BUG. `fn pick(k: int) -> bool = match k { 1 :> true  _ :> false }` used to
// SILENTLY MISCOMPILE: the `->` return-type consumer greedily swallowed
// `bool = match k` into the annotation, then the match's `{` was misread as the
// function-body brace, so the match ARMS parsed as loose body statements — the arm
// TEST literals emitted as bare `1;` `2;`, the arm RESULTS dropped, the fn falling
// off the end returning `undefined`, with ZERO diagnostics (HIGH silent-wrong-
// output). The `= if …` variant instead reached invalid JS → E-CODEGEN-INVALID-
// LOGIC (a "compiler defect" framing that mis-attributes an author error). The fix
// recognises the shape at the PARSE layer (ast-builder.js — the return-type
// consumers break at a depth-0 bare `=`; the body-resolution points fire
// `rejectFnEqualsBody`) across all four decl sites (top-level + nested `fn` /
// `function`) and emits a clean E-FN-EQUALS-BODY that steers to the block form.

import { describe, test, expect } from "bun:test";
import { writeFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { compileScrml } from "../../src/api.js";

const TMP = mkdtempSync(join(tmpdir(), "fn-equals-reject-"));
let _seq = 0;
function compile(src) {
  const p = join(TMP, `t-${_seq++}.scrml`);
  writeFileSync(p, src);
  return compileScrml({ inputFiles: [p], write: false, outputDir: join(TMP, "out") });
}
function codes(r) {
  return (r.errors ?? []).map(e => e.code).filter(Boolean);
}
function msgOf(r, code) {
  return (r.errors ?? []).find(e => e.code === code)?.message ?? "";
}
// Nest a decl inside a `${}` logic block (the nested `fn`/`function` parse sites).
const NEST = (decl) =>
  "<program>\n${\n" + decl + "\n}\n<button onclick=go()>go</button>\n</program>";

describe("E-FN-EQUALS-BODY — the invalid `fn … = <expr>` expression body", () => {
  test("flagship: top-level `fn pick(k) -> bool = match k {…}` fires E-FN-EQUALS-BODY, NOT a silent degenerate emit", () => {
    const r = compile(
      "fn pick(k: int) -> bool = match k { 1 :> true  _ :> false }\n" +
      "<page><main><p>${ pick(1) }</p></main></page>\n",
    );
    // Pre-fix: codes was EMPTY (silent miscompile). Now it is a clean fatal error.
    expect(codes(r)).toContain("E-FN-EQUALS-BODY");
  });

  test("the `= if …` variant fires E-FN-EQUALS-BODY, NOT E-CODEGEN-INVALID-LOGIC", () => {
    const r = compile(
      "fn f(k: int) -> bool = if k == 1 { true } else { false }\n" +
      "<page><main><p>${ f(1) }</p></main></page>\n",
    );
    const c = codes(r);
    expect(c).toContain("E-FN-EQUALS-BODY");
    // The misleading "compiler defect" code must be gone.
    expect(c).not.toContain("E-CODEGEN-INVALID-LOGIC");
  });

  test("the steering message names the block form and the arrow sibling", () => {
    const r = compile("fn f(k: int) = k + 1\n<page><main><p>${ f(1) }</p></main></page>\n");
    const m = msgOf(r, "E-FN-EQUALS-BODY");
    expect(m).toContain("{ return <expr> }"); // the block-body steer
    expect(m).toContain("§48.2");             // the governing grammar
    expect(m).toContain("E-FN-ARROW-BODY");   // the sibling cross-ref
  });

  test("top-level `= expr` with NO return type fires (the `=` is at body position)", () => {
    const r = compile("fn f(k: int) = k + 1\n<page><main><p>${ f(1) }</p></main></page>\n");
    expect(codes(r)).toContain("E-FN-EQUALS-BODY");
  });

  test("top-level `function g(k) = expr` fires (the impure sibling site)", () => {
    const r = compile("function g(k: int) = k + 1\n<page><main><p>${ g(1) }</p></main></page>\n");
    expect(codes(r)).toContain("E-FN-EQUALS-BODY");
  });

  test("nested-in-logic `fn helper(x) = x + 1` fires (the nested `fn` site)", () => {
    const r = compile(NEST("fn helper(x: int) = x + 1\nlet y = helper(2)"));
    expect(codes(r)).toContain("E-FN-EQUALS-BODY");
  });

  test("nested-in-logic `function helper(x) = x + 1` fires (the nested `function` site)", () => {
    const r = compile(NEST("function helper(x: int) = x + 1\nlet y = helper(2)"));
    expect(codes(r)).toContain("E-FN-EQUALS-BODY");
  });

  test("`export fn f(k) = k + 1` fires (the export re-parse path — was SILENT pre-fix)", () => {
    const r = compile("export fn f(k: int) = k + 1\n<page><main><p>${ f(1) }</p></main></page>\n");
    expect(codes(r)).toContain("E-FN-EQUALS-BODY");
  });

  test("`export function g(k) = k + 1` fires (export re-parse, impure sibling)", () => {
    const r = compile("export function g(k: int) = k + 1\n<page><main><p>${ g(1) }</p></main></page>\n");
    expect(codes(r)).toContain("E-FN-EQUALS-BODY");
  });
});

describe("E-FN-EQUALS-BODY — no false-fire on valid block bodies / return types", () => {
  test("block body with explicit return compiles clean", () => {
    const r = compile("fn f(k: int) -> int { return k + 1 }\n<page><main><p>${ f(1) }</p></main></page>\n");
    expect(codes(r)).not.toContain("E-FN-EQUALS-BODY");
    expect(codes(r).filter(c => !String(c).startsWith("W-"))).toEqual([]);
  });

  test("implicit tail-return block body (`{ match … }`, no `return`) compiles clean", () => {
    const r = compile(
      "fn f(k: int) -> bool { match k { 1 :> true  _ :> false } }\n" +
      "<page><main><p>${ f(1) }</p></main></page>\n",
    );
    expect(codes(r)).not.toContain("E-FN-EQUALS-BODY");
    expect(codes(r).filter(c => !String(c).startsWith("W-"))).toEqual([]);
  });

  test("inline-struct return type `-> { a: int }` (an in-type `{`) does NOT false-fire", () => {
    const r = compile(
      "fn mk(k: int) -> { a: int, b: int } { return { a: k, b: k } }\n" +
      "<page><main><p>${ mk(1).a }</p></main></page>\n",
    );
    expect(codes(r)).not.toContain("E-FN-EQUALS-BODY");
    expect(codes(r).filter(c => !String(c).startsWith("W-"))).toEqual([]);
  });

  test("refinement return type `-> number(>0)` does NOT false-fire", () => {
    const r = compile("fn mk(k: int) -> number(>0) { return k }\n<page><main><p>${ mk(1) }</p></main></page>\n");
    expect(codes(r)).not.toContain("E-FN-EQUALS-BODY");
  });

  test("union return type `-> int | string` does NOT false-fire", () => {
    const r = compile("fn mk(k: int) -> int | string { return k }\n<page><main><p>${ mk(1) }</p></main></page>\n");
    expect(codes(r)).not.toContain("E-FN-EQUALS-BODY");
  });

  test("`==` equality in a body does NOT false-fire (bare `=` PUNCT only)", () => {
    const r = compile("fn f(k: int) -> bool { return k == 1 }\n<page><main><p>${ f(1) }</p></main></page>\n");
    expect(codes(r)).not.toContain("E-FN-EQUALS-BODY");
  });

  // Regression guard for the S319 adversarial-review finding: a routed server endpoint
  // that carries BOTH a return type AND `route=`/`method=` attributes must NOT false-fire.
  // Pre-fix the return-type consumer swallowed the `route` IDENT and broke at its `=`, so
  // the attribute loop was skipped and the body-reject misfired on a valid `{ … }` block.
  test("`server function … -> T route= method= { block }` compiles clean (no false-fire)", () => {
    const r = compile(
      'server function apiUser() -> string route="/api/user" method="GET" { return "x" }\n' +
      "<page><main><p>hi</p></main></page>\n",
    );
    expect(codes(r)).not.toContain("E-FN-EQUALS-BODY");
    expect(codes(r).filter(c => !String(c).startsWith("W-"))).toEqual([]);
  });

  test("`function … -> T route= { block }` compiles clean (no false-fire)", () => {
    const r = compile(
      'function getData() -> string route="/api/data" { return "y" }\n' +
      "<page><main><p>hi</p></main></page>\n",
    );
    expect(codes(r)).not.toContain("E-FN-EQUALS-BODY");
    expect(codes(r).filter(c => !String(c).startsWith("W-"))).toEqual([]);
  });
});
