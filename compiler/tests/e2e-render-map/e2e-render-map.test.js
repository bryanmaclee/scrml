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
 * suite WARNS on a delta but does not hard-fail the build.
 *
 * ⛑ S419 — WHAT ACTUALLY RUNS THIS TIER (g-e2e-render-map-tier-runs-in-no-ci-job-at-all).
 * This header used to say "the hard gate is `bun generate-baseline.js --check` on
 * CI/pre-push". Nothing invokes `--check`: no job in `.github/workflows/`, no
 * `package.json` script, no hook in `scripts/git-hooks/`. The truth, as of S419:
 *   - NO CI job runs this directory (ci.yml's gate runs `compiler/tests/unit`,
 *     `compiler/tests/conformance` and the top-level `compiler/tests/*.test.js`;
 *     tracking/windows/within-node name other paths).
 *   - NO git hook runs it (pre-commit and pre-push name unit/integration/conformance).
 *   - It runs only when a human runs it: `bun test compiler/tests/e2e-render-map/`,
 *     or the whole-tree `bun run test` (`bun test compiler/tests/`, which sweeps
 *     this directory in), or `bun compiler/tests/e2e-render-map/generate-baseline.js
 *     [--check]` by hand.
 * So a green->red delta here is a WARNING that nobody is required to read, and
 * `--check` is a tool, not a gate. Do not describe either as gating until a job
 * actually invokes it.
 *
 * To keep this suite test-time-cheap (the full corpus is subprocess-isolated and
 * minutes long — some meta-heavy apps hang at mount), it re-observes only the
 * FAST representative slice (examples + benchmarks, in-process, ~3s) and reports
 * the green->red delta against the baseline for that slice. The samples tier
 * (400 apps incl. the hangers) is observed only by a hand-run of
 * `generate-baseline.js` (write or `--check`), not by this suite — and, per the
 * note above, nothing schedules that run.
 *
 * NO error-class suppression — the slice records every state (DD §"DO NOT
 * SUPPRESS ANY ERROR CLASS").
 */

import { describe, test, expect } from "bun:test";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { enumerateRenderCorpus, REPO_ROOT } from "./render-corpus-enumerator.js";
import { seedFor, POPULATED_SEEDS } from "./seed-fixtures.js";
import { ALL_BASELINE_STATES } from "./render-detectors.js";
import { observeCellSubprocess } from "./generate-baseline.js";
import { compileApp, resolveMultiFileCompileInputs } from "./render-harness.js";

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

  // ⛑ S419 — PARTIAL SEED LOSS IS NOT SILENT (g-e2e-render-map-partial-seed-loss-is-silent).
  // The guard above only fires when the seeded population is TOTALLY empty. Renaming 3 of the 4
  // POPULATED_SEEDS keys left it green: the coverage floor counts `#populated` keys in the
  // BASELINE, while the delta loop walks LIVE seeds, so a baseline populated cell that lost its
  // seed silently stopped being compared. This pins the two sides to each other in both
  // directions, and names every seed key that matches no corpus app (the rename itself).
  test("every baseline #populated cell has a live seed, and every seed a corpus app + baseline cell", () => {
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
    const corpusRelpaths = new Set(enumerateRenderCorpus().map((a) => a.relpath));
    const liveSeeded = new Set(
      [...corpusRelpaths].filter((r) => seedFor(r)).map((r) => `${r}#populated`),
    );
    const baselinePopulated = Object.keys(baseline.cells).filter((k) => k.endsWith("#populated"));
    expect({
      baselinePopulatedWithNoLiveSeed: baselinePopulated.filter((k) => !liveSeeded.has(k)),
      liveSeedWithNoBaselineCell: [...liveSeeded].filter((k) => !(k in baseline.cells)),
      seedKeysMatchingNoCorpusApp: Object.keys(POPULATED_SEEDS).filter((k) => !corpusRelpaths.has(k)),
    }).toEqual({
      baselinePopulatedWithNoLiveSeed: [],
      liveSeedWithNoBaselineCell: [],
      seedKeysMatchingNoCorpusApp: [],
    });
  });
});

