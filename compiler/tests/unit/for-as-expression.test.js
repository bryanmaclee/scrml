/**
 * for-as-expression — Unit Tests
 *
 * Tests for §32 for-loop array accumulator as a first-class expression:
 *   `const names = for (item of items) { lift item.name }`
 *
 * The for-as-expression is the array-accumulator counterpart to if-as-expression.
 * A `for` loop with `lift` inside its body accumulates values into an array that
 * can be assigned to a variable in one expression.
 *
 * Codegen target:
 *   for (item of items) { lift item.name }
 *   const names = ~
 *   →
 *   let _scrml_tilde_N = [];
 *   for (const item of items) { _scrml_tilde_N.push(item.name); }
 *   const names = _scrml_tilde_N;
 *
 * The parser produces AST nodes of the form:
 *   { kind: "const-decl", name: "names", init: "", forExpr: { kind: "for-expr", variable: "item", iterable: "items", body: [...] } }
 *
 * Sections:
 *   1. emitLogicNode: const-decl with forExpr → array accumulator
 *   2. emitLogicNode: let-decl with forExpr → array accumulator
 *   3. Conditional lift inside for body (filter pattern)
 *   4. Nested for-as-expression
 *   5. AST builder integration: parseOneStatement parses for-as-expression
 *   6. AST builder integration: body parser parses for-as-expression
 *   7. Regression: existing for-stmt behavior unchanged
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { emitLogicNode, emitLogicBody } from "../../src/codegen/emit-logic.ts";
import { resetVarCounter } from "../../src/codegen/var-counter.ts";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";

// Reset the var counter before each test so variable names are deterministic
beforeEach(() => {
  resetVarCounter();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal for-expr AST node (as produced by parseOneForStmt).
 * The forExpr wraps the for-stmt node with kind: "for-expr".
 */
function makeForExpr({ variable = "item", iterable = "items", body = [] } = {}) {
  return {
    kind: "for-expr",
    variable,
    iterable,
    body,
  };
}

/**
 * Build a simple lift-expr node for a value expression.
 */
function makeLiftExpr(expr) {
  return {
    kind: "lift-expr",
    expr: { kind: "expr", expr },
  };
}

// ---------------------------------------------------------------------------
// §1: const-decl with forExpr → array accumulator
// ---------------------------------------------------------------------------

describe("emitLogicNode: const-decl with forExpr (for-as-expression)", () => {
  test("basic for-as-expression: const names = for (item of items) { lift item.name }", () => {
    const node = {
      kind: "const-decl",
      name: "names",
      init: "",
      forExpr: makeForExpr({
        variable: "item",
        iterable: "items",
        body: [makeLiftExpr("item . name")],
      }),
    };
    const result = emitLogicNode(node, {});
    // Should initialize array before loop
    expect(result).toMatch(/let _scrml_tilde_\d+ = \[\];/);
    // Should emit for-of loop with the iterable
    expect(result).toMatch(/for \(const item of items\)/);
    // Should push the lift expression into the array
    expect(result).toMatch(/_scrml_tilde_\d+\.push\(item \. name\);/);
    // Final line assigns the array to the variable
    const tildeMatch = result.match(/let (_scrml_tilde_\d+) = \[\];/);
    expect(tildeMatch).not.toBeNull();
    const tildeVar = tildeMatch[1];
    expect(result).toContain(`const names = ${tildeVar};`);
  });

  test("array init is on the first line, before the for loop", () => {
    const node = {
      kind: "const-decl",
      name: "result",
      init: "",
      forExpr: makeForExpr({
        variable: "x",
        iterable: "xs",
        body: [makeLiftExpr("x")],
      }),
    };
    const result = emitLogicNode(node, {});
    const lines = result.split("\n");
    expect(lines[0]).toMatch(/^let _scrml_tilde_\d+ = \[\];$/);
    expect(lines[1]).toMatch(/^for \(const x of xs\)/);
  });

  test("assignment to const variable is on the last line", () => {
    const node = {
      kind: "const-decl",
      name: "vals",
      init: "",
      forExpr: makeForExpr({
        body: [makeLiftExpr("item")],
      }),
    };
    const result = emitLogicNode(node, {});
    const lines = result.split("\n").filter((l) => l.trim());
    const lastLine = lines[lines.length - 1];
    expect(lastLine).toMatch(/^const vals = _scrml_tilde_\d+;$/);
  });

  test("empty for body produces empty array assignment", () => {
    const node = {
      kind: "const-decl",
      name: "empty",
      init: "",
      forExpr: makeForExpr({ body: [] }),
    };
    const result = emitLogicNode(node, {});
    expect(result).toMatch(/let _scrml_tilde_\d+ = \[\];/);
    expect(result).toMatch(/for \(const item of items\)/);
    expect(result).toContain("const empty = _scrml_tilde_");
    // No push calls when body is empty
    expect(result).not.toContain(".push(");
  });
});

