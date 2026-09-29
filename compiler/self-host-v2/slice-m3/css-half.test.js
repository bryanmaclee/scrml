// css-half.test.js — the footprint grader's CSS HALF plumbing (scripts/hybrid.ts, s440), with a STUB
// css grader (no browser: CI has none). The real verdicts come from css-oracle.js in Chromium
// (`bun scripts/hybrid.ts --swap CSS=… --footprint`); this pins what the grader DOES with them:
//   - a css FAIL of a graded conformance case is a FAIL of that case (red);
//   - css-only extras are classified by the same loop but never enter the conformance buckets;
//   - Core-level results join the css half; counts + exercised come from css PASSES only.

import { describe, test, expect } from "bun:test";
import { runFootprintGrade, footprintCounts, footprintTable } from "../../../scripts/hybrid.ts";
import * as sub from "./css-substitute.js";

const EXTRA = `<program>
  const Card = <div props={}>
      #{ .card { color: red; } }
      <div class="card">hi</div>
  </>
  <Card/>
</program>
`;
const NOT_YET_EXTRA = `<program>
  const Card = <div props={}>
      #{ .card { color: red !important; } }
      <div class="card">hi</div>
  </>
  <Card/>
</program>
`;

function stub(verdicts) {
  const seen = [];
  return {
    seen,
    css: {
      gradeCss: async ({ cases }) => {
        const m = new Map();
        for (const c of cases) {
          seen.push(c.relDir);
          m.set(c.relDir, verdicts[c.relDir] ?? null);
        }
        return m;
      },
      cssExtraCases: () => [
        { relDir: "css-oracle/stub-graded", source: EXTRA, auxFiles: {} },
        { relDir: "css-oracle/stub-not-yet", source: NOT_YET_EXTRA, auxFiles: {} },
      ],
      gradeCssCores: async () => [{ relDir: "css-core/stub", constructs: ["Token.OnVariant"], pass: true, reasons: [] }],
    },
  };
}

describe("hybrid footprint grade — the css half (stub grader)", () => {
  test("a css fail is red; extras stay out of the conformance buckets; counts + exercised from passes", async () => {
    const only = new Set(["style/clean-single-rule", "style/theme-tokens-recognized", "css-oracle/stub-graded", "css-oracle/stub-not-yet", "css-core/stub"]);
    const s = stub({
      "style/clean-single-rule": { pass: false, reasons: ["`.btn` color = X, SPEC says Y"] },
      "style/theme-tokens-recognized": { pass: true, reasons: [] },
      "css-oracle/stub-graded": { pass: true, reasons: [] },
    });
    const rep = await runFootprintGrade({ CSS: sub }, sub.footprint, null, { only, css: s.css });
    // The suite buckets hold suite cases only.
    expect(rep.cases.map((c) => c.relDir).sort()).toEqual(["style/clean-single-rule", "style/theme-tokens-recognized"]);
    expect(rep.enumerated).toBe(2);
    // The css fail became a case failure.
    expect(rep.conformance.failures.map((f) => f.relDir)).toEqual(["style/clean-single-rule"]);
    expect(rep.conformance.failures[0].reasons[0]).toContain("css: ");
    const by = new Map(rep.css.results.map((r) => [r.relDir, r]));
    expect(by.get("css-oracle/stub-graded")).toMatchObject({ population: "source", cls: "graded", pass: true });
    expect(by.get("css-oracle/stub-not-yet")).toMatchObject({ population: "source", cls: "not-yet", pass: null });
    expect(by.get("css-oracle/stub-not-yet").notYet.some((w) => w.includes("§65.7"))).toBe(true);
    expect(by.get("css-core/stub")).toMatchObject({ population: "core", pass: true });
    // The grader only asked for GRADED cases' verdicts.
    expect(s.seen.sort()).toEqual(["css-oracle/stub-graded", "style/clean-single-rule", "style/theme-tokens-recognized"]);
    const k = footprintCounts(rep);
    expect(k.cssPass.sort()).toEqual(["css-core/stub", "css-oracle/stub-graded", "style/theme-tokens-recognized"]);
    expect(k.cssFail).toEqual(["style/clean-single-rule"]);
    // exercised = constructs of css PASSES (the failing case's constructs are not evidence).
    expect(rep.css.exercised).toContain("Token.OnVariant");
    expect(rep.css.exercised).toContain("Token.Constant");
    expect(footprintTable(rep, "CSS=stub")).toContain("CSS half");
  });
});
