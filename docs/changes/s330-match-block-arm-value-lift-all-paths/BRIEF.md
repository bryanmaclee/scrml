# BRIEF — s330 match block-arm value-lift (all value-position paths)

**Gap:** `g-match-block-arm-value-lift-covers-one-of-five-paths` (MED, S328-bryan).
**Lane:** compute · toward the §18.5 contract (bug fix, not a language change) · semantics-changed → language-surface review run by the PA before merge.
**Session:** S330-peter. **Dev:** general-purpose (worktree, Opus) — `scrml-js-codegen-engineer` not installed on this machine (overlay `{{dev_agent_identity}}` fallback).

## Problem
SPEC §18.5 (SPEC.md:12659-61): a block arm `{ statement* expression? }` yields its LAST expression. #463 lifted the tail for only the `emitMatchExprDecl` path (plain local `const r = match k`). Four other value-position paths dropped the tail → silent `undefined`: return-`match`, multi-scrutinee decl, derived cell, markup interpolation. All funnel through the value-returning IIFE built by `emitMatchExpr` (emit-control-flow.ts), whose block-arm branch emitted `{ …; c }` with no `return`.

## Fix (one shared root)
- `emit-logic.ts`: exported `planBlockArmLift` (the single §18.5 split+classify plan), `_awaitMatchArmServerCalls`, `_matchArmResultIsBlockBody`; refactored `_emitBlockArmValueFromString` to dogfood `planBlockArmLift` (behavior-preserving).
- `emit-control-flow.ts`: new `emitIifeBlockArmBody` — lifts a block tail via `return <tail>` when it is a value expression (void/empty/object-literal arms stay byte-identical), routing the raw-string path through the shared `planBlockArmLift`; auto-await (§13.2) preserved. Applied to `emitMatchExpr` (raw + structuredBody branches) and `emitMultiArmBody`.

## Verification (PA-side S239 + language-surface review, independent oracle)
- Variant matrix (15 probes) vs pre-fix baseline: all 5 value-position paths lift; bare/object/keyword-prefixed/member arms byte-identical; empty-`{}` untouched (bryan's routed gap).
- Full-corpus emit-differential (base eeb70cde vs branch): 0 diagnostic-code changes; **only 2 real samples changed** (`admin-panel`, `debate-async-dashboard`), both correct tail-lifts incl. server-call auto-await. (60 "text-only" diffs = capture-path artifact, proven.)
- Conformance 867/867 (+2 new strong domAnchored cases: `value-form-block-arm-all-paths`, `value-form-block-arm-derived-reactive`).
- **Real-browser (Chromium, not happy-dom):** derived cell renders "green", recomputes "red" on click.

## Residual (filed, not shipped)
- `g-match-block-iife-tail-classifier-diverges-from-shared-plan` (MED) — the structuredBody branch uses a 2nd ad-hoc node classifier; correct, but a consistency hazard; diverges from the raw path on member-assign tails (where the raw path has the pre-existing LOW bug `g-match-block-member-assign-tail-lifts-as-chained-assignment`).
