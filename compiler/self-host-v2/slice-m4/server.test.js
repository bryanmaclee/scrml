// server.test.js — s451 bootstrap unit U1a: `?{}` SQL + route placement
// (front end + Core, NO emission). Design authority:
// scrml-support/docs/deep-dives/bootstrap-u1-server-boundary-design-2026-10-03.md
// (§1, §2, §5, §8 row U1a), superseded by the S451 rulings (user-voice
// §S451; SPEC §13.7, §12.4, §19.8.3). Governing sentences: docs/changes/
// s451-boot-u1a/progress.md.
//
// Every slice test here is a §66-dialect program (the U0 precedent: the
// conformance corpus is legacy dialect). The design's named mirrors:
//   sql/bad-conn-prefix-neg, server-db/sql-missing-db-e-sql-004-neg,
//   server-db/sql-configured-db-no-e-sql-004, sql/prepare-server-fn-e-sql-006-neg,
//   sql/runtime-expr-body-e-sql-003-neg, server-fn/e-route-002-{pos,neg},
//   server-fn/e-route-005-{pos,neg}, server-db/server-fn-writes-reactive-cell-{pos,neg}.
//
// S451 R11: every `?{}` is failable; outside a `!` function an unhandled one
// is E-ERROR-002, and every handling form (`!{}`, `match`, a `!` function) is
// refused until unit Ue. So NO program holding a `?{}` lowers to Core here —
// the diagnostics gate (§2.2.1) holds. The tests that inspect the lowered
// query drop the E-ERROR-002 reports from the TypedProgram THEMSELVES (test
// side — the compiler has no such door) to stand in for Ue's handled form.

import { describe, test, expect, beforeAll } from "bun:test";
import { loadM2, frontEnd } from "./harness.js";

let mods;
beforeAll(() => { ({ mods } = loadM2()); }, { timeout: 120000 });

const run = (src) => frontEnd(mods, [{ path: "t.scrml", src }]);
const codes = (src) => run(src).diags.map((d) => d.code);
const sorted = (src) => codes(src).slice().sort();
const diag = (src, code) => run(src).diags.find((d) => d.code === code);
const P = (attrs, decls, main = "") => `<program${attrs}>\n${decls}\n    <main>\n${main}\n    </main>\n</program>\n`;
const DB = ` db="./app.db"`;
// the lowered Core as Ue would give it: the test drops the R11 reports
const lowerHandled = (r) => mods.lower.lower({ ...r.typed, diags: r.typed.diags.filter((d) => d.code !== "E-ERROR-002") }).core;
const v = (x) => (x && typeof x === "object" ? x.variant : x);
const SQ = "?" + "{";   // the sigil, for building sources in JS strings

const fnQ = (name, sql, mode = "get", params = "id: int", ret = "") =>
  `    function ${name}(${params})${ret} {\n        const r = ${SQ}\`${sql}\`}.${mode}()\n        return 1\n    }`;

describe("§8.1 / §44.8 — parsing `?{}`", () => {
  test("a query with bound values parses: literal runs and values, `${}` never text", () => {
    const r = run(P(DB, `    function f(id: int, n: string) {\n        ${SQ}\`UPDATE t SET name = \${n} WHERE id = \${id}\`}.run()\n    }`));
    const fn = r.asts[0].items[0].k.data.p.items.find((it) => v(it.k) === "FnItem").k.data.f;
    const sql = fn.body.stmts[0].k.data.e.k.data.q;
    expect(sql.chunks).toEqual(["UPDATE t SET name = ", " WHERE id = ", ""]);
    expect(sql.params.map((p) => p.k.data.name)).toEqual(["n", "id"]);
    expect(v(sql.mode)).toBe("SqlRun");
    expect(sql.nobatch).toBe(false);
  });

  test("the chain: `.nobatch()` in any position, `.all()` / `.get()` / `.run()`, bare = all", () => {
    const parse = (chain) => {
      const r = run(P(DB, `    function f() {\n        const x = ${SQ}\`SELECT a FROM t\`}${chain}\n    }`));
      const fn = r.asts[0].items[0].k.data.p.items.find((it) => v(it.k) === "FnItem").k.data.f;
      return fn.body.stmts[0].k.data.init.k.data.q;
    };
    expect(v(parse("").mode)).toBe("SqlAll");
    expect(v(parse(".get()").mode)).toBe("SqlGet");
    const nb = parse(".nobatch().all()");
    expect(nb.nobatch).toBe(true);
    expect(v(nb.mode)).toBe("SqlAll");
    expect(parse(".get().nobatch()").nobatch).toBe(true);
  });

  test("a brace or a backtick inside a SQL string does not end the block (the bracket-matched scanner)", () => {
    expect(codes(P(DB, `    function f() {\n        ${SQ}\`INSERT INTO t (a) VALUES ('}{ \\\`')\`}.run()\n    }`))).toEqual(["E-ERROR-002"]);
  });

  test("E-SQL-008 — an unterminated template, reported at the `?{`", () => {
    const src = P(DB, `    function f() {\n        ${SQ}\`SELECT a FROM t\n    }`);
    const d = run(src).diags.find((x) => x.code === "E-SQL-008");
    expect(d).toBeDefined();
    expect(src.slice(d.span.start, d.span.start + 2)).toBe(SQ);
  });

  test("E-SQL-008 — an unmatched `${` inside the SQL body", () => {
    expect(codes(P(DB, `    function f(id: int) {\n        ${SQ}\`SELECT a FROM t WHERE id = \${id\`}.get()\n    }`))).toContain("E-SQL-008");
  });

  test("E-SQL-003 — the content is not a template (mirror: sql/runtime-expr-body-e-sql-003-neg's family)", () => {
    expect(codes(P(DB, `    function f(q: string) {\n        ${SQ} q }.all()\n    }`))).toEqual(["E-SQL-003"]);
  });

  test("E-SQL-003 — a template with no literal SQL text, only `${…}` (mirror: sql/runtime-expr-body-e-sql-003-neg)", () => {
    const src = P(DB, `    function loadRows(q: string) {\n        return ${SQ}\`\${q}\`}.all()\n    }`, `        <button onclick=loadRows("x")>Load</button>`);
    expect(codes(src)).toContain("E-SQL-003");
    expect(codes(src)).not.toContain("E-SQL-001");
  });

  test("E-SQL-003 — two templates in one block", () => {
    expect(codes(P(DB, `    function f() {\n        ${SQ}\`SELECT 1\` \`SELECT 2\`}.all()\n    }`))).toEqual(["E-SQL-003"]);
  });

  test("E-SQL-006 — `.prepare()` (mirror: sql/prepare-server-fn-e-sql-006-neg)", () => {
    const src = P(DB, `    function loadUsers() {\n        return ${SQ}\`SELECT username FROM users\`}.prepare()\n    }`);
    expect(codes(src)).toContain("E-SQL-006");
  });

  test("`?{` is the sigil, never a ternary's `?`: a statement after a call on the previous line", () => {
    expect(codes(P(DB, `    fn g() -> int { return 1 }\n    function f() {\n        g()\n        ${SQ}\`DELETE FROM t\`}.run()\n    }`))).toEqual(["E-ERROR-002"]);
  });
});

