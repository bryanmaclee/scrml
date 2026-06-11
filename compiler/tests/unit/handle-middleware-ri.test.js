/**
 * §39.3 handle() middleware escape hatch — Route Inference tests
 *
 * Tests that route-inference.js correctly classifies `server function handle()`
 * as boundary:"middleware" instead of boundary:"server", suppresses generatedRouteName,
 * and does not emit E-RI-002 for handle() functions.
 *
 * Coverage:
 *   RI-HANDLE-001  handle() boundary is "middleware" not "server"
 *   RI-HANDLE-002  handle() has no generatedRouteName (null)
 *   RI-HANDLE-003  handle() does not expose as RPC endpoint in routeMap
 *   RI-HANDLE-004  E-RI-002 not emitted for handle() (escape hatch is exempt)
 *   RI-HANDLE-005  coexistence: handle() and regular server function both work
 *
 * BUG fixed: BUG-R13-004 — before this fix, handle() was assigned
 *   boundary:"server" and generatedRouteName:"__ri_route_handle_N", causing it to
 *   be emitted as an RPC route at /_scrml/__ri_route_handle_N which is completely
 *   wrong for an onion-model interceptor.
 */

import { describe, test, expect } from "bun:test";
import { runRI } from "../../src/route-inference.js";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function span(start, file = "/test/app.scrml") {
  return { file, start, end: start + 10, line: 1, col: start + 1 };
}

function makeHandleFn(opts = {}) {
  return {
    id: opts.spanStart ?? 10,
    kind: "function-decl",
    name: "handle",
    params: ["request", "resolve"],
    body: opts.body ?? [],
    fnKind: "function",
    isServer: true,
    isHandleEscapeHatch: true,
    span: span(opts.spanStart ?? 10, opts.file ?? "/test/app.scrml"),
  };
}

