/**
 * §39 Middleware and Request Pipeline — Unit Tests
 *
 * Tests for the two-tier middleware model:
 *   - Compiler-auto tier: cors=, log=, csrf=, ratelimit=, headers= on <program>
 *   - Escape-hatch tier: server function handle(request, resolve)
 *
 * Coverage:
 *   MW-CORS-001  cors="*" generates CORS OPTIONS route
 *   MW-CORS-002  cors="https://example.com" generates restricted origin header
 *   MW-CORS-003  no cors= attribute generates no CORS infrastructure
 *   MW-LOG-001   log="structured" generates JSON log emission
 *   MW-LOG-002   log="minimal" generates human-readable log emission
 *   MW-LOG-003   no log= (or log="off") generates no logging
 *   MW-CSRF-RETIRED  E-MW-001 retired at S80; csrf="on" no longer fires (was middleware-mode trigger; canonical csrf= is "auto"|"off" per §52.13)
 *   MW-RATE-001  ratelimit="100/min" generates sliding window rate limiter
 *   MW-RATE-002  ratelimit="badvalue" produces E-MW-002 error
 *   MW-HEADERS-001 headers="strict" generates security header injection
 *   MW-HANDLE-001  server function handle() is tagged isHandleEscapeHatch in AST
 *   MW-HANDLE-002  handle() body emitted inside _scrml_mw_wrap IIFE
 *   MW-HANDLE-003  combined cors="*" + log="structured" + handle() generates full pipeline
 *   MW-HANDLE-004  handle() with no middlewareConfig still generates _scrml_mw_wrap
 *   MW-HANDLE-005  handle() with no middlewareConfig wraps route handlers
 *   MW-ERR-005   two handle() definitions produce E-MW-005
 *   MW-ERR-006   handle() inside nested function body produces E-MW-006
 *   MW-WRAP-001  _scrml_mw_wrap function is generated when middlewareConfig is present
 *   MW-WRAP-002  route handler is wrapped with _scrml_mw_wrap in route export
 *   MW-NONE-001  files without any middleware attributes have no middleware overhead
 */

import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { runCG } from "../../src/code-generator.js";
import { buildAST } from "../../src/ast-builder.js";
import { splitBlocks } from "../../src/block-splitter.js";

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
    middlewareConfig: opts.middlewareConfig ?? null,
    authConfig: opts.authConfig ?? null,
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
    isGenerator: opts.isGenerator ?? false,
    isHandleEscapeHatch: opts.isHandleEscapeHatch ?? false,
    fnKind: "function",
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
  if (authMiddleware) result.authMiddleware = authMiddleware;
  return result;
}

function makeDepGraph() {
  return { nodes: new Map(), edges: [] };
}

