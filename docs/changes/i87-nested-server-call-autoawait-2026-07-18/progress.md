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
