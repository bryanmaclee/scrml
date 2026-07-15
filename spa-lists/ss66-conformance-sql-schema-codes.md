# sPA ss66 — conformance: SQL §8 + schema §39 COMPILE-TIME codes

**Launch:** `read spa.md ss66` · **Branch:** `spa/ss66` · **Worktree:** `../scrml-spa-ss66`

**Fill:** conformance-authoring cluster (compile-time codes), ~17-22 cases (FAT — two ordered sub-batches) · NEW S252

## Shared ingestion
Author conformance cases pinning the **compile-time diagnostic codes** of the SQL (§8) + schema (§39)
data layer — both **0-covered** (verified; the existing `schema-for/` cases pin the DIFFERENT
`E-SCHEMAFOR-*` §41.15 family — do NOT confuse). All **COMPILE-TIME** (code presence/absence only;
emitted DDL/SQL = impl-freedom). Runtime SQL execution (writes/WHERE/transactions/§8.7 `SqlError`) is a
SEPARATE, BLOCKED surface — see ss67 + the residual note; do NOT author runtime cases here. **Mirror
`conformance/cases/schema-for/`** for the code-neg shape. Order: §8 batch first (warms §8), then §39.
Read the README case-format section FIRST.

## Core files
`conformance/README.md` · `conformance/run.ts` · `compiler/SPEC.md` §8 (**codes §8.6 ~6424-6440**) +
§39 (**codes §39.12 ~20983-20999**) · `conformance/cases/schema-for/` (pattern-to-mirror)

## Items — BATCH 1: §8 SQL codes (author each; commit per-case; codes-only)
1. **`sql-invalid-neg`** `[parked: GAP — E-SQL-002 has zero emission; no compile-time SQL-syntax validation]` → **E-SQL-002**.
2. **`sql-no-db-ancestor-neg`** `[parked: GAP — E-SQL-004 is comment-only; compiler falls back to :memory: (emit-tool.ts:117)]` → **E-SQL-004**.
3. **`sql-bad-conn-prefix-neg`** `[LANDED: conformance/cases/sql/bad-conn-prefix-neg]` → **E-SQL-005**.
4. **`sql-prepare-neg`** `[parked: NOT compile-pinnable — E-SQL-006 fires only via direct rewriteSqlRefs(); compile() emits a runtime-throwing IIFE (emit-logic.ts:3081)]` → **E-SQL-006**.
5. **`sql-non-async-neg`** `[parked: GAP — E-SQL-007 zero emission (no async surface in scrml)]` → **E-SQL-007**.
6. **`sql-unterminated-neg`** `[parked: NOT compile-pinnable — unbalanced ?{ trips E-CTX-003 first; E-SQL-008 fires only via direct parseExpression()]` → **E-SQL-008**.
7. **`sql-batch-001-neg`** `[parked: NOT compile-pinnable — transaction{} mis-parses to E-SCOPE-001; E-BATCH-001 needs a hand-built AST → runBatchPlanner]` → **E-BATCH-001**.
8. **`sql-batch-002-neg`** `[parked: NOT a compile diagnostic — runtime throw in emitted JS (emit-control-flow.ts:840)]` → **E-BATCH-002**.
9. **`sql-batch-warn-info`** `[LANDED: conformance/cases/sql/batch-warn-info — severity=WARNING per SPEC §8.6, list "info" is WRONG]` → **W-BATCH-001**.
10. **`sql-clean-pos`** `[LANDED: conformance/cases/sql/clean-pos]` → `notCodePrefixes:["E-SQL-","E-BATCH-"]`.

## Items — BATCH 2: §39 schema codes (author each; commit per-case; codes-only)
11-12. **`schema-{001,002}-neg`** `[parked: GAP — E-SCHEMA-001/002 zero emission]` → E-SCHEMA-001/002.
13. **`schema-003-neg`** `[LANDED: conformance/cases/schema/schema-003-neg]` → **E-SCHEMA-003** (the ONLY §39.12 error code actually emitted at compile-time, via gauntlet placement check).
14-19. **`schema-{004..009}-neg`** `[parked: GAP — E-SCHEMA-004..009 zero emission; the <schema> DSL body is not validated on the string-compile path; 007/008/009 are migration/live-DB-time anyway]` → E-SCHEMA-004..009.
20. **`schema-warn-001-info`** `[parked: GAP — W-SCHEMA-001 zero emission]` → W-SCHEMA-001.
21. **`schema-warn-002-info`** `[parked: NOT compile-pinnable — W-SCHEMA-002 emitted at migration-diff time (schema-differ.js:338/350), needs a live DB; severity=warning not info]` → W-SCHEMA-002.
22. **`schema-warn-003-info`** `[parked: GAP — W-SCHEMA-003 needs a live out-of-sync DB]` → W-SCHEMA-003.
23. **`schema-clean-pos`** `[LANDED: conformance/cases/schema/clean-pos]` → `notCodePrefixes:["E-SCHEMA-"]`.

