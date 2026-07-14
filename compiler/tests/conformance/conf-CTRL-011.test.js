/**
 * CONF-CTRL-011 | §34 / §17.4
 *
 * Catalog: E-CTRL-011 — `for (... in ...)` is not a valid scrml loop form.
 * Normative: scrml uses `for (item of iterable)`; the `in` form (JS object-key
 * iteration) is explicitly rejected.
 *
 * Firing site: ast-builder.js:4207, 6870 (markup-attr and logic-stmt parsers).
 */
import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let _tmp = 0;

function compile(source, slug) {
  const name = `${slug}-${++_tmp}`;
  const tmpDir = resolve(testDir, `_tmp_${name}`);
  const tmpInput = resolve(tmpDir, `${name}.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: false, outputDir: resolve(tmpDir, "out") });
    return { errors: result.errors ?? [] };
  } finally {
    if (existsSync(tmpInput)) rmSync(tmpInput);
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("CONF-CTRL-011: for (... in ...) is rejected", () => {
  test("POS: for-in loop inside a ${} logic block fires E-CTRL-011", () => {
    const src = `\${
    let items = [1, 2, 3]
    for (let item in items) {
        let x = item
    }
}
<p>x</>`;
    const { errors } = compile(src, "ctrl011-pos");
    expect(errors.some(e => e.code === "E-CTRL-011")).toBe(true);
  });

  test("NEG: for-of loop with canonical `of` does NOT fire E-CTRL-011", () => {
    const src = `\${
    let items = [1, 2, 3]
    for (let item of items) {
        let x = item
    }
}
<p>x</>`;
    const { errors } = compile(src, "ctrl011-neg");
    expect(errors.some(e => e.code === "E-CTRL-011")).toBe(false);
  });
});
