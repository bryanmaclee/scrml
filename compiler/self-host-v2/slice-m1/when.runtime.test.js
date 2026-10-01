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

// Review r2 N1 (mechanism re-done r3: provenance): a When is not `running` while
// suspended; before r2 a continuation's re-trigger got a fresh run with a fresh cap —
// unbounded runs, the microtask queue never drained, 0 errors. Each body below
// stops suspending after GUARD runs so a regression fails instead of hanging.
describe("re-entry through a suspension — the cap counts the whole causal chain (review r2 N1)", () => {
  const GUARD = 50;
  async function withErrors(fn) {
    const errs = [];
    const saved = console.error;
    console.error = (...a) => errs.push(a.join(" "));
    try { await fn(); } finally { console.error = saved; }
    return errs;
  }
  async function drain() { for (let i = 0; i < 10; i++) await tick(); }

  test("a continuation that writes its own dep (through a call) re-runs once, then is dropped and reported", async () => {
    // mutation RED: suspend() running k outside underCause(task.cause) (each re-trigger looks external → GUARD runs, 0 errors)
    const scope = rt.root.child();
    const dep = rt.cell(0);
    let runs = 0;
    const bump = () => dep.set(dep.peek() + 1);
    rt.when(scope, [dep], (task) => { runs++; if (runs < GUARD) rt.suspend(task, 1, () => bump()); });
    const errs = await withErrors(async () => { dep.set(1); await drain(); });
    expect(runs).toBe(2);                            // exactly like the synchronous path
    expect(errs.length).toBe(1);
    expect(errs[0]).toMatch(/E-LIFECYCLE-006 — re-triggered during its re-run; dropped/);
    // the page is alive: the next external change runs it again, with a fresh budget
    const errs2 = await withErrors(async () => { dep.set(100); await drain(); });
    expect(runs).toBe(4);
    expect(errs2.length).toBe(1);
    scope.dispose();
  });

  test("the chain starts at the external run's BODY: a sync write → a suspending when → back is counted from the first run", async () => {
    // mutation RED: runOnce() running the body outside underCause(link) (B's first run looks external → A runs 3 times)
    const scope = rt.root.child();
    const n = rt.cell(0);
    const m = rt.cell(0);
    let runsA = 0, runsB = 0;
    rt.when(scope, [n], () => { runsA++; m.set(m.peek() + 1); });
    rt.when(scope, [m], (task) => { runsB++; if (runsB < GUARD) rt.suspend(task, 1, () => n.set(n.peek() + 1)); });
    const errs = await withErrors(async () => { n.set(1); await drain(); });
    expect(runsA).toBe(2);
    expect(runsB).toBe(2);
    expect(errs.length).toBe(1);
    scope.dispose();
  });

  test("a cycle closed through another when from a continuation is bounded and reported", async () => {
    // mutation RED: suspend() running k outside underCause(task.cause)
    const scope = rt.root.child();
    const n = rt.cell(0);
    const m = rt.cell(0);
    let runsA = 0, runsB = 0;
    rt.when(scope, [n], (task) => { runsA++; if (runsA < GUARD) rt.suspend(task, 1, () => m.set(m.peek() + 1)); });
    rt.when(scope, [m], () => { runsB++; n.set(n.peek() + 1); });
    const errs = await withErrors(async () => { n.set(1); await drain(); });
    expect(runsA).toBe(2);
    expect(runsB).toBe(2);
    expect(errs.length).toBe(1);
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

  test("an external re-trigger mid-chain starts a fresh budget; the cancelled chain's continuation counts for nothing", async () => {
    const scope = rt.root.child();
    const dep = rt.cell(0);
    const hosts = [held(), held(), held(), held()];
    let runs = 0;
    rt.when(scope, [dep], (task) => {
      const mine = runs++;
      if (mine < hosts.length) rt.suspend(task, hosts[mine].p, () => dep.set(dep.peek() + 1));
    });
    const errs = await withErrors(async () => {
      dep.set(1);                 // run 0 — chain 1, suspended on hosts[0]
      await tick();
      dep.set(10);                // external: run 1 — chain 2, cancels run 0
      hosts[0].resolve();         // cancelled: no write, no run
      await drain();
      expect(runs).toBe(2);
      hosts[1].resolve();         // chain 2's continuation self-writes → run 2 (chain 2's one re-run)
      await drain();
      expect(runs).toBe(3);
      hosts[2].resolve();         // → chain 2 over its cap: dropped and reported
      await drain();
    });
    expect(runs).toBe(3);
    expect(errs.length).toBe(1);
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

  test("R2-2 (runtime): a when that keeps registering new whens is stopped by the event budget — reported, no crash, page alive", async () => {
    // mutation RED: WhenEvent.spend() always true (no budget) → "Maximum call stack size exceeded" or no report
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
    expect(runs).toBeLessThanOrEqual(10000);        // and it stopped
    expect(errs.some((e) => /runaway — one change caused more than 10000 when runs/.test(e))).toBe(true);
    // the page is alive: the next external change runs the registered whens again (within a fresh budget)
    const before = runs;
    const errs2 = await withErrors(async () => { k.set(k.peek() + 1); await drain(); });
    expect(runs).toBeGreaterThan(before);
    expect(errs2.some((e) => /runaway/.test(e))).toBe(true);
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

  test("a long NON-cyclic chain of distinct whens runs iteratively — no stack overflow below the budget", () => {
    // mutation RED: flush() running Whens re-entrantly (no `whenRunning` guard) → RangeError at a few thousand
    const scope = rt.root.child();
    const N = 6000;
    const cells = Array.from({ length: N + 1 }, () => rt.cell(0));
    for (let i = 0; i < N; i++) rt.when(scope, [cells[i]], () => cells[i + 1].set(1));
    cells[0].set(1);
    expect(cells[N].peek()).toBe(1);
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
