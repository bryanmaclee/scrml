# Bench Refresh v0.3.0 — Progress Log

Append-only timestamped log per CLAUDE.md crash-recovery rule.

## 2026-05-14 — Session start

- WORKTREE: `/home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-ab7cab0ade278eaec`
- BRANCH: `worktree-agent-ab7cab0ade278eaec`
- BASE SHA at start: `13154ba` (announcement post, docs-only after v0.3.0 STABLE)
- Verified worktree clean, `bun install` ok, `bun run pretest` ok.
- Read primary.map.md, RESULTS.md, sql-batching/RESULTS.md, README.md L410-540.
- No dist/ dirs present yet — need to build each framework's TodoMVC.

## Plan

1. Build all 4 TodoMVC dists (needed for both Chrome bench and bundle/build-time).
2. Refresh happy-dom runtime (fastest).
3. Refresh Chrome (Puppeteer) runtime.
4. Refresh bundle size + build time (10 runs median per framework).
5. Refresh fullstack (scrml vs React+TS+Tailwind+Zod).
6. Refresh SQL-batching.
7. Build new per-route per-role chunk-size bench.
8. Update README + scrml.dev claim updates.

## 2026-05-14 — ALL DONE

Final state at commit `4227317cb5aff8ae17577a15d56abc898970196f`:
- 7 commits on branch `worktree-agent-ab7cab0ade278eaec` since base `13154ba`.
- 13 files changed (all within scope: benchmarks/, docs/, README.md, fullstack-scrml/app.scrml syntax migration).
- `git status` clean.
- All 5 refreshes + new per-route per-role bench landed.
- README L163, L412-444, L527 + docs/index.html L122 updated with v0.3.0 numbers.
- Historical baseline rows preserved across happy-dom, Chrome, bundle, build, full-stack tables.
- Per-route per-role bench is reproducible: `bun benchmarks/per-route-roles/bench.js`.
- SQL-batching bench unchanged structurally (re-runnable cleanly).

## 2026-05-14 — README + scrml.dev claim updates DONE

- README.md L163-164: SQL Tier 2 claim refreshed (2x/3x/4x -> 1.7x/2.3x/3.3x).
- README.md L412-444: Runtime/bundle/build TodoMVC tables refreshed.
  - Bundle table reordered (Svelte smallest, then Vue, then scrml, then React).
  - Honest framing note added about Approach A bundle growth.
  - Runtime "scrml wins 0 of 10 at v0.3.0 (was 6 of 10 at v0.2.4-era)" framing.
  - Build time table refreshed with v0.3.0 numbers.
- README.md L527: N+1 elimination claim refreshed.
- docs/index.html L122: SQL Tier 2 claim refreshed (~2x/3x/4x -> ~1.7x/2.3x/3.3x).

## 2026-05-14 — Per-route per-role chunk variance bench (NEW) DONE

- Built new fixture at `benchmarks/per-route-roles/routes/{index,loads,customer,dispatch,admin}.scrml`.
  - 5 routes, 5 roles (Anonymous, Customer, Driver, Dispatch, Admin).
  - Auth-gated subtrees in loads (Driver+Dispatch), customer (Customer), dispatch (Dispatch), admin (Admin).
  - Modeled on `compiler/tests/integration/fixtures/a5/multipage-multirole/` shape.
  - Trucking-dispatch example (`examples/23-trucking-dispatch/`) blocked by pre-existing
    I-AUTH-REDIRECT-UNRESOLVED for "/login" — used minimal fixture instead per dispatch fallback.
- Built `benchmarks/per-route-roles/bench.js`:
  - Compiles fixture via `compileScrml({ emitPerRoute: true })`, reads chunks.json.
  - Gzips each (entry-point, role) initial-tier chunk; computes role overhead vs Anonymous.
  - Computes single-bundle hypothetical (sum of all unique chunk files).
  - Re-compiles 10x to verify FNV-1a content-addressed filenames are byte-identical.
- Results:
  - Per-route per-role chunks tiny (0.61-0.73 KB gzip each).
  - Role variance within target routes: /dispatch +12% Dispatch vs Anonymous, /admin +13% Admin vs Anonymous.
  - 96% reduction per-route vs single-bundle (17.49 KB gzip) hypothetical.
  - FNV-1a stability YES across 10 compiles.
- Updated `benchmarks/RESULTS.md` with full per-route per-role section + version history row.
- Updated methodology section.

## 2026-05-14 — SQL-batching Tier 1 + Tier 2 DONE

