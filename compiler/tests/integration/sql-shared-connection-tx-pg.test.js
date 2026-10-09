/**
 * S449 ruling C on POSTGRES (§19.10.6) — LIVE, local-only (skipped when no Postgres
 * answers on /var/run/postgresql, or with SCRML_PGTEST=0; same probe as
 * db-authoritative-p2-pg.test.js).
 *
 * Before S449 every §8.9.2 implicit envelope on Postgres failed TWICE over: Bun
 * refuses `BEGIN` on a pooled handle (`ERR_POSTGRES_UNSAFE_TRANSACTION` — "Only use
 * sql.begin, sql.reserved or max: 1") and Postgres rejects `BEGIN DEFERRED`
 * (`syntax error at or near "DEFERRED"`). Now the envelope opens with `BEGIN` on a
 * connection reserved from the pool for that transaction.
 *
 *   - default (`serialized`): a second request's transaction WAITS for the first; a
 *     plain statement from another request goes to the pool and does NOT wait, and
 *     is not rolled back with the transaction;
 *   - opt-in `transactions="concurrent"` (ruled (b)): a second transaction does NOT
 *     wait — each runs on its own reserved connection.
 *
 * Interleaving is forced: request A's body, after its writes and inside its
 * transaction, awaits `get(url)` (`scrml:http`) on a local server the test holds — the
 * server reports A's arrival and answers only when released.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { SQL } from "bun";

import { compileScrml } from "../../src/api.js";

// Executed-DB tests (compile, then a real driver round-trip) and the hooks that build them
// declare their own budget: bun's 5 s default is too tight on the slow Windows CI runner
// (g-windows-executed-db-tests-5s-timeout-s460). Per test, never a raised global default.
const EXECUTED_DB_TIMEOUT_MS = 30_000;

const SOCK = "/var/run/postgresql";
const PG_USER = process.env.PGUSER || process.env.USER || "postgres";
const SUFFIX = `${process.pid}`;
const ROLE = `scrml_s449_tx_${SUFFIX}`;
const PW = "scrml_s449_pw";
const DB = `scrml_s449_tx_${SUFFIX}`;
const PG_URL = `postgres://${ROLE}:${PW}@localhost:5432/${DB}`;

let PG_OK = false;
if (process.env.SCRML_PGTEST !== "0" && existsSync(`${SOCK}/.s.PGSQL.5432`)) {
  const probe = new SQL({ path: SOCK, database: "postgres", username: PG_USER });
  PG_OK = await probe.unsafe("SELECT 1").then(() => true).catch(() => false);
  await probe.close().catch(() => {});
}
if (!PG_OK) {
  // eslint-disable-next-line no-console
  console.log(`[sql-shared-connection-tx-pg] Postgres not reachable on ${SOCK} — skipping the live §19.10.6 Postgres gate (local-only).`);
}
const d = PG_OK ? describe : describe.skip;

const APP = (attr) => `<program db="${PG_URL}"${attr}>
\${
  import { get } from 'scrml:http'
  type E:enum = { Rejected }

  server function boom(n, url)! -> E {
    ?{\`UPDATE accounts SET balance = balance + 1 WHERE id = 1\`}.run()
    ?{\`UPDATE accounts SET balance = balance + 1 WHERE id = 2\`}.run()
    const held = get(url)
    ?{\`INSERT INTO accounts (id, balance) VALUES (\${n}, 0)\`}.run()
    return 0
  }

  server function hold(url)! -> E {
    ?{\`UPDATE accounts SET balance = balance + 100 WHERE id = 1\`}.run()
    const held = get(url)
    ?{\`UPDATE accounts SET balance = balance + 100 WHERE id = 2\`}.run()
    return 0
  }

  server function implicitFail(n)! -> E {
    ?{\`UPDATE accounts SET balance = balance + 100 WHERE id = 1\`}.run()
    ?{\`UPDATE accounts SET balance = balance + 100 WHERE id = 2\`}.run()
    if (n > 0) { fail E::Rejected }
    return 0
  }

  // a transaction on rows DISJOINT from accounts: Postgres row locks never make it wait,
  // so any waiting it does is the handle's transaction mutex
  server function logTwice(msg)! -> E {
    ?{\`INSERT INTO log (msg) VALUES (\${msg})\`}.run()
    ?{\`INSERT INTO log (msg) VALUES (\${msg})\`}.run()
    return 0
  }

  server function innerTx(msg) {
    ?{BEGIN}
    ?{\`INSERT INTO log (msg) VALUES (\${msg})\`}.run()
    ?{COMMIT}
    return 1
  }

  // an implicit envelope around a server function with its own ?{BEGIN} … ?{COMMIT}
  server function outerFail(n)! -> E {
    ?{\`UPDATE accounts SET balance = 300 WHERE id = 1\`}.run()
    ?{\`UPDATE accounts SET balance = 200 WHERE id = 2\`}.run()
    const r = innerTx("inner")
    if (n > 0) { fail E::Rejected }
    return 0
  }

  function plainWrite(msg) {
    ?{\`INSERT INTO log (msg) VALUES (\${msg})\`}.run()
    return 1
  }
}
<p>x</>
</program>`;

const HEADERS = { "Cookie": "scrml_csrf=tok", "X-CSRF-Token": "tok", "Content-Type": "application/json" };
let dir, admin, check, serialized, concurrent, holdServer;

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

async function load(name, attr) {
  const file = join(dir, `${name}.scrml`);
  writeFileSync(file, APP(attr));
  const out = join(dir, `out-${name}`);
  const r = compileScrml({ inputFiles: [file], outputDir: out, write: true, log: () => {} });
  const errs = (r.errors ?? []).filter((e) => !/^[WI]-/.test(e.code ?? "") && e.severity !== "warning");
  expect(errs.map((e) => e.code)).toEqual([]);
  const serverPath = join(out, `${name}.server.js`);
  const js = readFileSync(serverPath, "utf8");
  // close the module's pool when done
  writeFileSync(serverPath, js + "\nexport const __closeSql = () => _scrml_sql.close();\n");
  const mod = await import(`file://${serverPath}?v=${Date.now()}`);
  return { js, routes: mod.routes, close: mod.__closeSql };
}

function routeOf(app, name) {
  const r = app.routes.find((x) => x.path.includes(`_${name}_`));
  expect(r).toBeTruthy();
  return r;
}

async function call(app, name, body) {
  const route = routeOf(app, name);
  try {
    const res = await route.handler(new Request(`http://localhost${route.path}`, { method: "POST", headers: HEADERS, body: JSON.stringify(body) }));
    return { status: res.status, body: await res.json().catch(() => null) };
  } catch (e) {
    return { threw: String(e?.message ?? e) };
  }
}

function track(p) {
  const t = { done: false };
  t.promise = p.then((v) => { t.done = true; t.value = v; return v; });
  return t;
}
const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms));

async function seed() {
  await check.unsafe("DELETE FROM log");
  await check.unsafe("DELETE FROM accounts");
  await check.unsafe("INSERT INTO accounts (id, balance) VALUES (1, 10), (2, 0)");
}
async function committed() {
  const acc = (await check.unsafe("SELECT balance FROM accounts ORDER BY id")).map((r) => r.balance);
  const log = (await check.unsafe("SELECT msg FROM log ORDER BY id")).map((r) => r.msg);
  return { acc, log };
}

d("§19.10.6 on Postgres — reserved connection per transaction (live)", () => {
  beforeAll(async () => {
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
    admin = new SQL({ path: SOCK, database: "postgres", username: PG_USER });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB}`).catch(() => {});
    await admin.unsafe(`DROP ROLE IF EXISTS ${ROLE}`).catch(() => {});
    await admin.unsafe(`CREATE ROLE ${ROLE} LOGIN PASSWORD '${PW}'`);
    await admin.unsafe(`CREATE DATABASE ${DB} OWNER ${ROLE}`);
    check = new SQL(PG_URL);
    await check.unsafe("CREATE TABLE accounts (id integer PRIMARY KEY, balance integer NOT NULL)");
    await check.unsafe("CREATE TABLE log (id serial PRIMARY KEY, msg text)");
    dir = mkdtempSync(join(tmpdir(), "s449-pg-tx-"));
    serialized = await load("serialized", "");
    concurrent = await load("concurrent", ' transactions="concurrent"');
  }, EXECUTED_DB_TIMEOUT_MS);

  afterAll(async () => {
    try { holdServer?.stop(true); } catch { /* stopped */ }
    for (const a of [serialized, concurrent]) { try { await a?.close(); } catch { /* closed */ } }
    try { await check?.close(); } catch { /* closed */ }
    try {
      await admin.unsafe(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
      await admin.unsafe(`DROP ROLE IF EXISTS ${ROLE}`);
      await admin.close();
    } catch { /* best effort */ }
    try { if (dir) rmSync(dir, { recursive: true, force: true }); } catch { /* EBUSY */ }
  });

  test("emitted: plain `BEGIN` (never `BEGIN DEFERRED`), the handle guarded with the right mode", () => {
    expect(serialized.js).toContain('await _scrml_sql.unsafe("BEGIN");');
    expect(serialized.js).not.toContain("BEGIN DEFERRED");
    expect(serialized.js).toMatch(/_scrml_db_guard\(new SQL\(".*"\), "postgres", false\);/);
    expect(concurrent.js).toMatch(/_scrml_db_guard\(new SQL\(".*"\), "postgres", true\);/);
  });

  test("the implicit envelope COMMITS on success (was: ERR_POSTGRES_UNSAFE_TRANSACTION at BEGIN)", async () => {
    await seed();
    expect(await call(serialized, "implicitFail", { n: 0 })).toEqual({ status: 200, body: 0 });
    expect((await committed()).acc).toEqual([110, 100]);
  }, EXECUTED_DB_TIMEOUT_MS);

  test("D on Postgres: a `fail` exit rolls the envelope back", async () => {
    await seed();
    const r = await call(serialized, "implicitFail", { n: 1 });
    expect(r.body.variant).toBe("Rejected");
    expect((await committed()).acc).toEqual([10, 0]);
  }, EXECUTED_DB_TIMEOUT_MS);

  test("S449 review F3: an inner BEGIN/COMMIT nests as a savepoint — a later `fail` rolls the whole envelope back (was: persisted [300, 200])", async () => {
    await seed();
    const r = await call(serialized, "outerFail", { n: 1 });
    expect(r.body?.variant).toBe("Rejected");
    expect(await committed()).toEqual({ acc: [10, 0], log: [] });
    // success commits envelope + inner work; the reservation is returned (a second
    // transaction runs at once rather than queueing behind a leaked one)
    expect(await call(serialized, "outerFail", { n: 0 })).toEqual({ status: 200, body: 0 });
    expect(await committed()).toEqual({ acc: [300, 200], log: ["inner"] });
    expect(await call(serialized, "implicitFail", { n: 0 })).toEqual({ status: 200, body: 0 });
  }, EXECUTED_DB_TIMEOUT_MS);

  test("serialized: a plain write from another request does NOT wait and survives the transaction's ROLLBACK", async () => {
    await seed();
    const h = holdFor("p1");
    const a = track(call(serialized, "boom", { n: 1, url: holdUrl("p1") })); // PK violation -> ROLLBACK
    await h.arrived.wait; // A has written, parked inside its transaction
    const b = await call(serialized, "plainWrite", { msg: "pool" }); // completes while A is open
    expect(b).toEqual({ status: 200, body: 1 });
    expect((await committed()).acc).toEqual([10, 0]); // A's writes are invisible to others
    h.release.open();
    await a.promise;
    expect(await committed()).toEqual({ acc: [10, 0], log: ["pool"] });
  }, EXECUTED_DB_TIMEOUT_MS);

  test("serialized: a second transaction WAITS for the first", async () => {
    await seed();
    const h = holdFor("p2");
    const a = track(call(serialized, "hold", { url: holdUrl("p2") }));
    await h.arrived.wait;
    const b = track(call(serialized, "logTwice", { msg: "b" })); // disjoint rows: only the mutex can hold it
    await settle();
    expect(b.done).toBe(false);
    h.release.open();
    expect((await a.promise).status).toBe(200);
    expect((await b.promise).status).toBe(200);
    expect(await committed()).toEqual({ acc: [110, 100], log: ["b", "b"] });
  }, EXECUTED_DB_TIMEOUT_MS);

  test("opt-in transactions=\"concurrent\": a second transaction does NOT wait", async () => {
    await seed();
    const h = holdFor("p3");
    const a = track(call(concurrent, "hold", { url: holdUrl("p3") }));
    await h.arrived.wait; // A holds its own connection, mid-transaction
    const b = await call(concurrent, "logTwice", { msg: "b" }); // own reserved connection: runs now
    expect(b).toEqual({ status: 200, body: 0 });
    expect(await committed()).toEqual({ acc: [10, 0], log: ["b", "b"] }); // B committed while A is open
    h.release.open();
    expect((await a.promise).status).toBe(200);
    expect(await committed()).toEqual({ acc: [110, 100], log: ["b", "b"] });
  }, EXECUTED_DB_TIMEOUT_MS);
});
