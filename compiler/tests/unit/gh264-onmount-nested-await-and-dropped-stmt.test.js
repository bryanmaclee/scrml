/**
 * gh264-onmount-nested-await-and-dropped-stmt.test.js — GH #264.
 *
 * `88f9745e` (GH #237) gave `on mount { … }` the §13.2 async scope and awaited a
 * server-fn result at a whole-statement / whole-RHS position. GH #264 is the same
 * §13.2 violation in the positions that fix did not cover:
 *
 *   Defect 1 (fail-OPEN) — a server call in a NON-top position (function
 *     ARGUMENT, `if`/`while` CONDITION, template INTERPOLATION) was left bare,
 *     binding a pending Promise. `injectServerCallAwaitsViaAst` injects `await`
 *     position-invariantly; the whole mount body already runs in an async IIFE.
 *
 *   Defect 2 (silent statement DROP) — a multi-statement mount body whose first
 *     statement is a complete expression yielded a truncated single-expression
 *     `exprNode`, and emit-logic's fast-path emitted ONLY statement 1. The
 *     desugar now drops the exprNode for a multi-statement body
 *     (`mountBodyExprNode`) so the string path lowers ALL statements.
 *
 * The additive scanner's invariants: nested server calls are awaited; a DIRECT
 * reactive-set stub value is left to emit-client's own IIFE lift; a member call,
 * an already-awaited call, and a call inside a sync arrow / `function` are never
 * touched; a body with no nested server call is byte-identical.
 */

import { describe, test, expect } from "bun:test";
import {
  liftEmittedStatementAwaits,
  injectServerCallAwaitsViaAst,
} from "../../src/codegen/scheduling.ts";
import { mountBodyExprNode, safeParseExprToNodeGlobal } from "../../src/ast-builder.js";

const routeMap = {
  functions: new Map([
    ["n1", { boundary: "server", functionName: "tag" }],
    ["n2", { boundary: "server", functionName: "loadMe" }],
    ["n3", { boundary: "client", functionName: "eq" }],
  ]),
};

// The server-fn name set (what injectServerCallAwaitsViaAst consumes).
const serverFnNames = new Set(["tag", "loadMe"]);

