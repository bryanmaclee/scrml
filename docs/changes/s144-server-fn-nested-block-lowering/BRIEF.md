# BRIEF — S144 Cluster A+B (GITI-020 + GITI-021 + GITI-022)
agent: a4387fba3d9660d73 · scrml-dev-pipeline · isolation:worktree · model:opus · dispatched S144 2026-05-30 on HEAD 505f4ace (v0.7.0)
discipline block: standard S126 Bash-edit + no-cd-into-main / S99 path (ctr 20) / S88 isolation / S83 commit two-sided / S90 CWD gate / R26 empirical-verify — verbatim per pa.md.

ROOT THEME: server-function body emission loses per-function context when recursing into nested blocks.

GITI-020 (HIGH): channel-cell `@cell=expr` nested in if/for in a `<channel>` server fn lowers to `_scrml_reactive_set` (undefined in .server.js → ReferenceError) instead of `broadcast({__type:"__sync",__key,__val})`. Top-level writes correct. LEAD: broadcast lowering emit-logic.ts ~1438-1463 gated on `opts.boundary==="server" && opts.channelOwnedCells?.size>0 && exprNode.kind==="assign"`; nested-block emitters (emit-control-flow.ts emitIfStmt/For/While) don't thread channelOwnedCells/boundary. Repro: program>channel>server fn setMsg(bad){ if(bad){@msg="conditional"} @msg="tail" }. R26: nested write must emit broadcast(__sync).

GITI-021 (HIGH): server-fn bare reassignment `id=expr` emits `const id=expr` even when id already bound → nested shadow (write dropped, returns default) / same-scope redeclare. Client path fixed S34 (Bug B+F 70190a7 threaded declaredNames through emitIfStmt/For/While); server-fn body path never got it. Repro: server fn pick(flag){ let label="default"; if(flag){label="chosen"} return label } → pick(true) returns "default" (BUG). R26: plain `label="chosen"`, pick(true)→"chosen".

GITI-022 (MED, gate-caught): server-fn `let x` + `x=1` → `let x; const x=1` → E-CODEGEN-INVALID-JS. Same root as 021. R26: valid emit `let x; x=1`, f()→1.

SCOPE-FENCE: emit-logic.ts, emit-server.ts, emit-functions.ts, emit-control-flow.ts + tests. NOT emit-match/emit-expr/block-splitter/emit-client (sibling dispatches). Don't regress client path. Keep bare-id-declares-first V5 model.
ACCEPTANCE: unit tests for all 3 shapes + behavioral pick(true)→"chosen"; pre-commit gate.
