/**
 * A per-RUN scratch root for integration tests that import emitted `.server.js`
 * modules which open bun:sqlite databases (the seeded app db, the session store).
 *
 * WHY (S438). On Windows those sqlite handles stay open for the life of the test
 * process, so an `afterAll` `rmSync(TMP_ROOT)` throws EBUSY — a hook error that
 * reports as a failing test — and leaves the seeded `*.db` behind. A FIXED scratch
 * path then made the NEXT run's unguarded `CREATE TABLE items` throw "table items
 * already exists", turning whole files red on a second run for a reason unrelated to
 * anything under test (measured: `authed-server-fn-response-http` 17/17 red;
 * `auth-csrf-synchronizer-token`, `csrf-canonical-delivery`, `csrf-write-path-bootstrap`,
 * `db-src-runtime-path-consistency` red on every standalone run).
 *
 * So: each run owns a fresh `run-<pid>-<time>` subdirectory of `base`; `setup` sweeps
 * earlier runs' leftovers best-effort (a directory still held by a LIVE process is
 * skipped, never fatal), and `teardown` tolerates the held handle.
 *
 * Usage:
 *   const _tmp = perRunTmp(resolve(testDir, "_tmp_my_suite"));
 *   const TMP_ROOT = _tmp.root;
 *   beforeAll(_tmp.setup);
 *   afterAll(_tmp.teardown);
 */
import { rmSync, existsSync, mkdirSync, readdirSync } from "fs";
import { resolve } from "path";

function rmBestEffort(p) {
  try {
    rmSync(p, { recursive: true, force: true });
  } catch {
    /* EBUSY: a live sqlite handle (Windows) — reaped by a later run's sweep */
  }
}

export function perRunTmp(base) {
  const root = resolve(base, `run-${process.pid}-${Date.now()}`);
  return {
    root,
    setup() {
      if (existsSync(base)) {
        for (const e of readdirSync(base)) rmBestEffort(resolve(base, e));
      }
      mkdirSync(root, { recursive: true });
    },
    teardown() {
      rmBestEffort(root);
    },
  };
}
