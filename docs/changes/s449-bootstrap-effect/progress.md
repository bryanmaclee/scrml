# s449-bootstrap-effect — progress (append-only)

Worktree: `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-acf9feeb61fa54eb6`, base `origin/main` 2d6d8cd43.

## 2026-10-02 — startup
- Startup checks clean; `bun install`, `bun run pretest` ran.
- Baseline bootstrap gates (ci.yml "Bootstrap slice" step): slice-m1 73/0 · slice-m2 448/0 · slice-m3 60/0 ·
  slice-m4 403/0 (+1 todo) · slice-codec 92/0 · slice-m1 lowered 73/0 · lexer oracle 337/0.
- `compiler/self-host-v2/` on main is byte-identical to the U0 branch's merge base (f9cd63d864c): U0's diffs apply
  without conflict; only `scripts/hybrid.ts` moved on main.

## 2026-10-02 — Phase A: salvage from U0 (`origin/wip/s447-bootstrap-u0-r3` @ 9835b80a4)

**Taken (Phase A):**
- The `<each>` row-cleanup leak fix (5eecc60ec): `removeRange(start, end)` builds the row cleanup outside
  `reconcile()`, so a row no longer retains that reconcile's `byKey`/`next`/`items`. Independent of any effect
  design. Regression test `slice-m1/runtime.test.js` "rows added one at a time retain O(rows)"; bite re-run here:
  with the closure restored the test is RED (4,024,000 retained objects vs < 400,000), GREEN with the fix.

**Left behind — the cascade backstop (all of it, by the S447 ruling; Call 1 + 1b):**
- `Cause` provenance links, `currentCause` / `underCause`, the per-segment cyclic check (`timesIn`, `segmentOf`,
  `WHEN_RERUN_CAP`, the "E-LIFECYCLE-006 — re-triggered during its re-run; dropped" console report), `WhenEvent`,
  the `WHEN_DEPTH_LIMIT = 256` depth backstop and its loud `reportStop`, the `created` counter. Reason: an effect may
  not write a reactive cell (compile error), so no effect can trigger another or itself; every one of these exists
  to bound a cascade that is now impossible by construction. Q7 / Q8 lapsed.
- **F1 ORDER (`rerunStack`, LIFO re-runs).** Left. It orders a When's *pending re-run* (re-triggered while its own
  body runs) against the Whens its first run queued. A re-trigger during a run needs a write made by that run —
  a compile error now. With no writes from effect bodies there is no pending re-run, so there is nothing to order.
  What survives of "provenance order" for derived / effect flush ordering is only the §6.7.4 "derived flush before
  effect bodies" rule, which the runtime meets by lazy-pull derivation (taken into Phase B, tested there).
- **The iterative When flush (`whenRunning`, the re-entrancy guard).** Left as a mechanism: it existed so a When
  triggered inside another When's body waits for the outer loop instead of recursing — impossible without writes.
  The one part that still matters is ORDER WITHIN A FLUSH: effect bodies run after the render / structure effects
  of the same flush have settled, so an `if=` region or `<each>` row the same batch unmounts unregisters its
  effects (teardown step 1) before they could run. That is carried into Phase B as a separate effect queue drained
  after the render queue — a plain loop, no guard.
- The U0 ingest-shim mapping of impl#1's `when-effect` (ingest.scrml / substitute.js / hybrid.ts). Not taken this
  dispatch: under S447 the shim would have to apply the no-write rule to a body it may not read (impl#1 carries
  only the first statement as structure; Rule 7 forbids reading `bodyRaw`), so a `when-effect` can never be mapped
  past not-yet; only its E-LIFECYCLE-007 half would grade. Filed as a deferred item (final report).
- W-LIFECYCLE-006 and E-LIFECYCLE-006 front-end checks (U0 analyze `derivableWhen`, `depWrites`; Core C11c): both
  retired / subsumed by S447 (§6.7.4 "E-LIFECYCLE-006 is subsumed … W-LIFECYCLE-006 is moot and retires").

