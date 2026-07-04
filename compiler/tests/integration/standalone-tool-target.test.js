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
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
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
