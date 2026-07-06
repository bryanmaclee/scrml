# SCOPE (dispatch-ready) — BaaS: Auth flows + JWKS (RS256)

**Change-id:** `baas-auth-flows-jwks-2026-07-06`. **Status:** TEED UP (S242) — fire once BaaS #3 (`baas-introspect-pg`) lands (one review at a time; both write disjoint files but land serially). **Authority:** BaaS-parity DD `../../../../scrml-support/docs/deep-dives/baas-parity-worth-it-2026-07-05.md` (auth flows+JWKS = best-ROI worth-building — primitives exist, flows don't; auth is a native headline + where security bugs live). Substrate mapped S242 (Explore).

## GO/NO-GO: RS256/JWKS is a **GO** ✅
Live probe on this machine (Bun 1.3.13): `crypto.subtle` imports an RSA JWK + verifies RSASSA-PKCS1-v1_5 + SHA-256 (`RS256 import-from-JWK + verify OK: true`). Same `crypto.subtle` surface the existing HMAC path uses (`compiler/runtime/stdlib/auth.js:146-152`). No new host capability, no native module. `verifyJwtJwks` is buildable today.

## The substrate (confirmed)
`stdlib:auth` = source `.scrml` (`stdlib/auth/{index,jwt,password}.scrml`) + ONE flat runtime shim `compiler/runtime/stdlib/auth.js` (the `.scrml` `server{}` can't lower yet — M16 gap; the hand-written shim is what runs). Bundler resolves `scrml:<name>` → copies `compiler/runtime/stdlib/<name>.js`. Primitives all present: `crypto.generateToken(32)`/`generateUUID`/`safeCompare`; `store.createStore(db,ns)` with **TTL** (`kv.scrml:121` `set(key,value,ttl)` seconds, lazy-expiry on read) + `get`/`delete`; `http.get`/`post`; `time.now`. **No `stdlib/email`** — a sender must be **injected** (mirrors oauth's inject-production-adapter convention). `verifyJwt` is HMAC-only (confirmed); no RS256/JWKS anywhere today.

## Two sub-features

### A. `verifyJwtJwks(token, jwksUrl, opts) → Promise<{valid, payload?, reason?}>`
Add to `stdlib/auth/jwt.scrml` (source, +`~{}` test) + mirror in `compiler/runtime/stdlib/auth.js` + re-export `stdlib/auth/index.scrml:14`. Composition: `decodeJwt(token)` header → read `kid` + `alg` → fetch JWKS via `http.get(jwksUrl)` (cache by url with TTL) → match JWK by `kid` → `crypto.subtle.importKey("jwk", jwk, {name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"}, false, ["verify"])` → `crypto.subtle.verify(...)` → validate claims.
`opts = { issuer?, audience?, cache?, ttl=3600, clockToleranceSec=60 }`.

**SECURITY (load-bearing — get these right):**
- **PIN alg to RS256.** Read the token header `alg`; if it is not `RS256` → reject (`reason:"alg-not-allowed"`). This blocks the classic JWKS **alg-confusion attack** (attacker sets `alg:none`, or `alg:HS256` and signs with the RSA public key as an HMAC secret). NEVER dispatch verification off the token's own `alg` into HMAC. Allowed-alg is fixed to RS256 (v1).
- **exp / nbf** validation (with `clockToleranceSec`); expired → `reason:"expired"`.
- **iss / aud** validation when `opts.issuer` / `opts.audience` given; mismatch → reject.
- **kid handling:** match JWK by `kid`; on kid-miss, **refetch** JWKS once (key rotation) before failing; if the JWKS has one key and the token has no kid, use it; ambiguous → reject.
- **Cache:** JWKS fetch is expensive; cache keys by `jwksUrl` with TTL (default 1h) — in-shim `Map` with timestamp, OR an injected `scrml:store` handle via `opts.cache`. Refetch on TTL-expiry or kid-miss.

