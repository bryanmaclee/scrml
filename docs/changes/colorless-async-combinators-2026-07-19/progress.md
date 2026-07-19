# Phase-2 colorless-async combinator transform — progress

Branch: feat/colorless-async-phase2-combinators (base 1c577da5)
Design authority: scrml-support/docs/deep-dives/colorless-async-boundaries-2026-07-16.md
  §2 position 1 (clean family) + FORK 1 (1a build-now, ratified S259) + FORK 2 (.sort fail-closed)

## Plan
1. [DONE] New shared module compiler/src/codegen/async-combinators.ts — the clean-family
   method set, `callbackReachesAsync` structural detector (predicate injected), the 9
   readable sequential-for-await runtime combinators, on-use helper block injector.
2. emit-expr.ts:emitCall — intercept `coll.<clean>(asyncCb)` -> `await _scrml_<m>Async(coll, asyncCb)`;
   force the callback lambda async so its inner async calls auto-await. `.sort` untouched (stays fail-closed).
3. emit-library-shared.ts:collectNonAwaitableAsyncCalls — EXEMPT the clean-family async-callback
   lambda (its async call is now an awaited combinator body, not a leak). `.sort` NOT exempt.
4. On-use inject the helper block on server / client / tool / library final-emit.
5. Verify: per-method compile, EXECUTED sequential-order check, R26 no-regression, full suite.

## Log
- 2026-07-19: baseline confirmed — flagship `hs.some(fn(h) => verifyPassword(pw,h))` fires
  E-ASYNC-STDLIB-IN-SYNC-CALLBACK today (correct pre-change behavior).
- 2026-07-19: async-combinators.ts landed (step 1).

## Checkpoint 1 (2026-07-19)
- emit-expr.ts:emitCall — combinator interception landed (before generic call path).
  combinatorIsAsyncName predicate = isStdlibAsyncCallee ∪ serverFnNames ∪ clientAsyncFnNames.
  Callback re-emitted async ({...cb, isAsync:true}); clientAsyncBody:true for client cb ctx.
- emit-library-shared.ts:collectNonAwaitableAsyncCalls — EXEMPTS clean-family async-callback
  lambda (walks its body awaitable); .sort NOT exempt → still fails closed.
- emit-server.ts — on-use injectAfterHeader(asyncCombinatorHelperBlock) in finalEmitted.
- emit-library.ts — withAsyncCombinators footer at both generateLibraryJs returns.
- VERIFIED (compile): all 9 clean-family methods lower to `await _scrml_<m>Async(...)` + fn async;
  reduce honors with-init AND no-init; .sort async-comparator → E-ASYNC-STDLIB-IN-SYNC-CALLBACK;
  sync-control stays native .filter (fn NOT async, no combinator); server .server.js lowers+injects,
  client.js has ZERO verifyPassword/combinator (server-only boundary preserved); all emitted JS
  passes `bun --check`.
- TODO: client-fn path (emit-functions injection + verify), tool path (emit-tool), EXECUTED
  sequential-order test, unit tests, R26 no-regression, full suite.

## Checkpoint 2 (2026-07-19) — tests + coupled expectation updates
- NEW compiler/tests/unit/colorless-async-combinators.test.js (22 tests): per-method lowering,
  reduce both forms, .sort fail-close, sync-control native, on-use injection, EXECUTED
  sequential-order + early-exit proof (runs the injected combinator block), EXECUTED end-to-end
  (compile → import → run).
- FLIPPED (justified by FORK 1 ratification S259) — the Phase-1 interim fail-closed for the CLEAN
  FAMILY now transforms:
  - colorless-async-seam-a.test.js §7 `.some` value-export: now asserts `await _scrml_someAsync`.
  - issue-26-finding2 (a): `.some`/`.find`/`.filter`/`.map`/nested now assert combinator lowering;
    param-default + block-body + NEW `.sort` case STAY fail-closed (a2 block).
  - conformance auth-async-stdlib-sync-callback-neg: repurposed `.some` -> `.sort` async comparator
    (still-fail-closed FORK-2 sibling) to preserve strong E-code coverage; description updated.
- VERIFIED: 34 (seam-a + finding2) + 22 (new) unit pass; conformance corpus-bridge 741/741;
  R26 Phase-1 repros (giti037/transitive/crossmodule) still correctly async/await.
- EXECUTED order proof: forEach/map side-effects in INPUT order [0,1,2] under decreasing delays
  (Promise.all would give [2,1,0]); some/every early-exit (visited [0,1] only).
- TODO: client bundle + tool bundle injection (a client-side async-callback method must inject the
  helper too — corpus=0 but Rule-2 fidelity); full suite.

## Checkpoint 3 (2026-07-19) — client + tool emission paths
- emit-client.ts: append asyncCombinatorHelperBlock(clientCode) footer before return (hoisted
  function decls; on-use). Fixes the client gap (a client `.map(n => safeCallAsync(...))` lowered
  to `_scrml_mapAsync(` with NO definition → ReferenceError). Now defined + `bun --check` clean.
- emit-tool.ts: buildRuntimeHelperHeader inlines the used combinators + registers their names so
  the fail-closed E-TOOL-005 scan does not flag them. Tool `.map` async lowers + defines + runs.
- VERIFIED: server / library / client / tool all lower + inject on-use; each emitted bundle passes
  `bun --check`; client.js carries ZERO server-only leak for a server async callback.
- Flipped test suite (peer-server-fn clean-family callback also transforms — same async-callback
  definition): i87 §8 `.some(x=>peer())` + server-fn-calls Finding-1 `.map(x=>lookup(x))`.
- NOTE: the earlier 112/136 server-fn-calls full-run failures were the DOCUMENTED happy-dom
  global-state pollution flake (file self-documents it lines 137-140); base run 0-fail, my re-run
  0-fail (19656 tests). Not a regression.

## COMPLETE (2026-07-19)
- Full gate GREEN: `bun test unit integration conformance` → 20871 pass / 0 fail (20940 tests).
- All emission paths (server/library/client/tool) lower clean-family async callbacks to the
  sequential-for-await combinators + inject on-use; .sort stays fail-closed; sync callbacks native.
- EXECUTED order + early-exit proven; end-to-end compile→import→run proven; R26 Phase-1 unbroken.

## S239 review fixes (2026-07-19)
- F1 (emit-expr.ts): NEW isAwaitedCombinatorCall + wired into emitReceiver → a combinator in
  receiver position paren-wraps `(await _scrml_<m>Async(...)).member`. EXECUTED: bigCount=2,
  bigJoined="3,4", firstBig=3, bigDoubled=[6,8] (were undefined/crash pre-fix).
- F2 (emit-library-shared.ts): collectNonAwaitableAsyncCalls records a combinator call that is
  ITSELF in a non-awaitable position (insideCallback) → fails closed mode-agnostically
  (library/client/server-value-export). emit-tool.ts: NEW drainToolAsyncSyncCallbackLeaks in both
  tool paths (tool had no such drain). Server routes already fail-closed via emit-expr syncCallSink.
  VERIFIED fail-closed in library / client / server-route / tool; normal awaitable combinator + all
  28 combinator unit tests still green.
