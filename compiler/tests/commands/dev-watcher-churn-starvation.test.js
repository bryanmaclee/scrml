/**
 * scrml dev — the watcher's debounce must be BOUNDED (max-wait), or sibling
 * churn starves hot-reload forever (S346 fix round on
 * fix/dev-compile-throw-fail-closed; docs/changes/dev-watcher-debounce-maxwait/).
 *
 * The S346 dir-level-watch rework CORRECTLY removed the `.scrml` filename
 * filter from `scheduleRecompile` (an editor's atomic save is reported under
 * its TMP name; a dir event may carry no name at all). But with no filter,
 * EVERY event in a watched source directory reaches the debounce, and the
 * debounce was unbounded: `clearTimeout` + re-arm on every event. Any sibling
 * writing faster than the quiet period (an appended log, a test watcher,
 * editor swap files) re-arms it forever and the stat sweep NEVER runs — a
 * real `.scrml` edit is never detected. PA-measured A/B: pre-rework 102 ms;
 * post-rework NEVER (nothing after 12 s).
 *
 * The pin: under continuous sibling churn (append to a sibling `noise.log`
 * every 40 ms — faster than the 100 ms quiet period), a REAL source edit must
 * be detected within a bounded time. The fix's bound is 250 ms
 * (WATCH_DEBOUNCE_MAX_WAIT_MS) + compile; we assert detection < 2 s.
 *
 * RED on the unbounded debounce (detection never happens), GREEN with the
 * max-wait bound.
 *
 * Commands tier: NOT in the pre-commit gate — run `bun test compiler/tests/commands`.
 */

import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, appendFileSync, rmSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";

const CLI = resolve(import.meta.dir, "../../bin/scrml.js");

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
async function waitFor(probe, timeoutMs = 10_000, everyMs = 25) {
  const t0 = Date.now();
  // eslint-disable-next-line no-constant-condition
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
    this.dir = mkdtempSync(join(tmpdir(), "scrml-dev-churn-"));
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
    const ok = await waitFor(async () => {
      const r = await this.get();
      return r.status === 200 && r.body.includes(marker) ? r : null;
    });
    if (!ok) throw new Error(`initial bundle never served 200 with marker.\n${this.out}`);
    return this;
  }

  async get() {
    try {
      const r = await fetch(`http://localhost:${this.port}/`, {
        headers: { accept: "text/html" },
        signal: AbortSignal.timeout(3000),
      });
      return { status: r.status, body: await r.text() };
    } catch (e) {
      return { status: -1, body: String(e && e.message) };
    }
  }

  async stop() {
    try { this.proc && this.proc.kill(); } catch { /* already gone */ }
    try { this.proc && (await this.proc.exited); } catch { /* ignore */ }
    try { rmSync(this.dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

let dev = null;
let churn = null;
afterEach(async () => {
  if (churn) clearInterval(churn);
  churn = null;
  if (dev) await dev.stop();
  dev = null;
});

describe("dev watcher debounce is BOUNDED — sibling churn cannot starve hot-reload", () => {
  test("a real .scrml edit under continuous 40 ms sibling churn is detected in < 2 s", async () => {
    const d = await new DevServer().start("Hello v1");
    dev = d;

    // Continuous sibling churn in the WATCHED source directory: an unrelated
    // log file appended every 40 ms — faster than the 100 ms quiet period, so
    // an unbounded debounce never fires its sweep.
    const noise = join(d.dir, "noise.log");
    churn = setInterval(() => { try { appendFileSync(noise, "x"); } catch { /* dir gone at teardown */ } }, 40);

    // Let the churn establish (several re-arm cycles) before the real edit.
    await sleep(600);

    // A REAL source edit while churn continues. Detection = the recompile log
    // line appearing AFTER this point.
    const outLenAtEdit = d.out.length;
    const editAt = Date.now();
    writeFileSync(d.entry, appSource("Hello v2"));

    const detected = await waitFor(
      () => d.out.slice(outLenAtEdit).includes("[dev] Change detected") ? Date.now() : null,
      8_000,
    );
    const detectMs = detected === null ? null : detected - editAt;
    expect(
      detectMs,
      `real edit NEVER detected under sibling churn (unbounded debounce starved the stat sweep). Output:\n${d.out}`,
    ).not.toBeNull();
    // Bounded: max-wait (250 ms) + scheduling slop. 2 s is the pin's ceiling.
    expect(detectMs).toBeLessThan(2_000);

    // End-to-end: the edited content is actually SERVED (churn still running).
    const served = await waitFor(async () => {
      const r = await d.get();
      return r.status === 200 && r.body.includes("Hello v2") ? r : null;
    }, 10_000);
    expect(served, `edit detected but new bundle never served. Output:\n${d.out}`).not.toBeNull();

    clearInterval(churn);
    churn = null;
  }, 60_000);
});
