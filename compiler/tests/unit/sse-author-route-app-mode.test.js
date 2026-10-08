/**
 * escalation-2 — author `route=` on a `server function*` (SSE) honored in
 * APPLICATION (browser) mode (§12.3 carve-out / §12.6 app-mode escalation).
 *
 * S216 ratification ([S216/escalation-2], dpa-002 serve-side-raw-route DD,
 * Approach B + the OQ-1 carve-out): scrml HONORS an author-declared
 * `route="/path"` on a `server function*` SSE generator (and the `handle()`
 * escape hatch) in application mode — a STABLE, foreign-consumer-known URL (the
 * serve-side mirror of the `<api>` consume-side BYOB carve-out, S210). A
 * non-scrml client subscribing to an SSE has no scrml client to receive a
 * compiler-internal route hash, so the author path IS the contract.
 *
 * This file pins the BUG the build fixed: route-inference previously set
 * `generatedRouteName` (the JS export binding name) to the author PATH when an
 * explicit `route=` was present, emitting invalid JS — `export const /fsp/deltas`.
 * The fix: `generatedRouteName` is ALWAYS a valid `__ri_route_*` identifier;
 * the author path lives in `explicitRoute` and emit-server mounts the handler
 * there for the `path:` field.
 *
 * Coverage:
 *   §A RI: author route= on a `server function*` SSE -> generatedRouteName is a
 *          valid JS identifier (NOT the path); explicitRoute carries the path.
 *   §B CG: emitted server.js exports under the identifier with path = author path.
 *   §C CG: emitted server.js is VALID JavaScript (node-checkable) — regression
 *          guard for the `export const /fsp/deltas` invalid-JS bug.
 *   §D CG: non-author-route SSE still mounts at the compiler-internal /_scrml/ path.
 *   §E CG: a regular (non-SSE) server fn with author route= mounts at the author
 *          path with a valid binding (same fix, sibling code path).
 *   §F Integration: full runCG compile of a `server function*` with author
 *          route= produces valid server JS at the author path + a client SSE stub.
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { runRI } from "../../src/route-inference.js";
import { generateServerJs } from "../../src/codegen/emit-server.js";
import { resetVarCounter } from "../../src/codegen/var-counter.ts";
import { runCG } from "../../src/code-generator.js";

// node:vm is used to assert the emitted server.js parses as valid JS. We do NOT
// execute it (the runtime helpers/imports aren't wired here) — we only compile
// the SourceText, which throws SyntaxError on `export const /fsp/deltas`.
import vm from "node:vm";
import { standInHostAlias } from "../helpers/host-view.js";

function span(start, file = "/test/app.scrml") {
  return { file, start, end: start + 10, line: 1, col: start + 1 };
}

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

function makeFileAST(filePath, fnNodes) {
  return {
    filePath,
    nodes: [{ id: 1, kind: "logic", body: fnNodes, span: span(0, filePath) }],
    imports: [],
    exports: [],
    components: [],
    typeDecls: [],
    nodeTypes: new Map(),
    componentShapes: new Map(),
    scopeChain: null,
    spans: new Map(),
  };
}

function emptyProtectAnalysis() {
  return { views: new Map() };
}

function getRoute(routeMap, filePath, spanStart) {
  return routeMap.functions.get(`${filePath}::${spanStart}`);
}

/** Assert `src` parses as a valid ES module (no execution). */
function assertParsesAsModule(src) {
  // node:vm SourceTextModule requires --experimental-vm-modules; fall back to a
  // Script-wrapped parse using `new Function`-style validation via vm.compileFunction
  // would reject top-level `export`. Use the same gate the compiler's
  // --validate-emit uses semantics-wise: a SyntaxError on parse fails the test.
  // We strip the `export ` keyword to parse as a Script (top-level export is
  // illegal in a Script, but the IDENTIFIER-vs-path bug surfaces identically:
  // `const /fsp/deltas = {...}` is a SyntaxError as a Script too).
  // (the host-global alias import, S457 2a, becomes a plain const under a Script parse)
  const asScript = standInHostAlias(src).replace(/^export /gm, "");
  // Throws SyntaxError if invalid — that is the assertion.
  new vm.Script(asScript, { filename: "emitted.server.js" });
}

// ---------------------------------------------------------------------------
// §A RI: author route= -> generatedRouteName is a valid identifier
// ---------------------------------------------------------------------------

