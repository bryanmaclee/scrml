# sPA ss69 — conformance authoring: type-system soundness §14/§53 + state-soundness §54 (freeze-gate, WAVE A)

**Launch:** `read spa.md ss69` · **Branch:** `spa/ss69` · **Worktree:** `../scrml-spa-ss69`

**Fill:** conformance-authoring toward the FREEZE bar (S256 tier-1). The type system's core guarantees
(§14 structural typing · §53 refinement · §42 `not`-unified-absence · §54 state literals) have ~zero
error-coverage — the S256 audit puts **~17 type + 4 state-soundness codes** in tier-1 (the "type system's
guarantees" family). This is the silent-wrong class: a mis-typed value that compiles is a soundness hole.
NEW S256 · **fireable now** (pure conformance-corpus data — disjoint). Enumerates the CODES; the fired
sPA authors the `.scrml`.

## What conformance authoring IS (the method)
Identical to `spa-lists/ss56-conformance-engine-51.md` §"What conformance authoring IS" — author from
impl#1 → SANITY-CHECK vs SPEC §14/§53/§42/§54 → ESCALATE divergences; verify GREEN on
`bun conformance/run.ts`; schema in `conformance/README.md`. Grep each code live in `compiler/src`
(`type-system.ts` mostly) for the exact trigger before authoring. Harness-clean (compile-time).

> **Scope note:** the MATCH-facing type codes **E-TYPE-006/024/025/026** live in **ss71** (match §18), NOT
> here (they are the match-exhaustiveness contract). This list is the non-match type + state set.

## Core files
`conformance/README.md` · `spa-lists/ss56-conformance-engine-51.md` (method §) ·
`conformance/cases/enum/` + `conformance/cases/refinement/` + `conformance/cases/block-grammar/` (mirror) ·
`compiler/src/type-system.ts` (the §14/§42/§53 checks) · `compiler/SPEC.md` §14 + §42 + §53 + §54 (normative)

## Items — type soundness §14/§42/§53 (one code per item; reject-path pos + clean neg)
1. **E-TYPE-004** (codes) `[status=pending]` — a value does not have a field named `X` (§14 structural access; `type-system.ts:13021`). Pos (field access on a struct lacking the field → E-TYPE-004) + neg.
2. **E-TYPE-022** (codes) `[status=pending]` — a state-child value/type mismatch (`symbol-table.ts:7447`, "state-child ..."). Pos + neg.
3. **E-TYPE-041** (codes) `[status=pending]` — `Cannot assign X to Y` — assignment type mismatch (`type-system.ts:10054`). Pos + neg (matching types → silent).
4. **E-TYPE-042** (codes) `[status=pending]` — `` `op not` `` is not a valid absence check — use `is not` (§42; `codegen/rewrite.ts:1047/1056`). Pos + neg (`is not` form → silent).
5. **E-TYPE-045** (codes) `[status=pending]` — prefix `not` is not valid as boolean negation (§42; `type-system.ts:18932`). Pos + neg (`not` as unified-absence → silent).
6. **E-TYPE-062** (codes) `[status=pending]` — LHS of `is` must be an enum-typed value (`type-system.ts:13332`). Pos + neg (enum-typed LHS → silent).
7. **E-TYPE-071** (codes) `[status=pending]` — a type-soundness check emitted in codegen rewrite (`codegen/rewrite.ts:2264`). Grep the exact trigger; pos + neg.
8. **E-TYPE-081** (codes) `[status=pending]` — `partial match` not valid in a rendering/lift context (`type-system.ts:9237`). Pos + neg (`partial match` in a value context → silent).
9. **E-TYPE-ANY-FORBIDDEN** (codes) `[status=pending]` — the `any` token is rejected (§14; `type-system.ts:5463`). Pos (a declared `any` type → E-TYPE-ANY-FORBIDDEN) + neg (a concrete type → silent).
10. **E-TYPE-LIFECYCLE-ON-ENGINE-CELL** (codes) `[status=pending]` — a lifecycle annotation on an engine cell (`type-system.ts:4013`). Pos + neg.
11. **E-TYPE-LIFECYCLE-VARIANT-NOT-TRANSITIONED** (codes) `[status=pending]` — a lifecycle-variant binding never transitioned (`type-system.ts:25687`). Pos + neg.

## Items — struct + state soundness §54 (reject-path pos + clean neg)
12. **E-STRUCT-FUNCTION-FIELD** (codes) `[status=pending]` — a struct field typed as a function (forbidden; `type-system.ts:4109`). Pos + neg (value-typed fields → silent).
13. **E-STATE-COMPLETE** (codes) `[status=pending]` — the state-literal completeness check (§54.6.1; `type-system.ts:23924`) — a state literal missing required fields. Pos + neg (complete state literal → silent).
14. **E-STATE-TERMINAL-MUTATION** (codes) `[status=pending]` — `Cannot write field X` of a terminal state (§54; `type-system.ts:7692`). Pos + neg (write to a non-terminal state → silent).
15. **E-STATE-TRANSITION-ILLEGAL** (codes) `[status=pending]` — an illegal state transition call ("Declared transitions: …", `type-system.ts:7606`). Pos + neg (a declared transition → silent).
16. **E-STATE-UNDECLARED** (codes) `[status=pending]` — a bare state reference that is undeclared (`type-system.ts:7471`). Pos + neg (declared state → silent).

**Definition of done:** all 16 type/state-soundness codes pinned (codes-half; reject pos + clean neg per
code); every case GREEN on `bun conformance/run.ts`; any impl#1-vs-SPEC divergence ESCALATED. Outcome:
the type-system + state-literal soundness edge moves from ~zero-coverage to conformance-covered.

## Progress
`spa-lists/ss69.progress.md`. Land per-item on `spa/ss69`; ping the PA inbox per item. Do NOT advance
main / push. PA re-integrates via file-delta + confirms run.ts green. ESCALATE (do not decide) any
impl#1-vs-SPEC divergence.
