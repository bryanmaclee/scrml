/**
 * BUG-R14-008 — Server Functions Must Not Use _scrml_reactive_get()
 *
 * On the server, reactive state does not exist. Any `@varName` reference in a
 * server function body must resolve to `_scrml_body["varName"]` (the deserialized
 * POST body sent by the CPS client wrapper), NOT to `_scrml_reactive_get("varName")`
 * (the client-side reactive runtime call).
 *
 * This bug was reported from gauntlet R14: server codegen correctly extracts function
 * parameters from the request body but was not rewriting @reactive variable references
 * in the function body — they leaked through as _scrml_reactive_get() calls.
 *
 * Fix: emit-server.js wraps all emitLogicNode() output in serverRewriteEmitted(), which
 * replaces _scrml_reactive_get("x") and _scrml_derived_get("x") with _scrml_body["x"].
 * Direct expression rewrites (e.g. for reactive-decl init) use rewriteServerExpr().
 *
 * Coverage:
 *   SR1  bare-expr with @var: uses _scrml_body, not _scrml_reactive_get
 *   SR2  bare-expr with @var: no _scrml_reactive_get in server JS
 *   SR3  SQL call using @var param: uses _scrml_body, not _scrml_reactive_get
 *   SR4  let-decl with @var init: uses _scrml_body in server JS
 *   SR5  CPS-split server stmt: @var in reactive-decl init uses _scrml_body
 *   SR6  non-server (client) function still uses _scrml_reactive_get (no regression)
 *   SR7  multiple @var refs in same expression all rewritten to _scrml_body
 *   SR8  @var inside SQL ?{} param: uses _scrml_body, not _scrml_reactive_get
 */

import { describe, test, expect } from "bun:test";
import { runCG } from "../../src/code-generator.js";

// ---------------------------------------------------------------------------
// Helpers
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

function makeBareExpr(expr, s = span(0)) {
  return { kind: "bare-expr", expr, span: s };
}

function makeLetDecl(name, init, s = span(0)) {
  return { kind: "let-decl", name, init, span: s };
}

function makeReactiveDecl(name, init, s = span(0)) {
  return { kind: "state-decl", name, init, span: s };
}

function makeReturnStmt(expr, s = span(0)) {
  return { kind: "return-stmt", expr, span: s };
}

