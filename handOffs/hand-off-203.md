# scrmlTS — Session 198 (WRAPPED + PUSHED; E-leg designed-not-built + vPA workflow open)

**Date:** 2026-06-16 (opened 2026-06-15).
**Previous:** `handOffs/hand-off-202.md` (S197 CLOSE).
**Next-session pickup:** rotate THIS file → `handOffs/hand-off-203.md` at next OPEN.
**Profile:** A — FULL. **A long, deep session: trucking corpus dog-food (1a+1b) + a full engine-hydration design-arc (DD→debate→F-primitive shipped) + a workflow/meta conversation that opened the vPA idea.**

## ⏭️ NEXT SESSION — START HERE (two resumable threads, user-ratified order)
**1. BUILD THE E-LEG (re-dispatch — it crashed environmentally x2, NOT a design/brief problem).** FULLY DESIGNED + RATIFIED; brief archived at `docs/changes/engine-server-source-hydration-eleg-2026-06-16/BRIEF.md`. Re-dispatch `scrml-js-codegen-engineer` isolation:worktree off that brief in a STABLE env (the S198 env degraded — 2 stream-watchdog stalls, both pre-edit, nothing lost). It's a clean pickup. The design (do NOT re-litigate):
   - **`<engine for=T server=@source>`** — the server-authoritative engine (the "E-leg"). Surface RATIFIED (`server=@source` value-bearing attr — the §52 *authority* sense of `server`, NOT the deprecated function-*placement* sense; parallel to §52 Tier-2 `<var server>`).
   - **Model RATIFIED:** the engine HYDRATES (guard-free, via the F-primitive's `_scrml_engine_hydrate_init`) from a server-owned SOURCE cell, reactively, whenever the source resolves/changes; CLIENT writes remain GUARDED transitions (`_scrml_engine_direct_set`). The source-subscription is the ONLY guard-free path. The engine does NOT self-load — it rides an existing server source's §52 load (which already does fetch-on-mount + SSR pre-render).
   - **Two reuse-seams** (PA-located, in the brief): derived-engine source-subscription (`emit-engine.ts`, gated on `derivedExpr`+read-only — must be lifted to a WRITABLE path; the Phase-0 STOP) + `_scrml_engine_hydrate_init` (reused reactively).
   - **§38 server-push composes for free** (a pushed source-cell change fires the same hydrate). **DEFERRED:** the MMORPG world engine + G1 (§52 write-back/persist) + the bare `<engine server>` auto-self-load form (resolved as wrong).
   - Design-insight recorded (`~/.claude/design-insights.md` engine-hydration verdict + this E-leg extension). DD: `scrml-support/docs/deep-dives/engine-hydration-from-persisted-state-2026-06-15.md`.
   - **Once E-leg lands:** the HOS `<engine>` showcase becomes buildable (a follow-on trucking corpus rewrite — the "engines everywhere" goal; HOS currently has the dead engine REMOVED + a match-based validator from 1b).

**2. RESUME THE vPA WORKFLOW DESIGN (the user's marketable meta-idea; "hash it out").** A maturation/baton-pass PA-continuity system to kill the ~280k cold-start tax. See the dedicated section below — capture is there. User wants to: lock in the session's workflow lessons (DONE this wrap — user-voice + pa.md), hash out his OTHER workflow ideas (NOT yet shared — ask), and start the immediately-incorporable part (the PA↔vPA messaging protocol). **OPEN Q for the user:** where does the scrmlTS-side scaffold live — `scrml-support` (near the PA directives) or seeded in the NEW PRIVATE repo (the bulk of the system = his marketable IP, kept private)?

## What landed + PUSHED this session (origin `f3319c57`, coherence 0/0)
- **`d18ac83a` slice 1a — LoadStatus enum-wiring** (corpus): ~126 status if-chains → exhaustive `match`, dup transition tables collapsed, stored repr → variant names, new `InvoiceStatus` enum. Ratified surface: store-variant-name / match-directly / no-mapper.
- **`7532bd8f` engine-hydration F-primitive — `initial=@cell` (A-leg)**: construction-snapshot hydration through the guard-free hook; decoder-boundary graft (`E-ENGINE-INITIAL-INVALID-VARIANT` runtime + 3 §34 codes); SPEC §51.0.E. RATIFIED via DD → authentic F-vs-B debate (F 48.5 vs 41.0).
- **`57d799f6` slice 1b — DriverStatus enum-wiring**: driver-card→`match`; HOS transition validation → shared `isValidHosTransition`/`driverNextStates`; current_status seed/writes/payloads → variant names; **dead HOS engine REMOVED** (showcase deferred to E-leg).
- **`73d937a2` chore**: 2 gaps + state regen + hand-off. **`f3319c57` fix**: within-node allowlist re-baseline for driver-card (the 1b push-gate fail — my brief omitted the re-baseline step; now baked into the brief template).
- **scrml-support `624322d`**: user-voice S198 + the engine-hydration DD. (THIS wrap adds another scrml-support commit — user-voice S198 continuation.)

## vPA workflow — the idea (CAPTURE for resume)
**Problem:** ~50% of a 1M session is fixed overhead (session-start ~280k + wrap ~60-80k + occasional push-fixes ~50k), paid COLD + SERIALLY every session. Plus the debate-agent-loading tax (real agents > synthesis, but loading costs the wrap/start tax per debate — hit THIS session: the F-vs-B experts weren't loaded → staging + a PA-composed interim + lucky mid-session pickup + re-run).
**Idea:** a **maturation/baton-pass** system, 2 Claude instances, coordinated via the existing file-messaging dropbox (`handOffs/incoming/`). A **vPA (vice-PA)** matures alongside the live PA — warms ONCE, in PARALLEL, OVERLAPPED with productive work (monitoring the PA's dispatched agents, holding the loaded debate panel) — so the baton-pass is cheap (successor already warm). Not kill/resurrect; a rolling baton (vPA→PA→re-warm-as-next-vPA).
**The three hard parts (PA analysis):**
  1. **CRUX — delta-absorption must be CHEAP** or the vPA pays the tax too: warm once fully, then absorb the PA's DELTAS (commit msgs + a running "what-I-just-did" delta-log in the message stream), NOT re-read docs. The maturation = the amortization. Designing that delta-log is the heart.
  2. **Two instances = files + a TRIGGER, not live-IPC.** No ambient watching; a message is acted on only when that instance is PROMPTED (user, `/loop`/`schedule` poller, or a task-notification). The trigger is first-class.
  3. **Single-writer land authority.** Only the LIVE PA holds commit/land authority; the vPA is read-mostly + sandboxes (debates, agent-result digestion) until the pass. The pass IS the authority transfer.
**Agent-ownership-transfer mechanism (PA answer):** the task-notification goes to the dispatcher (PA), so the vPA can't inherit THAT — but the agent writes progress+commits to a shared worktree/`progress.md`; the vPA "owns" it by reading THOSE (filesystem-shared) + doing the file-delta landing from its own instance. Offloads the heavy result-digestion context from PA to vPA.
**Startable-now piece:** extend `handOffs/` with a PA↔vPA message vocab (state-delta · agent-ownership-transfer · debate-request/result · baton-pass) + the cheap delta-log convention. A design doc + light scaffold, NOT a build. **Public/private split:** the generalized productized system = private/marketable IP; the scrmlTS-side adaptation = the startable concrete piece (location TBD — the open Q above).

## Workflow lessons LOCKED IN this wrap (user-voice + pa.md updated)
- **Context-economics / use warm context fully.** Warm context is a depreciating asset; ~50% fixed overhead means a warm session should be USED to value-exhaustion, not wrapped early. Estimate work in WARM-MARGINAL terms (1B cost ~20k warm vs ~280k+ cold), not cold-session terms. The S198 "lean wrap at 35% remaining" was the premature-wrap reflex recurring (`feedback_dont_wrap_at_43_percent`) — obeyed the letter ("your call") missed the spirit.
- **Wrap-calibration:** wrap when genuinely near the floor (~15-20%) OR warm threads are spent / next-work is cold-and-unrelated. NOT "we did a chunk / we're deep in."
- **PA-is-partner, not list-executor.** The dispatch→land→dispatch rhythm + treating the trucking slices as a list = agent-orchestration drift. The engine-hydration arc was the partner exception. Pull on the language-direction threads (what the dog-food/gaps/findings TELL us) WITH the user — don't file-and-move.
- **Brief-template fix (BAKED IN):** corpus-rewrite / codegen briefs that touch within-node-corpus fixtures MUST include the within-node allowlist re-baseline + a FULL `bun run test` (not just the pre-commit subset) before DONE. (The 1b push-gate fail; now in the E-leg brief.)

## State as of close
- **Board:** HIGH 2 · MED 10 · LOW 20 · Nominal 8. Tests: pre-commit subset 17,110 / 0 fail; full suite 24,354 / 0 (F-primitive). Version v0.7.0.
- **Sync:** scrmlTS 0/0 (pushed); scrml-support pushed this wrap. Worktrees: ONLY main (5 cleaned this wrap — 1a/F/1b landed + 2 dead E-leg).
- **MAPS REFRESH DEFERRED (the one full-wrap step skipped):** the F-primitive touched `compiler/src` (emit-engine/symbol-table/runtime-template) → maps watermark `471cbb34` is stale. Refresh DEFERRED because the env is degraded (2 dispatch crashes) — avoided another project-mapper dispatch into it. **OWED next session** (incremental on the F-primitive + E-leg files).
- Gaps filed S198: `g-match-alternation-value-vs-derived` (MED), `g-engine-server-flag-silent-swallow` (MED — superseded by the E-leg for `server=@source`).
- Experts staged (`~/.claude/agents/`): `xstate-expert` (forged) + `elm-architecture-expert` — dispatchable for future debates.

## Corpus-rewrite arc — remaining (carried)
Trucking slices 2-5 (decl-coupled validators · `<each>` sweep · errors-as-states · typed props) + the HOS engine showcase (now E-leg-gated) + wave-3 deferred `32-markup-as-value` (HIGH `g-markup-value-ternary-fnreturn-codegen` blocked) + gauntlet measurement + the gap-184/§11.1 currency-bug.

## pa.md directives in force
R1–R5 · `---` delimiter · Profile A · S88 isolation-explicit · S99/S126 path-discipline · S112 merge-main · S136 BRIEF.md archival · S138 R26 dual-verify · S147 coherence · S180 waiting-time · **S198 wrap-calibration + context-economics + partner-not-list + the within-node-allowlist brief-template fix (NEW this wrap)** · wrap 8-step.

## Tags
#session-198 #wrapped #pushed #e-leg-designed-not-built #vpa-workflow-open #engine-hydration-F-shipped #trucking-1a-1b-landed #context-economics-locked-in
