# progress — fix `corpus-emit-differential.ts` before it becomes a gate

Append-only, timestamped. Agent worktree: `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-ab7336c5da32f10ed`

---

## 2026-08-11 — startup

- `pwd` = `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-ab7336c5da32f10ed` (worktree, correct).
- `git rev-parse --show-toplevel` == pwd. `git status --short` clean.
- **Base correction:** the harness provisioned this worktree at `1bfa8544` (branch
  `worktree-agent-ab7336c5da32f10ed`), which is the PARENT of the brief commit `19157604`, so the
  BRIEF FILE WAS NOT PRESENT. `git merge --ff-only fix/differential-harness` fast-forwarded cleanly
  to `19157604`. No conflict, no rebase. Recording this because a future reader of the branch will
  see a merge that was actually a pure FF onto the brief.
- `bun install` OK (217 packages). `bun run pretest` OK (13 samples -> `samples/compilation-tests/dist/`).

## Maps consulted

- `.claude/maps/primary.map.md` (stamp `616688ea`, NOT an ancestor of this HEAD — treated as
  hypothesis per its own invariant 48). Load-bearing rows:
  - **invariant 41** — this script is the standing pre-land gate; `diff` exit 2 = NOT A VALID
    COMPARISON, distinct from 1 = differences found. The syntax half must stay a separate NODE
    subprocess. Confirms the brief's "do not invent a fourth reporting mode".
  - **invariant 51 / Key Facts "A PROBE IS CODE"** — `scripts/` is inside the review floor's
    code-bearing population on purpose, and **"prove the bite"** is stated there as a rule, not a
    nicety. Directly motivates the brief's A3.
  - Task-Shape Routing row "you are CHANGING ANYTHING under `compiler/src/codegen/`" — names the
    invocation shape this script is run under.

---
