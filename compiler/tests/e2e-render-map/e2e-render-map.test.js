/**
 * e2e-render-map.test.js — the L1 e2e render known-failure-MAP delta-gate.
 *
 * Per the DD §thin-build step 4 + §"Gate mechanics", cloned from the within-node
 * allowlist pattern (compiler/tests/parser-conformance-within-node.test.js):
 *   - the on-disk baseline (e2e-render-map-baseline.json) is the ALLOWLIST — it
 *     records each (app, seed) cell's CURRENT state and is allowed to contain any
 *     number of fails-compile / throws / smell / timeout cells. Gaps existing is
 *     NOT a failure.
 *   - the delta-gate fails ONLY on a green->red regression (a cell that was
 *     renders-clean/renders-empty and is now red). "Don't fail because gaps
 *     exist; fail when a closed cell re-opens." An IMPROVEMENT (red->green) means
 *     update the baseline DOWN in the same landing (the allowlist-shrink rule).
 *
 * SHIPPED NON-GATING FIRST (brief step 4): the map is the deliverable; this
 * suite WARNS on a delta but does not hard-fail the build yet. The hard gate is
 * `bun generate-baseline.js --check` on CI/pre-push (NOT pre-commit — the full
 * subprocess-isolated corpus run is minutes, same exclusion as within-node).
 *
 * To keep this suite test-time-cheap (the full corpus is subprocess-isolated and
 * minutes long — some meta-heavy apps hang at mount), it re-observes only the
 * FAST representative slice (examples + benchmarks, in-process, ~3s) and reports
 * the green->red delta against the baseline for that slice. The samples tier
 * (400 apps incl. the hangers) is covered by the standing `generate-baseline.js`
 * run + its `--check` mode, not by this in-process suite.
 *
 * NO error-class suppression — the slice records every state (DD §"DO NOT
 * SUPPRESS ANY ERROR CLASS").
 */

import { describe, test, expect } from "bun:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { enumerateRenderCorpus } from "./render-corpus-enumerator.js";
import { seedFor } from "./seed-fixtures.js";
import { ALL_BASELINE_STATES } from "./render-detectors.js";
import { observeCellSubprocess } from "./generate-baseline.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BASELINE_PATH = join(__dirname, "e2e-render-map-baseline.json");

// `needs-server` is non-gap (server-dependent app, no server at mount — S203 b+c).
//
// ⛑ S416 — `renders-empty-with-data` IS DELIBERATELY ABSENT. An empty render with
// NO seed is a valid `<empty>` fallback and stays green; an empty render WITH data
// seeded is the board-bug class D6 exists to catch, and it used to land in
// `renders-empty` and be scored green. Keep these two apart.
const GREEN_STATES = new Set(["renders-clean", "renders-empty", "needs-server"]);

// The fast in-process slice: examples + benchmarks (no samples — samples incl.
// the meta-heavy hangers belong to the subprocess-isolated standing run).
const SLICE = enumerateRenderCorpus().filter(
  (a) => a.source === "examples" || a.source === "benchmarks",
);

