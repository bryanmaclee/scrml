# TodoMVC Benchmark Results — 2026-05-12

> **Update 2026-05-12 (S86 / v0.2.6+):** happy-dom runtime numbers regenerated against HEAD with the indirect-eval `bench-scrml.js` fix (see `docs/changes/wave-3-d3/`). The Chrome-via-Puppeteer section below is the 2026-04-13 v0.2.4-era baseline preserved for trend tracking; rerun Chrome benchmarks under v0.2.6+ to refresh that section.

## Runtime Performance — Real Browser (headless Chrome, medians in ms)

All four frameworks measured in headless Chrome via Puppeteer. Each framework's
production build is served locally, state manipulation via exposed `__bench` API,
timing with `performance.now()` + forced layout (`offsetHeight`). Lower is better.

| Operation | scrml | React 19 | Svelte 5 | Vue 3 | Best |
|---|---|---|---|---|---|
| create-1000 | 19.8 | **19.2** | 27.2 | 24.6 | React |
| replace-1000 | 20.9 | **20.0** | 28.6 | 24.8 | React |
| partial-update | **0.4** | 3.3 | 2.9 | 9.2 | **scrml** |
| delete-every-10th | **1.5** | 3.0 | 2.1 | 6.4 | **scrml** |
| clear-all | 2.4 | 2.7 | **2.2** | 2.5 | Svelte |
| select-row | **0.0** | 0.3 | 0.0 | 0.1 | **scrml** |
| swap-rows | **1.3** | 17.0 | 2.2 | 5.8 | **scrml** |
| remove-row | **1.2** | 2.8 | 2.2 | 6.6 | **scrml** |
| create-10000 | 209.5 | **181.9** | 534.9 | 244.0 | React |
| append-1000 | **19.3** | 21.1 | 35.2 | 29.7 | **scrml** |

**scrml wins: 6/10** — partial-update, delete-every-10th, select-row, swap-rows, remove-row, append-1000
**React wins: 3/10** — create-1000, replace-1000, create-10000
**Svelte wins: 1/10** — clear-all
**Vue wins: 0/10**

### Key findings

- scrml dominates fine-grained updates — partial-update is 8.3x faster than React, swap-rows is 13x faster
- React narrowly wins bulk creation (3% faster on create-1000) — VDOM batching helps for large inserts
- Svelte is surprisingly slow in real Chrome — `tick()` async flush adds overhead to bulk operations
- Vue's `nextTick()` batching adds significant latency to every operation
- scrml's LIS reconciler makes swap-rows 13x faster than React's VDOM diffing
- scrml wins append-1000 — the only framework faster than React at bulk operations

### happy-dom vs real Chrome

The happy-dom results (below) differ significantly from real Chrome. Key differences:
- Svelte/Vue appeared faster in happy-dom because their async rendering wasn't being flushed
- happy-dom's `cloneNode(true)` and `innerHTML` are slower than `createElement` (opposite of real browsers)
- Chrome is 1.2-2x faster than happy-dom at DOM creation

## Runtime Performance — happy-dom (medians in ms, lower is better)

Regenerated 2026-05-12 against HEAD (post v0.2.6+ Wave 2 / Approach A spec anchor).
Bun 1.3.13, happy-dom. 3 warmup + 10 measured iterations per benchmark; medians shown.
These numbers are less reliable than the Chrome results above (the prior Chrome run is
v0.2.4-era and should be re-run under v0.2.6+ to refresh).

| Operation | scrml | React 19 | Svelte 5 | Vue 3 | scrml vs React | scrml vs Svelte | scrml vs Vue |
|---|---:|---:|---:|---:|---:|---:|---:|
| initial-render | 5.03 | **1.09** | 0.96 | **0.96** | 0.2x | 0.2x | 0.2x |
| create-1000 | 67.6 | 87.5 | **38.4** | 70.7 | 1.3x | 0.6x | 1.0x |
| replace-1000 | **48.5** | 70.8 | 55.5 | 65.7 | 1.5x | 1.1x | 1.4x |
| partial-update | **4.08** | 37.7 | 19.4 | 4.16 | 9.2x | 4.8x | 1.0x |
| delete-every-10th | **4.66** | 28.6 | 17.1 | 5.06 | 6.1x | 3.7x | 1.1x |
| clear-all | 8.90 | **6.94** | 7.33 | 7.24 | 0.8x | 0.8x | 0.8x |
| select-row | **0.023** | 5.50 | 0.054 | 0.027 | 237x | 2.3x | 1.2x |
| swap-rows | 4.39 | 40.1 | 19.3 | **2.81** | 9.1x | 4.4x | 0.6x |
| remove-row | 6.78 | 28.2 | 15.1 | **3.30** | 4.2x | 2.2x | 0.5x |
| create-10000 | 432 | 668 | **256** | 403 | 1.5x | 0.6x | 0.9x |
| append-1000 | 54.1 | 90.8 | **41.0** | 50.4 | 1.7x | 0.8x | 0.9x |

**Across-the-board: scrml beats React in 9/11; Svelte in 6/11; Vue in 5/11 (happy-dom; v0.2.6+ HEAD).**

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

## Bundle Size (gzipped)

| Framework | JS (gzip) | CSS (gzip) | Total (gzip) | Raw JS | Dependencies | node_modules |
|---|---|---|---|---|---|---|
| **scrml** | **14.8 KB** | 1.1 KB | **15.9 KB** | 60 KB | **0** | **0 bytes** |
| Svelte 5 | 15.9 KB | 1.1 KB | 17.0 KB | 41 KB | 33 | 29 MB |
| Vue 3 | 26.8 KB | 1.1 KB | 27.9 KB | 67 KB | 22 | 38 MB |
| React 19 | 62.1 KB | 1.1 KB | 63.2 KB | 198 KB | 38 | 46 MB |

scrml is the smallest gzipped JS (1.1x smaller than Svelte, 1.8x smaller than Vue, 4.2x smaller than React).

## Build Performance — TodoMVC (10 runs, median)

| Framework | Build Tool | Build Time | vs scrml |
|---|---|---|---|
| **scrml** | Built-in compiler | **43.7 ms** | — |
| Svelte 5 | Vite 6.4 | 345 ms | 7.9x slower |
| Vue 3 | Vite 6.4 | 379 ms | 8.7x slower |
| React 19 | Vite 6.4 | 506 ms | 11.6x slower |

## Build Performance — Full-Stack Comparison (contact form app)

Identical app (form with validation, data display, filtering, styling).
scrml vs the typical React production stack.

| Stack | Build Time | JS (gzip) | CSS (gzip) | Dependencies |
|---|---|---|---|---|
| **scrml** | **26 ms** | **14.5 KB** | 0.9 KB | **0** |
| React + TS + Tailwind + Zod | 102 ms | 75.8 KB | 3.2 KB | ~100+ |

scrml is **3.9x faster** to build and produces **5.2x smaller JS output** with **zero dependencies**.

The React stack requires TypeScript (type checking), Vite (bundling), Tailwind (CSS utility compilation),
and Zod (runtime validation). scrml handles types, styling, and validation as built-in language features.

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
- scrml compiled with `bun compiler/src/index.js`
- Browser benchmarks: Puppeteer + headless Chrome, 5 warmup + 10 iterations, median reported
- happy-dom benchmarks: Bun runtime, 3 warmup + 10 iterations, median reported
- Build times: 10 consecutive runs, median reported
- Gzip sizes measured with `gzip -c | wc -c`
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
