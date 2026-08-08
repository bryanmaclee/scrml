# s330 — unify the §18.5 match block-arm tail classifier

Base: `e8db05a7` (main, #469 landed). Worktree: `agent-a62c42f52f0a6e2dc`.

Two coupled compute-lane fixes to §18.5 block-arm tail lowering. §18.5 (SPEC.md
~12659): a block arm `{ statement* expression? }` yields its LAST expression; a
block with no trailing value expression (all statements / a decl / assignment /
`lift` / `fail` tail / empty) yields `void`.

## The disagreeing-near-duplicate-predicate bug

Two §18.5 block-arm tail classifiers existed and could DISAGREE:
- **Raw-string path** — `_blockTailIsValueExpr(tailString)` (emit-logic.ts),
  reached via `planBlockArmLift` / `_emitBlockArmValueFromString`. Used by plain
  local decl, return-`match`, multi-scrutinee, derived cell.
- **structuredBody path** — an ad-hoc NODE predicate in emit-control-flow.ts
  `emitMatchExpr` (`_lastNode.kind === "bare-expr" && exprNode.kind !== "assign"
  && not-a-~-orphan`). Used by match-interp / `match-arm-block` arms.

MEASURED divergence on base (`e8db05a7`), member-assign tail `{ …; o.n = 2 }`:
- raw-decl path emitted `_scrml_tilde_3 = o . n = 2;` (LIFTS — wrong, yields the
  assigned value 2)
- structuredBody path emitted `{ const o = {n:1};; o.n = 2; }` with fall-through
  (VOIDS — correct)

So `const r = match k { .A :> { o.n = 2 } }` and `${ match k { .A :> { o.n = 2 } } }`
gave the SAME source DIFFERENT meaning. Gaps
`g-match-block-iife-tail-classifier-diverges-from-shared-plan` (MED) +
`g-match-block-member-assign-tail-lifts-as-chained-assignment` (LOW).

## Fix 1 — member/index-assign LOW bug in `_blockTailIsValueExpr` (emit-logic.ts:4559)

The assignment-statement guard's target char class was `[\w$.\[\]]*` (no `\s`).
But the tail reaches the predicate SPACE-NORMALIZED (`o . n = 2`, `xs [0] = 9`),
so the class could not span the gaps → a member/index-assignment tail was not
recognized as an assignment → wrongly LIFTED. Fix: `[\w$.\[\]\s]*`. `\s` is inert
against a genuine value tail (a `+`/`?`/`(`/`==`/`>=` operator terminates the
class before the assignment alternation). Raw path now VOIDS member/index-assign
tails per §18.5.

## Fix 2 — unify the classifiers through ONE shared rule

- Exported `_blockTailIsValueExpr` from emit-logic.ts; imported into
  emit-control-flow.ts.
- The structuredBody path (emit-control-flow.ts `emitMatchExpr`) now DELEGATES its
  value-vs-void call to `_blockTailIsValueExpr`. The node-kind gate does only what
  a string cannot: admit exactly a value-capable `bare-expr` tail (every other
  node kind → §18.5 void) and screen the lone `~` orphan. For that `bare-expr`,
  the tail string is derived `_lastNode.expr ?? emitStringFromTree(exprNode)` (the
  SAME derivation the sibling structuredBody path emit-logic.ts:~4735 already
  used) and handed to the shared rule.
- The ad-hoc `exprNode.kind !== "assign"` disjunct is REMOVED — it is now
  subsumed by the shared rule (assignment-expr regex + escape-hatch check).

Net: the third consumer (emit-logic.ts `emitMatchExprToTilde`, ~:4738) already
delegated to `_blockTailIsValueExpr`. After Fix 2 ALL THREE match-block tail
classification sites route through the ONE rule; there is no second independent
value/void predicate.

## Verification (post-fix, via compileScrml repros)

- member-assign tail VOIDs in BOTH paths (raw: outer result var untouched;
  interp: IIFE fall-through). Same emission decision — no divergence.
- value tail still LIFTS in both paths (`return c` structuredBody; `~ = …` raw).
- index-assign tail (`xs[0] = 9`) VOIDs in raw path (Fix 1).
- object-literal + empty-`{}` arms byte-identical base-vs-head (stash-compared).

## Changes
- `compiler/src/codegen/emit-logic.ts` — Fix 1 (regex class `\s`) at the
  assignment guard; `export` on `_blockTailIsValueExpr`.
- `compiler/src/codegen/emit-control-flow.ts` — import `_blockTailIsValueExpr`;
  Fix 2 delegation in the structuredBody branch.
- `conformance/cases/match-block/member-assign-tail-voids-all-paths/` — new case.
