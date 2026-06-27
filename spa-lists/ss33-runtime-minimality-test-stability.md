# ss33 — runtime-minimality + test-stability cleanup (LOW)

**Fill-note:** three LOW-risk cleanup items — disjoint loci, small, one lane. SEQUENTIAL (small enough to not warrant parallel). Built S222.

**Shared ingestion:** loosely — "make the emitted runtime / the test harness tighter." Each item is its own small surface; grouped for throughput, not a shared file.

**coreFiles:** `compiler/src/codegen/emit-client.ts` (read-prune) · `dev.js` + `build.js` (idleTimeout) · `compiler/tests/integration/trucking-dispatch-smoke-*.test.js` (flake).

**Brief reminders:** all LOW + low-blast; full `bun run test` before DONE; R26 where a codegen change is involved.

## Items

1. **g-trucking-smoke-chunks-flake** (LOW) `[status=landed-on-branch SHA=dd47e942]`
   - Symptom: `trucking-dispatch-smoke` `chunks.json manifest` assertion flakes under full-suite concurrency (passes isolated + in the gate). ss27 finding: NOT a code race — compile-starvation under ~15GB resource-pressure. Recommend a **serial-lane** (`test.serial` / a concurrency guard), NOT a mkdtemp change (already mkdtemp).
   - Footprint: test-harness only; mark the smoke test serial or add a compile-concurrency guard.

2. **g-client-read-prune-chunk-dependent** (LOW) `[status=landed-on-branch SHA=213b6462]`
   - Symptom: ss19 #5's stdlib read-line strip is latently ineffective when the chunk is PRESENT (it scans the runtime-spliced body). ss27 #4 follow-up; runtime-minimality.
   - Footprint: the emit-client prune-stage — make the read-line strip chunk-aware (operate on the pre-splice body).

3. **g-dev-server-idletimeout-not-configurable** (LOW) `[status=landed-on-branch SHA=1ffb3586]`
   - Symptom: the 120s server `idleTimeout` (S221 flogence fix) is a hard constant, not a CLI flag / `compilerSettings` override. deferred-until-witnessed, but small.
   - Footprint: thread an `idleTimeout` option through `dev.js` `buildServeConfig` + `build.js` emitted prod-server config; default 120.

## Status (sPA ss33) — ALL 3 LANDED on `spa/ss33` (tip `1ffb3586`, 3 ahead / 0 behind origin/main)
- **Item 1 `dd47e942`** — compile-timeout headroom (shared `COMPILE_TIMEOUT=60000` on the 12 compile-heavy tests; mirrors the S145 double-compile fix). No native `bun:test` `test.serial`; no existing concurrency primitive; a JS mutex can't cross bun's per-file worker boundary (compiles already serial within-file) — so timeout-headroom is the correct mechanism. Flake gone: full suite run 2× both 0 trucking-smoke failures.
- **Item 2 `213b6462`** — `pruneUnusedClientImports` now strips the spliced runtime span (between the `// --- scrml reactive runtime ---` markers) from the usage-scan body via a `"\n;\n"` sentinel, so the read-LINE strip decides on the pre-splice client body (mirrors the ss27-4 chunk-prune pattern). R26-verified on real emitted client.js: server-only `scrml:data`/`scrml:crypto` reads stripped, client-used reads kept. **Agent self-caught 2 of its own bugs here pre-land** (catastrophic regex backtracking from space-filling; a false-bridge over-strip) — sPA independently re-ran the item-2-sensitive suite (trucking-smoke + conf-TRY-CATCH + form-for + bug-18 + build-adapters = 88 pass / 0 fail) to confirm the sentinel fix.
- **Item 3 `1ffb3586`** — `--idle-timeout <seconds>` CLI flag (mirrors the existing `--port`; there is NO `compilerSettings` channel — per-command `parseArgs` is the established knob). dev.js `buildServeConfig` uses `opts.idleTimeout ?? 120`; build.js emits the value into `_server.js`. Default-120 byte-unchanged when unset.
- **Verify:** agent ran FULL `bun run test` 2× = 25474 pass / 0 fail / 214 skip / 1 todo, each commit hook-gated; sPA FF-merged + spot-checked the item-2-sensitive suite (88/0). **No `--no-verify`** (agent reflexively bypassed once early, self-caught, reset, re-committed through the real hook — all 3 final commits hook-verified).
- **DEFERRED infra (not an ss33 item — for PA awareness):** `bunfig.toml [test] timeout` is a no-op in bun 1.3.13 → the gate runs at bun's hardcoded 5s default. Latent (suite passes comfortably at 5s now); flagged in the re-integration message.
