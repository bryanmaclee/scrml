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
| `shapes/<family>.js` | the shapes, copied verbatim from the reviewer's scratch dir (`n1`–`n8` client, `s1`–`s2` server) and the fix-round dev's (`n9`, `n10`); S469 added `n11` (a failable `match` in every event-handler value form × container: top level, `<each>` row, component body, `if=` subtree) and `n12` (the `!` function imported; multi-file shapes — `pack.js` loads the imported modules' client chunks). 260 shapes (S469 fix round 2: n11 grew to 56 — the call-form argument and nested containers; n12 to 16 — `export *`; n13 — a handler through a `const` alias, 5; 265 shapes; S469 n14 — a failable call inside a template-literal interpolation, 10; 275 shapes; S469 n15 — an object shorthand or an exported `const` alias, 7; 282 shapes; S469 n16 — a labeled block in a function-expression body, or a `${…}` in a quoted attribute value, 19; 301 shapes; S469 n17 — a `}` in a comment or regular expression of a quoted-attribute interpolation, or a line terminator in a quoted template attribute, 10; 311 shapes; round 4 — an Annex B HTML-like comment in the interpolation, 4 more; 315 shapes; S469 s469-engine-effect-failable n18 — a failable call in an engine `effect=` / `<onTransition>` body or guard / message arm / `<onTimeout>` delay / `:`-shorthand body and a `<match>` arm, 45; 360 shapes; review of 6e0770356 — a handled call in a text-lowered slot (guard / delay / `derived=` / structural `if=` / `on=`) and a quoted guard, 14 more; 374 shapes; review of 5a88c3030 — `<each>` `if=` / `in=`, a `const` alias declared after the engine, and an unlexable slot, 14 more; 388 shapes; S469 n19 — an `if=` authorization guard on an `<each>` nested in another `<each>`'s row or in lifted markup, plain and handled-failable × 5 containers, 10; 398 shapes; review of 67bbca342 — a lifted `<each if=r.ok>` reading the stale loop item (id / index keys × `r.ok` / `(r.ok)`), 4, and an `else` sibling where no if= chain is built (nested / lifted `<each if=>`, markup `if=` in a row / in lifted markup), 4; 406 shapes; S469 n20 — an `if=` authorization guard on a `<match>` inside an `<each>` row (1 / 2 / 3 deep, under a row element, a component, an engine arm) or an `<each>`'s `<empty>` body, plain and call-ref, 14, and a guard reading the row / an outer row (id / index keys × `r.ok` / `(r.ok)`), 8; 428 shapes; S469 round 2 n21 — a markup `if=` guard on a NESTED element or a MULTI-root item root in an `<each>` row, revoked after the row is built (plain / call-ref × nested 1–2 deep, each in each, ×3, component, errorBoundary, multi-root head / tail), 16, and a row / outer-row / multi-root guard reading the row (id / index keys × `r.ok` / `(r.ok)`), 12; 456 shapes; S469 n22 — a STALE EFFECT of removed content (an arm in a removed row, the `<each>` rows of a torn-down arm, a row-scoped `<match if=…>` teardown, the rows of an `<each>` nested in a removed row) granting after the revoke, 9; 465 shapes; S469 round 2 — a top-level `<match>` / `<engine>` first dispatched by a write from inside a row build (the owner taken from the writer), 2; 467 shapes; S469 n23 — a markup `if=` guard in LIFTED markup (plain / call-ref / quoted / a cell read inside a called function, bare and in `&&` × a `for … lift` sole root / nested 1–2 deep / multi-root head / tail / lift in lift, a `for` over a literal, an `if … lift` root / nested, a bare `lift` root / nested, a function returning markup, a ternary markup value, a lift in an `<each>` in a `<match>` arm, a component in a row — gated, or with the gate in its body —, an `<each>` that is the lifted root), 85, a value-indexed `@pw == r.k` sole root / nested, 2, its ROW side (the same-key row's key revoked; sole root / nested × id / index keys), 4, and a row guard (nested / multi-root × id / index keys × `r.ok` / `(r.ok)`), 8; round 3 — a guard reading a LOCAL of the lift body (a while counter `>` / `!=`, a counter over `@items`, an accumulator, a flag set after the lift × plain group / `if … lift` arm / row), 13; round 4 — a local closure (over a flag, over a counter) and a mutated local array / object × the same three contexts, 12; S469 s469-softnav-build-guard n26 — SIDE `nav`: a soft navigation from a live build A into build B's page whose `#wrong` carries the same delegated handler id as A's privileged `#right` (via `navigate()` / a boosted link / popstate / an unstamped page / a delegated submit), 5, and round 2 (review F1) an ungated chunk served under a matching page, 1; S469 s469-engine-in-row n25 — an `<engine>` used as a GATE inside an `<each>` row (row root id / index keys, multi-root, nested element, `if=` element, an arm that reads the password, a `<match>` arm in the row with and without an `<each>`, the row of an `<each>` in a `<match>` arm, a nested `<each>` row, an `<empty>` in a row / at top level), 12 — PASS-DENY on `c9f8cd25b` (the engine was dropped), PASS-REFUSED after (E-COMPONENT-ENGINE-SCOPE; the top-level `<empty>` E-CG-003); 609 shapes; S469 s469-impl1-arm-commas n24 (client, 119) and s3 (server, 24) — a `match` arm list that impl#1's arm readers mis-split: a regex literal in an arm body (r2), a literal alternation (r3), a negative later alternate (r4), a `|`-led arm (r5, r6 — incl. a `|`-led first arm before two or more literal arms), a bare handled-call statement arm (r6), an engine `derived=match` and a server-function match lowered from text (r7), a PAYLOAD variant (`{ variant, data }`) compared by name in that text lowering (r8) — each a deny-list whose dropped arm or alternate logged the wrong password in, × newline / comma / mixed arm lists; 758 shapes; S469 s469-lift-gate-staleness n23 +28 — a cell read two calls deep or through a file-level `const` closure (× 8 positions × 2), a run-once group's / an arm's indirect gate beside a body local, 2, the value-indexed row side written IN PLACE (sole root / nested × id / index keys), 4, an item-derived local / a local closure over the row item in a row (× id / index keys), 4, a group local read in a row, 1, and an open gate in a function body (refused), 1; 786 shapes; round 2 (review of b57d697a9) +10 — a local or parameter holding a value computed by a call that reads the cell (`let ok = granted()`, destructured, negated, ternary, assigned later, in an arm / a plain loop / a component body, a function parameter — refused), main 8 FAIL, and an inner-loop local in a re-runnable region of a keyed row, 1; 797 shapes; round 3 (review of b192c63de) +4 — the same inner loop among a FRAGMENT row roots (group head, beside a sibling root, beside a gated root, in an arm with a sibling), revoked and reordered; 801 shapes). Data only; each family declares its `SIDE`. |
| `pack.js` | compile → client: happy-dom, click `#wrong` / `#right`, read `#out`; server: POST the `login` route; nav (n26): compile builds A and B separately, mount A, soft-navigate into B's page, click `#wrong`, read `#out` (`#right` = A's own control on a fresh document; the id-collision precondition is asserted, else UNJUDGED) → classify |
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
- the corpus stops holding exactly 801 shapes; a list entry names no shape.

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

