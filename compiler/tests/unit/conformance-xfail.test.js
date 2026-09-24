/**
 * conformance-xfail.test.js — S430 P7: per-implementation expected failure in the conformance runner.
 *
 * The ruling: the TS gap ledger is fixed only for cause; every other gap is CARRIED — a conformance
 * case pinning the CORRECT behaviour, expected-to-fail on impl#1, required of the bootstrap. The
 * runner's `xfail` mark is the mechanism, and a mark is an escape hatch, so every way it could absorb
 * a failure it should not is pinned here:
 *
 *   - fails on the marked impl WITH the recorded signature -> XFAIL (green)
 *   - fails with a DIFFERENT signature (codes or runtime)  -> FAIL  (a new regression stays visible)
 *   - PASSES on the marked impl                            -> XPASS (RED — the gap is fixed)
 *   - a bare-string mark / no `fails` / empty `fails`      -> RED ("xfail needs a failure signature")
 *   - a mark naming a gap absent from the ledger           -> RED
 *   - a mark naming a gap that is not carried              -> RED
 *   - a malformed mark / unknown impl id                   -> RED
 *   - a malformed CONTRACT is never absorbable             -> RED even when marked
 *   - a carried gap no case pins                           -> reported (the gated bridge asserts it empty)
 *   - `N xfail of M` is the reported ratio
 *
 * The live ledger carries no `status=carried` gap yet, so the ACCEPTING path is exercised against a
 * synthetic ledger (gapStatusIndexFromText) and synthetic case dirs (loadCases(dir)). The compile AND
 * the runtime half are REAL (impl#1 + happy-dom), not stubbed — the signature is only worth anything
 * if it is computed from what the real harness observes.
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
  failureSignature,
  signatureDiff,
  KNOWN_IMPL_IDS,
  normalizeVolatile,
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
const OTHER_NEVER_FIRES = "E-CONFORMANCE-XFAIL-FIXTURE-OTHER";
const SIG_A = { codes: ["missing:" + NEVER_FIRES] };
const MARK_A = { "impl1-ts": { gap: "g-carried-a", fails: SIG_A } };

// A real runtime-half source (the forms/checkbox-check case): checking the box drives @agreed to true.
const RT_SOURCE = [
  "${",
  "    <agreed> = false",
  "}",
  '<input type="checkbox" id="agree-checkbox" bind:checked=@agreed />',
  '<p id="status">Agreed: ${@agreed}</>',
  "",
].join("\n");
const rtExpect = (agreedWant) => ({
  codes: [],
  notCodes: [],
  input: [{ check: "#agree-checkbox" }],
  state: { agreed: agreedWant },
});

function caseJson(id, { fails, xfail, expectOverride } = {}) {
  const j = {
    id,
    description: "xfail fixture",
    "language-version": "1.0",
    expect: expectOverride ?? { codes: fails ? [fails === true ? NEVER_FIRES : fails] : [], notCodes: [] },
  };
  if (xfail !== undefined) j.xfail = xfail;
  return j;
}

let root;
let rtSignature; // the runtime signature observed for the "agreed must be false" (wrong) contract
const gaps = gapStatusIndexFromText(LEDGER);

function addCase(dir, name, json, source = SOURCE) {
  const d = join(dir, name);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, "case.scrml"), source);
  writeFileSync(join(d, "expected.json"), JSON.stringify(json, null, 2));
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "scrml-conformance-xfail-"));
  const add = (name, json, source) => addCase(root, name, json, source);
  add("a-xfail-matching-signature", caseJson("xf-1", { fails: true, xfail: MARK_A }));
  add("a2-fails-differently", caseJson("xf-1b", { fails: OTHER_NEVER_FIRES, xfail: MARK_A }));
  add("b-xpass", caseJson("xf-2", { fails: false, xfail: MARK_A }));
  add("c-dangling-gap", caseJson("xf-3", { fails: true, xfail: { "impl1-ts": { gap: "g-no-such-gap", fails: SIG_A } } }));
  add("d-open-not-carried", caseJson("xf-4", { fails: true, xfail: { "impl1-ts": { gap: "g-open-b", fails: SIG_A } } }));
  add("e-unknown-impl", caseJson("xf-5", { fails: true, xfail: { impl1: { gap: "g-carried-a", fails: SIG_A } } }));
  add("f-empty-mark", caseJson("xf-6", { fails: true, xfail: {} }));
  add("g-malformed-contract-marked", caseJson("xf-7", {
    xfail: MARK_A,
    expectOverride: { codes: [], notCodes: [], severity: {} }, // S365 container policy violation
  }));
  add("h-plain-pass", caseJson("xf-8", { fails: false }));
  add("i-plain-fail", caseJson("xf-9", { fails: true }));
  add("j-bare-string-mark", caseJson("xf-10", { fails: true, xfail: { "impl1-ts": "g-carried-a" } }));
  add("k-no-fails-key", caseJson("xf-11", { fails: true, xfail: { "impl1-ts": { gap: "g-carried-a" } } }));
  add("l-empty-fails", caseJson("xf-12", { fails: true, xfail: { "impl1-ts": { gap: "g-carried-a", fails: {} } } }));
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

const byDir = () => Object.fromEntries(loadCases(root).map((c) => [c.relDir, c]));

describe("S430 P7 — xfail outcomes against the real impl#1 compile (codes half)", () => {
  test("a marked case failing WITH its recorded signature is XFAIL (green) and names its gap", async () => {
    const r = await evaluateCase(byDir()["a-xfail-matching-signature"], gaps);
    expect(r.pass).toBe(false); // the raw assertions DID fail — `pass` keeps its pre-S430 meaning
    expect(r.observedSignature).toEqual(SIG_A);
    expect(r.signatureMismatch).toEqual([]);
    expect(r.outcome).toBe("xfail");
    expect(r.ok).toBe(true);
    expect(r.xfailGap).toBe("g-carried-a");
  });

  test("a marked case failing DIFFERENTLY is a FAIL — a new failure is not covered by the carried gap", async () => {
    const r = await evaluateCase(byDir()["a2-fails-differently"], gaps);
    expect(r.outcome).toBe("fail");
    expect(r.ok).toBe(false);
    expect(r.signatureMismatch.join("\n")).toContain("NEW failure not in the recorded signature: missing:" + OTHER_NEVER_FIRES);
    expect(r.signatureMismatch.join("\n")).toContain("recorded failure no longer occurs: missing:" + NEVER_FIRES);
  });

  test("a marked case that PASSES is XPASS — a FAILURE, not a pass", async () => {
    const r = await evaluateCase(byDir()["b-xpass"], gaps);
    expect(r.pass).toBe(true);
    expect(r.observedSignature).toEqual({});
    expect(r.outcome).toBe("xpass");
    expect(r.ok).toBe(false);
  });

  test("the bare-string form is rejected: xfail needs a failure signature", async () => {
    const r = await evaluateCase(byDir()["j-bare-string-mark"], gaps);
    expect(r.outcome).toBe("fail");
    expect(r.xfailErrors.join("\n")).toMatch(/xfail needs a failure signature[\s\S]*--xfail-signature xf-10/);
  });

  test("a mark with no `fails`, or an EMPTY `fails`, is rejected", async () => {
    const k = await evaluateCase(byDir()["k-no-fails-key"], gaps);
    expect(k.outcome).toBe("fail");
    expect(k.xfailErrors.join("\n")).toMatch(/xfail needs a failure signature/);
    const l = await evaluateCase(byDir()["l-empty-fails"], gaps);
    expect(l.outcome).toBe("fail");
    expect(l.xfailErrors.join("\n")).toMatch(/fails is EMPTY/);
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

describe("S430 P7 — the runtime-half signature is a stable digest of the real DOM/state diff", () => {
  let rtRoot;
  beforeAll(async () => {
    rtRoot = mkdtempSync(join(tmpdir(), "scrml-conformance-xfail-rt-"));
    // Capture: the (deliberately wrong) contract "after check, agreed is false" fails at runtime.
    addCase(rtRoot, "capture", caseJson("rt-0", { expectOverride: rtExpect(false) }), RT_SOURCE);
    const cap = await evaluateCase(loadCases(rtRoot)[0], gaps);
    rtSignature = cap.observedSignature;
    const mark = { "impl1-ts": { gap: "g-carried-a", fails: rtSignature } };
    addCase(rtRoot, "rt-same", caseJson("rt-1", { expectOverride: rtExpect(false), xfail: mark }), RT_SOURCE);
    addCase(rtRoot, "rt-different", caseJson("rt-2", { expectOverride: rtExpect("maybe"), xfail: mark }), RT_SOURCE);
    addCase(rtRoot, "rt-passes", caseJson("rt-3", { expectOverride: rtExpect(true), xfail: mark }), RT_SOURCE);
  });
  afterAll(() => {
    if (rtRoot) rmSync(rtRoot, { recursive: true, force: true });
  });
  const rt = () => Object.fromEntries(loadCases(rtRoot).map((c) => [c.relDir, c]));

  test("the captured runtime signature is a digest, with no codes half (the codes half passes)", () => {
    expect(Object.keys(rtSignature)).toEqual(["runtime"]);
    expect(rtSignature.runtime).toMatch(/^sha256:[0-9a-f]{16}$/);
  });

  test("same runtime failure -> XFAIL; the digest is stable across runs", async () => {
    const r = await evaluateCase(rt()["rt-same"], gaps);
    expect(r.observedSignature).toEqual(rtSignature);
    expect(r.outcome).toBe("xfail");
  });

  test("a DIFFERENT runtime failure (same cell, different wrong value) -> FAIL", async () => {
    const r = await evaluateCase(rt()["rt-different"], gaps);
    expect(r.outcome).toBe("fail");
    expect(r.signatureMismatch.join("\n")).toMatch(/^runtime: recorded sha256:/);
  });

  test("the runtime half passing -> XPASS", async () => {
    expect((await evaluateCase(rt()["rt-passes"], gaps)).outcome).toBe("xpass");
  });
});

describe("S430 P7 — the pairing, the totals, and the pure pieces", () => {
  test("runAll reports N xfail of M, XPASS, and the unpinned carried gap", async () => {
    const res = await runAll(root, gaps);
    expect(res.results.length).toBe(13);
    expect(res.xfailed).toBe(1);
    expect(res.xpassed).toBe(1);
    expect(res.passed).toBe(1);
    expect(res.failed).toBe(10);
    expect(res.unpinnedCarried).toEqual(["g-carried-unpinned"]);
    expect(xfailRatioLine(res.xfailed, res.results.length, res.xpassed)).toBe(
      "conformance (impl1-ts): 1 xfail of 13 cases, 1 XPASS (failures)",
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
    expect(classifyOutcome(false, [], "g", [], false)).toBe("fail"); // fails differently
    expect(classifyOutcome(true, [], "g", [])).toBe("xpass");
    expect(classifyOutcome(true, [], "g", [], false)).toBe("xpass");
    expect(classifyOutcome(false, ["bad"], "g", [])).toBe("fail");
    expect(classifyOutcome(false, [], "g", ["bad mark"])).toBe("fail");
  });

  test("failureSignature / signatureDiff are order-insensitive and name both directions", () => {
    const r = {
      missing: ["E-B", "E-A"], forbidden: ["W-X"], prefixViolations: [], severityMismatches: [],
      countMismatches: [], runtimeFailures: [],
    };
    expect(failureSignature(r)).toEqual({ codes: ["forbidden:W-X", "missing:E-A", "missing:E-B"] });
    expect(signatureDiff({ codes: ["missing:E-B", "missing:E-A", "forbidden:W-X"] }, failureSignature(r))).toEqual([]);
    expect(signatureDiff({ codes: ["missing:E-A"] }, { codes: ["missing:E-C"] })).toEqual([
      "codes: NEW failure not in the recorded signature: missing:E-C",
      "codes: recorded failure no longer occurs: missing:E-A",
    ]);
  });

  test("resolveXfail: absent key is free; malformed shapes are errors; only impl1-ts is known", () => {
    expect(resolveXfail({ id: "x" }, "impl1-ts", gaps)).toEqual({ mark: null, errors: [] });
    expect(resolveXfail({ id: "x", xfail: "g-carried-a" }, "impl1-ts", gaps).errors.length).toBe(1);
    const extraKey = resolveXfail({ id: "x", xfail: { "impl1-ts": { gap: "g-carried-a", fails: SIG_A, why: "?" } } }, "impl1-ts", gaps);
    expect(extraKey.errors.join("\n")).toMatch(/why is not a mark key/);
    const badDigest = resolveXfail({ id: "x", xfail: { "impl1-ts": { gap: "g-carried-a", fails: { runtime: "abc" } } } }, "impl1-ts", gaps);
    expect(badDigest.errors.join("\n")).toMatch(/sha256:<16 lowercase hex>/);
    const ok = resolveXfail({ id: "x", xfail: MARK_A }, "impl1-ts", gaps);
    expect(ok).toEqual({ mark: { gap: "g-carried-a", fails: SIG_A }, errors: [] });
    expect(KNOWN_IMPL_IDS).toEqual(["impl1-ts"]);
  });

  test("the ledger index refuses an unclassified status (the state.ts fail-loud guard)", () => {
    expect(() => gapStatusIndexFromText("<!-- @gap id=g-x sev=MED status=carryed -->")).toThrow(/does not classify/);
  });
});

// ── S430 review round ────────────────────────────────────────────────────────────────────────────

// The reviewer's reproducer: a kind="tool" program that CRASHES on impl#1 (args[7] is undefined),
// with a wrong expected stdout. Bun's stderr for it carries a random mkdtemp path, the Bun version
// and generated-code line numbers; before the fix the digest changed on every run.
const TOOL_CRASH = [
  '<program kind="tool" lang="ts">',
  "    function main(args: string[]): number {",
  "        const n = args[7].length",
  "        println(n)",
  "        return 0",
  "    }",
  "</program>",
  "",
].join("\n");

// A source that emits an unrelated error (E-API-BASE-MISSING), for the emitted-multiset pin.
const EMITS_API_BASE_MISSING = [
  "<program>",
  "",
  "type UserQuery:struct = { id: int }",
  "type UserResult:enum = {",
  "  Found(name: string)",
  "  NotFound",
  "}",
  "",
  '<api src="openapi.json">',
  '  getUser(UserQuery) -> GET "/users/${id}" : UserResult',
  "</api>",
  "",
  "</program>",
  "",
].join("\n");

async function evalOne(source, json) {
  const r0 = mkdtempSync(join(tmpdir(), "scrml-conformance-xfail-one-"));
  try {
    addCase(r0, "case-dir-" + Math.random().toString(36).slice(2), json, source);
    return await evaluateCase(loadCases(r0)[0], gaps);
  } finally {
    rmSync(r0, { recursive: true, force: true });
  }
}

describe("S430 review MED — a crashing tool case has a STABLE runtime signature", () => {
  const toolCase = (xfail) =>
    caseJson("tool-crash", { expectOverride: { codes: [], notCodes: [], stdout: "never" }, xfail });

  test("the same crash, run twice from different case paths, yields the identical digest", async () => {
    const a = await evalOne(TOOL_CRASH, toolCase());
    const b = await evalOne(TOOL_CRASH, toolCase());
    expect(a.pass).toBe(false);
    // the DISPLAY text still carries the volatile temp path (it differs run to run) …
    expect(a.runtimeFailures[0]).toMatch(/scrml-conf-tool-/);
    expect(a.runtimeFailures[0]).not.toBe(b.runtimeFailures[0]);
    // … but the signature is structured and normalised, so it does not.
    expect(a.observedSignature.runtime).toMatch(/^sha256:[0-9a-f]{16}$/);
    expect(b.observedSignature).toEqual(a.observedSignature);
    expect(a.runtimeSignatureKeys[0]).toContain('"exitCode":1');
    expect(a.runtimeSignatureKeys[0]).toContain("TypeError: undefined is not an object");
    expect(a.runtimeSignatureKeys[0]).not.toMatch(/scrml-conf-tool-|Bun v\d/);
  }, 60_000);

  test("so the crash can be CARRIED: marked with its captured signature it is XFAIL on a fresh run", async () => {
    const cap = await evalOne(TOOL_CRASH, toolCase());
    const r = await evalOne(TOOL_CRASH, toolCase({ "impl1-ts": { gap: "g-carried-a", fails: cap.observedSignature } }));
    expect(r.outcome).toBe("xfail");
  }, 60_000);

  test("a different expected stdout on the same crash is a different signature", async () => {
    const a = await evalOne(TOOL_CRASH, toolCase());
    const b = await evalOne(TOOL_CRASH, caseJson("tool-crash", { expectOverride: { codes: [], notCodes: [], stdout: "other" } }));
    expect(b.observedSignature.runtime).not.toBe(a.observedSignature.runtime);
  }, 60_000);

  test("normalizeVolatile strips temp paths, the Bun banner and the frame gutter", () => {
    const raw =
      "15 | function main(args) {\n16 |   const n = args[7].length;\nTypeError: x\n" +
      "      at main (" + tmpdir() + "/scrml-conf-tool-AbC123/case.tool.js:16:18)\n" +
      "      at /tmp/scrml-conf-tool-ZzZ999/case.tool.js:23:32\n\nBun v1.3.14 (Linux x64)";
    const n = normalizeVolatile(raw);
    expect(n).not.toMatch(/AbC123|ZzZ999|1\.3\.14|:16:18|:23:32|^15 \|/m);
    expect(n).toContain("<TMP>:<L>");
    expect(n).toContain("Bun <VERSION>");
    expect(normalizeVolatile(JSON.stringify(raw))).not.toMatch(/AbC123|ZzZ999|1\.3\.14/);
  });

  test("a thrown runtime half is signed by name + normalised message, not the raw message", async () => {
    // Reached through the structured-key path directly: evaluateCase records the throw as
    // `threw:<name>: <normalised message>`.
    const fake = {
      missing: [], forbidden: [], prefixViolations: [], severityMismatches: [], countMismatches: [],
      runtimeFailures: ["runtime half threw: ENOENT " + tmpdir() + "/scrml-x-1/a.js"],
      runtimeSignatureKeys: ["threw:Error: " + normalizeVolatile("ENOENT " + tmpdir() + "/scrml-x-1/a.js")],
    };
    const fake2 = {
      ...fake,
      runtimeFailures: ["runtime half threw: ENOENT " + tmpdir() + "/scrml-x-2/a.js"],
      runtimeSignatureKeys: ["threw:Error: " + normalizeVolatile("ENOENT " + tmpdir() + "/scrml-x-2/a.js")],
    };
    expect(failureSignature(fake2)).toEqual(failureSignature(fake));
  });
});

describe("S430 review LOW — the codes signature pins the emitted E-* MULTISET", () => {
  const contract = { codes: [NEVER_FIRES], notCodes: [] };

  test("a carried case that starts emitting an unrelated NEW error is a FAIL, not an absorbed XFAIL", async () => {
    // Recorded against the clean source: the only failure is the missing code.
    const clean = await evalOne(SOURCE, caseJson("c3", { expectOverride: contract }));
    expect(clean.observedSignature).toEqual({ codes: ["missing:" + NEVER_FIRES] });
    // Same contract, same missing code — but the compiler now ALSO emits E-API-BASE-MISSING.
    const r = await evalOne(
      EMITS_API_BASE_MISSING,
      caseJson("c3", { expectOverride: contract, xfail: { "impl1-ts": { gap: "g-carried-a", fails: clean.observedSignature } } }),
    );
    expect(r.missing).toEqual([NEVER_FIRES]); // the recorded assertion failure is unchanged …
    expect(r.outcome).toBe("fail"); // … and the new error is still caught
    expect(r.signatureMismatch.join("\n")).toContain("NEW failure not in the recorded signature: emitted:E-API-BASE-MISSING=1");
  }, 60_000);

  test("multiplicity is part of the signature", () => {
    const base = {
      missing: ["E-X"], forbidden: [], prefixViolations: [], severityMismatches: [], countMismatches: [],
      runtimeFailures: [],
    };
    const once = failureSignature({ ...base, emittedCounts: { "E-Y": 1, "W-Z": 3 } });
    const twice = failureSignature({ ...base, emittedCounts: { "E-Y": 2, "W-Z": 3 } });
    expect(once).toEqual({ codes: ["emitted:E-Y=1", "missing:E-X"] }); // W-* is not pinned
    expect(signatureDiff(once, twice)).toEqual([
      "codes: NEW failure not in the recorded signature: emitted:E-Y=2",
      "codes: recorded failure no longer occurs: emitted:E-Y=1",
    ]);
    // A PASSING case's signature stays empty whatever it emits.
    expect(failureSignature({ ...base, missing: [], emittedCounts: { "E-Y": 1 } })).toEqual({});
  });
});
