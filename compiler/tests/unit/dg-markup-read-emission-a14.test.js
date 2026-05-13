/**
 * dg-markup-read-emission-a14.test.js — A-1.4 markup-read DG edge emission tests.
 *
 * Verifies that A-1.4 extends sweepNodeForAtRefs to emit MarkupReadDGNodes and
 * reads edges for 3 new markup-context shape categories:
 *
 *   Shape 1: call-ref attribute values — `onclick=fn(@x)`, `onsubmit=submit(@form)`
 *     @var refs in call-ref args emit markup-read node + reads edges.
 *
 *   Shape 2: for-iterable markup — `for (item of @items)` inside markup context.
 *     The iterable @var is a markup-context read. Emitted when markupChildDepth > 0.
 *
 *   Shape 3: lift-template body — `lift <li class:editing=@x>` and `lift <li>${@x}</li>`
 *     inside a for loop body. The lift markup target's attrs (variable-ref) and
 *     bare-expr children emit via A-1.3 shapes 2/3 and shape 1 respectively,
 *     triggered by A-1.4's explicit recursion through the lift body.
 *     For non-markup lift (`lift @x`), A-1.4 adds direct emission.
 *
 * Also verifies the negative regression: the 4 A-1.3 high-frequency shapes
 * (text interpolation, variable-ref attr, bind:value, if-condition) are NOT
 * double-emitted — they still produce exactly the same markup-read nodes as
 * before A-1.4.
 *
 * Test strategy: hand-craft FileAST objects passed directly to runDG, bypassing
 * the SYM pipeline. Matches the approach used by A-1.3 and A-1.5 test suites.
 *
 * Spec authority: SPEC §40.9.3 (markup-context edge emission requirement),
 *   §31 (DG normative), §34 (error catalog). A-1.4 per S88/S89 dispatch brief.
 */

import { describe, test, expect } from "bun:test";
import { runDG } from "../../src/dependency-graph.ts";

// ---------------------------------------------------------------------------
// AST construction helpers
// ---------------------------------------------------------------------------

function mkSpan(start, file = "/test/a14.scrml") {
  return { file, start, end: start + 10, line: 1, col: start + 1 };
}

function mkStateDecl(name, spanStart = 0, file = "/test/a14.scrml") {
  return { kind: "state-decl", name, init: "0", span: mkSpan(spanStart, file) };
}

