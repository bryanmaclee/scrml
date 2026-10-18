# s469-bootstrap-toenum-match — progress

Blockers #4 and #5 of `scrml-support/docs/workability/today-scrml-distance-2026-10-18.md` (§4 rows 4, 5).
Branch `s469-bootstrap-toenum-match` from `origin/s469-bootstrap-parse-arms-union` (PR #1468), with
`origin/main` (#1467, `scrml-boot`) merged in.

## Done

- [x] **`Enum.toEnum(s)` (§14.4.1)** — `analyze.scrml resolveToEnum`: a typed built-in
  (`ValueFact.VToEnum`), `string -> E | not`; the typer checks the argument (`toEnumArgCheck`,
  E-TYPE-031). Arity E-CALL-ARITY; a struct receiver E-SCOPE-001; an enum with a payload variant is
  refused (E-BOOTSTRAP-UNSUPPORTED — §14.4.1 does not say what a name alone builds; fail closed).
  Lowered (`lower.scrml toEnumExpr`) to a Core `Match` of `===` literal arms + `_ :> not`: no property
  lookup, so `"constructor"` / `"__proto__"` / `"toString"` / `"hasOwnProperty"` give `not` (tested).
- [x] **The §18 plain-value `match`** — a subject that is not a failable result (`resolveHandled`
  routes it to `plainMatch` by the binder's own name rule, before the Ue2 refusal):
  - subjects: an enum, `T | not`, string / number / bool, a `S | not` of a struct (presence match);
    a struct E-TYPE-024; a tape — `T[g] | not` included — refused (fail closed: no unwrapped tape);
  - patterns: variant (payload bound positionally, E-TYPE-021), qualified `E.V` / `E::V` (§18.13,
    E-TYPE-VARIANT on a wrong `E`), literal (`"s"`, `1`, `-1`, `true`; E-TYPE-028 over an enum,
    E-TYPE-001 of another type), `not` (parser `APat.PNot`), `_` / `else`;
  - exhaustiveness: E-TYPE-020 (lists the missing variants), E-MATCH-012 (`T | not`, no `not` / `else`),
    W-MATCH-002 (string / number, or bool missing a value), W-MATCH-001 (redundant wildcard),
    E-TYPE-023 (duplicate), E-SYNTAX-010 (arm after the wildcard), E-MATCH-BARE-BINDER (`_ x`, `x`);
  - a subject whose type the binder cannot see (a call's result): the enum is inferred from the arms,
    and the typer (`plainSubjectCheck`) checks the arms against the real type;
  - value position anywhere (`${}`, operand, initializer, `return`), arms of one expression; statement
    position with every arm form (writes, blocks, leaves);
  - typer: arm values JOINed (§18.4); a non-exhaustive match also yields `not`; the arms after a
    `not` arm read a `T | not` place narrowed to `T`.
  - LOWERING: value → `Expr.Match`; statement → `Let scrut; Let pick = Match(scrut, pat_i :> i); if`
    chain on `pick` (payloads re-read through minted inner binders). Every arm is chosen by its own
    test: the printer makes a Match's last arm unconditional, so a trailing `_ :> not` / `_ :> -1` is
    always appended — a wrong password never falls into the last arm. Over an enum the absence arm
    comes first (a payload test reads `.variant`).
  - A failable `match` / `!{}` arm written with a `not` / literal pattern is E-TYPE-VARIANT — never a
    wildcard.
- [x] **Qualified unit-variant VALUES** `E.V` (`qualVariantValue`) — closes typer-s462 dd D5.
- [x] **E-MATCH-ARM-SHORTHAND-AMBIGUOUS** (S469 ruling; dpa-072 F9 — all arm kinds) in the parser.
- [x] **§45 `==` fix** (the panel's flag — confirmed): `(User | not) == (User | not)` compiled to `===`
  (the Maybe hid the struct). `isStructural` now picks EqPrim only for a provable scalar / unit-variant
  enum (and `T | not` of one); a struct, tape, payload enum, `T | not` of those, or an unproven type
  is EqStruct. Also an object literal into a `S | not` position is a `S` (`resolveObject`).
- [x] Program (a): compiles and RUNS (`acceptance/guess/a-guess*`). The report's text verbatim does
  not: `"length " + @inputVal.length` is string + int — E-OPERATOR-OPERAND-TYPE under S440 Gotcha
  Q1, correctly — pinned as `guess/a-guess-verbatim`. The cases show the length on its own line.
- [x] Acceptance cases (23 new): `guess/*`, `match/*`, `toenum/*`, `security/*` (login over an enum
  result, `T | not`, a string literal with and without `else` — the deny arm taken at runtime).
- [x] `slice-m4/match-s469.test.js` (29 tests). Old pins updated: error-model / error-rulings (the
  §18 unit is no longer refused), server-await-review (`s2/matchEnumScrut` → PASS on the server:
  wrong → REJECTED, right → WELCOME), typer-s462 D5, arms-union `(Guess.Yes)`.
- [x] `severity.scrml`, `docs/bootstrap-conformance.md` regenerated (PASS 210 → 222).
  Of the 32 cases the report said this unit blocks: 10 PASS, 1 FAIL (`e-type-025-asis-subject-pos`:
  `asIs` is not a bootstrap type), 21 still UNSUPPORTED on other walls (struct-field validator types
  `Role req` ×11, the deprecated `given` arm ×3, value-position block / leaving arms ×3, a handled
  failable inside an arm (Ue2) ×2, other ×2).

## Next walls for program (a)-like code

- No explicit int → string conversion (no method calls, no template literals): `"n=" + n` is refused
  and there is nothing to write instead.
- No payload-variant construction (`Shape.Circle(2)`): Core has no value for it; only `fail` builds one.
- Member access through `S | not` (`@u.name` after a `not` arm) is not in the binder (needs E-TYPE-046).
- Value-position block arms (`:> { stmts; v }`) — Core's Match arm is one Expr.
