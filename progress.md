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

### DONE — Gap 3 (cross-module) + Gap 2 (browser transitive) [WIP commit]
Gap 3 (cross-module seed):
- emit-tool.ts collectAsyncFnNamesFromFile: +exportRegistry param + build calleeMap → Gap-1
  seed reaches the cross-module fixpoint (a cross-lib fn calling safeCallAsync recognized async).
- codegen/index.ts: threaded exportRegistry through computeToolAsyncImportedLocals →
  asyncImportedLocalsOf → asyncExportNamesOf; ADDED scrml: vendor branch to asyncImportedLocalsOf
  (a `scrml:host`/`scrml:auth` async primitive local binding seeds cross-module via
  isPromiseReturningStdlibFn). +import resolveModulePath/isPromiseReturningStdlibFn.
- emit-library.ts emitAsyncLibraryFns: threaded `_asyncImportedLocals` as the crossImportSeed.
- VERIFIED: repro-crossmodule main.js `orchestrate` now `export async function` + `await wrapAsync(obj)`.

Gap 2 (browser/client transitive) — CONFIRMED coloring-alone insufficient (needs peer-await too):
- emit-expr.ts: +clientAsyncFnNames field + a CLIENT-mode peer-await branch (mirrors the server
  serverFnNames branch; peerAwaitable fail-closed → syncPeerCalls).
- emit-logic.ts: +clientAsyncFnNames opt + _makeExprCtx passthrough.
- scheduling.ts: scheduleStatements +clientAsyncFnNames/syncPeerCalls params → emitOpts.
- emit-functions.ts: compute the TRANSITIVE client-async set (computeAsyncFnNames over client fns,
  seed = server-callee fns ∪ cross-import; Gap-1 stdlib seed inside), drive asyncPrefix off it,
  thread the LOCAL-restricted peer-await set (excludes imported names — else double-await a
  `safeCallAsync !{}`), drain the fail-closed sink → E-ASYNC-STDLIB-IN-SYNC-CALLBACK. Excludes
  user `async function` (hard error, not compiler-managed).
- VERIFIED: repro-browser-transitive leaf/middle/top all async; middle awaits leaf, top awaits
  middle; NO double-await.
- Test updates: §8 L3-tripwire flipped to RESOLVED (asserts outerCaller async + awaits peer);
  auto-await §4 preserved (user-async exclusion keeps classifier stdlib-only); p3-follow allowlist
  +index.ts(3)/+emit-tool.ts(1).

### VERIFICATION (all four repro shapes green)
- Unit 16203/0, integration 3071/0, conformance 642/642.
- Browser 587/12 — all 12 fails PRE-EXISTING (identical on origin/main 9c27ce9a; worktree
  gitignored-dist / known-gaps, NOT regressions; pre-commit gate excludes browser).

### DONE — comprehensive test file [WIP commit]
- compiler/tests/unit/colorless-async-seam-a.test.js — 7 tests: §1 direct library (both modes),
  §2 transitive library, §3 cross-module, §4 browser transitive, §5 ss1 mixed ?{}+safeCallAsync,
  §6 negative (pure fn not over-colored). All green.

### PRE-EXISTING LIMITATION SURFACED (not a regression; orthogonal to Seam-A coloring)
- A stdlib-async call inside a SYNC lambda callback in a const-decl init (e.g.
  `items.some(x => safeCallAsync(...))`) is emitted BARE + un-awaited WITHOUT firing
  E-ASYNC-STDLIB-IN-SYNC-CALLBACK, in BOTH the generateLibraryJs path AND the ss1
  emitLibraryFnMember path. Verified pre-existing: the ss1 path (which used emitLibraryFnMember
  before this dispatch) leaks the same shape. Root cause: emitLibraryFnMember's const-decl init
  emission doesn't route the lambda body through the structured emitCall that populates the
  classifier's syncCallSink (the drain I wired IS correct — it fires for the positions the sink
  captures; the sink just isn't populated through this lambda-in-init path). The awaitable-position
  coloring + await (the GITI-037 surface) is fully correct. DEFERRED: emitLibraryFnMember lambda-
  in-init sink population — a separate emit-completeness item.

