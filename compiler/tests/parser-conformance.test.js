/**
 * Parser conformance harness — Acorn-replacement gate.
 *
 * Per deep-dives/scrml-native-parser-design-2026-05-17.md §D6:
 *   "Tier 1+2 MUST PASS on the conformance corpus; Tier 3+4 are
 *    informational and do not fail the test."
 *
 * Pre-M1 reality (today): scrmlNativeParserStub returns acorn's output
 * unchanged, so every comparison is trivially equivalent (both parsers
 * either succeed and produce identical ASTs, or both fail with the same
 * error). This proves the harness wiring, normalization, and diff logic
 * work BEFORE the real scrml-native parser exists. Post-M1, the stub is
 * replaced by the real native lexer+parser per §D7-M1 and this test
 * starts surfacing real divergences.
 *
 * Corpus:
 *   - bench/*.js   — curated single-feature fixtures (§D5 MUST PARSE list)
 *   - samples/     — ~869 .scrml gauntlet + compilation-test fixtures
 *   - examples/    — ~62 .scrml example apps
 *   - stdlib/      — ~46 .scrml stdlib modules
 *   - compiler/self-host-v2/ — the bootstrap compiler's .scrml sources (replaced
 *                  the retired v1 compiler/self-host/ at S447)
 *
 * Per primer Pillar 5b: the comparator HARNESS is calculation (pure diff over
 * input trees), but `describe`/`test` are framework idioms (modeling exception
 * per the dispatch brief). The per-row work delegates to the fn-shape diff
 * functions in tier-diff.js.
 */

import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";

import { acornParser, scrmlNativeParserStub } from "./parser-conformance/parsers.js";
import {
  tier1NodeKindDiff,
  tier2ValueDiff,
  tier3SpanDiff,
  tier4FullDiff,
} from "./parser-conformance/tier-diff.js";
import {
  enumerateBenchCorpus,
  enumerateScrmlCorpus,
  corpusSizes,
} from "./parser-conformance/corpus-enumerator.js";

// ---------------------------------------------------------------------------
// Corpus assembly
// ---------------------------------------------------------------------------

const BENCH = enumerateBenchCorpus();
const SCRML = enumerateScrmlCorpus();
const SIZES = corpusSizes();

/**
 * Combined corpus for the conformance loop, with disposition hints:
 *   - bench rows: pure JS, both parsers MUST agree on success+AST.
 *   - .scrml rows: raw acorn cannot parse scrml-extension syntax; per §D6
 *     "documented intentional divergences", both parsers (which are both
 *     acorn pre-M1) WILL fail in lockstep on most .scrml files — that's a
 *     matching-error-state which the tier-1 diff treats as PASS (no AST
 *     produced on either side → empty walk → empty divergences).
 *
 * Each row: { source, path, relpath, kind: "bench"|"scrml" }.
 */
const CORPUS = [
  ...BENCH.map((r) => ({ ...r, kind: "bench" })),
  ...SCRML.map((r) => ({ ...r, kind: "scrml" })),
];

/**
 * Run both parsers on a corpus row's content.
 * Returns { source, outA, outB }.
 */
function parseBoth(row) {
  const text = readFileSync(row.path, "utf8");
  const outA = acornParser.parse(text);
  const outB = scrmlNativeParserStub.parse(text);
  return { text, outA, outB };
}

/** Both ASTs are null (both parsers failed). Treated as matching-error PASS. */
function bothFailed(outA, outB) {
  return outA.ast === null && outB.ast === null;
}

/** Exactly one parser failed — a hard structural divergence. */
function oneSideFailed(outA, outB) {
  return (outA.ast === null) !== (outB.ast === null);
}

// ---------------------------------------------------------------------------
// Corpus sanity (sized-as-expected; both parsers callable)
// ---------------------------------------------------------------------------

