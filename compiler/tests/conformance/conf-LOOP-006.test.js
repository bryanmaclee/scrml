/**
 * CONF-LOOP-006 | §34 / §49.9
 *
 * Catalog: E-LOOP-006 — Duplicate label identifier within function scope.
 * Normative: SPEC §49.2.2 "SHALL reject duplicate label identifiers with E-LOOP-006".
 *
 * Firing site: type-system.ts:7935 (checkDuplicateLabels). Walks for sibling
 * loop nodes with identical `label` string fields; emits when the same label
 * appears more than once in the same body scope.
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

describe("CONF-LOOP-006: duplicate loop label in same scope", () => {
  test("POS: two sibling for-loops labeled `outer:` fire E-LOOP-006", () => {
    const src = `\${
    outer: for (let i = 0; i < 10; i = i + 1) {
        let a = i
    }
    outer: for (let j = 0; j < 10; j = j + 1) {
        let b = j
    }
}
<p>x</>`;
    const { errors } = compile(src, "loop006-pos");
    expect(errors.some(e => e.code === "E-LOOP-006")).toBe(true);
  });

  test("NEG: two for-loops with DIFFERENT labels (`outer:` and `inner:`) do NOT fire E-LOOP-006", () => {
    const src = `\${
    outer: for (let i = 0; i < 10; i = i + 1) {
        let a = i
    }
    inner: for (let j = 0; j < 10; j = j + 1) {
        let b = j
    }
}
<p>x</>`;
    const { errors } = compile(src, "loop006-neg");
    expect(errors.some(e => e.code === "E-LOOP-006")).toBe(false);
  });
});