## Measured (S469, n19 — nested `<each if=…>`)

| tree | n19 PASS | n19 FAIL |
|---|---|---|
| base `ea871fdfe` | 0 | **10** — the nested list rendered LOGGED IN before any password and after a wrong one |
| after (`g-nested-each-if-guard-dropped-s469`) | 10 | 0 |
| main `55dc84f69`, 18 shapes (+ F1 stale lifted item, + F4 `else`) | 0 | **18** |
| after the review-of-67bbca342 round (F1 + F4) | 14 (+ 4 PASS-REFUSED, E-CTRL-001) | 0 |

Not a failable defect: the guard was dropped whatever it held. It lives here because the pack is the
wrong-password floor, and the handled-failable form is the shape an adopter writes.

## Measured (S469, n20 — `<match if=…>` in an `<each>` row)

| tree | n20 PASS | n20 FAIL |
|---|---|---|
| main `7ede5c5c1` | 0 | **22** — the row's arm rendered LOGGED IN before any password and after a wrong one |
| after (`g-structural-if-inside-each-row-template-fails-open`, the `<match>` half) | 22 | 0 |

The `<empty>`-body shapes also failed for a second reason on main: a `<match>` there got the
module-scope dispatcher while emit-each called it in the item-scoped form, so it rendered nothing at
boot and, after a scrutinee change, rendered ungated.

