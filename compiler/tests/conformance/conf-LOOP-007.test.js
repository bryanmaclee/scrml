/**
 * CONF-LOOP-007 | §34 / §49.9
 *
 * Catalog: E-LOOP-007 — `while` used as expression without `lift`/`~`.
 * Normative: SPEC §49.4.4. `while` is a statement; using it on the RHS of a
 * let/const initializer is rejected.
 *
 * Firing site: type-system.ts:8010 (checkWhileAsExpr). When the expression
 * parser cannot parse the let-init it stores an "escape-hatch" ParseError;
 * if that raw text matches `^while\s*\([\s\S]*?\)\s*\{[\s\S]*?\blift\b[\s\S]*\}\s*$`
 * the checker emits E-LOOP-007.
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

describe("CONF-LOOP-007: while as expression", () => {
  test("POS: let-decl initialized to `while (...) { lift x }` fires E-LOOP-007", () => {
    const src = `\${
    let total = while (false) { lift 0 }
}
<p>x</>`;
    const { errors } = compile(src, "loop007-pos");
    expect(errors.some(e => e.code === "E-LOOP-007")).toBe(true);
  });

  test("NEG: `while` as a top-level statement (not as a let init) does NOT fire E-LOOP-007", () => {
    const src = `\${
    let i = 0
    while (i < 3) {
        i = i + 1
    }
}
<p>x</>`;
    const { errors } = compile(src, "loop007-neg");
    expect(errors.some(e => e.code === "E-LOOP-007")).toBe(false);
  });
});
