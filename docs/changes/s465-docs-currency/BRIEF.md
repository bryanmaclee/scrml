# DOCS — s465-docs-currency — S465 AUTO (owner absent)

CHANGE_ID=s465-docs-currency

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (cloud; PATH-DISCIPLINE incidents this run: 0)
1. `pwd` MUST start with `/home/user/scrml/.claude/worktrees/agent-`; `git rev-parse --show-toplevel` equals it; `git remote -v` names `bryanmaclee/scrml`. Else STOP + report.
2. `git fetch origin main && git checkout -B s465-docs-currency origin/main`; assert `git merge-base HEAD origin/main` == `git rev-parse origin/main`.
3. `bun install` (or `ln -s /home/user/scrml/node_modules node_modules` if package.json is unchanged vs origin/main); `bun run pretest` plainly from the worktree dir and check `samples/compilation-tests/dist/` exists.
4. Absolute paths under your worktree only; never `cd` into `/home/user/scrml` (the main checkout); NO `git stash` (shared across worktrees); no pattern `pkill`/`killall` (kill by captured PID only); never `--no-verify` / hooksPath override. Set `TMPDIR=/root/.cache/scrml-agent-tmp/s465-docs-currency/` per command (NOT inside any repo). Scratch files: `<worktree>/.tmp/` only (delete before your final report).
5. The cloud clone has NO git hooks installed — so before every commit run the pre-commit gate YOURSELF: `bun test compiler/tests/unit compiler/tests/integration compiler/tests/conformance --bail` (foreground, timeout 900000). Commit after each meaningful unit; code + its tests in one commit; append timestamped lines to the change's `progress.md`.
6. Up to 3 agents share a 4-core box: do not run more than one full suite at a time yourself; expect ~2-3× slower suites; a timing-only flake gets ONE re-run, a second failure is real.
7. KEEP TOOL OUTPUT SMALL (pipe test output through `tail -30`; never cat large files; grep with `-m`). A previous agent on this work died of context overflow.
8. When done and `git status` is clean: `git push origin HEAD:refs/heads/auto/s465-docs-currency`. Do NOT open a PR; the PA lands it.
9. The sibling repos `../giti` and `../flogence` are NOT cloned in this container — skip them in any corpus differential and say so.

## MAPS — REQUIRED FIRST READ
`.claude/maps/primary.map.md` (stamp `8ce6d61b5`, 2026-10-08 — STALE, ~40 commits behind main `1c1e9eee`; every map locus is a verify-against-source hypothesis) + its Task-Shape Routing. Report whether the maps were load-bearing.

First commit: archive THIS prompt verbatim as `docs/changes/s465-docs-currency/BRIEF.md` + `progress.md`. This is DOCS-ONLY: no compiler source, no SPEC.md edits. (The pre-commit suite still runs per step 5; docs-only commits may skip it if the diff touches only `docs/` and `.claude/maps/` — say so in progress.md.)

## Task (AUTO queue item 13; rests on bryan S462 rulings: `is some` → `is given` (§63 window, #1385) and in-place `given x :>` retired (#1392))
1. `docs/PA-SCRML-PRIMER.md` still teaches `is some` and the in-place `given` guard (§6.5, §8, §9.4, §10 and the set idioms — grep for every occurrence; quote count before/after). Rewrite each to the CURRENT forms as SPEC says them NOW: read SPEC §42 (presence: `is given` / `is not` / bare `x` in conditions) and §63 (the deprecation window) and the S462 `given` retirement (find it via SPEC-INDEX + `git log --grep=given -- compiler/SPEC.md`), and quote the governing SPEC sentence beside each rewrite in progress.md. Keep one short "deprecated forms" note that names the old spellings as deprecated (§63), so readers of old code understand them. Every rewritten example must COMPILE: extract each changed snippet to `<worktree>/.tmp/` and compile it with `bun compiler/bin/scrml.js compile` — report pass/fail per snippet; fix any that fail.
2. `docs/articles/llm-kickstarter-v2-2026-05-04.md`: same treatment.
3. NOT the website, NOT marketing copy (Rule 1).
4. Refresh `.claude/maps/` using the project-mapper persona (`/home/user/scrml-support/agents/project-mapper.md` — read it and follow its incremental-refresh procedure). The stamp is `8ce6d61b5`; refresh to current origin/main. Commit with an explicit pathspec (`git commit -- .claude/maps/`) and verify the stamp line advanced.
5. `bun scripts/snippet-gate.ts` (or the package.json script) must pass if it covers these docs.
6. Push to `auto/s465-docs-currency`.

## Report
Counts before/after of `is some` and in-place `given` in each doc, the per-snippet compile table, the governing sentences, the maps stamp before/after, the gates you ran, the pushed FINAL_SHA.
