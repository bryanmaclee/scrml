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

- [x] commit 1 (parser + unit tests) through the pre-commit gate (37,767 tests, 0 fail).
- [x] **Acceptance cases** `compiler/self-host-v2/acceptance/**` (conformance layout: case.scrml +
  expected.json = the TARGET), graded by `scripts/bootstrap-conformance.ts --cases`; pinned by
  `slice-m4/acceptance.test.js` (STATUS table = today's verdicts). 7 cases: 5 PASS (4 with an
  executed runtime half), 2 UNSUPPORTED (general union; program (a)).
  Not in `conformance/cases/**`: SPEC §18.2 still forbids arm commas (dpa-073 not in SPEC yet) and
  impl#1 does not read them (F5 step 1 owed) — no carried gap to xfail impl#1 against.
- **Program (a) now stops at:** `Guess.toEnum(@inputVal)` (E-BOOTSTRAP-UNSUPPORTED call allowlist,
  blocker 4); the `not :>` arm pattern (E-PARSE-ARM ×3 — the parser has no `not` pattern; part of the
  §18 plain-value match unit, blocker 5); the value `match @g {…}` inside `${}` (two
  E-BOOTSTRAP-UNSUPPORTED: handled-failable in a larger expression; match over a non-failable value).

- [x] commit 2, push, PR #1468.

## Review r1 (FIX) — addressed

1. **HIGH — a tape inside an opener union escaped its grants.** `Entry[free, append] | not` became
   TMaybe(TSeq); analyze's grant / `let` checks do not see through `.Maybe`, so `.shift()`, `= []`,
   `= not` compiled clean. Fix: `parseOpenerType` refuses every union with a sequence member
   (E-BOOTSTRAP-UNSUPPORTED "a sequence in a union type …"), any order, own type or typed attribute.
   The type falls back to the tape alone, so the `let` check also fires (fail-closed). Tests: the
   repro with / without `let`, `not | T[…]`, unspaced, `Guess | not[free]`, a typed attribute, and
   the plain tape unaffected.
   Message: a locked SEQUENCE's E-WRITE-NOT-GRANTED said "Declare it `let <…/>`" — advice that
   leads to E-GRANT-LET-ON-SEQUENCE. A sequence now gets "needs `replace` in the type's grants"
   (analyze.scrml `wholeFieldWrite`). (The brief cited §66.12.6; there is no such section — the
   message cites §66.12.2 / §66.12.3.)
2. **LOW — bare `|` cascade.** A member that failed to parse (`Guess |=`, `Guess | />`) now gets its
   E-PARSE-TYPE only, no second union refusal.
3. **LOW — pinned, not built.** `armEnd`'s depth-0 `,` counts token brackets only: a markup arm body
   (`.Ok(v) :> <b>ok, yes</b>,`) would split at its text's `,`. Markup arm bodies are not in the
   bootstrap — today it fails loudly (E-PARSE-UNCLOSED cascade, no artifact). Comment corrected; a
   PIN test in arms-union-s469.test.js breaks when markup arm bodies land, forcing the boundary rule
   to learn markup depth.

## Review r2 (LAND-W-F/U) — addressed

1. **HIGH — the same escape through CODE-position types** (pre-existing on main): `parseType`
   wrapped `T[…] | not` in TMaybe for return types, parameters, local annotations and struct fields.
   Fix: ONE shared check, `seqUnionCheck` (parse.scrml), used by both `parseOpenerType` and the
   code-position `maybeType`; `not | T` (either order) now parses in code positions too.
   **Deviation from the brief, deliberate:** the check refuses a GRANTED tape in a union, not every
   tape. A blanket refusal broke 5 existing slice-m2 tests (`int[] | not` params / locals / a struct
   field; `<each in=>` over `S | not`) — and §17.7.2 explicitly admits `S | not`. An ungranted
   `S | not` has nothing to escape; the one open path for it (`let` → `replace`) is closed in
   analyze: the E-GRANT-LET-ON-SEQUENCE check now sees through `| not` (`seqElem(unMaybe(ty))`).
   Without `let` it is locked (whole write and `.shift()` → E-WRITE-NOT-GRANTED). Tests: repro A
   (return type), repro B (struct field), parameter, local, `not | T[…]`, ungranted controls.
   Residual (not in this PR): a struct field written `let xs: int[]` is not E-GRANT-LET-ON-SEQUENCE
   (the check exists only for cells) — pre-existing, also for plain `T[]`.
2. **LOW — E-DERIVED-WRITE advice on a tape-typed derived cell** no longer says "declare it `let`";
   it names E-GRANT-LET-ON-SEQUENCE and `T[replace]`. Non-sequence derived cells keep the advice.
