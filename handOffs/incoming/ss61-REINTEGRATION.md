# sPA ss61 → PA · RE-INTEGRATION (list complete, standing down)

**List:** `spa-lists/ss61-conformance-l22-family.md` (conformance authoring: L22 type-as-argument family)
**Branch:** `spa/ss61` @ **`ab8eef6a`** · baseline 72/72 → **now 88/88 green** (`bun conformance/run.ts`).

## Items — all landed
| # | item | SHA | by | result |
|---|------|-----|-----|--------|
| 1 | parseVariant §41.13 | `2a37e296` | **me (ss61 sPA)** | 79/79 (7 cases); 3 divergences escalated |
| 2 | schemaFor §41.15 | `ab8eef6a` | sibling session | partial (3/8 codes) — **my COMPLETE 8/8 superset preserved on branch `ss61-schema-for` @ `46ae54cf`, escalated** |
| 3 | tableFor §41.16 | `ab8eef6a` | sibling session | 5 cases; tbody-hoist harness note escalated by sibling |

**Cross-session collision:** ss61 items 2-3 were worked in parallel by another sPA session (landed `ab8eef6a` on top of my item-1 `2a37e296`) AND by my dispatched schemaFor agent. ss61 is fully green either way; the reconciliation (dedup + my more-complete schemaFor set) is escalated — NOT decided by me (curation is PA-owned).

## Escalations filed to handOffs/incoming/ (PA to rule/triage)
- `ss61-item1-parse-variant.md` — item-1 landing ping.
- `ss61-item1-ESCALATION-divergences.md` — **D1** parseVariant null→Malformed vs SPEC MissingDiscriminator · **D2** single-field `!{}` binds whole `.data` (likely general codegen bug) · **D3** recovery-value-not-applied-on-assign (§19).
- `ss61-item2-COLLISION-schemafor-superset.md` — the schemaFor dedup recommendation (adopt my complete 12-case set / retire sibling's 4 partial; **cherry-pick `47b04bc5`+`46ae54cf`, do NOT wholesale file-delta** — clobber hazard) + a **parked compiler bug**: `E-SCHEMAFOR-NO-SQL-MAPPING` doesn't fire for canonical postfix `T[]` array fields (silently mis-lowered to scalar `text`).

## Preserved for you
- Branch `ss61-schema-for` @ `46ae54cf` (worktree `.claude/worktrees/ss61-schema-for`) — the complete 8/8-code schemaFor set. Left intact; cherry-pick when you rule on dedup.
- `spa/ss61` branch + worktree `../scrml-spa-ss61` — the landed line (88/88).

**End-state:** all 3 items landed; ss61 DoD (L22 family conformance coverage, all green) met; divergences + collision + bug escalated. Standing ss61 down.
