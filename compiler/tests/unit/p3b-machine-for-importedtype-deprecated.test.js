/**
 * P3.B — `<machine for=ImportedType>` (deprecated keyword) cross-file — Unit Tests
 *
 * The `<machine>` keyword is deprecated as of P1 (E-DEPRECATED-001 emitted at
 * TAB time). Both `<machine>` and `<engine>` continue to compile in P1+; both
 * forms produce structurally identical engine-decl AST nodes (modulo the
 * legacyMachineKeyword flag).
 *
 * P3.B introduces TAB type-decl synthesis for `export type X = {...}`. This
 * test verifies that the cross-file type resolution path works for the
 * deprecated `<machine for=ImportedType>` form too — the synthesis is at TAB
 * time on the EXPORTING file; the consuming `<machine>` vs `<engine>` keyword
 * choice is independent.
 *
 * Coverage:
 *   §A — `<machine for=ImportedEnum>` compiles + emits exactly one
 *        E-DEPRECATED-001; cross-file type resolution succeeds (no E-ENGINE-004).
 *   §B — `<machine for=ImportedStruct>` cross-file resolution + deprecation
 *        warning works.
 *
 * SPEC §51.3.2 (deprecated machine keyword), §15.15 (P1 NR shadow mode).
 * Closes F-ENGINE-001 architecturally per P3 deep-dive §5.1, §5.4.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

let TMP;

beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), "p3b-mach-cf-"));
});

afterAll(() => {
  if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
});

function fx(relPath, source) {
  const abs = join(TMP, relPath);
  mkdirSync(join(abs, "..").replace(/\/$/, ""), { recursive: true });
  writeFileSync(abs, source);
  return abs;
}

function realCompileErrors(result) {
  // result.errors is the hard-error stream; warnings flow via result.warnings.
  return (result.errors || []);
}

// ---------------------------------------------------------------------------
// §A — Deprecated `<machine for=ImportedEnum>` cross-file
// ---------------------------------------------------------------------------

describe("§A `<machine for=ImportedEnum>` (deprecated keyword) cross-file", () => {
  test("compiles cleanly + emits exactly one E-DEPRECATED-001 + cross-file type resolution succeeds", () => {
    const ROOT = join(TMP, "a1");
    mkdirSync(ROOT, { recursive: true });

    fx("a1/schema.scrml", `\${
  export type Status:enum = { Pending, Done }
}
`);

    const consumer = fx("a1/consumer.scrml", `\${
  import { Status } from './schema.scrml'
}

< machine name=Flow for=Status>
  .Pending => .Done
</>

<program>
  <p>deprecated keyword + cross-file type</p>
</program>
`);

    const outDir = join(ROOT, "dist");
    const result = compileScrml({
      inputFiles: [consumer],
      outputDir: outDir,
      write: true,
      log: () => {},
    });

    // Cross-file type resolution succeeds: no E-ENGINE-004 in errors
    const errs = realCompileErrors(result);
    const e_machine_004 = errs.filter(e => e.code === "E-ENGINE-004");
    expect(e_machine_004).toEqual([]);
    // S307: cross-file resolution still succeeds; the ONLY error is the keyword removal.
    expect(errs.map(e => e.code)).toEqual(["E-DEPRECATED-001"]);

    // Exactly one E-DEPRECATED-001, in the fatal stream (S307)
    const dep = (result.errors || []).filter(w => w.code === "E-DEPRECATED-001"); // S307: fatal stream
    expect(dep.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// §B — Deprecated `<machine for=ImportedStruct>` cross-file
// ---------------------------------------------------------------------------

describe("§B `<machine for=ImportedStruct>` (deprecated keyword) cross-file", () => {
  test("struct cross-file resolution succeeds + deprecation warning emitted", () => {
    const ROOT = join(TMP, "b1");
    mkdirSync(ROOT, { recursive: true });

    fx("b1/models.scrml", `\${
  export type Person:struct = { name: string, age: number }
}
`);

    const consumer = fx("b1/consumer.scrml", `\${
  import { Person } from './models.scrml'
}

< machine name=PersonFlow for=Person>
  .Anonymous => .Identified given (self.name != "")
</>

<program>
  <p>struct + deprecated keyword</p>
</program>
`);

    const outDir = join(ROOT, "dist");
    const result = compileScrml({
      inputFiles: [consumer],
      outputDir: outDir,
      write: true,
      log: () => {},
    });

    const errs = realCompileErrors(result);
    expect(errs.filter(e => e.code === "E-ENGINE-004")).toEqual([]);
    // S307: cross-file resolution still succeeds; the ONLY error is the keyword removal.
    expect(errs.map(e => e.code)).toEqual(["E-DEPRECATED-001"]);

    const dep = (result.errors || []).filter(w => w.code === "E-DEPRECATED-001"); // S307: fatal stream
    expect(dep.length).toBe(1);
  });
});
