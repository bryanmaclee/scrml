change-id: s444-typer-r8-land

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (PATH-DISCIPLINE INCIDENTS this session: 0)
1. `pwd` MUST start with `/home/bryan/scrmlMaster/scrml/.claude/worktrees/agent-`. If not: STOP, report, exit. Call that path WORKTREE_ROOT.
2. `git -C "$WORKTREE_ROOT" rev-parse --show-toplevel` == WORKTREE_ROOT; tree clean; `git fetch origin` then assert `git merge-base HEAD origin/main` == `git rev-parse origin/main` (your worktree is cut from origin/main — if not, `git reset --hard origin/main` ONLY if the tree is clean and has no commits of yours).
3. `bun install`, then `bun run pretest` from WORKTREE_ROOT (plain, not `bun --cwd ... run` — that silently no-ops).
4. Every Read/Edit/Write uses an ABSOLUTE path under WORKTREE_ROOT. Never `cd` into /home/bryan/scrmlMaster/scrml (the main checkout). Use `git -C "$WORKTREE_ROOT"`. NEVER `git stash` (the stash is shared across all worktrees). Never `pkill -f`/`killall` on a shared command string — kill by captured PID only.
5. First commit: save this entire prompt verbatim to `docs/changes/s444-typer-r8-land/BRIEF.md` + a `progress.md`, message `WIP(s444-typer-r8-land): start at <pwd>`. Commit after every meaningful unit; append timestamped lines to progress.md. Branch name: `feat/s444-typer-r8`.

## MAPS
`.claude/maps/primary.map.md` is stamped cf62b415 — STALE (~40 commits; #1151-#1179 landed after it, including all S442 bootstrap-typer rounds). Treat map content as a hypothesis; verify against source. Report whether the map was load-bearing.

## Task
Land typer round r8 (the parameter-type cascade guard — "Rule C for names") on current main. It is parked on branch `feat/s442-typer-r8-wip` @ `063eb3b37`, cut from the r7 tip `ffa791ac6`. r7 is now ON main (#1167 merged), so r8's single commit should apply.
1. `git cherry-pick 063eb3b37` onto your branch (it touches compiler/self-host-v2/analyze.scrml, slice-m1/bench/mutations.js, slice-m2/typer-s440.test.js, slice-m2/typer.test.js, docs/changes/s442-bootstrap-typer-rules/progress.md). Resolve any conflict as a real 3-way merge against current main (main has moved: CSS slice, six §66.19 programs, O19 residue, dpa-045 SPEC). Never take one side wholesale over an intervening change.
2. Read the r8 section at the bottom of docs/changes/s442-bootstrap-typer-rules/progress.md (on that branch) — it states what r8 fixes (F1: an unresolved declared type — parameter, struct/payload field, declaration field, local annotation — cascaded E-TYPE-031 off the `string` placeholder E-TYPE-UNKNOWN returns) and the owed verification.
3. Re-verify F1 by execution on YOUR tree (reproduce on origin/main first → cascades present; then on your branch → only E-TYPE-UNKNOWN). The probe used before was scratchpad/agent-s442/r8probe.js — it may not exist on this machine; write your own under your worktree's scratch dir (not committed).
4. Run the FULL verification the r7 round ran (see the "r7 FINAL VERIFICATION" line in that progress.md for the exact set): self-host-v2 lint, slice-m1, slice-m2, lowered slice-m1, slice-m3, slice-m4 (new since r7), v2-lexer, conformance (impl#1 must be untouched), footprint, bite runtime + CSS, the mutation harness (every row RED, mirror clean), and the corpus diff vs cf62b415 AND vs origin/main — required result: 0 newly rejected, 0 missing. Find the commands by reading the test files / package.json scripts / prior progress notes; the corpus-measure scripts lived in a scratchpad — recreate them in your worktree scratch if missing, and say so.
5. Also `bun test compiler/tests/unit compiler/tests/integration compiler/tests/conformance --bail` must be green (the pre-commit hook runs it; never `--no-verify`).
6. Direction-of-change: r8 is NEWLY-SILENCING cascades on already-refused programs. State that classification with the evidence (no program changes accept/reject status; only extra diagnostics on already-rejected programs disappear).
7. Push your branch (`git push -u origin feat/s444-typer-r8`). Do NOT open a PR, do NOT merge — the PA runs the adversarial review and lands.

## Report (terse)
WORKTREE_ROOT, final SHA, files touched, conflict resolutions (what and why), every verification number, corpus diff results with the commands used, anything you could not run and why, map load-bearing yes/no.
