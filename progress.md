# progress — colorless-async Seam-A (Phase 1, GITI-037)

Branch: feat/colorless-async-seam-a  base: origin/main 9c27ce9a
Worktree: /home/bryan-maclee/scrmlMaster/scrml-phase1-async

## 2026-07-15T (session start)
- Startup verified: worktree path, branch, clean, HEAD 9c27ce9a. `bun install` OK.
- Read authority DD (interprocedural-cps-colorless-async-2026-07-15.md), primary.map.md,
  and all brief-anchored source: emit-library-shared.ts (computeAsyncFnNames),
  scheduling.ts (hasServerCallees), collect.ts (bodyContains), codegen/index.ts
  (asyncExportNamesOf / asyncImportedLocalsOf), module-resolver.js
  (isPromiseReturningStdlibFn), emit-functions.ts:1174, emit-server.ts:583/665,
  emit-library.ts (generateLibraryJs).

## EMPIRICAL PATH-MAP (compiled repros against 9c27ce9a) — the load-bearing finding

The brief asserts "the emit already works — this is an INFERENCE unification; close 3 gaps
on the computeAsyncFnNames nucleus." Empirically FALSE for the primary GITI-037 repro.

| Source shape                         | Emit path                                   | Direct safeCallAsync | Transitive |
|--------------------------------------|---------------------------------------------|----------------------|------------|
| `<program>` browser client fn        | emit-functions.ts (hasServerCallees + sched)| WORKS (async+await)  | Gap 2 BROKEN |
| library `${}` pure-client (THE REPRO)| generateLibraryJs (emit-library.ts)         | BROKEN               | BROKEN     |
| library `${}` + `?{}` (ss1)          | emit-server ss1 → emitLibraryFnMember       | Gap 1 BROKEN         | (untested) |
| cross-module `.scrml` import         | asyncExportNamesOf                          | Gap 3 (scrml: vendor)| —          |

Evidence:
- repro-giti037.scrml (`--mode library` AND default) → generateLibraryJs → `export function
  callHost` (NOT async) + `let _x = safeCallAsync(...)` (NOT awaited). The `!{}` guarded-expr
  IS lowered but WITHOUT the auto-await classifier.
- probe-ss1-mixed.scrml (`?{}` loadRows + safeCallAsync callHost) → .server.js: `loadRows`
  correctly `async` + `await _scrml_sql` (the `?{}` seed works), but `callHost` emitted
  `export function callHost` + un-awaited `safeCallAsync` → Gap 1 confirmed in the ss1 path.
- Existing test auto-await-promise-stdlib.test.js §1 PROVES the browser client DIRECT case
  already emits `async function _scrml_fetchData_` + `await safeCallAsync` (emit-functions +
  scheduleStatements thread BOTH the coloring via hasServerCallees AND the auto-await
  classifier via asyncCalleeMap/asyncExportRegistry).

## ROOT CAUSE (deeper than "3 inference gaps")

Async-COLORING (prefix) and await-EMISSION (call site) are SEPARATELY threaded, per emit path:
- emit-functions.ts/scheduleStatements: threads BOTH (coloring=hasServerCallees stdlib branch;
  await=asyncCalleeMap/asyncExportRegistry). → browser DIRECT works.
- emitLibraryFnMember (emit-library-shared.ts:149-151): bodyOpts threads ONLY `serverFnNames`,
  NOT asyncCalleeMap/asyncExportRegistry. → even if computeAsyncFnNames colors a fn async
  (Gap-1 seed), the safeCallAsync await is NOT emitted. Coloring alone is insufficient here.
- generateLibraryJs (emit-library.ts:266-269): guarded-expr lowering threads NEITHER the
  classifier NOR a computed async set. → library DIRECT fully broken.
- generateLibraryJs is a whole-block TEXT-SPLICE emitter: plain `const ok = leaf(obj)` peer
  calls survive verbatim (not routed through emit-logic), so transitive peer-await has no
  injection point structurally → cannot be closed without structural (emitLibraryFnMember)
  emission or a new splice.

So the GITI-037 repro lives in generateLibraryJs, which the brief's 3 gaps DO NOT touch.
Closing Gaps 1/2/3 as scoped would NOT make the repro emit async+await. The real fix must
also (a) thread the auto-await classifier into emitLibraryFnMember bodyOpts + generateLibraryJs
guarded-expr lowering, and (b) resolve how the text-splice library path does transitive
peer-await (route async library fns through the structural emitter, or add a splice) — an
emit-architecture decision, not a seed extension.