**Reused in Phase B (not Phase A — they are the `<effect>` substrate, renamed and re-scoped):** U0's Core
`View.When` / `Stmt.Suspend` shape, its parse of the keyword form, the analyze dep resolution (E-LIFECYCLE-007 /
E-LIFECYCLE-016 / W-LIFECYCLE-010), lower, print and check C11/C12, and the runtime registration / task /
newest-run-wins / teardown-step-1 core of `When` minus everything listed above.

## 2026-10-02 — Phase B: `<effect deps=[…]>` + the no-write rule

**Runtime (commit 177c09abb).** `effectOn(scope, deps, body)` / `DepEffect` + `suspend(task, value, k)` in
`slice-m1/runtime/runtime.js`; `Scope.ownEffect` = teardown step 1; `effectQueue` drained after the render queue.
No guard, counter, depth or budget anywhere (STOP condition respected): an effect body cannot write, so it queues
nothing. Transport: the task layer discards a superseded / torn-down continuation and never aborts (§6.7.7.1: abort
is "MAY" for a READ only, "SHALL NOT" otherwise — discard everywhere is the conforming choice with no run-time
classification). `slice-m1/effect.runtime.test.js` (19 tests).

**Front end.** `ast.scrml` AEffect (`keyword` flag) + ANodeK.Effect + AStmtK.EffectStmt; `parse.scrml` the keyword
form (from U0, `reads` now a retired-clause syntax error), `<effect deps=[…]>${ … }</>` at the char level
(finishEffect / effectBody — E-PARSE-EFFECT for any other attribute, a non-list `deps=`, or body content other than
one `${ }` block), and at the token level where a statement stands (parseEffectTokens — so a nested effect is
E-LIFECYCLE-016, not parse noise; binPrec stops reading a next-line `<effect` as a comparison). `core.scrml`
EffectDep + View.Effect + Stmt.Suspend; walk / measure / lower / print (`rt.effectOn(scope$, [cells], () => {…})`,
`rt.suspend(task$, …)`); `check.scrml` C11 (non-empty deps, mutable deps, NO write in the body — directly or through
a Core Fn call, transitively) and C12 (Suspend only at an effect-body tail).

**analyze.scrml.** resolveEffect: E-EFFECT-NO-DEPS · E-LIFECYCLE-007 (undeclared / non-`@` / locked / derived) ·
W-LIFECYCLE-010 · W-WHEN-EFFECT-DEPRECATED · E-LIFECYCLE-016 (effectAsStatement) · fail-closed refusals (in a
declaration's renders, a whole-instance dep, slot content, slot fallback, outside `<program>`, an effect in a
function / handler body). The NO-WRITE PASS (effectPass) runs after binding over `AS.effects` (the effects the
binder accepted): one BodyScan per function (direct writes from the binder's effect facts + by shape for a refused
write; scrml functions called or named as values; calls through a non-function name), closed over references to a
fixed point keeping a WITNESS chain; each effect body is scanned the same way and judged against the summaries.

**Gates:** slice-m1 93/0 · slice-m2 448/0 · slice-m3 60/0 · slice-m4 445/0 (+1 todo) · codec 92/0 · m1 lowered
93/0 · lexer 337/0 · lint-no-default-arm 0 violations. `slice-m4/effect.test.js` 42 tests.

**Bite (no-write rule through a called function):** `propagated` made to return its input unchanged → RED: "rule 2
… one level and two" (`track() → logFilter() → @hits` not found) and "recursion: the summary is a fixed point";
restored → GREEN.

**Empirical (SCOPED_PROGRAM, effect.test.js) — printed JS of the `if=` region:**
```js
  rt.cond(scope$, n$0_1, [{ test: () => inst$.fields[1 /* show */].get(), render: (scope$, anchor$) => {
    const root$ = rt.template("scrml:program/0_1.0");
    rt.effectOn(scope$, [inst$.fields[0 /* n */]], () => {
      ping();
    });
    rt.insert(scope$, root$, anchor$);
  } }]);
```
Measured: 0 runs at mount; 1 per `inc`; 0 after the section closes; re-opening registers one effect and runs nothing.

