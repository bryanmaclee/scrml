/**
 * reactive-set-stores-deep-reactive-value.test.js
 * g-each-replaced-row-stops-receiving-in-place-edits (S429).
 *
 * A cell write stores the deep-reactive Proxy of a plain array / plain object,
 * whatever expression produced it. Before the fix only a syntactically literal
 * right-hand side was wrapped (codegen's _wrapDeepReactive), so a computed write
 * (@xs = @xs.map(...), the _scrml_deep_set clone behind @xs[i] = v, a fetched
 * value) stored a RAW container. Edits reached through it bypassed the Proxy set
 * trap: state changed and no effect fired.
 *
 * These tests pin the runtime contract of _scrml_reactive_set /
 * _scrml_cell_value:
 *   - plain arrays and plain objects (including null-prototype) are stored wrapped;
 *   - an element edit through the STORED value fires the effect reading it;
 *   - Date / Map / Set / class instances / frozen values / primitives pass through
 *     untouched (a Proxy would break their methods or the get-trap invariant);
 *   - wrapping is identity-stable (same raw -> same Proxy; a Proxy passes through);
 *   - a frozen element inside a wrapped array reads back raw, so a nested read
 *     does not violate the Proxy get-trap invariant.
 */

import { describe, test, expect } from "bun:test";
import { SCRML_RUNTIME } from "../../src/runtime-template.js";

function createRuntime() {
  const wrapper = new Function(`
    const document = { querySelector: () => null, createElement: () => ({ setAttribute: () => {}, appendChild: () => {}, innerHTML: "" }), head: { appendChild: () => {} }, body: { appendChild: () => {} }, addEventListener: () => {}, removeEventListener: () => {} };
    const window = { addEventListener: () => {} };
    const requestAnimationFrame = (fn) => 0;
    const cancelAnimationFrame = () => {};
    const navigator = { getGamepads: () => [] };

    ${SCRML_RUNTIME}

    return { _scrml_deep_reactive, _scrml_effect, _scrml_reactive_set, _scrml_reactive_get,
      _scrml_to_plain: typeof _scrml_to_plain === "function" ? _scrml_to_plain : null };
  `);
  return wrapper();
}

// A value is a deep-reactive Proxy iff wrapping it again returns it unchanged
// while it is NOT the raw value we stored.
const isWrappedOf = (rt, stored, raw) => stored !== raw && rt._scrml_deep_reactive(stored) === stored;

describe("_scrml_reactive_set stores the deep-reactive value of a computed write", () => {
  test("a plain array is stored wrapped, and an element edit through it fires the reading effect", () => {
    const rt = createRuntime();
    const raw = [{ id: 1, name: "one" }, { id: 2, name: "two" }];
    rt._scrml_reactive_set("rows", raw);
    const stored = rt._scrml_reactive_get("rows");
    expect(isWrappedOf(rt, stored, raw)).toBe(true);

    const seen = [];
    rt._scrml_effect(() => { seen.push(rt._scrml_reactive_get("rows")[0].name); });
    for (const r of rt._scrml_reactive_get("rows")) r.name = r.name + "!";
    expect(seen).toEqual(["one", "one!"]);
    expect(raw[0].name).toBe("one!");
  });

  test("the gap's shape: a .map replace of one row keeps edits to the NEW row live", () => {
    const rt = createRuntime();
    rt._scrml_reactive_set("rows", [{ id: 1, name: "one" }, { id: 2, name: "two" }]);
    rt._scrml_reactive_set("rows", rt._scrml_reactive_get("rows").map((g) => (g.id === 1 ? { id: 1, name: "R" } : g)));
    const seen = [];
    rt._scrml_effect(() => { seen.push(rt._scrml_reactive_get("rows")[0].name); });
    rt._scrml_reactive_get("rows")[0].name = "R!";
    expect(seen).toEqual(["R", "R!"]);
  });

  test("a plain object and a null-prototype object are stored wrapped", () => {
    const rt = createRuntime();
    const o = { a: { b: 1 } };
    rt._scrml_reactive_set("o", o);
    expect(isWrappedOf(rt, rt._scrml_reactive_get("o"), o)).toBe(true);
    const seen = [];
    rt._scrml_effect(() => { seen.push(rt._scrml_reactive_get("o").a.b); });
    rt._scrml_reactive_get("o").a.b = 2;
    expect(seen).toEqual([1, 2]);

    const n = Object.create(null);
    n.x = 1;
    rt._scrml_reactive_set("n", n);
    expect(isWrappedOf(rt, rt._scrml_reactive_get("n"), n)).toBe(true);
  });

  test("non-plain values pass through untouched (their methods keep working)", () => {
    const rt = createRuntime();
    class Point { constructor() { this.x = 1; } len() { return this.x; } }
    const values = {
      date: new Date(0),
      map: new Map([["k", 1]]),
      set: new Set([1]),
      point: new Point(),
      frozen: Object.freeze({ inner: { v: 1 } }),
      str: "s",
      num: 3,
      nul: null,
    };
    for (const [k, v] of Object.entries(values)) {
      rt._scrml_reactive_set(k, v);
      expect(rt._scrml_reactive_get(k)).toBe(v);
    }
    expect(rt._scrml_reactive_get("date").getTime()).toBe(0);
    expect(rt._scrml_reactive_get("map").get("k")).toBe(1);
    expect(rt._scrml_reactive_get("set").has(1)).toBe(true);
    expect(rt._scrml_reactive_get("point").len()).toBe(1);
    expect(rt._scrml_reactive_get("frozen").inner.v).toBe(1);
  });

  test("wrapping is identity-stable: the same raw value and an existing Proxy both store the same Proxy", () => {
    const rt = createRuntime();
    const raw = [1, 2];
    rt._scrml_reactive_set("a", raw);
    const p1 = rt._scrml_reactive_get("a");
    rt._scrml_reactive_set("a", raw);
    expect(rt._scrml_reactive_get("a")).toBe(p1);
    rt._scrml_reactive_set("b", p1);
    expect(rt._scrml_reactive_get("b")).toBe(p1);
  });

  test("a frozen element inside a wrapped array reads back raw (no get-trap invariant TypeError on a nested read)", () => {
    const rt = createRuntime();
    const entry = Object.freeze({ to: { variant: "B" }, at: 1 });
    rt._scrml_reactive_set("log", [entry]);
    const got = rt._scrml_reactive_get("log")[0];
    expect(got).toBe(entry);
    expect(() => got.to.variant).not.toThrow();
    expect(got.to.variant).toBe("B");
    // and the direct form: _scrml_deep_reactive declines a frozen value
    expect(rt._scrml_deep_reactive(entry)).toBe(entry);
  });
});

