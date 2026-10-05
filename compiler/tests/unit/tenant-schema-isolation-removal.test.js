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

// S239 review of 3d798369 — #1: a QUOTED grantee is case-exact in Postgres.
describe("review #1 — only `scrml_app` (unquoted, any case) or exactly `\"scrml_app\"` is the app role", () => {
  for (const s of [
    `GRANT SELECT ON assets TO "SCRML_APP"`,
    `GRANT SELECT ON assets TO "Scrml_App"`,
    `GRANT SELECT ON assets TO [SCRML_APP]`,
    `GRANT SELECT ON assets TO scrml_app, "SCRML_APP"`,
  ]) test(`charged: ${s}`, () => expect(kindsOf(s)).toEqual(["isolation removal"]));
  for (const s of [
    `GRANT SELECT ON assets TO scrml_app`,
    `GRANT SELECT ON assets TO SCRML_APP`,
    `GRANT SELECT ON assets TO "scrml_app"`,
  ]) test(`exempt: ${s}`, () => expect(kindsOf(s)).toEqual([]));
  test(`GRANT admin TO "SCRML_APP" is not a grant to the app role (a different role) — not charged as one`, () => {
    expect(kindsOf(`GRANT admin TO "SCRML_APP"`)).toEqual([]);
    expect(kindsOf(`GRANT admin TO "scrml_app"`)).toEqual(["isolation removal*"]);
  });
});

// #6: an exempt statement still evaluates expressions — per row, at migration, as the migrating role.
describe("review #6 — every expression in an exempt statement is held to the function allow-list", () => {
  const code = [
    "CREATE INDEX ix ON assets ((evil_fn(name)))",
    "CREATE INDEX ix ON assets (name) WHERE evil_fn(name)",
    "CREATE INDEX ix ON assets USING btree (dblink_exec('x', 'DELETE FROM assets'))",
    "CREATE INDEX ix ON config ((evil_fn(k)))",                     // any table — a function can write any table
    "ALTER TABLE assets ADD COLUMN x TEXT DEFAULT evil_fn()",
    "ALTER TABLE assets ADD COLUMN x TEXT GENERATED ALWAYS AS (evil_fn(name)) STORED",
    "ALTER TABLE assets ADD COLUMN x INTEGER CHECK (evil_fn(x))",
    "ALTER TABLE config ADD COLUMN x TEXT DEFAULT dblink_exec('db', 'UPDATE assets SET name = 1')",
    "ALTER TABLE assets ADD COLUMN x TEXT, ADD COLUMN y TEXT DEFAULT public.evil_fn()",
    "ANALYZE ${t}",
  ];
  for (const s of code) test(`charged: ${s}`, () => expect(kindsOf(s)).toEqual(["statement*"]));
  test("charged: ALTER TABLE assets ADD COLUMN x TEXT DEFAULT ${dflt} (an unreadable ADD COLUMN is not exempt)", () => {
    expect(kindsOf("ALTER TABLE assets ADD COLUMN x TEXT DEFAULT ${dflt}")).toEqual(["statement"]);
  });
  const fine = [
    "CREATE INDEX ix ON assets (lower(name))",
    "CREATE INDEX ix ON assets USING gin (name) WHERE name IS NOT NULL",
    "CREATE INDEX ix ON public.assets (name DESC, id)",
    "ALTER TABLE assets ADD COLUMN x VARCHAR(64) DEFAULT 'a' NOT NULL",
    "ALTER TABLE assets ADD COLUMN x NUMERIC(10, 2) CHECK (x > 0)",
    "ALTER TABLE assets ADD COLUMN x TEXT DEFAULT (datetime('now'))",
    "ALTER TABLE assets ADD COLUMN x TIMESTAMP(3) WITH TIME ZONE",
    "ALTER TABLE assets ADD COLUMN x TEXT GENERATED ALWAYS AS (upper(name)) STORED",
    "ANALYZE assets (name)",
  ];
  for (const s of fine) test(`exempt: ${s}`, () => expect(kindsOf(s)).toEqual([]));
});

