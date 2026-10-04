# Ue — the error model in the bootstrap (design, s451-boot-ue)

Scope: `!` signatures, `fail`, `?`, `!{}`, `match` on a failable result, `SqlError` and the R11 rule, `defer`'s
fail/`?` exits — client side and server-function BODY semantics (Core only for server: printing a ServerFn stays
refused until U1c). SPEC @ 58178fa6d.

## 0. Governing sentences (quoted)

- §19.1 "There is NO try/catch. There are NO exceptions. Errors are values that flow through the type system and are
  checked at compile time."
- §19.3.2 "`fail` produces an error value and returns it from the enclosing function … exactly as if a `return`
  statement had been used." §19.3.3 E-ERROR-001 (fail outside `!`), E-ERROR-009 ("covers a variant undeclared by the
  declared enum, a `fail` naming a foreign enum entirely, and a `fail` target that is not an enum variant"), the bare
  form `fail .V` ("SHALL resolve the bare variant against the error type declared in the enclosing function's `!`
  signature"), E-TYPE-082 (valid variant, wrong arity; "never double-fire" with E-ERROR-009).
- §19.4.1 `failable-fn ::= 'function' identifier '(' param-list ')' '!' (('->' error-type) | error-type)? block`;
  §19.4.2 "`!` without `-> ErrorType` uses a built-in default error enum: `Error`, which has a single variant
  `Error::Generic(message: string)`"; §19.4.4.1 "A non-enum error type SHALL be `E-ERROR-011`".
- §19.4.3 "A call to a `!` function SHALL NOT be ignored" + the five forms; "Failing to handle the result … SHALL be a
  compile error: E-ERROR-002"; event-handler values and REFERENCES are E-ERROR-002 "exactly like" a call (S439/S441).
- §19.5.2 "`?` causes the enclosing function to return that error variant immediately … `?` is syntactic sugar for
  `match riskyFunction() { ::Ok(val) :> val  ::ErrorVariant(args) :> fail EnclosingErrorType::ErrorVariant(args) }`".
  §19.5.3 "Every error variant that the called function can produce MUST exist as a variant in the enclosing
  function's error type" (E-ERROR-010). §19.5.4 E-ERROR-003 (`?` outside `!`), E-ERROR-004 (`?` on a non-`!` call).
- §19.7.1/.3 a `match` on a `!` result: "All variants — both success and error — MUST be covered … E-TYPE-020";
  "`::Ok` SHALL be the implicit wrapper"; "A `_` wildcard arm SHALL satisfy exhaustiveness". §34 E-TYPE-080
  "Non-exhaustive error handler: not all error variants covered" (the `!{}` code, §19.7).
- §19.8.1 the `SqlError` enum (QueryFailed(message: string), ConstraintViolation(field: string), ConnectionLost);
  §19.8.4 "SHALL NOT redefine it"; §19.8.2 inside `!` "SQL errors are propagated automatically … as if it were a `!`
  function call"; §19.8.4 "propagated if the enclosing function's error type is compatible, or SHALL be a compile
  error if incompatible"; §19.8.3 (R11) "Outside a `!` function it is treated exactly like a call to a `!` function
  whose error type is `SqlError` … an unhandled `?{}` SHALL be a compile error, E-ERROR-002"; "'No row' is not a failure".
- §19.16.2 a deferred body runs on EVERY exit including "`fail` (§19.3); `?` propagation (§19.5)"; §19.16.3 rule 1
  E-DEFER-CONTROL-FLOW (no `fail` / `?` in a deferred body, "including … the arms of a `!{}` handler"); rule 3
  E-DEFER-UNHANDLED-FAILABLE ("SHALL be handled in place, with an inline `!{}` handler … or an exhaustive `match`";
  "an enclosing `!` signature does NOT satisfy the requirement"; "A deferred `!{}` handler SHALL be total — it SHALL
  carry a catch-all `| _ :> …` arm"; it "REPLACES E-ERROR-002").
- §19.10.4 "`transaction { }` SHALL be valid only inside `!` functions" — U1e, refused here.
- §7.2.1 `try`/`catch`/`finally`/`throw` are not scrml (E-TRY-/E-THROW-NOT-IN-SCRML — already lexed as keywords).
- §19 alias note: canonical `.V`, `:>`, `else`; aliases `::V`, `_`; `=>`/`->` arm separators "DEPRECATED … surface
  `W-MATCH-ARROW-LEGACY`"; "The `!{}` error-handler arms share the match arm-arrow rule (lockstep)."

## 1. Core additions — an unhandled failable is unrepresentable

```
Fn      += err: Sym | not          // the declared error enum (`!`); not = an ordinary function
ServerFn+= err: Sym | not
Failable:enum = { FCall(fn: Sym, args: Expr[]), FSql(q: SqlQuery) }
OkArm:struct  = { bind: Sym, body: Block, value: Expr | not }
ErrArm:struct = { pat: Pattern, body: Block, value: Expr | not }
Stmt.Attempt(result: Sym | not, call: Failable, err: Sym, ok: OkArm, arms: ErrArm[])
Stmt.Fail(err: Sym, idx: int, args: Expr[])
Expr.Sql  — REMOVED (a query is a Failable: it exists only as an Attempt's call)
```

- **Attempt** = "run this failable; on success bind `ok.bind`, run `ok.body`; on failure run the FIRST arm whose
  pattern matches the error value; then `result` (when some) holds the branch's `value`". Every handling form lowers to
  it: `!{}`, `match`, `?`, the implicit `?{}` propagation. A failable call has no other home in Core:
  - **C-E1** an `Expr.Call` never names a Fn/ServerFn whose `err` is some (the unhandled call is unrepresentable;
    E-ERROR-002 is the source-side report). (`walk` makes this total over every position.)
  - **C-E2** `Attempt.err` is the callee's `err` (FCall) / the program's `SqlError` (FSql); every arm pattern is
    `PVariant(err, i, binds)` with `binds.length` = variant i's arity or 0 (no payload read), or `PWild`; the arms are TOTAL over `err`
    (every variant covered by a PVariant, or a PWild present).
  - **C-E3** `result` is some ⇒ `ok` and every arm carry a `value`, or their block DIVERGES (ends in Return / Fail,
    or an If whose two branches diverge); `result` not ⇒ no value anywhere.
  - **C-E4** a Fail stands only in a Fn/ServerFn whose `err` is some, names that enum, a valid `idx`, and
    `args.length` = the variant's arity. Not in a handler / effect / declaration block; not in a Defer body (C16
    extended: a deferred body holds no Return / Fail / Defer / Suspend).
  - **C-SQL1 / C-S2** move from `Expr.Sql` to `Failable.FSql` (same rules: chunk/slot arity; only in a ServerFn).
- **Fail is the construction.** The bootstrap has NO payload-variant construction elsewhere (probe: `E.A(3)` and
  qualified `E.B` are refused today); errors are only ever built by `fail` (and by the compiler's `?` re-tag, which is
  per-variant Fails). So no "failure value" floats in Core — `fail` and `?` are returns, handled values are Attempts.
- The built-in enums `Error` and `SqlError` are ordinary `EnumDef`s in `CoreProgram.types`, minted by analyze.

## 2. Front end

- **ast** — `AFn.err: AType | not` (the error type as written; `failable` stays); `AStmtK.Fail(f: AFail)` with
  `AFail = { enumName: string ("" = bare), variant: string, args: AExpr[], target: AExpr | not }` (`target`: a
  non-variant `fail "x"` — kept so analyze reports E-ERROR-009); ONE new `AExprK.Handled(h: AHandled)`:
  `AHandled = { subject: AExpr, how: AHow }`, `AHow = { Propagate, Guard(arms: AArm[]), MatchOn(arms: AArm[]) }`,
  `AArm = { nid, span, pat: APat, body: AArmBody, legacy: boolean }`, `APat = { PName(name, binds: ABind[] | not),
  PWild }`, `AArmBody = { ArmExpr(e), ArmBlock(b) }`, `ABind = { nid, span, name }`. `ASql.handled` is retired.
- **parse** — `)! -> E {`, `)! E {`, `)! {` (§19.4.1); `fail` at statement start when the next token is on the same
  line and is not `(` / `=` / a touching `.` (`fail .V(a)`, `fail ::V`, `fail E.V(a)`, `fail E::V`, else a target
  expression); postfix `?` when the next token is on a later line or is `)` `]` `,` `}` `;` End (else the ternary);
  `e !{ arms }` (arms: optional leading `|`); `match <subject> { arms }` (newline- or `|`-separated). Pattern: `.V`,
  `::V`, `.V(a, _)`, `_`, `else`. Separator `:>`; `=>` / `->` parse identically + W-MATCH-ARROW-LEGACY (§34, warning
  stream). Body: `{ block }` or an expression parsed up to the arm's end (depth-0 `|`, the closing `}`, or a newline
  that starts the next pattern). `transaction {` → E-BOOTSTRAP-UNSUPPORTED naming U1e.