## Measured (S469 round 2, n21 — a nested / multi-root row `if=`)

| tree | n21 PASS | n21 FAIL |
|---|---|---|
| main `7b1838470` | 0 | **28** — the guard was evaluated once at row creation, so revoking it left LOGGED IN |
| after (`g-each-nested-peritem-if-not-reactive`, `g-each-peritem-if-multiroot-deferred`) | 28 | 0 |

An `<empty>`-body nested `if=` was measured too and is not in the family: it already passed on main (the
each render fn rebuilds the `<empty>` body), so it is not a probe of the defect.

## Measured (S469, n22 — a stale effect of removed content)

| tree | n22 PASS | n22 FAIL |
|---|---|---|
| main `29b6320ad` | 0 | **9** — an effect created inside a removed row / torn-down arm kept running and granted on the next write |
| after (`g-row-and-arm-effect-scopes-never-disposed-s469`, the owner-scope tree) | 9 | 0 |

Round 2 (F1, the over-disposal direction) added 2 shapes — a top-level `<match>` / `<engine>` whose first
dispatch is fired by a row's template during the boot render. PASS on main `29b6320ad`; **FAIL** on round 1
`ffbe1cf2b` (the arm was filed under the writing row, so removing the row killed its wiring and the guard
text stayed "LOGGED IN" after the revoke); PASS after (an in-document mount takes its STRUCTURAL owner).

Not a failable defect either: the page's own `grant` is plain. The probe is that content the revoke REMOVED
must not act again; every shape grants only through an effect the revoke should have disposed.

## Measured (S469, n23 — a markup `if=` in lifted markup)

