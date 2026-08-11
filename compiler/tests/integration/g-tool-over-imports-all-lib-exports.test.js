/**
 * g-tool-over-imports-all-lib-exports (S339-peter) — a `kind="tool"` importing a
 * SUBSET of a local `.scrml` library must emit an ES import of only the names it
 * uses, not the whole library export set.
 *
 * ROOT (traced, not the gap's/first-pass attribution): the over-import is NOT a
 * missing tree-shake in isolation — it is triggered when an imported UPPERCASE
 * value-const (`R2_THRESHOLD`) is misclassified as a user-component in the export
 * registry, flipping `importHasComponent` true in the component-expander, which
 * fires the helper-bind augmentation (`component-expander.ts:4069`) and appends
 * the lib's OTHER non-component exports to the consumer's import specifiers. That
 * augmentation exists to resolve an INLINED component's helper calls; a headless
 * tool inlines nothing, and the tool target has no bundler tree-shake, so the
 * extras leak into the emitted `import { … }`.
 *
 * FIX (fix/tool-import-treeshake): emit-tool.ts buildImportHeader tree-shakes a
 * LOCAL `.scrml` import to the names the tool body actually references (the S207
 * import-prune's conservative source-token liveness). The underlying value-const →
 * component misclassification is filed + routed separately (bryan).
 */

import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

function compileMulti(files, order) {
  const dir = mkdtempSync(join(tmpdir(), "tool-overimport-"));
  const dist = join(dir, "dist");
  mkdirSync(dist, { recursive: true });
  const paths = [];
  for (const name of order) {
    const p = join(dir, name + ".scrml");
    writeFileSync(p, files[name]);
    paths.push(p);
  }
  const result = compileScrml({ inputFiles: paths, write: true, outputDir: dist, log: () => {} });
  return { result, dist };
}

// The lib exports FOUR names; the tool imports only TWO (one of them the uppercase
// value-const that flips the misclassification), and references both.
const LIB = `\${
export function routeScore(x) { return x * 2 }
export const R2_THRESHOLD = 42
export function ensureSchema() { return 1 }
export function loadAll() { return [] }
}`;

const TOOL = `<program kind="tool">
\${ import { routeScore, R2_THRESHOLD } from "./lib.scrml" }
export function main() { return routeScore(R2_THRESHOLD) }
</program>`;

describe("g-tool-over-imports-all-lib-exports", () => {
  test("tool emits ONLY the imported+referenced names, not the whole lib export set", () => {
    const { result, dist } = compileMulti({ lib: LIB, tool: TOOL }, ["lib", "tool"]);
    const eCodes = (result.errors ?? []).map((e) => e.code).filter((c) => c && String(c).startsWith("E-"));
    expect(eCodes).toEqual([]);

    const toolJs = readFileSync(join(dist, "tool.js"), "utf8");
    const importLine = toolJs.split("\n").find((l) => /from "\.\/lib\.js"/.test(l)) ?? "";
    expect(importLine).toContain("routeScore");
    expect(importLine).toContain("R2_THRESHOLD");
    // The augmentation leak — the un-imported, un-referenced exports — must be gone.
    expect(importLine).not.toContain("ensureSchema");
    expect(importLine).not.toContain("loadAll");
  });
});