## 3. Analyze

Phase A: a FnInfo gains `err: Sym | not` + `failable`; the error type resolves to an enum (E-ERROR-011 otherwise —
§19.4.4.1, the §34 row is owed WITH this emitter: flagged for the PA); built-ins `Error` / `SqlError` registered in an
outer scope (a user type shadows `Error`; a user `SqlError` is refused, §19.8.4). Phase B, one `failFacts` table
keyed by NodeId (lower reads it, decides nothing): per Handled node the callee, `err`, the minted `result` / `ok`
syms, the context (statement / value), the re-tag map for `?`; per `fail` the resolved `(err, idx)`.

| check | code | where |
|---|---|---|
| `fail` outside a `!` function (handler, effect, program top included) | E-ERROR-001 | §19.3.3 |
| `fail` target not a variant of the declared enum (foreign enum, unknown variant, non-variant target) | E-ERROR-009 | §19.3.3 |
| `fail` valid variant, wrong payload count | E-TYPE-082 | §19.3.3 |
| a `!` call / `?{}` not the subject of `?` / `!{}` / `match` (any position; handler call AND reference) | E-ERROR-002 | §19.4.3, §19.8.3 |
| `?` outside a `!` function | E-ERROR-003 | §19.5.4 |
| `?` on a non-`!` call / a non-call | E-ERROR-004 | §19.5.4 |
| `?` / implicit `?{}`: a callee variant missing from the enclosing enum, or same name with a different payload (arity or field types — the §19.5.2 desugaring is a construction) | E-ERROR-010 | §19.5.3, §19.8.4 |
| `!{}` arms not total over the error enum | E-TYPE-080 | §34 / §19.7 |
| `match` arms not total over `Ok` + the error enum | E-TYPE-020 | §19.7.1 |
| a pattern variant not in the enum (`.Ok` in a `!{}` included) | E-TYPE-VARIANT (bootstrap-local, the existing one) | — |
| payload binders ≠ the variant's arity | E-TYPE-021 | §18.7 |
| `fail` / `?` / an arm's `return` inside a deferred body | E-DEFER-CONTROL-FLOW | §19.16.3 r1 |
| an unhandled `!` call in a deferred body; a deferred `!{}` with no `_` / `else` arm | E-DEFER-UNHANDLED-FAILABLE (replaces E-ERROR-002) | §19.16.3 r3 |