describe("§A RI: author route= keeps generatedRouteName a valid JS identifier", () => {
  test("SSE generator with author route= has identifier generatedRouteName, not the path", () => {
    const fn = makeFunctionDecl({
      name: "fspDeltas", isServer: true, isGenerator: true, route: "/fsp/deltas",
    });
    const { routeMap } = runRI({
      files: [makeFileAST("/test/app.scrml", [fn])],
      protectAnalysis: emptyProtectAnalysis(),
    });
    const route = getRoute(routeMap, "/test/app.scrml", 10);
    expect(route).toBeDefined();
    expect(route.boundary).toBe("server");
    expect(route.isSSE).toBe(true);
    // The binding name must be a valid JS identifier — never the author path.
    expect(route.generatedRouteName).not.toContain("/");
    expect(/^[$A-Za-z_][$A-Za-z0-9_]*$/.test(route.generatedRouteName)).toBe(true);
    expect(route.generatedRouteName).toContain("fspDeltas");
  });

  test("SSE generator with author route= carries the author path in explicitRoute", () => {
    const fn = makeFunctionDecl({
      name: "fspDeltas", isServer: true, isGenerator: true, route: "/fsp/deltas",
    });
    const { routeMap } = runRI({
      files: [makeFileAST("/test/app.scrml", [fn])],
      protectAnalysis: emptyProtectAnalysis(),
    });
    const route = getRoute(routeMap, "/test/app.scrml", 10);
    expect(route.explicitRoute).toBe("/fsp/deltas");
    expect(route.explicitMethod).toBe("GET"); // SSE is GET (RI override)
  });
});

// ---------------------------------------------------------------------------
// §B CG: emitted server.js exports under the identifier at the author path
// ---------------------------------------------------------------------------

describe("§B CG: SSE author route= exports under identifier, path = author path", () => {
  beforeEach(() => resetVarCounter());

  test("export binding is the identifier; path: is the author path", () => {
    const fnNode = makeFunctionDecl({
      name: "fspDeltas", isServer: true, isGenerator: true, route: "/fsp/deltas", spanStart: 10,
    });
    const fileAST = makeFileAST("/test/app.scrml", [fnNode]);
    const routeMap = { functions: new Map([["/test/app.scrml::10", {
      functionNodeId: "/test/app.scrml::10",
      boundary: "server",
      escalationReasons: [],
      generatedRouteName: "__ri_route_fspDeltas_1",
      serverEntrySpan: fnNode.span,
      isSSE: true,
      explicitMethod: "GET",
      explicitRoute: "/fsp/deltas",
      cpsSplit: null,
    }]]) };

    const serverJs = generateServerJs(fileAST, routeMap, [], null);

    expect(serverJs).toContain("export const __ri_route_fspDeltas_1 = {");
    expect(serverJs).toContain('path: "/fsp/deltas"');
    expect(serverJs).toContain('method: "GET"');
    // It must NOT emit the path as the binding name (the bug).
    expect(serverJs).not.toContain("export const /fsp/deltas");
  });
});

// ---------------------------------------------------------------------------
// §C CG: emitted server.js is valid JavaScript (the regression guard)
// ---------------------------------------------------------------------------

