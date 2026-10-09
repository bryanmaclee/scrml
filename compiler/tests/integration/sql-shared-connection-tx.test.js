/**
 * S449 rulings C + D — EXECUTED through compiled route handlers against a real
 * bun:sqlite file.
 *
 * C (g-shared-sql-connection-concurrent-handlers-share-transaction, §19.10.6): one
 * module-level `_scrml_sql` connection served every request, so a request arriving
 * while another sat inside its §8.9.2 implicit envelope ran INSIDE that transaction:
 * its acknowledged write was rolled back with it, it read rows that were never
 * committed, and a second envelope's BEGIN threw `cannot start a transaction within a
 * transaction`. The fix holds the connection for a transaction's whole duration;
 * other requests wait.
 *
 * D (g-implicit-handler-tx-commits-on-fail, §8.9.2 amended S449): a `fail` exit (and
 * a `?` propagating a callee's failure) of an implicitly-wrapped `!` handler ROLLs
 * BACK; before, it committed.
 *
 * DETERMINISM. The interleaving is forced, never lucky. A `!` handler's body, AFTER its
 * writes and INSIDE its transaction, awaits `get(url)` (`scrml:http`, auto-awaited) on a
 * local HTTP server the test controls: the server reports when the request ARRIVES
 * (so the test knows the handler is parked mid-transaction) and answers only when the
 * test releases it. "B is still waiting" is asserted against an idle event loop on
 * which nothing but that held response could advance A.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Database } from "bun:sqlite";

import { compileScrml } from "../../src/api.js";

// Executed-DB tests (compile, then a real driver round-trip) and the hooks that build them
// declare their own budget: bun's 5 s default is too tight on the slow Windows CI runner
// (g-windows-executed-db-tests-5s-timeout-s460). Per test, never a raised global default.
const EXECUTED_DB_TIMEOUT_MS = 30_000;

// ⚑ `server` is written explicitly on the enveloped fns: a body-escalated `!` fn (no
// `server` modifier) gets NO §8.9.2 envelope today, although W-DEPRECATED-SERVER-MODIFIER
// calls the modifier redundant (filed S449, g-implicit-envelope-requires-explicit-server-modifier).
const APP = (dbPath) => `<program db="${dbPath}">
\${
  import { get } from 'scrml:http'
  type E:enum = { Rejected, TooBig }

  server function check(n)! -> E {
    if (n > 100) { fail E::TooBig }
    return n
  }

  // writes, parks on the held URL, then violates the PK -> exception -> ROLLBACK
  server function boom(n, url)! -> E {
    ?{\`UPDATE accounts SET balance = 999 WHERE id = 1\`}.run()
    ?{\`UPDATE accounts SET balance = 999 WHERE id = 2\`}.run()
    const held = get(url)
    ?{\`INSERT INTO accounts (id, balance) VALUES (\${n}, 0)\`}.run()
    return 0
  }

  // writes, parks on the held URL, then commits
  server function hold(url)! -> E {
    ?{\`UPDATE accounts SET balance = balance + 100 WHERE id = 1\`}.run()
    const held = get(url)
    ?{\`UPDATE accounts SET balance = balance + 100 WHERE id = 2\`}.run()
    return 0
  }

  server function implicitFail(n)! -> E {
    ?{\`UPDATE accounts SET balance = 500 WHERE id = 1\`}.run()
    ?{\`UPDATE accounts SET balance = 500 WHERE id = 2\`}.run()
    if (n > 0) { fail E::Rejected }
    return 0
  }

  server function implicitPropagate(n)! -> E {
    ?{\`UPDATE accounts SET balance = 600 WHERE id = 1\`}.run()
    ?{\`UPDATE accounts SET balance = 600 WHERE id = 2\`}.run()
    const v = check(n)?
    return v
  }

  function plainWrite(msg) {
    ?{\`INSERT INTO log (msg) VALUES (\${msg})\`}.run()
    return 1
  }

  function readBalances() {
    return ?{\`SELECT id, balance FROM accounts ORDER BY id\`}.all()
  }
}
<p>x</>
</program>`;

let dir, dbPath, compileErrors, routes, serverJs, holdServer;

// --- the held-response server: /hold/<key> answers when the test releases <key> ---
const holds = new Map(); // key -> { arrived: {wait, open}, release: {wait, open} }
function latch() {
  let open;
  const wait = new Promise((r) => { open = r; });
  return { wait, open };
}
function holdFor(key) {
  if (!holds.has(key)) holds.set(key, { arrived: latch(), release: latch() });
  return holds.get(key);
}
const holdUrl = (key) => `http://127.0.0.1:${holdServer.port}/hold/${key}`;

function seed() {
  const db = new Database(dbPath);
  db.run("DROP TABLE IF EXISTS accounts");
  db.run("CREATE TABLE accounts (id INTEGER PRIMARY KEY, balance INTEGER NOT NULL)");
  db.run("INSERT INTO accounts (id, balance) VALUES (1, 10), (2, 0)");
  db.run("DROP TABLE IF EXISTS log");
  db.run("CREATE TABLE log (id INTEGER PRIMARY KEY, msg TEXT)");
  db.close();
}

function committed() {
  const db = new Database(dbPath, { readonly: true });
  const acc = db.query("SELECT id, balance FROM accounts ORDER BY id").all().map((r) => r.balance);
  const log = db.query("SELECT msg FROM log ORDER BY id").all().map((r) => r.msg);
  db.close();
  return { acc, log };
}

const HEADERS = {
  "Cookie": "scrml_csrf=tok-s449",
  "X-CSRF-Token": "tok-s449",
  "Content-Type": "application/json",
};

function routeFor(name) {
  const route = routes.find((r) => r.path.includes(`_${name}_`));
  expect(route).toBeTruthy();
  return route;
}

async function call(name, body) {
  const route = routeFor(name);
  try {
    const res = await route.handler(new Request(`http://localhost${route.path}`, {
      method: "POST", headers: HEADERS, body: JSON.stringify(body ?? {}),
    }));
    return { status: res.status, body: await res.json().catch(() => null) };
  } catch (e) {
    return { threw: String(e?.message ?? e) };
  }
}

/** A call whose request BODY the test releases (a stalled upload). */
function callWithStalledBody(name, body) {
  const route = routeFor(name);
  let release;
  const gate = new Promise((r) => { release = r; });
  const bytes = new TextEncoder().encode(JSON.stringify(body ?? {}));
  const stream = new ReadableStream({ async pull(c) { await gate; c.enqueue(bytes); c.close(); } });
  const p = Promise.resolve(route.handler(new Request(`http://localhost${route.path}`, {
    method: "POST", headers: HEADERS, body: stream, duplex: "half",
  }))).then(async (res) => ({ status: res.status }), (e) => ({ threw: String(e?.message ?? e) }));
  return { p, release };
}

