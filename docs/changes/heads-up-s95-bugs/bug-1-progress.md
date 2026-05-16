# Bug 1 — Value-return `match expr { .Variant(payload) => expr, _ => default }` malformed JS

## Investigation summary

The reproducer `return match @dragPhase { .Dragging(d) => d == targetId   _ => false }` flows through:

1. `ast-builder.js` parses the function body. `return ... match` (expression position) goes through `collectExpr()` (line 4943) which collects the entire RHS as a string and then runs `safeParseExprToNode`.
2. `expression-parser.ts:714` calls `preprocessMatchExprs` which detects `match`, extracts subject + arms, splits arms via `splitMatchArms` (line 904), and rewrites to `__scrml_match__(subject, "arm0", "arm1", ...)`.
3. `splitMatchArms` (line 904) splits arms by line-start: it recognizes lines starting with `.` (variant) or `else` (wildcard). It does NOT recognize `_` (legacy wildcard alias).
4. Result: arms is `[".Dragging(d) => d == targetId _ => false"]` — a single concatenated arm string.
5. The acorn-parsed call gets converted to `MatchExpr { subject, rawArms }` by `esTreeToExprNode` (expression-parser.ts:1238).
6. `emit-logic.ts:return-stmt` calls `emitExpr` on the structured ExprNode.
7. `emit-expr.ts:164` dispatches `match-expr` to a SHIM (line 812-821) that reconstructs the match as a STRING and runs the legacy `rewriteExpr` (string pipeline) — NOT the structured `emitMatchExpr` in `emit-control-flow.ts`. The shim has no payload-binding lowering.
8. `rewrite.ts:rewriteMatchExpr` (line 1093) calls `splitInlineArms` → `_splitMultiArmString` which ALSO only recognizes `_ ->` (legacy), NOT `_ =>`. So the wildcard arm isn't split out.
9. The single arm is parsed by `parseInlineMatchArm` (rewrite.ts:753): the `newVariantMatch` regex (line 778) captures `.Dragging(d) => d == targetId _ => false` as a variant arm with result `d == targetId _ => false`.
10. Output: `if (_scrml_match_X === "Dragging") return d == targetId _ => false;` — but somehow it comes out as `else return ...`. (Actual: dropped arm in this specific case + the result text leaks through, producing the SyntaxError.)
11. Additionally, even when split correctly, `parseMatchArm` (emit-control-flow.ts:784) and `parseInlineMatchArm` (rewrite.ts:753) both only recognize `_ ->` not `_ =>`, so the wildcard arm is silently dropped.
12. Payload binding `d` is NEVER destructured by the string-pipeline `rewriteMatchExpr` — it just emits the raw text `d == targetId`, which references unbound `d`. This is the structural bug at the heart of the brief.

## Root cause

