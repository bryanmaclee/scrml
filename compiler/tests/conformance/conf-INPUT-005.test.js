/**
 * CONF-INPUT-005 | §34 / §36.7
 *
 * Catalog: E-INPUT-005 — duplicate input-state-type id within the same scope.
 * Normative: SPEC §36.7 — all three input state types (`<keyboard>`, `<mouse>`,
 * `<gamepad>`) share one id namespace per scope; a 2nd occurrence of the same
 * id within the same scope fires E-INPUT-005.
 *
 * Firing site: compiler/src/codegen/emit-html.ts — INPUT_STATE_TAGS scope-walk
 * collection (S89 §36 Phase 2.B).
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

describe("CONF-INPUT-005: duplicate id across input tags fires E-INPUT-005", () => {
  test('POS: <keyboard id="x"/> + <mouse id="x"/> in same scope fires E-INPUT-005', () => {
    const src = `<program>
<keyboard id="x"/>
<mouse id="x"/>
</>
`;
    const { errors } = compile(src, "input005-pos-cross-tag");
    expect(errors.some(e => e.code === "E-INPUT-005")).toBe(true);
  });

  test('POS: two <keyboard id="k"/> in same scope fires E-INPUT-005', () => {
    const src = `<program>
<keyboard id="k"/>
<keyboard id="k"/>
</>
`;
    const { errors } = compile(src, "input005-pos-same-tag");
    expect(errors.some(e => e.code === "E-INPUT-005")).toBe(true);
  });

  test('NEG: distinct ids in same scope does NOT fire E-INPUT-005', () => {
    const src = `<program>
<keyboard id="keys"/>
<mouse id="cursor"/>
<gamepad id="pad"/>
</>
`;
    const { errors } = compile(src, "input005-neg-distinct");
    expect(errors.some(e => e.code === "E-INPUT-005")).toBe(false);
  });
});
