change-id: s441-land-bootstrap-css-t3

TASK: bring the HELD branch `worktree-agent-a07d7b136031a04cd` (tip 6da77d5f8 — bootstrap CSS + `<theme>` T3, dpa-051 §8.4 step 1; review round 1 = LAND, fix round done) up to date with current `origin/main`, resolve conflicts correctly, remove one now-obsolete workaround, verify, commit, push your branch. Do NOT open a PR — the PA does that after an independent adversarial review.

CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (incident counter: 0 this session)
1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. `git rev-parse --show-toplevel` must equal pwd. Tree clean. Else STOP and report.
2. `git merge-base HEAD origin/main` must equal `git rev-parse origin/main`. Else report.
3. `bun install`, then `bun run pretest` plainly from the worktree CWD (NOT `bun --cwd … run` — silently no-ops).
4. Every Edit/Write uses an absolute path UNDER your worktree root. Never `cd` into /home/bryan-maclee/scrmlMaster/scrml (main). Use `git -C "$WT"` / worktree-absolute paths.
5. NEVER `git stash` (shared across worktrees). NEVER `pkill -f`/`killall` on a shared command string; kill by captured PID only. Scratch output goes under your worktree or the session scratchpad, never a drive root.
6. First commit: write this whole prompt verbatim to `docs/changes/s441-land-bootstrap-css-t3/BRIEF.md` + a `progress.md`, commit as `WIP(s441-land-bootstrap-css-t3): start at $(pwd)`. Commit after each meaningful step; append timestamped lines to progress.md.

MAPS — REQUIRED FIRST READ: `.claude/maps/primary.map.md` (stamp fb21983a; treat as verify-against-source; the maps predate most of compiler/self-host-v2/). Report whether load-bearing.

STEPS
a. `git merge worktree-agent-a07d7b136031a04cd` into your branch (MERGE; the held branch is a local ref in the shared repo). Main moved 13 commits since its base 7e4bc8155. Known collision: `compiler/self-host-v2/**/core.scrml` — main's re-land #1129 added `Stmt.Commit`; the CSS branch's core.scrml change is additive. Resolve as a true 3-way keeping both. Also expect `compiler/src/codegen/index.ts` / `api.js` / `scripts/hybrid.ts` overlaps — understand both intents. Generated files: `docs/FACTS.md` → either side then `bun scripts/facts.ts --write`. `docs/known-gaps.md` is MIXED → resolve ONLY count hunks (`bun scripts/state.ts --write`), keep every hand entry from both sides, never whole-file `--theirs/--ours`; grep that every `@gap id=` from both sides survives.
b. The branch carries a `"~"` charCodeAt workaround (see its progress.md) because the impl#1 bug fixed by #1131 (`fix(s440 F18)` — a `"~"` string literal was mis-lexed) was open. #1131 is on main. Verify on the merged tree that the plain `"~"` string literal now compiles and behaves correctly in that position, then remove the workaround. If it does NOT work, keep the workaround and report exactly why (reproducer + output).
c. Verify, all must pass on the merged tree: the branch's CSS test (`compiler/self-host-v2/slice-m3/css.test.js`), the slice suites the S439/S440 progress notes name (slice-m1, slice-m2, slice-m3, lowered, lint), `compiler/tests/integration/css-sub-seam.test.js`, the bite matrix (`slice-m3/bench/bite-matrix.js`, ~2 min — report certified/uncertified CSS and CG counts; the branch claimed CSS 32 certified / 0 uncertified, CG 18/18), and `bun test compiler/tests/unit compiler/tests/integration compiler/tests/conformance --bail` (0 fail). Report `bun conformance/run.ts` pass/total too.
d. Pre-commit hook runs the core suite: commit FOREGROUND with a long timeout; never `--no-verify`, never touch core.hooksPath. `git commit -F <file>` for messages with backticks/`${}`.
e. `git push -u origin HEAD`.

REPORT (final message): worktree path, branch, FINAL SHA (== pushed tip), files touched by YOUR resolution + the workaround removal (separate from the merged-in content), each conflict and how resolved, workaround verdict with evidence, all suite/bite-matrix numbers, anything unresolved. `git status` clean before DONE.
