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

## FINDING 1 — FIXED + BITE-PROVEN

2026-08-24T19:05 — commit 21d5abcf. `ifExprRaw` on the each-block +
`emitEachOpenerIfGuardLines` at both markup-derived call sites. Gate emitted INSIDE the
`_scrml_effect` (tracked read -> reactive) and BEFORE the collection read (SPEC 17.1.2.1: "the
iterated collection is not read ... while `expr` is false").

Two non-obvious calls, both measured, not reasoned:
  * READER — `eachAttrRawText`, NOT the per-row `if=` reader's JSON.stringify treatment. SPEC 5.2's
    cluster-A paragraph carves CONDITION attributes out of the quoted-is-a-static-string rule
    ("SHALL be parenthesized — if=(@n >= 3) — or quoted — if=\"@n >= 3\""), so a quoted condition is
    EXPRESSION text. The first cut JSON.stringify'd it and emitted
    `if (!("_scrml_reactive_get("show")"))` -> E-CODEGEN-INVALID-LOGIC on `if="@show"`, which
    compiles clean on main. Caught only by varying the value form, per the brief's flag.
  * LOWERER — `lowerEachExpr` (not `rewriteIterValueExpr`), so a SPEC-42 predicate routes through
    the structured emitter.

Measured lowering, all six forms SPEC 5.2 admits (head, exit 0 on all six):
    if=@show           -> if (!(_scrml_cs_reactive_get("show")))
    if="@show"         -> if (!(_scrml_cs_reactive_get("show")))
    if=(@n >= 3)       -> if (!((_scrml_cs_reactive_get("n")>=3)))
    if="@n >= 3"       -> if (!(_scrml_cs_reactive_get("n") >= 3))
    if="not @show"     -> if (!(!_scrml_cs_reactive_get("show")))
    if="@rows is some" -> if (!(((__scrml_is_v) => __scrml_is_v !== null && __scrml_is_v !== undefined)(_scrml_cs_reactive_get("rows"))))
At BASE cb5db9c9 all six emit NO gate. `if=!@show` is E-SCOPE-001 on BOTH sides (pre-existing).

BITE PROOF — reverted the COMMITTED emit-each.ts hunk (`git apply -R` of
`git show 21d5abcf -- compiler/src/codegen/emit-each.ts`; NO stash), re-ran the gate:
    with fix      20 pass / 0 fail
    fix reverted   6 pass / 14 fail
The 6 survivors are exactly the tests that assert a list RENDERS (B1/B2/B3/D2 + the two H-section
OPENS rows) — controls against over-gating, not bug repros. Recorded IN the test file so nobody
reads them as coverage they are not (Finding 4's lesson, applied forward).

ALSO FIXED, incidental: the object literal `eachBlockFromMarkupNode` returns has been missing
`asNames` — and failing types-gate with TS2741 — since Bug 72 (S158). Now `null` (behaviour
identical; consumers guard with `Array.isArray`). TYPES-BASELINE.json pruned BY HAND, not by
`--write`: a regenerate would also have absorbed the four diagnostics this branch is already red on
(2x TS7006 + TS7016 markup-return-scan in emit-each, TS2352 in route-inference — all four verified
PRE-EXISTING by running `types-gate --check` in a scratch worktree at 0e836a70). Post-fix
`types-gate --check` reports those same four and nothing else: my delta is zero.
