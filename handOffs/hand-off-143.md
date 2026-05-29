# scrmlTS — Session 139 (CLOSE)

**Date:** 2026-05-28
**Previous:** `handOffs/hand-off-142.md` (S138 CLOSE — marathon: 10 bugs closed including Bug 9 L1+L2 paired-fix + v0.6.2 release).

**HEAD at CLOSE:** `1fed5588` (v0.6.6 release commit).
**HEAD scrml-support:** `dbb47c3` (S138 R26 reverse-direction sub-rules cross-machine; unchanged this session).
**pkg.json:** 0.6.6 (released S139; tag `v0.6.6` live on origin).

**Tests at CLOSE:** **22,046 pass / 0 fail / 219 skip / 1 todo** (pre-push gate; full suite) · **15,076 pass / 0 fail / 88 skip / 1 todo across 781 files** (pre-commit subset). +~30 from S138 CLOSE 22,024 baseline.

**S99 path-discipline counter:** 20 (held — zero worktree dispatches this session; all PA-direct surgical fixes).
**S126 deviations:** zero outstanding.
**Maps:** **REFRESHED THIS WRAP** — watermark advanced `27e14c66` (S135 close) → `1fed5588` (post-v0.6.6). 83 commits absorbed.

**Worktrees:** main only.

**PA auto-memory:** 43 rule files (unchanged this session).

**Inbox:** empty.

**Canon-clear health:** **GREEN throughout** — uniquely clean session vs S136/S137 RED-YELLOW-GREEN transits.

---

## S139 was a 4-patch-release marathon

**4 patch releases** (v0.6.3 → v0.6.6) + **HIGH bugs reached 0** for the first time since R24 gauntlet opened the cluster + **TWO NEW silent-miscompile classes uncovered + closed** + **Bug 11 (long-deferred HIGH) closed** + **Bug 51 cluster fully closed across 3 sub-bugs** + **dashboard restructured** + **maps refresh**.

| Release | Commit | Tag | Scope |
|---|---|---|---|
| v0.6.3 | `d62b1806` | live | S138 post-v0.6.2 bug bundle (5 HIGH + 4 LOW + Bug 9 L1+L2 paired close + pa.md S138 R26 doctrine bidirectional) |
| v0.6.4 | `69fb4bcb` | live | Bug 11 (sole-remaining-HIGH close; HIGH count 1 → 0) |
| v0.6.5 | `fc10cccb` | live | TWO silent-miscompile classes (Bug 56 CPS scheduler + Bug 51-A/B Shape 2 + render-by-tag) |
| v0.6.6 | `1fed5588` | live | Bug 51-C auto-lift BS-gobble; Bug 51 FULLY closed end-to-end |

**Bugs closed S139:**

| Bug | Severity | Disposition | Commit |
|---|---|---|---|
| Bug 11 (6nz-V class:NAME on for-lift) | HIGH (long-deferred since S126) | RESOLVED PA-direct (runtime fix) | `f8a1f2ff` |
| Bug 56 (CPS scheduler — TDZ + non-decl-in-Promise.all) | NEW HIGH | RESOLVED PA-direct (same session) | `3450f984` |
| Bug 51-A (CE drops `_scope`) | MED sub-component | RESOLVED PA-direct | `5640148e` |
| Bug 51-B (Shape 2 empty-init) | MED sub-component | RESOLVED PA-direct (same commit) | `5640148e` |
| Bug 51-C (auto-lift BS-gobble) | MED sub-component | RESOLVED PA-direct (same session) | `da4ffd1a` |

**Big lifts S139:**
- **Bug 11 long-deferred HIGH closed** — runtime fix in `_scrml_effect` / `_scrml_effect_static` (un-pause tracking around inner `fn()` so per-item effects registered during reconcile properly subscribe). CLASS-LEVEL — covers any nested `_scrml_effect` in reused list items. R26 PASS on 6nz's exact reproducer.
- **Bug 56 NEW + same-session closure** — TWO distinct CPS scheduler bugs uncovered during dashboard restructure investigation. Both produced `node --check`-clean emit while being runtime-broken. Body-DG edges folded into scheduler dep sets (Bug 56-A); multi-stmt Promise.all groups restricted to decl-shape only (Bug 56-B). Dashboard's original `refresh()` was empirically broken at runtime today; dashboard source restructured to const-decl pattern + factored pure `statusesFrom(state, sha)` helper, demonstrating fix end-to-end (refresh + verify both race-free).
- **Bug 51 cluster fully closed** — original Bug 51 entry was framed as a MED auto-lift gap; S139 empirical investigation surfaced THREE distinct sub-bugs (A: CE drops `_scope` non-enumerable; B: empty-string init produces empty-arg emit; C: BS auto-lift drops markup RHS). All three closed across two release cuts (v0.6.5 for A+B; v0.6.6 for C). 8-test end-to-end regression suite closes the corpus-coverage gap.
- **4 patch releases** — sequential per S136 ratification: bug-quality-driven v0.6.x patch arc. Each release tag pushed independently with full pre-push gates.
- **Maps refresh** (this wrap) — `27e14c66` → `1fed5588`; 10 maps written, 9 skipped (not applicable to compiler library), 2 non-compliant heads-up docs flagged.

