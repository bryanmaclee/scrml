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