function track(p) {
  const t = { done: false };
  t.promise = p.then((v) => { t.done = true; t.value = v; return v; });
  return t;
}

const settle = (ms = 40) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  if (typeof globalThis.document !== "undefined") return;
  holdServer = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const key = new URL(req.url).pathname.split("/").pop();
      const h = holdFor(key);
      h.arrived.open();
      await h.release.wait;
      return new Response("{}", { headers: { "Content-Type": "application/json" } });
    },
  });
  dir = mkdtempSync(join(tmpdir(), "s449-conn-tx-"));
  dbPath = join(dir, "bank.db").replace(/\\/g, "/");
  seed();
  const file = join(dir, "app.scrml");
  const outDir = join(dir, "out");
  writeFileSync(file, APP(dbPath));
  const result = compileScrml({ inputFiles: [file], outputDir: outDir, write: true, log: () => {} });
  compileErrors = (result.errors ?? []).filter((e) => !/^[WI]-/.test(e.code ?? "") && e.severity !== "warning");
  serverJs = await Bun.file(join(outDir, "app.server.js")).text();
  const mod = await import(`file://${join(outDir, "app.server.js")}?v=${Date.now()}`);
  routes = mod.routes || [];
}, EXECUTED_DB_TIMEOUT_MS);

afterAll(() => {
  try { holdServer?.stop(true); } catch { /* stopped */ }
  try { if (dir) rmSync(dir, { recursive: true, force: true }); } catch { /* EBUSY on Windows */ }
});

