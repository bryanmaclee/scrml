/**
 * Enum-to-runtime bridge — Unit Tests (§14.4)
 *
 * Tests that enum types produce runtime objects so devs can write
 * @status = Status.Loading and Status.toEnum(str).
 */

import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { emitEnumVariantObjects, emitEnumLookupTables } from "../../src/codegen/emit-client.ts";

function makeFileAST(source) {
  const bsOut = splitBlocks("test.scrml", source);
  return buildAST(bsOut).ast;
}

describe("enum variant objects (§14.4)", () => {
  test("enum type produces frozen variant object", () => {
    const src = '<program>${ type Status:enum = { Loading, Success, Error } }</>';
    const ast = makeFileAST(src);
    const lines = emitEnumVariantObjects(ast);
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("const Status = _scrml_g.Object.freeze(");
    expect(lines[0]).toContain('Loading: "Loading"');
    expect(lines[0]).toContain('Success: "Success"');
    expect(lines[0]).toContain('Error: "Error"');
  });

  test("no output for non-enum types", () => {
    const src = '<program>${ type Point:struct = { x: number, y: number } }</>';
    const ast = makeFileAST(src);
    const lines = emitEnumVariantObjects(ast);
    expect(lines.length).toBe(0);
  });

  test("multiple enums produce multiple objects", () => {
    const src = '<program>${ type Status:enum = { Loading, Done }\ntype Color:enum = { Red, Green, Blue } }</>';
    const ast = makeFileAST(src);
    const lines = emitEnumVariantObjects(ast);
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain("Status");
    expect(lines[1]).toContain("Color");
  });
});

describe("enum toEnum() lookup tables (§14.4.1)", () => {
  test("enum produces toEnum lookup", () => {
    const src = '<program>${ type Status:enum = { Loading, Success, Error } }</>';
    const ast = makeFileAST(src);
    const lines = emitEnumLookupTables(ast);
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain("Status_toEnum");
    expect(lines[0]).toContain('"Loading": "Loading"');
    expect(lines[1]).toContain("Status_variants");
  });
});

describe("EnumType.variants built-in (§14.4.2)", () => {
  test("variants array contains all unit variants in declaration order", () => {
    const src = '<program>${ type Direction:enum = { North, South, East, West } }</>';
    const ast = makeFileAST(src);
    const lines = emitEnumVariantObjects(ast);
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain('variants: ["North", "South", "East", "West"]');
  });

  test("variants array order matches declaration order", () => {
    const src = '<program>${ type Status:enum = { Loading, Success, Error } }</>';
    const ast = makeFileAST(src);
    const lines = emitEnumVariantObjects(ast);
    expect(lines.length).toBe(1);
    const match = lines[0].match(/variants: \[([^\]]+)\]/);
    expect(match).not.toBeNull();
    const variantsList = match[1].split(", ").map(s => s.replace(/"/g, ""));
    expect(variantsList).toEqual(["Loading", "Success", "Error"]);
  });

  test("variants array is part of the frozen object (same const)", () => {
    const src = '<program>${ type Color:enum = { Red, Green, Blue } }</>';
    const ast = makeFileAST(src);
    const lines = emitEnumVariantObjects(ast);
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain('Red: "Red"');
    expect(lines[0]).toContain('Green: "Green"');
    expect(lines[0]).toContain('Blue: "Blue"');
    expect(lines[0]).toContain('variants: ["Red", "Green", "Blue"]');
  });

  test("variants array for enum with payload variants includes all names", () => {
    const src = '<program>${ type Result:enum = { Ok, Err(message: string) } }</>';
    const ast = makeFileAST(src);
    const lines = emitEnumVariantObjects(ast);
    // Ok is a unit variant and should appear in the frozen object
    // The variants array should include both Ok and Err
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain('Ok: "Ok"');
    expect(lines[0]).toContain('variants: [');
    expect(lines[0]).toContain('"Ok"');
    expect(lines[0]).toContain('"Err"');
  });

  test("multiple enums each get their own variants array", () => {
    const src = '<program>${ type A:enum = { X, Y }\ntype B:enum = { P, Q, R } }</>';
    const ast = makeFileAST(src);
    const lines = emitEnumVariantObjects(ast);
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain('variants: ["X", "Y"]');
    expect(lines[1]).toContain('variants: ["P", "Q", "R"]');
  });

  test("single-variant enum has variants array with one element", () => {
    const src = '<program>${ type Flag:enum = { Active } }</>';
    const ast = makeFileAST(src);
    const lines = emitEnumVariantObjects(ast);
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain('variants: ["Active"]');
  });
});
