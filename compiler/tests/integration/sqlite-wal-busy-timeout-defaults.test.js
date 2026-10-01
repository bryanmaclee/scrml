/**
 * §44 — g-native-sqlite-connection-lacks-wal-and-busy-timeout-config (MED, adopter
 * `assetManagement`). Operator ruling S385 A1: "(c) BOTH. WAL + 5s busy-timeout as
 * the safe default, plus a `<program journal-mode= busy-timeout=>` override.
 * Grounds: it is what the adopter's own `db.js` already does." THIS SUITE COVERS THE
 * DEFAULT HALF ONLY — the override attribute is deferred (it needs `ast-builder.js`).
 *
 * THE DEFECT, measured on the emitted handle at 280ecbdd: `journal_mode=delete` and
 * `busy_timeout=0`, so a second PROCESS writing the same file fails IMMEDIATELY with
 * `SQLITE_BUSY: database is locked` (measured at 0ms). That blocked the adopter's DB
 * migration. With the defaults the same cross-process write waits out the lock and
 * succeeds.
 *
 * ⛔ THE TWO TRAPS THIS SUITE PINS, because both make a "looks applied" emit inert:
 *
 *  1. Bun.SQL IGNORES constructor options for sqlite (measured on Bun 1.4.2 across
 *     all three spellings: an options object, the `{adapter, filename}` object form,
 *     and connection-string query params — all still read back delete/0). So the
 *     pragmas must be STATEMENTS on the live handle, and the emitted shape is
 *     asserted to be exactly that.
 *
 *  2. A Bun.SQL tagged template is LAZY — a thenable that never executes until
 *     awaited. A fire-and-forget `_h`PRAGMA …`` therefore does NOTHING (measured: an
 *     un-awaited `PRAGMA busy_timeout = 4321` read back as 0). The `await` is
 *     load-bearing and is asserted, because dropping it would leave every assertion
 *     about the emitted TEXT passing while the behaviour silently regressed.
 *
 * So the behavioural case does not read the emitted text at all: it IMPORTS the
 * emitted module and measures the database file.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname, join } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync, readFileSync } from "fs";
import { Database } from "bun:sqlite";
import { compileScrml } from "../../src/api.js";
import { SQLITE_BUSY_TIMEOUT_MS } from "../../src/codegen/sqlite-defaults.ts";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
// Unique per RUN: the teardown below can legitimately fail with EBUSY on Windows
// (a live sqlite handle holds the file), so a fixed path would find last run's
// seeded database still there and `CREATE TABLE` would throw "table already exists".
const TMP_ROOT = resolve(testDir, `_tmp_sqlite_wal_defaults-${process.pid}-${Date.now().toString(36)}`);
let counter = 0;

beforeAll(() => {
  if (!existsSync(TMP_ROOT)) mkdirSync(TMP_ROOT, { recursive: true });
});
afterAll(() => {
  // Live sqlite handles keep the files open for the process lifetime on Windows.
  try {
    if (existsSync(TMP_ROOT)) rmSync(TMP_ROOT, { recursive: true, force: true });
  } catch { /* EBUSY — the OS reclaims the temp tree */ }
});

const nonWarn = (errors) => errors.filter((e) => !/^[WI]-/.test(e.code ?? ""));

/**
 * The emitted configuration is a FLOATING async IIFE (it cannot be a top-level await
 * — see the parse guard below), so it is SUBMITTED at module init and lands a few
 * microtasks later. Poll for the landing rather than sleeping a fixed amount: a
 * fixed sleep is either flaky or slow, and polling also keeps the failure honest —
 * if the pragma never lands, this times out and the assertion after it fails.
 */
async function waitForJournalMode(dbPath, want, timeoutMs = 5000) {
  const t0 = Date.now();
  for (;;) {
    const d = new Database(dbPath);
    const got = d.query("PRAGMA journal_mode").get().journal_mode;
    d.close();
    if (got === want || Date.now() - t0 > timeoutMs) return got;
    await new Promise((r) => setTimeout(r, 20));
  }
}

