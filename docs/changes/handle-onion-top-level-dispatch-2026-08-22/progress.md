# progress — handle-onion-top-level-dispatch-2026-08-22

Branch: `handle-onion-top-level-dispatch` (base `origin/main` a0e30329)
Ruling: **`handle()` PRE wraps ALL top-level dispatch** (delta-log `[1677]`).

## Status — COMPLETE

- [x] Setup: worktree clean, `bun install`, `bun run pretest`
- [x] Baseline measurement (defect reproduced by execution on `origin/main`)
- [x] `emit-server.ts` — onion moved to the `fetch` aggregate; per-route wraps removed
- [x] `build.js` — onion mounted around the production `Bun.serve` dispatcher
- [x] `dev.js` — onion mounted around the `scrml dev` dispatcher (dev/prod parity)
- [x] `scheduling.ts` — `resolve(...)` auto-await
- [x] Five executed scenarios + PRE-runs-once proof
- [x] Regression floor: 2138 corpus files, both trees
- [x] `bun conformance/run.ts` → 883/883
- [x] Browser-suite name-set diff base vs HEAD → zero new failures

## Known-gaps resolution (PA-owned entry — do not edit `docs/known-gaps.md`)

`g-handle-onion-applied-per-route-not-top-level-custom-paths-404` — **RESOLVED.**
The onion now wraps top-level dispatch in all three dispatchers. Two-sided
execution proof (brief's exact adopter shape, same fixture, both trees):

| tree | `GET /quote.pdf` |
|---|---|
| `origin/main` | `404 Not found` |
| this branch | `200 PDF` |

## What changed, per dispatcher

### 1. `compiler/src/codegen/emit-server.ts` — the WinterCG `fetch` aggregate

- `_scrml_mw_wrap(routeHandler)` → `_scrml_mw_wrap(downstream)`. The argument is
  the host dispatcher's REMAINDER (route match → static file → 404), not one
  route handler.
- BOTH per-route call sites removed (`:3558` SSE route export, `:4407` the main
  per-batch route export). Keeping either would run `handle()` PRE twice on a
  route match.
- The aggregate now emits when `collected.length > 0 || _scrml_hasMW ||
  _scrml_handleNode != null`. A `handle()`-only program previously collected
  ZERO routes and emitted NO dispatcher — 60 lines with `_scrml_mw_wrap` called
  zero times, no `fetch`, no `routes`.
- New `export const _scrml_mw_pipeline = _scrml_mw_wrap;` — the mount point a
  host dispatcher imports.

### 2. `compiler/src/commands/build.js` — the production `Bun.serve` fetch

- `discoverServerRoutes` buckets `_scrml_mw_pipeline` into `middlewareNames`
  (it is `wrap(downstream) -> handler`, not `{ path, method, handler }`).
- Every module exports the onion under the SAME name → per-module import alias
  `_scrml_mw_pipeline_<i>`. Name-based de-dup would have dropped all but the first.
- The fetch body is emitted ONCE and mounted two ways: inlined in `async fetch`
  when there is no onion (**byte-identical to `origin/main`**, verified for the
  empty / one-route / ws module shapes), or as `_scrml_dispatch(req, server)`
  when there is.
- Onions compose in module order, first = outermost. The Bun `server` handle is
  threaded through the innermost closure so WS upgrade routes still receive it.

### 3. `compiler/src/commands/dev.js` — the `scrml dev` fetch

Not named in the brief; covered because it is a THIRD top-level dispatcher and
the one an adopter hits while developing. Leaving it out would have shipped a
dev/prod split (interception serving under `scrml build`, 404 under `scrml dev`)
— a worse defect than the one being fixed.

- `loadServerRoutes` collects `_scrml_mw_pipeline` into `registeredOnions`. It is
  a FUNCTION, so it fell through the `typeof value !== "object"` route-shape
  guard and was invisible.
- The route-match → static-file → 404 tail is extracted to
  `devDispatch(req, server, serveDir, opts)` — TOTAL (always a Response).
- `runThroughOnions(req, downstream)` is the identity when nothing is mounted,
  so a non-middleware dev session is unchanged.
- Dev-infra endpoints (`/_scrml/live-reload`, `/_scrml/log`, the CORS preflight,
  the compile-failure short-circuit) return BEFORE the onion: SPEC §40.3.4 scopes
  `handle()` to "the compiled server", and those are the dev server.

## What `resolve(request)` returns

`resolve()` is TOTAL — always a `Response`, per SPEC §40.3.2 ("`resolve(request)`
invokes the rest of the pipeline and returns a Bun `Response`").

- **Built server / `scrml dev`**: the whole downstream — route match → static
  file → 404. Naturally a `Response` on every path.
- **`fetch` aggregate**: route match, or `null` when nothing matched (the
  documented `scrml(req) ?? myApi(req)` composition contract). `_scrml_mw_wrap`
  normalizes a non-`Response` to `_scrml_mw_no_match()` — a 404 tagged in a
  module-level `WeakSet` — BEFORE the author's `handle()` body sees it, and
  `fetch` maps an untouched tagged 404 back to `null` on the way out. Both
  invariants hold: `resolve()` is total, and composition still works.

## Bonus defect found and fixed: `resolve()` was never awaited

The emitted `resolve` is `async`; SPEC §40.3.2 types it `(req: Request) ->
Response` and every §40.3 worked example writes:

```scrml
const response = resolve(request)
response.headers.set("X-Request-Id", reqId)
```

That bound a Promise → `response.headers` was `undefined` → **TypeError on every
POST-middleware path**, including the flagship `examples/20-middleware.scrml`.
`injectHandleRequestAwaits` (the existing §40.3-body await-injection pass) now
also awaits the bare `resolve` param call. Reproduced on `origin/main`:

```
TypeError: undefined is not an object (evaluating 'response.headers.set')
  at index.server.js:91:16  ← const response = resolve(request)
```

## Wrapper order

The comment at `emit-server.ts:~4393` called `_scrml_session_cookie_wrap`
"OUTERMOST (around any `_scrml_mw_wrap`)". That is no longer true globally — the
onion moved above it. It IS still the outermost per-ROUTE wrapper (and now the
only one). Resulting order on a route match:

```
handle() PRE → route match → _scrml_session_cookie_wrap → handler
             → cookie commit → handle() POST → security headers → logging
```

which is exactly SPEC §40.3.3's fixed order:

```
[CORS preflight] → [rate limit] → handle() PRE → [CSRF check] → [route dispatch]
  → handle() POST → [security headers] → [logging]
```

Session semantics are unaffected: the cookie wrapper's job (load the incoming
session before the body, commit `Set-Cookie` onto the Response after) is a ROUTE
concern, and `handle()`'s §40.3.2 contract gives it only `request` and `resolve`
— never `session`. A static file has no session write.

## Executed scenarios (production `Bun.serve`, fixture: `handle()` +
## `<program log="structured" headers="strict">` + one server fn)

| # | probe | status | notes |
|---|---|---|---|
| 1 | `GET /quote.pdf` (intercepted custom path) | 200 `PDF` | PRE short-circuit; no POST headers, correct |
| 2 | `POST /_scrml/__ri_route_ping_1` (registered route) | 200 `"pong:bob"` | route ran; `X-Request-Id` stamped by POST middleware |
| 3 | `GET /index.html` (static file) | 200 | `X-Request-Id` + CSP — §40.3.4 "including statically-served assets" |
| 4 | `GET /definitely-not-a-thing` | 404 | 404 **through** the onion; `X-Request-Id` present |
| 5 | `handle()`-only program, zero routes | dispatcher emitted | `origin/main` emitted none |

`X-Pre-Count` (a `globalThis` counter incremented in PRE, stamped in POST)
advanced by exactly 1 per request — `2,3,4,5,6` across the five probes after the
readiness probe, six requests, counter 6. A surviving per-route wrap would have
doubled it.

## Regression floor

Both trees, same corpus, per-file diagnostic-code set + normalized emitted-server
hash. (`git archive origin/main` + symlinked `node_modules`; `stdlib/` present.
The §47 chunk-namespace token is FNV-1a of the project-root-relative path, so it
differs purely by checkout depth — normalized out of the hash.)

| root | files | diagnostic-code deltas | serverJs changed |
|---|---|---|---|
| `examples/` | 71 | **0** | 1 |
| `samples/` | 877 | **0** | 4 |
| `docs/` | 285 | **0** | 0 |
| `conformance/` | 898 | **0** | 10 |
| `benchmarks/` | 7 | **0** | 0 |
| **total** | **2138** | **0** | **15** |

Every one of the 15 carries a `handle()` or a `<program>` middleware attribute
(`cors=` / `log=` / `ratelimit=` / `headers=` / `idempotency-store=` — the last
also populates `middlewareConfig`, `compute-program-config.ts:175`):

- `examples/20-middleware.scrml` — `handle()` + `log`/`headers`/`cors`
- `samples/gauntlet-r{13,14}/{go-api-service,react-auth-dashboard}.scrml` — `handle()`
- `conformance/cases/middleware/duplicate-handle-{pos,neg}` — `handle()`
- `conformance/cases/middleware/ratelimit-invalid-unit-{pos,neg}` — `ratelimit=`
- `conformance/cases/server-db/cps-{idempotency-store-driver-mismatch,idempotency-store-missing-import,nonidem-no-storage}-{pos,neg}` — `idempotency-store=`

All 15 diffs are the same six edits: the `_scrml_mw_no_match` helper, the
`downstream` rename, the total-`resolve` body, the `await resolve(...)`, the
`_scrml_mw_pipeline` export, and the `_scrml_route_dispatch` / `_scrml_fetch_pipeline`
split. `samples/compilation-tests/gauntlet-s19-*` contain the text
`function handle(` but do NOT match the §40.3.2 reserved signature
(`handle()` / `handle(e: asIs, tag: string)`) so `isHandleEscapeHatch` is false —
correctly byte-unchanged.

Browser suite (pre-existing happy-dom global-state flakes): failing test-NAME set
is **identical** between `origin/main` and HEAD — 47 both sides, zero new, zero
fixed. Not a regression.

## Observation for the operator's open question (NOT built here)

The brief asks whether a **protected column** can now reach a `handle()`-served
response. Probed with a `<db protect="ssn">` plus a `handle()` that runs its own
`?{ SELECT * FROM orders }` and returns a manual `Response`:

```
error [E-PROTECT-004]: server function `handle` selects a protected (`protect=`)
column in `SELECT * FROM orders` and reaches a manual `Response` / `handle()`
body (§40) — an egress the compiler cannot redact …
```

**Build-blocking, already in place, unchanged by this work.** The protect floor
already names the `handle()` body explicitly, so making these paths reachable did
not open a protected-column hole.

**Auth is the other half, and it does NOT extend.** On the `auth="required"`
fixture, an unauthenticated `GET /quote.pdf` returns `200 PDF` while an
unauthenticated route call returns `302 -> /login`. `_scrml_auth_check` lives
inside the route handler, which is downstream of `resolve()`, so a `handle()` PRE
short-circuit bypasses the auth gate by construction. That is the operator's live
question — surfaced, not gated.

## Files touched

- `compiler/src/codegen/emit-server.ts`
- `compiler/src/codegen/scheduling.ts`
- `compiler/src/commands/build.js`
- `compiler/src/commands/dev.js`
- `compiler/tests/unit/middleware-handle.test.js` (rewritten to the new contract)
- `compiler/tests/commands/build-adapters.test.js` (+5 cases)
- `compiler/tests/unit/dev-handle-onion-dispatch.test.js` (new, 8 cases)

## SPEC

No amendment needed — §40.3.3 / §40.3.4 / §40.3.5 already describe the onion
correctly, and §40.3.4's "including statically-served assets" is the decisive
line. **No section describes the per-route behaviour as intended**; the numbering
drift (§39.3.x sub-headers under a `### 40.3` parent, SPEC.md:22597-22690) is
cosmetic and pre-existing, reported not rewritten.
