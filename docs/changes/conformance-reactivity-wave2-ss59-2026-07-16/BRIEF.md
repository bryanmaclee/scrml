# BRIEF — ss59 Wave-2: tier-1 reactivity/state diagnostic codes (conformance authoring)

Archived verbatim at dispatch (S133/S135 discipline). Branch: `spa/ss59` (base `origin/main` @ 9c27ce9a).
Baseline: **642/642 green**. Dispatched 4 parallel agents, ingestion-disjoint by case-dir.

## Coverage audit (done by sPA BEFORE dispatch — grep-match != assertion, S261)
All 13 wave-2 codes parsed out of every `conformance/cases/**/expected.json` via `expect.codes`:
- **All 13 UNCOVERED positively.** `E-DERIVED-VALUE-MUTATE` + `E-DG-002` appear ONLY in `notCodes`
  (negative assertions); `E-DERIVED-ENGINE-NO-RULES` appears ONLY in rationale PROSE. None is coverage.

## Divergence found pre-dispatch → items 18/19 PARKED (not dispatched)
`E-STATE-004` / `E-STATE-005` §34 catalog rows (SPEC.md:18104-18105) cite **§11.1**, a section
**folded/retired** (SPEC.md:7074-7076 — "Subsumed by §6.1-§6.3"). Catalog says 004=duplicate field
name, 005=field type references unknown type. Impl fires 004=unknown attribute on state type
(type-system.ts:7851), 005=state type name collides with HTML element name (type-system.ts:5823).
Semantically different → authoring would ENSHRINE impl#1 against SPEC. ESCALATED to PA.

## Agent groups (each: pos reject-case + clean neg-case per code)
- **A** — E-DERIVED-VALUE-MUTATE (§6.6.18) + E-DERIVED-ENGINE-{CIRCULAR,NO-INITIAL,NO-RULES} (§51.0.J)
- **B** — E-DECL-NEEDS-INITIALIZER (retired-except-const-derived, ast-builder.js:6363) +
          E-DECL-RHS-INTERP-WRAPPED (§6.2, SPEC:2217-2221) + E-NAME-COLLIDES-STATE (§6.1.3)
- **C** — E-CELL-NO-RENDER-SPEC + E-CELL-AMBIGUOUS-MEMBER-RENDER (§6.4 render-by-tag)
- **D** — E-DG-001 + E-DG-002 (§31 dependency graph)

## Method (non-negotiable)
Author scrml -> run through impl#1 via harness -> capture ACTUAL codes -> assert in expected.json ->
**SANITY-CHECK vs SPEC**. If impl diverges from a normative SPEC statement: **STOP + ESCALATE**, do
NOT enshrine impl behavior. Verify `bun conformance/run.ts` GREEN. Superset semantics: incidental
codes need not be asserted.
