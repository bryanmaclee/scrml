// effect.runtime.test.js — s449: the `<effect deps=[…]>` runtime (SPEC §6.7.4)
// and the suspendable task layer of the slice runtime, exercised directly with
// injected host promises (no source form suspends until server calls land).
// Each test names the runtime mutation that turns it RED.
//
// Salvaged from the S446 U0 `when` runtime tests, re-scoped by S447: an effect
// body may not write a reactive cell (a compile error), so the bodies here
// record into plain JS arrays — the outside world — and every re-entry /
// cascade / depth-backstop test of U0 is gone with the backstop itself.

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

describe("§6.7.4 <effect> — triggering", () => {
  test("never runs at registration (not on mount); runs once per change of a listed cell", () => {
    // mutation RED: DepEffect's constructor calling run()
    const scope = rt.root.child();
    const x = rt.cell(0);
    let runs = 0;
    rt.effectOn(scope, [x], () => { runs++; });
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
    const seen = [];
    rt.effectOn(scope, [dep], () => { seen.push(other.get()); });
    other.set(11);
    expect(seen).toEqual([]);
    dep.set(1);
    expect(seen).toEqual([11]);
    other.set(12);
    expect(seen).toEqual([11]);
    // and an OUTER render effect whose run writes the dep does not inherit the body's reads
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
    rt.effectOn(scope, [x], () => { runs++; });
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
    rt.effectOn(scope, [a, b], () => { seen.push([a.peek(), b.peek()]); });
    rt.batch(() => { a.set(1); b.set(2); });
    expect(seen).toEqual([[1, 2]]);
    scope.dispose();
  });

  test("a derived read in the body reflects the change that triggered it (§6.7.4 derived flush ordering)", () => {
    const scope = rt.root.child();
    const price = rt.cell(10);
    const qty = rt.cell(2);
    const total = rt.derived(scope, () => price.get() * qty.get());
    expect(total.peek()).toBe(20);              // cached before the change
    const seen = [];
    rt.effectOn(scope, [price], () => { seen.push(total.get()); });
    price.set(15);
    expect(seen).toEqual([30]);
    scope.dispose();
  });

  test("the body runs after the same flush's render effects: it sees the DOM the change produced", () => {
    // mutation RED: DepEffect.markStale() queueing on the render-effect queue (the effect would run
    // before the text hole that the same write invalidated)
    const scope = rt.root.child();
    const div = document.createElement("div");
    const marker = document.createComment("t");
    div.appendChild(marker);
    const n = rt.cell(0);
    rt.text(scope, marker, () => n.get());
    const seen = [];
    rt.effectOn(scope, [n], () => { seen.push(div.textContent); });
    rt.batch(() => { n.set(1); });
    expect(seen).toEqual(["1"]);
    scope.dispose();
  });

  test("a dependency must be a mutable cell; the list must be non-empty (E-LIFECYCLE-007 / E-EFFECT-NO-DEPS shadows)", () => {
    const scope = rt.root.child();
    const d = rt.derived(scope, () => 1);
    expect(() => rt.effectOn(scope, [d], () => {})).toThrow(/mutable cell/);
    expect(() => rt.effectOn(scope, [], () => {})).toThrow(/at least one dependency/);
    const dead = rt.root.child();
    dead.dispose();
    expect(() => rt.effectOn(dead, [rt.cell(0)], () => {})).toThrow(/live owning scope/);
    scope.dispose();
  });
});

