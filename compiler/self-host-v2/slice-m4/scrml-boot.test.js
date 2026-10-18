// scrml-boot.test.js — `scrml-boot compile` (scripts/scrml-boot.ts, s469-bootstrap-cli): the
// bootstrap reached as a COMMAND, on the first human-written acceptance programs
// (src/acceptance/, from scrml-support/docs/workability/today-scrml-distance-2026-10-18.md §3 (b)).
//
// Each case runs the real CLI in a subprocess against a fresh bundle cache, so the cold build, the
// warm (cached) load, the exit status and the printed diagnostics are what a user gets. The tapes
// program's emitted files are then loaded from the output directory and driven in happy-dom.

import { describe, test, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { click, expectNoPageErrors } from "../slice-m1/load-program.js";

const ROOT = resolve(import.meta.dir, "..", "..", "..");
const CLI = join(ROOT, "scripts", "scrml-boot.ts");
const ACC = join(import.meta.dir, "src", "acceptance");

let tmp;
let cache;
beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "scrml-boot-test-"));
  cache = join(tmp, "cache");
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function boot(args) {
  const p = Bun.spawnSync(["bun", CLI, ...args], {
    cwd: ROOT,
    env: { ...process.env, SCRML_BOOT_CACHE_DIR: cache, NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
}

describe("scrml-boot compile — b-tapes.scrml (the audit log + stack)", () => {
  let first;
  let second;
  const out = () => join(tmp, "b-tapes");
  beforeAll(() => {
    first = boot(["compile", join(ACC, "b-tapes.scrml"), "--output-dir", out(), "-v"]);
    second = boot(["compile", join(ACC, "b-tapes.scrml"), "--output-dir", out(), "-v"]);
  }, { timeout: 180000 });

  test("succeeds (exit 0), with no diagnostics, and writes the page, the client artifact and the runtime", () => {
    expect(first.err).not.toContain("error");
    expect(first.code).toBe(0);
    expect(first.out).toContain("✓ compiled");
    expect(readdirSync(out()).sort()).toEqual(["index.html", "program.client.js", "scrml-runtime.js"]);
    const html = readFileSync(join(out(), "index.html"), "utf8");
    expect(html).toContain('<script type="module" src="program.client.js">');
    expect(readFileSync(join(out(), "program.client.js"), "utf8")).toContain('from "./scrml-runtime.js"');
  });

  test("the first run builds the bootstrap bundle; the second loads it from the cache", () => {
    expect(first.err).toContain("bundle built");
    expect(second.code).toBe(0);
    expect(second.err).toContain("bundle cached");
    expect(readdirSync(cache).filter((f) => f.endsWith(".json")).length).toBe(1);
  });

  describe("the emitted program runs (happy-dom): Enter, Enter, Leave, type bryan, Spread, Leave, Leave", () => {
    afterEach(() => expectNoPageErrors());
    const depth = () => document.querySelector("main > p").textContent;
    const rows = (sel) => [...document.querySelectorAll(`main > ${sel} > li`)].map((li) => li.textContent);
    const button = (text) => [...document.querySelectorAll("main > button")].find((b) => b.textContent === text);

    test("depth goes 1→2→1→1→0→0 and the audit log holds six rows, in order", async () => {
      const html = readFileSync(join(out(), "index.html"), "utf8");
      document.head.innerHTML = /<head>([\s\S]*)<\/head>/.exec(html)[1].replace(/<script[^>]*><\/script>/g, "");
      document.body.innerHTML = "";
      await import(join(out(), "scrml-runtime.js"));
      await import(join(out(), "program.client.js"));
      const seen = [];
      click(button("Enter a")); seen.push(depth());
      click(button("Enter a")); seen.push(depth());
      click(button("Leave")); seen.push(depth());
      const input = document.querySelector("main > input");
      input.value = "bryan";
      input.dispatchEvent(new window.Event("input", { bubbles: true }));
      click(button("Spread")); seen.push(depth());
      click(button("Leave")); seen.push(depth());
      click(button("Leave")); seen.push(depth()); // pop on an empty stack is a no-op
      expect(seen).toEqual(["depth 1", "depth 2", "depth 1", "depth 1", "depth 0", "depth 0"]);
      expect(rows("ul")).toEqual([
        "1 ops: enter a", "2 ops: enter a", "3 ops: leave", "4 bryan: spread", "5 bryan: leave", "6 bryan: leave",
      ]);
      expect(rows("ol")).toEqual([]);
    });
  });
});

describe("scrml-boot compile — b-refused-shift.scrml (a refused tape write)", () => {
  test("fails with E-WRITE-NOT-GRANTED at the write's file:line:col, exits non-zero, writes nothing", () => {
    const o = join(tmp, "refused");
    const r = boot(["compile", join(ACC, "b-refused-shift.scrml"), "--output-dir", o]);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/^error \[E-WRITE-NOT-GRANTED\]: `@audit\.shift\(\)`/m);
    expect(r.err).toContain("--> compiler/self-host-v2/slice-m4/src/acceptance/b-refused-shift.scrml:12:9");
    expect(existsSync(o)).toBe(false);
  }, { timeout: 180000 });

  test("--format line prints one quickfix line per diagnostic", () => {
    const r = boot(["compile", join(ACC, "b-refused-shift.scrml"), "--format", "line", "--output-dir", join(tmp, "refused2")]);
    expect(r.code).toBe(1);
    const lines = r.err.split("\n").filter((l) => l.includes("[E-"));
    expect(lines).toEqual([
      expect.stringMatching(/^compiler\/self-host-v2\/slice-m4\/src\/acceptance\/b-refused-shift\.scrml:12:9: error \[E-WRITE-NOT-GRANTED\]: /),
    ]);
  }, { timeout: 180000 });
});

describe("scrml-boot dev — compile, serve, recompile on save", () => {
  test("serves the page (with its reload hook) and the client artifact; a save recompiles", async () => {
    const dir = join(tmp, "dev");
    const src = join(dir, "app.scrml");
    Bun.spawnSync(["mkdir", "-p", dir]);
    await Bun.write(src, readFileSync(join(ACC, "b-tapes.scrml"), "utf8"));
    const p = Bun.spawn(["bun", CLI, "dev", src, "--port", "0"], {
      cwd: ROOT, env: { ...process.env, SCRML_BOOT_CACHE_DIR: cache, NO_COLOR: "1" }, stdout: "pipe", stderr: "pipe",
    });
    const reader = p.stderr.getReader();
    let log = "";
    const until = async (re) => {
      const end = Date.now() + 60000;
      while (!re.test(log)) {
        if (Date.now() > end) throw new Error("dev server: timed out waiting for " + re + "\n" + log);
        const { value, done } = await reader.read();
        if (done) throw new Error("dev server exited:\n" + log);
        log += new TextDecoder().decode(value);
      }
      return re.exec(log);
    };
    try {
      const port = (await until(/http:\/\/127\.0\.0\.1:(\d+)\//))[1];
      const page = await (await Bun.fetch(`http://127.0.0.1:${port}/`)).text();
      expect(page).toContain("EventSource");
      expect(page).toContain("<button>Enter a</button>");
      const js = await Bun.fetch(`http://127.0.0.1:${port}/program.client.js`);
      expect(js.status).toBe(200);
      expect((await Bun.fetch(`http://127.0.0.1:${port}/nope.js`)).status).toBe(404);
      await Bun.write(src, readFileSync(src, "utf8").replace(">Enter a<", ">Enter b<"));
      await until(/✓ changed/);
      expect(await (await Bun.fetch(`http://127.0.0.1:${port}/`)).text()).toContain("<button>Enter b</button>");
    } finally {
      p.kill();
      await p.exited;
    }
  }, { timeout: 120000 });
});

describe("scrml-boot — the bundle cache key", () => {
  test("is a function of the inputs' CONTENT: same content same key, one changed byte a new key", async () => {
    const { bundleKey } = await import(CLI);
    const f = join(tmp, "key-input.scrml");
    await Bun.write(f, "<program></program>\n");
    const a = bundleKey([f]);
    expect(bundleKey([f])).toBe(a);
    await Bun.write(f, "<program> </program>\n");
    expect(bundleKey([f])).not.toBe(a);
  });
});

describe("scrml-boot — usage", () => {
  test("a missing file is a usage error (exit 2)", () => {
    const r = boot(["compile", join(tmp, "nope.scrml")]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("no such file");
  });
});
