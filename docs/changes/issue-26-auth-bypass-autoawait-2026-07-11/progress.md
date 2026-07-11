# progress — Issue #26 auth-bypass auto-await

## Status: fix implemented + adversarial matrix green + runtime proof PASS. Gate run pending.

## Root cause (two layers)
1. **Registry seed gap (primary).** STDLIB-EXPORT-SEED (api.js Stage 3.105) seeded only the
   directly-imported stdlib module path. `scrml:auth` (index.scrml) exposes verifyPassword /
   hashPassword via `export { … } from './password.scrml'` — a RE-EXPORT. The seed recorded that
   name as an opaque `kind: "re-export"` entry with NO `isAsync`, and never resolved the chain to
   password.scrml (which declares `export async function`). `isPromiseReturningStdlibFn` demands
   `kind ∈ {function, fn}` AND `isAsync === true`, so it classified verifyPassword/hashPassword as
   SYNC → no `await`. (The existing S89 mechanism only ever exercised DIRECT stdlib exports, e.g.
   `scrml:host` safeCallAsync, so the re-export hole was never hit.)
2. **Server-fn emit path never consulted the classifier.** emit-server.ts emits server-fn bodies
   via `emitLogicNode(stmt, _serverFnOpts)` (NOT scheduleStatements), and `_serverFnOpts` did not
   thread the auto-await classifier inputs. The SQL await comes from emit-logic case "sql"
   (always-await), not the classifier — which is why SQL was awaited but the stdlib calls were not.
   Additionally the production caller (codegen/index.ts) invokes generateServerJs on the LEGACY
   positional signature, so `ctxForCache.exportRegistry` was null.

## Fix
- **api.js STDLIB-EXPORT-SEED**: resolve re-export chains to terminal {kind, isAsync} (honoring
  `renames` for `as`), depth-capped, TAB-parse-cached.
- **emit-server.ts**: build per-file `_asyncCalleeMap` + `_asyncExportRegistry`; thread into the 5
  server-fn opts objects; NEW positional param `exportRegistryLegacy` (wired from codegen/index.ts);
  install a file-scoped classifier via `setServerAsyncClassifier`.
- **emit-expr.ts**: EmitExprContext `asyncCalleeMap`/`asyncExportRegistry`; module-level file-scoped
  classifier (safety net for ctx-reconstruction boundaries) + `setServerAsyncClassifier`; exported
  `isStdlibAsyncCallee`; emitCall SERVER-mode `await` branch (gated on peerAwaitable); emitReceiver
  paren-wrap for awaited stdlib calls.
- **emit-logic.ts**: `_makeExprCtx` forwards the two fields; SQL `?{}` param path routes a
  stdlib-async param through structured `emitExpr` (was textual rewriter → unawaited).

## Adversarial matrix — ALL GREEN (emitted JS)
- (a) `const ok = await verifyPassword(...)` + `if (!await verifyPassword(...))` inline predicate.
- (b) `const demoHash = await hashPassword(...)` + `${await hashPassword(pw)}` inline in INSERT.
- (c) sync `safeCall(...)` NOT awaited; plain `a + a` untouched; no `await safeCall`.
- (d) nested arg `String(await verifyPassword(...))` awaited.
Runtime proof (real Argon2 auth.js): pre-fix wrong password → token (BYPASS); post-fix wrong
password → rejected, correct → token; hashPassword awaited → `$argon2id$…`, unawaited → `[object Promise]`.

## Verification (DONE)
- [x] Regression unit test `compiler/tests/unit/issue-26-server-auto-await-stdlib.test.js` — 7/7 pass
      (all shapes: bound-const predicate, inline `if(!verifyPassword())`, bound hashPassword,
      inline `${hashPassword()}` in INSERT, sync safeCall NOT awaited, nested arg, no `await await`).
- [x] FULL gate `bun test compiler/tests/{unit,integration,conformance}`: 19806 pass / 65 skip.
      One pre-existing meta-test (`p3-follow-no-isComponent-routing`) needed an allowlist bump for
      the 4 new TYPE-ANNOTATION `isComponent` mentions (routing reads use kind/isAsync, not
      isComponent) — added emit-expr.ts:3 + emit-server.ts:1; now 0 fail.
- [x] Byte-diff regression: baseline vs fixed emit over 686 clean-compiling samples → 0 emit changes
      (fix is inert where no async stdlib call exists server-side; no over-await / collateral drift).
