// scripts/tier-baseline.ts — Q6 of the S310 queue. change-id: browser-failure-name-set-baseline
//
// ⛑ RENAMED S409 from `scripts/browser-baseline.ts`. The mechanism was never browser-specific; only
// its three constants were. It is now parameterised by `--tier=<name>` over a registry (see TIERS
// below) and defaults to `browser`, so every pre-S409 invocation shape still resolves. The rename is
// the point: a file called `browser-baseline.ts` is one nobody thinks to point at a second tier, and
// a second tier went ungated for a year while this file sat next to it. Everything below this banner
// is the original S313 rationale, preserved verbatim — it is the recorded reasoning for the whole
// name-set approach, including its author's honest account of getting the first baseline wrong.
//
// THREE MODES (mirrors scripts/state.ts + scripts/facts.ts exactly — same flags, same exit semantics):
//   `bun scripts/tier-baseline.ts`         PRINT  — run the tier, report the current failure set.
//   `bun scripts/tier-baseline.ts --write` WRITE  — record the current failure NAME SET as the
//                                                      baseline. Idempotent.
// ⛑ S409 precision on "Idempotent": the asserted content — `failures`, and therefore `count` — is.
// `recordedAt` is NOT: it defaults to today (see main()), so re-running `--write` on an unchanged
// tier rewrites that one metadata line. That is the intended meaning of the field, and it is never
// read by `--check`. Said plainly here because "Idempotent" unqualified is the kind of claim a later
// reader checks by `git diff` and concludes the script is broken.
//   `bun scripts/tier-baseline.ts --check` CHECK  — run the tier, diff the name set against the
//                                                      baseline; exit 1 on ANY difference.
// Each takes an optional `--tier=<name>` (default `browser`); an unknown name is a hard error that
// prints the registry rather than silently measuring nothing.
//
// WHY THIS EXISTS (S313, closing bryan's Q6).
// The browser tier carries a DOCUMENTED FAILURE BASELINE (~48). Because an exit code cannot express
// "the same failures as before", every blocking gate EXCLUDES the tier outright and CI parks it in a
// `continue-on-error: true` job. The consequence is the thing worth naming: a tier that always fails
// is indistinguishable from a tier that has REGRESSED, so a genuinely new browser failure is
// invisible — pa-base §8's "a gate that has never failed is indistinguishable from a gate that
// CANNOT fail", in its purest form. S301 hit the other side of the same coin: pointing the pre-push
// hook at the full tree made it structurally unpassable, which is the cry-wolf shape that gets a gate
// bypassed and then deleted.
//
// The fix is to gate on the WRONG THING less: not the COUNT (which says nothing about which test
// broke), and not exit code (which is permanently 1), but the FAILURE NAME SET, which is exactly the
// artifact a human was already diffing by hand at S307 ("verified by NAME-SET diff against main's own
// tracking run, identical, zero new, not by count").
//
// DETERMINISM IS THE HARD CONSTRAINT (pa-base §8, the non-deterministic-input failure mode). The key
// is `<suite> > <test name>` and NOTHING else. Deliberately stripped:
//   - per-test timings (`[26.78ms]`) — vary every run; would flap red for reasons no commit caused
//   - pass/skip/fail COUNTS — a count moving is not information about WHICH test moved
//   - file paths and ordering — bun's file order is not a contract
//
// BIDIRECTIONAL BY DESIGN. `--check` goes red on BOTH:
//   - NEW failures      → a regression. This is the case the tier could not previously report.
//   - FIXED entries     → the baseline is STALE. A baseline nobody prunes silently re-acquires the
//                         blind spot it was built to remove (the S307 stale-assertion class, where a
//                         real native defect failed invisibly behind an assertion nobody re-read).
// Both are actionable and the messages say which action.
//
// SCOPE. This asserts the browser tier ONLY. lsp / commands / self-host carry their own baselines and
// are out of scope here; extending to them is mechanical once this shape is proven in anger.
//
// ⛑ S409 — THE SCOPE PARAGRAPH DIRECTLY ABOVE WAS FALSE FROM THE DAY IT WAS WRITTEN, AND THE FALSE
// HALF IS THE REASSURING HALF. "lsp / commands / self-host carry their own baselines" was never
// true: `compiler/tests/browser/FAILURE-BASELINE.json` was the ONLY baseline file in the repo and
// this was the ONLY baseline script. A reader auditing "is the self-host tier covered?" would read
// that sentence and conclude yes. It is preserved above rather than deleted because the failure mode
// — a scope note that describes an intended world as an existing one — is worth leaving legible.
//
// WHAT IS ACTUALLY TRUE AT S409, measured rather than assumed:
//   · `browser`   — asserted here, gated in the BLOCKING `gate` job since S313, and ALSO reported in
//                   `tracking`. 48 names, 2 env-exclusions.
//   · `self-host` — asserted here as of S409, gated in the BLOCKING `gate` job, 3 names, ZERO
//                   env-exclusions. See the registry entry for the measurement.
//   · `lsp` / `commands` — STILL have no baseline and are STILL not asserted by anything. They run
//                   in `tracking`, which is `continue-on-error: true`. Adding them is a registry
//                   entry plus a `--write`; it has NOT been done, and this sentence says so instead
//                   of implying otherwise.
//
// PROMOTION IS NOT TAKEN HERE. Wiring this into the blocking `gate` is a separate, operator-level
// call: per the S302 lesson, promoting the whole `tracking` job wholesale would be exactly the
// cry-wolf retrofit. This lands as a step in `tracking` that reports honestly; whether `gate` should
// require it is bryan's.
//
// ⛑ S409 — AND THE PROMOTION PARAGRAPH ABOVE IS A RECORD OF THE POSITION AT AUTHORING TIME, NOT THE
// CURRENT STATE. Read it as dated. bryan ruled promote for `browser` at S313 (it has been a BLOCKING
// `gate` step since) and ruled promote for `self-host` at S409. Both rulings are operator-level and
// both are recorded at their call sites in `.github/workflows/ci.yml`. The paragraph stays because
// the REASONING in it — do not promote a whole continue-on-error job wholesale — is still the rule
// that governs the next tier somebody wants to add.

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import { createInterface } from "readline";
import { PassThrough } from "stream";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// A `(fail)` marker, minus the trailing `[12.34ms]` timing (timings are non-deterministic).
//
// DELIBERATELY NOT ANCHORED TO LINE START, and this is not a style choice — it is a bug fix with a
// scar. The first cut used `/^\(fail\)/` and silently under-counted by exactly one: a failing test
// whose assertion dumps a happy-dom object emits the marker MID-LINE, glued to the dump —
//     `                  getElementsByClassName: [Fun(fail) M1 — an if= mount/unmount … [1218.81ms]`
// — so the anchored form dropped it. The consequence would have been the precise hollow-gate this
// script exists to prevent: a baseline missing a real failure, which then reads as a NEW failure the
// moment the interleaving shifts. `.` does not match newlines, so the non-greedy body stays on one
// line; requiring the timing suffix keeps a literal "(fail)" inside test OUTPUT from matching.
const FAIL_MARKER = /\(fail\)\s+(.+?)\s+\[[\d.]+\s*m?s\]/g;

