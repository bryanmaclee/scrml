# S385 round 5 — gap drafts for `known-gaps.md`

`known-gaps.md` is PA-owned and has a PR open against it. Nothing here is filed;
these are drafts for the PA to file.

**Already filed by the PA** (from round 3/4 drafts): `GAP-S385-EACH-KEY-DESTRUCTURE`,
`GAP-S385-EACH-ITER-SHAPE-UNFIRED`.

**Still drafted and awaiting filing, unchanged, at
`docs/changes/s385-each-in-scope-check-r4/GAP-DRAFTS.md`:**
`GAP-S385-EACH-OPENER-INTERPOLATION`, `GAP-S385-VALIDATE-EMIT-SKIPPED-WHEN-WRITE-FALSE`.

**New in round 5** — three drafted below, plus one surfaced-not-drafted note.

Every measurement in this file was produced by EXECUTION in this worktree at
round 4's tip (`e41dc6a3`), with the base side obtained by FILE COPY of
`origin/main`'s `type-system.ts` (never `git stash` — `refs/stash` is shared
across every worktree in the checkout).

---

## GAP-S385-LAMBDA-BODY-READS-UNCHECKED — no read inside a lambda body is ever scope-checked

**Severity: HIGH.** A pure undeclared-cell typo — a name declared NOWHERE in the
file — compiles exit 0 and produces a list that renders empty forever. This is
verbatim the failure mode the whole S385 arc exists to close, reached by putting
the typo one lambda deep.

### The finding

`forEachIdentInExprNode` does not descend into a `lambda` node's body. The guard
is LOAD-BEARING and must not simply be deleted: it is exactly what keeps
`in=@rows.filter(n => n > 1)` from reporting the parameter `n` as an outer-scope
read, and its absence is what produced round 3's F1 false positive (the reason
this arc reached round 4 at all).

But the guard is TOTAL. Nothing inside any lambda body is checked, by this walker,
for any consumer of it.

### Reproducer — measured, `compileScrml({write:false})`, E-codes across BOTH streams

| source | E-codes |
| --- | --- |
| `<each in=@rows.filter(n => n > @typoInside) as x>` | **`[]` — SILENT** |
| `<each in=@rows.filter(n => n > typoBareInside) as x>` | **`[]` — SILENT** |
| `<each in=@rows as r key=r.tags.map(t => t + @typoInside).join("-")>` | **`[]` — SILENT** |
| `<each in=@rows.filter(n => n > 1).concat(@typoOutside) as x>` | `[E-STATE-UNDECLARED]` — fires |

NOT `<each>`-SPECIFIC — the same walker, the same hole, in plain `${ }` logic:

| source | E-codes |
| --- | --- |
| `${ const out = @rows.filter(n => n > @typoInsideLogicLambda) }` | **`[]` — SILENT** |
| `${ const out = @rows.concat(@typoOutsideLogicLambda) }` | `[E-STATE-UNDECLARED]` — fires |

### Why it is HIGH and not a curiosity

Compiled THROUGH THE CLI the first row exits 0 and emits, verbatim:

```js
const _items = _scrml_cs_reactive_get("rows")
  .filter(n => n > _scrml_cs_reactive_get("typoInsideInLambda"));
```

`_scrml_cs_reactive_get("typoInsideInLambda")` is `undefined`; `n > undefined` is
`false` for every `n`; the filter returns `[]`; **the list renders empty, forever,
with zero diagnostic.**

`.filter(…)` over a reactive cell is not an exotic shape — it is the single most
common thing an adopter writes in an `<each>` opener, and a filter predicate is
exactly where a threshold cell (`@minScore`, `@selectedTag`, `@cutoffDate`) gets
read. So the highest-traffic opener shape is the one position the check cannot
see.

### Fix sketch (NOT done here — deliberately out of scope for S385)

Descend into the lambda body AFTER binding its parameters — including the
destructuring forms `([k, v]) => …`, `({ id }) => …`, `({ id: rowId }) => …` and
`(...args) => …`, all of which already appear in the S385 §10 shape table. That
is a change to the SHARED walker: every `${…}` interpolation, every condition,
every prop, every return expression. It is therefore **newly-rejecting
language-wide**, not at three `<each>` slots, and owes its own measured corpus
migration and its own ruling before it lands.

Round 4 is the standing lesson here: it measured 0 newly-failing of 1005 files,
the measurement was CORRECT, and it still shipped a HIGH false positive because
no corpus file happened to write the tripping shape. A change of this width needs
BOTH a differential AND an enumerated adversarial shape set.

### Test anchor

`compiler/tests/unit/each-opener-expr-undeclared-read.test.js` §12 — a live
CONTRAST case asserting the check fires one position over (outside the lambda),
plus a `test.todo` naming this id. Deliberately no "compiles clean" assertion on
the broken shape: that would be the suite blessing the failure class.

---

## GAP-S385-AT-READ-OVER-NON-REACTIVE-BINDING — `@name` resolves onto a plain `const` and goes silent

**Severity: MEDIUM.** A `@`-sigil read of a name that is bound, but not to a
reactive cell, compiles exit 0 and renders an empty list forever. Lower than the
lambda hole only because the name at least exists somewhere in the file, so the
author has a thread to pull.

### The finding

The `@`-branch of `checkLogicExprIdents` resolves the sigil form and then FALLS
BACK to the bare name (`compiler/src/type-system.ts:7823-7825`):

```ts
const atEntry = scopeChain.lookup(raw.includes(".") ? raw.slice(0, raw.indexOf(".")) : raw)
  ?? scopeChain.lookup(atBase);
if (atEntry) return; // resolves to a cell / loop local / import — in scope.
```

