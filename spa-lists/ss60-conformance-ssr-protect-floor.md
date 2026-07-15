# sPA ss60 — conformance authoring: SSR §52.8 + protect-floor §14.8.9 (freeze-gate: pin what S234-235 just shipped)

**Launch:** `read spa.md ss60` · **Branch:** `spa/ss60` · **Worktree:** `../scrml-spa-ss60`

**Fill:** conformance-authoring toward the freeze bar (S235) — and the do-it-right bar in action: the SSR A-terminus (§52.8, D1+D2+D3 landed S234-235) and the §14.8.9 protect-floor (the V1-security spine, S230-232) are IMPLEMENTED-and-claimed but have ZERO conformance cases. A feature isn't "done" until it's conformance-proven; this pins both. NEW S235 · **fireable now** (data-only; disjoint) — but see the harness-verify note (item 1).

**Method + harness ceiling + escalate discipline:** see `spa-lists/ss56-conformance-engine-51.md` §"What conformance authoring IS" (same). Both surfaces reuse the §52 server-authority ingestion (mirror `conformance/cases/server-fn/*` + `auth/auth-003`).

**⚠️ HARNESS VERIFY FIRST (item 1 gate):** the SSR runtime half needs the harness to run the **server compose handler** (`_scrml_ssr_compose_handler` — the first-paint HTML), then assert `domAnchored` on the composed markup. The current adapter (`conformance/adapters/impl1-ts.ts`) runs the ENTRY bundle CLIENT-side; VERIFY whether it exposes / can invoke the SSR compose path. If YES → author the SSR runtime half. If NO → this is a small ADAPTER EXTENSION (invoke the compose handler + seed `window.__scrml_ssr_state`) — a track-B item; ESCALATE to the PA, author the codes/redaction-shape meanwhile. (Reference the S235 D2 browser test `compiler/tests/browser/ssr-a-terminus-hydration.browser.test.js` — it drives exactly this compose+hydrate shape in happy-dom; the adapter can borrow that harness.)

## Shared ingestion
The §52 server-authority + §14.8.9 egress-redaction floor: §52.8 (SSR pre-render) · §52.6 (read-authority load) · §14.8.9 (protected-column redaction at EVERY compiler-emitted client-egress sink — server-fn return / SSR / channel `broadcast()` / SSE) · §14.8.7 (typed SQL rows) · `reveal()` declassification. Codes: `E-PROTECT-004` · `I-PROTECT-STRIP-001`. Mirror `conformance/cases/server-fn/*`.

## Core files
`conformance/README.md` · `conformance/adapters/impl1-ts.ts` (verify SSR-compose support) · `conformance/cases/server-fn/` + `conformance/cases/auth/` (existing) · `compiler/tests/browser/ssr-a-terminus-hydration.browser.test.js` (the SSR compose+hydrate harness to borrow) · `compiler/SPEC.md` §52.8 + §14.8.9 (normative)

