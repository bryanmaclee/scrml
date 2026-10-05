# progress — s454-impl1-handled-sql-rhs (append-only)

- start: base 3261a4423 (== origin/main), worktree clean, bun install + pretest OK.

## Governing sentences (SPEC, quoted verbatim)

- §19.8.3: "A `?{}` query is a **failable expression everywhere**. Outside a `!` function it is treated exactly like a call to a `!` function whose error type is `SqlError` (§19.4.3): its result SHALL NOT be ignored, and an unhandled `?{}` SHALL be a compile error, **E-ERROR-002**."
- §19.8.3 handling form 1 (example 1, the canonical shape): `const row = ?{`SELECT name FROM users WHERE id = ${id}`}.get() !{ .QueryFailed(m) :> { log("lookup failed: " + m); return "?" } … _ :> { return "?" } }` — "`.QueryFailed(m) :>` binds the variant's payload, the `message: string`".
- §19.8.3 handling form 2: "**A `match` on the result** — the success value arrives as `::Ok` (§19.7.1)".
- §19.8.3: "**\"No row\" is not a failure.** A query that runs and matches nothing succeeds: `.get()` on zero rows returns `not`, and `.all()` on zero rows returns `[]`, in every context, inside or outside a `!` function. Only a query that fails to run (a connection lost, a constraint violated, an invalid query) produces a `SqlError` variant."
- §19.8.4: "A `?{}` query SHALL be a failable expression in every context. Outside a `!` function it SHALL be handled at the site with a `!{}` handler or a `match` (§19.8.3)" and "A query that runs and matches no row SHALL NOT be a failure: `.get()` SHALL return `not` and `.all()` SHALL return `[]`."
- §19.4.3 (value position, S451 ruling 1a): "A `!{}` handler or a `match` on a failable result is in a **value position** when its result is used: the initializer of a `let` / `const` / `lin` or state declaration (`let r = f() !{ … }`, `<x> = f() !{ … }`), the right-hand side of an assignment (`@x = f() !{ … }`, `x = f() !{ … }`), a function argument, a `return` operand, an operand of an operator, an interpolation, an attribute value — any position whose result is read." / "In a value position, every arm SHALL do one of two things: 1. **Yield a value** of the call's success type … For a `?{}` the success type is the terminator's (§44.3): `.get()` yields `Row | not`, so `_ :> not` yields a value; `.all()` yields `Row[]`, so `_ :> []` does. 2. **Leave**: the arm ends in `return` or `fail` on every path through it".
- §19.4.3 item 3: "**Catch** with `!{}` inline handler: `let x = riskyFunction() !{ .ErrorVariant :> fallbackValue }`".
- §18.3: "A `match` construct is an **expression**. It produces a value. It MAY appear anywhere an expression is valid: on the right-hand side of an assignment, as a function argument, …" and "A `match` expression MAY appear as the right-hand side of a variable declaration or assignment, as a function call argument, as the body of an arrow function, or as a returned expression."

## Repro on base (compiler 3261a4423)

- D1 `const row = ?{`SELECT id FROM notes`}.get() !{ _ :> not }` (+ `.all() !{ _ :> [] }`) in a server fn → `error [E-CODEGEN-INVALID-LOGIC] … artifact: d1.server.js … let _scrml__scrml_result_2 = ; if (_scrml__scrml_result...` FAILED.
- D2 `const r = match ?{…}.get() { ::Ok(x) :> x  _ :> not }` → exit 0; NO server.js; client.js `async function _scrml_loadOne_2() { … const _scrml_match_4 = null /* sql-ref unresolved: nodeId=-1 — upstream parser/AST bug, please report */.get();` (silent client move).
- D3 `if (?{…}.get() !{ _ :> not }) { … }` → `E-CODEGEN-INVALID-LOGIC … ECT id FROM notes") . get ( ) !{ _ :> null } )) { retu...`.
- Found while tracing (generic, not SQL-only, same lowering site): `return f() !{ _ :> 7 }` DROPS the return (fn returns undefined, exit 0); `let v = 0; v = f() !{…}` emits `var v = …` (redeclaration → E-CODEGEN-INVALID-LOGIC); `(f() !{…})` and `if (f() !{…})` → raw `!{` (E-CODEGEN-INVALID-LOGIC) for ANY failable call.

## Traced loci (entry → decision)

