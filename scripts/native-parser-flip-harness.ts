#!/usr/bin/env bun
/**
 * scripts/native-parser-flip-harness.ts — THE NATIVE-PARSER DEFAULT-FLIP METER.
 * ============================================================================
 *
 * WHY THIS FILE EXISTS AT ALL
 * ---------------------------
 * The native-parser transition (compiler/native-parser/) is FROZEN — kept as the
 * self-host oracle, OFF the V1 path. One of the stated grounds for the freeze is
 * that the legacy block-scanner (BS) bug tail is FINITE once the language freezes,
 * and the operator attached an explicit re-trigger to that claim:
 *
 *     "if verify-harden stops showing a declining divergence count,
 *      the tail isn't finite -> M5 earns its cost."
 *
 * That is a METER. A meter needs an instrument. Twice now the instrument was built
 * as a throwaway and discarded, so the number had to be re-derived from scratch:
 *   - the original 429 figure is NON-REPRODUCIBLE and retired, because no harness
 *     was ever committed;
 *   - S161 rebuilt one in a throwaway worktree and discarded it again;
 *   - S170's ~508 was the last reading, and by 2026-09-06 it was ~230 sessions old
 *     with no way to re-read it except a third reconstruction.
 *
 * This script IS the instrument. Read the meter with one command.
 *
 * READ THE METER
 * --------------
 *     bun scripts/native-parser-flip-harness.ts
 *
 * That runs the suite twice (~7 min each: once unflipped as the CONTROL, once with
 * the parse routed through the native parser) and prints the flip-attributable
 * delta as SETS, not counts — NEW failures and GONE failures reported separately,
 * because a count alone hides a swap.
 *
 * WHAT "THE FLIP" IS, AND WHY THERE ARE TWO OF THEM
 * -------------------------------------------------
 * `compileScrml` in compiler/src/api.js takes a `parser` option that defaults to
 * `null`. It has exactly TWO live consumers (verified by reading api.js; do not
 * trust remembered line numbers, this script locates both by SYMBOL):
 *
 *   1. `const useNativeParser = parser === "scrml-native";`
 *      -> the ROUTING decision. When true, per-file parsing goes through
 *         `nativeParseFile` instead of the live `splitBlocks` + `buildAST`.
 *
 *   2. `if (parser === "scrml-native") { ... I-PARSER-NATIVE-SHADOW ... }`
 *      -> a routing-CONFIRMATION info diagnostic appended to `result.warnings`.
 *
 * Those are not the same flip:
 *
 *   --mode=routing         (DEFAULT) rewrites consumer 1 to `true`. Measures the
 *                          parser, and only the parser.
 *   --mode=option-default  rewrites the `parser = null` default to
 *                          `"scrml-native"`. Fires consumer 2 as well, so every
 *                          test that asserts on `result.warnings` shape/length can
 *                          fail for a reason that has nothing to do with parsing.
 *
 * `routing` is the default because the meter is supposed to measure the parser.
 * Run `option-default` when you want to know what a literal default-flip would
 * cost including the diagnostic noise; the difference between the two modes is
 * itself a useful number.
 *
 * WHY A FILE PATCH AND NOT AN ENV VAR / A BUN PRELOAD PLUGIN
 * ----------------------------------------------------------
 * Rejected: a `SCRML_PARSER_DEFAULT` env var read inside api.js. It would plant a
 * permanent behavioural backdoor in the compile entry point, and `compiler/src/`
 * is in the published `files` allowlist in package.json — a test-only knob would
 * ship to adopters.
 *
 * Rejected: a `Bun.plugin` `onLoad` transform via `--preload`. It never mutates
 * the tree, which is attractive, but it only applies to the test runner's own
 * module graph. A meaningful slice of the suite SPAWNS the CLI as a subprocess
 * (dev-server tests, command tests) and `scripts/compile-test-samples.sh` is a
 * separate `bun` invocation entirely — all of those would silently run UNFLIPPED
 * and the meter would under-report.
 *
 * So: patch the file, and be paranoid about restoring it. This script
 *   - refuses to run if compiler/src/api.js is already dirty,
 *   - keeps the original bytes in memory AND on disk under the output dir,
 *   - restores in a `finally` and on SIGINT/SIGTERM/uncaught,
 *   - verifies the restore is BYTE-IDENTICAL by SHA-256 and shouts if it is not.
 *
 * ANCHOR DISCIPLINE
 * -----------------
 * Every anchor is a SYMBOL match asserted UNIQUE. If api.js is refactored so an
 * anchor is missing or ambiguous, this script HARD-FAILS with the anchor text.
 * It does not guess, and it does not silently measure nothing. A loud failure is
 * the whole point: the previous instruments failed by not existing, and the next
 * failure mode would be an instrument that runs green while measuring the
 * unflipped compiler.
 *
 * THE CONTROL IS NOT OPTIONAL
 * ---------------------------
 * The suite is not green at HEAD. As of 2026-09-06 the CONTROL over
 * `compiler/tests/` is 54 failures — 48 of them are exactly the documented
 * browser-tier set in compiler/tests/browser/FAILURE-BASELINE.json. It reads 56
 * on a machine where `benchmarks/todomvc/dist/` has never been built, because the
 * 2 `envExcluded` TodoMVC names in that same file gate on a GITIGNORED artifact;
 * those two are dropped from both sides here. If your CONTROL is not in that
 * neighbourhood the harness is measuring something other than the flip and the
 * delta is void. This script always runs and reports the CONTROL; there is no way
 * to get a flip number out of it without one.
 *
 * LAST READING — 2026-09-06, HEAD c7d46179, `--tier compiler/tests/`
 * ------------------------------------------------------------------
 *   CONTROL 54 · FLIPPED 1907 · NEW 1860 · GONE 7  (--mode=routing)
 *   CONTROL 54 · FLIPPED 1901 · NEW 1854 · GONE 7  (--mode=option-default)
 * The two modes agree to within 8 names, all of them run-to-run flake — so the
 * I-PARSER-NATIVE-SHADOW diagnostic costs ~0 test failures and the mode choice
 * does not move the meter.
 *
 * DO NOT compare 1860 to the S161..S170 trajectory (1,150 -> 790 -> 605 -> 525 ->
 * ~508) as if it were the same measurement. The suite roughly doubled and the
 * language kept growing while the parser stayed frozen, so most of the rise is
 * surface growth, not decay. Partitioned against the test surface as it stood at
 * the S170 reading (commit 9e306082, 2026-06-07):
 *   1382 of the 1860 are in test FILES that did not exist then
 *     62 are in files that existed but tests that did not
 *    416 are LIKE-FOR-LIKE — tests that existed at the S170 reading
 * 416 vs ~508 is the honest meter: down ~18% in ~230 sessions, i.e. declining but
 * nearly flat. Reproduce that partition with `git show <S170-sha>:<file>` and a
 * verbatim test-title check; it is a DERIVED figure, not a directly measured one.
 *
 * And the 7 GONE matter more than their size. All 7 are documented
 * FAILURE-BASELINE.json failures in two files —
 * `g-emit-lift-markup-text-interp.browser.test.js` and
 * `g-each-peritem-markup-value-ternary.browser.test.js` — both markup-nested-in-
 * body cases the flat legacy body-scanner cannot represent and the native
 * parser's body-mode machine gets right. The flip is not monotone; report the
 * sets, never just the count.
 *
 * OTHER FLAGS
 * -----------
 *   --tier <paths>    SPACE-SEPARATED test paths passed to `bun test`
 *                     (default `compiler/tests/` — the whole suite, CONTROL 56).
 *                     Use the PRE-COMMIT GATE scope for a reading comparable to
 *                     the S161..S170 trajectory, whose harness reported
 *                     "control = 0" and therefore cannot have been the whole
 *                     suite:
 *                       --tier "compiler/tests/unit compiler/tests/integration \
 *                               compiler/tests/conformance compiler/tests/*.test.js"
 *   --out <dir>       artifact dir (default `.native-flip-harness/`, gitignored)
 *   --control-only    run + record the CONTROL side, then stop
 *   --flip-only       run + record the FLIPPED side, then stop
 *   --report          re-analyse artifacts already in --out; runs nothing
 *   --no-pretest      skip `scripts/compile-test-samples.sh` on both sides
 *                     (faster, but the browser tier then reads UNFLIPPED
 *                      sample artifacts and the number under-reports)
 *
 * ARTIFACTS (all under --out)
 *   control.raw.txt / flipped.raw.txt      full captured suite output
 *   control.fails.txt / flipped.fails.txt  sorted `<file> :: <test name>` set
 *   control.errors.tsv / flipped.errors.tsv  the same set plus its error line
 *   delta.md                               NEW / GONE sets + family histogram
 *   api.js.orig                            the pre-flip bytes, for manual rescue
 */

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "..");
const API_JS = join(REPO_ROOT, "compiler/src/api.js");
const BASELINE_JSON = join(
  REPO_ROOT,
  "compiler/tests/browser/FAILURE-BASELINE.json");
