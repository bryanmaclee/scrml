/**
 * S19 gauntlet Phase 3 — equality / null-token diagnostics (Batch 1).
 *
 * Covers the 8 missing equality diagnostics triaged at
 * docs/changes/gauntlet-s19/phase3-bugs.md (category A, batch 1):
 *   - A1  E-EQ-004      `===` used as equality                        (§45.7)
 *   - A2  E-EQ-004      `!==` used as equality                        (§45.7)
 *   - A3  E-EQ-002      `== not` — use `is not`                       (§45)
 *   - A4  E-SYNTAX-042  `== null` — `null` is not a scrml token       (§45)
 *   - A5  E-SYNTAX-042  `== undefined` — `undefined` is not a token   (§45)
 *   - A6  E-EQ-001      `==` across two primitive types               (§45)
 *   - A7  W-EQ-001      `==` on `asIs` declared values                (§45)
 *   - A8  E-EQ-003      `==` on struct with a function-typed field    (§45)
 *
 * Each test compiles a minimal scrml fixture and asserts that the expected
 * diagnostic code is present in the compiler's error or warning stream.
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compileWholeScrml(source, testName = `s19-eq-${++tmpCounter}`) {
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
      warnings: result.warnings ?? [],
    };
  } finally {
    if (existsSync(tmpInput)) rmSync(tmpInput);
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

function codes(items) {
  return items.map(e => e.code).sort();
}

describe("S19 gauntlet Phase 3 — equality & null-token diagnostics (Batch 1)", () => {

  // ----------------------------------------------------------------
  // A1 — `===` in an if-condition → E-EQ-004 (§45.7)
  // ----------------------------------------------------------------
  test("A1: `===` in if-condition → E-EQ-004", () => {
    const src = `\${
    let a = 1
    let b = 2
    if (a === b) {
        let _bad = 1
    }
}
<program>
    <p>bad</>
</>`;
    const { errors } = compileWholeScrml(src, "a1-strict-eq");
    expect(codes(errors)).toContain("E-EQ-004");
  });

  // ----------------------------------------------------------------
  // A2 — `!==` in an if-condition → E-EQ-004 (§45.7)
  // ----------------------------------------------------------------
  test("A2: `!==` in if-condition → E-EQ-004", () => {
    const src = `\${
    let a = 1
    let b = 2
    if (a !== b) {
        let _bad = 1
    }
}
<program>
    <p>bad</>
</>`;
    const { errors } = compileWholeScrml(src, "a2-strict-neq");
    expect(codes(errors)).toContain("E-EQ-004");
  });

  // ----------------------------------------------------------------
  // A3 — `== not` → E-EQ-002 (§45)
  // ----------------------------------------------------------------
  test("A3: `== not` → E-EQ-002", () => {
    const src = `\${
    let x: string | not = not
    if (x == not) {
        let _bad = 1
    }
}
<program>
    <p>bad</>
</>`;
    const { errors } = compileWholeScrml(src, "a3-eq-not");
    expect(codes(errors)).toContain("E-EQ-002");
  });

  // ----------------------------------------------------------------
  // A4 — `== null` → E-SYNTAX-042 (§45)
  // ----------------------------------------------------------------
  test("A4: `== null` → E-SYNTAX-042", () => {
    const src = `\${
    let x: string | not = not
    if (x == null) {
        let _bad = 1
    }
}
<program>
    <p>bad</>
</>`;
    const { errors } = compileWholeScrml(src, "a4-eq-null");
    expect(codes(errors)).toContain("E-SYNTAX-042");
  });

  // ----------------------------------------------------------------
  // A5 — `== undefined` → E-SYNTAX-042 (§45)
  // ----------------------------------------------------------------
  test("A5: `== undefined` → E-SYNTAX-042", () => {
    const src = `\${
    let x: string | not = not
    if (x == undefined) {
        let _bad = 1
    }
}
<program>
    <p>bad</>
</>`;
    const { errors } = compileWholeScrml(src, "a5-eq-undefined");
    expect(codes(errors)).toContain("E-SYNTAX-042");
  });

  // ----------------------------------------------------------------
  // A6 — `number == bool` → E-EQ-001 (§45)
  // ----------------------------------------------------------------
  test("A6: cross-type eq `number == bool` → E-EQ-001", () => {
    const src = `\${
    let n = 0
    let b = false
    if (n == b) {
        let _bad = 1
    }
}
<program>
    <p>bad</>
</>`;
    const { errors } = compileWholeScrml(src, "a6-cross-type");
    expect(codes(errors)).toContain("E-EQ-001");
  });

  // ----------------------------------------------------------------
  // A7 — `==` on `asIs` → W-EQ-001 (§45)
  // ----------------------------------------------------------------
  test("A7: `==` on asIs value → W-EQ-001 (warning)", () => {
    const src = `\${
    let x:asIs = 1
    let y:asIs = 1
    if (x == y) {
        let _same = 1
    }
}
<program>
    <p>warn</>
</>`;
    const { warnings } = compileWholeScrml(src, "a7-asis-warn");
    expect(codes(warnings)).toContain("W-EQ-001");
  });

  // ----------------------------------------------------------------
  // A8 — `==` on struct with a function field → E-EQ-003 (§45)
  // ----------------------------------------------------------------
  test("A8: struct with function field → E-EQ-003", () => {
    const src = `\${
    type Handler:struct = { name: string, onFire: () => void }
    let h1:Handler = { name: "a", onFire: () => {} }
    let h2:Handler = { name: "a", onFire: () => {} }
    if (h1 == h2) {
        let _bad = 1
    }
}
<program>
    <p>bad</>
</>`;
    const { errors } = compileWholeScrml(src, "a8-fn-field");
    expect(codes(errors)).toContain("E-EQ-003");
  });

  // ----------------------------------------------------------------
  // A9 — #274 Wall-1: local bindings are PER-FUNCTION. A numeric `h` in one
  // function must NOT retype a same-named string `h` in another function
  // (the binding collector flattened all functions into one name-keyed map →
  // last-writer-wins → a FALSE E-EQ-001 on the string `h`'s `== ""`). This was
  // an adopter blocker (they had to use globally-unique local names).
  // ----------------------------------------------------------------
  test("A9: same-named locals in different functions do NOT unify (no false E-EQ-001)", () => {
    const src = `\${
    function submit() {
        let h = ""
        if (h == "") {
            let _ok = 1
        }
        return h
    }
    function mono(name) {
        let h = 0
        return h
    }
}
<program>
    <p>ok</>
</>`;
    const { errors } = compileWholeScrml(src, "a9-cross-fn-noflip");
    // The string `h` in submit() compared to "" is same-type — no error.
    expect(codes(errors)).not.toContain("E-EQ-001");
  });

  test("A9b: a genuine number-vs-string in the SAME function STILL fires E-EQ-001", () => {
    const src = `\${
    function clean() {
        let s = ""
        if (s == "") { let _ok = 1 }
        return s
    }
    function bug() {
        let s = 0
        if (s == "") { let _bad = 1 }
        return s
    }
}
<program>
    <p>x</>
</>`;
    const { errors } = compileWholeScrml(src, "a9b-samefn-fires");
    // bug()'s `let s = 0` compared to "" is a real cross-type error — still caught,
    // and it must fire despite clean() having a legitimate string `s == ""`.
    expect(codes(errors)).toContain("E-EQ-001");
  });
});
