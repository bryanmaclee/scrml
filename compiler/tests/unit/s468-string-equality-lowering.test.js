/**
 * S468 — §45 structural `==` in the STRING rewrite pipeline.
 *
 * SPEC §45.1: "`==` is scrml's sole equality operator. It performs structural
 * value comparison." §45.4: primitives -> `===`; structs / enums -> a deep
 * structural comparison call; `!=` -> the negation.
 *
 * Gap g-structural-eq-emitted-as-strict-eq-outside-typed-fn-bodies-s464: the
 * client string pipeline's Pass 18 (`rewriteEqualityOps`) regex-replaced every
 * `==` with `===` — reference equality for structs / maps / payload enums. Every
 * raw-text lowering site (inline handlers whose body is an assignment / postfix /
 * lambda, `<each>` row handlers, variant-guard arms, match-arm block bodies,
 * engine rule text, escape hatches) inherited it.
 *
 * Unit level: `lowerEqualityOps` (codegen/string-equality-lowering.ts) and the
 * pipeline entry `rewriteExpr` that calls it.
 */
import { describe, test, expect } from "bun:test";
import {
  lowerEqualityOps,
  lowerEqualityLegacy,
  isStaticallyPrimitiveEstree,
} from "../../src/codegen/string-equality-lowering.ts";
import { rewriteExpr, rewriteEqualityOps } from "../../src/codegen/rewrite.ts";

describe("lowerEqualityOps — non-primitive operands lower to the structural helper", () => {
  test("two cell reads", () => {
    expect(lowerEqualityOps(`_scrml_reactive_get("a") == _scrml_reactive_get("b")`))
      .toBe(`_scrml_structural_eq(_scrml_reactive_get("a"), _scrml_reactive_get("b"))`);
  });
  test("`!=` is the negation", () => {
    expect(lowerEqualityOps(`a != b`)).toBe(`!_scrml_structural_eq(a, b)`);
  });
  test("object-literal operand", () => {
    expect(lowerEqualityOps(`p == { x: 1, y: 2 }`)).toBe(`_scrml_structural_eq(p, { x: 1, y: 2 })`);
  });
  test("inside a ternary inside a call (the reproducer shape)", () => {
    expect(lowerEqualityOps(`_scrml_reactive_set("msg", _scrml_reactive_get("a") == _scrml_reactive_get("b") ? "yes" : "no")`))
      .toBe(`_scrml_reactive_set("msg", _scrml_structural_eq(_scrml_reactive_get("a"), _scrml_reactive_get("b")) ? "yes" : "no")`);
  });
  test("statement list: if / else / return", () => {
    expect(lowerEqualityOps(`if (p == q) { r = 1 } else { return s != t }`))
      .toBe(`if (_scrml_structural_eq(p, q)) { r = 1 } else { return !_scrml_structural_eq(s, t) }`);
  });
  test("operand grouping parens stay with the operand", () => {
    expect(lowerEqualityOps(`(a || b) != c`)).toBe(`!_scrml_structural_eq((a || b), c)`);
  });
  test("nested equality (left-assoc) lowers inside-out", () => {
    expect(lowerEqualityOps(`a == b == c`)).toBe(`_scrml_structural_eq(_scrml_structural_eq(a, b), c)`);
  });
  test("call arguments", () => {
    expect(lowerEqualityOps(`f(a == b, c != d)`)).toBe(`f(_scrml_structural_eq(a, b), !_scrml_structural_eq(c, d))`);
  });
  test("a template-literal interpolation is code, not string text", () => {
    expect(lowerEqualityOps("`${a == b}`")).toBe("`${_scrml_structural_eq(a, b)}`");
  });
  test("an arrow body", () => {
    expect(lowerEqualityOps(`(e) => { m = x == y }`)).toBe(`(e) => { m = _scrml_structural_eq(x, y) }`);
  });
  test("a mixed operand (one primitive, one not) is structural — same rule as emitBinary", () => {
    expect(lowerEqualityOps(`_scrml_reactive_get("n") == 3`)).toBe(`_scrml_structural_eq(_scrml_reactive_get("n"), 3)`);
  });
});

describe("lowerEqualityOps — provably primitive operands keep `===` (§45.4 primitives row)", () => {
  test("member `.length` vs number literal", () => {
    expect(lowerEqualityOps(`x.length == 3`)).toBe(`x.length === 3`);
  });
  test("two literals", () => {
    expect(lowerEqualityOps(`1 != 2`)).toBe(`1 !== 2`);
  });
  test("arithmetic vs literal (the operand keeps its own parens)", () => {
    expect(lowerEqualityOps(`(a + b) == 0`)).toBe(`(a + b) === 0`);
  });
  test("a node-for-node swap: the surrounding precedence is unchanged", () => {
    expect(lowerEqualityOps(`x + (1 == 2)`)).toBe(`x + (1 === 2)`);
    expect(lowerEqualityOps(`!(x.length == 1)`)).toBe(`!(x.length === 1)`);
    expect(lowerEqualityOps(`1 == 2 == false`)).toBe(`1 === 2 === false`);
    expect(lowerEqualityOps(`x.length == 1 ? "a" : "b"`)).toBe(`x.length === 1 ? "a" : "b"`);
    expect(lowerEqualityOps(`x.length == 1 && y.size != 0`)).toBe(`x.length === 1 && y.size !== 0`);
  });
  test("isStaticallyPrimitiveEstree is conservative", () => {
    expect(isStaticallyPrimitiveEstree({ type: "Identifier", name: "x" })).toBe(false);
    expect(isStaticallyPrimitiveEstree({ type: "ObjectExpression" })).toBe(false);
    expect(isStaticallyPrimitiveEstree({ type: "Literal", value: null, regex: { pattern: "a", flags: "" } })).toBe(false);
    expect(isStaticallyPrimitiveEstree({ type: "Literal", value: "s" })).toBe(true);
  });
});

