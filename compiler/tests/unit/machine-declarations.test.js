/**
 * §51.3 Phase 3B — Machine Declaration Parsing and Type Registry
 * Consolidated test file for impl-engine-declarations.
 *
 * Covers:
 *   - < machine name=M for=MyEnum> produces engine-decl AST node
 *   - AST node has correct engineName, governedType, rulesRaw fields
 *   - Multiple rules all parsed correctly
 *   - Machine governing a struct type (§51.3.2 Amendment 1)
 *   - Machine registered in type registry as MachineType (kind: "machine")
 *   - E-ENGINE-003: duplicate machine name
 *   - E-ENGINE-004: unknown forType
 *   - E-ENGINE-005: empty machine body
 *
 * Note on source-level struct tests: guards using `<` (less-than) inside
 * machine bodies are ambiguous for the BS, which treats `<` as a tag opener.
 * Source-level tests use `>=` / `>` operators to avoid this. The `<` operator
 * in guards IS supported at the type-system level (rulesRaw passed directly).
 */

import { describe, test, expect } from "bun:test";
import { buildAST } from "../../src/ast-builder.js";
import {
  buildMachineRegistry,
  buildTypeRegistry,
  BUILTIN_TYPES,
} from "../../src/type-system.js";
import { splitBlocks } from "../../src/block-splitter.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
  // Also check machineDecls array on ast if present (avoids double-counting)
  if (result.ast?.machineDecls) {
    for (const d of result.ast.machineDecls) {
      if (!found.includes(d)) found.push(d);
    }
  }
  return found;
}

function span() {
  return { file: "test.scrml", start: 0, end: 0, line: 1, col: 1 };
}

function makeTypeDecl(name, kind, raw) {
  return { kind: "type-decl", name, typeKind: kind, raw, span: span() };
}

function makeMachineDecl(engineName, governedType, rulesRaw) {
  // S182 (Fix 2) — these helpers model the LEGACY `<machine>`-keyword decl
  // (the file is the §51.3 `< machine>` subsystem). E-ENGINE-003 is the legacy
  // duplicate-name code and now gates on `legacyMachineKeyword: true` (the
  // canonical `<engine>` form uses §51.0.C `E-ENGINE-VAR-DUPLICATE` instead).
  return { kind: "engine-decl", engineName, governedType, rulesRaw, legacyMachineKeyword: true, span: span() };
}

// ---------------------------------------------------------------------------
// §51.3-AST-1: < machine name=M for=MyEnum> produces engine-decl AST node
// ---------------------------------------------------------------------------

describe("§51.3 — engine-decl AST node production", () => {
  test("< machine name=M for=MyEnum> produces kind: engine-decl", () => {
    const src = `<program>
< machine name=M for=MyEnum>
  .A => .B
</>
</program>`;
    const ast = parseSnippet(src);
    const decls = findMachineDecls(ast);
    expect(decls.length).toBeGreaterThanOrEqual(1);
    expect(decls[0].kind).toBe("engine-decl");
  });

  test("engine-decl node has correct engineName", () => {
    const src = `<program>
< machine name=TrafficLight for=LightColor>
  .Red => .Green
</>
</program>`;
    const ast = parseSnippet(src);
    const decls = findMachineDecls(ast);
    expect(decls[0].engineName).toBe("TrafficLight");
  });

  test("engine-decl node has correct governedType (forType)", () => {
    const src = `<program>
< machine name=TrafficLight for=LightColor>
  .Red => .Green
</>
</program>`;
    const ast = parseSnippet(src);
    const decls = findMachineDecls(ast);
    expect(decls[0].governedType).toBe("LightColor");
  });

  test("engine-decl rulesRaw contains all rule text", () => {
    const src = `<program>
< machine name=Flow for=Status>
  .Pending => .Active
  .Active => .Done
  .Active => .Cancelled
</>
</program>`;
    const ast = parseSnippet(src);
    const decls = findMachineDecls(ast);
    expect(decls[0].rulesRaw).toContain(".Pending => .Active");
    expect(decls[0].rulesRaw).toContain(".Active => .Done");
    expect(decls[0].rulesRaw).toContain(".Active => .Cancelled");
  });

  test("machine with multiple rules: all rules present in rulesRaw", () => {
    const src = `<program>
< machine name=OrderFlow for=OrderStatus>
  .Pending    => .Processing
  .Processing => .Shipped
  .Shipped    => .Delivered
  .Pending    => .Cancelled
  .Processing => .Cancelled
</>
</program>`;
    const ast = parseSnippet(src);
    const decls = findMachineDecls(ast);
    expect(decls[0].rulesRaw).toContain(".Pending");
    expect(decls[0].rulesRaw).toContain(".Processing");
    expect(decls[0].rulesRaw).toContain(".Shipped");
    expect(decls[0].rulesRaw).toContain(".Delivered");
    expect(decls[0].rulesRaw).toContain(".Cancelled");
  });
});