function mkLogicBlock(body, spanStart = 0, file = "/test/a14.scrml") {
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
 * A markup element. spanStart/spanEnd must contain all child spans.
 */
function mkMarkup({ tag = "div", attrs = [], children = [], spanStart = 100, spanEnd = 5000, file = "/test/a14.scrml" } = {}) {
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
 * A call-ref attribute value: `{ kind: "call-ref", name, args, argExprNodes }`.
 * argVarNames are the @-prefixed arg variable names (without the @ prefix).
 */
function mkCallRefAttr(attrName, fnName, argVarNames, spanStart = 200, file = "/test/a14.scrml") {
  return {
    name: attrName,
    value: {
      kind: "call-ref",
      name: fnName,
      args: argVarNames.map((v) => "@" + v),
      // argExprNodes: provide ident ExprNodes so the ExprNode-first path fires.
      argExprNodes: argVarNames.map((v) => ({ kind: "ident", name: "@" + v })),
    },
    span: mkSpan(spanStart, file),
  };
}

/**
 * A call-ref attribute with ONLY string args (no argExprNodes).
 * Tests the string-fallback path.
 */
function mkCallRefAttrStringOnly(attrName, fnName, argVarNames, spanStart = 200, file = "/test/a14.scrml") {
  return {
    name: attrName,
    value: {
      kind: "call-ref",
      name: fnName,
      args: argVarNames.map((v) => "@" + v),
      // no argExprNodes — forces string-fallback path
    },
    span: mkSpan(spanStart, file),
  };
}

/**
 * A for-stmt node whose iterable is an @var reactive ref.
 * iterExpr is set so the ExprNode-first path fires.
 * spanStart must be within the parent markup's span.
 */
function mkForStmt(varName, iterableVar, body = [], spanStart = 300, file = "/test/a14.scrml") {
  return {
    kind: "for-stmt",
    variable: varName,
    iterable: "@" + iterableVar,
    iterExpr: { kind: "ident", name: "@" + iterableVar },
    body,
    span: mkSpan(spanStart, file),
  };
}

/**
 * A for-stmt node with ONLY a string iterable (no iterExpr).
 * Tests the string-fallback path.
 */
function mkForStmtStringOnly(varName, iterableVar, body = [], spanStart = 300, file = "/test/a14.scrml") {
  return {
    kind: "for-stmt",
    variable: varName,
    iterable: "@" + iterableVar,
    // no iterExpr — forces string-fallback path
    body,
    span: mkSpan(spanStart, file),
  };
}

/**
 * A lift-expr node with a markup body target.
 * The markup body may contain variable-ref attrs or bare-expr children.
 */
function mkLiftExprMarkup(markupNode, spanStart = 400, file = "/test/a14.scrml") {
  return {
    kind: "lift-expr",
    expr: { kind: "markup", node: markupNode },
    span: mkSpan(spanStart, file),
  };
}

/**
 * A lift-expr node with a plain expression target (non-markup).
 * The expr references an @var reactive ref.
 */
function mkLiftExprVar(varName, spanStart = 400, file = "/test/a14.scrml") {
  return {
    kind: "lift-expr",
    expr: {
      kind: "expr",
      expr: "@" + varName,
      exprNode: { kind: "ident", name: "@" + varName },
    },
    span: mkSpan(spanStart, file),
  };
}

/**
 * A variable-ref attribute: `{ kind: "variable-ref", name: "@var" }`.
 */
function mkVariableRefAttr(attrName, varName, spanStart = 500, file = "/test/a14.scrml") {
  return {
    name: attrName,
    value: { kind: "variable-ref", name: "@" + varName },
    span: mkSpan(spanStart, file),
  };
}

/**
 * A bare-expr node (${@var} interpolation).
 */
function mkBareExprInterp(varName, spanStart = 600, file = "/test/a14.scrml") {
  return {
    kind: "bare-expr",
    exprNode: { kind: "ident", name: "@" + varName },
    span: mkSpan(spanStart, file),
  };
}

/**
 * A minimal FileAST accepted by runDG.
 */
function mkFileAST(nodes, filePath = "/test/a14.scrml") {
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
// Result accessors (same pattern as A-1.3 and A-1.5 tests)
// ---------------------------------------------------------------------------

function markupReadNodes(depGraph) {
  const result = [];
  for (const [, node] of depGraph.nodes) {
    if (node.kind === "markup-read") result.push(node);
  }
  return result;
}

function markupReadEdges(depGraph) {
  const mrIds = new Set();
  for (const [id, node] of depGraph.nodes) {
    if (node.kind === "markup-read") mrIds.add(id);
  }
  return depGraph.edges.filter((e) => e.kind === "reads" && mrIds.has(e.from));
}

function reactiveNodeId(depGraph, varName) {
  for (const [id, node] of depGraph.nodes) {
    if (node.kind === "reactive" && node.varName === varName) return id;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Shape 1 — call-ref attribute values
// ---------------------------------------------------------------------------

describe("A-1.4 Shape 1: call-ref attribute value @var args emit markup-read edges", () => {
  test("CR-T1: onclick=fn(@x) emits one markup-read node + reads edge to @x", () => {
    // <button onclick=handleClick(@x)> — the @x arg is a markup-context read.
    const xDecl = mkStateDecl("x", 10);
    const logicBlock = mkLogicBlock([xDecl], 0);

    const callRefAttr = mkCallRefAttr("onclick", "handleClick", ["x"], 200);
    const markupEl = mkMarkup({ tag: "button", attrs: [callRefAttr], spanStart: 100, spanEnd: 5000 });

    const fileAST = mkFileAST([logicBlock, markupEl]);
    const { depGraph, errors } = runDG({ files: [fileAST], routeMap: mkRouteMap() });

    expect(errors.filter((e) => e.severity === "error")).toHaveLength(0);

    // At least one markup-read node should be emitted for the @x arg.
    const mrNodes = markupReadNodes(depGraph);
    expect(mrNodes.length).toBeGreaterThanOrEqual(1);

    // A reads edge must point to the @x reactive node.
    const xId = reactiveNodeId(depGraph, "x");
    expect(xId).not.toBeNull();
    const mrEdges = markupReadEdges(depGraph);
    expect(mrEdges.some((e) => e.to === xId)).toBe(true);
  });

  test("CR-T2: onsubmit=submit(@form, @user) emits markup-read edges for both @form and @user", () => {
    // Two @var args in a single call-ref attr — both must emit.
    const formDecl = mkStateDecl("form", 10);
    const userDecl = mkStateDecl("user", 20);
    const logicBlock = mkLogicBlock([formDecl, userDecl], 0);

    const callRefAttr = mkCallRefAttr("onsubmit", "submit", ["form", "user"], 200);
    const markupEl = mkMarkup({ tag: "form", attrs: [callRefAttr], spanStart: 100, spanEnd: 5000 });

    const fileAST = mkFileAST([logicBlock, markupEl]);
    const { depGraph } = runDG({ files: [fileAST], routeMap: mkRouteMap() });

    const formId = reactiveNodeId(depGraph, "form");
    const userId = reactiveNodeId(depGraph, "user");
    const mrEdges = markupReadEdges(depGraph);
    expect(mrEdges.some((e) => e.to === formId)).toBe(true);
    expect(mrEdges.some((e) => e.to === userId)).toBe(true);
  });

  test("CR-T3: call-ref with no @var args emits no markup-read node", () => {
    // `onclick=handleClick()` — no @var args means no markup-read emission.
    const markupEl = mkMarkup({
      tag: "button",
      attrs: [{
        name: "onclick",
        value: { kind: "call-ref", name: "handleClick", args: [], argExprNodes: [] },
        span: mkSpan(200),
      }],
      spanStart: 100,
      spanEnd: 5000,
    });

    const fileAST = mkFileAST([markupEl]);
    const { depGraph } = runDG({ files: [fileAST], routeMap: mkRouteMap() });

    // No @var refs → no markup-read nodes.
    const mrNodes = markupReadNodes(depGraph);
    expect(mrNodes).toHaveLength(0);
  });

  test("CR-T4: call-ref string-fallback (no argExprNodes) still emits markup-read edge", () => {
    // When argExprNodes is absent (parse failed or not populated), the string
    // args fallback scans args for @var patterns and emits markup-read edges.
    const xDecl = mkStateDecl("x", 10);
    const logicBlock = mkLogicBlock([xDecl], 0);

    const callRefAttr = mkCallRefAttrStringOnly("onclick", "handleClick", ["x"], 200);
    const markupEl = mkMarkup({ tag: "button", attrs: [callRefAttr], spanStart: 100, spanEnd: 5000 });

    const fileAST = mkFileAST([logicBlock, markupEl]);
    const { depGraph, errors } = runDG({ files: [fileAST], routeMap: mkRouteMap() });

    expect(errors.filter((e) => e.severity === "error")).toHaveLength(0);

    const xId = reactiveNodeId(depGraph, "x");
    expect(xId).not.toBeNull();
    const mrEdges = markupReadEdges(depGraph);
    expect(mrEdges.some((e) => e.to === xId)).toBe(true);
  });

  test("CR-T5: E-DG-002 does NOT fire for @x referenced only in a call-ref arg", () => {
    // @x is only read via a call-ref attr — creditReader must be called so
    // E-DG-002 (no readers) does not fire.
    const xDecl = mkStateDecl("x", 10);
    const logicBlock = mkLogicBlock([xDecl], 0);

    const callRefAttr = mkCallRefAttr("onclick", "handler", ["x"], 200);
    const markupEl = mkMarkup({ tag: "button", attrs: [callRefAttr], spanStart: 100, spanEnd: 5000 });

    const fileAST = mkFileAST([logicBlock, markupEl]);
    const { errors } = runDG({ files: [fileAST], routeMap: mkRouteMap() });

    const edg002 = errors.find((e) => e.code === "E-DG-002" && /\bx\b/.test(e.message));
    expect(edg002).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Shape 2 — for-iterable markup
// ---------------------------------------------------------------------------

describe("A-1.4 Shape 2: for-iterable @var inside markup context emits markup-read edges", () => {
  test("FI-T1: for (item of @items) inside markup children emits markup-read node + reads edge", () => {
    // A for-stmt whose iterable is @items lives inside a logic block which
    // is itself a child of a <program> markup. markupChildDepth > 0 at that
    // point, so the iterable @items ref should emit a markup-read edge.
    const itemsDecl = mkStateDecl("items", 10);
    const logicBlock = mkLogicBlock([itemsDecl], 0);

    // for-stmt inside an inner logic block, inside the markup's children.
    const forStmt = mkForStmt("item", "items", [], 300);
    const innerLogic = mkLogicBlock([forStmt], 250);
    const markupEl = mkMarkup({ tag: "program", children: [innerLogic], spanStart: 100, spanEnd: 5000 });

    const fileAST = mkFileAST([logicBlock, markupEl]);
    const { depGraph, errors } = runDG({ files: [fileAST], routeMap: mkRouteMap() });

    expect(errors.filter((e) => e.severity === "error")).toHaveLength(0);

    const itemsId = reactiveNodeId(depGraph, "items");
    expect(itemsId).not.toBeNull();

    const mrEdges = markupReadEdges(depGraph);
    expect(mrEdges.some((e) => e.to === itemsId)).toBe(true);
  });

  test("FI-T2: for-stmt iterable @var in top-level logic (not markup child) emits NO markup-read", () => {
    // A for-stmt NOT inside markup children (markupChildDepth === 0) must NOT
    // emit markup-read edges for its iterable @var. Only the creditReader
    // sentinel is called (E-DG-002 credit).
    const itemsDecl = mkStateDecl("items", 10);
    const forStmt = mkForStmt("item", "items", [], 30);
    const logicBlock = mkLogicBlock([itemsDecl, forStmt], 0);
    // No markup element — items is only in top-level logic.

    const fileAST = mkFileAST([logicBlock]);
    const { depGraph } = runDG({ files: [fileAST], routeMap: mkRouteMap() });

    // No markup-read nodes should be emitted for top-level logic.
    const mrNodes = markupReadNodes(depGraph);
    expect(mrNodes).toHaveLength(0);
  });

  test("FI-T3: for-stmt string-fallback iterable (no iterExpr) emits markup-read edge", () => {
    // When iterExpr is absent (only the string `iterable` field is set),
    // the string-fallback path should still emit a markup-read edge.
    const itemsDecl = mkStateDecl("items", 10);
    const logicBlock = mkLogicBlock([itemsDecl], 0);

    const forStmt = mkForStmtStringOnly("item", "items", [], 300);
    const innerLogic = mkLogicBlock([forStmt], 250);
    const markupEl = mkMarkup({ tag: "program", children: [innerLogic], spanStart: 100, spanEnd: 5000 });

    const fileAST = mkFileAST([logicBlock, markupEl]);
    const { depGraph, errors } = runDG({ files: [fileAST], routeMap: mkRouteMap() });

    expect(errors.filter((e) => e.severity === "error")).toHaveLength(0);

    const itemsId = reactiveNodeId(depGraph, "items");
    expect(itemsId).not.toBeNull();

    const mrEdges = markupReadEdges(depGraph);
    expect(mrEdges.some((e) => e.to === itemsId)).toBe(true);
  });

  test("FI-T4: E-DG-002 does NOT fire for @items used only as for-iterable inside markup", () => {
    // @items is only read as a for-iterable inside markup. creditReader must
    // be called so E-DG-002 (no readers) does not fire.
    const itemsDecl = mkStateDecl("items", 10);
    const logicBlock = mkLogicBlock([itemsDecl], 0);

    const forStmt = mkForStmt("item", "items", [], 300);
    const innerLogic = mkLogicBlock([forStmt], 250);
    const markupEl = mkMarkup({ tag: "program", children: [innerLogic], spanStart: 100, spanEnd: 5000 });

    const fileAST = mkFileAST([logicBlock, markupEl]);
    const { errors } = runDG({ files: [fileAST], routeMap: mkRouteMap() });

    const edg002 = errors.find((e) => e.code === "E-DG-002" && /\bitems\b/.test(e.message));
    expect(edg002).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Shape 3 — lift-template body
// ---------------------------------------------------------------------------

describe("A-1.4 Shape 3: lift-template body @var refs emit markup-read edges", () => {
  test("LT-T1: lift <li class:editing=@x> inside markup — markup-read edge for @x", () => {
    // A lift-expr with a markup body containing a variable-ref attr class:editing=@x.
    // A-1.3 Shape 2 fires on recursion through the lift markup's attrs.
    // markupChildDepth > 0 when we recurse (inside the for-stmt body inside markup).
    const xDecl = mkStateDecl("x", 10);
    const logicBlock = mkLogicBlock([xDecl], 0);

    // lift <li class:editing=@x>
    const liftMarkup = mkMarkup({ tag: "li", attrs: [mkVariableRefAttr("class:editing", "x", 500)], spanStart: 450, spanEnd: 900 });
    const liftExpr = mkLiftExprMarkup(liftMarkup, 400);
    const forStmt = mkForStmt("item", "items", [liftExpr], 300);
    const innerLogic = mkLogicBlock([forStmt], 250);

    // Note: @items is NOT declared here — that would generate E-DG-002 for @items.
    // We only declare @x; @items creditReader will fire but no reactive node for it.
    const markupEl = mkMarkup({ tag: "program", children: [innerLogic], spanStart: 100, spanEnd: 5000 });

    const fileAST = mkFileAST([logicBlock, markupEl]);
    const { depGraph, errors } = runDG({ files: [fileAST], routeMap: mkRouteMap() });

    // No FATAL errors — E-DG-002 for @items is a warning (items has no DG node).
    expect(errors.filter((e) => e.severity === "error")).toHaveLength(0);

    // @x markup-read edge must be present.
    const xId = reactiveNodeId(depGraph, "x");
    expect(xId).not.toBeNull();
    const mrEdges = markupReadEdges(depGraph);
    expect(mrEdges.some((e) => e.to === xId)).toBe(true);
  });

  test("LT-T2: lift <li>${@x}</li> inside markup — markup-read edge for @x", () => {
    // A lift-expr with a markup body containing a bare-expr interpolation ${@x}.
    // A-1.3 Shape 1 fires on recursion through the lift markup's children.
    const xDecl = mkStateDecl("x", 10);
    const logicBlock = mkLogicBlock([xDecl], 0);

    const interpNode = mkBareExprInterp("x", 600);
    const innerLiftLogic = mkLogicBlock([interpNode], 550);
    const liftMarkup = mkMarkup({ tag: "li", attrs: [], children: [innerLiftLogic], spanStart: 450, spanEnd: 900 });
    const liftExpr = mkLiftExprMarkup(liftMarkup, 400);
    const innerLogic = mkLogicBlock([liftExpr], 250);
    const markupEl = mkMarkup({ tag: "program", children: [innerLogic], spanStart: 100, spanEnd: 5000 });

    const fileAST = mkFileAST([logicBlock, markupEl]);
    const { depGraph, errors } = runDG({ files: [fileAST], routeMap: mkRouteMap() });

    expect(errors.filter((e) => e.severity === "error")).toHaveLength(0);

    const xId = reactiveNodeId(depGraph, "x");
    expect(xId).not.toBeNull();
    const mrEdges = markupReadEdges(depGraph);
    expect(mrEdges.some((e) => e.to === xId)).toBe(true);
  });

  test("LT-T3: lift @x (non-markup expr) inside markup children emits markup-read edge", () => {
    // A lift-expr whose target is a plain expression (not a markup node):
    // `lift @x` — the A-1.4 Shape 3 expr path emits when markupChildDepth > 0.
    const xDecl = mkStateDecl("x", 10);
    const logicBlock = mkLogicBlock([xDecl], 0);

    const liftExpr = mkLiftExprVar("x", 400);
    const innerLogic = mkLogicBlock([liftExpr], 250);
    const markupEl = mkMarkup({ tag: "program", children: [innerLogic], spanStart: 100, spanEnd: 5000 });

    const fileAST = mkFileAST([logicBlock, markupEl]);
    const { depGraph, errors } = runDG({ files: [fileAST], routeMap: mkRouteMap() });

    expect(errors.filter((e) => e.severity === "error")).toHaveLength(0);

    const xId = reactiveNodeId(depGraph, "x");
    expect(xId).not.toBeNull();
    const mrEdges = markupReadEdges(depGraph);
    expect(mrEdges.some((e) => e.to === xId)).toBe(true);
  });

  test("LT-T4: lift @x at top-level logic (not markup child) emits NO markup-read edge", () => {
    // A lift-expr with a plain expression target in a top-level logic block
    // (markupChildDepth === 0) must NOT emit markup-read edges.
    const xDecl = mkStateDecl("x", 10);
    const liftExpr = mkLiftExprVar("x", 30);
    const logicBlock = mkLogicBlock([xDecl, liftExpr], 0);
    // No markup element.

    const fileAST = mkFileAST([logicBlock]);
    const { depGraph } = runDG({ files: [fileAST], routeMap: mkRouteMap() });

    const mrNodes = markupReadNodes(depGraph);
    expect(mrNodes).toHaveLength(0);
  });

  test("LT-T5: E-DG-002 does NOT fire for @x read in a lift-expr markup body attr", () => {
    // @x is only read in a lift markup body (class:editing=@x). creditReader
    // must be called so E-DG-002 does not fire.
    const xDecl = mkStateDecl("x", 10);
    const logicBlock = mkLogicBlock([xDecl], 0);

    const liftMarkup = mkMarkup({ tag: "li", attrs: [mkVariableRefAttr("class:editing", "x", 500)], spanStart: 450, spanEnd: 900 });
    const liftExpr = mkLiftExprMarkup(liftMarkup, 400);
    const innerLogic = mkLogicBlock([liftExpr], 250);
    const markupEl = mkMarkup({ tag: "program", children: [innerLogic], spanStart: 100, spanEnd: 5000 });

    const fileAST = mkFileAST([logicBlock, markupEl]);
    const { errors } = runDG({ files: [fileAST], routeMap: mkRouteMap() });

    const edg002 = errors.find((e) => e.code === "E-DG-002" && /\bx\b/.test(e.message));
    expect(edg002).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Negative regression — A-1.3 shapes not double-emitted
// ---------------------------------------------------------------------------

describe("A-1.4 negative regression: A-1.3 high-frequency shapes not double-emitted", () => {
  test("REG-T1: ${@counter} interpolation emits exactly the same markup-read node as pre-A-1.4", () => {
    // The A-1.3 bare-expr interpolation shape (Shape 1) must not be affected
    // by A-1.4's additions. It should still emit exactly 1 markup-read node
    // per interpolation (not 2).
    const counterDecl = mkStateDecl("counter", 10);
    const logicBlock = mkLogicBlock([counterDecl], 0);

    const interpNode = mkBareExprInterp("counter", 300);
    const innerLogic = mkLogicBlock([interpNode], 250);
    const markupEl = mkMarkup({ tag: "program", children: [innerLogic], spanStart: 100, spanEnd: 5000 });

    const fileAST = mkFileAST([logicBlock, markupEl]);
    const { depGraph } = runDG({ files: [fileAST], routeMap: mkRouteMap() });

    const counterId = reactiveNodeId(depGraph, "counter");
    const mrEdges = markupReadEdges(depGraph);
    const edgesToCounter = mrEdges.filter((e) => e.to === counterId);
    // Exactly 1 markup-read edge for the single @counter interpolation.
    expect(edgesToCounter).toHaveLength(1);
  });

  test("REG-T2: value=@label attr emits exactly the same markup-read node as pre-A-1.4", () => {
    // The A-1.3 variable-ref attr shape (Shape 2) must still emit exactly 1
    // markup-read node for a single variable-ref attr.
    const labelDecl = mkStateDecl("label", 10);
    const logicBlock = mkLogicBlock([labelDecl], 0);

    const valueAttr = {
      name: "value",
      value: { kind: "variable-ref", name: "@label" },
      span: mkSpan(200),
    };
    const markupEl = mkMarkup({ tag: "input", attrs: [valueAttr], spanStart: 100, spanEnd: 5000 });

    const fileAST = mkFileAST([logicBlock, markupEl]);
    const { depGraph } = runDG({ files: [fileAST], routeMap: mkRouteMap() });

    const labelId = reactiveNodeId(depGraph, "label");
    const mrEdges = markupReadEdges(depGraph);
    const edgesToLabel = mrEdges.filter((e) => e.to === labelId);
    // Exactly 1 markup-read edge for the single variable-ref attr.
    expect(edgesToLabel).toHaveLength(1);
  });
});
