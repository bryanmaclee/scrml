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
 * THE FIX: one resolver (`db-target.ts resolveDbFilePath`) for both halves. The
 * emitted handle records that file relative to the project root and resolves it at
 * runtime against SCRML_DATA_DIR ?? the recorded root (SPEC §47.14, S445 data root).
 * Creation follows PER-FILE ownership (SPEC §8.1.1, S445 per-file ownership,
 * `db-ownership.ts`): only a file that declares the database's schema (its own CREATE
 * TABLE or a <schema>) may create it — its handle opens at load; every other handle
 * opens lazily on first use, never creates, and fails loudly — naming the path — if
 * the file is still missing then. At compile time an OWNED database that exists with
 * no tables is read like an absent one.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync, mkdtempSync, cpSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, resolve, dirname, relative, sep } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { Database } from "bun:sqlite";
import { perRunTmp } from "../helpers/per-run-tmp.js";
import { compileScrml } from "../../src/api.js";
import { classifyDbTarget, resolveDbFilePath } from "../../src/db-target.ts";
import { runtimeDbPath, projectRootFor, sqliteFileHandle } from "../../src/codegen/sqlite-file-target.ts";
import { decideOwnedDbFiles, fileDefaultDbValue, sqlDeclaresTable } from "../../src/db-ownership.ts";
import { failedModuleRoutes } from "../../src/commands/dev.js";
import { emittedDbFile } from "../helpers/self-host-server-import.js";

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

// A self-bootstrapping app: it declares its own table (CREATE TABLE), so it OWNS
// boot.db (S445 ruling) — it compiles with no database file and the run creates it.
const BOOTSTRAP_APP = `<program db="./boot.db">
  \${
    function ensure() {
      ?{\`CREATE TABLE IF NOT EXISTS t (n INTEGER)\`}.run()
      ?{\`INSERT INTO t (n) VALUES (7)\`}.run()
      const rows = ?{\`SELECT n FROM t\`}.all()
      return rows.length
    }
    <n> = 0
  }
  <button onclick=\${@n = ensure()}>go</button>
</program>
`;

// A REFERENCING app: it only reads ref.db and declares no schema for it, so it never
// creates it (S445 ruling). No <db tables=> block, so the compile does not need it.
const REFERENCE_APP = `<program db="./ref.db">
  \${
    function count() {
      const rows = ?{\`SELECT n FROM t\`}.all()
      return rows.length
    }
    <n> = 0
  }
  <button onclick=\${@n = count()}>go</button>
</program>
`;

