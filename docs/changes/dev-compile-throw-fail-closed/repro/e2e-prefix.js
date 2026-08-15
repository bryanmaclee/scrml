// Probe 5: END-TO-END pre-fix reproduction with the REAL `scrml dev` CLI.
//   1. start dev on a tmp project (ephemeral port via a free-port probe, since
//      pre-fix dev logs `opts.port` not `server.port`),
//   2. GET / -> expect 200 (baseline),
//   3. rm entry.scrml -> what happens? (process death? stale 200? 500?)
//   4. restore entry.scrml -> does dev recover?
import { mkdtempSync, writeFileSync, unlinkSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";

const ROOT = resolve(import.meta.dir, "../../../..");
const CLI = join(ROOT, "compiler/bin/scrml.js");
const dir = mkdtempSync(join(tmpdir(), "scrml-dev-e2e-"));
const entry = join(dir, "entry.scrml");
const SRC = `<div class="app">\n    ${"$"}{ <count> = 0 }\n    <h1>Hello ${"$"}{@count}</>\n</div>\n`;
writeFileSync(entry, SRC);

// free-port probe (only needed because pre-fix dev logs opts.port, not server.port)
const probe = Bun.serve({ port: 0, fetch: () => new Response("") });
const port = probe.port; probe.stop(true);

const proc = Bun.spawn(["bun", CLI, "dev", entry, "--port", String(port), "--output", join(dir, "dist")], {
  cwd: dir, stdout: "pipe", stderr: "pipe",
});
let out = "";
(async () => { for await (const c of proc.stdout) out += new TextDecoder().decode(c); })();
(async () => { for await (const c of proc.stderr) out += new TextDecoder().decode(c); })();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (pred, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (pred()) return true; await sleep(50); } return false; };

await until(() => /Watching for changes/.test(out));
const get = async () => { try { const r = await fetch(`http://localhost:${port}/`, { headers: { accept: "text/html" } }); return { status: r.status, body: await r.text() }; } catch (e) { return { status: "ERR", body: String(e) }; } };

console.log("STEP 2 baseline GET /:", (await get()).status);
console.log("STEP 3 rm entry.scrml");
unlinkSync(entry);
await sleep(1500);
console.log("  proc.exitCode after rm:", proc.exitCode, "| killed:", proc.killed);
const r3 = await get();
console.log("  GET / after rm:", r3.status, r3.status === 200 ? "(SERVED STALE)" : r3.body.slice(0, 200).replace(/\n/g, " "));
console.log("STEP 4 restore entry.scrml");
writeFileSync(entry, SRC);
await sleep(1500);
console.log("  proc.exitCode after restore:", proc.exitCode);
const r4 = await get();
console.log("  GET / after restore:", r4.status);
console.log("STEP 5 edit entry.scrml in place (does hot reload still fire?)");
writeFileSync(entry, SRC.replace("Hello", "Hello EDITED"));
await sleep(1500);
const r5 = await get();
console.log("  GET / after edit:", r5.status, "| body has EDITED:", /EDITED/.test(r5.body));
console.log("---- dev output ----\n" + out);
proc.kill();
