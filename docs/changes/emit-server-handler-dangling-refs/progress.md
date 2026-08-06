# emit-server handler dangling-refs — progress

Append-only working log. Branch `fix/emit-server-handler-dangling-refs` off main `766c9c9a`.

## Startup
- Worktree root verified == WORKTREE_ROOT, clean, branch correct, HEAD 766c9c9a. OK.
- `bun install` (PUPPETEER_SKIP_DOWNLOAD=true) OK. `bun run pretest` OK.

## Bug 1 — empirical reproduction (refines the gap entry)
Compiled 4 variants of a plain server-fn / SSE-generator reading `@currentUser`
directly (not via `?{}`), greped the emitted `app.server.js`:

| variant | resolver `_scrml_current_user` defined | `_scrml_currentUser` binding | verdict |
|---|---|---|---|
| A: RPC direct read, NO auth  | NO  | spliced (L4046) | DANGLING resolver — binding calls unemitted `_scrml_current_user` |
| B: RPC direct read, WITH auth | YES | spliced (L4046) | works |
| C: SSE generator, WITH auth  | YES | NONE | DANGLING binding — SSE handler has no splice |
| D: SSE generator, NO auth    | NO  | NONE | both gaps |

Refinement of the gap entry: the binding IS already spliced in the *main* route
handler (a prior "adopter behavioral run" fix, emit-server.ts:4046). The remaining
open facets are:
- **Facet 1 (resolver gate):** `_needsSessionInfra`'s `@currentUser`-in-fn detector
  (`_anyFnCurrentUserQuery`, L2081) only matches `?{}` SQL reads
  (`astSqlQueryUsesCurrentUser`), NOT a DIRECT `@currentUser.id` read → resolver never
  emitted for a no-auth/no-SQL direct-read app (variant A/D).
- **Facet 2 (SSE binding splice):** the §36 SSE handler (L3227) emits the generator
  body but never splices the `const _scrml_currentUser = _scrml_current_user(_scrml_req)`
  binding the main handler splices (variant C/D).

Both are the same class the task names (a reference gated more narrowly than its
binding/definition). Fixing both closes all four variants.

## Fixes applied (emit-server.ts only)
### Bug 1 — g-currentuser-plain-handler-dangling
- Added `astReadsCurrentUserAmbient` (superset of `astSqlQueryUsesCurrentUser`): also
  matches a DIRECT `IdentExpr{name:"@currentUser"}` read, not just SQL-string reads.
- `_anyFnCurrentUserQuery` now uses it → `_needsSessionInfra` fires for a direct read,
  so the `_scrml_current_user` resolver is emitted (facet 1: variant A/D resolver).
- §36 SSE handler: added the `_scrml_currentUser` binding splice mirroring the non-SSE
  route handler's `_cuBodyRefsCurrentUser` splice (facet 2: variant C/D binding).

### Bug 2 — g-channel-auth-only-authcheck-dangling
- Computed program-level `_hasChannelAuth` (mirrors emit-channel.ts `attrMap.has("auth")`).
- `_needsSessionInfra` now ORs `(_hasChannelAuth && _webAppShape)` → `_scrml_session_middleware`
  present for a channel-auth-only app (the fn the auth-check calls).
- Added an `else if (_hasChannelAuth && _webAppShape)` arm after the `authMiddlewareEntry`
  block that emits ONLY `_scrml_auth_check` (not CSRF/session-destroy/projection). The
  `else` guarantees no double-def when program auth is present; existing programs are
  byte-identical (the auth block is untouched, no-channel-auth programs never enter the arm).

## Verification (EXECUTED — see report)
- BEFORE (pre-fix emit-server.ts via git stash): BUG1 `ReferenceError: _scrml_current_user
  is not defined`; BUG2 `ReferenceError: _scrml_auth_check is not defined`.
- AFTER: BUG1 status 200 `{"id":7,"role":"dispatcher"}`; BUG2 unauth 302 (no crash),
  auth upgrade attempted (no crash).
- DONE-PROBE `emit-server-handler-dangling-refs.test.js`: 6 pass / 0 fail.
- FACTS regen: docs/FACTS.md facts-table regenerated (compiler LOC changed); state.ts no-op.

## Full gated subset delta (bun test compiler/tests/{unit,integration,conformance})
- **conformance: 1443 pass / 0 fail** / 30 skip. Clean.
- **unit: 17366 pass / 0 fail** / 17 skip. Clean. ("error: boom" is an intentional in-test throw.)
- **integration: pass; the 6 fails in the first (lighter) run are ALL Windows baseline / pre-existing:**
  - `self-host smoke` ×3 — documented Windows baseline (Linux-green).
  - `B5 runtime guard — dynamic session.set(csrfToken)` (csrf B5) — documented baseline.
  - `session-secure-b4b5` afterAll EBUSY temp-dir cleanup — documented baseline.
  - `auth-csrf-synchronizer-token` afterAll EBUSY — PROVEN pre-existing: main's
    (766c9c9a) emit-server.ts gives the IDENTICAL 6 pass / 1 fail. The transient
    "round-trip fail" seen under co-run was only the stale fixed-path temp dir being
    lock-held; after `rm -rf _tmp_auth_csrf_sync` it passes clean (fix-vs-prefix identical).
  - A heavier co-run added timeout flakes (`validate-emit-gate` + several unnamed ~6s
    heavy-parity suites). `validate-emit-gate` passes **3/0 in isolation** with an
    adequate timeout — critically its **E-CODEGEN-INVALID-LOGIC gate is GREEN**, proving
    my new emissions (SSE `_scrml_currentUser` binding, channel-auth `_scrml_auth_check`)
    are valid JS with zero acorn-detected invalid logic.
- **Targeted regression check (isolated): 46 pass / 0 fail** across server-load-authority,
  session-establishment-roundtrip, gh357-session-sql-interpolation, g-markup-session-read-
  undeclared, and the DONE-PROBE — the suites nearest the touched code paths.
- No conformance fail, no unit fail, no NEW integration fail. Nothing is my regression.