describe("S451 R11 — `?{}` is failable everywhere; the error model (Ue) is refused, never guessed", () => {
  test("an unhandled `?{}` outside a `!` function is E-ERROR-002", () => {
    expect(codes(P(DB, fnQ("f", "SELECT a FROM t WHERE id = ${id}")))).toEqual(["E-ERROR-002"]);
  });

  test("a `!{}` handler on the query is refused (Ue) — and the query is then not ALSO reported unhandled", () => {
    const src = P(DB, `    function f(id: int) {\n        const r = ${SQ}\`SELECT a FROM t WHERE id = \${id}\`}.get() !{ | _ :> not }\n    }`);
    expect(codes(src)).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(diag(src, "E-BOOTSTRAP-UNSUPPORTED").message).toContain("Ue");
  });

  test("a `match` on a query's result is refused (Ue)", () => {
    const src = P(DB, `    function f() {\n        const r = match ${SQ}\`SELECT a FROM t\`}.all() {\n            _ :> 1\n        }\n    }`);
    expect(codes(src)).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(diag(src, "E-BOOTSTRAP-UNSUPPORTED").message).toContain("Ue");
  });

  test("a `!` function signature is refused (Ue); a query inside it is not E-ERROR-002 (it is inside a `!` function)", () => {
    const src = P(DB, `    function f(id: int)! -> SqlError {\n        ${SQ}\`DELETE FROM t WHERE id = \${id}\`}.run()\n    }`);
    expect(codes(src)).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(diag(src, "E-BOOTSTRAP-UNSUPPORTED").message).toContain("Ue");
  });

  test("an unhandled query in a value position is E-ERROR-002 too (and E-VALUE-SERVER-CALL)", () => {
    expect(sorted(P(DB, `    let <m:int=(${SQ}\`SELECT count(*) AS n FROM t\`}.all())/>`))).toEqual(["E-ERROR-002", "E-VALUE-SERVER-CALL"]);
  });
});

