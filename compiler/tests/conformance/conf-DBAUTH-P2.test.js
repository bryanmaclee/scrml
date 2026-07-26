/**
 * CONF-DBAUTH-P2 | §14.8.11.2 — DB-authoritative writes-authority (S3 + S4).
 *
 * The conformance surface pin (merge-blocker) for P2 — the FIRST milestone that
 * crosses the §14.8.10 invariant/policy firewall (scrml emits AUTHORIZATION). Halves:
 *   - codes-half: `E-DBAUTH-SQLITE` fires when a SECURITY-DEFINER `fn` targets a
 *     non-Postgres driver (SECDEF is Postgres-only), and NOT on a Postgres target.
 *   - S3 SQL-shape (deterministic): an `immutable` column re-shapes M1's blanket
 *     table-level UPDATE grant to column-scoped (REVOKE UPDATE + GRANT UPDATE(cols));
 *     ZERO immutable columns stays BYTE-IDENTICAL to M1.
 *   - S4 SQL-shape (deterministic): the emitted SECDEF carries every hardening
 *     invariant (SECURITY DEFINER + search_path pin + bounded owner + REVOKE PUBLIC
 *     EXECUTE + the un-bypassable cap check), and diffSchema wires it onto the plan.
 *   - A1-wrapper compile-shape (deterministic): a db-authoritative app pins the
 *     scrml.principal.caps GUC alongside scrml.tenant and emits _scrml_active_caps.
 *
 * The live-Postgres 4-assertion NEGATIVE test is the runtime-half; it is local-gated
 * (`compiler/tests/integration/db-authoritative-p2-pg.test.js`).
 *
 * Catalog (SPEC §34, §14.8.11.2): E-DBAUTH-SQLITE (Error, trigger extended to a
 * SECDEF fn). DDL: schema-differ.js (generateSecdefDDL / generateScrmlHasCapDDL /
 * generateDbAuthoritativeDDL). Caps GUC: codegen/db-authoritative.ts + tenant-egress.ts.
 */
