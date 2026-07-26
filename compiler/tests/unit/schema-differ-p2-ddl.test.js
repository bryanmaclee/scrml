/**
 * §14.8.11.2 DB-authoritative P2 — S3 immutable GRANT reshape emission.
 *
 * A Postgres column-level REVOKE cannot narrow a table-level GRANT, so an
 * `immutable` column forces re-shaping M1's blanket `GRANT … UPDATE …` into a
 * column-scoped grant. HARD anti-regression: a db-authoritative table with ZERO
 * immutable columns must emit BYTE-IDENTICAL to M1.
 */

import { describe, test, expect } from "bun:test";
import {
  parseSchemaBlock,
  generateDbAuthoritativeDDL,
  generateSecdefDDL,
  generateScrmlHasCapDDL,
  diffSchema,
} from "../../src/schema-differ.js";

const table = (body) => parseSchemaBlock(body).tables[0];

describe("§14.8.11.2 S3 — generateDbAuthoritativeDDL GRANT reshape", () => {
  test("ZERO immutable columns → BYTE-IDENTICAL to M1 (table-level UPDATE grant kept)", () => {
    const t = table(`
      invoices {
        id: uuid primary key
        tenant_id: uuid not null
        amount: decimal not null
      } db-authoritative
    `);
    const ddl = generateDbAuthoritativeDDL(t);
    // The exact M1 shape (matches compiler/tests/integration/db-authoritative-pg.test.js).
    expect(ddl).toEqual([
      `DO $$ BEGIN CREATE ROLE scrml_app NOLOGIN NOBYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
      `GRANT SELECT, INSERT, UPDATE, DELETE ON "invoices" TO scrml_app;`,
      `ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;`,
      `ALTER TABLE "invoices" FORCE ROW LEVEL SECURITY;`,
      `DROP POLICY IF EXISTS scrml_tenant_iso ON "invoices";`,
      `CREATE POLICY scrml_tenant_iso ON "invoices" USING ("tenant_id" = current_setting('scrml.tenant', true)::uuid);`,
    ]);
  });

  test("one immutable column → REVOKE table UPDATE + column-scoped GRANT UPDATE (mutable only)", () => {
    const t = table(`
      invoices {
        id: uuid primary key
        tenant_id: uuid not null
        status: text not null
        amount: decimal not null immutable
        memo: text
      } db-authoritative
    `);
    const ddl = generateDbAuthoritativeDDL(t);
    const joined = ddl.join("\n");
    // The blanket table-level UPDATE grant is GONE.
    expect(joined).not.toContain("GRANT SELECT, INSERT, UPDATE, DELETE");
    expect(joined).toContain(`GRANT SELECT, INSERT, DELETE ON "invoices" TO scrml_app;`);
    expect(joined).toContain(`REVOKE UPDATE ON "invoices" FROM scrml_app;`);
    // UPDATE granted ONLY on the mutable columns — amount (immutable) absent.
    expect(joined).toContain(`GRANT UPDATE ("id", "tenant_id", "status", "memo") ON "invoices" TO scrml_app;`);
    // REVOKE must precede the column GRANT (a table REVOKE UPDATE clears column grants too).
    expect(joined.indexOf("REVOKE UPDATE")).toBeLessThan(joined.indexOf("GRANT UPDATE ("));
    // RLS + policy still emitted after the grants.
    expect(joined).toContain(`FORCE ROW LEVEL SECURITY`);
    expect(joined).toContain(`CREATE POLICY scrml_tenant_iso`);
  });

  test("ALL columns immutable → no UPDATE grant at all (insert-once table)", () => {
    const t = table(`
      audit_log {
        id: uuid primary key immutable
        tenant_id: uuid not null immutable
        event: text not null immutable
      } db-authoritative
    `);
    const joined = generateDbAuthoritativeDDL(t).join("\n");
    expect(joined).toContain(`GRANT SELECT, INSERT, DELETE ON "audit_log" TO scrml_app;`);
    expect(joined).toContain(`REVOKE UPDATE ON "audit_log" FROM scrml_app;`);
    expect(joined).not.toContain("GRANT UPDATE");
  });

  test("immutable column name is identifier-escaped (never interpolated raw)", () => {
    // A hostile column name must be quoted, not break out of the GRANT UPDATE list.
    const t = {
      name: "t",
      dbAuthoritative: true,
      columns: [
        { name: "id", immutable: false, scrmlType: "uuid" },
        { name: 'a" ; DROP TABLE x; --', immutable: false, scrmlType: "text" },
        { name: "locked", immutable: true, scrmlType: "text" },
      ],
    };
    const joined = generateDbAuthoritativeDDL(t).join("\n");
    // The embedded `"` is DOUBLED so the payload stays inside one quoted identifier
    // (inert), never closing it early.
    expect(joined).toContain(`GRANT UPDATE ("id", "a"" ; DROP TABLE x; --") ON "t" TO scrml_app;`);
    // The break-out form (a single, un-doubled `"` that would close the identifier
    // and let `; DROP TABLE` execute) must NOT appear.
    expect(joined).not.toContain(`"a" ;`);
  });
});

describe("§14.8.11.2 S4 — generateScrmlHasCapDDL (the capability read helper)", () => {
  test("hardened, fail-closed, reads the caps GUC as jsonb", () => {
    const ddl = generateScrmlHasCapDDL();
    expect(ddl).toContain("CREATE OR REPLACE FUNCTION scrml_has_cap(cap text) RETURNS boolean");
    expect(ddl).toContain("LANGUAGE sql STABLE");
    expect(ddl).toContain("SET search_path = pg_catalog, public");
    expect(ddl).toContain("current_setting('scrml.principal.caps', true)::jsonb ? cap");
    expect(ddl).toContain("coalesce(");
    expect(ddl).toContain("false"); // unpinned ⇒ false ⇒ fail-closed
  });
});

describe("§14.8.11.2 S4 — generateSecdefDDL (the SECURITY-DEFINER mutation choke)", () => {
  const fn = parseSchemaBlock(`
    fn void_invoice(id: text) security definer owner(invoice_admin) requires cap("void") {
      """
      UPDATE invoices SET status = 'void' WHERE id = void_invoice.id;
      """
    }
  `).fns[0];

  const ddl = generateSecdefDDL(fn, ["invoices"]);
  const joined = ddl.join("\n");

  test("emits a bounded NOLOGIN owner role, distinct from scrml_app", () => {
    expect(joined).toContain(
      `DO $scrml_secdef$ BEGIN CREATE ROLE "invoice_admin" NOLOGIN NOBYPASSRLS; ` +
        `EXCEPTION WHEN duplicate_object THEN NULL; END $scrml_secdef$;`,
    );
    // NOBYPASSRLS is mandatory (an owner that bypassed RLS would escape tenant scope).
    expect(joined).toContain("NOBYPASSRLS");
  });

  test("grants the owner CRUD on the db-authoritative tables (table-level UPDATE)", () => {
    expect(joined).toContain(`GRANT SELECT, INSERT, UPDATE, DELETE ON "invoices" TO "invoice_admin";`);
  });

  test("provisions the owner so a non-superuser migrator can reassign ownership", () => {
    // The migrator must be able to SET ROLE to the owner + the owner must hold CREATE
    // on the schema, else ALTER FUNCTION … OWNER TO fails under a non-superuser migrator.
    expect(joined).toContain(`GRANT "invoice_admin" TO CURRENT_USER;`);
    expect(joined).toContain(`GRANT CREATE ON SCHEMA public TO "invoice_admin";`);
    // These provisioning grants precede the ownership reassignment.
    expect(joined.indexOf(`GRANT "invoice_admin" TO CURRENT_USER;`)).toBeLessThan(
      joined.indexOf(`ALTER FUNCTION "void_invoice"(text) OWNER TO "invoice_admin";`),
    );
  });

  test("the CREATE FUNCTION carries every hardening invariant", () => {
    expect(joined).toContain(`CREATE OR REPLACE FUNCTION "void_invoice"("id" text) RETURNS void`);
    expect(joined).toContain("LANGUAGE plpgsql");
    expect(joined).toContain("SECURITY DEFINER");
    // The search_path pin — pg_catalog FIRST, public required, NO pg_temp.
    expect(joined).toContain("SET search_path = pg_catalog, public");
    expect(joined).not.toContain("pg_temp");
  });

  test("the cap check is injected as the FIRST statement inside the emitter-owned BEGIN", () => {
    // Author body had no BEGIN/END; the emitter provides them and the guard leads.
    expect(joined).toMatch(/BEGIN\s+IF NOT scrml_has_cap\('void'\) THEN RAISE EXCEPTION 'denied'; END IF;/);
    // The author statement follows the guard.
    expect(joined.indexOf("scrml_has_cap('void')")).toBeLessThan(
      joined.indexOf("UPDATE invoices SET status = 'void'"),
    );
  });

  test("ownership + EXECUTE lockdown (revoke PUBLIC, grant only scrml_app)", () => {
    expect(joined).toContain(`ALTER FUNCTION "void_invoice"(text) OWNER TO "invoice_admin";`);
    expect(joined).toContain(`REVOKE EXECUTE ON FUNCTION "void_invoice"(text) FROM PUBLIC;`);
    expect(joined).toContain(`GRANT EXECUTE ON FUNCTION "void_invoice"(text) TO scrml_app;`);
  });

  test("a no-cap fn omits the guard but still hardens", () => {
    const f = parseSchemaBlock(`
      fn touch(id: uuid) security definer owner(admin) {
        """ UPDATE t SET seen = true WHERE id = touch.id; """
      }
    `).fns[0];
    const j = generateSecdefDDL(f, ["t"]).join("\n");
    expect(j).not.toContain("scrml_has_cap");
    expect(j).not.toContain("RAISE EXCEPTION 'denied'");
    expect(j).toContain("SECURITY DEFINER");
    expect(j).toContain("SET search_path = pg_catalog, public");
    expect(j).toContain(`REVOKE EXECUTE ON FUNCTION "touch"(uuid) FROM PUBLIC;`);
  });
});

describe("§14.8.11.2 — diffSchema wires S4 into the migration plan (postgres only)", () => {
  const desired = parseSchemaBlock(`
    invoices {
      id: uuid primary key
      tenant_id: uuid not null
      status: text not null
      amount: decimal not null immutable
    } db-authoritative

    fn void_invoice(id: uuid) security definer owner(invoice_admin) requires cap("void") {
      """
      UPDATE invoices SET status = 'void' WHERE id = void_invoice.id;
      """
    }
  `);

  test("postgres: the plan carries CREATE TABLE + S3 reshape + scrml_has_cap + the SECDEF", () => {
    const { sql } = diffSchema(desired, { tables: [] }, { driver: "postgres" });
    const joined = sql.join("\n");
    expect(joined).toContain(`CREATE TABLE "invoices"`);
    expect(joined).toContain(`GRANT SELECT, INSERT, DELETE ON "invoices" TO scrml_app;`);
    expect(joined).toContain(`REVOKE UPDATE ON "invoices" FROM scrml_app;`);
    expect(joined).toContain("CREATE OR REPLACE FUNCTION scrml_has_cap(cap text)");
    expect(joined).toContain(`CREATE OR REPLACE FUNCTION "void_invoice"("id" uuid) RETURNS void`);
    // scrml_has_cap must precede the SECDEF that calls it (it references the helper).
    expect(joined.indexOf("scrml_has_cap(cap text)")).toBeLessThan(joined.indexOf(`"void_invoice"`));
    // the table must precede the owner grant on it.
    expect(joined.indexOf(`CREATE TABLE "invoices"`)).toBeLessThan(
      joined.indexOf(`ON "invoices" TO "invoice_admin"`),
    );
  });

  test("sqlite: the SECDEF DDL is NOT emitted (postgres-only)", () => {
    const { sql } = diffSchema(desired, { tables: [] }, { driver: "sqlite" });
    const joined = sql.join("\n");
    expect(joined).not.toContain("scrml_has_cap");
    expect(joined).not.toContain("SECURITY DEFINER");
    expect(joined).not.toContain("void_invoice");
  });
});
