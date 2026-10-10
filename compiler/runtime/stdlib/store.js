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

// S462 fix round 1 — mirrors the scrml enum declared in stdlib/store/kv.scrml. An enum is a
// run-time value (scrml code constructs `KvError.ParseFailed(…)`), so the shim
// MUST export it: the server bundle imports every enum name it is given, and
// a missing ES export is a link error that takes the whole bundle down.
// Same shape the compiler emits for payload variants ({ variant, data }).
export const KvError = Object.freeze({
  ParseFailed: function(message) {
    return { variant: "ParseFailed", data: { message } };
  },
  variants: ["ParseFailed"],
});

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
    // Prefix match by substr, not LIKE: exact and case-SENSITIVE, and `%` / `_`
    // are ordinary characters. (Pre-S462 the LIKE form passed ESCAPE two
    // characters and threw on every call; it was also case-insensitive.)
    keysPrefix: db.prepare(
      "SELECT key FROM kv_store WHERE namespace = ? AND substr(key, 1, length(?)) = ? AND (expires_at IS NULL OR expires_at > ?)"
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
    // Exact, case-SENSITIVE prefix match (LIKE is case-insensitive in SQLite).
    const rows = store.statements.keysPrefix.all(store.namespace, prefix, prefix, now);
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
