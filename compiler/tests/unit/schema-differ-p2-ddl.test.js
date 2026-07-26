/**
 * §14.8.11.2 DB-authoritative P2 — S3 immutable GRANT reshape emission.
 *
 * A Postgres column-level REVOKE cannot narrow a table-level GRANT, so an
 * `immutable` column forces re-shaping M1's blanket `GRANT … UPDATE …` into a
 * column-scoped grant. HARD anti-regression: a db-authoritative table with ZERO
 * immutable columns must emit BYTE-IDENTICAL to M1.
 */

import { describe, test, expect } from "bun:test";
import { parseSchemaBlock, generateDbAuthoritativeDDL } from "../../src/schema-differ.js";

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
