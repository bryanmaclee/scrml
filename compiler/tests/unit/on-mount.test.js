/**
 * on mount {} — Named Mount Block (§6.7.1a)
 *
 * Tests that `on mount { body }` desugars to a bare-expr AST node at the TAB
 * stage. The emitted node is identical to a bare ${ expr } block. Downstream
 * stages see no difference.
 *
 * §1  Basic on mount parses to bare-expr node
 * §2  on mount body text is preserved as the expr field
 * §3  Multiple on mount blocks produce multiple bare-expr nodes in source order
 * §4  on mount inside a nested if block (parseOneStatement path)
 * §5  on mount with server function call
 * §6  on mount produces same AST kind as a direct bare expression
 * §7  on mount inside a component scope
 */

import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseSource(source, filePath = "/test/app.scrml") {
  const bsResult = splitBlocks(filePath, source);
  const tabResult = buildAST(bsResult);
  return tabResult;
}

/**
 * Walk AST nodes recursively, collecting all nodes of the given kind.
 */
function findNodes(nodes, kind) {
  const found = [];
  function walk(list) {
    for (const node of list) {
      if (!node) continue;
      if (node.kind === kind) found.push(node);
      if (Array.isArray(node.children)) walk(node.children);
      if (Array.isArray(node.body)) walk(node.body);
      if (Array.isArray(node.nodes)) walk(node.nodes);
    }
  }
  walk(Array.isArray(nodes) ? nodes : [nodes]);
  return found;
}

// ---------------------------------------------------------------------------
// §1: Basic on mount parses to bare-expr node
// ---------------------------------------------------------------------------

describe("§1: basic on mount", () => {
  test("on mount { loadData() } produces a bare-expr node", () => {
    // Note: \${ ... } is the scrml logic block sigil — escaped to avoid JS template interpolation
    const source = "<program>\n\${ on mount { loadData() } }\n</>";
    const { ast, errors } = parseSource(source);
    expect(errors).toHaveLength(0);
    const bareExprs = findNodes(ast.nodes, "bare-expr");
    expect(bareExprs.length).toBeGreaterThan(0);
  });

  test("on mount node has kind bare-expr", () => {
    const source = "<program>\n\${ on mount { loadData() } }\n</>";
    const { ast, errors } = parseSource(source);
    expect(errors).toHaveLength(0);
    const logicNodes = findNodes(ast.nodes, "logic");
    expect(logicNodes.length).toBeGreaterThan(0);
    const logic = logicNodes[0];
    const mountNode = logic.body?.find(n => n?.kind === "bare-expr");
    expect(mountNode).toBeDefined();
    expect(mountNode.kind).toBe("bare-expr");
  });
});

// ---------------------------------------------------------------------------
// §2: Body text is preserved
// ---------------------------------------------------------------------------

describe("§2: on mount body text is preserved", () => {
  test("body expression is stored in expr field", () => {
    const source = "<program>\n\${ on mount { fetchUsers() } }\n</>";
    const { ast, errors } = parseSource(source);
    expect(errors).toHaveLength(0);
    const logicNodes = findNodes(ast.nodes, "logic");
    const logic = logicNodes[0];
    const mountNode = logic.body?.find(n => n?.kind === "bare-expr");
    expect(mountNode).toBeDefined();
    expect(mountNode.expr).toContain("fetchUsers");
  });

  test("reactive assignment in body is preserved", () => {
    const source = "<program>\n\${ on mount { @loading = true } }\n</>";
    const { ast, errors } = parseSource(source);
    expect(errors).toHaveLength(0);
    const logicNodes = findNodes(ast.nodes, "logic");
    const logic = logicNodes[0];
    const mountNode = logic.body?.find(n => n?.kind === "bare-expr");
    expect(mountNode).toBeDefined();
    expect(mountNode.expr).toContain("@loading");
  });
});

// ---------------------------------------------------------------------------
// §3: Multiple on mount blocks execute in source order
// ---------------------------------------------------------------------------

describe("§3: multiple on mount blocks", () => {
  test("two on mount blocks produce two logic nodes with bare-expr", () => {
    const source = "<program>\n\${ on mount { initA() } }\n\${ on mount { initB() } }\n</>";
    const { ast, errors } = parseSource(source);
    expect(errors).toHaveLength(0);
    const logicNodes = findNodes(ast.nodes, "logic");
    expect(logicNodes.length).toBe(2);
    const node1 = logicNodes[0].body?.find(n => n?.kind === "bare-expr");
    const node2 = logicNodes[1].body?.find(n => n?.kind === "bare-expr");
    expect(node1?.expr).toContain("initA");
    expect(node2?.expr).toContain("initB");
  });

  test("three on mount blocks all present in source order", () => {
    const source = "<program>\n\${ on mount { step1() } }\n\${ on mount { step2() } }\n\${ on mount { step3() } }\n</>";
    const { ast, errors } = parseSource(source);
    expect(errors).toHaveLength(0);
    const logicNodes = findNodes(ast.nodes, "logic");
    expect(logicNodes.length).toBe(3);
    const exprs = logicNodes.map(l => l.body?.find(n => n?.kind === "bare-expr")?.expr);
    expect(exprs[0]).toContain("step1");
    expect(exprs[1]).toContain("step2");
    expect(exprs[2]).toContain("step3");
  });
});

// ---------------------------------------------------------------------------
// §4: on mount inside nested context (parseOneStatement path)
// ---------------------------------------------------------------------------

