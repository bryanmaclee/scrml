# S451 error-model rulings in the bootstrap (design, s452-boot-rulings)

Scope: the seven items of BRIEF.md, in `compiler/self-host-v2/` only. SPEC @ 488abeedc (#1266-#1269 landed).
Pattern mirrored: `docs/changes/s451-boot-ue/DESIGN.md` (one `Stmt.Attempt` per handling form; analyze decides,
lower reads facts, check states the invariant, print emits).

## 0. Governing sentences (Rule-4 gate — quoted, section named) and where each is decided

### Item 1 — E-ERROR-012 (fall-through arm in a value position)

- §19.4.3 "**Handling in a value position — every arm yields a value or leaves (S451 ruling 1a).** A `!{}` handler or
  a `match` on a failable result is in a **value position** when its result is used: the initializer of a `let` /
  `const` / `lin` or state declaration …, the right-hand side of an assignment …, a function argument, a `return`
  operand … any position whose result is read."
- §19.4.3 "1. **Yield a value** of the call's success type: the arm is an expression, or a block whose last
  expression is that value (§18.5). The `match` form's `.Ok(v)` arm is an arm like any other." · "2. **Leave**: the
  arm ends in `return` or `fail` on every path through it (an `if` whose two branches each leave, leaves). A `break`
  or `continue` that targets a loop enclosing the whole statement also leaves".
- §19.4.3 "An arm that does neither — it ends in a write (`@phase = .Missing`), a declaration, a call whose result is
  not a value of the success type (`log(m)`), or a block whose last statement is not an expression — **falls
  through**, and in a value position that SHALL be a compile error: **E-ERROR-012**" + the message text.
  "An arm that yields a value of the WRONG type is not E-ERROR-012: it is the existing type error (E-TYPE-001)."
  "In a statement position an arm MAY fall through".
- §18.5 "A block arm is `{ statement* expression? }`. The block's result is its **last expression**."
- §19.4.4 bullet: "… SHALL have every arm either yield a value of the call's success type or leave (`return` /
  `fail`, or a `break` / `continue` out of an enclosing loop). An arm that falls through there SHALL be a compile
  error (**E-ERROR-012**)."
- **Decided in:** analyze.scrml `armExpr` / `armBlock` (the binder's per-arm pass — today's two Ue2 refusals are
  replaced). PA locus "Ue2-style refusal" HELD.
- **Lowering consequence:** a block arm whose last statement is a value expression now YIELDS that value (§18.5) —
  today refused as Ue2. lower.scrml `armValue` / `armBody` lower such a block as `body = stmts[0..n-1]` (+ the Attempt
  a handled last value needs), `value = <last expression>`. check.scrml C-E3 is unchanged (value-or-diverge).
- **Bootstrap facts:** the bootstrap has no loops (AStmtK has no `for` / `while`), so `break` / `continue` have no
  source form here — "leave" is `return` / `fail` / an `if` both of whose branches leave. A `!` function has no
  success-type slot (§19.4.1), so the success type is Unknown and E-TYPE-001 never fires on an arm value; E-ERROR-012
  is judged on the arm's SHAPE: a write (assignment, classified cell edit, `reset`), a call of a declared scrml
  function that yields nothing (`-> void`, or no `return <expr>` anywhere in its body), a block whose last statement
  is not an expression, or an empty block.
- `{position}` in the message: "the initializer of `x`" / "the right-hand side of an assignment" / "a `return`
  operand" / "the value of an enclosing arm" — carried in the binder's FailCtx (`wholeWhat`).

### Item 2 — E-ERROR-013 (`!{}` on something that cannot fail)

- §19.4.3 "**A `!{}` handler on something that cannot fail is an error (S451 ruling 3).** A `!{}` handler SHALL be
  attached only to an expression that can fail: a call to a function declared `!` (§19.4.1), a call the compiler
  treats as `!` (a CPS body-split function, §19.9.5; a built-in failable such as `parseVariant`, §41.13), or a `?{}`
  query (§19.8.3). On anything else — a call to an ordinary function, or an expression that is not a call (`let data =
  not !{ … }`) — … That SHALL be a compile error: **E-ERROR-013**" + message; "(For a handler on a non-call
  expression the message names the expression instead.)" · "a `match` on a non-failable value is an ordinary `match`
  (§18) and is not affected."
