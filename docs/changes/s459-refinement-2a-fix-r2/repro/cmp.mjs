import { readFileSync } from "fs";
const S = "/home/bryan-maclee/.cache/scrml-agent-tmp/s459-ref2a-r2/";
const b = JSON.parse(readFileSync(S + (process.argv[2] ?? "corpus-base.json")));
const h = JSON.parse(readFileSync(S + (process.argv[3] ?? "corpus-head.json")));
let same = 0;
const outcome = [], art = [], added = [], removed = [];
for (const f of Object.keys(h)) {
  if (!b[f]) { added.push(f); continue; }
  const x = b[f].codes.join(","), y = h[f].codes.join(",");
  if (x !== y) outcome.push(`${f}: [${x}] -> [${y}]`);
  const ka = new Set([...Object.keys(b[f].arts), ...Object.keys(h[f].arts)]);
  const d = [...ka].filter((k) => b[f].arts[k] !== h[f].arts[k]);
  if (d.length) art.push(`${f}: ${d.join(" ")}`);
  else if (x === y) same++;
}
for (const f of Object.keys(b)) if (!h[f]) removed.push(f);
console.log("files base", Object.keys(b).length, "head", Object.keys(h).length, "identical", same);
console.log("OUTCOME CHANGES", outcome.length); console.log(outcome.join("\n"));
console.log("ARTIFACT CHANGES", art.length); console.log(art.join("\n"));
console.log("ADDED", added.join(" ")); console.log("REMOVED", removed.join(" "));
