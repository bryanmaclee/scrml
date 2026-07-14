/**
 * CONF-AUTH-004 | §34 / §52.3.4
 *
 * Catalog: E-AUTH-004 — two declarations of the same state type with
 * conflicting `authority=` values.
 * Normative: SPEC §52.3.4. Both decls must agree, or be declared as two
 * distinct types.
 *
 * Firing site: type-system.ts:1930 (registerStateType).
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

describe("CONF-AUTH-004: conflicting authority for same type", () => {
  test("POS: type declared once authority=server, then authority=local fires E-AUTH-004", () => {
    const src = `<program db="postgres"></>
< Todo authority="server" table="todos" title(string)></>
< Todo authority="local" title(string)></>
`;
    const { errors } = compile(src, "auth004-pos");
    expect(errors.some(e => e.code === "E-AUTH-004")).toBe(true);
  });

  test("NEG: same type declared twice with matching authority does NOT fire E-AUTH-004", () => {
    const src = `<program db="postgres"></>
< Todo authority="server" table="todos" title(string)></>
< Todo authority="server" table="todos" title(string)></>
`;
    const { errors } = compile(src, "auth004-neg");
    expect(errors.some(e => e.code === "E-AUTH-004")).toBe(false);
  });
});