describe("§8.1.1 / §44.2 — the database", () => {
  test("no `db=` anywhere → E-SQL-004 (mirror: server-db/sql-missing-db-e-sql-004-neg)", () => {
    const src = P("", `    function getUsers() {\n        return ${SQ}\`SELECT id, name FROM users\`}.all()\n    }`, `        <button onclick=getUsers()>Load users</button>`);
    expect(codes(src)).toContain("E-SQL-004");
    expect(codes(src)).not.toContain("E-SQL-009");
  });

  test("a configured `db=` → no E-SQL-004 (mirror: server-db/sql-configured-db-no-e-sql-004)", () => {
    const src = P(` db="sqlite:./app.db"`, `    function getUsers() {\n        return ${SQ}\`SELECT id, name FROM users\`}.all()\n    }`);
    expect(codes(src)).toEqual(["E-ERROR-002"]);
  });

  test("an unrecognized prefix → E-SQL-005 (mirror: sql/bad-conn-prefix-neg)", () => {
    expect(codes(P(` db="ftp://bad"`, fnQ("f", "SELECT a FROM t")))).toEqual(["E-SQL-005", "E-ERROR-002"]);
  });

  for (const [val, ok] of [
    ["./app.db", true], ["app.db", true], ["sqlite:./app.db", true], [":memory:", true],
    ["postgres://u:p@h:5432/db", true], ["postgresql://h/db", true], ["mysql://h/db", true],
    ["mongodb://h/db", false], ["mongo://h/db", false], ["file:./app.db", false], ["ftp://bad", false],
    ["", false], ["sqlite:", false], ["postgres:h/db", false],
  ]) {
    test(`db="${val}" → ${ok ? "a database" : "E-SQL-005"}`, () => {
      const c = codes(P(` db="${val}"`, ""));
      if (ok) expect(c).toEqual([]);
      else expect(c).toEqual(["E-SQL-005"]);
    });
  }

  test("the Db: driver, target (prefix removed), declaring file; owner iff a query here creates a table (§8.1.1 Ownership)", () => {
    const r = run(P(` db="sqlite:./app.db"`, `    function init() {\n        ${SQ}\`CREATE TABLE IF NOT EXISTS t (id integer primary key)\`}.run()\n    }`));
    const [db] = r.typed.tables.server.dbs;
    expect(v(db.driver)).toBe("Sqlite");
    expect(db.target).toBe("./app.db");
    expect(db.file).toBe("t.scrml");
    expect(db.owner).toBe(true);
    const pg = run(P(` db="postgres://h/db"`, "")).typed.tables.server.dbs[0];
    expect(v(pg.driver)).toBe("Postgres");
    expect(pg.owner).toBe(false);
    const ref = run(P(DB, fnQ("f", "SELECT a FROM t"))).typed.tables.server.dbs[0];
    expect(ref.owner).toBe(false);
  });

  test("a TEMP table does not make the file an owner (§8.1.1)", () => {
    const r = run(P(DB, `    function init() {\n        ${SQ}\`CREATE TEMP TABLE scratch (a)\`}.run()\n    }`));
    expect(r.typed.tables.server.dbs[0].owner).toBe(false);
  });
});

describe("§12 — placement (Client / Server / Ambient; Split detected and refused)", () => {
  const placeOf = (src, name) => v(run(src).typed.tables.server.places.find((p) => p.name === name).place);

  test("a `?{}` places a function on the server; a cell access on the client; neither → ambient", () => {
    const src = P(DB, `    let <n:int=0/>\n${fnQ("srv", "SELECT a FROM t")}\n    function cli() {\n        @n = 1\n    }\n    function amb(x: int) -> int {\n        return x + 1\n    }`);
    expect(placeOf(src, "srv")).toBe("Server");
    expect(placeOf(src, "cli")).toBe("Client");
    expect(placeOf(src, "amb")).toBe("Ambient");
  });

  test("calling a client-only function pins the caller to the client (§12.4)", () => {
    const src = P(DB, `    let <n:int=0/>\n    function cli() -> int {\n        return @n\n    }\n    function viaCli() -> int {\n        return cli()\n    }`);
    expect(placeOf(src, "viaCli")).toBe("Client");
  });

  test("a query + a reactive write → Split (§19.9.5) — refused, naming U1d", () => {
    const src = P(DB, `    let <n:int=0/>\n    function loadAndSet() {\n        const rows = ${SQ}\`SELECT id FROM items\`}.all()\n        @n = 1\n    }`);
    expect(placeOf(src, "loadAndSet")).toBe("Split");
    const d = run(src).diags.filter((x) => x.code === "E-BOOTSTRAP-UNSUPPORTED");
    expect(d.length).toBe(1);
    expect(d[0].message).toContain("U1d");
  });

  test("`server function` → W-DEPRECATED-SERVER-MODIFIER; the function is a Core ServerFn", () => {
    const r = run(P("", `    server function bump(n: int) -> int {\n        return n + 1\n    }`));
    expect(r.diags.map((d) => d.code)).toEqual(["W-DEPRECATED-SERVER-MODIFIER"]);
    expect(r.core.server.map((s) => s.sym.hint)).toEqual(["bump"]);
    expect(r.core.fns.map((f) => f.sym.hint)).not.toContain("bump");
    expect(v(r.core.server[0].ret)).toBe("Int");
    expect(mods.check.checkCore(r.core)).toEqual([]);
  });
});

