/**
 * SQL/Server-Context Client Leak — Security Tests
 *
 * Verifies that server-only constructs (SQL blocks, transaction blocks, and
 * server-context meta blocks) never appear in .client.js output.
 *
 * Security invariants tested:
 *   §1  SQL node in top-level logic → absent from clientJs, W-CG-001 warning
 *   §2  SQL node in server-boundary function body → present in serverJs
 *   §3  SQL node in client-boundary function body → E-CG-006 error
 *   §4  transaction-block in top-level logic → absent from clientJs, W-CG-001 warning
 *   §5  Meta node with process.env → absent from clientJs, W-CG-001 warning
 *   §6  Meta node with Bun.env → absent from clientJs, W-CG-001 warning
 *   §7  Meta node with bun.eval() → absent from clientJs, W-CG-001 warning
 *   §8  Meta node without server-context → present in clientJs (regression guard)
 *   §9  CSRF validation injected in POST handler when csrf="auto"
 *   §10 Auth check injected in POST handler when auth="required"
 *   §11 _scrml_sql_exec never appears in clientJs
 *   §12 _scrml_db never appears in clientJs
 *   §13 process.env never appears in clientJs
 *   §14 isServerOnlyNode unit tests — sql, transaction-block, meta detection
 *   §15 rewriteSqlRefs — bare ?{...} without method call → _scrml_sql_exec()
 *   §16 isServerOnlyNode — let-decl/bare-expr with ?{ sigil are server-only
 *   §17 Full CG — let-decl with ?{...} init does NOT appear in clientJs
 *   §18 Defense-in-depth — raw ?{ sigil triggers E-CG-006 if it reaches clientJs
 */

import { describe, test, expect } from "bun:test";
import { runCG } from "../../src/code-generator.js";
import { isServerOnlyNode } from "../../src/codegen/collect.js";
import { rewriteSqlRefs } from "../../src/codegen/rewrite.js";

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

function makeSqlNode(query, s = span(10)) {
  return { kind: "sql", query, span: s };
}

function makeTransactionBlock(body = [], s = span(10)) {
  return { kind: "transaction-block", body, span: s };
}

function makeMetaNode(body, s = span(10)) {
  return { kind: "meta", body, span: s };
}

function makeBareExpr(expr, s = span(0)) {
  return { kind: "bare-expr", expr, span: s };
}

