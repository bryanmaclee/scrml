# BRIEF — #87: scrml compiler — server-call auto-await must descend into nested statement positions

change-id: `i87-nested-server-call-autoawait-2026-07-18`
Severity: HIGH, silent (clean compile, no warning, wrong runtime value — every `if (res.error)`
guard after a nested server call becomes dead code). Adopter: github.com/bryanmaclee/scrml #87.

## THE BUG (verified reproducing on main 1e63bbb1)
`await` was inserted (and the enclosing fn marked `async`) ONLY when a server call is written
`const x = fn()` at the TOP LEVEL of a function body. One block deep — inside `if`/`else`/`for`/
`while`, OR in an `x = fn()` reassignment — the identical call emitted with NO `await` and the
enclosing fn was NOT `async`. Result: an unawaited Promise; the call fires but every guard on the
result is dead.

| case | shape | required |
|---|---|---|
| A topLevelConst | `const res = fn()` top level | async + await (unchanged) |
| B nestedConst | same, inside `if` | async + `await` |
| C assignToLet | `res = fn()` (reassign) | async + `res = await …` |
| D insideLoop | same, inside `for` | async + `await` |

## NORMATIVE BASIS — a CONFORMANCE BUG
SPEC §13.2 "Compiler-Managed Asynchrony" (compiler/SPEC.md:7247), normative: insert `await` at
EVERY call site of a server-generated fetch; wrap ANY function containing at least one server call
in `async`. Position-invariant. §19.9.3 CPS confirms nested-position server calls are compiled-to-CPS.

## FAIL-CLOSED BOUNDARY (highest scrutiny)
`await` is legal ONLY in statement positions inside the async fn body. ILLEGAL in a sync callback /
nested lambda / param default. `E-SERVER-FN-IN-SYNC-CALLBACK` + `E-ASYNC-STDLIB-IN-SYNC-CALLBACK`
MUST keep firing unchanged. The fix descends into CONTROL-FLOW STATEMENT bodies ONLY
(if/else/for/while/do-while), NOT into nested function/arrow/lambda EXPRESSION positions.

## Fix (see progress.md for the implemented shape)
Part A — `hasServerCallees` recurse into control-flow bodies + detect tilde-decl/lin-decl.
Part B — await injection in nested control-flow bodies via emitLogicBody.
Part C — assign-form await-after-`=`.

Full original dispatch brief retained in the PA dispatch record; this file is the on-branch archive
pointer. Empirical result + fail-closed confirmations recorded in progress.md.
