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
 * FIX. emit-server.ts now expresses the emitted SQLite FILE path relative to the
 * project root (outputBaseDir = the runtime cwd) for any source file NOT at the
 * project root. A root-level file keeps its verbatim `src=` (the common single-
 * dir case is byte-identical). After the fix both files resolve to <root>/m.db
 * from the project root.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname, join } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync, readFileSync } from "fs";
import { Database } from "bun:sqlite";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
const TMP_ROOT = resolve(testDir, "_tmp_db_src_path");
let counter = 0;

beforeAll(() => {
  if (!existsSync(TMP_ROOT)) mkdirSync(TMP_ROOT, { recursive: true });
});
afterAll(() => {
  if (existsSync(TMP_ROOT)) rmSync(TMP_ROOT, { recursive: true, force: true });
});

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
  test("subdir page + root entry emit paths that resolve to the SAME db from the project root", () => {
    const { errors, appServer, loginServer } = buildProject();
    expect(errors.filter((e) => !e.code?.startsWith("W-"))).toEqual([]);
    expect(existsSync(appServer)).toBe(true);
    expect(existsSync(loginServer)).toBe(true);

    const appJs = readFileSync(appServer, "utf-8");
    const loginJs = readFileSync(loginServer, "utf-8");

    // Root entry: verbatim src (no churn for files at the project root).
    expect(appJs).toContain('new SQL("sqlite:./m.db")');
    // Subdir page: re-relativized to the project root, NOT the file-relative
    // `../m.db` (which would climb OUT of the project root at runtime).
    expect(loginJs).toContain('new SQL("sqlite:m.db")');
    expect(loginJs).not.toContain('new SQL("sqlite:../m.db")');

    // The invariant: from cwd = project root, both literals resolve to the same
    // absolute file.
    const appConn = appJs.match(/new SQL\("sqlite:([^"]+)"\)/)[1];
    const loginConn = loginJs.match(/new SQL\("sqlite:([^"]+)"\)/)[1];
    expect(resolve("/proj", appConn)).toBe(resolve("/proj", loginConn));
  });

  test("runtime: the subdir page opens the seeded db when run from the project root", async () => {
    // happy-dom-polluted globals strip CSRF headers (see sql-server-fn-runtime).
    if (typeof globalThis.document !== "undefined") return;

    const { errors, root, loginServer } = buildProject();
    expect(errors.filter((e) => !e.code?.startsWith("W-"))).toEqual([]);

    const cwdBefore = process.cwd();
    process.chdir(root); // run from the project root, like a deployed app
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
  });

  test("single-dir project: a root-level db src is emitted verbatim (no churn)", () => {
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
    // Verbatim — the single-dir case must be byte-identical to pre-fix emission.
    expect(appJs).toContain('new SQL("sqlite:./m.db")');
  });
});
