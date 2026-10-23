# s469-impl1-arm-commas — progress

Branch `s469-impl1-arm-commas`, cut from `origin/land/s469-batch-5` (PR #1501 still open at start).
Gap: `g-impl1-arm-commas-refused-owed-by-dpa-073-f5-s469` (dpa-073 F5(1): impl#1 ACCEPTS arm commas).

## Baselines (taken before any edit, from this worktree at aa341cda0)
- corpus emit capture: 2860 enumerated · 1708 compiled · 8609 emitted · 0 syntax-failing.
- bootstrap conformance: PASS 252 / 1808.

## Steps
- [x] ast-builder: `match` arm level reads `,` as separator (collectExpr break + body loop), `,,`/leading → E-PARSE-001
- [x] ast-builder `parseErrorTokens` (`!{}` arms): same
- [x] engine-statechild-parser `parseMessageArms` + symbol-table E-PARSE-001 for stray commas
- [x] expression-parser `splitMatchArms` + codegen `collectMatchArms` raw-arm paths
- [ ] retire the old-meaning E-MATCH-ARM-SEPARATOR typer check
- [ ] corpus emit diff (must be zero)
- [ ] unit tests
- [ ] gap resolved, SPEC divergence text, regen
- [ ] codemod + corpus/conformance migration (separate final commit)
