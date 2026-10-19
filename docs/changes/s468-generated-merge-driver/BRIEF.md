# BRIEF — s468-generated-merge-driver

Verbatim copies of the two dispatch briefs (COMMON.md, then BRIEF-merge-driver.md) from docs/changes/s468-fanout/.

---

# S468 fan-out — COMMON BRIEF (every S468 dev dispatch reads this IN FULL, then its own BRIEF-<unit>.md)

You are `scrml-js-codegen-engineer` on the scrml compiler (TS impl#1, Bun). Normative source: `compiler/SPEC.md`
(reach sections via `compiler/SPEC-INDEX.md` + offset/limit reads). PRIMER/derived docs are NOT normative.

## STARTUP VERIFICATION + PATH DISCIPLINE (before ANY write)
1. `pwd` MUST start with `/home/bmacs/scrmlMaster/scrml/.claude/worktrees/agent-` → WORKTREE_ROOT; `git rev-parse
   --show-toplevel` == it; tree clean; `git merge-base HEAD origin/main` == `git rev-parse origin/main`. Else STOP.
2. NEVER cd into or write under `/home/bmacs/scrmlMaster/scrml` outside your worktree. There is NO path-discipline hook
   on this machine — you are the guard. Absolute WORKTREE_ROOT paths for every Edit/Write. `bun --cwd=` needs the `=`.
3. NEVER `git stash`. NEVER `pkill -f`/`killall` — kill only PIDs you captured.
4. `TMPDIR=$HOME/.cache/scrml-agent-tmp/<unit-id>` per command; never /tmp, never inside a repo.
5. `bun install` then `bun run pretest` (plain, from WORKTREE_ROOT) — browser fixtures are gitignored.
6. Create your branch `s468-<unit-id>` from origin/main. First commit: `WIP(<unit-id>): start at $(pwd)`.
   **PUSH AFTER EVERY COMMIT** (`git push -u origin s468-<unit-id>`). Keep `docs/changes/<unit-id>/progress.md`
   (append-only, timestamped). Copy your brief verbatim to `docs/changes/<unit-id>/BRIEF.md` in your first commit.
7. Commits run the pre-commit hook (~15-22 min on this machine; 8 agents share it). Before each commit check
   `free -g` available ≥ 6; if not, wait (bounded: 10 tries × 60 s, then commit anyway and note it). Foreground, long
   timeout. NEVER `--no-verify`. If the hook fails on something you did not touch, prove it fails identically on an
   origin/main archive and report — do not bypass.

## MAPS — REQUIRED FIRST READ
`.claude/maps/primary.map.md` — stamp `5c43c3b8e` (refreshed S468; equals origin/main). Follow its Task-Shape Routing
to the 2-4 maps for your task. Map loci are hypotheses: verify against source. Report whether maps were load-bearing.

## HOW TO WORK
- **Reproduce first, on current origin/main** (a version-stamped `.scrml` reproducer + compile command + expected vs
  actual, EXECUTED, not eyeballed). If it does not reproduce: classify NOT-REPRODUCED with evidence, sweep 3+ shapes,
  report, stop.
- **The locus in your brief is PA-located-verify** (copied from a gap marker, produced by search not trace). Trace
  from entry point to the decision. Report whether the hypothesis held, was refined, or was wrong.
- **Governing-sentence gate:** before changing what a program means or whether it is accepted, QUOTE the governing
  SPEC sentence with § in progress.md. If none exists ("searched §X, §Y — no governing sentence"), STOP and report:
  that is a ruling for the owner, not a fix.
- **Direction of change:** classify inert / newly-rejecting / newly-accepting / semantics-changed. Newly-ACCEPTING
  without a pre-existing normative sentence → STOP, report. Newly-rejecting → MEASURE the corpus by compiling
  (`scripts/corpus-emit-differential.ts`; roots examples, samples, conformance/cases, stdlib) and report the count;
  non-zero real (non-test-fixture) sites → STOP and report before landing.
- **Fix the ROOT, not the position.** If round after round finds a new position, change the boundary (admit only
  what is provably safe), say so.
- **No regex over source text in a post-AST stage** (type-system, symbol-table, dependency-graph, route-inference,
  codegen/*) without a one-line justification — use the tree you already hold (Rule 7).
- Tests: unit + integration covering the reproducer AND the adjacent shapes your mechanism could break (blast radius).
  Security-shaped fixes: run `bun compiler/tests/integration/security-await-pack/classify.js` before/after; 0 new FAIL.
- Gap ledger: flip your gap's marker to `status=resolved` with `locus=` (traced) in `docs/known-gaps.md`; regen
  `bun scripts/state.ts --write`, `bun scripts/facts.ts --write` if counts moved; `--check` both.
- Do NOT open/merge PRs, touch main, or edit SPEC beyond what your brief authorizes.

## FINAL REPORT
WORKTREE_PATH · branch · final SHA (== `git ls-remote origin s468-<unit-id>`) · reproducer + before/after ·
governing sentence (quoted) · direction-of-change + measured corpus impact · files touched · tests added · gate
results · locus hypothesis held/refined/wrong · maps load-bearing? · anything STOPPED for a ruling.

---

# unit-id: s468-generated-merge-driver — stop PRs conflicting on generated content (ruled S468 item 1)
Problem: every PR regenerates the same tracked generated content, so ANY two open PRs conflict and every merge to main
re-conflicts every other PR (S468: 9 open PRs all `dirty`). Generated content (find every producer: `grep -rn
'@generated' docs master-list.md compiler/SPEC-INDEX.md` + scripts/facts.ts, scripts/state.ts,
scripts/regen-spec-index.ts, gen-bootstrap-severity, bootstrap-conformance report): docs/FACTS.md (wholly generated?
verify), the `@generated:*` START/END sections inside docs/known-gaps.md, master-list.md, compiler/SPEC-INDEX.md, and
any other generated report (docs/bootstrap-conformance.md?). Read each script's header first.
BUILD a custom git merge driver:
 - `scripts/git-merge-generated.ts` (or .sh) invoked as `%O %A %B %P`: run git's normal 3-way merge on the file
   (`git merge-file`), then for every `@generated` section (and for wholly-generated files, the whole file) DISCARD the
   conflict and REGENERATE that section from the merged working tree using the existing producer scripts' `--write`
   (they read sources — e.g. state.ts reads the @gap markers, so known-gaps' ENTRY hunks must already be merged when the
   count section is regenerated: order matters; document it). Exit non-zero (leave conflict markers) if any conflict
   remains OUTSIDE generated sections — hand-written entries must still need a human/agent 3-way.
 - `.gitattributes` entries mapping the files to `merge=scrml-generated`; an install step in
   scripts/git-hooks/install.sh (and README) that sets `git config merge.scrml-generated.driver …` (merge drivers are
   per-clone config — say so; agents' worktrees share the clone's config).
 - The gap-id union invariant (memory feedback_mixed_generated_doc_conflicts): the driver must never drop an entry;
   add a self-check (union of @gap ids of both sides ⊆ result) that fails the merge loudly.
PROVE IT: construct real conflicting pairs from today's open PRs (e.g. merge origin/s468-cfor-comma-lists into a
branch at origin/main, and #1447 into #1448's branch) in a scratch worktree with the driver installed: generated-only
conflicts resolve with zero markers and `bun scripts/state.ts --check` + `bun scripts/facts.ts --check` + SPEC-INDEX
check pass; a hand-written entry conflict still stops. Also prove the unproven-gate bite: corrupt a section → the
driver regenerates it; drop a gap id → self-check fails.
Tooling only (scripts/, .gitattributes, docs) — no compiler/src. Pre-commit hook; push after every commit.
