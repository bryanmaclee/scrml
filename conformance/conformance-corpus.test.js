/**
 * Conformance corpus — bun:test wrapper (codes (a) + runtime (b) halves).
 *
 * One test() per case under conformance/cases/. Each asserts:
 *   (a) the emitted code-SET satisfies PRESENCE (expect.codes) + ABSENCE
 *       (expect.notCodes); and
 *   (b) when the case carries any of { input, dom, domAnchored, state }, the
 *       post-run state snapshot + normalized DOM satisfy the runtime contract
 *       (compile + execute in happy-dom — see conformance/adapters/impl1-ts.ts).
 *   (c) S430 P7 — an `"xfail": { "impl1-ts": "<gap-id>" }` case must still FAIL
 *       (XFAIL) for a `status=carried` gap; XPASS / a dangling gap is red. Same
 *       semantics as the gated bridge (compiler/tests/conformance/corpus-bridge.test.js).
 *
 * NOTE: this file lives under the top-level conformance/ dir (SCOPE OQ5 — the
 * suite's eventual impl-agnostic home), which is OUTSIDE bunfig.toml's
 * `[test] root = "compiler/tests/"`. It is therefore NOT auto-discovered by the
 * root-restricted pre-commit gate; run it explicitly:
 *
 *     bun test conformance/conformance-corpus.test.js
 *
 * (Wiring it into the gated suite is a full-W2/W4 decision — see the dispatch
 * report's extraction-friction section + SCOPE §6 D-1.)
 */
import { describe, test, expect, afterAll } from "bun:test";
import {
  loadCases,
  runCase,
  runCaseRuntime,
  hasRuntimeHalf,
  evaluateCase,
  failureSummary,
  loadGapStatusIndex,
  unpinnedCarriedGaps,
  xfailRatioLine,
} from "./run.ts";

describe("scrml conformance corpus — impl#1 (codes + runtime)", () => {
  const cases = loadCases();
  const gaps = loadGapStatusIndex();
  const tally = { xfail: 0, xpass: 0 };

  test("corpus is non-empty (cases loaded)", () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  test("every status=carried gap is pinned by at least one xfail case", () => {
    expect(unpinnedCarriedGaps(cases, gaps)).toEqual([]);
  });

  afterAll(() => console.log(xfailRatioLine(tally.xfail, cases.length, tally.xpass)));

  for (const c of cases) {
    const runtime = hasRuntimeHalf(c);
    const tag = c.expected["runtime-half-pending"]
      ? " [runtime-half-pending]"
      : runtime
        ? " [runtime]"
        : "";
    const label = `${c.relDir} (${c.expected.id})${tag}`;
    test(label, async () => {
      if ("xfail" in c.expected) {
        const r = await evaluateCase(c, gaps);
        expect(r.shapeErrors).toEqual([]);
        expect(r.xfailErrors).toEqual([]);
        if (r.outcome === "xfail") tally.xfail++;
        if (r.outcome === "xpass") tally.xpass++;
        const why =
          r.outcome === "xpass"
            ? `XPASS — gap '${r.xfailGap}' is FIXED on impl1-ts; remove the xfail mark and resolve the gap.`
            : `XFAIL (${r.xfailGap}): ${failureSummary(r).join(" | ")}`;
        expect({ outcome: r.outcome, why }).toEqual({ outcome: "xfail", why: expect.any(String) });
        return;
      }
      // (a) codes half.
      const r = runCase(c);
      expect(r.missing).toEqual([]); // PRESENCE: every required code fired.
      expect(r.forbidden).toEqual([]); // ABSENCE: no forbidden code fired.
      expect(r.prefixViolations).toEqual([]); // ABSENCE: no forbidden family-prefix fired.
      expect(r.severityMismatches).toEqual([]); // §34: each asserted code's severity matches.
      expect(r.countMismatches).toEqual([]); // CARDINALITY: each asserted code fired exactly N times.
      expect(r.shapeErrors).toEqual([]); // WELL-FORMEDNESS: the case's own `expect` block is shaped legally.
      // (b) runtime half (only when the case declares one).
      if (runtime) {
        const failures = await runCaseRuntime(c);
        expect(failures).toEqual([]);
      }
    });
  }
});
