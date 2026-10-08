/**
 * §19.10.6 (S449 ruling C) — the per-connection transaction mutex runtime
 * (`codegen/sql-tx-guard.ts`), EXECUTED.
 *
 * The emitted helper text is evaluated as-is and driven against a REAL Bun.SQL
 * SQLite file (the deploy engine) or, for the pooled (Postgres / MySQL) paths, a
 * recording fake pool. Every interleaving is forced with explicit latches — never
 * timing luck: a "still waiting" assertion is a race against an idle event loop that
 * nothing else can advance.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { SQL } from "bun";
import { Database } from "bun:sqlite";

import { SQL_TX_GUARD_HELPER_LINES, guardHandleExpr, requestScopeLines } from "../../src/codegen/sql-tx-guard.ts";

/** Evaluate the emitted runtime exactly as a server module carries it. */
function loadRuntime() {
  const src = SQL_TX_GUARD_HELPER_LINES.join("\n");
  // The runtime must stay import-free + top-level-await-free (the conformance
  // adapter evaluates server modules with `new Function`).
  expect(src).not.toMatch(/^\s*import\s/m);
  expect(src).not.toMatch(/\b_scrml_sql(?:_\d+)?\b/);
  // …and free of the bare `undefined` keyword (W-CG-UNDEFINED-INTERPOLATION scans
  // every emitted server module; scrml absence is `null`, §42.8).
  expect(src).not.toMatch(/\bundefined\b/);
  // eslint-disable-next-line no-new-func
  // `_scrml_g`: the bundle's host-global alias (S457 2a) the runtime reads through.
  return new Function(`const _scrml_g = globalThis;\n${src}\nreturn { _scrml_db_guard, _scrml_db_request_scope, _scrml_db_tx_kind, _scrml_db_savepoint_name, _scrml_db_stream_end, _scrml_db_scope_als };`)();
}

const rt = loadRuntime();

/** A promise plus its resolver. */
function latch() {
  let open;
  const p = new Promise((r) => { open = r; });
  return { wait: p, open };
}

/** Let the event loop go idle: anything not blocked on a latch has settled. */
const settle = (ms = 25) => new Promise((r) => setTimeout(r, ms));

/** Track whether a promise has settled, without awaiting it. */
function track(p) {
  const t = { done: false, value: undefined, error: undefined };
  t.promise = p.then((v) => { t.done = true; t.value = v; return v; }, (e) => { t.done = true; t.error = e; });
  return t;
}

/** Run `fn` as a request: the scope the compiled route handlers run in. */
const asRequest = (fn) => rt._scrml_db_request_scope(fn)();

