# s460-d1-land progress

WIP(s460-d1-land): start at /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a5007afcb110f4452 (base 01b1933cd = D1 round 7 + main 63423d5fa)

## Merge origin/main (b4b94f3d6: #1364 dpa-070, #1365 ship-strip, #1366 wrap s459)
Conflicts (2, both generated docs):
- `compiler/SPEC-INDEX.md` — totals + row line-ranges. 3-way check with ranges/sizes normalized: base->ours and base->theirs have ZERO non-numeric differences, so no hand content was at stake. Resolution: took ours, then `bun run scripts/regen-spec-index.ts` (33 rows updated; totals 47,290 lines).
- `docs/FACTS.md` — facts-table figures (src lines, test files, SPEC lines, conformance cases). Resolution: took ours, then `bun scripts/facts.ts --write` (facts-table regenerated).
Auto-merged: `compiler/SPEC.md` (D1 §42.3.5 etc. vs main's §47.9.9 ship-strip) — clean.
Checked current (no regen needed): `docs/bootstrap-conformance.md` (`--check` current), known-gaps §0 gap-counts (`state.ts` reports current).
`master-list.md` @generated:recent-sessions is git-log-derived; regenerated after the merge commit (not CI-gated).
