// scripts/types-gate.ts — the TypeScript diagnostic NAME-SET gate. change-id: s365-types-gate
//
// THREE MODES (mirrors scripts/browser-baseline.ts / state.ts / facts.ts exactly — same flags,
// same exit semantics):
//   `bun scripts/types-gate.ts`         PRINT  — typecheck, report the current diagnostic set.
//   `bun scripts/types-gate.ts --write` WRITE  — record the current NAME SET as the baseline.
//   `bun scripts/types-gate.ts --check` CHECK  — typecheck, diff against the baseline; exit 1 on
//                                                ANY difference, in either direction.
//
// ═══ WHY THIS EXISTS, AND IT IS NOT A STYLE GATE ═══
//
// scrml's compiler is written in TypeScript and, until S365, NOTHING EVER TYPE-CHECKED IT. There was
// no `tsconfig.json`, `typescript` was not a dependency, no `tsc` invocation existed in
// `package.json`, `scripts/`, `.github/`, or either git hook. bun executes `.ts` transpile-only: it
// strips the types and runs the JavaScript. Every type annotation in `compiler/src` was, in effect,
// a comment. (`.github/workflows/ci.yml`'s own gate-layering header claimed a layer
// "types (always-on local)". That layer did not exist.)
//
// THE MEASUREMENT THAT MADE THIS URGENT. At the moment this script was written, `tsc --noEmit` over
// `compiler/src/type-system.ts` reported NINE instances of an exhaustive-switch `never` fallthrough
// already failing, all in `expression-parser.ts`:
//
//     Type 'MarkupValueExpr' is not assignable to type 'never'.   (×8, plus one MapLitExpr)
//
// `MarkupValueExpr` had been added to the `ExprNode` union and NINE exhaustive switches were never
// updated. The decay-stopper those switches exist to be FIRED, correctly, for however long that has
// been true — and it was completely invisible, because nothing ran the checker. Each of those nine
// is a real "this expression form silently falls through to the default arm" bug.
//
// That is pa-base §8's failure mode in its purest form: **a gate that has never failed is
// indistinguishable from a gate that CANNOT fail.** And it is the same defect S365's asIs/unknown
// split exists to close, one level up — *absence of a diagnostic* and *success* were the same
// observation, this time about the compiler's own source.
//
// Building a tenth `never` fallthrough (SPEC §7.5, `inferExprType`) without arming the checker would
// have reproduced that defect rather than closed it. Hence this script.
//
// ═══ WHY A NAME SET AND NOT AN EXIT CODE ═══
//
// `tsc --noEmit` over this tree exits non-zero and will keep doing so until the pre-existing
// population is drained. An always-red gate is the cry-wolf shape that gets bypassed and then
// deleted (S301), so gating on exit code is not available. The NAME SET is: `--check` goes red the
// moment a diagnostic JOINS or LEAVES the set, which is a condition a gate CAN carry — the identical
// reasoning, and the identical mechanism, that S313 ratified for the browser tier.
//
// THE BASELINE IS A NAME->COUNT MAP, NOT A BARE SET, AND THAT WAS A CORRECTION. The first cut here
// recorded a bare name set, and because the key strips line numbers (see below), the NINE
// `MarkupValueExpr` fallthroughs collapsed into ONE entry. A tenth would then have joined an entry
// that already existed and the gate would have stayed GREEN — a count-blind gate on a defect class
// whose whole signal is "how many switches did this member fall through". Counts are compared per
// name; a name whose count GROWS is red exactly as a new name is.
//
// DETERMINISM IS THE HARD CONSTRAINT. The key is `<relative file> :: <TS code> :: <message head>`.
// Deliberately stripped:
//   - LINE AND COLUMN. This is the load-bearing exclusion. Inserting 250 lines into a 27k-line file
//     shifts every downstream diagnostic's line number; keying on position would turn every edit
//     into a full baseline rewrite, and a baseline rewritten on every commit asserts nothing. (This
//     was measured, not assumed: the S365 landing shifted ~20 diagnostics by exactly the size of the
//     inserted block and changed no diagnostic's meaning.)
//   - CONTINUATION LINES. `tsc` indents the elaboration under a diagnostic; the head line carries
//     the identity, the elaboration carries volume.
//   - ABSOLUTE PATHS. `tsc` prints absolute paths inside some messages; they differ per checkout.
//
// BIDIRECTIONAL BY DESIGN, same as the browser baseline:
//   - NEW entries   → a regression, OR the `never` fallthrough biting on a node kind nobody handled.
//                     This is the case the tree could not previously report at all.
//   - FIXED entries → the baseline is STALE. A baseline nobody prunes silently re-acquires the blind
//                     spot it was built to remove.
//
// ═══ WHAT THIS IS NOT ═══
//
// It is NOT a "make the compiler tsc-clean" campaign. The pre-existing population is recorded as-is
// and drains through ordinary work — exactly the SPEC §34.0 posture toward the legacy error-code
// catalog, and for the same reason (a gate instantly red for reasons no change caused gets bypassed,
// then deleted). It asserts one thing: **that the population does not grow silently.**
//
// WHERE IT RUNS (S365 fix round). It landed runnable and NOTHING RAN IT, while `ci.yml`'s header
// advertised a layer named "types (always-on local)" that did not exist — this script's own thesis,
// reproduced one level up. It is now wired into the NON-BLOCKING `tracking` job in
// `.github/workflows/ci.yml`, as a `continue-on-error` step placed first (a failed step halts even a
// continue-on-error job, so it must not be able to suppress the tracking signals below it).
//
// PROMOTION INTO THE BLOCKING `gate` JOB IS STILL NOT TAKEN. That is an operator-level call and it
// wants a decision on the nine live `never` failures first (fix them, or record them and drain).
// One line moves it: the same step, without `continue-on-error`, under `gate`.

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname, relative } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_PATH = join(REPO_ROOT, "compiler/tests/TYPES-BASELINE.json");

