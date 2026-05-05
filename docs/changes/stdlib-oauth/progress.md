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
- [T7] Committed all 5 module files (dc6f0c6).
- [T8] stdlib-oauth.test.js — 38 tests, all pass first run, including RFC 7636 Appendix B vector (verifier `dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk` -> challenge `E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM`).
- [T9] stdlib-oauth-presets.test.js — 20 tests, all pass first run.
- [T10] Tests committed (61d05c5).
- [T11] Kickstarter v2 §9 catalog — added `scrml:oauth` row.
- [T12] Kickstarter v2 §11.2.1 — added OAuth recipe with sign-in-with-Google example using scrml:redis storage adapter; documented typed error names; documented refresh-token rotation note.
- [T13] Final commit (kickstarter update + final summary).
- STATUS: COMPLETE — final commit 898b86e on branch changes/stdlib-oauth.

## Final summary

**Branch:** changes/stdlib-oauth (4 commits ahead of main)
**Final SHA:** 898b86e

**Commits:**
- c93ceba — WIP pkce.scrml
- dc6f0c6 — WIP core API + 4 provider presets
- 61d05c5 — WIP unit tests (58 passing)
- 898b86e — final: catalog row + recipe (kickstarter §9 + §11.2.1)

**Test posture:**
- 58 new unit tests (38 core + 20 presets); all pass.
- Full pre-commit suite (unit + integration + conformance, 8028 tests) passes.
- RFC 7636 Appendix B PKCE test vector verified.

**Files added (8):**
- stdlib/oauth/index.scrml
- stdlib/oauth/pkce.scrml
- stdlib/oauth/google.scrml
- stdlib/oauth/github.scrml
- stdlib/oauth/microsoft.scrml
- stdlib/oauth/discord.scrml
- compiler/tests/unit/stdlib-oauth.test.js
- compiler/tests/unit/stdlib-oauth-presets.test.js

**Files modified (1):**
- docs/articles/llm-kickstarter-v2-2026-05-04.md (§9 catalog row + §11.2.1 OAuth recipe)

**Exports added (top-level scrml:oauth):**
- Core: `startFlow`, `exchangeCode`, `refreshToken`, `getUserInfo`, `revoke`, `memoryAdapter`
- PKCE: `generateVerifier`, `deriveChallenge`, `PKCE_METHOD`
- Presets: `googleConfig`, `parseGoogleIdToken`, `githubConfig`, `microsoftConfig`, `discordConfig`

**Open questions (per brief §12):**
1. parseGoogleIdToken — implemented WITHOUT signature verification (decode only). Documented in source. JWKS-verification is deferred to v0.3.0.
2. Token storage — module returns tokens; caller persists. (As PA leaned.)
3. OIDC discovery (RFC 8414) — not implemented. Should be logged in roadmap.
4. Storage adapter shape verification — implemented (`_assertStorage` runs at startFlow / exchangeCode entry).
