# auth.map.md
# project: scrml
# updated: 2026-08-09T15:20:00-06:00  commit: 616688ea
# **PARTIALLY RE-WALKED over `35d4d32e` -> `616688ea`.** Ancestry CHECKED (invariant 48). The §20.5
# session surface, `compute-program-config.ts`, and the `scrml:auth`/`scrml:oauth` stdlib modules are
# **ZERO-DIFF this window** (`stdlib/` has no diff at all), so every session/JWT/OAuth/CSRF claim
# below is carried and re-verified, not re-derived.
#
# **ONE CONFIDENTIALITY SURFACE DID MOVE, AND IT IS A NEW COMPILE-TIME REFUSAL: `E-DERIVED-SERVER-ONLY-REACH`
# (§6.6.19, #486).** A `const <name>` DERIVED cell whose RHS reaches a binding imported from
# `scrml:auth` / `scrml:crypto` / `scrml:oauth` (or any other `ESCALATION_SERVER_ONLY_MODULES`
# member) is now REFUSED at compile time. **Before it, that exact shape compiled at exit 0 with NO
# `.server.js`, `const { hashPassword } = _scrml_stdlib.auth;` in the client bundle, and a real
# `Bun.password.hash` argon2id implementation in the shipped browser runtime** — measured S331, and
# it is the same symptom the S299 Trigger-3 amendment was written to close.
#
# **THE SCOPE SENTENCE MATTERS MORE THAN THE FIX. §12.2 escalation is defined PER-FUNCTION and covers
# NO OTHER POSITION.** §12.4's "route inference SHALL be per-function" is honoured literally by
# `collectFileFunctions`, which yields `function-decl` nodes only. §6.6.19 closes ONE non-function
# position. **Two remain OPEN and undiagnosed on this same confidentiality boundary:** a plain
# mutable-cell initialiser (`<hashed> = hashPassword(@pw)`) and a markup interpolation
# (`${ hashPassword(@pw) }`). Both reach the same module from the same client position. **The
# diagnostic's own text warns that deleting the `const` — the shortest edit that silences it — is
# exactly the edit that restores the leak.** Do not read this landing as closing the class.
#
# Carried and still true: #452's `Object.hasOwn` hardening of the session accessor (`emit-server.ts`)
# closed the PROTOTYPE-CHAIN half of `g-session-get-reserved-key-read-disclosure` and left the own-key
# READ POLICY open (ROUTED TO BRYAN); #460 gave §12.5's route-handler `Response` contract a normative
# SPEC home. **Read the "Session read-side" block before touching the accessor — the ledger entry has
# still not caught up (non-compliance.report.md).**

scrml has THREE distinct auth-adjacent surfaces: (1) the compiler's own `<program auth=...>` declarative config that the codegen wires into emitted apps, (2) the `scrml:auth` / `scrml:oauth` stdlib modules an author imports for flow logic, and (3) the §20.5 `session` server builtin (NEW this window — the write half of the session model, landed in two passes). This map covers all three, plus the §14.8.9 protect-floor that backstops them, plus the §64.9 headless-target auth carve-out.

## Strategy
Type: session-cookie auth (declarative, `<program>`-attribute driven, now backed by a compiler-owned `session` server builtin) + stdlib JWT (HS256 self-signed) + JWKS RS256 (external-IdP verification) + OAuth2 (5 providers) + magic-link/email-verify/password-reset (token-store flows).
Library: no external auth package — hand-rolled on Bun Web Crypto (`crypto.subtle`) + Bun's `Bun.password` (argon2).
Config: `<program auth="required|optional" login-redirect=... csrf="auto|on|off" session-expiry="1h" session-secure="true|false">` attributes. **NOTE — three separate, non-unified config shapes** (a pre-existing architecture, not introduced this window): `compute-program-config.ts`'s own `AuthConfig` interface [:28] (ProgramConfig-level, `{auth, loginRedirect, csrf, sessionExpiry, sessionSecure}` — `sessionSecure` is the raw `"true"`/`"false"` string), `route-inference.ts`'s `AuthMiddleware` interface [:294] (route-inference OUTPUT, `sessionSecure?: boolean` coerced), and `types/ast.ts`'s own `AuthConfig` [:1503] (the FileAST-level copy consumed elsewhere, `{auth, loginRedirect, csrf, sessionExpiry}` — did NOT gain `sessionSecure` this window). Codegen (`emit-server.ts`) reads the `AuthMiddleware` entry OR, for a no-auth session app, the raw `session-secure` attribute directly off the `<program>`/`<page>` node.

