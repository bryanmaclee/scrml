# progress — s441-csrf-default-under-auth

- start: base 5c366fe15 (local origin/main ref; git fetch fails: no ssh key)
- reproduced over HTTP (Bun.serve + seeded session): auth="required", no csrf= → forged POST 200, row written
- fix 12d5c47e2: effectiveCsrfUnderAuth (compute-program-config + route-inference 8a/page); tests; harness compose-request fixes
- corpus: 21/2042 units changed, all `<program auth="required">` without csrf=, each == explicit csrf="auto" build
- spec+gaps e6912ed04: §40.2 normative default + provenance; gap resolved; new LOW gap g-csrf-attr-inert-without-auth-required
- gates: pre-commit 32361 pass / 0 fail; conformance 1047/1054 + 7 xfail, 0 FAIL
- DONE (push attempted; see report)
- fix round (PA security review of 32534fc8a, DO-NOT-LAND): merged origin/main (6eeb03408)
- F1 compose-route doc gate + F3 stale-meta retry sync + WS Origin check (ruling "yes on origin check") -> 15e7efbc6
- F5 session/destroy CSRF: filed (not a one-line gate); gaps filed: formFor no-JS fallback (MED), auth= invalid/dynamic fail-open (HIGH); WS gap filed + resolved
- corpus r2: 68 server.js doc-gate, 51 server.js origin check (every channel app), 50 client.js sync helper; 0 other changes
- conformance 1063/1070 + 7 xfail, 0 FAIL; pre-commit 32492 pass / 0 fail
- round 3: F1a test now asserts anon compose 302; F1b dev serves compose handlers only via static resolution (6dcbce350); gaps filed: g-page-auth-required-protects-nothing (HIGH), g-nested-program-auth-attr-silently-ignored (HIGH, measured fail-open, not the LOW the brief expected); SPEC §40.2 CSRF bullet scoped to <program>; the proxy MUST strip X-Forwarded-*
- why red tests were committed: csrf-canonical-delivery's runtime test returns early when happy-dom globals exist (the full-suite run), so it passed vacuously; compiler/tests/commands is not in the pre-commit gate
