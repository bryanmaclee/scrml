/**
 * route.query wiring — Unit Tests (H-10, SPEC §20.3)
 *
 * Tests that every generated server function handler injects a `route` object
 * into its scope with a `query` property containing query string parameters.
 *
 * SPEC §20.3:
 *   route.query         — object — query string parameters (all values are string)
 *   route.query SHALL expose all query string key-value pairs
 *   All values SHALL have type string
 *   Empty query string SHALL produce empty object {}
 *
 * Coverage:
 *   RQ1  POST handler emits URL construction for route.query
 *   RQ2  POST handler emits Object.fromEntries(_scrml_url.searchParams)
 *   RQ3  POST handler exposes result as `route.query`
 *   RQ4  GET handler also emits route.query (all methods get the injection)
 *   RQ5  Auth-middleware handler emits route.query
 *   RQ6  route.query injection appears before auth check
 *   RQ7  route.query injection appears before CSRF check (within handler)
 *   RQ8  route.query injection appears before body deserialization
 *   RQ9  Multiple handlers in same file each get route.query injection
 *   RQ10 route.query comment references SPEC §20.3
 *   RQ11 URL fallback base uses 'http://localhost'
 */

import { describe, test, expect } from "bun:test";
import { runCG } from "../../src/code-generator.js";

// ---------------------------------------------------------------------------
// Helpers (modeled after csrf-baseline.test.js and session-auth.test.js)
// ---------------------------------------------------------------------------

function span(start, file = "/test/app.scrml") {
  return { file, start, end: start + 10, line: 1, col: start + 1 };
}

function makeFileAST(filePath, nodes, opts = {}) {
  return {
    filePath,
    nodes,
    imports: opts.imports ?? [],
    exports: opts.exports ?? [],
    components: opts.components ?? [],
    typeDecls: opts.typeDecls ?? [],
    nodeTypes: opts.nodeTypes ?? new Map(),
    componentShapes: opts.componentShapes ?? new Map(),
    scopeChain: opts.scopeChain ?? null,
  };
}

function makeLogicBlock(body = [], s = span(0)) {
  return { kind: "logic", body, span: s };
}

function makeFunctionDecl(name, body = [], params = [], opts = {}) {
  return {
    kind: "function-decl",
    name,
    params,
    body,
    span: opts.span ?? span(opts.spanStart ?? 0),
    isServer: opts.isServer ?? false,
  };
}

function makeReturnStmt(expr, s = span(0)) {
  return { kind: "return-stmt", expr, span: s };
}

/**
 * Build a routeMap with functions and optional auth middleware.
 * authMiddlewareEntry — if provided, must be an object with filePath property.
 *   It is stored in a Map<filePath, entry> as expected by the CG (per session-auth tests).
 */
function makeRouteMap(entries = [], authMiddlewareEntry = null) {
  const functions = new Map();
  for (const e of entries) {
    functions.set(e.functionNodeId, e);
  }
  const result = { functions };
  if (authMiddlewareEntry) {
    // CG expects routeMap.authMiddleware to be a Map<filePath, entry>
    result.authMiddleware = new Map([
      [authMiddlewareEntry.filePath, authMiddlewareEntry],
    ]);
  } else {
    result.authMiddleware = new Map();
  }
  return result;
}

function makeDepGraph(nodes = [], edges = []) {
  const nodeMap = new Map();
  for (const n of nodes) {
    nodeMap.set(n.nodeId, n);
  }
  return { nodes: nodeMap, edges };
}

function makeProtectAnalysis(views = new Map()) {
  return { views };
}

function runCGForFile(nodes, routeMap = makeRouteMap(), opts = {}) {
  const ast = makeFileAST("/test/app.scrml", nodes, opts);
  return runCG({
    files: [ast],
    routeMap,
    depGraph: makeDepGraph(),
    protectAnalysis: makeProtectAnalysis(),
    embedRuntime: true,
  });
}

/**
 * Build a server function + route map and return the serverJs output.
 * Produces a POST handler by default (no auth middleware).
 */
function makeHandler(fnName, body = [], params = [], routeOpts = {}) {
  const fnSpan = span(100);
  const fnNode = makeFunctionDecl(fnName, body, params, { span: fnSpan });
  const routeMap = makeRouteMap([{
    functionNodeId: "/test/app.scrml::100",
    boundary: "server",
    escalationReasons: [],
    generatedRouteName: `__ri_route_${fnName}_1`,
    serverEntrySpan: fnSpan,
    ...routeOpts,
  }]);
  const result = runCGForFile([makeLogicBlock([fnNode], span(90))], routeMap);
  const serverJs = result.outputs.get("/test/app.scrml").serverJs ?? "";
  return { result, serverJs };
}

