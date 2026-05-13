# Bug 1.6 + Bug 1.7 BUNDLE — match-arm payload-binding (inline-arm) + direct-write engine-guard routing

## Status: IN PROGRESS

## Worktree: `worktree-agent-a8b213b33039b5199`

## Phase 0 — Setup + diagnosis (2026-05-12)

- Verified worktree clean, bun install + pretest green.
- Read maps (primary, structure) + BRIEFING-ANTI-PATTERNS + design-insights Insight 30 + SPEC §51.0.F + §51.0.F.1 + PA-PRIMER §13.7 B14/B20.
- Cherry-picked `d8ea41c` (Bug 1 fix-A — block-arm payload binding + opts threading + EnumType::Variant + derived_get tracks) — required prior on this worktree base.
- Cherry-picked `a72ccd2` (Bug 6.5 regression-guards).

## Phase 1 — Reproduction + diagnosis

Re-compiled `examples/14-mario-state-machine.scrml` post-cherry-pick and verified Bug 1 fix-A correctly fires for **block-arm** form:
```
.Mushroom(n) => { @coins = ... ; @marioState = ... }
```
- Line 52: `const n = _scrml_match_19.data.coins;` ← payload binding works
- Line 53: `_scrml_engine_direct_set("marioState", ..., __scrml_engine_marioState_transitions);` ← engine-routing works
- Lines 56/58/63: same for Flower/Feather

So Bug 1 fix-A + fix-C closed the **block-arm** half of both Bug 1.6 and Bug 1.7. Brief was correct.

Wrote synthetic inline-arm fixtures at `tmp-inline-test/` to surface the **inline-arm** half:

**inline-direct-write.scrml** confirmed:
- Bug 1.6 inline-arm payload binding: WORKS (line 29-30 of compiled output emits `const n = _scrml_match_5.data.coins;` for `.Mushroom(n) => @coins = @coins + n`).
- Bug 1.7 inline-arm engine-write routing: BROKEN (line 39-41 emits `_scrml_reactive_set("marioState", "Big")` instead of `_scrml_engine_direct_set("marioState", "Big", __scrml_engine_marioState_transitions)`).

**Diagnosis:** The inline-arm path in `emit-control-flow.ts:emitMatchExpr` flows arm.result through `emitExprField` → `emit-expr.ts:emitExpr` → `emitAssign` (line 471-494). `emitAssign` directly emits `_scrml_reactive_set` with no consultation of any engine-routing context. The block-arm path goes through `emitLogicBody(arm.structuredBody, opts)` → `emit-logic.ts:_emitReactiveSet` which DOES consult `opts.engineBindings`.

**Fix shape (Option A — minimal surgical):** Add `engineBindings` field to `EmitExprContext` (mirrors how `engineVarNames` was added for `.advance()` interception at C13). In `emit-expr.ts:emitAssign`, when LHS is `@<name>` and `name in ctx.engineBindings`, dispatch to `emit-engine.ts:emitEngineWriteGuard` (returns multi-line text). This brings inline-arm body into structural parity with block-arm body for engine-write routing.

**Bug 1.6 outcome:** Bug 1.6 INLINE-arm is actually ALREADY FIXED in current state. The brief's premise that inline-arm payload-binding fails was INCORRECT — `matchArmInlineToMatchArm` DOES carry the binding through (line 902 sets `binding: variantMatch[2]?.trim() ?? binding ?? null`), and `emitVariantBindingPrelude` wraps the result correctly. Verified empirically.

