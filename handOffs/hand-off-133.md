# scrmlTS — Session 130 (CLOSE)

**Date:** 2026-05-25 (OPEN) → 2026-05-25 (CLOSE; same-day marathon)
**Previous:** `handOffs/hand-off-132.md` (S129 CLOSE — grammar-lockdown plan + 3 audits + HU-2 batch + D8a-i parser fix)
**Machine:** same as S129.
**HEAD at S130 OPEN:** `110cbf64` (S129-CLOSE chore — hand-off rotation that was untracked all S129).
**HEAD at S130 CLOSE:** will advance one wrap-commit chain (this hand-off + master-list + changelog + user-voice).
**pkg.json:** 0.6.0 (no tag cut this session).
**Push state at close:** scrmlTS PUSHED at wrap (will retry with whatever rebase needed); scrml-support PUSHED at wrap.

**Mid-session push happened too** — README mid-session push at `3814c738` went public for the user to fix a repetition (the `36d76ab2` external commit on origin). Local rebased clean post-push.

---

## S130 CLOSE SUMMARY — read first

A marathon session. Started under "Phase 2 amendment work" from S129 grammar-lockdown carry-forward; expanded into a multi-arc work-block covering Phase 2 (4 clusters), README pivot, 3-DD parallel batch (lifecycle + iteration + MCP V0.D impl), 2 HU sessions, dev.to publication checklist + retraction stamp, known-gaps comprehensive refresh, Q3 RE-RATIFICATION (catch of previous-PA spelling error), and README hero migration to ratified iteration surface.

**Substantive landings (chronological; ~20 commits):**

| # | What | Commit | Closes |
|---|---|---|---|
| 1 | Phase 2 Cluster C (PIPELINE deriveEngineVarName) | `05e239ba` | F-021 (1b LB) |
| 2 | Phase 2 Cluster D (§39 schema placement) | `76149424` | F-019 (1b LB) |
| 3 | Phase 2 Cluster E (§55.5 validity surface predictability) | `5c9bca73` | F-018 (1b LB) |
| 4 | Phase 2 Cluster B-doc (Approach C SPEC subsumption) | `86a1f815` | F-002 / F-003 / F-009 (1a) / F-010 / Q4 |
| 5 | README MCP + L22 + V-kill + quality-wins refresh | `3814c738` | **PUSHED PUBLIC mid-session** |
| 6 | 3 parallel DDs batch — Lifecycle (919L) + Iteration (1028L) + MCP V0.D impl shipped | DD progress + `2b51da82` | Lifecycle DD + Iteration DD + MCP V0.A+B+C+**D** sub-units |
| 7 | Lifecycle HU-1 (7 questions ratified) | `fca1d401` | Lifecycle HU 7-of-7 |
| 8 | dev.to publication checklist + retraction stamp | `ee0d048e` | S117/S118/S129 article-update-package carry-forward |
| 9 | known-gaps comprehensive refresh (76→246 LOC) | `9cdec3c1` | user-flagged "incomplete + inaccurate" |
| 10 | Phase 2 Cluster B-code (Approach C source-cascade) | `35262911` | F-002/F-003/F-009/F-010 compiler half — 9-of-10 sites; Site 1 DEFERRED |
| 11 | Phase 2 Cluster A (V-kill SPEC sweep A1-A6 + ~90 sites) | `b0244869` | F-001 / F-008 / F-009 / F-016 (1a/1b LB) |
| 12 | Lifecycle Landing 1 (E-TYPE-001 access-before-transition fire) | `1feaedc9` | Bug 8 (HIGH) — closes the ~6+ week SPEC §14.3 spec-vs-impl gap |
| 13 | known-gaps rotation (Bug 8 → §7 closed) | `d92c7c6a` | tracks Landing 1 ship |
| 14 | Iteration HU-1 (8 questions ratified; 5-landing scope) | `40115bad` | Iteration HU 8-of-8 incl. user spit-ball `<each of=N>` |
| 15 | Q3 RE-RATIFICATION (actual §4.14 form `<li : @.name>`) | `2e9d56ec` | Catches previous-PA's S129 spelling error |
| 16 | README nominal-framing + hero `<each>` migration | `1d161fd9` | user direction to loosen gating mandate |
| (17+) | Wrap chain | (this chain) | session bookkeeping |

