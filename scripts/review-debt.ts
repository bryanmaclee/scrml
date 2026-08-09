#!/usr/bin/env bun
/**
 * review-debt.ts — which MERGED PRs still owe the S239 adversarial review?
 *
 * WHY THIS EXISTS (S316). The review floor (S313: "if it isnt us that makes the
 * changes, we should at least do a thorough review on it") had a 0% execution
 * rate the day after it was ratified — EIGHT PRs merged in one day, all with
 * zero reviews, and nobody noticed until bryan asked.
 *
 * The mechanism failure was structural, not a lapse: boot step 0.6 runs
 * `gh pr list`, which reports OPEN PRs. The floor binds MERGED ones. Nothing
 * anywhere computed the difference, so the obligation was invisible to the
 * session that incurred it AND to every session after it. An obligation no
 * probe can see is an obligation that does not exist (the S262 `gh issue list`
 * shape, recurring in a second channel).
 *
 * DESIGN CONSTRAINTS (pa-base §8 gate-design + §2 detection-is-a-ratio):
 *   - DETECTION, NOT CONTROL. This never blocks a merge. bryan takes the
 *     detection over the control every time (S313 review-floor refinement);
 *     a pre-approval gate was explicitly rejected as too slow.
 *   - NOT A CI GATE. Wiring this red-over-backlog into CI is the §8 cry-wolf
 *     shape: instantly red for reasons no change caused → bypassed → deleted.
 *     It runs at BOOT and reports. `--check` exists for a human, not a hook.
 *   - DETERMINISTIC INPUT. Derives only from merged-PR state + an in-repo
 *     ledger. No wall-clock, no counts that move on their own.
 *   - MACHINE-READABLE MARKER. The ledger is parsed, never prose-grepped —
 *     the §2 v2.9 lesson (a prose-only locus made >half the recorded
 *     "violations" the probe's blind spot, not the filer's).
 *
 * THE MARKER. `docs/pr-reviews.md`, append-only, one line per reviewed PR:
 *
 *   <!-- @review pr=385 verdict=clean by=S316-bryan date=2026-08-03 probe=confidentiality-leak -->
 *
 * verdict: clean | finding | carve-out
 *   clean     — adversarial pass run, nothing found.
 *   finding   — pass run, something found; `note=` names it.
 *   carve-out — pure docs/spec-text/config with no code path (pa-base §8
 *               carve-out). Still recorded, so the SKIP RATE is measurable —
 *               a floor whose carve-out rate approaches 100% is decorative
 *               (§8 absorbed-escape-hatch).
 *
 * EPOCH. The floor binds PRs merged at or after REVIEW_FLOOR_EPOCH. History
 * before it is out of scope by construction rather than by exemption, so the
 * probe is never red for work predating the rule.
 *
 * Usage:
 *   bun scripts/review-debt.ts            # report (boot step)
 *   bun scripts/review-debt.ts --check    # exit 1 if any debt (human use)
 *   bun scripts/review-debt.ts --limit 60 # widen the merged-PR scan
 */

/** First PR the review floor binds. Everything earlier predates the rule. */
const REVIEW_FLOOR_EPOCH = 385;

const LEDGER = "docs/pr-reviews.md";

type Reviewed = { pr: number; verdict: string; by: string; note?: string };

function parseLedger(text: string): Map<number, Reviewed> {
  const out = new Map<number, Reviewed>();
  // Parse the MARKER, never the prose. An entry that is not in this shape is
  // not an entry — same discipline as scripts/state.ts on `@gap`.
  const re = /<!--\s*@review\s+([^>]*?)-->/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const bag: Record<string, string> = {};
    for (const kv of m[1].trim().split(/\s+/)) {
      const i = kv.indexOf("=");
      if (i > 0) bag[kv.slice(0, i)] = kv.slice(i + 1);
    }
    const pr = Number(bag.pr);
    if (!Number.isFinite(pr)) continue;
    out.set(pr, { pr, verdict: bag.verdict ?? "?", by: bag.by ?? "?", note: bag.note });
  }
  return out;
}