// The roots handed to `tsc`. `tsc` follows imports, so these two transitively pull in essentially
// all of `compiler/src` — verified, not assumed: the diagnostic set names 8+ distinct source files
// neither of these is. Naming roots rather than a glob keeps the run bounded and fast (~30s) and
// keeps the set stable when a new file lands unreferenced.
const ROOTS = [
  "compiler/src/type-system.ts",
  "compiler/src/codegen/index.ts",
];

// Matches `path/to/file.ts(123,45): error TS2322: <message>`.
// NOT anchored with `$` — the message runs to end of line and may contain anything.
const DIAG_RE = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/;

/**
 * Reduce one `tsc` diagnostic line to a POSITION-INDEPENDENT identity.
 * Returns null for continuation/elaboration lines and for anything unparseable.
 */
function toName(line: string): string | null {
  const m = DIAG_RE.exec(line);
  if (!m) return null;
  const [, file, , , code, message] = m;
  // `tsc` embeds absolute paths inside some messages (module-resolution errors especially).
  // Strip the checkout root so the key is the same on every machine.
  const portableMessage = message.split(REPO_ROOT + "/").join("").split(REPO_ROOT).join("");
  const portableFile = file.startsWith("/") ? relative(REPO_ROOT, file) : file;
  return `${portableFile} :: ${code} :: ${portableMessage}`;
}

function resolveTsc(): string | null {
  const local = join(REPO_ROOT, "node_modules/.bin/tsc");
  if (existsSync(local)) return local;
  // Deliberately NO PATH fallback and NO skip-when-absent. A gate that quietly passes when its tool
  // is missing is the exact defect this file exists to close, and a PATH-resolved tool makes the
  // result depend on whoever's shell ran it. `typescript` is a devDependency; `bun install` is the
  // fix, and the message below says so.
  return null;
}

