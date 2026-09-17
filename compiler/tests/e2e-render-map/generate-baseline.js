/**
 * generate-baseline.js — the STANDING e2e render-map generator (the deliverable).
 *
 * Per the DD §thin-build step 4 + §"Gate mechanics": runs the L1 harness across
 * the whole render corpus and writes the known-failure MAP to
 * `e2e-render-map-baseline.json`. This is the gap-DISCOVERY surface — it is
 * allowed to contain any number of fails-compile / throws / smell cells; gaps
 * existing is NOT a failure. A green->red regression is what `--check` exits 1
 * on; e2e-render-map.test.js only WARNS on it for the examples+benchmarks slice.
 * ⛑ S419: no CI job, package script or git hook invokes this file or that suite
 * directory by name — both run only by hand (see e2e-render-map.test.js header).
 *
 * Each (app, seed) cell is observed in an ISOLATED SUBPROCESS (observe-one.js)
 * with a hard timeout, because some meta-heavy corpus apps hang/loop at mount in
 * happy-dom (e.g. samples/gauntlet-r18/rails-dev.scrml). A hang is recorded as a
 * HARNESS-TIMEOUT cell — classified, NEVER hidden (DD §"DO NOT SUPPRESS ANY
 * ERROR CLASS"). This also prevents happy-dom global-state bleed across apps.
 *
 * Usage:
 *   bun compiler/tests/e2e-render-map/generate-baseline.js            # write baseline
 *   bun compiler/tests/e2e-render-map/generate-baseline.js --check    # in-memory; diff vs on-disk; exit 1 on green->red delta
 *   bun compiler/tests/e2e-render-map/generate-baseline.js --print    # write + print the histogram + red cells
 *
 * The map schema (mirrors parser-conformance-within-node-allowlist.json shape —
 * a per-cell residual record keyed by "<relpath>#<seed>"):
 *   { "<relpath>#<seed>": { state, smells: [...], seeded: bool } }
 * plus a top-level "_meta" with the run timestamp + per-state histogram.
 */

import { spawnSync } from "node:child_process";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { enumerateRenderCorpus } from "./render-corpus-enumerator.js";
import { seedFor } from "./seed-fixtures.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const OBSERVE_ONE = join(__dirname, "observe-one.js");
export const BASELINE_PATH = join(__dirname, "e2e-render-map-baseline.json");

// Per-app subprocess wall-clock budget. go-dev mounts in ~8s; rails-dev hangs.
// 20s lets the slow-but-finite apps through while bounding the hangers.
const PER_CELL_TIMEOUT_MS = 20000;

/**
 * States that are NOT a gap (green). Everything else is a red/recorded cell.
 * `needs-server` is non-gap: a server-dependent app mounted with NO server is
 * NOT broken (harness-realism, S203 b+c) — so the delta-gate treats throw->
 * needs-server as an improvement and needs-server->throw (a real codegen bug
 * surfacing) as a green->red regression.
 */
export const GREEN_STATES = new Set([
  "renders-clean",
  "renders-empty",
  "needs-server",
]);

/**
 * Observe one cell in a subprocess. Returns the recorded cell object. On
 * timeout or a non-JSON exit, returns a HARNESS-TIMEOUT / HARNESS-ERROR cell —
 * a real recorded state, never a suppression.
 */