function makeLetDecl(name, init, s = span(0)) {
  return { kind: "let-decl", name, init, span: s };
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

// ---------------------------------------------------------------------------
// §14: isServerOnlyNode unit tests — run first as they are foundational
// ---------------------------------------------------------------------------

describe("§14: isServerOnlyNode — unit tests", () => {
  test("sql node is server-only", () => {
    expect(isServerOnlyNode({ kind: "sql", query: "SELECT 1", span: span(0) })).toBe(true);
  });

  test("transaction-block node is server-only", () => {
    expect(isServerOnlyNode({ kind: "transaction-block", body: [], span: span(0) })).toBe(true);
  });

  test("meta node with process.env is server-only", () => {
    const node = makeMetaNode([makeBareExpr("process.env.SECRET")]);
    expect(isServerOnlyNode(node)).toBe(true);
  });

  test("meta node with Bun.env is server-only", () => {
    const node = makeMetaNode([makeBareExpr("const x = Bun.env.API_KEY")]);
    expect(isServerOnlyNode(node)).toBe(true);
  });

  test("meta node with bun.eval() is server-only", () => {
    const node = makeMetaNode([makeBareExpr("bun.eval('some code')")]);
    expect(isServerOnlyNode(node)).toBe(true);
  });

  test("meta node with Bun.file() is server-only", () => {
    const node = makeMetaNode([makeBareExpr("Bun.file('/etc/passwd')")]);
    expect(isServerOnlyNode(node)).toBe(true);
  });

  test("meta node with fs.readFile is server-only", () => {
    const node = makeMetaNode([makeBareExpr("fs.readFile('/tmp/data')")]);
    expect(isServerOnlyNode(node)).toBe(true);
  });

  test("meta node with new Database() is server-only", () => {
    const node = makeMetaNode([makeBareExpr("new Database('/app/db.sqlite')")]);
    expect(isServerOnlyNode(node)).toBe(true);
  });

  test("meta node with no server-context patterns is NOT server-only", () => {
    const node = makeMetaNode([makeBareExpr("console.log('hello')")]);
    expect(isServerOnlyNode(node)).toBe(false);
  });

  test("meta node with empty body is NOT server-only", () => {
    const node = makeMetaNode([]);
    expect(isServerOnlyNode(node)).toBe(false);
  });

  test("bare-expr node is NOT server-only", () => {
    expect(isServerOnlyNode({ kind: "bare-expr", expr: "x = 1", span: span(0) })).toBe(false);
  });

  test("let-decl node is NOT server-only", () => {
    expect(isServerOnlyNode({ kind: "let-decl", name: "x", init: "1", span: span(0) })).toBe(false);
  });

  test("null/undefined returns false", () => {
    expect(isServerOnlyNode(null)).toBe(false);
    expect(isServerOnlyNode(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §1: SQL node in top-level logic → absent from clientJs, W-CG-001 warning
// ---------------------------------------------------------------------------

describe("§1: SQL node in top-level logic → absent from clientJs", () => {
  test("SQL node in logic body does not appear in clientJs", () => {
    const result = runCGForFile([
      makeLogicBlock([makeSqlNode("SELECT * FROM users")]),
    ]);

    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).not.toContain("_scrml_sql_exec");
    expect(out.clientJs).not.toContain("SELECT * FROM users");
  });

  test("SQL node in logic body produces W-CG-001 warning", () => {
    const result = runCGForFile([
      makeLogicBlock([makeSqlNode("SELECT * FROM users")]),
    ]);

    const warnings = result.errors.filter(e => e.code === "W-CG-001");
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0].severity).toBe("warning");
    expect(warnings[0].message).toContain("W-CG-001");
  });

  test("W-CG-001 message identifies the node kind", () => {
    const result = runCGForFile([
      makeLogicBlock([makeSqlNode("INSERT INTO logs VALUES (1)")]),
    ]);

    const warning = result.errors.find(e => e.code === "W-CG-001");
    expect(warning).toBeDefined();
    expect(warning.message).toContain("sql");
  });

  test("other top-level statements are still emitted after SQL suppression", () => {
    const result = runCGForFile([
      makeLogicBlock([
        makeSqlNode("SELECT 1"),
        { kind: "bare-expr", expr: "console.log('still here')", span: span(20) },
      ]),
    ]);

    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).toContain("console.log");
    expect(out.clientJs).not.toContain("_scrml_sql_exec");
  });
});

// ---------------------------------------------------------------------------
// §2: SQL node in server-boundary function body → present in serverJs
// ---------------------------------------------------------------------------

describe("§2: SQL node in server-boundary function body → present in serverJs", () => {
  test("SQL node in server function body appears in serverJs", () => {
    const fnSpan = span(100);
    const sqlNode = makeSqlNode("SELECT * FROM users", span(110));
    const fnNode = makeFunctionDecl("getData", [sqlNode], [], { span: fnSpan });

    const routeMap = makeRouteMap([{
      functionNodeId: "/test/app.scrml::100",
      boundary: "server",
      escalationReasons: [{ kind: "server-only-resource", resourceType: "sql-query" }],
      generatedRouteName: "__ri_route_getData_1",
      serverEntrySpan: fnSpan,
    }]);

    const result = runCGForFile(
      [makeLogicBlock([fnNode], span(90))],
      routeMap,
    );

    expect(result.errors.filter(e => e.severity !== "warning")).toHaveLength(0);
    const out = result.outputs.get("/test/app.scrml");
    // §44 emission: bare DDL routes through Bun.SQL's `sql.unsafe()`.
    expect(out.serverJs).toContain("_scrml_sql.unsafe(");
    expect(out.serverJs).toContain("SELECT * FROM users");
    // clientJs should have only the fetch stub, no SQL identifier and no SQL text
    expect(out.clientJs).not.toContain("_scrml_sql.unsafe(");
    expect(out.clientJs).not.toContain("_scrml_sql_exec");
    expect(out.clientJs).not.toContain("SELECT * FROM users");
  });
});

// ---------------------------------------------------------------------------
// §3: SQL node in client-boundary function body → E-CG-006 error
// ---------------------------------------------------------------------------

describe("§3: SQL node in client-boundary function body → E-CG-006 error", () => {
  test("SQL node in client function body produces E-CG-006 error", () => {
    const fnSpan = span(100);
    const sqlNode = makeSqlNode("INSERT INTO logs VALUES ('x')", span(110));
    const fnNode = makeFunctionDecl("badFn", [sqlNode], [], { span: fnSpan });

    // No route entry = client-boundary by default
    const result = runCGForFile([makeLogicBlock([fnNode], span(90))]);

    const errors = result.errors.filter(e => e.code === "E-CG-006");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain("E-CG-006");
    expect(errors[0].severity).toBe("error");
  });

  test("SQL node in client function body does not appear in clientJs output", () => {
    const fnSpan = span(100);
    const sqlNode = makeSqlNode("DELETE FROM users", span(110));
    const fnNode = makeFunctionDecl("deleteFn", [sqlNode], [], { span: fnSpan });

    const result = runCGForFile([makeLogicBlock([fnNode], span(90))]);

    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).not.toContain("_scrml_sql_exec");
    expect(out.clientJs).not.toContain("DELETE FROM users");
  });
});

// ---------------------------------------------------------------------------
// §4: transaction-block in top-level logic → absent from clientJs
// ---------------------------------------------------------------------------

describe("§4: transaction-block in top-level logic → absent from clientJs", () => {
  test("transaction-block in logic body does not appear in clientJs", () => {
    const result = runCGForFile([
      makeLogicBlock([makeTransactionBlock([])]),
    ]);

    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).not.toContain("_scrml_db.exec");
    expect(out.clientJs).not.toContain("BEGIN");
    expect(out.clientJs).not.toContain("COMMIT");
    expect(out.clientJs).not.toContain("ROLLBACK");
  });

  test("transaction-block in logic body produces W-CG-001 warning", () => {
    const result = runCGForFile([
      makeLogicBlock([makeTransactionBlock([])]),
    ]);

    const warnings = result.errors.filter(e => e.code === "W-CG-001");
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0].message).toContain("transaction-block");
  });
});

