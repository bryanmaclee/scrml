/**
 * P3.B — `<engine for=LocalType>` regression pin — Unit Tests
 *
 * These tests pin the SAME-FILE behaviour of `<engine for=LocalType>` (and
 * the deprecated `<machine for=LocalType>` alias) so that the P3.B fix in
 * ast-builder.js (synthesizing type-decl alongside export-decl when parsing
 * `export type X = {...}`) does not regress the existing local-type path.
 *
 * Pre-fix invariant (must continue to hold):
 *   - `<engine for=LocalType>` where `LocalType` is declared in the same file
 *     compiles cleanly (no E-ENGINE-004).
 *   - This is the dispatch app's existing pattern at pages/driver/hos.scrml.
 *
 * Post-fix invariant (must hold after P3.B):
 *   - The above continues to hold (regression pin).
 *
 * SPEC §51.3.2 (engine syntax + type resolution).
 * Closes F-ENGINE-001 architecturally per P3 deep-dive §5.1, §5.4.
 */

import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";

function build(src) {
  const bs = splitBlocks("test.scrml", src);
  return buildAST(bs);
}

function realErrors(errs) {
  return (errs || []).filter(e => e && e.severity !== "warning");
}

describe("§A engine for=LocalType — non-exported same-file types", () => {
  test("`<engine for=LocalEnum>` compiles cleanly when LocalEnum is non-exported in-file", () => {
    const src = `\${
  type Status:enum = {
    Pending
    Done
  }
}

< engine name=Flow for=Status>
  .Pending => .Done
</>`;
    const tab = build(src);
    expect(realErrors(tab.errors)).toEqual([]);

    // type-decl present
    const td = tab.ast.typeDecls.find(t => t.name === "Status");
    expect(td).toBeTruthy();
    expect(td.typeKind).toBe("enum");
    expect(td.fromExport).toBeUndefined();

    // engine-decl present
    const md = tab.ast.machineDecls.find(m => m.engineName === "Flow");
    expect(md).toBeTruthy();
    expect(md.governedType).toBe("Status");
    expect(md.legacyMachineKeyword).toBe(false);
  });

  test("`<engine for=LocalStruct>` compiles cleanly when LocalStruct is non-exported in-file", () => {
    const src = `\${
  type Person:struct = {
    name: string
    age: number
  }
}

< engine name=PersonFlow for=Person>
  .Anonymous => .Identified given (self.name != "")
</>`;
    const tab = build(src);
    expect(realErrors(tab.errors)).toEqual([]);

    const td = tab.ast.typeDecls.find(t => t.name === "Person");
    expect(td).toBeTruthy();
    expect(td.typeKind).toBe("struct");
    expect(td.fromExport).toBeUndefined();

    const md = tab.ast.machineDecls.find(m => m.engineName === "PersonFlow");
    expect(md).toBeTruthy();
    expect(md.governedType).toBe("Person");
  });

  test("`<engine for=LocalEnum>` continues to work when LocalEnum has many variants", () => {
    const src = `\${
  type DriverStatus:enum = {
    OffDuty
    OnDuty
    Driving
    SleeperBerth
  }
}

< engine name=HOSMachine for=DriverStatus>
  .OffDuty      => .OnDuty | .SleeperBerth
  .OnDuty       => .OffDuty | .Driving
  .Driving      => .OffDuty | .OnDuty
  .SleeperBerth => .OnDuty | .OffDuty
</>`;
    const tab = build(src);
    expect(realErrors(tab.errors)).toEqual([]);

    const td = tab.ast.typeDecls.find(t => t.name === "DriverStatus");
    expect(td).toBeTruthy();
    expect(td.typeKind).toBe("enum");

    const md = tab.ast.machineDecls.find(m => m.engineName === "HOSMachine");
    expect(md).toBeTruthy();
    expect(md.governedType).toBe("DriverStatus");
  });
});

// S307 — the keyword is REMOVED (SPEC §63.7). These tests previously asserted
// `<machine>` compiled CLEANLY; it now fails with E-DEPRECATED-001. The coverage
// they actually carry — same-file type resolution reaching the decl, and the
// `legacyMachineKeyword` flag being set — is orthogonal to the keyword's
// legality and is PRESERVED: the parse still succeeds (§63.5), so the only real
// error is the removal itself.
describe("§B removed `<machine for=LocalType>` still PARSES, and E-DEPRECATED-001 is its only error", () => {
  test("`<machine for=LocalEnum>` (removed keyword) still resolves the same-file type", () => {
    const src = `\${
  type LegacyStatus:enum = { A B }
}

< machine name=LegacyFlow for=LegacyStatus>
  .A => .B
</>`;
    const tab = build(src);
    // S307: the removal error IS a real error now — it must be the ONLY one.
    expect(realErrors(tab.errors).map(e => e.code)).toEqual(["E-DEPRECATED-001"]);
    const dep = (tab.errors || []).filter(e => e.code === "E-DEPRECATED-001");
    expect(dep.length).toBe(1);

    const md = tab.ast.machineDecls.find(m => m.engineName === "LegacyFlow");
    expect(md).toBeTruthy();
    expect(md.governedType).toBe("LegacyStatus");
    expect(md.legacyMachineKeyword).toBe(true);
  });

  test("`<machine for=LocalStruct>` (removed keyword) still resolves the same-file struct", () => {
    const src = `\${
  type LegacyShape:struct = { x: number, y: number }
}

< machine name=LegacyShapeFlow for=LegacyShape>
  .Initial => .Final given (self.x > 0)
</>`;
    const tab = build(src);
    expect(realErrors(tab.errors).map(e => e.code)).toEqual(["E-DEPRECATED-001"]); // S307
    const dep = (tab.errors || []).filter(e => e.code === "E-DEPRECATED-001");
    expect(dep.length).toBe(1);

    const md = tab.ast.machineDecls.find(m => m.engineName === "LegacyShapeFlow");
    expect(md).toBeTruthy();
    expect(md.governedType).toBe("LegacyShape");
  });
});
