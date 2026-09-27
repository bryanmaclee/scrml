/**
 * §44 — `g-native-sqlite-connection-lacks-wal-and-busy-timeout-config`, THE CLI HALF.
 *
 * ⛔ WHY A SECOND SUITE AND NOT MORE CASES IN `sqlite-wal-busy-timeout-defaults.test.js`.
 * That suite covers the handles the compiler **EMITS** (`Bun.SQL`, baked into generated
 * server/tool source) and it is measured-correct. This one covers the handles the compiler
 * and its CLI **OPEN IN THEIR OWN PROCESS** (`bun:sqlite` `Database`). #1062 swept the first
 * set and missed the second, because its framing was the `Bun.SQL` constructor rather than
 * "every sqlite handle this compiler opens" — which left the gap's OWN SENTENCE, *"that
 * blocked the adopter's DB migration"*, literally reachable after the fix shipped.
 *
 * THE DEFECT, measured at de36da01 with #1062 fully in place:
 *   `scrml db-migrate <proj> --db sqlite:<f>` against a database another PROCESS held
 *   `BEGIN IMMEDIATE` on →
 *     exit 1, "migration failed (rolled back): database is locked", **129 ms** — no wait.
 *   Uncontended → exit 0, "applied 1 statement(s) in 1 transaction."
 *   With the fix, same contention → exit 0, applied, **1566 ms** against a 1500 ms hold.
 *
 * ⛔ WHAT THESE TESTS REFUSE TO DO. #1062's first revision passed its own tests while being
 * completely INERT, because the tests asserted emitted TEXT. So:
 *   - the migrator case runs the REAL CLI as a subprocess against a REAL lock held by a
 *     SEPARATE PROCESS, and asserts the exit code and that it succeeded by WAITING;
 *   - the read-handle case reads the pragma BACK OFF THE LIVE HANDLE;
 *   - nothing here greps a source file or an emitted string for "busy_timeout".
 *   An in-process holder cannot be used: sqlite's busy wait blocks this thread, so the
 *   release timer would never fire.
 *
 * ⛔ AND ONE TEST GUARDS THE NON-CHANGE. `busy_timeout` is per-connection and writes nothing;
 * `journal_mode = WAL` is a PERSISTENT change to a file the ADOPTER owns. A migrator must not
 * make it on their behalf. `does not convert the adopter's database to WAL` fails the moment
 * someone "completes" the CLI half by copying the emitted half's WAL upgrade into it.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname, join } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { Database } from "bun:sqlite";
import { openSchemaReadHandle } from "../../src/protect-analyzer.ts";
import { SQLITE_BUSY_TIMEOUT_MS, configureSqliteHandle } from "../../src/sqlite-handle-defaults.ts";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
const REPO_ROOT = resolve(testDir, "..", "..", "..");
const SCRML_BIN = join(REPO_ROOT, "compiler", "bin", "scrml.js");

// Unique per RUN: a live sqlite handle keeps the file open for the process lifetime on
// Windows, so teardown can legitimately EBUSY and a fixed path would meet last run's tree.
const TMP_ROOT = resolve(testDir, `_tmp_sqlite_cli_busy-${process.pid}-${Date.now().toString(36)}`);
let counter = 0;

beforeAll(() => {
  if (!existsSync(TMP_ROOT)) mkdirSync(TMP_ROOT, { recursive: true });
});
afterAll(() => {
  try {
    if (existsSync(TMP_ROOT)) rmSync(TMP_ROOT, { recursive: true, force: true });
  } catch { /* EBUSY — the OS reclaims the temp tree */ }
});

function scratch(name) {
  const root = join(TMP_ROOT, `${name}-${counter++}`);
  mkdirSync(root, { recursive: true });
  return root;
}

/**
 * Write a holder script and spawn it. It takes a write lock (`BEGIN IMMEDIATE`) on `dbPath`,
 * prints LOCKED, holds for `holdMs`, then rolls back. Resolves once the lock is actually
 * held — never on a timer, which would race.
 */