// A cell value now reaches the structured-clone boundary (worker postMessage)
// as a Proxy far more often, and structured clone throws on a Proxy anywhere in
// the graph. _scrml_to_plain is the copy the worker send hands over.
describe("_scrml_to_plain — the structured-clone boundary", () => {
  test("structured clone of a stored cell value throws; of its _scrml_to_plain copy it round-trips", () => {
    const rt = createRuntime();
    expect(typeof rt._scrml_to_plain).toBe("function");
    // a stored value that also carries a Proxy INSIDE its raw backing array
    // (what a .map over a proxied array produces)
    rt._scrml_reactive_set("rows", [{ id: 1, when: new Date(0), tags: ["a"] }]);
    const carried = rt._scrml_reactive_get("rows").map((r) => r);
    rt._scrml_reactive_set("rows", [...carried, { id: 2, when: new Date(1), tags: [] }]);
    const cell = rt._scrml_reactive_get("rows");
    expect(() => structuredClone(cell)).toThrow();
    const plain = rt._scrml_to_plain(cell);
    const back = structuredClone(plain);
    expect(back).toEqual([{ id: 1, when: new Date(0), tags: ["a"] }, { id: 2, when: new Date(1), tags: [] }]);
    expect(back[0].when instanceof Date).toBe(true);
  });

  test("primitives and non-plain values pass through; a shared sub-object is copied once", () => {
    const rt = createRuntime();
    for (const v of [null, 3, "s", true]) expect(rt._scrml_to_plain(v)).toBe(v);
    const m = new Map([["k", 1]]);
    expect(rt._scrml_to_plain(m)).toBe(m);
    const shared = { x: 1 };
    const out = rt._scrml_to_plain(rt._scrml_deep_reactive({ a: shared, b: shared }));
    expect(out.a).toBe(out.b);
    expect(out.a).not.toBe(shared);
  });
});

describe("worker send hands the worker a plain copy (emitted shape)", () => {
  test("the emitted <#name>.send unwraps data before postMessage", async () => {
    const { splitBlocks } = await import("../../src/block-splitter.js");
    const { buildAST } = await import("../../src/ast-builder.js");
    const { runCEFile } = await import("../../src/component-expander.js");
    const { runCG } = await import("../../src/codegen/index.ts");
    const src = `<program>
<program name="doubler">
    \${ when message(n) { send(n) } }
</>
<div>Main</>
</program>`;
    const ce = runCEFile(buildAST(splitBlocks("test.scrml", src)));
    const cg = runCG({
      files: [ce],
      routeMap: { routes: [], functions: new Map(), authMiddleware: new Map() },
      depGraph: { nodes: new Map(), edges: [] },
      protectAnalysis: null,
      embedRuntime: true,
    });
    const js = [...cg.outputs.values()][0].clientJs;
    const send = js.slice(js.indexOf("_scrml_worker_doubler.send = function(data) {"));
    const unwrap = send.indexOf(`if (typeof _scrml_to_plain === "function") data = _scrml_to_plain(data);`);
    const post = send.indexOf("postMessage(data)");
    expect(unwrap).toBeGreaterThan(0);
    expect(post).toBeGreaterThan(unwrap);
  });
});
