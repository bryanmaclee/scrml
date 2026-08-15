/**
 * scrml dev — fail CLOSED on a compileScrml THROW + the watcher survives a
 * source delete / rename (S346; ledger `g-dev-compile-throw-fail-open` HIGH and
 * `g-dev-watcher-dies-on-delete-rename-permanent-500` MED — both in dev.js).
 *
 * PR #518 made `scrml dev` refuse to serve a stale/partial bundle when
 * `compileScrml` RETURNS diagnostics. When it THROWS instead (ENOENT on an
 * entry deleted or renamed under the watcher — api.js Stage-2 `readFileSync`
 * — or any uncaught compiler internal error) the throw unwound past
 * `noteCompileResult` in `runOnce`, `compileFailure` stayed null, and dev kept
 * serving the LAST-GOOD bundle at HTTP 200 for a tree that no longer compiles.
 * And because each source had its own `fs.watch`, the delete/rename killed the
 * watch: no recompile ever fired for that path again — post-#518 a PERMANENT
 * 500 on a project that had since been fixed, until restart.
 *
 * These tests drive the REAL `scrml dev` CLI in a subprocess (ephemeral port —
 * `--port 0`, read back from the `[dev] Serving … at http://localhost:<port>`
 * line) against a throw-away temp project, and observe what is SERVED:
 *
 *   §1  (a) entry deleted under the watcher → HTTP 500 naming ENOENT + the
 *           path (JSON and HTML), NEVER the previous bundle, process alive
 *   §2  (b) delete-then-restore → dev recompiles and serves the RESTORED
 *           content at 200 with no restart; a later in-place edit still
 *           hot-reloads (the watch outlived the delete)
 *   §3  an editor-style atomic save (write tmp + rename over the entry) is
 *           still seen — the same rename class that killed a per-file watch
 *
 * Commands tier: NOT in the pre-commit gate — run `bun test compiler/tests/commands`.
 * On pre-fix dev.js §1 and §2 are RED (proven at 62f5007c/#518 + the port-log
 * change): §1 keeps serving 200, §2 never sees RESTORED.
 */

import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, unlinkSync, renameSync, rmSync, existsSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";

const CLI = resolve(import.meta.dir, "../../bin/scrml.js");

// A minimal but real app: reactive state + interpolation, so the compile is
// the full pipeline (not an empty-file short path). MARKER lands in the served
// HTML so a stale-vs-fresh bundle is distinguishable by body text.
function appSource(marker) {
  return `<div class="app">
    \${
        <count> = 0
    }
    <h1>${marker} \${@count}</>
</div>
`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll `probe()` until it returns truthy or `timeoutMs` elapses. */
async function waitFor(probe, timeoutMs = 10_000, everyMs = 100) {
  const t0 = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const v = await probe();
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) return null;
    await sleep(everyMs);
  }
}

/** One live `scrml dev` subprocess on an ephemeral port over a temp project. */
class DevServer {
  constructor() {
    this.dir = mkdtempSync(join(tmpdir(), "scrml-dev-throw-"));
    this.entry = join(this.dir, "entry.scrml");
    this.out = "";
    this.proc = null;
    this.port = 0;
  }

  async start(marker) {
    writeFileSync(this.entry, appSource(marker));
    this.proc = Bun.spawn(
      ["bun", CLI, "dev", this.entry, "--port", "0", "--output", join(this.dir, "dist")],
      { cwd: this.dir, stdout: "pipe", stderr: "pipe", stdin: "ignore" },
    );
    const pump = async (stream) => {
      for await (const chunk of stream) this.out += new TextDecoder().decode(chunk);
    };
    pump(this.proc.stdout);
    pump(this.proc.stderr);
    const m = await waitFor(() => /\[dev\] Serving .* at http:\/\/localhost:(\d+)/.exec(this.out), 20_000);
    if (!m) throw new Error(`scrml dev did not come up (ephemeral port not logged).\n${this.out}`);
    this.port = Number(m[1]);
    // Wait for the initial bundle to be served with the marker.
    const ok = await waitFor(async () => {
      const r = await this.get("text/html");
      return r.status === 200 && r.body.includes(marker) ? r : null;
    });
    if (!ok) throw new Error(`initial bundle never served 200 with marker.\n${this.out}`);
    return this;
  }

  async get(accept = "text/html") {
    try {
      const r = await fetch(`http://localhost:${this.port}/`, {
        headers: { accept },
        signal: AbortSignal.timeout(3000),
      });
      return { status: r.status, body: await r.text() };
    } catch (e) {
      return { status: -1, body: String(e && e.message) };
    }
  }

