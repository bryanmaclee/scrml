/**
 * CONF-DBAUTH-M1 | §14.8.11 — opt-in DB-authoritative tier, Milestone 1 (reads).
 *
 * The conformance surface pin (merge-blocker) for M1. Three halves:
 *   - codes-half: `E-DBAUTH-SQLITE` fires when a `db-authoritative` table targets
 *     a non-Postgres driver, and does NOT fire on a Postgres target (fail-closed).
 *   - SQL-shape half (deterministic): the M1-emitted DDL for a `db-authoritative`
 *     table carries the spike-validated S6 bounded-role + S1 FORCE-RLS + tenant-iso
 *     policy shape, and the S7-minimal fence keeps `DROP TABLE` off the Postgres
 *     migration path.
 *   - A1-wrapper compile-shape (deterministic): a db-authoritative Postgres app's
 *     emitted `.server.js` wraps every `?{}` in a principal `.begin(…)` txn
 *     (set_config + SET LOCAL ROLE), and a NON-db-authoritative app emits NONE of
 *     those markers — the conditional-engagement byte-identical guard.
 *
 * The live-Postgres NEGATIVE test (a raw bounded-role connection reads zero rows)
 * is the runtime-half; it is local-gated (`compiler/tests/integration/
 * db-authoritative-pg.test.js`) because the cloud gate cannot depend on a live PG.
 *
 * Catalog (SPEC §34, §14.8.11): E-DBAUTH-SQLITE (Error). Firing site: the
 * driver-resolution stage in codegen/index.ts. DDL: schema-differ.js. A1 wrapper:
 * codegen/db-authoritative.ts + emit-server.ts.
 */
import { describe, test, expect, afterAll } from "bun:test";
import { writeFileSync, mkdtempSync, rmSync } from "fs";
import { spawnSync } from "child_process";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import {
  parseSchemaBlock,
  diffSchema,
  generateDbAuthoritativeDDL,
} from "../../src/schema-differ.js";

const _tmp = [];
afterAll(() => { for (const d of _tmp) { try { rmSync(d, { recursive: true, force: true }); } catch {} } });

function app(dbVal, marker) {
  return `<program db="${dbVal}">
  <schema>
    invoices {
      id: text primary key
      tenant_id: text not null
      amount: real not null
    }${marker}
  </schema>

  function listInvoices() {
    const rows = ?{ select id, tenant_id, amount from invoices }
    rows
  }
</program>`;
}

function compile(dbVal, marker) {
  const dir = mkdtempSync(join(tmpdir(), "conf-dbauth-"));
  _tmp.push(dir);
  const file = join(dir, "app.scrml");
  writeFileSync(file, app(dbVal, marker));
  const r = compileScrml({ inputFiles: [file], write: false, gather: true, log: () => {} });
  return r;
}
const codes = (r) => new Set([...(r.errors ?? []), ...(r.warnings ?? [])].map((d) => d.code));
const serverJs = (r) => {
  for (const out of r.outputs?.values() ?? []) if (out?.serverJs) return out.serverJs;
  return "";
};

