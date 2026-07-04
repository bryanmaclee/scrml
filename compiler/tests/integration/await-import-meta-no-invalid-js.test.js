/**
 * gate-flip-and-residuals (S142) — Phase-1 cascade residuals 4+5: `await import()`
 * inside a `^{}` meta block.
 *
 * Surfaced once residuals 1+2 closed (the gate reached further into
 * meta-checker.scrml / module-resolver.scrml). Two distinct codegen bugs:
 *
 *   BUG A (double-await): the ESTree `ImportExpression` had no explicit case in
 *   esTreeToExprNode → fell into the `default` escape-hatch which used the
 *   PARENT's rawSource. When the import was the argument of `await`, the parent
 *   rawSource INCLUDED the `await`, so the escape-hatch raw was the FULL
 *   `await import("x")` and the outer unary-await re-prefixed it →
 *   `await await import("x")` (invalid). FIX: explicit ImportExpression case
 *   slices only `import(<spec>)`.
 *
 *   BUG B (await outside async): a `^{}` meta block lowers to
 *   `_scrml_meta_effect(id, function(meta) { ... })`; a bare (non-async)
 *   wrapper makes a body `await` a SyntaxError. FIX: emit `async function(meta)`
 *   whenever the meta body contains a top-level `await`.
 *
 * Both bugs live behind the emitted-JS parse gate. This compiles the shapes with
 * the gate ON and asserts no E-CODEGEN-INVALID-LOGIC + acorn-clean output.
 */

import { describe, test, expect } from "bun:test";
import { writeFileSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { parseExprToNode, emitStringFromTree } from "../../src/expression-parser.ts";

const acorn = require("acorn");

function compileSource(src) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-await-import-"));
  const file = join(dir, "app.scrml");
  writeFileSync(file, src);
  return compileScrml({ inputFiles: [file], outputDir: join(dir, "dist"), write: true, validateEmit: true, log: () => {} });
}

describe("await import() does not double-await and meta wrappers go async", () => {
  test("parser: `await import(spec)` emits a single await", () => {
    const node = parseExprToNode('await import("path")', 0);
    expect(emitStringFromTree(node)).toBe('await import("path")');
    const node2 = parseExprToNode('await import("./mod.js")', 0);
    expect(emitStringFromTree(node2)).toBe('await import("./mod.js")');
  });

  test("`^{}` meta block with `await import()` emits async wrapper + single await, gate-clean", () => {
    const src = [
      "^{",
      '    const { resolve, dirname, join } = await import("path")',
      '    const { existsSync } = await import("fs")',
      "}",
    ].join("\n");
    const result = compileSource(src);
    const invalid = (result.errors ?? []).filter((e) => e.code === "E-CODEGEN-INVALID-LOGIC");
    expect(invalid).toHaveLength(0);
    const out = result.outputs ? [...result.outputs.values()][0] : null;
    const js = out?.clientJs ?? "";
    expect(js).toBeTruthy();
    // async wrapper present; no double-await; acorn-clean.
    expect(js).toContain("async function(meta)");
    expect(js).not.toContain("await await");
    expect(js).toContain('await import("path")');
    expect(() => acorn.parse(js, { ecmaVersion: 2022, sourceType: "module" })).not.toThrow();
  });
});
