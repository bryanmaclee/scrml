/**
 * W5b (S239) — in-process consumption of a db-bound library
 * (change-id `tool-library-in-process-consumption-2026-07-05`, §44.7.1 / §64.5.1).
 *
 * A db-bound library (a §21.5 pure-fn file declaring its own top-level `<db src>`
 * and running `?{}` SQL, §44.7.1) is consumed IN-PROCESS by a `kind="tool"` (or
 * any server-side / in-process consumer, D5 GENERALIZE). Before W5b the importable
 * artifact NULL-STUBBED / OMITTED the `?{}` fn (a browser fetches it over an HTTP
 * route, §12.6), so a tool importing it hit `SyntaxError: Export named 'X' not
 * found`. W5b emits the db fn as a REAL in-process callable against the module's
 * OWN `<db src>` connection:
 *   - the tool-dep `<base>.js` (emit-tool.ts generateToolLibraryJs), and
 *   - the `<base>.server.js` ss1 module value export (emit-server.ts, D5 GENERALIZE).
 *
 * The browser path is UNCHANGED: the client-facing `<base>.js` (only emitted in a
 * tool-bearing build) / `.client.js` never carry the `?{}`; a browser fetches it
 * over the retained §12.6 route.
 */

import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { Database } from "bun:sqlite";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

function compileMultiToDist(files, entryOrder, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), "w5b-inproc-"));
  const dist = join(dir, "dist");
  mkdirSync(dist, { recursive: true });
  const paths = [];
  for (const name of entryOrder) {
    const p = join(dir, name + ".scrml");
    writeFileSync(p, files[name]);
    paths.push(p);
  }
  const result = compileScrml({ inputFiles: paths, write: true, outputDir: dist, validateEmit: true, log: () => {}, ...extra });
  return { result, dist, dir };
}
const errCodes = (r) => (r.errors ?? []).map((e) => e.code).filter((c) => c && String(c).startsWith("E-"));

const DB_LIB = `<db src="sqlite:./w5b.db" tables="items" />
\${
export function ensureSchema() {
  ?{\`CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY, name TEXT)\`}.run()
}
export function insertItem(name) {
  ?{\`INSERT INTO items (name) VALUES (\${name})\`}.run()
}
export function countItems() {
  const r = ?{\`SELECT COUNT(*) AS c FROM items\`}.get()
  return r.c
}
export function scoreOf(n) { return n * 2 }
}`;

const TOOL = `<program kind="tool" lang="ts" db="sqlite:./w5b.db">
\${ import { ensureSchema, insertItem, countItems, scoreOf } from "./dblib.scrml" }
function main(args: string[]): number {
  ensureSchema()
  insertItem("alpha")
  insertItem("beta")
  const c = countItems()
  _={ console.log("count=" + c + " score=" + scoreOf(c)) }=
  return 0
}
</program>`;

