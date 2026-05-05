/**
 * Boundary Security Fix — Unit Tests
 *
 * Tests for the boundary security improvements:
 *   §1  Closure capture taint propagation (route-inference.ts)
 *   §2  Transitive reactive deps via call-graph BFS (reactive-deps.ts)
 *   §3  _ensureBoundary diagnostic fail-safe (emit-logic.ts)
 */

import { describe, test, expect } from "bun:test";
import { runRI } from "../../src/route-inference.js";
import {
  extractReactiveDeps,
  extractReactiveDepsTransitive,
  buildFunctionBodyRegistry,
} from "../../src/codegen/reactive-deps.js";

// ---------------------------------------------------------------------------
// Helpers — same style as route-inference.test.js
// ---------------------------------------------------------------------------

function span(start, file = "/test/app.scrml") {
  return { file, start, end: start + 10, line: 1, col: start + 1 };
}

function makeFunctionDecl({ name, params = [], body = [], isServer = false, spanStart = 10, file = "/test/app.scrml" }) {
  return {
    id: spanStart,
    kind: "function-decl",
    name,
    params,
    body,
    fnKind: "function",
    isServer,
    span: span(spanStart, file),
  };
}

function makeBareExpr(expr, spanStart = 20, file = "/test/app.scrml") {
  return { id: spanStart, kind: "bare-expr", expr, span: span(spanStart, file) };
}

function makeReactiveDecl(name, init, spanStart = 40, file = "/test/app.scrml") {
  return { id: spanStart, kind: "state-decl", name, init, span: span(spanStart, file) };
}

function makeReturnStmt(expr, spanStart = 50, file = "/test/app.scrml") {
  return { id: spanStart, kind: "return-stmt", expr, span: span(spanStart, file) };
}

function makeFileAST(filePath, fnNodes) {
  return {
    filePath,
    nodes: [{ id: 1, kind: "logic", body: fnNodes, span: span(0, filePath) }],
    imports: [],
    exports: [],
    components: [],
    typeDecls: [],
    spans: new Map(),
  };
}

function emptyProtectAnalysis() {
  return { views: new Map() };
}

function getRoute(routeMap, filePath, spanStart) {
  return routeMap.functions.get(`${filePath}::${spanStart}`);
}

// ---------------------------------------------------------------------------
// §1 — Closure capture taint propagation
// ---------------------------------------------------------------------------

