# sPA ss27 — low-ingestion cleanup sweep (test-hygiene · runtime-minimality · migrate-tool · doc-currency)

**Launch:** `read spa.md ss27` · **Branch:** `spa/ss27` · **Worktree:** `../scrml-spa-ss27`

**Fill:** the LOW self-contained residuals that each need near-zero subsystem ingestion — a flaky fixture, a dead client chunk, a migrate-tool auto-strip, and two doc-currency rewords. NEW S221. **The clustering property here is "minimal + independent ingestion" (the S210 least-ingestion-first taken to the limit), NOT a shared subsystem** — each item is self-contained, so an sPA can grind them top-to-bottom without re-warming. Honest note: this is the one list where the ingestion is per-item, not shared — kept as a sweep so the LOWs don't rot ungrouped.

## Shared ingestion
None shared — each item is self-contained + cheap. The list IS the ingestion-floor sweep. **READ FIRST per-item** the named fire-site only (no broad subsystem read needed).

## Core files (per-item, disjoint)
`compiler/tests/integration/trucking-dispatch-smoke-integration.test.js` · the client-chunk emission/tree-shake path · `bun scrml migrate` tooling · `docs/articles/components-are-states-devto-2026-04-29.md` + `docs/heads-up/spec-consolidation-2026-05-25.md`

## Items (least-ingestion-first; all LOW)

1. **`bug-19-cite`** (LOW, cosmetic) `[status=open]` — §11-folded-citation sweep. Pure cosmetic doc edit. Smallest.
2. **`g-s52-retraction-doc-staleness`** (LOW, doc-currency) `[status=open]` — two DERIVED docs still teach the DELETED §52 auto-persist/optimistic model (the S194 §52.6.2 retraction): `components-are-states-devto-2026-04-29.md` (L139,175) + `spec-consolidation-2026-05-25.md` (L297,332,370). **Fix:** reword the optimistic/rollback/auto-persist claims to the read-authority-only model (initial-load/SSR claims stay compliant), OR deref the heads-up to scrml-support. ⚠ **Rule-1-adjacent** (the devto article is published copy) — voice-currency reword is delegate-able per `feedback_delegate_voice_currency_old_articles`, but flag to PA before touching published article prose.
3. **`g-trucking-smoke-chunks-flake`** (LOW, test-stability) `[status=open]` — `trucking-dispatch-smoke`'s `chunks.json manifest` assertion flakes under full-suite concurrency (passes isolated + in the gate); likely a shared-output-dir / parallel-write race. **Fix:** stabilize the fixture isolation (per-test output dir).
4. **`g-stdlib-runtime-chunk-dead-weight`** (LOW, runtime-minimality) `[status=open]` — a client-safe stdlib module used ONLY server-side still ships its runtime chunk to the client (dead weight; no correctness impact — the #5 fix stripped the server-ONLY leak; this is the client-safe-but-unused residual). **Fix:** tree-shake the unused client-safe chunk when no client reference remains.
5. **`g-channel-server-keyword-auto-migrate`** (LOW, migration ergonomics) `[status=open]` — `bun scrml migrate` does not auto-strip a deprecated `server function` channel-cell-write publisher → client under RULING A (it fires `E-CHANNEL-SERVER-CELL-READ` + leaves it for manual fix; Enhanced-A deferred). **Fix:** add the migrate `--fix` rule to auto-strip the deprecated channel publisher keyword. Heaviest (migrate-tool AST rule) — ordered last.

## Progress
`ss27.progress.md`. Land on `spa/ss27`; ping PA inbox per-item. Do NOT advance main / push. #2 (#published-article) STOP-and-confirm with PA before editing devto prose (Rule 1). Others are clean small lands. PA re-integrates (S67; #3/#4 need full-suite to confirm the flake/tree-shake).