// S445 (per-file ownership) — `owns` adds the table's own CREATE TABLE, so this file
// OWNS the database: its handle opens when the module loads and configures it there
// (the shape these tests were written against). Without it the file only REFERENCES
// the database: the handle opens on first use and configures it then.
const appWithDb = (src, table, owns = true) => `<program db="${src}">
  <db src="${src}" tables="${table}">
    \${
      <rows> = []
      function loadRows() { return ?{\`SELECT id FROM ${table}\`}.all() }
      ${owns ? `function ensureTable() { ?{\`CREATE TABLE IF NOT EXISTS ${table} (id INTEGER PRIMARY KEY, label TEXT)\`}.run() }` : ""}
      on mount { @rows = loadRows() }
    }
    <h1>\${@rows}</h1>
  </>
</program>`;

/** Build a one-file project with a seeded sqlite db and compile it. */
function build(tag, { dbFile = "m.db", table = "items", src = null, seed = true, owns = true } = {}) {
  const root = resolve(TMP_ROOT, `${tag}-${++counter}`);
  mkdirSync(root, { recursive: true });
  if (seed) {
    const d = new Database(join(root, dbFile), { create: true });
    d.exec(`CREATE TABLE ${table} (id INTEGER PRIMARY KEY, label TEXT)`);
    d.close();
  }
  const appPath = join(root, "app.scrml");
  writeFileSync(appPath, appWithDb(src ?? `./${dbFile}`, table, owns));
  const out = join(root, "dist");
  mkdirSync(out, { recursive: true });
  const result = compileScrml({ inputFiles: [appPath], write: true, outputDir: out, log: () => {} });
  return {
    errors: result.errors ?? [],
    root,
    out,
    serverJs: readFileSync(join(out, "app.server.js"), "utf8"),
    serverPath: join(out, "app.server.js"),
    dbPath: join(root, dbFile),
  };
}

describe("§44 — a file-backed sqlite handle gets WAL + a 5s busy-timeout by default", () => {
  test("the emitted module configures the handle with AWAITED pragma statements", () => {
    const { errors, serverJs } = build("emit");
    expect(nonWarn(errors)).toEqual([]);

    // s445 — this file declares the table, so its handle OWNS m.db and opens at load.
    expect(serverJs).toMatch(/const _scrml_sql = new SQL\(_scrml_sqlite_owned\("[^"]*m\.db", "\.\/m\.db", "[^"]*"\)\);/);
    expect(serverJs).toContain("function _scrml_sqlite_configure(_h)");
    expect(serverJs).toContain("PRAGMA journal_mode = WAL");
    expect(serverJs).toContain("PRAGMA busy_timeout = 5000");

    // TRAP 2: both pragmas MUST be awaited INSIDE the async IIFE. An un-awaited
    // Bun.SQL template is a lazy thenable that never executes.
    expect(serverJs).toContain("await _h`PRAGMA journal_mode = WAL`;");
    expect(serverJs).toContain("await _h`PRAGMA busy_timeout = 5000`;");
    expect(serverJs).toContain("void _scrml_sqlite_configure(_scrml_sql);");

    // ⛔ F2-1 — ORDER AND ISOLATION. `PRAGMA journal_mode = WAL` needs a momentary
    // EXCLUSIVE lock, so under the very contention this feature exists for it THROWS.
    // With both pragmas under ONE try and WAL first, that throw skipped busy_timeout
    // entirely: MEASURED `journal_mode=delete busy_timeout=0` — the pre-fix state,
    // silently, with the fix installed. busy_timeout is the pragma that actually
    // rescues a contended write and must not be collateral damage.
    const btIdx = serverJs.indexOf("PRAGMA busy_timeout = 5000");
    const walIdx = serverJs.indexOf("PRAGMA journal_mode = WAL");
    expect(btIdx).toBeGreaterThan(-1);
    expect(btIdx).toBeLessThan(walIdx); // busy_timeout FIRST
    // Each pragma in its OWN try — neither can suppress the other.
    expect(serverJs).toMatch(/try \{ await _h`PRAGMA busy_timeout = 5000`; \} catch \{/);
    expect(serverJs).toMatch(/try \{ await _h`PRAGMA journal_mode = WAL`; \} catch \{/);

    // The configure call must come AFTER the declaration it configures.
    expect(serverJs.indexOf("const _scrml_sql = new SQL("))
      .toBeLessThan(serverJs.indexOf("void _scrml_sqlite_configure(_scrml_sql);"));
  });

  test("a REFERENCING handle (S445 per-file ownership) configures when it first opens, before the first statement", () => {
    const { errors, serverJs } = build("emit-ref", { owns: false });
    expect(nonWarn(errors)).toEqual([]);
    expect(serverJs).toMatch(/const _scrml_sql = _scrml_sqlite_referenced\("[^"]*m\.db", "\.\/m\.db", "[^"]*"\);/);
    // No load-time configure for a handle that is not open yet …
    expect(serverJs).not.toContain("void _scrml_sqlite_configure(_scrml_sql);");
    // … it runs on open, and every statement waits for it.
    expect(serverJs).toContain("function _scrml_sqlite_configure(_h)");
    expect(serverJs).toContain("ready = _scrml_sqlite_configure(handle);");
    expect(serverJs).toContain("return ready.then(() => h(...args));");
  });

  test("EXECUTED: a REFERENCING module leaves the file alone at import, and its first query puts it into WAL", async () => {
    const { errors, serverPath, dbPath } = build("exec-ref", { owns: false });
    expect(nonWarn(errors)).toEqual([]);
    const mod = await import(`file://${serverPath}?v=${Date.now()}-${Math.random()}`);
    await new Promise((r) => setTimeout(r, 100));
    const d0 = new Database(dbPath);
    expect(d0.query("PRAGMA journal_mode").get().journal_mode).toBe("delete"); // not opened at load
    d0.close();
    const route = Object.values(mod).find((v) => v && typeof v === "object" && typeof v.path === "string" && v.path.includes("loadRows"));
    expect(route).toBeDefined();
    const resp = await route.handler(new Request(`http://localhost${route.path}`, {
      method: route.method,
      headers: { "Content-Type": "application/json", "X-CSRF-Token": "t", Cookie: "scrml_csrf=t" },
      body: route.method === "GET" ? undefined : "{}",
    }));
    expect(resp.status).toBe(200);
    expect(await waitForJournalMode(dbPath, "wal")).toBe("wal");
  });

  // ⛔ THE REGRESSION GUARD THAT MATTERS MOST HERE. The emitted `.server.js` is not
  // always loaded as an ESM module: the conformance runtime adapter evaluates it with
  // `new Function(...)` (conformance/adapters/impl1-ts.ts), where a top-level `await`
  // is a HARD SyntaxError. The first version of this fix used top-level await and
  // took 30 runtime conformance cases red with
  // `SyntaxError: Unexpected identifier '_scrml_sqlite_configure'`.
  test("the emitted server module stays TOP-LEVEL-AWAIT-FREE (new Function must parse it)", () => {
    const { serverJs } = build("no-tla");

    // Mirror the conformance adapter's own preprocessing, then parse exactly as it
    // does. This fails loudly the moment anything reintroduces top-level await.
    const runnable = serverJs
      .replace(/^\s*import\s+\{\s*SQL\s*\}\s+from\s+"bun";\s*$/m, "")
      .replace(/^\s*import\s+\{[^}]*_scrml_db_file_exists[^}]*\}\s+from\s+"node:fs";\s*$/m, "")
      .replace(/^\s*const _scrml_sql = .*;\s*$/m, "")
      .replace(/^export\s+/gm, "")
      .replace(/import\.meta\.url/g, JSON.stringify("file:///case.scrml"));
    expect(runnable).toContain("_scrml_sqlite_configure");
    expect(() => new Function("_scrml_sql", "Bun", "Response", "crypto", "URL", runnable)).not.toThrow();
  });

  test("EXECUTED: importing the emitted module puts the database file into WAL", async () => {
    const { errors, serverPath, dbPath, root } = build("exec");
    expect(nonWarn(errors)).toEqual([]);

    const before = new Database(dbPath);
    expect(before.query("PRAGMA journal_mode").get().journal_mode).toBe("delete");
    before.close();

    // (s445: the handle is resolved against the module, not the CWD — the chdir is
    // kept only so this test does not depend on that property; see
    // compiler/tests/integration/dev-db-no-side-file.test.js for the test that does.)
    const cwd = process.cwd();
    try {
      process.chdir(root);
      await import(`file://${serverPath}?v=${Date.now()}-${Math.random()}`);
    } finally {
      process.chdir(cwd);
    }

    // journal_mode=WAL is a PERSISTENT property of the file, so a fresh connection
    // observes it. This is the assertion the emitted TEXT cannot make for us.
    expect(await waitForJournalMode(dbPath, "wal")).toBe("wal");
  });

  test("EXECUTED: a 5s busy-timeout waits out a lock another PROCESS holds", async () => {
    const { errors, serverPath, dbPath, root } = build("busy");
    expect(nonWarn(errors)).toEqual([]);

    const cwd = process.cwd();
    try {
      process.chdir(root);
      await import(`file://${serverPath}?v=${Date.now()}-${Math.random()}`);
    } finally {
      process.chdir(cwd);
    }
    expect(await waitForJournalMode(dbPath, "wal")).toBe("wal");

    // A holder in ANOTHER PROCESS (the adopter's real scenario — an in-process
    // holder cannot be used, because sqlite's busy wait blocks this thread and the
    // release timer would never fire).
    const holder = join(root, "holder.mjs");
    writeFileSync(holder, [
      'import { Database } from "bun:sqlite";',
      "const db = new Database(process.argv[2]);",
      'db.exec("PRAGMA busy_timeout = 5000");',
      'db.exec("BEGIN IMMEDIATE");',
      'db.exec("INSERT INTO items (label) VALUES (\'held\')");',
      'console.log("LOCKED");',
      "await new Promise((r) => setTimeout(r, 700));",
      'db.exec("COMMIT");',
      "db.close();",
    ].join("\n"));

    const child = Bun.spawn(["bun", holder, dbPath], { stdout: "pipe" });
    await child.stdout.getReader().read(); // "LOCKED"

    const { SQL } = await import("bun");
    const h = new SQL("sqlite:" + dbPath);
    await h`PRAGMA busy_timeout = 5000`;
    const t0 = Date.now();
    // Pre-fix (journal_mode=delete, busy_timeout=0) this threw SQLITE_BUSY at ~0ms.
    await h`INSERT INTO items (label) VALUES ('mine')`;
    const waited = Date.now() - t0;
    await child.exited;

    // It SUCCEEDED, and it succeeded by WAITING rather than by racing.
    expect(waited).toBeGreaterThan(300);
    const rows = new Database(dbPath).query("SELECT label FROM items").all().map((r) => r.label);
    expect(rows).toContain("mine");
    expect(rows).toContain("held");
  }, 30_000);
});