function makeServerFn(name, opts = {}) {
  return {
    id: opts.spanStart ?? 100,
    kind: "function-decl",
    name,
    params: opts.params ?? [],
    body: opts.body ?? [],
    fnKind: "function",
    isServer: true,
    isHandleEscapeHatch: false,
    span: span(opts.spanStart ?? 100, opts.file ?? "/test/app.scrml"),
  };
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

function runRIClean(files) {
  return runRI({ files, protectAnalysis: { views: new Map() } });
}

function getRoute(routeMap, filePath, spanStart) {
  return routeMap.functions.get(`${filePath}::${spanStart}`);
}

// ---------------------------------------------------------------------------
// RI-HANDLE-001: boundary is "middleware"
// ---------------------------------------------------------------------------

describe("RI-HANDLE-001: handle() boundary is 'middleware'", () => {
  test("server function handle() with isHandleEscapeHatch:true gets boundary:middleware", () => {
    const fn = makeHandleFn({ spanStart: 10 });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { routeMap } = runRIClean([fileAST]);

    const route = getRoute(routeMap, "/test/app.scrml", 10);
    expect(route).toBeDefined();
    expect(route.boundary).toBe("middleware");
  });

  test("handle() boundary is not 'server'", () => {
    const fn = makeHandleFn({ spanStart: 10 });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { routeMap } = runRIClean([fileAST]);

    const route = getRoute(routeMap, "/test/app.scrml", 10);
    expect(route.boundary).not.toBe("server");
  });

  test("handle() boundary is not 'client'", () => {
    const fn = makeHandleFn({ spanStart: 10 });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { routeMap } = runRIClean([fileAST]);

    const route = getRoute(routeMap, "/test/app.scrml", 10);
    expect(route.boundary).not.toBe("client");
  });

  test("regular server function is still boundary:server (not affected by fix)", () => {
    const fn = makeServerFn("getData", { spanStart: 100 });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { routeMap } = runRIClean([fileAST]);

    const route = getRoute(routeMap, "/test/app.scrml", 100);
    expect(route.boundary).toBe("server");
  });
});

// ---------------------------------------------------------------------------
// RI-HANDLE-002: generatedRouteName is null
// ---------------------------------------------------------------------------

describe("RI-HANDLE-002: handle() has no generatedRouteName", () => {
  test("generatedRouteName is null for handle()", () => {
    const fn = makeHandleFn({ spanStart: 10 });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { routeMap } = runRIClean([fileAST]);

    const route = getRoute(routeMap, "/test/app.scrml", 10);
    expect(route.generatedRouteName).toBeNull();
  });

  test("route-related fields are null/false for handle()", () => {
    const fn = makeHandleFn({ spanStart: 10 });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { routeMap } = runRIClean([fileAST]);

    const route = getRoute(routeMap, "/test/app.scrml", 10);
    expect(route.explicitRoute).toBeNull();
    expect(route.explicitMethod).toBeNull();
    expect(route.isSSE).toBe(false);
    expect(route.cpsSplit).toBeNull();
    expect(route.serverEntrySpan).toBeNull();
    // D2 (§12.2 Trigger 8): handle() now surfaces its escalation reason(s) on the
    // route map — `middleware-handle` (the reserved name) + `explicit-annotation`
    // because makeHandleFn() carries the deprecated `server` keyword (isServer:true).
    expect(route.escalationReasons.some(r => r.kind === "middleware-handle")).toBe(true);
  });

  test("regular server function has a generatedRouteName (not affected)", () => {
    const fn = makeServerFn("getData", { spanStart: 100 });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { routeMap } = runRIClean([fileAST]);

    const route = getRoute(routeMap, "/test/app.scrml", 100);
    expect(route.generatedRouteName).not.toBeNull();
    expect(route.generatedRouteName).toContain("getData");
  });
});

// ---------------------------------------------------------------------------
// RI-HANDLE-003: handle() does not expose as RPC endpoint
// ---------------------------------------------------------------------------

describe("RI-HANDLE-003: handle() not exposed as RPC endpoint", () => {
  test("no routeMap entry has generatedRouteName containing 'handle' with server boundary", () => {
    const fn = makeHandleFn({ spanStart: 10 });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { routeMap } = runRIClean([fileAST]);

    for (const [, route] of routeMap.functions) {
      if (route.generatedRouteName && route.generatedRouteName.includes("handle")) {
        // If a handle route name exists, it must NOT be server boundary
        expect(route.boundary).not.toBe("server");
      }
    }
  });

  test("coexistence: handle() and getData() — only getData gets a route name", () => {
    const handleFn = makeHandleFn({ spanStart: 10 });
    const regularFn = makeServerFn("getData", { spanStart: 200 });
    const fileAST = makeFileAST("/test/app.scrml", [handleFn, regularFn]);
    const { routeMap } = runRIClean([fileAST]);

    expect(routeMap.functions.size).toBe(2);

    const handleRoute = getRoute(routeMap, "/test/app.scrml", 10);
    expect(handleRoute.boundary).toBe("middleware");
    expect(handleRoute.generatedRouteName).toBeNull();

    const dataRoute = getRoute(routeMap, "/test/app.scrml", 200);
    expect(dataRoute.boundary).toBe("server");
    expect(dataRoute.generatedRouteName).not.toBeNull();
  });

  test("handle() with pre and post section body is still middleware boundary", () => {
    const fn = makeHandleFn({
      spanStart: 10,
      body: [
        { kind: "let-decl", name: "start", init: "Date.now()", span: span(15) },
        { kind: "let-decl", name: "response", init: "resolve(request)", span: span(20) },
        { kind: "bare-expr", expr: "response.headers.set('X-Timing', Date.now() - start)", span: span(25) },
        { kind: "return-stmt", expr: "response", span: span(30) },
      ],
    });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { routeMap } = runRIClean([fileAST]);

    const route = getRoute(routeMap, "/test/app.scrml", 10);
    expect(route.boundary).toBe("middleware");
    expect(route.generatedRouteName).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// RI-HANDLE-004: E-RI-002 not emitted for handle()
// ---------------------------------------------------------------------------

describe("RI-HANDLE-004: E-RI-002 suppressed for handle()", () => {
  test("handle() with reactive assignment does NOT emit E-RI-002", () => {
    // handle() is server-annotated and has a reactive assignment — this pattern
    // would trigger E-RI-002 for any other server function, but handle() is exempt
    // because it is the middleware interceptor, not a user-callable server function.
    const fn = makeHandleFn({
      spanStart: 10,
      body: [
        {
          kind: "state-decl",
          name: "data",
          init: "resolve(request)",
          span: span(15),
        },
      ],
    });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { errors } = runRIClean([fileAST]);

    const e002 = errors.filter(e => e.code === "E-RI-002");
    expect(e002).toHaveLength(0);
  });

  test("non-handle server function with only explicit-annotation trigger and reactive assignment gets E-RI-002", () => {
    // Regression test: confirm the E-RI-002 exemption is ONLY for handle().
    const fn = makeServerFn("saveItem", {
      spanStart: 10,
      body: [
        {
          kind: "state-decl",
          name: "data",
          init: "result",
          span: span(15),
        },
      ],
    });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { errors } = runRIClean([fileAST]);

    const e002 = errors.filter(e => e.code === "E-RI-002");
    expect(e002).toHaveLength(1);
  });

  test("no errors emitted at all for minimal handle() function", () => {
    const fn = makeHandleFn({
      spanStart: 10,
      body: [
        { kind: "return-stmt", expr: "resolve(request)", span: span(15) },
      ],
    });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { errors } = runRIClean([fileAST]);

    // No FATAL errors should be emitted for a clean handle() function.
    // D2 (§39.3.2 amendment): a keyword-bearing `server function handle()` now
    // correctly fires W-DEPRECATED-SERVER-MODIFIER (a deprecation warning — the
    // reserved name supplies the escalation reason, so the `server` keyword is
    // redundant). That warning is expected, not a regression.
    const realErrors = errors.filter(
      e => !["E-ROUTE-001", "W-AUTH-001", "W-DEPRECATED-SERVER-MODIFIER"].includes(e.code),
    );
    expect(realErrors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// RI-HANDLE-005: handle() present in routeMap (entry exists)
// ---------------------------------------------------------------------------

describe("RI-HANDLE-005: handle() entry exists in routeMap", () => {
  test("handle() function node is recorded in routeMap.functions", () => {
    const fn = makeHandleFn({ spanStart: 10 });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { routeMap } = runRIClean([fileAST]);

    const route = getRoute(routeMap, "/test/app.scrml", 10);
    expect(route).toBeDefined();
    expect(route.functionNodeId).toBe("/test/app.scrml::10");
  });
});

// ---------------------------------------------------------------------------
// RI-HANDLE-006 (D2, §12.2 Trigger 8): a KEYWORD-LESS `function handle(request,
// resolve)` is recognized by name+signature and escalates to the middleware
// boundary WITHOUT the deprecated `server` keyword.
// ---------------------------------------------------------------------------

function parseFileASTfromSource(source, filePath = "/test/app.scrml") {
  const bs = splitBlocks(filePath, source);
  const tab = buildAST(bs);
  const ast = tab.ast;
  return {
    filePath,
    nodes: ast.nodes ?? [],
    ast,
    imports: ast.imports ?? [],
    exports: ast.exports ?? [],
    components: ast.components ?? [],
    typeDecls: ast.typeDecls ?? [],
    spans: ast.spans ?? new Map(),
  };
}

function findHandleNode(fileAST) {
  let found = null;
  function visit(nodes) {
    for (const n of nodes ?? []) {
      if (!n || typeof n !== "object") continue;
      if (n.kind === "function-decl" && n.name === "handle") { found = n; return; }
      if (Array.isArray(n.children)) visit(n.children);
      if (n.kind === "logic" && Array.isArray(n.body)) visit(n.body);
    }
  }
  visit(fileAST.nodes);
  return found;
}

describe("RI-HANDLE-006 (D2): keyword-less handle() escalates via Trigger 8", () => {
  test("function handle(request, resolve) — no `server` — has boundary:middleware", () => {
    const source = `<program>
\${ function handle(request, resolve) {
  return resolve(request)
} }
</program>`;
    const fileAST = parseFileASTfromSource(source);
    const handleNode = findHandleNode(fileAST);
    expect(handleNode).not.toBeNull();
    expect(handleNode.isHandleEscapeHatch).toBe(true);

    const { routeMap } = runRIClean([fileAST]);
    const route = routeMap.functions.get(`/test/app.scrml::${handleNode.span.start}`);
    expect(route).toBeDefined();
    expect(route.boundary).toBe("middleware");
    expect(route.escalationReasons.some(r => r.kind === "middleware-handle")).toBe(true);
    // No `server` keyword present → no explicit-annotation reason.
    expect(route.escalationReasons.some(r => r.kind === "explicit-annotation")).toBe(false);
  });

  test("keyword-less handle() does NOT fire W-DEPRECATED-SERVER-MODIFIER (no keyword to deprecate)", () => {
    const source = `<program>
\${ function handle(request, resolve) {
  return resolve(request)
} }
</program>`;
    const fileAST = parseFileASTfromSource(source);
    const { errors } = runRIClean([fileAST]);
    const dep = (errors ?? []).filter(e => e.code === "W-DEPRECATED-SERVER-MODIFIER");
    expect(dep).toHaveLength(0);
  });
});
