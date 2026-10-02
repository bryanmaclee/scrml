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
