# sPA ss6 — type-system-lifecycle-refinement

**Launch:** `read spa.md ss6` · **Branch:** `spa/ss6` · **Worktree:** `../scrml-spa-ss6`

**Fill:** ~25% · `at-ceiling` (both items deferred-confirmed friction-gated; a5/form-for design items → Bucket B)

## Shared ingestion
Type-system lifecycle/refinement heuristics: `type-system.ts` `checkLifecycleFieldAccess`
(`applyResetToCellField`, `classifyResetValueAgainstSpec`, per-field tracker). The two Q6-narrow reset
heuristics key on the same lifecycle-tracking understanding. Both are deferred-confirmed (S209
re-confirmed, symptom UNREACHABLE absent deep-field-tracking groundwork) — kept here as a thin sPA
cluster ONLY if adopter friction arrives; a5/form-for design-gated items routed to Bucket B. Small
natural ceiling.

## Core files
`compiler/src/type-system.ts`

## Items (least-ingestion-first)
1. **`bug-21`** `[status=open]` LOW · tier med — Q6-narrow: deep multi-level reset on nested compound (shallow tracker revert). `reset(@a.b.c)` where `b` is a compound with lifecycle fields: `applyResetToCellField` (:19737) uses `fieldPath[0]` for tracker classification; `resetOne` operates on a FLAT per-field map (no deep-nested-compound lifecycle tracking). Runtime codegen CORRECT; missing-revert symptom UNREACHABLE because Tracker 2 doesn't track nested-compound deep lifecycle fields at all (naive `fieldPath[0]`→full-path is a no-op). S177 R26-confirmed, deferred-confirmed S209 (no code change). §6.8.2 B22; canonical idiom is one hop deep. status=open/deferred.
   > **Brief seed:** Add deep-field-tracking groundwork in `checkLifecycleFieldAccess` (not just changing `fieldPath[0]`) — the symptom is unreachable without it. NOT worth it absent adopter friction; deferred-confirmed twice. Only build on a real friction signal.
2. **`bug-22`** `[status=open]` LOW · tier med — Q6-narrow: cross-cell `default=@otherCell` reset value classification. `<state default=@otherCell>`: `classifyResetValueAgainstSpec` (:21689, called from reset :21503) heuristically treats any non-`not` text as post-type; if `@otherCell` is itself pre-state at the reset moment the heuristic misclassifies. Only affects whether the per-access tracker reverts vs maintains immediately after reset (the real type-check happens at the assignment site — backstop). S177 R26-confirmed, deferred-confirmed S209. §6.8.1/§6.8.3; cross-cell scenario uncommon. status=open/deferred.
   > **Brief seed:** Refine `classifyResetValueAgainstSpec` to consult `@otherCell`'s lifecycle state at the reset moment. Benign (assignment-site backstop catches the real type error); extend ONLY on real adopter friction. Deferred-confirmed twice.

## Progress
`ss6.progress.md`. Land on `spa/ss6`; ping PA inbox when ready. Do not advance main / do not push.
