# each-as-alias-in-fn-body — progress

Worktree: /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-ae080f493c841f360
Base: cb5db9c9   Branch: worktree-agent-ae080f493c841f360
2026-08-24

> ⚑ **READ THE ROUND-2 SECTION AT THE BOTTOM BEFORE THIS ONE.** An S239
> adversarial pass returned four findings including a HIGH DO-NOT-LAND: the
> round-1 limb-2 fix closed ONE of four off-spine carriers while its comment
> claimed it closed the class. Round 2 replaces it with a general sweep and
> corrects two relayed premises that were wrong. Statements in the round-1
> section below are superseded where they conflict.

## Status — round 1 (superseded in part by round 2)

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

---

# REVIEW ROUND 2 — S239 adversarial pass (4 findings, one HIGH DO-NOT-LAND)

Base for this round: `68cfad44` (the round-1 head). All four findings
REPRODUCED BY ME before acting; two relayed premises turned out wrong.

## BLOCKER (HIGH) — limb 2 did not close the class. FIXED, and generically.

Reproduced on `68cfad44`: `${ if @show { lift <ul><each in=@rows as it …>…</ul> } }`
→ client calls `_scrml_reconcile_list` 1x, shipped runtime defines it 0x.

Round 1 added a single `return-stmt.markupNode` descent and a comment claiming
it closed "the one remaining carrier". That was the fifth instance of a
one-carrier-at-a-time pattern (each-block `bodyChildren`, engine-decl arms,
match-block `armsRaw`, if-chain `branches`), and three more carriers were live.

**Carriers ENUMERATED EMPIRICALLY** — parse each reproducer, walk the AST,
report every markup node reachable off the walk spine:

| carrier | source shape |
|---|---|
| `return-stmt.markupNode` | `fn listing(){ return <ul><each …></ul> }` |
| `lift-expr.expr.node`    | `${ if @show { lift <ul><each …></ul> } }` |
| `markup-value.node`      | `${ @show ? <ul><each …></ul> : "" }` |
| `render-spec.element`    | `const <listing> = <ul><each …></ul>` |

**FIX: `sweepOffSpineMarkup`** (emit-client.ts) — the rule is stated ONCE over
field POSITION, not field NAME: any markup node reachable from a visited node
through non-structural intermediates is routed back into `walkNodes`. Bounded:
markup only (structural kinds stay owned by the outer walk), stops at a markup
node (walkNodes recurses), separate `sweptNodes` set (linearity / S226 guard).
The over-claiming comment is corrected and now points at the sweep.

Bite proof: the 3 new carrier tests fail on `68cfad44`, all 22 pass at head.

## FINDING 2 — invalid alias. PARTIALLY DONE, and the relayed premise was WRONG.

Reproduced: `<each in=@rows as data-id>` in a fn body → `E-CODEGEN-INVALID-LOGIC`
on my branch, clean compile on base. Refusing is correct.

⚠ **"Your BS-structural sibling already validates" is FALSE — measured.** The
top-level path with the SAME invalid alias compiles at **exit 0** and emits

    (data, _scrml_each_idx) => data-id

i.e. it truncates the alias at the `-` and emits `data - id`, a subtraction of
two undefined identifiers. That is a SILENT-WRONG on the canonical path, and it
is worse than the lift path's loud refusal. **Mirroring it would have been a
regression.** Filed below as a new finding.

**What I did NOT do, deliberately: add the identifier guard.** The guard alone
converts a loud failure into a possible SILENT one — an alias that is declared
but never referenced in the body would then compile clean with the synthetic
`_scrml_each_item` binding, silently ignoring what the author wrote. The guard
is only safe together with a refusal, and the refusal needs a real code
(`E-EACH-AS-ALIAS-INVALID`).

**Why the code is blocked:** `.github/workflows/ci.yml:168` runs
`bun scripts/s34-census.ts --check-new --base <sha>` on every PR — a new E-code
without a §34 SPEC row red-lines CI. `compiler/SPEC.md` is in the live sibling
dispatch's write-set this round, so I cannot write that row. STOP-and-surface
per the brief rather than ship a half-mechanism.

Current behaviour is preserved and still fails CLOSED — correct direction, poor
message. The message itself is governed by the ratified Bug 70 precedent at
`api.js:2846`: raise the real diagnostic at an EARLIER stage and the emitted-JS
gate self-suppresses. That is the shape the follow-on should take.

## FINDING 3 — nested each in a fn-body each. REPRODUCED (relayed) and FIXED.

Confirmed on base AND on `68cfad44`: the inner each shipped as a literal element
— `document.createElement("each")` (not an HTML element), the alias emitted as a
DOM attribute `setAttribute("cell","")`, and `String(cell)` referencing a
binding never declared → `ReferenceError: cell is not defined`.

Root: the nested-each branch keys on the structural `each-block` kind; a
lift-parsed inner each is generic `{kind:"markup", tag:"each"}`.

⚠ **Position was load-bearing and my first attempt failed.** Placing the
promotion next to the each-block branch did nothing — `case markup` sits ~500
lines earlier in the SAME function and claims the node first. It has to run
before any kind dispatch. Caught by re-measuring, not by reading.

Covered both shapes (inner each as direct child and as grandchild), plus a
§17.7.3 test that the OUTER alias stays addressable inside the inner body.

## FINDING 4 — W-ATTR-001 false-fire. REPRODUCED and FIXED.

