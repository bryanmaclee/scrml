/* SPDX-License-Identifier: MIT
 *
 * Unit — S430 P2: parse-layer diagnostics inside an `export`-ed declaration are
 * no longer swallowed.
 *
 * ⚑ THE DEFECT. `export function` / `export fn` / `export server function` bodies
 * are read by the outer export path with collectExpr(), which does not parse
 * statements. The ONLY statement-level parse the body ever gets is the synth
 * re-parse in ast-builder.js (the `_subErrors` site in the export-decl branch),
 * and that site kept just E-FN-EQUALS-BODY and discarded every other diagnostic,
 * on the belief that "the outer parse re-reports them". It did not. So:
 *
 *     function f() { try { g() } catch (e) { h() } }          → E-TRY-NOT-IN-SCRML
 *     export function k() { try { g() } finally { h() } }     → exit 0
 *
 * Governing text: SPEC §34 E-TRY-NOT-IN-SCRML ("scrml has no try/catch/finally …
 * `try` earns a parse-layer rejection") and E-THROW-NOT-IN-SCRML. The fix surfaces
 * EVERY re-parse diagnostic (deduplicated), not a per-code allowlist.
 *
 * ⚑ SPANS. The re-parse runs over the ORIGINAL token slice, so each diagnostic's
 * span already points at the real source line. Pinned below.
 *
 * ⚑ NOT COVERED BY THIS FIX (pre-existing, NOT export-specific): a block-bodied
 * ARROW or FUNCTION EXPRESSION (`const g = () => { … }`, `const g = function() { … }`)
 * is never statement-parsed by the ast-builder at all — its body becomes an
 * escape-hatch expression (expression-parser.ts, ArrowFunctionExpression /
 * FunctionExpression with a BlockStatement body). `try`/`throw` inside one is
 * silent whether or not it is exported. The parity test below pins that the
 * export makes no difference there; the rejection itself is a separate gap.
 */
import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let TMP;
function tmp() {
  TMP = TMP || mkdtempSync(join(tmpdir(), "export-swallow-"));
  return TMP;
}

let n = 0;
function compile(source) {
  const file = join(tmp(), `f${++n}.scrml`);
  writeFileSync(file, source.endsWith("\n") ? source : source + "\n");
  return compileScrml({
    inputFiles: [file], outputDir: join(tmp(), `f${n}.out`),
    write: false, verbose: false, log: () => {},
  });
}
const errs = (r, code) => (r.errors ?? []).filter((e) => e.code === code);
const lineOf = (e) => e.span?.line ?? e.tabSpan?.line;

describe("E-TRY / E-THROW fire inside exported declarations", () => {
  test("export function — try/finally → E-TRY-NOT-IN-SCRML, span on the `try` line", () => {
    const r = compile("${\n  export function k() {\n    try { g() } finally { h() }\n  }\n}");
    const e = errs(r, "E-TRY-NOT-IN-SCRML");
    expect(e.length).toBe(1);
    expect(lineOf(e[0])).toBe(3);
  });

  test("export function — throw → E-THROW-NOT-IN-SCRML, span on the `throw` line", () => {
    const r = compile("${\n  export function k() {\n    const a = 1\n    throw new Error(\"x\")\n  }\n}");
    const e = errs(r, "E-THROW-NOT-IN-SCRML");
    expect(e.length).toBe(1);
    expect(lineOf(e[0])).toBe(4);
  });

  test("export fn — try/catch → E-TRY-NOT-IN-SCRML", () => {
    const r = compile("${\n  export fn k() -> int {\n    try { return 1 } catch (e) { return 2 }\n  }\n}");
    const e = errs(r, "E-TRY-NOT-IN-SCRML");
    expect(e.length).toBe(1);
    expect(lineOf(e[0])).toBe(3);
  });

  test("export server function — throw → E-THROW-NOT-IN-SCRML", () => {
    const r = compile("${\n  export server function k() {\n    throw new Error(\"x\")\n  }\n}");
    expect(errs(r, "E-THROW-NOT-IN-SCRML").length).toBe(1);
  });

  test("export pure fn — throw → E-THROW-NOT-IN-SCRML", () => {
    const r = compile("${\n  export pure fn k() {\n    throw new Error(\"x\")\n  }\n}");
    expect(errs(r, "E-THROW-NOT-IN-SCRML").length).toBe(1);
  });

  test("a function NESTED inside an export function — throw → E-THROW-NOT-IN-SCRML on the inner line", () => {
    const r = compile(
      "${\n  export function outer() {\n    function inner() {\n      throw new Error(\"x\")\n    }\n    return inner\n  }\n}",
    );
    const e = errs(r, "E-THROW-NOT-IN-SCRML");
    expect(e.length).toBe(1);
    expect(lineOf(e[0])).toBe(4);
  });

  test("the SAME source un-exported reports the SAME diagnostics (no double-emit on either side)", () => {
    const body = "k() {\n    try { g() } catch (e) { h() }\n    throw new Error(\"x\")\n  }\n}";
    const plain = compile("${\n  function " + body);
    const exported = compile("${\n  export function " + body);
    for (const code of ["E-TRY-NOT-IN-SCRML", "E-THROW-NOT-IN-SCRML"]) {
      expect(errs(exported, code).length).toBe(1);
      expect(errs(exported, code).length).toBe(errs(plain, code).length);
      expect(errs(exported, code).map(lineOf)).toEqual(errs(plain, code).map(lineOf));
    }
  });
});

describe("other parse-layer diagnostics surface too — the fix is not a per-code allowlist", () => {
  test("export function — `while (n + 1) < 4` → E-CONDITION-HEAD-UNPARENTHESIZED", () => {
    const r = compile(
      "${\n  export function g() {\n    let n = 0\n    while (n + 1) < 4 { n = n + 1 }\n    return n\n  }\n}",
    );
    const e = errs(r, "E-CONDITION-HEAD-UNPARENTHESIZED");
    expect(e.length).toBe(1);
    expect(lineOf(e[0])).toBe(4);
  });

  test("E-FN-EQUALS-BODY still fires for `export fn NAME() = <expr>` — exactly once", () => {
    const r = compile("${\n  export fn k() = 1 + 2\n}");
    expect(errs(r, "E-FN-EQUALS-BODY").length).toBe(1);
  });
});

describe("legal exported functions stay clean", () => {
  test("export function with ordinary control flow — no parse-layer errors", () => {
    const r = compile(
      "${\n  export function g(xs) {\n    let n = 0\n    for (const x of xs) { if (x > 1) { n = n + x } }\n    while (n > 100) { n = n - 1 }\n    return n\n  }\n}",
    );
    expect((r.errors ?? []).map((e) => e.code)).toEqual([]);
  });
});

describe("block-bodied arrow / function expressions — export makes no difference (pre-existing gap)", () => {
  test("`export const g = () => { try … }` reports exactly what `const g = () => { try … }` reports", () => {
    const body = "g = () => {\n    try { a() } catch (e) { b() }\n  }\n}";
    const plain = compile("${\n  const " + body);
    const exported = compile("${\n  export const " + body);
    const c = (r) => (r.errors ?? []).map((e) => e.code).sort();
    expect(c(exported)).toEqual(c(plain));
  });

  // The rejection itself: a block-bodied arrow / function expression is an
  // escape-hatch expression that no statement walker visits. Separate gap.
  test.todo("E-TRY-NOT-IN-SCRML fires inside a block-bodied arrow / function expression");
});