### B. `stdlib/auth/flows.scrml` — magic-link / email-verify / password-reset
New `stdlib/auth/flows.scrml` (source +`~{}`) + shim in `auth.js` (or a `auth/flows.js` sub-shim if it grows) + re-export in `index.scrml`. Each flow = a `request*` / `verify*` pair over token-gen + TTL-store + injected sender:
- `requestMagicLink(email, {store, sendEmail, baseUrl, ttl=900})` → `generateToken` → `store.set(token, {email, purpose:"magic-link"}, ttl)` → `sendEmail(email, link=`${baseUrl}?token=${token}`)`. `verifyMagicLink(token, {store}) → {valid, email?}` — **single-use consume** (get → delete → return). Caller issues the session.
- `requestEmailVerification(email, {store, sendEmail, baseUrl, ttl=86400})` + `verifyEmail(token, {store})` — same shape, `purpose:"email-verify"`.
- `requestPasswordReset(email, {store, sendEmail, baseUrl, ttl=3600})` + `verifyResetToken(token, {store}) → {valid, email?}` (caller updates the hash). Optionally `resetPassword(token, newPassword, {store, updateHash})` composing verify + `hash("argon2id", …)` + injected `updateHash(email, hash)`.

**SECURITY (load-bearing):**
- **Single-use:** `verify*` does get-then-delete (atomic within one sync SQLite call, `kv.scrml:7`) — a token cannot be reused. Re-verify → `{valid:false, reason:"used-or-invalid"}`.
- **TTL:** `store.set(…, ttl)` → lazy-expiry; expired → `reason:"expired"`.
- **Purpose-binding:** each flow uses a **distinct store namespace** (`createStore(db,"magic-link")` vs `"email-verify"` vs `"pwreset")`) — the map confirmed no built-in purpose field, so namespace-per-purpose is the mechanism. A reset token CANNOT be replayed as a magic-link (different namespace → not found).
- **Enumeration resistance:** `request*` returns a **neutral result** regardless of whether the account exists (the caller decides whether to actually send; the flow never leaks existence). Document this contract.
- **High-entropy tokens** (`generateToken(32)` = 256-bit); `safeCompare` guards any secondary-secret compare.
- **Injected sender** — no built-in mailer; `sendEmail(to, {subject, link, token})` is passed in (DI). `scrml:http.post` is available if a flow wants to hit a provider directly, but injection is the clean pattern.

## Build map
| Piece | Source `.scrml` | Runtime shim | Re-export | Test |
|---|---|---|---|---|
| `verifyJwtJwks` | `stdlib/auth/jwt.scrml` | `compiler/runtime/stdlib/auth.js` | `stdlib/auth/index.scrml:14` | extend `compiler/tests/unit/stdlib-auth.test.js` |
| flows (3) | new `stdlib/auth/flows.scrml` | `auth.js` (or `auth/flows.js`) | new line in `index.scrml` | new `compiler/tests/unit/stdlib-auth-flows.test.js` |

## Test plan (no external deps)
- **verifyJwtJwks** (extend `stdlib-auth.test.js`, which already drives real `crypto.subtle`): `crypto.subtle.generateKey` RSA → sign a JWT → serve the exported JWK as a stub JWKS (stub `http.get`) → verify=valid; tamper→invalid; **`alg:none` and `alg:HS256`-with-pubkey → rejected** (the security tests); expired→rejected; kid-rotation refetch.
- **flows** (new `stdlib-auth-flows.test.js`): real SQLite store (temp db) or in-mem stub + a stub `sendEmail` that captures the token → request → verify=valid; re-verify→invalid (single-use); expired→invalid; cross-purpose token→invalid (namespace isolation).
- Plus `~{}` blocks in the `.scrml` sources.

## Scope bounds (v1)
IN: magic-link / email-verify / password-reset flows; `verifyJwtJwks` RS256. OUT (note in report): SMS/OTP flows (needs SMS dep); the email SENDER itself (injected — the BaaS #8 thin `stdlib/email` is separate); OIDC discovery auto-fetch (`.well-known/openid-configuration` → jwks_uri — v1 takes an explicit `jwksUrl`); non-RS256 JWKS algs (ES256/PS256 — follow-on); rate-limit integration (`createRateLimiter` exists; compose at caller).

## Dispatch note (when firing)
This is a **scrml-writing + shim** dispatch (`.scrml` source + JS shim), NOT compiler-source. So the brief MUST include the **kickstarter (`docs/articles/llm-kickstarter-v2-2026-05-04.md`) + anti-patterns (`scrml-support/docs/gauntlets/BRIEFING-ANTI-PATTERNS.md`)** per pa.md (any dispatch writing scrml). Plus the standard F4/S88/S90/S99/S126 worktree + path-discipline + S83 commit-discipline. Security note in the brief: **the alg-pinning + single-use + purpose-binding are non-negotiable acceptance criteria** — the PA adversarial `/code-review` (S239) will specifically probe the alg-confusion + token-reuse + cross-purpose-replay vectors before landing.
