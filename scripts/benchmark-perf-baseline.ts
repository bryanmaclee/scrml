#!/usr/bin/env bun
/**
 * scrml — per-stage compile-time baseline benchmark capture (PGO P1.4).
 *
 * S102 (2026-05-18). Captures median per-stage timings across a 7-corpus
 * harness, writes a versioned baseline JSON. Companion: perf-regression-check.ts
 * diffs current vs baseline.
 *
 * Methodology:
 *   - 6 runs per corpus, run 1 discarded as warmup.
 *   - Median across runs 2-6.
 *   - Stages captured from compileScrml verbose log via `log` callback regex.
 *   - Per-stage line format: `  [STAGE_NAME] Nms` (from api.js:551 stage() helper).
 *
 * Output: benchmarks/perf-baseline.json
 *   - timestamp (ISO)
 *   - commit SHA (HEAD)
 *   - machine fingerprint (CPU model, RAM, OS)
 *   - per-corpus per-stage median ms
 *   - total pipeline ms median per corpus
 *
 * Companion: scripts/perf-regression-check.ts (reads this JSON, re-runs, diffs).
 *
 * Authority: docs/changes/pgo-scoping/SCOPING.md §"P1.4".
 * Baseline reference: docs/changes/perf-characterization/CLOSURE-ANALYSIS-COST.md (S94).
 */

import { writeFileSync, existsSync, statSync, readdirSync } from "fs";
import { resolve, dirname, join, extname } from "path";
import { fileURLToPath } from "url";
import { compileScrml } from "../compiler/src/api.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

// Recursively enumerate .scrml files under a directory; skip `dist/` subtrees
// (those contain compiled artifacts the compiler treats as zero-cost but
// would pollute fileCount measurements).
function scanScrmlDir(root: string): string[] {
  const out: string[] = [];
  function walk(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "dist" || entry.name === "node_modules") continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && extname(entry.name) === ".scrml") out.push(full);
    }
  }
  walk(root);
  return out.sort();
}

// ---------------------------------------------------------------------------
// Corpora — match S94 perf-characterization for trend comparability
// Each corpus entry resolves to a flat input-files array at runtime.
// ---------------------------------------------------------------------------

const CORPORA: { name: string; resolveInputs: () => string[] }[] = [
  { name: "hello-spa",          resolveInputs: () => [join(REPO_ROOT, "examples/01-hello.scrml")] },
  { name: "counter-spa",        resolveInputs: () => [join(REPO_ROOT, "examples/02-counter.scrml")] },
  { name: "remote-data",        resolveInputs: () => [join(REPO_ROOT, "examples/16-remote-data.scrml")] },
  { name: "contact-book",       resolveInputs: () => [join(REPO_ROOT, "examples/03-contact-book.scrml")] },
  { name: "todomvc",            resolveInputs: () => [join(REPO_ROOT, "benchmarks/todomvc/app.scrml")] },
  { name: "multifile",          resolveInputs: () => scanScrmlDir(join(REPO_ROOT, "examples/22-multifile")) },
  { name: "trucking-dispatch",  resolveInputs: () => scanScrmlDir(join(REPO_ROOT, "examples/23-trucking-dispatch")) },
];

const RUNS_PER_CORPUS = 6;        // first is warmup, discarded
const WARMUP_DISCARD = 1;

// ---------------------------------------------------------------------------
// Stage timing capture — parse [STAGE] Nms from log lines
// ---------------------------------------------------------------------------

const STAGE_RE = /^\s*\[([A-Z][A-Z0-9_-]*)\]\s+([\d.]+)ms\s*$/;

function captureStages(): { lines: string[]; stages: Map<string, number> } {
  const lines: string[] = [];
  const stages = new Map<string, number>();
  return {
    lines,
    stages,
  };
}