## DECISION: STOP + SURFACE (per brief "STOP and surface to PA" on out-of-scope design Q)
The brief's foundational premise is empirically wrong and the correct fix is materially larger
+ touches the universal library emit path (regression-sensitive). Surfacing a re-scope with the
full path-map + recommendation rather than unilaterally executing a 3x-larger multi-path refactor
on a wrong premise (pa.md Rule 3/4; memory: cookbook-vs-empirical, don't-soft-classify,
R26-empirical-verify, don't-preclassify-surgical). No source changes made. Repros + this
progress.md committed as the recovery anchor.

## 2026-07-16 — bryan ruled Option A. Executing full Seam-A unification.

### DONE — Gap 1 (seed) + ss1 wiring [WIP commit]
- emit-library-shared.ts computeAsyncFnNames: added optional `calleeMap`+`exportRegistry`
  params; a fn whose body STRUCTURALLY calls a Promise-returning stdlib/vendor primitive
  (isPromiseReturningStdlibFn) now seeds async. Opt-in (byte-identical when absent).
- emit-server.ts emitModuleValueExportLines: threaded `exportRegistry` param + build
  calleeMap (buildCalleeImportMap w/ .ast.imports hoist); pass both to computeAsyncFnNames.
  Threaded `_asyncExportRegistry` from the generateServerJs ss1 call site (:3722).
- VERIFIED: probe-ss1-mixed .server.js now emits `export async function callHost` +
  `const r = await safeCallAsync(...)`. The await comes from the module-level
  _serverAsyncClassifier already installed by generateServerJs (:1119) — coloring async
  routes callHost to the server boundary where emit-expr auto-awaits the stdlib call.
- Targeted tests green: auto-await-promise-stdlib, safe-call-async, stdlib-auth,
  emit-library, compiler-managed-async, issue-26-finding2, serve-target-tool, async-reject.
- NOTE: probe-ss1-mixed still has pre-existing library-mode `<db>` errors (E-MU-001 on
  src/tables, E-CODEGEN-INVALID-LOGIC) — orthogonal to async; a bare `${}` `?{}` library
  has these on unmodified code. The async EMIT is correct regardless.

### DONE — generateLibraryJs structured async emit (PRIMARY repro fix) [WIP commit]
- emit-library.ts: new emitAsyncLibraryFns — computes async set (computeAsyncFnNames +
  Gap-1 seed), routes each NON-SQL async fn through emitLibraryFnMember (structured,
  colors async + awaits stdlib call + transitive peers), prunes their spans from the
  verbatim block (merged into pruneServerFnsAndLowerGuarded's removals), appends the
  structured JS. Installs setServerAsyncClassifier (+ syncCallSink) around emission;
  drains the sink → fatal E-ASYNC-STDLIB-IN-SYNC-CALLBACK (no-silent-leak, axis-i).
- codegen/index.ts: threaded exportRegistryInput into the library libCtx.
- p3-follow allowlist: +emit-library.ts budget 1 (LibExportRegistry type alias).
- VERIFIED emit:
  - repro-giti037 (library): `export async function callHost` + `await safeCallAsync(...)`.
  - repro-transitive (library): leaf/middle/top ALL async; middle awaits leaf, top awaits
    middle (transitive coloring + peer-await via serverFnNames=asyncFnNames). CLEAN.
  - repro-crossmodule: helper.js wrapAsync async+awaited; main.js orchestrate NOT yet
    colored → Gap-3 cross-module seed still needed (next).
- Full unit suite 16203 pass / 0 fail; integration 3071 pass / 0 fail.

### NEXT
- Gap 3 (cross-module): thread exportRegistry into asyncExportNamesOf/collectAsyncFnNamesFromFile
  (so a cross-lib fn calling safeCallAsync is recognized async) + include scrml: vendor async
  exports in asyncImportedLocalsOf + thread `_asyncImportedLocals` seed into emitAsyncLibraryFns.
- Gap 2 (emit-functions browser transitive) + emit-tool wiring + comprehensive test file.

## (superseded) prior next (pending PA ruling)
- Re-scoped brief specifying: which emit path owns colorless-async for the library shape, and
  whether to (1) route async library fns through emitLibraryFnMember with the auto-await
  classifier threaded, or (2) extend generateLibraryJs's text-splice, or (3) unify both on a
  single structural pass. Plus where the no-silent-leak fail-closed diagnostic fires for the
  transitive-library case that a text-splice can't color.
