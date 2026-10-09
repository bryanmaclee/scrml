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
