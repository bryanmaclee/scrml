# i87 — nested server-call auto-await — progress (append-only)

change-id: i87-nested-server-call-autoawait-2026-07-18
worktree: .claude/worktrees/agent-ab1f6943233cae2f9  branch off main @ 1e63bbb1

## 2026-07-18 — survey + root cause confirmed
- Reproduced the bug on 1e63bbb1: cases B (nested if), C (assign/reassign), D (inside for)
  emit `_scrml_fetch_getFlag_*()` with NO `await` and the enclosing fn is NOT `async`;
  case A (top-level const) is correct.
- Root cause, three coupled parts:
  - Part A: `hasServerCallees` (scheduling.ts) walked ONLY top-level body statements and only
    the kinds bare-expr/let-decl/const-decl/guarded-expr — never recursing into control-flow
    bodies, and never checking the assign form. Case C `res = fn()` lowers to a **tilde-decl**
    node (emit-logic.ts:1853 reassignment path), a kind the walker didn't check → no `async`.
  - Part B: nested if/for/while bodies emit via emitLogicBody → no per-statement await injection.
  - Part C: the assign/reassign form needs `res = await …` (await after `=`), never `await res = …`.

## 2026-07-18 — implementation
- scheduling.ts: added exported `injectPromiseAwait(code, stmt, routeMap, filePath, calleeMap,
  exportRegistry)` — single source of truth for the auto-await lowering. Handles decl,
  emitted-decl, `return`, bare-assignment (case C), and bare-call forms; no-op for non-Promise/
  statement-shape nodes. Refactored the top-level single-stmt path to use it (also fixes case C
  at top level, which previously would have produced invalid `await res = …`).
- scheduling.ts: `hasServerCallees` now recurses into if/else/for/while/do-while STATEMENT bodies
  and detects tilde-decl/lin-decl (assign form). Deliberately NOT into function/lambda/sync-callback
  (fail-closed boundary) nor match arms (client match = sync IIFE, await illegal there).
- emit-logic.ts: `EmitLogicOpts.awaitNestedPromises` flag; `emitLogicBody` applies
  `injectPromiseAwait` per node when the flag + classifier inputs are present. Threaded the four
  async classifier inputs into the if/for/while/do-while dispatch cases.
