/**
 * CONF-INPUT-003 | §34 / §36.4 / §36.7
 *
 * Catalog: E-INPUT-003 — `<gamepad>` requires an `id` attribute.
 * Normative: SPEC §36.4 — gamepad state must be referenceable via `<#id>`; without
 * an id the runtime registry has no key.
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

describe("CONF-INPUT-003: <gamepad/> without id fires E-INPUT-003", () => {
  test("POS: <gamepad/> with no id attribute fires E-INPUT-003", () => {
    const src = `<program>
<gamepad/>
</>
`;
    const { errors } = compile(src, "input003-pos");
    expect(errors.some(e => e.code === "E-INPUT-003")).toBe(true);
  });

  test('NEG: <gamepad id="pad"/> does NOT fire E-INPUT-003', () => {
    const src = `<program>
<gamepad id="pad"/>
</>
`;
    const { errors } = compile(src, "input003-neg");
    expect(errors.some(e => e.code === "E-INPUT-003")).toBe(false);
  });
});
