Build **Wave-1b of the scrml Client Router (#27): the RUNTIME soft-navigation pipeline.** Wave-1a (the `<outlet>` + `<program>`-shell foundation) is already landed on main. Do NOT build link-boost (`<a>` interception — Wave 2) or keep-alive (Wave 3). Isolated worktree, incremental commits, NEVER touch main.

STEP 0: write this brief to `docs/changes/navigate-wave1b-runtime/BRIEF.md`.

## Design authority (READ)
- `compiler/SPEC.md` §20.8.2 (soft-nav pipeline) + §20.8.5 (correctness set) + §20.1–20.3 (navigate soft/hard).
- `../scrml-support/docs/deep-dives/navigate-soft-nav-client-router-2026-07-11.md` (Axis 1 = SSR-HTML fetch→swap→hydrate→View-Transitions).

## Wave-1a artifact you build on (LANDED on main)
- `<outlet>` emits as **`<div data-scrml-outlet>`** (children = initial content), addressable via `document.querySelector('[data-scrml-outlet]')`. The soft-nav swaps THIS element's subtree.
- `<program>` is the recognized shell; recognition + E-OUTLET-DUPLICATE/OUTSIDE-SHELL + W-OUTLET-ABSENT are wired. Wave-1b adds the "boots once" runtime shell semantics.
- 1a left NO focus-target id on the outlet — **add one in 1b** for §20.8.5(3) focus-after-swap.

## Scope — build ONLY this (Wave-1b)
1. **navigate() lowering** — `compiler/src/codegen/emit-expr.ts:2524-2527` (currently `navigate`→`_scrml_navigate(args)`). Branch on `ctx.mode` (already threaded — see `log()` at `:2551`) + a 2nd `.Soft`/`.Hard` variant arg:
   - client caller (or `.Soft`) → `_scrml_navigate_soft(path)`
   - server-escalated caller (or `.Hard`) → the existing 302 hard path; `.Hard` from a client caller escalates the fn to a server route or emits **W-NAV-001** if impossible (§20.3, code reserved).
2. **The runtime soft-nav engine** — `compiler/src/runtime-template.js` (`_scrml_navigate` at `:2184`). Add `_scrml_navigate_soft(path)`:
   - `history.pushState` (reuse `runtime/stdlib/router.js:104` pushState shape).
   - `fetch(path)` the target route's SSR HTML (prefer a prefetched copy if the manifest has it — `_SCRML_CHUNKS`/`_scrml_fetch_chunk` `:2270`/`:2318`; OK to just `fetch` for the MVP + note the prefetch-reuse follow-on).
   - Parse the response, **extract the `<outlet>` (`[data-scrml-outlet]`) subtree + the `__scrml_ssr_state` seed** (the SSR doc injects `<script>window.__scrml_ssr_state={…}</script>`). MVP: client-side `DOMParser` extract from the full document; a server outlet-fragment mode is a later optimization (note it).
   - Swap the live `[data-scrml-outlet]` subtree with the fetched one.
   - **Re-hydrate the swapped region** via a NEW `_scrml_rehydrate_region(root)` (see 3).
   - **View Transitions:** wrap the swap in `document.startViewTransition(...)` where available; else swap instantly (no error) — §20.8.5(7).
   - **AbortController** last-nav-wins (§20.8.5(4)): abort a superseded in-flight fetch.
3. **`_scrml_rehydrate_region(root)`** (NEW, runtime-template.js) — factor the per-page boot so it re-runs SCOPED to a swapped subtree WITHOUT re-booting the shell:
   - the DOMContentLoaded wiring body at `compiler/src/codegen/emit-event-wiring.ts:553` (delegated + `querySelectorAll` handlers) — re-run scoped to `root`.
   - `_scrml_ssr_seed_apply()` (`runtime-template.js:4963`) — apply the swapped region's seed.
   - tear down the OLD region's reactive scopes via `_scrml_unmount_scope` (`:1425`) before swapping. Shell-level cells/listeners stay live.
   - reuse `_scrml_init_set`/`_scrml_reactive_*`/`_scrml_mount_template` as the existing boot does.
4. **SSR outlet-fragment** — `compiler/src/codegen/emit-server.ts:3396-3483` `_scrml_ssr_compose_handler` already returns the full per-route SSR document (seed injected `:3467-3478`). MVP: the client extracts the outlet + seed from that full doc (no server change). If a clean fragment-response mode is easy (`Accept: application/scrml-fragment` → outlet inner + seed), do it; else defer + note.
5. **Correctness floor** (§20.8.5): popstate → soft-nav to target (reuse `router.js:118 onNavigate`/popstate); `history.scrollRestoration="manual"` + scroll-to-top-or-`#hash` on new nav, restore on back/fwd; move focus to the `<outlet>` region after swap; View-Transitions-absent instant swap; the `<a href>` stays a real link (no-JS degrade — already true, don't break it).

## Gates (MANDATORY)
- Full suite green: `bun test compiler/tests/{unit,integration,conformance}` (0 fail). If you touch render/codegen and check browser, recompile fixtures FIRST: `bun run compiler/src/cli.js compile samples/compilation-tests/` (stale dist fakes failures).
- **Conformance cases:** client `navigate("/x")` lowers to `_scrml_navigate_soft` · server-ctx `navigate` stays 302 · `navigate(path,.Hard)`/`.Soft` honored · `_scrml_navigate_soft` present in emitted client runtime. Run `bun conformance/run.ts`, oracle only-UP.
- **Browser test** (if happy-dom supports it): a `<program>…<outlet/></program>` + a soft `navigate()` swaps the outlet + the swapped region is reactive (rehydrated). If happy-dom can't drive `startViewTransition`/`fetch`, gate that assertion + note it (CI-authoritative).
- R26: compile a real 2-page `.scrml` app, confirm the emitted client runtime has `_scrml_navigate_soft` + `_scrml_rehydrate_region` and a client `navigate()` lowers to the soft call.

## Rules
- V5-strict, `not` (never null/undefined), match surrounding style. Commit incrementally. No `--no-verify`.
- SURFACE (don't guess) any language-facing decision: the exact soft/hard inference boundary, the rehydrate-scope teardown semantics, or the fragment-response shape.

## Report back (self-contained)
- branch + SHA(s); files touched; what you built vs deferred (prefetch-reuse, fragment-response mode).
- test results + new conformance cases + oracle delta; browser-test outcome (or why gated).
- the R26 snippet (client navigate→soft + the runtime fns present).
- any design question + how you stubbed it.
