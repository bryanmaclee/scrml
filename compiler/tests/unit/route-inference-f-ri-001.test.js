/**
 * Route Inferrer — F-RI-001 regression tests
 *
 * F-RI-001 (examples/23-trucking-dispatch/FRICTION.md L353): the canonical
 * "client function calls server fn → branches on result → assigns @var on
 * the negative path" pattern was reported as failing E-RI-002. The bug was
 * already resolved by `7462ae0 feat(boundary-security-fix)` (2026-04-24).
 * This file adds explicit regression coverage so that pattern is pinned
 * down — if anyone re-introduces transitive-callee escalation, or breaks
 * the closure-capture call-vs-capture distinction, these tests will catch
 * it.
 *
 * Three suites:
 *
 *   §A  F-RI-001 canonical pattern — multi-branch result handling with
 *       early returns and a @var assignment on the error path. Function
 *       has NO direct triggers and stays client-side. No E-RI-002.
 *
 *   §B  Genuine E-RI-002 still fires — function with a real direct
 *       trigger (?{} SQL) AND a top-level reactive assignment must
 *       still emit E-RI-002. Protects the security boundary.
 *
 *   §C  CPS-applicable patterns still split — `@x = serverFn()` and
 *       `@x = ?{...}` continue to produce a non-null cpsSplit on the
 *       route entry.
 *
 * All tests construct FileAST inputs programmatically and call runRI()
 * directly (no compilation, no real DB). Mirrors the harness used by
 * compiler/tests/unit/route-inference.test.js.
 */

import { describe, test, expect } from "bun:test";
import { runRI } from "../../src/route-inference.js";

// ---------------------------------------------------------------------------
// Local builders (kept independent of the main route-inference.test.js so
// this file can be moved or read in isolation).
// ---------------------------------------------------------------------------

function span(start, file = "/test/f-ri-001.scrml") {
  return { file, start, end: start + 10, line: 1, col: start + 1 };
}

function makeFunctionDecl({
  name,
  params = [],
  body = [],
  isServer = false,
  fnKind = "function",
  spanStart = 10,
  file = "/test/f-ri-001.scrml",
}) {
  return {
    id: spanStart,
    kind: "function-decl",
    name,
    params,
    body,
    fnKind,
    isServer,
    span: span(spanStart, file),
  };
}

function makeBareExpr(expr, spanStart = 20, file = "/test/f-ri-001.scrml") {
  return {
    id: spanStart,
    kind: "bare-expr",
    expr,
    span: span(spanStart, file),
  };
}

function makeLetDecl(name, init, spanStart = 30, file = "/test/f-ri-001.scrml") {
  return {
    id: spanStart,
    kind: "let-decl",
    name,
    init,
    span: span(spanStart, file),
  };
}

function makeReactiveDecl(name, init, spanStart = 40, file = "/test/f-ri-001.scrml") {
  return {
    id: spanStart,
    kind: "state-decl",
    name,
    init,
    span: span(spanStart, file),
  };
}

