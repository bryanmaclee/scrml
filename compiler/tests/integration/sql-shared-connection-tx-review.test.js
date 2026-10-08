/**
 * S449 C — S239 review fix round (F1, F3, F5), EXECUTED through compiled handlers against
 * a real bun:sqlite file. (The live-Postgres twin of F3 is in sql-shared-connection-tx-pg.)
 *
 *   F1 — an SSE stream torn down mid-transaction (the client disconnects while the
 *        generator is between its BEGIN and COMMIT) used to keep the connection's lock
 *        forever: the generator's COMMIT never runs, and the request-end backstop
 *        exempted streams. Every later statement on the handle hung (a whole-app
 *        outage). The stream's `finally` now runs the backstop.
 *   F3 — a BEGIN issued while the request already owns a transaction (an implicit
 *        envelope calling a server function that does its own ?{BEGIN} … ?{COMMIT})
 *        is a SAVEPOINT: its COMMIT neither commits the envelope nor releases the
 *        connection, and a later `fail` still rolls everything back (§8.9.2). Before:
 *        SQLite threw "cannot start a transaction within a transaction"; Postgres
 *        committed the envelope at the inner COMMIT.
 *   F5 — WebSocket callbacks await their onserver handler (emitted-shape check; an
 *        onserver handler that calls a server function does not compile today —
 *        g-channel-onserver-handler-with-server-call-not-async).
 *
 * Interleaving is forced by a local HTTP server the generator awaits (`scrml:http`
 * `get`, auto-awaited) inside its transaction; the test reports arrival and releases it.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Database } from "bun:sqlite";

import { compileScrml } from "../../src/api.js";

const APP = (dbPath) => `<program db="${dbPath}">
<channel name="chat" topic="lobby" onserver:message=onChat(msg)>
  \${
    function onChat(msg) { broadcast({ body: msg }) }
  }
</>
\${
  import { get } from 'scrml:http'
  type E:enum = { Rejected }

  server function* stream(url) {
    ?{BEGIN}
    ?{\`UPDATE accounts SET balance = 555 WHERE id = 1\`}.run()
    const held = get(url)
    yield 1
    ?{\`UPDATE accounts SET balance = 556 WHERE id = 2\`}.run()
    ?{COMMIT}
  }

  server function innerTx(msg) {
    ?{BEGIN}
    ?{\`INSERT INTO log (msg) VALUES (\${msg})\`}.run()
    ?{COMMIT}
    return 1
  }

  // implicit envelope (two coalescing ?{} in a server ! fn) around a call to a server
  // function that runs its own explicit transaction
  server function outerFail(n)! -> E {
    ?{\`UPDATE accounts SET balance = 300 WHERE id = 1\`}.run()
    ?{\`UPDATE accounts SET balance = 200 WHERE id = 2\`}.run()
    const r = innerTx("inner")
    if (n > 0) { fail E::Rejected }
    return 0
  }

  // an explicit ?{BEGIN} with no COMMIT on its path
  server function leaveOpen(msg) {
    ?{BEGIN}
    ?{\`INSERT INTO log (msg) VALUES (\${msg})\`}.run()
    return 1
  }

  // the same, called inside an implicit envelope: the envelope's own COMMIT is
  // consumed as the nested savepoint's RELEASE, so the envelope is still open at the end
  server function envelopeLeak(n)! -> E {
    ?{\`UPDATE accounts SET balance = 300 WHERE id = 1\`}.run()
    ?{\`UPDATE accounts SET balance = 200 WHERE id = 2\`}.run()
    const r = leaveOpen("leaked")
    return 0
  }

  server function* streamLeak() {
    ?{BEGIN}
    ?{\`UPDATE accounts SET balance = 444 WHERE id = 1\`}.run()
    yield 1
  }

  function plainWrite(msg) {
    ?{\`INSERT INTO log (msg) VALUES (\${msg})\`}.run()
    return 1
  }
}
<p>x</>
</program>`;

let dir, dbPath, compileErrors, routes, serverJs, holdServer, appServer;
const holds = new Map();
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
  const acc = db.query("SELECT balance FROM accounts ORDER BY id").all().map((r) => r.balance);
  const log = db.query("SELECT msg FROM log ORDER BY id").all().map((r) => r.msg);
  db.close();
  return { acc, log };
}
const HEADERS = { "Cookie": "scrml_csrf=tok-r", "X-CSRF-Token": "tok-r", "Content-Type": "application/json" };
function routeFor(name) {
  const route = routes.find((r) => r.path.includes(`_${name}_`));
  expect(route).toBeTruthy();
  return route;
}
async function call(name, body) {
  const route = routeFor(name);
  try {
    const res = await route.handler(new Request(`http://localhost${route.path}`, { method: "POST", headers: HEADERS, body: JSON.stringify(body ?? {}) }));
    return { status: res.status, body: await res.json().catch(() => null) };
  } catch (e) {
    return { threw: String(e?.message ?? e) };
  }
}
/** Resolves to the value, or to "TIMED OUT" — a hang must fail the test, not stall the suite. */
const within = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r("TIMED OUT"), ms))]);

