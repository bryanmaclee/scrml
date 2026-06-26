/**
 * ExprNode round-trip invariant tests — Phase 1 (Phase 1.5 invariant update)
 *
 * Verifies the idempotency invariant:
 *   deepEqualExprNode(
 *     parseExprToNode(x),
 *     parseExprToNode(emitStringFromTree(parseExprToNode(x)))
 *   )
 *
 * That is: emit the tree, reparse the emission, compare trees structurally.
 * This is the correct invariant for expressions that come from ast-builder.js
 * (which joins tokens with spaces, producing forms like `loadContacts ( )`)
 * because string equality fails for token-joined vs. compact-emitted forms.
 *
 * Phase 1.5 change: replaced string-equality round-trip with idempotency.
 * See docs/changes/expr-ast-phase-1-audit/anomaly-report.md for the rationale.
 *
 * Tests are organized into four groups:
 *   §1 — 15 worked examples from design doc
 *   §2 — 50 operator/form samples covering ExprNode kind coverage
 *   §3 — Tree shape assertions (kind + key fields, not round-trip)
 *   §4 — deepEqualExprNode helper unit tests
 *
 * Field name reference (from types/ast.ts):
 *   UnaryExpr:   .op, .argument, .prefix
 *   BinaryExpr:  .op, .left, .right
 *   TernaryExpr: .condition, .consequent, .alternate
 *   MemberExpr:  .object, .property, .optional
 *   CallExpr:    .callee, .args, .optional
 *   LitExpr:     .litType ("number"|"string"|"bool"|"null"|"undefined"|"template"|"not")
 *   LambdaExpr:  .fnStyle, .params, .body (.body.kind is "expr" or "block")
 */

import { describe, test, expect } from "bun:test";
import {
  parseExprToNode,
  emitStringFromTree,
  normalizeWhitespace,
  deepEqualExprNode,
} from "../../src/expression-parser.ts";

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

/**
 * Idempotency check: parse(x) deepEquals parse(emit(parse(x))).
 * Returns the parsed node so callers can make additional assertions.
 */
function expectIdempotent(input) {
  const node = parseExprToNode(input, "<test>", 0);
  const emitted = emitStringFromTree(node);
  const reparsed = parseExprToNode(emitted, "<test>", 0);
  const equal = deepEqualExprNode(node, reparsed);
  if (!equal) {
    throw new Error(
      `Idempotency check failed for: ${input}\n` +
      `  Emitted: ${emitted}\n` +
      `  node.kind=${node.kind}, reparsed.kind=${reparsed.kind}`
    );
  }
  expect(equal).toBe(true);
  return node;
}

// -------------------------------------------------------------------------
// §1: 15 worked examples (design doc §8)
// -------------------------------------------------------------------------

