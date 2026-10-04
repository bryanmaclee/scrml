// effects-summary.test.js — s452-effect-summary (dpa-066 Approach B, RATIFIED
// S452 "all your recs" item 3; design: scrml-support/docs/deep-dives/
// bootstrap-effect-summary-dpa-066-2026-10-04.md).
//
// The bootstrap's ONE effect summary per callable (analyze.scrml `summarize`,
// closed over the call graph by effects.scrml) and the rules that read it:
//   - the engine: strongly connected components callees-first, the fixed
//     point through recursion, the path order that picks a message's chain;
//   - G7 (closed in M3): "yields a value" is transitive through `return <call>`
//     — a wrapper that returns a call yielding nothing is E-ERROR-012 at a
//     value-position arm, as the direct call is;
//   - the clock follows CALLS (a function value of a clock reader is not a read);
//   - the binder's decisions that read the summary (rulesPass) keep the
//     diagnostic ORDER the binder gives them.
// The migration's no-change proof (M0..M3) is the diagnostic differential
// (slice-m4/diag-diff.js over the SCRML_BOOT_DIAG_LOG hook), recorded in
// docs/changes/s452-effect-summary/progress.md.

import { describe, test, expect, beforeAll } from "bun:test";
import { loadM2, frontEnd } from "./harness.js";

let mods;
beforeAll(() => { ({ mods } = loadM2()); }, { timeout: 120000 });

const run = (src) => frontEnd(mods, [{ path: "t.scrml", src }]);
const codes = (src) => run(src).diags.map((d) => d.code);
const I = "$" + "{";

describe("effects.scrml — the engine", () => {
  const own = (key, root, pos) => mods.effects.ownAtom(key, root, pos);

  test("sccOrder: components callees first; a cycle is one component", () => {
    // 0 ⇄ 1, 2 → 1, 3 alone
    const order = mods.effects.sccOrder([[1], [0], [1], []]);
    const comps = order.map((c) => [...c].sort());
    expect(comps).toContainEqual([0, 1]);
    expect(comps).toContainEqual([2]);
    expect(comps).toContainEqual([3]);
    const at = (n) => comps.findIndex((c) => c.includes(n));
    expect(at(1)).toBeLessThan(at(2));                // the callee's component first
  });

  test("closeDim: a fact reaches every caller through mutual recursion, with the shortest chain", () => {
    // 0 writes "x"; 0 ⇄ 1; 2 → 1
    const edges = [[1], [0], [1]];
    const dim = mods.effects.closeDim([[own("x", 0, 0)], [], []], edges);
    expect(dim.map((xs) => xs.map((a) => a.key))).toEqual([["x"], ["x"], ["x"]]);
    const w = mods.effects.witnessOf(dim[2]);
    expect(mods.effects.atomChain(dim, 2, w)).toEqual([2, 1, 0]);
  });

  test("the path order: fewer references first, then the earlier reference", () => {
    // 0 → [1, 2]; 1 → 3 (writes "a" two steps down); 2 writes "b" itself; 4 → [2, 5], 5 writes "c"
    const edges = [[1, 2], [3], [], [], [2, 5], []];
    const ownAtoms = [[], [], [own("b", 2, 0)], [own("a", 3, 0)], [], [own("c", 5, 0)]];
    const dim = mods.effects.closeDim(ownAtoms, edges);
    expect(mods.effects.witnessOf(dim[0]).key).toBe("b");      // depth 1 beats depth 2
    expect(mods.effects.witnessOf(dim[4]).key).toBe("b");      // equal depth: the earlier reference
    expect(dim[0].map((a) => a.key)).toEqual(["b", "a"]);      // every fact is kept, in path order
  });

  // r2 LOW-2: the component order is derived from the edges being closed, so
  // no caller is processed before a callee — whatever the callables' numbering.
  // Callees numbered AFTER their callers (0 → 1 → 2 → 3, the fact at 3) and a
  // back-edge pattern (3 → 2 → 1 → 0, the fact at 0): every caller reaches it.
  test("no ordering inversion: callees numbered after or before their callers", () => {
    const fwd = mods.effects.closeDim([[], [], [], [own("x", 3, 0)]], [[1], [2], [3], []]);
    expect(fwd.map((xs) => xs.length)).toEqual([1, 1, 1, 1]);
    expect(mods.effects.atomChain(fwd, 0, fwd[0][0])).toEqual([0, 1, 2, 3]);
    const back = mods.effects.closeDim([[own("x", 0, 0)], [], [], []], [[], [0], [1], [2]]);
    expect(back.map((xs) => xs.length)).toEqual([1, 1, 1, 1]);
    expect(mods.effects.atomChain(back, 3, back[3][0])).toEqual([3, 2, 1, 0]);
  });

  test("own facts: the first site of a key is its atom; a recursive callable adds nothing", () => {
    const edges = [[0]];
    const dim = mods.effects.closeDim([[own("x", 0, 0), own("x", 0, 1), own("y", 0, 2)]], edges);
    expect(dim[0].map((a) => [a.key, a.pos, a.depth])).toEqual([["x", 0, 0], ["y", 2, 0]]);
  });
});

