# auth.map.md
# project: scrml
# updated: 2026-08-27T17:17:26-06:00  commit: 0dd659a1
# generated-at: 0dd659a1 (S380 window, INCREMENTAL_UPDATE — mapper pass, not a full re-walk).
# Verified: `git merge-base --is-ancestor 48f0aaf8 0dd659a1` exits 0 (48f0aaf8 = wrap(s378), the prior
# map's effective content watermark); HEAD == origin/main == 0dd659a1 at write time.
#
# ⛑ **POST-WRITE RE-CHECK: the wrap landed mid-pass and `origin/main` advanced `ff4b37e5` -> `9f75061c`
# (`wrap(s383)`, #753). `git diff --stat ff4b37e5..9f75061c -- compiler/` is EMPTY — the wrap is
# docs-only — so the SOURCE STATE READ IS `ff4b37e5` and every anchor below holds byte-identically at
# `9f75061c`. Named here rather than re-stamping, for the same reason lines 3–4 were not moved.**
# ━━━ ⛑ S383/S384 SCOPED INCREMENTAL — LINES 3–4 **DELIBERATELY NOT MOVED** ━━━
#
# Re-checked against `origin/main` == HEAD == **`ff4b37e5`**. This is a CITATION pass over the auth
# surface, not a re-walk, so the stamp stays at `0dd659a1` (the S382 pattern).
#
# ⛑ **THE AUTH SURFACE IS BEHAVIOURALLY ZERO-DIFF THIS WINDOW — BUT `emit-server.ts` MOVED ANYWAY,
# AND EVERY ANCHOR IN THIS FILE SHIFTED +52. FIFTH consecutive window where this file's citations
# drift from a landing that has NOTHING to do with auth** (invariant 73, third occurrence in a row).
# The mover is #749's value-native map/set server runtime: an import at `emit-server.ts:45` and a
# ~40-line `localMapSetOptsFor` block at `:1644`, both landing ABOVE the whole auth/onion region.
# `select-request-onion.js`, `protect-analyzer.ts`, `auth-graph.ts`, `compiler/runtime/` and `lsp/`
# are all `--name-only` **EMPTY** over `0dd659a1..ff4b37e5`.
#
# ⛑ **`commands/dev.js` — RE-VERIFIED CURRENT, NOT STALE, AND NOT EDITED.**
# `git diff --stat c1f93dfb..ff4b37e5 -- compiler/src/commands/dev.js` is **EMPTY**. Every dev.js
# anchor in this file was re-executed against `ff4b37e5` and holds: `:32`, `:207`, `:215`, `:321`,
# `:325`, `:379`, `:394`-`:414`, `:447`, `:1150`, `:1294`, `:1511`.
#
# ⚑ **SCOPED RE-CHECK OVER `48f0aaf8..0dd659a1` (S380, 12 PRs) — the auth surface is NOT zero-diff
# this window: `emit-server.ts` (+12), `commands/build.js` (+58), `commands/dev.js` (+32, committed)
# all moved, all for ONE feature: §52.13 below.** Everything else in this file that predates this
# window was spot-checked against current HEAD only where the diff touched it; unrelated sections
# carry from the prior pass unchanged.
#
# **Four numeric citations in the §40.3 table were STALE, caused directly by the §52.13 insertion
# landing ABOVE every one of them in both `emit-server.ts` and `commands/build.js` — corrected
# in place, inline, rather than re-narrated:** row 2 (`:2934/:3093/:3230/:3247` -> `:2946/:3105/
# :3242/:3259`, +12 each), row 2b (`:511-525/:514/:521` -> `:567-581/:570/:577`, +56 each — the
# LARGER shift here is because row 2b sits below BOTH the §52.13 `discoverServerRoutes` block AND
# the `generateServerEntry` protectedDocs/import/registry blocks), row 3 (`284-302, 343-347` ->
# `299-317, 365-369`), row 4's `formatOnionConflict` anchor (`:381` -> `:399`, dev.js's
# `registeredProtectedDocs` decl adds ~8 lines above the mount block). Row 4's own `23, 179-200,
# 311-383` range needed only the tail corrected (`311-383` -> `320-401`) — `179-200` sits entirely
# ABOVE the dev.js insertion point and is untouched.
#
# ⚠ **PROVENANCE CAVEAT ON `commands/dev.js` — RESOLVED (dev.js citation-only pass, current HEAD
# `c1f93dfb`).** This caveat warned that the working tree carried an UNCOMMITTED local edit to
# `dev.js` on top of committed HEAD `0dd659a1`, and that the three anchors below (`:199`, `:366`,
# `:1019`) would need re-verification if it landed. **It landed — as PR #738 (adopter fix #724,
# merged `a9f03e91`, wrap `c1f93dfb`, now `origin/main` HEAD) — and is a full architecture rewrite,
# not the "module-cache-bust" tweak it was described as: Bun caches ESM by resolved path, so an
# in-process re-import of a recompiled `*.server.js` silently served STALE routes; `scrml dev` is
# now a stable parent reverse-proxy in front of a respawned CHILD app-process (`runDevChildServer`,
# `dev.js:1294`), never in-process.** Every `dev.js` anchor in this file is RE-VERIFIED against
# current HEAD `c1f93dfb` this pass and corrected below (§40.3 table row 4, §52.13 table row 3). The
# principle this caveat protects SURVIVES: dev mounts the SAME onion + SAME `registeredProtectedDocs`
# guard the built server does — no dev/prod split — only the process topology changed.
#
# generated-at: fc6df72e — **THE SAME SHA AS LINE 3, BY CONSTRUCTION.** The working tip at write time was
# `60803548` on branch `wrap/s376`; `git diff --name-only fc6df72e..60803548` returns FOUR DOCS FILES
# (`docs/changelog.md`, `hand-off.md`, `handOffs/delta-log.md`, `master-list.md`) and ZERO source, so
# the source state actually read IS `fc6df72e`, which is `merge-base HEAD origin/main` and IS `origin/main`.
# **Line 3 and line 4 carry one SHA on purpose** — at S372 a refresh bumped line 3 while line 4 still
# named an older `generated-at:`, a self-contradicting watermark the PA correctly refused to ship.
# ⚑ **S376-bryan: STAMP-ADVANCED ON MEASURED ZERO-DIFF (`8b2e4053` -> `fc6df72e`), NOT RE-WALKED —
# FOURTH consecutive window.** Re-measured at THIS watermark, not carried:
# `git diff --name-only 8b2e4053..fc6df72e -- compiler/src/codegen/emit-server.ts
# compiler/src/protect-analyzer.ts compiler/src/auth-graph.ts
# compiler/src/commands/select-request-onion.js compiler/runtime/ lsp/` is **EMPTY**. FIVE
# `compiler/src` files moved in the window and **not one is on the auth surface**: one NEW pre-AST
# diagnostic module (`lint-e-state-block-statement-form.js`), its `api.js` Stage-2.5c wiring, and
# three client-codegen lowerings (`codegen/emit-each.ts`, `codegen/emit-lift.js`,
# `component-expander.ts`). No route, guard, session, protect-floor or token-lifecycle byte moved.
#
# ⚑ **BUT ONE ROW IN THIS MAP WAS WRONG AND IS CORRECTED — a zero-diff surface is not a correct map.**
# The request-pipeline table's "HOW it wraps dispatch" row named
# **`compiler/src/codegen/emit-server.ts:~454-521`** as the emitter of `_scrml_dispatch` /
# `_scrml_onion_dispatch`. **Neither symbol exists anywhere under `compiler/src/codegen/`** —
# `grep -rn '_scrml_onion_dispatch' compiler/src/codegen/` returns nothing. Both are emitted by the
# HOST (`commands/build.js:514` and `:521`), and `emit-server.ts:~454-521` is §20.5/§52
# `@currentUser`-query-gate code with nothing to do with the onion. The row had the right NUMBER
# against the wrong FILE. **Wrong since #654 (`b74f7363`) — carried through every window since**,
# and never caught because the auth surface kept measuring zero-diff and the map kept being
# stamp-advanced rather than read. Split into rows 2 and 2b below. structure.map.md carried the
# identical error and is corrected there.
#
# content generated-at: `728bdc92` (the S368 pass — CARRIED. The line-3 stamp advanced
# `728bdc92` -> `b9e97f1b` (S371) -> `8b2e4053` (S372) -> `fc6df72e` (S376) on the MEASURED
# ZERO-DIFF recorded in the ⚑ note above, not on a re-walk.)
# **CURRENCY RE-VERIFIED AT `728bdc92`, NOT RE-WALKED — and verified by DIFFING, not by assuming.
# The prior pass RE-WALKED this map after a ten-window streak and found the request pipeline had
# moved hard; that content is one window old and carries in full.** Ancestry CHECKED (invariant 48);
# outbound MAP-STAMP check run (primary.map.md) at WRITE time: the source diff `merge-base..HEAD` is
# EMPTY and `728bdc92` is an ancestor of `origin/main` (it IS `origin/main`).
#
# **THE AUTH SURFACE IS ZERO-DIFF THIS WINDOW.**
# `git diff --name-only c96e7012..728bdc92 -- compiler/src/codegen/emit-server.ts
# compiler/src/commands/select-request-onion.js compiler/src/protect-analyzer.ts
# compiler/src/auth-graph.ts stdlib/auth stdlib/oauth stdlib/crypto lsp/` is **EMPTY**. §40.3's
# one-onion rule, the stage-1 CORS preflight, per-route `ratelimit=`, the §20.5 session surface and
# the protect-floor all carry unchanged.
#
# ⚑ **ONE ADJACENCY YOU MUST NOT MISREAD AS AN AUTH CHANGE (#669, §41).** `scrml:auth`,
# `scrml:crypto` and `scrml:oauth` appear in this window's diff, but ONLY inside
# `codegen/runtime-chunks.ts`'s client-registry classification — **no auth CODE moved.** What
# changed is what the compiler will now REFUSE: a CLIENT-reachable `import … from 'scrml:oauth'` is
# a hard `E-STDLIB-CLIENT-CHUNK-MISSING`, because `oauth` puts `client_secret` in the token-exchange
# body and its own module header reads SERVER-SIDE ONLY. ⚠ **`auth` and `crypto` are
# escalation-server-only by the §12.2 Trigger 3 criterion YET STILL CARRY A CLIENT CHUNK** —
# PRE-EXISTING since S95 Bug 18, left in place deliberately because removing a chunk is a behaviour
# removal and was out of scope for that dispatch. **That is a live inconsistency in the client
# safety story, not a mapped-and-closed decision.** dependencies.map.md · error.map.md.

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
    is `Object.hasOwn(this._rec, key) ? (this._rec[key] ?? null) : null` at `emit-server.ts:2692` — ⛑ **S384: `:2593` was ALREADY WRONG pre-window (it named a `lines.push("  };")`); RE-DERIVED BY GREP, not shifted.**
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


