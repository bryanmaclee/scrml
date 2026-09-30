# s443-example-23 — examples/23 usable end-to-end (PA-direct, S443)

bryan S443: "no waiting, go now" — done PA-direct (sub-agent quota exhausted until 2026-10-02); self-review only.

## What was broken (all executed on main b3419e6d8+)
1. Login never established the FRAMEWORK session — loginServer wrote an app-KV token only; `<program auth="required">`
   gates on the framework session → every gated page 302'd after a real login.
2. The app-KV token rode a cookie set from JS with `HttpOnly` (models/auth.scrml buildSessionSetCookie) — browsers
   refuse HttpOnly from document.cookie, so the page-level auth never worked in a real browser either.
3. dispatch.db shipped with ZERO users: seeding ran from `on mount { runSeeds() }` in the gated app shell (anonymous
   visitors never mount it), and the imported seeds module resolves `?{}` to `:memory:` (F-AUTH-002) → the route 500'd
   on every composed page.
4. Gated routes redirected to the default `/login` (404); login redirected to `/dispatch` `/driver` `/customer` (404 —
   prod static serving has no directory index; the pages are board/home).
5. Driver BOL/POD: role check only — any driver read any load's BOL token and submitted it (review of #1155, P2).
6. Driver/customer home pages crashed on load (compiler defects below) → handlers never wired, Logout dead.

## Fix
- login/register: `session.set("userId")` + `session.set("role")` after the credential check (§20.5.1).
- 18 pages: `getCurrentUser(userId)` fed `session.userId` by the request-entry server fn (session is readable only
  there — E-SESSION-CONTEXT). The app-KV token is still minted (harmless) but no longer read for auth.
- Logout → `/auth/login?logout=1`; the login page's `endSessionServer()` calls `session.destroy()`.
- `<program … loginRedirect="/auth/login">`; all /login /register /dispatch /driver /customer links → real pages.
- dispatch.db PRE-SEEDED (8 users, 3 customers, 4 drivers, 8 loads, 3 tractors, 4 trailers) by running the real
  `runSeeds()` once (compiled seeds module re-pointed from `:memory:` to the file); `on mount { runSeeds() }` removed.
- `assignedDriverFor(user, loadId)` guards getActiveBolTokenServer / uploadBolServer / uploadPodServer.
- Crash workarounds: `…Of(record)` helper variants for class-attribute interpolations; `@x is some ? … : ""` /
  `@x is some && (…)` guards on text interpolations that call functions and on attribute expressions.
- ex23 README: routes, run (build + copy db + serve), login mechanism, token guard (RETURNING, not .changes).
- examples/09: SubmitFailed now reachable for a real reason (duplicate submission refused server-side); the
  unreachable "insert returned no row" check removed.
- stdlib/auth/templates/login.scrml (`scrml generate auth`): `session.set("userId", row.id)` — it never authenticated.
- trucking smoke baseline: W-AUTH-LOGIN-MISSING 1→0, I-AUTH-REDIRECT-UNRESOLVED 1→0, W-CG-CHUNK-PREFETCH-UNRESOLVED
  3→0, W-TYPE-031-UNPROVEN 321→287 (measured histogram diff vs origin/main).

## Evidence (executed)
- Chromium (Playwright), `scrml build` + `bun _server.js`: dispatcher / driver / customer each — anonymous → 302
  /auth/login; login → lands on /dispatch/board | /driver/home | /customer/home with real data ("Hi, Doyle Briggs",
  "Account Basin Energy Services"); 0 page errors; Logout → gated page 302s again.
- HTTP: unassigned driver → getActiveBolToken / uploadBol / uploadPod "You are not assigned to this load."; assigned
  driver → token, upload ok, replay refused.
- ex09 in Chromium: 1st submit "Thanks!", identical 2nd → Failed state. ⚑ The error MESSAGE renders blank — for the
  validation errors too, on main — the held S441 `| err :>` defect (bare-identifier arm does not bind the error value).
- Template: scaffold app + template → anon 302; login sets __Host-scrml_sid; gated page 200; wrong password sets none.

## Compiler defects found (filed in known-gaps §S443)
- A markup `${fn(@x.f)}` interpolation is ALSO emitted as a bare module-level statement evaluated at load → throws
  when @x is `not`, killing the page script.
- A `class="…${…}"` template interpolation does not lower scrml expressions (`is some`, `?.` emitted raw) → E-CG-001.
- Attribute expressions (`disabled=(@x.f == …)`) run eagerly under a hidden `if=`.
- Prod static serving has no directory index (`/dispatch` does not serve `dispatch/index.html`).