describe("§6.6.9 / §12 — a wholly-server body touches no cell", () => {
  test("E-REACTIVE-003: a server function reads a cell (once per cell)", () => {
    const src = P(DB, `    let <n:int=0/>\n    function save() {\n        ${SQ}\`INSERT INTO t (a) VALUES (\${@n})\`}.run()\n        ${SQ}\`INSERT INTO t (b) VALUES (\${@n})\`}.run()\n    }`);
    expect(sorted(src)).toEqual(["E-ERROR-002", "E-ERROR-002", "E-REACTIVE-003"]);
    expect(diag(src, "E-REACTIVE-003").message).toContain("@n");
  });

  test("twin: the value passed as an argument is clean of E-REACTIVE-003", () => {
    expect(codes(P(DB, `    let <n:int=0/>\n    function save(total: int) {\n        ${SQ}\`INSERT INTO t (a) VALUES (\${total})\`}.run()\n    }`))).toEqual(["E-ERROR-002"]);
  });

  test("E-RI-002: a `server`-modified function writes a cell (mirror: server-db/server-fn-writes-reactive-cell-pos)", () => {
    const src = P("", `    let <count:int=0/>\n    server function loadAndSet() {\n        @count = 1\n    }`);
    expect(sorted(src)).toEqual(["E-RI-002", "W-DEPRECATED-SERVER-MODIFIER"]);
  });

  test("E-RI-002 for `reset(@x)` in a `server` function — its argument is the write's target, not also a read (no E-REACTIVE-003)", () => {
    expect(sorted(P("", `    let <count:int=0/>\n    server function clear() {\n        reset(@count)\n    }`))).toEqual(["E-RI-002", "W-DEPRECATED-SERVER-MODIFIER"]);
  });

  test("twin: the server function returns the value; the caller is not refused for E-RI-002 (mirror: …-neg)", () => {
    const src = P("", `    let <count:int=0/>\n    server function loadCount() -> int {\n        return 1\n    }`);
    expect(codes(src)).toEqual(["W-DEPRECATED-SERVER-MODIFIER"]);
  });
});

describe("§12.4 — E-ROUTE-002 / E-ROUTE-001 / E-ROUTE-005", () => {
  test("E-ROUTE-002 (R2): a server function reaches a cell through a callee — the message names the chain and the cell (mirror: server-fn/e-route-002-pos)", () => {
    const src = P(DB, `    let <n:int=0/>\n    function auditAndFlash(name: string) {\n        ${SQ}\`INSERT INTO audit (who) VALUES (\${name})\`}.run()\n        flash()\n    }\n    function flash() {\n        mark()\n    }\n    function mark() {\n        @n = @n + 1\n    }`);
    expect(sorted(src)).toEqual(["E-ERROR-002", "E-ROUTE-002"]);
    const m = diag(src, "E-ROUTE-002").message;
    expect(m).toContain("auditAndFlash() → flash() → mark()");
    expect(m).toContain("@n");
  });

  test("E-ROUTE-002 through a READ, transitively (R2: read OR write)", () => {
    const src = P(DB, `    let <n:int=0/>\n    function helper() -> int {\n        return @n\n    }\n    function srv(id: int) -> int {\n        ${SQ}\`DELETE FROM t WHERE id = \${id}\`}.run()\n        return helper()\n    }`);
    expect(sorted(src)).toEqual(["E-ERROR-002", "E-ROUTE-002"]);
  });

  test("twin (mirror: server-fn/e-route-002-neg): client → server is the allowed direction — no E-ROUTE-002 (the call itself is U1b's)", () => {
    const src = P(DB, `    let <n:int=0/>\n    function refresh(name: string) {\n        @n = 1\n        auditName(name)\n    }\n    function auditName(name: string) {\n        ${SQ}\`INSERT INTO audit (who) VALUES (\${name})\`}.run()\n    }`, `        <button onclick=refresh("hi")>Go</button>`);
    const c = codes(src);
    expect(c).not.toContain("E-ROUTE-002");
    expect(c.sort()).toEqual(["E-BOOTSTRAP-UNSUPPORTED", "E-ERROR-002"]);
    expect(diag(src, "E-BOOTSTRAP-UNSUPPORTED").message).toContain("U1b");
  });

  test("a pure helper called from a server function is fine (ambient)", () => {
    expect(codes(P(DB, `    fn twice(x: int) -> int { return x * 2 }\n    function srv(id: int) -> int {\n        ${SQ}\`DELETE FROM t WHERE id = \${id}\`}.run()\n        return twice(id)\n    }`))).toEqual(["E-ERROR-002"]);
  });

  test("E-ROUTE-001 (R3, an error): a server function calls through a parameter", () => {
    const src = P(DB, `    function srv(k: int) -> int {\n        ${SQ}\`DELETE FROM t\`}.run()\n        return k(1)\n    }`);
    expect(codes(src)).toContain("E-ROUTE-001");
  });

  test("E-ROUTE-005: one body with a `?{}` AND a DOM global (mirror: server-fn/e-route-005-pos) — the one report for `document`", () => {
    const src = P(DB, `    function saveAndPaint(name: string) {\n        ${SQ}\`INSERT INTO audit (who) VALUES (\${name})\`}.run()\n        document.title = name\n    }`);
    expect(sorted(src)).toEqual(["E-ERROR-002", "E-ROUTE-005"]);
    expect(codes(src)).not.toContain("E-ROUTE-002");
  });

  test("twin (mirror: server-fn/e-route-005-neg): the concerns split — no E-ROUTE-005, no E-ROUTE-002", () => {
    const src = P(DB, `    function persist(name: string) {\n        ${SQ}\`INSERT INTO audit (who) VALUES (\${name})\`}.run()\n    }\n    fn other(x: int) -> int { return x }`);
    const c = codes(src);
    expect(c).not.toContain("E-ROUTE-005");
    expect(c).not.toContain("E-ROUTE-002");
  });
});