function runTsc(): { counts: Map<string, number>; raw: string } {
  const tsc = resolveTsc();
  if (!tsc) {
    console.error(
      "types-gate: node_modules/.bin/tsc not found.\n" +
      "  `typescript` is a devDependency of this repo. Run `bun install`.\n" +
      "  This gate deliberately does NOT fall back to a PATH `tsc` and does NOT skip when the\n" +
      "  tool is missing — a gate that passes without running is worse than no gate.",
    );
    process.exit(2);
  }
  const res = spawnSync(
    tsc!,
    [
      "--noEmit",
      "--target", "esnext",
      "--module", "preserve",
      "--moduleResolution", "bundler",
      "--allowImportingTsExtensions",
      "--skipLibCheck",
      "--strict",
      ...ROOTS,
    ],
    { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const raw = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  const counts = new Map<string, number>();
  for (const line of raw.split("\n")) {
    const n = toName(line);
    if (n) counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  return { counts, raw };
}

function readBaseline(): Map<string, number> {
  const out = new Map<string, number>();
  if (!existsSync(BASELINE_PATH)) return out;
  try {
    const parsed = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
    for (const [k, v] of Object.entries(parsed.diagnostics ?? {})) out.set(k, v as number);
  } catch {
    // A corrupt baseline is not a silent pass — `--check` treats an empty map as
    // "everything is new" and goes red, which is the correct direction to fail.
  }
  return out;
}

const NEVER_MARKER = "is not assignable to type 'never'";

function neverTotal(counts: Map<string, number>): number {
  let n = 0;
  for (const [k, v] of counts) if (k.includes(NEVER_MARKER)) n += v;
  return n;
}

function total(counts: Map<string, number>): number {
  let n = 0;
  for (const v of counts.values()) n += v;
  return n;
}

const mode = process.argv.includes("--check") ? "check"
  : process.argv.includes("--write") ? "write"
  : "print";

const { counts } = runTsc();
const sorted = [...counts.keys()].sort();

const NEVER_NOTE =
  "      ^ EXHAUSTIVE-SWITCH DECAY. A member was added to a discriminated union and a switch\n" +
  "        over it was not updated, so that member now falls through to the default arm.\n" +
  "        Add the missing `case`. Do NOT widen the fallthrough and do NOT cast it away —\n" +
  "        the `never` assignment is the coverage invariant, enforced by the type checker\n" +
  "        instead of by a reviewer's attention (SPEC §7.5).";

if (mode === "write") {
  const obj: Record<string, number> = {};
  for (const n of sorted) obj[n] = counts.get(n)!;
  writeFileSync(BASELINE_PATH, `${JSON.stringify({
    "//": "TypeScript diagnostic NAME->COUNT baseline. See scripts/types-gate.ts for why this is a " +
          "name set and not an exit code, and why it carries counts. Regenerate with " +
          "`bun scripts/types-gate.ts --write`. A NEW name or a GROWN count is a regression; a " +
          "REMOVED name or a SHRUNK count means this file is stale and should be regenerated in " +
          "the commit that fixed it.",
    "//never": "Entries containing \"is not assignable to type 'never'\" are LIVE EXHAUSTIVE-SWITCH " +
               "DECAY — a member was added to a union and a switch over it was not updated, so it " +
               "silently falls through to the default arm. They are recorded so the population " +
               "does not GROW. Each is a real bug and each should be FIXED, not inherited.",
    totalDiagnostics: total(counts),
    distinctNames: sorted.length,
    neverFallthroughOccurrences: neverTotal(counts),
    diagnostics: obj,
  }, null, 2)}\n`);
  console.log(`types-gate: wrote ${total(counts)} diagnostics (${sorted.length} distinct) to ${relative(REPO_ROOT, BASELINE_PATH)}`);
  console.log(`  of which ${neverTotal(counts)} are live exhaustive-switch \`never\` failures.`);
  process.exit(0);
}

if (mode === "print") {
  console.log(`types-gate: ${total(counts)} TypeScript diagnostics (${sorted.length} distinct) across roots [${ROOTS.join(", ")}]`);
  const nt = neverTotal(counts);
  if (nt > 0) {
    console.log(`\n  ${nt} LIVE exhaustive-switch \`never\` failure(s) — a union member nobody handled:`);
    for (const n of sorted) if (n.includes(NEVER_MARKER)) console.log(`    ${counts.get(n)}x  ${n}`);
  }
  console.log("");
  for (const n of sorted) console.log(`  ${counts.get(n)}x  ${n}`);
  process.exit(0);
}

// --- check ---
if (!existsSync(BASELINE_PATH)) {
  console.error(
    `types-gate: no baseline at ${relative(REPO_ROOT, BASELINE_PATH)}.\n` +
    "  Run `bun scripts/types-gate.ts --write` to record the current set.",
  );
  process.exit(2);
}
const baseline = readBaseline();

const added = sorted.filter(n => !baseline.has(n));
const grown = sorted.filter(n => baseline.has(n) && counts.get(n)! > baseline.get(n)!);
const removed = [...baseline.keys()].filter(n => !counts.has(n)).sort();
const shrunk = [...baseline.keys()].filter(n => counts.has(n) && counts.get(n)! < baseline.get(n)!).sort();

if (added.length === 0 && grown.length === 0 && removed.length === 0 && shrunk.length === 0) {
  console.log(`types-gate: OK — ${total(counts)} diagnostics (${sorted.length} distinct), unchanged.`);
  process.exit(0);
}

if (added.length > 0 || grown.length > 0) {
  console.error(`\ntypes-gate: ${added.length} NEW and ${grown.length} GROWN TypeScript diagnostic(s) — this is a regression.\n`);
  for (const n of added) {
    console.error(`  + ${counts.get(n)}x  ${n}`);
    if (n.includes(NEVER_MARKER)) console.error(NEVER_NOTE);
  }
  for (const n of grown) {
    console.error(`  ^ ${baseline.get(n)} -> ${counts.get(n)}  ${n}`);
    if (n.includes(NEVER_MARKER)) console.error(NEVER_NOTE);
  }
}

if (removed.length > 0 || shrunk.length > 0) {
  console.error(`\ntypes-gate: ${removed.length} name(s) gone and ${shrunk.length} count(s) down — the baseline is STALE.\n`);
  for (const n of removed) console.error(`  - ${baseline.get(n)}x  ${n}`);
  for (const n of shrunk) console.error(`  v ${baseline.get(n)} -> ${counts.get(n)}  ${n}`);
  console.error(
    "\n  Fixing a diagnostic is good news. Record it in the SAME commit that fixed it:\n" +
    "    bun scripts/types-gate.ts --write\n" +
    "  A baseline nobody prunes silently re-acquires the blind spot it was built to remove.",
  );
}

process.exit(1);
