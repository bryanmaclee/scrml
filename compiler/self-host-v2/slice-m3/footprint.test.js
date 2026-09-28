// footprint.test.js — the FOOTPRINT grader (scripts/hybrid.ts --footprint; dpa-051 §8.2):
//   - the classifier on synthetic inputs (graded / not-yet / front-end / crashed);
//   - the real path end to end over a SYNTHETIC cases dir: an in-footprint case is GRADED and
//     passes through the unchanged conformance runner (codes half + runtime half, executed on the
//     bootstrap's runtime), an out-of-footprint case comes out NOT-YET (never red), a program the
//     front end rejects comes out FRONT-END, a graded case whose runtime contract is wrong goes RED,
//     a case requiring a CG-emitted code is NOT-YET, a crash in footprint() is a loud FAIL, and a
//     case directory the grading loop cannot load shows as an "N of M" mismatch.

import { describe, test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { classifyFootprint, runFootprintGrade, footprintTable, footprintCounts } from "../../../scripts/hybrid.ts";
import * as substitute from "./substitute.js";

const IN = { impl1Errors: [], cgCodes: [], notYet: [], crash: null };

describe("classifyFootprint", () => {
  test("no not-yet reason, an accepted program → graded", () => {
    expect(classifyFootprint(IN)).toBe("graded");
  });
  test("any not-yet reason → not-yet", () => {
    expect(classifyFootprint({ ...IN, notYet: ["stmt: for-stmt"] })).toBe("not-yet");
  });
  test("a required code the front end does not emit (a CG code) → not-yet", () => {
    expect(classifyFootprint({ ...IN, cgCodes: ["W-DERIVED-001"] })).toBe("not-yet");
  });
  test("front-end rejection (an error-severity front-end diagnostic) → front-end, whatever the footprint", () => {
    expect(classifyFootprint({ ...IN, impl1Errors: ["E-SCOPE-001"], notYet: ["x"] })).toBe("front-end");
  });
  test("a crash in footprint() → crashed, before anything else", () => {
    expect(classifyFootprint({ ...IN, impl1Errors: ["E-X"], crash: "boom" })).toBe("crashed");
  });
});

function writeCase(root, rel, source, expected) {
  const dir = join(root, rel);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "case.scrml"), source);
  if (expected) writeFileSync(join(dir, "expected.json"), JSON.stringify({ id: rel.replace("/", "-"), "language-version": "1.0", spec: "§6.1", rationale: "synthetic", expect: expected }));
}

const COUNTER = `\${
    <count> = 0
    function inc() {
        @count = @count + 1
    }
}
<button id="inc" onclick=inc()>+</>
<p id="out">\${@count}</>
`;

describe("runFootprintGrade over a synthetic cases dir", () => {
  test("every bucket, a wrong runtime contract is RED, a crash is a loud FAIL, truncation is visible", async () => {
    const root = mkdtempSync(join(tmpdir(), "scrml-m3-fp-cases-"));
    try {
      writeCase(root, "syn/in-footprint", COUNTER, {
        codes: [], notCodes: [], input: [{ click: "#inc" }, { click: "#inc" }],
        state: { count: 2 }, domAnchored: [{ selector: "#out", text: "2" }],
      });
      // Same program, a contract the program does not meet: must fail (proves the runtime half runs).
      writeCase(root, "syn/in-footprint-wrong", COUNTER, {
        codes: [], notCodes: [], input: [{ click: "#inc" }], state: { count: 5 },
      });
      writeCase(root, "syn/out-of-footprint", `\${
    <n> = 0
    function f() {
        for (const i of [1, 2]) { @n = @n + i }
    }
}
<button id="go" onclick=f()>go</>
`, { codes: [], notCodes: [], input: [{ click: "#go" }], state: { n: 3 } });
      writeCase(root, "syn/rejected", `<p>\${@nope}</p>\n`, { codes: ["E-SCOPE-001"], notCodes: [] });
      // W-DERIVED-001 is emitted by impl#1's CG, not its front end: the substitute's queue.
      writeCase(root, "syn/cg-code", `\${ const <x> = 5 + 3 }\n<p>\${@x}</p>\n`, { codes: ["W-DERIVED-001"], notCodes: [] });
      // A case directory the loader skips (no expected.json): the independent enumeration still counts it.
      writeCase(root, "syn/no-contract", COUNTER, null);

      const rep = await runFootprintGrade({ CG: substitute }, substitute.footprint, null, { casesDir: root, gaps: new Map() });
      const cls = Object.fromEntries(rep.cases.map((c) => [c.relDir, c.cls]));
      expect(cls).toEqual({
        "syn/cg-code": "not-yet",
        "syn/in-footprint": "graded",
        "syn/in-footprint-wrong": "graded",
        "syn/out-of-footprint": "not-yet",
        "syn/rejected": "front-end",
      });
      expect(rep.cases.find((c) => c.relDir === "syn/out-of-footprint").notYet).toContain("stmt: for-stmt");
      expect(rep.cases.find((c) => c.relDir === "syn/cg-code").notYet)
        .toContain("expects code W-DERIVED-001, not emitted by impl#1's front end (CG/post-CG)");
      expect(rep.enumerated).toBe(6);
      expect(rep.cases.length).toBe(5);
      expect(rep.conformance.total).toBe(2);
      expect(rep.conformance.passed).toBe(1);
      expect(rep.conformance.failures.map((f) => f.relDir)).toEqual(["syn/in-footprint-wrong"]);
      expect(rep.conformance.failures[0].reasons.join(" ")).toContain("state: cell 'count' expected 5, got 1");
      const k = footprintCounts(rep);
      expect(k.runtimePass).toEqual(["syn/in-footprint"]);
      expect(k.runtimeFail).toEqual(["syn/in-footprint-wrong"]);
      const table = footprintTable(rep, "CG=substitute");
      expect(table).toContain("**5 of 6**");
      expect(table).toContain("MISMATCH");
      expect(table).toContain("**Headline: 1 RUNTIME passes of 2 graded runtime-half cases** (1 fail).");

      // A footprint() that throws: the case is a loud FAIL, never graded on an empty footprint.
      const boom = () => { throw new Error("boom in footprint"); };
      const rep2 = await runFootprintGrade({ CG: substitute }, boom, "syn/in-footprint", { casesDir: root, gaps: new Map() });
      expect(rep2.cases.map((c) => c.cls)).toEqual(["crashed", "crashed"]);
      expect(rep2.conformance.failures.map((f) => f.reasons[0])).toEqual([
        "CRASH in the substitute's footprint(): boom in footprint",
        "CRASH in the substitute's footprint(): boom in footprint",
      ]);
      expect(footprintCounts(rep2).runtimePass).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 60000);
});
