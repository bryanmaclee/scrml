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
- **Re-entry (review F2, PA-ruled after impl#1):** a When re-triggered while its body is RUNNING is not recursed
  into; it is marked pending and re-runs ONCE after the Whens its run queued have drained (ORDER below); a further
  cyclic re-trigger is dropped and reported (`console.error`, the impl#1 wording) — the page stays alive. Covers a
  direct self-write through a call (not caught statically) and a cycle through another `when`.
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
    other Whens. What a cycle does: the first cyclic re-trigger re-runs; a second one — the ancestry holds the When
    twice, OR this When already had its cyclic re-run in this event (r3b, below) — is dropped and reported
    ("E-LIFECYCLE-006 — re-triggered during its re-run; dropped.", once per external event). The page stays alive.
  - **The cyclic cap is per When per event, not per ancestry path (r3b F3).** In a dense cycle — n row `when`s on one
    cell, each writing it (through a call) — every interleaving is a distinct ancestry path, and a per-path cap admitted
    one re-run per PATH. Once F1 restored the r2 order, that went exponential (n=6: 307 runs; n=10: over budget). Now
    each When gets at most one cyclic re-run per event; non-cyclic triggers are still never counted (R2-1 stays fixed).
  - A **non-cyclic** trigger always runs (SPEC §6.7.4: "The body executes whenever any listed dependency changes
    value"). R2-1 after the fix: the observer sees `["loading","parsing","done"]`, 0 errors.
  - A When queued by several writes before it runs keeps the least cyclic cause (an external one if any): that trigger
    alone would have run it.
  - **Ruled (b) is unaffected, by construction.** An external write has no cause (empty ancestry), so a re-trigger from
    outside a suspended run is never cyclic: it runs and cancels the suspended task (newest wins), however often it
    happens (5 external writes during a suspension → 5 runs, the newest continuation resumes, 0 errors).
  - **DIVERGENCE from impl#1 — a When that re-triggers itself from a CONTINUATION (review r3b F4; SPEC question (8)).**
    impl#1's re-run guard covers only the synchronous body; a resumed continuation is outside it. So in impl#1 a
    polling loop — `when @t changes { <server call>; if @t < 5 { @t = @t + 1 } }` — runs until its own condition stops
    it. Here the continuation runs under its run's cause, so that write is CYCLIC by ancestry: one re-run, then dropped
    and reported. Measured (runtime): runs=2, t=3, one E-LIFECYCLE-006 — impl#1 reaches t=5. This is NOT parity; it is
    pre-existing since r2's N1 (which is what made the async self-write bounded instead of a hang). Behaviour kept
    unchanged pending a ruling.
  - **Cost (r3b).** The ancestry counts are built once per WRITING cause (one walk of the chain, a one-slot cache —
    every write of one body / continuation shares its cause) and each queued trigger stores its count beside its
    cause. The earlier per-observer chain walk was O(runs × observers × depth): R2-2 at 2,000 runs took 9.6 s in the
    runtime alone; now 0.11 s.
- **ORDER (review r3b F1 — the round-3 claim "Order is unchanged" was FALSE).** Round 3 made the When flush iterative
  but ran a When's pending re-run in place, before the Whens its first run had queued. So with A = `when x`
  (writes `y = y + 1`, then once `x = x + 1`) and B = `when y` (logs), round 3 gave `A1 A2 B2`: B never saw y=1,
  against §6.7.4 ("The body executes whenever any listed dependency changes value" — a non-cyclic trigger runs).
  r2 and impl#1 give `A1 B1 A2 B2`. Now: a When re-triggered while it runs is parked on a LIFO `rerunStack` (it stays
  `running`, so further re-triggers coalesce into its pending cause), popped only when `whenQueue` is empty — exactly
  the order r2's nested flushes produced (each body's batch end drained every queued When, transitively, before the
  body's own re-run; the innermost running When re-ran first), with no recursion. Tests: `A1 B1 A2 B2`, and a
  three-level case `A1 B1 C1 B10 C2 A2 B11 C3` (innermost re-run first). Render / structure effects still settle at
  every batch end.
- **The runaway backstop (review round 3, R2-2; reworked r3b F2/F3) — and a correction.** Round 2 claimed "total
  runs are bounded by (events × Whens × 2)". **That was false**: the set of Whens is not fixed during an event. A row
  `when` that appends a row creates a NEW When per run; the new When's ancestry never contains it, so no cycle is
  ever detected — measured from source (one click): 4,189 Whens, then "Maximum call stack size exceeded" as an
  uncaught page error, 0 diagnostics (the runtime reproduction: 4,423 runs, then the same RangeError). Fail-closed
  floor:
  - **A per-external-event budget of caused RUNS — `WHEN_EVENT_BUDGET = 5000`, PROVISIONAL (SPEC question (7)).**
    Spent by every When run some When CAUSED (non-null cause). An "event" is one outermost flush plus every
    continuation of the runs it caused. **Registrations are NOT charged (r3b F2)** — they are counted, only to label
    the report. Round 3 charged them, and that left non-runaway workloads silently wrong: an async loader that created
    10,001+ row Whens in one continuation was stopped, its next continuation (`loading = false`) was dropped, and
    `loading` stayed true forever. A runaway only grows by RUNNING, so counting runs still stops R2-2, and one run that
    creates 12,000 rows is never stopped (tested).
  - **The stop report is LOUD and honest (r3b F2/F3).** When the budget is spent the event is STOPPED (every further
    run or continuation it caused is dropped). The report says what happened and what it costs: "… the rest of that
    change's when runs and continuations are STOPPED — page state may now be inconsistent." It names the kind:
    **runaway growth** ("… while creating N new whens" — the event created Whens, the only unbounded shape) or a
    **when cascade over budget** ("a bounded cascade or cycle; no whens were created, so it is not runaway growth" —
    e.g. 60 row whens all writing their shared dep, F3). Surface: the console AND a window `error` event. Choice:
    SPEC §19.6.8 (the runtime backstop) is the nearest governing text — B3 "If there is no enclosing boundary, the
    error SHALL propagate to the host", B5 "SHALL NOT silently swallow … loud in development … the `log()` builtin".
    The bootstrap has no `<errorBoundary>` and no `log()` surface yet, so the host's uncaught-error channel (a window
    `error` event — what page code and error monitors listen to) is the floor; `console.error` alone was a quiet
    channel. Not `reportError`: under the Bun-hosted test DOM it is the process's own global and kills the process
    (measured). When `<errorBoundary>` / `log()` land, a stop inside a boundary's subtree should route there — part of
    the (7) ruling. (The E-LIFECYCLE-006 drop report stays `console.error`, the impl#1 wording, unchanged.)
  - **Why only CAUSED runs.** The direct fan-out of an external write is bounded by the Whens that already exist — it
    cannot run away — so it is free: 12,000 row `when`s on one cell all run on one click (tested).
  - **THE TRADE-OFF TABLE (r3b, this machine; budget = caused runs per external event).** R2-2 one click:

    | budget | R2-2 runtime only | R2-2 from source (happy-dom) | falsely stopped (examples) |
    |---|---|---|---|
    | 1,000 | 28 ms | 0.22 s | a caused write watched by >1,000 row whens; a dense cycle of ≥12 whens |
    | 2,000 | 112 ms | 0.71 s | same at >2,000 |
    | **5,000 (chosen)** | **0.73 s** | **4.0 s** | **a caused write watched by >5,000 row whens (F2's 5,100-row `@sel` example IS stopped again at 5,100); a dense cycle of ≥16 whens; a continuation stream of >5,000 updates from one event** |
    | 10,000 | 2.9 s | 19.7 s | same at >10,000 |
    | 20,000 | 15.4 s | (not run) | same at >20,000 |

    The R2-2 cost is QUADRATIC in the budget (each `grow()` reconciles every row and its `@k` write fans out to every
    row `when`); legitimate fan-out cost is LINEAR. 5,000 keeps the R2-2 freeze about where round 3 had it (5.2 s at
    10,000 runs+registrations ≈ 5,000 runs). **Who pays:** at 5,000, the adopter whose `when` writes a cell watched by
    more than 5,000 row `when`s (state left inconsistent, reported); at 10,000, the end user of a runaway page (20 s
    frozen). This tension is why the unit itself is in question — see the escalation below.
  - **Known weakness — the free fan-out of a runaway's leftovers.** After a stopped event, the Whens it created stay
    registered (they are legitimate registrations). The NEXT external write fans out to all of them free of charge, so
    a second click of R2-2 runs every leftover before the budget even starts to bite (round 3: 2.5 s runtime, ~40 s in
    happy-dom). Bounded, never a crash, but each further click costs more. A ruling on (7) should decide whether a
    stopped event quarantines the Whens it created; the bootstrap does not (that would silently delete rows' effects).
  - **When runs are flushed iteratively.** A When triggered inside another When's body (or by an effect that body
    caused) waits for the outermost flush loop instead of recursing (`whenRunning`), so a long chain is a loop, not a
    deep stack: a 4,900-link chain of distinct Whens completes (tested; the re-entrant flush overflows the stack on
    that same test — bite).
  - **ESCALATION (r3b) — what a per-event RUN budget cannot tell apart.** Not a fourth cycle shape: ancestry still
    classifies every trigger correctly. But the budget's unit is wrong for three measured workloads:
    1. **Dense cycles** — n `when`s that all write a cell they all watch. Each When gets one cyclic re-run (cap above),
       but NON-cyclic re-runs follow every simple path through the n Whens: runs = 10 / 59 / 453 / 1,205 / 3,177 for
       n = 3 / 6 / 10 / 12 / 14, over budget from n = 16. r2 (counter): 12 / 42 / 110 / 156 / 210, n=60 → 3,660.
       Round 3's ~3n² came only from its (wrong, F1) folding order. Reachable from source only through a call
       (SPEC question (3)); R2-2 is this shape plus growth.
    2. **Legitimate large caused fan-out** — a `when` that writes a cell watched by more than `budget` row `when`s.
    3. **Legitimate long continuation streams** — one event whose continuation chain writes an observed cell more than
       `budget` times (measured: 12,000 updates → stopped at 5,000, the stream itself killed, st=5,001). Not
       expressible from bootstrap source until U1 (server calls in a loop).
    A bound on ancestry DEPTH instead of run count would separate these: R2-2's depth grows by one per new When
    (unbounded); fan-out (2) and streams (3) stay at depth ~2 whatever their size; dense cycles (1) are bounded by
    2 × n. Its cost: a long legitimate chain of distinct Whens (the 4,900-link test) would need the depth bound above
    its length. Not implemented: it changes the backstop's unit, which is the (7) ruling, not a fix-round call.
  - **Compile time.** Searched SPEC for a sentence that would make the R2-2 program an error: §6.7.4 "The compiler SHALL
    emit E-LIFECYCLE-006 if the body writes to any variable in the `dep-list`" — the R2-2 body writes `@k` (its dep)
    THROUGH `grow()`, a call, which is exactly the unruled SPEC question (3) below (direct writes only, or through
    called functions?). No sentence on runaway / unbounded effect cascades exists (searched "runaway", "infinite loop",
    "unbounded", "re-entrant" — the only `when` hits are E-LIFECYCLE-006's own rationale, §6.7.5 / the §34 row). So no
    compile-time diagnostic is emitted; the runtime backstop is the floor. If (3) is ruled "through calls", the R2-2
    program becomes an E-LIFECYCLE-006 at compile time (the analysis would need the call graph's write sets).
  - The R2-2 program ALSO reports one E-LIFECYCLE-006 (runtime): that one is genuine, not a false positive. Each row
    `when` writes `@k`, its own dep, through `grow()`, so it is a self-cycle through a call (SPEC question (3)) layered
    on the non-cyclic growth.
  - **A pre-existing `<each>` leak, found while measuring R2-2 (fixed: it blocked "page alive").** The row cleanup
    closure was built inside `reconcile()` and captured that call's whole environment (`byKey`, `next`, `items`), so
    every row retained the O(rows) garbage of the reconcile that created it: rows added one at a time → O(N²) retained
    objects (2,000 rows: ~4,000,000 objects; the R2-2 e2e reached 4+ GB and was OOM-killed). `removeRange()` now builds
    the closure outside → ~12,000 objects for 2,000 rows. Regression test: slice-m1/runtime.test.js "rows added one at
    a time retain O(rows)" (heap-delta bound; bite: 4,024,000 → RED).
  - Tests: slice-m1/when.runtime.test.js "provenance — only CYCLIC re-triggers are capped …" (R2-1, fan-in, R2-2
    runtime incl. a second event, free fan-out, iterative chain) and "review r3b — re-run order, runs-only budget,
    honest stop report" (F1 order ×2, the 12,000-row loader, the F3 label, the per-When cyclic cap, the window `error`
    event); slice-m4/when.test.js "R2-2: a row `when` that grows its own <each>" (bounded, exactly ONE page error =
    the backstop's own report, page alive = an unrelated handler still runs and renders — a second `go` click is left
    to the runtime test, see the weakness above).
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
  bootstrap stops the event after `WHEN_EVENT_BUDGET = 5000` caused When RUNS (PROVISIONAL; r3b — registrations no
  longer charged) and reports it loudly (rationale, trade-off table and the depth-bound alternative above); the
  number, the unit, the report surface and whether a stopped event quarantines the Whens it created are bootstrap
  choices pending a ruling. Related: if (3) is ruled "through called functions", such programs are also
  E-LIFECYCLE-006 at compile time. (8) review r3b F4: should a `when` that re-triggers ITSELF across a suspension
  (a polling loop: suspend, then write its own dep) be allowed, and bounded by what? impl#1 allows it (its guard is
  synchronous only); the bootstrap treats it as a cycle by ancestry (one re-run, then dropped + E-LIFECYCLE-006) —
  a divergence, kept unchanged pending the ruling.
- W-LIFECYCLE-006 amendment (decided S446, SPEC text in flight): not fired when the right-hand side reads the
  assigned cell (an accumulator — the derived form would be circular). Review r2 N3: "reads the assigned cell"
  includes reading it THROUGH derived cells (`<dm=(@m + 1)/>`, `@m = @n + @dm`; transitively through further derived
  fields of the same declaration) — the derived form would be just as circular. Matched by the assigned field's write
  capability against the derived fields' initializer reads; anything the analysis cannot resolve to a field keeps
  the warning (conservative side).
