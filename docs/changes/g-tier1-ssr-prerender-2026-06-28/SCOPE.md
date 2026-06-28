# SCOPE — g-tier1-ssr-prerender (§52.8 server-authoritative SSR pre-render)

**Survey:** S229, read-only Plan agent `ac9e2025953ab8bb4`. **Status:** needs-design-ruling-first (gating a substantial-new-subsystem build). NOT a fire-now build.

## Verdict
The known-gaps "substantial new subsystem" claim is **VERIFIED, not refuted** (the OPPOSITE of g-component-body S228, where infra 90% pre-existed). The foundational capability — **request-time server-side HTML composition** — genuinely does not exist in the toolchain, and the full §52.8 flash-free target IS the already-ratified-but-unbuilt **server-render-time / dynamic-deployment-target arc** (§58 Nominal · §40.9.5 server-render-time gating runtime "started as a high-leverage arc, unbuilt" · GITI-027B Option-D ratified-direction-queued-not-built, deep-dive `scrml-support/docs/deep-dives/giti-027b-per-role-ssr-content-stripping-2026-05-30.md`). This gap is a **sub-arc of that**, not an independent feature.

## Evidence
1. **No request-time server-side HTML render path.** `generateHtml` (`emit-html.ts:520`) runs at COMPILE time → a STATIC `.html` with empty mount placeholders (`emit-each.ts:347-361` → `<div data-scrml-each-mount=…></div>`, no rows ever). `emit-server.ts` (`generateServerJs`) emits ONLY JSON routes (grep `text/html` = nothing). dev.js serves static `.html`; serve.js is compile-as-a-service, not an app server. No process composes HTML per request. (Corroborated by SPEC OQ-A4-E S91: per-(route,role) HTML rejected because it "couples HTML emission to server-side role-routing infrastructure scrml doesn't have.")
2. **No DOM-adoption hydration.** Runtime always client-renders from scratch (`_scrml_reconcile_list` builds into the empty mount; its own comment describes the flash). The only `hydrate` is `_scrml_engine_hydrate_init` (engine boot from a cell, NOT DOM adoption).
3. **What EXISTS (the query half — reusable):** `/__serverLoad/<var>` (`emit-server.ts:2733`) + Tier-2 Pattern-C route + `/__mountHydrate` (2691) already run the queries server-side at request time → return JSON. `_scrml_reactive_set` (`runtime-template.js:730`) seeds the cell. `collectServerAuthorityTypes` (`collect.ts:588`) enumerates both tiers. So the server can already PRODUCE the rows at request time — it just hands them back as JSON, not HTML.

## CORRECTION (depth-of-survey catch)
The gap prose cites `route-splitter.ts:1167` as the SSR locus. **That's wrong** — line 1167 (`composeInitialChunk`) is about concatenating per-route chunk JS into one injected `<script>` (script bundling), NOT data-SSR markup render. The §58/§40.9.5/GITI-027B evidence carries the verdict; do NOT treat route-splitter:1167 as the SSR locus.

## §52.8 scope: Tier-1 AND Tier-2 (unified)
§52.8 (`SPEC.md:29926`) is explicitly both tiers; §52.7 reinforces uniform machinery. Derived cells pre-render iff all sources are server-authoritative; client-local/form state never pre-render. A **unified server-authoritative-SSR pass** is the correct shape (collect already treats both as one set); splitting duplicates the new HTML-composition path.

## THREE design rulings (BLOCK any build)
1. **Deployment-target model (the gate).** Does §52.8 SSR *start/compose with* the §58 dynamic-deployment-target / §40.9.5 server-render-time runtime arc, or ship a standalone request-time HTML shim ahead of it? On static-CDN targets there is NO server in the request path — §52.8 is structurally unsatisfiable there (mirror of §40.9.5's permanent static-target caveat).
2. **Option A vs B.** §52.8's literal text ("populated in the initial HTML; no loading placeholder on first paint") arguably MANDATES Option A (DOM pre-render + client adoption). Option B (inline `<script>window.__scrml_ssr_state={…}</script>` + client seed-before-paint) is far cheaper, reuses the query infra, kills the fetch RTT — but the static HTML still paints an empty list first, so it does NOT strictly satisfy §52.8. Is B an acceptable interim?
3. **Auth/protect during SSR (real leak risk).** `/__serverLoad/<var>` runs `SELECT *` with NO auth gate and NO protected-field redaction (`emit-server.ts:2748`). SSR-baking those rows into first-paint HTML ships them to every viewer; the per-role gating runtime that would filter is the UNBUILT Option-D arc. Ship SSR before per-role gating exists (accepting the leak the client-fetch already has), or block on it? Also: SSR must run under the request's authenticated context.

## Decomposition
- **Step 0 — DESIGN RULING** (blocks all; resolve the 3 above → a SCOPING picking A vs B + the deployment-target story).
- **Option B path (~15-25h, if state-inline interim ruled sufficient):** (1) server request-time HTML-composition route (extend `generateServerJs`; reuse `/__serverLoad` query logic; inject `<script>` state before `</head>`); (2) client seed-from-inline before mount + make `emitServerAuthorityLoad`'s fetch IIFE conditional; (3) Tier-2 + derived parity (unified); (4) retire W-AUTH-002 + regression tests. *Caveat: narrows flash to a synchronous client render, does NOT satisfy §52.8's "no placeholder on first paint."*
- **Option A path (~weeks, multi-dispatch — the ratified-but-unbuilt arc):** B's state-inline as substrate → server-side markup renderer (per-row render logic runnable server-side, today client-runtime-only — the §58 dynamic-target arc) → DOM-adoption hydration → per-role gating composition (GITI-027B Option D).

## Files (a build would touch)
`emit-server.ts` (generateServerJs + /__serverLoad 2733-2792) · `emit-html.ts` (generateHtml 520; per-row render today client-only) · `runtime-template.js` (_scrml_reconcile_list 1541, _scrml_reactive_set 730; new DOM-adoption + seed hook) · `emit-sync.ts` (emitServerAuthorityLoad 104; make fetch conditional) · `emit-each.ts` (mount placeholder 347) · `collect.ts` (collectServerAuthorityTypes 588, reused as-is) · `type-system.ts` (W-AUTH-002 8304).

## Recommendation
NOT a fire-now build. It's a strategic arc gated on Step-0 rulings + plausibly the substance of a **v0.8 milestone** (the server-render-time / dynamic-deployment-target arc). Either make the Step-0 ruling (then Option B is a bounded ~15-25h dispatch) OR park as a defined arc (not a blocker — client-load works today; W-AUTH-002 tracks).