/** bun's own summary line, e.g. ` 48 fail`. The cross-check oracle. */
const SUMMARY_FAIL = /^\s*(\d+)\s+fail\s*$/m;

interface EnvExclusion {
  name: string;
  reason: string;
}

interface Baseline {
  _comment: string;
  tier: string;
  recordedAt: string;
  count: number;
  failures: string[];
  envExcluded: EnvExclusion[];
}

// ENVIRONMENT-DEPENDENT TESTS — excluded from BOTH sides of the comparison.
//
// Caught the honest way: the first baseline was recorded locally and went RED on its very first CI
// run, reporting two "NEW FAILURES" that were nothing of the kind. Both read gitignored
// `benchmarks/todomvc/dist/`, which exists on a machine where the benchmark has been built and not in
// a fresh checkout — so the recorded set encoded ENVIRONMENT state, not REPO state. That is precisely
// the pa-base §8 non-deterministic-input mode this script's own header warns about, committed by the
// script's own author on the first try. A gate that reddens for reasons no commit caused gets
// bypassed and then deleted, so the exclusion is the correct trade — and per §8 it belongs INSIDE the
// artifact, where a later reader sees a decision rather than an oversight.
//
// GUARD AGAINST THE OTHER §8 MODE (the absorbed escape hatch): this list is the escape hatch, and an
// escape hatch under sustained pressure absorbs the whole surface one defensible exemption at a time.
// So it is (a) named per-entry with a reason, (b) COUNTED on every run — the skip-rate is printed
// beside the asserted count so growth is visible, and (c) deliberately not pattern-based: adding an
// entry costs a line of justification, which is the friction that keeps it small.
//
// ⛑ S409 — THE LIST IS NOW PER-TIER (it moved verbatim into the `browser` registry entry below) AND
// THE PER-TIER SPLIT IS PART OF THE GUARD, NOT BOOKKEEPING. A single shared list would let one
// tier's justified exemption silently suppress a same-named failure in another, and the printed
// skip-rate — the detection mechanism — would stop being a ratio over the tier it names.
const BROWSER_ENV_EXCLUDED: EnvExclusion[] = [
  {
    name: "TodoMVC §0: SKIP — dist not compiled > benchmarks/todomvc/dist/app.html must exist",
    reason:
      "reads gitignored benchmarks/todomvc/dist/ — absent in a fresh checkout, present only where the benchmark has been built. Environment state, not repo state.",
  },
  {
    name: "TodoMVC §1: initial render — HTML structure > dist files exist (app.html, app.client.js)",
    reason:
      "same gitignored benchmarks/todomvc/dist/ dependency as the §0 guard above; fails in CI and passes on a machine that has built the benchmark.",
  },
];

