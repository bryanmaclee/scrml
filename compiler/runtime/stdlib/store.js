// scrml:store — runtime shim
//
// Hand-written ES module mirroring stdlib/store/kv.scrml. SQLite-backed
// key-value store via bun:sqlite.
//
// Surface (S462 — a store is a KvStore struct passed to free functions):
//   - createStore(dbPath, namespace?)        → KvStore { namespace, db, statements }
//   - createSessionStore(dbPath)             → KvStore (namespace="session")
//   - createCounter(dbPath, namespace?)      → KvStore (namespace="counters")
//   - get(store, key) / set(store, key, value, ttl?) / del(store, key)
//   - has(store, key) / keys(store, prefix?) / clear(store) / close(store)
//   - purgeExpired(store)
//   - increment(counter, key, by?) / decrement(counter, key, by?)
//   - count(counter, key) / resetCount(counter, key)
//
// All operations require Bun (uses bun:sqlite). In a browser context any call
// will throw because `bun:sqlite` cannot be imported.

import { Database } from "bun:sqlite";
// host wall-clock via the single sanctioned scrml:time touch (S179 clock de-leak)
import { now as clockNow } from "./time.js";

function _initDb(db) {
  db.run(`
    CREATE TABLE IF NOT EXISTS kv_store (
      namespace TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      expires_at INTEGER,
      PRIMARY KEY (namespace, key)
    )
  `);
}

// A store is a KvStore config/state STRUCT (S462) — never an object of
// functions (SPEC §14.3):
//   { namespace, db, statements }
// The free functions below take it as their first argument.
export function createStore(dbPath, namespace) {
  const ns = namespace || "default";
  const db = new Database(dbPath);
  _initDb(db);

  const statements = {
    get: db.prepare(
      "SELECT value, expires_at FROM kv_store WHERE namespace = ? AND key = ?"
    ),
    set: db.prepare(
      "INSERT OR REPLACE INTO kv_store (namespace, key, value, expires_at) VALUES (?, ?, ?, ?)"
    ),
    delete: db.prepare(
      "DELETE FROM kv_store WHERE namespace = ? AND key = ?"
    ),
    keys: db.prepare(
      "SELECT key FROM kv_store WHERE namespace = ? AND (expires_at IS NULL OR expires_at > ?)"
    ),
    // ESCAPE takes ONE character: the JS string "\\" is a single backslash.
    // (Pre-S462 this read "\\\\" — two characters — so keys(prefix) threw
    // "ESCAPE expression must be a single character" on every call; the old
    // copy-based unit test never exercised the shim.)
    keysPrefix: db.prepare(
      "SELECT key FROM kv_store WHERE namespace = ? AND key LIKE ? ESCAPE '\\' AND (expires_at IS NULL OR expires_at > ?)"
    ),
    clear: db.prepare("DELETE FROM kv_store WHERE namespace = ?"),
    deleteExpired: db.prepare(
      "DELETE FROM kv_store WHERE namespace = ? AND expires_at IS NOT NULL AND expires_at <= ?"
    ),
  };

  return { namespace: ns, db, statements };
}

export function get(store, key) {
  const now = clockNow();
  const row = store.statements.get.get(store.namespace, key);
  if (!row) return null;
  if (row.expires_at !== null && row.expires_at <= now) {
    store.statements.delete.run(store.namespace, key);
    return null;
  }
  try {
    return JSON.parse(row.value);
  } catch (e) {
    return row.value;
  }
}

export function set(store, key, value, ttl) {
  const expiresAt = ttl ? clockNow() + ttl * 1000 : null;
  store.statements.set.run(store.namespace, key, JSON.stringify(value), expiresAt);
}

export function del(store, key) {
  store.statements.delete.run(store.namespace, key);
}

export function has(store, key) {
  const now = clockNow();
  const row = store.statements.get.get(store.namespace, key);
  if (!row) return false;
  if (row.expires_at !== null && row.expires_at <= now) {
    store.statements.delete.run(store.namespace, key);
    return false;
  }
  return true;
}

export function keys(store, prefix) {
  const now = clockNow();
  if (prefix) {
    const escaped = prefix.replace(/[%_\\]/g, "\\$&");
    const rows = store.statements.keysPrefix.all(store.namespace, escaped + "%", now);
    return rows.map((r) => r.key);
  }
  const rows = store.statements.keys.all(store.namespace, now);
  return rows.map((r) => r.key);
}

export function clear(store) {
  store.statements.clear.run(store.namespace);
}

export function close(store) {
  store.db.close();
}

export function purgeExpired(store) {
  store.statements.deleteExpired.run(store.namespace, clockNow());
}

export function createSessionStore(dbPath) {
  return createStore(dbPath, "session");
}

// A counter is a KvStore (default namespace "counters") holding integers.
export function createCounter(dbPath, namespace) {
  return createStore(dbPath, namespace || "counters");
}

export function increment(counter, key, by) {
  const current = get(counter, key) || 0;
  const next = current + (by !== undefined && by !== null ? by : 1);
  set(counter, key, next);
  return next;
}

export function decrement(counter, key, by) {
  const current = get(counter, key) || 0;
  const next = current - (by !== undefined && by !== null ? by : 1);
  set(counter, key, next);
  return next;
}

export function count(counter, key) {
  return get(counter, key) || 0;
}

// `resetCount`, not `reset` — `reset` is a reserved scrml keyword (§6.8).
export function resetCount(counter, key) {
  set(counter, key, 0);
}
