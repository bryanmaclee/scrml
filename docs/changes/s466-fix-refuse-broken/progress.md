# progress — s466-fix-refuse-broken
- start: branch cut from f28b58a31, BRIEF archived
- repro: brace loss is REAL on disk (not the diff printer) — it is the `unwrap-logic` rule (fix-s66.js,
  depth-0 `${}` of items inside `<program>` unwrapped). It does the same on the compiling twin (intended
  migration); on the broken file its "same codes before/after" verify is vacuous.
- built: CLI whole-file gate (fix.js, compileErrorsInPlace in fix-verify-shared.js), exit 3 on refusal;
  in-rule refusal in client-server-call + sql-failable; applyFixRules split out; tests
  (fix-refuse-broken.test.js new; non-compiling fixtures in fix-s66 / csc / sql-failable tests now pin
  the refusal). Commands suite 545/0.
- SPEC §63.4 bullet + provenance; SPEC-INDEX regenerated.
