<!-- ============================================================= -->
<!-- hand-off.md ROTATED at S333 (peter/Windows) 2026-08-09.        -->
<!-- Prior accumulated hand-off (S277–S332, 389 KB, over the        -->
<!-- 256 KB single-read cap) archived → handOffs/hand-off-s332.md.  -->
<!-- This is a FRESH hand-off; older wraps live in handOffs/.       -->
<!-- ============================================================= -->

# scrml — Session 333 (peter · Windows) — WRAP

**Date:** 2026-08-09. `/boot` Profile A FULL. **2 MEDs landed** (#476 #477). main `79fdfd07` → **`41a6ea8b`**, coherence 0/0 both repos. Conformance **874/874**. Both cloud gates GREEN incl. Windows CI. Mechanical stream = delta-log **[1279]–[128x]**.

## 🔴 READ FIRST

1. **hand-off ROTATED this session** (the S331-flagged debt): the fat 389 KB file is now `handOffs/hand-off-s332.md`; this fresh file starts clean. Older wraps: `handOffs/hand-off-s276.md` etc.
2. **S331-bryan liveness — RESOLVED as presumed-DONE for working purposes.** His board still says `LIVE`, but he has landed NOTHING since S330 (#472) across THREE of my successor sessions (S332, S333) spanning 2026-08-08→09; 0 open PRs, 0 conflicts, gates clean. **I therefore cleared the deferred shared-surface bookkeeping this wrap** (below) — safely, because every such edit rides the gate-serialized continuity PR, so any live-bryan conflict surfaces at rebase, never a silent clobber. If bryan resurfaces with unpushed S331 work, the delta-log + this note explain what moved.
3. **⛔ Two things STILL HELD for bryan (unchanged, do NOT take as compute):**
   - **if-value block-tail LANGUAGE FORK** (S330) — SPEC §17.6.2 lift-vs-§18.5 tail ruling. Green build preserved on a worktree (see Worktrees below). Routed: `scrml-support/handOffs/incoming/2026-08-07-2256-...if-value-block-tail-language-fork.md`.
   - **g-263 cross-file-const substrate** (S332) — his §14.8 lane; verified core on branch `fix/g263-cross-file-const-attr-value-seed`@`b9d68190` (pushed, unmerged). Routed: `.../2026-08-08-...cross-file-const-seed-convergence.md`. The stdlib `import.meta` gap is the same substrate (folded in).

## 🎯 WHAT LANDED — 2 disjoint-compute MEDs, each through 3 adversarial S239 rounds

- **#476** (`d2e27ba7`) — `g-esql006-prepare-emits-runtime-throw-no-compile-diagnostic`. `.prepare()` on a `?{}` result in a server fn now fires **E-SQL-006 at COMPILE time** (SPEC §44.3/§34 SHALL), was runtime-only. A dedicated `preparedStmtErrors` collector drained at every server-fn emit site (single function-scoped collector in generateServerJs, deduped tail drain → create-without-drain structurally impossible). **S239 caught a silent PARTIAL fix twice** (8 sites → 1 → 0). 5 new conformance pins.
- **#477** (`41a6ea8b`) — `g-nested-each-in-match-arm-drops-diagnostics`. Read-side diagnostics (E-STATE-UNDECLARED) now fire on ANY read in a `<match>` arm containing an `<each>` (broader than the entry's "nested" framing; entry mis-filed locus SYM PASS 3 → actually **TS stage**). ast-builder stamps the blanked arm body (blanking + S153 double-emit-guard UNCHANGED); type-system re-parses read-only + walks via visitNode. **S239 caught 3 real leaks** (nodeTypes memo poisoning via id-collision, bogus span.file, depth-2 mislocation) — all closed. 6-test unit regression + 1 conformance pin.

## 🧭 METHOD NOTE THAT OUTLASTS

**The mandatory pre-landing S239 gate caught real correctness bugs SIX times across two fixes** — a silent partial fix (#476) and a silent type-memo corruption (#477) — every one of which would have shipped on the implementation agents' green self-reports. Independent-oracle + adversarial-before-land is not optional; the self-report is never the gate. Also (recurring): the MED shortlist is unreliable — this session 2 candidates repro'd to language/catalogue RULINGS and 2 to already-fixed STALE-OPENs; repro+SPEC-gate BEFORE dispatch caught all four. [[scrml-med-shortlist-gaps-stale-verify-first]] · [[verify-the-bug-class-not-just-reported-instance]] · [[s239-review-falsify-the-claim-dont-confirm-a-hypothesis]].

## 🧷 STATE / NEXT

- **Worktrees (6b):** NONE created by S333 (my agents ran in the main tree → nothing of mine to prune). Present: `agent-a0742fe4795045e91`, `agent-a4e6b5f2562ae9eaa`, `onmount-c` (bryan's feat/onmount-c-build), `scrml-pinned` (app-pinned, leave). **⚠ The S332-recorded if-value worktree `agent-ad7fea65…`@`5fc00afa` is NOT in the current list** — either externally pruned or the id changed; the if-value green build may need re-locating from branch history before bryan rules. Did NOT prune anything blind. Needs a coordinated worktree reconciliation.
- **Maps (6c):** all changes are in-file (type-system re-parse helpers, emit-server collector, codegen sinks) in already-mapped files; no new files/modules → file/task-shape maps need no dispatch. Symbol-level refresh optional.
- **Ledger cleared this wrap:** #476 + #477 gaps → resolved in known-gaps.md; the 2 STALE-OPENs (`g-region-bodies-emit-in-bucket-order`, esql006 defect-B) → resolved; the 2 RULING corrections (composite-unique §39.2 grammar, epa001 §34 taxonomy) noted as ROUTED-TO-BRYAN; review-floor entries for #476/#477 recorded (both got 3× pre-landing S239).
- **Next pickup (Peter, "grab the next one"):** more disjoint-compute MEDs remain, but each is running deep (repro→scope→3 S239 rounds). Pre-filter off bryan's substrate (§13.2 auto-await, g-263 export-const, session/soft-nav/hydration, §34 catalogue-truthfulness, SPEC-vs-SPEC rulings). Re-survey `docs/known-gaps.md` MED with repro+SPEC-gate FIRST.
- **Waiting on bryan:** if-value fork ruling (S330) · g-263 convergence approach (S332).