import { describe, test, expect, afterAll } from "bun:test";
import { writeFileSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import {
  parseSchemaBlock,
  diffSchema,
  generateDbAuthoritativeDDL,
  generateSecdefDDL,
  generateScrmlHasCapDDL,
} from "../../src/schema-differ.js";

const _tmp = [];
afterAll(() => { for (const d of _tmp) { try { rmSync(d, { recursive: true, force: true }); } catch {} } });

// A db-authoritative app with an `immutable` column + a SECDEF `fn` + a query site.
function app(dbVal) {
  return `<program db="${dbVal}">
  <schema>
    invoices {
      id: uuid primary key
      tenant_id: uuid not null
      status: text not null immutable
      amount: decimal not null immutable
      memo: text
    } db-authoritative

    fn void_invoice(id: uuid) security definer owner(invoice_admin) requires cap("void") {
      """
      UPDATE invoices SET status = 'void' WHERE invoices.id = void_invoice.id;
      """
    }
  </schema>

  function listInvoices() {
    const rows = ?{ select id, tenant_id, status from invoices }
    rows
  }
</program>`;
}

function compile(dbVal) {
  const dir = mkdtempSync(join(tmpdir(), "conf-dbauth-p2-"));
  _tmp.push(dir);
  const file = join(dir, "app.scrml");
  writeFileSync(file, app(dbVal));
  return compileScrml({ inputFiles: [file], write: false, gather: true, log: () => {} });
}
const codes = (r) => new Set([...(r.errors ?? []), ...(r.warnings ?? [])].map((d) => d.code));
const serverJs = (r) => {
  for (const out of r.outputs?.values() ?? []) if (out?.serverJs) return out.serverJs;
  return "";
};

// ---------------------------------------------------------------------------
describe("CONF-DBAUTH-P2 (codes-half): E-DBAUTH-SQLITE covers a SECDEF fn", () => {
  test("fires — a SECURITY-DEFINER fn on a SQLite target (SECDEF is Postgres-only)", () => {
    expect(codes(compile("./app.db")).has("E-DBAUTH-SQLITE")).toBe(true);
  });
  test("does NOT fire — on a Postgres target", () => {
    expect(codes(compile("postgres://localhost/app")).has("E-DBAUTH-SQLITE")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("CONF-DBAUTH-P2 (S3 SQL-shape): the immutable GRANT reshape", () => {
  test("an immutable column re-shapes the table-level UPDATE grant to column-scoped", () => {
    const t = parseSchemaBlock(`
      invoices {
        id: uuid primary key
        tenant_id: uuid not null
        amount: decimal not null immutable
        memo: text
      } db-authoritative
    `).tables[0];
    const ddl = generateDbAuthoritativeDDL(t).join("\n");
    expect(ddl).not.toContain("GRANT SELECT, INSERT, UPDATE, DELETE"); // no blanket UPDATE
    expect(ddl).toContain('GRANT SELECT, INSERT, DELETE ON "invoices" TO scrml_app;');
    expect(ddl).toContain('REVOKE UPDATE ON "invoices" FROM scrml_app;');
    expect(ddl).toContain('GRANT UPDATE ("id", "tenant_id", "memo") ON "invoices" TO scrml_app;');
  });

  test("ZERO immutable columns stays BYTE-IDENTICAL to M1", () => {
    const t = parseSchemaBlock(`
      invoices { id: uuid primary key  tenant_id: uuid not null  amount: decimal not null } db-authoritative
    `).tables[0];
    expect(generateDbAuthoritativeDDL(t)).toContain(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON "invoices" TO scrml_app;',
    );
  });
});

// ---------------------------------------------------------------------------
describe("CONF-DBAUTH-P2 (S4 SQL-shape): the hardened SECDEF mutation choke", () => {
  const parsed = parseSchemaBlock(app("postgres://x").match(/<schema>([\s\S]*)<\/schema>/)[1]);
  const fn = parsed.fns[0];

  test("scrml_has_cap is hardened + fail-closed", () => {
    const h = generateScrmlHasCapDDL();
    expect(h).toContain("CREATE OR REPLACE FUNCTION scrml_has_cap(cap text) RETURNS boolean");
    expect(h).toContain("SET search_path = pg_catalog, public");
    expect(h).toContain("coalesce(current_setting('scrml.principal.caps', true)::jsonb ? cap, false)");
  });

  test("the SECDEF carries every hardening invariant", () => {
    const ddl = generateSecdefDDL(fn, ["invoices"]).join("\n");
    expect(ddl).toContain("SECURITY DEFINER");
    expect(ddl).toContain("SET search_path = pg_catalog, public");
    expect(ddl).not.toContain("pg_temp");
    expect(ddl).toContain('CREATE ROLE "invoice_admin" NOLOGIN NOBYPASSRLS');
    expect(ddl).toContain(`ALTER FUNCTION "void_invoice"(uuid) OWNER TO "invoice_admin";`);
    expect(ddl).toContain(`REVOKE EXECUTE ON FUNCTION "void_invoice"(uuid) FROM PUBLIC;`);
    expect(ddl).toContain(`GRANT EXECUTE ON FUNCTION "void_invoice"(uuid) TO scrml_app;`);
    // the cap check is the FIRST statement inside the emitter-owned BEGIN, schema-qualified.
    expect(ddl).toMatch(/BEGIN\s+IF NOT public\.scrml_has_cap\('void'\) THEN RAISE EXCEPTION 'denied'; END IF;/);
  });

  test("diffSchema (postgres) wires scrml_has_cap + the SECDEF onto the plan; sqlite emits neither", () => {
    const pg = diffSchema(parsed, { tables: [] }, { driver: "postgres" }).sql.join("\n");
    expect(pg).toContain("CREATE OR REPLACE FUNCTION scrml_has_cap(cap text)");
    expect(pg).toContain(`CREATE OR REPLACE FUNCTION "void_invoice"("id" uuid) RETURNS void`);
    const lite = diffSchema(parsed, { tables: [] }, { driver: "sqlite" }).sql.join("\n");
    expect(lite).not.toContain("SECURITY DEFINER");
    expect(lite).not.toContain("scrml_has_cap");
  });
});

// ---------------------------------------------------------------------------
describe("CONF-DBAUTH-P2 (A1-wrapper compile-shape): the capability GUC injection", () => {
  test("a db-authoritative app pins scrml.principal.caps alongside scrml.tenant + emits the resolver", () => {
    const js = serverJs(compile("postgres://localhost/app"));
    expect(js).toContain("set_config('scrml.tenant', ${_scrml_active_tenant(_scrml_req)}, true)");
    expect(js).toContain("set_config('scrml.principal.caps', ${_scrml_active_caps(_scrml_req)}, true)");
    expect(js).toContain("function _scrml_active_caps(req)");
    // server-resolved, never client-supplied (fail-closed default).
    expect(js).toContain("(_cu && Array.isArray(_cu.caps)) ? _cu.caps : []");
  });
});
