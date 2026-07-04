// ---------------------------------------------------------------------------
// g-fn-shortform-arrow-callback-invalid-js — E-FN-ARROW-BODY parse-time reject
// (change-id g-fn-shortform-arrow-reject-2026-06-30)
// ---------------------------------------------------------------------------
//
// RULING (PA lean A, ratified). `fn(args) => expr` — the `fn` keyword followed
// by a parenthesized param list and an ARROW `=>` body — is NOT a sanctioned
// scrml form. It mixes the two canonical anonymous-callable shapes:
//   - the BLOCK-body anonymous `fn`:  `fn(args) { return expr }`  (SPEC §48.2.1)
//   - the plain inline lambda:        `args => expr`
//
// THE BUG. `const d = arr.map(fn(n) => n * 2)` used to compile to invalid JS
// `arr.map(function(n) => n * 2)` (the codegen `rewriteFnKeyword` does a blind
// `\bfn\b`->`function` text replace), surfaced as E-CODEGEN-INVALID-LOGIC — the
// "compiler defect" framing that MIS-ATTRIBUTES an author error to a compiler
// bug. The fix recognises the shape at the PARSE layer (the acorn-rejection path
// in expression-parser.ts `detectFnKeywordArrowBody`, surfaced by ast-builder.js
// mirroring the `exponentDiagnostic` precedent) and emits a clean
// E-FN-ARROW-BODY that steers to the two valid forms.

import { describe, test, expect } from "bun:test";
import { writeFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { compileScrml } from "../../src/api.js";

const TMP = mkdtempSync(join(tmpdir(), "fn-arrow-reject-"));
let _seq = 0;
function compile(src) {
  const p = join(TMP, `t-${_seq++}.scrml`);
  writeFileSync(p, src);
  return compileScrml({ inputFiles: [p], write: false, outputDir: join(TMP, "out") });
}
function codes(r) {
  return (r.errors ?? []).map(e => e.code).filter(Boolean);
}
function msgOf(r, code) {
  return (r.errors ?? []).find(e => e.code === code)?.message ?? "";
}

// `${` is written literally in a normal (non-template) JS string — no escaping.
const WRAP = (body) =>
  "<program>\n${\n" + body + "\n}\n<button onclick=doit()>go</button>\n</program>";

describe("E-FN-ARROW-BODY — the invalid `fn(args) => expr` form", () => {
  test("repro: `arr.map(fn(n) => n * 2)` fires E-FN-ARROW-BODY, NOT E-CODEGEN-INVALID-LOGIC", () => {
    const r = compile(WRAP(
      "function doit() {\n  const arr = [1,2,3]\n  const d = arr.map(fn(n) => n * 2)\n  return { d: d }\n}",
    ));
    const c = codes(r);
    expect(c).toContain("E-FN-ARROW-BODY");
    // The whole point of the fix: the misleading "compiler defect" code is gone.
    expect(c).not.toContain("E-CODEGEN-INVALID-LOGIC");
  });

  test("the steering message names BOTH canonical forms", () => {
    const r = compile(WRAP(
      "function doit() {\n  const arr = [1,2,3]\n  const d = arr.map(fn(n) => n * 2)\n  return { d: d }\n}",
    ));
    const m = msgOf(r, "E-FN-ARROW-BODY");
    expect(m).toContain("args => expr");          // the inline-lambda steer
    expect(m).toContain("fn(args) { return expr }"); // the block-body anon-fn steer
  });

  test("multi-param `fn(x, y) => x + y` (call-arg position) fires", () => {
    const r = compile(WRAP(
      "function doit() {\n  const reduce2 = [[1,2]].map(fn(x, y) => x + y)\n  return { r: reduce2 }\n}",
    ));
    expect(codes(r)).toContain("E-FN-ARROW-BODY");
  });

  test("zero-param `fn() => 1` (call-arg position) fires", () => {
    const r = compile(WRAP(
      "function doit() {\n  const xs = [0].map(fn() => 1)\n  return { xs: xs }\n}",
    ));
    expect(codes(r)).toContain("E-FN-ARROW-BODY");
  });

  test("spaced/tokenized `fn ( n ) => n` still fires (whitespace-robust)", () => {
    const r = compile(WRAP(
      "function doit() {\n  const ys = [1].map(fn ( n ) => n)\n  return { ys: ys }\n}",
    ));
    expect(codes(r)).toContain("E-FN-ARROW-BODY");
  });
});

describe("E-FN-ARROW-BODY — no false-fire on the valid siblings", () => {
  test("brace-body anonymous fn `fn(x, y) { return x + y }` does NOT fire (§48.2.1)", () => {
    // Parses as a call `fn(x, y)` (acorn does not reject) so the detector never
    // runs. Synthetic `${}`-nested shape carries unrelated pre-existing
    // diagnostics; we only assert the new code does NOT fire.
    const r = compile(WRAP(
      "function doit() {\n  const make = fn(x, y) { return x + y }\n  return { r: make(1, 2) }\n}",
    ));
    expect(codes(r)).not.toContain("E-FN-ARROW-BODY");
  });

  test("plain arrow `n => n * 2` compiles clean (no E-FN-ARROW-BODY)", () => {
    const r = compile(WRAP(
      "function doit() {\n  const arr = [1,2,3]\n  const d = arr.map(n => n * 2)\n  return { d: d }\n}",
    ));
    expect(codes(r)).not.toContain("E-FN-ARROW-BODY");
    expect(codes(r).filter(c => !String(c).startsWith("W-"))).toEqual([]);
  });

  test("paren arrow `(x) => x * 2` compiles clean (no E-FN-ARROW-BODY)", () => {
    const r = compile(WRAP(
      "function doit() {\n  const arr = [1,2,3]\n  const d = arr.map((x) => x * 2)\n  return { d: d }\n}",
    ));
    expect(codes(r)).not.toContain("E-FN-ARROW-BODY");
    expect(codes(r).filter(c => !String(c).startsWith("W-"))).toEqual([]);
  });

  test("identifier containing `fn` (`fnButton`) does NOT fire", () => {
    const r = compile(WRAP(
      "function doit() {\n  const fnButton = 5\n  return { r: fnButton + 1 }\n}",
    ));
    expect(codes(r)).not.toContain("E-FN-ARROW-BODY");
  });

  test("string literal `\"fn(x)=>\"` does NOT fire (acorn parses the string)", () => {
    const r = compile(WRAP(
      "function doit() {\n  const s = \"fn(x)=>\"\n  return { s: s }\n}",
    ));
    expect(codes(r)).not.toContain("E-FN-ARROW-BODY");
  });

  test("member call `obj.fn(z)` (the `fn` property, not the keyword) does NOT fire", () => {
    const r = compile(WRAP(
      "function doit() {\n  const obj = { fn: (z) => z }\n  return { r: obj.fn(2) }\n}",
    ));
    expect(codes(r)).not.toContain("E-FN-ARROW-BODY");
  });
});
