# scrmlTS — Session 179 (CLOSE)

**Date:** 2026-06-10
**Previous:** `handOffs/hand-off-183.md` (= S178 CLOSE).
**Next-session pickup:** rotate THIS file → `handOffs/hand-off-184.md` at next OPEN.
**Profile:** opened **A (FULL)** ("read pa.md and start session"; default A). `/effort` = **ultracode**.
**Wrap:** "wrap and push" (user-authorized) → 8-step wrap + **PUSHED** (scrmlTS 7 commits + scrml-support user-voice).

## 🟢 S179 CLOSE — staleness check → 2 spec-vs-impl divergences ENFORCED + dog-fooding loop ratified

A long Profile-A (ultracode) session. The throughline: a **6-agent adversarial staleness check** over the carry-forward thread menu reshaped or killed every thread it touched, surfacing TWO spec-vs-impl divergences (SPEC `SHALL`-errors the compiler silently skipped) — both now enforced. Plus a NEW standing directive: use agent-wait time for maintenance + dog-fooding.

### State as of close
- **HEAD:** `d70f6bd8`. **origin/main:** == HEAD after the wrap push (7 S179 commits PUSHED). scrml-support: user-voice `e754ddd` PUSHED.
- **Tests:** full suite **23,779 / 0 fail / 221 skip / 1 todo** (967 files). S178 close 23,757; +22 (E-ROUTE +15, E-FN +7).
- **known-gaps:** **HIGH 0 · MED 6 · LOW 12 · Nominal 9** (derive live via `bun scripts/state.ts`). RESOLVED this session: `g-route-arg-fn` (LOW), `g-fn-sql-unenforced` (MED, filed+resolved same session). FILED-still-open: `g-display-text-overquote` (LOW).
- **Version:** v0.7.0, no cut. **stdlib:** 18 modules.
- **Worktrees:** **main only** (both S179 agent worktrees cleaned 6b after their landings).
- **Maps:** 6c **PARTIAL** — project-mapper CRASHED mid-run (S163 class, stall watchdog). `error.map.md` refreshed (folded the new S179 codes: E-ROUTE-004 + E-ROUTE-003-now-enforced + I-FN-PROMOTABLE skip + E-FN-001 kind-agnostic) + `primary.map.md` watermark bumped to `d70f6bd8` MANUALLY. Structural/dep/test maps content-deferred — S179 was additive-only (new validators in existing files, 2 new test files; no new passes/source files), so content is largely current. **Full project-mapper refresh = a next-session early task** (cross-ref the NEXT-SESSION #1 below).
- **Inbox:** empty. **Hooks:** configuration B (correct).

### The 7 S179 commits (all PUSHED)
1. `6e6cf9c5` **#4 stdlib clock de-leak** — 13 raw `Date.now()` → `clockNow()` (`scrml:time` now()) across auth/oauth/store shims; completes the S177-deferred clock half of the stdlib-ouroboros. Runtime canary on the client-inlined auth IIFE. Coupled clientinline §3 test flip (the S177 "stays raw" decision).
2. `67789409` **#3 server-keyword DOC-TEACH** — PRIMER §6 + kickstarter §3.3 reframed to TWO canonical forms (`function`/`fn`), server placement INFERRED; `server fn` is the load-bearing exception (resolves "retire server?" — it can't). Gap corrected; kickstarter stale W-PURE-REDUNDANT→W-PURE-DEPRECATED.
3. `c6db6680` **bookkeeping** — changelog S179 block + bug-14 re-scope (V0.E shipped S131) + recent-sessions regen + E-ROUTE BRIEF archive.
4. `81c84282` **E-ROUTE wire-serializability gate** — `E-ROUTE-003` (return) was SPEC-only / emitted nowhere (a spec-vs-impl divergence found by the survey); now ENFORCED + NEW `E-ROUTE-004` (param). `isWireSerializable`+`checkRouteWireSerializability` in the type pass. PA-independent repro fired both codes. PA review caught+fixed the agent's S180→S179 mislabel. Closes `g-route-arg-fn`.
5. `9b45209f` **file `g-fn-sql-unenforced` + E-FN BRIEF**.
6. `2f0599cd` **file `g-display-text-overquote`** (the §4.18 over-quote footgun, dog-fooding find).
7. `d70f6bd8` **E-FN-001 enforcement + I-FN-PROMOTABLE inferred-server skip** — `fn`+`?{}` compiled clean despite §48.3.1; agent corrected the mechanism (`return ?{}`→`sqlNode` evaded the let/const-only check). Fix A (kind-agnostic sqlNode) + Fix B (lint skips inferred-server via routeMap). **Landed via 3-way MERGE** (agent's stale session-start base predated E-ROUTE on the same 3 files; `git apply --3way` preserved E-ROUTE + added E-FN; PA-independent repros on the merged source). Closes `g-fn-sql-unenforced`.

### Process notes (durable)
- **Dog-fooding works as a bug-finder.** Writing+compiling small idiomatic scrml (`triage.scrml`, `order.scrml`) surfaced `g-fn-sql-unenforced` (E-FN-001) + `g-display-text-overquote` (§4.18) + 2 PA-idiomatic-mistakes (friction signal). Banked: `feedback_waiting_time_work_pattern`.
- **Verify-before-claim caught me twice more:** I almost claimed "I-FN-PROMOTABLE false-fires because fn can't do SQL" — tested → fn+SQL compiled clean → the deeper E-FN-001 divergence. And the agent corrected my RI-escalation mechanism hypothesis. Empirical-test-before-claim earned its keep.
- **3-way merge for stale-base landings.** Both agents' worktrees branched from the S178 session-start base (S112 stale-base class); E-FN's base predated the E-ROUTE landing on 3 shared files → `git apply --3way` (NOT wholesale file-delta, which would clobber). `feedback_file_delta_vs_cherry_pick` + `feedback_pa_file_delta_base_check`.
- **Two spec-vs-impl `SHALL`-divergences in one session** (E-ROUTE-003, E-FN-001) — a real class worth watching (SPEC mandates an error the compiler silently skips). Candidate: audit other `SHALL`-be-error codes for emission.

## 🔴 NEXT-SESSION #1 (user-ratified S179)
**`g-server-keyword-drift` FULL CORPUS MIGRATION.** User interjected watching the E-FN agent reach for `server`: *"i was watching the agent and caught his talking about the 'server' kw. I cant wait till [I] can stop seeing that."* → ratified the full scrub as next session's TOP arc. Shape (scoped in the gap):
- A safety-aware `migrate --fix` **Migration 4**: `server function`→`function` ONLY where it auto-escalates; **PRESERVE `server fn`** (load-bearing — a pure fn has no escalation trigger). The S93 lift-`?{}` breakage class means per-site compile-verify, not `sed`.
- Settle the **SSE `server function*`** ruling (29 SPEC hits — redundant there, or kept?).
- Run across SPEC (230) / kickstarter (33) / PRIMER (11) / 19 `.scrml` examples; dispatch-shaped (compiler `migrate.js` + corpus). Doc-teach already done `67789409`.

## 🟡 CARRY-FORWARD QUEUE (current-truth)
- **MED tail (6):** `r28-c2` (kickstarter `< db>` + print()) · `a5` (refinement frozen(deep) — deferred-with-adoption-watch) · `bug-1` (Tailwind preflight infra) · `bug-12-vkill` (read-side E-STATE-UNDECLARED, engine-var-canon-gated) · `bug-14` (3 V0.D runtime items; V0.E shipped) · `bug-17-l19` (L19 relaxation — design-Q).
- **LOW tail:** `g-display-text-overquote` (NEW — candidate `W-DISPLAY-TEXT-OVERQUOTE`) · `g-component-001-coverage` · `g-sql-row-protect-leak` · `r28-2b` (`:let` tokenizer) · `s169-ordered-unordered-build` · `bug-75` (KEEP-OPEN) · `bug-18`/`-19-cite`/`-20`/`-21`/`-22`.
- **Native-parser swap** — cutover deferred (user-gated, ~v0.8); swap-grind in-flight (~508 flip-failures, needs FRESH re-triage vs the live baseline — dominant buckets MISSING-FIELD ~296 + engine-statechild ~116, NOT the stale S166 family list).
- **E-FN deferred:** none (the agent's fix was complete; SSE-yield E-ROUTE check `.skip` deferred in E-ROUTE).
- **Audit candidate (new):** other SPEC `SHALL`-be-error codes — are they emitted? (E-ROUTE-003 + E-FN-001 were both SPEC-only this session.)

## pa.md directives in force
- Rules R1–R5. `---` answer-delimiter. Profile A/B. `full wrap`/88% floor. wrap = 8 steps (6b/6c/6d).
- Dispatch: S88 isolation:worktree explicit · F4 startup-verify · S90 CWD-routing · S99/S126 Bash-edit + no-`cd` · S136 BRIEF.md archival · S138 R26/PA-independent-verify · S147 branch-leak coherence · S164 bg-commit-race · **S112 stale-base → 3-way merge when main moved on a shared file** (fired ×2 this session).
- Memory (NEW S179): `feedback_waiting_time_work_pattern` (agent-wait → maintenance then dog-food). Load-bearing recent: `feedback_verify_before_claim` · `feedback_file_delta_vs_cherry_pick` · `feedback_dont_soft_classify_bugs` · `feedback_sweep_all_mentions_newest_first`.

## Tags
#session-179 #profile-a-full-start #ultracode #staleness-check #2-spec-impl-divergences-enforced #dog-fooding-ratified #next-server-keyword-migration #wrapped-pushed
