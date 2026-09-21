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
 * ⛑ S427 — UPDATE: ci.yml's blocking `gate` job (and the advisory `windows` job) now run
 * `bun test compiler/tests/e2e-render-map/`. What that makes BLOCKING is this tier's
 * ASSERTIONS — every `expect` in this file and in detector-validation.test.js. It does NOT
 * make the fast-slice green->red delta below blocking (that test stays WARN-only by design),
 * and `generate-baseline.js --check` is still run by no job or hook. The S419 paragraph
 * above stays as the record of what was true until S427.
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
import { ALL_BASELINE_STATES, GREEN_STATES } from "./render-detectors.js";
import {
  observeCellSubprocess,
  seedLabelsFor,
  liveCellKeys,
  findOrphanBaselineCells,
} from "./generate-baseline.js";
import {
  compileApp,
  observeApp,
  parseChunkCellScopes,
  resolveMultiFileCompileInputs,
  TMP_PREFIX,
} from "./render-harness.js";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { tmpdir } from "node:os";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BASELINE_PATH = join(__dirname, "e2e-render-map-baseline.json");

// ⛑ S426 — GREEN_STATES IS IMPORTED (see the import block above), not re-declared. The
// literal Set that used to sit here was the third hand-kept copy of the same list
// (`generate-baseline.js:53` held the second), and S426 added an enforcement that has to
// agree with it: `runDetectors` refuses to return ANY green state while a seed-bridge
// failure is on the record. Three copies of the definition of "green" is three chances for
// that enforcement to be silently narrower than this gate. The reasons `needs-server` is in
// it and `renders-empty-with-data` is not now live with the definition, in
// `render-detectors.js`.

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

  // ⛑ S420 — A POPULATED SEED MUST BE OBSERVABLE, NOT MERELY BOOKKEPT
  // (g-e2e-render-map-populated-seed-is-inert-so-d6-has-no-live-subject).
  //
  // Every check above this one asserts BOOKKEEPING: that a seed key exists, that both cells
  // are recorded, that the two sides name the same apps. All four passed while the seed was
  // completely INERT — the harness wrote the BARE `_scrml_reactive_set("contacts", …)` while
  // the app reads `_scrml_cs_key("contacts")` = `01hrlbd8$contacts`, so nothing subscribed,
  // no effect fired, and every `#populated` cell was byte-identical to its unseeded twin
  // (same state, same smells, same detail). D6 (S-EMPTY-WITH-DATA) exists to catch the board
  // class in exactly that cell and had never once had a live subject on the corpus.
  //
  // ⚑ A READ-BACK PROVES NOTHING, SO THIS TEST NEVER ASSERTS ONE. `_scrml_state` is a plain
  // `{}` and the accessors are a bare property write/read (runtime-template.js:548/819/853),
  // so EVERY invented key reads back — including the un-namespaced key of the original bug,
  // and including a key for a cell the app does not have. The load-bearing signals are
  // therefore (a) did the bridge RESOLVE the name to a real cell of a real chunk, and (b) did
  // the render MOVE. `observable` is exactly their conjunction.
  //
  // The expectation is a per-app TABLE, not a floor, so it reds in BOTH directions: a live
  // seed going inert (the regression this closes) and an inert seed coming alive (which means
  // a fixture was fixed and the note below is stale). The `wrote:false` rows are NOT the
  // harness bug — they are separate SEED-FIXTURE bugs, named here so they cannot hide behind
  // a green cell. Do not "fix" any of them by relaxing this table.
  const SEED_OBSERVABILITY = {
    "examples/03-contact-book.scrml": {
      reason: "written",
      domChanged: true,
      note: "seed resolves to the real cell <contacts>; the Tier-1 <each> renders both rows",
    },
    "examples/06-kanban-board.scrml": {
      reason: "derived-cell",
      domChanged: false,
      note:
        "FIXTURE BUG: the seed names `todo`, which the emit declares via " +
        "`_scrml_cs_derived_declare(\"todo\", () => …cards.filter(…))`. A derived cell is read " +
        "through `_scrml_derived_fns`, never out of `_scrml_state`, so the write would be " +
        "discarded — and would leave junk in a slot the runtime itself never writes, on a " +
        "path that still fires `_scrml_propagate_dirty`. The bridge refuses it. Seeding the " +
        "SOURCE cell `cards` is what would drive this app.",
    },
    "examples/16-remote-data.scrml": {
      reason: "no-such-cell",
      domChanged: false,
      note:
        "FIXTURE BUG: THIS APP HAS NO `contacts` CELL. It declares exactly one cell, " +
        "`<phase>: ContactsPhase = .Idle`; the list is `<each in=rows>` where `rows` is the " +
        "MATCH BINDING of `@phase = .Loaded(rows)`, not a cell. The old bridge wrote " +
        "`<token>$contacts` and it 'read back' — because a plain-object store reads back " +
        "anything — which is how this was previously mis-reported as a live seed. There is " +
        "no plain cell-set that drives this app: `.Loaded(rows)` is a PAYLOAD VARIANT, so " +
        "even seeding `phase` needs a constructed variant, not a value.",
    },
    "examples/25-triage-board.scrml": {
      reason: "written",
      domChanged: true,
      note:
        "seed resolves to the real cell <tasks> and the DOM moves — but it SHRINKS, because " +
        "the seed's `column` values are lowercase ('todo'/'doing') while the app filters " +
        "against `const columns = [\"Inbox\", \"Doing\", \"Done\"]`, so all three columns " +
        "render empty. That is seed-fixtures.js's own SEED-SHAPE INVARIANT being violated by " +
        "the fixture, not a codegen bug.",
    },
  };

  test("a populated seed resolves to a real cell of the app and is observable in the DOM", async () => {
    const seeded = SLICE.filter((app) => seedFor(app.relpath));
    // Non-vacuity: an empty list would make every assertion below trivially true.
    expect(seeded.length).toBeGreaterThan(0);

    GlobalRegistrator.register();
    const actual = {};
    try {
      for (const app of seeded) {
        const cell = observeApp(app, seedFor(app.relpath), "populated");
        const rep = cell.detail && cell.detail.seed;
        expect({ app: app.relpath, hasSeedReport: Boolean(rep) }).toEqual({
          app: app.relpath,
          hasSeedReport: true,
        });
        // Every fixture in this map is single-cell; a multi-cell fixture would need this
        // flattening revisited rather than silently reporting only its first write.
        expect({ app: app.relpath, writeCount: rep.writes.length }).toEqual({
          app: app.relpath,
          writeCount: Object.keys(seedFor(app.relpath)).length,
        });
        const w = rep.writes[0];
        actual[app.relpath] = {
          // The bridge found this app's chunk scope at all. Breaking the prologue parse
          // makes this 0 (and, for a bundle that does define `_scrml_cs_*`, throws).
          foundChunkScope: rep.chunks > 0,
          // How the seed name resolved against the chunk's REAL accessor call sites.
          reason: w.reason,
          // A write that happened went through the chunk-namespaced key, not the bare name.
          namespaced: w.namespaced,
          wrote: w.wrote,
          // ... and the render actually moved. THIS is the bit the old harness could not buy.
          domChanged: rep.domChanged,
          observable: rep.observable,
          seedErrors: rep.errors,
        };
      }
    } finally {
      await GlobalRegistrator.unregister();
    }

    const expected = {};
    for (const app of seeded) {
      const row = SEED_OBSERVABILITY[app.relpath];
      // A newly-registered seed with no row here is a FAILURE, not a skip — that is how an
      // unobserved seed shipped in the first place.
      expect({ app: app.relpath, hasObservabilityRow: Boolean(row) }).toEqual({
        app: app.relpath,
        hasObservabilityRow: true,
      });
      const wrote = row.reason === "written";
      expected[app.relpath] = {
        foundChunkScope: true,
        reason: row.reason,
        // Only a write that happened can be namespaced; a refused one reports false.
        namespaced: wrote,
        wrote,
        domChanged: row.domChanged,
        // `observable` is the conjunction the harness computes independently — pinning it
        // next to BOTH of its own inputs catches the predicate itself drifting.
        observable: wrote && row.domChanged,
        seedErrors: [],
      };
    }
    expect(actual).toEqual(expected);

    // Hard non-vacuity on the whole point: at LEAST one corpus seed must actually be live.
    // Before the S420 bridge fix this count was 0 of 4 — this line alone reds on the bug.
    const liveCount = Object.values(actual).filter((r) => r.observable).length;
    expect(liveCount).toBeGreaterThan(0);
  }, 60000);

  // ⛑ S420 — NOTHING PER-RUN MAY REACH `detail`, BECAUSE `detail` IS COMMITTED.
  // `generate-baseline.js` runCorpus persists `detail` for every cell that is NOT green
  // (`map[key].detail = cell.detail ?? {}`) and then writeFileSync's the whole object to the
  // tracked baseline JSON. The chunk token is derived from the compile's staging path — a
  // fresh `mkdtemp` dir — so it differs on every run and every machine. An earlier revision
  // of the seed report carried `namespaces: ["00tyi1b4$"]` and `writes[].key`, which would
  // have put a per-run random value into a committed artifact the moment a seeded cell went
  // red — and reddening a seeded cell is D6's entire purpose. The report is booleans, names
  // and reason codes only; this pins that it stays that way.
  test("the seed report carries nothing per-run, so a RED seeded cell cannot churn the baseline", async () => {
    const app = SLICE.find((a) => seedFor(a.relpath) && a.relpath.includes("03-contact-book"));
    expect(Boolean(app)).toBe(true);

    GlobalRegistrator.register();
    let a;
    let b;
    let tokens;
    try {
      // THE PREMISE OF THIS TEST, ASSERTED RATHER THAN ASSUMED. Everything below rests on
      // "two runs of the same app mint different chunk tokens" — if the token were stable,
      // the equality would hold for a report that leaked it and prove nothing. Read the token
      // from the one artifact that legitimately still carries it: the
      // `// --- chunk cell scope (<token>) ---` header of the emitted client body. Each
      // compileApp stages into its own fresh `mkdtemp` dir, exactly as the observeApp calls
      // below do, so this measures the same mechanism that produces their reports.
      tokens = [0, 1].map(() => {
        const art = compileApp(app);
        try {
          return parseChunkCellScopes(art.clientJs).map((s) => s.token);
        } finally {
          rmSync(art.tmpDir, { recursive: true, force: true });
        }
      });

      // Two independent observations of the SAME app: separate compiles, separate staging dirs.
      a = observeApp(app, seedFor(app.relpath), "populated");
      b = observeApp(app, seedFor(app.relpath), "populated");
    } finally {
      await GlobalRegistrator.unregister();
    }

    // Each compile produced exactly one chunk scope, and the two tokens really DO differ.
    expect(tokens.map((t) => t.length)).toEqual([1, 1]);
    expect(tokens[0][0]).not.toEqual(tokens[1][0]);

    // ... so THIS equality is a real property of the report, not an accident of a stable token.
    // Serialized exactly as generate-baseline.js would persist it for a red cell.
    expect(JSON.stringify(a.detail.seed)).toEqual(JSON.stringify(b.detail.seed));

    // And the stronger guarantee the equality is a consequence of: no namespace token may
    // appear in the report at all. This is the assertion mutation D reds.
    const tokensIn = (v) => {
      const seen = new Set();
      const re = /[0-9a-z]{6,}\$/g;
      let m;
      while ((m = re.exec(JSON.stringify(v))) !== null) seen.add(m[0]);
      return [...seen];
    };
    expect(tokensIn(a.detail.seed)).toEqual([]);
  }, 60000);


  // ⛑ S419 residuals — ORPHAN BASELINE CELLS ARE NAMED
  // (g-e2e-render-map-baseline-keys-have-drifted-and-orphan-cells-are-never-flagged).
  // Every other check here walks LIVE cells into the baseline, so a baseline cell no live app
  // produces (a renamed/removed app, or a multi-file app whose entry key changed) is never
  // compared and never reported. WARN-only, per this file's corpus-state convention: an orphan
  // is stale bookkeeping that a baseline regeneration clears, not a render regression. The
  // detection itself is asserted hard on an injected orphan, so the warning cannot go silent.
  test("baseline cells that match no live app/seed are named (WARN-only)", () => {
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
    const live = liveCellKeys();
    // Non-vacuity: an empty live set would make EVERY baseline cell an "orphan" and still
    // print; a live set disjoint from the baseline would mean the keying itself broke.
    expect(live.size).toBeGreaterThan(0);
    expect([...live].some((k) => k in baseline.cells)).toBe(true);

    // The check can SEE an orphan: inject one into a copy of the baseline cells.
    const injectedKey = "examples/__no-such-app__.scrml#empty";
    const copy = { ...baseline.cells, [injectedKey]: { state: "renders-clean", smells: [] } };
    expect(findOrphanBaselineCells(copy, live)).toContain(injectedKey);
    // ... and does not call a live cell an orphan.
    const aLiveKey = [...live].find((k) => k in baseline.cells);
    expect(findOrphanBaselineCells(copy, live)).not.toContain(aLiveKey);

    const orphans = findOrphanBaselineCells(baseline.cells, live);
    if (orphans.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `[e2e-render-map] ORPHAN baseline cells (${orphans.length}) — no live app/seed produces ` +
          `these keys, so they are never compared; regenerate the baseline to clear them:\n` +
          orphans.join("\n"),
      );
    }
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

  // ⛑ S419 residuals — the staging root was `resolve("/tmp", …)`, i.e. `C:\tmp\…` on Windows.
  test("compileApp stages under the OS temp dir, not a hard-coded /tmp", () => {
    expect(TMP_PREFIX.startsWith(join(tmpdir(), "scrml-e2e-render-map-"))).toBe(true);
    const app = {
      relpath: "compiler/tests/e2e-render-map/fixtures/d3-object-in-dom.scrml",
      path: resolve(__dirname, "fixtures", "d3-object-in-dom.scrml"),
      kind: "single",
    };
    const out = compileApp(app);
    try {
      expect(relative(tmpdir(), out.tmpDir).startsWith("scrml-e2e-render-map-")).toBe(true);
    } finally {
      rmSync(out.tmpDir, { recursive: true, force: true });
    }
  });

  // ⛑ S419 residuals — observeApp removes its staging dir on success AND when the mount or
  // detectors throw (before, only the early returns cleaned up; a throw leaked the dir).
  const fixtureRow = () => ({
    relpath: "compiler/tests/e2e-render-map/fixtures/d3-object-in-dom.scrml",
    path: resolve(__dirname, "fixtures", "d3-object-in-dom.scrml"),
    kind: "single",
  });
  test("observeApp removes its staging dir after a successful observation", async () => {
    let seen = null;
    GlobalRegistrator.register();
    try {
      const cell = observeApp(fixtureRow(), null, "empty", { onTmpDir: (d) => { seen = d; } });
      expect(cell.state).toBe("smell-detected-wrong"); // it really mounted (the D3 fixture)
    } finally {
      await GlobalRegistrator.unregister();
    }
    expect(typeof seen).toBe("string");
    expect(existsSync(seen)).toBe(false);
  });
  test("observeApp removes its staging dir when the mount throws", () => {
    // Inject a throw that escapes mountAndObserve: its `finally` reads
    // `window.removeEventListener`, outside the try that records mount errors.
    const had = Object.prototype.hasOwnProperty.call(globalThis, "window");
    const prev = globalThis.window;
    globalThis.window = {
      get removeEventListener() { throw new Error("injected mount-teardown throw"); },
    };
    let seen = null;
    let thrown = null;
    try {
      observeApp(fixtureRow(), null, "empty", { onTmpDir: (d) => { seen = d; } });
    } catch (e) {
      thrown = e;
    } finally {
      if (had) globalThis.window = prev;
      else delete globalThis.window;
    }
    expect(String(thrown && thrown.message)).toContain("injected mount-teardown throw");
    expect(typeof seen).toBe("string");
    expect(thrown.harnessTmpDir).toBe(seen);
    expect(existsSync(seen)).toBe(false);
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
// (write or `--check`), not this suite. This suite runs in CI since S427, but THIS test only
// warns; `generate-baseline.js` runs in no job or hook (see header).
// =============================================================================
describe("e2e-render-map — delta-gate (examples+benchmarks slice, NON-gating)", () => {
  test("no green->red regression in the examples+benchmarks slice (WARN-only)", () => {
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
    const baseCells = baseline.cells ?? {};
    const regressions = [];
    const improvements = [];
    const newCells = [];

    for (const app of SLICE) {
      for (const seedLabel of seedLabelsFor(app)) {
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
          `\n(NON-gating: this delta check only warns — the tier runs in CI (S427) but this test ` +
          `does not fail on a delta, and no job runs \`generate-baseline.js --check\` — a ` +
          `regression here blocks nothing until someone acts on it.)`,
      );
    }

    // NON-GATING: the map is the deliverable; the delta is reported, not enforced
    // here. The suite asserts only that the comparison ran over the slice.
    expect(SLICE.length).toBeGreaterThan(0);
  }, 180000);
});