describe("Parser conformance — corpus sanity", () => {
  test("bench corpus has ≥10 single-feature fixtures", () => {
    expect(SIZES.bench).toBeGreaterThanOrEqual(10);
  });

  test("scrml corpus covers all four source dirs", () => {
    expect(SIZES.samples).toBeGreaterThan(0);
    expect(SIZES.examples).toBeGreaterThan(0);
    expect(SIZES.stdlib).toBeGreaterThan(0);
    expect(SIZES["self-host-v2"]).toBeGreaterThan(0);
  });

  test("both parsers are callable on a trivial JS expression", () => {
    const outA = acornParser.parse("1 + 2");
    const outB = scrmlNativeParserStub.parse("1 + 2");
    expect(outA.error).toBeNull();
    expect(outB.error).toBeNull();
    expect(outA.ast).not.toBeNull();
    expect(outB.ast).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tier 1 — node-kind sequence MUST match
// Tier 2 — identifier/literal/operator values MUST match
// ---------------------------------------------------------------------------

describe("Parser conformance — Tier 1 (node-kind sequence) MUST PASS", () => {
  for (const row of CORPUS) {
    test(`[${row.source}] ${row.relpath}`, () => {
      const { outA, outB } = parseBoth(row);
      if (oneSideFailed(outA, outB)) {
        throw new Error(
          `E-CONFORMANCE-1: parsers disagree on success — ` +
            `acorn=${outA.ast === null ? "FAIL: " + outA.error : "OK"}; ` +
            `scrml-native=${outB.ast === null ? "FAIL: " + outB.error : "OK"}`
        );
      }
      if (bothFailed(outA, outB)) {
        // Both failed — matching-error state (acceptable per §D6 documented
        // intentional divergences for .scrml extension syntax). Tier 1 passes.
        return;
      }
      const diff = tier1NodeKindDiff(outA.ast, outB.ast);
      if (!diff.match) {
        const sample = diff.divergences.slice(0, 5).map(
          (d) => `  at ${d.path}: ${d.kindA} !== ${d.kindB}`
        ).join("\n");
        throw new Error(
          `E-CONFORMANCE-1: ${diff.divergences.length} structural divergence(s)\n${sample}`
        );
      }
      expect(diff.match).toBe(true);
    });
  }
});

describe("Parser conformance — Tier 2 (identifier/literal/operator values) MUST PASS", () => {
  for (const row of CORPUS) {
    test(`[${row.source}] ${row.relpath}`, () => {
      const { outA, outB } = parseBoth(row);
      if (oneSideFailed(outA, outB) || bothFailed(outA, outB)) return; // Tier 1 owns these
      const diff = tier2ValueDiff(outA.ast, outB.ast);
      if (!diff.match) {
        const sample = diff.divergences.slice(0, 5).map(
          (d) => `  at ${d.path} field ${d.field}: ${JSON.stringify(d.valueA)} !== ${JSON.stringify(d.valueB)}`
        ).join("\n");
        throw new Error(
          `E-CONFORMANCE-2: ${diff.divergences.length} value divergence(s)\n${sample}`
        );
      }
      expect(diff.match).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// Tier 3 — span preservation (informational; SHOULD match but doesn't fail)
// ---------------------------------------------------------------------------

describe("Parser conformance — Tier 3 (span preservation) informational", () => {
  // Aggregate reporting only — we don't want N×corpus test failures from spans.
  test("span deltas across full corpus (informational)", () => {
    let comparedRows = 0;
    let divergentRows = 0;
    let totalDivergences = 0;
    const samples = [];
    for (const row of CORPUS) {
      const { outA, outB } = parseBoth(row);
      if (outA.ast === null || outB.ast === null) continue;
      comparedRows++;
      const diff = tier3SpanDiff(outA.ast, outB.ast);
      if (!diff.match) {
        divergentRows++;
        totalDivergences += diff.divergences.length;
        if (samples.length < 3) {
          samples.push({ row: row.relpath, count: diff.divergences.length });
        }
      }
    }
    // Always passes — informational report only.
    // Pre-M1: stub == acorn → divergentRows MUST be 0.
    if (divergentRows > 0) {
      console.warn(
        `[parser-conformance Tier 3] ${divergentRows}/${comparedRows} rows have span divergences ` +
          `(${totalDivergences} total). Sample: ${JSON.stringify(samples)}`
      );
    }
    expect(comparedRows).toBeGreaterThan(0);
    // Pre-M1 invariant: stub returns acorn output verbatim, so 0 divergences.
    expect(divergentRows).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tier 4 — full AST equality minus spans (informational; OPTIONAL)
// ---------------------------------------------------------------------------

describe("Parser conformance — Tier 4 (full AST equality minus spans) informational", () => {
  test("full-AST deltas across full corpus (informational)", () => {
    let comparedRows = 0;
    let divergentRows = 0;
    const samples = [];
    for (const row of CORPUS) {
      const { outA, outB } = parseBoth(row);
      if (outA.ast === null || outB.ast === null) continue;
      comparedRows++;
      const diff = tier4FullDiff(outA.ast, outB.ast);
      if (!diff.match) {
        divergentRows++;
        if (samples.length < 3) {
          samples.push({
            row: row.relpath,
            firstDiff: diff.divergences[0]?.path,
            firstDiffMsg: diff.divergences[0]?.diff,
          });
        }
      }
    }
    if (divergentRows > 0) {
      console.warn(
        `[parser-conformance Tier 4] ${divergentRows}/${comparedRows} rows have full-AST divergences. ` +
          `Sample: ${JSON.stringify(samples)}`
      );
    }
    expect(comparedRows).toBeGreaterThan(0);
    // Pre-M1 invariant: stub returns acorn output verbatim, so 0 divergences.
    expect(divergentRows).toBe(0);
  });
});
