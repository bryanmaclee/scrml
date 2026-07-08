/**
 * §14.4 — Enum variant / type name case enforcement.
 *
 * SPEC §14.4:
 *   "Enum variant names SHALL begin with an uppercase letter."
 *   "Enum type names SHALL begin with an uppercase letter."
 *
 * S245 ruling: keep the rule, but the compiler must ERROR on a violation, NOT
 * silently drop it. Pre-S245 a lowercase variant was omitted from the emitted
 * enum runtime rep with NO diagnostic — a silent miscompile (a consumer
 * importing the enum got `undefined`). These tests pin the loud reject via
 * `parseEnumBody` / `buildTypeRegistry`.
 *
 * Codes:
 *   E-ENUM-VARIANT-CASE — variant name not uppercase.
 *   E-ENUM-TYPE-CASE    — enum type name not uppercase.
 */

import { describe, test, expect } from "bun:test";
import {
  buildTypeRegistry,
  parseEnumBody,
  BUILTIN_TYPES,
} from "../../src/type-system.js";

function span() {
  return { file: "test.scrml", start: 0, end: 0, line: 1, col: 1 };
}

function enumDecl(name, raw) {
  return { kind: "type-decl", name, typeKind: "enum", raw, span: span() };
}

// ---------------------------------------------------------------------------
// E-ENUM-VARIANT-CASE — lowercase variant names
// ---------------------------------------------------------------------------

describe("§14.4 E-ENUM-VARIANT-CASE: lowercase variant names error (not silent-drop)", () => {
  test("a lowercase unit variant fires E-ENUM-VARIANT-CASE naming the variant", () => {
    const errors = [];
    parseEnumBody("{ rule\ndisp }", new Map(BUILTIN_TYPES), errors, span(), "Kind");
    const vc = errors.filter(e => e.code === "E-ENUM-VARIANT-CASE");
    expect(vc.length).toBe(2);
    expect(vc.every(e => e.severity === "error")).toBe(true);
    expect(vc.some(e => e.message.includes("`rule`"))).toBe(true);
    expect(vc.some(e => e.message.includes("`disp`"))).toBe(true);
  });

  test("the message steers to the capitalized rename", () => {
    const errors = [];
    parseEnumBody("{ rule }", new Map(BUILTIN_TYPES), errors, span(), "Kind");
    const vc = errors.filter(e => e.code === "E-ENUM-VARIANT-CASE");
    expect(vc).toHaveLength(1);
    expect(vc[0].message).toContain("Rename it `Rule`");
    expect(vc[0].message).toContain("uppercase letter");
    expect(vc[0].message).toContain("in enum `Kind`");
  });

  test("the violating variant is DROPPED from the variant list (no runtime rep for a spec-violating variant)", () => {
    const { variants } = parseEnumBody("{ Good\nbad }", new Map(BUILTIN_TYPES), [], span(), "Mix");
    // Only the conforming variant registers; the loud error is the contract, the
    // dropped rep is now UNREACHABLE for a clean-compiling program (compilation
    // fails on the error).
    expect(variants.map(v => v.name)).toEqual(["Good"]);
  });

  test("a lowercase PAYLOAD variant name fires (variant name, not field)", () => {
    const errors = [];
    parseEnumBody("{ ok(code:int) }", new Map(BUILTIN_TYPES), errors, span(), "Result");
    const vc = errors.filter(e => e.code === "E-ENUM-VARIANT-CASE");
    expect(vc).toHaveLength(1);
    expect(vc[0].message).toContain("`ok`");
    expect(vc[0].message).toContain("Rename it `Ok`");
  });

  test("bar-form lowercase variant (.pending) fires", () => {
    const errors = [];
    parseEnumBody("{ .pending | .Done }", new Map(BUILTIN_TYPES), errors, span(), "Status");
    const vc = errors.filter(e => e.code === "E-ENUM-VARIANT-CASE");
    expect(vc).toHaveLength(1);
    expect(vc[0].message).toContain("`pending`");
  });
});

// ---------------------------------------------------------------------------
// Payload FIELD names are lowercase by convention — MUST NOT flag
// ---------------------------------------------------------------------------

