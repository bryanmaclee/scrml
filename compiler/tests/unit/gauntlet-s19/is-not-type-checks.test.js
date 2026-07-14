/**
 * S19 gauntlet Phase 3 batch 2 — `is` / `not` type-checker diagnostics.
 *
 * Covers (from Category A is/not triage):
 *   A9   `let x: string = not`          → E-TYPE-041  (not assigned to non-optional)
 *   A10  `if (not (flag))`              → E-TYPE-045  (not as prefix negation)
 *   A11  `name is .Admin` (name:string) → E-TYPE-062  (is on non-enum operand)
 *   A12  `s is .Unknown` (Status enum)  → E-TYPE-063  (is on unknown variant)
 *
 * Ensures canonical forms (`x: T | not = not`, `s is .KnownVariant`) stay clean.
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compileWholeScrml(source, testName = `s19-isnot-${++tmpCounter}`) {
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

describe("S19 gauntlet Phase 3 batch 2 — is/not type checks", () => {

  test("A9: let x: string = not → E-TYPE-041", () => {
    const src = `\${
    let x: string = not
}
<program>
    <p>bad</>
</>`;
    const { typeErrors } = compileWholeScrml(src, "a9-not-assign-non-optional");
    expect(codes(typeErrors)).toContain("E-TYPE-041");
  });

  test("A10: if (not (flag)) → E-TYPE-045", () => {
    const src = `\${
    let flag = true
    if (not (flag)) {
        let _bad = 1
    }
}
<program>
    <p>bad</>
</>`;
    const { typeErrors } = compileWholeScrml(src, "a10-not-prefix-negation");
    expect(codes(typeErrors)).toContain("E-TYPE-045");
  });

  test("A11: name:string is .Admin → E-TYPE-062", () => {
    const src = `\${
    let name = "Alice"
    if (name is .Admin) {
        let _bad = 1
    }
}
<program>
    <p>bad</>
</>`;
    const { typeErrors } = compileWholeScrml(src, "a11-is-non-enum");
    expect(codes(typeErrors)).toContain("E-TYPE-062");
  });

  test("A12: s:Status is .Unknown → E-TYPE-063", () => {
    const src = `\${
    type Status:enum = { Active, Banned }
    let s:Status = .Active
    if (s is .Unknown) {
        let _bad = 1
    }
}
<program>
    <p>bad</>
</>`;
    const { typeErrors } = compileWholeScrml(src, "a12-is-unknown-variant");
    expect(codes(typeErrors)).toContain("E-TYPE-063");
  });

  test("canonical `let x: string | not = not` stays clean", () => {
    const src = `\${
    let x: string | not = not
}
<program>
    <p>ok</>
</>`;
    const { typeErrors } = compileWholeScrml(src, "canonical-optional-assign");
    expect(codes(typeErrors)).toEqual([]);
  });

  test("canonical `s is .Active` (known variant) stays clean", () => {
    const src = `\${
    type Status:enum = { Active, Banned }
    let s:Status = .Active
    if (s is .Active) {
        let _ok = 1
    }
}
<program>
    <p>ok</>
</>`;
    const { typeErrors } = compileWholeScrml(src, "canonical-known-variant");
    expect(codes(typeErrors)).toEqual([]);
  });
});