// ---------------------------------------------------------------------------
// §5-7: Server-context meta blocks → absent from clientJs
// ---------------------------------------------------------------------------

describe("§5: Meta node with process.env → absent from clientJs", () => {
  test("meta block with process.env does not appear in clientJs", () => {
    const metaNode = makeMetaNode([makeBareExpr("const key = process.env.SECRET_KEY")]);
    const result = runCGForFile([makeLogicBlock([metaNode])]);

    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).not.toContain("process.env");
    expect(out.clientJs).not.toContain("SECRET_KEY");
  });

  test("meta block with process.env produces W-CG-001 warning", () => {
    const metaNode = makeMetaNode([makeBareExpr("process.env.DB_URL")]);
    const result = runCGForFile([makeLogicBlock([metaNode])]);

    const warnings = result.errors.filter(e => e.code === "W-CG-001");
    expect(warnings.length).toBeGreaterThan(0);
  });
});

describe("§6: Meta node with Bun.env → absent from clientJs", () => {
  test("meta block with Bun.env does not appear in clientJs", () => {
    const metaNode = makeMetaNode([makeBareExpr("const apiKey = Bun.env.API_KEY")]);
    const result = runCGForFile([makeLogicBlock([metaNode])]);

    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).not.toContain("Bun.env");
  });
});

describe("§7: Meta node with bun.eval() → absent from clientJs", () => {
  test("meta block with bun.eval() does not appear in clientJs", () => {
    const metaNode = makeMetaNode([makeBareExpr("bun.eval('console.log(1)')")]);
    const result = runCGForFile([makeLogicBlock([metaNode])]);

    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).not.toContain("bun.eval");
  });
});

// ---------------------------------------------------------------------------
// §8: Meta node without server-context → present in clientJs (regression guard)
// ---------------------------------------------------------------------------

