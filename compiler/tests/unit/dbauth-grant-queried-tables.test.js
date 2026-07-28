/**
 * §14.8.11 — the bounded role must be granted on tables `?{}` TOUCHES, not only on
 * db-authoritative ones. [[g-dbauth-migrate-no-grants-for-unmarked-identity-table]],
 * Adopter-A S11, bryan RULED direction (b) at S292.
 *
 * THE ASYMMETRY THIS PINS. The grant is emitted per-TABLE (only for `db-authoritative`
 * ones); the `SET LOCAL ROLE scrml_app` drop is emitted per-QUERY in any request scope.
 * So once ANY table is db-authoritative, an UNMARKED table read at request time runs as
 * `scrml_app` with zero grants → `permission denied for table users` → a 500 on login.
 * §14.8.10's corollary PRESCRIBES leaving the identity table unmarked, so the documented
 * shape was the broken one.
 *
 * WHY EVERY PRIOR TEST WAS BLIND (worth keeping, it is the reusable lesson): the tier's
 * live-PG tests hand-execute `set_config` and never issue a request, AND a fixture that
 * hand-writes its DDL carries the grant inline and stays green. Only a turnkey-migrated
 * database exercised over a request path catches it. These tests attack the DDL the
 * migrator actually emits, which is the cheapest place to pin it deterministically.
 */
import { describe, test, expect } from "bun:test";
import { diffSchema, parseSchemaBlock } from "../../src/schema-differ.js";

const SCHEMA = `
  users { id: text primary key  email: text not null unique  password_hash: text not null }
  widgets { id: text primary key  tenant_id: text not null  name: text not null } db-authoritative
`;

function grantsFor(queriedTables, schemaBody = SCHEMA) {
  const parsed = parseSchemaBlock(schemaBody);
  const { sql } = diffSchema(
    { tables: parsed.tables, fns: [] },
    { tables: [] },
    { driver: "postgres", allowDestructive: false, ...(queriedTables ? { queriedTables } : {}) },
  );
  return sql.filter((s) => /^\s*(GRANT|REVOKE)/i.test(s));
}
const mentions = (stmts, table) => stmts.some((s) => s.includes(`"${table}"`));

describe("§14.8.11 — grants for queried-but-unmarked tables", () => {
  test("an UNMARKED table that `?{}` reads receives a grant", () => {
    const g = grantsFor(new Set(["users", "widgets"]));
    expect(mentions(g, "users")).toBe(true);
    expect(g.some((s) => /GRANT[^;]*ON "users" TO scrml_app/.test(s))).toBe(true);
  });

  test("REGRESSION — without the fix the unmarked table got NOTHING", () => {
    // The shipped-before behaviour, pinned so a revert is loud rather than silent.
    const g = grantsFor(undefined);
    expect(mentions(g, "widgets")).toBe(true);
    expect(mentions(g, "users")).toBe(false);
  });

  test("the db-authoritative table KEEPS its column-scoped narrowing", () => {
    // The tier's own guarantee must not be widened by this change: no table-level
    // UPDATE on a marked table, only on the mutable columns.
    const g = grantsFor(new Set(["users", "widgets"]));
    expect(g.some((s) => /REVOKE UPDATE ON "widgets" FROM scrml_app/.test(s))).toBe(true);
    expect(g.some((s) => /GRANT SELECT, INSERT, UPDATE, DELETE ON "widgets"/.test(s))).toBe(false);
  });

  test("an unmarked table gets NO RLS and NO policy — it never opted into the tier", () => {
    const parsed = parseSchemaBlock(SCHEMA);
    const { sql } = diffSchema(
      { tables: parsed.tables, fns: [] }, { tables: [] },
      { driver: "postgres", allowDestructive: false, queriedTables: new Set(["users", "widgets"]) },
    );
    const usersDdl = sql.filter((s) => s.includes('"users"'));
    expect(usersDdl.some((s) => /ROW LEVEL SECURITY/i.test(s))).toBe(false);
    expect(usersDdl.some((s) => /CREATE POLICY/i.test(s))).toBe(false);
  });

  test("LEAST PRIVILEGE — a SELECT-only table is granted SELECT, never blanket CRUD", () => {
    // Caught by the S292 S239 self-review: the first cut emitted
    // `GRANT SELECT, INSERT, UPDATE, DELETE` on every queried unmarked table, which hands
    // the bounded role DELETE on the IDENTITY TABLE that login merely reads — strictly more
    // permissive than the db-authoritative path beside it. Verified against the real
    // reporting adopter: their `users` derives exactly ["SELECT"].
    const parsed = parseSchemaBlock(SCHEMA);
    const { sql } = diffSchema(
      { tables: parsed.tables, fns: [] }, { tables: [] },
      {
        driver: "postgres", allowDestructive: false,
        queriedTables: new Set(["users", "widgets"]),
        queriedPrivileges: new Map([["users", new Set(["SELECT"])]]),
      },
    );
    const usersGrant = sql.find((s) => /GRANT[^;]*ON "users"/.test(s));
    expect(usersGrant).toBe('GRANT SELECT ON "users" TO scrml_app;');
    expect(usersGrant).not.toMatch(/DELETE|INSERT|UPDATE/);
  });

  test("LEAST PRIVILEGE — a written table gets exactly the verbs it uses", () => {
    const parsed = parseSchemaBlock(SCHEMA);
    const { sql } = diffSchema(
      { tables: parsed.tables, fns: [] }, { tables: [] },
      {
        driver: "postgres", allowDestructive: false,
        queriedTables: new Set(["users"]),
        queriedPrivileges: new Map([["users", new Set(["SELECT", "UPDATE"])]]),
      },
    );
    expect(sql.find((s) => /GRANT[^;]*ON "users"/.test(s)))
      .toBe('GRANT SELECT, UPDATE ON "users" TO scrml_app;');
  });

  test("CONTROL — an unmarked table that NOTHING queries is not granted", () => {
    // Direction (b) is grant-what-is-touched, not grant-everything (that was (a),
    // the widening direction bryan did not pick).
    const g = grantsFor(new Set(["widgets"]));
    expect(mentions(g, "users")).toBe(false);
  });

  test("CONTROL — with ZERO db-authoritative tables nothing is granted at all", () => {
    // No marked table => no `scrml_app` role exists and no role-drop is emitted, so
    // these GRANTs would fail against a real database.
    const plain = `
      users { id: text primary key }
      widgets { id: text primary key }
    `;
    const g = grantsFor(new Set(["users", "widgets"]), plain);
    expect(g).toEqual([]);
  });

  test("CONTROL — SQLite emits no role DDL (the tier is Postgres-only)", () => {
    const parsed = parseSchemaBlock(SCHEMA);
    const { sql } = diffSchema(
      { tables: parsed.tables, fns: [] }, { tables: [] },
      { driver: "sqlite", allowDestructive: false, queriedTables: new Set(["users"]) },
    );
    expect(sql.some((s) => /GRANT|scrml_app/i.test(s))).toBe(false);
  });
});
