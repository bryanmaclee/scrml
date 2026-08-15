/**
 * lint-ghost-patterns-skip-cursor.test.js — S346 (flagship-hos-hermetic).
 *
 * Pins the forward-only skip cursor that replaced the per-character linear
 * rescan in `lint-ghost-patterns.js`'s range builders.
 *
 * WHY THIS EXISTS. The five range builders (`${…}` / `#{…}` / `~{…}` /
 * function bodies / tag openers) and `findMatchingClose` consulted
 * `skipPastRanges(i, skipMerged)` at EVERY source offset, and that function
 * rescanned the sorted range list from index 0 each time — O(chars × ranges)
 * per pass. On the 36-file trucking-dispatch app that was 343 ms of a fresh
 * compile; and once the function had been JIT-tiered in a process whose FIRST
 * compile carried an EMPTY range list (a fixture with no string literal and no
 * comment), the same calls ran ~17× slower for the rest of the process — 5.9 s
 * of a 9.7 s compile (`bun --cpu-prof`). Inside `bun test`, where 79 browser
 * files compile in one process in filesystem order, that is what pushed the
 * flagship browser test's whole-app compile past bun's 5 s per-test budget in
 * cloud and made `flagship driver/hos … engine mount really does sit inside an
 * if= template` join the failure name set intermittently.
 *
 * Three pins:
 *   §1 CONTRACT — `makeSkipCursor` is byte-identical to the oracle
 *      `skipPastRanges` for every non-decreasing query sequence (seeded random
 *      range sets + edge cases). The oracle stays exported as the definition.
 *   §2 COST CLASS — a synthetic 160k-char / ~6k-range source lints in well
 *      under a second (measured 32 ms here; the pre-fix builders took 6.5 s on
 *      the same input). A regression back to O(chars × ranges) trips this by
 *      an order of magnitude even on a loaded runner.
 *   §3 PROCESS-ORDER — linting a no-string source FIRST does not change the
 *      diagnostics of a many-string source linted afterwards in the same
 *      process (the output side of the class; the cost side is §2).
 */

import { describe, test, expect } from "bun:test";
import {
  lintGhostPatterns,
  makeSkipCursor,
  skipPastRanges,
} from "../../src/lint-ghost-patterns.js";

// Small deterministic PRNG (mulberry32) — the property test must not flake.
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Sorted, merged (non-overlapping, non-adjacent) `[start, end)` ranges — what mergeSkipRanges yields. */
function randomMergedRanges(rand, count, span) {
  const cuts = new Set();
  while (cuts.size < count * 2) cuts.add(Math.floor(rand() * span));
  const pts = [...cuts].sort((a, b) => a - b);
  const out = [];
  for (let k = 0; k + 1 < pts.length; k += 2) out.push([pts[k], pts[k + 1]]);
  return out;
}

describe("§1 makeSkipCursor == skipPastRanges for non-decreasing queries", () => {
  test("seeded random range sets × monotone query walks (from = first query)", () => {
    const rand = prng(0x5346);
    let checked = 0;
    for (let round = 0; round < 200; round++) {
      const span = 50 + Math.floor(rand() * 2000);
      const ranges = round % 7 === 0 ? [] : randomMergedRanges(rand, 1 + Math.floor(rand() * 40), span);
      let i = Math.floor(rand() * span);
      const skip = makeSkipCursor(ranges, i);
      for (let q = 0; q < 300 && i <= span + 5; q++) {
        expect(skip(i)).toBe(skipPastRanges(i, ranges));
        checked++;
        // Advance like the scanners do: +1, or leap to the oracle's answer, or a small jump.
        const r = rand();
        i = r < 0.6 ? i + 1 : r < 0.8 ? Math.max(i + 1, skipPastRanges(i, ranges)) : i + Math.floor(rand() * 20);
      }
    }
    expect(checked).toBeGreaterThan(10000);
  });

  test("edge cases: empty list, inside first/last, adjacent boundaries, from beyond/inside a range", () => {
    expect(makeSkipCursor([], 0)(0)).toBe(0);
    expect(makeSkipCursor([], 7)(9)).toBe(9);
    const R = [[2, 5], [5, 9], [20, 30]];
    // (adjacent [2,5],[5,9] would be merged by mergeSkipRanges; the cursor must still agree with the oracle)
    const walk = [0, 1, 2, 3, 4, 5, 8, 9, 10, 19, 20, 29, 30, 31, 100];
    const skip = makeSkipCursor(R, 0);
    for (const i of walk) expect(skip(i)).toBe(skipPastRanges(i, R));
    // `from` inside a range → the cursor starts AT that range (the oracle does
    // NOT chain through an adjacent range — [2,5] answers 5, not 9; merged input
    // never has adjacency, and the cursor must agree with the oracle either way).
    expect(makeSkipCursor(R, 3)(3)).toBe(skipPastRanges(3, R));
    expect(makeSkipCursor(R, 3)(3)).toBe(5);
    expect(makeSkipCursor(R, 25)(25)).toBe(30);
    // `from` beyond every range → identity.
    expect(makeSkipCursor(R, 40)(40)).toBe(40);
    // `from` between ranges → identity until the next range.
    const s2 = makeSkipCursor(R, 12);
    expect(s2(12)).toBe(12);
    expect(s2(19)).toBe(19);
    expect(s2(20)).toBe(30);
  });
});

function synth(n) {
  const parts = ["<program>\n"];
  for (let k = 0; k < n; k++) {
    parts.push(`<c${k}> = "s${k} {not a brace}"\n`);
    parts.push(`<p class="x${k}">\${ @c${k} + "y{" } // c ${k}\n</p>\n`);
  }
  parts.push("</program>\n");
  return parts.join("");
}

describe("§2 cost class — many-string source lints in linear time", () => {
  test("160k chars / ~6k skip ranges: well under a second (pre-fix: ~6.5 s)", () => {
    const src = synth(2000);
    expect(src.length).toBeGreaterThan(150_000);
    const t0 = performance.now();
    const diags = lintGhostPatterns(src, "synth.scrml");
    const ms = performance.now() - t0;
    expect(Array.isArray(diags)).toBe(true);
    // 32 ms measured locally; the bound is >30× that so a loaded runner never
    // trips it, while the O(chars × ranges) class (thousands of ms) always does.
    expect(ms).toBeLessThan(1500);
  });
});

describe("§3 process-order — a no-string compile first does not change later output", () => {
  test("lint(no-string) then lint(many-string) == lint(many-string) alone", () => {
    const noStrings = "<program>\n<p>hello</p>\n</program>\n";
    const many = synth(300);
    const alone = JSON.stringify(lintGhostPatterns(many, "many.scrml"));
    lintGhostPatterns(noStrings, "plain.scrml");
    lintGhostPatterns(noStrings, "plain.scrml");
    const after = JSON.stringify(lintGhostPatterns(many, "many.scrml"));
    expect(after).toBe(alone);
  });
});
