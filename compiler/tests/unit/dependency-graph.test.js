/**
 * Dependency Graph Builder (DG) -- Unit Tests
 *
 * Tests for src/dependency-graph.ts (Stage 7).
 *
 * All inputs are constructed programmatically (no real file parsing).
 *
 * Coverage:
 *   T1  Two independent server calls -> no awaits edge between them
 *   T2  Dependent calls (B uses A's result) -> awaits edge A->B
 *   T3  hasLift annotation correct
 *   T4  E-LIFT-001 fires for independent lift-bearing nodes
 *   T5  E-LIFT-001 does NOT fire when awaits path exists
 *   T6  Valid parallel-fetch-then-sequential-lift pattern -> no error
 *   T7  E-DG-001 cycle detection
 *   T8  E-DG-002 unused reactive variable warning
 *   T9  DGNode kinds created correctly
 *   T10 Empty input produces empty graph
 */

import { describe, test, expect } from "bun:test";
import { runDG, DGError } from "../../src/dependency-graph.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function span(start, file = "/test/app.scrml") {
  return { file, start, end: start + 10, line: 1, col: start + 1 };
}

/**
 * Build a function-decl AST node.
 */
function makeFnDecl({ name, body = [], spanStart = 0, file = "/test/app.scrml", isServer = false }) {
  return {
    kind: "function-decl",
    name,
    params: [],
    body,
    isServer,
    span: span(spanStart, file),
  };
}

/**
 * Build a bare-expr AST node.
 */
function makeBareExpr(expr, spanStart = 0, file = "/test/app.scrml") {
  return {
    kind: "bare-expr",
    expr,
    span: span(spanStart, file),
  };
}

/**
 * Build a lift-expr AST node.
 */
function makeLiftExpr(spanStart = 0, file = "/test/app.scrml") {
  return {
    kind: "lift-expr",
    expr: { kind: "expr", expr: "value" },
    span: span(spanStart, file),
  };
}

/**
 * Build a reactive-decl AST node.
 */
function makeReactiveDecl(name, init = "", spanStart = 0, file = "/test/app.scrml") {
  return {
    kind: "state-decl",
    name,
    init,
    span: span(spanStart, file),
  };
}

/**
 * Build a sql AST node.
 */
function makeSqlNode(query = "SELECT 1", spanStart = 0, file = "/test/app.scrml") {
  return {
    kind: "sql",
    query,
    span: span(spanStart, file),
  };
}

/**
 * Build a logic block AST node containing body items.
 */
function makeLogicBlock(body, spanStart = 0, file = "/test/app.scrml") {
  return {
    kind: "logic",
    body,
    imports: body.filter(n => n.kind === "import-decl"),
    exports: [],
    typeDecls: [],
    components: [],
    span: span(spanStart, file),
  };
}

/**
 * Build a minimal FileAST.
 */
function makeFileAST(nodes, filePath = "/test/app.scrml") {
  return {
    filePath,
    nodes,
    imports: [],
    exports: [],
    components: [],
    typeDecls: [],
    spans: new Map(),
  };
}

/**
 * Build a RouteMap with function entries.
 * entries: Array<{ name, spanStart, file, boundary }>
 */
function makeRouteMap(entries = []) {
  const functions = new Map();
  for (const e of entries) {
    const file = e.file || "/test/app.scrml";
    const fnNodeId = `${file}::${e.spanStart}`;
    functions.set(fnNodeId, {
      functionNodeId: fnNodeId,
      boundary: e.boundary || "client",
      escalationReasons: [],
      generatedRouteName: e.boundary === "server" ? `__ri_route_${e.name}_1` : null,
      serverEntrySpan: e.boundary === "server" ? span(e.spanStart, file) : null,
    });
  }
  return { functions };
}

/**
 * Find edges between two DGNodes by their function names.
 */
function findEdgesBetween(depGraph, fromName, toName, edgeKind = null) {
  const fromNode = findNodeByName(depGraph, fromName);
  const toNode = findNodeByName(depGraph, toName);
  if (!fromNode || !toNode) return [];
  return depGraph.edges.filter(e =>
    e.from === fromNode.nodeId &&
    e.to === toNode.nodeId &&
    (edgeKind === null || e.kind === edgeKind)
  );
}

/**
 * Find a DGNode by function name (searches span start for matching nodes).
 */
function findNodeByName(depGraph, name) {
  for (const [, node] of depGraph.nodes) {
    if (node.kind === "function" && node._name === name) return node;
  }
  // Fallback: search by nodeId containing the name
  for (const [, node] of depGraph.nodes) {
    if (node.nodeId && node.nodeId.includes(name)) return node;
  }
  return null;
}

/**
 * Find all DGNodes of a given kind.
 */
function findNodesByKind(depGraph, kind) {
  const result = [];
  for (const [, node] of depGraph.nodes) {
    if (node.kind === kind) result.push(node);
  }
  return result;
}

/**
 * Find a DGNode by span start.
 */
