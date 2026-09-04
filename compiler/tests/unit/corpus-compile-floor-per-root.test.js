/**
 * corpus-compile-floor per-root anti-truncation floor —
 * g-compile-floor-goes-green-and-silent-when-a-whole-program-root-vanishes.
 *
 * Filed S393-bryan (MED). Fixed S400-peter.
 *
 * The gate's global `MIN_PROGRAMS` count (25, against a live 37) could be met
 * while an ENTIRE program root vanished — `benchmarks/` (which carries todomvc)
 * disappearing takes the count 37→34, still above 25, so the gate printed PASS
 * having stopped compiling that root, and its one signal (a `root missing:` note)
 * was suppressed because `main()` printed notes only under `!check` while CI runs
 * `--check`. The fix adds a PER-ROOT floor (each declared root must contribute
 * >=1 program, a hard TruncationError) and prints notes unconditionally.
 *
 * These guard the extracted `assertPerRootFloor` in both directions.
 */

import { describe, test, expect } from "bun:test";
import { assertPerRootFloor, TruncationError } from "../../../scripts/corpus-compile-floor.ts";

describe("assertPerRootFloor (g-compile-floor-goes-green-and-silent-when-a-whole-program-root-vanishes)", () => {
  test("passes when every declared root contributed >=1 program", () => {
    const perRoot = new Map([["examples", 34], ["benchmarks", 3]]);
    expect(() => assertPerRootFloor(perRoot, ["examples", "benchmarks"])).not.toThrow();
  });

  test("throws TruncationError when a root contributed ZERO (vanished/emptied)", () => {
    // benchmarks/ vanished: global count 34 would still clear MIN_PROGRAMS=25,
    // but the per-root floor must refuse the run.
    const perRoot = new Map([["examples", 34], ["benchmarks", 0]]);
    expect(() => assertPerRootFloor(perRoot, ["examples", "benchmarks"])).toThrow(TruncationError);
    expect(() => assertPerRootFloor(perRoot, ["examples", "benchmarks"])).toThrow(/benchmarks/);
  });

  test("throws when a root is entirely absent from the count map", () => {
    const perRoot = new Map([["examples", 34]]); // benchmarks never bumped
    expect(() => assertPerRootFloor(perRoot, ["examples", "benchmarks"])).toThrow(TruncationError);
  });

  test("the whole corpus vanishing throws on the FIRST empty root named", () => {
    const perRoot = new Map([["examples", 0], ["benchmarks", 0]]);
    expect(() => assertPerRootFloor(perRoot, ["examples", "benchmarks"])).toThrow(/examples/);
  });
});