describe("§19.10.6 — statement classification", () => {
  test("BEGIN / START TRANSACTION open; COMMIT / END / ROLLBACK / ABORT close; ROLLBACK TO does not", () => {
    expect(rt._scrml_db_tx_kind("BEGIN")).toBe("begin");
    expect(rt._scrml_db_tx_kind("  begin deferred")).toBe("begin");
    expect(rt._scrml_db_tx_kind("BEGIN IMMEDIATE")).toBe("begin");
    expect(rt._scrml_db_tx_kind("START TRANSACTION")).toBe("begin");
    expect(rt._scrml_db_tx_kind("COMMIT")).toBe("commit");
    expect(rt._scrml_db_tx_kind("END TRANSACTION")).toBe("commit");
    expect(rt._scrml_db_tx_kind("ROLLBACK")).toBe("rollback");
    expect(rt._scrml_db_tx_kind("abort")).toBe("rollback");
    expect(rt._scrml_db_tx_kind("ROLLBACK TO SAVEPOINT sp1")).toBe("rollback-to");
    expect(rt._scrml_db_tx_kind("ROLLBACK TRANSACTION TO sp1")).toBe("rollback-to");
    expect(rt._scrml_db_tx_kind("SAVEPOINT sp1")).toBe("savepoint");
    expect(rt._scrml_db_tx_kind("RELEASE SAVEPOINT sp1")).toBe("release");
    expect(rt._scrml_db_tx_kind("release sp1")).toBe("release");
    expect(rt._scrml_db_tx_kind("SELECT 1")).toBe(null);
    expect(rt._scrml_db_tx_kind("BEGINNING")).toBe(null);
    expect(rt._scrml_db_tx_kind(undefined)).toBe(null);
  });

  test("S449 review F2: leading comments are skipped; AND CHAIN is not an end", () => {
    expect(rt._scrml_db_tx_kind("/* c */ BEGIN")).toBe("begin");
    expect(rt._scrml_db_tx_kind("-- note\nBEGIN IMMEDIATE")).toBe("begin");
    expect(rt._scrml_db_tx_kind("  /* a */ -- b\n /* c */ COMMIT")).toBe("commit");
    expect(rt._scrml_db_tx_kind("/* unterminated BEGIN")).toBe(null);
    expect(rt._scrml_db_tx_kind("COMMIT AND CHAIN")).toBe("chain");
    expect(rt._scrml_db_tx_kind("ROLLBACK AND CHAIN")).toBe("chain");
    expect(rt._scrml_db_tx_kind("COMMIT AND NO CHAIN")).toBe("commit");
    expect(rt._scrml_db_savepoint_name("savepoint a1")).toBe("A1");
    expect(rt._scrml_db_savepoint_name("RELEASE SAVEPOINT \"a1\"")).toBe("A1");
    expect(rt._scrml_db_savepoint_name("RELEASE a1")).toBe("A1");
  });

  test("the declaration stays one line and names the driver + mode", () => {
    expect(guardHandleExpr('new SQL("sqlite:a.db")', "sqlite", false))
      .toBe('_scrml_db_guard(new SQL("sqlite:a.db"), "sqlite", false)');
    expect(guardHandleExpr('new SQL("postgres://h/d")', "postgres", true))
      .toBe('_scrml_db_guard(new SQL("postgres://h/d"), "postgres", true)');
  });

  test("request-scope installation wraps every named route + the WebSocket callbacks", () => {
    expect(requestScopeLines([], false)).toEqual([]);
    const lines = requestScopeLines(["__ri_route_a_1", "_scrml_route_b"], true).join("\n");
    expect(lines).toContain("[__ri_route_a_1, _scrml_route_b]");
    expect(lines).toContain("_scrml_route.handler = _scrml_db_request_scope(_scrml_route.handler)");
    expect(lines).toContain("_scrml_ws_handlers[_scrml_ws_key]");
  });
});