describe("§4: on mount inside nested context", () => {
  test("on mount nested inside if block (parseOneStatement path)", () => {
    // This exercises the parseOneStatement() detection path (not the outer loop).
    // The if body calls parseOneStatement() for each inner statement.
    const source = "<program>\n@show = true\n\${ if (@show) { on mount { innerInit() } } }\n</>";
    const { ast, errors } = parseSource(source);
    // Should parse without unexpected parse/syntax errors
    const unexpectedErrors = errors.filter(e => e.code && (e.code.includes("SYNTAX") || e.code.includes("PARSE")));
    expect(unexpectedErrors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §5: on mount with async/server calls
// ---------------------------------------------------------------------------

describe("§5: on mount with async calls", () => {
  test("on mount body can contain async function call", () => {
    // S123 Unit CC: bare `@users = []` at <program> body-top is now
    // E-WRITE-NOT-IN-LOGIC-CONTEXT. Migrated to structural form `<users> = []`
    // per §40.8 + §6.2 (declarations only auto-lift; writes are logic).
    const source = "<program>\n<users> = []\n\${ on mount { @users = fetchUsers() } }\n</>";
    const { ast, errors } = parseSource(source);
    expect(errors).toHaveLength(0);
    const logicNodes = findNodes(ast.nodes, "logic");
    const mountNode = logicNodes[1].body?.find(n => n?.kind === "bare-expr");
    expect(mountNode).toBeDefined();
    expect(mountNode.expr).toContain("fetchUsers");
  });

  test("on mount body preserves reactive assignment with server data", () => {
    // S123 Unit CC migration — see sibling test above.
    const source = "<program>\n<data> = []\n\${ on mount { @data = loadFromServer() } }\n</>";
    const { ast, errors } = parseSource(source);
    expect(errors).toHaveLength(0);
    const logicNodes = findNodes(ast.nodes, "logic");
    const mountNode = logicNodes[1].body?.find(n => n?.kind === "bare-expr");
    expect(mountNode).toBeDefined();
    expect(mountNode.expr).toContain("@data");
    expect(mountNode.expr).toContain("loadFromServer");
  });
});

// ---------------------------------------------------------------------------
// §6: on mount produces same AST kind as a direct bare expression
// ---------------------------------------------------------------------------

describe("§6: on mount is equivalent to bare expression", () => {
  test("on mount and bare expr produce the same node kind", () => {
    const sourceMount = "<program>\n\${ on mount { doSomething() } }\n</>";
    const sourceBare = "<program>\n\${ doSomething() }\n</>";

    const { ast: astMount, errors: errMount } = parseSource(sourceMount);
    const { ast: astBare, errors: errBare } = parseSource(sourceBare);

    expect(errMount).toHaveLength(0);
    expect(errBare).toHaveLength(0);

    const logicMount = findNodes(astMount.nodes, "logic");
    const logicBare = findNodes(astBare.nodes, "logic");

    const mountNode = logicMount[0]?.body?.find(n => n?.kind === "bare-expr");
    const bareNode = logicBare[0]?.body?.find(n => n?.kind === "bare-expr");

    expect(mountNode?.kind).toBe("bare-expr");
    expect(bareNode?.kind).toBe("bare-expr");
    // Both contain the function call expression
    expect(mountNode?.expr).toContain("doSomething");
    expect(bareNode?.expr).toContain("doSomething");
  });
});

// ---------------------------------------------------------------------------
// §7: on mount in component scope
// ---------------------------------------------------------------------------

describe("§7: on mount in component scope", () => {
  test("on mount parses without errors in component body", () => {
    const source = [
      "<program>",
      "<component UserList>",
      "  @users = []",
      "  \${ on mount { @users = loadUsers() } }",
      "  <ul>",
      "  /",
      "/component>",
      "/"
    ].join("\n");
    const { ast, errors } = parseSource(source);
    // No syntax/parse errors from on mount parsing
    const syntaxErrors = errors.filter(e => e.code && (e.code.includes("SYNTAX") || e.code.includes("PARSE")));
    expect(syntaxErrors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §6.7.1b: on dismount {} — desugars to cleanup(() => { body })
// ---------------------------------------------------------------------------

describe("§6.7.1b: on dismount {} lifecycle block", () => {
  function findBareExprs(ast) {
    const results = [];
    function walk(nodes) {
      for (const n of nodes || []) {
        if (n.kind === "bare-expr") results.push(n);
        if (n.body) walk(n.body);
        if (n.nodes) walk(n.nodes);
        if (n.children) walk(n.children);
      }
    }
    walk(ast.nodes);
    return results;
  }

  test("on dismount produces a bare-expr with cleanup()", () => {
    const source = "<program>\n" + "$" + "{ on dismount { saveState() } }\n</program>";
    const { ast } = parseSource(source);
    const bareExprs = findBareExprs(ast);
    expect(bareExprs.length).toBeGreaterThan(0);
    expect(bareExprs[0].expr).toContain("cleanup");
    expect(bareExprs[0].expr).toContain("saveState");
  });

  test("on dismount wraps body in cleanup(() => { ... })", () => {
    const source = "<program>\n" + "$" + "{ on dismount { ws.close() } }\n</program>";
    const { ast } = parseSource(source);
    const bareExprs = findBareExprs(ast);
    expect(bareExprs[0].expr).toContain("cleanup(() => {");
    expect(bareExprs[0].expr).toContain("ws");
  });

  test("on dismount and on mount can coexist", () => {
    const source = "<program>\n" + "$" + "{ on mount { loadData() }\non dismount { saveState() } }\n</program>";
    const { ast } = parseSource(source);
    const bareExprs = findBareExprs(ast);
    expect(bareExprs.length).toBe(2);
    expect(bareExprs[0].expr).toContain("loadData");
    expect(bareExprs[1].expr).toContain("cleanup");
    expect(bareExprs[1].expr).toContain("saveState");
  });
});