interface TierConfig {
  /** The path handed to `bun test`. Also the `tier` field written into the baseline artifact. */
  testPath: string;
  /** Where this tier's recorded name set lives, relative to the repo root. */
  baselinePath: string;
  /** Printed while the tier runs. Tiers differ by ~50x in wall time; a wrong note reads as a hang. */
  durationNote: string;
  /** See BROWSER_ENV_EXCLUDED's comment. An empty list is a MEASUREMENT, not an omission. */
  envExcluded: EnvExclusion[];
}

// THE TIER REGISTRY — the only tier-specific state in this file.
//
// ⛑ S409. Before this, `TIER` / `BASELINE_PATH` / `ENV_EXCLUDED` were three module-level constants
// and the tier was baked in. The internals — the streaming line-filter, FAIL_MARKER, the parser's
// own oracle, `failureReason`, the bidirectional diff — were ALREADY generic and needed no change;
// `Baseline` already carried a `tier` field. So the honest cost of the second tier was a registry,
// not a second copy of the script. A hand-spelled `self-host-baseline.ts` would have forked every
// scar above into two files that drift.
//
// ⛔ ADDING A TIER IS NOT FREE AND THE ORDER MATTERS: record the baseline with `--write` FIRST, read
// the recorded names, and only then wire a `--check` into CI. Wiring first gives you a MISSING-file
// hard error at best and, if someone "fixes" that by writing an empty set, the hollow gate this
// script exists to prevent.
const TIERS: Record<string, TierConfig> = {
  browser: {
    testPath: "compiler/tests/browser",
    baselinePath: "compiler/tests/browser/FAILURE-BASELINE.json",
    durationNote: "this tier is slow; ~20-30s",
    envExcluded: BROWSER_ENV_EXCLUDED,
  },
  "self-host": {
    testPath: "compiler/tests/self-host",
    baselinePath: "compiler/tests/self-host/FAILURE-BASELINE.json",
    durationNote: "~0.6s",
    // ZERO ENV-EXCLUSIONS, AND THAT IS A MEASUREMENT.
    //
    // The stated reason this tier was excluded from every gate — that it "needs a locally-built,
    // gitignored dist that CANNOT be rebuilt on a clean checkout" — is FALSE for
    // `compiler/tests/self-host`, and was measured two ways at S409 rather than argued:
    //   (a) `compiler/self-host/dist/` (14 files) moved entirely out of the tree, tier re-run;
    //   (b) a fresh worktree, where `dist/` (.gitignore:2) had never materialised at all.
    // Both readings: 139 pass · 122 skip · 3 fail · 264 tests across 4 files · <0.6s, with an
    // IDENTICAL failure name set. The tests compile their inputs at test time, and `bs.test.js`
    // self-skips with an explicit message when `bs.scrml` fails to compile. Nothing here READS
    // environment state, so there is nothing to exempt — and an empty list is recorded explicitly so
    // the next reader knows it was checked rather than skipped.
    //
    // ⛔ BUT THE TIER IS NOT SIDE-EFFECT-FREE, AND THE FIRST CUT OF THIS COMMENT SAID IT WAS.
    // It read "Nothing here reads environment state, so there is nothing to exempt" and stopped
    // there — READING was the half that got checked; WRITING is the half that bites. Measured, by
    // execution: delete `compiler/self-host/dist/`, run `bun test compiler/tests/self-host/bs.test.js`
    // alone, and it reports *"self-host parity SKIPPED — bs.scrml compile failed"*, skips all 52 …
    // AND STILL WRITES `bs.css` + `bs.js` into `compiler/self-host/dist/`. `compileScrml({write:true})`
    // emits even when the compile reports errors. So THE TIER MANUFACTURES THE VERY ARTIFACT ITS OWN
    // EXCLUSION CLAIM WAS BUILT AROUND — and manufactures it from a FAILED compile.
    //
    // ⛔ THE CROSS-TIER HAZARD, STATED SO THE NEXT PERSON WIRING THESE INTO ONE JOB SEES IT.
    // `compiler/tests/integration/self-host-smoke.test.js` gates its whole §B block on a bare
    // `existsSync(<root>/compiler/self-host/dist/bs.js)` (`:665`, and again at `:669` `:673` `:679`
    // `:699` `:711`). Those guards exist BECAUSE the artifact is gitignored and a clean checkout
    // cannot have it — their contract is "skip when absent". Running THIS tier first satisfies the
    // guard, so the smoke tests flip from SKIP to RUNNING AGAINST AN ARTIFACT PRODUCED BY A FAILED
    // COMPILE, with no diagnostic anywhere saying so.
    // ⚑ It is safe in CI TODAY ONLY BY LUCK OF LAYOUT, NOT BY ANY PROPERTY: the self-host gate runs
    // in `gate` and `integration` runs in `tracking`, which is a DIFFERENT JOB and therefore a
    // different checkout. Put them in one job — the standing "promote integration into gate" plan at
    // the top of ci.yml would do exactly that — and the hazard is live.
    // ⚑ AND THE OBVIOUS LOCAL PROBE FOR IT LIES: `self-host-smoke.test.js` resolves its dist path
    // from `findMainProjectRoot()` (`:34`), which parses `git worktree list` and takes the MAIN
    // working tree — so deleting the dist inside a WORKTREE changes nothing it reads. Measure this
    // one in a single-checkout layout or you will measure a different artifact than the obligation.
    // Fixing `bs.test.js` not to emit on a failed compile is a separate arc and is NOT done here.
    //
    // WHY THE TIER IS GATED AT ALL (S409): a defect that rewrote the character class
    // `/[A-Za-z0-9_\-:@]/` into a map literal lived in `compiler/self-host/tab.scrml`, made
    // `isAttrIdentPart` return false for EVERY character, and turned a tokenizer loop into an
    // unbounded allocator — an 82 GB host lockup that cost a day and three hard resets and sat
    // unattributed for sessions (fixed at 6951baa5, #924). NOTHING IN ANY GATED PATH EXECUTED THIS
    // DIRECTORY, so it reached nobody's gate. ⚑ PRECISION, because the looser form of that sentence
    // ("run by no hook") is FALSE and this file exists to stop reassuring comments: `.git/hooks/
    // post-commit` DOES run `bun test compiler/tests/`, self-host included. It just cannot gate
    // anything — it runs AFTER the commit — and it greps `\d+ fail` to print "TEST REGRESSION
    // DETECTED", which the browser tier's 48 baselined failures trigger on EVERY compiler-touching
    // commit. Permanently-red advisory output is not coverage; it is the cry-wolf shape this whole
    // mechanism replaces. That is the whole argument.
    envExcluded: [],
  },
};

