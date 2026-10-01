# s440-sync-callback-async-helper — progress (append-only)

## 1. Startup
- Worktree `agent-ab13d4ede5a9719a8`, base = origin/main 3593d0367 (ff, clean). bun install + pretest OK.
- Baseline gate: 32081 pass / 85 skip / 0 fail.

## 2. Reproduction (base)
- Client + server: a nested `function inner(x) { return isOk(x) }` is emitted `async` but every
  call site treats it sync: `.some/.every/.find/.filter/.map(x => inner(x))` bare, `.sort` bare,
  `const r = inner(5)` un-awaited, `.some(inner)` / `.sort(inner)` bare, nested `inner → b → isOk`
  leaves `inner` sync, nested param default `g(y = inner(1))` silent. No diagnostic anywhere.
- Arrow-bound `const inner = (x) => isOk(x)` already fails closed but the client reported
  E-ASYNC-STDLIB (should be E-SERVER-FN) and every such site reported at 1:1.
- File-scope by-reference `[..].sort(isOk)` was ALSO silent (server + client).

## 3. Root cause
Every async-colored set is FILE-SCOPE: `computeAsyncFnNames(fns, …)` (emit-library-shared.ts) is
fed top-level fn nodes; the server peer set is top-level server fns. A nested function-decl is in
none; `case "function-decl"` (emit-logic.ts) adds `async` from the emitted body's `await` TEXT, so
the helper is async at its definition and sync at its call sites.

## 4. Fix (landed in one code+tests commit)
- NEW `compiler/src/codegen/local-async-fns.ts` — lexical pre-pass per top-level fn: scopes
  (fn-decl + lambda), hoisted nested decls, fixpoint over nested decls (transitive), root
  classification (server | stdlib), AST marks on nested decls / calls / by-ref idents.
- Each emitter runs it with its OWN facts before emitting bodies: emit-functions (client),
  emit-server (route/peer bodies + value exports), emit-library, emit-tool.
- Consumers read the marks: emit-expr emitCall (await / record / sync-shadow), emitReceiver wrap,
  async-combinators callbackReachesAsync (combinator lift), emit-library-shared drain
  (collectNonAwaitableAsyncCalls), emit-logic nested decl `async` keyword + clientAsyncBody.
- Diagnostic code follows the root (`syncCallbackErrorForSite`); shared `serverFnSyncCallbackError`;
  spans anchored to the enclosing statement when the expression span is the 1:1 placeholder.
- By-reference: `.sort/.toSorted/.findLast/.findLastIndex/.reduceRight(asyncFn)` fail closed
  (`SYNC_CALLBACK_CONSUMER_METHODS`). NOT any user HOF (see §5).
- Nested fn param defaults: scanned by the drain (client/library) and the emit-server walk.

## 5. Corpus measure (compile-by-compile, base vs head, 2094 files incl. flogence)
- First draft flagged EVERY by-reference async arg → 1 newly-failing file:
  flogence/src/ports/dispatch-tool.scrml:129 `runGatedAgentic(path, id, runLane)` — NOT genuine
  (runGatedAgentic awaits `run()` inside a foreign block). Narrowed the rule to the sync-consumer
  collection methods. Re-measured: **0 newly-failing files**.

## 6. Verification
- New unit file: 50 tests, red on base (47 fail / 3 pass = negative controls), green on head.
- 3 conformance cases (1 runtime `serverStub`, 2 codes) — 0/3 on base (runtime shows "accepted",
  the accept-all), 3/3 on head.
- types-gate diff vs base: identical.

## 7. Fix round (security review of eb964a2c6: F1 INTRODUCED, F2/F3 in scope)
- Merged origin/main (048df04db) into the branch first.
- F1 (introduced): block-level `function` decls were registered at FUNCTION scope and a
  SYNC-local resolution demoted the call to a plain call → `if (verifyPassword(pw, hash))`
  after `if (false) { function verifyPassword(){…} }` emitted unawaited. Fix: statement
  arrays are BLOCK scopes (local-async-fns.ts populateBlock); marks are recorded ONLY for
  ASYNC resolutions (a sync-local resolution never demotes — the demotion branch in
  emitCall is removed); an unresolved name with an async same-named decl in a
  non-enclosing block is marked async (Annex-B ambiguity → fail closed); a nested fn
  calling a sync-local that shares an async outer name counts the outer root.
- F3: a `let` only shadows when it is a CERTAIN binding of an enclosing scope (direct
  block statement / param); fn-vs-let in one scope prefers the fn.
- F2: emit-server's AST walk now checks block-body callback raw text and template
  `${…}` raw text against the nested-async names (fail closed, code by root).
- Verified: tool-mode real hashing (verifyPassword/hashPassword) — all F1/F2/F3 shapes
  reject; `right`-password controls accept. 12 new unit tests (62 total) red on eb964a2c6;
  3 new conformance cases red on eb964a2c6 (runtime case "accepted").
- Corpus (2100 files, origin/main vs head, codes + emitted-JS hash): 0 diffs outside the
  six s440 conformance cases themselves.
