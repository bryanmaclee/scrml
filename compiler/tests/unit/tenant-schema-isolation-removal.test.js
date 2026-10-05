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

const NA = "statement not admitted in a tenant schema*";

describe("(i) the app-role grant is admitted; other privilege / session statements are not admitted", () => {
  for (const s of [
    `GRANT SELECT, INSERT, UPDATE, DELETE ON assets TO ${DBAUTH_ROLE}`,
    `GRANT SELECT ON TABLE public.assets TO "${DBAUTH_ROLE}"`,
    `GRANT SELECT ON config TO ${DBAUTH_ROLE}`,
  ]) test(`admitted: ${s}`, () => expect(kindsOf(s)).toEqual([]));
  // not isolation removals of a tenant table, but outside the allow-list (S455 "your rec on the allow-list")
  for (const s of [
    "GRANT SELECT ON config TO PUBLIC",
    "DROP POLICY p ON config",
    "ALTER TABLE config DISABLE ROW LEVEL SECURITY",
    "CREATE ROLE ok NOLOGIN NOBYPASSRLS",
    "ALTER ROLE ok NOSUPERUSER",
    "SET search_path = public",
    "PRAGMA foreign_keys = ON",
  ]) test(`not admitted: ${s}`, () => expect(kindsOf(s)).toEqual([NA]));
  test("no tenant table in the compilation → nothing is charged at all", () => {
    expect(findSchemaTenantHazards(body(CONFIG, "CREATE ROLE ops BYPASSRLS", "SET row_security = off", "DROP TABLE config"), [])).toEqual([]);
  });
});

