# BRIEF — D1 (block-analysis footprint extractor) — dispatched S206, agent a4e06003bbee9b9a2

> Archived verbatim per S136. Agent: `scrml-js-codegen-engineer`, `isolation: worktree`, opus, background.

# D1 — block-analysis dotted-path footprint extractor (the BREAK-1 fix, ADD-ALONGSIDE)

Change-id: `block-analysis-emit-2026-06-18`. Read the full plan FIRST: `docs/changes/block-analysis-emit-2026-06-18/SCOPE-AND-DECOMPOSITION.md` (§1 Fact 2, §2 add-alongside, §4 v1.1 + SHALLOW depth, §7 D1).

## MAPS — REQUIRED FIRST READ
Read `.claude/maps/primary.map.md` in full + the Task-Shape Routing maps for compiler-source. Map currency: HEAD `359a1d83` as of 2026-06-18 (creates NEW files + reads reactive-deps/ast/body-dg-builder, unmodified since — current). Report maps consulted + load-bearing finding (or not).

## CRITICAL STARTUP + PATH DISCIPLINE (S99 — leaks have happened; don't be the next)
1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-` (else STOP — S90). Save WORKTREE_ROOT.
2. `git -C "$WORKTREE_ROOT" rev-parse --show-toplevel` == WORKTREE_ROOT. 3. status clean. 4. `bun install`. 5. `bun run pretest`. Any fail → STOP.
Path discipline: edits via Bash (perl/python3/heredoc) on WORKTREE-ABSOLUTE paths with the `.claude/worktrees/agent-<id>/` segment — NOT Edit/Write (S126). Echo path before write; re-verify after. NEVER `cd` into main — use `git -C`, `bun --cwd`, absolute paths.

## COMMIT DISCIPLINE (S83)
First commit: `WIP(block-analysis-d1): start at $(pwd)`. Per-function commits; progress.md after each step; clean `git status` before DONE. Report WORKTREE_PATH, FINAL_SHA, FILES_TOUCHED, R26 output.

## SCOPE
Create `compiler/src/block-analysis-footprint.ts` exporting `footprintForBlock(node, fileAST?) -> {reads:string[], writes:string[]}` — SHALLOW dotted-path footprint, reusing reactive-deps.ts (`extractReactiveDepsFromExprNode` for reads; `_deepSetLeafKey`/`stampCompoundDeepSetTargets` for nested-assign writes; inverse of `addAssignTargetWrites` keeping segments for bare-expr member writes; index-reads mirroring body-dg-builder ~409-416). SORTED, deduped, no @ prefix. SHALLOW = own body only (no call-graph). DO NOT TOUCH body-dg-builder.ts (add-alongside; verify zero diff). Test `block-analysis-footprint.test.js` from REAL COMPILED ASTs (so `_deepSetLeafKey` is stamped) — BREAK-1 canary: `@quoteForm.originCity` ≠ `@quoteForm.weightLbs` distinct at dotted grain.

## R26 VERIFY (mandatory before DONE)
unit test green; `git diff --stat compiler/src/body-dg-builder.ts` EMPTY; BREAK-1 canary on a real compiled quote-form AST. Export signature `footprintForBlock(node, fileAST?) -> {reads,writes}` is the contract D2 imports — keep stable.
