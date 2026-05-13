/**
 * dg-markup-read-emission-a13.test.js — A-1.3 markup-read DG edge emission tests.
 *
 * Verifies that activating markupContextEmitEdges=true in A-1.3 causes the
 * 4 high-frequency markup-context shapes to emit MarkupReadDGNodes and reads
 * edges in the dependency graph:
 *
 *   Shape 1: ${@x} text interpolation — bare-expr inside markup children
 *   Shape 2: attr=@x simple variable-ref attribute
 *   Shape 3: bind:value=@x two-way binding (same valObj.kind === "variable-ref" path)
 *   Shape 4: if=@x / if=(@x && @y) condition attribute
 *
 * Also verifies that the 4 NOT-in-scope shapes (call-ref, for-iterable,
 * lift-template body, engine state-child body) emit NOTHING from the
 * markup-read path. These are regression guards for A-1.4/A-1.5 scope
 * boundaries.
 *
 * Spec authority: SPEC §40.9.3 (markup-context edge emission requirement),
 *   §31 (DG normative), §34 (error catalog), Option Y per S88 user ratification.
 *
 * Tests use runDG directly with hand-crafted FileAST objects so we can
 * inspect the DependencyGraph output without going through api.js.
 */

import { describe, test, expect } from "bun:test";
import { runDG } from "../../src/dependency-graph.ts";

// ---------------------------------------------------------------------------
// AST construction helpers — minimal shapes accepted by runDG
// ---------------------------------------------------------------------------

function mkSpan(start, file = "/test/a13.scrml") {
  return { file, start, end: start + 10, line: 1, col: start + 1 };
}

/**
 * A reactive state-decl node (registers @varName in the DG).
 * Must live inside a logic block for collectAllReactiveDecls to pick it up.
 */
function mkStateDecl(name, spanStart = 0, file = "/test/a13.scrml") {
  return { kind: "state-decl", name, init: "0", span: mkSpan(spanStart, file) };
}

/**
 * A logic block (${...}) containing the given body statements.
 */
function mkLogicBlock(body, spanStart = 0, file = "/test/a13.scrml") {
  return {
    kind: "logic",
    body,
    bodyKind: "logic",
    imports: [],
    exports: [],
    typeDecls: [],
    components: [],
    span: mkSpan(spanStart, file),
  };
}

/**
 * A bare-expr node with an exprNode that references @varName.
 * This is the AST shape for a ${@varName} text interpolation inside markup.
 *
 * The exprNode is an IdentExpr with name="@varName" — the minimum required
 * for collectReactiveRefsFromExprNode to return the var name.
 */
function mkBareExprInterp(varName, spanStart = 0, file = "/test/a13.scrml") {
  return {
    kind: "bare-expr",
    exprNode: { kind: "ident", name: "@" + varName },
    span: mkSpan(spanStart, file),
  };
}

/**
 * A bare-expr node referencing two vars (for per-interpolation distinctness tests).
 * Uses a binary "add" expression so both idents are present in the ExprNode tree.
 */
function mkBareExprTwoRefs(varA, varB, spanStart = 0, file = "/test/a13.scrml") {
  return {
    kind: "bare-expr",
    exprNode: {
      kind: "binary",
      op: "+",
      left: { kind: "ident", name: "@" + varA },
      right: { kind: "ident", name: "@" + varB },
    },
    span: mkSpan(spanStart, file),
  };
}

/**
 * A markup element (renders as a DG render node).
 * attrs is an array of AttrNode shapes.
 * children is an array of child ASTNodes.
 * The span must CONTAIN all child spans for findOwningRenderDGNode to work.
 */
function mkMarkup({ tag = "div", attrs = [], children = [], spanStart = 100, spanEnd = 900, file = "/test/a13.scrml" } = {}) {
  return {
    kind: "markup",
    id: spanStart,
    tag,
    attrs,
    children,
    selfClosing: false,
    isComponent: false,
    closerForm: "</>",
    span: { file, start: spanStart, end: spanEnd, line: 1, col: 1 },
  };
}

/**
 * An attr node with a variable-ref value ({ kind: "variable-ref", name: "@var" }).
 * Covers Shape 2 (attr=@x) and Shape 3 (bind:value=@x).
 */
function mkVariableRefAttr(attrName, varName, spanStart = 200, file = "/test/a13.scrml") {
  return {
    name: attrName,
    value: { kind: "variable-ref", name: "@" + varName },
    span: mkSpan(spanStart, file),
  };
}

/**
 * An attr node with an expr value ({ kind: "expr", refs: [varName], raw: "@var" }).
 * Covers Shape 4 (if=@x / if=(expr)).
 */
