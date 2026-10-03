/**
 * E-EXPORT-001 — reactive state-cell export rejection (§21.2 / §21.6 / §34).
 *
 * Exporting a reactive state cell — `export { count }` / `export @count` in a
 * `${ }` logic block, or a derived `const <total> = @a + @b` via `export { total }`
 * — previously passed SILENTLY (the export was swallowed; emitted JS had no
 * export; a cross-file import resolved to garbage). The ratified fix rejects
 * loudly with E-EXPORT-001.
 *
 * Component-as-const (`export const Greeting = <markup>`), channels
 * (`export <channel>`), and engines (§21.8) stay EXPORTABLE — the discriminator
 * keys on the `state-decl` binding, NOT on name-case.
 *
 * SHARED fire site (module-resolver.js MOD stage) — runs for BOTH the default
 * BS+Acorn pipeline AND the scrml-native parser (both feed `file.ast.exports`).
 * S449: the native arm of these tests ran the whole file through the retired
 * `--parser=scrml-native` flag (a file-level export is not a shape impl#1
 * routes through the native parser), so only the default-pipeline arm remains.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "export-cell-reject-")); });
afterAll(() => { if (TMP) rmSync(TMP, { recursive: true, force: true }); });

function compile(src) {
  const fp = join(TMP, `f-${Math.random().toString(36).slice(2)}.scrml`);
  writeFileSync(fp, src);
  return compileScrml({ inputFiles: [fp], outputDir: join(TMP, "dist"), write: false, log: () => {} });
}

// E-EXPORT-001 is an ERROR → result.errors.
function exportRejectErrors(res) {
  return (res.errors || []).filter((e) => e.code === "E-EXPORT-001");
}

// ---------------------------------------------------------------------------
// POSITIVE — state-cell exports fire E-EXPORT-001
// ---------------------------------------------------------------------------

describe("E-EXPORT-001 — positive (default pipeline)", () => {
  test("export { count } of a plain Shape-1 cell fires", () => {
    const res = compile(`<program>
\${
  <count> = 0
  export { count }
}
</program>`);
    const hits = exportRejectErrors(res);
    expect(hits.length).toBe(1);
    expect(hits[0].message).toContain("count");
  });

  test("export @count (@-form) of a plain cell fires", () => {
    const res = compile(`<program>
\${
  @count = 0
  export @count
}
</program>`);
    expect(exportRejectErrors(res).length).toBe(1);
  });

  test("export { total } of a derived cell fires", () => {
    const res = compile(`<program>
\${
  <a> = 1
  <b> = 2
  const <total> = @a + @b
  export { total }
}
</program>`);
    const hits = exportRejectErrors(res);
    expect(hits.length).toBe(1);
    expect(hits[0].message).toContain("total");
  });
});

// ---------------------------------------------------------------------------
// NEGATIVE — function / const / component / channel exports stay clean
// ---------------------------------------------------------------------------

describe("E-EXPORT-001 — negative (exportable bindings stay clean)", () => {
  test("export function does NOT fire", () => {
    const res = compile(`<program>
\${ export function formatDate(ts) { ts } }
</program>`);
    expect(exportRejectErrors(res).length).toBe(0);
  });

  test("export const MAX = 5 does NOT fire", () => {
    const res = compile(`<program>
\${ export const MAX = 5 }
</program>`);
    expect(exportRejectErrors(res).length).toBe(0);
  });

  test("export const Greeting = <markup> (component-as-const) does NOT fire", () => {
    const res = compile(`<program>
\${ export const Greeting = <p props={ name: string }>Hi \${name}</> }
</program>`);
    expect(exportRejectErrors(res).length).toBe(0);
  });


  test("exported channel does NOT fire", () => {
    const res = compile(`<program>
export <channel name="ticker">
  <div>tick</div>
</>
</program>`);
    expect(exportRejectErrors(res).length).toBe(0);
  });
});
