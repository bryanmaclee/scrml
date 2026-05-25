# Phase 2 Cluster A — V-kill SPEC sweep — Progress

Dispatch: agent-a8edc8b6e84ee8542
Worktree: /home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-a8edc8b6e84ee8542
Authority: docs/heads-up/spec-consolidation-2026-05-25.md HU-2 Q5 ratification
Base SHA (post-merge-main): pending

## Phase 0 — verification

- Startup checks all pass (pwd, worktree-root, clean tree, merge main, bun install, pretest)
- Authority doc HU-2 Q5 read in full; F-008 enumeration cross-checked
- SPEC §6.1, §6.1.1, §6.1.2, §7.5, §52.4.1 read
- Spot-checked F-008 sites: 5594-5597 (§7.5 examples), 8480 (§13.5), 18806 (§40.7) — all confirmed at expected lines
- Spot-checked §52.4.1 grammar at line 26361 (drift of 6 lines from brief's 26367; acceptable)

## Step plan

1. A1 + A2 — Move grammar production from §7.5 to §6.1 (relocate); trim §7.5 production list
2. A3 — Migrate §7.5 worked examples 5594-5597
3. A4 + A5 — Trim §52.4.1 grammar; migrate §52.x worked examples to bare-attribute form
4. A6 — SPEC-wide mechanical sweep per F-008 enumeration

## Commits


## Amendments A1 + A2 + A3 complete (commit 0afc7316)

- §6.1.5 grammar section created; production: `state-decl ::= '<' identifier ws (decl-attr ws)* '>' [ ws ':' ws type-expr ] ws '=' ws expr`
- §7.5 state-decl production line dropped; one-sentence forward-ref to §6.1.5 added
- §7.5 worked examples 5594-5597 migrated to V5-strict structural form

## Amendments A4 + A5 complete (commit 4ca96edd)

- §52.4.1 grammar block retires; replaced by syntax block + §6.1.5 cross-ref
- §52.4.2-§52.4.7 all worked examples + prose migrated to `<var server>` bare-attribute form
- §52.5 summary table rows updated
- §52.6.1, §52.6.5, §52.7, §52.9, §52.10, §52.11, §52.12 prose + tables + error messages updated
- §34 catalog rows for E-AUTH-002, E-AUTH-005, W-AUTH-001 updated
- Cross-cutting prose references at lines 6245, 6263, 6267, 6271, 25140, 25426, 25914 updated
- Front-matter §52 amendment summary updated
- ALL `server @var` references migrated; grep confirms zero remaining

## A6 — SPEC-wide mechanical sweep (in progress)

## Amendment A6 complete (commit fd8b326e)

SPEC-wide mechanical sweep applied across §4.12, §5, §5.5, §6.5, §6.5.8, §6.6, §6.7,
§13.5, §13.x, §15.13, §15.x, §18.x, §19.11, §19.x, §22, §23.3.6, §36.5, §36.x, §40.7,
§48.5.4, §50.3.4, §51.x, §51.3.3, §51.9.5, §51.11, §51.12, §51.14, §51.15.3,
§53.2, §53.7, §53.8, §53.12, §53.13, §54.3.

Site count:
- Conversions applied: ~90 line-touches across SPEC.md (counting paired decl-line
  conversions in each example)
- Sites kept (writes): All function bodies + event handlers + when bodies + on-mount
  blocks + effect blocks + server function bodies + ${} blocks that follow decl
  in same example + engine-auto-declared cells (e.g., @loadPhase in §23.x).
- Sites not applicable: §SS-css @scope (CSS rule), §40.9.6 prose mention, error
  message diagnostic text.

## Cluster A complete

All 6 amendments (A1-A6) landed across 3 commits (in addition to per-step WIP
commits): 0afc7316, 4ca96edd, fd8b326e.

