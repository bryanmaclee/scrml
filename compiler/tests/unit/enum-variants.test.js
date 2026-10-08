/**
 * Enum Variants + Variant Construction — Unit Tests
 *
 * Tests for:
 *   Feature 1: EnumType.variants runtime API (§14.4.2)
 *     - rewrite Color.variants → Color_variants
 *     - emitEnumLookupTables generates _variants arrays
 *   Feature 2: Enum variant construction as expression (§14.5, §51.3.2 S22)
 *     - `Shape.Circle(5)` is a CALL to the compiler-emitted constructor function,
 *       NOT a string rewrite. rewriteEnumVariantAccess leaves the call intact;
 *       the emitted `const Shape = Object.freeze({ Circle: function(r) {...} })`
 *       produces `{ variant: "Circle", data: { r: 5 } }` at runtime.
 *     - unit variant regression (Direction.North stays as-is)
 *   Feature 3: Construction through rewrite pipeline preserves call expressions
 *     (was "nested-paren payload fix" — nested parens were only a concern for the
 *      removed inline string rewrite; the constructor-function model handles them
 *      trivially since JS parses the call naturally).
 */

import { describe, test, expect } from "bun:test";
import {
  rewriteEnumVariantAccess,
  rewriteExpr,
} from "../../src/codegen/rewrite.ts";
import { emitEnumLookupTables, emitEnumVariantObjects } from "../../src/codegen/emit-client.ts";

// ---------------------------------------------------------------------------
// §1–5  EnumType.variants rewrite
// ---------------------------------------------------------------------------

describe("EnumType.variants rewrite", () => {
  test("§1 rewriteEnumVariantAccess rewrites Color.variants to Color_variants", () => {
    expect(rewriteEnumVariantAccess("Color.variants")).toBe("Color_variants");
  });

  test("§2 rewriteExpr propagates the .variants rewrite", () => {
    expect(rewriteExpr("Color.variants")).toBe("Color_variants");
  });

  test("§3 non-PascalCase obj.variants is not rewritten", () => {
    expect(rewriteEnumVariantAccess("obj.variants")).toBe("obj.variants");
    expect(rewriteEnumVariantAccess("myEnum.variants")).toBe("myEnum.variants");
    expect(rewriteEnumVariantAccess("_Foo.variants")).toBe("_Foo.variants");
  });

  test("§4 multiple enums each get their own variants array", () => {
    const fileAST = {
      typeDecls: [
        {
          kind: "type-decl",
          typeKind: "enum",
          name: "Color",
          variants: [
            { name: "Red", payload: null },
            { name: "Green", payload: null },
            { name: "Blue", payload: null },
          ],
        },
        {
          kind: "type-decl",
          typeKind: "enum",
          name: "Direction",
          variants: [
            { name: "North", payload: null },
            { name: "South", payload: null },
          ],
        },
      ],
    };

    const lines = emitEnumLookupTables(fileAST);
    const variantsLines = lines.filter((l) => l.includes("_variants"));
    expect(variantsLines).toHaveLength(2);
    expect(variantsLines[0]).toBe('const Color_variants = ["Red", "Green", "Blue"];');
    expect(variantsLines[1]).toBe('const Direction_variants = ["North", "South"];');
  });

  test("§5 emitEnumLookupTables generates variants array for enum with mixed unit/payload variants", () => {
    const fileAST = {
      typeDecls: [
        {
          kind: "type-decl",
          typeKind: "enum",
          name: "Shape",
          variants: [
            { name: "Circle", payload: new Map([["radius", { kind: "number" }]]) },
            { name: "Square", payload: null },
            { name: "Triangle", payload: null },
          ],
        },
      ],
    };

    const lines = emitEnumLookupTables(fileAST);
    const variantsLine = lines.find((l) => l.includes("_variants"));
    expect(variantsLine).toBe('const Shape_variants = ["Circle", "Square", "Triangle"];');
  });
});

// ---------------------------------------------------------------------------
// §6–8  Enum variant construction
// ---------------------------------------------------------------------------

