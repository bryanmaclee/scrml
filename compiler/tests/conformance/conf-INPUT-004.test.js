/**
 * CONF-INPUT-004 | §34 / §36.4 / §36.7
 *
 * Catalog: E-INPUT-004 — `<gamepad>` attribute `index` must be 0, 1, 2, or 3.
 * Normative: SPEC §36.4 — the Gamepad API supports at most 4 simultaneous
 * gamepads, so `index` must be in the [0, 3] range.
 *
 * Firing site: compiler/src/codegen/emit-html.ts INPUT_STATE_TAGS branch.
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

describe("CONF-INPUT-004: <gamepad id=\"p\" index=7/> fires E-INPUT-004", () => {
  test("POS: <gamepad id=\"p\" index=7/> (out of range) fires E-INPUT-004", () => {
    const src = `<program>
<gamepad id="p" index=7/>
</>
`;
    const { errors } = compile(src, "input004-pos");
    expect(errors.some(e => e.code === "E-INPUT-004")).toBe(true);
  });

  test('NEG: <gamepad id="p" index=0/> does NOT fire E-INPUT-004', () => {
    const src = `<program>
<gamepad id="p" index=0/>
</>
`;
    const { errors } = compile(src, "input004-neg-0");
    expect(errors.some(e => e.code === "E-INPUT-004")).toBe(false);
  });

  test('NEG: <gamepad id="p" index=3/> does NOT fire E-INPUT-004', () => {
    const src = `<program>
<gamepad id="p" index=3/>
</>
`;
    const { errors } = compile(src, "input004-neg-3");
    expect(errors.some(e => e.code === "E-INPUT-004")).toBe(false);
  });
});