describe("S449 C — concurrent requests never share a transaction (§19.10.6)", () => {
  test("compiles clean; the handle is guarded and every route runs in a request scope", () => {
    if (typeof globalThis.document !== "undefined") return;
    expect(compileErrors.map((e) => e.code)).toEqual([]);
    expect(serverJs).toMatch(/^const _scrml_sql = _scrml_db_guard\(.*, "sqlite", false\);$/m);
    expect(serverJs).toMatch(/_scrml_route\.handler = _scrml_db_request_scope\(_scrml_route\.handler\)/);
    // the runtime is import-free (the conformance adapter evaluates with new Function)
    expect(serverJs).not.toMatch(/^import .*async_hooks/m);
    // the park point really is inside the envelope
    expect(serverJs).toMatch(/BEGIN DEFERRED[\s\S]*await get\(url\)[\s\S]*COMMIT/);
  });

  test("symptom 1: a plain write arriving mid-transaction WAITS, returns 200, and SURVIVES the ROLLBACK (was: 200 + row lost)", async () => {
    if (typeof globalThis.document !== "undefined") return;
    seed();
    const h = holdFor("s1");
    const a = track(call("boom", { n: 1, url: holdUrl("s1") })); // id 1 exists -> PK -> ROLLBACK
    await h.arrived.wait; // A has written and is parked inside its transaction
    const b = track(call("plainWrite", { msg: "acknowledged" }));
    await settle();
    expect(b.done).toBe(false); // waiting — NOT running inside A's transaction
    h.release.open();
    const ar = await a.promise;
    const br = await b.promise;
    expect(ar.status === 500 || ar.threw !== undefined).toBe(true); // A failed (PK) and rolled back
    expect(br).toEqual({ status: 200, body: 1 });
    expect(committed()).toEqual({ acc: [10, 0], log: ["acknowledged"] });
  }, EXECUTED_DB_TIMEOUT_MS);

  test("symptom 2: a second implicit envelope waits instead of failing `cannot start a transaction within a transaction`", async () => {
    if (typeof globalThis.document !== "undefined") return;
    seed();
    const h = holdFor("s2");
    const a = track(call("hold", { url: holdUrl("s2") }));
    await h.arrived.wait;
    const b = track(call("implicitFail", { n: 0 }));
    await settle();
    expect(b.done).toBe(false);
    h.release.open();
    expect(await a.promise).toEqual({ status: 200, body: 0 });
    expect(await b.promise).toEqual({ status: 200, body: 0 });
    expect(committed().acc).toEqual([500, 500]); // A committed first (110/100), then B overwrote
  }, EXECUTED_DB_TIMEOUT_MS);

  test("symptom 3: a read arriving mid-transaction never sees its uncommitted writes (was: dirty read of 999/999)", async () => {
    if (typeof globalThis.document !== "undefined") return;
    seed();
    const h = holdFor("s3");
    const a = track(call("boom", { n: 1, url: holdUrl("s3") }));
    await h.arrived.wait; // A has written 999/999, uncommitted
    const r = track(call("readBalances", {}));
    await settle();
    expect(r.done).toBe(false);
    h.release.open();
    await a.promise;
    const rr = await r.promise;
    expect(rr.status).toBe(200);
    expect(rr.body.map((x) => x.balance)).toEqual([10, 0]);
  }, EXECUTED_DB_TIMEOUT_MS);

  test("a stalled request upload holds NO transaction: other envelopes run while it waits", async () => {
    if (typeof globalThis.document !== "undefined") return;
    seed();
    // The body is read BEFORE the envelope opens — a slow client cannot hold the
    // database for everyone else.
    const stalled = callWithStalledBody("implicitFail", { n: 0 });
    await settle();
    expect(await call("implicitPropagate", { n: 7 })).toEqual({ status: 200, body: 7 });
    expect(committed().acc).toEqual([600, 600]);
    stalled.release();
    expect((await stalled.p).status).toBe(200);
    expect(committed().acc).toEqual([500, 500]);
  }, EXECUTED_DB_TIMEOUT_MS);
});

