/**
 * §8.1.2 (S456) — one SQL statement per `?{}`: the LIVE Postgres half.
 *
 * Gap g-tenant-set-config-in-program-body-s456 (CONFIRMED by the S239 r5 review on PG16): under the
 * §14.8.11 tier, `?{ SELECT set_config('scrml.tenant','B',true); select … from invoices }.acrossTenants()`
 * returned tenant B's rows to a tenant-A request, and `set_config('role','none',true)` returned every
 * tenant. This test runs the REAL tier wrapper (`wrapPrincipalTxn`) over the pre-S456 emission and over
 * the guarded emission (`rewriteSqlRefs`), against a real `db-authoritative` table (the real M1 DDL):
 *   - pre-S456: `tx.unsafe("<two statements>")` — Postgres' simple-query protocol runs both; the
 *     tenant / role re-pin leaks (the hazard the rule closes, reproduced);
 *   - head: the compile refuses the body (E-SQL-MULTIPLE-STATEMENTS, unit test), and the emitted
 *     site throws before anything is sent — the wrapper's own principal statements run, the query
 *     never does.
 *
 * Skips when Postgres is unreachable on the /var/run/postgresql socket (or SCRML_PGTEST=0) — the
 * cloud gate cannot depend on a live database (the db-authoritative-pg.test.js convention).
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync } from "fs";
import { SQL } from "bun";
import { parseSchemaBlock, diffSchema, generateDbAuthoritativeDDL } from "../../src/schema-differ.js";
import { wrapPrincipalTxn } from "../../src/codegen/db-authoritative.ts";
import { rewriteSqlRefs } from "../../src/codegen/rewrite.ts";

const PG_HOOK_TIMEOUT_MS = 120_000;
const SOCK = "/var/run/postgresql";
const PG_USER = process.env.PGUSER || process.env.USER || "postgres";
const SCRATCH_DB = `scrml_one_stmt_test_${process.pid}`;
const BT = "`";

let PG_OK = false;
if (process.env.SCRML_PGTEST !== "0" && existsSync(`${SOCK}/.s.PGSQL.5432`)) {
  const probe = new SQL({ path: SOCK, database: "postgres", username: PG_USER });
  PG_OK = await probe.unsafe("SELECT 1").then(() => true).catch(() => false);
  await probe.close().catch(() => {});
}
if (!PG_OK) {
  // eslint-disable-next-line no-console
  console.log(`[sql-one-statement-pg] Postgres not reachable on ${SOCK} — skipping the live one-statement test.`);
}
const d = PG_OK ? describe : describe.skip;

const SCHEMA_BODY = `
  invoices {
    id: text primary key
    tenant_id: text not null
    amount: real not null
  } db-authoritative
`;

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

/**
 * A server handler whose body is `emittedQuery`, passed through the REAL §14.8.11 tier wrapper, then
 * run with tenant A pinned (the wrapper's `_scrml_active_tenant(_scrml_req)`).
 */
async function runUnderTier(sql, emittedQuery) {
  const handlerSrc = `async function listInvoices(_scrml_req) {\n  const rows = ${emittedQuery};\n  return rows;\n}\nreturn listInvoices;`;
  const wrapped = wrapPrincipalTxn(handlerSrc);
  expect(wrapped).toContain("SET LOCAL ROLE");
  const make = new Function("_scrml_sql", "_scrml_active_tenant", "_scrml_active_caps", wrapped);
  const handler = make(sql, () => "A", () => "");
  return { wrapped, rows: await handler({}) };
}

d("§8.1.2 one statement per ?{} — live Postgres under the §14.8.11 tier", () => {
  let sql;

  beforeAll(async () => {
    const admin = new SQL({ path: SOCK, database: "postgres", username: PG_USER });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${SCRATCH_DB}`);
    await admin.unsafe(`CREATE DATABASE ${SCRATCH_DB}`);
    await admin.close();
    sql = new SQL({ path: SOCK, database: SCRATCH_DB, username: PG_USER });
    const parsed = parseSchemaBlock(SCHEMA_BODY);
    await sql.unsafe(diffSchema(parsed, { tables: [] }, { driver: "postgres" }).sql[0]);
    await sql`INSERT INTO invoices (id, tenant_id, amount) VALUES ('a1', 'A', 100)`;
    await sql`INSERT INTO invoices (id, tenant_id, amount) VALUES ('b1', 'B', 999)`;
    for (const stmt of generateDbAuthoritativeDDL(parsed.tables[0])) await sql.unsafe(stmt);
    const who = (await sql`SELECT current_user AS u`)[0].u;
    await sql.unsafe(`GRANT scrml_app TO "${who}"`).catch(() => {});
  }, PG_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    if (sql) await sql.close().catch(() => {});
    const admin = new SQL({ path: SOCK, database: "postgres", username: PG_USER });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${SCRATCH_DB}`).catch(() => {});
    await admin.close().catch(() => {});
  }, PG_HOOK_TIMEOUT_MS);

  const TENANT_REPIN = "SELECT set_config('scrml.tenant','B',true); select id, tenant_id, amount from invoices";
  const ROLE_RESET = "SELECT set_config('role','none',true); select id, tenant_id, amount from invoices";
  const tenantsIn = (rows) => [...new Set(rows.flat().filter((r) => r && r.tenant_id).map((r) => r.tenant_id))].sort();

  test("control: a single-statement `.acrossTenants()` read under the tier sees tenant A only (RLS)", async () => {
    const { rows } = await runUnderTier(sql, rewriteSqlRefs(`?{${BT}select id, tenant_id, amount from invoices;${BT}}.acrossTenants()`, "_scrml_sql"));
    expect(tenantsIn(rows)).toEqual(["A"]);
  });

  test("pre-S456 emission (tenant re-pin): Postgres runs both statements — tenant B's row reaches a tenant-A request", async () => {
    const { rows } = await runUnderTier(sql, `await _scrml_sql.unsafe(${JSON.stringify(TENANT_REPIN)})`);
    expect(tenantsIn(rows)).toEqual(["B"]);
  });

  test("pre-S456 emission (role reset): every tenant's rows under a superuser / BYPASSRLS login", async () => {
    const su = (await sql`SELECT rolsuper OR rolbypassrls AS b FROM pg_roles WHERE rolname = current_user`)[0].b;
    if (!su) return; // the role reset reaches the login's own role; only a bypassing login reads all
    const { rows } = await runUnderTier(sql, `await _scrml_sql.unsafe(${JSON.stringify(ROLE_RESET)})`);
    expect(tenantsIn(rows)).toEqual(["A", "B"]);
  });

  for (const [name, body] of [["tenant re-pin", TENANT_REPIN], ["role reset", ROLE_RESET]]) {
    for (const chain of [".acrossTenants()", ".acrossTenants().all()", ""]) {
      test(`head emission (${name}, ?{}${chain}): the site throws E-SQL-MULTIPLE-STATEMENTS and sends nothing`, async () => {
        const emitted = rewriteSqlRefs(`?{${BT}${body}${BT}}${chain}`, "_scrml_sql");
        expect(emitted).not.toContain("set_config('scrml.tenant','B'");
        expect(emitted).not.toContain("set_config('role'");
        await expect(runUnderTier(sql, emitted)).rejects.toThrow("E-SQL-MULTIPLE-STATEMENTS");
      });
    }
  }
});
