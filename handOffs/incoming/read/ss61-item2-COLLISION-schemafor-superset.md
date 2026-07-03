# sPA ss61 → PA · CROSS-SESSION COLLISION on item 2 (schemaFor) + a parked compiler bug

**List:** `spa-lists/ss61-conformance-l22-family.md` · **Item:** 2 — schemaFor §41.15
**TL;DR:** ss61 is fully landed + green (88/88) via a two-session collaboration. But schemaFor was authored TWICE in parallel — a sibling landed a PARTIAL set (3/8 codes) on `spa/ss61`; MY dispatched agent produced the COMPLETE set (8/8 codes + 4 structural proxies + a real compiler-bug finding) on a preserved branch. **Dedup + a bug are yours to rule.** I did NOT land my set (avoids double-coverage + pre-empting your curation).

## What's on spa/ss61 NOW (verified git state, tip `ab8eef6a`, 88/88 green)
- Sibling's schema-for (4 dirs): `schemafor-happy`, `schemafor-pick-invalid-field`, `schemafor-pick-omit-conflict`, `schemafor-type-not-struct` — covers **3 of 8** E-SCHEMAFOR codes.
- Sibling's table-for (item 3, 5 dirs) — complete, no action needed.

## What my agent produced (PRESERVED, not landed)
- **Branch `ss61-schema-for` @ `46ae54cf`** (2 additive commits `47b04bc5` + `46ae54cf`; base `2a37e296` = my item-1). Worktree `.claude/worktrees/ss61-schema-for`. **Left intact for you to cherry-pick.**
- **12 dirs, ALL 8 E-SCHEMAFOR codes** (`error-type-not-struct`, `error-pick-invalid-field`, `error-omit-invalid-field`, `error-pick-omit-conflict`, `error-nested-struct-no-fk`, `error-no-sql-mapping`, `error-variant-payload-enum`, `error-invalid-call-context`) + 4 structural-effect proxies (`happy-canonical-expansion`, `happy-enum-lowering`, `happy-nullable-field`, `happy-multi-table-composition`). Naming: `error-*`/`happy-*` (vs sibling's `schemafor-*`).
- The 5 codes the sibling did NOT cover: **OMIT-INVALID-FIELD, NESTED-STRUCT-NO-FK, NO-SQL-MAPPING, VARIANT-PAYLOAD-ENUM, INVALID-CALL-CONTEXT.**

## ⚠ Clobber hazard (do NOT wholesale file-delta)
`git checkout ss61-schema-for -- conformance/cases/schema-for/` would **DELETE the sibling's 4 `schemafor-*` dirs** (they don't exist on my stale-base branch) — the file-delta-vs-cherry-pick clobber class. **Cherry-pick `47b04bc5`+`46ae54cf`** (purely additive, disjoint dirs) OR file-delta only my 12 named dirs.

## Recommendation (your call — curation is PA-owned)
Adopt my complete 12-case set + retire the sibling's 4 (single authorship, consistent `error-*`/`happy-*` naming, all 8 codes). Cheapest coverage-complete outcome. Alternative: keep both (harmless duplication, mixed naming). Either way the DoD "L22 family reaches conformance coverage" wants all 8 codes — the sibling's 3/8 alone is incomplete.

## 🐛 PARKED compiler bug (surfaced ONLY by my agent's deeper pass — sibling reported "no divergence")
**`E-SCHEMAFOR-NO-SQL-MAPPING` does NOT fire for a canonical postfix `T[]` array struct field.** SPEC §41.15.8 + the §34 row list arrays as a NO-SQL-MAPPING trigger, and SPEC's own struct examples use postfix `T[]` (SPEC.md:9904 `tabs: Tab[]`, :15856 `crossings: string[]`). Empirically a `field: string[]` is silently ACCEPTED and mis-lowered to a scalar `text` column (impl#1 `classifyFieldForSql` resolves `T[]` → `{kind:"primitive"}`, dropping `[]`); only the NON-canonical bracket form `[T]` resolves to `{kind:"array"}` and fires (that's what the locked `schema-for.test.js §7` uses). My `error-no-sql-mapping` case sidesteps this with the SPEC-named union trigger `string | integer` (fires correctly). **PA: classify — codegen bug in the SQL field-resolver vs struct-parser quirk (root cause upstream of `classifyFieldForSql`, not fully traced).**

**Independent cross-confirmation:** the sibling's `schemafor-happy` reached my exact (b)-surface conclusion — schemaFor's DDL is a compile-time/server migration artifact, NOT client-runtime-observable, so codes are the sound contract. Two independent authors converging strengthens it.

ss61 is DONE from my side (item 1 mine; 2+3 landed; schemaFor superset escalated). Standing ss61 down.
