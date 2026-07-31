// P1.E.E — Dedicated regression coverage for E-DEPRECATED-001 (`<machine>` →
// `<engine>` keyword migration). Replaces the prior coverage that lived in
// samples/compilation-tests/machine-*.scrml fixtures (now migrated to
// `<engine>` per P1.E.E).
//
// SPEC: §51.3.2 (canonical engine keyword), §15.15 (NR registry includes
// machine as deprecated alias), §34 (E-DEPRECATED-001 catalog).

import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";

function build(src) {
  const bs = splitBlocks("test.scrml", src);
  return buildAST(bs);
}

describe("P1.E.E: E-DEPRECATED-001 — `<machine>` keyword (with-space form)", () => {
  test("`< machine name=X for=Y>` emits exactly one E-DEPRECATED-001", () => {
    const tab = build("< machine name=Foo for=Bar>\n  .a => .b\n</>");
    const ws = tab.errors.filter(e => e.code === "E-DEPRECATED-001");
    expect(ws.length).toBe(1);
    expect(ws[0].severity).not.toBe("warning"); // S307: E-DEPRECATED-001 is fatal (E- prefix, severity unspecified)
  });

  test("`<machine name=X for=Y>` (no-space) emits exactly one E-DEPRECATED-001", () => {
    const tab = build("<machine name=Foo for=Bar>\n  .a => .b\n</>");
    const ws = tab.errors.filter(e => e.code === "E-DEPRECATED-001");
    expect(ws.length).toBe(1);
    expect(ws[0].severity).not.toBe("warning"); // S307: E-DEPRECATED-001 is fatal (E- prefix, severity unspecified)
  });

  test("multiple `<machine>` declarations each emit E-DEPRECATED-001", () => {
    const tab = build(
      "< machine name=A for=X>\n  .p => .q\n</>\n" +
      "< machine name=B for=Y>\n  .r => .s\n</>"
    );
    const ws = tab.errors.filter(e => e.code === "E-DEPRECATED-001");
    expect(ws.length).toBe(2);
  });

  test("`<engine>` (canonical) does NOT emit E-DEPRECATED-001", () => {
    const tab = build("< engine name=Foo for=Bar>\n  .a => .b\n</>");
    const ws = tab.errors.filter(e => e.code === "E-DEPRECATED-001");
    expect(ws.length).toBe(0);
  });

  // S307 — the keyword is REMOVED (SPEC §63.7); the compile FAILS on
  // E-DEPRECATED-001. Per §63.5 the form still PARSES: we keep building the
  // engine-decl so a `<machine>` source reports exactly ONE diagnostic naming
  // the migration instead of cascading secondary errors off an unbuilt node.
  test("`<machine>` still PARSES to an engine-decl (so the removal reports one diagnostic, not a cascade)", () => {
    const tab = build("< machine name=Foo for=Bar>\n  .a => .b\n</>");
    expect(tab.ast.nodes[0].kind).toBe("engine-decl");
    expect(tab.ast.nodes[0].engineName).toBe("Foo");
    expect(tab.ast.nodes[0].governedType).toBe("Bar");
    // ...and exactly one diagnostic, which is the removal error.
    expect(tab.errors.filter(e => e.code === "E-DEPRECATED-001").length).toBe(1);
  });

  test("`<machine>` and `<engine>` produce structurally identical engine-decl ASTs (modulo legacyMachineKeyword flag)", () => {
    const m = build("< machine name=Foo for=Bar>\n  .a => .b\n</>").ast.nodes[0];
    const e = build("< engine name=Foo for=Bar>\n  .a => .b\n</>").ast.nodes[0];
    expect(m.kind).toBe("engine-decl");
    expect(e.kind).toBe("engine-decl");
    expect(m.engineName).toBe(e.engineName);
    expect(m.governedType).toBe(e.governedType);
    expect(m.rulesRaw).toBe(e.rulesRaw);
    expect(m.legacyMachineKeyword).toBe(true);
    expect(e.legacyMachineKeyword).toBe(false);
  });
});

describe("P1.E.E: E-DEPRECATED-001 — message content", () => {
  test("message references `<engine>` as the canonical alternative", () => {
    const tab = build("< machine name=Foo for=Bar>\n  .a => .b\n</>");
    const ws = tab.errors.find(e => e.code === "E-DEPRECATED-001");
    expect(ws).toBeTruthy();
    expect(ws.message).toContain("engine");
    expect(ws.message).toContain("removed");
  });

  // S307 — §63.4's codemod gate is what makes the removal legitimate, so the
  // diagnostic SHALL name the verb that performs it. This assertion is the
  // gate's user-facing half: if the message stops naming `scrml migrate`, an
  // author hits a hard error with no mechanical way out.
  test("message names the landed codemod (`scrml migrate`) as the migration path", () => {
    const tab = build("< machine name=Foo for=Bar>\n  .a => .b\n</>");
    const ws = tab.errors.find(e => e.code === "E-DEPRECATED-001");
    expect(ws).toBeTruthy();
    expect(ws.message).toContain("scrml migrate");
  });
});