describe("§1 — closure capture: function capturing server-tainted function", () => {
  test("function that captures (but does not call) a server function is server-tainted", () => {
    // serverFn is explicitly server
    // wrapperFn references serverFn but does not call it (passes as callback)
    const serverFn = makeFunctionDecl({
      name: "serverFn",
      isServer: true,
      body: [makeBareExpr("return Bun.file('data.txt')")],
      spanStart: 10,
    });
    const wrapperFn = makeFunctionDecl({
      name: "wrapperFn",
      body: [
        // References serverFn as a value, not a call
        makeBareExpr("const cb = serverFn"),
      ],
      spanStart: 100,
    });

    const fileAST = makeFileAST("/test/app.scrml", [serverFn, wrapperFn]);
    const { routeMap } = runRI({ files: [fileAST], protectAnalysis: emptyProtectAnalysis() });

    const serverRoute = getRoute(routeMap, "/test/app.scrml", 10);
    const wrapperRoute = getRoute(routeMap, "/test/app.scrml", 100);

    expect(serverRoute.boundary).toBe("server");
    expect(wrapperRoute.boundary).toBe("server");
    expect(wrapperRoute.escalationReasons.length).toBeGreaterThan(0);
    expect(wrapperRoute.escalationReasons.some(r => r.resourceType?.includes("closure-capture"))).toBe(true);
  });

  test("function that captures a pure (non-server) function stays client", () => {
    const pureFn = makeFunctionDecl({
      name: "pureFn",
      body: [makeBareExpr("return 42")],
      spanStart: 10,
    });
    const wrapperFn = makeFunctionDecl({
      name: "wrapperFn",
      body: [makeBareExpr("const cb = pureFn")],
      spanStart: 100,
    });

    const fileAST = makeFileAST("/test/app.scrml", [pureFn, wrapperFn]);
    const { routeMap } = runRI({ files: [fileAST], protectAnalysis: emptyProtectAnalysis() });

    const wrapperRoute = getRoute(routeMap, "/test/app.scrml", 100);
    expect(wrapperRoute.boundary).toBe("client");
  });

  test("transitive capture taint: A captures B, B captures server C", () => {
    // C is server
    const fnC = makeFunctionDecl({
      name: "fnC",
      isServer: true,
      body: [makeBareExpr("return Bun.env.SECRET")],
      spanStart: 10,
    });
    // B captures C (not calls)
    const fnB = makeFunctionDecl({
      name: "fnB",
      body: [makeBareExpr("const ref = fnC")],
      spanStart: 100,
    });
    // A captures B (not calls)
    const fnA = makeFunctionDecl({
      name: "fnA",
      body: [makeBareExpr("const ref = fnB")],
      spanStart: 200,
    });

    const fileAST = makeFileAST("/test/app.scrml", [fnC, fnB, fnA]);
    const { routeMap } = runRI({ files: [fileAST], protectAnalysis: emptyProtectAnalysis() });

    expect(getRoute(routeMap, "/test/app.scrml", 10).boundary).toBe("server");
    expect(getRoute(routeMap, "/test/app.scrml", 100).boundary).toBe("server");
    expect(getRoute(routeMap, "/test/app.scrml", 200).boundary).toBe("server");
  });

  test("calling a server function does NOT taint the caller (fetch stub design)", () => {
    // This is the existing behavior that must be preserved
    const serverFn = makeFunctionDecl({
      name: "serverFn",
      isServer: true,
      body: [makeBareExpr("return Bun.file('data.txt')")],
      spanStart: 10,
    });
    const callerFn = makeFunctionDecl({
      name: "callerFn",
      body: [makeBareExpr("serverFn()")],
      spanStart: 100,
    });

    const fileAST = makeFileAST("/test/app.scrml", [serverFn, callerFn]);
    const { routeMap } = runRI({ files: [fileAST], protectAnalysis: emptyProtectAnalysis() });

    expect(getRoute(routeMap, "/test/app.scrml", 10).boundary).toBe("server");
    // Caller stays client — uses fetch stub
    expect(getRoute(routeMap, "/test/app.scrml", 100).boundary).toBe("client");
  });

  test("fixed-point terminates with mutually-capturing functions", () => {
    // A captures B, B captures A — should not infinite loop
    const fnA = makeFunctionDecl({
      name: "fnA",
      body: [makeBareExpr("const ref = fnB")],
      spanStart: 10,
    });
    const fnB = makeFunctionDecl({
      name: "fnB",
      body: [makeBareExpr("const ref = fnA")],
      spanStart: 100,
    });

    const fileAST = makeFileAST("/test/app.scrml", [fnA, fnB]);
    const { routeMap } = runRI({ files: [fileAST], protectAnalysis: emptyProtectAnalysis() });

    // Both should be client (no server taint in the cycle)
    expect(getRoute(routeMap, "/test/app.scrml", 10).boundary).toBe("client");
    expect(getRoute(routeMap, "/test/app.scrml", 100).boundary).toBe("client");
  });

  test("fixed-point terminates with mutually-capturing functions where one is server", () => {
    // A captures B, B captures A, and A is server — both should be server
    const fnA = makeFunctionDecl({
      name: "fnA",
      isServer: true,
      body: [makeBareExpr("const ref = fnB; return Bun.env.X")],
      spanStart: 10,
    });
    const fnB = makeFunctionDecl({
      name: "fnB",
      body: [makeBareExpr("const ref = fnA")],
      spanStart: 100,
    });

    const fileAST = makeFileAST("/test/app.scrml", [fnA, fnB]);
    const { routeMap } = runRI({ files: [fileAST], protectAnalysis: emptyProtectAnalysis() });

    expect(getRoute(routeMap, "/test/app.scrml", 10).boundary).toBe("server");
    expect(getRoute(routeMap, "/test/app.scrml", 100).boundary).toBe("server");
  });
});

// ---------------------------------------------------------------------------
// §2 — Transitive reactive deps (Bug J fix)
// ---------------------------------------------------------------------------

