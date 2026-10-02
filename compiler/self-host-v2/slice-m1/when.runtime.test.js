// when.runtime.test.js — s446 (U0): the `when` effect (SPEC §6.7.4) and the
// suspendable task layer of the slice runtime, exercised directly with
// injected host promises (no source form suspends until U1). Each test names
// the runtime mutation that turns it RED.

import { describe, test, expect } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import * as rt from "./runtime/runtime.js";

if (!globalThis.document) GlobalRegistrator.register();

const tick = () => new Promise((r) => setTimeout(r, 0));

/** A promise the test settles by hand. */
function held() {
  let resolve, reject;
  const p = new Promise((a, b) => { resolve = a; reject = b; });
  return { p, resolve, reject };
}

describe("§6.7.4 when — triggering", () => {
  test("never runs at registration; runs once per change of a listed cell", () => {
    // mutation RED: When's constructor calling run()
    const scope = rt.root.child();
    const x = rt.cell(0);
    let runs = 0;
    rt.when(scope, [x], () => { runs++; });
    expect(runs).toBe(0);
    x.set(1);
    expect(runs).toBe(1);
    x.set(2);
    expect(runs).toBe(2);
    scope.dispose();
  });

  test("an unlisted read is not a trigger (the body runs untracked)", () => {
    // mutation RED: run() without untrack() (an enclosing tracker would collect the body's reads)
    const scope = rt.root.child();
    const dep = rt.cell(0);
    const other = rt.cell(10);
    let seen = [];
    rt.when(scope, [dep], () => { seen.push(other.get()); });
    other.set(11);
    expect(seen).toEqual([]);
    dep.set(1);
    expect(seen).toEqual([11]);
    other.set(12);
    expect(seen).toEqual([11]);
    // and an OUTER effect that triggers the write does not inherit the body's reads
    let outerRuns = 0;
    const trig = rt.cell(0);
    rt.effect(scope, () => { outerRuns++; if (trig.get() > 0) dep.set(trig.get() + 100); });
    trig.set(1);
    expect(seen).toEqual([11, 12]);
    const before = outerRuns;
    other.set(13);
    expect(outerRuns).toBe(before);
    scope.dispose();
  });

  test("a write of the same value is not a change (reference identity, §6.7.4)", () => {
    const scope = rt.root.child();
    const x = rt.cell("a");
    let runs = 0;
    rt.when(scope, [x], () => { runs++; });
    x.set("a");
    expect(runs).toBe(0);
    scope.dispose();
  });

  test("a batch that changes two deps runs the body ONCE, after the batch", () => {
    // mutation RED: markStale() calling run() directly instead of queueing
    const scope = rt.root.child();
    const a = rt.cell(0);
    const b = rt.cell(0);
    const seen = [];
    rt.when(scope, [a, b], () => { seen.push([a.peek(), b.peek()]); });
    rt.batch(() => { a.set(1); b.set(2); });
    expect(seen).toEqual([[1, 2]]);
    scope.dispose();
  });

  test("a derived read in the body reflects the change that triggered it (§6.7.4 flush ordering)", () => {
    const scope = rt.root.child();
    const price = rt.cell(10);
    const qty = rt.cell(2);
    const total = rt.derived(scope, () => price.get() * qty.get());
    expect(total.peek()).toBe(20);              // cached before the change
    const seen = [];
    rt.when(scope, [price], () => { seen.push(total.get()); });
    price.set(15);
    expect(seen).toEqual([30]);
    scope.dispose();
  });

  test("the body's writes are one batch: an observer of two written cells runs once", () => {
    // mutation RED: run() without batch()
    const scope = rt.root.child();
    const dep = rt.cell(0);
    const p = rt.cell(0);
    const q = rt.cell(0);
    const views = [];
    rt.effect(scope, () => { views.push(`${p.get()}/${q.get()}`); });
    rt.when(scope, [dep], () => { p.set(1); q.set(1); });
    dep.set(1);
    expect(views).toEqual(["0/0", "1/1"]);
    scope.dispose();
  });

  test("a dep must be a mutable cell — a derived value is refused (E-LIFECYCLE-007's runtime shadow)", () => {
    const scope = rt.root.child();
    const d = rt.derived(scope, () => 1);
    expect(() => rt.when(scope, [d], () => {})).toThrow(/mutable cell/);
    const dead = rt.root.child();
    dead.dispose();
    expect(() => rt.when(dead, [rt.cell(0)], () => {})).toThrow(/live owning scope/);
    scope.dispose();
  });
});