### PA readings for veto (Phase B)
- **An effect in a function / handler body** → `E-BOOTSTRAP-UNSUPPORTED`. SPEC §6.7.4: "An `<effect>` SHALL appear
  where a `<request>` may: as a child element of an element scope" — §34 names no code for the violation. Fail-closed
  reject; the message cites the sentence. (Inside another effect's body it is E-LIFECYCLE-016, which §34 does name.)
- **`lift` in an effect body (⚑ OPEN (iii))** — not decided: the bootstrap has no `lift` at all (E-SCOPE-001 /
  parse error), so no choice was forced.
- **`navigate()` in an effect (⚑ OPEN (ii))** — not decided: no `navigate` in the bootstrap (an undeclared name).
- **Cross-module write summaries (⚑ OPEN (i))** — the bootstrap links every imported `.scrml` module into the one
  compilation (FnSrc covers every file), so every callee body is present and the summary reaches across modules; an
  unresolvable import is already an import error. No module-without-body case exists to fail closed on.
- **A call through a local / parameter** (`const g = ping; g()`) → E-EFFECT-WRITE-UNPROVEN (rule 4). The bootstrap
  has no function types, so a function value can only be bound to an untyped local; that path is now closed by the
  rule.
- **A refused write still counts.** A write the binder rejects (`@locked = 4` → E-WRITE-NOT-GRANTED, no fact) is
  also E-EFFECT-WRITES-STATE in an effect body (detected by shape) — the author's intent was a write.
- **Fix-by-shape "reset" detection** = `reset(@x)` or a write of a literal equal to the cell's own initializer
  literal; "request" = a write whose value is a call; else "move / derive". The reset hint lists the effect's own
  deps as the `reset-on=` entries.
- **U0's E-LIFECYCLE-006 / W-LIFECYCLE-006 front-end checks are deleted** (subsumed / retired by §6.7.4).

## 2026-10-02 — Phase C: `reset-on=[…]` (§6.8.4)

**Core** `View.ResetOn(triggers: EffectDep[], reset: Block, rank: int)` — a program cell's rule, registered with the
program scope ahead of its markup (lower `resetOnViews`); the reset is ONE Write of the cell's initializer (Replace,
or a Static Transition on a `rule=` graph cell — C6 re-proves the every-state-admits condition). check **C13**
(≥ 1 mutable trigger; exactly one Write; not listing its own cell). print `rt.resetOn(scope$, [cells], () => { … }, rank)`.

**Runtime** `ResetOn` + `drainResets`: `Cell.set` marks every observer, then drains the pending resets lowest rank
first, all inside the writer's own batch — so the trigger and its resets are ONE change for every render effect and
`<effect>` (rule 4), and code that writes the trigger reads the reset value right after. No counter / bound: the
graph is acyclic by construction (E-RESET-ON-CYCLE). `slice-m1/reset-on.runtime.test.js` (6).

**analyze** `resetOnPass` (program cells): E-RESET-ON-INVALID-ENTRY (empty, non-list, undeclared, non-`@`, derived,
locked) · E-RESET-ON-CYCLE (self / pair / triangle, naming the cells) · E-RESET-ON-NOT-WRITABLE (locked / derived) ·
E-RESET-ON-ENGINE-REFUSED (every non-target state must admit the target; each refusing state named with its `rule=`;
a non-literal initializer = every variant is a target, fail closed); `rank` = depth in the static graph. Tables gains
`resets: ResetOnInfo[]`. `slice-m4/reset-on.test.js` (11): the search page (one keystroke → one effect run, already
on page 1), a chain, an engine reset back to `.Idle`, every code +/-, the field refusal, C13.

**Bites:** rank order off (insertion order) → the diamond test RED; drain moved outside the writer's batch → the
"ONE change" + diamond runtime tests RED (the SOURCE-level search test stays green under that mutation — a handler is
already an outer batch; the runtime test is the guard). Restored → GREEN.

