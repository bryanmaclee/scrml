/**
 * §44 — SQLITE DURABILITY / CONCURRENCY DEFAULTS, shared by every emitter that
 * declares a `Bun.SQL` handle (`g-native-sqlite-connection-lacks-wal-and-busy-timeout-config`).
 *
 * Operator ruling S385 A1: *"(c) BOTH. WAL + 5s busy-timeout as the safe default,
 * plus a `<program journal-mode= busy-timeout=>` override. Grounds: it is what the
 * adopter's own `db.js` already does."* This module is the DEFAULT half. The
 * override attribute is a separate arm (it needs `ast-builder.js`).
 *
 * THE DEFECT. An emitted `new SQL("sqlite:…")` ran with sqlite's stock settings,
 * MEASURED on the handle: `journal_mode=delete` and `busy_timeout=0`. Under those a
 * second PROCESS writing the same file fails IMMEDIATELY with `SQLITE_BUSY: database
 * is locked` — measured at 0-8ms. With the defaults the same cross-process write
 * waits the lock out and succeeds (measured ~1205ms against a 1200ms holder).
 *
 * ⛔ WHY THIS LIVES IN ITS OWN MODULE. It is emitted from TWO places and the second
 * one was missed on the first pass, which left the gap's own symptom reachable:
 * `codegen/emit-server.ts` (the web-app `?{}` path) and
 * `codegen/emit-tool.ts:buildDbHandleHeader` (reached from `assembleModuleHeaders` by
 * BOTH `generateToolJs` for `kind="tool"` AND `generateToolLibraryJs`). MEASURED with
 * the server half fixed and the tool half not, against a WAL database with a write
 * lock held by another process: the TOOL handle FAILED after 8ms while the SERVER
 * handle WROTE after 1205ms. `journal_mode=WAL` persisting in the FILE does not
 * rescue the tool — **`busy_timeout` is PER-CONNECTION and the tool's was 0** — so a
 * scrml CLI tool sharing the adopter's database with the scrml server stayed blocked
 * by the exact symptom this gap names. One emitter, two call sites, no third copy.
 *
 * ⛔ WHY PRAGMA STATEMENTS AND NOT CONSTRUCTOR OPTIONS. Every cheaper spelling was
 * measured on Bun 1.4.2 and every one silently does nothing:
 * `new SQL(str, { journalMode, busyTimeout })`, the object form
 * `new SQL({ adapter: "sqlite", filename, … })`, and connection-string query params
 * (`sqlite:f.db?journal_mode=WAL`) ALL still read back `delete`/`0`. The `onconnect`
 * hook does fire, but the client it hands you is mid-construction and not yet callable
 * as a tagged template (`null is not a function`, from inside `new SQLiteAdapter`).
 *
 * ⛔ AND THE `await` IS LOAD-BEARING. A Bun.SQL tagged template is a LAZY thenable: it
 * does not execute until awaited, so a fire-and-forget `_h`PRAGMA …`` NEVER RUNS.
 * Measured: an un-awaited `PRAGMA busy_timeout = 4321` read back as `0`. An emit that
 * dropped the `await` would satisfy every assertion about the emitted TEXT while being
 * completely inert — the same silent-wrong class as the defect itself.
 *
 * ⛔ AND IT MUST NOT BE A TOP-LEVEL AWAIT. The emitted server module is NOT always
 * loaded as ESM: the conformance runtime adapter evaluates it with `new Function(...)`
 * (`conformance/adapters/impl1-ts.ts`), a non-module synchronous body where top-level
 * `await` is a hard SyntaxError — measured, 30 runtime conformance cases red with
 * `SyntaxError: Unexpected identifier '_scrml_sqlite_configure'`. ⚑ THE STANDING
 * CONSTRAINT, worth more than this fix: THE EMITTED MODULES MUST STAY
 * TOP-LEVEL-AWAIT-FREE. Hence a floating, self-catching async IIFE, submitted at
 * module init before its first internal `await` suspends. A route handler / tool main
 * cannot run until a request or an invocation arrives, orders of magnitude later.
 *
 * ⛔ ORDER AND ISOLATION ARE BOTH LOAD-BEARING — THIS IS THE F2-1 FIX, and getting it
 * wrong made the whole thing INERT under exactly the contention it exists for.
 * `PRAGMA journal_mode = WAL` needs a momentary EXCLUSIVE lock, so when another
 * connection already holds a write lock at module init — precisely the scenario the
 * gap was filed for — the WAL pragma THROWS. With both pragmas under ONE `try` and
 * WAL first, that throw skipped `busy_timeout` entirely: MEASURED
 * `journal_mode=delete busy_timeout=0`, the exact pre-fix state, silently, with the
 * fix installed. So:
 *   1. `busy_timeout` goes FIRST — it is the pragma that actually rescues a contended
 *      write, and it must not be collateral damage of one that cannot land.
 *   2. Each pragma gets its OWN `try`, so neither can suppress the other.
 * MEASURED after the reorder, same contention: `busy_timeout=5000`. The WAL upgrade
 * still cannot land on a contended init (sqlite does not run the busy handler for a
 * journal-mode change) — it lands on a later UNCONTENDED init and then PERSISTS in the
 * file, which is why it is safe to leave as best-effort. `busy_timeout` by contrast is
 * per-connection and must be re-set on every handle, every time.
 *
 * The catch bodies are deliberately silent: a read-only file, an exotic VFS, a locked
 * database, or the conformance SQL stub that does not answer PRAGMA at all must not
 * take the process down at module init. Falling back to sqlite's own settings is
 * exactly the pre-fix behaviour, so a swallowed failure is never worse than not having
 * this block.
 */

