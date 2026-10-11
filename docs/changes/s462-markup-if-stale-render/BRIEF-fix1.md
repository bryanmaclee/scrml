Fix round 1 for s462-markup-if-stale-render. The S239 review on db40d22a8 came back FIX. The stale bug is fixed, the corpus is clean (your 7 diffs confirmed, hunks confined to chain groups), leaks are bounded and far better than base, and every gate is green. The reviewer's repro sources are in ~/.cache/scrml-agent-tmp/s462-rev-ifarm/cases/ (c19b, c21 = 1; c4/c5/c7 = 2; c13/c13b = 3; c17 = 4). Read them; don't write there.

1 HIGH (new wrong output): a LIVE binding's deferred effect closes over a mutable arm-local, so a re-run reads its FINAL value.
- `let total = 0; for (x of [1,2,3]) { total = total + x; lift <p>${total + @n}</p> }`, then `@n = 1`, gives 7|7|7; it should give 2|4|7.
- A while counter in an attribute gives every `title` as `t3-1`.
- A `let` reassigned after the lift shows the later value.
Fix: LIVE-wrap a binding only when every free identifier is a cell read, a `const`, or a per-iteration loop binding (`for (const x of …)`). Anything that reads a `let` (or any non-provably-immutable local) stays unwrapped, so the arm effect re-renders it. Decide this from the AST's identifier resolution, not text. Add the three repros as browser tests.

2 MED (performance and repeated side effects): each per-binding gate calls `current()` → `armOf`, re-evaluating every condition. With an expensive condition it goes quadratic (4000 rows: 86ms vs 3.7ms). A server-fn condition sends 5 POSTs per write. Have the selector own an epoch/selected-arm value; per-binding gates compare against it and never re-evaluate conditions. Add an effect-run-count test (condition evaluated once per write).

3 MED-LOW: an arm that writes its own condition cell during an arm re-render leaves BOTH arms in the DOM and leaks about one disposer per cycle. Repro: `${ if (@on) { @on = @n < 3; lift <p class="arm-on">on ${@n}</p> } else { lift <p class="arm-off">off ${@n}</p> } }`, then `@n = 5`. Make disposal re-entrancy-safe: the disposer sets a flag that `_scrml_lift_branch_run` checks after body(); if it is set, tear down that run and remove its nodes. Test: exactly one arm present, and the live count stays flat over 200 cycles.

4 LOW: effects created after the first render (keyed rows added later) aren't disposed on an arm swap. Register late-created effects with the owning run so the swap disposes them. Test 101 rows then off: live count back to baseline.

COORDINATION: the narrowing branch (separate) is adding a runtime effect PRIORITY so render-gate effects run before user `when` effects on the same write. Your selector effect is a render gate, so build it so a priority can be attached in one place. Note that in progress.md; don't implement the scheduler change yourself.

Then merge origin/main (now 801419299) the usual way, run every gate including facts, browser-baseline and the emit-differential (net of the root path), and report FINAL_SHA. Do not push.
