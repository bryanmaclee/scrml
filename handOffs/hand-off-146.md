# scrmlTS — Session 142 (CLOSE)

**Date:** 2026-05-29
**Previous:** `handOffs/hand-off-145.md` (S141 CLOSE — gauntlet R27 + 3 cuts v0.6.8/v0.6.9/v0.6.10 + emitted-JS parse-gate built/flag-gated + gate-found fix-wave PARTIAL).
**Next-session pickup:** rotate THIS file → `handOffs/hand-off-146.md` at S143 OPEN.

**🎯 S142 MILESTONE:** the **emitted-JS parse gate is now a compile-time invariant DEFAULT-ON** (`db88e989`). The whole S141→S142 arc (ratify A+D → build → close the invalid-JS surface → flip) is COMPLETE. Gate-flip dispatch closed all 3 residuals (incl. the hard nested-`!{}`) + 2 cascade residuals the gate exposed; PA dual-verify full suite **22,141/0 with default-ON**, within-node 1005/0, R26 adopter-clean. `--no-validate-emit` is the operational opt-out. SPEC §2.2.1 "active by default."

**S142 CLOSE — wrap+push.** Marathon, high-yield: **v0.6.11 shipped** (emitted-JS parse gate flipped DEFAULT-ON — the S141→S142 arc closed) + **errorBoundary built from-scratch** (`f3e9039d`, §19.6 + C-hybrid; C7 + R24-step-3b direction-call + canon-drift all closed). 3 worktree dispatches all clean-landed (gate-found-tail · gate-flip · errorBoundary), incl. a NEW branch-leak class caught + fully recovered (see the errorBoundary LANDED section). Full suite **22,153/0** gate-default-ON; within-node 1005/0. known-gaps §0: HIGH **1** (Bug 54) · MED **9** · LOW **14** · Nominal 7. ~11 commits + v0.6.11 tag pushed S142; the wrap commit (changelog + master-list §0.6 + this hand-off) + scrml-support (user-voice + design-insights) push at close. **NO version cut for errorBoundary this session** — v0.7.0/v0.6.12 candidate deferred to S143. **Carry-forward S143** (see §0.6 + Open Questions): the cut decision · the candidate leak-class pa.md addendum · R27 residual C4/C6/C8/C9 · the 2 NEW LOW diagnostic gaps · Bug 54 · within-node allowlist-staleness hygiene · r24/r25 untracked commit · R28 gauntlet · native parser M2.4+MK2.

**Session-start "in one line" (preserved):** opened on v0.6.10; gate-found fix-wave + flip + maps-refresh → the full arc above.

---

## State as of OPEN

