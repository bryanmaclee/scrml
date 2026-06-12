# scrmlTS — Session 186 (OPEN)

**Date:** 2026-06-12.
**Previous:** `handOffs/hand-off-190.md` (= S185 CLOSE).
**Next-session pickup:** rotate THIS file → `handOffs/hand-off-191.md` at next OPEN.
**Profile:** opened **A (FULL)** (`"read pa.md and start session"` → default A). Full session-start chain done: pa-scrmlTS.md IN FULL (1166L) + PRIMER IN FULL (1465L) + SPEC-INDEX navigation header + Sections table + master-list §0 IN FULL + user-voice tail S176–S185 + git sync + inbox + hooks.

## Session-open state (as of S186 OPEN)

- **HEAD `1de0848a`** (S185 wrap commit). **origin == HEAD** (git sync: scrmlTS 0/0, scrml-support 0/0; both clean). S185's wrap + 2 fix commits all pushed — verified at open.
- **Tests (S185 CLOSE):** full suite **23,946 pass / 0 fail / 221 skip / 1 todo / 983 files**. Live via `bun scripts/state.ts`.
- **known-gaps:** **HIGH 0 · MED 6 · LOW 12 · Nominal 9** (131 @gap tokens). Live via `bun scripts/state.ts` + grep `@gap`.
- **Version:** v0.7.0, no cut pending. **Maps:** watermark `a4726dd3` (HEAD `1de0848a` is the wrap commit carrying the maps; 6c-refreshed at S185 wrap). **Worktrees:** clean (only main checkout). **Inbox:** empty.
- **Commit-gate:** Configuration B (`.git/hooks` — pre-commit + post-commit + pre-push all installed). Leave as-is per S88.

## 🟡 Carry-forward queue (cross-check live `@gap` + git log per verify-before-claim)

1. **`g-derived-engine-expression-form` (LOW, S185)** — §51.0.J `derived=expr` not implemented (only legacy `derived=@machineVar`); confusing diagnostics (E-ENGINE-004 / W-ENGINE-INITIAL-MISSING / E-ENGINE-INVALID-TRANSITION instead of E-DERIVED-ENGINE-NO-WRITE) + PRIMER §7 doc-vs-impl. Repro shapes in the gap body. Full impl = a real ast-builder build (populate `derivedExpr` as a parsed ExprNode → dormant B16 SYM rejections light up); cheaper interim = a clear "expression form not yet implemented" diagnostic.
2. **g-errarm (3) `:`-shorthand block-form match-arm interpolation literal-emit** (`<Done count> : "got ${count}"`) — separate pre-existing shorthand-interpolation gap, flagged carry-forward in the (resolved) g-errarm body. File if it recurs in dog-food.
3. **DG class-attr-consumer candidate** (incidental, unverified) — spurious E-DG-002 on `class="prefix-${@cell}"`. Verify before filing/fixing.
4. **2B documentation deliverable** (DD1 close, S178) — credit the engine-singleton as the typed global reactive store; small additive SPEC/PRIMER note; bundles with the deferred Fork-3 immutability cross-ref (S174).
5. **bug-75** — deferred (after-`>` engine `:`-shorthand E2E fails at BS; LOW + deprecated-form-only).
6. **VERIFIED.md** — S180's 13 changed examples remain open re-verification (USER action).
7. **base-extraction replication** (master-PA territory) — pa-base.md v1 exists; vendoring is cross-repo. scrmlTS PA stays the OG comparison baseline (S182 reframe — do NOT refactor this PA's own contract into base+overlay).

**CARRY-FORWARD gap tails (cross-check live via `bun scripts/state.ts`):**
- **MED (6):** `r28-c2` (kickstarter currency) · `a5` (refinement-freeze) · `bug-1` (Tailwind preflight-blocked) · `bug-12-vkill` (engine-canon-blocked) · `bug-14` (MCP V0.D, §58-blocked) · `bug-17-l19` (L19 relax — HU DESIGN Q).
- **LOW (12):** incl. `g-derived-engine-expression-form` · `g-component-001-coverage` · `g-sql-row-protect-leak` · `g-sse-server-keyword` (KEEP-deferred) · `bug-18`/`19-cite`/`20`/`21`/`22` · `bug-75` · `r28-2b` · `s169-ordered-unordered-build` (Nominal).
- **Big in-flight arc — native parser CHARTER B:** M1 lexer COMPLETE; M2.4 + MK2 next per `docs/changes/native-parser-front-end/IMPLEMENTATION-ROADMAP.md`. Cutover deferred (~v0.8; ~508 flip-failures need FRESH re-triage).
- **Untested dog-food surface (remaining):** channels §38 · schema/migrations §39 · `<each>` §17.7 directly. (S185 swept validators / typed-SQL-row / engine §51 / §36-input.)

## Open questions to surface immediately
- **S184 has NO user-voice entry** (prior-session logging gap; the S185 entry follows S183 in the file). S184's content is in changelog + hand-off-189. Not PA-backfillable verbatim. Flag if the user wants a reconstruction.
- No push-pending state at open (origin == HEAD).

## pa.md directives in force
- Rules R1–R5. `---` answer-delimiter. Profile A/B. `full wrap`/88% floor. wrap = 8 steps (6b worktree-cleanup / 6c maps / 6d state-regen+currency-gate).
- Dispatch protocol: S88 isolation:worktree explicit · F4 startup-verify · S90 CWD · S99/S126 Bash-edit + no-`cd` · S136 BRIEF.md archival · S138 R26/empirical (both directions) · S147 branch-leak coherence + clobber-check · S164 bg-commit-race · S180 waiting-time 3-tier.
- Memory live: `feedback_waiting_time_work_pattern` · `feedback_verify_before_claim` · `feedback_dont_preclassify_fix_as_surgical` · `feedback_signal_ruling_scope` · `feedback_file_delta_vs_cherry_pick` (clobber-check) · `feedback_dont_soft_classify_bugs` · `feedback_sweep_all_mentions_newest_first` · `feedback_limit_primitives_not_godify`.

## Tags
#session-186 #profile-a-full-start #open
