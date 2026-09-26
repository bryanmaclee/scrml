/**
 * §44 — SQLITE CONCURRENCY DEFAULTS FOR HANDLES **THE COMPILER ITSELF OPENS**.
 *
 * ⛔ WHY THIS MODULE EXISTS AND IS NOT `codegen/sqlite-defaults.ts`.
 * S433/#1062 swept every sqlite handle the compiler *emits* (`codegen/sqlite-defaults.ts`
 * — `Bun.SQL` tagged-template text baked into generated server/tool modules) and shipped
 * it measured-correct. It missed the handles the compiler and its CLI open **in their own
 * process**, because the sweep's framing was the `Bun.SQL` constructor rather than *"every
 * sqlite handle this compiler opens"*. The gap's own sentence — *"that blocked the
 * adopter's DB migration"* — therefore stayed reachable: MEASURED on S436, `scrml
 * db-migrate` against a database another process held `BEGIN IMMEDIATE` on failed
 * `database is locked` in **129 ms**, i.e. with no wait at all, while the emitted server
 * the same arc fixed waited the identical lock out.
 *
 * So there are TWO halves of the same defect and they need TWO shapes, because the two
 * handle kinds are not the same object:
 *   - EMITTED handles are `Bun.SQL` tagged templates: async, lazy thenables, configured by
 *     `await _h\`PRAGMA …\`` inside generated source text → `codegen/sqlite-defaults.ts`.
 *   - COMPILER-OPENED handles are `bun:sqlite` `Database` instances: synchronous, configured
 *     by `db.run("PRAGMA …")` on a live object → THIS module.
 * Bending the codegen module to cover both would mean a text-emitter that also takes a live
 * handle. They share the only thing that must not drift — the timeout VALUE — and nothing
 * else, so the value is defined here (zero imports, importable from anywhere) and
 * `codegen/sqlite-defaults.ts` re-exports it.
 *
 * ⛔ WHY SRC-ROOT AND NOT UNDER `codegen/`. `protect-analyzer.ts` is a consumer, and its
 * import block records the standing invariant that this early PA stage does not pull a
 * codegen module. This file imports NOTHING — not even `bun:sqlite` (it takes an
 * already-open handle, duck-typed on `.run`) — so it cannot drag `bun:sqlite`/`node:fs`
 * into a stage that avoids them, which is the mirror invariant `schema-differ.js` records.
 *
 * ⛔ `busy_timeout` ONLY — NO `journal_mode = WAL` FROM A CLI PATH. This is a deliberate
 * asymmetry with the emitted half, and it is a durability decision, not an oversight:
 *   - `busy_timeout` is PER-CONNECTION. It writes nothing to disk, survives nothing, and
 *     vanishes with the handle. Setting it on a database the adopter owns is invisible.
 *   - `journal_mode = WAL` is a PERSISTENT change to the adopter's FILE. It creates `-wal`
 *     and `-shm` side files, changes the file's concurrency semantics for every other
 *     reader/writer of it forever, and is not undone when the tool exits. A *migrator* —
 *     a short-lived CLI invoked against a file whose lifecycle the adopter owns — has no
 *     business making that change on their behalf. The emitted SERVER is a different case:
 *     it is the long-lived owner of its own database, which is why the emitted half does
 *     upgrade to WAL and this half does not.
 *   (If WAL-from-the-CLI is ever wanted, it is an explicit opt-in flag and an operator
 *   ruling, not a default.)
 *
 * ⛔ ORDER AND ISOLATION — the lesson #1062 paid for twice. `PRAGMA journal_mode = WAL`
 * needs a momentary EXCLUSIVE lock, so under contention it THROWS; with both pragmas under
 * one `try` and WAL first, that throw skipped `busy_timeout` entirely and the fix was
 * MEASURED completely inert (`journal_mode=delete busy_timeout=0`, the exact pre-fix state)
 * under precisely the contention it existed for. This module sets exactly one pragma, so the
 * ordering hazard cannot recur here — but the rule is kept live in the code: `busy_timeout`
 * goes FIRST and in its OWN `try`, and anything added later goes in a `try` of its own
 * AFTER it. Never a shared `try`.
 *
 * ⛔ THE CATCH IS SILENT ON PURPOSE. An exotic VFS or a handle that does not answer PRAGMA
 * must not take a CLI down before it has even read the schema. Falling back to sqlite's own
 * settings is exactly the pre-fix behaviour, so a swallowed failure is never worse than not
 * calling this at all.
 */

/**
 * The busy-timeout, in ms. THE one definition in the tree: `codegen/sqlite-defaults.ts`
 * re-exports this symbol so the emitted half and the compiler-opened half cannot drift.
 */
export const SQLITE_BUSY_TIMEOUT_MS = 5000;

/**
 * The minimum surface this helper needs — deliberately structural, not
 * `import type { Database } from "bun:sqlite"`, so this module stays import-free.
 */
export interface SqliteRunnable {
  run(sql: string): unknown;
}

/**
 * Configure a sqlite handle THE COMPILER OPENED for safe coexistence with whatever else
 * holds the adopter's database. Call it IMMEDIATELY after the open, before any other
 * statement: `busy_timeout` only affects statements issued after it lands.
 *
 * Returns `true` when the pragma was accepted, `false` when it was swallowed — callers may
 * ignore it; it exists so a test can tell "configured" from "silently inert" without
 * reading emitted or source text.
 *
 * Read-only handles are a legitimate caller: in WAL mode a reader does not block on a
 * writer, but it DOES contend for the brief EXCLUSIVE lock a WAL recovery or a
 * checkpoint-restart takes, and a compile-time schema read that dies `database is locked`
 * is the same adopter-facing symptom as a migration that does. A handle opened
 * `immutable=1` takes no locks at all and does not need this.
 */
export function configureSqliteHandle(db: SqliteRunnable): boolean {
  // busy_timeout FIRST and in its OWN try — see the ORDER AND ISOLATION note above.
  try {
    db.run(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
    return true;
  } catch {
    /* exotic VFS / non-file handle — fall back to sqlite's own settings */
    return false;
  }
  // ⚑ Anything added here goes in a `try` of its own, AFTER the one above. And see the
  // `journal_mode = WAL` note: it does NOT belong on a CLI-opened handle.
}
