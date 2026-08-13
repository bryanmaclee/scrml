# progress — each-request-ref-nested-lift-2026-08-13

Append-only. Newest entries at the bottom.

## 2026-08-13 — startup

- Worktree `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-ab0480c75e2b5c45f`, branch
  `worktree-agent-ab0480c75e2b5c45f`, base `3ebaa01ea47a0985b4725c885eb39b8b14cdb753`.
- `git rev-parse --show-toplevel` == worktree root. `git status` clean on arrival.
- `bun install` OK (217 packages). `bun run pretest` OK (13 test samples -> `samples/compilation-tests/dist/`).
- Read `.claude/maps/primary.map.md` in full (391 lines). Load-bearing rows: invariant 54
  (the FALSE one — the class is NOT closed), invariant 41 + the codegen task-shape row
  (`scripts/corpus-emit-differential.ts` is the standing pre-land gate, NOT in CI), invariant 55
  (no new source-text regex in a post-AST stage without justification), invariant 52
  (a field-listed walk is fail-open; "add the missing name" IS the defect class).
- Archived BRIEF.md verbatim.
- NEXT: reproduce the bug from the PA's on-disk reproducer; then trace the locus hypothesis.