**Push state at CLOSE:** PUSHED at every release tag (4 tags pushed sequentially) + after Bug 51-C / known-gaps follow-ups. scrmlTS + scrml-support both 0/0 with origin at this wrap.

---

## S139 banked methodology rules (durable)

1. **`node --check`-clean ≠ correct.** Bug 56 + Bug 51 cluster both exhibited this pattern. Emitted JS parses fine; runtime semantics broken. AST-shape unit tests missed both entirely. Corpus has zero Shape 2 examples in samples/examples explaining how Bug 51-A stayed silently broken across multiple sessions. **Shipped features need end-to-end adopter test coverage** — emit-shape tests asserting actual JS strings + happy-dom drive of runtime behavior. The end-to-end test suites added for Bug 11 / Bug 56 / Bug 51 (22 tests across the 3 cluster-level suites) close the corpus-coverage gap for those surfaces.

2. **`{...obj}` spread drops non-enumerable annotations.** Bug 51-A root cause. `component-expander.ts:runCEFile` constructed `const updatedAst = {...ast, ...}` — only enumerable props copied. SYM attaches `_scope` non-enumerably. Post-CE the new AST had no `_scope` → emit-html.ts silently skipped render-by-tag for EVERY adopter file. Banking rule: when creating a new object via spread from an AST, **re-attach all known non-enumerable annotations explicitly via defineProperty**.

3. **Empirical-canary-applied-to-PA-classification meta-axis.** Bug 50 redux precedent (S138) extended: PA classifications themselves subject to "regression test passes but empirical fails." pa.md S138 R26 doctrine bidirectional with cross-source sweep + sibling-fix-unmask sub-rules continues to pay off — surfaced 3 distinct fix opportunities this session.

4. **Multi-iteration scanner fix pattern.** Bug 51-C scanner had two iteration failures (Shape 3 const-prefix split + multi-line `match{...}` truncation) caught BY THE BROADER TEST CORPUS, not the new Bug 51 tests. **When writing a BS/AST scanner that gates a feature, run the FULL pre-commit suite at each iteration step** — adjacent shapes catch over-greedy/over-narrow scoping. Anchor text-block gobbles at `textStart` when set to preserve pre-existing accumulation; restrict markup-RHS handling to actual `<` start, fall back to legacy for all other shapes.

5. **Patch-release cadence as bug-quality signal.** 4 patch releases in one session is the v0.6.x arc operating correctly per S136 ratification (bug-quality-driven, not feature-driven). Each release bounds a scope, gets pushed with full pre-push gates, adopters checkpoint at any tag. NOT a sign of churn.

---

## Carry-forward to S140

### IMMEDIATE candidates

1. **R27 different-task gauntlet round** (per S136 R25 Path B) — validate HIGH=0 + silent-miscompile-class closures across a fresh task surface. Strong candidate given Bug 56 + Bug 51 cluster both surfaced via real adopter source paths. R27 is now operating against a much cleaner baseline than R25 was.

