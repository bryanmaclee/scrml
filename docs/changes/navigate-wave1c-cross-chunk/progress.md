# navigate Wave-1c (cross-chunk soft-nav) — progress

Startup pwd: /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a2ed001a5de228134
Merge base HEAD: 020485b2

## 2026-07-20 — Phase 0 SURVEY (in progress)

### Done
- Startup verification passed (worktree root confirmed, clean tree, bun install, pretest, dist symlink).
- Read maps (primary/domain/structure/dependencies/error), both nav deep-dives, SPEC §20.8 (full), BRIEFING-ANTI-PATTERNS, kickstarter v2 relevant sections.
- Located the exact runtime locus: runtime-template.js `_scrml_nav_apply_html` L2430; `!fetchedOutlet` bail L2437; `!_scrml_nav_same_chunk` bail L2441; `_scrml_nav_client_chunks` L2376; rehydrator registry L2219.
- Located the boot/rehydrator emit: emit-event-wiring.ts — DOMContentLoaded boot closure opens L641, closes L2041; `_scrml_register_rehydrator(_scrml_nav_rewire)` at L2038 is INSIDE that closure.
- Empirically compiled 3 minimal MPAs with `scrml build` and inspected emitted HTML/chunks (see FINDINGS).

### SURVEY FINDINGS (empirical — `scrml build` on minimal MPAs)

**Probe A (mpa/): shell=`<program>`+`<outlet/>` at root, pages/ = `<page>` routes.**
- reports.html + about.html emit as STANDALONE documents: NO shell chrome, NO `<outlet>`, NO `data-scrml-outlet`. Each loads only its own `*.client.js` + runtime.

**Probe B (mpa2/): added `pages/_layout.scrml` = `<program>`+`<outlet/>` shell.**
- `_layout.scrml` is recognized by route-inference (`layoutFilePath` recorded) but has ZERO codegen consumers. reports.html STILL standalone (0 outlet/nav/footer, no shell chunk). Layout composition is UNIMPLEMENTED.

**Probe C (mpa3/): shell=`<program>`+`<main><outlet/></main>` at root, pages/ = `<page>`.**
- The MPA `<main>`-slot composition (mpa-shell-clean-urls Sub 2, 2026-05-17, index.ts:1746) TRIGGERS: reports.html now has `<h1>Shell</h1>`/`<nav>`/`<main>`/`<footer>` chrome AND loads index.client.js (shell chunk) + reports.client.js (page chunk) + runtime — the multi-chunk shape.
- BUT the composition slot is `<main>`, and it REPLACES `<main>`'s children with the page body — DISCARDING the `<outlet>` that was inside it. Composed reports.html has NO `data-scrml-outlet` (grep = 0).

### THE FORK (STOP-IF-BIGGER)

Two DISCONNECTED, unreconciled "shell + per-page" implementations exist:
- (M) MPA `<main>`-slot composition (May 2026, index.ts:1746) — build-time textual post-pass; slot = first `<main>`; discards any `<outlet>` in the slot; lists shell-chunk + page-chunk.
- (O) `<outlet>` soft-nav model (§20.8, Jul 2026, Waves 1a/1b) — runtime swaps `[data-scrml-outlet]`; emits `<outlet>`→`<div data-scrml-outlet>`; NO build-time composition wraps `<page>` bodies into the outlet.

Consequence: a real multi-file build's target route pages NEVER carry `[data-scrml-outlet]`.
So `_scrml_nav_apply_html` bails at L2437 (`!fetchedOutlet`) → hard-nav — BEFORE ever reaching the
L2441 `_scrml_nav_same_chunk` bail the brief targets. The brief's premise (an outlet-bearing target
that names its chunks in order) is not producible by the current compiler for the multi-file form.

