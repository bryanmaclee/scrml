/**
 * scrml dev — issue #724: a SERVER-fn edit must be served WITHOUT a restart.
 *
 * The dev server used to import each `*.server.js` in-process. Bun caches ES
 * modules by resolved path and never re-evaluates a recompiled module in the same
 * process (a `?t=` query on a `file://` URL is ignored), so the running server kept
 * executing the PREVIOUS route handler after an edit — stale values, and on an
 * add/remove of a server fn a silent client/server route-number desync that dropped
 * whole features. Copying the bundle to a fresh path defeats the cache but relocates
 * the `import.meta.dir`-anchored session store, logging users out on every reload.
 *
 * The fix runs the app in a CHILD process behind a stable reverse proxy and
 * respawns the child on every recompile: a fresh process re-evaluates the whole
 * server graph, while `import.meta.dir` stays the real output dir so state beside
 * the bundle survives.
 *
 * This EXECUTES a real `scrml dev` over a db-backed server fn, calls the route
 * (v1), edits the fn body (v2), and asserts the route returns v2 with no restart.
 * RED on the in-process import (stale v1 forever); GREEN with the child respawn.
 *
 * Commands tier: NOT in the pre-commit gate — run `bun test compiler/tests/commands`.
 */

import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { Database } from "bun:sqlite";

const CLI = resolve(import.meta.dir, "../../bin/scrml.js");

/** A db-backed server fn `ver()` returning `{ version }` — the `?{}` forces it server-side. */
function appSource(version) {
  return `<db src="./v.db" tables="t">
    \${
        function ver() {
            let _ = ?{\`SELECT x FROM t\`}.all()
            return { version: "${version}" }
        }
    }
    <button onclick=go()>go</>
    <div id="out">\${@out}</div>
    \${ <out> = ""  function go() { const r = ver(); @out = r.version } }
</db>
`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll `probe()` until it returns truthy or `timeoutMs` elapses. */
async function waitFor(probe, timeoutMs = 12_000, everyMs = 40) {
  const t0 = Date.now();
  while (true) {
    const v = await probe();
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) return null;
    await sleep(everyMs);
  }
}

/** One live `scrml dev` subprocess on an EPHEMERAL port over a temp project. */
class DevServer {
  constructor() {
    this.dir = mkdtempSync(join(tmpdir(), "scrml-dev-724-"));
    this.entry = join(this.dir, "app.scrml");
    this.out = "";
    this.proc = null;
    this.port = 0;
  }

  async start(version) {
    // The compiler introspects the sqlite schema at compile time, so the db and
    // its table must exist before `scrml dev` compiles.
    const db = new Database(join(this.dir, "v.db"));
    db.run("CREATE TABLE t (x INTEGER)");
    db.run("INSERT INTO t VALUES (42)");
    db.close();

    writeFileSync(this.entry, appSource(version));
    this.proc = Bun.spawn(
      ["bun", CLI, "dev", this.entry, "--port", "0", "--output", join(this.dir, "dist")],
      { cwd: this.dir, stdout: "pipe", stderr: "pipe", stdin: "ignore" },
    );
    const pump = async (stream) => {
      for await (const chunk of stream) this.out += new TextDecoder().decode(chunk);
    };
    pump(this.proc.stdout);
    pump(this.proc.stderr);
    const m = await waitFor(
      () => /\[dev\] Serving .* at http:\/\/localhost:(\d+)/.exec(this.out),
      20_000,
    );
    if (!m) throw new Error(`scrml dev did not come up.\n${this.out}`);
    this.port = Number(m[1]);
    return this;
  }

  /** The emitted route path for `ver()` (numbered by the compiler). */
  verRoutePath() {
    const js = readFileSync(join(this.dir, "dist", "app.server.js"), "utf8");
    const m = js.match(/path:\s*"(\/_scrml\/__ri_route_ver_\d+)"/);
    return m ? m[1] : "/_scrml/__ri_route_ver_1";
  }

  /** Call `ver()` through the dev server, satisfying the double-submit CSRF check. */
  async callVer() {
    try {
      const r = await fetch(`http://localhost:${this.port}${this.verRoutePath()}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cookie": "scrml_csrf=tok",
          "X-CSRF-Token": "tok",
        },
        body: "{}",
        signal: AbortSignal.timeout(4000),
      });
      if (r.status !== 200) return { status: r.status };
      return { status: 200, version: (await r.json()).version };
    } catch (e) {
      return { status: -1, error: String(e && e.message) };
    }
  }

  async stop() {
    try { this.proc && this.proc.kill(); } catch { /* already gone */ }
    try { this.proc && (await this.proc.exited); } catch { /* ignore */ }
    try { rmSync(this.dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

let dev = null;
afterEach(async () => {
  if (dev) await dev.stop();
  dev = null;
});

describe("scrml dev serves a recompiled server fn without a restart (#724)", () => {
  test("editing a server fn body is picked up live — no stale route handler", async () => {
    const d = await new DevServer().start("v1");
    dev = d;

    const first = await waitFor(async () => {
      const r = await d.callVer();
      return r.status === 200 ? r : null;
    });
    expect(first, `route never served 200.\n${d.out}`).not.toBeNull();
    expect(first.version).toBe("v1");

    // Edit the server fn body WITHOUT restarting the dev process.
    const outLenAtEdit = d.out.length;
    writeFileSync(d.entry, appSource("v2"));

    // Wait for the recompile to be detected AND the app child to respawn.
    const detected = await waitFor(
      () => (d.out.slice(outLenAtEdit).includes("[dev] Change detected") ? true : null),
      8_000,
    );
    expect(detected, `edit never detected.\n${d.out}`).not.toBeNull();

    // The route now returns the NEW value — the whole point of #724.
    const served = await waitFor(async () => {
      const r = await d.callVer();
      return r.status === 200 && r.version === "v2" ? r : null;
    }, 10_000);
    expect(served, `server fn edit not served after reload (stale handler).\n${d.out}`).not.toBeNull();
  }, 60_000);
});
