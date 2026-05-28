# scrmlTS — Session 138 (OPEN)

**Date:** 2026-05-28
**Previous:** `handOffs/hand-off-140.md` (S137 CLOSE — R25 HIGH cluster (Bug 37/38/40/41) + Bug 49 BS upstream + R25 MED tail (Bug 42/35/30/43/44/31/32) + SPEC §19.4.1 bare `! ErrorType` + pa.md S138 R26-doctrine + pa.md S139 `full wrap` discriminator; 12 worktree dispatches all clean-landed; PUSH executed mid-session).

**HEAD at OPEN:**
- scrmlTS: `882eba20` (S137 wrap commit — within-node final rebump + S137 CLOSE)
- scrml-support: `4ea0b74` (S139 addendum + user-voice S137)
- pkg.json: 0.6.1 (unchanged S133→S137)

**Sync state:** scrmlTS 0 ahead / 0 behind origin · scrml-support 0 ahead / 0 behind origin · cross-machine clean.

**Tests at OPEN baseline (per S137 CLOSE):** 21,960 pass / 0 fail / 219 skip / 1 todo / 815 files. Net +129 from S136 close.

**S99 path-discipline counter:** 20 (held across 12 S137 worktree dispatches + 4 self-corrected process violations declared honestly).

**Maps:** stale watermark `27e14c66` (S135 close). +60 commits drift accumulated S136+S137. Refresh authorized iff next dispatch is heavy compiler-source outside last map cohort.

**Worktrees:** main only (12 cleaned at S137 wrap step 6b).

**PA auto-memory:** 43 rule files (+1 from S137: `feedback_r26_empirical_verification.md`).

**Inbox:** empty.

**Canon-clear health:** GREEN (held end of S137).

---

## S137 directives in force (banked from user-voice S137)

1. **pa.md S138 addendum — R26 empirical-verification doctrine.** HIGH-severity codegen bug fixes that rely on AST construction require empirical R26-style re-compilation of real adopter `.scrml` source BEFORE claim-closed. Regression-tests-passing ≠ empirical-reproducer-passing. Dispatch brief Phase 3 = mandatory R26 step with bug-specific symptom check; PA dual-verifies before flipping RESOLVED.

