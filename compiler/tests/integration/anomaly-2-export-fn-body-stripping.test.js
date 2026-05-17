/**
 * Anomaly 2 (S99) — `export function|fn` body stripped in compiled client JS.
 *
 * Filed: 2026-05-17 (S98 M1.1 native-parser dispatch surfaced the bug while
 * implementing the lexer in scrml; M1.1 had to ship 1:1 `.js` shadow files
 * alongside each `.scrml` because the compiled `.client.js` had empty
 * function bodies).
 *
 * Symptom (before fix): the AST builder's `export function|fn` synth path
 * (ast-builder.js ~6457) produced a `function-decl` stub with
 * `params: []` and `body: []`. The design intent was that
 * emit-library.ts's primary source-text-slice path would emit the raw
 * export-decl source verbatim — which is correct for stdlib bundling but
 * fails for the SPA-shape client emit path. emit-functions.ts Step 3
 * compiles the function-decl into JS using `params + body`, so empty
 * params + empty body produce `function _scrml_NAME_N() {}` in `.client.js`.
 *
 * Reproducer pre-fix:
 *   ${ export function makeSpan(a,b) { return {a,b} } } <program/>
 *   compiles to `function _scrml_makeSpan_1() {}` (empty body — broken).
 *
 * Fix (ast-builder.js): re-parse the original source-text slice for
 * `export function|fn` shapes (via parentBlock.raw + absolute token spans
 * + `parseLogicBody` recursion) so the synth function-decl carries the
 * real params + body. `fromExport: true` remains so emit-library.ts
 * continues to skip these stubs (it has its own canonical source-slice
 * emit path for stdlib bundles).
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let TMP;

beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), "anomaly-2-export-fn-"));
});

afterAll(() => {
  if (TMP) rmSync(TMP, { recursive: true, force: true });
});

function compileSource(name, source) {
  const filePath = join(TMP, `${name}.scrml`);
  writeFileSync(filePath, source);
  const outDir = join(TMP, `${name}.dist`);
  const result = compileScrml({
    inputFiles: [filePath],
    outputDir: outDir,
    write: true,
    log: () => {},
  });
  const errors = (result.errors || []).filter(
    e => e.severity == null || e.severity === "error",
  );
  let clientJs = "";
  try { clientJs = readFileSync(join(outDir, `${name}.client.js`), "utf8"); } catch { /* missing */ }
  return { errors, clientJs };
}

describe("Anomaly 2: `export function|fn` body must not be stripped in client.js", () => {
  test("export function with single-statement body — body present in client.js", () => {
    const src = `\${
  export function makeSpan(start, end, line, col) {
    return { start, end, line, col }
  }
}

<program></program>`;
    const { errors, clientJs } = compileSource("export-fn-simple", src);
    const fatal = errors.filter(e => e.code !== "W-PROGRAM-SPA-INFERRED");
    // No compilation errors should be introduced by a plain pure-JS body.
    expect(fatal).toEqual([]);

    // Primary regression: the compiled function MUST have a non-empty body.
    // Match the canonical mangled name pattern (digit suffix may vary).
    expect(clientJs).toMatch(/function _scrml_makeSpan_\d+\(start, end, line, col\)/);
    // The function body MUST contain the return + object literal — NOT an
    // empty `{}`. We check for the presence of the field names in the body.
    expect(clientJs).toMatch(/return \{\s*start,\s*end,\s*line,\s*col\s*\}/);
    // The pre-fix bug would emit `function _scrml_makeSpan_N() {}` (empty
    // params AND empty body). Verify the explicit empty-body shape is absent.
    expect(clientJs).not.toMatch(/function _scrml_makeSpan_\d+\(\)\s*\{\s*\}/);
  });

  test("export function with multi-statement body — all statements present", () => {
    const src = `\${
  export function compute(a, b) {
    const sum = a + b
    const product = a * b
    return { sum, product }
  }
}

<program></program>`;
    const { errors, clientJs } = compileSource("export-fn-multi-stmt", src);
    const fatal = errors.filter(e => e.code !== "W-PROGRAM-SPA-INFERRED");
    expect(fatal).toEqual([]);

    expect(clientJs).toMatch(/function _scrml_compute_\d+\(a, b\)/);
    // Both const decls must reach the output (as JS lets/consts — the exact
    // emission keyword depends on the CG path).
    expect(clientJs).toMatch(/sum/);
    expect(clientJs).toMatch(/product/);
    // Return must reach output.
    expect(clientJs).toMatch(/return \{\s*sum,\s*product\s*\}/);
  });

  test("export fn shorthand — body present in client.js", () => {
    const src = `\${
  export fn double(n) { n * 2 }
}

<program></program>`;
    const { errors, clientJs } = compileSource("export-fn-shorthand", src);
    const fatal = errors.filter(e => e.code !== "W-PROGRAM-SPA-INFERRED");
    expect(fatal).toEqual([]);

    expect(clientJs).toMatch(/function _scrml_double_\d+\(n\)/);
    // `fn` shorthand uses implicit-return tail-expression — body must
    // produce `return n * 2` (or an equivalent multiplication form).
    expect(clientJs).toMatch(/return.*n.*\*.*2/);
  });

  test("multiple sibling export functions — each independently has populated body", () => {
    // Reproduces the M1.1 native-parser/span.scrml pattern (3 exports).
    const src = `\${
  export function makeSpan(s, e) { return { s, e } }
  export function depth(p) { return p + 1 }
  export function isBalanced(stack) { return stack.length == 0 }
}

<program></program>`;
    const { errors, clientJs } = compileSource("export-fn-multi-sibling", src);
    const fatal = errors.filter(e => e.code !== "W-PROGRAM-SPA-INFERRED");
    expect(fatal).toEqual([]);

    // All three must have non-empty params and non-empty bodies.
    expect(clientJs).toMatch(/function _scrml_makeSpan_\d+\(s, e\)/);
    expect(clientJs).toMatch(/function _scrml_depth_\d+\(p\)/);
    expect(clientJs).toMatch(/function _scrml_isBalanced_\d+\(stack\)/);
    expect(clientJs).not.toMatch(/function _scrml_makeSpan_\d+\(\)\s*\{\s*\}/);
    expect(clientJs).not.toMatch(/function _scrml_depth_\d+\(\)\s*\{\s*\}/);
    expect(clientJs).not.toMatch(/function _scrml_isBalanced_\d+\(\)\s*\{\s*\}/);
  });

  test("non-exported function in same file — UNCHANGED behavior (control)", () => {
    // Sanity check: this fix must not change non-exported function behavior.
    // The inline (non-export) path was already producing correct AST shape
    // pre-fix; the inline emit path has always emitted real bodies.
    const src = `\${
  function helper(x) { return x + 1 }
}

<program></program>`;
    const { errors, clientJs } = compileSource("non-export-fn", src);
    const fatal = errors.filter(e => e.code !== "W-PROGRAM-SPA-INFERRED");
    expect(fatal).toEqual([]);

    expect(clientJs).toMatch(/function _scrml_helper_\d+\(x\)/);
    expect(clientJs).toMatch(/return.*x.*\+.*1/);
  });
});