beforeAll(async () => {
  if (typeof globalThis.document !== "undefined") return;
  holdServer = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const h = holdFor(new URL(req.url).pathname.split("/").pop());
      h.arrived.open();
      await h.release.wait;
      return new Response("{}", { headers: { "Content-Type": "application/json" } });
    },
  });
  dir = mkdtempSync(join(tmpdir(), "s449-review-"));
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
  // the module's own WinterCG `fetch`, served over real HTTP: a thrown handler takes
  // the host's ordinary server-error path
  // `error()` mirrors the generated _server.js (build.js): every uncaught handler error
  // becomes a fixed 500.
  appServer = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: async (req) => (await mod.fetch(req)) ?? new Response("not found", { status: 404 }),
    error: () => new Response("Internal Server Error", { status: 500 }),
  });
});

async function httpCall(name, body) {
  const route = routeFor(name);
  const res = await fetch(`http://127.0.0.1:${appServer.port}${route.path}`, { method: "POST", headers: HEADERS, body: JSON.stringify(body ?? {}) });
  return { status: res.status, text: await res.text() };
}

afterAll(() => {
  try { holdServer?.stop(true); } catch { /* stopped */ }
  try { appServer?.stop(true); } catch { /* stopped */ }
  try { if (dir) rmSync(dir, { recursive: true, force: true }); } catch { /* EBUSY */ }
});