describe("§C CG: SSE author route= emits valid JavaScript", () => {
  beforeEach(() => resetVarCounter());

  test("emitted server.js parses without SyntaxError", () => {
    const fnNode = makeFunctionDecl({
      name: "fspDeltas", isServer: true, isGenerator: true, route: "/fsp/deltas", spanStart: 10,
    });
    const fileAST = makeFileAST("/test/app.scrml", [fnNode]);
    const routeMap = { functions: new Map([["/test/app.scrml::10", {
      functionNodeId: "/test/app.scrml::10",
      boundary: "server",
      escalationReasons: [],
      generatedRouteName: "__ri_route_fspDeltas_1",
      serverEntrySpan: fnNode.span,
      isSSE: true,
      explicitMethod: "GET",
      explicitRoute: "/fsp/deltas",
      cpsSplit: null,
    }]]) };

    const serverJs = generateServerJs(fileAST, routeMap, [], null);
    expect(() => assertParsesAsModule(serverJs)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// §D CG: non-author-route SSE still mounts at the compiler-internal path
// ---------------------------------------------------------------------------

describe("§D CG: non-author-route SSE keeps the compiler-internal /_scrml/ path", () => {
  beforeEach(() => resetVarCounter());

  test("no explicitRoute -> path is /_scrml/<generatedRouteName>", () => {
    const fnNode = makeFunctionDecl({
      name: "liveData", isServer: true, isGenerator: true, route: null, spanStart: 10,
    });
    const fileAST = makeFileAST("/test/app.scrml", [fnNode]);
    const routeMap = { functions: new Map([["/test/app.scrml::10", {
      functionNodeId: "/test/app.scrml::10",
      boundary: "server",
      escalationReasons: [],
      generatedRouteName: "__ri_route_liveData_1",
      serverEntrySpan: fnNode.span,
      isSSE: true,
      explicitMethod: "GET",
      explicitRoute: null,
      cpsSplit: null,
    }]]) };

    const serverJs = generateServerJs(fileAST, routeMap, [], null);
    expect(serverJs).toContain("export const __ri_route_liveData_1 = {");
    expect(serverJs).toContain('path: "/_scrml/__ri_route_liveData_1"');
    expect(() => assertParsesAsModule(serverJs)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// §E CG: a regular (non-SSE) server fn with author route= (sibling code path)
// ---------------------------------------------------------------------------

describe("§E CG: non-SSE server fn with author route= mounts at author path", () => {
  beforeEach(() => resetVarCounter());

  test("non-SSE author route= -> identifier binding, path = author path, valid JS", () => {
    const fnNode = makeFunctionDecl({
      name: "getRows", isServer: true, isGenerator: false, route: "/api/rows", method: "POST", spanStart: 10,
    });
    const fileAST = makeFileAST("/test/app.scrml", [fnNode]);
    const routeMap = { functions: new Map([["/test/app.scrml::10", {
      functionNodeId: "/test/app.scrml::10",
      boundary: "server",
      escalationReasons: [],
      generatedRouteName: "__ri_route_getRows_1",
      serverEntrySpan: fnNode.span,
      isSSE: false,
      explicitMethod: "POST",
      explicitRoute: "/api/rows",
      cpsSplit: null,
    }]]) };

    const serverJs = generateServerJs(fileAST, routeMap, [], null);
    expect(serverJs).toContain("export const __ri_route_getRows_1 = {");
    expect(serverJs).toContain('path: "/api/rows"');
    expect(serverJs).not.toContain("export const /api/rows");
    expect(() => assertParsesAsModule(serverJs)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// §F Integration: full runCG compile of an SSE author-route function
// ---------------------------------------------------------------------------

describe("§F Integration: runCG of SSE author route= -> valid server + client", () => {
  beforeEach(() => resetVarCounter());

  function makeDepGraph() {
    return { nodes: new Map(), edges: [] };
  }

  test("runCG produces server JS at the author path + a client EventSource stub", () => {
    const fnNode = {
      kind: "function-decl",
      name: "fspDeltas",
      params: [],
      body: [{ kind: "bare-expr", expr: "yield { event: 'delta', id: 1, data: 1 }", span: span(20) }],
      fnKind: "function",
      isServer: true,
      isGenerator: true,
      canFail: false,
      errorType: null,
      route: "/fsp/deltas",
      method: null,
      span: span(100),
    };
    const fileAST = {
      filePath: "/test/app.scrml",
      nodes: [{ kind: "logic", body: [fnNode], span: span(90) }],
      imports: [], exports: [], components: [], typeDecls: [],
      nodeTypes: new Map(), componentShapes: new Map(), scopeChain: null,
    };
    const routeMap = { functions: new Map([["/test/app.scrml::100", {
      functionNodeId: "/test/app.scrml::100",
      boundary: "server",
      escalationReasons: [],
      generatedRouteName: "__ri_route_fspDeltas_1",
      serverEntrySpan: fnNode.span,
      isSSE: true,
      explicitMethod: "GET",
      explicitRoute: "/fsp/deltas",
      cpsSplit: null,
    }]]) };

    const result = runCG({
      files: [fileAST],
      routeMap,
      depGraph: makeDepGraph(),
      protectAnalysis: { views: new Map() },
    });

    expect(result.errors).toHaveLength(0);
    const out = result.outputs.get("/test/app.scrml");
    expect(out.serverJs).toBeTruthy();
    // mounts at the author path under a valid binding
    expect(out.serverJs).toContain("export const __ri_route_fspDeltas_1 = {");
    expect(out.serverJs).toContain('path: "/fsp/deltas"');
    expect(out.serverJs).not.toContain("export const /fsp/deltas");
    expect(() => assertParsesAsModule(out.serverJs)).not.toThrow();
    // client emits an SSE stub (EventSource), not a fetch
    expect(out.clientJs).toContain("EventSource");
  });
});
