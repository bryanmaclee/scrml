/**
 * §14.8.11.2 DB-authoritative P2 — parseSchemaBlock upgrade regression + `fn` parse.
 *
 * The brace-depth-aware scan replaced the non-nested `/(\w+)\s*\{([^}]*)\}/g` regex
 * so a SECURITY-DEFINER `fn`'s `"""…"""`-quoted plpgsql body (which contains `{`/`}`)
 * parses without truncation. BACKWARD-COMPAT is the hard requirement: existing
 * multi-table schemas must parse IDENTICALLY (tables + columns), and the return
 * shape stays `{ tables, fns }` with `fns` empty for a schema that declares none.
 */

import { describe, test, expect } from "bun:test";
import { parseSchemaBlock } from "../../src/schema-differ.js";

describe("§14.8.11.2 parseSchemaBlock — backward compat (no fns)", () => {
  test("a plain multi-table schema parses identically; fns is empty", () => {
    const body = `
      users {
        id: text primary key
        email: text not null unique
      }
      invoices {
        id: uuid primary key
        tenant_id: uuid not null
        amount: decimal not null
      } db-authoritative
    `;
    const r = parseSchemaBlock(body);
    expect(r.tables.map((t) => t.name)).toEqual(["users", "invoices"]);
    expect(r.tables[0].dbAuthoritative).toBeUndefined();
    expect(r.tables[1].dbAuthoritative).toBe(true);
    expect(r.tables[0].columns.map((c) => c.name)).toEqual(["id", "email"]);
    expect(r.tables[1].columns.map((c) => c.name)).toEqual(["id", "tenant_id", "amount"]);
    expect(r.fns).toEqual([]);
  });

  test("column constraints (primary key / not null / unique / default) still parse", () => {
    const r = parseSchemaBlock(`
      t {
        id: text primary key
        name: text not null unique
        status: text default('active')
      }
    `);
    const cols = r.tables[0].columns;
    expect(cols.find((c) => c.name === "id").primaryKey).toBe(true);
    expect(cols.find((c) => c.name === "name").notNull).toBe(true);
    expect(cols.find((c) => c.name === "name").unique).toBe(true);
    expect(cols.find((c) => c.name === "status").default).toBe("'active'");
  });
});

describe("§14.8.11.2 parseSchemaBlock — S3 immutable column keyword", () => {
  test("a per-column `immutable` keyword sets col.immutable", () => {
    const r = parseSchemaBlock(`
      invoices {
        id: uuid primary key
        tenant_id: uuid not null
        amount: decimal not null immutable
        memo: text
      } db-authoritative
    `);
    const cols = r.tables[0].columns;
    expect(cols.find((c) => c.name === "amount").immutable).toBe(true);
    expect(cols.find((c) => c.name === "memo").immutable).toBeFalsy();
  });
});

describe("§14.8.11.2 parseSchemaBlock — S4 SECURITY-DEFINER `fn`", () => {
  const body = `
    invoices {
      id: uuid primary key
      tenant_id: uuid not null
      status: text not null
      amount: decimal not null immutable
    } db-authoritative

    fn void_invoice(id: text) security definer owner(invoice_admin) requires cap("void") {
      """
      IF false THEN NULL; END IF;
      UPDATE invoices SET status = 'void' WHERE id = void_invoice.id;
      """
    }
  `;

  test("the table AND the fn both parse; the braced/`END IF`-containing body is not truncated", () => {
    const r = parseSchemaBlock(body);
    expect(r.tables.map((t) => t.name)).toEqual(["invoices"]);
    expect(r.tables[0].dbAuthoritative).toBe(true);
    expect(r.fns.length).toBe(1);
    const fn = r.fns[0];
    expect(fn.name).toBe("void_invoice");
    expect(fn.owner).toBe("invoice_admin");
    expect(fn.cap).toBe("void");
    expect(fn.returns).toBe("void");
    expect(fn.isSecurityDefiner).toBe(true);
    expect(fn.args).toEqual([{ name: "id", type: "text" }]);
    // The `END IF;` inside the body survived (the old `[^}]*` regex truncated at the `}`).
    expect(fn.body).toContain("END IF;");
    expect(fn.body).toContain("UPDATE invoices SET status = 'void'");
  });

  test("multi-arg + returns + no-cap fn parses", () => {
    const r = parseSchemaBlock(`
      fn post_ledger(entry_id: uuid, amount: decimal) security definer owner(ledger_admin) returns integer {
        """
        UPDATE ledger SET posted = true WHERE id = post_ledger.entry_id;
        """
      }
    `);
    expect(r.tables).toEqual([]);
    expect(r.fns.length).toBe(1);
    expect(r.fns[0].args).toEqual([
      { name: "entry_id", type: "uuid" },
      { name: "amount", type: "decimal" },
    ]);
    expect(r.fns[0].returns).toBe("integer");
    expect(r.fns[0].cap).toBeNull();
  });

  test("a fn body containing `{` `}` and a `default('x)}')`-style literal does not misclose", () => {
    const r = parseSchemaBlock(`
      t { id: text primary key } db-authoritative
      fn f(id: text) security definer owner(a) {
        """
        DECLARE v text; BEGIN v := 'a}b{c'; UPDATE t SET id = id WHERE id = f.id; END;
        """
      }
    `);
    expect(r.tables.map((t) => t.name)).toEqual(["t"]);
    expect(r.fns.length).toBe(1);
    expect(r.fns[0].body).toContain("'a}b{c'");
  });
});