describe("ExprNode round-trip — §1 worked examples", () => {
  test("Example 1: @count + @step", () => {
    const node = expectIdempotent("@count + @step");
    expect(node.kind).toBe("binary");
  });

  test("Example 2: ternary with @sending", () => {
    const node = expectIdempotent('@sending ? "Sending…" : "Send Message"');
    expect(node.kind).toBe("ternary");
  });

  test("Example 3: p.name.toLowerCase().includes(q)", () => {
    const node = expectIdempotent("p.name.toLowerCase().includes(q)");
    expect(node.kind).toBe("call");
  });

  test("Example 4: @marioState == MarioState.Small", () => {
    const node = expectIdempotent("@marioState == MarioState.Small");
    expect(node.kind).toBe("binary");
    expect(node.op).toBe("==");
  });

  test("Example 5: @email.includes('@')", () => {
    const node = expectIdempotent('@email.includes("@")');
    expect(node.kind).toBe("call");
  });

  test("Example 6: x is .North (enum variant check)", () => {
    const node = parseExprToNode("x is .North", "<test>", 0);
    expect(node.kind).toBe("binary");
    expect(node.op).toBe("is");
    expect(node.kind).not.toBe("escape-hatch");
    // Idempotency
    expectIdempotent("x is .North");
  });

  test("Example 7: @val is not", () => {
    const node = parseExprToNode("@val is not", "<test>", 0);
    expect(node.kind).toBe("binary");
    expect(node.op).toBe("is-not");
    expect(node.kind).not.toBe("escape-hatch");
    // Idempotency
    expectIdempotent("@val is not");
  });

  test("Example 8: (arr.find(x => x.id == id)) is not — Phase 1 limitation: escape-hatch for nested-paren is-not", () => {
    // Phase 1 limitation: the simple regex preprocessor cannot handle `(complex_expr) is not`
    // when the paren expression contains nested parens or commas. This fires an escape-hatch.
    // Phase 2 will use a token-level preprocessor to resolve this.
    const node = parseExprToNode("(arr.find(x => x.id == id)) is not", "<test>", 0);
    // Accept either fully-structured (future) or escape-hatch (Phase 1)
    expect(["binary", "escape-hatch"]).toContain(node.kind);
    // Either way, must not throw
    expect(node).toBeDefined();
    // Escape-hatch: idempotency uses normalized raw comparison, so deepEqual holds
    const emitted = emitStringFromTree(node);
    const reparsed = parseExprToNode(emitted, "<test>", 0);
    expect(deepEqualExprNode(node, reparsed)).toBe(true);
  });

  test("Example 9: object literal { id: 1, name: 'Ada Lovelace', role: 'Mathematician' }", () => {
    const node = expectIdempotent('{ id: 1, name: "Ada Lovelace", role: "Mathematician" }');
    expect(node.kind).toBe("object");
    expect(node.props).toHaveLength(3);
  });

  test("Example 10: @tasks.map(row => ({ ...row, status: ... ?? row.status }))", () => {
    const src =
      "@tasks.map(row => ({ ...row, status: TaskStatus.toEnum(row.status) ?? row.status }))";
    const node = parseExprToNode(src, "<test>", 0);
    expect(node.kind).toBe("call");
    expect(node.kind).not.toBe("escape-hatch");
    // lambda body should be expression body (not block)
    const lambda = node.args[0];
    expect(lambda.kind).toBe("lambda");
    expect(lambda.body.kind).toBe("expr");
    // Idempotency
    expectIdempotent(src);
  });

  test("Example 11: match expression (scrml-specific)", () => {
    const src = 'match @marioState { .Small => "🧍" .Big => "🦸" .Fire => "🔥" .Cape => "🦅" }';
    const node = parseExprToNode(src, "<test>", 0);
    expect(node.kind).toBe("match-expr");
    expect(node.subject.kind).toBe("ident");
    expect(node.subject.name).toBe("@marioState");
    // Idempotency
    expectIdempotent(src);
  });

  test('Example 12: !@email.includes("@")', () => {
    const node = expectIdempotent('!@email.includes("@")');
    expect(node.kind).toBe("unary");
    expect(node.op).toBe("!");
    // UnaryExpr field is `argument`, not `operand`
    expect(node.argument.kind).toBe("call");
  });

  test("Example 13: fetchToken() — call form (lin-decl init expression)", () => {
    const node = expectIdempotent("fetchToken()");
    expect(node.kind).toBe("call");
    expect(node.args).toHaveLength(0);
  });

  test("Example 14: @currentPrice ?? 'Loading...'", () => {
    const node = expectIdempotent('@currentPrice ?? "Loading..."');
    expect(node.kind).toBe("binary");
    expect(node.op).toBe("??");
  });

  test("Example 15: p.name.toLowerCase().includes(q) || p.role.toLowerCase().includes(q)", () => {
    const src =
      "p.name.toLowerCase().includes(q) || p.role.toLowerCase().includes(q)";
    const node = expectIdempotent(src);
    expect(node.kind).toBe("binary");
    expect(node.op).toBe("||");
  });
});

// -------------------------------------------------------------------------
// §2: Operator and form coverage (50 samples)
// -------------------------------------------------------------------------

