# progress — s453-transaction-exit-rollback (append-only)

- 2026-10-04 startup gate PASS: worktree `.claude/worktrees/agent-a39fec154f2df3fc2`, `--show-toplevel` equal, tree clean, `merge-base HEAD origin/main` == `origin/main` == `df6dad5a`. `bun install` OK (exit 0).
- 2026-10-04 maps: `primary.map.md` read targeted. **`E-TRANSACTION-CONTROL-FLOW` returns ZERO hits across all 13 maps** — no routing row for this diagnostic. What IS load-bearing: the S449-wrap Task-Shape Routing row (`primary.map.md:1498`) for the `_scrml_db_guard` / transaction surface, and the S449-wrap READ-FIRST `#1251` block (`:1270-1277`).
- 2026-10-04 merge: branch `fix/s453-transaction-exit-rollback` from `df6dad5a`; merged `hold-s450` (`69cdaa98`) → `fe16eb52` (true 2-parent merge, first parent on main). 5 conflicts, all resolved 3-way:
  - `emit-logic.ts` — #1264 moved the default handle from the literal `"_scrml_sql"` to `fallbackSqlHandle()`; kept main's, added the hold's four new vars. **This is the one real source-level interaction of the ~30-PR window.**
  - `SPEC.md §19.10.4` — S451 superseded the pre-S450 "Explicit `?{BEGIN}` … SHALL remain valid" bullet with two bullets (E-ERROR-015, manual tx outside `!`). Kept S451's, dropped the superseded one, appended the hold's three new bullets + both provenance notes.
  - `SPEC.md §19.13` + `§34` E-ERROR-001/002 rows — both sides' content survives: E-ERROR-001 takes the hold's `§19.3.3, §19.10.4` row, E-ERROR-002 keeps S451's R11 + client-server-call triggers. Verified both tables agree (2 identical E-ERROR-001 rows, 2 S451 E-ERROR-002 rows).
  - `docs/FACTS.md`, `compiler/SPEC-INDEX.md`, `known-gaps.md` gap-counts — generated; took main's, regenerate at the end.
- NEXT: pretest, then re-run the hold's 14 integration + 28 unit tests on the merged tree (verification item 1) before any B1a edit.
