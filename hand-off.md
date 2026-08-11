<!-- ============================================================= -->
<!-- hand-off.md — live session state. ROTATED at S337: prior wraps -->
<!-- handOffs/hand-off-s336.md (S336) + handOffs/hand-off-s335.md (S335) -->
<!-- + handOffs/hand-off-s331.md (S331-bryan, landed late at S337 via #496). -->
<!-- Mechanical stream: handOffs/delta-log.md. -->
<!-- ============================================================= -->

# scrml — Session 337 (bryan · ASUS-Vivobook) — WRAP

**Date:** 2026-08-10. `/boot` Profile A. **8 PRs merged** (#495 #496 #497 #498 #499 #500 #502 + this wrap).
main `191b4a36` → `34d211ab` → wrap. Cloud gate GREEN. **Review floor 0 owed** (5 drained, 3 findings).
SOLO. scrml-support pushed separately (direct-push).

## ⏭ NEXT-SESSION PICKUP (read this FIRST — the left-off handshake)

**THREE ARCS ARE IN FLIGHT AND CHAINED. The head of the chain blocks the other two.**

```
g-263 (fix round 2 running) ──▶ converge symbol-table's validation walk ──▶ tare (#501) merges
```

1. **g-263 — branch `fix/g263-seed-convergence-land`, NO PR YET, fix round 2 IN FLIGHT.**
   bryan ruled **(b): give `expr-positions.ts` a WIRED/NOT-WIRED classification.** The seed asks
   *"which identifiers does CLIENT-EXECUTED code reference?"*; the table answers *"where does
   expression SOURCE appear?"* — different questions, and **all three §14.8 leaks so far live in that
   gap.** Also ruled: the seed **fails CLOSED** on unknown wiring (a missing emit is a loud
   `ReferenceError`; a spurious emit is a silent secret). Agent `a72905887573ded02` is building it.
   **On report: file-delta → adversarial pass → PR. It introduced a NEW leak in each of its two prior
   rounds — do NOT merge on a green suite alone.**
2. **THEN converge `symbol-table.ts`'s `walkValidateResetTargets` onto `expr-positions.ts`** — bryan
   ruled this **(a)**, and it is why g-263 must land first (the table lives there). `B3_EXPR_FIELDS` is
   a hardcoded 11-name list that cannot see markup event-handler expressions, so **all four §6.8.4 tare
   checks silently skip them** — proven: `onclick=${ tare(@x) }` compiles clean, then `reset` re-runs
   the module-init thunk. NOT dispatched yet.
3. **THEN `tare` (#501)** — six review rounds, green, held ONLY on (2). Merging before the walk
   converges leaves §6.8.4's own sentence about event handlers false.

**Everything else is optional.** For a clean start instead, the two Q8 dispatches (below) are
self-contained and touch none of the chain.

## 🎯 WHAT LANDED (S337)

- **#500 — the #486 HIGH confidentiality leak, closed.** SIX positions were leaking, not the one
  reported. The walk is structural now, not a field list. Migration measured ZERO over 2,358 files.
- **#499 — the tier-2 scaffold retirement rule + conformance fork 2 RESOLVED** (mixed-pipeline
  bootstrap; FORK RULE rows 1–4 unanimous, escalation declined explicitly). **+ `scripts/dpa-debt.ts`** —
  the probe whose absence hid dpa-024 for six sessions.
- **#498 — the boot-gate read-6b false failure**, converged to a machine-readable `@ledger` marker on
  all three pa-profiles (scrml-support `3f2cc8c`); the prose scan is deleted.
- **#495 / #496** — the S331 maps regen and S331 continuity, both stranded since 2026-08-09. #488 closed
  and superseded (a delta-log sequence-ID collision + a hand-off that would have overwritten Peter's).
- **#497 / #502** — review floor, and dpa-025 banked.

## ⛔ HELD / ROUTED — do NOT take as compute

- **Q8 dispatch 1 — the derived-cell server-placement carve-out.** MEASURED live: the false positive
  fires on INFERENCE-escalated functions (Trigger 1 `?{}`, Trigger 3 server-only reach) with **zero
  deprecation warnings**, and `.server.js` IS emitted in all four cases. Not a deprecated-only artifact.
  bryan ruled (b) measure-then-decide; the measurement says **fix it**. Not dispatched.
- **Q8 dispatch 2 — `server fn` fires `W-DEPRECATED-SERVER-MODIFIER`** though the PRIMER says it is
  EXEMPT and that `server` is LOAD-BEARING there. The lint tests the BODY and never asks whether the
  decl is `fn` or `function`. **May be a PRIMER-vs-SPEC ruling, not a fix** — read §12.2 Trigger 4 first.
- **`E-PA-002` split — RULED (c), S337.** Genuine `protect=` syntax errors stay fatal; the
  missing-DB-file condition gets its own NON-fatal code. Halves the emission-gate migration (59 → 32).
  Queued behind the SPEC/§34 contention. NOT dispatched.
- **The emission gate — Rule 4 Outcome 2**, so it is bryan's ruling, not a fix. ⚠ **One piece is
  actionable WITHOUT any ruling:** `bundleStdlibForRun` runs ~270 lines BEFORE `emitGateFailed` exists,
  so even the WORKING §2.2.1 parse gate leaves `_scrml/auth.js` with `Bun.password.hash(argon2id)` on
  disk. A live shortfall against an existing SPEC sentence.
- **dpa-022 reconciliation — RULED (a).** §1.4 half queues behind the SPEC contention; the PRIMER + L1
  halves are unblocked. The PRIMER is a mandatory full-read at every boot, so it gets care not a sweep.
- **dpa-023 `pending` rung** — direction RATIFIED, build DEFERRED to its own arc (ruled (b)).

## 🔑 METHOD NOTES THAT OUTLAST (S337)

- **⚑ THE SESSION'S REAL FINDING — the same class hit FOUR times and I only named it on the third.**
  A hand-maintained field list or parallel walker that cannot see positions outside it:
  `collectDerivedCellDecls` (#486), the g-263 seed, `B3_EXPR_FIELDS` (tare), `collectFileLevelBindingRoots`.
  Each was found by a *different* review round finding a *different* missed position. **The tell is a bug
  family with one member per position. When round N finds an N+1th position, stop fixing positions.**
- **⚑ AND CONVERGENCE HAS A CONTRACT PROBLEM I GOT WRONG TWICE.** g-263: I assumed two walkers should be
  identical when they had deliberate policy differences → a leak AND an under-emit. Then: I assumed one
  table could serve two consumers whose QUESTIONS differ → two more leaks. **Converging is right;
  "these two do the same thing" is a claim to MEASURE, never to assume.**
- **`main` LEAKS server-only consts to browsers TODAY.** The same-file client-read gate has never had a
  shadow guard of ANY kind: `<each … as SECRET>` and `function f(SECRET)` both ship a server-only
  `export const` when a client binding merely shares the name. Zero corpus incidence. Currently fixed
  ONLY on the g-263 branch — **file it independently of that arc.**
- **A suite that exercises one of a helper's TWO callers reads exactly like one that exercises both.**
  All six g-263 leak vectors used a separate file, so every one travelled the cross-file path; the
  same-file caller was untested, which is why the hole survived three rounds.
- **Unanchored matching — THREE instances in one session:** #492's PICKUP `indexOf`, my own
  ledger-section regex, and `dpa-debt`'s classifier flagging rows that *narrate* "BANKED — UNRUN".
  Every one caught by RUNNING it, never by reading it.
- **Compare NAME SETS, not counts.** I relayed "49 vs 51 browser failures, branch fixes 2"; the agent
  measured **48 both sides, sets byte-identical by name**, and noted 0 artifact content diffs across
  7,375 artifacts makes a behaviour change impossible. A count cannot distinguish a fix from a swap.
- **A wrong in-source rationale is worse than none** — it stops the next reader looking. Two found and
  corrected this session (the boot gate's, and `_scrml_tare`'s no-op comment).
- **Agents were right against me repeatedly** — 4 of my 6 g-263 repro shapes, my `import.meta` premise,
  my browser counts, my finding-1 suggested fix (which would have introduced two new bugs), and my
  request for a non-constructible test. **My premises hold up when they came from a compile, not a read.**

## 🧷 STATE / DEFERRED

- **Maps (6c): DELIBERATELY DEFERRED.** Three code arcs are unmerged; a refresh now goes stale on their
  landing. Watermark is at #495's regen. Refresh after the chain lands.
- **⚠ NOT LANDED AND EASY TO LOSE:** `worktree-agent-a90924554f6a7f288` @ `5bf7ec50` — the
  `classifyWriteAgainstSpec` fix (dpa-023's rung-independent half). COMPLETE, migration measured ZERO
  over 2,359 files. It corrected my brief three ways: the loci were **+170** off, the claimed
  "duplicate" is a different function, and there is a **third** sibling dpa-023 never named — and it
  refused to over-unify them, with good reasoning. **File-delta it early.**
- **Worktrees (6b):** four retained — `a0565f339b2799993` (tare), `a72905887573ded02` (g-263, LIVE),
  `adde4ceabc51763db` (#500, landed), `a90924554f6a7f288` (classify-write, unlanded, above).
- **dpa-025 + dpa-026 BANKED and FIREABLE** (`bun scripts/dpa-debt.ts` → 2 UNRUN). dpa-025 = the
  missing-primitive population-first DD (bryan's reframe). dpa-026 = is `tare` one keyword doing two
  jobs, thunk vs capture by position.
- **Still open from the tare rounds:** native-parser has no `tare` mirror; `reset(@derivedConst)`
  compiles clean despite §6.8.1/§6.8.2; a read inside a tare's 2nd arg is reported twice;
  object-literal compounds have no per-field reset target for EITHER keyword; **raw-body
  (`cleanup`/handler) keyword calls emit dangling references — family-wide, pre-existing, `reset` too.**
- **~48 browser tests may be red on `main`**, excluded from the pre-commit gate. Measured by an agent,
  NOT by me. **Verify before treating as fact** — if true, a whole tier has been failing quietly.
