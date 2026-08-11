/**
 * g-tool-import-prune-drops-dollar-prefixed-local (S340-peter, fixing a #508 HIGH
 * surfaced by bryan's S338 review floor).
 *
 * The tool import tree-shake (`emit-tool.ts buildImportHeader`) judged an import
 * specifier "used" with `identReferencedInSrc`, a `\b${name}\b` regex. `\b` cannot
 * match a boundary before a leading `$` (both sides non-word), so a `$`-prefixed
 * import LOCAL (`import { routeScore as $rs }`) was classified DEAD even when
 * referenced — and when every spec is judged dead, the whole import line is dropped.
 * Result: `tool.js` emits `return $rs(21)` with NO import → a dangling reference →
 * runtime `ReferenceError` (green compile, invisible to `node --check`).
 *
 * FIX: reuse the server prune's correct predicate `localServerImportNameUsed`
 * (manual boundary guard `(^|[^A-Za-z0-9_$])name([^A-Za-z0-9_$]|$)`), not a second
 * `\b` copy — one predicate (Rule 7).
 */

import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

function compileTool(toolSrc, libSrc) {
  const dir = mkdtempSync(join(tmpdir(), "tool-dollar-"));
  const dist = join(dir, "dist");
  mkdirSync(dist, { recursive: true });
  writeFileSync(join(dir, "lib.scrml"), libSrc);
  const toolPath = join(dir, "tool.scrml");
  writeFileSync(toolPath, toolSrc);
  compileScrml({ inputFiles: [toolPath], write: true, outputDir: dist, log: () => {} });
  const toolJs = readdirSync(dist).find((f) => f === "tool.js");
  return toolJs ? readFileSync(join(dist, toolJs), "utf8") : "";
}

const LIB = `\${ export function routeScore(x) { return x * 2 }
  export function ensureSchema() { return 1 } }`;

describe("g-tool-import-prune-drops-dollar-prefixed-local — tool import tree-shake keeps referenced $/_ locals", () => {
  test("a `$`-prefixed import local that IS referenced keeps its import (was dropped → dangling ref)", () => {
    const js = compileTool(
      `<program kind="tool">\n\${ import { routeScore as $rs } from "./lib.scrml" }\nexport function main() { return $rs(21) }\n</program>\n`,
      LIB,
    );
    expect(js).toContain("$rs"); // reference present in the body
    expect(js).toMatch(/import\s*\{[^}]*routeScore as \$rs[^}]*\}\s*from/); // import emitted, not dropped
  });

  test("an `_`-prefixed import local that IS referenced keeps its import", () => {
    const js = compileTool(
      `<program kind="tool">\n\${ import { routeScore as _rs } from "./lib.scrml" }\nexport function main() { return _rs(21) }\n</program>\n`,
      LIB,
    );
    expect(js).toMatch(/import\s*\{[^}]*routeScore as _rs[^}]*\}\s*from/);
  });

  test("a plain aliased import local that IS referenced keeps its import", () => {
    const js = compileTool(
      `<program kind="tool">\n\${ import { routeScore as rs } from "./lib.scrml" }\nexport function main() { return rs(21) }\n</program>\n`,
      LIB,
    );
    expect(js).toMatch(/import\s*\{[^}]*routeScore as rs[^}]*\}\s*from/);
  });

  test("tree-shake still drops a GENUINELY unreferenced `$`-prefixed spec (gate: no over-keep)", () => {
    // `$rs` is referenced; `$unused` (aliasing ensureSchema) is not → only $rs kept.
    const js = compileTool(
      `<program kind="tool">\n\${ import { routeScore as $rs, ensureSchema as $unused } from "./lib.scrml" }\nexport function main() { return $rs(21) }\n</program>\n`,
      LIB,
    );
    expect(js).toContain("routeScore as $rs");
    expect(js).not.toContain("$unused");
  });

  test("all specs dead → whole import dropped (no spurious empty import)", () => {
    const js = compileTool(
      `<program kind="tool">\n\${ import { routeScore as $rs } from "./lib.scrml" }\nexport function main() { return 1 }\n</program>\n`,
      LIB,
    );
    expect(js).not.toContain("routeScore");
    expect(js).not.toMatch(/import\s*\{\s*\}\s*from/);
  });
});
