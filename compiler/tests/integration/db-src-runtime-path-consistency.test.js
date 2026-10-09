/**
 * ss19 #9 (g-db-src-compile-vs-runtime-path) — a `<db src=>` referenced from
 * source files in DIFFERENT directories must emit a runtime path that resolves
 * to the SAME physical database.
 *
 * REPRO (from /tmp/ryan-verify/proj-auth):
 *   app.scrml          (project root)   <db src="./m.db">   -> sqlite:./m.db
 *   pages/login.scrml  (subdir)         <db src="../m.db">  -> sqlite:../m.db   (BUG)
 *
 * Both `src=` values resolve to the SAME file at COMPILE time (the compiler
 * resolves them relative to the source file, in protect-analyzer). But the
 * emitted `sqlite:` literal is opened CWD-relative at RUNTIME. Run from the
 * project root, `app` opens `./m.db` (= <root>/m.db, correct) while `login`
 * opens `../m.db` (= the PARENT of the project root — a different, empty file)
 * -> "no such table".
 *
 * FIX (ss19 #9) re-relativized the literal to the project root, which only works
 * when the process is STARTED in the project root.
 *
 * s445 (dev-db-side-file) replaced that: every emitted handle names the file the
 * compiler resolved (the declaring file's directory, §8.1.1), recorded relative to
 * the project root and resolved against SCRML_DATA_DIR ?? that root (§47.14). These
 * programs only reference the db, so their handles open lazily and never create.
 * Both modules open <root>/m.db from ANY working directory — asserted below from the
 * recorded path, and by running the page's route from an unrelated CWD.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { emittedDbFile } from "../helpers/self-host-server-import.js";
import { resolve, dirname, join } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync, readFileSync } from "fs";
import { perRunTmp } from "../helpers/per-run-tmp.js";
import { Database } from "bun:sqlite";
import { compileScrml } from "../../src/api.js";

// Executed-DB tests (compile, then a real driver round-trip) and the hooks that build them
// declare their own budget: bun's 5 s default is too tight on the slow Windows CI runner
// (g-windows-executed-db-tests-5s-timeout-s460). Per test, never a raised global default.
const EXECUTED_DB_TIMEOUT_MS = 30_000;

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
// Per-run scratch (S438) — see helpers/per-run-tmp.js (Windows EBUSY residue).
const _tmp = perRunTmp(resolve(testDir, "_tmp_db_src_path"));
const TMP_ROOT = _tmp.root;
let counter = 0;

beforeAll(_tmp.setup);
afterAll(_tmp.teardown);

const APP_SRC = `<program db="./m.db">
  <db src="./m.db" tables="items">
    \${
      <ids> = []
      function loadIds() { return ?{\`SELECT id FROM items\`}.all() }
      on mount { @ids = loadIds() }
    }
    <h1>home \${@ids}</h1>
  </>
</program>`;

const LOGIN_SRC = `<page auth="optional">
  <db src="../m.db" tables="items">
    \${
      <email> = ""
      function loginServer(e) {
        const row = ?{\`SELECT id FROM items WHERE label = \${e}\`}.get()
        return { ok: row is some }
      }
      function submit() { const r = loginServer(@email) }
    }
    <form onsubmit=submit()><input bind:value=@email/></form>
  </>
</page>`;

/** The absolute file an emitted module's SQLite handle opens (resolved against the module). */
function opensFile(serverPath, js) {
  const found = emittedDbFile(js);
  if (!found) throw new Error("no SQLite-file handle in " + serverPath);
  return found.file;
}

/** Build a multi-dir project (app at root + pages/login) and compile it. */
function buildProject() {
  const root = resolve(TMP_ROOT, `proj-${++counter}`);
  mkdirSync(join(root, "pages"), { recursive: true });
  const appPath = join(root, "app.scrml");
  const loginPath = join(root, "pages", "login.scrml");
  writeFileSync(appPath, APP_SRC);
  writeFileSync(loginPath, LOGIN_SRC);

  // Seed the shared db at the project root with a known row.
  const dbPath = join(root, "m.db");
  const db = new Database(dbPath, { create: true });
  db.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, label TEXT)");
  db.exec("INSERT INTO items (id, label) VALUES (1, 'known')");
  db.close();

  const outDir = join(root, "dist");
  const result = compileScrml({ inputFiles: [appPath, loginPath], write: true, outputDir: outDir });
  return {
    errors: result.errors ?? [],
    root,
    outDir,
    appServer: join(outDir, "app.server.js"),
    loginServer: join(outDir, "login.server.js"),
  };
}

