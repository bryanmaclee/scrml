// Regression guard for g-emit-string-tree-paren-drop (S205):
// emitStringFromTree (the Phase-1 ExprNode pretty-printer) must parenthesize a binary/ternary/assign
// operand whose precedence is lower than its parent op's, or re-serialization inverts precedence
// (e.g. `(a + b) % c` → `a + b % c`). Verifies paren-PRESERVATION, no SPURIOUS parens, and round-trip
// idempotency. See docs/known-gaps.md g-emit-string-tree-paren-drop.
import { test, expect } from "bun:test";
import { parseExprToNode, emitStringFromTree } from "../../src/expression-parser.ts";

const emit = (src) => emitStringFromTree(parseExprToNode(src, "test.scrml", 0));

// [source, expected re-emit] — expected preserves the MINIMAL parens that keep precedence.
const cases = [
  // the reported failures (lower-prec `+`/`-` subtree under higher-prec `%`/`/`)
  ["(h * 131 + x * 2654435 + 1) % 2147483647", "(h * 131 + x * 2654435 + 1) % 2147483647"],
  ["(cols - 1) / 2", "(cols - 1) / 2"],
  // no spurious parens when precedence already correct bare
  ["a + b * c", "a + b * c"],
  ["x * 2 + 1", "x * 2 + 1"],
  // parens kept where required
  ["(a + b) * c", "(a + b) * c"],
  ["(a || b) && c", "(a || b) && c"],
  // associativity: left-assoc right-operand at equal prec needs parens; left operand doesn't
  ["a - (b - c)", "a - (b - c)"],
  ["a - b - c", "a - b - c"],
  ["a / (b / c)", "a / (b / c)"],
  // ternary / lower-prec operand of a binary
  ["a + (b ? c : d)", "a + (b ? c : d)"],
  // g-paren-binary-group-dropped-before-method (ss3, S210) — receiver-position
  // parens: a looser-binding receiver/callee under a member/index/call/new must
  // keep its grouping, else `(a + b).m()` → `a + b.m()` (method binds to `b`).
  ["(a + b).toUpperCase()", "(a + b).toUpperCase()"],
  ["(a + b)[c]", "(a + b)[c]"],
  ["(a ? b : c)()", "(a ? b : c)()"],
  ["(a || b).x", "(a || b).x"],
  // no spurious parens when the receiver is already a primary / tight chain
  ["arr.map(x).join(y)", "arr.map(x).join(y)"],
  ["obj.a.b", "obj.a.b"],
  ["f().g", "f().g"],
];

test("emitStringFromTree preserves precedence parens (g-emit-string-tree-paren-drop)", () => {
  for (const [src, expected] of cases) {
    expect(emit(src)).toBe(expected);
  }
});

test("emitStringFromTree is idempotent across re-serialization", () => {
  for (const [src] of cases) {
    const once = emit(src);
    const twice = emitStringFromTree(parseExprToNode(once, "test.scrml", 0));
    expect(twice).toBe(once);
  }
});
