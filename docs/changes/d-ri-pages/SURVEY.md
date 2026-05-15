# D-RI-PAGES — Survey

`buildPageRouteTree` accepting `pages/` in addition to `routes/`.

Date: 2026-05-15
Base SHA: de842604dcb2c1e7891db44640e30241e4359f4d
Branch: agent worktree branch

## SPEC normative position

- SPEC §47.9.2 (line 19314) — adopters arrange .scrml files under a `pages/` (or equivalent) directory; the compiler computes routes deterministically per Pillar 3.
- SPEC §47.9.2 (line 19316) — "consistency between the `pages/` directory convention and any historical `routes/` directory references is a compiler-internal cleanup target". This dispatch IS that cleanup.
- SPEC §40.8 / §40.8.1 — `<program>` multi-page-app shape; presence of a `pages/` directory at project root suppresses W-PROGRAM-SPA-INFERRED.
- SPEC §47.9.2 examples table (lines 19306-19313) uses `pages/` exclusively.

Conclusion: `pages/` is normative-canonical. `routes/` is legacy. Accept BOTH; do NOT migrate fixtures.

## Implementation surface in route-inference.ts (verified by grep)

Three call-sites key on the literal `"/routes/"`:
- line 2721 — `const routesIdx = filePath.indexOf("/routes/")`
- line 2735 — `const relativePath = filePath.slice(routesIdx + "/routes/".length)`
- line 2817 — `const routesRoot = filePath.slice(0, routesIdx + "/routes/".length)` (in `findLayoutFile`)

`findLayoutFile` is called only from buildPageRouteTree, so the prefix value is known at the call-site — easiest path is to pass the matched prefix length down rather than rederive it.

No other file in compiler/src references `"/routes/"` for this purpose. Surface is contained to one file, one function + its helper.

## Auth-redirect cross-ref consumer (auth-graph.ts)

`crossRefRedirects` builds a Set<string> of urlPatterns from `routeMap.pages` (collectUrlPatterns) and tests `urlPatterns.has(redirect)`. So the fix here flows directly: post-fix, pages-rooted files will appear in `routeMap.pages` with their proper URL pattern (instead of `/`), and the cross-ref will resolve.

I-AUTH-REDIRECT-UNRESOLVED fires per-gate when redirect target is not in the urlPattern set.
W-AUTH-LOGIN-MISSING fires once per compilation when NO gate's redirect resolves.

## URL-pattern arithmetic for the scaffold case

- `pages/auth/login.scrml` → relativePath `auth/login.scrml` → urlPattern `/auth/login`.
- `pages/login.scrml` → relativePath `login.scrml` → urlPattern `/login`.

The default `loginRedirect` from RI is `"/login"`. So:
- Scaffold at `pages/auth/login.scrml` resolves /auth/login (NOT /login). Adopter must set `<program loginRedirect="/auth/login">` for the diagnostic to clear with default scaffold.
- Or scaffold at `pages/login.scrml` for default to resolve.

The brief's Phase 3 synthetic test asserts NEITHER diagnostic fires for `<program auth="required" loginRedirect="/login">` + `pages/auth/login.scrml` — but that combination still leaves /login unresolved post-fix. The test as briefed would fail. Adjusted test plan: write integration tests that close the loop CORRECTLY with matching loginRedirect + page URL (two shapes: explicit `loginRedirect="/auth/login"` + `pages/auth/login.scrml`, AND `pages/login.scrml` for default `/login`). Negative case: `pages/auth/login.scrml` with default `loginRedirect="/login"` still fires both diagnostics — that proves the fix is necessary-but-not-sufficient (the auth diagnostic correctly continues to fire when URL truly doesn't exist).

Surfacing this to PA in NOTES.

## 23-trucking-dispatch baseline expectation

`<program auth="required">` with NO explicit loginRedirect → default `/login`. Login page at `pages/auth/login.scrml` → post-fix `/auth/login`. So with default loginRedirect, the existing trucking app will STILL fire I-AUTH-REDIRECT-UNRESOLVED + W-AUTH-LOGIN-MISSING. This is correct: the URL mismatch is real. The fix to D-RI-PAGES doesn't paper over this — the trucking app needs its own `<program loginRedirect="/auth/login">` annotation. That's NOT in scope here (out-of-scope per brief).

In scope: when the page file URL DOES match loginRedirect, the diagnostic clears (the route-inference side of the loop). That's testable independently.

## Existing test inventory

- `compiler/tests/unit/route-inference.test.js` — has `buildPageRouteTree` describe block starting at line 1863. Eight tests covering routes/ shapes. ALL use `/app/src/routes/...` paths. None use `pages/`. Tests will continue to pass post-fix (no regression).
- `compiler/tests/integration/multipage-multirole-integration.test.js` — comment at line 54 references buildPageRouteTree. Fixtures live at `compiler/tests/integration/fixtures/a5/multipage-multirole/routes/`. Do NOT migrate.
- `compiler/tests/integration/tier2-hover-prefetch.test.js` — comment at line 82 references routes/ requirement. Fixtures under `routes/`. Do NOT migrate.

No existing test exercises `pages/` paths. The `examples/23-trucking-dispatch` directory uses `pages/` but is not a test fixture per se — it is reference-app smoke-compiled at A-5.5 (F-6).

## Test plan

Phase 2 — extend `compiler/tests/unit/route-inference.test.js` buildPageRouteTree describe block with new tests under a sub-describe `pages/ recognition`:
- index.scrml in pages/ → /
- pages/about.scrml → /about
- pages/users/[id].scrml → /users/:id with params
- pages/auth/login.scrml → /auth/login (scaffold case)
- pages/posts/[...slug].scrml → catch-all
- pages/_layout.scrml excluded
- pages/sub/_layout.scrml + pages/sub/index.scrml layout binding
- Backward compat: routes/ shapes continue to work alongside pages/ (mixed bag)
- precedence: a path containing BOTH /routes/ and /pages/ — document/test the chosen winner. Plan: routes/ wins (first in lookup order; backward compat priority).

Phase 3 — new integration test file:
- Synthetic compile: `<program auth="required" loginRedirect="/auth/login">` + `pages/auth/login.scrml` → asserts NO I-AUTH-REDIRECT-UNRESOLVED + NO W-AUTH-LOGIN-MISSING.
- Synthetic compile: same `<program>` but loginRedirect="/login" with page still at `pages/auth/login.scrml` → asserts BOTH diagnostics fire (proves the fix doesn't paper over real mismatch).
- Backward-compat synthetic compile: same shape but page at `routes/auth/login.scrml` → assert NO diagnostics. Routes/ path continues to work.

This closes the loop on Batch A.1: when the adopter runs `scrml generate auth` AND sets `<program loginRedirect="/auth/login">`, the diagnostic clears on next compile.
