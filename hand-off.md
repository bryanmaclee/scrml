# scrmlTS — Session 177 (OPEN)

**Date:** 2026-06-09
**Previous:** `handOffs/hand-off-181.md` (= S176 CLOSE).
**Next-session pickup:** rotate THIS file → `handOffs/hand-off-182.md` at next OPEN.
**Profile:** opened **A (FULL)** ("read pa.md and start session"). `/effort` → **ultracode**.

## Session-start state (verified at OPEN)
- **HEAD:** `0aa54fc2` wrap(s176). scrmlTS **0/0 vs origin** (S176 wrap commit pushed). scrml-support **0/0**. Both clean.
- **Inbox:** empty.
- **Hooks:** config B (pre-commit + post-commit + pre-push all installed).
- **State (`bun scripts/state.ts`):** v0.7.0 · gaps **HIGH 0 · MED 10 · LOW 22 · Nominal 9** (118 @gap tokens) · pre-commit subset **16,478 / 89 skip / 0 fail** · SPEC.md 32,161 lines · 955 test files · 877 samples · 64 examples.
- **Maps:** watermark `35172d78`, 1 commit behind HEAD (the S176 docs-only wrap commit — WARN-only per wrap-6d). No source drift.

## CARRY-FORWARD QUEUE (from S176 CLOSE — all need user direction)
- **DD1 Fork 1 last follow-on:** `g-stdlib-clientinline-shim-import` (MED) — client-inliner strips cross-shim imports; blocks data.js Math de-leak. Real fix is in the inliner. + micro-finding: http/index.scrml still leaks `Math.pow`/`Math.max` (server-bundled → de-leakable; small follow-on, not yet a filed gap).
- **DD1 remaining forks (close the DD):** Fork 2 (global-reactive-store — ratify-the-omission 2A+2B) · Fork 5 (escape door — 5A keep `import:host` platform-only). Both ratify-the-omission (deliberation, no build); close DD1 + unblock the "hide the host" stance ruling (Fork 1 precondition now shipped). DD: `scrml-support/docs/deep-dives/js-host-boundary-foundation-2026-06-07.md` (`in-progress`; Forks 3+4+1 done).
- **`E-ROUTE` arg-direction hole** (S174, filed-separate from 4A): server-fn ARG-direction recurses into struct fields un-gated (return-side already `E-ROUTE-003`-gated). Separate `E-ROUTE` amendment; do NOT bundle.
- **Hook-hardening:** close the path-discipline hook's Bash-write blind spot (intercept Bash main-absolute writes; settings/hook task). Memory `feedback_path_discipline_hook_bash_blindspot`.
- **Typed-SQL LOW tails:** `g-sql-row-protect-leak` · `g-route-arg-fn` · `g-server-keyword-drift` (scrub deprecated `server` from canon — Insight 26 still pervades spec/primer/kickstarter/corpus).
- **Native-parser swap Wave 3** (strategic #1; design-gated; DEFER to M6). TRIAGE: `docs/changes/native-swap-retriage-s166/`.
- **Carry-forward design queue:** L19 multi-statement-handler relaxation; generators policy; DD3 Fork-4 wrap-gate→pre-commit promotion.

## pa.md directives in force
- Rules R1–R5. `---` answer-delimiter. Profile A/B. `full wrap`/88% floor. wrap = 8 steps (6b worktree-cleanup / 6c maps-refresh / 6d state-doc regen+currency-gate).
- Dispatch: S88 isolation · F4 startup-verify · S90 CWD-routing · S99/S126 Bash-edit+no-`cd` (+ S176 hook-Bash-blindspot — self-enforce worktree-absolute prefix on Bash writes) · S136 BRIEF.md · S138 R26+independent-verify · S147 branch-leak coherence · S164 bg-commit-race.
- Memory: `feedback_sweep_all_mentions_newest_first` · `feedback_path_discipline_hook_bash_blindspot` · `feedback_no_batch_ratify_foundational_axioms` · `feedback_limit_primitives_not_godify` · `feedback_verify_before_claim` · `feedback_signal_ruling_scope` · `feedback_show_code_to_reason_about`.

## 🟢 S177 — BUG-TAIL session (R26-triage → 6 fixes + registry currency pass)

User picked the **bug-tail** thread ("3"). Method: R26 reverse-direction triage workflow (18 gaps, `wf_487ef351-f5a`) → classify REPRODUCES / NOT-REPRODUCED on HEAD → 6 fixable bugs (user: "All 6 reproducing bugs") + 6 stale-open closes + 6 defer re-confirms.

### LANDED (staged in main, NOT yet committed — pending user commit auth)
- **6-fix combined dispatch** (`scrml-js-codegen-engineer`, isolation:worktree, branch `worktree-agent-a19a4331e945385f6`, FINAL_SHA `fabd1a0c`, BRIEF.md archived). File-delta'd into main (S147/S99 dual-verify CLEAN — local main 0/0, no leak). **All 6 PA-INDEPENDENT-R26-verified** + pre-commit subset **16,512/0** + full suite (agent) **23,714/0**:
  1. `bug-74` → `<span :@thing/>` fires **E-CLOSER-001** (new `isGenuineShorthandBodyNotDirective` guard; `:let.../>` directive preserved). block-splitter.js. +5.
  2. `bug-4` → `looksLikeCloser` refined: fires at EOF / before-new-opener, NOT before a close tag. **Rule-4 call: corrected 2 LOCKED tests** that locked the over-fire (SPEC §4 L13832 verified; CONF-015 EOF preserved). block-splitter.js. +7.
  3. `bug-48` → parenDepth+bracketDepth ported to 3 ast-builder opener-finders + 2 on=-loops **+ a SECOND locus the brief missed** (emit-match.ts `resolveOnExpr` verbatim fall-through → now lowered via parseExprToNode+emitExpr). +4.
  4. `r28-7b` → schemaFor `[asIs,not]` predicated-base recovery (leading-primitive fallback). type-system.ts. +5.
  5. `s169-map-inline-insert` → inline map-assign routed through emitExprField→emitAssign (emits `_scrml_map_insert`). emit-event-wiring.ts. +4.
  6. `r27-c6` (MED) → **ROOT DIFFERED from brief**: formFor never EXPANDED (walkAndExpandFormForNodes didn't recurse engine `bodyChildren`); +1 line in type-system.ts. +4.
- **NEW gap filed:** `g-formfor-in-match-arm` (MED, gate-caught-loud) — formFor in a `<match>` arm fails E-CODEGEN-INVALID-JS; PRE-EXISTING, now reachable post-r27-c6. Sibling codegen fix.
- **Registry currency:** 6 stale-open closes (r27-c4 S151 · bug-45 S141 · bug-26 S139 · bug-34 · bug-27 not-a-bug · r27-c8 resolved-by-gate) + 6 defer re-confirms (bug-21/bug-12-vkill/bug-22/bug-75[WONTFIX-candidate]/g-component-001-coverage/r28-2b). **Count MED 10→9 · LOW 22→12 (11 net cleared).** `state.ts --check` PASS.

### Commit plan (one PA-authored landing commit, pending auth)
Staged: 5 src + 9 tests + progress.md. To add: known-gaps.md (re-marks) + BRIEF.md + master-list.md (recent-sessions regen) + hand-off.md + handOffs/hand-off-181.md. Message: `fix(s177): bug-tail 6-fix batch + registry currency pass (12 gaps re-marked, +1 filed)`.

## Open questions to surface immediately
1. **COMMIT + PUSH auth** — the 6-fix batch + currency pass is verified-green, staged, NOT committed (per "confirm before first commit"). Awaiting "commit and push" / "commit, no push" / hold.
2. **bug-75 WONTFIX?** — after-`>` engine `:`-shorthand E2E failure is on a *deprecated* form (S160). Marked WONTFIX-candidate; your call whether the deprecated form must work during its window.
3. **Worktree cleanup** — agent worktree `agent-a19a4331e945385f6` retained until landing committed; a pre-existing stray stash (`stash@{0}` "WIP on worktree-wf_fcf9da39") noted in it, NOT the agent's.

## Tags
#session-177 #profile-a-full-start #open
