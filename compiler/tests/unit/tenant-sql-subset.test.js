/**
 * §14.8.10 S452 r3 — the tenant floor's allow-listed SQL subset
 * (compiler/src/codegen/tenant-sql-subset.ts). The lexer accepts a CLOSED token
 * set; everything else is outside the subset and a tenant query there is
 * refused (E-TENANT-SQL-SUBSET). Executed end-to-end in
 * compiler/tests/conformance/conf-TENANT-SOURCE-FILTER.test.js (r3 blocks).
 */
import { describe, test, expect } from "bun:test";
import {
  lexTenantSubset,
  analyzeTenantSql,
  injectWriteTenantFilter,
  injectInsertTenant,
} from "../../src/codegen/tenant-sql-subset.ts";

const tenants = new Set(["assets", "orders"]);
const isTenant = (n) => tenants.has(n.toLowerCase());
const analyze = (q) => analyzeTenantSql(q, isTenant, tenants);

describe("lexTenantSubset — the closed token set", () => {
  test("accepts identifiers, numbers, plain literals, ${} params and the listed punctuation", () => {
    const r = lexTenantSubset("SELECT a.id, 1.5e3, .5, 'it''s', ${x}, b || 'c' FROM t WHERE x <> 1 AND y != 2 AND z <= 3 AND w >= 4 AND v % 2 = 0 AND u / 2 > -1 + 1\n\t\r");
    expect(r.ok).toBe(true);
  });
  test("a string literal is DATA: anything but backslash / `${` / control chars inside", () => {
    expect(lexTenantSubset("SELECT id FROM t WHERE n = 'a \"b\" [c] -- /* ; $ ü'").ok).toBe(true);
    expect(lexTenantSubset("SELECT id FROM t WHERE n = 'a\\'").ok).toBe(false);
    expect(lexTenantSubset("SELECT id FROM t WHERE n = '${x}'").ok).toBe(false);
    expect(lexTenantSubset("SELECT id FROM t WHERE n = 'unterminated").ok).toBe(false);
  });
  test("every form outside the subset is refused", () => {
    for (const q of [
      'SELECT "id" FROM t', "SELECT `id` FROM t", "SELECT [id] FROM t", "SELECT $1 FROM t",
      "SELECT $q$x$q$ FROM t", "SELECT id FROM t; SELECT 1", "SELECT id FROM t -- c", "SELECT /* c */ id FROM t",
      "SELECT E'x' FROM t", "SELECT X'00' FROM t", "SELECT N'x' FROM t", "SELECT 0x1F FROM t", "SELECT 1_000 FROM t",
      "SELECT id::text FROM t", "SELECT ? FROM t", "SELECT @p FROM t", "SELECT id FROM t # c", "SELECT a & b FROM t",
      "SELECT a | b FROM t", "SELECT ~a FROM t", "SELECT a ^ b FROM t", "SELECT ARRAY[1] FROM t", "SELECT {a} FROM t",
      "SELECT idé FROM t", "SELECT id\u0000 FROM t", "SELECT id FROM t\u000b", "SELECT U&\"x\" FROM t",
    ]) {
      expect(lexTenantSubset(q).ok).toBe(false);
    }
  });
  test("an interpolation is opaque, but its end must be provable without parsing JS", () => {
    expect(lexTenantSubset("SELECT id FROM t WHERE a = ${@user.id} AND b = ${f(x, y)} AND c = ${\"lit\"}").ok).toBe(true);
    for (const q of [
      "SELECT ${ \"{\" } AS z FROM t",     // brace in a string — the emitter brace-counts, JS does not
      "SELECT ${ \"}\" } AS z FROM t",     // the first `}` is inside a string (unclosed quote)
      "SELECT ${ a / b } FROM t",           // a slash (regex / comment ambiguity)
      "SELECT ${ `x` } FROM t",             // a template
      "SELECT ${ {a: 1}.a } FROM t",        // braces
      "SELECT ${ \"a\\\"\" } FROM t",       // a backslash escape
      "SELECT ${ } FROM t",                 // empty
    ]) {
      expect(lexTenantSubset(q).ok).toBe(false);
    }
  });
});

