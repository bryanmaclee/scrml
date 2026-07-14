// scripts/dock-health.ts — flogence CODEBASE-HEALTH (STATE-AXIS spaghetti metrics; thin slice).
//
// Design: scrml-support/docs/deep-dives/dock-for-codebase-health-2026-06-19.md (the (b-B) MV slice).
// Companion: scripts/dock.ts (code-PROVENANCE / reason-axis) · scripts/flograph.ts (doc @node graph).
//
// WHAT THIS IS — the UNGATED half of dock-for-codebase-health, buildable TODAY.
// The DD established two bipartite "code↔X" graphs, only one of which needs the dock's (0%-covered)
// reason axis:
//   (a) code↔DECISION  — reason-rot / dead-via-dead-reason — dock inv2b seed, COVERAGE-GATED (later).
//   (b) code↔STATE-CELL — threading / spaghettification — the COMPILER already emits this at ~100%
//       coverage via `--emit-block-analysis` (compiler/src/block-analysis.ts:101-113 — `reads`/`writes`
//       dotted state-cell footprints per block). THIS SCRIPT rides (b): no new coverage debt, runs now.
//
// "STORE THE EDGE, NOT THE STATE" still holds — but here the edges are COMPILER-DERIVED (a projection
// over a graph the compiler maintains), not hand-authored docks. So coverage is free + drift-free.
//
// FOOTPRINT DEPTH = "shallow" (block-analysis v1): DIRECT reads/writes only, NO transitive call-graph.
// So these metrics see direct state touches, not what a called helper touches. Honest limit; stated, not
// buried (mirrors the dock truth-ceiling). Transitive footprints are a later block-analysis slice.
//
// STANCE = ADVISORY, NEVER GATING (this-session floor; the framing/packaging is pending the
// dock-health DEBATE). It surfaces navigable signal; it does NOT score code for "cleanliness" or
// pressure extraction — that would violate scrml's co-location-of-behaviour axiom (S206). Always exit 0.
//
// THE THREE METRICS (over the code↔state-cell bipartite graph):
//   1. CELL SCATTERING  (concern spread / coupling): for a state-cell, how many distinct blocks (in how
//      many files) touch it. High = one concern's handling smeared across the codebase.
//   2. BLOCK TANGLING   (focus / cohesion-inverse): for a block, how many distinct state-cells it touches.
//      High = a unit doing many unrelated things at once.
//   3. WRITE COUPLING   (co-occupancy / ordering-hazard): state-cells written by >1 distinct block — the
//      blocks are coupled THROUGH that cell (the strongest shape; the one block-lease also cares about).
//
// MODES:
//   bun scripts/dock-health.ts                REPORT (default) — ranked advisory, top-N each metric
//   bun scripts/dock-health.ts --top N        change the top-N cutoff (default 15)
//   bun scripts/dock-health.ts --corpus a,b   override the .scrml corpus (dirs/globs; recursive)
//   bun scripts/dock-health.ts --json         emit the raw metric tables as JSON (for piping)

import { execSync } from "child_process";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync, mkdtempSync, rmSync, statSync, readdirSync } from "fs";
import { tmpdir } from "os";
import { join, basename } from "path";
import { globSync, rel } from "./flograph.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");

// Default corpus = the dock --coverage corpus (stdlib + examples) so the numbers line up with the
// 628-unit coverage baseline. Override with --corpus for a wider/narrower sweep.
const DEFAULT_CORPUS = [`${ROOT}/stdlib`, `${ROOT}/examples`];

interface BABlock {
  id: string; kind: string; name: string;
  span: { start: number; end: number; line: number; endLine: number };
  reads: string[]; writes: string[]; footprintDepth: string;
}
interface BAFile { version: number; file: string; blocks: BABlock[]; }

// Thin block-analysis shelling — replicated from dock.ts `blockAnalysisDefExts` (dock.ts exports
// nothing). Compile the file with the worktree compiler + read the per-file sidecar. Tolerant: a file
// that fails to compile / emits no sidecar is SKIPPED (modules, intentional-error fixtures, etc.).
function blockAnalysisFor(absPath: string): BAFile | null {
  const tmp = mkdtempSync(join(tmpdir(), "dock-health-"));
  try {
    execSync(`bun ${ROOT}/compiler/bin/scrml.js compile ${absPath} --emit-block-analysis -o ${tmp}`, { stdio: "ignore" });
    const base = basename(absPath).replace(/\.scrml$/, "");
    const artifact = join(tmp, `${base}.block-analysis.json`);
    if (!existsSync(artifact)) return null;
    return JSON.parse(readFileSync(artifact, "utf8")) as BAFile;
  } catch {
    return null;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// Recursive .scrml walk — globSync (flograph) is single-level only, so directory roots need a real
// recursion (dock.ts uses its own `findScrml` for the same reason). Skips build/dep/dot dirs.
function walkScrml(dir: string, out: Set<string>) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.isDirectory()) {
      if (ent.name === "node_modules" || ent.name === "dist" || ent.name.startsWith(".")) continue;
      walkScrml(join(dir, ent.name), out);
    } else if (ent.name.endsWith(".scrml")) {
      out.add(join(dir, ent.name));
    }
  }
}

