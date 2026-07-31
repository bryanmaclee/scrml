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
7. **E-ERROR-003** (codes) `[status=done S305]` — `?` propagation in a non-`!` function (§19.5.4; `type-system.ts:9709`). Pos + neg (`?` in a `!`-declared fn → silent).
8. **E-ERROR-004** (codes) `[status=done S305]` — `?` applied to a non-failable callee (§19.5.4; `type-system.ts:9718`). Pos + neg (`?` on a failable call → silent).
9. **E-ERRORS-001** (codes) `[status=done S305]` — an `<errors>` element error (`codegen/emit-html.ts:1320`). Grep the exact trigger; pos + neg.
10. **E-ERRORS-002** (codes) `[status=done S305]` — an `<errors>` unrecognized value shape ("Got an unrecognized value shape", `codegen/emit-html.ts:1369`). Pos + neg.
11. **E-RENDER-NO-CLAUSE** (codes) `[status=done S305]` — a `<render>` with no clause (`type-system.ts:9008`). Pos + neg.
12. **E-RENDER-NO-OF** (codes) `[status=done S305]` — a `<render>` with no `of=` (`type-system.ts:8970`). Pos + neg.
13. **E-RENDER-NOT-ENUM** (codes) `[status=done S305]` — a `<render>` subject that is not an enum (`type-system.ts:9023`). Pos + neg.
14. **E-MU-001** (codes) `[status=pending]` — a variable declared but never used before its scope closes (must-use; `type-system.ts:18373`). Pos + neg (a used variable → silent).
15. **E-LIFT-001** (codes) `[status=BLOCKED-PENDING-SHAPE — see S305 note]` — two independent operations in the same logic block both have `lift` (`dependency-graph.ts:3666`). Pos + neg (a single lift → silent).

**CPS §19.9 idempotency (5 codes):**
16. **E-CPS-IDEMPOTENCY-STORE-DRIVER-MISMATCH** (codes) `[status=done S305]` — an idempotency-store driver mismatch (`api.js:1852`). Pos + neg.
17. **E-CPS-IDEMPOTENCY-STORE-MISSING-IMPORT** (codes) `[status=done S305]` — the idempotency store's import is missing (`api.js:1862`). Pos + neg.
18. **E-CPS-MULTIBATCH-MACHINE-CROSSING** (codes) `[status=pending]` — a multi-batch CPS machine crossing (`cps-batch-planner.ts:85`). Pos + neg.
19. **E-CPS-MULTIBATCH-REORDER** (codes) `[status=pending]` — a multi-batch CPS reorder violation (`cps-batch-planner.ts:84`). Pos + neg.
20. **E-CPS-NONIDEM-NO-STORAGE** (codes) `[status=done S305]` — a CPS-eligible non-idempotent function with no storage (`api.js:1874`). Pos + neg.

**Wave-2 DoD:** all 14 error-model/CPS codes pinned (codes-half; reject pos + clean neg per code); run.ts
green; divergences ESCALATED. The `!`/`<render>`/`<errors>`/CPS diagnostic edge moves to conformance-covered.

## S305 — Wave-2 partial (bryan, 2026-07-31)

**7 of 14 tier-1 codes pinned** — `E-ERROR-003` / `E-ERROR-004` (§19.5.4 propagate) ·
`E-ERRORS-001` / `E-ERRORS-002` (§55.8 `<errors of=>`) · `E-RENDER-NO-OF` /
`E-RENDER-NOT-ENUM` / `E-RENDER-NO-CLAUSE` (§19.15.3). 14 cases; suite 811 → 825. Each
probed by EXECUTION first; measured — every pos emits exactly its target code, every neg
emits ZERO errors. The three `<render>` codes share ONE legal control neg, so each is
isolated against a common baseline.

**NOTE — `E-ERRORS-001/002` are catalogued at §55.8, not §19.** The list groups them with
the error model; §34 places them on the `<errors>` VALIDATOR surface. The cases cite §55.8
(the catalog), not the list's grouping.

### `E-LIFT-001` — RECORDED SEARCH, no shape found (not a dead-code claim)

Three shapes probed, none fired: (1) two `for … lift` loops over the same reactive in one
logic block; (2) two server-fn calls each followed by a `lift`, no `<schema>` — masked by
`E-SQL-004`; (3) the same with a `<schema>` + `db=` so the SQL resolves — silent.

Trigger read live at `dependency-graph.ts:3759-3774`: it needs **≥2 lift-bearing DG nodes
with NO `awaits` path between them in either direction**. Shapes (2)/(3) plausibly fail
because CPS batching serializes the two server calls into exactly such a path. **What is
NOT established:** whether an independent-lift shape is authorable at all. Do NOT record
this as source-unreachable on this evidence — that is the S261 over-claim. Next step is to
construct two genuinely unordered lift-bearing operations (distinct reactive sources, no
shared dependency) and re-probe, or to instrument `liftNodes`/`awaitsAdj` directly.

### Remaining tier-1 on this list (6)

`E-MU-001` (must-use; the `mustUseTracker` at `type-system.ts:18652` — the source construct
that MARKS a binding must-use was not identified this pass) · the five `E-CPS-*` codes
(idempotency-store driver/import, multibatch machine-crossing/reorder, non-idem-no-storage)
— these need the A9/Ext-1 body-split + `scrmlconfig` idempotency-store surface set up, which
is a materially bigger authoring setup than the rest of this list and deserves its own pass.

