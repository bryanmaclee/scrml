# scrmlTS — Session 187 (CLOSE — recovery session)

**Date:** 2026-06-12.
**Previous:** `handOffs/hand-off-191.md` (= the S186 OPEN hand-off; S186 crashed before wrapping, so 191 is the S186-open record, not a clean S186 CLOSE).
**Next-session pickup:** rotate THIS file → `handOffs/hand-off-192.md` at next OPEN.
**Profile:** opened as a **recovery** task (`"read pa.md ... last session shut down unexpectedly. recover whats possible"`). Not a full design session — read pa-scrmlTS.md IN FULL (partial, 533/1166L — enough for recovery) + the crash-recovery memory rules; did NOT do the full PRIMER/SPEC-INDEX/master-list bulk reads (recovery scope).

## What this session was: recovery of S186's unexpected crash

S186 (Profile A) shut down **twice** mid-dispatch — both "socket connection closed unexpectedly" (environmental API instability, not task failure). S187 salvaged everything and completed the in-flight work. **Nothing was lost.**

**Recovered + landed:**
- `658cb1a9` (channel codegen — S186) — was committed, already pushed.
- `538fe2d2` (S186 tutorial-staleness audit) — was committed but **unpushed**; recovered + pushed.
- **`d47177fc` — tutorial staleness remediation A–E** (executes the S186 audit `docs/audits/tutorial-staleness-audit-2026-06-12.md`, items A1–E21). Completed across the 2 crashes + a PA-direct finish. DOCS-only. See `docs/changes/tutorial-staleness-remediation-2026-06-12/progress.md` for the full crash-recovery trail (BRIEF.md + CONTINUATION-BRIEF.md archived).

**Recovery technique (banked as memory `feedback_repeated_dispatch_crash_pa_direct`):** salvage uncommitted work → branch SHA first; continue a crashed dispatch via a fresh `isolation:worktree` agent that FF-merges the dead agent's recovered branch; after ~2 environmental crashes on a small mechanical remainder, switch to crash-proof PA-direct (file-delta recovered branch → main, finish + compile-verify each edit); land-before-cleanup.

## Session-close state (as of S187 CLOSE)

