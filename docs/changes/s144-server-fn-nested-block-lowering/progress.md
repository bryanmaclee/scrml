# Progress: s144-server-fn-nested-block-lowering (GITI-020 + GITI-021 + GITI-022)

Startup pwd: /home/bryan/scrmlMaster/scrmlTS/.claude/worktrees/agent-a4387fba3d9660d73
Base HEAD: 505f4ace3c28fd07edbd79951eeed7df5d3c42b5 (v0.7.0)

## Pre-fix baseline (R26 confirmed on HEAD)
- GITI-020: nested `@msg = "conditional"` -> `_scrml_reactive_set("msg",...)` + `_scrml_init_set(...)` (undefined in .server.js). Top-level tail correctly `broadcast({__type:"__sync",...})`.
- GITI-021: nested `label = "chosen"` -> `const label = "chosen";` (shadows outer `let label`); pick(true) returns "default".
- GITI-022: `let x` + `x = 1` -> `let x; const x = 1;` -> E-CODEGEN-INVALID-JS ("Identifier 'x' already declared").

Shared root: server-function body emission does not thread per-function context (channelOwnedCells/boundary + declaredNames) into nested if/for/while emitters.

## Root-cause (PA-confirmed via source read)
Two layers:

### Layer A — control-flow opts threading (fixes GITI-020)
emit-logic.ts `emitLogicNode` dispatch of if/for forwards declaredNames+insideFunctionBody
but NOT boundary/channelOwnedCells:
- line 2338 emitIfStmt(...)  -> add boundary + channelOwnedCells
- line 2348 emitForStmt(...) -> add boundary + channelOwnedCells
- line 2358 emitWhileStmt / 2363 emitDoWhileStmt already thread boundary -> add channelOwnedCells
emit-control-flow.ts `IfOpts` lacks boundary/channelOwnedCells; emitIfStmt bodyOpts does not
include them. emitForStmt/emitWhileStmt/emitDoWhileStmt opts type + bodyOpts likewise.
emitLogicBody preserves `{...opts}` so once bodyOpts carries them they propagate to nested
emitLogicNode -> broadcast lowering arm (emit-logic 1438-1463) fires for nested @cell=.

### Layer B — per-function declaredNames in server-fn body (fixes GITI-021 + GITI-022)
emit-server.ts emits each server-fn body statement with FRESH opts per statement (CSRF path,
non-CSRF path, SSE path). No shared declaredNames Set and no insideFunctionBody:true. So
`let label` adds to a (missing) set, and the nested `label="chosen"` tilde-decl never sees
`label` in declaredNames (emit-logic 1619) -> const-decl -> `const label`. Same for `let x; x=1`
-> `let x; const x=1` (gate E-CODEGEN-INVALID-JS).
Fix: build one per-function opts object (shared declaredNames seeded with paramNames +
insideFunctionBody:true + boundary:server + channelOwnedCells) reused across all emitLogicNode
calls in that function's body loop. Mirrors S34 client fix.

## Plan order (upstream-first within CG)
1. emit-control-flow.ts: IfOpts + for/while opts get boundary+channelOwnedCells; thread to bodyOpts.
2. emit-logic.ts dispatch (2338/2348/2358/2363): forward boundary+channelOwnedCells.
3. emit-server.ts: per-fn shared opts on CSRF + non-CSRF + SSE body loops.
4. Tests + R26 recompile of all three reproducers.

## Implementation complete
- Fix commit f1ea4885 (Layer A + Layer B). Full gate 15199 pass / 0 fail (== baseline).
- R26 post-fix recompiles confirmed all three symptoms gone (see final report).
- Unit tests: compiler/tests/unit/s144-server-fn-nested-block-lowering.test.js — 14 tests,
  5 describe sections (GITI-020 nested broadcast; GITI-021 plain reassign + exec->"chosen";
  GITI-022 gate-clean let x/x=1; §4 client no-regression; §5 guardrails += / .push / V5 first-assign).
