# BRIEF — SSR auth-scoped prerender-leak fix (re-do on current main)

**change-id:** ssr-auth-scoped-prerender-leak-redo · **opened:** S273 (bryan) 2026-07-20
**Dispatched:** scrml-js-codegen-engineer (iso:worktree, opus, bg) · **base:** 9c406055.

DONE-PROBE: grep -rq "I-SSR-AUTH-SCOPED-CLIENT-HYDRATED" compiler/src/

> Closes a CONFIRMED, LIVE cross-user data leak. The probe flips DONE when the compiler emits the
> auto-omit info code (the fix's marker). Stays OPEN until the re-do lands.

## The leak (reproduced on main 9c406055 — anon receives auth-required users)
An `auth="required"` `<program>` with an auth-scoped server-authority cell (Tier-1
`<Account authority="server" table="users">`) compiles `_scrml_ssr_compose_handler` (emit-server.ts)
that runs the cell's `SELECT` **unscoped + with no auth check on the request**, bakes ALL rows into the
first-paint HTML + `window.__scrml_ssr_state`, and the SSR compose route is anon-reachable. PA reproduced:
an anon GET → `{"accounts":[{id:1,name:"Alice"},{id:2,name:"Bob"}],...}` in the seed. `W-SSR-PRERENDER-UNSCOPED`
warns but the emit still leaks.

## History — why a RE-DO not a merge
Fixed + 3-round-hardened at **S256** (`fix/ssr-auth-scoped-prerender-leak` @ `bfed8ecf`, fork `3b2b5f53`),
then **stranded unmerged 17+ sessions**. The SSR/emit-server code moved under it (tenant floor #117/#118,
session.set, #81) → won't clean-merge (6 conflict hunks). Design spec = the held diff `git diff 3b2b5f53..bfed8ecf`
+ its 6 conformance cases `git show bfed8ecf:conformance/cases/ssr/ssr-auth-scoped-*`. Re-implemented on current main.

## The fix (SPEC §52.15.5 "auto-make-safe")
- An auth-scoped, non-row-scoped server cell → **AUTO-OMITTED from the SSR seed** (no first-paint fill, no
  `window.__scrml_ssr_state` entry); hydrates client-side behind its gated `/__serverLoad` (401 anon).
- A public sibling (`auth="none"` or row-scoped `WHERE user_id=${@currentUser.id}`) is NOT over-omitted (still SSR-seeded).
- Emit **`I-SSR-AUTH-SCOPED-CLIENT-HYDRATED`** (Info, per-var); retire/replace `W-SSR-PRERENDER-UNSCOPED` per the held branch.
- One `sql-lex.ts` source of truth for the auth/row-scope classification + per-cell role gating.
- Orthogonal to §14.8.9 protect + §14.8.10 tenant (all three filter the SSR seed); non-auth apps byte-identical.

## Verify (MANDATORY — live security leak)
- R26 EXECUTE: recompile the reproducer, invoke `_scrml_ssr_compose_handler` ANON → Alice/Bob + `accounts`-key
  ABSENT; `widgets`/`PublicWidget` PRESENT; `I-SSR-AUTH-SCOPED-CLIENT-HYDRATED` fired. Not a grep.
- S239 adversarial pass (PA-side) on the diff before land.
- **Test-determinism (hard):** the anon SSR-compose invocation is deterministic (no session/CSRF). Do NOT write
  a session-pinned authenticated full-bundle HTTP test — that path is cloud-runner-infra-flaky (cost hours on the
  tenant floor this session: passed locally 17910/0, failed cloud-only). Mirror `conf-TENANT-FLOOR.test.js`
  (compile + wiring-assert + `new Function` helper-exec).

## Watch
- Anon-reachable SSR compose is the leak surface — the omission must key on the cell's auth-scope, not the request.
- Do not over-omit public/row-scoped cells (the sibling-not-over-omitted property is in the held branch's cases).
- Compose with tenant + protect at the same sink (don't regress them).
