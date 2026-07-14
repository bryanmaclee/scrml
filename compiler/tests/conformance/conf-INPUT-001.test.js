/**
 * CONF-INPUT-001 | §34 / §36.2 / §36.7
 *
 * Catalog: E-INPUT-001 — `<keyboard>` requires an `id` attribute.
 * Normative: SPEC §36.2 — input state must be referenceable via `<#id>`; without
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

describe("CONF-INPUT-001: <keyboard/> without id fires E-INPUT-001", () => {
  test("POS: <keyboard/> with no id attribute fires E-INPUT-001", () => {
    const src = `<program>
<keyboard/>
</>
`;
    const { errors } = compile(src, "input001-pos");
    expect(errors.some(e => e.code === "E-INPUT-001")).toBe(true);
  });

  test('NEG: <keyboard id="keys"/> does NOT fire E-INPUT-001', () => {
    const src = `<program>
<keyboard id="keys"/>
</>
`;
    const { errors } = compile(src, "input001-neg");
    expect(errors.some(e => e.code === "E-INPUT-001")).toBe(false);
  });
});
