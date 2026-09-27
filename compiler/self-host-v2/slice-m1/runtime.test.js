// runtime.test.js — contract tests on the slice-M1 runtime that the two target
// programs cannot reach by themselves (review F3): each is written so that the
// named mutation of runtime/runtime.js turns it RED.

import { describe, test, expect } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import * as rt from "./runtime/runtime.js";

if (!globalThis.document) GlobalRegistrator.register();

function host() {
  const div = document.createElement("div");
  const anchor = document.createComment("a");
  div.appendChild(anchor);
  return { div, anchor };
}

describe("runtime contracts", () => {
  test("<each> renders rows UNTRACKED — a signal read by a row's render does not re-run the list", () => {
    // mutation RED: `each` calling reconcile without untrack()
    const scope = rt.root.child();
    const { anchor } = host();
    const outer = rt.cell(0);
    const items = rt.cell([{ id: 1 }, { id: 2 }]);
    let renders = 0;
    let listRuns = 0;
    rt.each(scope, anchor, () => { listRuns++; return items.get(); }, (it) => it.id, () => { renders++; outer.get(); });
    expect(renders).toBe(2);
    expect(listRuns).toBe(1);
    outer.set(1);
    expect(listRuns).toBe(1);          // the list effect did not subscribe to what a row read
    expect(renders).toBe(2);
    items.set([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(listRuns).toBe(2);          // …but it does follow its source
    expect(renders).toBe(3);
    scope.dispose();
  });

  test("a conditional arm renders UNTRACKED — only the arm tests are the cond's dependencies", () => {
    const scope = rt.root.child();
    const { anchor } = host();
    const show = rt.cell(true);
    const inner = rt.cell(0);
    let renders = 0;
    let testRuns = 0;
    rt.cond(scope, anchor, [{ test: () => { testRuns++; return show.get(); }, render: () => { renders++; inner.get(); } }]);
    expect(renders).toBe(1);
    inner.set(1);
    expect(testRuns).toBe(1);
    expect(renders).toBe(1);
    scope.dispose();
  });

  test("a `let` initializer is evaluated ONCE, UNTRACKED (§66.9 seeded)", () => {
    // mutation RED: seeded() evaluating init without untrack()
    const scope = rt.root.child();
    const src = rt.cell(5);
    let runs = 0;
    let seededCell = null;
    rt.effect(scope, () => { runs++; if (seededCell === null) seededCell = rt.seeded(() => src.get()); });
    expect(runs).toBe(1);
    src.set(6);
    expect(runs).toBe(1);                 // the enclosing effect did not subscribe to src
    expect(seededCell.peek()).toBe(5);    // seeded once: does not follow its source
    scope.dispose();
  });

  test("during construction a seed is OWED: it may read a record allocated after it; a cycle is reported (L12 (b))", () => {
    const decl = rt.declare("probe", ["a", "b"]);
    const inst = rt.instance(decl, rt.root);
    let b = null;
    rt.construct(inst, () => {
      inst.fields[0] = rt.seeded(() => b.peek() + 1);   // reads a cell that does not exist yet
      b = rt.seeded(() => 41);
      inst.fields[1] = b;
    });
    expect(inst.fields[0].peek()).toBe(42);
    expect(inst.fields[0].pending).toBe(null);          // settled when construction ended, not on this read
    const loop = rt.instance(decl, rt.root);
    expect(() => rt.construct(loop, () => {
      loop.fields[0] = rt.seeded(() => loop.fields[1].peek());
      loop.fields[1] = rt.seeded(() => loop.fields[0].peek());
    })).toThrow(/seeding cycle/);
    inst.scope.dispose();
    loop.scope.dispose();
  });

  test("an event handler runs as ONE batch — an effect reading two cells re-runs once", () => {
    // mutation RED: on() calling the handler without batch()
    const scope = rt.root.child();
    const btn = document.createElement("button");
    const a = rt.cell(0);
    const b = rt.cell(0);
    const seen = [];
    rt.effect(scope, () => { seen.push(a.get() + ":" + b.get()); });
    rt.on(scope, btn, "click", () => { a.set(1); b.set(1); });
    btn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    expect(seen).toEqual(["0:0", "1:1"]);   // no glitch state "1:0"
    scope.dispose();
  });

  test("the runtime `rule=` edge check rejects a non-edge; a self-write is a no-op", () => {
    // mutation RED: transition() without the edge check / without the self-write no-op
    const table = rt.edges({ Idle: ["Saving"], Saving: ["Saved", "Failed"], Saved: ["Saving"], Failed: ["Saving"] });
    const st = rt.cell("Idle");
    expect(() => rt.transition(st, table, "Saved")).toThrow(/E-ENGINE-INVALID-TRANSITION/);
    expect(st.peek()).toBe("Idle");
    expect(() => rt.transition(st, table, "Idle")).not.toThrow();
    rt.transition(st, table, "Saving");
    rt.transition(st, table, "Saved");
    expect(st.peek()).toBe("Saved");
    expect(() => rt.transition(st, table, "Failed")).toThrow(/E-ENGINE-INVALID-TRANSITION/);
  });

  test("a disposed Derived unsubscribes from its sources", () => {
    // mutation RED: Derived's scope cleanup not calling unsubscribe()
    const scope = rt.root.child();
    const src = rt.cell(1);
    const d = rt.derived(scope, () => src.get() * 2);
    expect(d.get()).toBe(2);
    expect(src.observers.size).toBe(1);
    const before = rt.stats.deriveds;
    scope.dispose();
    expect(src.observers.size).toBe(0);
    expect(d.sources.size).toBe(0);
    expect(rt.stats.deriveds).toBe(before - 1);
  });

  test("a disposed scope leaves its parent's children", () => {
    // mutation RED: Scope.dispose() not deleting itself from parent.children
    const parent = rt.root.child();
    const kid = parent.child();
    expect(parent.children.has(kid)).toBe(true);
    kid.dispose();
    expect(parent.children.has(kid)).toBe(false);
    parent.dispose();
  });

  test("setIn copies arrays as arrays and structs as structs, sharing untouched branches", () => {
    const rows = rt.cell([{ id: 1, qty: 1 }, { id: 2, qty: 1 }]);
    const old = rows.peek();
    rt.setIn(rows, [1, "qty"], 5);
    const now = rows.peek();
    expect(Array.isArray(now)).toBe(true);
    expect(now[1]).toEqual({ id: 2, qty: 5 });
    expect(now[0]).toBe(old[0]);
    expect(old[1].qty).toBe(1);
  });
});
