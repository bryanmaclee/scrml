# BRIEF — s330 unify the §18.5 match block-arm tail classifier (+ member-assign LOW)

**Gaps:** `g-match-block-iife-tail-classifier-diverges-from-shared-plan` (MED, S330) + `g-match-block-member-assign-tail-lifts-as-chained-assignment` (LOW, S328). Coupled.
**Lane:** compute · toward §18.5 (already ruled) · semantics-changed on one degenerate shape (member-assign tail: lift→void) → PA language-surface review run.
**Session:** S330-peter. **Dev:** general-purpose (worktree, Opus).

## Problem
Post-#469 there were TWO §18.5 block-arm tail classifiers: the raw-string path (`_blockTailIsValueExpr` via `planBlockArmLift`) and the structuredBody path's ad-hoc node predicate (`exprNode.kind !== "assign"`). They diverged on a member/index-assignment tail — the raw path LIFTED it (`return o.n = 2`, the LOW bug: the assignment-guard regex char class lacked `\s`, so space-normalized `o . n = 2` wasn't caught), the node path voided it. Same source, different meaning by position — the repo's disagreeing-near-duplicate-classifier hazard.

## Fix (two coupled)
1. **emit-logic.ts** — `_blockTailIsValueExpr` assignment-guard char class `[\w$.\[\]]*` → `[\w$.\[\]\s]*` (the raw path now voids member/index-assign tails). Exported the function.
2. **emit-control-flow.ts** — deleted the ad-hoc `exprNode.kind !== "assign"` disjunct; the structuredBody branch now stringifies the tail (`_lastNode.expr ?? emitStringFromTree(exprNode)`) and delegates the value/void call to the shared `_blockTailIsValueExpr`. Node-kind gate only admits a value-capable `bare-expr` / screens the `~` orphan. All three tail positions (raw-string, IIFE, tilde) now route through ONE classifier; the escape-hatch exclusion is shared too.

## Verification (PA-side, independent)
- Divergence probe: member-assign tail now VOIDS in BOTH the raw-decl and markup-interp positions (was lift-vs-void).
- #469 matrix: all value-position paths still lift; empty-`{}` and object-literal arms byte-identical.
- One-classifier grep: no second value/void predicate remains.
- **Full-corpus emit-differential (base e8db05a7 vs head): 0 of 7296 artifacts changed** — byte-identical everywhere; the behavior change touches zero corpus files (degenerate shape). 0 diagnostic-code changes.
- Conformance 868/868 (+ new differential case `member-assign-tail-voids-all-paths`, domAnchored across all 3 positions). FACTS.md regen 867→868.

## Result
Both gaps RESOLVED. One §18.5 tail rule; the hazard is removed.
