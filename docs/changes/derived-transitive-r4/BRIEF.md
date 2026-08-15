# BRIEF — derived-transitive fix round 4 (S345-bryan dispatch)

DONE-PROBE: `git rev-parse --verify refs/heads/dtr-r4 >/dev/null 2>&1 && echo ok`

## Context
The S239 re-review of round 3 (frozen `review/derived-transitive-r3` = `896fc7f0`) returned
DO-NOT-LAND: 14/14 findings confirmed by dual independent verification-by-execution, 7 blockers.
Work order (full claims + repros + verifier evidence + spec-lens drafts):
`/tmp/claude-1000/-home-bryan-maclee-scrmlMaster-scrml/570009d2-6293-46f4-a863-e734bc3dcec2/scratchpad/dtr-r4/WORK-ORDER.json`
Read it IN FULL before any edit (parse with node; it is large — extract per-finding).

Root cause family: the same-file shadow suppression is SCOPE-BLIND in both limbs (a branch-local
`const doHash = ...` suppresses a genuine sibling-branch reach → exit 0, Promise rendered), the
`let f = doHash` / object-member / arrow alias forms were falsely claimed already-refused, and
codegen resolves shadowing in the OPPOSITE direction from route-inference (rewrites even shadowed
call sites to fetch stubs → the SPEC-blessed shadow case itself miscompiles, HIGH).

## Bryan-ruled constraints (binding)
1. **Q1 (c):** the F3 §6.6.19 rewrite is DESCRIPTIVE of current impl, NOT a ratification. Insert the
   provenance annotation (a draft is in the work order's spectext notes) citing main's pre-arc
   sentence as governing design intent. Full lexical scoping is QUEUED — do NOT build it this round.
2. **Fail-closed over silent-leak** (the arc's own recorded rule: too-wide shadow = silent leak,
   forbidden; too-narrow = loud fixable over-fire, acceptable). Given (1), the coherent interim is:
   same-file name shadowing does NOT suppress the refusal — any reference fires — UNLESS you can make
   a narrower shadow provably scope-correct cheaply. Either way it is newly-REJECTING: run the corpus
   direction-of-change differential (the arc's own harness, both trees) and REPORT the migration
   count. A non-zero count is a finding to report, never something you self-ratify past.
3. **RI and codegen must AGREE** after the fix. Add executed-artifact assertions: for every shadow
   shape in the final semantics, compile and assert the emitted client either refuses at compile time
   or contains NO async stub bound into a derived recompute.
4. SPEC repairs (all in the work order): STRIKE the smuggled §12.2 Trigger-3 language-wide SHALL
   (unruled — restore the ruled scope); resolve the §6.6.19 double-statement contradiction; fix the
   worked example's "calls" wording (reaches-never-calls SHALL); record the unparseable-RHS decline
   as an explicit residual; fix the false already-refused-via-5b in-code justification comment;
   fix the weak-witness 2359-population sentence; fix the caller-context terminus sentence;
   unify the body-style-dependent refusal (block-bodied vs expression arrow).
5. **Do NOT touch docs/known-gaps.md** (a concurrent landing owns it). The pre-existing direct-limb
   confidentiality leak (cross-arm shadow) is REPORT-ONLY: do not fix, return it in your final report.
6. New pins from the blockers' reproducers: if-sibling shadow-miss, while-shadow, match-arm sibling,
   the three alias forms (`let f = doHash` / `let api = {run: doHash}` / `let g = (p) => doHash(p)`),
   RHS-local-shadow with artifact assertion. Update existing shadow pins (§7/§11d/§11e/§11f) to the
   final semantics with a rationale comment citing this round.

## Mechanics
- isolation: worktree. STARTUP: pwd prefix `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`;
  toplevel equals it; clean tree; `bun install`; then `git checkout -b dtr-r4 896fc7f0` (the round-3
  tip, on origin). Work ON that continuation branch.
- Edit via Edit/Write on worktree-absolute paths only; never touch the main checkout. Echo pwd in the
  first commit message. Commit after every meaningful unit (WIP fine); progress.md append-only;
  NEVER --no-verify; commit timeout ≥ 8 min (full-suite hook).
- Push the branch (`git push -u origin dtr-r4`) after the first substantive commit and at the end.
- Gates before DONE: all pins green (94 + new); contract gate (unit+integration+conformance) 0 fail;
  the direction-of-change differential run + counts reported; executed-artifact checks pass.

## Final report
FINAL_SHA · branch · files touched · pin count before/after · contract-gate counts ·
direction-of-change counts (newly-rejecting list if non-zero) · the report-only confidentiality
finding restated · which work-order findings you fixed / deferred (with reasons) · whether any
PA/review-asserted locus was wrong.
