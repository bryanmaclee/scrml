/**
 * §19.10.6 (S449 ruling C) — ONE TRANSACTION PER CONNECTION AT A TIME, emitted into
 * every server module that declares a `?{}` handle (`codegen/emit-server.ts`).
 *
 * THE DEFECT (g-shared-sql-connection-concurrent-handlers-share-transaction). Every
 * server module declares ONE module-level `_scrml_sql` handle and every request uses
 * it. For SQLite that handle is ONE connection, and a transaction is a property of
 * the connection, not of the request: while request A sat between its `BEGIN` and
 * its `COMMIT` (the §8.9.2 implicit envelope awaits the request body AFTER `BEGIN`),
 * request B's statements ran INSIDE A's transaction. MEASURED over HTTP on main
 * a1aac1433 (2 MB bodies, 10 concurrent): 9 of 10 acknowledged (HTTP 200) writes
 * were rolled back with a transaction that was not theirs; 7 of 10 concurrent
 * implicit-envelope calls failed `cannot start a transaction within a transaction`;
 * a plain read returned rows that were never committed.
 *
 * THE FIX (ruled (a)): an async mutex per handle, held by a transaction for its
 * whole duration (across awaits) and released on every exit path.
 *
 *   - `_scrml_db_guard(base, driver, concurrentTransactions)` wraps the handle in a
 *     Proxy. It recognizes transaction control by the statement text — `BEGIN` /
 *     `START TRANSACTION` opens, `COMMIT` / `END` / `ROLLBACK` / `ABORT` closes
 *     (`ROLLBACK TO <savepoint>` does not) — so EVERY envelope holds the lock with no
 *     change at its emission site: the §8.9.2 implicit envelope, `transaction { }`
 *     (emit-logic.ts, both today's lowering and the S450 B1 lowering on
 *     `hold/s450-transaction-in-function-body`, which emit `await db.unsafe("BEGIN")`
 *     on the same handle), and an author's explicit `?{BEGIN}` … `?{COMMIT}`.
 *   - THE OWNER IS THE REQUEST. `_scrml_db_request_scope(handler)` runs every route
 *     handler (and every WebSocket callback) inside its own AsyncLocalStorage scope.
 *     A statement from the scope that holds the transaction runs on the
 *     transaction's connection WITHOUT waiting — so a server function the handler
 *     calls in-process shares the transaction (re-entrant; never a self-deadlock). A
 *     statement from any other scope WAITS (SQLite) until the transaction ends.
 *   - FIFO queue: a waiter is never overtaken by a later arrival (no starvation).
 *   - RELEASE: on the closing statement (a failed `ROLLBACK` releases too; a failed
 *     `COMMIT` may leave the transaction open, so the lock is kept for the
 *     `ROLLBACK` every compiler envelope issues next), on a failed `BEGIN`, and — the
 *     backstop — when the request ends with a transaction still open (an explicit
 *     `?{BEGIN}` with no `COMMIT` on some path): rolled back, logged, released.
 *     Before this a transaction left open stayed open on the shared connection and
 *     every later request's writes went into it.
 *   - Code outside any request (module init, a script importing the module) shares
 *     one scope: it behaves among itself as it did before, and requests are still
 *     isolated from it.
 *
 * POSTGRES / MYSQL. Bun.SQL is a connection POOL there, and Bun REFUSES `BEGIN` on a
 * pooled handle (`ERR_POSTGRES_UNSAFE_TRANSACTION`: "Only use sql.begin, sql.reserved
 * or max: 1") — so before this every implicit envelope / `transaction { }` on Postgres
 * threw at its `BEGIN`. The guard runs each transaction on a connection reserved from
 * the pool (`sql.reserve()`) and routes the owning request's statements to it; a
 * statement from another request goes to the pool, where it cannot see or join the
 * transaction. Default (ruled (a)): transactions on one handle are SERIALIZED by the
 * mutex. Opt-in (ruled "keep (b) as a possible opt in when adopters use PG"):
 * `<program db="postgres://…" transactions="concurrent">` drops the mutex — each
 * transaction reserves its own connection and they run in parallel.
 *
 * ⛔ CONSTRAINTS ON THE EMITTED TEXT (each one measured elsewhere in this codebase):
 *   - NO `import` statement and NO top-level await: the conformance runtime adapter
 *     (`conformance/adapters/impl1-ts.ts`) evaluates the server module with
 *     `new Function(...)`. AsyncLocalStorage is reached through
 *     `process.getBuiltinModule("node:async_hooks")`.
 *   - Every handle declaration stays ON ONE LINE (`const _scrml_sql = …;`): the same
 *     adapter strips it with a single-line regex and binds its own `_scrml_sql`.
 *   - No identifier here may match `\b_scrml_sql(?:_\d+)?\b` — emit-server.ts scans
 *     the module for that pattern to decide which handles to declare.
 *   - The guard's promise-returning tagged call matches the referencing-handle proxy
 *     (`sqlite-file-target.ts`) that already ships: emitted code awaits every query.
 *     ⚠ CONSTRAINT ON FUTURE EMITTERS: a guarded `_scrml_sql\`…\`` returns a Promise,
 *     NOT a Bun.SQL Query — `.values()` / `.raw()` / `.simple()` / `.execute()` chained
 *     on it, and Bun's `sql(obj)` / `sql(array)` fragment helpers, do NOT work through
 *     the guard. Codegen emits none of these today (grep-verified S449); adding one
 *     means teaching `_scrml_db_guard` to forward it.
 *   - A BEGIN / COMMIT / ROLLBACK issued while the scope already owns a transaction is
 *     rewritten to SAVEPOINT / RELEASE / ROLLBACK TO (S449 review F3).
 *
 * Normative text: SPEC §19.10.6 (provenance `ruling:user-voice-scrml.md S449 C`).
 */

