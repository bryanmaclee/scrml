/* SPDX-License-Identifier: MIT
 *
 * Unit — §59.12 Value-Native Set, D1 TYPE-SYSTEM foundation (B2 map-alias).
 *
 * A set (`set[K]`) is a THIN DESUGAR over the §59 value-native map: it resolves
 * to the map `[K: bool]` carrying a `set` flag (the membership marker `true` is
 * compiler-internal, never author-visible). This test pins the D1 pieces:
 *   1. resolveTypeExpr recognizes `set[K]` → a MapType keyed K → bool, set=true
 *   2. formatTypeForDiagnostic renders `set[K]` (NOT the `[K: bool]` desugar)
 *   3. set-element comparability is inherited (E-MAP-KEY-NOT-COMPARABLE / -IS-MAP)
 *   4. the E-MAP-BRACKET-WRITE gate fires on a set cell (write is method-native)
 *   5. `set` is NOT mis-classified as an unknown type name (forEachTypeNameLeaf)
 */

import { describe, expect, test } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import {
  runTS,
  resolveTypeExpr,
  tPrimitive,
  tStruct,
  tEnum,
  formatTypeForDiagnostic,
} from "../../src/type-system.ts";

function tsErrors(source, filePath = "set-d1.scrml") {
  const bs = splitBlocks(filePath, source);
  const { ast } = buildAST(bs);
  const res = runTS({
    files: [{ ...ast, filePath }],
    protectAnalysis: { views: new Map() },
    routeMap: { functions: new Map() },
  });
  return res.errors;
}

function codes(errs, code) {
  return errs.filter((e) => e.code === code);
}

function reg() {
  const r = new Map();
  r.set("Money", tPrimitive("number"));
  r.set("Route", tStruct("Route", new Map([
    ["id", tPrimitive("string")],
    ["lane", tPrimitive("number")],
  ])));
  r.set("Color", tEnum("Color", [
    { name: "Red", payload: null, renders: null },
    { name: "Green", payload: null, renders: null },
  ], null));
  return r;
}

// ---------------------------------------------------------------------------
// Piece 1 — resolveTypeExpr recognizer
// ---------------------------------------------------------------------------

describe("§59.12 D1 — resolveTypeExpr `set[K]` recognizer", () => {
  test("`set[string]` resolves to a MapType keyed string → bool, set=true", () => {
    const t = resolveTypeExpr("set[string]", reg());
    expect(t.kind).toBe("map");
    expect(t.set).toBe(true);
    expect(t.key.kind).toBe("primitive");
    expect(t.key.name).toBe("string");
    expect(t.value.kind).toBe("primitive");
    expect(t.value.name).toBe("boolean");
    expect(t.ordered).toBe(false);
  });

  test("`set[int]` resolves the alias element type (int → integer)", () => {
    const t = resolveTypeExpr("set[int]", reg());
    expect(t.kind).toBe("map");
    expect(t.set).toBe(true);
    expect(t.key.name).toBe("integer");
  });

  test("`set[Route]` resolves a struct element type", () => {
    const t = resolveTypeExpr("set[Route]", reg());
    expect(t.kind).toBe("map");
    expect(t.set).toBe(true);
    expect(t.key.kind).toBe("struct");
    expect(t.key.name).toBe("Route");
  });

  test("`set[Color]` resolves an enum element type", () => {
    const t = resolveTypeExpr("set[Color]", reg());
    expect(t.kind).toBe("map");
    expect(t.set).toBe(true);
    expect(t.key.kind).toBe("enum");
  });

  test("a plain map `[string: number]` is NOT flagged as a set", () => {
    const t = resolveTypeExpr("[string: number]", reg());
    expect(t.kind).toBe("map");
    expect(t.set).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// Piece 2 — diagnostic display
// ---------------------------------------------------------------------------

describe("§59.12 D1 — formatTypeForDiagnostic renders `set[K]`", () => {
  test("a set renders as `set[K]`, not the `[K: bool]` desugar", () => {
    expect(formatTypeForDiagnostic(resolveTypeExpr("set[string]", reg()))).toBe("set[string]");
    expect(formatTypeForDiagnostic(resolveTypeExpr("set[Route]", reg()))).toBe("set[Route]");
  });
});

// ---------------------------------------------------------------------------
// Piece 3 — element comparability inherited from the map key domain (§59.4)
// ---------------------------------------------------------------------------

describe("§59.12 D1 — set-element comparability (inherited §59.4)", () => {
  test("a set OF maps is rejected (E-MAP-KEY-IS-MAP) — element is the map key position", () => {
    const e = tsErrors(`function go() { let s: set[[string: number]] = 0 }`);
    expect(codes(e, "E-MAP-KEY-IS-MAP").length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Piece 4 — E-MAP-BRACKET-WRITE gate fires on a set cell (§59.7/§59.12)
// ---------------------------------------------------------------------------

describe("§59.12 D1 — E-MAP-BRACKET-WRITE on a set cell (write is method-native)", () => {
  test("string-key bracket-write on a set cell -> E-MAP-BRACKET-WRITE naming `.add`", () => {
    const e = tsErrors(`<s>: set[string] = 0\nfunction go() { @s["DAL"] = true }`);
    const hits = codes(e, "E-MAP-BRACKET-WRITE");
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0].message).toContain(".add(k)");
    expect(hits[0].message).toContain("set cell");
  });

  test("bracket-write on a plain ARRAY cell still does NOT fire E-MAP-BRACKET-WRITE", () => {
    const e = tsErrors(`<arr>: number[] = 0\nfunction go() { @arr[0] = 5 }`);
    expect(codes(e, "E-MAP-BRACKET-WRITE")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Piece 5 — `set` is not an unknown type name
// ---------------------------------------------------------------------------

describe("§59.12 D1 — `set` affix is not an unknown type name", () => {
  test("a `set[string]` decl does NOT fire E-TYPE-UNKNOWN-NAME on `set`", () => {
    const e = tsErrors(`<s>: set[string] = 0`);
    const unknowns = codes(e, "E-TYPE-UNKNOWN-NAME").filter((x) => /\bset\b/.test(x.message));
    expect(unknowns).toHaveLength(0);
  });
});