- D1: AST is right — `guarded-expr{ guardedNode: const-decl{ name, init: "", sqlNode }, arms }` (ast-builder `tryConsumeSqlInit` at the const/let entry, then the GUARDED-EXPR wrap). Decision site: emit-logic `case "guarded-expr"` read `guardedNode.initExpr` / `guardedNode.init` (empty) and never consulted `sqlNode` → `let _scrml__scrml_result_N = ;`. The keywordless-reassignment twin (`_bareAssign` const-decl / tilde-decl) then emitted `var x = …` over an existing `let x`.
- D2: AST `const-decl{ matchExpr{ header: "?{…} . get ( )", headerExpr: call(member(sql-ref{nodeId:-1})) } }`. Two decisions: (a) route-inference `walkBodyForTriggers` let/const/tilde branch scanned only `initExpr`/`init` and `sqlNode`, then `return`ed — `matchExpr` (and `ifExpr`/`forExpr`) never visited → no Trigger 1 → client placement; (b) expression-parser `replaceSqlBlockPlaceholder` turned every expression-position `?{}` into an anonymous `__scrml_sql_placeholder__` → `sql-ref{nodeId:-1}` with the SQL text discarded → emit-expr `emitSqlRef` could only emit `null /* sql-ref unresolved */`.
- D3: `if-stmt.condition` text holds the raw `!{ … }`; acorn rejects it → `condExpr` = escape-hatch ParseError → emitted verbatim. No expression-level `!{}` existed anywhere (same for `(f() !{…})` and any non-SQL failable).
- Found on the same site: `return f() !{…}` — the generic guarded-expr path strips `return` to guard its operand and never re-emits it (function returns undefined; stdlib crypto `verifyHash`, auth/jwt, oauth/google hit it).

## The fix (root, not per-position)

1. expression-parser `extractHandledOperands` (before ALL other preprocessing): `?{…}` → `__scrml_sql_ref__("<src>")` → `sql-ref{ raw }`; postfix `!{…}` → ` .__scrml_guard__("<src>")` (acorn binds it to the whole postfix chain, as `!{}` binds). `restoreHandledOperands` puts the source back into every escape-hatch / template raw. `emitStringFromTree` round-trips both.
2. emit-expr: `?{}` call chain in server mode → `emitSqlQueryShape` → the ONE `case "sql"` lowering (tenant floor, protect tags, bool coercion, peer-await params all apply). Guard call → `emitNestedGuardExpr` → the statement-level `case "guarded-expr"` against a synthetic `const <tmp> = <operand>`, wrapped in an IIFE (async when it awaits). A leaving arm in an expression → E-CG-003 via a module-level sink (drained by runCG), never a silent value.
3. Handled query → `await _scrml_sql_attempt(async () => <query>)` (codegen/sql-attempt.ts; helper injected on use into server / library / tool modules). Driver throw → `{__scrml_error, type:"SqlError", variant: QueryFailed{message} | ConstraintViolation{field} | ConnectionLost}`. SqlError payload schema in force while a SQL handler's arms are emitted (scoped, so `.QueryFailed(m)` binds `message`). Unhandled queries unchanged.
4. route-inference: the decl branch walks `matchExpr` / `ifExpr` / `forExpr`.
5. guarded-expr: decl-with-sqlNode init; rebind → assignment; `return f() !{…}` → `return resultVar` after the arms.

Committed c127acf52 (code + tests + 3 conformance cases + FACTS regen).

## Evidence (executed; real bun:sqlite; route handler called directly)