// ---------------------------------------------------------------------------
// §51.3-AST-2: Machine governing a struct type (§51.3.2 Amendment 1)
// Uses >= operator in guards (not <) to avoid BS ambiguity with tag openers.
// ---------------------------------------------------------------------------

describe("§51.3 — machine governing a struct type", () => {
  test("< machine name=DateRange for=Booking> produces engine-decl node", () => {
    // Guard uses >= to avoid ambiguity: BS treats bare < as a tag opener
    const src = `<program>
< machine name=DateRange for=Booking>
  * => * given (self.nights >= 1)
</>
</program>`;
    const ast = parseSnippet(src);
    const decls = findMachineDecls(ast);
    expect(decls.length).toBeGreaterThanOrEqual(1);
    expect(decls[0].engineName).toBe("DateRange");
    expect(decls[0].governedType).toBe("Booking");
  });

  test("struct-governing machine rulesRaw contains wildcard rule", () => {
    const src = `<program>
< machine name=InvRange for=Inventory>
  * => * given (self.qty >= 0)
</>
</program>`;
    const ast = parseSnippet(src);
    const decls = findMachineDecls(ast);
    expect(decls[0].rulesRaw).toContain("* => *");
    expect(decls[0].rulesRaw).toContain("self.qty");
  });
});

// ---------------------------------------------------------------------------
// §51.3-REG-1: Machine registered in type registry as MachineType
// ---------------------------------------------------------------------------

describe("§51.3 — MachineType registration in machine registry", () => {
  test("machine registered with kind: machine", () => {
    const typeDecls = [makeTypeDecl("Status", "enum", "{ A\nB }")];
    const typeRegistry = buildTypeRegistry(typeDecls, [], span());
    const machines = [makeMachineDecl("Flow", "Status", ".A => .B")];
    const errors = [];
    const registry = buildMachineRegistry(machines, typeRegistry, errors, span());

    expect(errors).toHaveLength(0);
    expect(registry.has("Flow")).toBe(true);
    const m = registry.get("Flow");
    expect(m.kind).toBe("machine");
  });

  test("machine entry has correct name and governedTypeName", () => {
    const typeDecls = [makeTypeDecl("Status", "enum", "{ A\nB }")];
    const typeRegistry = buildTypeRegistry(typeDecls, [], span());
    const machines = [makeMachineDecl("UserFlow", "Status", ".A => .B")];
    const errors = [];
    const registry = buildMachineRegistry(machines, typeRegistry, errors, span());

    const m = registry.get("UserFlow");
    expect(m.name).toBe("UserFlow");
    expect(m.governedTypeName).toBe("Status");
  });

  test("machine entry has rules array with parsed TransitionRule objects", () => {
    const typeDecls = [makeTypeDecl("Traffic", "enum", "{ Red\nGreen\nYellow }")];
    const typeRegistry = buildTypeRegistry(typeDecls, [], span());
    const machines = [makeMachineDecl("Light", "Traffic", ".Red => .Green\n.Green => .Yellow\n.Yellow => .Red")];
    const errors = [];
    const registry = buildMachineRegistry(machines, typeRegistry, errors, span());

    const m = registry.get("Light");
    expect(Array.isArray(m.rules)).toBe(true);
    expect(m.rules).toHaveLength(3);
    expect(m.rules[0].from).toBe("Red");
    expect(m.rules[0].to).toBe("Green");
    expect(m.rules[1].from).toBe("Green");
    expect(m.rules[1].to).toBe("Yellow");
    expect(m.rules[2].from).toBe("Yellow");
    expect(m.rules[2].to).toBe("Red");
  });

  test("struct-governing machine registered with correct governedType kind and label", () => {
    // At type-system level we pass rulesRaw directly — < operator is fine here
    const typeDecls = [makeTypeDecl("Booking", "struct", "{ start: number, end: number, nights: number }")];
    const typeRegistry = buildTypeRegistry(typeDecls, [], span());
    const machines = [makeMachineDecl("DateRange", "Booking", "* => * given (self.nights >= 1) [valid_date_range]")];
    const errors = [];
    const registry = buildMachineRegistry(machines, typeRegistry, errors, span());

    expect(errors).toHaveLength(0);
    const m = registry.get("DateRange");
    expect(m.kind).toBe("machine");
    expect(m.governedTypeName).toBe("Booking");
    expect(m.governedType.kind).toBe("struct");
    expect(m.rules[0].from).toBe("*");
    expect(m.rules[0].to).toBe("*");
    expect(m.rules[0].label).toBe("valid_date_range");
  });
});

// ---------------------------------------------------------------------------
// §51.3-ERR-1: E-ENGINE-003 — duplicate machine name
// ---------------------------------------------------------------------------

