# Native-engine → codegen substrate bridge — ROOT-CAUSE SURVEY findings

**Date:** S163, 2026-06-04. **HEAD:** `e6782917`. **Agent:** general-purpose (read-only, opus, agentId `a2df11643eac6b20e`). **Method:** AST object-identity trace + post-SYM annotation dump + native-vs-default byte-compare on `engine-modern-001-basic` + mario.

## Root cause — two-instance object-identity defect (NOT F1's display-text mechanism)

The native parser synthesizes **two separate `engine-decl` objects**:
- the `FileAST.nodes` copy — `compiler/native-parser/parse-file.js:584 synthEngineNode` (via `synthEngineDecl`, from `mapOneBlock` ~L276)
- the `FileAST.machineDecls` copy — `compiler/native-parser/collect-hoisted.js:132` calls `synthEngineDecl(block, stampId, source)` AGAIN on the same source block → a distinct object with a distinct id.

SYM (`walkRegisterEngines` PASS 10/B14 + `walkValidateEngineStateChildrenAndRules` PASS 11/B15) stamps `_record`/`engineMeta` onto the **`nodes`** copy only. Codegen's `collectC12EngineDecls` (`emit-engine.ts:285`, + twin `collectC14DerivedEngineDecls` L3009) reads **`machineDecls`-first** (L291-298) → the un-stamped copy → `isC12EngineDecl` (`emit-engine.ts:265-274`, gates on `node._record?.engineMeta`) returns false → the engine falls out of codegen scope → the entire §51.0 substrate is dropped → plain `_scrml_reactive_set` fallback.

**Live shares ONE instance:** `compiler/src/ast-builder.js:13616 machineDecls.push(node)` pushes the SAME object already in `nodes`. One object, two array memberships → SYM's stamp is visible to codegen.

## Empirical proof (engine-modern-001-basic)

| Stage | LIVE | NATIVE |
|---|---|---|
| engine-decl in `nodes`, shape-complete (14 fields) | YES id=27 | YES id=20 |
| engine-decl in `machineDecls` | YES id=27 | YES id=43 |
| `nodes` === `machineDecls` (same object) | **TRUE** | **FALSE** |
| SYM stamps `_record` on `nodes` copy | YES, engineMeta.stateChildren=3 | YES, stateChildren=3 (native-walker bridge WORKS) |
| SYM stamps `_record` on `machineDecls` copy | YES (same object) | **NO — `_record` absent, engineMeta undefined** |
| `collectC12EngineDecls` (machineDecls-first) → `isC12EngineDecl` | passes | **fails (`!meta`) → engine out of scope** |
| Emitted substrate | full | **dropped → `_scrml_reactive_set` fallback** |

mario reproduces identically (7 → 0 `_scrml_engine_` refs). Fix simulated (point machineDecls[i] at the nodes instance pre-SYM) → `isC12EngineDecl` true, engineMeta.stateChildren=3 on machineDecls copy.

**Why `<match>` is fine:** `collectMatchBlocks` (emit-match.ts:157) walks `nodes`-only (no machineDecls collection). Engine is the ONLY structural node with a machineDecls-first codegen lookup → uniquely exposed.

**This is SEPARATE from F1's `E-UNQUOTED-DISPLAY-TEXT` arm-body-drop.** The engine compiles fully clean, the engine-decl is correctly shaped, SYM attaches engineMeta — the loss is purely the codegen lookup hitting the wrong instance. The brief's framing of this AS F1 is corrected: they share the symptom, not the mechanism.

## Fix decomposition — size S, one cohesive change

Make native put the SAME engine-decl instance in both `nodes` and `machineDecls` (mirror live `ast-builder.js:13616 machineDecls.push(node)`). Recommended shape **(i)**: have `parse-file.js` collect `machineDecls` from the already-mapped `nodes` instances; delete the duplicate `synthEngineDecl` call in `collect-hoisted.js:132`. ~20-40 lines.
- Touch: `parse-file.js` (assembly seam ~L166-185 + the engine branch in `mapOneBlock`), `collect-hoisted.js` (neuter/remove the L132 synthEngineDecl push OR return the shared node). The parse-file.js comment L575-583 (which wrongly claims two-instance "matches the live pipeline") gets corrected — it already names this fix.
- **Single chokepoint:** every consumer (`buildEngineBindingsMap` L2508 = the `_scrml_engine_direct_set` hook; `collectEngineVarNames` L2695 = §51.0.C var-init; transition-table emit; mount/body-render; `collectEnginesWith{Hooks,OnTimeout,IdleWatchdog,InternalRules,History,MessageArms}`) routes through `collectC12EngineDecls`. Fix identity once → all recover.
- **NOT the S162 each/match-promotion pattern** (that added a new node kind). This is instance-sharing / hoist-collection, structurally like ast-builder's `machineDecls.push(node)`.
- **Risk:** nodes/machineDecls engine ids become equal (live invariant; currently 20 vs 43). The parse-file.js structural canary "counts nodes, never compares ids" — should be safe; verify after.

## Scope of the FULL native-engine parity story (S primary + small follow-ups)

- **B2 (§51.0.S message-arm) — SEPARATE, not subsumed.** `collect-hoisted.js synthEngineDecl` has zero `accepts=` handling (acceptsType undefined vs live null); `native-walker/engine-statechild-walker.ts:516` hard-codes `messageArms: []`. Separate dispatch.
- **`effect=` opener (§51.0.H Form 3 openerEffect)** — native synthEngineDecl has no openerEffect read. Separate small gap.
- **onTimeout / onTransition / onIdle / history / internal:rule / nested / derived** — native-walker code EXISTS; likely recovered by the primary fix BUT each needs its own positive flip-test (only basic state-children + transition path empirically verified). Nested-engine recursion + derived-engine subscribe are highest-risk.

## Honest scope
Core silent-miscompile (basic + transition-validated engines) = single S fix at one chokepoint, empirically verified. Complete native-engine parity = M-to-L multi-feature but decomposes cleanly: S primary fix lands the substrate → verification sweep + B2 + effect= as separate small dispatches.

## Map-quality note
The maps frame this as F1 arm-body-parse (E-UNQUOTED-DISPLAY-TEXT) — inaccurate for THIS bug. The true cause (machineDecls two-instance identity) is recorded nowhere in the maps. Update at next map refresh.