- **HEAD `d47177fc`** (S187 remediation). **origin == HEAD** (pushed `658cb1a9..d47177fc`). Coherence-checked clean (0 left / 2 right at push). *(The wrap commit lands AFTER this hand-off is written — see "Open questions"; if you're reading this, confirm the wrap commit + its push happened.)*
- **Tests (S187 CLOSE, full suite):** **23,957 pass / 0 fail / 221 skip / 1 todo / 983 files / 24,179 ran / 79,709 expect**. (S185 was 23,946; +11 entirely from the S186 channel-codegen `658cb1a9` `channel.test.js`; the tutorial remediation is docs-only, 0 test delta.) Live via `bun scripts/state.ts`.
- **known-gaps:** **HIGH 0 · MED 9 · LOW 15 · Nominal 9** (139 @gap tokens). Grew during S186 (channel dog-food + the audit's `g-not-negation-unenforced` LOW filing). Live via `bun scripts/state.ts` + grep `@gap`.
- **Version:** v0.7.0, no cut pending. **Maps:** 6c project-mapper refresh ran at wrap (watermark a4726dd3 → d47177fc; error.map + structure.map updated for the S186 channel-codegen delta). **Worktrees:** clean (only main; both crashed worktrees cleaned up after content landed). **Inbox:** empty.
- **Commit-gate:** Configuration B (`.git/hooks` — pre-commit + post-commit + pre-push). Leave as-is per S88.
- **Tutorial:** `docs/tutorial.md` + all 11 snippets now current (verify-tutorial.sh 11/11). All 4 HIGH audit defects fixed. The audit doc `docs/audits/tutorial-staleness-audit-2026-06-12.md` is now fully remediated (status could flip to `historical` if desired — left `current` for now).

## 🟡 Carry-forward queue (cross-check live `@gap` + git log per verify-before-claim)

Inherited from the S186-open queue (hand-off-191) — unchanged except where noted:

1. **`g-not-negation-unenforced` (LOW, S186 NEW)** — E-TYPE-045 under-enforced: `not x` prefix-negation compiles clean despite SPEC §42.10 (the tutorial now teaches the SPEC-correct `!`; the COMPILER fix is the separate gap). Candidate dog-food/fix follow-on.
2. **`g-derived-engine-expression-form` (LOW, S185)** — §51.0.J `derived=expr` not implemented (only legacy `derived=@machineVar`); confusing diagnostics. Interim = a clear "expression form not yet implemented" diagnostic; full = an ast-builder build populating `derivedExpr`.
3. **S186 channel dog-food gaps (MED/LOW)** — the channel-codegen fix `658cb1a9` filed several S186 dog-food gaps (MED 6→9, LOW 12→14). Cross-check live via `bun scripts/state.ts` + grep `@gap` for the exact ids/bodies (this PA did not enumerate them — recovery scope).
4. **g-errarm (3) `:`-shorthand block-form match-arm interpolation literal-emit** — pre-existing shorthand-interpolation gap; file if it recurs in dog-food.
5. **DG class-attr-consumer candidate** (incidental, unverified) — spurious E-DG-002 on `class="prefix-${@cell}"`. Verify before filing/fixing.
6. **2B documentation deliverable** (DD1 close, S178) — credit the engine-singleton as the typed global reactive store; small additive SPEC/PRIMER note; bundles with the deferred Fork-3 immutability cross-ref (S174).
7. **bug-75** — deferred (after-`>` engine `:`-shorthand E2E fails at BS; LOW + deprecated-form-only).
8. **VERIFIED.md** — S180's 13 changed examples + any tutorial-snippet re-verification remain open (USER action).
9. **Native parser CHARTER B** — M1 lexer COMPLETE; M2.4 + MK2 next per `docs/changes/native-parser-front-end/IMPLEMENTATION-ROADMAP.md`. Cutover deferred (~v0.8).
10. **Untested dog-food surface (remaining):** channels §38 (partially swept S186) · schema/migrations §39 · `<each>` §17.7 directly.

**CARRY-FORWARD gap tails (cross-check live via `bun scripts/state.ts`):**
- **MED (9):** the S185 tail (`r28-c2` · `a5` · `bug-1` · `bug-12-vkill` · `bug-14` · `bug-17-l19`) + 3 S186 channel dog-food gaps (enumerate live).
- **LOW (15):** the S185 tail + `g-not-negation-unenforced` + S186 channel dog-food LOWs (enumerate live).

## Open questions to surface immediately
- **Wrap commit + push:** this hand-off was written as part of the S187 wrap. The wrap commit (hand-off + changelog S186/S187 + master-list + 6c maps + 6d state-regen) lands after this file is finalized; confirm it committed + pushed (user said "wrap it" → all 8 steps incl. push per the bare-"wrap" default).
- **S186 had no clean CLOSE** — its hand-off (hand-off-191) is the S186 *open* state. S186's two landings are reconstructed in the S187 changelog from the commits. S186 also had no user-voice entry (prior-session logging gap, same as the S184 gap noted in hand-off-191).
- **The S186 channel dog-food gaps were NOT enumerated by this PA** (recovery scope) — next session should `bun scripts/state.ts` + grep `@gap` to list the exact new MED/LOW gap ids before triaging.

## pa.md directives in force
- Rules R1–R5. `---` answer-delimiter. Profile A/B. wrap = 8 steps (6b worktree-cleanup / 6c maps / 6d state-regen+currency-gate).
- Dispatch protocol: S88 isolation:worktree explicit · F4 startup-verify · S90 CWD · S99/S126 Bash-edit · S136 BRIEF.md archival · S138 R26/empirical · S147 branch-leak coherence · S164 bg-commit-race · S180 waiting-time.
- Memory live this session: `feedback_agent_crash_partial_recovery` · `feedback_land_before_cleanup` · `feedback_file_delta_vs_cherry_pick` · `feedback_pa_file_delta_base_check` · `feedback_branch_leak_coherence_check` · `feedback_pa_bash_cleanup_dry_run` · `feedback_background_commit_race` · **`feedback_repeated_dispatch_crash_pa_direct` (NEW this session)** · `feedback_nonisolated_agent_shared_index` (project-mapper 6c).

## Tags
#session-187 #recovery #crash-recovery #tutorial-staleness-remediation #close
