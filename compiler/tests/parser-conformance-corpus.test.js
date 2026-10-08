/**
 * parser-conformance-corpus.test.js — native-parser robustness over real inputs.
 *
 * compiler/native-parser is a FROZEN component of impl#1 (S449 item 6). impl#1
 * calls it in production: `nativeParseFile` re-parses component bodies
 * (component-expander.ts), `^{}` meta emit (meta-eval.ts) and `<match>` arm
 * markup (emit-match.ts / emit-engine.ts); `parseProgram(lex(…))` drives the
 * `defer` / `yield` lint (validators/defer-structure.ts) and the
 * E-CLASS / E-DYNAMIC-IMPORT rejection (native-walker/forbidden-js-native.ts).
 * This file holds the corpus-wide guarantees those call sites rely on:
 *
 *   (a) BENCH corpus (compiler/tests/parser-conformance/bench/*.js) — 12
 *       single-feature pure-JS fixtures. `parseProgram(lex(src))` parses each
 *       at raw source and emits no diagnostic except the by-design
 *       forbidden-vocabulary rejections.
 *
 *   (b) SCRML corpus (samples/, examples/, stdlib/, compiler/self-host-v2/) —
 *       ~900 real `.scrml` files. Neither entry point may THROW on any of them
 *       (the no-throw discipline the production call sites assume: a throw
 *       inside component re-parse surfaces as E-COMPONENT-021, inside the
 *       forbidden-JS pass as a silent fallback). Diagnostics are expected and
 *       are not a failure here.
 *
 * S449 — what was removed: the M5-swap C2 "STRICT dual-pipeline canary" (each
 * corpus file parsed by BOTH the default pipeline and `nativeParseFile`, the
 * two FileASTs diffed, unexplained divergences `test.skip`-ped as a gap
 * ledger), its aggregate report, and an informational diagnostic histogram.
 * That record measured drift for the M6 migration, which S249 stopped and
 * S449 retired; under the frozen-impl#1 rule a divergence is filed, not fixed,
 * so the record had no consumer. The no-throw guarantee the canary also
 * carried ("no corpus file crashes the native pipeline") is kept below,
 * asserted on `nativeParseFile` directly.
 */

import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";

import {
  enumerateBenchCorpus,
  enumerateScrmlCorpus,
} from "./parser-conformance/corpus-enumerator.js";
import { lex } from "../native-parser/lex.js";
import { parseProgram } from "../native-parser/parse-stmt.js";
import { nativeParseFile } from "../native-parser/parse-file.js";

// parseNativeProgram — drive the native statement parser end-to-end. Returns
// the no-throw shape `{ ok, body, errors }` on success; `{ ok: false, error }`
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

// FORBIDDEN_VOCAB_CODES — the parse-layer rejection codes for forbidden scrml
// vocabulary. The native parser parses `try` / `throw` / `class` / `import()`
// for diagnostic recovery (the no-throw gate still holds) but fires these
// codes. The `stmt-try-catch.js`, `decl-class.js` and `stmt-import-export.js`
// bench fixtures exercise those parse SHAPES, so they carry the codes by design.
const FORBIDDEN_VOCAB_CODES = [
  "E-TRY-NOT-IN-SCRML", "E-THROW-NOT-IN-SCRML",
  "E-CLASS-NOT-IN-SCRML", "E-DYNAMIC-IMPORT-NOT-IN-SCRML",
];

describe("bench corpus parses cleanly through the native statement parser (raw source)", () => {
  for (const row of BENCH) {
    test(`[bench] ${row.relpath}`, () => {
      const src = readFileSync(row.path, "utf8");
      const r = parseNativeProgram(src);
      expect(r.ok).toBe(true);
      const nonVocab = (r.errors || []).filter(
        (e) => FORBIDDEN_VOCAB_CODES.includes(e.code) === false);
      expect(nonVocab).toEqual([]);
    });
  }
});

describe("bench corpus is non-empty (≥10 fixtures)", () => {
  test("at least 10 bench fixtures enumerated", () => {
    expect(BENCH.length).toBeGreaterThanOrEqual(10);
  });
});

describe(".scrml corpus — native statement parser no-throw on every file", () => {
  test("parseProgram(lex(…)) does not throw on any .scrml file in the corpus", () => {
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
        expect(Array.isArray(r.body)).toBe(true);
      }
    }
    if (crashed > 0) {
      // eslint-disable-next-line no-console
      console.warn(`[parser-conformance-corpus] ${crashed}/${SCRML.length} .scrml files crashed the native statement parser. Sample: ${JSON.stringify(crashSamples)}`);
    }
    expect(parsed).toBeGreaterThan(0);
    expect(crashed).toBe(0);
  });
});

describe(".scrml corpus — nativeParseFile no-throw on every file", () => {
  test("nativeParseFile returns { ast, errors } and does not throw on any .scrml file in the corpus", () => {
    const crashed = [];
    let assembled = 0;
    for (const row of SCRML) {
      const src = readFileSync(row.path, "utf8");
      try {
        const r = nativeParseFile(row.path, src);
        expect(r && typeof r === "object").toBe(true);
        expect(Array.isArray(r.ast?.nodes)).toBe(true);
        expect(Array.isArray(r.errors)).toBe(true);
        assembled = assembled + 1;
      } catch (e) {
        crashed.push({ relpath: row.relpath, error: e && e.message ? e.message : String(e) });
      }
    }
    if (crashed.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(`[parser-conformance-corpus] nativeParseFile crashed on: ${JSON.stringify(crashed.slice(0, 5))}`);
    }
    expect(assembled).toBeGreaterThan(0);
    expect(crashed).toEqual([]);
  });
});