## §20.5 `session` server builtin (NEW this window — S265/S266, i29e/#29-E, #99 + #104)

The write half of the session model: a server function can now `session.set(key, value)` / `session.destroy()` in addition to the pre-existing read-only `@currentUser`/`@session` projections. `session` is a RESERVED identifier bound into scope automatically inside a server-escalated function body (`type-system.ts`'s `annotateNodes`, `scopeChain.bind("session", ...)` when `boundary === "server"`) — referencing `session` also AUTO-ESCALATES the enclosing function to server (mirrors the SSE `route` auto-injection and the §38.6 channel-builtin injection).

**API surface** (§20.5, compiler/SPEC.md:14566-14571):
| Member | Type | Purpose |
|---|---|---|
| session.userId | string \| not | authenticated user ID, `not` if not logged in |
| session.isAuth | boolean | true if the request carries a valid session |
| session.role | string \| not | authenticated user's role, `not` if unset |
| session.get(key) | any | retrieve a custom session value |
| session.set(key, v) | void | store a custom session value (reserved-key guarded, see below) |
| session.destroy() | void | end the session (delete record + clear cookie) |

`session` has NO per-member type refinement yet (`asIs` at the type level) — a developer must narrow before use.

**Cookie mechanism** (`compiler/src/codegen/emit-server.ts`): `_secureCookieMode` (`authMiddlewareEntry.sessionSecure !== false && !== "false"`, default true) decides `_sessionCookieName`: secure mode -> `__Host-scrml_sid` (browser-enforced: forbids Domain attribute + requires Secure + Path=/), always emitted `Secure`; opt-out (`session-secure="false"`) -> plain `scrml_sid`, no `Secure` (for a conscious TLS-less deployment, e.g. a bare-http LAN mesh). The reader (`_scrml_read_session_id`) is MODE-GATED to the mode-appropriate cookie name ONLY — no cross-name fallback (closing a cookie-tossing / session-fixation vector where a sibling subdomain sets the plain name to force-auth a visitor into an attacker session). `_scrml_session_begin(req)` loads the incoming session record; TTL is `session-expiry`-derived `_scrml_session_max_age` (seconds), threaded into both the cookie `Max-Age` and the durable-store TTL. `_scrml_warn_insecure_cookie` (secure mode only) logs a once-per-process warning when a Secure cookie is set over bare http on a non-local host.

**Reserved-key guard (B5).** `session.set("csrfToken", …)` writes the compiler-owned §40.2 CSRF synchronizer-token key — a literal write is a COMPILE ERROR (`E-SESSION-RESERVED-KEY`, fired in `codegen/emit-expr.ts:emitCall`); a dynamic-key write with a runtime `"csrfToken"` key is refused at RUNTIME as a no-op by `_scrml_session_begin`'s setter guard. `userId`/`role` and preference keys remain writable.

**Context gate.** `session.*` is valid ONLY inside a web-app server route-handler function body — an SSE `server function*`, an `<endpoint>` arm, a `<machine>` method, a serverLoad cell, an in-process server-fn helper, or a headless `kind="tool"` program have no cookie-session request/response context and fire `E-SESSION-CONTEXT`. A bare `session` VALUE-use (returned/assigned/passed as an argument rather than accessed via member/index/call) fires `E-SESSION-VALUE`. A `session` reference outside ANY server-escalated body (client-side, bare top-level `${ }`) fires `E-SCOPE-012` (reserved -> LIVE this window) — client-side session display uses the `@session` projection instead. See error.map.md for all four codes.

**Landed in two passes** (both PA-run adversarial S239 gates each caught HIGH auth holes a green suite shipped — see hand-off.md/changelog.md for the full narrative, not reproduced here): (1) the base primitive (`1e63bbb1`, #99) — an unanchored cookie-parse fix (5 sites, was session-fixation + logout-DoS), 5 context-gate false-negatives closed (`session["k"]`, `session?.x`, `session?.set()`, bare `session`, file-scope shadow), role decoupled from auth. (2) pass-2 hardening (`510cef8d`, #104) — the `__Host-`/`session-secure=` opt-out + the reserved-key guard (B4/B5) described above, PLUS a coordinator-found cross-name-fallback re-open fixed in the same pass (see "Cookie mechanism" above).

## §20.5 SESSION — the handler-prologue binding is a PROXY, and that is a confidentiality decision (NEW #435, GH #357)

**A `session` reference that survives into EMITTED TEXT needs an in-scope `session`, or it is a free
variable -> HTTP 500 `ReferenceError` on every authenticated call.** The shape that got there: a
`?{ … ${session.userId} … }` SQL interpolation carries its query as a **STRING** — params are captured
verbatim and rewritten only for `@name` sigils — so `session` in it is sigil-less AND invisible to the
emit-expr member/index lowering that handles every other `session.*` use. Adopter-reported as GH #357.

Three parts landed together in `emit-server.ts`:
1. **`_SESSION_BARE_TEXT_RE`** — the shared text-level detector, `/(^|[^\w$.])session\s*[.[]/`. **The
   left-guard `[^\w$.]` is load-bearing**: it stops `_scrml_session_store`, `sessionId`,
   `_scrml_read_session_id` and `_scrml_req._scrml_sess` from matching. No `g` flag (stateless for
   repeated `.test()` in emitter loops).
2. **`astSqlQueryUsesSession`**, ORed into `_anySessionBuiltin` so an interpolation-only use FORCES the
   session infra on (store, cookie wrap, prologue binding). Permissive by design — a false positive
   only emits unused infra.
3. **A conditional handler-scope SPLICE** of `const session = _scrml_session_bind(_scrml_req._scrml_sess)`,
   at the same insertion point as the `@currentUser` binding (so it is visible inside the nested
   `_scrml_result` IIFE the baseline-CSRF path emits), `_webAppShape`-gated.

**The binding SHALL be the Proxy, NEVER `const session = _scrml_req._scrml_sess`.** That object is an
accessor: getters `userId`/`role`/`isAuth`, methods `get`/`set`/`destroy`, **and RAW own-properties
`sid`/`_rec`/`_changes` — where `_rec` holds the full stored record INCLUDING the §40.2 `csrfToken`.**
A raw bind would turn the dynamic-key form into a raw property read at the wrong level:
`session["sid"]` discloses the live session id and `session["_rec"]` the whole record plus the CSRF
token, **at HTTP 200** — the exact defeat of the synchronizer-token defense this compiler owns. It
would also make `session[customKey]` read `undefined` instead of the record value.

The Proxy preserves BOTH accessor shapes so the bare binding **AGREES with the AST lowering, which is
KEPT** (three security gates match the literal `_scrml_req._scrml_sess.`; retiring it for a bare bind
blinds them):
| access | routes to |
|---|---|
| `session.userId` / `.role` / `.isAuth` | the getter (reads `_rec` via `this`) |
| `session.set` / `.get` / `.destroy` | the bound method |
| every OTHER key — `.customKey`, `[expr]` | `.get(key)` -> **`Object.hasOwn(_rec, key) ? (_rec[key] ?? null) : null`** — OWN-PROPERTY only since #452 (see below) |

Two implementation facts that are load-bearing, not stylistic: **`Reflect.get(t, k, t)` uses the TARGET
as receiver** (the getters read `this._rec`; a Proxy receiver re-enters the trap on `_rec` -> `t.get("_rec")`
-> null -> TypeError), and **`set()` returns false** so an assignment through the binding is a loud
strict-mode TypeError rather than a silent shadow write to the session object. Symbol keys pass through.

### Session read-side — TWO OPEN gaps, both ROUTED TO BRYAN. Read before touching the accessor.

- **`g-session-get-reserved-key-read-disclosure` (MED — re-scored from HIGH S325; still open, still
  ROUTED-TO-BRYAN). ⚠ THIS ENTRY MOVED TWICE THIS WINDOW AND THE LEDGER RECORDS ONLY ONE OF THE MOVES.**
  - **What is now CLOSED (silently, as a side-landing of #452):** the PROTOTYPE-CHAIN read. `get(key)`
    is `Object.hasOwn(this._rec, key) ? (this._rec[key] ?? null) : null` at `emit-server.ts:2593`.
    Pre-fix and MEASURED on the emitted helper: `.get("__proto__")` returned `Object.prototype`, and
    `.get("constructor")` / `.get("toString")` / `.get("hasOwnProperty")` / `.get("valueOf")` /
    `.get("isPrototypeOf")` each returned a FUNCTION — `_rec` is `{ ...rec }`, a plain object, so the
    whole `Object.prototype` surface was reachable from a request-controlled key. A function value
    flowing into a `?{ … ${session.get(k)} … }` bind was an **HTTP 500 SQL TypeError reachable from a
    request parameter**; that is closed too. **`Object.hasOwn` and NOT `this._rec.hasOwnProperty(key)`
    is load-bearing:** `_rec` is built from `session.set` writes, so it can carry an own key literally
    named `hasOwnProperty`, which would shadow the method on the one record that attacks it. This is
    the entry's own remediation candidate **(iii)** — *"`hasOwnProperty` + prototype guard only, no key
    policy … arguably a plain bug fix needing no ruling"*, annotated *"(iii) is separable and should not
    wait on the ruling"*. It did not wait. **The ledger entry does not say so** — its `locus=` still
    reads `:2568(accessor .get — \`return this._rec[key] ?? null\`, no allowlist/denylist/hasOwnProperty)`
    and its prose still asserts *"`.get()` is one line — `return this._rec[key] ?? null` — with no
    allowlist, denylist, or `hasOwnProperty`"*. **Both are false at this HEAD.** See
    non-compliance.report.md S326-N2.
  - **What is still OPEN, and it is the part that needs a ruling:** the OWN-KEY read policy. Every own
    key of `_rec` is still readable by an attacker-chosen key — including the compiler-owned §40.2
    `csrfToken`, and including any adopter-written secret (`apiKey` came back verbatim as
    `sk-live-PROBE-SECRET-9f3c`). The §20.5 reserved-key guard is **WRITE-side only**
    (`session.set("csrfToken", …)` -> `E-SESSION-RESERVED-KEY`; a dynamic-key runtime write is a no-op).
    The question bryan owes is *should a request-controlled key reach a session read at all* — not
    "read-null vs error on csrfToken". The `csrfToken`-denylist framing is **security theater for the
    same-origin threat model and the map should not repeat it**: the compiler already publishes that
    token same-origin through three measured channels (`GET /_scrml/session`, un-auth'd and un-CSRF'd;
    the `<meta name="csrf-token">` SSR tag; a non-`HttpOnly` `scrml_csrf` cookie on the 403 retry). A
    synchronizer token MUST be same-origin readable — that IS the mechanism.
  - **REACHABILITY CHANGED this window and the direction is worse, not better.** Before #452 the
    `auth=` shape of this leak reached **no wire at all** — a bare handler return produced Bun's
    constant welcome page and the value went only to stderr. #452 fixes that by design and thereby takes
    this leak **from log-only to WIRE-LIVE**: MEASURED, `server function peek(k) { return { v:
    session.get(k) } }` under `auth="required"` returns `{"v":"<live csrf token>"}` at 200
    `application/json`, key taken from the request body. **Severity stayed MED deliberately** — a
    reachability change makes an entry more REAL, not more SEVERE, and the attacker model is unchanged
    (same-origin XSS or an adopter echoing a request-controlled key; POST-only; CSRF-gated;
    `Access-Control-Allow-Credentials` is never emitted anywhere in the compiler).
- **`g-session-context-scan-bare-form-sound` (MED, open).** `E-SESSION-CONTEXT`'s scan was widened to
  match the new bare form during #435, **regressed §20.5 conformance** (it string-matched the compiler's
  own emitted comments and generated guards), and was **TRIMMED before landing** — caught by the PA
  adversarial fix-vs-prefix pass after the agent had reported clean. The sound implementation needs a
  **lowering-site RECORD, not a text scan**, and it is a newly-REJECTING surface, so it is bryan's call.

## §52.15.1 `@currentUser` + `<channel auth=>` — the DANGLING-REFERENCE class (NEW #440)

Same class as #357: **a runtime reference emitted with its binding/definition gated NARROWER than the
reference.** Compiles clean, zero diagnostics, `ReferenceError` -> HTTP 500 at request time.

- **`@currentUser` in a plain or SSE handler.** §52.15.1 says the ambient is resolved server-side from
  the session middleware, so a read REQUIRES the resolver. `_needsSessionInfra`'s detector matched only
  the `?{ … @currentUser … }` SQL shape, so a DIRECT expression read (`return { id: @currentUser.id }`,
  lowered to `IdentExpr{name:"@currentUser"}`) in an app with no `auth=`, no serverLoad and no `?{}`
  left `_scrml_current_user` unemitted while the handler splice still bound it. **`astReadsCurrentUserAmbient`**
  is the superset that catches both lowerings. The §36 SSE `function*` path additionally never spliced
  the binding at all — now spliced at handler scope before the nested generator closure, byte-identical
  construction to the route-handler path.
- **`<channel auth=>` with no `<program auth>`.** The WS-upgrade guard references `_scrml_auth_check(req)`,
  which calls `_scrml_session_middleware(req)`; both definitions were gated on `authMiddlewareEntry`, so
  a channel-auth-only program dangled the reference and 500'd at upgrade. `_hasChannelAuth` now forces
  `_needsSessionInfra`, and an `else if` arm emits **ONLY** the auth-check function — never the CSRF
  helpers, session-destroy, or the `@session`-projection routes, which stay `<program auth>`-specific.
  A channel-auth-only program's route surface is byte-identical to before. `loginRedirect` uses the RI
  default `/login` since no auth middleware supplies one.

**The store invariant was PROBED, not assumed:** widening `_needsSessionInfra` does NOT over-emit. A
read-only `@currentUser` program emits the in-memory Map + middleware + resolver and **not** the durable
on-disk store (§20.5 i29e — only an app that actually `session.set`/`.destroy`s gets the durable store).
Conformance fix-vs-prefix **1443/0** from a fresh PA process, executed handlers 500 -> 200.

**Standing rule for this family: every detector is PERMISSIVE BY DESIGN — a false POSITIVE only emits
unused session infra; a false NEGATIVE re-opens a 500.**

## `<program>`-level declarative auth config
| Field | Values | Purpose |
|---|---|---|
| auth | "required" \| "optional" | gates the whole program |
| loginRedirect | path string | unauthenticated redirect target |
| csrf | "auto" \| "on" \| "off" | CSRF middleware mode — see below |
| sessionExpiry | duration string ("1h","2h") | session cookie TTL |
| session-secure (NEW this window) | "true" \| "false" (default "true") | `__Host-scrml_sid`+always-Secure vs plain `scrml_sid`+no-Secure; registered on BOTH `<program>` and `<page>` (attribute-registry.js, html-elements.js) |

Companion `MiddlewareConfig` (types/ast.ts:1515): cors, log, ratelimit, headers, idempotencyStore, idempotencyTTL. Both extracted from `<program>` attributes by ast-builder.js/compute-program-config.ts and consumed by auth-graph.ts + codegen/emit-server.ts.

## §64.9 headless serve-target carve-out
A `<program kind="tool" serve=PORT>` (§64.9, the listener-owning headless serve-harness — see domain.map.md) has NO cookie session. Program-level `auth="required"`/`"optional"` OR a per-channel `<channel auth="required"/"optional">` on a `serve=` tool is **E-TOOL-SERVE-AUTH-UNSUPPORTED** — fail-closed rejected at compile time rather than silently emitting an unguarded route/WS-upgrade. Bearer-token auth for headless targets is explicitly a later (unimplemented) unit. The NEW `session` builtin is likewise unreachable from a `serve=` headless body (E-SESSION-CONTEXT).

## scrml:auth stdlib module (stdlib/auth/, compiler/runtime/stdlib/auth.js)
| File | Exports | Notes |
|---|---|---|
| flows.scrml | requestMagicLink/verifyMagicLink, requestEmailVerify/verifyEmailVerify, requestPasswordReset/verifyPasswordReset | request*/verify* pairs; single-use (get-then-delete) tokens; namespace-per-purpose store keying prevents cross-purpose replay; neutral `{ok:true}` responses regardless of address validity (enumeration resistance); caller injects the mailer, no built-in SMTP |
| jwt.scrml | signJwt/verifyJwt (HS256, Bun crypto.subtle), verifyJwtJwks (RS256 against a `.well-known/jwks.json` URL — alg-pinned BEFORE any JWKS fetch to prevent alg-confusion), decodeJwt (pure) | server-only by inference (importing scrml:auth escalates the caller, §12.2 Trigger 3) except decodeJwt. `secret` is ALWAYS a caller-supplied argument — this compiler repo has no env-var-based signing secret of its own (see config.map.md correction) |
| password.scrml | hashPassword/verifyPassword (Bun.password argon2id), generatePassword(length, opts) | generatePassword uses REJECTION SAMPLING over crypto.getRandomValues for uniform charset selection; pure, browser-safe |
| templates/login.scrml | scaffolded `scrml generate` login page | inline server fn (cross-file `?{}`-using server fns can't cross a file boundary) |

## scrml:oauth stdlib module (stdlib/oauth/, compiler/runtime/stdlib/oauth/)
Providers: discord, github, google, microsoft (each a thin provider-specific wrapper) + pkce.scrml (PKCE code-verifier/challenge generation, shared by all 4). Unchanged this window; distinct from the §20.5 session-establishment primitive (OAuth verifies identity, session.set persists it).

## Server-only-stdlib client leak — the placement backstop, and the ONE position it now refuses (§12.2 Trigger 3 / §6.6.19)

**This is a CONFIDENTIALITY boundary, not a performance one, and the whole design follows from which
direction is safe to be wrong in.** `ESCALATION_SERVER_ONLY_MODULES` (`route-inference.ts:656`) is
the placement set — **NOT** `SERVER_ONLY_SCRML_MODULES` (`:579`), which feeds async classification
where over-inclusion is free. Members and the limb each satisfies:

`scrml:auth` (a: `Bun.password` argon2id) · `scrml:crypto` (a: `Bun.CryptoHasher`, `Bun.password`) ·
`scrml:cron` (a) · `scrml:fs` (a: `node:fs`) · `scrml:process` (a) · `scrml:redis` (a: the **BARE**
`bun` specifier, no colon — a `bun:`-only scan misses it) · `scrml:store` (a: `bun:sqlite`) ·
`scrml:path` (a) · `scrml:mcp` (a, host surface in the `.js` shim) · **`scrml:oauth` (b:
CREDENTIAL HANDLING — zero host reach, but it puts `client_secret` in the token-exchange body three
times and its own header reads "SERVER-SIDE ONLY")**.

**Limb (b) exists because a host-reach-only criterion was FALSIFIED in review inside the same
session.** `scrml:oauth` was cleared as client-safe on the reasoning that PKCE lets the flow run in a
browser — true of the public-client half of a module that ships both halves. A clean compile shipped
a real client secret into the browser bundle. **The criterion was the defect, not the list.** The
normative criterion sits ABOVE the list in SPEC on purpose: a hand-maintained derived list rots
silently and nothing fails when it does. **Re-evaluate the criterion rather than editing the list
from memory, and when a module resists classification, prefer the server** — over-inclusion costs a
round trip, under-inclusion ships a secret to a browser.

**When the trigger FIRES it emits NO diagnostic, and that is by design.** A function silently moving
to the server is the SUCCESS path. "My function vanished from the client bundle and there are zero
errors and zero warnings" is the expected shape, not a bug report.

**The position it CANNOT reach, and what happens there now.** §12.4 makes route inference
per-function, so a non-function position is not reached by the trigger at all:

| Position | At `616688ea` |
|---|---|
| `function` body | escalates (Trigger 3), silently, no diagnostic |
| `const <name> = …` **derived cell** RHS | **REFUSED — `E-DERIVED-SERVER-ONLY-REACH` (§6.6.19, #486).** Not escalated: a derived recompute is synchronous lazy-pull (§6.6.3) and cannot become a round trip |
| `<name> = …` **mutable-cell initialiser** | **OPEN — leaks, no diagnostic** |
| **markup interpolation** | **OPEN — leaks, no diagnostic** |

Reach is **REFERENCE, not call**, at ANY depth — inside a lambda, a nested `function` decl, or
escape-hatch raw text. Matching only top-level CALLS was proven evadable four ways, each shipping the
module and its secrets to the browser at exit 0: `["PEPPER"].map(p => hashPassword(p))`, a nested
`function` decl, a bare callback reference, and `let f = hashPassword; f(x)`. **On a confidentiality
boundary, over-firing costs a relocation and under-firing costs a leak.** Accepted residuals, named
rather than hidden: a binding shadowed ONLY inside a nested lambda still fires, and a word-boundary
scan of escape-hatch raw text can match inside a string literal in that text — both over-fires.

**`kind="tool"` programs (§64) are carved out of the §6.6.19 refusal** — no client boundary, no leak
— mirroring the carve-out Trigger 3 already takes for `print()`/`println()`.


## Protected-field egress backstop (§14.8.9, NOT stdlib — compiler-enforced)
`<db src=... protect="col1,col2">` (or `authority=` collections) marks columns that must never reach the client bundle. Enforced by `compiler/src/protect-analyzer.ts` (PAError) at analysis time and `compiler/src/codegen/egress-field-scan.ts` (E-CG-001) as an acorn-EXACT, fail-closed backstop at emit time.

## Historical: jwt-auth-bypass (2026-07-11, fixed, carried for context)
`scrml:auth/jwt`'s exports were silently dropped at compile in a specific comment-shape case, so the async-export seed never saw them → misclassified sync → a server fn emitted `verifyJwt(...)` UNAWAITED → the always-truthy Promise defeated `if (!result.valid)` → accept-all auth bypass. Both parser root causes are fixed; the standing defense-in-depth is api.js's STDLIB-EXPORT-SEED (fails CLOSED on any unresolvable server-only `scrml:*` re-export — see dependencies.map.md). No auth-surface API change.

## CSRF
`<meta>` synchronizer token + `/_scrml/session` projection. `csrf="auto"` (default) emits `_scrml_get_csrf_token()` (SameSite=Strict double-submit cookie) + `_scrml_fetch_with_csrf_retry` client helpers when the program has no explicit auth middleware entry (codegen/emit-client.ts). Not applicable to a §64.9 headless `serve=` target (no cookie session at all). The §20.5.1 `csrfToken` session key (above) is the SAME synchronizer token, now also protected against a literal-write mass-assignment bypass.

## Token Lifecycle
Issued: JWT via `signJwt` (HS256, server-only) or an external IdP (RS256, verified not issued by this compiler); the §20.5 session record is issued by `_scrml_session_begin` on first authenticated request.
Validated: `verifyJwt` (HS256, local secret) or `verifyJwtJwks` (RS256, fetches + caches the IdP's JWKS, algorithm pinned); the session cookie is validated by mode-gated exact-name cookie match + durable-store lookup.
Refresh: not implemented in stdlib — caller-managed. Session TTL is `session-expiry`-driven, not silently refreshed on activity.
Expiry: `sessionExpiry` on `<program>` for the session cookie `Max-Age` + durable-store TTL; JWT `exp` claim is caller-set at sign time.
Magic-link/verify/reset tokens: TTL-bound (caller-supplied, embedded in the stored record as an authoritative `expiresAt`), single-use, namespace-scoped.

## Tags
#scrml #map #auth #baas #jwt #jwks #oauth #csrf #magic-link #password-reset #e-cg-001 #protect-floor #stdlib-auth #server-shape #tool-serve #jwt-auth-bypass #session-establishment #session-secure #host-cookie #e-scope-012 #e-session-context #e-session-value #e-session-reserved-key #gh357 #session-proxy-bind #scrml-session-bind #reflect-get-target-receiver #sql-interpolation-session #csrf-token-disclosure #session-read-side #dangling-ref-class #ast-reads-current-user-ambient #sse-currentuser-splice #channel-auth-only #scrml-auth-check #permissive-by-design #store-invariant-probed #§52.15.1 #§20.5 #object-hasown #own-property-read #prototype-chain-read-closed #hasownproperty-shadow #read-side-policy-open #wire-live #response-contract #security-theater-vs-defense #ledger-locus-stale #§6.6.19 #e-derived-server-only-reach #escalation-server-only-modules #two-limb-criterion #credential-handling-limb #oauth-client-secret #criterion-not-the-list #per-function-scope-only #two-positions-still-open #mutable-cell-initialiser-open #markup-interpolation-open #reference-not-call #four-evasions #over-fire-not-leak #kind-tool-carve-out #no-diagnostic-when-it-fires

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [domain.map.md](./domain.map.md)
- [error.map.md](./error.map.md)
- [dependencies.map.md](./dependencies.map.md)
- [schema.map.md](./schema.map.md)