Any binding of the bare name satisfies the lookup: a plain `const` / `let`, a
function parameter, a value import. The read then goes silent even though no
reactive cell exists and codegen will emit a reactive get.

### Reproducer — measured through the CLI, not just the API

```
${ const items = [1, 2, 3] }
<div><each in=@items as r><span>{r}</span></each></div>
```

`exit 0`. Zero `E-` diagnostics. Emitted client:

```js
const _items = _scrml_cs_reactive_get("items");        // -> undefined
if (!_items) { _scrml_each_clear(_mount); return; }    // -> empty, forever
...
const items = [1, 2, 3];                               // a plain JS const
```

Base/build flip: `origin/main` 0 E-codes, S385-r4 build 0 E-codes — IDENTICAL.
Pre-existing; the arc neither caused it nor closes it. The plain-logic sibling
`${ const items = […]; const total = @items.length }` is silent too.

### The complication that makes this NOT a one-line gate

The bare fallback is **deliberate and documented**. The walker's own comment
(`type-system.ts` ~:7789) states the intent:

> a `reactive` (state cell / engine cell / markup-derived cell) OR a `variable`
> (the `<each>`/`<tableFor>` `as`-name loop local) OR an `import` binding
> resolves it.

So gating on `kind === "reactive" | "import"` newly-rejects `@<each-row-local>`,
which is an acceptance the walker was written to provide — not merely stray
consts. Whether `@rowLocal` SHOULD resolve is itself a design question (codegen
rejects it; see the next draft), and it wants an answer before the gate lands.

### Fix sketch

Two parts, and they should be decided together:

1. Rule on whether `@<loop local>` is a legal read at all. Codegen says no
   (`E-CODEGEN-INVALID-LOGIC` on `key=@x`); the typer says yes. One of them is
   wrong and the SPEC §6.1.2 sentence — which lists "an `<each>`/`<tableFor>`
   loop local" among the things that resolve a `@varname` read — currently reads
   as siding with the typer.
2. Then gate the fallback on the ratified kind set.

### Test anchor

`compiler/tests/unit/each-opener-expr-undeclared-read.test.js` §12 — live
CONTRAST case (the check IS live when the name resolves to nothing at all) plus a
`test.todo` naming this id.

---

## GAP-S385-EACH-KEY-AT-SIGIL-FALSE-NEGATIVE — `key=@<asName>` passes the typer and fails codegen

**Severity: LOW.** No valid program is affected — the CLI still rejects it. It
matters because the two harnesses give opposite verdicts on the same source, and
the silent one is the LSP.

### The finding

`<each in=@rows as x key=@x>` binds `x` as a per-item function parameter, so `@x`
is not a cell read at all. It is accepted by the typer for the
`GAP-S385-AT-READ-OVER-NON-REACTIVE-BINDING` reason above, compounded by
placement: `key=` is deliberately checked AFTER the `as` binding (ORDERING TRAP C
— and that placement is CORRECT, it is what lets `key=r.id` work), so `x` is in
scope and the bare fallback resolves `@x` onto it.

### Reproducer — one source, two harnesses, opposite verdicts

| harness | verdict |
| --- | --- |
| `scrml compile` (writes) | **FAILED — 1 error.** `E-CODEGEN-INVALID-LOGIC`, stage CG, `Unexpected character '@'` at `..., (x, _scrml_each_idx) => @x, ...` |
| `compileScrml({write:false})` | **0 E-codes** — silent accept |

`origin/main` is silent on the `write:false` path too. Pre-existing.

### Why it is worth filing

It is a second instance of `GAP-S385-VALIDATE-EMIT-SKIPPED-WHEN-WRITE-FALSE`
reached through a DIFFERENT front door, which is what makes it evidence rather
than a duplicate: the emitted-JS parse gate is the only thing catching a whole
class of typer false negatives, and it does not run for the LSP. An editor
showing a clean buffer for source that will not build is the same silent-wrong
class S385 exists to close, one stage over.

Fixing the sigil question (draft above, part 1) closes this at the typer and
makes the divergence moot for this shape.

### Test anchor

`compiler/tests/unit/each-opener-expr-undeclared-read.test.js` §13(a) — the
current typer verdict is RECORDED with an in-assertion note saying it is a known
false negative and what to do when it closes, plus a `test.todo` naming this id.

---

## Surfaced, NOT drafted

### `<List items=@rows.filter(…)/>` now fires E-SCOPE-001 on a component prop

Out of scope for this arc by direction, recorded so it is not lost. Net-positive
versus main (which shipped a runtime `ReferenceError`), zero corpus usage. The
real defect is in `component-expander.ts` prop substitution, and belongs to
whoever owns that surface — not to the `<each>` opener check.

### `E-EACH-ITER-SHAPE` is still unimplemented

Round 3 drafted this (`GAP-S385-EACH-ITER-SHAPE-UNFIRED`); round 4 re-relied on
it; round 5 does too. The `in=`/`of=` check is `iterShape`-gated precisely
because `<each in=@rows of=@typo>` has no conflict diagnostic to defer to.
Unchanged.

### The types-gate baseline is stale on this branch

`bun scripts/types-gate.ts --check` reports **4 NEW / 0 GROWN** at the PRISTINE
round-4 tip, before any round-5 edit — three in `compiler/src/codegen/emit-each.ts`
(TS7006 ×2, TS7016 ×1) and one in `compiler/src/route-inference.ts` (TS2352).
Neither file is touched by this arc, and the count is byte-identical before and
after every round-5 edit. It is branch-base staleness relative to the checked-in
types baseline, not a regression from this work. Flagged so the PA does not read
it as one at landing.