(Post-mid-session-push commits 6-16 were rebased onto `36d76ab2` for the wrap push — original SHAs were `35262911 / b0244869 / 1feaedc9 / d92c7c6a / 40115bad / 2e9d56ec / 1d161fd9` and after rebase advanced as `e451a37f / dca7d56e / 5bc1a2e4 / d2b05c4a / [iteration-HU + Q3 + README]`. The SHAs in the table are the IDs from before-rebase; consult `git log origin/main` for post-rebase IDs.)

**Tests at close:** **21,462 pass / 0 fail / 170 skip / 1 todo / 787 files** (+48 vs S129 baseline 21,414).

**Banked methodology (2 new memory files):**
- `feedback_show_code_to_reason_about.md` — load-bearing HU questions get worked code examples, not snippets. User direction at iteration HU-1 Q5.
- `feedback_dd_brief_read_session_log.md` — DD briefs about prior-session ratifications READ the JSONL session log, not just carry-forward summaries. Two S130 precedents: iteration DD missed `@.` + Q3 RE-RATIFICATION caught the §4.14 spelling error.

**S99 path-discipline counter:** holds at **15** — zero leaks across 4 worktree dispatches this session (Phase 2 Cluster A + B-code + Lifecycle Landing 1 + MCP V0.D).

---

## S130 substantive arcs (full detail)

### Arc 1 — Phase 2 grammar-lockdown amendments (HU-2 ratifications)

Closed 5 of the 5 HU-2 amendment clusters (C/D/E/B-doc/B-code + A). All ratified S129; landed S130.

**Cluster sequence:** C (PIPELINE) → D (§39 schema) → E (§55.5 validity) → B-doc (SPEC text for Approach C cascade) → B-code (compiler-source cascade) → A (V-kill SPEC sweep).

**Banked observation re-validated 4x in HU-2 + extended 2x in Phase 2 execution (now 6x):** PIPELINE / SPEC prose drift from already-correct compiler behavior is the dominant Phase 2 work shape. Compiler is more spec-canonical than the documentation around it. Phase 2 amendment work is predominantly doc-text editing.

**Cluster B-code subtlety surfaced:** brief assumed "zero callers" of `rewriteBunEval` per Q4 grep verification claim. Agent's mandatory Phase-0 root-cause confirmation found **7 active callers**. Site 1 DEFERRED with 3 prerequisite sub-tasks (META_BUILTINS purge → 5 meta-eval call drops → Pass 4 drop + test retire). [[feedback_cookbook_vs_empirical]] earning its keep.

**Cluster A subtlety surfaced:** §50.3.4 `@x = computeValue()` example illustrates "assignment as expression" with NO surrounding declaration context. Would otherwise fire `E-STATE-UNDECLARED` under post-V-kill canon. Migrated to add prose note ("the `<x>` cell is assumed declared elsewhere — §6.1.5") — cleanest fix for an example whose narrative purpose IS the WRITE-expression semantics.

### Arc 2 — README mid-session push (gating loosened + hero migration)

Two README touches this session:

1. **Mid-session push** (`3814c738`) — MCP + L22 type-derived family + V-kill enforcement strengthen + quality-wins callout. PUSHED public mid-session per "I want that public as soon as possible." User externally added `36d76ab2 Fix repetition in LLM Agent Integration section` on origin between then and the wrap-time push.
2. **Wrap-pivot README** (`1d161fd9`) — user direction: *"I have decided to loose a prior mandate on the code examples in the readme. can we make the code, more scrml-y as of all of these decisions. and just be honest that they are NOMINAL examples and the compiler is in progress."*
   - Gating note loosened to NOMINAL-honest framing
   - Contact-book hero iteration migrated `${for/lift}` → `<each in=loadContacts()>` + `<empty>` + `@.` per S130 iteration HU-1
   - `// gate: skip` mechanical prefixes dropped (3 sites; framing notes preserved)

