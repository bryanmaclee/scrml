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
import { spawnSync } from "child_process";

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

interface Baseline {
  _comment: string;
  tier: string;
  recordedAt: string;
  count: number;
  failures: string[];
}

function runTier(): {
  names: string[];
  ranOk: boolean;
  raw: string;
  reported: number | null;
  parsed: number;
  parseOk: boolean;
} {
  const res = spawnSync("bun", ["test", TIER], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const raw = `${res.stdout ?? ""}\n${res.stderr ?? ""}`;

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
  };
  writeFileSync(BASELINE_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function main(): void {
  const mode = process.argv.includes("--check")
    ? "check"
    : process.argv.includes("--write")
      ? "write"
      : "print";

  // A calendar stamp is metadata, never an input to the comparison — `--check` reads `failures` only.
  const stamp = process.argv.find((a) => a.startsWith("--stamp="))?.slice("--stamp=".length) ?? "";

  console.log(`\n  Running ${TIER} … (this tier is slow; ~20-30s)\n`);
  const { names, ranOk, raw, reported, parsed, parseOk } = runTier();

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
  const known = new Set(baseline.failures);
  const current = new Set(names);

  const added = names.filter((n) => !known.has(n));
  const fixed = baseline.failures.filter((n) => !current.has(n));

  if (added.length === 0 && fixed.length === 0) {
    console.log(`  PASS — browser failure name set matches the baseline (${names.length}).\n`);
    console.log("═".repeat(66) + "\n");
    return;
  }

  if (added.length) {
    console.error(`\n  NEW FAILURE(S) — ${added.length} test(s) fail that the baseline does not list:\n`);
    for (const n of added) console.error(`    + ${n}`);
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

main();
