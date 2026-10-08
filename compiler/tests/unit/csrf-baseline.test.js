/**
 * Baseline CSRF Cookie Setting — Unit Tests
 *
 * Tests that the baseline CSRF double-submit cookie pattern correctly:
 *   - Calls _scrml_ensure_csrf_cookie() to get/generate the token
 *   - Emits a Set-Cookie header on successful responses
 *   - Uses the correct cookie name, path, and SameSite attribute
 *   - Wraps the body result in a Response object
 *   - Still validates the CSRF token (403 path intact)
 *   - Does NOT apply to GET/HEAD routes
 *   - Does NOT apply when auth middleware is configured
 *
 * Coverage:
 *   CB1  baseline handler emits _scrml_ensure_csrf_cookie call
 *   CB2  baseline handler emits Set-Cookie header in response
 *   CB3  baseline handler uses scrml_csrf cookie name
 *   CB4  baseline handler uses Path=/; SameSite=Strict
 *   CB5  baseline handler wraps body result in new Response()
 *   CB6  baseline handler still validates (403 path intact)
 *   CB7  GET routes do NOT get baseline CSRF cookie injection
 *   CB8  auth-middleware handlers do NOT get baseline CSRF cookie injection
 *   CB9  _scrml_ensure_csrf_cookie is called BEFORE _scrml_validate_csrf
 *   CB10 _scrml_result ?? null pattern used in response (handles undefined return)
 *   CB11 _scrml_ensure_csrf_cookie helper function is defined in server JS
 *   CB12 baseline CSRF path uses async IIFE to wrap body
 *   CB13 HEAD routes do NOT get baseline CSRF cookie injection
 *   CB14 POST route with params: params deserialized inside the IIFE
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
 * Build a standard POST server function + route map.
 * Returns { result, serverJs }.
 */
