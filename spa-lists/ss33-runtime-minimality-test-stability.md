# ss33 — runtime-minimality + test-stability cleanup (LOW)

**Fill-note:** three LOW-risk cleanup items — disjoint loci, small, one lane. SEQUENTIAL (small enough to not warrant parallel). Built S222.

**Shared ingestion:** loosely — "make the emitted runtime / the test harness tighter." Each item is its own small surface; grouped for throughput, not a shared file.

**coreFiles:** `compiler/src/codegen/emit-client.ts` (read-prune) · `dev.js` + `build.js` (idleTimeout) · `compiler/tests/integration/trucking-dispatch-smoke-*.test.js` (flake).

**Brief reminders:** all LOW + low-blast; full `bun run test` before DONE; R26 where a codegen change is involved.

## Items

1. **g-trucking-smoke-chunks-flake** (LOW) `[status=open]`
   - Symptom: `trucking-dispatch-smoke` `chunks.json manifest` assertion flakes under full-suite concurrency (passes isolated + in the gate). ss27 finding: NOT a code race — compile-starvation under ~15GB resource-pressure. Recommend a **serial-lane** (`test.serial` / a concurrency guard), NOT a mkdtemp change (already mkdtemp).
   - Footprint: test-harness only; mark the smoke test serial or add a compile-concurrency guard.

2. **g-client-read-prune-chunk-dependent** (LOW) `[status=open]`
   - Symptom: ss19 #5's stdlib read-line strip is latently ineffective when the chunk is PRESENT (it scans the runtime-spliced body). ss27 #4 follow-up; runtime-minimality.
   - Footprint: the emit-client prune-stage — make the read-line strip chunk-aware (operate on the pre-splice body).

3. **g-dev-server-idletimeout-not-configurable** (LOW) `[status=open]`
   - Symptom: the 120s server `idleTimeout` (S221 flogence fix) is a hard constant, not a CLI flag / `compilerSettings` override. deferred-until-witnessed, but small.
   - Footprint: thread an `idleTimeout` option through `dev.js` `buildServeConfig` + `build.js` emitted prod-server config; default 120.