describe("S449 D — a `fail` exit rolls the implicit per-handler transaction back (§8.9.2)", () => {
  test("emitted: the envelope commits only a non-error result", () => {
    if (typeof globalThis.document !== "undefined") return;
    expect(serverJs).toContain('_scrml_result.__scrml_error === true) {\n    await _scrml_sql.unsafe("ROLLBACK");');
  });

  test("`fail` after two UPDATEs: the error reaches the caller AND both UPDATEs are reverted (was: committed)", async () => {
    if (typeof globalThis.document !== "undefined") return;
    seed();
    const r = await call("implicitFail", { n: 1 });
    expect(r.status).toBe(200);
    expect(r.body.__scrml_error).toBe(true);
    expect(r.body.variant).toBe("Rejected");
    expect(committed().acc).toEqual([10, 0]);
  }, EXECUTED_DB_TIMEOUT_MS);

  test("`?` propagating a callee's failure counts as a fail exit: reverted", async () => {
    if (typeof globalThis.document !== "undefined") return;
    seed();
    const r = await call("implicitPropagate", { n: 500 });
    expect(r.body.__scrml_error).toBe(true);
    expect(r.body.variant).toBe("TooBig");
    expect(committed().acc).toEqual([10, 0]);
  }, EXECUTED_DB_TIMEOUT_MS);

  test("successful completion still commits", async () => {
    if (typeof globalThis.document !== "undefined") return;
    seed();
    expect(await call("implicitFail", { n: 0 })).toEqual({ status: 200, body: 0 });
    expect(committed().acc).toEqual([500, 500]);
    expect(await call("implicitPropagate", { n: 7 })).toEqual({ status: 200, body: 7 });
    expect(committed().acc).toEqual([600, 600]);
  }, EXECUTED_DB_TIMEOUT_MS);

  test("after a fail exit the connection is free (no transaction left open)", async () => {
    if (typeof globalThis.document !== "undefined") return;
    seed();
    await call("implicitFail", { n: 1 });
    const db = new Database(dbPath);
    try {
      db.run("PRAGMA busy_timeout = 0");
      db.run("BEGIN IMMEDIATE");
      db.run("ROLLBACK");
    } finally {
      db.close();
    }
    expect(await call("plainWrite", { msg: "after" })).toEqual({ status: 200, body: 1 });
  }, EXECUTED_DB_TIMEOUT_MS);
});

describe("S449 C opt-in — `transactions=` on <program> (§19.10.6)", () => {
  function compileSrc(src) {
    const d = mkdtempSync(join(tmpdir(), "s449-txattr-"));
    try {
      const file = join(d, "app.scrml");
      writeFileSync(file, src);
      const r = compileScrml({ inputFiles: [file], outputDir: join(d, "out"), write: true, log: () => {} });
      const all = [...(r.errors ?? []), ...(r.warnings ?? [])];
      const serverPath = join(d, "out", "app.server.js");
      const js = existsSync(serverPath) ? readFileSync(serverPath, "utf8") : "";
      return {
        codes: all.map((e) => e.code),
        errors: (r.errors ?? []).filter((e) => !/^[WI]-/.test(e.code ?? "") && e.severity !== "warning"),
        serverJs: js,
      };
    } finally {
      try { rmSync(d, { recursive: true, force: true }); } catch { /* EBUSY */ }
    }
  }
  const prog = (db, attr) => `<program db="${db}"${attr}>
\${
  function f(n) {
    ?{\`INSERT INTO log (msg) VALUES (\${n})\`}.run()
    return 1
  }
}
<p>x</>
</program>`;

  test("`transactions=\"concurrent\"` on a SQLite database is E-SQL-010", () => {
    if (typeof globalThis.document !== "undefined") return;
    const r = compileSrc(prog("./x.db", ' transactions="concurrent"'));
    expect(r.errors.map((e) => e.code)).toContain("E-SQL-010");
  });

  test("on Postgres it compiles and selects the concurrent mode; the default is serialized", () => {
    if (typeof globalThis.document !== "undefined") return;
    const c = compileSrc(prog("postgres://u:p@localhost/x", ' transactions="concurrent"'));
    expect(c.errors).toEqual([]);
    expect(c.serverJs).toMatch(/_scrml_db_guard\(new SQL\("postgres:\/\/u:p@localhost\/x"\), "postgres", true\);/);
    const s = compileSrc(prog("postgres://u:p@localhost/x", ""));
    expect(s.serverJs).toMatch(/_scrml_db_guard\(new SQL\("postgres:\/\/u:p@localhost\/x"\), "postgres", false\);/);
    const e = compileSrc(prog("postgres://u:p@localhost/x", ' transactions="serialized"'));
    expect(e.serverJs).toMatch(/"postgres", false\);/);
  });

  test("an unrecognized value warns (W-ATTR-002) and keeps the safe default", () => {
    if (typeof globalThis.document !== "undefined") return;
    const r = compileSrc(prog("postgres://u:p@localhost/x", ' transactions="parallel"'));
    expect(r.codes).toContain("W-ATTR-002");
    expect(r.serverJs).toMatch(/"postgres", false\);/);
  });
});