// G7 (dpa-066 Phase 2, measured at e7fb5fba5): "yields a value" was read from
// ONE callee body per call site, so `return nothing()` laundered a call that
// yields nothing — the probe compiled clean and the arm wrote a non-string
// into a `string` cell at run time. Closed in M3: the summary's `noValue`.
describe("dpa-066 G7 — a value-position arm calling a wrapper of a no-value call (§19.4.3 ruling 1a)", () => {
  const prog = (wrapDecl, armCall = "g()") => [
    "<program>",
    "    let <n:int=0/>",
    "    let <log:string=\"init\"/>",
    `    ${I}`,
    "        type LoadError:enum = { Missing }",
    "        function nothing() { @n = 1 }",
    `        ${wrapDecl}`,
    "        function load(k: string)! LoadError {",
    "            if (k == \"x\") fail LoadError.Missing",
    "            return k",
    "        }",
    "        function go() {",
    `            const r = load("x") !{ _ :> ${armCall} }`,
    "            @log = r",
    "        }",
    "    }",
    "    <button onclick=go()>go</button>",
    "</program>",
  ].join("\n");

  test("the direct call is E-ERROR-012 (unchanged)", () => {
    expect(codes(prog("function g() { return \"x\" }", "nothing()"))).toEqual(["E-ERROR-012"]);
  });

  test("`function g() { return nothing() }` — E-ERROR-012, the arm's message as for the direct call", () => {
    const r = run(prog("function g() { return nothing() }"));
    expect(r.diags.map((d) => d.code)).toEqual(["E-ERROR-012"]);
    expect(r.diags[0].message).toContain("Arm '_' of the");
    expect(r.diags[0].message).toContain("on 'load(…)' produces no value");
    expect(r.core == null).toBe(true);
  });

  test("`function g() -> string { return nothing() }` — a declared type does not launder it either", () => {
    expect(codes(prog("function g() -> string { return nothing() }"))).toEqual(["E-ERROR-012"]);
  });

  test("two wrappers deep, and through recursion", () => {
    expect(codes(prog("function h() { return nothing() }\n        function g() { return h() }"))).toEqual(["E-ERROR-012"]);
    expect(codes(prog("function g() {\n            if (@n == 1) { return g() }\n            return nothing()\n        }"))).toEqual(["E-ERROR-012"]);
  });

  // r2 LOW-1: the s452 r3 rule — an earlier unconditional return decides; a
  // `return <call>` in the dead code after it is not a return path.
  test("a `return nothing()` after an unconditional return is dead code — clean", () => {
    expect(codes(prog("function g() {\n            return \"x\"\n            return nothing()\n        }"))).toEqual([]);
    expect(codes(prog("function g() {\n            if (@n == 1) { return \"a\" } else { return \"b\" }\n            return nothing()\n        }"))).toEqual([]);
    // twin: reachable, it still counts
    expect(codes(prog("function g() {\n            if (@n == 1) { return \"a\" }\n            return nothing()\n        }"))).toEqual(["E-ERROR-012"]);
  });

  test("negative twins: a wrapper that returns a value is clean", () => {
    expect(codes(prog("function v() -> string { return \"v\" }\n        function g() { return v() }"))).toEqual([]);
    expect(codes(prog("function g() { return \"x\" }"))).toEqual([]);
  });
});

describe("dpa-066 — the clock follows calls (§48.6 / the bootstrap's host-call surface)", () => {
  const prog = (decls, main) => [
    "<program>",
    "    let <query:string=\"\"/>",
    "    function ping() -> number {",
    "        return Date" + ".now()",
    "    }",
    decls,
    "    <main>",
    main,
    "    </main>",
    "</program>",
  ].join("\n");
  const clockRefusals = (src) => run(src).diags.filter((d) => d.code === "E-BOOTSTRAP-UNSUPPORTED" && d.message.includes("reads the clock"));

  test("a call of a function that reads the clock through a call, in markup, is refused", () => {
    const ds = clockRefusals(prog("    function direct() -> number { return ping() }", `        <p>${I}direct()}</p>`));
    expect(ds.length).toBe(1);
    expect(ds[0].message).toContain("`direct()` reads the clock");
  });

  test("a function that only HANDS a clock reader on as a value does not read the clock", () => {
    const ds = clockRefusals(prog("    function viaValue() -> number {\n        const g = ping\n        return 1\n    }", `        <p>${I}viaValue()}</p>`));
    expect(ds).toEqual([]);
  });
});

describe("dpa-066 M3 — the binder's summary decisions keep their place in the diagnostic order", () => {
  test("E-ERROR-013 decided after binding still stands between the binder's diagnostics around it", () => {
    const src = [
      "<program>",
      `    ${I}`,
      "        function a() { const x = nope1 }",
      "        function b() { const z = 1 }",
      "        function c() { b() !{ _ :> 1 } }",
      "        function d() { const y = nope2 }",
      "    }",
      "</program>",
    ].join("\n");
    const ds = run(src).diags;
    const i13 = ds.findIndex((d) => d.code === "E-ERROR-013");
    expect(i13).toBeGreaterThan(-1);
    const starts = ds.map((d) => d.span.start);
    // the binder walks the functions in source order: the decided diagnostic is where it was raised
    const before = ds.slice(0, i13).filter((d) => d.code === "E-SCOPE-001");
    const after = ds.slice(i13 + 1).filter((d) => d.code === "E-SCOPE-001");
    expect(before.length).toBe(1);
    expect(after.length).toBe(1);
    expect(before[0].span.start).toBeLessThan(ds[i13].span.start);
    expect(after[0].span.start).toBeGreaterThan(ds[i13].span.start);
    expect(starts.length).toBe(ds.length);
  });
});