describe("injectServerCallAwaitsViaAst — GH #264 Defect 1 (position-invariant await)", () => {
  test("awaits a server call in ARGUMENT position (Case A)", () => {
    expect(injectServerCallAwaitsViaAst(`_scrml_reactive_set("msg", eq("x", tag()));`, serverFnNames))
      .toBe(`_scrml_reactive_set("msg", eq("x", await tag()));`);
  });

  test("awaits a server call in an `if` CONDITION (Case C — the real-app redirect)", () => {
    const src = `if (!checkRole(u, tag())) {\n  redirect("/");\n}`;
    expect(injectServerCallAwaitsViaAst(src, serverFnNames))
      .toBe(`if (!checkRole(u, await tag())) {\n  redirect("/");\n}`);
  });

  test("awaits a server call in a template INTERPOLATION (Case D — the cookie)", () => {
    expect(injectServerCallAwaitsViaAst("_scrml_reactive_set(\"c\", `Max-Age=${tag()}`);", serverFnNames))
      .toBe("_scrml_reactive_set(\"c\", `Max-Age=${await tag()}`);");
  });

  test("does NOT double-await the DIRECT reactive-set stub value (emit-client owns it)", () => {
    const src = `_scrml_reactive_set("you", tag());`;
    expect(injectServerCallAwaitsViaAst(src, serverFnNames)).toBe(src);
    const src2 = `_scrml_cs_reactive_set("you", loadMe(1));`;
    expect(injectServerCallAwaitsViaAst(src2, serverFnNames)).toBe(src2);
  });

  test("skips a MEMBER call `obj.tag()` — the route name binds a free identifier", () => {
    const src = `_scrml_reactive_set("msg", obj.tag());`;
    expect(injectServerCallAwaitsViaAst(src, serverFnNames)).toBe(src);
  });

  test("skips an ALREADY-awaited call", () => {
    const src = `_scrml_reactive_set("msg", eq("x", await tag()));`;
    expect(injectServerCallAwaitsViaAst(src, serverFnNames)).toBe(src);
  });

  test("never injects `await` inside a SYNC arrow / function (the fail-closed surface)", () => {
    const arrow = `_scrml_reactive_set("m", ["a"].map(x => tag()).join(""));`;
    expect(injectServerCallAwaitsViaAst(arrow, serverFnNames)).toBe(arrow);
    const fn = `_scrml_reactive_set("m", (function () { return tag(); })());`;
    expect(injectServerCallAwaitsViaAst(fn, serverFnNames)).toBe(fn);
  });

  test("does NOT touch a server name inside a string / comment", () => {
    const str = `_scrml_reactive_set("msg", "tag() is not a call");`;
    expect(injectServerCallAwaitsViaAst(str, serverFnNames)).toBe(str);
    const cmt = `_scrml_reactive_set("msg", eq("x", y)); // tag() in a comment`;
    expect(injectServerCallAwaitsViaAst(cmt, serverFnNames)).toBe(cmt);
  });

  test("a body with no nested server call is byte-identical", () => {
    const src = `_scrml_reactive_set("msg", eq("x", "y"));\nconst n = 1;`;
    expect(injectServerCallAwaitsViaAst(src, serverFnNames)).toBe(src);
  });

  test("awaits MULTIPLE nested server calls in one expression", () => {
    expect(injectServerCallAwaitsViaAst(`_scrml_reactive_set("m", eq(tag(), loadMe(1)));`, serverFnNames))
      .toBe(`_scrml_reactive_set("m", eq(await tag(), await loadMe(1)));`);
  });

  test("no-op when the routeMap has no server fns", () => {
    const src = `_scrml_reactive_set("msg", eq("x", tag()));`;
    expect(injectServerCallAwaitsViaAst(src, new Set())).toBe(src);
  });

  // --- adversarial-pass regressions (S239 round 1) ---

  test("BLOCKER-1: does NOT inject inside a REGEX literal", () => {
    const src = `_scrml_reactive_set("m", "a".replace(/tag(1)/, "z"));`;
    expect(injectServerCallAwaitsViaAst(src, serverFnNames)).toBe(src);
    const src2 = `_scrml_reactive_set("m", "a".replace(/loadMe(9)/g, "z"));`;
    expect(injectServerCallAwaitsViaAst(src2, serverFnNames)).toBe(src2);
  });

  test("still divides correctly (a `/` after a value is NOT a regex)", () => {
    // `tag(` here is a genuine nested call after a division — must be awaited.
    const src = `_scrml_reactive_set("m", (a / b) + eq(1, tag()));`;
    expect(injectServerCallAwaitsViaAst(src, serverFnNames)).toBe(`_scrml_reactive_set("m", (a / b) + eq(1, await tag()));`);
  });

  test("BLOCKER-2: a top-level (expr-bodied) arrow does NOT suppress a LATER statement's nested call", () => {
    const src = `win.onresize = () => 1;\nif (!eq("a", tag())) { m(); }`;
    expect(injectServerCallAwaitsViaAst(src, serverFnNames))
      .toBe(`win.onresize = () => 1;\nif (!eq("a", await tag())) { m(); }`);
  });

  test("BLOCKER-2 (newline-separated, no semicolon): arrow suppression ends at the statement boundary", () => {
    const src = `win.onresize = () => 1\nif (!eq("a", tag())) { m(); }`;
    expect(injectServerCallAwaitsViaAst(src, serverFnNames))
      .toBe(`win.onresize = () => 1\nif (!eq("a", await tag())) { m(); }`);
  });

  test("an expr-arrow ARGUMENT does not suppress a sibling server-call argument", () => {
    // `f(x => x, tag())` — the arrow body is `x`; `tag()` after the comma is awaited.
    const src = `_scrml_reactive_set("m", f(x => x, tag()));`;
    expect(injectServerCallAwaitsViaAst(src, serverFnNames))
      .toBe(`_scrml_reactive_set("m", f(x => x, await tag()));`);
  });

  test("a server call inside a BRACED sync arrow body stays suppressed (illegal await avoided)", () => {
    const src = `_scrml_reactive_set("m", run(() => { return tag(); }));`;
    expect(injectServerCallAwaitsViaAst(src, serverFnNames)).toBe(src);
  });

  test("finding-4: an ASYNC arrow body IS awaited (await is legal + §13.2-required there)", () => {
    const src = `_scrml_reactive_set("m", run(async () => { return tag(); }));`;
    expect(injectServerCallAwaitsViaAst(src, serverFnNames))
      .toBe(`_scrml_reactive_set("m", run(async () => { return await tag(); }));`);
  });

  // --- adversarial-pass regressions (S239 round 2) ---

  test("R2-1: a `function` with a DESTRUCTURED/defaulted param brace still suppresses its BODY", () => {
    // The param `{a}` must not consume the body's brace-suppression.
    const destructured = `function h({a}) { let z = eq("x", tag()); }\nh();`;
    expect(injectServerCallAwaitsViaAst(destructured, serverFnNames)).toBe(destructured);
    const defaulted = `function h(a = {}) { let z = eq("x", tag()); }\nh();`;
    expect(injectServerCallAwaitsViaAst(defaulted, serverFnNames)).toBe(defaulted);
    // control: a plain-param function is still suppressed too.
    const plain = `function h(a) { let z = eq("x", tag()); }\nh();`;
    expect(injectServerCallAwaitsViaAst(plain, serverFnNames)).toBe(plain);
  });

  test("R2-2: a top-level expr-arrow whose BODY is on the next line stays suppressed (no illegal await)", () => {
    const src = `let f = (x) =>\n  eq("x", tag())\nf(1);`;
    // `tag()` is inside the sync arrow body → must NOT be awaited.
    expect(injectServerCallAwaitsViaAst(src, serverFnNames)).toBe(src);
  });

  test("R2-2b: after the multi-line arrow body ends, a LATER nested call IS awaited", () => {
    const src = `let f = (x) =>\n  x + 1\nif (!eq("a", tag())) { m(); }`;
    expect(injectServerCallAwaitsViaAst(src, serverFnNames))
      .toBe(`let f = (x) =>\n  x + 1\nif (!eq("a", await tag())) { m(); }`);
  });

  test("a method chain across a newline does NOT prematurely end the arrow body (`.` continues)", () => {
    const src = `run(x => foo()\n  .bar(tag()));`;
    // `tag()` is still inside the sync arrow (the chain continues) → not awaited.
    expect(injectServerCallAwaitsViaAst(src, serverFnNames)).toBe(src);
  });

  // --- adversarial-pass regressions (S239 round 3) — operator-first continuation lines ---

  test("R3: a continuation line starting with `!=` / `!==` keeps the sync-arrow body suppressed", () => {
    const neq = `let f = v => v\n!= tag()\nf(0);`;
    expect(injectServerCallAwaitsViaAst(neq, serverFnNames)).toBe(neq);
    const strictNeq = `let f = v => v\n!== tag()\nf(0);`;
    expect(injectServerCallAwaitsViaAst(strictNeq, serverFnNames)).toBe(strictNeq);
  });

  test("R3: continuation lines starting with word-operators `instanceof` / `in` keep suppression", () => {
    const inst = `let f = v => v\ninstanceof tag()\nf(0);`;
    expect(injectServerCallAwaitsViaAst(inst, serverFnNames)).toBe(inst);
    const isin = `let f = v => 'k'\nin tag()\nf(0);`;
    expect(injectServerCallAwaitsViaAst(isin, serverFnNames)).toBe(isin);
  });

  test("R3: a bare `!` (prefix) on the next line DOES end the arrow — a later nested call is awaited", () => {
    // `v => v` ends; `!eq(...)` is a new statement, so `tag()` there is awaited.
    const src = `let f = v => v\n!eq("a", tag()) && m();`;
    expect(injectServerCallAwaitsViaAst(src, serverFnNames))
      .toBe(`let f = v => v\n!eq("a", await tag()) && m();`);
  });

  // --- adversarial-pass regressions (S239 round 4) — parameter-default positions ---

  test("R4: a server call in a `function` PARAMETER DEFAULT is NOT awaited (await illegal in params)", () => {
    const fn = `function h(x = tag()) { return x; }\nh();`;
    expect(injectServerCallAwaitsViaAst(fn, serverFnNames)).toBe(fn);
    const nested = `function h(a, b = eq("x", tag())) { return b; }\nh();`;
    expect(injectServerCallAwaitsViaAst(nested, serverFnNames)).toBe(nested);
    const generator = `function* g(a = tag()) { yield a; }`;
    expect(injectServerCallAwaitsViaAst(generator, serverFnNames)).toBe(generator);
  });

  test("R4: a server call in an ARROW parameter default is NOT awaited", () => {
    const arrow = `let h = (x = tag()) => x;\nh();`;
    expect(injectServerCallAwaitsViaAst(arrow, serverFnNames)).toBe(arrow);
    // async arrow params ALSO forbid await.
    const asyncArrow = `let h = async (x = tag()) => x;\nh();`;
    expect(injectServerCallAwaitsViaAst(asyncArrow, serverFnNames)).toBe(asyncArrow);
  });

  test("R4 boundary: a call ARGUMENT (not a param default) is still awaited", () => {
    // `h(...)` here is a CALL, not a definition — its args are awaited as normal.
    const call = `_scrml_reactive_set("m", h(tag()));`;
    expect(injectServerCallAwaitsViaAst(call, serverFnNames))
      .toBe(`_scrml_reactive_set("m", h(await tag()));`);
  });

  // --- adversarial-pass regressions (S239 round 6 — acorn approach) ---

  test("R6: a CLASS FIELD initializer is a sync init context — NOT awaited", () => {
    const field = `class C { x = tag() }`;
    expect(injectServerCallAwaitsViaAst(field, serverFnNames)).toBe(field);
  });

  test("R6: a `static { … }` block is a sync init context — NOT awaited", () => {
    const stat = `class C { static { tag() } }`;
    expect(injectServerCallAwaitsViaAst(stat, serverFnNames)).toBe(stat);
  });

  test("R6: object/class method + getter bodies are NOT awaited", () => {
    const method = `let o = { greet(a) { return eq(a, tag()) } };`;
    expect(injectServerCallAwaitsViaAst(method, serverFnNames)).toBe(method);
    const getter = `let o = { get v() { return eq(1, tag()) } };`;
    expect(injectServerCallAwaitsViaAst(getter, serverFnNames)).toBe(getter);
    const clazz = `class C { m(a) { return eq(a, tag()) } }`;
    expect(injectServerCallAwaitsViaAst(clazz, serverFnNames)).toBe(clazz);
  });

  test("R6: a COMPUTED key IS awaited (evaluated in the enclosing async scope)", () => {
    expect(injectServerCallAwaitsViaAst(`let o = { [tag()]: 1 };`, serverFnNames))
      .toBe(`let o = { [await tag()]: 1 };`);
  });

  test("R6: acorn parse failure returns null (the caller falls back to the #237 text pass)", () => {
    expect(injectServerCallAwaitsViaAst(`let x = (((`, serverFnNames)).toBeNull();
  });

  test("R6: liftEmittedStatementAwaits is lossless on an unparseable body (fallback, no corruption)", () => {
    // No server call → both the AST path (null) and the text fallback leave it be.
    const malformed = `let x = (((`;
    expect(liftEmittedStatementAwaits(malformed, routeMap, "f.scrml")).toBe(malformed);
  });
});

