# s460-aprime-ternary progress

- [x] startup: branch s460-aprime-ternary from origin/main 3d0e54e21; bun install; pretest
- [x] N1 + N3 (09f9a8dbf): analyze.scrml condUnresolvedWhole / armsOf / armWhat / condArmOperands; condOperands walks
      ternary arms; typeIfAttr names `else-if=`. 13 new tests in slice-m2/typer-s460.test.js (incl. a runtime
      test: a `T | not` arm lowers to an absence check, `0` present).
- [x] SPEC (b7ef74309): §42.4 statement 10 — ternary arms of the condition's value + provenance line; PA scope
      addition — veto-window markers for `is some` narrowing (§42.2.2a, §42.3.5 item 2, + provenance in
      §42.2.4 and §42.4), `show=` as a condition (§17.2, §42.4) and E-CHANNEL-HANDLER-SHADOW (§38.10.2) replaced
      with ruling:user-voice-scrml.md S460 "keep the code, accept both readings, go". SPEC-INDEX + FACTS regen.
- [x] conformance + N2 (56af7caaa): condition/unresolved-ternary-arm-neg (xfail.impl1-ts via --xfail-signature);
      bootstrap-conformance --write (condition/ 18 of 21 PASS); known-gaps corrected (was "14 of the 17";
      real figure at base 17 of 20, now 18 of 21).
- [x] self-count (bootstrap front end single-file, base 3d0e54e21 vs head, E-COND-NOT-BOOLEAN +
      E-OPERATOR-OPERAND-TYPE): self-host-v2 65 files 0 delta; conformance 1574 files: only the new case
      (+3/-1); examples 71: 0; samples 880: 0; stdlib 53: 0.
- [x] gates: core (pre-commit 33755 tests pass), conformance 1472 pass + 65 xfail / 1537, 0 FAIL, bootstrap CI
      suites green, bootstrap-conformance --check current, types:check OK (184 unchanged), s34-census PASS,
      facts / SPEC-INDEX / severity current, host-global-scan 0 violations.