/** The value of `<program transactions=>` that opts a Postgres / MySQL handle into
 *  connection-per-transaction (ruled (b), opt-in). */
export const CONCURRENT_TRANSACTIONS_VALUE = "concurrent";

/**
 * The emitted runtime, as source lines. Emit ONCE per server module, BEFORE the first
 * handle declaration (a declaration calls `_scrml_db_guard` at module init, and the
 * `const`s below must be initialized by then).
 */
export const SQL_TX_GUARD_HELPER_LINES: readonly string[] = Object.freeze([
  "// --- §19.10.6 (S449): a connection runs ONE request's transaction at a time (compiler-generated) ---",
  "// Every ?{} handle is wrapped by _scrml_db_guard. A transaction (BEGIN … COMMIT / ROLLBACK:",
  "// the implicit per-handler envelope, a `transaction { }` block, or an explicit ?{BEGIN})",
  "// holds its connection for its whole duration. A statement from ANOTHER request waits until",
  "// it ends, so it can never run inside, read from, or be rolled back with that transaction.",
  "// Statements from the request that owns it (including server functions that request calls)",
  "// run on the transaction's connection without waiting; a BEGIN / COMMIT / ROLLBACK it issues",
  "// while its transaction is open nests as a SAVEPOINT. The owner is the request scope",
  "// _scrml_db_request_scope opens around every route handler.",
  "const _scrml_db_scope_als = (globalThis.__scrml_db_scope_als ??= new (process.getBuiltinModule(\"node:async_hooks\").AsyncLocalStorage)());",
  "// Code outside any request (module init, a script that imports this module) shares one scope.",
  "const _scrml_db_no_scope = (globalThis.__scrml_db_no_scope ??= { held: new Map() });",
  "const _scrml_db_abandon = Symbol.for(\"scrml.db.abandon\");",
  "// The statement with its leading whitespace and comments removed, upper-cased.",
  "function _scrml_db_sql_head(text) {",
  "  let s = String(text ?? \"\");",
  "  for (;;) {",
  "    s = s.trimStart();",
  "    if (s.startsWith(\"--\")) {",
  "      const nl = s.indexOf(\"\\n\");",
  "      s = nl === -1 ? \"\" : s.slice(nl + 1);",
  "    } else if (s.startsWith(\"/*\")) {",
  "      const end = s.indexOf(\"*/\", 2);",
  "      s = end === -1 ? \"\" : s.slice(end + 2);",
  "    } else {",
  "      return s.slice(0, 200).toUpperCase();",
  "    }",
  "  }",
  "}",
  "// Which transaction-control statement this is, or null for any other statement.",
  "function _scrml_db_tx_kind(text) {",
  "  const head = _scrml_db_sql_head(text);",
  "  if (/^(BEGIN|START\\s+TRANSACTION)\\b/.test(head)) return \"begin\";",
  "  if (/^SAVEPOINT\\b/.test(head)) return \"savepoint\";",
  "  if (/^RELEASE\\b/.test(head)) return \"release\";",
  "  if (/^ROLLBACK(\\s+(TRANSACTION|WORK))?\\s+TO\\b/.test(head)) return \"rollback-to\";",
  "  // `COMMIT AND CHAIN` / `ROLLBACK AND CHAIN` end one transaction and open the next at once.",
  "  const chained = /\\bAND\\s+CHAIN\\b/.test(head) && !/\\bAND\\s+NO\\s+CHAIN\\b/.test(head);",
  "  if (/^(COMMIT|END)\\b/.test(head)) return chained ? \"chain\" : \"commit\";",
  "  if (/^(ROLLBACK|ABORT)\\b/.test(head)) return chained ? \"chain\" : \"rollback\";",
  "  return null;",
  "}",
  "// The savepoint a SAVEPOINT / RELEASE statement names (upper-cased), or null.",
  "function _scrml_db_savepoint_name(text) {",
  "  const m = /^(?:SAVEPOINT|RELEASE(?:\\s+SAVEPOINT)?)\\s+\"?([^\\s\";]+)/.exec(_scrml_db_sql_head(text));",
  "  return m ? m[1] : null;",
  "}",
  "function _scrml_db_guard(base, driver, concurrentTransactions) {",
  "  // postgres / mysql: Bun.SQL is a connection POOL — a transaction gets a reserved connection.",
  "  const pooled = driver !== \"sqlite\";",
  "  // `transactions=\"concurrent\"` (pooled only): no mutex, one reserved connection per transaction.",
  "  const serialize = !(pooled && concurrentTransactions);",
  "  // The mutex. FIFO: a waiter is never overtaken by a later arrival.",
  "  const lock = { busy: false, queue: [] };",
  "  const acquire = () => {",
  "    if (!lock.busy) { lock.busy = true; return null; }",
  "    return new Promise((resolve) => lock.queue.push(resolve));",
  "  };",
  "  const release = () => {",
  "    const next = lock.queue.shift();",
  "    if (next) next(); else lock.busy = false;",
  "  };",
  "  const scope = () => _scrml_db_scope_als.getStore() ?? _scrml_db_no_scope;",
  "  const owned = (s) => (s.held.has(guard) ? s.held.get(guard) : null);",
  "  let savepoints = 0;",
  "  // A transaction opens: take the connection (and, by default, the mutex).",
  "  const open = async (s, exec, root) => {",
  "    if (serialize) await acquire();",
  "    let conn = base;",
  "    try {",
  "      if (pooled) conn = await base.reserve();",
  "      const result = await exec(conn);",
  "      s.held.set(guard, { conn, nested: [], root });",
  "      return result;",
  "    } catch (e) {",
  "      if (pooled && conn !== base) conn.release();",
  "      if (serialize) release();",
  "      throw e;",
  "    }",
  "  };",
  "  // The scope's transaction is over: hand its connection back.",
  "  const finish = (s, tx) => {",
  "    s.held.delete(guard);",
  "    if (pooled) tx.conn.release();",
  "    if (serialize) release();",
  "  };",
  "  const run = async (text, exec) => {",
  "    const s = scope();",
  "    const tx = owned(s);",
  "    const kind = _scrml_db_tx_kind(text);",
  "    if (tx !== null) {",
  "      // Inside this scope's own transaction: its connection, no waiting.",
  "      if (kind === \"begin\") {",
  "        // A transaction inside the open one nests as a savepoint: its COMMIT must not",
  "        // commit — nor its ROLLBACK undo — the enclosing transaction.",
  "        const name = \"_scrml_nest_\" + (++savepoints);",
  "        const result = await tx.conn.unsafe(\"SAVEPOINT \" + name);",
  "        tx.nested.push(name);",
  "        return result;",
  "      }",
  "      if ((kind === \"commit\" || kind === \"rollback\") && tx.nested.length > 0) {",
  "        const name = tx.nested.pop();",
  "        if (kind === \"rollback\") await tx.conn.unsafe(\"ROLLBACK TO SAVEPOINT \" + name);",
  "        return tx.conn.unsafe(\"RELEASE SAVEPOINT \" + name);",
  "      }",
  "      const ends = kind === \"commit\" || kind === \"rollback\" ||",
  "        (kind === \"release\" && tx.root !== null && _scrml_db_savepoint_name(text) === tx.root);",
  "      if (!ends) return exec(tx.conn);",
  "      let result;",
  "      try {",
  "        result = await exec(tx.conn);",
  "      } catch (e) {",
  "        // A failed COMMIT can leave the transaction open (SQLITE_BUSY): keep the connection",
  "        // for the ROLLBACK that follows. A failed ROLLBACK ends it either way.",
  "        if (kind === \"rollback\") finish(s, tx);",
  "        throw e;",
  "      }",
  "      finish(s, tx);",
  "      return result;",
  "    }",
  "    if (kind === \"begin\") return open(s, exec, null);",
  "    // SQLite opens a transaction for a SAVEPOINT issued outside one; its RELEASE ends it.",
  "    if (kind === \"savepoint\" && !pooled) return open(s, exec, _scrml_db_savepoint_name(text));",
  "    // A statement outside any transaction of this scope.",
  "    if (pooled) return exec(base); // a pooled connection is never inside another request's transaction",
  "    await acquire();",
  "    try {",
  "      return await exec(base);",
  "    } finally {",
  "      release();",
  "    }",
  "  };",
  "  // Bun's callback-shaped transactions (`begin(callback)` — the db-authoritative principal wrapper).",
  "  const callbackTx = (method) => async (...args) => {",
  "    const s = scope();",
  "    const tx = owned(s);",
  "    if (tx !== null) {",
  "      // Already inside this scope's transaction: nest as a savepoint on its connection.",
  "      const fn = args[args.length - 1];",
  "      const name = \"_scrml_sp_\" + (++savepoints);",
  "      await tx.conn.unsafe(\"SAVEPOINT \" + name);",
  "      try {",
  "        const result = await fn(tx.conn);",
  "        await tx.conn.unsafe(\"RELEASE SAVEPOINT \" + name);",
  "        return result;",
  "      } catch (e) {",
  "        try { await tx.conn.unsafe(\"ROLLBACK TO SAVEPOINT \" + name); } catch { /* the original error matters */ }",
  "        throw e;",
  "      }",
  "    }",
  "    if (pooled) return base[method](...args); // Bun reserves its own connection for it",
  "    await acquire();",
  "    s.held.set(guard, { conn: base, nested: [], root: null });",
  "    try {",
  "      return await base[method](...args);",
  "    } finally {",
  "      s.held.delete(guard);",
  "      release();",
  "    }",
  "  };",
  "  // The scope ended with its transaction still open: roll it back, free the connection.",
  "  const abandon = async (s) => {",
  "    const tx = owned(s);",
  "    if (tx === null) return;",
  "    console.error(\"[scrml] a request ended with its database transaction still open; it was rolled back (§19.10.6)\");",
  "    try {",
  "      await tx.conn.unsafe(\"ROLLBACK\");",
  "    } catch { /* already gone */ } finally {",
  "      finish(s, tx);",
  "    }",
  "  };",
  "  const guard = new Proxy(function () {}, {",
  "    apply: (_target, _this, args) => run(args[0] && args[0][0], (conn) => conn(...args)),",
  "    get: (_target, key) => {",
  "      if (key === \"unsafe\") return (text, ...rest) => run(text, (conn) => conn.unsafe(text, ...rest));",
  "      if (key === \"begin\" || key === \"transaction\") return callbackTx(key);",
  "      if (key === _scrml_db_abandon) return abandon;",
  "      const value = base[key];",
  "      return typeof value === \"function\" ? value.bind(base) : value;",
  "    },",
  "  });",
  "  return guard;",
  "}",
  "// Runs a route handler (or a WebSocket callback) in its own request scope — the owner of",
  "// any transaction it opens. A synchronous handler stays synchronous.",
  "function _scrml_db_request_scope(handler) {",
  "  if (typeof handler !== \"function\") return handler;",
  "  return function (...args) {",
  "    const s = { held: new Map() };",
  "    return _scrml_db_scope_als.run(s, () => {",
  "      let result;",
  "      try {",
  "        result = handler.apply(this, args);",
  "      } catch (e) {",
  "        void _scrml_db_scope_end(s, null);",
  "        throw e;",
  "      }",
  "      if (result === null || typeof result !== \"object\" || typeof result.then !== \"function\") {",
  "        void _scrml_db_scope_end(s, result);",
  "        return result;",
  "      }",
  "      return result.then(",
  "        async (value) => { await _scrml_db_scope_end(s, value); return value; },",
  "        async (err) => { await _scrml_db_scope_end(s, null); throw err; },",
  "      );",
  "    });",
  "  };",
  "}",
  "// The backstop for a transaction a request left open (an explicit ?{BEGIN} with no COMMIT",
  "// on some path): roll it back when the request ends — otherwise every later request would",
  "// wait on it forever. A streamed (SSE) response is still running when its handler returns:",
  "// its stream runs _scrml_db_stream_end when it ends instead.",
  "async function _scrml_db_scope_end(s, result) {",
  "  if (s.held.size === 0) return;",
  "  const type = result && result.headers && typeof result.headers.get === \"function\" ? result.headers.get(\"Content-Type\") : null;",
  "  if (typeof type === \"string\" && type.includes(\"text/event-stream\")) return;",
  "  for (const guard of [...s.held.keys()]) await guard[_scrml_db_abandon](s);",
  "}",
  "// The backstop for a streamed response: called from the stream's `finally`, whether the",
  "// generator finished, failed, or was torn down by the client mid-transaction.",
  "async function _scrml_db_stream_end() {",
  "  const s = _scrml_db_scope_als.getStore();",
  "  if (s) await _scrml_db_scope_end(s, null);",
  "}",
]);

