// s458 — corpus emit manifest for a base-vs-head differential.
// Compiles every *.scrml under samples/ examples/ conformance/ stdlib/ (each file on its own) with the
// compiler rooted at <compilerRoot> and writes { file: { codes, outputs: { name: sha1 } } } to <manifest>.
// Output texts are kept under <outRoot>/<idx>/ for inspecting differences.
// Usage: bun emit-manifest.mjs <compilerRoot> <outRoot> <manifest.json>
import { resolve, relative } from "path";
import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { createHash } from "crypto";

const [compilerRoot, outRoot, manifestPath] = process.argv.slice(2).map((p) => resolve(p));
const wt = resolve(new URL(".", import.meta.url).pathname, "../../../..");
const { compileScrml } = await import(resolve(compilerRoot, "compiler/src/api.js"));

function walk(d, out) {
  for (const n of readdirSync(d)) {
    if (n === "node_modules" || n === "dist" || n.startsWith(".")) continue;
    const p = resolve(d, n);
    if (statSync(p).isDirectory()) walk(p, out); else if (n.endsWith(".scrml")) out.push(p);
  }
  return out;
}
const files = ["samples", "examples", "conformance", "stdlib"].flatMap((d) => walk(resolve(wt, d), [])).sort()
  .filter((f) => !process.env.S458_FILTER || relative(wt, f).startsWith(process.env.S458_FILTER));
rmSync(outRoot, { recursive: true, force: true });
const manifest = {};
files.forEach((f, idx) => {
  const rel = relative(wt, f);
  const outDir = resolve(outRoot, String(idx));
  mkdirSync(outDir, { recursive: true });
  let entry;
  try {
    const r = compileScrml({ inputFiles: [f], write: true, outputDir: outDir, log: () => {} });
    const codes = [...(r.errors ?? []), ...(r.warnings ?? [])].map((e) => e.code ?? "?").sort();
    const outputs = {};
    const walkOut = (d) => {
      if (!existsSync(d)) return;
      for (const n of readdirSync(d)) {
        const p = resolve(d, n);
        if (statSync(p).isDirectory()) walkOut(p);
        else outputs[relative(outDir, p)] = createHash("sha1").update(readFileSync(p, "utf8").split(outDir).join("<OUT>")).digest("hex");
      }
    };
    walkOut(outDir);
    entry = { idx, codes, outputs };
  } catch (e) {
    entry = { idx, threw: String(e && e.message).slice(0, 200) };
  }
  manifest[rel] = entry;
});
writeFileSync(manifestPath, JSON.stringify(manifest));
console.log(`${files.length} files -> ${manifestPath}`);
