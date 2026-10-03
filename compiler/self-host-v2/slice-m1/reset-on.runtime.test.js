// reset-on.runtime.test.js — s449: the `reset-on=[…]` runtime (SPEC §6.8.4),
// exercised directly. Each test names the runtime mutation that turns it RED.

import { describe, test, expect } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import * as rt from "./runtime/runtime.js";

if (!globalThis.document) GlobalRegistrator.register();

describe("§6.8.4 reset-on= — the write", () => {
  test("a change of a trigger resets the cell; a same-value write of the trigger is no change", () => {
    const scope = rt.root.child();
    const query = rt.cell("");
    const page = rt.cell(3);
    rt.resetOn(scope, [query], () => page.set(1), 0);
    query.set("");
    expect(page.peek()).toBe(3);
    query.set("a");
    expect(page.peek()).toBe(1);
    scope.dispose();
  });

  test("rule 4 — ONE change for every dependent: an effect and a render effect reading both run once, seeing the reset value", () => {
    // mutation RED: ResetOn.markStale() queueing the reset for the flush instead of applying it in the
    // writer's batch (the effect would run for the trigger, then again for the reset)
    const scope = rt.root.child();
    const query = rt.cell("");
    const page = rt.cell(3);
    rt.resetOn(scope, [query], () => page.set(1), 0);
    const searches = [];
    const views = [];
    rt.effectOn(scope, [query, page], () => { searches.push(`${query.peek()}@${page.peek()}`); });
    rt.effect(scope, () => { views.push(`${query.get()}@${page.get()}`); });
    query.set("shoes");
    expect(searches).toEqual(["shoes@1"]);             // one search, already on page 1
    expect(views).toEqual(["@3", "shoes@1"]);          // one re-render, never "shoes@3"
    scope.dispose();
  });

  test("the code that wrote the trigger reads the reset value right after its write", () => {
    const scope = rt.root.child();
    const query = rt.cell("");
    const page = rt.cell(3);
    rt.resetOn(scope, [query], () => page.set(1), 0);
    let seen = -1;
    rt.batch(() => { query.set("a"); seen = page.peek(); });
    expect(seen).toBe(1);
    scope.dispose();
  });

  test("rule 3/4 — a chain is applied in rank order, each cell once: a diamond resets its sink once, after its source", () => {
    // mutation RED: drainResets() taking resets in insertion order instead of rank order (the sink
    // would reset first, reading the source's PRE-reset value)
    const scope = rt.root.child();
    const c = rt.cell(0);
    const b = rt.cell(5);
    const a = rt.cell(7);
    const log = [];
    // a resets on b and c (rank 1); b resets on c (rank 0); a's reset value reads b
    rt.resetOn(scope, [b, c], () => { log.push(`a reads b=${b.peek()}`); a.set(b.peek() * 10); }, 1);
    rt.resetOn(scope, [c], () => { log.push("b"); b.set(0); }, 0);
    const runs = [];
    rt.effectOn(scope, [a, b, c], () => { runs.push([a.peek(), b.peek(), c.peek()]); });
    c.set(1);
    expect(log).toEqual(["b", "a reads b=0"]);
    expect(a.peek()).toBe(0);
    expect(runs).toEqual([[0, 0, 1]]);
    scope.dispose();
  });

  test("disposing the owning scope unregisters the rule", () => {
    const scope = rt.root.child();
    const q = rt.cell(0);
    const p = rt.cell(3);
    rt.resetOn(scope, [q], () => p.set(1), 0);
    scope.dispose();
    expect(q.observers.size).toBe(0);
    q.set(1);
    expect(p.peek()).toBe(3);
  });

  test("an entry must be a mutable cell; the list must be non-empty", () => {
    const scope = rt.root.child();
    const d = rt.derived(scope, () => 1);
    expect(() => rt.resetOn(scope, [d], () => {}, 0)).toThrow(/mutable cell/);
    expect(() => rt.resetOn(scope, [], () => {}, 0)).toThrow(/at least one cell/);
    scope.dispose();
  });
});
