/**
 * parser-conformance-within-node.test.js — M6.5.b.0 Wave 1.
 *
 * The within-node parity canary. SISTER METRIC to the existing
 * parser-conformance-corpus.test.js (the M5-swap C2 pipeline-shape canary).
 * The two suites cover orthogonal axes:
 *
 *   parser-conformance-corpus.test.js   — top-level node-kind sequence +
 *                                          recursive node-kind sequence +
 *                                          hoist-counts + hasProgramRoot.
 *                                          Measures SHAPE-level parity.
 *   parser-conformance-within-node.test.js (this file) — per-class
 *                                          divergence counts within
 *                                          structurally-aligned nodes.
 *                                          Measures FIELD-level parity.
 *
 * The within-node classifier (`compiler/src/native-parser-canary/
 * within-node-classifier.ts`) walks two FileASTs in parallel and tallies
 * divergences by the SCOPING.md 7-class taxonomy (KIND-NAME, FIELD-SHAPE,
 * MISSING-FIELD, EXTRA-FIELD, COUNT-LENGTH, SPAN-COORD, NESTED-SHAPE).
 * Plus a pseudo-class PARSE-FAILURE for files where one pipeline returned
 * a malformed AST.
 *
 * ALLOWLIST BASELINE. The canary lands with the CURRENT corpus residuals
 * baked into `parser-conformance-within-node-allowlist.json`. Each
 * per-fixture entry is the live (pre-fix) divergence count per class. The
 * gate asserts every per-class residual (raw count minus allowlist) is
 * ZERO PER FIXTURE. As the M6.5.b.1-.b.6 FIX-NATIVE landings shrink the
 * actual divergences, the allowlist entries should be reduced/removed —
 * the regression-or-improvement signal surfaces as either (a) the
 * residual going POSITIVE (regression — gate fails) or (b) the raw count
 * dropping below allowlist (improvement — the allowlist row should be
 * updated downward in the same landing).
 *
 * Wave 2 (.b.1-.b.6) consumes this gate as their regression detector.
 */

import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  enumerateScrmlCorpus,
  REPO_ROOT,
} from "./parser-conformance/corpus-enumerator.js";

// __dirname in ESM context — bun supports `__dirname` directly in some
// modes but the safe portable shape is `fileURLToPath(import.meta.url)`.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import {
  classifyDivergences,
  subtractAllowlist,
  sumClassCounts,
  emptyClassCounts,
} from "../src/native-parser-canary/within-node-classifier.ts";
import { splitBlocks } from "../src/block-splitter.js";
import { buildAST } from "../src/ast-builder.js";
import { nativeParseFile } from "../native-parser/parse-file.js";
import { populateNativeAttrValueExprNodes } from "../src/native-walker/attrvalue-exprnode-walker.ts";

// ALLOWLIST_PATH — the per-fixture baseline residual map. Land-shape:
//   { "examples/14-mario-state-machine.scrml": { "KIND-NAME": 33, ... }, ... }
const ALLOWLIST_PATH = join(__dirname, "parser-conformance-within-node-allowlist.json");
const ALLOWLIST = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8"));

// CORPUS — the .scrml file enumeration. Shared with the sister canary
// (parser-conformance-corpus.test.js).
const CORPUS = enumerateScrmlCorpus();

// =============================================================================
// runBothPipelines — drive LIVE (splitBlocks + buildAST) and NATIVE
// (nativeParseFile) on one source. Returns the two FileAST results, or
// null on crash (which marks the file as PARSE-FAILURE for the classifier).
// =============================================================================
function runBothPipelines(filePath, source) {
  let live = null;
  let native = null;
  let liveCrashed = false;
  let nativeCrashed = false;
  try {
    const bs = splitBlocks(filePath, source);
    const tab = buildAST(bs, null);
    live = tab.ast;
  } catch (_e) {
    liveCrashed = true;
  }
  try {
    const r = nativeParseFile(filePath, source);
    native = r.ast;
    // Mirror the live PIPELINE: api.js runs populateNativeAttrValueExprNodes on
    // the native FileAST right after nativeParseFile (the live BS+TAB path
    // populates exprNode/argExprNodes INLINE in ast-builder.js parseAttributes).
    // The canary must compare what the pipeline actually feeds codegen, so the
    // pass runs here too. It REDUCES MISSING-FIELD (native now carries the
    // parsed-expr fields it lacked); any residual SPAN-COORD/EXTRA-FIELD is a
    // PRE-EXISTING native value.span / extra-key divergence the classifier now
    // reaches once exprNode is no longer a short-circuiting MISSING-FIELD — the
    // exprNode SUBTREE itself is byte-identical to live (same parseExprToNode +
    // same (raw, span.start) pairing; deep span-diff = 0).
    if (native) populateNativeAttrValueExprNodes(native, filePath, r.errors);
  } catch (_e) {
    nativeCrashed = true;
  }
  return { live, native, liveCrashed, nativeCrashed };
}

// =============================================================================
// CLASSIFY_VERDICTS — run the classifier ONCE per file at module load. The
// per-class counts feed both the per-file gate and the corpus aggregate.
// Total time is ~1.5s across ~1000 files (acceptable module-load cost).
// =============================================================================
const CLASSIFY_VERDICTS = CORPUS.map((row) => {
  const src = readFileSync(row.path, "utf8");
  const { live, native } = runBothPipelines(row.path, src);
  const result = classifyDivergences(live, native);
  return { row, result };
});