describe("§44 — busy_timeout survives a CONTENDED init (F2-1: it must not ride on WAL)", () => {
  // The unit-level guard for the ordering defect, run against the EMITTED helper shape
  // rather than a hand-written copy: extract `_scrml_sqlite_configure` from the emitted
  // module, run it against a handle whose database already has a write lock held, and
  // assert busy_timeout still landed. With the pre-fix shape (one try, WAL first) this
  // yields busy_timeout=0.
  test("with another connection holding a write lock, busy_timeout still lands", async () => {
    const { errors, serverJs, dbPath } = build("contended-init");
    expect(nonWarn(errors)).toEqual([]);

    const m = serverJs.match(/function _scrml_sqlite_configure\(_h\) \{[\s\S]*?\n\}/);
    expect(m).toBeTruthy();
    // eslint-disable-next-line no-new-func
    const configure = new Function(`${m[0]}; return _scrml_sqlite_configure;`)();

    const holder = new Database(dbPath);
    holder.exec("BEGIN IMMEDIATE");
    holder.exec("INSERT INTO items (label) VALUES ('held')");
    try {
      const { SQL } = await import("bun");
      const h = new SQL("sqlite:" + dbPath);
      await configure(h); // await the IIFE so we assert the settled state
      // THE ASSERTION: the WAL pragma threw (it needs an EXCLUSIVE lock) and did NOT
      // take busy_timeout with it.
      expect((await h`PRAGMA busy_timeout`)[0].timeout).toBe(SQLITE_BUSY_TIMEOUT_MS);
    } finally {
      try { holder.exec("ROLLBACK"); } catch {}
      holder.close();
    }
  }, 30_000);
});