// ruling:user-voice-scrml.md S455 "your rec on the allow-list" — a tenant compilation's
// <schema> admits a CLOSED set of statement kinds; everything else is charged, whether or
// not it names a tenant table.
describe("the statement-kind ALLOW-LIST", () => {
  const admitted = [
    "CREATE INDEX ix ON assets (name)",
    "CREATE UNIQUE INDEX IF NOT EXISTS ix ON public.assets (name)",
    "ALTER TABLE assets ADD COLUMN extra TEXT",
    "ALTER TABLE assets ADD extra TEXT",                          // SQLite / Postgres: COLUMN is optional
    "ALTER TABLE assets ADD COLUMN IF NOT EXISTS extra TEXT, ADD COLUMN more INTEGER DEFAULT 0",
    `ALTER TABLE "assets" ADD COLUMN "extra" TEXT`,
    "alter table public.assets add column extra text",
    "ALTER TABLE assets ADD COLUMN tenant_id TEXT",              // the item-2 scoping declaration
    "ALTER TABLE config ADD COLUMN aid INTEGER REFERENCES assets(id)",
    "ALTER TABLE assets ALTER COLUMN name SET NOT NULL",
    "ALTER TABLE assets ALTER name DROP NOT NULL",
    "ALTER TABLE assets ALTER COLUMN name SET DEFAULT 'x'",
    "ALTER TABLE assets ALTER COLUMN name DROP DEFAULT",
    "ALTER TABLE assets RENAME COLUMN name TO title",
    "ALTER TABLE assets RENAME name TO title",
    "ALTER TABLE assets ADD CONSTRAINT c CHECK (length(name) > 0)",
    "ALTER TABLE assets ADD CHECK (id > 0)",
    "ALTER TABLE config ADD CONSTRAINT fk FOREIGN KEY (k) REFERENCES assets(name)",
    "ALTER TABLE config ADD FOREIGN KEY (k) REFERENCES assets(name) ON DELETE RESTRICT ON UPDATE NO ACTION",
    "COMMENT ON TABLE assets IS 'tenant data'",
    "COMMENT ON COLUMN assets.name IS 'x'",
    "ANALYZE assets",
    "REINDEX assets",
    "VACUUM assets",
    "CREATE POLICY p ON config AS RESTRICTIVE USING (true)",
  ];
  for (const s of admitted) test(`admitted: ${s}`, () => expect(kindsOf(s)).toEqual([]));

  const notAdmittedStmts = [
    "DROP TABLE assets",
    "DROP TABLE config",                                           // names no tenant table — still charged
    "DROP TRIGGER t ON assets",
    "DROP INDEX ix",
    "PRAGMA table_info(assets)",
    "REVOKE SELECT ON assets FROM bob",
    "ALTER TABLE assets DROP COLUMN name",
    "ALTER TABLE assets ALTER COLUMN name TYPE TEXT",
    "ALTER TABLE assets ADD CONSTRAINT u UNIQUE (name)",
    "ALTER TABLE assets ADD PRIMARY KEY (id)",
    "ALTER TABLE assets ADD COLUMN extra TEXT, DROP COLUMN name",
    "ALTER TABLE assets ENABLE ROW LEVEL SECURITY",
    "ALTER TABLE assets FORCE ROW LEVEL SECURITY",
    "ALTER TABLE config RENAME TO cfg",
    "INSERT INTO config (k, v) VALUES ('a', 'b')",
    "CREATE SEQUENCE s",
    "CREATE TYPE mood AS ENUM ('a', 'b')",
    "BEGIN",
    // every reviewer finding from the r1 isolation review
    `GRANT ${DBAUTH_ROLE} TO evil`,
    `CREATE ROLE evil IN ROLE ${DBAUTH_ROLE}`,
    "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO PUBLIC",
    "REASSIGN OWNED BY app TO evil",
    "CREATE PUBLICATION pub FOR ALL TABLES",
    "CREATE EXTENSION dblink",
    "SELECT dblink_exec('host=x', 'DELETE FROM assets')",
    "RESET ROLE",
    "SELECT set_config('row_security', 'off', false)",
    "ALTER DATABASE app SET row_security = off",
  ];
  for (const s of notAdmittedStmts) test(`not admitted: ${s}`, () => expect(kindsOf(s)).toEqual([NA]));

  test("an ADD COLUMN holding a `${…}` is unreadable, so charged", () => {
    expect(kindsOf("ALTER TABLE assets ADD COLUMN ${col} TEXT")).toEqual(["statement*"]);
  });
  test("a cascading FK constraint is not admitted (and the FK rule names its tenant end)", () => {
    expect(kindsOf("ALTER TABLE config ADD CONSTRAINT f FOREIGN KEY (k) REFERENCES assets(name) ON DELETE CASCADE").sort())
      .toEqual(["foreign key", NA]);
    expect(kindsOf("ALTER TABLE config ADD CONSTRAINT f FOREIGN KEY (k) REFERENCES other(x) ON DELETE SET NULL")).toEqual([NA]);
  });
  test("the message names the kind and sends roles / privileges to deploy / ops", () => {
    const b = body(ASSETS, "CREATE EXTENSION dblink");
    const [h] = findSchemaTenantHazards(b, ["assets"]);
    const m = schemaHazardMessage(h, b);
    expect(m).toContain("a statement not admitted in a tenant schema");
    expect(m).toContain("`CREATE EXTENSION` is not an admitted statement kind");
    expect(m).toContain("belong to deploy / ops");
  });
  test("the realistic SaaS schema compiles clean", () => {
    const saas = [
      "CREATE TABLE invoices (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, created_at timestamptz DEFAULT now() NOT NULL, n serial, amount numeric(10,2) CHECK (amount >= 0), customer_id uuid, deleted_at timestamptz, tenant_id text NOT NULL)",
      "CREATE TABLE customers (id uuid PRIMARY KEY, email text NOT NULL, tenant_id text NOT NULL)",
      "CREATE TABLE rooms (room int, during tsrange, EXCLUDE USING gist (room WITH =, during WITH &&))",
      "CREATE UNIQUE INDEX inv_live ON invoices (id) WHERE deleted_at IS NULL",
      "CREATE INDEX cust_email ON customers (lower(email))",
      "ALTER TABLE invoices ALTER COLUMN customer_id SET NOT NULL",
      "ALTER TABLE invoices RENAME COLUMN n TO number",
      "ALTER TABLE invoices ADD CONSTRAINT inv_cust FOREIGN KEY (customer_id) REFERENCES customers(id)",
      "COMMENT ON TABLE invoices IS 'billing'",
      "VACUUM invoices",
      `GRANT SELECT, INSERT, UPDATE, DELETE ON invoices TO ${DBAUTH_ROLE}`,
    ];
    const b = body(...saas);
    expect(findSchemaTenantHazards(b, ["invoices", "customers"])).toEqual([]);
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
  test(`GRANT admin TO "SCRML_APP" is not a grant to the app role (a different role) — not admitted, not an isolation removal`, () => {
    expect(kindsOf(`GRANT admin TO "SCRML_APP"`)).toEqual(["statement not admitted in a tenant schema*"]);
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
    expect(kindsOf("ALTER TABLE assets ADD COLUMN x TEXT DEFAULT ${dflt}")).toEqual(["statement*"]);
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

// PA probe of 50150700 (executed): the FROM blind spot survived in view / trigger bodies —
// `SELECT substring('a' FROM evil(1))` in a trigger on a NON-tenant table compiled clean.
// Inside a call's arguments FROM / ON / JOIN introduce no table: every `identifier (` there
// is a call. At the statement's own clause level tables are still read as tables.
describe("view / trigger bodies — FROM inside a call's arguments is not a table", () => {
  const L = "CREATE TABLE logs (id INTEGER, msg TEXT, ts TIMESTAMP)";
  const K = "CREATE TABLE kinds (k TEXT, label TEXT)";
  const bodyKinds = (stmt) => findSchemaTenantHazards(body(ASSETS, L, K, stmt), ["assets"]).map((h) => h.kind + (h.unattributable ? "*" : ""));
  for (const s of [
    "CREATE TRIGGER tl AFTER INSERT ON logs BEGIN SELECT substring('a' FROM evil(1)); END",
    "CREATE TRIGGER tl AFTER INSERT ON logs BEGIN SELECT trim(BOTH FROM evil(NEW.msg)); END",
    "CREATE TRIGGER tl AFTER INSERT ON logs BEGIN SELECT lower(substring(NEW.msg FROM evil.fn(1))); END",
  ]) test(`trigger charged: ${s}`, () => expect(bodyKinds(s)).toEqual(["trigger*"]));
  for (const s of [
    "CREATE VIEW v AS SELECT substring(msg FROM evil(1)) AS s FROM logs",
    "CREATE VIEW v AS SELECT trim(BOTH FROM match(msg)) FROM logs",
  ]) test(`view charged: ${s}`, () => expect(bodyKinds(s)).toEqual(["view*"]));
  for (const s of [
    "CREATE VIEW v AS SELECT l.id, k.label FROM logs l JOIN kinds k ON k.k = l.msg WHERE l.id IN (SELECT id FROM logs WHERE msg IS NOT NULL)",
    "CREATE VIEW v AS SELECT id, (SELECT label FROM kinds WHERE k = msg) AS lab, substring(msg FROM 2 FOR 3) AS s, lower(trim(msg)) FROM logs",
    "CREATE TRIGGER tl AFTER INSERT ON logs BEGIN INSERT INTO kinds (k, label) VALUES (NEW.msg, upper(substring(NEW.msg FROM 1 FOR 2))); END",
  ]) test(`clean: ${s.slice(0, 70)}`, () => expect(bodyKinds(s)).toEqual([]));
  test("tenant-table naming is unchanged: a view joining a tenant table is still a view hazard on it", () => {
    const hs = findSchemaTenantHazards(body(ASSETS, L, "CREATE VIEW v AS SELECT * FROM logs l JOIN assets a ON a.id = l.id"), ["assets"]);
    expect(hs.map((h) => `${h.kind}:${h.tables.join(",")}:${h.unattributable}`)).toEqual(["view:assets:false"]);
  });
});

// S239 review of d4c4d4ac (DO-NOT-LAND; items 1 and 2 PA-reproduced at exit 0).
describe("S239 review of d4c4d4ac — items 1–9", () => {
  const L = "CREATE TABLE logs (id INTEGER, msg TEXT, k TEXT)";
  const k2 = (stmt) => findSchemaTenantHazards(body(ASSETS, L, stmt), ["assets"]).length;
  const charged = (label, list) => { for (const s of list) test(`${label} charged: ${s.slice(0, 80)}`, () => expect(k2(s)).toBeGreaterThan(0)); };
  const clean = (label, list) => { for (const s of list) test(`${label} clean: ${s.slice(0, 80)}`, () => expect(k2(s)).toBe(0)); };
  charged("1 leader", [
    "(SELECT dblink_exec('dbname=app','DELETE FROM ass'||'ets'))",
    "WITH x AS (SELECT 1) SELECT * FROM x",
  ]);
  test("1 leader: a `(`-led statement is 'not admitted'", () => {
    expect(kindsOf("(SELECT dblink_exec('dbname=app','DELETE FROM ass'||'ets'))")).toEqual(["statement not admitted in a tenant schema*"]);
  });
  charged("2 table function", [
    "CREATE VIEW v AS SELECT * FROM evil(1)",
    "CREATE VIEW v AS SELECT * FROM logs JOIN evil(1) ON true",
    "CREATE VIEW v AS WITH c AS (SELECT * FROM evil()) SELECT * FROM c",
    "CREATE VIEW v AS SELECT * FROM logs WHERE id IN (SELECT * FROM evil())",
    "CREATE TRIGGER t AFTER INSERT ON logs BEGIN INSERT INTO logs (msg) SELECT x FROM evil(NEW.k); END",
    "CREATE TRIGGER t AFTER INSERT ON logs BEGIN UPDATE logs SET msg = 'x' FROM evil(1); END",
    "CREATE VIEW v AS SELECT * FROM logs WHERE match(msg)",
  ]);
  clean("2 table reference", [
    "CREATE VIEW v AS SELECT l.id FROM logs l JOIN logs m ON m.id = l.id WHERE l.id IN (SELECT id FROM logs) AND l.msg LIKE ('a%')",
    "CREATE VIEW v AS WITH c (a) AS (SELECT id FROM logs) SELECT * FROM c",
    "CREATE TRIGGER t AFTER INSERT ON logs BEGIN INSERT INTO logs (msg, k) VALUES (NEW.msg, upper(NEW.k)) ON CONFLICT (id) DO NOTHING; END",
  ]);
  clean("3 policy", ["CREATE POLICY p ON assets AS RESTRICTIVE USING (tenant_id = current_setting('scrml.tenant', true))"]);
  charged("3 policy", [
    "CREATE POLICY p ON assets AS RESTRICTIVE USING (evil(tenant_id))",
    "CREATE POLICY p ON assets AS RESTRICTIVE FOR INSERT TO scrml_app WITH CHECK (dblink_exec('a','b') IS NULL)",
  ]);
  charged("4 tenant column", [
    "ALTER TABLE assets RENAME COLUMN tenant_id TO t2",
    "ALTER TABLE assets RENAME COLUMN owner TO tenant_id",
    "ALTER TABLE assets RENAME \"tenant_id\" TO t2",
    "ALTER TABLE assets ALTER COLUMN tenant_id SET DEFAULT 'B'",
    "ALTER TABLE assets ALTER COLUMN tenant_id DROP DEFAULT",
    "ALTER TABLE assets ALTER COLUMN tenant_id TYPE int",
  ]);
  clean("4 tenant column", ["ALTER TABLE assets ALTER COLUMN tenant_id SET NOT NULL", "ALTER TABLE assets RENAME COLUMN name TO title"]);
  charged("5 vacuum", ["VACUUM INTO '/tmp/x.db'", "VACUUM main INTO 'copy.db'"]);
  clean("5 vacuum", ["VACUUM", "VACUUM assets"]);
  charged("6 code-carrying type", [
    "CREATE TABLE t (x mydomain)",
    "CREATE TABLE t (x public.mytype)",
    "CREATE TABLE t (x \"MyType\")",
    "ALTER TABLE assets ADD COLUMN x mydomain",
    "CREATE TABLE t (x TEXT DEFAULT mytype 'a')",
    "CREATE TABLE t (x TEXT CHECK (x::mytype IS NOT NULL))",
    "CREATE INDEX i ON assets USING bloom (name)",
    "CREATE INDEX i ON assets USING gin (name gin_trgm_ops)",
    "CREATE TABLE t (x int) USING columnar",
  ]);
  clean("6 built-in types", [
    "CREATE INDEX i ON assets (name text_pattern_ops)",
    "CREATE INDEX i ON assets USING btree (name DESC NULLS LAST)",
    "CREATE TABLE t (x int) USING heap",
    "CREATE TABLE t (a INTEGER, b TEXT, c REAL, d BLOB, e NUMERIC, f DATETIME, g double precision, h character varying(5), i timestamp with time zone, j int[], k BOOLEAN, l uuid, m jsonb, n bigserial, o)",
    "CREATE TABLE t (d DATE DEFAULT DATE '2020-01-01', i INTERVAL DEFAULT INTERVAL '1 day')",
  ]);
  charged("7/8 grant", [
    "GRANT CREATE ON SCHEMA public TO scrml_app",
    "GRANT TEMP ON DATABASE app TO scrml_app",
    "GRANT TRUNCATE ON assets TO scrml_app",
    "GRANT ALL ON assets TO scrml_app",
    "GRANT ALL PRIVILEGES ON TABLE assets TO scrml_app",
    "GRANT ALL ON ALL TABLES IN SCHEMA public TO scrml_app",
    "GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO scrml_app",
    "GRANT SELECT ON assets TO scrml_app WITH GRANT OPTION",
    "GRANT EXECUTE ON FUNCTION f() TO scrml_app",
    "GRANT USAGE ON FOREIGN DATA WRAPPER w TO scrml_app",
    "GRANT SET ON PARAMETER row_security TO scrml_app",
    "GRANT REFERENCES ON assets TO scrml_app",
    "GRANT TRIGGER ON assets TO scrml_app",
    "GRANT SELECT (name) ON assets TO scrml_app",
  ]);
  test("7: `GRANT CREATE ON SCHEMA …` is ONE statement (not split at CREATE) — reported once", () => {
    expect(kindsOf("GRANT CREATE ON SCHEMA public TO scrml_app")).toEqual(["statement not admitted in a tenant schema*"]);
  });
  clean("8 grant", [
    "GRANT SELECT, INSERT, UPDATE, DELETE ON assets, logs TO scrml_app",
    "GRANT SELECT ON TABLE public.assets TO scrml_app",
    "GRANT USAGE, SELECT ON SEQUENCE s TO scrml_app",
  ]);
  clean("9 pure functions", [
    "CREATE TABLE t (a TEXT CHECK (length(left(a, 3)) > 0 AND json_valid(a) AND iif(1, 1, 0) = 1), b TEXT DEFAULT (printf('%d', 1)), c INT CHECK (mod(c, 2) = 0))",
    "CREATE TABLE t (a TEXT CHECK (char_length(trim(a)) BETWEEN 1 AND 80), s tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(a, ''))) STORED, f TEXT CHECK (starts_with(a, 'x') OR ascii(a) > 0))",
    "CREATE INDEX i ON assets (split_part(name, '-', 1), lower(regexp_replace(name, '[^a-z]', '', 'g')))",
  ]);
});

describe("reporting — every hazard is reported, not one per table", () => {
  test("two charged statements on the same table are both reported", () => {
    const hs = findSchemaTenantHazards(body(ASSETS, "ALTER TABLE assets ADD CONSTRAINT u UNIQUE (id)", "ALTER TABLE assets DROP COLUMN name"), ["assets"]);
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
