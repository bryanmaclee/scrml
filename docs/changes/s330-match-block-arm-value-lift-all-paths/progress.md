# S330 — §18.5 match block-arm value-lift across all value-position paths

## Problem
PR #463 fixed the §18.5 block-arm tail lift for ONE path only — `emitMatchExprDecl`
(plain local `const r = match k { … }`) via `_emitBlockArmValueFromString` in
`emit-logic.ts`. Four other value-position paths, all funnelling through the
value-returning IIFE built by `emitMatchExpr` (`emit-control-flow.ts`), still
DROPPED the block-arm tail and yielded `undefined`:

1. return-position `return match k { 1 :> { const c="one"; c } … }`
2. multi-scrutinee decl `const r = match (a,b) { (1,2) :> { const c="x"; c } … }`
3. derived cell `const <label> = match @level { .Low :> { const c="green"; c } … }`
4. markup interpolation `${ match @level { .Low :> { const c="green"; c } … } }`

PA-reproduced on HEAD eeb70cde: each block arm emitted `{ const c = "…"; c }`
(bare tail statement, discarded) instead of lifting the tail.

## Root cause / live paths (traced with repros)
- return / multi / derived hit the RAW-STRING `arm.result` `isBlockBody` branch
  (single-scrutinee: `emitMatchExpr` ~2312; multi-scrutinee: `emitMultiArmBody`).
- markup interpolation hits the AST-node `arm.structuredBody` branch (~2311) —
  its tail node's emission (`emitLogicBody(...).join("; ")`) dropped the tail.
- So BOTH branches were live; both fixed.

## Fix
Shared the §18.5 tail classifier rather than authoring a near-duplicate
(the repo's standing hazard).

- `emit-logic.ts`:
  - `export function planBlockArmLift(inner)` — the ONE classifier-driven plan
    (split top-level statements, classify the tail via `_blockTailIsValueExpr`);
    returns `{ leading, tail|null }`. `_emitBlockArmValueFromString` refactored to
    dogfood it (proves shared path).
  - `export`ed `_awaitMatchArmServerCalls` (§13.2 auto-await) and
    `_matchArmResultIsBlockBody` (parser-based object-literal vs statement-block
    gate) for reuse.
- `emit-control-flow.ts`:
  - new local `emitIifeBlockArmBody(result, prelude, engineCtx, matchMode, matchCtx, opts)`
    — object-literal gate (`_matchArmResultIsBlockBody`) keeps object-literal + empty
    `{}` arms BYTE-IDENTICAL to pre-fix; genuine statement blocks lift the tail with
    `return <rhs>` (auto-await applied); void/statement tails fall through → IIFE
    returns `undefined` = §18.5 void.
  - single-scrutinee `isBlockBody` branch + `emitMultiArmBody` route through it.
  - `structuredBody` branch: lift the tail when the LAST node is a value-expression
    `bare-expr` (not assign / lift / decl / control-flow / lone `~`), else void
    (byte-identical join).

## Scope fences honored
- Empty-arm `{}` unchanged (routed to bryan separately). Object-literal + bare-value
  arms byte-identical (verified — object-literal return-position still emits the
  identical pre-existing `{ x : 1 , y : 2 }`).
- #463 keyword-charset fence `(?![A-Za-z0-9_$])` untouched.

## Verification
- 4 broken paths + control repros: all now lift the tail (`return <tail>` /
  `_scrml_tilde = <tail>`); control unchanged.
- Runtime: derived-cell conformance case green incl. reactive recompute green→red;
  markup IIFE executed in isolation → Low="green"/High="gray" (tail value, not undefined).
- Conformance: 867/867 pass (865 + 2 new cases).
- 2 new conformance cases (DATA): value-form-block-arm-all-paths (codes+runtime),
  value-form-block-arm-derived-reactive (codes+runtime reactive).

## Pre-existing gaps found (OUT OF SCOPE — flagged, not touched)
- Markup interpolation of a match expression written DIRECTLY inline (`${ match … }`)
  emits the IIFE as a bare, unterminated top-level statement (no `;`, no DOM wiring),
  so ASI concatenates it with the next block → runtime "X is not a function" (pre-fix
  it crashed as `undefined(...)`, now `"green"(...)`). This is the interp-of-match
  RENDERING pipeline, NOT the block-arm tail lift — my fix correctly lifts the tail in
  the emitted IIFE. Documented by the existing `value-form-derived` case note.
- Object-literal arm in a return-position match (`return match k { 1 :> { x:1 } … }`)
  is pre-existing E-CODEGEN-INVALID-LOGIC in the IIFE path (naive isBlockBody treats it
  as a block). Preserved byte-identical; separate bug.
- `self-compilation.test.js` fails identically on baseline (stale main-checkout
  `compiler/dist` self-host build) — environmental, unrelated.
