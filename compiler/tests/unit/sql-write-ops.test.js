/**
 * SQL Write Operations — Unit Tests (SPEC §44 Bun.SQL emission)
 *
 * Tests for write-operation codegen: INSERT, UPDATE, DELETE via .run(),
 * .prepare() now compiles to E-SQL-006 (§44.3), and transaction-block
 * emission uses sql.unsafe() per §44.6 deferred-transaction workaround.
 *
 * Output shape (§44.3):
 *   .run() / bare-with-params → await _scrml_sql`SQL ${param}`;
 *   bare DDL                  → await _scrml_sql.unsafe("SQL");
 *   .prepare()                → E-SQL-006 (compile error + runtime IIFE)
 *
 * Coverage:
 *   §1  INSERT with .run() — params preserved as ${} slots
 *   §2  UPDATE with .run() — multi-param
 *   §3  DELETE with .run() — single param
 *   §4  Static DDL with no chained call — falls through to sql.unsafe()
 *   §5  .prepare() — emits E-SQL-006 compile error (§44.3)
 *   §6  .prepare() static SQL — same E-SQL-006 path
 *   §7  .prepare() with multiple params — same E-SQL-006 path
 *   §8  .run() return value — passthrough (no compiler wrapping)
 *   §9  emitLogicNode sql node — INSERT .run() codegen
 *   §10 emitLogicNode sql node — .prepare() emits IIFE that throws
 *   §11 transaction-block emit — BEGIN / COMMIT / ROLLBACK via sql.unsafe()
 *   §12 transaction-block emit — write stmts inside use Bun.SQL form
 *   §13 rewriteExpr integration — .run() and .prepare() in full pipeline
 *   §14 route inference — sql node triggers server escalation
 *   §15 @var in SQL params — server path (rewriteServerExpr)
 *   §16 explicit call.args @var rewriting — emitLogicNode
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { rewriteSqlRefs, rewriteExpr, rewriteServerExpr, serverRewriteEmitted } from "../../src/codegen/rewrite.js";
import { emitLogicNode } from "../../src/codegen/emit-logic.js";
import { setProgramBodySqlPolicy } from "../../src/codegen/sql-one-statement-guard.ts";

// ---------------------------------------------------------------------------
// §1  INSERT with .run()
// ---------------------------------------------------------------------------

describe("§1 INSERT with .run() — Bun.SQL tagged template", () => {
  test("INSERT with two params", () => {
    const input = "?{`INSERT INTO users (name, email) VALUES (${name}, ${email})`}.run()";
    const output = rewriteSqlRefs(input);
    expect(output).toBe('await _scrml_sql`INSERT INTO users (name, email) VALUES (${name}, ${email})`');
  });

  test("INSERT with one param", () => {
    const input = "?{`INSERT INTO sessions (token) VALUES (${token})`}.run()";
    const output = rewriteSqlRefs(input);
    expect(output).toBe('await _scrml_sql`INSERT INTO sessions (token) VALUES (${token})`');
  });

  test("INSERT output preserves ${} slots — bound at driver layer (§44.5)", () => {
    const input = "?{`INSERT INTO logs (msg) VALUES (${msg})`}.run()";
    const output = rewriteSqlRefs(input);
    // The ${msg} slot stays — Bun binds it as a positional parameter.
    expect(output).toContain("${msg}");
    // No double-quoted SQL string (no string-interp shape).
    expect(output).not.toContain('"INSERT');
  });

  test("INSERT static (no params) — bare tagged template", () => {
    const input = "?{`INSERT INTO defaults (key, val) VALUES ('lang', 'en')`}.run()";
    const output = rewriteSqlRefs(input);
    expect(output).toBe("await _scrml_sql`INSERT INTO defaults (key, val) VALUES ('lang', 'en')`");
  });
});

// ---------------------------------------------------------------------------
// §2  UPDATE with .run()
// ---------------------------------------------------------------------------

describe("§2 UPDATE with .run() — multi-param", () => {
  test("UPDATE with two params", () => {
    const input = "?{`UPDATE users SET email = ${email} WHERE id = ${id}`}.run()";
    const output = rewriteSqlRefs(input);
    expect(output).toBe('await _scrml_sql`UPDATE users SET email = ${email} WHERE id = ${id}`');
  });

  test("UPDATE with three params", () => {
    const input = "?{`UPDATE posts SET title = ${title}, body = ${body} WHERE id = ${id}`}.run()";
    const output = rewriteSqlRefs(input);
    expect(output).toBe('await _scrml_sql`UPDATE posts SET title = ${title}, body = ${body} WHERE id = ${id}`');
  });
});

// ---------------------------------------------------------------------------
// §3  DELETE with .run()
// ---------------------------------------------------------------------------

describe("§3 DELETE with .run() — single param", () => {
  test("DELETE by primary key", () => {
    const input = "?{`DELETE FROM users WHERE id = ${userId}`}.run()";
    const output = rewriteSqlRefs(input);
    expect(output).toBe('await _scrml_sql`DELETE FROM users WHERE id = ${userId}`');
  });

  test("DELETE by token string", () => {
    const input = "?{`DELETE FROM sessions WHERE token = ${tok}`}.run()";
    const output = rewriteSqlRefs(input);
    expect(output).toBe('await _scrml_sql`DELETE FROM sessions WHERE token = ${tok}`');
  });
});

// ---------------------------------------------------------------------------
// §4  Static DDL — no chained call — falls through to sql.unsafe()
// ---------------------------------------------------------------------------

describe("§4 static DDL without method call — sql.unsafe()", () => {
  test("bare DDL statement routes to sql.unsafe()", () => {
    const input = "?{`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY)`}";
    const output = rewriteSqlRefs(input);
    expect(output).toBe('await _scrml_sql.unsafe("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY)")');
  });

  test("bare DDL uses sql.unsafe(), not legacy helper", () => {
    const input = "?{`CREATE INDEX idx_email ON users (email)`}";
    const output = rewriteSqlRefs(input);
    expect(output).not.toContain("_scrml_db");
    expect(output).not.toContain("_scrml_sql_exec");
    expect(output).toContain("_scrml_sql.unsafe(");
  });
});

// ---------------------------------------------------------------------------
// §5  .prepare() — emits E-SQL-006 (§44.3)
// ---------------------------------------------------------------------------

describe("§5 .prepare() — E-SQL-006 compile error (§44.3)", () => {
  test("INSERT with params — .prepare() emits runtime-throwing IIFE", () => {
    const input = "?{`INSERT INTO users (n, e) VALUES (${n}, ${e})`}.prepare()";
    const output = rewriteSqlRefs(input);
    expect(output).toContain("E-SQL-006");
    expect(output).toContain("throw new Error");
    // Defense in depth: no _scrml_sql.prepare() leaks into the output
    expect(output).not.toContain("_scrml_sql.prepare(");
    expect(output).not.toContain("_scrml_db.prepare(");
  });

  test("SELECT with param — .prepare() emits the same E-SQL-006 marker", () => {
    const input = "?{`SELECT * FROM users WHERE id = ${id}`}.prepare()";
    const output = rewriteSqlRefs(input);
    expect(output).toContain("E-SQL-006");
    expect(output).toContain("§44.3");
  });

  test(".prepare() pushes E-SQL-006 onto errors[]", () => {
    const input = "?{`INSERT INTO t (a, b) VALUES (${x}, ${y})`}.prepare()";
    const errors = [];
    rewriteSqlRefs(input, "_scrml_sql", errors);
    expect(errors.length).toBe(1);
    expect(errors[0].code).toBe("E-SQL-006");
  });
});

// ---------------------------------------------------------------------------
// §6  .prepare() static SQL — still E-SQL-006
// ---------------------------------------------------------------------------

describe("§6 .prepare() with static SQL — E-SQL-006 (§44.3)", () => {
  test("static SELECT — prepare emits E-SQL-006", () => {
    const input = "?{`SELECT * FROM config WHERE active = 1`}.prepare()";
    const output = rewriteSqlRefs(input);
    expect(output).toContain("E-SQL-006");
  });
});

// ---------------------------------------------------------------------------
// §7  .prepare() — multi-param case is same E-SQL-006 path
// ---------------------------------------------------------------------------

describe("§7 .prepare() with multiple params — E-SQL-006 (§44.3)", () => {
  test("three params — same E-SQL-006 emission path", () => {
    const input = "?{`UPDATE posts SET a = ${a}, b = ${b}, c = ${c}`}.prepare()";
    const output = rewriteSqlRefs(input);
    expect(output).toContain("E-SQL-006");
    expect(output).not.toContain("_scrml_sql.prepare(");
  });
});

// ---------------------------------------------------------------------------
// §8  .run() return value — passthrough (no compiler wrapping)
// ---------------------------------------------------------------------------

describe("§8 .run() return value is driver passthrough", () => {
  test(".run() output is the bare await tagged template", () => {
    const input = "?{`INSERT INTO users (nm) VALUES (${nm})`}.run()";
    const output = rewriteSqlRefs(input);
    expect(output).toBe('await _scrml_sql`INSERT INTO users (nm) VALUES (${nm})`');
    // No extra wrapping helpers.
    expect(output).not.toContain("_scrml_run_result");
    expect(output).not.toContain("_scrml_wrap");
  });
});

// ---------------------------------------------------------------------------
// §9  emitLogicNode sql node — INSERT .run() codegen
// ---------------------------------------------------------------------------

describe("§9 emitLogicNode — INSERT sql node with .run() chained call", () => {
  test("sql node with .run() chained call emits await tagged template", () => {
    const node = {
      kind: "sql",
      query: "INSERT INTO users (name, email) VALUES (${name}, ${email})",
      chainedCalls: [{ method: "run" }],
    };
    const output = emitLogicNode(node);
    expect(output).toBe('await _scrml_sql`INSERT INTO users (name, email) VALUES (${name}, ${email})`;');
  });

  test("sql node with .run() — output uses Bun.SQL tag form", () => {
    const node = {
      kind: "sql",
      query: "UPDATE posts SET title = ${title} WHERE id = ${id}",
      chainedCalls: [{ method: "run" }],
    };
    const output = emitLogicNode(node);
    expect(output).toBe('await _scrml_sql`UPDATE posts SET title = ${title} WHERE id = ${id}`;');
  });

  test("sql node without chained call and with params defaults to await form", () => {
    const node = {
      kind: "sql",
      query: "DELETE FROM sessions WHERE tok = ${tok}",
      chainedCalls: [],
    };
    const output = emitLogicNode(node);
    expect(output).toBe('await _scrml_sql`DELETE FROM sessions WHERE tok = ${tok}`;');
  });
});

// ---------------------------------------------------------------------------
// §10  emitLogicNode sql node — .prepare() codegen
// ---------------------------------------------------------------------------

describe("§10 emitLogicNode — sql node with .prepare() chained call emits E-SQL-006 IIFE", () => {
  test(".prepare() emits a runtime-throwing IIFE (§44.3)", () => {
    const node = {
      kind: "sql",
      query: "INSERT INTO users (name) VALUES (?1)",
      chainedCalls: [{ method: "prepare" }],
    };
    const output = emitLogicNode(node);
    expect(output).toContain("E-SQL-006");
    expect(output).toContain("throw new Error");
    expect(output).not.toContain("_scrml_sql.prepare(");
    expect(output).not.toContain("_scrml_db.prepare(");
  });
});

// ---------------------------------------------------------------------------
// §11  transaction-block emit — BEGIN / COMMIT / ROLLBACK via sql.unsafe()
// ---------------------------------------------------------------------------

describe("§11 transaction-block — BEGIN/COMMIT/ROLLBACK via sql.unsafe() (§44.6)", () => {
  test("empty transaction block emits BEGIN and COMMIT via sql.unsafe()", () => {
    const node = {
      kind: "transaction-block",
      body: [],
    };
    const output = emitLogicNode(node);
    expect(output).toContain('await _scrml_sql.unsafe("BEGIN")');
    expect(output).toContain('await _scrml_sql.unsafe("COMMIT")');
    expect(output).toContain('await _scrml_sql.unsafe("ROLLBACK")');
  });

  test("transaction block has try/catch structure", () => {
    const node = {
      kind: "transaction-block",
      body: [],
    };
    const output = emitLogicNode(node);
    expect(output).toContain("try {");
    expect(output).toContain("} catch (");
    expect(output).toContain("throw _scrml_txn_err");
  });

  // S450: the block's exits are COMMIT on normal completion (inside `try`) and a
  // ROLLBACK on every other exit — a `finally` guarded by the open flag, plus the
  // rollback closure a marked `fail` / `?` calls before its return. No ROLLBACK
  // runs on the normal-completion path between BEGIN and COMMIT.
  test("COMMIT is on the normal path; the backstop ROLLBACK is in the finally block", () => {
    const node = {
      kind: "transaction-block",
      body: [],
    };
    const output = emitLogicNode(node);
    const lines = output.split("\n");
    const tryLine = lines.findIndex(l => l.trim() === "try {");
    const commitLine = lines.findIndex(l => l.includes('unsafe("COMMIT")'));
    const catchLine = lines.findIndex(l => l.includes("} catch ("));
    const finallyLine = lines.findIndex(l => l.includes("} finally {"));
    const backstop = lines.findIndex((l, i) => i > finallyLine && l.includes('unsafe("ROLLBACK")'));
    expect(tryLine).toBeGreaterThan(-1);
    expect(commitLine).toBeGreaterThan(tryLine);
    expect(commitLine).toBeLessThan(catchLine);
    expect(finallyLine).toBeGreaterThan(catchLine);
    expect(backstop).toBeGreaterThan(finallyLine);
    // nothing between `try {` and COMMIT issues a ROLLBACK
    expect(lines.slice(tryLine, commitLine).some(l => l.includes('unsafe("ROLLBACK")'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §12  transaction-block — write stmts inside are tagged-template form
// ---------------------------------------------------------------------------

describe("§12 transaction-block — inner SQL stmts use Bun.SQL form", () => {
  test("two sql nodes inside transaction emit tagged templates", () => {
    const node = {
      kind: "transaction-block",
      body: [
        {
          kind: "sql",
          query: "UPDATE accounts SET balance = balance - ${amt} WHERE id = ${fromId}",
          chainedCalls: [{ method: "run" }],
        },
        {
          kind: "sql",
          query: "UPDATE accounts SET balance = balance + ${amt} WHERE id = ${toId}",
          chainedCalls: [{ method: "run" }],
        },
      ],
    };
    const output = emitLogicNode(node);
    expect(output).toContain("_scrml_sql`UPDATE accounts SET balance = balance - ${amt} WHERE id = ${fromId}`");
    expect(output).toContain("_scrml_sql`UPDATE accounts SET balance = balance + ${amt} WHERE id = ${toId}`");
    expect(output).toContain('await _scrml_sql.unsafe("BEGIN")');
    expect(output).toContain('await _scrml_sql.unsafe("COMMIT")');
  });
});

// ---------------------------------------------------------------------------
// §13  rewriteExpr integration
// ---------------------------------------------------------------------------

describe("§13 rewriteExpr integration — write ops in full pipeline", () => {
  test("INSERT .run() passes through rewriteExpr correctly", () => {
    const input = "?{`INSERT INTO users (nm) VALUES (${nm})`}.run()";
    const output = rewriteExpr(input);
    expect(output).toBe('await _scrml_sql`INSERT INTO users (nm) VALUES (${nm})`');
  });

  test(".prepare() in rewriteExpr emits E-SQL-006 marker", () => {
    const input = "const stmt = ?{`INSERT INTO t (a, b) VALUES (${p1}, ${p2})`}.prepare()";
    const output = rewriteExpr(input);
    expect(output).toContain("E-SQL-006");
    expect(output).toContain("const stmt = ");
  });

  test("DELETE .run() with reactive ref param", () => {
    const input = "?{`DELETE FROM sessions WHERE user_id = ${@userId}`}.run()";
    const output = rewriteExpr(input);
    // @userId rewritten to _scrml_reactive_get and lives inside the ${} slot
    expect(output).toContain('_scrml_reactive_get("userId")');
    expect(output).toContain("_scrml_sql`DELETE FROM sessions WHERE user_id = ${");
  });
});

// ---------------------------------------------------------------------------
// §14  route inference — sql node triggers server escalation
// ---------------------------------------------------------------------------

import { isServerOnlyNode } from "../../src/codegen/collect.js";

describe("§14 route inference — sql nodes are server-only", () => {
  test("sql node with .run() is server-only", () => {
    const node = { kind: "sql", query: "INSERT INTO users (name) VALUES (?1)", chainedCalls: [{ method: "run" }] };
    expect(isServerOnlyNode(node)).toBe(true);
  });

  test("sql node with .prepare() is still server-only (compile-error path)", () => {
    const node = { kind: "sql", query: "INSERT INTO users (name) VALUES (?1)", chainedCalls: [{ method: "prepare" }] };
    expect(isServerOnlyNode(node)).toBe(true);
  });

  test("sql node with no chained call is server-only", () => {
    const node = { kind: "sql", query: "DELETE FROM sessions WHERE id = ?1", chainedCalls: [] };
    expect(isServerOnlyNode(node)).toBe(true);
  });

  test("transaction-block is server-only", () => {
    const node = { kind: "transaction-block", body: [] };
    expect(isServerOnlyNode(node)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §15  @var rewriting in SQL params — server path (rewriteServerExpr)
// ---------------------------------------------------------------------------

describe("§15 @var in SQL template params — server path (rewriteServerExpr)", () => {
  test("@var in INSERT template params is rewritten to _scrml_body on server path", () => {
    const input = "?{`INSERT INTO tasks (title, cat) VALUES (${@newTask}, ${@selectedCat})`}.run()";
    const output = rewriteServerExpr(input);
    // @vars are rewritten into the ${} slots which Bun.SQL binds.
    expect(output).toContain('_scrml_body["newTask"]');
    expect(output).toContain('_scrml_body["selectedCat"]');
    expect(output).toContain("_scrml_sql`INSERT INTO tasks (title, cat) VALUES (${");
    expect(output).toContain("await ");
  });

  test("@var in SELECT template param — .all()", () => {
    const input = "?{`SELECT * FROM posts WHERE author = ${@userId}`}.all()";
    const output = rewriteServerExpr(input);
    expect(output).toContain('_scrml_body["userId"]');
    expect(output).toContain("_scrml_sql`SELECT * FROM posts WHERE author = ${");
    expect(output.startsWith("await ")).toBe(true);
  });

  test("@var in SELECT template param — .get() emits the single-row helper", () => {
    const input = "?{`SELECT * FROM users WHERE id = ${@userId}`}.get()";
    const output = rewriteServerExpr(input);
    expect(output).toContain('_scrml_body["userId"]');
    expect(output).toContain("[0] ?? null");
    expect(output.startsWith("(await ")).toBe(true);
  });

  test("@var in UPDATE template params is rewritten on server path", () => {
    const input = "?{`UPDATE users SET email = ${@email} WHERE id = ${@id}`}.run()";
    const output = rewriteServerExpr(input);
    expect(output).toContain('_scrml_body["email"]');
    expect(output).toContain('_scrml_body["id"]');
    expect(output).toContain("await _scrml_sql`UPDATE users SET email = ${");
  });

  test("@var in DELETE template param is rewritten on server path", () => {
    const input = "?{`DELETE FROM sessions WHERE token = ${@token}`}.run()";
    const output = rewriteServerExpr(input);
    expect(output).toContain('_scrml_body["token"]');
    expect(output).toContain("await _scrml_sql`DELETE FROM sessions WHERE token = ${");
  });

  test("output does not contain raw @var after server rewrite", () => {
    const input = "?{`INSERT INTO t (a, b) VALUES (${@x}, ${@y})`}.run()";
    const output = rewriteServerExpr(input);
    expect(output).not.toContain("@x");
    expect(output).not.toContain("@y");
    expect(output).toContain('_scrml_body["x"]');
    expect(output).toContain('_scrml_body["y"]');
  });
});

// ---------------------------------------------------------------------------
// §16  explicit call.args @var rewriting — emitLogicNode (fix-sql-param-rewrite)
// ---------------------------------------------------------------------------

describe("§16 call.args @var rewriting — emitLogicNode with explicit .run(@var) args", () => {
  // A bare `?` placeholder is outside the §14.8.10 item (1) closed lexical subset: in a
  // compilation WITH a database it is refused (at the TENANT-SCHEMA stage, and — S457 — at the
  // lowering). The legacy `?` + call.args path is reached only in a database-less compilation,
  // which these tests now say explicitly (an emitter driven with no policy fails closed).
  beforeEach(() => setProgramBodySqlPolicy({ hasDatabase: false, tenantTables: [] }));
  afterEach(() => setProgramBodySqlPolicy(null));

  test("S457: in a compilation with a database the bare-? lowering is refused (nothing sent)", () => {
    setProgramBodySqlPolicy({ hasDatabase: true, tenantTables: [] });
    const node = {
      kind: "sql",
      query: "SELECT * FROM users WHERE id = ?",
      chainedCalls: [{ method: "run", args: "@userId" }],
    };
    const output = emitLogicNode(node);
    expect(output).not.toContain("_scrml_sql.unsafe(");
    expect(output).toContain("E-SQL-PROGRAM-STATEMENT-NOT-ADMITTED");
  });

  test("sql node with bare ? placeholder and @var in call.args — args not dropped", () => {
    const node = {
      kind: "sql",
      query: "SELECT * FROM users WHERE id = ?",
      chainedCalls: [{ method: "run", args: "@userId" }],
    };
    const output = emitLogicNode(node);
    // Bare ? + call.args path → emit await sql.unsafe(rawSql, [argList])
    expect(output).toContain("userId");
    expect(output).toContain("_scrml_sql.unsafe(");
    expect(output).toContain("await ");
  });

  test("sql node with bare ? and @var call.args — serverRewriteEmitted converts to body lookup", () => {
    const node = {
      kind: "sql",
      query: "DELETE FROM sessions WHERE id = ?",
      chainedCalls: [{ method: "run", args: "@sessionId" }],
    };
    const emitted = emitLogicNode(node);
    const serverOut = serverRewriteEmitted(emitted);
    expect(serverOut).toContain('_scrml_body["sessionId"]');
    expect(serverOut).not.toContain("@sessionId");
  });

  test("sql node with template params takes precedence over empty call.args", () => {
    const node = {
      kind: "sql",
      query: "INSERT INTO t (a) VALUES (${val})",
      chainedCalls: [{ method: "run", args: "" }],
    };
    const output = emitLogicNode(node);
    expect(output).toBe('await _scrml_sql`INSERT INTO t (a) VALUES (${val})`;');
  });

  test("sql node with empty call.args and no template params — bare unsafe call", () => {
    const node = {
      kind: "sql",
      query: "DELETE FROM logs WHERE done = 1",
      chainedCalls: [{ method: "run", args: "" }],
    };
    const output = emitLogicNode(node);
    // Branch C (no params, no call.args) — bare tagged template
    expect(output).toBe('await _scrml_sql`DELETE FROM logs WHERE done = 1`;');
  });
});
