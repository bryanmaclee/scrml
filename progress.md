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
- [ ] gate + browser JUnit comparison vs main.
