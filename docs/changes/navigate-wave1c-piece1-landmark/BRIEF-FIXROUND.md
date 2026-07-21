# BRIEF — Wave-1c PR-1 FIX ROUND (S276 adversarial review)

Dispatched S276 · agent `scrml-js-codegen-engineer` · isolation `worktree` · model opus
BASE FOR THIS ROUND: branch `worktree-agent-a320ce9f1464c6c72` @ `01aaad71` (PR-1 as built).
Comparison base: `origin/main` @ `020485b2`.

Your prior round implemented the one-landmark invariant. A PA-side adversarial review (3 independent
lenses + PA reproduction) found 2 BLOCKING REGRESSIONS vs base and 5 MED. Every one is a shape no
fixture covered. Your tokenizer, your test inversion, and your honest deferred-fork report all held up
under review — the gap is fixture coverage, not judgment. Fix the defects AND close the fixture gap.

## THE RULING (unchanged): exactly ONE `<main>` landmark per composed document; the MARKER decides the slot, never the tag.

## BLOCKING-1 — the composition splice has no depth counting

`compiler/src/codegen/index.ts:~2003`: `slotCloseIdx = shellBody.indexOf('</'+slotTag+'>', slotOpenEndIdx)`.
The justifying comment ("the slot is EMPTY at emit time … HTML5 forbids nested `<main>`") is FALSE on
both halves: `<outlet>` accepts element children, and the slot is now a `<div>` whenever the document
has an author `<main>`. Three PA/reviewer-confirmed vectors, all compiling CLEAN:

(a) `<program><main><outlet><div class="ph">skeleton</div><p>TAIL</p></outlet></main></program>` + any
    `pages/*.scrml` -> stray `</div>`, `TAIL` leaks OUTSIDE the slot (runtime swap can never clear it).
(b) `<program><div class="layout"><outlet><main>ph</main><div>b</div></outlet><footer>foot</footer></div></program>`
    -> unbalanced; the stray `</div>` closes `.layout`, REPARENTING `<footer>` out of it, and
    `<div>b</div>` is silently DESTROYED.
(c) An author-written `<div data-scrml-outlet>` with `<div>` children -> same, and there is no
    diagnostic for a hand-written marker.
Base `020485b2` emits correct, balanced HTML for all three.

FIX: find the MATCHING close tag with proper depth counting over same-tag opens/closes, reusing the
open-tag tokenizer you already wrote (`OPEN_TAG_RE` / `openTagHasAttribute`) so quoted values and
self-closing forms can't fool the scan. Void/self-closing same-tag elements must not increment depth.

## BLOCKING-2 — the landmark predicate is blind across `generateHtml` re-entry

`compiler/src/codegen/emit-html.ts`: `documentHasAuthorMain()` / `treeHasAuthorMain()` scan the `nodes`
of THIS `generateHtml` invocation, but `generateHtml` is RE-ENTERED with `arm.body` for match/engine
arm bodies. So an `<outlet>` inside an arm cannot see an author `<main>` that wraps the whole match.

REPRO (PA-confirmed): a `<program>` with `<main><h1/><match for=Phase on=@phase><A><outlet/></A><B><p/></B></match></main>`
-> tip emits `<main data-scrml-outlet>` into the arm, which the dispatcher `innerHTML`s into a mount
INSIDE the author `<main>` => `<main>` nested in `<main>` on initial paint. Base emitted `<div …>`.

FIX: compute the landmark decision ONCE at the document level and THREAD it through the re-entrant
calls, instead of recomputing from whatever subtree the current invocation received.

## MED-1 — the predicate must reflect RENDERED content, not AST presence (both directions)

Two mirrored defects, both yielding a document with ZERO `<main>` landmarks (worse than the bug fixed):
- A `<main>` living ONLY in a NON-INITIAL match/engine arm is found by the predicate but never rendered
  on initial paint -> outlet demotes -> zero landmarks. Only the INITIAL arm is rendered initially.
- `htmlHasMainElement()` (`index.ts:~689`) textually scans the route body, which INCLUDES `<template>`
  bodies. A perfectly ordinary `<main if=@hide>hidden</main>` in a route compiles into
  `<template id="_scrml_scrml_tpl_N"><main>…</main></template>` -> slot demotes -> zero landmarks.
FIX: the landmark predicate must consider what is actually rendered — the initial arm only, and route
scans must exclude `<template>` (and any other inert) content.

## MED-2 — `openMains` is not reset at a `<program>` boundary