## Items (least-ingestion-first)
1. **SSR §52.8 first-paint render** (RT — HARNESS-VERIFY per note above) `[status=codes-landed · runtime adapter-gated]` — a server-authority `<each>` renders its rows INTO the first-paint HTML (keyed `data-scrml-key`); assert `domAnchored` on the composed markup shows the rows BEFORE client JS (the D1 shape). If the adapter can't compose SSR → escalate (adapter extension) + author the codes half.
2. **§14.8.9 protect-floor: server-fn return redaction** (RT) `[status=codes-landed · runtime adapter-gated]` — a `protect=` column SELECTed + returned from a server fn is ABSENT from the client-visible state/DOM (redacted at the egress sink); the non-protected columns pass. Harness-clean (server-fn fetch-mock path).
3. **§14.8.9 SSR redaction** (RT — same verify as #1) `[status=escalated — runtime adapter-gated]` — the SSR first-paint rows have the protected column ABSENT (the D1 renderer feeds on redacted rows); assert the protected value never appears in the composed HTML.
4. **`reveal("col")` declassification** (RT) `[status=codes-landed · runtime adapter-gated]` — `reveal("col")` at the sink → the column IS present (the sole sink-checked declassification).
5. **protect codes** (codes) `[status=landed]` — `E-PROTECT-004` (the egress-boundary fail-closed) + `I-PROTECT-STRIP-001` (dynamic-SQL strip-all info); the raw/FFI-egress fail-closed shape.
6. **channel/SSE protect egress** (codes now; **RT harness-gated — WS/EventSource**) `[status=codes-landed · runtime WS/SSE-gated]` — the §14.8.9 floor also wraps channel `broadcast()` + SSE frames (S232); author the codes/shape, FLAG the WS/SSE runtime as harness-gated (track B — no WebSocket/EventSource driver).

**DoD:** SSR §52.8 + protect §14.8.9 move UNCOVERED→conformance-covered (SSR runtime pending harness-verify; channel/SSE runtime flagged); all green; divergences + adapter-gaps escalated. This closes the conformance loop on the V1-security+SSR floor.

## Progress
`spa-lists/ss60.progress.md`. Land per-item on `spa/ss60`; ping PA inbox. Do NOT push. PA re-integrates + run.ts green. ESCALATE: the SSR-compose adapter gap (item 1/3), the WS/SSE driver gate (item 6), any impl#1-vs-SPEC divergence.

## Wave-2 — tier-1 code-exhaustive completion (S256 audit)
Items 1-6 above are LANDED — do NOT touch them. This section adds the freeze-blocking **security floor +
route-serialization** codes the S256 tier split (`scrml-support/.../v1-conformance-coverage-2026-07-15/`)
places in tier-1 (the audit's TOP FINDING). Same method + core files as above. **CORRECTNESS ESCALATION
(FINDINGS §"security trio"):** the three `W-AUTH-*`/`W-SERVERLOAD-*` floors currently fire only a
**warning** and are unpinned — before authoring, the PA/user must rule whether they should be **errors**
(freeze-blocking regardless of the coverage decision). Author the codes half against CURRENT severity;
FLAG the error-vs-warning question per code. Grep each code live in `compiler/src` for the exact trigger.

7. **W-AUTH-CONTENT-NOT-GATED** (codes/severity) `[status=pending]` — §40.9.5: `<auth role="X">` gates the JS but ships the HTML to ALL viewers (`auth-graph.ts:584`, one warning per `<auth role>` site). Author pos (gated content, HTML shipped ungated → warning) + neg (properly server-gated → silent) + a `severity` assertion. **ESCALATE error-vs-warning.**
8. **W-SERVERLOAD-UNGATED** (codes/severity) `[status=pending]` — §52.15: the `/__serverLoad/<name>` read route serves server-authority data PAST the auth gate (`type-system.ts:10799`). Pos (server-authority read reachable ungated → warning) + neg. **ESCALATE error-vs-warning.**
9. **W-AUTH-LOGIN-MISSING** (codes/severity) `[status=pending]` — §40: an auth gate with no reachable login route (`auth-graph.ts:440`, compilation-scoped). Pos + neg (login route present → silent).
10. **W-SSR-PRERENDER-UNSCOPED** (codes/severity) `[status=pending · being fixed→info-lint]` — §52.15/§52.8: cross-user rows baked into first-paint HTML (`type-system.ts:10820`). **NOTE:** the SSR fix in flight converts this hole into a fixed+pinned **info-lint** — author against the POST-fix state (verify severity live: `info`, not `warning`); coordinate with the SSR work.
11. **E-PROTECT-003** (codes) `[status=pending]` — the §14.8.9 protect egress-boundary fail-closed error (`batch-planner.ts:89` union; the raw/FFI-egress path). Pos (unredacted protected column reaches an egress sink → error) + neg.
12. **E-PA-002** (codes) `[status=pending]` — protect-analyzer cannot build the shadow DB: missing `CREATE TABLE` for at least one table (`protect-analyzer.ts:821`). Pos + neg.
13. **E-PA-005** (codes) `[status=pending]` — protect-analyzer: tables-in-scope unspecified ("Specify which tables to bring into scope", `protect-analyzer.ts:1042`). Pos + neg. (`E-PA-003/004/007` are tier-2 — excluded.)
14. **E-PA-006** (codes) `[status=pending]` — protect-analyzer: SQLite DB path unspecified (`protect-analyzer.ts:997`). Pos + neg.
15. **E-ROUTE-003** (codes) `[status=pending]` — §61 server-fn arg/return **serialization** contract violation (`type-system.ts:4420`, "Server function ..."). A non-serializable arg/return across the client↔server boundary → error. Pos + neg (serializable shape → silent).
16. **E-ROUTE-004** (codes) `[status=pending]` — §61 server-fn serialization sibling (`type-system.ts:4397`). Pos + neg. (`E-ROUTE-001` computed-member → ss63.)
17. **I-AUTH-REDIRECT-UNRESOLVED** (codes/severity) `[status=pending]` — §40: an auth redirect path that cannot be statically resolved (`auth-graph.ts:17`, info-lint). Pos (unresolvable redirect target → info) + neg. TIER-SPLIT "I-AUTH-REDIRECT".

**Wave-2 DoD:** all 11 security/serialization codes pinned (codes + severity partition); the 3-4 error-vs-warning correctness questions ESCALATED per code (not silently enshrined at warning); run.ts green.
