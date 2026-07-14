/**
 * CONF-META-EVAL-002 | §34 / §22.4
 *
 * Catalog: E-META-EVAL-002 — Re-parsing the code emitted by a `^{}` meta
 * block failed.
 *
 * Firing site: meta-eval.ts:375, 385 (reparseEmitted). When `emit(...)` in a
 * `^{}` meta block produces a string that the parser fails to parse, each
 * downstream parse error is mapped to a single E-META-EVAL-002.
 *
 * S122 M6.1 — the firing pipeline is `nativeParseFile` (the C1 assembler)
 * since reparseEmitted migrated off `splitBlocks`+`buildAST`. The native
 * parser is intentionally more permissive than legacy BS+TAB for some
 * malformed-attribute cases (no native E-ATTR-001 equivalent), so the
 * exemplar input is an unclosed-tag form which fires E-CTX-001 under
 * native and was equally rejected under legacy.
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

describe("CONF-META-EVAL-002: meta-block emits invalid scrml", () => {
  test('POS: meta block emits markup with an unclosed tag fires E-META-EVAL-002', () => {
    // emit("<p>unclosed") — the markup has no closer, so the re-parse
    // raises E-CTX-001 (native) / E-CTX-001-style (legacy) which
    // reparseEmitted surfaces as E-META-EVAL-002. Pre-M6.1 this test
    // exercised `<p if=>` (a malformed-attribute form); the native
    // assembler is more permissive there. Unclosed-tag is rejected by
    // both pipelines.
    const src = `^{
    emit("<p>unclosed")
}
<p>x</>`;
    const { errors } = compile(src, "metaeval002-pos");
    expect(errors.some(e => e.code === "E-META-EVAL-002")).toBe(true);
  });

  test("NEG: meta block emits valid scrml does NOT fire E-META-EVAL-002", () => {
    const src = `^{
    emit("<p>hello</>")
}
<p>x</>`;
    const { errors } = compile(src, "metaeval002-neg");
    expect(errors.some(e => e.code === "E-META-EVAL-002")).toBe(false);
  });
});
