// footprint.test.js — the FOOTPRINT grader (scripts/hybrid.ts --footprint; dpa-051 §8.2):
//   - the classifier on synthetic inputs (graded / not-yet / front-end);
//   - the real path end to end over a SYNTHETIC cases dir: an in-footprint case is GRADED and
//     passes through the unchanged conformance runner (codes half + runtime half, executed on the
//     bootstrap's runtime), an out-of-footprint case comes out NOT-YET (never red), a rejected
//     program comes out FRONT-END, and a graded case whose runtime contract is wrong goes RED.

import { describe, test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { classifyFootprint, runFootprintGrade, footprintTable } from "../../../scripts/hybrid.ts";
import * as substitute from "./substitute.js";

describe("classifyFootprint", () => {
  test("no not-yet reason, an accepted program → graded", () => {
    expect(classifyFootprint({ expectsError: false, impl1Errors: [], notYet: [] })).toBe("graded");
  });
  test("any not-yet reason → not-yet", () => {
    expect(classifyFootprint({ expectsError: false, impl1Errors: [], notYet: ["stmt: for-stmt"] })).toBe("not-yet");
  });
  test("a rejected program → front-end, whatever its footprint", () => {
    expect(classifyFootprint({ expectsError: true, impl1Errors: [], notYet: [] })).toBe("front-end");
    expect(classifyFootprint({ expectsError: false, impl1Errors: ["E-SCOPE-001"], notYet: ["x"] })).toBe("front-end");
  });
});

function writeCase(root, rel, source, expected) {
  const dir = join(root, rel);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "case.scrml"), source);
  writeFileSync(join(dir, "expected.json"), JSON.stringify({ id: rel.replace("/", "-"), "language-version": "1.0", spec: "§6.1", rationale: "synthetic", expect: expected }));
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
  test("graded / not-yet / front-end, and a wrong runtime contract is RED", async () => {
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

      const rep = await runFootprintGrade({ CG: substitute }, substitute.footprint, null, { casesDir: root, gaps: new Map() });
      const cls = Object.fromEntries(rep.cases.map((c) => [c.relDir, c.cls]));
      expect(cls).toEqual({
        "syn/in-footprint": "graded",
        "syn/in-footprint-wrong": "graded",
        "syn/out-of-footprint": "not-yet",
        "syn/rejected": "front-end",
      });
      expect(rep.cases.find((c) => c.relDir === "syn/out-of-footprint").notYet).toContain("stmt: for-stmt");
      expect(rep.total).toBe(4);
      expect(rep.conformance.total).toBe(2);
      expect(rep.conformance.passed).toBe(1);
      expect(rep.conformance.failures.map((f) => f.relDir)).toEqual(["syn/in-footprint-wrong"]);
      expect(rep.conformance.failures[0].reasons.join(" ")).toContain("state: cell 'count' expected 5, got 1");
      expect(rep.notYetByReason).toContainEqual(["stmt: for-stmt", 1]);
      const table = footprintTable(rep, "CG=substitute");
      expect(table).toContain("Cases considered: **4 of 4**");
      expect(table).toContain("| GRADED | 2 (runtime half 2 · codes-only 0) |");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 60000);
});
