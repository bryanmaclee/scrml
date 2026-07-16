# sPA ss59 — conformance authoring: reactivity §6 edges (freeze-gate, foundational pillar #4)

**Launch:** `read spa.md ss59` · **Branch:** `spa/ss59` · **Worktree:** `../scrml-spa-ss59`

**Fill:** conformance-authoring toward the freeze bar (S235). V5-strict reactivity (§6) is THE declaration primitive; the built suite has 5 SHALLOW cases (`conformance/cases/reactive/*`) covering counter/interp/reset/toggle/derived only. The documented edges — compound Variant-C, array reassignment-reactivity, default=/reset multi-level, Shape-4 no-RHS defaults, pinned/hoisting — are UNCOVERED. NEW S235 · **fireable now** (data-only; disjoint).

**Method + harness ceiling + escalate discipline:** see `spa-lists/ss56-conformance-engine-51.md` §"What conformance authoring IS" (same). **HARNESS GATE (track B):** **debounce/throttle §6.13** timing runtime needs a **virtual clock** (deferred, `driver.ts:19-21`) → author its CODES, flag runtime harness-gated. The rest of §6 is harness-clean.

## Shared ingestion
V5-strict state: §6.2 (the 3 RHS shapes + Shape-4 no-RHS defaults) · §6.3 (compound Variant-C) · §6.5 (arrays — reassignment-canonical, DQ-2) · §6.8 (default=/reset) · §6.9 (hoisting) · §6.10 (pinned) · §6.13 (debounce/throttle). Mirror `conformance/cases/reactive/*`.

## Core files
`conformance/README.md` · `conformance/cases/reactive/` (existing 5) · `conformance/run.ts` · `compiler/SPEC.md` §6 (normative)

## Items (least-ingestion-first)
1. **compound state Variant-C §6.3** (RT) `[status=landed wave-1 f50bdb73 — re-integrated to main]` — `<formRes> <name>="" <email>="" </>`; write `@formRes.name` → assert the nested read updates; the canonical dot-nav.
2. **Shape-4 no-RHS typed defaults §6.2** (RT) `[status=landed wave-1 d790b05a — re-integrated to main]` — `<x>: int` → 0, `<s>: string` → "", `<a>: T[]` → []; a bare-struct no-RHS → `not` + `(not to T)` lifecycle; refinement-violating-empty → `E-REFINEMENT-NO-DEFAULT` (codes).
3. **array reactivity §6.5** (RT) `[status=landed wave-1 ef54cd16 — re-integrated to main]` — `@arr = [...@arr, x]` reassignment is reactive (DQ-2); render an `<each>` over it and assert the DOM updates on reassignment.
4. **default= / reset(@cell) §6.8** (RT) `[status=landed wave-1 84eda797 — re-integrated to main]` — `reset(@cell)` → the `default=` value (or canonical empty); multi-level compound reset.
5. **pinned §6.10 / hoisting §6.9** (codes) `[status=landed wave-1 618f1567 — re-integrated to main]` — `fn` file-scope hoist (mutual recursion works); `pinned` opts out → `E-STATE-PINNED-FORWARD-REF` on a forward ref.
6. **debounce/throttle §6.13** (codes now; **RT harness-gated — virtual clock**) `[status=landed wave-1 013a8f16 — re-integrated to main]` — codes: `E-DEBOUNCED-WITH-DERIVED` · `E-REACTIVITY-ATTR-CONFLICT` · `E-DEBOUNCED-WITH-SERVER`; FLAG the coalesce/throttle timing runtime as harness-gated (virtual-clock driver, track B).

**DoD:** §6 moves SHALLOW→conformance-covered (item 6 runtime flagged); all green; divergences escalated.

## Progress
`spa-lists/ss59.progress.md`. Land per-item on `spa/ss59`; ping PA inbox. Do NOT push. PA re-integrates + run.ts green. ESCALATE divergences + the virtual-clock gate (§6.13 runtime — shared with ss56 onTimeout/onIdle).

