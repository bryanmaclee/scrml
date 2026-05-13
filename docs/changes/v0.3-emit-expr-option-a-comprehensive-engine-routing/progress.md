# emit-expr.ts:emitAssign — Option A comprehensive engine-routing

## Status: IN PROGRESS

## Worktree: `worktree-agent-a580b7d610279f725`

## Phase 0 — Setup + diagnosis (2026-05-12)

- Verified worktree clean, `bun install` + `bun run pretest` green at base SHA `7a00b1b` (S86 close).
- Read maps (primary, structure) + BRIEFING-ANTI-PATTERNS + Bug 1.6+1.7 progress.md.
- Cherry-picked S87/S88 prerequisite commits (Bug 1 fix-A + Bug 6.5 tests + Option-d D1 runtime no-op + Bug 1.7 fix + Bug 1.7 tests). Resolved one merge conflict in `emit-control-flow.ts:emitMatchExpr` docstring (kept incoming Bug 1.7 form; semantically equivalent).
- Bug 1.7 unit suite (`match-arm-codegen-bundle-bug-1.6-1.7.test.js`) passes 10/10 on this base.

## Phase 1 — Reproduction

Wrote `tmp-engine-routing-test/test-engine-routing-contexts.scrml` with 4
expression-context engine writes (ternary RHS, lambda body, compound expression,
function-call arg). Pre-fix `bun run compiler/src/cli.js compile`:

```
function _scrml_viaTernary_3(cond) {
  return cond ? _scrml_reactive_set("state", "B") : 0;   // BARE — bypasses guard
}
function _scrml_viaCompound_5() {
  return 1 + _scrml_reactive_set("state", "B");          // BARE — bypasses guard
}
```

Confirmed all expression-context engine writes bypass the engine guard.
(Note: `function(x) { @state = .C }` form drops the callback entirely — separate
parser bug, NOT in scope for this dispatch; surfaced as a finding.)

## Phase 2 — Fix implementation (commit 4a2a7f3)

**Files touched:**
- `compiler/src/codegen/emit-expr.ts` — primary fix
  - Added `engineBindings?: Map<string, EngineBindingInfo> | null` to
    `EmitExprContext`.
  - Modified `emitAssign` to detect `@<name> = expr` where `name` is in
    `ctx.engineBindings`, dispatch through `emitEngineWriteGuard`, wrap in
    an IIFE so the assignment expression preserves value-semantics for
    surrounding compound contexts.
  - Value bound to `__scrml_engine_v` temp before guard so the with-hooks
    form (which embeds value-expression multiple times) evaluates exactly
    once. Bonus: defensive against side-effecting RHS.
  - `.Variant.history` restore-form RHS detection (mirrors
    `emit-logic.ts:detectHistoryForm` / `emit-control-flow.ts:
    detectHistoryFormFromString`) so the runtime arms the
    pending-history-restore flag (§51.0.Q.1) uniformly across all
    expression contexts.

- `compiler/src/codegen/emit-logic.ts` — threading
  - `_makeExprCtx` forwards `opts.engineBindings` into the EmitExprContext.

- `compiler/src/codegen/emit-control-flow.ts` — threading
  - `EngineRewriteCtx.exprCtxExtras` Pick extends to include `engineBindings`.
  - `emitMatchExpr` populates `engineBindings` in the constructed
    `exprCtxExtras` so nested expression contexts inside arm-result
    expressions / event-handler bodies / rewriteBlockBody also route
    correctly.

- `compiler/src/codegen/emit-event-wiring.ts` — threading
  - `engineRewriteCtx.exprCtxExtras` populates `engineBindings` for
    onclick/onsubmit/etc. handler bodies (so `(@state = .X)` inside
    event-handler nested expressions routes correctly too).

**Post-fix repro output (viaTernary):**
```
function _scrml_viaTernary_3(cond) {
  return cond ? (function(){
    const __scrml_engine_v = "B";
    // §51.0.F engine direct-write hook: state (State)
    _scrml_engine_direct_set("state", __scrml_engine_v, __scrml_engine_state_transitions);
    return __scrml_engine_v;
  })() : 0;
}
```

All 3 expression-context sites in the repro now route through
`_scrml_engine_direct_set`. (The `function(x) { ... }` form is still missing
the callback due to the separate parser bug — surfaced.)

## Phase 3 — Tests (this dispatch)

Added `compiler/tests/unit/emit-expr-engine-routing-option-a.test.js` —
9 tests in 1 describe block:
  - §A.1  ternary-RHS engine write
  - §A.2  arrow-lambda body engine write
  - §A.3  compound-expression engine write
  - §A.4  function-call-arg engine write
  - §A.5  nested ternary-inside-arrow engine write
  - §A.6  IIFE preserves value-semantics (return new value, value-expr
          evaluated exactly once via temp binding)
  - §A.NEG plain-cell write inside expression context still emits
          `_scrml_reactive_set` (negative case — Option A doesn't misfire)
  - §A.OPT self-write Option-d semantics fires uniformly in expression
          contexts (current === target → runtime helper short-circuits, no
          rule= violation)
  - §A.REGRESSION Bug 1.7 inline-arm match-arm routing still fires
          (Option A and Option B layers stay independent — the inline-arm
          path uses string-rewrite which never reaches emit-expr.ts)

**Suite delta:** 9147 → 9156 unit pass (+9 net, 0 regressions). Integration
1414 pass / 0 fail. Conformance 313 pass / 0 fail.

## Phase 4 — Bug 1.7 simplification analysis

Per brief: "Should ideally simplify Bug 1.7's match-arm-scoped layer (could
now delegate to emitAssign's general handling, removing the duplicated logic).
Out of scope for this dispatch unless trivially simplifiable."

**Verdict: NOT simplifiable.** Bug 1.7's helper `detectInlineEngineWrite` sits
at the string-rewrite layer. Inline-arm result emission goes through:
```
emitExprField(null, arm.result, _matchCtx)
  → exprNode is null
  → falls through to rewriteExprWithDerived(fallbackStr, ...)  // string pipeline
```
No ExprNode reaches `emit-expr.ts:emitAssign` for inline-arm results. Option A
operates at the ExprNode-emission level. The two layers handle disjoint paths
and both stay in place.

(For statement-level engine writes inside function bodies, those go through
`emit-logic.ts:_emitReactiveSet` which already had engineBindings dispatch
since C13. The Option A fix closes the GAP between statement-level dispatch
and expression-context dispatch.)

## Phase 5 — Surfaced findings

1. **`function(x) { body }` lambda form drops body during emission.** The
   repro fixture includes `[1,2,3].forEach(function(x) { @state = .C })`
   and the compiled output is `[1, 2, 3].forEach();` — the callback is
   dropped entirely. The arrow form `(x) => @state = .C` works (and now
   routes through Option A correctly). This is a separate parser /
   escape-hatch bug, NOT in scope for this dispatch. Confirmed
   reproducible at `tmp-engine-routing-test/test-engine-routing-contexts.scrml`
   pre-AND-post-fix. Surface for separate dispatch.

2. **Bug 1.7's Option B layer is NOT redundant with Option A.** Inline-arm
   results bypass emit-expr.ts (string-rewrite path). Both layers needed;
   neither subsumes the other.

3. **No spec change needed.** §51.0.F + §51.0.F.1 already authoritatively
   describe the engine-write contract + Option-d self-write semantics.
   Option A brings codegen into uniform conformance with that semantic
   across ALL expression contexts.

## Status: DONE