## S305 second pass — `E-MU-001` pinned; five recorded searches

**`E-MU-001` PINNED** (§35, 2 cases). Trigger is a **fresh `~`-form binding** — a bare
`name = expr` inside a logic block where `name` is not already a local (`type-system.ts:17819`
only calls `mustUseTracker.declare()` for those). A `let`/`const` does NOT register. Reading the
binding suppresses it; `_`-prefix is the documented opt-out.

### Recorded searches (probed, did not fire — NOT dead-code claims except where stated)

- **`E-TYPE-042`** — SHADOWED, and this one IS a claim: `== not` fires **`E-EQ-002`**
  (`gauntlet-phase3-eq-checks.js:582`, TS-stage, fatal, `return`s) so the codegen-stage duplicate
  at `rewrite.ts:1201` is unreachable. Filed `g-e-type-042-unreachable-duplicate-of-e-eq-002` —
  needs a RETIRE-or-narrow ruling, like the S261 E-MARKUP reconciliation. **Not authorable.**
- **`E-TYPE-071`** — `render foo(...)` outside a component body probed in two positions (a
  `function` body; a markup `${ }` interpolation); neither fired. `rewriteRenderKeyword`
  (`rewrite.ts:2401`) appears not to be reached on those paths. Locus known, reachability NOT
  established — do not call it dead on this evidence.
- **`E-STATE-005`** — HTML-element-name collision on a STATE TYPE. Probed `type Button:struct`
  and `type Button:state`; neither fired (the second may not even be a live type kind). The
  registrar is `type-system.ts:5823`; which surface still reaches it was not identified.
- **`E-CONTRACT-004-WARN`** — probed the §53.11 shape directly (`<username>: string(length(<=10))
  = <input type="text" maxlength="20"/>`, declared-vs-shape-derived conflict). Neither pos nor
  neg emitted anything, suggesting the shape-derived attribute is not being produced at all on
  this path — which would be a separate defect from the warning. Worth one focused probe.
- **`E-CG-006`** — NOT probed this pass. No claim either way. It needs a CPS client wrapper
  containing a server-only node (`scheduling.ts:892`), i.e. the body-split setup the five
  `E-CPS-*` codes also want. Bundle them.

**Honest yield note:** this pass authored ONE code from a six-code cluster. The searches are the
deliverable — five codes now carry evidence instead of a `[status=pending]` marker, and two of
them turned into filed gaps.

## S305 third pass — the CPS / idempotency arc

**3 of the 5 `E-CPS-*` codes pinned** (6 cases; suite 835 → 841). `E-CPS-NONIDEM-NO-STORAGE`
(§19.9.6) · `E-CPS-IDEMPOTENCY-STORE-DRIVER-MISMATCH` · `E-CPS-IDEMPOTENCY-STORE-MISSING-IMPORT`
(both §39.2.6). These are the codes that needed the whole surface stood up, and the setup is the
part worth keeping:

### The three preconditions, in order — miss any one and every code reads as dead

1. **CPS-ELIGIBILITY needs a client/server INTERLEAVE.** `route-inference.ts:5386` gates on
   `findReactiveAssignment(body) !== null`. A function that is wholly server (e.g. a `?{}` inside an
   `if`) is simply escalated whole — **`[MC] 0 CPS function(s) classified`** — and NO `E-CPS-*` code
   can fire. The working shape is client-write → server statement → client-write.
2. **The batch must be NON-MONOTONE** for the three store codes. `set n = n + 1` qualifies (the RHS
   references the column it assigns — `monotonicity-analyzer.ts:176`). A plain SELECT or an
   INSERT-without-readback is MONOTONE and fires nothing.
3. **Then the store attribute decides which of the three fires** (`api.js:1938-1968`, priority order):
   explicit-driver mismatch vs `db=` → DRIVER-MISMATCH · `"redis"` with no `scrml:redis` in the module
   graph → MISSING-IMPORT · resolves to `"none"` → NONIDEM-NO-STORAGE.

**Diagnostic tip for the next probe:** run `compileScrml({verbose:true})` and read the `[MC]` line —
it reports the CPS-function count and the per-verdict split, which tells you immediately WHICH
precondition you are failing instead of leaving you guessing at an empty code set.

### Recorded searches — the two multibatch codes (NOT dead-code claims)

- **`E-CPS-MULTIBATCH-REORDER`** — has TWO reject paths. (a) `cps-batch-planner.ts:163`, a genuine
  body-DG CYCLE; the code's own comment concedes that would mean two straight-line statements
  mutually depend, so it reads defensive. (b) `:426`, an `invalidates` (SQL-row-identity) edge
  crossing a batch boundary — this one IS the designed trigger. Two shapes probed (insert→client→
  select on one table; select→client-derived-value→insert on one table). **Both produced ONE batch**,
  so no boundary to cross: the **server-biased topological sort hoists the server statements adjacent**
  and the coalescer merges them, which is the optimisation working as designed. Forcing two batches
  needs a dependency the sort cannot reorder around — that is the next thing to construct, not a
  conclusion that the code is dead.
- **`E-CPS-MULTIBATCH-MACHINE-CROSSING`** — `detectMachineCrossing` (`:470`) explicitly SKIPS an
  `.advance()` with no batch, and a machine cell is a client-tier reactive, so both advances must be
  SERVER-tier statements in DIFFERENT batches. Not probed to a conclusion; it inherits the same
  two-batch problem above. Locus known, reachability NOT established.