- §19.9.10 (via §19.4.4): "A call evaluated on the client whose callee is server-placed SHALL be a failable call,
  declared `!` or not".
- **Decided in:** analyze.scrml `guarded` (the `!failable && !isMatch` branch, today a generic refusal). Locus HELD.
- **Readings (fail-closed, not decided):** (a) a callee whose body can place it on the server (a `?{}` in its body or
  the deprecated `server` modifier — placePass's `serverTriggered`) may be a client→server call, which §19.9.10 makes
  failable; whether it is depends on the CALLER's placement and the client→server call is unit U1b → REFUSED
  (E-BOOTSTRAP-UNSUPPORTED naming U1b / §19.9.10), never E-ERROR-013. (b) A callee name that did not resolve
  (E-SCOPE-001 already reported — e.g. the built-in `parseVariant`, which the bootstrap does not have) gets no second
  report. (c) A CPS-split callee: Split is refused (U1d) wherever it is declared, so no handler can reach one.

### Item 3 — E-ERROR-014 (free-standing `!{}` in markup)

- §19.4.3 "**A `!{}` attached to nothing is an error (S451).** A `!{ … }` handler written as markup content — on its
  own, after an element, attached to no call or expression — SHALL be a compile error: **E-ERROR-014**" + message.
- §19.4.4 "A `!{}` handler written as markup content and attached to no expression SHALL be a compile error
  (**E-ERROR-014**)."
- **Decided in:** parse.scrml — `skipSigil` (a `!{` in a markup body; today "a `!{…}` context in markup is not in the
  bootstrap (§3.1)") and `parseMarkupItem` (a `!{` at the program-body item level; today three E-PARSE-ITEM). Locus
  REFINED: the parser, not analyze (the markup walker skips the sigil whole; nothing reaches analyze).

### Item 4 — E-ERROR-015 (manual transaction SQL outside a `!` function)

- §19.10.4 "**Manual transaction control outside a `!` function is an error (S451).** A `?{}` whose statement is
  transaction control — `BEGIN` (in any form: `BEGIN DEFERRED`, `BEGIN IMMEDIATE`, `BEGIN TRANSACTION`, …), `COMMIT`,
  `END`, `ROLLBACK` (including `ROLLBACK TO`), `SAVEPOINT`, or `RELEASE`, recognized after any leading comments
  (§19.10.6) — written where no enclosing function is declared `!` (in a function without `!`, or at a body top) SHALL
  be a compile error: **E-ERROR-015**" + message; "outside a `!` function … W-BATCH-001 SHALL NOT be emitted there —
  E-ERROR-015 is the one diagnostic."
- **Decided in:** sql.scrml (NEW `txControl(chunks) -> string`, the statement keyword after leading whitespace /
  comments; "" = not transaction control) + analyze.scrml placePass (per `?{}` site: in a function with `failable`
  false; and every value / action position site — a body top). Locus "§19.10.4, §34 row" HELD; decision point is
  placePass (it already owns the per-site `?{}` facts).
- The bootstrap emits no W-BATCH-001 (no implicit envelope — U1e), so "the one diagnostic" holds trivially. An
  unhandled `?{BEGIN}` in a non-`!` function is ALSO E-ERROR-002 (§19.8.3 R11 — a different rule; the SPEC does not
  say E-ERROR-015 replaces it). Both fire.

### Item 5 — E-MATCH-BARE-BINDER

- §18.2 "**A bare name is not an arm pattern.** An arm whose WHOLE pattern is a bare identifier — `err :> …` in a
  `match`, `| err :> …` in a `!{}` handler (§19.4.3) — SHALL be a compile error, **E-MATCH-BARE-BINDER**." + the two
  messages (failable site / any other `match`); "`not` is not a bare name here: it is the absence arm (§42)."; "The two
  neighbouring misuses of the whole-error binder take the same code (§18.6.1): `_ <name>` in a `match` whose subject is
  not a failable result, and `else <name>` anywhere."
- §18.6.1 "`_ <name>` in a `match` whose subject is not a failable result SHALL be a compile error
  (**E-MATCH-BARE-BINDER**, §18.2), as SHALL `else <name>` in any arm. The message for the first says that a match arm
  binds the whole value only where it is an error, and offers `_` / `else` or a named variant; for the second it
  offers `_ <name>`."
- **Decided in:** parse.scrml `parsePattern` builds the shapes (NEW `APat.PBare(bind)`, `APat.PWhole(bind, viaElse)`);
  analyze.scrml `resolveArm` (failable sites) and `guarded`'s non-failable branch (the §18 `match` unit, still refused,
  now ALSO reports a misplaced binder) report the code. The bad binder is still bound (one report, no E-SCOPE-001
  cascade) and counts as a wildcard (no E-TYPE-080 cascade).

### Item 6 — the whole-error binder `| _ err :>`

- §18.6.1 "In a `!{}` handler arm (§19.4.3) and in a `match` whose subject is a failable result (§19.7.1), the
  wildcard MAY carry one binder … The arm matches like the wildcard — any error variant not matched by an earlier arm
  — and `err` binds the WHOLE error value: the variant together with its payload, not the payload alone."
- §18.6.1 "In a `match` on a failable result, `_ <name> :>` SHALL match every ERROR variant not matched by an earlier
  arm, and SHALL NOT match the success variant `.Ok` … A `match` that does not otherwise cover `.Ok` is non-exhaustive
  (**E-TYPE-020**, §19.7.1)." · "`_` with no name, and `else`, SHALL bind nothing" · "The binder's type … a call to a
  function declared `!`: the declared error enum …; a `?{}` query: `SqlError`" · "The arm obeys every other arm rule
  unchanged: … E-ERROR-012 in a value position".
- **Core addition:** `ErrArm += whole: Sym | not` — the local bound to the whole error value (§18.6.1). check.scrml
  C-E2 extended: `whole` is some ⇒ `pat` is PWild. walk.scrml `stmtBinds(Attempt)` binds every arm's `whole` (the
  printer's name supply). Rejected alternative: a new `Pattern.PBind` — `Pattern` is shared with the §18 `MatchArm`,
  where a whole-value binder is NOT legal (§18.6), so it would make an illegal Core representable.
- **analyze:** `FArm(-4)` = a whole-error arm (error-wildcard, binds `err`, typed `Named(err)`); exhaustiveness splits
  "covers the errors" (any wildcard) from "covers `.Ok`" (a PLAIN wildcard only). **lower:** -4 → `ErrArm { PWild,
  whole: <binder sym> }`; never the `match`'s ok arm. **print:** `const <err> = <raw>.error;` at the top of the arm.
- Runtime value shape is the ordinary enum value (nullary: its tag string; payload: `{ variant, data: [...] }`, Ue
  HIGH-1), so the bound value IS variant + payload.

### Item 7 — `<db src>` resolution (§8.1.1 as amended S451)

- §8.1.1 "The compiler SHALL resolve the database for each `?{}` block by finding its closest ancestor **database
  scope** — a `<program>` element with a `db=` attribute, a `<program>` element whose database a direct-child `<db
  src=>` supplies (next bullet), or a `<db src=>` state block. 'Closest' means fewest nesting levels up the element
  tree, counting every kind".
- §8.1.1 "When a `<program>` element has no `db=` attribute and exactly one `<db src=>` element is its **direct
  child**, that `<program>` SHALL be a database scope whose database is the `<db>`'s `src=` value." · "**Direct child
  only.**" · "**Exactly one, or none supplies.** … NONE of them supplies the program's database" · "**A `<program db=>`
  is never supplied.**"
- §8.1.1 "If no ancestor is a database scope, the `?{}` block SHALL be a compile error (E-SQL-004 …)" · "This holds
  whatever the number of database scopes in the file: a file with ONE database is not exempt." · §34 E-SQL-004 "`?{}`
  block has no database scope (`<program db=>`, a `<program>` whose single direct-child `<db src=>` supplies its
  database, or `<db src=>`)".
- §4 "A state block is a first-class context. Its content is markup context" (the `<db>` element renders its
  children; it is not an HTML element).
- **Decided in:** analyze.scrml `dbsPass` (REWRITTEN: one walk over every file's items / markup / declarations with the
  nearest database scope in hand; records each function's scope and each markup-position `?{}` site's scope; a
  `<program>`'s scope is its `db=`, else its single direct-child `<db src=>`), `sqlSiteFacts` / `positionDb` (read the
  scope), `resolveElem` (a `<db>` element: NEW `ElemFact.MDb` — accepted with `src=` only; `tables=` (§14.8.4 generated
  types) and `protect=` (§14.8.9 redaction) are REFUSED, never ignored — `protect=` is a confidentiality control).
  lower.scrml renders an MDb element's children in place. Locus "U1a refuses `<db src>`" REFINED: the refusal was the
  generic structural-tag refusal (`structuralOwner` "db") in analyze, not a U1a-specific one.
- **What the bootstrap can express:** a function is an item of a `<program>` body (a `${ … }` item block); the
  bootstrap has no function declaration inside an element's `${ }`. So a function's nearest scope is its program
  chain; a `?{}` can sit inside a `<db>` element only in a markup position (an attribute / handler value, an
  interpolation, an `<effect>` body), all of which are refused for other reasons (E-VALUE-SERVER-CALL / U1d) but are
  now resolved to the right database first (E-SQL-004 is decided by position).
- **Print:** every program holding a `?{}` or a server function is already refused by the printer (U1c — the server
  artifact, which owns connections). A program with a `<db>` and no query prints and runs (its children render); no
  connection string reaches the client artifact (the client printer never reads `CoreProgram.dbs`).

## 1. Out of scope (stated)

- E-SQL-011 (cross-database envelope) — needs U1e (transactions). Noted in progress.md.
- ~~§19.4.3 ruling 2 (`| .V m :>` binds the payload) — NOT in the brief's item list … the form stays refused.~~
  Superseded mid-dispatch by S452 ruling c (§2 below): the paren-free binder is accepted in a `!{}` arm as the legacy
  spelling of `.V(m)`.
- `tables=` / `protect=` / `<schema>`; functions inside an element's `${}`; `transaction {}` (U1e); U1b/U1c/U1d.
- Any SPEC.md change.

## 2. S452 ruling c (mid-dispatch, relayed by PA) — `!{}` arms take the `match` arm grammar

Ruling (ruling:user-voice-scrml.md §S452, "c looks right", relayed by the PA — the SPEC amendment has NOT landed):
`!{}` handler arms use the SAME grammar as `match` arms — §18.2 `match-arm ::= arm-pattern (':>' | '=>' | '->')
arm-body`, `variant-pattern ::= ('.' | '::') VariantName ('(' binding-list ')')?`, `whole-error-arm ::= '_' Identifier`.
Canonical handler: `!{ .Network(msg) :> …  _ err :> … }` (no leading `|`). The leading `|` form and the paren-free
binder (`| ::V m :>`) are SOFT-DEPRECATED through §63: they parse identically during the window; the W-lint is named in
a SPEC amendment that has not landed — NO code is emitted for it here.

What the bootstrap had and what changed:
- **Already one arm parser.** parse.scrml `parseArms` is shared by `parseGuard` (`!{}`) and `parseMatch`; the
  optional leading `|` was already accepted by both. Nothing to unify. It now takes `guard: boolean` (the only place the
  legacy paren-free binder is read).
- **The paren-free binder** `.V m` in a `!{}` arm (refused before — the brief did not list ruling 2): now parsed as the
  legacy spelling of `.V(m)` — `PName(name, [m], parens: false)`; analyze holds it to §19.4.3 ruling 2's arity (one
  field; E-TYPE-021 on a unit or multi-field variant); lower/print treat it exactly as `.V(m)` (same Core — tested).
  In a `match` arm it is not in §18.2's grammar → E-PARSE-ARM (never a silent reading).