`compiler/src/symbol-table.ts:~10232/10253`: a NESTED `<program>`'s outlet marks the OUTER shell's
`<main>` as "wrapping", silencing case 4. Repro: `<program><main><program><outlet/></program></main><outlet/></program>`
compiles clean; replacing the inner outlet with `<div/>` correctly fires. One-line fix: reset
`childOpenMains` at `isProgramMarkup` (or key `wrappingMains` per shell).

## MED-3 — component-mounted `<main>` under-fires case 4

`<program>${ const Shellmain = <main class="cm"><p>hi</p></main> }<Shellmain/><outlet/></program>`
compiles clean; the literal equivalent fires. `collectOutlets` runs pre-expansion while
`treeHasAuthorMain` runs post-expansion, so the EMIT is correct (demotes) but the DIAGNOSTIC is
inconsistent. Make the two agree. If reconciling them is structurally out of reach in this round, say
so explicitly rather than half-fixing — do not improvise.

## MED-4 — THE TEST ORACLE SHARES THE IMPLEMENTATION'S BLIND SPOT (fix this FIRST)

`mainCount()` in `navigate-wave1c-outlet-composition.test.js` counts `<main` TEXTUALLY over the whole
body — so it counts a `<template>`/`<script>` occurrence as a rendered landmark. That is exactly why
16 green tests missed MED-1. **Fix the oracle before the code**, then re-run: some currently-green
assertions SHOULD go red, and those reds are the bug. Count only RENDERED `<main>` (strip `<template>`
bodies, `<script>`/`<style>` bodies, and comments before counting).

## MANDATORY FIXTURES (the actual gap — every one of these must become a test)

1. `<outlet>` WITH element children (currently zero fixtures anywhere) — assert composed-body tag balance.
2. A `<div>` slot containing `<div>`s (case-2/3a shell) in a MULTI-FILE build — assert balance + no content loss.
3. Author-written `<div data-scrml-outlet>` marker with children.
4. `<outlet>` inside a match/engine arm, wrapped by an author `<main>` — assert NO nested `<main>` in the emitted client chunk (the current helper only greps `.html`, so it cannot see this — assert on `.client.js` too).
5. `<main>` in a NON-INITIAL arm only — assert the outlet still takes the landmark (count == 1, not 0).
6. `<main if=@cell>` in a route body — assert count == 1 (rendered), not 0.
7. Nested `<program>` case-4 (MED-2).
8. Component-mounted `<main>` sibling (MED-3).
9. Empty `<main></main>` bare-slot shell — this PR CHANGED its behavior (base no-op'd; tip composes).
   That change is CORRECT, but untested and contradicts the PR's own "unchanged" claim. Pin it.
10. Uppercase `<MAIN>` bare slot — tip composes, base did not. Also correct, also unclaimed. Pin it.
11. Assert `expect(errors).toEqual([])` on the negative tests (they currently assert only
    `.some(code===…)===false`, which passes even if the compile died of an unrelated error).

## DO NOT

- Do NOT touch `runtime-template.js`, `emit-event-wiring.ts`, `emit-variant-guard.ts`, or any browser/
  conformance test. Pieces 2+3 remain held.
- Do NOT flip the §20.8 banner; do NOT add `W-NAV-CHUNK-LOAD-FAILED` or the §20.8.2 cross-chunk step.
- Do NOT attempt the KNOWN-OPEN fork: a case-2 shell (`<main><outlet/></main>`) composed with a route
  that owns its own `<main>` still yields two nested `<main>`. This is VERIFIED PRE-EXISTING (base = 2,
  tip = 2; tip additionally preserves the marker base destroyed) and awaits a separate ruling. Do NOT
  add a test asserting the current defective output as expected — that would turn a future fix red.
  Leave it documented in progress.md only.
- Correct the source comments/claims that say the bare-`<main>` static path is "unchanged from before
  this PR" — items 9 and 10 prove otherwise. State what actually changed.

## GATES

1. Pre-commit green: `bun test compiler/tests/{unit,integration,conformance} --bail`. Never `--no-verify`.
2. R26: `examples/23-trucking-dispatch` + `docs/website` emitted HTML must remain BYTE-IDENTICAL to base
   `020485b2` (verified 3x independently this session — do not regress it). Verify BOTH directories
   exist and are non-empty before trusting any `diff` result.
3. Re-verify the four ruling cases still pass.
4. Report a table: each BLOCKING/MED with before/after actual compiler output.
5. Report tag-balance (open vs close counts) for every new fixture's composed body.

## REPORT BACK
`WORKTREE_PATH`, `FINAL_SHA`, `BRANCH`, `FILES_TOUCHED`, the defect table, the R26 result, the fixture
list, and anything you deliberately did NOT do. Commit incrementally + keep progress.md current.
