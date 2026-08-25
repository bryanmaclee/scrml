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

## FINDINGS 2 + 3 — commit bc015627

REPRODUCED, both. Measured head-vs-base (cb5db9c9), lift carrier vs structural carrier:

    alias        lift @ base     lift @ head-r2      structural (BOTH sides)
    row          clean           clean               clean
    data-id      clean           E-CODEGEN-INVALID   clean, emits `(data, _scrml_each_idx) =>`
    document     clean           clean               clean, dead bundle at eval
    class        clean           E-CODEGEN-INVALID   E-CODEGEN-INVALID
    2bad         E-CODEGEN-INV   E-CODEGEN-INVALID   E-CODEGEN-INVALID

So round 1 turned `as data-id` from clean-compile into a bare E-CODEGEN-INVALID-LOGIC whose text
names neither `as` nor the alias and says "This is a compiler defect ... please report".

FIX: `E-EACH-AS-ALIAS-INVALID` from `validateEachAlias` in emit-each.ts, three arms (not an
identifier / a reserved word / shadows an always-emitted binding), one code, message names `as` and
the alias in all three. Rejected alias -> null -> the caller uses the synthetic iter var, so the
artifact stays valid JS and the named diagnostic is the only thing the author reads.

SINK. The lift path had NO error sink: `_eachBindSupportCtx` is set at `emitEachBodyRenderForFile`
entry and dropped in its `finally` (the BS-structural render pass only), and a lift each is emitted
from emit-lift outside that window. New `setEachAliasDiagnosticSink`, published/cleared by
`generateClientJs` next to the `setCurrentFileRequestIds` precedent. Per-node WeakSet dedupe (the
ternary carrier normalises the same node twice — measured).

NOT VP-1's job — MEASURED, not assumed. Planted `bogusattr` and read whether W-ATTR-001 fired:
lift-expr REACHED; fn-body / ternary / derived-cell / top-level-structural NOT reached. 1 of 5.

FINDING 3 IS ONLY PARTLY CLOSED, deliberately. The brief said reuse existing global-shadow
machinery; there is none to reuse (`LOGIC_SCOPE_GLOBAL_ALLOWLIST` type-system.ts:7598 and
`VALUE_ATTR_SAFE_GLOBALS` emit-html.ts:211 are both module-private consts in files outside the
write-set). So I measured instead — compiled AND EXECUTED the canonical row shape with 15 alias
names:

    breaks:   document (TypeError: document.createDocumentFragment is not a function), String
    fine:     window console Math Number Array Object JSON Boolean Date localStorage fetch
              undefined row

The blast set is SHAPE-DEPENDENT. A globals list would refuse working source (`as window` renders
both rows today). Only the UNCONDITIONAL subset is rejected, both provable from the emitter:
`document` (every factory opens `const _itemFrag = document.createDocumentFragment()`) and the
`_scrml_` namespace. `String` excluded — it is emitted only by a text-interpolation row.

## FINDINGS 4 + 5 — commit 6304b53c

FINDING 4 CONFIRMED via the test file's OWN harness (see the table now in that file's header):
`walkFileAst` reaches 1 of 5 carriers, so alias-silence in the fn-body and ternary carriers proved
nothing. Converted, not deleted: two REACHABILITY tests that assert BOTH halves (alias silent AND
bogus silent = blindness, not exemption) and act as tripwires when the walk is widened; CONSISTENCY
rewritten to the honest pair inside the reached carrier (bogus 1, alias 0); new CROSS-CARRIER test
asserting the measured DISAGREEMENT (lift 1, fn-body 0).
BITE: exemption ON 8 pass/0 fail; toggled OFF 5 pass/3 fail (was 4 pass/3 fail pre-rewrite, with the
two vacuous tests in the passing column).

FINDING 5 CONFIRMED BY INSTRUMENTATION, not by reading. Logged both arms of the sweep loop:
    [route markup]    root.kind=return-stmt   tag=ul
    [STOP structural] root.kind=function-decl stopped-at=return-stmt
    [route markup]    root.kind=lift-expr     tag=ul
    [STOP structural] root.kind=if-stmt       stopped-at=lift-expr
    [route markup]    root.kind=state-decl    tag=ul
From the OWNING node the sweep stops dead at the carrier; it only gets in because the carrier is
separately on the walk spine. Comment corrected with the measurement + the honest closure property.

## DIFFERENTIAL — three captures, two diffs, both from `git worktree add` roots

    base cb5db9c9  enumerated 1906 · compiled 1227 · emitted 7388 · syntax-failing 66
    r2   0e836a70  enumerated 1906 · compiled 1227 · emitted 7388 · syntax-failing 66
    head (this)    enumerated 1906 · compiled 1227 · emitted 7388 · syntax-failing 66

    diff r2 -> head    EXIT 0   NO DIFFERENCES over 1906 sources / 7388 artifacts
    diff base -> head  EXIT 1   20 content diffs across 7 sources — 0 added, 0 removed, 0 newly
                                failing, 0 diagnostic changes, 0 syntax delta, 0 load-context
                                changes, bare server-fn sites 144 -> 144

The base->head 20 are EXACTLY the round-2 delta, and the bytes reconcile to the brief's figure:
    if-in-dispatched-arm-neg          53419 -> 66088   +12,669
    e-derived-server-only-nested-loop 115208 -> 119590  +4,382
    for-lift-per-item-if-reactive x4  81519 -> 94188   +12,669 each  = +50,676
    ternary-markup-giti033            53419 -> 80457   +27,038
                                                        TOTAL +94,765
Every `case.client.js` / `case.html` is the SAME BYTE COUNT on both sides (only the hash moves —
the content-addressed runtime filename it references). My round-3 changes moved NOTHING: the
r2->head diff is empty, so no corpus source carries an `if=` on a lift-parsed `<each>` and none
carries an invalid `as` alias.

## TESTS

    pre-commit gate (unit+integration+conformance)   before 22803 pass / 70 skip / 1 todo / 0 fail
                                                     after  22839 pass / 70 skip / 1 todo / 0 fail
    browser+lsp+commands+self-host (NOT in the hook)  before 47 fail · after 47 fail
                                                     failure SET diff (timings stripped): IDENTICAL
    types-gate --check   4 pre-existing entries before and after; my delta is zero.
