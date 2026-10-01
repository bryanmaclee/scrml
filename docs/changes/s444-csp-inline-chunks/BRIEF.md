# change-id: s444-csp-inline-chunks

SECURITY probe first, fix only if real (S435 policy admits impl#1 security fixes).

Hypothesis (dpa-062 deep-dive, route-to-PA R2 — UNVERIFIED): compiler/src/codegen/emit-html.ts (~L4395-4590)
emits an INLINE `window._SCRML_CHUNKS` script and an INLINE role-detection bootstrap when per-route chunks are
emitted (SPEC §40.9 / Approach A route splitter). Under headers="strict" (the CSP scrml emits; S441 RULING 1
precedent moved scripts to same-origin src) those inline scripts would be REFUSED by the browser -> chunk
loading / role gating breaks (or a fallback path fails OPEN).

1. Reproduce: multi-page multi-role app with per-route chunk emission + headers="strict"; inspect emitted HTML
   for inline script without src and the CSP; check under a real CSP-enforcing environment if available,
   else reason from CSP string (say which).
2. If NOT reproduced: report with evidence; no code change.
3. If reproduced: fix by S441 precedent (same-origin external script) or per-build sha256 hash in CSP (dpa-062
   call 4). Fail-closed. Tests (emission + CSP-string assertion that every inline script is covered), R26
   recompile of examples/ samples/ (diff report), full gate + top-level compiler/tests/*.test.js. File/resolve a
   gap in docs/known-gaps.md with locus + prov=dd:prepaint-opt-in-dpa-062-2026-09-30 route R2.
Push branch fix/s444-csp-inline-chunks to origin. No PR.