/**
 * A path that puts a PR in the CODE-BEARING bucket — the population where a
 * carve-out is genuinely suspicious and the target rate is ~0%.
 *
 * Deliberately the set named in the overlay's `{{verify_fills}}` carve-out
 * clause, and deliberately a WHITELIST of directories rather than a blacklist
 * of doc extensions: a new docs directory should default to "not code", while a
 * new source directory must be added here consciously. `docs/` is excluded even
 * though it holds `docs/changes/**` briefs, because a brief has no runtime
 * surface; `scripts/` is INCLUDED because a probe defect is exactly the class
 * this floor exists to catch (S328 found three in one session).
 */
const CODE_BEARING_RE = /^(compiler|stdlib|scripts)\/|^conformance\/cases\//;

type PR = { number: number; title: string; mergedAt: string; files?: Array<{ path: string }> };

/** `true` code-bearing · `false` docs-only · `null` file list unavailable. */
function isCodeBearing(p: PR): boolean | null {
  if (!p.files || p.files.length === 0) return null;
  return p.files.some(f => CODE_BEARING_RE.test(f.path));
}

async function mergedPRs(limit: number): Promise<Array<PR>> {
  const proc = Bun.spawn(
    ["gh", "pr", "list", "--state", "merged", "--limit", String(limit),
     "--json", "number,title,mergedAt,files"],
    { stdout: "pipe", stderr: "pipe" },
  );
  const text = await new Response(proc.stdout).text();
  const code = await proc.exited;
  if (code !== 0) {
    const err = await new Response(proc.stderr).text();
    throw new Error(`gh pr list failed (exit ${code}): ${err.trim()}`);
  }
  return JSON.parse(text);
}

const args = new Set(Bun.argv.slice(2));
const limitArg = Bun.argv.find((a, i) => Bun.argv[i - 1] === "--limit");
const limit = Number(limitArg ?? 150);  // 150 clears the current epoch in ONE gh call; auto-widen below covers growth

const ledgerFile = Bun.file(LEDGER);
const reviewed = (await ledgerFile.exists())
  ? parseLedger(await ledgerFile.text())
  : new Map<number, Reviewed>();

let merged: Array<PR>;
try {
  merged = await mergedPRs(limit);
} catch (e) {
  // Never fail a boot on a network/auth hiccup — report and move on. A probe
  // that breaks the boot is a probe that gets removed.
  console.log(`review-debt: UNAVAILABLE (${(e as Error).message})`);
  console.log("  gh unreachable — review debt NOT verified this session. Say so in the boot report.");
  process.exit(0);
}

// ⚑ The scan is widened BEFORE anything is counted. Computing `bound` first and
// widening after would leave every figure derived from the pre-widen list while
// the widen message claimed otherwise — the exact defect this guard exists to
// prevent, one level up.
//
// TRUNCATION GUARD (§8 truncated probe) — and the completeness test is NOT
// "was the list full".
//
// `gh pr list --limit N` returns at most N rows, so a full list may have been
// cut, and a cut enumeration reads exactly like a complete one. But a full list
// is only a PROBLEM if the cut could have removed an IN-SCOPE PR. Once the scan
// has seen a single PR numbered BELOW the epoch, it has provably reached past
// the floor's boundary and the in-scope population is complete no matter how
// many rows came back.
//
// Written the naive way first (`merged.length >= limit`) this fired at
// --limit 300 while the in-scope count had been stable at 90 since --limit 100 —
// a guard red for reasons no change caused, which is the cry-wolf shape §8 says
// gets bypassed and then deleted. Caught by proving the bite, which is what
// proving the bite is for.
const scanReachedPastEpoch = () => merged.some(p => p.number < REVIEW_FLOOR_EPOCH);

// AUTO-WIDEN: detection alone would leave every caller to notice a warning and
// re-run by hand. Widen until the scan provably clears the epoch. Root fix, not
// a louder warning. The ceiling stops a runaway on a repo with no pre-epoch PRs.
const WIDEN_CEILING = 1000;
let widened = limit;
while (!scanReachedPastEpoch() && merged.length >= widened && widened < WIDEN_CEILING) {
  widened = Math.min(widened * 4, WIDEN_CEILING);
  try {
    merged = await mergedPRs(widened);
  } catch {
    break; // keep whatever we have; the guard below reports the uncertainty
  }
}
if (widened !== limit && scanReachedPastEpoch()) {
  console.log(`  (scan auto-widened ${limit} → ${widened} to clear the floor epoch)`);
}
const truncated = !scanReachedPastEpoch();

