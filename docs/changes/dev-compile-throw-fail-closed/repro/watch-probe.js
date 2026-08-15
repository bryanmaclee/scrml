// Probe 3: fs.watch semantics on THIS platform (Bun + Linux inotify).
//   (a) per-FILE watch: what fires on rm? on recreate? on atomic-save (tmp+rename)?
//   (b) per-DIRECTORY (non-recursive) watch: same three mutations.
import { watch, writeFileSync, unlinkSync, renameSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const dir = mkdtempSync(join(tmpdir(), "scrml-watch-probe-"));
const file = join(dir, "entry.scrml");
writeFileSync(file, "v1");

const log = [];
const fileW = watch(file, (ev, fn) => log.push(`FILE-watch: ${ev} ${fn}`));
fileW.on("error", (e) => log.push(`FILE-watch error: ${e.code}`));
const dirW = watch(dir, (ev, fn) => log.push(`DIR-watch:  ${ev} ${fn}`));
dirW.on("error", (e) => log.push(`DIR-watch error: ${e.code}`));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

log.push("--- 1. in-place write (v2)");
writeFileSync(file, "v2");
await sleep(150);
log.push("--- 2. rm entry.scrml");
unlinkSync(file);
await sleep(150);
log.push("--- 3. recreate entry.scrml (new inode, like git checkout)");
writeFileSync(file, "v3");
await sleep(150);
log.push("--- 4. in-place write again (v4) — does the FILE watch still fire?");
writeFileSync(file, "v4");
await sleep(150);
log.push("--- 5. atomic save: write .tmp then rename over (editor pattern)");
writeFileSync(file + ".tmp", "v5");
renameSync(file + ".tmp", file);
await sleep(150);
log.push("--- 6. in-place write again (v6) — FILE watch alive after atomic save?");
writeFileSync(file, "v6");
await sleep(150);

for (const l of log) console.log(l);
fileW.close(); dirW.close();
