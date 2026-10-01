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
  instance or the render site — is not settled by §6.7.2/§66; see §5), a `when` in use-site slot content (review
  F1), any content inside a declaration's `<slot>…</slot>` (review r2 N2 — §5 question (6)), a `when` in a function
  body or a handler,
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
- **RULED (b), user-voice S446 — a `when` re-triggered while an earlier run of the SAME effect is suspended: the
  newest run wins.** (Was an open fork in the first round; options were (a) independent runs — impl#1's behaviour,
  (b) latest-wins, (c) serialize, (d) drop while busy.) Implemented in the runtime: a new run (`When.runOnce`)
  cancels every task of that When still in flight before it starts — the earlier run's continuation never resumes.
  Cancellation is NOT a rollback: what the earlier run wrote before it suspended stays written. Tested with an
  injected host promise (slice-m1/when.runtime.test.js "RULED (b)").
- **Re-entry (review F2, PA-ruled parity with impl#1):** a When re-triggered while its body is RUNNING is not
  recursed into; it is marked pending and re-runs ONCE after the current run; a further re-trigger in that re-run is
  dropped and reported (`console.error`, the impl#1 wording) — the page stays alive. Covers a direct self-write
  through a call (not caught statically) and a cycle through another `when`.
- **Cycles are decided by PROVENANCE, not by a counter (review round 3; supersedes round 2's chain counter).**
  History: round 1 counted re-runs inside one synchronous `run()` — a continuation (the When is not `running` while
  suspended) escaped it: 100,000 runs, 0 errors, the page hung (r2 N1). Round 2 counted runs per When per external
  chain — which also capped NON-cyclic runs: an observer re-triggered by three links of another run's continuation
  chain lost the third change to a false E-LIFECYCLE-006 (r3 R2-1). The mechanism now:
  - Every run carries a CAUSE — a provenance link `Cause(when, parent, event)` naming the When that ran and the cause
    of that run, back to an external write (`null`). The body, every continuation of the run's task (the task carries
    the link) and every write under them run with `currentCause` = that link; a When those writes trigger records it.
  - A trigger is **CYCLIC iff its cause's ancestry already contains the triggered When** — the When caused its own
    re-trigger: a self-write (directly, through a call, synchronously or from a resumed continuation) or a cycle through
    other Whens. impl#1 parity on what a cycle does: the first cyclic re-trigger re-runs (ancestry holds the When
    once); the next one (ancestry holds it twice) is dropped and reported — "E-LIFECYCLE-006 — re-triggered during its
    re-run; dropped." — once per external event (a runaway can drop thousands). The page stays alive.
  - A **non-cyclic** trigger always runs (SPEC §6.7.4: "The body executes whenever any listed dependency changes
    value"). R2-1 after the fix: the observer sees `["loading","parsing","done"]`, 0 errors.
  - A When queued by several writes before it runs keeps the least cyclic cause (an external one if any): that trigger
    alone would have run it.
  - **Ruled (b) is unaffected, by construction.** An external write has no cause (empty ancestry), so a re-trigger from
    outside a suspended run is never cyclic: it runs and cancels the suspended task (newest wins), however often it
    happens (5 external writes during a suspension → 5 runs, the newest continuation resumes, 0 errors).
- **The runaway backstop (review round 3, R2-2) — and a correction.** Round 2 claimed "total runs are bounded by
  (events × Whens × 2)". **That was false**: the set of Whens is not fixed during an event. A row `when` that appends
  a row creates a NEW When per run; the new When's ancestry never contains it, so no cycle is ever detected —
  measured from source (one click): 4,189 Whens, then "Maximum call stack size exceeded" as an uncaught page error,
  0 diagnostics (the runtime reproduction: 4,480 runs, then the same RangeError). Fail-closed floor:
  - **A per-external-event budget, `WHEN_EVENT_BUDGET = 10000`**, spent by every When RUN and every When
    REGISTRATION that some When CAUSED (non-null cause). An "event" is one outermost flush (a handler's batch, one
    resumed continuation's batch carries its own run's event). When the budget is spent the event is STOPPED: reported
    once ("runaway — one change caused more than 10000 when runs / registrations; the rest of that chain is stopped."),
    and every further run or continuation it caused is dropped. Never a crash.
  - **Why 10,000 and why only CAUSED work.** The direct fan-out of an external write is bounded by the Whens that
    already exist — it cannot run away — so it is free: 12,000 row `when`s on one cell all run on one click (tested).
    Only work a When caused can grow without bound. 10,000 caused runs + registrations is far beyond any legitimate
    effect cascade (a `when` that loads 2,000 rows each carrying a `when` spends 2,000), and small enough to stop a
    runaway in seconds, not minutes (R2-2 from source: stopped after ~5,000 runs + ~5,000 registrations, about 3.7 s
    in happy-dom, dominated by rendering 5,000 rows). It is a floor, not a semantics: SPEC question (7).
  - **When runs are flushed iteratively.** A When triggered inside another When's body (or by an effect that body
    caused) waits for the outermost flush loop instead of recursing (`whenRunning`), so a long chain is a loop, not a
    deep stack: a 6,000-link chain of distinct Whens completes (tested; the re-entrant flush overflowed the stack at a
    few thousand). Order is unchanged: the queue was already one FIFO `Set` that the nested flushes drained in
    insertion order; render / structure effects still settle at every batch end.
  - **Compile time.** Searched SPEC for a sentence that would make the R2-2 program an error: §6.7.4 "The compiler SHALL
    emit E-LIFECYCLE-006 if the body writes to any variable in the `dep-list`" — the R2-2 body writes `@k` (its dep)
    THROUGH `grow()`, a call, which is exactly the unruled SPEC question (3) below (direct writes only, or through
    called functions?). No sentence on runaway / unbounded effect cascades exists (searched "runaway", "infinite loop",
    "unbounded", "re-entrant" — the only `when` hits are E-LIFECYCLE-006's own rationale, §6.7.5 / the §34 row). So no
    compile-time diagnostic is emitted; the runtime backstop is the floor. If (3) is ruled "through calls", the R2-2
    program becomes an E-LIFECYCLE-006 at compile time (the analysis would need the call graph's write sets).
  - Tests: slice-m1/when.runtime.test.js "provenance — only CYCLIC re-triggers are capped …" (R2-1, fan-in, R2-2
    runtime, free fan-out, iterative chain) and slice-m4/when.test.js "R2-2: a row `when` that grows its own <each>".
- **LOW notes filed from the round-3 re-review (not fixed):**
  - A write made from a HOST microtask / timer callback (`queueMicrotask`, `setTimeout`) inside a When body runs
    with no cause — it escapes the provenance and counts as an external event (new budget, never cyclic). In the
    BOOTSTRAP it is not expressible from source today (measured: `queueMicrotask(() => { @n = 1 })` →
    E-SCOPE-001 "`queueMicrotask` is not declared" + E-BOOTSTRAP-UNSUPPORTED for the braced arrow; the closed host
    surface is `Date.now()`). Whether scrml source at large can express it is **UNVERIFIED**. When a host surface that
    defers work lands, it must capture and restore `currentCause` the way `suspend` does.
  - A derived-field cycle — `<a:int=(@b + 1)/>` + `<b:int=(@a + 1)/>` — raises no diagnostic (measured: diags
    `[]`). Pre-existing; not a `when` matter (§66.9 derived fields), filed for the analyze queue.
- **U1 BLOCKER (review F3):** a rejected suspension surfaces as an unhandled promise rejection. §6.7.4: "the error
  propagates through the `when` body's error context (§19)" — that context does not exist until U1. Today nothing
  writes and nothing is swallowed.
- SPEC questions surfaced: (1) does a `when` in a §66 user declaration's `renders` belong to the instance or to the
  render site? (2) is `@decl` (a whole shared instance, §66.7.1) a "declared mutable @variable" for the dep-list?
  (3) E-LIFECYCLE-006 is "the body writes" — direct writes only, or through called functions too? (4) review F1:
  which scope owns a `when` in USE-SITE SLOT CONTENT (§66.15.2) — rendered once per `<slot/>`, possibly zero or
  several times? (refused in the bootstrap) (5) review F2: cross-`when` cycles (A writes B's dep, B writes A's) —
  SPEC names only the direct self-write; the bootstrap bounds them at runtime like impl#1. (6) review r2 N2: what is
  content written INSIDE `<slot>…</slot>` in a declaration's `renders` — fallback for a use with no children (§16.2's
  `${render body() ?? <p>…/}` reading), or an error? §66.15.2 rules only "use-site children → `<slot/>`"; §16 (the
  superseded component text) has fallback only through `??` on a snippet prop. SPEC is silent, Core `View.Slot` has no
  fallback, and the bootstrap used to drop the content unvisited — a `when` there ran 0 times and `${@nope}` raised no
  E-SCOPE-001, against §6.7.4 "A `when` statement is associated with the enclosing element scope". FAIL CLOSED: any
  non-whitespace content inside `<slot>` is E-BOOTSTRAP-UNSUPPORTED (analyze `resolveSlot`). (7) review round 3
  R2-2: what bounds a RUNAWAY `when` cascade that is never cyclic (a `when` whose run creates new `when`s, e.g. a row
  `when` that appends rows)? §6.7.4 specifies no bound, and impl#1 crashes the same way (stack overflow). The
  bootstrap stops the event after `WHEN_EVENT_BUDGET = 10000` caused When runs + registrations and reports it
  (rationale above); the number, the unit (runs + registrations caused by one external event) and the report are
  bootstrap choices pending a ruling. Related: if (3) is ruled "through called functions", such programs are also
  E-LIFECYCLE-006 at compile time.
- W-LIFECYCLE-006 amendment (decided S446, SPEC text in flight): not fired when the right-hand side reads the
  assigned cell (an accumulator — the derived form would be circular). Review r2 N3: "reads the assigned cell"
  includes reading it THROUGH derived cells (`<dm=(@m + 1)/>`, `@m = @n + @dm`; transitively through further derived
  fields of the same declaration) — the derived form would be just as circular. Matched by the assigned field's write
  capability against the derived fields' initializer reads; anything the analysis cannot resolve to a field keeps
  the warning (conservative side).
