/**
 * S462 P0 — a CPS split must never move server logic, or the data it consumes, to
 * the client.
 *
 * THE FINDING (reproduced on a9aa81eff by execution). The login idiom
 *
 *     server function login(pass: string) {
 *       @out = ?{`SELECT name, pw FROM users WHERE name = 'bob'`}.get()
 *       if (!vp(pass, @out.pw)) { @out = "REJECTED" } else { @out = "WELCOME " + @out.name }
 *     }
 *
 * was split with the `if` on the CLIENT: the CPS tier classifier keyed server-only
 * imports on the IMPORTED name (so `verifyPassword as vp` never matched) and never
 * looked inside a control-flow head. The server returned the row — password hash
 * included — and the browser ran `!vp(...)` on the client copy of `scrml:auth`,
 * un-awaited: `!Promise` is false, so a wrong password read "WELCOME bob".
 *
 * WHAT THIS PINS (each assertion fails on a9aa81eff):
 *   - the response body of the route never carries the hash — only the final
 *     value of the cell the batch wrote (§19.9.9.7);
 *   - a wrong password is REJECTED and a right one WELCOMEs, decided on the server;
 *   - a request that supplies its own `out` cell (a forged row) cannot steer the
 *     check: the batch reads the value IT wrote, not the client's (§19.9.9.7 R7);
 *   - the client bundle carries no `scrml:auth` code at all;
 *   - the same holds without the deprecated `server` keyword (body-escalated).
 * Plus the related shapes the brief names: write-then-read, several writes, a
 * loop of writes, match arms, `fail` after a write, a transaction — and the
 * refusal of a write the server half cannot carry back.
 *
 * The happy-dom end-to-end twin (client bundle executing against this server) is
 * compiler/tests/browser/cps-server-logic-stays-server-s462.browser.test.js.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname, join } from "path";
import { writeFileSync, mkdirSync, readFileSync, readdirSync } from "fs";
import { Database } from "bun:sqlite";
import { perRunTmp } from "../helpers/per-run-tmp.js";
import { compileScrml } from "../../src/api.js";

const EXECUTED_DB_TIMEOUT_MS = 30_000;

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
const _tmp = perRunTmp(resolve(testDir, "_tmp_cps_server_logic_s462"));
let counter = 0;
beforeAll(_tmp.setup);
afterAll(_tmp.teardown);

const RIGHT = "right-password";
let HASH = "";

/** Compile `src` in a fresh dir whose `n1.db` holds bob with an argon2id hash of RIGHT. */
async function build(src, tag) {
  if (!HASH) HASH = await Bun.password.hash(RIGHT);
  const name = `${tag}-${++counter}`;
  const dir = resolve(_tmp.root, name);
  const out = resolve(dir, "dist");
  mkdirSync(out, { recursive: true });
  const db = new Database(resolve(dir, "n1.db"), { create: true });
  db.exec("CREATE TABLE users (name TEXT, pw TEXT, kind TEXT)");
  db.exec("CREATE TABLE totals (t INTEGER)");
  db.exec("CREATE TABLE secrets (s TEXT)");
  db.exec("INSERT INTO secrets (s) VALUES ('keep-me')");
  db.query("INSERT INTO users (name, pw, kind) VALUES ('bob', ?, 'admin'), ('amy', 'x', 'user')").run(HASH);
  db.close();
  const input = resolve(dir, `${name}.scrml`);
  writeFileSync(input, src);
  const result = compileScrml({ inputFiles: [input], write: true, outputDir: out });
  const errors = (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error");
  const read = (f) => readFileSync(join(out, f), "utf8");
  const files = readdirSync(out);
  const runtime = files.filter((f) => /^scrml-runtime.*\.js$/.test(f)).map(read).join("\n");
  return {
    errors,
    dir,
    clientJs: files.includes(`${name}.client.js`) ? read(`${name}.client.js`) : "",
    serverJs: files.includes(`${name}.server.js`) ? read(`${name}.server.js`) : "",
    runtime,
    serverPath: join(out, `${name}.server.js`),
  };
}

/**
 * A POST to a route the way the generated client makes it (double-submit CSRF).
 * Duck-typed, like the conformance adapter's: a happy-dom `Request` (if any earlier
 * test file in this process registered happy-dom's globals) silently drops the
 * forbidden `Cookie` header, which would 403 every call for a reason unrelated to
 * what is under test.
 */
function postRequest(path, body) {
  const headers = { "content-type": "application/json", "x-csrf-token": "t0k", cookie: "scrml_csrf=t0k" };
  const text = JSON.stringify(body);
  return {
    url: `http://localhost${path}`,
    method: "POST",
    headers: { get: (k) => headers[String(k).toLowerCase()] ?? null },
    json: async () => JSON.parse(text),
    text: async () => text,
  };
}

/** POST a server route the way the generated client does (double-submit CSRF). */
async function callRoute(serverPath, fnName, body) {
  const mod = await import(`file://${serverPath}?v=${Date.now()}-${Math.random()}`);
  const route = mod.routes.find((r) => r.path.includes(`_${fnName}_`));
  if (!route) throw new Error(`no route for ${fnName}: ${mod.routes.map((r) => r.path).join(", ")}`);
  const resp = await route.handler(postRequest(route.path, body));
  const raw = await resp.text();
  return { status: resp.status, raw, json: JSON.parse(raw) };
}

const LOGIN_SERVER_KEYWORD = `<program db="sqlite:./n1.db">
<out> = ""
\${ import { verifyPassword as vp, hashPassword } from "scrml:auth" }
server function login(pass: string) {
  @out = ?{\`SELECT name, pw FROM users WHERE name = 'bob'\`}.get()
  if (!vp(pass, @out.pw)) { @out = "REJECTED" } else { @out = "WELCOME " + @out.name }
}
<button id="l" onclick={ login("wrong-password") }>login</button>
<p id="o">\${@out}</p>
</program>
`;

const LOGIN_ESCALATED = LOGIN_SERVER_KEYWORD.replace("server function login", "function login");

for (const [label, SRC] of [["`server function`", LOGIN_SERVER_KEYWORD], ["body-escalated `function`", LOGIN_ESCALATED]]) {
  describe(`S462 P0 — login split (${label})`, () => {
    test("compiles; the client bundle carries no scrml:auth code", async () => {
      const b = await build(SRC, "login-bundle");
      expect(b.errors.map((e) => e.code)).toEqual([]);
      // The check is not on the client in any form.
      expect(b.clientJs).not.toContain("verifyPassword");
      expect(b.clientJs).not.toMatch(/\bvp\(/);
      expect(b.clientJs).not.toContain("_scrml_stdlib.auth");
      // And the runtime ships no scrml:auth chunk.
      expect(b.runtime).not.toContain("chunk: stdlib-auth");
      expect(b.runtime).not.toContain("_scrml_stdlib.auth");
      expect(b.runtime).not.toContain("argon2");
      // The check runs on the server, awaited.
      expect(b.serverJs).toMatch(/await vp\(pass, _scrml_cell_out\.pw\)/);
    }, EXECUTED_DB_TIMEOUT_MS);

    test("wrong password → REJECTED; the response body carries no hash", async () => {
      const b = await build(SRC, "login-wrong");
      const r = await callRoute(b.serverPath, "login", { pass: "wrong-password" });
      expect(r.status).toBe(200);
      expect(r.raw).not.toContain("argon2");
      expect(r.raw).not.toContain(HASH);
      expect(r.raw).not.toContain('"pw"');
      expect(r.json).toEqual({ __scrml_cells: { out: "REJECTED" } });
    }, EXECUTED_DB_TIMEOUT_MS);

    test("right password → WELCOME bob; the response body carries no hash", async () => {
      const b = await build(SRC, "login-right");
      const r = await callRoute(b.serverPath, "login", { pass: RIGHT });
      expect(r.raw).not.toContain("argon2");
      expect(r.raw).not.toContain('"pw"');
      expect(r.json).toEqual({ __scrml_cells: { out: "WELCOME bob" } });
    }, EXECUTED_DB_TIMEOUT_MS);

    test("a forged `out` cell in the request cannot steer the check (§19.9.9.7 batch-local read)", async () => {
      const b = await build(SRC, "login-forged");
      const forged = await Bun.password.hash("attacker");
      const r = await callRoute(b.serverPath, "login", { pass: "attacker", out: { name: "eve", pw: forged } });
      expect(r.json).toEqual({ __scrml_cells: { out: "REJECTED" } });
    }, EXECUTED_DB_TIMEOUT_MS);
  });
}

describe("S462 P0 — related shapes", () => {
  test("write then read in one batch: the INSERT binds the value the batch wrote, not the client's", async () => {
    const b = await build(`<program db="sqlite:./n1.db">
<total> = 0
function snap() {
  const c = ?{\`SELECT count(*) AS n FROM users\`}.get()
  @total = c.n
  ?{\`INSERT INTO totals (t) VALUES (\${@total})\`}.run()
}
<button onclick={ snap() }>s</button>
<p>\${@total}</p>
</program>
`, "write-read");
    expect(b.errors.map((e) => e.code)).toEqual([]);
    const r = await callRoute(b.serverPath, "snap", { total: 999 });
    expect(r.json).toEqual({ __scrml_cells: { total: 2 } });
    const db = new Database(resolve(b.dir, "n1.db"));
    const rows = db.query("SELECT t FROM totals").all();
    db.close();
    expect(rows).toEqual([{ t: 2 }]);
  }, EXECUTED_DB_TIMEOUT_MS);

  test("several cell writes in one batch: every cell comes back (not only the first)", async () => {
    const b = await build(`<program db="sqlite:./n1.db">
<names> = []
<kinds> = []
function load() {
  @names = ?{\`SELECT name FROM users ORDER BY name\`}.all()
  @kinds = ?{\`SELECT kind FROM users ORDER BY name\`}.all()
}
<button onclick={ load() }>l</button>
<p>\${@names.length} \${@kinds.length}</p>
</program>
`, "multi-write");
    expect(b.errors.map((e) => e.code)).toEqual([]);
    expect(b.serverJs).not.toContain("_scrml_reactive_set");
    const r = await callRoute(b.serverPath, "load", {});
    expect(r.json).toEqual({ __scrml_cells: { names: [{ name: "amy" }, { name: "bob" }], kinds: [{ kind: "user" }, { kind: "admin" }] } });
  }, EXECUTED_DB_TIMEOUT_MS);

  test("a loop of cell writes over a query: the last value comes back, the rows do not", async () => {
    const b = await build(`<program db="sqlite:./n1.db">
<last> = ""
<count> = 0
<done> = false
function scan() {
  for (const r of ?{\`SELECT name, pw FROM users ORDER BY name\`}.all()) {
    @last = r.name
    @count += 1
  }
  @done = true
}
<button onclick={ scan() }>s</button>
<p>\${@last} \${@count} \${@done}</p>
</program>
`, "loop");
    expect(b.errors.map((e) => e.code)).toEqual([]);
    const r = await callRoute(b.serverPath, "scan", { count: 0 });
    expect(r.raw).not.toContain("argon2");
    expect(r.json).toEqual({ __scrml_cells: { last: "bob", count: 2 } });
    // `@done = true` reads nothing server-side: it stays a client statement.
    expect(b.clientJs).toMatch(/reactive_set\("done", true\)/);
  }, EXECUTED_DB_TIMEOUT_MS);

  test("match arms that write cells, on a server-only scrutinee", async () => {
    const b = await build(`<program db="sqlite:./n1.db">
<role> = ""
function whoIs(n: string) {
  const row = ?{\`SELECT kind FROM users WHERE name = \${n}\`}.get()
  match row.kind {
    "admin" :> @role = "ADMIN"
    else :> @role = "USER"
  }
}
<button onclick={ whoIs("bob") }>w</button>
<p>\${@role}</p>
</program>
`, "match");
    expect(b.errors.map((e) => e.code)).toEqual([]);
    expect(b.clientJs).not.toMatch(/\brow\b/);
    expect((await callRoute(b.serverPath, "whoIs", { n: "bob" })).json).toEqual({ __scrml_cells: { role: "ADMIN" } });
    expect((await callRoute(b.serverPath, "whoIs", { n: "amy" })).json).toEqual({ __scrml_cells: { role: "USER" } });
  }, EXECUTED_DB_TIMEOUT_MS);

  test("`fail` after a client write: the server decides, the row never reaches the client", async () => {
    const b = await build(`<program db="sqlite:./n1.db">
<msg> = ""
type E:enum = { Missing }
function f(n: string)! -> E {
  @msg = "start"
  const row = ?{\`SELECT name, pw FROM users WHERE name = \${n}\`}.get()
  if (row is not) { fail E.Missing }
  @msg = row.name
}
<button onclick={ f("zed") !{ _ :> @msg = "failed" } }>x</button>
<p>\${@msg}</p>
</program>
`, "fail");
    expect(b.errors.map((e) => e.code)).toEqual([]);
    // Before S462 this compiled with the `if`/`@msg = row.name` on the client, reading
    // a `row` the client never received.
    expect(b.clientJs).not.toMatch(/\brow\b/);
    const miss = await callRoute(b.serverPath, "f", { n: "zed" });
    expect(miss.json.__scrml_error).toBe(true);
    expect(miss.json.variant).toBe("Missing");
    const hit = await callRoute(b.serverPath, "f", { n: "bob" });
    expect(hit.raw).not.toContain("argon2");
    expect(hit.json).toBe("bob");
  }, EXECUTED_DB_TIMEOUT_MS);

  test("a transaction: the cell write inside it rides back only when the transaction commits", async () => {
    const b = await build(`<program db="sqlite:./n1.db">
<status> = ""
\${ import { hashPassword } from "scrml:auth" }
function register(name: string, pass: string)! {
  @status = "saving"
  transaction {
    ?{\`INSERT INTO users (name, pw, kind) VALUES (\${name}, \${hashPassword(pass)}, 'user')\`}.run()
    @status = "saved " + name
  }
}
<button onclick={ register("zoe", "pw") !{ _ :> @status = "failed" } }>r</button>
<p>\${@status}</p>
</program>
`, "txn");
    expect(b.errors.map((e) => e.code)).toEqual([]);
    expect(b.clientJs).not.toContain("hashPassword");
    const r = await callRoute(b.serverPath, "register", { name: "zoe", pass: "pw" });
    expect(r.json).toEqual({ __scrml_cells: { status: "saved zoe" } });
    expect(r.raw).not.toContain("argon2");
    const db = new Database(resolve(b.dir, "n1.db"));
    const row = db.query("SELECT pw FROM users WHERE name = 'zoe'").get();
    db.close();
    expect(await Bun.password.verify("pw", row.pw)).toBe(true);
  }, EXECUTED_DB_TIMEOUT_MS);

  // protect= (§11.3 / §14.8.9) is how a program SAYS a column is secret. A check
  // that reads only cells and parameters touches no server-only resource, so
  // without protect= it is client work and the row its cell holds crosses the wire
  // (the compiler cannot know `pw` is a secret). With protect= the read of `.pw` is
  // a protected-field access (§12.2 Trigger 2), the check runs on the server, and
  // the §14.8.9 egress floor strips the column from any value that still leaves.
  test("protect=: a check that reads the protected column runs on the server; the column never leaves", async () => {
    const b = await build(`<program db="./n1.db" auth="none">
<db src="./n1.db" tables="users" protect="pw"/>
<out> = ""
function login(pass: string) {
  @out = ?{\`SELECT name, pw FROM users WHERE name = 'bob'\`}.get()
  if (@out.pw == pass) { @out = "MATCH" } else { @out = "SEEN " + @out.name }
}
<button onclick={ login("x") }>l</button>
<p>\${@out}</p>
</program>
`, "protect-check");
    expect(b.errors.map((e) => e.code)).toEqual([]);
    expect(b.clientJs).not.toMatch(/\.pw\b/);
    const r = await callRoute(b.serverPath, "login", { pass: "x" });
    expect(r.raw).not.toContain("argon2");
    expect(r.json).toEqual({ __scrml_cells: { out: "SEEN bob" } });
  }, EXECUTED_DB_TIMEOUT_MS);

  test("protect=: a row written to a cell and NOT overwritten crosses the wire without the protected column", async () => {
    const b = await build(`<program db="./n1.db" auth="none">
<db src="./n1.db" tables="users" protect="pw"/>
<out> = ""
<seen> = false
function load() {
  @out = ?{\`SELECT name, pw FROM users WHERE name = 'bob'\`}.get()
  @seen = true
}
<button onclick={ load() }>l</button>
<p>\${@seen}</p>
</program>
`, "protect-row");
    expect(b.errors.map((e) => e.code)).toEqual([]);
    const r = await callRoute(b.serverPath, "load", {});
    expect(r.raw).not.toContain("argon2");
    expect(r.raw).not.toContain('"pw"');
    expect(r.json).toEqual({ name: "bob" });
  }, EXECUTED_DB_TIMEOUT_MS);

  // §19.9.9.5's own worked example: two server batches with a client write between
  // them. The cell batch 0 computes is computed ON THE SERVER (it reads the
  // `reserved` row — only `held` crosses the wire), and batch 1, which writes no
  // cell, must not overwrite it: before S462 the last batch was assigned the
  // function's FIRST cell and the client set it to batch 1's (empty) result.
  test("cell writes interleaved with server batches: each batch hands back only its own cell", async () => {
    const b = await build(`<program db="sqlite:./n1.db">
<reservationShown> = 0
<status> = ""
function checkout(id: number) {
  let reserved = ?{\`UPDATE totals SET t = t + 1 WHERE rowid = \${id} RETURNING t\`}.get()
  @reservationShown = reserved.t
  @status = "charging"
  ?{\`INSERT INTO users (name, pw, kind) VALUES ('cart', 'x', 'charge')\`}.run()
}
<button onclick={ checkout(1) }>c</button>
<p>\${@reservationShown} \${@status}</p>
</program>
`, "multibatch");
    expect(b.errors.map((e) => e.code)).toEqual([]);
    expect(b.clientJs).toMatch(/_scrml_batch_1_result/);
    expect(b.clientJs).not.toMatch(/reactive_set\("reservationShown", _scrml_batch_1_result\)/);
    // `reserved` (the row) never reaches the client; only the computed cell does.
    expect(b.clientJs).not.toMatch(/\breserved\b/);
    const db = new Database(resolve(b.dir, "n1.db"));
    db.exec("INSERT INTO totals (t) VALUES (41)");
    db.close();
    const mod = await import(`file://${b.serverPath}?v=${Date.now()}-${Math.random()}`);
    const post = async (route, body) => (await route.handler(postRequest(route.path, body))).json();
    const r0 = mod.routes.find((r) => r.path.endsWith("__batch_0"));
    const r1 = mod.routes.find((r) => r.path.endsWith("__batch_1"));
    expect(await post(r0, { id: 1 })).toBe(42);
    expect(await post(r1, { id: 1, reservationShown: 42 })).toBe(null);
  }, EXECUTED_DB_TIMEOUT_MS);

  test("a write the server half cannot carry back is refused (E-RI-002), not relocated", async () => {
    const b = await build(`<program db="sqlite:./n1.db">
<u> = { name: "" }
function pick() {
  const row = ?{\`SELECT name FROM users WHERE name = 'bob'\`}.get()
  @u.name = row.name
}
<button onclick={ pick() }>p</button>
<p>\${@u.name}</p>
</program>
`, "refuse");
    const ri = b.errors.filter((e) => e.code === "E-RI-002");
    expect(ri.length).toBeGreaterThan(0);
    expect(ri[0].message).toContain("assigns to a field of the cell");
    expect(ri[0].message).toContain("@u");
  }, EXECUTED_DB_TIMEOUT_MS);
});

// ===========================================================================
// S462 P0 fix round 1 — the review's H-shapes. Each put the auth decision or the
// hash on the client (or trusted a server value carried back by the client) on
// 533609165; H1 and H3 also on base a9aa81eff.
// ===========================================================================

/** POST every route of `fnName` (a split may have several) with `body`; the parsed results. */
async function callAllRoutes(serverPath, fnName, body) {
  const mod = await import(`file://${serverPath}?v=${Date.now()}-${Math.random()}`);
  const routes = mod.routes.filter((r) => r.path.includes(`_${fnName}_`));
  const out = [];
  for (const route of routes) {
    const resp = await route.handler(postRequest(route.path, body));
    out.push({ path: route.path, status: resp.status, raw: await resp.text() });
  }
  return out;
}

const H_LOGIN = (fn) => `<program db="sqlite:./n1.db">
<out> = ""
\${ import { verifyPassword as vp } from "scrml:auth" }
${fn}
<button onclick={ login("x") }>l</button>
<p>\${@out}</p>
</program>
`;

const H_SHAPES = {
  "H1 — the check goes through a helper (`server function`)": H_LOGIN(`function check(p, h) { return vp(p, h) }
server function login(pass: string) {
  @out = ?{\`SELECT name, pw FROM users WHERE name = 'bob'\`}.get()
  if (!check(pass, @out.pw)) { @out = "REJECTED" } else { @out = "WELCOME " + @out.name }
}`),
  "H2a — the hash goes through a local": H_LOGIN(`function login(pass: string) {
  @out = ?{\`SELECT name, pw FROM users WHERE name = 'bob'\`}.get()
  const hash = @out.pw
  if (!vp(pass, hash)) { @out = "REJECTED" } else { @out = "WELCOME " + @out.name }
}`),
  "H2b — the hash goes through a destructure": H_LOGIN(`function login(pass: string) {
  @out = ?{\`SELECT name, pw FROM users WHERE name = 'bob'\`}.get()
  const { pw, name } = @out
  if (!vp(pass, pw)) { @out = "REJECTED" } else { @out = "WELCOME " + name }
}`),
  "H4 — a loop over the rows after a cell write": H_LOGIN(`function login(pass: string) {
  const rows = ?{\`SELECT name, pw FROM users WHERE name = 'bob'\`}.all()
  @out = "REJECTED"
  for (const u of rows) {
    if (vp(pass, u.pw)) { @out = "WELCOME " + u.name }
  }
}`),
};

describe("S462 P0 fix round 1 — the auth decision and the hash stay on the server (H1, H2, H4)", () => {
  for (const [label, SRC] of Object.entries(H_SHAPES)) {
    test(`${label}: wrong → REJECTED, right → WELCOME bob, one request, no hash in any body`, async () => {
      const b = await build(SRC, "h-shape");
      expect(b.errors.map((e) => e.code)).toEqual([]);
      for (const [pass, want] of [["wrong-password", "REJECTED"], [RIGHT, "WELCOME bob"]]) {
        const results = await callAllRoutes(b.serverPath, "login", { pass });
        // ONE request does the whole job: no second batch the client feeds.
        expect(results.length).toBe(1);
        const [r] = results;
        expect(r.status).toBe(200);
        expect(r.raw).not.toContain("argon2");
        expect(r.raw).not.toContain('"pw"');
        expect(JSON.parse(r.raw)).toEqual({ __scrml_cells: { out: want } });
      }
      // The client half never sees the row's hash field, nor calls the check itself
      // (`check` keeps its own route for other callers; login's wrapper must not use it).
      expect(b.clientJs).not.toMatch(/\.pw\b/);
      const wrapper = (b.clientJs.match(/async function _scrml_cps_login_\d+\([\s\S]*?\n}\n/) ?? [""])[0];
      expect(wrapper).toContain("__scrml_cells");
      expect(wrapper).not.toMatch(/_scrml_fetch_check_\d+\(/);
    }, EXECUTED_DB_TIMEOUT_MS);
  }
});

describe("S462 P0 fix round 1 — H3: a server value never comes back from the client as trusted input", () => {
  const H3 = `<program db="sqlite:./n1.db">
<row> = { name: "", role: "" }
<busy> = false
<msg> = ""
function purge(id: number) {
  @row = ?{\`SELECT name, kind AS role FROM users WHERE rowid = \${id}\`}.get()
  @busy = true
  if (@row.role == "admin") {
    ?{\`DELETE FROM secrets\`}.run()
    @msg = "purged"
  }
}
<button onclick={ purge(2) }>p</button>
<p>\${@msg} \${@busy}</p>
</program>
`;
  test("a forged `row` cell in ANY purge request does not run the DELETE; the real admin path still does", async () => {
    const b = await build(H3, "h3");
    expect(b.errors.map((e) => e.code)).toEqual([]);
    const secrets = () => {
      const db = new Database(resolve(b.dir, "n1.db"));
      const n = db.query("SELECT count(*) AS n FROM secrets").get().n;
      db.close();
      return n;
    };
    // amy (rowid 2) is a "user". The attacker claims she is an admin.
    const forged = await callAllRoutes(b.serverPath, "purge", { id: 2, row: { name: "amy", role: "admin" } });
    expect(forged.length).toBe(1);
    expect(secrets()).toBe(1);
    expect(JSON.parse(forged[0].raw).__scrml_cells.msg).toBeUndefined();
    // bob (rowid 1) really is an admin: the server reads that itself.
    const real = await callAllRoutes(b.serverPath, "purge", { id: 1 });
    expect(JSON.parse(real[0].raw).__scrml_cells.msg).toBe("purged");
    expect(secrets()).toBe(0);
    // The request never carries `row` (the batch writes it before it reads it).
    expect(b.clientJs).not.toMatch(/"row":\s*_scrml(?:_cs)?_reactive_get\("row"\)/);
  }, EXECUTED_DB_TIMEOUT_MS);

  test("a statement that must stay in the browser yet sits between the producer and the consumer is REFUSED (E-RI-002)", async () => {
    const b = await build(`<program db="sqlite:./n1.db">
<row> = { name: "", role: "" }
<msg> = ""
function purge(id: number) {
  @row = ?{\`SELECT name, kind AS role FROM users WHERE rowid = \${id}\`}.get()
  localStorage.setItem("checking", "1")
  if (@row.role == "admin") {
    ?{\`DELETE FROM secrets\`}.run()
    @msg = "purged"
  }
}
<button onclick={ purge(2) }>p</button>
<p>\${@msg}</p>
</program>
`, "h3-refuse");
    // The browser-only statement sits between the server work that produces `@row`
    // and the server work that uses it: it can neither join the server batch nor
    // let `@row` round-trip through the browser.
    const ri = b.errors.filter((e) => e.code === "E-RI-002");
    expect(ri.length).toBe(1);
    expect(ri[0].message).toContain("`@row`");
    expect(ri[0].message).toContain("`localStorage`");
  }, EXECUTED_DB_TIMEOUT_MS);
});

describe("S462 P0 fix round 1 (M1) — scrml:crypto ships only its browser-safe members to the client", () => {
  test("a browser-safe member compiles on the client; the shipped chunk has no host API", async () => {
    const b = await build(`<program>
\${ import { generateUUID, safeCompare } from "scrml:crypto" }
<id> = generateUUID()
<same> = safeCompare("a", "a")
<p>\${@id} \${@same}</p>
</program>
`, "m1-safe");
    expect(b.errors.map((e) => e.code)).toEqual([]);
    expect(b.runtime).toContain("chunk: stdlib-crypto");
    expect(b.runtime).not.toMatch(/Bun\.(password|CryptoHasher)/);
  }, EXECUTED_DB_TIMEOUT_MS);

  test("a server-only member on the client is refused (E-STDLIB-CLIENT-CHUNK-MISSING)", async () => {
    const b = await build(`<program>
\${ import { hash } from "scrml:crypto" }
<h> = hash("sha256", "x")
<p>\${@h}</p>
</program>
`, "m1-unsafe");
    expect(b.errors.map((e) => e.code)).toContain("E-STDLIB-CLIENT-CHUNK-MISSING");
  }, EXECUTED_DB_TIMEOUT_MS);
});
