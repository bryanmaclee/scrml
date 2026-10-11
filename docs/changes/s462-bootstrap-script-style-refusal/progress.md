# s462-bootstrap-script-style-refusal — progress

- [x] brief archived
- [x] impl#1 refusal located: compiler/src/block-splitter.js markup-opener path (E-STYLE-001 / E-SCRIPT-001); SPEC §4.17 companion considerations
- [x] bootstrap refusal (parse.scrml scriptStyleAt / refuseScriptStyle at every opener site) + slice-m4/script-style.test.js
- [x] conformance cases block-grammar/{script-001-*, style-001-interp-body-pos, script-style-exact-name-neg} — impl#1 PASS, bootstrap PASS
- [x] severity.scrml + docs/bootstrap-conformance.md regenerated; gap resolved; impl#1 divergence filed (g-impl1-script-style-silently-dropped-in-each-and-logic-markup-s462)
- [x] corpus: 8/3640 files newly refused (all E-STYLE-001), 0 disagreements with impl#1
- [ ] gates
