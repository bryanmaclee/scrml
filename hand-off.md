# scrmlTS — Session 70 (OPEN)

**Date opened:** 2026-05-08
**Previous:** `handOffs/hand-off-69.md` (S69 close — A1b CLOSER · Wave 5 COMPLETE · 22/22 steps · 9 commits + wrap commit `f59bbcc`; PUSH COMPLETED)
**This file:** rotates to `handOffs/hand-off-70.md` at S71 open
**Tests at S69 close:** 9,626 / 60 / 1 / 0 (full); ~8,870 pre-commit subset
**Tests at S70 open (carry-forward):** same as close — no work yet

---

## Session-start state (2026-05-08)

| Field | Value |
|---|---|
| scrmlTS HEAD | `f59bbcc` (wrap(s69): close — A1b CLOSER) |
| scrmlTS origin sync | clean — `0 0` (S69 wrap commit pushed) |
| scrml-support HEAD | unchanged from S67 close |
| scrml-support origin sync | clean — `0 0` (one untracked carry-over `archive/articles-skipped/`) |
| Working tree (scrmlTS) | clean |
| Working tree (scrml-support) | one untracked `archive/articles-skipped/` (carry-over from S67) |
| Inbox | empty (`handOffs/incoming/` has only `dist/` + `read/` subdirs) |
| Active agents | 0 |
| Tests | 9,626 / 60 / 1 / 0 (full) — last verified at S69 close |
| L-locks count | L1–L22 |
| Phase | A1b FUNCTIONALLY COMPLETE (22/22) — A1c is the next phase |

**Sync hygiene confirmed:** scrmlTS and scrml-support both clean `0 0` against origin. S69 push landed cleanly; no cross-machine reconciliation needed.

**Session-start checklist:** ✅ pa.md · ✅ PA-SCRML-PRIMER.md (845 lines, chunked) · ✅ hand-off-69.md · ✅ user-voice tail (last contentful entries through S67 — S68/S69 added no entries) · ✅ inbox · ✅ sync · ✅ rotate.

---

## Open questions for the user (carried from S69 close)

### Q1 — Next-phase direction: A1c vs A7

With A1b complete, two equally-valid forks for v0.2.0 work:

- **A1c (codegen + runtime)** — 24 steps C0-C23 across 6 waves; ~96-136h focused engineering. Implements the JS+runtime for everything A1b's resolve+type now lights up. Spec ratified at S60. The natural sequential next-phase choice.
- **A7 (§51.0 spec amendments implementation)** — A5-2 parser + A5-3 typer + A5-4 codegen for the S67 v0.2.0 scope expansion (DD-Harel hierarchy + `<onTimeout>` + `history` + `internal:rule=` + `parallel`). ~40-78h post-A5-1. Spec landed at S68 (`1de05ef`); compiler implementation deferred. Sequential or interleaved with A1c.

A1c is downstream of A7 codegen-wise — A1c emits codegen for v0.2.0 syntax INCLUDING the §51.0 extensions, so the two may overlap. Open question: which to dispatch first, or interleave?

### Q2 — `.claude/maps/*` refresh

Maps were carried over from S68 open (project-mapper run anchored at S66 close `e557e30`). Now stale across 11 S68 ships + 9 S69 ships = 20 commits of code changes. **S69 wrap commit committed the stale maps as-is with note.** Run `/map` (cold or incremental) against current HEAD to refresh? PA-side recommendation: yes, before any A1c/A7 dispatch lands, since dev agents consume the maps.

### Q3 — Spec-prose follow-up: §34 row 14233 cross-ref

§34 row 14233 (E-VARIANT-AMBIGUOUS) cites only §18.0.3; should be amended to also cite §14.10 (parallels B22's §6.8.2 cross-ref addition). Small spec-only edit. Worth folding into the next dispatch's spec-prose tail, OR running as a one-liner PA edit.

---

## Carry-forward "must NOT screw up" list (from S69 #113-#121)

S67 standing list 1-101 + S68 additions 102-112 + S69 additions 113-121 carry forward verbatim. Live invariants summary (read full list in `handOffs/hand-off-69.md`):

- A1b functionally COMPLETE post-`c5f9dcf`. Future "A1b" references treat as complete phase.
- PASS-numbering canonical post-S69: 1-15 (B1, B2, B4, B3, B5, B6, B8+B11/B12 ext, B10 P2, B11+B12 via walkRegisterSynthSurface/dispatchWalkSynth, B13, B14 P10.A+P10.B, B15+B18 fire-site #2, B16, B17, B22, B19). B20+B21 NOT new SYM PASSes — type-system.ts annotateNodes time. Future passes start at 16.
- `match-arm-block.payloadBindings: string[]` canonical post-B20.
- Variable-length lookbehind regex in `expression-parser.ts:preprocessForAcorn` canonical post-B20.
- `shouldSkipExprParse` in `ast-builder.js` skips leading-dot UNLESS followed by uppercase (bare-variant), canonical post-B20.
- `isArrayLikeArg` in `symbol-table.ts` recognizes new clean `kind:"array"` shape post-B20-fix.
- B21's `classifyPredicateZone` annotation completeness: predicateCheck records `{predicate, zone, sourceKind}` for ALL three zones post-B21.
- PA-debug recovery pattern is part of standing playbook (S69 B20 + B18 first dispatches both hit API errors mid-implementation; recovery procedures documented).
- Match-arm-block Form 1b parser (`.VariantName(binding, ...) => { block }`) canonical post-B20.

---

## Tags

#session-70 #open #post-a1b-closer #a1b-functionally-complete-22-of-22 #wave-5-complete-s69 #next-phase-a1c-or-a7 #maps-refresh-pending #push-clean-at-open