/**
 * Build an auth-middleware handler and return serverJs.
 * authConfig shape mirrors what the CG expects from RI output.
 */
function makeAuthHandler(fnName, body = [], authConfig = {}) {
  const fnSpan = span(100);
  const fnNode = makeFunctionDecl(fnName, body, [], { span: fnSpan });
  const authEntry = {
    filePath: "/test/app.scrml",
    auth: "required",
    loginRedirect: "/login",
    csrf: "off",
    sessionExpiry: "1h",
    ...authConfig,
  };
  const routeMap = makeRouteMap([{
    functionNodeId: "/test/app.scrml::100",
    boundary: "server",
    escalationReasons: [],
    generatedRouteName: `__ri_route_${fnName}_1`,
    serverEntrySpan: fnSpan,
  }], authEntry);
  const result = runCGForFile([makeLogicBlock([fnNode], span(90))], routeMap);
  const serverJs = result.outputs.get("/test/app.scrml").serverJs ?? "";
  return { result, serverJs };
}

// ---------------------------------------------------------------------------
// RQ1: POST handler emits URL construction for route.query
// ---------------------------------------------------------------------------

describe("RQ1: POST handler emits URL construction", () => {
  test("new URL(_scrml_req.url, 'http://localhost') appears in POST handler", () => {
    const { serverJs } = makeHandler("getUser", [
      makeReturnStmt('"ok"', span(110)),
    ]);
    expect(serverJs).toContain("new URL(_scrml_req.url");
  });
});

// ---------------------------------------------------------------------------
// RQ2: POST handler emits Object.fromEntries for searchParams
// ---------------------------------------------------------------------------

describe("RQ2: POST handler emits Object.fromEntries(searchParams)", () => {
  test("Object.fromEntries(_scrml_url.searchParams) appears in POST handler", () => {
    const { serverJs } = makeHandler("getUser", [
      makeReturnStmt('"ok"', span(110)),
    ]);
    expect(serverJs).toContain("Object.fromEntries(_scrml_url.searchParams)");
  });
});

// ---------------------------------------------------------------------------
// RQ3: POST handler exposes result as route.query
// ---------------------------------------------------------------------------

describe("RQ3: route object has .query property", () => {
  test("const route = { query: ... } is emitted", () => {
    const { serverJs } = makeHandler("getUser", [
      makeReturnStmt('"ok"', span(110)),
    ]);
    expect(serverJs).toContain("const route = { query:");
  });
});

// ---------------------------------------------------------------------------
// RQ4: GET handler also emits route.query
// ---------------------------------------------------------------------------

describe("RQ4: GET handler emits route.query", () => {
  test("GET handler also gets route.query injection", () => {
    const { serverJs } = makeHandler("fetchUser", [
      makeReturnStmt('"ok"', span(110)),
    ], [], { explicitMethod: "GET" });
    expect(serverJs).toContain("const route = { query:");
    expect(serverJs).toContain("Object.fromEntries(_scrml_url.searchParams)");
  });
});

// ---------------------------------------------------------------------------
// RQ5: Auth-middleware handler emits route.query
// ---------------------------------------------------------------------------

describe("RQ5: auth-middleware handler emits route.query", () => {
  test("route.query is injected even when auth middleware is active", () => {
    const { serverJs } = makeAuthHandler("protectedAction", [
      makeReturnStmt('"ok"', span(110)),
    ]);
    expect(serverJs).toContain("const route = { query:");
    expect(serverJs).toContain("Object.fromEntries(_scrml_url.searchParams)");
  });
});

// ---------------------------------------------------------------------------
// RQ6: route.query injection appears before auth check
// ---------------------------------------------------------------------------

describe("RQ6: route.query injection precedes auth check", () => {
  test("_scrml_url appears before _scrml_auth_check in auth-middleware handlers", () => {
    const { serverJs } = makeAuthHandler("protectedPost", [
      makeReturnStmt('"ok"', span(110)),
    ]);

    const routeQueryPos = serverJs.indexOf("const _scrml_url = new URL");
    const authCheckPos = serverJs.indexOf("_scrml_auth_check(_scrml_req)");

    expect(routeQueryPos).toBeGreaterThanOrEqual(0);
    expect(authCheckPos).toBeGreaterThanOrEqual(0);
    expect(routeQueryPos).toBeLessThan(authCheckPos);
  });
});

// ---------------------------------------------------------------------------
// RQ7: route.query injection appears before CSRF check (within handler)
//
// The baseline CSRF helper _scrml_validate_csrf is defined as a module-level
// function before the handler. To test ordering within the handler we locate
// the generated handler's opening (genVar produces "_scrml_handler_<name>_N")
// and search the slice from that point onward.
// ---------------------------------------------------------------------------

