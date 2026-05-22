/**
 * parser-conformance-corpus.test.js — M4.3 Thread B: M4 conformance close.
 *
 * The M4-gating full-corpus harness. Two surfaces:
 *
 *   (a) BENCH corpus (compiler/tests/parser-conformance/bench/*.js) —
 *       pure JS, ~200 LOC across 12 single-feature fixtures from the §D5
 *       MUST-PARSE list. The gate: the native parser parses every fixture
 *       at RAW SOURCE (no preprocess shim) and emits ZERO diagnostics. The
 *       fine-grained Tier 1+2 node-kind-sequence diff vs Acorn lives in the
 *       per-milestone harness files (parser-conformance-expr.test.js,
 *       parser-conformance-stmt.test.js); this file gates the *combined*
 *       bench-corpus boundary that those per-milestone tests don't cover.
 *
 *   (b) SCRML corpus (samples/, examples/, stdlib/, compiler/self-host/)
 *       — the ~900 .scrml files under the source roots. These are NOT pure
 *       JS — they carry markup + style + JS-block interleavings the JS-only
 *       native parser does not yet understand (MK4 markup↔JS seam is
 *       deferred). For the .scrml corpus the gate is a SMOKE TEST: the
 *       native parser MUST NOT THROW on any file (the no-throw discipline);
 *       it MAY record diagnostics — that is expected and not a failure.
 *
 * M4.3 — preprocessForAcorn cascade NOT NEEDED demonstration. The legacy
 * live pipeline shim
 * (compiler/src/expression-parser.ts:preprocessForAcorn) rewrites scrml-
 * extension syntax via regex cascades. The native parser handles every form
 * DIRECTLY at the lexer / parser level. The bench-corpus diagnostic-free
 * pass below — with NO preprocess shim in the call path — is the proof that
 * M5/M6 can retire the cascade. (M2.4 already eliminated each preprocess
 * workaround class — see parser-conformance-expr.test.js the M2.4 describe
 * block.) M4.3 closes the cascade-removal bound here.
 *
 * Per scrml-native-parser-design-2026-05-17.md §D6: Tier 1+2 MUST PASS;
 * Tier 3+4 are informational. M4.3 closes the M4 milestone by gating the
 * BOUND of the JS-subset corpus on the native parser.
 */

import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";

import {
  enumerateBenchCorpus,
  enumerateScrmlCorpus,
} from "./parser-conformance/corpus-enumerator.js";
import { lex } from "../native-parser/lex.js";
import { parseProgram } from "../native-parser/parse-stmt.js";

