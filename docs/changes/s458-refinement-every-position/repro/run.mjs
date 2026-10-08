// s458 Phase 0 — compile every reproducer in sources.mjs, report diagnostics + whether a §53 check was emitted.
// Usage (from the worktree root):  bun docs/changes/s458-refinement-every-position/repro/run.mjs [outRoot] [nameFilter]
// outRoot defaults to <worktree>/.tmp/s458-out (scratch; not committed).
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { writeFileSync, readFileSync, mkdirSync, rmSync, existsSync, readdirSync } from "fs";
import { PROBES } from "./sources.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const wt = resolve(here, "../../../..");
const { compileScrml } = await import(resolve(wt, "compiler/src/api.js"));
const outRoot = process.argv[2] ? resolve(process.argv[2]) : resolve(wt, ".tmp/s458-out");
const filter = process.argv[3] ?? "";

for (const p of PROBES) {
  if (filter && !p.name.includes(filter)) continue;
  const srcPath = resolve(here, `${p.name}.scrml`);
  writeFileSync(srcPath, p.src);
  const dir = resolve(outRoot, p.name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  // compile a COPY so the dist lands in scratch, not next to the kept reproducer
  const input = resolve(dir, "app.scrml");
  writeFileSync(input, p.src);
  const outDir = resolve(dir, "out");
  let result;
  try {
    result = compileScrml({ inputFiles: [input], write: true, outputDir: outDir, log: () => {}, ...(p.mode ? { mode: p.mode } : {}) });
  } catch (e) {
    console.log(`\n## ${p.name}: COMPILER THREW ${e && e.message}`);
    continue;
  }
  const diags = [...(result.errors ?? []), ...(result.warnings ?? [])]
    .map((e) => `${e.code ?? "?"}${e.severity ? "/" + e.severity : ""}`)
    .filter((c) => !/^I-/.test(c));
  const files = existsSync(outDir) ? readdirSync(outDir).filter((f) => f.endsWith(".js") && !/^scrml-runtime/.test(f)) : [];
  console.log(`\n## ${p.name}${p.mode ? " (mode " + p.mode + ")" : ""}`);
  console.log(`   diagnostics: ${diags.length ? [...new Set(diags)].join(", ") : "(none)"}`);
  for (const f of files) {
    const js = readFileSync(resolve(outDir, f), "utf8");
    const rt = (js.match(/E-CONTRACT-001-RT/g) ?? []).length;
    const judge = (js.match(/_scrml_url_shape_ok\(/g) ?? []).length - (js.match(/function _scrml_url_shape_ok\(/g) ?? []).length;
    const def = (js.match(/function _scrml_url_shape_ok\(/g) ?? []).length;
    console.log(`   ${f}: E-CONTRACT-001-RT x${rt}; url-judge calls x${judge}; judge defined x${def}`);
  }
}
