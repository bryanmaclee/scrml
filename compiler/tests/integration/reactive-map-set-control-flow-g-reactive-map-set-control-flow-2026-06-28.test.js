/**
 * g-reactive-map-set-control-flow-2026-06-28 — REACTIVE value-native map/set
 * method/property/index access INSIDE a control-flow construct, END-TO-END.
 *
 * Before this fix, a REACTIVE `@`-cell value-native map/set op
 * (`@m.insert(k,v)` / `@m.size` / `@m.has(k)` / `@m[k]` / `@s.add(x)` /
 * set `.union`/`.intersect`/`.difference`) that sat INSIDE an if/else body, an
 * if condition, a for body / iterable / C-style condition, a while body /
 * condition, or a do-while body emitted RAW `_scrml_reactive_get("m").insert(...)`
 * / `.size` — the HAMT runtime object has no `.insert` method / `.size` property,
 * so it threw `TypeError` at RUNTIME (it COMPILED clean + passed `node --check`).
 * Root: the expr/body ctxs built by `emit-control-flow.ts` never carried the
 * reactive `mapVarNames`/`setVarNames`/`orderedMapVarNames` sets — only ss52's
 * non-reactive `local*` siblings. This is the symmetric reactive twin of ss52
 * (`5ebdbce3`), threaded at the SAME control-flow ctx sites.
 *
 * At the TOP level of a function body the reactive lowering already fired
 * correctly (see value-native-map-e2e-d4.test.js) — the gap was ONLY inside
 * control-flow constructs. This suite asserts that a battery of REACTIVE map/set
 * ops inside EVERY control-flow shape:
 *   - compiles with NO codegen errors and is syntactically valid JS;
 *   - LOWERS to `_scrml_map_*(_scrml_reactive_get("…"), …)` (NOT raw
 *     `_scrml_reactive_get("…").insert(`/`.size`/`.has(`);
 *   - EXECUTES against the emitted runtime returning the CORRECT values
 *     (the load-bearing R26 RUN gate — the bug was a silent runtime-only crash);
 *   - across the full mandatory matrix + the S215 adversarial edges.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import vm from "vm";

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "reactive-mapset-cf-")); });
afterAll(() => { if (TMP) rmSync(TMP, { recursive: true, force: true }); });

// A markup file whose `${…}` logic block declares REACTIVE map/set/ordered-map
// cells + a battery of client fns, each exercising a reactive map/set op inside
// a DISTINCT control-flow construct. Each fn RESETS its cell at the top (a
// top-level op that already lowered pre-fix) so a direct call is deterministic,
// then performs the control-flow op (the fix target), then returns a value.
// Every fn call is interpolated so the body is emitted + reachable.
const SRC = `<div>
    \${
        <m>: [string: int] = [:]
        <s>: set[int] = [:]
        <om>: [string: int]@ordered = [:]

        function ifBodyInsert(flag: bool) -> int {
            @m = [:]
            if (flag) {
                @m = @m.insert("a", 1)
                @m = @m.insert("b", 2)
            }
            return @m.size
        }
        function elseBranchInsert(flag: bool) -> int {
            @m = [:]
            if (flag) { @m = @m.insert("x", 1) }
            else {
                @m = @m.insert("y", 1)
                @m = @m.insert("z", 1)
            }
            return @m.size
        }
        function ifCondSize() -> int {
            @m = [:]
            @m = @m.insert("a", 1)
            if (@m.size > 0) { return 100 }
            return 0
        }
        function ifCondHas() -> int {
            @m = [:]
            @m = @m.insert("present", 9)
            if (@m.has("present")) { return 1 }
            return 0
        }
        function ifCondIndexRead() -> int {
            @m = [:]
            @m = @m.insert("a", 5)
            if (@m["a"] > 0) { return @m["a"] }
            return 0
        }
        function forBodyInsert() -> int {
            @m = [:]
            for (k of ["a", "b", "c"]) {
                @m = @m.insert(k, 1)
            }
            return @m.size
        }
        function forBodyIndexRead() -> int {
            @m = [:]
            @m = @m.insert("a", 10)
            @m = @m.insert("b", 20)
            let total = 0
            for (k of ["a", "b"]) {
                total = total + @m[k]
            }
            return total
        }
        function cStyleForCond() -> int {
            @m = [:]
            @m = @m.insert("a", 1)
            @m = @m.insert("b", 1)
            @m = @m.insert("c", 1)
            let seen = 0
            for (let i = 0; i < @m.size; i = i + 1) {
                seen = seen + 1
            }
            return seen
        }
        function whileBodyInsert() -> int {
            @m = [:]
            @m = @m.insert("a", 3)
            @m = @m.insert("b", 3)
            let n = 0
            while (n < 2) {
                @m = @m.insert("k", n)
                n = n + 1
            }
            return @m.size
        }
        function whileCondSize() -> int {
            @m = [:]
            @m = @m.insert("a", 1)
            let n = 0
            while (@m.size > 0) {
                @m = @m.remove("a")
                n = n + 1
            }
            return n
        }
        function doWhileBody() -> int {
            @m = [:]
            @m = @m.insert("a", 1)
            @m = @m.insert("b", 1)
            let n = 0
            do {
                let ks = @m.keys()
                @m = @m.remove(ks[0])
                n = n + 1
            } while (@m.size > 0)
            return n
        }
        function nestedForIf() -> int {
            @m = [:]
            for (k of ["a", "b", "c"]) {
                if (k != "b") {
                    @m = @m.insert(k, 1)
                }
            }
            return @m.size
        }
        function mapOpIfInsideFor() -> int {
            @m = [:]
            for (k of ["a", "b", "c", "d"]) {
                if (k == "a") { @m = @m.insert(k, 1) }
                else {
                    if (k == "c") { @m = @m.insert(k, 1) }
                }
            }
            return @m.size
        }
        function setAddInIf(flag: bool) -> int {
            @s = [:]
            if (flag) {
                @s = @s.add(7)
                @s = @s.add(8)
            }
            return @s.size
        }
        function setUnionInIf(flag: bool) -> int {
            @s = [:]
            if (flag) {
                @s = @s.add(1)
                @s = @s.add(2)
                let other: set[int] = [:]
                other = other.add(2)
                other = other.add(3)
                @s = @s.union(other)
            }
            return @s.size
        }
        function setIntersectInWhile() -> int {
            @s = [:]
            @s = @s.add(1)
            @s = @s.add(2)
            @s = @s.add(3)
            let other: set[int] = [:]
            other = other.add(2)
            other = other.add(3)
            let n = 0
            while (n < 1) {
                @s = @s.intersect(other)
                n = n + 1
            }
            return @s.size
        }
        function setDifferenceInFor() -> int {
            @s = [:]
            @s = @s.add(1)
            @s = @s.add(2)
            @s = @s.add(3)
            for (x of [2]) {
                let other: set[int] = [:]
                other = other.add(x)
                @s = @s.difference(other)
            }
            return @s.size
        }
        function orderedInFor() -> int {
            @om = [:]
            for (k of ["z", "a", "m"]) {
                @om = @om.insert(k, 1)
            }
            return @om.size
        }
        function mapAndSetSameBody(flag: bool) -> int {
            @m = [:]
            @s = [:]
            if (flag) {
                @m = @m.insert("a", 1)
                @s = @s.add(9)
            }
            return @m.size + @s.size
        }
        function localAndReactiveInFor() -> int {
            @m = [:]
            let local = [:]
            for (k of ["a", "b"]) {
                @m = @m.insert(k, 1)
                local = local.insert(k, 1)
            }
            return @m.size + local.size
        }
    }
    <p>\${ifBodyInsert(true)}</p>
    <p>\${elseBranchInsert(false)}</p>
    <p>\${ifCondSize()}</p>
    <p>\${ifCondHas()}</p>
    <p>\${ifCondIndexRead()}</p>
    <p>\${forBodyInsert()}</p>
    <p>\${forBodyIndexRead()}</p>
    <p>\${cStyleForCond()}</p>
    <p>\${whileBodyInsert()}</p>
    <p>\${whileCondSize()}</p>
    <p>\${doWhileBody()}</p>
    <p>\${nestedForIf()}</p>
    <p>\${mapOpIfInsideFor()}</p>
    <p>\${setAddInIf(true)}</p>
    <p>\${setUnionInIf(true)}</p>
    <p>\${setIntersectInWhile()}</p>
    <p>\${setDifferenceInFor()}</p>
    <p>\${orderedInFor()}</p>
    <p>\${mapAndSetSameBody(true)}</p>
    <p>\${localAndReactiveInFor()}</p>
</div>`;

function compileSource(name, src) {
  const filePath = join(TMP, name + ".scrml");
  writeFileSync(filePath, src);
  const outDir = join(TMP, name + "-dist");
  const result = compileScrml({ inputFiles: [filePath], outputDir: outDir, write: true, log: () => {} });
  const errors = (result.errors || []).filter(e => e.severity == null || e.severity === "error");
  let clientJs = "";
  let runtimeJs = "";
  try { clientJs = readFileSync(join(outDir, name + ".client.js"), "utf8"); } catch {}
  try {
    const runtimeFile = readdirSync(outDir).find(f => f.startsWith("scrml-runtime."));
    if (runtimeFile) runtimeJs = readFileSync(join(outDir, runtimeFile), "utf8");
  } catch {}
  return { errors, clientJs, runtimeJs };
}

// Execute the full client.js + runtime in a sandbox and return a caller that
// invokes a source `fn` by name (resolving its generated `_scrml_<name>_N`).
// Mirrors nonreactive-local-map-set-ss52.test.js — the load-bearing R26 RUN gate.
function makeRunner(out) {
  const stubEl = () => ({
    appendChild() {}, replaceChildren() {}, removeChild() {}, insertBefore() {},
    setAttribute() {}, removeAttribute() {}, addEventListener() {}, remove() {},
    style: {}, classList: { add() {}, remove() {} }, dataset: {},
    textContent: "", firstChild: null, parentNode: null, childNodes: [],
    set innerHTML(_v) {}, get innerHTML() { return ""; },
  });
  const document = {
    addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; },
    getElementById() { return null; }, createElement() { return stubEl(); },
    createTextNode() { return stubEl(); }, createDocumentFragment() { return stubEl(); },
    head: stubEl(), body: stubEl(),
  };
  const ctx = { document, window: {}, console, requestAnimationFrame: () => 0, setTimeout: () => 0, clearTimeout: () => {} };
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

describe("g-reactive-map-set-control-flow — REACTIVE map/set in control flow — END-TO-END", () => {
  let out;
  beforeAll(() => { out = compileSource("reactive-cf", SRC); });

  test("compiles with NO codegen errors", () => {
    expect(out.errors).toEqual([]);
  });

  test("emitted client JS is syntactically valid (node --check equivalent)", () => {
    expect(() => new vm.Script(out.clientJs)).not.toThrow();
  });

  test("reactive map ops INSIDE control flow LOWER to _scrml_map_*(_scrml_reactive_get(…))", () => {
    // The fix: a reactive `@m` op inside an if/for/while body or condition lowers
    // to the free-function form with `_scrml_reactive_get("m")` as the receiver.
    expect(out.clientJs).toMatch(/_scrml_map_insert\(_scrml_reactive_get\("m"\), "a", 1\)/);
    expect(out.clientJs).toMatch(/_scrml_map_size\(_scrml_reactive_get\("m"\)\)/);
    expect(out.clientJs).toMatch(/_scrml_map_has\(_scrml_reactive_get\("m"\), "present"\)/);
    expect(out.clientJs).toMatch(/_scrml_map_get\(_scrml_reactive_get\("m"\), "a"\)/);
    expect(out.clientJs).toMatch(/_scrml_map_remove\(_scrml_reactive_get\("m"\), "a"\)/);
  });

  test("NO RAW reactive-receiver method/property leaks (the bug symptom)", () => {
    // Pre-fix these RAW forms appeared and threw at runtime (HAMT has no .insert /
    // .size / .has / .remove). Post-fix they must NOT appear for `m`/`s`.
    expect(out.clientJs).not.toMatch(/_scrml_reactive_get\("m"\)\.insert\(/);
    expect(out.clientJs).not.toMatch(/_scrml_reactive_get\("m"\)\.has\(/);
    expect(out.clientJs).not.toMatch(/_scrml_reactive_get\("m"\)\.remove\(/);
    expect(out.clientJs).not.toMatch(/_scrml_reactive_get\("m"\)\.size\b/);
    expect(out.clientJs).not.toMatch(/_scrml_reactive_get\("s"\)\.add\(/);
  });

  test("reactive set ops INSIDE control flow LOWER to the set-native helpers", () => {
    expect(out.clientJs).toMatch(/_scrml_map_insert\(_scrml_reactive_get\("s"\), 7, true\)/); // .add
    expect(out.clientJs).toContain("_scrml_stdlib.data.union(");
    expect(out.clientJs).toContain("_scrml_stdlib.data.intersection(");
    expect(out.clientJs).toContain("_scrml_stdlib.data.difference(");
  });

  test("the 'map' AND 'stdlib-data' runtime chunks SURVIVE tree-shaking", () => {
    expect(out.runtimeJs).toContain("function _scrml_map_insert");
    expect(out.runtimeJs).toContain("function _scrml_map_size");
    expect(out.runtimeJs).toContain("function _scrml_map_has");
    expect(out.runtimeJs).toContain("_scrml_stdlib.data");
  });

  // The load-bearing R26 RUN gate. Pre-fix EVERY one of these RUN-crashed with a
  // `TypeError` (or returned a silent-wrong NaN/false for the `.size`/`[k]` cases)
  // when the control-flow branch executed; post-fix each returns the right value.
  test("R26 RUN — every control-flow shape EXECUTES with the CORRECT value", () => {
    const call = makeRunner(out);
    // if body / else branch / if condition (.size / .has / index-read)
    expect(call("ifBodyInsert", true)).toBe(2);
    expect(call("ifBodyInsert", false)).toBe(0);   // branch skipped — still no crash
    expect(call("elseBranchInsert", false)).toBe(2); // else branch lowers
    expect(call("elseBranchInsert", true)).toBe(1);
    expect(call("ifCondSize")).toBe(100);          // `if (@m.size > 0)`
    expect(call("ifCondHas")).toBe(1);             // `if (@m.has("present"))`
    expect(call("ifCondIndexRead")).toBe(5);       // `if (@m["a"] > 0)` + body `@m["a"]`
    // for body / index-read in loop / C-style for condition
    expect(call("forBodyInsert")).toBe(3);
    expect(call("forBodyIndexRead")).toBe(30);     // `@m[k]` read inside the loop body
    expect(call("cStyleForCond")).toBe(3);         // `for (… ; i < @m.size ; …)`
    // while body / while condition / do-while body
    expect(call("whileBodyInsert")).toBe(3);
    expect(call("whileCondSize")).toBe(1);         // `while (@m.size > 0)`
    expect(call("doWhileBody")).toBe(2);           // do-while body + `while (@m.size > 0)`
    // nested control flow
    expect(call("nestedForIf")).toBe(2);           // if inside for
    expect(call("mapOpIfInsideFor")).toBe(2);      // map op in if/else nested inside for
    // reactive set: add / union / intersect / difference inside control flow
    expect(call("setAddInIf", true)).toBe(2);
    expect(call("setUnionInIf", true)).toBe(3);    // {1,2} ∪ {2,3}
    expect(call("setIntersectInWhile")).toBe(2);   // {1,2,3} ∩ {2,3}
    expect(call("setDifferenceInFor")).toBe(2);    // {1,2,3} ∖ {2}
    // ordered map inside control flow (the orderedMapVarNames path)
    expect(call("orderedInFor")).toBe(3);
  });

  // S215 adversarial — constructed edges beyond the happy path.
  test("S215 adversarial — reactive map AND set in one body; reactive + local map in one loop", () => {
    const call = makeRunner(out);
    // A reactive map AND a reactive set mutated in the SAME if body — both lower.
    expect(call("mapAndSetSameBody", true)).toBe(2);
    expect(call("mapAndSetSameBody", false)).toBe(0);
    // A for body that mutates a reactive `@m` AND a non-reactive local `local`
    // map — BOTH must lower (mine via reactive_get receiver, ss52's via bare).
    expect(call("localAndReactiveInFor")).toBe(4);
    // Verify the two distinct receiver forms coexist in the same loop body:
    expect(out.clientJs).toMatch(/_scrml_map_insert\(_scrml_reactive_get\("m"\), k, 1\)/); // reactive
    expect(out.clientJs).toMatch(/local = _scrml_map_insert\(local, k, 1\)/);              // local (ss52)
  });
});

describe("g-reactive-map-set-control-flow — for-ITERABLE position lowering", () => {
  // A reactive-map method in the for-ITERABLE position (`for (e of @m.entries())`)
  // lowers to `_scrml_map_entries(_scrml_reactive_get("m"))`. A reactive iterable
  // routes the loop through the §6.5 reactive-for/lift machinery (a pre-existing,
  // ORTHOGONAL behavior — the lift body is DOM reconciliation, not a logic
  // accumulation, and references the ambient `_scrml_lift_target`), so this is a
  // COMPILE/LOWERING assertion only — not a standalone-fn RUN. The fix is that the
  // iterable EXPRESSION lowers (pre-fix it emitted raw `.entries()` → runtime
  // TypeError when the reconciler ran).
  const ITER_SRC = `<div>
    \${
        <m>: [string: int] = [:]
        function iterEntries() -> int {
            @m = [:]
            @m = @m.insert("a", 10)
            let total = 0
            for (e of @m.entries()) {
                total = total + e.value
            }
            return total
        }
    }
    <p>\${iterEntries()}</p>
</div>`;
  let out;
  beforeAll(() => { out = compileSource("reactive-cf-iter", ITER_SRC); });

  test("compiles clean and the for-iterable `@m.entries()` lowers (no raw `.entries()`)", () => {
    expect(out.errors).toEqual([]);
    expect(out.clientJs).toContain('_scrml_map_entries(_scrml_reactive_get("m"))');
    expect(out.clientJs).not.toMatch(/_scrml_reactive_get\("m"\)\.entries\(/);
  });
});

describe("g-reactive-map-set-control-flow — index-WRITE inside a loop still rejects", () => {
  // The §59.7 E-MAP-BRACKET-WRITE gate is a TYPE-PASS diagnostic, orthogonal to
  // this codegen ctx-threading fix. A bracket-WRITE `@m[k] = v` inside a loop must
  // STILL fire E-MAP-BRACKET-WRITE (the fix must not accidentally suppress it).
  const WRITE_SRC = `<div>
    \${
        <m>: [string: int] = [:]
        function bracketWriteInLoop() -> int {
            @m = [:]
            for (k of ["a", "b"]) {
                @m[k] = 1
            }
            return @m.size
        }
    }
    <p>\${bracketWriteInLoop()}</p>
</div>`;
  let out;
  beforeAll(() => { out = compileSource("reactive-cf-write", WRITE_SRC); });

  test("a reactive map bracket-WRITE inside a for body fires E-MAP-BRACKET-WRITE", () => {
    expect(out.errors.some(e => e.code === "E-MAP-BRACKET-WRITE")).toBe(true);
  });
});
