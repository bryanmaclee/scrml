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

/** The SQLite-backed store declaration (one element per emitted line). */
export const SESSION_STORE_SQLITE_LINES: readonly string[] = [
  "const _scrml_session_store = (((globalThis.__scrml_session_stores ??= {}))[_scrml_session_db_path] ??= (() => {",
  "  const _db = new _ScrmlSessionDatabase(_scrml_session_db_path);",
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