## §40.3 THE REQUEST ONION — one per compiled server, wrapping TOP-LEVEL dispatch (NEW, #654)

**Where a request-pipeline task STARTS.** Not at per-route emit. The chain is:

| Step | File | What it decides |
|---|---|---|
| 1. WHICH onion | `compiler/src/commands/select-request-onion.js` | `selectRequestOnion(serverModules)` → `{ onion, error }`. Zero candidates → `null` (no onion, byte-identical pre-onion output). One → mount it. **More than one → `E-MW-007`.** |
| 2. WHAT the onion IS (codegen) | `compiler/src/codegen/emit-server.ts` — gate `_scrml_hasMW` **`:2946`**, wrapper `function _scrml_mw_wrap(downstream)` **`:3105`**, exports `_scrml_mw_pipeline` **`:3242`** and `_scrml_mw_declared_in` **`:3259`** (⚑ CORRECTED S380 — all four shifted +12: the §52.13 protected-document guard export was inserted at `:2780-2790`, above every one of these) | Emits the onion and its mount CONTRACT. Nothing more. |
| 2b. HOW dispatch is split and wrapped (host, **NOT codegen**) | `compiler/src/commands/build.js:567-581` — `async function _scrml_dispatch(req, server)` **`:570`**, `function _scrml_onion_dispatch(req, server)` **`:577`** (⚑ CORRECTED S380 — both shifted +56: the §52.13 protected-document-registry code (`discoverServerRoutes` + `generateServerEntry` additions, `build.js:226-245`/`:319-390`) landed above the dispatch split) (`return _scrml_mw_pipeline_0(downstream)(req)`) | ⚑ **CORRECTED S376 — THIS ROW USED TO SAY `emit-server.ts:~454-521` AND THAT IS A WRONG FILE, NOT A DRIFTED LINE.** `grep -rn '_scrml_onion_dispatch\|_scrml_dispatch' compiler/src/codegen/` returns **NOTHING**; both symbols are emitted by the HOST. `emit-server.ts:~454-521` is §20.5/§52 `@currentUser`-query-gate code, unrelated to the onion. Wrong since #654 (`b74f7363`) — every window since. structure.map.md carried the identical error and is corrected there too. |
| 3. WHO mounts it (prod) | `compiler/src/commands/build.js:22, 299-317, 365-369` (⚑ CORRECTED S380 — was `284-302, 343-347`; +15/+22 respectively, same §52.13 insertion) | Scans emitted modules for `_scrml_mw_pipeline`; imports the winner under the ALIAS `_scrml_mw_pipeline_0` (every hosting module exports the same NAME). Throws with `err.scrmlCode` / `err.scrmlSources` on conflict. |
| 4. WHO mounts it (dev) | `compiler/src/commands/dev.js:32` (import), `:207` (`registeredOnions` decl), `:321-447` (`loadServerRoutes`, mounts the onion every recompile) | Rebuilds `registeredOnions` on every recompile; **mounts the SAME onion the built server does**, deliberately — a dev/prod split here is the exact defect the work removed. ⚑ **RE-VERIFIED against current HEAD `c1f93dfb` (post-#738 rewrite) — see the resolved PROVENANCE CAVEAT above.** Conflict prints via `formatOnionConflict` at `:410`. **ARCHITECTURE: `loadServerRoutes` now runs inside a respawned CHILD process** (`runDevChildServer`, `:1294`), so a fresh process import is always current (no cache-bust needed); the onion dispatches via `runThroughOnions(req, (request) => devDispatch(...))` at `:1233`, inside `buildServeConfig`'s `fetch` — the CHILD's `Bun.serve()` config, not the parent proxy's. |

**WHAT COUNTS AS DECLARING AN ONION** (the gate is `_scrml_hasMW` in emit-server; a non-pipeline module exports no `_scrml_mw_pipeline` at all, so the selector never sees it):

- **DOES declare one:** a `handle()`, or a `<program>` attribute that emits a pipeline STAGE — `cors=`, `log=` other than `"off"`, `ratelimit=`, `headers="strict"`.
- **Does NOT:** `batch-in-list-cap=` (§8.10.6 SQL batching), `idempotency-store=` / `idempotency-ttl=` (§19.9.6), `cors-max-age=` (inert without `cors=`), `channel-reconnect=` (§38.3.1). **They share the same config bag as the stage attributes — reading "the `<program>` carries an attribute" as "it hosts an onion" is the mistake this list exists to prevent.**

**WHY NOT COMPOSE MULTIPLE ONIONS** — the reasoning is in the module docblock and it is empirical, not aesthetic: composing means (a) every module's `handle()` PRE runs on every other module's page (**measured: two modules, two requests, four log lines, alpha's `handle()` stamping beta's document**), and (b) composition order is module-discovery order, which is **FILENAME-SORTED** — so renaming `api.scrml` to `zapi.scrml` would silently change which `handle()` won a contested path. Precedence must be readable off the source, and `<program>` is that.

**In the canonical v0.3 shape the question never arises:** the entry file declares `<program>` (with the middleware attributes and/or `handle()`), and `pages/*.scrml` route files declare `<page>`, which emits no onion.

**Introspection surface (dev only, and it exists so the behaviour is assertable):** `getRegisteredOnions()`, `getRegisteredRoutes()`, `runThroughOnions()`, `devDispatch`, `loadServerRoutes` — all exported from `commands/dev.js`. Post-#738, the process-topology surface is also exported: `serveDevInfra(pathname, req)` (dev-infra dispatch shared between the parent proxy and the child), `runDevChildServer(serveDir, opts)` (the child app server), `launchingProcessGone(launchPpid)` (orphan detection), and `CHILD_READY_PREFIX` (the child-ready stdout handshake).

### §40.3.3 pipeline ORDER at this HEAD

`[CORS preflight] → [logging] → [rate limit] → handle() PRE → _scrml_dispatch → handle() POST`

- **Stage 1 is the CORS preflight and it SHORT-CIRCUITS** (`emit-server.ts:3179`, `if (_scrml_mw_req.method === 'OPTIONS')`; ⛑ CORRECTED S384 from `:3127`, **+52** — #749's map/set runtime import + Part-A opts block land above it. It was `:3115` before S380's §52.13 shift). It reaches neither logging nor rate-limit, and **it does not reach `handle()`** — deliberately: a preflight carries no credentials, so an auth-enforcing `handle()` would reject it and the browser's real request would never be sent.
- **`ratelimit=` is PER-ROUTE** (`:3061-3084`, §4.15/§40.2; ⛑ CORRECTED S384 from `:3009-3032`, same **+52** shift; `:2997-3020` before S380) — it counts only requests a route serves, not the HTML/CSS/runtime/bundle sub-requests of one page load.

## §52.13 — an `auth="required"` scope also gates its OWN served `.html` document (NEW, S380, #728)

**Before this, `auth="required"` only guarded server FUNCTIONS.** The page's own statically-rendered
document is served by the build's `_server.js` static-file dispatch (or `scrml dev`'s static path),
which has no auth context at all — an unauthenticated `GET /secure.html` returned 200 with the fully
rendered markup, leaking whatever the page's initial server-render put there
(`g-auth-required-does-not-protect-the-served-html-document`).

**The fix threads one guard through all three layers, codegen -> build host -> dev host:**

| Layer | File | What it does |
|---|---|---|
| 1. EXPORT the guard | `compiler/src/codegen/emit-server.ts:2832-2842` (⛑ S384 +52, was `:2780-2790`) | Any module whose scope is `auth="required"` now ALSO emits `export const _scrml_protected_document = { guard: (req) => _scrml_auth_check(req) };` (`:2841`; ⛑ S384 +52, was `:2789`) — reuses the SAME check the per-route gate calls, so document and function share one verdict. |
| 2. DISCOVER + REGISTER (build) | `compiler/src/commands/build.js` — `discoverServerRoutes` excludes the export from `routeNames` and derives `protectedDocument` (the module's served `.html` path) via regex at `:245`; `generateServerEntry` collects `protectedDocs` (`:319-324`), imports each guard under a unique alias `_scrml_pd_<n>` (the export name collides across modules, `:370-373`), and builds a LOWERCASED `rel -> guard` map `_SCRML_PROTECTED_DOCS` (`:383-390`) | Static dispatch consults the map BEFORE cache headers / ETag are computed (`:538-545`) — an unauthenticated request 302s to `loginRedirect` and never reaches the file read or a 304. |
| 3. MIRROR (dev) | `compiler/src/commands/dev.js` (RE-VERIFIED against current HEAD `c1f93dfb`, post-#738 rewrite — see the resolved PROVENANCE CAVEAT above) — module-level `registeredProtectedDocs` Map declared `:215`, reset `:325`, set per module in `loadServerRoutes` `:379`, consulted in `devDispatch`'s static-file branch `:1046-1048` | Identical mechanism, so `scrml dev` and the built server agree — no dev/prod split, the same principle §40.3's onion work established. **`devDispatch` now runs inside the respawned CHILD process** (`runDevChildServer`, `:1294`), not the top-level dev process; `registeredProtectedDocs` is rebuilt fresh in every child via `loadServerRoutes` (`:321`), so a stale guard cannot survive a respawn. |

**Case-insensitivity is deliberate and OVER-protects, never under-protects.** Both sides lowercase the
map key AND the lookup key. On a case-insensitive filesystem the OS resolves `GET /SECURE.html` to
`secure.html`, but the SERVE_DIR-relative path used for cache/ETag logic keeps the REQUEST's original
casing — a case-EXACT map would miss on that request and leak the document. Gating every case variant
of a protected path is the safe direction to be wrong in (matches error.map.md's §14.8.11
graceful-degrade precedent: over-restrict, never under-restrict).

**Scope: documents only, not assets.** The guard mounts on the `.html` entry document path
specifically — CSS/JS/other static assets under the same route are unaffected by this change (they
carry no page content to leak and were already `no-cache`/immutable per their own contract, see
build.map.md's "Content-addressed build assets" section).

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

| Position | At `4f034e13` | Changed since `616688ea`? |
|---|---|---|
| `function` body | escalates (Trigger 3), silently, no diagnostic | no |
| `const <name> = …` **derived cell** RHS, **AT ANY DEPTH** | **REFUSED — `E-DERIVED-SERVER-ONLY-REACH` (§6.6.19, #486 + #500).** Not escalated: a derived recompute is synchronous lazy-pull (§6.6.3) and cannot become a round trip | **YES — #500. See the six positions below.** |
| `<name> = …` **mutable-cell initialiser** | **OPEN — leaks, no diagnostic** | no |
| **markup interpolation** | **OPEN — leaks, no diagnostic** | no |

⚠ **THE DERIVED-CELL ROW WAS TRUE-BUT-INCOMPLETE AT `616688ea`, AND THE INCOMPLETENESS WAS A LIVE
LEAK.** #486 shipped the refusal; the collector behind it (`collectDerivedCellDecls`,
`route-inference.ts:3730`) descended exactly `node.body` and `node.children` while its own doc comment
claimed it found derived cells *"at any depth"*. **Six positions were measured still leaking**, each
at exit 0 with ZERO `.server.js` and a real `Bun.password.hash(pw, { algorithm: "argon2id" })` in the
shipped browser runtime:

| Leaking position (pre-#500) | Why the field-listed walk missed it |
|---|---|
| `for`-loop `lift` body | the body sits under an `expr` wrapper — `…expr.node.children[0].body[0]` |
| `while`-loop `lift` body | same wrapper shape |
| `<each>` row body | per-item template children are not `node.body`/`node.children` at that level |
| `<engine>` state-child body | state children hang off an engine-specific property |
| loop nested inside a conditional | the conditional's arm is reached only through the same wrapper |
| any of the above inside a `kind="tool"` program | the §64 carve-out is what must hold there instead — it is a WHOLE-FILE predicate applied by the caller, so it is depth-independent by construction |

**The fix inverted the walk's default** rather than adding `expr` to the list: every array- and
object-valued property is descended, and exclusions live in a two-clause deny-list
(`skipDerivedWalkKey`, `:3677` — `span`, plus `_`-prefixed side tables). **Adding `expr` to a list of
two would have closed the reported shape and left the class open at the next unenumerated property.**
Measured: the deny-list is not load-bearing for the RESULT (68 cells collected with the shipped list,
68 without `parent`/`loc`/`spans`, 68 with no deny-list at all) — only for the work done. Termination
is an identity `seen` set plus a 512 depth cap, because the walk now descends ESTree expression trees
that nest one level per term. **`collectDerivedCellDecls` is EXPORTED for tests** precisely so the
termination and single-visit properties can be asserted against it directly; driving them through
`runRI` conflates them with every other walk in the stage (a synthetic cyclic AST blows the stack
inside `collectFileLevelBindingRoots`, `:2600`, which has no `seen` set at all — a separate,
unfixed fragility worth knowing about before you write such a test).

Reach is **REFERENCE, not call**, at ANY depth — inside a lambda, a nested `function` decl, or
escape-hatch raw text. Matching only top-level CALLS was proven evadable four ways, each shipping the
module and its secrets to the browser at exit 0: `["PEPPER"].map(p => hashPassword(p))`, a nested
`function` decl, a bare callback reference, and `let f = hashPassword; f(x)`. **On a confidentiality
boundary, over-firing costs a relocation and under-firing costs a leak.** Accepted residuals, named
rather than hidden: a binding shadowed ONLY inside a nested lambda still fires, and a word-boundary
scan of escape-hatch raw text can match inside a string literal in that text — both over-fires.

**`kind="tool"` programs (§64) are carved out of the §6.6.19 refusal** — no client boundary, no leak
— mirroring the carve-out Trigger 3 already takes for `print()`/`println()`. **The carve-out is
applied by the Step 3b CALLER (`isToolProgram`, read off the top-level `<program>`) BEFORE the walk
runs, not inside it**, which is what makes it depth-independent and is why the structural-walk change
did not have to re-derive it.


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
#scrml #map #auth #baas #jwt #jwks #oauth #csrf #magic-link #password-reset #e-cg-001 #protect-floor #stdlib-auth #server-shape #tool-serve #jwt-auth-bypass #session-establishment #session-secure #host-cookie #e-scope-012 #e-session-context #e-session-value #e-session-reserved-key #gh357 #session-proxy-bind #scrml-session-bind #reflect-get-target-receiver #sql-interpolation-session #csrf-token-disclosure #session-read-side #dangling-ref-class #ast-reads-current-user-ambient #sse-currentuser-splice #channel-auth-only #scrml-auth-check #permissive-by-design #store-invariant-probed #§52.15.1 #§20.5 #object-hasown #own-property-read #prototype-chain-read-closed #hasownproperty-shadow #read-side-policy-open #wire-live #response-contract #security-theater-vs-defense #ledger-locus-stale #§6.6.19 #e-derived-server-only-reach #escalation-server-only-modules #two-limb-criterion #credential-handling-limb #oauth-client-secret #criterion-not-the-list #per-function-scope-only #two-positions-still-open #mutable-cell-initialiser-open #markup-interpolation-open #reference-not-call #four-evasions #over-fire-not-leak #kind-tool-carve-out #no-diagnostic-when-it-fires #any-position #structural-walk-not-field-listed #collect-derived-cell-decls #skip-derived-walk-key #six-leaking-positions #for-lift-body #while-lift-body #each-row-body #engine-state-child #expr-wrapper #deny-list-not-load-bearing #depth-cap-512 #identity-seen-set #exported-for-tests #collect-file-level-binding-roots-has-no-seen-set #descend-one-field-too-many #do-not-add-the-field-name #carve-out-applied-by-the-caller #request-onion #select-request-onion #e-mw-007 #one-onion-rule #handle-top-level-dispatch #scrml-onion-dispatch #mw-pipeline-export #mw-declared-in #cors-preflight-stage-1 #preflight-carries-no-credentials #ratelimit-route-scoped #filename-sorted-precedence-hazard #csp-default-src-self #ssr-seed-application-json #transition-css-stylesheet #dev-prod-onion-parity #onion-dispatch-is-in-build-js #wrong-file-not-drifted-line #zero-diff-is-not-correctness #§52.13 #protected-document #scrml-protected-document #auth-required-document-guard #g-auth-required-does-not-protect-the-served-html-document #protecteddocs #scrml-pd-alias #case-insensitive-doc-guard #dev-prod-guard-parity #s380-incremental #s738-dev-rewrite #dev-child-process #dev-parent-proxy #run-dev-child-server #serve-dev-infra #child-ready-prefix #issue-724

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [domain.map.md](./domain.map.md)
- [error.map.md](./error.map.md)
- [dependencies.map.md](./dependencies.map.md)
- [schema.map.md](./schema.map.md)
