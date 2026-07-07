# DISPATCH BRIEF — BaaS: Auth flows + JWKS (RS256)  [change-id: baas-auth-flows-jwks-2026-07-06]

You are implementing two stdlib auth features in scrml: **`verifyJwtJwks` (RS256/JWKS)** and the **magic-link / email-verify / password-reset flows**. This is a **scrml-writing + JS-shim** dispatch (stdlib `.scrml` source + the flat runtime shim) — NOT compiler-source. Ship SOURCE `.scrml` + the runtime shim + tests, all GREEN.

The authoritative scope is `docs/changes/baas-auth-flows-jwks-2026-07-06/SCOPE.md` — **read it in full first**; this brief adds the discipline + the non-negotiable acceptance criteria. Where this brief and the SCOPE agree, they agree; the SCOPE is the substrate detail.

---

# MAPS — REQUIRED FIRST READ
Before consuming any other context, read `.claude/maps/primary.map.md` in full (~100 lines). The §"Task-Shape Routing" section routes you to additional maps by task shape (this is a **stdlib / scrml-writing** shape — the compiler-source maps are secondary, but the stdlib + runtime-shim layout map IS load-bearing).
Map currency: maps reflect HEAD `66a3afb1` as of `2026-07-04`. HEAD has moved ~36 commits since; the stdlib/auth surface is stable but if a map claim conflicts with current source, trust `grep`/`Read` against current source. In your final report include either "Maps consulted: [list]; load-bearing finding: <one sentence>" or "Maps consulted but not load-bearing."

---

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE  (S99: this dispatch class has had leaks; do NOT be the next)

Your worktree path is assigned by the harness. Before ANY other tool call:
1. Run `pwd` via Bash. It MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. If it is under any OTHER repo (e.g. `scrml-support/.claude/worktrees/`), STOP and report — that is the S90 CWD-routing failure. Save the output as `WORKTREE_ROOT`.
2. Run `git rev-parse --show-toplevel` — MUST equal `WORKTREE_ROOT`.
3. Run `git status --short` — confirm clean.
4. Run `bun install` — worktrees do NOT inherit `node_modules`; the pre-commit `bun test` fails with "cannot find package 'acorn'" otherwise.
5. Your FIRST commit message MUST include the verbatim `pwd` output, e.g. `WIP(auth-flows): start at $(pwd)`.

