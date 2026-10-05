/**
 * §14.8.10 — E-TENANT-SCHEMA-HAZARD kind "isolation removal", and the CLOSED list of
 * exempt statements (ruling:user-voice-scrml.md S455 "yes both").
 *
 * Before the ruling the checker's INERT_LEADERS (DROP, PRAGMA, COMMENT, GRANT, REVOKE,
 * VACUUM, BEGIN, COMMIT, END, ROLLBACK, SAVEPOINT, RELEASE, SET) and its "ALTER TABLE
 * naming its own target is fine" rule passed, clean, every statement below that removes
 * the §14.8.11 database-tier isolation of a tenant-scoped table — `DROP POLICY
 * scrml_tenant_iso ON assets`, `ALTER TABLE assets DISABLE ROW LEVEL SECURITY`, `GRANT
 * … ON assets TO PUBLIC`, `CREATE ROLE … BYPASSRLS`, `SET row_security = off` — while
 * the SPEC's fail-closed clause read "any other `<schema>` statement that names a
 * tenant-scoped table" is charged.
 *
 * The ruling: (i) those are charged, kind "isolation removal"; (ii) the exemptions are a
 * CLOSED list — `CREATE INDEX`, `ALTER TABLE … ADD COLUMN`, `ANALYZE`, `REINDEX` — and
 * anything else naming a tenant table is charged. `GRANT … ON <tenant> TO scrml_app`
 * (the §14.8.11 bounded app role, `DBAUTH_ROLE`) is not an isolation removal by (i)'s
 * own wording ("to anyone but scrml's own app role").
 */
