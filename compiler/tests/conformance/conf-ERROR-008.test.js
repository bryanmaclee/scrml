/**
 * CONF-ERROR-008 | §34 / §19.3
 *
 * Catalog: E-ERROR-008 — User-defined error type declares a field named
 * `message` or `type`. Those fields are implicit on all error types and may
 * not be redeclared.
 *
 * Firing site: type-system.ts:1836.
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

describe("CONF-ERROR-008: reserved field name on error type", () => {
  test("POS-A: `type MyError : error = { message : string }` fires E-ERROR-008", () => {
    const src = `\${
    type MyError : error = { message : string }
}
<p>x</>`;
    const { errors } = compile(src, "err008-pos-msg");
    expect(errors.some(e => e.code === "E-ERROR-008")).toBe(true);
  });

  test("POS-B: `type MyError : error = { type : string }` fires E-ERROR-008", () => {
    const src = `\${
    type MyError : error = { type : string }
}
<p>x</>`;
    const { errors } = compile(src, "err008-pos-type");
    expect(errors.some(e => e.code === "E-ERROR-008")).toBe(true);
  });

  test("NEG: error type with non-reserved field names does NOT fire E-ERROR-008", () => {
    const src = `\${
    type MyError : error = { reason : string , code : int }
}
<p>x</>`;
    const { errors } = compile(src, "err008-neg");
    expect(errors.some(e => e.code === "E-ERROR-008")).toBe(false);
  });
});