describe("analyzeTenantSql — the statement grammar", () => {
  test("a non-tenant query, in or out of the subset, is not the floor's", () => {
    expect(analyze("SELECT k FROM config")).toBeNull();
    expect(analyze('SELECT "k" FROM config')).toBeNull();
    expect(analyze("DELETE FROM config WHERE k = 'assets'")).toBeNull();
  });
  test("outside the subset, a tenant name ANYWHERE (incl. a literal, a comment, a param) refuses", () => {
    expect(analyze('SELECT "k" FROM config WHERE v = \'assets\'')).toMatchObject({ kind: "refuse", code: "E-TENANT-SQL-SUBSET" });
    expect(analyze("SELECT k FROM config /* assets */")).toMatchObject({ kind: "refuse", code: "E-TENANT-SQL-SUBSET" });
    expect(analyze('SELECT k FROM config WHERE "x" = ${assets.length}')).toMatchObject({ kind: "refuse", code: "E-TENANT-SQL-SUBSET" });
    expect(analyze('SELECT k FROM U&"\\0061ssets"')).toMatchObject({ kind: "refuse", code: "E-TENANT-SQL-SUBSET" });
  });
  test("only SELECT / INSERT / UPDATE / DELETE lead a tenant statement", () => {
    for (const q of ["TRUNCATE assets", "EXPLAIN SELECT * FROM assets", "PRAGMA table_info(assets)", "DROP TABLE assets", "(SELECT * FROM assets)"]) {
      expect(analyze(q)).toMatchObject({ kind: "refuse", code: "E-TENANT-SQL-SUBSET" });
    }
    expect(analyze("WITH x AS (SELECT 1) SELECT * FROM assets")).toMatchObject({ code: "E-TENANT-AGG", reason: "subquery" });
    expect(analyze("REPLACE INTO assets (id) VALUES (1)")).toMatchObject({ code: "E-TENANT-WRITE" });
  });
  test("reads: SELECT … INTO and locking clauses are refused; a qualified callee is never allow-listed", () => {
    expect(analyze("SELECT * INTO copy FROM assets")).toMatchObject({ code: "E-TENANT-WRITE" });
    expect(analyze("SELECT * FROM assets FOR UPDATE")).toMatchObject({ code: "E-TENANT-SQL-SUBSET" });
    expect(analyze("SELECT myschema.lower(name) AS n FROM assets")).toMatchObject({ code: "E-TENANT-AGG", reason: "function" });
    expect(analyze("SELECT tenant_id, myschema.f(name) AS n FROM assets GROUP BY tenant_id")).toMatchObject({ code: "E-TENANT-AGG", reason: "function" });
  });
  test("reads: the FROM clause is read from tokens — every tenant source keyed", () => {
    expect(analyze("SELECT a.id FROM assets a, orders o WHERE o.asset_id = a.id")).toMatchObject({ kind: "read", refs: ["a", "o"] });
    expect(analyze("SELECT * FROM orders NATURAL LEFT OUTER JOIN assets")).toMatchObject({ kind: "read", refs: ["orders", "assets"] });
    expect(analyze("SELECT * FROM assets JOIN config USING (id)")).toMatchObject({ kind: "read", refs: ["assets"] });
    // unparseable FROM forms → zero rows, never a partial key set
    expect(analyze("SELECT * FROM main.assets")).toEqual({ kind: "unresolvable", table: "assets" });
    expect(analyze("SELECT * FROM assets INDEXED BY ix")).toEqual({ kind: "unresolvable", table: "assets" });
    expect(analyze("SELECT * FROM assets JOIN assets")).toEqual({ kind: "unresolvable", table: "assets" });
  });
  test("INSERT: the subset shape is injectable; a conflict clause other than REPLACE is allowed", () => {
    expect(analyze("INSERT INTO assets (name) VALUES (${n})")).toMatchObject({ kind: "insert", table: "assets" });
    expect(analyze("INSERT OR IGNORE INTO assets (name) VALUES (datetime('now'))")).toMatchObject({ kind: "insert" });
    expect(analyze("INSERT INTO assets (name) VALUES (hex(${n}))")).toMatchObject({ code: "E-TENANT-WRITE" });
    expect(analyze("INSERT INTO assets VALUES (1, 'x')")).toMatchObject({ code: "E-TENANT-WRITE" });
    expect(analyze("INSERT INTO assets DEFAULT VALUES")).toMatchObject({ code: "E-TENANT-WRITE" });
  });
});

describe("the write rewrites", () => {
  test("UPDATE / DELETE: the author's WHERE is parenthesized whole, then ANDed with the tenant", () => {
    const q = "UPDATE assets SET name = ${n} WHERE id = 1 OR id = 2";
    const a = analyze(q);
    expect(a).toMatchObject({ kind: "filtered-write", op: "UPDATE" });
    expect(injectWriteTenantFilter(q, a.whereEnd, "K()")).toBe("UPDATE assets SET name = ${n} WHERE (id = 1 OR id = 2) AND tenant_id = ${K()}");
    const d = "DELETE FROM assets  ";
    expect(injectWriteTenantFilter(d, analyze(d).whereEnd, "K()")).toBe("DELETE FROM assets WHERE tenant_id = ${K()}");
  });
  test("INSERT: tenant_id joins the column list, the key joins the tuple", () => {
    const q = "INSERT INTO assets (name, cost) VALUES (${n}, 3)";
    const a = analyze(q);
    expect(injectInsertTenant(q, a.colsClose, a.valsClose, "K()")).toBe("INSERT INTO assets (name, cost, tenant_id) VALUES (${n}, 3, ${K()})");
  });
});
