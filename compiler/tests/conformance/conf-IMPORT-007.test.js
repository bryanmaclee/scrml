/**
 * CONF-IMPORT-007 | §34 / §21.7
 *
 * Catalog: E-IMPORT-007 — Auto-gather closure exceeded the sane-limit
 * (5000 files). The `import` resolution traversal touched too many files —
 * likely an accidental project-root inclusion or a cycle in directory
 * traversal.
 *
 * Firing site: api.js:506 (auto-gather closure cap). Triggered when the
 * transitive `.scrml` import closure exceeds GATHER_LIMIT.
 *
 * Test strategy (S78 audit fix): GATHER_LIMIT was hardcoded; refactored to
 * accept `options.gatherLimit` so tests can trigger E-IMPORT-007 cleanly
 * with a small fixture rather than synthesizing 5000+ .scrml files on disk.
 * Tests pass `gatherLimit: 5` and exercise both the positive fire path
 * (closure > 5) and the negative path (closure ≤ 5).
 */
import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let _tmp = 0;

/**
 * Build a chain of N .scrml files where file_K imports file_K+1, with
 * file_N being a leaf (no imports). Returns { entryPath, tmpDir, fileCount }.
 *
 * @param {number} N — number of files in the chain (entry is file_0)
 * @param {string} slug — unique slug for the temp dir
 */
function buildImportChain(N, slug) {
  const name = `${slug}-${++_tmp}`;
  const tmpDir = resolve(testDir, `_tmp_${name}`);
  mkdirSync(tmpDir, { recursive: true });
  for (let k = 0; k < N; k++) {
    const filePath = resolve(tmpDir, `f${k}.scrml`);
    const next = k < N - 1 ? `f${k + 1}` : null;
    // The gather pass regex requires `import ... from "..."` shape.
    // Use a named-export-from form so the gather can chase the path.
    const src = next
      ? `\${ import { x${k} } from "./${next}.scrml" }\n<p>file ${k}</p>`
      : `\${ const x${k} = 1; export { x${k} } }\n<p>file ${k}</p>`;
    writeFileSync(filePath, src);
  }
  return { entryPath: resolve(tmpDir, "f0.scrml"), tmpDir, fileCount: N };
}

function cleanup(tmpDir) {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
}

describe("CONF-IMPORT-007: auto-gather closure exceeded sane limit", () => {
  test("POS: closure size > gatherLimit fires E-IMPORT-007", () => {
    // Build a 6-file import chain. With gatherLimit: 5, the closure
    // exceeds the cap and E-IMPORT-007 fires.
    const { entryPath, tmpDir } = buildImportChain(6, "import007-pos");
    try {
      const result = compileScrml({
        inputFiles: [entryPath],
        write: false,
        gatherLimit: 5,
      });
      const errors = result.errors ?? [];
      expect(errors.some(e => e.code === "E-IMPORT-007")).toBe(true);
      const e7 = errors.find(e => e.code === "E-IMPORT-007");
      expect(e7?.message).toContain("Auto-gather exceeded sane limit");
      expect(e7?.severity).toBe("error");
    } finally {
      cleanup(tmpDir);
    }
  });

  test("NEG: closure size ≤ gatherLimit does NOT fire E-IMPORT-007", () => {
    // Build a 4-file import chain. With gatherLimit: 5, the closure
    // is at or below the cap; E-IMPORT-007 must NOT fire.
    const { entryPath, tmpDir } = buildImportChain(4, "import007-neg");
    try {
      const result = compileScrml({
        inputFiles: [entryPath],
        write: false,
        gatherLimit: 5,
      });
      const errors = result.errors ?? [];
      expect(errors.some(e => e.code === "E-IMPORT-007")).toBe(false);
    } finally {
      cleanup(tmpDir);
    }
  });

  test("NEG: default gatherLimit (5000) preserves prior behavior on small fixture", () => {
    // Without `gatherLimit`, default is 5000. A 3-file chain stays well
    // below; E-IMPORT-007 must NOT fire. This is the regression-guard
    // that the refactor's `?? 5000` fallback didn't change default behavior.
    const { entryPath, tmpDir } = buildImportChain(3, "import007-default");
    try {
      const result = compileScrml({
        inputFiles: [entryPath],
        write: false,
      });
      const errors = result.errors ?? [];
      expect(errors.some(e => e.code === "E-IMPORT-007")).toBe(false);
    } finally {
      cleanup(tmpDir);
    }
  });
});