describe("§12.5.3 — E-ROUTE-003 / E-ROUTE-004 via the §57 codec", () => {
  const T = `    type Kind:enum = { A, B }\n    type Pt:struct = { x: int, y: int }\n    type Shape:enum = { Dot, Circle(r: int) }\n    <box:struct> let <k:int=0/> </>\n    renders <div>\${k}</div>`;

  test("a declaration's instance as a parameter → E-ROUTE-004; as the return type → E-ROUTE-003", () => {
    expect(sorted(P("", `${T}\n    server function f(b: box) {\n        return\n    }`))).toEqual(["E-ROUTE-004", "W-DEPRECATED-SERVER-MODIFIER"]);
    expect(sorted(P("", `${T}\n    server function g() -> box {\n        return @box\n    }`))).toContain("E-ROUTE-003");
  });

  test("structs, payload-free enums, sequences, optionals have a wire form — clean", () => {
    expect(codes(P("", `${T}\n    server function f(p: Pt, k: Kind, xs: int[], s: string | not) -> Pt {\n        return p\n    }`))).toEqual(["W-DEPRECATED-SERVER-MODIFIER"]);
  });

  test("a payload enum (S451 R8 — not in the codec yet) is REFUSED, not called non-serializable", () => {
    const src = P("", `${T}\n    server function f(s: Shape) {\n        return\n    }`);
    expect(sorted(src)).toEqual(["E-BOOTSTRAP-UNSUPPORTED", "W-DEPRECATED-SERVER-MODIFIER"]);
  });
});

describe("§13.7 (S451 R1) — a value position that would wait is E-VALUE-SERVER-CALL", () => {
  const S = `    let <n:int=0/>\n    server function count() -> int {\n        return 3\n    }\n    function label() -> int {\n        return count() + 1\n    }`;
  const ok = (c) => c.filter((x) => x !== "W-DEPRECATED-SERVER-MODIFIER" && x !== "E-BOOTSTRAP-UNSUPPORTED");

  test("item 1 — an initializer calls a server function", () => {
    expect(ok(codes(P("", `${S}\n    let <m:int=(count())/>`)))).toEqual(["E-VALUE-SERVER-CALL"]);
  });

  test("item 1 — a derived formula", () => {
    expect(ok(codes(P("", `${S}\n    <d:int=(@n + count())/>`)))).toEqual(["E-VALUE-SERVER-CALL"]);
  });

  test("item 1 — an interpolation and an attribute value", () => {
    expect(ok(codes(P("", S, `        <p>\${count()}</p>`)))).toEqual(["E-VALUE-SERVER-CALL"]);
    expect(ok(codes(P("", S, `        <p title=(count())>x</p>`)))).toEqual(["E-VALUE-SERVER-CALL"]);
  });

  test("item 2 — a client function that reaches a server call; the message names the chain", () => {
    const src = P("", S, `        <p>\${label()}</p>`);
    expect(ok(codes(src))).toEqual(["E-VALUE-SERVER-CALL"]);
    expect(diag(src, "E-VALUE-SERVER-CALL").message).toContain("label() → count()");
  });

  test("item 3 — a `?{}` written in the position", () => {
    expect(sorted(P(DB, ``, `        <p>\${${SQ}\`SELECT a FROM t\`}.all()}</p>`))).toEqual(["E-ERROR-002", "E-VALUE-SERVER-CALL"]);
  });

  test("the fix by shape is named: a `<request>`", () => {
    expect(diag(P("", S, `        <p>\${count()}</p>`), "E-VALUE-SERVER-CALL").message).toContain("<request>");
  });

  test("twin: a pure function in the same positions is clean", () => {
    expect(codes(P("", `    let <n:int=0/>\n    fn three() -> int { return 3 }\n    let <m:int=(three())/>`, `        <p>\${three()}</p>`))).toEqual([]);
  });
});

