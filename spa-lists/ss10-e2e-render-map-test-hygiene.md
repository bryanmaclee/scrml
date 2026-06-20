# sPA ss10 — e2e-render-map-test-hygiene

**Launch:** `read spa.md ss10` · **Branch:** `spa/ss10` · **Worktree:** `../scrml-spa-ss10`
**Merged from:** e2e-render-map-harness · test-hygiene-suppression-verified-bit

## Shared ingestion
The `compiler/tests/e2e-render-map/` harness (`render-harness.js` mountAndObserve, `render-detectors.js`
classifiers D1-MOUNT-THROW vs HARNESS-TIMEOUT, `seed-fixtures.js` POPULATED_SEEDS + SEED-SHAPE
INVARIANT, `render-corpus-enumerator.js` `tierOf()`, `generate-baseline.js`, the baseline cells) + the
L1/L2/L3 oracle DD. PLUS the legacy smoke-test / verification-ledger anti-patterns the DD flagged
(`examples/test-examples.js` SERVER_EXAMPLES error-class suppression, `todomvc.spec.ts` AC7 baking a
known gap as a red assertion, `examples/VERIFIED.md` all-unverified seed). Threads: the #empty/#populated
cell model, the NO-ERROR-CLASS-SUPPRESSION principle, found-a-gap-vs-test-broken, VERIFIED.md as L2 seed.

## Core files
`compiler/tests/e2e-render-map/render-harness.js` · `render-detectors.js` · `seed-fixtures.js` · `generate-baseline.js` · `examples/test-examples.js` · `examples/VERIFIED.md`

## Items (least-ingestion-first)
1. **`e2e-render-map-tier-rebaseline`** `[landed-on-branch d77b58e5]` feature LOW · tier low — regenerate the baseline-map with first-class per-cell tier tags (flagship/probe/stress/perf/sample); `tierOf()` landed S202 but baseline cells carry no tier. Mechanical: rerun `generate-baseline.js --write` (watch within-node re-baseline).
2. **`examples-verified-md-human-seed`** `[landed-on-branch 9856a741]` feature LOW · tier low — `examples/VERIFIED.md` has ZERO `[x]` rows (all human-unverified by design; only the USER flips). It's the L2 snapshot human-seed input. Ledger, not code. Entry: examples/VERIFIED.md.
3. **`test-examples-server-suppression-antipattern`** `[landed-on-branch 9856a741]` bug LOW · tier low — `test-examples.js` SERVER_EXAMPLES filter suppresses `_scrml_fetch_`/SyntaxError = hides bug-2's class (anti-pattern). Decide de-suppress vs rely on render-map. Entry: test-examples.js:161-169.
4. **`todomvc-ac7-test-conflation`** `[landed-on-branch 9856a741]` bug LOW · tier low — `todomvc.spec.ts` AC7 hand-wrote unrendered behavior ("will fail until source rewritten") = conflates found-a-gap with test-broken. Entry: `e2e/tests/todomvc.spec.ts:158-184` + benchmarks/todomvc/app.scrml.
5. **`g-rendermap-needs-server-classification`** `[landed-on-branch c09af7f1]` feature LOW · tier med — render-map should add needs-server cell-state / mock-server seeding for full-stack/`<db>` apps so server-absence stops recording as D1-MOUNT-THROW. Entry: seed-fixtures.js + render-detectors.js.
6. **`g-rendermap-server-classification`** `[landed-on-branch c09af7f1]` bug LOW · tier med — render-map follow-up: classify full-stack apps as server-class (client bundle hits server-only `scrml:store` at no-server mount). Harness-realism gap (b+c disposition S203). Entry: render-harness.js mountAndObserve (:70-81,150-176); read delta-log S203 [10][12].
7. **`e2e-render-map-gap-ingestion`** `[parked — escalate-to-PA]` feature n-a · tier med — e2e step-5: ingest baseline cells → `@gap` nodes (gap-discovery feeding flograph) — DEFERRED at L1. Token shape + checker specified (DD §379-389). Entry: generate-baseline.js + scripts/state.ts.
8. **`e2e-render-map-L2-L3`** `[parked — escalate-to-PA]` feature n-a · tier high — L2 (snapshot baseline gated on VERIFIED.md provenance) + L3 (legacy-vs-native render differential) — post-L1 oracle fork; surviving fork = primary-oracle strategy (L3 couples to FEATURE-stale native parser). Entry: generate-baseline.js + render-detectors.js (DD §232-295).

## Progress
`ss10.progress.md`. Land on `spa/ss10`; ping PA inbox when ready. Do not advance main / do not push.
