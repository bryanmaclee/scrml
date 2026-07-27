/**
 * sql-table-refs — the bounded identifier scanner behind the §14.8.11 grant fix (S292).
 *
 * The load-bearing property is NOT "finds tables". It is that a shape it cannot resolve
 * lands in `undetermined` rather than silently yielding an empty `tables`. An empty
 * `tables` treated as "touches nothing" is precisely how
 * [[g-dbauth-migrate-no-grants-for-unmarked-identity-table]] reproduces on another table:
 * the grant is omitted, the query still runs under `SET LOCAL ROLE scrml_app`, and it fails
 * closed with an opaque `permission denied`. So every unresolvable shape has a test.
 */
import { describe, test, expect } from "bun:test";
import { tableRefsInSql, sqlBodiesInSource, tableRefsInSource } from "../../src/sql-table-refs.js";

const tablesOf = (sql) => tableRefsInSql(sql).tables.sort();
const undeterminedOf = (sql) => tableRefsInSql(sql).undetermined;

describe("sql-table-refs — resolvable shapes", () => {
  test("SELECT … FROM", () => {
    expect(tablesOf("select id from users where email = ${e}")).toEqual(["users"]);
  });

  test("JOIN picks up both sides", () => {
    expect(tablesOf("select p.title, u.username from posts p join users u on u.id = p.author_id"))
      .toEqual(["posts", "users"]);
  });

  test("INSERT INTO / UPDATE / DELETE FROM", () => {
    expect(tablesOf("insert into ledger (id) values (${id})")).toEqual(["ledger"]);
    expect(tablesOf("update accounts set name = ${n} where id = ${i}")).toEqual(["accounts"]);
    expect(tablesOf("delete from sessions where id = ${i}")).toEqual(["sessions"]);
  });

  test("case-insensitive and normalized to lower", () => {
    expect(tablesOf("SELECT * FROM Users JOIN Widgets ON 1=1")).toEqual(["users", "widgets"]);
  });

  test("an interpolation is a bound PARAMETER, never a table", () => {
    // ${users} in a value position must not be read as an identifier.
    expect(tablesOf("select id from accounts where owner = ${users}")).toEqual(["accounts"]);
  });

  test("a table name inside a string literal is not a reference", () => {
    expect(tablesOf("select id from accounts where note = 'from users'")).toEqual(["accounts"]);
  });

  test("a table name inside a comment is not a reference", () => {
    expect(tablesOf("select id from accounts -- from users\n")).toEqual(["accounts"]);
    expect(tablesOf("select id from accounts /* join users */")).toEqual(["accounts"]);
  });
});

describe("sql-table-refs — shapes that MUST report undetermined, not empty", () => {
  const cases = [
    ["a CTE", "with recent as (select * from ledger) select * from recent"],
    ["a subquery in FROM", "select * from (select id from users) t"],
    ["a subquery in JOIN", "select * from a join (select id from b) x on 1=1"],
    ["a LATERAL join", "select * from a, lateral (select 1) l"],
    ["a dynamic EXECUTE", "execute stmt"],
    ["a dynamic table identifier", "select * from ${tbl}"],
  ];
  for (const [label, sql] of cases) {
    test(`${label} → undetermined, and tables stays empty`, () => {
      const r = tableRefsInSql(sql);
      expect(r.undetermined.length).toBeGreaterThan(0);
      expect(r.tables).toEqual([]);
    });
  }

  test("CONTROL — a resolvable query reports NO undetermined", () => {
    expect(undeterminedOf("select id from users")).toEqual([]);
  });
});

describe("sql-table-refs — source-level collection", () => {
  test("finds every ?{} body, bracket-matched through nested braces", () => {
    const src = 'a ?{ select id from users where x = ${ {a:1}.a } } b ?{ select * from posts } c';
    const bodies = sqlBodiesInSource(src);
    expect(bodies.length).toBe(2);
    expect(tableRefsInSource(src).tables).toEqual(new Set(["users", "posts"]));
  });

  test("the reporting adopter's shape — an unmarked identity table IS collected", () => {
    // RediLedger S11: `users` is deliberately not db-authoritative (§14.8.10 corollary),
    // and is read by authenticate(). It must appear so it can be granted.
    const src = `
      <schema>
        users { id: text primary key }
        widgets { id: text primary key  tenant_id: text not null } db-authoritative
      </schema>
      \${ function authenticate(email) { return ?{ select id from users where email = \${email} }.get() } }
    `;
    expect(tableRefsInSource(src).tables.has("users")).toBe(true);
  });

  test("a source with no ?{} yields nothing and reports nothing undetermined", () => {
    const r = tableRefsInSource("<h1>hi</h1>");
    expect(r.tables.size).toBe(0);
    expect(r.undetermined).toEqual([]);
  });
});