export function observeCellSubprocess(relpath, seedLabel) {
  const cellKey = `${relpath}#${seedLabel}`;
  const res = spawnSync("bun", [OBSERVE_ONE, relpath, seedLabel], {
    cwd: __dirname,
    timeout: PER_CELL_TIMEOUT_MS,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (res.error && res.error.code === "ETIMEDOUT") {
    return {
      cellKey,
      state: "HARNESS-TIMEOUT",
      smells: ["MOUNT-HANG"],
      detail: { timeoutMs: PER_CELL_TIMEOUT_MS, note: "subprocess killed — app hangs/loops at mount" },
      seeded: seedLabel !== "empty",
    };
  }
  const out = (res.stdout ?? "").trim().split("\n").filter(Boolean);
  const last = out.length > 0 ? out[out.length - 1] : "";
  try {
    return JSON.parse(last);
  } catch (_e) {
    return {
      cellKey,
      state: "HARNESS-ERROR",
      smells: ["NON-JSON-SUBPROCESS-EXIT"],
      detail: {
        code: res.status,
        stderrTail: (res.stderr ?? "").slice(-300),
      },
      seeded: seedLabel !== "empty",
    };
  }
}

/**
 * The seed labels observed for one corpus app: always "empty", plus "populated" when a
 * seed fixture is registered. The ONE definition of which cells an app has — used by
 * runCorpus, by the suite's slice delta, and by liveCellKeys (the orphan check).
 */
export function seedLabelsFor(app) {
  return seedFor(app.relpath) ? ["empty", "populated"] : ["empty"];
}

/** Every cell key ("<relpath>#<seed>") the current corpus + seeds produce. */
export function liveCellKeys(corpus = enumerateRenderCorpus()) {
  const keys = new Set();
  for (const app of corpus) {
    for (const seedLabel of seedLabelsFor(app)) keys.add(`${app.relpath}#${seedLabel}`);
  }
  return keys;
}

/**
 * Baseline cell keys that match no live cell, sorted.
 *
 * ⛑ S419 residuals (g-e2e-render-map-baseline-keys-have-drifted-and-orphan-cells-are-never-flagged)
 * — every comparison in this tier walks LIVE cells and looks each one up in the baseline, so a
 * baseline cell whose app was renamed, removed, or re-keyed (per-route-roles' entry moved from
 * `routes/loads.scrml` to `routes/admin.scrml` after the S347 sort) is never visited: it keeps
 * its recorded state forever and nothing says so. This walks the other direction.
 */
export function findOrphanBaselineCells(baselineCells, liveKeys) {
  return Object.keys(baselineCells ?? {}).filter((k) => !liveKeys.has(k)).sort();
}

/**
 * Run the full corpus. Returns { map, histogram, redCells, timing }.
 * `onProgress(i, total, relpath)` is called per cell for live feedback.
 */
export function runCorpus(onProgress) {
  const corpus = enumerateRenderCorpus();
  const map = {};
  const histogram = {};
  const redCells = [];
  const t0 = Date.now();
  let i = 0;

  for (const app of corpus) {
    // Always observe the EMPTY cell; a POPULATED cell only if a seed fixture is registered.
    for (const seedLabel of seedLabelsFor(app)) {
      i++;
      if (onProgress) onProgress(i, corpus.length, `${app.relpath}#${seedLabel}`);
      const cell = observeCellSubprocess(app.relpath, seedLabel);
      const key = `${app.relpath}#${seedLabel}`;
      map[key] = {
        tier: app.tier, // S202 filter-refine — flagship/probe/stress/perf/sample (lands on next full regen)
        state: cell.state,
        smells: cell.smells ?? [],
        seeded: cell.seeded ?? seedLabel !== "empty",
      };
      // Keep a trimmed detail for the red cells (the standing-report payload).
      if (!GREEN_STATES.has(cell.state)) {
        map[key].detail = cell.detail ?? {};
        redCells.push({ key, state: cell.state, smells: cell.smells ?? [], detail: cell.detail ?? {} });
      }
      histogram[cell.state] = (histogram[cell.state] ?? 0) + 1;
    }
  }

  return {
    map,
    histogram,
    redCells,
    timing: { totalMs: Date.now() - t0, cells: i, apps: corpus.length },
  };
}

/** Build the on-disk baseline object (map + _meta). */
function buildBaselineObject(run) {
  return {
    _meta: {
      generated: new Date().toISOString(),
      apps: run.timing.apps,
      cells: run.timing.cells,
      histogram: run.histogram,
      note:
        "e2e L1 render known-failure map. Gaps existing is NOT a failure; the " +
        "delta-gate fails only on a green->red regression. NO error-class " +
        "suppression — every state is recorded.",
    },
    cells: run.map,
  };
}

/** Read the on-disk baseline, or null if absent. */
export function readBaseline() {
  if (!existsSync(BASELINE_PATH)) return null;
  return JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
}

/**
 * Compute the green->red delta between an on-disk baseline and a fresh run.
 * A regression = a cell that WAS green (renders-clean/renders-empty) in the
 * baseline and is now red. Returns { regressions: [...], improvements: [...],
 * newCells: [...] }.
 */
export function computeDelta(baseline, run) {
  const regressions = [];
  const improvements = [];
  const newCells = [];
  const baseCells = (baseline && baseline.cells) ? baseline.cells : {};
  for (const [key, cur] of Object.entries(run.map)) {
    const prev = baseCells[key];
    if (!prev) {
      newCells.push({ key, state: cur.state });
      continue;
    }
    const wasGreen = GREEN_STATES.has(prev.state);
    const isGreen = GREEN_STATES.has(cur.state);
    if (wasGreen && !isGreen) {
      regressions.push({ key, was: prev.state, now: cur.state, smells: cur.smells });
    } else if (!wasGreen && isGreen) {
      improvements.push({ key, was: prev.state, now: cur.state });
    }
  }
  // A full run's map keys ARE the live cells, so the orphans fall out of the same data.
  const orphans = findOrphanBaselineCells(baseCells, new Set(Object.keys(run.map)));
  return { regressions, improvements, newCells, orphans };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
if (import.meta.main) {
  const args = new Set(process.argv.slice(2));
  const check = args.has("--check");
  const print = args.has("--print");

  const progress = (i, total, key) => {
    if (i % 25 === 0 || i === total) {
      process.stderr.write(`\r[e2e-render-map] ${i}/${total} ${key.slice(0, 48).padEnd(48)}`);
    }
  };

  process.stderr.write("[e2e-render-map] running corpus (subprocess-isolated)...\n");
  const run = runCorpus(progress);
  process.stderr.write("\n");

  process.stderr.write(
    `[e2e-render-map] ${run.timing.cells} cells across ${run.timing.apps} apps in ` +
      `${(run.timing.totalMs / 1000).toFixed(1)}s\n`,
  );
  process.stderr.write(`[e2e-render-map] histogram: ${JSON.stringify(run.histogram)}\n`);

  if (check) {
    const baseline = readBaseline();
    if (!baseline) {
      process.stderr.write("[e2e-render-map] --check: no baseline on disk; run without --check first.\n");
      process.exit(1);
    }
    const delta = computeDelta(baseline, run);
    process.stderr.write(
      `[e2e-render-map] --check delta: ${delta.regressions.length} regression(s), ` +
        `${delta.improvements.length} improvement(s), ${delta.newCells.length} new cell(s), ` +
        `${delta.orphans.length} orphan baseline cell(s)\n`,
    );
    if (delta.orphans.length > 0) {
      // Reported, never an exit code: an orphan is stale bookkeeping, not a regression.
      process.stderr.write(
        "[e2e-render-map] orphan baseline cells (no live app/seed produces this key; never compared):\n" +
          delta.orphans.map((k) => `  ${k}`).join("\n") + "\n",
      );
    }
    if (delta.improvements.length > 0) {
      process.stderr.write(
        "[e2e-render-map] improvements (update the baseline DOWN in the same landing):\n" +
          delta.improvements.map((d) => `  ${d.key}: ${d.was} -> ${d.now}`).join("\n") + "\n",
      );
    }
    if (delta.regressions.length > 0) {
      process.stderr.write(
        "[e2e-render-map] REGRESSIONS (green->red — a closed cell re-opened):\n" +
          delta.regressions.map((d) => `  ${d.key}: ${d.was} -> ${d.now} ${JSON.stringify(d.smells)}`).join("\n") + "\n",
      );
      process.exit(1);
    }
    process.exit(0);
  }

  // Default: write the baseline.
  const obj = buildBaselineObject(run);
  writeFileSync(BASELINE_PATH, JSON.stringify(obj, null, 2) + "\n");
  process.stderr.write(`[e2e-render-map] wrote ${BASELINE_PATH}\n`);

  if (print) {
    process.stdout.write(`\nKNOWN-FAILURE MAP — histogram:\n${JSON.stringify(run.histogram, null, 2)}\n`);
    process.stdout.write(`\nRED cells (${run.redCells.length}):\n`);
    for (const r of run.redCells) {
      process.stdout.write(`  ${r.key} [${r.state}] ${JSON.stringify(r.smells)} ${JSON.stringify(r.detail).slice(0, 140)}\n`);
    }
  }
}
