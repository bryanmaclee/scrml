# g-division-in-ternary-arm — progress

pwd: /home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-aa5f11adc8b349d93

## Phase 0 — DIAGNOSE (DONE)

Root locus: `compiler/src/ast-builder.js` `collectExpr()`, the S25 typed-reactive
boundary break (was line 3046-3047 / now ~3061).

Mechanism (the brief's `/`-as-regex / code-segments.ts hypothesis is WRONG; ruled out empirically):
- The tokenizer correctly lexes the `/` as `PUNCT:"/"` (NOT a regex) in all ternary-arm
  positions — `isRegexContext()` returns false because the preceding token is an
  AT_IDENT/operand. `parseExprToNode` on the FULL string produces a correct ternary AST.
- The truncation is UPSTREAM of both: `collectExpr()` truncated the RAW init string.
  For `const <ratio> = @e > 0 ? @h / @e : @h`, `node.init` came out as `"@e > 0 ? @h /"`
  (the `@e : @h` dropped) and `node.initExpr` fell back to `escape-hatch` (the truncated
  string is unparseable). Codegen then emitted the raw truncated string -> E-CODEGEN-INVALID-JS.
- The `/` is a RED HERRING. The actual trigger is an `@cell` immediately before a ternary
  value-arm `:`. The S25 boundary check (`isTypedReactive`) breaks on `@ident :` believing
  it is the start of a typed reactive state-decl (`@name: Type`). Its stale comment claimed
  "`:` after `@` cannot appear mid-expression at depth 0 (ternary uses `?`)" — FALSE: a
  ternary consequent can be a bare `@cell`, so `cond ? @cell : alt` has a depth-0 `@cell :`.
- Proof: `@e > 0 ? @h : @z` (NO `/` at all) ALSO truncates at `?`. `@e > 0 ? 1 / 2 : 3`
  (`/` present, literal arms) is CLEAN. So the differentiator is `@cell`-before-`:`, not `/`.

## Phase 1 — FIX (DONE)

Added `ternaryDepth` tracking to `collectExpr()`: increment on a depth-0 (and angleDepth-0)
`PUNCT:"?"`, decrement on the matching depth-0 `:`. Guarded the `isTypedReactive` break with
`ternaryDepth === 0` so it fires ONLY for a genuine top-level typed-reactive decl, never
inside a ternary arm. `?.`/`??` tokenize as OPERATOR (not `PUNCT "?"`) so optional-chaining /
nullish do not perturb the count. Corrected the stale S25 comment.

S25 regression verified: `@x = 1` then `@y: number = 2` still splits into two state-decls;
ternary-then-typed-decl both parse.

## Phase 2 — TESTS (DONE)

compiler/tests/unit/division-in-ternary-arm.test.js — 15 cases: AST no-truncation
(consequent/alternative/derived/red-herring-no-slash/nested), S25 typed-reactive
regression (2), full-compile valid-division-JS (4 positions), clean-stays-clean
(standalone / literal-arms / *-in-arm / regex-verbatim). All 15 pass.

## Phase 3 — GAP flip + body correction (DONE)

known-gaps.md g-division-in-ternary-arm: status=open -> status=resolved; body
rewritten with the diagnosed real root (collectExpr S25 typed-reactive boundary
mis-fire on a ternary `@cell :`), explicitly flagging the original
code-segments.ts / `/`-as-regex hypothesis as verified-WRONG.

## Phase 4 — R26 (DONE)

All 4 FAIL-cases compile 0-error + emit correct division (`node --check` clean);
all CLEAN-cases stay clean; `/not found/i` regex verbatim. Per-case results in
the final report.
