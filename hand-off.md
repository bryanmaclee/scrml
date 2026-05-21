# scrmlTS — Session 115 (OPEN)

**Date:** 2026-05-21
**Previous:** `handOffs/hand-off-117.md` (S114 CLOSE — rotated at S115 OPEN)
**Machine:** single-machine (S100 directive holds)
**HEAD at S115 OPEN:** `092fa90a` (S114 wrap — native-parser front-end COMPLETE + v0.4.0 + Approach C)
**Origin sync at OPEN:** scrmlTS 0/0 · scrml-support 0/0 — both clean, in sync.

---

## S115 OPEN — caught-up state

Session-start checklist complete: pa.md (full) · PRIMER (full) · SPEC-INDEX (full) · master-list §0 (full) · hand-off S114 CLOSE · user-voice S110/S111/S114 (5 S114 ratifications). Both repos fetched, 0/0. No incoming messages. Worktrees: main only. Hook config B (pre-commit + post-commit + pre-push).

## S115 — DD #27 RESOLVED + RATIFIED (compressed MD ladder)

**OPEN finding (resolved):** at S115 OPEN the #27 DD output file did not exist — background agents are session-scoped and the S114 wrap closed the session before it persisted. User completed the DD out-of-session (scrml-support `bc35fbc`); PA pulled + read in full.

**DD #27 verdict — COMPRESSED MD LADDER.** Per-feature retire-vs-bridge classification, grep-grounded. Revised M5+M6 ≈ 58-91h / 70-110h-with-risk vs the M5 agent's ~98-146h / 150-180h baseline (~35-40% compression).

**All four pivots RATIFIED S115 (via AskUserQuestion, all as DD-recommended):**
- **Pivot 1 — Retire F2 (ESTree decorations).** ~22-32h savings. ~3 kind-test rewrites (emit-expr.ts / emit-logic.ts / emit-table-for.ts) + `EscapeHatchExpr.estreeType` → `nativeKind` rename.
- **Pivot 2 — Move F5 PGO has* flags downstream, option (a).** `computePGOFlags` pre-codegen pass; perf preserved.
- **Pivot 3 — Shape α.** v0.5 = retire-class + cheap bridge-lights (F2/F3/F4/F5/F6/F9 ≈ 19-36h); v0.6 = F1 attrs + F7 + F8 + M5 swap + M6 delete (≈ 49-80h).
- **F7 ceiling — accept 20-30h, NOT deferred.**

EscapeHatchExpr KEPT (field renamed). Per-feature table + full verdict in `scrml-support/docs/deep-dives/m5-m6-scope-revision-2026-05-21.md`.

**Next:** the v0.5 first cut (Shape α retire-class + cheap bridge-lights) is the dispatchable work — but DD #27 is research-only (no impl briefs authored). PA must decompose + brief the v0.5 batch. **Maps refresh required first** (19 commits stale). Sequencing vs Ext 1 (also dispatch-ready, user-flagged "asap" S114) is an open fork to surface to the user.

## Maps currency

`.claude/maps/` watermark `e613621` — HEAD `092fa90a` is **19 commits ahead**. Maps are stale. Refresh required before any compiler-source dev dispatch (M5-FULL / Ext 1). NOT blocking for the #27 DD re-dispatch (research agent).

---

## Carry-forward queue (from S114 CLOSE — verbatim, see hand-off-117.md for full detail)

1. **#27 M5/M6 scope-revision DD** — ✅ RESOLVED + all 4 pivots RATIFIED S115 (see section above). Compressed MD ladder is the M5-FULL/M6 path; v0.5 = retire-class cheap-wins, v0.6 = swap+delete.
2. **Grain debate (S112 PARKED)** — whole-stage vs nanopass. M5-LIGHT close IS the revisit moment. Queued.
3. **Ext 1+3+2 — ready to dispatch.** Ext 1 brief authored (`docs/changes/full-body-split/EXT-1-IMPL-BRIEF.md`, 293L, dispatch-ready). Ext 3 + Ext 2 briefs NOT yet authored. M1.1 (type lift, 3-4h) is the first sub-step.
4. **Open questions from S114 DDs** (5 ^{}-expressiveness + 5 import:host-grammar + 1 Ext-scope) — see hand-off-117.md §"Open questions / carry-forwards".
5. **Pre-existing carry-forwards:** §29 vanilla-interop disposition (S110 — open, user has not ruled); generator (`yield`/`function*`) policy (S114 separate conversation); tableFor v1.next impl (~10-15h); K-ledger CLOSED 12-of-12 (next is K13); the MK4 lazy-require ESM cycle (future K-class extraction if judged unclean).

## State-as-of-OPEN

| Item | Status |
|---|---|
| HEAD | `092fa90a` (S114 wrap) |
| Tests (S114 CLOSE baseline) | 17,842 pass / 0 fail / 173 skip / 1 todo |
| Worktrees | main only |
| Origin sync | scrmlTS 0/0 · scrml-support AHEAD 1 (S115 user-voice — push pending) |
| Inbox | empty |
| Hook gate | Configuration B |
| pkg.json | 0.4.0 (v0.4.0 tag live on origin) |
| `.claude/maps/` | watermark `e613621` — 19 commits stale |
| #27 DD output | ✅ landed `bc35fbc` — read + all 4 pivots ratified |

---

## Tags
#session-115 #OPEN #m5-m6-scope-revision #27-DD-ratified #compressed-md-ladder #maps-stale
