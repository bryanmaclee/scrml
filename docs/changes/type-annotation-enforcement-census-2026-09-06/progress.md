# type-annotation-enforcement-census-2026-09-06

Measurement dispatch. Nothing here fixes anything; the deliverable is the number,
the method, and the re-runnable probe.

Re-run: `bun docs/changes/type-annotation-enforcement-census-2026-09-06/type-annotation-census.mjs`

## Headline

**10 / 36 (28%) of the type-annotation surface is enforced.**

| surface | enforced (compile) | enforced (runtime) | warned | DECORATIVE |
|---|---|---|---|---|
| base-type annotations (§7.5) — 29 positions | 4 | 0 | 0 | **25** |
| inline predicates / refinements (§53) — 7 positions | 3 | 3 | 0 | 1 |
| **total — 36 positions** | **7** | **3** | **0** | **26** |

Not counted in the headline, reported separately:

- **contrast** (8 positions) — non-annotation type-system checks, included to prove
  the harness can see enforcement when it exists: 6 ENFORCED, 1 DECORATIVE, 1 BROKEN-PROBE.
- **by-design** (2 positions) — `asIs` silence (correct) and `W-TYPE-031-UNPROVEN` (WARNED, correct).

The split matters more than the aggregate: the **refinement surface is 6/7 enforced**,
the **base-type surface is 4/29**. scrml has a working value-constraint engine. It is
not wired to plain type annotations.

## Method

Paired control/violation, every row compiled. `compileScrml()` rather than the CLI,
because the CLI collapses warnings to a bare count with no codes and therefore cannot
separate WARNED from DECORATIVE.

A control that errors marks the row BROKEN-PROBE and withholds its classification.
This caught 5 bad fixtures on the first pass (missing `@` sigil, wrong attribute form)
that would otherwise have been misread as enforcement.

A `RUNTIME-ENFORCED` class was added after finding that §53 boundary-zone positions
compile clean but emit a runtime guard. Detected by inspecting the emitted JS for the
`E-CONTRACT-001-RT` guard, not by assuming. Without this class the census would have
reported 4 false holes.

## The 26 DECORATIVE rows, partitioned by WHY

The brief requires separating "a code is specified and does not fire" from "no code
was ever specified". They have different fixes.

### (a) DECORATIVE BY EXPLICIT SPEC RULING — 8 rows

SPEC §7.5.1 was amended at S365 to state, normatively, that these positions are not
checked: *"Positions 2-5 are NOT YET CHECKED. A program that assigns a non-assignable
value at those positions SHALL compile."* `E-TYPE-031` exists; the SPEC says it does
not fire here; a widening order is already ruled.

| row | position | §7.5.1 |
|---|---|---|
| 01 | fn parameter — call-site argument | pos 3 |
| 02 | fn body operand | pos 5 |
| 03 | fn declared return type | pos 4 |
| 04 | `function` parameter | pos 3 |
| 05 | `function` body operand | pos 5 |
| 06 | `function` declared return type | pos 4 |
| 07 | state-cell `<n>: number` | pos 2 |
| 08 | state-cell `<n>: int` | pos 2 |

**All three axes of bryan's twenty lines are in this bucket.** He did not hit an
implementation bug; he hit the documented edge of the implemented language.

### (b) SPECIFIED AND DOES NOT FIRE — 6 rows

A §34 code exists, its stated fire condition is met, and nothing is emitted.
These are defects, not scope.

| row | position | code | §34 says |
|---|---|---|---|
| 11 | `let x: number = true` | E-TYPE-031 | §7.5.1 SHALL emit at position 1 for annotation in {number,string,boolean} + literal of a different primitive type |
| 21 | `render deco()` on `snippet(t: string)` | E-TYPE-072 | "a parametric snippet with zero or two-plus arguments" |
| 25 | unguarded deref, `let u: User?` | E-TYPE-046 | "any receiver whose type admits `not`" |
| 26 | unguarded deref, `fn f(u: User?)` | E-TYPE-046 | same |
| 27 | `fn f() -> string { return not }` | E-TYPE-043 | "directly via `return not` or implicitly by falling off the end" |
| 28 | `@n.notAField` where `<n>: number` | E-TYPE-004 | "Struct field access on non-struct type" |

Row 36 (refinement on a struct field — no compile error, no runtime guard) is a
seventh candidate; §53.3.3 specifies an assignment-site check for constrained types
but does not name the struct-field construction site explicitly, so it is left
unclassified rather than over-claimed.

### (c) NO CODE WAS EVER SPECIFIED — 12 rows