function makeRouteMap(entries = [], authMiddleware = null) {
  const functions = new Map();
  for (const e of entries) {
    functions.set(e.functionNodeId, e);
  }
  const result = { functions };
  if (authMiddleware) {
    result.authMiddleware = authMiddleware;
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
 * Build a server POST handler with arbitrary body statements.
 */
function makeServerHandler(fnName, body = [], params = [], routeOpts = {}) {
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
  const clientJs = result.outputs.get("/test/app.scrml").clientJs ?? "";
  return { result, serverJs, clientJs };
}

/**
 * Build a client-only function (no server route entry).
 */
function makeClientHandler(fnName, body = [], params = []) {
  const fnSpan = span(200);
  const fnNode = makeFunctionDecl(fnName, body, params, { span: fnSpan });
  const routeMap = makeRouteMap([]); // no server route
  const result = runCGForFile([makeLogicBlock([fnNode], span(190))], routeMap);
  const clientJs = result.outputs.get("/test/app.scrml").clientJs ?? "";
  return { result, clientJs };
}

// ---------------------------------------------------------------------------
// SR1: bare-expr with @var reference uses _scrml_body in server JS
// ---------------------------------------------------------------------------

describe("SR1: server bare-expr @var uses _scrml_body", () => {
  test("@newTitle reference in server function body becomes _scrml_body", () => {
    const { serverJs } = makeServerHandler("addEntry", [
      makeBareExpr(
        '_scrml_db.query("INSERT INTO entries (title) VALUES (?)").run(@newTitle)',
        span(110),
      ),
    ]);
    expect(serverJs).toContain('_scrml_body["newTitle"]');
  });
});

// ---------------------------------------------------------------------------
// SR2: _scrml_reactive_get must NOT appear in server function body output
// ---------------------------------------------------------------------------

describe("SR2: _scrml_reactive_get absent from server function body", () => {
  test("server JS does not contain _scrml_reactive_get for @var in body", () => {
    const { serverJs } = makeServerHandler("addEntry", [
      makeBareExpr(
        '_scrml_db.query("INSERT INTO entries (title) VALUES (?)").run(@newTitle)',
        span(110),
      ),
    ]);
    // The server JS may contain _scrml_reactive_get in the embedded runtime preamble
    // (which is unavoidable with embedRuntime:true), but it must NOT appear in the
    // handler body itself. Check that after the first function definition, there are
    // no _scrml_reactive_get("newTitle") calls.
    expect(serverJs).not.toContain('_scrml_reactive_get("newTitle")');
  });
});

// ---------------------------------------------------------------------------
// SR3: SQL call using @var param uses _scrml_body
// ---------------------------------------------------------------------------

describe("SR3: @var in SQL query parameter uses _scrml_body", () => {
  test("@userId in SQL query is rewritten to _scrml_body", () => {
    const { serverJs } = makeServerHandler("deleteUser", [
      makeBareExpr(
        '_scrml_db.query("DELETE FROM users WHERE id = ?").run(@userId)',
        span(110),
      ),
    ]);
    expect(serverJs).toContain('_scrml_body["userId"]');
    expect(serverJs).not.toContain('_scrml_reactive_get("userId")');
  });
});

// ---------------------------------------------------------------------------
// SR4: let-decl with @var init uses _scrml_body in server JS
// ---------------------------------------------------------------------------

describe("SR4: let-decl @var init uses _scrml_body in server context", () => {
  test("let title = @newTitle becomes _scrml_body in server handler", () => {
    const { serverJs } = makeServerHandler("createItem", [
      makeLetDecl("title", "@newTitle", span(110)),
      makeReturnStmt("title", span(120)),
    ]);
    expect(serverJs).toContain('_scrml_body["newTitle"]');
    expect(serverJs).not.toContain('_scrml_reactive_get("newTitle")');
  });
});

// ---------------------------------------------------------------------------
// SR5: CPS-split server stmt with reactive-decl init uses _scrml_body
// ---------------------------------------------------------------------------

describe("SR5: CPS-split reactive-decl init uses _scrml_body", () => {
  test("@var in reactive-decl init rewritten to _scrml_body when in serverStmtIndices", () => {
    // Simulate a CPS split: stmt at index 0 is the reactive-decl with server init,
    // the returnVarName is "result".
    const { serverJs } = makeServerHandler("submitForm", [
      makeReactiveDecl("result", '@formData + "-saved"', span(110)),
    ], [], {
      cpsSplit: {
        serverStmtIndices: [0],
        returnVarName: "result",
      },
    });
    expect(serverJs).toContain('_scrml_body["formData"]');
    expect(serverJs).not.toContain('_scrml_reactive_get("formData")');
  });
});

// ---------------------------------------------------------------------------
// SR6: client-side function still uses _scrml_reactive_get (no regression)
// ---------------------------------------------------------------------------

describe("SR6: client function @var still uses _scrml_reactive_get (no regression)", () => {
  test("@counter in client function becomes _scrml_reactive_get in client JS", () => {
    // A client-only function (no server route entry) must continue to use
    // _scrml_reactive_get for @var references.
    const { clientJs } = makeClientHandler("increment", [
      makeBareExpr("@counter + 1", span(210)),
    ]);
    expect(clientJs).toContain('_scrml_reactive_get("counter")');
  });
});

// ---------------------------------------------------------------------------
// SR7: multiple @var refs in same expression all rewritten
// ---------------------------------------------------------------------------

describe("SR7: multiple @var refs in one expression all use _scrml_body", () => {
  test("@firstName and @lastName both become _scrml_body in server JS", () => {
    const { serverJs } = makeServerHandler("createUser", [
      makeLetDecl("fullName", "@firstName + ' ' + @lastName", span(110)),
    ]);
    expect(serverJs).toContain('_scrml_body["firstName"]');
    expect(serverJs).toContain('_scrml_body["lastName"]');
    expect(serverJs).not.toContain('_scrml_reactive_get("firstName")');
    expect(serverJs).not.toContain('_scrml_reactive_get("lastName")');
  });
});

// ---------------------------------------------------------------------------
// SR8: @var in inline SQL ?{} param uses _scrml_body
// ---------------------------------------------------------------------------

describe("SR8: @var in inline SQL ?{} interpolation uses _scrml_body", () => {
  test("@searchTerm in SQL template literal becomes _scrml_body", () => {
    const { serverJs } = makeServerHandler("search", [
      makeBareExpr(
        '?{`SELECT * FROM items WHERE name LIKE ${@searchTerm}`}.all()',
        span(110),
      ),
    ]);
    expect(serverJs).toContain('_scrml_body["searchTerm"]');
    expect(serverJs).not.toContain('_scrml_reactive_get("searchTerm")');
  });
});
