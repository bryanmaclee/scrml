/**
 * Regression tests — lin tracking inside template-literal interpolations (A4).
 *
 * Bug class: `forEachIdentInExprNode` treats `lit` ExprNodes as opaque leaves.
 * When a template literal stores its `${...}` interpolations as raw text inside
 * the `lit.raw` field (litType === "template"), every consumer of the walker
 * (lin tracker, dep-graph, reactive analysis, etc.) misses the identifiers
 * inside the interpolations.
 *
 * Surgical fix (Option 1 from intake): special-case `litType === "template"`
 * in the walker — tokenize the template into quasis and interpolation segments,
 * parse each interpolation back to an ExprNode, and recurse. Other lit kinds
 * remain leaves.
 *
 * @see scrml-support/archive/changes/fix-lin-template-literal-interpolation-walk/intake.md
 * @see compiler/src/expression-parser.ts forEachIdentInExprNode (lit case)
 * @see SPEC.md §35.3 rule 1 — any read of a lin value as an expression is a consumption
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));

let tmpCounter = 0;

function compileSource(scrmlSource, testName = `lin-tmpl-${++tmpCounter}`) {
  const tmpDir = resolve(testDir, `_tmp_lin_tmpl_${testName}`);
  const tmpInput = resolve(tmpDir, `${testName}.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, scrmlSource);
  try {
    const result = compileScrml({
      inputFiles: [tmpInput],
      write: false,
      outputDir: resolve(tmpDir, "out"),
    });

    const errors = result.errors ?? [];
    return {
      errors,
      linErrors: errors.filter(e => e.code?.startsWith("E-LIN")),
    };
  } finally {
    if (existsSync(tmpInput)) rmSync(tmpInput);
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** Wrap a logic body in a minimal markup container with a logic block. */
function compileLogic(logicBody, testName) {
  const indented = logicBody.split("\n").map(l => "    " + l).join("\n");
  const src = `<div>\n  \${\n${indented}\n  }\n  <p>x</p>\n</div>\n`;
  return compileSource(src, testName);
}

// ---------------------------------------------------------------------------
// §35.3 rule 1 — lin reads inside template-literal interpolations
// ---------------------------------------------------------------------------

describe("lin tracking — template-literal interpolations (A4 surgical fix)", () => {

  // -------------------------------------------------------------------------
  // Case 1 (verified bisected trigger): single ${t} interpolation
  // Pre-fix: E-LIN-001 fires because ${t} is hidden inside lit.raw text.
  // Post-fix: walker descends into the interpolation, sees IdentExpr("t"),
  // records consumption, no error.
  // -------------------------------------------------------------------------
  test("Case 1: lin param read via single ${t} in template — zero errors", () => {
    const { linErrors } = compileLogic(
      `function f(lin t: string) {\n  return \`value: \${t}\`\n}\nf("hello")`,
      "case1-single-interp"
    );
    expect(linErrors).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Case 2: two interpolations of the same lin → E-LIN-002 (double consume)
  // -------------------------------------------------------------------------
  test("Case 2: lin param read twice via ${t}-${t} — E-LIN-002 fires", () => {
    const { linErrors } = compileLogic(
      `function f(lin t: string) {\n  return \`\${t}-\${t}\`\n}\nf("hello")`,
      "case2-double-interp"
    );
    const eLin002 = linErrors.filter(e => e.code === "E-LIN-002");
    expect(eLin002.length).toBeGreaterThanOrEqual(1);
  });

  // -------------------------------------------------------------------------
  // Case 3: mixed lin and non-lin in same template — single consume, no errs
  // -------------------------------------------------------------------------
  test("Case 3: mix lin ${t} with non-lin ${x + 1} — zero errors", () => {
    const { linErrors } = compileLogic(
      `function f(lin t: string, x: number) {\n  return \`\${t} \${x + 1}\`\n}\nf("hi", 7)`,
      "case3-mixed"
    );
    expect(linErrors).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Case 4: nested template literal — outer references inner const, not the
  // lin param. Inner template consumes lin once. Outer doesn't re-consume.
  // -------------------------------------------------------------------------
  test("Case 4: nested template literal — single lin consumption tracked", () => {
    const { linErrors } = compileLogic(
      `function f(lin t: string) {\n  const inner = \`inner: \${t}\`\n  return \`outer: \${inner}\`\n}\nf("hello")`,
      "case4-nested"
    );
    expect(linErrors).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Case 5: template literal in a let-decl init position
  // -------------------------------------------------------------------------
  test("Case 5: template literal in const init — single consumption", () => {
    const { linErrors } = compileLogic(
      `function g() {\n  lin token = "abc"\n  const msg = \`tok: \${token}\`\n  return msg\n}\ng()`,
      "case5-init"
    );
    expect(linErrors).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Case 6 (sanity): non-template lit nodes still treated as leaves.
  // Confirms the surgical fix only descends into template literals.
  // A regular double-quoted string with `x` inside is just text — should NOT
  // count as consuming `x`. lin x must therefore remain unconsumed → E-LIN-001.
  // -------------------------------------------------------------------------
  test("Case 6 (sanity): regular string literal still a leaf — E-LIN-001 fires", () => {
    const { linErrors } = compileLogic(
      `function h() {\n  lin x = "abc"\n  return "literal x string"\n}\nh()`,
      "case6-sanity-leaf"
    );
    const eLin001 = linErrors.filter(e => e.code === "E-LIN-001");
    expect(eLin001.length).toBeGreaterThanOrEqual(1);
  });

});