describe("CREATE TABLE column / table expressions are held to the same allow-list (the #6 class)", () => {
  for (const s of [
    "CREATE TABLE t (id INTEGER PRIMARY KEY, x TEXT DEFAULT evil_fn())",
    "CREATE TABLE t (x TEXT GENERATED ALWAYS AS (evil_fn(1)) STORED)",
    "CREATE TABLE t (x INTEGER CHECK (evil_fn(x)))",
    "CREATE TABLE t (x INTEGER, CONSTRAINT c CHECK (evil_fn(x)))",
    "CREATE TABLE t (x INTEGER, CHECK (dblink_exec('a', 'DELETE FROM assets')))",
    "CREATE TABLE t (x TEXT DEFAULT public.evil_fn())",
    "CREATE TABLE t (x INTEGER CHECK (nextval('s') > 0))",       // nextval only as a column DEFAULT
    "CREATE TABLE t (x TEXT DEFAULT pg_advisory_lock(1))",
    "CREATE TABLE t (x TEXT DEFAULT set_config('row_security', 'off', false))",
    "CREATE TABLE t (x TEXT DEFAULT pg_notify('c', 'p'))",
  ]) test(`charged: ${s}`, () => expect(kindsOf(s)).toEqual(["statement*"]));
  for (const s of [
    "CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, name VARCHAR(64) NOT NULL DEFAULT 'a')",
    "CREATE TABLE t (n NUMERIC(10, 2) CHECK (n > 0), c TEXT DEFAULT CURRENT_TIMESTAMP)",
    "CREATE TABLE t (d TEXT DEFAULT (datetime('now')), u TEXT DEFAULT (lower('X')))",
    "CREATE TABLE t (aid INTEGER REFERENCES public.config(k), UNIQUE (aid), PRIMARY KEY (aid), FOREIGN KEY (aid) REFERENCES config(k))",
    "CREATE TABLE t (x TIMESTAMP(3) WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP, y TEXT COLLATE NOCASE)",
    // a realistic Postgres SaaS table — side-effect-free built-ins are not code execution
    "CREATE TABLE t (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, created_at timestamptz DEFAULT now() NOT NULL, id2 serial)",
    "CREATE TABLE t (id bigint DEFAULT nextval('t_id_seq'::regclass) NOT NULL, k text DEFAULT md5(random()::text))",
    "CREATE TABLE t (u uuid DEFAULT uuid_generate_v4(), d date DEFAULT current_date, m text GENERATED ALWAYS AS (to_char(created, 'YYYY')) STORED, created timestamptz DEFAULT clock_timestamp())",
    "CREATE TABLE t (ts INTEGER DEFAULT (unixepoch()), r BLOB DEFAULT (randomblob(16)), h TEXT DEFAULT (hex(randomblob(4))))",
  ]) test(`exempt: ${s}`, () => expect(kindsOf(s)).toEqual([]));
  test("ALTER TABLE … ADD COLUMN created_at timestamptz DEFAULT now() is exempt; nextval in an index is charged", () => {
    expect(kindsOf("ALTER TABLE assets ADD COLUMN created_at timestamptz DEFAULT now()")).toEqual([]);
    expect(kindsOf("CREATE INDEX ix ON assets ((nextval('s')))")).toEqual(["statement*"]);
  });
  test("a `${…}` in a column default is charged once (by the interpolation rule)", () => {
    expect(kindsOf("CREATE TABLE t (x TEXT DEFAULT ${d})")).toEqual(["statement*"]);
  });
});

