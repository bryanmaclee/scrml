/**
 * S19 gauntlet Phase 1 — import / export / scope / use checks (Batch 2).
 *
 * Covers the 7 missing diagnostics triaged at
 * docs/changes/gauntlet-s19/bugs.md (category A, batch 2):
 *   - A6   E-IMPORT-003  import inside a function body (§21.6)
 *   - A9   E-IMPORT-005  bare npm-style import specifier (§21.6)
 *   - A10  E-IMPORT-001  export outside a ${} logic block (§21.6)
 *   - A11  E-SCOPE-010   duplicate file-scope let binding (§7.6)
 *   - A16  E-USE-001     `use` inside a ${} logic block (§41.2.2)
 *   - A17  E-USE-002     `use` after the first markup element (§41.2.2)
 *   - A18  E-USE-005     `use` with an unknown prefix (§41)
 *
 * Each test compiles a minimal scrml fixture and asserts that the expected
 * diagnostic code is present in the compiler's error stream.
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compileWholeScrml(source, testName = `s19-iesu-${++tmpCounter}`) {
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
    };
  } finally {
    if (existsSync(tmpInput)) rmSync(tmpInput);
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

function codes(errors) {
  return errors.map(e => e.code).sort();
}

describe("S19 gauntlet Phase 1 — import / export / scope / use (Batch 2)", () => {

  // ----------------------------------------------------------------
  // A6 — import inside a function body → E-IMPORT-003 (§21.6)
  // ----------------------------------------------------------------
  test("A6: import inside a function body → E-IMPORT-003", () => {
    const src = `\${
    function load() {
        import { Status } from './_helper-types.scrml'
    }
}
<p>x</>`;
    const { errors } = compileWholeScrml(src, "a6-import-in-fn");
    expect(codes(errors)).toContain("E-IMPORT-003");
  });

  // ----------------------------------------------------------------
  // A9 — bare npm-style import specifier → E-IMPORT-005 (§21.6)
  // ----------------------------------------------------------------
  test("A9: bare npm specifier `'lodash'` → E-IMPORT-005", () => {
    const src = `\${
    import { x } from 'lodash'
}
<p>x</>`;
    const { errors } = compileWholeScrml(src, "a9-bare-npm");
    expect(codes(errors)).toContain("E-IMPORT-005");
  });

  // ----------------------------------------------------------------
  // A10 — export outside ${} block (S85 Q2 + S93 Bug 6A update)
  //
  // Pre-S93: this fired E-IMPORT-001 unconditionally.
  // Post-S93 (Bug 6A): bare `export const X = ...` is a recognized
  // BARE_DECL_RE shape at file-top — TAB's liftBareDeclarations wraps
  // it in a synthetic `${...}` logic block automatically per S85 Q2
  // non-entry-file rule. The shape itself is legal.
  //
  // The mixed-content shape `export const X = ...` + bare `<p>` still
  // surfaces W-PROGRAM-001 because the markup is not inside any
  // <program>/<page>/<channel> container. The test now asserts the
  // appropriate file-shape diagnostic.
  // ----------------------------------------------------------------
  test("A10: bare export at file-top no longer fires E-IMPORT-001 (S93)", () => {
    const src = `export const VALUE = 42
<p>x</>`;
    const { errors } = compileWholeScrml(src, "a10-export-outside");
    expect(codes(errors)).not.toContain("E-IMPORT-001");
  });

  // ----------------------------------------------------------------
  // A11 — duplicate file-scope let binding → E-SCOPE-010 (§7.6)
  // ----------------------------------------------------------------
  test("A11: duplicate file-scope `let` across two ${} blocks → E-SCOPE-010", () => {
    const src = `\${
    let label = "first"
}
\${
    let label = "second"
}
<p>\${label}</>`;
    const { errors } = compileWholeScrml(src, "a11-let-dup");
    expect(codes(errors)).toContain("E-SCOPE-010");
  });

  // ----------------------------------------------------------------
  // A16 — `use` inside a ${} logic block → E-USE-001 (§41.2.2)
  // ----------------------------------------------------------------
  test("A16: `use scrml:ui` inside ${} → E-USE-001", () => {
    const src = `\${
    use scrml:ui
}
<p>x</>`;
    const { errors } = compileWholeScrml(src, "a16-use-inside");
    expect(codes(errors)).toContain("E-USE-001");
  });

  // ----------------------------------------------------------------
  // A17 — `use` after the first markup element → E-USE-002 (§41.2.2)
  // ----------------------------------------------------------------
  test("A17: `use scrml:ui` after markup → E-USE-002", () => {
    const src = `<p>hi</>
use scrml:ui`;
    const { errors } = compileWholeScrml(src, "a17-use-after-markup");
    expect(codes(errors)).toContain("E-USE-002");
  });

  // ----------------------------------------------------------------
  // A18 — `use` with an unknown prefix → E-USE-005 (§41)
  // ----------------------------------------------------------------
  test("A18: `use foo:bar` → E-USE-005", () => {
    const src = `use foo:bar
<p>x</>`;
    const { errors } = compileWholeScrml(src, "a18-use-bad-prefix");
    expect(codes(errors)).toContain("E-USE-005");
  });
});
