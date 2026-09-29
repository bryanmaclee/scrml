// bite.test.js — the bite matrix counts a construct as certified only by a KILL: a case still
// classified GRADED whose conformance run FAILED. A case the mutation reclassified (not-yet /
// front-end), made crash, or dropped from the report is NOT a bite (review round 2, item 4).

import { describe, test, expect } from "bun:test";
import { judgeCssDeaths, judgeDeaths } from "./bench/bite-lib.js";

describe("judgeCssDeaths (s440)", () => {
  test("only a still-graded css result whose oracle failed is a kill", () => {
    const report = { css: { results: [
      { relDir: "k", cls: "graded", pass: false },
      { relDir: "s", cls: "graded", pass: true },
      { relDir: "n", cls: "not-yet", pass: null },
      { relDir: "u", cls: "graded", pass: null },
    ] } };
    const { killed, lost } = judgeCssDeaths(["k", "s", "n", "u", "gone"], report);
    expect(killed).toEqual(["k"]);
    expect(lost.map((x) => x.relDir)).toEqual(["n", "u", "gone"]);
  });
});

const PASSES = ["a/killed", "a/survived", "a/crashed", "a/not-yet", "a/front-end", "a/missing"];

const report = {
  cases: [
    { relDir: "a/killed", cls: "graded" },
    { relDir: "a/survived", cls: "graded" },
    { relDir: "a/crashed", cls: "crashed" },
    { relDir: "a/not-yet", cls: "not-yet" },
    { relDir: "a/front-end", cls: "front-end" },
  ],
  // The grader lists a crashed case among the failures too — it must still not count as a kill.
  conformance: { failures: [{ relDir: "a/killed" }, { relDir: "a/crashed" }] },
};

describe("judgeDeaths", () => {
  test("only a still-graded case whose run failed is a kill", () => {
    const { killed, lost } = judgeDeaths(PASSES, report);
    expect(killed).toEqual(["a/killed"]);
    expect(lost).toEqual([
      { relDir: "a/crashed", why: "reclassified crashed" },
      { relDir: "a/not-yet", why: "reclassified not-yet" },
      { relDir: "a/front-end", why: "reclassified front-end" },
      { relDir: "a/missing", why: "absent from the report" },
    ]);
  });

  test("a footprint() that throws for every case kills nothing (the round-2 probe: was 'died 17 of 17')", () => {
    const all = PASSES.map((p) => ({ relDir: p, cls: "crashed" }));
    const r = judgeDeaths(PASSES, { cases: all, conformance: { failures: all.map((c) => ({ relDir: c.relDir })) } });
    expect(r.killed).toEqual([]);
    expect(r.lost.length).toBe(PASSES.length);
  });
});