describe("re-entry — bounded, loud, the page stays alive (parity with impl#1's rerun cap, PA-ruled S446)", () => {
  function captureErrors(fn) {
    const errs = [];
    const saved = console.error;
    console.error = (...a) => errs.push(a.join(" "));
    try { fn(); } finally { console.error = saved; }
    return errs;
  }

  test("two whens writing each other's deps: no stack overflow; one re-run, then dropped and reported", () => {
    // mutation RED: markStale() not checking `running` (unbounded recursion → RangeError)
    const scope = rt.root.child();
    const n = rt.cell(0);
    const m = rt.cell(0);
    let runsA = 0, runsB = 0;
    rt.when(scope, [n], () => { runsA++; m.set(m.peek() + 1); });
    rt.when(scope, [m], () => { runsB++; n.set(n.peek() + 1); });
    const errs = captureErrors(() => n.set(1));
    expect(runsA).toBe(2);                         // the run + ONE re-run
    expect(runsB).toBeLessThanOrEqual(3);
    expect(errs.length).toBe(1);
    expect(errs[0]).toMatch(/E-LIFECYCLE-006 — re-triggered during its re-run; dropped/);
    // the effects stay registered and work on the next change
    const errs2 = captureErrors(() => n.set(100));
    expect(runsA).toBe(4);
    expect(errs2.length).toBe(1);
    scope.dispose();
  });

  test("a body that writes its own dep (through a call — not caught statically) re-runs once, then is dropped", () => {
    const scope = rt.root.child();
    const n = rt.cell(0);
    let runs = 0;
    const bump = () => n.set(n.peek() + 1);
    rt.when(scope, [n], () => { runs++; bump(); });
    const errs = captureErrors(() => n.set(1));
    expect(runs).toBe(2);
    expect(errs.length).toBe(1);
    scope.dispose();
  });

  test("a re-trigger while running that does NOT recur runs exactly one more time, silently", () => {
    const scope = rt.root.child();
    const n = rt.cell(0);
    let runs = 0;
    rt.when(scope, [n], () => { runs++; if (runs === 1) n.set(n.peek() + 1); });
    const errs = captureErrors(() => n.set(1));
    expect(runs).toBe(2);
    expect(errs).toEqual([]);
    scope.dispose();
  });
});

describe("RULED (b), S446 — a re-trigger while an earlier run is suspended: the newest run wins", () => {
  test("the earlier run's continuation never resumes; the newest one does; cancellation is not a rollback", async () => {
    // mutation RED: runOnce() not cancelling the earlier tasks
    const scope = rt.root.child();
    const dep = rt.cell(0);
    const before = rt.cell([]);
    const after = rt.cell([]);
    const hosts = [held(), held()];
    let k = 0;
    rt.when(scope, [dep], (task) => {
      const mine = k++;
      before.set([...before.peek(), mine]);         // written before the suspension
      rt.suspend(task, hosts[mine].p, (v) => { after.set([...after.peek(), v]); });
    });
    dep.set(1);                                      // run 0 suspends on hosts[0]
    dep.set(2);                                      // run 1 starts: run 0 is cancelled
    hosts[0].resolve("stale");
    await tick();
    expect(after.peek()).toEqual([]);                // the stale continuation did not write
    hosts[1].resolve("fresh");
    await tick();
    expect(after.peek()).toEqual(["fresh"]);
    expect(before.peek()).toEqual([0, 1]);           // run 0's pre-suspension write stays (no rollback)
    scope.dispose();
  });
});

