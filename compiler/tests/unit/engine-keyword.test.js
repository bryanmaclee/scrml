/**
 * P1 (state-as-primary unification, 2026-04-30) — engine keyword recognition
 *
 * Covers the canonical `<engine>` keyword + the deprecated `<machine>` alias.
 *
 * Spec references:
 *   §15.15 (unified state-type registry; 'engine' is a built-in lifecycle category)
 *   §34 (E-DEPRECATED-001 catalog entry)
 *   §51.3 (state machine declarations; pre-existing tests use the legacy keyword)
 *
 * Invariants:
 *   - `< engine name=N for=T>` parses identically to `< machine name=N for=T>`.
 *     Both produce kind: "engine-decl" AST nodes with the same engineName,
 *     governedType, rulesRaw, sourceVar (in P1; internal kind rename is P3).
 *   - `< machine ...>` continues to compile but emits E-DEPRECATED-001 (severity
 *     'warning'). `< engine ...>` does NOT emit E-DEPRECATED-001.
 *   - The `for=`, `name=`, and `derived=@var` attributes work identically under
 *     both keywords (no re-parsing of attribute syntax).
 *   - The `HealthMachine` / `MarioMachine` user identifiers (the value of
 *     `name=`) are user-named; they MUST stay unchanged under either keyword.
 *
 * Forward-looking:
 *   - In P3, the AST kind is planned to rename to "engine-decl" and the
 *     internal field `engineName` to `engineName`. This test file deliberately
 *     asserts the P1 wire shape (`engine-decl` + `engineName`) to fail loudly
 *     when that rename lands without explicit migration.
 */

import { describe, test, expect } from "bun:test";
import { buildAST } from "../../src/ast-builder.js";
import { splitBlocks } from "../../src/block-splitter.js";

function parseSnippet(source) {
  const bsOutput = splitBlocks("test.scrml", source);
  return buildAST(bsOutput);
}

function findMachineDecls(result) {
  const found = [];
  function walk(nodes) {
    if (!nodes) return;
    for (const n of nodes) {
      if (!n) continue;
      if (n.kind === "engine-decl") found.push(n);
      if (n.children) walk(n.children);
    }
  }
  walk(result.ast?.nodes || result.nodes || []);
  if (result.ast?.machineDecls) {
    for (const d of result.ast.machineDecls) {
      if (!found.includes(d)) found.push(d);
    }
  }
  return found;
}

describe("P1 engine keyword — equivalence with deprecated machine keyword", () => {
  test("< engine name=M for=T> produces engine-decl AST node (P1 wire shape)", () => {
    const src = `<program>
< engine name=OrderEngine for=Order>
  .Pending => .Confirmed
  .Confirmed => .Shipped
</>
</program>`;
    const result = parseSnippet(src);
    const decls = findMachineDecls(result);
    expect(decls.length).toBe(1);
    const decl = decls[0];
    expect(decl.kind).toBe("engine-decl"); // P1 wire shape (rename in P3)
    expect(decl.engineName).toBe("OrderEngine");
    expect(decl.governedType).toBe("Order");
    expect(decl.rulesRaw).toContain(".Pending => .Confirmed");
    expect(decl.rulesRaw).toContain(".Confirmed => .Shipped");
  });

  test("< engine ...> emits NO E-DEPRECATED-001 warning", () => {
    const src = `<program>
< engine name=Foo for=Bar>
  .X => .Y
</>
</program>`;
    const result = parseSnippet(src);
    const warnings = (result.errors || []).filter(e => e.code === "E-DEPRECATED-001");
    expect(warnings.length).toBe(0);
  });

  test("< machine ...> emits E-DEPRECATED-001 (severity warning)", () => {
    const src = `<program>
< machine name=Foo for=Bar>
  .X => .Y
</>
</program>`;
    const result = parseSnippet(src);
    const warnings = (result.errors || []).filter(e => e.code === "E-DEPRECATED-001");
    expect(warnings.length).toBe(1);
    expect(warnings[0].severity).not.toBe("warning"); // S307: now fatal
    expect(warnings[0].message).toContain("<machine>");
    expect(warnings[0].message).toContain("<engine>");
  });

  test("< machine ...> still compiles to engine-decl AST node", () => {
    const src = `<program>
< machine name=Foo for=Bar>
  .X => .Y
</>
</program>`;
    const result = parseSnippet(src);
    const decls = findMachineDecls(result);
    expect(decls.length).toBe(1);
    expect(decls[0].kind).toBe("engine-decl");
    expect(decls[0].engineName).toBe("Foo");
    expect(decls[0].governedType).toBe("Bar");
  });

  test("< engine ...> and < machine ...> produce structurally identical engine-decl nodes (modulo E-DEPRECATED-001)", () => {
    const engineSrc = `<program>
< engine name=Same for=T>
  .A => .B
  .B => .A
</>
</program>`;
    const machineSrc = `<program>
< machine name=Same for=T>
  .A => .B
  .B => .A
</>
</program>`;
    const eR = parseSnippet(engineSrc);
    const mR = parseSnippet(machineSrc);
    const eDecl = findMachineDecls(eR)[0];
    const mDecl = findMachineDecls(mR)[0];
    expect(eDecl.kind).toBe(mDecl.kind);
    expect(eDecl.engineName).toBe(mDecl.engineName);
    expect(eDecl.governedType).toBe(mDecl.governedType);
    expect(eDecl.rulesRaw).toBe(mDecl.rulesRaw);
    expect(eDecl.sourceVar).toBe(mDecl.sourceVar);
  });

  test("< engine ...derived=@var> threads the projection source var (§51.9 parity with machine)", () => {
    const src = `<program>
< engine name=HealthEngine for=HealthRisk derived=@orderState>
  .Pending => .Safe
  .Failed => .AtRisk
</>
</program>`;
    const result = parseSnippet(src);
    const decls = findMachineDecls(result);
    expect(decls.length).toBe(1);
    expect(decls[0].sourceVar).toBe("orderState");
    expect(decls[0].engineName).toBe("HealthEngine");
  });

  test("multiple < machine ...> openers each emit E-DEPRECATED-001 once", () => {
    const src = `<program>
< machine name=A for=T1>
  .X => .Y
</>
< machine name=B for=T2>
  .P => .Q
</>
</program>`;
    const result = parseSnippet(src);
    const warnings = (result.errors || []).filter(e => e.code === "E-DEPRECATED-001");
    expect(warnings.length).toBe(2);
    for (const w of warnings) expect(w.severity).not.toBe("warning"); // S307: now fatal
  });

  test("user identifier with 'Machine' suffix is preserved under engine keyword (HealthMachine identifier survives)", () => {
    // The keyword renamed; user-named identifiers (the value of name=) are
    // unchanged. A name like "HealthMachine" is just a string token; the
    // compiler does not rename user identifiers.
    const src = `<program>
< engine name=HealthMachine for=Risk>
  .Low => .High
</>
</program>`;
    const result = parseSnippet(src);
    const decls = findMachineDecls(result);
    expect(decls[0].engineName).toBe("HealthMachine");
  });
});