describe("§44 — a kind=\"tool\" program gets the SAME defaults (F2-2)", () => {
  // `emit-tool.ts:buildDbHandleHeader` was missed on the first pass. It is reached from
  // `assembleModuleHeaders` by BOTH generateToolJs and generateToolLibraryJs, so a
  // clean-compiling tool emitted a bare handle. MEASURED against a WAL database with a
  // write lock held by another process: the TOOL handle FAILED after 8ms (SQLITE_BUSY)
  // while the fixed SERVER handle WROTE after 1205ms. `journal_mode=WAL` persisting in
  // the FILE does not rescue it — busy_timeout is PER-CONNECTION and the tool's was 0.
  function buildTool(tag) {
    const root = resolve(TMP_ROOT, `${tag}-${++counter}`);
    mkdirSync(root, { recursive: true });
    const d = new Database(join(root, "app.db"), { create: true });
    d.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, label TEXT)");
    d.close();
    const appPath = join(root, "tool.scrml");
    writeFileSync(appPath, `<program kind="tool" db="./app.db">
function main(args: string[]) -> number {
  ?{\`INSERT INTO items (label) VALUES ('from-tool')\`}.run()
  println("tool-wrote")
  return 0
}
</program>
`);
    const out = join(root, "dist");
    mkdirSync(out, { recursive: true });
    const result = compileScrml({ inputFiles: [appPath], write: true, outputDir: out, log: () => {} });
    return {
      errors: result.errors ?? [],
      root,
      toolJs: readFileSync(join(out, "tool.js"), "utf8"),
      toolPath: join(out, "tool.js"),
      dbPath: join(root, "app.db"),
    };
  }

  test("the emitted tool module carries the configure block and AWAITS it", () => {
    const { errors, toolJs } = buildTool("tool-emit");
    expect(nonWarn(errors)).toEqual([]);
    // S445 — this tool only uses app.db (no CREATE TABLE), so its handle is REFERENCING:
    // it opens on first use and runs the configure block then.
    expect(toolJs).toMatch(/const _scrml_sql = _scrml_sqlite_referenced\("[^"]*app\.db", "\.\/app\.db", "[^"]*"\);/);
    expect(toolJs).toContain("PRAGMA busy_timeout = 5000");
    expect(toolJs).toContain("PRAGMA journal_mode = WAL");
    // AWAITED, not floating: the §64.3 harness ends with `process.exit(code)`, a hard
    // exit that kills a pending floating promise before the WAL pragma lands.
    // MEASURED with the floating form: journal_mode stayed `delete` even after an
    // UNCONTENDED tool run. A referencing handle gets the same guarantee a different
    // way: its first statement waits for the configure block (`ready.then(...)`), and
    // `main` awaits that statement.
    expect(toolJs).toContain("ready = _scrml_sqlite_configure(handle);");
    expect(toolJs).toContain("return ready.then(() => h(...args));");
    expect(toolJs).not.toContain("void _scrml_sqlite_configure(_scrml_sql);");
  });

  test("EXECUTED: the tool waits out a write lock another PROCESS holds", async () => {
    const { errors, root, toolPath, dbPath } = buildTool("tool-busy");
    expect(nonWarn(errors)).toEqual([]);

    const holder = join(root, "holder.mjs");
    writeFileSync(holder, [
      'import { Database } from "bun:sqlite";',
      "const db = new Database(process.argv[2]);",
      'db.exec("PRAGMA busy_timeout = 5000");',
      'db.exec("BEGIN IMMEDIATE");',
      'db.exec("INSERT INTO items (label) VALUES (\'held\')");',
      'console.log("LOCKED");',
      "await new Promise((r) => setTimeout(r, 700));",
      'db.exec("COMMIT");',
      "db.close();",
    ].join("\n"));

    const lock = Bun.spawn(["bun", holder, dbPath], { stdout: "pipe" });
    await lock.stdout.getReader().read(); // LOCKED

    const t0 = Date.now();
    // Run the emitted tool as a REAL process, from the project root (its handle names
    // `./app.db` relative to app.scrml — s445, independent of the CWD).
    const proc = Bun.spawn(["bun", toolPath], { cwd: root, stdout: "pipe", stderr: "pipe" });
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    const waited = Date.now() - t0;
    await lock.exited;

    // Pre-fix the tool died at ~8ms with SQLITE_BUSY. Now it waits the lock out.
    expect(exitCode).toBe(0);
    expect(stdout).toContain("tool-wrote");
    expect(waited).toBeGreaterThan(300);
    const labels = new Database(dbPath).query("SELECT label FROM items").all().map((r) => r.label);
    expect(labels).toContain("from-tool");
    expect(labels).toContain("held");
  }, 30_000);

  test("EXECUTED: an UNCONTENDED tool run leaves the database in WAL", async () => {
    const { errors, root, toolPath, dbPath } = buildTool("tool-wal");
    expect(nonWarn(errors)).toEqual([]);

    const before = new Database(dbPath);
    expect(before.query("PRAGMA journal_mode").get().journal_mode).toBe("delete");
    before.close();

    const proc = Bun.spawn(["bun", toolPath], { cwd: root, stdout: "pipe", stderr: "pipe" });
    expect(await proc.exited).toBe(0);

    // This is what the `await` buys: with the floating form `process.exit` killed the
    // WAL pragma mid-flight and this stayed `delete`, so a tool-ONLY adopter (no scrml
    // server ever running against the file) would never get WAL from anywhere.
    expect(await waitForJournalMode(dbPath, "wal")).toBe("wal");
  }, 30_000);
});

