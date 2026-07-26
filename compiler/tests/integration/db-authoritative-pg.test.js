/**
 * §14.8.11 DB-authoritative tier — Milestone 1 (reads-authoritative) NEGATIVE TEST.
 *
 * THE acceptance gate for the atomic milestone: applies the M1-emitted DDL for a
 * `db-authoritative` `invoices` table to a REAL Postgres 16, seeds two tenants'
 * rows, then proves the trust-boundary reversal end-to-end:
 *   (control) a superuser WITHOUT dropping to the bounded role BYPASSES FORCE RLS
 *             → sees ALL rows (spike finding F1 — S6 is mandatory, not optional).
 *   (a) the bounded `scrml_app` role with NO `set_config` reads ZERO rows
 *       (`current_setting('scrml.tenant', true)` → NULL → matches no row → fail-closed).
 *   (b) the bounded role WITH `set_config('scrml.tenant', <tenantA>)` reads ONLY
 *       tenant-A rows.
 * Mirrors the P0 spike exactly, and re-exercises the SAME per-request principal
 * shape the A1 emitter injects (`begin` → `set_config(…, true)` → `SET LOCAL ROLE`).
 *
 * CI REALITY: the cloud `gate` (unit+conformance+gauntlet) CANNOT depend on a live
 * Postgres (infra-flaky), so this test SKIPS GRACEFULLY when PG is unreachable —
 * it probes the `/var/run/postgresql` unix socket at load and disables itself if
 * the probe connection fails (or if `SCRML_PGTEST=0` is set). It is the LOCAL
 * acceptance proof and MUST NOT red the cloud gate.
 *
 * Run locally: `bun test compiler/tests/integration/db-authoritative-pg.test.js`
 * Force-disable: `SCRML_PGTEST=0 bun test …`
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync } from "fs";
import { SQL } from "bun";
import {
  parseSchemaBlock,
  diffSchema,
  generateDbAuthoritativeDDL,
} from "../../src/schema-differ.js";

const SOCK = "/var/run/postgresql";
const PG_USER = process.env.PGUSER || process.env.USER || "postgres";
const SCRATCH_DB = `scrml_dbauth_m1test_${process.pid}`;

// Two tenants (uuid — the brief/spike shape; the M1 DDL emitter passes the
// PG-native `uuid` type through verbatim and casts the policy GUC to `::uuid`).
const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";

// The exact brief `invoices` schema. The DDL is produced by the REAL M1 emitters
// (parseSchemaBlock → diffSchema/generateDbAuthoritativeDDL) — NOT hand-written.
const SCHEMA_BODY = `
  invoices {
    id: uuid primary key
    tenant_id: uuid not null
    amount: decimal not null
  } db-authoritative
`;

// --- Connectivity probe (load-time; disables the suite on failure) ---------
let PG_OK = false;
if (process.env.SCRML_PGTEST !== "0" && existsSync(`${SOCK}/.s.PGSQL.5432`)) {
  const probe = new SQL({ path: SOCK, database: "postgres", username: PG_USER });
  const ok = await probe
    .unsafe("SELECT 1")
    .then(() => true)
    .catch(() => false);
  await probe.close().catch(() => {});
  PG_OK = ok;
}

if (!PG_OK) {
  // eslint-disable-next-line no-console
  console.log(
    "[db-authoritative-pg] Postgres not reachable on " +
      `${SOCK} — skipping the live DB-authoritative negative test (local-only acceptance gate).`,
  );
}

const d = PG_OK ? describe : describe.skip;

d("§14.8.11 DB-authoritative reads (live Postgres negative test)", () => {
  let sql;
  let createTableSql;
  let dbauthDDL;

  beforeAll(async () => {
    // Provision a throwaway scratch database (isolated from any real DB).
    const admin = new SQL({ path: SOCK, database: "postgres", username: PG_USER });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${SCRATCH_DB}`);
    await admin.unsafe(`CREATE DATABASE ${SCRATCH_DB}`);
    await admin.close();

    sql = new SQL({ path: SOCK, database: SCRATCH_DB, username: PG_USER });

    // The M1-emitted DDL (the artifact under test).
    const parsed = parseSchemaBlock(SCHEMA_BODY);
    const table = parsed.tables[0];
    createTableSql = diffSchema(parsed, { tables: [] }, { driver: "postgres" }).sql[0];
    dbauthDDL = generateDbAuthoritativeDDL(table);

    // 1. create the table, 2. seed BOTH tenants BEFORE enabling RLS, 3. apply the
    // DB-authoritative DDL (role/grant/enable/force/policy).
    await sql.unsafe(createTableSql);
    await sql`INSERT INTO invoices (id, tenant_id, amount) VALUES (gen_random_uuid(), ${TENANT_A}, 100.00)`;
    await sql`INSERT INTO invoices (id, tenant_id, amount) VALUES (gen_random_uuid(), ${TENANT_A}, 200.00)`;
    await sql`INSERT INTO invoices (id, tenant_id, amount) VALUES (gen_random_uuid(), ${TENANT_B}, 999.00)`;
    for (const stmt of dbauthDDL) await sql.unsafe(stmt);

    // The connecting principal must be able to SET ROLE to scrml_app. A superuser
    // can already; for a non-superuser table-owner, grant membership (idempotent).
    const who = (await sql`SELECT current_user AS u`)[0].u;
    await sql.unsafe(`GRANT scrml_app TO "${who}"`).catch(() => {});
  });

  afterAll(async () => {
    if (sql) await sql.close().catch(() => {});
    const admin = new SQL({ path: SOCK, database: "postgres", username: PG_USER });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${SCRATCH_DB}`).catch(() => {});
    await admin.close().catch(() => {});
  });

  test("emitted DDL matches the spike-validated S1/S6 shape", () => {
    const joined = dbauthDDL.join("\n");
    expect(createTableSql).toContain('"tenant_id" uuid NOT NULL');
    expect(joined).toContain("CREATE ROLE scrml_app NOLOGIN NOBYPASSRLS");
    // S288 RULING — PK + `tenant_id` are auto-immutable on a db-authoritative
    // table, so the grant is column-scoped even with nothing declared `immutable`.
    expect(joined).toContain('GRANT SELECT, INSERT, DELETE ON "invoices" TO scrml_app');
    expect(joined).toContain('REVOKE UPDATE ON "invoices" FROM scrml_app');
    expect(joined).toContain('GRANT UPDATE ("amount") ON "invoices" TO scrml_app');
    expect(joined).toContain('ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY');
    expect(joined).toContain('ALTER TABLE "invoices" FORCE ROW LEVEL SECURITY');
    expect(joined).toContain(
      `CREATE POLICY scrml_tenant_iso ON "invoices" USING ("tenant_id" = current_setting('scrml.tenant', true)::uuid)`,
    );
  });

  test("control: superuser bypasses FORCE RLS without the role drop (S6 is mandatory)", async () => {
    // Proves finding F1: without dropping to the bounded NOBYPASSRLS role, the
    // owning superuser sees ALL rows — A1 WITHOUT S6 would be a silent no-op.
    const rows = await sql`SELECT count(*)::int AS n FROM invoices`;
    expect(rows[0].n).toBe(3);
  });

  test("(a) bounded role, NO set_config → ZERO rows (fail-closed)", async () => {
    const rows = await sql.begin(async (tx) => {
      await tx.unsafe("SET LOCAL ROLE scrml_app");
      return await tx`SELECT count(*)::int AS n FROM invoices`;
    });
    expect(rows[0].n).toBe(0);
  });

  test("(b) bounded role WITH set_config(tenantA) → ONLY tenant-A rows", async () => {
    const rows = await sql.begin(async (tx) => {
      await tx`SELECT set_config('scrml.tenant', ${TENANT_A}, true)`;
      await tx.unsafe("SET LOCAL ROLE scrml_app");
      return await tx`SELECT id, tenant_id, amount FROM invoices`;
    });
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.tenant_id === TENANT_A)).toBe(true);
  });
});