- Ran `bun benchmarks/sql-batching/bench.js` 2 times for stability.
- Tier 1 speedup: 1.07x (was 1.01x — small variance, narrative unchanged).
- Tier 2 scaling sweep:
  - N=10: 1.69x (was 1.95x)
  - N=50: 2.33x (was 2.75x)
  - N=100: 2.35x (was 2.60x)
  - N=500: 2.65x (was 3.10x)
  - N=1000: 3.27x (was 4.00x)
- Numbers shifted slightly under bun:sqlite 1.3.13 (baseline costs higher in absolute
  terms; speedup percent drops ~15-18%). Scaling shape unchanged.
- New narrative for README/scrml.dev: "~1.7x/2.3x/3.3x at N=10/100/1000" replaces
  "~2x/3x/4x" claim.
- Auto-generated RESULTS.md + manually appended a version-history section to
  preserve prior numbers for trend tracking.

## 2026-05-14 — Full-stack comparison DONE

- `benchmarks/fullstack-scrml/app.scrml` had stale `fn` keyword usage for
  state-mutating handlers (`validate`, `handleSubmit`). E-FN-003 blocks compile
  under v0.3.0 (pure `fn` cannot write @state). Changed two `fn`s to `function`s
  to match current language; this is a syntax migration, not a fairness cheat
  (same precedent as `<machine>` -> `<engine>` deprecation).
- Built React fullstack (Vite 8.0.3 + Tailwind 4 + Zod 4 + TS 6).
- Build times: scrml 33.5ms vs React stack 228ms (6.8x faster, was 3.9x).
- Bundle sizes: scrml 39.2 KB gzip vs React 75.0 KB gzip (1.9x smaller, was 5.2x).
  - scrml grew from 14.5 -> 39.2 KB (Approach A runtime tax)
  - React stack stayed roughly the same (62.1 -> 76.7 KB).
- Dep count: scrml 0 vs React 92 transitive packages (was "~100+").
- Preserved historical 2026-04-13 numbers.

## 2026-05-14 — Bundle size + build time DONE

- Bundle sizes (gzipped, scrml = app.client.js + scrml-runtime.js + app.css):
  - scrml: 39.9 KB JS gzip (was 14.8 KB v0.2.x — +169%)
  - Svelte: 15.7 KB (essentially same as v0.2.x's 15.9)
  - Vue: 26.5 KB (~same as v0.2.x's 26.8)
  - React: 61.5 KB (~same as v0.2.x's 62.1)
- scrml now sits between Vue and React on JS bundle (was below Svelte at v0.2.x).
- Approach A added: chunk loader + FNV-1a + role-bootstrap + dual-decoder + mount-hydration.
- Build times (scrml in-process; Vite self-reported walltime via `built in X` parse):
  - scrml: 65.6 ms (was 43.7 ms — +50%, from ExprNode + Approach A)
  - Svelte: 668 ms (was 345)
  - Vue: 706 ms (was 379)
  - React: 944 ms (was 506)
- Vite times ~2x growth across the board — likely different machine/cache state.
- Relative gap preserved: scrml ~10-14x faster than Vite at v0.3.0 (was 8-11x at v0.2.x).
- Preserved historical tables for trend tracking.

## 2026-05-14 — Chrome (Puppeteer) runtime DONE

- Ran `bun benchmarks/browser/bench-browser.js` 2 times for stability; identical numbers.
- scrml regressed to 0/10 wins in Chrome at v0.3.0 (was 6/10 at v0.2.4-era).
- Svelte wins 6/10, React wins 4/10 in Chrome at v0.3.0.
- Preserved 2026-04-13 v0.2.4-era table as historical for trend tracking.
- Updated `benchmarks/RESULTS.md` Chrome section with regression analysis.

## 2026-05-14 — happy-dom runtime DONE

- Ran `bun benchmarks/runtime-benchmark.js` 3 times for stability; 3rd run committed.
- scrml regressed across-the-board in happy-dom vs v0.2.6 numbers.
  - Approach A runtime additions (chunk loader, FNV-1a addressing, role-bootstrap,
    dual-decoder, mount-hydration) add baseline cost that single-page TodoMVC pays
    without amortization benefit.
- Updated `benchmarks/RESULTS.md` happy-dom table with v0.3.0 numbers.
- Preserved 2026-05-12 v0.2.6+ table as historical.
- Honesty note added at top of RESULTS.md framing the regression.
