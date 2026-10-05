/**
 * fix-sql-failable.test.js — the `scrml fix` rule `sql-failable` (SPEC §19.8.3, S451 R11; S455
 * "b your rec on R11": READS only). change-id: s455-scrml-fix-r11-sql-failable.
 *
 * An UNHANDLED `?{}` READ outside a `!` function gets the superseded silent meaning written out:
 * `.get() !{ _ :> not }`, `.all()` / bare `!{ _ :> [] }`. Every rewritten site carries an INFO (on
 * impl#1 a failure there used to throw). Every WRITE (`.run()`, a bare `?{}` statement, anything not
 * provably a pure SELECT) is LISTED, never rewritten. Exempt / already handled sites are untouched.
 */

import { describe, test, expect } from "bun:test";
import { fixSqlFailable, classifySql, SQL_FALLBACK, SQL_FAILABLE_RULE } from "../../src/commands/fix-sql-failable.js";
import { fixS66, S66_RULES, IMPL1_SAFE_RULES } from "../../src/commands/fix-s66.js";

const SQ = "?" + "{";
const q = (sql) => `${SQ}\`${sql}\`}`;
const program = (lines) => ["<program db=\"sqlite:./app.db\">", "  <out> = \"\"", ...lines, "</program>", ""].join("\n");
const fix = (src, opts = {}) => fixSqlFailable(src, { filePath: "/virtual/app.scrml", ...opts });
const reasons = (r) => r.blockers.map((b) => b.reason);
const NOT = SQL_FALLBACK.get;
const EMPTY = SQL_FALLBACK.all;

describe("sql-failable — the spelling (S451 5(a), §18.2 arm, no leading `|`; reads only, S455)", () => {
  test("per terminator — no `.run()` shape", () => {
    expect(SQL_FALLBACK.get).toBe("!{ _ :> not }");
    expect(SQL_FALLBACK.all).toBe("!{ _ :> [] }");
    expect(SQL_FALLBACK.bare).toBe("!{ _ :> [] }");
    expect(SQL_FALLBACK.run).toBeUndefined();
  });
});

describe("sql-failable — classifySql (lead-keyword scan, fail closed)", () => {
  test("pure reads", () => {
    for (const s of [
      "SELECT n FROM t",
      "  select n from t where id = ${id}",
      "-- a comment\nSELECT 1",
      "/* lead */ SELECT 1",
      "(SELECT n FROM t) UNION (SELECT n FROM u)",
      "WITH x AS (SELECT n FROM t) SELECT * FROM x",
      "WITH RECURSIVE c(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM c WHERE n < 3) SELECT n FROM c",
      "VALUES (1), (2)",
      "SELECT replace(name, 'a', 'b') FROM t",
      "SELECT 'INSERT INTO x' AS s, \"update\" FROM t",
      "SELECT n FROM t WHERE s = ${'DELETE FROM t'}",
      "SELECT n FROM t;",
    ]) expect([s, classifySql(s)]).toEqual([s, "read"]);
  });
  test("writes — every statement kind, RETURNING, WITH-led, comment-led, multi-statement, unclassifiable", () => {
    for (const s of [
      "INSERT INTO t (n) VALUES (1)",
      "insert into t (n) values (1) returning id",
      "UPDATE t SET n = 1",
      "UPDATE t SET n = 1 RETURNING n",
      "DELETE FROM t WHERE id = ${id}",
      "DELETE FROM t RETURNING *",
      "REPLACE INTO t (n) VALUES (1)",
      "INSERT OR REPLACE INTO t (n) VALUES (1)",
      "UPSERT INTO t VALUES (1)",
      "INSERT INTO t (n) VALUES (1) ON CONFLICT (n) DO UPDATE SET n = 2",
      "MERGE INTO t USING u ON t.id = u.id WHEN MATCHED THEN UPDATE SET n = 1",
      "WITH x AS (SELECT 1) UPDATE t SET n = 1",
      "WITH x AS (SELECT 1) INSERT INTO t SELECT * FROM x",
      "WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d",
      "-- just a select?\nDELETE FROM t",
      "/* SELECT */ UPDATE t SET n = 1",
      "SELECT * INTO t2 FROM t",
      "SELECT 1; DELETE FROM t",
      "CREATE TABLE t (n INT)",
      "PRAGMA user_version = 3",
      "BEGIN",
      "",
      "SELECT 'unterminated",
      "${q}",
    ]) expect([s, classifySql(s)]).toEqual([s, "write"]);
  });
});

