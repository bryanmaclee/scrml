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
- [x] Review follow-up (S239 review of c78e325b4 → LAND, docs/gap round):
  - SPEC §13.2 limit widened: comparisons, coercion calls, assignment-in-condition, member reads,
    block-bodied arrows, library-mode modules, non-headless tool main are named OUTSIDE the trap.
  - CPS envelope: the helper now throws `Error("Internal Server Error", { cause: <reason> })`, so a
    non-protect CPS 500 envelope (which sends `err.message`) carries only the fixed text; SPEC says so.
  - known-gaps: g-server-block-arrow-body-raw-tokens-bypass-trap-s462 (MED),
    g-cstyle-for-condition-drops-string-quotes-s462 (MED, pre-existing) — both reproduced.
  - CORRECTION to the corpus claim above: 3 real server-output changes, not 1. The CLI differential
    saw only protect-001 because the other two FAIL to compile (no artifacts written):
    stdlib/compiler/module-resolver.scrml (`if (_scrml_assert_settled(existsSync(dirPath)))` ×2) and
    conformance/cases/auth/auth-async-stdlib-sync-callback-neg (a `.sort` comparator ternary). All
    three wrap sync calls or a refused compile — harmless.