`W-ATTR-001: Attribute \`it=\` is not recognized on \`<each>\`` fired on CORRECT
canonical §17.7.2 source, and told the author it "is forwarded to the rendered
HTML as-is" — false; `it` is the iteration binding. It fired INCONSISTENTLY
(lift-expr carrier warned, fn-body carrier did not), so the warning was a
property of WHERE the each sat. Fixed in `validators/attribute-allowlist.ts`;
the exemption is keyed to the `as` pairing and only to a WELL-FORMED alias, with
fail-safe tests for a non-`as` bareword and for `in=`/`key=`.

## Verification

* **Browser tier: `bun scripts/browser-baseline.ts --check` → PASS**, name set
  matches the documented baseline exactly (48 asserted). ⚑ My round-1 full-suite
  set-diff flagged one "new" browser failure; it is a documented, order-flaky
  member of that baseline. The baseline script is the correct instrument for
  this tier and the set-diff is the weaker measure.
* **Full `bun run test`**: 30494 pass / 53 fail / 216 skip / 1 todo.
* **`bun run types`**: 145 diagnostics both sides; the lines touching my three
  files are byte-identical to base.
* **corpus-emit-differential** base `cb5db9c9` vs head `b1b0f1e8`:
  **20 artifact content diffs**, 0 compile-outcome / 0 diagnostic / 0 syntax /
  0 artifact-set / 0 load-context / 0 bare-server-fn delta.

### Every one of the 20 diffs accounted for

7 sources x (client.js, html, runtime). **Every `case.client.js` and `case.html`
is byte-identical after normalising the runtime content-hash reference** — the
emitted APPLICATION code did not change anywhere in the corpus. Only runtimes
changed, and **0 helpers were removed corpus-wide** (measured across all 1889
runtime artifacts, not asserted from the code comment).

**Corpus-wide dead-page census** — a client that calls a real runtime-template
helper its pruned runtime never defines:

| | base `cb5db9c9` | head `b1b0f1e8` |
|---|---|---|
| genuinely dead clients (of 1889) | **4** | **2** |

FIXED: `conformance/cases/each/ternary-markup-giti033` (the coordinator's filed
gap — was missing `_scrml_reconcile_list`, `_scrml_resolve_item`,
`_scrml_each_clear`) and
`conformance/cases/derived/e-derived-server-only-reach-nested-loop` (missing
`_scrml_derived_declare`, `_scrml_derived_subscribe`). Both are shipped
conformance cases that were dead pages on `main` while their suites passed.

⚠ **My first census said 394/392 and was WRONG by ~200x.** It counted
`if (typeof _scrml_X === "function") _scrml_X(...)` — `typeof` on an undeclared
identifier does not throw, so a guarded call is not a dead page. Caught by
spot-checking a flagged sample instead of trusting the number. The same error
had me briefly reading giti033 as "still dead at head" on
`_scrml_register_rehydrator`; that call is guarded, and giti033 is fully fixed.

### The cost, measured and not hidden

Runtime bytes corpus-wide: +94,765 over 1889 artifacts (+0.086%), and it
reconciles exactly:

* +27,038 giti033 — USED (the fix)
* +4,382 derived nested-loop — USED (the fix)
* +63,345 = 5 x 12,669 — **UNUSED**. Five cases (`if-in-dispatched-arm-neg`,
  `for-lift-per-item-if-reactive` x4) were already complete at base; the sweep
  now reaches `if=`-bearing markup off-spine and pulls the whole
  `ifmount`/`scope` chunk they do not call (their per-row `if=` lowers to
  `_scrml_ifrow_apply`, which base already shipped).

That is a real cost against the minimal-runtime remit and it is a deliberate
choice: a MISSING chunk is a dead page at exit 0, an EXTRA chunk is bytes. The
asymmetry is the same fail-safe direction the value-form-`if` work took. **The
narrowing option, if the operator prefers bytes: route only `each`-tagged markup
in the sweep — that keeps all four alias carriers and giti033, and drops the
63KB — at the cost of re-hiding any genuine off-spine `if=`/`<timer>` dead page.
Named here so it is a choice and not a default.**

## NEW findings from this round — surfaced, not closed

**NEW-1 (HIGH, unfiled) — the BS-structural `as` alias SILENTLY MIS-BINDS an
invalid identifier.** `<each in=@rows as data-id key=data-id>` at TOP LEVEL
compiles at exit 0 and emits `(data, _scrml_each_idx) => data-id`. The regex at
`ast-builder.js:16676` matches the identifier PREFIX and stops at the `-`,
leaving the rest as a subtraction of two undefined names. Worse than the lift
path (which refuses). Contradicts the review's "your BS sibling already
validates" premise. `ast-builder.js` is off-limits this dispatch.

**NEW-2 (MED, unfiled) — two dead pages remain in the corpus, different roots.**
`conformance/cases/style/flat-inline-token-unknown` calls `_scrml_effect`
unguarded against a runtime that does not define it;
`stdlib/data/form-for` calls `_scrml_labels_register` likewise. Neither is a
markup-carrier problem, so this fix does not touch them. A stdlib module
shipping a dead bundle is worth its own dispatch.

**NEW-3 (process) — I destroyed my own uncommitted work once this round** with
`git checkout <sha> -- <file>` for a bite proof before committing, exactly the
hazard the brief flagged. Recovered from context, then committed before every
subsequent step-back. The brief's rule is right and should stay loud.

## Round-2 DEFERRED (carried from round 1, still open)

* `g-each-nested-in-fn-body-markup-fn-stringifies` (MED) — untouched. Root
  re-confirmed: `_eachMarkupFnNames` is set at `emit-each.ts:3684` / cleared at
  `:3818`; the lift path runs outside that window.
* `<each … as (k, v)>` tuple destructure in a fn body — `parseLiftTag` bails on
  the `(`; fails closed with two misleading `E-SCOPE-001`s. Identical at base.
* `E-DG-002` false positive on a fn-body each source.
