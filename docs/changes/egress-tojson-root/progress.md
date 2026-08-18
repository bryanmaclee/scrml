# progress — egress-tojson-root

Append-only. Timestamps are local (America/Denver).

## 2026-08-18 — startup

- Worktree: `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a3748d68a1d807f9c`
- `git fetch origin egress-fix-r1` + `git checkout -B egress-tojson-root FETCH_HEAD` -> HEAD
  `a112c92f` (confirmed, matches brief).
- `bun install` (217 packages) and `bun run pretest` (13 samples compiled) both clean.
- Read `docs/changes/egress-tojson-root/BRIEF.md` in full; read `.claude/maps/primary.map.md`
  header + Task-Shape Routing.
- Read `compiler/src/codegen/protect-egress.ts` (531 lines) in full.
- NEXT: reproduce the PA's four A/B shapes on this tree BEFORE touching source (baseline),
  then Unit 1 (delete the toJSON install), then scope Unit 2.
