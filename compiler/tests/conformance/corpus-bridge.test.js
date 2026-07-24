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
 * The corpus is DETERMINISTIC (settle-based; no real-time waits) — verified
 * stable across repeated runs before gating.
 */
import { describe, test, expect } from "bun:test";
import {
  loadCases,
  runCase,
  runCaseRuntime,
  hasRuntimeHalf,
} from "../../../conformance/run.ts";
import { foldChunkNamespacing } from "../helpers/chunk-scope.js";

describe("conformance corpus (gated bridge) — impl#1 codes + runtime", () => {
  const cases = loadCases();

  test("corpus is non-empty (cases discovered under conformance/cases/)", () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  for (const c of cases) {
    const runtime = hasRuntimeHalf(c);
    const tag = c.expected["runtime-half-pending"]
      ? " [runtime-half-pending]"
      : runtime
        ? " [runtime]"
        : "";
    test(`${c.relDir} (${c.expected.id})${tag}`, async () => {
      // (a) codes half — presence + absence + family-prefix + §34 severity.
      const r = runCase(c);
      expect(r.missing).toEqual([]); // every required code fired
      expect(r.forbidden).toEqual([]); // no forbidden code fired
      expect(r.prefixViolations).toEqual([]); // no forbidden family-prefix fired
      expect(r.severityMismatches).toEqual([]); // each asserted code's severity matches
      // (b) runtime half — only when the case declares one.
      if (runtime) {
        const failures = await runCaseRuntime(c);
        expect(failures).toEqual([]);
      }
    });
  }
});
