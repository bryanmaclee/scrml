#!/usr/bin/env bun
/**
 * scrml — per-stage perf regression check (PGO P1.4 sibling).
 *
 * S102 (2026-05-18). Reads benchmarks/perf-baseline.json, re-runs the same
 * harness against current state, diffs per stage. Flags any stage >TOLERANCE%
 * slower as potential regression.
 *
 * Exit codes:
 *   0 — no regression detected
 *   1 — at least one regression flagged (CI-friendly)
 *   2 — baseline file missing or invalid
 *
 * Usage:
 *   bun run scripts/perf-regression-check.ts            # default tolerance 10%
 *   bun run scripts/perf-regression-check.ts --tol 15   # 15% tolerance
 *   bun run scripts/perf-regression-check.ts --quiet    # only flag regressions
 *
 * Companion: scripts/benchmark-perf-baseline.ts (writes baseline).
 *
 * Authority: docs/changes/pgo-scoping/SCOPING.md §"P1.4".
 */

import { readFileSync, existsSync, readdirSync } from "fs";
import { resolve, dirname, join, extname } from "path";
import { fileURLToPath } from "url";
import { compileScrml } from "../compiler/src/api.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

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

const STAGE_RE = /^\s*\[([A-Z][A-Z0-9_-]*)\]\s+([\d.]+)ms\s*$/;

const RUNS_PER_CORPUS = 6;
const WARMUP_DISCARD = 1;
const DEFAULT_TOLERANCE_PCT = 10;
// Absolute-delta noise floor — a stage that gained <= MIN_ABS_DELTA_MS in
// absolute terms is treated as JIT/GC jitter regardless of percentage.
// Empirically calibrated S102 against same-commit re-run variance.
const MIN_ABS_DELTA_MS = 2.0;
// Sub-floor stage timings are too noisy to compare on percentage. Skip
// any stage whose baseline is below this floor (different from MIN_ABS).
const STAGE_FLOOR_MS = 5.0;

interface CorpusBaseline {
  inputCount: number;
  perStageMs: Record<string, number>;
  totalMs: number;
  samples: number;
}

interface Baseline {
  schemaVersion: number;
  timestamp: string;
  commit: string;
  machine: Record<string, string>;
  methodology: { runsPerCorpus: number; warmupDiscarded: number; statistic: string };
  corpora: Record<string, CorpusBaseline>;
}