### NEXT
- Final full-gate + conformance verification; report.

## 2026-07-16 — S239 adversarial-review fix round (6 correctness + 3 cleanups)

ROOT CAUSE: coloring was extended but await-emission + fail-closed drain were not, so
positions colored-async-but-neither-awaited-nor-diagnosed leaked. Restored the invariant
"a fn colored async ⟹ every async call is awaited OR fires E-ASYNC-STDLIB-IN-SYNC-CALLBACK"
via a SHARED structural detector (coloring + drain from the same traversal shape).

- SHARED helpers (emit-library-shared.ts): `collectNonAwaitableAsyncCalls` (structural —
  stdlib/peer async call inside a lambda / param-default / raw escape-hatch, robust vs the
  emit-populated sink), `collectAliasedAsyncCalls` (single-level `const g = middle; g()`),
  `asyncStdlibSyncCallbackError` + `aliasedAsyncCallError` (ONE wording — cleanup 7).
- Finding 1 (SECURITY, ss1 drain-after-emit): emit-server ss1 now runs the detector on each
  value-export fn (the `_syncStdlibAsyncCalls` drain runs BEFORE ss1 emit). `_diagAsyncStdlibSyncCb`
  delegates to the shared builder (cleanup 7). VERIFIED: `hs.some(h => verifyPassword(pw,h))` fails closed.
- Finding 1b/3: generateLibraryJs (emitAsyncLibraryFns) + client (emit-functions) run the
  detector too. Raw-body callback (`x => { … safeCallAsync … }`) fails closed.
- Finding 2: emit-expr `emitReceiver` now paren-wraps the CLIENT awaited-peer form
  (`(await middle(cfg)).count`) via `isAwaitedClientAsyncCall`.
- Finding 4: emit-expr stdlib auto-await extended to CLIENT mode, GATED on a new
  `clientAsyncBody` flag (set only in an async client fn body — NOT a markup `${ for }` loop,
  else a fail-closed-async SYNC helper like `sortBy` would be awaited in a non-async context —
  the Bug-18 regression I caught + fixed). Idempotency guard in emit-logic guarded-expr prevents
  `await await`. bare `const r = safeCallAsync(...)` in a client fn now awaited.
- Finding 5: a nameless top-level fn-decl is NOT cleanly producible (E-CODEGEN-INVALID-LOGIC);
  defensively colored async so a body `await` never lands in a sync `function`.
- Finding 6: `const g = middle; g()` fails closed (bounded single-level alias; full alias
  resolution is a follow-on).
- Cleanup 8: `.ast.imports` hoist folded into buildCalleeImportMap (4 call sites simplified;
  pre-existing auth-sensitive :1135 left untouched).
- Cleanup 9: the client server-direct seed derives from computeAsyncFnNames's SINGLE structural
  walk (new `serverFnNames` seed param) — removed the second non-transitive hasServerCallees scan.

VERIFICATION: 6 finding repros (finding1/2/3/4/6 + Bug-18-style markup guard) + the 4 original
shapes all green. Unit 16210/0, integration 3071/0, conformance 642/642, browser 587/12 (same 12
pre-existing). Comprehensive test file expanded to 13 tests.

## (superseded) prior next (pending PA ruling)
- Re-scoped brief specifying: which emit path owns colorless-async for the library shape, and
  whether to (1) route async library fns through emitLibraryFnMember with the auto-await
  classifier threaded, or (2) extend generateLibraryJs's text-splice, or (3) unify both on a
  single structural pass. Plus where the no-silent-leak fail-closed diagnostic fires for the
  transitive-library case that a text-splice can't color.