// OWNING + a <db tables=> block, for the compile-time empty-file rule.
const OWNING_DB_BLOCK_APP = `<program db="./o.db">
  <db src="./o.db" tables="t">
    \${
      function ensure() {
        ?{\`CREATE TABLE IF NOT EXISTS t (n INTEGER)\`}.run()
        return 1
      }
      <n> = 0
    }
    <button onclick=\${@n = ensure()}>go</button>
  </db>
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
  const found = emittedDbFile(readFileSync(modulePath, "utf8"));
  if (!found) throw new Error("no SQLite-file handle in " + modulePath);
  return found.file;
}

/** Start `scrml dev <entry> --port 0` from `cwd`; resolve with the port and a log getter. */
async function startDev(cwd, entryRel, env = process.env) {
  const proc = Bun.spawn(["bun", CLI, "dev", entryRel, "--port", "0"], {
    cwd, stdout: "pipe", stderr: "pipe", stdin: "ignore", env,
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

  test("§47.14 — the handle records the file relative to the PROJECT ROOT (no manifest → the build root)", () => {
    const src = resolve("/proj/src/pages/admin/panel.scrml");
    const base = resolve("/proj/src");
    expect(projectRootFor(src, base)).toBe(base); // /proj has no scrml.toml / .git
    const ref = sqliteFileHandle("../../data/app.db", src, base, new Set());
    expect(ref).toEqual({
      expr: '_scrml_sqlite_referenced("data/app.db", "../../data/app.db", "pages/admin/panel.scrml")',
      owns: false,
      projectRoot: base.split(sep).join("/"),
      // s447 — what `scrml build` learns about the handle (report / warnings / health check).
      record: {
        dbPath: "data/app.db",
        recordedAbsolute: false,
        absPath: resolve("/proj/src/data/app.db"),
        owns: false,
        declaredAs: "../../data/app.db",
        declaredIn: src,
        projectRoot: base.split(sep).join("/"),
        projectRootFrom: "build",
      },
    });
    // Owned (this file declares the schema) → opens at load and may create.
    const owned = new Set([resolveDbFilePath(classifyDbTarget("../../data/app.db"), src)]);
    expect(sqliteFileHandle("../../data/app.db", src, base, owned).expr)
      .toBe('new SQL(_scrml_sqlite_owned("data/app.db", "../../data/app.db", "pages/admin/panel.scrml"))');
  });

  test("§47.14 — a scrml.toml makes the project root a property of the FILE, not the build", () => {
    const root = join(_tmp.root, "manifest-root");
    mkdirSync(join(root, "src", "pages"), { recursive: true });
    writeFileSync(join(root, "scrml.toml"), "");
    const src = join(root, "src", "pages", "p.scrml");
    writeFileSync(src, "");
    // Whatever the build root, the manifest wins.
    expect(projectRootFor(src, join(root, "src", "pages"))).toBe(root);
    expect(projectRootFor(src, join(root, "src"))).toBe(root);
    expect(runtimeDbPath(join(root, "src", "app.db"), root, false)).toBe("src/app.db");
  });

  test("§47.14 — outside the project root, or authored absolute: recorded absolute (the data root does not move it)", () => {
    expect(runtimeDbPath(resolve("/elsewhere/app.db"), resolve("/proj"), false)).toBe(resolve("/elsewhere/app.db").split(sep).join("/"));
    expect(runtimeDbPath(resolve("/proj/app.db"), resolve("/proj"), true)).toBe(resolve("/proj/app.db").split(sep).join("/"));
  });

  test("a `file:` URI is refused (E-SQL-005), never resolved as a file named `file:…` (F8)", () => {
    for (const v of ["file:./x.db", "FILE:x.db", "file:///tmp/x.db"]) {
      expect(classifyDbTarget(v).kind).toBe("unsupported-scheme");
      expect(sqliteFileHandle(v, resolve("/proj/src/app.scrml"), resolve("/proj/src"), new Set())).toBeNull();
    }
  });

  test(":memory:, sqlite::memory: and network drivers are not files", () => {
    for (const v of [":memory:", "sqlite::memory:", "postgres://u@h/d", "mysql://u@h/d"]) {
      expect(sqliteFileHandle(v, resolve("/proj/src/app.scrml"), resolve("/proj/src"), new Set())).toBeNull();
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

  test("REFERENCING program, missing database: loads fine, first use is a loud 500 naming the path, nothing created", async () => {
    const root = join(_tmp.root, "missing");
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "app.scrml"), REFERENCE_APP);
    const dev = await startDev(root, "src/app.scrml");
    let log, rpc;
    try {
      // S445 per-file ownership — a referencing handle does not open at load, so the
      // module loads and its routes mount; the error comes at first use.
      expect(dev.log()).not.toContain("Failed to import");
      const route = /POST\s+(\/_scrml\/__ri_route_count_\d+)/.exec(dev.log())?.[1];
      expect(route).toBeDefined();
      const r = await fetch(`http://localhost:${dev.port}${route}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": "t445", Cookie: "scrml_csrf=t445" },
        body: "{}",
      });
      rpc = { status: r.status, body: await r.text() };
      log = dev.log();
    } finally {
      await stopDev(dev);
    }
    expect(rpc.status).toBe(500);
    // S447 round 7 (§14.8.9 error egress): the CLIENT gets the fixed, value-free 500 —
    // a server filesystem path is server data (cf. §47 "the health body SHALL NOT name
    // the paths"), exactly as the prod entry answers. "Fails loudly" is the server log,
    // asserted below.
    expect(JSON.parse(rpc.body)).toEqual({ error: "Internal server error" });
    expect(rpc.body).not.toContain("ref.db");
    expect(dbFilesUnder(root)).toEqual([]);
    expect(log).toContain("database file not found: " + join(root, "src", "ref.db"));
    expect(log).toContain('declared as "./ref.db" in app.scrml');
    // The next compile is unaffected — no stub appeared to poison the schema read.
    const again = Bun.spawnSync(["bun", CLI, "compile", "src/app.scrml"], { cwd: root, stdout: "pipe", stderr: "pipe" });
    expect(again.exitCode).toBe(0);
  }, 90_000);

  test("OWNING program, no database file: the run creates it beside the .scrml file and uses it", async () => {
    const root = join(_tmp.root, "owning");
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "app.scrml"), BOOTSTRAP_APP);
    expect(dbFilesUnder(root)).toEqual([]);
    const dev = await startDev(root, "src/app.scrml");
    let answer;
    try {
      expect(dev.log()).not.toContain("database file not found");
      const route = /POST\s+(\/_scrml\/__ri_route_ensure_\d+)/.exec(dev.log())?.[1];
      expect(route).toBeDefined();
      const r = await fetch(`http://localhost:${dev.port}${route}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": "t445", Cookie: "scrml_csrf=t445" },
        body: "{}",
      });
      expect(r.status).toBe(200);
      answer = await r.json();
      answer = { value: answer, log: dev.log() };
    } finally {
      await stopDev(dev);
    }
    // S445 review F1 — the creation is announced, once, naming the file and the source.
    expect(answer.log).toContain(`scrml: created new database ${join(root, "src", "boot.db")} (declared as "./boot.db" in app.scrml)`);
    answer = answer.value;
    expect(answer).toBe(1);
    // Created where db="./boot.db" names it — beside src/app.scrml, not at the CWD.
    expect(dbFilesUnder(root).filter((f) => !/-(wal|shm)$/.test(f))).toEqual(["src/boot.db"]);
    const db = new Database(join(root, "src", "boot.db"));
    expect(db.query("SELECT n FROM t").all()).toEqual([{ n: 7 }]);
    db.close();
  }, 90_000);

  test("SCRML_DATA_DIR exported: dev IGNORES it — the owning db is created beside the declaring file (S445: dev keeps item 6)", async () => {
    const root = join(_tmp.root, "owning-datadir");
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "app.scrml"), BOOTSTRAP_APP);
    const vol = join(root, "devvol");
    mkdirSync(vol, { recursive: true });
    const dev = await startDev(root, "src/app.scrml", { ...process.env, SCRML_DATA_DIR: vol });
    let log;
    try {
      // the owning handle opens (and creates) at load; wait for the announcement
      for (const t0 = Date.now(); Date.now() - t0 < 15_000 && !dev.log().includes("created new database"); await Bun.sleep(100)) { /* wait */ }
      log = dev.log();
    } finally {
      await stopDev(dev);
    }
    expect(log).toContain(`scrml dev: ignoring SCRML_DATA_DIR=${vol}`);
    expect(log).toContain(`scrml: created new database ${join(root, "src", "boot.db")}`);
    expect(dbFilesUnder(vol)).toEqual([]);
    expect(existsSync(join(root, "src", "boot.db"))).toBe(true);
  }, 90_000);
});

// ---------------------------------------------------------------------------
// §4 — ownership at compile time
// ---------------------------------------------------------------------------

describe("§4 ownership at compile time (S445 ruling)", () => {
  const compileIn = (root, name, src) => {
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, name), src);
    return compileScrml({ inputFiles: [join(root, name)], write: true, outputDir: join(root, "dist"), log: () => {} });
  };
  const errorCodes = (r) => (r.errors ?? []).filter((e) => e.severity !== "warning" && !String(e.code).startsWith("W-") && !String(e.code).startsWith("I-")).map((e) => e.code);

  test("an OWNED database that exists with no tables is read like an absent one (touch → compile passes)", () => {
    const root = join(_tmp.root, "owned-empty");
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "o.db"), ""); // `touch o.db`
    const r = compileIn(root, "app.scrml", OWNING_DB_BLOCK_APP);
    expect(errorCodes(r)).toEqual([]);
    expect(emittedDbFile(readFileSync(join(root, "dist", "app.server.js"), "utf8"))).toEqual({ file: join(root, "o.db"), owns: true });
  });

  test("a REFERENCED database that exists with no tables is still E-PA-004 (EMPTY)", () => {
    const root = join(_tmp.root, "referenced-empty");
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "app.db"), "");
    const r = compileIn(root, "app.scrml", APP); // reads t, declares no schema for app.db
    expect(errorCodes(r)).toContain("E-PA-004");
    expect((r.errors ?? []).map((e) => e.message).join("\n")).toContain("EMPTY");
  });

  test("ownership is PER DECLARING FILE: a file that only reads the db another file declares stays referencing, alone or in a build", () => {
    const root = join(_tmp.root, "per-file");
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "lib.scrml"),
      `<db src="./shared.db" tables="t" />\n\${\nexport function ensure() {\n  ?{\`CREATE TABLE IF NOT EXISTS t (n INTEGER)\`}.run()\n}\n}\n`);
    writeFileSync(join(root, "reader.scrml"), REFERENCE_APP.replace("./ref.db", "./shared.db"));
    const both = compileScrml({
      inputFiles: [join(root, "reader.scrml"), join(root, "lib.scrml")],
      write: true, outputDir: join(root, "dist"), log: () => {},
    });
    expect(errorCodes(both)).toEqual([]);
    const alone = compileScrml({ inputFiles: [join(root, "reader.scrml")], write: true, outputDir: join(root, "dist-alone"), log: () => {} });
    expect(errorCodes(alone)).toEqual([]);
    const handleLine = (p) => /^const _scrml_sql = .*;$/m.exec(readFileSync(p, "utf8"))[0];
    const inBuild = handleLine(join(root, "dist", "reader.server.js"));
    expect(inBuild).toMatch(/^const _scrml_sql = _scrml_db_guard\(_scrml_sqlite_referenced\(/); // §19.10.6 guard
    // The ruling's point: the answer does not depend on which files are in the build.
    expect(handleLine(join(root, "dist-alone", "reader.server.js"))).toBe(inBuild);
    expect(emittedDbFile(readFileSync(join(root, "dist", "reader.server.js"), "utf8"))).toEqual({ file: join(root, "shared.db"), owns: false });
  });

  test("a <schema> block makes its file the owner", () => {
    const root = join(_tmp.root, "schema-owner");
    const r = compileIn(root, "app.scrml",
      `<program db="./s.db">\n<schema>\n    notes { id: integer primary key\n            body: text }\n</>\n\${\nfunction add(body) {\n    ?{\`INSERT INTO notes (body) VALUES (\${body})\`}.run()\n}\n}\n<button onclick=add("x")>add</button>\n</program>\n`);
    expect(errorCodes(r)).toEqual([]);
    expect(emittedDbFile(readFileSync(join(root, "dist", "app.server.js"), "utf8"))).toEqual({ file: join(root, "s.db"), owns: true });
  });

  test("examples/23: every page module emits the IDENTICAL handle compiled alone and inside `scrml build .` (S445 per-file)", () => {
    const ex = resolve(testDir, "../../../examples/23-trucking-dispatch");
    const pages = ["pages/dispatch/board.scrml", "pages/driver/messages.scrml", "pages/customer/home.scrml"];
    const out = join(_tmp.root, "ex23-build");
    const b = Bun.spawnSync(["bun", CLI, "build", ex, "-o", out], { stdout: "pipe", stderr: "pipe" });
    expect(b.exitCode).toBe(0);
    const handleLine = (p) => /^const _scrml_sql = .*;$/m.exec(readFileSync(p, "utf8"))?.[0];
    for (const page of pages) {
      const alone = join(_tmp.root, "ex23-alone", page.replace(/\W/g, "_"));
      compileScrml({ inputFiles: [join(ex, page)], write: true, outputDir: alone, log: () => {} });
      // The page's own module (the alone compile may gather imports, so search the tree).
      const want = page.split("/").pop().replace(/\.scrml$/, ".server.js");
      const find = (d) => {
        for (const e of readdirSync(d, { withFileTypes: true })) {
          const p = join(d, e.name);
          if (e.isDirectory()) { const f = find(p); if (f) return f; } else if (e.name === want) return p;
        }
        return null;
      };
      const aloneJs = find(alone);
      expect(aloneJs).not.toBeNull();
      const builtJs = join(out, page.replace(/^pages\//, "").replace(/\.scrml$/, ".server.js"));
      const a = handleLine(aloneJs);
      expect(a).toMatch(/^const _scrml_sql = _scrml_db_guard\(_scrml_sqlite_referenced\("examples\/23-trucking-dispatch\/dispatch\.db", /); // §19.10.6 guard
      expect(handleLine(builtJs)).toBe(a);
    }
  }, 120_000);
});

// ---------------------------------------------------------------------------
// §5 — S445 review findings (F1 F3 F5 F6 F7)
// ---------------------------------------------------------------------------

describe("§5 S445 review findings", () => {
  test("F5 — `creates a table` is read per statement, not by substring", () => {
    // owning
    expect(sqlDeclaresTable("CREATE TABLE t (n INTEGER)")).toBe(true);
    expect(sqlDeclaresTable("create table if not exists t (n integer)")).toBe(true);
    expect(sqlDeclaresTable("CREATE TABLE t AS SELECT 1 AS n")).toBe(true);
    expect(sqlDeclaresTable("CREATE VIRTUAL TABLE docs USING fts5(body)")).toBe(true);
    expect(sqlDeclaresTable("CREATE TABLE main.t (n INTEGER)")).toBe(true);
    expect(sqlDeclaresTable(`CREATE TABLE "my t" (n INTEGER)`)).toBe(true);
    expect(sqlDeclaresTable("SELECT 1; CREATE TABLE t (n INTEGER)")).toBe(true);
    // not owning
    expect(sqlDeclaresTable("/* CREATE TABLE t (n INTEGER) */ SELECT 1")).toBe(false);
    expect(sqlDeclaresTable("-- CREATE TABLE t (n INTEGER)\nSELECT 1")).toBe(false);
    expect(sqlDeclaresTable("INSERT INTO log (msg) VALUES ('CREATE TABLE t (n INTEGER)')")).toBe(false);
    expect(sqlDeclaresTable("CREATE TABLE other.t (n INTEGER)")).toBe(false);
    expect(sqlDeclaresTable("CREATE TEMP TABLE t (n INTEGER)")).toBe(false);
    expect(sqlDeclaresTable("CREATE TEMPORARY TABLE t AS SELECT 1")).toBe(false);
    expect(sqlDeclaresTable("SELECT n FROM t")).toBe(false);
    expect(sqlDeclaresTable("CREATE INDEX i ON t (n)")).toBe(false);
  });

  // S451 (§8.1.1 nearest scope) — this test used to pin BOTH statements onto the file's
  // first <db src> (a.db), `CREATE TABLE u` included although `u` is b.db's table: the
  // wrong-database behaviour g-impl1-db-resolution-not-nearest-s451 fixed. A `?{}`
  // outside both scopes of a two-database file now has no database (E-SQL-004, never
  // a silent default); written inside its scope, each statement owns ITS database.
  test("F6 — a `?{}` outside both <db src> scopes of a two-database module is refused, not run on the first", () => {
    const root = join(_tmp.root, "f6");
    mkdirSync(root, { recursive: true });
    const src = `<db src="./a.db" tables="t" />\n<db src="./b.db" tables="u" />\n\${\nexport function ensure() {\n  ?{\`CREATE TABLE IF NOT EXISTS t (n INTEGER)\`}.run()\n  ?{\`CREATE TABLE IF NOT EXISTS u (n INTEGER)\`}.run()\n}\n}\n`;
    writeFileSync(join(root, "lib.scrml"), src);
    const r = compileScrml({ inputFiles: [join(root, "lib.scrml")], write: true, outputDir: join(root, "dist"), log: () => {} });
    const codes = (r.errors ?? []).map((e) => e.code);
    expect(codes).toContain("E-SQL-004");
  });

  test("F6 — a `?{}` declares for the database codegen runs it on (its nearest <db src>)", () => {
    const root = join(_tmp.root, "f6-scoped");
    mkdirSync(root, { recursive: true });
    const src = `<program>\n<db src="./a.db" tables="t">\n\${\nfunction ensureT() {\n  ?{\`CREATE TABLE IF NOT EXISTS t (n INTEGER)\`}.run()\n}\n}\n<p>a</p>\n</>\n<db src="./b.db" tables="u">\n\${\nfunction ensureU() {\n  ?{\`CREATE TABLE IF NOT EXISTS u (n INTEGER)\`}.run()\n}\n}\n<p>b</p>\n</>\n</program>\n`;
    writeFileSync(join(root, "app.scrml"), src);
    const r = compileScrml({ inputFiles: [join(root, "app.scrml")], write: true, outputDir: join(root, "dist"), log: () => {} });
    const fatal = (r.errors ?? []).filter((e) => e.severity !== "warning" && !String(e.code).startsWith("W-") && !String(e.code).startsWith("I-"));
    expect(fatal).toEqual([]);
    const all = readdirSync(join(root, "dist")).filter((f) => f.endsWith(".js"))
      .map((f) => readFileSync(join(root, "dist", f), "utf8")).join("\n");
    expect(all).toMatch(/new SQL\(_scrml_sqlite_owned\("[^"]*\/a\.db", "\.\/a\.db", "app\.scrml"\)\)/);
    expect(all).toMatch(/new SQL\(_scrml_sqlite_owned\("[^"]*\/b\.db", "\.\/b\.db", "app\.scrml"\)\)/);
  });

  test("F1(b) — W-DB-PATH-RESOLVES-ELSEWHERE names both files when the path was written for the CWD", () => {
    const root = join(_tmp.root, "f1b");
    mkdirSync(join(root, "src"), { recursive: true });
    seedDb(join(root, "app.db")); // the REAL database, at the project root (the old CWD-relative spot)
    writeFileSync(join(root, "src", "app.scrml"), BOOTSTRAP_APP.replace(/\.\/boot\.db/g, "./app.db"));
    const c = Bun.spawnSync(["bun", CLI, "compile", "src/app.scrml"], { cwd: root, stdout: "pipe", stderr: "pipe" });
    const out = c.stdout.toString() + c.stderr.toString();
    expect(c.exitCode).toBe(0); // a warning, never an error
    expect(out).toContain("W-DB-PATH-RESOLVES-ELSEWHERE");
    expect(out).toContain(join(root, "src", "app.db")); // the file the program uses
    expect(out).toContain(join(root, "app.db"));        // the one it was probably written for
    expect(out).toContain(`"../app.db"`);                // the suggested path
    // No warning once the declared file itself has tables.
    seedDb(join(root, "src", "app.db"));
    const c2 = Bun.spawnSync(["bun", CLI, "compile", "src/app.scrml"], { cwd: root, stdout: "pipe", stderr: "pipe" });
    expect(c2.stdout.toString() + c2.stderr.toString()).not.toContain("W-DB-PATH-RESOLVES-ELSEWHERE");
  });

  test("F3 — dev mounts only the server modules THIS compile wrote; a leftover is never imported", async () => {
    const root = join(_tmp.root, "f3");
    mkdirSync(join(root, "src", "dist", "src"), { recursive: true });
    writeFileSync(join(root, "src", "app.scrml"), APP);
    seedDb(join(root, "src", "app.db"));
    // A leftover from an earlier compile whose module init has a side effect.
    const marker = join(root, "stale-module-ran");
    writeFileSync(join(root, "src", "dist", "src", "old.server.js"),
      `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(marker)}, "x");\n` +
      `export const __ri_route_old_1 = { path: "/_scrml/__ri_route_old_1", method: "POST", handler: () => new Response("old") };\n`);
    const dev = await startDev(root, "src/app.scrml");
    let log;
    try { log = dev.log(); } finally { await stopDev(dev); }
    expect(existsSync(marker)).toBe(false);
    expect(log).toContain("Not loading 1 .server.js file this compile did not produce");
    expect(log).toContain("src/old.server.js");
    expect(log).toMatch(/POST\s+\/_scrml\/__ri_route_count_\d+/); // the current module IS mounted
  }, 90_000);

  test("F7 — failedModuleRoutes turns each declared route of an unloadable module into a 500", async () => {
    const root = join(_tmp.root, "f7");
    mkdirSync(root, { recursive: true });
    const p = join(root, "m.server.js");
    writeFileSync(p, `export const __ri_route_count_3 = {\n  path: "/_scrml/__ri_route_count_3",\n  method: "POST",\n  handler: h,\n};\n`);
    const routes = failedModuleRoutes(p, "m.server.js", new Error("scrml: database file not found: /x/ref.db"));
    expect(routes.map((r) => `${r.method} ${r.path}`)).toEqual(["POST /_scrml/__ri_route_count_3"]);
    const res = await routes[0].handler();
    expect(res.status).toBe(500);
    expect(await res.text()).toContain("database file not found: /x/ref.db");
  });

  test("F6 — fileDefaultDbValue: first <db src>, else the first un-named <program db>", () => {
    const prog = (db, children = [], extra = []) => ({ kind: "markup", tag: "program", attributes: [{ name: "db", value: { value: db } }, ...extra], children });
    const dbsrc = (src) => ({ kind: "state", stateType: "db", attrs: [{ name: "src", value: { kind: "string-literal", value: src } }], children: [] });
    expect(fileDefaultDbValue([prog("./p.db", [dbsrc("./a.db"), dbsrc("./b.db")])])).toBe("./a.db");
    expect(fileDefaultDbValue([prog("./p.db")])).toBe("./p.db");
    expect(fileDefaultDbValue([prog("./named.db", [], [{ name: "name", value: { value: "x" } }]), prog("./p.db")])).toBe("./p.db");
    expect(fileDefaultDbValue([])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// §6 — the runtime data root (§47.14, S445 "data root")
// ---------------------------------------------------------------------------

describe("§6 data root: SCRML_DATA_DIR ?? the project root recorded at build", () => {
  // Projects OUTSIDE the scrml repo, so the project root is the fixture's own scrml.toml.
  const fixture = (name, app, seed) => {
    const root = mkdtempSync(join(tmpdir(), `s445-dataroot-${name}-`));
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "scrml.toml"), "");
    writeFileSync(join(root, "src", "app.scrml"), app);
    if (seed) seedDb(join(root, "src", "app.db"));
    const r = compileScrml({ inputFiles: [join(root, "src", "app.scrml")], write: true, outputDir: join(root, "dist"), log: () => {} });
    const fatal = (r.errors ?? []).filter((e) => e.severity !== "warning" && !String(e.code).startsWith("W-") && !String(e.code).startsWith("I-"));
    expect(fatal).toEqual([]);
    return root;
  };
  const call = async (serverPath, routePart) => {
    const mod = await import(`file://${serverPath}?v=${Date.now()}-${Math.random()}`);
    const route = Object.values(mod).find((v) => v && typeof v === "object" && typeof v.path === "string" && v.path.includes(routePart));
    const res = await route.handler(new Request(`http://localhost${route.path}`, {
      method: route.method,
      headers: { "Content-Type": "application/json", "X-CSRF-Token": "t", Cookie: "scrml_csrf=t" },
      body: "{}",
    }));
    return { status: res.status, body: await res.text() };
  };
  const withDataDir = async (dir, fn) => {
    const prev = process.env.SCRML_DATA_DIR;
    if (dir === null) delete process.env.SCRML_DATA_DIR; else process.env.SCRML_DATA_DIR = dir;
    try { return await fn(); } finally {
      if (prev === undefined) delete process.env.SCRML_DATA_DIR; else process.env.SCRML_DATA_DIR = prev;
    }
  };

  test("the handle records `src/app.db` (project-root-relative) and the project root", () => {
    const root = fixture("record", APP.replace(/<db src="\.\/app\.db" tables="t">/, "<div>").replace("</db>", "</div>"), true);
    const js = readFileSync(join(root, "dist", "app.server.js"), "utf8");
    expect(js).toContain('const _scrml_sql = _scrml_db_guard(_scrml_sqlite_referenced("src/app.db", "./app.db", "app.scrml"), "sqlite", false);'); // §19.10.6 guard
    expect(js).toContain(`const _scrml_project_root = ${JSON.stringify(root.split(sep).join("/"))};`);
  });

  test("unset → the project root; set → the same relative path under SCRML_DATA_DIR", async () => {
    const root = fixture("ref", REFERENCE_APP.replace("./ref.db", "./app.db"), true);
    const server = join(root, "dist", "app.server.js");
    expect(await withDataDir(null, () => call(server, "count"))).toEqual({ status: 200, body: "3" });
    const data = mkdtempSync(join(tmpdir(), "s445-data-"));
    mkdirSync(join(data, "src"), { recursive: true });
    const db = new Database(join(data, "src", "app.db"), { create: true });
    db.run("CREATE TABLE t (n INTEGER)"); db.run("INSERT INTO t VALUES (1)"); db.close();
    // A second copy of the build: Bun caches a module by path (a `?v=` query does not
    // give a fresh instance), and the first instance's handle is already open.
    const copy = mkdtempSync(join(tmpdir(), "s445-copy-"));
    cpSync(join(root, "dist"), copy, { recursive: true });
    expect(await withDataDir(data, () => call(join(copy, "app.server.js"), "count"))).toEqual({ status: 200, body: "1" });
  });

  test("a MOVED build with no SCRML_DATA_DIR refuses to guess — owning handle fails at load naming SCRML_DATA_DIR, nothing created", async () => {
    const root = fixture("moved", BOOTSTRAP_APP.replace("./boot.db", "./app.db"), false);
    const moved = mkdtempSync(join(tmpdir(), "s445-moved-"));
    cpSync(join(root, "dist"), moved, { recursive: true });
    const moved2 = mkdtempSync(join(tmpdir(), "s445-moved2-")); // a fresh module instance for the second run
    cpSync(join(root, "dist"), moved2, { recursive: true });
    rmSync(root, { recursive: true, force: true }); // the deploy target has no project
    let err = null;
    try {
      await withDataDir(null, () => import(`file://${join(moved, "app.server.js")}?v=${Date.now()}-${Math.random()}`));
    } catch (e) { err = e; }
    expect(String(err?.message)).toContain("SCRML_DATA_DIR is not set");
    expect(String(err?.message)).toContain('"src/app.db"');
    // With the data root set (what the generated Dockerfile does), it creates there.
    const data = mkdtempSync(join(tmpdir(), "s445-vol-"));
    expect(await withDataDir(data, () => call(join(moved2, "app.server.js"), "ensure"))).toEqual({ status: 200, body: "1" });
    expect(existsSync(join(data, "src", "app.db"))).toBe(true);
  });
});