// Every count below derives from the (possibly widened) list — never from the
// first fetch.
const bound = merged.filter(p => p.number >= REVIEW_FLOOR_EPOCH);
const owed = bound.filter(p => !reviewed.has(p.number));
const done = bound.filter(p => reviewed.has(p.number));
const carve = done.filter(p => reviewed.get(p.number)!.verdict === "carve-out");

console.log(`review-debt — floor binds PR #${REVIEW_FLOOR_EPOCH}+ · ${bound.length} merged in scope · ${done.length} recorded · ${owed.length} OWED`);

if (truncated) {
  console.log(`  ⚠️ SCAN MAY BE TRUNCATED — ${merged.length} rows and none below #${REVIEW_FLOOR_EPOCH}.`);
  console.log(`     In-scope PRs could be missing from every count above and below. Re-run with --limit ${widened * 2}.`);
}

if (bound.length > 0) {
  // §8 absorbed-escape-hatch: a floor whose carve-out rate approaches 100% is
  // decorative. Surface the ratio so it is watchable, not discoverable later.
  //
  // ⚑ TWO RATES, and only the second one is a health signal (S328 measurement,
  // S331 build). The all-PR rate CANNOT distinguish a docs-heavy stretch from a
  // floor being evaded: a wrap/continuity/gap-filing PR has no code path to
  // review BY CONSTRUCTION, so its carve-out is the CORRECT classification, not
  // an escape. Measured S328: all-PR 57% while every code-bearing PR in scope
  // had received a full pass; code-bearing was 1/28 = 4%, and the single
  // exception was `scripts/review-debt.ts` itself. Re-measured S331: all-PR 50%,
  // code-bearing 0/4. So the all-PR figure is a VOLUME statistic and is printed
  // without an alarm; the alarm rides the code-bearing rate, where the target is
  // ~0% and any carve-out is genuinely suspicious.
  const codeBearing = bound.filter(p => isCodeBearing(p) === true);
  const unknown = bound.filter(p => isCodeBearing(p) === null);
  const cbCarve = codeBearing.filter(p => reviewed.get(p.number)?.verdict === "carve-out");

  const pct = Math.round((carve.length / bound.length) * 100);
  console.log(`  carve-out rate (all PRs, volume statistic): ${carve.length}/${bound.length} (${pct}%)`);

  if (codeBearing.length > 0) {
    // THRESHOLD IS A COUNT, NOT A PERCENTAGE, because the target is ~0% and a
    // percentage floor scales the tolerance with the population — at 36 in scope
    // a 20% trigger silently permits SEVEN carved code-bearing PRs. Proven by
    // bite test S331: five injected carve-outs reached 17% and did NOT fire.
    //
    // Two is the trigger because exactly one standing exception is expected and
    // legitimate — `#397`, this script itself, which has no code path a review
    // could probe. Two is a pattern. The carved list prints unconditionally
    // regardless, so nothing hides below the threshold.
    const cbPct = Math.round((cbCarve.length / codeBearing.length) * 100);
    console.log(`  carve-out rate (CODE-BEARING — the health signal): ${cbCarve.length}/${codeBearing.length} (${cbPct}%)${cbCarve.length >= 2 ? "  ⚠️ HIGH — more than one code-bearing PR carved out; read the probe= on each" : ""}`);
    if (cbCarve.length > 0) {
      for (const p of cbCarve) console.log(`      carved: #${p.number}  ${p.title.slice(0, 72)}`);
    }
  } else {
    console.log(`  carve-out rate (CODE-BEARING): no code-bearing PRs in scope`);
  }

  // Report the unclassifiable population rather than folding it into either
  // bucket — an absent file list is not evidence of docs-only.
  if (unknown.length > 0) {
    console.log(`  ⚠️ ${unknown.length} of ${bound.length} PRs had no file list from gh — excluded from the code-bearing rate, NOT assumed docs-only.`);
  }
}

if (owed.length === 0) {
  console.log("  ✅ no review debt");
} else {
  console.log("");
  for (const p of owed) {
    console.log(`  ⚠️ OWED  #${p.number}  ${p.title.slice(0, 88)}`);
  }
  console.log("");
  console.log(`  Run the S239 pass on each, then append to ${LEDGER}:`);
  console.log(`  <!-- @review pr=<n> verdict=clean|finding|carve-out by=S<N>-<who> date=<ISO-date> probe=<what-you-probed> -->`);
}

if (args.has("--check") && owed.length > 0) process.exit(1);