## Path discipline (S99/S126 — enforce on EVERY write)
- **Apply ALL file edits via Bash** (`perl`/`python3`/heredoc/`cp`) on **worktree-absolute paths that include the `.claude/worktrees/agent-<id>/` segment** — NOT the Edit/Write tools (the S126 Edit/Bash filesystem-divergence class leaked to MAIN twice). Echo the target path before each write; re-verify with `git diff`/`grep` after.
- **NEVER `cd` into the main repo** (or anywhere outside `WORKTREE_ROOT`). Use `git -C "$WORKTREE_ROOT"`, `bun --cwd "$WORKTREE_ROOT"`, and worktree-absolute paths exclusively (S126 incident #14/#15 — a `cd`/`bun add` into main leaked).
- If an intake path looks like `/home/bryan-maclee/scrmlMaster/scrml/stdlib/...`, translate it to `$WORKTREE_ROOT/stdlib/...` before writing.

---

# REQUIRED READS (in this order, before writing any code)
1. `docs/changes/baas-auth-flows-jwks-2026-07-06/SCOPE.md` — the full scope (both sub-features, security requirements, build map, test plan, scope bounds).
2. `docs/articles/llm-kickstarter-v2-2026-05-04.md` — IN FULL. The canonical scrml shape + stdlib catalog + inline anti-pattern table. You are writing scrml; this kills the React/npm reflex.
3. `../scrml-support/docs/gauntlets/BRIEFING-ANTI-PATTERNS.md` — the Ghost-Pattern anti-pattern table. Re-read before each feature.
4. The substrate you extend: `stdlib/auth/index.scrml` (re-export surface), `stdlib/auth/jwt.scrml` + `stdlib/auth/password.scrml` (the source `.scrml`), `compiler/runtime/stdlib/auth.js` (the flat runtime shim — the `.scrml` `server{}` can't lower yet, so THIS is what runs), `stdlib/store/kv.scrml` (the TTL store — `set(key,value,ttl)` seconds, lazy-expiry), and `compiler/tests/unit/stdlib-auth.test.js` (the test harness you extend — it already drives real `crypto.subtle`).

scrml reminders (from the kickstarter — do NOT slip): no `null`/`undefined` (absence is `not`); no `try`/`catch`/`throw` (failable `fn`/`function` + `!{}`); no `async`/`await` in scrml source (the shim JS is host-JS and may use async — that's the shim layer, not scrml); `==`/`!=` not `===`/`!==`; strict-by-default.

---

# THE TASK

## A. `verifyJwtJwks(token, jwksUrl, opts) -> { valid, payload?, reason? }`
Add to `stdlib/auth/jwt.scrml` (source + a `~{}` test block) + mirror the runnable impl in `compiler/runtime/stdlib/auth.js` + re-export in `stdlib/auth/index.scrml:14`. Composition: `decodeJwt(token)` header → read `kid` + `alg` → fetch JWKS via `http.get(jwksUrl)` (cache by url, TTL) → match JWK by `kid` → `crypto.subtle.importKey("jwk", jwk, {name:"RSASSA-PKCS1-v1_5", hash:"SHA-256"}, false, ["verify"])` → `crypto.subtle.verify(...)` → validate claims. `opts = { issuer?, audience?, cache?, ttl=3600, clockToleranceSec=60 }`.

**SECURITY — NON-NEGOTIABLE ACCEPTANCE CRITERIA (the PA adversarial /code-review WILL probe these specific vectors before landing):**
- **PIN alg to RS256.** Read the token header `alg`; if it is NOT exactly `RS256` → reject with `reason:"alg-not-allowed"`. This blocks the **alg-confusion attack** (`alg:none`; or `alg:HS256` signed with the RSA *public* key as an HMAC secret). NEVER dispatch verification off the token's own `alg` into an HMAC path. Allowed-alg is FIXED to RS256 (v1). — A test MUST prove `alg:none` and `alg:HS256`-with-pubkey are both rejected.
- **exp / nbf** validation with `clockToleranceSec`; expired → `reason:"expired"`.
- **iss / aud** validation when `opts.issuer` / `opts.audience` are given; mismatch → reject.
- **kid handling:** match JWK by `kid`; on kid-miss, **refetch** the JWKS once (key rotation) before failing; if the JWKS has exactly one key and the token has no `kid`, use it; ambiguous → reject.
- **Cache:** cache JWKS by `jwksUrl` with TTL (default 1h) — an in-shim `Map` with timestamp OR an injected `scrml:store` handle via `opts.cache`. Refetch on TTL-expiry or kid-miss.

## B. `stdlib/auth/flows.scrml` — magic-link / email-verify / password-reset
New `stdlib/auth/flows.scrml` (source + `~{}`) + shim in `compiler/runtime/stdlib/auth.js` (or a `auth/flows.js` sub-shim if it grows) + re-export in `index.scrml`. Each flow = a `request*` / `verify*` pair over token-gen (`generateToken(32)`) + TTL-store + an **injected** `sendEmail`:
- `requestMagicLink(email, {store, sendEmail, baseUrl, ttl=900})` → `generateToken` → `store.set(token, {email, purpose:"magic-link"}, ttl)` → `sendEmail(email, link=\`${baseUrl}?token=${token}\`)`. `verifyMagicLink(token, {store}) -> {valid, email?}` — **single-use consume** (get → delete → return). Caller issues the session.
- `requestEmailVerification(email, {store, sendEmail, baseUrl, ttl=86400})` + `verifyEmail(token, {store})` — same shape, `purpose:"email-verify"`.
- `requestPasswordReset(email, {store, sendEmail, baseUrl, ttl=3600})` + `verifyResetToken(token, {store}) -> {valid, email?}`. Optionally `resetPassword(token, newPassword, {store, updateHash})` composing verify + `hashPassword` + injected `updateHash(email, hash)`.

**SECURITY — NON-NEGOTIABLE ACCEPTANCE CRITERIA (the adversarial review WILL probe token-reuse + cross-purpose-replay):**
- **Single-use:** `verify*` does get-THEN-delete (atomic within one sync SQLite call) — a token cannot be reused. Re-verify → `{valid:false, reason:"used-or-invalid"}`. A test MUST prove re-verify fails.
- **TTL:** `store.set(…, ttl)` → lazy-expiry; expired → `reason:"expired"`. A test MUST prove expiry.
- **Purpose-binding via distinct store namespaces:** each flow uses a DISTINCT `createStore(db, "magic-link" | "email-verify" | "pwreset")` namespace (there is no built-in purpose field — namespace-per-purpose IS the mechanism). A reset token CANNOT be replayed as a magic-link (different namespace → not found). A test MUST prove cross-purpose replay fails.
- **Enumeration resistance:** `request*` returns a NEUTRAL result regardless of whether the account exists (the caller decides whether to actually send). Document this contract.
- **High-entropy tokens** (`generateToken(32)` = 256-bit); `safeCompare` for any secondary-secret compare.
- **Injected sender** — no built-in mailer; `sendEmail(to, {subject, link, token})` is passed in (DI).

---

# TEST PLAN (no external deps — all local/stubbed)
- **verifyJwtJwks** (extend `compiler/tests/unit/stdlib-auth.test.js`, which already drives real `crypto.subtle`): `crypto.subtle.generateKey` RSA → sign a JWT → serve the exported JWK as a stub JWKS (stub `http.get`) → verify=valid; tamper→invalid; **`alg:none` and `alg:HS256`-with-pubkey → rejected**; expired→rejected; kid-rotation refetch works.
- **flows** (new `compiler/tests/unit/stdlib-auth-flows.test.js`): real SQLite store (temp db) or in-mem stub + a stub `sendEmail` that captures the token → request → verify=valid; re-verify→invalid (single-use); expired→invalid; cross-purpose token→invalid (namespace isolation).
- Plus `~{}` blocks in the `.scrml` sources.

# SCOPE BOUNDS (v1) — note in your report, do NOT build
IN: the 3 flows + `verifyJwtJwks` RS256. OUT: SMS/OTP (needs SMS dep); the email SENDER itself (injected — a separate thin `stdlib/email` is BaaS #8); OIDC discovery auto-fetch (v1 takes an explicit `jwksUrl`); non-RS256 algs (ES256/PS256 — follow-on); rate-limit integration (`createRateLimiter` exists; compose at the caller).

---

# COMMIT DISCIPLINE (S83 — both sides matter)
- Commit INCREMENTALLY per sub-feature (verifyJwtJwks → commit; flows → commit; tests → commit) — your branch is your crash-recovery anchor. Don't batch.
- After EVERY edit: `git -C "$WORKTREE_ROOT" diff <file>` to verify → `git -C "$WORKTREE_ROOT" add <file>` → commit immediately.
- Before you report DONE: `git -C "$WORKTREE_ROOT" status --short` MUST be clean (no uncommitted changes). "work in worktree, no commits" is NOT an acceptable terminal state.
- Run the **FULL** `bun --cwd "$WORKTREE_ROOT" run test` (NOT just `bun test`) before reporting DONE — 0 failures is the contract. If a pre-existing env-floor browser-whitespace failure appears (~7 on some machines), note it but it is not yours.

# REPORT FORMAT (final message = raw data for the PA, not prose-for-a-human)
Report: `WORKTREE_PATH`, `FINAL_SHA`, `FILES_TOUCHED` (list), the full-suite pass/fail counts, a per-acceptance-criterion PASS/FAIL line (alg-pinning · single-use · purpose-binding · enumeration-neutral · exp/nbf · kid-rotation), any deferred/OUT items, and the Maps feedback line. You CANNOT run `/code-review` in-agent (it is not available in the sub-agent environment) — do a thorough self-review + name any spots you're unsure about; the PA runs the adversarial `/code-review` on your diff before landing (S239).

# WHAT NOT TO DO
- Do NOT touch compiler source (`compiler/src/`) — this is stdlib + runtime-shim only.
- Do NOT `--no-verify`.
- Do NOT add a built-in mailer, SMS, OIDC-discovery, or non-RS256 algs (out of scope).
- Do NOT dispatch JWT verification off the token's own `alg` (the alg-confusion footgun).
- Do NOT write to any path outside `$WORKTREE_ROOT`.