describe("ExprNode round-trip — §2 operator/form coverage", () => {
  // Arithmetic
  test("a + b", () => expectIdempotent("a + b"));
  test("a - b", () => expectIdempotent("a - b"));
  test("a * b", () => expectIdempotent("a * b"));
  test("a / b", () => expectIdempotent("a / b"));
  test("a % b", () => expectIdempotent("a % b"));
  test("a ** b", () => expectIdempotent("a ** b"));

  // Comparison
  test("a < b", () => expectIdempotent("a < b"));
  test("a <= b", () => expectIdempotent("a <= b"));
  test("a > b", () => expectIdempotent("a > b"));
  test("a >= b", () => expectIdempotent("a >= b"));

  // Equality
  test("a === b", () => expectIdempotent("a === b"));
  test("a !== b", () => expectIdempotent("a !== b"));

  // Logical
  test("a && b", () => expectIdempotent("a && b"));
  test("a || b", () => expectIdempotent("a || b"));
  test("a ?? b", () => expectIdempotent("a ?? b"));

  // Unary
  test("!a", () => expectIdempotent("!a"));
  test("-a", () => expectIdempotent("-a"));
  test("typeof a", () => expectIdempotent("typeof a"));
  test("void 0", () => expectIdempotent("void 0"));

  // Assignment
  test("a += 1", () => expectIdempotent("a += 1"));
  test("a -= 1", () => expectIdempotent("a -= 1"));

  // Ternary
  test("a ? b : c", () => expectIdempotent("a ? b : c"));
  test("nested ternary", () => expectIdempotent("a ? b : c ? d : e"));

  // Member / call
  test("a.b", () => expectIdempotent("a.b"));
  test("a.b.c", () => expectIdempotent("a.b.c"));
  test("a()", () => expectIdempotent("a()"));
  test("a(b, c)", () => expectIdempotent("a(b, c)"));
  test("a.b(c)", () => expectIdempotent("a.b(c)"));
  test("a[b]", () => expectIdempotent("a[b]"));
  test("new Foo()", () => expectIdempotent("new Foo()"));
  test("new Foo(a, b)", () => expectIdempotent("new Foo(a, b)"));

  // Literals
  test("42", () => { const n = expectIdempotent("42"); expect(n.kind).toBe("lit"); });
  test('"hello"', () => { const n = expectIdempotent('"hello"'); expect(n.kind).toBe("lit"); });
  test("true", () => { const n = expectIdempotent("true"); expect(n.kind).toBe("lit"); });
  test("false", () => { const n = expectIdempotent("false"); expect(n.kind).toBe("lit"); });
  test("null", () => { const n = expectIdempotent("null"); expect(n.kind).toBe("lit"); });

  // Arrays
  test("[]", () => { const n = expectIdempotent("[]"); expect(n.kind).toBe("array"); });
  test("[1, 2, 3]", () => { const n = expectIdempotent("[1, 2, 3]"); expect(n.kind).toBe("array"); });
  test("[...a, b]", () => { const n = expectIdempotent("[...a, b]"); expect(n.kind).toBe("array"); });

  // Objects
  test("{}", () => { const n = expectIdempotent("{}"); expect(n.kind).toBe("object"); });
  test("{ a: 1 }", () => { const n = expectIdempotent("{ a: 1 }"); expect(n.kind).toBe("object"); });
  test("{ ...a, b: 2 }", () => { const n = expectIdempotent("{ ...a, b: 2 }"); expect(n.kind).toBe("object"); });

  // §59.3 / §59.12 — value-native map literals (also a set's empty seed `[:]`).
  // Before the `deepEqualExprNode` map-lit case landed (S222 set arc), these
  // round-tripped to a structurally-correct re-parse but compared UNEQUAL (the
  // map-lit branch fell through to `default: return false`).
  test("[:]", () => { const n = expectIdempotent("[:]"); expect(n.kind).toBe("map-lit"); });
  test('["a": 1]', () => { const n = expectIdempotent('["a": 1]'); expect(n.kind).toBe("map-lit"); });
  test('["a": 1, "b": 2]', () => { const n = expectIdempotent('["a": 1, "b": 2]'); expect(n.kind).toBe("map-lit"); });

  // Arrow functions (expression body)
  test("x => x + 1", () => {
    const n = parseExprToNode("x => x + 1", "<test>", 0);
    expect(n.kind).toBe("lambda");
    expect(n.body.kind).toBe("expr");
    expectIdempotent("x => x + 1");
  });
  test("(x, y) => x + y", () => {
    const n = parseExprToNode("(x, y) => x + y", "<test>", 0);
    expect(n.kind).toBe("lambda");
    expectIdempotent("(x, y) => x + y");
  });

  // Template literals with interpolation → escape-hatch is expected in Phase 1
  test("template literal with interpolation (Phase 1: escape-hatch)", () => {
    const n = parseExprToNode("`hello ${name}`", "<test>", 0);
    // Phase 1: interpolated template literals go to escape-hatch (no structured representation)
    // Static template literals (no ${}) could parse to lit/template
    expect(n).toBeDefined();
    expect(typeof n.kind).toBe("string");
    // Idempotency still holds for escape-hatch (raw comparison)
    const emitted = emitStringFromTree(n);
    const reparsed = parseExprToNode(emitted, "<test>", 0);
    expect(deepEqualExprNode(n, reparsed)).toBe(true);
  });

  // Optional chaining
  test("a?.b", () => {
    const n = parseExprToNode("a?.b", "<test>", 0);
    expect(n.kind).toBe("member");
    expect(n.optional).toBe(true);
    expectIdempotent("a?.b");
  });
  test("a?.()", () => {
    const n = parseExprToNode("a?.()", "<test>", 0);
    expect(n.kind).toBe("call");
    expect(n.optional).toBe(true);
    expectIdempotent("a?.()");
  });

  // Spread in call
  test("f(...args)", () => expectIdempotent("f(...args)"));

  // Bitwise
  test("a & b", () => expectIdempotent("a & b"));
  test("a | b", () => expectIdempotent("a | b"));
});