function runOnce(corpus: { name: string; resolveInputs: () => string[] }, inputs: string[]): { totalMs: number; stages: Map<string, number> } {
  const capture = captureStages();
  const start = performance.now();
  try {
    compileScrml({
      inputFiles: inputs,
      verbose: true,
      write: false,
      log: (msg: string) => {
        capture.lines.push(msg);
        const m = STAGE_RE.exec(msg);
        if (m) {
          const name = m[1];
          const ms = parseFloat(m[2]);
          // Use the LAST [STAGE] sighting per stage (the aggregate emitted at
          // end-of-stage; per-file inner emissions don't match STAGE_RE).
          capture.stages.set(name, ms);
        }
      },
    });
  } catch (err) {
    console.error(`  [FAIL] ${corpus.name}: ${(err as Error).message}`);
    return { totalMs: NaN, stages: capture.stages };
  }
  const totalMs = performance.now() - start;
  return { totalMs, stages: capture.stages };
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

function median(arr: number[]): number {
  if (arr.length === 0) return NaN;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ---------------------------------------------------------------------------
// Machine fingerprint
// ---------------------------------------------------------------------------

async function machineFingerprint(): Promise<Record<string, string>> {
  const fp: Record<string, string> = {
    platform: process.platform,
    arch: process.arch,
    bunVersion: process.versions.bun ?? "unknown",
    nodeVersion: process.versions.node ?? "unknown",
  };
  try {
    const cpuInfo = await Bun.spawn(["lscpu"], { stdout: "pipe" }).stdout;
    const text = await new Response(cpuInfo).text();
    const modelMatch = /Model name:\s+(.+)/i.exec(text);
    if (modelMatch) fp.cpu = modelMatch[1].trim();
  } catch {
    /* lscpu may not be present (macOS etc.) — skip */
  }
  try {
    const memInfo = await Bun.file("/proc/meminfo").text();
    const totalMatch = /MemTotal:\s+(\d+)\s+kB/.exec(memInfo);
    if (totalMatch) fp.totalMemoryMb = String(Math.round(parseInt(totalMatch[1]) / 1024));
  } catch {
    /* not on linux — skip */
  }
  return fp;
}

async function gitCommitSha(): Promise<string> {
  try {
    const proc = Bun.spawn(["git", "rev-parse", "HEAD"], { cwd: REPO_ROOT, stdout: "pipe" });
    const text = await new Response(proc.stdout).text();
    return text.trim();
  } catch {
    return "unknown";
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const outputPath = (() => {
    const i = args.indexOf("--out");
    return i >= 0 && args[i + 1] ? resolve(args[i + 1]) : join(REPO_ROOT, "benchmarks/perf-baseline.json");
  })();

  console.log("scrml — perf baseline benchmark capture (PGO P1.4)");
  console.log(`  runs per corpus: ${RUNS_PER_CORPUS} (first is warmup, discarded)`);
  console.log(`  output: ${dryRun ? "(dry-run; no write)" : outputPath}`);
  console.log("");

  const commitSha = await gitCommitSha();
  const machine = await machineFingerprint();

  const results: Record<string, {
    inputCount: number;
    perStageMs: Record<string, number>;
    totalMs: number;
    samples: number;
  }> = {};

  for (const corpus of CORPORA) {
    let inputs: string[];
    try {
      inputs = corpus.resolveInputs();
    } catch (err) {
      console.log(`  [SKIP] ${corpus.name} — resolveInputs failed: ${(err as Error).message}`);
      continue;
    }
    if (inputs.length === 0 || !inputs.every(p => existsSync(p))) {
      console.log(`  [SKIP] ${corpus.name} — no input files found`);
      continue;
    }
    console.log(`  ${corpus.name} (${inputs.length} input file(s))...`);

    const runStages: Map<string, number[]> = new Map();
    const totals: number[] = [];

    for (let i = 0; i < RUNS_PER_CORPUS; i++) {
      const { totalMs, stages } = runOnce(corpus, inputs);
      if (i < WARMUP_DISCARD) continue;  // discard warmup
      totals.push(totalMs);
      for (const [name, ms] of stages.entries()) {
        if (!runStages.has(name)) runStages.set(name, []);
        runStages.get(name)!.push(ms);
      }
    }

    const perStageMs: Record<string, number> = {};
    for (const [name, samples] of runStages.entries()) {
      perStageMs[name] = parseFloat(median(samples).toFixed(2));
    }
    const totalMs = parseFloat(median(totals).toFixed(2));

    results[corpus.name] = {
      inputCount: inputs.length,
      perStageMs,
      totalMs,
      samples: totals.length,
    };

    console.log(`    median total: ${totalMs}ms (${totals.length} samples)`);
  }

  // REFUSE TO RECORD AN EMPTY BASELINE (S364). Every corpus that cannot resolve is `[SKIP]`ped and
  // the loop carries on, so a renamed `examples/` directory produced `corpora: {}` written to disk
  // at exit 0. That file is worse than no file: `perf-regression-check.ts` iterates the recorded
  // corpora, finds none, and reports "no regressions detected (all stages within N% of baseline)"
  // at exit 0 — forever. The pair was measured end-to-end in that state; a baseline of nothing and
  // a check that passes on it.
  //
  // A baseline over zero corpora is never a legitimate recording. Mirrors
  // scripts/browser-baseline.ts: "Refusing to record or compare an empty set."
  const measured = Object.keys(results).length;
  if (measured === 0) {
    console.error("\n  MEASURED ZERO CORPORA — refusing to write a baseline.");
    console.error("  Every corpus was skipped, so this baseline would assert nothing, and");
    console.error("  perf-regression-check.ts would then pass against it forever (the hollow-gate shape).");
    console.error("  Most likely cause: the corpus directories were renamed, moved, or are absent.");
    process.exit(2);
  }

  const baseline = {
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    commit: commitSha,
    machine,
    methodology: {
      runsPerCorpus: RUNS_PER_CORPUS,
      warmupDiscarded: WARMUP_DISCARD,
      statistic: "median",
    },
    corpora: results,
  };

  if (dryRun) {
    console.log("");
    console.log(JSON.stringify(baseline, null, 2));
    return;
  }

  writeFileSync(outputPath, JSON.stringify(baseline, null, 2) + "\n");
  console.log("");
  console.log(`  wrote: ${outputPath}`);
  console.log(`  commit: ${commitSha.slice(0, 8)}`);
}

await main();