function makeProtectAnalysis() {
  return { views: new Map() };
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

function makePostHandler(fnName, body = [], params = [], routeOpts = {}) {
  const fnSpan = span(100);
  const fnNode = makeFunctionDecl(fnName, body, params, { span: fnSpan, isServer: true });
  const routeMap = makeRouteMap([{
    functionNodeId: "/test/app.scrml::100",
    boundary: "server",
    escalationReasons: [],
    generatedRouteName: `__ri_route_${fnName}_1`,
    serverEntrySpan: fnSpan,
    ...routeOpts,
  }]);
  return { fnNode, routeMap };
}

function getServerJs(nodes, routeMap, middlewareConfig = null) {
  const result = runCGForFile(nodes, routeMap, { middlewareConfig });
  return result.outputs.get("/test/app.scrml")?.serverJs ?? "";
}

/**
 * Compile a scrml source string through the full pipeline and return the
 * TAB AST output (errors + ast).
 */
function parseSource(source, filePath = "/test/app.scrml") {
  const bsResult = splitBlocks(filePath, source);
  const tabResult = buildAST(bsResult);
  return tabResult;
}

// ---------------------------------------------------------------------------
// MW-CORS-001: cors="*" generates CORS OPTIONS route in server JS
// ---------------------------------------------------------------------------

describe("MW-CORS-001: cors='*' generates CORS OPTIONS route", () => {
  test("_scrml_cors_options_route is exported", () => {
    const { fnNode, routeMap } = makePostHandler("getData", [
      makeReturnStmt('"ok"', span(110)),
    ], [], { explicitMethod: "GET" });

    const serverJs = getServerJs(
      [makeLogicBlock([fnNode], span(90))],
      routeMap,
      { cors: "*", log: null, ratelimit: null, headers: null },
    );

    expect(serverJs).toContain("_scrml_cors_options_route");
    expect(serverJs).toContain("OPTIONS");
  });

  test("CORS headers function is generated", () => {
    const { fnNode, routeMap } = makePostHandler("getData", [
      makeReturnStmt('"ok"', span(110)),
    ], [], { explicitMethod: "GET" });

    const serverJs = getServerJs(
      [makeLogicBlock([fnNode], span(90))],
      routeMap,
      { cors: "*", log: null, ratelimit: null, headers: null },
    );

    expect(serverJs).toContain("_scrml_cors_headers");
    expect(serverJs).toContain("Access-Control-Allow-Origin");
  });

  test("cors='*' sets wildcard origin", () => {
    const { fnNode, routeMap } = makePostHandler("getData", [
      makeReturnStmt('"ok"', span(110)),
    ], [], { explicitMethod: "GET" });

    const serverJs = getServerJs(
      [makeLogicBlock([fnNode], span(90))],
      routeMap,
      { cors: "*", log: null, ratelimit: null, headers: null },
    );

    expect(serverJs).toContain('"*"');
  });
});

// ---------------------------------------------------------------------------
// MW-CORS-002: cors="https://example.com" generates restricted origin
// ---------------------------------------------------------------------------

describe("MW-CORS-002: cors='https://example.com' generates restricted origin", () => {
  test("origin value is the specific URL", () => {
    const { fnNode, routeMap } = makePostHandler("getData", [
      makeReturnStmt('"ok"', span(110)),
    ], [], { explicitMethod: "GET" });

    const serverJs = getServerJs(
      [makeLogicBlock([fnNode], span(90))],
      routeMap,
      { cors: "https://example.com", log: null, ratelimit: null, headers: null },
    );

    expect(serverJs).toContain("https://example.com");
    expect(serverJs).not.toContain('"*"');
  });
});

// ---------------------------------------------------------------------------
// MW-CORS-003: no cors= generates no CORS infrastructure
// ---------------------------------------------------------------------------

describe("MW-CORS-003: no cors= generates no CORS infrastructure", () => {
  test("no CORS helpers when cors= is absent", () => {
    const { fnNode, routeMap } = makePostHandler("getData", [
      makeReturnStmt('"ok"', span(110)),
    ], [], { explicitMethod: "GET" });

    const serverJs = getServerJs(
      [makeLogicBlock([fnNode], span(90))],
      routeMap,
      null, // no middleware at all
    );

    expect(serverJs).not.toContain("_scrml_cors_headers");
    expect(serverJs).not.toContain("Access-Control-Allow-Origin");
  });
});

// ---------------------------------------------------------------------------
// MW-LOG-001: log="structured" generates JSON log emission
// ---------------------------------------------------------------------------

describe("MW-LOG-001: log='structured' generates JSON log emission", () => {
  test("_scrml_log_request emits JSON.stringify", () => {
    const { fnNode, routeMap } = makePostHandler("getData", [
      makeReturnStmt('"ok"', span(110)),
    ], [], { explicitMethod: "GET" });

    const serverJs = getServerJs(
      [makeLogicBlock([fnNode], span(90))],
      routeMap,
      { cors: null, log: "structured", ratelimit: null, headers: null },
    );

    expect(serverJs).toContain("_scrml_log_request");
    expect(serverJs).toContain("JSON.stringify");
    expect(serverJs).toContain("toISOString");
  });
});

// ---------------------------------------------------------------------------
// MW-LOG-002: log="minimal" generates human-readable log emission
// ---------------------------------------------------------------------------

describe("MW-LOG-002: log='minimal' generates human-readable log", () => {
  test("_scrml_log_request does not use JSON.stringify", () => {
    const { fnNode, routeMap } = makePostHandler("getData", [
      makeReturnStmt('"ok"', span(110)),
    ], [], { explicitMethod: "GET" });

    const serverJs = getServerJs(
      [makeLogicBlock([fnNode], span(90))],
      routeMap,
      { cors: null, log: "minimal", ratelimit: null, headers: null },
    );

    expect(serverJs).toContain("_scrml_log_request");
    // minimal uses string concatenation, not JSON.stringify
    expect(serverJs).not.toContain("JSON.stringify({ ts:");
  });
});

// ---------------------------------------------------------------------------
// MW-LOG-003: no log= or log="off" generates no logging
// ---------------------------------------------------------------------------

describe("MW-LOG-003: no log= generates no logging infrastructure", () => {
  test("no logging helper when log is absent", () => {
    const { fnNode, routeMap } = makePostHandler("getData", [
      makeReturnStmt('"ok"', span(110)),
    ], [], { explicitMethod: "GET" });

    const serverJs = getServerJs(
      [makeLogicBlock([fnNode], span(90))],
      routeMap,
      { cors: null, log: null, ratelimit: null, headers: null },
    );

    expect(serverJs).not.toContain("_scrml_log_request");
  });

  test("no logging helper when log='off'", () => {
    const { fnNode, routeMap } = makePostHandler("getData", [
      makeReturnStmt('"ok"', span(110)),
    ], [], { explicitMethod: "GET" });

    const serverJs = getServerJs(
      [makeLogicBlock([fnNode], span(90))],
      routeMap,
      { cors: null, log: "off", ratelimit: null, headers: null },
    );

    expect(serverJs).not.toContain("_scrml_log_request");
  });
});

// ---------------------------------------------------------------------------
// MW-CSRF-RETIRED: csrf="on" + E-MW-001 retired at S80 (2026-05-11).
// Canonical value set is csrf="auto" | "off" per §52.13. Invalid literals
// (including "on") emit W-ATTR-002 via the attribute-registry. Per-route
// baseline CSRF (auto-emitted when no-auth + state-mutating routes) and
// auth-mode synchronizer-token CSRF (triggered by csrf="auto") have their
// own coverage in session-auth.test.js + sql-client-leak.test.js.
// ---------------------------------------------------------------------------

describe("MW-CSRF-RETIRED: E-MW-001 no longer fires for csrf='on'", () => {
  test("csrf='on' without auth produces no E-MW-001 error (code retired)", () => {
    const source = `<program csrf="on">
\${ server function getData() {
  return "ok"
} }
</program>`;

    const { errors } = parseSource(source);
    const mwError = errors.find(e => e.code === "E-MW-001");
    expect(mwError).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// MW-RATE-001: ratelimit="100/min" generates sliding window rate limiter
// ---------------------------------------------------------------------------

describe("MW-RATE-001: ratelimit='100/min' generates rate limiter", () => {
  test("rate limiter infrastructure is generated", () => {
    const { fnNode, routeMap } = makePostHandler("getData", [
      makeReturnStmt('"ok"', span(110)),
    ], [], { explicitMethod: "GET" });

    const serverJs = getServerJs(
      [makeLogicBlock([fnNode], span(90))],
      routeMap,
      { cors: null, log: null, ratelimit: "100/min", headers: null },
    );

    expect(serverJs).toContain("_scrml_check_ratelimit");
    expect(serverJs).toContain("_scrml_rate_limit");
    expect(serverJs).toContain("_scrml_rate_map");
    expect(serverJs).toContain("429");
    expect(serverJs).toContain("Retry-After");
  });

  test("rate limit window is 60000ms for /min", () => {
    const { fnNode, routeMap } = makePostHandler("getData", [
      makeReturnStmt('"ok"', span(110)),
    ], [], { explicitMethod: "GET" });

    const serverJs = getServerJs(
      [makeLogicBlock([fnNode], span(90))],
      routeMap,
      { cors: null, log: null, ratelimit: "100/min", headers: null },
    );

    expect(serverJs).toContain("60000");
  });

  test("rate limit window is 1000ms for /sec", () => {
    const { fnNode, routeMap } = makePostHandler("getData", [
      makeReturnStmt('"ok"', span(110)),
    ], [], { explicitMethod: "GET" });

    const serverJs = getServerJs(
      [makeLogicBlock([fnNode], span(90))],
      routeMap,
      { cors: null, log: null, ratelimit: "10/sec", headers: null },
    );

    expect(serverJs).toContain("1000");
  });

  test("rate limit window is 3600000ms for /hour", () => {
    const { fnNode, routeMap } = makePostHandler("getData", [
      makeReturnStmt('"ok"', span(110)),
    ], [], { explicitMethod: "GET" });

    const serverJs = getServerJs(
      [makeLogicBlock([fnNode], span(90))],
      routeMap,
      { cors: null, log: null, ratelimit: "1000/hour", headers: null },
    );

    expect(serverJs).toContain("3600000");
  });
});

// ---------------------------------------------------------------------------
// MW-RATE-002: ratelimit="badvalue" produces E-MW-002
// ---------------------------------------------------------------------------

describe("MW-RATE-002: invalid ratelimit= produces E-MW-002", () => {
  test("E-MW-002 error for malformed ratelimit value", () => {
    const source = `<program ratelimit="badvalue">
\${ server function getData() {
  return "ok"
} }
</program>`;

    const { errors } = parseSource(source);
    const mwError = errors.find(e => e.code === "E-MW-002");
    expect(mwError).toBeDefined();
    expect(mwError.message).toContain("E-MW-002");
    expect(mwError.message).toContain("badvalue");
  });

  test("E-MW-002 error includes the invalid value", () => {
    const source = `<program ratelimit="100requests">
\${ server function getData() { return "ok" } }
</program>`;

    const { errors } = parseSource(source);
    const mwError = errors.find(e => e.code === "E-MW-002");
    expect(mwError).toBeDefined();
    expect(mwError.message).toContain("100requests");
  });

  test("valid ratelimit formats do not produce E-MW-002", () => {
    for (const valid of ["100/min", "10/sec", "1000/hour"]) {
      const source = `<program ratelimit="${valid}">
\${ server function getData() { return "ok" } }
</program>`;
      const { errors } = parseSource(source);
      const mwError = errors.find(e => e.code === "E-MW-002");
      expect(mwError).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// MW-HEADERS-001: headers="strict" generates security header injection
// ---------------------------------------------------------------------------

describe("MW-HEADERS-001: headers='strict' generates security headers", () => {
  test("security header helper is generated", () => {
    const { fnNode, routeMap } = makePostHandler("getData", [
      makeReturnStmt('"ok"', span(110)),
    ], [], { explicitMethod: "GET" });

    const serverJs = getServerJs(
      [makeLogicBlock([fnNode], span(90))],
      routeMap,
      { cors: null, log: null, ratelimit: null, headers: "strict" },
    );

    expect(serverJs).toContain("_scrml_apply_security_headers");
    expect(serverJs).toContain("X-Content-Type-Options");
    expect(serverJs).toContain("nosniff");
    expect(serverJs).toContain("X-Frame-Options");
    expect(serverJs).toContain("SAMEORIGIN");
    expect(serverJs).toContain("Referrer-Policy");
    expect(serverJs).toContain("strict-origin-when-cross-origin");
    expect(serverJs).toContain("Content-Security-Policy");
    expect(serverJs).toContain("default-src 'self'");
  });
});

// ---------------------------------------------------------------------------
// MW-HANDLE-001: server function handle() is tagged isHandleEscapeHatch in AST
// ---------------------------------------------------------------------------

describe("MW-HANDLE-001: server function handle() tagged isHandleEscapeHatch", () => {
  test("server function handle() has isHandleEscapeHatch: true", () => {
    const source = `<program>
\${ server function handle(request, resolve) {
  return resolve(request)
} }
</program>`;

    const { ast } = parseSource(source);
    // Find the logic block and its function-decl
    let handleNode = null;
    const _allNodeLists = [ast.nodes ?? []];
    const _progNode = (ast.nodes ?? []).find(n => n?.kind === "markup" && n?.tag === "program");
    if (_progNode && Array.isArray(_progNode.children)) _allNodeLists.push(_progNode.children);
    outer: for (const _nodeList of _allNodeLists) {
      for (const node of _nodeList) {
        if (node?.kind !== "logic") continue;
        for (const stmt of (node.body ?? [])) {
          if (stmt?.kind === "function-decl" && stmt.name === "handle") {
            handleNode = stmt;
            break outer;
          }
        }
      }
    }
    expect(handleNode).not.toBeNull();
    expect(handleNode.isHandleEscapeHatch).toBe(true);
  });

  test("non-server function handle() does NOT have isHandleEscapeHatch: true", () => {
    const source = `<program>
\${ function handle(request, resolve) {
  return resolve(request)
} }
</program>`;

    const { ast } = parseSource(source);
    let handleNode = null;
    const _allNodeLists = [ast.nodes ?? []];
    const _progNode = (ast.nodes ?? []).find(n => n?.kind === "markup" && n?.tag === "program");
    if (_progNode && Array.isArray(_progNode.children)) _allNodeLists.push(_progNode.children);
    outer: for (const _nodeList of _allNodeLists) {
      for (const node of _nodeList) {
        if (node?.kind !== "logic") continue;
        for (const stmt of (node.body ?? [])) {
          if (stmt?.kind === "function-decl" && stmt.name === "handle") {
            handleNode = stmt;
            break outer;
          }
        }
      }
    }
    expect(handleNode).not.toBeNull();
    expect(handleNode.isHandleEscapeHatch).toBe(false);
  });

  test("server function handle generator does NOT have isHandleEscapeHatch: true", () => {
    // SSE generators should not be tagged as handle() escape hatches
    const source = `<program>
\${ server function* handle(req) {
  yield "data"
} }
</program>`;

    const { ast } = parseSource(source);
    let handleNode = null;
    const _allNodeLists = [ast.nodes ?? []];
    const _progNode = (ast.nodes ?? []).find(n => n?.kind === "markup" && n?.tag === "program");
    if (_progNode && Array.isArray(_progNode.children)) _allNodeLists.push(_progNode.children);
    outer: for (const _nodeList of _allNodeLists) {
      for (const node of _nodeList) {
        if (node?.kind !== "logic") continue;
        for (const stmt of (node.body ?? [])) {
          if (stmt?.kind === "function-decl" && stmt.name === "handle") {
            handleNode = stmt;
            break outer;
          }
        }
      }
    }
    expect(handleNode).not.toBeNull();
    expect(handleNode.isHandleEscapeHatch).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// MW-HANDLE-002: handle() body emitted inside _scrml_mw_wrap IIFE
// ---------------------------------------------------------------------------

describe("MW-HANDLE-002: handle() body emitted in _scrml_mw_wrap", () => {
  test("_scrml_mw_wrap is generated when handle() node is present", () => {
    const handleBody = [
      { kind: "return-stmt", expr: "resolve(request)", span: span(120) },
    ];
    const handleNode = makeFunctionDecl("handle", handleBody, ["request", "resolve"], {
      span: span(100),
      isServer: true,
      isHandleEscapeHatch: true,
    });

    const { fnNode: routeFn, routeMap } = makePostHandler("getData", [
      makeReturnStmt('"ok"', span(200)),
    ], [], { explicitMethod: "GET" });

    const serverJs = getServerJs(
      [makeLogicBlock([handleNode, routeFn], span(90))],
      routeMap,
      { cors: null, log: null, ratelimit: null, headers: null },
    );

    expect(serverJs).toContain("_scrml_mw_wrap");
    expect(serverJs).toContain("async () => {");
  });

  test("route handler is wrapped with _scrml_mw_wrap in route export", () => {
    const { fnNode, routeMap } = makePostHandler("getData", [
      makeReturnStmt('"ok"', span(110)),
    ], [], { explicitMethod: "GET" });

    const serverJs = getServerJs(
      [makeLogicBlock([fnNode], span(90))],
      routeMap,
      { cors: "*", log: null, ratelimit: null, headers: null },
    );

    expect(serverJs).toContain("_scrml_mw_wrap(");
  });
});

// ---------------------------------------------------------------------------
// MW-HANDLE-003: combined cors="*" + log="structured" + handle() generates full pipeline
// ---------------------------------------------------------------------------

describe("MW-HANDLE-003: combined middleware config generates full pipeline", () => {
  test("all middleware elements present in combined config", () => {
    const { fnNode, routeMap } = makePostHandler("getData", [
      makeReturnStmt('"ok"', span(110)),
    ], [], { explicitMethod: "GET" });

    const serverJs = getServerJs(
      [makeLogicBlock([fnNode], span(90))],
      routeMap,
      { cors: "*", log: "structured", ratelimit: "100/min", headers: "strict" },
    );

    // CORS
    expect(serverJs).toContain("_scrml_cors_options_route");
    // Logging
    expect(serverJs).toContain("_scrml_log_request");
    expect(serverJs).toContain("JSON.stringify");
    // Rate limiter
    expect(serverJs).toContain("_scrml_check_ratelimit");
    // Security headers
    expect(serverJs).toContain("_scrml_apply_security_headers");
    // Wrapper
    expect(serverJs).toContain("_scrml_mw_wrap");
  });
});

// ---------------------------------------------------------------------------
// MW-HANDLE-004: handle() with no middlewareConfig still generates _scrml_mw_wrap
//
// BUG-R13-004 fix: handle() must be woven into the pipeline even when
// middlewareConfig is null (no compiler-auto middleware attrs on <program>).
// ---------------------------------------------------------------------------

describe("MW-HANDLE-004: handle() with no middlewareConfig generates _scrml_mw_wrap", () => {
  test("_scrml_mw_wrap is generated when only handle() is present (no middlewareConfig)", () => {
    // handle() node at span 50, regular server fn at span 100
    const handleBody = [
      { kind: "return-stmt", expr: "resolve(request)", span: span(60) },
    ];
    const handleNode = makeFunctionDecl("handle", handleBody, ["request", "resolve"], {
      span: span(50),
      isServer: true,
      isHandleEscapeHatch: true,
    });

    const { fnNode: routeFn, routeMap } = makePostHandler("getData", [
      makeReturnStmt('"ok"', span(110)),
    ], [], { explicitMethod: "GET" });

    // Pass null for middlewareConfig — the critical case for BUG-R13-004
    const serverJs = getServerJs(
      [makeLogicBlock([handleNode, routeFn], span(40))],
      routeMap,
      null, // no compiler-auto middleware
    );

    expect(serverJs).toContain("function _scrml_mw_wrap(");
  });

  test("handle() IIFE is emitted inside _scrml_mw_wrap when no middlewareConfig", () => {
    const handleBody = [
      { kind: "let-decl", name: "start", init: "Date.now()", span: span(60) },
      { kind: "let-decl", name: "resp", init: "resolve(request)", span: span(70) },
      { kind: "return-stmt", expr: "resp", span: span(80) },
    ];
    const handleNode = makeFunctionDecl("handle", handleBody, ["request", "resolve"], {
      span: span(50),
      isServer: true,
      isHandleEscapeHatch: true,
    });

    const { fnNode: routeFn, routeMap } = makePostHandler("getData", [
      makeReturnStmt('"ok"', span(110)),
    ], [], { explicitMethod: "GET" });

    const serverJs = getServerJs(
      [makeLogicBlock([handleNode, routeFn], span(40))],
      routeMap,
      null, // no compiler-auto middleware
    );

    // The handle() escape hatch comment and IIFE should be present
    expect(serverJs).toContain("handle() escape hatch body");
    expect(serverJs).toContain("async () => {");
    // resolve() function should be generated inside the IIFE
    expect(serverJs).toContain("const resolve = async");
  });

  test("handle() with early return (no resolve call) generates _scrml_mw_wrap when no middlewareConfig", () => {
    // §39.3.5: early return without resolve() is valid
    const handleBody = [
      { kind: "return-stmt", expr: "new Response('Forbidden', { status: 403 })", span: span(60) },
    ];
    const handleNode = makeFunctionDecl("handle", handleBody, ["request", "resolve"], {
      span: span(50),
      isServer: true,
      isHandleEscapeHatch: true,
    });

    const { fnNode: routeFn, routeMap } = makePostHandler("getData", [
      makeReturnStmt('"ok"', span(110)),
    ], [], { explicitMethod: "GET" });

    const serverJs = getServerJs(
      [makeLogicBlock([handleNode, routeFn], span(40))],
      routeMap,
      null, // no compiler-auto middleware
    );

    expect(serverJs).toContain("function _scrml_mw_wrap(");
    expect(serverJs).toContain("async () => {");
  });
});

// ---------------------------------------------------------------------------
// MW-HANDLE-005: handle() with no middlewareConfig wraps route handlers
//
// BUG-R13-004 fix: route exports must use _scrml_mw_wrap(handler) when
// handle() is present, even when middlewareConfig is null.
// ---------------------------------------------------------------------------

describe("MW-HANDLE-005: handle() with no middlewareConfig wraps route exports", () => {
  test("route export uses _scrml_mw_wrap when handle() present and no middlewareConfig", () => {
    const handleBody = [
      { kind: "return-stmt", expr: "resolve(request)", span: span(60) },
    ];
    const handleNode = makeFunctionDecl("handle", handleBody, ["request", "resolve"], {
      span: span(50),
      isServer: true,
      isHandleEscapeHatch: true,
    });

    const { fnNode: routeFn, routeMap } = makePostHandler("getData", [
      makeReturnStmt('"ok"', span(110)),
    ], [], { explicitMethod: "GET" });

    const serverJs = getServerJs(
      [makeLogicBlock([handleNode, routeFn], span(40))],
      routeMap,
      null, // no compiler-auto middleware
    );

    // The route handler export must reference _scrml_mw_wrap(...)
    expect(serverJs).toMatch(/_scrml_mw_wrap\(_scrml_handler_/);
  });

  test("route export does NOT use _scrml_mw_wrap when neither handle() nor middlewareConfig present", () => {
    // Regression: no handle(), no middlewareConfig → no wrapping (MW-NONE-001 behavior preserved)
    const { fnNode, routeMap } = makePostHandler("getData", [
      makeReturnStmt('"ok"', span(110)),
    ], [], { explicitMethod: "GET" });

    const serverJs = getServerJs(
      [makeLogicBlock([fnNode], span(90))],
      routeMap,
      null, // no middleware
    );

    expect(serverJs).not.toContain("_scrml_mw_wrap");
  });

  test("handle() with custom request param name is aliased correctly", () => {
    // handle(req, resolve) — 'req' not 'request' — alias must be generated
    const handleBody = [
      { kind: "return-stmt", expr: "resolve(req)", span: span(60) },
    ];
    const handleNode = makeFunctionDecl("handle", handleBody, ["req", "resolve"], {
      span: span(50),
      isServer: true,
      isHandleEscapeHatch: true,
    });

    const { fnNode: routeFn, routeMap } = makePostHandler("getData", [
      makeReturnStmt('"ok"', span(110)),
    ], [], { explicitMethod: "GET" });

    const serverJs = getServerJs(
      [makeLogicBlock([handleNode, routeFn], span(40))],
      routeMap,
      null, // no compiler-auto middleware
    );

    // The alias 'const req = _scrml_mw_req' must appear
    expect(serverJs).toContain("const req = _scrml_mw_req");
  });
});

// ---------------------------------------------------------------------------
// MW-ERR-005: two handle() definitions produce E-MW-005
// ---------------------------------------------------------------------------

describe("MW-ERR-005: duplicate handle() produces E-MW-005", () => {
  test("E-MW-005 when two server function handle() defined", () => {
    const source = `<program>
\${ server function handle(request, resolve) {
  return resolve(request)
}

server function handle(request, resolve) {
  return resolve(request)
} }
</program>`;

    const { errors } = parseSource(source);
    const mwError = errors.find(e => e.code === "E-MW-005");
    expect(mwError).toBeDefined();
    expect(mwError.message).toContain("E-MW-005");
    expect(mwError.message).toContain("line");
  });

  test("single handle() does not produce E-MW-005", () => {
    const source = `<program>
\${ server function handle(request, resolve) {
  return resolve(request)
} }
</program>`;

    const { errors } = parseSource(source);
    const mwError = errors.find(e => e.code === "E-MW-005");
    expect(mwError).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// MW-ERR-006: handle() inside nested function body produces E-MW-006
// ---------------------------------------------------------------------------

describe("MW-ERR-006: nested handle() detection (Phase 1 best-effort)", () => {
  test("handle() at file top level (inside <program> children) is NOT flagged as E-MW-006", () => {
    // A top-level server function handle() should NOT produce E-MW-006.
    // It's valid at top level.
    const source = `<program>
\${ server function handle(request, resolve) {
  return resolve(request)
} }
</program>`;

    const { errors } = parseSource(source);
    const mwError = errors.find(e => e.code === "E-MW-006");
    expect(mwError).toBeUndefined();
  });

  // NOTE: Phase 1 limitation — parseOneStatement() does not handle `server function`
  // combinations inside function bodies. Nested server function handle() declarations
  // are parsed as bare-expr nodes, so E-MW-006 cannot be triggered statically from
  // parsing alone. E-MW-006 detection for deeply nested cases is deferred to Phase 2.
  test("non-handle function at top level is not flagged", () => {
    const source = `<program>
\${ server function getData() {
  return "ok"
} }
</program>`;

    const { errors } = parseSource(source);
    const mwError = errors.find(e => e.code === "E-MW-006");
    expect(mwError).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// MW-WRAP-001: _scrml_mw_wrap is generated when middlewareConfig is present
// ---------------------------------------------------------------------------

describe("MW-WRAP-001: _scrml_mw_wrap generated with any middlewareConfig", () => {
  test("_scrml_mw_wrap present for cors= only config", () => {
    const { fnNode, routeMap } = makePostHandler("getData", [
      makeReturnStmt('"ok"', span(110)),
    ], [], { explicitMethod: "GET" });

    const serverJs = getServerJs(
      [makeLogicBlock([fnNode], span(90))],
      routeMap,
      { cors: "*", log: null, ratelimit: null, headers: null },
    );

    expect(serverJs).toContain("function _scrml_mw_wrap(");
  });

  test("_scrml_mw_wrap present for headers= only config", () => {
    const { fnNode, routeMap } = makePostHandler("getData", [
      makeReturnStmt('"ok"', span(110)),
    ], [], { explicitMethod: "GET" });

    const serverJs = getServerJs(
      [makeLogicBlock([fnNode], span(90))],
      routeMap,
      { cors: null, log: null, ratelimit: null, headers: "strict" },
    );

    expect(serverJs).toContain("function _scrml_mw_wrap(");
  });
});

// ---------------------------------------------------------------------------
// MW-WRAP-002: route handler export uses _scrml_mw_wrap
// ---------------------------------------------------------------------------

describe("MW-WRAP-002: route export uses _scrml_mw_wrap when middleware present", () => {
  test("route handler line references _scrml_mw_wrap", () => {
    const { fnNode, routeMap } = makePostHandler("getData", [
      makeReturnStmt('"ok"', span(110)),
    ], [], { explicitMethod: "GET" });

    const serverJs = getServerJs(
      [makeLogicBlock([fnNode], span(90))],
      routeMap,
      { cors: "*", log: null, ratelimit: null, headers: null },
    );

    // The handler in the route export should be wrapped
    expect(serverJs).toMatch(/_scrml_mw_wrap\(_scrml_handler_/);
  });

  test("without middleware, route handler is NOT wrapped", () => {
    const { fnNode, routeMap } = makePostHandler("getData", [
      makeReturnStmt('"ok"', span(110)),
    ], [], { explicitMethod: "GET" });

    const serverJs = getServerJs(
      [makeLogicBlock([fnNode], span(90))],
      routeMap,
      null, // no middleware
    );

    // Without middleware, handler is direct reference (not wrapped)
    expect(serverJs).not.toContain("_scrml_mw_wrap");
  });
});

// ---------------------------------------------------------------------------
// MW-NONE-001: files without middleware attributes have no overhead
// ---------------------------------------------------------------------------

describe("MW-NONE-001: no middleware attributes means no middleware infrastructure", () => {
  test("server file with no middlewareConfig has no middleware helpers", () => {
    const { fnNode, routeMap } = makePostHandler("saveData", [
      makeReturnStmt('"ok"', span(110)),
    ]);

    const serverJs = getServerJs(
      [makeLogicBlock([fnNode], span(90))],
      routeMap,
      null,
    );

    expect(serverJs).not.toContain("_scrml_mw_wrap");
    expect(serverJs).not.toContain("_scrml_cors_headers");
    expect(serverJs).not.toContain("_scrml_log_request");
    expect(serverJs).not.toContain("_scrml_check_ratelimit");
    expect(serverJs).not.toContain("_scrml_apply_security_headers");
  });
});

// ---------------------------------------------------------------------------
// §39 AST: middlewareConfig extracted from <program> attributes
// ---------------------------------------------------------------------------

describe("§39 AST: middlewareConfig extracted from <program> attributes", () => {
  test("cors= attribute extracted into middlewareConfig.cors", () => {
    const source = `<program cors="*">
\${ server function getData() { return "ok" } }
</program>`;

    const { ast } = parseSource(source);
    expect(ast.middlewareConfig).not.toBeNull();
    expect(ast.middlewareConfig.cors).toBe("*");
  });

  test("log= attribute extracted into middlewareConfig.log", () => {
    const source = `<program log="structured">
\${ server function getData() { return "ok" } }
</program>`;

    const { ast } = parseSource(source);
    expect(ast.middlewareConfig).not.toBeNull();
    expect(ast.middlewareConfig.log).toBe("structured");
  });

  test("ratelimit= attribute extracted into middlewareConfig.ratelimit", () => {
    const source = `<program ratelimit="100/min">
\${ server function getData() { return "ok" } }
</program>`;

    const { ast } = parseSource(source);
    expect(ast.middlewareConfig).not.toBeNull();
    expect(ast.middlewareConfig.ratelimit).toBe("100/min");
  });

  test("headers= attribute extracted into middlewareConfig.headers", () => {
    const source = `<program headers="strict">
\${ server function getData() { return "ok" } }
</program>`;

    const { ast } = parseSource(source);
    expect(ast.middlewareConfig).not.toBeNull();
    expect(ast.middlewareConfig.headers).toBe("strict");
  });

  test("no middleware attributes means middlewareConfig is null", () => {
    const source = `<program db="./app.db">
\${ server function getData() { return "ok" } }
</program>`;

    const { ast } = parseSource(source);
    expect(ast.middlewareConfig).toBeNull();
  });

  test("multiple middleware attributes all extracted", () => {
    const source = `<program cors="*" log="structured" headers="strict" ratelimit="100/min">
\${ server function getData() { return "ok" } }
</program>`;

    const { ast } = parseSource(source);
    expect(ast.middlewareConfig).not.toBeNull();
    expect(ast.middlewareConfig.cors).toBe("*");
    expect(ast.middlewareConfig.log).toBe("structured");
    expect(ast.middlewareConfig.headers).toBe("strict");
    expect(ast.middlewareConfig.ratelimit).toBe("100/min");
  });
});