describe("§19.10.6 — SQLite: one transaction per connection, against a REAL Bun.SQL file", () => {
  let dir, dbPath, raw, sql;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "s449-guard-"));
    dbPath = join(dir, "t.db");
    const d = new Database(dbPath, { create: true });
    d.run("CREATE TABLE acc (id INTEGER PRIMARY KEY, bal INTEGER NOT NULL)");
    d.run("INSERT INTO acc (id, bal) VALUES (1, 10), (2, 0)");
    d.run("CREATE TABLE log (id INTEGER PRIMARY KEY, msg TEXT)");
    d.close();
    raw = new SQL({ adapter: "sqlite", filename: dbPath, create: false, readwrite: true });
    sql = rt._scrml_db_guard(raw, "sqlite", false);
  });

  afterEach(async () => {
    try { await raw.close(); } catch { /* closed */ }
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* EBUSY on Windows */ }
  });

  const committed = () => {
    const d = new Database(dbPath, { readonly: true });
    const acc = d.query("SELECT id, bal FROM acc ORDER BY id").all();
    const log = d.query("SELECT msg FROM log ORDER BY id").all().map((r) => r.msg);
    d.close();
    return { acc, log };
  };

  test("a plain write from another request WAITS for an open transaction and survives its ROLLBACK (was: lost)", async () => {
    const inTx = latch();
    const finishTx = latch();
    const a = track(asRequest(async () => {
      await sql.unsafe("BEGIN DEFERRED");
      await sql`UPDATE acc SET bal = bal + 1 WHERE id = 1`;
      inTx.open();
      await finishTx.wait;
      await sql.unsafe("ROLLBACK");
      return "a";
    }));
    await inTx.wait;
    const b = track(asRequest(async () => {
      await sql`INSERT INTO log (msg) VALUES (${"b"})`;
      return "b";
    }));
    await settle();
    expect(b.done).toBe(false); // waiting — NOT running inside A's transaction
    finishTx.open();
    await a.promise;
    await b.promise;
    expect(b.value).toBe("b");
    expect(committed()).toEqual({ acc: [{ id: 1, bal: 10 }, { id: 2, bal: 0 }], log: ["b"] });
  });

  test("a plain read from another request never sees uncommitted rows (was: dirty read)", async () => {
    const inTx = latch();
    const finishTx = latch();
    const a = track(asRequest(async () => {
      await sql.unsafe("BEGIN");
      await sql`UPDATE acc SET bal = 999`;
      inTx.open();
      await finishTx.wait;
      await sql.unsafe("ROLLBACK");
    }));
    await inTx.wait;
    const read = track(asRequest(async () => sql`SELECT id, bal FROM acc ORDER BY id`));
    await settle();
    expect(read.done).toBe(false);
    finishTx.open();
    await a.promise;
    await read.promise;
    expect(read.value.map((r) => r.bal)).toEqual([10, 0]);
  });

  test("two concurrent transactions run one after the other (was: `cannot start a transaction within a transaction`)", async () => {
    const order = [];
    const aIn = latch();
    const aGo = latch();
    const a = track(asRequest(async () => {
      await sql.unsafe("BEGIN DEFERRED");
      order.push("a:begin");
      aIn.open();
      await aGo.wait;
      await sql`UPDATE acc SET bal = bal + 5 WHERE id = 1`;
      await sql.unsafe("COMMIT");
      order.push("a:commit");
    }));
    await aIn.wait;
    const b = track(asRequest(async () => {
      await sql.unsafe("BEGIN DEFERRED");
      order.push("b:begin");
      await sql`UPDATE acc SET bal = bal + 7 WHERE id = 1`;
      await sql.unsafe("COMMIT");
      order.push("b:commit");
    }));
    await settle();
    expect(b.done).toBe(false);
    aGo.open();
    await a.promise;
    await b.promise;
    expect(a.error).toBeUndefined();
    expect(b.error).toBeUndefined();
    expect(order).toEqual(["a:begin", "a:commit", "b:begin", "b:commit"]);
    expect(committed().acc[0].bal).toBe(22);
  });

  test("re-entrant: the owning request's own statements (incl. a called server function) run inside its transaction without waiting", async () => {
    const peerServerFn = async (msg) => { await sql`INSERT INTO log (msg) VALUES (${msg})`; };
    const r = await asRequest(async () => {
      await sql.unsafe("BEGIN");
      await sql`UPDATE acc SET bal = 1 WHERE id = 1`;
      await peerServerFn("inside");
      const seen = await sql`SELECT bal FROM acc WHERE id = 1`;
      await sql.unsafe("ROLLBACK");
      return seen[0].bal;
    });
    expect(r).toBe(1); // read its own uncommitted write
    expect(committed()).toEqual({ acc: [{ id: 1, bal: 10 }, { id: 2, bal: 0 }], log: [] }); // all rolled back together
  });

  test("FIFO: waiters are served in arrival order", async () => {
    const order = [];
    const hold = latch();
    const inTx = latch();
    const a = asRequest(async () => {
      await sql.unsafe("BEGIN");
      inTx.open();
      await hold.wait;
      await sql.unsafe("COMMIT");
      order.push("tx");
    });
    await inTx.wait;
    const ws = [1, 2, 3, 4].map((i) => asRequest(async () => {
      await sql`INSERT INTO log (msg) VALUES (${String(i)})`;
      order.push(i);
    }));
    await settle();
    expect(order).toEqual([]);
    hold.open();
    await Promise.all([a, ...ws]);
    expect(order).toEqual(["tx", 1, 2, 3, 4]);
    expect(committed().log).toEqual(["1", "2", "3", "4"]);
  });

  test("a failed BEGIN releases the connection", async () => {
    // a malformed BEGIN fails at the database: the lock must come back
    await expect(asRequest(async () => { await sql.unsafe("BEGIN NONSENSE"); })).rejects.toThrow();
    const after = await asRequest(async () => sql`SELECT COUNT(*) AS n FROM acc`);
    expect(after[0].n).toBe(2);
  });

  test("backstop: a request that ends with its transaction open is rolled back, FAILS (never acks success), and frees the connection", async () => {
    const errors = [];
    const origError = console.error;
    console.error = (...a) => { errors.push(a.join(" ")); };
    try {
      // S449 re-review nit 1 (ack-then-rollback): the handler's own success value must
      // not reach the client once its writes were rolled back.
      await expect(asRequest(async () => {
        await sql.unsafe("BEGIN");
        await sql`UPDATE acc SET bal = 555 WHERE id = 1`;
        return "forgot to commit";
      })).rejects.toThrow(/still open.*rolled back.*failed/);
      // a clean handler keeps its value
      expect(await asRequest(async () => "clean")).toBe("clean");
    } finally {
      console.error = origError;
    }
    expect(errors.some((e) => e.includes("§19.10.6"))).toBe(true);
    expect(committed().acc[0].bal).toBe(10);
    // the connection is free: a fresh transaction runs at once
    await asRequest(async () => {
      await sql.unsafe("BEGIN");
      await sql`UPDATE acc SET bal = 11 WHERE id = 1`;
      await sql.unsafe("COMMIT");
    });
    expect(committed().acc[0].bal).toBe(11);
  });

  test("backstop on a THROWN handler: rolled back, freed, error still propagates", async () => {
    const origError = console.error;
    console.error = () => {};
    try {
      await expect(asRequest(async () => {
        await sql.unsafe("BEGIN");
        await sql`UPDATE acc SET bal = 777 WHERE id = 1`;
        throw new Error("boom");
      })).rejects.toThrow("boom");
    } finally {
      console.error = origError;
    }
    expect(committed().acc[0].bal).toBe(10);
    const n = await asRequest(async () => sql`SELECT COUNT(*) AS n FROM log`);
    expect(n[0].n).toBe(0);
  });

  test("a streamed (SSE) response keeps its transaction past the handler's return", async () => {
    const streamDone = latch();
    const res = await asRequest(async () => {
      await sql.unsafe("BEGIN");
      void (async () => {
        await sql`UPDATE acc SET bal = 42 WHERE id = 1`;
        await sql.unsafe("COMMIT");
        streamDone.open();
      })();
      return new Response("", { headers: { "Content-Type": "text/event-stream" } });
    });
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    await streamDone.wait;
    expect(committed().acc[0].bal).toBe(42);
  });

  test("a synchronous handler stays synchronous (WebSocket upgrade contract)", () => {
    const wrapped = rt._scrml_db_request_scope(() => undefined);
    expect(wrapped()).toBe(undefined);
    const wrapped2 = rt._scrml_db_request_scope(function () { return this; });
    const self = {};
    expect(wrapped2.call(self)).toBe(self);
  });

  test("Bun callback transaction (`begin(cb)`) holds the lock; nested inside a transaction it becomes a savepoint", async () => {
    // not held: a callback transaction on SQLite takes the mutex for its duration
    const inCb = latch();
    const go = latch();
    const a = track(asRequest(() => sql.begin(async (tx) => {
      await tx`UPDATE acc SET bal = 1 WHERE id = 1`;
      inCb.open();
      await go.wait;
    })));
    await inCb.wait;
    const b = track(asRequest(async () => sql`SELECT bal FROM acc WHERE id = 1`));
    await settle();
    expect(b.done).toBe(false);
    go.open();
    await a.promise;
    await b.promise;
    expect(b.value[0].bal).toBe(1);

    // held: nests as a savepoint on the transaction's connection
    await asRequest(async () => {
      await sql.unsafe("BEGIN");
      await sql`UPDATE acc SET bal = 2 WHERE id = 1`;
      await expect(sql.begin(async (tx) => {
        await tx`UPDATE acc SET bal = 3 WHERE id = 1`;
        throw new Error("inner");
      })).rejects.toThrow("inner");
      const mid = await sql`SELECT bal FROM acc WHERE id = 1`;
      expect(mid[0].bal).toBe(2); // the savepoint rolled back only the inner write
      await sql.unsafe("COMMIT");
    });
    expect(committed().acc[0].bal).toBe(2);
  });

  test("code outside any request shares one scope (unchanged among itself); requests stay isolated from it", async () => {
    await sql.unsafe("BEGIN");
    await sql`UPDATE acc SET bal = 300 WHERE id = 1`;
    const r = track(asRequest(async () => sql`SELECT bal FROM acc WHERE id = 1`));
    await settle();
    expect(r.done).toBe(false); // a request never runs inside the unscoped transaction
    const own = await sql`SELECT bal FROM acc WHERE id = 1`; // the unscoped code sees its own write
    expect(own[0].bal).toBe(300);
    await sql.unsafe("ROLLBACK");
    await r.promise;
    expect(r.value[0].bal).toBe(10);
  });
  test("S449 review F3: a BEGIN inside the request's open transaction nests — its COMMIT does not commit the outer one", async () => {
    await asRequest(async () => {
      await sql.unsafe("BEGIN");
      await sql`UPDATE acc SET bal = 300 WHERE id = 1`;
      await sql.unsafe("BEGIN"); // was: SQLite "cannot start a transaction within a transaction"
      await sql`UPDATE acc SET bal = 200 WHERE id = 2`;
      await sql.unsafe("COMMIT"); // inner: RELEASE SAVEPOINT, the outer stays open
      await sql.unsafe("ROLLBACK"); // outer: undoes BOTH
    });
    expect(committed().acc).toEqual([{ id: 1, bal: 10 }, { id: 2, bal: 0 }]);
    // inner ROLLBACK undoes only the inner work; the outer COMMIT keeps the rest
    await asRequest(async () => {
      await sql.unsafe("BEGIN");
      await sql`UPDATE acc SET bal = 11 WHERE id = 1`;
      await sql.unsafe("BEGIN");
      await sql`UPDATE acc SET bal = 99 WHERE id = 2`;
      await sql.unsafe("ROLLBACK");
      await sql.unsafe("COMMIT");
    });
    expect(committed().acc).toEqual([{ id: 1, bal: 11 }, { id: 2, bal: 0 }]);
    // and the connection is free afterwards
    const n = await asRequest(async () => sql`SELECT COUNT(*) AS n FROM acc`);
    expect(n[0].n).toBe(2);
  });

  for (const [label, beginSql] of [["/* c */ BEGIN", "/* c */ BEGIN"], ["-- c\\nBEGIN", "-- c\nBEGIN"]]) {
    test(`S449 review F2: a commented ${label} still takes the lock (was: classified as a plain statement)`, async () => {
      const inTx = latch();
      const finishTx = latch();
      const a = track(asRequest(async () => {
        await sql.unsafe(beginSql);
        await sql`UPDATE acc SET bal = 999 WHERE id = 1`;
        inTx.open();
        await finishTx.wait;
        await sql.unsafe("/* done */ ROLLBACK");
      }));
      await inTx.wait;
      const b = track(asRequest(async () => { await sql`INSERT INTO log (msg) VALUES (${"kept"})`; }));
      await settle();
      expect(b.done).toBe(false);
      finishTx.open();
      await a.promise;
      await b.promise;
      expect(committed()).toEqual({ acc: [{ id: 1, bal: 10 }, { id: 2, bal: 0 }], log: ["kept"] });
    });
  }

  test("S449 review F2: SAVEPOINT with no transaction open (SQLite opens one) takes the lock; its RELEASE ends it", async () => {
    const inTx = latch();
    const finishTx = latch();
    const errors = [];
    const origError = console.error;
    console.error = (...x) => { errors.push(x.join(" ")); };
    try {
      const a = track(asRequest(async () => {
        await sql.unsafe("SAVEPOINT outer1");
        await sql`UPDATE acc SET bal = 50 WHERE id = 1`;
        inTx.open();
        await finishTx.wait;
        await sql.unsafe("RELEASE SAVEPOINT outer1");
        return "done";
      }));
      await inTx.wait;
      const b = track(asRequest(async () => sql`SELECT bal FROM acc WHERE id = 1`));
      await settle();
      expect(b.done).toBe(false); // waits: never reads the uncommitted 50
      finishTx.open();
      await a.promise;
      await b.promise;
      expect(b.value[0].bal).toBe(50); // read after the RELEASE committed it
    } finally {
      console.error = origError;
    }
    expect(errors).toEqual([]); // released by RELEASE, not by the request-end backstop
  });

  test("S449 review F2: a commented COMMIT releases at once (no false 'left open' at request end)", async () => {
    const errors = [];
    const origError = console.error;
    console.error = (...x) => { errors.push(x.join(" ")); };
    try {
      await asRequest(async () => {
        await sql.unsafe("BEGIN");
        await sql`UPDATE acc SET bal = 12 WHERE id = 1`;
        await sql.unsafe("/* done */ COMMIT");
      });
    } finally {
      console.error = origError;
    }
    expect(errors).toEqual([]);
    expect(committed().acc[0].bal).toBe(12);
  });

  test("S449 review F5: an async WebSocket callback that AWAITS its handler is covered by the backstop", async () => {
    const origError = console.error;
    console.error = () => {};
    try {
      const onserverHandler = async () => {
        await sql.unsafe("BEGIN");
        await sql`UPDATE acc SET bal = 321 WHERE id = 1`; // and never commits
      };
      const message = rt._scrml_db_request_scope(async function message() { await onserverHandler(); });
      await expect(message.call({})).rejects.toThrow(/still open/);
    } finally {
      console.error = origError;
    }
    expect(committed().acc[0].bal).toBe(10);
    const n = await asRequest(async () => sql`SELECT COUNT(*) AS n FROM acc`);
    expect(n[0].n).toBe(2);
  });

  test("S449 review F1: _scrml_db_stream_end rolls back a stream scope's open transaction and frees the connection", async () => {
    const origError = console.error;
    console.error = () => {};
    try {
      await asRequest(async () => {
        await sql.unsafe("BEGIN");
        await sql`UPDATE acc SET bal = 777 WHERE id = 1`;
        expect(await rt._scrml_db_stream_end()).toBe(true); // what the SSE stream's finally runs
        expect(await rt._scrml_db_stream_end()).toBe(false); // nothing left to roll back
      });
    } finally {
      console.error = origError;
    }
    expect(committed().acc[0].bal).toBe(10);
    const n = await asRequest(async () => sql`SELECT COUNT(*) AS n FROM acc`);
    expect(n[0].n).toBe(2);
  });
});

