/**
 * g-dev-server-binds-all-interfaces — the REAL `scrml dev` / `scrml serve` CLIs
 * listen on loopback by default and on the network only with `--host`.
 *
 * Drives each CLI in a subprocess on an ephemeral port (`--port 0`, read back
 * from its startup line) and probes with raw TCP:
 *
 *   §1  `scrml dev` (default)  → 127.0.0.1 connects; the LAN address does not;
 *                                no network notice printed
 *   §2  `scrml dev --host`     → the LAN address connects; the one-line
 *                                "reachable from the network" notice is printed
 *   §3  `scrml serve` (default)→ 127.0.0.1 connects; the LAN address does not
 *
 * The LAN probes skip when the machine has no non-internal IPv4 address.
 * Commands tier: NOT in the pre-commit gate — run `bun test compiler/tests/commands`.
 */

import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { createConnection } from "net";
import { lanIPv4Addresses } from "../../src/commands/listen.js";

const CLI = resolve(import.meta.dir, "../../bin/scrml.js");
const LAN = lanIPv4Addresses();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function tcpProbe(host, port, timeoutMs = 1500) {
  return new Promise((done) => {
    const sock = createConnection({ host, port });
    const finish = (v) => { try { sock.destroy(); } catch { /* gone */ } done(v); };
    const t = setTimeout(() => finish("timeout"), timeoutMs);
    sock.once("connect", () => { clearTimeout(t); finish("connected"); });
    sock.once("error", () => { clearTimeout(t); finish("refused"); });
  });
}

async function waitFor(probe, timeoutMs = 20_000, everyMs = 100) {
  const t0 = Date.now();
  while (true) {
    const v = await probe();
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) return null;
    await sleep(everyMs);
  }
}

/** A CLI subprocess whose combined output is accumulated in `.out`. */
class Cli {
  constructor(argv, cwd) {
    this.out = "";
    this.cwd = cwd;
    this.proc = Bun.spawn(["bun", CLI, ...argv], { cwd, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
    const pump = async (s) => { for await (const c of s) this.out += new TextDecoder().decode(c); };
    pump(this.proc.stdout);
    pump(this.proc.stderr);
  }
  async port(re) {
    const m = await waitFor(() => re.exec(this.out));
    if (!m) throw new Error(`server did not come up.\n${this.out}`);
    return Number(m[1]);
  }
  async stop() {
    try { this.proc.kill(); } catch { /* gone */ }
    try { await this.proc.exited; } catch { /* ignore */ }
    try { rmSync(this.cwd, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

const DEV_RE = /\[dev\] Serving .* at http:\/\/localhost:(\d+)/;
const SERVE_RE = /listening on http:\/\/localhost:(\d+)/;

function devProject() {
  const dir = mkdtempSync(join(tmpdir(), "scrml-dev-bind-"));
  const entry = join(dir, "entry.scrml");
  writeFileSync(entry, `<div>\n    <h1>bind probe</>\n</div>\n`);
  return { dir, entry };
}

let live = null;
afterEach(async () => {
  if (live) await live.stop();
  live = null;
});

describe("§1 scrml dev binds loopback by default", () => {
  test("127.0.0.1 connects; LAN address does not; no network notice", async () => {
    const { dir, entry } = devProject();
    live = new Cli(["dev", entry, "--port", "0", "--output", join(dir, "dist")], dir);
    const port = await live.port(DEV_RE);
    expect(await tcpProbe("127.0.0.1", port)).toBe("connected");
    if (LAN.length > 0) expect(await tcpProbe(LAN[0], port)).not.toBe("connected");
    expect(live.out).not.toContain("reachable from the network");
  }, 45_000);
});

describe("§2 scrml dev --host opts in to the network", () => {
  test.skipIf(LAN.length === 0)("bare --host: LAN address connects and the notice names it", async () => {
    const { dir, entry } = devProject();
    live = new Cli(["dev", "--host", entry, "--port", "0", "--output", join(dir, "dist")], dir);
    const port = await live.port(DEV_RE);
    expect(await tcpProbe(LAN[0], port)).toBe("connected");
    // The notice is printed right after the "Serving" line — wait for the full line.
    await waitFor(() => /reachable from the network[^\n]*\n/.test(live.out), 5_000);
    const notice = live.out.split(/\r?\n/).filter((l) => l.includes("reachable from the network"));
    expect(notice.length).toBe(1);
    expect(notice[0]).toContain(`http://${LAN[0]}:${port}`);
  }, 45_000);
});

describe("§3 scrml serve binds loopback by default", () => {
  test("127.0.0.1 connects; LAN address does not", async () => {
    const dir = mkdtempSync(join(tmpdir(), "scrml-serve-bind-"));
    live = new Cli(["serve", "--port", "0"], dir);
    const port = await live.port(SERVE_RE);
    expect(await tcpProbe("127.0.0.1", port)).toBe("connected");
    if (LAN.length > 0) expect(await tcpProbe(LAN[0], port)).not.toBe("connected");
    expect(live.out).not.toContain("reachable from the network");
  }, 30_000);
});