function collectScrml(roots: string[]): string[] {
  const out = new Set<string>();
  for (const r of roots) {
    try {
      if (statSync(r).isDirectory()) walkScrml(r, out);
      else if (r.endsWith(".scrml")) out.add(r);
      else throw new Error("glob");
    } catch {
      if (r.includes("*")) for (const f of globSync(r)) out.add(f); // single-level glob fallback
    }
  }
  return [...out].sort();
}

// ── aggregate the bipartite graph ───────────────────────────────────────────
interface BlockRec { key: string; file: string; kind: string; name: string; line: number; reads: string[]; writes: string[]; }

function buildGraph(files: string[]) {
  const blocks: BlockRec[] = [];
  let compiled = 0, skipped = 0, emptyFootprint = 0;

  for (const abs of files) {
    const ba = blockAnalysisFor(abs);
    if (!ba) { skipped++; continue; }
    compiled++;
    const relPath = rel(abs);
    for (const b of ba.blocks) {
      if (b.reads.length === 0 && b.writes.length === 0) { emptyFootprint++; continue; } // type/channel/etc — no reactive footprint
      blocks.push({
        key: `${relPath}::${b.name}#${b.span.line}`,
        file: relPath, kind: b.kind, name: b.name, line: b.span.line,
        reads: b.reads, writes: b.writes,
      });
    }
  }

  // CELL IDENTITY = file-qualified `<file>::<cell>`. The footprint emits cell NAMES local to each
  // file's scope, so the SAME bare name in two files is (almost always) two DISTINCT cells — 17 pages
  // each declaring `<errorMessage>` are not one concern. Bare-name aggregation conflated them. The
  // GENUINELY cross-file-shared cells (channel cells, engine-singleton auto-cells) are a v1 GAP (the
  // footprint doesn't mark which names are shared) — surfaced separately as same-name CANDIDATES below,
  // explicitly flagged for verification rather than counted as real cross-file coupling.
  const cellTouchers = new Map<string, Set<string>>();   // file::cell -> blockKeys (any touch)
  const cellWriters = new Map<string, Set<string>>();     // file::cell -> blockKeys (write only)
  const nameToFiles = new Map<string, Set<string>>();     // bareName -> files (the cross-file candidate signal)
  const byKey = new Map<string, BlockRec>();

  const qual = (file: string, cell: string) => `${file}::${cell}`;

  for (const blk of blocks) {
    byKey.set(blk.key, blk);
    const touched = new Set([...blk.reads, ...blk.writes]);
    for (const c of touched) {
      const q = qual(blk.file, c);
      (cellTouchers.get(q) ?? cellTouchers.set(q, new Set()).get(q)!).add(blk.key);
      (nameToFiles.get(c) ?? nameToFiles.set(c, new Set()).get(c)!).add(blk.file);
    }
    for (const c of blk.writes) {
      const q = qual(blk.file, c);
      (cellWriters.get(q) ?? cellWriters.set(q, new Set()).get(q)!).add(blk.key);
    }
  }

  return { blocks, byKey, cellTouchers, cellWriters, nameToFiles, compiled, skipped, emptyFootprint };
}

