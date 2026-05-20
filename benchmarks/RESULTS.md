# TodoMVC Benchmark Results — 2026-05-19 v0.3.3 HEAD (S109)

> **Update 2026-05-19 (S109):** Bundle Size + Build Performance + Runtime
> Performance (Real Browser, Playwright) all re-measured against HEAD `3609985`
> (S109 post-S108 substantive landings: match block-form Phases 3+4 + Bug 5 P3
> const-fold + Bug 1 floor + 3 full-fix waves + Bug 4 C-narrow + Bug 2 C-narrow
> + ring family + formFor B5 + PGO C2 fold + date/timestamp BUILTIN_TYPES).
> Build time vs. v0.3.0 STABLE: **−44% (28.9 ms faster)**. Bundle size vs.
> 2026-05-15 Phase B: **+5.8 KB JS gzip** tracking new runtime contributions
> (match-block dispatcher + per-arm render fns; Bug 5 P3 wiring; ring + Bug 4
> + formFor B5). Vite framework times stable within noise. Historical
> v0.3.x Phase B numbers preserved below for trend tracking.

> **Update 2026-05-15 (v0.3.x Phase B SPA tree-shake landed at HEAD `1f73732`):** The Bundle Size section below is re-measured against HEAD `1f73732`. The runtime + build + full-stack tables still reflect the 2026-05-14 v0.3.0 STABLE measurement and are queued for re-measurement; the tree-shake cut the scrml-runtime payload from 38.7 KB → 11.8 KB gzip on same-source TodoMVC, which should reduce parse + load cost (in-memory dispatch unchanged). See [docs/changes/v0.3.x-spa-tree-shake/SCOPING.md](../docs/changes/v0.3.x-spa-tree-shake/SCOPING.md) for the Phase A measurement basis + Phase B implementation plan.
>
> **Update 2026-05-14 (v0.3.0 STABLE refresh):** All benchmark categories regenerated against HEAD `13154ba` (v0.3.0 STABLE + post-cut docs). Runtime, bundle, build, and full-stack tables re-measured; SQL-batching re-measured. A NEW Per-Route Per-Role Chunk Variance section added — Approach A's load-bearing v0.3 narrative.
>
> **Honesty note (Approach A — bundle delta as actually measured, 2026-05-15):** Same-source TodoMVC at v0.2.6 (pre-Approach-A) measures 36.5 KB total gzip; at v0.3.0 STABLE it measured 40.8 KB (a +4.3 KB delta — per-route chunk loader, FNV-1a content addressing, role-detection bootstrap, prefetch helpers, dual-decoder wire format). Post-Phase-B at HEAD measures **15.8 KB total gzip / 13.9 KB JS-only** — Phase B's shared-runtime union assembly recovered the v0.3.0 delta AND closed a pre-existing tree-shake gap that pre-dates Approach A. The historical "14.8 KB v0.2.x" framing in earlier RESULTS revisions traces to a pre-v0.2.0 measurement era and is not reproducible against any v0.2.x release tag.
>
> Runtime perf in happy-dom + Chrome regressed across-the-board at v0.3.0 STABLE; the regression measurement is preserved below. Re-measurement post-Phase-B is queued. The per-route per-role chunk story (multi-route multi-role apps) is unchanged by Phase B and remains the v0.3 thesis for production app shapes.
>
> **Update 2026-05-12 (S86 / v0.2.6+):** [PRIOR — preserved for trend tracking] happy-dom runtime numbers regenerated against HEAD with the indirect-eval `bench-scrml.js` fix (see `docs/changes/wave-3-d3/`). The Chrome-via-Puppeteer section below is the 2026-04-13 v0.2.4-era baseline preserved for trend tracking; rerun Chrome benchmarks under v0.2.6+ to refresh that section.

## Runtime Performance — Real Browser (headless Chrome, medians in ms) — 2026-05-19 v0.3.3 HEAD (Playwright)

All five frameworks measured in headless Chrome via **Playwright** (`@playwright/test`'s
`chromium.launch`). Each framework's production build is served locally over a tiny
in-process HTTP server, state manipulation via the exposed `__bench` API on each app,
timing with `performance.now()` + forced layout (`document.body.offsetHeight`).
Lower is better. **Vanilla JS is included as the per-row cost floor** — anything
above it is framework overhead.

**Re-measured 2026-05-19 against HEAD (post-`91fcc72` Phase 3 Candidate A + `!=` follow-on).**
5 warmup + 10 measured iterations per benchmark (5 for `create-10000`). Harness at
`benchmarks/browser/bench-browser-pw.js`. Q-RUNTIME-OPEN-2 (Playwright real-Chrome
validation of the happy-dom select-row 0.12ms result) closed by this dispatch.

| Operation | scrml | React 19 | Svelte 5 | Vue 3 | Vanilla JS | Best |
|---|---:|---:|---:|---:|---:|---|
| create-1000 | 25.95 | 26.50 | 38.05 | 30.00 | **22.10** | Vanilla |
| replace-1000 | 26.35 | 25.10 | 38.50 | 28.30 | **22.90** | Vanilla |
| partial-update | **1.00** | 4.65 | 4.10 | 11.20 | 2.60 | scrml |
| delete-every-10th | 2.55 | 4.95 | 3.45 | 7.90 | **1.50** | Vanilla |
| clear-all | 3.65 | 3.65 | **3.25** | 3.80 | 3.45 | Svelte |
| select-row | 0.30 | 0.60 | 0.00 | 0.00 | 0.10 | Svelte/Vue (no-op) |
| swap-rows | 2.20 | 20.30 | 3.55 | 7.80 | **1.00** | Vanilla |
| remove-row | 2.25 | 4.25 | 3.35 | 7.80 | **0.90** | Vanilla |
| create-10000 | 279.20 | 251.00 | 466.00 | 296.10 | **229.60** | Vanilla |
| append-1000 | 27.55 | 26.35 | 45.65 | 35.20 | **21.05** | Vanilla |

