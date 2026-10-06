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

describe("programTenantTableDecls — the tables a program-body statement gives tenant_id", () => {
  const one = (sql) => programTenantTableDecls(sql).map((d) => ({ key: d.key, kind: d.kind, tenant: d.tenant, like: d.like, modifiers: d.modifiers }));
  test("CREATE [TEMP | TEMPORARY] TABLE [IF NOT EXISTS], any head kind", () => {
    expect(one("CREATE TABLE invoices (id INTEGER, tenant_id TEXT)")).toEqual([{ key: "invoices", kind: "create", tenant: true, like: null, modifiers: [] }]);
    expect(one("CREATE TEMP TABLE s (id INTEGER, tenant_id TEXT)")[0]).toMatchObject({ key: "s", tenant: true, modifiers: ["TEMP"] });
    expect(one("create temporary table if not exists s (tenant_id text)")[0]).toMatchObject({ key: "s", tenant: true, modifiers: ["TEMPORARY"] });
    expect(one("CREATE VIRTUAL TABLE docs USING fts5(body, tenant_id)")[0]).toMatchObject({ key: "docs", tenant: true, modifiers: ["VIRTUAL"] });
    expect(one('CREATE TABLE "Quoted" (id INTEGER, "TENANT_ID" TEXT)')[0]).toMatchObject({ key: "quoted", tenant: true });
  });
  test("no tenant_id column → nothing; a tenant_id only in a literal of a modelled column list is not a column", () => {
    expect(one("CREATE TABLE log (id INTEGER, msg TEXT)")).toEqual([]);
    expect(one("CREATE TABLE log (id INTEGER, msg TEXT DEFAULT 'tenant_id')")).toEqual([]);
  });
  test("fail-closed: no column list (AS SELECT), or an unmodelled form, reads the whole statement", () => {
    expect(one("CREATE TABLE snap AS SELECT id, tenant_id FROM assets")[0]).toMatchObject({ key: "snap", tenant: true });
    expect(one("CREATE TABLE t ([id] INTEGER, tenant_id TEXT)")[0]).toMatchObject({ key: "t", tenant: true });
  });
  test("a head inside a literal or a comment does not run — unless the text holds a form the reader does not model", () => {
    expect(one("INSERT INTO audit (q) VALUES ('CREATE TABLE x (id INTEGER, tenant_id TEXT)')")).toEqual([]);
    expect(one("SELECT 1 -- CREATE TABLE x (tenant_id TEXT)")).toEqual([]);
    expect(one("SELECT 1 /* ALTER TABLE notes ADD COLUMN tenant_id TEXT */")).toEqual([]);
    // a backslash: MySQL ends `'a\''` where the standard reading does not — read fail-closed
    expect(one("SELECT 'a\\'' ; CREATE TABLE x (id INTEGER, tenant_id TEXT) --'")[0]).toMatchObject({ key: "x", tenant: true });
  });
  test("a `--` comment ends at a lone CR (Postgres) — the CREATE / column after it is live (S456 review F1, shared readers)", () => {
    expect(one("SELECT 1 --c\rCREATE TABLE x (id INTEGER, tenant_id TEXT)")[0]).toMatchObject({ key: "x", tenant: true });
    expect(one("CREATE TABLE logs (id integer --c\r, tenant_id text)")[0]).toMatchObject({ key: "logs", tenant: true });
  });
  test("an unreadable name with tenant_id → name null (refused by the caller)", () => {
    expect(programTenantTableDecls("CREATE TABLE ${t} (id INTEGER, tenant_id TEXT)")[0]).toMatchObject({ name: null, tenant: true });
  });
  test("LIKE <template> is returned for the caller; ALTER TABLE … tenant_id is a declaration", () => {
    expect(one("CREATE TABLE copy (LIKE assets INCLUDING ALL)")[0]).toMatchObject({ key: "copy", tenant: false, like: "assets" });
    expect(one("ALTER TABLE notes ADD COLUMN tenant_id TEXT")[0]).toMatchObject({ key: "notes", kind: "alter", tenant: true });
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
