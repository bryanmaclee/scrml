# sPA ss30 → PA — re-integration (W3 A-4 codegen splitter)

**List:** `spa-lists/ss30-w3-codegen-splitter.md` · **Branch:** `spa/ss30` · **Branch tip:** `2768d1ea` · **Base:** local `main` `f1607b97` (= main + 1 commit) · **Worktree:** `../scrml-spa-ss30`

## Shape: mostly-SURVEY + 1 bounded test + a 5-fork list. As the list predicted.

### HEADLINE (Rule 4 — needs your attention): the list premise is STALE. W3-codegen is BUILT, not unbuilt.
The list / SCOPE.md row 30 scoped W3 as *"build the unbuilt A-4 splitter"* citing `codegen/index.ts:962` "Empty until A-2.2+". **That comment refers to the ReachabilityRecord being empty, NOT the codegen being absent.** The A-4 splitter (A-4.1..A-4.7) was fully built S91-era — composers, content-addressing, lint family, HTML augmentation, `api.js` chunk + `chunks.json` write loop, runtime helpers, ~15 integration tests. It only ever consumed EMPTY plans until **W2 (`8657f7cc`)** populated them.

**Empirically verified:** `scrml compile examples/23-trucking-dispatch --emit-per-route` produces **21 entry points → 21 non-empty initial chunk files + chunks.json TODAY** (board EP = 2.4 KB, 37 `_scrml_chunk_mount` markers). W3-as-scoped (plans → emitted chunks + manifest) is substantially DONE. Third time the estimate was stale (W1 already built, W2 a smaller fix, W3-codegen already built).

## Landed (per-item)
- **Item 1 (SURVEY):** ✅ done — full findings + forks in `spa-lists/ss30.progress.md`.
- **Item 2 (bounded build):** literal content ("wire A-4 consumption / mechanical extraction") was already-built → no-op. Value-add landed: `compiler/tests/integration/w3-splitter-trucking-characterization.test.js` (4 tests green, 133 expect calls) in commit **`2768d1ea`** — locks the W2→W3 baseline (21 EPs · `_anonymous`-only roles · non-empty initial chunks w/ mount markers · empty tiers) as a W4 regression guard. Additive only; `emitPerRoute` stays default-OFF.
- **Item 3:** PARKED — emission+manifest DONE; runtime loader + role-serving are the genuine remaining work.

## PARKED design forks (PA → user; do NOT let me decide these)
1. **W3↔W4 boundary — who shrinks the payload?** Chunks are mount-marker DESCRIPTORS that NOTHING LOADS; the page still ships the full monolithic `.client.js`. The "feel of performance" payoff is unrealized until a runtime loader (W4) loads the initial chunk *instead of* the monolith. **Load-bearing fork.**
2. **Role projection.** Only `_anonymous` is split; driver/dispatcher/customer surfaces aren't. Upstream RS (Component-3/4 role keying), not codegen.
3. **Empty-tier manifest disposition.** `chunks.json` references tier1/tier2 URLs that aren't written (empty payload) — known-deferred (`route-splitter.ts:1961`), becomes a 404 risk once W4 follows them. Omit-from-manifest vs runtime-guard.
4. **Component-3 N≥1 projection.** `serverFnNodeIds=0` everywhere → all prefetch tiers empty. The next analytical wave after roles.
5. **SCOPE.md currency.** Proposed (for you to apply): row 30 `A-4 splitter ❌ NOT built` → `✅ BUILT (A-4.1..A-4.7, S91; verified non-empty post-W2)`; reframe W3 estimate (codegen DONE; remaining = W4 loader + roles + Component-3). I did NOT edit your SCOPE.md (PA-owned doc).

## Notes
- Coherence: `spa/ss30` = local main + exactly 1 additive commit (186 insertions, 0 deletions, no source touched). No main advance, no push.
- Pre-commit hook surfaced a pre-existing `(fail) If-Else (control-002)` in `scripts/compile-test-samples.sh`'s sample-compile step — NOT mine (additive test-only commit; gate passed). Flagging for your awareness.
- Worktree `../scrml-spa-ss30` has a `node_modules` symlink → main (gitignored; clean on prune).
