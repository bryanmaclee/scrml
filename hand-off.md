# scrmlTS — Session 195 (CLOSE)

**Date:** 2026-06-15.
**Previous:** `handOffs/hand-off-199.md` (S194 CLOSE, rotated at this session's OPEN).
**Next-session pickup:** rotate THIS file → `handOffs/hand-off-200.md` at next OPEN.
**Profile:** A — FULL (`/effort` ultracode mid-session).

## What this session was
The **corpus-rewrite arc** (the S193-queued audit: the corpus "teaches the spelling of scrml and the grammar of React"). Drove **wave 1 end-to-end** (the 4 Tier-1 flagships + a gating compiler fix), then a user-raised pivot to a **holistic error-handling deep-dive → adversarial debate → a new-primitive ratification**. Both landed: wave 1 is complete + pushed; the **render-expression primitive (a/c) is RATIFIED** (build queued). Wave 2 grounded. Every arc PA-independent-R26-verified + S99-leak-checked + S147-coherence-verified.

## Session-close state
- **HEAD `ee57af89`** (09 → pure errors-as-states). **5 commits this session, all PUSHED** (coherence 0/0): `f563bc89` GAP-A · `1870b404` 04/05/16 + SCOPE/BRIEFs + PRIMER currency · `99ec1d66` board (3 wave-1 gaps) · `86cb8d67` within-node rebump · `ee57af89` 09. scrml-support pushed: `f708747` (deep-dive + debate docs); the S195 user-voice append is committed+pushed at wrap.
- **Board (live `bun scripts/state.ts`):** **HIGH 2 · MED 10 · LOW 19 · Nominal 9.**
- **Tests:** pre-commit subset **17,051 / 90 skip / 0 fail**; full suite green via the per-landing + wrap-push gates (24,284 at the wave-1 pushes; TodoMVC PASS).
- **Version:** v0.7.0, no cut. **Inbox:** empty. **Worktrees:** none (6 wave-1 worktrees 6b-cleaned). **Maps:** 6c refresh ran at wrap (`project-mapper` incremental; watermark `a78272e5` → [see primary.map.md line 3]).
- **design-insight** RATIFIED (render-expression a/c) appended to `~/.claude/design-insights.md` (per-machine, not pushed).

## Corpus wave 1 — COMPLETE (04/05/16/09 + GAP-A), all R26-verified + pushed
- **GAP-A `f563bc89`** — §24 void elements self-terminate in `<match>`/`<each>` arm bodies (block-splitter `findStructuralBodyEnd` + `match-statechild-parser findArmCloser` + a latent flush-closer fix; +13 tests). A/B-verified (fails pre-fix E-CTX-001, compiles post-fix). Gated the 09 form. Benefits `<each>` too.
- **04-live-search / 05-multi-step-form / 16-remote-data `1870b404`** — derived `const <filtered>`+`<each>`/`<empty>` · `<engine for=Step>`+decl-coupled-validators (corpus's FIRST `<errors of=>`) · Tier-1 `<match for=ContactsPhase>`+`<each>`+live-`.Failed`.
- **09-error-handling `ee57af89`** — pure errors-as-states (option b ruling): Phase enum holds `.Failed(err)`; `!{}` routes via the canonical **catch-all** `| err :> { @phase = .Failed(err); return }` (PA simplified the agent's 8 verbose per-variant arms); `<match for=Phase>` displays via a string-returning `errorMessage(err)`. NO errorBoundary/shim/renders-clauses (those are the separate §19.6 idiom).
- Each rewrite needed a **within-node parity allowlist rebump** (the per-wave tax — native parser is feature-stale on the new idioms; PARSE-FAILURE 0 = not-a-regression). README rows re-aimed + PRIMER §6.3 `promote --each`-shipped currency fix (`1870b404`).

## THE NEXT-SESSION PICKUP — the queued build arc (priority order)
**1. Build the render-expression primitive (RATIFIED a/c) — the headline.** Authority: the RATIFIED design-insight (`~/.claude/design-insights.md`, top entry) + `scrml-support/docs/deep-dives/error-handling-holistic-2026-06-15.md` + `…/docs/debates/error-handling-display-gap-2026-06-15.md`. Sequence:
   - **(a) Fix the prereq bugs FIRST** (they gate the build): **`g-failable-arm-nested-constructor-crash` (HIGH)** — `@phase = .Failed(LoadError::NotFound(id))` in an `!{}` arm → runtime crash; site `emit-logic.ts ~520-565`. + `g-match-arm-apostrophe-bs` (MED, block-splitter). + the Seam-1 steer-to-block-form diagnostic (**H1**, replaces the wrong-altitude "compiler defect" message).
   - **(b) Build the primitive:** PARSER one markup-context form — keyword **NOT `show`** (taken by §17.2 visibility-toggle) → `render` or a postfix (spec-time decision). TYPER exhaustiveness-fence: well-formed ONLY if the value's enum declares `renders` for every reachable variant — **reuse §19.6.6/E-ERROR-005** (`type-system.ts:9206-9226`); missing → compile error (contract-firing, never view-generating). CODEGEN: reuse `allVariantRenderExprs` (`emit-html.ts:637-647`) + `emitBoundaryMarkupExpr` (`emit-error-boundary.ts:132` — dataExpr is ALREADY a parameter), passing the held value's `.data`; **sidestep the `__scrml_error` gate** (`emit-event-wiring.ts:1084`) — do NOT widen value-match to emit markup. SPEC: amend §19.2 (renders fireable via the render-expr from held state) + a new §-entry + a §34 code if needed.
   - **(c) Pair: H2** — wire §4.18.4 shorthand `${}` interp in the match-arm `:`-shorthand codegen (`g-shorthand-interp-match-arm-codegen`, silent-wrong-output). Keep the value-match string-helper FULLY VALID (do NOT deprecate the Elm `errorMessage` shape).
**2. RemoteData (H3) — scope first (the no-generics tension).** The deep-dive calls it "build §13.5 `RemoteData` (Loading/Loaded(T)/Failed(Error), Nominal-7)" — BUT scrml has NO generics, so a generic `RemoteData<T>` can't exist; the audit + the 16-rewrite use a PER-SCREEN enum. Real design Q (built-in generic-like primitive vs per-screen-enum-is-the-idiom). Composes with the render-expr (`Failed(Error)` is a held error variant). Scope it (quick deep-dive/AskUserQuestion) before building.
**3. Corpus wave 2 (03/06/08/25) — grounded, dispatch-ready, NO gating fix.** Full grounding in `/tmp/.../winb2qs4o.output` (capture into a SCOPE doc at dispatch). **03/08** = clean 04-clones (typed struct + `<each>`/`<empty>`; 03 also fix the stale README `protect=` claim). **06** = **NO engine** (per-card status is multi-instance → derived-grouping columns + `<each>` + per-direction id-only handlers; the pre-S194 "Status as an `<engine>`" audit row SUPERSEDED; lead the brief with this) + the `g-each-body-bare-variant-arg` HIGH-non-blocking gap (use the per-direction-handler workaround, or fix emit-each.ts first). **25** = the §51.0.S.6 worked example (board-level singleton `<engine for=DragPhase accepts=DragMsg>` OWNS transitions via `.advance(.Msg)`; §51.0.S is FULLY IMPLEMENTED — buildable today). Per-wave within-node rebump. **Independent of the render-expr build — can run in parallel.** (Then Tier-3: 23-trucking wholesale; + the audit's NEW gap-filling examples G1–G6.)

## The error-handling ruling (durable — the headline ratification)
**Held-error-display gap → render-expression primitive RATIFIED (a/c), S195.** A variant's `renders` clause fires only via `<errorBoundary>` catching a LIVE `!`-call — never for a HELD `.Failed(err)`. Fix = a NEW narrow render-expression ("fire this value's `renders` contract here"), exhaustiveness-fenced; does NOT widen `<errorBoundary>` (its essence is catch, §19.6.1) nor generalize `renders` to all enums (option d, rejected). Judge: a/c 69 vs (e) 56 vs (b) 48. The §19 VALUE model (fail/!/?/!{}/errors-as-states/atomic-rollback/§19.12 test surface) is SOUND — this is sharpening, not replacing.

## Gaps filed this session (8 new)
HIGH: `g-failable-arm-nested-constructor-crash`, `g-each-body-bare-variant-arg`. MED: `g-held-error-display` (RATIFIED-fix-pending), `g-shorthand-interp-match-arm-codegen`, `g-match-arm-apostrophe-bs`, `g-engine-autodecl-bare-variant-write`. LOW: `g-blocksplitter-comment-span-not-opaque`, `g-each-body-sigil-invariant-classifier`. (All §S195 in `docs/known-gaps.md`.)

## Open questions to surface immediately (next session)
- The render-expr **keyword** — `render`, a postfix, or another non-`show` choice? (spec-time, before the build.)
- **Sequence:** fix prereq bugs → build the primitive (recommended), and **run wave 2 in parallel** (independent)? Or sequence wave 2 after?
- **RemoteData**: scope the no-generics tension before building (per-screen-enum vs a built-in).

## pa.md directives in force
R1–R5 · `---` delimiter · Profile A · wrap 8-step EXECUTED (6b worktree-clean ×6 · 6c maps-refresh · 6d state-regen+check PASS) · S88/F4/S90/S99/S126 dispatch discipline (held — S100 hook fired correctly on the 09-b agent, no leak) · S136 BRIEF.md archival (all dispatches) · S138 R26 dual-verify (caught: the audit's 3 count errors, the 09 8-arm handler verbosity, the catch-all simplification) · S147 coherence (caught the S159 CWD-drift false-leak; lesson: coherence via `git -C <main>`) · S159 CWD-drift (fired) · S164 bg-commit-race · S180 waiting-time (worktree cleanup + audit currency note banked during waits) · S167 workflow-interp-collision (grep-clean on all 4 workflows) · ultracode (Workflow on every substantive task: grounding ×2, deep-dive, debate).

## Tags
#session-195 #corpus-wave1-complete #gap-a-void-scanner #errors-as-states-09 #render-expression-ratified #error-handling-deep-dive #error-handling-debate #wave2-grounded #render-expr-build-queued #remotedata-no-generics-tension #profile-a #ultracode