describe("the newest run wins (S446 (b), §6.7.4) — a re-trigger while an earlier run is suspended", () => {
  test("the earlier run's continuation never resumes; the newest one does; an outside action already done stands", async () => {
    // mutation RED: run() not cancelling the earlier tasks
    const scope = rt.root.child();
    const dep = rt.cell(0);
    const beacons = [];                              // the outside world: what each run sent before suspending
    const resumed = [];
    const hosts = [held(), held()];
    let k = 0;
    rt.effectOn(scope, [dep], (task) => {
      const mine = k++;
      beacons.push(mine);
      rt.suspend(task, hosts[mine].p, (v) => { resumed.push(v); });
    });
    dep.set(1);                                      // run 0 suspends on hosts[0]
    dep.set(2);                                      // run 1 starts at once: run 0 is cancelled
    expect(beacons).toEqual([0, 1]);                 // not queued, not dropped
    hosts[0].resolve("stale");
    await tick();
    expect(resumed).toEqual([]);                     // the cancelled continuation never ran
    hosts[1].resolve("fresh");
    await tick();
    expect(resumed).toEqual(["fresh"]);
    expect(beacons).toEqual([0, 1]);                 // cancellation is not a rollback: run 0's beacon was sent
    scope.dispose();
  });

  test("the cancelled run's failure is discarded too: its error context does not run", async () => {
    const scope = rt.root.child();
    const dep = rt.cell(0);
    const hosts = [held(), held()];
    let k = 0;
    const resumed = [];
    rt.effectOn(scope, [dep], (task) => {
      const mine = k++;
      rt.suspend(task, hosts[mine].p, (v) => { resumed.push(v); });
    });
    dep.set(1);
    dep.set(2);
    hosts[0].reject(new Error("stale failure"));     // dropped — no unhandled rejection reaches the process
    hosts[1].resolve("ok");
    await tick();
    expect(resumed).toEqual(["ok"]);
    scope.dispose();
  });
});

describe("§6.7.2 teardown — step 1", () => {
  test("disposing the owning scope unregisters the effect; it never fires again", () => {
    // mutation RED: unregister() not removing the observer
    const scope = rt.root.child();
    const x = rt.cell(0);
    let runs = 0;
    const live = rt.stats.depEffects;
    rt.effectOn(scope, [x], () => { runs++; });
    expect(rt.stats.depEffects).toBe(live + 1);
    scope.dispose();
    expect(rt.stats.depEffects).toBe(live);
    expect(x.observers.size).toBe(0);
    x.set(1);
    expect(runs).toBe(0);
  });

  test("step 1 runs before the scope's other cleanups, and child scopes tear down first", () => {
    // mutation RED: ownEffect() pushing onto `cleanups` (LIFO would run the later cleanup first)
    const parent = rt.root.child();
    const child = parent.child();
    const x = rt.cell(0);
    const live = rt.stats.depEffects;
    const seen = [];
    parent.own(() => seen.push(`parent cleanup sees ${rt.stats.depEffects - live} effect(s)`));
    rt.effectOn(parent, [x], () => {});
    child.own(() => seen.push(`child cleanup sees ${rt.stats.depEffects - live} effect(s)`));
    rt.effectOn(child, [x], () => {});
    parent.dispose();
    expect(seen).toEqual(["child cleanup sees 1 effect(s)", "parent cleanup sees 0 effect(s)"]);
  });

  test("a batch that changes a dep AND unmounts the effect's region does not run it (structure settles first)", () => {
    // mutation RED: DepEffect.markStale() queueing on the render-effect queue (the dep is written
    // first, so the effect would run before the cond effect disposed its arm)
    const scope = rt.root.child();
    const div = document.createElement("div");
    const anchor = document.createComment("a");
    div.appendChild(anchor);
    const show = rt.cell(true);
    const x = rt.cell(0);
    let runs = 0;
    rt.cond(scope, anchor, [{ test: () => show.get(), render: (armScope) => { rt.effectOn(armScope, [x], () => { runs++; }); } }]);
    x.set(1);
    expect(runs).toBe(1);
    rt.batch(() => { x.set(2); show.set(false); });
    expect(runs).toBe(1);
    scope.dispose();
  });

  test("a remount registers afresh, without running — no double registration", () => {
    const owner = rt.root.child();
    const x = rt.cell(0);
    let runs = 0;
    for (let i = 0; i < 3; i++) {
      const arm = owner.child();
      rt.effectOn(arm, [x], () => { runs++; });
      arm.dispose();
    }
    const arm = owner.child();
    rt.effectOn(arm, [x], () => { runs++; });
    expect(runs).toBe(0);
    x.set(1);
    expect(runs).toBe(1);
    expect(x.observers.size).toBe(1);
    owner.dispose();
  });
});