Every existing body walk (scope binder, typer, the effect/value no-write summary, placePass's BodyScan, `deferChecks`,
name refs) recurses into `subject` and every arm — the new AExprK arm is added to each total `match`, never defaulted.
Arm binds are locals scoped to their arm. The success type is the callee's declared return when written (a `!`
signature has no success-type slot, §19.4.1), else Unknown — the typer checks nothing against Unknown (existing rule).

## 4. Lowering (lower decides nothing new)

A statement whose WHOLE value is a Handled (`let/const x = H`, `x = H`, `@c = H` incl. classified edits, `return H`,
`H` alone) is lowered as `Attempt(…)` followed by the statement with `H` read as `Local(result)`; `H` alone →
`Attempt(result: not)`. `!{}`: ok = `{bind t, [], Local t}`, one ErrArm per arm. `match`: the `.Ok(v)` arm is `ok`;
with no `.Ok` arm the wildcard arm is ALSO the ok arm. `?` and the implicit `?{}` in a `!` function: ok as `!{}`, one
ErrArm per CALLEE variant: `PVariant(callee, i, binds) → Fail(enclosing, j, binds)` (identity when the enums are the
same — uniform, no whole-error value needed). Expression arm in statement context = that statement (a classified write
or an Eval); in value context = its `value`. `fail` → `Fail(err, idx, args)`.

## 5. Runtime + printer