const DEFAULT_TIER = "browser";

/**
 * Resolve the tier against the registry. BOTH spellings are accepted: `--tier=<name>` and
 * `--tier <name>`.
 *
 * FAILS LOUD on an unknown name rather than falling back to the default. A typo'd tier that silently
 * measured `browser` would report PASS while asserting nothing about the tier the caller named — the
 * wrong-referent mode (a probe that resolves to a different artifact than the obligation measures
 * nothing), which is the same class as everything else this file guards against.
 *
 * ⛔ THE SPACE FORM IS HANDLED BECAUSE ITS ABSENCE WAS A LIVE DEFECT IN THE GATE, CAUGHT BY AN
 * ADVERSARIAL PASS ON THIS FILE'S FIRST CUT — AND IT WAS THE EXACT DEFECT THE DOC COMMENT ABOVE
 * CLAIMED TO PREVENT. The first cut matched only `a.startsWith("--tier=")`, so
 * `bun scripts/tier-baseline.ts --tier self-host --check` fell through to DEFAULT_TIER and printed,
 * verbatim:
 *
 *     PASS — browser failure name set matches the baseline (48 asserted, 0 of 2 env-excluded observed).
 *
 * Exit 0. Asserting nothing about self-host. REPORTING SUCCESS. A gate that answers a question you
 * did not ask, in the affirmative, is worse than no gate — and this one shipped inside the arc whose
 * whole purpose was to close that class. Two sides to the fix, and both are load-bearing:
 *   (a) the space form RESOLVES, so the natural spelling does what the caller meant; and
 *   (b) a `--tier` with no value — last token, or followed by another flag — is a HARD ERROR rather
 *       than a silent default. `--tier --check` must never quietly measure `browser`, and it must
 *       never swallow `--check` as a tier name either (which would then also silently downgrade the
 *       run from CHECK to PRINT, i.e. exit 0 forever: one typo, two hollow-gate modes).
 * The FIRST matching spelling wins, so the resolution is deterministic if both appear.
 */
