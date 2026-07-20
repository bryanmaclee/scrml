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
