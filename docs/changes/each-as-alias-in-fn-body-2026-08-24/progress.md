# each-as-alias-in-fn-body — progress

Worktree: /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-ae080f493c841f360
Base: cb5db9c9   Branch: worktree-agent-ae080f493c841f360
2026-08-24

## Status — COMPLETE

- [x] startup verification (pwd / toplevel / clean / merge-base == origin/main / bun install / pretest)
- [x] reproduced A/B/C/D by compiling + reading emitted output
- [x] LOCUS VERDICT: **REFINED**
- [x] limb 1 fix — alias binding (`emit-each.ts`) — a6eb4aca
- [x] limb 2 fix — runtime-chunk prune (`emit-client.ts`) + merge-blocker gate — 5cc58fba
- [x] merge-blocker browser test, BITE-PROVEN (6 fail at base / 8 pass at head, isolated)
- [x] measured corpus count
- [x] `bun scripts/corpus-emit-differential.ts` — VERDICT: NO DIFFERENCES
- [x] full `bun run test` set-diff — zero new failures
- [x] `bun run types` — diagnostic set byte-identical base vs head

## Direction of change

**Conformance RESTORATION, not a widening.** Governing text already makes the
shape legal — SPEC §17.7.2 normative statements: *"The `as name` clause is
OPTIONAL. When present, it binds the current iteration value to the named
identifier in the body scope (per §17.7.3)."* And §17.7.3: *"When `as name` is
declared on the enclosing `<each>` opener, `name` and `@.` SHALL both resolve to
the current iteration value (aliases)."* All four §17.7.2 canonical shapes spell
the clause as a BAREWORD (`as conflict`, `as day`, `as row`) — never `as=NAME`.
Nothing in §17.7 conditions the clause on the enclosing markup context. So the
change makes the compiler honour a SHALL it was already bound by; it accepts no
form the SPEC did not already accept.

## Locus verdict — REFINED

Brief located it at `emit-each.ts` and hypothesised "the fn-body `<each>` is
emitted through a path that skips lowering the top-level path runs."

- The **PATH** claim HELD. The fn-body each goes
  `emit-lift.js:tryEmitNestedLiftEach` → `emit-each.ts:emitNestedEachFromMarkup`
  → `eachBlockFromMarkupNode`, not the BS-structural `buildBlock` each-block
  dispatch.
- The **"skipped lowering pass"** framing is WRONG. Nothing is skipped. It is a
  one-site **attribute-read bug**.
- The prior session's `_eachMarkupFnNames`-null note at `emit-each.ts:1406` is
  NOT the alias cause. Verified independently (see DEFERRED-1) that it IS the
  cause of the sibling `String(...)` symptom — set at `:3684`, cleared at
  `:3818`, and the lift path runs outside that window.

### Root cause, limb 1 — verified by dumping the AST

`parseLiftTag` (`ast-builder.js:5404`) tokenises an opener into `name[=value]`
attributes, so the bareword pair `as it` arrives as TWO ADJACENT VALUE-LESS
attributes. Measured AST for repro A:

    attrs: [ {name:"in",  value:{kind:"variable-ref", name:"@rows"}},
             {name:"as",  value:{kind:"absent"}},
             {name:"it",  value:{kind:"absent"}},
             {name:"key", value:{kind:"variable-ref", name:"it"}} ]

`eachBlockFromMarkupNode` read `attrs.as.value` alone → `{kind:"absent"}` →
`eachAttrRawText` → null → alias null → the caller fell back to the synthetic
`_scrml_each_item` iter var, while the body still lowered `${it}` as a bare
identifier.

⚑ The comment in that slot asserted the opposite and was WRONG since S158:
*"markup attrs from lift already split `in=`/`of=`/`as`/`key=`"*. They do not
split `as`. Replaced with the defect note.

Only the LIFT path was affected — the BS-structural path re-splits the raw
header text and has always handled the bareword form. That is exactly why
top-level (C, D) worked and the identical `<each>` in a `fn` body did not.

## Limb 2 — a SECOND, independent HIGH silent-miscompile (found by EXECUTING)