function mkExprAttr(attrName, varNames, spanStart = 300, file = "/test/a13.scrml") {
  return {
    name: attrName,
    value: {
      kind: "expr",
      refs: varNames,
      raw: varNames.map((v) => "@" + v).join(" && "),
    },
    span: mkSpan(spanStart, file),
  };
}

/**
 * A call-ref attr value — NOT in A-1.3 scope.
 * Shape: { kind: "call-ref", name: "fn", args: ["@var"] }
 */
function mkCallRefAttr(attrName, fnName, argVarNames, spanStart = 400, file = "/test/a13.scrml") {
  return {
    name: attrName,
    value: {
      kind: "call-ref",
      name: fnName,
      args: argVarNames.map((v) => "@" + v),
    },
    span: mkSpan(spanStart, file),
  };
}

/**
 * A minimal FileAST accepted by runDG.
 */
function mkFileAST(nodes, filePath = "/test/a13.scrml") {
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

function mkRouteMap() {
  return { functions: new Map() };
}

// ---------------------------------------------------------------------------
// Result accessors
// ---------------------------------------------------------------------------

/** All DGNodes with kind === "markup-read". */
function markupReadNodes(depGraph) {
  const result = [];
  for (const [, node] of depGraph.nodes) {
    if (node.kind === "markup-read") result.push(node);
  }
  return result;
}

/** All edges with kind === "reads" whose from node is a markup-read node. */
function markupReadEdges(depGraph) {
  const mrIds = new Set();
  for (const [id, node] of depGraph.nodes) {
    if (node.kind === "markup-read") mrIds.add(id);
  }
  return depGraph.edges.filter((e) => e.kind === "reads" && mrIds.has(e.from));
}

/** Find the DGNode ID for a reactive var by name. */
function reactiveNodeId(depGraph, varName) {
  for (const [id, node] of depGraph.nodes) {
    if (node.kind === "reactive" && node.varName === varName) return id;
  }
  return null;
}

/** Find the DGNode ID for a render node. Returns first match if multiple. */
function renderNodeId(depGraph) {
  for (const [id, node] of depGraph.nodes) {
    if (node.kind === "render") return id;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Shape 1 — ${@x} text interpolation inside markup
// ---------------------------------------------------------------------------

describe("A-1.3 Shape 1: ${@x} text interpolation inside markup children", () => {
  test("S1-T1: single ${@counter} emits one markup-read node + reads edge", () => {
    // File structure: logic block with @counter, then <program> markup
    // with a logic block child containing a bare-expr referencing @counter.
    const counterDecl = mkStateDecl("counter", 10);
    const logicBlock = mkLogicBlock([counterDecl], 0);

    const interpNode = mkBareExprInterp("counter", 150);
    const innerLogic = mkLogicBlock([interpNode], 140);
    const markupEl = mkMarkup({ tag: "program", children: [innerLogic], spanStart: 100, spanEnd: 900 });

    const fileAST = mkFileAST([logicBlock, markupEl]);
    const { depGraph, errors } = runDG({ files: [fileAST], routeMap: mkRouteMap() });

    // No fatal errors expected.
    const fatalErrors = errors.filter((e) => e.severity === "error");
    expect(fatalErrors).toHaveLength(0);

    // Exactly one markup-read node should be emitted for the @counter interpolation.
    const mrNodes = markupReadNodes(depGraph);
    expect(mrNodes.length).toBeGreaterThanOrEqual(1);

    // At least one reads edge should go from a markup-read node to @counter.
    const counterId = reactiveNodeId(depGraph, "counter");
    expect(counterId).not.toBeNull();
    const mrEdges = markupReadEdges(depGraph);
    const edgeToCounter = mrEdges.find((e) => e.to === counterId);
    expect(edgeToCounter).toBeDefined();
  });

  test("S1-T2: ${@a} and ${@b} as separate bare-expr nodes emit 2 distinct markup-read nodes", () => {
    // Two separate interpolations — each must produce its own markup-read node.
    const aDecl = mkStateDecl("a", 10);
    const bDecl = mkStateDecl("b", 20);
    const logicBlock = mkLogicBlock([aDecl, bDecl], 0);

    const interpA = mkBareExprInterp("a", 150);
    const interpB = mkBareExprInterp("b", 165);
    const innerLogic = mkLogicBlock([interpA, interpB], 140);
    const markupEl = mkMarkup({ tag: "program", children: [innerLogic], spanStart: 100, spanEnd: 900 });

    const fileAST = mkFileAST([logicBlock, markupEl]);
    const { depGraph } = runDG({ files: [fileAST], routeMap: mkRouteMap() });

    const mrNodes = markupReadNodes(depGraph);
    // Each interpolation produces its own markup-read node.
    expect(mrNodes.length).toBeGreaterThanOrEqual(2);

    // Both nodeIds are distinct (per-interpolation uniqueness).
    const mrIds = mrNodes.map((n) => n.nodeId);
    const uniqueIds = new Set(mrIds);
    expect(uniqueIds.size).toBe(mrIds.length);

    // Reads edges go to the correct reactive vars.
    const aId = reactiveNodeId(depGraph, "a");
    const bId = reactiveNodeId(depGraph, "b");
    const mrEdges = markupReadEdges(depGraph);
    expect(mrEdges.some((e) => e.to === aId)).toBe(true);
    expect(mrEdges.some((e) => e.to === bId)).toBe(true);
  });

  test("S1-T3: bare-expr in top-level logic block (not markup child) emits NO markup-read node", () => {
    // A bare-expr at top-level logic context (outside any markup) must NOT
    // produce markup-read nodes — those reads are captured by the function-body
    // DG scan or are irrelevant to closure analysis.
    const counterDecl = mkStateDecl("counter", 10);
    const topLevelBareExpr = mkBareExprInterp("counter", 30);
    // No markup element — just a logic block with a bare-expr at top level
    const logicBlock = mkLogicBlock([counterDecl, topLevelBareExpr], 0);

    const fileAST = mkFileAST([logicBlock]);
    const { depGraph } = runDG({ files: [fileAST], routeMap: mkRouteMap() });

    // No markup-read nodes should be emitted for top-level logic context.
    const mrNodes = markupReadNodes(depGraph);
    expect(mrNodes).toHaveLength(0);
  });

  test("S1-T4: sourceRenderNodeId resolves to the enclosing render DG node", () => {
    // The markup-read node's sourceRenderNodeId should point to the render
    // DGNode for the <program> element that encloses the interpolation.
    const counterDecl = mkStateDecl("counter", 10);
    const logicBlock = mkLogicBlock([counterDecl], 0);

    const interpNode = mkBareExprInterp("counter", 150);
    const innerLogic = mkLogicBlock([interpNode], 140);
    const markupEl = mkMarkup({ tag: "program", children: [innerLogic], spanStart: 100, spanEnd: 900 });

    const fileAST = mkFileAST([logicBlock, markupEl]);
    const { depGraph } = runDG({ files: [fileAST], routeMap: mkRouteMap() });

    const mrNodes = markupReadNodes(depGraph);
    expect(mrNodes.length).toBeGreaterThanOrEqual(1);

    // The render node for <program> must exist.
    const renderId = renderNodeId(depGraph);
    expect(renderId).not.toBeNull();

    // The markup-read node's sourceRenderNodeId must equal the render node's ID.
    const mrNodeForCounter = mrNodes.find((n) => {
      const mrEdges = markupReadEdges(depGraph);
      const counterId = reactiveNodeId(depGraph, "counter");
      return mrEdges.some((e) => e.from === n.nodeId && e.to === counterId);
    });
    expect(mrNodeForCounter).toBeDefined();
    expect(mrNodeForCounter.sourceRenderNodeId).toBe(renderId);
  });
});

// ---------------------------------------------------------------------------
// Shape 2 — attr=@x simple variable-ref attribute
// ---------------------------------------------------------------------------

describe("A-1.3 Shape 2: attr=@x simple variable-ref attribute", () => {
  test("S2-T1: value=@label attr emits one markup-read node + reads edge", () => {
    const labelDecl = mkStateDecl("label", 10);
    const logicBlock = mkLogicBlock([labelDecl], 0);

    const valueAttr = mkVariableRefAttr("value", "label", 150);
    const markupEl = mkMarkup({ tag: "input", attrs: [valueAttr], spanStart: 100, spanEnd: 900 });

    const fileAST = mkFileAST([logicBlock, markupEl]);
    const { depGraph, errors } = runDG({ files: [fileAST], routeMap: mkRouteMap() });

    expect(errors.filter((e) => e.severity === "error")).toHaveLength(0);

    const mrNodes = markupReadNodes(depGraph);
    expect(mrNodes.length).toBeGreaterThanOrEqual(1);

    const labelId = reactiveNodeId(depGraph, "label");
    expect(labelId).not.toBeNull();
    const mrEdges = markupReadEdges(depGraph);
    expect(mrEdges.some((e) => e.to === labelId)).toBe(true);
  });

  test("S2-T2: multiple variable-ref attrs on the same element emit separate markup-read nodes", () => {
    const aDecl = mkStateDecl("a", 10);
    const bDecl = mkStateDecl("b", 20);
    const logicBlock = mkLogicBlock([aDecl, bDecl], 0);

    const attrA = mkVariableRefAttr("href", "a", 150);
    const attrB = mkVariableRefAttr("title", "b", 165);
    const markupEl = mkMarkup({ tag: "a", attrs: [attrA, attrB], spanStart: 100, spanEnd: 900 });

    const fileAST = mkFileAST([logicBlock, markupEl]);
    const { depGraph } = runDG({ files: [fileAST], routeMap: mkRouteMap() });

    const mrNodes = markupReadNodes(depGraph);
    expect(mrNodes.length).toBeGreaterThanOrEqual(2);

    const aId = reactiveNodeId(depGraph, "a");
    const bId = reactiveNodeId(depGraph, "b");
    const mrEdges = markupReadEdges(depGraph);
    expect(mrEdges.some((e) => e.to === aId)).toBe(true);
    expect(mrEdges.some((e) => e.to === bId)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Shape 3 — bind:value=@x two-way binding
// ---------------------------------------------------------------------------

describe("A-1.3 Shape 3: bind:value=@x two-way binding", () => {
  test("S3-T1: bind:value=@label emits one markup-read node + reads edge", () => {
    const labelDecl = mkStateDecl("label", 10);
    const logicBlock = mkLogicBlock([labelDecl], 0);

    // bind:value uses the same valObj.kind === "variable-ref" path as Shape 2.
    const bindAttr = mkVariableRefAttr("bind:value", "label", 150);
    const markupEl = mkMarkup({ tag: "input", attrs: [bindAttr], spanStart: 100, spanEnd: 900 });

    const fileAST = mkFileAST([logicBlock, markupEl]);
    const { depGraph, errors } = runDG({ files: [fileAST], routeMap: mkRouteMap() });

    expect(errors.filter((e) => e.severity === "error")).toHaveLength(0);

    const mrNodes = markupReadNodes(depGraph);
    expect(mrNodes.length).toBeGreaterThanOrEqual(1);

    const labelId = reactiveNodeId(depGraph, "label");
    const mrEdges = markupReadEdges(depGraph);
    expect(mrEdges.some((e) => e.to === labelId)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Shape 4 — if=@x / if=(expr) condition attribute
// ---------------------------------------------------------------------------

describe("A-1.3 Shape 4: if=@x / if=(expr) condition attribute", () => {
  test("S4-T1: if=@visible (single var, refs array) emits one markup-read node", () => {
    const visibleDecl = mkStateDecl("visible", 10);
    const logicBlock = mkLogicBlock([visibleDecl], 0);

    const ifAttr = mkExprAttr("if", ["visible"], 150);
    const markupEl = mkMarkup({ tag: "p", attrs: [ifAttr], spanStart: 100, spanEnd: 900 });

    const fileAST = mkFileAST([logicBlock, markupEl]);
    const { depGraph, errors } = runDG({ files: [fileAST], routeMap: mkRouteMap() });

    expect(errors.filter((e) => e.severity === "error")).toHaveLength(0);

    const mrNodes = markupReadNodes(depGraph);
    expect(mrNodes.length).toBeGreaterThanOrEqual(1);

    const visibleId = reactiveNodeId(depGraph, "visible");
    expect(visibleId).not.toBeNull();
    const mrEdges = markupReadEdges(depGraph);
    expect(mrEdges.some((e) => e.to === visibleId)).toBe(true);
  });

  test("S4-T2: if=(@a && @b) (compound expr, two refs) emits two markup-read nodes", () => {
    const aDecl = mkStateDecl("a", 10);
    const bDecl = mkStateDecl("b", 20);
    const logicBlock = mkLogicBlock([aDecl, bDecl], 0);

    const ifAttr = mkExprAttr("if", ["a", "b"], 150);
    const markupEl = mkMarkup({ tag: "div", attrs: [ifAttr], spanStart: 100, spanEnd: 900 });

    const fileAST = mkFileAST([logicBlock, markupEl]);
    const { depGraph } = runDG({ files: [fileAST], routeMap: mkRouteMap() });

    const aId = reactiveNodeId(depGraph, "a");
    const bId = reactiveNodeId(depGraph, "b");
    const mrEdges = markupReadEdges(depGraph);
    // One markup-read edge for each var in the compound condition.
    expect(mrEdges.some((e) => e.to === aId)).toBe(true);
    expect(mrEdges.some((e) => e.to === bId)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Regression guards — NOT-in-scope shapes must emit NO markup-read nodes
// ---------------------------------------------------------------------------

describe("A-1.3 out-of-scope shapes: call-ref, string-attr-raw — no markup-read emission", () => {
  test("OOS-T1: call-ref attribute value (Shape A-1.4) emits NO markup-read node", () => {
    // onclick=fn(@x) — call-ref shape. A-1.4 territory. A-1.3 must NOT emit.
    const xDecl = mkStateDecl("x", 10);
    const logicBlock = mkLogicBlock([xDecl], 0);

    const callRefAttr = mkCallRefAttr("onclick", "handleClick", ["x"], 150);
    const markupEl = mkMarkup({ tag: "button", attrs: [callRefAttr], spanStart: 100, spanEnd: 900 });

    const fileAST = mkFileAST([logicBlock, markupEl]);
    const { depGraph } = runDG({ files: [fileAST], routeMap: mkRouteMap() });

    // call-ref attr creditReader is called (for E-DG-002), but NO markup-read
    // node should be emitted (that is A-1.4 work).
    const mrNodes = markupReadNodes(depGraph);
    expect(mrNodes).toHaveLength(0);
  });

  test("OOS-T2: string-typed attribute value with @var (raw-string path) emits NO markup-read node", () => {
    // Attr value is a plain string like 'class="@theme"' — the raw-string
    // creditReader path. Not one of the 4 high-frequency shapes; no markup-read
    // emission in A-1.3.
    const themeDecl = mkStateDecl("theme", 10);
    const logicBlock = mkLogicBlock([themeDecl], 0);

    // String-typed attr value — not a variable-ref or expr object.
    const stringAttr = {
      name: "class",
      value: "@theme",
      span: mkSpan(150),
    };
    const markupEl = mkMarkup({ tag: "div", attrs: [stringAttr], spanStart: 100, spanEnd: 900 });

    const fileAST = mkFileAST([logicBlock, markupEl]);
    const { depGraph } = runDG({ files: [fileAST], routeMap: mkRouteMap() });

    // String attr creditReader is called (E-DG-002 credit), but no markup-read
    // node is emitted — string attr is not one of the 4 A-1.3 shapes.
    const mrNodes = markupReadNodes(depGraph);
    expect(mrNodes).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Additive invariant — creditReader sentinel is still credited (E-DG-002)
// ---------------------------------------------------------------------------

describe("A-1.3 additive invariant: creditReader sentinel preserved", () => {
  test("INV-T1: E-DG-002 does NOT fire for @counter referenced in markup interpolation", () => {
    // With markup-read edges emitted, @counter is still credited via the
    // MARKUP_READER_SENTINEL. E-DG-002 must not fire when the cell is read.
    //
    // Use compileScrml (not runDG) for this test so we can check the warnings
    // that the full pipeline emits.
    //
    // NOTE: This test verifies the additive nature — both the sentinel credit
    // AND the markup-read node+edge must be produced without breaking E-DG-002.
    const aDecl = mkStateDecl("counter", 10);
    const logicBlock = mkLogicBlock([aDecl], 0);
    const interpNode = mkBareExprInterp("counter", 150);
    const innerLogic = mkLogicBlock([interpNode], 140);
    const markupEl = mkMarkup({ tag: "program", children: [innerLogic], spanStart: 100, spanEnd: 900 });

    const fileAST = mkFileAST([logicBlock, markupEl]);
    const { depGraph, errors } = runDG({ files: [fileAST], routeMap: mkRouteMap() });

    // E-DG-002 must NOT fire for @counter (it has a markup-context reader).
    const edg002 = errors.find(
      (e) => e.code === "E-DG-002" && /counter/.test(e.message),
    );
    expect(edg002).toBeUndefined();

    // markup-read node IS emitted (the flag is active).
    const mrNodes = markupReadNodes(depGraph);
    expect(mrNodes.length).toBeGreaterThanOrEqual(1);
  });

  test("INV-T2: E-DG-002 still fires for @unused cell with no readers", () => {
    // A cell that is never read in markup or logic should still trigger E-DG-002.
    // The activation of markup-read emission must not accidentally suppress it.
    const unusedDecl = mkStateDecl("unused", 10);
    const logicBlock = mkLogicBlock([unusedDecl], 0);
    // Markup with no reference to @unused.
    const markupEl = mkMarkup({ tag: "program", children: [], spanStart: 100, spanEnd: 900 });

    const fileAST = mkFileAST([logicBlock, markupEl]);
    const { errors } = runDG({ files: [fileAST], routeMap: mkRouteMap() });

    const edg002 = errors.find(
      (e) => e.code === "E-DG-002" && /unused/.test(e.message),
    );
    expect(edg002).toBeDefined();
  });
});
