/**
 * §14.8.9 — the protect floor is FAIL-CLOSED on an unknown statement (S454).
 *
 * `resolveProtectedOutputColumns` used to answer `null` ("no protected column —
 * emit no tag") whenever its leader regex did not recognize a statement, so a
 * leading `;` shipped the row whole (executed; conf-PROTECT-EGRESS-FLOOR). The
 * default is now inverted: `null` is reachable ONLY from a positive proof — a
 * single statement that positively produces no rows, or a single SELECT /
 * RETURNING write whose every output column resolved to a non-protected origin.
 * Everything else is `{ all: true }` (the wholesale strip).
 *
 * SPEC §14.8.9: "fail-closed on an unknown origin — a value whose origin the
 * implementation cannot determine is treated as carrying every protected origin
 * it may carry (stripped wholesale …), never as carrying none."
 */
import { describe, test, expect } from "bun:test";
import {
  resolveProtectedOutputColumns,
  classifyProtectStatement,
} from "../../src/codegen/protect-egress.ts";

const ctx = {
  protectedByTable: new Map([["users", new Set(["passwordHash"])]]),
  schemaByTable: new Map([
    ["users", ["id", "name", "passwordHash"]],
    ["loads", ["id", "customer_id", "status"]],
  ]),
  knownTables: new Set(["users", "loads"]),
};
const ALL = { all: true };
const r = (sql) => resolveProtectedOutputColumns(sql, ctx);

describe("§14.8.9 S454 — unrecognized statements strip wholesale (never `null`)", () => {
  const unknown = [
    ["leading `;`", "; SELECT id, passwordHash FROM users"],
    ["`;;`", ";; SELECT id, passwordHash FROM users"],
    ["`;` with no space", ";SELECT id, passwordHash FROM users"],
    ["comment then `;`", "/* x */ ; SELECT id, passwordHash FROM users"],
    ["line comment then `;`", "-- x\n; SELECT id, passwordHash FROM users"],
    ["two statements (write then read)", "UPDATE users SET name = 'a'; SELECT passwordHash FROM users"],
    ["two statements (read then read)", "SELECT id FROM users; SELECT passwordHash FROM users"],
    ["VALUES leader", "VALUES ((SELECT passwordHash FROM users))"],
    ["PRAGMA leader", "PRAGMA table_info(users)"],
    ["EXPLAIN leader", "EXPLAIN SELECT passwordHash FROM users"],
    ["EXPLAIN QUERY PLAN leader", "EXPLAIN QUERY PLAN SELECT passwordHash FROM users"],
    ["Postgres TABLE leader", "TABLE users"],
    ["Postgres SHOW leader", "SHOW search_path"],
    ["WITH leader", "WITH t AS (SELECT passwordHash FROM users) SELECT * FROM t"],
    ["parenthesized SELECT", "(SELECT passwordHash FROM users)"],
    ["interpolation as leader", "${q} FROM users"],
    ["empty body", ""],
    ["comment-only body", "/* nothing */ -- here"],
    ["CALL leader", "CALL leak()"],
    ["a write whose RETURNING is not top-level", "INSERT INTO users (name) SELECT name FROM (SELECT 1 RETURNING passwordHash)"],
  ];
  for (const [label, sql] of unknown) {
    test(`${label} → { all: true }`, () => {
      expect(r(sql)).toEqual(ALL);
    });
  }
});

describe("§14.8.9 S454 — lexical forms a database may read differently from the floor strip wholesale", () => {
  const forms = [
    ["Postgres E'' string (backslash escape)", "SELECT id, E'\\' ', name, 'x' FROM users"],
    ["backslash in a plain string (MySQL / standard_conforming_strings=off)", "SELECT id, 'a\\' , name FROM users"],
    ["Postgres dollar quote", "SELECT id, $q$ x $q$ FROM users"],
    ["nested block comment (Postgres nests)", "SELECT id /* /* */ ' */, passwordHash, ' FROM users"],
    ["MySQL `#` comment", "SELECT name # '\n, passwordHash -- '\n FROM users"],
    ["MySQL `--` with no following space", "SELECT name --x\n FROM users"],
    ["MySQL executable comment", "SELECT name /*! , passwordHash */ FROM users"],
    ["doubled quote inside a quoted identifier", 'SELECT "a"", passwordHash, ""b" FROM users'],
    ["backslash inside a quoted identifier (MySQL string)", 'SELECT "a\\", passwordHash FROM users'],
    ["quote inside a [..] (Postgres subscript)", "SELECT x[']'], passwordHash, ']' FROM users"],
    ["unterminated string", "SELECT id, 'abc FROM users"],
    ["unterminated block comment", "SELECT id FROM users /* open"],
    ["interpolation pair JS splits differently", 'SELECT id, ${ "{" }, passwordHash, ${ "}" } FROM users'],
    ["interpolation with an unclosed quote", "SELECT id FROM users WHERE name = ${ \"}\" }"],
    ["interpolation with a regex holding a brace", "SELECT id FROM users WHERE name = ${ /}/.source }"],
    ["interpolation with a block comment holding a brace", "SELECT id, ${ x /* } */ -- } , passwordHash FROM users"],
    ["interpolation with division (over-strip, fail-closed)", "SELECT id, passwordHash FROM users WHERE id = ${ a / 2 }"],
    ["a stray brace in the SQL text", "SELECT id, name FROM users WHERE id = 1 }"],
  ];
  for (const [label, sql] of forms) {
    test(`${label} → { all: true }`, () => {
      expect(r(sql)).toEqual(ALL);
    });
  }
});