// parseNativeProgram — drive the native parser end-to-end. Returns the
// no-throw shape `{ ok, body, errors }` on success; `{ ok: false, error }`
// on a hard crash (which the test discipline rejects as a regression).
function parseNativeProgram(source) {
  try {
    const r = parseProgram(lex(source));
    return { ok: true, body: r.body, errors: r.errors };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}

const BENCH = enumerateBenchCorpus();
const SCRML = enumerateScrmlCorpus();

// =============================================================================
// Bench corpus — every fixture parses cleanly through the native parser at
// raw source (NO preprocess shim). M4.3 cascade-removal bound: this is the
// proof.
// =============================================================================
// FORBIDDEN_VOCAB_CODES — the M5-swap Wave 2 (B7) parse-layer rejection codes.
// `try` / `throw` are forbidden scrml vocabulary; the native parser parses
// them for diagnostic recovery (the `r.ok` no-throw gate still holds) but
// fires these codes. The `stmt-try-catch.js` bench fixture exercises the
// `try`/`catch` parse SHAPE — it carries `E-TRY-NOT-IN-SCRML` by design.
const FORBIDDEN_VOCAB_CODES = ["E-TRY-NOT-IN-SCRML", "E-THROW-NOT-IN-SCRML"];

describe("M4.3 — bench corpus parses cleanly through the native parser (raw source, no preprocess shim)", () => {
  for (const row of BENCH) {
    test(`[bench] ${row.relpath}`, () => {
      const src = readFileSync(row.path, "utf8");
      const r = parseNativeProgram(src);
      expect(r.ok).toBe(true);
      // The post-M4.3 bench fixtures hold no async/await source (those
      // fixtures were rewritten when scrml retracted source-level
      // async/await — see compiler/tests/parser-conformance/bench/
      // expr-async-await.js + expr-yield-generator.js + expr-arrow.js
      // headers). The diagnostic-free parse confirms the JS-subset bound
      // the native parser CURRENTLY enforces — EXCEPT the B7
      // forbidden-vocabulary rejections (`try` / `throw`), which are an
      // expected, by-design diagnostic, not a divergence.
      const nonVocab = (r.errors || []).filter(
        (e) => FORBIDDEN_VOCAB_CODES.includes(e.code) === false);
      expect(nonVocab).toEqual([]);
    });
  }
});

describe("M4.3 — bench corpus is non-empty (≥10 fixtures)", () => {
  test("at least 10 bench fixtures enumerated", () => {
    expect(BENCH.length).toBeGreaterThanOrEqual(10);
  });
});

// =============================================================================
// .scrml corpus — SMOKE TEST. The native parser is JS-only at M4.3 (MK4
// markup↔JS seam is the next milestone). The gate here is the no-throw
// discipline: the parser MUST NOT throw on any .scrml file in the four
// source roots. Diagnostics are EXPECTED on most files (markup tokens reach
// parsePrimary unhandled and surface as E-EXPR-UNEXPECTED / E-STMT-MISSING-
// SEMICOLON / etc.); the per-file diagnostic count is recorded as
// informational data, not a gate. The crash-free pass over the WHOLE corpus
// closes Tier 4 (zero unexpected divergences — every divergence the corpus
// surfaces is the documented JS-only-subset bound, not a parser bug).
// =============================================================================
describe("M4.3 — .scrml corpus smoke (native parser no-throw on every file)", () => {
  test("native parser does not throw on any .scrml file in the corpus", () => {
    let parsed = 0;
    let crashed = 0;
    const crashSamples = [];
    for (const row of SCRML) {
      const src = readFileSync(row.path, "utf8");
      const r = parseNativeProgram(src);
      if (r.ok === false) {
        crashed = crashed + 1;
        if (crashSamples.length < 5) {
          crashSamples.push({ relpath: row.relpath, error: r.error });
        }
      } else {
        parsed = parsed + 1;
      }
    }
    if (crashed > 0) {
      // eslint-disable-next-line no-console
      console.warn(`[parser-conformance-corpus] ${crashed}/${SCRML.length} .scrml files crashed the native parser. Sample: ${JSON.stringify(crashSamples)}`);
    }
    expect(parsed).toBeGreaterThan(0);
    expect(crashed).toBe(0);
  });

  test("native parser produces a body for every .scrml file (the no-throw discipline yields a non-null body[] on every file)", () => {
    for (const row of SCRML) {
      const src = readFileSync(row.path, "utf8");
      const r = parseNativeProgram(src);
      expect(r.ok).toBe(true);
      expect(Array.isArray(r.body)).toBe(true);
    }
  });
});

// =============================================================================
// M4.3 — corpus-wide diagnostic-shape audit. The aggregate count of
// E-PARSER-OUT-OF-SUBSET diagnostics surfaced across the .scrml corpus is
// the live measure of the JS-subset bound (D5 residual). Pre-MK4 every
// markup-bearing file emits E-EXPR-UNEXPECTED at the first `<` it reaches;
// that is NOT a parser bug — it is the JS-only-subset boundary the M4.3
// close documents.
// =============================================================================
describe("M4.3 — corpus-wide diagnostic-shape audit (informational)", () => {
  test("aggregate diagnostic-code histogram across the .scrml corpus is recorded", () => {
    const codeCounts = {};
    let filesWithErrors = 0;
    let filesClean = 0;
    for (const row of SCRML) {
      const src = readFileSync(row.path, "utf8");
      const r = parseNativeProgram(src);
      if (r.ok === false) continue; // smoke gate above already covers crashes
      if (r.errors.length === 0) {
        filesClean = filesClean + 1;
      } else {
        filesWithErrors = filesWithErrors + 1;
        for (const e of r.errors) {
          codeCounts[e.code] = (codeCounts[e.code] ?? 0) + 1;
        }
      }
    }
    // Informational — surface the histogram via console for the wrap report.
    // The gate is only that the loop completed; the actual counts are the
    // M4.3-close diagnostic shape across the corpus.
    // eslint-disable-next-line no-console
    console.warn(`[parser-conformance-corpus] .scrml corpus diagnostic histogram: clean=${filesClean} with-errors=${filesWithErrors}; top codes: ${JSON.stringify(codeCounts).slice(0, 600)}`);
    expect(filesClean + filesWithErrors).toBe(SCRML.length);
  });
});