// -------------------------------------------------------------------------
// §3: Tree shape assertions
// -------------------------------------------------------------------------

describe("ExprNode tree shape — §3 structural assertions", () => {
  test("binary node has op, left, right", () => {
    const n = parseExprToNode("a + b", "<test>", 0);
    expect(n.kind).toBe("binary");
    expect(n.op).toBe("+");
    expect(n.left).toBeDefined();
    expect(n.right).toBeDefined();
    expect(n.left.kind).toBe("ident");
    expect(n.left.name).toBe("a");
    expect(n.right.kind).toBe("ident");
    expect(n.right.name).toBe("b");
  });

  test("unary node has op, argument (not operand), prefix", () => {
    const n = parseExprToNode("!x", "<test>", 0);
    expect(n.kind).toBe("unary");
    expect(n.op).toBe("!");
    expect(n.prefix).toBe(true);
    // Field is `argument` per UnaryExpr interface in types/ast.ts
    expect(n.argument).toBeDefined();
    expect(n.argument.kind).toBe("ident");
  });

  test("member node has object, property, optional", () => {
    const n = parseExprToNode("a.b", "<test>", 0);
    expect(n.kind).toBe("member");
    expect(n.property).toBe("b");
    expect(n.optional).toBe(false);
    expect(n.object.kind).toBe("ident");
    expect(n.object.name).toBe("a");
  });

  test("call node has callee, args, optional", () => {
    const n = parseExprToNode("f(x, y)", "<test>", 0);
    expect(n.kind).toBe("call");
    expect(n.args).toHaveLength(2);
    expect(n.optional).toBe(false);
  });

  test("object node has props array", () => {
    const n = parseExprToNode("{ x: 1, y: 2 }", "<test>", 0);
    expect(n.kind).toBe("object");
    expect(n.props).toHaveLength(2);
    expect(n.props[0].kind).toBe("prop");
    expect(n.props[0].key).toBe("x");
  });

  test("array node has elements array", () => {
    const n = parseExprToNode("[1, 2, 3]", "<test>", 0);
    expect(n.kind).toBe("array");
    expect(n.elements).toHaveLength(3);
  });

  test("ternary node has condition/consequent/alternate (not test)", () => {
    const n = parseExprToNode("a ? b : c", "<test>", 0);
    expect(n.kind).toBe("ternary");
    // TernaryExpr uses `condition`, not `test` (matching ast.ts interface)
    expect(n.condition).toBeDefined();
    expect(n.consequent).toBeDefined();
    expect(n.alternate).toBeDefined();
  });

  test("lambda (arrow) node has params and expr body", () => {
    const n = parseExprToNode("x => x * 2", "<test>", 0);
    expect(n.kind).toBe("lambda");
    expect(n.fnStyle).toBe("arrow");
    expect(n.params).toHaveLength(1);
    expect(n.params[0].name).toBe("x");
    expect(n.body.kind).toBe("expr");
  });

  test("lit node for number", () => {
    const n = parseExprToNode("42", "<test>", 0);
    expect(n.kind).toBe("lit");
    expect(n.litType).toBe("number");
    expect(n.value).toBe(42);
  });

  test("lit node for string", () => {
    const n = parseExprToNode('"hello"', "<test>", 0);
    expect(n.kind).toBe("lit");
    expect(n.litType).toBe("string");
    expect(n.value).toBe("hello");
  });

  test("lit node for boolean uses litType 'bool'", () => {
    const n = parseExprToNode("true", "<test>", 0);
    expect(n.kind).toBe("lit");
    // LitExpr.litType uses "bool" (not "boolean") per types/ast.ts
    expect(n.litType).toBe("bool");
  });

  test("new node has callee and args", () => {
    const n = parseExprToNode("new Map()", "<test>", 0);
    expect(n.kind).toBe("new");
    expect(n.callee.kind).toBe("ident");
    expect(n.args).toHaveLength(0);
  });

  test("index node has object and index", () => {
    const n = parseExprToNode("arr[0]", "<test>", 0);
    expect(n.kind).toBe("index");
    expect(n.object.kind).toBe("ident");
    expect(n.index.kind).toBe("lit");
  });

  test("all nodes have a span", () => {
    const exprs = ["a + b", "f()", "a.b", "x => x", "[1]", "{ a: 1 }"];
    for (const expr of exprs) {
      const n = parseExprToNode(expr, "<test>", 0);
      expect(n.span).toBeDefined();
      expect(typeof n.span.start).toBe("number");
      expect(typeof n.span.end).toBe("number");
    }
  });

  test("is-not emits binary with op is-not", () => {
    const n = parseExprToNode("x is not", "<test>", 0);
    expect(n.kind).toBe("binary");
    expect(n.op).toBe("is-not");
  });

  test("is-some emits binary with op is-some", () => {
    const n = parseExprToNode("x is some", "<test>", 0);
    expect(n.kind).toBe("binary");
    expect(n.op).toBe("is-some");
  });

  test("is variant emits binary with op is", () => {
    const n = parseExprToNode("x is .Done", "<test>", 0);
    expect(n.kind).toBe("binary");
    expect(n.op).toBe("is");
    expect(n.right.kind).toBe("ident");
    expect(n.right.name).toBe(".Done");
  });

  test("@-prefixed ident preserves @ in name", () => {
    const n = parseExprToNode("@count", "<test>", 0);
    expect(n.kind).toBe("ident");
    expect(n.name).toBe("@count");
  });

  test("malformed input does not throw — returns escape-hatch or some node", () => {
    // Should not throw — either escape-hatch or some node
    const n = parseExprToNode(">>> <<<", "<test>", 0);
    expect(n).toBeDefined();
    expect(typeof n.kind).toBe("string");
  });
});

