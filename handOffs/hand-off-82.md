# scrmlTS — Session 82 (CLOSE — doc-system audit + maps-discipline protocol · 7 commits across 2 repos · 0 source changes · 0 regressions · pushed)

**Date opened + closed:** 2026-05-11 (single-day session, same day as S81)
**Previous:** `handOffs/hand-off-81.md` (S81 close — 7 commits / F.1+F.2 + strict self-host gate + A10 deferred closure + SPEC-INDEX regen + D3/D1 A9-Ext-5 follow-ups + OQ-2 debounce/throttle keyword-form retired · +42 tests · 0 regressions · pushed)
**This file:** rotates to `handOffs/hand-off-82.md` at S83 open

**Tests at open (S81 close baseline):** pre-commit 10,433 / 66 / 1 / 0; full 11,181 / 77 / 1 / 0
**Tests at S82 close:** **pre-commit 10,458 / 66 / 1 / 0** (507 files); **full 11,259 total / 0 fail** (535 files). +25 pre-commit pass is incidental conformance fluctuation — 0 source code changed this session.

---

## S82 close — summary

**Single-thread session.** No compiler-source work landed. Substance was a **doc-system audit + structural fix**, triggered by a methodology failure in PA's first answer to the user's question "show me the full list of everything v0.2.0 is lacking."

**The failure that started the thread.** PA produced that list by reading `scrml-support/archive/changes/v0next-spec-impact/IMPLEMENTATION-ROADMAP.md` (S57-frozen, 24+ sessions stale) as authoritative — direct violation of pa.md Rule 4 (spec is normative; derived planning docs are NOT). Burned ~22% of 1M-token context on an answer that listed shipped items as lacking (A1a, A1b, A1c, A5, A6, A7, A8, A9, A10, debounce/throttle Approach B, etc. — all SHIPPED per `master-list.md` §0.1). User pushed back hard, citing the doc-system bloat as the root issue + considering switching tooling.

**S82 work product: 7 commits across 2 repos closing the structural failure.**

### S82 commit chain

**scrmlTS commits (5):**

1. `47d01a6` — chore(s82): session-start rotation — S81 close → handOffs/hand-off-81.md + fresh S82 hand-off
2. `01ade6f` — docs(s82-pa): make master-list.md §0 the load-bearing SoT for "what's done"; explicit warning re archived roadmap as historical
3. `75287fe` — chore(s82): dereff shipped change/audit dirs to scrml-support/archive/ (a5-7-tests-samples + debounce-throttle-approach-b + promotion-ergonomics partial + 2 disposed hardcoded-thresholds audits)
4. `1e352c7` — chore(s82): trim master-list §0.5 — 20-step A1a status all ✅, content in changelog (538 → 512 lines)
5. `0c80d16` — docs(s82): maps-discipline protocol — close the dispatch-time usage gap (primary.map.md Task-Shape Routing + Use feedback loop sections; pa.md §"Maps-discipline protocol (S82)"; project-mapper agent template updated for future regen)

**scrml-support commits (2):**

- `9f3231b` — docs(s82-archive): visible HISTORICAL banners on stale S57 phase docs (IMPLEMENTATION-ROADMAP.md + IMPACT-ASSESSMENT.md)
- `e5df473` — chore(s82): paired archive additions for the scrmlTS dereff

---

## S82 thread-by-thread

### Thread 1 — Session bootstrap (per pa.md §"Session-start checklist")

Cross-machine sync verified: scrmlTS 0/0 clean against origin; scrml-support 0/0 clean. Hook installed (`core.hooksPath = scripts/git-hooks`). Inbox empty (`handOffs/incoming/` only contains `read/` subdir). Primer + pa.md + S81 hand-off + last ~10 contentful user-voice entries (S72 + S81) all read. S82 hand-off was created at session open as a stub; rotated to `handOffs/hand-off-81.md` (overwriting open-stub) before S82 work began.

