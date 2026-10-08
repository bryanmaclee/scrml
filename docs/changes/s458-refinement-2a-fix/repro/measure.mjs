// S458 2a-fix F3 — compile time, peak RSS and artifact sizes of one source under one compiler tree.
// Usage: bun measure.mjs <compilerTreeRoot> <input.scrml> <outDir>
// (run once per tree: base copy, 2a copy, this worktree). Prints one line.
import { resolve } from "path";
import { spawnSync } from "child_process";
import { readdirSync, statSync, rmSync, mkdirSync, writeFileSync } from "fs";
const [tree, input, outDir] = process.argv.slice(2).map((p) => resolve(p));
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
const child = resolve(outDir, "_compile.mjs");
writeFileSync(child, `const { compileScrml } = await import(${JSON.stringify(resolve(tree, "compiler/src/api.js"))});
const r = compileScrml({ inputFiles: [${JSON.stringify(input)}], write: true, outputDir: ${JSON.stringify(resolve(outDir, "out"))}, log: () => {} });
const errs = (r.errors ?? []).filter((e) => (e.severity ?? "error") === "error" && !/^[WI]-/.test(e.code ?? ""));
console.log("errors=" + errs.map((e) => e.code).join(","));
`);
const r = spawnSync("/usr/bin/time", ["-f", "TIME %e %M", "bun", child], { encoding: "utf8", maxBuffer: 1 << 26 });
const t = /TIME ([\d.]+) (\d+)/.exec(r.stderr ?? "");
const sizes = {};
try {
  for (const f of readdirSync(resolve(outDir, "out"))) {
    if (!f.endsWith(".js") || f.startsWith("scrml-runtime")) continue;
    const k = f.replace(/^.*?\./, "");
    sizes[k] = (sizes[k] ?? 0) + statSync(resolve(outDir, "out", f)).size;
  }
} catch { /* no artifacts */ }
console.log(`${tree.split("/").slice(-2).join("/")}  ${(r.stdout ?? "").trim()}  time=${t ? t[1] : "?"}s  rss=${t ? Math.round(+t[2] / 1024) : "?"}MB  ${Object.entries(sizes).map(([k, v]) => `${k}=${v}B`).join(" ")}`);
