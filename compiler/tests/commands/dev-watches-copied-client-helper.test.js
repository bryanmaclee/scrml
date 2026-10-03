/**
 * S440 item 16 fix round (review F3): `scrml dev` copies a client-reachable
 * plain-JS helper into `<dist>/_scrml_local/`. Its watch set used to hold only
 * `.scrml` sources, so editing the helper left dev serving the STALE copy until
 * restart. The compile now returns `clientHelperSources`, and dev registers
 * them on the same stat sweep it uses for sources.
 *
 * RED before the fix (the served copy stays V1); GREEN after.
 */
import { describe, test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CLI = resolve(import.meta.dir, "../../bin/scrml.js");

describe("scrml dev — an edited client helper is re-copied", () => {
  test("editing lib/util.js changes the served _scrml_local copy", async () => {
    const root = mkdtempSync(join(tmpdir(), "scrml-devhelper-"));
    const port = String(40000 + Math.floor(Math.random() * 20000));
    mkdirSync(join(root, "app"), { recursive: true });
    mkdirSync(join(root, "lib"), { recursive: true });
    writeFileSync(join(root, "scrml.toml"), "");
    writeFileSync(join(root, "lib", "util.js"), "export function dbl(x){ return x*2 } // V1\n");
    writeFileSync(join(root, "app", "page.scrml"),
      'import { dbl } from "../lib/util.js"\n<program>\n<n> = 1\n<button onclick=${@n = dbl(@n)}>go ${@n}</button>\n</program>\n');
    const dev = Bun.spawn(["bun", CLI, "dev", "app", "--port", port, "--output", join(root, "out")],
      { cwd: root, stdout: "ignore", stderr: "ignore" });
    const url = `http://localhost:${port}/_scrml_local/lib/util.js`;
    const get = async () => {
      try { const r = await fetch(url); return r.status === 200 ? await r.text() : ""; } catch { return ""; }
    };
    const waitFor = async (needle, ms) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        if ((await get()).includes(needle)) return true;
        await Bun.sleep(100);
      }
      return false;
    };
    try {
      expect(await waitFor("V1", 20000)).toBe(true);
      await Bun.sleep(300);
      writeFileSync(join(root, "lib", "util.js"), "export function dbl(x){ return x*3 } // V2\n");
      expect(await waitFor("V2", 10000)).toBe(true);
    } finally {
      dev.kill();
      await Bun.sleep(200);
      try { rmSync(root, { recursive: true, force: true }); } catch { /* Windows: a handle may linger */ }
    }
  }, 40000);
});
