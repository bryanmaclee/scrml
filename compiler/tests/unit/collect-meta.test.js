/**
 * collect.js — collectTopLevelLogicStatements meta block tests
 *
 * Verifies that top-level `^{}` meta nodes (kind === "meta") at the file AST
 * root are yielded by collectTopLevelLogicStatements so that emitLogicNode
 * can emit them as IIFEs (SPEC §22.5).
 *
 * Coverage:
 *   §1  Top-level meta node at file root is collected
 *   §2  Meta node inside logic body is collected (regression guard)
 *   §3  Meta node is NOT duplicated when inside both root and logic
 *   §4  Logic body non-function statements are still collected (regression guard)
 *   §5  Function-decl nodes are NOT collected (regression guard)
 *   §6  Multiple top-level meta nodes are all collected
 *   §7  Meta node inside markup children is collected (^{} nested in markup)
 *   §8  Empty file AST produces empty result
 *   §9  Meta node with empty body is still yielded (emitLogicNode handles empty body)
 *   §10 Integration: collectTopLevelLogicStatements result routes through emitLogicNode
 */

import { describe, test, expect } from "bun:test";
import { collectTopLevelLogicStatements } from "../../src/codegen/collect.js";
import { emitLogicNode } from "../../src/codegen/emit-logic.js";
import { resetVarCounter } from "../../src/codegen/var-counter.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFileAST(nodes) {
  return {
    filePath: "/test/app.scrml",
    ast: { nodes },
  };
}

function metaNode(body = []) {
  return {
    kind: "meta",
    body,
    span: { file: "/test/app.scrml", start: 0, end: 10, line: 1, col: 1 },
  };
}

function logicNode(body = []) {
  return {
    kind: "logic",
    body,
    span: { file: "/test/app.scrml", start: 0, end: 10, line: 1, col: 1 },
  };
}

function bareExpr(expr) {
  return { kind: "bare-expr", expr };
}

function fnDecl(name) {
  return { kind: "function-decl", name, params: [], body: [] };
}

function markupNode(tag, children = []) {
  return { kind: "markup", tag, attrs: [], children };
}

// ---------------------------------------------------------------------------
// §1: Top-level meta node at file root is collected
// ---------------------------------------------------------------------------

describe("collect-meta §1: top-level meta node collected", () => {
  test("meta node at file root is in result", () => {
    const meta = metaNode([bareExpr("console.log('hi')")]);
    const fileAST = makeFileAST([meta]);
    const result = collectTopLevelLogicStatements(fileAST);
    expect(result).toContain(meta);
  });

  test("meta node is yielded as-is (not unwrapped)", () => {
    const meta = metaNode([bareExpr("x()")]);
    const fileAST = makeFileAST([meta]);
    const result = collectTopLevelLogicStatements(fileAST);
    expect(result.length).toBe(1);
    expect(result[0].kind).toBe("meta");
    expect(result[0]).toBe(meta);
  });
});

// ---------------------------------------------------------------------------
// §2: Meta node inside logic body is collected (regression guard)
// ---------------------------------------------------------------------------

describe("collect-meta §2: meta inside logic body still collected", () => {
  test("meta node inside ${ } logic body is collected", () => {
    const meta = metaNode([bareExpr("y()")]);
    const logic = logicNode([bareExpr("a = 1"), meta]);
    const fileAST = makeFileAST([logic]);
    const result = collectTopLevelLogicStatements(fileAST);
    // Both the bare-expr and the meta node should be collected from the logic body
    expect(result).toContain(meta);
  });

  test("non-meta statements in logic body are also collected", () => {
    const bare = bareExpr("doThing()");
    const meta = metaNode([bareExpr("metaOp()")]);
    const logic = logicNode([bare, meta]);
    const fileAST = makeFileAST([logic]);
    const result = collectTopLevelLogicStatements(fileAST);
    expect(result).toContain(bare);
    expect(result).toContain(meta);
  });
});

// ---------------------------------------------------------------------------
// §3: No duplication when both root and logic contain meta
// ---------------------------------------------------------------------------