const SAMPLE_COMPILE_SH = join(REPO_ROOT, "scripts/compile-test-samples.sh");

// ---------------------------------------------------------------------------
// Anchors. Located by SYMBOL, asserted UNIQUE. Never by line number.
// ---------------------------------------------------------------------------
type FlipMode = "routing" | "option-default";

const ANCHORS: Record<FlipMode, { find: string; replace: string; why: string }> = {
  routing: {
    find: `const useNativeParser = parser === "scrml-native";`,
    replace: `const useNativeParser = true; /* native-parser-flip-harness */`,
    why:
      "flips the parse ROUTING only; leaves the I-PARSER-NATIVE-SHADOW " +
      "routing-confirmation diagnostic un-fired, so the delta is parser-attributable",
  },
  "option-default": {
    find: `    parser = null,`,
    replace: `    parser = "scrml-native", /* native-parser-flip-harness */`,
    why:
      "flips the literal option DEFAULT; also fires the I-PARSER-NATIVE-SHADOW " +
      "info diagnostic into result.warnings on every compile",
  },
};

// ---------------------------------------------------------------------------
// Argv
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
function flagValue(name: string, fallback: string): string {
  const i = argv.indexOf(name);
  if (i === -1) return fallback;
  const v = argv[i + 1];
  if (!v || v.startsWith("--")) die(`${name} requires a value`);
  return v;
}
const has = (name: string) => argv.includes(name);