describe("lowerEqualityOps — text it must not touch", () => {
  test("`==` inside a string literal", () => {
    expect(lowerEqualityOps(`f("x == y")`)).toBe(`f("x == y")`);
  });
  test("already-strict `===` / `!==` (idempotent)", () => {
    expect(lowerEqualityOps(`a === b && c !== d`)).toBe(`a === b && c !== d`);
    const once = lowerEqualityOps(`a == b`);
    expect(lowerEqualityOps(once)).toBe(once);
  });
  test("no operator — returned as is", () => {
    expect(lowerEqualityOps(`f(a, b)`)).toBe(`f(a, b)`);
  });
  test("unparseable text: legacy `===` by default, unchanged with onUnparsed: keep", () => {
    const bad = `foo(1) bar(a == b)`;
    expect(lowerEqualityOps(bad)).toBe(lowerEqualityLegacy(bad));
    expect(lowerEqualityOps(bad)).toBe(`foo(1) bar(a === b)`);
    expect(lowerEqualityOps(bad, { onUnparsed: "keep" })).toBe(bad);
  });
});

describe("client string pipeline (rewriteExpr) — Pass 18 is structural", () => {
  test("rewriteEqualityOps delegates to lowerEqualityOps", () => {
    expect(rewriteEqualityOps(`a == b`)).toBe(`_scrml_structural_eq(a, b)`);
  });
  test("@cell == @cell", () => {
    const out = rewriteExpr(`@a == @b`);
    expect(out).toContain(`_scrml_structural_eq(`);
    expect(out).not.toMatch(/[^=!]===[^=]/);
  });
  test("@cell != object literal", () => {
    const out = rewriteExpr(`@a != { x: 1 }`);
    expect(out.startsWith("!_scrml_structural_eq(")).toBe(true);
  });
  test("a lowered `is not` keeps its explicit null/undefined test (no `==` produced)", () => {
    const out = rewriteExpr(`@a is not`);
    expect(out).not.toContain("_scrml_structural_eq");
    expect(out).toContain("null");
    expect(out).toContain("undefined");
  });
});

// S468 fix round 1 (F1) — the operator is found as a TOKEN, never as text: a
// comment between the operands may itself contain `==` / `!=`.
describe("lowerEqualityOps — an operator inside a comment between the operands is not the operator", () => {
  test("block comment holding `!=` before the real `!=`", () => {
    expect(lowerEqualityOps(`a /* is it != ? */ != b`)).toBe(`!_scrml_structural_eq(a, b)`);
  });
  test("block comment holding `,` and `?` (the reviewer's shape)", () => {
    expect(lowerEqualityOps(`_g("a") /* is it, ? */ != _g("b")`)).toBe(`!_scrml_structural_eq(_g("a"), _g("b"))`);
  });
  test("block comment holding `==` before a `!=` keeps the negation", () => {
    expect(lowerEqualityOps(`a /* == */ != b`)).toBe(`!_scrml_structural_eq(a, b)`);
  });
  test("block comment holding `!=` before an `==` is not negated", () => {
    expect(lowerEqualityOps(`a /* != */ == b`)).toBe(`_scrml_structural_eq(a, b)`);
  });
  test("line comment holding `==` — the comment does not swallow `, b)`", () => {
    const out = lowerEqualityOps(`const same = a // left == right?\n    == b\nout = same`);
    expect(out).toBe(`const same = _scrml_structural_eq(a, b)\nout = same`);
    // And the result is valid JS that computes the structural answer.
    const eq = (x, y) => JSON.stringify(x) === JSON.stringify(y);
    const run = new Function("_scrml_structural_eq", "a", "b", "let out; " + out + "; return out;");
    expect(run(eq, { x: 1 }, { x: 1 })).toBe(true);
  });
  test("comments inside the operands' own parens stay with the operand", () => {
    expect(lowerEqualityOps(`(/* c */ a) == (b /* d */)`)).toBe(`_scrml_structural_eq((/* c */ a), (b /* d */))`);
  });
  test("operator with no surrounding space", () => {
    expect(lowerEqualityOps(`a ==/*x*/b`)).toBe(`_scrml_structural_eq(a, b)`);
    expect(lowerEqualityOps(`x.length==1`)).toBe(`x.length === 1`);
  });
});

// S468 fix round 1 (F2) — no NEW leading `(`: a wrapped `(l === r)` at the start
// of a line let ASI join it to the previous line as a call of its result.
describe("lowerEqualityOps — the primitive swap adds no parens (ASI hazard)", () => {
  test("a statement starting with a primitive `==` after a call line (executed)", () => {
    const src = `export const TAG = makeTag()\ntypeof LABEL == "string" && log.push("ran")`;
    const out = lowerEqualityOps(src);
    expect(out).toBe(`export const TAG = makeTag()\ntypeof LABEL === "string" && log.push("ran")`);
    const body = out.replace("export const TAG", "const TAG") + "; return [TAG, log];";
    const [tag, log] = new Function("makeTag", "LABEL", "log", body)(() => "t", "x", []);
    expect(tag).toBe("t");
    expect(log).toEqual(["ran"]);
  });
  test("no lowering starts with a new `(`", () => {
    for (const src of [`a == b`, `a != b`, `1 == 2`, `x.length != 0`, `typeof q == "s"`]) {
      expect(lowerEqualityOps(src).startsWith("(")).toBe(false);
    }
  });
});
