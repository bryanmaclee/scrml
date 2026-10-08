// s458 — compare two emit manifests (emit-manifest.mjs). Prints every file whose diagnostics or outputs differ.
// Usage: bun emit-compare.mjs <base.json> <head.json> [<baseOutRoot> <headOutRoot>]   (roots → print a unified line diff)
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
const [a, b, ra, rb] = process.argv.slice(2);
const A = JSON.parse(readFileSync(a, "utf8"));
const B = JSON.parse(readFileSync(b, "utf8"));
let same = 0, diff = 0;
const strip = (s) => s.replace(/scrml-runtime\.[a-z0-9]+\.js/g, "scrml-runtime.<h>.js");
for (const f of Object.keys(A).sort()) {
  const x = A[f], y = B[f];
  if (!y) { console.log(`MISSING in head: ${f}`); diff++; continue; }
  const cx = JSON.stringify(x.codes ?? x.threw), cy = JSON.stringify(y.codes ?? y.threw);
  const ox = x.outputs ?? {}, oy = y.outputs ?? {};
  const names = new Set([...Object.keys(ox), ...Object.keys(oy)].map(strip));
  const nx = Object.fromEntries(Object.entries(ox).map(([k, v]) => [strip(k), v]));
  const ny = Object.fromEntries(Object.entries(oy).map(([k, v]) => [strip(k), v]));
  const changed = [...names].filter((n) => nx[n] !== ny[n]);
  if (cx === cy && changed.length === 0) { same++; continue; }
  diff++;
  console.log(`\nDIFF ${f}`);
  if (cx !== cy) console.log(`  codes base: ${cx}\n  codes head: ${cy}`);
  for (const n of changed) {
    console.log(`  output ${n}: ${nx[n] ? "changed" : "added"}${ny[n] ? "" : " (removed)"}`);
    if (ra && rb) {
      const real = (o, root, idx) => { const k = Object.keys(o).find((q) => strip(q) === n); return k ? resolve(root, String(idx), k) : null; };
      const pa = real(ox, ra, x.idx), pb = real(oy, rb, y.idx);
      const la = pa && existsSync(pa) ? readFileSync(pa, "utf8").split("\n") : [];
      const lb = pb && existsSync(pb) ? readFileSync(pb, "utf8").split("\n") : [];
      const sa = new Set(la), sb = new Set(lb);
      for (const l of la) if (!sb.has(l)) console.log(`    - ${l.slice(0, 160)}`);
      for (const l of lb) if (!sa.has(l)) console.log(`    + ${l.slice(0, 160)}`);
    }
  }
}
console.log(`\nidentical: ${same}   different: ${diff}`);
