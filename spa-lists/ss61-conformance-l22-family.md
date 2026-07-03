# sPA ss61 — conformance authoring: L22 type-as-argument family (schemaFor · tableFor · parseVariant)

**Launch:** `read spa.md ss61` · **Branch:** `spa/ss61` · **Worktree:** `../scrml-spa-ss61`

**Fill:** conformance-authoring toward the freeze bar (S235), Tier-2 (secondary-but-flagship-adjacent). The L22 type-as-argument family (§41.13-16 / §53.14) is a shipped language primitive; formFor's runtime half is covered in ss57, but **schemaFor §41.15, tableFor §41.16, and parseVariant §41.13 are UNCOVERED** (zero cases) despite carrying ~25 error codes between them. NEW S235 · **fireable now** (data-only; disjoint).

**Method + harness ceiling + escalate discipline:** see `spa-lists/ss56-conformance-engine-51.md` §"What conformance authoring IS" (same). All three members are harness-clean (compile-time type-walk → emitted markup/DDL/value; no timers/DB/WS).

## Shared ingestion
The type-as-argument family: §53.14 (family framing + discipline) · §41.13 parseVariant (JSON→tagged-variant boundary parse; `ParseError` enum) · §41.15 schemaFor (struct→`<schema>` SQL DDL) · §41.16 tableFor (struct+rows→`<table>`). Mirror `conformance/cases/form-for/` (the sibling family member).

## Core files
`conformance/README.md` · `conformance/cases/form-for/` (existing sibling) · `conformance/run.ts` · `compiler/SPEC.md` §41.13 + §41.15 + §41.16 + §53.14 (normative)

## Items (least-ingestion-first)
1. **parseVariant §41.13** (RT+codes) `[status=pending]` — `parseVariant(json, EnumType)` → the tagged variant; the `ParseError` failure variants (`MissingDiscriminator` / `UnknownVariant` / `InvalidPayload` / `Malformed`) route through `!{}`. RT: a valid JSON → the variant value in state; an invalid → the error variant. + the 4 `E-PARSEVARIANT-*` codes.
2. **schemaFor §41.15** (RT/shape + codes) `[status=pending]` — `schemaFor(StructType)` emits `<schema>` SQL DDL from the struct's field predicates (§39+L4 vocab; enum-lowering per OQ-SCH-12). Assert the emitted DDL shape (impl-freedom on exact SQL text → assert the STATE/structural effect, not byte-for-byte SQL) + the 8 `E-SCHEMAFOR-*` codes (type-not-struct, etc.).
3. **tableFor §41.16** (RT+codes) `[status=pending]` — `tableFor(StructType, rows)` renders an auto-`<table>` (header from struct fields + a row per element). RT: `domAnchored` on the table cells; + the 13 `E-TABLEFOR-*` codes.

**DoD:** the L22 family (all 4 members incl. ss57's formFor) reaches conformance coverage; all green on `bun conformance/run.ts`; divergences escalated.

## Progress
`spa-lists/ss61.progress.md`. Land per-item on `spa/ss61`; ping PA inbox. Do NOT push. PA re-integrates + run.ts green. ESCALATE impl#1-vs-SPEC divergences.