describe("§14.8.9 S454 — positive proofs of no rows return null", () => {
  const noRows = [
    ["INSERT without RETURNING", "INSERT INTO users (name, passwordHash) VALUES ('a', 'b')"],
    ["INSERT … SELECT without RETURNING", "INSERT INTO users (name) SELECT name FROM users"],
    ["UPDATE without RETURNING", "UPDATE users SET passwordHash = ${h} WHERE id = ${id}"],
    ["DELETE without RETURNING", "DELETE FROM users WHERE id = 1"],
    ["REPLACE without RETURNING", "REPLACE INTO users (id, name) VALUES (1, 'a')"],
    ["CREATE TABLE", "CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY)"],
    ["CREATE VIEW", "CREATE VIEW v AS SELECT passwordHash FROM users"],
    ["DROP TABLE", "DROP TABLE t"],
    ["ALTER TABLE", "ALTER TABLE users ADD COLUMN x TEXT"],
    ["BEGIN", "BEGIN"],
    ["COMMIT with trailing `;`", "COMMIT;"],
    ["a write behind a leading comment", "/* audit */ DELETE FROM users WHERE id = 1"],
    ["a write with `?` placeholders", "UPDATE users SET name = ? WHERE id = ?"],
    ["a write with `$1` placeholders", "UPDATE users SET name = $1 WHERE id = $2"],
  ];
  for (const [label, sql] of noRows) {
    test(`${label} → null`, () => {
      expect(r(sql)).toBeNull();
    });
  }
});

describe("§14.8.9 S454 — resolution unchanged for recognized SELECT / RETURNING", () => {
  test("plain SELECT tags the protected column", () => {
    expect(r("SELECT id, name, passwordHash FROM users")).toEqual({ cols: ["passwordHash"] });
  });
  test("leading comments still resolve", () => {
    expect(r("-- a\n/* b */ SELECT id, passwordHash FROM users")).toEqual({ cols: ["passwordHash"] });
  });
  test("a trailing `;` resolves (it is not part of the statement)", () => {
    expect(r("SELECT id, passwordHash FROM users;")).toEqual({ cols: ["passwordHash"] });
    expect(r("SELECT id, name FROM users ; ; -- done")).toBeNull();
  });
  test("RETURNING * with a trailing `;` tags the protected column (was an opaque `*;`)", () => {
    expect(r("UPDATE users SET name = 'a' WHERE id = 1 RETURNING *;")).toEqual({ cols: ["passwordHash"] });
  });
  test("RETURNING of non-protected columns is a proof of no protected egress", () => {
    expect(r("INSERT INTO users (name) VALUES ('a') RETURNING id, name")).toBeNull();
  });
  test("a SELECT of non-protected columns over a known table → null", () => {
    expect(r("SELECT id, name FROM users WHERE name = ${n}")).toBeNull();
  });
  test("a `$N` positional parameter does not defeat resolution", () => {
    expect(r("SELECT id, passwordHash FROM users WHERE id = $1")).toEqual({ cols: ["passwordHash"] });
  });
  test("an interpolation with balanced braces in an object literal still resolves", () => {
    expect(r('SELECT id, passwordHash FROM users WHERE name = ${ ({v:"alice"}).v }')).toEqual({ cols: ["passwordHash"] });
  });
  test("a quoted table name stays fail-closed (the FROM parser reads bare names only — unchanged)", () => {
    expect(r('SELECT id, passwordHash FROM "users"')).toEqual(ALL);
  });
});

