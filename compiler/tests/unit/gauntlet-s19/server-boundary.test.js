/**
 * S19 gauntlet Phase 1 — server-boundary regression tests.
 *
 * Covers the server-boundary bugs triaged at
 * docs/changes/gauntlet-s19/bugs.md:
 *   - E-AUTH-002  server @var derived from client-local reactive var was silently accepted
 *
 * Each test compiles a minimal scrml fixture and asserts the expected set of
 * E-AUTH-xxx diagnostics.
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compileWholeScrml(source, testName = `s19-auth-${++tmpCounter}`) {
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
      authErrors: (result.errors ?? []).filter(e => e.code?.startsWith("E-AUTH")),
    };
  } finally {
    if (existsSync(tmpInput)) rmSync(tmpInput);
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("S19 gauntlet Phase 1 — server boundary", () => {

  // -----------------------------------------------------------------
  // E-AUTH-002: `server @var = @localVar * ...` must be rejected
  // -----------------------------------------------------------------
  test("E-AUTH-002: server reactive derived from client-local reactive var", () => {
    const src = `<program db="./test.db">
    \${
        @localCount = 5
        server @synced = @localCount * 2
    }
    <p>\${@synced}</>
</>
`;
    const { authErrors } = compileWholeScrml(src, "eauth002-local-dep");
    const codes = authErrors.map(e => e.code);
    expect(codes).toContain("E-AUTH-002");
    const e = authErrors.find(x => x.code === "E-AUTH-002");
    expect(e.message).toContain("@synced");
    expect(e.message).toContain("@localCount");
  });

  // -----------------------------------------------------------------
  // Sanity: server @var with no local reactive dep → no E-AUTH-002
  // -----------------------------------------------------------------
  test("sanity: server @var initialized from a server function call — no E-AUTH-002", () => {
    const src = `<program db="./test.db">
    \${
        server function loadCount() { return 42 }
        server @synced = loadCount()
    }
    <p>\${@synced}</>
</>
`;
    const { authErrors } = compileWholeScrml(src, "eauth002-clean");
    const codes = authErrors.map(e => e.code);
    expect(codes).not.toContain("E-AUTH-002");
  });
});
