# progress — each-alias round 3 (fix round on feat/each-alias-round2 @ 0e836a70)

2026-08-24T17:40:03-06:00 — START. WORKTREE_ROOT=/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-aef0abebce785405f. Base confirmed `0e836a70 docs(each-alias): round-2 record`.
  bun install OK (218 pkgs). bun run pretest OK (13 test samples compiled).
  BRIEF read in full. Write-set boundary noted: ast-builder.js OUT, known-gaps.md OUT,
  emit-event-wiring.ts / emit-expr.ts OUT (sibling dispatch holds them).

## FINDING 1 — REPRODUCED (the reviewer is right; the PA's non-repro was a measurement artifact)

2026-08-24T18:10 — INSTRUMENTED `eachBlockFromMarkupNode` (temporary `console.error` behind
`SCRML_PROBE_EACH_IF`, reverted after) and compiled an 8-fixture matrix at HEAD `0e836a70`.
The probe FIRED with `if` in the attr list on EVERY lift carrier:

    A1-fn-return            attrs=["in","as","it","key","if"]   <- return-stmt.markupNode
    A2-lift-expr            attrs=["in","as","it","key","if"]   <- lift-expr.expr.node
    A3-ternary              attrs=["in","as","it","key","if"]   <- markup-value.node
    A4-derived-const        attrs=["in","as","it","key","if"]   <- render-spec.element
    C1-nested               attrs=["in","as","cell","key","if"] <- nested each in an each
    A1b-fn-return-noalias   attrs=["in","if"]                   <- no `as` at all
    B1-toplevel             (probe NEVER fires — structural path)

EXECUTED the shipped runtime chunk (`result.runtimeFilename`) + client bundle in happy-dom with
`<show> = false`. Rendered `<li>` count:

    fixture                  HEAD 0e836a70                 BASE cb5db9c9
    A1-fn-return             li=2 ["a","b"]  WRONG          li=0  (ReferenceError _scrml_reconcile_list)
    A1b-fn-return-noalias    li=2 ["a","b"]  WRONG          li=0  (same ReferenceError)
    A2-lift-expr             li=2 ["a","b"]  WRONG          li=0  (same ReferenceError)
    A3-ternary               li=2 ["a","b"]  WRONG          li=0  (same ReferenceError)
    A4-derived-const         li=2 ["a","b"]  WRONG          li=0  (no throw, nothing rendered)
    C1-nested                li=2 ["a","b"]  WRONG          li=0  (same ReferenceError)
    A1c-if-on-the-<li>       li=0            correct        li=0  (dead bundle)
    B1-toplevel structural   li=0            correct        li=0  correct (real ifmount)

So the branch converts a LOUD dead bundle into a SILENT wrong render for `<each if=…>` on the lift
path. Exit 0, zero diagnostics, both sides. The `if=` never appears in the emitted client at all —
`show` occurs exactly twice (its own `_scrml_cs_reactive_set` + `_scrml_cs_init_set`), zero reads.

⚑ WHY THE PA'S REPRO FAILED, most likely: counting `<li` in the emitted HTML. The each renders
CLIENT-SIDE into the each-mount `<div>`; the SSR HTML has no `<li>` in ANY of these cases. And a
naive `<li` grep over the HTML returns 1 for every case — it matches `<link rel="stylesheet">`.
Only EXECUTING the bundle distinguishes them.

MECHANISM: `eachBlockFromMarkupNode` reads `in`/`of`/`key`/`as` and nothing else, and BOTH its
callers (`renderTemplateChildToJs`'s top-of-function normalisation :1041 and
`emitNestedEachFromMarkup` :3447) emit the reconcile with no opener-level gate. emit-lift.js DOES
handle `if=` for ordinary markup children (:1159, a display toggle) but routes `<each>` to
`tryEmitNestedLiftEach` (:1791) BEFORE that branch, so the each never reaches it.

Baseline captured: pre-commit gate (unit+integration+conformance) 22803 pass / 70 skip / 1 todo /
0 fail. Whole `bun run test` 30493 pass / 216 skip / 1 todo / 55 fail; browser+lsp+commands+self-host
run in isolation = 47 fail (happy-dom global-state leak makes the grouping matter).
