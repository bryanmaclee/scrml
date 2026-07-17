# sPA ss61 Wave-2 → PA reintegration

**List:** `spa-lists/ss61-conformance-l22-family.md` (Wave-2 — tier-1 code-exhaustive completion, S256 audit)
**Branch:** `spa/ss61` · **tip SHA `9fdfbb50`** · **worktree `../scrml-spa-ss61`** (symlinked node_modules; safe to remove after merge)
**Base:** cut fresh off `origin/main` @ `64a5c7c8` (the prior ss61 branch was already re-integrated + cleaned up; items 1-3 are in main).
**Conformance:** `bun conformance/run.ts` **483 → 500 (+17)**, all green, independently re-verified in the ss61 worktree.

## Commits on the branch
| SHA | contents |
|-----|----------|
| `84b3555a` | the 17 new conformance case dirs (34 files) + 2 `docs/changes/ss61-wave2-*/BRIEF.md` |
| `9fdfbb50` | tracking: `spa-lists/ss61-*.md` list markers (items 4-17 landed) + progress log (docs-only, hook skipped suite) |

## Items landed (all 4-17)
**formFor §41.14 reject codes (items 4-12) — `conformance/cases/form-for/`, 12 cases:**
- 9 positives (one per code): TYPE-NOT-STRUCT · NOT-IMPORTED · PICK-INVALID-FIELD · OMIT-INVALID-FIELD · PICK-OMIT-CONFLICT · ERROR-STRATEGY-INVALID · SLOT-UNKNOWN · NESTED-STRUCT-NO-SLOT · ONSUBMIT-SIGNATURE
- 3 near-miss negatives (specificity, beyond the existing happy cases' family-glob absence): `formfor-pick-valid-clean` · `formfor-omit-valid-clean` · `formfor-nested-struct-with-slot-clean`

**tableFor §41.16 remaining (items 13-17) — `conformance/cases/table-for/`, 5 positives:**
- ROWS-WRONG-TYPE (item 13) · NESTED-STRUCT-NO-SLOT · VARIANT-PAYLOAD-ENUM-V1 · NO-DISPLAY-MAPPING · SORTABLE-REQUIRES-CELL-ROWS

All codes-half (compile-time type-walk); author-from-impl#1 → SPEC §41.14.x/§41.16.x cross-checked in full; no golden-capture blessing. The L22 formFor happy-path-only asymmetry is CLOSED.

## ⚠ PARKED divergence → needs a COMPILER-SOURCE dispatch (outside conformance-authoring scope; NOT blessed)
**`E-TABLEFOR-ROWS-WRONG-TYPE` — impl#1 vs SPEC §41.16.2 / §34 soundness gap.**
- impl#1 (`compiler/src/type-system.ts:20590`) fires ROWS-WRONG-TYPE **only** when `rowsAttr.valueKind === "string-literal"` (a quoted `rows="..."`).
- SPEC §41.16.2 (`SPEC.md:22550`) cites `rows=@notAnArray` and §34 catalog (`SPEC.md:18243`) cites `rows=42` as triggers — impl#1 passes **both silently** (only incidental W- warnings; no error).
- The impl comment at `type-system.ts:20586-20589` promises a delegated regular-pass type-check that does not actually fire on the SPEC's own cited examples.
- **The authored case (`tablefor-rows-wrong-type`) uses `rows="notAnArray"`** — the trigger that is spec-conformant (a string is not `StructType[]`) AND fires today. It is NOT a workaround-blessing; it pins the code on a real, conformant instance. A follow-on compiler-source fix should widen the check to the cell-reference / numeric-literal cases the SPEC names.
- Also worth a glance during that fix: item-3's earlier parked **tableFor tbody-hoist** harness note (see `ss61.progress.md`) — separate issue, already escalated.

## Bonus finding (verify-first paid off)
Item 13's "already covered" prelim (from a `grep -rl` file-presence match) was WRONG — the only corpus match was inside a **rationale-prose string** in `tablefor-rows-missing/expected.json`, not a `codes`/`notCodes` assertion. No case actually fired the code. Now genuinely pinned.

## Re-integration notes
- The 17 case dirs + 2 BRIEFs are purely **additive** to `origin/main` (no existing file modified) — clean cherry-pick/merge.
- The `spa-lists/ss61-*.md` tracking edits are committed on the branch (`9fdfbb50`); reconcile per your shared-doc policy (this ping is the authoritative signal).
- No push, main untouched. `spa/ss68` (unmerged, its own reintegration ping pending) was NOT disturbed by this run.
