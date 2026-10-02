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
  - Every run carries a CAUSE — a provenance link `Cause(when, parent, event, depth)` naming the When that ran and the
    cause of that run, back to an external write (`null`). The body and every write it makes run with `currentCause` =
    that link; a resumed continuation runs under a **boundary** link (`when` null, parent = its run's link): a
    suspension point (RULED S447 Q8, below). A When those writes trigger records the cause.
  - A trigger is **CYCLIC iff its cause's ancestry, back to the nearest suspension boundary, already contains the
    triggered When** — the When re-triggered itself SYNCHRONOUSLY: a self-write (directly or through a call) or a cycle
    through other Whens within one synchronous segment. What a cycle does: the first cyclic re-trigger re-runs; a
    second one — the segment holds the When twice, OR this When already had its cyclic re-run in this segment — is
    dropped and reported ("E-LIFECYCLE-006 — re-triggered during its re-run; dropped.", once per external event). The
    page stays alive.
  - **The cyclic cap is per When per synchronous segment, not per ancestry path (r3b F3; per segment since r3c).** In
    a dense cycle — n row `when`s on one cell, each writing it (through a call) — every interleaving is a distinct
    ancestry path, and a per-path cap admitted one re-run per PATH (exponential once F1 restored the r2 order). Each
    When now gets at most one cyclic re-run per segment — per segment, not per event, because impl#1's guard is per
    synchronous run and a poll (Q8) starts a fresh segment every cycle. Non-cyclic triggers are never counted (R2-1
    stays fixed). Still needed under the depth backstop (r3c, measured): without it a 6-When dense cycle is STOPPED at
    depth 256 with an "inconsistent state" report; with it the cycle settles in 59 runs with one E-LIFECYCLE-006 —
    the impl#1 path.
  - A **non-cyclic** trigger always runs (SPEC §6.7.4: "The body executes whenever any listed dependency changes
    value"). R2-1 after the fix: the observer sees `["loading","parsing","done"]`, 0 errors.
  - A When queued by several writes before it runs keeps the least cyclic cause (an external one if any) for the cycle
    check — that trigger alone would have run it — and the DEEPEST trigger's depth for the backstop (below).
  - **Ruled (b) is unaffected, by construction.** An external write has no cause (empty ancestry), so a re-trigger from
    outside a suspended run is never cyclic: it runs and cancels the suspended task (newest wins), however often it
    happens (5 external writes during a suspension → 5 runs, the newest continuation resumes, 0 errors).
  - **ACROSS A SUSPENSION — matches impl#1 (ruled S447 Q8).** "SPEC Q8 — a `when` that re-triggers itself across a
    suspension (polling) is ALLOWED, bounded by the same depth limit" (user-voice S447). impl#1's re-run guard covers
    only the synchronous body; so does the bootstrap's now: the boundary link ends the cycle check, so a polling loop
    — `when @t changes { <server call>; if @t < 5 { @t = @t + 1 } }` — runs to its own condition. Measured (runtime):
    runs=5, t=5, no E-LIFECYCLE-006 (r3b: runs=2, t=3 + E-LIFECYCLE-006). A cycle closed through ANOTHER When's
    continuation is the same shape and is likewise allowed and depth-bounded (A↔B async ping-pong: 128 + 128 runs,
    then stopped at depth 257). **⚑ OPEN (within the ruling): whether 256 polls is enough or polling needs its own
    allowance.** Measured: a 300-cycle poll runs 256 cycles (t=257) and is stopped with "when chain too deep …".
  - **Cost.** The ancestry counts are built once per WRITING cause (one walk of the synchronous segment, a one-slot
    cache) and each queued trigger stores its count beside its cause. r3b: the per-observer walk was cubic (R2-2 at
    2,000 runs: 9.6 s). Under the depth backstop the walk is at most 256 links, so the cache is no longer needed for
    boundedness; kept for a measured 5× (R2-2 runtime: 26 ms with it, 140 ms without).
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
- **The runaway backstop — ancestry DEPTH (RULED S447 Q7) — and a correction.** Round 2 claimed "total runs are
  bounded by (events × Whens × 2)". **That was false**: the set of Whens is not fixed during an event. A row `when`
  that appends a row creates a NEW When per run; the new When's ancestry never contains it, so no cycle is ever
  detected — measured from source (one click): 4,189 Whens, then "Maximum call stack size exceeded" as an uncaught
  page error, 0 diagnostics (runtime reproduction: 4,423 runs, then the same RangeError). The ruling (user-voice
  S447, item 2): "the UNIT is ancestry DEPTH, not a run count; provisional value 256; no quarantine of whens a stopped
  event created. Reason ratified: a run budget cannot separate a runaway (depth grows +1 per new when) from
  legitimate fan-out / long streams (depth ≈2)". (Rounds 3 / r3b used a per-event run budget — 10,000 runs +
  registrations, then 5,000 runs; superseded.)
  - **`WHEN_DEPTH_LIMIT = 256`, PROVISIONAL** (the unit is ruled; the value is not). A caused run that would be more
    than 256 runs deep is not run; its event is STOPPED — every further run or continuation it caused is dropped —
    and reported. No quarantine: the Whens a stopped event created stay registered. A suspension boundary adds no
    depth: depth counts RUNS in the chain.
  - **Depth = the LONGEST causal chain reaching the run (r3c refinement — flagged for veto).** A When queued by
    several writes takes the deepest of them, not the depth of the cause it keeps for the cycle check. The literal
    reading — depth of the single kept (least cyclic) parent — failed two measured shapes, because coalescing keeps an
    external (depth-0) cause whenever one exists, so BREADTH hid depth:
    - a stopped runaway's leftovers (257 row whens), re-triggered by the next click, kept depth 0 and grew to 60,000
      whens in 36 s with no report (it would have grown until memory ran out);
    - a dense cycle (n whens all writing the dep they all watch): depth stayed ≤ 2n while runs grew ×1.6 per added
      When — n = 12 / 16 / 20 / 24 → 1,205 / 8,343 / 57,291 / 392,809 runs; n=60 passed 2,000,000 runs, 3 GB, no stop.
      (The r3b escalation said dense cycles are "bounded by 2 × n" — true of single-parent depth, not of run count.
      That premise in the recommendation was wrong.)
    With the longest chain, both stop at 256 in milliseconds, and every legitimate shape is untouched (matrix below).
    It is the natural reading of "depth grows +1 per new when", but it is a definition choice inside the ruling.
  - **The stop report is LOUD and honest.** "… the rest of that change's when runs and continuations are STOPPED —
    page state may now be inconsistent." Labels re-derived for depth: the event CREATED Whens → **runaway growth**
    ("one change's causal chain passed 256 when runs deep (depth 257) while creating N new whens" — the unbounded
    shape); none created → **when chain too deep** ("… with no whens created: a cycle repeating through suspensions
    (polling / async ping-pong) or that many distinct whens in a row — not runaway growth"). Surface: the console AND a
    window `error` event. SPEC §19.6.8 (the runtime backstop) is the nearest governing text — B3 "If there is no
    enclosing boundary, the error SHALL propagate to the host", B5 "SHALL NOT silently swallow … loud in development
    … the `log()` builtin". The bootstrap has no `<errorBoundary>` and no `log()` yet, so the host's uncaught-error
    channel (a window `error` event) is the floor. Not `reportError`: under the Bun-hosted test DOM it is the
    process's own global and kills the process (measured). When `<errorBoundary>` / `log()` land, a stop inside a
    boundary's subtree should route there. (The E-LIFECYCLE-006 drop report stays `console.error`, impl#1 wording.)
  - **The direct fan-out of an external write is free** and so is any breadth: 12,000 row `when`s on one cell all
    run on one click (tested); a caused write watched by 5,100 rows runs all 5,100 (tested).
  - **THE MATRIX (r3c, this machine, final runtime):**

    | workload | outcome | time | memory (RSS) | stopped? |
    |---|---|---|---|---|
    | R2-1 observer of loading→parsing→done | sees all 3, 0 errors | 23 ms | 127 MB | no |
    | R2-2 runtime, event 1 | 256 runs, 257 whens; runaway growth at depth 257 | 26 ms | 144 MB | **yes (runaway)** |
    | R2-2 runtime, event 2 (leftovers) | 256 runs, 513 whens; runaway growth at depth 257 | 6 ms | 146 MB | **yes (runaway)** |
    | R2-2 from source, click 1 | hits 256, 257 rows, one page error (the report) | 33 ms | 544 MB | **yes (runaway)** |
    | R2-2 from source, click 2 | hits 512, 513 rows, one page error | 44 ms | 568 MB | **yes (runaway)** |
    | async loader creating 12,000 row whens | `loading` ends false, observer ran once | 28 ms | 153 MB | no |
    | 5,100 rows watching a caused `@sel` write | 5,100 row runs + downstream 1 | 7 ms | 160 MB | no |
    | dense cycle n=6 | 59 runs + one E-LIFECYCLE-006 (settles) | 0 ms | — | no (cycle cap) |
    | dense cycle n=10 / 16 / 60 | 256 runs; "chain too deep" | 0 ms | 161 MB | **yes (illegitimate cycle)** |
    | 12,000-update continuation stream | observer saw all 12,000 | 30 ms | 166 MB | no |
    | poll to t=5 (Q8) | runs=5, t=5, no E-LIFECYCLE-006 | 22 ms | — | no |
    | 300-cycle poll | 256 cycles, t=257; "chain too deep" | 23 ms | — | **yes — ⚑ OPEN (Q8 allowance)** |
    | 250-link chain of distinct whens | completes | 2 ms | — | no |
    | 4,900-link chain of distinct whens | reaches link 256; "chain too deep" | 6 ms | — | **yes — the ruled cost** |

    Nothing legitimate is stopped EXCEPT the two costs the depth unit carries by construction: a poll of more than
    256 cycles (OPEN within the Q8 ruling) and a chain of more than 256 DISTINCT whens (stated as the depth unit's
    cost in the r3b recommendation that was ratified). Every runaway shape measured stops in ≤ 44 ms.
  - **When runs are flushed iteratively.** A When triggered inside another When's body (or by an effect that body
    caused) waits for the outermost flush loop instead of recursing (`whenRunning`). Under the depth bound a chain can
    no longer reach stack-overflowing length, so this is no longer the stack guard it was in round 3; it stays because
    the F1 ORDER (`rerunStack`) is built on it.
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
  - Tests: slice-m1/when.runtime.test.js — "re-entry through a suspension — polling allowed, bounded by ancestry
    depth" (Q8 poll to t=5, endless poll stopped at 256, sync→async and async→sync cycles bounded), "provenance …"
    (R2-1, fan-in, R2-2 runtime incl. a second event, free fan-out, the 250 / 4,900-link chains), "review r3b …" (F1
    order ×2, the 12,000-row loader, the per-When cyclic cap, the window `error` event), "RULED S447 Q7 — the depth
    backstop …" (5,100 watchers, the 12,000-update stream, leftovers on the next click, dense n=60, the ⚑ 300-cycle
    poll); slice-m4/when.test.js "R2-2: a row `when` that grows its own <each>" (two clicks, each stopped at depth
    256 with exactly ONE page error = the report; an unrelated handler still runs).
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
  non-whitespace content inside `<slot>` is E-BOOTSTRAP-UNSUPPORTED (analyze `resolveSlot`). (7) RULED S447 (user-voice, item 2): the
  runaway backstop's UNIT is ancestry DEPTH, provisional value 256, no quarantine. Implemented (above). Still owed:
  the VALUE (256 is provisional), and the depth definition — the bootstrap takes the LONGEST causal chain (above;
  flagged for veto). Related: if (3) is ruled "through called functions", R2-2-like programs are also E-LIFECYCLE-006
  at compile time. (8) RULED S447 (item 3): a `when` that re-triggers itself across a suspension (polling) is ALLOWED,
  bounded by the same depth limit — implemented; matches impl#1. ⚑ OPEN within it: whether 256 polls is enough or
  polling needs its own allowance (a 300-cycle poll is stopped at 256 today).
- W-LIFECYCLE-006 amendment (decided S446, SPEC text in flight): not fired when the right-hand side reads the
  assigned cell (an accumulator — the derived form would be circular). Review r2 N3: "reads the assigned cell"
  includes reading it THROUGH derived cells (`<dm=(@m + 1)/>`, `@m = @n + @dm`; transitively through further derived
  fields of the same declaration) — the derived form would be just as circular. Matched by the assigned field's write
  capability against the derived fields' initializer reads; anything the analysis cannot resolve to a field keeps
  the warning (conservative side).
