// Probe 4: atomic-save patterns against a FRESH per-file watch and a dir watch.
// Enumerate every event (no dedup) so we know what filename each mutation reports.
import { watch, writeFileSync, unlinkSync, renameSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const dir = mkdtempSync(join(tmpdir(), "scrml-watch-probe2-"));
const file = join(dir, "entry.scrml");
writeFileSync(file, "v1");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const log = [];
let fileW = watch(file, (ev, fn) => log.push(`  FILE-watch: ${ev} ${fn}`));
let dirW = watch(dir, (ev, fn) => log.push(`  DIR-watch:  ${ev} ${fn}`));

log.push("--- A. VS Code-style atomic save: write .entry.scrml.tmp.123 then rename over entry.scrml");
writeFileSync(join(dir, ".entry.scrml.tmp.123"), "v2");
renameSync(join(dir, ".entry.scrml.tmp.123"), file);
await sleep(200);
log.push("--- B. in-place write after atomic save — FILE watch alive?");
writeFileSync(file, "v3");
await sleep(200);

log.push("--- C. fresh FILE watch; vim-style: rename entry.scrml -> entry.scrml~ then create entry.scrml");
fileW.close();
fileW = watch(file, (ev, fn) => log.push(`  FILE-watch: ${ev} ${fn}`));
renameSync(file, file + "~");
writeFileSync(file, "v4");
await sleep(200);
log.push("--- D. in-place write after vim-style — FILE watch alive?");
writeFileSync(file, "v5");
await sleep(200);

log.push("--- E. fresh FILE watch; git-checkout-style: rm then create");
fileW.close();
fileW = watch(file, (ev, fn) => log.push(`  FILE-watch: ${ev} ${fn}`));
unlinkSync(file);
await sleep(200);
writeFileSync(file, "v6");
await sleep(200);
log.push("--- F. in-place write after rm+create — FILE watch alive?");
writeFileSync(file, "v7");
await sleep(200);

for (const l of log) console.log(l);
fileW.close(); dirW.close();