describe("refusals at the edge of U1a — each names the slice that lifts it", () => {
  test("a client function calling a server function → U1b", () => {
    const src = P("", `    let <n:int=0/>\n    server function count() -> int {\n        return 3\n    }\n    function go() {\n        @n = count()\n    }`, `        <button onclick=go()>go</button>`);
    const d = run(src).diags.filter((x) => x.code === "E-BOOTSTRAP-UNSUPPORTED");
    expect(d.length).toBe(1);
    expect(d[0].message).toContain("U1b");
  });

  test("a handler calling a server function → U1b", () => {
    const src = P("", `    server function ping() {\n        return\n    }`, `        <button onclick=ping()>go</button>`);
    expect(diag(src, "E-BOOTSTRAP-UNSUPPORTED").message).toContain("U1b");
  });

  test("a `?{}` written in a handler → U1d (client code doing server work is split)", () => {
    const src = P(DB, ``, `        <button onclick=${SQ}\`DELETE FROM t\`}.run()>go</button>`);
    expect(sorted(src)).toEqual(["E-BOOTSTRAP-UNSUPPORTED", "E-ERROR-002"]);
    expect(diag(src, "E-BOOTSTRAP-UNSUPPORTED").message).toContain("U1d");
  });

  test("a §52 `<x server>` declaration is outside U1 — refused, never ignored", () => {
    const src = P(DB, `    let <count:int server=0/>`, `        <p>\${@count}</p>`);
    expect(codes(src)).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
  });

  test("a `?{}` in an imported module (a module-with-db-context, §44.7.1) is refused", () => {
    const lib = { path: "lib.scrml", src: `\${\n    export function load(id: int) -> int {\n        const r = ${SQ}\`SELECT a FROM t WHERE id = \${id}\`}.get()\n        return 1\n    }\n}\n` };
    const app = { path: "app.scrml", src: P(DB, `    import { load } from "./lib.scrml"`) };
    const c = frontEnd(mods, [lib, app]).diags.map((d) => d.code);
    expect(c).toContain("E-BOOTSTRAP-UNSUPPORTED");
    expect(c).not.toContain("E-SQL-004");
  });

  test("the printer refuses a program with a server function, naming U1c — nothing is printed", () => {
    const r = run(P("", `    server function bump(n: int) -> int {\n        return n + 1\n    }`));
    const out = mods.print.printProgram(r.core, "t.client.js", "scrml-runtime.js");
    expect(out.js).toBe("");
    expect(out.html).toBe("");
    expect(out.refused.length).toBe(1);
    expect(out.refused[0]).toContain("U1c");
  });

  test("twin: a program with no server function prints (refused is empty)", () => {
    const r = run(P("", `    let <n:int=0/>`, `        <p>\${@n}</p>`));
    const out = mods.print.printProgram(r.core, "t.client.js", "scrml-runtime.js");
    expect(out.refused).toEqual([]);
    expect(out.js.length).toBeGreaterThan(0);
  });
});

describe("the query's facts (design §1) — recorded once, fail closed", () => {
  const facts = (sql, mode = "get") => run(P(DB, fnQ("f", sql, mode))).typed.tables.server.sqls[0];
  const tables = (t) => (v(t) === "TablesUnknown" ? "?" : t.data.names);

  test("a SELECT is SqlSelect, reads its tables, writes none", () => {
    const f = facts("SELECT id, name FROM users WHERE id = ${id}");
    expect(v(f.kind)).toBe("SqlSelect");
    expect(tables(f.reads)).toEqual(["users"]);
    expect(tables(f.writes)).toEqual([]);
    expect(f.columns.data.names).toEqual(["id", "name"]);
  });

  test("an INSERT is SqlWrite and writes its table (the bite: a kind scan forced to Select turns this RED)", () => {
    const f = facts("INSERT INTO audit (who) VALUES (${id})", "run");
    expect(v(f.kind)).toBe("SqlWrite");
    expect(tables(f.writes)).toEqual(["audit"]);
    expect(v(f.columns)).toBe("ColsNone");
  });

  test("UPDATE / DELETE are writes of their target", () => {
    expect(tables(facts("UPDATE accounts SET balance = balance - ${id}", "run").writes)).toEqual(["accounts"]);
    expect(tables(facts("DELETE FROM sessions WHERE id = ${id}", "run").writes)).toEqual(["sessions"]);
  });

  test("fail closed: an unknown function, a write verb in a SELECT, a non-SELECT lead → SqlWrite", () => {
    expect(v(facts("SELECT nextval('s')").kind)).toBe("SqlWrite");
    expect(v(facts("SELECT * FROM t FOR UPDATE").kind)).toBe("SqlWrite");
    expect(v(facts("PRAGMA journal_mode = WAL", "run").kind)).toBe("SqlWrite");
    expect(v(facts("SELECT a INTO b FROM t").kind)).toBe("SqlWrite");
  });

  test("fail closed: a comment, zero tables, a comma join after ON → TablesUnknown", () => {
    expect(v(facts("SELECT a FROM t -- c\n").reads)).toBe("TablesUnknown");
    expect(v(facts("SELECT 1").reads)).toBe("TablesUnknown");
    expect(v(facts("SELECT * FROM a JOIN b ON a.i = b.i, c").reads)).toBe("TablesUnknown");
  });

  test("a value inside a SQL string literal leaves the text unreadable → SqlWrite + Unknown (never text, §8.1)", () => {
    const f = facts("SELECT a FROM t WHERE a LIKE '%${id}%'");
    expect(v(f.kind)).toBe("SqlWrite");
    expect(v(f.reads)).toBe("TablesUnknown");
  });

  test("columns: `*` → ColsAll; an aliased expression → its name; an unnamed expression → ColsUnknown", () => {
    expect(v(facts("SELECT * FROM t").columns)).toBe("ColsAll");
    expect(facts("SELECT count(*) AS n FROM t").columns.data.names).toEqual(["n"]);
    expect(v(facts("SELECT a + b FROM t").columns)).toBe("ColsUnknown");
  });
});

