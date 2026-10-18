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
| `shapes/<family>.js` | the shapes, copied verbatim from the reviewer's scratch dir (`n1`–`n8` client, `s1`–`s2` server) and the fix-round dev's (`n9`, `n10`). 188 shapes. Data only; each family declares its `SIDE`. |
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
- the corpus stops holding exactly 188 shapes; a list entry names no shape.

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

## Running

```sh
TMPDIR=$HOME/.cache/<scratch> bun test compiler/tests/integration/security-failable-pack/
TMPDIR=$HOME/.cache/<scratch> bun compiler/tests/integration/security-failable-pack/classify.js [--json] [filter]
```

~15 s for 188 shapes on a loaded dev machine, so it rides the pre-commit `integration` set.
