/**
 * §8.1.2 (S456) — one SQL statement per program-body `?{}` (E-SQL-MULTIPLE-STATEMENTS), and the
 * codegen defence in depth (an emitted query site never sends a multi-statement string).
 *
 * Ruling: user-voice-scrml.md S456 "one statement per seams reasonable. push". Gap
 * g-tenant-set-config-in-program-body-s456 (CONFIRMED on PG16, S239 r5):
 * `?{ SELECT set_config('scrml.tenant','B',true); select … from invoices }.acrossTenants()` compiled
 * clean and returned tenant B's rows to a tenant-A request under the §14.8.11 tier. Every `neg`
 * shape below compiled clean on bef93f984 (docs/changes/s456-one-statement-per-sql-block/progress.md).
 * The live-Postgres half is compiler/tests/integration/sql-one-statement-pg.test.js.
 */

import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { SQL } from "bun";
import { compileScrml } from "../../src/api.js";
import { programStatementCount } from "../../src/schema-differ.js";
import { programBodyMultipleStatements } from "../../src/sql-one-statement.ts";
import { sqlHoldsOneStatement, multipleStatementsThrowExpr } from "../../src/codegen/sql-one-statement-guard.ts";
import { rewriteSqlRefs } from "../../src/codegen/rewrite.ts";
import { emitLogicNode } from "../../src/codegen/emit-logic.ts";

const BT = "`";
const CODE = "E-SQL-MULTIPLE-STATEMENTS";

