// server-artifact.test.js — s468 bootstrap unit U1c: the SERVER half of the
// server boundary. Design: scrml-support/docs/deep-dives/bootstrap-u1-server-
// boundary-design-2026-10-03.md §4 / §5 and the BINDING §13 amendment (S467);
// wire contract: the U1b design's Item 3. Governing sentences:
// docs/changes/s468-bootstrap-u1c/progress.md.
//
// Every program here is compiled from §66 SOURCE by the bootstrap front end,
// checked (checkCore), printed by BOTH printers, and the server artifact is RUN
// — against a real in-memory SQLite (Bun.SQL) or a driver spy. The design's U1c
// row names the twelve `server-db/sql-*-rt` conformance cases; their legacy
// sources are not §66 (the twin generator cannot type their cells), so each is
// mirrored here in the bootstrap's own dialect with the case's own data and
// assertions (the U0 / U1a precedent).

import { describe, test, expect, beforeAll, afterEach } from "bun:test";
import { mods, compile, codes, check, artifacts, loadServer, realDb, spyDriver, serve, post, pathOf, bridge } from "./server-artifact-harness.js";
import { SHAPES, program, RIGHT, WRONG } from "./server-await-probes.js";
import { loadProgram, click, expectNoPageErrors } from "../slice-m1/load-program.js";

beforeAll(() => { mods(); }, { timeout: 120000 });

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  if (globalThis.document) globalThis.document.cookie = "scrml_csrf=; Max-Age=0; Path=/";
});

const SQ = "?" + "{";
const P = (decls, main = "        <p>x</p>") => `<program db="./app.db">\n${decls}\n    <main>\n${main}\n    </main>\n</program>\n`;

// Every Suspend in a Core function body, at any depth (Core JSON).
function suspendsIn(node, out = []) {
  if (Array.isArray(node)) { for (const x of node) suspendsIn(x, out); return out; }
  if (node && typeof node === "object") {
    if (node.variant === "Suspend") out.push(node.data);
    for (const k of Object.keys(node)) suspendsIn(node[k], out);
  }
  return out;
}
const fnNamed = (core, name) => core.server.find((s) => s.sym.hint === name) ?? core.fns.find((f) => f.sym.hint === name);

