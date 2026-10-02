/**
 * §20.5 — the compiler-owned session STORE declaration, emitted into every server
 * module that serves a session (`emit-server.ts`), as ONE source of truth.
 *
 * WHY A SHARED MODULE. The §14.8.9 provenance flow (`protect-flow.ts`) models this
 * store by SUMMARY rather than walking it (S449 round 9 — the same treatment the
 * `_scrml_protect_*` runtime helpers get). It recognizes the declaration by its
 * EXACT emitted text, so the emitter and the recognizer must read the same
 * constant: if the emitted store changes, the recognizer stops matching and the
 * flow falls back to walking the store faithfully (slow on a large app, never
 * unsound). A seam test pins that the emitter uses these lines.
 *
 * Two variants:
 *   - SQLITE (an app that writes the session — `session.set` / `.destroy`): a
 *     SQLite-backed key/value store, cached per path on
 *     `globalThis.__scrml_session_stores`. `get` returns `JSON.parse` of the stored
 *     text (a fresh object; Symbol-keyed §14.8.9 markers do not survive JSON), `set`
 *     stores `JSON.stringify(value)`, `delete` removes the key.
 *   - MEMORY (a read-only session app): a `Map` kept on
 *     `globalThis.__scrml_session_store`.
 */

import { SQLITE_BUSY_TIMEOUT_MS } from "../sqlite-handle-defaults.ts";

/** The SQLite-backed store declaration (one element per emitted line). */
export const SESSION_STORE_SQLITE_LINES: readonly string[] = [
  "const _scrml_session_store = (((globalThis.__scrml_session_stores ??= {}))[_scrml_session_db_path] ??= (() => {",
  "  const _db = new _ScrmlSessionDatabase(_scrml_session_db_path);",
  // §44 / operator ruling S385 A1 ("WAL + 5s busy-timeout as the safe default", #1234) —
  // the session store is the one emitted sqlite handle #1062's sweep did not reach
  // (g-emitted-session-store-opens-sqlite-with-no-busy-timeout-or-wal): a raw
  // `bun:sqlite` Database under an ALIASED constructor, not a `Bun.SQL` template.
  // MEASURED before: `journal_mode=delete busy_timeout=0`, and a login under a
  // competing writer failed `database is locked` in ~1 ms (HTTP 500). The SAME two
  // pragmas `sqlite-defaults.ts` emits for `Bun.SQL` handles, with the same rules:
  // busy_timeout FIRST and each in its OWN try (a WAL upgrade needs a momentary
  // EXCLUSIVE lock, throws under contention, and must not take busy_timeout with
  // it); silent catches (a failure falls back to the pre-fix settings). WAL is right
  // here and NOT on a CLI-opened handle (`sqlite-handle-defaults.ts`): the emitted
  // server is the long-lived OWNER of `.scrml-sessions.db`, a file no adopter
  // authors. Both run BEFORE the CREATE TABLE, so the init itself waits a held lock
  // out instead of throwing at module load.
  `  try { _db.run("PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}"); } catch { /* exotic VFS — sqlite's own settings */ }`,
  '  try { _db.run("PRAGMA journal_mode = WAL"); } catch { /* contended or read-only — persists on a later init */ }',
  '  _db.run("CREATE TABLE IF NOT EXISTS kv_store (namespace TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, expires_at INTEGER, PRIMARY KEY (namespace, key))");',
  '  const _ns = "session";',
  '  const _stmtGet = _db.prepare("SELECT value, expires_at FROM kv_store WHERE namespace = ? AND key = ?");',
  '  const _stmtSet = _db.prepare("INSERT OR REPLACE INTO kv_store (namespace, key, value, expires_at) VALUES (?, ?, ?, ?)");',
  '  const _stmtDel = _db.prepare("DELETE FROM kv_store WHERE namespace = ? AND key = ?");',
  "  return {",
  "    get(key) {",
  "      const row = _stmtGet.get(_ns, key);",
  "      if (!row) return null;",
  "      if (row.expires_at !== null && row.expires_at <= Date.now()) { _stmtDel.run(_ns, key); return null; }",
  "      try { return JSON.parse(row.value); } catch { return row.value; }",
  "    },",
  "    set(key, value, ttl) {",
  "      const expiresAt = ttl ? Date.now() + ttl * 1000 : null;",
  "      _stmtSet.run(_ns, key, JSON.stringify(value), expiresAt);",
  "    },",
  "    delete(key) { _stmtDel.run(_ns, key); },",
  "  };",
  "})());",
];

/** The in-memory (read-only app) store declaration. */
export const SESSION_STORE_MEMORY_LINE = "const _scrml_session_store = (globalThis.__scrml_session_store ??= new Map());";

/** The exact source text of each variant's declaration, as the flow compares it. */
export const SESSION_STORE_SQLITE_TEXT = SESSION_STORE_SQLITE_LINES.join("\n");
export const SESSION_STORE_MEMORY_TEXT = SESSION_STORE_MEMORY_LINE;
