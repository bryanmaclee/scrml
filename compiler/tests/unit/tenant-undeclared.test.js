/**
 * §14.8.10 (S456) — E-TENANT-UNDECLARED: a table carrying `tenant_id` that the compilation
 * does not declare tenant-scoped is refused where the compiler can see it.
 *
 * Ruling (user-voice-scrml.md S456, "b, startup check lands with it"): (1) a program-body
 * `?{CREATE [TEMP] TABLE … tenant_id …}` → compile error naming the fix (declare it in
 * `<schema>`); (2) a SQLite file the compiler already opens → scan it, refuse any
 * undeclared `tenant_id` table. (3) — the built server's startup check — is
 * compiler/tests/integration/tenant-undeclared-startup.test.js.
 *
 * Each `neg` shape compiled CLEAN on 2dd6d35d9 (executed — docs/changes/
 * s456-tenant-undeclared-table/progress.md), its table read unscoped by the floor.
 */

import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Database } from "bun:sqlite";
import { compileScrml } from "../../src/api.js";
import { programStatementVerdicts } from "../../src/schema-differ.js";
import { programBodyUndeclaredTenantTables, liveUndeclaredTenantTables } from "../../src/tenant-undeclared.ts";

const BT = "`";

function compileFiles(files, setup) {
  const dir = mkdtempSync(join(tmpdir(), "s456-undeclared-"));
  try {
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
    if (setup) setup(dir);
    const entries = Object.keys(files).filter((f) => f.endsWith(".scrml") && !files[f].startsWith("export"));
    const r = compileScrml({ inputFiles: entries.map((f) => join(dir, f)), write: false, log: () => {} });
    const errors = (r.errors ?? []).filter((e) => e.severity !== "warning" && !/^[WI]-/.test(e.code ?? ""));
    return { codes: errors.map((e) => e.code), errors };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const SCHEMA = `    <schema>
        ?{${BT}CREATE TABLE assets (id INTEGER PRIMARY KEY, name TEXT, tenant_id TEXT)${BT}}
    </schema>
`;
const bodyApp = (stmt, { schema = SCHEMA } = {}) => `<program db="./app.db">
${schema}    \${
        function setup() {
            ?{${BT}${stmt}${BT}}.run()
            return 1
        }
    }
    <button onclick=\${ setup() }>s</button>
</program>
`;

describe("programStatementVerdicts — the CLOSED program-body allow-list (S456 \"a, fix F7/F9 too\" + \"your recs, go\")", () => {
  const isTenant = (n) => ["assets"].includes(n.toLowerCase());
  const v = (sql, dialect = "sqlite") =>
    programStatementVerdicts(sql, { dialect, isTenant }).map((d) => (d.verdict === "admitted" ? "ok" : d.name ? `${d.verdict}:${d.name}` : d.verdict));

  test("DML is admitted; a top-level SELECT … INTO is not (an INSERT / REPLACE target is)", () => {
    expect(v("SELECT a FROM t WHERE b = ${x}")).toEqual(["ok"]);
    expect(v("WITH x AS (SELECT 1) INSERT INTO t (a) SELECT * FROM x")).toEqual(["ok"]);
    expect(v("INSERT OR REPLACE INTO t (a) VALUES (1)")).toEqual(["ok"]);
    expect(v("UPDATE t SET a = (SELECT b FROM u) WHERE id = 1")).toEqual(["ok"]);
    expect(v("DELETE FROM t")).toEqual(["ok"]);
    expect(v("SELECT * INTO inv FROM x", "postgres")).toEqual(["not-admitted"]);
    expect(v("WITH x AS (SELECT 'A' AS tenant_id) SELECT * INTO inv FROM x", "postgres")).toEqual(["not-admitted"]);
    expect(v("SELECT a INTO @v FROM t", "unknown")).toEqual(["unreadable"]);   // `@` is outside the lexical subset
    // S456 round 4 (r4 F2): an INTO at ANY depth that is not the statement's own INSERT / REPLACE target
    expect(v("(SELECT 'A' AS tenant_id INTO x3)")).toEqual(["not-admitted"]);
    expect(v("WITH a AS (SELECT 1) (SELECT 'A' AS tenant_id INTO x5 FROM a)")).toEqual(["not-admitted"]);
    expect(v("SELECT replace INTO t FROM x")).toEqual(["not-admitted"]);
    expect(v("WITH x(a) AS (SELECT 1) INSERT INTO t (a) SELECT a FROM x")).toEqual(["ok"]);
    expect(v("INSERT OR IGNORE INTO t (a) VALUES ('é')")).toEqual(["ok"]);   // non-ASCII inside a literal is data
    // a data-modifying CTE's INSERT target is a write target too; a CTE's SELECT … INTO is not
    expect(v("WITH x AS (INSERT INTO t (v) VALUES (1) RETURNING v) SELECT v FROM x", "postgres")).toEqual(["ok"]);
    expect(v("WITH x AS (SELECT 'A' AS tenant_id INTO y) SELECT 1", "postgres")).toEqual(["not-admitted"]);
  });
  test("CREATE [TEMP] TABLE (spelled columns): admitted; a tenant_id column outside the set → tenant (any case / quoting)", () => {
    expect(v("CREATE TABLE IF NOT EXISTS log (id INTEGER PRIMARY KEY, msg TEXT NOT NULL DEFAULT '', UNIQUE (msg))")).toEqual(["ok"]);
    expect(v("CREATE TABLE kv (key TEXT, check TEXT, unique_id INTEGER) WITHOUT ROWID")).toEqual(["ok"]);
    expect(v("CREATE TABLE invoices (id INTEGER, tenant_id TEXT)")).toEqual(["tenant:invoices"]);
    expect(v("CREATE TEMP TABLE s (id INTEGER, \"Tenant_ID\" TEXT)")).toEqual(["tenant:s"]);
    expect(v("CREATE TABLE g (id INTEGER, tenant_id TEXT GENERATED ALWAYS AS ('A') VIRTUAL)")).toEqual(["tenant:g"]);
    expect(v("CREATE TABLE assets (id INTEGER, tenant_id TEXT)")).toEqual(["ok"]);   // declared: the floor scopes it
  });
  test("ALTER TABLE name ADD [COLUMN] col type: admitted; tenant_id outside the set → tenant", () => {
    expect(v("ALTER TABLE delta_log ADD COLUMN xref TEXT NOT NULL DEFAULT ''")).toEqual(["ok"]);
    expect(v("ALTER TABLE gop ADD COLUMN key TEXT NOT NULL DEFAULT ''")).toEqual(["ok"]);
    expect(v("ALTER TABLE notes ADD COLUMN tenant_id TEXT")).toEqual(["tenant:notes"]);
    expect(v("ALTER TABLE notes ADD CONSTRAINT c CHECK (x > 0)")).toEqual(["not-admitted"]);
    expect(v("ALTER TABLE notes RENAME COLUMN a TO tenant_id")).toEqual(["not-admitted"]);
  });
  test("fts5 with the closed option list: admitted; another option or module → not admitted; content = a tenant table → tenant", () => {
    expect(v("CREATE VIRTUAL TABLE IF NOT EXISTS node_fts USING fts5(title, body, project UNINDEXED, tokenize = 'porter', prefix = '2 3')")).toEqual(["ok"]);
    expect(v("CREATE VIRTUAL TABLE docs USING fts5(body, tenant_id)")).toEqual(["tenant:docs"]);
    expect(v("CREATE VIRTUAL TABLE f USING fts5(body, content='assets')")).toEqual(["tenant:f"]);
    expect(v("CREATE VIRTUAL TABLE f USING fts5(body, columns = 2)")).toEqual(["not-admitted"]);
    expect(v(`CREATE VIRTUAL TABLE f USING fts4(body, languageid="tenant_id")`)).toEqual(["not-admitted"]);
    expect(v("CREATE VIRTUAL TABLE r USING rtree(id, a, b)")).toEqual(["not-admitted"]);
  });
  test("ruling \"your recs, go\": transaction control, CREATE [UNIQUE] INDEX, the closed PRAGMA list", () => {
    for (const s of ["BEGIN", "BEGIN IMMEDIATE", "COMMIT", "ROLLBACK", "ROLLBACK TO SAVEPOINT a", "SAVEPOINT a", "RELEASE SAVEPOINT a"]) expect(v(s)).toEqual(["ok"]);
    expect(v("CREATE UNIQUE INDEX IF NOT EXISTS gcand_key ON gcand (key) WHERE key <> ''")).toEqual(["ok"]);
    expect(v("CREATE INDEX ix ON t (a COLLATE NOCASE DESC, b)")).toEqual(["ok"]);
    expect(v("CREATE INDEX ix ON t (lower(a))")).toEqual(["not-admitted"]);
    for (const s of ["PRAGMA table_info(delta_log)", "PRAGMA table_xinfo(t)", "PRAGMA busy_timeout = 10000", "PRAGMA journal_mode = WAL", "PRAGMA index_list(t)"]) expect(v(s)).toEqual(["ok"]);
    expect(v("PRAGMA writable_schema = ON")).toEqual(["not-admitted"]);
    expect(v("PRAGMA foreign_keys = ON")).toEqual(["not-admitted"]);
  });
  test("everything else is not admitted — the S239 r3 shapes among them", () => {
    for (const s of [
      "CREATE VIEW v (id) AS SELECT id, tenant_id FROM assets",           // short view column list (PG)
      "CREATE TABLE c (id) AS SELECT id, tenant_id FROM assets",          // short CTAS column list (PG)
      "ALTER VIEW v RENAME COLUMN a TO tenant_id",
      "ALTER MATERIALIZED VIEW v RENAME COLUMN a TO tenant_id",
      "EXPLAIN ANALYZE CREATE TABLE c AS SELECT * FROM assets",
      "EXPLAIN ANALYZE SELECT * INTO c FROM assets",
      "CREATE SCHEMA s CREATE TABLE t (id int, tenant_id text)",
      "CREATE TABLE x AS SELECT a FROM t", "CREATE TABLE copy (LIKE assets)", "CREATE TABLE main.x (a INT)",
      "ATTACH 'x.db' AS o", "DROP TABLE t", "VACUUM", "CALL p()", "SET search_path = x", "END",
    ]) expect(v(s, "postgres")).toEqual(["not-admitted"]);
  });
  test("S456 round 4 — the CLOSED LEXICAL SUBSET: anything outside it is UNREADABLE, whatever the database", () => {
    // r4 F1: `w·$z$` is ONE identifier to PG16 and SQLite, a dollar quote to a reader admitting `$`
    expect(v("CREATE TABLE stash (v TEXT, w·$z$ TEXT, tenant_id TEXT, q·$z$ TEXT)")).toEqual(["unreadable"]);
    expect(v("SELECT 1 AS a, 2 AS x😀$z$, 'A' AS tenant_id INTO stash3 FROM (SELECT 1 AS y😀$z$) s")).toEqual(["unreadable"]);
    expect(v("SELECT $a$", "sqlite")).toEqual(["unreadable"]);                         // r4 F5
    expect(v('CREATE TABLE t (id INT, U&"tenant\\005fid" TEXT)', "postgres")).toEqual(["unreadable"]);   // r4 F3
    expect(v("SELECT 1 /*! ; CREATE TABLE x (tenant_id TEXT) */")).toEqual(["unreadable"]);   // r4 F4
    expect(v("SELECT 1 /*M! ; CREATE TABLE x (tenant_id TEXT) */")).toEqual(["unreadable"]);
    for (const s of ["SELECT E'a'", "SELECT X'00'", "SELECT B'1'", "SELECT N'a'", "SELECT ?", "SELECT :a", "SELECT @a",
      "SELECT `a` FROM t", "SELECT [a] FROM t", "SELECT 'a\\b'", "DO $$ BEGIN END $$", "SELECT 1\fFROM t", "SELECT 1\u00a0FROM t", "SELECT éa FROM t"]) {
      expect(v(s, "sqlite")).toEqual(["unreadable"]);
    }
    expect(v("SELECT a::int, -1.5, 'é' FROM t WHERE b <> ${x} -- note")).toEqual(["ok"]);
    expect(v('SELECT "Name", "" FROM "T"')).toEqual(["ok"]);
  });
  test("UNREADABLE (databases disagree) → refused whether or not tenant_id is named", () => {
    expect(v("SELECT 1 /* a /* b */ ; CREATE TABLE x (a TEXT) -- */")).toEqual(["unreadable"]);
    expect(v("SELECT 1 -- c\rDELETE FROM t")).toEqual(["unreadable"]);
    expect(v("SELECT $é$ x $é$", "postgres")).toEqual(["unreadable"]);
    expect(v("SELECT 'a\\'' ; DELETE FROM t --'", "postgres")).toEqual(["unreadable"]);
    expect(v("SELECT 1 # c", "unknown")).toEqual(["unreadable"]);
    expect(v("SELECT 1 --c", "unknown")).toEqual(["unreadable"]);
    expect(v("SELECT [a] FROM t", "postgres")).toEqual(["unreadable"]);
    // CRLF line endings are not a lone CR
    expect(v("SELECT 1 -- c\r\nFROM t")).toEqual(["ok"]);
  });
  test("a `;` splits statements — each is judged; a statement in a literal or comment is data", () => {
    expect(v("BEGIN; INSERT INTO t (a) VALUES (1); COMMIT")).toEqual(["ok", "ok", "ok"]);
    expect(v("SELECT 1; DROP TABLE t")).toEqual(["ok", "not-admitted"]);
    expect(v("INSERT INTO audit (q) VALUES ('CREATE TABLE x (tenant_id TEXT)')")).toEqual(["ok"]);
  });
});

describe("(1) program-body statements in a compile: E-TENANT-UNDECLARED / E-SQL-PROGRAM-STATEMENT-NOT-ADMITTED", () => {
  test("CREATE TABLE with tenant_id — the message names the table, the fix, and the no-opt-out rule", () => {
    const r = compileFiles({ "app.scrml": bodyApp("CREATE TABLE invoices (id INTEGER PRIMARY KEY, amount INTEGER, tenant_id TEXT)") });
    expect(r.codes).toEqual(["E-TENANT-UNDECLARED"]);
    const m = r.errors[0].message;
    expect(m).toContain("`invoices`");
    expect(m).toContain("Declare it in `<schema>` so the tenant floor scopes it");
    expect(m).toContain("rename the column");
  });
  test("TEMP / ALTER ADD COLUMN tenant_id on an undeclared table; an empty tenant set refuses too", () => {
    expect(compileFiles({ "app.scrml": bodyApp("CREATE TEMP TABLE staging (id INTEGER, tenant_id TEXT)") }).codes).toEqual(["E-TENANT-UNDECLARED"]);
    expect(compileFiles({ "app.scrml": bodyApp("ALTER TABLE notes ADD COLUMN tenant_id TEXT") }).codes).toEqual(["E-TENANT-UNDECLARED"]);
    expect(compileFiles({ "app.scrml": bodyApp("CREATE TABLE invoices (id INTEGER, tenant_id TEXT)", { schema: "" }) }).codes).toEqual(["E-TENANT-UNDECLARED"]);
  });
  test("a statement off the list is E-SQL-PROGRAM-STATEMENT-NOT-ADMITTED, naming the admitted list — `.acrossTenants()` or not", () => {
    for (const s of [
      "SELECT * INTO inv FROM (SELECT 'A' AS tenant_id, 'sec' AS v) s",
      "CREATE TABLE copy AS TABLE assets",
      "CREATE VIEW v AS SELECT id FROM log",
      "DROP TABLE log",
    ]) {
      const r = compileFiles({ "app.scrml": bodyApp(s) });
      expect(r.codes).toContain("E-SQL-PROGRAM-STATEMENT-NOT-ADMITTED");
      expect(r.errors.find((e) => e.code === "E-SQL-PROGRAM-STATEMENT-NOT-ADMITTED").message).toContain("Declare the relation in `<schema>`");
      const across = bodyApp(s).replace("}.run()", "}.acrossTenants().run()");
      expect(compileFiles({ "app.scrml": across }).codes).toContain("E-SQL-PROGRAM-STATEMENT-NOT-ADMITTED");
    }
  });
  test("admitted shapes compile clean (DDL, fts5, index, PRAGMA, transaction control)", () => {
    for (const s of [
      "CREATE TABLE IF NOT EXISTS log (id INTEGER PRIMARY KEY, msg TEXT)",
      "ALTER TABLE log ADD COLUMN extra TEXT NOT NULL DEFAULT ''",
      "CREATE VIRTUAL TABLE IF NOT EXISTS log_fts USING fts5(msg, tokenize = 'porter')",
      "CREATE UNIQUE INDEX IF NOT EXISTS log_msg ON log (msg) WHERE msg <> ''",
      "PRAGMA table_info(log)",
      "BEGIN",
    ]) {
      expect(compileFiles({ "app.scrml": bodyApp(s) }).codes).toEqual([]);
    }
  });
  test("a bare-identifier body is refused by both rules (round 4: only a bare `${…}` body is E-SQL-003's alone)", () => {
    const src = `<program db="./app.db">
    \${
        function run(q) {
            ?{q}.run()
            return 1
        }
    }
    <button onclick=\${ run("x") }>s</button>
</program>
`;
    const codes = compileFiles({ "app.scrml": src }).codes;
    expect(codes).toContain("E-SQL-003");
    expect(codes).toContain("E-SQL-PROGRAM-STATEMENT-NOT-ADMITTED");
    const slot = src.replace("?{q}", "?{${q}}");
    expect(compileFiles({ "app.scrml": slot }).codes).not.toContain("E-SQL-PROGRAM-STATEMENT-NOT-ADMITTED");
  });
  test("a program WITHOUT a database is not governed (S456 \"a\": \"in any compilation with a database\")", () => {
    const src = `<program>
    \${
        function f() { return ?{${BT}SELECT * INTO x FROM t${BT}}.all() }
    }
    <button onclick=\${ f() }>s</button>
</program>
`;
    expect(compileFiles({ "app.scrml": src }).codes).not.toContain("E-SQL-PROGRAM-STATEMENT-NOT-ADMITTED");
  });
  test("an expression-position ?{} is read too", () => {
    const src = `<program db="./app.db">
${SCHEMA}    \${
        function setup() {
            const done = ?{${BT}CREATE TABLE invoices (id INTEGER, tenant_id TEXT)${BT}}.run()
            return done
        }
    }
    <button onclick=\${ setup() }>s</button>
</program>
`;
    expect(compileFiles({ "app.scrml": src }).codes).toContain("E-TENANT-UNDECLARED");
  });
  test("a table declared in ANOTHER compiled file's <schema> is declared here too", () => {
    const other = `<program db="./app.db">
    <schema>
        ?{${BT}CREATE TABLE invoices (id INTEGER PRIMARY KEY, amount INTEGER, tenant_id TEXT)${BT}}
    </schema>
    <p>other</p>
</program>
`;
    const r = compileFiles({ "app.scrml": bodyApp("ALTER TABLE invoices ADD COLUMN tenant_id TEXT"), "other.scrml": other });
    expect(r.codes).not.toContain("E-TENANT-UNDECLARED");
    expect(programBodyUndeclaredTenantTables(
      { filePath: "/x.scrml", nodes: [{ kind: "sql", query: "CREATE TABLE invoices (id INTEGER, tenant_id TEXT)", span: { start: 0 } }] },
      new Set(["invoices"]),
    )).toEqual([]);
  });
  test("a <schema> body is the declaration, never a program-body statement", () => {
    const fileAST = {
      filePath: "/x.scrml",
      nodes: [{ kind: "state", stateType: "schema", children: [{ kind: "sql", query: "CREATE TABLE x (tenant_id TEXT)" }] }],
    };
    expect(programBodyUndeclaredTenantTables(fileAST, [])).toEqual([]);
  });
});

describe("(2) a live SQLite file the compile opens: every relation carrying tenant_id is checked", () => {
  const liveApp = (tables) => `<program>
    <db src="./live.db" tables="${tables}">
        \${
            function mine() { return ?{${BT}SELECT name FROM assets${BT}}.all() }
        }
        <button onclick=\${ mine() }>m</button>
    </db>
</program>
`;
  const seed = (stmts) => (dir) => {
    const db = new Database(join(dir, "live.db"), { create: true });
    for (const s of stmts) db.run(s);
    db.close();
  };

  test("a table outside tables= with tenant_id → E-TENANT-UNDECLARED naming it", () => {
    const r = compileFiles({ "app.scrml": liveApp("assets") }, seed([
      "CREATE TABLE assets (id INTEGER PRIMARY KEY, name TEXT, tenant_id TEXT)",
      "CREATE TABLE invoices (id INTEGER PRIMARY KEY, amount INTEGER, Tenant_Id TEXT)",
    ]));
    expect(r.codes).toEqual(["E-TENANT-UNDECLARED"]);
    expect(r.errors[0].message).toContain("the table `invoices`");
  });
  test("a view carrying tenant_id is charged too (its fix: drop it or rename)", () => {
    const r = compileFiles({ "app.scrml": liveApp("assets") }, seed([
      "CREATE TABLE assets (id INTEGER PRIMARY KEY, name TEXT, tenant_id TEXT)",
      "CREATE VIEW all_assets AS SELECT * FROM assets",
    ]));
    expect(r.codes).toEqual(["E-TENANT-UNDECLARED"]);
    expect(r.errors[0].message).toContain("the view `all_assets`");
    expect(r.errors[0].message).toContain("drop the view");
  });
  test("declared by a <schema> in the compilation → not charged", () => {
    const src = `<program>
    <schema>
        ?{${BT}CREATE TABLE invoices (id INTEGER PRIMARY KEY, amount INTEGER, tenant_id TEXT)${BT}}
    </schema>
    <db src="./live.db" tables="assets">
        \${
            function mine() { return ?{${BT}SELECT name FROM assets${BT}}.all() }
        }
        <button onclick=\${ mine() }>m</button>
    </db>
</program>
`;
    const r = compileFiles({ "app.scrml": src }, seed([
      "CREATE TABLE assets (id INTEGER PRIMARY KEY, name TEXT, tenant_id TEXT)",
      "CREATE TABLE invoices (id INTEGER PRIMARY KEY, amount INTEGER, tenant_id TEXT)",
    ]));
    expect(r.codes).not.toContain("E-TENANT-UNDECLARED");
  });
  test("F7/F9 — generated and hidden columns count (pragma_table_xinfo): a GENERATED tenant_id, an fts4 languageid", () => {
    const r = compileFiles({ "app.scrml": liveApp("assets") }, seed([
      "CREATE TABLE assets (id INTEGER PRIMARY KEY, name TEXT, tenant_id TEXT)",
      "CREATE TABLE gen (id INTEGER, tenant_id TEXT GENERATED ALWAYS AS ('A') VIRTUAL)",
      `CREATE VIRTUAL TABLE f4 USING fts4(body, languageid="tenant_id")`,
    ]));
    expect(r.codes).toEqual(["E-TENANT-UNDECLARED", "E-TENANT-UNDECLARED"]);
    expect(r.errors.map((e) => /`(gen|f4)`/.exec(e.message)?.[1]).sort()).toEqual(["f4", "gen"]);
  });
  test("control: every tenant table is in tables=", () => {
    const r = compileFiles({ "app.scrml": liveApp("assets") }, seed([
      "CREATE TABLE assets (id INTEGER PRIMARY KEY, name TEXT, tenant_id TEXT)",
      "CREATE TABLE log (id INTEGER, msg TEXT)",
    ]));
    expect(r.codes).toEqual([]);
  });
  test("an unreadable relation is refused, not treated as clean", () => {
    const d = liveUndeclaredTenantTables(
      [{ table: "odd", type: "unreadable", db: "./live.db", filePath: "/x.scrml", span: {}, error: "no such module: foo" }],
      ["odd"],
    );
    expect(d.map((x) => x.code)).toEqual(["E-TENANT-UNDECLARED"]);
    expect(d[0].message).toContain("could not be read");
  });
});