- [x] R26: recompiled the issue's exact repro on the post-fix baseline → `const ok = await
      verifyPassword(...)` + `const demoHash = await hashPassword(...)`.
- [x] Runtime proof (real Argon2 auth.js): pre-fix wrong password → token (BYPASS); post-fix wrong
      → rejected, correct → token; hashPassword awaited → `$argon2id$…`, unawaited → `[object Promise]`.

## Finding-2 fold (S239 adversarial review) — FAIL-CLOSED for non-awaitable positions

The #26 fix routed async-stdlib calls through the awaitable-position machinery, but
where `peerAwaitable === false` (an async stdlib call inside a SYNC `.some`/`.find`/
`.filter`/`.map` callback body, a nested lambda, or a parameter default), the await
branch was gated OFF and the call emitted BARE with **no await AND no diagnostic** — a
SILENT re-open of the exact bypass: `rows.some(h => verifyPassword(pw, h.password_hash))`
returns a truthy Promise, so `if (!any)` never fires → accept-all. The PEER-server-fn
equivalent in that position is already a hard error (`E-SERVER-FN-IN-SYNC-CALLBACK`); the
#26 fix did not extend that fail-closed treatment to async-stdlib callees.

**Fix (mirror the peer fail-closed path):**
- `emit-expr.ts`: the stdlib-async `emitCall` branch moved the `peerAwaitable !== false`
  gate from the `if` head to INSIDE — a non-awaitable position now RECORDS the site into
  the classifier's new `syncCallSink` (fail-closed) instead of falling through to bare.
  The sink rides ON the file-scoped classifier so its lifetime == the classifier's
  per-file scope (present in every server-mode position where detection can fire — the
  same robustness backbone the classifier gives the await; no fragile ctx-threading).
- `emit-server.ts`: create the per-file sink array + pass it to `setServerAsyncClassifier`;
  a shared `_diagAsyncStdlibSyncCb` emitter (sibling of `_diagSyncCb`) + an `_isAsyncStdlibName`
  predicate; drain the sink post-emission (structured lambdas / param defaults) AND extend
  the escape-hatch AST walk (block-body callbacks — raw text emit-expr never structurally
  sees) — both raise `E-ASYNC-STDLIB-IN-SYNC-CALLBACK`.
- New code minted (the peer message is server-fn-specific, does not fit an async-stdlib
  call): **`E-ASYNC-STDLIB-IN-SYNC-CALLBACK`** (§34 catalog row added, ref §13.2).

**Adversarial matrix — ALL GREEN (emitted JS / diagnostic evidence):**
- (a) FAIL-CLOSED: `.some`/`.find`/`.filter`/`.map` expr-body, nested lambda, param
  default, AND block-body escape-hatch — all now ERROR with `E-ASYNC-STDLIB-IN-SYNC-CALLBACK`
  (was silent bare emission for all).
- (b) NO REGRESSION: the #26 awaitable shapes still emit `await` — `issue-26-server-auto-await-stdlib.test.js` stays 24/24 (with the peer integration test) green; awaitable const predicate spot-check emits `const ok = await verifyPassword(...)`.
- (c) NO OVER-FIRE: sync stdlib in a sync callback (`.map(r => safeCall(...))`,
  `.some(r => generatePassword(8,{}))`) and a plain expr (`.map(r => r.id + 1)`) do NOT
  error.
- (d) the peer `E-SERVER-FN-IN-SYNC-CALLBACK` path still errors as before
  (`server-fn-calls-server-fn.test.js` green).

**Tests + oracle:**
- New unit regression `compiler/tests/unit/issue-26-finding2-async-stdlib-sync-callback.test.js`
  (11/11 — the a/b/c matrix incl. block-body).
- New conformance case `conformance/cases/auth/auth-async-stdlib-sync-callback-neg` (codes-half,
  the diagnostic fires). `bun conformance/run.ts` → 306/306.
- FULL gate `bun test compiler/tests/{unit,integration,conformance}` — see terminal report.

## Deferred (surfaced, not closed)
- A runtime bypass-closed CONFORMANCE case would need the server-eval adapter (`evalServerModule`)
  to strip/stub the emitted `import { verifyPassword } from "./_scrml/auth.js"` (import statements
  are illegal in its `new Function` body). That is conformance-adapter infrastructure work beyond
  this security fix; the unit regression (emit-shape) + runtime proof cover the surface.
- The `?{}`-param structured-routing detection uses a callee-name regex (mirrors the existing peer
  scan). A stdlib-async name that also appears inside a string literal in the same param would
  false-positive the structured route; harmless (the structured emitExpr path is byte-identical to
  the text path for non-call params), but noted.