function resolveTier(): { name: string; cfg: TierConfig } {
  const argv = process.argv;
  let name = DEFAULT_TIER;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--tier=")) {
      name = a.slice("--tier=".length);
      break;
    }
    if (a === "--tier") {
      const next = argv[i + 1];
      // A flag-looking successor is NOT a tier name. Treating it as one is how `--tier --check`
      // would have become "measure the tier literally named `--check`" — which then fails the
      // registry lookup below, but only by luck of that name not existing. Rejecting here makes it
      // deliberate rather than incidental.
      if (next === undefined || next.startsWith("-")) {
        console.error(`\n  MISSING TIER NAME — \`--tier\` was given with no value.`);
        console.error(`  Known tiers: ${Object.keys(TIERS).join(" · ")}`);
        console.error(`  Write either \`--tier=<name>\` or \`--tier <name>\`.`);
        console.error(`  Refusing to run: falling back to the default here would assert the WRONG`);
        console.error(`  tier and report PASS while doing it.\n`);
        process.exit(1);
      }
      name = next;
      break;
    }
  }

  const cfg = TIERS[name];
  if (!cfg) {
    console.error(`\n  UNKNOWN TIER — \`${name}\` is not in the registry.`);
    console.error(`  Known tiers: ${Object.keys(TIERS).join(" · ")}`);
    console.error(`  Refusing to run: a mistyped tier that fell back to the default would report`);
    console.error(`  PASS while asserting nothing about the tier you named.\n`);
    process.exit(1);
  }
  return { name, cfg };
}

