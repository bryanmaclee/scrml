# scrmlTS — Session 176 (CLOSE)

**Date:** 2026-06-09
**Previous:** `handOffs/hand-off-180.md` (= S175 CLOSE).
**Next-session pickup:** rotate THIS file → `handOffs/hand-off-181.md` at next OPEN.
**Profile:** opened **A (FULL)** ("read pa.md start full"). `/effort` → **ultracode**.
**Wrap:** plain **"wrap"** — 8-step wrap executed (6b worktree-cleanup [no-op, already clean] + 6c maps-refresh + 6d state-doc regen + currency gate). Step 7 push: see "Open questions" — surfaced (plain "wrap" ≠ "wrap and push").

## 🟢 S176 CLOSE — FOUR compiler-source arcs shipped + pushed (type-system + JS-host-boundary cluster)

A long Profile-A/ultracode session. Four arcs ratified → built → PA-independent-R26-verified → file-delta landed → pushed. Plus the orphan-branch cleanup + a design-judgment pivot (purity-enforcement → deprecation on user pushback).

### STATE AS OF CLOSE
- **HEAD:** the wrap commit (this: hand-off + changelog + master-list + maps + state regen) on top of `35172d78` (scrml:random). The 4 arc landings: `46cffc83` (E-TYPE-UNKNOWN-NAME) · `beb8a115` (scrml:math+clock) · `4a19a047` (pure-deprecation) · `35172d78` (scrml:random). scrmlTS origin **0/0 through 35172d78**; the wrap commit's push state is in Open Questions.
- **Tests:** full suite **23,680 / 0 fail / 220 skip / 1 todo** (S175 close 23,538; +142: +63 E-TYPE-UNKNOWN-NAME, +44 scrml:math/clock, +17 pure-deprecation, +18 scrml:random). `bun scripts/state.ts --check` PASS.
- **known-gaps:** **HIGH 0 · MED 10 · LOW 22 · Nominal 9** (live via `@generated:gap-counts`). S176 deltas: RESOLVED `g-unknown-type-leak`, `g-pure-function-purity-gap` (by-deprecation), `g-random-primitive`; FILED `g-random-primitive`(→resolved same session), `g-stdlib-clientinline-shim-import` (MED, OPEN), `g-pure-function-purity-gap`(→resolved same session).
- **Version:** v0.7.0, no cut.
- **stdlib:** 16 → **18 modules** (NEW `scrml:math`, `scrml:random`; `scrml:time` gained `now()`).
- **Worktrees:** **main only** (all session worktrees cleaned per-landing). No orphan branches (the 2 S175 orphans investigated + cleaned — superseded, work in origin/main `76059024`+`9d12d980`).
- **Maps:** refreshed 6c (project-mapper incremental on the S176 source landings — E-TYPE-UNKNOWN-NAME / W-PURE-DEPRECATED / scrml:math+random+now / generalized collector); watermark → `35172d78` (trails the wrap commit by 1 = docs-only wrap commit; WARN-only per 6d).
- **Inbox:** empty.

### S176 ARC (what shipped — all pushed, all R26-verified)
1. **`46cffc83` — `E-TYPE-UNKNOWN-NAME` (g-unknown-type-leak RESOLVED).** The committed S174 "2 must-follow-soon". Scope via a fan-out investigation workflow (6 readers + adversarial risk-audit) → user ruled **BROAD** (all leak loci + symmetric `E-TYPE-ANY-FORBIDDEN` extension). Position-aware leaf predicate (PascalCase + registry-PRESENCE + import-specifier exemption) post-import-seed. SPEC §14.1.2. Agent caught the investigation's miss (machine-typed cells via machineRegistry → exempted). +63.
2. **`beb8a115` — DD1 Fork 1 (1A+1C): `scrml:math` + `scrml:time.now()`.** Pure math module (fn-callable) + capability-scoped clock (E-FN-004 binding-aware). time.js de-leaked 15→0; data.js DEFERRED (`g-stdlib-clientinline-shim-import`); bundler sibling-shim-copy fix closed a latent oauth bug. SPEC §41.18/§41.19. +44.
3. **`4a19a047` — `pure` modifier DEPRECATED.** THE design-judgment arc (see PROCESS). `W-PURE-DEPRECATED` (replaces W-PURE-REDUNDANT) + migrate Migration 3 + 10-decl corpus → fn + SPEC §33 banner. Closes `g-pure-function-purity-gap` by-deprecation. +17.
4. **`35172d78` — `scrml:random` (g-random-primitive RESOLVED).** `random()` + `randomInt`, capability-scoped; the now() collector generalized to a registry (`collectNonDetStdlibBindings`). 6 Math.random migrated; http jitter de-leaked. SPEC §41.20. +18.

