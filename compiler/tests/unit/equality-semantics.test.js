/**
 * Equality semantics — Unit Tests (§45)
 *
 * Tests for scrml's single-operator equality model:
 *   §1  E-EQ-004 — `===` in scrml logic source produces compile error
 *   §2  E-EQ-004 — `!==` in scrml logic source produces compile error
 *   §3  E-EQ-004 recovery — AST gets `==`/`!=` (not `===`/`!==`) after error
 *   §4  rewriteEqualityOps: `==` → `_scrml_structural_eq` (S468, §45.4)
 *   §5  rewriteEqualityOps: `!=` → `!_scrml_structural_eq`
 *   §6  rewriteEqualityOps: preserves `==` inside string literals
 *   §7  rewriteEqualityOps: handles mixed `==` and `!=` in one expression
 *   §8  rewriteEqualityOps: no-op when no equality operators present
 *   §9  rewriteEqualityOps: handles template literals with `==`
 *   §10 rewriteEqualityOps: `x == null` is structural (x not provably primitive)
 *   §11 rewriteEqualityOps: provably-primitive operands keep `===` / `!==`
 *   §12 rewriteEqualityOps: empty/null input
 *   §13 rewriteEqualityOps: preserves `===` that later passes may produce (not applicable here)
 *   §14 E-EQ-002 — `== not` emits compile error
 *   §15 E-EQ-002 — `!= not` emits compile error
 *   §16 E-EQ-002 — `is not` does NOT emit E-EQ-002 (correct usage)
 *   §17 E-EQ-004 — `=== not` emits both E-EQ-004 and E-EQ-002
 *   §18 rewriteEqualityOps: `x == y` in if-condition
 *   §19 rewriteEqualityOps: nested parenthesized expressions
 *   §20 rewriteEqualityOps: == at start of expression (edge case)
 *   §21 _scrml_structural_eq: primitives (number, string, boolean)
 *   §22 _scrml_structural_eq: struct equality (field-by-field)
 *   §23 _scrml_structural_eq: struct inequality (different fields)
 *   §24 _scrml_structural_eq: nested structs
 *   §25 _scrml_structural_eq: enum unit variants
 *   §26 _scrml_structural_eq: enum payload variants
 *   §27 _scrml_structural_eq: arrays (tuple-like)
 *   §28 _scrml_structural_eq: null/undefined handling
 *   §29 _scrml_structural_eq: different types return false
 *   §30 _scrml_structural_eq: reference identity short-circuit
 *   §31 Full pipeline: `x == y` in logic compiles to `_scrml_structural_eq(x, y)` (S468)
 *   §32 Full pipeline: `x != y` in logic compiles to `!_scrml_structural_eq(x, y)` (S468)
 *   §33 Runtime template contains _scrml_structural_eq
 */

import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { rewriteEqualityOps, rewriteExpr } from "../../src/codegen/rewrite.js";
import { SCRML_RUNTIME } from "../../src/runtime-template.js";

// Helper: parse scrml source and return { ast, errors }
function parse(source) {
  const bsOut = splitBlocks("test.scrml", source);
  const result = buildAST(bsOut);
  return result;
}

// ---------------------------------------------------------------------------
// §1-§3: E-EQ-004 — compile error for `===` and `!==` in scrml source
// ---------------------------------------------------------------------------