`rt.failure(e)` (named so to keep clear of the codec's private `fail`) returns a frozen instance of a runtime-private class `Failure { error }`; `rt.failed(r)` is
`r instanceof Failure` — unforgeable by any scrml value (no classes / `new` in scrml), so a success value can never be
mistaken for a failure. The error value is the ordinary enum value (nullary: its tag string; payload:
`{ variant: "V", data: [v0, …] }`, the payload POSITIONAL — review fix: a `{ tag, <field>… }` shape let a field named `tag` overwrite the discriminant; the R8 wire form keys `data` by field name, the codec maps index ↔ field, U1c). `Fail` → `return rt.failure(<variant value>)`. `Attempt` →

```js
let x$;                         // only when result
const v = f(a);                 // ok.bind holds the raw result
if (rt.failed(v)) { const m$ = v.error; if (<test A>) { <binds>; <body>; x$ = <value>; } else { … } }
else { <ok body>; x$ = <ok value>; }
```

Last / wildcard arm unconditional (C-E2 totality). A `fail` / `?` exit inside a block with a defer is a `return`
inside the existing `try … finally`, so §19.16.2's exit rule holds with no new mechanism. Wire envelope (§19.9.1,
`type` / `httpStatus`) is U1c's.

## 6. SqlError and R11

`?{}` outside `!` unhandled stays E-ERROR-002 (U1a); handled by `!{}` / `match` → Attempt(FSql). Inside a `!`
function an unhandled `?{}` is implicit `?` (§19.8.2): E-ERROR-010 unless the enclosing enum has every SqlError variant
with the same payload. `?` on a `?{}` = the same. Printing any program with a query stays refused (U1c), so SQL is
graded by codes + Core (+ check), not runtime. The bootstrap's SqlError = the three §19.8.1 variants (no coalescing,
so no §8.9.4 `BatchPrepareFailed`; a program matching exactly the three will need a `_` once coalescing lands —
which is exactly why §19.8.3 recommends `| _ :>`).

## 7. Scope OUT (refused, E-BOOTSTRAP-UNSUPPORTED naming the slice)

- A Handled nested inside a larger expression (an argument, an operand, a condition, an interpolation / attribute /
  initializer / derived value) — **Ue2** (needs ordered ANF; whole-statement values only here).
- An arm that produces no value (a write, a non-diverging block) where the Handled needs one (`let r = f() !{ | .A :>
  @x = 1 }`) — **Ue2**; the SPEC does not say what `r` is (open reading, §9).
- A `match` whose subject is not a failable call / query — the **§18 match unit**. Payload / qualified variant
  construction outside `fail`, qualified arm patterns (`E.V`) — the **§14/§18 enum unit**.
- `| .V name :>` / `| _ e :>` (a binder without parentheses) — open reading (§9).
- `!{}` on a non-failable call — no SPEC meaning (§9).
- `<errorBoundary>` (§19.6) — already refused; `renders` on variants (§19.2), E-ERROR-005/006/008 — the boundary unit.
- CPS-implicit `!` / W-CPS-NEEDS-FAILABLE — **U1d**; a client call of a `!` server function — **U1b**; server
  emission, the §19.9.1 envelope and §19.9.2 status mapping — **U1c**; `transaction {}`, E-ERROR-007 — **U1e**.

## 8. Logic vs state

Failure is a VALUE the callee returns (state of the call's result), never control flow the runtime unwinds — the
Attempt node is the one place the program inspects it, and the type system (C-E1..C-E4) makes the inspection
mandatory and total. impl#1 lowers `!{}` to host `try/catch` (`emit-logic.ts` "error-effect"), so a host throw and a
scrml error share one path; here they cannot: a host error never becomes an arm, a `fail` never throws.

## 9. Readings taken / open questions (none blocks: each open one is REFUSED, not decided)

- TAKEN — `?` compatibility includes the payload (§19.5.2's desugaring constructs the enclosing variant positionally,
  so it is subject to §19.3.3 arity and the construction's field types). Report: E-ERROR-010.
- TAKEN — E-DEFER-UNHANDLED-FAILABLE replaces E-ERROR-002 for every unhandled failable inside a deferred body, not
  only a bare call statement (the bootstrap checks every position; the parenthetical describes impl#1's scope).
- TAKEN — `.Ok` is reserved in a `match` on a failable: an error enum with a variant named `Ok` is refused at that
  match (ambiguous; SPEC silent).
- OPEN (refused) — what `| ::V m :>` binds (§19.8.3's example uses `m` as the payload string; Appendix B's
  "`| ::ErrorTypeA e -> handlerA`" reads as the error value; impl#1 projects the first field). Use `.V(m)`.
- OPEN (refused) — the value of a `!{}` / `match` whose arm writes but yields nothing, in a value position.
- OPEN (refused) — `!{}` on a non-failable call (dead handler: error or warning?).
- FLAG — E-ERROR-011 has no §34 row (§19.4.4.1: "the §34 row lands WITH the implementation"); this slice emits it.
