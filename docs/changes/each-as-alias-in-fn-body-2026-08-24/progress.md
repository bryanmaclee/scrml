# each-as-alias-in-fn-body — progress

Worktree: /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-ae080f493c841f360
Base: cb5db9c9
Started: 2026-08-24

## Status
- [x] startup verification (pwd / toplevel / clean / merge-base == origin/main / bun install / pretest)
- [x] reproduced A/B/C/D by compiling + reading emitted output
- [x] LOCUS VERDICT: **REFINED** (see below)
- [x] limb 1 fix — alias binding (emit-each.ts) — commit a6eb4aca
- [ ] limb 2 fix — runtime chunk prune (emit-client.ts)
- [ ] merge-blocker browser test (bite-proven)
- [ ] corpus count
- [ ] corpus-emit-differential
- [ ] full `bun run test` set-diff

## Locus verdict — REFINED

The brief located it at `emit-each.ts` and hypothesised "the fn-body `<each>` is
emitted through a path that skips lowering the top-level path runs". The PATH
claim HELD — the fn-body each goes
`emit-lift.js:tryEmitNestedLiftEach` → `emit-each.ts:emitNestedEachFromMarkup`
→ `eachBlockFromMarkupNode`, not the BS-structural `buildBlock` each-block
dispatch. The DEFECT is NOT a missing lowering pass though; it is a
**one-line attribute-read bug** in `eachBlockFromMarkupNode`.

The prior session's `_eachMarkupFnNames`-null note at `emit-each.ts:1406` is
**NOT** the cause of the alias limb. Not relied on.

### Root cause (limb 1) — verified by dumping the AST

`as name` is a BAREWORD PAIR in the §17.7.2 grammar (all four canonical shapes
spell it `as conflict` / `as day` / `as row` — never `as=conflict`).
`parseLiftTag` (`ast-builder.js:5404`) tokenises an opener into `name[=value]`
attributes, so the pair arrives as TWO ADJACENT VALUE-LESS attributes.
Measured AST for repro A:

    attrs: [ {name:"in",  value:{kind:"variable-ref", name:"@rows"}},
             {name:"as",  value:{kind:"absent"}},
             {name:"it",  value:{kind:"absent"}},
             {name:"key", value:{kind:"variable-ref", name:"it"}} ]

`eachBlockFromMarkupNode` read `attrs.as.value` alone → `{kind:"absent"}` →
`eachAttrRawText` → null → alias null → caller fell back to the synthetic
`_scrml_each_item` iter var, while the body still lowered `${it}` as a bare
identifier.

⚑ The pre-existing comment in that slot asserted the opposite and was WRONG:
"markup attrs from lift already split `in=`/`of=`/`as`/`key=`". They do not
split `as`. Replaced.

Only the LIFT path was affected — the BS-structural path re-splits the raw
header text and has always handled the bareword form. That is exactly why
top-level (C, D) worked and the identical `<each>` in a `fn` body did not.

## Limb 2 — a SECOND, independent HIGH silent-miscompile (found by executing)

Measured on base `cb5db9c9`: repro A's shipped runtime
(`scrml-runtime.<hash>.js`, the file `a.html` actually loads) contains
**ZERO** occurrences of `function _scrml_reconcile_list`, while `a.client.js`
CALLS it. So in a real browser the FIRST error is
`ReferenceError: _scrml_reconcile_list is not defined`, not the alias error —
the alias error is what you get when the FULL unpruned `SCRML_RUNTIME` is
loaded (which is how the brief's PA verification was run).

**Repro B is affected too** (`grep -c 'function _scrml_reconcile_list'` → 0),
so the brief's "(B) WORKS" also holds only under the full runtime.

Cause: `emit-client.ts`'s chunk-detect walker has explicit "descend so the
`<each>` is seen" cases for `each-block`, `for-stmt`, `engine-decl` arms and
`match-block` arms — but a `return-stmt`'s `markupNode` is never descended, and
a generic `{kind:"markup", tag:"each"}` node (what `parseLiftTag` produces) has
no tag test. Identical failure class to Bug 57, which that file's own comments
document.

Fixing limb 1 alone leaves the shape dead in a browser, so the dispatch
DONE-PROBE ("executes in happy-dom with ZERO errors") cannot be met without
limb 2. Taken deliberately; surfaced as a scope addition.