2. **Bug 51-class corpus-coverage audit** — were there other shipped features that lacked adopter test coverage? Bug 11 + Bug 51 + Bug 56 all share this pattern. Sweep candidate features: `<formFor>` (S102 SHIPPED — parser tests only), `<tableFor>` (S105 SHIPPED — parser tests only), `<schemaFor>` (S104 SHIPPED — parser tests only), engine `effect=` wiring (we know it doesn't fire correctly per Bug 51 investigation), lifecycle annotations on Shape 1 (S134 Landing). ~1-3h scoping; high value given the pattern repeats.

### MEDIUM

3. **Bug 9 L3 transitive coloring** — separate follow-on per 3-layer framing; §8 tripwire test in `compiler-managed-async-bug-9-and-55.test.js` flags when L3 lands. Substantive (multi-hour); defer until adopter demand surfaces.

4. **errorBoundary direction call** (R24 step-3b) — substantive design HU; deferred S136-S138-S139.

5. **2 non-compliant heads-up docs cleanup** — `docs/heads-up/iteration-design-2026-05-25.md` + `docs/heads-up/lifecycle-annotation-extension-2026-05-25.md` carry stale `status: in-progress` / `findings-closed: 0` metadata; underlying features have since shipped. Cleanup sweep ~30min.

### LOWER

6. **v0.6.7 cut candidate** — if any further patches accumulate. Current state is post-v0.6.6 fully shipped; no pending fixes.

### LONG-HORIZON

7. **v0.7 = M6 cutover** (BS+Acorn → native parser). Separate arc. Native parser M2.4 + MK2 status per S112 charter B.

8. **`<formFor>` / `<tableFor>` / `<schemaFor>` end-to-end test surfaces** — implicit in #2 above; explicit dispatch candidates.

---

## Open questions to surface at S140 OPEN

1. **R27 task selection** — what task surface to exercise? R25 was "Realtime Collaborative Kanban"; R26 was self-host repro on R25 artifacts (verification not full round). R27 is a fresh task. Candidates: form-heavy CRUD (exercise formFor/tableFor end-to-end), real-time chat (channels + SSE), or a data-dashboard variant (exercise the Bug 56 fix + state cells under load).
2. **Bug 51-class audit priority vs R27 timing** — do the audit FIRST (find more silent miscompiles before R27 surfaces them) or AFTER R27 (let R27 surface them and triage from real adopter signal)?
3. **Maps cadence** — refresh at every session-close moving forward? Or every-N-sessions per the prior implicit cadence? Empirical signal: at 83 commits, the maps were stale enough to be load-bearing-blind for dispatched dev agents; refreshing at session-close gives the next session's first dispatches usable maps.
4. **Pa.md addendum candidates** — any S139 methodology banks (especially #1 `node --check`-clean ≠ correct + #2 spread-drops-non-enumerable) deserve lift to pa.md cross-machine contract?

---

## S139 — Session checklist (executed at OPEN; CLOSE confirmation)

- [x] Read `pa.md` pointer → `scrml-support/pa-scrmlTS.md` IN FULL (S138/S139 addendums in force)
- [x] Read `docs/PA-SCRML-PRIMER.md` §1-§10 substantively at OPEN
- [x] Read `compiler/SPEC-INDEX.md` IN FULL at OPEN
- [x] Read `master-list.md` §0 head + §0.1 + §0.2 at OPEN
- [x] Read previous `hand-off.md` (S138 CLOSE) IN FULL
- [x] Read user-voice S136 + S137 entries (S138 wasn't logged yet at OPEN; durables banked)
- [x] Rotated `hand-off.md` → `handOffs/hand-off-142.md` at OPEN
- [x] Sync check: scrmlTS + scrml-support both 0/0 with origin at OPEN
- [x] Inbox check: empty (stale `incoming/dist/` artifacts noted, ignored)
- [x] Worktree check: main only (no orphan worktrees)
- [x] v0.6.3 cut + tag + push at mid-session
- [x] Bug 11 fix + v0.6.4 cut + tag + push at mid-session (HIGH count 1 → 0)
- [x] Bug 56 fix + Bug 51-A/B fix + v0.6.5 cut + tag + push at mid-session
- [x] Bug 51-C fix + v0.6.6 cut + tag + push at mid-session (Bug 51 FULLY closed)
- [x] Maps refresh: `27e14c66` → `1fed5588` (83 commits absorbed)
- [x] Test suite final: 22,046 pass / 0 fail / 219 skip / 1 todo (pre-push gate); 15,076 / 0 / 88 / 1 (pre-commit subset)
- [x] Hand-off written (this file) at WRAP — will rotate to handOffs/hand-off-143.md at S140 OPEN
- [x] Master-list §0.6 updated with S139 CLOSE entry
- [x] Changelog updated with S139 CLOSE block + baseline line refreshed
- [x] Known-gaps §0 inventory updated (MED 7 → 6; Bug 51 fully closed)
- [x] Working tree: clean (only gitignored map updates pending — no commit)

---

## State as of CLOSE

| Item | Value |
|---|---|
| HEAD scrmlTS | `1fed5588` |
| HEAD scrml-support | `dbb47c3` (unchanged) |
| pkg.json | 0.6.6 (4 tags pushed this session: v0.6.3, v0.6.4, v0.6.5, v0.6.6) |
| Tests (full) | 22,046 pass / 0 fail / 219 skip / 1 todo (pre-push gate) |
| Tests (subset) | 15,076 pass / 0 fail / 88 skip / 1 todo |
| Worktrees | main only |
| Inbox | empty |
| S99 path-discipline counter | 20 (held — zero dispatches) |
| PA auto-memory | 43 rule files (unchanged) |
| Maps | watermark `1fed5588` (FRESH this wrap) |
| Push state | 0/0 with origin (both repos) |
| Canon-clear health | GREEN throughout |
| HIGH bugs open | 0 |
| MED bugs open | 6 (Bug 51 fully closed) |
| LOW bugs open | 12 |
| Nominal (spec-ahead-of-impl) | 7 |

---

## pa.md directives in force entering S140

- **S136** — BRIEF.md archival per `isolation: "worktree"` dispatch (cross-machine)
- **S138** — R26 empirical-verification doctrine bidirectional (forward + reverse direction sub-rules)
- **S139** — `full wrap [arc-name]` discriminator (stay warm through arc-end; 88% safety floor)
- Standing: `--no-verify` prohibition; S126 Bash-edit + no-`cd`-into-main mitigation; S99 path-discipline counter tracking
- Rule 4: SPEC normative
- Rule 5: shoot straight

---

## Tags
#session-139 #CLOSE #v0-6-3-released #v0-6-4-released #v0-6-5-released #v0-6-6-released #HIGH-count-0 #bug-11-resolved-long-deferred #bug-56-cps-scheduler-class #bug-51-fully-resolved #dashboard-restructured #maps-refreshed #node-check-clean-not-correct #spread-drops-non-enumerable #4-patch-releases