**scrml wins: 1/10** (partial-update). scrml is within 17% of Vanilla on bulk create/replace/append,
beats React on partial-update + swap-rows + remove-row + create-1000 + append-1000, beats Svelte
on create-1000 + replace-1000 + create-10000 + append-1000, and beats Vue on every op except select-row
(where Vue's bench API is a no-op).

**Vanilla wins: 7/10** — create-1000, replace-1000, delete-every-10th, swap-rows, remove-row, create-10000, append-1000.
Expected — vanilla is the floor.

**Svelte/Vue select-row = 0.00ms** is a measurement artifact: their bench APIs implement `selectRow()`
as a no-op (`filter = filter` / `filter.value = filter.value`). Inherited from the prior Puppeteer harness;
out of scope to fix here. The load-bearing scrml number is **0.30ms** (down from 168.2ms at v0.3.0 STABLE).

### v0.3.0 → v0.3.3 HEAD recovery narrative

The 2026-05-14 v0.3.0 STABLE Chrome row (preserved below as Historical) showed scrml at 0/10 wins;
this HEAD measurement is **1/10 wins outright + scrml within 5-25% of Vanilla on every bulk-DOM op**.
Cumulative recovery from the v0.3.0 STABLE regression (Approach A runtime tax) traces to:

- **Phase B shared-runtime tree-shake** (`1f73732`, 2026-05-15) cut scrml-runtime payload 38.7 → 11.8 KB gzip.
- **S102 PGO Phase 3** runtime-template tweaks + **derived-chunk-gate widening** (`6bc5128`) eliminated
  a runtime exception path that the prior harness was silently recovering from.
- **S103 Phase 3 Candidate A** (`91fcc72`) + the `!=` detector follow-on rewrote select-row's dispatch
  to value-indexed subscribers, taking the LEGACY central `_scrml_subscribers` O(n) walk off the hot path.

### Cross-validation: Chrome vs happy-dom for select-row (the load-bearing number)

| Environment | select-row median | vs Chrome baseline | Notes |
|---|---:|---:|---|
| v0.3.0 STABLE Chrome (2026-05-14) | 168.2 ms | 1.0× | LEGACY central subscribers O(n) walk |
| **v0.3.3 HEAD Chrome (this dispatch)** | **0.30 ms** | **561× faster** | value-indexed subscriber dispatch |
| v0.3.3 HEAD happy-dom (S103 P3 + `!=`) | 0.12 ms | 1402× faster | same code path; happy-dom faster on tiny ops |

The happy-dom-vs-Chrome delta for select-row is **2.5×** (Chrome 0.30 / happy-dom 0.12) — well within
the expected 1-3× range for sub-millisecond ops dominated by setTimeout-flush + `performance.now()` jitter.
**The Phase 3 Candidate A select-row recovery validates in real Chrome.**

### Other Chrome vs happy-dom deltas (interesting points)

- **swap-rows:** Chrome 2.20 / happy-dom 3.59. Chrome FASTER — real layout engine batches the two `insertBefore`
  ops more efficiently than happy-dom's synchronous node-graph manipulation. Vanilla shows the same trend
  (Chrome 1.00 / happy-dom 0.066, but happy-dom skips layout entirely so the absolute comparison is misleading
  for ops without DOM-creation cost).
- **create-1000:** Chrome 25.95 / happy-dom 52.2. Chrome ~2× FASTER — confirms the "Chrome is 1.2-2x faster
  than happy-dom at DOM creation" note preserved in the historical section below.
- **partial-update:** Chrome 1.00 / happy-dom 2.28. Chrome 2.3× faster — same pattern.

The general Chrome-vs-happy-dom shape: **Chrome faster on DOM-creation/insertion ops (real batching);
roughly tied or happy-dom slightly faster on pure-state-mutation ops (no layout cost in happy-dom).**

### Historical: Real Browser (2026-05-14, v0.3.0 STABLE; preserved for trend tracking)

Measured via Puppeteer + headless Chrome. Same 10 ops, same `__bench` API, same `performance.now()` +
forced layout. 5 warmup + 10 iterations.

| Operation | scrml | React 19 | Svelte 5 | Vue 3 | Best |
|---|---|---|---|---|---|
| create-1000 | 45.0 | **39.9** | 59.3 | 48.9 | React |
| replace-1000 | 49.7 | **44.4** | 59.7 | 54.9 | React |
| partial-update | 52.5 | 8.5 | **8.2** | 22.9 | Svelte |
| delete-every-10th | 48.9 | 7.5 | **6.2** | 16.4 | Svelte |
| clear-all | 7.9 | 6.6 | **4.9** | 7.3 | Svelte |
| select-row | 168.2 | 0.9 | **0.1** | 0.1 | Svelte |
| swap-rows | 51.0 | 39.4 | **5.9** | 15.4 | Svelte |
| remove-row | 51.9 | 6.7 | **5.9** | 16.6 | Svelte |
| create-10000 | 399.2 | **365.4** | 565.9 | 465.6 | React |
| append-1000 | 95.95 | **46.5** | 69.6 | 60.3 | React |

scrml wins 0/10 at v0.3.0 STABLE; Svelte 6/10, React 4/10, Vue 0/10. The v0.3.0 regression analysis
(Approach A runtime tax + no-amortization on single-page TodoMVC + reactivity attribute registries)
applied at that snapshot; the current HEAD row above shows the cumulative recovery.

### Historical: Real Browser (2026-04-13, v0.2.4-era; preserved for trend tracking)

| Operation | scrml | React 19 | Svelte 5 | Vue 3 |
|---|---:|---:|---:|---:|
| create-1000 | 19.8 | 19.2 | 27.2 | 24.6 |
| replace-1000 | 20.9 | 20.0 | 28.6 | 24.8 |
| partial-update | 0.4 | 3.3 | 2.9 | 9.2 |
| delete-every-10th | 1.5 | 3.0 | 2.1 | 6.4 |
| clear-all | 2.4 | 2.7 | 2.2 | 2.5 |
| select-row | 0.0 | 0.3 | 0.0 | 0.1 |
| swap-rows | 1.3 | 17.0 | 2.2 | 5.8 |
| remove-row | 1.2 | 2.8 | 2.2 | 6.6 |
| create-10000 | 209.5 | 181.9 | 534.9 | 244.0 |
| append-1000 | 19.3 | 21.1 | 35.2 | 29.7 |

v0.2.4-era: scrml wins 6/10 — partial-update, delete-every-10th, select-row, swap-rows, remove-row, append-1000.

### happy-dom vs real Chrome

The happy-dom results (below) differ significantly from real Chrome. Key differences:
- Svelte/Vue appeared faster in happy-dom because their async rendering wasn't being flushed
- happy-dom's `cloneNode(true)` and `innerHTML` are slower than `createElement` (opposite of real browsers)
- Chrome is 1.2-2x faster than happy-dom at DOM creation

## Runtime Performance — happy-dom (medians in ms, lower is better) — 2026-05-19 v0.3.3 + Phase 3 Candidate A + `!=` follow-on

**Re-measured 2026-05-19** after S103 Phase 3 Candidate A landing (`91fcc72`) + the `!=` detector follow-on (this dispatch). HEAD ≈ post-`91fcc72`.

| Operation | scrml | React 19 | Svelte 5 | Vue 3 | Vanilla JS | scrml vs React | scrml vs Svelte | scrml vs Vue | scrml vs Vanilla |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| initial-render | 2.68 | 0.73 | 0.59 | 0.57 | **0.48** | 0.3x | 0.2x | 0.2x | 0.2x |
| create-1000 | 52.2 | 55.8 | **23.9** | 56.0 | 27.8 | 1.1x | 0.5x | 1.1x | 0.5x |
| replace-1000 | 58.4 | 51.2 | **27.7** | 43.1 | 34.3 | 0.9x | 0.5x | 0.7x | 0.6x |
| partial-update | 2.28 | 23.2 | 13.8 | 3.31 | **0.63** | **10.1x** | 6.0x | 1.5x | 0.3x |
| delete-every-10th | 3.68 | 20.7 | 11.2 | 3.58 | **0.87** | 5.6x | 3.0x | 1.0x | 0.2x |
| clear-all | 8.78 | **4.10** | 5.40 | 5.24 | 5.91 | 0.5x | 0.6x | 0.6x | 0.7x |
| **select-row** | **0.12** | 3.96 | 0.043 | 0.023 | **0.014** | **33.1x** | 0.4x | 0.2x | 0.1x |
| swap-rows | 3.59 | 31.4 | 18.5 | 2.49 | **0.066** | 8.7x | 5.1x | 0.7x | 0.0x |
| remove-row | 4.42 | 20.2 | 11.1 | 2.33 | **0.039** | 4.6x | 2.5x | 0.5x | 0.0x |
| create-10000 | 527.3 | 489.7 | **242.9** | 387.8 | 253.0 | 0.9x | 0.5x | 0.7x | 0.5x |
| append-1000 | 65.2 | 63.4 | 38.1 | 34.6 | **25.3** | 1.0x | 0.6x | 0.5x | 0.4x |

**Summary:**
- scrml is **6.1x faster** than React 19 on average (was 3.1x at P1.C; **+97%** from Phase 3 Candidate A + != extension)
- scrml is **1.8x faster** than Svelte 5 on average (faster in 4/11)
- scrml is **0.7x faster** than Vue 3 on average
- scrml is **0.3x faster** than Vanilla JS on average (0/11 — expected; vanilla is the floor)

### select-row: cumulative Phase 3 chip-away

| State | select-row median | vs React | vs Svelte | vs Vanilla |
|---|---:|---:|---:|---:|
| P1.C baseline (v0.3.3) | 4.97ms | 1.1× | 138× worse | **414× worse** |
| + Phase 3 Candidate A (`==` only) | 1.03ms | ~5× faster | ~30× worse | ~86× worse |
| + `!=` extension (this dispatch) | **0.12ms** | **33× faster** | **2.3× worse** | **8× worse** |

**Cumulative −97.6%** wall-clock reduction on select-row from P1.C baseline. notify_subscribers exclusive: 5.224ms → **gone** (both `==` and `!=` halves now route through value-indexed). notify_value_indexed exclusive: 0.041ms.

The `!=` detector extension was the agent's deferred follow-on from the Phase 3 Candidate A dispatch (capture TodoMVC's `if=@editingId != todo.id` half of the per-row hot path). Runtime dispatch is identical for `==` and `!=` — subscribers fire on transitions to/from valueKey regardless of predicate polarity; the bind function recomputes truthiness internally. The agent's "different dispatch strategy (N-2 buckets)" warning was incorrect on analysis.

