/**
 * §4.12.4 / §46.6 — a nested `<program name=…>` worker actually RUNS.
 *
 * dpa-056 D1 + D2 (S443). Before the fix `examples/13-worker.scrml` was dead in a
 * browser: the button stuck on "Computing…" forever, at exit 0.
 *
 *   D1 — `runCG` built each worker bundle in memory (`workerBundles`) and
 *        `compileScrml` never wrote it, so the page's `new Worker(...)` 404'd. The
 *        unit tests only looked at the in-memory map, so they passed.
 *   D2 — the emitted `.send()` did `worker.onmessage = resolve` on EVERY call,
 *        overwriting the `when message from <#w>` hook the page installed at load:
 *        the first send silently killed every hook (§46.6's first SHALL).
 *
 * This file checks the artifacts ON DISK, then runs them: the written worker bundle
 * in a real Bun `Worker`, driven by the instantiation block and the hook lines that
 * `scrml compile` wrote into the page's client bundle. The in-browser proof (Chromium,
 * `scrml dev` and `scrml build` + `bun _server.js`) is recorded in
 * docs/changes/s443-worker-d1-d2/progress.md.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { perRunTmp } from "../helpers/per-run-tmp.js";
import { rawGet } from "../helpers/raw-http-get.js";
import { CLIENT_ASSET_MANIFEST } from "../../src/static-serve-policy.js";

const testDir = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(testDir, "../../src/cli.js");
const _tmp = perRunTmp(resolve(testDir, "_tmp_nested_program_worker_runtime"));
beforeAll(_tmp.setup);
afterAll(_tmp.teardown);

// `twice` answers every message TWICE (the second reply is unsolicited as far as
// `.send()` is concerned); `sq` answers once and crashes on a negative input.
// `twice` carries TWO `when message from` hooks (§46.2: both run, source order).
const APP = `<program>

  <program name="twice">
    \${
        when message(n) {
            send(n * 2)
            send(n * 2 + 1000)
        }
    }
  </>

  <program name="sq">
    \${
        when message(n) {
            if (n < 0) {
                const boom = n.nope.deeper
            }
            send(n * n)
        }
    }
  </>

\${
    <log> = ""
    <errs> = 0

    function go() {
        <#twice>.send(1)
        <#sq>.send(7)
    }

    when message from <#twice> (d) {
        @log = @log + "T" + d + ";"
    }
    when message from <#twice> (d) {
        @log = @log + "t" + d + ";"
    }
    when message from <#sq> (d) {
        @log = @log + "S" + d + ";"
    }
    when error from <#sq> (e) {
        @errs = @errs + 1
    }
}

<button onclick=go()>go</>
<p>\${@log} \${@errs}</>

</program>
`;

function compileFixture(label, cmd) {
  const root = join(_tmp.root, label);
  const src = join(root, "src");
  const dist = join(root, "dist");
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, "app.scrml"), APP);
  const target = cmd === "build" ? src : join(src, "app.scrml");
  const r = Bun.spawnSync(["bun", CLI, cmd, target, "-o", dist], { stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`scrml ${cmd} failed:\n${r.stdout}\n${r.stderr}`);
  return { root, src, dist };
}

// ---------------------------------------------------------------------------
// §1 — D1: the bundles are written, named as the page loads them, and admitted
// ---------------------------------------------------------------------------

describe("§1 scrml compile writes every worker bundle (D1)", () => {
  let fx;
  beforeAll(() => { fx = compileFixture("compile", "compile"); });

  test("one `<page>-<name>.worker.js` per nested worker, beside the page", () => {
    expect(existsSync(join(fx.dist, "app-twice.worker.js"))).toBe(true);
    expect(existsSync(join(fx.dist, "app-sq.worker.js"))).toBe(true);
  });

  test("the page instantiates exactly the files that were written", () => {
    const client = readFileSync(join(fx.dist, "app.client.js"), "utf8");
    const urls = [...client.matchAll(/new Worker\("([^"]+)"\)/g)].map((m) => m[1]).sort();
    expect(urls).toEqual(["app-sq.worker.js", "app-twice.worker.js"]);
    for (const u of urls) expect(existsSync(join(fx.dist, u))).toBe(true);
  });

  test("the bundles are in the §47.13 client-asset manifest", () => {
    const assets = JSON.parse(readFileSync(join(fx.dist, CLIENT_ASSET_MANIFEST), "utf8")).clientAssets;
    expect(assets).toContain("app-twice.worker.js");
    expect(assets).toContain("app-sq.worker.js");
  });

  test("a worker bundle carries no parent-side code", () => {
    const w = readFileSync(join(fx.dist, "app-twice.worker.js"), "utf8");
    expect(w).not.toContain("_scrml_cs_reactive");
    expect(w).not.toContain("_scrml_worker_");
    expect(w).not.toContain("log");
  });
});

// ---------------------------------------------------------------------------
// §2 — D2: the written artifacts, run in a real Worker
// ---------------------------------------------------------------------------

/**
 * Evaluate the page's worker instantiation block + its `when … from` hook lines,
 * exactly as written to `app.client.js`, against real Bun Workers loading the
 * written bundles. The reactive cell API is stubbed with a plain map.
 */
