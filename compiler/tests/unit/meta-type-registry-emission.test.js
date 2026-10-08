/**
 * meta-type-registry-emission.test.js — typeRegistry Codegen Tests
 *
 * Tests for the emitTypeRegistryLiteral() helper in emit-logic.ts.
 * Covers SPEC §22.5.4: runtime type registry generation for ^{} meta blocks.
 *
 * The emitTypeRegistryLiteral() function reads node.typeRegistrySnapshot
 * (a TypeRegistryEntry[] set by the meta-checker pass) and emits an object
 * literal that maps type names to reflection data.
 *
 * Coverage:
 *   TR-1  Meta node with no typeRegistrySnapshot emits "null"
 *   TR-2  Enum type emits { kind: "enum", variants: [...] }
 *   TR-3  Struct type emits { kind: "struct", fields: [...] }
 *   TR-4  Multiple types emit correctly as separate properties
 *   TR-5  Emitted object uses quoted type name as key
 *   TR-6  Empty typeRegistrySnapshot (empty array) emits "null"
 */

import { describe, test, expect } from "bun:test";
import { emitLogicNode } from "../../src/codegen/emit-logic.js";
import { resetVarCounter } from "../../src/codegen/var-counter.ts";

function resetAndRun(fn) {
  resetVarCounter();
  return fn();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMetaNodeWithTypes(body, id, typeRegistrySnapshot) {
  return {
    kind: "meta",
    body,
    ...(id != null ? { id } : {}),
    ...(typeRegistrySnapshot != null ? { typeRegistrySnapshot } : {}),
    span: { file: "/test/app.scrml", start: 0, end: 10, line: 1, col: 1 },
  };
}

function makeBareExpr(expr) {
  return { kind: "bare-expr", expr };
}

// ---------------------------------------------------------------------------
// TR-1: No typeRegistrySnapshot → null
// ---------------------------------------------------------------------------

describe("meta-type-registry-emission TR-1: no typeRegistrySnapshot → null", () => {
  test("meta node with no typeRegistrySnapshot emits null for typeRegistry", () => {
    const node = makeMetaNodeWithTypes([makeBareExpr('meta.emit("x")')], 1, undefined);
    const output = emitLogicNode(node);
    // Both capturedBindings and typeRegistry are null when not annotated
    expect(output).toContain("}, null, null);");
  });
});

// ---------------------------------------------------------------------------
// TR-2: Enum type
// ---------------------------------------------------------------------------

describe("meta-type-registry-emission TR-2: enum type emission", () => {
  test("enum type emits kind, variants array", () => {
    const node = makeMetaNodeWithTypes([makeBareExpr('meta.emit("x")')], 2, [
      {
        name: "Color",
        kind: "enum",
        variants: [{ name: "Red" }, { name: "Green" }, { name: "Blue" }],
      },
    ]);
    const output = emitLogicNode(node);
    expect(output).toContain('"Color"');
    expect(output).toContain('kind: "enum"');
    expect(output).toContain('"Red"');
    expect(output).toContain('"Green"');
    expect(output).toContain('"Blue"');
    expect(output).toContain("variants:");
  });

  test("enum variants are emitted as bare name strings (§14.4.2)", () => {
    const node = makeMetaNodeWithTypes([makeBareExpr('meta.emit("x")')], 2, [
      {
        name: "Status",
        kind: "enum",
        variants: [{ name: "Active" }, { name: "Inactive" }],
      },
    ]);
    const output = emitLogicNode(node);
    expect(output).toContain('"Active"');
    expect(output).toContain('"Inactive"');
    expect(output).not.toContain('{name: "Active"}');
  });
});

// ---------------------------------------------------------------------------
// TR-3: Struct type
// ---------------------------------------------------------------------------

describe("meta-type-registry-emission TR-3: struct type emission", () => {
  test("struct type emits kind, fields array", () => {
    const node = makeMetaNodeWithTypes([makeBareExpr('meta.emit("x")')], 3, [
      {
        name: "Point",
        kind: "struct",
        fields: [
          { name: "x", type: "number" },
          { name: "y", type: "number" },
        ],
      },
    ]);
    const output = emitLogicNode(node);
    expect(output).toContain('"Point"');
    expect(output).toContain('kind: "struct"');
    expect(output).toContain('"x"');
    expect(output).toContain('"y"');
    expect(output).toContain("fields:");
  });

  test("struct fields include name and type", () => {
    const node = makeMetaNodeWithTypes([makeBareExpr('meta.emit("x")')], 3, [
      {
        name: "User",
        kind: "struct",
        fields: [
          { name: "id", type: "number" },
          { name: "name", type: "string" },
        ],
      },
    ]);
    const output = emitLogicNode(node);
    expect(output).toContain('{name: "id", type: "number"}');
    expect(output).toContain('{name: "name", type: "string"}');
  });
});

// ---------------------------------------------------------------------------
// TR-4: Multiple types
// ---------------------------------------------------------------------------

describe("meta-type-registry-emission TR-4: multiple types", () => {
  test("multiple types emit as separate object properties", () => {
    const node = makeMetaNodeWithTypes([makeBareExpr('meta.emit("x")')], 4, [
      {
        name: "Color",
        kind: "enum",
        variants: [{ name: "Red" }],
      },
      {
        name: "Point",
        kind: "struct",
        fields: [{ name: "x", type: "number" }],
      },
    ]);
    const output = emitLogicNode(node);
    expect(output).toContain('"Color"');
    expect(output).toContain('"Point"');
    expect(output).toContain('kind: "enum"');
    expect(output).toContain('kind: "struct"');
  });
});

// ---------------------------------------------------------------------------
// TR-5: Type name as quoted key
// ---------------------------------------------------------------------------

describe("meta-type-registry-emission TR-5: type name as quoted key", () => {
  test("type name appears as quoted key in emitted object", () => {
    const node = makeMetaNodeWithTypes([makeBareExpr('meta.emit("x")')], 5, [
      {
        name: "MyType",
        kind: "enum",
        variants: [{ name: "A" }],
      },
    ]);
    const output = emitLogicNode(node);
    // Type name is quoted: "MyType": { kind: "enum", ... }
    expect(output).toMatch(/"MyType"\s*:/);
  });
});

// ---------------------------------------------------------------------------
// TR-6: Empty snapshot → null
// ---------------------------------------------------------------------------

describe("meta-type-registry-emission TR-6: empty snapshot → null", () => {
  test("empty typeRegistrySnapshot array emits null", () => {
    const node = makeMetaNodeWithTypes([makeBareExpr('meta.emit("x")')], 6, []);
    const output = emitLogicNode(node);
    // Empty registry falls back to null (same as no registry)
    expect(output).toContain("}, null, null);");
  });
});
