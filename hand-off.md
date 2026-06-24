# scrml — Session 218 (OPEN)

**Date:** 2026-06-24. **Profile:** A — FULL. **Boot:** digest `current` (stamp 489951aa; sources unchanged @ HEAD ca12a295 → trusted digest for the volatile board; expert reads cold). Prior: `handOffs/hand-off-222.md` (S217 CLOSE).

> **Thinned (S205).** Board/counts → `bun scripts/state.ts` + `handOffs/digest.md`. Fine-grained stream → `handOffs/delta-log.md`. This carries the IRREDUCIBLE + open threads.

## Board @ open
**HIGH 0 · MED 13 · LOW 13 · Nom 8.** v0.7.0. Pre-commit subset 17701/0/68. scrml + scrml-support both 0/0 vs origin (clean). Maps 15 behind HEAD (deputy-maint tick-246 `352ab999` carries the refresh — UNMERGED, 1 ahead of main).

## Boot integration owed (S199/S205 boot step)
- **Merge `deputy-maint` (`352ab999`, tick 246 — maps/digest/deputy-state refresh) into main** at first commit point / before any push. Clean FF (1 ahead, disjoint surface). NOT yet merged — awaiting first-commit authorization.
- No deputy `(deputy) state` reboot-gap landings to re-attach (deputy did maintenance only).

## NEW inbox (arrived 2026-06-24 — both genuine compiler bugs w/ minimal repros; triage at S218 open)
1. **GITI-032 (HIGH) — `${ cond ? <markup> : "" }` ternary-as-value-returning-markup broken INSIDE a `<match>` arm body.** One block → `E-CODEGEN-INVALID-JS` (compile fails); several in one arm → exit-0 but arm render-fn returns static whitespace, payload param ignored, all conditional sections silently dropped (Bug-51 class). Works at TOP LEVEL. Blocks giti "Current status" panel. Repro: `giti/ui/repros/repro-31-ternary-markup-in-match-arm.scrml`. Likely render-adjacent to the just-closed GITI-029/030/031 cluster — triage FIRST. **Secondary design note:** match arm payload binds by DECLARED variant param name (`render_X(_data && _data["<paramname>"])`), not positionally — giti suggests considering positional binding (DD-candidate, park).
2. **6nz Bug AI (cosmetic for 6nz, but bites idiomatic adopters) — `<each>`/`<empty>` fallback not torn down on empty→non-empty transition.** First real item appended NEXT TO leftover fallback. Reverse (non-empty→empty via `@items=[]`) is correct. 13-line general repro. Distinct from R28-1c same-key field-mutation bug (uses `[...@items, x]` array-ref replacement). 6nz hypothesis (UNVERIFIED): `emit-each.ts emitEachReconcileLines()` ~L1600-1622 non-empty branch falls through to `_scrml_reconcile_list` without clearing the leftover fallback; runtime `_scrml_reconcile_list` ~L1581 only `replaceChildren()` when `newItems.length===0`.

Both need R26-reverse empirical re-verification on real source @ current HEAD BEFORE classifying/dispatching (S138 doctrine). Both are render-layer — check `git log` for sibling fixes since the reported compiler SHAs (6nz: `2dd135ff`; giti: `7c01b22a`).

## ⏸️ Carried OPEN from S217 (priority order — see hand-off-222.md for full detail)
0. **Outbox replies OWED** (verify whether sent at S217 finalize): (a) giti GITI-029/030/031 RESOLVED + §4.17 `<code>`/`<pre>` adopter-note; (b) flogence g-onmount-async FIXED + each-stale NOT-REPRODUCED (need their live repro).
1. Ryan PR#1 round-2 + #2 — **LANDED + PUSHED** (`b2bf9959` / `d706f111`). NOTHING owed.
2. escalation-2 typer-scope follow-on — `g-sse-route-object-typer-scope` (MED, dispatchable).
3. dpa-003 `_{}` inline-codegen BUILD + §23.2.4 amendment.
4. Half-2 convergence — `<each>` bind: + `buildHandlerExpr` dedup (Family-A).
5. Multi-user PA MVP remaining refinements (user-voice-scrml→-bryan rename; methodology-memory-lift residual; pa-scrml→pa-base+overlay migration; `$SCRML_HOME` path-param). **User's step: add Ryan as scrml-support GitHub collaborator.**
6. Carried: g-enum-toenum-not-lowered-server-side (MED) · giti three-codegen library-mode cluster · pa-base v2 Part-C · A4/stdlib Phase-3 · S215 random-sample-10× audit of S217 landings (acceptance sampling — owed each wrap).

## Open questions to surface immediately
- Commit authorization for S218 (none given yet — needed before deputy-maint merge + any landing).
- GITI-032 is HIGH + blocks an adopter; 6nz Bug AI is broad-adopter-relevant. Both render-layer. Likely the S218 substantive work — confirm direction.

## pa.md directives in force
R1–R5 · `---` · Profile A · digest-first · S88/S99/S126 path-discipline · S136 BRIEF · S138 R26 (fwd+reverse) · S147 coherence · S199/S205 deputy + merge-before-push · S119 explicit-pathspec · S215 adversarial-verify + random-sample-10× · S217 per-user profile resolution · wrap 8-step.

## Tags
#session-218 #open #giti-032-conditional-markup-in-match-arm-HIGH #6nz-bug-AI-each-empty-fallback #deputy-maint-merge-owed #render-layer-cluster