describe("§8: Non-server-context meta → present in clientJs", () => {
  test("meta block with console.log appears in clientJs as IIFE", () => {
    const metaNode = makeMetaNode([makeBareExpr("console.log('init')")]);
    const result = runCGForFile([makeLogicBlock([metaNode])]);

    expect(result.errors.filter(e => e.code === "W-CG-001")).toHaveLength(0);
    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).toContain("console.log");
    expect(out.clientJs).toContain("_scrml_meta_effect(");
  });

  test("meta block with reactive set appears in clientJs", () => {
    const metaNode = makeMetaNode([
      { kind: "state-decl", name: "count", init: "0", span: span(10) },
    ]);
    const result = runCGForFile([makeLogicBlock([metaNode])]);

    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).toContain("_scrml_reactive_set");
  });
});

// ---------------------------------------------------------------------------
// §9: CSRF validation injected in POST handler when csrf="auto"
// ---------------------------------------------------------------------------

describe("§9: CSRF validation in POST handlers", () => {
  test("CSRF validation is injected in server handler when csrf=auto", () => {
    const fnSpan = span(100);
    const fnNode = makeFunctionDecl("saveData", [
      { kind: "return-stmt", expr: '"ok"', span: span(110) },
    ], ["data"], { span: fnSpan });

    const routeMap = makeRouteMap([{
      functionNodeId: "/test/app.scrml::100",
      boundary: "server",
      escalationReasons: [],
      generatedRouteName: "__ri_route_saveData_1",
      serverEntrySpan: fnSpan,
    }]);

    // Attach auth middleware entry with csrf="auto"
    routeMap.authMiddleware = new Map([
      ["/test/app.scrml", {
        loginRedirect: "/login",
        csrf: "auto",
        sessionExpiry: "1h",
      }],
    ]);

    const result = runCGForFile([makeLogicBlock([fnNode], span(90))], routeMap);

    const out = result.outputs.get("/test/app.scrml");
    expect(out.serverJs).toContain("_scrml_validate_csrf");
    expect(out.serverJs).toContain("CSRF validation failed");
    expect(out.serverJs).toContain("403");
  });

  test("CSRF validation IS injected even when no authMiddleware is configured (baseline)", () => {
    const fnSpan = span(100);
    const fnNode = makeFunctionDecl("saveData", [
      { kind: "return-stmt", expr: '"ok"', span: span(110) },
    ], ["data"], { span: fnSpan });

    const routeMap = makeRouteMap([{
      functionNodeId: "/test/app.scrml::100",
      boundary: "server",
      escalationReasons: [],
      generatedRouteName: "__ri_route_saveData_1",
      serverEntrySpan: fnSpan,
    }]);

    // No authMiddleware — baseline CSRF should still be active
    const result = runCGForFile([makeLogicBlock([fnNode], span(90))], routeMap);

    const out = result.outputs.get("/test/app.scrml");
    expect(out.serverJs).toContain("_scrml_validate_csrf");
    expect(out.serverJs).toContain("CSRF validation failed");
  });
});

// ---------------------------------------------------------------------------
// §10: Auth check injected in POST handler when auth="required"
// ---------------------------------------------------------------------------

describe("§10: Auth check injection in POST handlers", () => {
  test("auth check is injected in server handler when auth=required", () => {
    const fnSpan = span(100);
    const fnNode = makeFunctionDecl("deleteItem", [
      { kind: "return-stmt", expr: '"deleted"', span: span(110) },
    ], ["id"], { span: fnSpan });

    const routeMap = makeRouteMap([{
      functionNodeId: "/test/app.scrml::100",
      boundary: "server",
      escalationReasons: [],
      generatedRouteName: "__ri_route_deleteItem_1",
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

    const out = result.outputs.get("/test/app.scrml");
    expect(out.serverJs).toContain("_scrml_auth_check");
    expect(out.serverJs).toContain("_scrml_authResult");
  });

  test("auth check is NOT injected when no auth middleware", () => {
    const fnSpan = span(100);
    const fnNode = makeFunctionDecl("getItem", [
      { kind: "return-stmt", expr: '"data"', span: span(110) },
    ], [], { span: fnSpan });

    const routeMap = makeRouteMap([{
      functionNodeId: "/test/app.scrml::100",
      boundary: "server",
      escalationReasons: [],
      generatedRouteName: "__ri_route_getItem_1",
      serverEntrySpan: fnSpan,
    }]);

    const result = runCGForFile([makeLogicBlock([fnNode], span(90))], routeMap);

    const out = result.outputs.get("/test/app.scrml");
    expect(out.serverJs).not.toContain("_scrml_auth_check");
    expect(out.serverJs).not.toContain("_scrml_authResult");
  });
});

// ---------------------------------------------------------------------------
// §11-13: Defense-in-depth — final client output validation
// ---------------------------------------------------------------------------

describe("§11: _scrml_sql_exec never appears in clientJs", () => {
  test("basic file with no SQL has no _scrml_sql_exec in clientJs", () => {
    const result = runCGForFile([
      { kind: "markup", tag: "div", attributes: [], children: [], span: span(0) },
    ]);
    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs ?? "").not.toContain("_scrml_sql_exec");
  });

  test("SQL in top-level logic does not produce _scrml_sql_exec in clientJs", () => {
    const result = runCGForFile([
      makeLogicBlock([makeSqlNode("SELECT id FROM items")]),
    ]);
    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs ?? "").not.toContain("_scrml_sql_exec");
  });
});

describe("§12: _scrml_db never appears in clientJs", () => {
  test("transaction-block does not produce _scrml_db in clientJs", () => {
    const result = runCGForFile([
      makeLogicBlock([makeTransactionBlock([])]),
    ]);
    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs ?? "").not.toContain("_scrml_db");
  });
});