describe("sql-failable — reads rewritten", () => {
  test("statements: a discarded `.get()` / `.all()` read, inside `if` and `for` bodies — each handled + an INFO", () => {
    const src = program([
      "  ${ function warm(id) {",
      `      ${q("SELECT n FROM t")}.get()`,
      "      if (id > 1) {",
      `          ${q("SELECT n FROM t WHERE n = 2")}.all()`,
      "      }",
      "      for (const i of [1, 2]) {",
      `          ${q("SELECT n FROM t WHERE n = 3")}.get()`,
      "      }",
      "      return 1",
      "  } }",
      "  <button onclick={ @out = warm(1) !{ .Transport(_) :> { return } } }>go</button>",
    ]);
    const r = fix(src);
    expect(r.blockers).toEqual([]);
    expect(r.output).toContain(`${q("SELECT n FROM t")}.get() ${NOT}\n`);
    expect(r.output).toContain(`${q("SELECT n FROM t WHERE n = 2")}.all() ${EMPTY}\n`);
    expect(r.output).toContain(`${q("SELECT n FROM t WHERE n = 3")}.get() ${NOT}\n`);
    expect(r.applied.length).toBe(3);
    expect(r.applied.every((a) => a.rule === SQL_FAILABLE_RULE)).toBe(true);
    expect(r.infos.length).toBe(3);
    expect(r.infos.every((i) => /used to throw on impl#1 \(HTTP 500, caller aborted\); it now continues past it/.test(i.message))).toBe(true);
  });

  test("values: const / let / keywordless `x =` / return with `.get()` / `.all()` / bare, a WITH-led read", () => {
    const src = program([
      "  ${ function load() {",
      `      const a = ${q("SELECT n FROM t")}.get()`,
      `      let b = ${q("SELECT n FROM t")}.all()`,
      `      const c = ${q("SELECT n FROM t")}`,
      "      let d = not",
      `      d = ${q("SELECT n FROM t WHERE n = 1")}.get()`,
      `      const e = ${q("WITH x AS (SELECT n FROM t) SELECT n FROM x")}.all()`,
      "      log(a, b, c, d, e)",
      `      return ${q("SELECT n FROM t WHERE n = 2")}.get()`,
      "  } }",
      "  ${ function list() {",
      `      return ${q("SELECT n FROM t")}.all()`,
      "  } }",
      "  ${ function raw() {",
      `      return ${q("SELECT n FROM t")}`,
      "  } }",
      "  <button onclick={ @out = load() !{ .Transport(_) :> { return } } }>a</button>",
      "  <button onclick={ @out = list() !{ .Transport(_) :> { return } } }>b</button>",
      "  <button onclick={ @out = raw() !{ .Transport(_) :> { return } } }>c</button>",
    ]);
    const r = fix(src);
    expect(r.blockers).toEqual([]);
    expect(r.output).toContain(`const a = ${q("SELECT n FROM t")}.get() ${NOT}\n`);
    expect(r.output).toContain(`let b = ${q("SELECT n FROM t")}.all() ${EMPTY}\n`);
    expect(r.output).toContain(`const c = ${q("SELECT n FROM t")} ${EMPTY}\n`);
    expect(r.output).toContain(`d = ${q("SELECT n FROM t WHERE n = 1")}.get() ${NOT}\n`);
    expect(r.output).toContain(`const e = ${q("WITH x AS (SELECT n FROM t) SELECT n FROM x")}.all() ${EMPTY}\n`);
    expect(r.output).toContain(`return ${q("SELECT n FROM t WHERE n = 2")}.get() ${NOT}\n`);
    expect(r.output).toContain(`return ${q("SELECT n FROM t")}.all() ${EMPTY}\n`);
    expect(r.output).toContain(`return ${q("SELECT n FROM t")} ${EMPTY}\n`);
    expect(r.infos.some((i) => /it now yields `not`/.test(i.message))).toBe(true);
    expect(r.infos.some((i) => /it now yields `\[\]`/.test(i.message))).toBe(true);
  });

  test("a multi-line query: the arm goes after the terminator", () => {
    const src = program([
      "  ${ function load() {",
      `      const rows = ${SQ}\``,
      "          SELECT n",
      "          FROM t",
      "      `}.all()",
      "      return rows",
      "  } }",
      "  <button onclick={ @out = load() !{ .Transport(_) :> { return } } }>a</button>",
    ]);
    const r = fix(src);
    expect(r.output).toContain(`      \`}.all() ${EMPTY}\n`);
  });

  test("idempotent: a second run changes nothing and reports nothing new", () => {
    const src = program([
      "  ${ function save() {",
      `      ${q("INSERT INTO t (n) VALUES (1)")}.run()`,
      `      const a = ${q("SELECT n FROM t")}.get()`,
      "      return a",
      "  } }",
      "  <button onclick={ @out = save() !{ .Transport(_) :> { return } } }>go</button>",
    ]);
    const once = fix(src);
    expect(once.changed).toBe(true);
    const twice = fix(once.output);
    expect(twice.changed).toBe(false);
    expect(twice.output).toBe(once.output);
    expect(reasons(twice)).toEqual(reasons(once));
  });
});

describe("sql-failable — writes listed, never rewritten (S455)", () => {
  test("`.run()`, a bare statement, INSERT/UPDATE/DELETE/REPLACE … RETURNING via `.get()`/`.all()`/bare, WITH-led, comment-led, unclassifiable — in every rewrite position", () => {
    const src = program([
      "  ${ function save(id) {",
      `      ${q("INSERT INTO t (n) VALUES (1)")}.run()`,
      `      ${q("DELETE FROM t WHERE n = 0")}`,
      `      ${q("SELECT n FROM t")}.run()`,
      "      if (id > 1) {",
      `          ${q("UPDATE t SET n = 2")}.run()`,
      "      }",
      `      const a = ${q("INSERT INTO t (n) VALUES (2) RETURNING id")}.get()`,
      `      let b = ${q("UPDATE t SET n = 3 RETURNING n")}.all()`,
      `      const c = ${q("WITH x AS (SELECT 1) DELETE FROM t RETURNING *")}`,
      "      let d = not",
      `      d = ${q("REPLACE INTO t (n) VALUES (4) RETURNING n")}.get()`,
      `      const e = ${q("-- read?\nDELETE FROM t RETURNING n")}.all()`,
      "      log(a, b, c, d, e)",
      `      return ${q("INSERT INTO t (n) VALUES (5) RETURNING id")}.get()`,
      "  } }",
      "  <button onclick={ @out = save(1) !{ .Transport(_) :> { return } } }>go</button>",
    ]);
    const r = fix(src);
    expect(r.changed).toBe(false);
    expect(r.output).toBe(src);
    expect(r.infos).toEqual([]);
    const w = r.blockers.filter((b) => /WRITE/.test(b.reason));
    expect(w.length).toBe(10);
    expect(w.every((b) => /a failure throws today/.test(b.reason) && /swallow it silently/.test(b.reason) && /move it into a `!` function/.test(b.reason))).toBe(true);
    expect(w.some((b) => /`\.run\(\)`/.test(b.reason))).toBe(true);
    expect(w.some((b) => /a bare `\?\{…\}` statement/.test(b.reason))).toBe(true);
    expect(w.some((b) => /not provably a pure SELECT/.test(b.reason))).toBe(true);
  });
  test("reads and writes in one function: the reads are rewritten, the writes listed (S239: admin-panel doRevokeKey shape)", () => {
    const src = program([
      "  ${ function revoke(id) {",
      `      const key = ${q("SELECT id FROM api_keys WHERE id = ${id}")}.get()`,
      `      ${q("UPDATE api_keys SET revoked = 1 WHERE id = ${id}")}.run()`,
      `      ${q("INSERT INTO admin_log (action) VALUES ('revoked')")}.run()`,
      "      return key",
      "  } }",
      "  <button onclick={ @out = revoke(1) !{ .Transport(_) :> { return } } }>go</button>",
    ]);
    const r = fix(src);
    expect(r.output).toContain(`.get() ${NOT}\n`);
    expect(r.output).toContain(`${q("UPDATE api_keys SET revoked = 1 WHERE id = ${id}")}.run()\n`);
    expect(r.output).toContain(`${q("INSERT INTO admin_log (action) VALUES ('revoked')")}.run()\n`);
    expect(r.applied.length).toBe(1);
    expect(r.blockers.filter((b) => /WRITE/.test(b.reason)).length).toBe(2);
  });
});

describe("sql-failable — not touched (exempt / already handled)", () => {
  test("inside a `!` function (§19.8.2), an already-handled `?{}` (statement, declaration, match), a `<x server>` hydration load (§19.8.3 / §52.6.8)", () => {
    const src = program([
      "  type E:enum = { Gone }",
      `  <driver server> = ${q("SELECT n FROM t")}.get()`,
      "  ${ function strict()! -> SqlError {",
      `      ${q("DELETE FROM t")}.run()`,
      `      const a = ${q("SELECT n FROM t")}.get()`,
      "      return a",
      "  } }",
      "  ${ function handled() {",
      `      ${q("DELETE FROM t")}.run() !{ _ :> {} }`,
      `      const a = ${q("SELECT n FROM t")}.get() !{ .QueryFailed(m) :> not  _ :> not }`,
      `      const b = match ${q("SELECT n FROM t")}.all() {`,
      "          .Ok(rows) :> rows",
      "          _ :> []",
      "      }",
      "      return a",
      "  } }",
      "  <button onclick={ @out = handled() !{ .Transport(_) :> { return } } }>go</button>",
      "  <p>${@driver}</p>",
    ]);
    const r = fix(src);
    expect(r.changed).toBe(false);
    expect(r.blockers).toEqual([]);
    expect(r.infos).toEqual([]);
  });
});

describe("sql-failable — listed, never rewritten", () => {
  const listedOnly = (lines, re) => {
    const src = program(lines);
    const r = fix(src);
    expect(r.changed).toBe(false);
    expect(r.output).toBe(src);
    expect(reasons(r).some((x) => re.test(x))).toBe(true);
    return r;
  };
  test("`lift ?{}` (impl#1 drops the lifted value of a handled query)", () => {
    listedOnly(["  ${ function rows() {", `      lift ${q("SELECT n FROM t")}.all()`, "  } }", "  <button onclick={ @out = rows() !{ .Transport(_) :> { return } } }>a</button>"], /inside a `lift`/);
  });
  test("`@x = ?{}` in a function (impl#1 moves a handled write to the server)", () => {
    listedOnly(["  ${ function load() {", `      @out = ${q("SELECT n FROM t")}.get()`, "  } }", "  <button onclick={ load() !{ .Transport(_) :> { return } } }>a</button>"], /cell write/);
  });
  test("an `if` condition and a `for … of` iterable", () => {
    listedOnly([
      "  ${ function load() {",
      `      if (${q("SELECT n FROM t")}.get()) { return 1 }`,
      "      let n = 0",
      `      for (const r of ${q("SELECT n FROM t")}.all()) { n = n + 1 }`,
      "      return n",
      "  } }",
      "  <button onclick={ @out = load() !{ .Transport(_) :> { return } } }>a</button>",
    ], /an `if` condition/);
    const r = fix(program([
      "  ${ function load() {",
      "      let n = 0",
      `      for (const r of ${q("SELECT n FROM t")}.all()) { n = n + 1 }`,
      "      return n",
      "  } }",
      "  <button onclick={ @out = load() !{ .Transport(_) :> { return } } }>a</button>",
    ]));
    expect(r.changed).toBe(false);
    expect(reasons(r).some((x) => /`for` header/.test(x))).toBe(true);
  });
  test("a body top", () => {
    listedOnly([`  \${ let rows = ${q("SELECT n FROM t")}.all() }`, "  <p>${rows.length}</p>"], /body top/);
  });
  test("a terminator outside §44.3 (`.first()`), a chained member, `.nobatch()`, `.run()` as a value", () => {
    listedOnly(["  ${ function a() {", `      let x = ${q("SELECT n FROM t")}.first()`, "      return x", "  } }", "  <button onclick={ @out = a() !{ .Transport(_) :> { return } } }>a</button>"], /not a §44.3 terminator/);
    listedOnly(["  ${ function a() {", `      const n = ${q("SELECT n FROM t")}.all().length`, "      return n", "  } }", "  <button onclick={ @out = a() !{ .Transport(_) :> { return } } }>a</button>"], /inside an expression/);
    listedOnly(["  ${ function a() {", `      ${q("UPDATE t SET n = 1")}.nobatch().run()`, "      return 1", "  } }", "  <button onclick={ @out = a() !{ .Transport(_) :> { return } } }>a</button>"], /nobatch/);
    listedOnly(["  ${ function a() {", `      const r = ${q("UPDATE t SET n = 1")}.run()`, "      return 1", "  } }", "  <button onclick={ @out = a() !{ .Transport(_) :> { return } } }>a</button>"], /WRITE \(`\.run\(\)`\)/);
  });
  test("a declaration in a nested block / loop, or captured by a closure (impl#1 lowers a handled declaration to `var`)", () => {
    listedOnly([
      "  ${ function a() {",
      "      let out = []",
      "      for (const i of [1, 2]) {",
      `          const row = ${q("SELECT n FROM t")}.get()`,
      "          out.push(row)",
      "      }",
      "      return out",
      "  } }",
      "  <button onclick={ @out = a() !{ .Transport(_) :> { return } } }>a</button>",
    ], /nested block \/ loop/);
    listedOnly([
      "  ${ function a() {",
      `      const row = ${q("SELECT n FROM t")}.get()`,
      "      const f = () => row",
      "      return f()",
      "  } }",
      "  <button onclick={ @out = a() !{ .Transport(_) :> { return } } }>a</button>",
    ], /captured by a closure/);
    listedOnly([
      "  ${ function a(id) {",
      "      if (id > 1) {",
      `          rows = ${q("SELECT n FROM t")}`,
      "          return rows",
      "      }",
      "      return []",
      "  } }",
      "  <button onclick={ @out = a(2) !{ .Transport(_) :> { return } } }>a</button>",
    ], /nested block \/ loop/);
  });
  test("a body-split function (it also writes a cell)", () => {
    listedOnly([
      "  ${ function a() {",
      `      ${q("SELECT n FROM t")}.get()`,
      "      @out = \"done\"",
      "  } }",
      "  <button onclick={ a() !{ .Transport(_) :> { return } } }>a</button>",
    ], /split across client and server/);
  });
  test("a transaction-control statement", () => {
    listedOnly(["  ${ function a() {", `      ${q("BEGIN")}.run()`, `      ${q("COMMIT")}.run()`, "      return 1", "  } }", "  <button onclick={ @out = a() !{ .Transport(_) :> { return } } }>a</button>"], /transaction-control/);
  });
  test("the gate: a rewrite that changes impl#1's codes reverts the WHOLE file (a handled `?{}` in a `fn` loses E-FN-001 on impl#1)", () => {
    const src = program([
      "  ${ function ok() {",
      `      ${q("SELECT n FROM t")}.get()`,
      "      return 1",
      "  } }",
      "  ${ fn bad() {",
      `      ${q("SELECT n FROM t WHERE n = 2")}.get()`,
      "      return 2",
      "  } }",
      "  <button onclick={ @out = ok() !{ .Transport(_) :> { return } } }>a</button>",
    ]);
    const r = fix(src);
    expect(r.changed).toBe(false);
    expect(r.output).toBe(src);
    expect(r.infos).toEqual([]);
    expect(reasons(r).some((x) => /different codes after the rewrite/.test(x) && /E-FN-001/.test(x))).toBe(true);
  });
  test("the gate: a rewrite that changes impl#1's Promise.all batching of a caller reverts the file (§13.2)", () => {
    const src = program([
      "  <b1> = not",
      "  <b2> = not",
      "  ${ function balanceOf(id: number) {",
      `      return ${q("SELECT n FROM t WHERE id = ${id}")}.get()`,
      "  } }",
      "  ${ function onRead() {",
      "      @b1 = balanceOf(1)",
      "      @b2 = balanceOf(2)",
      "  } }",
      "  <button onclick=onRead()>read</button>",
    ]);
    const r = fix(src);
    expect(r.changed).toBe(false);
    expect(reasons(r).some((x) => /batches this file's server calls differently/.test(x))).toBe(true);
  });
  test("a listed site does not stop the other sites in the file", () => {
    const src = program([
      "  ${ function a() {",
      `      ${q("SELECT n FROM t WHERE n = 1")}.get()`,
      `      lift ${q("SELECT n FROM t")}.all()`,
      "  } }",
      "  <button onclick={ @out = a() !{ .Transport(_) :> { return } } }>a</button>",
    ]);
    const r = fix(src);
    expect(r.changed).toBe(true);
    expect(r.output).toContain(`${q("SELECT n FROM t WHERE n = 1")}.get() ${NOT}\n`);
    expect(r.output).toContain(`      lift ${q("SELECT n FROM t")}.all()\n`);
    expect(reasons(r).some((x) => /inside a `lift`/.test(x))).toBe(true);
  });
});

describe("sql-failable — chaining (fix-s66)", () => {
  test("a DEFAULT rule chained after client-server-call; fixS66 carries its infos", () => {
    expect(IMPL1_SAFE_RULES).toContain("sql-failable");
    expect(S66_RULES.indexOf("sql-failable")).toBe(S66_RULES.indexOf("client-server-call") + 1);
    const src = program([
      "  ${ function a() {",
      `      const row = ${q("SELECT n FROM t")}.get()`,
      "      return row",
      "  } }",
      "  <button onclick={ @out = a() !{ .Transport(_) :> { return } } }>a</button>",
    ]);
    const r = fixS66(src, { filePath: "/virtual/app.scrml", rules: [...IMPL1_SAFE_RULES] });
    expect(r.output).toContain(`.get() ${NOT}\n`);
    expect(r.applied.some((a) => a.rule === "sql-failable")).toBe(true);
    expect(r.infos.some((i) => i.rule === "sql-failable")).toBe(true);
    const off = fixS66(src, { filePath: "/virtual/app.scrml", rules: ["pre-migrate"] });
    expect(off.output).toBe(src);
  });
});
