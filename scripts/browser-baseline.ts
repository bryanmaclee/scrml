// scripts/browser-baseline.ts — Q6 of the S310 queue. change-id: browser-failure-name-set-baseline
//
// THREE MODES (mirrors scripts/state.ts + scripts/facts.ts exactly — same flags, same exit semantics):
//   `bun scripts/browser-baseline.ts`         PRINT  — run the tier, report the current failure set.
//   `bun scripts/browser-baseline.ts --write` WRITE  — record the current failure NAME SET as the
//                                                      baseline. Idempotent.
//   `bun scripts/browser-baseline.ts --check` CHECK  — run the tier, diff the name set against the
//                                                      baseline; exit 1 on ANY difference.
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
// PROMOTION IS NOT TAKEN HERE. Wiring this into the blocking `gate` is a separate, operator-level
// call: per the S302 lesson, promoting the whole `tracking` job wholesale would be exactly the
// cry-wolf retrofit. This lands as a step in `tracking` that reports honestly; whether `gate` should
// require it is bryan's.

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import { createInterface } from "readline";
import { PassThrough } from "stream";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_PATH = join(REPO_ROOT, "compiler/tests/browser/FAILURE-BASELINE.json");
const TIER = "compiler/tests/browser";

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
const ENV_EXCLUDED: EnvExclusion[] = [
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

async function runTier(): Promise<{
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
  const child = spawn("bun", ["test", TIER], { cwd: REPO_ROOT });

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

function readBaseline(): Baseline {
  if (!existsSync(BASELINE_PATH)) {
    console.error(`\n  MISSING — ${BASELINE_PATH} does not exist.`);
    console.error(`  Record it with: bun scripts/browser-baseline.ts --write\n`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Baseline;
}

function writeBaseline(names: string[], stamp: string): void {
  const payload: Baseline = {
    _comment:
      "GENERATED — the browser tier's documented failure NAME SET. Regenerate with " +
      "`bun scripts/browser-baseline.ts --write`; verify with `--check`. Timings and counts are " +
      "deliberately excluded (non-deterministic / uninformative). A name LEAVING this list is as " +
      "much a failure as one joining it: prune it in the same commit that fixes the test.",
    tier: TIER,
    recordedAt: stamp,
    count: names.length,
    failures: names,
    envExcluded: ENV_EXCLUDED,
  };
  writeFileSync(BASELINE_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function main(): Promise<void> {
  const mode = process.argv.includes("--check")
    ? "check"
    : process.argv.includes("--write")
      ? "write"
      : "print";

  // A calendar stamp is metadata, never an input to the comparison — `--check` reads `failures` only.
  const stamp = process.argv.find((a) => a.startsWith("--stamp="))?.slice("--stamp=".length) ?? "";

  console.log(`\n  Running ${TIER} … (this tier is slow; ~20-30s)\n`);
  const { names, ranOk, raw, reported, parsed, parseOk } = await runTier();

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
    console.log(`  ${names.length} failing test(s) in ${TIER}:\n`);
    for (const n of names) console.log(`    ${n}`);
    console.log(`\n  (write them with --write; gate with --check)\n`);
    return;
  }

  if (mode === "write") {
    writeBaseline(names, stamp);
    console.log(`  recorded ${names.length} failure name(s) → ${BASELINE_PATH}\n`);
    console.log("--write: done.\n");
    return;
  }

  const baseline = readBaseline();
  const excluded = new Set(ENV_EXCLUDED.map((e) => e.name));

  // Filter BOTH sides. Excluding only the observed side would make the comparison direction-dependent.
  const known = new Set(baseline.failures.filter((n) => !excluded.has(n)));
  const observed = names.filter((n) => !excluded.has(n));
  const current = new Set(observed);
  const skipped = names.length - observed.length;

  const added = observed.filter((n) => !known.has(n));
  const fixed = [...known].filter((n) => !current.has(n));

  if (added.length === 0 && fixed.length === 0) {
    console.log(
      `  PASS — browser failure name set matches the baseline ` +
        `(${observed.length} asserted, ${skipped} of ${ENV_EXCLUDED.length} env-excluded observed).\n`,
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
      "\n  This is a REGRESSION. The browser tier's count alone would not have shown it.\n" +
        "  Fix the regression, or — if the failure is genuinely environmental and accepted —\n" +
        "  re-record with `--write` and say why in the commit message.",
    );
  }

  if (fixed.length) {
    console.error(`\n  STALE BASELINE — ${fixed.length} baseline entr(y/ies) now PASS:\n`);
    for (const n of fixed) console.error(`    - ${n}`);
    console.error(
      "\n  Prune them: `bun scripts/browser-baseline.ts --write`. A baseline nobody prunes\n" +
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
