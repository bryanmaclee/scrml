/**
 * CONF-LOOP-005 | §34 / §49.9
 *
 * Catalog: E-LOOP-005 — `break`/`continue` crosses function scope boundary.
 * Normative: SPEC §49.4.3 "SHALL reject such usage with E-LOOP-005".
 *
 * Firing site: type-system.ts:7963 (checkArrowBreakInLoop). Detects an arrow
 * function body containing `break` or `continue` declared INSIDE a loop body.
 * Arrow functions are function-scope boundaries; the loop keywords cannot
 * target a loop declared outside the arrow.
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

describe("CONF-LOOP-005: break/continue crossing function boundary", () => {
  test("POS-A: arrow with `break` inside an enclosing for-loop fires E-LOOP-005", () => {
    const src = `\${
    for (let i = 0; i < 10; i = i + 1) {
        let f = (x) => { if (x > 0) { break } }
    }
}
<p>x</>`;
    const { errors } = compile(src, "loop005-pos-break");
    expect(errors.some(e => e.code === "E-LOOP-005")).toBe(true);
  });

  test("POS-B: arrow with `continue` inside an enclosing while-loop fires E-LOOP-005", () => {
    const src = `\${
    let i = 0
    while (i < 10) {
        let f = (x) => { if (x > 0) { continue } }
        i = i + 1
    }
}
<p>x</>`;
    const { errors } = compile(src, "loop005-pos-continue");
    expect(errors.some(e => e.code === "E-LOOP-005")).toBe(true);
  });

  test("NEG: arrow with break/continue OUTSIDE any loop does NOT fire E-LOOP-005", () => {
    const src = `\${
    let f = (x) => { if (x > 0) { return } }
}
<p>x</>`;
    const { errors } = compile(src, "loop005-neg");
    expect(errors.some(e => e.code === "E-LOOP-005")).toBe(false);
  });
});