describe("S449 review fix round", () => {
  test("compiles clean", () => {
    if (typeof globalThis.document !== "undefined") return;
    expect(compileErrors.map((e) => e.code)).toEqual([]);
  });

  test("F1: an SSE stream torn down mid-transaction rolls back and frees the connection (was: every later statement hung)", async () => {
    if (typeof globalThis.document !== "undefined") return;
    seed();
    const errors = [];
    const origError = console.error;
    console.error = (...x) => { errors.push(x.map(String).join(" ")); };
    try {
      expect(serverJs).toContain("if (await _scrml_db_stream_end()) {");
      const h = holdFor("sse");
      const route = routeFor("stream");
      const res = await route.handler(new Request(`http://localhost${route.path}?url=${encodeURIComponent(holdUrl("sse"))}`));
      const reader = res.body.getReader();
      await h.arrived.wait; // the generator is inside its transaction (555 written, uncommitted)
      await reader.cancel(); // the client disconnects
      h.release.open(); // the generator reaches its next frame and is torn down there
      const w = await within(call("plainWrite", { msg: "after" }), 3000);
      expect(w).toEqual({ status: 200, body: 1 });
      expect(committed()).toEqual({ acc: [10, 0], log: ["after"] }); // the stream's write rolled back
      expect(errors.some((e) => e.includes("§19.10.6"))).toBe(true);
    } finally {
      console.error = origError;
    }
  });

  test("F1: a stream that completes commits normally (no backstop involvement)", async () => {
    if (typeof globalThis.document !== "undefined") return;
    seed();
    const h = holdFor("sse-ok");
    h.release.open();
    const route = routeFor("stream");
    const res = await route.handler(new Request(`http://localhost${route.path}?url=${encodeURIComponent(holdUrl("sse-ok"))}`));
    const text = await res.text();
    expect(text).toContain("data: 1");
    expect(committed().acc).toEqual([555, 556]);
    expect(await within(call("plainWrite", { msg: "x" }), 3000)).toEqual({ status: 200, body: 1 });
  });

  test("F3: an inner BEGIN/COMMIT inside the envelope is a savepoint — a later `fail` still rolls EVERYTHING back", async () => {
    if (typeof globalThis.document !== "undefined") return;
    seed();
    const r = await call("outerFail", { n: 1 });
    expect(r.body?.variant).toBe("Rejected"); // was: 500 "cannot start a transaction within a transaction"
    expect(committed()).toEqual({ acc: [10, 0], log: [] });
  });

  test("F3: success commits the envelope and the inner work together; the connection is free after", async () => {
    if (typeof globalThis.document !== "undefined") return;
    seed();
    expect(await call("outerFail", { n: 0 })).toEqual({ status: 200, body: 0 });
    expect(committed()).toEqual({ acc: [300, 200], log: ["inner"] });
    expect(await within(call("plainWrite", { msg: "y" }), 3000)).toEqual({ status: 200, body: 1 });
  });

  test("re-review nit 1: a handler that leaves its transaction open FAILS (HTTP 500) — never 200 with its writes rolled back", async () => {
    if (typeof globalThis.document !== "undefined") return;
    seed();
    const origError = console.error;
    console.error = () => {};
    try {
      const r = await httpCall("leaveOpen", { msg: "lost" });
      expect(r.status).toBe(500); // was: 200 "1", row rolled back
      expect(committed()).toEqual({ acc: [10, 0], log: [] });
      const e = await httpCall("envelopeLeak", { n: 0 });
      expect(e.status).toBe(500); // was: 200 "0", envelope + inner work rolled back
      expect(committed()).toEqual({ acc: [10, 0], log: [] });
    } finally {
      console.error = origError;
    }
    const ok = await httpCall("plainWrite", { msg: "clean" }); // a clean handler still answers 200
    expect(ok.status).toBe(200);
    expect(committed().log).toEqual(["clean"]);
  });

  test("re-review nit 1 (SSE): a stream that ends with its transaction open rolls back and sends a terminal `error` event", async () => {
    if (typeof globalThis.document !== "undefined") return;
    seed();
    const origError = console.error;
    console.error = () => {};
    try {
      const route = routeFor("streamLeak");
      const res = await route.handler(new Request(`http://localhost${route.path}`));
      expect(res.status).toBe(200); // a stream's status is fixed when it starts
      const text = await res.text();
      expect(text).toContain("data: 1");
      expect(text).toContain("event: error");
      expect(text).toContain("TransactionLeftOpen");
    } finally {
      console.error = origError;
    }
    expect(committed().acc).toEqual([10, 0]);
  });

  test("F5: WebSocket callbacks are async and await their onserver handler inside the request scope", () => {
    if (typeof globalThis.document !== "undefined") return;
    expect(serverJs).toContain("async message(ws, raw) {");
    // re-review nit 4: only a malformed frame (JSON.parse) is swallowed
    expect(serverJs).toContain("try { d = _scrml_g.JSON.parse(raw); } catch (_e) { return; }");
    expect(serverJs).not.toMatch(/instanceof (?:_scrml_g\.)?SyntaxError/);
    expect(serverJs).toContain("await onChat(msg);");
    expect(serverJs).toMatch(/_scrml_ws_handlers\[_scrml_ws_key\] = _scrml_db_request_scope\(_scrml_ws_handlers\[_scrml_ws_key\]\)/);
  });
});