function findNodeBySpanStart(depGraph, start) {
  for (const [, node] of depGraph.nodes) {
    if (node.span && node.span.start === start) return node;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Dependency Graph Builder (Stage 7)", () => {
  // T1: Two independent server calls -> no awaits edge between them
  test("T1: two independent server calls have no awaits edge between them", () => {
    // Two functions fetchA and fetchB that don't call each other
    const fetchA = makeFnDecl({ name: "fetchA", spanStart: 0 });
    const fetchB = makeFnDecl({ name: "fetchB", spanStart: 100 });

    const logicBlock = makeLogicBlock([fetchA, fetchB]);
    const fileAST = makeFileAST([logicBlock]);

    const routeMap = makeRouteMap([
      { name: "fetchA", spanStart: 0, boundary: "server" },
      { name: "fetchB", spanStart: 100, boundary: "server" },
    ]);

    const { depGraph, errors } = runDG({ files: [fileAST], routeMap });

    // Both should be DGNodes
    const fnNodes = findNodesByKind(depGraph, "function");
    expect(fnNodes.length).toBe(2);

    // No awaits edges between them (they are independent)
    const awaitsEdges = depGraph.edges.filter(e => e.kind === "awaits");
    // There should be no awaits edges connecting the two fn nodes to each other
    const fnNodeIds = new Set(fnNodes.map(n => n.nodeId));
    const interFnAwaits = awaitsEdges.filter(
      e => fnNodeIds.has(e.from) && fnNodeIds.has(e.to)
    );
    expect(interFnAwaits.length).toBe(0);
  });

  // T2: Dependent calls (B uses A's result) -> awaits edge A->B
  test("T2: dependent calls produce awaits edge from caller to server callee", () => {
    // fetchA is a server function. handler calls fetchA.
    const fetchA = makeFnDecl({ name: "fetchA", spanStart: 0 });
    const handler = makeFnDecl({
      name: "handler",
      spanStart: 200,
      body: [
        makeBareExpr("const result = fetchA()", 210),
      ],
    });

    const logicBlock = makeLogicBlock([fetchA, handler]);
    const fileAST = makeFileAST([logicBlock]);

    const routeMap = makeRouteMap([
      { name: "fetchA", spanStart: 0, boundary: "server" },
      { name: "handler", spanStart: 200, boundary: "client" },
    ]);

    const { depGraph, errors } = runDG({ files: [fileAST], routeMap });

    // Find the handler and fetchA DGNodes
    const handlerNode = findNodeBySpanStart(depGraph, 200);
    const fetchANode = findNodeBySpanStart(depGraph, 0);

    expect(handlerNode).not.toBeNull();
    expect(fetchANode).not.toBeNull();

    // There should be an 'awaits' edge from handler to fetchA
    const awaitsEdges = depGraph.edges.filter(
      e => e.from === handlerNode.nodeId &&
           e.to === fetchANode.nodeId &&
           e.kind === "awaits"
    );
    expect(awaitsEdges.length).toBe(1);
  });

  // T3: hasLift annotation correct
  test("T3: hasLift is true when lift-expr follows the node in logic block body", () => {
    // A function call followed by a lift-expr in the same logic block
    const fetchA = makeFnDecl({ name: "fetchA", spanStart: 0 });

    const logicBlock = makeLogicBlock([
      makeBareExpr("fetchA()", 50),
      makeLiftExpr(60),
    ], 0);
    const fileAST = makeFileAST([logicBlock]);

    const routeMap = makeRouteMap([
      { name: "fetchA", spanStart: 0, boundary: "server" },
    ]);

    // We need the bare-expr to get a DGNode too. But bare-exprs that are just
    // function calls within logic blocks don't directly become DGNodes by default.
    // The function DECLARATION gets a DGNode. Let's put the fetchA decl in the block.

    const logicBlock2 = makeLogicBlock([
      fetchA,
      makeLiftExpr(60),
    ], 0);
    const fileAST2 = makeFileAST([logicBlock2]);

    const { depGraph } = runDG({ files: [fileAST2], routeMap });

    const fnNode = findNodeBySpanStart(depGraph, 0);
    expect(fnNode).not.toBeNull();
    expect(fnNode.hasLift).toBe(true);
  });

  test("T3b: hasLift is false when no lift-expr follows the node", () => {
    const fetchA = makeFnDecl({ name: "fetchA", spanStart: 0 });
    const fetchB = makeFnDecl({ name: "fetchB", spanStart: 100 });

    const logicBlock = makeLogicBlock([fetchA, fetchB], 0);
    const fileAST = makeFileAST([logicBlock]);

    const routeMap = makeRouteMap([
      { name: "fetchA", spanStart: 0, boundary: "server" },
      { name: "fetchB", spanStart: 100, boundary: "server" },
    ]);

    const { depGraph } = runDG({ files: [fileAST], routeMap });

    const nodeA = findNodeBySpanStart(depGraph, 0);
    const nodeB = findNodeBySpanStart(depGraph, 100);
    expect(nodeA).not.toBeNull();
    expect(nodeB).not.toBeNull();
    expect(nodeA.hasLift).toBe(false);
    expect(nodeB.hasLift).toBe(false);
  });

  // T4: E-LIFT-001 fires for independent lift-bearing nodes
  test("T4: E-LIFT-001 fires for two independent nodes both with hasLift in same logic block", () => {
    // Two independent server functions, each followed by a lift-expr
    const fetchA = makeFnDecl({ name: "fetchA", spanStart: 0 });
    const fetchB = makeFnDecl({ name: "fetchB", spanStart: 100 });

    const logicBlock = makeLogicBlock([
      fetchA,
      makeLiftExpr(50),
      fetchB,
      makeLiftExpr(150),
    ], 0);
    const fileAST = makeFileAST([logicBlock]);

    const routeMap = makeRouteMap([
      { name: "fetchA", spanStart: 0, boundary: "server" },
      { name: "fetchB", spanStart: 100, boundary: "server" },
    ]);

    const { depGraph, errors } = runDG({ files: [fileAST], routeMap });

    // Both nodes should have hasLift: true
    const nodeA = findNodeBySpanStart(depGraph, 0);
    const nodeB = findNodeBySpanStart(depGraph, 100);
    expect(nodeA).not.toBeNull();
    expect(nodeB).not.toBeNull();
    expect(nodeA.hasLift).toBe(true);
    expect(nodeB.hasLift).toBe(true);

    // E-LIFT-001 should fire
    const liftErrors = errors.filter(e => e.code === "E-LIFT-001");
    expect(liftErrors.length).toBeGreaterThanOrEqual(1);
  });

  // T5: E-LIFT-001 does NOT fire when awaits path exists
  test("T5: E-LIFT-001 does not fire when awaits path connects the two lift-bearing nodes", () => {
    // fetchA is server, fetchB calls fetchA (so awaits edge fetchB->fetchA)
    const fetchA = makeFnDecl({ name: "fetchA", spanStart: 0 });
    const fetchB = makeFnDecl({
      name: "fetchB",
      spanStart: 100,
      body: [
        makeBareExpr("fetchA()", 110),
      ],
    });

    const logicBlock = makeLogicBlock([
      fetchA,
      makeLiftExpr(50),
      fetchB,
      makeLiftExpr(150),
    ], 0);
    const fileAST = makeFileAST([logicBlock]);

    const routeMap = makeRouteMap([
      { name: "fetchA", spanStart: 0, boundary: "server" },
      { name: "fetchB", spanStart: 100, boundary: "server" },
    ]);

    const { depGraph, errors } = runDG({ files: [fileAST], routeMap });

    // Both nodes should have hasLift: true
    const nodeA = findNodeBySpanStart(depGraph, 0);
    const nodeB = findNodeBySpanStart(depGraph, 100);
    expect(nodeA).not.toBeNull();
    expect(nodeB).not.toBeNull();
    expect(nodeA.hasLift).toBe(true);
    expect(nodeB.hasLift).toBe(true);

    // There should be an awaits edge from fetchB to fetchA
    const awaitsEdges = depGraph.edges.filter(e => e.kind === "awaits");
    expect(awaitsEdges.length).toBeGreaterThanOrEqual(1);

    // E-LIFT-001 should NOT fire (awaits path exists)
    const liftErrors = errors.filter(e => e.code === "E-LIFT-001");
    expect(liftErrors.length).toBe(0);
  });

  // T6: Valid parallel-fetch-then-sequential-lift pattern -> no error
  test("T6: parallel fetch then sequential lift pattern produces no E-LIFT-001", () => {
    // Two independent server functions with NO lift-expr following them directly.
    // Then a third function that calls both and has a lift after it.
    // Pattern: fetch both, then lift sequentially.
    const fetchA = makeFnDecl({ name: "fetchA", spanStart: 0 });
    const fetchB = makeFnDecl({ name: "fetchB", spanStart: 100 });

    // combine calls both but lift is only after combine
    const combine = makeFnDecl({
      name: "combine",
      spanStart: 200,
      body: [
        makeBareExpr("fetchA()", 210),
        makeBareExpr("fetchB()", 220),
      ],
    });

    const logicBlock = makeLogicBlock([
      fetchA,
      fetchB,
      combine,
      makeLiftExpr(300),
    ], 0);
    const fileAST = makeFileAST([logicBlock]);

    const routeMap = makeRouteMap([
      { name: "fetchA", spanStart: 0, boundary: "server" },
      { name: "fetchB", spanStart: 100, boundary: "server" },
      { name: "combine", spanStart: 200, boundary: "client" },
    ]);

    const { depGraph, errors } = runDG({ files: [fileAST], routeMap });

    // fetchA and fetchB should NOT have hasLift (no lift-expr directly after them)
    const nodeA = findNodeBySpanStart(depGraph, 0);
    const nodeB = findNodeBySpanStart(depGraph, 100);
    expect(nodeA).not.toBeNull();
    expect(nodeB).not.toBeNull();
    expect(nodeA.hasLift).toBe(false);
    expect(nodeB.hasLift).toBe(false);

    // combine should have hasLift: true (lift-expr follows it)
    const nodeC = findNodeBySpanStart(depGraph, 200);
    expect(nodeC).not.toBeNull();
    expect(nodeC.hasLift).toBe(true);

    // No E-LIFT-001 (only one node has hasLift in this block)
    const liftErrors = errors.filter(e => e.code === "E-LIFT-001");
    expect(liftErrors.length).toBe(0);
  });

  // T7: Cycle detection (E-DG-001)
  test("T7: E-DG-001 fires for cyclic awaits dependency", () => {
    // funcA calls funcB (server), funcB calls funcA (server) => cycle
    const funcA = makeFnDecl({
      name: "funcA",
      spanStart: 0,
      body: [makeBareExpr("funcB()", 10)],
    });
    const funcB = makeFnDecl({
      name: "funcB",
      spanStart: 100,
      body: [makeBareExpr("funcA()", 110)],
    });

    const logicBlock = makeLogicBlock([funcA, funcB]);
    const fileAST = makeFileAST([logicBlock]);

    const routeMap = makeRouteMap([
      { name: "funcA", spanStart: 0, boundary: "server" },
      { name: "funcB", spanStart: 100, boundary: "server" },
    ]);

    const { errors } = runDG({ files: [fileAST], routeMap });

    const cycleErrors = errors.filter(e => e.code === "E-DG-001");
    expect(cycleErrors.length).toBe(1);
  });

  // T8: E-DG-002 unused reactive variable
  test("T8: E-DG-002 warning for unreferenced reactive variable", () => {
    const reactive = makeReactiveDecl("count", "0", 0);
    const logicBlock = makeLogicBlock([reactive]);
    const fileAST = makeFileAST([logicBlock]);
    const routeMap = makeRouteMap([]);

    const { errors } = runDG({ files: [fileAST], routeMap });

    const warnings = errors.filter(e => e.code === "E-DG-002");
    expect(warnings.length).toBe(1);
    expect(warnings[0].severity).toBe("warning");
    expect(warnings[0].message).toContain("@count");
  });

  // T9: DGNode kinds
  test("T9: correct DGNode kinds are created for different AST node types", () => {
    const fnDecl = makeFnDecl({ name: "myFunc", spanStart: 0 });
    const reactive = makeReactiveDecl("count", "0", 100);
    const sql = makeSqlNode("SELECT * FROM users", 200);

    const logicBlock = makeLogicBlock([fnDecl, reactive, sql]);
    const fileAST = makeFileAST([logicBlock]);
    const routeMap = makeRouteMap([
      { name: "myFunc", spanStart: 0, boundary: "client" },
    ]);

    const { depGraph } = runDG({ files: [fileAST], routeMap });

    const fnNodes = findNodesByKind(depGraph, "function");
    const reactiveNodes = findNodesByKind(depGraph, "reactive");
    const sqlNodes = findNodesByKind(depGraph, "sql-query");

    expect(fnNodes.length).toBe(1);
    expect(fnNodes[0].boundary).toBe("client");

    expect(reactiveNodes.length).toBe(1);
    expect(reactiveNodes[0].varName).toBe("count");

    expect(sqlNodes.length).toBe(1);
    expect(sqlNodes[0].query).toBe("SELECT * FROM users");
  });

  // T10: Empty input
  test("T10: empty input produces empty graph with no errors", () => {
    const { depGraph, errors } = runDG({ files: [], routeMap: { functions: new Map() } });

    expect(depGraph.nodes.size).toBe(0);
    expect(depGraph.edges.length).toBe(0);
    expect(errors.length).toBe(0);
  });

  // Additional: client function call produces 'calls' edge, not 'awaits'
  test("client function call produces calls edge, not awaits", () => {
    const helper = makeFnDecl({ name: "helper", spanStart: 0 });
    const main = makeFnDecl({
      name: "main",
      spanStart: 100,
      body: [makeBareExpr("helper()", 110)],
    });

    const logicBlock = makeLogicBlock([helper, main]);
    const fileAST = makeFileAST([logicBlock]);

    const routeMap = makeRouteMap([
      { name: "helper", spanStart: 0, boundary: "client" },
      { name: "main", spanStart: 100, boundary: "client" },
    ]);

    const { depGraph } = runDG({ files: [fileAST], routeMap });

    const mainNode = findNodeBySpanStart(depGraph, 100);
    const helperNode = findNodeBySpanStart(depGraph, 0);
    expect(mainNode).not.toBeNull();
    expect(helperNode).not.toBeNull();

    const callEdges = depGraph.edges.filter(
      e => e.from === mainNode.nodeId &&
           e.to === helperNode.nodeId &&
           e.kind === "calls"
    );
    expect(callEdges.length).toBe(1);

    // No awaits edge
    const awaitsEdges = depGraph.edges.filter(
      e => e.from === mainNode.nodeId &&
           e.to === helperNode.nodeId &&
           e.kind === "awaits"
    );
    expect(awaitsEdges.length).toBe(0);
  });

  // Additional: DGNode has all required fields
  test("DGNode function has all required fields", () => {
    const fn = makeFnDecl({ name: "test", spanStart: 42 });
    const logicBlock = makeLogicBlock([fn]);
    const fileAST = makeFileAST([logicBlock]);
    const routeMap = makeRouteMap([
      { name: "test", spanStart: 42, boundary: "server" },
    ]);

    const { depGraph } = runDG({ files: [fileAST], routeMap });
    const fnNodes = findNodesByKind(depGraph, "function");
    expect(fnNodes.length).toBe(1);

    const node = fnNodes[0];
    expect(node.kind).toBe("function");
    expect(node.nodeId).toBeDefined();
    expect(typeof node.nodeId).toBe("string");
    expect(node.boundary).toBe("server");
    expect(typeof node.hasLift).toBe("boolean");
    expect(node.span).toBeDefined();
    expect(node.span.start).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// E-DG-002 false positive regression — markup interpolation consumption
// ---------------------------------------------------------------------------

describe("E-DG-002 — markup interpolation counts as consumption", () => {
  // Helper: build a markup node with a logic child referencing @var
  function makeMarkupWithInterpolation(varName, spanStart = 0, file = "/test/app.scrml") {
    return {
      kind: "markup",
      tag: "span",
      attrs: [],
      children: [
        {
          kind: "logic",
          body: [{ kind: "bare-expr", expr: `@${varName}`, span: { file, start: spanStart + 10, end: spanStart + 20, line: 1, col: 1 } }],
          span: { file, start: spanStart + 5, end: spanStart + 25, line: 1, col: 1 },
        },
      ],
      span: { file, start: spanStart, end: spanStart + 30, line: 1, col: 1 },
    };
  }

  test("T11: @var used in markup interpolation does NOT produce E-DG-002", () => {
    const reactive = makeReactiveDecl("counter", "0", 0);
    const logicBlock = makeLogicBlock([reactive]);
    const markup = makeMarkupWithInterpolation("counter", 50);
    const fileAST = makeFileAST([logicBlock, markup]);
    const routeMap = makeRouteMap([]);

    const { errors } = runDG({ files: [fileAST], routeMap });
    const dg002 = errors.filter(e => e.code === "E-DG-002");
    expect(dg002.length).toBe(0);
  });

  test("T12: @var used ONLY in function body still counts (no false positive)", () => {
    const reactive = makeReactiveDecl("total", "0", 0);
    const reader = makeFnDecl({ name: "showTotal", spanStart: 10,
      body: [makeBareExpr("@total > 0", 20)] });
    const logicBlock = makeLogicBlock([reactive, reader]);
    const fileAST = makeFileAST([logicBlock]);
    const routeMap = makeRouteMap([{ name: "showTotal", spanStart: 10, boundary: "client" }]);

    const { errors } = runDG({ files: [fileAST], routeMap });
    const dg002 = errors.filter(e => e.code === "E-DG-002");
    expect(dg002.length).toBe(0);
  });

  test("T13: @var with no consumption anywhere still produces E-DG-002", () => {
    const reactive = makeReactiveDecl("unused", "0", 0);
    const logicBlock = makeLogicBlock([reactive]);
    const fileAST = makeFileAST([logicBlock]);
    const routeMap = makeRouteMap([]);

    const { errors } = runDG({ files: [fileAST], routeMap });
    const dg002 = errors.filter(e => e.code === "E-DG-002");
    expect(dg002.length).toBe(1);
    expect(dg002[0].message).toContain("@unused");
  });

  test("T14: bind:value attribute (variable-ref object) marks @var as consumed", () => {
    const reactive = makeReactiveDecl("name", '""', 0);
    const logicBlock = makeLogicBlock([reactive]);
    // Markup node with bind:value={kind:"variable-ref", name:"@name"}
    const inputNode = {
      kind: "markup",
      tag: "input",
      attrs: [{ name: "bind:value", value: { kind: "variable-ref", name: "@name" } }],
      children: [],
      span: { file: "/test/app.scrml", start: 50, end: 80, line: 2, col: 1 },
    };
    const fileAST = makeFileAST([logicBlock, inputNode]);
    const routeMap = makeRouteMap([]);

    const { errors } = runDG({ files: [fileAST], routeMap });
    const dg002 = errors.filter(e => e.code === "E-DG-002");
    expect(dg002.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// E-DG-002 false positive regression — meta block body consumption
// ---------------------------------------------------------------------------

describe("E-DG-002 — meta block body counts as consumption", () => {
  // Helper: build a meta node with a bare-expr referencing @var in its body.
  // This models a ^{} block that reads a reactive variable.
  function makeMetaBlock(varName, spanStart = 0, file = "/test/app.scrml") {
    return {
      kind: "meta",
      parentContext: "markup",
      body: [
        {
          kind: "bare-expr",
          expr: `@${varName}`,
          span: { file, start: spanStart + 5, end: spanStart + 15, line: 1, col: 1 },
        },
      ],
      span: { file, start: spanStart, end: spanStart + 20, line: 1, col: 1 },
    };
  }

  test("T15: @var consumed ONLY inside ^{} meta block does NOT produce E-DG-002", () => {
    // Scenario: developer declares @count and reads it exclusively inside a ^{} block.
    // The DG pass must walk into the meta node body to find the consumption.
    const reactive = makeReactiveDecl("count", "0", 0);
    const logicBlock = makeLogicBlock([reactive]);
    const metaNode = makeMetaBlock("count", 50);
    const fileAST = makeFileAST([logicBlock, metaNode]);
    const routeMap = makeRouteMap([]);

    const { errors } = runDG({ files: [fileAST], routeMap });
    const dg002 = errors.filter(e => e.code === "E-DG-002");
    expect(dg002.length).toBe(0);
  });

  test("T16: @var consumed in both meta block and markup — no E-DG-002", () => {
    // @title is read in ^{} and also in a markup interpolation.
    // Should not produce E-DG-002 regardless of which reader the DG finds first.
    const reactive = makeReactiveDecl("title", '""', 0);
    const logicBlock = makeLogicBlock([reactive]);
    const metaNode = makeMetaBlock("title", 50);
    const markupNode = {
      kind: "markup",
      tag: "h1",
      attrs: [],
      children: [
        {
          kind: "logic",
          body: [{ kind: "bare-expr", expr: "@title", span: { file: "/test/app.scrml", start: 80, end: 90, line: 1, col: 1 } }],
          span: { file: "/test/app.scrml", start: 75, end: 95, line: 1, col: 1 },
        },
      ],
      span: { file: "/test/app.scrml", start: 70, end: 100, line: 2, col: 1 },
    };
    const fileAST = makeFileAST([logicBlock, metaNode, markupNode]);
    const routeMap = makeRouteMap([]);

    const { errors } = runDG({ files: [fileAST], routeMap });
    const dg002 = errors.filter(e => e.code === "E-DG-002");
    expect(dg002.length).toBe(0);
  });

  test("T17: @var declared but NOT consumed (meta block reads a DIFFERENT var) — E-DG-002 fires", () => {
    // @orphan is declared. A meta block reads @otherVar (not @orphan).
    // @orphan has no readers anywhere — E-DG-002 should fire for @orphan,
    // but NOT for @otherVar (which is never declared as reactive).
    const reactive = makeReactiveDecl("orphan", "42", 0);
    const logicBlock = makeLogicBlock([reactive]);
    // Meta block reads @otherVar — orphan remains unread
    const metaNode = makeMetaBlock("otherVar", 50);
    const fileAST = makeFileAST([logicBlock, metaNode]);
    const routeMap = makeRouteMap([]);

    const { errors } = runDG({ files: [fileAST], routeMap });
    const dg002 = errors.filter(e => e.code === "E-DG-002");
    expect(dg002.length).toBe(1);
    expect(dg002[0].message).toContain("@orphan");
  });
});

// ---------------------------------------------------------------------------
// T11: DG deep traversal — @var refs inside control flow (Batch 1 R13 #9)
// ---------------------------------------------------------------------------

describe("T11 — DG deep traversal: @var refs inside control flow", () => {
  test("@var inside match arm body produces reads edge", () => {
    const reactiveDecl = makeReactiveDecl("count", "0", 0);
    const fnDecl = makeFnDecl({
      name: "handleMatch",
      spanStart: 20,
      body: [
        {
          kind: "match-stmt",
          header: "status",
          body: [
            makeBareExpr(".Active => render(@count)", 30),
            makeBareExpr("else => null", 35),
          ],
          span: span(25),
        },
      ],
    });
    const logic = makeLogicBlock([reactiveDecl, fnDecl]);
    const fileAST = makeFileAST([logic]);
    const routeMap = makeRouteMap([{ name: "handleMatch", spanStart: 20, boundary: "client" }]);
    const { depGraph } = runDG({ files: [fileAST], routeMap, protectAnalysis: { protectedFields: new Map() } });

    const edges = depGraph.edges.filter(e => e.kind === "reads");
    expect(edges.length).toBeGreaterThanOrEqual(1);
  });

  test("@var inside if-stmt consequent produces reads edge", () => {
    const reactiveDecl = makeReactiveDecl("visible", "true", 0);
    const fnDecl = makeFnDecl({
      name: "checkVisibility",
      spanStart: 20,
      body: [
        {
          kind: "if-stmt",
          condition: "flag",
          consequent: [makeBareExpr("show(@visible)", 30)],
          alternate: [],
          span: span(25),
        },
      ],
    });
    const logic = makeLogicBlock([reactiveDecl, fnDecl]);
    const fileAST = makeFileAST([logic]);
    const routeMap = makeRouteMap([{ name: "checkVisibility", spanStart: 20, boundary: "client" }]);
    const { depGraph } = runDG({ files: [fileAST], routeMap, protectAnalysis: { protectedFields: new Map() } });

    const edges = depGraph.edges.filter(e => e.kind === "reads");
    expect(edges.length).toBeGreaterThanOrEqual(1);
  });

  test("@var inside for-stmt body produces reads edge", () => {
    const reactiveDecl = makeReactiveDecl("total", "0", 0);
    const fnDecl = makeFnDecl({
      name: "sumItems",
      spanStart: 20,
      body: [
        {
          kind: "for-stmt",
          init: "let i = 0",
          condition: "i < items.length",
          update: "i++",
          body: [makeBareExpr("@total = @total + items[i]", 30)],
          span: span(25),
        },
      ],
    });
    const logic = makeLogicBlock([reactiveDecl, fnDecl]);
    const fileAST = makeFileAST([logic]);
    const routeMap = makeRouteMap([{ name: "sumItems", spanStart: 20, boundary: "client" }]);
    const { depGraph } = runDG({ files: [fileAST], routeMap, protectAnalysis: { protectedFields: new Map() } });

    const edges = depGraph.edges.filter(e => e.kind === "reads");
    expect(edges.length).toBeGreaterThanOrEqual(1);
  });

  test("@var inside nested match inside if produces reads edge (deep nesting)", () => {
    const reactiveDecl = makeReactiveDecl("score", "0", 0);
    const fnDecl = makeFnDecl({
      name: "deepNesting",
      spanStart: 20,
      body: [
        {
          kind: "if-stmt",
          condition: "active",
          consequent: [
            {
              kind: "match-stmt",
              header: "level",
              body: [
                makeBareExpr(".High => update(@score)", 40),
                makeBareExpr("else => null", 45),
              ],
              span: span(30),
            },
          ],
          alternate: [],
          span: span(25),
        },
      ],
    });
    const logic = makeLogicBlock([reactiveDecl, fnDecl]);
    const fileAST = makeFileAST([logic]);
    const routeMap = makeRouteMap([{ name: "deepNesting", spanStart: 20, boundary: "client" }]);
    const { depGraph } = runDG({ files: [fileAST], routeMap, protectAnalysis: { protectedFields: new Map() } });

    const edges = depGraph.edges.filter(e => e.kind === "reads");
    expect(edges.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// E-DG-002 false positive regression — for-loop iterable consumption
// ---------------------------------------------------------------------------

describe("E-DG-002 — for-loop iterable counts as consumption", () => {
  test("T18: @var consumed in for-loop iterable position does NOT produce E-DG-002", () => {
    // `for item of @items` — the iterable field contains @items.
    const reactive = makeReactiveDecl("items", "[]", 0);
    const logicBlock = makeLogicBlock([reactive]);
    const forNode = {
      kind: "for-stmt",
      variable: "item",
      iterable: "@items",
      body: [],
      span: { file: "/test/app.scrml", start: 50, end: 80, line: 2, col: 1 },
    };
    // Wrap the for-stmt in a logic block so it appears in the AST tree
    const outerLogic = {
      kind: "logic",
      body: [forNode],
      imports: [],
      exports: [],
      typeDecls: [],
      components: [],
      span: { file: "/test/app.scrml", start: 45, end: 85, line: 2, col: 1 },
    };
    const fileAST = makeFileAST([logicBlock, outerLogic]);
    const routeMap = makeRouteMap([]);

    const { errors } = runDG({ files: [fileAST], routeMap });
    const dg002 = errors.filter(e => e.code === "E-DG-002");
    expect(dg002.length).toBe(0);
  });

  test("T19: @var consumed in for-loop body does NOT produce E-DG-002", () => {
    // `for item of list { doSomething(@count) }` — @count is in the body.
    const reactive = makeReactiveDecl("count", "0", 0);
    const logicBlock = makeLogicBlock([reactive]);
    const forNode = {
      kind: "for-stmt",
      variable: "item",
      iterable: "list",
      body: [
        {
          kind: "bare-expr",
          expr: "doSomething(@count)",
          span: { file: "/test/app.scrml", start: 60, end: 75, line: 3, col: 1 },
        },
      ],
      span: { file: "/test/app.scrml", start: 50, end: 80, line: 2, col: 1 },
    };
    const outerLogic = {
      kind: "logic",
      body: [forNode],
      imports: [],
      exports: [],
      typeDecls: [],
      components: [],
      span: { file: "/test/app.scrml", start: 45, end: 85, line: 2, col: 1 },
    };
    const fileAST = makeFileAST([logicBlock, outerLogic]);
    const routeMap = makeRouteMap([]);

    const { errors } = runDG({ files: [fileAST], routeMap });
    const dg002 = errors.filter(e => e.code === "E-DG-002");
    expect(dg002.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// E-DG-002 false positive regression — lift expression consumption
// ---------------------------------------------------------------------------

describe("E-DG-002 — lift expression counts as consumption", () => {
  test("T20: @var consumed in lift expression target does NOT produce E-DG-002", () => {
    // `lift @total` — the LiftTarget is { kind: "expr", expr: "@total" }
    const reactive = makeReactiveDecl("total", "0", 0);
    const logicBlock = makeLogicBlock([reactive]);
    const liftNode = {
      kind: "lift-expr",
      expr: { kind: "expr", expr: "@total" },
      span: { file: "/test/app.scrml", start: 50, end: 70, line: 2, col: 1 },
    };
    const outerLogic = {
      kind: "logic",
      body: [liftNode],
      imports: [],
      exports: [],
      typeDecls: [],
      components: [],
      span: { file: "/test/app.scrml", start: 45, end: 75, line: 2, col: 1 },
    };
    const fileAST = makeFileAST([logicBlock, outerLogic]);
    const routeMap = makeRouteMap([]);

    const { errors } = runDG({ files: [fileAST], routeMap });
    const dg002 = errors.filter(e => e.code === "E-DG-002");
    expect(dg002.length).toBe(0);
  });

  test("T21: @var consumed in lift markup target does NOT produce E-DG-002", () => {
    // `lift <span>${@label}</span>` — the LiftTarget is { kind: "markup", node: ... }
    // where the markup node has a child logic block referencing @label.
    const reactive = makeReactiveDecl("label", '""', 0);
    const logicBlock = makeLogicBlock([reactive]);
    const liftNode = {
      kind: "lift-expr",
      expr: {
        kind: "markup",
        node: {
          kind: "markup",
          tag: "span",
          attrs: [],
          children: [
            {
              kind: "logic",
              body: [
                {
                  kind: "bare-expr",
                  expr: "@label",
                  span: { file: "/test/app.scrml", start: 60, end: 70, line: 2, col: 1 },
                },
              ],
              span: { file: "/test/app.scrml", start: 55, end: 75, line: 2, col: 1 },
            },
          ],
          span: { file: "/test/app.scrml", start: 50, end: 80, line: 2, col: 1 },
        },
      },
      span: { file: "/test/app.scrml", start: 48, end: 82, line: 2, col: 1 },
    };
    const outerLogic = {
      kind: "logic",
      body: [liftNode],
      imports: [],
      exports: [],
      typeDecls: [],
      components: [],
      span: { file: "/test/app.scrml", start: 45, end: 85, line: 2, col: 1 },
    };
    const fileAST = makeFileAST([logicBlock, outerLogic]);
    const routeMap = makeRouteMap([]);

    const { errors } = runDG({ files: [fileAST], routeMap });
    const dg002 = errors.filter(e => e.code === "E-DG-002");
    expect(dg002.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// T12: DG deep traversal — match arm body and header @var scanning
// ---------------------------------------------------------------------------

describe("T12 — DG deep traversal: match arm and header @var refs", () => {
  test("@var in match arm body — no false E-DG-002", () => {
    const reactiveDecl = makeReactiveDecl("status", "idle", 0);
    const fnDecl = makeFnDecl({
      name: "renderStatus", spanStart: 20,
      body: [{
        kind: "match-stmt", header: "mode",
        body: [makeBareExpr(".Loading => showSpinner(@status)", 30), makeBareExpr(".Done => showResult(@status)", 35), makeBareExpr("else => null", 40)],
        span: span(25),
      }],
    });
    const logic = makeLogicBlock([reactiveDecl, fnDecl]);
    const fileAST = makeFileAST([logic]);
    const routeMap = makeRouteMap([{ name: "renderStatus", spanStart: 20, boundary: "client" }]);
    const { depGraph, errors } = runDG({ files: [fileAST], routeMap });
    expect(depGraph.edges.filter(e => e.kind === "reads").length).toBeGreaterThanOrEqual(1);
    expect(errors.filter(e => e.code === "E-DG-002").length).toBe(0);
  });

  test("@var in match header expression — no false E-DG-002", () => {
    const reactiveDecl = makeReactiveDecl("mode", "light", 0);
    const fnDecl = makeFnDecl({
      name: "themeSwitch", spanStart: 20,
      body: [{
        kind: "match-stmt", header: "@mode",
        body: [makeBareExpr(".Light => applyLight()", 30), makeBareExpr(".Dark => applyDark()", 35)],
        span: span(25),
      }],
    });
    const logic = makeLogicBlock([reactiveDecl, fnDecl]);
    const fileAST = makeFileAST([logic]);
    const routeMap = makeRouteMap([{ name: "themeSwitch", spanStart: 20, boundary: "client" }]);
    const { depGraph, errors } = runDG({ files: [fileAST], routeMap });
    expect(depGraph.edges.filter(e => e.kind === "reads").length).toBeGreaterThanOrEqual(1);
    expect(errors.filter(e => e.code === "E-DG-002").length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// T13: DG deep traversal — function call tracing
// ---------------------------------------------------------------------------

describe("T13 — DG deep traversal: function call graph tracing", () => {
  test("function reads @var, called from markup — dependency edge exists", () => {
    const reactiveDecl = makeReactiveDecl("count", "0", 0);
    const fnDecl = makeFnDecl({ name: "getCount", spanStart: 20, body: [makeBareExpr("return @count", 30)] });
    const markup = { kind: "markup", tag: "span", attrs: [], children: [{ kind: "logic", body: [makeBareExpr("getCount()", 50)], span: span(45) }], span: span(40) };
    const logic = makeLogicBlock([reactiveDecl, fnDecl]);
    const fileAST = makeFileAST([logic, markup]);
    const routeMap = makeRouteMap([{ name: "getCount", spanStart: 20, boundary: "client" }]);
    const { depGraph, errors } = runDG({ files: [fileAST], routeMap });
    expect(depGraph.edges.filter(e => e.kind === "reads").length).toBeGreaterThanOrEqual(1);
    expect(errors.filter(e => e.code === "E-DG-002").length).toBe(0);
  });

  test("transitive: fn1() calls fn2() which reads @var — dependency traced", () => {
    const reactiveDecl = makeReactiveDecl("score", "0", 0);
    const fn2 = makeFnDecl({ name: "computeScore", spanStart: 20, body: [makeBareExpr("return @score * 2", 30)] });
    const fn1 = makeFnDecl({ name: "displayScore", spanStart: 100, body: [makeBareExpr("return computeScore()", 110)] });
    const markup = { kind: "markup", tag: "div", attrs: [], children: [{ kind: "logic", body: [makeBareExpr("displayScore()", 200)], span: span(195) }], span: span(190) };
    const logic = makeLogicBlock([reactiveDecl, fn2, fn1]);
    const fileAST = makeFileAST([logic, markup]);
    const routeMap = makeRouteMap([{ name: "computeScore", spanStart: 20, boundary: "client" }, { name: "displayScore", spanStart: 100, boundary: "client" }]);
    const { depGraph, errors } = runDG({ files: [fileAST], routeMap });
    expect(depGraph.edges.filter(e => e.kind === "reads").length).toBeGreaterThanOrEqual(2);
    expect(errors.filter(e => e.code === "E-DG-002").length).toBe(0);
  });

  test("function NOT reading @var — no false reads edge, E-DG-002 fires", () => {
    const reactiveDecl = makeReactiveDecl("unused", "0", 0);
    const fnDecl = makeFnDecl({ name: "pureFunc", spanStart: 20, body: [makeBareExpr("return 42", 30)] });
    const logic = makeLogicBlock([reactiveDecl, fnDecl]);
    const fileAST = makeFileAST([logic]);
    const routeMap = makeRouteMap([{ name: "pureFunc", spanStart: 20, boundary: "client" }]);
    const { depGraph, errors } = runDG({ files: [fileAST], routeMap });
    expect(depGraph.edges.filter(e => e.kind === "reads").length).toBe(0);
    expect(errors.filter(e => e.code === "E-DG-002").length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// T14: DG deep traversal — regression guards
// ---------------------------------------------------------------------------

describe("T14 — DG deep traversal: regression guards", () => {
  test("truly unused reactive var still produces E-DG-002", () => {
    const reactive = makeReactiveDecl("orphan", "0", 0);
    const fileAST = makeFileAST([makeLogicBlock([reactive])]);
    const { errors } = runDG({ files: [fileAST], routeMap: makeRouteMap([]) });
    const dg002 = errors.filter(e => e.code === "E-DG-002");
    expect(dg002.length).toBe(1);
    expect(dg002[0].message).toContain("@orphan");
  });

  test("multiple @vars — used ones no E-DG-002, unused one gets E-DG-002", () => {
    const used1 = makeReactiveDecl("name", "''", 0);
    const used2 = makeReactiveDecl("age", "0", 10);
    const unused = makeReactiveDecl("temp", "null", 20);
    const fnDecl = makeFnDecl({ name: "render", spanStart: 30, body: [makeBareExpr("display(@name, @age)", 40)] });
    const logic = makeLogicBlock([used1, used2, unused, fnDecl]);
    const fileAST = makeFileAST([logic]);
    const routeMap = makeRouteMap([{ name: "render", spanStart: 30, boundary: "client" }]);
    const { errors } = runDG({ files: [fileAST], routeMap });
    const dg002 = errors.filter(e => e.code === "E-DG-002");
    expect(dg002.length).toBe(1);
    expect(dg002[0].message).toContain("@temp");
  });
});

// ---------------------------------------------------------------------------
// T15: DG deep traversal — derived value (const @var = expr) dep tracking
// ---------------------------------------------------------------------------

describe("T15 — derived value (const @var = expr) dependency tracking", () => {
  function makeDerivedDecl(name, init, spanStart = 0, file = "/test/app.scrml") {
    return {
      kind: "reactive-derived-decl",
      name,
      init,
      span: span(spanStart, file),
    };
  }

  test("derived decl creates DG node with reads edge to source @var", () => {
    const events = makeReactiveDecl("events", "[]", 0);
    const filtered = makeDerivedDecl("filtered", "@events", 20);
    const logic = makeLogicBlock([events, filtered]);
    const fileAST = makeFileAST([logic]);
    const routeMap = makeRouteMap([]);

    const { depGraph, errors } = runDG({ files: [fileAST], routeMap });

    const reactiveNodes = findNodesByKind(depGraph, "reactive");
    expect(reactiveNodes.length).toBe(2);
    const filteredNode = reactiveNodes.find(n => n.varName === "filtered");
    const eventsNode = reactiveNodes.find(n => n.varName === "events");
    expect(filteredNode).toBeDefined();
    expect(eventsNode).toBeDefined();

    const readsEdges = depGraph.edges.filter(
      e => e.from === filteredNode.nodeId && e.to === eventsNode.nodeId && e.kind === "reads"
    );
    expect(readsEdges.length).toBe(1);
  });

  test("derived with match arms reads ALL @vars in the init expression", () => {
    const events = makeReactiveDecl("events", "[]", 0);
    const level = makeReactiveDecl("level", '"Error"', 10);
    const filtered = makeDerivedDecl(
      "filtered",
      'match @level { . Error => @events . filter ( e => e . level === "Error" ) }',
      30
    );
    const logic = makeLogicBlock([events, level, filtered]);
    const fileAST = makeFileAST([logic]);
    const routeMap = makeRouteMap([]);

    const { depGraph } = runDG({ files: [fileAST], routeMap });

    const filteredNode = findNodesByKind(depGraph, "reactive").find(n => n.varName === "filtered");
    const eventsNode = findNodesByKind(depGraph, "reactive").find(n => n.varName === "events");
    const levelNode = findNodesByKind(depGraph, "reactive").find(n => n.varName === "level");
    expect(filteredNode).toBeDefined();
    expect(eventsNode).toBeDefined();
    expect(levelNode).toBeDefined();

    const readsEvents = depGraph.edges.filter(
      e => e.from === filteredNode.nodeId && e.to === eventsNode.nodeId && e.kind === "reads"
    );
    expect(readsEvents.length).toBe(1);

    const readsLevel = depGraph.edges.filter(
      e => e.from === filteredNode.nodeId && e.to === levelNode.nodeId && e.kind === "reads"
    );
    expect(readsLevel.length).toBe(1);
  });

  test("derived with function call creates calls edge and reads direct @var", () => {
    const items = makeReactiveDecl("items", "[]", 0);
    const computeTotal = makeFnDecl({ name: "computeTotal", spanStart: 10, body: [] });
    const total = makeDerivedDecl("total", "computeTotal(@items)", 30);
    const logic = makeLogicBlock([items, computeTotal, total]);
    const fileAST = makeFileAST([logic]);
    const routeMap = makeRouteMap([{ name: "computeTotal", spanStart: 10, boundary: "client" }]);

    const { depGraph } = runDG({ files: [fileAST], routeMap });

    const totalNode = findNodesByKind(depGraph, "reactive").find(n => n.varName === "total");
    const itemsNode = findNodesByKind(depGraph, "reactive").find(n => n.varName === "items");
    expect(totalNode).toBeDefined();
    expect(itemsNode).toBeDefined();

    const readsItems = depGraph.edges.filter(
      e => e.from === totalNode.nodeId && e.to === itemsNode.nodeId && e.kind === "reads"
    );
    expect(readsItems.length).toBe(1);

    const computeNode = findNodeBySpanStart(depGraph, 10);
    expect(computeNode).toBeDefined();
    const callsEdges = depGraph.edges.filter(
      e => e.from === totalNode.nodeId && e.to === computeNode.nodeId && e.kind === "calls"
    );
    expect(callsEdges.length).toBe(1);
  });

  test("E-DG-002 suppression: derived decl reading @var counts as a reader", () => {
    const count = makeReactiveDecl("count", "0", 0);
    const doubled = makeDerivedDecl("doubled", "@count * 2", 20);
    const markup = {
      kind: "markup", tag: "span", attrs: [], children: [
        { kind: "logic", body: [makeBareExpr("@doubled", 50)], span: span(45) },
      ], span: span(40),
    };
    const logic = makeLogicBlock([count, doubled]);
    const fileAST = makeFileAST([logic, markup]);
    const routeMap = makeRouteMap([]);

    const { errors } = runDG({ files: [fileAST], routeMap });
    const dg002 = errors.filter(e => e.code === "E-DG-002");
    expect(dg002.length).toBe(0);
  });

  test("derived decl with function call — transitive reads propagated", () => {
    const items = makeReactiveDecl("items", "[]", 0);
    const taxRate = makeReactiveDecl("taxRate", "0.1", 10);
    const computeTax = makeFnDecl({
      name: "computeTax",
      spanStart: 20,
      body: [makeBareExpr("return sum(arr) * @taxRate", 25)],
    });
    const total = makeDerivedDecl("total", "computeTax(@items)", 40);
    const logic = makeLogicBlock([items, taxRate, computeTax, total]);
    const fileAST = makeFileAST([logic]);
    const routeMap = makeRouteMap([{ name: "computeTax", spanStart: 20, boundary: "client" }]);

    const { depGraph } = runDG({ files: [fileAST], routeMap });

    const totalNode = findNodesByKind(depGraph, "reactive").find(n => n.varName === "total");
    const taxRateNode = findNodesByKind(depGraph, "reactive").find(n => n.varName === "taxRate");
    expect(totalNode).toBeDefined();
    expect(taxRateNode).toBeDefined();

    const transitiveReads = depGraph.edges.filter(
      e => e.from === totalNode.nodeId && e.to === taxRateNode.nodeId && e.kind === "reads"
    );
    expect(transitiveReads.length).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // BUG-META-6: false E-DG-002 for @vars consumed inside runtime ^{} blocks
  // ---------------------------------------------------------------------------

  test("BUG-META-6: @var assigned via reactive-decl in runtime meta body counts as consumed", () => {
    // In a runtime ^{} meta block, `@message = "changed"` is parsed as a
    // reactive-decl AST node (name: "message", init: '"changed"'). The DG's
    // sweepNodeForAtRefs function must treat this as consumption of @message,
    // not just as a bare assignment. Otherwise E-DG-002 fires falsely.
    const counter = makeReactiveDecl("counter", "0", 0);
    const message = makeReactiveDecl("message", '"hello"', 10);
    const theme = makeReactiveDecl("theme", '"dark"', 20);
    const logic = makeLogicBlock([counter, message, theme]);

    // A markup node consuming @counter (so @counter is NOT flagged E-DG-002)
    const markup = {
      kind: "markup",
      tag: "div",
      attrs: [],
      children: [{ kind: "logic", body: [makeBareExpr("@counter", 50)], span: span(45) }],
      span: span(40),
    };

    // A runtime meta block (no compile-time APIs) that assigns @message and @theme
    const metaNode = {
      kind: "meta",
      body: [
        // @message = "changed" — parsed as reactive-decl in meta body
        { kind: "state-decl", name: "message", init: '"changed"', span: span(60) },
        // @theme = "light" — parsed as reactive-decl in meta body
        { kind: "state-decl", name: "theme", init: '"light"', span: span(70) },
      ],
      span: span(55),
    };

    const programNode = {
      kind: "markup",
      tag: "program",
      attrs: [],
      children: [logic, markup, metaNode],
      span: span(0),
    };

    const fileAST = makeFileAST([programNode]);
    const routeMap = makeRouteMap([]);

    const { errors } = runDG({ files: [fileAST], routeMap });
    const dg002 = errors.filter(e => e.code === "E-DG-002");

    // @message and @theme are consumed in the runtime meta block — no E-DG-002
    expect(dg002.length).toBe(0);
  });

  test("BUG-META-6: @var read in meta body bare-expr counts as consumed", () => {
    // Verify that @counter += 1 (parsed as bare-expr "@counter += 1") inside
    // a runtime meta body is also correctly counted as a consumption.
    const counter = makeReactiveDecl("counter", "0", 0);
    const logic = makeLogicBlock([counter]);

    const metaNode = {
      kind: "meta",
      body: [
        // @counter += 1 — parsed as bare-expr
        { kind: "bare-expr", expr: "@counter += 1", span: span(30) },
      ],
      span: span(25),
    };

    const programNode = {
      kind: "markup",
      tag: "program",
      attrs: [],
      children: [logic, metaNode],
      span: span(0),
    };

    const fileAST = makeFileAST([programNode]);
    const routeMap = makeRouteMap([]);

    const { errors } = runDG({ files: [fileAST], routeMap });
    const dg002 = errors.filter(e => e.code === "E-DG-002");

    // @counter is consumed in the runtime meta block — no E-DG-002
    expect(dg002.length).toBe(0);
  });

  test("S20 bug 2c: meta.get(\"name\") in meta body counts as a read of @name", () => {
    // A runtime ^{} meta block reads @theme via meta.get("theme"). Before the
    // S23 fix, the DG's @var scan couldn't find "@theme" in the AST (the
    // argument is just a string literal), so E-DG-002 fired falsely.
    // The fix: collectMetaVarRefsFromExprNode recognizes meta.get("name")
    // and credits @name as having a reader.
    const theme = makeReactiveDecl("theme", '"dark"', 0);
    const logic = makeLogicBlock([theme]);

    // ExprNode shape for meta.get("theme"): call(member(ident("meta"), "get"), [lit("theme")])
    const metaGetCall = {
      kind: "call",
      callee: {
        kind: "member",
        object: { kind: "ident", name: "meta", span: span(30) },
        property: "get",
        span: span(30),
      },
      args: [{ kind: "lit", value: "theme", span: span(35) }],
      span: span(30),
    };
    // Wrap in a bare-expr with exprNode set so the DG's ExprNode-first path sees it.
    const bareMetaGet = { kind: "bare-expr", expr: 'meta.get("theme")', exprNode: metaGetCall, span: span(30) };

    const metaNode = {
      kind: "meta",
      body: [bareMetaGet],
      span: span(25),
    };

    const programNode = {
      kind: "markup",
      tag: "program",
      attrs: [],
      children: [logic, metaNode],
      span: span(0),
    };

    const fileAST = makeFileAST([programNode]);
    const routeMap = makeRouteMap([]);

    const { errors } = runDG({ files: [fileAST], routeMap });
    const dg002 = errors.filter(e => e.code === "E-DG-002" && /@theme/.test(e.message));
    expect(dg002.length).toBe(0);
  });

  test("S20 bug 2c: meta.bindings.name in meta body counts as a read of @name", () => {
    // `meta.bindings.userCount` is a lexical capture lookup — syntactically
    // it has no "@userCount" ident. Before the S23 fix, the DG's @var scan
    // didn't see it, so E-DG-002 fired falsely on @userCount.
    const userCount = makeReactiveDecl("userCount", "42", 0);
    const logic = makeLogicBlock([userCount]);

    // ExprNode for meta.bindings.userCount: member(member(ident("meta"), "bindings"), "userCount")
    const metaBindingsAccess = {
      kind: "member",
      object: {
        kind: "member",
        object: { kind: "ident", name: "meta", span: span(30) },
        property: "bindings",
        span: span(30),
      },
      property: "userCount",
      span: span(30),
    };
    const bareAccess = {
      kind: "bare-expr",
      expr: "meta.bindings.userCount",
      exprNode: metaBindingsAccess,
      span: span(30),
    };

    const metaNode = {
      kind: "meta",
      body: [bareAccess],
      span: span(25),
    };

    const programNode = {
      kind: "markup",
      tag: "program",
      attrs: [],
      children: [logic, metaNode],
      span: span(0),
    };

    const fileAST = makeFileAST([programNode]);
    const routeMap = makeRouteMap([]);

    const { errors } = runDG({ files: [fileAST], routeMap });
    const dg002 = errors.filter(e => e.code === "E-DG-002" && /@userCount/.test(e.message));
    expect(dg002.length).toBe(0);
  });

  test("S20 bug 2c: string-fallback also credits meta.get(\"name\") when no exprNode", () => {
    // Regression guard for the string-fallback path: if a node has only `expr`
    // set (no exprNode), the regex-based scanner should still recognize
    // meta.get("theme").
    const theme = makeReactiveDecl("theme", '"dark"', 0);
    const logic = makeLogicBlock([theme]);

    // NO exprNode — only string expr. Forces the string-fallback branch.
    const bareMetaGet = { kind: "bare-expr", expr: 'meta.get("theme")', span: span(30) };

    const metaNode = {
      kind: "meta",
      body: [bareMetaGet],
      span: span(25),
    };

    const programNode = {
      kind: "markup",
      tag: "program",
      attrs: [],
      children: [logic, metaNode],
      span: span(0),
    };

    const fileAST = makeFileAST([programNode]);
    const routeMap = makeRouteMap([]);

    const { errors } = runDG({ files: [fileAST], routeMap });
    const dg002 = errors.filter(e => e.code === "E-DG-002" && /@theme/.test(e.message));
    expect(dg002.length).toBe(0);
  });
});