describe("W5b — tool imports a db-bound library (in-process `?{}`)", () => {
  // (1) The D8 core — the tool-dep `<base>.js` carries the real in-process db
  // callables (own `<db src>` handle), the tool imports + awaits them, and
  // `bun tool.js` RUNS the SQL in-process.
  test("(1) tool-dep <base>.js = real in-process db callables; tool RUNS the SQL", () => {
    const { result, dist, dir } = compileMultiToDist({ dblib: DB_LIB, tool: TOOL }, ["tool", "dblib"]);
    try {
      expect(errCodes(result)).toEqual([]);
      const libJs = readFileSync(join(dist, "dblib.js"), "utf8");
      // Real in-process async db callables — NOT the null-stub / absent form.
      expect(libJs).toContain("export async function ensureSchema");
      expect(libJs).toContain("export async function insertItem");
      expect(libJs).toContain("export async function countItems");
      expect(libJs).toContain("await _scrml_sql`");
      expect(libJs).toContain('new SQL("sqlite:./w5b.db")');
      expect(libJs).not.toContain("= null; // SQL-init");
      // A schema-setup `?{}` fn with no return (flogence's ensureFspSchema shape).
      expect(libJs).toMatch(/export async function ensureSchema\(\) \{\s*await _scrml_sql`CREATE TABLE/);
      // The pure fn stays a plain synchronous export.
      expect(libJs).toContain("export function scoreOf");
      // The tool imports the real names + awaits the async db calls.
      const toolJs = readFileSync(join(dist, "tool.js"), "utf8");
      expect(toolJs).toMatch(/import \{[^}]*countItems[^}]*\} from "\.\/dblib\.js";/);
      expect(toolJs).toContain("await countItems()");
      // RUN — the imported db fns execute the SQL in-process.
      rmSync(join(dist, "w5b.db"), { force: true });
      const run = Bun.spawnSync({ cmd: ["bun", "tool.js"], cwd: dist, stdout: "pipe", stderr: "pipe" });
      expect(run.stderr.toString()).toBe("");
      expect(run.exitCode).toBe(0);
      expect(run.stdout.toString()).toContain("count=2 score=4");
    } finally { try { rmSync(dir, { recursive: true, force: true }); } catch {} }
  });

  // (2) flogence fsp-core shape — <foreign lang> + <db src> + ?{} + _{} + pure fn
  // imported by a tool: the `?{}` runs in-process, the `_{}` inlines (async IIFE),
  // the pure fn is callable.
  test("(2) fsp-core (foreign + db + ?{} + _{}) tool RUNS in-process", () => {
    const FSP = `<foreign lang="ts" />
<db src="sqlite:./fsp.db" tables="fsp_task">
\${
export function ensureFspSchema() {
  ?{\`CREATE TABLE IF NOT EXISTS fsp_task (id INTEGER PRIMARY KEY, name TEXT)\`}.run()
}
export function seedTask(name) {
  ?{\`INSERT INTO fsp_task (name) VALUES (\${name})\`}.run()
}
export function routeSemantic(frame) {
  const rows = ?{\`SELECT id, name FROM fsp_task\`}.all()
  const out = _={ in: { frame, rows }
    "routed:" + frame + ":" + rows.length
  }=
  return out
}
export fn taskLabel(n) { return "task#" + n }
}
</db>`;
    const FLEET = `<program kind="tool" lang="ts" db="sqlite:./fsp.db">
\${ import { ensureFspSchema, seedTask, routeSemantic, taskLabel } from "./fspcore.scrml" }
function main(args: string[]): number {
  ensureFspSchema()
  seedTask("alpha")
  seedTask("beta")
  const r = routeSemantic("F1")
  _={ console.log(r + " " + taskLabel(7)) }=
  return 0
}
</program>`;
    const { result, dist, dir } = compileMultiToDist({ fspcore: FSP, fleet: FLEET }, ["fleet", "fspcore"]);
    try {
      expect(errCodes(result)).toEqual([]);
      const libJs = readFileSync(join(dist, "fspcore.js"), "utf8");
      // Combined `?{}` + `_{}` fn: SQL lowers to the in-process handle, foreign to
      // the async IIFE. Neither leaks raw scrml.
      expect(libJs).toContain("export async function routeSemantic");
      expect(libJs).toContain("await _scrml_sql`SELECT id, name FROM fsp_task`");
      expect(libJs).toContain("await (async (frame, rows) =>");
      // No RAW scrml `?{`…`}` SQL opener nor a `_={`…`}=` foreign opener leaks (the
      // banner comment mentions `?{}` / `_{}` textually — check the code openers).
      expect(libJs).not.toContain("?{`");
      expect(libJs).not.toContain("_={");
      expect(libJs).toContain("export function taskLabel");
      rmSync(join(dist, "fsp.db"), { force: true });
      const run = Bun.spawnSync({ cmd: ["bun", "fleet.js"], cwd: dist, stdout: "pipe", stderr: "pipe" });
      expect(run.stderr.toString()).toBe("");
      expect(run.exitCode).toBe(0);
      expect(run.stdout.toString()).toContain("routed:F1:2 task#7");
    } finally { try { rmSync(dir, { recursive: true, force: true }); } catch {} }
  });

  // (3) D5 GENERALIZE — the `.server.js` ss1 module value export emits the db fn as
  // a real in-process callable (the server-side consumer half). A `.mjs` importing
  // `dblib.server.js` runs the SQL in-process — no HTTP, no null-stub.
  test("(3) D5 GENERALIZE — .server.js ss1 db export is a real in-process callable", () => {
    const { result, dist, dir } = compileMultiToDist({ dblib: DB_LIB, tool: TOOL }, ["tool", "dblib"]);
    try {
      expect(errCodes(result)).toEqual([]);
      const serverJs = readFileSync(join(dist, "dblib.server.js"), "utf8");
      // ss1 real in-process db exports (was: `const r = null; // ... E-CG-006`).
      expect(serverJs).toContain("export async function ensureSchema");
      expect(serverJs).toContain("export async function countItems");
      expect(serverJs).not.toContain("= null; // SQL-init");
      // The route handler is UNCHANGED (browser consumers fetch it, §12.6).
      expect(serverJs).toContain("_scrml_handler_countItems");
      // A server-side consumer imports the module by-name and runs it in-process.
      writeFileSync(join(dist, "_consumer.mjs"),
        `import { ensureSchema, insertItem, countItems, scoreOf } from "./dblib.server.js";
await ensureSchema();
await insertItem("x");
await insertItem("y");
await insertItem("z");
console.log("srv count=" + (await countItems()) + " score=" + scoreOf(await countItems()));`);
      rmSync(join(dist, "w5b.db"), { force: true });
      const run = Bun.spawnSync({ cmd: ["bun", "_consumer.mjs"], cwd: dist, stdout: "pipe", stderr: "pipe" });
      expect(run.stderr.toString()).toBe("");
      expect(run.exitCode).toBe(0);
      expect(run.stdout.toString()).toContain("srv count=3 score=6");
    } finally { try { rmSync(dir, { recursive: true, force: true }); } catch {} }
  });

  // (4) BLAST-RADIUS — a browser build (no tool entry) importing a db lib fn does
  // NOT regress: the client artifacts stay free of `?{}` / `_scrml_sql` / `new SQL`
  // (the client fetches over the retained route), and NO tool-dep `<base>.js` is
  // emitted (the additive path is gated on a `kind="tool"` entry).
  test("(4) web-app (no tool) — client artifacts clean, no additive <base>.js, route retained", () => {
    const dir = mkdtempSync(join(tmpdir(), "w5b-webapp-"));
    const dist = join(dir, "dist");
    mkdirSync(dist, { recursive: true });
    // Pre-create the db so the compile-time schema gate is satisfied (SELECT-only lib).
    const dbFile = join(dir, "w.db");
    const db = new Database(dbFile);
    db.run("CREATE TABLE widgets (id INTEGER PRIMARY KEY, name TEXT)");
    db.close();
    writeFileSync(join(dir, "wlib.scrml"),
      `<db src="${dbFile}" tables="widgets" />
\${
export function countWidgets() {
  const r = ?{\`SELECT COUNT(*) AS c FROM widgets\`}.get()
  return r.c
}
export function widgetLabel(n) { return "widgets: " + n }
}`);
    writeFileSync(join(dir, "wpage.scrml"),
      `<program>
\${ import { countWidgets, widgetLabel } from "./wlib.scrml" }
<page>
  <main>
    <button onClick={() => { let n = countWidgets() }}>{widgetLabel(3)}</button>
  </main>
</page>
</program>`);
    try {
      const result = compileScrml({ inputFiles: [join(dir, "wpage.scrml")], write: true, outputDir: dist, validateEmit: true, log: () => {} });
      expect(errCodes(result)).toEqual([]);
      for (const name of ["wlib.client.js", "wpage.client.js"]) {
        const p = join(dist, name);
        expect(existsSync(p)).toBe(true);
        const js = readFileSync(p, "utf8");
        expect(js).not.toContain("?{");
        expect(js).not.toContain("_scrml_sql");
        expect(js).not.toContain("new SQL(");
      }
      // NO additive tool-dep `<base>.js` in a browser-only build.
      expect(existsSync(join(dist, "wlib.js"))).toBe(false);
      // The route handler is retained for the browser fetch.
      const serverJs = readFileSync(join(dist, "wlib.server.js"), "utf8");
      expect(serverJs).toContain("_scrml_handler_countWidgets");
      expect(serverJs).toContain("SELECT COUNT(*) AS c FROM widgets");
    } finally { try { rmSync(dir, { recursive: true, force: true }); } catch {} }
  });

  // (5) A pure-fn / no-`?{}` tool-dep lib is UNAFFECTED — it stays on the A/B-landed
  // `generateLibraryJs` (no db handle header, no `new SQL`).
  test("(5) pure tool-dep lib stays on generateLibraryJs (no db handle injected)", () => {
    const PURE = `\${
export fn addup(a, b) { return a + b }
export fn multiply(a, b) { return a * b }
}`;
    const PTOOL = `<program kind="tool" lang="ts">
\${ import { addup, multiply } from "./purelib.scrml" }
function main(args: string[]): number {
  _={ console.log("r=" + addup(multiply(2, 3), 1)) }=
  return 0
}
</program>`;
    const { result, dist, dir } = compileMultiToDist({ purelib: PURE, ptool: PTOOL }, ["ptool", "purelib"]);
    try {
      expect(errCodes(result)).toEqual([]);
      const libJs = readFileSync(join(dist, "purelib.js"), "utf8");
      expect(libJs).toContain("function addup");
      expect(libJs).toContain("function multiply");
      expect(libJs).not.toContain("new SQL(");
      expect(libJs).not.toContain("_scrml_sql");
      const run = Bun.spawnSync({ cmd: ["bun", "ptool.js"], cwd: dist, stdout: "pipe", stderr: "pipe" });
      expect(run.exitCode).toBe(0);
      expect(run.stdout.toString()).toContain("r=7");
    } finally { try { rmSync(dir, { recursive: true, force: true }); } catch {} }
  });
});