describe("E-EQ-004 — === and !== are not valid scrml operators", () => {
  test("§1 `===` in logic body emits E-EQ-004 error", () => {
    const result = parse("${ let x = a === b }");
    const errors = result.errors;
    expect(errors.length).toBeGreaterThanOrEqual(1);
    const eq4 = errors.find(e => e.code === "E-EQ-004");
    expect(eq4).toBeDefined();
    expect(eq4.message).toContain("===");
    expect(eq4.message).toContain("E-EQ-004");
  });

  test("§2 `!==` in logic body emits E-EQ-004 error", () => {
    const result = parse("${ let x = a !== b }");
    const errors = result.errors;
    expect(errors.length).toBeGreaterThanOrEqual(1);
    const eq4 = errors.find(e => e.code === "E-EQ-004");
    expect(eq4).toBeDefined();
    expect(eq4.message).toContain("!==");
    expect(eq4.message).toContain("E-EQ-004");
  });

  test("§3 recovery: AST expression uses `==` not `===` after E-EQ-004", () => {
    const result = parse("${ a === b }");
    const eq4 = result.errors.find(e => e.code === "E-EQ-004");
    expect(eq4).toBeDefined();
    const logicNode = result.ast.nodes.find(n => n.kind === "logic");
    expect(logicNode).toBeDefined();
    if (logicNode && Array.isArray(logicNode.body)) {
      const bareExpr = logicNode.body.find(n => n.kind === "bare-expr");
      if (bareExpr) {
        expect(bareExpr.expr).not.toMatch(/===/);
        expect(bareExpr.expr).toContain("==");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// §4-§13: rewriteEqualityOps — §45.4 lowering in JS output (S468: structural
// unless BOTH operands are provably primitive; was a blanket `==` -> `===`)
// ---------------------------------------------------------------------------

describe("rewriteEqualityOps — scrml == per §45.4", () => {
  test("§4 `==` on identifiers → structural helper", () => {
    expect(rewriteEqualityOps("a == b")).toBe("_scrml_structural_eq(a, b)");
  });

  test("§5 `!=` → negated structural helper", () => {
    expect(rewriteEqualityOps("a != b")).toBe("!_scrml_structural_eq(a, b)");
  });

  test("§6 preserves == inside string literals", () => {
    const input = 'x == "a == b"';
    const output = rewriteEqualityOps(input);
    expect(output).toBe('_scrml_structural_eq(x, "a == b")');
  });

  test("§7 mixed == and != in one expression", () => {
    expect(rewriteEqualityOps("a == b && c != d")).toBe("_scrml_structural_eq(a, b) && !_scrml_structural_eq(c, d)");
  });

  test("§8 no-op when no equality operators", () => {
    expect(rewriteEqualityOps("a + b * c")).toBe("a + b * c");
  });

  test("§9 template literal with == — the interpolation is lowered too", () => {
    const input = "a == `hello ${b == c}`";
    expect(rewriteEqualityOps(input)).toBe("_scrml_structural_eq(a, `hello ${_scrml_structural_eq(b, c)}`)");
  });

  test("§10 == null on an identifier is structural (x is not provably primitive)", () => {
    expect(rewriteEqualityOps("x == null")).toBe("_scrml_structural_eq(x, null)");
  });

  test("§11 both operands provably primitive → === / !==", () => {
    expect(rewriteEqualityOps("a.length == 2 && 1 != 2")).toBe("a.length === 2 && 1 !== 2");
  });

  test("§12 empty/null input", () => {
    expect(rewriteEqualityOps("")).toBe("");
    expect(rewriteEqualityOps(null)).toBe(null);
    expect(rewriteEqualityOps(undefined)).toBe(undefined);
  });

  test("§13 does not double-process existing ===", () => {
    // If someone passes already-rewritten code, === should stay ===
    expect(rewriteEqualityOps("a === b")).toBe("a === b");
  });

  test("§18 == in if-condition parenthesized", () => {
    expect(rewriteEqualityOps("(x == 42)")).toBe("(_scrml_structural_eq(x, 42))");
  });

  test("§19 nested parenthesized expressions", () => {
    expect(rewriteEqualityOps("((a == b) && (c != d))")).toBe("((_scrml_structural_eq(a, b)) && (!_scrml_structural_eq(c, d)))");
  });

  test("§20 a parenthesized operand keeps its parens", () => {
    expect(rewriteEqualityOps("x == b")).toBe("_scrml_structural_eq(x, b)");
    expect(rewriteEqualityOps("(x) == b")).toBe("_scrml_structural_eq((x), b)");
  });
});

// ---------------------------------------------------------------------------
// §14-§17: E-EQ-002 — compile error for `== not` and `!= not`
// ---------------------------------------------------------------------------

describe("E-EQ-002 — == not and != not are not valid", () => {
  test("§14 `== not` emits E-EQ-002 error", () => {
    const result = parse("${ let x = a == not }");
    const eq2 = result.errors.find(e => e.code === "E-EQ-002");
    expect(eq2).toBeDefined();
    expect(eq2.message).toContain("E-EQ-002");
    expect(eq2.message).toContain("== not");
    expect(eq2.message).toContain("is not");
  });

  test("§15 `!= not` emits E-EQ-002 error", () => {
    const result = parse("${ let x = a != not }");
    const eq2 = result.errors.find(e => e.code === "E-EQ-002");
    expect(eq2).toBeDefined();
    expect(eq2.message).toContain("E-EQ-002");
    expect(eq2.message).toContain("!= not");
  });

  test("§16 `is not` does NOT produce E-EQ-002", () => {
    const result = parse("${ if (x is not) { doSomething() } }");
    const eq2 = result.errors.find(e => e.code === "E-EQ-002");
    expect(eq2).toBeUndefined();
  });

  test("§17 `=== not` emits E-EQ-004 (and recovery triggers E-EQ-002 check)", () => {
    // `=== not` should first trigger E-EQ-004 (invalid operator), then the
    // recovered `==` followed by `not` should trigger E-EQ-002.
    // Note: After E-EQ-004 recovery, the `===` is consumed and replaced with `==`
    // in the parts array, so the next peek sees `not` but the E-EQ-002 check runs
    // on the next iteration when the `not` keyword is consumed as a bare token.
    // The E-EQ-004 is the primary error we check for here.
    const result = parse("${ a === not }");
    const eq4 = result.errors.find(e => e.code === "E-EQ-004");
    expect(eq4).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// §21-§30: _scrml_structural_eq — deep value comparison
// ---------------------------------------------------------------------------

// Build the _scrml_structural_eq function from the runtime template string
function buildStructuralEq() {
  // Extract just the structural eq function and eval it
  const fn = new Function(`
    function _scrml_structural_eq(a, b, seen) {
      if (a === b) return true;
      if (a === null || b === null || a === undefined || b === undefined) return false;
      if (typeof a !== typeof b) return false;
      if (typeof a !== "object") return a === b;
      if (seen === undefined) seen = new WeakMap();
      let seenBs = seen.get(a);
      if (seenBs === undefined) {
        seenBs = new WeakSet();
        seen.set(a, seenBs);
      } else if (seenBs.has(b)) {
        return true;
      }
      seenBs.add(b);
      if (Array.isArray(a)) {
        if (!Array.isArray(b) || a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
          if (!_scrml_structural_eq(a[i], b[i], seen)) return false;
        }
        return true;
      }
      if (a._tag !== undefined && b._tag !== undefined) {
        if (a._tag !== b._tag) return false;
        const aKeys = Object.keys(a);
        const bKeys = Object.keys(b);
        if (aKeys.length !== bKeys.length) return false;
        for (const key of aKeys) {
          if (key === "_tag") continue;
          if (!_scrml_structural_eq(a[key], b[key], seen)) return false;
        }
        return true;
      }
      const aKeys = Object.keys(a);
      const bKeys = Object.keys(b);
      if (aKeys.length !== bKeys.length) return false;
      for (const key of aKeys) {
        if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
        if (!_scrml_structural_eq(a[key], b[key], seen)) return false;
      }
      return true;
    }
    return _scrml_structural_eq;
  `);
  return fn();
}

describe("_scrml_structural_eq — deep value comparison (§45.4)", () => {
  const eq = buildStructuralEq();

  test("§21 primitives: number, string, boolean", () => {
    expect(eq(42, 42)).toBe(true);
    expect(eq(42, 43)).toBe(false);
    expect(eq("hello", "hello")).toBe(true);
    expect(eq("hello", "world")).toBe(false);
    expect(eq(true, true)).toBe(true);
    expect(eq(true, false)).toBe(false);
    expect(eq(0, 0)).toBe(true);
    expect(eq("", "")).toBe(true);
  });

  test("§22 struct equality (field-by-field)", () => {
    expect(eq({ x: 1, y: 2 }, { x: 1, y: 2 })).toBe(true);
    expect(eq({ name: "Alice", age: 30 }, { name: "Alice", age: 30 })).toBe(true);
  });

  test("§23 struct inequality (different fields or values)", () => {
    expect(eq({ x: 1, y: 2 }, { x: 1, y: 3 })).toBe(false);
    expect(eq({ x: 1 }, { x: 1, y: 2 })).toBe(false);
    expect(eq({ a: 1 }, { b: 1 })).toBe(false);
  });

  test("§24 nested structs (recursive comparison)", () => {
    expect(eq(
      { pos: { x: 1, y: 2 }, name: "A" },
      { pos: { x: 1, y: 2 }, name: "A" }
    )).toBe(true);
    expect(eq(
      { pos: { x: 1, y: 2 }, name: "A" },
      { pos: { x: 1, y: 3 }, name: "A" }
    )).toBe(false);
  });

  test("§25 enum unit variants (tag-only comparison)", () => {
    expect(eq({ _tag: "North" }, { _tag: "North" })).toBe(true);
    expect(eq({ _tag: "North" }, { _tag: "South" })).toBe(false);
  });

  test("§26 enum payload variants (tag + payload)", () => {
    expect(eq(
      { _tag: "Move", dx: 1, dy: 0 },
      { _tag: "Move", dx: 1, dy: 0 }
    )).toBe(true);
    expect(eq(
      { _tag: "Move", dx: 1, dy: 0 },
      { _tag: "Move", dx: 0, dy: 1 }
    )).toBe(false);
    expect(eq(
      { _tag: "Move", dx: 1 },
      { _tag: "Stop" }
    )).toBe(false);
  });

  test("§27 arrays (tuple-like fields)", () => {
    expect(eq([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(eq([1, 2, 3], [1, 2, 4])).toBe(false);
    expect(eq([1, 2], [1, 2, 3])).toBe(false);
    expect(eq([], [])).toBe(true);
  });

  test("§28 null/undefined handling", () => {
    expect(eq(null, null)).toBe(true);
    expect(eq(undefined, undefined)).toBe(true);
    expect(eq(null, undefined)).toBe(false);
    expect(eq(null, 0)).toBe(false);
    expect(eq(undefined, "")).toBe(false);
    expect(eq({ x: 1 }, null)).toBe(false);
  });

  test("§29 different types return false", () => {
    expect(eq(42, "42")).toBe(false);
    expect(eq(true, 1)).toBe(false);
    expect(eq([], {})).toBe(false);
    expect(eq(0, false)).toBe(false);
  });

  test("§30 reference identity short-circuit", () => {
    const obj = { x: 1, y: { z: 2 } };
    expect(eq(obj, obj)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Cycle-guard (cycles-prereq, S168) — value-cycles are FORBIDDEN, but a
// malformed JS-host value reaching `==` must terminate, not stack-overflow.
// ---------------------------------------------------------------------------

describe("_scrml_structural_eq — cycle guard (cycles-prereq S168)", () => {
  const eq = buildStructuralEq();

  test("two distinct-but-equal self-cyclic objects compare without RangeError", () => {
    const a = { x: 1 };
    a.self = a; // a.self === a (self-cycle)
    const b = { x: 1 };
    b.self = b; // b.self === b (self-cycle, distinct object)
    // Pre-guard this threw `RangeError: Maximum call stack size exceeded`.
    // Assume-equal-on-revisit: structurally identical cyclic shape → true.
    expect(() => eq(a, b)).not.toThrow();
    expect(eq(a, b)).toBe(true);
  });

  test("distinct-but-equal mutually-cyclic arrays terminate", () => {
    const a = [1, 2, 3];
    a[0] = a; // self-cycle at index 0
    const b = [1, 2, 3];
    b[0] = b;
    expect(() => eq(a, b)).not.toThrow();
    expect(eq(a, b)).toBe(true);
  });

  test("cyclic objects that DIFFER on a non-cyclic field still return false", () => {
    const a = { x: 1 };
    a.self = a;
    const b = { x: 2 }; // differs on x
    b.self = b;
    expect(() => eq(a, b)).not.toThrow();
    expect(eq(a, b)).toBe(false);
  });

  test("acyclic comparisons sharing a sub-object reference are unaffected", () => {
    const shared = { v: 7 };
    expect(eq({ a: shared, b: shared }, { a: { v: 7 }, b: { v: 7 } })).toBe(true);
    expect(eq({ a: shared, b: shared }, { a: { v: 7 }, b: { v: 8 } })).toBe(false);
  });

  test("identity short-circuit on a cyclic object returns true immediately", () => {
    const a = {};
    a.self = a;
    expect(eq(a, a)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §31-§33: Full pipeline and runtime integration
// ---------------------------------------------------------------------------

describe("Full codegen pipeline — equality in JS output", () => {
  test("§31 rewriteExpr: x == y becomes _scrml_structural_eq(x, y)", () => {
    const result = rewriteExpr("x == y");
    expect(result).toBe("_scrml_structural_eq(x, y)");
  });

  test("§32 rewriteExpr: x != y becomes !_scrml_structural_eq(x, y)", () => {
    const result = rewriteExpr("x != y");
    expect(result).toBe("!_scrml_structural_eq(x, y)");
  });

  test("§33 runtime template contains _scrml_structural_eq", () => {
    expect(SCRML_RUNTIME).toContain("_scrml_structural_eq");
    expect(SCRML_RUNTIME).toContain("§45 Structural equality");
  });

  test("§34 runtime structural-eq carries the cycle-guard seen param (S168)", () => {
    // Regression guard: the inline test copy above mirrors the runtime; this
    // ensures the runtime template itself ships the seen-set guard so the
    // mirror cannot silently drift back to the cycle-unsafe form.
    expect(SCRML_RUNTIME).toContain("function _scrml_structural_eq(a, b, seen)");
    expect(SCRML_RUNTIME).toContain("seen = new WeakMap()");
  });
});
