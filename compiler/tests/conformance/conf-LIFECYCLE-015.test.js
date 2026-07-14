/**
 * CONF-LIFECYCLE-015 | §34 / §6.7.9
 *
 * Catalog: E-LIFECYCLE-015 — `animationFrame()` requires exactly one
 * function argument.
 * Normative: SPEC §6.7.9. Fires when called with zero args or a non-function
 * (literal) arg.
 *
 * Firing site: type-system.ts:7889 (checkAnimationFrame). Walker descends into
 * markup-children scopes; the call must be inside a markup tag's logic body
 * (element scope) to fire E-LIFECYCLE-015 — outside of element scope an
 * orthogonal E-LIFECYCLE-017 fires instead.
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

describe("CONF-LIFECYCLE-015: animationFrame() requires one function argument", () => {
  test("POS-A: animationFrame() with zero args inside <canvas> fires E-LIFECYCLE-015", () => {
    const src = `<canvas>
    \${ animationFrame() }
</>`;
    const { errors } = compile(src, "life015-pos-zero");
    expect(errors.some(e => e.code === "E-LIFECYCLE-015")).toBe(true);
  });

  test("POS-B: animationFrame(42) (numeric literal) inside <canvas> fires E-LIFECYCLE-015", () => {
    const src = `<canvas>
    \${ animationFrame(42) }
</>`;
    const { errors } = compile(src, "life015-pos-numlit");
    expect(errors.some(e => e.code === "E-LIFECYCLE-015")).toBe(true);
  });

  test('POS-C: animationFrame("oops") (string literal) inside <canvas> fires E-LIFECYCLE-015', () => {
    const src = `<canvas>
    \${ animationFrame("oops") }
</>`;
    const { errors } = compile(src, "life015-pos-strlit");
    expect(errors.some(e => e.code === "E-LIFECYCLE-015")).toBe(true);
  });

  test("NEG: animationFrame(draw) (function ident) inside <canvas> does NOT fire E-LIFECYCLE-015", () => {
    const src = `\${
    function draw() {
        let x = 1
    }
}
<canvas>
    \${ animationFrame(draw) }
</>`;
    const { errors } = compile(src, "life015-neg");
    expect(errors.some(e => e.code === "E-LIFECYCLE-015")).toBe(false);
  });
});