- E-MATCH-BARE-BINDER and the whole-error binder were already shared by `!{}` and `match` (one `resolveArm`).
- Tests: error-rulings.test.js uses the canonical pipe-less form as the primary case; a "S452 ruling c" block pins the
  legacy spellings as equivalences (same Core, same runtime, both binder codes in both spellings, no warning emitted).

## 3. Fix round r2 (adversarial review of 311b590ef) — PA readings recorded

- **HIGH-1 (`defer` in a value-position arm).** §19.16.2: "The same code covers a `defer` written directly in an arm of a
  `match` / `if` / `for` that is used for its VALUE — a value-form expression (…) — the arm's last expression is the
  value produced, and the defer block would capture it." → E-DEFER-UNSUPPORTED-SITE, decided in analyze `armBlock`.
  - **PA reading:** a `!{}` handler arm is the same shape as a `match` arm (both lower to one Attempt). The sentence
    names `match` / `if` / `for`, not `!{}`.
  - **PA reading:** a value-position arm that LEAVES (`{ defer …; return "L" }`) is still an arm used for its value,
    so it is refused too. This is fail-closed and reversible.
  - A `defer` in a STATEMENT-position arm stays legal.
  - The bootstrap has no value-form `if` / `for` (`if` is a statement only; there are no loops).
  - print.scrml's value-then-defer `branchJs` (round 1) was removed. A branch carrying a value now never holds a `defer`.
