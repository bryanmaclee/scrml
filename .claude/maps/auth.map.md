# auth.map.md
# project: scrml
# updated: 2026-07-14T18:58:34-06:00  commit: f079d0a9

scrml has TWO distinct auth surfaces: (1) the compiler's own `<program auth=...>` declarative config that the codegen wires into emitted apps, and (2) the `scrml:auth` / `scrml:oauth` stdlib modules an author imports for flow logic. This map covers both, plus the §14.8.9 protect-floor that backstops both, plus the §64.9 headless-target auth carve-out (new this window).

## Strategy
Type: session-cookie auth (declarative, `<program>`-attribute driven) + stdlib JWT (HS256 self-signed) + JWKS RS256 (external-IdP verification) + OAuth2 (5 providers) + magic-link/email-verify/password-reset (token-store flows).
Library: no external auth package — hand-rolled on Bun Web Crypto (`crypto.subtle`) + Bun's `Bun.password` (argon2).
Config: `<program auth="required|optional" login-redirect=... csrf="auto|on|off" session-expiry="1h">` attributes -> `AuthConfig` (compiler/src/types/ast.ts:1496, unchanged this window).

## `<program>`-level declarative auth config (AuthConfig, types/ast.ts:1496)
| Field | Values | Purpose |
|---|---|---|
| auth | "required" \| "optional" | gates the whole program |
| loginRedirect | path string | unauthenticated redirect target |
| csrf | "auto" \| "on" \| "off" | CSRF middleware mode — see below |
| sessionExpiry | duration string ("1h","2h") | session cookie TTL |

Companion `MiddlewareConfig` (types/ast.ts:1508): cors, log, ratelimit, headers, idempotencyStore, idempotencyTTL. Both extracted from `<program>` attributes by ast-builder.js and consumed by auth-graph.ts + codegen/emit-server.ts.

## §64.9 headless serve-target carve-out (NEW this window)
A `<program kind="tool" serve=PORT>` (§64.9, the listener-owning headless serve-harness — see domain.map.md) has NO cookie session. Program-level `auth="required"`/`"optional"` OR a per-channel `<channel auth="required"/"optional">` on a `serve=` tool is **E-TOOL-SERVE-AUTH-UNSUPPORTED** — fail-closed rejected at compile time rather than silently emitting an unguarded route/WS-upgrade. Bearer-token auth for headless targets is explicitly a later (unimplemented) unit.

## scrml:auth stdlib module (stdlib/auth/, compiler/runtime/stdlib/auth.js)
| File | Exports | Notes |
|---|---|---|
| flows.scrml | requestMagicLink/verifyMagicLink, requestEmailVerify/verifyEmailVerify, requestPasswordReset/verifyPasswordReset | request*/verify* pairs; single-use (get-then-delete) tokens; namespace-per-purpose store keying prevents cross-purpose replay; neutral `{ok:true}` responses regardless of address validity (enumeration resistance); caller injects the mailer, no built-in SMTP |
| jwt.scrml | signJwt/verifyJwt (HS256, Bun crypto.subtle), verifyJwtJwks (RS256 against a `.well-known/jwks.json` URL — alg-pinned BEFORE any JWKS fetch to prevent alg-confusion), decodeJwt (pure) | server-only by inference (importing scrml:auth escalates the caller, §12.2 Trigger 3) except decodeJwt. `secret` is ALWAYS a caller-supplied argument — this compiler repo has no env-var-based signing secret of its own (see config.map.md correction) |
| password.scrml | hashPassword/verifyPassword (Bun.password argon2id), generatePassword(length, opts) | generatePassword uses REJECTION SAMPLING over crypto.getRandomValues for uniform charset selection; pure, browser-safe |
| templates/login.scrml | scaffolded `scrml generate` login page | inline server fn (cross-file `?{}`-using server fns can't cross a file boundary) |

## scrml:oauth stdlib module (stdlib/oauth/, compiler/runtime/stdlib/oauth/)
Providers: discord, github, google, microsoft (each a thin provider-specific wrapper) + pkce.scrml (PKCE code-verifier/challenge generation, shared by all 4).

## Protected-field egress backstop (§14.8.9, NOT stdlib — compiler-enforced)
`<db src=... protect="col1,col2">` (or `authority=` collections) marks columns that must never reach the client bundle. Enforced by `compiler/src/protect-analyzer.ts` (PAError) at analysis time and `compiler/src/codegen/egress-field-scan.ts` (E-CG-001) as an acorn-EXACT, fail-closed backstop at emit time.

## HIGH-severity regression fixed this window: jwt-auth-bypass (2026-07-11)
`scrml:auth/jwt`'s exports (signJwt/verifyJwt/…) were silently dropped at compile in a specific comment-shape case, so the async-export seed never saw them → misclassified sync → a server fn emitted `verifyJwt(...)` UNAWAITED → the always-truthy Promise defeated `if (!result.valid)` → accept-all auth bypass. Root causes: (1) block-splitter.js scanned a `/* */` block comment char-by-char inside a `${}` logic context and mis-read a `Promise<string>` JSDoc tag as a tag-opener; (2) tokenizer.ts excluded a regex literal beginning with `=` (jwt.scrml's base64url padding strip) from regex detection, corrupting `base64urlEncode` and dropping every subsequent export. Both parser bugs are fixed; the standing defense-in-depth is api.js's STDLIB-EXPORT-SEED, which now fails CLOSED (defaults async) on any unresolvable server-only `scrml:*` re-export — see dependencies.map.md. No auth-surface API change; this strengthens JWT verification trustworthiness, doesn't alter it.

## CSRF
`<meta>` synchronizer token + `/_scrml/session` projection. `csrf="auto"` (default) emits `_scrml_get_csrf_token()` (SameSite=Strict double-submit cookie) + `_scrml_fetch_with_csrf_retry` client helpers when the program has no explicit auth middleware entry (codegen/emit-client.ts). Not applicable to a §64.9 headless `serve=` target (no cookie session at all).

## Token Lifecycle
Issued: JWT via `signJwt` (HS256, server-only) or an external IdP (RS256, verified not issued by this compiler).
Validated: `verifyJwt` (HS256, local secret) or `verifyJwtJwks` (RS256, fetches + caches the IdP's JWKS, algorithm pinned).
Refresh: not implemented in stdlib — caller-managed.
Expiry: `sessionExpiry` on `<program>` for the session cookie; JWT `exp` claim is caller-set at sign time.
Magic-link/verify/reset tokens: TTL-bound (caller-supplied, embedded in the stored record as an authoritative `expiresAt`), single-use, namespace-scoped.

## Tags
#scrml #map #auth #baas #jwt #jwks #oauth #csrf #magic-link #password-reset #e-cg-001 #protect-floor #stdlib-auth #server-shape #tool-serve #jwt-auth-bypass

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [domain.map.md](./domain.map.md)
- [error.map.md](./error.map.md)
- [dependencies.map.md](./dependencies.map.md)
