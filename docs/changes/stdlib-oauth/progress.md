# Progress — stdlib-oauth

Append-only timestamped log.

- [T0] 2026-05-04 — branch `changes/stdlib-oauth` created from main (HEAD 9cb123c). Tier 3 stdlib commit f700116 confirmed as ancestor of HEAD. stdlib/redis, stdlib/cron, stdlib/regex, stdlib/auth, stdlib/http, stdlib/crypto all present.
- [T0] Read brief in full; canonical sources: stdlib/auth, stdlib/http, stdlib/crypto, stdlib/redis, stdlib/regex; PA primer; anti-patterns; kickstarter v2 §9 + §11.2.
- [T0] Plan:
  1. Write stdlib/oauth/pkce.scrml (PKCE verifier/challenge — RFC 7636).
  2. Write stdlib/oauth/index.scrml (core API + memoryAdapter, re-exports).
  3. Write stdlib/oauth/google.scrml.
  4. Write stdlib/oauth/github.scrml.
  5. Write stdlib/oauth/microsoft.scrml.
  6. Write stdlib/oauth/discord.scrml.
  7. Write compiler/tests/unit/stdlib-oauth.test.js (core + PKCE shape + RFC 7636 vector).
  8. Write compiler/tests/unit/stdlib-oauth-presets.test.js (provider preset shape).
  9. Update kickstarter v2 §9 catalog row + §11.2 OAuth example.
  10. Final commit.

- [T1] pkce.scrml committed (c93ceba) — generateVerifier, deriveChallenge, PKCE_METHOD, _base64UrlEncode internal.
- [T2] index.scrml written — startFlow, exchangeCode, refreshToken, getUserInfo, revoke, memoryAdapter; re-exports providers + PKCE; storage adapter validation.
- [T3] google.scrml — googleConfig + parseIdToken (unverified JWT payload decode).
- [T4] github.scrml — githubConfig (classic OAuth Apps; revocationUrl unset, documented).
- [T5] microsoft.scrml — microsoftConfig (tenant-scoped; offline_access for refresh).
- [T6] discord.scrml — discordConfig (identify+email default).
- [T7] Committing all 5 module files together (next).
