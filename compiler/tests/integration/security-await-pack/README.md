# security-await-pack

The wrong-password probe corpus from the nine adversarial review rounds of the §13.2 server-await
fix (gap `g-imported-async-server-fn-not-awaited-s465`), kept as a permanent impl#1 gate.
Built S466 as dpa-023 phase 1a (`scrml-support/docs/deep-dives/dpa-023-build-arc-scoping-2026-10-14.md`).

Every shape is a program whose server function `f(name, pass)` reads bob's argon2 hash and must
reject a wrong password. The program reaches the async `verifyPassword` (scrml:auth) through some
position: an import, an alias, a binding, a callback, a re-export chain, a default parameter. If the
server does not await it, `if (!check(pass, hash))` tests a Promise and the wrong password gets in.

| file | what |
|---|---|
| `shapes/<family>.js` | the shapes, copied verbatim from the reviewers' scratch dirs (`s1`–`s14`, `pa-verify` from r5; `n1`–`n8` r6; `m1`–`m4` r7; `m5`–`m7` r8; `x1` the S239 review of r8; `r9` written by fix round 9; `y1`–`y3` the S467 review of r9; `z1`–`z4` the S467 review of r10; `la1` the S468 literal-arm family — the S468 review of #1446 plus the shapes the fix swept). 695 shapes. Data only. |
| `pack.js` | compile → load `app.server.js` → POST the `f` route with the wrong and the right password → classify |
| `known-fail.js` | `KNOWN_FAIL` (shapes that accept a wrong password on main, each naming its gap) and `UNJUDGED` (shapes this instrument cannot judge) |
| `await-probe-pack.test.js` | the gate: one test per shape |
| `classify.js` | the table, for refreshing `known-fail.js` or grading a branch (not a test) |

## Classes

`PASS` (correct) · `PASS-REFUSED` (compile error: fail closed) · `PASS-500` (route throws / non-2xx /
bundle will not load: fail closed at run time) · `PASS-DENY` (2xx, wrong password refused, right one
refused too: fail closed, a correctness defect) · `UNJUDGED` (`f` has no server route) · `FAIL`
(wrong password answered WELCOME). `PASS-REFUSED` covers legitimate §13.2/§13.7 refusals AND impl#1
defects that happen to refuse (`E-CODEGEN-INVALID-LOGIC`, …); the detail column carries the codes.

## What turns it red

- a shape not in `KNOWN_FAIL` answers a wrong password WELCOME;
- a `KNOWN_FAIL` shape stops doing so (it was fixed: delete the entry);
- a shape not in `UNJUDGED` comes out `UNJUDGED`, or an `UNJUDGED` one starts being judged;
- the corpus stops holding exactly 695 shapes; a list entry names no shape;
- the pinned hash stops verifying under `scrml:auth`'s `verifyPassword`.

It deliberately does NOT pin each shape's class: a shape moving from `PASS-REFUSED` to `PASS` is a
compiler improvement, not a regression. `classify.js` prints the full table when you want it.

S467 round 10 (dpa-023 F4, SPEC §13.9.6): a waiting function may be bound only by a `function`
declaration, so every shape that binds one with `const` / `let` / `export const` — accepted and
run by rounds 6–9, which coloured the binding — is now `PASS-REFUSED`
(`E-ASYNC-FN-ESCAPES-AS-VALUE`). That is the ruled migration, not a regression; the shapes stay.

S468 (family `la1`, gap `g-literal-arm-block-body-unparsed-s468`): a `match` arm with a literal /
alternation / `_` / `::V` head used to be kept by the parser as arm TEXT, so no analysis read its
body — `1 :> { const g = check … }` and `1 :> drive(check, …)` went unrefused and a wrong password got
in (29 of the 55 shapes FAIL on bbddfd7b9). The parser now reads those arms like every other arm kind;
on the fix every `la1` shape is `PASS` or `PASS-REFUSED`.

## Running

```sh
TMPDIR=$HOME/.cache/<scratch> bun test compiler/tests/integration/security-await-pack/
TMPDIR=$HOME/.cache/<scratch> bun compiler/tests/integration/security-await-pack/classify.js [--json] [filter]
```

~40 s for 427 tests on a loaded dev machine (S466), so it rides the pre-commit `integration` set
and CI `gate`. Determinism: one pinned argon2id hash (low cost params; the property under test is
the await, not the cost), one template SQLite copied per shape, temp dirs under `os.tmpdir()`
removed in `afterAll`. Shape `s3/consoleThen` logs `false`/`true` to stdout by design.

## Not covered here

`UNJUDGED` shapes decide in the CLIENT bundle (a client `f` calling a server helper in a value
position, §13.7). Judging them needs the client run against real server handlers, which the
conformance corpus's `serverDb` mode already does. Moving this pack into `conformance/` as an
impl-neutral contract needs a contract extension; the proposal is in
`docs/changes/s466-await-probe-pack/progress.md` ("Design note").
