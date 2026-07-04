# BUILD canonical CSRF-token delivery + /_scrml/session projection endpoint (S238 follow-up)
change-id: csrf-canonical-session-projection-2026-07-04 · agent a62b09bfac38480e5 · base 327c6a0c · isolation:worktree
bryan ruled "build the canonical" (over accepting the S238 403-retry delivery).

Builds ON the S238 CSRF landing (26c284db): middleware surfaces session.csrfToken; validate checks header===session.csrfToken; 403 plants SameSite=Strict retry token. Today the token reaches the client via 403+retry on the first POST (spec-canonical vehicles unbuilt).

SPEC §39.2.3 mandates canonical delivery: server fn "reads or creates" the token + a <meta name="csrf-token"> HTML tag. Neither emitted. Also g-session-projection-no-server-handler: client fetch('/_scrml/session') (emit-client.ts:1664, @session §20.5) has NO server GET handler → @session null.

Build BOTH: (1) /_scrml/session GET handler returning session projection JSON {isAuth,userId,role}+csrfToken(csrf=auto) — resolves @session + projection delivery; (2) <meta name="csrf-token"> HTML-head tag (§39.2.3) — first-paint no-round-trip delivery; (3) client reads token from meta tag → first mutating POST carries X-CSRF-Token (no 403); KEEP the 403-retry as FALLBACK. Server validation unchanged (server-authoritative synchronizer).

Blocks (verbatim in dispatch): MAPS-first; STARTUP+PATH-DISCIPLINE (F4/S88/S90/S99/S126); PHASE-0 reverse-R26 (no /_scrml/session GET, no meta tag, first-POST-403s today); Rule-4 read §39.2.3 IN FULL; PHASE-3 (GET returns projection+@session hydrates, meta present, first-POST-passes, forged still 403s, fallback still works, node --check; FULL bun run test 0-fail incl updating S238 csrf tests for the new first-try-pass behavior; regression coverage; S215 adversarial meta-tag same-origin-readable synchronizer posture + csrf=off/no-auth untouched + /code-review); scope-split-if-meta-too-big; REPORT shape. Repros /tmp/csrf-canonical-r26/.