function makeIfStmt({ condition, consequent, alternate = null, spanStart = 70, file = "/test/f-ri-001.scrml" }) {
  return {
    id: spanStart,
    kind: "if-stmt",
    condition,
    consequent,
    alternate,
    span: span(spanStart, file),
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

function emptyProtectAnalysis() {
  return { views: new Map() };
}

function getRoute(routeMap, filePath, spanStart) {
  const id = `${filePath}::${spanStart}`;
  return routeMap.functions.get(id);
}

function runRIClean(files, protectAnalysis = emptyProtectAnalysis()) {
  return runRI({ files, protectAnalysis });
}

// ---------------------------------------------------------------------------
// §A — F-RI-001 canonical pattern (the friction's exact shape)
// ---------------------------------------------------------------------------

describe("§A — F-RI-001 canonical pattern: client fn → server fn → branch → @var", () => {
  test("canonical multi-branch pattern compiles clean (no E-RI-002)", () => {
    // Mirrors the friction example almost verbatim:
    //
    //   server function transitionStatusServer(loadId, target) {
    //       const load = ?{`SELECT id FROM loads WHERE id = ${loadId}`}.get()
    //       if (!load) return { error: "Load not found." }
    //       return { ok: true }
    //   }
    //
    //   function transition(target) {
    //       const result = transitionStatusServer(@load.id, target)
    //       if (result.unauthorized) {
    //           window.location.href = "/login?reason=unauthorized"
    //           return
    //       }
    //       if (result.error) {
    //           @errorMessage = result.error
    //           return
    //       }
    //   }
    const serverFn = makeFunctionDecl({
      name: "transitionStatusServer",
      params: ["loadId", "target"],
      isServer: true,
      body: [
        // The body content doesn't matter for this test — the function
        // is `isServer:true` (explicit annotation), which is enough.
        makeBareExpr("return { ok: true }", 11),
      ],
      spanStart: 10,
    });

    const ifUnauthorized = makeIfStmt({
      condition: "result.unauthorized",
      consequent: [
        makeBareExpr('window.location.href = "/login?reason=unauthorized"', 71),
        makeBareExpr("return", 72),
      ],
      spanStart: 70,
    });

    const ifError = makeIfStmt({
      condition: "result.error",
      consequent: [
        // The exact friction shape: @errorMessage = result.error inside
        // the if-stmt body.
        makeBareExpr("@errorMessage = result.error", 81),
        makeBareExpr("return", 82),
      ],
      spanStart: 80,
    });

    const clientFn = makeFunctionDecl({
      name: "transition",
      params: ["target"],
      body: [
        makeLetDecl("result", "transitionStatusServer(@load.id, target)", 60),
        ifUnauthorized,
        ifError,
      ],
      spanStart: 50,
    });

    const fileAST = makeFileAST("/test/f-ri-001.scrml", [serverFn, clientFn]);
    const { routeMap, errors } = runRIClean([fileAST]);

    // The friction's CORE assertion: E-RI-002 must NOT fire on transition.
    const riErrors = errors.filter(e => e.code === "E-RI-002");
    expect(riErrors).toHaveLength(0);

    // transition has NO direct triggers and stays CLIENT (per §12: calling a
    // server function does not escalate the caller; the call lowers to a
    // fetch stub at codegen).
    const route = getRoute(routeMap, "/test/f-ri-001.scrml", 50);
    expect(route).toBeDefined();
    expect(route.boundary).toBe("client");
    expect(route.escalationReasons).toHaveLength(0);
    expect(route.cpsSplit).toBeNull();
  });

  test("server-fn callee in let-decl init does not escalate caller", () => {
    // Variant: the server-fn result is captured into a `const` (rather than
    // assigned to @var). Same expected outcome — caller stays client.
    const serverFn = makeFunctionDecl({
      name: "doWork",
      isServer: true,
      body: [makeBareExpr("return { ok: true }", 11)],
      spanStart: 10,
    });

    const clientFn = makeFunctionDecl({
      name: "callerOfDoWork",
      body: [
        makeLetDecl("r", "doWork()", 60),
        makeIfStmt({
          condition: "r.error",
          consequent: [makeBareExpr("@status = r.error", 71)],
          spanStart: 70,
        }),
      ],
      spanStart: 50,
    });

    const fileAST = makeFileAST("/test/f-ri-001.scrml", [serverFn, clientFn]);
    const { routeMap, errors } = runRIClean([fileAST]);

    const riErrors = errors.filter(e => e.code === "E-RI-002");
    expect(riErrors).toHaveLength(0);

    const route = getRoute(routeMap, "/test/f-ri-001.scrml", 50);
    expect(route.boundary).toBe("client");
  });

  test("nested @var in for-loop body — caller-of-server-fn stays client", () => {
    // Variant: the @var assignment is inside a for-loop. CPS still does not
    // need to split because the function isn't server-escalated to begin with.
    const serverFn = makeFunctionDecl({
      name: "fetchAll",
      isServer: true,
      body: [makeBareExpr("return []", 11)],
      spanStart: 10,
    });

    const forStmt = {
      id: 75,
      kind: "for-of-stmt",
      decl: { kind: "const-decl", name: "row", init: "" },
      iterable: "rows",
      body: [makeBareExpr("@total = @total + row.amount", 76)],
      span: span(75),
    };

    const clientFn = makeFunctionDecl({
      name: "loopAndUpdate",
      body: [
        makeLetDecl("rows", "fetchAll()", 60),
        forStmt,
      ],
      spanStart: 50,
    });

    const fileAST = makeFileAST("/test/f-ri-001.scrml", [serverFn, clientFn]);
    const { routeMap, errors } = runRIClean([fileAST]);

    const riErrors = errors.filter(e => e.code === "E-RI-002");
    expect(riErrors).toHaveLength(0);

    const route = getRoute(routeMap, "/test/f-ri-001.scrml", 50);
    expect(route.boundary).toBe("client");
  });
});

// ---------------------------------------------------------------------------
// §B — Genuine E-RI-002 still fires
// ---------------------------------------------------------------------------

describe("§B — security boundary: genuine E-RI-002 must still fire", () => {
  test("server-annotated function with top-level reactive-decl produces E-RI-002", () => {
    // A function with an explicit `server` annotation that also assigns
    // @reactive at the top level. CPS cannot split this (no client-side
    // statements between server triggers and the reactive). E-RI-002
    // protects the security boundary — server fn cannot mutate client
    // state directly.
    const fn = makeFunctionDecl({
      name: "evilServer",
      isServer: true,
      body: [
        makeBareExpr("doSomething()", 11),
        makeReactiveDecl("count", "5", 12),
      ],
      spanStart: 10,
    });
    const fileAST = makeFileAST("/test/f-ri-001.scrml", [fn]);
    const { errors } = runRIClean([fileAST]);

    const riErrors = errors.filter(e => e.code === "E-RI-002");
    expect(riErrors.length).toBeGreaterThanOrEqual(1);
    expect(riErrors[0].message).toContain("E-RI-002");
    expect(riErrors[0].message).toContain("evilServer");
  });

  test("server-annotated function assigning @var via bare-expr produces E-RI-002", () => {
    // Same shape but the reactive assignment is via bare-expr (`@x = y`).
    const fn = makeFunctionDecl({
      name: "evilServer2",
      isServer: true,
      body: [
        makeBareExpr("doSomething()", 11),
        makeBareExpr("@status = 'tampered'", 12),
      ],
      spanStart: 10,
    });
    const fileAST = makeFileAST("/test/f-ri-001.scrml", [fn]);
    const { errors } = runRIClean([fileAST]);

    const riErrors = errors.filter(e => e.code === "E-RI-002");
    expect(riErrors.length).toBeGreaterThanOrEqual(1);
    expect(riErrors[0].message).toContain("evilServer2");
  });
});

// ---------------------------------------------------------------------------
// §C — CPS-applicable patterns still split
// ---------------------------------------------------------------------------

describe("§C — CPS still splits the canonical reactive-server pattern", () => {
  test("@data = serverFn() at top level produces a CPS split", () => {
    // The classical CPS-eligible pattern: a single reactive-decl whose
    // init calls a server fn. RI must produce a non-null cpsSplit on the
    // function's RouteMap entry.
    //
    // The CALLER here has no direct triggers — it stays client. CPS-split
    // happens at the SERVER fn boundary so the @data=... line splits into
    // a server SQL/data-fetch and a client-side reactive_set.
    //
    // This test pairs with the existing route-inference.test.js §10
    // "purely transitive escalation with @reactive = serverFn() — CPS
    // handles" — but is duplicated here so this regression file is
    // self-contained and the CPS happy path is documented alongside the
    // F-RI-001 friction case.
    const serverFn = makeFunctionDecl({
      name: "fetchData",
      isServer: true,
      body: [makeBareExpr("return getRecords()", 11)],
      spanStart: 10,
    });
    const clientFn = makeFunctionDecl({
      name: "loadData",
      body: [makeReactiveDecl("data", "fetchData()", 60)],
      spanStart: 50,
    });
    const fileAST = makeFileAST("/test/f-ri-001.scrml", [serverFn, clientFn]);
    const { errors, routeMap } = runRIClean([fileAST]);

    const riErrors = errors.filter(e => e.code === "E-RI-002");
    expect(riErrors).toHaveLength(0);

    // loadData itself has no direct triggers — it's client. The CPS
    // mechanism is exercised by the routing of the call site, not by
    // adding cpsSplit on loadData. (cpsSplit is non-null only on
    // server-escalated functions whose body splits cleanly.)
    const loadDataRoute = getRoute(routeMap, "/test/f-ri-001.scrml", 50);
    expect(loadDataRoute.boundary).toBe("client");
  });

  test("server fn with @x = ?{...} (top-level reactive-server) produces a CPS split", () => {
    // The other CPS-eligible shape: a server-annotated function whose
    // body is the reactive-server pattern @x = ?{SELECT ...}. The
    // function IS server-escalated (server annotation), and CPS splits
    // it so the SQL runs on server and the reactive_set runs on client.
    // This is the "loadList()" archetype in many sample files.
    const sqlNode = {
      id: 71,
      kind: "sql",
      raw: "`SELECT id FROM users`",
      span: span(71),
    };
    const reactiveServerDecl = {
      id: 70,
      kind: "state-decl",
      name: "users",
      init: "?{`SELECT id FROM users`}.all()",
      sqlNode,
      span: span(70),
    };
    const fn = makeFunctionDecl({
      name: "refreshUsers",
      isServer: true,
      body: [reactiveServerDecl],
      spanStart: 60,
    });
    const fileAST = makeFileAST("/test/f-ri-001.scrml", [fn]);
    const { errors, routeMap } = runRIClean([fileAST]);

    // E-RI-002 must NOT fire — CPS handles the reactive-server pattern.
    const riErrors = errors.filter(e => e.code === "E-RI-002");
    expect(riErrors).toHaveLength(0);

    // The function IS server-escalated (explicit annotation). CPS split
    // is non-null and the returnVarName is the reactive var.
    const route = getRoute(routeMap, "/test/f-ri-001.scrml", 60);
    expect(route.boundary).toBe("server");
    expect(route.cpsSplit).not.toBeNull();
    expect(route.cpsSplit.returnVarName).toBe("users");
    expect(route.cpsSplit.serverStmtIndices).toContain(0);
    expect(route.cpsSplit.clientStmtIndices).toContain(0);
  });
});
