change-id: s449-dev-db-residuals

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (path-discipline incidents to date: track yours, report 0 or N)
1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`; `git rev-parse --show-toplevel` equals it; clean tree; `git fetch origin` then `git merge-base HEAD origin/main` == `git rev-parse origin/main` (if behind: `git merge --ff-only origin/main`). Any other failure: STOP and report.
2. `bun install`; `bun run pretest` (plainly from the worktree CWD — `bun --cwd <p> run` silently no-ops).
3. EVERY Write/Edit uses an absolute path UNDER your worktree root. Never `cd` into /home/bryan-maclee/scrmlMaster/scrml (main). NEVER `git stash` (the stash is shared across worktrees) — base/build flips by FILE COPY. NEVER a bare `pkill -f` — kill only PIDs you captured. Scratch goes in `<worktree>/.tmp/` (delete before your final report); `TMPDIR` must NOT point inside any repo.
4. First commit: this prompt verbatim → docs/changes/s449-dev-db-residuals/BRIEF.md, message `WIP(s449-dev-db-residuals): start at $(pwd)`. Commit after each meaningful change (WIP commits expected); keep docs/changes/s449-dev-db-residuals/progress.md append-only with timestamps. Code + its tests = ONE commit. Never --no-verify, never touch core.hooksPath. Foreground commits need a long timeout (the pre-commit hook runs ~2-4 min).
5. MEMORY GATE: two sibling agents run full suites on this 15 GB machine concurrently. Before every commit and every full-suite run, check `free -g` "available"; if < 6, wait (poll at most 10 times, 60 s apart, then proceed and note it) — an OOM SIGKILL mid-commit loses the commit.

MAPS — REQUIRED FIRST READ: /home/bryan-maclee/scrmlMaster/scrml/.claude/maps/primary.map.md (stamp 6a592ed5c, 2026-10-02; main has since landed only #1231 (docs/maps/SPEC prose) — read the copy in YOUR worktree). Follow its Task-Shape Routing. Treat map content as a hypothesis; report whether it was load-bearing.

Model: you are on Opus. All loci named below are PA-located-verify: report whether each held, was refined, or was wrong.

## Context
SPEC §47.14 Runtime Data Root (`SCRML_DATA_DIR`, S445) IN FULL — quote the governing sentence for every behaviour you change. Prior work: docs/changes/ for the s447 dev-db rounds (`ls docs/changes | grep -i dev-db`), and docs/known-gaps.md `g-dev-db-data-root-residuals` (YOUR scope). Locus (PA-located-verify): compiler/src/codegen/sqlite-file-target.ts (`_scrml_sqlite_inside`, `_scrml_sqlite_owned`), compiler/src/commands/dev.js. This is a data-safety surface (a db created in the wrong place / a containment escape) and so falls under the impl#1 security carve-out.

## Scope
1. **MED — RELAYED-UNVERIFIED, reproduce FIRST:** a compiled `<program kind="tool">` that owns a SQLite db, run from OUTSIDE any project (a probe dir with no scrml.toml and no .git above it — your worktree IS inside a git repo, so build the probe under `~/.cache/scrml-agent-tmp/s449-dev-db/` and delete it at the end), `SCRML_DATA_DIR` unset → reportedly resolves the data root to the CWD and CREATES the db there. Expected per §47.14: refuse, naming SCRML_DATA_DIR; never create. If it does NOT reproduce, record the exact commands + output (NOT-REPRODUCED with the empirical table) and also try: a web-app build server run from outside, a tool run with a relative `db=` path, and a tool built inside a project then copied out.
2. **LOW — dangling symlink escapes containment:** `data/dangling.db -> ../out/target.db`, `SCRML_DATA_DIR=data` → realpath fails, the check falls back to the parent (inside), SQLite follows the link and creates `out/target.db`. Fix: `lstat` the target; a symlink whose realpath fails is refused (fail closed). Same for intermediate dir symlinks.
3. **NIT:** a symlink loop surfaces a raw `EEXIST` from mkdir → a scrml error naming the path.
4. **NIT:** the R4-1 refusal text "…or set SCRML_DATA_DIR to a directory that contains it, then rebuild" — changing SCRML_DATA_DIR needs no rebuild; fix the wording.
5. **NIT:** add the unlisted §34 rows `W-DEPLOY-DB-OUTSIDE-DATA-ROOT`, `W-DEPLOY-DB-NO-PROJECT-ROOT`, `W-DEPLOY-DB-SHARED-PATH` (and check `W-DEPLOY-001`) — text from §47.14 / build.js, no behaviour change.

## Verification
- Tests for each fixed item (positive + negative), in the existing dev-db/data-root test files.
- R26: build examples/ apps that use SQLite + the flogence-shaped tool case; confirm no db is created anywhere unexpected (`find` before/after, report counts).
- `bun test compiler/tests/{unit,integration,conformance}` + `compiler/tests/commands/`.
- Update the gap entry (resolved items with evidence; anything left stays with a fresh measurement).
- Do NOT open a PR. Push `git push origin HEAD:refs/heads/wip/s449-dev-db-residuals`.

Final report: worktree path, FINAL_SHA, files touched, item 1 reproduced-or-not with the commands, per-item before/after, test counts, path-discipline incidents.
