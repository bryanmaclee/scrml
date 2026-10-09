// Re-compare changed artifacts with the tree path normalized; print the truly changed ones.
import { readFileSync, readdirSync, existsSync } from "fs";
import { resolve } from "path";
const S = "/home/bryan-maclee/.cache/scrml-agent-tmp/s459-ref2a-r2/";
const b = JSON.parse(readFileSync(S + "corpus-base.json"));
const h = JSON.parse(readFileSync(S + "corpus-head.json"));
const read = (root, tree, f, art) => {
  const dir = resolve(S, root, f.replace(/\//g, "__"));
  let p = resolve(dir, art);
  if (art.includes(".HASH.js")) {
    const sub = art.split("/").slice(0, -1).join("/");
    const d2 = resolve(dir, sub);
    const g = existsSync(d2) ? readdirSync(d2).find((x) => /^scrml-runtime\.[a-z0-9]{8}\.js$/.test(x)) : null;
    p = g ? resolve(d2, g) : p;
  }
  if (!existsSync(p)) return null;
  return readFileSync(p, "utf8").split(S + tree).join("TREE").replace(/scrml-runtime\.[a-z0-9]{8}\.js/g, "scrml-runtime.HASH.js");
};
const changed = {};
for (const f of Object.keys(h)) {
  if (!b[f]) continue;
  for (const art of new Set([...Object.keys(b[f].arts), ...Object.keys(h[f].arts)])) {
    if (b[f].arts[art] === h[f].arts[art]) continue;
    const x = read("cout-base", "base", f, art), y = read("cout-head", "head", f, art);
    if (x !== y) (changed[f] ??= []).push(art);
  }
}
const ks = Object.keys(changed);
console.log("truly changed files:", ks.length);
for (const f of ks) console.log(f + ": " + changed[f].join(" "));