describe("S239 review fix round — the kind scan cannot be talked into SqlSelect (fail closed BY CONSTRUCTION)", () => {
  const kind = (sql) => v(mods.sql.sqlFacts([sql]).kind);
  const W = "SqlWrite";
  // (1) a quoted identifier as a function name
  test('a quoted function name — "f"(…), [f](…), `f`(…) — is a call', () => {
    expect(kind(`SELECT "nextval"('s')`)).toBe(W);
    expect(kind(`SELECT [nextval]('s')`)).toBe(W);
    expect(kind("SELECT `nextval`('s')")).toBe(W);
  });
  test("through the front end too (the PA's reproduction)", () => {
    const r = run(P(DB, `    function f() {\n        const x = ${SQ}\`SELECT "nextval"('s')\`}.get()\n    }`));
    expect(v(r.typed.tables.server.sqls[0].kind)).toBe(W);
  });
  // (2) whitespace outside the scanner's whitelist
  test("a form feed / vertical tab / NBSP / other Unicode space between a name and `(` fails closed", () => {
    expect(kind("SELECT evil\f(1)")).toBe(W);
    expect(kind("SELECT evil\v(1)")).toBe(W);
    expect(kind("SELECT evil (1)")).toBe(W);
    expect(kind("SELECT evil (1)")).toBe(W);
    expect(kind("SELECT évil(1)")).toBe(W);
  });
  // (3) keyword-named functions (non-reserved on Postgres / MySQL)
  for (const k of ["rows", "range", "partition", "filter", "over", "window", "set", "any", "some", "join", "like", "is", "by", "lateral", "recursive", "limit"]) {
    test(`\`${k}(…)\` is a call (the keyword is not reserved in all three dialects)`, () => {
      expect(kind(`SELECT ${k}(1) FROM t`)).toBe(W);
    });
  }
  // (4) driver-dependent lexing
  test("a backslash in a string, an `E'…'` / prefixed string, `#`, and any comment fail closed", () => {
    expect(kind("SELECT 'a\\' , 1 FROM t")).toBe(W);
    expect(kind("SELECT E'x' FROM t")).toBe(W);
    expect(kind("SELECT a FROM t # nextval('s')")).toBe(W);
    expect(kind("SELECT a /*! , nextval('s') */ FROM t")).toBe(W);
    expect(kind("SELECT 1--1, a FROM t")).toBe(W);
    expect(kind("SELECT $$x$$ FROM t")).toBe(W);
  });
  // LOW (a): operators outside a whitelist
  test("a user-definable operator (`@@`, `<->`, `~`, `::`) fails closed", () => {
    expect(kind("SELECT a @@ b FROM t")).toBe(W);
    expect(kind("SELECT a <-> b FROM t")).toBe(W);
    expect(kind("SELECT ~a FROM t")).toBe(W);
    expect(kind("SELECT a::int FROM t")).toBe(W);
  });
  // re-review HIGH-1: `[` is array subscripting on Postgres — its contents run
  test("`[…]` fails closed (Postgres subscripts run their contents)", () => {
    expect(kind("SELECT arr[nextval('s')] FROM t")).toBe(W);
    expect(kind("SELECT a[1:f()] FROM t")).toBe(W);
    expect(kind("SELECT [x] FROM t")).toBe(W);
  });
  // re-review HIGH-2: a qualified name before `(` is always a call
  for (const q of ["public.exists(1)", "public.select(1)", "mydb.values(1)", "public.count(a)", "public.lower(a)"]) {
    test(`\`${q}\` — a qualified name before \`(\` is a call, no exemptions`, () => {
      expect(kind(`SELECT ${q} FROM t`)).toBe(W);
    });
  }
  // re-review MED: row locks
  test("`FOR SHARE` / `FOR UPDATE` / MySQL `LOCK IN SHARE MODE` are writes (they lock rows)", () => {
    expect(kind("SELECT a FROM t FOR SHARE")).toBe(W);
    expect(kind("SELECT a FROM t LOCK IN SHARE MODE")).toBe(W);
    expect(kind("SELECT a FROM t FOR UPDATE")).toBe(W);
  });

  test("twins stay SqlSelect: plain selects, the justified builtins, IN / EXISTS / subqueries, ordinary operators", () => {
    expect(kind("SELECT count(*) AS n, max(a) FROM t WHERE a IN (1, 2) AND EXISTS (SELECT 1 FROM u) AND b <= 3 AND c <> 'x''y'")).toBe("SqlSelect");
    expect(kind("SELECT lower(name) || '-' || coalesce(nick, '') FROM users WHERE id = 1")).toBe("SqlSelect");
  });
});

