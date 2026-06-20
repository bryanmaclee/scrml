# sPA ss10 — e2e-render-map-test-hygiene

**Launch:** `read spa.md ss10` · **Branch:** `spa/ss10` · **Worktree:** `../scrml-spa-ss10`

**Fill:** ~30% · `at-ceiling` (most ss10 items integrated S210; gap-ingestion L1 + L2/L3 oracle fork → Bucket B)

## Shared ingestion
e2e render-map harness internals + test-hygiene fixtures. Shared loci:
`e2e-render-map/seed-fixtures.js`, `render-harness.js`, `render-detectors.js`, `generate-baseline.js`.
The needs-server classification follow-up and (deferred) gap-ingestion/oracle items all key on the same
harness understanding. Most ss10 items integrated S210; only the needs-server classification follow-up
remains as a possibly-open hygiene residual (verify) — small natural ceiling.

## Core files
`compiler/tests/e2e-render-map/seed-fixtures.js` · `compiler/tests/e2e-render-map/render-harness.js` · `compiler/tests/e2e-render-map/render-detectors.js`

## Items (least-ingestion-first)
1. **`g-rendermap-needs-server-classification-verify`** `[status=open]` LOW · tier low — render-map needs-server cell-state / mock-server seeding — verify the S210 landing is complete (full-stack/`<db>` server-absence no longer D1-MOUNT-THROW). The needs-server cell-state + full-stack server-classification harness work LANDED on spa/ss10 (c09af7f1) and integrated. This item is a CURRENCY VERIFY: confirm full-stack/`<db>` apps no longer record server-absence as D1-MOUNT-THROW on HEAD; if a residual remains (e.g. some apps still mount client-only), finish it. `seed-fixtures.js` + `render-detectors.js` + `render-harness.js` mountAndObserve.
   > **Brief seed:** Verify-before-claim: confirm the needs-server cell-state / mock-server seeding for full-stack/`<db>` apps is complete on HEAD (no D1-MOUNT-THROW pollution from server-absence). If a residual class remains, finish the mock-server seeding. Likely a close-out, not a build. (gap-ingestion L1 + L2/L3 oracle fork routed to Bucket B.)

## Progress
`ss10.progress.md`. Land on `spa/ss10`; ping PA inbox when ready. Do not advance main / do not push.
