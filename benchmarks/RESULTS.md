# TodoMVC Benchmark Results — 2026-09-05 currency refresh (HEAD `42162a38`)

> ## ⚑ 2026-09-05 CURRENCY REFRESH — READ THIS BEFORE ANY NUMBER BELOW
>
> **All four benchmark categories were re-measured on 2026-09-05 against HEAD `42162a38`**
> (`compiler/src` tree `f80a8fc3`, `compiler/runtime` tree `fea0ca81`, `stdlib` tree `f6108a72` —
> byte-identical at `origin/main` `aece349d` and at `3634fdae`, so the compile artifact is the same
> whichever of those the checkout sat on). Everything dated 2026-05-19 or earlier is preserved
> below, unchanged, as `### Historical:` subsections.
>
> **The headline finding is not a number. `benchmarks/todomvc/app.scrml` — this document's entire
> subject, and the program every table below measures — has been DEAD ON ARRIVAL since
> 2026-07-30.** It compiles at exit 0 with no error diagnostic, and then throws on first render in
> both happy-dom and real Chrome:
>
> ```
> TypeError: Cannot set properties of null (setting 'innerHTML')   // Chrome
>   at _scrml_lift_tgt_45.innerHTML = ""                           // app.client.js
> ```
>
> Zero `li.todo-item` render. Driving `_scrml_reactive_set("todos", …)` produces zero rows.
> **`partial-update` at HEAD is therefore UNMEASURABLE, not slow** — there is nothing to update.
> Bisected (12 steps, behavioural predicate) to first-bad `cdf4f4de` *(2026-07-30 09:53:39,
> "feat(codegen): `if=` Phase 2 — `if=` REMOVES from the DOM per §17.1, not display:none" #289)*;
> last-good `4e354e4d` *(2026-07-30 09:35:18)*. Mechanism: `if=` Phase 2 moved branch content into
> a mount `<template>`, and `document.querySelector('[data-scrml-logic="…"]')` does not descend into
> template content, so the module-top-level `const _scrml_lift_tgt_N = …` binds `null` and the
> first `_scrml_effect` throws. Same class as the known-gaps entry
> `g-call-expression-interpolation-in-if-chain-branch-renders-empty` (resolved S400-peter), whose
> `insideMountTemplate` fix covered the STATIC-DISPLAY binding sites but not the LIFT-TARGET site.
>
> **A second, independent breakage predates it.** `1c5c2aee` *(2026-07-25, chunk-namespacing BUG-6
> accessor rename)* namespaced every cell key to `"<token>$name"` and made the `_scrml_cs_*`
> accessors chunk-IIFE-local. `benchmarks/bench-scrml.js` and `benchmarks/browser/bench-browser-pw.js`
> still drive the bare global `_scrml_reactive_set("todos", …)`, which now writes a key nothing reads
> — **silently, with no error**. `compiler/tests/helpers/chunk-scope.js` exists precisely to fix this
> for the test tiers; `benchmarks/` was never updated. So even without the DOA, the shipped harnesses
> would have reported a fully-hollow run as a fast one.
>
> **Nothing caught either.** `compiler/tests/browser/browser-todomvc.test.js` (36 pass / 8 skip /
> 0 fail) and `todomvc-e2e.test.js` (10 pass / 0 fail) are both GREEN at HEAD against the DOA build:
> the harness swallows the client-init throw into an `initError` variable and no test asserts that a
> row ever renders. `scripts/corpus-compile-floor.ts` checks exit 0, which the DOA build satisfies.
> There is no perf gate in CI at all (gap `g-runtime-benchmarks-stale-and-no-perf-gate`).
>
> **What is measured below instead.** To answer the S87 audit's question in its own terms, three
> pinned scrml anchors were compiled from worktrees and measured back-to-back with the comparison
> frameworks in the same interleaved rounds on the same machine on 2026-09-05:
>
> | Anchor | Commit | Date | Why |
> |---|---|---|---|
> | `scrml@3609985` | `3609985` | 2026-05-19 | the exact code behind this document's prior tables |
> | `scrml@2d192b6f` | `2d192b6f` | 2026-07-24 | last commit the SHIPPED harness can drive |
> | `scrml@4e354e4d` | `4e354e4d` | 2026-07-30 | last commit at which the app renders at all |
> | `scrml@HEAD` | `42162a38` | 2026-09-05 | DOA — reported as such, never as a number |
>
> `scrml@3609985` is the control: it is the same source the 2026-05-19 rows were taken from, so the
> gap between its published number and its number today is environment, and the gap between it and
> the later anchors is code.
>
> **Harness deltas.** Comparison-framework harnesses (`todomvc-{react,svelte,vue,vanilla}/bench.js`)
> ran UNMODIFIED, and their `dist/` is the frozen 2026-05-19 build. The scrml side ran from a
> scratchpad copy of `bench-scrml.js` with five deltas, none of which touch the timing protocol:
> (1) `dist` from argv; (2) resolve the runtime the page's own `<script src>` names — the shipped
> `readdirSync().find()` picks an arbitrary stale content-hashed runtime out of an accumulating
> `dist/` (16 of them were present, and it picked a 6-week-old one); (3) chunk-namespace the cell key
> (a provable no-op on the two pre-`1c5c2aee` anchors, so those two columns are the shipped
> methodology exactly); (4) a hollow-run guard that aborts if a 10-row write renders zero rows;
> (5) a per-op filter, because the shipped single-process runner is OOM-killed on this machine
> (peak RSS > 2 GB — `loadApp()` re-evaluates the whole ~160 KB runtime+client on every `setup()`,
> ~140 times per full sweep). Each scrml op therefore runs in its own process. **Per-op protocol is
> unchanged: 3 warmup + 10 measured iterations, median.**
>
> **Repeats and noise.** happy-dom: 5 interleaved rounds. Chrome: 3 interleaved rounds. The tables
> report the median of the round medians, and a min–max range table follows each one so the noise is
> visible rather than asserted. This machine was running other agents' test suites throughout
> (1-minute load average between 1.6 and 14.4).


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

## Runtime Performance — Real Browser (headless Chrome via Playwright, medians in ms) — 2026-09-05 (HEAD `42162a38`)

**Harness:** `benchmarks/browser/bench-browser-pw.js` (scratchpad copy, deltas listed in the banner),
Playwright `1.60.0`, chromium revision `1223` = **Chrome 148.0.7778.96**, Bun 1.3.14.
5 warmup + 10 measured iterations per op (5 for `create-10000`), `performance.now()` + forced layout,
each app served from its own in-process HTTP server. **3 interleaved rounds**; cells are the median of
the three round medians. Lower is better.

**`scrml@HEAD` is absent from this table because it never rendered a row.** All three rounds logged
`[pageerror] Cannot set properties of null (setting 'innerHTML')` followed by
`HOLLOW: 0 rows after a 10-row write`. It is reported as DOA, not as a fast number.

| Operation | scrml@3609985 | scrml@2d192b6f | scrml@4e354e4d | React 19 | Svelte 5 | Vue 3 | Vanilla JS |
|---|---:|---:|---:|---:|---:|---:|---:|
| create-1000 | 27.3 | 39.4 | 67.8 | 26.7 | 47.3 | 35.4 | 23.3 |
| replace-1000 | 27.4 | 80.8 | 231.7 | 26.2 | 47.4 | 28.9 | 24.5 |
| partial-update | 0.80 | 60.9 | 260.7 | 5.50 | 4.70 | 11.9 | 2.55 |
| delete-every-10th | 2.50 | 79.8 | 318.0 | 4.70 | 3.75 | 8.75 | 1.60 |
| clear-all | 3.45 | 43.1 | 149.2 | 3.85 | 3.05 | 3.55 | 2.55 |
| select-row | 0.30 | 0.40 | 0.40 | 0.60 | 0.000 | 0.100 | 0.100 |
| swap-rows | 2.00 | 139.5 | 596.5 | 20.7 | 3.40 | 7.75 | 0.95 |
| remove-row | 2.00 | 202.6 | 703.0 | 4.45 | 3.25 | 8.10 | 0.90 |
| create-10000 | 274.5 | 720.5 | 1379.0 | 251.3 | 510.5 | 325.8 | 237.3 |
| append-1000 | 27.0 | 429.1 | 1140.8 | 27.1 | 46.0 | 34.9 | 21.3 |

**Ranges (min–max of the 3 round medians):**

| Operation | scrml@3609985 | scrml@2d192b6f | scrml@4e354e4d | React 19 | Svelte 5 | Vue 3 | Vanilla JS |
|---|---:|---:|---:|---:|---:|---:|---:|
| create-1000 | 24.1–31.4 | 36.2–51.3 | 55.4–110.7 | 22.8–33.7 | 34.2–66.4 | 27.0–41.1 | 20.6–28.8 |
| replace-1000 | 24.8–32.0 | 68.0–98.8 | 186.8–279.6 | 22.9–33.1 | 32.9–68.8 | 26.6–44.2 | 21.4–29.2 |
| partial-update | 0.80–0.90 | 56.9–69.5 | 210.6–272.6 | 4.90–6.30 | 4.30–4.95 | 10.7–13.9 | 2.40–2.70 |
| delete-every-10th | 2.40–2.65 | 72.8–91.2 | 265.0–369.7 | 4.65–5.00 | 3.60–4.15 | 7.75–9.65 | 1.55–1.75 |
| clear-all | 3.30–3.50 | 41.9–45.8 | 142.3–174.6 | 3.40–3.90 | 2.65–3.15 | 3.45–3.80 | 2.30–2.60 |
| select-row | 0.30–0.35 | 0.40–0.40 | 0.40–0.40 | 0.55–0.65 | 0.000–0.050 | 0.000–0.100 | 0.050–0.100 |
| swap-rows | 1.85–2.25 | 126.5–195.5 | 515.0–625.9 | 18.2–27.8 | 2.55–3.65 | 7.30–7.95 | 0.90–1.10 |
| remove-row | 2.00–2.05 | 162.6–414.2 | 592.6–853.7 | 4.00–4.60 | 2.15–3.30 | 7.70–8.90 | 0.85–1.00 |
| create-10000 | 254.1–345.4 | 702.5–1430.4 | 1170.3–1522.4 | 204.6–313.4 | 393.9–759.7 | 270.4–500.2 | 206.5–306.7 |
| append-1000 | 25.4–36.5 | 338.8–520.8 | 997.9–1216.8 | 23.5–40.0 | 38.9–73.6 | 31.3–88.7 | 19.7–25.7 |

**Reading it.** `scrml@3609985` reproduces this document's published 2026-05-19 Chrome row within
noise — published vs today: partial-update 1.00 / **0.80**, create-1000 25.95 / **27.3**,
replace-1000 26.35 / **27.4**, clear-all 3.65 / **3.45**, select-row 0.30 / **0.30**. The harness and
the machine are therefore sound, and the movement in the two later columns is code.

**Chrome `partial-update`: 0.80 ms → 60.9 ms → 260.7 ms — a 326× regression** between 2026-05-19 and
2026-07-30, on top of which the app then stopped running entirely. `swap-rows` 2.00 → 596.5 (298×),
`remove-row` 2.00 → 703.0 (352×), `append-1000` 27.0 → 1140.8 (42×), `replace-1000` 27.4 → 231.7 (8.5×).
`select-row` alone is flat (0.30 → 0.40), which is consistent with the S103 value-indexed subscriber
dispatch being on a different path from list reconciliation. The per-round ranges are disjoint between
adjacent anchors on every op **except `create-10000`**, where `scrml@2d192b6f` (702.5–1430.4) overlaps
`scrml@4e354e4d` (1170.3–1522.4) — that one step is inside the noise and should not be read as resolved.
Everything else here is.

### Historical: Real Browser (2026-05-19, v0.3.3 HEAD `3609985`, Playwright; preserved for trend tracking)

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

## Runtime Performance — happy-dom (medians in ms, lower is better) — 2026-09-05 (HEAD `42162a38`)

**This is the harness the S87 audit's 5.83× was measured on**, so it is the one that answers the
audit in its own units. happy-dom `20.8.9` (identical to the 2026-05-19 lockfile resolution), Bun
`1.3.14` (2026-05-19 ran `1.3.13` — the only declared-dependency difference in the whole window).
3 warmup + 10 measured iterations per op, median. **5 interleaved rounds**; cells are the median of
the five round medians.

**`scrml@HEAD` is absent because it throws at load in all five rounds** — see the banner.

| Operation | scrml@3609985 | scrml@2d192b6f | scrml@4e354e4d | React 19 | Svelte 5 | Vue 3 | Vanilla JS |
|---|---:|---:|---:|---:|---:|---:|---:|
| initial-render | 3.67 | 4.18 | 3.58 | 0.92 | 0.91 | 0.66 | 0.45 |
| create-1000 | 69.3 | 87.7 | 94.4 | 72.6 | 32.8 | 55.4 | 35.7 |
| replace-1000 | 72.2 | 94.6 | 129.5 | 65.8 | 35.7 | 50.6 | 39.5 |
| partial-update | 1.04 | 4.79 | 17.9 | 29.1 | 13.5 | 3.96 | 0.83 |
| delete-every-10th | 2.83 | 7.02 | 17.4 | 34.8 | 11.9 | 3.97 | 1.12 |
| clear-all | 10.0 | 13.4 | 15.4 | 5.19 | 7.20 | 5.74 | 6.72 |
| select-row | 0.11 | 0.12 | 0.12 | 3.99 | 0.041 | 0.024 | 0.012 |
| swap-rows | 1.88 | 5.89 | 16.5 | 35.2 | 20.0 | 3.18 | 0.066 |
| remove-row | 1.64 | 5.93 | 15.8 | 23.3 | 12.5 | 3.02 | 0.041 |
| create-10000 | 749.2 | 767.6 | 735.7 | 625.3 | 288.6 | 480.3 | 308.8 |
| append-1000 | 73.8 | 77.6 | 104.5 | 77.0 | 40.4 | 45.2 | 31.2 |

**Ranges (min–max of the 5 round medians):**

| Operation | scrml@3609985 | scrml@2d192b6f | scrml@4e354e4d | React 19 | Svelte 5 | Vue 3 | Vanilla JS |
|---|---:|---:|---:|---:|---:|---:|---:|
| initial-render | 3.18–3.95 | 2.95–8.26 | 3.36–8.40 | 0.80–2.13 | 0.70–1.07 | 0.58–0.86 | 0.39–0.88 |
| create-1000 | 56.2–71.2 | 61.8–138.3 | 74.1–153.4 | 61.6–152.3 | 31.1–35.0 | 50.2–69.1 | 28.9–56.7 |
| replace-1000 | 63.3–116.3 | 66.9–167.7 | 83.7–193.4 | 51.9–130.9 | 29.0–38.3 | 45.8–62.4 | 26.4–68.2 |
| partial-update | 0.85–1.80 | 4.26–9.70 | 14.5–31.4 | 27.8–53.9 | 12.7–14.3 | 3.41–6.05 | 0.58–1.60 |
| delete-every-10th | 2.36–5.24 | 6.05–13.4 | 15.9–32.4 | 22.2–44.0 | 11.0–14.5 | 3.49–4.83 | 0.82–1.95 |
| clear-all | 7.72–18.3 | 11.1–19.5 | 13.0–31.5 | 4.22–8.96 | 5.67–8.05 | 5.23–7.70 | 5.14–14.3 |
| select-row | 0.10–0.17 | 0.10–0.15 | 0.092–0.16 | 3.57–8.30 | 0.034–0.042 | 0.021–0.029 | 0.011–0.018 |
| swap-rows | 1.51–3.63 | 4.89–10.8 | 14.2–24.1 | 31.7–83.0 | 18.6–29.9 | 2.59–6.87 | 0.061–0.11 |
| remove-row | 1.47–3.77 | 4.61–11.2 | 14.0–34.8 | 21.4–56.8 | 11.4–14.2 | 2.19–4.49 | 0.033–0.12 |
| create-10000 | 504.9–1334.5 | 600.3–1378.1 | 645.8–1338.1 | 559.4–635.4 | 252.8–344.9 | 391.8–684.8 | 237.7–441.1 |
| append-1000 | 57.0–123.3 | 70.0–161.0 | 88.7–168.1 | 68.2–85.3 | 32.4–54.2 | 34.0–71.7 | 21.7–50.2 |

### The S87 question, answered in its own units

`docs/audits/happy-dom-perf-regression-s87-2026-05-12.md` asked whether the 0.7 ms → 4.08 ms (5.83×)
partial-update regression had been closed. Series, happy-dom, `partial-update`:

| Source | scrml | React | Ratio (React ÷ scrml) |
|---|---:|---:|---:|
| 2026-04-05 published (v0.1.x) | 0.7 | 20.1 | **28.7×** |
| 2026-05-12 published (v0.2.6+) — the audit's "bad" row | 4.08 | 37.7 | **9.2×** |
| 2026-05-19 published (v0.3.3, post S102–S106) | 2.28 | 23.2 | 10.1× |
| **2026-05-19 CODE, re-measured 2026-09-05** | **1.04** | 29.1 | **27.8×** |
| **2026-07-24 CODE, measured 2026-09-05** | **4.79** | 29.1 | **6.1×** |
| **2026-07-30 CODE, measured 2026-09-05** | **17.9** | 29.1 | **1.6×** |
| **HEAD `42162a38`** | **unmeasurable — app is DOA** | 29.1 | — |

**Verdict: the 5.83× was closed, and then overtaken by a much larger one.** The 2026-05-19 code, put
on today's machine alongside today's React, measures **27.8× faster than React** — statistically the
same competitive position as the 28.7× of the 2026-04-05 baseline the audit treated as the good state.
The S102–S106 runtime-perf arc did what it set out to do.

What the arc could not know is that **a second regression landed after it**: 1.04 → 17.9 ms in
happy-dom (**17.2×**, against the audit's 5.83×) and 0.80 → 260.7 ms in Chrome (**326×**), taking the
React advantage from 27.8× to 1.6× in happy-dom and from 6.9× to 0.02× (i.e. 47× *slower* than React)
in Chrome. It is not confined to `partial-update`: happy-dom `swap-rows` 1.88 → 16.5 (8.8×),
`remove-row` 1.64 → 15.8 (9.6×), `delete-every-10th` 2.83 → 17.4 (6.1×). `select-row` is untouched
(0.11 → 0.12), and bulk create is nearly untouched (`create-10000` 749 → 736), which localises the
cost to the per-item reconciliation path rather than to node creation.

**Noise.** Relative spread across rounds is 67–123% on this machine, which is high. It does not
threaten the finding: the per-round ranges of the three anchors are **disjoint** — 0.85–1.80 vs
4.26–9.70 vs 14.5–31.4. Both steps are resolved well above the noise floor.

### Confounds — what moved that is not scrml

The S87 audit flagged that its own 5.83× sat on an older Bun *and* an older happy-dom with 1,402
commits in between, and that React/Vue/Svelte regressed 1.7–2.1× on the same environment change — so
roughly 2× of the 5.83× was plausibly environmental. The same discipline, applied here:

**What did NOT move.**
- **happy-dom is byte-identical.** `20.8.9` both at `3609985` (`git show 3609985:bun.lock`) and today.
- **Playwright is byte-identical.** `@playwright/test 1.60.0` in the lockfile at `3609985` and today.
- **`benchmarks/todomvc/app.scrml` is byte-identical** across `3609985`, `4e354e4d` and HEAD
  (tree `80f400dd`). All three anchors compile the same source; only the compiler differs.
- **The comparison frameworks are frozen.** `todomvc-{react,svelte,vue}/dist` are the 2026-05-19
  production builds and their `node_modules` is unchanged, so React/Svelte/Vue are a fixed ruler
  rather than a second moving part. Their bundle rows reproduce their published values *exactly*,
  which is the strongest single check that the measurement method is faithful.

**What DID move.**
- **Bun `1.3.13` → `1.3.14`.** The only declared-dependency change in the window. Affects all
  columns equally within a round, so it cannot manufacture a scrml-vs-scrml delta.
- **The machine.** 22 cores / 15.4 GB, running other agents' test suites throughout; 1-minute load
  average ranged 1.6–14.4 and swap was near-full at times. This is why every table is a median of
  interleaved rounds with an explicit min–max range beside it.
- **Chromium build.** Today's runs used chromium rev `1223` (Chrome 148). Which chromium was
  installed on 2026-05-19 cannot now be recovered. This is a real confound for
  *published-2026-05-19 vs today*; it is **not** a confound for the three-anchor comparison, which
  ran on one browser in one session.
- **happy-dom got slower today for the comparison frameworks**, in the direction the audit warned
  about: React `partial-update` 23.2 → 29.1, Vue 3.31 → 3.96, Vanilla 0.63 → 0.83, Svelte 13.8 → 13.5
  (flat). So the environment is *not* uniformly faster — which makes scrml's own movement harder to
  explain away, not easier.

**The one place my numbers are NOT comparable to the published ones — stated plainly.**
`scrml@3609985` measures **1.04 ms** on happy-dom `partial-update` today against **2.28 ms**
published on 2026-05-19, for the *same source*. Every other framework in the same table moved the
other way. The most likely cause is my own methodology deviation: the shipped `bench-scrml.js` runs
all eleven ops in one process (and is OOM-killed on this machine at HEAD-era code sizes, peak RSS
> 2 GB), whereas I ran **one process per op**, so each op gets a cold heap instead of inheriting
~140 accumulated `loadApp()` re-evaluations. That systematically flatters the scrml column.
Two things follow, and both matter:
1. **scrml-anchor-to-scrml-anchor comparisons remain valid** — all three anchors got the identical
   treatment, so the 1.04 → 4.79 → 17.9 series is apples-to-apples.
2. **scrml-today-to-scrml-published comparisons are not** — do not read "1.04 vs 2.28" as a
   2.2× improvement. It is a harness difference.
The Chrome table has no such split (all ops run in one page, exactly as shipped), and there
`scrml@3609985` reproduces the published row within noise (0.80 vs 1.00), which is consistent with
this explanation rather than with a real change in the 2026-05-19 code.

**Also not scrml.** The compiled `dist` for each anchor sits at a different absolute path, so each
gets a different chunk-namespace token. The token is a path hash of fixed width — size-neutral and
behaviour-neutral — but it is the reason the harness must read the token rather than assume one.

### Historical: happy-dom (2026-05-19, v0.3.3 + Phase 3 Candidate A + `!=` follow-on; preserved for trend tracking)

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

## Bundle Size (gzipped) — 2026-09-05 (HEAD `42162a38`)

**Method:** `measureDist()` from `scripts/bundle-size-benchmark.js` re-used verbatim (`Bun.gzipSync`,
same per-extension accounting). scrml compiled fresh through the same `compileScrml()` API the
script's `buildScrml()` uses. The Vite apps were deliberately **not** rebuilt — their `dist/` is the
frozen 2026-05-19 production build, which is what makes them a control, and the Chrome harness was
serving it. Their rows below are therefore the 2026-05-19 artifacts re-measured today.

| Framework | JS (gzip) | CSS (gzip) | Total (gzip) | Raw JS | Dependencies | node_modules |
|---|---:|---:|---:|---:|---:|---:|
| **scrml** (HEAD `42162a38`) | **47.0 KB** | 1.2 KB | **48.8 KB** | 158.2 KB | **0** | **0 bytes** |
| Svelte 5 (frozen 2026-05-19 dist) | 15.7 KB | 1.1 KB | 17.1 KB | 40.2 KB | 3 | ~30 MB |
| Vue 3 (frozen 2026-05-19 dist) | 26.5 KB | 1.1 KB | 27.8 KB | 65.6 KB | 3 | ~25 MB |
| React 19 (frozen 2026-05-19 dist) | 61.5 KB | 1.1 KB | 62.8 KB | 193.6 KB | 4 | ~46 MB |

**Control: all three framework rows reproduce their published 2026-05-19 values exactly**
(15.7 / 26.5 / 61.5 KB JS gzip). The measurement method is faithful, so the scrml delta is entirely code.

**scrml JS gzip 19.7 KB → 47.0 KB = +138% (2.4×) in 3.5 months**; raw JS 73 KB → 158.2 KB (2.2×).
scrml has gone from *below* Vue 3 on the JS-only axis (19.7 vs 26.5) to 1.8× *above* it, and from
3.1× smaller than React 19 to 1.3× smaller. The zero-dependency / zero-`node_modules` claim is
unaffected and still holds.

### Historical: Bundle Size (2026-05-19, v0.3.3 HEAD `3609985`; preserved for trend tracking)

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

## Build Performance — TodoMVC — 2026-09-05 (HEAD `42162a38`)

**Method:** this document's own documented scrml build methodology — in-process via the
`compileScrml()` API, 3 warmup + 10 measured, median — run as **3 interleaved rounds** against three
pinned compilers taken from worktrees, so the comparison is same-machine and same-day. The Vite
frameworks were **not** re-measured: rebuilding them would have destroyed the frozen 2026-05-19 dist
that the bundle-size and Chrome tables use as their control. Their rows carry forward and are
labelled as such.

| Compiler | Round medians (ms) | Median (ms) | vs 2026-05-19 code |
|---|---|---:|---:|
| scrml @ `3609985` (2026-05-19 code) | 23.90 / 26.34 / 30.08 | **26.3** | — |
| scrml @ `4e354e4d` (2026-07-30 code) | 58.05 / 64.25 / 63.22 | **63.2** | 2.40× slower |
| scrml @ `42162a38` (HEAD, 2026-09-05) | 47.61 / 54.13 / 57.06 | **54.1** | **2.06× slower** |
| Svelte 5 / Vue 3 / React 19 (Vite 6.4) | *not re-measured* | 681 / 697 / 963 | carried from 2026-05-19 |

A separate 5-round HEAD-only run agrees: 56.51 / 49.63 / 49.19 / 48.74 / 51.65 → 49.6 ms.

**scrml compile time roughly doubled: 26.3 → 54.1 ms.** Note that the published 2026-05-19 figure was
36.7 ms while the *same code* measures 26.3 ms today — today's machine compiles ~1.4× faster — so the
naive published-to-published comparison (36.7 → 54.1, +47%) *understates* the code regression. Against
the carried-forward Vite times scrml is still 12.6–17.8× faster, down from 18.6–26.2×.

### Historical: Build Performance (2026-05-19, v0.3.3 HEAD `3609985`; preserved for trend tracking)

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
| **2026-09-05 (currency refresh, HEAD `42162a38`)** | **54.1 ms** | **47.0 KB JS / 48.8 KB total** | **First re-measurement since 2026-05-19 (3.5 months, 2,469 commits).** ⚑ **`benchmarks/todomvc/app.scrml` is DEAD ON ARRIVAL at HEAD** — compiles at exit 0, throws `Cannot set properties of null (setting 'innerHTML')` on first render in BOTH happy-dom and real Chrome, renders zero rows; `partial-update` at HEAD is unmeasurable, not slow. Bisected to `cdf4f4de` (2026-07-30, `if=` Phase 2 mount-`<template>`); last-good `4e354e4d`. A second, independent breakage predates it: `1c5c2aee` (2026-07-25, chunk-namespacing accessor rename) made the shipped benchmark harnesses drive a bare cell key nothing reads — silently. Both browser TodoMVC test files are GREEN against the DOA build (they swallow the init throw and never assert a rendered row). **The S87 5.83× WAS closed**: the 2026-05-19 code re-measured today is 27.8× faster than React on happy-dom `partial-update`, back at the 28.7× of the 2026-04-05 baseline. **A larger regression then landed on top of it**: happy-dom `partial-update` 1.04 → 17.9 ms (17.2×) and Chrome 0.80 → 260.7 ms (326×) between 2026-05-19 and 2026-07-30 code, with `swap-rows` / `remove-row` / `delete-every-10th` moving together and `select-row` / bulk-create untouched. Bundle 19.7 → 47.0 KB JS gzip (+138%); build 26.3 → 54.1 ms same-day (2.06×). Three framework bundle rows reproduce their 2026-05-19 values exactly, and `scrml@3609985` reproduces the 2026-05-19 Chrome row within noise, which is what licenses attributing the rest to code. |
| 2026-04-05 | 30.9 ms | 13.4 KB | Initial benchmarks |
| 2026-04-13 | 43.7 ms | 14.8 KB | Post ExprNode migration (Phase 4d), E-SCOPE-001 fix, enum pipe-syntax. Build +41% from ExprNode parsing overhead; bundle +1.4 KB from runtime additions. Runtime perf unchanged. |
| 2026-05-12 (v0.2.6+ HEAD) | not re-measured | not re-measured | Runtime happy-dom regenerated for HEAD `149c979` (S86 wrap + Wave 2 + Approach A spec anchor); Chrome row carried forward from 2026-04-13 (rerun pending separate dispatch). `bench-scrml.js` switched from IIFE-with-explicit-window-export to indirect-eval `(0, eval)(combinedScript)` after the prior eval pattern broke against v0.2.6+ codegen (D3a finding, D3b fix). TodoMVC `activeCount`/`completedCount` source split into two-statement form to dodge a `.filter(cb).<member>` compiler bug (out-of-scope; separate dispatch pending). Build-time and bundle-size rows not re-measured this pass — they'd need a separate timer-instrumented build script run. happy-dom runtime numbers: scrml beats React in 9/11, Svelte in 6/11, Vue in 5/11. |
| 2026-05-14 (v0.3.0 STABLE, HEAD `13154ba`) | 65.6 ms | 39.9 KB | Full bench refresh against v0.3.0 STABLE — Chrome runtime, happy-dom runtime, bundle size, build time, full-stack, SQL-batching ALL re-measured. NEW per-route per-role chunk variance bench added (`benchmarks/per-route-roles/`). scrml bundle grew 2.7x (14.8→39.9 KB gzip) from Approach A runtime additions; build time grew 1.5x (43.7→65.6 ms) from ExprNode parser. TodoMVC runtime regressed (Chrome: 0/10 wins at v0.3.0 vs 6/10 at v0.2.4-era). The v0.3 win is per-route per-role chunking — anonymous visitors get strictly-smaller initial bundles than admins (96% reduction vs single-bundle hypothetical). FNV-1a content addressing byte-deterministic across 10 compiles. Honesty note added to RESULTS.md top framing the regression. (Note: the "14.8 → 39.9 KB" framing here compresses two separate changes — see 2026-05-15 row.) |
| 2026-05-15 (v0.3.x Phase B, HEAD `1f73732`) | not re-measured | **13.9 KB JS / 15.8 KB total** | Bundle re-measure only; runtime + build + full-stack queued. Phase B landed three integrated fixes (shared-runtime union assembly + new `wire` chunk gating `_scrml_wire_decode` + FNV-1a content-hashed runtime filename). Bundle 40.8 → 15.8 KB total gzip (-61.4%). The recovery exceeds the +4.3 KB v0.3.0 Approach-A delta because Phase B closes a pre-existing shared-runtime tree-shake gap — the legacy `!embedRuntime` path shipped the full `SCRML_RUNTIME` regardless of `usedRuntimeChunks`. Same-source TodoMVC at every v0.2.x release tag (v0.2.0 — v0.2.6) measures 36.5 KB total gzip; HEAD beats every prior release. **The "14.8 KB v0.2.x" baseline cited in earlier framings is a 2026-04-13 pre-v0.2.0 measurement, not reproducible against any v0.2.x release tag.** Runtime + build + full-stack re-measurement queued. |
| 2026-05-19 (v0.3.3 + P1.C, HEAD `6bc5128`) | not re-measured | not re-measured | **Runtime happy-dom re-measure with NEW Vanilla JS 5th baseline + per-op scrml-runtime instrumentation** (P1.A vanilla baseline landed at `efe7d42`; P1.B instrumentation + derived-chunk-gate widening landed at `6bc5128`). Major narrative shift: v0.3.3 wins 6/11 vs React (3.1x avg), 4/11 vs Svelte (1.8x), 2/11 vs Vue (0.7x), 0/11 vs Vanilla (expected — vanilla is the floor). Several v0.3.0-STABLE happy-dom regressions are an order of magnitude smaller now (partial-update 57.4→2.4ms; swap-rows 77.3→3.4ms; select-row 57.6→5.0ms; remove-row 57.3→4.4ms). Probable cause: derived-chunk-gate widening (V5-strict `const <x>` decls no longer throw `_scrml_derived_declare is not defined` at runtime → harness no longer recovers in degraded state). Per-op P1.B instrumentation identified the top-3 Phase 2 attribution targets: select-row 90% in LEGACY `_scrml_subscribers` O(n) walk; partial-update 54% in reconcile_list LIS over 1000 nodes for 100 changes; swap-rows 62% in effect_scheduling fan-out. Chrome + build-time + full-stack rows NOT re-measured this pass — happy-dom only per P1.C scope. Build-time and bundle rows are still v0.3.x Phase B baselines (no v0.3.3 substantive runtime-template growth). |