**Carry-forward:** lifecycle annotation `(A to B)` demonstration in README is held for Lifecycle Landing 3 (PRIMER + kickstarter flagship per F-023) where prose explanation accompanies; not just example mutation.

### Arc 3 — 3-DD parallel batch (Lifecycle + Iteration + MCP V0.D)

User direction: *"lets go on all of the prepped DDs"*. Dispatched 3 agents in parallel:

**Lifecycle DD** (`scrml-deep-dive`, no isolation per pa.md S88 exception): 919L deep-dive at `scrml-support/docs/deep-dives/lifecycle-annotation-extension-and-flagship-scope-2026-05-25.md`. **PA lean Approach C** — extend `(A to B)` to non-engine cell positions; carve out engine cells explicitly. 7 HU questions surfaced (4 with PA lean; 3 GENUINE DESIGN QUESTION). Critical compiler-gap finding: `type-system.ts:1444` resolves `(A -> B)` to type B but doesn't track per-access transition state — E-TYPE-001 fire promised in SPEC §14.3 line 7106 was unimplemented.

**Iteration DD** (`scrml-deep-dive`, no isolation): 1028L deep-dive at `scrml-support/docs/deep-dives/iteration-design-surface-2026-05-25.md`. NO PA lean (explicitly user-deliberative). 8 HU questions surfaced starting with designer-card-shaped Q1. 3 viable candidates (Approach A status-quo / B/D `<each>` element / E `each=` attribute). Designer-card option for veto kept. **DD MISSED key S129 ratifications** (`@.` sigil + `<ul for=>` parent attribute proposal + `$` body-mode proposal) — caught at iteration HU-1 Q2 surface time; banked as the DD-brief-authoring extension rule.

**MCP V0.D impl** (`scrml-js-codegen-engineer`, isolation:worktree with full F4+S99+S126 disciplines): `<program mcp>` attribute wiring + auto-install per SCOPING §3.D. 7 files / +638 LOC / +14 tests / 0 regressions. Build-mode detection finding: no canonical dev-vs-production hook in compiler today; implemented as RUNTIME NODE_ENV gate in generated `_server.js` per pa.md Rule 3 (minimum-viable correct); revisit when §58 Build Story implementation lands.

**MCP V0 status now: A+B+C+D shipped; E (E2E + adopter docs + fixture multi-page app) queued ~10-12h per SCOPING §3.E.**

### Arc 4 — Lifecycle HU-1 (all 7 questions ratified; 3-landing scope)

| Q | Ratified |
|---|---|
| Q1 (cluster direction) | c — extend non-engine; carve out engine |
| Q2 (sequencing) | b — fire first (Landing 1), then extend (Landing 2) |
| Q3 (fn-return lifecycle) | a — extend (transition-marker mechanism Landing 2 sub-Q) |
| Q4 (schema-field placement) | a — §14.X canonical; §39 cross-refs |
| Q5 (engine-cell rejection code) | a — new `E-TYPE-LIFECYCLE-ON-ENGINE-CELL` |
| Q6 (SPEC section placement) | a — new §14.X "Lifecycle Annotation" subsection |
| Q7 (channel-cell extension) | a — extend (channel cells in Approach C scope) |

Phase 2 scope = 3 landings: Landing 1 (E-TYPE-001 fire — SHIPPED) → Landing 2 (Approach C extension SPEC) → Landing 3 (PRIMER + kickstarter flagship per F-023).

### Arc 5 — Iteration HU-1 (all 8 questions ratified; 5-landing scope; user spit-ball adopted)

