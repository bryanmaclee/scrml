# scrmlTS — Session 178 (CLOSE)

**Date:** 2026-06-10
**Previous:** `handOffs/hand-off-182.md` (= S177 CLOSE).
**Next-session pickup:** rotate THIS file → `handOffs/hand-off-183.md` at next OPEN.
**Profile:** opened **A (FULL)** ("read pa.md and start session"; default A). `/effort` not set.
**Wrap:** plain "wrap" → 8-step wrap executed (6b worktree-cleanup ×2 + 6c maps-refresh + 6d state-doc) — **NO push** (commit-only; push-pending surfaced for next session / user authorization).

## 🟢 S178 CLOSE — DD1 closed + a 2-fix codegen cascade + flip-grind re-orient (commit, push-pending)
- **HEAD:** the S178 wrap commit(s) on top of the substantive landing. **NOT pushed** (origin/main behind by the S178 commits — surface + push next session OR on `push`).
- **Tests:** full suite **23,757 / 0 fail / 220 skip / 1 todo** (965 files; S177 close 23,734; +23). `state.ts --check` PASS (6d).
- **known-gaps:** **HIGH 0 · MED 6 · LOW 12 · Nominal 9** (bug-16 RESOLVED; g-spread-fnname-rename filed-and-RESOLVED same session).
- **Version:** v0.7.0, no cut. **stdlib:** 18 modules.
- **Worktrees:** **main only** (both S178 agent worktrees cleaned 6b after the file-delta commit).
- **Maps:** 6c **near-no-op** — S178 source = 2 localized INTERNAL edits to existing codegen files (`emit-functions.ts` +10, `emit-client.ts` +30); no new files/passes/structure → map content materially unchanged. Watermark trails the S178 commits (still `c48c4f71`; WARN-only, not gated per `state.ts --check`). Full `project-mapper` refresh deferred to next session's first dispatch (or a broader refactor).
- **The 4 stale-item catches** (banked `feedback_verify_before_claim` — session-open thread-menu sub-shape): T3 + log/function-boundary/g-unknown (at open) · bug-16 gap token (S131-ratified) · S166 TRIAGE #1 (S166-shipped). Forward docs drift like the gap tokens — candidate DD3-style "forward-path self-evidence" follow-on (S166 TRIAGE stamped this session; master-list §N still S2–S40 stale).

## 🟢 S178 PROGRESS (in-flight — Profile A, closing DD1)

- **Housekeeping DONE:** the 2 S177 commits PUSHED (`75f724af..7c41cad2`, pre-push gate passed; origin 0/0 with local). Dead `stash@{0}` DROPPED (`c98654fc` if ever needed).
- **DD1 Fork 2 (global-reactive-store) — RATIFIED 2A+2B** (user verbatim "ratify 2A+2B"): explicit-data-flow + typed engine-singleton = scrml's FINAL shared-state model; document the engine-singleton (mounted-once cross-file, ambient-readable from components) as the existing typed global reactive store; do NOT build 2C (free store — zero corpus demand). **Two DD corrections found via Rule-4 verify:** (i) the "no shared reactive state" statement (SPEC `863`/`21718`) is scoped to PROGRAM BOUNDARIES, not in-program → no `:863` rescope needed for 2B; (ii) the DD's claim that `E-COMPONENT-ENGINE-SCOPE` "blocks a component from reading the engine" is WRONG — that error only bans DECLARING an engine in a component; §15.13.4/.6 explicitly allow ambient-read. **Empirically proven** (canary doctrine, not SPEC-faith): `05-multi-step-form.scrml` `ConfirmStep` ambient-reads `@firstName/@email/@theme` (real corpus, compiles clean); a minimal engine case compiles + emits `_scrml_effect(() => el.textContent = _scrml_reactive_get("marioState"))` (the live §15.13.4 subscription). Honest caveat: NO corpus component ambient-reads an ENGINE cell (the "zero context reach" — pattern is spec-supported + compiler-proven + corpus-unused; sharpens the no-2C call).
- **DD1 Fork 5 — RATIFIED 5A** (user AskUserQuestion): keep `import:host` self-host-only (Elm/Roc platform-only pole); no general adopter JS-host door. Adopters get scalar builtins (S176) + `extern`/WASM (§23.3.3, foreign-compute). Consistent with the S174 hide-the-host pin. Precondition (Fork 1) met. Precedent correction: every hide-pole lang is platform-only-with-builtins, NOT escape-with-FFI; `extern` is WASM-scoped NOT a general JS door.
- **DD1 FULLY CLOSED** — all 5 forks ruled (1+3+4 built S174–S176; 2→2A+2B, 5→5A today).
- **LANDED this session (all UNCOMMITTED — batched for wrap per user "batch for wrap later"):**
  - scrml-support: user-voice S178 append · DD doc `js-host-boundary-foundation-2026-06-07.md` status `in-progress`→`current` + all-forks-ratified banner · design-insights.md append (engine-singleton-as-global-store + 2 corrections + platform-only-with-builtins).
  - scrmlTS: **2B documentation** — SPEC §51.0.A S178 amendment (engine-singleton IS the typed global store + program-boundary-scoping + E-COMPONENT-ENGINE-SCOPE clarification) + PRIMER §7 companion line. Additive prose only — no §34, no error codes, no compiler source.
