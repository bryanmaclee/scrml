# sPA ss74 — conformance authoring: inline foreign §23.2 + meta-eval (freeze-gate, WAVE C language-boundary)

**Launch:** `read spa.md ss74` · **Branch:** `spa/ss74` · **Worktree:** `../scrml-spa-ss74`

**Fill:** conformance-authoring toward the FREEZE bar (S256 tier-1). Inline foreign code (§23.2 — the
language-boundary escape hatch) has a **placement/shape contract** that is a soundness guarantee (a
foreign block that crosses a client/server boundary or returns the wrong shape is unsound). The S256 audit
puts the `E-FOREIGN-*` set + `E-META-EVAL-*` in tier-1 (language-boundary + meta-eval contract). NEW S256 ·
**fireable now** (pure conformance-corpus data — disjoint). Enumerates the CODES; the fired sPA authors
the `.scrml`.

## What conformance authoring IS (the method)
Identical to `spa-lists/ss56-conformance-engine-51.md` §"What conformance authoring IS". Author from
impl#1 → SANITY-CHECK vs SPEC §23.2 (+ §22 meta-eval) → ESCALATE divergences; verify GREEN on
`bun conformance/run.ts`; schema in `conformance/README.md`. Grep each code live in `compiler/src`
(`type-system.ts` §23 foreign checks ~21194-21710 + `codegen/emit-logic.ts` + `meta-eval.ts`) for the
exact trigger. Harness-clean (compile-time).
> **FOLD NOTE:** the brief let me place `E-META-EVAL-001` here OR in ss65 (§22 meta). Placed HERE (with its
> sibling `E-META-EVAL-002`) — meta-EVAL is the compile-time evaluation boundary, adjacent to foreign
> eval; ss65 (the `^{}` `E-META-*` list) is LANDED and carries a fold-note pointing here.

## Core files
`conformance/README.md` · `spa-lists/ss56-conformance-engine-51.md` (method §) ·
`conformance/cases/meta/` + any inline-foreign case to mirror ·
`compiler/src/type-system.ts` (§23 foreign) + `codegen/emit-logic.ts` + `meta-eval.ts` ·
`compiler/SPEC.md` §23.2 + §22 (normative — read the named subsection per code)

## Items (one code per item; reject-path pos + clean neg)
1. **E-FOREIGN-003** (codes) `[status=pending]` — a foreign block with no content ("foreign code block has no …", `type-system.ts:21702`). Pos + neg (a non-empty foreign block → silent).
2. **E-FOREIGN-004** (codes) `[status=pending]` — a bare (non-value-returning) foreign block misuse (`type-system.ts:21689`). Pos + neg.
3. **E-FOREIGN-005** (codes) `[status=pending]` — an inline value-returning foreign block misuse (`type-system.ts:21710`). Pos + neg.
4. **E-FOREIGN-006** (codes) `[status=pending]` — an inline foreign block that crosses a client/server boundary (`codegen/emit-logic.ts:2981`). Pos + neg (a same-side foreign block → silent).
5. **E-FOREIGN-LANG-DUPLICATE** (codes) `[status=pending]` — more than one top-level foreign-lang block (`type-system.ts:21213`). Pos + neg (a single lang block → silent).
6. **E-FOREIGN-LANG-IN-PROGRAM** (codes) `[status=pending]` — a foreign-lang block inside a `<program>` (`type-system.ts:21194`). Pos + neg.
7. **E-META-EVAL-001** (codes) `[status=pending]` — a meta-eval error (`meta-eval.ts:466`). Grep the exact trigger; pos + neg.
8. **E-META-EVAL-002** `[tier-1?]` (codes) `[status=pending]` — a meta-eval sibling error (`meta-eval.ts:392`). Grep the exact trigger; pos + neg. (TIER-SPLIT lists only `E-META-EVAL-001`; sibling added for coverage — reclassifiable.)

**Definition of done:** all 8 foreign/meta-eval codes pinned (codes-half; reject pos + clean neg per code);
run.ts green; divergences ESCALATED. The language-boundary + meta-eval diagnostic edge moves to covered.

## Progress
`spa-lists/ss74.progress.md`. Land per-item on `spa/ss74`; ping the PA inbox per item. Do NOT advance
main / push. PA re-integrates via file-delta + confirms run.ts green. ESCALATE (do not decide) any
impl#1-vs-SPEC divergence.
