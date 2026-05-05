/**
 * server function* SSE Generators (§36) — Unit Tests
 *
 * Tests for the full §36 feature pipeline:
 *   - TAB (ast-builder.js): `server function*` parses to function-decl with isGenerator=true
 *   - RI  (route-inference.js): generator server functions route as GET with isSSE=true
 *   - CG server (emit-server.js): isSSE functions emit ReadableStream / text/event-stream handler
 *   - CG client (emit-functions.js): isSSE functions emit EventSource stub with auto-cleanup
 *
 * All FileAST, RouteMap, and DepGraph inputs are constructed programmatically.
 * No real file parsing or SQLite is used.
 *
 * Coverage:
 *   §1  TAB: `server function*` produces isGenerator=true on function-decl
 *   §2  TAB: `server function` (no `*`) produces isGenerator=false (no regression)
 *   §3  TAB: `server function*` preserves name, params, body
 *   §4  TAB: span is present on the generator function-decl node
 *   §5  RI: generator server function routes as GET, isSSE=true
 *   §6  RI: non-generator server function routes as POST (no regression)
 *   §7  RI: generator function skips E-RI-002 (reactive assignment in body is allowed)
 *   §8  RI: isSSE=true in FunctionRoute entry
 *   §9  CG server: isSSE function emits ReadableStream handler
 *   §10 CG server: isSSE handler has text/event-stream Content-Type
 *   §11 CG server: isSSE handler uses GET method in route export
 *   §12 CG server: isSSE handler body uses async generator (_scrml_gen)
 *   §13 CG server: standard POST server function still emits POST handler (no regression)
 *   §14 CG client: isSSE function emits EventSource stub, not fetch()
 *   §15 CG client: EventSource stub registers cleanup via _scrml_cleanup_register
 *   §16 CG client: EventSource stub parses JSON from onmessage event
 *   §17 CG client: non-SSE server function still emits fetch stub (no regression)
 *   §18 Integration: full compile of a file with server function* produces valid server + client JS
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { runRI } from "../../src/route-inference.js";
import { generateServerJs } from "../../src/codegen/emit-server.js";
import { emitFunctions } from "../../src/codegen/emit-functions.js";
import { resetVarCounter } from "../../src/codegen/var-counter.ts";
import { runCG } from "../../src/code-generator.js";
import { BindingRegistry } from "../../src/codegen/binding-registry.ts";

/** Helper: build a minimal CompileContext from test params. */
function makeCompileCtx({ filePath, fnNodes, routeMap, depGraph }) {
  return {
    filePath,
    fileAST: { filePath, nodes: fnNodes },
    routeMap,
    depGraph,
    protectedFields: new Set(),
    authMiddleware: null,
    middlewareConfig: null,
    csrfEnabled: false,
    encodingCtx: null,
    mode: "browser",
    testMode: false,
    dbVar: "_scrml_db",
    workerNames: [],
    errors: [],
    registry: new BindingRegistry(),
    derivedNames: new Set(),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function span(start, file = "/test/app.scrml") {
  return { file, start, end: start + 10, line: 1, col: start + 1 };
}

/**
 * Parse scrml source through TAB and return the logic node body.
 */
function parseLogicBody(source) {
  const bsOut = splitBlocks("test.scrml", source);
  const { ast } = buildAST(bsOut);
  const logicNode = ast.nodes.find(n => n.kind === "logic");
  return logicNode ? logicNode.body : [];
}

/**
 * Build a minimal function-decl node with optional isGenerator flag.
 */
function makeFunctionDecl(opts = {}) {
  return {
    kind: "function-decl",
    name: opts.name ?? "testFn",
    params: opts.params ?? [],
    body: opts.body ?? [],
    fnKind: opts.fnKind ?? "function",
    isServer: opts.isServer ?? false,
    isGenerator: opts.isGenerator ?? false,
    canFail: opts.canFail ?? false,
    errorType: opts.errorType ?? null,
    route: opts.route ?? null,
    method: opts.method ?? null,
    span: span(opts.spanStart ?? 10, opts.file ?? "/test/app.scrml"),
  };
}

function makeBareExpr(expr, spanStart = 20, file = "/test/app.scrml") {
  return { kind: "bare-expr", expr, span: span(spanStart, file) };
}

function makeReactiveDecl(name, init, spanStart = 40) {
  return { kind: "state-decl", name, init, span: span(spanStart) };
}

function makeFileAST(filePath, fnNodes) {
  return {
    filePath,
    nodes: [
      {
        id: 1,
        kind: "logic",
        body: fnNodes,
        span: span(0, filePath),
      },
    ],
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

function makeRouteMap(entries = []) {
  const functions = new Map();
  for (const e of entries) {
    functions.set(e.functionNodeId, e);
  }
  return { functions };
}

function makeDepGraph(nodes = [], edges = []) {
  const nodeMap = new Map();
  for (const n of nodes) nodeMap.set(n.nodeId, n);
  return { nodes: nodeMap, edges };
}

function getRoute(routeMap, filePath, spanStart) {
  return routeMap.functions.get(`${filePath}::${spanStart}`);
}

// ---------------------------------------------------------------------------
// §1  TAB: `server function*` produces isGenerator=true
// ---------------------------------------------------------------------------

describe("§1 TAB: server function* produces isGenerator=true", () => {
  test("server function* sets isGenerator=true on the function-decl node", () => {
    const body = parseLogicBody("${ server function* streamData() { } }");
    const decl = body.find(n => n.kind === "function-decl");
    expect(decl).toBeDefined();
    expect(decl.isGenerator).toBe(true);
  });

  test("server function* preserves fnKind as 'function'", () => {
    const body = parseLogicBody("${ server function* streamData() { } }");
    const decl = body.find(n => n.kind === "function-decl");
    expect(decl.fnKind).toBe("function");
  });

  test("server function* preserves isServer=true", () => {
    const body = parseLogicBody("${ server function* streamData() { } }");
    const decl = body.find(n => n.kind === "function-decl");
    expect(decl.isServer).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §2  TAB: `server function` (no `*`) produces isGenerator=false (no regression)
// ---------------------------------------------------------------------------

describe("§2 TAB: server function (no *) produces isGenerator=false", () => {
  test("server function without * has isGenerator=false", () => {
    const body = parseLogicBody("${ server function getData() { } }");
    const decl = body.find(n => n.kind === "function-decl");
    expect(decl).toBeDefined();
    expect(decl.isGenerator).toBe(false);
  });

  test("plain function without server has isGenerator=false", () => {
    const body = parseLogicBody("${ function compute() { } }");
    const decl = body.find(n => n.kind === "function-decl");
    expect(decl).toBeDefined();
    expect(decl.isGenerator).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §3  TAB: `server function*` preserves name, params, body
// ---------------------------------------------------------------------------

describe("§3 TAB: server function* preserves name, params, body", () => {
  test("function name is captured correctly", () => {
    const body = parseLogicBody("${ server function* liveUpdates() { } }");
    const decl = body.find(n => n.kind === "function-decl");
    expect(decl.name).toBe("liveUpdates");
  });

  test("function params are captured correctly", () => {
    const body = parseLogicBody("${ server function* liveUpdates(userId, cursor) { } }");
    const decl = body.find(n => n.kind === "function-decl");
    expect(decl.params).toBeDefined();
    const paramNames = decl.params.map(p => typeof p === "string" ? p : p.name);
    expect(paramNames).toContain("userId");
    expect(paramNames).toContain("cursor");
  });
});

// ---------------------------------------------------------------------------
// §4  TAB: span is present on generator function-decl
// ---------------------------------------------------------------------------

describe("§4 TAB: generator function-decl node has a valid span", () => {
  test("function-decl from server function* has a span", () => {
    const body = parseLogicBody("${ server function* streamData() { } }");
    const decl = body.find(n => n.kind === "function-decl");
    expect(decl).toBeDefined();
    expect(decl.span).toBeDefined();
    expect(typeof decl.span.start).toBe("number");
    expect(typeof decl.span.end).toBe("number");
    expect(typeof decl.span.line).toBe("number");
    expect(typeof decl.span.col).toBe("number");
    expect(typeof decl.span.file).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// §5  RI: generator server function routes as GET, isSSE=true
// ---------------------------------------------------------------------------

describe("§5 RI: generator server function routes as GET with isSSE=true", () => {
  test("isGenerator=true server function gets isSSE=true in FunctionRoute", () => {
    const fn = makeFunctionDecl({ name: "liveData", isServer: true, isGenerator: true });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { routeMap } = runRI({ files: [fileAST], protectAnalysis: emptyProtectAnalysis() });

    const route = getRoute(routeMap, "/test/app.scrml", 10);
    expect(route).toBeDefined();
    expect(route.isSSE).toBe(true);
  });

  test("isSSE route has explicitMethod=GET (overridden by RI)", () => {
    const fn = makeFunctionDecl({ name: "liveData", isServer: true, isGenerator: true });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { routeMap } = runRI({ files: [fileAST], protectAnalysis: emptyProtectAnalysis() });

    const route = getRoute(routeMap, "/test/app.scrml", 10);
    expect(route.explicitMethod).toBe("GET");
  });

  test("isSSE route has boundary=server", () => {
    const fn = makeFunctionDecl({ name: "liveData", isServer: true, isGenerator: true });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { routeMap } = runRI({ files: [fileAST], protectAnalysis: emptyProtectAnalysis() });

    const route = getRoute(routeMap, "/test/app.scrml", 10);
    expect(route.boundary).toBe("server");
  });

  test("isSSE route has a generatedRouteName", () => {
    const fn = makeFunctionDecl({ name: "liveData", isServer: true, isGenerator: true });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { routeMap } = runRI({ files: [fileAST], protectAnalysis: emptyProtectAnalysis() });

    const route = getRoute(routeMap, "/test/app.scrml", 10);
    expect(route.generatedRouteName).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// §6  RI: non-generator server function routes as POST (no regression)
// ---------------------------------------------------------------------------

describe("§6 RI: non-generator server function still gets POST / isSSE=false", () => {
  test("isGenerator=false server function has isSSE=false", () => {
    const fn = makeFunctionDecl({ name: "saveData", isServer: true, isGenerator: false });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { routeMap } = runRI({ files: [fileAST], protectAnalysis: emptyProtectAnalysis() });

    const route = getRoute(routeMap, "/test/app.scrml", 10);
    expect(route.isSSE).toBeFalsy();
  });

  test("non-generator server function has explicitMethod=null (defaults to POST at CG)", () => {
    const fn = makeFunctionDecl({ name: "saveData", isServer: true, isGenerator: false });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { routeMap } = runRI({ files: [fileAST], protectAnalysis: emptyProtectAnalysis() });

    const route = getRoute(routeMap, "/test/app.scrml", 10);
    // Non-generator functions should not have their method forced to GET
    expect(route.explicitMethod).not.toBe("GET");
  });
});

// ---------------------------------------------------------------------------
// §7  RI: generator function skips E-RI-002 (reactive assignment in body allowed)
// ---------------------------------------------------------------------------

describe("§7 RI: generator server function body with reactive assignment does not produce E-RI-002", () => {
  test("reactive-decl in generator body does not trigger E-RI-002", () => {
    const fn = makeFunctionDecl({
      name: "streamUpdates",
      isServer: true,
      isGenerator: true,
      body: [makeReactiveDecl("count", "0")],
    });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { errors } = runRI({ files: [fileAST], protectAnalysis: emptyProtectAnalysis() });

    const riErrors = errors.filter(e => e.code === "E-RI-002");
    expect(riErrors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §8  RI: isSSE=true present as a boolean in FunctionRoute
// ---------------------------------------------------------------------------

describe("§8 RI: FunctionRoute.isSSE field shape", () => {
  test("isSSE is a boolean true for generator functions", () => {
    const fn = makeFunctionDecl({ name: "stream", isServer: true, isGenerator: true });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { routeMap } = runRI({ files: [fileAST], protectAnalysis: emptyProtectAnalysis() });

    const route = getRoute(routeMap, "/test/app.scrml", 10);
    expect(typeof route.isSSE).toBe("boolean");
    expect(route.isSSE).toBe(true);
  });

  test("isSSE is falsy for non-generator server functions", () => {
    const fn = makeFunctionDecl({ name: "fetch", isServer: true, isGenerator: false });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { routeMap } = runRI({ files: [fileAST], protectAnalysis: emptyProtectAnalysis() });

    const route = getRoute(routeMap, "/test/app.scrml", 10);
    expect(route.isSSE).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// §9  CG server: isSSE function emits ReadableStream handler
// ---------------------------------------------------------------------------

describe("§9 CG server: isSSE function emits ReadableStream", () => {
  beforeEach(() => resetVarCounter());

  test("server handler for isSSE contains ReadableStream", () => {
    const fnNode = makeFunctionDecl({
      name: "liveUpdates",
      isServer: true,
      isGenerator: true,
      spanStart: 10,
    });
    const fileAST = makeFileAST("/test/app.scrml", [fnNode]);
    const routeMap = makeRouteMap([{
      functionNodeId: "/test/app.scrml::10",
      boundary: "server",
      escalationReasons: [],
      generatedRouteName: "__ri_route_liveUpdates_1",
      serverEntrySpan: fnNode.span,
      isSSE: true,
      explicitMethod: "GET",
      explicitRoute: null,
      cpsSplit: null,
    }]);

    const serverJs = generateServerJs(fileAST, routeMap, [], null);

    expect(serverJs).toContain("ReadableStream");
  });

  test("server handler for isSSE contains TextEncoder", () => {
    const fnNode = makeFunctionDecl({
      name: "liveUpdates",
      isServer: true,
      isGenerator: true,
      spanStart: 10,
    });
    const fileAST = makeFileAST("/test/app.scrml", [fnNode]);
    const routeMap = makeRouteMap([{
      functionNodeId: "/test/app.scrml::10",
      boundary: "server",
      escalationReasons: [],
      generatedRouteName: "__ri_route_liveUpdates_1",
      serverEntrySpan: fnNode.span,
      isSSE: true,
      explicitMethod: "GET",
      explicitRoute: null,
      cpsSplit: null,
    }]);

    const serverJs = generateServerJs(fileAST, routeMap, [], null);

    expect(serverJs).toContain("TextEncoder");
  });
});

// ---------------------------------------------------------------------------
// §10 CG server: isSSE handler has text/event-stream Content-Type
// ---------------------------------------------------------------------------

describe("§10 CG server: isSSE handler sets text/event-stream Content-Type", () => {
  beforeEach(() => resetVarCounter());

  test("server handler for isSSE sets Content-Type: text/event-stream", () => {
    const fnNode = makeFunctionDecl({
      name: "liveUpdates",
      isServer: true,
      isGenerator: true,
      spanStart: 10,
    });
    const fileAST = makeFileAST("/test/app.scrml", [fnNode]);
    const routeMap = makeRouteMap([{
      functionNodeId: "/test/app.scrml::10",
      boundary: "server",
      escalationReasons: [],
      generatedRouteName: "__ri_route_liveUpdates_1",
      serverEntrySpan: fnNode.span,
      isSSE: true,
      explicitMethod: "GET",
      explicitRoute: null,
      cpsSplit: null,
    }]);

    const serverJs = generateServerJs(fileAST, routeMap, [], null);

    expect(serverJs).toContain("text/event-stream");
  });

  test("server handler for isSSE includes Cache-Control: no-cache", () => {
    const fnNode = makeFunctionDecl({
      name: "liveUpdates",
      isServer: true,
      isGenerator: true,
      spanStart: 10,
    });
    const fileAST = makeFileAST("/test/app.scrml", [fnNode]);
    const routeMap = makeRouteMap([{
      functionNodeId: "/test/app.scrml::10",
      boundary: "server",
      escalationReasons: [],
      generatedRouteName: "__ri_route_liveUpdates_1",
      serverEntrySpan: fnNode.span,
      isSSE: true,
      explicitMethod: "GET",
      explicitRoute: null,
      cpsSplit: null,
    }]);

    const serverJs = generateServerJs(fileAST, routeMap, [], null);

    expect(serverJs).toContain("no-cache");
  });
});

// ---------------------------------------------------------------------------
// §11 CG server: isSSE handler uses GET method in route export
// ---------------------------------------------------------------------------

describe("§11 CG server: isSSE route export has method GET", () => {
  beforeEach(() => resetVarCounter());

  test("route export for isSSE has method: GET", () => {
    const fnNode = makeFunctionDecl({
      name: "liveUpdates",
      isServer: true,
      isGenerator: true,
      spanStart: 10,
    });
    const fileAST = makeFileAST("/test/app.scrml", [fnNode]);
    const routeMap = makeRouteMap([{
      functionNodeId: "/test/app.scrml::10",
      boundary: "server",
      escalationReasons: [],
      generatedRouteName: "__ri_route_liveUpdates_1",
      serverEntrySpan: fnNode.span,
      isSSE: true,
      explicitMethod: "GET",
      explicitRoute: null,
      cpsSplit: null,
    }]);

    const serverJs = generateServerJs(fileAST, routeMap, [], null);

    expect(serverJs).toContain('"GET"');
    expect(serverJs).toContain("__ri_route_liveUpdates_1");
  });
});

// ---------------------------------------------------------------------------
// §12 CG server: isSSE handler body uses async generator pattern
// ---------------------------------------------------------------------------

describe("§12 CG server: isSSE handler wraps body in async generator", () => {
  beforeEach(() => resetVarCounter());

  test("server handler contains _scrml_gen async generator function", () => {
    const fnNode = makeFunctionDecl({
      name: "liveUpdates",
      isServer: true,
      isGenerator: true,
      spanStart: 10,
      body: [makeBareExpr("yield 1")],
    });
    const fileAST = makeFileAST("/test/app.scrml", [fnNode]);
    const routeMap = makeRouteMap([{
      functionNodeId: "/test/app.scrml::10",
      boundary: "server",
      escalationReasons: [],
      generatedRouteName: "__ri_route_liveUpdates_1",
      serverEntrySpan: fnNode.span,
      isSSE: true,
      explicitMethod: "GET",
      explicitRoute: null,
      cpsSplit: null,
    }]);

    const serverJs = generateServerJs(fileAST, routeMap, [], null);

    expect(serverJs).toContain("_scrml_gen");
    expect(serverJs).toContain("for await");
  });
});

// ---------------------------------------------------------------------------
// §13 CG server: standard POST server function still emits POST (no regression)
// ---------------------------------------------------------------------------

describe("§13 CG server: non-SSE server function still emits POST handler", () => {
  beforeEach(() => resetVarCounter());

  test("standard server function route export has method POST", () => {
    const fnNode = makeFunctionDecl({
      name: "saveData",
      isServer: true,
      isGenerator: false,
      spanStart: 10,
    });
    const fileAST = makeFileAST("/test/app.scrml", [fnNode]);
    const routeMap = makeRouteMap([{
      functionNodeId: "/test/app.scrml::10",
      boundary: "server",
      escalationReasons: [],
      generatedRouteName: "__ri_route_saveData_1",
      serverEntrySpan: fnNode.span,
      isSSE: false,
      explicitMethod: null,
      explicitRoute: null,
      cpsSplit: null,
    }]);

    const serverJs = generateServerJs(fileAST, routeMap, [], null);

    expect(serverJs).toContain("POST");
    expect(serverJs).not.toContain("text/event-stream");
    expect(serverJs).not.toContain("ReadableStream");
  });
});

// ---------------------------------------------------------------------------
// §14 CG client: isSSE function emits EventSource stub, not fetch()
// ---------------------------------------------------------------------------

describe("§14 CG client: isSSE function emits EventSource stub", () => {
  beforeEach(() => resetVarCounter());

  test("EventSource is used in client stub for isSSE function", () => {
    const fnNode = makeFunctionDecl({
      name: "liveUpdates",
      isServer: true,
      isGenerator: true,
      spanStart: 10,
    });
    const routeMap = makeRouteMap([{
      functionNodeId: "/test/app.scrml::10",
      boundary: "server",
      escalationReasons: [],
      generatedRouteName: "__ri_route_liveUpdates_1",
      serverEntrySpan: fnNode.span,
      isSSE: true,
      explicitMethod: "GET",
      explicitRoute: null,
      cpsSplit: null,
    }]);

    const { lines } = emitFunctions(makeCompileCtx({
      filePath: "/test/app.scrml",
      fnNodes: [fnNode],
      routeMap,
      depGraph: makeDepGraph(),
    }));
    const clientJs = lines.join("\n");

    expect(clientJs).toContain("EventSource");
    expect(clientJs).not.toContain("fetch(");
  });

  test("EventSource is initialized with the route path", () => {
    const fnNode = makeFunctionDecl({
      name: "liveUpdates",
      isServer: true,
      isGenerator: true,
      spanStart: 10,
    });
    const routeMap = makeRouteMap([{
      functionNodeId: "/test/app.scrml::10",
      boundary: "server",
      escalationReasons: [],
      generatedRouteName: "__ri_route_liveUpdates_1",
      serverEntrySpan: fnNode.span,
      isSSE: true,
      explicitMethod: "GET",
      explicitRoute: null,
      cpsSplit: null,
    }]);

    const { lines } = emitFunctions(makeCompileCtx({
      filePath: "/test/app.scrml",
      fnNodes: [fnNode],
      routeMap,
      depGraph: makeDepGraph(),
    }));
    const clientJs = lines.join("\n");

    expect(clientJs).toContain("/_scrml/__ri_route_liveUpdates_1");
  });
});

// ---------------------------------------------------------------------------
// §15 CG client: EventSource stub registers cleanup via _scrml_cleanup_register
// ---------------------------------------------------------------------------

describe("§15 CG client: EventSource stub registers cleanup", () => {
  beforeEach(() => resetVarCounter());

  test("cleanup_register is called with es.close() callback", () => {
    const fnNode = makeFunctionDecl({
      name: "liveUpdates",
      isServer: true,
      isGenerator: true,
      spanStart: 10,
    });
    const routeMap = makeRouteMap([{
      functionNodeId: "/test/app.scrml::10",
      boundary: "server",
      escalationReasons: [],
      generatedRouteName: "__ri_route_liveUpdates_1",
      serverEntrySpan: fnNode.span,
      isSSE: true,
      explicitMethod: "GET",
      explicitRoute: null,
      cpsSplit: null,
    }]);

    const { lines } = emitFunctions(makeCompileCtx({
      filePath: "/test/app.scrml",
      fnNodes: [fnNode],
      routeMap,
      depGraph: makeDepGraph(),
    }));
    const clientJs = lines.join("\n");

    expect(clientJs).toContain("_scrml_cleanup_register");
    expect(clientJs).toContain(".close()");
  });
});

// ---------------------------------------------------------------------------
// §16 CG client: EventSource stub parses JSON from onmessage event
// ---------------------------------------------------------------------------

describe("§16 CG client: EventSource stub parses JSON from onmessage", () => {
  beforeEach(() => resetVarCounter());

  test("onmessage handler calls JSON.parse on event.data", () => {
    const fnNode = makeFunctionDecl({
      name: "liveUpdates",
      isServer: true,
      isGenerator: true,
      spanStart: 10,
    });
    const routeMap = makeRouteMap([{
      functionNodeId: "/test/app.scrml::10",
      boundary: "server",
      escalationReasons: [],
      generatedRouteName: "__ri_route_liveUpdates_1",
      serverEntrySpan: fnNode.span,
      isSSE: true,
      explicitMethod: "GET",
      explicitRoute: null,
      cpsSplit: null,
    }]);

    const { lines } = emitFunctions(makeCompileCtx({
      filePath: "/test/app.scrml",
      fnNodes: [fnNode],
      routeMap,
      depGraph: makeDepGraph(),
    }));
    const clientJs = lines.join("\n");

    expect(clientJs).toContain("JSON.parse");
    expect(clientJs).toContain("onmessage");
  });
});

// ---------------------------------------------------------------------------
// §17 CG client: non-SSE server function still emits fetch stub (no regression)
// ---------------------------------------------------------------------------

describe("§17 CG client: non-SSE server function still emits fetch stub", () => {
  beforeEach(() => resetVarCounter());

  test("non-SSE server function emits fetch stub, not EventSource", () => {
    const fnNode = makeFunctionDecl({
      name: "saveData",
      isServer: true,
      isGenerator: false,
      spanStart: 10,
    });
    const routeMap = makeRouteMap([{
      functionNodeId: "/test/app.scrml::10",
      boundary: "server",
      escalationReasons: [],
      generatedRouteName: "__ri_route_saveData_1",
      serverEntrySpan: fnNode.span,
      isSSE: false,
      explicitMethod: null,
      explicitRoute: null,
      cpsSplit: null,
    }]);

    const { lines } = emitFunctions(makeCompileCtx({
      filePath: "/test/app.scrml",
      fnNodes: [fnNode],
      routeMap,
      depGraph: makeDepGraph(),
    }));
    const clientJs = lines.join("\n");

    expect(clientJs).toContain("fetch(");
    expect(clientJs).not.toContain("EventSource");
  });
});

// ---------------------------------------------------------------------------
// §18 Integration: full runCG compile of server function* produces valid outputs
// ---------------------------------------------------------------------------

describe("§18 Integration: full compile of server function* produces server + client JS", () => {
  beforeEach(() => resetVarCounter());

  test("runCG with isSSE function produces serverJs with ReadableStream and clientJs with EventSource", () => {
    const fnNode = {
      kind: "function-decl",
      name: "stockUpdates",
      params: [],
      body: [makeBareExpr("yield { price: 42 }")],
      fnKind: "function",
      isServer: true,
      isGenerator: true,
      canFail: false,
      errorType: null,
      route: null,
      method: null,
      span: span(100),
    };

    const fileAST = {
      filePath: "/test/app.scrml",
      nodes: [{ kind: "logic", body: [fnNode], span: span(90) }],
      imports: [],
      exports: [],
      components: [],
      typeDecls: [],
      nodeTypes: new Map(),
      componentShapes: new Map(),
      scopeChain: null,
    };

    const routeMap = makeRouteMap([{
      functionNodeId: "/test/app.scrml::100",
      boundary: "server",
      escalationReasons: [],
      generatedRouteName: "__ri_route_stockUpdates_1",
      serverEntrySpan: fnNode.span,
      isSSE: true,
      explicitMethod: "GET",
      explicitRoute: null,
      cpsSplit: null,
    }]);

    const result = runCG({
      files: [fileAST],
      routeMap,
      depGraph: makeDepGraph(),
      protectAnalysis: { views: new Map() },
    });

    expect(result.errors).toHaveLength(0);
    const out = result.outputs.get("/test/app.scrml");

    // Server side: ReadableStream SSE handler
    expect(out.serverJs).toBeTruthy();
    expect(out.serverJs).toContain("ReadableStream");
    expect(out.serverJs).toContain("text/event-stream");
    expect(out.serverJs).toContain('"GET"');
    expect(out.serverJs).toContain("__ri_route_stockUpdates_1");

    // Client side: EventSource stub
    expect(out.clientJs).toBeTruthy();
    expect(out.clientJs).toContain("EventSource");
    expect(out.clientJs).not.toContain("fetch(");
  });

  test("runCG with both SSE and standard server function produces both handler types", () => {
    const sseFn = {
      kind: "function-decl",
      name: "liveStream",
      params: [],
      body: [],
      fnKind: "function",
      isServer: true,
      isGenerator: true,
      canFail: false,
      errorType: null,
      route: null,
      method: null,
      span: span(100),
    };

    const stdFn = {
      kind: "function-decl",
      name: "submitForm",
      params: [],
      body: [],
      fnKind: "function",
      isServer: true,
      isGenerator: false,
      canFail: false,
      errorType: null,
      route: null,
      method: null,
      span: span(200),
    };

    const fileAST = {
      filePath: "/test/app.scrml",
      nodes: [{ kind: "logic", body: [sseFn, stdFn], span: span(90) }],
      imports: [],
      exports: [],
      components: [],
      typeDecls: [],
      nodeTypes: new Map(),
      componentShapes: new Map(),
      scopeChain: null,
    };

    const routeMap = makeRouteMap([
      {
        functionNodeId: "/test/app.scrml::100",
        boundary: "server",
        escalationReasons: [],
        generatedRouteName: "__ri_route_liveStream_1",
        serverEntrySpan: sseFn.span,
        isSSE: true,
        explicitMethod: "GET",
        explicitRoute: null,
        cpsSplit: null,
      },
      {
        functionNodeId: "/test/app.scrml::200",
        boundary: "server",
        escalationReasons: [],
        generatedRouteName: "__ri_route_submitForm_2",
        serverEntrySpan: stdFn.span,
        isSSE: false,
        explicitMethod: null,
        explicitRoute: null,
        cpsSplit: null,
      },
    ]);

    const result = runCG({
      files: [fileAST],
      routeMap,
      depGraph: makeDepGraph(),
      protectAnalysis: { views: new Map() },
    });

    expect(result.errors).toHaveLength(0);
    const out = result.outputs.get("/test/app.scrml");

    // Server: SSE handler present (GET/ReadableStream)
    expect(out.serverJs).toContain("ReadableStream");
    expect(out.serverJs).toContain('"GET"');

    // Server: standard POST handler present
    expect(out.serverJs).toContain("POST");

    // Client: EventSource stub for SSE function
    expect(out.clientJs).toContain("EventSource");

    // Client: fetch stub for standard function
    expect(out.clientJs).toContain("fetch(");
  });
});
