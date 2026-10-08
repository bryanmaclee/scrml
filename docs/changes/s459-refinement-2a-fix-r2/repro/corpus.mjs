// usage: bun corpus.mjs <tree> <outRoot> <outJson>
// Compiles every .scrml under samples/ examples/ conformance/cases/ (the tree's own copy),
// recording error codes and a hash of every emitted artifact.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, rmSync } from "fs";
import { resolve, relative } from "path";
import { createHash } from "crypto";
const [tree, outRoot, outJson] = process.argv.slice(2);
const { compileScrml } = await import(tree + "/compiler/src/api.js");
const files = [];
const walk = (d) => {
  for (const e of readdirSync(d)) {
    if (e === "node_modules" || e === "dist" || e.startsWith(".")) continue;
    const p = resolve(d, e);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (e.endsWith(".scrml")) files.push(relative(tree, p));
  }
};
for (const r of ["samples", "examples", "conformance/cases"]) walk(resolve(tree, r));
files.sort();
const res = {};
let i = 0;
for (const f of files) {
  const out = resolve(outRoot, f.replace(/\//g, "__"));
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  let codes;
  try {
    const r = compileScrml({ inputFiles: [resolve(tree, f)], write: true, outputDir: out, log: () => {} });
    codes = [...new Set((r.errors ?? []).filter((e) => (e.severity ?? "error") === "error" && !/^[WI]-/.test(e.code ?? "")).map((e) => e.code))].sort();
  } catch (e) { codes = ["CRASH:" + String(e.message).slice(0, 80)]; }
  const arts = {};
  const aw = (d) => { for (const g of readdirSync(d)) { const p = resolve(d, g); if (statSync(p).isDirectory()) aw(p); else arts[relative(out, p).replace(/\.[a-z0-9]{8}\.js$/, ".HASH.js")] = createHash("sha1").update(readFileSync(p)).digest("hex").slice(0, 12); } };
  try { aw(out); } catch {}
  res[f] = { codes, arts };
  if (++i % 300 === 0) console.error(i, "/", files.length);
}
writeFileSync(outJson, JSON.stringify(res));
console.error("done", files.length);