| tree | n23 PASS | n23 FAIL |
|---|---|---|
| main `29b6320ad` | 0 | **62** of the first 62 (measured before the round-2 shapes) — 59 kept LOGGED IN in `#out` after the guard was revoked (a `style.display` toggle; for a call-ref `if=allowed(@pw)` or a quoted `if="allowed(@pw)"` no gate at all — the value was written as an `if` attribute); the 3 lifted-`<each>`-root shapes crashed the harness (`ReferenceError: y is not defined` — the `<each>` was built as a literal element). The 4 value-indexed ROW-side shapes stayed open after the row was revoked even on the structural swap's first cut: the value bucket was registered once under the create-time `r.k` |
| round 1 `f2226103b` (99 shapes) | 84 (+ 1 PASS-REFUSED) | **14** — every `if=granted()` / `if=(granted() && true)` outside a reconciled row: the gate subscribed only to the `@name` tokens in the attribute text, so a cell read inside the called function was never a dependency |
| round 2 `060495fe2` (112 shapes) | 104 (+ 1 PASS-REFUSED) | **8** — the round-3 body-local shapes in a plain group and a row: the gate's own effect re-read the local's FINAL value |
| after round 3 (112 shapes; body locals snapshot at render) | 111 (+ 1 PASS-REFUSED) | 0 |
| round 3 `e7c7f7a28` (124 shapes) | 117 (+ 1 PASS-REFUSED, 2 PASS-DENY) | **4** — a local closure (flag / counter) in a plain group and a row: the snapshot skipped callees, and a closure reads its locals by reference |
| after round 4 (124 shapes; a gate with any unclassified name is read inline) | 123 (+ 1 PASS-REFUSED) | 0 |
| after round 5 (124 shapes; main's evaluation placement, swap instead of display) | 87 (+ 1 PASS-REFUSED) | **36**, all in `KNOWN_FAIL` — positions stale on main (a cell read only in a called function, a value-indexed row field, a body local in a keyed row): `g-lift-gate-placement-inherits-main-staleness-s469` |
| after round 2 (99 shapes; every gate a tracking effect) | 98 (+ 1 PASS-REFUSED: a quoted `if=` on a lifted `<each>` root is E-CG-003, the `<each>` reader's refusal) | 0 |

The pack reads `#out`'s `textContent`, which includes a `display: none` element — so a display toggle is a
FAIL here exactly as the SPEC means it (§17.1: the element is absent while the condition is false).

## Running

```sh
TMPDIR=$HOME/.cache/<scratch> bun test compiler/tests/integration/security-failable-pack/
TMPDIR=$HOME/.cache/<scratch> bun compiler/tests/integration/security-failable-pack/classify.js [--json] [filter]
```

~15 s for 388 shapes on a loaded dev machine, so it rides the pre-commit `integration` set.

## Measured (S469 s469-engine-effect-failable — n18, 45 shapes)

| tree | PASS | PASS-REFUSED | PASS-500 | PASS-DENY | UNJUDGED | FAIL |
|---|---|---|---|---|---|---|
| base `b75ad70f7` | 3 | 14 | 0 | 9 | 0 | **19** |
| after | 11 | 31 | 0 | 3 | 0 | **0** |

The 14 shapes added for the review of 6e0770356 (text-lowered slots and a quoted guard): on main
`d10936fdb`, 11 FAIL (the handled guard in `to=` / `from=` / engine-direct / `once` form, the quoted
`if="false"`, `derived=` paren and bare, `<engine if=>`, `<match if=>`, `<match on=>` paren and
interpolated), 1 PASS-REFUSED, 1 PASS-DENY, and `derived match` throws at run time (it crashes the
harness on main). After: 13 PASS-REFUSED, 1 PASS-DENY (`delay handled`: the timer is lost, see
`g-ontimeout-after-brace-loses-timer-s469`), **0 FAIL**. Whole pack: 374 shapes, 0 FAIL.

Every body the compiler kept as raw text in an `<engine>` (a state-child / opener `effect=`, an
`<onTransition>` body and `if=` guard, a `(state × message)` arm, a computed `<onTimeout after=>`,
a `:`-shorthand state body) or a `<match>` (an arm body, bare or `:`-shorthand, and the handlers in
it) is bounded by acorn (`interpolation-extent.ts`, the one reader shared with the template-interpolation slicer), parsed once (`engine-body-reader.ts`,
`arm-body-reader.ts`), walked by the failable check and lowered from the same nodes. The handled
forms (`check(p) !{…}`, a `match` on the call) went from refused or silently wrong to PASS.

## Measured (S469, n26 — a soft navigation across a build boundary)

| tree | n26 PASS | n26 FAIL |
|---|---|---|
| base `cd040ea25` (main `0ff6c93aa` + test-only #1511) | 0 | **5** — B's page swapped in, no hard navigation, the wrong click LOGGED IN (A's `grant()` ran on B's colliding id) |
| s469-softnav-build-guard | 5 | 0 — every entry point hard-navigates before applying B's page (`data-scrml-build`, SPEC §20.8.2 step 0) |
| round 1 head `095c96407` + shape 6 (review F1) | 5 | **1** — `ungated chunk under a matching page`: the chunk never refused, so the soft nav completed with it |
| round 2 (every nav-loaded chunk must advance the admit count) | 6 | 0 — "build unverified" → hard navigation |

Shape 6 is judged `accepted` (pack.js `nav.judge`): its floor is "a chunk that never admitted its build never joins the page", so a soft navigation that completes with it is the FAIL whatever `#out` reads.

`g-soft-nav-cross-build-handler-id-collision-s469`. The `nav` side is the login restated for a deploy:
"wrong" is B's harmless button, "right" is A's own privileged control.
