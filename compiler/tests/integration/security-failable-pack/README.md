# security-failable-pack

The wrong-password probe corpus of the §19.4.3 failable class (E-ERROR-002, a `match` on a failable
result), kept as a permanent impl#1 gate. Built S468 fix round 1 (branch `s468-failable-alias-and-match`)
from the adversarial review of the frozen head `7ecae57eb`, so the class has an executable floor the way
the §13.2 await class has `../security-await-pack`.

Every shape is a login page: `check(p)! -> AuthErr` fails `.Denied` on a wrong password, and `login(p)`
reaches `check` through some position — a `match` subject (direct, through an operator, through an alias,
through a returned function), a callback, a parameter default, an event-handler attribute, a server
function. If the compiler accepts an unhandled failable result, or lowers a `match` that compares the
error object as a plain value (or reads a plain enum value as `.Ok`), the wrong password logs in.

| file | what |
|---|---|
| `shapes/<family>.js` | the shapes, copied verbatim from the reviewer's scratch dir (`n1`–`n8` client, `s1`–`s2` server) and the fix-round dev's (`n9`, `n10`); S469 added `n11` (a failable `match` in every event-handler value form × container: top level, `<each>` row, component body, `if=` subtree) and `n12` (the `!` function imported; multi-file shapes — `pack.js` loads the imported modules' client chunks). 260 shapes (S469 fix round 2: n11 grew to 56 — the call-form argument and nested containers; n12 to 16 — `export *`; n13 — a handler through a `const` alias, 5; 265 shapes; S469 n14 — a failable call inside a template-literal interpolation, 10; 275 shapes; S469 n15 — an object shorthand or an exported `const` alias, 7; 282 shapes; S469 n16 — a labeled block in a function-expression body, or a `${…}` in a quoted attribute value, 19; 301 shapes; S469 n17 — a `}` in a comment or regular expression of a quoted-attribute interpolation, or a line terminator in a quoted template attribute, 10; 311 shapes; round 4 — an Annex B HTML-like comment in the interpolation, 4 more; 315 shapes; S469 n18 — an `if=` authorization guard on an `<each>` nested in another `<each>`'s row or in lifted markup, plain and handled-failable × 5 containers, 10; 325 shapes). Data only; each family declares its `SIDE`. |
| `pack.js` | compile → client: happy-dom, click `#wrong` / `#right`, read `#out`; server: POST the `login` route → classify |
| `known-fail.js` | `KNOWN_FAIL` (shapes that log in on a wrong password today, each naming its gap), `UNJUDGED`, `BY_DESIGN_LOGS_IN` |
| `failable-probe-pack.test.js` | the gate: one test per shape |
| `classify.js` | the table, for refreshing `known-fail.js` or grading a branch (not a test) |

## Classes

`PASS` (correct) · `PASS-REFUSED` (compile error: fail closed; the detail carries the codes) · `PASS-500`
(server: the route fails at run time) · `PASS-DENY` (the wrong password does not log in and neither does
the right one: fail closed, a correctness defect or a probe whose callee is plain by design) ·
`UNJUDGED` (no `#wrong` button / no `login` route) · `FAIL` (the wrong password logs in).

## What turns it red

- a shape not in `KNOWN_FAIL` / `BY_DESIGN_LOGS_IN` logs in on a wrong password;
- a `KNOWN_FAIL` shape stops doing so (it was fixed: delete the entry);
- a shape not in `UNJUDGED` comes out `UNJUDGED`, or an `UNJUDGED` one starts being judged;
- the corpus stops holding exactly 325 shapes; a list entry names no shape.

It deliberately does NOT pin each shape's class: a shape moving from `PASS-REFUSED` to `PASS` is a
compiler improvement, not a regression.

`BY_DESIGN_LOGS_IN` names three reviewer probes whose own logic logs in on `"wrong"` (written to probe
ACCEPTANCE of a widened `match` subject). They are refused today; a compiler that correctly accepted
them would show `LOGGED IN`, which is right, so the floor is not asserted for them.

## Measured (S468 fix round 1)

| tree | PASS | PASS-REFUSED | PASS-500 | PASS-DENY | UNJUDGED | FAIL |
|---|---|---|---|---|---|---|
| base `5c43c3b8e` | 28 | 84 | 1 | 10 | 2 | 63 |
| frozen review head `7ecae57eb` | 53 | 69 | 1 | 13 | 5 | 47 |
| fix round 1 | 33 | 120 | 1 | 8 | 2 | 24 |

No shape that is not `FAIL` on base is `FAIL` after the fix round.

## Measured (S469, fix round 1 agent 2 — 226 shapes)

| tree | PASS | PASS-REFUSED | PASS-500 | PASS-DENY | UNJUDGED | FAIL |
|---|---|---|---|---|---|---|
| `181012c20` (imported failable fixed, handler / server-statement not) | 45 | 132 | 1 | 8 | 2 | 38 |
| after (handler-attribute `match` + server statement `match`) | 60 | 134 | 1 | 8 | 2 | 21 |

The 21 are the `VALUE` class (`g-failable-function-used-as-value-unchecked-s468`, ruling owed).

## Measured (S469 fix round 2 — 265 shapes)

| tree | PASS | PASS-REFUSED | PASS-500 | PASS-DENY | UNJUDGED | FAIL |
|---|---|---|---|---|---|---|
| after F4 (E-IMPL1-FAILABLE-FN-VALUE) + H2 + H3 + the `const`-alias handler check | 75 | 181 | 0 | 7 | 2 | **0** |

`KNOWN_FAIL` is empty: bryan ruled F4 (ruling:user-voice-scrml.md S469 "Split + audit") and impl#1 refuses a
failable function read as a value outside callee position except a `const` alias by name — the 21 `VALUE`
shapes are PASS-REFUSED. n13's call-ref and reference shapes were accepted on `00363bc75` with the error
dropped (PASS-DENY there — this instrument observes a login, not a dropped error); they are refused now. `n11` showed
the handler hole was wider than `n3/handler direct`: every one-statement handler value form logged in at top
level, in an `<each>` row, in a component body and under `if=`; each now discriminates the error or is refused
(a component body's one-statement value and a block-bodied arrow: E-ERROR-002).

## Measured (S469, n18 — nested `<each if=…>`)

| tree | n18 PASS | n18 FAIL |
|---|---|---|
| base `ea871fdfe` | 0 | **10** — the nested list rendered LOGGED IN before any password and after a wrong one |
| after (`g-nested-each-if-guard-dropped-s469`) | 10 | 0 |

Not a failable defect: the guard was dropped whatever it held. It lives here because the pack is the
wrong-password floor, and the handled-failable form is the shape an adopter writes.

## Running

```sh
TMPDIR=$HOME/.cache/<scratch> bun test compiler/tests/integration/security-failable-pack/
TMPDIR=$HOME/.cache/<scratch> bun compiler/tests/integration/security-failable-pack/classify.js [--json] [filter]
```

~15 s for 265 shapes on a loaded dev machine, so it rides the pre-commit `integration` set.
