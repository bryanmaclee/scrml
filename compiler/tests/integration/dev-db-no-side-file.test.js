/**
 * s445-dev-db-side-file — `scrml dev` must open the database the compiler read,
 * and must never create one.
 *
 * ADOPTER BUG (flogence S49 + S51, reported twice; #1047 did not fix it):
 *   1. `rm -f src/flogence.db src/ports/flogence.db`, then `scrml dev src/app.scrml`
 *      serves HTTP 200 …
 *   2. … and creates `src/flogence.db` and `src/ports/flogence.db` (4096 bytes each);
 *   3. the next `scrml compile src/app.scrml` fails E-PA-004 — "Table `delta_log` was
 *      not found in the EMPTY database …/src/flogence.db";
 *   4. deleting both files makes the compile exit 0 again.
 * PA-reproduced minimal shape: `src/app.scrml` = `<program db="./app.db">`, the real
 * `src/app.db` beside it, `scrml dev src/app.scrml` run from the project root →
 * a NEW empty `./app.db` (4096 bytes) at the project root.
 *
 * ROOT CAUSE: two resolvers and a create-on-open. The compile-time schema read
 * resolved `db=` / `<db src=>` against the DECLARING file's directory; the emitted
 * handle was `new SQL("sqlite:<literal>")`, opened relative to the PROCESS CWD (the
 * literal itself re-relativized to whichever compile unit produced the artifact),
 * and Bun's sqlite adapter creates a missing file. `scrml dev` also imports every
 * `*.server.js` under the output dir, so an artifact from an earlier multi-root
 * compile created files exactly where the next compile's schema read looked.
 *
 * THE FIX: one resolver (`db-target.ts resolveDbFilePath`) for both halves; the
 * emitted handle names that file relative to the MODULE (`_scrml_sqlite_file`,
 * codegen/sqlite-file-target.ts) and opens it with `create: false`, refusing to load
 * — naming the path — when it is absent.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join, resolve, dirname, relative, sep } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { Database } from "bun:sqlite";
import { perRunTmp } from "../helpers/per-run-tmp.js";
import { compileScrml } from "../../src/api.js";
import { classifyDbTarget, resolveDbFilePath } from "../../src/db-target.ts";
import { emittedModuleDir, sqliteRuntimeSpecifier, sqliteFileHandleArg } from "../../src/codegen/sqlite-file-target.ts";

const testDir = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(testDir, "../../src/cli.js");
const _tmp = perRunTmp(resolve(testDir, "_tmp_dev_db_no_side_file"));
beforeAll(_tmp.setup);
afterAll(_tmp.teardown);

// The PA-reproduced app. A server fn reads the real table, so the route answering
// with the seeded row count proves WHICH file the dev server opened.
const APP = `<program db="./app.db">
  <db src="./app.db" tables="t">
    \${
      function count() {
        const rows = ?{\`SELECT n FROM t\`}.all()
        return rows.length
      }
      <n> = 0
    }
    <p>rows: \${@n}</p>
    <button onclick=\${@n = count()}>load</button>
  </db>
</program>
`;

// A self-bootstrapping app: it compiles with NO database file (the compile-time
// schema comes from its own CREATE TABLE), so the database is absent at runtime.
const BOOTSTRAP_APP = `<program db="./boot.db">
  \${
    function ensure() {
      ?{\`CREATE TABLE IF NOT EXISTS t (n INTEGER)\`}.run()
      return 1
    }
    <n> = 0
  }
  <button onclick=\${@n = ensure()}>go</button>
</program>
`;

function seedDb(path) {
  const db = new Database(path, { create: true });
  db.run("CREATE TABLE t (n INTEGER)");
  db.run("INSERT INTO t VALUES (1), (2), (3)");
  db.close();
}

/** Every database-looking file under `root`, excluding output dirs, as sorted relative paths. */
function dbFilesUnder(root) {
  const found = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) { if (e.name !== "dist") walk(p); continue; }
      if (/\.db(-wal|-shm|-journal)?$/.test(e.name)) found.push(relative(root, p).split(sep).join("/"));
    }
  };
  walk(root);
  return found.sort();
}

