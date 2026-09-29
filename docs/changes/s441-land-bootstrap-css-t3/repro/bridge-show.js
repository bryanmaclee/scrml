// bridge-show.js — does impl#1's output ever WRITE the custom property a stylesheet `@cell` reads?
// Run from the repo root: bun docs/changes/s441-land-bootstrap-css-t3/repro/bridge-show.js <file.scrml> <cell>
import { compileScrml } from "../../../../compiler/src/api.js";

const [f, cell] = process.argv.slice(2);
const r = compileScrml({ inputFiles: [f], write: false, log: () => {} });
const prop = `--scrml-${cell}`;
for (const o of r.outputs.values()) {
  for (const [k, v] of Object.entries(o)) {
    if (typeof v !== "string") continue;
    const hits = [...v.matchAll(new RegExp(`[^\\n]*${prop}[^\\n]*`, "g"))].map((m) => m[0].trim());
    if (hits.length) console.log(k, hits);
  }
}
console.log("DIAGS", (r.errors ?? []).map((e) => e.code));
