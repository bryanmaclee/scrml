/**
 * Route Inferrer (RI) — Unit Tests
 *
 * Tests for src/route-inference.js (Stage 5).
 *
 * All FileAST and ProtectAnalysis inputs are constructed programmatically.
 * No real SQLite databases are used. No real file parsing is used.
 *
 * Coverage:
 *   §1  Client-default — function with no escalation triggers stays 'client'
 *   §2  Trigger 2 — protected field access escalates to 'server'
 *   §3  Trigger 2 — destructuring of protected field escalates to 'server'
 *   §4  Trigger 4 — explicit server annotation escalates to 'server'
 *   §5  Trigger 1 — server-only resource access (Bun.file, fs.readFileSync, etc.)
 *   §6  Direct-only escalation — caller of server fn stays client (no transitive escalation)
 *   §7  Direct-only escalation — only direct-trigger functions escalate (multi-hop)
 *   §8  Direct-only escalation — cycle detection (no infinite loop)
 *   §9  (retired) — E-RI-001 retired 2026-04-21 (S37); `pure` + `server` is valid.
 *   §10 E-RI-002 — server-escalated function with reactive assignment
 *   §11 E-ROUTE-001 — computed member access produces warning (with severity:"warning")
 *   §12 External function calls are non-escalating
 *   §13 Multiple escalation reasons accumulate
 *   §14 (reserved)
 *   §15 RouteMap entry shape — FunctionRoute fields correct
 *   §16 PureDecl nodes appear in RouteMap
 *   §17 Cross-file transitive escalation
 *   §18 fn-shorthand nodes appear in RouteMap (fnKind==="fn")
 *   §25 E-ROUTE-001 suppressed inside worker bodies (<program name="...">)
 */

import { describe, test, expect } from "bun:test";
import { runRI, RIError, buildPageRouteTree } from "../../src/route-inference.js";

// ---------------------------------------------------------------------------
// FileAST / ProtectAnalysis construction helpers
// ---------------------------------------------------------------------------

/**
 * Minimal span factory.
 * @param {number} start
 * @param {string} [file]
 * @returns {{ file: string, start: number, end: number, line: number, col: number }}
 */
function span(start, file = "/test/app.scrml") {
  return { file, start, end: start + 10, line: 1, col: start + 1 };
}

/**
 * Build a function-decl LogicNode.
 *
 * @param {object} opts
 * @param {string}   opts.name
 * @param {string[]} [opts.params]
 * @param {object[]} [opts.body]    — LogicNode[] (already parsed, no BareExpr wrappers)
 * @param {boolean}  [opts.isServer]
 * @param {string}   [opts.fnKind]  — 'function' | 'fn'
 * @param {number}   [opts.spanStart]
 * @param {string}   [opts.file]
 * @returns {object}  — function-decl node
 */