  alive() {
    return this.proc && this.proc.exitCode === null && !this.proc.killed;
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

// ---------------------------------------------------------------------------
// §1 — (a) a THROWN compile (ENOENT: entry deleted under the watcher) is
//        served as a 500 naming the error — never the previous bundle
// ---------------------------------------------------------------------------

describe("§1 compileScrml THROW under the watcher → fail CLOSED (500 naming the error), never stale", () => {
  test("rm entry.scrml → 500 JSON names ENOENT + path; HTML overlay too; process alive", async () => {
    const d = await new DevServer().start("Hello v1");
    dev = d;

    unlinkSync(d.entry);

    // The watcher fires, the recompile THROWS (api.js Stage-2 readFileSync
    // ENOENT). Fail-closed dev must serve a non-200 at the request.
    const failing = await waitFor(async () => {
      const r = await d.get("application/json");
      return r.status !== 200 ? r : null;
    }, 8_000);
    expect(failing, `dev kept serving 200 after the entry was deleted (fail-OPEN). Output:\n${d.out}`).not.toBeNull();
    expect(failing.status).toBe(500);

    // The served body NAMES the thrown error: code ENOENT + the file path.
    const json = JSON.parse(failing.body);
    expect(json.error).toBe("scrml compile failed");
    expect(Array.isArray(json.errors)).toBe(true);
    expect(json.errors.length).toBeGreaterThan(0);
    const diag = json.errors[0];
    expect(diag.code).toBe("ENOENT");
    expect(diag.message).toContain("no such file or directory");
    expect(`${diag.file} ${diag.message}`).toContain(d.entry);

    // Page navigation gets the HTML overlay, also 500, also naming the error,
    // and NOT the previous bundle.
    const html = await d.get("text/html");
    expect(html.status).toBe(500);
    expect(html.body).toContain("ENOENT");
    expect(html.body).toContain("entry.scrml");
    expect(html.body).not.toContain("Hello v1");

    // The dev process survived the throw — it is serving the error, not dead.
    expect(d.alive()).toBe(true);
    // And the terminal got the real error, not a bare unhandled-rejection dump.
    expect(d.out).toContain("ENOENT");
  }, 60_000);
});

// ---------------------------------------------------------------------------
// §2 — (b) delete-then-restore RECOVERS live: the watch outlives the delete
// ---------------------------------------------------------------------------

describe("§2 delete-then-restore → dev recompiles and serves 200 again without restart", () => {
  test("rm entry.scrml; recreate it (new inode, like `git checkout`) → RESTORED served; a later edit still hot-reloads", async () => {
    const d = await new DevServer().start("Hello v1");
    dev = d;

    unlinkSync(d.entry);
    // Let the delete be observed (fail-closed → non-200) before restoring, so
    // the recovery below is a real delete→restore round-trip, not a race that
    // never saw the delete.
    await waitFor(async () => (await d.get("application/json")).status !== 200 ? true : null, 8_000);

    // Restore with DIFFERENT content: a stale last-good bundle at 200 would
    // still say "Hello v1", so serving RESTORED proves a real recompile.
    writeFileSync(d.entry, appSource("Hello RESTORED"));
    const restored = await waitFor(async () => {
      const r = await d.get("text/html");
      return r.status === 200 && r.body.includes("Hello RESTORED") ? r : null;
    }, 10_000);
    expect(restored, `dev never recompiled after the entry was restored (watch died on delete). Output:\n${d.out}`).not.toBeNull();

    // The watch is genuinely alive on the RE-CREATED file: an in-place edit
    // is picked up (a dead per-file watch would leave "RESTORED" forever).
    writeFileSync(d.entry, appSource("Hello EDITED"));
    const edited = await waitFor(async () => {
      const r = await d.get("text/html");
      return r.status === 200 && r.body.includes("Hello EDITED") ? r : null;
    }, 10_000);
    expect(edited, `edit after restore was not hot-reloaded. Output:\n${d.out}`).not.toBeNull();
    expect(d.alive()).toBe(true);
    if (existsSync(d.entry)) unlinkSync(d.entry);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// §3 — an editor-style ATOMIC save (write tmp, rename over) is the same
//      rename class: it must not kill hot-reload either
// ---------------------------------------------------------------------------

describe("§3 atomic save (tmp + rename over the entry) keeps hot-reload alive", () => {
  test("write .entry.scrml.tmp then rename over entry.scrml → new content served; a second atomic save is seen too", async () => {
    const d = await new DevServer().start("Hello v1");
    dev = d;

    const atomicSave = (marker) => {
      const tmp = join(d.dir, ".entry.scrml.tmp");
      writeFileSync(tmp, appSource(marker));
      renameSync(tmp, d.entry);
    };

    atomicSave("Hello ATOMIC1");
    const first = await waitFor(async () => {
      const r = await d.get("text/html");
      return r.status === 200 && r.body.includes("Hello ATOMIC1") ? r : null;
    }, 10_000);
    expect(first, `first atomic save not picked up. Output:\n${d.out}`).not.toBeNull();

    // A per-file inode watch dies on the first rename-over; the SECOND save
    // is the one that used to go unseen.
    atomicSave("Hello ATOMIC2");
    const second = await waitFor(async () => {
      const r = await d.get("text/html");
      return r.status === 200 && r.body.includes("Hello ATOMIC2") ? r : null;
    }, 10_000);
    expect(second, `second atomic save not picked up (watch died on the first rename). Output:\n${d.out}`).not.toBeNull();
    expect(d.alive()).toBe(true);
  }, 60_000);
});
