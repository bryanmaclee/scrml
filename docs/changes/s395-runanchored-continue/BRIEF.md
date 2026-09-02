# BRIEF — s395-runanchored-continue  (ruling 2a, limb (a) of a SEQUENCED (c))

Close `g-conformance-runanchored-silently-drops-text-attr-value-when-count-is-present` — **limb (a) ONLY.**

## THE RULING (bryan, user-voice S395, "your recs")
**Limb (c), SEQUENCED.** Land **(a)** — remove `runAnchored`'s unconditional `continue` — FIRST,
**verifying the 18 green under the REAL fix rather than the strip-`count` proxy S393 used** (the
proxy strips `count` and skips that check; the real fix runs BOTH, so it is a different predicate).
**(b), the authoring gate, is a SEPARATE follow-on landing and is OUT OF SCOPE here.** Do not build it.

## WHY IT MATTERS (ratified grounds — this is contract integrity, not test hygiene)
§62.2 makes the conformance corpus **the versioned language contract**. An assertion carrying both
`count` and `text`/`attr`/`value` checks only the count — so the contract is weaker than it reads at
18 points, and a compiler could regress the rendered output of all 18 while the suite stayed green.

## THE DEFECT — PA-VERIFIED ON CURRENT MAIN
`conformance/normalize.ts:228-234`: `if (typeof a.count === "number") { …compare count…; continue; }`
The `continue` is **unconditional**, so `text`/`attr`/`value` on that same assertion never run.
PA-measured population, twice: **18 inert assertions across 15 case files.**

⚑ **The entry's instruction that "the 18 must be adjudicated one at a time" was written for a backlog
S393 FALSIFIED (RED 0 · ok 15) and does NOT apply.** Expect zero red — but MEASURE it, do not assume
it, and do not quote this brief as the measurement.

## STARTUP (F4)
1. `pwd` starts with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`; VCS toplevel equals it; tree clean. Else STOP.
2. `git merge-base HEAD origin/main` == `origin/main`.
3. `bun install`. 4. `bun run pretest` PLAINLY from the worktree CWD (`bun --cwd <p> run pretest` silently no-ops, exits 0 — check the artifact, not the code).
5. First commit `WIP(runanchored): start at $(pwd)`.
6. Brief lives on branch `fix/s395-runanchored-continue`: `git fetch origin fix/s395-runanchored-continue && git checkout FETCH_HEAD -- docs/changes/s395-runanchored-continue/`

## PATH DISCIPLINE
Worktree-absolute paths only; never `cd` into main; `git -C "$WORKTREE_ROOT"`. **NEVER `git stash`** —
`refs/stash` is SHARED and other agents are live (4 pre-existing entries prove it). File copies only.
**NEVER a bare `pkill -f`/`killall`.** **NEVER `--no-verify`**; don't touch `core.hooksPath`.
`progress.md` in `docs/changes/s395-runanchored-continue/`, not the repo root.

## SCOPE
IN: the one-line `continue` removal so all four checks run on an assertion, plus whatever minimal
change makes both halves evaluate correctly.
OUT: limb (b) (a hard authoring error + migrating the 18 to separate assertions) — a separate
landing. Any compiler/ change: this is a HARNESS fix, the compiler is not in scope.

## VERIFICATION
**Phase 1 — the 18, under the REAL fix.** Run the full conformance corpus with the fix in. Report
pass/fail. For EACH of the 18 assertions state the case id and whether its newly-evaluated
`text`/`attr`/`value` half passes. **Any red is a finding to report, not to silence** — do NOT edit a
case to make it green without saying so explicitly and why.
**Phase 2 — BITE PROOF, mandatory.** The gate must be shown to fail: corrupt one `text` and one
`attr` among the 18, confirm exactly those two red AND that the failure message reports the real
rendered value, then restore and confirm green. A gate that has never failed is indistinguishable
from one that cannot.
**Phase 3 — population re-count.** Re-derive the 18-across-15 figure yourself from
`conformance/cases/**/expected.json` and report your number and method. If it differs from 18/15,
that is a finding.
**Phase 4** — `bun run test` green; report any failure-set delta vs base by name.

## PROVENANCE (Rule 4b)
`prov=ruling:user-voice-scrml.md S395 — "your recs" adopting limb (c) sequenced; (a) lands first`

## REPORT BACK
worktree path · final SHA · files touched · Phase-1 per-assertion table · Phase-2 bite proof ·
Phase-3 recount + method · Phase-4 suite delta · anything deferred.