describe("§19.10.6 — pooled drivers (Postgres / MySQL): a reserved connection per transaction", () => {
  /** A recording fake Bun.SQL pool: tagged calls + unsafe + reserve()/release(). */
  function fakePool() {
    const log = [];
    let n = 0;
    const mk = (name) => {
      const conn = (strings, ...values) => { log.push(`${name}: ${strings.join("?")}`); return Promise.resolve([]); };
      conn.unsafe = (text) => { log.push(`${name}: ${text}`); return Promise.resolve([]); };
      return conn;
    };
    const pool = mk("pool");
    pool.reserve = async () => {
      const name = `r${++n}`;
      const c = mk(name);
      c.release = () => { log.push(`${name}: <release>`); };
      log.push(`${name}: <reserve>`);
      return c;
    };
    pool.begin = async (cb) => { log.push("pool: <begin cb>"); return cb(mk("bun-tx")); };
    return { pool, log };
  }

  test("default (serialized): BEGIN reserves a connection; the owner's statements go to it; other requests go to the pool without waiting; transactions queue", async () => {
    const { pool, log } = fakePool();
    const sql = rt._scrml_db_guard(pool, "postgres", false);
    const aIn = latch();
    const aGo = latch();
    const a = track(asRequest(async () => {
      await sql.unsafe("BEGIN");
      await sql`UPDATE t SET x = ${1}`;
      aIn.open();
      await aGo.wait;
      await sql.unsafe("COMMIT");
    }));
    await aIn.wait;
    // a plain statement from another request: straight to the pool, no waiting
    await asRequest(async () => { await sql`SELECT 1`; });
    // a second transaction: serialized behind A
    const b = track(asRequest(async () => {
      await sql.unsafe("BEGIN");
      await sql.unsafe("COMMIT");
    }));
    await settle();
    expect(b.done).toBe(false);
    aGo.open();
    await a.promise;
    await b.promise;
    expect(log).toEqual([
      "r1: <reserve>",
      "r1: BEGIN",
      "r1: UPDATE t SET x = ?",
      "pool: SELECT 1",
      "r1: COMMIT",
      "r1: <release>",
      "r2: <reserve>",
      "r2: BEGIN",
      "r2: COMMIT",
      "r2: <release>",
    ]);
  });

  test("opt-in `transactions=\"concurrent\"`: transactions run in parallel, each on its own reserved connection", async () => {
    const { pool, log } = fakePool();
    const sql = rt._scrml_db_guard(pool, "postgres", true);
    const aIn = latch();
    const aGo = latch();
    const a = asRequest(async () => {
      await sql.unsafe("BEGIN");
      aIn.open();
      await aGo.wait;
      await sql`UPDATE t SET x = 1`;
      await sql.unsafe("COMMIT");
    });
    await aIn.wait;
    const b = track(asRequest(async () => {
      await sql.unsafe("BEGIN");
      await sql`UPDATE t SET x = 2`;
      await sql.unsafe("COMMIT");
    }));
    await b.promise; // B does NOT wait for A
    expect(b.error).toBeUndefined();
    aGo.open();
    await a;
    expect(log).toEqual([
      "r1: <reserve>", "r1: BEGIN",
      "r2: <reserve>", "r2: BEGIN", "r2: UPDATE t SET x = 2", "r2: COMMIT", "r2: <release>",
      "r1: UPDATE t SET x = 1", "r1: COMMIT", "r1: <release>",
    ]);
  });

  test("S449 review F3 (pooled): a nested BEGIN / COMMIT is a savepoint on the reserved connection; the outer ROLLBACK still releases", async () => {
    const { pool, log } = fakePool();
    const sql = rt._scrml_db_guard(pool, "postgres", false);
    await asRequest(async () => {
      await sql.unsafe("BEGIN");
      await sql.unsafe("BEGIN");
      await sql.unsafe("COMMIT");
      await sql.unsafe("BEGIN");
      await sql.unsafe("ROLLBACK");
      await sql.unsafe("ROLLBACK");
    });
    expect(log).toEqual([
      "r1: <reserve>", "r1: BEGIN",
      "r1: SAVEPOINT _scrml_nest_1", "r1: RELEASE SAVEPOINT _scrml_nest_1",
      "r1: SAVEPOINT _scrml_nest_2", "r1: ROLLBACK TO SAVEPOINT _scrml_nest_2", "r1: RELEASE SAVEPOINT _scrml_nest_2",
      "r1: ROLLBACK", "r1: <release>",
    ]);
  });

  test("S449 review F2 (pooled): COMMIT AND CHAIN keeps the reserved connection (the chained transaction is still open)", async () => {
    const { pool, log } = fakePool();
    const sql = rt._scrml_db_guard(pool, "postgres", false);
    await asRequest(async () => {
      await sql.unsafe("BEGIN");
      await sql.unsafe("COMMIT AND CHAIN");
      await sql`SELECT 1`;
      await sql.unsafe("COMMIT");
    });
    expect(log).toEqual(["r1: <reserve>", "r1: BEGIN", "r1: COMMIT AND CHAIN", "r1: SELECT 1", "r1: COMMIT", "r1: <release>"]);
  });

  test("Bun callback transaction (the db-authoritative path): pool begin outside a transaction, a savepoint on the reserved connection inside one", async () => {
    const { pool, log } = fakePool();
    const sql = rt._scrml_db_guard(pool, "postgres", false);
    await asRequest(() => sql.begin(async (tx) => { await tx`SELECT 1`; }));
    await asRequest(async () => {
      await sql.unsafe("BEGIN");
      await sql.begin(async (tx) => { await tx`SELECT 2`; });
      await sql.unsafe("COMMIT");
    });
    expect(log).toEqual([
      "pool: <begin cb>", "bun-tx: SELECT 1",
      "r1: <reserve>", "r1: BEGIN",
      "r1: SAVEPOINT _scrml_sp_1", "r1: SELECT 2", "r1: RELEASE SAVEPOINT _scrml_sp_1",
      "r1: COMMIT", "r1: <release>",
    ]);
  });
});
