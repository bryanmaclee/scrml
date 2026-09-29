# progress — s441-csrf-default-under-auth

- start: base 5c366fe15 (local origin/main ref; git fetch fails: no ssh key)
- reproduced over HTTP (Bun.serve + seeded session): auth="required", no csrf= → forged POST 200, row written
- fix 12d5c47e2: effectiveCsrfUnderAuth (compute-program-config + route-inference 8a/page); tests; harness compose-request fixes
- corpus: 21/2042 units changed, all `<program auth="required">` without csrf=, each == explicit csrf="auto" build
- spec+gaps e6912ed04: §40.2 normative default + provenance; gap resolved; new LOW gap g-csrf-attr-inert-without-auth-required
- gates: pre-commit 32361 pass / 0 fail; conformance 1047/1054 + 7 xfail, 0 FAIL
- DONE (push attempted; see report)