async function spawnLockHolder(root, dbPath, holdMs) {
  const holder = join(root, "holder.mjs");
  writeFileSync(holder, [
    'import { Database } from "bun:sqlite";',
    "const db = new Database(process.argv[2]);",
    'db.exec("PRAGMA busy_timeout = 10000");',
    'db.exec("CREATE TABLE IF NOT EXISTS _holder_probe (id INTEGER)");',
    'db.exec("BEGIN IMMEDIATE");',
    "db.exec(\"INSERT INTO _holder_probe (id) VALUES (1)\");",
    'console.log("LOCKED");',
    `await new Promise((r) => setTimeout(r, ${holdMs}));`,
    'db.exec("ROLLBACK");',
    "db.close();",
  ].join("\n"));
  const child = Bun.spawn(["bun", holder, dbPath], { stdout: "pipe", stderr: "pipe" });
  await child.stdout.getReader().read(); // "LOCKED" — the lock is now genuinely held
  return child;
}

/** A minimal project whose `<schema>` produces exactly one CREATE TABLE. */
function writeProject(root, dbPath) {
  const project = join(root, "app.scrml");
  writeFileSync(
    project,
    `<program db="sqlite:${dbPath.replace(/\\/g, "/")}">\n` +
      `  <schema>\n    widgets {\n      id: integer primary key\n      name: text not null\n    }\n  </schema>\n` +
      `</program>\n`,
  );
  return project;
}

/**
 * Run the real CLI. Captures stdout AND stderr on BOTH paths — a zero-exit run of this
 * command carries diagnostics on stderr (`db-authoritative tables: (none)`), and reading
 * only one stream is how a probe reports a false clean.
 */
