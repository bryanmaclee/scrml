# v0.3 Wave 2 follow-up — BS-layer extension progress

Dispatch: extend `compiler/src/block-splitter.js` to recognize V5-strict
state-decl shape (`<x>=0`) as a declaration site inside `<program>` body AND
`<page>` body, parallel to the existing `<channel>`-body recognition.

User decision (S86): "A." — extend BS-layer to honor the SPEC §40.8 normative text.

## Timeline

- 2026-05-12 T0 — startup verification: merged main into worktree branch to
  pick up Wave 2 baseline (worktree was created from `23e6265`, Wave 2 commits
  landed on main at `41a4706`). Post-merge HEAD = `41a4706`. Baseline:
  11558 pass / 114 skip / 1 todo / 0 fail / 560 files. Matches brief.
- 2026-05-12 T1 — BS-layer change applied: `block-splitter.js` line ~1161 now
  also recognizes `<program>` body and `<page>` body as state-decl-capable
  contexts (in addition to the existing `<channel>`-body recognition). No
  regressions: 11558 pass / 114 skip / 1 todo / 0 fail / 560 files. Commit
  `803aceb`.
- 2026-05-12 T2 — BS-layer test file authored:
  `compiler/tests/unit/bs-layer-program-page-state-decl.test.js` — 19 tests
  across 4 sections (8 positive shapes × contexts, 4 negative markup
  disambiguation, regression pair, SPEC §40.8 worked-example dual-form).
  Full suite: 11577 pass / 114 skip / 1 todo / 0 fail / 561 files
  (delta +19/+0/+0/+0/+1). Commit `ac06020`.
- 2026-05-12 T3 — DONE. Tree clean. Two commits land on
  `worktree-agent-a4386e4b62ffd138b`: `803aceb` (BS-layer source) +
  `ac06020` (tests).