// ── report ───────────────────────────────────────────────────────────────────
function main() {
  const argv = process.argv.slice(2);
  const top = (() => { const i = argv.indexOf("--top"); return i >= 0 ? parseInt(argv[i + 1], 10) || 15 : 15; })();
  const corpusOverride = (() => { const i = argv.indexOf("--corpus"); return i >= 0 ? argv[i + 1].split(",").map(s => s.startsWith("/") ? s : `${ROOT}/${s}`) : null; })();
  const asJson = argv.includes("--json");

  const files = collectScrml(corpusOverride ?? DEFAULT_CORPUS);
  const g = buildGraph(files);
  const splitKey = (q: string) => { const i = q.lastIndexOf("::"); return { file: q.slice(0, i), cell: q.slice(i + 2) }; };

  // metric ① cell scattering — a file-local cell touched by many blocks WITHIN its file (a god-cell)
  const scattering = [...g.cellTouchers.entries()]
    .map(([q, blks]) => ({ ...splitKey(q), blocks: blks.size }))
    .filter(x => x.blocks > 1)
    .sort((a, b) => b.blocks - a.blocks);

  // metric ② block tangling — distinct cells touched per block (low cohesion). Already file-scoped.
  const tangling = g.blocks
    .map(b => ({ key: b.key, kind: b.kind, cells: new Set([...b.reads, ...b.writes]).size, reads: b.reads.length, writes: b.writes.length }))
    .filter(x => x.cells > 1)
    .sort((a, b) => b.cells - a.cells);

  // metric ③ write coupling — a file-local cell written by >1 block in its file (ordering hazard)
  const coupling = [...g.cellWriters.entries()]
    .map(([q, writers]) => ({ ...splitKey(q), writers: [...writers] }))
    .filter(x => x.writers.length > 1)
    .sort((a, b) => b.writers.length - a.writers.length);

  // ④ cross-file same-name CANDIDATES — names in >1 file. NOT counted as coupling: this is the
  // genuinely-shared (channel/engine-singleton) vs name-collision (17 pages each own `errorMessage`)
  // question the footprint can't answer alone. Surfaced for VERIFICATION, per the dock truth-ceiling.
  const sameName = [...g.nameToFiles.entries()]
    .map(([cell, fs]) => ({ cell, files: [...fs] }))
    .filter(x => x.files.length > 1)
    .sort((a, b) => b.files.length - a.files.length);

  if (asJson) {
    console.log(JSON.stringify({ meta: { compiled: g.compiled, skipped: g.skipped, blocks: g.blocks.length, cells: g.cellTouchers.size }, scattering, tangling, coupling, sameName }, null, 2));
    return;
  }

  const bar = "─".repeat(82);
  console.log(bar);
  console.log("  flogence dock-health — STATE-AXIS spaghetti (advisory; rides --emit-block-analysis)");
  console.log(bar);
  console.log(`  corpus: ${files.length} .scrml file(s) · compiled ${g.compiled} · skipped ${g.skipped} (uncompilable/module)`);
  console.log(`  graph:  ${g.blocks.length} reactive block(s) · ${g.cellTouchers.size} file-local cell(s) · footprint=SHALLOW (direct touches only)`);
  console.log(`  identity: cells are FILE-LOCAL (<file>::<cell>) — cross-file same-name handled in ④, not conflated.`);
  console.log("");

  console.log(`  ① CELL SCATTERING — a cell touched by many blocks within its file = a god-cell (top ${top})`);
  for (const s of scattering.slice(0, top)) console.log(`     ${s.cell.padEnd(30)} ${String(s.blocks).padStart(3)} blocks   ${s.file}`);
  if (scattering.length === 0) console.log("     (none — no file-local cell touched by >1 block)");
  console.log("");

  console.log(`  ② BLOCK TANGLING — a block touching many distinct cells = low cohesion (top ${top})`);
  for (const t of tangling.slice(0, top)) console.log(`     ${(String(t.cells).padStart(3))} cells (r${t.reads}/w${t.writes})  ${t.key}`);
  if (tangling.length === 0) console.log("     (none — no block touches >1 cell)");
  console.log("");

  console.log(`  ③ WRITE COUPLING — a file-local cell written by >1 block = ordering-hazard (top ${top})`);
  for (const c of coupling.slice(0, top)) {
    console.log(`     ${c.cell.padEnd(30)} ${String(c.writers.length).padStart(2)} writers  (${c.file})`);
    for (const w of c.writers.slice(0, 6)) console.log(`        ↳ ${w.slice(w.lastIndexOf("/") + 1)}`);
    if (c.writers.length > 6) console.log(`        ↳ … +${c.writers.length - 6} more`);
  }
  if (coupling.length === 0) console.log("     (none — no file-local cell written by >1 block)");
  console.log("");

  console.log(`  ④ CROSS-FILE SAME-NAME CANDIDATES — VERIFY: genuinely-shared (channel/engine) vs collision (top ${top})`);
  for (const s of sameName.slice(0, top)) console.log(`     ${s.cell.padEnd(30)} in ${String(s.files.length).padStart(2)} files   e.g. ${s.files.slice(0, 2).join(", ")}${s.files.length > 2 ? " …" : ""}`);
  if (sameName.length === 0) console.log("     (none)");
  console.log("");

  console.log(bar);
  console.log("  ADVISORY (investigation surface, not a score/gate) — file paths let you SEE co-located vs");
  console.log("  scattered before acting; no extraction pressure (co-location axiom). footprint=shallow.");
  console.log("  ④ is a v1 GAP: genuine cross-file shared cells (channel/engine) need compiler shared-cell");
  console.log("  marking — until then, same-name cross-file coupling is a candidate to verify, not a count.");
  console.log(bar);
}

main();
