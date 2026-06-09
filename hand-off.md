# scrmlTS — Session 175 (CLOSE)

**Date:** 2026-06-09 (opened 2026-06-08; spanned midnight)
**Previous:** `handOffs/hand-off-179.md` (= S174 CLOSE).
**Next-session pickup:** rotate THIS file → `handOffs/hand-off-180.md` at next OPEN.
**Profile:** opened **A (FULL)** ("read pa.md and start session"; default A). `/effort` → **ultracode**.
**Wrap:** `wrap and push` — 8-step wrap executed (incl. 6b worktree-cleanup + 6c maps-refresh + 6d state-doc regen + currency gate + step-7 push).

## 🟢 S175 CLOSE — typed-SQL-row arc T1+T2+T3 SHIPPED end-to-end on the flagship · function-boundary rule (4A + passed-vs-stored + Fork-3) SHIPPED

A long multi-arc Profile-A session. **Two feature deliveries, both fully verified, both pushed.** Five compiler-source dispatches, all survey-gated with landing-review (one caught a deprecated-`server`-keyword view-selection + I stripped it; one caught the flagship laundering + filed it as the connecting tranche).

### STATE AS OF CLOSE
- **HEAD:** the wrap commit (this) + the maps commit, on top of `9e6156c4` (function-boundary). scrmlTS origin **0/0** after the wrap push. scrml-support origin **0/0** (2 commits: `4baeff4` design-insight/recon-DD-current + the user-voice S175/S175(cont) record).
- **Tests:** full suite **23,538 / 0 fail / 220 skip / 1 todo** (S174 close 23,484; +54 across the typed-SQL-row arc; function-boundary net-zero [+11 reject tests replaced the warning tests]). Pre-commit subset **16,344 / 89 / 0**. `bun scripts/state.ts --check` PASS.
- **known-gaps:** **HIGH 0 · MED 10 · LOW 22 · Nominal 9** (live via `@generated:gap-counts`). S175 deltas: RESOLVED `g-sql-row-type` + `g-sql-row-typeflow` (MED−2); FILED `g-server-keyword-drift` (LOW), `g-sql-row-protect-leak` (LOW), `g-sql-row-typeflow` (resolved same session) (LOW+2).
- **Version:** v0.7.0, no cut.
- **Worktrees:** **main only** (5 session worktrees cleaned at 6b). **⚠ 2 ORPHAN branches remain — NOT this session's, NOT deleted:** `worktree-agent-a48bf500147b36c24` + `worktree-agent-a902a67a8980303f6` (no worktree, prior session — the dry-run caught them; left untouched per the S87 must-not-touch precedent). **Next session: investigate + clean if confirmed-landed/abandoned.**
- **Maps:** refreshed 6c (project-mapper incremental on the session's type-system/SPEC landings) — watermark advanced to the maps commit. (The maps had been STALE for `type-system.ts` across all 4 type-system landings; every dispatch agent reported it + grep-recovered current loci — the refresh closes that.)
- **Inbox:** empty.
- **Untracked:** none (the 5 `.wf-*.js` scratch deleted at wrap).

### S175 ARC (what shipped)

**1. Typed-SQL-row feature — Shape C RATIFIED + built T1→T2→T3, end-to-end on the flagship.** The S174 blind-DD convergence (SPEC §14.8.7 mandates typed SQL rows; `type-system.ts:7305` hard-coded `tAsIs()`) → user presented the side-by-side → ruled **Shape C** (a consumer authors a plain `:struct` prop contract; a SQL projection row STRUCTURALLY width-subtypes into it; bounded to SQL-row→`:struct`, general struct assignment stays nominal) → then **(B)** (full struct-return type-flow).
- **`45bea7c5` T1** (read-site row typing): `sql-projection.ts` (SELECT-projection extractor) + `resolveSqlRowType` (`case sql` + let/const sqlNode path) + F-SCHEMA-001 (`<schema>` as 3rd ColumnDef source) + `W-SQL-ROW-UNTYPED` + `E-TYPE-051` any→asIs. **View-selection stripped pre-landing** (keyed on the deprecated `server` keyword — caught at landing-review).
- **`1dbf67b4` T2** (prop-contract mechanism): SPEC §14.8.8 + `checkSqlRowWidthSubtype` + `E-SQL-ROW-CONTRACT-MISMATCH` + T2a (dormant `E-TYPE-004` wired live + for-of/`<each>` element-type thread). Agent Phase-0 caught the flagship-laundering no-op → dogfood reverted + `g-sql-row-typeflow` filed.
- **`95c25b67` T3** (the connecting middle, B): T3a (state-decl SQL-init) + T3b (cell-boundary width-subtyping) + T3c (`inferReturnTypeFromBody` — bounded fn-return-type inference; `<fn-return>` over-approx E-TYPE-004-exempt). **Flagship `board.scrml` chain types end-to-end** (`@loadRows: LoadCardRow[]`); **engage-test PROVED** the check fires on a real contract break (not a no-op). Codegen byte-identical. `g-sql-row-type` + `g-sql-row-typeflow` RESOLVED.

**2. Function-boundary rule (S174-ratified) — `9e6156c4`.** **4A** (function-typed struct fields REJECTED: `W-TYPE-FN-FIELD`→hard `E-STRUCT-FUNCTION-FIELD` + wire `FunctionType` through `resolveTypeExpr`, closing the int-for-fn hole) + **name-the-rule** (NEW SPEC §15.11.5.1: "a function may be PASSED or CALLED, never STORED as value data"; unifies W-COMPONENT-001-PASSED + E-STRUCT-FUNCTION-FIELD-STORED; W-COMPONENT-001 NOT escalated) + **Fork-3 doc tail** (§15.11.2 Clojure identity/value reconciliation). Corpus scan: ZERO fn-typed struct fields across 930 `.scrml` (S174 "zero cost" confirmed). Recon DD `passed-vs-stored-function-boundary-2026-06-08.md` → current/RATIFIED.

### PROCESS NOTES (for next session)
- **2 orphan branches** (`a48bf500`, `a902a67a`) — investigate + clean (above).
- **Agent committed to scrml-support main** (`4baeff4`, the function-boundary agent): the brief authorized the design-insight + recon-DD-frontmatter EDITS but not the COMMIT. Content was correct + bounded (no damage), kept. **Going-forward: dev-agent briefs that touch scrml-support SHALL say "make the edits; do NOT commit scrml-support — PA lands the storage writes."** Candidate pa.md addendum.
- **Survey-gated landing-review worked twice as the safety net** (the view-selection strip; the laundering catch) — the pattern (agent surveys + reports design in Phase-0; PA reviews at landing; revert+re-dispatch on a wrong design choice) held across 5 dispatches.

### CARRY-FORWARD QUEUE (all need user direction)
- **DD1 (JS-host foundation) remaining forks** — Fork 1 (scalar vocab: `scrml:math` 1A + capability-clock 1C — flagged HIGHEST-LEVERAGE next build, precondition of any "hide the host" ruling) · Fork 2 (global-store, ratify-the-omission) · Fork 5 (escape door). One-axis-at-a-time per `feedback_no_batch_ratify_foundational_axioms`. DD: `scrml-support/docs/deep-dives/js-host-boundary-foundation-2026-06-07.md`.
- **Typed-SQL-row deferred tails:** `g-sql-row-protect-leak` (LOW — the protected-column-projection leak; data-flow/return-boundary follow-on); broad unrecognized-type-leak `g-unknown-type-leak` (MED — the committed S174 "2 must-follow-soon"); `g-component-001-coverage` (LOW — W-COMPONENT-001 vestigial); `g-route-arg-fn` (LOW — E-ROUTE arg-direction); `g-server-keyword-drift` (LOW — scrub `server function` from canon, 207× SPEC/31× kickstarter/7× PRIMER/12 flagship).
- **Native-parser swap Wave 3** (strategic #1; ~508 flip-failures) — design-gated; DEFER to M6. TRIAGE: `docs/changes/native-swap-retriage-s166/`.
- **Carry-forward design queue:** L19 multi-statement-handler relaxation; generators policy; DD3 Fork-4 wrap-gate→pre-commit promotion (optional).

### pa.md directives in force
- Rules R1–R5. `---` answer-delimiter. Profile A/B. `full wrap`/88% floor. wrap = 8 steps (6b/6c/6d).
- Dispatch: S88 isolation · F4 startup-verify · S90 CWD-routing · S99/S126 Bash-edit+no-`cd` · S136 BRIEF.md · S138 R26+independent-verify · S147 branch-leak coherence · S164 bg-commit-race.
- `feedback_no_batch_ratify_foundational_axioms` · `feedback_verify_before_claim` (R26-reverse) · `feedback_signal_ruling_scope` · `feedback_limit_primitives_not_godify` · `feedback_pa_bash_cleanup_dry_run` (caught the 2 orphans this wrap) · `feedback_show_code_to_reason_about`.

## Tags
#session-175 #profile-a-full-start #typed-sql-row-arc-complete #function-boundary-rule #wrap-and-push