### PROCESS NOTES (for next session)
- **The pure-deprecation pivot (design-judgment precedent).** PA dispatched "enforce purity on pure function"; user pushed back "pure was deprecated long ago"; PA STOPPED the agent, re-investigated comprehensively (newest-first), found pure was killed-early→re-ratified-S32 + `server` (not pure) is the Insight-26 deprecation, BUT pure is empirically INERT → user ruled deprecate. Lesson: take the pushback seriously, re-verify the record properly, surface the inert-finding.
- **2 new PA memories:** `feedback_sweep_all_mentions_newest_first` (don't anchor on the first user-voice hit; weight the LATEST), `feedback_path_discipline_hook_bash_blindspot` (the S100 hook misses Bash writes; S126 mandates Bash-edits → leak vector; defense = agent self-check + PA post-dispatch main-clean verify).
- **PATH-DISCIPLINE INCIDENT** (deprecate-pure, commit `4a19a047` body): agent python3 Bash-write leaked to MAIN type-system.ts; self-reverted + PA-verified clean. Hook-hardening is a filed follow-on (settings task).
- **Standing land+push grant OFFERED + DECLINED** — user kept per-arc authorization. Continue asking per landing.

### CARRY-FORWARD QUEUE (all need user direction)
- **DD1 Fork 1 last follow-on:** `g-stdlib-clientinline-shim-import` (MED) — the client-inliner strips cross-shim imports, so a client-inlined shim (data.js — one of auth/crypto/data/host) can't import a sibling shim; blocks the data.js Math de-leak. Real fix is in the inliner. + a NEW micro-finding: http/index.scrml still leaks `Math.pow`/`Math.max` (pure-math ouroboros, separate from Math.random; http is server-bundled so de-leakable — small follow-on, not yet filed as a gap).
- **DD1 remaining forks (close the DD):** Fork 2 (global-reactive-store — ratify-the-omission 2A+2B, credit the engine-singleton; DO NOT build 2C) · Fork 5 (escape door — 5A keep `import:host` platform-only). Both ratify-the-omission; close DD1 + unblock the "hide the host" stance ruling (Fork 1 was its precondition — now shipped). DD: `scrml-support/docs/deep-dives/js-host-boundary-foundation-2026-06-07.md` (status still `in-progress`; Forks 3+4+1 done).
- **Hook-hardening:** close the path-discipline hook's Bash-write blind spot (intercept Bash main-absolute writes; settings/hook task, not compiler). Memory `feedback_path_discipline_hook_bash_blindspot`.
- **Typed-SQL-row LOW tails:** `g-sql-row-protect-leak` (LOW) · `g-route-arg-fn` (LOW) · `g-server-keyword-drift` (LOW — scrub deprecated `server` from canon; the `server` deprecation [Insight 26] still pervades spec/primer/kickstarter/corpus).
- **Native-parser swap Wave 3** (strategic #1; design-gated; DEFER to M6). TRIAGE: `docs/changes/native-swap-retriage-s166/`.
- **Carry-forward design queue:** L19 multi-statement-handler relaxation; generators policy; DD3 Fork-4 wrap-gate→pre-commit promotion.

### pa.md directives in force
- Rules R1–R5. `---` answer-delimiter. Profile A/B. `full wrap`/88% floor. wrap = 8 steps (6b/6c/6d).
- Dispatch: S88 isolation · F4 startup-verify · S90 CWD-routing · **S99/S126 Bash-edit+no-`cd` (+ S176 hook-Bash-blindspot — self-enforce worktree-absolute prefix on Bash writes)** · S136 BRIEF.md · S138 R26+independent-verify · S147 branch-leak coherence · S164 bg-commit-race.
- Memory: `feedback_sweep_all_mentions_newest_first` · `feedback_path_discipline_hook_bash_blindspot` · `feedback_no_batch_ratify_foundational_axioms` · `feedback_limit_primitives_not_godify` · `feedback_verify_before_claim` · `feedback_signal_ruling_scope` · `feedback_show_code_to_reason_about` · `feedback_pa_bash_cleanup_dry_run`.

## Tags
#session-176 #profile-a-full-start #e-type-unknown-name #scrml-math-clock #pure-modifier-deprecated #scrml-random #four-arcs #pure-deprecation-pivot