async function runMigrate(project, dbPath) {
  const t0 = Date.now();
  const proc = Bun.spawn(["bun", SCRML_BIN, "db-migrate", project, "--db", "sqlite:" + dbPath], {
    cwd: REPO_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { exitCode, stdout, stderr, ms: Date.now() - t0 };
}

// ==========================================================================
// 1. THE DEFECT — `scrml db-migrate` on a contended database
// ==========================================================================
describe("§44 CLI half — `scrml db-migrate` survives a contended sqlite database", () => {
  test("a write lock held by another PROCESS is waited out, not failed on", async () => {
    const root = scratch("migrate-contended");
    const dbPath = join(root, "mig.db");
    const project = writeProject(root, dbPath);

    // Seed the file so the holder and the migrator meet on an existing database.
    const seed = new Database(dbPath);
    seed.run("CREATE TABLE IF NOT EXISTS _seed (id INTEGER)");
    seed.close();

    const HOLD_MS = 900;
    const child = await spawnLockHolder(root, dbPath, HOLD_MS);
    const r = await runMigrate(project, dbPath);
    await child.exited;

    // Pre-fix this is exit 1 / "database is locked" at ~129ms. Assert the OUTCOME first so a
    // failure reads as the defect and not as an arithmetic surprise.
    expect(`${r.exitCode} ${r.stderr}${r.stdout}`).not.toContain("database is locked");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("applied 1 statement(s) in 1 transaction.");

    // And it succeeded by WAITING, not by racing the holder: it cannot have finished before
    // the lock was released. (Generous lower bound — the spawn itself costs ~100ms.)
    expect(r.ms).toBeGreaterThan(HOLD_MS * 0.6);

    // The table really landed.
    const db = new Database(dbPath);
    const names = db.query("SELECT name FROM sqlite_master WHERE type='table'").all().map((x) => x.name);
    db.close();
    expect(names).toContain("widgets");
  }, 60_000);

  test("the uncontended path is unchanged", async () => {
    const root = scratch("migrate-uncontended");
    const dbPath = join(root, "mig.db");
    const project = writeProject(root, dbPath);

    const r = await runMigrate(project, dbPath);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("applied 1 statement(s) in 1 transaction.");

    const db = new Database(dbPath);
    const names = db.query("SELECT name FROM sqlite_master WHERE type='table'").all().map((x) => x.name);
    db.close();
    expect(names).toContain("widgets");
  }, 60_000);

  // ⛔ THE NON-CHANGE, guarded. See the header: WAL is a persistent change to the adopter's
  // file and a CLI must not make it. If someone later "finishes the job" by copying the
  // emitted half's `journal_mode = WAL` into `configureSqliteHandle`, this goes red.
  test("does not convert the adopter's database to WAL", async () => {
    const root = scratch("migrate-no-wal");
    const dbPath = join(root, "mig.db");
    const project = writeProject(root, dbPath);

    const seed = new Database(dbPath);
    seed.run("CREATE TABLE IF NOT EXISTS _seed (id INTEGER)");
    expect(seed.query("PRAGMA journal_mode").get().journal_mode).toBe("delete");
    seed.close();

    const r = await runMigrate(project, dbPath);
    expect(r.exitCode).toBe(0);

    // READ IT BACK OFF THE FILE, not off any emitted or source text.
    const after = new Database(dbPath);
    expect(after.query("PRAGMA journal_mode").get().journal_mode).toBe("delete");
    after.close();
    expect(existsSync(`${dbPath}-wal`)).toBe(false);
    expect(existsSync(`${dbPath}-shm`)).toBe(false);
  }, 60_000);
});

// ==========================================================================
// 2. THE SHARED HELPER — measured on a live handle, not on its source
// ==========================================================================
describe("§44 CLI half — configureSqliteHandle lands on a real handle", () => {
  test("a freshly opened handle goes busy_timeout 0 -> the shared constant", () => {
    const root = scratch("helper-readback");
    const dbPath = join(root, "h.db");
    const db = new Database(dbPath);
    expect(db.query("PRAGMA busy_timeout").get().timeout).toBe(0);
    expect(configureSqliteHandle(db)).toBe(true);
    expect(db.query("PRAGMA busy_timeout").get().timeout).toBe(SQLITE_BUSY_TIMEOUT_MS);
    db.close();
  });

  test("a handle that cannot answer PRAGMA is swallowed, never thrown", () => {
    // The silent-catch contract: a CLI must not die at open time on an exotic handle.
    const stub = { run() { throw new Error("no pragma here"); } };
    expect(() => configureSqliteHandle(stub)).not.toThrow();
    expect(configureSqliteHandle(stub)).toBe(false);
  });

  test("the emitted half and the CLI half share ONE constant (no drift)", async () => {
    const emitted = await import("../../src/codegen/sqlite-defaults.ts");
    expect(emitted.SQLITE_BUSY_TIMEOUT_MS).toBe(SQLITE_BUSY_TIMEOUT_MS);
  });
});

// ==========================================================================
// 3. THE PROTECT-ANALYZER READ HANDLE — the `-wal` (lock-taking) branch only
// ==========================================================================
describe("§44 CLI half — the PA schema-read handle", () => {
  test("the `-wal` branch (a LIVE WRITER owns the file) carries the busy-timeout", () => {
    const root = scratch("pa-wal-branch");
    const dbPath = join(root, "live.db");

    // A live writer in WAL mode — this is what creates `<path>-wal` and selects the branch.
    const writer = new Database(dbPath);
    writer.run("PRAGMA journal_mode = WAL");
    writer.run("CREATE TABLE t (id INTEGER)");
    writer.run("INSERT INTO t (id) VALUES (1)");
    expect(existsSync(`${dbPath}-wal`)).toBe(true);

    const h = openSchemaReadHandle(dbPath);
    // Read the pragma BACK OFF THE HANDLE. Pre-fix this is 0.
    expect(h.query("PRAGMA busy_timeout").get().timeout).toBe(SQLITE_BUSY_TIMEOUT_MS);
    // Still genuinely read-only, and still sees the writer's committed rows.
    expect(h.query("SELECT COUNT(*) AS n FROM t").get().n).toBe(1);
    expect(() => h.run("INSERT INTO t (id) VALUES (2)")).toThrow();
    h.close();
    writer.close();
  });

  test("the `immutable=1` branch is deliberately EXCLUDED and still leaves no trace", () => {
    const root = scratch("pa-immutable-branch");
    const dbPath = join(root, "quiet.db");

    const w = new Database(dbPath);
    w.run("CREATE TABLE t (id INTEGER)");
    w.close();
    expect(existsSync(`${dbPath}-wal`)).toBe(false);

    const h = openSchemaReadHandle(dbPath);
    // Not configured: an `immutable=1` open takes NO locks, so a timeout is inert by
    // construction. This asserts the exclusion is deliberate, so a later blanket "configure
    // every handle" edit has to come here and think about it.
    expect(h.query("PRAGMA busy_timeout").get().timeout).toBe(0);
    expect(h.query("SELECT COUNT(*) AS n FROM t").get().n).toBe(0);
    h.close();

    // The property the branch exists for: a read leaves no side files on disk.
    expect(existsSync(`${dbPath}-wal`)).toBe(false);
    expect(existsSync(`${dbPath}-shm`)).toBe(false);
  });
});