Real Wave-1c needs THREE pieces:
1. Shell-composition-INTO-OUTLET (CODEGEN, the big piece + a design ruling): make the swap slot
   `[data-scrml-outlet]` — compose each `<page>` body into the outlet region (preserving the outlet
   wrapper), list shell+page chunks. Requires a normative ruling on how `<outlet>` relates to the
   existing `<main>` composition (supersede? unify? retire `<main>`-slot?). SPEC §20.8.1/§20.8.2
   clearly intend `<outlet>` as the slot; the `<main>` composition predates §20.8.
2. Boot idempotency guard (CODEGEN, bounded but a boot-sequence restructure): rehydrator
   registration is inside `DOMContentLoaded` (emit-event-wiring.ts:641-2041). An injected route
   chunk loads AFTER DCL fired → its listener never runs → `_scrml_register_rehydrator` never runs →
   swapped region can't hydrate. Fix = `if (document.readyState==='loading') addEventListener(...)
   else boot()` PLUS skip re-registering delegated document listeners / shell re-boot for an
   injected chunk.
3. Runtime chunk-load at L2441 (RUNTIME, bounded) — the mechanism the brief scoped.

Piece 1 (reconcile two shell models + normative ruling) and Piece 2 (boot-sequence restructure) are
exactly the STOP-IF-BIGGER triggers ("restructuring the boot sequence" / a redesign beyond a bounded
idempotency guard). Per the HARD RULE: STOP, commit the survey, report the fork for a human ruling.

**Probe D (spa4/): single-file `<program>` + `<page route=...>` children.**
- `<page route="/x">` is REJECTED (E-PAGE-ROUTE-ATTR-FORBIDDEN) — routes are filepath-inferred. A
  single-file `<program>` is ONE document/route; the multi-route model IS the filesystem `pages/`
  form. route-splitter.ts produces per-(EP, role, tier) chunk descriptors feeding `_SCRML_CHUNKS`
  prefetch — a within-build code-split, NOT a separate outlet-bearing per-route artifact. So there
  is no narrower already-outlet-bearing cross-chunk scenario; the fork stands.

### RECOMMENDED OPTIONS FOR THE RULING

- **Option A (SPEC-aligned; recommended) — unify on `<outlet>` as the composition slot.** Make
  `<outlet>` the shell-composition slot so composed `<page>` HTML is `shell + page-body-in-outlet`
  and lists shell-chunk + page-chunk. Most bounded concrete form: emit `<outlet>` as
  `<main data-scrml-outlet ...>` (emit-html.ts:1594) so the EXISTING `<main>`-slot composition
  (index.ts:1746) PRESERVES the wrapper (prefix up-to-and-incl `<main…>` + `</main>`-onward) while
  filling it with the page body — the composed page then carries `[data-scrml-outlet]` on the
  wrapper, which the runtime swap addresses. Requires: (a) a normative ruling on the
  `<outlet>`↔`<main>` relationship (does `<outlet>` become the canonical slot / supersede the
  bare-`<main>` static path? coexist?), (b) piece 2 (boot idempotency guard — a boot-sequence
  restructure, an explicit STOP trigger; plus the (a)-(d) misfire handling when a route chunk's
  tier-1 module-init + tier-2 boot run against the LIVE shell), (c) piece 3 (runtime chunk-load).
- **Option B — two coexisting slot models** (`<main>` static + `<outlet>` soft-nav composed
  separately). More surface, likely undesirable.
- **Option C — defer Wave-1c; keep cross-chunk = hard-nav (honest current behavior).** Reclassify
  Wave-1c as blocked-on-shell-composition; keep the §20.8 banner at Waves 1a/1b + link-boost. The
  outlet-less-target hard-nav is already SPEC-permitted (W-OUTLET-ABSENT-SOFT-NAV-DISABLED).

### DELIBERATE NON-ACTIONS (per STOP-IF-BIGGER HARD RULE)
- Did NOT build the redesign (pieces 1-3).
- Did NOT land a SPEC §20.8 amendment claiming Wave-1c implemented — that would be a false
  spec-ahead claim (Rule 4 / verify-before-claim). The §20.8 banner stays honest until a ruling.
- Did NOT add the browser/conformance/R26 cases — they presuppose an outlet-bearing composed target
  the compiler cannot yet emit; a green test built on synthetic outlet HTML would mask the gap.

### VERDICT
STOP-IF-BIGGER fork REPORTED. Cross-chunk soft-nav is NOT a bounded runtime fix at L2441; it is
blocked on reconciling the two shell-composition models (`<main>` vs `<outlet>`) + a boot-sequence
restructure — a codegen redesign + a normative ruling, above this dispatch's build authority.

## 2026-07-20 — RULING RECEIVED (Option A) — BUILD

bryan ruled Option A (+ native-leg V1 exception). Building 3 pieces.

### Piece 1 — marker-driven composition + `<outlet>`→`<main data-scrml-outlet>` + both-slots error — DONE
- emit-html.ts: `<outlet>` now emits as `<main data-scrml-outlet tabindex="-1">` (was `<div>`).
- index.ts (composition ~L1746): slot detection is MARKER-driven — first `[data-scrml-outlet]`
  element, falling back to first bare `<main>` (static back-compat). Fixed the empty-slot bug
  (`slotCloseIdx >= slotOpenEndIdx`, was `>`) so an EMPTY outlet (the normal soft-nav case) composes.
- symbol-table.ts PASS 15.5: NEW E-OUTLET-AND-MAIN — a shell with BOTH `<main>` and `<outlet>`
  (two `<main>` landmarks = invalid HTML + ambiguous slot). Fires on the author `<main>`.

CHECKPOINT (empirical `scrml build`, mpa/ = `<outlet/>` shell + 2 pages/ routes):
- reports.html NOW carries `<main data-scrml-outlet tabindex="-1">` wrapping the route body, with
  shell chrome (`<h1>Shell</h1>`/`<nav>`/`<footer>`) AND lists runtime + index.client.js (shell
  chunk) + reports.client.js (route chunk) — the exact multi-chunk outlet-bearing shape Piece 3 needs.
- bare-`<main>` shell (mpa5/) still composes statically (back-compat verified).
- `<main><outlet/></main>` (mpa3/) now errors E-OUTLET-AND-MAIN (verified).
- Tests: navigate-wave1c-outlet-composition.test.js 9/9 pass; mpa-shell-clean-urls 17/17;
  navigate-soft-nav-lowering + link-boost + navigate-w-outlet-absent + trucking-smoke 54/54.

### Piece 2 — boot restructure (readyState guard) — DONE
- emit-event-wiring.ts: the main event-wiring boot is now `(function(){ function _scrml_boot(){…}
  if (readyState==='loading') addEventListener('DOMContentLoaded', _scrml_boot) else _scrml_boot() })()`.
  Initial page load (end-of-body script → readyState 'loading') defers to DCL (unchanged); an
  INJECTED route chunk (readyState 'interactive'/'complete') boots IMMEDIATELY → registers its
  delegable handlers + `_scrml_nav_rewire` rehydrator + if=/each wiring.
- emit-variant-guard.ts: same readyState guard on the engine/match initial-dispatch DCL block
  (local `_fire`, no global name — multiple dispatchers/file) so an injected route carrying an
  engine/match does its initial dispatch on first visit instead of rendering frozen.
- "Skip re-registering delegated document listeners / shell re-boot": NO new skip flag needed — the
  only SHARED document listeners are `_scrml_link_ensure_click` (emit-client.ts, `fileHasOutlet`-gated
  → shell-only, never injected) + popstate, BOTH already idempotent-guarded (`_scrml_link_click_wired`
  / `_scrml_nav_popstate_wired`). A route chunk emits NO shared listeners; its per-file delegable
  click/submit listeners dispatch off a per-file registry (disjoint placeholder ids) so accumulating
  them across visited routes is not a double-fire. Documented in code + here.
- happy-dom readyState is 'interactive' → the boot runs at eval (else branch); the browser suite's
  mount()+manual-DCL-dispatch still works (boot runs regardless). navigate 22/22, link-boost 10/10.
- Test updates (coupled): state-block-event-wiring (7 assertions → `_scrml_boot` marker),
  engine-body-render (dispatcher DCL regex → reshaped `_fire`/readyState form). +2 new Piece-2
  assertions in navigate-wave1c-outlet-composition.test.js (11/11).
- RESIDUAL (pre-existing, OUT OF SCOPE): full engine/match REHYDRATION on a REPEAT soft-nav (2nd+
  visit) is a pre-existing same-chunk gap (`_scrml_rehydrate_region` re-fires rehydrators +
  `_scrml_remount_each`, not top-level match/engine dispatchers). The readyState guard fixes the
  FIRST-visit-of-injected-chunk case (parity with normal first load); repeat-visit engine/match
  rehydration is untouched by Wave-1c.

### Piece 3 — runtime cross-chunk load — DONE
- runtime-template.js `_scrml_nav_apply_html`: replaced the L2441 `!_scrml_nav_same_chunk` hard-nav
  bail with the real load path. New helpers:
  - `_scrml_nav_missing_chunks(doc, path)` — ordered (deps-first) ABSOLUTE URLs of the target's
    `.client.js` scripts NOT already loaded; resolves each src against the TARGET page URL (nested
    upToRoot-correct), from the FETCHED doc (not by convention).
  - `_scrml_nav_load_chunks(urls, token, onDone, path)` — sequentially injects `<script async=false>`
    (deps-first order), awaits onload; timeout (`_SCRML_NAV_CHUNK_TIMEOUT_MS=10000`) / onerror /
    synchronous-append-throw → `_scrml_nav_chunk_failed` → W-NAV-CHUNK-LOAD-FAILED (console.info) +
    hard-nav. Token recheck at each step (a chunk finishing after a newer nav bails silently).
  - Seed installed BEFORE chunk load (injected chunk's tier-1 seed-apply uses the new-route seed;
    no stale re-apply over live shell cells — finding #5). View-Transition/token/abort/popstate/focus/
    scroll all preserved (cross-chunk rides `_scrml_nav_fetch_and_swap` → works on back/forward too).
- Fixed a self-inflicted bug: comment backticks (`<script src>`) broke the SCRML_RUNTIME template
  literal → self-host-meta-checker compile failed. De-backticked; runtime parses + node --check clean.

### R26 EMPIRICAL (MANDATORY) — PASS
browser-navigate-cross-chunk.test.js EXECUTES the REAL emitted cross-chunk MPA bundle (compiled to
disk: shell index.scrml + pages/reports.scrml + pages/about.scrml → separate chunks) in happy-dom.
happy-dom blocks injected-script loading, so a route chunk's `<script>` append is intercepted and the
REAL emitted reports.client.js is executed in the shared runtime scope (a direct-eval closure — faithful
classic-script scope sharing). Verified (4/4):
  1. the composed reports.html carries `[data-scrml-outlet]` + shell chrome + lists BOTH chunks;
  2. a soft-nav to /reports LOADS reports.client.js, swaps the outlet to the route content, and the
     shell `<h1>` SURVIVES (no full reload, no runtime re-boot);
  3. the swapped route's reactivity works AFTER the swap — `_scrml_reactive_set("rows", [4 items])`
     re-renders the `<each>` to 4 `<li>` + the `${@rows.length}` interpolation updates to 4;
  4. a chunk-load FAILURE hard-navs (W-NAV-CHUNK-LOAD-FAILED) — the outlet is left intact, never
     frozen-swapped with unhydrated content.
Browser suite: navigate 22 + link-boost 10 + cross-chunk 4 = 36/36. finding #4 test updated (its
cross-route hard-nav now flows through the Wave-1c chunk-load-failure fallback; assertion unchanged).

### SPEC (land-with-impl) + conformance + a deploy-path bug — DONE
- SPEC §20.8 banner flipped to IMPLEMENTED (Waves 1a/1b + link-boost + 1c); keep-alive §20.8.4 +
  nested outlets stay Nominal/v1.next. §20.8.1 (marker-driven `<outlet>`→`<main data-scrml-outlet>` +
  E-OUTLET-AND-MAIN + composition note), §20.8.2 (cross-chunk load step + hard-nav-on-failure, now a
  5-step pipeline), §20.8.6 (normative statements), §20.8.7 (E-OUTLET-AND-MAIN + W-NAV-CHUNK-LOAD-FAILED
  named), §40.8 (the previously-UNSPECIFIED composition mechanism — marker-driven slot, now normative),
  §34 catalog rows (E-OUTLET-AND-MAIN + W-NAV-CHUNK-LOAD-FAILED). SPEC-INDEX regenerated (46 rows).
- Conformance: conf-NAV-CROSS-CHUNK.test.js — codes-half (E-OUTLET-AND-MAIN pos/neg) + a DETERMINISTIC
  runtime-half that EXECUTES the shipped helpers in isolation (a `new Function` + DOM stub, no HTTP, no
  happy-dom global): `_scrml_nav_missing_chunks` returns the not-loaded chunk (need\have, abs-resolved),
  returns [] same-chunk; `_scrml_nav_chunk_failed` emits W-NAV-CHUNK-LOAD-FAILED + hard-navs, and bails
  silently under a superseded token. 9/9.
- DEPLOY-PATH BUG (caught by the conformance test, fixed): `_scrml_nav_client_chunks`'s regex
  `/\.client\.js/` did NOT match content-hashed chunk names (`reports.client.<hash>.js`, the `scrml
  build` §47.9.8 output) — so cross-chunk detection would silently NO-OP on the deploy path (only the
  dev/unhashed path worked). Broadened to `_SCRML_CLIENT_CHUNK_RE = /\.client\.(?:[0-9a-z]+\.)?js(\?|$)/i`
  (both forms); the per-content hash is stable so shell-chunk basename matching still holds across pages.
- Wildcard-test collision fix: emit-variant-guard's readyState guard used `} else {`, tripping the
  match-block §3 "no default-arm else" regression grep; rewrote as two `if`s (no `else {`).

### Piece 2 REDESIGN — flag-gated boot (not readyState) — full browser suite triage
- The readyState-gated boot (`if readyState==='loading' defer else boot-now`) regressed 7 happy-dom
  browser tests (g-if-chain-branch-display-null-interp ×6, browser-error-boundary ×1): happy-dom's
  document.readyState is "interactive" (not "loading"), so the boot ran at EVAL time instead of at the
  test's manual DOMContentLoaded dispatch — a test-harness timing artifact (a REAL end-of-body script
  loads at readyState "loading", so real-browser behavior was unchanged). Confirmed via a merge-base
  source run: those 7 PASS on merge-base, fail on the readyState build.
- REDESIGN (strictly better): the initial-load boot keeps the ORIGINAL pure
  `document.addEventListener("DOMContentLoaded", _scrml_boot)` (byte-for-byte unchanged → the 7 pass
  again). Eager boot fires ONLY for an INJECTED chunk, gated on a NEW runtime flag `_scrml_chunk_loading`
  that `_scrml_nav_load_chunks` sets true around each `<script>` injection (the chunk's IIFE reads it,
  then onload clears it). emit-event-wiring.ts + emit-variant-guard.ts emit the flag guard; the
  readyState test-hack in input-state-read-path-bug-ac.test.js was reverted.
- Full browser suite AFTER redesign: 609 pass / 12 fail — the 12 are EXACTLY the pre-existing baseline
  (render-by-tag ×5, each-per-item ×3, text-interp-lift ×4; identical set + count on the merge base).
  ZERO new browser regressions; the 4 cross-chunk tests pass. Cross-chunk browser + if-chain-null +
  error-boundary = 22/22.
