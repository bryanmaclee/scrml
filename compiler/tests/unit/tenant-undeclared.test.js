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
import { programTenantTableDecls } from "../../src/schema-differ.js";
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

describe("programTenantTableDecls — every relation a program-body statement creates, with its columns when determinable", () => {
  const one = (sql) => programTenantTableDecls(sql).map((d) => [d.kind, d.key, d.columns]);
  test("CREATE [TEMP | TEMPORARY] TABLE [IF NOT EXISTS] (column list) → its columns", () => {
    expect(one("CREATE TABLE invoices (id INTEGER, tenant_id TEXT)")).toEqual([["table", "invoices", ["id", "tenant_id"]]]);
    expect(one("CREATE TEMP TABLE s (id INTEGER, tenant_id TEXT)")).toEqual([["table", "s", ["id", "tenant_id"]]]);
    expect(one("create temporary table if not exists s (msg text)")).toEqual([["table", "s", ["msg"]]]);
    expect(one('CREATE TABLE "Quoted" (id INTEGER, "TENANT_ID" TEXT)')).toEqual([["table", "quoted", ["id", "TENANT_ID"]]]);
    expect(one("CREATE TABLE log (id INTEGER, msg TEXT DEFAULT 'tenant_id')")).toEqual([["table", "log", ["id", "msg"]]]);
  });
  test("S456 review R1 — `*` over a derived table, VALUES or a CTE is UNKNOWN", () => {
    expect(one("SELECT * INTO inv FROM (SELECT 'A' AS tenant_id, 'sec' AS v) s")).toEqual([["select-into", "inv", null]]);
    expect(one("SELECT * INTO inv FROM (VALUES ('A','s')) AS v(tenant_id,val)")).toEqual([["select-into", "inv", null]]);
    expect(one("WITH x AS (SELECT 'A' AS tenant_id) SELECT * INTO inv FROM x")).toEqual([["select-into", "inv", null]]);
  });
  test("S456 review R2 — CREATE TABLE … AS TABLE x / AS (TABLE x) / AS VALUES is UNKNOWN", () => {
    expect(one("CREATE TABLE copy AS TABLE assets")).toEqual([["table", "copy", null]]);
    expect(one("CREATE TABLE copy AS (TABLE assets)")).toEqual([["table", "copy", null]]);
    expect(one("CREATE TABLE v AS VALUES (1, 'A')")).toEqual([["table", "v", null]]);
  });
  test("S456 review R3 — a `$$` routine body is opaque: its `SELECT … INTO var` is not table creation", () => {
    expect(one("CREATE FUNCTION f() RETURNS int AS $$ DECLARE v int; BEGIN SELECT tenant_id INTO v FROM assets; RETURN v; END $$ LANGUAGE plpgsql")).toEqual([]);
    expect(one("DO $body$ BEGIN SELECT tenant_id INTO v FROM assets; END $body$")).toEqual([]);
  });
  test("an explicit select list is KNOWN — plain references and `expr AS name`, whatever the FROM", () => {
    expect(one("CREATE TABLE snap AS SELECT id, a.name FROM assets a")).toEqual([["table", "snap", ["id", "name"]]]);
    expect(one("SELECT id, count(*) AS n INTO counts FROM (SELECT * FROM x) s GROUP BY id")).toEqual([["select-into", "counts", ["id", "n"]]]);
    expect(one("WITH x AS (SELECT 1 AS k) SELECT k INTO TEMP t FROM x")).toEqual([["select-into", "t", ["k"]]]);
    expect(one("SELECT 'A' AS Tenant_ID INTO inv")).toEqual([["select-into", "inv", ["Tenant_ID"]]]);
    expect(one("CREATE VIEW v (a, b) AS SELECT * FROM t")).toEqual([["view", "v", ["a", "b"]]]);
    expect(one("CREATE TABLE t2 (a, b) AS SELECT * FROM t")).toEqual([["table", "t2", ["a", "b"]]]);
  });
  test("UNKNOWN: an unnamed expression, `t.*`, LIKE, a view over `*`, an unreadable name, an unknown module, a table rename", () => {
    expect(one("SELECT a + 1 INTO x FROM t")).toEqual([["select-into", "x", null]]);
    expect(one("SELECT t.* INTO x FROM t")).toEqual([["select-into", "x", null]]);
    expect(one("CREATE TABLE copy (LIKE assets INCLUDING ALL)")).toEqual([["table", "copy", null]]);
    expect(one("CREATE MATERIALIZED VIEW v AS SELECT * FROM assets")).toEqual([["view", "v", null]]);
    expect(one("CREATE TABLE ${t} (id INTEGER)")).toEqual([["table", null, null]]);
    expect(one("CREATE VIRTUAL TABLE c USING csv(filename='x.csv')")).toEqual([["table", "c", null]]);
    expect(one("ALTER TABLE assets RENAME TO archive")).toEqual([["rename", "archive", null]]);
  });
  test("SQLite fts5 / rtree module arguments are its columns (options skipped)", () => {
    expect(one("CREATE VIRTUAL TABLE IF NOT EXISTS node_fts USING fts5(title, body, project UNINDEXED, tokenize = 'porter')")).toEqual([["table", "node_fts", ["title", "body", "project"]]]);
    expect(one("CREATE VIRTUAL TABLE docs USING fts5(body, tenant_id)")).toEqual([["table", "docs", ["body", "tenant_id"]]]);
  });
  test("ALTER TABLE: ADD / RENAME COLUMN / CHANGE give their new column names", () => {
    expect(one("ALTER TABLE notes ADD COLUMN tenant_id TEXT")).toEqual([["alter", "notes", ["tenant_id"]]]);
    expect(one("ALTER TABLE notes ADD note TEXT, RENAME COLUMN a TO tenant_id")).toEqual([["alter", "notes", ["note", "tenant_id"]]]);
    expect(one("ALTER TABLE notes ADD CONSTRAINT c CHECK (x > 0)")).toEqual([]);
  });
  test("not creation: INSERT INTO, CREATE INDEX, MySQL INTO @var / OUTFILE, a plain SELECT", () => {
    expect(one("INSERT INTO t (a) SELECT a FROM u")).toEqual([]);
    expect(one("CREATE INDEX ix ON t (a)")).toEqual([]);
    expect(one("SELECT tenant_id INTO @v FROM t")).toEqual([]);
    expect(one("SELECT tenant_id INTO OUTFILE '/tmp/x' FROM t")).toEqual([]);
    expect(one("SELECT count(x) AS n FROM t")).toEqual([]);
  });
  test("tokens, not text: a statement in a literal or comment does not run; `--` ends at a lone CR (S456 F1)", () => {
    expect(one("INSERT INTO audit (q) VALUES ('CREATE TABLE x (id INTEGER, tenant_id TEXT)')")).toEqual([]);
    expect(one("SELECT 1 /* ALTER TABLE notes ADD COLUMN tenant_id TEXT */")).toEqual([]);
    expect(one("SELECT 1; --c\rCREATE TABLE x (id INTEGER, tenant_id TEXT)")).toEqual([["table", "x", ["id", "tenant_id"]]]);
  });
  test("a backslash or `#` (meaning differs by database) beside `tenant_id` → one unreadable relation (fail-closed)", () => {
    expect(one("SELECT 'a\\'' ; CREATE TABLE x (id INTEGER, tenant_id TEXT) --'").some(([k]) => k === "unreadable")).toBe(true);
  });
});

