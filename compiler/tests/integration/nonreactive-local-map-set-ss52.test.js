/**
 * ss52 — NON-REACTIVE LOCAL map/set method lowering (the (c) bug) END-TO-END.
 *
 * Before ss52, a value-native map/set used in NON-REACTIVE / pure code
 * (`let m = [:]; m = m.insert("k", 1); return m.size`) emitted RAW `m.insert(...)`
 * / `m.size` (method/property syntax) — but the runtime map API is FREE FUNCTIONS
 * (`_scrml_map_insert(m, k, v)`) and the HAMT carries `.count`, not `.size`. The
 * emit compiled clean (`node --check` passes — valid JS syntax) and crashed at
 * runtime with `TypeError: m.insert is not a function`. The §59 lowering keyed on
 * the `@`-cell sigil + reactive-only mapVarNames/setVarNames registries, so a
 * non-reactive local (no `@`, fn/block-scoped) fell through to raw emission.
 *
 * This suite asserts that a pure `fn` using a local map AND a local set:
 *   - compiles with NO codegen errors and is syntactically valid JS;
 *   - LOWERS to the bare-receiver `_scrml_map_*` form (NOT raw `.insert`/`.size`,
 *     NOT `_scrml_reactive_get` — these are non-reactive locals);
 *   - EXECUTES against the emitted runtime returning the CORRECT values
 *     (the load-bearing R26 RUN gate — the (c) bug was runtime-only);
 *   - across the full adversarial matrix: nested local maps, a local map
 *     passed-to / returned-from a fn, single-use vs reassigned, ORDERED maps,
 *     block-scoped (if/for body) locals, and full set algebra.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import vm from "vm";

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "nonreactive-mapset-ss52-")); });
afterAll(() => { if (TMP) rmSync(TMP, { recursive: true, force: true }); });

// A markup file whose `${…}` logic block declares a battery of PURE `fn`s, each
// exercising a non-reactive local map/set shape, and interpolates each call so
// the bodies are emitted + reachable.
const SRC = `<div>
    \${
        fn basicMap() -> int {
            let m = [:]
            m = m.insert("a", 1)
            m = m.insert("b", 2)
            let viaBracket = m["a"]
            return m.size + viaBracket
        }
        fn typedMapRemove() -> int {
            let m: [string: int] = [:]
            m = m.insert("x", 10)
            m = m.insert("y", 20)
            m = m.remove("x")
            return m.size
        }
        fn mapHasGetOr() -> int {
            let m: [string: int] = [:]
            m = m.insert("only", 5)
            let present = m.getOr("only", 0)
            let missing = m.getOr("nope", 99)
            return present + missing
        }
        fn nestedMap() -> int {
            let outer: [string: [string: int]] = [:]
            let inner = [:]
            inner = inner.insert("deep", 42)
            outer = outer.insert("k", inner)
            return outer["k"]["deep"]
        }
        fn basicSet() -> int {
            let s: set[string] = [:]
            s = s.add("a")
            s = s.add("b")
            s = s.add("a")
            return s.size
        }
        fn setHasRemove() -> int {
            let s: set[int] = [:]
            s = s.add(1)
            s = s.add(2)
            s = s.remove(1)
            if (s.has(2)) { return s.size }
            return 0
        }
        fn setElements() -> int {
            let s: set[int] = [:]
            s = s.add(7)
            s = s.add(8)
            let els = s.elements()
            return els.length
        }
        fn setUnion() -> int {
            let a: set[int] = [:]
            a = a.add(1)
            a = a.add(2)
            let b: set[int] = [:]
            b = b.add(2)
            b = b.add(3)
            let u = a.union(b)
            return u.size
        }
        fn setIntersect() -> int {
            let a: set[int] = [:]
            a = a.add(1)
            a = a.add(2)
            let b: set[int] = [:]
            b = b.add(2)
            b = b.add(3)
            let c = a.intersect(b)
            return c.size
        }
        fn setDifference() -> int {
            let a: set[int] = [:]
            a = a.add(1)
            a = a.add(2)
            let b: set[int] = [:]
            b = b.add(2)
            let d = a.difference(b)
            return d.size
        }
        fn sumKeys(m: [string: int]) -> int {
            return m.size
        }
        fn callPassed() -> int {
            let m = [:]
            m = m.insert("p", 5)
            m = m.insert("q", 6)
            return sumKeys(m)
        }
        fn makeMap() -> [string: int] {
            let m = [:]
            m = m.insert("r", 7)
            return m
        }
        fn callReturned() -> int {
            let r = makeMap()
            return r.size
        }
        fn singleUseParam(m: [string: int]) -> int {
            return m.size
        }
        fn callSingleUse() -> int {
            let m = [:]
            m = m.insert("only", 1)
            return singleUseParam(m)
        }
        fn orderedMap() -> int {
            let m: [string: int]@ordered = [:]
            m = m.insert("z", 1)
            m = m.insert("a", 2)
            return m.size
        }
        fn blockScoped(flag: bool) -> int {
            let m = [:]
            if (flag) {
                m = m.insert("a", 1)
                m = m.insert("b", 2)
            }
            for (i of [1, 2, 3]) {
                m = m.insert("loop", i)
            }
            return m.size
        }
        fn iterEntries() -> int {
            let m = [:]
            m = m.insert("a", 10)
            m = m.insert("b", 20)
            let total = 0
            for (e of m.entries()) {
                total = total + e.value
            }
            return total
        }
        fn whileSize() -> int {
            let m = [:]
            m = m.insert("a", 1)
            let n = 0
            while (m.size > 0) {
                m = m.remove("a")
                n = n + 1
            }
            return n
        }
        fn collideAsMap() -> int {
            let data = [:]
            data = data.insert("k", 7)
            return data["k"]
        }
        fn collideAsArray() -> int {
            let data = [10, 20, 30]
            return data[1]
        }
    }
    <p>\${basicMap()}</p>
    <p>\${typedMapRemove()}</p>
    <p>\${mapHasGetOr()}</p>
    <p>\${nestedMap()}</p>
    <p>\${basicSet()}</p>
    <p>\${setHasRemove()}</p>
    <p>\${setElements()}</p>
    <p>\${setUnion()}</p>
    <p>\${setIntersect()}</p>
    <p>\${setDifference()}</p>
    <p>\${callPassed()}</p>
    <p>\${callReturned()}</p>
    <p>\${callSingleUse()}</p>
    <p>\${orderedMap()}</p>
    <p>\${blockScoped(true)}</p>
    <p>\${iterEntries()}</p>
    <p>\${whileSize()}</p>
    <p>\${collideAsMap()}</p>
    <p>\${collideAsArray()}</p>
</div>`;

function compileSample() {
  const filePath = join(TMP, "locals.scrml");
  writeFileSync(filePath, SRC);
  const outDir = join(TMP, "dist");
  const result = compileScrml({ inputFiles: [filePath], outputDir: outDir, write: true, log: () => {} });
  const errors = (result.errors || []).filter(e => e.severity == null || e.severity === "error");
  const clientJs = readFileSync(join(outDir, "locals.client.js"), "utf8");
  const runtimeFile = readdirSync(outDir).find(f => f.startsWith("scrml-runtime."));
  const runtimeJs = readFileSync(join(outDir, runtimeFile), "utf8");
  return { errors, clientJs, runtimeJs };
}

// Execute the whole client.js + runtime in a sandbox and return a caller that
// invokes a source `fn` by name (resolving its generated `_scrml_<name>_N`).
function makeRunner(out) {
  // Minimal DOM stub so the runtime's eager style-injection + DOMContentLoaded
  // wiring run without a real DOM (we only call the pure fns afterward).
  const stubEl = () => ({
    appendChild() {}, setAttribute() {}, addEventListener() {},
    style: {}, classList: { add() {}, remove() {} }, textContent: "",
    set innerHTML(_v) {}, get innerHTML() { return ""; },
  });
  const document = {
    addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; },
    getElementById() { return null; }, createElement() { return stubEl(); },
    createTextNode() { return stubEl(); }, head: stubEl(), body: stubEl(),
  };
  const ctx = { document, window: {}, console };
  vm.createContext(ctx);
  vm.runInContext(out.runtimeJs, ctx);
  const clientBody = out.clientJs.replace(/^\/\/ Requires.*$/m, "");
  vm.runInContext(clientBody, ctx);
  return function call(fnName, ...args) {
    const m = out.clientJs.match(new RegExp("function (_scrml_" + fnName + "_\\d+)\\("));
    if (!m) throw new Error("generated fn not found for " + fnName);
    ctx.__args = args;
    return vm.runInContext(m[1] + "(...__args)", ctx);
  };
}

describe("ss52 — non-reactive local map/set lowering — END-TO-END", () => {
  let out;
  beforeAll(() => { out = compileSample(); });

  test("compiles with NO codegen errors", () => {
    expect(out.errors).toEqual([]);
  });

  test("emitted client JS is syntactically valid (node --check equivalent)", () => {
    expect(() => new vm.Script(out.clientJs)).not.toThrow();
  });

  test("local map methods LOWER to bare-receiver _scrml_map_* (NOT raw, NOT reactive_get)", () => {
    // The (c) bug symptom: raw `m.insert(`/`m.size` would appear. Post-fix they
    // lower to `_scrml_map_insert(m, …)` / `_scrml_map_size(m)` with a BARE local.
    expect(out.clientJs).toMatch(/m = _scrml_map_insert\(m, "a", 1\)/);
    expect(out.clientJs).toMatch(/_scrml_map_size\(m\)/);
    expect(out.clientJs).toMatch(/_scrml_map_get\(m, "a"\)/);
    // No raw `.insert(` / `.size` property syntax on a bare local map.
    expect(out.clientJs).not.toMatch(/\bm\.insert\(/);
    expect(out.clientJs).not.toMatch(/\bm\.size\b/);
    // A non-reactive local must NEVER be wrapped in `_scrml_reactive_get`.
    expect(out.clientJs).not.toContain('_scrml_reactive_get("m")');
  });

  test("local set methods LOWER to bare-receiver helpers", () => {
    expect(out.clientJs).toMatch(/s = _scrml_map_insert\(s, "a", true\)/); // .add
    expect(out.clientJs).toMatch(/_scrml_map_keys\(s\)/);                   // .elements
    expect(out.clientJs).toContain("_scrml_stdlib.data.union(_scrml_map_keys(a), _scrml_map_keys(b))");
  });

  test("the 'map' AND 'stdlib-data' runtime chunks SURVIVE tree-shaking for non-reactive locals", () => {
    expect(out.runtimeJs).toContain("function _scrml_map_from_entries");
    expect(out.runtimeJs).toContain("function _scrml_map_insert");
    expect(out.runtimeJs).toContain("function _scrml_map_size");
    expect(out.runtimeJs).toContain("_scrml_stdlib.data"); // set-algebra chunk
  });

  test("R26 RUN — every pure fn EXECUTES with the CORRECT value (no TypeError)", () => {
    const call = makeRunner(out);
    expect(call("basicMap")).toBe(3);        // size 2 + bracket("a")=1
    expect(call("typedMapRemove")).toBe(1);  // insert x,y; remove x
    expect(call("mapHasGetOr")).toBe(104);   // getOr("only")=5 + getOr("nope",99)=99
    expect(call("nestedMap")).toBe(42);      // nested bracket-read
    expect(call("basicSet")).toBe(2);        // add a,b,a -> dedup
    expect(call("setHasRemove")).toBe(1);    // add 1,2; remove 1; has(2) -> size 1
    expect(call("setElements")).toBe(2);     // elements() length
    expect(call("setUnion")).toBe(3);        // {1,2} ∪ {2,3}
    expect(call("setIntersect")).toBe(1);    // {1,2} ∩ {2,3} = {2}
    expect(call("setDifference")).toBe(1);   // {1,2} ∖ {2} = {1}
    expect(call("callPassed")).toBe(2);      // map passed to a fn
    expect(call("callReturned")).toBe(1);    // map returned from a fn
    expect(call("callSingleUse")).toBe(1);   // single-use param
    expect(call("orderedMap")).toBe(2);      // ordered local map
    expect(call("blockScoped", true)).toBe(3); // if + for block-scoped locals
    expect(call("iterEntries")).toBe(30);    // for (e of m.entries()) iterable lowers
    expect(call("whileSize")).toBe(1);       // while (m.size > 0) condition lowers
    expect(call("collideAsMap")).toBe(7);    // `data` map -> bracket lowers
    expect(call("collideAsArray")).toBe(20); // `data` array (SAME NAME) -> bracket NOT cross-lowered
  });

  test("SCOPE-AWARENESS — a name that is a local map in one fn and an array in another does NOT cross-lower", () => {
    // The crux/risk: per-function collection. In `collideAsMap` `data["k"]` lowers
    // to `_scrml_map_get`; in `collideAsArray` the SAME name `data[1]` must stay a
    // raw JS bracket-read (a file-wide name-set would mis-lower it to a map-get
    // returning null — a silent wrong value).
    const asMapBody = out.clientJs.match(/function _scrml_collideAsMap_\d+\(\)\s*\{[\s\S]*?\n\}/)[0];
    const asArrBody = out.clientJs.match(/function _scrml_collideAsArray_\d+\(\)\s*\{[\s\S]*?\n\}/)[0];
    expect(asMapBody).toContain('_scrml_map_get(data, "k")'); // map fn lowers
    expect(asArrBody).toMatch(/return data\[1\]/);            // array fn raw bracket
    expect(asArrBody).not.toContain("_scrml_map_get");        // NOT cross-lowered
  });
});
