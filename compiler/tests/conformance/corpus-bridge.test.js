/**
 * Conformance corpus GATE bridge (D-1).
 *
 * The impl-agnostic conformance corpus lives at the TOP-LEVEL `conformance/`
 * dir (SCOPE OQ5 — the suite's eventual cross-impl home), which is OUTSIDE
 * bunfig.toml's `[test] root = "compiler/tests/"` and so is NOT auto-discovered
 * by the root-restricted pre-commit gate. This thin bridge — which DOES live
 * under the gated root — imports the corpus runner and asserts EVERY case
 * passes, so the corpus rides the existing pre-commit suite without modifying
 * bunfig.toml (per the D-1 dispatch brief).
 *
 * One test() per case (each well under the 10s per-test timeout). Asserts both
 * halves the corpus runner checks:
 *   (a) CODES — required-code PRESENCE + forbidden-code/forbidden-prefix
 *       ABSENCE + per-code §34 SEVERITY (the cross-stream-honest partition); and
 *   (b) RUNTIME — when the case declares input/dom/domAnchored/state, the
 *       post-run normalized DOM + state snapshot satisfy the contract
 *       (compile + execute in happy-dom — see conformance/adapters/impl1-ts.ts).
 *
 * (c) XFAIL (S430 P7) — a case carrying `"xfail": { "impl1-ts": "<gap-id>" }` is
 *     EXPECTED to fail on impl#1 for a `status=carried` gap. It is green here iff it
 *     still fails (XFAIL); it goes RED if it passes (XPASS — the gap is fixed and the
 *     mark must come off), if the gap id is missing from docs/known-gaps.md, or if
 *     the gap is not `status=carried`. A carried gap that no case pins is red too.
 *     The `N xfail of M` ratio is printed after the run so an escape hatch absorbing
 *     the suite is a visible number, not something one has to go and inspect.
 *
 * The corpus is DETERMINISTIC (settle-based; no real-time waits) — verified
 * stable across repeated runs before gating.
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
} from "../../../conformance/run.ts";
import { foldChunkNamespacing } from "../helpers/chunk-scope.js";

describe("conformance corpus (gated bridge) — impl#1 codes + runtime", () => {
  const cases = loadCases();
  const gaps = loadGapStatusIndex();
  const tally = { xfail: 0, xpass: 0 };

  test("corpus is non-empty (cases discovered under conformance/cases/)", () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  // S430 P7 — the reverse half of the carried/xfail pairing. A `status=carried` gap promises the
  // bootstrap an executable statement of the correct behaviour; one with no pinning case promises
  // nothing and must not read as triaged.
  test("every status=carried gap in docs/known-gaps.md is pinned by at least one xfail case", () => {
    expect(unpinnedCarriedGaps(cases, gaps)).toEqual([]);
  });

  afterAll(() => {
    // The ratio, every run — an absorbing hatch is a number going up, visible without inspection.
    console.log(xfailRatioLine(tally.xfail, cases.length, tally.xpass));
  });

  for (const c of cases) {
    const runtime = hasRuntimeHalf(c);
    const marked = "xfail" in c.expected;
    const tag =
      (c.expected["runtime-half-pending"] ? " [runtime-half-pending]" : runtime ? " [runtime]" : "") +
      (marked ? " [xfail]" : "");
    test(`${c.relDir} (${c.expected.id})${tag}`, async () => {
      if (marked) {
        // (c) an xfail-marked case: the verdict is the OUTCOME, and each way it can be wrong is a
        // distinct, named failure.
        const r = await evaluateCase(c, gaps);
        expect(r.shapeErrors).toEqual([]); // a malformed contract is never absorbable by a mark
        expect(r.xfailErrors).toEqual([]); // the mark names a real, status=carried gap
        if (r.outcome === "xpass") tally.xpass++;
        if (r.outcome === "xfail") tally.xfail++;
        const why =
          r.outcome === "xpass"
            ? `XPASS — every assertion holds on impl1-ts, so gap '${r.xfailGap}' is FIXED here. ` +
              `Remove the xfail mark and resolve the gap.`
            : r.outcome === "xfail"
              ? `XFAIL (${r.xfailGap}): ${failureSummary(r).join(" | ")}`
              : `outcome ${r.outcome}`;
        expect({ outcome: r.outcome, why }).toEqual({ outcome: "xfail", why: expect.any(String) });
        if (r.outcome === "xfail") console.log(`  ${c.relDir}: ${why}`);
        return;
      }
      // (a) codes half — presence + absence + family-prefix + §34 severity.
      const r = runCase(c);
      // S365 — the CONTRACT itself must be well-formed before any assertion means anything. A
      // malformed `expect` container (`severity: {}`, `notCodePrefixes: null`, a typo'd key) silently
      // disables the assertion it holds, so this bridge would otherwise green a case that asserts
      // nothing. Asserted FIRST: when it fires every list below is empty by construction, and reading
      // four empty lists as "clean" is exactly the hollowness being closed.
      expect(r.shapeErrors).toEqual([]);
      expect(r.missing).toEqual([]); // every required code fired
      expect(r.forbidden).toEqual([]); // no forbidden code fired
      expect(r.prefixViolations).toEqual([]); // no forbidden family-prefix fired
      expect(r.severityMismatches).toEqual([]); // each asserted code's severity matches
      expect(r.countMismatches).toEqual([]); // each asserted code fired exactly N times
      // (b) runtime half — only when the case declares one.
      if (runtime) {
        const failures = await runCaseRuntime(c);
        expect(failures).toEqual([]);
      }
    });
  }
});
