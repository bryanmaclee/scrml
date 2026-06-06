/* SPDX-License-Identifier: MIT
 *
 * Unit — §59 Value-Native Maps, D1 TYPE-SYSTEM foundation (S169, map-build phase-c).
 *
 * D1 registers the value-native `[KeyT: ValT]` map type in the type system. This
 * is the foundation the downstream phases (D2 parser, D3 runtime, D4 codegen) key
 * on (`rt.kind === "map"`). The six D1 pieces:
 *   1. MapType in the ResolvedType union + tMap ctor
 *   2. resolveTypeExpr `[K:V]` recognizer (depth-1 entry-colon, ternary-excluded)
 *   3. @ordered postfix affix strip
 *   4. formatTypeForDiagnostic map arm
 *   5. key-comparability check (E-EQ-003 / E-MAP-KEY-IS-MAP / E-MAP-KEY-NOT-COMPARABLE)
 *      at the decl-binding sites
 *   6. E-MAP-BRACKET-WRITE gate in the reactive-nested-assign case
 *
 * R26 does NOT apply here: there is no map SOURCE to compile (the `[:]` / `[k:v]`
 * literal parser is D2). So the recognizer is tested at the TYPER level
 * (`resolveTypeExpr` + the comparability helpers, directly), and the fire-sites
 * are tested through the real `splitBlocks → buildAST → runTS` pipeline using the
 * no-RHS / typed-decl map ANNOTATION (which needs no map literal) plus a
 * bracket-write inside a `function` body (which the existing reactive-nested-assign
 * machinery already produces — bracket-write parsing is shared with arrays).
 */