function makePostHandler(fnName, body = [], params = [], routeOpts = {}) {
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

// ---------------------------------------------------------------------------
// CB1: baseline handler emits _scrml_ensure_csrf_cookie call
// ---------------------------------------------------------------------------

describe("CB1: baseline handler emits _scrml_ensure_csrf_cookie call", () => {
  test("_scrml_ensure_csrf_cookie is called in POST handler", () => {
    const { serverJs } = makePostHandler("saveData", [
      makeReturnStmt('"ok"', span(110)),
    ]);
    expect(serverJs).toContain("_scrml_ensure_csrf_cookie(_scrml_req)");
  });
});

// ---------------------------------------------------------------------------
// CB2: baseline handler emits Set-Cookie header in response
// ---------------------------------------------------------------------------

describe("CB2: baseline handler emits Set-Cookie header", () => {
  test("Set-Cookie header present in successful response", () => {
    const { serverJs } = makePostHandler("saveData", [
      makeReturnStmt('"ok"', span(110)),
    ]);
    expect(serverJs).toContain("Set-Cookie");
  });
});

// ---------------------------------------------------------------------------
// CB3: baseline handler uses scrml_csrf cookie name
// ---------------------------------------------------------------------------

describe("CB3: Set-Cookie uses scrml_csrf cookie name", () => {
  test("cookie name is scrml_csrf", () => {
    const { serverJs } = makePostHandler("saveData", [
      makeReturnStmt('"ok"', span(110)),
    ]);
    expect(serverJs).toContain("scrml_csrf=");
  });
});

// ---------------------------------------------------------------------------
// CB4: baseline handler uses Path=/; SameSite=Strict
// ---------------------------------------------------------------------------

describe("CB4: Set-Cookie uses Path=/ and SameSite=Strict", () => {
  test("cookie has Path=/", () => {
    const { serverJs } = makePostHandler("saveData", [
      makeReturnStmt('"ok"', span(110)),
    ]);
    expect(serverJs).toContain("Path=/");
  });

  test("cookie has SameSite=Strict", () => {
    const { serverJs } = makePostHandler("saveData", [
      makeReturnStmt('"ok"', span(110)),
    ]);
    expect(serverJs).toContain("SameSite=Strict");
  });
});

// ---------------------------------------------------------------------------
// CB5: baseline handler wraps body result in new Response()
// ---------------------------------------------------------------------------

describe("CB5: baseline handler wraps result in new Response()", () => {
  test("handler returns new Response with status 200", () => {
    const { serverJs } = makePostHandler("saveData", [
      makeReturnStmt('"ok"', span(110)),
    ]);
    expect(serverJs).toContain("new _scrml_g.Response(");
    expect(serverJs).toContain("status: 200");
  });

  test("handler uses JSON.stringify on result", () => {
    const { serverJs } = makePostHandler("saveData", [
      makeReturnStmt('"ok"', span(110)),
    ]);
    expect(serverJs).toContain("JSON.stringify(_scrml_result");
  });
});

// ---------------------------------------------------------------------------
// CB6: baseline handler still validates — 403 path intact
// ---------------------------------------------------------------------------

describe("CB6: baseline CSRF validation (403 path) is intact", () => {
  test("_scrml_validate_csrf is still called", () => {
    const { serverJs } = makePostHandler("saveData", [
      makeReturnStmt('"ok"', span(110)),
    ]);
    expect(serverJs).toContain("_scrml_validate_csrf(_scrml_req)");
  });

  test("403 response is emitted for failed validation", () => {
    const { serverJs } = makePostHandler("saveData", [
      makeReturnStmt('"ok"', span(110)),
    ]);
    expect(serverJs).toContain("status: 403");
    expect(serverJs).toContain("CSRF validation failed");
  });
});

// ---------------------------------------------------------------------------
// CB7: GET routes do NOT get baseline CSRF cookie injection
// ---------------------------------------------------------------------------

describe("CB7: GET routes excluded from baseline CSRF", () => {
  test("GET handler does not emit _scrml_ensure_csrf_cookie", () => {
    const { serverJs } = makePostHandler("fetchData", [
      makeReturnStmt('"data"', span(110)),
    ], [], { explicitMethod: "GET" });
    expect(serverJs).not.toContain("_scrml_ensure_csrf_cookie");
  });

  test("GET handler does not emit Set-Cookie in response", () => {
    const { serverJs } = makePostHandler("fetchData", [
      makeReturnStmt('"data"', span(110)),
    ], [], { explicitMethod: "GET" });
    expect(serverJs).not.toContain("Set-Cookie");
  });

  test("GET handler does not emit baseline CSRF validation", () => {
    const { serverJs } = makePostHandler("fetchData", [
      makeReturnStmt('"data"', span(110)),
    ], [], { explicitMethod: "GET" });
    // The _scrml_validate_csrf function helper should not be defined either,
    // since hasStateMutatingRoutes is false for GET-only files
    expect(serverJs).not.toContain("_scrml_validate_csrf");
  });
});

// ---------------------------------------------------------------------------
// CB8: auth-middleware handlers do NOT get baseline CSRF cookie injection
// ---------------------------------------------------------------------------

describe("CB8: auth-middleware handlers excluded from baseline CSRF", () => {
  test("auth-protected handler does not emit _scrml_ensure_csrf_cookie", () => {
    const fnSpan = span(100);
    const fnNode = makeFunctionDecl("protectedSave", [
      makeReturnStmt('"saved"', span(110)),
    ], [], { span: fnSpan });

    const routeMap = makeRouteMap([{
      functionNodeId: "/test/app.scrml::100",
      boundary: "server",
      escalationReasons: [],
      generatedRouteName: "__ri_route_protectedSave_1",
      serverEntrySpan: fnSpan,
    }]);
    routeMap.authMiddleware = new Map([
      ["/test/app.scrml", {
        loginRedirect: "/login",
        csrf: "off",
        sessionExpiry: "1h",
      }],
    ]);

    const result = runCGForFile([makeLogicBlock([fnNode], span(90))], routeMap);
    const serverJs = result.outputs.get("/test/app.scrml").serverJs ?? "";

    expect(serverJs).not.toContain("_scrml_ensure_csrf_cookie");
  });

  test("auth-protected handler does not emit Set-Cookie for CSRF", () => {
    const fnSpan = span(100);
    const fnNode = makeFunctionDecl("protectedSave", [
      makeReturnStmt('"saved"', span(110)),
    ], [], { span: fnSpan });

    const routeMap = makeRouteMap([{
      functionNodeId: "/test/app.scrml::100",
      boundary: "server",
      escalationReasons: [],
      generatedRouteName: "__ri_route_protectedSave_1",
      serverEntrySpan: fnSpan,
    }]);
    routeMap.authMiddleware = new Map([
      ["/test/app.scrml", {
        loginRedirect: "/login",
        csrf: "off",
        sessionExpiry: "1h",
      }],
    ]);

    const result = runCGForFile([makeLogicBlock([fnNode], span(90))], routeMap);
    const serverJs = result.outputs.get("/test/app.scrml").serverJs ?? "";

    // Should not contain scrml_csrf Set-Cookie (the session destroy handler
    // sets scrml_sid, not scrml_csrf — verify the right one is absent)
    expect(serverJs).not.toContain("scrml_csrf=");
  });
});

// ---------------------------------------------------------------------------
// CB9: _scrml_ensure_csrf_cookie called BEFORE _scrml_validate_csrf
// ---------------------------------------------------------------------------

describe("CB9: ensure_csrf_cookie called before validate_csrf", () => {
  test("_scrml_ensure_csrf_cookie appears before _scrml_validate_csrf in output", () => {
    const { serverJs } = makePostHandler("saveData", [
      makeReturnStmt('"ok"', span(110)),
    ]);
    const ensureIdx = serverJs.indexOf("_scrml_ensure_csrf_cookie(_scrml_req)");
    const validateIdx = serverJs.indexOf("_scrml_validate_csrf(_scrml_req)");
    expect(ensureIdx).toBeGreaterThan(-1);
    expect(validateIdx).toBeGreaterThan(-1);
    expect(ensureIdx).toBeLessThan(validateIdx);
  });
});

// ---------------------------------------------------------------------------
// CB10: _scrml_result ?? null pattern in response
// ---------------------------------------------------------------------------

describe("CB10: _scrml_result ?? null handles undefined returns", () => {
  test("response uses _scrml_result ?? null", () => {
    const { serverJs } = makePostHandler("saveData", [
      makeReturnStmt('"ok"', span(110)),
    ]);
    expect(serverJs).toMatch(/_scrml_result\s*\?\?\s*null/);
  });
});

// ---------------------------------------------------------------------------
// CB11: _scrml_ensure_csrf_cookie helper defined in server JS
// ---------------------------------------------------------------------------

describe("CB11: _scrml_ensure_csrf_cookie helper function is defined", () => {
  test("helper function definition present in server JS", () => {
    const { serverJs } = makePostHandler("saveData", [
      makeReturnStmt('"ok"', span(110)),
    ]);
    expect(serverJs).toContain("function _scrml_ensure_csrf_cookie(req)");
  });

  test("helper reads Cookie header", () => {
    const { serverJs } = makePostHandler("saveData", [
      makeReturnStmt('"ok"', span(110)),
    ]);
    expect(serverJs).toContain("req.headers.get('Cookie')");
  });

  test("helper falls back to crypto.randomUUID()", () => {
    const { serverJs } = makePostHandler("saveData", [
      makeReturnStmt('"ok"', span(110)),
    ]);
    expect(serverJs).toContain("crypto.randomUUID()");
  });
});

// ---------------------------------------------------------------------------
// CB12: baseline CSRF path uses async IIFE to wrap body
// ---------------------------------------------------------------------------

describe("CB12: baseline CSRF handler wraps body in async IIFE", () => {
  test("async IIFE wrapper is emitted", () => {
    const { serverJs } = makePostHandler("saveData", [
      makeReturnStmt('"ok"', span(110)),
    ]);
    expect(serverJs).toContain("await (async () => {");
  });

  test("IIFE is assigned to _scrml_result", () => {
    const { serverJs } = makePostHandler("saveData", [
      makeReturnStmt('"ok"', span(110)),
    ]);
    expect(serverJs).toContain("const _scrml_result = await (async () => {");
  });

  test("IIFE is closed with })();", () => {
    const { serverJs } = makePostHandler("saveData", [
      makeReturnStmt('"ok"', span(110)),
    ]);
    expect(serverJs).toContain("})();");
  });
});

// ---------------------------------------------------------------------------
// CB13: HEAD routes do NOT get baseline CSRF cookie injection
// ---------------------------------------------------------------------------

describe("CB13: HEAD routes excluded from baseline CSRF", () => {
  test("HEAD handler does not emit _scrml_ensure_csrf_cookie", () => {
    const { serverJs } = makePostHandler("checkData", [
      makeReturnStmt('null', span(110)),
    ], [], { explicitMethod: "HEAD" });
    expect(serverJs).not.toContain("_scrml_ensure_csrf_cookie");
  });
});

// ---------------------------------------------------------------------------
// CB14: POST handler with params — params deserialized inside the IIFE
// ---------------------------------------------------------------------------

describe("CB14: params deserialized inside IIFE for baseline CSRF handlers", () => {
  test("param name appears inside IIFE (after async IIFE open)", () => {
    const { serverJs } = makePostHandler("saveItem", [
      makeReturnStmt('"saved"', span(110)),
    ], ["itemId", "data"]);

    // The IIFE should contain the param deserialization
    const iifeStart = serverJs.indexOf("await (async () => {");
    const iifeEnd = serverJs.indexOf("})();");
    expect(iifeStart).toBeGreaterThan(-1);
    expect(iifeEnd).toBeGreaterThan(iifeStart);

    const iifeBody = serverJs.slice(iifeStart, iifeEnd);
    expect(iifeBody).toContain("itemId");
    expect(iifeBody).toContain("data");
    expect(iifeBody).toContain("_scrml_body");
  });

  test("params not deserialized outside the IIFE", () => {
    const { serverJs } = makePostHandler("saveItem", [
      makeReturnStmt('"saved"', span(110)),
    ], ["secretParam"]);

    const iifeStart = serverJs.indexOf("await (async () => {");
    // Content before the IIFE should not contain param deserialization
    const beforeIife = serverJs.slice(0, iifeStart);
    expect(beforeIife).not.toContain("secretParam");
  });
});