import { describe, test, expect, afterAll } from "bun:test";
import { writeFileSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { findSchemaTenantHazards, schemaHazardMessage } from "../../src/tenant-schema-hazards.ts";
import { DBAUTH_ROLE } from "../../src/schema-differ.js";
import { compileScrml } from "../../src/api.js";

const _tmp = [];
afterAll(() => { for (const d of _tmp) { try { rmSync(d, { recursive: true, force: true }); } catch {} } });

const BT = "`";
const w = (s) => `?{${BT}${s}${BT}}`;
const ASSETS = "CREATE TABLE assets (id INTEGER PRIMARY KEY, name TEXT, tenant_id TEXT)";
const CONFIG = "CREATE TABLE config (k TEXT, v TEXT)";
const body = (...stmts) => "\n" + stmts.map((s) => (s.startsWith("--") ? s : w(s))).join("\n") + "\n";
const kindsOf = (stmt, tenant = ["assets"]) =>
  findSchemaTenantHazards(body(ASSETS, CONFIG, stmt), tenant).map((h) => h.kind + (h.unattributable ? "*" : ""));

describe("(i) isolation removal — charged", () => {
  const charged = [
    // DROP POLICY
    "DROP POLICY scrml_tenant_iso ON assets",
    "drop policy if exists p on assets",
    `DROP POLICY "p" ON public."assets"`,
    "DROP POLICY p ON ASSETS",
    // ALTER TABLE <tenant> DISABLE | NO FORCE ROW LEVEL SECURITY / OWNER TO
    "ALTER TABLE assets DISABLE ROW LEVEL SECURITY",
    "alter table public.assets disable row level security",
    "ALTER TABLE IF EXISTS ONLY assets NO FORCE ROW LEVEL SECURITY",
    `ALTER TABLE "assets" OWNER TO bob`,
    "ALTER TABLE assets OWNER TO CURRENT_USER",
    // GRANT … ON <tenant> to anyone but the app role
    "GRANT SELECT ON assets TO PUBLIC",
    "grant all privileges on table public.assets to bob",
    `GRANT SELECT ON assets TO ${DBAUTH_ROLE}, PUBLIC`,
    "GRANT SELECT ON assets, config TO reporting WITH GRANT OPTION",
  ];
  for (const s of charged) {
    test(s, () => expect(kindsOf(s)).toEqual(["isolation removal"]));
  }
  const chargedEverywhere = [
    "GRANT ALL ON ALL TABLES IN SCHEMA public TO bob",
    `GRANT admin TO ${DBAUTH_ROLE}`,
    "CREATE ROLE ops BYPASSRLS",
    "CREATE ROLE ops WITH LOGIN SUPERUSER",
    "create user root superuser",
    `ALTER ROLE ${DBAUTH_ROLE} BYPASSRLS`,
    "ALTER USER x WITH SUPERUSER",
    "SET row_security = off",
    "set row_security to on",
    "SET LOCAL ROLE postgres",
    "SET SESSION ROLE admin",
    "SET ROLE NONE",
    "SET SESSION AUTHORIZATION postgres",
  ];
  for (const s of chargedEverywhere) {
    test(`${s} (names no table → charged against every tenant table)`, () => expect(kindsOf(s)).toEqual(["isolation removal*"]));
  }
  test("a commented-out CREATE ROLE … BYPASSRLS still counts (comment-agnostic, like every declaration)", () => {
    expect(findSchemaTenantHazards(body(ASSETS, "-- CREATE ROLE ops BYPASSRLS"), ["assets"]).map((h) => h.kind)).toEqual(["isolation removal"]);
  });
  test("the message names the statement, the table and the tier, with no trigger prose", () => {
    const b = body(ASSETS, "DROP POLICY scrml_tenant_iso ON assets");
    const [h] = findSchemaTenantHazards(b, ["assets"]);
    const m = schemaHazardMessage(h, b);
    expect(m).toContain("isolation removal `DROP POLICY scrml_tenant_iso ON`");
    expect(m).toContain("`assets`");
    expect(m).toContain("scrml_tenant_iso");
    expect(m).not.toContain("trigger or rule body");
  });
});

describe("(i) not an isolation removal", () => {
  const quiet = [
    `GRANT SELECT, INSERT, UPDATE, DELETE ON assets TO ${DBAUTH_ROLE}`,
    `GRANT SELECT ON TABLE public.assets TO "${DBAUTH_ROLE}"`,
    `GRANT ALL ON ALL TABLES IN SCHEMA public TO ${DBAUTH_ROLE}`,
    "GRANT SELECT ON config TO PUBLIC",                         // not a tenant table
    "DROP POLICY p ON config",
    "ALTER TABLE config DISABLE ROW LEVEL SECURITY",
    "CREATE ROLE ok NOLOGIN NOBYPASSRLS",
    "ALTER ROLE ok NOSUPERUSER",
    "SET search_path = public",
    "PRAGMA foreign_keys = ON",                                 // SQLite, names no table
  ];
  for (const s of quiet) test(s, () => expect(kindsOf(s)).toEqual([]));
  test("no tenant table in the compilation → nothing is charged at all", () => {
    expect(findSchemaTenantHazards(body(CONFIG, "CREATE ROLE ops BYPASSRLS", "SET row_security = off"), [])).toEqual([]);
  });
});

describe("(ii) the CLOSED exemption list — CREATE INDEX, ALTER TABLE … ADD COLUMN, ANALYZE, REINDEX", () => {
  const exempt = [
    "CREATE INDEX ix ON assets (name)",
    "CREATE UNIQUE INDEX IF NOT EXISTS ix ON public.assets (name)",
    "ALTER TABLE assets ADD COLUMN extra TEXT",
    "ALTER TABLE assets ADD extra TEXT",                          // SQLite / Postgres: COLUMN is optional
    "ALTER TABLE assets ADD COLUMN IF NOT EXISTS extra TEXT, ADD COLUMN more INTEGER DEFAULT 0",
    `ALTER TABLE "assets" ADD COLUMN "extra" TEXT`,
    "alter table public.assets add column extra text",
    "ALTER TABLE assets ADD COLUMN tenant_id TEXT",              // the item-2 scoping declaration
    "ALTER TABLE config ADD COLUMN aid INTEGER REFERENCES assets(id)",   // a plain FK: no action
    "ANALYZE assets",
    "REINDEX assets",
  ];
  for (const s of exempt) test(`exempt: ${s}`, () => expect(kindsOf(s)).toEqual([]));

  // Everything the old INERT_LEADERS / own-target rule exempted that names a tenant table — now charged.
  const moved = [
    "DROP TABLE assets",
    "DROP TABLE IF EXISTS public.assets",
    "DROP TRIGGER t ON assets",
    "PRAGMA table_info(assets)",
    "COMMENT ON TABLE assets IS 'tenant data'",
    "REVOKE SELECT ON assets FROM bob",
    "VACUUM assets",
    "ALTER TABLE assets RENAME COLUMN name TO title",
    "ALTER TABLE assets DROP COLUMN name",
    "ALTER TABLE assets ALTER COLUMN name SET NOT NULL",
    "ALTER TABLE assets ADD CONSTRAINT u UNIQUE (name)",
    "ALTER TABLE assets ADD PRIMARY KEY (id)",
    "ALTER TABLE assets ADD COLUMN extra TEXT, DROP COLUMN name",
    "ALTER TABLE assets ENABLE ROW LEVEL SECURITY",
    "ALTER TABLE assets FORCE ROW LEVEL SECURITY",
    "ALTER TABLE config ADD CONSTRAINT fk FOREIGN KEY (k) REFERENCES assets(name)",
  ];
  for (const s of moved) test(`charged (was exempt): ${s}`, () => expect(kindsOf(s)).toEqual(["statement"]));

  test("an ADD COLUMN holding a `${…}` is unreadable, so not exempt", () => {
    expect(kindsOf("ALTER TABLE assets ADD COLUMN ${col} TEXT")).toEqual(["statement"]);
  });
});

describe("compile — the rule runs over the compilation's tenant set", () => {
  const compile = (files) => {
    const dir = mkdtempSync(join(tmpdir(), "tenant-iso-removal-"));
    _tmp.push(dir);
    const paths = Object.entries(files).map(([n, src]) => { const p = join(dir, n); writeFileSync(p, src); return p; });
    return compileScrml({ inputFiles: paths, write: false, outputDir: join(dir, "out"), log: () => {} });
  };
  const prog = (...stmts) => `<program db="app.db">
  <schema>
${stmts.map((s) => `    ${w(s)}`).join("\n")}
  </schema>
  <p>x</p>
</program>
`;
  const codes = (r) => (r.errors ?? []).map((e) => e.code);
  test("DROP POLICY on a tenant table is a compile error at the <schema>", () => {
    expect(codes(compile({ "app.scrml": prog(ASSETS, "DROP POLICY scrml_tenant_iso ON assets") }))).toContain("E-TENANT-SCHEMA-HAZARD");
  });
  test("a BYPASSRLS role in admin.scrml is charged because app.scrml declares a tenant table", () => {
    const r = compile({ "app.scrml": prog(ASSETS), "admin.scrml": prog(CONFIG, "CREATE ROLE ops BYPASSRLS") });
    const e = (r.errors ?? []).filter((x) => x.code === "E-TENANT-SCHEMA-HAZARD");
    expect(e).toHaveLength(1);
    expect(e[0].message).toContain("isolation removal");
  });
  test("…and not when the compilation has no tenant table", () => {
    expect(codes(compile({ "admin.scrml": prog(CONFIG, "CREATE ROLE ops BYPASSRLS") }))).not.toContain("E-TENANT-SCHEMA-HAZARD");
  });
  test("the exempt list compiles clean", () => {
    expect(codes(compile({ "app.scrml": prog(ASSETS, "CREATE INDEX ix ON assets (name)", "ALTER TABLE assets ADD COLUMN extra TEXT",
      `GRANT SELECT ON assets TO ${DBAUTH_ROLE}`) }))).not.toContain("E-TENANT-SCHEMA-HAZARD");
  });
});