describe("(1) a program-body ?{} creating an undeclared tenant table is E-TENANT-UNDECLARED", () => {
  test("CREATE TABLE — the message names the table, the fix, and the no-opt-out rule", () => {
    const r = compileFiles({ "app.scrml": bodyApp("CREATE TABLE invoices (id INTEGER PRIMARY KEY, amount INTEGER, tenant_id TEXT)") });
    expect(r.codes).toEqual(["E-TENANT-UNDECLARED"]);
    const m = r.errors[0].message;
    expect(m).toContain("`invoices`");
    expect(m).toContain("Declare it in `<schema>` so the tenant floor scopes it");
    expect(m).toContain("rename the column");
  });
  test("CREATE TEMP TABLE / CREATE TEMPORARY TABLE IF NOT EXISTS — the fix says a temp table cannot be declared", () => {
    for (const s of ["CREATE TEMP TABLE staging (id INTEGER, tenant_id TEXT)", "CREATE TEMPORARY TABLE IF NOT EXISTS staging (id INTEGER, tenant_id TEXT)"]) {
      const r = compileFiles({ "app.scrml": bodyApp(s) });
      expect(r.codes).toEqual(["E-TENANT-UNDECLARED"]);
      expect(r.errors[0].message).toContain("temporary table `staging`");
      expect(r.errors[0].message).toContain("cannot be declared in `<schema>`");
    }
  });
  test("ALTER TABLE … ADD COLUMN tenant_id on an undeclared table", () => {
    expect(compileFiles({ "app.scrml": bodyApp("ALTER TABLE notes ADD COLUMN tenant_id TEXT") }).codes).toEqual(["E-TENANT-UNDECLARED"]);
  });
  test("S456 review F1 — SELECT … INTO an undeclared table (an aliased tenant_id, or * over a tenant table) is refused", () => {
    const a = compileFiles({ "app.scrml": bodyApp("SELECT 'A' AS tenant_id, 'A-secret' AS v INTO inv") });
    expect(a.codes).toEqual(["E-TENANT-UNDECLARED"]);
    expect(a.errors[0].message).toContain("`inv` (`SELECT … INTO`)");
    const b = compileFiles({ "app.scrml": bodyApp("SELECT * INTO TEMP snap FROM assets") });
    expect(b.codes).toContain("E-TENANT-UNDECLARED");
    expect(b.errors.find((e) => e.code === "E-TENANT-UNDECLARED").message).toContain("the compiler cannot determine its columns");
    // `CREATE TABLE … AS SELECT *` over a tenant table — the same copy
    expect(compileFiles({ "app.scrml": bodyApp("CREATE TABLE copy AS SELECT * FROM assets") }).codes).toContain("E-TENANT-UNDECLARED");
    // control: a spelled select list without tenant_id
    expect(compileFiles({ "app.scrml": bodyApp("SELECT msg INTO msgs FROM log") }).codes).not.toContain("E-TENANT-UNDECLARED");
    // round 2: `*` is UNKNOWN whatever it reads — even a non-tenant table (its columns are not spelled here)
    expect(compileFiles({ "app.scrml": bodyApp("SELECT * INTO msgs FROM log") }).codes).toContain("E-TENANT-UNDECLARED");
  });
  test("S456 review round 2 — R1 / R2 shapes are refused, with or without .acrossTenants() (it does not exempt DDL)", () => {
    const shapes = [
      "SELECT * INTO inv FROM (SELECT 'A' AS tenant_id, 'sec' AS v) s",
      "SELECT * INTO inv FROM (VALUES ('A','s')) AS v(tenant_id,val)",
      "WITH x AS (SELECT 'A' AS tenant_id) SELECT * INTO inv FROM x",
      "CREATE TABLE copy AS TABLE assets",
      "CREATE TABLE copy AS (TABLE assets)",
    ];
    for (const s of shapes) {
      expect(compileFiles({ "app.scrml": bodyApp(s) }).codes).toContain("E-TENANT-UNDECLARED");
      const across = bodyApp(s).replace("}.run()", "}.acrossTenants().run()");
      expect(across).toContain(".acrossTenants()");
      expect(compileFiles({ "app.scrml": across }).codes).toContain("E-TENANT-UNDECLARED");
    }
  });
  test("S456 review round 2 — R3: a PL/pgSQL `SELECT … INTO var` inside a `$$` body is not charged; explicit-column CTAS / SELECT INTO compile", () => {
    const fn = "CREATE FUNCTION f() RETURNS int AS $$ DECLARE v int; BEGIN SELECT tenant_id INTO v FROM assets; RETURN v; END $$ LANGUAGE plpgsql";
    expect(compileFiles({ "app.scrml": bodyApp(fn) }).codes).not.toContain("E-TENANT-UNDECLARED");
    for (const s of [
      "CREATE TABLE IF NOT EXISTS daily AS SELECT id, name AS label FROM log",
      "SELECT id, msg INTO TEMP recent FROM log",
      "CREATE VIEW recent_v (id, msg) AS SELECT * FROM log",
    ]) {
      expect(compileFiles({ "app.scrml": bodyApp(s) }).codes).toEqual([]);
    }
  });
  test("a LIKE copy of a tenant-scoped table carries tenant_id", () => {
    expect(compileFiles({ "app.scrml": bodyApp("CREATE TABLE assets_copy (LIKE assets)") }).codes).toContain("E-TENANT-UNDECLARED");
  });
  test("with NO tenant table anywhere in the compilation, a body tenant table is still refused (the set is empty)", () => {
    const r = compileFiles({ "app.scrml": bodyApp("CREATE TABLE invoices (id INTEGER, tenant_id TEXT)", { schema: "" }) });
    expect(r.codes).toEqual(["E-TENANT-UNDECLARED"]);
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

  test("controls: a table without tenant_id; a table declared in ANOTHER compiled file's <schema>", () => {
    expect(compileFiles({ "app.scrml": bodyApp("CREATE TABLE IF NOT EXISTS log (id INTEGER, msg TEXT)") }).codes).toEqual([]);
    // the compilation's ONE tenant set (S455): `invoices` declared in other.scrml's <schema>
    const other = `<program db="./app.db">
    <schema>
        ?{${BT}CREATE TABLE invoices (id INTEGER PRIMARY KEY, amount INTEGER, tenant_id TEXT)${BT}}
    </schema>
    <p>other</p>
</program>
`;
    // (a body CREATE of a tenant-scoped table is outside the query floor's subset —
    // E-TENANT-SQL-SUBSET, unchanged by S456 — but it is not UNDECLARED)
    const r = compileFiles({
      "app.scrml": bodyApp("CREATE TABLE IF NOT EXISTS invoices (id INTEGER PRIMARY KEY, amount INTEGER, tenant_id TEXT)"),
      "other.scrml": other,
    });
    expect(r.codes).not.toContain("E-TENANT-UNDECLARED");
    const alone = compileFiles({ "app.scrml": bodyApp("CREATE TABLE IF NOT EXISTS invoices (id INTEGER PRIMARY KEY, amount INTEGER, tenant_id TEXT)") });
    expect(alone.codes).toContain("E-TENANT-UNDECLARED");
    expect(programBodyUndeclaredTenantTables(
      { filePath: "/x.scrml", nodes: [{ kind: "sql", query: "CREATE TABLE invoices (id INTEGER, tenant_id TEXT)", span: { start: 0 } }] },
      new Set(["INVOICES".toLowerCase()]),
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
