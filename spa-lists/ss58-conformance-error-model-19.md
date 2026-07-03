# sPA ss58 — conformance authoring: error model value-level §19 (freeze-gate, flagship pillar #3)

**Launch:** `read spa.md ss58` · **Branch:** `spa/ss58` · **Worktree:** `../scrml-spa-ss58`

**Fill:** conformance-authoring toward the freeze bar (S235). errorBoundary (render-context, §19.6) is DEEP-covered (`conformance/cases/error-boundary/*`), but the VALUE-LEVEL error model — the `fail`/`!{}` spine that IS scrml's try/catch replacement — is UNCOVERED beyond one codes-only case (`conformance/cases/error/error-008-*`). This authors `fail` §19.4, the `?` propagate operator §19.5, exhaustive `!{}` call-site handlers (the errors-as-states lifting, §6), and their diagnostics. NEW S235 · **fireable now** (data-only; disjoint).

**Method + harness ceiling + escalate discipline:** see `spa-lists/ss56-conformance-engine-51.md` §"What conformance authoring IS" (same). **HARNESS GATE (track B):** the **per-handler implicit transaction §19.10.5** (SQL rollback on handler re-throw) needs a REAL DB — the harness only mocks `fetch`, no `?{}` DB — so its RUNTIME half is BLOCKED; author its CODES/shape + flag runtime harness-gated. The pure-value error path (`fail .Variant` → `!{}` → phase; `?` propagate) is harness-clean.

## Shared ingestion
The failable-fn + call-site-handler model: §6 (the `fail`/`!{}` primer spine) · §19.4 (`fail` expr) · §19.5 (`?` propagate) · §19.2 (variant `renders` clause) · §19.10.5 (per-handler tx). Mirror `conformance/cases/error*/` + `server-fn/error-boundary-fallback`.

## Core files
`conformance/README.md` · `conformance/cases/error/` + `conformance/cases/error-boundary/` (existing) · `conformance/run.ts` · `compiler/SPEC.md` §19 + §6 error-model (normative)

## Items (least-ingestion-first)
1. **failable fn + exhaustive `!{}` handler** (RT) `[status=pending]` — `function f()! -> Err { fail Err::V(x) }` + `let r = f() !{ | ::V a :> … }` routing each error variant into a Phase enum (the errors-as-states lifting §6). Assert the state lands the right variant.
2. **`?` propagate operator §19.5** (RT) `[status=pending]` — `?` on a failable call propagates the error to the caller's `!` boundary; assert the propagation reaches the handler.
3. **`fail` expr forms §19.4** (codes) `[status=pending]` — `fail` on a non-error-type / a missing/unknown variant / outside a failable fn → the right diagnostic (verify the codes live).
4. **`!{}` arm exhaustiveness** (codes) `[status=pending]` — a non-exhaustive call-site handler → the exhaustiveness diagnostic; wildcard escape.
5. **variant `renders` clause §19.2** (RT) `[status=pending]` — an error variant WITH a `renders` clause displays its own markup inside an errorBoundary (priority: variant `renders` > boundary `fallback`, §19.6.5).
6. **per-handler implicit tx §19.10.5** (codes now; **RT harness-gated — real DB**) `[status=pending]` — author the shape + the `@nosql-tx` opt-out recognition (codes); FLAG the SQL-rollback runtime as harness-gated (needs a real-DB adapter, track B) — do NOT fake it.

**DoD:** the value-level error model moves UNCOVERED→conformance-covered (item 6 runtime flagged harness-gated); all green; divergences escalated.

## Progress
`spa-lists/ss58.progress.md`. Land per-item on `spa/ss58`; ping PA inbox. Do NOT push. PA re-integrates + confirms run.ts green. ESCALATE divergences + the real-DB adapter gate (§19.10.5 runtime).
