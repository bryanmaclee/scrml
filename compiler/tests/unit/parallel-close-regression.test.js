/* SPDX-License-Identifier: MIT
 * Regression: §51.0.P `parallel` attribute STRUCK 2026-05-08.
 *
 * Catches accidental re-introduction of the parallel-attribute recognition
 * that was added at S70 (commit `bdc491c`) and removed alongside the spec
 * strike per the parallel-disposition deep-dive at
 *   scrml-support/docs/deep-dives/parallel-attribute-disposition-2026-05-08.md
 *
 * The disposition-deep-dive verdict (Position B = CLOSE) was selected by:
 *   - synonym-test failure CONCEDED by spec text (the now-struck §51.0.P
 *     itself called the attribute "naming sugar only" over §51.4)
 *   - asymmetric-forfeit (KEEP-and-wrong cost compounds; CLOSE-and-wrong is
 *     bounded by `// orthogonal` comment workaround)
 *   - SCXML semantic audit confirming nothing not already expressible via
 *     §51.4 multi-engine + §51.0.J derived + §51.0.Q nested engines.
 *
 * Contract this test pins:
 *
 *   1. The `parallel` keyword in attribute position on a file-scope
 *      `<engine>` MUST parse without error. (No diagnostic fires; the
 *      keyword is treated as an unknown attribute and silently ignored.
 *      This matches scrml's broader attribute-tolerance policy: parsers
 *      do not enumerate a closed-world attribute set.)
 *
 *   2. The AST `engine-decl` node MUST NOT carry a `parallelAttr` field set
 *      to `true`. The field is gone entirely.
 *
 *   3. The SYM `engineMeta` record MUST NOT carry a `parallelAttr` field.
 *
 *   4. The `engineParallel` flag on `FeatureUsage` MUST NOT exist (any
 *      attempt to access it returns `undefined`).
 *
 * If a future change re-introduces ANY of these, this test FAILS — and the
 * failure points the reader at the deep-dive + this regression file's
 * header for the "why" before they consider re-landing.
 */

import { describe, expect, test } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { runSYM } from "../../src/symbol-table.ts";
import {
  emptyUsage,
  fullUsage,
} from "../../src/codegen/usage-analyzer.ts";

function runUpToSYM(source, filePath = "test.scrml") {
  const bs = splitBlocks(filePath, source);
  const { ast } = buildAST(bs);
  return { ast, sym: runSYM({ filePath, ast }) };
}

function findEngineDecl(ast) {
  let found = null;
  function walk(nodes) {
    if (!nodes) return;
    for (const n of nodes) {
      if (!n) continue;
      if (n.kind === "engine-decl") {
        if (!found) found = n;
        return;
      }
      if (n.children) walk(n.children);
      if (n.body) walk(n.body);
    }
  }
  walk(ast.nodes || []);
  if (!found && ast.machineDecls) {
    for (const m of ast.machineDecls) {
      if (m && m.kind === "engine-decl") { found = m; break; }
    }
  }
  return found;
}

describe("§51.0.P `parallel` attribute STRUCK 2026-05-08 — regression guard", () => {
  test("`<engine for=X parallel>` parses without error (silent unknown-attribute fallthrough)", () => {
    const src = `<program>
<engine for=MarioState parallel initial=.Small>
  <Small rule=.Big></>
  <Big rule=.Small></>
</>
</program>`;
    // Should not throw, should not produce errors specific to the
    // `parallel` keyword.
    const { ast, sym } = runUpToSYM(src);

    // The engine record exists.
    const rec = sym.fileScope.stateCells.get("marioState");
    expect(rec).toBeDefined();

    // The compiler emits NO diagnostic codes specific to `parallel`. The
    // S67-era reserved codes (E-ENGINE-PARALLEL-INVALID,
    // W-ENGINE-PARALLEL-IGNORED) are not in the catalog and must not
    // appear in the diagnostic stream.
    const allErrors = sym.errors || [];
    const parallelCodes = allErrors.filter((e) =>
      typeof e.code === "string" &&
      /PARALLEL/i.test(e.code),
    );
    expect(parallelCodes).toEqual([]);
  });

  test("engine-decl AST node has NO `parallelAttr` field", () => {
    const src = `<program>
<engine for=MarioState parallel initial=.Small>
  <Small rule=.Big></>
  <Big rule=.Small></>
</>
</program>`;
    const { ast } = runUpToSYM(src);
    const decl = findEngineDecl(ast);
    expect(decl).toBeDefined();
    // The field was removed by the §51.0.P close. Accessing it returns
    // `undefined`. (Stronger: it is not even an own-property of the node.)
    expect(decl.parallelAttr).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(decl, "parallelAttr"))
      .toBe(false);
  });

  test("engineMeta on the SYM record has NO `parallelAttr` field", () => {
    const src = `<program>
<engine for=MarioState parallel initial=.Small>
  <Small rule=.Big></>
  <Big rule=.Small></>
</>
</program>`;
    const { sym } = runUpToSYM(src);
    const rec = sym.fileScope.stateCells.get("marioState");
    expect(rec.engineMeta).toBeDefined();
    expect(rec.engineMeta.parallelAttr).toBeUndefined();
    expect(
      Object.prototype.hasOwnProperty.call(rec.engineMeta, "parallelAttr"),
    ).toBe(false);
  });

  test("`engineParallel` flag on FeatureUsage no longer exists (emptyUsage + fullUsage)", () => {
    const empty = emptyUsage();
    const full = fullUsage();
    // The flag is gone entirely. `undefined` access shape catches the
    // common re-introduction pattern (someone adds the field to one of
    // the constructors before wiring the others through).
    expect(empty.engineParallel).toBeUndefined();
    expect(full.engineParallel).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(empty, "engineParallel"))
      .toBe(false);
    expect(Object.prototype.hasOwnProperty.call(full, "engineParallel"))
      .toBe(false);
  });

  test("`<engine for=X parallel pinned>` does NOT misclassify pinned (regression for the regex tightening)", () => {
    // The §51.0.P close removed the `parallel` regex but left `pinned`
    // intact. This test pins that contract: stripping `parallel` did not
    // break `pinned` recognition.
    const src = `<program>
<engine for=MarioState parallel pinned initial=.Small>
  <Small rule=.Big></>
  <Big rule=.Small></>
</>
</program>`;
    const { sym } = runUpToSYM(src);
    const rec = sym.fileScope.stateCells.get("marioState");
    expect(rec).toBeDefined();
    // pinned still recognized
    expect(rec.engineMeta.isPinned).toBe(true);
    // parallel still gone
    expect(rec.engineMeta.parallelAttr).toBeUndefined();
  });

  test("`<engine for=X>` (no parallel) — engineMeta.parallelAttr also undefined (post-strike contract is symmetric)", () => {
    // Symmetric anchor: not just a no-op when `parallel` is absent — the
    // field is GONE regardless. Pre-strike contract had
    // `parallelAttr: false` on absent; post-strike has `undefined`.
    const src = `<program>
<engine for=MarioState initial=.Small>
  <Small rule=.Big></>
  <Big rule=.Small></>
</>
</program>`;
    const { sym } = runUpToSYM(src);
    const rec = sym.fileScope.stateCells.get("marioState");
    expect(rec).toBeDefined();
    expect(rec.engineMeta.parallelAttr).toBeUndefined();
  });
});