- **LOW-3 — divergence from the PA's instruction, SPEC wins (Rule 4).** The PA asked that an `.Ok` arm after `_ err` be
  ACCEPTED. §18.6.1 says the whole-error arm "obeys every other arm rule unchanged: it is the wildcard for the last-arm
  position (E-SYNTAX-010)", and §18.6 says "An `else` arm that is not the last arm SHALL be a compile error
  (E-SYNTAX-010)".
  - Any arm after `_ err` is therefore E-SYNTAX-010. The message is now true: `_ err` never takes `.Ok`; it must come last.
  - An arm after a plain `_` / `else` also takes E-SYNTAX-010. It used to be refused with "the SPEC names no code",
    which was false.
- **MED-2 decision boundary (fail closed).** A function with no declared return type yields a value only when its body
  ends in `return <expr>`, or in an `if` / `else` whose blocks both do. A body ending any other way is judged "no
  value", which means E-ERROR-012 at a value-position arm:
  - a `given`;
  - a statement-position handler or `match` whose arms return;
  - an `if` without `else`.
- **Addendum (S452 §19.4.5 amendment).** A leading `|` is legacy on a `!{}` arm ONLY. On a `match` arm it is E-PARSE-ARM.
  - The paren-free binder is read only after a `!{}` arm's `|`. A pipe-less `!{ .V m :> }` is E-PARSE-ARM.
  - Engine message arms (§51.0.S) are NOT parsed by `parseArms`: its only callers are `parseGuard` and `parseMatch`.