// ---------------------------------------------------------------------------
// §2: let-decl with forExpr → array accumulator
// ---------------------------------------------------------------------------

describe("emitLogicNode: let-decl with forExpr (for-as-expression)", () => {
  test("let names = for (item of items) { lift item.name }", () => {
    const node = {
      kind: "let-decl",
      name: "names",
      init: "",
      forExpr: makeForExpr({
        variable: "item",
        iterable: "items",
        body: [makeLiftExpr("item . name")],
      }),
    };
    const result = emitLogicNode(node, {});
    expect(result).toMatch(/let _scrml_tilde_\d+ = \[\];/);
    expect(result).toMatch(/for \(const item of items\)/);
    expect(result).toMatch(/_scrml_tilde_\d+\.push\(item \. name\);/);
    // Uses `let` keyword for declaration
    const tildeMatch = result.match(/let (_scrml_tilde_\d+) = \[\];/);
    const tildeVar = tildeMatch[1];
    expect(result).toContain(`let names = ${tildeVar};`);
  });
});

// ---------------------------------------------------------------------------
// §3: Conditional lift inside for body (filter pattern)
// ---------------------------------------------------------------------------

describe("emitLogicNode: conditional lift in for-as-expression", () => {
  test("for (item of items) { if (item.active) { lift item.name } } → filtered array", () => {
    const node = {
      kind: "const-decl",
      name: "activeNames",
      init: "",
      forExpr: makeForExpr({
        variable: "item",
        iterable: "items",
        body: [
          {
            kind: "if-stmt",
            condition: "item . active",
            consequent: [makeLiftExpr("item . name")],
            alternate: null,
          },
        ],
      }),
    };
    const result = emitLogicNode(node, {});
    expect(result).toMatch(/let _scrml_tilde_\d+ = \[\];/);
    expect(result).toMatch(/for \(const item of items\)/);
    // The conditional should wrap the push
    expect(result).toMatch(/if \(item \. active\)/);
    expect(result).toMatch(/_scrml_tilde_\d+\.push\(item \. name\);/);
    expect(result).toMatch(/const activeNames = _scrml_tilde_\d+;/);
  });

  test("lift inside if-else: both branches push to the accumulator", () => {
    const node = {
      kind: "const-decl",
      name: "mapped",
      init: "",
      forExpr: makeForExpr({
        variable: "item",
        iterable: "items",
        body: [
          {
            kind: "if-stmt",
            condition: "item . ok",
            consequent: [makeLiftExpr("item . name")],
            alternate: [makeLiftExpr("\"unknown\"")],
          },
        ],
      }),
    };
    const result = emitLogicNode(node, {});
    expect(result).toMatch(/let _scrml_tilde_\d+ = \[\];/);
    // Both branches push
    const pushMatches = result.match(/_scrml_tilde_\d+\.push\(/g);
    expect(pushMatches).not.toBeNull();
    expect(pushMatches.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// §4: Nested for-as-expression
// ---------------------------------------------------------------------------

describe("emitLogicNode: nested for-as-expression", () => {
  test("for-as-expression with multiple lift statements in body", () => {
    // for (item of items) { lift item.a; lift item.b } → [item.a, item.a, item.b, item.b, ...]
    const node = {
      kind: "const-decl",
      name: "flat",
      init: "",
      forExpr: makeForExpr({
        variable: "item",
        iterable: "items",
        body: [
          makeLiftExpr("item . a"),
          makeLiftExpr("item . b"),
        ],
      }),
    };
    const result = emitLogicNode(node, {});
    expect(result).toMatch(/let _scrml_tilde_\d+ = \[\];/);
    const pushMatches = result.match(/_scrml_tilde_\d+\.push\(/g);
    expect(pushMatches).not.toBeNull();
    expect(pushMatches.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// §5: emitLogicBody integration: const-decl with forExpr (direct AST nodes)
// ---------------------------------------------------------------------------

describe("emitLogicBody: for-as-expression integration", () => {
  test("for-as-expression node emits full array accumulator block", () => {
    const nodes = [
      {
        kind: "const-decl",
        name: "names",
        init: "",
        forExpr: makeForExpr({
          variable: "item",
          iterable: "items",
          body: [makeLiftExpr("item . name")],
        }),
      },
    ];
    const results = emitLogicBody(nodes);
    expect(results).toHaveLength(1);
    const block = results[0];
    expect(block).toMatch(/let _scrml_tilde_\d+ = \[\];/);
    expect(block).toMatch(/for \(const item of items\)/);
    expect(block).toMatch(/_scrml_tilde_\d+\.push\(item \. name\);/);
    expect(block).toMatch(/const names = _scrml_tilde_\d+;/);
  });

  test("for-as-expression followed by ~ reference: ~ resolves to the array", () => {
    // const names = for (item of items) { lift item.name }
    // const upper = ~ .map(n => n.toUpperCase())
    const nodes = [
      {
        kind: "const-decl",
        name: "names",
        init: "",
        forExpr: makeForExpr({
          variable: "item",
          iterable: "items",
          body: [makeLiftExpr("item . name")],
        }),
      },
      {
        kind: "const-decl",
        name: "upper",
        init: "~ . map ( n => n . toUpperCase ( ) )",
      },
    ];
    const results = emitLogicBody(nodes);
    expect(results).toHaveLength(2);
    // First result is the for-as-expression block
    const tildeMatch = results[0].match(/let (_scrml_tilde_\d+) = \[\];/);
    expect(tildeMatch).not.toBeNull();
    const tildeVar = tildeMatch[1];
    // Second result substitutes the tilde var
    expect(results[1]).toContain(`${tildeVar} . map`);
  });

  test("two sequential for-as-expressions get distinct tilde vars", () => {
    const nodes = [
      {
        kind: "const-decl",
        name: "first",
        init: "",
        forExpr: makeForExpr({
          variable: "a",
          iterable: "listA",
          body: [makeLiftExpr("a . name")],
        }),
      },
      {
        kind: "const-decl",
        name: "second",
        init: "",
        forExpr: makeForExpr({
          variable: "b",
          iterable: "listB",
          body: [makeLiftExpr("b . id")],
        }),
      },
    ];
    const results = emitLogicBody(nodes);
    expect(results).toHaveLength(2);
    const tilde1 = results[0].match(/let (_scrml_tilde_\d+) = \[\];/)[1];
    const tilde2 = results[1].match(/let (_scrml_tilde_\d+) = \[\];/)[1];
    // Each for-as-expression gets its own tilde var
    expect(tilde1).not.toBe(tilde2);
  });
});

// ---------------------------------------------------------------------------
// §6: AST builder integration — parses for-as-expression from source
// ---------------------------------------------------------------------------

describe("AST builder: for-as-expression from source", () => {
  /**
   * Parse a scrml source string through BS -> TAB and return the AST result.
   */
  function parseSource(source) {
    const bsOut = splitBlocks("test.scrml", source);
    return buildAST(bsOut);
  }

  /**
   * Walk the AST recursively to find a node matching the predicate.
   */
  function findNode(nodes, predicate) {
    for (const n of (nodes ?? [])) {
      if (predicate(n)) return n;
      const found =
        findNode(n.body ?? [], predicate) ??
        findNode(n.children ?? [], predicate) ??
        findNode(n.logicBody ?? [], predicate);
      if (found) return found;
    }
    return null;
  }

  test("const names = for (item of items) { lift item.name } parses as const-decl with forExpr", () => {
    const source = `<program>
<div>
\${ const names = for (item of items) { lift item.name } }
</div>
</program>`;
    const result = parseSource(source);
    const ast = result.ast ?? result;
    expect(ast.errors?.length ?? 0).toBe(0);

    const constNode = findNode(ast.nodes ?? [], (n) => n.kind === "const-decl" && n.name === "names");
    expect(constNode).not.toBeNull();
    expect(constNode.forExpr).toBeDefined();
    expect(constNode.forExpr.kind).toBe("for-expr");
    expect(constNode.forExpr.variable).toBe("item");
    expect(Array.isArray(constNode.forExpr.body)).toBe(true);
    expect(constNode.forExpr.body.length).toBeGreaterThan(0);
    expect(constNode.forExpr.body[0].kind).toBe("lift-expr");
  });

  test("let names = for (x of list) { lift x } parses as let-decl with forExpr", () => {
    const source = `<program>
<div>
\${ let names = for (x of list) { lift x } }
</div>
</program>`;
    const result = parseSource(source);
    const ast = result.ast ?? result;
    expect(ast.errors?.length ?? 0).toBe(0);

    const letNode = findNode(ast.nodes ?? [], (n) => n.kind === "let-decl" && n.name === "names");
    expect(letNode).not.toBeNull();
    expect(letNode.forExpr).toBeDefined();
    expect(letNode.forExpr.variable).toBe("x");
  });

  test("for-as-expression with conditional lift parses correctly", () => {
    const source = `<program>
<div>
\${ const active = for (item of items) { if (item.ok) { lift item.name } } }
</div>
</program>`;
    const result = parseSource(source);
    const ast = result.ast ?? result;
    expect(ast.errors?.length ?? 0).toBe(0);

    const constNode = findNode(ast.nodes ?? [], (n) => n.kind === "const-decl" && n.name === "active");
    expect(constNode).not.toBeNull();
    expect(constNode.forExpr).toBeDefined();
    const body = constNode.forExpr.body;
    expect(body.length).toBeGreaterThan(0);
    // Body should contain an if-stmt
    expect(body[0].kind).toBe("if-stmt");
    // And the if-stmt body should contain a lift-expr
    expect(body[0].consequent?.[0]?.kind ?? body[0].body?.[0]?.kind).toBe("lift-expr");
  });
})
// ---------------------------------------------------------------------------
// §7: Regression — existing for-stmt behavior unchanged
// ---------------------------------------------------------------------------

describe("regression: existing for-stmt behavior unchanged", () => {
  test("standalone for-stmt (no forExpr) still emits correctly", () => {
    const node = {
      kind: "for-stmt",
      variable: "item",
      iterable: "items",
      body: [
        { kind: "bare-expr", expr: "console . log ( item )" },
      ],
    };
    const result = emitLogicNode(node, {});
    // Should be a plain for-of loop without tilde overhead
    expect(result).toMatch(/for \(const item of items\)/);
    expect(result).toContain("console . log ( item )");
    expect(result).not.toContain("_scrml_tilde_");
  });

  test("for-stmt in emitLogicBody without ~ reference emits normally", () => {
    const nodes = [
      {
        kind: "for-stmt",
        variable: "item",
        iterable: "items",
        body: [
          { kind: "bare-expr", expr: "process ( item )" },
        ],
      },
    ];
    const results = emitLogicBody(nodes);
    expect(results).toHaveLength(1);
    expect(results[0]).not.toContain("_scrml_tilde_");
    expect(results[0]).toContain("process ( item )");
  });

  test("value-lift in standalone for-stmt with ~ still produces array (existing behavior)", () => {
    // This tests the existing _emitForStmtWithTilde path — NOT the forExpr path
    const nodes = [
      {
        kind: "for-stmt",
        variable: "x",
        iterable: "( let x of items )",
        body: [makeLiftExpr("x . name")],
      },
      { kind: "const-decl", name: "names", init: "~" },
    ];
    const results = emitLogicBody(nodes);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatch(/let _scrml_tilde_\d+ = \[\];/);
    expect(results[0]).toMatch(/_scrml_tilde_\d+\.push\(x \. name\);/);
    const tildeVar = results[0].match(/let (_scrml_tilde_\d+)/)[1];
    expect(results[1]).toBe(`const names = ${tildeVar};`);
  });

  test("const-decl without forExpr or ifExpr still emits normally", () => {
    const node = { kind: "const-decl", name: "x", init: "42" };
    const result = emitLogicNode(node, {});
    expect(result).toBe("const x = 42;");
  });

  test("let-decl without forExpr or ifExpr still emits normally", () => {
    const node = { kind: "let-decl", name: "y", init: "\"hello\"" };
    const result = emitLogicNode(node, {});
    expect(result).toBe('let y = "hello";');
  });
});

// ---------------------------------------------------------------------------
// §8: destructuring LHS in a for-as-expression head
// (g-destructure-pattern-object-object-in-for-comprehension-emit, S310)
// ---------------------------------------------------------------------------
//
// The for-AS-EXPRESSION emit (`_emitForExprAsArray`, ~emit-logic.ts:4309) took
// `forExpr.variable ?? forExpr.name ?? "item"` — when the LHS is a destructuring
// pattern (`for (const {a} of @items)` / `for (const [x] of …)`) that variable is
// a DestructurePattern OBJECT, so `${varName}` String()-coerced it to
// `for (const [object Object] of …)` — a hard `node --check` failure. The
// statement/render for-copies already rendered the pattern via
// nameOrPatternText; the for-as-expression copy did not. The canonical
// parenthesized form emits the identical broken JS pre-fix (not braceless-specific).

describe("for-as-expression with a destructuring LHS renders the pattern (not [object Object])", () => {
  const objPattern = {
    kind: "destructure-object",
    properties: [{ kind: "name", fieldName: "a", bindName: "a" }],
  };
  const arrPattern = {
    kind: "destructure-array",
    elements: [{ kind: "name", name: "x" }],
  };

  test("object pattern `{a}` renders as `for (const { a } of …)`", () => {
    const node = {
      kind: "const-decl",
      name: "names",
      init: "",
      forExpr: makeForExpr({ variable: objPattern, iterable: "items", body: [makeLiftExpr("a")] }),
    };
    const result = emitLogicNode(node, {});
    expect(result).not.toContain("[object Object]");
    expect(result).toMatch(/for \(const \{ a \} of items\)/);
  });

  test("array pattern `[x]` renders as `for (const [x] of …)`", () => {
    const node = {
      kind: "const-decl",
      name: "xs",
      init: "",
      forExpr: makeForExpr({ variable: arrPattern, iterable: "items", body: [makeLiftExpr("x")] }),
    };
    const result = emitLogicNode(node, {});
    expect(result).not.toContain("[object Object]");
    expect(result).toMatch(/for \(const \[x\] of items\)/);
  });

  test("plain-string variable is unchanged (regression guard)", () => {
    const node = {
      kind: "const-decl",
      name: "names",
      init: "",
      forExpr: makeForExpr({ variable: "item", iterable: "items", body: [makeLiftExpr("item . a")] }),
    };
    const result = emitLogicNode(node, {});
    expect(result).toMatch(/for \(const item of items\)/);
  });
});
