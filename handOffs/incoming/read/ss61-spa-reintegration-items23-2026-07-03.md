# ss61 sPA re-integration (items 2-3) → PA

**List:** `spa-lists/ss61-conformance-l22-family.md` (L22 type-as-argument family: parseVariant · schemaFor · tableFor)
**Branch:** `spa/ss61` · **tip:** `ab8eef6a` · **base:** `origin/main` @ `cfba6295` (2 commits ahead, 0 behind)
**Date:** 2026-07-03 · **Built:** sPA-DIRECT in worktree `../scrml-spa-ss61`

## Context — I completed a partially-done list
Booted for a non-existent `ss63` list; per your away-keyboard judgment call I picked up **ss61**,
whose item 1 (parseVariant) was already **committed** (`2a37e296`) by an earlier, now-idle session
and whose items 2-3 were pending. Verified ss61 was idle (no activity 6+ min, clean worktree) before
touching it. **ss61 is now COMPLETE (items 1-3).** (Item 1's 3 divergences were escalated separately
by that session → `ss61-item1-ESCALATION-divergences.md`.)

## Landed @ `ab8eef6a` (9 cases; oracle 79→88 green)
| # | item | cases | status |
|---|------|-------|--------|
| 2 | schemaFor §41.15 | schema-for/{schemafor-happy, schemafor-type-not-struct, schemafor-pick-invalid-field, schemafor-pick-omit-conflict} | **landed** |
| 3 | tableFor §41.16 | table-for/{tablefor-render-rt, tablefor-type-not-struct, tablefor-not-imported, tablefor-rows-missing, tablefor-column-field-unknown} | **landed** |

**Parked:** none. **Dropped:** none.

## What landed
- **schemaFor** — the canonical `schemaFor(Struct)` in a `<schema>` block compiles clean (E-SCHEMAFOR-* silent)
  + the three primary reject codes (TYPE-NOT-STRUCT on an enum arg, PICK-INVALID-FIELD, PICK-OMIT-CONFLICT).
  schemaFor is **codes-only** in the harness — its DDL output is a compile-time/server migration artifact (not a
  client-runtime effect) and the exact SQL is D3 impl-freedom, so a DDL-shape RT assertion isn't sound (parallel
  to ss60's server-side surfaces). The remaining 5 E-SCHEMAFOR-* codes (OMIT-INVALID, NO-SQL-MAPPING,
  NESTED-STRUCT-NO-FK-V1, VARIANT-PAYLOAD-ENUM-V1, INVALID-CALL-CONTEXT) are a straightforward extension if you
  want exhaustive code coverage — I covered the representative reject paths.
- **tableFor** — the RT flagship: `tableFor(Struct, rows)` renders a `<table>` with 3 headers (from struct fields,
  declaration order) + 6 valued cells (2 rows × 3 fields); + 4 reject codes (TYPE-NOT-STRUCT, NOT-IMPORTED,
  ROWS-MISSING, COLUMN-FIELD-UNKNOWN). The other 10 E-TABLEFOR-* codes (ROWS-WRONG-TYPE, NO-PRIMARY-KEY,
  NO-DISPLAY-MAPPING, NESTED-STRUCT-NO-SLOT, SELECTABLE-CELL-WRONG-TYPE, SORTABLE-REQUIRES-CELL-ROWS,
  OMIT-INVALID, PICK-INVALID, PICK-OMIT-CONFLICT, VARIANT-PAYLOAD-ENUM-V1) are extension work.

## Verification
- `bun conformance/run.ts` = **88/88 green** on impl#1 (independently re-runnable).
- Commit `ab8eef6a` passed the full pre-commit hook (green landing). Coherence `origin/main...HEAD` = `0 2`.
- Empirical-first: every code probe-captured from impl#1, cross-checked against §41.15 / §41.16 read in full.
  **No impl#1-vs-SPEC divergence** in the codes.

## Escalation (harness — tableFor tbody-hoist)
tableFor's row cells render into an each-mount `<div>`; the conformance adapter mounts via
`document.body.innerHTML = …` (string parse), and the HTML parser HOISTS a `<div>` out of `<tbody>` (invalid
table content) → the live `<tbody>` is EMPTY and the 6 cells sit in a sibling `<div>` before the table
(`<thead>` is intact). The `tablefor-render-rt` case asserts the impl-neutral effect (3 `th` + 6 `td`)
**location-agnostically** (total counts, never tbody nesting). Likely a **string-mount harness artifact** — a
real browser hydrates via DOM APIs (the §52.8 D2 DOM-adoption path), not innerHTML string-parse — so probably
NOT an impl bug, but a `<div>` mount inside `<tbody>` is table-context-fragile.
→ **PA:** confirm harness-artifact vs a tableFor table-mount codegen fix; if the former, a future adapter that
mounts via DOM APIs (the ss60 E-ADAPTER extension) would let the render-rt case tighten to tbody nesting.

## Notes for the PA
- Re-integrate via S67 file-delta: pure-additive `conformance/cases/schema-for/*` (4) + `table-for/*` (5). Clean.
- Worktree `../scrml-spa-ss61` left clean; `node_modules` symlinked into main — don't copy.
- `spa-lists/ss61-conformance-l22-family.md` markers (items 2-3 → landed `ab8eef6a`) + `ss61.progress.md`
  continuation section written in MAIN's working tree (uncommitted).
- **Process flag:** I booted for `ss63` which has no list. Several sPA worktrees (ss55/56/58/59/62) show
  parallel sessions; **ss62 has a LIVE session actively authoring** (I backed off it cleanly earlier). Worth a
  PA check that lists aren't double-assigned and that a `ss63` list is (or isn't) intended.
