// s462-stmt-match-leave — dpa-068's pole-independent match-arm defects.
//
// The runtime halves (the function really leaves, the loop really continues /
// breaks, the `fail` really propagates) live in conformance/cases/match-leave/.
// These pin the structural facts those cases rest on.
import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { emitMatchStmt } from "../../src/codegen/emit-control-flow.ts";
import { messageArmBodyHasOwnReturn } from "../../src/symbol-table.ts";

function parse(src) {
  const { ast, errors } = buildAST(splitBlocks("t.scrml", src));
  return { ast, errors: errors ?? [] };
}

function findMatch(ast) {
  let found = null;
  const seen = new Set();
  const walk = (n) => {
    if (found || !n || typeof n !== "object" || seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (n.kind === "match-stmt") { found = n; return; }
    for (const [k, v] of Object.entries(n)) if (k !== "span") walk(v);
  };
  walk(ast);
  return found;
}

const wrap = (body) => `\${\n    type K:enum = { A, B, C }\n    function f(k: K) {\n${body}\n    }\n}\n`;

describe("D2/D3 — a statement-position match lowers inline", () => {
  test("no IIFE: an arm's `return` is the enclosing function's", () => {
    const { ast } = parse(wrap(`        match k {\n            .A :> { return }\n            .B :> { log(1) }\n            .C :> log(2)\n        }`));
    const m = findMatch(ast);
    expect(m).not.toBeNull();
    const js = emitMatchStmt(m, {});
    expect(js).not.toContain("function()");
    expect(js).toMatch(/if \(.*\) \{\n\s+return;\n\}/);
  });

  test("`{ continue }` / `{ break }` arms are emitted as the loop's own statements", () => {
    const { ast } = parse(wrap(`        for (const x of [k]) {\n            match x {\n                .A :> { continue }\n                .B :> { break }\n                .C :> log(1)\n            }\n        }`));
    const js = emitMatchStmt(findMatch(ast), {});
    expect(js).toContain("continue;");
    expect(js).toContain("break;");
    expect(js).not.toContain("function()");
  });
});

describe("D8 — a single-expression arm body ends at its line break", () => {
  test("`.A :> return⏎ \"orphan\"` does not join; the orphan line is E-PARSE-001", () => {
    const { ast, errors } = parse(wrap(`        match k {\n            .A :> return\n                "orphan"\n            .B :> log(1)\n            .C :> log(2)\n        }`));
    const m = findMatch(ast);
    const armA = m.body.find((c) => c.kind === "match-arm-inline" && c.test === ".A");
    expect(armA.result).toBe("return");
    expect(errors.map((e) => e.code)).toContain("E-PARSE-001");
  });

  test("a line ending in a rule-2 continuation token continues the arm", () => {
    const { ast, errors } = parse(wrap(`        match k {\n            .A :> "a:" +\n                k\n            .B :> log(1)\n            .C :> log(2)\n        }`));
    const armA = findMatch(ast).body.find((c) => c.kind === "match-arm-inline" && c.test === ".A");
    expect(armA.result.replace(/\s+/g, "")).toBe('"a:"+k');
    expect(errors.map((e) => e.code)).not.toContain("E-PARSE-001");
  });
});

describe("D4 — a propagation `expr?` arm body", () => {
  test("the parser stamps the operand", () => {
    const { ast } = parse(wrap(`        match k {\n            .A :> g(1)?\n            .B :> log(1)\n            .C :> log(2)\n        }`));
    const armA = findMatch(ast).body.find((c) => c.kind === "match-arm-inline" && c.test === ".A");
    expect(armA.propagateOperand.replace(/\s+/g, "")).toBe("g(1)");
  });

  test("a statement-position arm lowers it to an error check that returns", () => {
    const { ast } = parse(wrap(`        match k {\n            .A :> g(1)?\n            .B :> log(1)\n            .C :> log(2)\n        }`));
    const js = emitMatchStmt(findMatch(ast), {});
    expect(js).toMatch(/if \((\w+) && \1\.__scrml_error\) return \1;/);
    expect(js).not.toMatch(/\?\s*;/);
  });
});

describe("D10 — a `return` in an engine message arm", () => {
  test("bare and braced `return` are found; nested-function and string ones are not", () => {
    expect(messageArmBodyHasOwnReturn("return", false)).toBe(true);
    expect(messageArmBodyHasOwnReturn("{ return }", true)).toBe(true);
    expect(messageArmBodyHasOwnReturn("{ log(1); return }", true)).toBe(true);
    expect(messageArmBodyHasOwnReturn(".Idle", false)).toBe(false);
    expect(messageArmBodyHasOwnReturn('{ log("return"); .Idle }', true)).toBe(false);
    expect(messageArmBodyHasOwnReturn("{ const f = () => { return 1 }; .Idle }", true)).toBe(false);
    expect(messageArmBodyHasOwnReturn("{ function g() { return 1 } .Idle }", true)).toBe(false);
  });
});

describe("given arm in a match (g-impl1-given-match-arm-body-dropped-s462)", () => {
  test("a brace-less `given x :> expr` arm keeps its expression as its body", () => {
    const { ast, errors } = parse(`\${\n    function f(v: number | not) -> string {\n        match v {\n            not :> log(1)\n            given v :> log(v)\n        }\n        return "x"\n    }\n}\n`);
    const m = findMatch(ast);
    const g = m.body.find((c) => c.kind === "given-guard");
    expect(g.armResult.replace(/\s+/g, "")).toBe("log(v)");
    expect(m.body.some((c) => c.kind === "bare-expr")).toBe(false);
    expect(errors.map((e) => e.code)).not.toContain("E-PARSE-001");
    const js = emitMatchStmt(m, {});
    expect(js).toContain("else if (v !== null && v !== undefined) {");
  });
});
