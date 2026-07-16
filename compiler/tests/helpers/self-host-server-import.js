/**
 * Shared harness for integration tests that dynamic-import a compiled
 * `.server.js` and invoke its route handlers against a REAL SQLite file.
 *
 * WHY THIS EXISTS (Windows EBUSY teardown flake)
 * ------------------------------------------------
 * A compiled scrml server module declares, at module top-level,
 *   `const _scrml_sql = new SQL("sqlite:<file>")`
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

// Every cache-busted `import()` yields a FRESH module instance holding a FRESH
// open SQL handle, so we must track and close each one — not just the last.
const _openModules = new Set();

/**
 * Rewrite the emitted relative SQLite connection string to an absolute path
 * (so the runtime queries hit the seeded test DB regardless of CWD), append a
 * disposal hook that closes the module's `_scrml_sql` handle, dynamic-import
 * the module (cache-busted → fresh in-process handle), register it for later
 * cleanup, and return it.
 *
 * The connection rewrite is byte-identical to the bespoke `.replace(...)` the
 * affected tests previously inlined.
 *
 * @param {string} serverJsPath  Absolute path to the compiled `.server.js`.
 * @param {string} absDbPath     Absolute path to the seeded SQLite file.
 * @returns {Promise<object>}    The imported module namespace.
 */
export async function patchAndImport(serverJsPath, absDbPath) {
  const patched =
    readFileSync(serverJsPath, "utf-8").replace(
      'const _scrml_sql = new SQL("sqlite:./items.db");',
      `const _scrml_sql = new SQL(${JSON.stringify("sqlite:" + absDbPath)});`,
    ) + `\nexport const __closeSql = async () => { await _scrml_sql.close(); };\n`;
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
