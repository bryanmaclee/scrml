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
# unit-id: s468-ci-speedup — faster required CI + security tests that actually gate (ruled S468 "go on the CI speedup")
Read .github/workflows/ci.yml IN FULL (all jobs: gate, tracking, windows) and the two other workflows. Measured baseline
(run 39078887384, PR #1446): required `gate` ~19.7 min serial — unit+conformance 7m43, host-global alias gate 5m09,
browser tier 1m54, bootstrap slices 1m47, snippet gate 1m03, e2e-render-map 55s, ~15 small checks <30s; `tracking`
11 min (integration+lsp+commands — NOT required); `windows` 13 min (not required). Runner queueing observed: 25+ min
"pending" with ~10 open PRs × 3 jobs. Get more timings: `gh run list --workflow CI --limit 20` + `gh run view <id> --json jobs`.
DO:
1. Split `gate` into parallel jobs; keep a final aggregator job literally named `gate` that `needs:` all of them and fails
   if any failed/cancelled/skipped-unexpectedly (branch protection requires the check name `gate` — verify with
   `gh api repos/bryanmaclee/scrml/branches/main/protection` and do NOT change protection; if the aggregator approach
   cannot preserve the required check name, STOP and report).
2. Shard `bun test compiler/tests/unit compiler/tests/conformance` across a matrix (balanced; a shard list or file-size/
   timing split) — totals across shards must equal the unsharded run.
3. Host-global alias gate (scripts/host-global-scan.ts): profile why 5 min; parallelize/cache, or run it only when its
   inputs change (paths filter / changed-files check INSIDE the job so the job still reports success). Explain choice.
4. De-duplicate: browser tier, bootstrap-conformance check, pretest — each once.
5. PROMOTE compiler/tests/integration (incl. security-await-pack) into the required gate as its own sharded job(s).
   lsp + commands too if green. The known flaky test `§2 stopping scrml dev mid-respawn … SIGTERM` (fails in CI
   intermittently): find its file, fix the flake (it races process spawn) or move ONLY it to a non-required job — never
   skip it silently; report which. Any other test that fails/flakes when promoted: same treatment, listed.
6. `windows` job: run on push to main, a nightly `schedule`, and PRs whose changed files touch path handling (decide the
   path set from the job's stated purpose: `\` vs `/` OS-path bugs — compiler/src module resolution, CLI, file IO;
   justify) — via an in-job changed-files check so the job still reports. Not required (confirm).
7. Check GitHub merge queue availability for this repo (user-owned): `gh api repos/bryanmaclee/scrml` + docs; report
   yes/no with evidence; do NOT enable it.
PROVE: open the change as a PR and show its own CI run: wall time of the aggregator, per-job times, total test counts
equal to the old run (unit+conformance+integration counts reconciled), and a deliberately-failing commit on a scratch
branch that turns the aggregator `gate` red (bite proof — then delete the scratch branch). Report before/after.
Tooling only (.github/, scripts/). Local pre-commit hook on your commits; push after every commit.