function median(arr: number[]): number {
  if (arr.length === 0) return NaN;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function runOnce(inputs: string[]): { totalMs: number; stages: Map<string, number> } {
  const stages = new Map<string, number>();
  const start = performance.now();
  try {
    compileScrml({
      inputFiles: inputs,
      verbose: true,
      write: false,
      log: (msg: string) => {
        const m = STAGE_RE.exec(msg);
        if (m) stages.set(m[1], parseFloat(m[2]));
      },
    });
  } catch (err) {
    return { totalMs: NaN, stages };
  }
  return { totalMs: performance.now() - start, stages };
}

async function main() {
  const args = process.argv.slice(2);
  const tolIdx = args.indexOf("--tol");
  const tolerancePct = tolIdx >= 0 && args[tolIdx + 1] ? parseFloat(args[tolIdx + 1]) : DEFAULT_TOLERANCE_PCT;
  const quiet = args.includes("--quiet");
  const baselinePath = (() => {
    const i = args.indexOf("--baseline");
    return i >= 0 && args[i + 1] ? resolve(args[i + 1]) : join(REPO_ROOT, "benchmarks/perf-baseline.json");
  })();

  if (!existsSync(baselinePath)) {
    console.error(`error: baseline file not found: ${baselinePath}`);
    console.error(`run \`bun run scripts/benchmark-perf-baseline.ts\` to create one.`);
    process.exit(2);
  }

  let baseline: Baseline;
  try {
    baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  } catch (err) {
    console.error(`error: baseline parse failed: ${(err as Error).message}`);
    process.exit(2);
  }

  console.log(`scrml — perf regression check (PGO P1.4)`);
  console.log(`  baseline: ${baselinePath}`);
  console.log(`  baseline commit: ${baseline.commit.slice(0, 8)} (${baseline.timestamp})`);
  console.log(`  tolerance: ${tolerancePct}% slower flagged as regression`);
  console.log("");

  let regressionsFound = 0;
  // Corpora actually MEASURED, not merely listed in the baseline. A corpus whose inputs cannot be
  // resolved is `[SKIP]`ped below and contributes nothing — see the refusal after the loop.
  let corporaCompared = 0;
  const corpusReport: { corpus: string; stage: string; baselineMs: number; currentMs: number; deltaPct: number }[] = [];

  for (const [corpusName, corpusBaseline] of Object.entries(baseline.corpora)) {
    if (!quiet) console.log(`  ${corpusName}...`);

    const runStages: Map<string, number[]> = new Map();
    const totals: number[] = [];

    for (let i = 0; i < RUNS_PER_CORPUS; i++) {
      // Re-resolve inputs from the corpus name (mirrors benchmark-perf-baseline.ts)
      const inputs = (() => {
        const CORPUS_RESOLVERS: Record<string, () => string[]> = {
          "hello-spa":          () => [join(REPO_ROOT, "examples/01-hello.scrml")],
          "counter-spa":        () => [join(REPO_ROOT, "examples/02-counter.scrml")],
          "remote-data":        () => [join(REPO_ROOT, "examples/16-remote-data.scrml")],
          "contact-book":       () => [join(REPO_ROOT, "examples/03-contact-book.scrml")],
          "todomvc":            () => [join(REPO_ROOT, "benchmarks/todomvc/app.scrml")],
          "multifile":          () => scanScrmlDir(join(REPO_ROOT, "examples/22-multifile")),
          "trucking-dispatch":  () => scanScrmlDir(join(REPO_ROOT, "examples/23-trucking-dispatch")),
        };
        const resolver = CORPUS_RESOLVERS[corpusName];
        if (!resolver) return [];
        try { return resolver(); } catch { return []; }
      })();
      if (inputs.length === 0) {
        console.error(`  [SKIP] ${corpusName} — unknown corpus name`);
        break;
      }
      if (!inputs.every(p => existsSync(p))) {
        console.error(`  [SKIP] ${corpusName} — input missing`);
        break;
      }

      const { totalMs, stages } = runOnce(inputs);
      if (i < WARMUP_DISCARD) continue;
      totals.push(totalMs);
      for (const [name, ms] of stages.entries()) {
        if (!runStages.has(name)) runStages.set(name, []);
        runStages.get(name)!.push(ms);
      }
    }

    if (totals.length === 0) continue;
    corporaCompared++;

    const currentTotal = median(totals);
    const totalDeltaPct = ((currentTotal - corpusBaseline.totalMs) / corpusBaseline.totalMs) * 100;
    if (!quiet) {
      console.log(`    total: baseline ${corpusBaseline.totalMs}ms vs current ${currentTotal.toFixed(2)}ms (${totalDeltaPct >= 0 ? "+" : ""}${totalDeltaPct.toFixed(1)}%)`);
    }
    if (totalDeltaPct > tolerancePct) {
      regressionsFound++;
      corpusReport.push({
        corpus: corpusName,
        stage: "(total)",
        baselineMs: corpusBaseline.totalMs,
        currentMs: currentTotal,
        deltaPct: totalDeltaPct,
      });
    }

    for (const [stageName, samples] of runStages.entries()) {
      const currentMs = median(samples);
      const baselineMs = corpusBaseline.perStageMs[stageName];
      if (baselineMs === undefined) continue;
      // Skip sub-floor stages — % noise too high
      if (baselineMs < STAGE_FLOOR_MS) continue;
      const deltaPct = ((currentMs - baselineMs) / baselineMs) * 100;
      const deltaMs = currentMs - baselineMs;
      // Dual-gate: must exceed BOTH percentage tolerance AND absolute floor
      // (otherwise we flag JIT/GC jitter on small-stage timings as "regression")
      if (deltaPct > tolerancePct && deltaMs > MIN_ABS_DELTA_MS) {
        regressionsFound++;
        corpusReport.push({
          corpus: corpusName,
          stage: stageName,
          baselineMs,
          currentMs,
          deltaPct,
        });
      }
    }
  }

  console.log("");
  // REFUSE A COMPARISON OVER NOTHING (S364). A corpus whose inputs no longer resolve is `[SKIP]`ped
  // and the loop continues, so with EVERY corpus renamed this printed eight `[SKIP]` lines and then
  // "no regressions detected", exit 0. With `corpora: {}` in the baseline it printed no SKIP lines
  // at all — just the clean bill of health. Both measured.
  //
  // "No regressions detected" over zero comparisons is a false statement, not a cautious one. Exit 2
  // (distinct from the 1 a real regression earns) — the run is INCONCLUSIVE, not clean.
  if (corporaCompared === 0) {
    const listed = Object.keys(baseline.corpora).length;
    console.error(`  COMPARED ZERO CORPORA — this run verified NOTHING; refusing to report a verdict.`);
    if (listed === 0) {
      console.error(`  The baseline itself lists NO corpora — it was written by a run that measured nothing.`);
      console.error(`  Re-record with \`bun run scripts/benchmark-perf-baseline.ts\` (which now refuses to`);
      console.error(`  write an empty baseline, so this file predates that guard).`);
    } else {
      console.error(`  The baseline lists ${listed} corpus/corpora and NONE of them could be measured (see [SKIP] above).`);
      console.error(`  Most likely cause: the corpus directories were renamed, moved, or are absent.`);
    }
    process.exit(2);
  }
  if (regressionsFound === 0) {
    console.log(`  no regressions detected — ${corporaCompared} corpus/corpora compared, all stages within ${tolerancePct}% of baseline`);
    process.exit(0);
  }

  console.log(`  ${regressionsFound} regression(s) detected:`);
  console.log("");
  console.log("  corpus              stage          baseline    current    delta");
  console.log("  ------              -----          --------    -------    -----");
  for (const r of corpusReport) {
    const corpusCol = r.corpus.padEnd(20);
    const stageCol = r.stage.padEnd(15);
    const baselineCol = `${r.baselineMs.toFixed(2)}ms`.padStart(10);
    const currentCol = `${r.currentMs.toFixed(2)}ms`.padStart(10);
    const deltaCol = `+${r.deltaPct.toFixed(1)}%`;
    console.log(`  ${corpusCol}${stageCol}${baselineCol}  ${currentCol}  ${deltaCol}`);
  }
  process.exit(1);
}

await main();
