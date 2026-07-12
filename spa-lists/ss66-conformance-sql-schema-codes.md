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
1. **`sql-invalid-neg`** `[status=open]` — malformed SQL in `?{}` → **E-SQL-002**.
2. **`sql-no-db-ancestor-neg`** `[status=open]` — `?{}` with no `db=` ancestor `<program>` → **E-SQL-004**.
3. **`sql-bad-conn-prefix-neg`** `[status=open]` — bad connection-string prefix on `db=` → **E-SQL-005**.
4. **`sql-prepare-neg`** `[status=open]` — `.prepare()` use → **E-SQL-006**.
5. **`sql-non-async-neg`** `[status=open]` — non-await `?{}` in a sync context → **E-SQL-007**.
6. **`sql-unterminated-neg`** `[status=open]` — unterminated `?{` block → **E-SQL-008**.
7. **`sql-batch-001-neg`** `[status=open]` — batch violation → **E-BATCH-001**.
8. **`sql-batch-002-neg`** `[status=open]` — batch violation → **E-BATCH-002**.
9. **`sql-batch-warn-info`** `[status=open]` — batch nudge → **W-BATCH-001** (`severity:"info"`).
10. **`sql-clean-pos`** `[status=open]` — a well-formed `<program db=>` + `?{SELECT …}` fires nothing → `notCodePrefixes:["E-SQL-","E-BATCH-"]`.

## Items — BATCH 2: §39 schema codes (author each; commit per-case; codes-only)
11-19. **`schema-{001..009}-neg`** `[status=open]` — one case per **E-SCHEMA-001 … E-SCHEMA-009** (§39.12; read each code's trigger in-section and build the minimal `<schema>` that fires it). Pin exactly the one code.
20-22. **`schema-warn-{001,002,003}-info`** `[status=open]` — **W-SCHEMA-001/002/003** (`severity:"info"`).
23. **`schema-clean-pos`** `[status=open]` — a well-formed `<schema>` (SQL-mirror + shared-core cols) fires nothing → `notCodePrefixes:["E-SCHEMA-"]`.

> Note: migration diff (§39.6) + `scrml migrate` (§39.8) are compile/CLI-time and code-pinnable here IF a
> code fires; if a sub-surface has no adopter-visible code, SKIP it (coverage is of CLAIMED codes/effects).

## Progress
`ss66.progress.md`. Land on `spa/ss66`; ping the PA inbox when ready. Do not touch main / do not push.
