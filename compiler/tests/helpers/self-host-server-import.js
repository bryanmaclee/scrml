/**
 * Shared harness for integration tests that dynamic-import a compiled
 * `.server.js` and invoke its route handlers against a REAL SQLite file.
 *
 * WHY THIS EXISTS (Windows EBUSY teardown flake)
 * ------------------------------------------------
 * A compiled scrml server module declares, at module top-level,
 *   `const _scrml_sql = new SQL(_scrml_sqlite_owned("<file>", …))` (or a lazy `_scrml_sqlite_referenced(…)`)
 * (a Bun.SQL handle) and — correctly, for a long-lived server — never closes
 * it. When a test dynamic-imports such a module, that connection opens an OS
 * handle on the `.db` file and holds it for the lifetime of the test PROCESS.
 *
 * On Windows an open file handle blocks deletion, so the file-level `afterAll`
 * `rmSync(TMP_ROOT, { recursive, force })` throws:
 *   EBUSY: resource busy or locked, rm '...\_tmp_*'
 * and the un-deleted temp dir + seeded DB then cascades into
 * `SQLiteError: table ... already exists` on the NEXT run (the seed re-runs
 * CREATE TABLE on the surviving DB).
 *
 * `maxRetries`/`retryDelay` do NOT fix this: the handle is held for the whole
 * process, so an in-process retry can never win (empirically confirmed —
 * retries at +50/+100/+250/+500 ms all EBUSY). The real fix is to CLOSE the
 * handle at its source before removing the dir.
 *
 * Since the emitted module does not export its private `_scrml_sql` handle,
 * `patchAndImport` appends a tiny `__closeSql` disposal export to the patched
 * module text; `closeOpenedDbHandles()` invokes it on every imported module
 * before teardown. This is a PURE TEST-HARNESS concern — the emitted server is
 * correct as-is (the OS reclaims the connection on process exit); no product
 * code changes.
 */

import { readFileSync, writeFileSync, rmSync, existsSync } from "fs";
import { resolve } from "path";

// Every cache-busted `import()` yields a FRESH module instance holding a FRESH
// open SQL handle, so we must track and close each one — not just the last.
const _openModules = new Set();

/**
 * s445 — the database file an emitted module's default `_scrml_sql` handle opens
 * (SPEC §8.1.1 / §47.14), read from its text exactly as the emitted helper resolves
 * it at runtime with `SCRML_DATA_DIR` unset: the recorded project-root-relative path
 * (`_scrml_sqlite_owned` / `_scrml_sqlite_referenced`, first argument) joined to the
 * recorded `_scrml_project_root`; an absolute recorded path names itself.
 *
 * @param {string} text  The emitted module's source.
 * @returns {{ file: string, owns: boolean } | null}
 */
export function emittedDbFile(text) {
  const m = /const _scrml_sql = (?:_scrml_db_guard\()?(?:new SQL\()?_scrml_sqlite_(owned|referenced)\(("(?:[^"\\]|\\.)*")/.exec(text);
  if (!m) return null;
  const dbPath = JSON.parse(m[2]);
  if (/^(?:\/|[A-Za-z]:[\\/])/.test(dbPath)) return { file: resolve(dbPath), owns: m[1] === "owned" };
  const r = /const _scrml_project_root = ("(?:[^"\\]|\\.)*");/.exec(text);
  if (!r) throw new Error("emittedDbFile: no _scrml_project_root in the module");
  return { file: resolve(JSON.parse(r[1]), dbPath), owns: m[1] === "owned" };
}

/**
 * s445 — assert that the compiled module at `serverJsPath` opens exactly
 * `absDbPath` (see `emittedDbFile`). Replaces the old test-side rewrite of a
 * CWD-relative `sqlite:` literal: a regression to a CWD-relative (or any other) path
 * fails here instead of opening another file.
 *
 * @param {string} serverJsPath  Absolute path to the compiled module.
 * @param {string} absDbPath     Absolute path of the database it must open.
 */
export function assertOpensDb(serverJsPath, absDbPath) {
  const found = emittedDbFile(readFileSync(serverJsPath, "utf-8"));
  if (!found) throw new Error(`assertOpensDb: ${serverJsPath} has no SQLite-file handle`);
  if (found.file !== resolve(absDbPath)) {
    throw new Error(`assertOpensDb: ${serverJsPath} opens ${found.file}, not ${absDbPath}`);
  }
}

/**
 * Append a disposal hook that closes the module's `_scrml_sql` handle,
 * dynamic-import the module (cache-busted → fresh in-process handle), register
 * it for later cleanup, and return it.
 *
 * s445 — this used to REWRITE the emitted `new SQL("sqlite:./items.db")` literal
 * to the seeded file's absolute path, because that literal was opened relative
 * to the test process's CWD. The emitted handle now names the database relative
 * to the DECLARING .scrml file (the file the compiler read), anchored at the
 * module itself, so no rewrite is needed — and this helper instead ASSERTS that
 * the module opens exactly `absDbPath`, so a regression to a CWD-relative (or
 * any other) path fails here rather than quietly opening another file.
 *
 * @param {string} serverJsPath  Absolute path to the compiled `.server.js`.
 * @param {string} absDbPath     Absolute path to the seeded SQLite file.
 * @returns {Promise<object>}    The imported module namespace.
 */
export async function patchAndImport(serverJsPath, absDbPath) {
  const text = readFileSync(serverJsPath, "utf-8");
  // A module whose program never reaches the database declares no handle at all.
  if (/const _scrml_sql = (?:_scrml_db_guard\()?(?:new SQL\()?_scrml_sqlite_/.test(text)) assertOpensDb(serverJsPath, absDbPath);
  const patched = text + `\nexport const __closeSql = async () => { await _scrml_sql.close(); };\n`;
  writeFileSync(serverJsPath, patched);

  const mod = await import(`file://${serverJsPath}?v=${Date.now()}-${Math.random()}`);
  _openModules.add(mod);
  return mod;
}

/**
 * Close the `_scrml_sql` handle of every module opened via `patchAndImport`,
 * then clear the registry. Call this FIRST in `afterAll`, BEFORE removing the
 * temp dir, so the OS file handle is released before `rmSync` runs.
 */
export async function closeOpenedDbHandles() {
  for (const mod of _openModules) {
    try {
      await mod.__closeSql?.();
    } catch {
      // Best-effort: a module that failed to open a handle (or already closed)
      // must not block teardown of the others.
    }
  }
  _openModules.clear();
}

/**
 * Robust recursive remove for test teardown. The `closeOpenedDbHandles()` call
 * is the real fix; `maxRetries`/`retryDelay` here is only belt-and-suspenders
 * for unrelated transient locks (AV scans, delayed flushes).
 *
 * @param {string} dir  Directory to remove.
 */
export function safeRmSync(dir) {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}
