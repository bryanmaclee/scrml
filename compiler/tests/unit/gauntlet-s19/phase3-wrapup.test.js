/**
 * S19 gauntlet Phase 3 batch 4 — wrap-up diagnostics.
 *
 * Covers:
 *   - C1  W-ASSIGN-001 must NOT fire on double-paren `if ((x = 5))` (§50.2.3)
 *   - A14 E-SYNTAX-044 `given u.name` — property paths forbidden (§42.2.3)
 *
 * Deferred to a later batch (block-splitter / exhaustiveness work):
 *   - A13 E-SYNTAX-043 legacy `(x) =>` — blocked on statement-boundary tokenization
 *   - A15 E-MATCH-012 / A16 W-MATCH-002 — checkExhaustiveness is orphan, needs wiring
 *   - A17 E-ASSIGN-001 decl-in-expr — same block-splitter issue as A13
 *   - B1/B2 E-ASSIGN-003/004 — tilde-decl semantic question (needs spec ruling)
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compileWholeScrml(source, testName = `s19-p3w-${++tmpCounter}`) {
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
    // api.js splits diagnostics into `result.errors` (fatal-grade, excludes
    // warnings) and `result.warnings` (W-* or severity=="warning"). The C1
    // test below asserts on the W-ASSIGN-001 warning channel, so surface
    // warnings directly — and keep `errors` as the legacy union so other
    // assertions (e.g., the A14 E-SYNTAX-044 check) continue to match.
    const fatalErrors = result.errors ?? [];
    const warnings = result.warnings ?? [];
    return {
      errors: [...fatalErrors, ...warnings],
      fatalErrors,
      warnings,
    };
  } finally {
    if (existsSync(tmpInput)) rmSync(tmpInput);
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

function codes(errors) {
  return errors.map(e => e.code);
}

describe("S19 gauntlet Phase 3 batch 4 — wrap-up", () => {

  test("C1: if ((x = 5)) (double-paren) suppresses W-ASSIGN-001", () => {
    const src = `\${
    let x = 0
    if ((x = 5)) {
        let _ok = 1
    }
}
<program>
    <p>ok</>
</>`;
    const { errors } = compileWholeScrml(src, "c1-double-paren");
    expect(codes(errors).filter(c => c === "W-ASSIGN-001")).toEqual([]);
  });

  test("A14: given u.name fires E-SYNTAX-044", () => {
    const src = `\${
    type User:struct = { name: string | not }
    let u:User = { name: "alice" }
    given u.name => {
        let _bad = 1
    }
}
<program>
    <p>bad</>
</>`;
    const { errors } = compileWholeScrml(src, "a14-given-dotted");
    expect(codes(errors)).toContain("E-SYNTAX-044");
  });

  test("A14 control: given u (bare) compiles clean", () => {
    const src = `\${
    let u: string | not = "alice"
    given u => {
        let _ok = 1
    }
}
<program>
    <p>ok</>
</>`;
    const { errors } = compileWholeScrml(src, "a14-given-bare");
    expect(codes(errors).filter(c => c === "E-SYNTAX-044")).toEqual([]);
  });
});