describe("ss19 #9 — db src= emits a runtime-consistent path across directories", () => {
  test("subdir page + root entry both open the SAME db — the one the compiler read", () => {
    const { errors, root, appServer, loginServer } = buildProject();
    expect(errors.filter((e) => !e.code?.startsWith("W-"))).toEqual([]);
    expect(existsSync(appServer)).toBe(true);
    expect(existsSync(loginServer)).toBe(true);

    const appJs = readFileSync(appServer, "utf-8");
    const loginJs = readFileSync(loginServer, "utf-8");

    // No CWD-relative `sqlite:` literal survives in either module.
    expect(appJs).not.toContain('new SQL("sqlite:');
    expect(loginJs).not.toContain('new SQL("sqlite:');
    // The invariant: each module's handle, resolved against the module itself,
    // is the seeded <root>/m.db — the file both `src=` values name.
    expect(opensFile(appServer, appJs)).toBe(join(root, "m.db"));
    expect(opensFile(loginServer, loginJs)).toBe(join(root, "m.db"));
  });

  test("runtime: the subdir page opens the seeded db from an UNRELATED working directory", async () => {
    // happy-dom-polluted globals strip CSRF headers (see sql-server-fn-runtime).
    if (typeof globalThis.document !== "undefined") return;

    const { errors, root, loginServer } = buildProject();
    expect(errors.filter((e) => !e.code?.startsWith("W-"))).toEqual([]);

    const cwdBefore = process.cwd();
    process.chdir(tmpdir()); // NOT the project root: the CWD must play no part (s445)
    try {
      const mod = await import(`file://${loginServer}?v=${Date.now()}-${Math.random()}`);
      const route = Object.values(mod).find(
        (v) => v && typeof v === "object" && typeof v.path === "string" && v.path.includes("loginServer"),
      );
      expect(route).toBeDefined();

      const TOKEN = "ss19-9-csrf";
      const req = new Request(`http://localhost${route.path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": TOKEN, "Cookie": `scrml_csrf=${TOKEN}` },
        body: JSON.stringify({ e: "known" }),
      });
      const resp = await route.handler(req);
      expect(resp.status).toBe(200);
      // The row labeled 'known' exists in <root>/m.db. Pre-fix the handler opened
      // <root>/../m.db (a different, empty file) -> "no such table" / {ok:false}.
      expect(await resp.json()).toEqual({ ok: true });
    } finally {
      process.chdir(cwdBefore);
    }
  }, EXECUTED_DB_TIMEOUT_MS);

  test("single-dir project: the root-level db opens beside app.scrml, module-relative", () => {
    const root = resolve(TMP_ROOT, `single-${++counter}`);
    mkdirSync(root, { recursive: true });
    const appPath = join(root, "app.scrml");
    writeFileSync(appPath, APP_SRC);
    const db = new Database(join(root, "m.db"), { create: true });
    db.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, label TEXT)");
    db.close();
    const outDir = join(root, "dist");
    const result = compileScrml({ inputFiles: [appPath], write: true, outputDir: outDir });
    expect((result.errors ?? []).filter((e) => !e.code?.startsWith("W-"))).toEqual([]);
    const appJs = readFileSync(join(outDir, "app.server.js"), "utf-8");
    // <root>/m.db — the declaring file.s directory.
    expect(emittedDbFile(appJs)).toEqual({ file: join(root, "m.db"), owns: false }); // referencing (no CREATE TABLE)
    expect(opensFile(join(outDir, "app.server.js"), appJs)).toBe(join(root, "m.db"));
  });
});
