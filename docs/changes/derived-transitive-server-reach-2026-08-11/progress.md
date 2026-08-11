# progress — §6.6.19 transitive server reach

Append-only. Timestamped. This file + the branch are the entire crash-recovery surface.

---

## 2026-08-11 — startup

- `pwd` = `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a17073292e367092e` (worktree, OK)
- `git rev-parse --show-toplevel` == pwd (OK)
- **DEVIATION FROM BRIEF, resolved:** the harness cut this worktree at `main` (`23ea2e5c`), NOT at
  `fix/derived-transitive-reach` @ `17b5849a`. `17b5849a` is a strict child of `23ea2e5c`
  (`git merge-base --is-ancestor 17b5849a HEAD` returned false; `fix/derived-transitive-reach` is
  main+1). Resolved with `git merge --ff-only fix/derived-transitive-reach` — a pure fast-forward,
  no content risk. Branch name stays the harness name `worktree-agent-a17073292e367092e`; PA lands
  by file-delta so the name does not matter.
- `bun install` OK (217 packages). `bun run pretest` OK (13 test samples -> samples/compilation-tests/dist/).
- Scratchpad: `/tmp/claude-1000/-home-bryan-maclee-scrmlMaster-scrml/b25a8ac0-1b30-4ff4-91f8-7347376e005a/scratchpad/dtr-fix/`

## Maps

- `.claude/maps/primary.map.md` read. **Load-bearing: invariant 50** (map line 22-28 + row 235).
  Confirms §12.2 Trigger 3 is per-FUNCTION and reaches no other position; the derived-cell half is
  closed by `E-DERIVED-SERVER-ONLY-REACH` (§6.6.19, #486) at `route-inference.ts:4429`; a
  mutable-cell INITIALISER and a MARKUP INTERPOLATION are still open and still leak at exit 0. That
  bounds this dispatch: the hop defect is in the derived position only, and I must not accidentally
  "fix" the two open positions as a side effect (separate rulings).
- Map stamp `616688ea`; HEAD is past it. Claims treated as hypotheses, verified against source below.
