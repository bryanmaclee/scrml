/**
 * CONF-AUTH-003 | §34 / §52.3.3
 *
 * Catalog: E-AUTH-003 — `authority="server"` requires `table=` attribute.
 * Normative: SPEC §52.3.3 — the compiler cannot generate sync infrastructure
 * without a database-table mapping.
 *
 * Firing site: type-system.ts:1964 (registerStateType).
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

describe("CONF-AUTH-003: authority='server' requires table=", () => {
  test('POS: < Foo authority="server" name(string)> without table= fires E-AUTH-003', () => {
    const src = `<program db="postgres"></>
< Todo authority="server" title(string)></>
`;
    const { errors } = compile(src, "auth003-pos");
    expect(errors.some(e => e.code === "E-AUTH-003")).toBe(true);
  });

  test('NEG: < Foo authority="server" table="todos" name(string)> does NOT fire E-AUTH-003', () => {
    const src = `<program db="postgres"></>
< Todo authority="server" table="todos" title(string)></>
`;
    const { errors } = compile(src, "auth003-neg");
    expect(errors.some(e => e.code === "E-AUTH-003")).toBe(false);
  });
});