/**
 * The 5s busy-timeout, in ms. Named so the call sites cannot drift.
 *
 * ⛔ DEFINED IN `../sqlite-handle-defaults.ts`, NOT HERE, and re-exported so this module's
 * existing importers keep their import path. S436 found the OTHER half of this defect: the
 * handles the compiler and its CLI open in their OWN process (`bun:sqlite` `Database`, e.g.
 * `scrml db-migrate`) got no timeout at all, so the gap's own sentence — "that blocked the
 * adopter's DB migration" — stayed reachable after #1062 (MEASURED: `db-migrate` died
 * `database is locked` in 129 ms against a held lock). Those handles are synchronous objects,
 * not emitted text, so they need a different HELPER — but the same VALUE. One definition,
 * two shapes; see `sqlite-handle-defaults.ts` for why the CLI half sets `busy_timeout` only
 * and must NOT convert an adopter's file to WAL.
 */
export { SQLITE_BUSY_TIMEOUT_MS } from "../sqlite-handle-defaults.ts";
import { SQLITE_BUSY_TIMEOUT_MS } from "../sqlite-handle-defaults.ts";

/**
 * The emitted `_scrml_sqlite_configure` helper, as source lines. Emit ONCE per
 * module, then one `void _scrml_sqlite_configure(<ident>);` per file-backed sqlite
 * handle (see `sqliteWantsDefaults`).
 */
export const SQLITE_CONFIGURE_HELPER_LINES: readonly string[] = Object.freeze([
  "// --- §44 (S433): sqlite durability + concurrency defaults (compiler-generated) ---",
  "// busy_timeout FIRST and each pragma in its OWN try: a WAL upgrade needs a momentary",
  "// EXCLUSIVE lock, so under contention it throws — and must not take busy_timeout with it.",
  "function _scrml_sqlite_configure(_h) {",
  "  return (async () => {",
  `    try { await _h\`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}\`; } catch { /* stubbed / non-file handle */ }`,
  "    try { await _h`PRAGMA journal_mode = WAL`; } catch { /* contended or read-only — persists on a later init */ }",
  "  })();",
  "}",
]);

/**
 * Does this handle get the defaults? FILE-backed sqlite only.
 *
 * `:memory:` is excluded on purpose: it reports `journal_mode=memory`, WAL is
 * meaningless there and no second process can contend for it. Postgres / MySQL are
 * excluded by the `driver` test — which is the DRIVER, never a substring of the
 * connection string. `connStr` is accepted post-`sqlite:`-prefixing, so both spellings
 * of the in-memory database are recognized.
 */
export function sqliteWantsDefaults(
  driver: "sqlite" | "postgres" | "mysql" | undefined,
  connStr: string,
): boolean {
  if (driver !== "sqlite") return false;
  if (connStr === ":memory:" || connStr === "sqlite::memory:") return false;
  return true;
}