**Pre-S82 carry-over: 5 untracked files in scrml-support working tree** (`tools/` dir + 5 article drafts at `voice/articles/2026-05-09-*.md`). Pre-existing local-only artifacts from earlier sessions. Per pa.md Rule 1 (no PA-volunteered marketing work), left in place — they're Bryan's private drafts.

### Thread 2 — User asked "show me the full list of everything v0.2.0 is lacking" → PA's wrong answer

PA produced a 10-section list (~22% context burn) drawn primarily from `scrml-support/archive/changes/v0next-spec-impact/IMPLEMENTATION-ROADMAP.md`. That doc is S57-frozen, marked SUPERSEDED at line 3 (a single quiet line), with 695 lines of phase content below. PA read past the supersession notice and treated the body as current. Listed A6 cluster, B-step propagation, server-keyword Batch 2, most of A5, etc. as "lacking" — actually all shipped per master-list.

PA's response when called out: acknowledged the methodology error (Rule 4 violation), offered two paths — "produce a code-verified narrow list" OR "address the doc system itself." User picked the latter.

### Thread 3 — Doc-system audit

Reconnaissance pass on the channels:
- `master-list.md` — ACTUAL live dashboard, refreshed every wrap. SoT for "what's done." 538 lines.
- `docs/changelog.md` — rolling per-session audit trail. 2,219 lines. SoT for "what landed when."
- `hand-off.md` + `handOffs/` — per-session state.
- `docs/PA-SCRML-PRIMER.md` — language canon snapshot.
- `IMPLEMENTATION-ROADMAP.md` (in `scrml-support/archive/`) — STALE; the smoking gun.
- `IMPACT-ASSESSMENT.md` (sibling) — historical Stage 0a bridge.
- `.claude/maps/` (~75KB, ~19K tokens) — refreshed S81; readership uncertain at audit time.
- `docs/changes/*/` (6 active dirs) — per-feature point-in-time SCOPE + progress.
- `docs/audits/*` (5 files) — audit findings, mixed dispositions.

PA proposed six concrete moves; user authorized 1+2 to start, then 3-6 after.

### Thread 4 — Moves 1+2: banner the stale + add master-list to session-start

**Move 1** — Replaced the quiet "SUPERSEDED" one-liner on `IMPLEMENTATION-ROADMAP.md` + `IMPACT-ASSESSMENT.md` with **visible blockquote-styled HISTORICAL banners** at file top, with explicit redirect to current SoTs (master-list.md / changelog.md / hand-off.md / SPEC.md) and a citation of the S82 PA's trap as the precedent.

**Move 2** — Inserted `master-list.md` §0 as session-start checklist step 3 (between pa.md read and hand-off read) in `pa.md`. Explicit warning that derivative docs in `scrml-support/archive/changes/v0next-spec-impact/` are HISTORICAL and must NOT be used as current truth. Recorded the SoT layering: SPEC.md (normative) → master-list.md (phase status) → docs/changelog.md (landings) → hand-off.md (current session state).

Two commits, both pushed. **Trap closed.**

### Thread 5 — Moves 3+4: archive shipped change/audit dirs

`docs/changes/` — 6 dirs → 4 (archived `a5-7-tests-samples` S80-landed, `debounce-throttle-approach-b` S79-landed, `promotion-ergonomics` Tier-B-shipped material to `scrml-support/archive/changes/promotion-ergonomics-tier-b/`; kept `predicate-gaps-deep-dive-prep` queued, `v0next-audit` + `v0next-inventory` load-bearing scope refs, `promotion-ergonomics/TIER-C-SCOPE.md` queued).

`docs/audits/` — 5 files → 3 (archived 2 hardcoded-thresholds audits which are both shipped-disposed; kept `compiler-forgotten-surface-2026-05-06.md` as a primer §12 reference doc, `scope-c-findings-tracker.md` as active tracker, `self-host-spec-conformance-2026-05-11.md` as active-deferred per S81 user direction).

Paired cross-repo commits (scrmlTS deletions + scrml-support additions), both pushed.

