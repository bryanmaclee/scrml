## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (path-discipline incidents to date: several; the hook guards Edit/Write)
1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. `git rev-parse --show-toplevel` MUST equal it. If not: STOP, report, exit.
2. Base the work on the local branch `s459-refine-copy-in` (tip `3a302511a`; local branches are shared across worktrees): `git checkout -B s460-refine-la s459-refine-copy-in` and verify `git rev-parse --short HEAD` == `3a302511a`. Then `git merge --no-edit origin/main` (main is 1 docs-only commit ahead, `b4b94f3d6`; if generated docs conflict — SPEC-INDEX.md, docs/FACTS.md, bootstrap-conformance — regenerate them by script, never pick a side).
3. `bun install`; run `bun run pretest` plainly from the worktree dir (NOT `bun --cwd <p> run` — that silently no-ops).
4. Every Read/Edit/Write uses an absolute path UNDER your worktree root. Never `cd` into `/home/bryan-maclee/scrmlMaster/scrml`. Never `git stash` (the stash is shared across worktrees). Never `pkill -f`/`killall` a pattern — kill only PIDs you started. `TMPDIR=/home/bryan-maclee/.cache/scrml-agent-tmp/s460-refine-la/` per command (NOT inside any repo). Never `--no-verify`, never override hooksPath.
5. First commit: archive this prompt verbatim to `docs/changes/s460-refine-la/BRIEF.md` + a `progress.md`, message `WIP(s460-refine-la): start at $(pwd)`. Commit after each meaningful change; append timestamped lines to progress.md (crash-recovery anchor). Code + its tests = ONE commit.

## MAPS — REQUIRED FIRST READ
`.claude/maps/primary.map.md` (follow its Task-Shape Routing for runtime/codegen). Treat map loci as hypotheses to verify against source; report whether the map was load-bearing.

## Task — L-A from the S460 review of s459-refine-copy-in round 2
Context: SPEC §53 refinement copy-in (bryan, S459: a refined cell stores its own copy of every value it admits). Round 2 (`2bfead7e6`) added multi-parent "places" for shared sub-objects; a PATH write through a shared container first gives that place its own shallow copy (un-share), then writes. Read `docs/changes/s459-refine-copy-in/BRIEF.md` (incl. round-2 addendum) and `progress.md` Round 2.

Defect (reviewer-EXECUTED, LOW): a path write that is REFUSED still un-shares. Repro shape: refined cell `rows` of a struct with `n: number(>0)`; `rows=[o,o]` (same object twice); hold `e=@rows[0]`; a refused `@rows[0].n = -5` (E-CONTRACT-001-RT) leaves row 0 with its own copy anyway, so a later `e.n = 7` yields `[4,7]` instead of `[7,7]` (the result with no refused write). This violates the brief's N1 rule: a refused write changes nothing. Reviewer's runtime driver: `/home/bryan-maclee/.cache/scrml-agent-tmp/s460-rev-copyin/p/j.mjs` (filters `i5`, `b3`) — read it for the shape; copy what you need into your own scratch, do not edit it.

Fix direction (reviewer's, verify): judge the leaf write BEFORE un-sharing (or un-share into a staged copy and commit it only after the judgement passes), so a refused write leaves identity, sharing and place counts exactly as before. The locus is the round-2 runtime place/un-share code (PA-located, NOT traced — find where path writes un-share in the refinement runtime chunk, likely under `compiler/src/runtime-template.js` or a refine runtime module; report the actual locus and whether this hypothesis held).

Requirements:
- Unit rows: refused path write on a shared container → state (values, identities, sharing, place counts) unchanged; then held-reference write reaches every place. Plus the valid path-write case still yields `[9,4]` un-share semantics.
- Check sibling paths for the same pattern: any OTHER operation that mutates bookkeeping (un-share, place add/remove, copy) before its judgement can refuse — push/splice/defineProperty/delete/Object.assign through a shared object. Fix any that have the same defect; report each.
- Gates: pre-commit core gate passes; `bun conformance/run.ts` 0 FAIL; `bun scripts/host-global-scan.ts --check`; `bun run types:check`; browser tier as in `.github/workflows/ci.yml` (run its browser step exactly).
- Do NOT touch anything outside this defect. Do NOT re-fix L-B/L-C/L-D (filed separately).

## Report
Final SHA, files touched, the locus found (hypothesis held/refined/wrong), sibling operations checked + results, gate counts, reproducer before/after. Context budget: ~300k tokens.
