/**
 * conformance-xfail.test.js — S430 P7: per-implementation expected failure in the conformance runner.
 *
 * The ruling: the TS gap ledger is fixed only for cause; every other gap is CARRIED — a conformance
 * case pinning the CORRECT behaviour, expected-to-fail on impl#1, required of the bootstrap. The
 * runner's `xfail` mark is the mechanism, and a mark is an escape hatch, so every way it could absorb
 * a failure it should not is pinned here:
 *
 *   - a case that FAILS on the marked impl        -> XFAIL (green)
 *   - a case that PASSES on the marked impl       -> XPASS (RED — the gap is fixed; the mark must go)
 *   - a mark naming a gap absent from the ledger  -> RED
 *   - a mark naming a gap that is not carried     -> RED
 *   - a malformed mark / unknown impl id          -> RED
 *   - a malformed CONTRACT is never absorbable    -> RED even when marked
 *   - a carried gap no case pins                  -> reported (the gated bridge asserts it empty)
 *   - `N xfail of M` is the reported ratio
 *
 * The live ledger carries no `status=carried` gap yet, so the ACCEPTING path is exercised against a
 * synthetic ledger (gapStatusIndexFromText) and synthetic case dirs (loadCases(dir)) — a gate whose
 * accepting path could only be reached by editing the live ledger is one whose accepting path is
 * never run. The compile itself is REAL (impl#1), not stubbed.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  loadCases,
  evaluateCase,
  runAll,
  resolveXfail,
  classifyOutcome,
  unpinnedCarriedGaps,
  gapStatusIndexFromText,
  xfailRatioLine,
  KNOWN_IMPL_IDS,
} from "../../../conformance/run.ts";

const LEDGER = [
  "<!-- @gap id=g-carried-a sev=MED status=carried locus=x.ts -->",
  "<!-- @gap id=g-carried-unpinned sev=LOW status=carried -->",
  "<!-- @gap id=g-open-b sev=HIGH status=open -->",
  "<!-- @gap id=g-resolved-c sev=LOW status=resolved -->",
].join("\n");

// A source impl#1 compiles cleanly. "passes" asserts nothing it fails; "fails" requires a code no
// compiler emits, so it fails on impl#1 by construction (the stand-in for a carried defect).
const SOURCE = "<program>\n<p>hello</p>\n</program>\n";
const NEVER_FIRES = "E-CONFORMANCE-XFAIL-FIXTURE-NEVER-FIRES";

function caseJson(id, { fails, xfail, expectOverride } = {}) {
  const j = {
    id,
    description: "xfail fixture",
    "language-version": "1.0",
    expect: expectOverride ?? { codes: fails ? [NEVER_FIRES] : [], notCodes: [] },
  };
  if (xfail !== undefined) j.xfail = xfail;
  return j;
}

let root;
const gaps = gapStatusIndexFromText(LEDGER);

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "scrml-conformance-xfail-"));
  const add = (name, json) => {
    const d = join(root, name);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "case.scrml"), SOURCE);
    writeFileSync(join(d, "expected.json"), JSON.stringify(json, null, 2));
  };
  add("a-xfail-still-fails", caseJson("xf-1", { fails: true, xfail: { "impl1-ts": "g-carried-a" } }));
  add("b-xpass", caseJson("xf-2", { fails: false, xfail: { "impl1-ts": "g-carried-a" } }));
  add("c-dangling-gap", caseJson("xf-3", { fails: true, xfail: { "impl1-ts": "g-no-such-gap" } }));
  add("d-open-not-carried", caseJson("xf-4", { fails: true, xfail: { "impl1-ts": "g-open-b" } }));
  add("e-unknown-impl", caseJson("xf-5", { fails: true, xfail: { impl1: "g-carried-a" } }));
  add("f-empty-mark", caseJson("xf-6", { fails: true, xfail: {} }));
  add("g-malformed-contract-marked", caseJson("xf-7", {
    xfail: { "impl1-ts": "g-carried-a" },
    expectOverride: { codes: [], notCodes: [], severity: {} }, // S365 container policy violation
  }));
  add("h-plain-pass", caseJson("xf-8", { fails: false }));
  add("i-plain-fail", caseJson("xf-9", { fails: true }));
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

const byDir = () => Object.fromEntries(loadCases(root).map((c) => [c.relDir, c]));

describe("S430 P7 — xfail outcomes against the real impl#1 compile", () => {
  test("a marked case that still FAILS is XFAIL (green) and names its gap", async () => {
    const r = await evaluateCase(byDir()["a-xfail-still-fails"], gaps);
    expect(r.pass).toBe(false); // the raw assertions DID fail — `pass` keeps its pre-S430 meaning
    expect(r.outcome).toBe("xfail");
    expect(r.ok).toBe(true);
    expect(r.xfailGap).toBe("g-carried-a");
    expect(r.missing).toEqual([NEVER_FIRES]); // the failure stays readable under the mark
  });

  test("a marked case that PASSES is XPASS — a FAILURE, not a pass", async () => {
    const r = await evaluateCase(byDir()["b-xpass"], gaps);
    expect(r.pass).toBe(true);
    expect(r.outcome).toBe("xpass");
    expect(r.ok).toBe(false);
  });

  test("a mark naming a gap absent from the ledger is a failure", async () => {
    const r = await evaluateCase(byDir()["c-dangling-gap"], gaps);
    expect(r.outcome).toBe("fail");
    expect(r.xfailErrors.join("\n")).toMatch(/g-no-such-gap.*no @gap marker/);
  });

  test("a mark naming an OPEN (not carried) gap is a failure", async () => {
    const r = await evaluateCase(byDir()["d-open-not-carried"], gaps);
    expect(r.outcome).toBe("fail");
    expect(r.xfailErrors.join("\n")).toMatch(/g-open-b.*status=open.*status=carried/);
  });

  test("an unknown implementation id is a failure, not a silent no-op", async () => {
    const r = await evaluateCase(byDir()["e-unknown-impl"], gaps);
    expect(r.outcome).toBe("fail");
    expect(r.xfailErrors.join("\n")).toMatch(/unknown implementation/);
  });

  test("an empty xfail block is a failure (it marks nothing)", async () => {
    const r = await evaluateCase(byDir()["f-empty-mark"], gaps);
    expect(r.outcome).toBe("fail");
    expect(r.xfailErrors.join("\n")).toMatch(/EMPTY/);
  });

  test("a malformed CONTRACT is never absorbed by an xfail mark", async () => {
    const r = await evaluateCase(byDir()["g-malformed-contract-marked"], gaps);
    expect(r.shapeErrors.length).toBeGreaterThan(0);
    expect(r.outcome).toBe("fail");
  });

  test("unmarked cases keep plain pass / fail", async () => {
    expect((await evaluateCase(byDir()["h-plain-pass"], gaps)).outcome).toBe("pass");
    expect((await evaluateCase(byDir()["i-plain-fail"], gaps)).outcome).toBe("fail");
  });
});

describe("S430 P7 — the pairing, the totals, and the pure pieces", () => {
  test("runAll reports N xfail of M, XPASS, and the unpinned carried gap", async () => {
    const res = await runAll(root, gaps);
    expect(res.results.length).toBe(9);
    expect(res.xfailed).toBe(1);
    expect(res.xpassed).toBe(1);
    expect(res.passed).toBe(1);
    expect(res.failed).toBe(6);
    expect(res.unpinnedCarried).toEqual(["g-carried-unpinned"]);
    expect(xfailRatioLine(res.xfailed, res.results.length, res.xpassed)).toBe(
      "conformance (impl1-ts): 1 xfail of 9 cases, 1 XPASS (failures)",
    );
  });

  test("a carried gap pinned by a case is not reported unpinned", () => {
    const cases = loadCases(root);
    expect(unpinnedCarriedGaps(cases, gaps)).not.toContain("g-carried-a");
    expect(unpinnedCarriedGaps([], gaps)).toEqual(["g-carried-a", "g-carried-unpinned"]);
  });

  test("the outcome table", () => {
    expect(classifyOutcome(true, [], null, [])).toBe("pass");
    expect(classifyOutcome(false, [], null, [])).toBe("fail");
    expect(classifyOutcome(false, [], "g", [])).toBe("xfail");
    expect(classifyOutcome(true, [], "g", [])).toBe("xpass");
    expect(classifyOutcome(false, ["bad"], "g", [])).toBe("fail");
    expect(classifyOutcome(false, [], "g", ["bad mark"])).toBe("fail");
  });

  test("resolveXfail: absent key is free; a non-object is an error; only impl1-ts is known", () => {
    expect(resolveXfail({ id: "x" }, "impl1-ts", gaps)).toEqual({ gap: null, errors: [] });
    expect(resolveXfail({ id: "x", xfail: "g-carried-a" }, "impl1-ts", gaps).errors.length).toBe(1);
    expect(resolveXfail({ id: "x", xfail: { "impl1-ts": "" } }, "impl1-ts", gaps).errors.length).toBe(1);
    expect(KNOWN_IMPL_IDS).toEqual(["impl1-ts"]);
  });

  test("the ledger index refuses an unclassified status (the state.ts fail-loud guard)", () => {
    expect(() => gapStatusIndexFromText("<!-- @gap id=g-x sev=MED status=carryed -->")).toThrow(/does not classify/);
  });
});
