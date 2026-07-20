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

### Next (pending PA/human ruling on the fork)
- Do NOT build the redesign or land a SPEC amendment claiming Wave-1c implemented (would be a false
  spec-ahead claim, Rule 4 / verify-before-claim).
- One more probe pending: single-file `<program>` SPA + artifact-splitter — does the per-route
  splitter emit outlet-bearing per-route CLIENT chunks (a narrower, in-scope cross-chunk scenario)?