// =============================================================================
// Per-fixture gate: each file's residual (raw - allowlist) MUST be zero per
// class. A non-zero residual means a NEW divergence has surfaced — either a
// regression in the native parser OR a class not anticipated in the
// baseline. Either way the suite should fail loud.
// =============================================================================
describe("M6.5.b.0 — within-node parity per-fixture gate", () => {
  for (const { row, result } of CLASSIFY_VERDICTS) {
    const allowlistEntry = ALLOWLIST[row.relpath];
    const residual = subtractAllowlist(result.classCounts, allowlistEntry);
    const residualTotal = Object.values(residual).reduce((a, b) => a + b, 0);
    if (residualTotal === 0) {
      // CLEAN — strict gate passes. No `test` body needed beyond the
      // residual-zero assertion (keeps the per-file noise low; a clean
      // file is a no-op).
      test(`[clean] ${row.relpath}`, () => {
        expect(residualTotal).toBe(0);
      });
    } else {
      // OVER-BUDGET — surface every class that exceeded.
      test(`[over-budget] ${row.relpath} — residual ${residualTotal}`, () => {
        // Build a per-class breakdown for the failure message.
        const breakdown = {};
        for (const klass of Object.keys(residual)) {
          if (residual[klass] > 0) {
            breakdown[klass] = {
              raw: result.classCounts[klass],
              allow: allowlistEntry ? (allowlistEntry[klass] ?? 0) : 0,
              residual: residual[klass],
            };
          }
        }
        // eslint-disable-next-line no-console
        console.warn(
          `[within-node] OVER-BUDGET ${row.relpath}: ` +
          JSON.stringify(breakdown));
        // The strict gate: every residual class must be zero.
        for (const klass of Object.keys(residual)) {
          expect({ file: row.relpath, class: klass, residual: residual[klass] })
            .toEqual({ file: row.relpath, class: klass, residual: 0 });
        }
      });
    }
  }
});

// =============================================================================
// Corpus aggregate: total per-class divergence counts across all fixtures.
// Informational — surfaces the corpus-wide histogram for the wrap report.
// Also catches the case where the allowlist+raw sum drifts (a regression
// in one file balanced by an improvement in another would still fail the
// per-fixture gate, but the aggregate is the holistic signal).
// =============================================================================
describe("M6.5.b.0 — within-node parity corpus aggregate (informational)", () => {
  test("corpus-wide per-class histogram is recorded", () => {
    let totals = emptyClassCounts();
    let parseFailedCount = 0;
    let filesWithDivergences = 0;
    let totalDivergences = 0;
    for (const { result } of CLASSIFY_VERDICTS) {
      totals = sumClassCounts(totals, result.classCounts);
      if (result.parseFailed) {
        parseFailedCount = parseFailedCount + 1;
      }
      const fileTotal = Object.values(result.classCounts).reduce((a, b) => a + b, 0);
      if (fileTotal > 0) {
        filesWithDivergences = filesWithDivergences + 1;
      }
      totalDivergences = totalDivergences + fileTotal;
    }
    // eslint-disable-next-line no-console
    console.warn(
      `[within-node-canary] corpus aggregate: ${CORPUS.length} files, ` +
      `${filesWithDivergences} with divergences, ${totalDivergences} total. ` +
      `Class histogram: ${JSON.stringify(totals)}. ` +
      `PARSE-FAILURE files: ${parseFailedCount}.`);
    // Gate: the loop completed. The per-class numbers are the signal,
    // not a threshold (per-fixture gate above already enforces).
    expect(CLASSIFY_VERDICTS.length).toBe(CORPUS.length);
  });

  test("no fixture is PARSE-FAILURE (both pipelines parse every corpus file)", () => {
    const parseFailed = CLASSIFY_VERDICTS.filter((v) => v.result.parseFailed);
    if (parseFailed.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `[within-node-canary] PARSE-FAILURE files (` + parseFailed.length + `): ` +
        JSON.stringify(parseFailed.slice(0, 10).map((v) => v.row.relpath)));
    }
    // Both pipelines must produce a non-null FileAST on every corpus file.
    // A regression here means one pipeline crashed where it previously
    // succeeded — caught here BEFORE the per-fixture allowlist gate masks
    // the regression as "no divergences" (a crashed pipeline produces no
    // walk and thus no class counts).
    expect(parseFailed.length).toBe(0);
  });
});

// =============================================================================
// Allowlist hygiene — the allowlist file should not contain stale entries
// (files no longer in the corpus). Catches drift between corpus enumeration
// and the baked baseline.
// =============================================================================
describe("M6.5.b.0 — allowlist hygiene", () => {
  test("every allowlist entry corresponds to a corpus file", () => {
    const corpusRelpaths = new Set(CORPUS.map((r) => r.relpath));
    const stale = [];
    for (const relpath of Object.keys(ALLOWLIST)) {
      if (!corpusRelpaths.has(relpath)) {
        stale.push(relpath);
      }
    }
    if (stale.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `[within-node-canary] stale allowlist entries (` + stale.length + `): ` +
        JSON.stringify(stale.slice(0, 20)));
    }
    // Stale entries are a soft signal — they don't fail the suite (a file
    // may have been removed legitimately), but they're surfaced for review.
    // The hard gate is the per-fixture residual check above.
    expect(stale.length).toBeLessThanOrEqual(10);
  });

  test("allowlist file is non-empty (the baseline exists)", () => {
    const entryCount = Object.keys(ALLOWLIST).length;
    expect(entryCount).toBeGreaterThan(0);
  });
});
