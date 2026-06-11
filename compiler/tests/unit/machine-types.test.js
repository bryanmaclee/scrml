/**
 * §51.3 Machine Registry + Binding — Type System Unit Tests
 *
 * Tests buildMachineRegistry, parseMachineRules, resolveMachineBinding.
 */

import { describe, test, expect } from "bun:test";
import {
  buildMachineRegistry,
  buildTypeRegistry,
  resolveMachineBinding,
  parseMachineRules,
  tEnum,
  tStruct,
  tPrimitive,
  BUILTIN_TYPES,
} from "../../src/type-system.js";

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
// §51.3-a: Basic machine registry
// ---------------------------------------------------------------------------

describe("§51.3-a buildMachineRegistry — basic", () => {
  test("registers a machine with rules", () => {
    const typeDecls = [makeTypeDecl("Column", "enum", "{ Todo\nDone }")];
    const typeRegistry = buildTypeRegistry(typeDecls, [], span());
    const machines = [makeMachineDecl("UserFlow", "Column", ".Todo => .Done")];
    const errors = [];
    const registry = buildMachineRegistry(machines, typeRegistry, errors, span());

    expect(errors).toHaveLength(0);
    expect(registry.size).toBe(1);
    const m = registry.get("UserFlow");
    expect(m.kind).toBe("machine");
    expect(m.name).toBe("UserFlow");
    expect(m.governedTypeName).toBe("Column");
    expect(m.rules).toHaveLength(1);
    expect(m.rules[0].from).toBe("Todo");
    expect(m.rules[0].to).toBe("Done");
  });

  test("multiple rules parsed", () => {
    const typeDecls = [makeTypeDecl("Status", "enum", "{ A\nB\nC }")];
    const typeRegistry = buildTypeRegistry(typeDecls, [], span());
    const machines = [makeMachineDecl("Flow", "Status", ".A => .B\n.B => .C\n.A => .C")];
    const errors = [];
    const registry = buildMachineRegistry(machines, typeRegistry, errors, span());

    expect(errors).toHaveLength(0);
    expect(registry.get("Flow").rules).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// §51.3-b: E-ENGINE-003 — duplicate machine name
// ---------------------------------------------------------------------------

describe("§51.3-b E-ENGINE-003: duplicate machine name", () => {
  test("emits error for duplicate machine name", () => {
    const typeDecls = [makeTypeDecl("Status", "enum", "{ A\nB }")];
    const typeRegistry = buildTypeRegistry(typeDecls, [], span());
    const machines = [
      makeMachineDecl("Flow", "Status", ".A => .B"),
      makeMachineDecl("Flow", "Status", ".B => .A"),
    ];
    const errors = [];
    buildMachineRegistry(machines, typeRegistry, errors, span());
    expect(errors.some(e => e.code === "E-ENGINE-003")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §51.3-c: E-ENGINE-004 — unknown or invalid governed type
// ---------------------------------------------------------------------------

describe("§51.3-c E-ENGINE-004: governed type validation", () => {
  test("unknown type → E-ENGINE-004", () => {
    const typeRegistry = new Map(BUILTIN_TYPES);
    const machines = [makeMachineDecl("Flow", "Nonexistent", ".A => .B")];
    const errors = [];
    buildMachineRegistry(machines, typeRegistry, errors, span());
    expect(errors.some(e => e.code === "E-ENGINE-004")).toBe(true);
  });

  test("primitive type → E-ENGINE-004", () => {
    const typeRegistry = new Map(BUILTIN_TYPES);
    const machines = [makeMachineDecl("Flow", "number", ".A => .B")];
    const errors = [];
    buildMachineRegistry(machines, typeRegistry, errors, span());
    expect(errors.some(e => e.code === "E-ENGINE-004")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §51.3-d: E-ENGINE-005 — empty machine body
// ---------------------------------------------------------------------------

describe("§51.3-d E-ENGINE-005: empty machine body", () => {
  test("machine with no rules → E-ENGINE-005", () => {
    const typeDecls = [makeTypeDecl("Status", "enum", "{ A\nB }")];
    const typeRegistry = buildTypeRegistry(typeDecls, [], span());
    const machines = [makeMachineDecl("Flow", "Status", "")];
    const errors = [];
    buildMachineRegistry(machines, typeRegistry, errors, span());
    expect(errors.some(e => e.code === "E-ENGINE-005")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §51.3-e: Guards in machine rules (permitted, unlike type-level)
// ---------------------------------------------------------------------------

describe("§51.3-e machine rules with guards", () => {
  test("guard is parsed and stored", () => {
    const typeDecls = [makeTypeDecl("Col", "enum", "{ A\nB }")];
    const typeRegistry = buildTypeRegistry(typeDecls, [], span());
    const machines = [makeMachineDecl("AdminFlow", "Col", ".A => .B given (@isAdmin)")];
    const errors = [];
    const registry = buildMachineRegistry(machines, typeRegistry, errors, span());
    expect(errors).toHaveLength(0);
    const m = registry.get("AdminFlow");
    expect(m.rules[0].guard).toBe("@isAdmin");
  });
});

// ---------------------------------------------------------------------------
// §51.3-f: E-ENGINE-004 — invalid variant in machine rule
// ---------------------------------------------------------------------------

describe("§51.3-f E-ENGINE-004: invalid variant in rule", () => {
  test("unknown from variant → E-ENGINE-004", () => {
    const typeDecls = [makeTypeDecl("Status", "enum", "{ A\nB }")];
    const typeRegistry = buildTypeRegistry(typeDecls, [], span());
    const machines = [makeMachineDecl("Flow", "Status", ".X => .B")];
    const errors = [];
    buildMachineRegistry(machines, typeRegistry, errors, span());
    expect(errors.some(e => e.code === "E-ENGINE-004" && e.message.includes("X"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §51.3-g: Struct-governing machine with self.* guards
// ---------------------------------------------------------------------------

describe("§51.3-g struct-governing machine", () => {
  test("wildcard rules with self.* guards accepted", () => {
    const typeDecls = [makeTypeDecl("Booking", "struct", "{ start: number, end: number }")];
    const typeRegistry = buildTypeRegistry(typeDecls, [], span());
    const machines = [makeMachineDecl("DateRange", "Booking", "* => * given (self.start < self.end) [valid_range]")];
    const errors = [];
    const registry = buildMachineRegistry(machines, typeRegistry, errors, span());
    expect(errors).toHaveLength(0);
    const m = registry.get("DateRange");
    expect(m.rules).toHaveLength(1);
    expect(m.rules[0].from).toBe("*");
    expect(m.rules[0].to).toBe("*");
    expect(m.rules[0].guard).toContain("self.start");
    expect(m.rules[0].label).toBe("valid_range");
  });

  test("E-ENGINE-013: undefined field in self.* → error", () => {
    const typeDecls = [makeTypeDecl("Booking", "struct", "{ start: number, end: number }")];
    const typeRegistry = buildTypeRegistry(typeDecls, [], span());
    const machines = [makeMachineDecl("Bad", "Booking", "* => * given (self.bogus > 0)")];
    const errors = [];
    buildMachineRegistry(machines, typeRegistry, errors, span());
    expect(errors.some(e => e.code === "E-ENGINE-013")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §51.3-h: resolveMachineBinding
// ---------------------------------------------------------------------------

describe("§51.3-h resolveMachineBinding", () => {
  test("resolves annotation to machine", () => {
    const typeDecls = [makeTypeDecl("Status", "enum", "{ A\nB }")];
    const typeRegistry = buildTypeRegistry(typeDecls, [], span());
    const machines = [makeMachineDecl("Flow", "Status", ".A => .B")];
    const errors = [];
    const machineRegistry = buildMachineRegistry(machines, typeRegistry, errors, span());
    const result = resolveMachineBinding("Flow", machineRegistry);
    expect(result).not.toBeNull();
    expect(result.name).toBe("Flow");
  });

  test("returns null for non-machine annotation", () => {
    const machineRegistry = new Map();
    expect(resolveMachineBinding("string", machineRegistry)).toBeNull();
    expect(resolveMachineBinding(null, machineRegistry)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// §51.3-i: Multiple machines for same enum
// ---------------------------------------------------------------------------

describe("§51.3-i multiple machines for same enum", () => {
  test("two machines governing the same type are both registered", () => {
    const typeDecls = [makeTypeDecl("Status", "enum", "{ A\nB\nC }")];
    const typeRegistry = buildTypeRegistry(typeDecls, [], span());
    const machines = [
      makeMachineDecl("UserFlow", "Status", ".A => .B"),
      makeMachineDecl("AdminFlow", "Status", ".A => .B\n.B => .A\n.C => .A"),
    ];
    const errors = [];
    const registry = buildMachineRegistry(machines, typeRegistry, errors, span());
    expect(errors).toHaveLength(0);
    expect(registry.size).toBe(2);
    expect(registry.get("UserFlow").rules).toHaveLength(1);
    expect(registry.get("AdminFlow").rules).toHaveLength(3);
  });
});
