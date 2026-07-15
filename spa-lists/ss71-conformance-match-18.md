# sPA ss71 — conformance authoring: match / exhaustiveness §18 (freeze-gate, WAVE B pillar-contract)

**Launch:** `read spa.md ss71` · **Branch:** `spa/ss71` · **Worktree:** `../scrml-spa-ss71`

**Fill:** conformance-authoring toward the FREEZE bar (S256 tier-1). `match` (§18) is a language pillar —
the value/markup pattern-dispatch primitive, and its **exhaustiveness contract** is a soundness guarantee
(a non-exhaustive match over a variant is a runtime hole). The S256 audit puts **~12 match codes** in
tier-1; the built suite's `match-block`/`match-identifier` cases cover the happy path, not the reject
edges. NEW S256 · **fireable now** (pure conformance-corpus data — disjoint). Enumerates the CODES; the
fired sPA authors the `.scrml`.

## What conformance authoring IS (the method)
Identical to `spa-lists/ss56-conformance-engine-51.md` §"What conformance authoring IS" — author from
impl#1 → SANITY-CHECK vs SPEC §18 → ESCALATE divergences; verify GREEN on `bun conformance/run.ts`;
schema in `conformance/README.md`. Grep each code live in `compiler/src` (`type-system.ts` +
`symbol-table.ts` + `codegen/rewrite.ts`) for the exact trigger. Harness-clean (compile-time).
> This list also owns the four **match-facing type codes** `E-TYPE-006/024/025/026` (the exhaustiveness /
> matchable-subject contract) — they are NOT in ss69.

## Core files
`conformance/README.md` · `spa-lists/ss56-conformance-engine-51.md` (method §) ·
`conformance/cases/match-block/` + `conformance/cases/match-identifier/` (mirror) ·
`compiler/src/type-system.ts` (match exhaustiveness) + `symbol-table.ts` (match placement) ·
`compiler/SPEC.md` §18 (normative — read the named subsection per code)

## Items (one code per item; reject-path pos + clean neg)
1. **E-MATCH-012** (codes) `[status=pending]` — a `T | not` union match missing the `not` arm (`type-system.ts:16954`). Pos (match over `T | not` without a `not` arm → E-MATCH-012) + neg (exhaustive `not` arm → silent).
2. **E-MATCH-ARM-MARKUP-IN-VALUE** (codes) `[status=pending]` — markup in a value-form match arm (`type-system.ts:16420`). Pos + neg (value expression in a value-form arm → silent).
3. **E-MATCH-BLOCK-IN-LIFT** (codes) `[status=pending]` — a block match arm inside a `lift` context (`validators/post-ce-invariant.ts:107`, "A block ..."). Pos + neg.
4. **E-MATCH-EFFECT-FORBIDDEN** (codes) `[status=pending]` — an effect inside a value-context match arm (`symbol-table.ts:12971`). Pos + neg (pure arm → silent).
5. **E-MATCH-ON-REQUIRED** (codes) `[status=pending]` — a `match` that needs an `on=` scrutinee (`symbol-table.ts:12398`). Pos + neg (`on=` present → silent).
6. **E-MATCH-ONTRANSITION-FORBIDDEN** (codes) `[status=pending]` — `<onTransition>` forbidden inside a match arm (`symbol-table.ts:12989`). Pos + neg.
7. **E-SYNTAX-010** (codes) `[status=pending]` — an `else` arm not last (§18.6; `type-system.ts:16490`) OR `null`/etc. as a value → use `not` (§42; `codegen/rewrite.ts:1067`). Pos + neg (else-last / `not` → silent). Grep to confirm which trigger fires in the match context.
8. **E-SYNTAX-011** (codes) `[status=pending]` — match arm guard-clause misuse (`type-system.ts:16481`). Pos + neg (valid guard → silent).
9. **E-TYPE-006** (codes) `[status=pending]` — a non-exhaustive multi-scrutinee match (`type-system.ts:16785`). Pos (multi-scrutinee match missing a combination → E-TYPE-006) + neg (exhaustive → silent).
10. **E-TYPE-024** (codes) `[status=pending]` — cannot match on a struct-typed subject (`type-system.ts:16535`). Pos + neg (an enum-typed subject → silent).
11. **E-TYPE-025** (codes) `[status=pending]` — cannot match on a non-matchable subject (`type-system.ts:16546`). Pos + neg.
12. **E-TYPE-026** (codes) `[status=pending]` — a match used where a logic interpolation is required ("Wrap the match in a logic interpolation …", `type-system.ts:9197/16785 area`). Pos + neg.

**Definition of done:** all 12 match/exhaustiveness codes pinned (codes-half; reject pos + clean neg per
code); run.ts green; divergences ESCALATED. The match pillar's diagnostic edge moves to conformance-covered.

## Progress
`spa-lists/ss71.progress.md`. Land per-item on `spa/ss71`; ping the PA inbox per item. Do NOT advance
main / push. PA re-integrates via file-delta + confirms run.ts green. ESCALATE (do not decide) any
impl#1-vs-SPEC divergence.
