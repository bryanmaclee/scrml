# U0 design — `when` effects + the suspendable effect layer (bootstrap, `compiler/self-host-v2/`)

Change-id: `s446-bootstrap-u0-when-effects`. Plan: `scrml-support/docs/deep-dives/bootstrap-server-boundary-arc-plan-2026-09-30.md` (U0).
Governing text: SPEC §6.7.4 (in full), §6.7.2 (teardown order, depth-first), §13.1/§13.2, §19.9.8 (no `async`/`await`;
"the canonical scrml async surface is the body-split / CPS mechanism").

## 1. Core

Two new Core nodes and one struct. Nothing else in Core changes.

```
type WhenDep:struct = { decl: Sym, inst: InstRef, idx: int }      // ONE cell: field `idx` of `decl`, through `inst`

View.When(deps: WhenDep[], body: Block)                            // §6.7.4 — a reactive effect
Stmt.Suspend(bind: Sym, on: Expr, then: Block)                     // the CPS suspension point
```

**Why `When` is a View.** A `when` is owned by "the enclosing element scope" (§6.7.2: the `<program>` root, an `if=`
element; and in practice an `<each>` row — conformance `each/when-changes-in-row-body`). In Core every scope is made
by the VIEW machinery (a declaration's render, a `Cond` arm, an `Each` row), so a node placed in a view list is owned by
exactly the scope that view list renders into, with no second scope model. It renders no DOM (the printer gives it an
empty comment hole so child-index paths stay positional). Nesting is unrepresentable: a `When` body is a `Block`, a
`Block` holds `Stmt`s, and no `Stmt` holds a `View` — so E-LIFECYCLE-016 is a front-end diagnostic, never a Core state.

**Why `WhenDep` and not an `Expr`.** The dep-list is a list of cells (§6.7.4 grammar: `'@' identifier`), not
expressions; a dedicated struct makes "a dep that is a whole instance / a member path / a computed value"
unrepresentable. `check.scrml` C11 enforces the rest:

- C11a every dep resolves (C4's InstRef rule) and `idx` is a field of `decl`;
- C11b that field has a write capability (`wcap is some`) — a locked or derived field has no change event
  (E-LIFECYCLE-007 restated as a Core invariant);
- C11c the body writes no dep (no `Write` / `Commit` member whose capability is a dep field's, through the same
  instance) — E-LIFECYCLE-006 as a Core invariant;
- C11d `deps` is non-empty.

**`Suspend`.** `Suspend(x, on, then)`: evaluate `on`; suspend; when it settles with value `v`, bind `x = v` and run
`then` — unless the effect that owns the suspension was torn down meanwhile, in which case `then` never runs.
The continuation is EXPLICIT in Core (it is the `then` block), which is §19.9.8's body-split: no Core statement follows
a `Suspend` in its block. C12 (check.scrml) restricts placement for U0: a `Suspend` appears only as the LAST statement
of a `When` body or of another `Suspend`'s `then` (a chain). In an `If` branch, a function body, a handler or a bind it
is a C12 violation — statements after an `If` would otherwise run before the branch's continuation.

## 2. Runtime (`slice-m1/runtime/runtime.js`)

```
rt.when(scope, deps: Cell[], body: (task) => void)   // register; returns nothing
rt.suspend(task, value, k: (v) => void)               // the Suspend statement
stats.whens                                            // live `when` registrations (tests)
```

- `when` subscribes ONLY to the listed cells (an observer in each dep cell's `observers`, the same set every write
  fans out to). A change queues the effect; it runs once per flush (a batch that writes two deps runs it once), never at
  registration. The body runs UNTRACKED (an unlisted read is never a trigger) and inside one `batch` (its writes notify
  once, after the body). Derived values are lazy-pull, so a derived read in the body sees the post-change value — the
  §6.7.4 flush ordering holds by construction (tested, not assumed).
- Change detection is the existing `Cell.set` reference-identity test (`Object.is`) — §6.7.4 "reference-identity-based".
- Teardown step 1: `Scope` gets a `whens` list, unregistered in `dispose` AFTER the child scopes (depth-first) and
  BEFORE the scope's other cleanups (LIFO). The bootstrap has no `<timer>`/`<poll>`/`cleanup()`/`animationFrame`, so
  steps 2–4 are the existing cleanup list; step 1 is explicit so it stays first when they land.
- `suspend(task, value, k)`: `Promise.resolve(value).then(v => …)`. On settle: if the task is cancelled, drop it
  (nothing runs, nothing is written); else run `k(v)` inside one `batch`. A rejection on a live task is re-raised
  asynchronously (it is not swallowed). A task is cancelled when its `when` is unregistered (scope teardown), so a
  destroyed scope's effect never resumes.
- **U1 plug-in point.** `Expr.ServerCall(fn, args)` (U1) evaluates to the fetch Promise; `lower` places it as the `on`
  of a `Suspend` whose `then` is the rest of the body (§13.2 "insert `await`"). Nothing in the runtime changes: the
  task / cancel / batch discipline is the same whatever the promise is. Handler and function bodies become suspendable
  in U1 by relaxing C12 (they get a task too — a handler's owner is its listener's scope).

## 3. Front end (§66 source)

- Grammar exactly §6.7.4: `when @x changes { … }`, `when (@a, @b) changes { … }`, optional `reads @y` /
  `reads (@y, @z)` (informational — parsed, resolved, no semantics). Empty dep-list `()` = a parse error
  (§6.7.4 "is a syntax error"). `when` / `changes` / `reads` are contextual words (no lexer change).
- Positions: a `<program>` body item (§40.8 body-top is code — SPEC §6.7.11 Example 3 writes it there), and a
  `${ when … }` logic block in the program's markup (§6.7.2 "every `${}` logic block … is associated … with the
  nearest enclosing element scope"), including inside an `if=` element and an `<each>` row.
- FAIL CLOSED (E-BOOTSTRAP-UNSUPPORTED): a `when` in a user declaration's `renders` (which scope owns it — the
  instance or the render site — is not settled by §6.7.2/§66; see §5), a `when` in a function body or a handler,
  a dep that names a whole instance (`@decl`, `@handle`), a `${}` block in markup holding anything besides `when`s.
- Codes: E-LIFECYCLE-006, E-LIFECYCLE-007 (undeclared name, locked field, derived field), E-LIFECYCLE-016 (a `when`
  directly in another's body), W-LIFECYCLE-010 (empty body), W-LIFECYCLE-006 (the body is one `@v = <pure expression
  of @variables>`). H-LIFECYCLE-001 is off by default (§6.7.4) and is not emitted.

## 4. The ingest shim (hybrid CG swap)

impl#1's `when-effect` node maps to `View.When` (same Core) so legacy-syntax conformance cases can be graded; a
derived dep is E-LIFECYCLE-007, reported by the shim as a CODE (not a not-yet reason).

## 5. Deliberately NOT done in U0 — and the open fork

- No source syntax produces `Suspend` (no server calls until U1); it is exercised by hand-built Core + runtime tests.
- §19 error context for a rejected suspension (the `when` body's `!{}`): U1, with `ServerCall`'s error type.
- §13.2 parallelisation (`Promise.all` of independent calls): U1+.
- **FORK (not settled by SPEC — reported, not picked):** a `when` re-triggered while an earlier run of the SAME effect
  is suspended. Options: (a) both runs continue independently (impl#1's behaviour today — each body is just called);
  (b) latest-wins: the new run cancels the suspended run's continuation (§6.7.7.1's supersede rule for `<request>`,
  by analogy); (c) serialize: queue the new run until the suspended one finishes; (d) drop while busy.
  **Rec: (b)** — a `when` body is "the response to the latest state"; a stale continuation writing after a newer run
  is the classic race §6.7.7.1 already rules out for reads. U0's runtime keeps each run's task separate and cancels
  only on teardown — i.e. it implements none of (b)–(d) and behaves as (a) only because U0 has no source that can
  suspend; U1 must not ship a server call in a `when` body before this is ruled.
- SPEC questions surfaced: (1) does a `when` in a §66 user declaration's `renders` belong to the instance or to the
  render site? (2) is `@decl` (a whole shared instance, §66.7.1) a "declared mutable @variable" for the dep-list?
  (3) E-LIFECYCLE-006 is "the body writes" — direct writes only, or through called functions too?
