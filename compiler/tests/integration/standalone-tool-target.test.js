/**
 * §64 Standalone Tool Target — Surface 1 (`<program kind="tool">`).
 *
 * A kind="tool" top-level <program> re-targets the emit from a web application
 * (html + client.js + CSRF + server routes; §40.8) to a PLAIN runnable ES module
 * (a CLI tool or long-running server; `bun <emitted>.js`). This suite covers:
 *   - emit SHAPE (toolJs only; NO html / clientJs / serverJs / CSRF / routes),
 *   - the main() harness return-type discriminator (§64.3),
 *   - db (`?{}`) + foreign (`_{}`) composition,
 *   - E-TOOL-001..004 rejects (§64.2/§64.4),
 *   - the §23.2.4 (amended S238) tool-body bare-`_{}` admission,
 *   - R26: compile → acorn-parse (node --check equiv) → RUN (exit codes +
 *     Bun.serve liveness).
 */

import { describe, test, expect } from "bun:test";
import { writeFileSync, mkdtempSync, mkdirSync, existsSync, rmSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { compileScrml, rewriteRelativeImportPaths } from "../../src/api.js";
import { generateToolJs } from "../../src/codegen/emit-tool.ts";
import { Database } from "bun:sqlite";

const acorn = require("acorn");

function compileSource(src, opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-tool-"));
  const file = join(dir, (opts.name ?? "app") + ".scrml");
  writeFileSync(file, src);
  const result = compileScrml({
    inputFiles: [file],
    write: false,
    validateEmit: true,
    log: () => {},
    ...opts.compile,
  });
  const out = result.outputs ? [...result.outputs.values()][0] : null;
  try { rmSync(dir, { recursive: true }); } catch {}
  return { result, out };
}

const errCodes = (r) => (r.errors ?? []).map((e) => e.code);
const warnCodes = (r) => (r.warnings ?? []).map((w) => w.code);
// acorn parse over an ESM (top-level await + import allowed) — the node --check
// syntactic gate without spawning a process.
const parsesClean = (js) => {
  try { acorn.parse(js, { ecmaVersion: 2023, sourceType: "module", allowAwaitOutsideFunction: true }); return true; }
  catch { return false; }
};

const CLI_TOOL = `<program kind="tool" lang="ts" db="./fleet.db">
    fn banner(n: number): string { return "fleet: " + n + " tasks" }
    function loadCount(): number {
        const rows = ?{ SELECT id FROM tasks }.all()
        return rows.length
    }
    function main(args: string[]): number {
        if args.length == 0 {
            _={ console.error("usage: fleet <count|fail>") }=
            return 2
        }
        const cmd = args[0]
        if cmd == "fail" { return 7 }
        const n = loadCount()
        _={ console.log(banner(n)) }=
        return 0
    }
</program>`;

const SERVER_TOOL = `<program kind="tool" lang="ts">
    function main(args: string[]) {
        _={ Bun.serve({ port: 0, fetch(req) { return new Response("scrml-tool-ok") } }) }=
    }
</program>`;

describe("§64 tool target — emit shape", () => {
  test("kind=\"tool\" emits toolJs ONLY (no html / clientJs / serverJs / CSRF)", () => {
    const { result, out } = compileSource(CLI_TOOL);
    expect(errCodes(result)).not.toContain("E-FOREIGN-004");
    expect(errCodes(result).filter((c) => c.startsWith("E-"))).toEqual([]);
    expect(out.toolJs).toBeTruthy();
    expect(out.html).toBeFalsy();
    expect(out.clientJs).toBeFalsy();
    expect(out.serverJs).toBeFalsy();
    expect(out.toolJs).not.toMatch(/scrml-runtime|_scrml_reactive_get|csrf|CSRF|document\./);
    expect(parsesClean(out.toolJs)).toBe(true);
  });

  test("numeric-return main → exit-harness (process.exit)", () => {
    const { out } = compileSource(CLI_TOOL);
    expect(out.toolJs).toMatch(/const _scrml_exit_code = await main\(process\.argv\.slice\(2\)\);/);
    expect(out.toolJs).toMatch(/process\.exit\(_scrml_exit_code\);/);
  });

  test("no-return main → invoke-only harness (await, NO process.exit)", () => {
    const { out } = compileSource(SERVER_TOOL);
    expect(out.toolJs).toMatch(/await main\(process\.argv\.slice\(2\)\);/);
    expect(out.toolJs).not.toMatch(/process\.exit/);
    expect(parsesClean(out.toolJs)).toBe(true);
  });

  test("db composition — Bun.SQL handle header + lowered ?{}", () => {
    const { out } = compileSource(CLI_TOOL);
    expect(out.toolJs).toMatch(/import \{ SQL \} from "bun";/);
    expect(out.toolJs).toMatch(/const _scrml_sql = new SQL\("sqlite:\.\/fleet\.db"\);/);
    expect(out.toolJs).toMatch(/await _scrml_sql`SELECT id FROM tasks`/);
  });

  test("== lowers to _scrml_structural_eq AND the helper is inlined", () => {
    const { out } = compileSource(CLI_TOOL);
    expect(out.toolJs).toMatch(/_scrml_structural_eq\(/);
    expect(out.toolJs).toMatch(/function _scrml_structural_eq\(a, b\)/);
  });

  test("§14 enum type in a tool emits its frozen backing object", () => {
    const { result, out } = compileSource(`<program kind="tool" lang="ts">
      type Cmd:enum = { List, Add }
      function main(args: string[]): number {
        const c = Cmd.List
        _={ console.log(c) }=
        return 0
      }
    </program>`);
    expect(errCodes(result).filter((c) => c.startsWith("E-"))).toEqual([]);
    expect(out.toolJs).toMatch(/const Cmd = Object\.freeze\(/);
    expect(out.toolJs).toMatch(/const c = Cmd\.List;/);
    expect(parsesClean(out.toolJs)).toBe(true);
  });

  test("async-fn propagation — main awaits an async helper", () => {
    const { out } = compileSource(CLI_TOOL);
    expect(out.toolJs).toMatch(/async function loadCount\(\)/);
    expect(out.toolJs).toMatch(/async function main\(args\)/);
    expect(out.toolJs).toMatch(/const n = await loadCount\(\);/);
    // a pure fn stays sync and is NOT awaited
    expect(out.toolJs).toMatch(/function banner\(n\)/);
    expect(out.toolJs).not.toMatch(/await banner\(/);
  });
});

describe("§64 tool target — E-TOOL rejects", () => {
  test("E-TOOL-001 — no function main", () => {
    const { result } = compileSource(`<program kind="tool" lang="ts">
      fn helper(x: string): string { return x }
    </program>`);
    expect(errCodes(result)).toContain("E-TOOL-001");
  });

  test("E-TOOL-002 — unknown kind value (kind=\"service\")", () => {
    const { result } = compileSource(`<program kind="service" lang="ts">
      function main(args: string[]): number { return 0 }
    </program>`);
    expect(errCodes(result)).toContain("E-TOOL-002");
  });

  test("E-TOOL-002 — kind=\"app\"", () => {
    const { result } = compileSource(`<program kind="app" lang="ts">
      function main(args: string[]): number { return 0 }
    </program>`);
    expect(errCodes(result)).toContain("E-TOOL-002");
  });

  test("E-TOOL-002 — bare `kind` attribute (present but no valid value)", () => {
    const { result } = compileSource(`<program kind lang="ts">
      function main(args: string[]): number { return 0 }
    </program>`);
    expect(errCodes(result)).toContain("E-TOOL-002");
  });

  test("E-TOOL-002 — kind= on a NESTED <program>", () => {
    const { result } = compileSource(`<program lang="ts">
      <program kind="tool" name="worker">
        function main(args: string[]): number { return 0 }
      </program>
    </program>`);
    expect(errCodes(result)).toContain("E-TOOL-002");
  });

  test("E-TOOL-003 — <page> in a tool body", () => {
    const { result } = compileSource(`<program kind="tool" lang="ts">
      <page src="/x"/>
      function main(args: string[]): number { return 0 }
    </program>`);
    expect(errCodes(result)).toContain("E-TOOL-003");
  });

  test("E-TOOL-003 — client-reactive UI state in a tool body", () => {
    const { result } = compileSource(`<program kind="tool" lang="ts">
      <count> = 0
      function main(args: string[]): number { return 0 }
    </program>`);
    expect(errCodes(result)).toContain("E-TOOL-003");
  });

  test("E-TOOL-003 — markup element in a tool body", () => {
    const { result } = compileSource(`<program kind="tool" lang="ts">
      <div>hello</div>
      function main(args: string[]): number { return 0 }
    </program>`);
    expect(errCodes(result)).toContain("E-TOOL-003");
  });

  test("E-TOOL-004 — fn main (impure entry; steer to function main)", () => {
    const { result } = compileSource(`<program kind="tool" lang="ts">
      fn main(args: string[]): number { return 0 }
    </program>`);
    expect(errCodes(result)).toContain("E-TOOL-004");
  });
});

describe("§64/§23.2.4 — tool-body bare-_{} admission (amended S238)", () => {
  test("bare _{} in a tool `function main` body is admitted (no E-FOREIGN-004)", () => {
    const { result } = compileSource(`<program kind="tool" lang="ts">
      function main(args: string[]): number { _={ console.log("hi") }= ; return 0 }
    </program>`);
    expect(errCodes(result)).not.toContain("E-FOREIGN-004");
  });

  test("bare _{} in a NORMAL web-app <program> body STILL fires E-FOREIGN-004", () => {
    const { result } = compileSource(`<program lang="ts">
      function work() { _={ console.log("x") }= }
    </program>`);
    expect(errCodes(result)).toContain("E-FOREIGN-004");
  });

  test("bare _{} in a tool PURE `fn` helper is NOT admitted (still E-FOREIGN-004)", () => {
    const { result } = compileSource(`<program kind="tool" lang="ts">
      fn helper() { _={ console.log("x") }= }
      function main(args: string[]): number { return 0 }
    </program>`);
    expect(errCodes(result)).toContain("E-FOREIGN-004");
  });
});

describe("§64 tool target — R26 (compile → parse → RUN)", () => {
  test("db-bound CLI: exit-harness exits with main's return code", () => {
    const dir = mkdtempSync(join(tmpdir(), "scrml-tool-r26-cli-"));
    const dist = join(dir, "dist");
    mkdirSync(dist, { recursive: true });
    writeFileSync(join(dir, "fleet.scrml"), CLI_TOOL);
    const result = compileScrml({ inputFiles: [join(dir, "fleet.scrml")], write: true, outputDir: dist, log: () => {} });
    expect(errCodes(result).filter((c) => c.startsWith("E-"))).toEqual([]);
    const fleetJs = join(dist, "fleet.js");
    expect(existsSync(fleetJs)).toBe(true);

    // seed the db (relative to dist, the runtime cwd)
    const db = new Database(join(dist, "fleet.db"));
    db.run("CREATE TABLE tasks (id INTEGER PRIMARY KEY, name TEXT)");
    db.run("INSERT INTO tasks (name) VALUES ('a'),('b'),('c')");
    db.close();

    const run = (args) => Bun.spawnSync({ cmd: ["bun", "fleet.js", ...args], cwd: dist, stdout: "pipe", stderr: "pipe" });
    expect(run([]).exitCode).toBe(2);            // no args → return 2
    expect(run(["fail"]).exitCode).toBe(7);      // == "fail" → return 7 (structural_eq)
    const ok = run(["count"]);
    expect(ok.exitCode).toBe(0);                 // db query → return 0
    expect(ok.stdout.toString()).toContain("fleet: 3 tasks");
    try { rmSync(dir, { recursive: true }); } catch {}
  });

  test("Bun.serve tool: invoke-only harness stays alive (event loop not drained)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "scrml-tool-r26-srv-"));
    const dist = join(dir, "dist");
    mkdirSync(dist, { recursive: true });
    const port = 8700 + Math.floor(Math.random() * 300);
    const src = `<program kind="tool" lang="ts">
    function main(args: string[]) {
        _={ Bun.serve({ port: ${port}, fetch(req) { return new Response("scrml-tool-ok") } }) }=
    }
</program>`;
    writeFileSync(join(dir, "wire.scrml"), src);
    const result = compileScrml({ inputFiles: [join(dir, "wire.scrml")], write: true, outputDir: dist, log: () => {} });
    expect(errCodes(result).filter((c) => c.startsWith("E-"))).toEqual([]);
    const wireJs = join(dist, "wire.js");
    expect(existsSync(wireJs)).toBe(true);

    const proc = Bun.spawn({ cmd: ["bun", "wire.js"], cwd: dist, stdout: "pipe", stderr: "pipe" });
    try {
      await Bun.sleep(700);
      // The invoke-only harness must NOT have exited — Bun.serve's handle keeps
      // the event loop alive (§64.3 "declines to force it down").
      expect(proc.killed).toBe(false);
      const res = await fetch(`http://localhost:${port}/`);
      expect(await res.text()).toBe("scrml-tool-ok");
    } finally {
      proc.kill();
      try { rmSync(dir, { recursive: true }); } catch {}
    }
  });
});


// ---------------------------------------------------------------------------
// §64 tool imports — g-tool-import-drop (A1 ES-import emit + A2 library-dep
// emit) + Flag C (cross-import await-coloring). A kind="tool" module has NO
// _scrml_modules registry (that is the browser client path) — it needs REAL ES
// imports, and its imported .scrml library deps must emit runnable `<base>.js`.
// ---------------------------------------------------------------------------

// Multi-file: write each {name -> src} to a temp dir, compile ALL, write to
// dist/, and return { result, dist, dir } for artifact + RUN assertions.
function compileMultiToDist(files, entryOrder) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-tool-imp-"));
  const dist = join(dir, "dist");
  mkdirSync(dist, { recursive: true });
  const paths = [];
  for (const name of entryOrder) {
    const p = join(dir, name + ".scrml");
    writeFileSync(p, files[name]);
    paths.push(p);
  }
  const result = compileScrml({ inputFiles: paths, write: true, outputDir: dist, log: () => {} });
  return { result, dist, dir };
}

const PURE_LIB = `\${
export fn addup(a, b) { return a + b }
export fn multiply(a, b) { return a * b }
}`;

const FOREIGN_LIB = `<foreign lang="ts" />
\${
export fn runOpen(model, prompt) {
  const out = _={ in: { model, prompt } model + " " + prompt }=
  return out
}
}`;

describe("§64 tool imports — g-tool-import-drop (A1/A2) + Flag C", () => {
  test("A1: a tool emits an ES import for a local .scrml lib dep (mapped to .js)", () => {
    const files = {
      libpure: PURE_LIB,
      toolpure: `<program kind="tool" lang="ts">
import { addup } from "./libpure.scrml"
function main(args: string[]): number {
  const n = addup(2, 3)
  _={ in: { n } console.log("sum=" + n) }=
  return 0
}
</program>`,
    };
    const { result, dist, dir } = compileMultiToDist(files, ["toolpure", "libpure"]);
    try {
      expect(errCodes(result).filter((c) => c.startsWith("E-"))).toEqual([]);
      const toolJs = require("fs").readFileSync(join(dist, "toolpure.js"), "utf8");
      // REAL ES import, .scrml mapped to .js, source-tree-relative (NOT ../).
      expect(toolJs).toMatch(/import \{ addup \} from "\.\/libpure\.js";/);
      expect(toolJs).not.toMatch(/\.\.\/libpure\.js/);
      // A2 (ADDITIVE): the pure-fn lib dep emits a runnable library module
      // `<base>.js` for the tool import. The additive floor ALSO keeps the
      // normal browser artifacts (a co-resident `<page>` consumer's
      // `_scrml_modules` dep), so `<base>.client.js` is emitted too — the two
      // never collide on disk.
      expect(existsSync(join(dist, "libpure.js"))).toBe(true);
      expect(existsSync(join(dist, "libpure.client.js"))).toBe(true);
      const libJs = require("fs").readFileSync(join(dist, "libpure.js"), "utf8");
      expect(libJs).toMatch(/export function addup\(a, b\)/);
    } finally { try { rmSync(dir, { recursive: true }); } catch {} }
  });

  test("A R26: tool importing a pure lib RUNS the real fn (bun dist/tool.js)", () => {
    const files = {
      libpure: PURE_LIB,
      toolpure: `<program kind="tool" lang="ts">
import { addup } from "./libpure.scrml"
function main(args: string[]): number {
  const n = addup(2, 3)
  _={ in: { n } console.log("sum=" + n) }=
  return 0
}
</program>`,
    };
    const { result, dist, dir } = compileMultiToDist(files, ["toolpure", "libpure"]);
    try {
      expect(errCodes(result).filter((c) => c.startsWith("E-"))).toEqual([]);
      const run = Bun.spawnSync({ cmd: ["bun", "toolpure.js"], cwd: dist, stdout: "pipe", stderr: "pipe" });
      expect(run.exitCode).toBe(0);
      expect(run.stdout.toString()).toContain("sum=5");
    } finally { try { rmSync(dir, { recursive: true }); } catch {} }
  });

  test("Flag C: a tool AWAITS an async imported foreign-lib fn (no [object Promise])", () => {
    const files = {
      lanes: FOREIGN_LIB,
      toolc: `<program kind="tool" lang="ts">
import { runOpen } from "./lanes.scrml"
function main(args: string[]): number {
  const line = runOpen("gpt", "hi")
  _={ in: { line } console.log("line=" + line) }=
  return 0
}
</program>`,
    };
    const { result, dist, dir } = compileMultiToDist(files, ["toolc", "lanes"]);
    try {
      expect(errCodes(result).filter((c) => c.startsWith("E-"))).toEqual([]);
      const toolJs = require("fs").readFileSync(join(dist, "toolc.js"), "utf8");
      // the imported foreign fn is async → its call site is awaited.
      expect(toolJs).toMatch(/await runOpen\(/);
      // the foreign-only lib emitted an async library export.
      const lanesJs = require("fs").readFileSync(join(dist, "lanes.js"), "utf8");
      expect(lanesJs).toMatch(/export async function runOpen/);
      const run = Bun.spawnSync({ cmd: ["bun", "toolc.js"], cwd: dist, stdout: "pipe", stderr: "pipe" });
      expect(run.exitCode).toBe(0);
      expect(run.stdout.toString()).toContain("line=gpt hi");
      expect(run.stdout.toString()).not.toContain("[object Promise]");
    } finally { try { rmSync(dir, { recursive: true }); } catch {} }
  });

  test("aliased + multiple-named imports preserve the alias in the ES import", () => {
    const files = {
      mathlib: PURE_LIB,
      toolam: `<program kind="tool" lang="ts">
import { addup as sum, multiply } from "./mathlib.scrml"
function main(args: string[]): number {
  const r = sum(2, 3)
  const p = multiply(4, 5)
  _={ in: { r, p } console.log("r=" + r + " p=" + p) }=
  return 0
}
</program>`,
    };
    const { result, dist, dir } = compileMultiToDist(files, ["toolam", "mathlib"]);
    try {
      expect(errCodes(result).filter((c) => c.startsWith("E-"))).toEqual([]);
      const toolJs = require("fs").readFileSync(join(dist, "toolam.js"), "utf8");
      expect(toolJs).toMatch(/import \{ addup as sum, multiply \} from "\.\/mathlib\.js";/);
      const run = Bun.spawnSync({ cmd: ["bun", "toolam.js"], cwd: dist, stdout: "pipe", stderr: "pipe" });
      expect(run.exitCode).toBe(0);
      expect(run.stdout.toString()).toContain("r=5 p=20");
    } finally { try { rmSync(dir, { recursive: true }); } catch {} }
  });

  test("scrml: stdlib import passes through emit-tool (rewritten to _scrml/ at write)", () => {
    const src = `<program kind="tool" lang="ts">
import { clamp } from "scrml:math"
function main(args: string[]): number {
  _={ in: {} console.log("clamped=" + clamp(15, 0, 10)) }=
  return 0
}
</program>`;
    const dir = mkdtempSync(join(tmpdir(), "scrml-tool-imp-"));
    const dist = join(dir, "dist");
    mkdirSync(dist, { recursive: true });
    writeFileSync(join(dir, "toolstd.scrml"), src);
    const result = compileScrml({ inputFiles: [join(dir, "toolstd.scrml")], write: true, outputDir: dist, log: () => {} });
    try {
      expect(errCodes(result).filter((c) => c.startsWith("E-"))).toEqual([]);
      const toolJs = require("fs").readFileSync(join(dist, "toolstd.js"), "utf8");
      // scrml:math was NOT mapped to .js; rewriteStdlibImports pointed it at _scrml/.
      expect(toolJs).toMatch(/import \{ clamp \} from "\.\/_scrml\/math\.js";/);
      expect(toolJs).not.toMatch(/from "scrml:math"/);
      const run = Bun.spawnSync({ cmd: ["bun", "toolstd.js"], cwd: dist, stdout: "pipe", stderr: "pipe" });
      expect(run.exitCode).toBe(0);
      expect(run.stdout.toString()).toContain("clamped=10");
    } finally { try { rmSync(dir, { recursive: true }); } catch {} }
  });

  test("a tool with NO imports emits no import header (byte-identical lead)", () => {
    const src = `<program kind="tool" lang="ts">
function main(args: string[]): number {
  _={ in: {} console.log("hello") }=
  return 0
}
</program>`;
    const { out } = compileSource(src, { name: "toolni" });
    expect(out.toolJs).toBeTruthy();
    // no leading `import` line — the header is empty for a no-import tool.
    expect(out.toolJs.trimStart().startsWith("import ")).toBe(false);
    expect(out.toolJs.startsWith("// Generated standalone tool")).toBe(true);
  });

  test("#1 co-resident tool + browser <page> share a pure-fn helper (additive)", () => {
    const files = {
      helper: `\${ export fn addup(a, b) { return a + b } }`,
      page: `<program>
import { addup } from "./helper.scrml"
<div>\${addup(2, 3)}</div>
</program>`,
      tool: `<program kind="tool" lang="ts">
import { addup } from "./helper.scrml"
function main(args: string[]): number {
  _={ in: {} console.log("sum=" + addup(2, 3)) }=
  return 0
}
</program>`,
    };
    const { result, dist, dir } = compileMultiToDist(files, ["tool", "page", "helper"]);
    try {
      expect(errCodes(result).filter((c) => c.startsWith("E-"))).toEqual([]);
      // Additive floor: BOTH the library module (tool import) AND the browser
      // client (the page's _scrml_modules registry dep) are emitted.
      expect(existsSync(join(dist, "helper.js"))).toBe(true);
      expect(existsSync(join(dist, "helper.client.js"))).toBe(true);
      const toolJs = require("fs").readFileSync(join(dist, "tool.js"), "utf8");
      expect(toolJs).toMatch(/import \{ addup \} from "\.\/helper\.js";/);
      // The page's client still resolves the shared helper via _scrml_modules.
      const pageClient = require("fs").readFileSync(join(dist, "page.client.js"), "utf8");
      expect(pageClient).toMatch(/_scrml_modules\[/);
      // The tool RUNS (real import resolves at runtime).
      const run = Bun.spawnSync({ cmd: ["bun", "tool.js"], cwd: dist, stdout: "pipe", stderr: "pipe" });
      expect(run.exitCode).toBe(0);
      expect(run.stdout.toString()).toContain("sum=5");
    } finally { try { rmSync(dir, { recursive: true }); } catch {} }
  });
});


describe("§64 tool imports — fix-round hardening (#3/#4/#5/#6-7)", () => {
  test("#3 relocation-skip keys on the compiled-source set (vendored .js still relocates)", () => {
    // resolve() the fixture paths so they match how rewriteRelativeImportPaths
    // keys the compiled-source set: it derives `absImportPath` via
    // `resolve(sourceDir, relPath)` (NATIVE separators) and looks up the
    // `.scrml` sibling in `emittedScrmlSources`. Seeding the set with a POSIX
    // literal ("/proj/libpure.scrml") never matches the native resolved key
    // ("C:\proj\libpure.scrml") on Windows, so the tree-mirror skip wouldn't
    // fire and libpure.js would be wrongly relocated. resolve() is a no-op on POSIX.
    const src = resolve("/proj/tool.scrml"), out = resolve("/proj/dist");
    const js = 'import { addup } from "./libpure.js";\nimport { x } from "./util.js";\n';
    // libpure.scrml WAS compiled (its <base>.js mirrors the tree); util.scrml is
    // an unrelated, uncompiled file next to a genuinely-vendored util.js.
    const emitted = new Set([resolve("/proj/libpure.scrml")]);
    const rewritten = rewriteRelativeImportPaths(js, src, out, emitted);
    expect(rewritten).toMatch(/from "\.\/libpure\.js"/);  // tree-mirror: unchanged
    expect(rewritten).toMatch(/from "\.\.\/util\.js"/);   // vendored: relocated
  });

  test("#4 a quoted-kebab imported name emits syntactically valid JS", () => {
    const fileAST = {
      filePath: "/p/tool.scrml",
      imports: [{
        kind: "import-decl", source: "./board.scrml", isDefault: false,
        names: ["dispatch-board"],
        specifiers: [{ imported: "dispatch-board", local: "board" }],
      }],
      nodes: [{ kind: "logic", body: [{
        kind: "function-decl", name: "main", params: ["args"],
        hasReturnType: true, returnTypeAnnotation: "number", body: [],
      }] }],
    };
    const js = generateToolJs(fileAST, []);
    expect(js).toMatch(/import \{ "dispatch-board" as board \} from "\.\/board\.js";/);
    expect(parsesClean(js)).toBe(true);
  });

  test("#5 tool importing a page-shaped/no-export .scrml → E-TOOL-006 (fail-closed)", () => {
    const files = {
      pagehelper: `<div>page content</div>\n\${ export fn addup(a, b) { return a + b } }`,
      tool: `<program kind="tool" lang="ts">
import { addup } from "./pagehelper.scrml"
function main(args: string[]): number {
  _={ in: {} console.log("s=" + addup(1, 2)) }=
  return 0
}
</program>`,
    };
    const { result, dir } = compileMultiToDist(files, ["tool", "pagehelper"]);
    try {
      expect(errCodes(result)).toContain("E-TOOL-006");
    } finally { try { rmSync(dir, { recursive: true }); } catch {} }
  });

  test("#6/7 a DEFAULT import of a .scrml lib is rejected upstream (E-IMPORT-004)", () => {
    const files = {
      nlib: `\${ export fn addup(a, b) { return a + b } }`,
      tool: `<program kind="tool" lang="ts">
import Foo from "./nlib.scrml"
function main(args: string[]): number {
  _={ in: {} console.log("x") }=
  return 0
}
</program>`,
    };
    const { result, dir } = compileMultiToDist(files, ["tool", "nlib"]);
    try {
      // scrml libs export NAMED bindings only — a default import can never bind,
      // so the emit's default arm is unreachable (documented, not shipped wrong).
      expect(errCodes(result)).toContain("E-IMPORT-004");
    } finally { try { rmSync(dir, { recursive: true }); } catch {} }
  });
});
