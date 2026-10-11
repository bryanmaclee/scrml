# S462 Q20 — server Promise trap — progress

- [x] Startup: merged origin/main (already up to date at a9aa81eff), bun install, pretest.
- [x] BRIEF.md archived (76d071902).
- [x] Runtime helper + emit wrap + unit + executed tests (9bccb1eea).
  - helper `_scrml_assert_settled` (emit-server SERVER_ASSERT_SETTLED_HELPER), injected on use.
  - positions: if / else-if / while / do-while / C-for condition (emitConditionField), `!`, `&&`/`||` operands, ternary condition.
  - operand: ident call (optional incl.) resolving by IMPORTED name to a scrml: stdlib export (module-resolver isStdlibImportedCallee); NOT gated on async-ness.
  - active only inside generateServerJs (setServerPromiseTrap, restored in finally) and mode "server".
  - test seam: module-resolver `__testOnlyForceAwaitClassifierMiss` (tests only).
- [x] SPEC §13.2 sentence + provenance; SPEC-INDEX regen (b30d60b9e).
- [x] FACTS.md regen.
- [x] Gates (2026-10-11): pre-commit 34851 pass / 0 fail; tracking tiers 5681/0/10 skip;
  browser-baseline --check PASS (48); s34-census --check-new PASS; host-global-scan --check 0 violations;
  facts / spec-index / bootstrap-conformance / severity --check PASS; snippet-gate 128/0;
  corpus-compile-floor PASS; types:check unchanged; conflict-marker + delta-lint PASS.
- [x] Emit differential (base a9aa81eff archive vs head, corpus + ../giti + ../flogence, 2913 sources):
  1 real server-file change (samples/compilation-tests/protect-001-basic-auth.server.js — helper +
  `if (!_scrml_assert_settled(verifyHash(...)))`); 164 artifact + 107 diagnostic diffs are the base
  checkout path only (verified by normalization); 0 compile-outcome / syntax / load-context changes.