// =============================================================================
// §1 — baseline well-formedness (the standing map exists + is schema-valid).
// =============================================================================
describe("e2e-render-map — baseline well-formedness", () => {
  test("baseline JSON exists on disk (the standing known-failure map)", () => {
    expect(existsSync(BASELINE_PATH)).toBe(true);
  });

  test("baseline has _meta + cells; every cell has a state + smells[]", () => {
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
    expect(baseline._meta).toBeDefined();
    expect(baseline._meta.histogram).toBeDefined();
    expect(baseline.cells).toBeDefined();
    const keys = Object.keys(baseline.cells);
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) {
      const cell = baseline.cells[k];
      expect(typeof cell.state).toBe("string");
      expect(Array.isArray(cell.smells)).toBe(true);
    }
  });

  // ⛑ S416 — the vocabulary check the dead `RENDER_STATES` export was written for.
  // Without it the assertion above (`typeof state === "string"`) accepted ANY string,
  // and the baseline carried a `HARNESS-TIMEOUT` cell against no vocabulary at all.
  test("every baseline cell state is in the declared vocabulary (RENDER_STATES + HARNESS_STATES)", () => {
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
    const legal = new Set(ALL_BASELINE_STATES);
    const offenders = Object.entries(baseline.cells)
      .filter(([, c]) => !legal.has(c.state))
      .map(([k, c]) => `${k} -> ${c.state}`);
    expect(offenders).toEqual([]);
  });

  // ⛑ S416 — A COVERAGE RATCHET, BECAUSE THE WITH-DATA HALF OF THIS GATE IS TINY.
  // `seed-fixtures.js` states the point plainly: "the board bug class lives ONLY in
  // the POPULATED render". Seeding is a hand-maintained map, and it had FOUR entries
  // against 438 baseline cells — so D6, the detector for that class, could only ever
  // run on ~0.9% of the corpus, and the other 434 cells were observed ONLY in the
  // seed-empty state the DD itself calls "a VALID partial render (looks green)".
  // That is not a defect in any one cell; it is the gate's REACH, and reach that
  // nothing asserts is reach that silently rots. This pins the floor so adding an
  // app cannot quietly drop coverage, and so the ratio stays visible in the suite.
  test("populated (with-data) cell coverage does not regress below its recorded floor", () => {
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
    const cells = Object.entries(baseline.cells);
    const populated = cells.filter(([k]) => k.endsWith("#populated"));
    // eslint-disable-next-line no-console
    console.log(
      `      with-data coverage: ${populated.length} populated of ${cells.length} cells ` +
      `(${((populated.length / cells.length) * 100).toFixed(1)}%)`,
    );
    expect(populated.length).toBeGreaterThanOrEqual(4);
  });

  test("baseline records empty AND populated cells for seeded apps (board class)", () => {
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
    // Every app with a registered populated seed must have BOTH cells recorded
    // (the empty-vs-populated distinction is load-bearing — the board bug lives
    // only in populated; an empty-db board renders <empty> clean + looks green).
    //
    // ⛑ S417 — NON-VACUITY GUARD, and it is the point of this edit.
    // This loop is `if (!seedFor(...)) continue`, so when `seedFor` matches NOTHING it executes
    // ZERO expect() calls and passes by asserting nothing. That is exactly what it did on every
    // Windows clone until the mint-site separator fix in `render-corpus-enumerator.js`: 0 of 449
    // apps matched, this test made 0 assertions, and it was green. A test whose subject population
    // can silently empty needs to assert the population is non-empty FIRST — otherwise the only
    // signal that it stopped testing anything is that it kept passing.
    const seeded = SLICE.filter((app) => seedFor(app.relpath));
    expect(seeded.length).toBeGreaterThan(0);

    for (const app of seeded) {
      expect(baseline.cells[`${app.relpath}#empty`]).toBeDefined();
      expect(baseline.cells[`${app.relpath}#populated`]).toBeDefined();
    }
  });
});

// =============================================================================
// §2 — delta-gate over the fast slice (NON-gating: WARN on green->red).
//
// The slice is observed via the SAME subprocess-isolated path the standing
// generator uses (observeCellSubprocess), NOT in-process. Subprocess isolation
// is load-bearing here: several corpus apps leave dangling async work after
// mount (server-fetch promises against `/_scrml/...` routes that happy-dom
// rejects on `about:blank`; late reactive effects). In-process, those
// post-return rejections attach to THIS test and fail it spuriously; in a
// throwaway subprocess they die with the process. examples+benchmarks is ~34
// apps × ~0.3s ≈ low-tens-of-seconds — test-time viable. The samples tier (incl.
// the meta-heavy hangers) is covered by the standing `generate-baseline.js`
// run + `--check`, not this in-process suite.
// =============================================================================
describe("e2e-render-map — delta-gate (examples+benchmarks slice, NON-gating)", () => {
  test("no green->red regression in the examples+benchmarks slice (WARN-only)", () => {
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
    const baseCells = baseline.cells ?? {};
    const regressions = [];
    const improvements = [];
    const newCells = [];

    for (const app of SLICE) {
      const seedLabels = ["empty"];
      if (seedFor(app.relpath)) seedLabels.push("populated");
      for (const seedLabel of seedLabels) {
        const cell = observeCellSubprocess(app.relpath, seedLabel);
        const key = `${app.relpath}#${seedLabel}`;
        const prev = baseCells[key];
        if (!prev) {
          newCells.push(`${key} [${cell.state}]`);
          continue;
        }
        const wasGreen = GREEN_STATES.has(prev.state);
        const isGreen = GREEN_STATES.has(cell.state);
        if (wasGreen && !isGreen) {
          regressions.push(`${key}: ${prev.state} -> ${cell.state} ${JSON.stringify(cell.smells)}`);
        } else if (!wasGreen && isGreen) {
          improvements.push(`${key}: ${prev.state} -> ${cell.state}`);
        }
      }
    }

    if (improvements.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `[e2e-render-map] IMPROVEMENTS (${improvements.length}) — update the baseline DOWN ` +
          `via \`bun compiler/tests/e2e-render-map/generate-baseline.js\`:\n` +
          improvements.join("\n"),
      );
    }
    if (newCells.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(`[e2e-render-map] NEW cells not in baseline (${newCells.length}):\n` + newCells.join("\n"));
    }
    if (regressions.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `[e2e-render-map] *** GREEN->RED REGRESSIONS (${regressions.length}) *** a closed cell re-opened:\n` +
          regressions.join("\n") +
          `\n(NON-gating in the MVP — the hard gate is \`generate-baseline.js --check\` on CI/pre-push.)`,
      );
    }

    // NON-GATING: the map is the deliverable; the delta is reported, not enforced
    // here. The suite asserts only that the comparison ran over the slice.
    expect(SLICE.length).toBeGreaterThan(0);
  }, 180000);
});
