/**
 * SPEC §2.2.1 (S451 5(b); impl#1 exception granted S457 "1a") through the REAL
 * CLI: a compile that reports any Error writes no artifact, through every entry
 * point — `scrml compile`, `scrml build`, `scrml dev` recompiles. (`scrml serve`
 * and the api-level rule: compiler/tests/integration/s457-no-artifacts-on-error.test.js.)
 *
 * A failed compile leaves the output directory exactly as it was (§2.2.1:
 * "neither overwritten in part nor deleted"): absent on a first build, the last
 * good build on a rebuild. `scrml dev` keeps that last good build on disk and
 * answers every request with the compile error until the next green pass.
 *
 * Commands tier: NOT in the pre-commit gate — run `bun test compiler/tests/commands`.
 */

import { describe, test, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join, dirname, relative, resolve } from "path";
import { tmpdir } from "os";
import { execFileSync } from "child_process";

const CLI = resolve(import.meta.dir, "../../bin/scrml.js");

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "s457-noart-cli-")); });
afterAll(() => { try { if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true }); } catch {} });

const QUOTED_ONCLICK = `<program>\n<x> = 0\n<button onclick="\${@x}">hi</button>\n</program>\n`;
const JAVASCRIPT_URL = `<program>\n<x> = "a"\n<a href="javascript:\${@x}">go</a>\n</program>\n`;
const MULTI_STATEMENT = `<program db="./app.db">
    \${
        function record() {
            ?{\`INSERT INTO log (msg) VALUES ('a'); INSERT INTO log (msg) VALUES ('b')\`}.run()
            return 1
        }
    }
    <button onclick=\${ record() }>record</button>
</program>
`;
const REFUSED = [
  ["quoted onclick", QUOTED_ONCLICK, "E-ATTR-INTERP-EXECUTABLE"],
  ["javascript: URL", JAVASCRIPT_URL, "E-ATTR-INTERP-EXECUTABLE"],
  ["two SQL statements", MULTI_STATEMENT, "E-SQL-MULTIPLE-STATEMENTS"],
];
const good = (marker) => `<program>\n<x> = 0\n<p>${marker} \${@x}</p>\n</program>\n`;

let _n = 0;
function project(src) {
  const root = join(TMP, `p${_n++}`);
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "app.scrml"), src);
  return { root, src: join(root, "src"), entry: join(root, "src", "app.scrml"), dist: join(root, "dist") };
}
function run(args, cwd) {
  try {
    const out = execFileSync("bun", [CLI, ...args], { encoding: "utf8", cwd, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NO_COLOR: "1" } });
    return { code: 0, out: String(out ?? "") };
  } catch (e) {
    return { code: e.status ?? -1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}
const compile = (p) => run(["compile", p.entry, "--output-dir", p.dist], p.root);
const build = (p) => run(["build", p.src, "--output", p.dist], p.root);

function snapshot(dir) {
  const out = {};
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const abs = join(d, name);
      if (statSync(abs).isDirectory()) walk(abs);
      else out[relative(dir, abs).split(/[\\/]/).join("/")] = readFileSync(abs, "latin1");
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

for (const [cmd, go] of [["compile", compile], ["build", build]]) {
  describe(`scrml ${cmd} — a failed compile writes nothing`, () => {
    for (const [label, src, code] of REFUSED) {
      test(`${label} (${code}) → exit 1, no output directory, says so`, () => {
        const p = project(src);
        const r = go(p);
        expect(r.code).not.toBe(0);
        expect(r.out).toContain(code);
        expect(r.out).toContain("No files were written");
        expect(existsSync(p.dist)).toBe(false);
      });
    }

    test("a failed REBUILD leaves the previous good build byte-identical", () => {
      const p = project(good("v1"));
      const ok = go(p);
      expect(ok.code).toBe(0);
      expect(ok.out).not.toContain("No files were written");
      const before = snapshot(p.dist);
      expect(Object.keys(before).length).toBeGreaterThan(0);
      writeFileSync(p.entry, QUOTED_ONCLICK);
      const r = go(p);
      expect(r.code).not.toBe(0);
      expect(r.out).toContain("No files were written");
      expect(snapshot(p.dist)).toEqual(before);
    });
  });
}

// ---------------------------------------------------------------------------
// scrml dev — a failing recompile leaves the last good build on disk untouched
// and serves the compile error; the next green pass replaces it.
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(probe, timeoutMs = 10_000, everyMs = 100) {
  const t0 = Date.now();
  while (true) {
    const v = await probe();
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) return null;
    await sleep(everyMs);
  }
}

class DevServer {
  constructor(p) { this.p = p; this.out = ""; this.proc = null; this.port = 0; }
  async start(marker) {
    this.proc = Bun.spawn(
      ["bun", CLI, "dev", this.p.entry, "--port", "0", "--output", this.p.dist],
      { cwd: this.p.root, stdout: "pipe", stderr: "pipe", stdin: "ignore" },
    );
    const pump = async (s) => { for await (const c of s) this.out += new TextDecoder().decode(c); };
    pump(this.proc.stdout);
    pump(this.proc.stderr);
    const m = await waitFor(() => /\[dev\] Serving .* at http:\/\/localhost:(\d+)/.exec(this.out), 20_000);
    if (!m) throw new Error(`scrml dev did not come up.\n${this.out}`);
    this.port = Number(m[1]);
    const ok = await waitFor(async () => {
      const r = await this.get();
      return r.status === 200 && r.body.includes(marker) ? r : null;
    });
    if (!ok) throw new Error(`initial bundle never served.\n${this.out}`);
    return this;
  }
  async get(accept = "text/html") {
    try {
      const r = await fetch(`http://localhost:${this.port}/`, { headers: { accept }, signal: AbortSignal.timeout(3000) });
      return { status: r.status, body: await r.text() };
    } catch (e) {
      return { status: -1, body: String(e && e.message) };
    }
  }
  async stop() {
    try { this.proc && this.proc.kill(); } catch {}
    try { this.proc && (await this.proc.exited); } catch {}
  }
}

let dev = null;
afterEach(async () => { if (dev) await dev.stop(); dev = null; });

describe("scrml dev — a failing recompile writes nothing", () => {
  test("good → refused edit: dist untouched, error served; fixed edit: dist replaced, 200", async () => {
    const p = project(good("Hello v1"));
    dev = await new DevServer(p).start("Hello v1");
    const before = snapshot(p.dist);
    expect(Object.keys(before).some((k) => k.endsWith(".html"))).toBe(true);

    writeFileSync(p.entry, QUOTED_ONCLICK);
    const failing = await waitFor(async () => {
      const r = await dev.get("application/json");
      return r.status !== 200 ? r : null;
    }, 10_000);
    expect(failing, `dev kept serving 200 after a refused edit.\n${dev.out}`).not.toBeNull();
    expect(failing.body).toContain("E-ATTR-INTERP-EXECUTABLE");
    // Give a stray write every chance to land, then compare byte-for-byte.
    await sleep(500);
    expect(snapshot(p.dist)).toEqual(before);

    writeFileSync(p.entry, good("Hello v2"));
    const back = await waitFor(async () => {
      const r = await dev.get();
      return r.status === 200 && r.body.includes("Hello v2") ? r : null;
    }, 10_000);
    expect(back, `dev never recovered after the fix.\n${dev.out}`).not.toBeNull();
    expect(snapshot(p.dist)).not.toEqual(before);
  }, 60_000);
});