## 4. Fix round r3 — the runtime enforces; the static check is best-effort

- **BINDING requirement on U1e** (beside S451's "text classification cannot prove a database query read-only; the
  runtime must enforce it"): outside a `!` function, the runtime SHALL detect a transaction left open on the
  connection after a query, roll it back, and report it. E-ERROR-015 (§19.10.4) is a best-effort static check over
  SQL text. It cannot be complete: quoting and commenting are dialect-dependent, and `XA …` / `SET autocommit = 0`
  are not recognised (noted gaps).
- **MED-A (fail closed; r4 supersedes the r3 gate).** sql.scrml `txControl` keeps the string/comment-aware statement
  scan, and a PLAIN scan ALWAYS runs beside it. The plain scan splits on every `;` with no string or comment awareness,
  and treats every character ≤ U+0020 as whitespace. Either scan finding transaction control fires the code.
  - r3 gated the plain scan on a list of dialect-dependent constructs. r4 dropped that list: SQLite `[ident]`, `\f` /
    `\v` and a lone `\r` slipped past it, so no list is trusted.
  - The check stays best-effort. The runtime enforcement owed by U1e (above) is what guarantees the rule.
  - The accepted price is false positives, e.g. a `$$ … BEGIN … END $$` body in a non-`!` function.
  - The message says why, and names the way out: a `!` function.
  - The old comment that a miss was impossible was false; it is corrected.
- **MED-B / LOW-C.** A callee with no declared return type yields a value only if both of these hold:
  - its body has no bare `return` at any depth;
  - some statement, in order, returns a value on every path through it (`return <expr>`, or an `if`/`else` both
    branches of which do). What follows that statement is dead.

  A `fn` tail expression is NOT a value: the bootstrap gives `fn` no implicit tail return. Probe s452 r3:
  `fn h() { "a" }` prints `function h() { "a"; }`, and `fn h() -> string { "a" }` compiles clean and returns
  `undefined`. That is a pre-existing bootstrap gap against §48, reported, not fixed here.
- **LOW-B.** No db diagnostic echoes a `db=` / `src=` value. E-SQL-005 names only the kind (`a MongoDB URL`,
  `a connection string with an unrecognized prefix`, …). The round-2 `redactDsn` is deleted.
- **LOW-D.** `.A | .B :>` (§18.2 alternation) stays unsupported, with a named E-PARSE-ARM message. Deferred.