describe("Enum variant construction", () => {
  test("§6 unit variant Direction.North is unchanged (accessed via frozen object)", () => {
    // Direction.North stays as property access on the frozen enum object.
    // It is NOT rewritten to "North" — the frozen object handles that.
    expect(rewriteEnumVariantAccess("Direction.North")).toBe("Direction.North");
  });

  test("§7 payload variant Shape.Circle(5) is left as a call to the constructor", () => {
    // Construction is via the emitted constructor function, not a string rewrite.
    // `Shape.Circle(5)` → calls `Shape.Circle(5)` → returns `{ variant, data }`.
    expect(rewriteEnumVariantAccess("Shape.Circle(5)")).toBe("Shape.Circle(5)");
  });

  test("§7b payload variant with complex expression is preserved verbatim", () => {
    expect(rewriteEnumVariantAccess("Result.Found(user.id)")).toBe("Result.Found(user.id)");
  });

  test("§7c payload variant through rewriteExpr pipeline is left unchanged", () => {
    expect(rewriteExpr("Shape.Circle(radius)")).toBe("Shape.Circle(radius)");
  });

  test("§8 emitted constructor produces the spec-aligned tagged-object shape at runtime", () => {
    // Replicates what emitEnumVariantObjects writes for the `Shape` enum.
    const fileAST = {
      typeDecls: [
        {
          kind: "type-decl",
          typeKind: "enum",
          name: "Shape",
          variants: [
            { name: "Circle", payload: new Map([["r", { kind: "number" }]]) },
            { name: "Unit", payload: null },
          ],
        },
      ],
    };
    const lines = emitEnumVariantObjects(fileAST);
    // Build a sandbox scope by eval'ing the emitted `const Shape = ...` line.
    const code = lines[0] + "; (Shape.Circle(42))";
    const constructed = new Function("const _scrml_g = globalThis;\n" + code.replace("const Shape", "var Shape") + "; return Shape.Circle(42);")();
    expect(constructed).toEqual({ variant: "Circle", data: { r: 42 } });
  });

  test("§8b emitted constructor preserves unit variants as strings", () => {
    const fileAST = {
      typeDecls: [
        {
          kind: "type-decl",
          typeKind: "enum",
          name: "Status",
          variants: [
            { name: "Loading", payload: null },
            { name: "Ready", payload: null },
          ],
        },
      ],
    };
    const lines = emitEnumVariantObjects(fileAST);
    const getUnit = new Function("const _scrml_g = globalThis;\n" + lines[0].replace("const Status", "var Status") + "; return Status.Loading;");
    expect(getUnit()).toBe("Loading");
  });
});

// ---------------------------------------------------------------------------
// §9–13  Nested-paren payload fix (Bug 3, P0-CODEGEN-ADVANCED-FEATURES)
// The old regex `([^)]*)` terminated early on nested parens.
// The fix uses balanced-paren extraction.
// ---------------------------------------------------------------------------

describe("Enum variant construction preserves call expressions (nested parens, chains)", () => {
  // Under the constructor-function model, rewriteEnumVariantAccess must NOT
  // touch `EnumType.Variant(...)` — the JS parser handles nested parens,
  // method chains, and labeled-expression payloads naturally at runtime.

  test("§9 payload with nested function call argument is preserved verbatim", () => {
    const result = rewriteEnumVariantAccess("GameStatus.Playing(eatPowerUp(m, p))");
    expect(result).toBe("GameStatus.Playing(eatPowerUp(m, p))");
  });

  test("§10 payload with two levels of nesting is preserved verbatim", () => {
    const result = rewriteEnumVariantAccess("State.Active(compute(a, add(b, c)))");
    expect(result).toBe("State.Active(compute(a, add(b, c)))");
  });

  test("§11 payload with method chain in argument is preserved verbatim", () => {
    const result = rewriteEnumVariantAccess("Result.Ok(items.map(x => x.id))");
    expect(result).toBe("Result.Ok(items.map(x => x.id))");
  });

  test("§12 payload with named parameter (colon syntax in arg) is preserved verbatim", () => {
    const result = rewriteEnumVariantAccess("GameStatus.Playing(mario: eatPowerUp(m, p))");
    expect(result).toBe("GameStatus.Playing(mario: eatPowerUp(m, p))");
  });

  test("§13 simple payload call is preserved verbatim", () => {
    expect(rewriteEnumVariantAccess("Shape.Circle(5)")).toBe("Shape.Circle(5)");
  });

  test("§13b multiple payload constructions in one expression are all preserved", () => {
    const result = rewriteEnumVariantAccess("let a = X.Foo(f(1, 2)); let b = X.Bar(g(3))");
    expect(result).toContain("X.Foo(f(1, 2))");
    expect(result).toContain("X.Bar(g(3))");
  });
});
