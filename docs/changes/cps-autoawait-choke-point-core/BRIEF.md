# BRIEF — CPS auto-await choke-point CORE (unify the injectors, run over all client fn bodies)

**Thread-id:** `cps-autoawait-choke-point-core`
**Origin:** dpa-020 verdict (c) PARTITION, PA+user RATIFIED S320-peter (2026-08-04).
Artifact: `../scrml-support/docs/deep-dives/auto-await-choke-point-dpa-020-2026-08-04.md`.
**Lane:** codegen (Peter). Does NOT need bryan's §13.2 ruling (that gates #3 only).
**DONE-PROBE:** conformance cases pinning `g-given-block` + `g-hash87-member-read-await-misparen` + `g-ternary-init` (codes + runtime halves) all present and green; the 81-test invariant surface green; 0-emit-delta corpus sweep.

## What to build (CORE ONLY)
Unify the two AST await-injectors and run the result over **all client fn bodies**, replacing the string-regex fn-body path.

Today (verified S320, main `206359fe`):
- `injectPromiseAwait` (`scheduling.ts:377`) — string/regex, per-statement, **bare-prefixes** the whole RHS. Drives `scheduleStatements` (top-level) + `emitLogicBody` for if/else/for/while/do-while bodies (`emit-logic.ts:4595`). **Mis-parens member reads** (`await f().ok`) and mis-binds ternaries; and it **fences at `given`/`match`/`try` via `isControlFlowBoundary` (`:974`)** so nested calls get NO await.
- `injectServerCallAwaitsViaAst` (`scheduling.ts:510`) — acorn AST, **descends** into control-flow bodies, models JS scopes exactly, **bare-prefixes** at the call start. Wired ONLY to `on mount` (`liftEmittedStatementAwaits`, sole caller `emit-reactive-wiring.ts:537`).
- `parenthesizeAwaitServerCallsInExpr` (`scheduling.ts:613`) — acorn AST, **paren-correct** (`(await f()).ok`), expression-only. Wired to match-arm value (`emit-logic.ts:4382`).

The two AST injectors are ~95% identical walkers differing ONLY in injection shape (bare prefix vs `(await …)` wrap) and parse-wrapper. `(await f())` with no tail === `await f()`, so **paren-wrap is a strict superset of bare-prefix — zero regression on the no-tail case.**

**The CORE = one parser-modelled injector** = the descend-into-control-flow structure of `injectServerCallAwaitsViaAst` + the paren-correct injection of `parenthesizeAwaitServerCallsInExpr`, run over every client fn body. Closes at once:
- **descend** → `g-given-block`, the `g-cps-scheduler-opaque-boundary` root (server call nested in given/if/match/try/loop).
- **paren-correct** → `g-hash87-member-read-await-misparen`, `g-ternary-init`, and the plain-fn / nested-if baseline misparens.

## INVARIANTS that must not break (this is where the risk lives)
1. **The batch planner** (S138/S139/S212): `isDeclShapeStmt` / `collectReassignedNames` / TDZ / `Promise.all` grouping. Run the injector so it does NOT fight the planner — either AFTER grouping decides its groups, or preserve the identical batch/decl-shape invariants inside the pass. This is the ONE place the 81 tests red.
2. **`directReactive` ownership split**: the AST injector already deliberately SKIPS the direct `_scrml_reactive_set(cell, stub())` value (emit-client owns that lift — `emit-client.ts:3113`). PRESERVE that skip; do NOT double-await it.
3. **GH #264 scope modelling**: no `await` in a sync callback body or ANY formal-parameter list. The acorn walker already models this — keep it.
4. **Already-awaited guard** + member-call skip (route name binds a free identifier only).

## Scope discipline — OUT of this build (do NOT touch)
- `#1 g-markup-autoawait-*` (markup attr/each/match-renderer — needs the #391 async-IIFE move at 3 emit sites) — follow-on.
- `#2 g-reactive-write-member` (emit-client reactive IIFE member-RHS) — follow-on.
- `#3 g-match-value-position` — BLOCKED on bryan's §13.2 render-async ruling.
- `#4/#6` — the structural `g-block-body-value-position-mislowers` (NOT auto-await) — separate ticket.

## Gate (R26 empirical + S239)
- New conformance cases (codes + runtime halves) pinning `g-given-block`, `g-hash87` (member-read), `g-ternary-init`. Runtime half MUST execute and assert the RESOLVED value (a free var / undefined passes `node --check` — static check is worthless here).
- The 81-test invariant surface green (gh264=39, gh237=7, i87=2, match-arm=2, stdlib=9, bug-56/S139=5, crossmodule-value=11, crossmodule-markup=6).
- Fresh corpus sweep (`samples/`+`examples/`, ~948) → 0 emit-delta expected (buggy shape is corpus-absent).
- **STOP-IF-BIGGER:** if re-homing fn-body injection to the whole-body AST pass forces a change to the batch-planner ORDERING that breaks an invariant you cannot preserve, STOP and report the exact collision rather than forcing it — a half-fix on a silent-wrong-output path is worse than none.
