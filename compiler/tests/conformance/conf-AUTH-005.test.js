/**
 * CONF-AUTH-005 | §34 / §52.11
 *
 * Catalog: E-AUTH-005 — `server @var` declared inside a client-only context
 * (no `db=` on the enclosing `<program>`).
 * Normative: SPEC §52.11. Server-authoritative variables require a server
 * context.
 *
 * Firing site: type-system.ts:4446. Triggered by a `state-decl` whose
 * `isServer` flag is true when `hasProgramDbAttr(fileAST)` returns false.
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

describe("CONF-AUTH-005: server @var in client-only context", () => {
  test("POS: `server @count = 0` in file with no <program db=...> fires E-AUTH-005", () => {
    const src = `\${
    server @count = 0
}
<p>x</>`;
    const { errors } = compile(src, "auth005-pos");
    expect(errors.some(e => e.code === "E-AUTH-005")).toBe(true);
  });

  test("NEG: `server @count = load()` in a file with <program db=...> does NOT fire E-AUTH-005", () => {
    const src = `<program db="postgres"></>
\${
    server @count = loadCount()
}
<p>x</>`;
    const { errors } = compile(src, "auth005-neg");
    expect(errors.some(e => e.code === "E-AUTH-005")).toBe(false);
  });
});