// =============================================================================
// §1b — multi-file apps compile THEIR OWN tree. ADDED S419.
//
// ⛑ Closes g-e2e-render-map-multi-file-apps-compile-an-empty-root-on-windows and
// g-e2e-render-map-single-input-multi-app-mirrors-nothing. Both bugs made a
// multi-file app compile the WRONG tree (the process cwd on Windows; nothing at all
// for a one-file app on every OS) and still score green, so no state assertion
// could see them. This asserts the property directly, harness-independently: every
// one of the app's inputs is present in the mirrored compile tree at its path
// relative to the DECLARED app dir, the compile emits an entry html, and no two
// multi-file apps produce identical output (identical output is what "every app
// compiled the same wrong tree" looked like).
//
// DELIBERATELY HARD-FAILING (S419 review L2), unlike §2. "Warn-only" in this file's
// header is about CORPUS STATE: gaps existing, or a cell regressing, is reported not
// enforced. This is not a corpus-state assertion; it checks that the HARNESS observed
// the program it claims to have observed. If it fails, every multi-file cell the §2
// delta prints is about the wrong input, so warning would just print confident
// nonsense. Same category as the §1 well-formedness tests, which also hard-fail.
// =============================================================================
describe("e2e-render-map — multi-file apps compile their own tree", () => {
  test("each multi-file app mirrors its own inputs, emits html, and output is distinct per app", () => {
    const multi = SLICE.filter((a) => a.kind === "multi");
    expect(multi.length).toBeGreaterThan(0);
    const problems = [];
    const byDigest = new Map();
    for (const app of multi) {
      const root = resolve(REPO_ROOT, app.appDir);
      let out = null;
      try {
        out = compileApp(app);
      } catch (e) {
        problems.push(`${app.relpath}: compileApp threw ${String(e && e.message ? e.message : e)}`);
        continue;
      }
      try {
        const notMirrored = app.inputFiles
          .map((f) => relative(root, f))
          .filter((rel) => !existsSync(resolve(out.tmpDir, rel)));
        if (notMirrored.length > 0) {
          problems.push(`${app.relpath}: ${notMirrored.length}/${app.inputFiles.length} inputs not in the compile tree (e.g. ${notMirrored[0]})`);
        }
        if (!out.html) {
          // Already a problem; an "identical" line between two EMPTY outputs adds nothing.
          problems.push(`${app.relpath}: no entry html emitted`);
        } else {
          const digest = createHash("sha256").update(out.html).update("\0").update(out.clientJs).digest("hex");
          if (byDigest.has(digest)) {
            problems.push(`${app.relpath}: output identical to ${byDigest.get(digest)}`);
          } else {
            byDigest.set(digest, app.relpath);
          }
        }
      } finally {
        if (out && out.tmpDir) {
          try { rmSync(out.tmpDir, { recursive: true, force: true }); } catch (_) { /* noop */ }
        }
      }
    }
    expect(problems).toEqual([]);
  }, 180000);

  // S419 review L4 — `..` is rejected only as a whole path segment.
  test("resolveMultiFileCompileInputs: an in-root `..draft.scrml` is accepted; a real parent escape is rejected", () => {
    const appDir = "compiler/tests/e2e-render-map/fixtures";
    const root = resolve(REPO_ROOT, appDir);
    const row = (inputFiles) => ({ relpath: `${appDir}/x.scrml`, appDir, inputFiles });
    expect(resolveMultiFileCompileInputs(row([resolve(root, "..draft.scrml")])).relInputs).toEqual(["..draft.scrml"]);
    expect(() => resolveMultiFileCompileInputs(row([resolve(root, "..", "escape.scrml")]))).toThrow(/not under its root/);
    expect(() => resolveMultiFileCompileInputs(row([root]))).toThrow(/not under its root/);
    if (process.platform === "win32") {
      // Cross-drive: path.relative returns the absolute target.
      const otherDrive = /^[cC]:/.test(root) ? "D:\\elsewhere\\x.scrml" : "C:\\elsewhere\\x.scrml";
      expect(() => resolveMultiFileCompileInputs(row([otherDrive]))).toThrow(/not under its root/);
    }
  });

  // S419 review L3 — a throw after the staging dir exists must not leak it.
  test("compileApp removes its staging dir when it throws after mirroring", () => {
    const appDir = "compiler/tests/e2e-render-map/fixtures";
    const root = resolve(REPO_ROOT, appDir);
    const app = {
      relpath: `${appDir}/d3-object-in-dom.scrml`,
      path: resolve(root, "d3-object-in-dom.scrml"),
      kind: "multi",
      appDir,
      // The second input is under the root but in a hidden dir mirrorTree skips (and
      // does not exist), so compileApp throws AFTER mkdir + mirror.
      inputFiles: [resolve(root, "d3-object-in-dom.scrml"), resolve(root, ".not-mirrored", "x.scrml")],
    };
    let thrown = null;
    try {
      compileApp(app);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).not.toBeNull();
    expect(String(thrown.message)).toContain("not mirrored");
    expect(typeof thrown.harnessTmpDir).toBe("string");
    expect(existsSync(thrown.harnessTmpDir)).toBe(false);
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
// the meta-heavy hangers) is observed only by a hand-run of `generate-baseline.js`
// (write or `--check`), not this suite; no CI job or hook runs either (see header).
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
          `\n(NON-gating: this suite only warns, and no CI job or git hook runs this tier or ` +
          `\`generate-baseline.js --check\` — a regression here blocks nothing until someone acts on it.)`,
      );
    }

    // NON-GATING: the map is the deliverable; the delta is reported, not enforced
    // here. The suite asserts only that the comparison ran over the slice.
    expect(SLICE.length).toBeGreaterThan(0);
  }, 180000);
});