### Thread 6 — Move 5: maps readership audit → findings, not retirement

Audited: of 12 recent hand-offs (S70-S81), individual `.map.md` files cited by name in only **S41 + S81**. `non-compliance.report.md` (the agent-actionable piece) surfaces archival candidates in **6 of last 7 sessions** — that's the active value.

PA framed it as "consider retirement." **User pushed back:** *"I have witnessed the maps making a significant difference when they are used. The answer is not to get rid of the right tool because no one uses it. the answer is, teach how to use the tool. Is this realistic, or just fighting a losing battle?"*

PA acknowledged this was a Rule-3 violation (easy answer beats right answer) and the proxy-signal weakness (hand-off prose ≠ what agents actually consume during runs). Proposed the discipline-fix; user authorized.

### Thread 7 — Move 5 fix: maps-discipline protocol (commit `0c80d16`)

Three structural edits:

1. **`primary.map.md` (+47 lines):** new **§"Task-Shape Routing"** — maps agents from task shape (compiler-source bug fix / new feature / refactor / test authoring / spec amendment / audit / unclassified) to the 2-4 maps to consult in priority order. Existing content-type-based §"File Routing" preserved as the lookup-by-data-type fallback. New **§"Use feedback loop"** — agents end-report load-bearing-finding-or-not.

2. **`pa.md` (+40 lines):** new **§"Maps-discipline protocol (S82)"** under "PA's agent orchestration responsibilities":
   - §1 Dispatch-brief template — paste-verbatim "MAPS — REQUIRED FIRST READ" block naming primary.map.md, the task-shape-relevant maps, the map-currency commit SHA + date, and the feedback-reporting expectation.
   - §2 Currency check — PA verifies HEAD vs `primary.map.md` line-3 commit before every dispatch; stale maps trigger incremental refresh OR explicit post-map-commit landings in the brief.
   - §3 Map-selection ownership — PA names 2-4 maps per dispatch, not the full set; primary.map.md's Task-Shape Routing is the selection guide.
   - §4 Feedback-loop disposition — 3-5 consecutive "not load-bearing" reports on same task shape triggers map-design review.
   - §5 Losing-battle threshold — if < 30% of dispatches report load-bearing map findings after 6-8 weeks with the protocol active, the map design is wrong. Do NOT default-retire before the discipline runs.

3. **`~/.claude/agents/project-mapper.md` (template extended):** the schema for `primary.map.md` regeneration now includes the §"Task-Shape Routing" + §"Use feedback loop" sections. **Propagates at next PA session start** per pa.md's agent-cache rule (the harness caches agent definitions at session start). Today's PA can't run project-mapper with the new template, but future refreshes will preserve / regenerate the discipline scaffolding.

### Thread 8 — Move 6: master-list §0.5 trim

`§0.5 A1a 20-step status` was a 31-line table of A1a's rev-6 sub-steps, all ✅ at S61 close. Per-step commit IDs + landings already live in `docs/changelog.md` (S59-S61 entries). Collapsed to a 2-line closure summary. Master-list 538 → 512 lines.

**Deferred trim candidates surfaced in the commit message but NOT taken** (need user direction):
- §0.6 "Surfaced divergences" — multiple entries marked RESOLVED with content also in changelog.
- §0.1 phase-table A1 + A7 cells — dense paragraph form overlaps changelog landings.
- §M "Known bugs + issues" — needs disposition audit.

### Thread 9 — Move 5 finalization + S82 wrap

Tests run at session-close (full suite via `bun run test`): 11,259 total / 0 fail. Pre-commit subset: 10,458 / 66 / 1 / 0 (+25 pre-commit-pass over S81 close; incidental conformance fluctuation since 0 source code changed this session).

---

## S82 user-voice (recorded at scrml-support `user-voice-scrmlTS.md`)

Four durable entries appended:

1. **"I am seriously thinking about trying out codex at this point."** — Frustration signal triggered by ~22% context burn on inaccurate v0.2.0-lacking list. Recorded as the trigger for the doc-system audit.

