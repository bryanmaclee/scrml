# BRIEF — derived-transitive fix round 6 (S346-bryan dispatch)

DONE-PROBE: git merge-base --is-ancestor "$(git rev-parse --verify --quiet refs/remotes/origin/dtr-r6 2>/dev/null || echo 0000000)" origin/main

## Context — read the WORK ORDER first
`docs/changes/derived-transitive-r6/WORK-ORDER.md` (same dir as this file, COMMITTED, so it is
inside your worktree) is the complete, re-derived round-5 review verdict: **DO-NOT-LAND, 7
findings, 5/5 lenses completed, every finding CONFIRMED by 2-3 independent refuter agents by
execution, 0 refuted.** Read it IN FULL. Every locus in it is REVIEW-LOCATED (verified on
`bf99a93a`) — re-locate the line numbers before editing, they will have drifted.

Frozen round-5 tree: `review/derived-transitive-r5` = `bf99a93a` on branch `dtr-r5` (origin).
The operator authorized round 6 ("we better handle round six next session"). Nothing else is
awaited from him — every fork in the work order is already ruled or PA-decided.

## The ONE thing that must not happen again — the standing constraint (bryan, S345)
**Do not write a codegen-agreement claim, in any form, on any limb.** r3, r4 and r5 each re-minted
one and each was DO-NOT-LAND for it. The only true statement is one-directional CONTAINMENT: *"every
shape codegen would rewrite is refused at compile time."* RI ⊇ codegen's rewrite set, never =. If a
sentence you are writing says "agree", "the same set", "exactly when", "every reference", it is
wrong — write the containment. This applies to SPEC prose, code comments, test names, test comments,
and your progress log.

## MANDATORY for round 6 (priority order = the work order's B1..B7)
1. **B1** — close the parameter-default silent miss (BOTH reasons: params not in the scan root AND
   `defaultValue` stored raw). Executed-artifact pin + a `toEqual([])` control.
2. **B2** — replace the four codegen-agreement sites with the containment claim.
3. **B3** — propagate the provenance/residual/over-fire fixes to `SPEC.md:3304`; then grep-sweep
   every `S345` citation in SPEC + src + tests and keep only what bryan actually ruled.
4. **B4** — the `hop-param` control asserts `toEqual([])`, like its siblings.
5. **B5** — scope or delete the `:462-464` over-claim comment.
6. **B6** — make `:3729` consistent with `:3698`: §6.6.19 closes the SILENT (exit-0) half, and
   the artifact set is still written on the firing path. Say exactly that.
7. **B7** — Trigger 3's identical param-default blind spot: fix as a SEPARATE COMMIT with its own
   pin + its own corpus differential count; STOP-IF-BIGGER per the work order.

Then **RE-VERIFY every residual by COMPILING the shape it describes** (round-5 mandate 6 still
binds — the review found misdescribed residuals twice).

## Explicitly OUT OF SCOPE (report, do not build)
- the DIRECT-limb `prune-server-only-stdlib-chunks` textual leak (`emit-client.ts:2898-2945`) — the
  PA files it as its own arc this session. Do not touch `emit-client.ts` for it.
- lexical scoping (S345 Q1(c), QUEUED; scanner + renamer move together).
- `docs/known-gaps.md` (PA-owned this session).
- a sixth lookaround on the fn-name mangler (maps invariant 43: change the pass's INPUT, not its
  PATTERN).

## MAPS — REQUIRED FIRST READ
Read `.claude/maps/primary.map.md` FIRST (stamp: commit `4f034e13`, 2026-08-11) and follow its
§"Task-Shape Routing" — the rows on regex-over-source-text (invariant 55) and text passes over
emitted JS (invariant 43) both bind this arc. Then `domain.map.md` (route inference / §6.6.19 /
§12.2) and `test.map.md`. Post-map landings to factor in: main moved `4f034e13 → 2709e540`; the
only main commit since the arc's merge-base (`23ea2e5c`) touching an arc file is `#526`
(`emit-client.ts`, `{ once: true }` boot registration — disjoint region; `dtr-r5` rebases onto
`origin/main` with ZERO conflicts, dry-run verified). Treat map content as a verify-against-source
hypothesis. Report the load-bearing finding from the maps, "not load-bearing" included.

## Mechanics (CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE)
- isolation: worktree. FIRST: `pwd` must start with
  `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/`; `git rev-parse --show-toplevel` equals
  it; clean tree. Any failure: STOP + report. Then `bun install`. Then:
  `CUT=$(git rev-parse HEAD)` (the worktree's cut-point = origin/main + this brief's commit), then
  `git fetch origin && git checkout -b dtr-r6 bf99a93a && git rebase "$CUT"` (expected clean —
  dry-run verified against origin/main; if a conflict appears STOP and report the file — do not
  resolve by `--theirs`/`--ours`). After the rebase `docs/changes/derived-transitive-r6/` is in
  your history; if it is not, `git checkout "$CUT" -- docs/changes/derived-transitive-r6/`.
- Edit via Edit/Write on WORKTREE-ABSOLUTE paths only; NEVER write to the main checkout
  (`/home/bryan-maclee/scrmlMaster/scrml/` without `.claude/worktrees/`). No `cd` into main. Use
  `--cwd "$WORKTREE_ROOT"` for bun and `git -C "$WORKTREE_ROOT"` for git. Reproducer `.scrml` files
  go under `$WORKTREE_ROOT/docs/changes/derived-transitive-r6/repro/` or the scratchpad, NEVER the
  repo root (S345 PATH-DISCIPLINE INCIDENT was exactly that).
- Echo pwd in the first commit message. Commit after each unit (WIP fine); append-only
  `docs/changes/derived-transitive-r6/progress-r6.md`; NEVER `--no-verify`; commit timeout ≥ 8 min
  (the hook runs the full gated subset).
- `git push -u origin dtr-r6` after the first substantive commit AND at the end.
- Gates before DONE: all arc pins green (`bun test compiler/tests/unit/route-inference-derived-server-only-reach.test.js`
  + `compiler/tests/conformance/conf-DERIVED-SERVER-ONLY-REACH-artifacts.test.js`); contract gate
  (`bun test compiler/tests/{unit,integration,conformance}`) 0 fail; `bun run scripts/regen-spec-index.ts`
  + `bun scripts/facts.ts --write` regenerated if SPEC.md moved (the currency gates); the
  direction-of-change corpus differential RUN with counts reported for B1 AND separately for B7 (a
  non-zero newly-rejecting count is a FINDING to report, never something to self-ratify past).

## Final report (raw data, not prose for a human)
FINAL_SHA · branch `dtr-r6` · files touched · per-blocker B1..B7: fixed / deferred (+reason) ·
the two differential counts (+ file lists if non-zero) · whether any review-located locus was wrong
(and where the behaviour is actually decided) · the maps load-bearing finding · anything you found
that is NOT in the work order (with an executed reproducer, not a claim).
