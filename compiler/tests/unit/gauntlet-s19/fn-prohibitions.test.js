/**
 * S19 gauntlet Phase 1 — fn body prohibition checks.
 *
 * Covers the 5 missing fn-body diagnostics triaged at
 * docs/changes/gauntlet-s19/bugs.md:
 *   - A1  E-FN-001  ?{} SQL access inside fn body (§48.3.1)
 *   - A2  E-FN-003  outer-scope variable mutation via `x = x+1` (§48.3.3)
 *   - A3  E-FN-003  fn body calls a `function` (non-pure) declaration (§48.6.2)
 *   - A4  E-FN-005  `async fn` is rejected — fn is always synchronous (§48.3.5)
 *   - A5  E-FN-008  `lift` targets an accumulator initialized outside fn body
 *
 * Each test compiles a minimal scrml fixture and asserts the expected E-FN
 * diagnostic code fires.
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compileWholeScrml(source, testName = `s19-fn-${++tmpCounter}`) {
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
      fnErrors: (result.errors ?? []).filter(e => e.code?.startsWith("E-FN")),
    };
  } finally {
    if (existsSync(tmpInput)) rmSync(tmpInput);
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

function codes(errors) {
  return errors.map(e => e.code).sort();
}

describe("S19 gauntlet Phase 1 — fn body prohibitions", () => {

  test("A1: ?{} SQL inside fn body → E-FN-001", () => {
    const src = [
      `<program db="./test.db">`,
      `$\{`,
      `    fn loadName(id) {`,
      '        let row = ?{`SELECT name FROM users WHERE id = ${id}`}.get()',
      `        return row.name`,
      `    }`,
      `}`,
      `<p>$\{loadName(1)}</>`,
      `</>`,
    ].join("\n");
    const { fnErrors } = compileWholeScrml(src, "a1-fn-sql");
    expect(codes(fnErrors)).toContain("E-FN-001");
  });

  test("A2: fn body writes to outer-scope var → E-FN-003", () => {
    const src = `\${
    let counter = 0
    fn bump() {
        counter = counter + 1
        return counter
    }
}
<p>\${bump()}</>`;
    const { fnErrors } = compileWholeScrml(src, "a2-outer-mut");
    expect(codes(fnErrors)).toContain("E-FN-003");
  });

  test("A3: fn body calls a function-decl (non-pure) → E-FN-003", () => {
    const src = `\${
    function effectful() { return 1 }
    fn wrapper() {
        return effectful()
    }
}
<p>\${wrapper()}</>`;
    const { fnErrors } = compileWholeScrml(src, "a3-nonpure-call");
    expect(codes(fnErrors)).toContain("E-FN-003");
  });

  test("A4: async fn → E-FN-005", () => {
    const src = `\${
    async fn loadProfile(id) {
        return id
    }
}
<p>\${loadProfile(1)}</>`;
    const { fnErrors } = compileWholeScrml(src, "a4-async-fn");
    expect(codes(fnErrors)).toContain("E-FN-005");
  });

  test("A5: lift past fn boundary → E-FN-008", () => {
    const src = `\${
    ~acc = []
    fn helper() {
        lift "from-fn"
    }
    helper()
}
<ul>\${acc}</ul>`;
    const { fnErrors } = compileWholeScrml(src, "a5-lift-boundary");
    expect(codes(fnErrors)).toContain("E-FN-008");
  });
});