Two layers:
- **Primary**: the expression-position `match-expr` emit-shim at `emit-expr.ts:812` falls back to the STRING pipeline `rewriteMatchExpr`. The string pipeline never had payload-binding lowering (the structured emitter at `emit-control-flow.ts:1352` has it, but the shim doesn't call it).
- **Secondary**: multiple arm splitters/parsers (`expression-parser.splitMatchArms`, `emit-control-flow.splitMultiArmString`, `emit-control-flow.parseMatchArm`, `rewrite._splitMultiArmString`, `rewrite.parseInlineMatchArm`) only recognize the legacy `_ ->` wildcard, not the modern `_ =>`. This causes the wildcard arm to be lumped into the previous arm or silently dropped.

## Fix plan

1. **`emit-expr.ts:812`** — Bridge `MatchExpr { subject, rawArms }` to structured `emitMatchExpr` from emit-control-flow.ts. The structured emitter already has payload-binding lowering.
2. **`emit-control-flow.ts:parseMatchArm`** — Add `_ =>` / `_ :>` wildcard form.
3. **`emit-control-flow.ts:splitMultiArmString`** — Recognize `_ =>` as wildcard boundary.
4. **`expression-parser.ts:splitMatchArms`** — Recognize `_` as wildcard line-start alongside `.` and `else`.
5. **`rewrite.ts:parseInlineMatchArm`** — Mirror parity (`_ =>`).
6. **`rewrite.ts:_splitMultiArmString`** — Mirror parity (`_ =>`).
7. **Regression tests** — Cover all four arm shapes per requirements 3 in the brief.

## Baseline

Tests pass: 12054 / 12143 (88 skip / 1 todo / 0 fail).

## Final state

All requirements satisfied per the brief:
- Payload-binding variant arms emit correct destructuring (`const d = _scrml_match_N.data.id`).
- Wildcard `_` arm lowers to a clean `else` branch.
- All four arm shapes work: unit / single positional / multi positional / wildcard.
- Mixed arms work.
- Reproducer compiles to valid JS that returns the correct boolean at runtime.

Tests after: 12070 / 12159 (88 skip / 1 todo / 0 fail). Net +16 new tests
covering Bug 1 fixes; zero regressions.

## Files touched

- `compiler/src/codegen/emit-expr.ts` — Bridge MatchExpr (expression-position)
  through the structured emitter in emit-control-flow.ts. Client mode goes
  through the structured emitter (payload bindings + wildcard). Server mode
  falls back to legacy rewriteServerExpr (with parity fixes in rewrite.ts).
- `compiler/src/codegen/emit-control-flow.ts`:
  - `parseMatchArm`: add `_ =>` / `_ :>` wildcard form.
  - `splitMultiArmString`: add `_ =>` / `_ :>` / `_ ->` standalone-token
    boundary detection.
- `compiler/src/codegen/rewrite.ts`:
  - `parseInlineMatchArm`: add `_ =>` / `_ :>` wildcard form (parity).
  - `_splitMultiArmString`: add `_ =>` / `_ :>` / `_ ->` boundary detection
    (parity).
- `compiler/src/expression-parser.ts`:
  - `splitMatchArms`: recognize `_` (followed by arrow) and `not` (followed
    by arrow) as arm-start tokens alongside `.` and `else`. Previously only
    `.` and `else` were recognized, causing `_ => false` lines to be
    appended to the prior arm's result string.
- `compiler/tests/unit/bug-1-s95-value-return-match.test.js` — new test
  file with 16 tests covering parseMatchArm + splitMultiArmString +
  rewriteMatchExpr + structured emitMatchExpr + end-to-end compile.

## Out-of-scope / surfaced findings

- The structured emitter (`emit-control-flow.ts:emitMatchExpr`) hardcodes
  its internal `_matchCtx.mode` to `"client"` (line 1378). This means
  `@var` references inside server-position match expressions (rare —
  channel init expressions in emit-server.ts:887/1068/1172) would be
  lowered to client-side `_scrml_reactive_get(...)` if routed through the
  bridge. Therefore the emit-expr.ts shim's server branch is left on the
  legacy `rewriteServerExpr` path (which now has parity for `_ =>`
  wildcard recognition via the rewrite.ts fixes). A future cleanup could
  thread `boundary` through the structured emitter, but that's out of
  Bug 1 scope.
- The expression-parser `splitMatchArms` is a simple line-start detector.
  More complex inline forms (multiple arms on one line) still route through
  `splitMultiArmString` downstream. The fix here makes the input cleaner
  but doesn't change the downstream resilience.
- `_makeExprCtx` in emit-logic.ts hardcodes `mode: "client"` regardless of
  `opts.boundary`. This is pre-existing and unrelated to Bug 1, but means
  server-function return-stmts route through the client branch of the
  bridge. That's still correct for the server-function-body shape (no
  `@var` references in handler parameter destructure), but worth noting
  for future audits.

## Commits (chronological)

1. `0b3679f` — WIP: investigation + fix plan
2. `4ce0582` — fix: bridge expr-position match-expr through structured emitter + recognize `_ =>` wildcard
3. `20362ba` — test: regression tests for value-return match with payload + `_` wildcard
4. `7a478d7` — fix: parity — recognize `_ =>` wildcard in legacy string-pipeline + expression-parser splitters
5. `14e378c` — test: add low-level splitter/parser parity tests