2. **Doc-system structural complaint (verbatim):** *"Massive version change, totally breaking. we have road-map, master-list, change-log, maps (which burn massive tokens to do, but im not sure any agent looks at them.) and so on. And many of these , Im quite certain are done. why do I have to burn 22% of 1M token context just to give me a list, that is not accurate to where we are in the process."*

3. **Methodology directive on tool retirement (verbatim):** *"I have witnessed the maps making a significant difference when they are used. The answer is not to get rid of the right tool because no one uses it. the answer is, teach how to use the tool. Is this realistic, or just fighting a losing battle?"* Captured as the standing rule: when PA reflexes toward "retire tool no one uses," that's a Rule-3 violation flag — engage harder on whether the operational discipline is the actual gap.

4. **Direction preference recorded:** user picked "address the doc system itself" over "produce a code-verified narrow list of v0.2.0-lacking." Methodology preference for structural fix > per-item workaround when both are available.

---

## Cross-machine sync state at S82 close

- **scrmlTS:** 5 commits ahead of S81 close baseline; all pushed per-commit through session. 0/0 origin/main at wrap (verified pre-wrap).
- **scrml-support:** 2 commits ahead of S81 close baseline; all pushed. 0/0 origin/main at wrap. Untracked working-tree state (private article drafts + tools/) carried forward unchanged per pa.md Rule 1.

Per pa.md "wrap" §7 (push or surface push-pending) — all pushed.

---

## Next priority — menu (S82 close — carry-forward + S82 additions)

Awaiting user direction at S83 open. **Per the deliberate-no-tilt directive at S82 wrap, the next PA reads master-list.md §0 + this hand-off + last ~10 contentful user-voice entries (will include S82) and answers any "what's lacking" question from those sources, NOT from primary memory.** That's the discipline this session shipped. The first end-to-end test of the protocol IS the next session.

### Active remaining priorities (S81 carry-forward + S82 additions)

1. **A6-6 optional API alignment** — LSP/CG API design dive. Scope TBD (would need investigation + proposal before implementing).

2. **A9 Ext 5 D5 — Redis backend inlining** — adopter-signal-gated.

3. **W-LEAK-010 Steps 2-3** — `<program idempotency-store=>` background sweeper + LC pass implementation. Hold for v0.3.0+.

4. **Insight 28 OQ-bridge-5** — compile-time WARNING when bridged validator on schema-column field — defer to compiler-diagnostics audit pass.

5. **Insight 28 OQ-bridge-2** — passive (re-debate trigger on ≥3 adopter friction reports). VERIFIED FILED S81.

6. **Versioning-discipline discussion** (deferred from S78).

7. **S82 maps-discipline protocol — observation phase.** First 5-10 dispatches with the new protocol will produce feedback signal. PA aggregates over 6-8 weeks per §5 losing-battle threshold.

8. **Further master-list trim candidates** (S82-deferred): §0.6 "Surfaced divergences" RESOLVED entries; §0.1 A1+A7 narrative cells; §M known-bugs disposition audit.

### Future direction (v0.3.0+ orthogonal)

9. **Self-host parity work** — DEFERRED per S81 user direction.
10. **GCP3 walker gap** — ~1-2h diagnose + extend + tests. Paired with #9.
11. **`bun scrml fix` CLI auto-fix sub-command** — v0.3 roadmap per S81 user-voice.
12. **Articles thread (5 in-flight drafts at `scrml-support/voice/articles/`)** — per pa.md Rule 1, no PA-volunteered marketing work.

---

## Open questions to surface immediately at S83 open

1. **Push state — CLEAN.** scrmlTS 0/0 origin; scrml-support 0/0 origin. No outstanding push.

2. **S82 doc-system audit closed.** The maps-discipline protocol is live in pa.md. Project-mapper agent template updated; takes effect at S83 session-start (the next session is the first test).