| Q | Ratified |
|---|---|
| Q1 (designer-card) | a — ship structural-markup-first surface |
| Q2 (element vs attribute) | a — element `<each>` (S129 pre-ratification confirmed) |
| Q3 (`:`-shorthand body) | RE-RATIFIED — **actual §4.14 form `<li : @.name>`** (caught previous-PA spelling error) |
| Q4 (empty-state) | a — `<empty>` sub-element |
| Q5 (key= requirement) | d — inferred + W-EACH-KEY-001 lint (post-worked-example surface) |
| Q6 (binding + index) | **b+** — user spit-ball — `<each in=>` + `<each of=N>` two constructs sharing same machinery |
| Q7 (promotion ladder) | a — Tier 0 → Tier 1 + CLI + eventual sunset |
| Q8 (kickstarter amend) | a — positive-statement rewrite with design-evolution story |

**User spit-ball ratified:** `<each of=N>` count-iteration sibling to `<each in=@items>` collection-iteration. Semantic rule: `@.` is always "the current iteration value" — item in `in=`, index in `of=`. Avoids the `Array.from({length: N})` workaround for count-iteration.

**Phase 2 scope = 5 landings:**
1. Compiler-source impl (isolation:worktree dispatch)
2. SPEC amendment (NEW §17.X + §17.4 marked Tier 0 + §56 promotion extended)
3. `bun scrml promote --each` CLI subcommand
4. PRIMER + kickstarter F-NEW catch-up
5. Corpus migration (113 sites; gradual via CLI; W-EACH-PROMOTABLE info → warning → error → parser-strip sunset)

### Arc 6 — Q3 RE-RATIFICATION (the catch)

User flagged previous-PA's S129 `<li>:@.name</>` claim: *"the only thing Im hazy about is the colon, the last pa referenced the syntax as if it was ratified but it reads like type anotation to me."*

