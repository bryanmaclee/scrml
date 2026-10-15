# s467-dpa-023-spec progress

Started at /home/bryan/scrmlMaster/scrml/.claude/worktrees/agent-abcbf96a2fc13f1b3 (base 9d7a6cc2a).

- [ ] A §13.8 one rule
- [ ] B §13.9 pending cells
- [ ] C §34 rows owed (held)
- [ ] D Phase 1c U1 design amendment (scrml-support)
- [ ] E Phase 1d record corrections
- [ ] F SPEC-INDEX / facts / state

## PAUSED (S467)

**Done (in this commit):**
- A: SPEC §13.8 "Where a Waiting Value May Stand — the One Rule" (defines a waiting value; (i) suspension point of an action position / (ii) a declared `(not to T)` cell; instance table naming E-VALUE-SERVER-CALL, E-SERVER-FN-IN-SYNC-CALLBACK / E-ASYNC-STDLIB-IN-SYNC-CALLBACK, E-PARAM-DEFAULT-AWAIT, E-ASYNC-FN-ESCAPES-AS-VALUE; no renames).
- B: SPEC §13.9 "Pending Cells" (Nominal banner, F5) with §13.9.1 F1/F2 marker, §13.9.2 desugar, §13.9.3 E-TYPE-001 + F3, §13.9.4 F6, §13.9.5 F7, §13.9.6 F4 (Measured migration sentence per PA addendum: 0 newly refused; ~56 test fixtures flip; RediLedger unmeasured), §13.9.7 normative statements. Each with provenance + PA readings flagged.
- §13.7 message paragraph: S467 note adding the "or declare the cell `(not to T)`" second fix.
- F4 impl#1 note now says impl#1 ENFORCES F4 (bryan S467 ruling relayed by PA); §13.9 banner names §13.9.6 as the exception to "carried".

**Half-done / not started:**
- C: §34 rows owed (HELD until s466-server-param-defaults / PR #1427 lands): (1) E-VALUE-SERVER-CALL row — add the `(not to T)` exemption + second fix; (2) E-TYPE-001 row — add §13.9.3 pending-cell trigger (Nominal); (3) E-ASYNC-FN-ESCAPES-AS-VALUE row — add §13.9.6 binding rule (impl#1 enforces → needs emitter note when built); (4) E-ERROR-002 row — §13.9.5 unhandled pending initializer (Nominal); (5) E-PARAM-DEFAULT-AWAIT / sync-callback rows — cross-ref §13.8 as instances.
- D (U1 design-doc Phase 1c amendment in scrml-support): NOT started.
- E (Phase 1d record corrections: user-voice appended S467 correction of S337 "it is fixed now" (W7 — type-system.ts:31118 still two-state); dpa-queue row 42 + line ~1027 "1,350 sync hosts"/B6 superseded by S450 (W5); mark dpa-023 row with S467 F1–F7 rulings): NOT started.
- F (SPEC-INDEX regen + §13 summary, facts/state --check): NOT started.
- user-voice entry for bryan's "impl#1 will enforce F4" ruling: owed (PA's to write).

**Next 3 concrete steps:**
1. Amend `scrml-support/docs/deep-dives/bootstrap-u1-server-boundary-design-2026-10-03.md`: dated amendment banner (2026-10-15) + `last-reviewed:` bump + a §3/§8 U1c gate — server printer awaits by construction via a Core `waits` fact on ServerFns checked like C-S8 (DD default), no per-call name classification; acceptance = #1428 probe pack server cases.
2. Phase 1d: append S467 correction entry to user-voice-scrml.md (quote the S337 "so it is fixed now"); edit handOffs/dpa-queue.md row 42 (S467 rulings, W5/W7 corrections).
3. `bun run scripts/regen-spec-index.ts`, add S467 §13.8/§13.9 to the §13 row summary, `bun scripts/facts.ts --check`, `bun scripts/state.ts --check`, commit + push.

### UNCOMMITTED — the pre-commit hook blocks every commit on this machine (S467, XPS)

Nothing on this branch is committed or pushed; origin has no `s467-dpa-023-spec`. The hook's full suite fails on one
test unrelated to this docs-only change: `compiler/tests/integration/foreign-sealed-scope.test.js:355`,
"§23.2.4a — tool host I/O form > under Node the slice gets a working require too". Its cause is the environment: the
only Node on PATH is v21.6.0 (linuxbrew; /usr/bin/node is v12), and v21.6 does not auto-detect ESM, so it throws
`SyntaxError: Cannot use import statement outside a module`. The hook was not bypassed (no --no-verify).

Uncommitted working-tree state in this worktree (agent-abcbf96a2fc13f1b3):
- `compiler/SPEC.md`: the §13.7 message note plus new §13.8 and §13.9 (lines ~10812–11175). The full diff is saved as
  `docs/changes/s467-dpa-023-spec/spec-13.8-13.9.patch` (385 lines; also in the agent scratchpad).
- `docs/changes/s467-dpa-023-spec/progress.md` (this file).

To resume: on a machine whose Node runs that test (Node ≥22.7, or the ASUS setup), `git apply` the patch or reuse this
worktree, then commit and push.
