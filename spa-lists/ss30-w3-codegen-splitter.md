# sPA ss30 — W3: A-4 codegen splitter (consume ChunkPlans → real tiered chunks)

**Launch:** `read spa.md ss30` · **Branch:** `spa/ss30` · **Worktree:** `../scrml-spa-ss30`

**Fill:** W3 of the Approach-A "feel of performance" splitter arc — the codegen wave that turns the now-populated per-(EP, role) `ChunkPlan`s into ACTUAL emitted tiered chunk files + manifest + runtime loader. NEW S221. **W1 (DG markup-reads edge-lift) done S88; W2 (entry-points + Component-1 `<db>`-descent) landed S221 `8657f7cc` → trucking now produces 21 non-empty closures.** This is where the splitter stops computing a plan and starts SPLITTING. ⚠ **SURVEY-FIRST + PARK-DESIGN-FORKS** — this is a new codegen capability with SPEC + runtime-protocol implications; do NOT grind it blind.

## Shared ingestion
The **A-4 codegen consumption seam**: where codegen consumes the RS `ReachabilityRecord` → per-(EP, role) `ChunkPlan` → emitted chunks. **READ FIRST:** `compiler/src/codegen/index.ts:190/:201/:962` (the A-4 consumption TODO — "Empty until A-2.2+", the feature-flag note "default-on at the v0.3.0 cut") + `compiler/src/codegen/route-splitter.ts` (the existing per-route chunk model + the `W-CG-CHUNK-EMPTY`/`W-CG-CHUNK-PREFETCH-UNRESOLVED` diagnostics, :723) + SPEC **§40.9.7** (ChunkPlan → per-tier admission) + **§47** (the chunks.json manifest / payload-hash model the emitted chunks slot into) + the W2 landing (`docs/changes/feel-of-performance-approach-a-impl-2026-06-26/SCOPE.md` + delta-log [106]). The `ChunkContents` shape (`{componentNodeIds, reactiveCellNodeIds, serverFnNodeIds, vendorUnitNames}`) is the input.

## Core files
`compiler/src/codegen/index.ts` (the A-4 consumption point) · `route-splitter.ts` (chunk model) · `emit-client.ts` (chunk emission + the runtime splice) · the chunks.json manifest emitter (§47.5) · `dist/scrml-runtime.js` (the tiered-chunk loader)

## Items (survey-first; build only the bounded part; PARK design-forks for PA/user)

1. **SURVEY + SCOPE (do this first, STOP-report).** Establish the real A-4 delta: what does codegen consume today (the `ReachabilityRecord` is computed but `index.ts:962` says "Empty until A-2.2+" — is it wired at all?); how does `route-splitter.ts` currently chunk (per-route) vs how §40.9.7 wants per-tier-per-role admission; what's the §47 manifest contract; what's the feature flag + its default. **Report the real scope + EVERY design fork** (e.g.: chunk granularity — per-tier files vs inline-with-markers? · the runtime loader protocol — eager initialChunk + idle-prefetch tier1/2? · how per-ROLE chunks ship [the app serves one role per request — does the server pick the role's chunk-set?] · manifest shape · feature-flag default). **PARK every design fork for PA/user ruling** (like W2 surfaced §40.9.2) — do NOT decide them.
2. **Build the BOUNDED part** (only what the survey confirms is non-design-laden + ready): wire the A-4 consumption if it's stubbed; the mechanical chunk-set extraction from `ChunkContents`. Gate behind the feature flag (default OFF until the design forks are ruled + the wave completes). Do NOT build the runtime loader / manifest / role-serving until the forks are ruled.
3. **(blocked on #1 forks)** chunk emission · manifest · runtime loader · role-serving — these wait on PA/user rulings from #1. Park them with the survey.

## Status (S221, sPA ss30)
- **Item 1 — SURVEY:** ✅ DONE. **Premise STALE (Rule 4): W3-codegen is BUILT, not unbuilt.** `index.ts:962` "Empty until A-2.2+" = the *ReachabilityRecord* was empty, NOT the A-4 codegen absent. The A-4 splitter (A-4.1..A-4.7, S91) emits real non-empty initial chunks + `chunks.json` on trucking TODAY (21 EPs, verified). The real frontier is **W4 (runtime loader) + role projection + Component-3 N≥1**.
- **Item 2 — bounded build:** ✅ literal content already-built (no-op); landed a **characterization test** locking the W2→W3 baseline instead.
- **Item 3:** PARKED — emission+manifest DONE; runtime loader + role-serving are genuine W4 work. 5 design forks parked for PA/user.
- Full survey + forks: `ss30.progress.md`. Landed `compiler/tests/integration/w3-splitter-trucking-characterization.test.js` (4 tests green).

## Progress
`ss30.progress.md`. Land on `spa/ss30`; ping PA inbox. Do NOT advance main / push. **This list will likely come back mostly-SURVEY + a small bounded build + a fork-list for PA/user** — that's the expected + valuable shape (W1/W2 taught us the estimates are stale; survey-first is the discipline). PA re-integrates the bounded part + brings the design forks to the user. Feature flag stays OFF until W3 fully lands.

---

## CONTINUATION (S222) — continue the splitter arc (user: "continue W3")

**Re-fire `read spa.md ss30`.** W3-codegen is verified-built (the survey finding) → "continue W3" = the genuine
remaining UNBLOCKED splitter work that makes the emitted chunks MEANINGFUL. This is upstream **RS-solver** work
(`compiler/src/reachability/` + the Component projections) — NOT parser work (so NOT held by the #1 parser fork) and
NOT the W4 delivery/chunk-model (that is going to a separate dPA debate [dpa-014] — do NOT touch chunk delivery).

**Scope (SURVEY-FIRST — estimates in this arc have been stale 3×):**
1. **Component-3 — N≥1 server-fn interaction projection.** `serverFnNodeIds=0` everywhere today → all prefetch
   tiers (tier1/tier2) are empty. This is the analytical wave that makes the interaction-tiered closures non-empty.
   Survey: where the RS solver would key server-fn interaction reachability (the §40.9 interaction-tier model);
   scope the build; park design forks for the PA.
2. **Role projection.** Only `_anonymous` is split today; driver/dispatcher/customer surfaces aren't keyed.
   Upstream RS (Component-3/4 role keying). Survey + scope; this + Component-3 together make the split buy something.
3. **Empty-tier manifest disposition** (smaller): `chunks.json` references tier1/tier2 URLs that aren't written
   (empty payload) → a 404 risk once W4 follows them. Omit-from-manifest vs runtime-guard. NOTE: couples lightly to
   the W4 chunk-model debate — survey + recommend, do NOT build until [dpa-014] rules (or build the omit-from-manifest
   conservative half if it's debate-independent).

**Do NOT touch:** W4 runtime loader / chunk delivery model (dPA debate [dpa-014]); native-parser internals.
**Acceptance:** survey doc + per-item scope + fork-list. Expect mostly-survey (design-laden, like the W3 survey).
