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
// (S455: the allow-lists are the BUILT-INS of the database the query runs on — these
// fixtures are SQLite's unless a test passes another dialect)
const analyze = (q, dialect = "sqlite") => analyzeTenantSql(q, isTenant, tenants, { dialect });

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
      "SELECT ? FROM t", "SELECT @p FROM t", "SELECT id FROM t # c", "SELECT a & b FROM t",
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
  test("INSERT: the subset shape is injectable; an author-written conflict clause is refused (S452 r4)", () => {
    expect(analyze("INSERT INTO assets (name) VALUES (${n})")).toMatchObject({ kind: "insert", table: "assets" });
    expect(analyze("INSERT INTO assets (name) VALUES (datetime(${q}))")).toMatchObject({ kind: "insert" });
    for (const q of ["INSERT OR IGNORE INTO assets (name) VALUES (1)", "INSERT OR ABORT INTO assets (name) VALUES (1)", "UPDATE OR IGNORE assets SET name = 1"]) {
      expect(analyze(q)).toMatchObject({ code: "E-TENANT-WRITE" });
    }
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
  test("S452 r4: on SQLite an injected INSERT / UPDATE carries OR ABORT (overrides a table-level ON CONFLICT REPLACE)", () => {
    const i = "INSERT INTO assets (name) VALUES (${n})";
    const ai = analyze(i);
    expect(injectInsertTenant(i, ai.colsClose, ai.valsClose, "K()", ai.leaderEnd)).toBe("INSERT OR ABORT INTO assets (name, tenant_id) VALUES (${n}, ${K()})");
    const u = "  UPDATE assets SET name = ${n} WHERE id = 1";
    const au = analyze(u);
    expect(injectWriteTenantFilter(u, au.whereEnd, "K()", au.leaderEnd)).toBe("  UPDATE OR ABORT assets SET name = ${n} WHERE (id = 1) AND tenant_id = ${K()}");
  });
});

describe("S452 r4 — functions that can run SQL from a string; write hazards", () => {
  test("a GROUP BY tenant_id read may call the per-row functions and count/sum/avg/min/max/total only", () => {
    expect(analyze("SELECT tenant_id, count(*) AS n, sum(cost) AS s, avg(cost) AS a, min(cost) AS lo, max(cost) AS hi, total(cost) AS t, lower(tenant_id) AS l FROM assets GROUP BY tenant_id"))
      .toMatchObject({ kind: "read" });
    for (const f of ["group_concat(name)", "table_to_xml('assets', true, false, '')", "json_group_array(name)", "string_agg(name, ',')"]) {
      expect(analyze(`SELECT tenant_id, ${f} AS x FROM assets GROUP BY tenant_id`)).toMatchObject({ code: "E-TENANT-AGG", reason: "function" });
    }
  });
  test("ANY query whose text names a tenant table — even only in a literal — may call allow-listed functions only", () => {
    expect(analyze("SELECT query_to_xml('select name from assets', true, false, '') AS x FROM config"))
      .toMatchObject({ kind: "refuse", code: "E-TENANT-SQL-SUBSET", table: "assets" });
    expect(analyze("SELECT count(*) AS n FROM config WHERE v = 'assets'")).toBeNull();
    expect(analyze("INSERT INTO config (k, v) VALUES ('assets', lower(${x}))")).toBeNull();
    expect(analyze("SELECT hex(k) AS h FROM config")).toBeNull();     // no tenant name anywhere: not the floor's
  });
  test("a write to a table with a <schema> trigger / cascading FK is refused, naming it", () => {
    const hz = (t) => (t === "assets" ? ["trigger `t_upd`"] : undefined);
    const a = analyzeTenantSql("UPDATE assets SET cost = 1 WHERE id = 1", isTenant, tenants, { writeHazards: hz });
    expect(a).toMatchObject({ kind: "refuse", code: "E-TENANT-WRITE" });
    expect(a.detail).toContain("trigger `t_upd`");
    expect(analyzeTenantSql("UPDATE orders SET label = 'x'", isTenant, tenants, { writeHazards: hz })).toMatchObject({ kind: "filtered-write" });
    // reads are unaffected
    expect(analyzeTenantSql("SELECT id FROM assets", isTenant, tenants, { writeHazards: hz })).toMatchObject({ kind: "read" });
  });
});
