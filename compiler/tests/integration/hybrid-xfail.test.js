/**
 * hybrid-xfail — P5 x P7: impl1-ts xfail marks apply to a HYBRID (PA ruling S430).
 *
 * A hybrid is the TS pipeline with one stage swapped, so it still contains TS stages and a carried
 * gap's expected failure is still expected there. Before this, `runHybridConformance` called
 * runCase/runCaseRuntime directly and ignored xfail: the first carried gap would have made the P5
 * module-done gate unreachable. Now, through the runner's own `evaluateCase`:
 *
 *   XFAIL (fails WITH the recorded signature)  -> ok, listed in `xfailed`
 *   FAILS DIFFERENTLY from the signature       -> RED
 *   XPASS                                      -> REPORTED + counted in `xpassed`, NOT red
 *                                                 (the swapped stage may be what fixed it)
 *   a mark on a non-carried gap                -> RED
 *
 * Real hybrid path: the identity-TAB fixture swapped in through the stage seam, synthetic case dirs,
 * a synthetic ledger (the live one carries no carried gap yet).
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join, resolve, dirname } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";
import { buildStageOverrides, runHybridConformance } from "../../../scripts/hybrid.ts";
import { loadCases, evaluateCase, gapStatusIndexFromText } from "../../../conformance/run.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const IDENTITY_TAB = resolve(HERE, "fixtures/hybrid/tab-identity.js");
const gaps = gapStatusIndexFromText(
  ["<!-- @gap id=g-hy-carried sev=MED status=carried -->", "<!-- @gap id=g-hy-open sev=MED status=open -->"].join("\n"),
);
const SOURCE = "<program>\n<p>hello</p>\n</program>\n";
const NEVER = "E-HYBRID-XFAIL-FIXTURE-NEVER-FIRES";
const OTHER = "E-HYBRID-XFAIL-FIXTURE-OTHER";

let root;
function add(name, codes, xfail) {
  const d = join(root, name);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, "case.scrml"), SOURCE);
  const j = { id: name, description: "hybrid xfail fixture", "language-version": "1.0", expect: { codes, notCodes: [] } };
  if (xfail) j.xfail = xfail;
  writeFileSync(join(d, "expected.json"), JSON.stringify(j, null, 2));
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "scrml-hybrid-xfail-"));
  // Capture the signature on PURE impl1 first — the way a triage records it.
  add("capture", [NEVER]);
  const sig = (await evaluateCase(loadCases(root)[0], gaps)).observedSignature;
  rmSync(join(root, "capture"), { recursive: true, force: true });
  const mark = { "impl1-ts": { gap: "g-hy-carried", fails: sig } };
  add("a-carried-same-failure", [NEVER], mark);
  add("b-carried-fails-differently", [OTHER], mark);
  add("c-carried-now-passes", [], mark);
  add("d-mark-on-open-gap", [NEVER], { "impl1-ts": { gap: "g-hy-open", fails: sig } });
  add("e-plain-pass", []);
});
afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe("hybrid conformance honours impl1-ts xfail marks (P5 x P7)", () => {
  test("XFAIL ok; different failure RED; XPASS reported-not-red; non-carried mark RED", async () => {
    const overrides = await buildStageOverrides([["TAB", IDENTITY_TAB]]);
    const rep = await runHybridConformance(overrides, null, { casesDir: root, gaps });
    expect(rep.total).toBe(5);
    expect(rep.passed).toBe(1); // e-plain-pass
    expect(rep.xfailed).toEqual([{ relDir: "a-carried-same-failure", gap: "g-hy-carried" }]);
    expect(rep.xpassed).toEqual([{ relDir: "c-carried-now-passes", gap: "g-hy-carried" }]);
    expect(rep.failures.map((f) => f.relDir).sort()).toEqual(["b-carried-fails-differently", "d-mark-on-open-gap"]);
    const diff = rep.failures.find((f) => f.relDir === "b-carried-fails-differently");
    expect(diff.reasons.join("\n")).toContain("FAILS DIFFERENTLY from the recorded impl1-ts xfail signature");
    const open = rep.failures.find((f) => f.relDir === "d-mark-on-open-gap");
    expect(open.reasons.join("\n")).toMatch(/status=open/);
  }, 120_000);
});
