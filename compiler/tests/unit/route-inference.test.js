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
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";

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

  test("E-RI-002 message steers to the canonical server-authoritative patterns (dpa-005, sPA ss1 item 5)", () => {
    const fn = makeFunctionDecl({
      name: "go",
      isServer: true,
      body: [
        makeBareExpr("fetchData()"),
        makeReactiveDecl("phase", "5"),
      ],
      spanStart: 10,
    });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { errors } = runRIClean([fileAST]);

    const msg = errors.filter(e => e.code === "E-RI-002")[0]?.message ?? "";
    // Targeted recipe (replaces the old blunt "move to a client-side callback"):
    // names the <engine server=@source> hydration form (§51.0.E) AND the
    // <channel>/<match> synced-cell form (§38.4).
    expect(msg).toContain("server=@source");
    expect(msg).toContain("§51.0.E");
    expect(msg).toContain("<channel>");
    expect(msg).toContain("§38.4");
    expect(msg).not.toContain("client-side callback");
    // Names the offending cell (cheaply available from the reactive-assignment
    // LHS) so the adopter sees exactly which cell to migrate.
    expect(msg).toContain("reactive cell `@phase`");
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

  // -------------------------------------------------------------------------
  // g-route-001 (sPA ss1 item 1): suppress E-ROUTE-001 for pure-fn LOCAL
  // array writes (COW init, no protected provenance). Receiver-reachability:
  // a computed write on a fresh local array can never reach a protected field.
  // -------------------------------------------------------------------------

  test("g-route-001: computed write on a .slice() local array — no E-ROUTE-001", () => {
    // Mirrors examples/28-flux.scrml bumpLeftVision(): `let result = nonce.slice()`
    // then `result[idx] = result[idx] + 1`. result is a COW local — cannot reach
    // a protected field — so the warning must be suppressed.
    const fn = makeFunctionDecl({
      name: "bumpLocal",
      body: [
        makeLetDecl("result", "nonce.slice()"),
        makeBareExpr("result[idx] = result[idx] + 1"),
      ],
      spanStart: 10,
    });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { errors } = runRIClean([fileAST]);

    const warnings = errors.filter(e => e.code === "E-ROUTE-001");
    expect(warnings).toHaveLength(0);
  });

  test("g-route-001: computed write on an array-literal local — no E-ROUTE-001", () => {
    const fn = makeFunctionDecl({
      name: "buildLocal",
      body: [
        makeLetDecl("r", "[]"),
        makeBareExpr("r[i] = x"),
      ],
      spanStart: 10,
    });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { errors } = runRIClean([fileAST]);

    const warnings = errors.filter(e => e.code === "E-ROUTE-001");
    expect(warnings).toHaveLength(0);
  });

  test("g-route-001: computed write on a .map() local — no E-ROUTE-001", () => {
    const fn = makeFunctionDecl({
      name: "mapLocal",
      body: [
        makeLetDecl("r", "src.map(f)"),
        makeBareExpr("r[i] = r[i] + 1"),
      ],
      spanStart: 10,
    });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { errors } = runRIClean([fileAST]);

    const warnings = errors.filter(e => e.code === "E-ROUTE-001");
    expect(warnings).toHaveLength(0);
  });

  test("g-route-001: local with PROTECTED provenance (`protectedField.slice()`) — still warns", () => {
    // `let r = passwordHash.slice()` carries protected provenance, so a computed
    // write on r could expose a protected field — the warning must NOT be
    // suppressed.
    const pa = makeProtectAnalysis("/test/app.scrml::0", "users", ["passwordHash"]);
    const fn = makeFunctionDecl({
      name: "leakLocal",
      body: [
        makeLetDecl("r", "passwordHash.slice()"),
        makeBareExpr("r[idx] = r[idx] + 1"),
      ],
      spanStart: 10,
    });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { errors } = runRI({ files: [fileAST], protectAnalysis: pa });

    const warnings = errors.filter(e => e.code === "E-ROUTE-001");
    expect(warnings.length).toBeGreaterThanOrEqual(1);
  });

  test("g-route-001: local with member PROTECTED provenance (`row.passwordHash.slice()`) — still warns", () => {
    const pa = makeProtectAnalysis("/test/app.scrml::0", "users", ["passwordHash"]);
    const fn = makeFunctionDecl({
      name: "leakMemberLocal",
      body: [
        makeLetDecl("r", "row.passwordHash.slice()"),
        makeBareExpr("r[idx] = r[idx] + 1"),
      ],
      spanStart: 10,
    });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { errors } = runRI({ files: [fileAST], protectAnalysis: pa });

    const warnings = errors.filter(e => e.code === "E-ROUTE-001");
    expect(warnings.length).toBeGreaterThanOrEqual(1);
  });

  test("g-route-001: param/unknown receiver (`row[fieldKey]`, no local decl) — still warns (regression guard)", () => {
    const fn = makeFunctionDecl({
      name: "getDynField",
      body: [makeBareExpr("return row[fieldKey]")],
      spanStart: 10,
    });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { errors } = runRIClean([fileAST]);

    const warnings = errors.filter(e => e.code === "E-ROUTE-001");
    expect(warnings.length).toBeGreaterThanOrEqual(1);
  });

  test("g-route-001: mixed receivers — local + unknown in same expr — still warns", () => {
    // `r[i] = row[fieldKey]` : r is a known-safe local, but row is unknown — at
    // least one unsafe receiver means the warning must still fire.
    const fn = makeFunctionDecl({
      name: "mixedReceivers",
      body: [
        makeLetDecl("r", "src.slice()"),
        makeBareExpr("r[i] = row[fieldKey]"),
      ],
      spanStart: 10,
    });
    const fileAST = makeFileAST("/test/app.scrml", [fn]);
    const { errors } = runRIClean([fileAST]);

    const warnings = errors.filter(e => e.code === "E-ROUTE-001");
    expect(warnings.length).toBeGreaterThanOrEqual(1);
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
  // escalation-2 (S216): an author `route=` is the request PATH (carried in
  // `explicitRoute`), NOT the JS export binding NAME. `generatedRouteName` is
  // ALWAYS a valid `__ri_route_*` identifier — emitting the path AS the binding
  // name produced invalid JS (`export const /oauth/callback`). This test
  // previously locked that buggy behavior.
  test("server function with route= keeps generatedRouteName a valid identifier; path in explicitRoute", () => {
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
    // The JS binding name is a valid identifier, never the author path.
    expect(route.generatedRouteName).not.toContain("/");
    expect(route.generatedRouteName).toContain("__ri_route_oauthCallback");
    // The author path is preserved on explicitRoute (emit-server mounts it there).
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

  // -------------------------------------------------------------------------
  // D-RI-PAGES — v0.3 canonical pages/ prefix recognition (SPEC §47.9.2,
  // §40.8). The original implementation only recognized routes/ (legacy
  // pre-v0.3 convention); v0.3 codified pages/ as canonical (e.g.
  // an adopter login page at pages/auth/login.scrml).
  // Both prefixes are accepted; routes/ remains for backward compatibility.
  // -------------------------------------------------------------------------

  test("pages/index.scrml maps to /", () => {
    const files = [makeFileAST("/app/src/pages/index.scrml", [])];
    const pages = buildPageRouteTree(files);
    expect(pages.size).toBe(1);
    const page = pages.get("/app/src/pages/index.scrml");
    expect(page).toBeDefined();
    expect(page.urlPattern).toBe("/");
    expect(page.params).toEqual([]);
    expect(page.isCatchAll).toBe(false);
  });

  test("pages/ static file maps to its name as URL segment", () => {
    const files = [makeFileAST("/app/src/pages/about.scrml", [])];
    const pages = buildPageRouteTree(files);
    const page = pages.get("/app/src/pages/about.scrml");
    expect(page.urlPattern).toBe("/about");
    expect(page.params).toEqual([]);
  });

  test("pages/users/[id].scrml maps to dynamic segment :id", () => {
    const files = [makeFileAST("/app/src/pages/users/[id].scrml", [])];
    const pages = buildPageRouteTree(files);
    const page = pages.get("/app/src/pages/users/[id].scrml");
    expect(page.urlPattern).toBe("/users/:id");
    expect(page.params).toEqual(["id"]);
    expect(page.isCatchAll).toBe(false);
  });

  test("pages/auth/login.scrml maps to /auth/login (nested pages/ path)", () => {
    // This is the load-bearing test for Batch A.1 / D-RI-PAGES:
    // an adopter authoring a login page at pages/auth/login.scrml relies
    // on the route-inference pass recognising the nested pages/ path. Adopters who
    // set <program loginRedirect="/auth/login"> will then see the
    // I-AUTH-REDIRECT-UNRESOLVED + W-AUTH-LOGIN-MISSING diagnostics
    // clear on the next compile (Phase 3 integration test below).
    const files = [makeFileAST("/app/src/pages/auth/login.scrml", [])];
    const pages = buildPageRouteTree(files);
    const page = pages.get("/app/src/pages/auth/login.scrml");
    expect(page.urlPattern).toBe("/auth/login");
    expect(page.params).toEqual([]);
    expect(page.isCatchAll).toBe(false);
  });

  test("pages/posts/[...slug].scrml maps to catch-all", () => {
    const files = [makeFileAST("/app/src/pages/posts/[...slug].scrml", [])];
    const pages = buildPageRouteTree(files);
    const page = pages.get("/app/src/pages/posts/[...slug].scrml");
    expect(page.urlPattern).toBe("/posts/*slug");
    expect(page.params).toEqual(["slug"]);
    expect(page.isCatchAll).toBe(true);
  });

  test("pages/users/index.scrml maps to parent directory URL", () => {
    const files = [makeFileAST("/app/src/pages/users/index.scrml", [])];
    const pages = buildPageRouteTree(files);
    const page = pages.get("/app/src/pages/users/index.scrml");
    expect(page.urlPattern).toBe("/users");
  });

  test("pages/_layout.scrml is excluded from page routes", () => {
    const files = [
      makeFileAST("/app/src/pages/_layout.scrml", []),
      makeFileAST("/app/src/pages/index.scrml", []),
    ];
    const pages = buildPageRouteTree(files);
    expect(pages.has("/app/src/pages/_layout.scrml")).toBe(false);
    expect(pages.has("/app/src/pages/index.scrml")).toBe(true);
  });

  test("pages/sub/_layout.scrml binds to pages/sub/index.scrml as layoutFilePath", () => {
    // The nested _layout.scrml file should be recorded on the sibling
    // page's `layoutFilePath`. This exercises findLayoutFile against the
    // new prefix-aware route-root computation.
    const files = [
      makeFileAST("/app/src/pages/sub/_layout.scrml", []),
      makeFileAST("/app/src/pages/sub/index.scrml", []),
    ];
    const pages = buildPageRouteTree(files);
    const page = pages.get("/app/src/pages/sub/index.scrml");
    expect(page).toBeDefined();
    expect(page.layoutFilePath).toBe("/app/src/pages/sub/_layout.scrml");
  });

  test("mixed routes/ + pages/ inputs build a unified tree", () => {
    // Demonstrates backward compatibility: legacy routes/-using fixtures
    // and v0.3 pages/-using fixtures can coexist in the same compilation
    // without collision or surprise URL shifts.
    const files = [
      makeFileAST("/app/src/routes/index.scrml", []),
      makeFileAST("/app/src/routes/about.scrml", []),
      makeFileAST("/app/src/pages/contact.scrml", []),
      makeFileAST("/app/src/pages/users/[id].scrml", []),
    ];
    const pages = buildPageRouteTree(files);
    expect(pages.size).toBe(4);
    expect(pages.get("/app/src/routes/index.scrml").urlPattern).toBe("/");
    expect(pages.get("/app/src/routes/about.scrml").urlPattern).toBe("/about");
    expect(pages.get("/app/src/pages/contact.scrml").urlPattern).toBe("/contact");
    expect(pages.get("/app/src/pages/users/[id].scrml").urlPattern).toBe("/users/:id");
  });

  test("path containing both /routes/ and /pages/ prefers routes/ (lookup-order precedence)", () => {
    // Edge case: a file path that literally contains both segments —
    // e.g. an authored layout like /proj/pages/routes/foo.scrml. The
    // ROUTE_PREFIXES lookup order picks routes/ first, so the file
    // resolves as /foo (relative to the routes/ segment) rather than
    // /routes/foo (relative to the pages/ segment). This is a backward-
    // compatibility tiebreaker — greenfield v0.3 projects use pages/
    // exclusively and never hit this path.
    const files = [makeFileAST("/proj/pages/routes/foo.scrml", [])];
    const pages = buildPageRouteTree(files);
    const page = pages.get("/proj/pages/routes/foo.scrml");
    expect(page.urlPattern).toBe("/foo");
  });

  test("multiple pages/ files build complete route tree", () => {
    const files = [
      makeFileAST("/app/src/pages/index.scrml", []),
      makeFileAST("/app/src/pages/about.scrml", []),
      makeFileAST("/app/src/pages/users/[id].scrml", []),
      makeFileAST("/app/src/pages/users/index.scrml", []),
      makeFileAST("/app/src/pages/auth/login.scrml", []),
    ];
    const pages = buildPageRouteTree(files);
    expect(pages.size).toBe(5);
    expect(pages.get("/app/src/pages/index.scrml").urlPattern).toBe("/");
    expect(pages.get("/app/src/pages/about.scrml").urlPattern).toBe("/about");
    expect(pages.get("/app/src/pages/users/[id].scrml").urlPattern).toBe("/users/:id");
    expect(pages.get("/app/src/pages/users/index.scrml").urlPattern).toBe("/users");
    expect(pages.get("/app/src/pages/auth/login.scrml").urlPattern).toBe("/auth/login");
  });

  test("runRI includes pages in routeMap", () => {
    const files = [makeFileAST("/app/src/routes/index.scrml", [])];
    const { routeMap } = runRI({ files, protectAnalysis: { views: new Map() } });
    expect(routeMap.pages).toBeDefined();
    expect(routeMap.pages.size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// GH issue #16 (an adopter, v0.7.0, Windows) — route inference must be path-
// separator agnostic. `buildPageRouteTree` detected page files by searching
// the absolute path for the literal "/routes/" / "/pages/" substrings (forward
// slashes) and split relative paths on "/". On Windows the paths use "\" —
// `...\pages\login.scrml` — so the prefix match returned null and EVERY page
// fell through to the single-page-app "/" fallback (no page got a route; all
// collide at "/"; multi-page apps unroutable; first surfaced as the auth lints
// I-AUTH-REDIRECT-UNRESOLVED + W-AUTH-LOGIN-MISSING when loginRedirect="/login"
// no longer resolved). Fix: normalize "\" -> "/" at the route-inference ingest
// boundary. The map key / stored .filePath keep the ORIGINAL separator (codegen
// keys pages by the un-normalized fileAST.filePath / entry-point id).
// ---------------------------------------------------------------------------

describe("buildPageRouteTree — Windows path separators (GH#16)", () => {
  test("backslash pages\\login.scrml infers /login (matches forward-slash)", () => {
    const files = [makeFileAST("C:\\Users\\the adopter\\app\\pages\\login.scrml", [])];
    const pages = buildPageRouteTree(files);
    const page = pages.get("C:\\Users\\the adopter\\app\\pages\\login.scrml");
    expect(page).toBeDefined();
    expect(page.urlPattern).toBe("/login");
    expect(page.params).toEqual([]);
    expect(page.isCatchAll).toBe(false);
  });

  test("backslash pages\\batches.scrml infers /batches", () => {
    const files = [makeFileAST("C:\\Users\\the adopter\\app\\pages\\batches.scrml", [])];
    const pages = buildPageRouteTree(files);
    expect(pages.get("C:\\Users\\the adopter\\app\\pages\\batches.scrml").urlPattern).toBe("/batches");
  });

  test("backslash pages\\users\\[id].scrml infers /users/:id with param", () => {
    const files = [makeFileAST("C:\\Users\\the adopter\\app\\pages\\users\\[id].scrml", [])];
    const pages = buildPageRouteTree(files);
    const page = pages.get("C:\\Users\\the adopter\\app\\pages\\users\\[id].scrml");
    expect(page.urlPattern).toBe("/users/:id");
    expect(page.params).toEqual(["id"]);
    expect(page.isCatchAll).toBe(false);
  });

  test("backslash pages\\index.scrml infers / (root)", () => {
    const files = [makeFileAST("C:\\Users\\the adopter\\app\\pages\\index.scrml", [])];
    const pages = buildPageRouteTree(files);
    expect(pages.get("C:\\Users\\the adopter\\app\\pages\\index.scrml").urlPattern).toBe("/");
  });

  test("backslash pages\\posts\\[...slug].scrml infers /posts/*slug catch-all", () => {
    const files = [makeFileAST("C:\\Users\\the adopter\\app\\pages\\posts\\[...slug].scrml", [])];
    const pages = buildPageRouteTree(files);
    const page = pages.get("C:\\Users\\the adopter\\app\\pages\\posts\\[...slug].scrml");
    expect(page.urlPattern).toBe("/posts/*slug");
    expect(page.params).toEqual(["slug"]);
    expect(page.isCatchAll).toBe(true);
  });

  test("legacy routes\\ backslash prefix is also recognized", () => {
    const files = [makeFileAST("C:\\proj\\routes\\users\\[id].scrml", [])];
    const pages = buildPageRouteTree(files);
    expect(pages.get("C:\\proj\\routes\\users\\[id].scrml").urlPattern).toBe("/users/:id");
  });

  test("mixed separators (app/pages\\login.scrml) still infer /login", () => {
    const files = [makeFileAST("C:\\Users\\the adopter\\app/pages\\login.scrml", [])];
    const pages = buildPageRouteTree(files);
    expect(pages.get("C:\\Users\\the adopter\\app/pages\\login.scrml").urlPattern).toBe("/login");
  });

  test("mixed separators (app\\pages/users\\[id].scrml) infer /users/:id", () => {
    const files = [makeFileAST("C:/Users/the adopter/app\\pages/users\\[id].scrml", [])];
    const pages = buildPageRouteTree(files);
    expect(pages.get("C:/Users/the adopter/app\\pages/users\\[id].scrml").urlPattern).toBe("/users/:id");
  });

  test("UNC path \\\\server\\share\\app\\pages\\login.scrml infers /login", () => {
    const files = [makeFileAST("\\\\server\\share\\app\\pages\\login.scrml", [])];
    const pages = buildPageRouteTree(files);
    expect(pages.get("\\\\server\\share\\app\\pages\\login.scrml").urlPattern).toBe("/login");
  });

  test("backslash _layout.scrml is still excluded; sibling page still routes", () => {
    const files = [
      makeFileAST("C:\\app\\pages\\_layout.scrml", []),
      makeFileAST("C:\\app\\pages\\index.scrml", []),
    ];
    const pages = buildPageRouteTree(files);
    expect(pages.has("C:\\app\\pages\\_layout.scrml")).toBe(false);
    expect(pages.has("C:\\app\\pages\\index.scrml")).toBe(true);
    expect(pages.get("C:\\app\\pages\\index.scrml").urlPattern).toBe("/");
  });

  test("map key preserves the ORIGINAL backslash separator (codegen keys by it)", () => {
    // Regression guard: the fix must NOT normalize the pages map key — codegen
    // (codegen/index.ts pagesByFile.get(filePart)) looks up by the un-normalized
    // fileAST.filePath / entry-point id, so the key must keep its separator form.
    const files = [makeFileAST("C:\\app\\pages\\login.scrml", [])];
    const pages = buildPageRouteTree(files);
    expect(pages.has("C:\\app\\pages\\login.scrml")).toBe(true);
    expect(pages.has("C:/app/pages/login.scrml")).toBe(false);
    expect(pages.get("C:\\app\\pages\\login.scrml").filePath).toBe("C:\\app\\pages\\login.scrml");
  });

  test("backslash inference is IDENTICAL to the forward-slash result (parity)", () => {
    // Drives the acceptance criterion: the SAME logical layout authored with
    // backslashes must produce the same urlPattern set as forward slashes.
    const rel = [
      "index.scrml",
      "login.scrml",
      "batches.scrml",
      "users/[id].scrml",
      "users/index.scrml",
      "posts/[...slug].scrml",
      "auth/login.scrml",
    ];
    const posix = buildPageRouteTree(rel.map((r) => makeFileAST("/home/u/app/pages/" + r, [])));
    const win = buildPageRouteTree(
      rel.map((r) => makeFileAST("C:\\u\\app\\pages\\" + r.replace(/\//g, "\\"), [])),
    );
    const posixPatterns = [...posix.values()].map((p) => p.urlPattern).sort();
    const winPatterns = [...win.values()].map((p) => p.urlPattern).sort();
    expect(winPatterns).toEqual(posixPatterns);
    expect(winPatterns).toEqual(
      ["/", "/auth/login", "/batches", "/login", "/posts/*slug", "/users", "/users/:id"].sort(),
    );
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
// §30.1 — S180 D3.1 Gap A: W-DEPRECATED-SERVER-MODIFIER fires on lift-bearing
// escalating server functions.
//
// S93 added a `!hasLiftInFunctionBody` suppression to skip ANY lift-bearing
// body, on the (now-stale) premise that dropping `server` would trip
// E-SYNTAX-002 (`lift` illegal in a plain `function`). S180 D1 (§10.4) made
// lift-as-return VALID in an inferred-server plain `function`, so a
// `lift ?{...}.all()` body supplies a `server-only-resource` escalation reason
// and stays inferred-server after the keyword drops — the keyword IS redundant
// and the lint SHOULD fire. D3.1 removed the suppression. The independent
// `triggerDesc !== null` guard still protects a lift-PURE function.
//
// A `lift-expr` body node carrying a `{ kind: "sql" }` child mirrors the
// `lift ?{...}.method()` AST (route-inference.ts lift-expr handler ~:1124).
// ---------------------------------------------------------------------------

describe("§30.1 D3.1 — Gap A: W-DEPRECATED fires on lift-bearing escalating server fns", () => {
  /** A `lift ?{ SELECT ... }.all()` body statement: lift-expr wrapping a sql child. */
  function makeLiftSql(spanStart = 30, file = "/test/app.scrml") {
    return {
      id: spanStart,
      kind: "lift-expr",
      expr: {
        id: spanStart + 1,
        kind: "sql",
        query: { raw: "SELECT id FROM users" },
        chainedCalls: [{ method: "all", args: [] }],
        span: span(spanStart + 1, file),
      },
      span: span(spanStart, file),
    };
  }

  test("server function with a lift-SQL body — fires deprecation (the SQL-lift class)", () => {
    // The 03/07/08/17 corpus class: `server function f(){ lift ?{...}.all() }`.
    // Pre-D3.1 this was SKIPPED by the lift-suppression; now it fires.
    const fn = makeFunctionDecl({
      name: "loadContacts",
      isServer: true,
      body: [makeLiftSql(30)],
      spanStart: 10,
    });
    const fileAST = makeFileAST("/test/gapa-liftsql.scrml", [fn]);
    fileAST.exports = [{
      id: 5, kind: "export-decl", raw: "", exportedName: "loadContacts", exportKind: "function", span: span(5),
    }];
    const { errors } = runRIClean([fileAST]);

    const deprec = errors.filter(e => e.code === "W-DEPRECATED-SERVER-MODIFIER");
    expect(deprec).toHaveLength(1);
    expect(deprec[0].severity).toBe("warning");
    expect(deprec[0].message).toContain("loadContacts");
    // The trigger reason is the lift's SQL → server-only-resource (sql-query).
    expect(deprec[0].message).toContain("sql-query");
  });

  test("server function with a lift-PURE body (no escalation reason) — does NOT fire", () => {
    // A `lift`-bearing body with NO sql/protected/channel/handle reason and no
    // server callers: the `server` keyword is the SOLE escalation signal, so
    // the function would client-flip if stripped. The `triggerDesc !== null`
    // guard (preserved by D3.1) keeps the lint silent — Migration 4 leaves it.
    const liftPure = {
      id: 31,
      kind: "lift-expr",
      // No `sql` child — a lift over plain markup/expr supplies no trigger.
      expr: { id: 32, kind: "bare-expr", expr: "someMarkup", span: span(32) },
      span: span(31),
    };
    const fn = makeFunctionDecl({
      name: "pureLift",
      isServer: true,
      body: [liftPure],
      spanStart: 10,
    });
    const fileAST = makeFileAST("/test/gapa-liftpure.scrml", [fn]);
    fileAST.exports = [{
      id: 5, kind: "export-decl", raw: "", exportedName: "pureLift", exportKind: "function", span: span(5),
    }];
    const { errors } = runRIClean([fileAST]);

    const deprec = errors.filter(e => e.code === "W-DEPRECATED-SERVER-MODIFIER");
    expect(deprec).toHaveLength(0);
  });

  test("server function with a lift-SQL body AND a protected-field reason — still fires once", () => {
    // Two triggers (lift-SQL + something else) must not double-fire the lint.
    const fn = makeFunctionDecl({
      name: "loadMessages",
      isServer: true,
      body: [
        makeLiftSql(30),
        makeLetDecl("u", "?{`SELECT 1`}.get()", 60),
      ],
      spanStart: 10,
    });
    const fileAST = makeFileAST("/test/gapa-multi.scrml", [fn]);
    fileAST.exports = [{
      id: 5, kind: "export-decl", raw: "", exportedName: "loadMessages", exportKind: "function", span: span(5),
    }];
    const { errors } = runRIClean([fileAST]);

    const deprec = errors.filter(e => e.code === "W-DEPRECATED-SERVER-MODIFIER");
    expect(deprec).toHaveLength(1);
    expect(deprec[0].message).toContain("loadMessages");
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


// ---------------------------------------------------------------------------
// §32 — Wave 10 Unit P (S121): walkBodyForTriggers must collect callees from
// OBJECT-VALUED ExprNode fields on LogicStatement nodes that the array-only
// generic-fallback recursion would otherwise skip.
//
// Sibling to §31 above — §31 covers the MARKUP-CONTEXT walker
// (markupReferencedNames / walkMarkupContext); §32 covers the BODY-CALLEE
// walker (walkBodyForTriggers) which feeds the inverseCallerMap that drives
// W-DEAD-FUNCTION.
//
// The bug surfaced as 20 W-DEAD-FUNCTION false-positives on functions called
// only from while/if conditions in the native-parser .scrml mirror files
// (tag-frame.scrml, parse-expr.scrml, parse-stmt.scrml, parse-css-body.scrml,
// parse-error-body.scrml — diagnosed in Unit O survey `9a1d6950`). The pattern:
//   ${
//     export fn outer(...) { while (helper(x)) { ... } }
//     fn helper(...) { ... }
//   }
// `helper` was visible to collectFileFunctions (so it had an analysisMap
// entry) but `outer.callees` did NOT include "helper" because the walker's
// generic-fallback only recurses into ARRAY fields. The while-stmt's `body`
// IS an array (recursed), but the call lives in `condExpr` which is a
// SINGLE-OBJECT ExprNode field (skipped).
//
// Fix lives in `src/route-inference.ts` walkBodyForTriggers visitNode:
// before the generic-fallback array recursion, scan
// `condExpr|iterExpr|headerExpr|resultExpr|valueExpr` and
// `cStyleParts.{init|cond|update}Expr` via `exprNodeCollectCallees`.
// ---------------------------------------------------------------------------

describe("§32 — Wave 10 Unit P: walkBodyForTriggers — callees from object-valued ExprNode fields", () => {
  /**
   * Build a `call` ExprNode invoking `name` with zero args (sufficient to
   * register `name` as a callee via exprNodeCollectCallees).
   */
  function makeCallExpr(name) {
    return {
      kind: "call",
      callee: { kind: "ident", name },
      args: [],
      optional: false,
    };
  }

  /**
   * Build an if-stmt with a `condExpr` populated as `helperName()` (a call
   * ExprNode). The walker should extract `helperName` as a callee of the
   * enclosing function.
   */
  function makeIfStmtCallingHelper(helperName, spanStart, file) {
    return {
      id: spanStart,
      kind: "if-stmt",
      condExpr: makeCallExpr(helperName),
      consequent: [],
      alternate: null,
      span: span(spanStart, file),
    };
  }

  test("helper called from if-stmt.condExpr inside outer fn body — does NOT fire W-DEAD-FUNCTION", () => {
    const file = "/test/u-p-if.scrml";
    const helperFn = makeFunctionDecl({
      name: "helper",
      body: [makeBareExpr("return true", 21, file)],
      spanStart: 10,
      file,
    });
    const outerFn = makeFunctionDecl({
      name: "outer",
      body: [makeIfStmtCallingHelper("helper", 71, file)],
      spanStart: 60,
      file,
    });
    // Outer must itself have a caller (or be exported) so its own dead-warn
    // doesn't mask the test signal. Use an exported caller fn.
    const callerFn = makeFunctionDecl({
      name: "callerOfOuter",
      body: [makeBareExpr("return outer()", 91, file)],
      spanStart: 80,
      file,
    });
    const exportDecl = {
      id: 200,
      kind: "export-decl",
      raw: "export function callerOfOuter",
      exportedName: "callerOfOuter",
      exportKind: "function",
      span: span(200, file),
    };
    const fileAST = {
      filePath: file,
      nodes: [{ id: 1, kind: "logic", body: [helperFn, outerFn, callerFn], span: span(0, file) }],
      imports: [],
      exports: [exportDecl],
      components: [],
      typeDecls: [],
      spans: new Map(),
    };
    const { errors } = runRIClean([fileAST]);

    const helperDead = errors.filter(e => e.code === "W-DEAD-FUNCTION" && e.message.includes("`helper`"));
    expect(helperDead).toHaveLength(0);
  });

  test("helper called from while-stmt.condExpr inside outer fn body — does NOT fire W-DEAD-FUNCTION", () => {
    const file = "/test/u-p-while.scrml";
    const helperFn = makeFunctionDecl({
      name: "shouldContinue",
      body: [makeBareExpr("return false", 21, file)],
      spanStart: 10,
      file,
    });
    const whileStmt = {
      id: 71,
      kind: "while-stmt",
      condExpr: makeCallExpr("shouldContinue"),
      body: [],
      span: span(71, file),
    };
    const outerFn = makeFunctionDecl({
      name: "outer",
      body: [whileStmt],
      spanStart: 60,
      file,
    });
    const callerFn = makeFunctionDecl({
      name: "callerOfOuter",
      body: [makeBareExpr("return outer()", 91, file)],
      spanStart: 80,
      file,
    });
    const exportDecl = {
      id: 200,
      kind: "export-decl",
      raw: "export function callerOfOuter",
      exportedName: "callerOfOuter",
      exportKind: "function",
      span: span(200, file),
    };
    const fileAST = {
      filePath: file,
      nodes: [{ id: 1, kind: "logic", body: [helperFn, outerFn, callerFn], span: span(0, file) }],
      imports: [],
      exports: [exportDecl],
      components: [],
      typeDecls: [],
      spans: new Map(),
    };
    const { errors } = runRIClean([fileAST]);

    const helperDead = errors.filter(e => e.code === "W-DEAD-FUNCTION" && e.message.includes("`shouldContinue`"));
    expect(helperDead).toHaveLength(0);
  });

  test("helper called from for-stmt.iterExpr inside outer fn body — does NOT fire W-DEAD-FUNCTION", () => {
    const file = "/test/u-p-for.scrml";
    const helperFn = makeFunctionDecl({
      name: "getItems",
      body: [makeBareExpr("return []", 21, file)],
      spanStart: 10,
      file,
    });
    const forStmt = {
      id: 71,
      kind: "for-stmt",
      variable: "x",
      iterExpr: makeCallExpr("getItems"),
      body: [],
      span: span(71, file),
    };
    const outerFn = makeFunctionDecl({
      name: "outer",
      body: [forStmt],
      spanStart: 60,
      file,
    });
    const callerFn = makeFunctionDecl({
      name: "callerOfOuter",
      body: [makeBareExpr("return outer()", 91, file)],
      spanStart: 80,
      file,
    });
    const exportDecl = {
      id: 200,
      kind: "export-decl",
      raw: "export function callerOfOuter",
      exportedName: "callerOfOuter",
      exportKind: "function",
      span: span(200, file),
    };
    const fileAST = {
      filePath: file,
      nodes: [{ id: 1, kind: "logic", body: [helperFn, outerFn, callerFn], span: span(0, file) }],
      imports: [],
      exports: [exportDecl],
      components: [],
      typeDecls: [],
      spans: new Map(),
    };
    const { errors } = runRIClean([fileAST]);

    const helperDead = errors.filter(e => e.code === "W-DEAD-FUNCTION" && e.message.includes("`getItems`"));
    expect(helperDead).toHaveLength(0);
  });

  test("helper called from match-stmt.headerExpr inside outer fn body — does NOT fire W-DEAD-FUNCTION", () => {
    const file = "/test/u-p-match.scrml";
    const helperFn = makeFunctionDecl({
      name: "classifyKind",
      body: [makeBareExpr("return .Unknown", 21, file)],
      spanStart: 10,
      file,
    });
    const matchStmt = {
      id: 71,
      kind: "match-stmt",
      headerExpr: makeCallExpr("classifyKind"),
      body: [],
      span: span(71, file),
    };
    const outerFn = makeFunctionDecl({
      name: "outer",
      body: [matchStmt],
      spanStart: 60,
      file,
    });
    const callerFn = makeFunctionDecl({
      name: "callerOfOuter",
      body: [makeBareExpr("return outer()", 91, file)],
      spanStart: 80,
      file,
    });
    const exportDecl = {
      id: 200,
      kind: "export-decl",
      raw: "export function callerOfOuter",
      exportedName: "callerOfOuter",
      exportKind: "function",
      span: span(200, file),
    };
    const fileAST = {
      filePath: file,
      nodes: [{ id: 1, kind: "logic", body: [helperFn, outerFn, callerFn], span: span(0, file) }],
      imports: [],
      exports: [exportDecl],
      components: [],
      typeDecls: [],
      spans: new Map(),
    };
    const { errors } = runRIClean([fileAST]);

    const helperDead = errors.filter(e => e.code === "W-DEAD-FUNCTION" && e.message.includes("`classifyKind`"));
    expect(helperDead).toHaveLength(0);
  });

  test("helper called from match-arm-inline.resultExpr inside outer fn body — does NOT fire W-DEAD-FUNCTION", () => {
    const file = "/test/u-p-arm.scrml";
    const helperFn = makeFunctionDecl({
      name: "renderError",
      body: [makeBareExpr("return \"err\"", 21, file)],
      spanStart: 10,
      file,
    });
    // match-stmt body contains a match-arm-inline whose resultExpr is helper().
    const armInline = {
      id: 72,
      kind: "match-arm-inline",
      test: ".Error",
      result: "renderError ( )",
      resultExpr: makeCallExpr("renderError"),
      span: span(72, file),
    };
    const matchStmt = {
      id: 71,
      kind: "match-stmt",
      headerExpr: { kind: "ident", name: "x" },
      body: [armInline],
      span: span(71, file),
    };
    const outerFn = makeFunctionDecl({
      name: "outer",
      body: [matchStmt],
      params: ["x"],
      spanStart: 60,
      file,
    });
    const callerFn = makeFunctionDecl({
      name: "callerOfOuter",
      body: [makeBareExpr("return outer(1)", 91, file)],
      spanStart: 80,
      file,
    });
    const exportDecl = {
      id: 200,
      kind: "export-decl",
      raw: "export function callerOfOuter",
      exportedName: "callerOfOuter",
      exportKind: "function",
      span: span(200, file),
    };
    const fileAST = {
      filePath: file,
      nodes: [{ id: 1, kind: "logic", body: [helperFn, outerFn, callerFn], span: span(0, file) }],
      imports: [],
      exports: [exportDecl],
      components: [],
      typeDecls: [],
      spans: new Map(),
    };
    const { errors } = runRIClean([fileAST]);

    const helperDead = errors.filter(e => e.code === "W-DEAD-FUNCTION" && e.message.includes("`renderError`"));
    expect(helperDead).toHaveLength(0);
  });

  test("helper called from for-stmt.cStyleParts.condExpr inside outer fn body — does NOT fire W-DEAD-FUNCTION", () => {
    // C-style for-loop: for (let i = 0; checkBound(i); i = i + 1) { ... }
    // checkBound is called from the condExpr inside cStyleParts.
    const file = "/test/u-p-cstyle.scrml";
    const helperFn = makeFunctionDecl({
      name: "checkBound",
      body: [makeBareExpr("return false", 21, file)],
      spanStart: 10,
      file,
    });
    const forStmt = {
      id: 71,
      kind: "for-stmt",
      variable: null,
      body: [],
      cStyleParts: {
        initExpr: { kind: "lit", value: 0, litType: "number", raw: "0" },
        condExpr: makeCallExpr("checkBound"),
        updateExpr: { kind: "lit", value: 1, litType: "number", raw: "1" },
      },
      span: span(71, file),
    };
    const outerFn = makeFunctionDecl({
      name: "outer",
      body: [forStmt],
      spanStart: 60,
      file,
    });
    const callerFn = makeFunctionDecl({
      name: "callerOfOuter",
      body: [makeBareExpr("return outer()", 91, file)],
      spanStart: 80,
      file,
    });
    const exportDecl = {
      id: 200,
      kind: "export-decl",
      raw: "export function callerOfOuter",
      exportedName: "callerOfOuter",
      exportKind: "function",
      span: span(200, file),
    };
    const fileAST = {
      filePath: file,
      nodes: [{ id: 1, kind: "logic", body: [helperFn, outerFn, callerFn], span: span(0, file) }],
      imports: [],
      exports: [exportDecl],
      components: [],
      typeDecls: [],
      spans: new Map(),
    };
    const { errors } = runRIClean([fileAST]);

    const helperDead = errors.filter(e => e.code === "W-DEAD-FUNCTION" && e.message.includes("`checkBound`"));
    expect(helperDead).toHaveLength(0);
  });

  test("REGRESSION GUARD — fn declared but never called STILL fires W-DEAD-FUNCTION", () => {
    // Critical false-negative guard: the new EXPR_NODE_FIELDS scan must NOT
    // mask GENUINE dead functions. If `genuinelyDead` is declared with no
    // callsite ANYWHERE (no body callee, no markup ref, no export), the
    // warning SHALL still fire.
    const file = "/test/u-p-guard.scrml";
    const genuinelyDeadFn = makeFunctionDecl({
      name: "genuinelyDead",
      body: [makeBareExpr("return 42", 21, file)],
      spanStart: 10,
      file,
    });
    // A live, exported function in the same file — establishes that the
    // analyzer is running and emitting warnings as expected. genuinelyDead
    // is NOT called from anywhere.
    const liveFn = makeFunctionDecl({
      name: "live",
      body: [makeBareExpr("return 1", 51, file)],
      spanStart: 40,
      file,
    });
    const exportDecl = {
      id: 200,
      kind: "export-decl",
      raw: "export function live",
      exportedName: "live",
      exportKind: "function",
      span: span(200, file),
    };
    const fileAST = {
      filePath: file,
      nodes: [{ id: 1, kind: "logic", body: [genuinelyDeadFn, liveFn], span: span(0, file) }],
      imports: [],
      exports: [exportDecl],
      components: [],
      typeDecls: [],
      spans: new Map(),
    };
    const { errors } = runRIClean([fileAST]);

    const dead = errors.filter(e => e.code === "W-DEAD-FUNCTION" && e.message.includes("`genuinelyDead`"));
    expect(dead).toHaveLength(1);
    // live fn is exported — should NOT fire.
    const liveDead = errors.filter(e => e.code === "W-DEAD-FUNCTION" && e.message.includes("`live`"));
    expect(liveDead).toHaveLength(0);
  });

  test("REGRESSION GUARD — synthetic genuinely-dead inner fn alongside live one (mixed file)", () => {
    // Mirrors the realistic pattern: a file with N helper fns where M of them
    // are referenced and (N - M) are truly dead. The fix must classify each
    // correctly — no over-suppression, no over-firing.
    const file = "/test/u-p-mixed.scrml";
    const liveHelperFn = makeFunctionDecl({
      name: "liveHelper",
      body: [makeBareExpr("return true", 21, file)],
      spanStart: 10,
      file,
    });
    const deadHelperFn = makeFunctionDecl({
      name: "deadHelper",
      body: [makeBareExpr("return 0", 31, file)],
      spanStart: 20,
      file,
    });
    const outerFn = makeFunctionDecl({
      name: "outer",
      body: [
        {
          id: 71,
          kind: "if-stmt",
          condExpr: makeCallExpr("liveHelper"),
          consequent: [],
          alternate: null,
          span: span(71, file),
        },
      ],
      spanStart: 60,
      file,
    });
    const callerFn = makeFunctionDecl({
      name: "callerOfOuter",
      body: [makeBareExpr("return outer()", 91, file)],
      spanStart: 80,
      file,
    });
    const exportDecl = {
      id: 200,
      kind: "export-decl",
      raw: "export function callerOfOuter",
      exportedName: "callerOfOuter",
      exportKind: "function",
      span: span(200, file),
    };
    const fileAST = {
      filePath: file,
      nodes: [{ id: 1, kind: "logic", body: [liveHelperFn, deadHelperFn, outerFn, callerFn], span: span(0, file) }],
      imports: [],
      exports: [exportDecl],
      components: [],
      typeDecls: [],
      spans: new Map(),
    };
    const { errors } = runRIClean([fileAST]);

    const liveDead = errors.filter(e => e.code === "W-DEAD-FUNCTION" && e.message.includes("`liveHelper`"));
    expect(liveDead, "liveHelper is called from outer's if-stmt condExpr — must NOT fire").toHaveLength(0);

    const trulyDead = errors.filter(e => e.code === "W-DEAD-FUNCTION" && e.message.includes("`deadHelper`"));
    expect(trulyDead, "deadHelper has no callsite — SHOULD still fire").toHaveLength(1);
  });

  test("native-parser .scrml mirror shape (tag-frame-like) — body-callee callsite in while-condition closes the false-positive", () => {
    // Structural reproducer of the tag-frame.scrml shape that drove
    // 7 of the 20 Unit O W-DEAD-FUNCTION false-positives:
    //   ${
    //     export fn tokenizeAttributeRegion(...) {
    //       while (p < end && isAttrWhitespace(source.charAt(p))) { p = p + 1 }
    //     }
    //     fn isAttrWhitespace(ch) { ... }
    //   }
    // The outer fn (exported) is alive; the inner fn (called only from the
    // while condExpr) was previously flagged dead.
    const file = "/test/u-p-tagframe-shape.scrml";
    const isAttrWhitespaceFn = makeFunctionDecl({
      name: "isAttrWhitespace",
      body: [makeBareExpr("return ch == \" \"", 21, file)],
      params: ["ch"],
      spanStart: 10,
      file,
    });
    // Build the while-stmt with condExpr = `isAttrWhitespace(ch)`-shaped
    // call wrapped in a binary AND. The walker should descend through the
    // binary and find the call.
    const whileCondExpr = {
      kind: "binary",
      op: "&&",
      left: { kind: "ident", name: "p_lt_end" }, // stand-in for p < end
      right: {
        kind: "call",
        callee: { kind: "ident", name: "isAttrWhitespace" },
        args: [{ kind: "ident", name: "ch" }],
        optional: false,
      },
    };
    const whileStmt = {
      id: 81,
      kind: "while-stmt",
      condExpr: whileCondExpr,
      body: [],
      span: span(81, file),
    };
    const outerFn = makeFunctionDecl({
      name: "tokenizeAttributeRegion",
      params: ["source", "ch"],
      body: [whileStmt],
      spanStart: 70,
      file,
    });
    const exportDecl = {
      id: 200,
      kind: "export-decl",
      raw: "export function tokenizeAttributeRegion",
      exportedName: "tokenizeAttributeRegion",
      exportKind: "function",
      span: span(200, file),
    };
    const fileAST = {
      filePath: file,
      nodes: [{ id: 1, kind: "logic", body: [isAttrWhitespaceFn, outerFn], span: span(0, file) }],
      imports: [],
      exports: [exportDecl],
      components: [],
      typeDecls: [],
      spans: new Map(),
    };
    const { errors } = runRIClean([fileAST]);

    const helperDead = errors.filter(e => e.code === "W-DEAD-FUNCTION" && e.message.includes("`isAttrWhitespace`"));
    expect(helperDead, "isAttrWhitespace is called from tokenizeAttributeRegion's while-condExpr — must NOT fire").toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §33 — Wave 12 Unit Y (S122): walkBodyForTriggers must run TRIGGER DETECTION
// (Trigger 1 server-only-resource / D2c imported-server-namespace / Trigger 2
// protected-field-access) on the same object-valued ExprNode fields that
// Wave 10-P (§32 above) extended for CALLEE collection.
//
// Pre-Y, a function whose only server-signal lived inside an EXPR_NODE field
// — `while (?{`SELECT ...`}.get())` or `if (row.passwordHash)` — would
// mis-classify as client because Trigger 1/2 detectors only ran against the
// STRING fields on bare-expr / let-decl / state-decl / return-stmt.
//
// Sibling to §32 (CALLEE collection) — same fields, same root structural
// gap (single-object ExprNode skipped by array-only generic-fallback), same
// fix shape (per-field scan via emitStringFromTree + apply string detector).
//
// Fix lives in src/route-inference.ts walkBodyForTriggers visitNode at
// the EXPR_NODE_TRIGGER_FIELDS block (formerly EXPR_NODE_CALLEE_FIELDS):
// scanExprNodeField now calls detectServerOnlyResource +
// detectImportedServerNamespaceRef + bareExprAccessesField against the
// emitStringFromTree(exprNode) string in addition to exprNodeCollectCallees.
// ---------------------------------------------------------------------------

describe("§33 — Wave 12 Unit Y: walkBodyForTriggers — Trigger 1/2 detection on object-valued ExprNode fields", () => {
  /**
   * Build a `call` ExprNode invoking `name` with zero args.
   */
  function makeCallExpr(name) {
    return {
      kind: "call",
      callee: { kind: "ident", name },
      args: [],
      optional: false,
    };
  }

  /**
   * Build a `member` ExprNode for `object.property`.
   */
  function makeMemberExpr(objectName, propertyName) {
    return {
      kind: "member",
      object: { kind: "ident", name: objectName },
      property: propertyName,
      computed: false,
      optional: false,
    };
  }

  /**
   * Build a SQL ExprNode (the canonical `?{...}.method()` shape). The
   * AST builder lowers `?{...}` to a sql-ref ExprNode (the SQL text is
   * extracted into a separate sql node attached elsewhere; the in-expr
   * site holds a reference). emitStringFromTree("sql-ref") emits
   * `?{ /* sql *\/ }`, which contains `?{` so the SERVER_ONLY_PATTERNS
   * sql-query regex (/\?\{/) matches.
   */
  function makeSqlGetExpr(_query = "SELECT 1") {
    return {
      kind: "call",
      callee: {
        kind: "member",
        object: { kind: "sql-ref", nodeId: -1 },
        property: "get",
        computed: false,
        optional: false,
      },
      args: [],
      optional: false,
    };
  }

  test("server-trigger inside if-stmt.condExpr (SQL ?{}.get()) — fn classifies SERVER", () => {
    // Per §12.2 Trigger 1: `?{}` SQL context is server-only.
    // Pre-Unit-Y, this fn classified client because the trigger detectors
    // only saw STRING-field surfaces. Now it must classify server via
    // EXPR_NODE_TRIGGER_FIELDS scan over condExpr.
    const file = "/test/u-y-if-sql.scrml";
    const fn = makeFunctionDecl({
      name: "checkAndAct",
      body: [
        {
          id: 31,
          kind: "if-stmt",
          condExpr: makeSqlGetExpr("SELECT COUNT(*) FROM users"),
          consequent: [],
          alternate: null,
          span: span(31, file),
        },
      ],
      spanStart: 10,
      file,
    });
    const fileAST = makeFileAST(file, [fn]);
    const { routeMap } = runRIClean([fileAST]);

    const route = getRoute(routeMap, file, 10);
    expect(route).toBeDefined();
    expect(route.boundary, "if-stmt.condExpr with ?{} SQL must escalate to server").toBe("server");
    const kinds = route.escalationReasons.map(r => r.kind);
    expect(kinds).toContain("server-only-resource");
    const sqlReason = route.escalationReasons.find(r => r.kind === "server-only-resource");
    expect(sqlReason.resourceType).toBe("sql-query");
  });

  test("server-trigger inside while-stmt.condExpr (SQL ?{}.get()) — fn classifies SERVER", () => {
    // SQL inside a loop condition — pattern common to long-running poll loops.
    const file = "/test/u-y-while-sql.scrml";
    const fn = makeFunctionDecl({
      name: "pollUntilDone",
      body: [
        {
          id: 31,
          kind: "while-stmt",
          condExpr: makeSqlGetExpr("SELECT 1 FROM jobs WHERE pending = 1"),
          body: [],
          span: span(31, file),
        },
      ],
      spanStart: 10,
      file,
    });
    const fileAST = makeFileAST(file, [fn]);
    const { routeMap } = runRIClean([fileAST]);

    const route = getRoute(routeMap, file, 10);
    expect(route.boundary, "while-stmt.condExpr with ?{} SQL must escalate to server").toBe("server");
    const kinds = route.escalationReasons.map(r => r.kind);
    expect(kinds).toContain("server-only-resource");
  });

  test("server-trigger inside for-stmt.iterExpr (?{}.all()) — fn classifies SERVER", () => {
    // SQL inside a for-loop iterable — pattern: `for (row in ?{}.all()) { ... }`.
    const file = "/test/u-y-for-sql.scrml";
    const fn = makeFunctionDecl({
      name: "iterateUsers",
      body: [
        {
          id: 31,
          kind: "for-stmt",
          variable: "row",
          iterExpr: makeSqlGetExpr("SELECT * FROM users"),
          body: [],
          span: span(31, file),
        },
      ],
      spanStart: 10,
      file,
    });
    const fileAST = makeFileAST(file, [fn]);
    const { routeMap } = runRIClean([fileAST]);

    const route = getRoute(routeMap, file, 10);
    expect(route.boundary, "for-stmt.iterExpr with ?{} SQL must escalate to server").toBe("server");
    const kinds = route.escalationReasons.map(r => r.kind);
    expect(kinds).toContain("server-only-resource");
  });

  test("protected-field-access inside if-stmt.condExpr — fn classifies SERVER", () => {
    // Per §12.2 Trigger 2: a function reading a protect= field is server-only.
    // Pattern: `if (row.passwordHash != null) { ... }` — the bare-expr branch
    // detects this in the string `row.passwordHash`; pre-Unit-Y the condExpr
    // ExprNode shape was invisible to the same detector.
    const file = "/test/u-y-if-protected.scrml";
    const pa = makeProtectAnalysis(`${file}::0`, "users", ["passwordHash"]);
    const fn = makeFunctionDecl({
      name: "verifyAndContinue",
      body: [
        {
          id: 31,
          kind: "if-stmt",
          condExpr: makeMemberExpr("row", "passwordHash"),
          consequent: [],
          alternate: null,
          span: span(31, file),
        },
      ],
      spanStart: 10,
      file,
    });
    const fileAST = makeFileAST(file, [fn]);
    const { routeMap } = runRI({ files: [fileAST], protectAnalysis: pa });

    const route = getRoute(routeMap, file, 10);
    expect(route.boundary, "if-stmt.condExpr reading protected field must escalate to server").toBe("server");
    const kinds = route.escalationReasons.map(r => r.kind);
    expect(kinds).toContain("protected-field-access");
    const protReason = route.escalationReasons.find(r => r.kind === "protected-field-access");
    expect(protReason.field).toBe("passwordHash");
  });

  test("server-trigger inside for-stmt.cStyleParts.condExpr (?{}.get()) — fn classifies SERVER", () => {
    // C-style for header: `for (let i = 0; ?{...}.get() > 0; i++) { ... }`.
    // cStyleParts is a nested object holding three ExprNode children —
    // its own traversal mirrors the EXPR_NODE_TRIGGER_FIELDS scan.
    const file = "/test/u-y-cstyle-for-sql.scrml";
    const fn = makeFunctionDecl({
      name: "untilExhausted",
      body: [
        {
          id: 31,
          kind: "for-stmt",
          cStyleParts: {
            initExpr: { kind: "literal", value: 0 },
            condExpr: makeSqlGetExpr("SELECT COUNT(*) FROM queue"),
            updateExpr: { kind: "ident", name: "i" },
          },
          body: [],
          span: span(31, file),
        },
      ],
      spanStart: 10,
      file,
    });
    const fileAST = makeFileAST(file, [fn]);
    const { routeMap } = runRIClean([fileAST]);

    const route = getRoute(routeMap, file, 10);
    expect(route.boundary, "for-stmt.cStyleParts.condExpr with ?{} SQL must escalate to server").toBe("server");
    const kinds = route.escalationReasons.map(r => r.kind);
    expect(kinds).toContain("server-only-resource");
  });

  test("REGRESSION GUARD — pure client expression in if-stmt.condExpr stays CLIENT (no false escalation)", () => {
    // Critical false-positive guard: the new trigger scan must NOT escalate
    // benign client conditions. A simple boolean expression in a condExpr
    // SHALL stay client.
    const file = "/test/u-y-no-false-escalation.scrml";
    const fn = makeFunctionDecl({
      name: "simpleCheck",
      body: [
        {
          id: 31,
          kind: "if-stmt",
          condExpr: {
            kind: "binary",
            op: ">",
            left: { kind: "ident", name: "x" },
            right: { kind: "literal", value: 0 },
          },
          consequent: [],
          alternate: null,
          span: span(31, file),
        },
      ],
      spanStart: 10,
      file,
    });
    const fileAST = makeFileAST(file, [fn]);
    const { routeMap } = runRIClean([fileAST]);

    const route = getRoute(routeMap, file, 10);
    expect(route.boundary, "benign if-condition must stay client").toBe("client");
    expect(route.escalationReasons, "no escalation reasons for benign condExpr").toHaveLength(0);
  });

  test("REGRESSION GUARD — Wave 10-P CALLEE collection still works alongside new trigger detection", () => {
    // The Unit Y refactor extracts callee+trigger collection into a shared
    // scanExprNodeField helper. This test re-asserts that Wave 10-P's
    // W-DEAD-FUNCTION suppression for helpers called from if-condExpr still
    // fires post-Y. Same shape as §32's first test.
    const file = "/test/u-y-callee-still-works.scrml";
    const helperFn = makeFunctionDecl({
      name: "helper",
      body: [makeBareExpr("return true", 21, file)],
      spanStart: 10,
      file,
    });
    const outerFn = makeFunctionDecl({
      name: "outer",
      body: [
        {
          id: 71,
          kind: "if-stmt",
          condExpr: makeCallExpr("helper"),
          consequent: [],
          alternate: null,
          span: span(71, file),
        },
      ],
      spanStart: 60,
      file,
    });
    const callerFn = makeFunctionDecl({
      name: "callerOfOuter",
      body: [makeBareExpr("return outer()", 91, file)],
      spanStart: 80,
      file,
    });
    const exportDecl = {
      id: 200,
      kind: "export-decl",
      raw: "export function callerOfOuter",
      exportedName: "callerOfOuter",
      exportKind: "function",
      span: span(200, file),
    };
    const fileAST = {
      filePath: file,
      nodes: [{ id: 1, kind: "logic", body: [helperFn, outerFn, callerFn], span: span(0, file) }],
      imports: [],
      exports: [exportDecl],
      components: [],
      typeDecls: [],
      spans: new Map(),
    };
    const { errors } = runRIClean([fileAST]);

    const helperDead = errors.filter(e => e.code === "W-DEAD-FUNCTION" && e.message.includes("`helper`"));
    expect(helperDead, "Wave 10-P CALLEE collection must still work — helper has a call from if-condExpr").toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §195 — W-DEAD-FUNCTION false positives: closure-body calls + first-class
// value references (adopter #195, change-id
// `w-dead-function-fp-closure-and-value-ref`).
//
// The D4 dead-warn gate decides "dead" from `inverseCallerMap` (built from
// `record.callees` → exprNodeCollectCallees → forEachCallInExprNode). That
// shared path has two blind spots that surface as W-DEAD FALSE POSITIVES even
// though the tree-shaker (usage-analyzer) correctly KEEPS the function:
//   Case 1 — a call located inside a NESTED CLOSURE body (arrow `=>` or a
//     `function`-expression); the callee walk returns at `case "lambda"` and
//     never descends, and a block-body closure is an opaque escape-hatch.
//   Case 2 — a function passed as a FIRST-CLASS VALUE (arg / assignment /
//     array / object / ternary / return); only `call.callee` idents count as
//     callees, so a bare fn-name in value position is never a use.
//
// The fix adds a SEPARATE dead-code-reachability set (`logicReferencedFnNames`)
// + one D4 gate term. The shared call-graph path (which also drives §12.2
// server-placement inference / Step 5c) is untouched — test 9 is the placement
// regression guard proving the fix did NOT leak into Step 5c.
//
// These tests parse REAL .scrml source through the front-end (splitBlocks +
// buildAST) so the lambda / escape-hatch ExprNode shapes are the production
// ones the fix depends on, then run RI and assert on W-DEAD-FUNCTION.
// ---------------------------------------------------------------------------
describe("§195 — W-DEAD-FUNCTION false positives (closure body + first-class value)", () => {
  /** Parse real source → FileAST → runRI. Returns { routeMap, errors }. */
  function riFromSource(source, filePath = "/test/dead195.scrml") {
    const bs = splitBlocks(filePath, source);
    const { ast } = buildAST(bs);
    const fileAST = {
      filePath,
      source,
      nodes: ast.nodes ?? [],
      imports: ast.imports ?? [],
      exports: ast.exports ?? [],
      components: ast.components ?? [],
      typeDecls: ast.typeDecls ?? [],
      machineDecls: ast.machineDecls ?? [],
      spans: ast.spans ?? new Map(),
    };
    return runRI({ files: [fileAST], protectAnalysis: emptyProtectAnalysis() });
  }
  /** W-DEAD-FUNCTION warnings naming `fnName` (the message wraps it in backticks). */
  function deadWarns(errors, fnName) {
    return errors.filter(e => e.code === "W-DEAD-FUNCTION" && e.message.includes("`" + fnName + "`"));
  }

  test("1. fn called only inside an arrow EXPRESSION body → NO W-DEAD", () => {
    const src = [
      "function cmp(x) { return x * 2 }",
      "function sortIt(list) { return list.slice().sort((a, b) => cmp(a) - cmp(b)) }",
      "<div>${sortIt([3, 1, 2]).join(\",\")}</div>",
    ].join("\n");
    const { errors } = riFromSource(src);
    expect(deadWarns(errors, "cmp")).toHaveLength(0);
  });

  test("2. fn called only inside a FUNCTION-EXPRESSION body → NO W-DEAD", () => {
    const src = [
      "function helper2() { return 7 }",
      "function arm2() { const f = function() { return helper2() }; return f() }",
      "<div>${arm2()}</div>",
    ].join("\n");
    const { errors } = riFromSource(src);
    expect(deadWarns(errors, "helper2")).toHaveLength(0);
  });

  test("3. real-app shape `.sort((a,b) => compareItems(a,b))` → NO W-DEAD for compareItems", () => {
    const src = [
      "function compareItems(a, b) { return a - b }",
      "function ordered(list) { return list.slice().sort((a, b) => compareItems(a, b)) }",
      "<div>${ordered([2, 1]).join(\",\")}</div>",
    ].join("\n");
    const { errors } = riFromSource(src);
    expect(deadWarns(errors, "compareItems")).toHaveLength(0);
  });

  test("4. setTimeout(fn, 10) — fn passed as a value → NO W-DEAD", () => {
    const src = [
      "<tick> = 0",
      "function usedAsValue() { @tick = @tick + 1 }",
      "function arm4() { setTimeout(usedAsValue, 10) }",
      "<button onclick=arm4()>go</button>",
      "<div>${@tick}</div>",
    ].join("\n");
    const { errors } = riFromSource(src);
    expect(deadWarns(errors, "usedAsValue")).toHaveLength(0);
  });

  test("5. assignment / array / object / ternary value refs → NO W-DEAD", () => {
    const src = [
      "function hAssign() { return 1 }",
      "function hArray() { return 2 }",
      "function hObj() { return 3 }",
      "function hTernA() { return 4 }",
      "function hTernB() { return 5 }",
      "function wire(flag) {",
      "  const el = {}",
      "  el.onscroll = hAssign",
      "  const arr = [hArray]",
      "  const o = { handler: hObj }",
      "  const pick = flag ? hTernA : hTernB",
      "  return [el, arr, o, pick]",
      "}",
      "<div>${wire(true).length}</div>",
    ].join("\n");
    const { errors } = riFromSource(src);
    for (const nm of ["hAssign", "hArray", "hObj", "hTernA", "hTernB"]) {
      expect(deadWarns(errors, nm), `${nm} is referenced as a first-class value — must NOT fire W-DEAD`).toHaveLength(0);
    }
  });

  test("6. CONTROL — a genuinely-unreferenced fn STILL fires W-DEAD", () => {
    const src = [
      "function reallyDead() { return 42 }",
      "function alive() { return 1 }",
      "<div>${alive()}</div>",
    ].join("\n");
    const { errors } = riFromSource(src);
    expect(deadWarns(errors, "reallyDead"), "genuinely dead fn must still warn").toHaveLength(1);
    expect(deadWarns(errors, "alive")).toHaveLength(0);
  });

  test("7. CONTROL — a self-recursive-only fn STILL fires W-DEAD", () => {
    const src = [
      "function loopOnly(n) { if (n > 0) { return loopOnly(n - 1) } return 0 }",
      "<div>hi</div>",
    ].join("\n");
    const { errors } = riFromSource(src);
    expect(deadWarns(errors, "loopOnly"), "a fn that references only itself is still dead").toHaveLength(1);
  });

  test("8. CONTROL — a self-value-ref-only fn STILL fires W-DEAD", () => {
    const src = [
      "function timerOnly() { setTimeout(timerOnly, 10) }",
      "<div>bye</div>",
    ].join("\n");
    const { errors } = riFromSource(src);
    expect(deadWarns(errors, "timerOnly"), "a fn referenced only by itself as a value is still dead").toHaveLength(1);
  });

  test("9. PLACEMENT REGRESSION GUARD — a `?{}`-SQL helper called ONLY inside a client-context arrow keeps its server classification (fix did not leak into Step 5c)", () => {
    const src = [
      '<program db="./t195.db">',
      "<schema>",
      "    table items {",
      "        id: integer primary key",
      "        n: string",
      "    }",
      "</>",
      '<db src="./t195.db" tables="items">',
      "    ${",
      "        function dbHelper(id) {",
      "            return ?{`SELECT n FROM items WHERE id = ${id}`}.get()",
      "        }",
      "        function render(list) {",
      "            return list.map((x) => dbHelper(x))",
      "        }",
      "    }",
      "</db>",
      "<page><main>${render([1, 2]).join(\",\")}</main></page>",
      "</program>",
    ].join("\n");
    const { routeMap, errors } = riFromSource(src, "/test/dead195-placement.scrml");

    // (a) The fix suppresses the false W-DEAD for the closure-referenced helper.
    expect(deadWarns(errors, "dbHelper")).toHaveLength(0);

    // (b) Placement is UNCHANGED: dbHelper has a DIRECT server trigger (?{} SQL,
    // Trigger 1), so it is server-classified regardless of caller context. The
    // fix only touches the D4 dead-warn gate — never Step 5c — so this must hold.
    const dbHelperRoute = [...routeMap.functions.values()].find(r => r.functionName === "dbHelper");
    expect(dbHelperRoute, "dbHelper must have a route entry").toBeDefined();
    expect(dbHelperRoute.boundary, "dbHelper stays server-classified (Trigger 1 ?{} SQL)").toBe("server");
  });
});