describe("§14.8.9 S454 — a nested SELECT over a source of unknown columns strips wholesale", () => {
  test("scalar subquery over an unknown view", () => {
    expect(r("SELECT id, (SELECT p FROM v WHERE v.id = users.id) AS x FROM users")).toEqual(ALL);
  });
  test("scalar subquery over a table-valued function", () => {
    expect(r("SELECT id, (SELECT value FROM json_each(users.name)) AS x FROM users")).toEqual(ALL);
  });
  test("scalar subquery over a derived table", () => {
    expect(r("SELECT id, (SELECT a FROM (SELECT name AS a FROM users)) AS x FROM users")).toEqual(ALL);
  });
  test("scalar subquery with an unknown comma-joined source", () => {
    expect(r("SELECT id, (SELECT count(*) FROM loads, v) AS x FROM users")).toEqual(ALL);
  });
  test("scalar subquery JOINing an unknown source", () => {
    expect(r("SELECT id, (SELECT l.status FROM loads l JOIN v ON v.id = l.id) AS x FROM users")).toEqual(ALL);
  });
  test("COUNT(*) subquery over KNOWN tables stays resolved (round-5 trucking shape)", () => {
    expect(r("SELECT id, name, (SELECT COUNT(*) FROM loads l WHERE l.customer_id = users.id) AS n FROM users")).toBeNull();
  });
});

describe("§14.8.9 S454 r2 — a lone CR inside a `--` comment is unknown (the received text is path- and dialect-dependent)", () => {
  const cr = [
    ["SELECT", "SELECT id, name -- c\r, passwordHash FROM users"],
    ["SELECT with a lone CR then more comment text", "SELECT id, name -- c\rx\n FROM users"],
    ["UNION behind the CR", "SELECT id FROM users -- c\rUNION SELECT passwordHash FROM users"],
    ["a write whose RETURNING hides behind the CR (beats the no-RETURNING proof)", "UPDATE users SET name = 'a' -- c\rRETURNING *"],
    ["a DELETE with no RETURNING but a CR comment", "DELETE FROM users -- c\r WHERE id = 1"],
  ];
  for (const [label, sql] of cr) {
    test(`${label} → { all: true }`, () => {
      expect(r(sql)).toEqual(ALL);
    });
  }
  test("CRLF ends a `--` comment identically on every path: still resolved", () => {
    expect(r("SELECT id, name -- c\r\n, passwordHash FROM users")).toEqual({ cols: ["passwordHash"] });
    expect(r("SELECT id, name -- c\r\n FROM users")).toBeNull();
  });
  test("a CR outside a line comment (whitespace, block comment) is harmless", () => {
    expect(r("SELECT id,\rname,\rpasswordHash\rFROM users")).toEqual({ cols: ["passwordHash"] });
    expect(r("SELECT id, name /* c\r */ FROM users")).toBeNull();
  });
});

describe("§14.8.9 S454 r2 — a RETURNING target is read from the original text, never the blanked placeholder", () => {
  const withQ = {
    ...ctx,
    schemaByTable: new Map([...ctx.schemaByTable, ["q", ["id", "label"]]]),
    knownTables: new Set([...ctx.knownTables, "q"]),
  };
  const rq = (sql) => resolveProtectedOutputColumns(sql, withQ);
  const quoted = [
    ['UPDATE "users"', 'UPDATE "users" SET name = \'a\' WHERE id = 1 RETURNING *'],
    ["UPDATE [users]", "UPDATE [users] SET name = 'a' WHERE id = 1 RETURNING *"],
    ["UPDATE `users`", "UPDATE `users` SET name = 'a' WHERE id = 1 RETURNING *"],
    ['UPDATE "USERS" (case folds)', 'UPDATE "USERS" SET name = \'a\' RETURNING *'],
    ['DELETE FROM "users"', 'DELETE FROM "users" WHERE id = 2 RETURNING *'],
    ['INSERT INTO "users"', 'INSERT INTO "users" (name) VALUES (\'a\') RETURNING *'],
  ];
  for (const [label, sql] of quoted) {
    test(`${label} … RETURNING * → tags passwordHash (not table q)`, () => {
      expect(rq(sql)).toEqual({ cols: ["passwordHash"] });
    });
  }
  test("a quoted target that is not a plain identifier is unreadable → { all: true }", () => {
    expect(rq('UPDATE "my table" SET name = \'a\' RETURNING *')).toEqual(ALL);
    expect(rq('UPDATE "us""ers" SET name = \'a\' RETURNING *')).toEqual(ALL);
  });
  test("a bare `q` target still resolves to the real table q", () => {
    expect(rq("UPDATE q SET label = 'a' RETURNING *")).toBeNull();
  });
});

describe("classifyProtectStatement", () => {
  test("kinds", () => {
    expect(classifyProtectStatement("select 1")).toBe("select");
    expect(classifyProtectStatement("insert into users (name) values ('a')")).toBe("write");
    expect(classifyProtectStatement("create table t (id integer)")).toBe("no-rows");
    expect(classifyProtectStatement("pragma foreign_keys = on")).toBe("unknown");
    expect(classifyProtectStatement("; select 1")).toBe("unknown");
    expect(classifyProtectStatement("select 1;")).toBe("select");
  });
});
