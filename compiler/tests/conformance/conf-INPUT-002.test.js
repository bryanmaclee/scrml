/**
 * CONF-INPUT-002 | §34 / §36.3 / §36.7
 *
 * Catalog: E-INPUT-002 — `<mouse>` requires an `id` attribute.
 * Normative: SPEC §36.3 — mouse state must be referenceable via `<#id>`; without
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

describe("CONF-INPUT-002: <mouse/> without id fires E-INPUT-002", () => {
  test("POS: <mouse/> with no id attribute fires E-INPUT-002", () => {
    const src = `<program>
<mouse/>
</>
`;
    const { errors } = compile(src, "input002-pos");
    expect(errors.some(e => e.code === "E-INPUT-002")).toBe(true);
  });

  test('NEG: <mouse id="cursor"/> does NOT fire E-INPUT-002', () => {
    const src = `<program>
<mouse id="cursor"/>
</>
`;
    const { errors } = compile(src, "input002-neg");
    expect(errors.some(e => e.code === "E-INPUT-002")).toBe(false);
  });
});