**Gates:** slice-m1 99/0 · m2 448/0 · m3 60/0 · m4 457/0 (+1 todo) · codec 92/0 · m1 lowered 99/0 · lexer 337/0 · lint 0.

### PA readings for veto (Phase C)
- **`reset-on=` on a declaration's FIELD → E-BOOTSTRAP-UNSUPPORTED** (⚑ OPEN "Per-instance resets"): read on
  program cells only. Fail closed.
- **The reset value is the initializer** — `default=` is not in the bootstrap (an unknown opener word, already
  refused), so §6.8.1's `default=` branch has nothing to read.
- **The engine reset "fires `<onTransition>`"** — the bootstrap has no `<onTransition>` (refused as a structural
  element) and no state-child `effect=`: nothing exists to fire. Filed in the known-gaps update.
- **Compositions (rule 7)** — `debounced=` / `throttled=`, lifecycle `(A to B)`, the §55 surface, `persist=`: none is
  in the bootstrap, so there is nothing to cancel / revert / clear / store. Filed.
- **Server / channel cells under `reset-on=` (⚑ OPEN)** — no §52 / `<channel>` cells exist in the bootstrap.
- **`rule=*`** (admits every variant) does not parse in the bootstrap; the engine check reads explicit `rule=` lists.
- **A cycle is reported once** (at the first rule found on it) and every rule on it is dropped from the accepted set.

## 2026-10-02 — Phase D: write requests (§6.7.7.3) — BLOCKED, filed precisely

The bootstrap has NO `<request>` (refused as a structural element, analyze `structuralOwner`), no server functions,
no `?{}` SQL, no `<poll>`, `<channel>`, `persist=` or §52 cells, no `debounced=` / `throttled=`. Every §6.7.7.3 rule
attaches to one of those: "provably writes" reads `?{}` statement verbs / a §52 server write / a `url=`-`api=` method;
the mount-run, baseline and skip rules live on a `<request>`; every server-origin writer is one of the absent
features. Nothing was built speculatively (the runtime carries no origin machinery with no consumer). What each
piece needs, and where it attaches when arc units U1 (server boundary) → U2 (`<request>`) → U3 (classifier) land, is
written into `docs/known-gaps.md` `g-bootstrap-effect-reset-on-owed` "REMAINS" — including the one hook this
dispatch's runtime already provides: `reset-on=` resets are drained inside the triggering `Cell.set`, so a write
origin threaded into `drainResets` gives the §6.7.7.3 rule 3 "a `reset-on=` reset inherits the origin of the write
that triggered it" without a second mechanism.

## 2026-10-02 — conformance + docs

- 29 cases `conformance/cases/lifecycle/{effect-*,when-effect-*,reset-on-*}`: a positive and a negative per code
  (E-EFFECT-NO-DEPS ×2 pos, E-EFFECT-WRITES-STATE ×3 pos incl. transitive + function value, E-EFFECT-WRITE-UNPROVEN,
  E-LIFECYCLE-016, W-LIFECYCLE-010, E-LIFECYCLE-007 `<effect>` limb, W-WHEN-EFFECT-DEPRECATED, the keyword form's
  E-EFFECT-WRITES-STATE, E-RESET-ON-INVALID-ENTRY ×2 pos, E-RESET-ON-CYCLE ×2 pos, E-RESET-ON-NOT-WRITABLE,
  E-RESET-ON-ENGINE-REFUSED) + one runtime case (`reset-on-resets-on-trigger-rt`). Positives xfail on impl#1 under
  the NEW carried gap `g-impl1-effect-reset-on-codes-unimplemented-s447` (signatures captured with
  `run.ts --xfail-signature`); negatives pass on impl#1. `bun conformance/run.ts`: 1212/1238 pass + 26 xfail, 0 fail.