describe("liftEmittedStatementAwaits — GH #264 composes with the GH #237 pass", () => {
  test("Case B shape: direct stub stays for emit-client, nested arg gets awaited", () => {
    // statement 1 is the direct reactive-server write (left to emit-client's IIFE),
    // statement 2 carries a nested server call that MUST be awaited here.
    const src = `_scrml_reactive_set("n", loadMe(1));\n_scrml_reactive_set("msg", eq("x", tag()));`;
    const out = liftEmittedStatementAwaits(src, routeMap, "f.scrml");
    expect(out).toContain(`_scrml_reactive_set("n", loadMe(1));`); // untouched — emit-client owns it
    expect(out).toContain(`_scrml_reactive_set("msg", eq("x", await tag()));`);
  });

  test("still awaits the GH #237 whole-RHS shapes (no regression)", () => {
    expect(liftEmittedStatementAwaits("const u = loadMe(1);", routeMap, "f.scrml"))
      .toBe("const u = await loadMe(1);");
  });
});

describe("mountBodyExprNode — GH #264 Defect 2 (multi-statement drop)", () => {
  const parse = (body) => safeParseExprToNodeGlobal(body, "m.scrml", 0, []);

  test("keeps the exprNode for a SINGLE-expression body", () => {
    const node = mountBodyExprNode(`@msg = eq("x", tag())`, parse);
    expect(node).toBeTruthy();
    expect(node.kind).toBe("assign");
  });

  test("DROPS the exprNode for a MULTI-statement body (forces the string path)", () => {
    const node = mountBodyExprNode(`@n = serverRead()\n@msg = eq("x", tag())`, parse);
    expect(node).toBeUndefined();
  });

  test("keeps a bare single call", () => {
    expect(mountBodyExprNode(`boot()`, parse)).toBeTruthy();
  });
});
