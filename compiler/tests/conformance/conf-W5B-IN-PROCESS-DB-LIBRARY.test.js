/**
 * CONF-W5B-IN-PROCESS-DB-LIBRARY | §44.7.1 / §64.5.1 / §12.6
 *
 * W5b (S239, change-id `tool-library-in-process-consumption-2026-07-05`).
 * A db-bound library (a §21.5 pure-fn file with its own top-level `<db src>`
 * running `?{}` SQL, a module-with-db-context §44.7.1) consumed IN-PROCESS by a
 * `kind="tool"` emits its `?{}` fns as REAL in-process callables against the
 * module's OWN connection — NOT the browser-facing HTTP-route + client null-stub
 * (§12.6). The conformance guarantee: the tool-dep `<base>.js` carries the real
 * db binding and `bun <tool>.js` RUNS the imported SQL in-process.
 *
 * Emit sites: `compiler/src/codegen/emit-tool.ts:generateToolLibraryJs`
 * (routed from `codegen/index.ts` for a db-context tool-dep lib).
 */
import { describe, test, expect } from "bun:test";
import { resolve, dirname, join } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync, readFileSync } from "fs";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(new URL(import.meta.url).pathname);
let _tmp = 0;

function compileToolWithDbLib(libSrc, toolSrc, slug) {
  const name = `${slug}-${++_tmp}`;
  const tmpDir = resolve(testDir, `_tmp_${name}`);
  const dist = join(tmpDir, "dist");
  mkdirSync(dist, { recursive: true });
  writeFileSync(join(tmpDir, "dblib.scrml"), libSrc);
  writeFileSync(join(tmpDir, "tool.scrml"), toolSrc);
  const result = compileScrml({
    inputFiles: [join(tmpDir, "tool.scrml"), join(tmpDir, "dblib.scrml")],
    write: true,
    outputDir: dist,
    validateEmit: true,
    log: () => {},
  });
  return { result, dist, tmpDir };
}

const DB_LIB = `<db src="sqlite:./conf.db" tables="items" />
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
}`;

const TOOL = `<program kind="tool" lang="ts" db="sqlite:./conf.db">
\${ import { ensureSchema, insertItem, countItems } from "./dblib.scrml" }
function main(args: string[]): number {
  ensureSchema()
  insertItem("a")
  insertItem("b")
  insertItem("c")
  const c = countItems()
  _={ console.log("CONF_COUNT=" + c) }=
  return 0
}
</program>`;

describe("CONF-W5B-IN-PROCESS-DB-LIBRARY: tool imports a db-bound library", () => {
  test("POS: tool-dep <base>.js = real in-process db callable + tool RUNS the SQL", () => {
    const { result, dist, tmpDir } = compileToolWithDbLib(DB_LIB, TOOL, "w5b");
    try {
      const errs = (result.errors ?? []).filter((e) => e.severity == null || e.severity === "error");
      expect(errs.map((e) => e.code)).toEqual([]);

      // NORMATIVE emit shape — real in-process db binding, own connection.
      const libJs = readFileSync(join(dist, "dblib.js"), "utf8");
      expect(libJs).toContain("export async function countItems");
      expect(libJs).toContain("await _scrml_sql`");
      expect(libJs).toContain('new SQL("sqlite:./conf.db")');
      // NOT the client null-stub.
      expect(libJs).not.toContain("= null; // SQL-init");
      // The tool imports the mapped `.js` module.
      const toolJs = readFileSync(join(dist, "tool.js"), "utf8");
      expect(toolJs).toContain('from "./dblib.js"');

      // NORMATIVE runtime — the imported SQL executes in-process.
      rmSync(join(dist, "conf.db"), { force: true });
      const run = Bun.spawnSync({ cmd: ["bun", "tool.js"], cwd: dist, stdout: "pipe", stderr: "pipe" });
      expect(run.stderr.toString()).toBe("");
      expect(run.exitCode).toBe(0);
      expect(run.stdout.toString()).toContain("CONF_COUNT=3");
    } finally {
      if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
