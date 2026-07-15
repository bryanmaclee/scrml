# sPA ss75 — conformance authoring: control-flow §17 + linear §35 (freeze-gate, WAVE C language-boundary)

**Launch:** `read spa.md ss75` · **Branch:** `spa/ss75` · **Worktree:** `../scrml-spa-ss75`

**Fill:** conformance-authoring toward the FREEZE bar (S256 tier-1). Two contracts: **control-flow §17**
(`if=`/`else`/`else-if` placement — a markup-structure guarantee) and **linear types §35** (the `~`
pipeline-accumulator + `lin` single-consumption contract — a soundness guarantee; a linear value used
twice or never is unsound). The S256 audit puts the `E-CTRL-*`, `E-LIN-*`, `E-TILDE-*` sets in tier-1.
NEW S256 · **fireable now** (pure conformance-corpus data — disjoint). Enumerates the CODES; the fired
sPA authors the `.scrml`.

## What conformance authoring IS (the method)
Identical to `spa-lists/ss56-conformance-engine-51.md` §"What conformance authoring IS". Author from
impl#1 → SANITY-CHECK vs SPEC §17 (control-flow) + §35 (linear) → ESCALATE divergences; verify GREEN on
`bun conformance/run.ts`; schema in `conformance/README.md`. Grep each code live in `compiler/src`
(`ast-builder.js` for §17 placement ~8084-17581 + `type-system.ts` for §35 linear ~17015-17523) for the
exact trigger. Harness-clean (compile-time).

## Core files
`conformance/README.md` · `spa-lists/ss56-conformance-engine-51.md` (method §) ·
`conformance/cases/loop/` + `conformance/cases/each/` (mirror for control-flow) ·
`compiler/src/ast-builder.js` (§17 else/else-if placement) + `type-system.ts` (§35 linear) ·
`compiler/SPEC.md` §17 + §35 (normative — read the named subsection per code)

## Items — control-flow §17 (one code per item; reject-path pos + clean neg)
1. **E-CTRL-001** (codes) `[status=pending]` — an `if=`/control-flow placement error (`ast-builder.js:17524`). Grep the exact trigger; pos + neg.
2. **E-CTRL-002** (codes) `[status=pending]` — a control-flow placement sibling (`ast-builder.js:17535`). Grep exact trigger; pos + neg.
3. **E-CTRL-003** (codes) `[status=pending]` — an `else`/`else-if` extending past `else` (`ast-builder.js:17581`). Pos + neg.
4. **E-CTRL-004** (codes) `[status=pending]` — `else`/`else-if` on a state opener (`ast-builder.js:17568`). Pos + neg.
5. **E-CTRL-005** (codes) `[status=pending]` — `else`/`else-if` on the same element as `if=` (`ast-builder.js:17506`). Pos + neg (`else` on a sibling element → silent).
6. **E-CTRL-011** (codes) `[status=pending]` — a control-flow constraint (`ast-builder.js:8084`). Grep exact trigger; pos + neg.
7. **E-CONTROL-FLOW-IN-MARKUP** `[tier-1?]` (codes) `[status=pending]` — a bare control-flow keyword in markup (`ast-builder.js:1851`). Pos + neg. (§17; TIER-SPLIT-silent — added for control-flow completeness, reclassifiable.)
8. **E-LOOP-007** `[tier-1?]` (codes) `[status=pending]` — `while` used as an expression (`type-system.ts:18601`). Pos + neg. (§17; TIER-SPLIT-silent — reclassifiable.)

## Items — linear §35 (reject-path pos + clean neg)
9. **E-LIN-001** (codes) `[status=pending]` — a linear-variable consumption error (`type-system.ts:17492`, "Linear variable …"). Pos + neg (single consumption → silent).
10. **E-LIN-002** (codes) `[status=pending]` — a linear-variable consumption sibling (`type-system.ts:17457`). Pos + neg.
11. **E-LIN-003** (codes) `[status=pending]` — a linear-variable consumption sibling (`type-system.ts:17499`). Pos + neg.
12. **E-LIN-006** (codes) `[status=pending]` — §35.5: a linear consumption in a markup ctx (`type-system.ts:17015`, deferred-ctx). Pos + neg. (`E-LIN-005` is RESERVED — excluded.)
13. **E-TILDE-001** (codes) `[status=pending]` — a `~` pipeline-accumulator error (`type-system.ts:17521`, "The pipeline accumulator …"). Pos + neg.
14. **E-TILDE-002** (codes) `[status=pending]` — a `~` pipeline-accumulator sibling error (`type-system.ts:17523`). Pos + neg.

**Definition of done:** all 14 control-flow/linear codes pinned (codes-half; reject pos + clean neg per
code); run.ts green; divergences ESCALATED. The §17 control-flow + §35 linear diagnostic edge moves to
conformance-covered.

## Progress
`spa-lists/ss75.progress.md`. Land per-item on `spa/ss75`; ping the PA inbox per item. Do NOT advance
main / push. PA re-integrates via file-delta + confirms run.ts green. ESCALATE (do not decide) any
impl#1-vs-SPEC divergence.