| Item | Value |
|---|---|
| HEAD scrmlTS | `db9dba55` — **PUSHED, 0/0 with origin.** v0.6.11 release. Session commits (7): maps `942d62e7` · gate-found-tail `ada56bb6` · within-node-rebump `5be0a502` · known-gaps `d34f3b93` · **gate-flip `db88e989`** · known-gaps-final `d02a6c02` · release `db9dba55`. |
| Latest release tag | **`v0.6.11`** (`db9dba55`, PUSHED) — "emitted-JS parse gate always-on by default" |
| Worktree | main only — `agent-af4740ca` (gate-found-tail) + `agent-a8fa8470` (gate-flip) both CLEANED |
| pkg.json | **0.6.11** |
| Gate | **`validateEmit` DEFAULT-ON** (`db88e989`, shipped v0.6.11) — compile-time invariant by default; `--no-validate-emit` opt-out; SPEC §2.2.1 active-by-default |
| Tests | full `bun run test` **22,141 / 0 / 219 / 1** with gate **default-ON** (PA dual-verify + pre-push gate; +9 vs S141's 22,129) |
| Latest release tag | `v0.6.10` (`36eca00a`, pushed). **v0.6.11 cut candidate** — the C10/C11 + codegen fixes + CLI flags are patch-worthy; gate-flip milestone NOT reached (3 residuals) — surface cut decision |
| HEAD scrml-support | `2ec6480` (0/0 with origin) — **r24/r25 gauntlet files STILL untracked** (carry-forward) |
| pkg.json | 0.6.10 (bump to 0.6.11 at cut if user authorizes) |
| Tests | full suite **22,132 pass / 0 fail** (post-commit at `5be0a502`; +3 vs S141's 22,129 — new regression tests). within-node parity 1005/0 after rebump. TodoMVC PASS, Browser passed |
| Worktrees | main only |
| Inbox | empty |
| Hooks | configuration B (local-rich — pre-commit + post-commit + pre-push at `.git/hooks`) |
| S99 path-discipline counter | 20 |
| PA auto-memory | 43 rule files |
| Maps | **REFRESHED** to watermark `9ab7aa38`, committed `942d62e7` (validate-emit.ts + E-CODEGEN-INVALID-JS/E-CG-003 reflected; 2 prior non-compliant heads-up docs now compliant) |
| HIGH bugs open | **2** (known-gaps §0) — Bug 54 `tableFor :let` parse-layer (DEFERRED) + **C10** gate-found compound-`if=` truncation (OPEN; "blocks gate always-on"). **C10's ACTUAL status is what the in-flight fix-wave Phase-1 empirically resolves** — S141 progress.md believed it closed but never flipped known-gaps; per R26 not flipped without proof. (My initial S142-OPEN hand-off draft said HIGH=1 — that was the under-count; corrected.) |
| `full wrap` directive | NOT active (S139 directive is in-session-only; does not carry across sessions) |

---

## Session-start checklist (S142 OPEN)

- [x] Read `pa.md` pointer → `scrml-support/pa-scrmlTS.md` IN FULL (1051 lines; S136/S138/S139 addendums in force)
- [x] Read `docs/PA-SCRML-PRIMER.md` §1–§13.6 IN FULL (lines 1–1114; §13.7 AST-contract appendix + §14/§15 = compiler-internal, on-demand)
- [x] Read `compiler/SPEC-INDEX.md` (sections table §1–§58 + Quick-Lookup; 30,481 lines / 58 sections + appendices)
- [x] Read `master-list.md` §0 LIVE DASHBOARD (§0.1 phase table + §0.2 locks L1-L22 + §0.4 open questions + §0.6 S141/S140/S139/S138/S137 CLOSE entries)
- [x] Read previous `hand-off.md` (S141 CLOSE) IN FULL
- [x] Read user-voice last ~10 contentful entries (S134 + S136 + S137 + S141)
- [x] Sync check: scrmlTS 0/0 with origin · scrml-support 0/0 with origin (untracked r24/r25 gauntlet files — carry-forward)
- [x] Hooks: configuration B confirmed
- [x] Inbox check: empty (NOTE: CWD leaked into scrml-support on the 2nd session-open Bash batch — S90 hazard; caught + reset; re-checked scrmlTS inbox from correct CWD = empty)
- [x] Worktree check: main only
- [x] Rotated `hand-off.md` → `handOffs/hand-off-145.md`
- [x] Created fresh `hand-off.md` (this file)
- [x] Incremental map refresh — DONE (user-authorized). project-mapper agent `a0bd7bc6` refreshed 4 maps + non-compliance report; committed `942d62e7` (explicit `.claude/maps/` pathspec; `.claude/` is gitignored → `git add -f` per S140 precedent).
- [x] Report caught-up + next priority — DONE. User chose: priority = gate-found fix-wave + flip; maps-refresh-now.

---

## LANDED (S142) — gate-found fix-wave TAIL (agent `af4740ca`, branch `worktree-agent-af4740ca5885aa5ba` @ `137f9979`)

**Landing commit `ada56bb6`** (S67 file-delta, 18 files +514/−69; leak-check clean — NO compiler-src in main pre-delta; worktree clean per S83). BRIEF + agent progress.md committed in it. Worktree NOT yet cleaned (clean at wrap).

**What landed (all PA-verified):**
- **C10 RESOLVED** — two defects: C10a lift-attr STRING re-quote (ast-builder.js) + C10b is-pred dotted-LHS ws-tolerance (rewrite.ts). **R26 reverse-direction CAUGHT that C10/C11 were LIVE at baseline** (S141 progress.md wrongly believed them closed — the predecessor never flipped known-gaps + I declined to flip without proof; the dispatch's Phase-1 proved them live).
- **C11 RESOLVED** — seeds.scrml migrated off non-canonical `server {}` block-stmt → body-content-inferred server fn (Insight 26); cleared a symptom E-ROUTE-001 (trucking-smoke baseline 1→0).
- `!{}` top-level-return guard + variant named-field construction + match-arm init-set thunk-wrap (emit-logic.ts/emit-expr.ts); self-host bare-let-decl no-init + optchain `?.` space-collapse (ast-builder.js/expression-parser.ts).
- Bug 4.5 DG + onTransition-filter: **non-canonical fixtures migrated** (brace-compound→structural-children; bare-prose→effect) — NOT codegen; **surfaced 2 LOW diagnostic gaps** (silent-compile of those non-canonical shapes — filed known-gaps §0 LOW).
- emit-logic-s19 + error-handler test-harness fixes (insideFunctionBody:true for in-fn return idioms + NEW top-level-case tests) — verified NOT test-weakening.
- Phase 3 PARTIAL: `--validate-emit`/`--no-validate-emit` CLI (compile/build/dev) + SPEC §2.2.1 operational-escape note. **`validateEmit` default STAYS `false`** (agent correctly held the flip + refused to disable the gate to pass).

**PA-independent verification (classifier was down during agent run → verified everything):** api.js default confirmed `false`; C11 migration + trucking-smoke baseline-change legit (not weakening); all 5 test-file changes confirmed harness-fix/strengthening (not weakening); R26 — trucking 0 gate-fires, R27 dev-1/2/4/5 0 fires, dev-3 pre-existing E-PA-002 (not a gate fire); gate LIVE (both self-host residuals fire at exact reported byte offsets).

**WITHIN-NODE PARITY CANARY (the one surprise):** the fix-wave's AST-shaping changes tripped the within-node parity migration canary (LIVE vs native-parser) on **12 fixtures** (5 optchain SPAN-COORD + self-host ast/dg/ri/ts/meta-checker + stdlib/http + stdlib/compiler/meta-checker, incl. structural FIELD-SHAPE/MISSING-FIELD/KIND-NAME). **Pre-commit EXCLUDES within-node parity** (S125), so the agent's pre-commit-green missed it; post-commit full-suite surfaced it. **Confirmed fix-wave-caused** (reverting the 6 source files → canary green 1005/0). **User chose investigate-first → INVESTIGATED → BENIGN:** the fix moved LIVE from malformed-parse (escape-hatch ParseError / `let` swallowing the next stmt = the invalid JS the gate caught) to CORRECT parse; the re-aligned nodes surface the true LIVE-vs-native representational gap (tilde-decl↔bare-expr for `~`-pipelines; bare-let init shape), previously masked by the malformation. Decisive evidence: stdlib/http per-node diff showed the `~data`/await/if-else region went escape-hatch-ParseError→proper tilde-decl. **Surgical rebump `5be0a502`** — 18 class-value bumps across the 12 fixtures (positive-residual classes only). within-node parity 1005/0 after.

**Pre-existing allowlist staleness OBSERVED (separate hygiene, NOT touched):** a full regen showed ~40 OTHER fixtures where prior FIX-NATIVE improvements left the allowlist stale-HIGH (raw < allow; gate floors residual at 0 so they never fail). I left them — out of scope for this landing. A dedicated allowlist-hygiene pass (regen-to-current) is a future native-parser-team item.

**Maps feedback:** agent reported maps load-bearing (primary/structure/error confirmed validate-emit wiring + emit-module layout + the 2 new codes; dependencies not load-bearing). Maps-discipline §4 signal: positive.

## LANDED (S142) — gate-flip + 3 residuals (agent `a8fa8470`, branch @ `cbfeae71`) → `db88e989`

**OUTCOME: gate FLIPPED default-ON; all 3 residuals + 2 cascades closed; full suite 22,141/0 with default-ON.** Landing `db88e989` (S67 file-delta, 12 files +638/−41; leak-check clean; worktree clean+cleaned). PA dual-verify: I ran the full `bun run test` myself with the flip live → 22,141/0, 0 E-CODEGEN-INVALID-JS, within-node 1005/0. Reviewed: api.js flip + comment (accurate), SPEC §2.2.1 (accurate), canary cg.scrml→EXACT (a TIGHTENING not weakening — LIVE 5→0 imports matches native), 4 regression tests (not weakening). R1 root corrected (`type`-keyword-as-operand, not multi-line-ternary); R3 NOT STOP-blocked (option-b codegen re-parse); +2 cascade (double-await + async-meta) caught by R26 re-verify before flip. known-gaps §GATE-FOUND-RESIDUALS all-RESOLVED + gate-status FLIPPED (committing). **Maps: load-bearing (agent confirmed module-graph + E-CODEGEN-INVALID-JS site).**

**(dispatch record retained:)** Agent `a8fa8470677d2481c` (scrml-js-codegen-engineer, isolation:worktree, opus). change-id `gate-flip-and-residuals-2026-05-29`. Baseline `d34f3b93`. BRIEF archived `docs/changes/gate-flip-and-residuals-2026-05-29/BRIEF.md` (committed in `db88e989`).

**Brief shape:** Phase 1 force-gate-on the FULL `bun run test` + enumerate ALL E-CODEGEN-INVALID-JS (the 3 are hypothesis; may be more) → Phase 2 fix per-residual ONE AT A TIME with STOP-and-report latitude on residual-3 (nested `!{}` is high-regression CORE surgery; partial close of 1+2 acceptable) → Phase 2.5 within-node parity re-handling (the fixes WILL shift it; investigate-benign + surgical rebump per the `5be0a502` precedent — pre-commit EXCLUDES it) → Phase 3 FLIP default-ON **ONLY IF** full forced-gate-on surface fully closed. The 3 residuals' precise root causes (from the predecessor progress.md) are in the brief: R1 collectExpr multi-line-ternary-in-const-init (meta-checker byte 10606), R2 escaped-backtick-template + not-in-template-string (module-resolver byte 4328), R3 nested-`!{}` flat-token-string structural (ast-builder ~L10906 → emit-control-flow rewriteBlockBody; repro error-handler-const-bind-r25-bug-49.test.js §5).

**PA-side on landing:** S67 file-delta (leak-check main first); PA-independent R26 + (if flipped) force-gate-on full-suite re-verify + within-node 1005/0 check; commit BRIEF + change-dir + fix files; flip known-gaps §GATE-FOUND-RESIDUALS per outcome (close what closed; if flip landed → mark gate always-on, v0.6.11 cut candidate becomes real); worktree cleanup. NO push without separate auth.

---

## (carry-forward detail — the 3 blockers, retained)

Close the 3 §GATE-FOUND-RESIDUALS → flip `validateEmit` default `false`→`true` in api.js (~line 641, a one-line change) → full suite must stay green with the flip. CLI flags + SPEC §2.2.1 note already wired. The 2 self-host residuals are "the heaviest latent-bug sources in the tree" (agent note); nested-`!{}` needs parser-level nested-error-effect retention or codegen-time handler re-parse.

Also queued: the 2 NEW S142 diagnostic gaps (silent-compile of non-canonical brace-compound + bare-prose-onTransition — should fire hard diagnostics; LOW) · the pre-existing within-node allowlist staleness (~40 stale-high fixtures — a regen-to-current hygiene pass, native-parser-team item).

---

## ORIGINAL PRIMARY CARRY-FORWARD (S141 → S142, now LANDED — retained for reference)

The emitted-JS parse-gate (`validateEmit`, built S141 v0.6.9, flag-gated default-OFF) was driven from 37→8 gate-on failures by the S141 PARTIAL gate-found fix-wave (`bf63e096`). **8 invalid-JS surfaces remain** before the gate can flip default-ON:

1. `!{}` inline-catch (§19.4.3) + R25-Bug-49 nested `!{}`
2. each-block `as name` index alias
3. match-arm-block named-binding (Bug 6.5.1)
4. `<onTransition>` structural-element filter / HTML
5. self-host meta-checker (1)
6. self-host module-resolver (1)
7-9. the `emit-logic-s19` test-context fix the prior agent stalled on — **3 tests expect `return` emitted WITHOUT `insideFunctionBody`; they should PASS the flag** (this is a test-context bug, not a codegen bug; the agent's in-flight guarded-expr `emit-logic.ts` change regressed these 3 and was DISCARDED at landing).

**Then:** flip `validateEmit` default-ON + wire `--validate-emit` / `--no-validate-emit` CLI in `cli.js` + update SPEC §2.2.1.

**Dispatch shape:** fresh `isolation: "worktree"` dispatch from current HEAD (the S141 partial is already in main). scrml-js-codegen-engineer; S136 BRIEF.md archival; S138 R26 Phase-3 empirical re-verify (these are codegen fixes touching AST → R26 mandatory before claim-closed); force-gate-ON acceptance gate (full suite zero new false-positives) is the close condition. Deep-dive authority: `scrml-support/docs/deep-dives/emitted-js-parse-gate-invariant-2026-05-29.md` (`status: current`, RATIFIED banner). **Note:** the gate-found surface "correctly grew ~2-3× beyond estimate" (it's fix-the-compiler's-whole-invalid-JS-surface) — 8-remaining is the right next arc.

---

## LANDED (S142) — errorBoundary build (§19.6 + C-hybrid) → `f3e9039d` ✅

**OUTCOME: errorBoundary built FROM-SCRATCH + landed clean; C7 RESOLVED; full suite 22,153/0 gate-default-ON.** Agent `a859841aae87c5de8` built the full feature (NOT a STOP-rescope — Phase-0 found it tractable). Landing `f3e9039d` = ONE PA-authored commit (clean squash-reland; see leak incident below).

**What landed:** typed `!`-error catch → per-variant `renders` (§19.2) / boundary `fallback=` (priority §19.6.5); NEW `emit-error-boundary.ts` (markup→HTML + payload-field substitution + variant-renders); `emit-event-wiring` dispatch + the C-hybrid host-JS backstop (non-`!` throw → fallback, logged loudly); runtime `_scrml_error_boundary_log`/`_uncaught` (errors chunk, always-on); §19.6.4 nesting; typer E-ERROR-002-suppression-inside-boundary + **E-ERROR-005 NOW FIRES** + parseEnumBody newline-renders fix; SPEC §19.6.8 (C-hybrid B1-B6, PA-reviewed accurate); PRIMER §6 + kickstarter canon corrected (`renders=.Fallback`/§19.11-cite → §19.6 `fallback=` form). **Closes C7 + R24-step-3b direction-call + the errorBoundary canon drift.**

**PA dual-verify (independent):** full `bun run test` 22,153/0 (838 files) gate-default-ON; 0 E-CODEGEN-INVALID-JS; within-node 1005/0; reviewed SPEC §19.6.8 (accurate to ratified design), typer suppression (scoped), canon (faithful, no content-cut).

**⚠️ BRANCH-LEAK INCIDENT (recovered, ZERO work lost) — empirical-record + next-session watch:** a **mid-dispatch HEAD-reset** in the agent worktree leaked the 11 errorBoundary WIP commits onto **LOCAL main's branch ref** (origin UNTOUCHED at `db9dba55`). The agent's self-report ("branch @ 82e2c195, all committed clean") was WRONG — the branch ref ended at `af57a877` (Phase 0+1 cherry-pick stub only); FINAL_SHA `82e2c195` (complete work) was DANGLING. **Caught via S83 verify-git-state-not-narrative** (the `git diff main..branch` showed DELETIONS — branch lacked what main had → main had the leaked work). **Recovery (S89 reachable-SHA salvage):** protected `82e2c195` with a temp `eb-recovery` branch → verified complete + main-based → `git reset --soft db9dba55` (collapsed 11 WIP → staged delta, origin-aligned, hand-off.md preserved) → re-landed as the single `f3e9039d` PA commit → cleaned eb-recovery + the stub branch + worktree. **Lesson (the agent's own hardening note + this incident): a worktree HEAD-reset can leak commits onto MAIN's branch ref; the `git status`-clean leak-check MISSES it (work is committed, not uncommitted) — must check `git rev-list origin/main..HEAD` / branch-tip-vs-FINAL_SHA coherence on every dispatch landing, not just `git status`.** This is a NEW leak-class beyond the S99 path-discipline (Edit→main) class.

**Still TODO (wrap):** design-insights + user-voice capture of the errorBoundary + gate ratifications.

---

## (superseded — pre-dispatch) errorBoundary direction-call RATIFIED

**User ratified (via AskUserQuestion, S142):**
1. **SPEC §19.6 is canonical** — `<errorBoundary fallback={<markup/>}>` + per-error-variant `renders` clauses, catches `!`-function-call errors; statically exhaustive (E-ERROR-005). The **PRIMER §6 + kickstarter `renders=.Fallback` React-style form is DRIFT to correct** (not in SPEC; cites a wrong §19.11 [=@reactive]; doesn't compile). Rule-4 catch.
2. **Catch-scope = C (Hybrid):** §19.6 typed `!`-error model with static exhaustiveness as the DOCUMENTED PRIMARY behavior, PLUS a **compiler-emitted host-JS backstop** so an unexpected non-`!` throw in the subtree degrades to `fallback=` (logged loudly, NOT swallowed). Backstop is emitted JS (like the localStorage bootstrap try/catch + the parse gate) — NOT scrml-source try/catch. Runtime sibling of the gate; Pillar-6 "bullet-proof apps."

**TRUE SCOPE (Phase-0 grounded — bigger than the "C7 runtime-build" label):** errorBoundary is effectively UNIMPLEMENTED. `emit-html.ts:750` emits only an inert `<div data-scrml-error-boundary>` marker + renders children straight; `fallback=` ignored; per-variant `renders` error-dispatch absent; E-ERROR-005 unfired. **From-scratch build:** (a) SPEC §19.6 amendment (the C-hybrid backstop semantics + loud-dev-log + nesting clarity); (b) canon correction (PRIMER §6 + kickstarter `renders=.Fallback`→§19.6 form + fix §19.11→§19.6 cite); (c) codegen — catch wiring for `!`-calls in the subtree routing error variants to per-variant `renders` / boundary `fallback=` + the host-JS backstop try/catch + loud dev log + §19.6.4 nesting inner-first; (d) typer — E-ERROR-005 static exhaustiveness; (e) tests — unit codegen + happy-dom runtime (BOTH the typed `!`-path AND the backstop path) + R26. Multi-subsystem, multi-hour. Brief should mandate survey-first (depth-of-survey discount — the `!{}`-handler codegen + renders mechanism may partially cover).

**Durable-capture TODO (at wrap):** user-voice S142 entry (the errorBoundary ratification, via-AskUserQuestion) + design-insights append (the C-hybrid "runtime sibling of the gate" rationale). Recorded here for now.

---

## SECONDARY CARRY-FORWARD — R27 residual bugs (MED/LOW)

From `gauntlet-r27/OVERSEER-REPORT.md` (filed in known-gaps §R27 cluster; C1/C2/C3/C5 RESOLVED at v0.6.8):

- **C4 (MED)** — lifecycle `E-TYPE-001` DORMANT on object-literal-constructed struct values (`const u: User = {...}; u.field`) — the PRIMER §6.5 / SPEC §14.12.1 flagship shape. fn-return + `<User …>` state-instantiation DO fire. Root: `collectStructBindings` `type-system.ts:14008` has no object-literal path. Spec-vs-impl, **no deferral caveat** (§14.12.1/.3 normative) — do NOT soft-classify as doc-gap (pa.md `feedback_dont_soft_classify_bugs`).
- **C6 (MED)** — `bind:value=@<synth>.<field>` → E-SCOPE-001 ONLY when formFor nested in an engine state-child (works top-level). Synth-cell scope registration doesn't propagate into engine-state-child.
- **C7 (MED)** — errorBoundary `fallback={<markup/>}` (SPEC §19.6) compiles but emits an inert anchor — ZERO runtime catch wiring. Feeds the R24 step-3b errorBoundary direction-call.
- **C8 (LOW)** — `@map[.Variant]` subscript → silent invalid JS `[.Submitted]` (no diagnostic). The form is non-canonical (§14.10 → dot-access `@map.Submitted`); ALSO a BRIEF-ERROR (R27 feature-7 prescribed it).
- **C9 (LOW)** — E-DG-002 false-positive: state read only inside a derived `.filter()` arrow flagged "never consumed." DG consumption-tracker under-counts arrow-body reads.

---

## DANGLING / DEFERRED (carried)

- **errorBoundary direction-call (R24 step-3b)** — substantive design HU; deferred S136–S141. Ties to C7. The decision: `renders=.Fallback`+sibling-body (PRIMER/kickstarter, doesn't compile) vs `fallback={<markup/>}` (SPEC §19.6, compiles but runtime-inert per C7). Needs a direction decision before migration.
- **canon-vs-impl drift migration** (design-laden; surface at a quiet point): `server function` lints `W-DEPRECATED-SERVER-MODIFIER` though all canon + the R27 brief teach it; `< db>` / `< schema>` leading-space trips `W-WHITESPACE-001`; errorBoundary `renders=.Fallback` doesn't compile (SPEC `fallback={}` survives → migrate canon). Lints are CORRECT; canon needs migration.
- **r24/r25 untracked gauntlet artifacts** (scrml-support `docs/gauntlets/gauntlet-r24*` + `gauntlet-r25*`) — write-once bug-provenance; never committed. Decide: commit to scrml-support or leave. Surface for consistency (r27 IS committed).
- **design-insights gate-ratification append** — the emitted-JS parse-gate A+D ratification recorded in 4 other places (deep-dive RATIFIED banner, user-voice S141, SPEC §2.2.1, hand-off); a `~/.claude/design-insights.md` entry is the one remaining home. Low-effort.
- **Bug 54** (`tableFor :let` parse-layer; HIGH; DEFERRED) — the only open HIGH; fix-dispatch candidate.
- **Native parser M2.4 + MK2** (S112 charter B; multi-quarter arc) — M1 lexer complete, M2.1-M2.3 + MK1 landed; next M2.4 (JS scrml-extension forms) + MK2.
- **Bug 9 L3 transitive async coloring** — defer until adopter demand; §8 tripwire test flags when L3 lands.
- **`${@x/}` self-closing-slot interpolation** emits dangling `/;` (surfaced 2× S140; LOW; triage).
- **gauntlet-s79-signup-form.scrml E-TYPE-025** (pre-existing; triage).
- **user-voice S138/S139 backfill** — last logged contentful = S137 + S141 (S138/S139 marathon sessions NOT logged). Likely no-op: the S138 R26 doctrine + S139 `full wrap` ratifications are captured in pa.md addendums + the user-voice S137 entry. Confirm or close as no-op.

---

## Open questions to surface immediately

1. ~~PUSH~~ **DONE** — all 7 commits pushed, 0/0 with origin.
2. ~~v0.6.11 cut~~ **DONE — SHIPPED** (`v0.6.11` tag pushed; pkg.json 0.6.11; pre-push gate green 22,141/0).
3. **hand-off.md + hand-off-145.md uncommitted** (session-state; commit at wrap). NOTE: changelog + master-list §0.6 S142 entry + user-voice (S142 had no new durable directives beyond execution — confirm at wrap) are NOT yet done — they're `wrap`-operation steps.
4. **Next priority (awaiting user):** the arc is COMPLETE — natural pause point. Open threads: fresh gauntlet R28 (now against the strongest baseline yet — gate always-on), errorBoundary direction-call (R24 step-3b, ties to C7), Bug 54 (only open HIGH), canon-vs-impl drift migration, design-insights gate-ratification append, r24/r25 untracked-artifact commit, the 2 NEW S142 LOW diagnostic gaps.

---

## pa.md directives in force entering S142

- **S136** — BRIEF.md archival per `isolation: "worktree"` dispatch (verbatim prompt → `docs/changes/<change-id>/BRIEF.md`).
- **S138** — R26 empirical-verification doctrine BIDIRECTIONAL (forward: verify before claim-CLOSED; reverse: verify before claim-OPEN/dispatch; cross-source sweep + sibling-fix-unmask sub-rules).
- **S139** — `full wrap [arc-name]` discriminator (in-session-only; NOT active until invoked; 88% safety floor).
- Standing: `--no-verify` prohibition (extends to pre-push); S126 Bash-edit + no-`cd`-into-main mitigation; S99 path-discipline counter (20); S88 explicit `isolation: "worktree"`; S90 CWD-routing gate (already triggered + handled this session-open).
- Rules: R1 no marketing unless raised · R2 not-a-toy / full-production fidelity · R3 right answer beats easy · R4 SPEC normative (verify derived claims) · R5 shoot straight. S133: flag typos/word-misuse with 1-liner.

---

## Tags
#session-142 #OPEN #v0-6-10-shipped #gate-found-fix-wave-carry-forward #parse-gate-flag-gated #maps-refresh-candidate