async function runTier(cfg: TierConfig): Promise<{
  names: string[];
  ranOk: boolean;
  raw: string;
  reported: number | null;
  parsed: number;
  parseOk: boolean;
}> {
  // STREAMING LINE-FILTER, not a buffered capture — and that is the whole point of the S357 fix.
  // The tier's ~48 baseline failures each dump a full happy-dom node on their assertion diff, so the
  // RAW output is ~155 MB and GROWS as failures accrue. Buffering all of it (the S357 band-aid raised
  // spawnSync's `maxBuffer` 64→512 MB, PR #599) is a time bomb: once the dumps cross the ceiling,
  // spawnSync ENOBUFS-kills bun BEFORE its `N pass` summary prints, so `ranOk` (below) sees no pass
  // line and reports HARNESS-DID-NOT-RUN — a green main tier reading as a hard gate failure,
  // deterministically, for every PR at once (the S357 outage). Streaming keeps memory BOUNDED
  // regardless of how large the dumps grow: we read the merged output line by line and KEEP only what
  // the downstream oracles need — every `(fail)` marker with a small context window around it (for
  // failureReason's error-block lookback / timeout-marker lookahead) plus the trailing summary lines —
  // DROPPING the multi-thousand-line object dumps that are the 155 MB bulk. `raw` below is therefore
  // the FILTERED text (tens of KB), and every downstream computation (names / ranOk / reported /
  // parseOk / failureReason / the `!ranOk` tail) runs on it byte-identically to the buffered version.
  const child = spawn("bun", ["test", cfg.testPath], { cwd: REPO_ROOT });

  // Merge stdout + stderr into ONE ordered line sequence. The tier writes ~all of its payload (markers,
  // error blocks, dumps, AND the `N pass/skip/fail` summary) to STDERR; stdout is ~181 bytes. Both
  // streams pipe into a single PassThrough WITHOUT ending it (`{ end: false }`); we end it once BOTH
  // child streams have ended, so arrival order is preserved and an `error:` block stays contiguous with
  // its `(fail)` marker. readline reads the merged stream (crlfDelay:Infinity for Windows CRLF).
  const merged = new PassThrough();
  child.stdout.pipe(merged, { end: false });
  child.stderr.pipe(merged, { end: false });
  let openStreams = 2;
  const endMerged = () => {
    if (--openStreams === 0) merged.end();
  };
  child.stdout.on("end", endMerged);
  child.stderr.on("end", endMerged);
  // FAIL LOUD, never hang. If the spawn itself fails (bun missing) or a stream errors, the `end`
  // events above may never fire and readline would block forever. End the merged stream so the read
  // loop completes with whatever it has: an empty/partial `raw` trips `!ranOk` → HARNESS-DID-NOT-RUN,
  // which is the same loud outcome the buffered `spawnSync` gave on a spawn error. A hung gate job is
  // strictly worse than a failed one (pa-base §8 — a gate must be able to report).
  child.on("error", () => merged.end());

  const CTX_BACK = 25; // >= failureReason's 20-line error-block lookback
  const CTX_FWD = 4; //  >= failureReason's 3-line lookahead for the `^ … timed out` marker
  const MAX_LINE = 16384; // defensive per-line cap; the tier's max line is ~3143 so it never fires
  // A bun summary line, e.g. ` 730 pass` / ` 48 fail` / ` 8 skip`. Retained unconditionally: the
  // summary sits far past the last marker's window, so window/lookahead retention would miss it, and
  // both `ranOk` (needs a `pass` line) and the SUMMARY_FAIL oracle (needs the `fail` line) depend on it.
  const SUMMARY_LINE = /^\s*\d+\s+(pass|fail|skip|todo)\b/;

  const retained: string[] = [];
  const back: { idx: number; text: string }[] = []; // ring of the last CTX_BACK lines
  let globalIdx = 0;
  let flushedThrough = -1; // high-water mark of global indices already in `retained` (dedup)
  let fwd = 0; // forward-keep countdown after a marker

  const rl = createInterface({ input: merged, crlfDelay: Infinity });
  for await (let line of rl) {
    if (line.length > MAX_LINE) {
      const half = MAX_LINE >> 1;
      line = `${line.slice(0, half)}…[line truncated]…${line.slice(-half)}`;
    }
    const idx = globalIdx++;
    back.push({ idx, text: line });
    while (back.length > CTX_BACK) back.shift();

    // NON-anchored FAIL_MARKER test (reset lastIndex — it is a global regex) catches the documented
    // mid-line-glued marker case, exactly as the buffered parse below does.
    FAIL_MARKER.lastIndex = 0;
    if (FAIL_MARKER.test(line)) {
      // Trigger: flush the whole back-window (skipping indices already retained by an overlapping
      // earlier window) so failureReason can walk back to the preceding `error:` block.
      for (const w of back) {
        if (w.idx > flushedThrough) {
          retained.push(w.text);
          flushedThrough = w.idx;
        }
      }
      fwd = CTX_FWD;
    } else if (fwd > 0) {
      if (idx > flushedThrough) {
        retained.push(line);
        flushedThrough = idx;
      }
      fwd--;
    } else if (SUMMARY_LINE.test(line)) {
      if (idx > flushedThrough) {
        retained.push(line);
        flushedThrough = idx;
      }
    }
    // else DROP — the bulk happy-dom object dump (the 155 MB we exist to shed).
  }

  const raw = `${retained.join("\n")}\n`;

  const names = new Set<string>();
  FAIL_MARKER.lastIndex = 0;
  for (const m of raw.matchAll(FAIL_MARKER)) names.add(m[1].trim());

  // Fail LOUD rather than record an empty set: a harness that did not run (missing fixtures, a bun
  // crash, a renamed tier) otherwise writes an empty baseline that then passes forever — the hollow
  // gate this script exists to prevent, reintroduced by its own tooling.
  const ranOk = /\d+\s+pass/.test(raw);

  // THE PARSER'S OWN ORACLE. bun reports its own failure count; if our parse disagrees, the PARSER is
  // wrong and every downstream verdict is worthless. Checking this is what turns a silent under-count
  // into a loud one — and it is the check that caught the mid-line-marker bug above. Without it the
  // first cut looked perfectly healthy: it printed a plausible number, wrote a plausible baseline,
  // and would have passed `--check` forever. (S307's three-hollow-oracles lesson, applied to itself.)
  const summary = SUMMARY_FAIL.exec(raw);
  const reported = summary ? Number(summary[1]) : null;
  const parseOk = reported === null || reported === names.size;

  return { names: [...names].sort(), ranOk, raw, reported, parsed: names.size, parseOk };
}