/** The absolute file an emitted module's SQLite handle opens (resolved as the helper does at load). */
function opensFile(modulePath) {
  const js = readFileSync(modulePath, "utf8");
  const m = /new SQL\(_scrml_sqlite_file\(("(?:[^"\\]|\\.)*")/.exec(js);
  if (!m) throw new Error("no _scrml_sqlite_file handle in " + modulePath);
  return fileURLToPath(new URL(JSON.parse(m[1]), pathToFileURL(modulePath)));
}

/** Start `scrml dev <entry> --port 0` from `cwd`; resolve with the port and a log getter. */
async function startDev(cwd, entryRel) {
  const proc = Bun.spawn(["bun", CLI, "dev", entryRel, "--port", "0"], {
    cwd, stdout: "pipe", stderr: "pipe", stdin: "ignore",
  });
  let out = "";
  const pump = async (s) => { for await (const c of s) out += new TextDecoder().decode(c); };
  pump(proc.stdout);
  pump(proc.stderr);
  let port = 0;
  for (const t0 = Date.now(); Date.now() - t0 < 30_000 && !port; await Bun.sleep(50)) {
    const m = /\[dev\] Serving .* at http:\/\/localhost:(\d+)/.exec(out);
    if (m) port = Number(m[1]);
  }
  if (!port) { proc.kill(); throw new Error("scrml dev did not come up:\n" + out); }
  // The app child sits behind the proxy; wait until it answers the document.
  for (const t0 = Date.now(); Date.now() - t0 < 30_000; await Bun.sleep(100)) {
    try { if ((await fetch(`http://localhost:${port}/app.html`)).status === 200) break; } catch { /* not yet */ }
  }
  return { proc, port, log: () => out };
}

async function stopDev(dev) {
  try { dev.proc.kill(); } catch { /* gone */ }
  try { await dev.proc.exited; } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// §1 — the ONE resolver, and the emitted specifier that encodes it
// ---------------------------------------------------------------------------

describe("§1 one resolver: the declaring file's directory, never the CWD", () => {
  test("a relative value resolves against the declaring file's directory", () => {
    const f = resolve("/proj/src/app.scrml");
    expect(resolveDbFilePath(classifyDbTarget("./app.db"), f)).toBe(resolve("/proj/src/app.db"));
    expect(resolveDbFilePath(classifyDbTarget("app.db"), f)).toBe(resolve("/proj/src/app.db"));
    expect(resolveDbFilePath(classifyDbTarget("../app.db"), f)).toBe(resolve("/proj/app.db"));
    // `sqlite:` is a driver prefix, not part of the path (§8.1.1).
    expect(resolveDbFilePath(classifyDbTarget("sqlite:./app.db"), f)).toBe(resolve("/proj/src/app.db"));
    // An authored absolute path is itself.
    expect(resolveDbFilePath(classifyDbTarget("/var/data/app.db"), f)).toBe(resolve("/var/data/app.db"));
  });

  test("the emitted specifier, resolved against the module, is the same absolute file", () => {
    const src = resolve("/proj/src/pages/admin/panel.scrml");
    const out = resolve("/proj/dist");
    const base = resolve("/proj/src");
    // pages/ is stripped from the dist layout (api.js pathFor): dist/admin/.
    expect(emittedModuleDir(src, out, base)).toBe(resolve("/proj/dist/admin"));
    const arg = sqliteFileHandleArg("../../data/app.db", src, out, base);
    expect(arg).toBe('_scrml_sqlite_file("../../src/data/app.db", "../../data/app.db")');
    const spec = JSON.parse(/\("([^"]*)"/.exec(arg)[0].slice(1));
    const moduleUrl = pathToFileURL(join(emittedModuleDir(src, out, base), "panel.server.js"));
    expect(fileURLToPath(new URL(spec, moduleUrl))).toBe(resolveDbFilePath(classifyDbTarget("../../data/app.db"), src));
  });

  test("a filename that is not URL-safe survives the round trip", () => {
    const dir = resolve("/proj/src");
    const spec = sqliteRuntimeSpecifier(join(dir, "my data #1?.db"), resolve("/proj/dist"), false);
    expect(spec).toBe("../src/my%20data%20%231%3F.db");
    expect(fileURLToPath(new URL(spec, pathToFileURL(resolve("/proj/dist/app.server.js"))))).toBe(join(dir, "my data #1?.db"));
  });

  test("no output location known → the absolute file: URL; an authored absolute path stays absolute", () => {
    expect(sqliteRuntimeSpecifier(resolve("/proj/src/app.db"), null, false)).toBe(pathToFileURL(resolve("/proj/src/app.db")).href);
    expect(sqliteRuntimeSpecifier(resolve("/var/data/app.db"), resolve("/proj/dist"), true)).toBe(pathToFileURL(resolve("/var/data/app.db")).href);
  });

  test(":memory:, sqlite::memory: and network drivers are not files", () => {
    for (const v of [":memory:", "sqlite::memory:", "postgres://u@h/d", "mysql://u@h/d"]) {
      expect(sqliteFileHandleArg(v, resolve("/proj/src/app.scrml"), resolve("/proj/dist"), resolve("/proj/src"))).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// §2 — compile and the emitted server agree on the file
// ---------------------------------------------------------------------------

describe("§2 the compiled module opens the file the compile-time schema read opened", () => {
  test("single-file compile and a multi-root (stale-artifact) compile both open src/app.db", () => {
    const root = join(_tmp.root, "agree");
    mkdirSync(join(root, "src", "ports"), { recursive: true });
    writeFileSync(join(root, "src", "app.scrml"), APP);
    seedDb(join(root, "src", "app.db"));
    // A second source one level down, so a directory compile's output base is src/
    // and its artifacts land in a different dist subtree than the single-file one.
    writeFileSync(join(root, "src", "ports", "tool.scrml"),
      `<program kind="tool" lang="ts" db="../app.db">\nfunction main(args: string[]): number {\n  const r = ?{\`SELECT n FROM t\`}.all()\n  return r.length\n}\n</program>\n`);

    const single = compileScrml({ inputFiles: [join(root, "src", "app.scrml")], write: true, outputDir: join(root, "src", "dist"), log: () => {} });
    expect((single.errors ?? []).filter((e) => e.severity !== "warning" && !String(e.code).startsWith("W-"))).toEqual([]);
    const multi = compileScrml({
      inputFiles: [join(root, "src", "app.scrml"), join(root, "src", "ports", "tool.scrml")],
      write: true, outputDir: join(root, "out"), log: () => {},
    });
    expect((multi.errors ?? []).filter((e) => e.severity !== "warning" && !String(e.code).startsWith("W-"))).toEqual([]);

    const want = join(root, "src", "app.db");
    expect(opensFile(join(root, "src", "dist", "app.server.js"))).toBe(want);
    expect(opensFile(join(root, "out", "app.server.js"))).toBe(want);
    expect(opensFile(join(root, "out", "ports", "tool.js"))).toBe(want);
    // No CWD-relative literal anywhere.
    expect(readFileSync(join(root, "out", "app.server.js"), "utf8")).not.toContain('new SQL("sqlite:');
  });
});

// ---------------------------------------------------------------------------
// §3 — `scrml dev` (the real CLI, the PA-reproduced shape)
// ---------------------------------------------------------------------------

describe("§3 scrml dev run from the project root", () => {
  test("serves from the real src/app.db and creates NO database file", async () => {
    const root = join(_tmp.root, "devdb");
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "app.scrml"), APP);
    seedDb(join(root, "src", "app.db"));
    const before = dbFilesUnder(root);
    expect(before).toEqual(["src/app.db"]);

    const compiled = Bun.spawnSync(["bun", CLI, "compile", "src/app.scrml"], { cwd: root, stdout: "pipe", stderr: "pipe" });
    expect(compiled.exitCode).toBe(0);

    const dev = await startDev(root, "src/app.scrml");
    let answer;
    try {
      const route = /POST\s+(\/_scrml\/__ri_route_count_\d+)/.exec(dev.log())?.[1];
      expect(route).toBeDefined();
      // The baseline double-submit CSRF gate: header token == cookie token.
      const r = await fetch(`http://localhost:${dev.port}${route}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": "t445", Cookie: "scrml_csrf=t445" },
        body: "{}",
      });
      expect(r.status).toBe(200);
      answer = await r.json();
    } finally {
      await stopDev(dev);
    }
    // 3 seeded rows → the dev server read the REAL database, not a fresh empty one.
    expect(answer).toBe(3);
    // The bug: dev created ./app.db at the project root. Only src/app.db (plus the
    // WAL side files its own open legitimately produces) may exist.
    const after = dbFilesUnder(root).filter((f) => !/^src\/app\.db-(wal|shm)$/.test(f));
    expect(after).toEqual(["src/app.db"]);
    expect(existsSync(join(root, "app.db"))).toBe(false);

    // And the next compile still passes (flogence step 3).
    const again = Bun.spawnSync(["bun", CLI, "compile", "src/app.scrml"], { cwd: root, stdout: "pipe", stderr: "pipe" });
    expect(again.exitCode).toBe(0);
    expect(again.stdout.toString() + again.stderr.toString()).not.toContain("E-PA-004");
  }, 90_000);

  test("a missing database is a loud error naming the path, and nothing is created", async () => {
    const root = join(_tmp.root, "missing");
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "app.scrml"), BOOTSTRAP_APP);
    const dev = await startDev(root, "src/app.scrml");
    let log;
    try {
      log = dev.log();
    } finally {
      await stopDev(dev);
    }
    expect(dbFilesUnder(root)).toEqual([]);
    expect(log).toContain("database file not found: " + join(root, "src", "boot.db"));
    expect(log).toContain('declared as "./boot.db"');
    // The next compile is unaffected — no stub appeared to poison the schema read.
    const again = Bun.spawnSync(["bun", CLI, "compile", "src/app.scrml"], { cwd: root, stdout: "pipe", stderr: "pipe" });
    expect(again.exitCode).toBe(0);
  }, 90_000);
});