// ---------------------------------------------------------------------------
describe("CONF-DBAUTH-M1 (codes-half): E-DBAUTH-SQLITE fail-closed gate", () => {
  test("fires — db-authoritative table on a SQLite target", () => {
    const r = compile("./app.db", " db-authoritative");
    expect(codes(r).has("E-DBAUTH-SQLITE")).toBe(true);
  });

  test("does NOT fire — db-authoritative table on a Postgres target", () => {
    const r = compile("postgres://localhost/app", " db-authoritative");
    expect(codes(r).has("E-DBAUTH-SQLITE")).toBe(false);
  });

  test("does NOT fire — no db-authoritative marker (SQLite is the default)", () => {
    const r = compile("./app.db", "");
    expect(codes(r).has("E-DBAUTH-SQLITE")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("CONF-DBAUTH-M1 (SQL-shape half): the emitted S1/S6 DDL", () => {
  const parsed = parseSchemaBlock(`
    invoices {
      id: uuid primary key
      tenant_id: uuid not null
      amount: decimal not null
    } db-authoritative
  `);
  const table = parsed.tables[0];

  test("the marker parses to a dbAuthoritative table", () => {
    expect(table.dbAuthoritative).toBe(true);
  });

  test("S6 — a bounded NOLOGIN NOBYPASSRLS role + scoped GRANT", () => {
    const ddl = generateDbAuthoritativeDDL(table).join("\n");
    expect(ddl).toContain("CREATE ROLE scrml_app NOLOGIN NOBYPASSRLS");
    expect(ddl).toContain('GRANT SELECT, INSERT, UPDATE, DELETE ON "invoices" TO scrml_app');
  });

  test("S1 — ENABLE + FORCE RLS + tenant-iso policy keyed on the pinned GUC", () => {
    const ddl = generateDbAuthoritativeDDL(table).join("\n");
    expect(ddl).toContain('ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY');
    expect(ddl).toContain('ALTER TABLE "invoices" FORCE ROW LEVEL SECURITY');
    expect(ddl).toContain('DROP POLICY IF EXISTS scrml_tenant_iso ON "invoices"');
    expect(ddl).toContain(
      `CREATE POLICY scrml_tenant_iso ON "invoices" USING ("tenant_id" = current_setting('scrml.tenant', true)::uuid)`,
    );
  });

  test("S7-minimal fence — diffSchema appends the DDL and never DROPs the table on Postgres", () => {
    const { sql } = diffSchema(parsed, { tables: [] }, { driver: "postgres" });
    const joined = sql.join("\n");
    expect(joined).toContain('CREATE TABLE "invoices"');
    expect(joined).toContain("FORCE ROW LEVEL SECURITY");
    // A 12-step DROP/recreate would CASCADE-drop the RLS policy — never on Postgres.
    expect(joined).not.toContain('DROP TABLE "invoices"');
  });

  test("SQLite path stays byte-identical (no db-authoritative DDL on sqlite)", () => {
    const { sql } = diffSchema(parsed, { tables: [] }, { driver: "sqlite" });
    const joined = sql.join("\n");
    expect(joined).not.toContain("ROW LEVEL SECURITY");
    expect(joined).not.toContain("CREATE ROLE");
  });
});

// ---------------------------------------------------------------------------
describe("CONF-DBAUTH-M1 (A1-wrapper compile-shape): conditional engagement", () => {
  test("db-authoritative Postgres app wraps ?{} in a principal .begin() txn", () => {
    const js = serverJs(compile("postgres://localhost/app", " db-authoritative"));
    expect(js).toContain("_scrml_sql.begin(async (tx) =>");
    expect(js).toContain("set_config('scrml.tenant', ${_scrml_active_tenant(_scrml_req)}, true)");
    expect(js).toContain('tx.unsafe("SET LOCAL ROLE scrml_app")');
    // the query runs on the tx, never the shared pool handle
    expect(js).toContain('return await tx.unsafe("select id, tenant_id, amount from invoices")');
  });

  test("NON-db-authoritative Postgres app emits NO A1 markers (byte-identical fast path)", () => {
    const js = serverJs(compile("postgres://localhost/app", ""));
    expect(js).not.toContain(".begin(async (tx) =>");
    expect(js).not.toContain("set_config('scrml.tenant'");
    expect(js).not.toContain("SET LOCAL ROLE scrml_app");
    // the query runs directly on the shared handle (today's fast path)
    expect(js).toContain('_scrml_sql.unsafe("select id, tenant_id, amount from invoices")');
  });

  test("the shipped postgres sample carries NO A1 markers (anti-regression anchor)", () => {
    const sample = join(import.meta.dir, "../../../samples/compilation-tests/postgres-program-driver.scrml");
    const r = compileScrml({ inputFiles: [sample], write: false, gather: true, log: () => {} });
    const js = serverJs(r);
    expect(js.length).toBeGreaterThan(0);
    expect(js).not.toContain(".begin(async (tx)");
    expect(js).not.toContain("set_config('scrml.tenant'");
    expect(js).not.toContain("SET LOCAL ROLE scrml_app");
  });

  test("the wrapped db-authoritative server bundle is syntactically valid (node --check)", () => {
    // Full-pipeline check: the real emitted .server.js (with the A1 wrapper) parses
    // as valid JS — the wrapper never produces broken syntax (execute-don't-grep
    // belt over the text assertions above).
    const js = serverJs(compile("postgres://localhost/app", " db-authoritative"));
    expect(js.length).toBeGreaterThan(0);
    const dir = mkdtempSync(join(tmpdir(), "conf-dbauth-check-"));
    _tmp.push(dir);
    const f = join(dir, "app.server.mjs");
    writeFileSync(f, js);
    const r = spawnSync("node", ["--check", f], { encoding: "utf8" });
    expect(r.status).toBe(0);
  });
});