const MODE = flagValue("--mode", "routing") as FlipMode;
if (!(MODE in ANCHORS)) {
  die(`--mode must be one of: ${Object.keys(ANCHORS).join(", ")} (got: ${MODE})`);
}
const TIER = flagValue("--tier", "compiler/tests/");
const OUT = resolve(REPO_ROOT, flagValue("--out", ".native-flip-harness"));
const CONTROL_ONLY = has("--control-only");
const FLIP_ONLY = has("--flip-only");
const REPORT_ONLY = has("--report");
const RUN_PRETEST = !has("--no-pretest");

function die(msg: string): never {
  console.error(`\nnative-parser-flip-harness: FATAL — ${msg}\n`);
  process.exit(2);
}
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

// ---------------------------------------------------------------------------
// Suite-output parsing.
//
// bun test emits, at column 0, a `<path>.test.js:` header per file, then the
// per-test `(pass)` / `(fail)` lines for that file, with each failure's `error:`
// block printed BEFORE its `(fail)` line. Attribute a failure to the most recent
// preceding header — test NAMES collide across files, `<file> :: <name>` does not.
// ---------------------------------------------------------------------------
interface Failure { file: string; name: string; error: string }

function parseFailures(raw: string): Failure[] {
  const out: Failure[] = [];
  let file = "(unattributed)";
  let lastError = "";
  for (const line of raw.split("\n")) {
    const header = /^(\S+\.test\.(?:js|ts)):$/.exec(line);
    if (header) { file = header[1]; lastError = ""; continue; }
    if (/^(?:error|TypeError|ReferenceError|SyntaxError|RangeError):/.test(line)) {
      lastError = line.trim();
      continue;
    }
    // NOTE the leading `\s*`: bun does NOT always print `(fail)` at column 0.
    // A browser-tier test whose output interleaves gets an INDENTED `(fail)`
    // line, and a column-0-anchored regex silently under-counts by exactly that
    // many failures. Observed 2026-09-06: 53 parsed vs 54 reported by bun.
    const fail = /^\s*\(fail\) (.*?)(?: \[[\d.]+m?s\])?$/.exec(line);
    if (fail) {
      out.push({ file, name: fail[1], error: lastError || "(no error line captured)" });
      lastError = "";
    }
  }
  return out;
}