// Review r2 N1, re-ruled S447 Q8: a re-trigger that crosses a suspension is
// ALLOWED (polling; impl#1's guard is synchronous only) and bounded by the
// ancestry-depth limit (Q7). Before r2 such a chain was unbounded — the
// microtask queue never drained, 0 errors; each body below stops after GUARD
// runs so a regression of the depth bound fails instead of hanging.
describe("re-entry through a suspension — polling allowed, bounded by ancestry depth (r2 N1; RULED S447 Q7/Q8)", () => {
  const GUARD = 1000;
  async function withErrors(fn) {
    const errs = [];
    const saved = console.error;
    console.error = (...a) => errs.push(a.join(" "));
    try { await fn(); } finally { console.error = saved; }
    return errs;
  }
  async function drain(n = 10) { for (let i = 0; i < n; i++) await tick(); }

  test("Q8: a poll — a continuation that writes its own dep — keeps re-running to its own condition (t reaches 5), no E-LIFECYCLE-006", async () => {
    // mutation RED: suspend() running k under the run's own link instead of a boundary (the poll is cyclic → runs=2, t=3, E-LIFECYCLE-006)
    const scope = rt.root.child();
    const t = rt.cell(0);
    let runs = 0;
    rt.when(scope, [t], (task) => { runs++; rt.suspend(task, 1, () => { if (t.peek() < 5) t.set(t.peek() + 1); }); });
    const errs = await withErrors(async () => { t.set(1); await drain(); });
    expect(t.peek()).toBe(5);
    expect(runs).toBe(5);
    expect(errs).toEqual([]);
    scope.dispose();
  });

  test("Q7/Q8: a poll that never stops is stopped at depth 256 — reported as a chain too deep, not runaway growth", async () => {
    // mutation RED: admit() without the depth check → GUARD runs, no report
    const scope = rt.root.child();
    const t = rt.cell(0);
    let runs = 0;
    rt.when(scope, [t], (task) => { runs++; if (runs < GUARD) rt.suspend(task, 1, () => t.set(t.peek() + 1)); });
    const errs = await withErrors(async () => { t.set(1); for (let i = 0; i < 2000; i++) await null; await drain(); });
    expect(runs).toBe(256);
    expect(errs.length).toBe(1);
    expect(errs[0]).toMatch(/when chain too deep — one change's causal chain passed 256 when runs deep \(depth 257\) with no whens created/);
    expect(errs[0]).toMatch(/page state may now be inconsistent/);
    // the page is alive: the next external change polls again from depth 1
    const before = runs;
    await withErrors(async () => { t.set(-100); for (let i = 0; i < 2000; i++) await null; await drain(); });
    expect(runs - before).toBe(256);
    scope.dispose();
  });

  test("the chain starts at the external run's BODY: a sync write → a suspending when → back is one chain, bounded by depth", async () => {
    // mutation RED: runOnce() running the body outside underCause(link) (every cycle looks external → GUARD runs, no report)
    const scope = rt.root.child();
    const n = rt.cell(0);
    const m = rt.cell(0);
    let runsA = 0, runsB = 0;
    rt.when(scope, [n], () => { runsA++; m.set(m.peek() + 1); });
    rt.when(scope, [m], (task) => { runsB++; if (runsB < GUARD) rt.suspend(task, 1, () => n.set(n.peek() + 1)); });
    const errs = await withErrors(async () => { n.set(1); for (let i = 0; i < 2000; i++) await null; await drain(); });
    expect(runsA + runsB).toBe(256);
    expect(errs.length).toBe(1);
    expect(errs[0]).toMatch(/when chain too deep/);
    scope.dispose();
  });

  test("a cycle closed through another when from a continuation is bounded by depth and reported", async () => {
    // mutation RED: suspend() running k outside the run's ancestry (underCause(null)) → GUARD runs, no report
    const scope = rt.root.child();
    const n = rt.cell(0);
    const m = rt.cell(0);
    let runsA = 0, runsB = 0;
    rt.when(scope, [n], (task) => { runsA++; if (runsA < GUARD) rt.suspend(task, 1, () => m.set(m.peek() + 1)); });
    rt.when(scope, [m], () => { runsB++; n.set(n.peek() + 1); });
    const errs = await withErrors(async () => { n.set(1); for (let i = 0; i < 2000; i++) await null; await drain(); });
    expect(runsA + runsB).toBe(256);
    expect(errs.length).toBe(1);
    expect(errs[0]).toMatch(/when chain too deep/);
    scope.dispose();
  });

  test("a continuation that re-triggers ONCE (no recurrence) runs exactly one more time, silently", async () => {
    const scope = rt.root.child();
    const dep = rt.cell(0);
    let runs = 0;
    rt.when(scope, [dep], (task) => { runs++; if (runs === 1) rt.suspend(task, 1, () => dep.set(dep.peek() + 1)); });
    const errs = await withErrors(async () => { dep.set(1); await drain(); });
    expect(runs).toBe(2);
    expect(errs).toEqual([]);
    scope.dispose();
  });

  test("RULED (b) stays intact: external re-triggers during a suspension are new chains, never cap violations", async () => {
    // mutation RED: one provenance per When across events (an external trigger counted as a re-run)
    const scope = rt.root.child();
    const dep = rt.cell(0);
    const hosts = [held(), held(), held(), held(), held()];
    let runs = 0, resumed = [];
    rt.when(scope, [dep], (task) => {
      const mine = runs++;
      rt.suspend(task, hosts[mine].p, () => { resumed.push(mine); });
    });
    const errs = await withErrors(async () => {
      for (let i = 1; i <= 5; i++) { dep.set(i); await tick(); }   // five separate external events
      for (const h of hosts) h.resolve();
      await drain();
    });
    expect(runs).toBe(5);
    expect(resumed).toEqual([4]);                    // the newest run wins
    expect(errs).toEqual([]);
    scope.dispose();
  });

  test("an external re-trigger mid-poll cancels the old poll; the new one polls on; the cancelled continuation writes nothing", async () => {
    const scope = rt.root.child();
    const dep = rt.cell(0);
    const hosts = [held(), held(), held(), held()];
    let runs = 0;
    rt.when(scope, [dep], (task) => {
      const mine = runs++;
      if (mine < hosts.length) rt.suspend(task, hosts[mine].p, () => dep.set(dep.peek() + 1));
    });
    const errs = await withErrors(async () => {
      dep.set(1);                 // run 0, suspended on hosts[0]
      await tick();
      dep.set(10);                // external: run 1, cancels run 0
      hosts[0].resolve();         // cancelled: no write, no run
      await drain();
      expect(runs).toBe(2);
      expect(dep.peek()).toBe(10);
      hosts[1].resolve();         // run 1's continuation self-writes → run 2 (a poll: allowed)
      await drain();
      expect(runs).toBe(3);
      hosts[2].resolve();         // → run 3
      await drain();
      hosts[3].resolve();         // → run 4 (does not suspend)
      await drain();
    });
    expect(runs).toBe(5);
    expect(errs).toEqual([]);
    scope.dispose();
  });
});

// Review round 3. R2-1: the r2 chain counter capped EVERY run of a When in a
// chain, so a non-looping observer re-triggered by a run's continuations was
// dropped with a false E-LIFECYCLE-006. R2-2: a chain that keeps CREATING Whens
// (a row `when` appending a row) is never cyclic; it recursed until "Maximum
// call stack size exceeded". Fix: provenance (a trigger is cyclic iff its
// ancestry holds the When) + a per-event runaway budget + iterative When flush.
describe("provenance — only CYCLIC re-triggers are capped; runaway growth is bounded (review round 3)", () => {
  async function withErrors(fn) {
    const errs = [];
    const saved = console.error;
    console.error = (...a) => errs.push(a.join(" "));
    try { await fn(); } finally { console.error = saved; }
    return errs;
  }
  async function drain() { for (let i = 0; i < 10; i++) await tick(); }

  test("R2-1: an observer re-triggered by every link of another run's continuation chain sees every change, no error", async () => {
    // mutation RED: admit() capping on runs-per-event instead of the trigger's ancestry (r2's counter)
    const scope = rt.root.child();
    const q = rt.cell(0);
    const st = rt.cell("");
    const d = [];
    rt.when(scope, [q], (t) => {
      st.set("loading");
      rt.suspend(t, 1, () => { st.set("parsing"); rt.suspend(t, 2, () => st.set("done")); });
    });
    rt.when(scope, [st], () => d.push(st.peek()));
    const errs = await withErrors(async () => { q.set(1); await drain(); });
    expect(d).toEqual(["loading", "parsing", "done"]);
    expect(errs).toEqual([]);
    scope.dispose();
  });

  test("a synchronous non-cyclic fan-in coalesces (one flush): the observer runs once, sees the final value, no error", () => {
    // (the same FIFO order the re-entrant flush of rounds 0-2 produced: the three writers ran before the observer)
    const scope = rt.root.child();
    const x = rt.cell(0);
    const out = rt.cell(0);
    let runs = 0, seen = -1;
    for (let i = 0; i < 3; i++) rt.when(scope, [x], () => { out.set(out.peek() + 1); });
    rt.when(scope, [out], () => { runs++; seen = out.peek(); });
    const errs = [];
    const saved = console.error;
    console.error = (...a) => errs.push(a.join(" "));
    try { x.set(1); } finally { console.error = saved; }
    expect(runs).toBe(1);
    expect(seen).toBe(3);
    expect(errs).toEqual([]);
    scope.dispose();
  });

  test("R2-2 (runtime): a when that keeps registering new whens is stopped at ancestry depth 256 — reported as runaway growth, no crash, page alive", async () => {
    // mutation RED: admit() without the depth check (RULED S447 Q7) → 15,000 runs (the guard), no report
    const scope = rt.root.child();
    const k = rt.cell(0);
    let runs = 0;
    // (stops growing at 15000 runs so a regression fails instead of hanging)
    const row = () => rt.when(scope, [k], () => { runs++; if (runs < 15000) { k.set(k.peek() + 1); row(); } });
    row();
    let thrown = null;
    const errs = await withErrors(async () => {
      try { k.set(1); } catch (e) { thrown = e; }
      await drain();
    });
    expect(thrown).toBe(null);
    expect(runs).toBeGreaterThan(100);              // it ran: the budget is not a cycle cap
    expect(runs).toBe(256);                         // and it stopped: the run at depth 257 never ran
    expect(errs.some((e) => /runaway growth — one change's causal chain passed 256 when runs deep \(depth 257\) while creating 256 new whens/.test(e))).toBe(true);
    expect(errs.some((e) => /page state may now be inconsistent/.test(e))).toBe(true);
    // the page is alive: the next external change runs the registered whens again (within a fresh budget)
    const before = runs;
    const errs2 = await withErrors(async () => { k.set(k.peek() + 1); await drain(); });
    expect(runs).toBeGreaterThan(before);
    expect(errs2.some((e) => /runaway growth/.test(e))).toBe(true);
    scope.dispose();
  });

  test("the direct fan-out of an external write is free: 12,000 independent whens on one cell all run, no report", () => {
    // mutation RED: admit() spending the budget for an external (null-cause) trigger
    const scope = rt.root.child();
    const x = rt.cell(0);
    let runs = 0;
    for (let i = 0; i < 12000; i++) rt.when(scope, [x], () => { runs++; });
    const errs = [];
    const saved = console.error;
    console.error = (...a) => errs.push(a.join(" "));
    try { x.set(1); } finally { console.error = saved; }
    expect(runs).toBe(12000);
    expect(errs).toEqual([]);
    scope.dispose();
  });

  test("a chain of distinct whens: 250 links complete; one longer than the depth limit stops at 256 — reported as too deep, not growth, no stack overflow", () => {
    // mutation RED: admit() without the depth check → all 4,900 links run, no report
    const chain = (N) => {
      const scope = rt.root.child();
      const cells = Array.from({ length: N + 1 }, () => rt.cell(0));
      for (let i = 0; i < N; i++) rt.when(scope, [cells[i]], () => cells[i + 1].set(1));
      const errs = [];
      const saved = console.error;
      console.error = (...a) => errs.push(a.join(" "));
      try { cells[0].set(1); } finally { console.error = saved; }
      let reached = 0;
      for (let i = 0; i <= N; i++) if (cells[i].peek() === 1) reached = i;
      scope.dispose();
      return { reached, errs };
    };
    const short = chain(250);
    expect(short.reached).toBe(250);
    expect(short.errs).toEqual([]);
    // RULED S447 Q7 cost: a legitimate chain of more than 256 distinct whens is stopped
    const long = chain(4900);
    expect(long.reached).toBe(256);
    expect(long.errs.length).toBe(1);
    expect(long.errs[0]).toMatch(/when chain too deep .* with no whens created/);
  });
});

// Review r3b. F1: the iterative flush (r3) ran a When's pending re-run before
// the Whens its first run had queued, so a downstream When saw only the
// second run's writes. F2: the budget charged registrations, so a run that
// created >budget rows was stopped and its later continuations dropped
// (`loading` stuck true). F3: a bounded cascade was reported as "runaway".
describe("review r3b — re-run order, runs-only budget, honest stop report", () => {
  async function withErrors(fn) {
    const errs = [];
    const saved = console.error;
    console.error = (...a) => errs.push(a.join(" "));
    try { await fn(); } finally { console.error = saved; }
    return errs;
  }
  async function drain() { for (let i = 0; i < 10; i++) await tick(); }

  test("F1: a downstream when observes run 1's write before the upstream's re-run (A1 B1 A2 B2 — the r2 / impl#1 order)", () => {
    // mutation RED: step() re-running in place instead of parking on rerunStack → ["A1","A2","B2"]
    const scope = rt.root.child();
    const x = rt.cell(0);
    const y = rt.cell(0);
    const log = [];
    rt.when(scope, [x], () => { log.push("A" + x.peek()); y.set(y.peek() + 1); if (x.peek() < 2) x.set(x.peek() + 1); });
    rt.when(scope, [y], () => log.push("B" + y.peek()));
    x.set(1);
    expect(log).toEqual(["A1", "B1", "A2", "B2"]);
    scope.dispose();
  });

  test("F1: the re-run waits for the whole transitive drain, innermost first (B's own re-run before A's)", () => {
    // mutation RED: rerunStack popped FIFO (shift) instead of LIFO
    const scope = rt.root.child();
    const x = rt.cell(0), y = rt.cell(0), z = rt.cell(0);
    const log = [];
    rt.when(scope, [x], () => { log.push("A" + x.peek()); y.set(y.peek() + 1); if (x.peek() < 2) x.set(x.peek() + 1); });
    rt.when(scope, [y], () => { log.push("B" + y.peek()); z.set(z.peek() + 1); if (y.peek() === 1) y.set(10); });
    rt.when(scope, [z], () => log.push("C" + z.peek()));
    x.set(1);
    // A1 → queues B; A pending. B1 → queues C; B pending (y=10). C1. Queue empty → pop B (innermost): B10 → C2.
    // Then A2 → y=11 → B11 → C3.
    expect(log).toEqual(["A1", "B1", "C1", "B10", "C2", "A2", "B11", "C3"]);
    scope.dispose();
  });

  test("F2: an async loader that creates 12,000 row whens in one continuation completes — `loading` ends false, no report", async () => {
    // regression guard (r3 charged registrations and dropped the second continuation); the depth unit charges none
    const scope = rt.root.child();
    const page = rt.cell(0), loading = rt.cell(false), tickc = rt.cell(0);
    let doneSeen = 0;
    rt.when(scope, [page], (t) => {
      loading.set(true);
      rt.suspend(t, 1, () => {
        const rows = scope.child();
        for (let i = 0; i < 12000; i++) rt.when(rows, [tickc], () => {});
        rt.suspend(t, 2, () => loading.set(false));
      });
    });
    rt.when(scope, [loading], () => { if (!loading.peek()) doneSeen++; });
    const errs = await withErrors(async () => { page.set(1); await drain(); });
    expect(loading.peek()).toBe(false);
    expect(doneSeen).toBe(1);
    expect(errs).toEqual([]);
    scope.dispose();
  });


  test("F3: a cyclic re-trigger is capped per When per event, not per ancestry path (3 whens sharing a dep stay small)", () => {
    // mutation RED: admit() without the per-When cyclicRuns cap (per-path cap) → hundreds of runs at n=6
    const scope = rt.root.child();
    const k = rt.cell(0);
    let runs = 0;
    for (let i = 0; i < 6; i++) rt.when(scope, [k], () => { runs++; k.set(k.peek() + 1); });
    const errs = [];
    const saved = console.error;
    console.error = (...a) => errs.push(a.join(" "));
    try { k.set(1); } finally { console.error = saved; }
    expect(runs).toBeLessThanOrEqual(100);
    expect(errs.some((e) => /E-LIFECYCLE-006 — re-triggered during its re-run; dropped/.test(e))).toBe(true);
    scope.dispose();
  });

  test("a stopped event is LOUD: a window `error` event (the host's uncaught-error channel) carries the report", () => {
    // mutation RED: reportStop without the window dispatch (console only)
    const scope = rt.root.child();
    const k = rt.cell(0);
    let runs = 0;
    const row = () => rt.when(scope, [k], () => { runs++; if (runs < 15000) { k.set(k.peek() + 1); row(); } });
    row();
    const seen = [];
    const onError = (e) => seen.push(e.message);
    window.addEventListener("error", onError);
    const saved = console.error;
    console.error = () => {};
    try { k.set(1); } finally { console.error = saved; window.removeEventListener("error", onError); }
    expect(seen.length).toBe(1);
    expect(seen[0]).toMatch(/runaway growth .* STOPPED — page state may now be inconsistent/);
    scope.dispose();
  });
});

describe("§6.7.2 teardown — step 1", () => {
  test("disposing the owning scope unregisters the effect; it never fires again", () => {
    // mutation RED: unregister() not removing the observer
    const scope = rt.root.child();
    const x = rt.cell(0);
    let runs = 0;
    const live = rt.stats.whens;
    rt.when(scope, [x], () => { runs++; });
    expect(rt.stats.whens).toBe(live + 1);
    scope.dispose();
    expect(rt.stats.whens).toBe(live);
    expect(x.observers.size).toBe(0);
    x.set(1);
    expect(runs).toBe(0);
  });

  test("step 1 runs before the scope's other cleanups, and child scopes tear down first", () => {
    // mutation RED: ownWhen() pushing onto `cleanups` (LIFO would run the later cleanup first)
    const parent = rt.root.child();
    const child = parent.child();
    const x = rt.cell(0);
    const live = rt.stats.whens;
    const seen = [];
    parent.own(() => seen.push(`parent cleanup sees ${rt.stats.whens - live} when(s)`));
    rt.when(parent, [x], () => {});
    child.own(() => seen.push(`child cleanup sees ${rt.stats.whens - live} when(s)`));
    rt.when(child, [x], () => {});
    parent.dispose();
    expect(seen).toEqual(["child cleanup sees 1 when(s)", "parent cleanup sees 0 when(s)"]);
  });

  test("a batch that changes a dep AND unmounts the effect's arm does not run it (structure settles first)", () => {
    // mutation RED: When.markStale() queueing on the render-effect queue (the dep is written first,
    // so the when would run before the cond effect disposed its arm)
    const scope = rt.root.child();
    const div = document.createElement("div");
    const anchor = document.createComment("a");
    div.appendChild(anchor);
    const show = rt.cell(true);
    const x = rt.cell(0);
    let runs = 0;
    rt.cond(scope, anchor, [{ test: () => show.get(), render: (armScope) => { rt.when(armScope, [x], () => { runs++; }); } }]);
    x.set(1);
    expect(runs).toBe(1);
    rt.batch(() => { x.set(2); show.set(false); });
    expect(runs).toBe(1);
    scope.dispose();
  });

  test("a remount registers afresh — no double registration", () => {
    const owner = rt.root.child();
    const x = rt.cell(0);
    let runs = 0;
    for (let i = 0; i < 3; i++) {
      const arm = owner.child();
      rt.when(arm, [x], () => { runs++; });
      arm.dispose();
    }
    const arm = owner.child();
    rt.when(arm, [x], () => { runs++; });
    x.set(1);
    expect(runs).toBe(1);
    expect(x.observers.size).toBe(1);
    owner.dispose();
  });
});

describe("the suspendable task layer (Core Stmt.Suspend)", () => {
  test("the continuation runs after the host promise settles, in order, with its value, as one batch", async () => {
    const scope = rt.root.child();
    const dep = rt.cell(0);
    const a = rt.cell("");
    const b = rt.cell("");
    const host = held();
    const log = [];
    rt.effect(scope, () => { log.push(`view ${a.get()}|${b.get()}`); });
    rt.when(scope, [dep], (task) => {
      log.push("before");
      rt.suspend(task, host.p, (v) => { a.set(v); b.set(v + "!"); log.push("after"); });
      log.push("returned");
    });
    dep.set(1);
    expect(log).toEqual(["view |", "before", "returned"]);
    host.resolve("ok");
    await tick();
    expect(log).toEqual(["view |", "before", "returned", "after", "view ok|ok!"]);
    scope.dispose();
  });

  test("a chain of suspensions resumes in order", async () => {
    const scope = rt.root.child();
    const dep = rt.cell(0);
    const out = rt.cell([]);
    const one = held();
    const two = held();
    rt.when(scope, [dep], (task) => {
      rt.suspend(task, one.p, (x) => {
        out.set([...out.peek(), x]);
        rt.suspend(task, two.p, (y) => { out.set([...out.peek(), y]); });
      });
    });
    dep.set(1);
    two.resolve("second");
    await tick();
    expect(out.peek()).toEqual([]);
    one.resolve("first");
    await tick();
    expect(out.peek()).toEqual(["first", "second"]);
    scope.dispose();
  });

  test("teardown cancels a suspended effect: its continuation never runs and never writes", async () => {
    // mutation RED: suspend() not checking task.cancelled
    const scope = rt.root.child();
    const dep = rt.cell(0);
    const target = rt.cell("untouched");
    const host = held();
    let resumed = false;
    rt.when(scope, [dep], (task) => {
      rt.suspend(task, host.p, (v) => { resumed = true; target.set(v); });
    });
    dep.set(1);
    scope.dispose();
    host.resolve("late");
    await tick();
    expect(resumed).toBe(false);
    expect(target.peek()).toBe("untouched");
  });

  test("teardown between two links of a chain stops the chain", async () => {
    const scope = rt.root.child();
    const dep = rt.cell(0);
    const steps = [];
    const one = held();
    const two = held();
    rt.when(scope, [dep], (task) => {
      rt.suspend(task, one.p, () => { steps.push(1); rt.suspend(task, two.p, () => { steps.push(2); }); });
    });
    dep.set(1);
    one.resolve();
    await tick();
    scope.dispose();
    two.resolve();
    await tick();
    expect(steps).toEqual([1]);
  });

  test("a rejection on a cancelled task is dropped; on a live task it is re-raised, not swallowed", async () => {
    const scope = rt.root.child();
    const dep = rt.cell(0);
    const dead = held();
    let ran = false;
    rt.when(scope, [dep], (task) => { rt.suspend(task, dead.p, () => { ran = true; }); });
    dep.set(1);
    scope.dispose();
    dead.reject(new Error("dropped"));
    await tick();
    expect(ran).toBe(false);

    // The live case is an UNHANDLED rejection by design, which fails a bun test
    // process — so it runs in a child process that observes it.
    const script = `
      import * as rt from ${JSON.stringify(import.meta.dir + "/runtime/runtime.js")};
      process.on("unhandledRejection", (e) => { console.log("RAISED " + e.message); process.exit(0); });
      const scope = rt.root.child();
      const dep = rt.cell(0);
      let reject;
      const p = new Promise((_, b) => { reject = b; });
      rt.when(scope, [dep], (task) => { rt.suspend(task, p, () => { console.log("CONTINUED"); }); });
      dep.set(1);
      reject(new Error("server said no"));
      setTimeout(() => { console.log("SWALLOWED"); process.exit(1); }, 50);
    `;
    const r = Bun.spawnSync(["bun", "-e", script]);
    expect(r.stdout.toString().trim()).toBe("RAISED server said no");
  });

  test("a plain (non-promise) value still suspends to a later microtask", async () => {
    const scope = rt.root.child();
    const dep = rt.cell(0);
    const log = [];
    rt.when(scope, [dep], (task) => { rt.suspend(task, 7, (v) => log.push(v)); log.push("sync"); });
    dep.set(1);
    expect(log).toEqual(["sync"]);
    await tick();
    expect(log).toEqual(["sync", 7]);
    scope.dispose();
  });
});

// RULED S447 Q7: the backstop's unit is ancestry DEPTH (provisional 256), not a
// run count. Depth = the LONGEST causal chain of runs reaching a run (every
// write that queued it counts), so breadth cannot hide depth.
describe("RULED S447 Q7 — the depth backstop: legitimate breadth and length run; runaways stop fast", () => {
  const quiet = (fn) => {
    const errs = [];
    const saved = console.error;
    console.error = (...a) => errs.push(a.join(" "));
    try { fn(); } finally { console.error = saved; }
    return errs;
  };

  test("a caused write watched by 5,100 row whens: every row runs, the downstream when runs, no report", () => {
    // regression guard: r3b's 5,000-run budget stopped this at row 5,000
    const scope = rt.root.child();
    const page = rt.cell(0), sel = rt.cell(-1), after = rt.cell(0);
    let rowRuns = 0, afterRuns = 0;
    rt.when(scope, [page], () => { for (let i = 0; i < 5100; i++) rt.when(scope, [sel], () => rowRuns++); sel.set(0); after.set(1); });
    rt.when(scope, [after], () => afterRuns++);
    const errs = quiet(() => page.set(1));
    expect(rowRuns).toBe(5100);
    expect(afterRuns).toBe(1);
    expect(errs).toEqual([]);
    scope.dispose();
  });

  test("a 12,000-update continuation stream from one change: the observer sees every update, no report", async () => {
    // regression guard: a run count stops a long stream; its depth stays at 2
    const scope = rt.root.child();
    const go = rt.cell(0), st = rt.cell(0);
    let seen = 0;
    const N = 12000;
    rt.when(scope, [go], (t) => {
      const step = (i) => { st.set(i); if (i < N) rt.suspend(t, 0, () => step(i + 1)); };
      rt.suspend(t, 0, () => step(1));
    });
    rt.when(scope, [st], () => seen++);
    const errs = [];
    const saved = console.error;
    console.error = (...a) => errs.push(a.join(" "));
    try { go.set(1); for (let i = 0; i < N + 50; i++) await null; await tick(); } finally { console.error = saved; }
    expect(seen).toBe(N);
    expect(st.peek()).toBe(N);
    expect(errs).toEqual([]);
    scope.dispose();
  });

  test("a stopped runaway's leftovers, re-triggered by the next click, are stopped again at depth 256 (breadth does not hide depth)", () => {
    // mutation RED: a queued when keeping the depth of its least-cyclic (external) cause, not the deepest → tens of thousands of whens, no report
    const scope = rt.root.child();
    const k = rt.cell(0);
    let runs = 0;
    const mk = () => rt.when(scope, [k], () => { runs++; if (rt.stats.whens < 20000) { k.set(k.peek() + 1); mk(); } });
    mk();
    const e1 = quiet(() => k.set(1));
    expect(runs).toBe(256);
    expect(e1.some((e) => /runaway growth/.test(e))).toBe(true);
    const before = runs;
    const e2 = quiet(() => k.set(k.peek() + 1));
    expect(runs - before).toBe(256);
    expect(rt.stats.whens).toBeLessThan(1000);
    expect(e2.some((e) => /runaway growth — one change's causal chain passed 256 when runs deep/.test(e))).toBe(true);
    scope.dispose();
  });

  test("a dense cycle — 60 whens all writing the dep they all watch — stops at depth 256, fast, reported as too deep (not growth)", () => {
    // mutation RED: least-cyclic depth (as above) → exponentially many runs (n=60: millions)
    const scope = rt.root.child();
    const k = rt.cell(0);
    let runs = 0;
    for (let i = 0; i < 60; i++) rt.when(scope, [k], () => { runs++; if (runs < 100000) k.set(k.peek() + 1); });
    const t0 = performance.now();
    const errs = quiet(() => k.set(1));
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(runs).toBe(256);
    expect(errs.some((e) => /when chain too deep .* with no whens created/.test(e))).toBe(true);
    scope.dispose();
  });

  test("⚑ OPEN (Q8): a 300-cycle poll is stopped at 256 polls — measured and pinned until the ruling on a polling allowance", async () => {
    const scope = rt.root.child();
    const t = rt.cell(0);
    let runs = 0;
    rt.when(scope, [t], (task) => { runs++; rt.suspend(task, 1, () => { if (t.peek() < 300) t.set(t.peek() + 1); }); });
    const errs = [];
    const saved = console.error;
    console.error = (...a) => errs.push(a.join(" "));
    try { t.set(1); for (let i = 0; i < 2000; i++) await null; await tick(); } finally { console.error = saved; }
    expect(runs).toBe(256);
    expect(t.peek()).toBe(257);
    expect(errs.length).toBe(1);
    expect(errs[0]).toMatch(/when chain too deep/);
    scope.dispose();
  });
});