- **WRAP TODO (batched):** commit+push scrml-support records · commit scrmlTS (hand-off + 2B SPEC/PRIMER + hand-off-182 rotation) · **regen SPEC-INDEX** (`bun run scripts/regen-spec-index.ts` — the §51.0.A +1 paragraph shifts line ranges below §51) · changelog S178 block · the standard wrap 8-steps (6b/6c/6d).

## 🟢 S178 DISPATCH LANDED (staged, batched for wrap) — bug-16 generator codegen fix

- **`ac41cf752717f04cb` — bug-16 codegen fix DONE** (FINAL_SHA `d5e46dea`, branch `worktree-agent-ac41cf752717f04cb`). Added `generatorStar` at `emit-functions.ts:960` (mirrors `emit-library.ts:428`). 12 tests, full suite 23,734→**23,746/0**/220/1. **PA-side verified:** S147 coherence 0/0 (no leaked commits), S99 main-clean (no leak), branch tip==FINAL_SHA, file-delta review clean. **PA-INDEPENDENT R26 PASS:** both reproducers compile clean + `node --check` valid + `function*` preserved (`function* _scrml_fibonacci_2`, `function* _scrml_counts_2`).
- **LANDED via file-delta into main (STAGED, NOT committed — batched for wrap):** `compiler/src/codegen/emit-functions.ts` + `compiler/tests/unit/bug16-generator-client-emit-star.test.js` + `docs/changes/bug-16-generator-codegen-star-2026-06-10/progress.md`. **Worktree `agent-ac41cf752717f04cb` RETAINED** as recovery anchor until wrap (land-before-cleanup; cleanup at wrap step 6b after the commit).
- **bug-16 gap REFRAMED → `status=resolved`** (policy S131 §13.6 + codegen S178). **NEW gap filed `g-derived-rhs-fnname` (MED, open)** — anomaly #2: the star-drop fix unmasked a runtime ReferenceError — a `const <x> = …localFn()…` derived-decl RHS emits the USER fn-name not the `fnNameMap`-renamed name (compiles clean + node --check valid — canary class). Likely NOT generator-specific. §0 count: MED 7 (bug-16 −1, g-derived-rhs-fnname +1).
- **WRAP TODO for this fix:** commit (the staged fix rides the wrap commit) · **regen state.ts count table** (6d — bug-16/g-derived-rhs-fnname token changes) · **add missing SPEC-INDEX §13.6 listing** (the index doesn't list §13.6 — a separate currency gap found this session) · worktree cleanup (6b).
- **NB — 3rd stale "pending" item this session** (after T3 + the log/function-boundary/g-unknown cluster). bug-16's token was stale vs SPEC (S131 ratification never flipped it). **Pattern: gap tokens drift from SPEC** → a gap-token-vs-SPEC currency sweep is a candidate thread (the live-state source itself can be stale; SPEC is the Rule-4 authority; verify-before-deliberate caught this one).

## 🟢 2nd DISPATCH LANDED (staged, batched for wrap) — g-spread-fnname-rename RESOLVED

- **`a35a4e5c6030894bf` DONE** (FINAL_SHA `74014b44`). Tightened the fnNameMap rename lookbehind (`emit-client.ts:1757`) to `(?<![A-Za-z0-9_$)\]]\s*\.\s*)` — reject only genuine member-access, allow spread. **Bonus:** the SAME spread-escape was in a 2nd regex (`:2054`, import-usage detector) — a spread-only-used import was false-pruned → runtime ReferenceError; fixed too. 11 tests, suite 23,734→**23,745/0**.
- **PA-verified:** S147 coherence 0/0, S99 main-clean (no emit-client.ts leak), branch tip==FINAL_SHA, file-delta review clean. **PA-INDEPENDENT R26 PASS** + member-access/string-literal (Bug Z) controls preserved. **COMBINED bug-16+g-spread proof:** generator-spread `[...counts()]` now emits `function* _scrml_counts_2()` + `[..._scrml_counts_2()]`, node --check valid, zero bare-name leak — the two fixes compose end-to-end.
- **LANDED via file-delta into main (STAGED, batched for wrap):** `compiler/src/codegen/emit-client.ts` + `compiler/tests/unit/mangle-spread-call-callee.test.js` + the progress.md. **Worktree `agent-a35a4e5c` RETAINED** until wrap (land-before-cleanup).
- gap `g-derived-rhs-fnname` → renamed `g-spread-fnname-rename`, now `status=resolved`.

## 🔴 OPEN QUESTIONS TO SURFACE IMMEDIATELY

1. **~~2 unpushed commits~~ — RESOLVED (pushed this session).** ~~the S177 "PUSHED" claim was inaccurate.~~
   - `git rev-list --left-right --count origin/main...HEAD` = **0 behind / 2 AHEAD**.
   - origin/main tip = `75f724af` (S177 arc 2, g-formfor). Local main has 2 more:
     - `c48c4f71` — fix(s177): g-stdlib client inliner (S177 arc 3)
     - `7c41cad2` — wrap(s177): the S177 wrap commit
   - Both are legitimate PA-authored S177 work (S147 coherence verified — 2 ahead, both mine, NO leak). The push simply stopped after arc 2. The S177 hand-off's "PUSHED (origin/main == local)" was a narrative error; git STATE says 2 commits never reached origin.
   - **Disposition needed:** push the 2 commits (cross-machine sync step-4 LOCAL-AHEAD) — needs user authorization. Until then, local-ahead state stands.

2. **Stray stash `stash@{0}` — confirmed dead-shaped; disposition = drop?**
   - `stash@{0}: WIP on worktree-wf_fcf9da39-782-1` — a 1-line `api.js` `TEMP-FLIP measurement` (flips native parser to default via `parser !== "legacy"`). Dead experimental WIP from the S170 native-swap measurement; the originating worktree is gone.
   - The native-parser swap is DEFERRED to M6 (carry-forward below), so this flip is not landing. Recommend DROP. Holding for user OK (destructive-op-reversibility rule).

## STATE AS OF OPEN (S177 CLOSE carry-over)
- **HEAD:** `7c41cad2` (S177 wrap). **origin/main:** `75f724af` (2 behind local — see Open Q1).
- **Tests:** full suite **23,734 / 0 fail / 220 skip / 1 todo** (per S177 close; not re-run this open). `state.ts --check` PASS at S177 close.
- **known-gaps:** **HIGH 0 · MED 7 · LOW 12 · Nominal 9** (S177 close — 13 cleared net).
- **Version:** v0.7.0, no cut. **stdlib:** 18 modules.
- **Worktrees:** **main only** (verified — `git worktree list` shows only main checkout at S177 close).
- **Maps:** watermark → S177 wrap region (c48c4f71 / the wrap commit; refreshed 6c at S177).
- **Inbox:** empty (`handOffs/incoming/` no unread). No cross-repo notices pending.
- **Hooks:** configuration B (pre-commit + post-commit + pre-push all installed at `.git/hooks`) — correct, leave it.
- **scrml-support:** clean, 0 behind / 0 ahead of origin.

## CARRY-FORWARD QUEUE (all need user direction)
- **DEFERRED follow-on (S177):** auth.js's 6 `Date.now()` wall-clock reads → `scrml:time.now()` (clock-leak class; security-sensitive JWT/TOTP timing — not filed as a gap, noted in g-stdlib resolved entry).
- **DD1 remaining forks (close the DD):** Fork 2 (global-reactive-store — ratify-the-omission) · Fork 5 (escape door — keep `import:host` platform-only). Deliberation, no build; closes the JS-host-boundary DD.
- **~~Typed-SQL-row Tranche 3~~ — ALREADY DONE (S175, `95c25b67`).** CORRECTION: my S178-open report mistakenly listed T3 as a pending thread (lifted the T3 *plan* from the S175 user-voice ruling without checking it was built the same session — a verify-before-claim miss). T3a+T3b+T3c all landed; flagship dogfood re-applied + ENFORCED (`load-card.scrml load: LoadCardRow`, `board.scrml <loadRows>: LoadCardRow[]`); engage-test fires `E-SQL-ROW-CONTRACT-MISMATCH` on the flagship. `g-sql-row-type` + `g-sql-row-typeflow` both RESOLVED. The whole T1+T2+T3 arc is closed end-to-end. Only residual: `g-sql-row-protect-leak` (LOW — in the LOW canon-scrub list below).
- **~~Function-boundary rule~~ — DONE S175 (`9e6156c4`):** 4A `E-STRUCT-FUNCTION-FIELD` + passed-vs-stored rule named + Fork-3 identity/value cross-ref all landed. (Another item I wrongly carried; corrected.)
- **~~`log()` location-transparency BUILD~~ — DONE S174 (`916b8bb3`):** location-transparent `log()` builtin with compiler-certain `[server|client] (file:line)` tag + dev terminal forwarding + prod-strip. (Wrongly carried; corrected.)
- **~~g-unknown-type-leak~~ — DONE S176 (`E-TYPE-UNKNOWN-NAME`).** The S174 "must-follow-soon" is closed.
- **NOTE — current-truth thread list = the S177 carry-forward (this section, post-correction) cross-checked against known-gaps tokens, NOT reconstructed from older user-voice rulings.** Four items above (T3, function-boundary, log(), g-unknown) were S173–S176 *rulings* that got BUILT the same/next session; trusting the ruling text over the build-state is the verify-before-claim trap.
- **MED tail:** `r28-c2` (kickstarter `< db>` leading-space + print()) · `bug-1` (Tailwind arbitrary-value — needs preflight-CSS infra) · `bug-12-vkill` (var-name canonicalization gated) · `bug-14` (MCP V0.E) · `bug-16` (generator policy — design Q) · `bug-17-l19` (L19 relaxation — design Q).
- **LOW canon-scrub:** `g-server-keyword-drift` (deprecated `server` modifier pervades canon) · `g-route-arg-fn` · `g-sql-row-protect-leak` + bug-75 (KEEP-OPEN, real bug) + LOW bug tail.
- **`E-ROUTE` arg-direction hole** (S174) — function-typed value crossing the wire in ARG direction is real but Fork-4-independent; file as a separate `E-ROUTE` arg-direction amendment.
- **Native-parser swap Wave 3** (strategic #1; design-gated; DEFER to M6). TRIAGE: `docs/changes/native-swap-retriage-s166/`.

## pa.md directives in force
- Rules R1–R5. `---` answer-delimiter. Profile A/B. `full wrap`/88% floor. wrap = 8 steps (6b worktree-cleanup / 6c maps-refresh / 6d state-doc regen + currency gate).
- Dispatch: S88 isolation:worktree explicit · F4 startup-verify · S90 CWD-routing · S99/S126 Bash-edit + no-`cd` (+ S176 hook-Bash-blindspot) · S136 BRIEF.md archival · S138 R26 + PA-independent-verify · S147 branch-leak coherence · S164 bg-commit-race.
- Memory (load-bearing recent): `feedback_sweep_all_mentions_newest_first` (S176 — weight LATEST design decision) · `feedback_limit_primitives_not_godify` · `feedback_signal_ruling_scope` · `feedback_no_batch_ratify_foundational_axioms` · `feedback_canary_metric_class_lesson` (render/run-not-just-compile) · `feedback_verify_before_claim` · `feedback_background_commit_race`.

## Tags
#session-178 #profile-a-full-start #open-2-unpushed-commits #stray-stash-disposition #carry-forward-queue
