# Progress: parallel-close-2026-05-08

Methodology-driven retroactive correction of S68 ratification (§51.0.P parallel attribute).
Per deep-dive at `/home/bryan/scrmlMaster/scrml-support/docs/deep-dives/parallel-attribute-disposition-2026-05-08.md` Position B (CLOSE) is the only structurally defensible verdict.

## Plan
1. Strike §51.0.P from `compiler/SPEC.md` (lines 20772-20819) + the engine-element-table reference at line 992 + the §51.0.Q.4 compatibility/cross-ref entries at lines 20968 + 20985.
2. Update `compiler/SPEC-INDEX.md` — remove §51.0.P entries (lines 9, 78, 230).
3. Strip parser support:
   - `compiler/src/ast-builder.js` lines 8606-8609 (parallelMatch regex), 8689-8690 (parallel local), 8728-8731 (parallelAttr field on engine-decl).
   - `compiler/src/symbol-table.ts` lines 283-285 (`parallelAttr?` field), 3770-3772 (mirror), 217 (forward-compat doc).
   - `compiler/src/codegen/usage-analyzer.ts` lines 79-80 (engineParallel field), 178 (emptyUsage), 226 (fullUsage), 276 (mergeUsage), 447-449 (engine-decl probe), 461 (engineMeta probe), 23 (doc).
4. Update `docs/PA-SCRML-PRIMER.md` — remove the §7.1 `parallel` bullet (line 230).
5. Update `master-list.md` — strip §51.0.P parallel mentions from line 45 (A7 row prose).
6. Add regression test: assert `<engine for=X parallel>` does NOT produce a parallelAttr field, doesn't error, and that engineParallel flag is gone from FeatureUsage.
7. Update existing tests:
   - `compiler/tests/unit/usage-analyzer.test.js` — remove `engineParallel` skeleton-constructor + bitmap-completeness probe assertions; remove "engine with parallel attr → engineParallel: true" + "without parallel" pair; strip `parallel` from kitchen-sink fixture source.
   - `compiler/tests/unit/a5-2-parser-support.test.js` — remove §A5-2.4 describe block (6 tests); the §A5-2.8 PASS 10.A flow-through test for parallelAttr.
   - `compiler/tests/unit/a5-3-typer-walker.test.js` — remove §A5-3.10 describe block (3 tests).
   - `compiler/tests/unit/engine-binding-b14.test.js` — remove parallelAttr expectation in forward-compat test (line 324).

## Log
- [start] Worktree clean, baseline 9733 pass / 64 skip / 1 todo / 3 unique fail (3 pre-existing self-host parity).
- [step 1] D1 + D3 + D4 + D5 LANDED in commit 4a332d3 — SPEC.md §51.0.P struck (withdrawal block quote replaces section; gap §51.0.O → §51.0.Q intentional); SPEC-INDEX.md 3 sites strikethrough + deep-dive linked; PA primer §7.1 bullet removed; master-list A7 row updated.
- [step 2] D2 LANDED in commit 3840603 — parser support stripped (ast-builder.js parallelMatch regex + parallelAttr field; symbol-table.ts EngineMetadata.parallelAttr + mirror; usage-analyzer.ts engineParallel flag + 2 probe sites + emptyUsage/fullUsage/mergeUsage). Audit-trail comments retained at each strike-site.
- [step 3] D7 LANDED in commit 94abcde — removed 11 parallel-attribute test sites; inverted b14 forward-compat assertion. Full suite back to 3 fails (the pre-existing self-host parity).
- [step 4] D6 LANDED in commit 0c28019 — added parallel-close-regression.test.js (6 tests). Full suite 9728 pass / 64 skip / 1 todo / 3 fail.
