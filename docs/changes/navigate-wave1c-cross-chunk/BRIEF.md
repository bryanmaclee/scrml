# Navigate Wave-1c — cross-route (cross-chunk) soft-nav (#27 residual)

**Arc:** the last leg of the #27 soft-nav client router. Waves 1a/1b (same-chunk soft-nav) + link-boost (`<a href>`) are LANDED on main `020485b2`. Wave-1c closes the ONE remaining gap: **a soft-nav to a route whose client chunk is not already loaded currently HARD-navigates (full reload).** Deliver an in-place soft swap for cross-chunk routes too.

**Design authority (READ FIRST):** SPEC §20.8 (the client router, esp. §20.8.2 pipeline + §20.8.7 codes) · deep-dives `../scrml-support/docs/deep-dives/navigate-soft-nav-client-router-2026-07-11.md` (DESIGN COMPLETE) + `navigate-rehydration-mechanism-2026-07-12.md`. Issue context: `gh issue view 27`.

## The exact gap (verified)
`compiler/src/runtime-template.js`:
- `_scrml_nav_apply_html(html, path, restore, token)` line **~2441**: `if (!_scrml_nav_same_chunk(doc)) { _scrml_navigate(path); return; }` — the hard-nav bail. **This is the locus.**
- `_scrml_nav_same_chunk(doc)` (~2392) returns false when the target doc references any `.client.js` `<script src>` NOT already in the current document (`_scrml_nav_client_chunks`). That "need but don't have" set is exactly the chunk(s) Wave-1c must LOAD.
- The reason it bails today (comment #4): "the current runtime has no wiring for it, so a soft swap would render frozen, dead markup." Correct — the target route's rehydrator + wiring live in ITS chunk, which isn't loaded.

## The mechanism (Approach A — reuse the existing chunk model)
Each page's `.client.js` self-registers its rewire fn at top level: `_scrml_register_rehydrator(_scrml_nav_rewire)` → pushes to `_scrml_rehydrators[]` (emit-reactive-wiring.ts ~2038; runtime-template.js ~2220). Chunks load as **classic `<script>`s** with a `_scrml_modules[...]` registration footer + topological (deps-first) ordering (runtime-template.js ~2844, index.ts). So:

1. In `_scrml_nav_apply_html`, when `_scrml_nav_same_chunk(doc)` is false, compute the missing `.client.js` set (`need \ have`), **resolve their real dist URLs from the fetched `doc`'s `<script src>` list** (the target's own HTML already names its chunks in the correct order — do NOT reconstruct URLs by convention), inject them as classic `<script>`s **in the doc's order** (deps before importers), and await load.
2. On all-loaded → each newly-loaded chunk has self-registered its `_scrml_nav_rewire` into `_scrml_rehydrators` → proceed with the EXISTING path (seed → head-sync → teardown → `innerHTML = newHtml` → `_scrml_rehydrate_region` → focus → scroll). The rehydrator array now contains the target route's wiring.
3. **Failure/timeout → hard-nav fallback** (`_scrml_navigate(path)`), preserving the last-nav-wins token check (`token !== _scrml_nav_token` bails silently; a load that resolves after a newer nav must NOT swap).
4. Preserve every Wave-1b invariant: AbortController + monotonic `_scrml_nav_token` (a superseded nav must not load/swap), View-Transition wrapping, region teardown, shell-cell skip, `#hash` short-circuit, popstate path (`_scrml_nav_fetch_and_swap` is shared by pushState + popstate — cross-chunk must work on back/forward too).

## ⚠️ THE LOAD-BEARING RISK — survey FIRST, then build
Loading a route chunk's IIFE into an **already-booted live shell** is the crux. Its top-level rehydrator registration is a clean side-effect (safe), but the chunk may do OTHER boot-time work that misfires against a live document:
- **Delegated document-level listeners** (e.g. the link-boost click handler `_scrml_link_ensure_click`, submit/keyboard delegation) re-registering → double-fire.
- **Initial render / mount into `document`** (the chunk expects to boot a fresh page) → conflicting mount, or a re-render of the shell.
- **`DOMContentLoaded` boot hooks** that already fired.
- **Module-init** (`_scrml_modules`/stdlib/`_scrml_chunk_mount` registrations) that must be idempotent.

