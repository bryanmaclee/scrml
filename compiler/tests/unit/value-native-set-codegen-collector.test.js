/**
 * §59.12 (D4) — value-native SET codegen collectors.
 *
 * Tests `isSetTypeAnnotation`, `collectSetVarNames`, `fileHasSetAlgebraUsage`
 * (reactive-deps.ts) + the cross-check that a `set[K]` cell is ALSO counted by
 * `collectMapVarNames` (a set IS a map — it rides the `_scrml_map_*` surface).
 */

import { describe, test, expect } from "bun:test";
import {
  isSetTypeAnnotation,
  collectSetVarNames,
  collectMapVarNames,
  fileHasSetAlgebraUsage,
} from "../../src/codegen/reactive-deps.ts";

describe("isSetTypeAnnotation — set[K] recognition", () => {
  test("recognizes a primitive-element set type", () => {
    expect(isSetTypeAnnotation("set[string]")).toBe(true);
    expect(isSetTypeAnnotation("set[int]")).toBe(true);
  });

  test("recognizes a struct/enum-element set type", () => {
    expect(isSetTypeAnnotation("set[Route]")).toBe(true);
    expect(isSetTypeAnnotation("set[Color]")).toBe(true);
  });

  test("rejects a plain map type", () => {
    expect(isSetTypeAnnotation("[string: number]")).toBe(false);
    expect(isSetTypeAnnotation("[string: number]@ordered")).toBe(false);
  });

  test("rejects array / scalar / empty", () => {
    expect(isSetTypeAnnotation("string[]")).toBe(false);
    expect(isSetTypeAnnotation("number")).toBe(false);
    expect(isSetTypeAnnotation("set[]")).toBe(false);
    expect(isSetTypeAnnotation("")).toBe(false);
    expect(isSetTypeAnnotation(undefined)).toBe(false);
  });
});

describe("collectSetVarNames — set cell collection", () => {
  test("collects a typed set[K] state-decl; excludes plain maps", () => {
    const fileAST = {
      nodes: [
        { kind: "state-decl", name: "tags", typeAnnotation: "set[string]" },
        { kind: "state-decl", name: "fares", typeAnnotation: "[string: number]" },
        { kind: "state-decl", name: "count", typeAnnotation: "number" },
      ],
    };
    const sets = collectSetVarNames(fileAST);
    expect(sets.has("tags")).toBe(true);
    expect(sets.has("fares")).toBe(false);
    expect(sets.has("count")).toBe(false);
  });

  test("a set cell is ALSO a map cell (rides the _scrml_map_* surface)", () => {
    const fileAST = {
      nodes: [{ kind: "state-decl", name: "tags", typeAnnotation: "set[string]" }],
    };
    expect(collectSetVarNames(fileAST).has("tags")).toBe(true);
    expect(collectMapVarNames(fileAST).has("tags")).toBe(true);
  });

  test("collects set cells declared inside ${…} logic blocks", () => {
    const fileAST = {
      nodes: [
        { kind: "logic", body: [
          { kind: "state-decl", name: "inner", typeAnnotation: "set[int]" },
        ] },
      ],
    };
    expect(collectSetVarNames(fileAST).has("inner")).toBe(true);
  });

  test("a bare map-lit RHS with no set annotation is NOT a set (maps only infer from RHS)", () => {
    const fileAST = {
      nodes: [{ kind: "state-decl", name: "m", initExpr: { kind: "map-lit", entries: [] } }],
    };
    expect(collectSetVarNames(fileAST).has("m")).toBe(false);
    expect(collectMapVarNames(fileAST).has("m")).toBe(true); // still a (plain) map
  });
});

describe("fileHasSetAlgebraUsage — stdlib-data chunk gate", () => {
  const setVars = new Set(["tags"]);

  test("true when a set var calls .union/.intersect/.difference", () => {
    for (const method of ["union", "intersect", "difference"]) {
      const fileAST = {
        nodes: [
          { kind: "logic", body: [
            { kind: "const-decl", name: "r", initExpr: {
              kind: "call",
              callee: { kind: "member", property: method, object: { kind: "ident", name: "@tags" } },
              args: [{ kind: "ident", name: "@other" }],
            } },
          ] },
        ],
      };
      expect(fileHasSetAlgebraUsage(fileAST, setVars)).toBe(true);
    }
  });

  test("false when the set only uses .add/.has/.size (no algebra)", () => {
    const fileAST = {
      nodes: [
        { kind: "logic", body: [
          { kind: "const-decl", name: "r", initExpr: {
            kind: "call",
            callee: { kind: "member", property: "add", object: { kind: "ident", name: "@tags" } },
            args: [{ kind: "lit", value: "x" }],
          } },
        ] },
      ],
    };
    expect(fileHasSetAlgebraUsage(fileAST, setVars)).toBe(false);
  });

  test("false when there are no set vars", () => {
    const fileAST = { nodes: [] };
    expect(fileHasSetAlgebraUsage(fileAST, new Set())).toBe(false);
  });
});
