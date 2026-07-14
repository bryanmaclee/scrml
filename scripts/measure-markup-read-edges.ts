/**
 * measure-markup-read-edges.ts
 *
 * A-1.7 ceiling re-measurement tool.
 *
 * Walks the S84-equivalent corpus and counts:
 *   - total `markup-read` DG nodes (one per interpolation/attr/condition site)
 *   - total DG `reads` edges from markup-read -> reactive
 *
 * The S84 study counted **256 implicit markup reads** across its corpus that
 * the DG did NOT lift into edges. A-1 lifted those reads into real
 * `markup-read` DG nodes + `reads` edges. This script measures how many of
 * those 256 we've actually shipped.
 *
 * Run: bun run scripts/measure-markup-read-edges.ts
 */
import { readdirSync, statSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { splitBlocks } from "../compiler/src/block-splitter.js";
import { buildAST } from "../compiler/src/ast-builder.js";
import { runCE } from "../compiler/src/component-expander.ts";
import { runNRBatch } from "../compiler/src/name-resolver.ts";
import { runRI, buildFunctionIndex } from "../compiler/src/route-inference.ts";
import { runDG } from "../compiler/src/dependency-graph.ts";
import { resolveModules } from "../compiler/src/module-resolver.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

function walk(dir: string, acc: string[] = []): string[] {
  let entries: string[] = [];
  try { entries = readdirSync(dir); } catch { return acc; }
  for (const name of entries) {
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) walk(full, acc);
    else if (name.endsWith(".scrml")) acc.push(full);
  }
  return acc;
}

const corpus: string[] = [];
walk(join(ROOT, "examples"), corpus);
walk(join(ROOT, "benchmarks", "todomvc"), corpus);
walk(join(ROOT, "benchmarks", "sql-batching"), corpus);

console.log(`# A-1.7 markup-read DG edge measurement`);
console.log(`# corpus: ${corpus.length} .scrml files`);
console.log(`#`);

const tabResults: any[] = [];
const failed: string[] = [];

for (const file of corpus) {
  try {
    const src = readFileSync(file, "utf8");
    const bs = splitBlocks(file, src);
    if (bs.errors && bs.errors.some((e: any) => e.severity !== "warning")) {
      failed.push(`${file}: BS error: ${bs.errors.find((e: any) => e.severity !== "warning")!.message}`);
      continue;
    }
    const tab = buildAST(bs, null);
    if (tab.errors && tab.errors.some((e: any) => e.severity !== "warning")) {
      // Some files may have TAB warnings — only block on fatal
      const fatal = tab.errors.find((e: any) => e.severity === "error");
      if (fatal) {
        failed.push(`${file}: TAB error: ${fatal.message}`);
        continue;
      }
    }
    tabResults.push(tab);
  } catch (e) {
    failed.push(`${file}: ${(e as Error).message}`);
  }
}

// MOD + NR + CE + RI + DG over the corpus.
try {
  resolveModules(tabResults);
} catch (e) {
  console.log(`# WARN MOD: ${(e as Error).message}`);
}
try { runNRBatch(tabResults); } catch (e) { console.log(`# WARN NR: ${(e as Error).message}`); }

let dgResult;
try {
  const ceResult = runCE({ files: tabResults });
  const fnIndex = buildFunctionIndex(ceResult.files);
  const ri = runRI({ files: ceResult.files, functionIndex: fnIndex });
  dgResult = runDG({ files: ceResult.files, routeMap: ri.routeMap });
} catch (e) {
  console.log(`# FATAL pipeline: ${(e as Error).message}`);
  process.exit(1);
}

const dg = dgResult.depGraph;
const perFile = new Map<string, { nodes: number; readsEdges: number }>();
const markupReadNodeIds = new Set<string>();

for (const [id, n] of dg.nodes) {
  if (n && (n as any).kind === "markup-read") {
    markupReadNodeIds.add(id);
    const file = (n as any).span?.file ?? "<unknown>";
    const entry = perFile.get(file) ?? { nodes: 0, readsEdges: 0 };
    entry.nodes++;
    perFile.set(file, entry);
  }
}

for (const e of dg.edges || []) {
  if (e.kind !== "reads") continue;
  if (!markupReadNodeIds.has(e.from)) continue;
  const fromNode = dg.nodes.get(e.from) as any;
  const file = fromNode?.span?.file ?? "<unknown>";
  const entry = perFile.get(file) ?? { nodes: 0, readsEdges: 0 };
  entry.readsEdges++;
  perFile.set(file, entry);
}

let totalNodes = 0;
let totalReadsEdges = 0;
const rows: Array<{ file: string; nodes: number; readsEdges: number }> = [];
for (const [file, v] of perFile) {
  rows.push({ file: file.replace(ROOT, ""), nodes: v.nodes, readsEdges: v.readsEdges });
  totalNodes += v.nodes;
  totalReadsEdges += v.readsEdges;
}
rows.sort((a, b) => b.nodes - a.nodes);

console.log(`file\tnodes\treads_edges`);
for (const r of rows) {
  if (r.nodes > 0) console.log(`${r.file}\t${r.nodes}\t${r.readsEdges}`);
}

console.log(`#`);
console.log(`# TOTAL markup-read nodes: ${totalNodes}`);
console.log(`# TOTAL markup-read -> reactive reads edges: ${totalReadsEdges}`);
console.log(`# S84 ceiling (256-edge): scrml-support/docs/diagnostics/reactive-graph-static-resolvability-S84.md L122`);
console.log(`# Status: ${totalReadsEdges >= 256 ? "AT/OVER ceiling" : totalReadsEdges >= 200 ? "NEAR ceiling (>200)" : totalReadsEdges >= 150 ? "MID (>=150)" : "UNDER ceiling"}`);

if (failed.length > 0) {
  console.log(`#`);
  console.log(`# ${failed.length} files failed to compile (excluded from totals):`);
  for (const f of failed.slice(0, 30)) console.log(`#   ${f}`);
}
