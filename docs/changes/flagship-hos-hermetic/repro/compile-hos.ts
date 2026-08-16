/**
 * compile-hos.ts — compile the flagship trucking-dispatch app IN-PROCESS and
 * write the emitted `hos.html` to a file, optionally AFTER first compiling
 * other inputs in the same process (probes module-level compiler state leaking
 * across `compileScrml` calls — SPEC §58.1 says compile is a pure function).
 *
 * usage: bun compile-hos.ts <outHtml> [prior.scrml ...]
 *   prior.scrml: compiled FIRST in this process (each in its own compileScrml
 *   call), before the flagship compile.
 */
import { resolve } from "path";
import { readdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { compileScrml } from "../../../../compiler/src/api.js";

const REPO = resolve(import.meta.dir, "../../../..");
const APP = resolve(REPO, "examples/23-trucking-dispatch");
const [outHtml, ...priors] = process.argv.slice(2);
if (!outHtml) { console.error("usage: bun compile-hos.ts <outHtml> [prior.scrml ...]"); process.exit(2); }

for (const p of priors) {
  const od = mkdtempSync(resolve(tmpdir(), "scrml-hos-prior-"));
  const r = compileScrml({ inputFiles: [resolve(p)], write: true, outputDir: od, log: () => {} });
  const errs = (r.errors ?? []).map((e: any) => e.code ?? String(e));
  console.error(`[prior] ${p} -> ${errs.length} error(s)${errs.length ? ": " + errs.join(",") : ""}`);
  rmSync(od, { recursive: true, force: true });
}

const inputs: string[] = [];
const walk = (dir: string) => {
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const e of entries) {
    const q = resolve(dir, e.name);
    if (e.isDirectory()) walk(q); else if (e.name.endsWith(".scrml")) inputs.push(q);
  }
};
walk(APP);
const OUT = mkdtempSync(resolve(tmpdir(), "scrml-hos-main-"));
const _cpu0 = process.cpuUsage(); const _t0 = performance.now();
const r = compileScrml({ inputFiles: inputs, write: true, outputDir: OUT, log: () => {} });
const _cpu1 = process.cpuUsage(_cpu0); const _wall = performance.now() - _t0;
console.error(`[flagship] compile wall=${_wall.toFixed(0)}ms cpuUser=${(_cpu1.user/1000).toFixed(0)}ms cpuSys=${(_cpu1.system/1000).toFixed(0)}ms`);
const errs = (r.errors ?? []).map((e: any) => e.code ?? String(e));
console.error(`[flagship] ${errs.length} error(s)${errs.length ? ": " + errs.join(",") : ""}`);
const hits: string[] = [];
const walkOut = (dir: string) => {
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const q = resolve(dir, e.name);
    if (e.isDirectory()) walkOut(q); else if (e.name.endsWith("hos.html")) hits.push(q);
  }
};
walkOut(OUT);
if (hits.length !== 1) { console.error(`[flagship] expected 1 hos.html, found ${hits.length}`); process.exit(3); }
const html = readFileSync(hits[0], "utf8");
writeFileSync(outHtml, html);
const tpls = [...html.matchAll(/<template id="_scrml_scrml_tpl_[^"]*">(.*?)<\/template>/gs)].map((m) => m[1]);
console.error(`[flagship] html=${html.length}B templates=${tpls.length} engineMountInTemplate=${tpls.some((t) => t.includes("data-scrml-engine-mount"))}`);
rmSync(OUT, { recursive: true, force: true });