Rows 12 (`int` — outside §7.5.1's enumerated `{number,string,boolean}` set), 13
(non-literal initializer — §7.5.1 scopes position 1 to "syntactically-determined
literal"), 14 array element, 15 union member, 16 struct field construction, 17 enum
payload TYPE (E-TYPE-082 covers ARITY only), 18 map value, 19 map key, 20 component
prop (§34's E-TYPE-031 row states this position has ZERO push sites), 22 schema
column vs inserted value, 23 fn call arity (searched §34 — no general fn-arity code
exists), 45 qualified unknown variant `Enum.Purple`.

## HIGH — the one position SPEC claims to check does not hold its own SHALL

§7.5.1's single normative guarantee:

> The compiler SHALL emit `E-TYPE-031` at position 1 — a `let` / `const` declaration
> carrying an unpredicated primitive annotation (`number`, `string`, `boolean`) whose
> initializer is a syntactically-determined literal of a different primitive type.

Measured cell by cell (verified by execution):

| annotation \ literal | `"str"` | `42` | `true` |
|---|---|---|---|
| `string`  | — | **E-TYPE-031** | silent |
| `number`  | **E-TYPE-031** | — | silent |
| `boolean` | **E-TYPE-031** | **E-TYPE-031** | — |
| `int`     | silent | silent | — |

4 of 6 off-diagonal cells fire. **Both misses are a boolean literal as the initializer.**

Root cause, verified by reading `compiler/src/expression-parser.ts` at
`classifyLiteralFromExprNode`: the switch handles `litType === "number"` and
`litType === "string"` and falls through to `{ kind: "unconstrained" }` for
everything else. Its return type is declared `value: string | number` — boolean is
structurally excluded from the classifier's value domain. The sibling regex helper
`extractInitLiteral` (`compiler/src/type-system.ts`) has the same two branches and no
`true`/`false` case.

Downstream, the E-TYPE-031 arm in `type-system.ts` at `annotateNodes` guards on
`srcInfo.kind === "literal"`, so a boolean initializer never reaches the comparison.
The arm's own `primitives` set DOES include `"boolean"` — the annotation side is
correct; the literal side never produces a boolean to compare against.

`int` is a §14.1.2 built-in type name but is not in §7.5.1's enumerated set, so its
row is a scope gap rather than a violated SHALL.

## The `asIs` / UNPROVEN band — what legitimately excuses a hole

- `asIs` (row 43) is silent at both halves. Correct and by design (§14.7): a signed,
  greppable opt-out. Excluded from the decorative count.
- `W-TYPE-031-UNPROVEN` (row 44) fires correctly. Verified: `let v = src()` where
  `src` has NO return annotation → warning naming node kind `call`; the same code with
  `fn src() -> number` → silent, because inference succeeds. So a `fn` return annotation
  IS consumed by declaration-site inference.
  - That makes row 13 sharper, not softer: at `let x: string = src()` where
    `src() -> number`, the compiler has proven `number` (no UNPROVEN warning fires) and
    still does not use it for assignability.
- SPEC §7.5.2's two disclosed gaps both reproduced exactly:
  - `const r = match x { ... }` → no `W-TYPE-031-UNPROVEN` (the `matchExpr` sidecar
    bypasses the guard).
  - An un-annotated `function eat(powerUp)` matching on its parameter →
    `E-TYPE-025: Cannot match on asIs-typed subject`. The parameter was bound to
    `asIs` by the compiler, and the diagnostic then blames the author for a hatch
    that is not in the source.

## Collateral findings (surfaced, not fixed, outside the headline)

1. A `fn` parameter annotation does not feed bare-variant inference. `fn f(c: Color)
   { return c is .Red }` — type-correct scrml — fails with `E-VARIANT-AMBIGUOUS`
   ("the position type is not an enum or union of enums"). The same expression on a
   state cell (`<c>: Color`) compiles. Row 46, recorded as BROKEN-PROBE because the
   control does not compile; the non-compiling control IS the finding.
2. `E-TYPE-063` fires for a bare `.Purple` on a cell receiver but not for the
   qualified `Color.Purple` anywhere tested (row 45).
3. `match` exhaustiveness DOES consume a `fn` parameter annotation (row 38 fires
   E-TYPE-020), while `is` does not. The parameter annotation is consulted by some
   consumers and not others.
4. Adding a PREDICATE to an annotation turns on checking that the bare annotation
   does not have, at the same position: `<n>: number = "s"` is silent (row 07),
   `<amt>: number(>0) = -5` is `E-CONTRACT-001` (row 32). Likewise `fn charge(a: number)`
   called with `"QQQ"` emits nothing (row 01) while `fn charge(a: number(>0))` emits a
   runtime guard (row 33).

## Log

- Startup verified: worktree root, clean tree, `merge-base HEAD origin/main == origin/main`
  at `f2338816`. `bun install` + `bun run pretest` (34 artifacts in
  `samples/compilation-tests/dist/`).
- Reproduced bryan's case at `f2338816`: exit 0, zero errors / warnings / lints.
- Built the paired harness; first pass surfaced 5 broken probes; fixed.
- Added the RUNTIME-ENFORCED class after inspecting §53 boundary codegen; verified the
  guard throws by executing the emitted bundle.
- Full pre-commit suite green (29756 tests / 1313 files) on the harness commit.
