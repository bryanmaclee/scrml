/**
 * colorless-async-combinators.test.js — Phase-2 colorless-async, the async-callback
 * collection-method combinator transform (DD colorless-async-boundaries-2026-07-16,
 * §2 position 1, FORK 1 — ratified S259 "build the async collection").
 *
 * A CLEAN-FAMILY collection method (some/every/find/findIndex/filter/map/forEach/
 * reduce/flatMap) called with an ASYNC callback (its body transitively reaches a
 * Promise-returning primitive) lowers to `await _scrml_<method>Async(coll, asyncCb)`
 * — a SEQUENTIAL for-await combinator that preserves iteration ORDER + EARLY-EXIT
 * (NOT Promise.all). `.sort` with an async comparator stays fail-closed (FORK 2). A
 * SYNC callback stays the native `.method` un-awaited.
 *
 * Coverage:
 *   (1) per-method lowering (compile + emitted-shape assert),
 *   (2) reduce both JS forms (with-init + no-init),
 *   (3) `.sort` async comparator → E-ASYNC-STDLIB-IN-SYNC-CALLBACK,
 *   (4) sync callback stays native + fn NOT colored async,
 *   (5) on-use injection (only the used combinator ships),
 *   (6) EXECUTED sequential-order + early-exit proof (runs the injected combinator),
 *   (7) EXECUTED end-to-end (compile → import → run the emitted module).
 *
 * SPEC / authority: §13.1 stdlib carve-out, §13.2 auto-await, §34
 * E-ASYNC-STDLIB-IN-SYNC-CALLBACK; DD colorless-async-boundaries §2/§3/§7.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { asyncCombinatorHelperBlock } from "../../src/codegen/async-combinators.ts";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/colorless-async-combinators");

beforeAll(() => mkdirSync(FIXTURE_DIR, { recursive: true }));
afterAll(() => { try { rmSync(FIXTURE_DIR, { recursive: true, force: true }); } catch {} });

/** Write + compile one fixture in library mode; return { js, codes }. */
function compileLib(name, src) {
  const path = join(FIXTURE_DIR, name + ".scrml");
  writeFileSync(path, src);
  const result = compileScrml({ inputFiles: [path], mode: "library", write: false, log: () => {} });
  let js = "";
  for (const [fp, out] of result.outputs) {
    if (fp.endsWith(`${name}.scrml`)) { js = out.libraryJs ?? ""; break; }
  }
  const codes = (result.errors || [])
    .filter((e) => e.severity !== "warning" && e.severity !== "info")
    .map((e) => e.code);
  return { js, codes };
}

const CODE = "E-ASYNC-STDLIB-IN-SYNC-CALLBACK";