Measured on base `cb5db9c9`: repro A's shipped runtime — the
`scrml-runtime.<hash>.js` that `a.html` actually loads — contains ZERO
occurrences of `function _scrml_reconcile_list`, while `a.client.js` CALLS it.
So in a real browser the FIRST error is
`ReferenceError: _scrml_reconcile_list is not defined`; the alias error is what
you get only when the FULL unpruned `SCRML_RUNTIME` is loaded (the
`browser-conditionals.test.js` pattern the brief's verification used).

**Control B is affected too** (`grep -c 'function _scrml_reconcile_list'` → 0 on
its shipped runtime), so the brief's "(B) WORKS" also holds only under the full
runtime.

Cause: `emit-client.ts`'s chunk-detect walker has explicit "descend so the
`<each>` is seen" cases for `each-block`, `for-stmt`, `engine-decl` arms and
`match-block` arms, but (a) never descends `return-stmt.markupNode`, and (b) has
no `each` tag test in `case "markup"`, which is what a `parseLiftTag`-produced
`<each>` actually is. Identical failure class to Bug 57, which that file's own
comments document.

Fixing limb 1 alone leaves the shape dead in a browser, so the dispatch
DONE-PROBE ("executes in happy-dom with ZERO errors") could not be met without
limb 2. Taken deliberately; surfaced as a scope addition.

## Measured corpus count

Scanned **1906 `.scrml`** across `samples/ examples/ stdlib/ benchmarks/
conformance/` by PARSING each (splitBlocks + runTAB), not by grep.

| population | count | files |
|---|---|---|
| lift-parsed `<each … as NAME>` (limb 1) | **0** | — |
| any lift-parsed `<each>` (limb 2 blast radius) | **1** | `conformance/cases/each/ternary-markup-giti033/case.scrml` |

⚑ Corpus-zero bounds BLAST RADIUS only. It is not evidence the shape is
unwritten: `as name` is one of the four §17.7.2 canonical shapes, the corpus is
100% LLM-authored, and a `fn` returning a list is ordinary code.

## Verification

- **Bite proof (isolated):** base 6 fail / 2 pass → head 8 pass / 0 fail.
- **Full `bun run test` set-diff** (normalised, timing stripped):
  before 30468 pass / 58 fail / 216 skip / 1 todo;
  after 30473 pass / 53 fail / 216 skip / 1 todo.
  The ONLY delta is the 5 new tests moving fail → pass. Zero new failures.
- **Pre-commit gate** (unit + integration + conformance): 29261 tests, 0 fail.
- **corpus-emit-differential** base `cb5db9c9` vs head `5cc58fba`:
  **NO DIFFERENCES** — 1906/1906 sources enumerated both sides, 0 compile-outcome
  delta, 0 diagnostic delta, 7388/7388 artifacts byte-identical, 0 syntax delta
  under both goggles, 0 bare-server-fn delta. Expected: the measured corpus has
  ZERO limb-1 sites, and the one limb-2 file is a ternary-markup carrier the fix
  deliberately does not reach (DEFERRED-2).
- **`bun run types`**: 145 diagnostics on both sides; the 9 touching
  `emit-each.ts` / `emit-client.ts` are byte-identical base vs head (all
  pre-existing, incl. the `asNames`-missing TS2741 on a return literal I did not
  touch).

## DEFERRED — surfaced, not closed

**DEFERRED-1 — `g-each-nested-in-fn-body-markup-fn-stringifies` (MED, unchanged).**
Not fixed; the brief said not to force it. Two verified corrections to its file:

  * The alias gap entry claims a sibling symptom "the callee comes out as bare
    `badge` instead of the registered `_scrml_badge_1`". **Not reproduced as a
    defect.** Measured at base on three shapes: module-scope `fn badge` (bare
    and `${…}`-wrapped) both emit `String(_scrml_badge_2 ( it ))` — renamed
    CORRECTLY. The bare `badge` appears only when `badge` is declared INSIDE
    `listing()`, where it emits as `function badge(v)` in that function's own
    scope — so the bare reference is CORRECT, not a defect. **That limb of the
    gap entry should be struck.**
  * The `String(...)`-instead-of-mount symptom DOES reproduce, identically at
    base and head. Root CONFIRMED as the prior session hypothesised:
    `_eachMarkupFnNames` (`emit-each.ts:253`) is set at `:3684` and cleared at
    `:3818` inside `emitEachBodyRenderForFile`; the lift path
    (`emit-lift.js:tryEmitNestedLiftEach` → `emitNestedEachFromMarkup`) runs
    OUTSIDE that window, so `interpMayYieldNode(interpExprNode, null)` at
    `:1477` can never say "markup-capable". Verified, not relayed.

**DEFERRED-2 — a THIRD carrier of limb 2, live on `main`, in a shipped
conformance case (HIGH, unfiled).** `conformance/cases/each/ternary-markup-giti033/case.scrml`
compiles to a `case.client.js` with **3** `_scrml_reconcile_list(` call sites and
a `scrml-runtime.<hash>.js` with **0** `function _scrml_reconcile_list`. Exit 0.
Same class, different carrier: the `<each>` lives in a ternary consequent as a
`{kind:"markup-value", node}` expr leaf (`ast-builder.js:4105`), which the chunk
walker never routes back into `walkNodes` — `markup-value` is not in
`STRUCTURAL_AST_KINDS`, so `probeExprForEqualityAndReset` descends through it,
but that prober only looks for `==` / `reset-expr` and never calls
`detectFromNode`. Left alone deliberately: a distinct carrier with a wider blast
radius, it deserves its own gap entry + executed-DOM gate + its own differential,
and folding it in would have muddied this dispatch's clean NO-DIFFERENCES
verdict. Fix shape is small (route markup-value leaves into `walkNodes`).

**DEFERRED-3 — `<each … as (k, v)>` inside a `fn` body is rejected with a
misleading diagnostic (MED, unfiled).** §59.8 / §14.11 positional tuple
destructure. `parseLiftTag`'s attribute loop hits the `(` as an unknown token
and bails the whole lift to the string fallback, so the each never reaches
`eachBlockFromMarkupNode` at all. The compile then FAILS CLOSED (good) with two
`E-SCOPE-001`s naming `k` and `v` as undeclared identifiers — which does not
name the root cause. Identical at base and head; my fix cannot reach it (the
node never exists). Fail-closed, not silent-wrong, hence MED not HIGH.

**DEFERRED-4 — `E-DG-002` false positive on a fn-body each source.** Repro A
warns *"Reactive variable `@rows` is declared but never consumed"* although
`<each in=@rows>` in the fn body consumes it. Same blind spot, different stage
(DG, not codegen). Unchanged by this fix.

**NOT DONE (deliberate): `docs/known-gaps.md` not edited.** It is a PA-owned
shared doc that file-delta landing must not clobber. The entry
`g-each-as-alias-unbound-in-fn-body` is ready to move to `status=resolved`; the
DEFERRED-1 correction above should be applied to it at the same time.

## Observed, worth knowing

Control (B) fails in an ISOLATED run of the new test file at base but PASSES in
a whole-suite run at base — the documented happy-dom whole-suite global-state
leak (an earlier test file evals the full `SCRML_RUNTIME` into the shared
process global, so `_scrml_reconcile_list` is already defined). The (A) tests
bite in BOTH modes, so the merge-blocker is sound either way; do not read a
green (B) in a whole-suite run as evidence the runtime chunk shipped.
