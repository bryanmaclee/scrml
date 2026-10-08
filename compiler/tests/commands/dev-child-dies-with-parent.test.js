/**
 * scrml dev — an app child (`scrml dev --__dev-child <cfg>`) must die with the
 * `scrml dev` parent that spawned it, on EVERY path (S447, change-id
 * s447-dev-child-leak).
 *
 * The leak (measured S445: 81 orphaned bun servers ≈ 3 GB after repeated suite
 * runs; ~3 new orphans per commands-suite run, all `…-1.json` = the RESPAWNED
 * generation): a test edits the entry, the parent starts respawning the app
 * child, and the test then stops the parent. Two holes let the respawning child
 * survive:
 *
 *   1. The parent's SIGTERM/SIGINT/exit reaper killed only `appChild` — the
 *      CURRENT child. A child still starting (spawned, not yet ready, so not yet
 *      assigned to `appChild`) and an old child inside its 3 s kill-grace window
 *      were invisible to it.
 *   2. The child's own orphan guard captured `process.ppid` only AFTER it had
 *      loaded the server routes and bound its port. A parent that died during
 *      that startup window had already been replaced as ppid by init / the
 *      systemd --user subreaper — so the guard recorded the REAPER as its
 *      "launcher" and never fired. (Observed on the leaked orphans: ppid =
 *      `systemd --user`, listening socket alive, sleeping in epoll.)
 *
 * The fix: the parent writes its own pid into the child config, the child
 * guards against THAT pid from its first statement (before any route loading),
 * and the parent kills every child it has spawned — starting, live, or in
 * grace — on exit and on SIGINT/SIGTERM/SIGHUP.
 *
 *   §1  deterministic: a child whose recorded launcher is already dead exits on
 *       its own (pre-fix it ran forever — it guarded the test runner instead).
 *   §2  end-to-end (Linux /proc): SIGTERM the parent while a respawn is in
 *       flight → no `scrml-dev-child-<parentPid>-*` process survives.
 *
 * Commands tier: NOT in the pre-commit gate — run `bun test compiler/tests/commands`.
 */

import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, readFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { parseArgs } from "../../src/commands/dev.js";

const CLI = resolve(import.meta.dir, "../../bin/scrml.js");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(probe, timeoutMs = 10_000, everyMs = 50) {
  const t0 = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const v = await probe();
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) return null;
    await sleep(everyMs);
  }
}

/** Live pids whose argv contains `needle` (Linux /proc; [] where unavailable). */
function pidsWithArg(needle) {
  if (!existsSync("/proc/self/cmdline")) return [];
  const out = [];
  for (const name of readdirSync("/proc")) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const argv = readFileSync(`/proc/${name}/cmdline`, "utf8");
      if (argv.includes(needle)) out.push(Number(name));
    } catch { /* exited between readdir and read */ }
  }
  return out;
}

function killQuiet(pid) {
  try { process.kill(pid, "SIGKILL"); } catch { /* gone */ }
}

const cleanups = [];
afterEach(async () => {
  while (cleanups.length) {
    try { await cleanups.pop()(); } catch { /* best effort */ }
  }
});

describe("§1 the app child follows the parent pid recorded in its config", () => {
  test("a child whose recorded launcher is already dead shuts itself down", async () => {
    const dir = mkdtempSync(join(tmpdir(), "scrml-dev-child-orphan-"));
    const serveDir = join(dir, "dist");
    mkdirSync(serveDir);
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));

    // A pid that existed and is now gone (reaped) — the "dev parent died while
    // the child was still starting" case, without any timing race.
    const gone = Bun.spawn(["true"], { stdout: "ignore", stderr: "ignore" });
    await gone.exited;

    const cfgPath = join(dir, "child.json");
    writeFileSync(cfgPath, JSON.stringify({
      serveDir,
      opts: parseArgs([join(dir, "app.scrml"), "--port", "0"]),
      serverModules: [],
      parentPid: gone.pid,
    }));

    const child = Bun.spawn(["bun", CLI, "dev", "--__dev-child", cfgPath], {
      cwd: dir, stdout: "pipe", stderr: "pipe", stdin: "ignore",
    });
    cleanups.push(() => killQuiet(child.pid));

    const exited = await Promise.race([child.exited.then(() => true), sleep(10_000).then(() => false)]);
    expect(exited, "app child kept running after its recorded `scrml dev` parent was gone (orphan)").toBe(true);
  }, 20_000);
});

describe("§2 stopping `scrml dev` mid-respawn leaves no app child behind", () => {
  test.skipIf(!existsSync("/proc/self/cmdline"))(
    "SIGTERM while the respawned child is starting → every scrml-dev-child-<parentPid>-* process is gone",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "scrml-dev-child-respawn-"));
      const entry = join(dir, "entry.scrml");
      const src = (m) => `<div class="app">\n    \${\n        <count> = 0\n    }\n    <h1>${m} \${@count}</>\n</div>\n`;
      writeFileSync(entry, src("v1"));

      let out = "";
      const dev = Bun.spawn(
        ["bun", CLI, "dev", entry, "--port", "0", "--output", join(dir, "dist")],
        { cwd: dir, stdout: "pipe", stderr: "pipe", stdin: "ignore" },
      );
      const needle = `scrml-dev-child-${dev.pid}-`;
      cleanups.push(async () => {
        killQuiet(dev.pid);
        for (const p of pidsWithArg(needle)) killQuiet(p);
        rmSync(dir, { recursive: true, force: true });
      });
      const pump = async (s) => { for await (const c of s) out += new TextDecoder().decode(c); };
      pump(dev.stdout);
      pump(dev.stderr);

      const up = await waitFor(() => /\[dev\] Serving .* at http:\/\/localhost:(\d+)/.test(out), 30_000);
      expect(up, `scrml dev did not come up.\n${out}`).toBe(true);

      // Trigger a respawn, and stop the parent the moment the respawned child exists
      // — i.e. while it is still starting, before the parent has adopted it.
      writeFileSync(entry, src("v2"));
      const respawning = await waitFor(() => pidsWithArg(`${needle}1.json`).length > 0, 15_000, 5);
      expect(respawning, `the edit never produced a respawned child.\n${out}`).toBe(true);
      dev.kill("SIGTERM");
      await dev.exited;

      // Every child this parent ever spawned must be gone (the child guard polls
      // every 2 s; allow a few cycles).
      const clean = await waitFor(() => pidsWithArg(needle).length === 0, 10_000, 100);
      expect(clean, `orphaned app children survived the parent: ${pidsWithArg(needle).join(", ")}\n${out}`).toBe(true);
    },
    60_000,
  );
});
