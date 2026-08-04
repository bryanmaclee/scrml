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

async function mergedPRs(limit: number): Promise<Array<{ number: number; title: string; mergedAt: string }>> {
  const proc = Bun.spawn(
    ["gh", "pr", "list", "--state", "merged", "--limit", String(limit),
     "--json", "number,title,mergedAt"],
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
const limit = Number(limitArg ?? 40);

const ledgerFile = Bun.file(LEDGER);
const reviewed = (await ledgerFile.exists())
  ? parseLedger(await ledgerFile.text())
  : new Map<number, Reviewed>();

let merged: Array<{ number: number; title: string; mergedAt: string }>;
try {
  merged = await mergedPRs(limit);
} catch (e) {
  // Never fail a boot on a network/auth hiccup — report and move on. A probe
  // that breaks the boot is a probe that gets removed.
  console.log(`review-debt: UNAVAILABLE (${(e as Error).message})`);
  console.log("  gh unreachable — review debt NOT verified this session. Say so in the boot report.");
  process.exit(0);
}

const bound = merged.filter(p => p.number >= REVIEW_FLOOR_EPOCH);
const owed = bound.filter(p => !reviewed.has(p.number));
const done = bound.filter(p => reviewed.has(p.number));
const carve = done.filter(p => reviewed.get(p.number)!.verdict === "carve-out");

console.log(`review-debt — floor binds PR #${REVIEW_FLOOR_EPOCH}+ · ${bound.length} merged in scope · ${done.length} recorded · ${owed.length} OWED`);

if (bound.length > 0) {
  // §8 absorbed-escape-hatch: a floor whose carve-out rate approaches 100% is
  // decorative. Surface the ratio so it is watchable, not discoverable later.
  const pct = Math.round((carve.length / bound.length) * 100);
  console.log(`  carve-out rate: ${carve.length}/${bound.length} (${pct}%)${pct >= 50 ? "  ⚠️ HIGH — is the floor still doing anything?" : ""}`);
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