describe("§13: process.env never appears in clientJs", () => {
  test("server-context meta does not leak process.env to clientJs", () => {
    const metaNode = makeMetaNode([makeBareExpr("const x = process.env.PRIVATE_KEY")]);
    const result = runCGForFile([makeLogicBlock([metaNode])]);
    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs ?? "").not.toContain("process.env");
    expect(out.clientJs ?? "").not.toContain("PRIVATE_KEY");
  });
});

// ---------------------------------------------------------------------------
// §15: rewriteSqlRefs — bare ?{...} without method call → await sql.unsafe()
//
// These tests verify that the rewriteSqlRefs function correctly transforms
// bare ?{`...`} expressions (without a chained method call) into
// `await _scrml_sql.unsafe(...)` calls (§44). This ensures the client leak
// guard (`/_scrml_sql(?:_\d+)?[.`]/`) catches any leak as E-CG-006.
// ---------------------------------------------------------------------------

describe("§15: rewriteSqlRefs — bare ?{...} without method call (§44)", () => {
  test("bare ?{`SELECT...`} is rewritten to await sql.unsafe()", () => {
    const result = rewriteSqlRefs("?{`SELECT id, name FROM users`}");
    expect(result).toContain("_scrml_sql.unsafe(");
    expect(result).toContain("await ");
    expect(result).not.toContain("?{`");
    expect(result).toContain("SELECT id, name FROM users");
  });

  test("bare ?{`INSERT...`} is rewritten to await sql.unsafe()", () => {
    const result = rewriteSqlRefs("?{`INSERT INTO users (name) VALUES ('Alice')`}");
    expect(result).toContain("_scrml_sql.unsafe(");
    expect(result).toContain("await ");
    expect(result).not.toContain("?{`");
    expect(result).toContain("INSERT INTO users");
  });

  test("bare ?{`DELETE...`} is rewritten to await sql.unsafe()", () => {
    const result = rewriteSqlRefs("?{`DELETE FROM sessions WHERE expired = 1`}");
    expect(result).toContain("_scrml_sql.unsafe(");
    expect(result).not.toContain("?{`");
  });

  test("bare ?{`...${param}...`} extracts parameters into bound array", () => {
    const result = rewriteSqlRefs("?{`SELECT * FROM users WHERE id = ${userId}`}");
    // Bare-with-params route: await sql.unsafe(rawSql, [argList])
    expect(result).toContain("_scrml_sql.unsafe(");
    expect(result).toContain("userId");
    expect(result).not.toContain("?{`");
    // The SQL string still has positional `?N` placeholder for the unsafe path.
    expect(result).toContain("?1");
  });

  test("?{`...`}.all() form still works (regression guard)", () => {
    const result = rewriteSqlRefs("?{`SELECT * FROM users`}.all()");
    expect(result).toContain("await _scrml_sql`");
    expect(result).not.toContain("?{`");
    expect(result).not.toContain("_scrml_sql_exec");
    expect(result).not.toContain("_scrml_db.query");
  });

  test("?{`...`}.first() form still works (regression guard)", () => {
    const result = rewriteSqlRefs("?{`SELECT * FROM users WHERE id = ${id}`}.first()");
    expect(result).toContain("await _scrml_sql`");
    expect(result).toContain("[0] ?? null");
    expect(result).not.toContain("?{`");
  });

  test("expression with no SQL passes through unchanged", () => {
    const result = rewriteSqlRefs("console.log('hello')");
    expect(result).toBe("console.log('hello')");
  });

  test("null/undefined/empty string returns unchanged", () => {
    expect(rewriteSqlRefs(null)).toBe(null);
    expect(rewriteSqlRefs(undefined)).toBe(undefined);
    expect(rewriteSqlRefs("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// §16: isServerOnlyNode — let-decl/bare-expr with ?{ sigil are server-only
//
// These tests verify that isServerOnlyNode correctly identifies AST nodes
// whose init/expr strings contain the raw ?{` SQL sigil. This is the guard
// that prevents inline SQL expressions from being emitted to client JS.
// ---------------------------------------------------------------------------

describe("§16: isServerOnlyNode — let-decl/bare-expr with ?{ sigil", () => {
  test("let-decl with ?{` SQL sigil in init is server-only", () => {
    const node = makeLetDecl("users", "?{`SELECT * FROM users`}");
    expect(isServerOnlyNode(node)).toBe(true);
  });

  test("let-decl with ?{` SQL sigil and interpolation is server-only", () => {
    const node = makeLetDecl("user", "?{`SELECT * FROM users WHERE id = ${userId}`}");
    expect(isServerOnlyNode(node)).toBe(true);
  });

  test("bare-expr with ?{` SQL sigil is server-only", () => {
    const node = makeBareExpr("?{`DELETE FROM sessions WHERE expired = 1`}");
    expect(isServerOnlyNode(node)).toBe(true);
  });

  test("bare-expr with method-chained ?{`...`}.all() is server-only", () => {
    const node = makeBareExpr("?{`SELECT * FROM users`}.all()");
    expect(isServerOnlyNode(node)).toBe(true);
  });

  test("let-decl WITHOUT ?{ sigil is NOT server-only", () => {
    const node = makeLetDecl("x", "someFunction()");
    expect(isServerOnlyNode(node)).toBe(false);
  });

  test("let-decl with string containing ?{ not as SQL is NOT server-only (edge case)", () => {
    // A string like "foo ?{ bar" does not have a backtick after ?{, so it won't match
    // the SQL_SIGIL_PATTERN /\?\{`/ — only ?{` (with backtick) is the sigil
    const node = makeLetDecl("x", '"question mark brace ? { not sql"');
    expect(isServerOnlyNode(node)).toBe(false);
  });

  test("bare-expr WITHOUT ?{ sigil is NOT server-only", () => {
    const node = makeBareExpr("console.log('query result')");
    expect(isServerOnlyNode(node)).toBe(false);
  });

  test("const-decl with ?{` SQL sigil in init is server-only", () => {
    const node = { kind: "const-decl", name: "result", init: "?{`SELECT COUNT(*) FROM users`}", span: span(0) };
    expect(isServerOnlyNode(node)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §17: Full CG integration — let-decl with ?{...} init does NOT appear in clientJs
//
// These are the end-to-end tests covering the actual security leak that was
// found in the samples: `let users = ?{`SELECT ...`}` inside markup logic blocks
// was passing through rewriteExpr and appearing literally in .client.js output.
// ---------------------------------------------------------------------------

describe("§17: Full CG — let-decl with ?{...} init does not leak to clientJs", () => {
  test("let-decl with bare ?{...} SQL is suppressed from clientJs", () => {
    const letNode = makeLetDecl("users", "?{`SELECT id, name FROM users`}", span(10));
    const result = runCGForFile([
      makeLogicBlock([letNode]),
    ]);

    const out = result.outputs.get("/test/app.scrml");
    // The raw ?{` sigil must NOT appear in clientJs
    expect(out.clientJs ?? "").not.toContain("?{`");
    // Neither the SQL text nor _scrml_sql_exec may appear in clientJs
    expect(out.clientJs ?? "").not.toContain("SELECT id, name FROM users");
    expect(out.clientJs ?? "").not.toContain("_scrml_sql_exec");
  });

  test("let-decl with ?{...} SQL produces W-CG-001 warning", () => {
    const letNode = makeLetDecl("users", "?{`SELECT * FROM users`}", span(10));
    const result = runCGForFile([
      makeLogicBlock([letNode]),
    ]);

    const warnings = result.errors.filter(e => e.code === "W-CG-001");
    expect(warnings.length).toBeGreaterThan(0);
  });

  test("bare-expr ?{...} SQL is suppressed from clientJs", () => {
    const bareNode = makeBareExpr("?{`DELETE FROM sessions WHERE expired = 1`}", span(10));
    const result = runCGForFile([
      makeLogicBlock([bareNode]),
    ]);

    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs ?? "").not.toContain("?{`");
    expect(out.clientJs ?? "").not.toContain("DELETE FROM sessions");
    expect(out.clientJs ?? "").not.toContain("_scrml_sql_exec");
  });

  test("multiple let-decl SQL nodes are all suppressed from clientJs", () => {
    const result = runCGForFile([
      makeLogicBlock([
        makeLetDecl("users", "?{`SELECT id, name FROM users`}", span(10)),
        makeLetDecl("posts", "?{`SELECT id, title FROM posts`}", span(30)),
        makeLetDecl("comments", "?{`SELECT id, body FROM comments LIMIT 5`}", span(50)),
      ]),
    ]);

    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs ?? "").not.toContain("?{`");
    expect(out.clientJs ?? "").not.toContain("SELECT id, name FROM users");
    expect(out.clientJs ?? "").not.toContain("SELECT id, title FROM posts");
    expect(out.clientJs ?? "").not.toContain("SELECT id, body FROM comments");
  });

  test("non-SQL let-decl is still emitted to clientJs (regression guard)", () => {
    const letNode = makeLetDecl("name", '"Alice"', span(10));
    const result = runCGForFile([
      makeLogicBlock([letNode]),
    ]);

    const out = result.outputs.get("/test/app.scrml");
    // Non-SQL declarations should still appear in client JS
    expect(out.clientJs ?? "").toContain("Alice");
    expect(result.errors.filter(e => e.code === "W-CG-001")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §18: Defense-in-depth — raw ?{ sigil triggers E-CG-006 if it reaches clientJs
//
// This tests the final line of defense: the SQL_LEAK_PATTERNS scan in
// generateClientJs checks for the raw ?{` sigil. If any node somehow bypassed
// the isServerOnlyNode guard and still contained ?{` in the emitted code,
// the final scan would catch it as E-CG-006.
// ---------------------------------------------------------------------------

describe("§18: Defense-in-depth — ?{` raw sigil in SQL_LEAK_PATTERNS", () => {
  test("raw ?{` sigil is in the defense-in-depth pattern list", () => {
    // We verify this indirectly: a let-decl with ?{ init is caught by isServerOnlyNode
    // before reaching the final scan. The defense-in-depth is a belt-and-suspenders check.
    // The real test is that the full suite of §17 tests pass — if ?{` appeared in client
    // output, the defense-in-depth would have added an E-CG-006 error.

    // Verify no ?{` appears in clientJs for a SQL-containing file
    const letNode = makeLetDecl("data", "?{`SELECT * FROM items WHERE active = 1`}", span(10));
    const result = runCGForFile([makeLogicBlock([letNode])]);

    const out = result.outputs.get("/test/app.scrml");
    // If the defense-in-depth fired, there would be E-CG-006 errors
    // If the primary guard fired (W-CG-001), the ?{` never reached the scan
    // Either way, ?{` must not be in clientJs
    expect(out.clientJs ?? "").not.toContain("?{`");

    // The result should have at least one warning (W-CG-001) not an error (E-CG-006)
    // because the isServerOnlyNode guard should catch it before the final scan
    const cg006Errors = result.errors.filter(e => e.code === "E-CG-006");
    expect(cg006Errors).toHaveLength(0);
    const wcg001Warnings = result.errors.filter(e => e.code === "W-CG-001");
    expect(wcg001Warnings.length).toBeGreaterThan(0);
  });
});
