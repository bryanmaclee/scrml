# RULING — `<outlet>` is the canonical route-swap slot (navigate Wave-1c, #27)

> **⚠️ REFINED S276 (2026-07-20) — read this first.** The implementation of item 3 OVERREACHED this
> ruling. What was approved (verbatim, S275) was: *"composition still keys on the marker (so
> `<main><outlet/></main>` nesting resolves to the inner marker, not a broken outer-`<main>` grab). A
> shell with both a **bare** `<main>` and an `<outlet>` → error."* The word **"bare"** is load-bearing:
> a `<main>` WRAPPING the outlet was approved as LEGAL. The shipped impl dropped it, errored on ANY
> `<main>`+`<outlet>` co-occurrence, carried that into the SPEC text, and locked it in with a test.
>
> A latent gap this ruling never resolved also surfaced: once `<outlet>` emits as
> `<main data-scrml-outlet>`, `<main><outlet/></main>` yields NESTED `<main>` regardless of which one
> composition targets — "inner marker" fixes slot SELECTION, not landmark DUPLICATION.
>
> **bryan RULED the resolving invariant (S276): exactly ONE `<main>` landmark per composed document;
> the MARKER decides the slot, never the tag.** (1) `<outlet>` with nothing else claiming the landmark
> → `<main data-scrml-outlet>`; (2) `<outlet>` inside an author `<main>` → `<div data-scrml-outlet>`,
> author's `<main>` is the landmark; (3) a route body carrying its own `<main>` demotes the slot to a
> div; (4) `E-OUTLET-AND-MAIN` fires ONLY on a bare/sibling `<main>` + `<outlet>`. Implemented by
> `docs/changes/navigate-wave1c-piece1-landmark/` (PR-1). Items 1-2 below stand as written; item 3 is
> superseded by case (4). Pieces 2+3 of the build are HELD — see `docs/known-gaps.md`
> `[[g-nav-chunk-lexical-collision]]`, `[[g-nav-chunk-loading-flag-race]]`,
> `[[g-nav-chunk-basename-collision-key]]`.

**Ruled by bryan, S275 (2026-07-20).** Reconciles the two disconnected shell-composition models the Wave-1c survey found: the May-2026 `<main>`-slot textual composition (`index.ts:1746`) vs the July-2026 `<outlet>` soft-nav model (§20.8). Granted a V1 feature-build exception on native-leg grounds (§20.8 = "the fourth native leg"; mirrors the CSS Wave-1 exception).

## The decision — Option A (explicit `<outlet>` slot; back-compat `<main>` static)

1. **`<outlet>` is the canonical, explicit soft-nav route slot.** The multi-file `pages/` composition (index.ts:1746) becomes **marker-driven**: the slot is the first element carrying **`[data-scrml-outlet]`**; if none, fall back to the first `<main>` (the current static behavior — **back-compat, hard-nav across pages**, with the existing `W-OUTLET-ABSENT-SOFT-NAV-DISABLED` lint nudging "add `<outlet>` for soft-nav"). Composing into a marked slot preserves its wrapper element and fills its children with the route body — so the composed page carries `[data-scrml-outlet]`, which the runtime soft-nav swap addresses.
   - REJECTED — Option B (retrofit: a shell's first `<main>` becomes the outlet automatically): a silent behavior change + conflates page-main-content with route-slot. scrml prefers an explicit compiler-recognized primitive over implicit magic.

2. **`<outlet>` emits as `<main data-scrml-outlet tabindex="-1">`** (was `<div>`, emit-html.ts:1594). The route content IS the page's main region (HTML-semantic + AT-correct). Composition still keys on the MARKER, not the tag — so `<main><outlet/></main>` resolves to the inner marker (not a broken outer-`<main>` grab), and a bare `<outlet/>` at shell top works directly.

3. **A shell with BOTH a bare `<main>` and an `<outlet>` is an error** (two `<main>`s = invalid HTML). New code (§20.8.7 family; suggested `E-OUTLET-AND-MAIN` or fold into `E-OUTLET-DUPLICATE`'s intent). Author picks: use `<outlet>` (the route slot) OR a bare `<main>` (static content region), not both.

## Scope
- SPEC-permitted, low-migration: **zero source `.scrml` uses `<outlet>` today**; only ~2 real `<main>`-shell MPAs in the corpus (`examples/23-trucking-dispatch/`, `docs/website/app.scrml`) — they keep working (static/hard-nav) untouched, and migrate one line (`<main>`→`<outlet>`) to opt into soft-nav.
- Single-file SPAs (`<program>` + `<page>` children + `<outlet>`, one chunk) already soft-nav; this ruling is about the multi-file `pages/` composition path.

## The build this unblocks (3 pieces)
1. **Marker-driven composition + `<outlet>`→`<main data-scrml-outlet>`** (codegen: index.ts:1746 + emit-html.ts:1594) + the both-slots error. [Independently landable — closes the §20.8-vs-composition coherence gap; real-MPA `<outlet>` composition works even before cross-chunk soft-nav.]
2. **Boot-restructure** (codegen: emit-event-wiring.ts:641-2041): the rehydrator registration is inside the `DOMContentLoaded` closure, so a chunk injected post-boot registers nothing. Add a `readyState` guard + skip re-registering delegated document listeners / shell re-boot for an injected chunk.
3. **Runtime chunk-load** (runtime-template.js): at the now-reachable cross-chunk case, load the target's missing `.client.js` (from the fetched doc's script order), await, then swap+rehydrate; hard-nav fallback (`W-NAV-CHUNK-LOAD-FAILED`) on load-fail/timeout, preserving token/abort/View-Transition/popstate.

## SPEC (land WITH impl, Rule 4)
- §20.8.1 — `<outlet>` is the canonical marker-driven composition slot; bare-`<main>` static fallback; both-slots error.
- §20.8.2 — the cross-chunk load step + hard-nav-on-load-failure.
- §40.8 — the composition mechanism is currently unspecified; add the normative marker-driven-slot statement (this ruling makes it spec'd, not just impl convention).
- §20.8.6/.7 — normative statements + NAME `W-NAV-CHUNK-LOAD-FAILED` (Info) + the both-slots error; §34 rows land with impl. Flip the §20.8 Nominal banner to Waves 1a/1b + link-boost + 1c IMPLEMENTED (keep-alive §20.8.4 + nested outlets stay Nominal/v1.next).