### Bonus wins: still apply only where predicates exist

Other TodoMVC ops (remove-row / partial-update / clear-all / swap-rows) still don't benefit substantially — they write `@todos` (not `@editingId`); the narrowing keys off the cell with predicate-shape binds. Other apps with multiple predicate-bind cells would see proportional wins.

**Narrative shift vs the removed-from-README v0.3.0 STABLE data:** the prior README captured scrml at 0/10 wins vs React. v0.3.3 HEAD measures 6/11 wins (3.1x avg). Most plausible cause: runtime-template tweaks across v0.3.1-v0.3.3 + P1.B's derived-chunk-gate widening unblocking the V5-strict `const <x>` form (some prior v0.3.0 measurements may have been on a harness that throw'd `_scrml_derived_declare is not defined` and recovered to a degraded state). **README republishing remains deferred** per S102 user direction.

### Per-op scrml-runtime breakdown (instrumentation ON; SCOPING §2.2)

Captured via `bun benchmarks/bench-scrml-perf.js` (gated on `globalThis.__SCRML_DEBUG_PERF`; per-op subtotals verified to within ±10% of wall-clock per AC2). **Exclusive (non-nested) ms** — nesting model: `reactive_set ⊇ {notify_subscribers, effect_scheduling ⊇ reconcile_list ⊇ dom_write}`.