import { describe, expect, test } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import {
  runTS,
  resolveTypeExpr,
  tMap,
  tPrimitive,
  tStruct,
  tEnum,
  tArray,
  findMapEntryColon,
  isComparableType,
  typeContainsFunctionField,
  classifyMapKey,
} from "../../src/type-system.ts";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function tsErrors(source, filePath = "map-d1.scrml") {
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

// A small registry mirroring what the type-decl pass would populate.
function reg() {
  const r = new Map();
  r.set("Money", tPrimitive("number"));
  r.set("User", tStruct("User", new Map([["name", tPrimitive("string")]])));
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
// Piece 2/3 — resolveTypeExpr recognizer + @ordered strip
// ---------------------------------------------------------------------------

describe("§59 D1 — resolveTypeExpr `[K:V]` map recognizer", () => {
  test("`[string: Money]` resolves to a MapType (string key, number value)", () => {
    const t = resolveTypeExpr("[string: Money]", reg());
    expect(t.kind).toBe("map");
    expect(t.key.kind).toBe("primitive");
    expect(t.key.name).toBe("string");
    expect(t.value.kind).toBe("primitive");
    expect(t.value.name).toBe("number");
    expect(t.ordered).toBe(false);
  });

  test("`[int: User]` resolves to a MapType (integer key, struct value)", () => {
    const t = resolveTypeExpr("[int: User]", reg());
    expect(t.kind).toBe("map");
    expect(t.key.kind).toBe("primitive");
    expect(t.key.name).toBe("integer");
    expect(t.value.kind).toBe("struct");
    expect(t.value.name).toBe("User");
  });

  test("`[Route: Money]` resolves to a MapType with a STRUCT key", () => {
    const t = resolveTypeExpr("[Route: Money]", reg());
    expect(t.kind).toBe("map");
    expect(t.key.kind).toBe("struct");
    expect(t.key.name).toBe("Route");
    expect(t.value.name).toBe("number");
  });

  test("`[string: Money]@ordered` strips the @ordered affix and sets ordered=true", () => {
    const t = resolveTypeExpr("[string: Money]@ordered", reg());
    expect(t.kind).toBe("map");
    expect(t.key.name).toBe("string");
    expect(t.value.name).toBe("number");
    expect(t.ordered).toBe(true);
  });

  test("nested-map VALUE `[string: [int: Money]]` resolves to a map of maps", () => {
    const t = resolveTypeExpr("[string: [int: Money]]", reg());
    expect(t.kind).toBe("map");
    expect(t.key.name).toBe("string");
    expect(t.value.kind).toBe("map");
    expect(t.value.key.name).toBe("integer");
    expect(t.value.value.name).toBe("number");
  });

  test("`[ {a: 1}: {b: 2} ]` struct-key map: depth-1 colon is the entry colon (§59.3 worked example)", () => {
    const t = resolveTypeExpr("[ {a: 1}: {b: 2} ]", reg());
    expect(t.kind).toBe("map");
    // key + value are both inline structs (the depth-2 colons are inside the {})
    expect(t.key.kind).toBe("struct");
    expect(t.value.kind).toBe("struct");
  });
});

// ---------------------------------------------------------------------------
// Recognizer FALSE-CATCH canary — existing annotation forms must NOT mis-resolve
// ---------------------------------------------------------------------------

describe("§59 D1 — recognizer false-catch canary (existing forms unaffected)", () => {
  test("array `T[]` still resolves as an array, NOT a map", () => {
    expect(resolveTypeExpr("string[]", reg()).kind).toBe("array");
    expect(resolveTypeExpr("User[]", reg()).kind).toBe("array");
    expect(resolveTypeExpr("Money[]", reg()).element.name).toBe("number");
  });

  test("a `[label]`-suffix-shaped bracket (no internal colon) does NOT become a map", () => {
    // No depth-1 entry-colon → falls through (asIs), never a map.
    const t = resolveTypeExpr("[label]", reg());
    expect(t.kind).not.toBe("map");
  });

  test("ternary-colon inside a bracket `[ @cond ? a : b ]` is EXCLUDED (NOT a map)", () => {
    const t = resolveTypeExpr("[ @cond ? a : b ]", reg());
    expect(t.kind).not.toBe("map");
  });

  test("predicated `number(>0)` is unaffected (still predicated)", () => {
    expect(resolveTypeExpr("number(>0)", reg()).kind).toBe("predicated");
  });

  test("union `number | not` is unaffected (still a union)", () => {
    expect(resolveTypeExpr("number | not", reg()).kind).toBe("union");
  });
});

// ---------------------------------------------------------------------------
// findMapEntryColon — the depth-1 + ternary-exclusion primitive (§59.3)
// ---------------------------------------------------------------------------

describe("§59 D1 — findMapEntryColon (§59.3 disambiguation)", () => {
  test("finds the depth-1 entry colon", () => {
    expect(findMapEntryColon("string: Money")).toBeGreaterThanOrEqual(0);
  });
  test("excludes a depth-1 ternary alternative-colon", () => {
    expect(findMapEntryColon(" @cond ? a : b ")).toBe(-1);
  });
  test("ignores colons nested deeper (inside `{}`)", () => {
    // The depth-1 colon between the two struct values IS the entry colon.
    const idx = findMapEntryColon("{a: 1}: {b: 2}");
    expect(idx).toBeGreaterThanOrEqual(0);
    // it must be the colon AFTER the first {}, not the `a:` colon inside it.
    expect("{a: 1}: {b: 2}".slice(0, idx)).toBe("{a: 1}");
  });
  test("returns -1 for a colon-free bracket body (array)", () => {
    expect(findMapEntryColon("a, b, c")).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// Piece 5 helpers — isComparableType / typeContainsFunctionField / classifyMapKey
// ---------------------------------------------------------------------------

describe("§59 D1 — key comparability helpers (§45.2 / §59.4)", () => {
  test("primitives are comparable", () => {
    expect(isComparableType(tPrimitive("string"))).toBe(true);
    expect(isComparableType(tPrimitive("number"))).toBe(true);
    expect(isComparableType(tPrimitive("boolean"))).toBe(true);
  });
  test("a struct with all-comparable fields is comparable", () => {
    const route = tStruct("Route", new Map([["id", tPrimitive("string")]]));
    expect(isComparableType(route)).toBe(true);
  });
  test("an enum is comparable", () => {
    expect(isComparableType(reg().get("Color"))).toBe(true);
  });
  test("an array of comparables is comparable", () => {
    expect(isComparableType(tArray(tPrimitive("string")))).toBe(true);
  });
  test("classifyMapKey: primitive -> ok", () => {
    expect(classifyMapKey(tPrimitive("string"))).toBe("ok");
  });
  test("classifyMapKey: a map key -> is-map", () => {
    expect(classifyMapKey(tMap(tPrimitive("string"), tPrimitive("number"), false))).toBe("is-map");
  });
  test("typeContainsFunctionField: a plain struct does NOT contain a function field", () => {
    expect(typeContainsFunctionField(tStruct("Route", new Map([["id", tPrimitive("string")]])))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Piece 5 — key-comparability FIRE sites (through the real pipeline)
// ---------------------------------------------------------------------------

describe("§59 D1 — map key comparability diagnostics (decl-binding sites)", () => {
  test("primitive-key map: no key-comparability error", () => {
    const e = tsErrors(`<m>: [string: Money]`);
    expect(codes(e, "E-MAP-KEY-NOT-COMPARABLE")).toHaveLength(0);
    expect(codes(e, "E-MAP-KEY-IS-MAP")).toHaveLength(0);
    expect(codes(e, "E-EQ-003")).toHaveLength(0);
  });

  test("struct-key (all comparable fields) map: no error", () => {
    const e = tsErrors(`type Route:struct = { id: string, lane: number }\n<m>: [Route: number]`);
    expect(codes(e, "E-MAP-KEY-NOT-COMPARABLE")).toHaveLength(0);
    expect(codes(e, "E-EQ-003")).toHaveLength(0);
  });

  test("enum-key map: no error", () => {
    const e = tsErrors(`type Color:enum = { Red, Green, Blue }\n<m>: [Color: number]`);
    expect(codes(e, "E-MAP-KEY-NOT-COMPARABLE")).toHaveLength(0);
  });

  test("struct-with-function-field key map -> E-EQ-003 (reused function code)", () => {
    const e = tsErrors(`type Handler:struct = { id: string, onFire: fn() }\n<m>: [Handler: number]`);
    expect(codes(e, "E-EQ-003").length).toBeGreaterThanOrEqual(1);
    // it is NOT mis-classified as the general not-comparable code:
    expect(codes(e, "E-MAP-KEY-NOT-COMPARABLE")).toHaveLength(0);
  });

  test("map-typed key -> E-MAP-KEY-IS-MAP", () => {
    const e = tsErrors(`<m>: [[string: number]: number]`);
    expect(codes(e, "E-MAP-KEY-IS-MAP").length).toBeGreaterThanOrEqual(1);
  });

  test("unresolvable / non-comparable key -> E-MAP-KEY-NOT-COMPARABLE", () => {
    const e = tsErrors(`<m>: [Nonexistent: number]`);
    expect(codes(e, "E-MAP-KEY-NOT-COMPARABLE").length).toBeGreaterThanOrEqual(1);
  });

  test("key-comparability also fires on a `let`-declared map", () => {
    const e = tsErrors(`function go() { let m: [[string: number]: number] = 0 }`);
    expect(codes(e, "E-MAP-KEY-IS-MAP").length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Piece 6 — E-MAP-BRACKET-WRITE gate (the prereq interaction, §59.7)
// ---------------------------------------------------------------------------

describe("§59 D1 — E-MAP-BRACKET-WRITE gate (write is method-native, §59.7)", () => {
  test("string-literal-key bracket-write on a map cell -> E-MAP-BRACKET-WRITE", () => {
    const e = tsErrors(`<m>: [string: number] = 0\nfunction go() { @m["DAL"] = 5 }`);
    expect(codes(e, "E-MAP-BRACKET-WRITE").length).toBeGreaterThanOrEqual(1);
    // the fix-it names the .insert form
    expect(codes(e, "E-MAP-BRACKET-WRITE")[0].message).toContain(".insert(k, v)");
  });

  test("computed-index bracket-write on a map cell -> E-MAP-BRACKET-WRITE (heterogeneous path)", () => {
    const e = tsErrors(`<m>: [string: number] = 0\n<k> = "x"\nfunction go() { @m[@k] = 5 }`);
    expect(codes(e, "E-MAP-BRACKET-WRITE").length).toBeGreaterThanOrEqual(1);
  });

  test("numeric-index bracket-write on a map cell -> E-MAP-BRACKET-WRITE", () => {
    const e = tsErrors(`<m>: [int: number] = 0\nfunction go() { @m[3] = 5 }`);
    expect(codes(e, "E-MAP-BRACKET-WRITE").length).toBeGreaterThanOrEqual(1);
  });

  test("@ordered map cell bracket-write -> E-MAP-BRACKET-WRITE", () => {
    const e = tsErrors(`<m>: [string: number]@ordered = 0\nfunction go() { @m["a"] = 5 }`);
    expect(codes(e, "E-MAP-BRACKET-WRITE").length).toBeGreaterThanOrEqual(1);
  });

  test("bracket-write on a plain ARRAY cell does NOT fire E-MAP-BRACKET-WRITE (COW unaffected)", () => {
    const e = tsErrors(`<arr>: number[] = 0\nfunction go() { @arr[0] = 5 }`);
    expect(codes(e, "E-MAP-BRACKET-WRITE")).toHaveLength(0);
  });

  test("bracket-READ on a map cell does NOT fire (read is bracket, §59.6)", () => {
    const e = tsErrors(`<m>: [string: number] = 0\nfunction go() { let x = @m["DAL"] }`);
    expect(codes(e, "E-MAP-BRACKET-WRITE")).toHaveLength(0);
  });
});
