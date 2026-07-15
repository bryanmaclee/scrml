# sPA ss68 — conformance authoring: components §15/§16 (freeze-gate, WAVE B pillar-contract)

**Launch:** `read spa.md ss68` · **Branch:** `spa/ss68` · **Worktree:** `../scrml-spa-ss68`

**Fill:** conformance-authoring toward the FREEZE bar (S256 tier-1). Components (§15 def + §16 use) are a
language pillar; the **prop-contract** (typed props, required/bindable, render-arity, snippet/children)
is a soundness+ergonomic guarantee. The S256 audit found **all 4 existing component cases assert ZERO
codes** — the entire `E-COMPONENT-*` reject surface is uncovered (~14 tier-1). NEW S256 · **fireable now**
(pure conformance-corpus data — disjoint). Enumerates the CODES; the fired sPA authors the `.scrml`.

## What conformance authoring IS (the method)
Identical to `spa-lists/ss56-conformance-engine-51.md` §"What conformance authoring IS" — author from
impl#1 → SANITY-CHECK vs SPEC §15/§16/§14.9 → ESCALATE divergences; verify GREEN on
`bun conformance/run.ts`; schema in `conformance/README.md`. Grep each code live in
`compiler/src/component-expander.ts` (the prop-check emitters, ~826-3052) + `validators/post-ce-invariant.ts`
for the exact trigger. Harness-clean (compile-time expansion).

## Core files
`conformance/README.md` · `spa-lists/ss56-conformance-engine-51.md` (method §) ·
`conformance/cases/components/` (the 4 existing zero-code cases to mirror + STRENGTHEN) ·
`compiler/src/component-expander.ts` + `compiler/src/validators/post-ce-invariant.ts` ·
`compiler/SPEC.md` §15 + §16 + §14.9 (normative — read the named subsection per code)

## Items (one code per item; reject-path pos + clean neg)
1. **E-COMPONENT-010** (codes) `[status=pending]` — missing required props (§14.9; `component-expander.ts:2578`). Pos (a use omitting a required prop → E-COMPONENT-010) + neg (all required props supplied → silent).
2. **E-COMPONENT-011** (codes) `[status=pending]` — extra undeclared props (`component-expander.ts:2593`). Pos + neg.
3. **E-COMPONENT-012** (codes) `[status=pending]` — a duplicate prop name (props block + bare attribute on the def root; `component-expander.ts:2608`). Pos + neg.
4. **E-COMPONENT-013** (codes) `[status=pending]` — a prop exists but is not declared bindable (`component-expander.ts:2632`). Pos + neg (bindable-declared prop bound → silent).
5. **E-COMPONENT-014** (codes) `[status=pending]` — a structured-data prop misuse ("To share structured data, declare …", `component-expander.ts:1241`). Pos + neg.
6. **E-COMPONENT-019** (codes) `[status=pending]` — an invalid prop declaration (`component-expander.ts:826`). Pos + neg.
7. **E-COMPONENT-020** `[tier-1?]` (codes) `[status=pending]` — an unresolved component reference (`component-expander.ts:2461`). Pos (`<Unknown>` use → E-COMPONENT-020) + neg (resolved ref → silent). (Not in the brief's explicit 11 — added to hit TIER-SPLIT's ~14; reclassifiable.)
8. **E-COMPONENT-021** (codes) `[status=pending]` — a component constraint (`component-expander.ts:1187`, "Component ..."). Grep exact trigger; pos + neg.
9. **E-COMPONENT-030** (codes) `[status=pending]` — multiple spreads (`component-expander.ts:2948`). Pos + neg (a single spread → silent).
10. **E-COMPONENT-031** (codes) `[status=pending]` — a component constraint (`component-expander.ts:3052`, "Component ..."). Grep exact trigger; pos + neg.
11. **E-COMPONENT-033** (codes) `[status=pending]` — a declared-snippet-props mismatch ("Declared snippet props: …", `component-expander.ts:2517`). Pos + neg.
12. **E-COMPONENT-034** (codes) `[status=pending]` — parametric snippets require a lambda (`component-expander.ts:2527`). Pos + neg.
13. **E-COMPONENT-035** `[tier-1?]` (codes) `[status=pending]` — a post-CE component invariant (`validators/post-ce-invariant.ts:211`, "Component ..."). Pos + neg. (Not in the brief's explicit 11 — added to hit TIER-SPLIT's ~14; reclassifiable.)
> `E-COMPONENT-020/035` marked `[tier-1?]`; the brief listed 11 (010/011/012/013/014/019/021/030/031/033/034),
> TIER-SPLIT says "~14" for the family. Reclassify at case-time if not soundness-bearing.

**Definition of done:** all 13 component codes pinned (codes-half; reject pos + clean neg per code); the 4
existing zero-code component cases STRENGTHENED where a code should have been asserted; run.ts green;
divergences ESCALATED. The component prop-contract moves from ZERO-code to conformance-covered.

## Progress
`spa-lists/ss68.progress.md`. Land per-item on `spa/ss68`; ping the PA inbox per item. Do NOT advance
main / push. PA re-integrates via file-delta + confirms run.ts green. ESCALATE (do not decide) any
impl#1-vs-SPEC divergence.