function compile(source) {
  const dir = mkdtempSync(join(tmpdir(), "s456-one-stmt-"));
  try {
    const file = join(dir, "app.scrml");
    writeFileSync(file, source);
    const r = compileScrml({ inputFiles: [file], write: false, gather: true, log: () => {} });
    const errors = (r.errors ?? []).filter((e) => e.severity !== "warning" && !/^[WI]-/.test(e.code ?? ""));
    let serverJs = "";
    for (const out of r.outputs?.values() ?? []) if (out?.serverJs) serverJs += out.serverJs;
    return { codes: errors.map((e) => e.code), errors, serverJs };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The S239 r5 program: a §14.8.11 tier (Postgres, db-authoritative) or a plain SQLite program. */
const tierApp = (q, { db = "postgres://localhost/app", marker = " db-authoritative" } = {}) => `<program db="${db}">
  <schema>
    invoices {
      id: text primary key
      tenant_id: text not null
      amount: real not null
    }${marker}
  </schema>

  function listInvoices() {
    const rows = ${q}
    rows
  }
</program>`;

describe("programStatementCount — the §14.8.10 token walk counts statements", () => {
  const n = (sql) => programStatementCount(sql).statements;
  test("one statement, with or without a single trailing `;` (whitespace and comments after it)", () => {
    expect(n("SELECT 1")).toBe(1);
    expect(n("SELECT 1;")).toBe(1);
    expect(n("SELECT 1 ;  \n")).toBe(1);
    expect(n("SELECT 1; -- done\n")).toBe(1);
    expect(n("SELECT 1; /* done */")).toBe(1);
    expect(n("")).toBe(0);
    expect(n(";")).toBe(0);
  });
  test("a `;` followed by any token separates a second statement — `;;` and a leading `;` included", () => {
    expect(n("SELECT set_config('scrml.tenant','B',true); select id from invoices")).toBe(2);
    expect(n("SELECT 1;;")).toBe(2);
    expect(n("; SELECT 1")).toBe(2);
    expect(n("SELECT 1; SELECT 2; SELECT 3")).toBe(3);
    expect(n("SELECT ${a}; ${b}")).toBe(2);
    expect(n("SELECT (1; 2)")).toBe(2); // inside parentheses too — no admitted statement holds one
    expect(n("SELECT 1; -- c\nSELECT 2")).toBe(2);
  });
  test("a `;` inside a literal, a quoted identifier, a comment or a `${…}` slot is not a separator", () => {
    expect(n("SELECT 'a;b' AS x")).toBe(1);
    expect(n('SELECT 1 AS "a;b"')).toBe(1);
    expect(n("SELECT 1 /* ; SELECT 2 */")).toBe(1);
    expect(n("SELECT 1 -- ; SELECT 2\n")).toBe(1);
    expect(n("SELECT ${f(1); g()} AS x")).toBe(1);
  });
  test("a body outside the closed lexical subset is not counted (it is refused by §14.8.10 item (1))", () => {
    const r = programStatementCount("SELECT $1; SELECT 2");
    expect(r.unreadable).not.toBe(null);
    expect(r.statements).toBe(0);
  });
});

describe("E-SQL-MULTIPLE-STATEMENTS — compile (the S239 r5 shapes)", () => {
  const R5 = {
    "tenant re-pin, .acrossTenants()": "?{ SELECT set_config('scrml.tenant','B',true); select id, tenant_id, amount from invoices }.acrossTenants()",
    "role reset, .acrossTenants()": "?{ SELECT set_config('role','none',true); select id, tenant_id, amount from invoices }.acrossTenants()",
    "role reset, .acrossTenants().all()": "?{ SELECT set_config('role','none',true); select id, tenant_id, amount from invoices }.acrossTenants().all()",
    "tenant re-pin, no opt-out": "?{ SELECT set_config('scrml.tenant','B',true); select id, tenant_id, amount from invoices }",
    "role reset, no opt-out": "?{ SELECT set_config('role','none',true); select id, tenant_id, amount from invoices }",
  };
  for (const [name, q] of Object.entries(R5)) {
    test(`refused under the §14.8.11 tier — ${name}`, () => {
      const r = compile(tierApp(q));
      expect(r.codes).toContain(CODE);
      expect(r.codes.filter((c) => c === CODE).length).toBe(1);
      const e = r.errors.find((x) => x.code === CODE);
      expect(e.message).toContain("holds 2 SQL statements");
      expect(e.message).toContain("one `?{}` per");
      expect(e.message).toContain("transaction { }");
    });
  }
  test("refused in a plain SQLite program too (the rule is language-wide, not tenant-only)", () => {
    const r = compile(`<program db="./app.db">
    \${
        function setup() {
            ?{${BT}INSERT INTO log (msg) VALUES ('a'); INSERT INTO log (msg) VALUES ('b')${BT}}.run()
            return 1
        }
    }
    <button onclick=\${ setup() }>s</button>
</program>
`);
    expect(r.codes).toEqual([CODE]);
  });
  test("expression-position `?{}` (a sql-ref) is read too", () => {
    const fileAST = { nodes: [{ kind: "sql-ref", raw: "?{`SELECT 1; SELECT 2`}", span: { start: 3 } }] };
    expect(programBodyMultipleStatements(fileAST).map((d) => d.code)).toEqual([CODE]);
  });
  test("control: one statement with a trailing `;` compiles clean", () => {
    const r = compile(tierApp("?{ select id, tenant_id, amount from invoices; }.acrossTenants()"));
    expect(r.codes).not.toContain(CODE);
    expect(r.codes).toEqual([]);
  });
  test("control: a `<schema>` body holds many statements — it is the declaration, not a program body", () => {
    const r = compile(`<program db="./app.db">
    <schema>
        ?{${BT}CREATE TABLE a (id INTEGER PRIMARY KEY, name TEXT); CREATE TABLE b (id INTEGER PRIMARY KEY, a_id INTEGER)${BT}}
    </schema>
    \${
        function rows() {
            return ?{${BT}SELECT id, name FROM a;${BT}}.all()
        }
    }
    <button onclick=\${ rows() }>s</button>
</program>
`);
    expect(r.codes).toEqual([]);
  });
});

describe("codegen defence in depth — a multi-statement body never reaches the driver", () => {
  const MULTI = "INSERT INTO log (msg) VALUES ('a'); INSERT INTO log (msg) VALUES ('b')";
  test("sqlHoldsOneStatement: the token walk, and a conservative reading outside the lexical subset", () => {
    expect(sqlHoldsOneStatement("SELECT 1;")).toBe(true);
    expect(sqlHoldsOneStatement(MULTI)).toBe(false);
    expect(sqlHoldsOneStatement("SELECT * FROM t WHERE a = ?")).toBe(true);
    expect(sqlHoldsOneStatement("SELECT * FROM t WHERE a = ?;")).toBe(true);
    expect(sqlHoldsOneStatement("SELECT ?; DELETE FROM t")).toBe(false);
  });
  test("rewriteSqlRefs (text path): bare, chained and `.acrossTenants()` forms emit the fail-closed throw", () => {
    for (const src of [`?{${BT}${MULTI}${BT}}`, `?{${BT}${MULTI}${BT}}.run()`, `?{${BT}${MULTI}${BT}}.acrossTenants()`]) {
      const out = rewriteSqlRefs(src, "_scrml_sql");
      expect(out).toBe(multipleStatementsThrowExpr());
      expect(out).not.toContain("unsafe");
    }
    expect(rewriteSqlRefs(`?{${BT}SELECT 1;${BT}}`, "_scrml_sql")).toContain(`_scrml_sql.unsafe("SELECT 1;")`);
  });
  test("emitLogicNode case \"sql\" (structured path): every branch emits the throw, single statements unchanged", () => {
    const node = (query, chainedCalls) => ({ kind: "sql", query, chainedCalls, span: { start: 0, end: 0 } });
    const opts = { boundary: "server", dbVar: "_scrml_sql" };
    for (const calls of [[], [{ method: "run" }], [{ method: "all" }], [{ method: "acrossTenants" }]]) {
      expect(emitLogicNode(node(MULTI, calls), opts)).toBe(`${multipleStatementsThrowExpr()};`);
      expect(emitLogicNode(node("INSERT INTO log (msg) VALUES (${m}); SELECT 1", calls), opts)).toBe(`${multipleStatementsThrowExpr()};`);
    }
    expect(emitLogicNode(node("INSERT INTO log (msg) VALUES ('a');", []), opts)).toContain(`_scrml_sql.unsafe(`);
  });
  test("executed on Bun.SQL sqlite: the base emission ran BOTH inserts; the guarded emission throws and sends nothing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "s456-one-stmt-db-"));
    const sql = new SQL(`sqlite://${join(dir, "a.db")}`);
    try {
      await sql.unsafe("CREATE TABLE log (msg TEXT)");
      const count = async () => (await sql.unsafe("SELECT count(*) AS n FROM log"))[0].n;
      // The pre-S456 emission (`await _scrml_sql.unsafe("…")`): the SQLite adapter runs the second statement.
      await sql.unsafe(MULTI);
      expect(await count()).toBe(2);
      // The guarded emission, evaluated as emitted.
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
      const emitted = rewriteSqlRefs(`?{${BT}${MULTI}${BT}}`, "_scrml_sql");
      const run = new AsyncFunction("_scrml_sql", `return ${emitted};`);
      await expect(run(sql)).rejects.toThrow(CODE);
      expect(await count()).toBe(2);
      // A single statement with a trailing `;` still runs.
      const one = new AsyncFunction("_scrml_sql", `return ${rewriteSqlRefs(`?{${BT}INSERT INTO log (msg) VALUES ('c');${BT}}`, "_scrml_sql")};`);
      await one(sql);
      expect(await count()).toBe(3);
    } finally {
      await sql.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
