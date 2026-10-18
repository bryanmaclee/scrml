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

## #1471 review fix round (verdict FIX)

- [x] **HIGH-1** — a `-> T | not` function falling off the end gave JS `undefined`; the absence arm
  tested `=== null`, so `undefined` took the PRESENT arm (a wrong-password WELCOME, client and server).
  (1) `print.scrml litTest`: the absence pattern prints `== null`, as `is not` (IsNot) does — every
  absence arm / pattern, value and statement form. (2) `analyze.scrml fallOffPass` REFUSES a function
  with a declared non-void return type that can reach the end of its body: `-> T` → **E-TYPE-043**
  (§17.6 / §34, existing code); `-> T | not` → **E-BOOTSTRAP-UNSUPPORTED** (whether falling off means
  `not` is the PA's question for bryan — NOT lowered to an implicit `return not`; note SPEC §42.7
  already says a SERVER function's fall-off "SHALL be treated as returning `not`" — the PA should
  rule that alongside); a body whose tail is an unreturned value expression (§48.11's implicit tail
  return, which the bootstrap does NOT implement — it printed `acc + 1;` and returned `undefined`) →
  **E-BOOTSTRAP-UNSUPPORTED** naming §48.11. A path is closed by `return <v>`, `fail`, an `if`/`else`
  whose branches all are, or an exhaustive statement `match` whose arms all are. Functions with a
  parse error in them, an unresolved return type, `!` functions and `-> void` are not judged.
  §42.5 "no scrml program SHALL directly emit `undefined`": with the fall-off refused, every non-void
  function ends in an explicit `return` (a bare `return` lowers to `null`); a test asserts the
  security programs' JS never names `undefined`.
- [x] Fall-off logins: `security/falloff-{value,stmt,string,enum}` (refused) and
  `security/return-not-*` (runtime: wrong → denied); server family `s5` in
  `server-await-probes-review.js` (4 REFUSED, 4 PASS on the real server artifact).
- [x] **L1** dead `not` arm (subject cannot be `not`) → **E-TYPE-044** (existing: §17.6, a presence
  test on a type without `| not`), binder-known and typer-known subjects.
- [x] **L3** `asIs` → E-BOOTSTRAP-UNSUPPORTED by name (was E-TYPE-UNKNOWN).
- Conformance after the fix round: PASS 210 (main) → **217**: +9 new PASS, of which **3 vacuous**
  (`ctrl-switch-forbidden-match-neg`, `e-type-026-match-in-logic-neg`,
  `e-type-081-partial-match-render-neg`), and −1 (`defer/fn-prohibition-applies-neg`, now refused
  for the missing §48.11 tail return). The round-1 count of 222 included 5 PASSes that relied on the
  missing tail return (the function silently returned `undefined`; `e-type-025-enum-subject-neg`,
  the reviewer's 4th vacuous one, was among them) — they are now UNSUPPORTED, which is the honest
  bucket. Of the report's 32: 6 PASS, 26 UNSUPPORTED (no FAIL).
- **Next wall added:** §48.11 implicit tail return (a return-typed function's tail expression).