describe("collect-meta §3: no duplication", () => {
  test("root meta and logic meta are separate items in result", () => {
    const rootMeta = metaNode([bareExpr("root()")]);
    const logicMeta = metaNode([bareExpr("logic()")]);
    const logic = logicNode([logicMeta]);
    const fileAST = makeFileAST([rootMeta, logic]);
    const result = collectTopLevelLogicStatements(fileAST);
    // Both should appear exactly once
    expect(result.filter(n => n === rootMeta).length).toBe(1);
    expect(result.filter(n => n === logicMeta).length).toBe(1);
    expect(result.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// §4: Logic body non-function statements are still collected (regression guard)
// ---------------------------------------------------------------------------

describe("collect-meta §4: logic body statements still collected", () => {
  test("bare-expr in logic body is collected", () => {
    const bare = bareExpr("counter++");
    const logic = logicNode([bare]);
    const fileAST = makeFileAST([logic]);
    const result = collectTopLevelLogicStatements(fileAST);
    expect(result).toContain(bare);
  });

  test("let-decl in logic body is collected", () => {
    const letDecl = { kind: "let-decl", name: "x", init: "1" };
    const logic = logicNode([letDecl]);
    const fileAST = makeFileAST([logic]);
    const result = collectTopLevelLogicStatements(fileAST);
    expect(result).toContain(letDecl);
  });
});

// ---------------------------------------------------------------------------
// §5: Function-decl nodes are NOT collected (regression guard)
// ---------------------------------------------------------------------------

describe("collect-meta §5: function-decl not collected", () => {
  test("function-decl inside logic body is skipped", () => {
    const fn = fnDecl("doThing");
    const logic = logicNode([fn]);
    const fileAST = makeFileAST([logic]);
    const result = collectTopLevelLogicStatements(fileAST);
    expect(result).not.toContain(fn);
  });
});

// ---------------------------------------------------------------------------
// §6: Multiple top-level meta nodes
// ---------------------------------------------------------------------------

describe("collect-meta §6: multiple top-level meta nodes", () => {
  test("all top-level meta nodes are collected", () => {
    const meta1 = metaNode([bareExpr("a()")]);
    const meta2 = metaNode([bareExpr("b()")]);
    const meta3 = metaNode([bareExpr("c()")]);
    const fileAST = makeFileAST([meta1, meta2, meta3]);
    const result = collectTopLevelLogicStatements(fileAST);
    expect(result).toContain(meta1);
    expect(result).toContain(meta2);
    expect(result).toContain(meta3);
    expect(result.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// §7: Meta node inside markup children
// ---------------------------------------------------------------------------

describe("collect-meta §7: meta inside markup children", () => {
  test("meta node nested inside a markup node's children is collected", () => {
    const meta = metaNode([bareExpr("inspect()")]);
    const markup = markupNode("div", [meta]);
    const fileAST = makeFileAST([markup]);
    const result = collectTopLevelLogicStatements(fileAST);
    expect(result).toContain(meta);
  });
});

// ---------------------------------------------------------------------------
// §8: Empty file AST
// ---------------------------------------------------------------------------

describe("collect-meta §8: empty file AST", () => {
  test("empty nodes array produces empty result", () => {
    const fileAST = makeFileAST([]);
    expect(collectTopLevelLogicStatements(fileAST)).toEqual([]);
  });

  test("fileAST with no ast field is handled gracefully", () => {
    const fileAST = { filePath: "/test/app.scrml" };
    expect(() => collectTopLevelLogicStatements(fileAST)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// §9: Meta node with empty body is still yielded
// ---------------------------------------------------------------------------

describe("collect-meta §9: meta with empty body is yielded", () => {
  test("empty-body meta is in result (emitLogicNode handles the empty case)", () => {
    const meta = metaNode([]);
    const fileAST = makeFileAST([meta]);
    const result = collectTopLevelLogicStatements(fileAST);
    expect(result).toContain(meta);
  });
});

// ---------------------------------------------------------------------------
// §10: Integration — collected meta node routes through emitLogicNode correctly
// ---------------------------------------------------------------------------

describe("collect-meta §10: integration with emitLogicNode", () => {
  test("collected top-level meta node emits IIFE via emitLogicNode", () => {
    resetVarCounter();
    // S458 r3: a runtime ^{} body may read only body-locals, meta primitives and captures.
    const meta = metaNode([bareExpr('meta.emit("doRuntimeOp")')]);
    const fileAST = makeFileAST([meta]);

    const stmts = collectTopLevelLogicStatements(fileAST);
    expect(stmts.length).toBe(1);
    expect(stmts[0].kind).toBe("meta");

    const output = emitLogicNode(stmts[0]);
    expect(output).toContain("_scrml_meta_effect(");
    expect(output).toContain('meta.emit("doRuntimeOp");');
    expect(output).toContain("function(meta)");
  });

  test("collected top-level meta with reactive ref emits rewritten effect", () => {
    resetVarCounter();
    const meta = metaNode([bareExpr("@count + 1")]);
    const fileAST = makeFileAST([meta]);

    const stmts = collectTopLevelLogicStatements(fileAST);
    const output = emitLogicNode(stmts[0]);
    expect(output).toContain('_scrml_reactive_get("count")');
    expect(output).not.toContain("@count");
    expect(output).toContain("_scrml_meta_effect(");
  });

  test("empty-body meta produces empty string from emitLogicNode (no IIFE emitted)", () => {
    resetVarCounter();
    const meta = metaNode([]);
    const fileAST = makeFileAST([meta]);

    const stmts = collectTopLevelLogicStatements(fileAST);
    expect(stmts.length).toBe(1);
    const output = emitLogicNode(stmts[0]);
    expect(output).toBe("");
  });
});