// =============================================================================
// 1. The §13 gate (S467): the server half awaits BY CONSTRUCTION
// =============================================================================
describe("§13 gate — a server wait is a Core Suspend; `await` is printed there and nowhere else", () => {
  const SRC = program(`        if (!check(pass, row.pw)) return "REJECTED"\n        return "WELCOME"`);

  test("a `?{}` in a server body is `Suspend(o, Query(q), [Attempt(FSettled(o)) …])` — Suspend waits, Attempt inspects", () => {
    const { core } = compile(SRC);
    const chk = fnNamed(core, "check");
    const sus = suspendsIn(chk.body);
    expect(sus.length).toBe(1);
    expect(sus[0].on.variant).toBe("Query");
    const first = sus[0].then.stmts[0];
    expect(first.variant).toBe("Attempt");
    expect(first.data.call.variant).toBe("FSettled");
    expect(first.data.call.data.outcome.id).toBe(sus[0].bind.id);
    expect(chk.waits).toBe(true);
  });

  test("an in-place call of a waiting server function is a Suspend on the Call (server→server, §13.4) — the caller waits too", () => {
    const { core } = compile(SRC);
    const f = fnNamed(core, "f");
    const ons = suspendsIn(f.body).map((s) => s.on);
    expect(ons.map((o) => o.variant)).toEqual(["Query", "Call"]);
    expect(ons[1].data.callee.hint).toBe("check");
    expect(f.waits).toBe(true);
  });

  test("a server function that waits on nothing is NOT `waits` and is printed as a plain function (async iff Core says it waits)", () => {
    const src = P(`    let <n:int=0/>\n    server function add(a: int, b: int) -> int { return a + b }`,
      `        <button id="go" onclick={ @n = add(1, 2) !{ .Transport(t) :> return } }>add</button>`);
    const { core } = compile(src);
    const add = fnNamed(core, "add");
    expect(add.waits).toBe(false);
    expect(check(core)).toEqual([]);
    const { server } = artifacts(core);
    expect(server.js).toMatch(/\n  function add\(a, b\) \{/);
    expect(server.js).not.toMatch(/async function add/);
    expect(server.js).not.toContain("await");
  });

  test("the printed server: `async` exactly on the waiting functions, one `await` per Core Suspend, no other `await`", () => {
    const { core } = compile(SRC);
    expect(check(core)).toEqual([]);
    const { server } = artifacts(core);
    let suspends = 0;
    for (const s of core.server.concat(core.fns)) {
      const n = suspendsIn(s.body).length;
      suspends += server.js.includes(`function ${s.sym.hint}(`) ? n : 0;
      if (server.js.includes(`function ${s.sym.hint}(`)) {
        expect(server.js.includes(`async function ${s.sym.hint}(`)).toBe(s.waits);
      }
    }
    const awaits = (server.js.match(/\bawait\b/g) ?? []).length;
    expect(awaits).toBe(suspends);
    expect(awaits).toBeGreaterThan(0);
  });

  test("the transitive fact: a Trigger-5 helper that calls a waiting server function waits; one that does not, does not", () => {
    const src = program(`        if (!w1(pass, row.pw)) return "REJECTED"\n        if (plain(name) != "bob") return "REJECTED"\n        return "WELCOME"`,
      `    function w1(p: string, h: string) -> boolean {\n        return check(p, h)\n    }\n    function plain(n: string) -> string {\n        return n\n    }`);
    const { core } = compile(src);
    expect(check(core)).toEqual([]);
    expect(fnNamed(core, "w1").waits).toBe(true);
    expect(fnNamed(core, "plain").waits).toBe(false);
  });
});

// =============================================================================
// 2. The bite: force the waits fact false / drop the Suspend — RED
// =============================================================================
describe("§13 gate bite — a waiting call that is not a Suspend is RED at checkCore, and RED at run time", () => {
  const SRC = program(`        if (!check(pass, row.pw)) return "REJECTED"\n        return "WELCOME"`);

  // Rewrite f's `Suspend(b, Call(check), then)` into the plain `then` with the
  // call in place of `b` — what a printer that "forgot" the await would print.
  function unsuspendCheck(core) {
    const f = fnNamed(core, "f");
    const walk = (block) => {
      const out = [];
      for (const st of block.stmts) {
        if (st.variant === "Suspend" && st.data.on.variant === "Call" && st.data.on.data.callee.hint === "check") {
          const bind = st.data.bind.id;
          const call = st.data.on;
          const sub = (x) => {
            if (Array.isArray(x)) return x.map(sub);
            if (x && typeof x === "object") {
              if (x.variant === "Local" && x.data.sym.id === bind) return call;
              const o = {};
              for (const k of Object.keys(x)) o[k] = sub(x[k]);
              return o;
            }
            return x;
          };
          out.push(...walk(sub(st.data.then)).stmts ?? []);
          return { stmts: out.concat(walk(sub(st.data.then)).stmts.slice(out.length)) };
        }
        if (st.variant === "Suspend") out.push({ variant: "Suspend", data: { ...st.data, then: walk(st.data.then) } });
        else out.push(st);
      }
      return { stmts: out };
    };
    f.body = walk(f.body);
    return core;
  }

  test("checkCore: C-S8s names the call of the waiting function that stands outside a Suspend", () => {
    const { core } = compile(SRC);
    expect(check(core)).toEqual([]);
    const bad = unsuspendCheck(core);
    const findings = check(bad);
    expect(findings.some((x) => x.startsWith("C-S8"))).toBe(true);
  });

  test("forcing `check.waits` false (the fact, not the call) is RED at checkCore (C-S8s: it holds a Suspend)", () => {
    const { core } = compile(SRC);
    fnNamed(core, "check").waits = false;
    expect(check(core).some((x) => x.startsWith("C-S8"))).toBe(true);
  });

  test("printed anyway, the unsuspended program ACCEPTS A WRONG PASSWORD — the class the gate exists for", async () => {
    const { core } = compile(SRC);
    const bad = unsuspendCheck(core);
    const sql = await realDb(["CREATE TABLE users (name TEXT, pw TEXT)"], { users: [{ name: "bob", pw: RIGHT }] });
    const { srv, routes } = await serve(bad, sql);
    const r = await post(srv, pathOf(routes, "f"), ["bob", WRONG]);
    expect(r.json).toBe("WELCOME");     // a Promise is truthy: `!Promise` is false
  });
});

// =============================================================================
// 3. The bootstrap-expressible await probes (amendment item 4)
// =============================================================================
describe("§13 gate acceptance — no expressible shape accepts a wrong password", () => {
  for (const [name, s] of Object.entries(SHAPES)) {
    test(`${name} → ${s.expect}`, async () => {
      const src = program(s.body, s.top ?? "", s.markup ?? "");
      if (s.expect === "REFUSED") {
        const cs = codes(src);
        for (const c of s.codes) expect(cs).toContain(c);
        return;
      }
      const { core } = compile(src);
      expect(check(core)).toEqual([]);
      const sql = await realDb(["CREATE TABLE users (name TEXT, pw TEXT)"], { users: [{ name: "bob", pw: RIGHT }] });
      const { srv, routes } = await serve(core, sql);
      const wrong = await post(srv, pathOf(routes, "f"), ["bob", WRONG]);
      const right = await post(srv, pathOf(routes, "f"), ["bob", RIGHT]);
      expect({ wrong: [wrong.status, wrong.json], right: [right.status, right.json] })
        .toEqual({ wrong: [200, "REJECTED"], right: [200, "WELCOME"] });
    });
  }
});

// =============================================================================
// 4. The route: a complete response on every path (§12.5.3), CSRF (§39.2.3), strict decode (§57.4 R10)
// =============================================================================
describe("the route — every path answers; nothing runs on a refused request", () => {
  const SRC = P(`    type E:enum = { NotFoundUser, Invalid(why: string), Boom }
    let <n:int=0/>
    type Cnt:struct = { n: int }
    function lookup(id: int, mode: int)! E {
        const r: Cnt = ${SQ}\`SELECT COUNT(*) AS n FROM t WHERE id = \${id}\`}.get() !{ _ :> { return 0 } }
        if (mode == 1) fail .NotFoundUser
        if (mode == 2) fail .Invalid("bad mode")
        if (mode == 3) fail .Boom
        return id + 1
    }
    function touch(id: int) {
        ${SQ}\`UPDATE t SET id = id WHERE id = \${id}\`}.run() !{ _ :> { return } }
    }`,
    `        <button id="a" onclick={ @n = lookup(1, 0) !{ _ :> return } }>a</button>
        <button id="b" onclick={ touch(1) !{ .Transport(t) :> return } }>b</button>`);
  let srv, routes, spy, logs;
  beforeAll(async () => {
    const r = compile(SRC);
    expect(check(r.core)).toEqual([]);
    spy = spyDriver((strings) => (strings[0].startsWith("SELECT") ? [{ n: 1 }] : []));
    logs = [];
    ({ srv, routes } = await serve(r.core, spy.fn, logs));
  });

  test("200 + the strictly encoded value", async () => {
    const r = await post(srv, pathOf(routes, "lookup"), [41, 0]);
    expect([r.status, r.json]).toEqual([200, 42]);
  });
  test("204, no body, for a function that yields no value (the U1b no-value contract)", async () => {
    const r = await post(srv, pathOf(routes, "touch"), [1]);
    expect([r.status, r.text]).toEqual([204, ""]);
  });
  test("`fail` → the §19.9.1 / §57.8 envelope with the §19.9.2 status (NotFound 404, Invalid 400, otherwise 500)", async () => {
    const at = (mode) => post(srv, pathOf(routes, "lookup"), [1, mode]);
    expect(await at(1).then((r) => [r.status, r.json])).toEqual([404, { __scrml_error: true, type: "E", variant: "NotFoundUser", data: {} }]);
    expect(await at(2).then((r) => [r.status, r.json])).toEqual([400, { __scrml_error: true, type: "E", variant: "Invalid", data: { why: "bad mode" } }]);
    expect(await at(3).then((r) => [r.status, r.json])).toEqual([500, { __scrml_error: true, type: "E", variant: "Boom", data: {} }]);
  });
  test("CSRF (§39.2.3 baseline double-submit): no matching cookie + header → 403 + a cookie to retry with; the body never runs", async () => {
    const before = spy.calls.length;
    const r = await post(srv, pathOf(routes, "lookup"), [1, 0], { csrf: false });
    expect(r.status).toBe(403);
    expect(r.headers.get("Set-Cookie")).toMatch(/^scrml_csrf=[^;]+; Path=\/; SameSite=Strict$/);
    expect(spy.calls.length).toBe(before);
  });
  test("malformed arguments (wrong arity, a value that does not decode strictly, not JSON) → 400; the body never runs", async () => {
    const before = spy.calls.length;
    expect((await post(srv, pathOf(routes, "lookup"), [1])).status).toBe(400);
    expect((await post(srv, pathOf(routes, "lookup"), ["1", 0])).status).toBe(400);
    expect((await post(srv, pathOf(routes, "lookup"), [1.5, 0])).status).toBe(400);
    expect((await post(srv, pathOf(routes, "lookup"), null, { raw: "{not json" })).status).toBe(400);
    expect(spy.calls.length).toBe(before);
  });
  test("an unknown path → 404; a GET → 405 (complete responses)", async () => {
    expect((await post(srv, "/_scrml/call/999999", [])).status).toBe(404);
    const g = await post(srv, pathOf(routes, "lookup"), [], { method: "GET" });
    expect([g.status, g.headers.get("Allow")]).toEqual([405, "POST"]);
  });
  test("a host exception in the body → 500 with a FIXED text (the reason goes to the server log only)", async () => {
    const boom = spyDriver(() => { throw new Error("SECRET-DB-PASSWORD in the message"); });
    const r0 = compile(SRC);
    const logs2 = [];
    const { srv: s2, routes: rs2 } = await serve(r0.core, (...a) => boom.fn(...a), logs2);
    const r = await post(s2, pathOf(rs2, "lookup"), [1, 0]);
    // the query's driver throw is a SqlError value → the `!{ _ :> { return 0 } }` arm: still 200
    expect(r.status).toBe(200);
    expect(r.text).not.toContain("SECRET");
    expect(logs2.join("\n")).toContain("SECRET");
  });
});

// =============================================================================
// 5. SQL: values are bound, never text (§8.1); dedup evaluates once (§8.2)
// =============================================================================
describe("§8.1 — a value interpolated in SQL never appears in the SQL text sent to the driver (driver-call spy)", () => {
  const SRC = P(`    let <n:int=0/>
    type Cnt:struct = { n: int }
    function find(name: string, tag: string) -> int {
        const r: Cnt = ${SQ}\`SELECT COUNT(*) AS n FROM users WHERE name = \${name} OR alias = \${name} OR tag = \${tag}\`}.get() !{ _ :> { return 0 } }
        return r.n
    }`, `        <button id="go" onclick={ @n = find("x", "y") !{ .Transport(t) :> return } }>go</button>`);

  test("the literal runs reach the driver as the template; every value as a bound parameter; a hostile value stays a value", async () => {
    const r0 = compile(SRC);
    expect(check(r0.core)).toEqual([]);
    const spy = spyDriver(() => [{ n: 3 }]);
    const { srv, routes, js } = await serve(r0.core, spy.fn);
    const evil = "x'); DROP TABLE users; --";
    const r = await post(srv, pathOf(routes, "find"), [evil, "t1"]);
    expect([r.status, r.json]).toEqual([200, 3]);
    expect(spy.calls.length).toBe(1);
    const c = spy.calls[0];
    expect(c.strings).toEqual(["SELECT COUNT(*) AS n FROM users WHERE name = ", " OR alias = ", " OR tag = ", ""]);
    expect(c.raw).toEqual(c.strings);
    expect(c.values).toEqual([evil, evil, "t1"]);
    for (const s of c.strings) expect(s).not.toContain("DROP");
    // the artifact holds the text runs as data, never a value
    expect(js).not.toContain("DROP");
  });

  test("§8.2 — a repeated expression is ONE parameter, evaluated ONCE (a waiting call in a slot runs once)", async () => {
    const src = P(`    let <n:int=0/>
    function stamp(x: string) -> string {
        ${SQ}\`INSERT INTO log (v) VALUES (\${x})\`}.run() !{ _ :> { return x } }
        return x
    }
    type Cnt:struct = { n: int }
    function twice(a: string) -> int {
        const r: Cnt = ${SQ}\`SELECT COUNT(*) AS n FROM t WHERE a = \${stamp(a)} OR b = \${stamp(a)}\`}.get() !{ _ :> { return 0 } }
        return r.n
    }`, `        <button id="go" onclick={ @n = twice("q") !{ .Transport(t) :> return } }>go</button>`);
    const r0 = compile(src);
    expect(check(r0.core)).toEqual([]);
    const spy = spyDriver((strings) => (strings[0].startsWith("SELECT") ? [{ n: 0 }] : []));
    const { srv, routes } = await serve(r0.core, spy.fn);
    await post(srv, pathOf(routes, "twice"), ["q"]);
    const inserts = spy.calls.filter((c) => c.strings[0].startsWith("INSERT"));
    expect(inserts.length).toBe(1);
    const sel = spy.calls.find((c) => c.strings[0].startsWith("SELECT"));
    expect(sel.values).toEqual(["q", "q"]);
  });
});

// =============================================================================
// 6. Emission by reach (design §2 "Trigger 5 is emission")
// =============================================================================
describe("Trigger 5 is emission — a helper only the server reaches is in server.js and NOT in client.js", () => {
  const SRC = P(`    let <n:int=0/>
    let <s:string=""/>
    fn norm(x: string) -> string { return x + "!" }
    fn shared(x: int) -> int { return x * 2 }
    type Cnt:struct = { n: int }
    function viaParam(name: string) -> int {
        const r: Cnt = ${SQ}\`SELECT COUNT(*) AS n FROM users WHERE name = \${norm(name)}\`}.get() !{ _ :> { return 0 } }
        return shared(r.n)
    }
    function helperOnly(a: int) -> int {
        return a + 1
    }
    function load(a: int) -> int {
        const r: Cnt = ${SQ}\`SELECT COUNT(*) AS n FROM users\`}.get() !{ _ :> { return 0 } }
        return helperOnly(r.n + a)
    }`,
    `        <button id="a" onclick={ @n = viaParam("x") !{ .Transport(t) :> return } }>a</button>
        <button id="b" onclick={ @n = load(shared(1)) !{ .Transport(t) :> return } }>b</button>`);

  test("reached only from a SQL parameter (`norm`) or only from a server function (`helperOnly`): server only; reached from both (`shared`): both (§13.4)", () => {
    const { core } = compile(SRC);
    expect(check(core)).toEqual([]);
    const { client, server } = artifacts(core);
    expect(server.js).toMatch(/function norm\(/);
    expect(server.js).toMatch(/function helperOnly\(/);
    expect(server.js).toMatch(/function shared\(/);
    expect(client.js).not.toMatch(/function norm\(/);
    expect(client.js).not.toMatch(/function helperOnly\(/);
    expect(client.js).toMatch(/function shared\(/);
    // no SQL, no server body in the client
    expect(client.js).not.toContain("SELECT");
    expect(client.js).not.toContain("rt.query");
    expect(server.js).not.toMatch(/rt\.(text|on|render|mount|insert)\(/);
  });

  test("the server's manifest is the client's: the same routes, the same paths, in the same order", () => {
    const { core } = compile(SRC);
    const { client, server } = artifacts(core);
    expect(server.routes).toEqual(client.routes);
    expect(server.routes.map((r) => r.fn)).toEqual(["viaParam", "load"]);
  });
});

// =============================================================================
// 7. The twelve server-db/sql-*-rt cases, each mirrored in §66 with ITS OWN seed,
//    clicks and asserted state (the legacy sources are not §66: their untyped
//    cells — `<x> = []`, `<x> = not` — cannot be twinned mechanically). The ten
//    with no `<schema>` are ALSO conformance cases (`server-db/*-s66-rt`), graded
//    by the counter's server-executor seam; the two that need `<schema>` DDL
//    (insert-returning, unique-constraint) are graded here only — the bootstrap
//    refuses `<schema>` — with the case's DDL created by the test.
//    Where a mirror's cell differs in SHAPE from the legacy case (a `T | not` cell
//    the §66 opener cannot type yet) the comment says so; the asserted VALUES are
//    the case's.
// =============================================================================
async function endToEnd(src, ddl, seed, clicks, settleRounds = 8) {
  const r0 = compile(src);
  expect(check(r0.core)).toEqual([]);
  const sql = await realDb(ddl, seed);
  const { srv } = await serve(r0.core, sql);
  const loaded = await loadProgram(r0.core, "u1c-" + Math.random().toString(36).slice(2));
  globalThis.fetch = bridge(srv);
  for (const id of clicks) {
    click(document.querySelector(id));
    for (let i = 0; i < settleRounds; i++) await new Promise((r) => setTimeout(r, 0));
  }
  expectNoPageErrors();
  const inst = [...loaded.rt.devtools.instances.values()].find((i) => i.id === 0 && i.decl.name === "program");
  return { state: loaded.rt.snapshot(inst), sql };
}

describe("server-db/sql-*-rt — the design's twelve, on the bootstrap's own artifacts (real in-memory SQLite)", () => {
  test("sql-get-single-row-rt — `.get()` yields the FIRST row ({id:1, name:\"Alice\"})", async () => {
    // shape: the legacy `<current> = not` (a `User | not` cell) is two typed cells here
    const src = P(`    type User:struct = { id: int, name: string }
    type LoadError:enum = { Db, Transport(t: ServerCallError) }
    let <uid:int=0/>
    let <name:string=""/>
    function loadOne()! LoadError {
        const u: User = ${SQ}\`SELECT id, name FROM users\`}.get() !{ _ :> { fail .Db } }
        return u
    }
    function load() {
        const u: User = loadOne() !{ _ :> { return } }
        @uid = u.id
        @name = u.name
    }`, `        <button id="load" onclick=load()>Load</button>`);
    const { state } = await endToEnd(src, ["CREATE TABLE users (id INTEGER, name TEXT)"], { users: [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }] }, ["#load"]);
    expect([state.uid, state.name]).toEqual([1, "Alice"]);
  });

  test("sql-all-array-shape-rt — `.all()` yields an array of row objects; #count reads 3", async () => {
    const src = P(`    type Widget:struct = { id: int, label: string }
    <rows:Widget[replace]=([])/>
    function loadAll() -> Widget[] {
        return ${SQ}\`SELECT id, label FROM widgets\`}.all() !{ _ :> [] }
    }`, `        <button id="load" onclick={ @rows = loadAll() !{ .Transport(t) :> return } }>Load</button>
        <p id="count">\${@rows.length}</p>`);
    const { state } = await endToEnd(src, ["CREATE TABLE widgets (id INTEGER, label TEXT)"], { widgets: [{ id: 1, label: "a" }, { id: 2, label: "b" }, { id: 3, label: "c" }] }, ["#load"]);
    expect(state.rows).toEqual([{ id: 1, label: "a" }, { id: 2, label: "b" }, { id: 3, label: "c" }]);
    expect(document.querySelector("#count").textContent).toBe("3");
  });

  test("sql-select-hydrate-rt — a SELECT hydrates a cell an `<each>` renders", async () => {
    const src = P(`    type User:struct = { id: int, name: string }
    <users:User[replace]=([])/>
    function loadUsers() -> User[] {
        return ${SQ}\`SELECT id, name FROM users\`}.all() !{ _ :> [] }
    }`, `        <button id="load" onclick={ @users = loadUsers() !{ .Transport(t) :> return } }>Load</button>
        <ul id="list"><each in=@users key=(@.id) as u><li class="row">\${u.name}</li></each></ul>
        <p id="count">Count: \${@users.length}</p>`);
    const { state } = await endToEnd(src, ["CREATE TABLE users (id INTEGER, name TEXT)"], { users: [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }] }, ["#load"]);
    expect(state.users).toEqual([{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }]);
    expect(document.querySelectorAll(".row").length).toBe(2);
    expect(document.querySelector("#count").textContent).toBe("Count: 2");
  });

  test("sql-multi-table-sequence-rt — two routes, two tables, two clicks", async () => {
    const src = P(`    type User:struct = { id: int, name: string }
    type Post:struct = { id: int, title: string }
    <users:User[replace]=([])/>
    <posts:Post[replace]=([])/>
    function loadUsers() -> User[] {
        return ${SQ}\`SELECT id, name FROM users\`}.all() !{ _ :> [] }
    }
    function loadPosts() -> Post[] {
        return ${SQ}\`SELECT id, title FROM posts\`}.all() !{ _ :> [] }
    }`, `        <button id="lu" onclick={ @users = loadUsers() !{ .Transport(t) :> return } }>LoadUsers</button>
        <button id="lp" onclick={ @posts = loadPosts() !{ .Transport(t) :> return } }>LoadPosts</button>
        <p id="uc">\${@users.length}</p>
        <p id="pc">\${@posts.length}</p>`);
    const { state } = await endToEnd(src, ["CREATE TABLE users (id INTEGER, name TEXT)", "CREATE TABLE posts (id INTEGER, title TEXT)"],
      { users: [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }], posts: [{ id: 10, title: "x" }, { id: 11, title: "y" }, { id: 12, title: "z" }] }, ["#lu", "#lp"]);
    expect(state.users).toEqual([{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }]);
    expect(state.posts).toEqual([{ id: 10, title: "x" }, { id: 11, title: "y" }, { id: 12, title: "z" }]);
    expect([document.querySelector("#uc").textContent, document.querySelector("#pc").textContent]).toEqual(["2", "3"]);
  });

  test("sql-aggregate-group-rt — SUM … GROUP BY evaluated by the engine", async () => {
    const src = P(`    type Total:struct = { region: string, total: int }
    <totals:Total[replace]=([])/>
    function regionTotals() -> Total[] {
        return ${SQ}\`SELECT region, SUM(amount) AS total FROM sales GROUP BY region ORDER BY region\`}.all() !{ _ :> [] }
    }
    function onLoad() {
        @totals = regionTotals() !{ .Transport(t) :> return }
    }`, `        <button id="load" onclick=onLoad()>Region totals</button>`);
    const { state } = await endToEnd(src, ["CREATE TABLE sales (id INTEGER, region TEXT, amount INTEGER)"],
      { sales: [{ id: 1, region: "west", amount: 10 }, { id: 2, region: "east", amount: 20 }, { id: 3, region: "west", amount: 5 }] }, ["#load"]);
    expect(state.totals).toEqual([{ region: "east", total: 20 }, { region: "west", total: 15 }]);
  });

  test("sql-order-limit-rt — ORDER BY … LIMIT evaluated by the engine", async () => {
    const src = P(`    type Score:struct = { player: string, points: int }
    <top:Score[replace]=([])/>
    function topTwo() -> Score[] {
        return ${SQ}\`SELECT player, points FROM scores ORDER BY points DESC LIMIT 2\`}.all() !{ _ :> [] }
    }
    function onLoad() {
        @top = topTwo() !{ .Transport(t) :> return }
    }`, `        <button id="load" onclick=onLoad()>Top two</button>`);
    const { state } = await endToEnd(src, ["CREATE TABLE scores (id INTEGER, player TEXT, points INTEGER)"],
      { scores: [{ id: 1, player: "a", points: 30 }, { id: 2, player: "b", points: 90 }, { id: 3, player: "c", points: 60 }] }, ["#load"]);
    expect(state.top).toEqual([{ player: "b", points: 90 }, { player: "c", points: 60 }]);
  });

  test("sql-where-filter-rt — WHERE with a bound parameter (`${role}`)", async () => {
    const src = P(`    type User:struct = { id: int, name: string }
    <admins:User[replace]=([])/>
    function loadByRole(role: string) -> User[] {
        return ${SQ}\`SELECT id, name FROM users WHERE role = \${role} ORDER BY id\`}.all() !{ _ :> [] }
    }`, `        <button id="load" onclick={ @admins = loadByRole("admin") !{ .Transport(t) :> return } }>Load admins</button>`);
    const { state } = await endToEnd(src, ["CREATE TABLE users (id INTEGER, name TEXT, role TEXT)"],
      { users: [{ id: 1, name: "Alice", role: "admin" }, { id: 2, name: "Bob", role: "user" }, { id: 3, name: "Carol", role: "admin" }] }, ["#load"]);
    expect(state.admins).toEqual([{ id: 1, name: "Alice" }, { id: 3, name: "Carol" }]);
  });

  test("sql-join-two-tables-rt — a JOIN with a bound parameter", async () => {
    const src = P(`    type Book:struct = { title: string, author: string }
    <list:Book[replace]=([])/>
    function booksByAuthor(name: string) -> Book[] {
        return ${SQ}\`SELECT b.title AS title, a.name AS author FROM books b JOIN authors a ON a.id = b.author_id WHERE a.name = \${name} ORDER BY b.id\`}.all() !{ _ :> [] }
    }
    function onLoad() {
        @list = booksByAuthor("Ada") !{ .Transport(t) :> return }
    }`, `        <button id="load" onclick=onLoad()>Load books</button>`);
    const { state } = await endToEnd(src, ["CREATE TABLE authors (id INTEGER, name TEXT)", "CREATE TABLE books (id INTEGER, title TEXT, author_id INTEGER)"],
      { authors: [{ id: 1, name: "Ada" }], books: [{ id: 1, title: "Notes", author_id: 1 }, { id: 2, title: "Essays", author_id: 1 }] }, ["#load"]);
    expect(state.list).toEqual([{ title: "Notes", author: "Ada" }, { title: "Essays", author: "Ada" }]);
  });

  test("sql-update-returning-rt — UPDATE … RETURNING the written row (two bound parameters)", async () => {
    const src = P(`    type Item:struct = { id: int, qty: int }
    <updated:Item[replace]=([])/>
    function bump(id: int, by: int) -> Item[] {
        return ${SQ}\`UPDATE items SET qty = qty + \${by} WHERE id = \${id} RETURNING id, qty\`}.all() !{ _ :> [] }
    }
    function onBump() {
        @updated = bump(1, 3) !{ .Transport(t) :> return }
    }`, `        <button id="go" onclick=onBump()>Bump qty</button>`);
    const { state, sql } = await endToEnd(src, ["CREATE TABLE items (id INTEGER, qty INTEGER)"], { items: [{ id: 1, qty: 5 }] }, ["#go"]);
    expect(state.updated).toEqual([{ id: 1, qty: 8 }]);
    expect(await sql.unsafe("SELECT qty FROM items WHERE id = 1")).toEqual([{ qty: 8 }]);
  });

  test("sql-delete-reflects-rt — a DELETE, then a COUNT reflects it (n = 2)", async () => {
    // shape: the legacy `<remaining> = not` (a `{n} | not` cell) is an int cell here; the asserted count is the case's
    const src = P(`    type Count:struct = { n: int }
    let <remaining:int=-1/>
    function removeTask(id: int) {
        ${SQ}\`DELETE FROM tasks WHERE id = \${id}\`}.run() !{ _ :> { return } }
    }
    function countTasks() -> int {
        const c: Count = ${SQ}\`SELECT COUNT(*) AS n FROM tasks\`}.get() !{ _ :> { return -1 } }
        return c.n
    }
    function onDelete() {
        removeTask(2) !{ .Transport(t) :> return }
    }
    function onCount() {
        @remaining = countTasks() !{ .Transport(t) :> return }
    }`, `        <button id="del" onclick=onDelete()>Delete task 2</button>
        <button id="count" onclick=onCount()>Count</button>`);
    const { state } = await endToEnd(src, ["CREATE TABLE tasks (id INTEGER, title TEXT)"], { tasks: [{ id: 1, title: "a" }, { id: 2, title: "b" }, { id: 3, title: "c" }] }, ["#del", "#count"]);
    expect(state.remaining).toBe(2);
  });

  test("sql-insert-returning-rt — INSERT … RETURNING (the <schema>'s autoincrement id) and a follow-up COUNT (n = 2)", async () => {
    // the case's `<schema>` (notes { id: integer primary key, body: text }) as DDL — the bootstrap refuses `<schema>`
    const src = P(`    type Note:struct = { id: int, body: string }
    type Count:struct = { n: int }
    <inserted:Note[replace]=([])/>
    let <total:int=-1/>
    function addNote(body: string) -> Note[] {
        return ${SQ}\`INSERT INTO notes (body) VALUES (\${body}) RETURNING id, body\`}.all() !{ _ :> [] }
    }
    function countNotes() -> int {
        const c: Count = ${SQ}\`SELECT COUNT(*) AS n FROM notes\`}.get() !{ _ :> { return -1 } }
        return c.n
    }
    function onAdd() {
        @inserted = addNote("second") !{ .Transport(t) :> return }
    }
    function onCount() {
        @total = countNotes() !{ .Transport(t) :> return }
    }`, `        <button id="add" onclick=onAdd()>Add note</button>
        <button id="count" onclick=onCount()>Count</button>`);
    const { state } = await endToEnd(src, ["CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)"], { notes: [{ id: 1, body: "first" }] }, ["#add", "#count"]);
    expect(state.inserted).toEqual([{ id: 2, body: "second" }]);
    expect(state.total).toBe(2);
  });

  test("sql-unique-constraint-rt — the <schema>'s UNIQUE constraint (INSERT OR IGNORE), then COUNT unchanged (n = 1)", async () => {
    const src = P(`    type Count:struct = { n: int }
    let <total:int=-1/>
    function tryAdd(email: string) {
        ${SQ}\`INSERT OR IGNORE INTO members (email) VALUES (\${email})\`}.run() !{ _ :> { return } }
    }
    function memberCount() -> int {
        const c: Count = ${SQ}\`SELECT COUNT(*) AS n FROM members\`}.get() !{ _ :> { return -1 } }
        return c.n
    }
    function onAdd() {
        tryAdd("a@x.com") !{ .Transport(t) :> return }
    }
    function onCount() {
        @total = memberCount() !{ .Transport(t) :> return }
    }`, `        <button id="add" onclick=onAdd()>Add duplicate</button>
        <button id="count" onclick=onCount()>Count</button>`);
    const { state } = await endToEnd(src, ["CREATE TABLE members (id INTEGER PRIMARY KEY, email TEXT UNIQUE)"], { members: [{ id: 1, email: "a@x.com" }] }, ["#add", "#count"]);
    expect(state.total).toBe(1);
  });

  test("a constraint violation is a SqlError VALUE (§19.8.1 ConstraintViolation) that the query's handler sees", async () => {
    const src = P(`    let <msg:string=""/>
    function add(email: string) -> string {
        ${SQ}\`INSERT INTO members (email) VALUES (\${email})\`}.run() !{
            .ConstraintViolation(f) :> { return "dup:" + f }
            _ :> { return "other" }
        }
        return "ok"
    }`, `        <button id="add" onclick={ @msg = add("a@x.com") !{ .Transport(t) :> return } }>Add</button>`);
    const { state } = await endToEnd(src, ["CREATE TABLE members (id INTEGER PRIMARY KEY, email TEXT UNIQUE)"], { members: [{ id: 1, email: "a@x.com" }] }, ["#add"]);
    expect(state.msg).toBe("dup:members.email");
  });
});

// =============================================================================
// 8. The client half meets the server half: CSRF retry, error envelope, defer
// =============================================================================
describe("client ↔ server — the first call plants the CSRF cookie and is retried once; a `fail` reaches the declared arm", () => {
  test("no cookie yet: 403 + Set-Cookie, the client retries ONCE with the planted token, the call succeeds", async () => {
    const src = P(`    let <n:int=0/>
    type Cnt:struct = { n: int }
    function count() -> int {
        const r: Cnt = ${SQ}\`SELECT COUNT(*) AS n FROM t\`}.get() !{ _ :> { return -1 } }
        return r.n
    }`, `        <button id="go" onclick={ @n = count() !{ .Transport(t) :> return } }>go</button>`);
    globalThis.document.cookie = "scrml_csrf=; Max-Age=0; Path=/";
    let posts = 0;
    const r0 = compile(src);
    const sql = await realDb(["CREATE TABLE t (id INTEGER)"], { t: [{ id: 1 }, { id: 2 }] });
    const { srv } = await serve(r0.core, sql);
    const loaded = await loadProgram(r0.core, "csrf-" + Math.random().toString(36).slice(2));
    const b = bridge(srv);
    globalThis.fetch = (p, i) => { posts += 1; return b(p, i); };
    click(document.querySelector("#go"));
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
    const inst = [...loaded.rt.devtools.instances.values()].find((i) => i.id === 0 && i.decl.name === "program");
    expect(loaded.rt.snapshot(inst).n).toBe(2);
    expect(posts).toBe(2);
  });

  test("a server `fail` crosses as its declared variant (payload kept) — not a Transport failure", async () => {
    const src = P(`    type SaveError:enum = { Conflict(current: int), Storage }
    let <seen:int=0/>
    let <status:string=""/>
    type Cnt:struct = { n: int }
    function save(v: int)! SaveError {
        const r: Cnt = ${SQ}\`SELECT COUNT(*) AS n FROM t\`}.get() !{ _ :> { fail .Storage } }
        if (r.n != v) fail .Conflict(r.n)
        return r.n
    }
    function go() {
        @seen = save(9) !{
            .Conflict(c) :> { @status = "conflict"; @seen = c; return }
            .Storage :> { @status = "storage"; return }
            .Transport(t) :> { @status = "transport"; return }
        }
        @status = "saved"
    }`, `        <button id="go" onclick=go()>go</button>`);
    const { state } = await endToEnd(src, ["CREATE TABLE t (id INTEGER)"], { t: [{ id: 1 }, { id: 2 }, { id: 3 }] }, ["#go"], 10);
    expect(state.status).toBe("conflict");
    expect(state.seen).toBe(3);
  });

  test("`defer` in a waiting server function is printed as the function's own `try … finally` — it runs at the real exit, AFTER the awaits (§19.16.2)", async () => {
    const src = P(`    let <n:int=0/>
    fn noop(x: int) -> int { return x }
    function work() -> int {
        defer noop(1)
        ${SQ}\`INSERT INTO log (v) VALUES ('body')\`}.run() !{ _ :> { return -1 } }
        return 1
    }`, `        <button id="go" onclick={ @n = work() !{ .Transport(t) :> return } }>go</button>`);
    const r0 = compile(src);
    expect(check(r0.core)).toEqual([]);
    const { server } = artifacts(r0.core);
    // the stack, the try, the await INSIDE the try, the run in the finally
    expect(server.js).toMatch(/async function work\(\) \{\n    const defers\$ = \[\];\n    try \{\n[\s\S]*await rt\.query[\s\S]*\} finally \{\n      rt\.runDefers\(defers\$\);/);
    const sql = await realDb(["CREATE TABLE log (id INTEGER PRIMARY KEY, v TEXT)"], {});
    const { srv, routes } = await serve(r0.core, sql);
    const r = await post(srv, pathOf(routes, "work"), []);
    expect([r.status, r.json]).toEqual([200, 1]);
    expect((await sql.unsafe("SELECT v FROM log")).map((x) => x.v)).toEqual(["body"]);
  });
});
