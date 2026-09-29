// show.js — print impl#1's user-stylesheet part (reset layer elided), inline style= attrs, and diagnostics.
// Run from the repo root: bun docs/changes/s441-land-bootstrap-css-t3/repro/show.js <file.scrml>
import { compileScrml } from "../../../../compiler/src/api.js";

const f = process.argv[2];
const r = compileScrml({ inputFiles: [f], write: false, log: () => {} });
for (const o of r.outputs.values()) {
  const css = (o.css || "").replace(/@layer reset \{[\s\S]*?\n\}\n?/, "@layer reset { …elided… }\n");
  console.log("--- CSS\n" + css);
  const html = (o.html || "").replace(/<script[\s\S]*?<\/script>/g, "");
  console.log("--- style= attrs:", [...html.matchAll(/style="[^"]*"/g)].map((m) => m[0]));
}
console.log("--- DIAGS", [...(r.errors ?? []), ...(r.warnings ?? [])].map((e) => e.code));
