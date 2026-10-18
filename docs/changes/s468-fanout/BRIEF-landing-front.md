# unit-id: s468-landing-front — bring reviewed PRs up to date with main (the landing churn-front)
You do NOT create a branch. For each PR below, IN ORDER, in your worktree:
  git fetch origin <branch> main && git checkout -B <branch> origin/<branch>   (assert HEAD == the listed SHA)
  git merge origin/main   (a merge commit; never rebase — reviewers are pinned to the listed SHAs)
Resolve conflicts as REAL 3-way merges:
 - docs/known-gaps.md: ONLY the `@generated:gap-counts` hunk is regenerated (`bun scripts/state.ts --write`); every
   ENTRY hunk keeps BOTH sides. Before committing: `comm -23 <(git show origin/main:docs/known-gaps.md | grep -o '@gap
   id=[^ ]*' | sort -u) <(grep -o '@gap id=[^ ]*' docs/known-gaps.md | sort -u)` AND the same against the branch's own
   pre-merge file MUST both print nothing (the union rule — S439/S442/S467 each dropped entries by taking one side).
 - docs/FACTS.md: regenerate (`bun scripts/facts.ts --write`). SPEC-INDEX: take main's, re-apply the branch's lines, regen.
 - code conflicts (e.g. compiler/src/codegen/emit-server.ts, route-inference.ts): understand BOTH sides (`git log -p
   <merge-base>..origin/main -- <file>`), keep both intents; if the two changes interact semantically and you cannot
   prove the merged behaviour, STOP that PR and report.
After each merge: run the PR's own test files + `bun compiler/tests/integration/security-await-pack/classify.js` (0
FAIL vs origin/main's current FAIL set — #1434 merged, so main should now be ~0 FAIL; report the number) +
`bun scripts/state.ts --check` + `bun scripts/facts.ts --check`; commit (pre-commit hook, never --no-verify) and push.
Report per PR: new SHA (== ls-remote), conflicts + how resolved, gap-id union check result, test/pack numbers.
QUEUE (stop and report after all, or on any STOP):
 1. PR #1437 `wrap/s468` @ 6008891c7 — docs/maps only (hand-off rotation + 13 maps). Maps stamp stays 5c43c3b8e.
 2. PR #1439 `s468-trigger5-helper-route` @ 42ec64fe7 — reviewed LAND-WITH-FOLLOW-UPS. Its own tests:
    compiler/tests/integration/s468-trigger5-helper-route.test.js; conformance server-db/first-class-fn-ref-server-helper-rt.
 3. PR #1442 `s468-cps-unbound-cluster` @ d48cf9d56 — reviewed LAND-WITH-FOLLOW-UPS. Its own tests: the s468-cps-*
    test files on the branch + the #1435 suites (cps-server-logic-stays-server-s462, s465-cps-pre-first-stays-client,
    s466-cps-guard-stays-server, s467-cps-carried-admission, s467-cps-nested-writes-and-callees, unit
    cps-split-server-tier-s462, conformance server-db/cps-*). If #1439 merges to main before you reach #1442, merge the
    newer main. ⚑ #1439 and #1442 both touch emit-server.ts / route-inference.ts — that is the semantic-interaction risk.