describe("§51.3 — E-ENGINE-003: duplicate machine name", () => {
  test("two machines with same name → E-ENGINE-003", () => {
    const typeDecls = [makeTypeDecl("Status", "enum", "{ A\nB }")];
    const typeRegistry = buildTypeRegistry(typeDecls, [], span());
    const machines = [
      makeMachineDecl("MyFlow", "Status", ".A => .B"),
      makeMachineDecl("MyFlow", "Status", ".B => .A"),
    ];
    const errors = [];
    buildMachineRegistry(machines, typeRegistry, errors, span());
    expect(errors.some(e => e.code === "E-ENGINE-003")).toBe(true);
  });

  test("E-ENGINE-003 message names the duplicate", () => {
    const typeDecls = [makeTypeDecl("Status", "enum", "{ A\nB }")];
    const typeRegistry = buildTypeRegistry(typeDecls, [], span());
    const machines = [
      makeMachineDecl("DupFlow", "Status", ".A => .B"),
      makeMachineDecl("DupFlow", "Status", ".B => .A"),
    ];
    const errors = [];
    buildMachineRegistry(machines, typeRegistry, errors, span());
    const err = errors.find(e => e.code === "E-ENGINE-003");
    expect(err.message).toContain("DupFlow");
  });

  test("first machine with duplicate name is registered; second is rejected", () => {
    const typeDecls = [makeTypeDecl("Status", "enum", "{ A\nB }")];
    const typeRegistry = buildTypeRegistry(typeDecls, [], span());
    const machines = [
      makeMachineDecl("FlowA", "Status", ".A => .B"),
      makeMachineDecl("FlowA", "Status", ".B => .A"),
    ];
    const errors = [];
    const registry = buildMachineRegistry(machines, typeRegistry, errors, span());
    expect(registry.size).toBe(1);
    expect(registry.has("FlowA")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §51.3-ERR-2: E-ENGINE-004 — unknown forType
// ---------------------------------------------------------------------------

describe("§51.3 — E-ENGINE-004: unknown forType", () => {
  test("machine referencing undeclared type → E-ENGINE-004", () => {
    const typeRegistry = new Map(BUILTIN_TYPES);
    const machines = [makeMachineDecl("Flow", "NoSuchType", ".A => .B")];
    const errors = [];
    buildMachineRegistry(machines, typeRegistry, errors, span());
    expect(errors.some(e => e.code === "E-ENGINE-004")).toBe(true);
  });

  test("E-ENGINE-004 message names the unknown type", () => {
    const typeRegistry = new Map(BUILTIN_TYPES);
    const machines = [makeMachineDecl("Flow", "GhostType", ".A => .B")];
    const errors = [];
    buildMachineRegistry(machines, typeRegistry, errors, span());
    const err = errors.find(e => e.code === "E-ENGINE-004");
    expect(err.message).toContain("GhostType");
  });

  test("machine governing a primitive type (number) → E-ENGINE-004", () => {
    const typeRegistry = new Map(BUILTIN_TYPES);
    const machines = [makeMachineDecl("Flow", "number", ".A => .B")];
    const errors = [];
    buildMachineRegistry(machines, typeRegistry, errors, span());
    expect(errors.some(e => e.code === "E-ENGINE-004")).toBe(true);
  });

  test("machine governing primitive type (string) → E-ENGINE-004", () => {
    const typeRegistry = new Map(BUILTIN_TYPES);
    const machines = [makeMachineDecl("Flow", "string", ".A => .B")];
    const errors = [];
    buildMachineRegistry(machines, typeRegistry, errors, span());
    expect(errors.some(e => e.code === "E-ENGINE-004")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §51.3-ERR-3: E-ENGINE-005 — empty machine body
// ---------------------------------------------------------------------------

describe("§51.3 — E-ENGINE-005: empty machine body", () => {
  test("machine with no rules → E-ENGINE-005", () => {
    const typeDecls = [makeTypeDecl("Status", "enum", "{ A\nB }")];
    const typeRegistry = buildTypeRegistry(typeDecls, [], span());
    const machines = [makeMachineDecl("EmptyFlow", "Status", "")];
    const errors = [];
    buildMachineRegistry(machines, typeRegistry, errors, span());
    expect(errors.some(e => e.code === "E-ENGINE-005")).toBe(true);
  });

  test("E-ENGINE-005 message names the empty machine", () => {
    const typeDecls = [makeTypeDecl("Status", "enum", "{ A\nB }")];
    const typeRegistry = buildTypeRegistry(typeDecls, [], span());
    const machines = [makeMachineDecl("VoidMachine", "Status", "")];
    const errors = [];
    buildMachineRegistry(machines, typeRegistry, errors, span());
    const err = errors.find(e => e.code === "E-ENGINE-005");
    expect(err.message).toContain("VoidMachine");
  });

  test("machine with only comment lines → E-ENGINE-005", () => {
    const typeDecls = [makeTypeDecl("Status", "enum", "{ A\nB }")];
    const typeRegistry = buildTypeRegistry(typeDecls, [], span());
    const machines = [makeMachineDecl("CommentOnly", "Status", "// just a comment\n// another comment")];
    const errors = [];
    buildMachineRegistry(machines, typeRegistry, errors, span());
    expect(errors.some(e => e.code === "E-ENGINE-005")).toBe(true);
  });
});