describe("§14.4 payload FIELD names are NOT flagged (only variant names)", () => {
  test("Green(shade:int) is clean — uppercase variant, lowercase field", () => {
    const errors = [];
    const { variants } = parseEnumBody(
      "{ Red\nGreen(shade:int)\nBlue }", new Map(BUILTIN_TYPES), errors, span(), "Color",
    );
    expect(errors.filter(e => e.code === "E-ENUM-VARIANT-CASE")).toHaveLength(0);
    expect(errors.filter(e => e.code === "E-ENUM-TYPE-CASE")).toHaveLength(0);
    // The payload variant + its lowercase field are preserved.
    const green = variants.find(v => v.name === "Green");
    expect(green).toBeTruthy();
    expect(green.payload.has("shade")).toBe(true);
  });

  test("multi-field payload with lowercase fields is clean", () => {
    const errors = [];
    parseEnumBody(
      "{ Rectangle(width:int, height:int) }", new Map(BUILTIN_TYPES), errors, span(), "Shape",
    );
    expect(errors.filter(e => e.code === "E-ENUM-VARIANT-CASE")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// E-ENUM-TYPE-CASE — lowercase enum type names
// ---------------------------------------------------------------------------

describe("§14.4 E-ENUM-TYPE-CASE: lowercase enum type names error", () => {
  test("a lowercase enum type name fires E-ENUM-TYPE-CASE", () => {
    const errors = [];
    parseEnumBody("{ Red\nBlue }", new Map(BUILTIN_TYPES), errors, span(), "color");
    const tc = errors.filter(e => e.code === "E-ENUM-TYPE-CASE");
    expect(tc).toHaveLength(1);
    expect(tc[0].severity).toBe("error");
    expect(tc[0].message).toContain("`color`");
    expect(tc[0].message).toContain("Rename it `Color`");
  });

  test("lowercase type name with an EMPTY body still fires (checked before early return)", () => {
    const errors = [];
    parseEnumBody("{ }", new Map(BUILTIN_TYPES), errors, span(), "color");
    expect(errors.filter(e => e.code === "E-ENUM-TYPE-CASE")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Clean uppercase enums — zero case diagnostics
// ---------------------------------------------------------------------------

describe("§14.4 clean uppercase enums compile clean", () => {
  test("all-uppercase variants + PascalCase type = no case diagnostics", () => {
    const errors = [];
    parseEnumBody(
      "{ North\nSouth\nEast\nWest }", new Map(BUILTIN_TYPES), errors, span(), "Direction",
    );
    expect(errors.filter(e => e.code === "E-ENUM-VARIANT-CASE")).toHaveLength(0);
    expect(errors.filter(e => e.code === "E-ENUM-TYPE-CASE")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// buildTypeRegistry integration — SINGLE-FIRE across the two-pass re-parse
// ---------------------------------------------------------------------------

describe("§14.4 buildTypeRegistry — single-fire across Pass 2 + Pass 3", () => {
  test("lowercase variant fires exactly ONCE per variant via buildTypeRegistry", () => {
    const errors = [];
    buildTypeRegistry([enumDecl("Kind", "{ rule\ndisp }")], errors, span());
    // buildTypeRegistry re-parses the enum body twice (Pass 2 + Pass 3) with the
    // same `errors` array; `pushCaseError` dedups by code+message so each
    // distinct violation surfaces exactly once (no double-fire).
    const vc = errors.filter(e => e.code === "E-ENUM-VARIANT-CASE");
    expect(vc).toHaveLength(2);
  });

  test("lowercase type name fires exactly ONCE via buildTypeRegistry", () => {
    const errors = [];
    buildTypeRegistry([enumDecl("color", "{ Red\nBlue }")], errors, span());
    expect(errors.filter(e => e.code === "E-ENUM-TYPE-CASE")).toHaveLength(1);
  });

  test("clean enum via buildTypeRegistry emits zero case diagnostics", () => {
    const errors = [];
    buildTypeRegistry([enumDecl("Color", "{ Red\nGreen(shade:int)\nBlue }")], errors, span());
    expect(errors.filter(e =>
      e.code === "E-ENUM-VARIANT-CASE" || e.code === "E-ENUM-TYPE-CASE",
    )).toHaveLength(0);
  });
});