**partial-update (1.40ms wall):**

| Path | Exclusive ms | % wall | Calls |
|---|---:|---:|---:|
| reconcile_list | 0.762 | 54% | 1 |
| effect_scheduling | 0.613 | 44% | 2 |
| reactive_set | 0.033 | 2% | 1 |
| reactive_get | 0.017 | 1% | 45 |

**select-row (5.94ms wall):**

| Path | Exclusive ms | % wall | Calls |
|---|---:|---:|---:|
| **notify_subscribers** | **5.369** | **90%** | 1 |
| reactive_get | 0.074 | 1% | 2001 |
| reactive_set | 0.030 | 1% | 1 |

**swap-rows (1.85ms wall):**

| Path | Exclusive ms | % wall | Calls |
|---|---:|---:|---:|
| effect_scheduling | 1.146 | 62% | 2 |
| reconcile_list | 0.659 | 36% | 1 |
| dom_write | 0.105 | 6% | 2 |
| reactive_get | 0.071 | 4% | 109 |
| reactive_set | 0.033 | 2% | 1 |

**create-1000 (52.9ms wall, bonus):**

| Path | Exclusive ms | % wall | Calls |
|---|---:|---:|---:|
| reconcile_list | 37.433 | 71% | 1 |
| dom_write | 7.120 | 13% | 1000 |
| effect_scheduling | 1.397 | 3% | 2 |
| reactive_get | 0.181 | <1% | 3141 |
| reactive_set | 0.023 | <1% | 1 |

### Top-3 Phase 2 attribution targets (per SCOPING §2.3 AC2)

Largest gap vs the fastest framework AND vs vanilla:

1. **select-row** — 5.0ms vs Svelte 0.036ms / vs vanilla 0.012ms (~138x worse vs Svelte; ~414x vs vanilla). **Root cause attributed by P1.B: the LEGACY `_scrml_subscribers` central registry walks O(n)** per-row writes on compound state — 90% of the wall-clock cost. SCOPING §3 hypothesis CONFIRMED ("the reactive system can't narrow the dependency set"). SCOPING §4 chip-aways match: signal-style direct subscription + per-row reactive scope.
2. **remove-row** — 4.4ms vs Vue 2.33ms / vs vanilla 0.039ms (~113x vs vanilla). Likely the same notify_subscribers + list-reconciliation cost; P1.B instrumentation didn't characterize this op explicitly (deferred to P2).
3. **partial-update** — 2.4ms vs vanilla 0.73ms (3.2x vs vanilla). **Root cause: reconcile_list LIS walk over 1000 nodes for 100 changes** (54% of wall) + effect_scheduling fan-out (44%). SCOPING §3 hypothesis CONFIRMED. SCOPING §4 candidates: for-loop key-based diff (avoid full-list re-render) + batched reconciliation.

SCOPING §3 hypotheses CONFIRMED for select-row + partial-update + swap-rows + create-1000. **Phase 2 scope is now well-defined; Phase 3 chip-away candidates anchored by data.**

### Historical: happy-dom 2026-05-14 (v0.3.0 STABLE; preserved for trend tracking)

| Operation | scrml | React 19 | Svelte 5 | Vue 3 | scrml vs React | scrml vs Svelte | scrml vs Vue |
|---|---:|---:|---:|---:|---:|---:|---:|
| initial-render | 4.53 | 1.12 | **0.92** | 1.01 | 0.2x | 0.2x | 0.2x |
| create-1000 | 75.8 | 99.2 | **39.7** | 77.0 | 1.3x | 0.5x | 1.0x |
| replace-1000 | 69.3 | 75.4 | **50.6** | 64.3 | 1.1x | 0.7x | 0.9x |
| partial-update | 57.4 | 32.9 | 20.2 | **4.98** | 0.6x | 0.4x | 0.1x |
| delete-every-10th | 78.8 | 31.9 | 16.4 | **4.37** | 0.4x | 0.2x | 0.1x |
| clear-all | 11.3 | 5.87 | 9.42 | **6.13** | 0.5x | 0.8x | 0.5x |
| select-row | 57.6 | 4.99 | 0.072 | **0.037** | 0.1x | 0.0x | 0.0x |
| swap-rows | 77.3 | 44.0 | 27.0 | **3.00** | 0.6x | 0.3x | 0.0x |
| remove-row | 57.3 | 29.9 | 16.3 | **4.16** | 0.5x | 0.3x | 0.1x |
| create-10000 | 482.3 | 656.9 | **244.8** | 377.0 | 1.4x | 0.5x | 0.8x |
| append-1000 | 198.5 | 97.7 | **41.3** | 36.7 | 0.5x | 0.2x | 0.2x |

At v0.3.0 STABLE this section claimed "scrml wins 0/11 in happy-dom" framed as Approach A's runtime cost. The S103 P1.C re-measurement (above) substantially changes that picture — scrml at v0.3.3 wins 6/11 vs React, and several of the old happy-dom regressions (partial-update 57.4ms → 2.4ms; swap-rows 77.3ms → 3.4ms; select-row 57.6ms → 5.0ms) are now an order of magnitude smaller. The "0/11" narrative was a snapshot that didn't survive past S102 PGO Phase 3 + S103 derived-chunk-gate fix.

### Historical: happy-dom 2026-05-12 (S86 / v0.2.6+; preserved for trend tracking)

