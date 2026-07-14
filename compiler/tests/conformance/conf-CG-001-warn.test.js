/**
 * CONF-CG-001 | §34 / W-CG-001
 *
 * Catalog (SPEC §34, backfilled by S78 audit fold-in commit daf1e3e):
 * W-CG-001 — Top-level server-only block (SQL `?{}`, transaction-block, or
 * server-context meta) suppressed from client output. The codegen warns that
 * the block will not execute on the client; server-only constructs must be
 * placed inside server-boundary functions.
 *
 * Firing site: codegen/emit-reactive-wiring.ts:366 (severity "warning").
 * The CGError is pushed into the standard error stream with severity flag
 * "warning"; api.js surfaces it through `result.errors[]` (severity preserved).
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
    return {
      errors: result.errors ?? [],
      warnings: result.warnings ?? [],
    };
  } finally {
    if (existsSync(tmpInput)) rmSync(tmpInput);
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("CONF-CG-001 (warning): top-level server-only block suppressed", () => {
  test("POS: top-level `?{`SELECT ...`}` SQL block fires W-CG-001 in result.warnings", () => {
    const src = `<program db="postgres"></>
\${
    ?{\`SELECT 1\`}
}
<p>x</>`;
    const { warnings } = compile(src, "wcg001-pos");
    const hit = warnings.find(w => w.code === "W-CG-001");
    expect(hit).toBeDefined();
    expect(hit.severity).toBe("warning");
  });

  test("NEG: ?{} SQL inside a server function does NOT fire W-CG-001", () => {
    const src = `<program db="postgres"></>
\${
    server fn loadUsers() {
        let users = ?{\`SELECT 1\`}.all()
        return users
    }
}
<p>x</>`;
    const { warnings } = compile(src, "wcg001-neg");
    expect(warnings.some(w => w.code === "W-CG-001")).toBe(false);
  });
});
