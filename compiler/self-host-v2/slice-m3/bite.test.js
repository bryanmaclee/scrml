// bite.test.js — the bite matrix counts a construct as certified only by a KILL: a case still
// classified GRADED whose conformance run FAILED. A case the mutation reclassified (not-yet /
// front-end), made crash, or dropped from the report is NOT a bite (review round 2, item 4).

import { describe, test, expect } from "bun:test";
import { judgeDeaths } from "./bench/bite-lib.js";
import { judgeFrontRun, isFrontKill } from "./bench/bite-front.js";

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

// s442 — the FRONT-END section's judgement (bite-front.js): a kill is a failing behaviour test of a
// program that still compiled clean; a bootstrap that does not compile, a front end that rejects the
// program, or a run with no behaviour test is NOT a bite.
describe("judgeFrontRun / isFrontKill", () => {
  test("failing behaviour tests of a clean-compiling program are a kill", () => {
    const j = judgeFrontRun(" 5 pass\n 3 fail\nRan 8 tests");
    expect(j).toEqual({ ran: true, rejected: false, pass: 5, fail: 3, why: "" });
    expect(isFrontKill(j)).toBe(true);
  });
  test("every behaviour test passing is not a kill", () => {
    expect(isFrontKill(judgeFrontRun(" 8 pass\n 0 fail"))).toBe(false);
  });
  test("a mutated bootstrap that does not compile under impl#1 is not a bite, whatever fails", () => {
    const j = judgeFrontRun("error: bootstrap bundle failed to compile under impl#1:\nE-X\n 0 pass\n 8 fail");
    expect(j.ran).toBe(false);
    expect(isFrontKill(j)).toBe(false);
  });
  test("a front end that REJECTS the program (a diagnostic) is not a bite — it never ran", () => {
    const j = judgeFrontRun("Error: the bootstrap front end reported diagnostics for §66.19.6:\nE-SCOPE-001 …\n 0 pass\n 8 fail");
    expect(j.rejected).toBe(true);
    expect(isFrontKill(j)).toBe(false);
  });
  test("no behaviour test at all is a hollow run, not a bite", () => {
    const j = judgeFrontRun("Ran 0 tests");
    expect(j.ran).toBe(false);
    expect(isFrontKill(j)).toBe(false);
  });
});