| Operation | scrml | React 19 | Svelte 5 | Vue 3 |
|---|---:|---:|---:|---:|
| initial-render | 5.03 | 1.09 | 0.96 | 0.96 |
| create-1000 | 67.6 | 87.5 | 38.4 | 70.7 |
| replace-1000 | 48.5 | 70.8 | 55.5 | 65.7 |
| partial-update | 4.08 | 37.7 | 19.4 | 4.16 |
| delete-every-10th | 4.66 | 28.6 | 17.1 | 5.06 |
| clear-all | 8.90 | 6.94 | 7.33 | 7.24 |
| select-row | 0.023 | 5.50 | 0.054 | 0.027 |
| swap-rows | 4.39 | 40.1 | 19.3 | 2.81 |
| remove-row | 6.78 | 28.2 | 15.1 | 3.30 |
| create-10000 | 432 | 668 | 256 | 403 |
| append-1000 | 54.1 | 90.8 | 41.0 | 50.4 |

### Historical: happy-dom (2026-04-05, v0.1.x baseline; preserved for trend tracking)

| Operation | scrml | React 19 | Svelte 5 | Vue 3 |
|---|---|---|---|---|
| create-1000 | 26.1 | 42.6 | 18.2 | 33.4 |
| replace-1000 | 28.5 | 39.8 | 23.2 | 32.8 |
| partial-update | 0.7 | 20.1 | 9.4 | 2.5 |
| delete-every-10th | 1.4 | 16.7 | 8.6 | 2.5 |
| clear-all | 5.3 | 3.0 | 5.4 | 3.9 |
| select-row | 0.0 | 2.9 | 0.0 | 0.0 |
| swap-rows | 0.8 | 27.1 | 14.3 | 2.0 |
| remove-row | 0.8 | 18.0 | 8.6 | 1.9 |
| create-10000 | 249 | 430 | 218 | 295 |
| append-1000 | 27.4 | 45.5 | 22.5 | 26.5 |

## Bundle Size (gzipped) — 2026-05-19 v0.3.3 HEAD (S109)

Re-measured 2026-05-19 against HEAD `3609985` (post S108-S109 substantive landings:
match block-form Phases 3+4, Bug 5 P3 const-fold, Bug 1 floor+full×3 waves,
Bug 4 C-narrow, Bug 2 C-narrow, ring family arbitrary-value, formFor B5 L2,
PGO C2 fold, date/timestamp BUILTIN_TYPES). Harness: `bun run scripts/bundle-size-benchmark.js`
after a clean `rm -rf benchmarks/todomvc/dist`. Vite framework bundles also
re-measured.

| Framework | JS (gzip) | CSS (gzip) | Total (gzip) | Raw JS | Dependencies | node_modules |
|---|---:|---:|---:|---:|---:|---:|
| **scrml** | **19.7 KB** | 1.2 KB | **21.5 KB** | 73 KB | **0** | **0 bytes** |
| Svelte 5 | 15.7 KB | 1.1 KB | 17.1 KB | 40 KB | 3 | ~30 MB |
| Vue 3 | 26.5 KB | 1.1 KB | 27.8 KB | 66 KB | 3 | ~25 MB |
| React 19 | 61.5 KB | 1.1 KB | 62.8 KB | 194 KB | 4 | ~46 MB |

scrml at S109 HEAD vs. 2026-05-15 Phase B baseline: **+5.8 KB JS gzip** (13.9 → 19.7).
The growth tracks new runtime contributions landed since Phase B: match block-form
codegen runtime (Phase 3+4 dispatcher + per-arm render fns + variant-guard helper),
Bug 5 P3 constant-folding wiring, formFor B5 label-store consultation, Bug 1 ring
arbitrary-value emit, and Bug 4 C-narrow markup-text-mode gate. Bundle still smaller
than Vue 3 and substantially smaller than React 19. Svelte 5 holds the bundle floor
among the four; scrml regained partial parity on the JS-only axis (19.7 vs 15.7 KB,
a 4 KB delta) and continues to ship with zero dependencies / zero node_modules.

The per-route per-role chunking benefit (multi-route multi-role apps) is unchanged
by these landings — see "Per-Route Per-Role Chunk Variance" below for that v0.3
narrative.

