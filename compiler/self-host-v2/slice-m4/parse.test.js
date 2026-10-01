// parse.test.js — the syntax slice M4 added to the bootstrap parser, by the
// FileAst it produces (the parser's own AST — not an impl#1-parity oracle):
//   - §4.14 `:`-shorthand bodies: on an element (its one child), on a
//     state-child (its body, O5 (1i)); `/>` after one is E-CLOSER-001, one on a
//     void element E-COLON-SHORTHAND-ON-VOID, one on a declaration opener
//     E-PARSE-SHORTHAND;
//   - a state-child's bare body `<Idle rule=.X>…</>`;
//   - `...e` in an array literal, `a[i]`, `x => e` / `(a, b) => e`;
//   - a validator in an opener is reported (⚑ O25), never kept.

import { describe, test, expect, beforeAll } from "bun:test";
import { loadM2 } from "./harness.js";

let mods;
beforeAll(() => { ({ mods } = loadM2()); }, { timeout: 120000 });

const parse = (src) => mods.parse.parseFile("t.scrml", src, 0);
const codes = (src) => parse(src).diags.map((d) => d.code);

// The first node (depth-first) matching `pred`.
function find(x, pred) {
  if (Array.isArray(x)) { for (const y of x) { const r = find(y, pred); if (r) return r; } return null; }
  if (!x || typeof x !== "object") return null;
  if (pred(x)) return x;
  for (const v of Object.values(x)) { const r = find(v, pred); if (r) return r; }
  return null;
}
const exprOf = (src) => {
  const ast = parse(`\${ function f() { const v = ${src} } }`).ast;
  return find(ast, (n) => n.k && n.k.variant === "Local").k.data.init;
};

describe("§4.14 `:`-shorthand bodies", () => {
  test("on an element: the expression is its one child (an Interp)", () => {
    const r = parse(`<program><main><span : "hi"></main></program>`);
    expect(r.diags).toEqual([]);
    const span = find(r.ast, (n) => n.tag === "span");
    expect(span.kids.length).toBe(1);
    expect(span.kids[0].k.variant).toBe("Interp");
    expect(span.kids[0].k.data.e.k).toEqual({ variant: "Str", data: { v: "hi" } });
  });

  test("the `:` needs whitespace before it; none after is fine (§4.14, S160)", () => {
    const r = parse(`<program><main><span :@x></main></program>`);
    const span = find(r.ast, (n) => n.tag === "span");
    expect(span.kids[0].k.data.e.k.variant).toBe("At");
  });

  test("on a state-child: its body (O5 (1i))", () => {
    const r = parse(`<program>\n  type P:enum = { A, B }\n  <p:P=.A single>\n    <A rule=.B : "first">\n    <B rule=.A/>\n  </>\n</program>`);
    expect(r.diags).toEqual([]);
    const sc = find(r.ast, (n) => n.name === "A" && Array.isArray(n.body));
    expect(sc.body.length).toBe(1);
    expect(sc.body[0].k.data.e.k).toEqual({ variant: "Str", data: { v: "first" } });
    const sb = find(r.ast, (n) => n.name === "B" && Array.isArray(n.body));
    expect(sb.body).toEqual([]);
  });

  test("a state-child's BARE body is its markup children", () => {
    const r = parse(`<program>\n  type P:enum = { A, B }\n  <p:P=.A>\n    <A rule=.B><b>bold</b></>\n    <B rule=.A/>\n  </>\n</program>`);
    expect(r.diags).toEqual([]);
    const sc = find(r.ast, (n) => n.name === "A" && Array.isArray(n.body));
    expect(sc.body.map((n) => n.k.variant)).toEqual(["Elem"]);
    expect(sc.body[0].k.data.e.tag).toBe("b");
  });

  test("a closer after a `:`-shorthand body is E-CLOSER-001", () => {
    expect(codes(`<program><main><span : "hi"/></main></program>`)).toEqual(["E-CLOSER-001"]);
  });

  test("a `:`-shorthand body on a void element is E-COLON-SHORTHAND-ON-VOID", () => {
    expect(codes(`<program><main><input : "hi"></main></program>`)).toEqual(["E-COLON-SHORTHAND-ON-VOID"]);
  });

  test("a declaration opener has no `:`-shorthand body (E-PARSE-SHORTHAND)", () => {
    expect(codes(`<program><let n:int=0 : "hi"></program>`)).toEqual(["E-PARSE-SHORTHAND"]);
  });
});

describe("expressions: spread elements, index, arrow functions", () => {
  test("`[...@a, 1]` — the first element is a Spread of `@a`", () => {
    const e = exprOf("[...@a, 1]");
    expect(e.k.variant).toBe("ArrayLit");
    expect(e.k.data.elems.map((x) => x.k.variant)).toEqual(["Spread", "Num"]);
    expect(e.k.data.elems[0].k.data.e.k).toEqual({ variant: "At", data: { name: "a" } });
  });

  test("`[1, ...xs]` — a trailing Spread of a local", () => {
    const e = exprOf("[1, ...xs]");
    expect(e.k.data.elems.map((x) => x.k.variant)).toEqual(["Num", "Spread"]);
    expect(e.k.data.elems[1].k.data.e.k).toEqual({ variant: "Name", data: { name: "xs" } });
  });

  test("`@a[0].f` — a Member of an Index; a spaced `[` is not an index", () => {
    const e = exprOf("@a[0].f");
    expect(e.k.variant).toBe("Member");
    expect(e.k.data.obj.k.variant).toBe("Index");
    expect(e.k.data.obj.k.data.idx.k).toEqual({ variant: "Num", data: { raw: "0" } });
  });

  test("`e => e.n != 1` and `(a, b) => a` are Lambdas with their parameters and body", () => {
    const one = exprOf("e => e.n != 1");
    expect(one.k.variant).toBe("Lambda");
    expect(one.k.data.params).toEqual(["e"]);
    expect(one.k.data.body.k.variant).toBe("Binary");
    const two = exprOf("(a, b) => a");
    expect(two.k.data.params).toEqual(["a", "b"]);
    expect(two.k.data.body.k).toEqual({ variant: "Name", data: { name: "a" } });
  });

  test("a parenthesized expression is still not a lambda", () => {
    expect(exprOf("(a + 1)").k.variant).toBe("Binary");
  });

  test("an arrow function with a braced body is reported, not guessed", () => {
    expect(codes("${ function f() { const v = x => { return 1 } } }")).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
  });
});

describe("validators in an opener (s444 Phase B: parsed — O25 RULED S442 as dpa-058)", () => {
  test("`req` and `length(>=5)` parse into the declaration's validators, in source order, with no diagnostic", () => {
    const r = parse(`<program><let email:string="" req length(>=5) pattern(/^a+$/i) min(-2) eq(@x, 1)/></program>`);
    expect(r.diags).toEqual([]);
    const d = find(r.ast, (n) => n.name === "email" && "own" in n);
    expect(d.mods).toEqual([]);
    expect(d.validators.map((v) => [v.name, typeof v.arg === "string" ? v.arg : v.arg.variant])).toEqual([
      ["req", "NoArgs"], ["length", "Cmp"], ["pattern", "Regex"], ["min", "Exprs"], ["eq", "Exprs"],
    ]);
    expect(d.validators[1].arg.data.op).toBe(">=");
    expect(d.validators[2].arg.data).toEqual({ source: "^a+$", flags: "i" });
    expect(d.validators[4].arg.data.es.length).toBe(2);
  });
});