describe("RQ7: route.query injection precedes CSRF validation call in handler", () => {
  test("route.query appears before if (!_scrml_validate_csrf(...)) in handler body", () => {
    const { serverJs } = makeHandler("submitForm", [
      makeReturnStmt('"ok"', span(110)),
    ]);

    // genVar produces _scrml_handler_submitForm_N — search for the prefix
    const handlerStart = serverJs.indexOf("async function _scrml_");
    expect(handlerStart).toBeGreaterThanOrEqual(0);

    const handlerSlice = serverJs.slice(handlerStart);
    const routeQueryPos = handlerSlice.indexOf("const _scrml_url = new URL");
    // The CSRF validation call (not definition) looks like: if (!_scrml_validate_csrf(
    const csrfCallPos = handlerSlice.indexOf("if (!_scrml_validate_csrf(");

    expect(routeQueryPos).toBeGreaterThanOrEqual(0);
    expect(csrfCallPos).toBeGreaterThanOrEqual(0);
    expect(routeQueryPos).toBeLessThan(csrfCallPos);
  });
});

// ---------------------------------------------------------------------------
// RQ8: route.query injection appears before body deserialization
// ---------------------------------------------------------------------------

describe("RQ8: route.query injection precedes body deserialization", () => {
  test("_scrml_url appears before _scrml_body in POST handlers", () => {
    const { serverJs } = makeHandler("createRecord", [
      makeReturnStmt('"ok"', span(110)),
    ]);

    const routeQueryPos = serverJs.indexOf("const _scrml_url = new URL");
    // dpa-030 D4 — the prologue is no longer a bare `await _scrml_req.json()`; it
    // is the bounded, fail-closed read (413 over the ceiling, 400 on malformed).
    // The INVARIANT this test exists for is unchanged: route.query injection
    // still precedes body deserialization. Only the marker moved.
    const bodyPos = serverJs.indexOf("const _scrml_body_read = await _scrml_read_json_body(");

    expect(routeQueryPos).toBeGreaterThanOrEqual(0);
    expect(bodyPos).toBeGreaterThanOrEqual(0);
    expect(routeQueryPos).toBeLessThan(bodyPos);
  });
});

// ---------------------------------------------------------------------------
// RQ9: Multiple handlers in same file each get route.query injection
// ---------------------------------------------------------------------------

describe("RQ9: multiple handlers each get route.query injection", () => {
  test("two POST handlers both contain route.query injection", () => {
    const fnSpan1 = span(100);
    const fnSpan2 = span(200);
    const fnNode1 = makeFunctionDecl("actionOne", [makeReturnStmt('"one"', span(110))], [], { span: fnSpan1 });
    const fnNode2 = makeFunctionDecl("actionTwo", [makeReturnStmt('"two"', span(210))], [], { span: fnSpan2 });

    const routeMap = makeRouteMap([
      {
        functionNodeId: "/test/app.scrml::100",
        boundary: "server",
        escalationReasons: [],
        generatedRouteName: "__ri_route_actionOne_1",
        serverEntrySpan: fnSpan1,
      },
      {
        functionNodeId: "/test/app.scrml::200",
        boundary: "server",
        escalationReasons: [],
        generatedRouteName: "__ri_route_actionTwo_1",
        serverEntrySpan: fnSpan2,
      },
    ]);

    const ast = makeFileAST("/test/app.scrml", [
      makeLogicBlock([fnNode1, fnNode2], span(90)),
    ]);
    const result = runCG({
      files: [ast],
      routeMap,
      depGraph: makeDepGraph(),
      protectAnalysis: makeProtectAnalysis(),
      embedRuntime: true,
    });
    const serverJs = result.outputs.get("/test/app.scrml").serverJs ?? "";

    // Count occurrences — should be 2, one per handler
    const occurrences = (serverJs.match(/const _scrml_url = new URL/g) ?? []).length;
    expect(occurrences).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// RQ10: route.query comment references SPEC §20.3
// ---------------------------------------------------------------------------

describe("RQ10: generated code includes SPEC §20.3 reference in comment", () => {
  test("comment references SPEC §20.3", () => {
    const { serverJs } = makeHandler("doAction", [
      makeReturnStmt('"ok"', span(110)),
    ]);
    expect(serverJs).toContain("SPEC §20.3");
  });
});

// ---------------------------------------------------------------------------
// RQ11: URL fallback base uses 'http://localhost'
// ---------------------------------------------------------------------------

describe("RQ11: URL fallback base is 'http://localhost'", () => {
  test("URL construction uses http://localhost as fallback base", () => {
    const { serverJs } = makeHandler("doAction", [
      makeReturnStmt('"ok"', span(110)),
    ]);
    expect(serverJs).toContain("'http://localhost'");
  });
});
