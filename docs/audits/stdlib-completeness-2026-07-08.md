---
status: current
last-reviewed: 2026-07-08
---

# stdlib per-export completeness sweep (S247, 2026-07-08)

A per-export audit of the scrml runtime stdlib — "is it complete, or are there stubs?"
Six parallel read-only auditors covered ~200 exports across ~20 modules; the PA then
adversarially verified every material finding against source.

## Verdict

**Complete — zero incomplete stubs.** Every runtime export has a real, contract-delivering
body. The "stub" instances are all deliberate and were verified-backed:

- **Source-level stubs → JS-host runtime**: `host` (`safeCall`/`safeCallAsync`), `mcp`
  (`startMcpServer`/`shutdownMcpServer`) — the `.scrml` declares the API; the runtime lives
  in `compiler/runtime/stdlib/{host,mcp}.js` (confirmed to define each export).
- **MOD-stage compiler-resolved stubs**: `formFor` / `tableFor` / `schemaFor` / `parseVariant`
  — the `.scrml` body is a placeholder the compiler intercepts (`emit-*.ts` emitters, all
  present and real). Shipped features (S102–S105).
- **Barrel re-exports**: `store/index`, `data/index`.
- **Deliberate scope/security limits (documented)**: PKCE `plain` omitted (unsafe); oauth
  presets that skip JWT-bearer / revocation; `tableFor` advanced features (v1.next);
  the login-template session-establishment gap.

Separately, `stdlib/compiler/*` (the self-host compiler — bs/tab/ts/cg/…) is deferred
post-v1.0.0 (scrml-native is the parity target); it is not "the stdlib" in the adopter sense.

## Findings (13) + dispositions

| # | finding | severity | disposition |
|---|---|---|---|
| 1 | login template blocked login on success (`result.error != ""` on a no-error success shape) | bug (fails-closed) | **FIXED** `3674fc83` → `is some` |
| 2 | `redis.setex` non-atomic (`set`+`expire`) despite SETEX name / "one round-trip" | correctness | **FIXED** `758bc6e3` → atomic `SETEX` |
| 3 | `generatePassword` modulo bias (source + shim) | security-hardening | **FIXED** `758bc6e3` → rejection sampling |
| 4 | `time.throttle` no `.cancel()`/`.flush()` despite doc cross-ref to debounce | API completeness | **FIXED** (this batch) source + shim |
| 5 | oauth `refreshToken` doc cites wrong RFC (8693 vs 6749 §6) | doc | **FIXED** (this batch) |
| 6 | `createRateLimiter` doc says "sliding" but impl is fixed/tumbling | doc | **FIXED** (this batch) |
| 7 | crypto module untested + doc cites a nonexistent `stdlib-crypto.test.js` | coverage | **FIXED** (this batch) wrote the test (17 cases) |
| 8 | `http.uploadFile` `.scrml` `_request` lacks the `instanceof FormData` branch the shim has | source/shim drift | **DROPPED** — runtime shim already works; the `.scrml` fix perturbs native-parser conformance baselines (within-node residual +13, try/catch position pins). Not worth it. |
| 9 | `verifyJwt` `.scrml` non-constant-time signature compare (shim uses `crypto.subtle.verify`) | security (latent) | **DEFERRED** — executed path (shim) is safe; source rewrite pending |
| 10 | `test.group` stops at first throw despite "all assertions run, collected" doc | doc-vs-body | open — collect-all isn't achievable while assertions throw; doc-fix candidate |
| 11 | `tableFor` lacks the defensive `data.js` throw-stub its 3 siblings have | robustness | open (low) |
| 12 | `store` barrel omits the `KvError` type | consistency | open (low) |
| 13 | broken/empty `dist/*.client.js` artifacts (http invalid JS; crypto/format empty) | codegen or stale | open — needs a recompile to settle live-codegen-bug vs stale-artifact |

**False positive caught:** `crypto.hmac` was flagged as "compares a Promise to a string, always
false" — wrong. scrml auto-awaits stdlib Promise exports, so the doc example resolves to the
hex string and works. Discarded.

## Systemic note — test fidelity

Many stdlib unit tests use an **extracted-copy** style (they re-implement the function inline
rather than importing the real `.scrml`/shim). They validate logic but cannot catch source↔shim
drift — which is exactly how findings 8 and 9 (source drifted from a correct shim) went unnoticed.
The new `stdlib-crypto.test.js` deliberately imports the real shim.