function makeFunctionDecl({
  name,
  params = [],
  body = [],
  isServer = false,
  fnKind = "function",
  spanStart = 10,
  file = "/test/app.scrml",
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

/**
 * Build a pure-decl LogicNode.
 *
 * @param {object} opts
 * @param {string}   opts.name
 * @param {string[]} [opts.params]
 * @param {object[]} [opts.body]
 * @param {number}   [opts.spanStart]
 * @param {string}   [opts.file]
 * @returns {object}  — pure-decl node
 */

/**
 * Build a bare-expr LogicNode.
 *
 * @param {string} expr
 * @param {number} [spanStart]
 * @param {string} [file]
 * @returns {object}
 */
function makeBareExpr(expr, spanStart = 20, file = "/test/app.scrml") {
  return {
    id: spanStart,
    kind: "bare-expr",
    expr,
    span: span(spanStart, file),
  };
}

/**
 * Build a let-decl LogicNode.
 *
 * @param {string} name
 * @param {string} init
 * @param {number} [spanStart]
 * @param {string} [file]
 * @returns {object}
 */
function makeLetDecl(name, init, spanStart = 30, file = "/test/app.scrml") {
  return {
    id: spanStart,
    kind: "let-decl",
    name,
    init,
    span: span(spanStart, file),
  };
}

/**
 * Build a state-decl LogicNode (@name = init).
 *
 * @param {string} name   — without the @ prefix
 * @param {string} init
 * @param {number} [spanStart]
 * @param {string} [file]
 * @returns {object}
 */
function makeReactiveDecl(name, init, spanStart = 40, file = "/test/app.scrml") {
  return {
    id: spanStart,
    kind: "state-decl",
    name,
    init,
    span: span(spanStart, file),
  };
}

/**
 * Build a minimal FileAST with a single logic block containing the given
 * function nodes.
 *
 * @param {string}   filePath
 * @param {object[]} fnNodes  — function-decl or pure-decl nodes
 * @returns {object}  — FileAST
 */
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

/**
 * Build a FileAST that simulates a file with a nested worker program:
 *   <program>
 *     <program name="workerName">
 *       ${workerFnNodes}
 *     </>
 *     ${topLevelFnNodes}
 *   </program>
 *
 * The worker body is represented as a markup node with tag="program" and
 * a name attribute. The function nodes inside it live in a logic block
 * that is a child of the worker markup node.
 *
 * @param {string}   filePath
 * @param {string}   workerName
 * @param {object[]} workerFnNodes  — function-decl nodes inside the worker
 * @param {object[]} [topFnNodes]   — function-decl nodes at the top level (outside worker)
 * @returns {object}  — FileAST
 */
function makeWorkerFileAST(filePath, workerName, workerFnNodes, topFnNodes = []) {
  const workerLogicNode = {
    id: 100,
    kind: "logic",
    body: workerFnNodes,
    span: span(100, filePath),
  };

  const workerMarkupNode = {
    id: 90,
    kind: "markup",
    tag: "program",
    attrs: [{ name: "name", value: workerName }],
    children: [workerLogicNode],
    selfClosing: false,
    closerForm: "</>",
    isComponent: false,
    span: span(90, filePath),
  };

  const topLogicNode = {
    id: 1,
    kind: "logic",
    body: topFnNodes,
    span: span(0, filePath),
  };

  return {
    filePath,
    nodes: [workerMarkupNode, topLogicNode],
    imports: [],
    exports: [],
    components: [],
    typeDecls: [],
    spans: new Map(),
  };
}

/**
 * Build a minimal ProtectAnalysis with the given protected fields for a
 * single db state block.
 *
 * @param {string}   stateBlockId  — e.g. "/test/app.scrml::5"
 * @param {string}   tableName
 * @param {string[]} protectedFields
 * @returns {{ views: Map<string, object> }}
 */
function makeProtectAnalysis(stateBlockId, tableName, protectedFields) {
  const tableTypeView = {
    tableName,
    fullSchema: protectedFields.map(f => ({ name: f, sqlType: "TEXT", nullable: true, isPrimaryKey: false })),
    clientSchema: [],
    protectedFields: new Set(protectedFields),
  };

  const dbTypeViews = {
    stateBlockId,
    dbPath: "/test/app.db",
    tables: new Map([[tableName, tableTypeView]]),
  };

  const views = new Map([[stateBlockId, dbTypeViews]]);
  return { views };
}

/**
 * Empty ProtectAnalysis (no protected fields).
 * @returns {{ views: Map<string, object> }}
 */
function emptyProtectAnalysis() {
  return { views: new Map() };
}

/**
 * Helper: run RI and assert no errors.
 */
function runRIClean(files, protectAnalysis = emptyProtectAnalysis()) {
  const result = runRI({ files, protectAnalysis });
  return result;
}

/**
 * Get a FunctionRoute by function name from a RouteMap.
 * Searches all entries for a functionNodeId whose corresponding fnNode.name matches.
 *
 * Since FunctionNodeId is "{filePath}::{span.start}", we need to use the span.start
 * we gave the function node.
 */
function getRoute(routeMap, filePath, spanStart) {
  const id = `${filePath}::${spanStart}`;
  return routeMap.functions.get(id);
}

// ---------------------------------------------------------------------------
// §1  Client-default
// ---------------------------------------------------------------------------

describe("§1 — client-default: function with no escalation triggers", () => {
  test("a plain function with no server access is 'client'", () => {
    const fn = makeFunctionDecl({
      name: "greet",
      body: [makeBareExpr("return name + ' hello'")],
    });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { routeMap, errors } = runRIClean([fileAST]);

    const route = getRoute(routeMap, "/test/app.scrml", 10);
    expect(route).toBeDefined();
    expect(route.boundary).toBe("client");
    expect(route.escalationReasons).toHaveLength(0);
    expect(route.generatedRouteName).toBeNull();
    expect(route.serverEntrySpan).toBeNull();
    // Insight 26 (2026-05-08): W-DEAD-FUNCTION + W-DEPRECATED-SERVER-MODIFIER
    // are advisory warnings, not structural errors. Filter them out — this
    // test asserts on the absence of routing errors only.
    expect(errors.filter(e =>
      e.code !== "E-ROUTE-001" &&
      e.code !== "W-DEAD-FUNCTION" &&
      e.code !== "W-DEPRECATED-SERVER-MODIFIER"
    )).toHaveLength(0);
  });

  test("a function with arithmetic body is 'client'", () => {
    const fn = makeFunctionDecl({
      name: "add",
      body: [makeBareExpr("return a + b")],
    });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { routeMap } = runRIClean([fileAST]);

    const route = getRoute(routeMap, "/test/app.scrml", 10);
    expect(route.boundary).toBe("client");
  });

  test("a function with let-decl body is 'client'", () => {
    const fn = makeFunctionDecl({
      name: "compute",
      body: [
        makeLetDecl("x", "a * 2"),
        makeBareExpr("return x + b"),
      ],
    });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { routeMap } = runRIClean([fileAST]);

    const route = getRoute(routeMap, "/test/app.scrml", 10);
    expect(route.boundary).toBe("client");
  });

  test("all functions in file are represented in routeMap", () => {
    const fn1 = makeFunctionDecl({ name: "a", spanStart: 10 });
    const fn2 = makeFunctionDecl({ name: "b", spanStart: 50 });
    const fileAST = makeFileAST("/test/app.scrml", [fn1, fn2]);
    const { routeMap } = runRIClean([fileAST]);

    expect(routeMap.functions.size).toBe(2);
    expect(getRoute(routeMap, "/test/app.scrml", 10)).toBeDefined();
    expect(getRoute(routeMap, "/test/app.scrml", 50)).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// §2  Trigger 2 — protected field access via member expression
// ---------------------------------------------------------------------------

describe("§2 — trigger 2: protected field access via member expression", () => {
  test("bare-expr with .protectedField access escalates to 'server'", () => {
    const pa = makeProtectAnalysis("/test/app.scrml::0", "users", ["passwordHash"]);

    const fn = makeFunctionDecl({
      name: "checkPassword",
      body: [makeBareExpr("return row.passwordHash === hash")],
    });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { routeMap, errors } = runRI({ files: [fileAST], protectAnalysis: pa });

    const route = getRoute(routeMap, "/test/app.scrml", 10);
    expect(route.boundary).toBe("server");
    expect(route.escalationReasons).toHaveLength(1);
    expect(route.escalationReasons[0].kind).toBe("protected-field-access");
    expect(route.escalationReasons[0].field).toBe("passwordHash");
    expect(errors.filter(e => e.code === "E-RI-002")).toHaveLength(0);
  });

  test("function without protected field access stays 'client' even with PA present", () => {
    const pa = makeProtectAnalysis("/test/app.scrml::0", "users", ["passwordHash"]);

    const fn = makeFunctionDecl({
      name: "displayUser",
      body: [makeBareExpr("return row.name")],
    });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { routeMap } = runRI({ files: [fileAST], protectAnalysis: pa });

    const route = getRoute(routeMap, "/test/app.scrml", 10);
    expect(route.boundary).toBe("client");
  });

  test("accessing a non-protected field does not escalate", () => {
    const pa = makeProtectAnalysis("/test/app.scrml::0", "users", ["passwordHash"]);

    const fn = makeFunctionDecl({
      name: "getName",
      body: [makeBareExpr("return user.email")],
    });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { routeMap } = runRI({ files: [fileAST], protectAnalysis: pa });

    const route = getRoute(routeMap, "/test/app.scrml", 10);
    expect(route.boundary).toBe("client");
  });

  test("protected field access in a chained member expr escalates", () => {
    const pa = makeProtectAnalysis("/test/app.scrml::0", "users", ["ssn"]);

    const fn = makeFunctionDecl({
      name: "checkSsn",
      body: [makeBareExpr("if (result.user.ssn === input) return true")],
    });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { routeMap } = runRI({ files: [fileAST], protectAnalysis: pa });

    const route = getRoute(routeMap, "/test/app.scrml", 10);
    expect(route.boundary).toBe("server");
  });
});

// ---------------------------------------------------------------------------
// §3  Trigger 2 — destructuring of protected field
// ---------------------------------------------------------------------------

describe("§3 — trigger 2: destructuring of protected field", () => {
  test("let-decl with destructuring of protected field escalates", () => {
    const pa = makeProtectAnalysis("/test/app.scrml::0", "users", ["passwordHash"]);

    // `let { name, passwordHash } = row` produces let-decl with name="" init="{ name, passwordHash } = row"
    const fn = makeFunctionDecl({
      name: "displayUser",
      body: [makeLetDecl("", "{ name, passwordHash } = users.find(userId)")],
    });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { routeMap } = runRI({ files: [fileAST], protectAnalysis: pa });

    const route = getRoute(routeMap, "/test/app.scrml", 10);
    expect(route.boundary).toBe("server");
    expect(route.escalationReasons[0].kind).toBe("protected-field-access");
    expect(route.escalationReasons[0].field).toBe("passwordHash");
  });

  test("let-decl destructuring without protected field does not escalate", () => {
    const pa = makeProtectAnalysis("/test/app.scrml::0", "users", ["passwordHash"]);

    const fn = makeFunctionDecl({
      name: "display",
      body: [makeLetDecl("", "{ name, email } = users.find(userId)")],
    });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { routeMap } = runRI({ files: [fileAST], protectAnalysis: pa });

    const route = getRoute(routeMap, "/test/app.scrml", 10);
    expect(route.boundary).toBe("client");
  });

  test("destructuring with aliased rename syntax detected via field name", () => {
    // `let { passwordHash: ph } = row` — init is "{ passwordHash: ph } = row"
    // The field name appears before the colon — should match.
    const pa = makeProtectAnalysis("/test/app.scrml::0", "users", ["passwordHash"]);

    const fn = makeFunctionDecl({
      name: "checkHash",
      body: [makeLetDecl("", "{ passwordHash: ph } = row")],
    });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { routeMap } = runRI({ files: [fileAST], protectAnalysis: pa });

    const route = getRoute(routeMap, "/test/app.scrml", 10);
    expect(route.boundary).toBe("server");
  });
});

// ---------------------------------------------------------------------------
// §4  Trigger 4 — explicit server annotation
// ---------------------------------------------------------------------------

describe("§4 — trigger 4: explicit server annotation", () => {
  test("isServer: true escalates to 'server' with explicit-annotation reason", () => {
    const fn = makeFunctionDecl({
      name: "loadData",
      isServer: true,
      body: [makeBareExpr("return fetchData()")],
    });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { routeMap, errors } = runRIClean([fileAST]);

    const route = getRoute(routeMap, "/test/app.scrml", 10);
    expect(route.boundary).toBe("server");
    expect(route.escalationReasons).toHaveLength(1);
    expect(route.escalationReasons[0].kind).toBe("explicit-annotation");
    expect(route.generatedRouteName).not.toBeNull();
    expect(route.generatedRouteName).toContain("loadData");
    // No E-RI-002 errors (no reactive assignment). E-RI-001 retired S37.
    expect(errors.filter(e => e.code === "E-RI-002")).toHaveLength(0);
  });

  test("explicit annotation produces non-null serverEntrySpan", () => {
    const fn = makeFunctionDecl({ name: "action", isServer: true });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { routeMap } = runRIClean([fileAST]);

    const route = getRoute(routeMap, "/test/app.scrml", 10);
    expect(route.serverEntrySpan).not.toBeNull();
    expect(route.serverEntrySpan.start).toBe(10);
  });

  test("isServer: false does not trigger explicit-annotation escalation", () => {
    const fn = makeFunctionDecl({ name: "clientFn", isServer: false });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { routeMap } = runRIClean([fileAST]);

    const route = getRoute(routeMap, "/test/app.scrml", 10);
    expect(route.boundary).toBe("client");
    const annotationReasons = route.escalationReasons.filter(r => r.kind === "explicit-annotation");
    expect(annotationReasons).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §5  Trigger 1 — server-only resource access
// ---------------------------------------------------------------------------

describe("§5 — trigger 1: server-only resource access", () => {
  test("Bun.file() access escalates to 'server' with server-only-resource reason", () => {
    const fn = makeFunctionDecl({
      name: "readConfig",
      body: [makeBareExpr("const file = Bun.file('/etc/config.json')")],
    });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { routeMap } = runRIClean([fileAST]);

    const route = getRoute(routeMap, "/test/app.scrml", 10);
    expect(route.boundary).toBe("server");
    expect(route.escalationReasons[0].kind).toBe("server-only-resource");
    expect(route.escalationReasons[0].resourceType).toBe("Bun.file");
  });

  test("fs.readFileSync access escalates to 'server'", () => {
    const fn = makeFunctionDecl({
      name: "loadFile",
      body: [makeBareExpr("return fs.readFileSync('/data/config.txt', 'utf8')")],
    });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { routeMap } = runRIClean([fileAST]);

    const route = getRoute(routeMap, "/test/app.scrml", 10);
    expect(route.boundary).toBe("server");
    expect(route.escalationReasons[0].kind).toBe("server-only-resource");
    expect(route.escalationReasons[0].resourceType).toBe("fs.readFileSync");
  });

  test("Bun.env access escalates to 'server'", () => {
    const fn = makeFunctionDecl({
      name: "getSecret",
      body: [makeBareExpr("return Bun.env.API_KEY")],
    });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { routeMap } = runRIClean([fileAST]);

    const route = getRoute(routeMap, "/test/app.scrml", 10);
    expect(route.boundary).toBe("server");
    expect(route.escalationReasons[0].resourceType).toBe("Bun.env");
  });

  test("process.env access escalates to 'server'", () => {
    const fn = makeFunctionDecl({
      name: "getKey",
      body: [makeBareExpr("return process.env.SECRET")],
    });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { routeMap } = runRIClean([fileAST]);

    const route = getRoute(routeMap, "/test/app.scrml", 10);
    expect(route.boundary).toBe("server");
  });

  test("SQL block itself (bare-expr) does NOT auto-trigger server escalation", () => {
    // Per §12.2 Trigger 1 note: ?{} SQL does NOT auto-trigger via trigger 1.
    // In a function body, SQL would appear as a bare-expr referencing a SQL query.
    // Here we simulate a function that uses db but does not access protected fields.
    const fn = makeFunctionDecl({
      name: "fetchAll",
      body: [makeBareExpr("return users.findAll()")],
    });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { routeMap } = runRIClean([fileAST]);

    const route = getRoute(routeMap, "/test/app.scrml", 10);
    expect(route.boundary).toBe("client");
  });

  test("Bun.write() escalates to 'server'", () => {
    const fn = makeFunctionDecl({
      name: "writeLog",
      body: [makeBareExpr("await Bun.write('/var/log/app.log', message)")],
    });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { routeMap } = runRIClean([fileAST]);

    const route = getRoute(routeMap, "/test/app.scrml", 10);
    expect(route.boundary).toBe("server");
    expect(route.escalationReasons[0].resourceType).toBe("Bun.write");
  });

  test("new Database() escalates to 'server'", () => {
    const fn = makeFunctionDecl({
      name: "openDb",
      body: [makeBareExpr("const db = new Database('/path/to.db')")],
    });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { routeMap } = runRIClean([fileAST]);

    const route = getRoute(routeMap, "/test/app.scrml", 10);
    expect(route.boundary).toBe("server");
  });

  test("state-decl with SQL init escalates to server (BUG-REACTIVE-SERVER-LEAK)", () => {
    // @users = ?{`SELECT * FROM users`} inside a function body must escalate to server.
    // Previously, walkBodyForTriggers skipped detectServerOnlyResource for state-decl
    // nodes, leaving the function as client-boundary and causing E-CG-006.
    const fn = makeFunctionDecl({
      name: "loadUsers",
      body: [makeReactiveDecl("users", "?{`SELECT id, name FROM users`}")],
      spanStart: 10,
    });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { routeMap } = runRIClean([fileAST]);

    const route = getRoute(routeMap, "/test/app.scrml", 10);
    expect(route.boundary).toBe("server");
    expect(route.escalationReasons.length).toBeGreaterThan(0);
    expect(route.escalationReasons[0].kind).toBe("server-only-resource");
    expect(route.escalationReasons[0].resourceType).toBe("sql-query");
  });

  test("state-decl without SQL in init stays client-boundary", () => {
    // @count = 0 has no server trigger — must stay client.
    const fn = makeFunctionDecl({
      name: "resetCount",
      body: [makeReactiveDecl("count", "0")],
      spanStart: 10,
    });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { routeMap } = runRIClean([fileAST]);

    const route = getRoute(routeMap, "/test/app.scrml", 10);
    expect(route.boundary).toBe("client");
  });
});

// ---------------------------------------------------------------------------
// §6  Transitive escalation — single hop
// ---------------------------------------------------------------------------

describe("§6 — direct-only escalation: calling server fn stays client", () => {
  test("caller of server-escalated function stays client (no transitive escalation)", () => {
    // serverFn is explicitly server-escalated.
    // clientCaller calls serverFn — with direct-only escalation, it stays CLIENT.
    const serverFn = makeFunctionDecl({
      name: "serverFn",
      isServer: true,
      spanStart: 10,
    });
    const callerFn = makeFunctionDecl({
      name: "clientCaller",
      body: [makeBareExpr("serverFn(data)")],
      spanStart: 50,
    });
    const fileAST = makeFileAST("/test/app.scrml", [serverFn, callerFn]);
    const { routeMap } = runRIClean([fileAST]);

    const callerRoute = getRoute(routeMap, "/test/app.scrml", 50);
    // Direct-only escalation: clientCaller has no direct triggers — stays client.
    // The server call becomes a fetch stub at codegen time.
    expect(callerRoute.boundary).toBe("client");
    expect(callerRoute.escalationReasons).toHaveLength(0);
  });

  test("callee that is 'client' does not escalate its caller", () => {
    const clientFn = makeFunctionDecl({
      name: "helper",
      body: [makeBareExpr("return x + 1")],
      spanStart: 10,
    });
    const callerFn = makeFunctionDecl({
      name: "useHelper",
      body: [makeBareExpr("return helper(5)")],
      spanStart: 50,
    });
    const fileAST = makeFileAST("/test/app.scrml", [clientFn, callerFn]);
    const { routeMap } = runRIClean([fileAST]);

    const callerRoute = getRoute(routeMap, "/test/app.scrml", 50);
    expect(callerRoute.boundary).toBe("client");
  });

  test("server-escalated function itself is in the routeMap", () => {
    const serverFn = makeFunctionDecl({ name: "dbFn", isServer: true, spanStart: 10 });
    const fileAST = makeFileAST("/test/app.scrml", [serverFn]);
    const { routeMap } = runRIClean([fileAST]);

    const route = getRoute(routeMap, "/test/app.scrml", 10);
    expect(route).toBeDefined();
    expect(route.boundary).toBe("server");
  });
});

// ---------------------------------------------------------------------------
// §7  Transitive escalation — multi-hop
// ---------------------------------------------------------------------------

describe("§7 — direct-only escalation: only direct-trigger functions escalate", () => {
  test("three-hop chain: A calls B calls C (server) — only C escalated (direct trigger)", () => {
    const pa = makeProtectAnalysis("/test/app.scrml::0", "users", ["secretToken"]);

    // C accesses protected field directly.
    const fnC = makeFunctionDecl({
      name: "C",
      body: [makeBareExpr("return row.secretToken")],
      spanStart: 10,
    });
    // B calls C.
    const fnB = makeFunctionDecl({
      name: "B",
      body: [makeBareExpr("return C(data)")],
      spanStart: 50,
    });
    // A calls B.
    const fnA = makeFunctionDecl({
      name: "A",
      body: [makeBareExpr("return B(input)")],
      spanStart: 90,
    });
    const fileAST = makeFileAST("/test/app.scrml", [fnC, fnB, fnA]);
    const { routeMap } = runRI({ files: [fileAST], protectAnalysis: pa });

    const routeC = getRoute(routeMap, "/test/app.scrml", 10);
    const routeB = getRoute(routeMap, "/test/app.scrml", 50);
    const routeA = getRoute(routeMap, "/test/app.scrml", 90);

    expect(routeC.boundary).toBe("server"); // C has direct trigger (protected field)
    // With direct-only escalation, B and A stay client-side.
    // They call server functions but use fetch stubs — no transitive escalation.
    expect(routeB.boundary).toBe("client");
    expect(routeA.boundary).toBe("client");
  });

  test("unrelated function in same file is not escalated", () => {
    const pa = makeProtectAnalysis("/test/app.scrml::0", "users", ["ssn"]);

    const fnProtected = makeFunctionDecl({
      name: "getSSN",
      body: [makeBareExpr("return row.ssn")],
      spanStart: 10,
    });
    const fnUnrelated = makeFunctionDecl({
      name: "sayHello",
      body: [makeBareExpr("return 'hello'")],
      spanStart: 50,
    });
    const fileAST = makeFileAST("/test/app.scrml", [fnProtected, fnUnrelated]);
    const { routeMap } = runRI({ files: [fileAST], protectAnalysis: pa });

    const routeUnrelated = getRoute(routeMap, "/test/app.scrml", 50);
    expect(routeUnrelated.boundary).toBe("client");
  });
});

// ---------------------------------------------------------------------------
// §8  Transitive escalation — cycle detection
// ---------------------------------------------------------------------------

describe("§8 — direct-only escalation: cycle detection (no infinite loop)", () => {
  test("mutually recursive functions — no infinite loop, cycle breaks cleanly", () => {
    // A calls B, B calls A — cycle.
    // Neither directly accesses protected fields or server resources.
    // Expected: both are 'client'.
    const fnA = makeFunctionDecl({
      name: "A",
      body: [makeBareExpr("return B(x)")],
      spanStart: 10,
    });
    const fnB = makeFunctionDecl({
      name: "B",
      body: [makeBareExpr("return A(x)")],
      spanStart: 50,
    });
    const fileAST = makeFileAST("/test/app.scrml", [fnA, fnB]);
    // This must complete without hanging.
    const { routeMap, errors } = runRIClean([fileAST]);

    const routeA = getRoute(routeMap, "/test/app.scrml", 10);
    const routeB = getRoute(routeMap, "/test/app.scrml", 50);
    expect(routeA.boundary).toBe("client");
    expect(routeB.boundary).toBe("client");
  });

  test("cycle where one member is server-escalated — caller-context propagation escalates the other", () => {
    // A calls B (server), B calls A — cycle where B is server.
    // B has direct annotation — stays server.
    //
    // Pre-Insight 26 (2026-05-08): A stayed client because the original
    // direct-only escalation rule (Step 4) didn't propagate.
    // Post-Insight 26 D3 (2026-05-08): A's only non-self caller is B (server).
    // Caller-context propagation in Step 5c promotes A to server.
    //
    // This is the load-bearing precondition for `server` keyword
    // deprecation: a function called only from server-classified callers
    // is correctly classified server even without explicit annotation.
    const fnA = makeFunctionDecl({
      name: "A",
      body: [makeBareExpr("return B(x)")],
      spanStart: 10,
    });
    const fnB = makeFunctionDecl({
      name: "B",
      isServer: true,
      body: [makeBareExpr("return A(x)")],
      spanStart: 50,
    });
    const fileAST = makeFileAST("/test/app.scrml", [fnA, fnB]);
    const { routeMap } = runRIClean([fileAST]);

    const routeB = getRoute(routeMap, "/test/app.scrml", 50);
    expect(routeB.boundary).toBe("server"); // B has direct annotation
    // Insight 26 D3: A's only caller is B (server) — A escalates via caller-context.
    const routeA = getRoute(routeMap, "/test/app.scrml", 10);
    expect(routeA.boundary).toBe("server");
    // The escalation reason is caller-context-propagation.
    const reasonsA = routeA.escalationReasons.map(r => r.resourceType).filter(Boolean);
    expect(reasonsA).toContain("caller-context-propagation");
  });

  test("three-way cycle — no infinite loop", () => {
    // A → B → C → A (cycle).
    const fnA = makeFunctionDecl({ name: "A", body: [makeBareExpr("return B()")], spanStart: 10 });
    const fnB = makeFunctionDecl({ name: "B", body: [makeBareExpr("return C()")], spanStart: 50 });
    const fnC = makeFunctionDecl({ name: "C", body: [makeBareExpr("return A()")], spanStart: 90 });
    const fileAST = makeFileAST("/test/app.scrml", [fnA, fnB, fnC]);

    // Must complete without infinite loop or stack overflow.
    const { routeMap } = runRIClean([fileAST]);
    expect(routeMap.functions.size).toBe(3);
  });
});

// §9 retired (E-RI-001 retired 2026-04-21 S37 — `pure` + `server` is valid; SPEC §33.4)

// ---------------------------------------------------------------------------
// §10 E-RI-002 — server-escalated function with reactive assignment
// ---------------------------------------------------------------------------

describe("§10 — E-RI-002: server-escalated function assigns to @reactive variable", () => {
  test("server function with state-decl assignment produces E-RI-002", () => {
    const fn = makeFunctionDecl({
      name: "updateCount",
      isServer: true,
      body: [
        makeBareExpr("fetchData()"),
        makeReactiveDecl("count", "5"),
      ],
      spanStart: 10,
    });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { errors } = runRIClean([fileAST]);

    const riErrors = errors.filter(e => e.code === "E-RI-002");
    expect(riErrors).toHaveLength(1);
    expect(riErrors[0].message).toContain("E-RI-002");
  });

  test("E-RI-002 only fires on server-escalated functions, not client functions", () => {
    // A client function that assigns @reactive is fine (it's the expected pattern).
    const fn = makeFunctionDecl({
      name: "onClick",
      isServer: false,
      body: [makeReactiveDecl("count", "count + 1")],
      spanStart: 10,
    });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { errors } = runRIClean([fileAST]);

    const riErrors = errors.filter(e => e.code === "E-RI-002");
    expect(riErrors).toHaveLength(0);
  });

  test("client function calling server fn with reactive assignment — stays client, no E-RI-002", () => {
    const serverFn = makeFunctionDecl({ name: "serverHelper", isServer: true, spanStart: 10 });
    // Caller has no direct triggers — stays CLIENT.
    // Client functions can freely assign reactive state. No CPS needed.
    const callerFn = makeFunctionDecl({
      name: "caller",
      body: [
        makeBareExpr("serverHelper()"),
        makeReactiveDecl("result", "serverHelper()"),
      ],
      spanStart: 50,
    });
    const fileAST = makeFileAST("/test/app.scrml", [serverFn, callerFn]);
    const { routeMap, errors } = runRIClean([fileAST]);

    // With direct-only escalation: caller is CLIENT (no direct triggers).
    // Client functions can assign reactive state freely. No E-RI-002.
    const riErrors = errors.filter(e => e.code === "E-RI-002");
    expect(riErrors).toHaveLength(0);

    const callerRoute = getRoute(routeMap, "/test/app.scrml", 50);
    expect(callerRoute.boundary).toBe("client");
    expect(callerRoute.cpsSplit).toBeNull();
  });

  test("server function without reactive assignment — no E-RI-002", () => {
    const fn = makeFunctionDecl({
      name: "fetchUser",
      isServer: true,
      body: [makeBareExpr("return getUser(id)")],
      spanStart: 10,
    });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { errors } = runRIClean([fileAST]);

    const riErrors = errors.filter(e => e.code === "E-RI-002");
    expect(riErrors).toHaveLength(0);
  });


  test("purely transitive escalation with @reactive = serverFn() — CPS handles, no E-RI-002", () => {
    // A function that calls a server function and assigns the result to @reactive.
    // The function has NO direct server triggers (no SQL, no Bun.*, no protected fields,
    // no explicit server annotation). It is escalated only via transitive callee.
    // CPS transformation handles this: @data = fetchData() is a reactive-server pattern.
    // E-RI-002 must NOT fire.
    const serverFn = makeFunctionDecl({
      name: "fetchData",
      isServer: true,
      body: [makeBareExpr("return getRecords()")],
      spanStart: 10,
    });
    const clientFn = makeFunctionDecl({
      name: "loadData",
      body: [makeReactiveDecl("data", "fetchData()", 60)],
      spanStart: 50,
    });
    const fileAST = makeFileAST("/test/app.scrml", [serverFn, clientFn]);
    const { errors } = runRIClean([fileAST]);

    const riErrors = errors.filter(e => e.code === "E-RI-002");
    expect(riErrors).toHaveLength(0);
  });

  test("function calling server fn with reactive in nested if-stmt — stays client, no E-RI-002", () => {
    // A function with no direct server triggers that has a reactive assignment NESTED
    // inside an if-stmt. With direct-only escalation, this function stays client-side.
    // Client functions can mutate reactive state at any nesting depth. No E-RI-002.
    const serverFn = makeFunctionDecl({
      name: "fetchData",
      isServer: true,
      body: [makeBareExpr("return getRecords()")],
      spanStart: 10,
    });
    const ifStmt = {
      id: 71,
      kind: "if-stmt",
      condition: "@shouldLoad",
      consequent: [makeReactiveDecl("data", "fetchData()", 72)],
      alternate: null,
      span: span(71),
    };
    const clientFn = makeFunctionDecl({
      name: "conditionalLoad",
      body: [ifStmt, makeBareExpr("fetchData()", 80)],
      spanStart: 50,
    });
    const fileAST = makeFileAST("/test/app.scrml", [serverFn, clientFn]);
    const { errors } = runRIClean([fileAST]);

    // conditionalLoad has no direct server triggers — it is client-side.
    // Client functions can freely assign reactive state. E-RI-002 must NOT fire.
    const riErrors = errors.filter(e => e.code === "E-RI-002");
    expect(riErrors).toHaveLength(0);
  });

  test("function calling server fn (via callee) with nested reactive — stays client, no E-RI-002", () => {
    // A function with no direct server triggers (no explicit annotation, no protect=
    // access, no SQL, no Bun.*). It has a reactive assignment nested inside an if-stmt.
    // With direct-only escalation, this function stays CLIENT. No E-RI-002.
    const serverFn = makeFunctionDecl({
      name: "doServerWork",
      isServer: true,
      body: [makeBareExpr("return performWork()")],
      spanStart: 10,
    });
    // The caller is transitively escalated via doServerWork().
    // The reactive assignment is nested inside an if-stmt — CPS cannot split it.
    const ifStmt = {
      id: 81,
      kind: "if-stmt",
      condition: "shouldRun",
      consequent: [makeReactiveDecl("result", "doServerWork()", 82)],
      alternate: null,
      span: span(81),
    };
    const callerFn = makeFunctionDecl({
      name: "orchestrate",
      body: [ifStmt, makeBareExpr("doServerWork()", 90)],
      spanStart: 50,
    });
    const fileAST = makeFileAST("/test/app.scrml", [serverFn, callerFn]);
    const { errors } = runRIClean([fileAST]);

    // orchestrate has no direct triggers — it is client. E-RI-002 must NOT fire.
    const riErrors = errors.filter(e => e.code === "E-RI-002");
    expect(riErrors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §11 E-ROUTE-001 — computed member access warning
// ---------------------------------------------------------------------------

describe("§11 — E-ROUTE-001: computed member access warning", () => {
  test("computed member access in bare-expr produces E-ROUTE-001 warning", () => {
    const fn = makeFunctionDecl({
      name: "getDynField",
      body: [makeBareExpr("return row[fieldKey]")],
      spanStart: 10,
    });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { errors } = runRIClean([fileAST]);

    const warnings = errors.filter(e => e.code === "E-ROUTE-001");
    expect(warnings.length).toBeGreaterThanOrEqual(1);
    expect(warnings[0].message).toContain("E-ROUTE-001");
  });

  test("E-ROUTE-001 carries severity: 'warning' (Bug 1 fix)", () => {
    // E-ROUTE-001 must have severity === "warning" so api.js classifies it
    // as a warning (not an error) at line 438-439 of api.js.
    const fn = makeFunctionDecl({
      name: "getDynField",
      body: [makeBareExpr("return row[fieldKey]")],
      spanStart: 10,
    });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { errors } = runRIClean([fileAST]);

    const warnings = errors.filter(e => e.code === "E-ROUTE-001");
    expect(warnings.length).toBeGreaterThanOrEqual(1);
    expect(warnings[0].severity).toBe("warning");
  });

  test("E-ROUTE-001 does NOT escalate the function to server", () => {
    const fn = makeFunctionDecl({
      name: "getDynField",
      body: [makeBareExpr("return row[fieldKey]")],
      spanStart: 10,
    });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { routeMap } = runRIClean([fileAST]);

    const route = getRoute(routeMap, "/test/app.scrml", 10);
    expect(route.boundary).toBe("client");
  });

  test("function with direct access only (no computed) — no E-ROUTE-001", () => {
    const fn = makeFunctionDecl({
      name: "getName",
      body: [makeBareExpr("return row.name")],
      spanStart: 10,
    });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { errors } = runRIClean([fileAST]);

    const warnings = errors.filter(e => e.code === "E-ROUTE-001");
    expect(warnings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §12 External function calls are non-escalating
// ---------------------------------------------------------------------------

describe("§12 — external function calls: non-escalating by default", () => {
  test("calling console.log (external) does not escalate function", () => {
    const fn = makeFunctionDecl({
      name: "logSomething",
      body: [makeBareExpr("console.log(message)")],
      spanStart: 10,
    });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { routeMap } = runRIClean([fileAST]);

    const route = getRoute(routeMap, "/test/app.scrml", 10);
    expect(route.boundary).toBe("client");
  });

  test("calling Math.max (external built-in) does not escalate", () => {
    const fn = makeFunctionDecl({
      name: "getMax",
      body: [makeBareExpr("return Math.max(a, b)")],
      spanStart: 10,
    });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { routeMap } = runRIClean([fileAST]);

    const route = getRoute(routeMap, "/test/app.scrml", 10);
    expect(route.boundary).toBe("client");
  });

  test("calling fetch (external browser API) does not escalate", () => {
    const fn = makeFunctionDecl({
      name: "loadUrl",
      body: [makeBareExpr("return fetch('https://example.com')")],
      spanStart: 10,
    });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { routeMap } = runRIClean([fileAST]);

    const route = getRoute(routeMap, "/test/app.scrml", 10);
    expect(route.boundary).toBe("client");
  });

  test("function calling only external functions stays client even with many callees", () => {
    const fn = makeFunctionDecl({
      name: "process",
      body: [
        makeBareExpr("const a = parseInt(x)"),
        makeBareExpr("const b = parseFloat(y)"),
        makeBareExpr("return JSON.stringify({ a, b })"),
      ],
      spanStart: 10,
    });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { routeMap } = runRIClean([fileAST]);

    const route = getRoute(routeMap, "/test/app.scrml", 10);
    expect(route.boundary).toBe("client");
  });
});

// ---------------------------------------------------------------------------
// §13 Multiple escalation reasons accumulate
// ---------------------------------------------------------------------------

describe("§13 — multiple escalation reasons accumulate", () => {
  test("function with both explicit annotation and protected field access: both reasons", () => {
    const pa = makeProtectAnalysis("/test/app.scrml::0", "users", ["passwordHash"]);

    const fn = makeFunctionDecl({
      name: "serverWithProtected",
      isServer: true,
      body: [makeBareExpr("return row.passwordHash")],
      spanStart: 10,
    });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { routeMap } = runRI({ files: [fileAST], protectAnalysis: pa });

    const route = getRoute(routeMap, "/test/app.scrml", 10);
    expect(route.boundary).toBe("server");
    expect(route.escalationReasons.length).toBeGreaterThanOrEqual(2);

    const kinds = route.escalationReasons.map(r => r.kind);
    expect(kinds).toContain("explicit-annotation");
    expect(kinds).toContain("protected-field-access");
  });

  test("function with server resource and protected field: both reasons recorded", () => {
    const pa = makeProtectAnalysis("/test/app.scrml::0", "users", ["ssn"]);

    const fn = makeFunctionDecl({
      name: "multiTrigger",
      body: [
        makeBareExpr("const f = Bun.file('/data')"),
        makeBareExpr("return row.ssn"),
      ],
      spanStart: 10,
    });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { routeMap } = runRI({ files: [fileAST], protectAnalysis: pa });

    const route = getRoute(routeMap, "/test/app.scrml", 10);
    const kinds = route.escalationReasons.map(r => r.kind);
    expect(kinds).toContain("server-only-resource");
    expect(kinds).toContain("protected-field-access");
  });
});

// §14 reserved

// ---------------------------------------------------------------------------
// §15 RouteMap entry shape — FunctionRoute fields correct
// ---------------------------------------------------------------------------

describe("§15 — FunctionRoute entry shape", () => {
  test("client FunctionRoute has null generatedRouteName and null serverEntrySpan", () => {
    const fn = makeFunctionDecl({ name: "clientFn", spanStart: 10 });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { routeMap } = runRIClean([fileAST]);

    const route = getRoute(routeMap, "/test/app.scrml", 10);
    expect(route.functionNodeId).toBe("/test/app.scrml::10");
    expect(route.boundary).toBe("client");
    expect(route.escalationReasons).toEqual([]);
    expect(route.generatedRouteName).toBeNull();
    expect(route.serverEntrySpan).toBeNull();
  });

  test("server FunctionRoute has non-null generatedRouteName and serverEntrySpan", () => {
    const fn = makeFunctionDecl({ name: "serverFn", isServer: true, spanStart: 10 });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { routeMap } = runRIClean([fileAST]);

    const route = getRoute(routeMap, "/test/app.scrml", 10);
    expect(route.functionNodeId).toBe("/test/app.scrml::10");
    expect(route.boundary).toBe("server");
    expect(route.generatedRouteName).not.toBeNull();
    expect(typeof route.generatedRouteName).toBe("string");
    expect(route.serverEntrySpan).not.toBeNull();
    expect(route.serverEntrySpan.start).toBe(10);
  });

  test("FunctionNodeId format is '{filePath}::{span.start}'", () => {
    const fn = makeFunctionDecl({ name: "fn", spanStart: 77, file: "/project/main.scrml" });
    const fileAST = makeFileAST("/project/main.scrml", [fn]);
    const { routeMap } = runRIClean([fileAST]);

    const route = routeMap.functions.get("/project/main.scrml::77");
    expect(route).toBeDefined();
    expect(route.functionNodeId).toBe("/project/main.scrml::77");
  });

  test("routeMap.functions is a Map", () => {
    const fn = makeFunctionDecl({ name: "fn", spanStart: 10 });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { routeMap } = runRIClean([fileAST]);

    expect(routeMap.functions).toBeInstanceOf(Map);
  });
});

// ---------------------------------------------------------------------------
// §16 PureDecl nodes appear in RouteMap
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// §17 Cross-file transitive escalation
// ---------------------------------------------------------------------------

describe("§17 — cross-file direct-only escalation", () => {
  test("function in fileA calling server function in fileB — stays client (no transitive escalation)", () => {
    // fileB has a server-escalated function.
    const serverFn = makeFunctionDecl({
      name: "serverAction",
      isServer: true,
      spanStart: 10,
      file: "/test/fileB.scrml",
    });
    const fileB = makeFileAST("/test/fileB.scrml", [serverFn]);

    // fileA calls serverAction (defined in fileB).
    // With direct-only escalation, the caller stays client-side and uses a fetch stub.
    const callerFn = makeFunctionDecl({
      name: "caller",
      body: [makeBareExpr("return serverAction(data)")],
      spanStart: 20,
      file: "/test/fileA.scrml",
    });
    const fileA = makeFileAST("/test/fileA.scrml", [callerFn]);

    const { routeMap } = runRIClean([fileA, fileB]);

    const callerRoute = routeMap.functions.get("/test/fileA.scrml::20");
    expect(callerRoute).toBeDefined();
    expect(callerRoute.boundary).toBe("client");
  });

  test("cross-file: caller of client function stays client", () => {
    const clientFn = makeFunctionDecl({
      name: "helper",
      body: [makeBareExpr("return x + 1")],
      spanStart: 10,
      file: "/test/fileB.scrml",
    });
    const fileB = makeFileAST("/test/fileB.scrml", [clientFn]);

    const callerFn = makeFunctionDecl({
      name: "caller",
      body: [makeBareExpr("return helper(5)")],
      spanStart: 20,
      file: "/test/fileA.scrml",
    });
    const fileA = makeFileAST("/test/fileA.scrml", [callerFn]);

    const { routeMap } = runRIClean([fileA, fileB]);

    const callerRoute = routeMap.functions.get("/test/fileA.scrml::20");
    expect(callerRoute.boundary).toBe("client");
  });

  test("cross-file cycle — no infinite loop, terminates", () => {
    // fileA.A calls fileB.B, fileB.B calls fileA.A — cross-file cycle.
    const fnA = makeFunctionDecl({
      name: "A",
      body: [makeBareExpr("return B()")],
      spanStart: 10,
      file: "/test/fileA.scrml",
    });
    const fileA = makeFileAST("/test/fileA.scrml", [fnA]);

    const fnB = makeFunctionDecl({
      name: "B",
      body: [makeBareExpr("return A()")],
      spanStart: 10,
      file: "/test/fileB.scrml",
    });
    const fileB = makeFileAST("/test/fileB.scrml", [fnB]);

    // Must terminate.
    const { routeMap } = runRIClean([fileA, fileB]);
    expect(routeMap.functions.size).toBe(2);
  });

  // ------------------------------------------------------------------
  // Cross-file caller-context propagation (T1 A3, 2026-05-11).
  //
  // The trucking-dispatch example's stale workaround comment (lines
  // 26-31, 183-184 in examples/23-trucking-dispatch/app.scrml) claimed
  // that dropping the `server` modifier on a function defined for
  // cross-file import would trigger E-CG-006 because caller-context-
  // propagation didn't cross file boundaries. That premise was already
  // false at the time the comment was written: the analysisMap built in
  // route-inference.ts Step 3 collects functions from ALL files via
  // `for (const fileAST of files)`, and the inverseCallerMap built in
  // Step 5c (lines 1933-1945) walks ALL callers across files. Caller-
  // context propagation has been cross-file from the day Insight 26 D3
  // landed (2026-05-08).
  //
  // This test pins that invariant so the workaround comment can be
  // removed and the auth fns in app.scrml can drop their explicit
  // `server` modifier without regression.
  // ------------------------------------------------------------------

  test("cross-file caller-context: helper in fileA called only from server fn in fileB escalates to server", () => {
    // fileA.helper has NO body trigger (no SQL, no protect-access, no Bun.*).
    // fileB.caller has SQL body trigger → server-classified.
    // fileB.caller calls helper. caller-context-propagation MUST cross
    // the file boundary and promote helper to server.
    const helperFn = makeFunctionDecl({
      name: "helper",
      body: [makeBareExpr("return x.toUpperCase()")],
      spanStart: 10,
      file: "/test/fileA.scrml",
    });
    const fileA = makeFileAST("/test/fileA.scrml", [helperFn]);
    fileA.exports = [{
      id: 5, kind: "export-decl", raw: "", exportedName: "helper", exportKind: "function", span: span(5, "/test/fileA.scrml"),
    }];

    const callerFn = makeFunctionDecl({
      name: "caller",
      body: [
        makeLetDecl("u", "?{`SELECT * FROM users`}.get()", 60, "/test/fileB.scrml"),
        makeBareExpr("return helper(u.name)", 80, "/test/fileB.scrml"),
      ],
      spanStart: 50,
      file: "/test/fileB.scrml",
    });
    const fileB = makeFileAST("/test/fileB.scrml", [callerFn]);
    fileB.imports = [{
      id: 2, kind: "import-decl", source: "./fileA.scrml",
      specifiers: [{ kind: "named", local: "helper", imported: "helper" }],
    }];

    const { routeMap } = runRIClean([fileA, fileB]);

    const helperRoute = routeMap.functions.get("/test/fileA.scrml::10");
    const callerRoute = routeMap.functions.get("/test/fileB.scrml::50");

    expect(helperRoute).toBeDefined();
    expect(callerRoute).toBeDefined();

    // caller is server (SQL body trigger).
    expect(callerRoute.boundary).toBe("server");
    // helper escalated cross-file via caller-context-propagation.
    expect(helperRoute.boundary).toBe("server");
    const helperReasons = helperRoute.escalationReasons.map(r => r.resourceType).filter(Boolean);
    expect(helperReasons).toContain("caller-context-propagation");
  });

  test("cross-file caller-context: mixed callers (one server, one client) keep helper client", () => {
    // helper in fileA is called by serverFn in fileB AND clientFn in fileC.
    // Mixed-context call graph → helper stays client (ambient).
    const helperFn = makeFunctionDecl({
      name: "shared",
      body: [makeBareExpr("return x.trim()")],
      spanStart: 10,
      file: "/test/fileA.scrml",
    });
    const fileA = makeFileAST("/test/fileA.scrml", [helperFn]);
    fileA.exports = [{
      id: 5, kind: "export-decl", raw: "", exportedName: "shared", exportKind: "function", span: span(5, "/test/fileA.scrml"),
    }];

    const serverFn = makeFunctionDecl({
      name: "serverCaller",
      body: [
        makeLetDecl("u", "?{`SELECT * FROM users`}.get()", 60, "/test/fileB.scrml"),
        makeBareExpr("return shared(u.name)", 80, "/test/fileB.scrml"),
      ],
      spanStart: 50,
      file: "/test/fileB.scrml",
    });
    const fileB = makeFileAST("/test/fileB.scrml", [serverFn]);
    fileB.imports = [{
      id: 2, kind: "import-decl", source: "./fileA.scrml",
      specifiers: [{ kind: "named", local: "shared", imported: "shared" }],
    }];

    const clientFn = makeFunctionDecl({
      name: "clientCaller",
      body: [makeBareExpr("return shared('hello')")],
      spanStart: 100,
      file: "/test/fileC.scrml",
    });
    const fileC = makeFileAST("/test/fileC.scrml", [clientFn]);
    fileC.imports = [{
      id: 2, kind: "import-decl", source: "./fileA.scrml",
      specifiers: [{ kind: "named", local: "shared", imported: "shared" }],
    }];

    const { routeMap } = runRIClean([fileA, fileB, fileC]);

    const helperRoute = routeMap.functions.get("/test/fileA.scrml::10");
    expect(helperRoute).toBeDefined();
    // Mixed callers — stays client (ambient).
    expect(helperRoute.boundary).toBe("client");
  });
});

// ---------------------------------------------------------------------------
// §18 fn-shorthand nodes (fnKind === 'fn') in RouteMap
// ---------------------------------------------------------------------------

describe("§18 — fn-shorthand nodes in RouteMap", () => {
  test("function-decl with fnKind='fn' appears in routeMap", () => {
    const fn = makeFunctionDecl({ name: "shortFn", fnKind: "fn", spanStart: 10 });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { routeMap } = runRIClean([fileAST]);

    const route = getRoute(routeMap, "/test/app.scrml", 10);
    expect(route).toBeDefined();
    expect(route.boundary).toBe("client");
  });

  test("server fn-shorthand is escalated via explicit annotation", () => {
    const fn = makeFunctionDecl({ name: "serverShort", fnKind: "fn", isServer: true, spanStart: 10 });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { routeMap } = runRIClean([fileAST]);

    const route = getRoute(routeMap, "/test/app.scrml", 10);
    expect(route.boundary).toBe("server");
    expect(route.escalationReasons[0].kind).toBe("explicit-annotation");
  });
});

// ---------------------------------------------------------------------------
// §19 Empty file — no errors, empty routeMap
// ---------------------------------------------------------------------------

describe("§19 — edge cases", () => {
  test("empty files array produces empty routeMap and no errors", () => {
    const { routeMap, errors } = runRIClean([]);
    expect(routeMap.functions.size).toBe(0);
    expect(errors).toHaveLength(0);
  });

  test("file with no function nodes produces empty routeMap", () => {
    const fileAST = {
      filePath: "/test/empty.scrml",
      nodes: [],
      imports: [],
      exports: [],
      components: [],
      typeDecls: [],
      spans: new Map(),
    };
    const { routeMap } = runRIClean([fileAST]);
    expect(routeMap.functions.size).toBe(0);
  });

  test("errors array is always an array (never undefined)", () => {
    const fn = makeFunctionDecl({ name: "fn", spanStart: 10 });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { errors } = runRIClean([fileAST]);
    expect(Array.isArray(errors)).toBe(true);
  });

  test("routeMap.functions is a Map even for empty input", () => {
    const { routeMap } = runRIClean([]);
    expect(routeMap.functions).toBeInstanceOf(Map);
  });

  test("function with no body nodes is client-default", () => {
    const fn = makeFunctionDecl({ name: "noop", body: [], spanStart: 10 });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { routeMap } = runRIClean([fileAST]);

    const route = getRoute(routeMap, "/test/app.scrml", 10);
    expect(route.boundary).toBe("client");
  });

  test("runRI returns no-throw on null-ish node in body", () => {
    const fn = makeFunctionDecl({
      name: "weirdFn",
      body: [null, undefined, makeBareExpr("return 1")],
      spanStart: 10,
    });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    // Should not throw.
    expect(() => runRIClean([fileAST])).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// §20 CPS transformation — server/client boundary splitting
// ---------------------------------------------------------------------------

describe("§20 — CPS transformation: server/client boundary splitting", () => {
  test("classic loadData pattern: @loading, server call, @data — client fn, no E-RI-002", () => {
    // The canonical loadData pattern:
    //   @loading = true
    //   fetchFromDB()        // fetchFromDB is server-escalated (direct annotation)
    //   @loading = false
    // With direct-only escalation: loadData has no direct server triggers.
    // loadData stays CLIENT-side. The fetch stub handles the server call.
    // Client functions can freely set @reactive — no E-RI-002, no CPS needed.
    const fetchFn = makeFunctionDecl({
      name: "fetchFromDB",
      isServer: true,
      body: [makeBareExpr("return db.query('SELECT * FROM users')")],
      spanStart: 10,
    });
    const loadData = makeFunctionDecl({
      name: "loadData",
      body: [
        makeReactiveDecl("loading", "true", 60),
        makeBareExpr("fetchFromDB()", 70),
        makeReactiveDecl("loading", "false", 80),
      ],
      spanStart: 50,
    });
    const fileAST = makeFileAST("/test/app.scrml", [fetchFn, loadData]);
    const { routeMap, errors } = runRIClean([fileAST]);

    // No E-RI-002 — loadData is a client function, reactive assignments are fine.
    const riErrors = errors.filter(e => e.code === "E-RI-002");
    expect(riErrors).toHaveLength(0);

    // loadData is client with no cpsSplit needed.
    const route = getRoute(routeMap, "/test/app.scrml", 50);
    expect(route.boundary).toBe("client");
    expect(route.cpsSplit).toBeNull();
  });

  test("@data = serverCall() pattern — client fn, no E-RI-002, no cpsSplit", () => {
    const serverFn = makeFunctionDecl({
      name: "getUsers",
      isServer: true,
      body: [makeBareExpr("return db.query('SELECT * FROM users')")],
      spanStart: 10,
    });
    const loadFn = makeFunctionDecl({
      name: "loadUsers",
      body: [
        makeReactiveDecl("loading", "true", 60),
        makeReactiveDecl("data", "getUsers()", 70),
        makeReactiveDecl("loading", "false", 80),
      ],
      spanStart: 50,
    });
    const fileAST = makeFileAST("/test/app.scrml", [serverFn, loadFn]);
    const { routeMap, errors } = runRIClean([fileAST]);

    // With direct-only escalation: loadUsers has no direct server triggers.
    // It stays CLIENT-side. No E-RI-002, no CPS needed.
    const riErrors = errors.filter(e => e.code === "E-RI-002");
    expect(riErrors).toHaveLength(0);

    const route = getRoute(routeMap, "/test/app.scrml", 50);
    expect(route.boundary).toBe("client");
    expect(route.cpsSplit).toBeNull();
  });

  test("function with explicit server annotation but no server body statements — E-RI-002 stands", () => {
    // isServer: true escalates the function, but no individual body statement
    // is a server trigger. CPS cannot split because there are no server statements.
    const fn = makeFunctionDecl({
      name: "annotatedFn",
      isServer: true,
      body: [
        makeReactiveDecl("count", "count + 1"),
        makeBareExpr("console.log(count)"),
      ],
      spanStart: 10,
    });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { routeMap, errors } = runRIClean([fileAST]);

    // CPS not eligible because no server statements in body — E-RI-002 fires.
    const riErrors = errors.filter(e => e.code === "E-RI-002");
    expect(riErrors).toHaveLength(1);

    const route = getRoute(routeMap, "/test/app.scrml", 10);
    expect(route.cpsSplit).toBeNull();
  });

  test("CPS split with Bun.file server trigger in bare-expr", () => {
    const fn = makeFunctionDecl({
      name: "loadConfig",
      body: [
        makeReactiveDecl("loading", "true", 60),
        makeBareExpr("const config = Bun.file('/etc/config.json')", 70),
        makeReactiveDecl("config", "config", 80),
        makeReactiveDecl("loading", "false", 90),
      ],
      spanStart: 50,
    });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { routeMap, errors } = runRIClean([fileAST]);

    const riErrors = errors.filter(e => e.code === "E-RI-002");
    expect(riErrors).toHaveLength(0);

    const route = getRoute(routeMap, "/test/app.scrml", 50);
    expect(route.cpsSplit).not.toBeNull();
    expect(route.cpsSplit.serverStmtIndices).toEqual([1]); // Bun.file is index 1
    expect(route.cpsSplit.clientStmtIndices).toEqual([0, 2, 3]); // reactive assignments
  });

  test("mixed statement (bare-expr with @var AND server resource) — CPS NOT eligible, E-RI-002 fires", () => {
    // A bare-expr that both assigns @reactive AND accesses a server-only resource:
    // CPS cannot split a single expression. E-RI-002 fires for all server-escalated
    // functions where CPS is not eligible, regardless of the escalation reason.
    const fn = makeFunctionDecl({
      name: "mixedFn",
      body: [
        { id: 60, kind: "bare-expr", expr: "@data = Bun.file('/etc/data.json')", span: span(60) },
      ],
      spanStart: 50,
    });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { routeMap, errors } = runRIClean([fileAST]);

    // E-RI-002 fires: CPS is not eligible for this single mixed expression.
    const riErrors = errors.filter(e => e.code === "E-RI-002");
    expect(riErrors).toHaveLength(1);

    const route = getRoute(routeMap, "/test/app.scrml", 50);
    expect(route.cpsSplit).toBeNull();
  });

  test("client-only function with reactive assignments — no cpsSplit, no E-RI-002", () => {
    const fn = makeFunctionDecl({
      name: "increment",
      body: [makeReactiveDecl("count", "count + 1")],
      spanStart: 10,
    });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { routeMap, errors } = runRIClean([fileAST]);

    const riErrors = errors.filter(e => e.code === "E-RI-002");
    expect(riErrors).toHaveLength(0);

    const route = getRoute(routeMap, "/test/app.scrml", 10);
    expect(route.boundary).toBe("client");
    expect(route.cpsSplit).toBeNull();
  });

  test("server function with no reactive assignments — no cpsSplit, no E-RI-002", () => {
    const fn = makeFunctionDecl({
      name: "fetchUser",
      isServer: true,
      body: [makeBareExpr("return getUser(id)")],
      spanStart: 10,
    });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { routeMap, errors } = runRIClean([fileAST]);

    const riErrors = errors.filter(e => e.code === "E-RI-002");
    expect(riErrors).toHaveLength(0);

    const route = getRoute(routeMap, "/test/app.scrml", 10);
    expect(route.boundary).toBe("server");
    expect(route.cpsSplit).toBeNull();
  });

  test("cpsSplit is null for all client-boundary functions", () => {
    const fn1 = makeFunctionDecl({ name: "a", spanStart: 10 });
    const fn2 = makeFunctionDecl({ name: "b", spanStart: 50 });
    const fileAST = makeFileAST("/test/app.scrml", [fn1, fn2]);
    const { routeMap } = runRIClean([fileAST]);

    for (const [, route] of routeMap.functions) {
      expect(route.cpsSplit).toBeNull();
    }
  });

  test("protected field access as server trigger enables CPS split", () => {
    const pa = makeProtectAnalysis("/test/app.scrml::0", "users", ["passwordHash"]);

    const fn = makeFunctionDecl({
      name: "verifyUser",
      body: [
        makeReactiveDecl("status", "'checking'", 60),
        makeBareExpr("const result = row.passwordHash === input", 70),
        makeReactiveDecl("status", "'done'", 80),
      ],
      spanStart: 50,
    });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { routeMap, errors } = runRI({ files: [fileAST], protectAnalysis: pa });

    const riErrors = errors.filter(e => e.code === "E-RI-002");
    expect(riErrors).toHaveLength(0);

    const route = getRoute(routeMap, "/test/app.scrml", 50);
    expect(route.cpsSplit).not.toBeNull();
    expect(route.cpsSplit.serverStmtIndices).toEqual([1]);
    expect(route.cpsSplit.clientStmtIndices).toEqual([0, 2]);
  });

  test("SQL block as server trigger enables CPS split", () => {
    const fn = makeFunctionDecl({
      name: "queryAndUpdate",
      body: [
        makeReactiveDecl("loading", "true", 60),
        { id: 70, kind: "sql", query: "SELECT * FROM users", span: span(70) },
        makeReactiveDecl("loading", "false", 80),
      ],
      spanStart: 50,
    });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { routeMap, errors } = runRIClean([fileAST]);

    const riErrors = errors.filter(e => e.code === "E-RI-002");
    expect(riErrors).toHaveLength(0);

    const route = getRoute(routeMap, "/test/app.scrml", 50);
    expect(route.cpsSplit).not.toBeNull();
    expect(route.cpsSplit.serverStmtIndices).toEqual([1]);
  });

  test("multiple server statements in CPS split", () => {
    const fn = makeFunctionDecl({
      name: "multiServer",
      body: [
        makeReactiveDecl("status", "'starting'", 60),
        makeBareExpr("const file1 = Bun.file('/a')", 70),
        makeBareExpr("const file2 = Bun.file('/b')", 80),
        makeReactiveDecl("status", "'done'", 90),
      ],
      spanStart: 50,
    });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { routeMap, errors } = runRIClean([fileAST]);

    const riErrors = errors.filter(e => e.code === "E-RI-002");
    expect(riErrors).toHaveLength(0);

    const route = getRoute(routeMap, "/test/app.scrml", 50);
    expect(route.cpsSplit).not.toBeNull();
    expect(route.cpsSplit.serverStmtIndices).toEqual([1, 2]);
    expect(route.cpsSplit.clientStmtIndices).toEqual([0, 3]);
  });
});

// ---------------------------------------------------------------------------
// §19 — Explicit route= and method= attributes
// ---------------------------------------------------------------------------

describe("§19 — explicit route= and method= attributes", () => {
  test("server function with route= uses explicit route as generatedRouteName", () => {
    const fn = makeFunctionDecl({
      name: "oauthCallback",
      isServer: true,
      body: [makeBareExpr("return handleOAuth()")],
      spanStart: 10,
    });
    fn.route = "/oauth/callback";
    fn.method = "GET";

    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { routeMap, errors } = runRIClean([fileAST]);

    const route = getRoute(routeMap, "/test/app.scrml", 10);
    expect(route.boundary).toBe("server");
    expect(route.generatedRouteName).toBe("/oauth/callback");
    expect(route.explicitRoute).toBe("/oauth/callback");
    expect(route.explicitMethod).toBe("GET");
  });

  test("server function without route= gets generated route name", () => {
    const fn = makeFunctionDecl({
      name: "fetchData",
      isServer: true,
      body: [makeBareExpr("return getData()")],
      spanStart: 10,
    });

    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { routeMap } = runRIClean([fileAST]);

    const route = getRoute(routeMap, "/test/app.scrml", 10);
    expect(route.boundary).toBe("server");
    expect(route.generatedRouteName).toContain("__ri_route_fetchData");
    expect(route.explicitRoute).toBeNull();
    expect(route.explicitMethod).toBeNull();
  });

  test("function with route= but no server triggers is still client", () => {
    const fn = makeFunctionDecl({
      name: "hello",
      body: [makeBareExpr("console.log('hi')")],
      spanStart: 10,
    });
    fn.route = "/hello";
    fn.method = "GET";

    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { routeMap } = runRIClean([fileAST]);

    const route = getRoute(routeMap, "/test/app.scrml", 10);
    // No server triggers, so it stays client even with route= attribute
    expect(route.boundary).toBe("client");
    expect(route.generatedRouteName).toBeNull();
  });

  test("server function with route= only (no method=) defaults explicitMethod to null", () => {
    const fn = makeFunctionDecl({
      name: "webhook",
      isServer: true,
      body: [makeBareExpr("return processWebhook()")],
      spanStart: 10,
    });
    fn.route = "/webhooks/stripe";

    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { routeMap } = runRIClean([fileAST]);

    const route = getRoute(routeMap, "/test/app.scrml", 10);
    expect(route.explicitRoute).toBe("/webhooks/stripe");
    expect(route.explicitMethod).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// §19 File-based page routing — buildPageRouteTree
// ---------------------------------------------------------------------------

describe("buildPageRouteTree", () => {
  test("index.scrml in routes/ maps to /", () => {
    const files = [makeFileAST("/app/src/routes/index.scrml", [])];
    const pages = buildPageRouteTree(files);
    expect(pages.size).toBe(1);
    const page = pages.get("/app/src/routes/index.scrml");
    expect(page).toBeDefined();
    expect(page.urlPattern).toBe("/");
    expect(page.params).toEqual([]);
    expect(page.isCatchAll).toBe(false);
  });

  test("static file maps to its name as URL segment", () => {
    const files = [makeFileAST("/app/src/routes/about.scrml", [])];
    const pages = buildPageRouteTree(files);
    const page = pages.get("/app/src/routes/about.scrml");
    expect(page.urlPattern).toBe("/about");
    expect(page.params).toEqual([]);
  });

  test("nested static file maps to nested URL", () => {
    const files = [makeFileAST("/app/src/routes/users/settings.scrml", [])];
    const pages = buildPageRouteTree(files);
    const page = pages.get("/app/src/routes/users/settings.scrml");
    expect(page.urlPattern).toBe("/users/settings");
    expect(page.params).toEqual([]);
  });

  test("[param].scrml maps to dynamic segment :param", () => {
    const files = [makeFileAST("/app/src/routes/users/[id].scrml", [])];
    const pages = buildPageRouteTree(files);
    const page = pages.get("/app/src/routes/users/[id].scrml");
    expect(page.urlPattern).toBe("/users/:id");
    expect(page.params).toEqual(["id"]);
    expect(page.isCatchAll).toBe(false);
  });

  test("[...slug].scrml maps to catch-all route", () => {
    const files = [makeFileAST("/app/src/routes/posts/[...slug].scrml", [])];
    const pages = buildPageRouteTree(files);
    const page = pages.get("/app/src/routes/posts/[...slug].scrml");
    expect(page.urlPattern).toBe("/posts/*slug");
    expect(page.params).toEqual(["slug"]);
    expect(page.isCatchAll).toBe(true);
  });

  test("nested index.scrml maps to parent directory URL", () => {
    const files = [makeFileAST("/app/src/routes/users/index.scrml", [])];
    const pages = buildPageRouteTree(files);
    const page = pages.get("/app/src/routes/users/index.scrml");
    expect(page.urlPattern).toBe("/users");
  });

  test("_layout.scrml is excluded from page routes", () => {
    const files = [
      makeFileAST("/app/src/routes/_layout.scrml", []),
      makeFileAST("/app/src/routes/index.scrml", []),
    ];
    const pages = buildPageRouteTree(files);
    expect(pages.has("/app/src/routes/_layout.scrml")).toBe(false);
    expect(pages.has("/app/src/routes/index.scrml")).toBe(true);
  });

  test("file not under routes/ gets root URL /", () => {
    const files = [makeFileAST("/app/src/app.scrml", [])];
    const pages = buildPageRouteTree(files);
    const page = pages.get("/app/src/app.scrml");
    expect(page.urlPattern).toBe("/");
  });

  test("multiple files build complete route tree", () => {
    const files = [
      makeFileAST("/app/src/routes/index.scrml", []),
      makeFileAST("/app/src/routes/about.scrml", []),
      makeFileAST("/app/src/routes/users/[id].scrml", []),
      makeFileAST("/app/src/routes/users/index.scrml", []),
    ];
    const pages = buildPageRouteTree(files);
    expect(pages.size).toBe(4);
    expect(pages.get("/app/src/routes/index.scrml").urlPattern).toBe("/");
    expect(pages.get("/app/src/routes/about.scrml").urlPattern).toBe("/about");
    expect(pages.get("/app/src/routes/users/[id].scrml").urlPattern).toBe("/users/:id");
    expect(pages.get("/app/src/routes/users/index.scrml").urlPattern).toBe("/users");
  });

  test("runRI includes pages in routeMap", () => {
    const files = [makeFileAST("/app/src/routes/index.scrml", [])];
    const { routeMap } = runRI({ files, protectAnalysis: { views: new Map() } });
    expect(routeMap.pages).toBeDefined();
    expect(routeMap.pages.size).toBe(1);
  });
});
// ---------------------------------------------------------------------------
// §21 — scrml: module imports recognized as server triggers for CPS
// (Regression test for BUG-R15-003)
// ---------------------------------------------------------------------------

/**
 * Build a FileAST with imports.
 * Like makeFileAST but accepts an imports array for testing scrml: stdlib recognition.
 */
function makeFileASTWithImports(filePath, fnNodes, imports) {
  return {
    filePath,
    nodes: [
      {
        id: 1,
        kind: 'logic',
        body: fnNodes,
        span: span(0, filePath),
      },
    ],
    imports,
    exports: [],
    components: [],
    typeDecls: [],
    spans: new Map(),
  };
}

/**
 * Build an import-decl node.
 */
function makeImportDecl(names, source, spanStart = 5) {
  return {
    id: spanStart,
    kind: 'import-decl',
    names,
    source,
    raw: "import { " + names.join(", ") + " } from " + source,
    span: span(spanStart),
  };
}

describe('§21 — scrml: module imports recognized as server triggers for CPS (BUG-R15-003)', () => {
  test('server function calling hash() from scrml:crypto with reactive assignments — CPS splits, no E-RI-002', () => {
    // This is the BUG-R15-003 regression test.
    // login() calls hash() imported from scrml:crypto and sets @loggedIn, @users.
    // hash() is not in resolvedServerFnIds but is a server-only import.
    // CPS should split: hash() call stays server, @reactive assignments go to client.
    const loginFn = makeFunctionDecl({
      name: 'login',
      isServer: true,
      body: [
        makeLetDecl('hashed', 'hash(password)', 20),
        makeReactiveDecl('loggedIn', 'true', 30),
        makeReactiveDecl('users', '[{ id: 1 }]', 40),
      ],
      spanStart: 10,
    });
    const hashImport = makeImportDecl(['hash'], 'scrml:crypto');
    const fileAST = makeFileASTWithImports('/test/app.scrml', [loginFn], [hashImport]);
    const { routeMap, errors } = runRIClean([fileAST]);

    // E-RI-002 must NOT fire — CPS handles the split.
    const riErrors = errors.filter(e => e.code === 'E-RI-002');
    expect(riErrors).toHaveLength(0);

    // login() should have cpsSplit with hash() call on the server side.
    const route = getRoute(routeMap, '/test/app.scrml', 10);
    expect(route).toBeDefined();
    expect(route.boundary).toBe('server');
    expect(route.cpsSplit).not.toBeNull();
    // Server indices: [0] (const hashed = hash(...))
    expect(route.cpsSplit.serverStmtIndices).toContain(0);
    // Client indices: [1, 2] (@loggedIn and @users)
    expect(route.cpsSplit.clientStmtIndices).toContain(1);
    expect(route.cpsSplit.clientStmtIndices).toContain(2);
  });

  test('server function calling scrml:auth verify() with reactive assignment — CPS splits, no E-RI-002', () => {
    // Same pattern but with scrml:auth instead of scrml:crypto.
    const authFn = makeFunctionDecl({
      name: 'checkAuth',
      isServer: true,
      body: [
        makeLetDecl('ok', 'verify(token)', 20),
        makeReactiveDecl('authenticated', 'ok', 30),
      ],
      spanStart: 10,
    });
    const verifyImport = makeImportDecl(['verify'], 'scrml:auth');
    const fileAST = makeFileASTWithImports('/test/app.scrml', [authFn], [verifyImport]);
    const { routeMap, errors } = runRIClean([fileAST]);

    const riErrors = errors.filter(e => e.code === 'E-RI-002');
    expect(riErrors).toHaveLength(0);

    const route = getRoute(routeMap, '/test/app.scrml', 10);
    expect(route.cpsSplit).not.toBeNull();
    expect(route.cpsSplit.serverStmtIndices).toContain(0);
  });

  test('explicit server function with ONLY reactive assignments and scrml: import — E-RI-002 still fires', () => {
    // The scrml: import exists but the function body has no non-reactive statements.
    // There is nothing to put on the server side — CPS cannot split.
    // This should still emit E-RI-002 (the function is server but has no server work in body).
    const fn = makeFunctionDecl({
      name: 'badFn',
      isServer: true,
      body: [
        makeReactiveDecl('count', 'count + 1', 20),
      ],
      spanStart: 10,
    });
    const hashImport = makeImportDecl(['hash'], 'scrml:crypto');
    const fileAST = makeFileASTWithImports('/test/app.scrml', [fn], [hashImport]);
    const { routeMap, errors } = runRIClean([fileAST]);

    // E-RI-002 fires: import exists but body has only reactive assignments.
    const riErrors = errors.filter(e => e.code === 'E-RI-002');
    expect(riErrors).toHaveLength(1);

    const route = getRoute(routeMap, '/test/app.scrml', 10);
    expect(route.cpsSplit).toBeNull();
  });
});


// ---------------------------------------------------------------------------
// §22 — ?{} SQL sigil in let-decl/const-decl init escalates to server (BUG-R13-002)
// ---------------------------------------------------------------------------

describe("§22 — ?{} SQL sigil in let-decl/const-decl escalates to server (BUG-R13-002)", () => {
  test("let-decl with ?{} SQL sigil in init escalates function to server boundary", () => {
    // Regression test for BUG-R13-002: `let newMsg = ?{\`SELECT...\`}.get()` inside a function
    // must trigger server escalation. Previously, isServerTriggerStatement() did not detect
    // the ?{} SQL sigil in let-decl init strings, causing E-CG-006 in the CPS wrapper.
    const fn = makeFunctionDecl({
      name: "sendMessage",
      body: [
        makeLetDecl("newMsg", "?{`SELECT id FROM messages WHERE id = 1`}.get()", 20),
      ],
      spanStart: 10,
    });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { routeMap, errors } = runRIClean([fileAST]);

    const route = getRoute(routeMap, "/test/app.scrml", 10);
    expect(route.boundary).toBe("server");
    expect(route.escalationReasons[0].kind).toBe("server-only-resource");
    expect(route.escalationReasons[0].resourceType).toBe("sql-query");
    // No E-CG-006 errors
    const cgErrors = errors.filter(e => e.code === "E-CG-006");
    expect(cgErrors).toHaveLength(0);
  });

  test("const-decl with ?{} SQL sigil in init escalates function to server boundary", () => {
    // Same as let-decl but with const-decl kind.
    const fn = makeFunctionDecl({
      name: "loadData",
      body: [
        {
          id: 20,
          kind: "const-decl",
          name: "rows",
          init: "?{`SELECT * FROM users`}.all()",
          span: { file: "/test/app.scrml", start: 20, end: 30, line: 1, col: 21 },
        },
      ],
      spanStart: 10,
    });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { routeMap, errors } = runRIClean([fileAST]);

    const route = getRoute(routeMap, "/test/app.scrml", 10);
    expect(route.boundary).toBe("server");
    expect(route.escalationReasons[0].resourceType).toBe("sql-query");
  });

  test("let-decl with ?{} SQL in init + state-decl — CPS splits correctly, no E-RI-002", () => {
    // The full BUG-R13-002 pattern: a function has a let-decl containing SQL and a reactive
    // assignment. CPS should split: SQL let-decl is server-side, state-decl is client-side.
    // Without the fix, the let-decl was not recognized as a server trigger and E-CG-006 fired.
    const fn = makeFunctionDecl({
      name: "sendMessage",
      body: [
        makeLetDecl("newMsg", "?{`SELECT id, body FROM messages ORDER BY id DESC LIMIT 1`}.get()", 20),
        makeReactiveDecl("messages", "[...@messages, newMsg]", 30),
      ],
      spanStart: 10,
    });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { routeMap, errors } = runRIClean([fileAST]);

    // E-RI-002 must NOT fire — CPS handles the split.
    const riErrors = errors.filter(e => e.code === "E-RI-002");
    expect(riErrors).toHaveLength(0);

    // sendMessage should be server-escalated with CPS split.
    const route = getRoute(routeMap, "/test/app.scrml", 10);
    expect(route.boundary).toBe("server");
    expect(route.cpsSplit).not.toBeNull();
    // Server side: the SQL let-decl (index 0)
    expect(route.cpsSplit.serverStmtIndices).toContain(0);
    // Client side: the reactive assignment (index 1)
    expect(route.cpsSplit.clientStmtIndices).toContain(1);
  });

  test("bare-expr with ?{} SQL sigil escalates function to server boundary", () => {
    // ?{} SQL in a bare-expr should also trigger server escalation via SERVER_ONLY_PATTERNS.
    const fn = makeFunctionDecl({
      name: "runQuery",
      body: [
        makeBareExpr("?{`DELETE FROM sessions WHERE expired = 1`}.run()", 20),
      ],
      spanStart: 10,
    });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { routeMap } = runRIClean([fileAST]);

    const route = getRoute(routeMap, "/test/app.scrml", 10);
    expect(route.boundary).toBe("server");
    expect(route.escalationReasons[0].resourceType).toBe("sql-query");
  });
});

// §23 — session object escalates to server (BUG-R13-003)
describe("§23 — session object escalates to server (BUG-R13-003)", () => {
  test("session.userId in function body escalates to server", () => {
    const fn = makeFunctionDecl({
      name: "initSession",
      body: [
        makeBareExpr("let uid = session.userId", 20),
      ],
      spanStart: 10,
    });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { routeMap } = runRIClean([fileAST]);
    const route = getRoute(routeMap, "/test/app.scrml", 10);
    expect(route.boundary).toBe("server");
    expect(route.escalationReasons.some(r => r.resourceType === "session")).toBe(true);
  });

  test("session + reactive var produces E-RI-002 (CPS cannot split session access + reactive assign)", () => {
    const fn = makeFunctionDecl({
      name: "initSession",
      body: [
        makeBareExpr("@currentUserId = session.userId", 20),
      ],
      spanStart: 10,
    });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { errors } = runRIClean([fileAST]);
    // session access causes server escalation; bare-expr mixes reactive assign + server resource.
    // CPS cannot split a single bare-expr; E-RI-002 fires.
    const ri002 = errors.filter(e => e.code === "E-RI-002");
    expect(ri002).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// §24 — No transitive escalation: client fn calling server fn stays client
// ---------------------------------------------------------------------------

describe("§24 — client function calling server function stays client", () => {
  test("doCheckout pattern: @state assignments + server call — all client, no E-RI-002", () => {
    // The motivating example for this fix:
    //   @checkoutState = CheckoutState.Loading()    <- client reactive assign
    //   const result = processPayment(100)           <- calls server fn
    //   @checkoutState = CheckoutState.Confirmed(result)  <- client reactive assign
    // With direct-only escalation: doCheckout has no direct triggers.
    // It stays CLIENT. Reactive assignments are fine. No E-RI-002.
    const serverFn = makeFunctionDecl({
      name: "processPayment",
      isServer: true,
      spanStart: 10,
    });
    const clientFn = makeFunctionDecl({
      name: "doCheckout",
      body: [
        makeReactiveDecl("checkoutState", "CheckoutState.Loading()", 60),
        makeBareExpr("const result = processPayment(100)", 70),
        makeReactiveDecl("checkoutState", "CheckoutState.Confirmed(result)", 80),
      ],
      spanStart: 50,
    });
    const fileAST = makeFileAST("/test/app.scrml", [serverFn, clientFn]);
    const { routeMap, errors } = runRIClean([fileAST]);

    const route = getRoute(routeMap, "/test/app.scrml", 50);
    expect(route.boundary).toBe("client");
    expect(route.cpsSplit).toBeNull();

    const ri002 = errors.filter(e => e.code === "E-RI-002");
    expect(ri002).toHaveLength(0);
  });

  test("directly annotated server function with reactive assignment still triggers E-RI-002 (no CPS split possible)", () => {
    // server function with reactive assignment nested in if (CPS cannot split nested reactive).
    // This IS a direct trigger (explicit annotation), so E-RI-002 still fires.
    const ifStmt = {
      id: 71,
      kind: "if-stmt",
      condition: "true",
      consequent: [makeReactiveDecl("result", "42", 72)],
      alternate: null,
      span: span(71),
    };
    const fn = makeFunctionDecl({
      name: "badServerFn",
      isServer: true,
      body: [ifStmt],
      spanStart: 10,
    });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { errors } = runRIClean([fileAST]);

    const ri002 = errors.filter(e => e.code === "E-RI-002");
    expect(ri002).toHaveLength(1);
  });

  test("multi-hop chain: only direct-trigger function escalates", () => {
    // A calls B calls C where C has a direct trigger (Bun.env).
    // B calls C but has no direct triggers — stays client.
    // A calls B but has no direct triggers — stays client.
    const fnC = makeFunctionDecl({
      name: "C",
      body: [makeBareExpr("return Bun.env.SECRET")],
      spanStart: 10,
    });
    const fnB = makeFunctionDecl({
      name: "B",
      body: [makeBareExpr("return C()")],
      spanStart: 50,
    });
    const fnA = makeFunctionDecl({
      name: "A",
      body: [makeBareExpr("return B()")],
      spanStart: 90,
    });
    const fileAST = makeFileAST("/test/app.scrml", [fnC, fnB, fnA]);
    const { routeMap } = runRIClean([fileAST]);

    expect(getRoute(routeMap, "/test/app.scrml", 10).boundary).toBe("server"); // C: direct trigger
    expect(getRoute(routeMap, "/test/app.scrml", 50).boundary).toBe("client"); // B: no direct trigger
    expect(getRoute(routeMap, "/test/app.scrml", 90).boundary).toBe("client"); // A: no direct trigger
  });
});

// ---------------------------------------------------------------------------
// §25 — E-ROUTE-001 suppressed inside worker bodies (<program name="...">)
//
// Bug 2 fix: Worker programs (<program name="primes">) are isolated execution
// contexts with no access to protected fields or shared reactive state.
// Computed member access inside worker bodies (e.g., flags[i], flags[j]) is
// safe and expected (array indexing). E-ROUTE-001 must NOT fire inside workers.
// ---------------------------------------------------------------------------

describe("§25 — E-ROUTE-001: suppressed inside worker bodies", () => {
  test("computed member access inside <program name='...'> worker body does NOT produce E-ROUTE-001", () => {
    // Simulates the sieve() function in examples/13-worker.scrml.
    // flags[0] = false, flags[j] = false — all computed array access in a worker.
    const sieveFn = makeFunctionDecl({
      name: "sieve",
      body: [
        makeBareExpr("const flags = Array(limit + 1).fill(true)", 110),
        makeBareExpr("flags[0] = false", 120),
        makeBareExpr("flags[1] = false", 130),
        makeBareExpr("for (let j = i * i; j <= limit; j += i) { flags[j] = false }", 140),
      ],
      spanStart: 105,
    });
    const fileAST = makeWorkerFileAST("/test/worker.scrml", "primes", [sieveFn]);
    const { errors } = runRIClean([fileAST]);

    const route001 = errors.filter(e => e.code === "E-ROUTE-001");
    expect(route001).toHaveLength(0);
  });

  test("computed member access at top level (non-worker) still produces E-ROUTE-001", () => {
    // Same computed access pattern but at the top level — not in a worker.
    // E-ROUTE-001 must fire here, and must carry severity: "warning".
    const fn = makeFunctionDecl({
      name: "getField",
      body: [makeBareExpr("return row[fieldKey]", 20)],
      spanStart: 10,
    });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { errors } = runRIClean([fileAST]);

    const route001 = errors.filter(e => e.code === "E-ROUTE-001");
    expect(route001.length).toBeGreaterThanOrEqual(1);
    expect(route001[0].severity).toBe("warning");
  });

  test("worker body function does not escalate to server due to E-ROUTE-001 suppression", () => {
    // The sieve function in the worker body should stay client-boundary
    // (workers are isolated — no protected fields, no escalation triggers).
    const sieveFn = makeFunctionDecl({
      name: "sieve",
      body: [
        makeBareExpr("flags[0] = false", 120),
        makeBareExpr("flags[j] = false", 140),
      ],
      spanStart: 105,
    });
    const fileAST = makeWorkerFileAST("/test/worker.scrml", "primes", [sieveFn]);
    const { routeMap } = runRIClean([fileAST]);

    const route = routeMap.functions.get("/test/worker.scrml::105");
    expect(route).toBeDefined();
    expect(route.boundary).toBe("client");
  });

  test("top-level function and worker function in same file: worker silent, top-level warns", () => {
    // A file with both a top-level function and a worker function using computed access.
    // The top-level function should produce E-ROUTE-001; the worker function should not.
    const workerFn = makeFunctionDecl({
      name: "sieve",
      body: [makeBareExpr("flags[i] = false", 120)],
      spanStart: 105,
    });
    const topFn = makeFunctionDecl({
      name: "lookup",
      body: [makeBareExpr("return table[key]", 200)],
      spanStart: 195,
    });
    const fileAST = makeWorkerFileAST("/test/mixed.scrml", "compute", [workerFn], [topFn]);
    const { errors } = runRIClean([fileAST]);

    const route001 = errors.filter(e => e.code === "E-ROUTE-001");
    // Only the top-level function's computed access should produce E-ROUTE-001.
    expect(route001).toHaveLength(1);
    expect(route001[0].severity).toBe("warning");
  });
});


// ---------------------------------------------------------------------------
// §26 — Insight 26 D1: SERVER_ONLY_SCRML_MODULES set completion (2026-05-08)
//
// Adds 5 stdlib module names to the server-only set, so that callees imported
// from these modules are recognized as server-side calls (used by CPS).
//
// New entries: scrml:redis, scrml:fs, scrml:process, scrml:cron, scrml:oauth.
// Each was verified server-only by stdlib/<name>/index.scrml header.
// ---------------------------------------------------------------------------

describe("§26 D1 — Insight 26: server-only stdlib modules (redis/fs/process/cron/oauth)", () => {
  test("scrml:redis import: callee triggers CPS server-side classification", () => {
    // Pattern adapted from §21 BUG-R15-003 tests.
    const fn = makeFunctionDecl({
      name: "cacheUser",
      isServer: true,
      body: [
        makeLetDecl("v", "get(key)", 20),
        makeReactiveDecl("users", "[...@users, v]", 30),
      ],
      spanStart: 10,
    });
    const imp = makeImportDecl(["get"], "scrml:redis");
    const fileAST = makeFileASTWithImports("/test/redis.scrml", [fn], [imp]);
    const { routeMap, errors } = runRIClean([fileAST]);

    const riErrors = errors.filter(e => e.code === "E-RI-002");
    expect(riErrors).toHaveLength(0);

    const route = getRoute(routeMap, "/test/redis.scrml", 10);
    expect(route.boundary).toBe("server");
    // CPS split: get(key) on server (index 0); reactive on client (index 1).
    expect(route.cpsSplit).not.toBeNull();
    expect(route.cpsSplit.serverStmtIndices).toContain(0);
    expect(route.cpsSplit.clientStmtIndices).toContain(1);
  });

  test("scrml:fs import: readFileSync recognized as server-side", () => {
    const fn = makeFunctionDecl({
      name: "loadConfig",
      isServer: true,
      body: [
        makeLetDecl("c", "readFileSync(path)", 20),
        makeReactiveDecl("cfg", "JSON.parse(c)", 30),
      ],
      spanStart: 10,
    });
    const imp = makeImportDecl(["readFileSync"], "scrml:fs");
    const fileAST = makeFileASTWithImports("/test/fs.scrml", [fn], [imp]);
    const { routeMap, errors } = runRIClean([fileAST]);

    const riErrors = errors.filter(e => e.code === "E-RI-002");
    expect(riErrors).toHaveLength(0);

    const route = getRoute(routeMap, "/test/fs.scrml", 10);
    expect(route.boundary).toBe("server");
    expect(route.cpsSplit).not.toBeNull();
    expect(route.cpsSplit.serverStmtIndices).toContain(0);
  });

  test("scrml:process import: cwd recognized as server-side", () => {
    const fn = makeFunctionDecl({
      name: "showCwd",
      isServer: true,
      body: [
        makeLetDecl("d", "cwd()", 20),
        makeReactiveDecl("dir", "d", 30),
      ],
      spanStart: 10,
    });
    const imp = makeImportDecl(["cwd"], "scrml:process");
    const fileAST = makeFileASTWithImports("/test/proc.scrml", [fn], [imp]);
    const { routeMap, errors } = runRIClean([fileAST]);

    const riErrors = errors.filter(e => e.code === "E-RI-002");
    expect(riErrors).toHaveLength(0);

    const route = getRoute(routeMap, "/test/proc.scrml", 10);
    expect(route.boundary).toBe("server");
    expect(route.cpsSplit).not.toBeNull();
    expect(route.cpsSplit.serverStmtIndices).toContain(0);
  });

  test("scrml:cron import: schedule recognized as server-side", () => {
    const fn = makeFunctionDecl({
      name: "startJobs",
      isServer: true,
      body: [
        makeLetDecl("j", 'schedule("0 * * * *", handler)', 20),
        makeReactiveDecl("started", "true", 30),
      ],
      spanStart: 10,
    });
    const imp = makeImportDecl(["schedule"], "scrml:cron");
    const fileAST = makeFileASTWithImports("/test/cron.scrml", [fn], [imp]);
    const { routeMap, errors } = runRIClean([fileAST]);

    const riErrors = errors.filter(e => e.code === "E-RI-002");
    expect(riErrors).toHaveLength(0);

    const route = getRoute(routeMap, "/test/cron.scrml", 10);
    expect(route.boundary).toBe("server");
    expect(route.cpsSplit).not.toBeNull();
    expect(route.cpsSplit.serverStmtIndices).toContain(0);
  });

  test("scrml:oauth import: startFlow recognized as server-side", () => {
    const fn = makeFunctionDecl({
      name: "signin",
      isServer: true,
      body: [
        makeLetDecl("u", "startFlow(cfg, sessionId)", 20),
        makeReactiveDecl("redirectUrl", "u", 30),
      ],
      spanStart: 10,
    });
    const imp = makeImportDecl(["startFlow"], "scrml:oauth");
    const fileAST = makeFileASTWithImports("/test/oauth.scrml", [fn], [imp]);
    const { routeMap, errors } = runRIClean([fileAST]);

    const riErrors = errors.filter(e => e.code === "E-RI-002");
    expect(riErrors).toHaveLength(0);

    const route = getRoute(routeMap, "/test/oauth.scrml", 10);
    expect(route.boundary).toBe("server");
    expect(route.cpsSplit).not.toBeNull();
    expect(route.cpsSplit.serverStmtIndices).toContain(0);
  });

  test("non-server-only module (scrml:format): callee NOT escalated", () => {
    // Sanity check: a module NOT in the set does not auto-escalate.
    const fn = makeFunctionDecl({
      name: "fmt",
      body: [
        makeLetDecl("s", "humanize(n)", 20),
      ],
      spanStart: 10,
    });
    const imp = makeImportDecl(["humanize"], "scrml:format");
    const fileAST = makeFileASTWithImports("/test/fmt.scrml", [fn], [imp]);
    const { routeMap } = runRIClean([fileAST]);

    const route = getRoute(routeMap, "/test/fmt.scrml", 10);
    expect(route.boundary).toBe("client");
  });
});


// ---------------------------------------------------------------------------
// §27 — Insight 26 D2: SERVER_ONLY_PATTERNS regex completion + bun-runtime
// import recognition (2026-05-08).
//
// D2a: complete process.* pattern set (cwd, argv, platform, exit, uptime,
//      memoryUsage) and Bun.cron.
// D2c: recognize `import { ... } from "bun"`, `from "bun:*"`, `from "node:*"`
//      as server-only-import signal.
// ---------------------------------------------------------------------------

describe("§27 D2 — Insight 26: process.* / Bun.cron patterns + bun runtime imports", () => {
  // Each new D2a pattern as a bare-expr resource trigger.
  const D2_PATTERNS = [
    { expr: "return process.cwd()",                     resourceType: "process.cwd" },
    { expr: "return process.argv[0]",                   resourceType: "process.argv" },
    { expr: "return process.platform === 'linux'",      resourceType: "process.platform" },
    { expr: "process.exit(1)",                          resourceType: "process.exit" },
    { expr: "return process.uptime()",                  resourceType: "process.uptime" },
    { expr: "return process.memoryUsage().heapUsed",    resourceType: "process.memoryUsage" },
    { expr: "Bun.cron('0 * * * *', handler)",           resourceType: "Bun.cron" },
  ];

  D2_PATTERNS.forEach(({ expr, resourceType }) => {
    test(`bare-expr \`${expr.slice(0, 40)}...\` escalates to 'server' (resourceType: ${resourceType})`, () => {
      const fn = makeFunctionDecl({
        name: "f",
        body: [makeBareExpr(expr)],
        spanStart: 10,
      });
      const fileAST = makeFileAST("/test/p.scrml", [fn]);
      const { routeMap } = runRIClean([fileAST]);

      const route = getRoute(routeMap, "/test/p.scrml", 10);
      expect(route.boundary).toBe("server");
      const reasons = route.escalationReasons.map(r => r.resourceType).filter(Boolean);
      expect(reasons).toContain(resourceType);
    });
  });

  test("D2c: import { redis } from 'bun' — redis() callee recognized server-only", () => {
    // The exact pattern stdlib/redis/index.scrml uses.
    const fn = makeFunctionDecl({
      name: "cacheUser",
      isServer: true,
      body: [
        makeLetDecl("v", "redis.get(key)", 20),
        makeReactiveDecl("users", "[...@users, v]", 30),
      ],
      spanStart: 10,
    });
    const imp = makeImportDecl(["redis", "RedisClient"], "bun");
    const fileAST = makeFileASTWithImports("/test/r.scrml", [fn], [imp]);
    const { routeMap, errors } = runRIClean([fileAST]);

    const riErrors = errors.filter(e => e.code === "E-RI-002");
    expect(riErrors).toHaveLength(0);

    const route = getRoute(routeMap, "/test/r.scrml", 10);
    expect(route.boundary).toBe("server");
    expect(route.cpsSplit).not.toBeNull();
  });

  test("D2c: import { Database } from 'bun:sqlite' — Database recognized server-only", () => {
    const fn = makeFunctionDecl({
      name: "openDb",
      isServer: true,
      body: [
        makeLetDecl("d", "Database(path)", 20),
        makeReactiveDecl("ready", "true", 30),
      ],
      spanStart: 10,
    });
    const imp = makeImportDecl(["Database"], "bun:sqlite");
    const fileAST = makeFileASTWithImports("/test/db.scrml", [fn], [imp]);
    const { routeMap, errors } = runRIClean([fileAST]);

    const riErrors = errors.filter(e => e.code === "E-RI-002");
    expect(riErrors).toHaveLength(0);

    const route = getRoute(routeMap, "/test/db.scrml", 10);
    expect(route.boundary).toBe("server");
    expect(route.cpsSplit).not.toBeNull();
  });

  test("D2c: import { readFileSync } from 'node:fs' — readFileSync recognized server-only", () => {
    const fn = makeFunctionDecl({
      name: "loadCfg",
      isServer: true,
      body: [
        makeLetDecl("c", "readFileSync(path)", 20),
        makeReactiveDecl("cfg", "JSON.parse(c)", 30),
      ],
      spanStart: 10,
    });
    const imp = makeImportDecl(["readFileSync"], "node:fs");
    const fileAST = makeFileASTWithImports("/test/nfs.scrml", [fn], [imp]);
    const { routeMap, errors } = runRIClean([fileAST]);

    const riErrors = errors.filter(e => e.code === "E-RI-002");
    expect(riErrors).toHaveLength(0);

    const route = getRoute(routeMap, "/test/nfs.scrml", 10);
    expect(route.boundary).toBe("server");
    expect(route.cpsSplit).not.toBeNull();
  });

  test("D2c: import from non-bun module (e.g. 'react') — NOT recognized server-only", () => {
    const fn = makeFunctionDecl({
      name: "f",
      body: [makeLetDecl("x", "useState(0)", 20)],
      spanStart: 10,
    });
    const imp = makeImportDecl(["useState"], "react");
    const fileAST = makeFileASTWithImports("/test/r.scrml", [fn], [imp]);
    const { routeMap } = runRIClean([fileAST]);

    const route = getRoute(routeMap, "/test/r.scrml", 10);
    expect(route.boundary).toBe("client");
  });
});


// ---------------------------------------------------------------------------
// §28 — Insight 26 D3: caller-context propagation (2026-05-08).
//
// A function with no direct triggers, called ONLY from server-classified
// callers (with NO client-context callers), escalates to server. This
// closes the "vacuum" gap: a helper function called only from server
// helpers gets correctly classified server even without an explicit
// annotation or body trigger.
// ---------------------------------------------------------------------------

describe("§28 D3 — Insight 26: caller-context propagation", () => {
  test("helper called only from server-annotated caller escalates to server", () => {
    // helper() has no body triggers; caller() is server-annotated.
    // D3 propagates: helper() promotes to server via caller-context.
    const helperFn = makeFunctionDecl({
      name: "helper",
      body: [makeBareExpr("return x + 1")],
      spanStart: 10,
    });
    const callerFn = makeFunctionDecl({
      name: "caller",
      isServer: true,
      body: [makeBareExpr("return helper(42)")],
      spanStart: 50,
    });
    const fileAST = makeFileAST("/test/d3.scrml", [helperFn, callerFn]);
    const { routeMap } = runRIClean([fileAST]);

    const helperRoute = getRoute(routeMap, "/test/d3.scrml", 10);
    expect(helperRoute.boundary).toBe("server");
    const reasons = helperRoute.escalationReasons.map(r => r.resourceType).filter(Boolean);
    expect(reasons).toContain("caller-context-propagation");
  });

  test("helper called from server-trigger caller (?{} SQL) escalates", () => {
    // caller() has Trigger 1 (SQL) — already server.
    // helper() called only from caller — D3 propagates.
    const helperFn = makeFunctionDecl({
      name: "format",
      body: [makeBareExpr("return JSON.stringify(o)")],
      spanStart: 10,
    });
    const callerFn = makeFunctionDecl({
      name: "fetchAndFormat",
      body: [
        makeLetDecl("u", "?{`SELECT * FROM users`}.all()", 60),
        makeBareExpr("return format(u)", 80),
      ],
      spanStart: 50,
    });
    const fileAST = makeFileAST("/test/d3b.scrml", [helperFn, callerFn]);
    const { routeMap } = runRIClean([fileAST]);

    const helperRoute = getRoute(routeMap, "/test/d3b.scrml", 10);
    expect(helperRoute.boundary).toBe("server");
  });

  test("helper called from BOTH server and client callers stays client (ambient)", () => {
    // shared() called by both serverFn (server-annotated) and clientFn (no triggers).
    // Mixed-context call graph — D3 does NOT promote. Caller stays AMBIENT (client).
    const sharedFn = makeFunctionDecl({
      name: "shared",
      body: [makeBareExpr("return x.toUpperCase()")],
      spanStart: 10,
    });
    const serverFn = makeFunctionDecl({
      name: "serverFn",
      isServer: true,
      body: [makeBareExpr("return shared(s)")],
      spanStart: 50,
    });
    const clientFn = makeFunctionDecl({
      name: "clientFn",
      body: [makeBareExpr("return shared(s)")],
      spanStart: 100,
    });
    const fileAST = makeFileAST("/test/d3c.scrml", [sharedFn, serverFn, clientFn]);
    const { routeMap } = runRIClean([fileAST]);

    const sharedRoute = getRoute(routeMap, "/test/d3c.scrml", 10);
    expect(sharedRoute.boundary).toBe("client");
  });

  test("helper called only from client callers stays client", () => {
    // client-only call graph — D3 does NOT promote.
    const helperFn = makeFunctionDecl({
      name: "helper",
      body: [makeBareExpr("return x")],
      spanStart: 10,
    });
    const callerFn = makeFunctionDecl({
      name: "caller",
      body: [makeBareExpr("return helper(0)")],
      spanStart: 50,
    });
    const fileAST = makeFileAST("/test/d3d.scrml", [helperFn, callerFn]);
    const { routeMap } = runRIClean([fileAST]);

    const helperRoute = getRoute(routeMap, "/test/d3d.scrml", 10);
    expect(helperRoute.boundary).toBe("client");
  });

  test("helper with no callers stays client (D3 needs propagation evidence)", () => {
    // helper() exists but is never called. D3 has no caller info to propagate.
    // (D4 dead-code-warn is the diagnostic for this case; D3 stays silent.)
    const helperFn = makeFunctionDecl({
      name: "helper",
      body: [makeBareExpr("return x")],
      spanStart: 10,
    });
    const fileAST = makeFileAST("/test/d3e.scrml", [helperFn]);
    const { routeMap } = runRIClean([fileAST]);

    const helperRoute = getRoute(routeMap, "/test/d3e.scrml", 10);
    expect(helperRoute.boundary).toBe("client");
  });

  test("multi-hop server→server→helper chain — propagation reaches all hops (fixed point)", () => {
    // a (server) → b (no triggers) → c (no triggers).
    // D3 fixed-point: b escalates first (caller a is server), then c escalates
    // (caller b is now server).
    const fnA = makeFunctionDecl({
      name: "a",
      isServer: true,
      body: [makeBareExpr("return b(x)")],
      spanStart: 10,
    });
    const fnB = makeFunctionDecl({
      name: "b",
      body: [makeBareExpr("return c(x)")],
      spanStart: 50,
    });
    const fnC = makeFunctionDecl({
      name: "c",
      body: [makeBareExpr("return x * 2")],
      spanStart: 90,
    });
    const fileAST = makeFileAST("/test/d3f.scrml", [fnA, fnB, fnC]);
    const { routeMap } = runRIClean([fileAST]);

    expect(getRoute(routeMap, "/test/d3f.scrml", 10).boundary).toBe("server");
    expect(getRoute(routeMap, "/test/d3f.scrml", 50).boundary).toBe("server");
    expect(getRoute(routeMap, "/test/d3f.scrml", 90).boundary).toBe("server");
  });

  test("self-recursive function with server caller still escalates", () => {
    // a (server) → b (recurses). b's only NON-SELF caller is a (server).
    // D3 ignores the self-cycle and propagates from a.
    const fnA = makeFunctionDecl({
      name: "a",
      isServer: true,
      body: [makeBareExpr("return b(x)")],
      spanStart: 10,
    });
    const fnB = makeFunctionDecl({
      name: "b",
      body: [makeBareExpr("return n <= 1 ? n : b(n - 1)")],
      spanStart: 50,
    });
    const fileAST = makeFileAST("/test/d3g.scrml", [fnA, fnB]);
    const { routeMap } = runRIClean([fileAST]);

    expect(getRoute(routeMap, "/test/d3g.scrml", 50).boundary).toBe("server");
  });

  test("two-function cycle with no external server caller stays client", () => {
    // a → b → a, no body triggers, no external callers.
    // Both functions have only cycle-mate (themselves through cycle) as caller.
    // D3's self-skip means each sees zero non-self callers — no propagation.
    const fnA = makeFunctionDecl({
      name: "a",
      body: [makeBareExpr("return b()")],
      spanStart: 10,
    });
    const fnB = makeFunctionDecl({
      name: "b",
      body: [makeBareExpr("return a()")],
      spanStart: 50,
    });
    const fileAST = makeFileAST("/test/d3h.scrml", [fnA, fnB]);
    const { routeMap } = runRIClean([fileAST]);

    // Both stay client — neither has direct trigger nor server caller.
    expect(getRoute(routeMap, "/test/d3h.scrml", 10).boundary).toBe("client");
    expect(getRoute(routeMap, "/test/d3h.scrml", 50).boundary).toBe("client");
  });

  test("two-function cycle WITH external server caller — conservative: cycle stays client (Batch 1 limit)", () => {
    // entry (server) → a → b → a (cycle).
    //
    // Ideal/aspirational: a and b should both escalate via server-reachability.
    // Batch 1 conservative behavior: D3's monotonic single-pass algorithm
    // doesn't escalate in this configuration — a's callers are {entry, b};
    // since b is unresolved (client) at iteration 1, the "ALL non-self
    // callers are server" check fails for a. b's only caller is a, also
    // unresolved → no propagation.
    //
    // This is an accepted limitation per the dispatch ("Cycles in the
    // call graph: handle conservatively"). A future enhancement could use
    // Tarjan SCC + topological propagation to handle server-seeded cycles;
    // queued for post-Batch-2 follow-up if real adopter code surfaces this
    // shape.
    const entry = makeFunctionDecl({
      name: "entry",
      isServer: true,
      body: [makeBareExpr("return a(0)")],
      spanStart: 10,
    });
    const fnA = makeFunctionDecl({
      name: "a",
      body: [makeBareExpr("return b(x)")],
      spanStart: 50,
    });
    const fnB = makeFunctionDecl({
      name: "b",
      body: [makeBareExpr("return a(x - 1)")],
      spanStart: 90,
    });
    const fileAST = makeFileAST("/test/d3i.scrml", [entry, fnA, fnB]);
    const { routeMap } = runRIClean([fileAST]);

    expect(getRoute(routeMap, "/test/d3i.scrml", 10).boundary).toBe("server");
    // Batch 1 conservative: cycle stays client (no SCC analysis).
    expect(getRoute(routeMap, "/test/d3i.scrml", 50).boundary).toBe("client");
    expect(getRoute(routeMap, "/test/d3i.scrml", 90).boundary).toBe("client");
  });
});


// ---------------------------------------------------------------------------
// §29 — Insight 26 D4: W-DEAD-FUNCTION diagnostic (2026-05-08).
//
// Fires for a function with NO callers (anywhere in the project) AND NOT
// exported AND NOT explicitly server-annotated AND not referenced from
// markup. Conservative: false-negatives are acceptable; false-positives
// are not (would burn the warning on legitimate code).
// ---------------------------------------------------------------------------

describe("§29 D4 — Insight 26: W-DEAD-FUNCTION diagnostic", () => {
  function makeFileASTWithExports(filePath, fnNodes, exports) {
    return {
      filePath,
      nodes: [{ id: 1, kind: "logic", body: fnNodes, span: span(0, filePath) }],
      imports: [],
      exports,
      components: [],
      typeDecls: [],
      spans: new Map(),
    };
  }

  test("uncalled, unexported, non-server function fires W-DEAD-FUNCTION", () => {
    const fn = makeFunctionDecl({
      name: "deadHelper",
      body: [makeBareExpr("return 42")],
      spanStart: 10,
    });
    const fileAST = makeFileAST("/test/d4.scrml", [fn]);
    const { errors } = runRIClean([fileAST]);

    const dead = errors.filter(e => e.code === "W-DEAD-FUNCTION");
    expect(dead).toHaveLength(1);
    expect(dead[0].severity).toBe("warning");
    expect(dead[0].message).toContain("deadHelper");
  });

  test("called function does NOT fire W-DEAD-FUNCTION", () => {
    const helperFn = makeFunctionDecl({
      name: "helper",
      body: [makeBareExpr("return 1")],
      spanStart: 10,
    });
    const callerFn = makeFunctionDecl({
      name: "caller",
      body: [makeBareExpr("return helper()")],
      spanStart: 50,
    });
    const fileAST = makeFileAST("/test/d4b.scrml", [helperFn, callerFn]);
    const { errors } = runRIClean([fileAST]);

    const helperDead = errors.filter(e => e.code === "W-DEAD-FUNCTION" && e.message.includes("helper"));
    expect(helperDead).toHaveLength(0);
  });

  test("exported function does NOT fire W-DEAD-FUNCTION (potentially called from another file)", () => {
    const fn = makeFunctionDecl({
      name: "publicApi",
      body: [makeBareExpr("return 1")],
      spanStart: 10,
    });
    const exportDecl = {
      id: 5,
      kind: "export-decl",
      raw: "export function publicApi",
      exportedName: "publicApi",
      exportKind: "function",
      span: span(5),
    };
    const fileAST = makeFileASTWithExports("/test/d4c.scrml", [fn], [exportDecl]);
    const { errors } = runRIClean([fileAST]);

    const dead = errors.filter(e => e.code === "W-DEAD-FUNCTION");
    expect(dead).toHaveLength(0);
  });

  test("explicitly-server-annotated function does NOT fire W-DEAD-FUNCTION", () => {
    // server function = potential route handler / explicit dev intent.
    const fn = makeFunctionDecl({
      name: "manualRoute",
      isServer: true,
      body: [makeBareExpr("return 1")],
      spanStart: 10,
    });
    const fileAST = makeFileAST("/test/d4d.scrml", [fn]);
    const { errors } = runRIClean([fileAST]);

    const dead = errors.filter(e => e.code === "W-DEAD-FUNCTION");
    expect(dead).toHaveLength(0);
  });

  test("function referenced from markup attribute (e.g. onclick=fn()) does NOT fire", () => {
    // Real-app pattern: <button onclick=handleClick()>.
    // RI's body-callee analysis doesn't track markup refs precisely, but the
    // markup-text-search heuristic (Step 5d) checks identifiers in attr values.
    const fn = makeFunctionDecl({
      name: "handleClick",
      body: [makeBareExpr("@count = @count + 1")],
      spanStart: 10,
    });
    // Construct a FileAST with a markup root that references handleClick.
    const fileAST = {
      filePath: "/test/d4e.scrml",
      nodes: [
        {
          id: 90,
          kind: "markup",
          tag: "program",
          attrs: [],
          children: [
            {
              id: 91,
              kind: "markup",
              tag: "button",
              attrs: [{ name: "onclick", value: "handleClick()" }],
              children: [],
              selfClosing: false,
              closerForm: "</>",
              isComponent: false,
              span: span(91, "/test/d4e.scrml"),
            },
          ],
          selfClosing: false,
          closerForm: "</>",
          isComponent: false,
          span: span(90, "/test/d4e.scrml"),
        },
        { id: 1, kind: "logic", body: [fn], span: span(0, "/test/d4e.scrml") },
      ],
      imports: [],
      exports: [],
      components: [],
      typeDecls: [],
      spans: new Map(),
    };
    const { errors } = runRIClean([fileAST]);

    const dead = errors.filter(e => e.code === "W-DEAD-FUNCTION");
    expect(dead).toHaveLength(0);
  });

  test("generator function (SSE) does NOT fire W-DEAD-FUNCTION", () => {
    // Generator (SSE) functions are entry points; never dead-warn.
    const fn = {
      ...makeFunctionDecl({
        name: "stream",
        isServer: true,
        body: [makeBareExpr("yield 1")],
        spanStart: 10,
      }),
      isGenerator: true,
    };
    const fileAST = makeFileAST("/test/d4f.scrml", [fn]);
    const { errors } = runRIClean([fileAST]);

    const dead = errors.filter(e => e.code === "W-DEAD-FUNCTION");
    expect(dead).toHaveLength(0);
  });

  test("self-referential-only function (recurses, no other callers) STILL fires dead-warn", () => {
    // A function that only calls itself is still dead. The self-skip logic in
    // D4 ensures cycle-self-ref doesn't count as a "real" caller.
    const fn = makeFunctionDecl({
      name: "looper",
      body: [makeBareExpr("return looper()")],
      spanStart: 10,
    });
    const fileAST = makeFileAST("/test/d4g.scrml", [fn]);
    const { errors } = runRIClean([fileAST]);

    const dead = errors.filter(e => e.code === "W-DEAD-FUNCTION");
    expect(dead).toHaveLength(1);
  });
});


// ---------------------------------------------------------------------------
// §30 — Insight 26 D5: W-DEPRECATED-SERVER-MODIFIER (2026-05-08).
//
// Fires when a function has the `server` modifier AND the body has any
// other escalation trigger (T1/T2/T3) or caller-context propagation
// classifies it as server. The keyword is redundant in those cases.
//
// Does NOT fire when the keyword is the SOLE escalation signal.
// ---------------------------------------------------------------------------

describe("§30 D5 — Insight 26: W-DEPRECATED-SERVER-MODIFIER", () => {
  test("server function with body server-only resource (Bun.file) — fires deprecation warning", () => {
    const fn = makeFunctionDecl({
      name: "loadCfg",
      isServer: true,
      body: [makeBareExpr("return Bun.file('/etc/c').text()")],
      spanStart: 10,
    });
    const fileAST = makeFileAST("/test/d5.scrml", [fn]);
    const exp = {
      id: 5,
      kind: "export-decl",
      raw: "export function loadCfg",
      exportedName: "loadCfg",
      exportKind: "function",
      span: span(5),
    };
    // Add export to silence the dead-warn for this test.
    fileAST.exports = [exp];
    const { errors } = runRIClean([fileAST]);

    const deprec = errors.filter(e => e.code === "W-DEPRECATED-SERVER-MODIFIER");
    expect(deprec).toHaveLength(1);
    expect(deprec[0].severity).toBe("warning");
    expect(deprec[0].message).toContain("loadCfg");
    expect(deprec[0].message).toContain("Bun.file");
  });

  test("server function with body SQL trigger — fires deprecation", () => {
    const fn = makeFunctionDecl({
      name: "fetchRows",
      isServer: true,
      body: [makeLetDecl("u", "?{`SELECT * FROM users`}.all()", 20)],
      spanStart: 10,
    });
    const fileAST = makeFileAST("/test/d5b.scrml", [fn]);
    fileAST.exports = [{
      id: 5, kind: "export-decl", raw: "", exportedName: "fetchRows", exportKind: "function", span: span(5),
    }];
    const { errors } = runRIClean([fileAST]);

    const deprec = errors.filter(e => e.code === "W-DEPRECATED-SERVER-MODIFIER");
    expect(deprec).toHaveLength(1);
    expect(deprec[0].message).toContain("sql-query");
  });

  test("server function with caller-context propagation — fires deprecation", () => {
    // Helper has NO body trigger but is called from a server-annotated caller.
    // It would be promoted via D3 caller-context propagation. If it ALSO has
    // the `server` modifier, the modifier is redundant — fire deprecation.
    const helperFn = makeFunctionDecl({
      name: "helper",
      isServer: true, // explicit + caller-context = redundant
      body: [makeBareExpr("return x + 1")],
      spanStart: 10,
    });
    const callerFn = makeFunctionDecl({
      name: "caller",
      isServer: true,
      body: [
        makeLetDecl("y", "?{`SELECT 1`}.get()", 60),
        makeBareExpr("return helper(y)", 80),
      ],
      spanStart: 50,
    });
    const fileAST = makeFileAST("/test/d5c.scrml", [helperFn, callerFn]);
    // Export so dead-warn doesn't fire.
    fileAST.exports = [
      { id: 5, kind: "export-decl", raw: "", exportedName: "helper", exportKind: "function", span: span(5) },
      { id: 6, kind: "export-decl", raw: "", exportedName: "caller", exportKind: "function", span: span(6) },
    ];
    const { errors } = runRIClean([fileAST]);

    // helper: explicit + caller-context propagation → redundant → fires.
    const helperDeprec = errors.filter(
      e => e.code === "W-DEPRECATED-SERVER-MODIFIER" && e.message.includes("`helper`"),
    );
    expect(helperDeprec).toHaveLength(1);
    expect(helperDeprec[0].message).toContain("caller-context-propagation");

    // caller: explicit + body SQL → redundant → fires.
    const callerDeprec = errors.filter(
      e => e.code === "W-DEPRECATED-SERVER-MODIFIER" && e.message.includes("`caller`"),
    );
    expect(callerDeprec).toHaveLength(1);
  });

  test("server function with NO other trigger — does NOT fire deprecation (keyword is sole signal)", () => {
    // The "empty body server intent" case. Insight 26 acknowledges this is
    // rare but not zero. Until the function gets a body trigger or is wired
    // up to server callers, the modifier remains the sole escalation signal
    // and is NOT deprecated.
    const fn = makeFunctionDecl({
      name: "soleSignal",
      isServer: true,
      body: [makeBareExpr("return 'hello'")],
      spanStart: 10,
    });
    const fileAST = makeFileAST("/test/d5d.scrml", [fn]);
    fileAST.exports = [{
      id: 5, kind: "export-decl", raw: "", exportedName: "soleSignal", exportKind: "function", span: span(5),
    }];
    const { errors } = runRIClean([fileAST]);

    const deprec = errors.filter(e => e.code === "W-DEPRECATED-SERVER-MODIFIER");
    expect(deprec).toHaveLength(0);
  });

  test("client function (no server modifier) — does NOT fire deprecation", () => {
    const fn = makeFunctionDecl({
      name: "client",
      body: [makeBareExpr("return 1")],
      spanStart: 10,
    });
    const fileAST = makeFileAST("/test/d5e.scrml", [fn]);
    fileAST.exports = [{
      id: 5, kind: "export-decl", raw: "", exportedName: "client", exportKind: "function", span: span(5),
    }];
    const { errors } = runRIClean([fileAST]);

    const deprec = errors.filter(e => e.code === "W-DEPRECATED-SERVER-MODIFIER");
    expect(deprec).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §31 — Bug 4 (S87 Trio A) regression: walkMarkupContext must collect
// identifiers from string-typed expression fields on AST nodes nested INSIDE
// markup-context logic blocks. Without the string-fallback, functions called
// from `if (fn() > 0)` / `for (let x of fn())` / `while (fn())` etc. inside
// markup-level `${ ... }` blocks falsely trip W-DEAD-FUNCTION.
//
// TodoMVC fixture surfaced shape: `${ if (completedCount() > 0) { lift ... } }`
// in footer markup. `completedCount` was flagged W-DEAD-FUNCTION even though
// it IS called from the if-stmt condition string.
//
// Fix lives in `src/route-inference.ts` walkMarkupContext: scans
// `expr|init|condition|value|test|header|iterable` STRING fields and
// `condExpr|valueExpr|exprNode|testExpr|headerExpr` ExprNode siblings.
// ---------------------------------------------------------------------------

describe("§31 — Bug 4 / S87 Trio A: markup-context call detection through nested-stmt expr fields", () => {
  /**
   * Wrap a logic-stmt node (if-stmt / for-stmt / etc.) inside a markup-level
   * logic block, itself nested inside a markup tree. Mirrors the AST shape
   * produced by `${ if (...) { ... } }` inside markup.
   */
  function makeFileASTWithMarkupLogic(filePath, fnNodes, markupLogicStmt) {
    const innerLogic = {
      id: 200,
      kind: "logic",
      body: [markupLogicStmt],
      span: span(200, filePath),
    };
    const markupRoot = {
      id: 100,
      kind: "markup",
      tag: "footer",
      attrs: [],
      children: [innerLogic],
      selfClosing: false,
      closerForm: "</>",
      isComponent: false,
      span: span(100, filePath),
    };
    const topLogic = {
      id: 1,
      kind: "logic",
      body: fnNodes,
      span: span(0, filePath),
    };
    return {
      filePath,
      nodes: [markupRoot, topLogic],
      imports: [],
      exports: [],
      components: [],
      typeDecls: [],
      spans: new Map(),
    };
  }

  test("function called from if-stmt.condition inside markup logic block — does NOT fire W-DEAD-FUNCTION", () => {
    // Mirrors TodoMVC `${ if (completedCount() > 0) { lift <button .../> } }`.
    const fn = makeFunctionDecl({
      name: "completedCount",
      body: [makeBareExpr("return 0")],
      spanStart: 10,
    });
    const ifStmt = {
      id: 220,
      kind: "if-stmt",
      condition: "( completedCount ( ) > 0 )",
      consequent: [],
      alternate: null,
      span: span(220, "/test/markup-if.scrml"),
    };
    const fileAST = makeFileASTWithMarkupLogic("/test/markup-if.scrml", [fn], ifStmt);
    const { errors } = runRIClean([fileAST]);

    const dead = errors.filter(e => e.code === "W-DEAD-FUNCTION" && e.message.includes("completedCount"));
    expect(dead).toHaveLength(0);
  });

  test("function called from for-stmt.header inside markup logic block — does NOT fire W-DEAD-FUNCTION", () => {
    // Shape: `${ for (let item of getItems()) { lift ... } }`.
    const fn = makeFunctionDecl({
      name: "getItems",
      body: [makeBareExpr("return []")],
      spanStart: 10,
    });
    const forStmt = {
      id: 230,
      kind: "for-stmt",
      header: "let item of getItems ( )",
      body: [],
      span: span(230, "/test/markup-for.scrml"),
    };
    const fileAST = makeFileASTWithMarkupLogic("/test/markup-for.scrml", [fn], forStmt);
    const { errors } = runRIClean([fileAST]);

    const dead = errors.filter(e => e.code === "W-DEAD-FUNCTION" && e.message.includes("getItems"));
    expect(dead).toHaveLength(0);
  });

  test("function called from while-stmt.condition inside markup logic block — does NOT fire W-DEAD-FUNCTION", () => {
    const fn = makeFunctionDecl({
      name: "shouldRetry",
      body: [makeBareExpr("return false")],
      spanStart: 10,
    });
    const whileStmt = {
      id: 240,
      kind: "while-stmt",
      condition: "shouldRetry ( )",
      body: [],
      span: span(240, "/test/markup-while.scrml"),
    };
    const fileAST = makeFileASTWithMarkupLogic("/test/markup-while.scrml", [fn], whileStmt);
    const { errors } = runRIClean([fileAST]);

    const dead = errors.filter(e => e.code === "W-DEAD-FUNCTION" && e.message.includes("shouldRetry"));
    expect(dead).toHaveLength(0);
  });

  test("function called from let-decl.init inside markup logic block — does NOT fire W-DEAD-FUNCTION", () => {
    // Shape: `${ let x = computeThing() ; ... }`.
    const fn = makeFunctionDecl({
      name: "computeThing",
      body: [makeBareExpr("return 1")],
      spanStart: 10,
    });
    const letDecl = makeLetDecl("x", "computeThing ( )", 250, "/test/markup-let.scrml");
    const fileAST = makeFileASTWithMarkupLogic("/test/markup-let.scrml", [fn], letDecl);
    const { errors } = runRIClean([fileAST]);

    const dead = errors.filter(e => e.code === "W-DEAD-FUNCTION" && e.message.includes("computeThing"));
    expect(dead).toHaveLength(0);
  });

  test("function called from nested if/for chain inside markup logic — does NOT fire", () => {
    // Shape: `${ if (outerCheck()) { for (let x of innerList()) { ... } } }`.
    const outerFn = makeFunctionDecl({
      name: "outerCheck",
      body: [makeBareExpr("return true")],
      spanStart: 10,
    });
    const innerFn = makeFunctionDecl({
      name: "innerList",
      body: [makeBareExpr("return []")],
      spanStart: 60,
    });
    const innerFor = {
      id: 270,
      kind: "for-stmt",
      header: "let x of innerList ( )",
      body: [],
      span: span(270, "/test/markup-nested.scrml"),
    };
    const outerIf = {
      id: 260,
      kind: "if-stmt",
      condition: "outerCheck ( )",
      consequent: [innerFor],
      alternate: null,
      span: span(260, "/test/markup-nested.scrml"),
    };
    const fileAST = makeFileASTWithMarkupLogic("/test/markup-nested.scrml", [outerFn, innerFn], outerIf);
    const { errors } = runRIClean([fileAST]);

    const dead = errors.filter(e => e.code === "W-DEAD-FUNCTION");
    const deadNames = dead.map(e => e.message).join(" | ");
    expect(dead, "outer + inner both reachable, expected zero dead-warns; got: " + deadNames).toHaveLength(0);
  });

  test("REGRESSION GUARD — truly-dead function inside same file STILL fires W-DEAD-FUNCTION", () => {
    // Sanity: the new walker scan must NOT mask GENUINE dead-warns.
    // `liveFn` is referenced in the markup-level if-stmt condition; `deadFn`
    // is declared but not referenced anywhere.
    const liveFn = makeFunctionDecl({
      name: "liveFn",
      body: [makeBareExpr("return 1")],
      spanStart: 10,
    });
    const deadFn = makeFunctionDecl({
      name: "deadFn",
      body: [makeBareExpr("return 2")],
      spanStart: 60,
    });
    const ifStmt = {
      id: 280,
      kind: "if-stmt",
      condition: "liveFn ( ) > 0",
      consequent: [],
      alternate: null,
      span: span(280, "/test/markup-mixed.scrml"),
    };
    const fileAST = makeFileASTWithMarkupLogic("/test/markup-mixed.scrml", [liveFn, deadFn], ifStmt);
    const { errors } = runRIClean([fileAST]);

    const liveDead = errors.filter(e => e.code === "W-DEAD-FUNCTION" && e.message.includes("liveFn"));
    expect(liveDead, "liveFn is referenced from if-stmt condition; should NOT be dead").toHaveLength(0);

    const deadDead = errors.filter(e => e.code === "W-DEAD-FUNCTION" && e.message.includes("deadFn"));
    expect(deadDead, "deadFn is truly unreferenced; SHOULD still fire dead-warn").toHaveLength(1);
  });

  test("REGRESSION GUARD — function called only inside ANOTHER function body still fires (no markup ref)", () => {
    // `helperX` is called only from `wrapper` body. `wrapper` itself is dead.
    // The body-callee analysis sees helperX -> wrapper edge but neither is
    // markup-referenced, so W-DEAD-FUNCTION SHOULD fire for both via the
    // existing call-graph + non-markup-ref combination.
    //
    // Exception: the call graph DOES count `wrapper -> helperX` as a real
    // caller of `helperX` (via inverseCallerMap), so helperX has callers
    // and only `wrapper` actually fires W-DEAD-FUNCTION.
    const helperFn = makeFunctionDecl({
      name: "helperX",
      body: [makeBareExpr("return 1")],
      spanStart: 10,
    });
    const wrapperFn = makeFunctionDecl({
      name: "wrapper",
      body: [makeBareExpr("return helperX()")],
      spanStart: 60,
    });
    const fileAST = makeFileAST("/test/no-markup.scrml", [helperFn, wrapperFn]);
    const { errors } = runRIClean([fileAST]);

    const wrapperDead = errors.filter(e => e.code === "W-DEAD-FUNCTION" && e.message.includes("wrapper"));
    expect(wrapperDead).toHaveLength(1);
  });
});