describe("§2 — transitive reactive deps via call-graph BFS (Bug J)", () => {
  test("extractReactiveDeps finds direct @var references", () => {
    const deps = extractReactiveDeps("@msg + @count", null);
    expect(deps.has("msg")).toBe(true);
    expect(deps.has("count")).toBe(true);
  });

  test("extractReactiveDepsTransitive finds @var through helper function call", () => {
    // Simulate: function getMsg() { return @msg }
    // Expression: upperOf(getMsg())
    const fileAST = {
      nodes: [{
        id: 1,
        kind: "logic",
        body: [
          {
            id: 10,
            kind: "function-decl",
            name: "getMsg",
            params: [],
            body: [{
              id: 11,
              kind: "return-stmt",
              expr: "@msg",
              span: span(11),
            }],
            span: span(10),
          },
          {
            id: 20,
            kind: "function-decl",
            name: "upperOf",
            params: ["s"],
            body: [{
              id: 21,
              kind: "return-stmt",
              expr: "s.toUpperCase()",
              span: span(21),
            }],
            span: span(20),
          },
        ],
        span: span(0),
      }],
    };

    const registry = buildFunctionBodyRegistry(fileAST);
    const deps = extractReactiveDepsTransitive("upperOf(getMsg())", null, registry);

    expect(deps.has("msg")).toBe(true);
  });

  test("extractReactiveDepsTransitive finds @var through nested call chain", () => {
    // function getMsg() { return @msg }
    // function wrapMsg() { return getMsg() }
    // Expression: wrapMsg()
    const fileAST = {
      nodes: [{
        id: 1,
        kind: "logic",
        body: [
          {
            id: 10,
            kind: "function-decl",
            name: "getMsg",
            params: [],
            body: [{
              id: 11,
              kind: "return-stmt",
              expr: "@msg",
              span: span(11),
            }],
            span: span(10),
          },
          {
            id: 20,
            kind: "function-decl",
            name: "wrapMsg",
            params: [],
            body: [{
              id: 21,
              kind: "return-stmt",
              expr: "getMsg()",
              span: span(21),
            }],
            span: span(20),
          },
        ],
        span: span(0),
      }],
    };

    const registry = buildFunctionBodyRegistry(fileAST);
    const deps = extractReactiveDepsTransitive("wrapMsg()", null, registry);

    expect(deps.has("msg")).toBe(true);
  });

  test("extractReactiveDepsTransitive returns direct deps when no registry callee matches", () => {
    const registry = new Map();
    const deps = extractReactiveDepsTransitive("@count + unknownFn()", null, registry);

    expect(deps.has("count")).toBe(true);
    expect(deps.size).toBe(1);
  });

  test("extractReactiveDepsTransitive handles cyclic call graphs without infinite loop", () => {
    // function a() { return b() }
    // function b() { return a() }
    const fileAST = {
      nodes: [{
        id: 1,
        kind: "logic",
        body: [
          {
            id: 10,
            kind: "function-decl",
            name: "fnA",
            params: [],
            body: [{ id: 11, kind: "return-stmt", expr: "fnB()", span: span(11) }],
            span: span(10),
          },
          {
            id: 20,
            kind: "function-decl",
            name: "fnB",
            params: [],
            body: [{ id: 21, kind: "return-stmt", expr: "fnA()", span: span(21) }],
            span: span(20),
          },
        ],
        span: span(0),
      }],
    };

    const registry = buildFunctionBodyRegistry(fileAST);
    // Should not hang or throw
    const deps = extractReactiveDepsTransitive("fnA()", null, registry);
    expect(deps.size).toBe(0); // No @var in either function
  });

  test("buildFunctionBodyRegistry collects nested functions", () => {
    const fileAST = {
      nodes: [{
        id: 1,
        kind: "logic",
        body: [
          {
            id: 10,
            kind: "function-decl",
            name: "outer",
            params: [],
            body: [
              {
                id: 20,
                kind: "function-decl",
                name: "inner",
                params: [],
                body: [{ id: 21, kind: "return-stmt", expr: "@val", span: span(21) }],
                span: span(20),
              },
            ],
            span: span(10),
          },
        ],
        span: span(0),
      }],
    };

    const registry = buildFunctionBodyRegistry(fileAST);
    expect(registry.has("outer")).toBe(true);
    expect(registry.has("inner")).toBe(true);
  });

  test("Bug J reproducer pattern: record().text hides @msg", () => {
    // function record() { return { text: @msg, len: @msg.length } }
    // Expression: record().text
    const fileAST = {
      nodes: [{
        id: 1,
        kind: "logic",
        body: [
          {
            id: 10,
            kind: "function-decl",
            name: "record",
            params: [],
            body: [{
              id: 11,
              kind: "bare-expr",
              expr: "return { text: @msg, len: @msg.length }",
              span: span(11),
            }],
            span: span(10),
          },
        ],
        span: span(0),
      }],
    };

    const registry = buildFunctionBodyRegistry(fileAST);
    const deps = extractReactiveDepsTransitive("record().text", null, registry);

    expect(deps.has("msg")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §3 — _ensureBoundary diagnostic fail-safe
// ---------------------------------------------------------------------------

describe("§3 — _ensureBoundary diagnostic fail-safe (NC-4)", () => {
  test("emitLogicNode with explicit boundary does not throw", async () => {
    const { emitLogicNode } = await import("../../src/codegen/emit-logic.js");
    const node = { kind: "bare-expr", expr: "42", span: span(0) };

    // Should not throw
    const result = emitLogicNode(node, { boundary: "client" });
    expect(typeof result).toBe("string");
  });

  test("emitLogicNode with default opts does not throw", async () => {
    const { emitLogicNode } = await import("../../src/codegen/emit-logic.js");
    const node = { kind: "bare-expr", expr: "42", span: span(0) };

    // Default opts has boundary: "client"
    const result = emitLogicNode(node);
    expect(typeof result).toBe("string");
  });
});