3. **The "what's left for v0.2.0" question may recur.** If user asks again, next-PA should answer from `master-list.md` §0 (now the explicit SoT per session-start checklist step 3) + grep against source where master-list cells are dense. Do NOT read IMPLEMENTATION-ROADMAP.md as authoritative — it now carries an ⛔ HISTORICAL banner. S82 PA already paid the trap cost; protocol is in place to prevent recurrence.

4. **Project-mapper template change propagates at S83 open.** When PA dispatches project-mapper in S83 (incremental refresh or otherwise), the regenerated `primary.map.md` will include the §"Task-Shape Routing" + §"Use feedback loop" sections by default. PA should verify the regeneration produces sensible content; if the project-mapper agent doesn't follow the template, the section names need to be added to a more explicit place in the agent file.

5. **Worktree branches retained** (forensic per S67): `worktree-agent-ab656f3dcdd0f1638` (S79 debounce/throttle dispatch). S82 had no `isolation: "worktree"` dispatches.

6. **3 legacy master inbox carry-overs** (S78+ carry-forward; safe-to-ignore):
   - `2026-04-22-scrmlTS-to-master-insight-25-multi-meta.md`
   - `2026-05-08-S72-scrmlTS-to-master-needs-push-SUPERSEDED.md`
   - `2026-05-08-S71-scrmlTS-to-master-stage-scrml-dev-pipeline.md`

---

## Things S83 PA must NOT screw up (S77-S81 standing list + S82 additions)

S77/S78/S79/S80/S81 lists carry forward verbatim. **S82 additions:**

- **DON'T read `scrml-support/archive/changes/v0next-spec-impact/IMPLEMENTATION-ROADMAP.md` or `IMPACT-ASSESSMENT.md` as current truth.** Both carry ⛔ HISTORICAL banners citing the S82 trap. They are frozen at S57; treating them as authoritative is exactly the failure this session's work was designed to prevent.

- **DO read `master-list.md` §0 in full at session start** (session-start checklist step 3). Master-list is the live phase-status SoT.

- **For every dev / scrml-writer / pipeline / gauntlet dispatch, paste the "MAPS — REQUIRED FIRST READ" block** from pa.md §"Maps-discipline protocol (S82)" verbatim into the prompt. Fill the commit SHA + date from `primary.map.md` line 3 at dispatch time. Name the 2-4 task-shape-relevant maps (primary.map.md §"Task-Shape Routing" is the guide). Don't blanket-include all 10 maps; don't skip the block entirely.

- **DO run map-currency check before every dispatch.** Compare HEAD to `primary.map.md` line-3 commit. If HEAD is N commits ahead AND those commits touched dispatch-relevant files, either refresh maps OR explicitly tell the agent which post-map-commit landings to factor in. Stale maps mislead worse than missing maps.

- **DON'T default-retire the maps if early dispatches don't cite them.** Losing-battle threshold is < 30% load-bearing reports across 6-8 weeks of disciplined dispatch — that's the empirical bar before the maps' design (not the discipline) is what's wrong. The S82 PA's reflex toward "tool unread, retire it" was a Rule-3 violation; don't repeat.

- **DON'T pre-cook the v0.2.0-lacking answer in next-PA briefs.** This S82 wrap deliberately surfaces no PA-side priming on how to answer that question. The discipline says: read master-list.md §0, grep against source if needed, do not produce the list from primary memory or from derivative docs. The first end-to-end test of this discipline IS the next session.

- **DO note Task-Shape Routing regenerates at next project-mapper run.** The agent template was updated at S82; today's `primary.map.md` has the section because PA wrote it directly. Future refreshes should preserve/regenerate it via the agent template. If they don't, the agent file edit didn't propagate correctly — debug at first project-mapper dispatch.

---

## Tags

#session-82 #close #doc-system-audit #maps-discipline-protocol #rule-4-violation-recovery #rule-3-violation-recovery #master-list-as-sot #task-shape-routing #feedback-loop-protocol #0-source-changes #pushed