/**
 * The guarded declaration initializer for one handle. One line, always (see the
 * module docblock).
 */
export function guardHandleExpr(
  expr: string,
  driver: "sqlite" | "postgres" | "mysql",
  concurrentTransactions: boolean,
): string {
  return `_scrml_db_guard(${expr}, ${JSON.stringify(driver)}, ${concurrentTransactions ? "true" : "false"})`;
}

/**
 * The request-scope installation, appended at the END of a server module (after every
 * route export it names). Wraps each route's `handler` and, when present, the
 * `_scrml_ws_handlers` callbacks. Mutates the exported objects in place, so every
 * dispatcher (`_server.js`, `scrml dev`, the module's own `fetch`, a test calling
 * `route.handler`) gets the scoped handler.
 */
export function requestScopeLines(routeNames: readonly string[], hasWsHandlers: boolean): string[] {
  if (routeNames.length === 0 && !hasWsHandlers) return [];
  const lines: string[] = [
    "",
    "// --- §19.10.6 (S449): every route handler runs in its own request scope (compiler-generated) ---",
  ];
  if (routeNames.length > 0) {
    lines.push(`for (const _scrml_route of [${routeNames.join(", ")}]) _scrml_route.handler = _scrml_db_request_scope(_scrml_route.handler);`);
  }
  if (hasWsHandlers) {
    lines.push(`for (const _scrml_ws_key of ["open", "message", "close", "drain"]) {`);
    lines.push(`  if (typeof _scrml_ws_handlers[_scrml_ws_key] === "function") _scrml_ws_handlers[_scrml_ws_key] = _scrml_db_request_scope(_scrml_ws_handlers[_scrml_ws_key]);`);
    lines.push(`}`);
  }
  return lines;
}