/** Names whose pass/fail depends on machine state, not repo state. */
function envExcludedNames(): Set<string> {
  if (!existsSync(BASELINE_JSON)) return new Set();
  const j = JSON.parse(readFileSync(BASELINE_JSON, "utf8"));
  return new Set((j.envExcluded ?? []).map((e: { name: string }) => e.name));
}

const key = (f: Failure) => `${f.file} :: ${f.name}`;

// ---------------------------------------------------------------------------
// Family decomposition — TWO INDEPENDENT AXES, deliberately.
//
// The number is only actionable as FAMILIES, not as N file-fixes (the S162
// reframe). But "family" in the S170 reading conflated two different questions —
// MISSING-FIELD / FIELD-SHAPE are failure MECHANISMS (what went wrong in the
// bridged AST), while engine-statechild / each-match-promotion / legacy-stage-
// probe are SUBJECTS (which grammar the failing test is about). Collapsing them
// into one list forces a bucket ordering that silently decides which axis wins.
//
// So: report both, and never cross-multiply them into a single "family" number.
// These are HEURISTICS over the suite's error text — the objective artifact is
// the error-signature histogram, which is also emitted. Treat a bucket count as
// a routing hint, not as a measurement.
// ---------------------------------------------------------------------------

/** Axis 1 — MECHANISM, read off the error line. */
const MECHANISMS: Array<{ family: string; test: (f: Failure) => boolean }> = [
  {
    family: "MISSING-FIELD emit-shape (absent field reached codegen)",
    test: (f) =>
      /undefined is not an object|Cannot read propert|null is not an object|Received: undefined|Received: null|is not a function/i
        .test(f.error),
  },
  {
    family: "DIAGNOSTIC-DELTA (a compile error/warning fired or stopped firing)",
    test: (f) => /\bE-[A-Z][A-Z0-9]*-|\bW-[A-Z][A-Z0-9]*-|\bI-[A-Z][A-Z0-9]*-/.test(f.error),
  },
  {
    family: "THROWN (the flip threw out of the compiler, not an assertion)",
    test: (f) => /^(TypeError|ReferenceError|SyntaxError|RangeError):/.test(f.error),
  },
  {
    family: "FIELD-SHAPE-other (value present, wrong shape/content)",
    test: (f) => /^error: expect\(/.test(f.error),
  },
];

/** Axis 2 — SUBJECT, read off the test file + test name. */
const SUBJECTS: Array<{ family: string; test: (f: Failure) => boolean }> = [
  {
    family: "legacy-stage-probe (test-only: asserts on BS/TAB internals)",
    test: (f) =>
      /\/self-host\//.test(f.file) ||
      /block-splitter|split-blocks|ast-builder|tokenizer|\bbs\.test\b/i.test(f.file),
  },
  {
    family: "engine-statechild (engine / state-block children)",
    test: (f) => /engine|state-?child|§51|machine|\bstate\b/i.test(f.file + " " + f.name),
  },
  {
    family: "each-match-promotion",
    test: (f) => /\beach\b|\bmatch\b|promot/i.test(f.file + " " + f.name),
  },
];

function pick(
  buckets: Array<{ family: string; test: (f: Failure) => boolean }>,
  f: Failure,
): string {
  for (const b of buckets) if (b.test(f)) return b.family;
  return "unclassified";
}
const mechanismOf = (f: Failure) => pick(MECHANISMS, f);
const subjectOf = (f: Failure) => pick(SUBJECTS, f);

function tierOf(file: string): string {
  const m = /compiler\/tests\/([^/]+)\//.exec(file);
  return m ? m[1] : "(root)";
}

function histogram(items: string[]): Array<[string, number]> {
  const m = new Map<string, number>();
  for (const i of items) m.set(i, (m.get(i) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

// ---------------------------------------------------------------------------
// Running one side
// ---------------------------------------------------------------------------
function runSide(label: "control" | "flipped"): void {
  const chunks: string[] = [];

  if (RUN_PRETEST) {
    console.log(`  [${label}] compile-test-samples.sh ...`);
    // Deliberately failure-TOLERANT. `bun run test` runs this as the `pretest`
    // lifecycle script and would ABORT the whole run on a non-zero exit; under
    // the flip a sample that no longer compiles is a RESULT, not a reason to
    // produce no measurement at all.
    const pre = spawnSync("bash", [SAMPLE_COMPILE_SH], {
      cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 1 << 28,
    });
    chunks.push(
      `===== pretest (scripts/compile-test-samples.sh) exit=${pre.status} =====\n` +
      (pre.stdout ?? "") + (pre.stderr ?? ""));
    console.log(`  [${label}] pretest exit=${pre.status}`);
  }

  console.log(`  [${label}] bun test ${TIER} ...`);
  const t0 = Date.now();
  // Run through `bash -c` so a multi-path / GLOB --tier expands exactly the way
  // the pre-commit hook's own `bun test ... compiler/tests/*.test.js` does.
  const run = spawnSync("bash", ["-c", `bun test ${TIER}`], {
    cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 1 << 28,
  });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  chunks.push(
    `===== bun test ${TIER} exit=${run.status} =====\n` +
    (run.stdout ?? "") + (run.stderr ?? ""));

  const raw = chunks.join("\n");
  writeFileSync(join(OUT, `${label}.raw.txt`), raw);

  const fails = parseFailures(raw);
  writeFileSync(
    join(OUT, `${label}.fails.txt`),
    fails.map(key).sort().join("\n") + "\n");
  writeFileSync(
    join(OUT, `${label}.errors.tsv`),
    fails.map((f) => `${key(f)}\t${f.error}`).sort().join("\n") + "\n");

  // Persist the run's OWN parameters so `--report` describes what was actually
  // measured rather than whatever flags the reporting invocation happened to use.
  writeFileSync(join(OUT, `${label}.meta.json`), JSON.stringify({
    label, mode: MODE, tier: TIER, pretest: RUN_PRETEST,
    head: (spawnSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" })
      .stdout ?? "").trim(),
    ranAt: new Date().toISOString(), seconds: Number(secs),
  }, null, 2) + "\n");

  const summary = /^\s*(\d+) fail\s*$/m.exec(raw);
  console.log(
    `  [${label}] done in ${secs}s — ${fails.length} (fail) lines parsed` +
    (summary ? `, bun reported ${summary[1]} fail` : "") + "\n");
}

// ---------------------------------------------------------------------------
// Flip / restore
// ---------------------------------------------------------------------------
let originalApi: string | null = null;
let restored = false;

function restoreApi(): void {
  if (originalApi === null || restored) return;
  writeFileSync(API_JS, originalApi);
  const now = readFileSync(API_JS, "utf8");
  if (sha256(now) !== sha256(originalApi)) {
    console.error(
      "\n!!! native-parser-flip-harness COULD NOT RESTORE compiler/src/api.js.\n" +
      `!!! The original bytes are at ${join(OUT, "api.js.orig")}.\n` +
      "!!! Run: git checkout -- compiler/src/api.js\n");
    process.exitCode = 3;
    return;
  }
  restored = true;
  console.log("  [restore] compiler/src/api.js restored byte-identical.");
}

function applyFlip(): void {
  const anchor = ANCHORS[MODE];
  const src = readFileSync(API_JS, "utf8");
  originalApi = src;
  writeFileSync(join(OUT, "api.js.orig"), src);

  const occurrences = src.split(anchor.find).length - 1;
  if (occurrences !== 1) {
    die(
      `anchor for --mode=${MODE} matched ${occurrences} times in compiler/src/api.js ` +
      `(expected exactly 1).\n  anchor: ${anchor.find}\n` +
      `  The routing site moved or was refactored. Re-derive the anchor by SYMBOL ` +
      `(\`useNativeParser\` / \`parser === "scrml-native"\`) and update ANCHORS in this file. ` +
      `Refusing to measure — a harness that patches nothing reports a flip cost of zero.`);
  }
  writeFileSync(API_JS, src.replace(anchor.find, anchor.replace));
  console.log(`  [flip] applied --mode=${MODE}: ${anchor.why}`);
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
function report(): void {
  const controlPath = join(OUT, "control.errors.tsv");
  const flippedPath = join(OUT, "flipped.errors.tsv");
  if (!existsSync(controlPath) || !existsSync(flippedPath)) {
    die(
      `need both ${controlPath} and ${flippedPath}. ` +
      `Run without --control-only / --flip-only, or point --out at a completed run.`);
  }

  // Re-parse from the RAW capture whenever it is present, and rewrite the
  // derived .fails.txt / .errors.tsv from it. The raw log is the primary
  // artifact; the derived sets are a convenience. This means a fix to
  // parseFailures() can be applied to an OLD run with `--report` instead of
  // paying for another ~7-minute suite pass.
  const load = (label: string): Failure[] => {
    const raw = join(OUT, `${label}.raw.txt`);
    if (existsSync(raw)) {
      const fails = parseFailures(readFileSync(raw, "utf8"));
      writeFileSync(join(OUT, `${label}.fails.txt`),
        fails.map(key).sort().join("\n") + "\n");
      writeFileSync(join(OUT, `${label}.errors.tsv`),
        fails.map((f) => `${key(f)}\t${f.error}`).sort().join("\n") + "\n");
      return fails;
    }
    return readFileSync(join(OUT, `${label}.errors.tsv`), "utf8")
      .split("\n").filter(Boolean).map((line) => {
        const [k, error = ""] = line.split("\t");
        const [file, ...rest] = k.split(" :: ");
        return { file, name: rest.join(" :: "), error };
      });
  };

  const env = envExcludedNames();
  const drop = (f: Failure) => env.has(f.name);
  const controlAll = load("control");
  const flippedAll = load("flipped");
  const control = controlAll.filter((f) => !drop(f));
  const flipped = flippedAll.filter((f) => !drop(f));

  const cKeys = new Set(control.map(key));
  const fKeys = new Set(flipped.map(key));
  const NEW = flipped.filter((f) => !cKeys.has(key(f)));
  const GONE = control.filter((f) => !fKeys.has(key(f)));

  const metaPath = join(OUT, "flipped.meta.json");
  const meta = existsSync(metaPath)
    ? JSON.parse(readFileSync(metaPath, "utf8"))
    : { mode: MODE, tier: TIER, pretest: RUN_PRETEST, head: "(unknown)", ranAt: "(unknown)" };

  const L: string[] = [];
  L.push(`# native-parser default-flip meter — \`--mode=${meta.mode}\``);
  L.push("");
  L.push(`- tier: \`${meta.tier}\`  · pretest: ${meta.pretest ? "ON" : "OFF"}`);
  L.push(`- HEAD: \`${meta.head}\`  · flipped run: ${meta.ranAt}`);
  L.push(`- report generated: ${new Date().toISOString()}`);
  L.push("");
  L.push("## The number");
  L.push("");
  L.push("| side | failures | env-excluded dropped |");
  L.push("| --- | --- | --- |");
  L.push(`| CONTROL (unflipped) | **${control.length}** | ${controlAll.length - control.length} |`);
  L.push(`| FLIPPED (native)    | **${flipped.length}** | ${flippedAll.length - flipped.length} |`);
  L.push("");
  L.push(`**flip-attributable NEW failures: ${NEW.length}**`);
  L.push(`**failures that GO AWAY under the flip: ${GONE.length}**`);
  L.push(`net: ${flipped.length - control.length >= 0 ? "+" : ""}${flipped.length - control.length}`);
  L.push("");
  L.push("> A count alone hides a swap; NEW and GONE are reported separately and");
  L.push("> both sets are listed in full below.");
  L.push("");

  L.push("## NEW — axis 1: failure MECHANISM (heuristic over the error line)");
  L.push("");
  for (const [fam, n] of histogram(NEW.map(mechanismOf))) L.push(`- ${n}\t${fam}`);
  L.push("");
  L.push("## NEW — axis 2: SUBJECT (heuristic over file + test name)");
  L.push("");
  for (const [fam, n] of histogram(NEW.map(subjectOf))) L.push(`- ${n}\t${fam}`);
  L.push("");
  L.push("## NEW — by test tier");
  L.push("");
  for (const [t, n] of histogram(NEW.map((f) => tierOf(f.file)))) L.push(`- ${n}\t${t}`);
  L.push("");
  L.push("## NEW — by test file (top 40)");
  L.push("");
  for (const [f, n] of histogram(NEW.map((x) => x.file)).slice(0, 40)) L.push(`- ${n}\t${f}`);
  L.push("");
  L.push("## NEW — by error signature (top 40)");
  L.push("");
  for (const [e, n] of histogram(NEW.map((x) => x.error.slice(0, 120))).slice(0, 40)) {
    L.push(`- ${n}\t${e}`);
  }
  L.push("");
  L.push(`## GONE (${GONE.length}) — full list`);
  L.push("");
  for (const g of GONE.map(key).sort()) L.push(`- ${g}`);
  L.push("");
  L.push(`## NEW (${NEW.length}) — full list`);
  L.push("");
  for (const n of NEW.map(key).sort()) L.push(`- ${n}`);
  L.push("");

  const md = L.join("\n");
  writeFileSync(join(OUT, "delta.md"), md);
  writeFileSync(join(OUT, "new.txt"), NEW.map(key).sort().join("\n") + "\n");
  writeFileSync(join(OUT, "gone.txt"), GONE.map(key).sort().join("\n") + "\n");

  console.log("");
  console.log(md.split("\n").slice(0, 40).join("\n"));
  console.log(`\n  full report: ${join(OUT, "delta.md")}`);
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
function assertApiClean(): void {
  const st = spawnSync("git", ["status", "--porcelain", "--", "compiler/src/api.js"], {
    cwd: REPO_ROOT, encoding: "utf8",
  });
  if ((st.stdout ?? "").trim() !== "") {
    die(
      "compiler/src/api.js is already modified. This harness patches and restores " +
      "that file; refusing to run so it cannot clobber your work. Commit or revert first.");
  }
}

function main(): void {
  mkdirSync(OUT, { recursive: true });

  if (REPORT_ONLY) { report(); return; }

  console.log(`native-parser-flip-harness — mode=${MODE} tier=${TIER} out=${OUT}`);
  console.log("");

  if (!FLIP_ONLY) {
    console.log("CONTROL (unflipped) —");
    runSide("control");
    if (CONTROL_ONLY) {
      console.log("  --control-only: stopping. Re-run with --flip-only then --report.");
      return;
    }
  }

  assertApiClean();
  process.on("SIGINT", () => { restoreApi(); process.exit(130); });
  process.on("SIGTERM", () => { restoreApi(); process.exit(143); });
  try {
    console.log("FLIPPED (native parser) —");
    applyFlip();
    runSide("flipped");
  } finally {
    restoreApi();
  }

  if (CONTROL_ONLY) return;
  if (FLIP_ONLY && !existsSync(join(OUT, "control.errors.tsv"))) {
    console.log("  --flip-only: no CONTROL artifacts present; skipping the report.");
    return;
  }
  report();
}

try {
  main();
} catch (e) {
  restoreApi();
  throw e;
}
