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
