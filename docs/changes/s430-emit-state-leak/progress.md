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
- 472cd485 per-file emit-logic state installed before first reader (runCG loop + generateClientJs), cleared in finally; emit-each counter per file;
  resetCodegenModuleState() at runCG head; gate test. Hook green (30585 pass).
- 8e7031f8 runTS restarts reparse cursor + formFor/tableFor synth counters; api.js compileScrml wrapper resets native markup-value counter + project-root memo, restores BPP overrides.
- ec91af85 guarded-expr lowers its statement with the statement's opts (minus `~`). Found because the per-file install made IMPLICIT cells lose their
  top-level thunk when a function body wrote them first. switch-case opts drop left alone: `switch` is E-SWITCH-FORBIDDEN (error-path artifact only).

## Module-state audit (compiler/src/** + compiler/native-parser/** as run by api.js; self-host/, commands/, runtime-template excluded)
Verdicts: RESET-OK = reset at a per-compile/per-file head before any reader · FIXED = changed here · SAFE = cannot vary output by history (reason).

codegen
- emit-logic `_structuralDeclNamesForFile`, `_implicitInitEmittedForFile` — FIXED (beginEmitLogicFile at runCG per-file loop head + generateClientJs; endEmitLogicFile in runCG finally + resetCodegenModuleState)
- emit-logic `_boundaryWarnedFor` — SAFE (gates a SCRML_DEBUG console.warn only)
- emit-each `_localIdCounter` — FIXED (reset per file + runCG head; lift path allocated without reset)
- emit-each `_eachReconcileCtxStack`, `_eachBindSupportCtx`, `_eachMarkupFnNames`, `_eachRequestIds`, `_eachLiftRegistry` — scoped by push/pop / try-finally; FIXED for the stranded-by-exception path (resetEachModuleState at runCG head)
- emit-lift `_scrml_lift_reconcile_ctx_stack`, `_scrml_lift_scope_names_stack`, `_scrml_lift_non_keyed_depth`, `_scrml_lift_request_ids_stack` — push/pop balanced; FIXED stranded path (resetLiftModuleState at runCG head)
- emit-control-flow `_hoistMap`, `_batchInListCap` — RESET-OK (set per compile, cleared at runCG tail); also in resetCodegenModuleState
- emit-control-flow `_variantFields`, `_variantFieldCollisions` — set/cleared by generateClientJs (not in finally); now also reset at runCG head
- rewrite.ts `_rewriterVariantFields/_Collisions`, `_rewriterProtectState`, `_rewriterBoolColumns`, `_rewriterTenantState` — set/cleared per generateServerJs / generateClientJs (not in finally); now also reset at runCG head
- rewrite.ts `_currentUserAmbientActive`, expression-parser `_currentUserAmbientActive` — set per file in runCG loop; reset at runCG head
- emit-expr `_logProductionStrip` — RESET-OK (runCG head); `_tildeUnresolvedErrors` — RESET-OK (runCG head, drained in finally)
- emit-expr `_logShadowedInFile`, `_renderShadowedInFile`, `_printShadowedNames`, `_sessionShadowedInFile`, `_sessionProjectionActive`, `_currentUserAmbientActive` — RESET-OK (set per file at loop head); also reset at runCG head
- emit-expr `_sessionValueUseErrors` — reset at generateServerJs head, drained at its tail; server-mode-only pushes; also reset at runCG head
- emit-expr `_currentFileRequestIds` — set/cleared by generateClientJs; `_serverAsyncClassifier` — set per generateServerJs, NEVER cleared (server-mode reads only); both now reset at runCG head
- emit-machines `_machineCodegenErrors` — RESET-OK (clearMachineCodegenErrors at runCG head; drained at tail). `_noElide` — SAFE (env/test debug knob, not input-derived)
- chunk-namespace `_state` — RESET-OK (set per file, reset in finally); now also runCG head. `_projectRootCache` — FIXED (fs memo; cleared per compile — stale across fs change in dev/serve)
- var-counter `_varCounter` — RESET-OK (runCG head; compile-scoped by design, unique across files of one compile)
- log-loc `_sourceByFile`, `_indexByFile` — RESET-OK (resetLogLoc at runCG head)
- srcmap-provenance `provenanceEnabled` — RESET-OK (set unconditionally at runCG head)
- declared-name-marks `OWN_CONSTS`, `SEEDED_CONSTS` (WeakMaps keyed by per-emit Sets) — SAFE; `_seededConstFallbacks` — SAFE (monotonic, read only as a before/after delta)
- emit-form-for / emit-table-for `_synthIdCounter` — FIXED (process-monotonic; reset at runTS head, where they are allocated)
- emit-match `_derivedNamesCache` (WeakMap on AST) — SAFE
- route-splitter `cachedCompilerIdentity` — SAFE (process-constant compiler identity)
- compat/parser-workarounds `_overrides` (setBPPOverrides) — FIXED (api.js restores the prior value after a compile that installed selfHostModules.bpp; external test seam kept)
other passes
- type-system `_reparseIdCursor` — FIXED (runTS head); `_letReparseHandles` — SAFE (lazy module handles); `_callableServerNamesCache` (WeakMap on AST) — SAFE
- native-parser translate-expr `_markupValueExprIdCounter` — FIXED (reset per compile in api.js); `_translateMarkupValueToLiveNodeCached`, translate-stmt `_mapBlocksToNodesCached`, parse-expr `_parseMarkupTraceCached` — SAFE (lazy function handles)
- dependency-graph `_nodeCounter` — RESET-OK (runDG head); route-inference `_routeCounter` — RESET-OK (runRI head)
- component-expander `_currentFileEngineMountNames` — RESET-OK (runCEFile head)
- ast-builder `_engineBodyBuildDepth` — SAFE (try/finally); tokenizer override `let`s — restored at buildAST tail (not finally; only when overrides passed)
- expression-parser `TEMPLATE_INTERP_CACHE`, symbol-table `DERIVED_CELL_REGISTRY` (WeakMaps on AST/scope) — SAFE
- html-elements `REGISTRY`, attribute-registry `ELEMENT_ATTR_REGISTRY`, tailwind-classes `registry` — SAFE (populated at module load only)
