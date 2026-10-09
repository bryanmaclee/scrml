# progress — s461-runtime-tree-shake

- 2026-10-09T19:30:18Z WIP(s461-runtime-tree-shake): start at /home/user/scrml/.claude/worktrees/agent-a26ed6b74654a6895 (base origin/main d99dad0)

## Phase 1 — MEASURE (base = origin/main d99dad0, before any code change)

Ruler: the ratchet's own — `stripShippedJs` (SPEC §47.9.9) runtime, in-memory `gzipSync(level 9)`.
Tools (scratch, not committed): `measure.mjs` (compile + recover chunk set + per-chunk delta),
`targets.mjs` (per-target delta), `floor.mjs` (whole-statement reachability floor from the client's refs),
`chunk-audit.mjs` (acorn cross-chunk reference audit).

- Shell (`<program><h1/><outlet/></program>`): **7,442 B gzip / 28,842 B raw** stripped — the S459 carried figure is CONFIRMED.
  Chunks shipped: core, scope, timers, animation, utilities, mount, errors.
  Its client JS calls exactly ONE runtime helper: `_scrml_link_ensure_click()`.
  Reachability floor (every top-level runtime statement reachable from that call + every non-declaration
  statement): **3,510 B** — the S459 "~3,400 B" estimate is CONFIRMED to within 110 B.
- Counter: 5,101 B gzip (core, scope, timers, animation, deep_reactive, errors).

Per-chunk delta on the shell (remove one chunk, re-strip, re-gzip):
core 2,132 · utilities 3,767 · errors 469 · timers 373 · scope 161 · animation 117 · mount 43.

### Per-target (hypothesis → measured)
| target | hypothesis | measured on shell | counter |
|---|---|---|---|
| (a) | errors chunk always shipped, dead unless used | CONFIRMED: seeded unconditionally (context.ts, index.ts per-file seed + shared-runtime union); shell client references none of its 11 names. **469 B** | 481 B |
| (b) | scope → {timers, animation} edge pulls both into every app | CONFIRMED: `CHUNK_DEPENDENCIES.scope` and scope is always seeded, so timers+animation ship on every page. The only callers are `_scrml_destroy_scope` (stop/cancel for a scope) — a registry only those chunks can populate. **494 B** | 469 B |
| (c) | engine helpers sit in core | CONFIRMED: `_scrml_machine_timers` / `_scrml_machine_clear_timer` / `_scrml_machine_arm_timer` / `_scrml_machine_arm_initial` / `_scrml_replay` (§51.12 / §51.14) live in core; no core function calls them. **547 B** | 546 B |
| (d) | mount chunk false trigger | CONFIRMED: activated from the reachability record whenever a page admits a markup node, but `_scrml_chunk_mount(` is emitted ONLY by the per-route splitter (`--emit-per-route`), which is off by default. Same false trigger on `vendor-ref` (`_scrml_vendor_require(`) and `prefetch` (`_scrml_prefetch_tier1/2(` — route-splitter only). Base corpus: 244 runtimes ship `_scrml_chunk_mount`, 12 ship `_scrml_prefetch_tier1`, 0 client.js call either. **43 B** | 0 B |
| all four | | **1,545 B → projected 5,897 B** | 1,510 B → 3,591 B |

Remaining gap to the 3,510 B floor after all four: ~2,390 B, almost all of it the `utilities` chunk
(deep_set / debounced / throttled / upload ride with the soft-nav engine the shell needs). Not one of the
four inherited targets — recorded as a follow-up, not built.

## Phase 2 — BUILD (all four targets CONFIRMED and built; one commit each)

- (a) `432d7da` errors chunk by post-emit reference (`ERRORS_CHUNK_REFERENCE`, word-bounded, quoted
  variant tags excluded) + edges reset/ssr/urlguard/metaemit → errors (their own `typeof`-guarded
  `_scrml_error_boundary_log` reports — a missing edge would silently DROP a log, a behaviour change);
  `applyChunkDependencies` re-run after the post-emit gates and on the shared-runtime union.
- (b) `65574a9` `scope → {timers, animation}` edge retired; `_scrml_destroy_scope` typeof-guards the two
  teardown calls (their registries are filled only by their own chunks). New post-emit gates
  `_scrml_timer_`, `_scrml_stop_scope_timers(`, `animationFrame`, `_scrml_animation_frame(`,
  `_scrml_cancel_animation_frames(` — the edge had been masking any emitter the pre-emit walk misses.
- (c) `ca10a59` new `machine` chunk (right after core, chunk order = text order) holding
  `_scrml_machine_timers/_clear_timer/_arm_timer/_arm_initial` + `_scrml_replay`; post-emit gates
  `_scrml_machine_`, `_scrml_replay(`; edge engine → machine (`<onTimeout>` helpers).
- (d) `7ec643f` mount / vendor-ref / prefetch activate only under `ctx.emitPerRoute` (the splitter's own
  condition) — the splitter is their ONLY caller. Same root covers all three; per-route builds unchanged.
- ratchet `d217d0f`: 7,630 → 6,095 B ceiling.

### The sweep caught a real instance of the failure class (fixed in `0044ef3`)
First branch sweep: **25 pages with an UNGUARDED `_scrml_error_boundary_log` call and no 'errors' chunk**
(e.g. `conformance/cases/protect/assign-refresh-runtime`). Cause: the auto-await IIFE lift rewrites the
client body AFTER `assembleRuntime` and adds `.catch(_scrml_async_err => _scrml_error_boundary_log(…))`,
which the first reference scan never saw. Root fix: the gate table moved to module level
(`gateChunksByEmittedReference`) and runs a second time over the FINAL body, re-assembling the runtime in
its slot when it adds a chunk. Regression test pins both embed and shared-runtime modes.

## Phase 3 — proofs, ratchet, gates

### Per-target result
| target | measured | built | shell bytes saved (gzip, stripped) |
|---|---|---|---|
| (a) errors chunk always shipped | confirmed | built (`432d7da` + late gate `0044ef3`) | 469 |
| (b) scope → {timers, animation} edge | confirmed | built (`65574a9`) | 494 |
| (c) engine helpers in core | confirmed | built (`ca10a59`, new `machine` chunk) | 547 |
| (d) mount false trigger | confirmed (+ same root on vendor-ref, prefetch) | built (`7ec643f`) | 43 |
| **total** | | | **7,442 → 5,907 B (−1,535)**; counter 5,101 → 3,604 B |

Corpus programs (1,556 with a runtime) that still need the moved code: errors 196, timers 4, animation 1,
machine 3 direct + every engine page via the edge, route-splitter chunks 0 (default build).

### 1. Called-but-undefined sweep (`sweep.mjs`, acorn, every `.scrml` under examples/samples/conformance/stdlib/benchmarks)
2,627 sources → 1,556 output dirs with a runtime, 1,656 client files + 1,556 runtimes parsed, 0 parse failures.
Universe = every top-level name of the FULL runtime template + every `_scrml_*`; a reference is missing when
the shipped runtime does not define it and the referencing file does not bind it.
- base: client-UNGUARDED 1 (`stdlib/data/form-for` → `_scrml_labels_register`, PRE-EXISTING library compile).
- head (first build): client-UNGUARDED **26** — 25 new `_scrml_error_boundary_log` → fixed at the root (`0044ef3`).
- head (final): client-UNGUARDED **1** — the identical pre-existing one. **0 introduced.**
  client-guarded: 1,750 / identical name set. runtime-guarded: + `_scrml_stop_scope_timers` 1,552,
  `_scrml_cancel_animation_frames` 1,555 (the intended (b) guards — no-ops by construction); every other
  guarded name identical. runtime-unguarded: base 4,493 → head 4,483 (the 10 base library-mode runtimes that
  called `_scrml_stop_scope_timers`/`_cancel_animation_frames` with no definition — a pre-existing latent
  dangle — are now guarded). No new unguarded name.

### 2. Executed render (`render-all.mjs`, happy-dom, the SHIPPED runtime + client per captured page)
1,519 pages with html + runtime, both sides: load, DOMContentLoaded, one event per interactive element
(≤25; 1,310 fired) + form submits, fetch stubbed offline (drives the server-fn → `_scrml_error_boundary_log`
path: 145 pages reached it). Result: 1,516 ran / 2 TIMEOUT / 1 HARNESS-ERROR on BOTH sides;
**error sets identical on all 1,516**; ReferenceError pages base 28 = head 28 (pre-existing author-code
names, same list); DOM signature identical on 1,515, the one difference (`examples/15-channel-chat`) re-ran
3/3 identical on each side (timing flake). Bite proof: removing `_scrml_error_boundary_log` from
`examples/03-contact-book`'s shipped runtime makes the harness report `ReferenceError … is not defined`.
Unit-level executed proofs in `s461-runtime-tree-shake.test.js` (timer start/tick/teardown on the shipped
runtime; destroy_scope on the counter) and `engine-ontimeout-end-to-end.test.js` (engine → machine).

### 3. Differential (`scripts/corpus-emit-differential.ts`, base d99dad0 vs head 0044ef3)
Same 2,627 sources; compile outcome identical (1,590 ok); diagnostic codes identical; syntax 0 → 0.
7,782 artifacts: 1,460 identical, 6,322 differing, **all classified, 0 unexplained** (`classify.mjs`):
- 4,766 client/html/asset files: ONLY the `scrml-runtime.<hash>.js` filename differs.
- 1,556 runtimes: ONLY whole statements of the moved families removed (+ the guarded destroy_scope).
  By removed set: −{animation,errors,machine,timers} 591 · −{…,mount} 538 · −{animation,machine,mount,timers}
  185 · −{animation,errors,mount,timers} 65 · −{…,mount,prefetch} 64 · −{animation,machine,timers} 60 ·
  −{animation,errors,timers} 31 · −{errors,machine} 5 (library-mode) · 12 smaller groups. Nothing added.
- 1 diagnostic-text change: `samples/login.scrml` E-CG-001 cites a bundle line number (2708 → 2359) — the
  bundle includes the runtime, which shrank.
- `_scrml_fetch_*` BARE call-site count 241 → 28: the removed `prefetch` chunk's `_scrml_fetch_chunk` text.

### Ratchet
`SHELL_RUNTIME_GZIP_CEILING` 7,442 + 188 = 7,630 → **5,907 + 188 = 6,095 B** (`d217d0f`).

### Gates
- `bun test compiler/tests/unit compiler/tests/integration compiler/tests/conformance` (run WITHOUT `--bail`
  both times to get comparable counts): before 31,558 pass / 11 fail; after 31,573 pass / 13 fail → after the
  tier-N test fix (`codegen-route-splitter-tier-n`, real: it asserted prefetch admission without
  emitPerRoute) the only non-baseline failure is the load-sensitive F14 perf guard (2.1–2.3 s vs 2 s at load
  avg ~10; a library-mode compile that does not reach generateClientJs). All 11 baseline failures are
  environment (dev-server ports/timeouts, read-only FS, tenant executed DB) and one of them passed after.
- browser tests: base snapshot (git archive d99dad0) 50 fail; head 48 fail, a strict subset (the 2 extra on
  base are its own missing `benchmarks/todomvc/dist`). 0 new.
- `bun conformance/run.ts`: 1,514/1,579 pass, 65 xfail, 0 FAIL.
- types:check OK (unchanged) · facts --check PASS (regenerated by script) · bootstrap-conformance current ·
  SPEC-INDEX OK.
- SPEC: no chunk-membership text describes the moved code (§51.0.M / §51.12 cite `runtime-template.js`,
  still true). No SPEC edit.
