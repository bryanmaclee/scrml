# M1.5 — multi-stub emit + client-wrapper multi-await — progress

Append-only progress log. Brief: docs/changes/full-body-split/EXT-1-IMPL-BRIEF.md §M1.5.

## 2026-05-21 — startup
- Worktree verified, merged main (74873482 — M1.1-M1.4 present), bun install + pretest clean.
- Baseline: full `bun run test` = 18057 pass / 169 skip / 1 todo / 2 fail (pre-existing
  flakes: serve.test.js ECONNREFUSED + value-indexed-subscribers throw-by-design).
- Pre-commit gate (unit+integration+conformance) = 13437 pass / 0 fail. Clean signal.

## Phase 0 — surface verification (line numbers shifted by M1.1-M1.4)
- emit-server.ts: 1547 LOC. CPS emission spans the CSRF path (~833-1029) and the
  non-CSRF path (~1030-1196). One handler per route; body runs `cpsSplit.serverStmtIndices`.
  `cpsNeedsIdempotencyDedup` helper (M1.4) at lines 112-126.
- emit-functions.ts: 563 LOC. Step 2 CPS wrapper at lines 342-474. `cpsNeedsIdempotencyKey`
  helper (M1.4) at 107-115. One fetch + one await per CPS function.
- route-inference.ts: planner call site at ~2826; `_plan.topoOrder` was DISCARDED —
  only `_plan.batches` installed onto `cpsSplit.serverBatches`.

## Step 1 — thread topoOrder (COMMIT 6024da81)
- Added `CPSSplit.topoOrder: number[]` (defaults `[]`); installed `_plan.topoOrder` at
  the planner call site. emit-functions.ts can now sequence client stmts between awaits.
- ext1-m1-1 + ext1-m1-3 tests still green.

## Step 2 — emit-server.ts multi-stub emission (COMMIT f0a278b7)
- Added `cpsBatchMonotonicity` + `batchNeedsIdempotencyDedup` helpers.
- Wrapped the per-route non-SSE handler emission in a per-batch loop. Single-batch /
  non-CPS → ONE handler (byte-identical to pre-Ext-1). Multi-batch → N handlers named
  `<routeName>__batch_<i>` at `<path>__batch_<i>`, each running ONLY its batch's
  indices, each with its own Ext 4 `!`-wrap, Ext 5 dedup gated on the batch's OWN
  verdict, and forwarded prior-batch return cells as additional `_scrml_body` params.
- Per-batch synthetic cpsSplit view drives the existing handler-body emit unchanged.

## Step 3 — emit-functions.ts Step 1: N fetch stubs (COMMIT ec0d8d76)
- Added `ClientBatch` type + `buildClientBatchPlan`. Wrapped the fetch-stub emission
  in a per-batch loop; multi-batch routes emit N stubs at `<path>__batch_<i>`, each
  idempotency-gated per-batch. `serverFnBatchStubs` map records the per-batch stub
  names for the wrapper. Only the last batch's stub applies the `T|not` wire-decode.

## Step 4 — emit-functions.ts Step 2: multi-batch wrapper (COMMIT 0495c2b7)
- Added `emitMultiBatchWrapper`: walks `topoOrder`, emits one `await` per batch in
  topological order with client statements interleaved. Each await in its own
  try/catch producing a tagged `__scrml_error` envelope with `batch: <i>`. Batch
  results bound as `let` for cross-batch forwarding + `_scrml_reactive_set`.
- Single-batch path untouched (pre-Ext-1 shape verbatim).

## Step 5 — test corpus (COMMIT eb6e4867)
- 24 fixtures in ext1-m1-5-multi-stub-emit.test.js: two-batch (5), three-batch (4),
  mixed-monotonicity gating (4), per-batch error envelope (5), cross-batch param
  forwarding (3), single-batch back-compat (3). All pass.

## Step 6 — S4 outer-try parity (COMMIT dd10d06f)
- Soundness review: a thrown INTERLEAVED CLIENT statement in the multi-batch wrapper
  was uncaught (single-batch wraps everything in one try). Added an outer try/catch
  around the whole multi-batch body → tagged-envelope parity. S4 preserved.
- Acorn-parsed full emitted client+server JS — both modules parse clean.

## §47-collision check (brief open question — RESOLVED CLEAN)
- Route names `__ri_route_<fn>_<n>__batch_<i>`: per-page-unique (§47.12 de-dup rule
  applies only to cross-file shared names; the `__batch_<i>` ordinal + `<fn>_<n>`
  segment guarantee within-file uniqueness).
- Client fetch-stub names go through `genVar()` (global counter — unique).
- E-CG-012 reserves the encoded-name pattern (`_`+kind-char+8 base36); `_scrml_*` /
  `__ri_route_*` are explicit compiler-internal prefixes, a separate class per §47.5.
  No collision.
- Batch paths `<path>__batch_<i>` are URL strings, not §47-encoded names; deterministic
  from planner output → no §40.9.8 content-addressing collision.

## Result
- Pre-commit gate: 13461 pass / 0 fail (baseline 13437 — +24 new fixtures).
- Full `bun run test`: 18082 pass / 0 fail (baseline 18057 / 2 pre-existing flakes —
  flakes did not recur this run). Zero regressions.