describe("§44 — the defaults are scoped to FILE-backed sqlite and nothing else", () => {
  test(":memory: gets NO pragma block (WAL is meaningless, nothing can contend)", () => {
    const { serverJs } = build("memory", { src: ":memory:", seed: false });
    expect(serverJs).toContain('new SQL(":memory:")');
    expect(serverJs).not.toContain("_scrml_sqlite_configure");
    expect(serverJs).not.toContain("PRAGMA journal_mode");
    expect(serverJs).not.toContain("PRAGMA busy_timeout");
  });

  test("a postgres handle gets NO pragma block (the driver gate, not the string)", () => {
    const { serverJs } = build("pg", { src: "postgres://u:p@localhost:5432/d", seed: false });
    expect(serverJs).toContain("new SQL(\"postgres://u:p@localhost:5432/d\")");
    expect(serverJs).not.toContain("_scrml_sqlite_configure");
    expect(serverJs).not.toContain("PRAGMA");
  });

  test("a file with no db at all emits neither a handle nor a pragma block", () => {
    const root = resolve(TMP_ROOT, `nodb-${++counter}`);
    mkdirSync(root, { recursive: true });
    const appPath = join(root, "app.scrml");
    writeFileSync(appPath, `<program>\n  \${\n    export server function ping() { return "pong" }\n  }\n  <button onclick=ping()>p</button>\n</program>`);
    const out = join(root, "dist");
    mkdirSync(out, { recursive: true });
    const r = compileScrml({ inputFiles: [appPath], write: true, outputDir: out, log: () => {} });
    expect(nonWarn(r.errors ?? [])).toEqual([]);
    const js = readFileSync(join(out, "app.server.js"), "utf8");
    expect(js).not.toContain("new SQL(");
    expect(js).not.toContain("_scrml_sqlite_configure");
  });
});
