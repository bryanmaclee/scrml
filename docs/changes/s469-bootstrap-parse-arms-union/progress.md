# s469-bootstrap-parse-arms-union — progress

Blockers #2 and #3 of `scrml-support/docs/workability/today-scrml-distance-2026-10-18.md` (§4 rows 2, 3).
Branch `s469-bootstrap-parse-arms-union` from origin/main `c64b9f053`.

## Done

- [x] **Comma arm lists (dpa-073 F2).** `parse.scrml` `parseArms` + `armEnd`: a depth-0 `,` ends an
  expression arm; one `,` after each arm is consumed; trailing `,` optional. Newline lists still read
  (dpa-073 F5). A list mixing both: `E-MATCH-ARM-SEPARATOR` (the existing §34 code whose meaning F2
  supersedes), once, at the first arm with no `,` before it. A stray `,` (`,,`, `{ , …`): one
  `E-PARSE-ARM`, no cascade. Covers `match` and `!{}` (one parser, S452).
- [x] **Engine message arms.** The bootstrap has none (SPEC §34 W-ARM-PIPE-LEGACY row says so). A
  state-child code-body run that starts with an arm head is now refused by name
  (`E-BOOTSTRAP-UNSUPPORTED "engine message arms … are not in the bootstrap"`) instead of
  `E-UNQUOTED-DISPLAY-TEXT`.
- [x] **Union type in an opener (§66.2.4, S451).** `parseOpenerType` reads `T | U …` (spaced or not);
  `T | not` (either order) → `TMaybe`; any other union is read whole and refused
  (`E-BOOTSTRAP-UNSUPPORTED`, naming the type). Applies to the own type AND typed attributes.
- [x] `severity.scrml` regenerated (E-MATCH-ARM-SEPARATOR now used by the bootstrap).
- [x] `slice-m2/typer.test.js`: four Rule-C tests used `T|not` as "an opener type that fails to
  parse"; it parses now, so they use `int&not` / `string&not` (same shape: one E-PARSE-TAG inside
  the type's span).
- [x] `slice-m4/arms-union-s469.test.js`: 18 tests (codes, AST shape, runtime).

## Constraint honoured

parse.scrml's own source is still newline-armed (impl#1 builds it and does not read arm commas). The
message string avoids `match <subj> {` — impl#1 rewrites that shape even inside a string literal.

## Next

- bootstrap acceptance cases (program (a), comma arms, union opener) + regenerate docs.
- pre-commit gate, push, PR.