describe("the lowered query in Core (as Ue would hand it on — the test drops E-ERROR-002 itself)", () => {
  test("a ServerFn holds Expr.Sql: runs, DEDUPED values (§8.2), slots, mode, facts, db", () => {
    const r = run(P(DB, `    function find(id: int) {\n        const row = ${SQ}\`SELECT * FROM activity WHERE created_by = \${id} OR updated_by = \${id}\`}.get()\n    }`));
    const core = lowerHandled(r);
    expect(core.server.map((s) => s.sym.hint)).toEqual(["find"]);
    const q = core.server[0].body.stmts[0].data.init.data.q;
    expect(q.chunks).toEqual(["SELECT * FROM activity WHERE created_by = ", " OR updated_by = ", ""]);
    expect(q.params.length).toBe(1);
    expect(q.slots).toEqual([0, 0]);
    expect(v(q.mode)).toBe("Get");
    expect(v(q.kind)).toBe("SqlSelect");
    expect(q.db.id).toBe(core.dbs[0].sym.id);
    expect(mods.check.checkCore(core)).toEqual([]);
  });

  test("distinct values keep distinct slots, in first-appearance order", () => {
    const r = run(P(DB, `    function find(a: int, b: int) {\n        ${SQ}\`UPDATE t SET x = \${b} WHERE id = \${a} AND y = \${b}\`}.run()\n    }`));
    const q = lowerHandled(r).server[0].body.stmts[0].data.e.data.q;
    expect(q.params.map((p) => p.data.sym.hint)).toEqual(["b", "a"]);
    expect(q.slots).toEqual([0, 1, 0]);
  });

  test("the printer refuses the lowered program (U1c)", () => {
    const core = lowerHandled(run(P(DB, fnQ("f", "SELECT a FROM t"))));
    expect(mods.print.printProgram(core, "t.client.js", "scrml-runtime.js").refused[0]).toContain("U1c");
  });
});

describe("check — the server boundary in Core (C-SQL1, C-S1..C-S4)", () => {
  const base = () => lowerHandled(run(P(DB, `    let <n:int=0/>\n    function find(id: int) -> int {\n        const row = ${SQ}\`SELECT a FROM t WHERE id = \${id}\`}.get()\n        return 1\n    }\n    function cli() {\n        @n = 2\n    }`)));
  const issues = (core, tag) => mods.check.checkCore(core).filter((s) => s.startsWith(tag));

  test("the lowered program is well-formed", () => {
    expect(mods.check.checkCore(base())).toEqual([]);
  });

  test("C-S1 graft (the bite): a cell read grafted into a ServerFn body is reported", () => {
    const core = base();
    const cliWrite = core.fns.find((f) => f.sym.hint === "cli").body.stmts[0].data;
    const cellRead = { variant: "Read", data: { place: { variant: "Cell", data: { decl: core.program, inst: cliWrite.inst, path: [{ owner: core.program, idx: 0 }] } } } };
    const sf = core.server[0];
    const grafted = { ...core, server: [{ ...sf, body: { stmts: [{ variant: "Eval", data: { e: cellRead } }, ...sf.body.stmts] } }] };
    expect(issues(grafted, "C-S1").length).toBeGreaterThan(0);
  });

  test("C-S1: a ServerFn calling a Fn that writes a cell is reported", () => {
    const core = base();
    const cli = core.fns.find((f) => f.sym.hint === "cli");
    const sf = core.server[0];
    const call = { variant: "Eval", data: { e: { variant: "Call", data: { callee: cli.sym, args: [] } } } };
    const grafted = { ...core, server: [{ ...sf, body: { stmts: [call, ...sf.body.stmts] } }] };
    expect(issues(grafted, "C-S1").some((s) => s.includes("cli()"))).toBe(true);
  });

  test("C-S2 graft: a query in a client Fn is reported", () => {
    const core = base();
    const q = core.server[0].body.stmts[0];
    const cli = core.fns.find((f) => f.sym.hint === "cli");
    const grafted = { ...core, fns: core.fns.map((f) => (f === cli ? { ...f, body: { stmts: [q, ...f.body.stmts] } } : f)) };
    expect(issues(grafted, "C-S2").length).toBe(1);
  });

  test("C-S3 graft: client code calling a ServerFn as a plain call is reported", () => {
    const core = base();
    const cli = core.fns.find((f) => f.sym.hint === "cli");
    const call = { variant: "Eval", data: { e: { variant: "Call", data: { callee: core.server[0].sym, args: [{ variant: "Lit", data: { lit: { variant: "Int", data: { v: 1 } } } }] } } } };
    const grafted = { ...core, fns: core.fns.map((f) => (f === cli ? { ...f, body: { stmts: [call, ...f.body.stmts] } } : f)) };
    expect(issues(grafted, "C-S3").length).toBe(1);
  });

  test("C-SQL1 graft: slots that do not line up with the runs, and a slot past the values", () => {
    const core = base();
    const sf = core.server[0];
    const st = sf.body.stmts[0];
    const q = st.data.init.data.q;
    const bad = (q2) => ({ ...core, server: [{ ...sf, body: { stmts: [{ ...st, data: { ...st.data, init: { variant: "Sql", data: { q: q2 } } } }, ...sf.body.stmts.slice(1)] } }] });
    expect(issues(bad({ ...q, slots: [] }), "C-SQL1").length).toBeGreaterThan(0);
    expect(issues(bad({ ...q, slots: [3] }), "C-SQL1").length).toBeGreaterThan(0);
    expect(issues(bad({ ...q, db: { id: 9999, hint: "nope" } }), "C-SQL1").length).toBe(1);
  });

  test("C-S4 graft: a ServerFn parameter typed as a declaration has no wire descriptor", () => {
    const core = base();
    const sf = core.server[0];
    const grafted = { ...core, server: [{ ...sf, params: [{ ...sf.params[0], ty: { variant: "Named", data: { sym: core.program } } }] }] };
    expect(issues(grafted, "C-S4").length).toBe(1);
  });
});