PA pulled SPEC §4.14 to verify. The previous PA at S129 had conflated three ideas (user's `$` body-mode spit-ball + actual §4.14 `:`-shorthand + a new body-prefix `:` shape) and written `<li>:@.name</>` claiming "already ratified per §4.14." The shape written wasn't §4.14 (which puts `:` INSIDE the opener with mandatory whitespace, NO closer).

**RE-RATIFIED to actual §4.14 form `<li : @.name>`.** Phase 2 scope SIMPLIFIED — Landing 1 leverages existing §4.14 mechanism (no new body-shorthand grammar needed); Landing 2 SPEC amendment just adds `<each>` body to §4.14's "loci where `:`-shorthand is legal" list per §4.14 line 983.

**Banked NEW memory rule** [[feedback_dd_brief_read_session_log]] — even within-session PA-recall claims need SPEC verification.

### Arc 7 — dev.to publication checklist + retraction stamp

User direction: *"I have also let the forward facing articles on dev.to get really stale, I believe we have already scoped the changes and retractions (living compiler) I want to get that done."*

Verified in-repo state: 12 dev.to articles all have S115 audit-recommended fixes applied (Living Compiler links scrubbed; version-currency messaging-language; mutability-contracts FIX-WITH-ANNOTATION; tier-ladder status banner clean). Retraction draft at `docs/articles/living-compiler-retraction-devto-2026-05-21.md` is publication-ready.

Built `docs/articles/dev-to-publish-checklist-2026-05-25.md` (14 platform actions: STEP 1 publish retraction → STEP 2 banner-prepend on original → STEP 3 paste-replace bodies for 12 articles). Surfaced retraction draft for final read-and-stamp; user stamped (`d` "Stamped — publish as-is"). Adopter platform actions are now in user's hands.

### Arc 8 — known-gaps.md comprehensive refresh

User flagged: *"I don't think the known-gaps.md is a complete and accurate reference."* Confirmed — last updated S109 (2026-05-19, ~7 sessions stale); only tracked 2 open gaps (Bug 1 Tailwind residuals + Bug 4 bare-`/`).

Comprehensive refresh: 76 → 246 LOC. New structure: at-a-glance counts (HIGH 4 / MED 7 / LOW 4 / Nominal 7) + per-gap workarounds + reproducer pointers + §7 rotation section for S110-S130 closures. Now reflects:
- E-TYPE-001 lifecycle fire (in-impl S130 — rotated to closed after Lifecycle Landing 1 shipped)
- compiler-managed-async A9-class gap (deferred)
- §29 vanilla-interop SPEC drift (open user decision)
- 6nz-V (GENUINE)
- Bug 1 Tailwind preflight-blocked residuals
- V-kill READ-side fire (deferred)
- E-SCHEMA-003 enforcement (spec'd no-fire)
- MCP V0 partial-impl + 3 deferred items
- 7 Nominal sections (Build Story §58, import:host, quoted-text fire, _{}, WASM sigils, sidecars, RemoteData)
- All recent bug closures rotated through §7

---

## State-as-of-close

| Item | Value |
|---|---|
| HEAD | (will advance through wrap-commit chain) |
| pkg.json | 0.6.0 (no tag) |
| Tests (S130 CLOSE) | **21,462 pass / 0 fail / 170 skip / 1 todo / 787 files** (+48 from S129 baseline 21,414) |
| Worktrees | main only |
| Working tree | (after wrap-commits) clean |
| scrmlTS push state | PUSHED (or will be by wrap-end) |
| scrml-support push state | PUSHED at wrap (was 3 commits ahead pre-wrap; user-voice S130 append + 2 DD outputs landed at wrap) |
| Hooks | configuration B (pre-commit + post-commit + pre-push); pre-commit PASSED on every commit |
| S99 path-discipline counter | **15** (zero new leaks across 4 worktree dispatches this session) |

## Open carry-forward (sequenced by priority)

### Highest priority (ready to dispatch)

1. **Lifecycle Landing 2** — Approach C extension SPEC + tests. NEW §14.X subsection covering Shape 1 cells + fn params + fn return + schema fields + channel cells; `->` → `to` glyph migration per S129 F-024 (folds in); `E-TYPE-LIFECYCLE-ON-ENGINE-CELL` engine-cell rejection diagnostic; §39 cross-ref to §14.X with SQL-shape addendum; worked examples per extension position. Open Phase 2 sub-Q: fn-return transition-marker mechanism (α/β/γ/δ candidates).
2. **Iteration Landing 1** — compiler-source impl per iteration HU-1 ratifications. `<each>` element + `@.` sigil + `<empty>` + `key=` inference + `<each of=N>` count form + `as name` override + `:`-shorthand body composition (leverages existing §4.14 — just adds `<each>` to locus list per Q3 RE-RATIFICATION) + W-EACH-PROMOTABLE + W-EACH-KEY-001 + new §34 catalog rows.
3. **MCP V0.E** — E2E + adopter docs + fixture multi-page app per SCOPING §3.E (~10-12h).
4. **Phase 2 Cluster B-code Site 1** retirement sub-task arc (META_BUILTINS purge → 5 meta-eval call drops → Pass 4 drop + bun-eval.test.js retire).

### High priority (ratification-ready; dispatch after above)

5. **Lifecycle Landing 3** — PRIMER + kickstarter flagship section per F-023 (after Landing 2 prose stable). Substantial doc-authoring; ~25-40h spread across sessions.
6. **Iteration Landing 2** — SPEC amendment (NEW §17.X + §17.4 marked Tier 0 + §56 promotion extended).
7. **Iteration Landing 3** — `bun scrml promote --each` CLI subcommand.
8. **Iteration Landing 4** — PRIMER + kickstarter F-NEW catch-up.
9. **Iteration Landing 5** — Corpus migration (113 sites; gradual via CLI).

### Carry-forward (deferred / needs user direction)

- **dev.to publication platform actions** — user holds the 14-action checklist; PA awaits post-completion note
- **Lifecycle HU follow-on** — Q3 fn-return transition-marker mechanism (α/β/γ/δ candidates from Landing 2 design surface)
- **state-dynamics-design DD other open Qs** (status: active since 2026-04-08; beyond the extension question Lifecycle HU-1 closed)
- **L19 multi-statement-handler relaxation** — HU follow-on; sibling iteration-adjacent
- **`$(param){...}` fn shorthand** — separate logic-context-thinness; not iteration. Carry forward for a future HU on logic-context density.
- **`<if>` half of "no markup tags" kickstarter rule** — not amended in iteration HU-1
- **Phase 2 Cluster A Q5.B sub-questions** (server+pinned composition / server+validators firing point / Tier-1 vs Tier-2 doc overlap) — HU-3
- **Phase 1c 8-cluster catch-up** (H-O — 26 GAP findings F-025-F-055 from S129; 11 LB)
- **E-SCHEMA-003 enforcement** (compiler-side; spec'd no-fire per Q7 HU-2 follow-on)
- **versioning drift** reconcile (pkg.json 0.6.0 vs changelog) before any tag cut
- **§29 vanilla-interop** open user decision (retire vs implement)
- **`~snapshot`** raw-sigil design
- **Generator policy** (S114 open)
- **6nz-V** (GENUINE class:NAME-on-for-lift runtime path; MED)
- **GITI-015** (LOW)
- **6nz-U / 6nz-L/T** (queued)
- **Build Story §58** (Nominal; M6-gated; ~90-200h impl arc)
- **`import:host` §21.3.1** (Nominal; self-host bootstrap migration territory)
- **Quoted-text §4.18 compiler fire** (Nominal; Waves 2+ with native parser)
- **Compiler-managed-async A9-class gap** (deferred per S126)

## Operational learnings carried from S130 (apply next session)

1. **Read .claude session JSONL for verbatim user proposals when authoring DD briefs about prior-session ratifications.** Carry-forwards are summaries; brief-authoring abstracts past verbatim shapes. [[feedback_dd_brief_read_session_log]] — banked S130.
2. **Surface worked code examples (multi-line realistic adopter scenarios) for load-bearing HU questions, not tiny syntax snippets.** User direction at iteration HU-1 Q5: *"show me this in use before I decide."* [[feedback_show_code_to_reason_about]] — banked S130.
3. **Within-session PA-recall claims of "X is ratified per Y" need SPEC verification before encoding into downstream amendment work.** S129 PA's "ratified per §4.14" claim about `<li>:@.name</>` was spelling-wrong; my S130 DD brief inherited the claim without SPEC-cross-checking. Rule 4 extends to within-session derived-recall.
4. **Phase 2 amendment work is predominantly doc-text editing, not code-change.** 6x re-validated (HU-2 Q5/Q6/Q7/Q8 + Phase 2 Cluster A + B-code SPEC half). PIPELINE / SPEC prose drift from already-correct compiler behavior is the dominant work shape.
5. **3-agent parallel-dispatch with file-disjoint scope works cleanly.** S130 ran 3 agents in parallel (Lifecycle DD + Iteration DD + MCP V0.D impl) + later 3 more (Cluster A + Cluster B-code + Lifecycle Landing 1). All landed clean; zero path-discipline leaks; one agent (B-code) correctly Phase-0-STOP'd on brief premise error. Pattern proven for high-throughput sessions.

## NEXT-SESSION PRIORITY

1. **Lifecycle Landing 2** (Approach C extension SPEC + tests) — naturally next after Landing 1 ship
2. **Iteration Landing 1** (compiler-source impl) — file-disjoint with Lifecycle Landing 2; can parallel-dispatch
3. **MCP V0.E** (E2E + adopter docs + fixture multi-page app) — can parallel-dispatch with both above
4. **Phase 2 Cluster B-code Site 1** retirement sub-task arc — file-disjoint with all above; smaller scope
5. Wrap items: dev.to platform action user-completion-note pickup (if user has executed); Lifecycle Landing 3 + Iteration Landings 2/3/4/5 sequenced after their predecessors

3-4 parallel dispatch candidates exist (1+2+3+4 are all file-disjoint). Same momentum-rhythm as S130 mid-session.

## Tags

#session-130 #CLOSE #marathon #phase-2-amendment-arc-complete #3-dd-parallel-batch-landed #lifecycle-landing-1-ships-e-type-001-fire #iteration-HU-1-closed #user-spit-ball-each-of-N-ratified #Q3-RE-RATIFICATION #readme-nominal-framing #known-gaps-refresh #devto-checklist-published #21462-tests #pushed