// -------------------------------------------------------------------------
// §4: deepEqualExprNode helper unit tests
// -------------------------------------------------------------------------

describe("deepEqualExprNode — §4 helper unit tests", () => {
  test("equal ident nodes", () => {
    const a = parseExprToNode("x", "<test>", 0);
    const b = parseExprToNode("x", "<test>", 99);
    expect(deepEqualExprNode(a, b)).toBe(true);
  });

  test("unequal ident nodes", () => {
    const a = parseExprToNode("x", "<test>", 0);
    const b = parseExprToNode("y", "<test>", 0);
    expect(deepEqualExprNode(a, b)).toBe(false);
  });

  test("equal number lits", () => {
    const a = parseExprToNode("42", "<test>", 0);
    const b = parseExprToNode("42", "<test>", 0);
    expect(deepEqualExprNode(a, b)).toBe(true);
  });

  test("unequal number lits", () => {
    const a = parseExprToNode("1", "<test>", 0);
    const b = parseExprToNode("2", "<test>", 0);
    expect(deepEqualExprNode(a, b)).toBe(false);
  });

  test("equal nested binary: a + b", () => {
    const a = parseExprToNode("a + b", "<test>", 0);
    const b = parseExprToNode("a + b", "<test>", 100);
    expect(deepEqualExprNode(a, b)).toBe(true);
  });

  test("unequal binary ops: a + b vs a - b", () => {
    const a = parseExprToNode("a + b", "<test>", 0);
    const b = parseExprToNode("a - b", "<test>", 0);
    expect(deepEqualExprNode(a, b)).toBe(false);
  });

  test("equal call with args: f(x, y)", () => {
    const a = parseExprToNode("f(x, y)", "<test>", 0);
    const b = parseExprToNode("f(x, y)", "<test>", 55);
    expect(deepEqualExprNode(a, b)).toBe(true);
  });

  test("unequal call arg count: f(x) vs f(x, y)", () => {
    const a = parseExprToNode("f(x)", "<test>", 0);
    const b = parseExprToNode("f(x, y)", "<test>", 0);
    expect(deepEqualExprNode(a, b)).toBe(false);
  });

  test("equal array: [1, 2, 3]", () => {
    const a = parseExprToNode("[1, 2, 3]", "<test>", 0);
    const b = parseExprToNode("[1, 2, 3]", "<test>", 20);
    expect(deepEqualExprNode(a, b)).toBe(true);
  });

  test("unequal array element: [1, 2] vs [1, 3]", () => {
    const a = parseExprToNode("[1, 2]", "<test>", 0);
    const b = parseExprToNode("[1, 3]", "<test>", 0);
    expect(deepEqualExprNode(a, b)).toBe(false);
  });

  test("equal object: { a: 1, b: 2 }", () => {
    const a = parseExprToNode("{ a: 1, b: 2 }", "<test>", 0);
    const b = parseExprToNode("{ a: 1, b: 2 }", "<test>", 10);
    expect(deepEqualExprNode(a, b)).toBe(true);
  });

  // §59.3 / §59.12 — map-lit (the gap the set arc closed).
  test("equal empty map-lit: [:]", () => {
    const a = parseExprToNode("[:]", "<test>", 0);
    const b = parseExprToNode("[:]", "<test>", 30);
    expect(a.kind).toBe("map-lit");
    expect(deepEqualExprNode(a, b)).toBe(true);
  });

  test('equal map-lit: ["a": 1, "b": 2]', () => {
    const a = parseExprToNode('["a": 1, "b": 2]', "<test>", 0);
    const b = parseExprToNode('["a": 1, "b": 2]', "<test>", 40);
    expect(deepEqualExprNode(a, b)).toBe(true);
  });

  test('unequal map-lit value: ["a": 1] vs ["a": 2]', () => {
    const a = parseExprToNode('["a": 1]', "<test>", 0);
    const b = parseExprToNode('["a": 2]', "<test>", 0);
    expect(deepEqualExprNode(a, b)).toBe(false);
  });

  test('unequal map-lit entry count: [:] vs ["a": 1]', () => {
    const a = parseExprToNode("[:]", "<test>", 0);
    const b = parseExprToNode('["a": 1]', "<test>", 0);
    expect(deepEqualExprNode(a, b)).toBe(false);
  });

  test("escape-hatch nodes: equal raw content", () => {
    // Two escape-hatch nodes with same raw are equal
    const rawExpr = ">>> <<<";
    const a = parseExprToNode(rawExpr, "<test>", 0);
    const b = parseExprToNode(rawExpr, "<test>", 100);
    expect(a.kind).toBe("escape-hatch");
    expect(deepEqualExprNode(a, b)).toBe(true);
  });

  test("escape-hatch nodes: whitespace-normalized comparison", () => {
    // Escape-hatch nodes with same content but different whitespace are equal
    const a = parseExprToNode(">>> <<<", "<test>", 0);
    // Manually check that two escape-hatch nodes with normalized-equal raw compare equal
    const b = { kind: "escape-hatch", span: a.span, nativeKind: "ParseError", raw: "  >>>  <<<  " };
    expect(deepEqualExprNode(a, b)).toBe(true);
  });

  test("different kinds: ident vs lit", () => {
    const a = parseExprToNode("x", "<test>", 0);
    const b = parseExprToNode("42", "<test>", 0);
    expect(deepEqualExprNode(a, b)).toBe(false);
  });

  test("equal lambda with expression body", () => {
    const a = parseExprToNode("x => x + 1", "<test>", 0);
    const b = parseExprToNode("x => x + 1", "<test>", 50);
    expect(deepEqualExprNode(a, b)).toBe(true);
  });

  test("unequal lambda: different param", () => {
    const a = parseExprToNode("x => x + 1", "<test>", 0);
    const b = parseExprToNode("y => y + 1", "<test>", 0);
    expect(deepEqualExprNode(a, b)).toBe(false);
  });

  test("equal member access: a.b.c", () => {
    const a = parseExprToNode("a.b.c", "<test>", 0);
    const b = parseExprToNode("a.b.c", "<test>", 77);
    expect(deepEqualExprNode(a, b)).toBe(true);
  });

  test("span differences do not affect equality", () => {
    // Same expression parsed at different offsets — spans differ, content same
    const a = parseExprToNode("foo.bar()", "<test>", 0);
    const b = parseExprToNode("foo.bar()", "<test>", 1000);
    expect(a.span.start).not.toBe(b.span.start);
    expect(deepEqualExprNode(a, b)).toBe(true);
  });
});
