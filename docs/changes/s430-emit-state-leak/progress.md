# progress — s430-emit-state-leak
- 2026-09-24T07:12:41-06:00 start, base f554e171
- 07:25 REPRODUCED. handler-recovery-into-cell: 1st compile emits `_scrml_cs_init_set("result", () => _scrml_risky_3())` inside go(); 2nd does not.
  Root: function bodies (emitFunctions) are emitted BEFORE emitReactiveWiring installs the file's structural-decl set, so they read the PREVIOUS file's set (null in a fresh process).
  Contributing: guarded-expr (`@x = f() !{}`) lowers its guardedNode via `emitLogicNode(guardedNode)` with NO opts (insideFunctionBody dropped); switch-case bodies same class.
  SPEC §6.8.1: "If `default=` is absent, `reset(@cell)` SHALL re-evaluate the init expression at reset time" — the init expression is the decl's. So the FRESH-process output (thunk registered from inside a function) is WRONG.
- 07:40 baseline corpus A/B (1922 files; one process sorted + reversed vs fresh process per file): 4 files differ, all clientJs:
  ctrl-switch-forbidden-fn-body-pos (same §6.8 class, switch case), ternary-markup-giti033 (emit-each _localIdCounter never reset on the lift path),
  parse-variant happy-unit / happy-payload (§6.8 class, guarded-expr). handler-recovery reproduces only after a predecessor whose set has `result`.
  New gate test compile-order-independence.test.js FAILS pre-fix (3 mismatches).
