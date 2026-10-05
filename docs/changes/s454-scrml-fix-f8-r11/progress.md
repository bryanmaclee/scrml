# progress — s454-scrml-fix-f8-r11 (append-only)

- startup: worktree verified, base 3261a4423 == origin/main, bun install + pretest OK. Branch feat/s454-scrml-fix-f8-r11.

## Phase 0 — dual-implementation compatibility (MEASURED; result = STOP)

Method: probe programs (`.tmp/p0/`, deleted at end — reproduce from the table) compiled by
impl#1 (`compileScrml` for codes + artifacts; `bun compiler/bin/scrml.js compile` for the exit status, which runs the
emitted-JS parse gate) and by the bootstrap exactly as the counter grades a corpus case (`twinOf` with TWIN_RULES, then
`slice-m2/lowered.js frontEnd`). Base 3261a4423. "boot" = Error-severity bootstrap diagnostics.

### §19.9.10 site kinds (callees: `touch()` non-`!` statement, `getN() -> int` non-`!`, `save()! SaveError`)

| kind | spelling | impl#1 | bootstrap |
|---|---|---|---|
| (a) handler stmt, braced | BEFORE `onclick={ touch() }` (also unbraced) | exit 0 | E-ERROR-002 |
| (a) | `touch() !{ .Transport(t) :> return }` | exit 0 | **E-SCOPE-001 "`return` is not declared"** (bare `return` is not an arm-body: §18.2 `arm-body ::= expression \| block-body`) |
| (a) | `touch() !{ .Transport(t) :> { return } }` | exit 0, behaviour unchanged (see below) | clean |
| (a) | `touch() !{ _ :> { return } }` | exit 0 | clean |
| (a) | 2 stmts `{ touch() !{ .Transport(t) :> { return } }; @msg = "done" }` | exit 0 | clean |
| (b) handler assign | `@count = getN() !{ .Transport(t) :> { return } }` | exit 0 | clean |
| (b) | `… !{ _ :> { return } }` | exit 0 | clean |
| (c) client fn body | `touch() !{ .Transport(t) :> { return } }` / `@count = getN() !{ .Transport(t) :> { return } }` | exit 0 | clean |
| (d) handled `! E`, no catch-all | BEFORE `save() !{ .Boom :> {…} }` | exit 0 | E-TYPE-080 (Transport uncovered) |
| (d) | `+ .Transport(t) :> { return }` | exit 0 | clean |
| (d) | `+ _ :> { return }` | exit 0 | clean |

Dual-accepted spelling, kinds (a)–(d): **`.Transport(t) :> { return }`** (BRACED arm body). The SPEC's informal
`:> return` (§19.9.10 migration note; also §13.2's example) is rejected by the bootstrap — see NOTES.

impl#1 artifact diff BEFORE→after (client.js): the call gains impl#1's standard `!{}` lowering (`let r = await
_scrml_fetch_f(); if (r && r.__scrml_error) { if (r.variant === "Transport") { const t = r.data; return; } else
{ return r; } }`). On impl#1 the arm is DEAD: a plain stub throws on a non-2xx non-envelope response (`throw new
Error("HTTP " + status)`) — the throw propagates exactly as before — and impl#1's server never sends a variant named
`Transport` (its CpsError variants are NetworkError / ServerError). For a non-`!` callee the route sends no envelope
at all. So the observable behaviour is unchanged; residual deltas: (1) the `chunk cell scope` content hash changes
(source-hash, cosmetic); (2) for a client-function-body site impl#1 dropped the unused `prefetch` runtime chunk
(`_scrml_prefetch_tier1` — not called by either artifact); (3) the theoretical case of a success value that is itself
an object with `__scrml_error: true` would now stop instead of being written. `_ :> { return }` is weaker on impl#1
for (d) (an unmatched declared-envelope variant would `return` instead of `return r`), so `.Transport(t)` is the pick.

### R11 site kinds (`?{}` outside a `!` function; inside a server-placed non-`!` fn)

| kind | spelling | impl#1 | bootstrap |
|---|---|---|---|
| `.run()` / bare `?{}` statement | `… !{ _ :> {} }` | exit 0; the arm is dead (impl#1 throws on a failed query, no try) → unchanged | clean |
| `return ?{}.get()` | `… !{ _ :> not }` | exit 0, unchanged | clean |
| `@cell = ?{}.get()/.all()` | `… !{ _ :> not / [] }` | exit 0 (fallback lands in a temp, dead) | clean (the function's own body-split refusal is pre-existing) |
| **`const/let x = ?{}.get()/.all()`** | `… !{ _ :> not / [] }` | **exit 1 — E-CODEGEN-INVALID-LOGIC**: server.js `let _scrml__scrml_result_N = ;` | clean |
| same | `!{ _ :> { not } }`, `!{ else :> not }`, `!{ _ e :> not }`, all named arms, parenthesized `(… !{…})` | **exit 1** (all; the paren form emits raw `!{ _ :> null }` into JS) | clean |
| same | plain assignment `x = ?{}.get() !{ _ :> not }` | **exit 1** | clean |
| same | `match ?{}.get() { ::Ok(r) :> r  _ :> not }` | exit 0 BUT broken: the function becomes CLIENT-placed, the query becomes `null /* sql-ref unresolved … */.get()` (runtime TypeError; no server route) | clean |
| `if (?{}.get())` condition | `… !{ _ :> not }` | **exit 1** (raw `!{` in emitted JS) | E-BOOTSTRAP-UNSUPPORTED (handled failable only as a statement) |
| `for (… of ?{}.all())` | `… !{ _ :> [] }` | **E-PARSE-001** | (bootstrap does not parse this `for` form at all — pre-existing) |

**SPEC's own §19.8.3 example 1** (`const row = ?{…}.get() !{ .QueryFailed(m) :> {…} … _ :> {…} }` in a non-`!`
function) compiled on impl#1 → **exit 1, E-CODEGEN-INVALID-LOGIC** (same `let … = ;`). No known-gaps entry exists for
this defect (searched).

Population (impl#1 AST walk, adapted s451 measure.mjs, examples/ samples/ conformance/cases/ stdlib/; 2335 files):
602 unhandled R11 sites; by enclosing statement: const-decl 142 + let-decl 81 + let-decl@top 30 + const-decl@top 4 =
**257 declaration-RHS (43%)** · return 90 · `@x =` (state-decl) 38 + 13@top · none (bare/expression statement) 149 +
24@top · if 14 · for 7 · lift 10. So the blocked kinds cover ≥ 278 of 602 R11 sites (decl + if + for).

### Verdict — STOP (brief: "If for ANY site kind no dual-accepted spelling exists, STOP")

The §19.9.10 kinds (a)–(d) have a dual-accepted spelling. The R11 declaration-RHS kind (and the if-condition / for-of
kinds) has NONE: every handled spelling either fails impl#1's emit gate (exit 1) or (match) silently relocates the
function to the client with a dead query. The cause is an impl#1 codegen defect (a `!{}`-handled `?{}` as a
declaration / assignment RHS lowers to an empty initializer), not a spelling choice. Operator ruling needed (S435
freeze exception to fix that impl#1 lowering, or a bootstrap-only R11 migration, or build the §19.9.10 rule alone
now). Rules NOT built; corpus NOT rewritten.