- **Honest limit:** the cases are in the corpus's legacy dialect (`<n> = 0`), which SPEC §6.8.4's own example uses;
  the BOOTSTRAP front end parses only §66 (`<let n:int=0/>`), and the hybrid's impl#1 parser does not know
  `<effect>` — so no implementation executes these 29 green yet. Each expectation is derived from the SPEC sentence
  its `rationale` quotes; the executed proof of the same rules is the bootstrap's slice-m4 `effect.test.js` /
  `reset-on.test.js` in §66 dialect. (Measured: the bootstrap on these files reports parse errors on the legacy cells
  plus the §6.7.4 / §6.8.4 code where the effect / modifier still parses.)
- **Not touched — PA decision:** `conformance/cases/each/when-changes-in-row-body` expects `codes: []` and `hits`
  1 for a `when` body that WRITES `@hits` — under S447 that program is E-EFFECT-WRITES-STATE + W-WHEN-EFFECT-DEPRECATED,
  so the case now contradicts SPEC. It is the xfail pin of the carried `g-when-changes-in-each-row-body-dropped`, so
  rewriting it moves that gap's pin; left for the PA (fork in the final report).
- `docs/known-gaps.md`: `g-bootstrap-effect-reset-on-owed` rewritten as LANDED / REMAINS; new carried gap (HIGH; the
  §0 Carried HIGH count 4 → 5). `docs/FACTS.md` conformance count regenerated (1209 → 1238, `facts.ts --write`).
  `compiler/self-host-v2/progress.md` gains the s449 section.

## 2026-10-02 — adversarial pass: two holes found by MEASUREMENT, both closed at compile time

Probing where the "impossible by construction" claims could leak (no runtime limit was added — per the STOP
condition, each hole is closed in the compile-time rule):

1. **An effect that READS a lazily-constructed shared instance wrote state.** `<box let k:int=(bumpA())/>` (a `let`
   seed calling a writer) + `<effect deps=[@q]>${ const v = @box.k }</>` compiled clean; one click ran
   `shared_box()` inside the effect body, whose construction ran `bumpA()`, which wrote `@a` (measured: `@a` 0 → 1).
   **Fix:** a read through `.Shared(decl)` (decl ≠ the program, which is built at boot) refers to the declaration's
   CONSTRUCTION, summarized like a function over its field initializers + the declarations its renders uses
   (over-approximate: whether a read is the first is not static). E-EFFECT-WRITES-STATE now names
   `construction of <box> → bumpA() → @a`. Core C11 restates it (`.NInst(Shared)` → the declaration's field inits +
   its renders' Instances). Tests: effect.test.js "a read that CONSTRUCTS a shared instance…" (direct, through a
   function, through a rendered declaration, + negative) and C11 "…whose construction writes"; bite: construction
   refs off → RED.
2. **A `reset-on=` whose reset value writes looped forever.** `<let page:int=(bump()) reset-on=[@q]/>` with `bump()`
   writing `@q` compiled clean; at run time every reset re-ran the initializer, which wrote the trigger again — an
   endless drain. §6.8.4's termination argument (rule 3) assumes "exactly one write … and nothing else". **Fix:** the
   reset value (the cell's initializer) is run through the same write summary; any write (or an unprovable call) is
   refused — E-BOOTSTRAP-UNSUPPORTED, because §34 names no code (PA question below). Test: reset-on.test.js "a reset
   value that WRITES…" (trigger writer, unrelated writer, + negative).

### PA readings for veto / questions (adversarial pass)
- **Q-A — initializers that write state.** Both holes share a root: a declaration initializer (a `let` seed) may call
  a `function` that writes another cell, and the bootstrap accepts it. Seeds run at construction (or on lazy first
  read, or at every `reset-on=` reset). SPEC is silent on whether an initializer may write reactive state at all.
  Recommendation: a language-wide compile error (an initializer is a value, and a write hidden in it is invisible at
  every read that triggers it) — that would make both fixes above special cases of one rule. Until ruled: the effect
  limb is E-EFFECT-WRITES-STATE (it IS the effect writing), the `reset-on=` limb is fail-closed
  E-BOOTSTRAP-UNSUPPORTED.
- **A §66 field path as an effect dependency** (`deps=[@box.k]`, ⚑ OPEN in §6.7.4) → E-LIFECYCLE-007 (only `@name`
  entries are accepted — fail closed).