## Wave-2 — tier-1 code-exhaustive completion (S256 audit)
Items 1-6 above are LANDED — do NOT touch them. This section pins the remaining tier-1 **reactivity/state
diagnostic codes** (§6 declaration primitive + derived-engine + dependency-graph soundness) the S256 tier
split places in tier-1. Same method + core files as above (§6 read in full per code). Grep each code live
in `compiler/src` (`symbol-table.ts` + `dependency-graph.ts` + `ast-builder.js` + `type-system.ts`) for
the exact trigger. Harness-clean (compile-time).

7. **E-DERIVED-VALUE-MUTATE** (codes) `[status=landed-on-branch f66bdc32]` — an in-place mutation of a derived cell (`symbol-table.ts:3222`). Pos (`@derived.field = …` → E-DERIVED-VALUE-MUTATE) + neg (read-only derived use → silent).
8. **E-DERIVED-ENGINE-CIRCULAR** (codes) `[status=landed-on-branch f66bdc32]` — a derived engine with a circular dependency (`dependency-graph.ts:3570`). Pos + neg (acyclic derived engine → silent).
9. **E-DERIVED-ENGINE-NO-INITIAL** (codes) `[status=landed-on-branch f66bdc32]` — a derived engine with no initial (`symbol-table.ts:8019`). Pos + neg.
10. **E-DERIVED-ENGINE-NO-RULES** (codes) `[status=landed-on-branch f66bdc32]` — a derived engine with no rules (`symbol-table.ts:8080`). Pos + neg.
11. **E-DECL-NEEDS-INITIALIZER** (codes) `[status=landed-on-branch 8e9ce965]` — a declaration that needs an initializer (`ast-builder.js:6383`). Pos + neg (initializer present → silent).
12. **E-DECL-RHS-INTERP-WRAPPED** (codes) `[status=landed-on-branch 8e9ce965]` — the RHS of a declaration is interp-wrapped ("The RHS of …", `ast-builder.js:6788`). Pos + neg.
13. **E-NAME-COLLIDES-STATE** (codes) `[status=landed-on-branch 8e9ce965]` — a local name collides with a state name (`symbol-table.ts:1582`). Pos + neg. (V5-strict scope soundness.)
14. **E-CELL-AMBIGUOUS-MEMBER-RENDER** (codes) `[status=landed-on-branch b79765a6]` — a render-by-tag ambiguous compound member ("Disambiguate by referencing the field through its compound …", `codegen/emit-html.ts:2058`). Pos + neg.
15. **E-CELL-NO-RENDER-SPEC** (codes) `[status=landed-on-branch b79765a6]` — a cell with no render spec (`symbol-table.ts:47`). Pos + neg.
16. **E-DG-001** (codes) `[status=landed-on-branch 415d79eb]` — a cyclic dependency detected (`dependency-graph.ts:3623`). Pos + neg.
17. **E-DG-002** (codes) `[status=PARTIAL 415d79eb — NEG landed; POS ESCALATED #5 (§34 row vs impl: trigger+severity)]` — reactive variables with no readers (`dependency-graph.ts:3182`). Pos + neg.
18. **E-STATE-004** `[tier-1?]` (codes) `[status=PARKED — ESCALATION #3 (stale §34 E-STATE block cites folded §11.1)]` — an unknown attribute on a state (`type-system.ts:7852`). Pos + neg. (TIER-SPLIT tier-2 attr-shape; brief marks `[tier-1?]`.)
19. **E-STATE-005** `[tier-1?]` (codes) `[status=PARKED — ESCALATION #3 (stale §34 E-STATE block cites folded §11.1)]` — a state name colliding with an HTML element name (`type-system.ts:5820`). Pos + neg. (TIER-SPLIT tier-2 naming; brief marks `[tier-1?]`.)

**Wave-2 DoD:** all 13 reactivity/state codes pinned (codes-half; reject pos + clean neg per code); run.ts
green; divergences ESCALATED. The §6 reactive/derived/dependency-graph diagnostic edge moves to covered.