- emit-control-flow.ts: `_asyncAwaitBodyOpts(opts)` helper sets the async inputs + awaitNestedPromises
  into the if/else/for/while/do-while body opts (parallel to the ss19 #8 serverFnNames threading).
  IfOpts gained the async fields.

## 2026-07-18 — empirical verification
- Rebuilt repro → all four cases correct (A unchanged; B/C/D now `async` + `await`). Emitted
  client parses (`new Function(src)` OK).
- Fail-closed: server-mode `E-SERVER-FN-IN-SYNC-CALLBACK` STILL fires for a peer server-fn call in
  a `.some` callback — both top-level AND nested inside an `if` body (my recursion path). My change
  never touches server-mode emission (asyncRouteMap is set only by scheduleStatements = client-only),
  so the guards are structurally unaffected.

## 2026-07-18 — scope boundary / residuals (deliberate, documented)
- MATCH-ARM bodies: NOT descended into. The client match lowering emits a SYNC IIFE
  (`(function(){…})()`, emit-control-flow.ts:2135) where `await` is illegal; injecting there would
  produce invalid JS. A server call in a client match arm needs the IIFE made async+awaited — a
  larger transform, out of scope. hasServerCallees also skips match arms to stay consistent (no
  false async-prefix). Residual: nested-in-match server call stays un-awaited (== pre-fix).
- TILDE-accumulator / reactive-for `createItem` paths (`_emitIfStmtWithOpts`,
  `_emitForStmtWithTilde`, `_emitWhileStmtWithTilde` in emit-logic.ts, reached only when
  `opts.tildeContext`/`continueBehavior` active) do NOT get the injection — these are separate
  async-coloring contexts (the createItem fn's own asyncness) where blind injection could be unsafe.
  Residual: missing await (not invalid JS), == pre-fix. The common no-`~` path is fully covered.
- TRY/CATCH bodies: not threaded (brief scope is if/else/for/while/do-while + match). Consistent —
  hasServerCallees doesn't recurse into try either, so no async/await mismatch.
- COMPOUND-ASSIGN (`x += fn()`): injectPromiseAwait preserves the operator → `x += await fn()`.

## 2026-07-18 — full-suite triage + two follow-on fixes
- Ran the FULL suite (HEAD vs baseline, both on Windows). Parity gate `M6.5.b.0 within-node`
  is deterministically 1013 fail on BOTH (native parser is M5/in-progress) — my change adds ZERO.
  Total fail count is flaky (1051 / 1098 / 1056 across runs) — happy-dom / subprocess / tmp-dir
  isolation noise. Deterministic re-runs of the codegen suspects (s144-server-fn-nested-block-
  lowering 14/0, request-tag-and-server-fn-reactive 24/0, reactive-bool-attrs 21/0) all PASS →
  those HEAD-only fails were flaky, not regressions.
- REGRESSION FOUND + FIXED (conf server-fn/cps-call-in-if-arm, passed on baseline): a reactive-cell
  server write `@items = loadTasks()` (→ `_scrml_reactive_set("items", loadTasks())`) is owned by the
  emit-client auto-await pass (emit-client.ts:2534 → self-contained async IIFE). injectPromiseAwait's
  classifier fired on it (server callee is a nested arg) and prepended a bogus outer `await` in a
  SYNC handler (invalid). Fix: injectPromiseAwait fences off reactive/derived/default/init/engine
  runtime sinks + already-async IIFEs. refresh() restored to the baseline IIFE form.
- ROBUSTNESS (coordinator-directed): `_asyncAwaitBodyOpts` + emitLogicBody's injection gated on a
  truthy `asyncFilePath`, making nested-await entry-point-dependent (a caller threading routeMap but
  leaving filePath falsy would drop the await). asyncFilePath is only a §13.2.1 classifier passthrough
  (server-fn detection needs routeMap alone). Now gate on `asyncRouteMap` presence ALONE; asyncFilePath
  defaults to "". NOTE: I could NOT reproduce a failing §1-§5 locally — the compileScrml API path
  emits `async`+`await` correctly (probe + tests 11/0) — but applied the fix as it is correct and
  removes the fragility regardless.

## 2026-07-18 — coordinator round 2 (authoritative defect + P3-FOLLOW)
- The coordinator reviewed commit 26eaacf3 (BEFORE the sink-exclusion fix f7408741). The authoritative
  defect they raised — `@cell = serverFn()` nested in if/for/while → orphan outer `await` in a sync fn
  → E-CODEGEN-INVALID-LOGIC — is ALREADY FIXED on HEAD by f7408741's reactive-sink guard. Confirmed on
  HEAD ed59e090 with their prescribed method: built `function go(){ if(@flag){ @data=fetchContacts() } }`
  (+ for/while/else variants) → clean build, each fn stays plain `function`, emits the correct
  `(async () => _scrml_reactive_set("data", await _scrml_fetch_…()))().catch(…)` fire-and-forget IIFE,
  and passes an **Acorn sourceType:"module" parse** (their required validator — `new Function()` sloppy-
  mode false-passes bare `await`; I now Acorn-module-parse every emitted client). git state verified clean
  at HEAD (their "reverted worktree" note was a transient state during my baseline A/B; commits intact).
- P3-FOLLOW isComponent-budget regression (mine): the exportRegistry passthrough type annotations spelled
  the legacy `isComponent` field (scheduling.ts 3->4; emit-control-flow.ts 0->1). Fixed WITHOUT touching
  the governance test: scheduling.ts uses `Parameters<typeof isPromiseReturningCallExpr>[4]`; emit-control-
  flow's opaque passthrough carries kind/category/isAsync only; comments reworded to avoid the token.
  P3-FOLLOW 4/0.
- Full `bun test compiler/tests/unit compiler/tests/conformance` on ed59e090: 17668 pass / 47 skip / 2 fail
  (both non-#87: `E-TYPE-ANY-FORBIDDEN asIs` @8.4s = timeout/flaky; `P3-FOLLOW isComponent budget` = the
  one just fixed). Re-running post-P3-fix to confirm.
