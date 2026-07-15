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

## Wave-2 — tier-1 code-exhaustive completion (S256 audit)
Items 1-6 above are LANDED — do NOT touch them. This section pins the remaining tier-1 **error-model
diagnostic codes** (§19 — the `!`/`<errors>`/`<render>` contract) + the **CPS §19.9** idempotency codes,
per the S256 tier split. Same method + core files as above (§19 read in full per code). Grep each code
live in `compiler/src` (`type-system.ts` + `codegen/emit-html.ts` + `dependency-graph.ts` + `api.js` +
`cps-batch-planner.ts`) for the exact trigger. Harness-clean (compile-time; the value-error path).

**error model §19 (the `!`/`?`/`<render>`/`<errors>` contract):**
7. **E-ERROR-003** (codes) `[status=pending]` — `?` propagation in a non-`!` function (§19.5.4; `type-system.ts:9709`). Pos + neg (`?` in a `!`-declared fn → silent).
8. **E-ERROR-004** (codes) `[status=pending]` — `?` applied to a non-failable callee (§19.5.4; `type-system.ts:9718`). Pos + neg (`?` on a failable call → silent).
9. **E-ERRORS-001** (codes) `[status=pending]` — an `<errors>` element error (`codegen/emit-html.ts:1320`). Grep the exact trigger; pos + neg.
10. **E-ERRORS-002** (codes) `[status=pending]` — an `<errors>` unrecognized value shape ("Got an unrecognized value shape", `codegen/emit-html.ts:1369`). Pos + neg.
11. **E-RENDER-NO-CLAUSE** (codes) `[status=pending]` — a `<render>` with no clause (`type-system.ts:9008`). Pos + neg.
12. **E-RENDER-NO-OF** (codes) `[status=pending]` — a `<render>` with no `of=` (`type-system.ts:8970`). Pos + neg.
13. **E-RENDER-NOT-ENUM** (codes) `[status=pending]` — a `<render>` subject that is not an enum (`type-system.ts:9023`). Pos + neg.
14. **E-MU-001** (codes) `[status=pending]` — a variable declared but never used before its scope closes (must-use; `type-system.ts:18373`). Pos + neg (a used variable → silent).
15. **E-LIFT-001** (codes) `[status=pending]` — two independent operations in the same logic block both have `lift` (`dependency-graph.ts:3666`). Pos + neg (a single lift → silent).

**CPS §19.9 idempotency (5 codes):**
16. **E-CPS-IDEMPOTENCY-STORE-DRIVER-MISMATCH** (codes) `[status=pending]` — an idempotency-store driver mismatch (`api.js:1852`). Pos + neg.
17. **E-CPS-IDEMPOTENCY-STORE-MISSING-IMPORT** (codes) `[status=pending]` — the idempotency store's import is missing (`api.js:1862`). Pos + neg.
18. **E-CPS-MULTIBATCH-MACHINE-CROSSING** (codes) `[status=pending]` — a multi-batch CPS machine crossing (`cps-batch-planner.ts:85`). Pos + neg.
19. **E-CPS-MULTIBATCH-REORDER** (codes) `[status=pending]` — a multi-batch CPS reorder violation (`cps-batch-planner.ts:84`). Pos + neg.
20. **E-CPS-NONIDEM-NO-STORAGE** (codes) `[status=pending]` — a CPS-eligible non-idempotent function with no storage (`api.js:1874`). Pos + neg.

**Wave-2 DoD:** all 14 error-model/CPS codes pinned (codes-half; reject pos + clean neg per code); run.ts
green; divergences ESCALATED. The `!`/`<render>`/`<errors>`/CPS diagnostic edge moves to conformance-covered.