**SURVEY (Phase 0, report findings before building):** trace exactly what a per-route entry `.client.js` executes at load (emit-reactive-wiring.ts boot section ~700-940, route-splitter.ts, atom-emitter.ts, index.ts script assembly, runtime-chunks.ts tree-shake). Determine whether Approach A works with a small **"loaded-post-boot" idempotency guard** (a codegen/runtime flag so a chunk loaded during a nav registers its rehydrator + wiring but SKIPS re-booting the shell / re-registering delegated listeners / initial-rendering), OR whether it needs more.

**STOP-IF-BIGGER (hard rule):** if the survey shows the chunk-into-live-shell needs a **codegen redesign** beyond a bounded idempotency guard — e.g. a new soft-nav-only chunk artifact, an ES-module refactor of the chunk format, or restructuring the boot sequence — **STOP, commit the survey to `progress.md`, and report the fork.** The PA surfaces it to bryan (it becomes a design ruling, not an autonomous crossing). Do NOT silently build a large redesign.

## SPEC (land WITH the impl, Rule 4)
§20.8.2 currently assumes the route's chunk is present ("reusing the route's client chunk"). Amend:
- **§20.8.2** — add the normative cross-chunk step: a soft-nav to a route whose client chunk(s) are not present SHALL load them (in the target document's script order) before hydrating; a chunk **load failure or timeout SHALL fall back to hard navigation** (SSR-first preserved).
- **§20.8.6** — add the matching normative statement.
- **§20.8.7** — NAME a code for the load-failure fallback, e.g. **`W-NAV-CHUNK-LOAD-FAILED`** (Info — a cross-chunk soft-nav fell back to hard because a chunk failed to load). Add its §34 main-catalog row WITH this impl (named-codes-land-with-impl). Also flip the §20.8 Nominal banner note to reflect Waves 1a/1b + link-boost + 1c IMPLEMENTED (keep-alive §20.8.4 + nested-outlets remain Nominal/v1.next).
Regenerate the index: `bun run scripts/regen-spec-index.ts`.

## Gates (do NOT mark DONE without these)
- **Unit/integration:** `bun run test` (chains pretest) — 0 failures is the contract. Note any pre-existing full-browser-suite failures are IDENTICAL on your merge base (the ~12 render-by-tag / each-per-item ones) — verify they match base, don't chase them.
- **Browser test:** extend the navigate browser suite with a **cross-chunk** soft-nav case — two `pages/*.scrml` routes in DIFFERENT client chunks, assert navigation swaps `<outlet>` content WITHOUT a document reload (no runtime re-boot; a shell cell survives) AND the target route's reactivity works after the swap (a `@cell` update / an `<each>` / an `if=` in the swapped route re-renders). Assert the hard-nav fallback fires on a simulated chunk-load failure.
- **Conformance:** if `W-NAV-CHUNK-LOAD-FAILED` is authorable/observable, add a codes-half case; the runtime-half stays DETERMINISTIC (execute the shipped helper + assert wiring — NO session-auth full-bundle-over-HTTP; that's cloud-flaky, see [[feedback_cloud_ci_full_bundle_http_flaky]]).
- **R26 (Phase 3 — empirical, MANDATORY):** build a minimal cross-chunk MPA (a `<program>` shell with `<outlet>` + two `pages/` routes that land in separate chunks; one data-heavy). Compile on YOUR post-fix baseline. EXECUTE the emitted bundle (don't grep the text) and confirm a cross-page navigation does a soft swap (no full reload / no runtime re-boot / no mount re-fetch of shell data). Record the exact check in `progress.md`. DO NOT mark DONE without empirical pass. (This is the "execute-don't-grep" lesson — a soft-nav that "emits the code" but throws at load is DOA.)

## Crash-recovery + hygiene
Commit after each meaningful unit (WIP commits fine); keep an append-only `docs/changes/navigate-wave1c-cross-chunk/progress.md` (timestamped: done / next / blockers / the survey findings). The branch + progress.md are your recovery anchor. Report: final SHA, files-touched, deferred items.

## Maps
Maps stamp is `df2ac831` (a few commits behind HEAD `020485b2`). The post-map landings (#111/#113 GITI ast-builder, #117/#118 tenant §14.8.10, #120 SSR-leak sql-lex/emit-server, #121 freeze-spec, #122 esql4) **do NOT touch the navigate / runtime-template soft-nav / chunk-emit surface** — treat the nav-relevant maps (`primary`, `structure`, `dependencies`, `error`) as current for this task; verify against source if anything looks off.