> **sPA ss66 outcome (2026-07-12):** 5 of 23 items LANDED on `spa/ss66` (391/391 conformance pass). The other 18
> could NOT be authored as passing conformance cases: **13 are SPEC-vs-compiler GAPs** (the §8.6/§39.12 code tables
> claim codes with zero diagnostic emission — corpus ahead of compiler), and **5 have real emission but are
> unreachable via the conformance `compile(source)` path** (sub-`compile()` API only, a runtime throw, or
> migration-diff/live-DB time). See `ss66.progress.md` + the re-integration hand-off for the full ledger. This is a
> footprint finding for the PA: most of §8.6/§39.12 is not compile-time code-pinnable as the list assumed.

> Note: migration diff (§39.6) + `scrml migrate` (§39.8) are compile/CLI-time and code-pinnable here IF a
> code fires; if a sub-surface has no adopter-visible code, SKIP it (coverage is of CLAIMED codes/effects).

## Progress
`ss66.progress.md`. Land on `spa/ss66`; ping the PA inbox when ready. Do not touch main / do not push.

## Wave-2 — tier-1 code-exhaustive completion (S256 audit)
BATCH-1/2 above are LANDED (5 authored, 18 GAP/unreachable — see the ss66 outcome note). This section
adds the tier-1 SQL/schema/CPS-boundary codes the S256 tier split places in tier-1 (server/data
contract). **HEED the ss66 landed finding: much of §8.6/§39.12 is NOT compile-time code-pinnable via the
conformance `compile(source)` path** (sub-`compile()` API only, runtime throw, or migration/live-DB time).
For each code below: probe live FIRST; if it fires on the `compile(source)` path → author pos+neg; if it
matches a landed ss66 GAP/unreachable finding → do NOT force a case, hand a **known-gap** entry to the PA
(the SPEC §8.6/§39.12 code table claims a code the compiler never emits = corpus-ahead-of-compiler). Grep
each code live in `compiler/src` for the exact trigger + reachability.

16. **E-SQL-006** (codes) `[status=probe — landed-note: NOT compile-pinnable]` — `.prepare()` is removed in Bun.SQL — use `.all()/.get()/.run()` or bare `?{}` (§44.3; `codegen/rewrite.ts:362`). ss66 found it fires only via direct `rewriteSqlRefs()`; `compile()` emits a runtime-throwing IIFE. Probe; if still unreachable → known-gap.
17. **E-SQL-008** (codes) `[status=probe — landed-note: E-CTX-003 fires first]` — an unterminated `?{}` SQL diagnostic (`ast-builder.js:351`). ss66 found unbalanced `?{` trips `E-CTX-003` first. Probe for an isolable trigger; else known-gap.
18. **E-SQL-009** (codes) `[status=pending]` — an emit-tool SQL error (`codegen/emit-tool.ts:906`). Grep the exact trigger + reachability; pos + neg or known-gap.
19. **E-SQL-ROW-CONTRACT-MISMATCH** (codes) `[status=pending]` — a SQL projection row passed to a prop mismatches the prop's row contract (`type-system.ts:13090`). Pos + neg (matching row shape → silent). (This one IS compile-time type-checked — likely authorable.)
20. **E-SCHEMA-004** (codes) `[status=probe — landed-note: GAP zero-emission]` — a schema column error (`gauntlet-phase1-checks.js:781`, "column …"). ss66 found E-SCHEMA-004..009 have zero emission on the string-compile path. Probe; if still zero → known-gap.
21. **E-CG-006** (codes) `[status=pending]` — a non-client-boundary node found in a client-boundary function body (`codegen/scheduling.ts:462`). Pos (a server-only stmt in a client-boundary fn → E-CG-006) + neg. (Codegen-soundness on the client/server split — verify it's V1-path, not an OFF-V1 codegen invariant.)
22. **E-BATCH-001** (codes) `[status=probe — landed-note: needs hand-built AST]` — a SQL batch-planner error (`batch-planner.ts:89` union). ss66 found `transaction{}` mis-parses to `E-SCOPE-001`; E-BATCH-001 needs a hand-built AST → `runBatchPlanner`. Probe; if unreachable via `compile(source)` → known-gap. (TIER-SPLIT tier-1 server family; the brief omitted it — added here for coverage.)

**Wave-2 DoD:** the 7 codes each PROBED for compile-path reachability; the authorable ones pinned; the
unreachable/GAP ones handed to the PA as known-gap entries (NOT forced). run.ts green; divergences ESCALATED.