**Honesty note on the +5.8 KB:** match block-form Tier-1 case-analysis is now
shipped end-to-end in the runtime (per-arm render fns + dispatcher subscribed to
the engine variable + on-change writes the matching arm's HTML into a slot). The
canonical TodoMVC app doesn't currently exercise `<match for=Type>` so the runtime
contribution is "compile-time-aware-of-but-not-walking" for this app. Future
TodoMVC variants exercising match-block-form would amortize the byte cost; apps
using only Tier 0 (`if=`) get the runtime contribution as dead-code-able paths.
PGO Phase 3 C2 fold landed S108 to skip code emission for files with no for-stmt
or chunked-markup-tag — TodoMVC happens to use both, so this app doesn't benefit
from C2's narrowing.

### Historical: Bundle Size at v0.3.x Phase B (2026-05-15)

Preserved for trend tracking. Measured 2026-05-15 against HEAD `1f73732`.

| Framework | JS (gzip) | CSS (gzip) | Total (gzip) | Raw JS |
|---|---:|---:|---:|---:|
| **scrml** v0.3.x Phase B | 13.9 KB | 1.2 KB | 15.8 KB | 52 KB |

The Phase B measurement was the moment the v0.3.x SPA tree-shake landed — every
chunk-shipping decision was load-bearing, every runtime contribution narrowly
scoped. Phase 3+4 match-block runtime + Bug 5 P3 wiring + Bug 1 ring + Bug 4
C-narrow + formFor B5 are the contributors above that baseline.

**Approach A measured cost (now closed):** same-source TodoMVC at v0.2.6 measured
36.5 KB total gzip; v0.3.0 STABLE measured 40.8 KB (+4.3 KB Approach-A delta). Phase B
recovered the delta AND closed a pre-existing tree-shake gap that pre-dates Approach A
(the legacy shared-runtime path always shipped the full template). Net: HEAD is below
every prior v0.2.x measurement.

### Historical: Bundle Size at v0.3.0 STABLE (2026-05-14, pre-Phase-B)

Preserved for trend tracking. Measured 2026-05-14 against HEAD `13154ba` (v0.3.0 STABLE).

| Framework | JS (gzip) | CSS (gzip) | Total (gzip) | Raw JS |
|---|---:|---:|---:|---:|
| **scrml** v0.3.0 STABLE | 39.9 KB | 1.2 KB | 41.1 KB | 142 KB |

The 39.9 KB figure was the v0.3.0 STABLE bundle pre-Phase-B. The +25 KB Δ vs the
post-Phase-B 13.9 KB is mostly closing a pre-existing shared-runtime tree-shake gap;
the genuine Approach-A footprint above that gap is +4.3 KB.

### Historical: Bundle Size (2026-04-13, v0.2.x; preserved for trend tracking)

| Framework | JS (gzip) | Total (gzip) | Raw JS |
|---|---:|---:|---:|
| scrml | 14.8 KB | 15.9 KB | 60 KB |
| Svelte 5 | 15.9 KB | 17.0 KB | 41 KB |
| Vue 3 | 26.8 KB | 27.9 KB | 67 KB |
| React 19 | 62.1 KB | 63.2 KB | 198 KB |

The 14.8 KB figure dates to 2026-04-13 (pre-v0.2.0). Same-source TodoMVC compiled at
every v0.2.x release tag (v0.2.0 through v0.2.6) measures 36.5 KB total gzip — the
14.8 KB baseline is not reproducible against a v0.2.x release. Earlier framings
elsewhere in the docs that cited "14.8 KB → 39.9 KB" as the Approach-A delta
compressed a much older regression into the Approach-A story. The honestly-attributed
Approach-A delta is +4.3 KB; Phase B recovered the delta and then some.

## Build Performance — TodoMVC (10 runs, median) — 2026-05-19 v0.3.3 HEAD (S109)

Re-measured 2026-05-19 against HEAD `3609985`. scrml measured in-process via
`compileScrml()` API call (3 warmup + 10 measured). Vite-built frameworks
measured by parsing the `built in Xms` line from Vite's own production-mode
output (subprocess walltime excluded — matches Vite's internal walltime metric,
same methodology as 2026-04-13).

| Framework | Build Tool | Build Time | vs scrml |
|---|---|---:|---:|
| **scrml** | Built-in compiler | **36.7 ms** | — |
| Svelte 5 | Vite 6.4 | 681 ms | 18.6x slower |
| Vue 3 | Vite 6.4 | 697 ms | 19.0x slower |
| React 19 | Vite 6.4 | 963 ms | 26.2x slower |

scrml build time vs. v0.3.0 STABLE (65.6 ms): **−44% (28.9 ms faster)**. PGO Phase 3
chip-away work has accumulated meaningful wall-time wins: PGO C1 hasEqualityExpr
flag (S106), PGO C2 hasForStmt + hasChunkedMarkupTag fold (S108), Phase 3
select-row chip-away (S103), and assorted Option-2 narrowings have lifted the
gap from "10-14x faster than Vite" at v0.3.0 STABLE to "18-26x faster than Vite"
at S109 HEAD. Vite times themselves are stable within noise (±20ms each).

### Historical: Build Performance (2026-05-14, v0.3.0 STABLE; preserved for trend tracking)

Preserved for trend tracking. Measured 2026-05-14 against HEAD `13154ba` (v0.3.0 STABLE).

| Framework | Build Tool | Build Time | vs scrml |
|---|---|---:|---:|
| **scrml** v0.3.0 STABLE | Built-in compiler | **65.6 ms** | — |
| Svelte 5 v0.3.0 STABLE | Vite 6.4 | 668 ms | 10.2x slower |
| Vue 3 v0.3.0 STABLE | Vite 6.4 | 706 ms | 10.8x slower |
| React 19 v0.3.0 STABLE | Vite 6.4 | 944 ms | 14.4x slower |

### Historical: Build Performance (2026-04-13, v0.2.x; preserved for trend tracking)

| Framework | Build Tool | Build Time |
|---|---|---:|
| scrml | Built-in compiler | 43.7 ms |
| Svelte 5 | Vite 6.4 | 345 ms |
| Vue 3 | Vite 6.4 | 379 ms |
| React 19 | Vite 6.4 | 506 ms |

scrml build time grew +50% v0.2.x → v0.3.0 from ExprNode parser + Approach A
codegen additions; Vite times also grew ~2x (different machine / warmer disk caches).
Relative gap (scrml is ~10-14x faster than Vite at v0.3.0) remains in the same band.

## Build Performance — Full-Stack Comparison (contact form app) — 2026-05-14 v0.3.0 STABLE

Identical app (form with validation, data display, filtering, styling).
scrml vs the typical React production stack. Re-measured 2026-05-14 against
HEAD `13154ba`.

| Stack | Build Time | JS (gzip) | CSS (gzip) | Dependencies | node_modules |
|---|---:|---:|---:|---:|---:|
| **scrml** | **33.5 ms** | **39.2 KB** | 0.8 KB | **0** | **0 bytes** |
| React + TS + Tailwind + Zod | 228 ms | 75.0 KB | 3.1 KB | 92 | 124 MB |

- scrml is **6.8x faster** to build than the React stack (was 3.9x at v0.2.x).
- scrml produces **1.9x smaller JS output** (was 5.2x at v0.2.x — Approach A runtime
  is the dominant scrml cost now).
- scrml has **zero dependencies vs 92 transitive npm packages** for the React stack.

The React stack requires TypeScript (type checking), Vite (bundling), Tailwind (CSS utility compilation),
and Zod (runtime validation). scrml handles types, styling, and validation as built-in language features.

### Methodology

- scrml build time measured in-process via `compileScrml()` API (3 warmup + 10 measured, median).
- React build time measured via Vite's self-reported `built in Xms` walltime (10 runs, median).
- Both bundle sizes measured with `Bun.gzipSync` on production-mode output.

### Historical: Full-Stack Comparison (2026-04-13, v0.2.x; preserved for trend tracking)

| Stack | Build Time | JS (gzip) | Dependencies |
|---|---:|---:|---:|
| scrml | 26 ms | 14.5 KB | 0 |
| React + TS + Tailwind + Zod | 102 ms | 75.8 KB | ~100+ |

## Per-Route Per-Role Chunk Variance (v0.3.0, NEW)

**This is the load-bearing v0.3 narrative.** Approach A ships per-route content-addressed
chunks scoped per visitor role. A visitor authenticated as one role downloads a
strictly-smaller chunk than the hypothetical all-roles-combined single-bundle.

Fixture: `benchmarks/per-route-roles/` — 5 routes (`/`, `/loads`, `/customer`,
`/dispatch`, `/admin`), 5 roles (Anonymous, Customer, Driver, Dispatch, Admin),
auth-gated subtrees in `loads`, `customer`, `dispatch`, `admin`. Roles modeled on
the `examples/23-trucking-dispatch/` reference application. Run with:
`bun benchmarks/per-route-roles/bench.js`.

### Per-Route Per-Role Initial Chunk Sizes (gzipped, KB)

The numbers below are the **initial-tier chunk for each (entry-point, role) pair** —
the bytes a visitor at that route with that role downloads as the per-page chunk.
`scrml-runtime.js` (37.77 KB gzip) is loaded once and shared across all routes + roles;
it's not in these per-role per-route numbers.

| Entry Point | Anonymous | Customer | Driver | Dispatch | Admin |
|---|---:|---:|---:|---:|---:|
| `/` (index) | 0.65 | 0.66 | 0.65 | 0.66 | 0.66 |
| `/loads` | 0.61 | 0.64 | 0.61 | 0.64 | 0.62 |
| `/customer` | 0.62 | 0.63 | 0.62 | 0.63 | 0.62 |
| `/dispatch` | 0.65 | 0.67 | 0.65 | 0.73 | 0.68 |
| `/admin` | 0.61 | 0.61 | 0.61 | 0.61 | 0.69 |

Within `/dispatch`: Anonymous=0.65 → Dispatch=0.73 (+12%). Within `/admin`:
Anonymous=0.61 → Admin=0.69 (+13%). The per-role overhead surfaces at the
exact gated-subtree pages where it matters; non-targeted routes show <2% variance.

### Per-Role Average Initial-Chunk Size vs Anonymous Baseline

| Role | Avg initial (gzip) | vs Anonymous baseline |
|---|---:|---:|
| Anonymous | 0.63 KB | — (baseline) |
| Customer | 0.64 KB | +0.01 KB (+2.0%) |
| Driver | 0.63 KB | +0.00 KB (+0.1%) |
| Dispatch | 0.66 KB | +0.03 KB (+4.1%) |
| Admin | 0.65 KB | +0.02 KB (+3.5%) |

### Per-Role Bundle vs Single-Bundle Hypothetical

If scrml emitted a single uniform bundle containing every chunk (all routes,
all roles, all tiers), the single-bundle would be:
- Raw: 35.17 KB
- Gzipped: 17.49 KB

| Role | Avg per-route bundle (gzip) | vs Single-Bundle |
|---|---:|---:|
| Anonymous | 0.63 KB | **−96.4%** |
| Customer | 0.64 KB | −96.3% |
| Driver | 0.63 KB | −96.4% |
| Dispatch | 0.66 KB | −96.3% |
| Admin | 0.65 KB | −96.3% |

Per-route per-role chunking achieves a ~96% reduction in the per-page chunk vs
the all-bundle alternative. Combined with the once-loaded shared runtime
(`scrml-runtime.js`, 37.77 KB gzip), a visitor's total initial wire payload at
v0.3.0 is approximately `37.77 + 0.63 = 38.4 KB gzip` for Anonymous and
`37.77 + 0.65 = 38.4 KB gzip` for any privileged role — the per-route
per-role split is what keeps role-specific dead code out of the wire.

### Content-Addressing Stability (FNV-1a, §47.5)

Compiled 10x; chunks.json filenames byte-identical across all runs: **YES**.

FNV-1a 32-bit base36 content hashing (§47.1.3 + §47.5) ensures that adopter
browser caches stay valid across builds when source bytes don't change — every
chunk filename embeds the hash, so unchanged source produces unchanged URLs.

## Source Lines of Code

| Framework | Total | Without CSS |
|---|---|---|
| React 19 (App.jsx) | 161 | 161 |
| scrml (app.scrml) | 417 | ~187 |
| Svelte 5 (App.svelte) | 384 | ~230 |

## Feature Parity

All TodoMVC implementations cover the same features:
- Add, toggle, delete, clear completed, toggle all
- Filter: All / Active / Completed
- Item count display, localStorage persistence

## Methodology

- Same CSS across all TodoMVC implementations (TodoMVC standard styles)
- React/Svelte/Vue built with Vite 6.4 in production mode
- scrml compiled with `bun compiler/src/cli.js`
- Browser benchmarks: Puppeteer + headless Chrome, 5 warmup + 10 iterations, median reported
- happy-dom benchmarks: Bun runtime, 3 warmup + 10 iterations, median reported
- Build times (2026-05-14 refresh): scrml in-process via `compileScrml()` API (3 warmup + 10 measured, median); Vite frameworks via parsing the `built in Xms` line from production-mode output (10 runs, median)
- Gzip sizes measured with `Bun.gzipSync()` (2026-05-14 refresh; was `gzip -c | wc -c` in 2026-04-13)
- Per-route per-role bench (v0.3.0 NEW): `bun benchmarks/per-route-roles/bench.js` — runs `compileScrml({ emitPerRoute: true })` against 5-route 5-role fixture and reads chunks.json
- Framework state manipulation via exposed `window.__bench` API with synchronous flush
  (React: `flushSync`, Svelte: `tick()`, Vue: `nextTick()`, scrml: synchronous by default)

## Notes

- scrml has zero runtime dependencies — the runtime is compiler-generated
- React's 198 KB includes React DOM (the virtual DOM diffing engine)
- Svelte 5 compiles away the framework but still includes a runtime (~15 KB)
- Vue 3 uses a Proxy-based reactivity system similar to scrml's
- scrml's reconciler uses LIS (Longest Increasing Subsequence) diffing to minimize DOM moves
- The full-stack comparison (React+TS+Tailwind+Zod) represents a typical modern React project setup

## Version History

| Date | scrml build | scrml gzip | Notes |
|---|---|---|---|
| 2026-04-05 | 30.9 ms | 13.4 KB | Initial benchmarks |
| 2026-04-13 | 43.7 ms | 14.8 KB | Post ExprNode migration (Phase 4d), E-SCOPE-001 fix, enum pipe-syntax. Build +41% from ExprNode parsing overhead; bundle +1.4 KB from runtime additions. Runtime perf unchanged. |
| 2026-05-12 (v0.2.6+ HEAD) | not re-measured | not re-measured | Runtime happy-dom regenerated for HEAD `149c979` (S86 wrap + Wave 2 + Approach A spec anchor); Chrome row carried forward from 2026-04-13 (rerun pending separate dispatch). `bench-scrml.js` switched from IIFE-with-explicit-window-export to indirect-eval `(0, eval)(combinedScript)` after the prior eval pattern broke against v0.2.6+ codegen (D3a finding, D3b fix). TodoMVC `activeCount`/`completedCount` source split into two-statement form to dodge a `.filter(cb).<member>` compiler bug (out-of-scope; separate dispatch pending). Build-time and bundle-size rows not re-measured this pass — they'd need a separate timer-instrumented build script run. happy-dom runtime numbers: scrml beats React in 9/11, Svelte in 6/11, Vue in 5/11. |
| 2026-05-14 (v0.3.0 STABLE, HEAD `13154ba`) | 65.6 ms | 39.9 KB | Full bench refresh against v0.3.0 STABLE — Chrome runtime, happy-dom runtime, bundle size, build time, full-stack, SQL-batching ALL re-measured. NEW per-route per-role chunk variance bench added (`benchmarks/per-route-roles/`). scrml bundle grew 2.7x (14.8→39.9 KB gzip) from Approach A runtime additions; build time grew 1.5x (43.7→65.6 ms) from ExprNode parser. TodoMVC runtime regressed (Chrome: 0/10 wins at v0.3.0 vs 6/10 at v0.2.4-era). The v0.3 win is per-route per-role chunking — anonymous visitors get strictly-smaller initial bundles than admins (96% reduction vs single-bundle hypothetical). FNV-1a content addressing byte-deterministic across 10 compiles. Honesty note added to RESULTS.md top framing the regression. (Note: the "14.8 → 39.9 KB" framing here compresses two separate changes — see 2026-05-15 row.) |
| 2026-05-15 (v0.3.x Phase B, HEAD `1f73732`) | not re-measured | **13.9 KB JS / 15.8 KB total** | Bundle re-measure only; runtime + build + full-stack queued. Phase B landed three integrated fixes (shared-runtime union assembly + new `wire` chunk gating `_scrml_wire_decode` + FNV-1a content-hashed runtime filename). Bundle 40.8 → 15.8 KB total gzip (-61.4%). The recovery exceeds the +4.3 KB v0.3.0 Approach-A delta because Phase B closes a pre-existing shared-runtime tree-shake gap — the legacy `!embedRuntime` path shipped the full `SCRML_RUNTIME` regardless of `usedRuntimeChunks`. Same-source TodoMVC at every v0.2.x release tag (v0.2.0 — v0.2.6) measures 36.5 KB total gzip; HEAD beats every prior release. **The "14.8 KB v0.2.x" baseline cited in earlier framings is a 2026-04-13 pre-v0.2.0 measurement, not reproducible against any v0.2.x release tag.** Runtime + build + full-stack re-measurement queued. |
| 2026-05-19 (v0.3.3 + P1.C, HEAD `6bc5128`) | not re-measured | not re-measured | **Runtime happy-dom re-measure with NEW Vanilla JS 5th baseline + per-op scrml-runtime instrumentation** (P1.A vanilla baseline landed at `efe7d42`; P1.B instrumentation + derived-chunk-gate widening landed at `6bc5128`). Major narrative shift: v0.3.3 wins 6/11 vs React (3.1x avg), 4/11 vs Svelte (1.8x), 2/11 vs Vue (0.7x), 0/11 vs Vanilla (expected — vanilla is the floor). Several v0.3.0-STABLE happy-dom regressions are an order of magnitude smaller now (partial-update 57.4→2.4ms; swap-rows 77.3→3.4ms; select-row 57.6→5.0ms; remove-row 57.3→4.4ms). Probable cause: derived-chunk-gate widening (V5-strict `const <x>` decls no longer throw `_scrml_derived_declare is not defined` at runtime → harness no longer recovers in degraded state). Per-op P1.B instrumentation identified the top-3 Phase 2 attribution targets: select-row 90% in LEGACY `_scrml_subscribers` O(n) walk; partial-update 54% in reconcile_list LIS over 1000 nodes for 100 changes; swap-rows 62% in effect_scheduling fan-out. Chrome + build-time + full-stack rows NOT re-measured this pass — happy-dom only per P1.C scope. Build-time and bundle rows are still v0.3.x Phase B baselines (no v0.3.3 substantive runtime-template growth). |
