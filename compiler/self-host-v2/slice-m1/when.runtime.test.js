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
