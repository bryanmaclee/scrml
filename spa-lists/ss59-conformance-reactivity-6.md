# sPA ss59 — conformance authoring: reactivity §6 edges (freeze-gate, foundational pillar #4)

**Launch:** `read spa.md ss59` · **Branch:** `spa/ss59` · **Worktree:** `../scrml-spa-ss59`

**Fill:** conformance-authoring toward the freeze bar (S235). V5-strict reactivity (§6) is THE declaration primitive; the built suite has 5 SHALLOW cases (`conformance/cases/reactive/*`) covering counter/interp/reset/toggle/derived only. The documented edges — compound Variant-C, array reassignment-reactivity, default=/reset multi-level, Shape-4 no-RHS defaults, pinned/hoisting — are UNCOVERED. NEW S235 · **fireable now** (data-only; disjoint).

**Method + harness ceiling + escalate discipline:** see `spa-lists/ss56-conformance-engine-51.md` §"What conformance authoring IS" (same). **HARNESS GATE (track B):** **debounce/throttle §6.13** timing runtime needs a **virtual clock** (deferred, `driver.ts:19-21`) → author its CODES, flag runtime harness-gated. The rest of §6 is harness-clean.

## Shared ingestion
V5-strict state: §6.2 (the 3 RHS shapes + Shape-4 no-RHS defaults) · §6.3 (compound Variant-C) · §6.5 (arrays — reassignment-canonical, DQ-2) · §6.8 (default=/reset) · §6.9 (hoisting) · §6.10 (pinned) · §6.13 (debounce/throttle). Mirror `conformance/cases/reactive/*`.

## Core files
`conformance/README.md` · `conformance/cases/reactive/` (existing 5) · `conformance/run.ts` · `compiler/SPEC.md` §6 (normative)

## Items (least-ingestion-first)
1. **compound state Variant-C §6.3** (RT) `[status=pending]` — `<formRes> <name>="" <email>="" </>`; write `@formRes.name` → assert the nested read updates; the canonical dot-nav.
2. **Shape-4 no-RHS typed defaults §6.2** (RT) `[status=pending]` — `<x>: int` → 0, `<s>: string` → "", `<a>: T[]` → []; a bare-struct no-RHS → `not` + `(not to T)` lifecycle; refinement-violating-empty → `E-REFINEMENT-NO-DEFAULT` (codes).
3. **array reactivity §6.5** (RT) `[status=pending]` — `@arr = [...@arr, x]` reassignment is reactive (DQ-2); render an `<each>` over it and assert the DOM updates on reassignment.
4. **default= / reset(@cell) §6.8** (RT) `[status=pending]` — `reset(@cell)` → the `default=` value (or canonical empty); multi-level compound reset.
5. **pinned §6.10 / hoisting §6.9** (codes) `[status=pending]` — `fn` file-scope hoist (mutual recursion works); `pinned` opts out → `E-STATE-PINNED-FORWARD-REF` on a forward ref.
6. **debounce/throttle §6.13** (codes now; **RT harness-gated — virtual clock**) `[status=pending]` — codes: `E-DEBOUNCED-WITH-DERIVED` · `E-REACTIVITY-ATTR-CONFLICT` · `E-DEBOUNCED-WITH-SERVER`; FLAG the coalesce/throttle timing runtime as harness-gated (virtual-clock driver, track B).

**DoD:** §6 moves SHALLOW→conformance-covered (item 6 runtime flagged); all green; divergences escalated.

## Progress
`spa-lists/ss59.progress.md`. Land per-item on `spa/ss59`; ping PA inbox. Do NOT push. PA re-integrates + run.ts green. ESCALATE divergences + the virtual-clock gate (§6.13 runtime — shared with ss56 onTimeout/onIdle).
