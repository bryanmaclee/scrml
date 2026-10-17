# s467-dpa-023-spec progress

Started at /home/bryan/scrmlMaster/scrml/.claude/worktrees/agent-abcbf96a2fc13f1b3 (base 9d7a6cc2a); paused (XPS
commit-blocker); resumed S467 at /home/bryan/scrmlMaster/scrml/.claude/worktrees/agent-a4674857ebfcad5cc on
origin/main 9d7a6cc2a.

- [x] A §13.8 one rule
- [x] B §13.9 pending cells
- [ ] C §34 rows owed (HELD until PR #1427 lands — list below)
- [x] D Phase 1c U1 design amendment (scrml-support 8c33416)
- [x] E Phase 1d record corrections (user-voice scrml-support 4ccb423; dpa-queue edited here)
- [x] F SPEC-INDEX / facts / state

## Commits

- 570a6fb3a `test(S467): s461 unregisters happy-dom` — the commit-blocker fix (same content as PR branch
  `s467-test-happydom-unregister`; that branch was not on origin, so it was applied from the
  s467-error-002-value-position patch plus the two-line `registeredHere` change).
- 8cf5e8941 WIP — the paused S467 patch (SPEC §13.7 note, §13.8, §13.9; this file). The pause-time backup
  `spec-13.8-13.9.patch` is removed in the next commit (its content is in SPEC.md now).
- next commit — PA addendum rulings into §13.9 / §14.12.3, dpa-queue row, regenerated SPEC-INDEX / FACTS / STATE.

## Done

- SPEC §13.8 "Where a Waiting Value May Stand — the One Rule" (restatement; no renames).
- SPEC §13.9 "Pending Cells" (Nominal; F1/F2 marker, desugar, E-TYPE-001 + F3, F6, F7, F4 with measured migration;
  impl#1 ENFORCES §13.9.6 per ruling "yes on the impl#1 enforce F4").
- PA addendum (bryan S467 "three §13.9 pending-cell details"): (1) derived cell cannot be a pending cell — PA reading
  in §13.9.1 replaced by the ruling + provenance "No — keep it refused"; (2) hidden request `.refetch()` / `.loading` /
  `.stale` not reachable — §13.9.2 ruling + provenance "No — write a <request>"; (3) action-position waiting write
  into a pending cell is awaited, cell keeps its current value — new paragraph in §13.9.4, normative statement in
  §13.9.7, and a cross-reference paragraph in §14.12.3 (provenance "No — keep current value"); (4) F4 vs
  `setTimeout(() => save())` / `typeof f` — one sentence in §13.9.6 marked "PA reading (not a ruling)"; §13.2 left as is.
- U1 design doc §13 (U1c gate: no per-call classification; default mechanism = Core `waits` fact on server Fns
  checked like C-S8; fallback = await every scrml call; acceptance = #1428 probe pack server cases; bite test).
- user-voice correction entry (append-only, under S467): S337 "so it is fixed now" is untrue (W7,
  `type-system.ts:31125` / `:32068`); S338 refusal unlanded (W8); B6 / "1,350 sync hosts" superseded by S450 (W5).
- handOffs/dpa-queue.md: dpa-023 row now leads `RATIFIED S467` with F1–F7 + the three details + the record
  corrections; the S322 "1,350 event-handler hosts" bullet is marked superseded.

## HELD — §34 rows owed (until PR #1427 / `s466-server-param-defaults` lands)

1. E-VALUE-SERVER-CALL row — add the `(not to T)` exemption (§13.9.1) and the second fix ("or declare the cell
   `(not to T)`"); derived cells stay refused.
2. E-TYPE-001 row — add the §13.9.3 pending-cell trigger (Nominal).
3. E-ASYNC-FN-ESCAPES-AS-VALUE row — add the §13.9.6 binding rule (impl#1 enforces; needs an emitter note when built).
4. E-ERROR-002 row — §13.9.5 unhandled pending initializer (Nominal); reconcile with `s467-error-002-value-position`.
5. E-PARAM-DEFAULT-AWAIT / E-SERVER-FN-IN-SYNC-CALLBACK / E-ASYNC-STDLIB-IN-SYNC-CALLBACK rows — cross-reference §13.8
   as instances.

## OPEN — for bryan

None of the five questions raised at pause remains open: three were ruled ("three §13.9 pending-cell details"), the
F4-vs-scheduler/`typeof` one is a recorded PA reading, and the ruling entry is written. New items:
- PA-reading tension to check: §13.2's async-colored bullet says an argument of a global fire-and-forget scheduler
  is *not* a use as a value, while the §13.9.6 PA-reading sentence (as relayed) says §13.2 refuses a waiting lambda
  passed to a non-collection callback (E-SERVER-FN-IN-SYNC-CALLBACK, measured S467). Both can hold (named fn vs a
  lambda whose body waits, in server code), but the PA should confirm the wording before landing.
- RediLedger F4 migration is unmeasured (not on this machine).