// ---------------------------------------------------------------------------
// (1) per-method lowering — each clean-family method with an async callback
// ---------------------------------------------------------------------------
describe("clean-family async callback → `await _scrml_<method>Async(...)`", () => {
  const cases = [
    ["some", "verifyPassword", "hs.some(h => verifyPassword(pw, h))", "hs"],
    ["every", "verifyPassword", "hs.every(h => verifyPassword(pw, h))", "hs"],
    ["find", "verifyPassword", "hs.find(h => verifyPassword(pw, h))", "hs"],
    ["findIndex", "verifyPassword", "hs.findIndex(h => verifyPassword(pw, h))", "hs"],
    ["filter", "verifyPassword", "hs.filter(h => verifyPassword(pw, h))", "hs"],
    ["map", "hashPassword", "hs.map(h => hashPassword(h))", "hs"],
    ["forEach", "hashPassword", "hs.forEach(h => hashPassword(h))", "hs"],
    ["flatMap", "verifyPassword", "hs.flatMap(h => verifyPassword(pw, h))", "hs"],
  ];
  for (const [method, fn, expr, coll] of cases) {
    test(`.${method} lowers to _scrml_${method}Async + colors the fn async`, () => {
      const { js, codes } = compileLib(`m-${method.toLowerCase()}`, `\${
  import { verifyPassword, hashPassword } from "scrml:auth"
  export function f(pw, hs) { return ${expr} }
}
`);
      expect(codes).not.toContain(CODE);
      expect(js).toMatch(/export async function f\s*\(/);
      expect(js).toContain(`await _scrml_${method}Async(${coll}, async (h) => await ${fn}(`);
      // the on-use combinator helper is injected
      expect(js).toContain(`async function _scrml_${method}Async(coll, cb)`);
    });
  }
});

// ---------------------------------------------------------------------------
// (2) reduce — BOTH the with-initial and without-initial JS forms
// ---------------------------------------------------------------------------
describe("reduce honors both JS forms", () => {
  test("with-init forwards the seed as a trailing arg", () => {
    const { js, codes } = compileLib("m-reduce-init", `\${
  import { hashPassword } from "scrml:auth"
  export function chain(items, seed) { return items.reduce((acc, x) => hashPassword(x), seed) }
}
`);
    expect(codes).not.toContain(CODE);
    expect(js).toMatch(/await _scrml_reduceAsync\(items,\s*async\s*\(acc, x\)\s*=>\s*await\s+hashPassword\(x\),\s*seed\)/);
    // the reduce helper honors both forms via a rest param
    expect(js).toContain("async function _scrml_reduceAsync(coll, cb, ...init)");
  });
  test("no-init omits the trailing arg", () => {
    const { js, codes } = compileLib("m-reduce-noinit", `\${
  import { hashPassword } from "scrml:auth"
  export function chain(items) { return items.reduce((acc, x) => hashPassword(x)) }
}
`);
    expect(codes).not.toContain(CODE);
    expect(js).toMatch(/await _scrml_reduceAsync\(items,\s*async\s*\(acc, x\)\s*=>\s*await\s+hashPassword\(x\)\)/);
  });
});

// ---------------------------------------------------------------------------
// (3) `.sort` async comparator — FORK 2 fail-closed
// ---------------------------------------------------------------------------
describe(".sort async comparator stays fail-closed (FORK 2)", () => {
  test("fires E-ASYNC-STDLIB-IN-SYNC-CALLBACK, no combinator emitted", () => {
    const { js, codes } = compileLib("m-sort", `\${
  import { verifyPassword } from "scrml:auth"
  export function ranked(pw, hs) { return hs.sort((a, b) => verifyPassword(pw, a) ? -1 : 1) }
}
`);
    expect(codes).toContain(CODE);
    expect(js).not.toContain("_scrml_sortAsync");
  });
});

// ---------------------------------------------------------------------------
// (4) SYNC callback — unchanged common case (native .method, fn NOT async)
// ---------------------------------------------------------------------------
describe("sync callback stays native (the 689-site common case is byte-stable)", () => {
  test(".filter sync predicate stays `.filter`, fn NOT colored async, no combinator", () => {
    const { js, codes } = compileLib("m-sync", `\${
  export function activeOnes(hs) { return hs.filter(h => h.active) }
}
`);
    expect(codes).not.toContain(CODE);
    expect(js).toContain("hs.filter(h => h.active)");
    expect(js).not.toMatch(/async function activeOnes/);
    expect(js).not.toContain("_scrml_filterAsync");
  });
});

// ---------------------------------------------------------------------------
// (5) on-use injection — only the combinators actually called ship
// ---------------------------------------------------------------------------
describe("on-use injection — minimal runtime surface", () => {
  test("a .map-only module ships _scrml_mapAsync and NONE of the others", () => {
    const { js } = compileLib("m-onlymap", `\${
  import { hashPassword } from "scrml:auth"
  export function hashAll(hs) { return hs.map(h => hashPassword(h)) }
}
`);
    expect(js).toContain("async function _scrml_mapAsync(coll, cb)");
    for (const other of ["some", "every", "find", "findIndex", "filter", "forEach", "reduce", "flatMap"]) {
      expect(js).not.toContain(`async function _scrml_${other}Async`);
    }
  });
});

// ---------------------------------------------------------------------------
// (6) EXECUTED — runtime SEQUENTIAL-ORDER + EARLY-EXIT proof. Runs the ACTUAL
// injected combinator source (asyncCombinatorHelperBlock), not a grep of text.
// ---------------------------------------------------------------------------
describe("EXECUTED — the shipped combinator runs sequentially (order + early-exit), not Promise.all", () => {
  // Materialize the exact combinator source that gets injected into a bundle.
  const block = asyncCombinatorHelperBlock(
    "_scrml_forEachAsync( _scrml_mapAsync( _scrml_someAsync( _scrml_everyAsync( _scrml_findAsync( _scrml_reduceAsync(",
  );
  const combinators = new Function(
    block +
      "\nreturn { _scrml_forEachAsync, _scrml_mapAsync, _scrml_someAsync, _scrml_everyAsync, _scrml_findAsync, _scrml_reduceAsync };",
  )();
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));
  // DECREASING delays: sequential preserves INPUT order [0,1,2]; Promise.all would
  // record in completion order [2,1,0].
  const items = () => [{ id: 0, ms: 24 }, { id: 1, ms: 12 }, { id: 2, ms: 0 }];

  test("forEach records side effects in INPUT order (sequential, not Promise.all)", async () => {
    const sink = [];
    await combinators._scrml_forEachAsync(items(), async (x) => { await delay(x.ms); sink.push(x.id); });
    expect(sink).toEqual([0, 1, 2]); // NOT [2,1,0]
  });

  test("map result preserves order AND side effects run sequentially", async () => {
    const sink = [];
    const out = await combinators._scrml_mapAsync(items(), async (x) => { await delay(x.ms); sink.push(x.id); return x.id * 10; });
    expect(out).toEqual([0, 10, 20]);
    expect(sink).toEqual([0, 1, 2]);
  });

  test("some early-exits at the first truthy — later elements are NOT visited", async () => {
    const visited = [];
    const found = await combinators._scrml_someAsync(items(), async (x) => { visited.push(x.id); await delay(x.ms); return x.id === 1; });
    expect(found).toBe(true);
    expect(visited).toEqual([0, 1]); // id 2 never visited (short-circuit)
  });

  test("every early-exits at the first falsy", async () => {
    const visited = [];
    const all = await combinators._scrml_everyAsync(items(), async (x) => { visited.push(x.id); return x.id !== 1; });
    expect(all).toBe(false);
    expect(visited).toEqual([0, 1]);
  });

  test("find returns the element (not the index); findIndex-style short-circuit", async () => {
    const found = await combinators._scrml_findAsync(items(), async (x) => x.id === 2);
    expect(found).toEqual({ id: 2, ms: 0 });
  });

  test("reduce no-init seeds from the first element (starts at index 1)", async () => {
    const sum = await combinators._scrml_reduceAsync([1, 2, 3, 4], async (a, x) => a + x);
    expect(sum).toBe(10);
  });

  test("reduce with-init starts the accumulator at the provided seed (index 0)", async () => {
    const sum = await combinators._scrml_reduceAsync([1, 2, 3], async (a, x) => a + x, 100);
    expect(sum).toBe(106);
  });

  test("reduce of an empty array with no initial value throws (native parity)", async () => {
    let threw = false;
    try { await combinators._scrml_reduceAsync([], async (a, x) => a + x); } catch { threw = true; }
    expect(threw).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// (7) EXECUTED end-to-end — compile a real module, import it, run it. Proves the
// full pipeline (lowering + on-use injection + async coloring) executes.
// ---------------------------------------------------------------------------
describe("EXECUTED end-to-end — compiled module imports + runs", () => {
  test("a compiled `.map`/`.find` async-callback module produces correct values at runtime", async () => {
    const dir = join(FIXTURE_DIR, "e2e");
    mkdirSync(dir, { recursive: true });
    const srcPath = join(dir, "double.scrml");
    writeFileSync(srcPath, `\${
  import { safeCallAsync } from "scrml:host"
  export function doubleAll(nums) { return nums.map(n => safeCallAsync(() => n * 2)) }
  export function firstBig(nums) { return nums.find(n => safeCallAsync(() => n > 2)) }
}
`);
    const outDir = join(dir, "out");
    compileScrml({ inputFiles: [srcPath], outputDir: outDir, write: true, log: () => {} });
    const mod = await import(join(outDir, "double.js"));
    expect(await mod.doubleAll([1, 2, 3, 4])).toEqual([2, 4, 6, 8]);
    expect(await mod.firstBig([1, 2, 3, 4])).toBe(3);
  });
});
