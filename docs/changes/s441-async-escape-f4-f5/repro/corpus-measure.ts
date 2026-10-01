// Corpus measurement for the newly-rejecting S440 F4 rule (and the F5 / FP changes).
// Compiles every .scrml under the in-repo corpus roots ONE FILE AT A TIME with the
// compiler rooted at <compilerRoot>, and writes { file: [error codes] } as JSON.
//
//   bun corpus-measure.ts <compilerRoot> <repoRoot> <out.json> [extraRoot…]
//
// <compilerRoot> is a tree holding compiler/src (a base checkout or the worktree).
import { readdirSync, statSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";

const [compilerRoot, repoRoot, outPath, ...extra] = process.argv.slice(2);
const roots = ["examples", "samples", "conformance/cases", "docs/readme-snippets", "stdlib"].map((r) => join(repoRoot, r));
for (const e of extra) roots.push(e);

function walk(dir: string, out: string[]): void {
  let ents: string[];
  try { ents = readdirSync(dir); } catch { return; }
  for (const e of ents) {
    if (e === "node_modules" || e === "dist" || e.startsWith(".")) continue;
    const p = join(dir, e);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, out);
    else if (e.endsWith(".scrml")) out.push(p);
  }
}
const files: string[] = [];
for (const r of roots) walk(r, files);
files.sort();

const { compileScrml } = await import(join(compilerRoot, "compiler/src/api.js"));
const result: Record<string, string[]> = {};
const scratch = mkdtempSync(join(process.env.SCRATCH_DIR ?? tmpdir(), "s441-corpus-"));
let i = 0;
for (const f of files) {
  i++;
  const outDir = join(scratch, String(i));
  let codes: string[] = [];
  try {
    const r = compileScrml({ inputFiles: [f], outputDir: outDir, write: false, log: () => {} });
    codes = (r.errors ?? [])
      .filter((e: { severity?: string; code?: string }) => e && e.severity !== "warning" && e.severity !== "info" && !/^[WI]-/.test(String(e.code ?? "")))
      .map((e: { code?: string }) => String(e.code ?? "?"));
  } catch (e) {
    codes = [`THREW:${String((e as Error)?.message ?? e).slice(0, 80)}`];
  }
  const key = f.startsWith(repoRoot) ? relative(repoRoot, f) : f;
  result[key] = [...new Set(codes)].sort();
}
rmSync(scratch, { recursive: true, force: true });
writeFileSync(outPath, JSON.stringify(result, null, 1));
console.log(`${files.length} files -> ${outPath}`);