States: `row` = table with row id 7, `norow` = empty table, `fail` = table absent ("no such table").
| shape | base 3261a4423 | head row | head norow | head fail |
|---|---|---|---|---|
| D1 `const row = ?{}.get() !{ _ :> "FALLBACK" }` | E-CODEGEN-INVALID-LOGIC (no build) | {id:7} | null | "FALLBACK" |
| D1 `.all() !{ _ :> ["FALLBACK"] }` | no build | [{id:7}] | [] | ["FALLBACK"] |
| D1 `let … !{ .QueryFailed(m) :> "QF:"+m … }` | no build | {id:7} | null | "QF:no such table: notes" |
| D1 `row = ?{}.get() !{…}` (reassign) | no build | {id:7} | null | "FALLBACK" |
| D1 `( ?{}.get() !{…} )` | no build | {id:7} | null | "FALLBACK" |
| `return ?{}.get() !{…}` | builds; returns undefined (return dropped) | {id:7} | null | "FALLBACK" |
| D2 `match ?{}.get() { ::Ok(x) :> x  _ :> "FALLBACK" }` | exit 0, CLIENT-placed; `null.get()` → TypeError | {id:7} | null | "FALLBACK" |
| D2 `match ?{}.all() { ::Ok(f) :> f  ::QueryFailed(m) :> ["QF:"+m] … }` | client, TypeError | [{id:7}] | [] | ["QF:no such table: notes"] |
| D3 `if (?{}.get() !{ _ :> not })` | no build (raw `!{`) | "truthy…" | "falsy" | "falsy"/arm value |
| SPEC §19.8.3 ex.1 (`userName(1)`) | no build | "ada" | "(none)" | QueryFailed arm runs; its `log(…)` throws ReferenceError (pre-existing, see gap 1 below); with `{ return "QF:"+m }` → "QF:no such table: users" |

## Differential (corpus-emit-differential, base 3261a4423 vs head c127acf52, separate worktrees, root-normalized)

2342 common sources; compile-failure delta 0/0; diagnostic code changes 0; effective syntax-failure set identical (75/75).
Root-normalized artifacts: 11438 compared, 9 changed, 18 head-only (the 3 new conformance cases). The 9:
- stdlib/crypto/index.scrml `index.client.js`, stdlib/auth/jwt.scrml + auth/index `jwt.client.js`, stdlib/oauth/google.scrml + oauth/index `google.client.js` — each `return safeCall(…) !{ … }`: `+ return _scrml__scrml_result_N;` (the dropped-return fix; base `verifyHash("argon2", …)`, `decodeJwt`, the google payload parse returned undefined).
- stdlib/store/kv.scrml + store/index `kv.server.js` / `kv.client.js` — syntax-failing on BOTH sides; message changed (`Unexpected token '!'` → `','`): the object literal now parses past its `!{`, and its method-shorthand values hit the pre-existing empty-escape-hatch conversion (`{ m() {…} }` → `{m: }`, reproduced on base without any `!{`).
No corpus file contains a D1/D2/D3 site (they never built / never ran).

## Residual / pre-existing gaps surfaced (entry text for the PA)

1. g-bang-arm-block-body-log-builtin-unlowered-s454 — `log(…)` inside a `!{}` BLOCK arm body (`.V(m) :> { log(m); … }`) is emitted verbatim (`log ( … )`), so the arm throws `ReferenceError: log is not defined` when it runs. Any failable (base-reproduced with a plain `!` fn); SPEC §19.8.3 example 1's own QueryFailed arm hits it. Locus: emit-logic `emitArmBody` → `rewriteBlockBody` (string path, client mode). MED (silent until the failure path).
2. g-markup-interp-guard-renders-trailing-statement-s454 — `<p>${ f() !{ _ :> 0 } + 10 }</p>` lowers the guard as a top-level statement and renders `+10`; `<p>${ f() !{ _ :> 0 } }</p>` renders nothing. Byte-identical base/head. Silent-wrong. MED.
3. g-expr-position-guard-leaving-arm-e-cg-003-s454 — a `!{}` inside an expression whose arm LEAVES (`return`/`fail`/`break`/`continue`) is refused with E-CG-003 (loud); §19.4.3 item 2 allows leaving arms in every value position. Workaround: hoist to `const v = … !{…}`. LOW.
4. g-handler-arrow-block-body-nested-guard-raw-s454 — `onclick=${ () => { @n = (f() !{…}) } }`: a block-body arrow is text-lowered, so a guard nested in an expression inside it reaches the JS raw (E-CODEGEN-INVALID-LOGIC). Base-identical. LOW.
5. for-of header `for (const r of ?{…}.all() !{…})` → E-PARSE-001 (unchanged; out of scope per brief). LOW.
6. Object-literal method shorthand converts to an EMPTY escape-hatch (`{ close() { … } }` → `{close: }`), pre-existing (expression-parser ObjectExpression). Surfaced in stdlib/store/kv. MED.
7. Expression-position `?{}` still bypasses buildBlock, so E-SQL-003 (runtime-expr body) does not fire there (g-sqlref-direct-call-arg-unresolved's diagnostic half). Its RUNTIME half is now closed: `out.push(?{…}.all())` emits the real query (base: `null /* sql-ref unresolved */.all()`).
