# ss44 — `_scrml_session` duplicate-declaration (the adopter #15) — VERIFY-FIRST · HIGH

**Currency:** scoped S224 (PA) @ HEAD `9ad78593` / 2026-06-27. **FIREABLE.** Source = **GitHub issue #15** (an adopter, v0.7.0 adopter — Adopter-B port). **HIGH** — breaks any auth-gated page under a shell/layout `app.scrml` (a common real shape): the page goes blank/dead.

**Authority (READ FIRST, Rule 4):** `gh issue view 15 --json title,body` (full repro + trigger conditions) + SPEC §40 (app-shell/layout + middleware) + §52 (`@session` authority projection) + the auth-wall arc (#5-#14, already fixed). The bug: when `app.scrml` has shell markup it becomes the per-page layout → `app.client.js` loads on EVERY page and carries the compiler-generated `@session` projection as a **top-level `let _scrml_session = null;`** (NOT IIFE-wrapped); an auth-gated page (`auth="required"`/`protect=`) ALSO emits its own top-level `let _scrml_session = null;` in its `*.client.js` → both classic scripts load → `Identifier '_scrml_session' has already been declared` → the page never hydrates.

**Trigger (all 3 required):** (1) `app.scrml` has shell/layout markup (→ app.client.js on every page); (2) `auth` enabled on the program (→ app.client.js carries the `@session` let); (3) the page is itself auth-gated (→ its own client ALSO emits the let). An `auth="optional"` page is unaffected.

**Fix direction (survey-first — confirm the seam):** the `@session` reactive projection must not collide across the two client bundles. Candidate fixes (survey picks): (a) IIFE-wrap the `@session` projection (so the two top-level `let`s don't collide); (b) emit it ONCE (dedupe — when app.client.js already carries it, the page client references rather than re-declares); (c) namespace/guard the declaration (`if (typeof _scrml_session === 'undefined')`-style idempotent init). Prefer the option that keeps a single source of truth for `@session` across app-shell + page (don't double the reactive wiring). LIMIT-PRIMITIVES — no new surface; this is a codegen-emission dedup/scope fix.

**Parallel-safety:** codegen (the `@session` projection emitter + the app-shell/per-page client emission — likely `emit-client.ts` / a session-projection helper). ⚠️ `emit-client.ts` is HOT (S211/S223 4-way contention precedent). Disjoint from ss45 (route-inference), ss46 (type-system). Check vs ss47 (#12, also codegen emit-server) at landing — different sub-area (session projection vs `?{}`-arrow) but verify.

**coreFiles (survey-first — Phase 0 locates):** grep the codegen for the `// --- @session reactive projection (compiler-generated) ---` comment + `_scrml_session` emission site; the app-shell-vs-page client bundle split (the layout-detection that makes app.client.js load per-page). SPEC §52 / §40.

**Brief reminders:** **VERIFY-FIRST (S138 reverse)** — reproduce #15 on current HEAD `9ad78593` (build the 2-file repro from the issue: shell `app.scrml` + auth-gated `pages/dash.scrml`; confirm both clients emit `let _scrml_session` + the browser SyntaxError) BEFORE fixing. R26 (compile + `node --check` the emitted clients + confirm the page hydrates). **ADVERSARIAL (S215)** — adjacent shapes: app-shell WITHOUT auth-gated page; auth-optional page; multiple auth-gated pages; a page with its own `@session` read. FULL `bun run test` before DONE; re-baseline within-node allowlist if codegen shifts (S198).

## Items
1. **Verify + locate** `[status=open]` VERIFY-FIRST — reproduce on HEAD; locate the `@session` projection emit + the dual-bundle collision seam; report the chosen fix option (a/b/c) with the survey rationale.
2. **Dedupe/scope the `@session` projection** `[status=open]` — apply the chosen fix so app-shell + auth-page clients no longer collide on the top-level `let _scrml_session`. Single source of truth; page hydrates.
3. **Tests** `[status=open]` — regression test (REAL compiled 2-file source; assert single `_scrml_session` declaration / `node --check` clean / hydration wiring present). Flip/known-gaps file if one tracks it.

## Acceptance
The #15 repro (shell `app.scrml` + `auth="required"` + auth-gated `pages/dash.scrml`) compiles and the `/dash` page hydrates (the `inc()` button works); no duplicate `let _scrml_session`; `node --check` clean on all emitted clients; auth-optional + non-shell cases unregressed; full suite green.