// S239 review of 8d1e18b6 (HIGH, PA-reproduced): the expression reader inherited the
// view/trigger reader's keyword exceptions — a name after FROM / ON / JOIN was a "table",
// and NOT_A_CALL words were never checked. EXPRESSION mode is now a token-level allow-list:
// every `identifier (` is a call unless it is one of the enumerated syntactic forms.
describe("expression mode — every `identifier (` is a call, no keyword exceptions", () => {
  const T = "CREATE TABLE assets2 (id INTEGER, name TEXT, ts TIMESTAMP, n INTEGER, tenant_id TEXT)";
  const exprKinds = (stmt) => findSchemaTenantHazards(body(T, stmt), ["assets2"]).map((h) => h.kind + (h.unattributable ? "*" : ""));
  for (const s of [
    "CREATE INDEX i ON assets2 ((extract(epoch FROM evil(ts))))",
    "CREATE INDEX i ON assets2 ((substring('abc' FROM evil(1))))",
    "CREATE INDEX i ON assets2 ((trim(BOTH FROM evil(n))))",
    "CREATE INDEX i ON assets2 ((extract(epoch FROM evil.fn(ts))))",
    "CREATE INDEX i ON assets2 ((match(name)))",
    "CREATE INDEX i ON assets2 ((range(id)))",
    "CREATE TABLE p (ts TIMESTAMP) PARTITION BY RANGE (evil(ts))",
    "CREATE TABLE p (x TEXT DEFAULT 'a'::mytype)",
    "CREATE TABLE p (x TEXT CHECK (CAST(x AS mytype) IS NOT NULL))",
    "CREATE TABLE p (x INTEGER CHECK (x === 1))",
    "CREATE TABLE p (x TEXT DEFAULT pg_catalog.evil())",
    "ALTER TABLE assets2 ADD COLUMN y TEXT DEFAULT match(name)",
  ]) test(`charged: ${s}`, () => expect(exprKinds(s)).toEqual(["statement*"]));
  // the reviewer's realistic SaaS schema shapes
  for (const s of [
    "CREATE TABLE s (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, created_at timestamptz DEFAULT now() NOT NULL, id2 serial, amount numeric(10,2) NOT NULL CHECK (amount >= 0), at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP, status text CHECK (status IN ('open', 'paid')), email text NOT NULL, email_l text GENERATED ALWAYS AS (lower(email)) STORED, deleted_at timestamptz, seq bigint DEFAULT nextval('s_seq'::regclass), d date DEFAULT CAST(now() AS date))",
    "CREATE UNIQUE INDEX u ON assets2 (name) WHERE ts IS NULL",
    "CREATE INDEX l ON assets2 (lower(name))",
    "CREATE INDEX t ON assets2 (date_trunc('day', ts))",
    "CREATE TABLE r (room int, during tsrange, EXCLUDE USING gist (room WITH =, during WITH &&))",
    "CREATE TABLE q (id INTEGER PRIMARY KEY AUTOINCREMENT, c TEXT DEFAULT (datetime('now')), r BLOB DEFAULT (randomblob(16)), u INTEGER DEFAULT (unixepoch()))",
    "CREATE TABLE f (a INT, b INT, PRIMARY KEY (a), UNIQUE (b), FOREIGN KEY (a) REFERENCES public.f2 (x) ON DELETE RESTRICT, CONSTRAINT c CHECK (a > -1 AND (b < 10 OR b IS NULL)))",
    "CREATE TABLE g (id INT GENERATED BY DEFAULT AS IDENTITY (START WITH 1), v varchar(64) COLLATE \"C\", y character varying(10) DEFAULT 'a'::character varying(10)) WITH (fillfactor=70)",
    "CREATE TABLE p (ts TIMESTAMP) PARTITION BY RANGE (ts)",
    "CREATE INDEX i ON assets2 USING btree (name) INCLUDE (id)",
  ]) test(`clean: ${s.slice(0, 70)}`, () => expect(exprKinds(s)).toEqual([]));
});

describe("reporting — every hazard is reported, not one per table", () => {
  test("an ADD CONSTRAINT CHECK and a DROP COLUMN on the same table are both reported", () => {
    const hs = findSchemaTenantHazards(body(ASSETS, "ALTER TABLE assets ADD CONSTRAINT c CHECK (id > 0)", "ALTER TABLE assets DROP COLUMN name"), ["assets"]);
    expect(hs).toHaveLength(2);
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
  test("a realistic Postgres SaaS tenant table compiles clean; an evil_fn default does not", () => {
    const saas = "CREATE TABLE invoices (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, created_at timestamptz DEFAULT now() NOT NULL, id2 serial, tenant_id text NOT NULL)";
    expect(codes(compile({ "app.scrml": prog(saas) }))).not.toContain("E-TENANT-SCHEMA-HAZARD");
    expect(codes(compile({ "app.scrml": prog(saas.replace("now()", "evil_fn()")) }))).toContain("E-TENANT-SCHEMA-HAZARD");
  });
  test("the exempt list compiles clean", () => {
    expect(codes(compile({ "app.scrml": prog(ASSETS, "CREATE INDEX ix ON assets (name)", "ALTER TABLE assets ADD COLUMN extra TEXT",
      `GRANT SELECT ON assets TO ${DBAUTH_ROLE}`) }))).not.toContain("E-TENANT-SCHEMA-HAZARD");
  });
});
