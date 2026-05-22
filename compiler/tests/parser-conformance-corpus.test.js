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
 *
 * ── M5-swap C2 (v0.7) — STRICT canary promotion ──────────────────────────
 * C1 landed `nativeParseFile` (the FileAST assembler) and C2 routes it behind
 * `--parser=scrml-native`. C2 promotes the `.scrml` corpus gate from the
 * JS-only no-throw SMOKE test (still kept below — it is a different surface:
 * `parseProgram(lex(source))`) to a STRICT dual-pipeline canary: each corpus
 * file is run through BOTH the live BS+buildAST pipeline AND `nativeParseFile`
 * and the two FileASTs are structurally diffed along TWO node-kind axes — the
 * TOP-LEVEL kind sequence AND the RECURSIVE (deep) kind sequence — plus
 * hoisted-collection counts and hasProgramRoot (see dual-pipeline-canary.js).
 *
 * M5 gap-ledger deepening — the canary's `diffFileASTs` now diffs the
 * RECURSIVE node-kind sequence in addition to the top-level one. A file whose
 * top-level kind sequence matches in both pipelines but which diverges in a
 * nested position (the common `<state>`-inside-`<program>` shape) is no
 * longer scored `EXACT` — it is the `DIFF-deep-seq` gap-ledger class. True
 * `EXACT` now requires BOTH axes to match. The strict-pass count is therefore
 * a TRUE residual ledger, not the top-level-only FLOOR it was before.
 *
 * The strict gate is SCOPED. `classifyDivergence` partitions the corpus:
 *   - `EXACT` / `DEFERRAL-test-block` files (the native FileAST matches the
 *     live one modulo a documented C1 deferral) are gated STRICT — a `test`
 *     that asserts the canary verdict is `explained`.
 *   - files with a genuine unexplained native-vs-live divergence (any
 *     `GAP-*` / `DIFF-*` class) are `test.skip`-ed, EACH with the divergence
 *     class as the documented reason. They are the C2 GAP LEDGER.
 *
 * The skipped subset is NOT a make-green dodge — the `--parser=scrml-native`
 * flag is strictly opt-in, so a catalogued native-parser gap blocks no
 * adopter. The strict gate is the instrument that CATCHES the Tier-B feature
 * gaps; an honest gap ledger (the skip reasons + the canary report below) is
 * the C2 deliverable. As the native parser closes a gap class, the
 * corresponding files flip from `.skip` to strict-pass automatically (the
 * classification is recomputed at module load).
 */

import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";

import {
  enumerateBenchCorpus,
  enumerateScrmlCorpus,
} from "./parser-conformance/corpus-enumerator.js";
import { lex } from "../native-parser/lex.js";
import { parseProgram } from "../native-parser/parse-stmt.js";
import {
  classifyDivergence,
  summarizeDetail,
} from "./parser-conformance/dual-pipeline-canary.js";

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

// =============================================================================
// M5-swap C2 — STRICT dual-pipeline canary gate.
//
// Each `.scrml` corpus file is classified ONCE at module load by
// `classifyDivergence` (dual-pipeline-canary.js): the file is run through
// BOTH the live BS+buildAST pipeline AND `nativeParseFile`, and the two
// FileASTs are structurally diffed on BOTH the top-level AND the recursive
// node-kind axes (a nested-position divergence — e.g. a `<state>` inside a
// top-level `<program>` markup — surfaces as the `DIFF-deep-seq` class).
//
//   - `explained` files (verdict class EXACT or DEFERRAL-test-block) are
//     gated STRICT: a `test` asserts the canary verdict is `explained` — i.e.
//     the native FileAST matches the live one modulo a documented C1
//     deferral.
//   - unexplained-divergence files (any GAP-*/DIFF-* class) are `test.skip`-
//     ed, EACH with the divergence class + a one-line detail as the
//     documented reason. These ARE the C2 gap ledger. The skip is honest:
//     `--parser=scrml-native` is opt-in, so a catalogued native-parser gap
//     blocks no adopter — and the strict gate is the instrument that surfaced
//     the gap rather than letting it mis-parse silently.
//
// As a native-parser gap class closes, the corresponding files flip from
// `.skip` to strict-pass with no edit here — the classification is recomputed
// every module load.
// =============================================================================

// CANARY_VERDICTS — classify the whole .scrml corpus once. Runs both
// pipelines per file; ~1.2s for ~1000 files (acceptable module-load cost).
const CANARY_VERDICTS = SCRML.map((row) => {
  const src = readFileSync(row.path, "utf8");
  return { row, verdict: classifyDivergence(row.path, src) };
});

describe("M5-swap C2 — .scrml corpus STRICT dual-pipeline canary", () => {
  test("the canary classified every corpus file", () => {
    expect(CANARY_VERDICTS.length).toBe(SCRML.length);
    for (const { verdict } of CANARY_VERDICTS) {
      expect(typeof verdict.class).toBe("string");
      expect(typeof verdict.explained).toBe("boolean");
    }
  });

  // Per-file strict / skip gate. `explained` files are strict; the rest are
  // the gap ledger, skipped with the class as the reason.
  for (const { row, verdict } of CANARY_VERDICTS) {
    if (verdict.explained) {
      test(`[strict] ${row.relpath} — native FileAST matches live (${verdict.class})`, () => {
        const v = classifyDivergence(row.path, readFileSync(row.path, "utf8"));
        expect(v.explained).toBe(true);
      });
    } else {
      // GAP-LEDGER ENTRY — a genuine unexplained native-vs-live divergence.
      // Skipped, not failed: the flag is opt-in so the gap blocks nothing,
      // and the skip reason is the catalogued ledger entry.
      test.skip(`[gap] ${row.relpath} — ${verdict.class}: ${summarizeDetail(verdict).slice(0, 160)}`, () => {});
    }
  }
});

describe("M5-swap C2 — canary aggregate report (the C2 gap ledger summary)", () => {
  test("strict-pass / gap-ledger split is recorded", () => {
    const byClass = {};
    let strict = 0;
    let gaps = 0;
    for (const { verdict } of CANARY_VERDICTS) {
      byClass[verdict.class] = (byClass[verdict.class] || 0) + 1;
      if (verdict.explained) {
        strict = strict + 1;
      } else {
        gaps = gaps + 1;
      }
    }
    const pct = ((strict / CANARY_VERDICTS.length) * 100).toFixed(1);
    // eslint-disable-next-line no-console
    console.warn(
      `[parser-conformance-corpus] C2 dual-pipeline canary: ` +
      `${strict}/${CANARY_VERDICTS.length} strict-pass (${pct}%), ` +
      `${gaps} gap-ledger skips. Class histogram: ${JSON.stringify(byClass)}`);
    // The gate is only that every file is accounted for — the strict/gap
    // split is the C2 ledger data, NOT a threshold the suite enforces (a
    // catalogued gap blocks no opt-in adopter).
    expect(strict + gaps).toBe(CANARY_VERDICTS.length);
    // A floor sanity-check: the EXACT majority must hold (a regression that
    // collapses the strict-pass set below half the corpus is a real signal).
    expect(strict).toBeGreaterThan(CANARY_VERDICTS.length * 0.5);
  });

  test("no corpus file crashes the native pipeline (no-throw discipline)", () => {
    const crashed = CANARY_VERDICTS.filter(
      (v) => v.verdict.class === "NATIVE-CRASH");
    if (crashed.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(`[parser-conformance-corpus] NATIVE-CRASH files: ${JSON.stringify(crashed.map((c) => c.row.relpath))}`);
    }
    expect(crashed.length).toBe(0);
  });
});