describe("the suspendable task layer (Core Stmt.Suspend)", () => {
  test("the continuation runs after the host promise settles, in order, with its value", async () => {
    const scope = rt.root.child();
    const dep = rt.cell(0);
    const host = held();
    const log = [];
    rt.effectOn(scope, [dep], (task) => {
      log.push("before");
      rt.suspend(task, host.p, (v) => { log.push(`after ${v}`); });
      log.push("returned");
    });
    dep.set(1);
    expect(log).toEqual(["before", "returned"]);
    host.resolve("ok");
    await tick();
    expect(log).toEqual(["before", "returned", "after ok"]);
    scope.dispose();
  });

  test("a chain of suspensions resumes in order", async () => {
    const scope = rt.root.child();
    const dep = rt.cell(0);
    const out = [];
    const one = held();
    const two = held();
    rt.effectOn(scope, [dep], (task) => {
      rt.suspend(task, one.p, (x) => {
        out.push(x);
        rt.suspend(task, two.p, (y) => { out.push(y); });
      });
    });
    dep.set(1);
    two.resolve("second");
    await tick();
    expect(out).toEqual([]);
    one.resolve("first");
    await tick();
    expect(out).toEqual(["first", "second"]);
    scope.dispose();
  });

  test("teardown cancels a suspended effect: its continuation never runs", async () => {
    // mutation RED: suspend() not checking task.cancelled
    const scope = rt.root.child();
    const dep = rt.cell(0);
    const host = held();
    let resumed = false;
    rt.effectOn(scope, [dep], (task) => {
      rt.suspend(task, host.p, () => { resumed = true; });
    });
    dep.set(1);
    scope.dispose();
    host.resolve("late");
    await tick();
    expect(resumed).toBe(false);
  });

  test("teardown between two links of a chain stops the chain", async () => {
    const scope = rt.root.child();
    const dep = rt.cell(0);
    const steps = [];
    const one = held();
    const two = held();
    rt.effectOn(scope, [dep], (task) => {
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

  // s454 (U1b, design §2.4 item 3): a live task's rejection is no longer re-raised as an
  // UNHANDLED rejection — it goes to the runtime's ONE host-error reporter (never swallowed).
  test("a rejection on a cancelled task is dropped; on a live task it reaches the host-error reporter, not swallowed", async () => {
    const scope = rt.root.child();
    const dep = rt.cell(0);
    const dead = held();
    let ran = false;
    rt.effectOn(scope, [dep], (task) => { rt.suspend(task, dead.p, () => { ran = true; }); });
    dep.set(1);
    scope.dispose();
    dead.reject(new Error("dropped"));
    await tick();
    expect(ran).toBe(false);

    // The live case runs in a child process that also watches for an unhandled
    // rejection (which must NOT happen any more).
    const script = `
      import * as rt from ${JSON.stringify(import.meta.dir + "/runtime/runtime.js")};
      process.on("unhandledRejection", (e) => { console.log("UNHANDLED " + e.message); process.exit(1); });
      rt.setHostErrorReporter((e) => { console.log("REPORTED " + e.message); process.exit(0); });
      const scope = rt.root.child();
      const dep = rt.cell(0);
      let reject;
      const p = new Promise((_, b) => { reject = b; });
      rt.effectOn(scope, [dep], (task) => { rt.suspend(task, p, () => { console.log("CONTINUED"); }); });
      dep.set(1);
      reject(new Error("server said no"));
      setTimeout(() => { console.log("SWALLOWED"); process.exit(1); }, 50);
    `;
    const r = Bun.spawnSync(["bun", "-e", script]);
    expect(r.stdout.toString().trim()).toBe("REPORTED server said no");
  });

  test("a plain (non-promise) value still suspends to a later microtask", async () => {
    const scope = rt.root.child();
    const dep = rt.cell(0);
    const log = [];
    rt.effectOn(scope, [dep], (task) => { rt.suspend(task, 7, (v) => log.push(v)); log.push("sync"); });
    dep.set(1);
    expect(log).toEqual(["sync"]);
    await tick();
    expect(log).toEqual(["sync", 7]);
    scope.dispose();
  });
});
