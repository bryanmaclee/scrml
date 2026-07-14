/**
 * S19 gauntlet Phase 1 — type annotation literal-mismatch (E-TYPE-031).
 *
 * Covers:
 *   - A12  `const n: number = "x"` → E-TYPE-031
 *   - A13  `let n: number = "x"` → E-TYPE-031
 *
 * Unpredicated primitive annotations (`number`/`string`/`boolean`) must match
 * the initializer literal type. Predicated annotations are covered by §53.4 /
 * classifyPredicateZone and are tested elsewhere.
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compileWholeScrml(source, testName = `s19-typeannot-${++tmpCounter}`) {
  const tmpDir = resolve(testDir, `_tmp_${testName}`);
  const tmpInput = resolve(tmpDir, `${testName}.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({
      inputFiles: [tmpInput],
      write: false,
      outputDir: resolve(tmpDir, "out"),
    });
    return {
      errors: result.errors ?? [],
      typeErrors: (result.errors ?? []).filter(e => e.code?.startsWith("E-TYPE")),
    };
  } finally {
    if (existsSync(tmpInput)) rmSync(tmpInput);
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

function codes(errors) {
  return errors.map(e => e.code).sort();
}

describe("S19 gauntlet Phase 1 — type annotation literal mismatch", () => {

  test("A12: const n: number = \"x\" → E-TYPE-031", () => {
    const src = `\${
    const n: number = "not a number"
}
<p>\${n}</>`;
    const { typeErrors } = compileWholeScrml(src, "a12-const-mismatch");
    expect(codes(typeErrors)).toContain("E-TYPE-031");
  });

  test("A13: let n: number = \"x\" → E-TYPE-031", () => {
    const src = `\${
    let n: number = "not a number"
}
<p>\${n}</>`;
    const { typeErrors } = compileWholeScrml(src, "a13-let-mismatch");
    expect(codes(typeErrors)).toContain("E-TYPE-031");
  });

  test("const n: number = 5 compiles clean (matching literal)", () => {
    const src = `\${
    const n: number = 5
}
<p>\${n}</>`;
    const { typeErrors } = compileWholeScrml(src, "const-match");
    expect(codes(typeErrors)).toEqual([]);
  });

  test("const s: string = \"hi\" compiles clean (matching literal)", () => {
    const src = `\${
    const s: string = "hi"
}
<p>\${s}</>`;
    const { typeErrors } = compileWholeScrml(src, "const-string-match");
    expect(codes(typeErrors)).toEqual([]);
  });
});