/**
 * The REASON excerpt for one failing test, pulled from bun's raw output — printed beside every NEW
 * failure name so the gate says WHY, not just WHICH.
 *
 * WHY THIS EXISTS (S346, flagship-hos). The name-set gate is deliberately blind to everything but the
 * `<suite> > <name>` key, and `spawnSync(..., {encoding:"utf8"})` swallows the tier's stdout — so
 * when `flagship driver/hos … engine mount really does sit inside an if= template` joined the set
 * intermittently in cloud, three sessions read it as "the emitted html lacks the template" and chased
 * compile order / stray files / module-level compiler state. The line bun had printed the whole time
 * was `^ this test timed out after 5000ms.` — a synchronous whole-app compile overrunning bun's
 * DEFAULT per-test budget (the repo's `bunfig.toml [test] timeout` key is not one bun reads). A
 * timed-out test and a failed assertion produce the SAME `(fail) <name>` marker, so the key alone
 * cannot tell them apart; the excerpt can.
 *
 * bun's two shapes:
 *   assertion / thrown:  `error: …` (+ Expected/Received + stack)  THEN  `(fail) name [ms]`
 *   timeout:             `(fail) name [ms]`  THEN  `  ^ this test timed out after Nms.`
 * so the excerpt is: the nearest preceding `error:` block (capped), the marker line's own timing, and
 * any `^`-prefixed line right after the marker. Best-effort — a diagnostic, never an input to the
 * comparison.
 */
function failureReason(raw: string, name: string): string[] {
  const lines = raw.split("\n");
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const marker = new RegExp(`\\(fail\\)\\s+${esc}\\s+\\[([\\d.]+\\s*m?s)\\]`);
  const idx = lines.findIndex((l) => marker.test(l));
  if (idx < 0) return ["(no `(fail)` marker line found for this name — run the file directly with `bun test <file>`)"];
  const out: string[] = [];
  const timing = marker.exec(lines[idx])?.[1];
  if (timing) out.push(`took ${timing}`);
  // Preceding `error:` block — walk back up to 20 lines for the nearest `error:` line.
  let from = -1;
  for (let i = idx - 1; i >= 0 && i >= idx - 20; i--) {
    if (/^\s*(error:|[A-Za-z]*Error:)/.test(lines[i])) { from = i; break; }
  }
  if (from >= 0) {
    const block = lines.slice(from, idx).map((l) => l.trimEnd()).filter((l) => l.trim() !== "");
    for (const l of block.slice(0, 8)) out.push(l.trim());
    if (block.length > 8) out.push(`… (${block.length - 8} more line(s))`);
  }
  // Following `^`-prefixed line(s) — bun's timeout marker.
  for (let i = idx + 1; i < lines.length && i <= idx + 3; i++) {
    if (/^\s*\^/.test(lines[i])) out.push(lines[i].trim());
    else break;
  }
  if (out.length === (timing ? 1 : 0)) out.push("(no reason excerpt found — run the file directly with `bun test <file>`)");
  return out;
}