function bootWorkers(dist) {
  const client = readFileSync(join(dist, "app.client.js"), "utf8");
  const blocks = [...client.matchAll(
    /const (_scrml_worker_\w+) = new Worker\([\s\S]*?\n\1\.send = function\(data\) \{[\s\S]*?\n\};\n/g,
  )].map((m) => m[0]);
  const hooks = client.split("\n").filter((l) => /^_scrml_worker_\w+\.addEventListener\(".*\}\);$/.test(l));
  const cells = new Map([["log", ""], ["errs", 0]]);
  const RealWorker = globalThis.Worker;
  const created = [];
  function PageWorker(url) {
    const w = new RealWorker(join(dist, url));
    created.push(w);
    return w;
  }
  const body = blocks.join("\n") + "\n" + hooks.join("\n") +
    "\nreturn { twice: _scrml_worker_twice, sq: _scrml_worker_sq };";
  const handles = new Function(
    "Worker", "_scrml_cs_reactive_get", "_scrml_cs_reactive_set", body,
  )(PageWorker, (k) => cells.get(k), (k, v) => cells.set(k, v));
  return { ...handles, cells, blocks, hooks, stop: () => created.forEach((w) => w.terminate()) };
}

async function until(pred, ms = 5000) {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error("timed out");
    await Bun.sleep(10);
  }
}

describe("§2 .send() and `when message from` coexist (D2, §46.6)", () => {
  let fx;
  beforeAll(() => { fx = compileFixture("runtime", "compile"); });

  test("the emitted client bundle never assigns worker.onmessage / onerror", () => {
    const client = readFileSync(join(fx.dist, "app.client.js"), "utf8");
    expect(client).not.toMatch(/_scrml_worker_\w+\.on(message|error)\s*=/);
  });

  test("hooks fire on EVERY message, including a .send()'s reply, and survive the send", async () => {
    const h = bootWorkers(fx.dist);
    try {
      expect(h.blocks).toHaveLength(2);
      expect(h.hooks).toHaveLength(4);
      const r1 = await h.twice.send(1);
      // The promise resolves with the FIRST reply naming its id.
      expect(r1).toBe(2);
      await until(() => h.cells.get("log").includes("t1002;"));
      // Both hooks, source order, on the reply AND on the second (unsolicited) message.
      expect(h.cells.get("log")).toBe("T2;t2;T1002;t1002;");
      // A second send: the hooks were not displaced by the first.
      expect(await h.twice.send(5)).toBe(10);
      await until(() => h.cells.get("log").endsWith("t1010;"));
      expect(h.cells.get("log")).toBe("T2;t2;T1002;t1002;T10;t10;T1010;t1010;");
      expect(h.twice.onmessage).toBe(null);
    } finally {
      h.stop();
    }
  });

  test("concurrent sends each resolve with their own reply", async () => {
    const h = bootWorkers(fx.dist);
    try {
      const [a, b, c] = await Promise.all([h.twice.send(10), h.twice.send(20), h.sq.send(3)]);
      expect([a, b, c]).toEqual([20, 40, 9]);
      expect(h.twice._scrml_pending.size).toBe(0);
      expect(h.sq._scrml_pending.size).toBe(0);
    } finally {
      h.stop();
    }
  });

  // Bun terminates a Worker on an uncaught error; a browser keeps it alive. So this
  // proves the hook is wired, and that a message hook ran BEFORE the crash; the
  // browser's "hooks still work after the crash" was checked in Chromium.
  test("`when error from` fires on a crash; the message hooks were not displaced", async () => {
    const h = bootWorkers(fx.dist);
    try {
      expect(await h.sq.send(4)).toBe(16);
      await until(() => h.cells.get("log").includes("S16;"));
      h.sq.send(-1);
      await until(() => h.cells.get("errs") === 1);
      expect(h.sq.onerror).toBe(null);
    } finally {
      h.stop();
    }
  });
});

// ---------------------------------------------------------------------------
// §3 — scrml build: the production server serves the bundle, and nothing more
// ---------------------------------------------------------------------------

async function freePort() {
  const s = Bun.serve({ port: 0, fetch: () => undefined });
  const port = s.port;
  s.stop(true);
  return port;
}

async function startProdServer(dist) {
  const port = await freePort();
  const proc = Bun.spawn(["bun", "_server.js"], {
    cwd: dist,
    env: { ...process.env, PORT: String(port) },
    stdout: "pipe",
    stderr: "pipe",
  });
  let out = "";
  const pump = async (stream) => { for await (const c of stream) out += new TextDecoder().decode(c); };
  pump(proc.stdout);
  pump(proc.stderr);
  const t0 = Date.now();
  while (!/scrml server listening/.test(out)) {
    if (Date.now() - t0 > 25_000) throw new Error(`_server.js did not come up:\n${out}`);
    await Bun.sleep(25);
  }
  return { proc, port };
}

describe("§3 scrml build serves the worker bundle (§47.13)", () => {
  test("_server.js serves app-<name>.worker.js; server files stay 404", async () => {
    const fx = compileFixture("build", "build");
    expect(existsSync(join(fx.dist, "app-twice.worker.js"))).toBe(true);
    const server = await startProdServer(fx.dist);
    try {
      const w = await rawGet(server.port, "/app-twice.worker.js");
      expect(w.status).toBe(200);
      expect(w.body).toContain("self.onmessage");
      expect((await rawGet(server.port, "/app-sq.worker.js")).status).toBe(200);
      expect((await rawGet(server.port, "/_server.js")).status).toBe(404);
      expect((await rawGet(server.port, "/nope.worker.js")).status).toBe(404);
    } finally {
      try { server.proc.kill(); } catch { /* gone */ }
    }
  }, 60_000);
});
