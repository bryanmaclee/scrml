// Probe 7 (post-fix sanity): INITIAL compile throws (entry missing at boot).
// Pre-fix: the throw unwound out of runDev -> process died before serving.
// Post-fix: dev must come up, serve the ENOENT error at 500, then recover
// live when the entry is created.
import { mkdtempSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";

const ROOT = resolve(import.meta.dir, "../../../..");
const CLI = join(ROOT, "compiler/bin/scrml.js");
const dir = mkdtempSync(join(tmpdir(), "scrml-dev-initial-"));
const entry = join(dir, "entry.scrml");
// NOTE: entry deliberately NOT written yet.

const proc = Bun.spawn(["bun", CLI, "dev", entry, "--port", "0", "--output", join(dir, "dist")], {
  cwd: dir, stdout: "pipe", stderr: "pipe",
});
let out = "";
(async () => { for await (const c of proc.stdout) out += new TextDecoder().decode(c); })();
(async () => { for await (const c of proc.stderr) out += new TextDecoder().decode(c); })();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (pred, ms = 10000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = pred(); if (v) return v; await sleep(50); } return null; };

const m = await until(() => /Serving .* at http:\/\/localhost:(\d+)/.exec(out));
console.log("boot with missing entry — server came up:", !!m, "| proc alive:", proc.exitCode === null);
if (!m) { console.log(out); proc.kill(); process.exit(1); }
const port = Number(m[1]);
const get = async () => { const r = await fetch(`http://localhost:${port}/`, { headers: { accept: "text/html" } }); return { status: r.status, body: await r.text() }; };
const r1 = await get();
console.log("GET / while entry missing:", r1.status, "| names ENOENT:", r1.body.includes("ENOENT"), "| names path:", r1.body.includes("entry.scrml"));
writeFileSync(entry, `<div>${"$"}{ <count> = 0 }<h1>BORN ${"$"}{@count}</></div>\n`);
const ok = await until(() => null, 0) ?? await (async () => { const t = Date.now(); while (Date.now() - t < 10000) { const r = await get(); if (r.status === 200 && r.body.includes("BORN")) return r; await sleep(100); } return null; })();
console.log("after creating the entry: recovered 200 with new content:", !!ok);
proc.kill();