function readBaseline(tierName: string, cfg: TierConfig): Baseline {
  const path = join(REPO_ROOT, cfg.baselinePath);
  if (!existsSync(path)) {
    console.error(`\n  MISSING — ${path} does not exist.`);
    console.error(`  Record it with: bun scripts/tier-baseline.ts --tier=${tierName} --write\n`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(path, "utf8")) as Baseline;
}

function writeBaseline(tierName: string, cfg: TierConfig, names: string[], stamp: string): string {
  const path = join(REPO_ROOT, cfg.baselinePath);
  const payload: Baseline = {
    _comment:
      `GENERATED — the ${tierName} tier's documented failure NAME SET. Regenerate with ` +
      `\`bun scripts/tier-baseline.ts --tier=${tierName} --write\`; verify with \`--check\`. Timings and counts are ` +
      "deliberately excluded (non-deterministic / uninformative). A name LEAVING this list is as " +
      "much a failure as one joining it: prune it in the same commit that fixes the test.",
    tier: cfg.testPath,
    recordedAt: stamp,
    count: names.length,
    failures: names,
    envExcluded: cfg.envExcluded,
  };
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return path;
}

async function main(): Promise<void> {
  const { name: tierName, cfg } = resolveTier();

  const mode = process.argv.includes("--check")
    ? "check"
    : process.argv.includes("--write")
      ? "write"
      : "print";

  // A calendar stamp is metadata, never an input to the comparison — `--check` reads `failures` only.
  //
  // ⛑ S409 FIX ROUND — THE DEFAULT USED TO BE `""`, AND THAT MADE EVERY SHIPPED INSTRUCTION IN THIS
  // REPO WRONG. The baseline artifacts' own `_comment` says "Regenerate with `... --write`", and so
  // do the MISSING hint in readBaseline() and the STALE-BASELINE prune hint below. Following any of
  // them LITERALLY blanked `recordedAt`, silently, in the very file whose job is to be a trustworthy
  // record — so the instruction the artifact gives you degraded the artifact. Defaulting to today
  // makes the shipped instruction correct as written, which is the right direction to fix it: an
  // instruction nobody can follow without a flag they were not told about is the defect, not the
  // user. `--stamp=<YYYY-MM-DD>` still overrides, for back-dating a re-record.
  const stamp =
    process.argv.find((a) => a.startsWith("--stamp="))?.slice("--stamp=".length) ??
    new Date().toISOString().slice(0, 10);

  console.log(`\n  Running ${cfg.testPath} … (${cfg.durationNote})\n`);
  const { names, ranOk, raw, reported, parsed, parseOk } = await runTier(cfg);

  if (!parseOk) {
    console.error(`  PARSER DISAGREES WITH THE HARNESS — bun reports ${reported} failure(s), this`);
    console.error(`  script parsed ${parsed}. The parser is wrong, so every verdict below it would be`);
    console.error(`  worthless. Refusing to record or compare.`);
    console.error(`  Most likely cause: a \`(fail)\` marker emitted somewhere this regex does not reach`);
    console.error(`  (bun interleaves markers into test output — see FAIL_MARKER's comment).\n`);
    process.exit(1);
  }

  if (!ranOk) {
    console.error("  HARNESS DID NOT RUN — no `N pass` line in the output.");
    console.error("  Refusing to record or compare an empty set (that is the hollow-gate shape).");
    console.error("  Hint: `bun run pretest` populates samples/compilation-tests/dist first.\n");
    console.error(raw.split("\n").slice(-25).join("\n"));
    process.exit(1);
  }

  if (mode === "print") {
    console.log(`  ${names.length} failing test(s) in ${cfg.testPath}:\n`);
    for (const n of names) console.log(`    ${n}`);
    console.log(`\n  (write them with --write; gate with --check)\n`);
    return;
  }

  if (mode === "write") {
    const path = writeBaseline(tierName, cfg, names, stamp);
    console.log(`  recorded ${names.length} failure name(s) → ${path}\n`);
    console.log("--write: done.\n");
    return;
  }

  const baseline = readBaseline(tierName, cfg);
  const excluded = new Set(cfg.envExcluded.map((e) => e.name));

  // Filter BOTH sides. Excluding only the observed side would make the comparison direction-dependent.
  const known = new Set(baseline.failures.filter((n) => !excluded.has(n)));
  const observed = names.filter((n) => !excluded.has(n));
  const current = new Set(observed);
  const skipped = names.length - observed.length;

  const added = observed.filter((n) => !known.has(n));
  const fixed = [...known].filter((n) => !current.has(n));

  if (added.length === 0 && fixed.length === 0) {
    console.log(
      `  PASS — ${tierName} failure name set matches the baseline ` +
        `(${observed.length} asserted, ${skipped} of ${cfg.envExcluded.length} env-excluded observed).\n`,
    );
    // The skip-rate is printed on every PASS, not buried: an escape hatch that grows silently is the
    // pa-base §8 absorbed-hatch mode, and detection of it is a RATIO, not an inspection.
    console.log("═".repeat(66) + "\n");
    return;
  }

  if (added.length) {
    console.error(`\n  NEW FAILURE(S) — ${added.length} test(s) fail that the baseline does not list:\n`);
    for (const n of added) {
      console.error(`    + ${n}`);
      // The WHY, beside the WHICH — see failureReason(). A timeout and an assertion failure share
      // the same marker; only this excerpt tells them apart.
      for (const l of failureReason(raw, n)) console.error(`        │ ${l}`);
    }
    console.error(
      `\n  This is a REGRESSION. The ${tierName} tier's count alone would not have shown it.\n` +
        "  Fix the regression, or — if the failure is genuinely environmental and accepted —\n" +
        "  re-record with `--write` and say why in the commit message.",
    );
  }

  if (fixed.length) {
    console.error(`\n  STALE BASELINE — ${fixed.length} baseline entr(y/ies) now PASS:\n`);
    for (const n of fixed) console.error(`    - ${n}`);
    console.error(
      `\n  Prune them: \`bun scripts/tier-baseline.ts --tier=${tierName} --write\`. A baseline nobody prunes\n` +
        "  re-acquires the blind spot it was built to remove.",
    );
  }

  console.error("");
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
