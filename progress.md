# progress — s469-template-interp-failable (SECURITY, impl#1)

Base: origin/s468-failable-alias-and-match 71c4aa4c0 (#1444 was OPEN, in the merge queue, at cut time).

- [x] n14 probe family (security-failable-pack): 10 shapes, all FAIL (wrong password logs in) before.
- [x] expression-parser.ts: template interpolations read by ONE reader (`_tplExprs` / parseExprToNode);
      rawSource threaded at 3 dropped recursion sites (arrow expr body, spread, param default). n14 → all PASS-REFUSED.
- [x] failable-value-calls.ts: fail closed on empty-raw non-Literal hatch (E-ERROR-002, sets unreadable);
      ParseError hatch sets unreadable.
- [x] handled forms still compile clean (unit tests: e-error-002-template-interp-s469). NOTE: `!{}`/match INSIDE an interpolation is E-CODEGEN-INVALID-LOGIC on main too (not accepted today).
- [x] LOW: object shorthand `{ check }` as fn-value (walker object case + fnValueRefs).
- [x] MEDIUM: exported const alias refused (type-system checkFailableExport; export-decl init now walked). n15 family (7).
- [x] known-gaps: 2 new resolved entries + exported-alias gap resolved; state.ts --write.
- [x] gate: 38659 pass / 0 fail (f9968e978).
- [x] browser JUnit vs origin/main (both run from scratch-dir archives): 1679 pass / 48 fail / 47 skip on
      both, zero per-test differences. In THIS worktree one test (`<match> arm, ;-sequence`) fails
      after browser-gated-handler-narrowing (stale document listener, colliding `_scrml_attr_onclick_4`
      key) — it fails identically with the BASE sources checked out here, so it is path/environment
      dependent, not this change.
