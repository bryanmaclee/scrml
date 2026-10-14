/**
 * S465 r4 — `firstCallInText` (brace-pair.ts): the question every server text-lowering
 * site asks (server-text-guard.ts). A call in server text lowered from text runs
 * un-awaited, so a missed call is a fail-OPEN; a false call is only a refusal.
 * Also `splitTemplateLiteral` (the tagged-template lowering) and
 * `bareBlockSequenceTexts` (same-line `{ A } { B }`).
 */
import { describe, test, expect } from "bun:test";
import { firstCallInText, splitTemplateLiteral } from "../../src/brace-pair.ts";
import { bareBlockSequenceTexts } from "../../src/validators/defer-structure.ts";

const CALLS = [
  ["check(pass, row.pw)", "check"],
  ["!check ( pass , row . pw )", "check"],
  ["a.b.c(1)", "a.b.c"],
  ["xs[0](1)", "xs[0]"],
  ["(f)(x)", null],
  ["tag`x`", "tag"],
  ["`a${f(1)}b`", "f"],
  ["String.raw`${check(p)}`", "String.raw"],
  ["`a ${ `b ${g(1)}` }`", "g"],
  ["f?.(x)", "f"],
  ["Shape.Circle(1)", "Shape.Circle"],
  ["x.if(1)", "x.if"],
  ["{ i = 1 } { if (check(pass, row.pw)) { return 1 } }", "check"],
  ["arr.map(x => x)", "arr.map"],
  ["@items.filter(ok)", "@items.filter"],
  ["x => { return o . m ( x ) }", "o.m"],
  ["await f(x).g()", "f"],
  ["await f(g(x))", "g"],
  ["await a.b(c)[0]", "a.b"],
  ["?{`SELECT 1 WHERE a = ${g(x)}`}.get()", "g"],
  ["?{`SELECT 1`}.get() && f(x)", "f"],
];

const NOT_CALLS = [
  "`a${x}b`",
  "if (a) { b = 1 }",
  "for (const q of xs) { i = 1 }",
  "while (i < 3) { i = i + 1 }",
  ".Found(name: \"c\")",
  "x = .Found(1)",
  "new Date()",
  "function (q) { return q }",
  "function g(q) { return q }",
  "\"f(x)\" + 'g(y)'",
  "a / b / c",
  "x = /a(b)/.source",
  "a?.b",
  "// f(x)\n y",
  "/* f(x) */ y",
  "return (a)",
  "typeof (a)",
  "{ a = 1 } { b = 2 }",
  "a ? (b) : c",
  "(x) => x + 1",
  // already awaited: the call ends its chain under `await`
  "(await _scrml_batch_read_15(it.id))",
  "await f(x)",
  "const v = await row.load(1, \"a)\")",
  // a `?{ }` query's driver chain and its SQL text are the SQL lowering's
  "?{ SELECT 7; select 8 }.acrossTenants()",
  "?{`SELECT count(*) FROM t WHERE a = ${x}`}.get()",
  "?{ SELECT count(*) FROM t }.all()",
];

describe("firstCallInText", () => {
  for (const [text, callee] of CALLS) {
    test(`call: ${JSON.stringify(text)}`, () => {
      const got = firstCallInText(text);
      expect(got).not.toBeNull();
      if (callee !== null) expect(got).toBe(callee);
    });
  }
  for (const text of NOT_CALLS) {
    test(`no call: ${JSON.stringify(text)}`, () => {
      expect(firstCallInText(text)).toBeNull();
    });
  }
});

describe("splitTemplateLiteral", () => {
  test("parts and substitutions, nested braces and templates", () => {
    const t = "tag`a${ f({ x: 1 }) }b${ `c${d}` }e`";
    const r = splitTemplateLiteral(t, t.indexOf("`"));
    expect(r).not.toBeNull();
    expect(r.quasis).toEqual(["a", "b", "e"]);
    expect(r.subs.map((s) => s.trim())).toEqual(["f({ x: 1 })", "`c${d}`"]);
    expect(r.end).toBe(t.length - 1);
  });
  test("unterminated → null", () => {
    expect(splitTemplateLiteral("`a${b", 0)).toBeNull();
  });
});

describe("bareBlockSequenceTexts", () => {
  const hatch = (expr) => ({ kind: "bare-expr", expr, exprNode: { kind: "escape-hatch", nativeKind: "ParseError", raw: expr } });
  test("two and three blocks on one line", () => {
    expect(bareBlockSequenceTexts(hatch("{ a = 1 } { b = 2 }"))).toEqual(["{ a = 1 }", "{ b = 2 }"]);
    expect(bareBlockSequenceTexts(hatch("{ a } ; { b } { c }"))).toEqual(["{ a }", "{ b }", "{ c }"]);
  });
  test("a block holding a string with a brace", () => {
    expect(bareBlockSequenceTexts(hatch("{ s = \"}\" } { t = 1 }"))).toEqual(["{ s = \"}\" }", "{ t = 1 }"]);
  });
  test("one block, trailing code, or a parsed expression → null", () => {
    expect(bareBlockSequenceTexts(hatch("{ a = 1 }"))).toBeNull();
    expect(bareBlockSequenceTexts(hatch("{ a } x"))).toBeNull();
    expect(bareBlockSequenceTexts({ kind: "bare-expr", expr: "{ a } { b }", exprNode: { kind: "object" } })).toBeNull();
  });
});