2. **pa.md S139 addendum — `full wrap [arc-name]` discriminator.** Stay warm through arc-end (named OR implicit current cluster), not task-end. Safety floor 88% used — PA SHALL surface 1-liner at the floor. Under live `full wrap` directive, PA SHALL NOT proactively suggest wrap at cluster boundaries. Directive in-session-only (doesn't carry across sessions).

3. **pa.md S136 addendum — BRIEF.md archival** (held; lifted to cross-machine contract).

4. **`--no-verify` prohibition** — agent briefs MUST explicitly forbid `--no-verify` use; agent MUST STOP and report on pretest env races, NOT bypass. Bank precedent: Bug 37 self-corrected `--no-verify` on docs-only WIP via `git reset --soft` pre-permanent-landing.

5. **Option (i) word-form `or`/`and` canonical** (S136; landed `a7877b5c`). Bare-form accepted alongside `||`/`&&`; codegen identical at JS-host boundary.

6. **Bug-fix priority over feature work** — v0.6.x → v0.7.0 transition is bug-quality-driven. R26+ gauntlet rounds interleave with patch cuts.

7. **S126 Edit/Bash-divergence interim mitigation** — briefs MUST instruct Bash-only file edits + no `cd` into main from worktrees. S137 had 3 declared S126 deviations (Bug 44 / Bug 31 / Bug 32; Edit tool during debug iteration) — surface explicitly, do not silently accept.

---

## Carry-forward from S137 (user picks first work item at S138 OPEN)

### IMMEDIATE candidates

1. **v0.6.2 patch release cut** (S136 ratified landscape). R24/R25 HIGH cluster + MED tail all closed; canon-clear GREEN. Per pa.md "Versioning convention" — `package.json` bump-on-tag required (0.6.1 → 0.6.2; bump-commit-tag-push order). Adopter-observable surface clean; ready for cut decision.

2. **Bug 50** (MED NEW, surfaced post-Bug-32 R26) — `<tableFor selectable=>` `onchange` raw if-stmt in object-literal. Possibly related to Bug 46 (tableFor selectable/sortable not implemented; LOW).

3. **R24-BUG-4 `<match>` `</>` Phase 5** (HIGH; SCOPING-tracked at `docs/changes/match-block-form-scoping/SCOPING.md`).

### MEDIUM

4. **errorBoundary direction call (R24 step-3b)** — substantive design deliberation. PRIMER §6.8 `renders=.Fallback` vs SPEC §19.6 `fallback={<markup/>}` vs compiler-accepts-SPEC. Bug 44 fix made the lint shape-neutral; design call still open. Ready for HU?

5. **Dormant label-loop bug** (banked at Bug 31) — ast-builder.js L5455/L5474/L9221/L9239 use `.line` (flat property) instead of `.span.line`; silently fails on labeled loops; no test exercises.

6. **R27 different-task gauntlet round** (per S136 R25 Path B) — new task surface, different walls.

### LOWER

7. **Dashboard restructure** (carry-forward since S136; pattern pick a/b/c still pending). Blocked by Bug 9 (compiler-managed async transitive coloring; A9-class deferred).
   - (a) module-init auto-load
   - (b) `<state>` cell + `default=` + `reset()` refresh
   - (c) per-screen Phase enum + engine

8. **R25 LOW tail** — Bug 33 · 34 · 45 · 46 · 48 (latent sibling-finder).

### LONG-HORIZON

9. **v0.6 → v0.7 patch landscape** (ratified S136 + updated S137):
   - **v0.6.2** = R24/R25 CRITICAL bundle — **DONE** (ready for tag)
   - **v0.6.3** = R25 HIGH deep-clean — **DONE**
   - **v0.6.4** = MED + canon coherence — **substantially DONE**
   - **v0.6.5+** = LOW + R27+ validation rounds
   - **v0.7** = M6 cutover (BS+Acorn → native parser); separate arc

10. **Maps refresh** — watermark `27e14c66` is 60+ commits stale. Authorize if next dispatch is compiler-source heavy outside last cohort.

11. **DD Rec #15** — first gauntlet rounds happened (R24/R25); explicitly satisfied. NEW carry: R27 different-task round (Path B per R25 report).

---

## Open questions to surface immediately at S138 OPEN

1. **v0.6.2 cut decision?** All R24/R25 HIGH + MED tail closed; canon-clear GREEN. Ready for `package.json` bump 0.6.1 → 0.6.2 + tag + push?
2. **Bug 50 prioritization** — fix this session-pair or batch with R27?
3. **errorBoundary direction call** — substantive deliberation surface; ready for HU?
4. **R27 different-task round timing** — after v0.6.2 cut or before?
5. **Dashboard restructure** (S136 carry-forward, still open) — pick pattern a/b/c, or defer further?
6. **Maps refresh** — pre-emptive, or hold until next compiler-source dispatch?

---

## S138 — Session-start checklist (executed at OPEN)

- [x] Read pa.md pointer + `scrml-support/pa-scrmlTS.md` IN FULL (cross-machine two-party-exchange contract; through S139 `full wrap` addendum)
- [x] Read `docs/PA-SCRML-PRIMER.md` §1-§13.6 substantively (§13.7+ deferred to as-needed lookup; primer is ~1425 lines)
- [x] Read `compiler/SPEC-INDEX.md` IN FULL (navigation map through §58 Build Story + Quick-Lookup)
- [x] Read `master-list.md` §0 head + §0.1 Phase progress table + §0.2 locks (full §0 deferred — ~275 lines of dashboard)
- [x] Read previous `hand-off.md` (S137 CLOSE) IN FULL
- [x] Read user-voice S136 + S137 entries (banked durables: pa.md S136/S138/S139 addendums; word-form `or`/`and` ratification; `--no-verify` prohibition; bug-fix priority doctrine; full wrap discriminator)
- [x] Rotated `hand-off.md` → `handOffs/hand-off-140.md` (S137 CLOSE)
- [x] Created fresh `hand-off.md` (this file)
- [x] Sync check: scrmlTS 0 behind / 0 ahead · scrml-support 0 behind / 0 ahead (both pushed at S137 wrap)
- [x] Inbox check: empty (`handOffs/incoming/` shows only `read/`)
- [x] Worktree check: main only
- [x] S90 CWD reset performed at session-open (Bash slip to scrml-support during cross-machine fetch caught + reset; no agent dispatches between slip and reset; S99 counter unaffected)

---

## State as of OPEN (preserved for reference)

| Item | Value |
|---|---|
| HEAD scrmlTS | `882eba20` (S137 wrap) |
| HEAD scrml-support | `4ea0b74` (S139 addendum + user-voice S137) |
| pkg.json | 0.6.1 (unchanged S133→S137; v0.6.2 candidate at next bump) |
| Tests | 21,960 pass / 0 fail / 219 skip / 1 todo / 815 files |
| Worktrees | main only |
| Inbox | empty |
| S99 path-discipline counter | 20 |
| PA auto-memory | 43 rule files |
| Maps | watermark `27e14c66` (S135); +60 commits drift |
| Push state | scrmlTS clean / scrml-support clean (both pushed S137 wrap) |
| Canon-clear health | GREEN |
| HIGH bugs open (R25/R24) | 3 (per S137 close; Bug 50 NEW MED filed) |
| MED bugs open | 7 (per S137 close MED inventory) |
| LOW bugs open | 16 (Bug 48 latent + 15 prior) |

---

## Methodology banks in force (S137 durable + prior)

1. **R26 empirical-verification doctrine** (pa.md S138 addendum) — HIGH codegen fixes require R26 before claim-closed.
2. **`full wrap` discriminator** (pa.md S139 addendum) — arc-end, not task-end; 88% safety floor.
3. **BRIEF.md archival** (pa.md S136 addendum) — verbatim brief: text → `docs/changes/<change-id>/BRIEF.md`.
4. **Within-node canary doctrine** (S137 banked) — pre-commit subset excludes within-node; post-cluster bulk rebump mandatory before push.
5. **PA-baseline-pre-dispatch methodology** (S137 banked at Bug 30) — for lint-pass / scan-based fixes, capture in-condition vs out-of-condition counts pre-fix; the delta IS the empirical verification surface.
6. **PA-direct salvage after agent crash** (S89 + S137 re-exercised at Bug 35).
7. **Brief-hypothesis-vs-grep methodology** (S137: 5 of 12 hypotheses correct) — grep + reproducer + trace beats brief speculation; bounded-surface cases best.
8. **Misclassified-as-different-bug detection** (S137 banked at Bug 32) — when one agent flags "different bug; out of scope" for a same-shape symptom, next dispatch SHOULD empirically re-check.
9. **`@row` (SPEC §41.16.10 v1.next) vs `@.` distinction** (S137 banked at Bug 32) — `@row` is implicit magic deferred; `@.` is the §17.7 iteration sigil that composes naturally.

---

## Tags
#session-138 #OPEN #carry-forward-s137 #v0-6-2-cut-candidate #bug-50-MED #r26-doctrine-in-force #full-wrap-discriminator-in-force #canon-clear-green
