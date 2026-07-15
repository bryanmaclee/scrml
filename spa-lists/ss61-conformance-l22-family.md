# sPA ss61 — conformance authoring: L22 type-as-argument family (schemaFor · tableFor · parseVariant)

**Launch:** `read spa.md ss61` · **Branch:** `spa/ss61` · **Worktree:** `../scrml-spa-ss61`

**Fill:** conformance-authoring toward the freeze bar (S235), Tier-2 (secondary-but-flagship-adjacent). The L22 type-as-argument family (§41.13-16 / §53.14) is a shipped language primitive; formFor's runtime half is covered in ss57, but **schemaFor §41.15, tableFor §41.16, and parseVariant §41.13 are UNCOVERED** (zero cases) despite carrying ~25 error codes between them. NEW S235 · **fireable now** (data-only; disjoint).

**Method + harness ceiling + escalate discipline:** see `spa-lists/ss56-conformance-engine-51.md` §"What conformance authoring IS" (same). All three members are harness-clean (compile-time type-walk → emitted markup/DDL/value; no timers/DB/WS).

## Shared ingestion
The type-as-argument family: §53.14 (family framing + discipline) · §41.13 parseVariant (JSON→tagged-variant boundary parse; `ParseError` enum) · §41.15 schemaFor (struct→`<schema>` SQL DDL) · §41.16 tableFor (struct+rows→`<table>`). Mirror `conformance/cases/form-for/` (the sibling family member).

## Core files
`conformance/README.md` · `conformance/cases/form-for/` (existing sibling) · `conformance/run.ts` · `compiler/SPEC.md` §41.13 + §41.15 + §41.16 + §53.14 (normative)

## Items (least-ingestion-first)
1. **parseVariant §41.13** (RT+codes) `[status=landed-on-branch SHA=2a37e296]` — `parseVariant(json, EnumType)` → the tagged variant; the `ParseError` failure variants (`MissingDiscriminator` / `UnknownVariant` / `InvalidPayload` / `Malformed`) route through `!{}`. RT: a valid JSON → the variant value in state; an invalid → the error variant. + the 4 `E-PARSEVARIANT-*` codes.
2. **schemaFor §41.15** (RT/shape + codes) `[status=landed-on-branch SHA=ab8eef6a]` — `schemaFor(StructType)` emits `<schema>` SQL DDL from the struct's field predicates (§39+L4 vocab; enum-lowering per OQ-SCH-12). Assert the emitted DDL shape (impl-freedom on exact SQL text → assert the STATE/structural effect, not byte-for-byte SQL) + the 8 `E-SCHEMAFOR-*` codes (type-not-struct, etc.).
3. **tableFor §41.16** (RT+codes) `[status=landed-on-branch SHA=ab8eef6a]` — `tableFor(StructType, rows)` renders an auto-`<table>` (header from struct fields + a row per element). RT: `domAnchored` on the table cells; + the 13 `E-TABLEFOR-*` codes.

**DoD:** the L22 family (all 4 members incl. ss57's formFor) reaches conformance coverage; all green on `bun conformance/run.ts`; divergences escalated.

## Progress
`spa-lists/ss61.progress.md`. Land per-item on `spa/ss61`; ping PA inbox. Do NOT push. PA re-integrates + run.ts green. ESCALATE impl#1-vs-SPEC divergences.

## Wave-2 — tier-1 code-exhaustive completion (S256 audit)
Items 1-3 above are LANDED — do NOT touch them. This section pins the **formFor §41.14 reject-path codes**
(the asymmetrically-uncovered edge: schemaFor/tableFor error paths ARE pinned in items 2-3; formFor's
aren't — FINDINGS) + any remaining **tableFor** tier-1. Same method + core files as above. Grep each code
live in `compiler/src/type-system.ts` (the formFor/tableFor type-walk emitters) for the exact trigger.
Harness-clean (compile-time type-walk).
> **VERIFY-FIRST (tableFor):** landed item-3 asserts it covered "the 13 E-TABLEFOR-* codes." The 5
> E-TABLEFOR-* below are in the S256 candidate-holes (unasserted at audit HEAD `3b2b5f53`) — CHECK whether
> item-3's cases already assert each; if covered, mark done (no dup case). If the audit HEAD predates the
> ss61 landing, they may already be green. Author only the genuinely-uncovered ones.

**formFor §41.14 (the 9 reject-path codes — all in `type-system.ts` ~19281-19539):**
4. **E-FORMFOR-TYPE-NOT-STRUCT** (codes) `[status=pending]` — `formFor(NonStruct)` (`type-system.ts:19281`). Pos + neg (a `:struct` arg → silent).
5. **E-FORMFOR-NOT-IMPORTED** (codes) `[status=pending]` — `formFor` used without its import (`type-system.ts:8719`). Pos + neg.
6. **E-FORMFOR-PICK-INVALID-FIELD** (codes) `[status=pending]` — `pick(...)` names a field not on the struct (`type-system.ts:19345`). Pos + neg.
7. **E-FORMFOR-OMIT-INVALID-FIELD** (codes) `[status=pending]` — `omit(...)` names an unknown field (`type-system.ts:19370`). Pos + neg.
8. **E-FORMFOR-PICK-OMIT-CONFLICT** (codes) `[status=pending]` — `pick` + `omit` conflict (`type-system.ts:19331`). Pos + neg.
9. **E-FORMFOR-ERROR-STRATEGY-INVALID** (codes) `[status=pending]` — an invalid error-strategy (`type-system.ts:19403`). Pos + neg.
10. **E-FORMFOR-SLOT-UNKNOWN** (codes) `[status=pending]` — a `slot=` names an unknown field (`type-system.ts:19446`). Pos + neg.
11. **E-FORMFOR-NESTED-STRUCT-NO-SLOT** (codes) `[status=pending]` — a nested struct field with no slot (`type-system.ts:19482`). Pos + neg.
12. **E-FORMFOR-ONSUBMIT-SIGNATURE** (codes) `[status=pending]` — an `onSubmit` handler signature mismatch (`type-system.ts:19539`). Pos + neg.

**tableFor §41.16 remaining (verify vs landed item-3 first):**
13. **E-TABLEFOR-ROWS-WRONG-TYPE** (codes) `[status=verify-vs-item3]` — `rows=` wrong type (`type-system.ts:20592`). Pos + neg.
14. **E-TABLEFOR-NESTED-STRUCT-NO-SLOT** (codes) `[status=verify-vs-item3]` — nested struct, no slot (`type-system.ts:20881`). Pos + neg.
15. **E-TABLEFOR-VARIANT-PAYLOAD-ENUM-V1** (codes) `[status=verify-vs-item3]` — a variant-payload enum (v1 limit; `type-system.ts:20892`). Pos + neg.
16. **E-TABLEFOR-NO-DISPLAY-MAPPING** (codes) `[status=verify-vs-item3]` — no display mapping (`type-system.ts:20903`). Pos + neg.
17. **E-TABLEFOR-SORTABLE-REQUIRES-CELL-ROWS** (codes) `[status=verify-vs-item3]` — `sortable` requires cell rows (`type-system.ts:20942`). Pos + neg.

**Wave-2 DoD:** the 9 formFor reject codes pinned; the 5 tableFor codes verified-covered-or-authored; run.ts
green; divergences ESCALATED. The L22 formFor asymmetry (happy-path-only) is closed.
