/**
 * fix-sql-failable.test.js — the `scrml fix` rule `sql-failable` (SPEC §19.8.3, S451 R11 item 5(a)).
 * change-id: s455-scrml-fix-r11-sql-failable.
 *
 * An UNHANDLED `?{}` outside a `!` function gets the superseded silent meaning written out:
 * `.get() !{ _ :> not }`, `.all()` / bare `!{ _ :> [] }`, `.run() !{ _ :> {} }`. Every rewritten site
 * carries an INFO (on impl#1 a failure there used to throw). Sites the rule cannot rewrite are
 * LISTED (blockers). Exempt / already handled sites are untouched and not reported.
 */

import { describe, test, expect } from "bun:test";
import { fixSqlFailable, SQL_FALLBACK, SQL_FAILABLE_RULE } from "../../src/commands/fix-sql-failable.js";
import { fixS66, S66_RULES, IMPL1_SAFE_RULES } from "../../src/commands/fix-s66.js";

const SQ = "?" + "{";
const q = (sql) => `${SQ}\`${sql}\`}`;
const program = (lines) => ["<program db=\"sqlite:./app.db\">", "  <out> = \"\"", ...lines, "</program>", ""].join("\n");
const fix = (src, opts = {}) => fixSqlFailable(src, { filePath: "/virtual/app.scrml", ...opts });
const reasons = (r) => r.blockers.map((b) => b.reason);
const NOT = SQL_FALLBACK.get;
const EMPTY = SQL_FALLBACK.all;
const CONT = SQL_FALLBACK.run;

describe("sql-failable — the spelling (S451 5(a), §18.2 arm, no leading `|`)", () => {
  test("per terminator", () => {
    expect(SQL_FALLBACK.get).toBe("!{ _ :> not }");
    expect(SQL_FALLBACK.all).toBe("!{ _ :> [] }");
    expect(SQL_FALLBACK.bare).toBe("!{ _ :> [] }");
    expect(SQL_FALLBACK.run).toBe("!{ _ :> {} }");
  });
});

describe("sql-failable — rewrites", () => {
  test("statements: `.run()`, bare, a discarded `.get()`, inside `if` and `for` bodies — each handled + an INFO", () => {
    const src = program([
      "  ${ function save(id) {",
      `      ${q("INSERT INTO t (n) VALUES (1)")}.run()`,
      `      ${q("DELETE FROM t WHERE n = 0")}`,
      `      ${q("SELECT n FROM t")}.get()`,
      "      if (id > 1) {",
      `          ${q("UPDATE t SET n = 2")}.run()`,
      "      }",
      "      for (const i of [1, 2]) {",
      `          ${q("UPDATE t SET n = 3")}.run()`,
      "      }",
      "      return 1",
      "  } }",
      "  <button onclick={ @out = save(1) !{ .Transport(_) :> { return } } }>go</button>",
    ]);
    const r = fix(src);
    expect(r.blockers).toEqual([]);
    expect(r.changed).toBe(true);
    expect(r.output).toContain(`${q("INSERT INTO t (n) VALUES (1)")}.run() ${CONT}\n`);
    expect(r.output).toContain(`${q("DELETE FROM t WHERE n = 0")} ${EMPTY}\n`);
    expect(r.output).toContain(`${q("SELECT n FROM t")}.get() ${NOT}\n`);
    expect(r.output).toContain(`${q("UPDATE t SET n = 2")}.run() ${CONT}\n`);
    expect(r.output).toContain(`${q("UPDATE t SET n = 3")}.run() ${CONT}\n`);
    expect(r.applied.length).toBe(5);
    expect(r.applied.every((a) => a.rule === SQL_FAILABLE_RULE)).toBe(true);
    expect(r.infos.length).toBe(5);
    expect(r.infos.every((i) => /used to throw on impl#1 \(HTTP 500, caller aborted\); it now continues/.test(i.message))).toBe(true);
  });

  test("values: const / let / plain reassignment / return with `.get()` / `.all()` / bare", () => {
    const src = program([
      "  ${ function load() {",
      `      const a = ${q("SELECT n FROM t")}.get()`,
      `      let b = ${q("SELECT n FROM t")}.all()`,
      `      const c = ${q("SELECT n FROM t")}`,
      "      let d = not",
      `      d = ${q("SELECT n FROM t WHERE n = 1")}.get()`,
      "      log(a, b, c, d)",
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
    expect(twice.blockers).toEqual([]);
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
    listedOnly(["  ${ function a() {", `      const r = ${q("UPDATE t SET n = 1")}.run()`, "      return 1", "  } }", "  <button onclick={ @out = a() !{ .Transport(_) :> { return } } }>a</button>"], /`\.run\(\)` as a value/);
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
  });
  test("a body-split function (it also writes a cell)", () => {
    listedOnly([
      "  ${ function a() {",
      `      ${q("UPDATE t SET n = 1")}.run()`,
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
      `      ${q("UPDATE t SET n = 1")}.run()`,
      "      return 1",
      "  } }",
      "  ${ fn bad() {",
      `      ${q("UPDATE t SET n = 2")}.run()`,
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
      `      ${q("UPDATE t SET n = 1")}.run()`,
      `      lift ${q("SELECT n FROM t")}.all()`,
      "  } }",
      "  <button onclick={ @out = a() !{ .Transport(_) :> { return } } }>a</button>",
    ]);
    const r = fix(src);
    expect(r.changed).toBe(true);
    expect(r.output).toContain(`${q("UPDATE t SET n = 1")}.run() ${CONT}\n`);
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
