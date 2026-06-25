# sPA ss17 — each-codegen

**Launch:** `read spa.md ss17` · **Branch:** `spa/ss17` · **Worktree:** `../scrml-spa-ss17`

**Fill:** ~50% · `healthy` (NEW S219 — 3 homeless MED emit-each gaps the S219 board-refresh surfaced)

## Shared ingestion
The `<each>` (Tier-1 iteration) codegen + its runtime reconcile. All three items live in the
per-item render / keyed-reconcile / arm-body-effect machinery — same files, same understanding
(the "arm/iteration render is a separate, incomplete emitter" class). All are runtime-DOM bugs →
**browser-testable** (unit tests synthesizing AST will MISS them — mandate happy-dom value-asserting
tests + S215 adversarial transition matrix). Shared loci: `emit-each.ts` (per-each render fn +
`_scrml_reconcile_list` call), `runtime-template.js` (`_scrml_reconcile_list` keyed diff),
`emit-lift`/`emit-html` (the markup→DOM build the per-item template feeds).

## Core files
`compiler/src/codegen/emit-each.ts` · `dist/runtime-template.js` (the shared `_scrml_reconcile_list`) · `compiler/src/codegen/emit-html.ts` · `compiler/src/codegen/emit-lift.js`

## Items (least-ingestion-first)
1. **`g-expr-event-handler-dead-in-each`** `[status=open]` MED — an expr-form event handler (`onclick=${e => …}` / bare-ref) inside an `<each>` per-item body is dead (the each per-item emitter doesn't wire the handler the top-level path does). **This is Family-A Half-2** (the `<each>` sibling of the S216 Half-1 `<match>`/engine arm-body fix `f4bef40f`) — the bind:value + buildHandlerExpr dedup the Half-1 convergence left for `<each>`. Likely the SHARED root with item-2/3 (per-item emitter incompleteness).
   > **Brief seed:** Mirror the S216 Half-1 fix (`emitBindDirectiveBody`/`emitArmWireFunction`, `f4bef40f`) into the `<each>` per-item path — wire expr/bare-ref event handlers (+ bind:value if not already) per-item against the item root, `_disposers` teardown. Value-asserting happy-dom test (handler fires inside an `<each>` item). Cross-check the Half-1 locus for the dedupable `buildHandlerExpr`.
2. **`g-each-peritem-markup-value-ternary`** `[status=open]` MED — `${@. ? <markup> : ""}` (a markup-value in a ternary) inside an `<each>` per-item body: the `@.` iteration-scope is not threaded into the markup→DOM build, so nested `@.` refs don't bind to the iteration item (clean-compile, non-render — GITI-032 follow-on, deferred with a non-regressing skip).
   > **Brief seed:** Thread the `@.` iter-var scope into `emit-each`'s `emitCreateElementFromMarkup`/`emitMarkupValueExpr` so a markup-value nested in a per-item ternary binds its `@.` refs to the current item. Value-asserting happy-dom test (the per-item markup-value renders + its `@.` refs resolve). DEP-AWARE: the S201 markup-value-in-expression path is the sibling — keep parity.
3. **`g-nested-each-outer-key-reuse-inner-frozen`** `[status=open]` MED (Bug-72 / S212 Approach-C residual) — an inner `<each>` frozen at create-time value when its OUTER row node is REUSED on a keyed reconcile (same outer key) and the outer item's iterated field changes; the inner mount isn't re-created/re-bound. Distinct from the S212-RESOLVED `g-nested-each-no-own-subscription` (that was no-subscription; this is reuse-not-rebound).
   > **Brief seed:** In `_scrml_reconcile_list` (runtime-template.js) + `emit-each`, when an outer row node is REUSED on keyed reconcile, re-bind/re-mount the inner `<each>` against the new outer item value (don't keep the create-time closure). Adversarial test: outer keyed-reconcile (same key) + inner field mutation (array-replace / push) → inner re-renders. Surfaced by the 6nz Bug-AI nested-each adversarial test (which exercised FRESH inner mounts, not reuse).

## Progress
`ss17.progress.md`. Land on `spa/ss17`; ping PA inbox when ready. Do not advance main / do not push.
