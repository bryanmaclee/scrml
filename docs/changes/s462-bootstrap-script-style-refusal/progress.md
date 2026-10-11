# s462-bootstrap-script-style-refusal — progress

- [x] brief archived
- [x] impl#1 refusal located: compiler/src/block-splitter.js markup-opener path (E-STYLE-001 / E-SCRIPT-001); SPEC §4.17 companion considerations
- [x] bootstrap refusal (parse.scrml scriptStyleAt / refuseScriptStyle at every opener site) + slice-m4/script-style.test.js
- [x] conformance cases block-grammar/{script-001-*, style-001-interp-body-pos, script-style-exact-name-neg} — impl#1 PASS, bootstrap PASS
- [x] severity.scrml + docs/bootstrap-conformance.md regenerated; gap resolved; impl#1 divergence filed (g-impl1-script-style-silently-dropped-in-each-and-logic-markup-s462)
- [x] corpus: 8/3640 files newly refused (all E-STYLE-001), 0 disagreements with impl#1
- [x] gates: pre-commit (34615/0), self-host-v2 slices (2260/0) + CI bootstrap steps, bootstrap-conformance --check, gen-bootstrap-severity --check, tracking tiers (5630/0), s34-census --check-new, host-global-scan --check (4 new expect-reject esm throws pinned, the S459 class), facts (1709→1715 regenerated), spec-index --check

## S239 review follow-ups (coordinator)
- [x] merged origin/main d6820a607 (known-gaps §0 generated hunk resolved + state.ts regen; master-list == origin/main)
- [x] impl#1 gap re-filed HIGH with the lift repro (re-reproduced: createElement("script"/"style"), no diagnostic); each/logic drop kept as the fail-safe sub-case
- [x] bootstrap printer escAttr `<`/`>` (html.scrml) + slice-m4/printer-escape.test.js (5 breakout forms fail without the fix); gap g-bootstrap-printer-escattr-raw-text-breakout-s462 filed RESOLVED
- [x] RESOLVED note scoped to what it closes
- [x] g-impl1-pre-code-raw-content-passes-script-style-s462 (MED, §4.17 self-contradiction flagged)
- [ ] gates
