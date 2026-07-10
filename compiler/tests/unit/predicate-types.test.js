/**
 * §53 Inline Type Predicates — Unit Tests
 *
 * Tests for PredicatedType, parsePredicateExpr, evaluatePredicateOnLiteral,
 * checkPredicateLiteral, NAMED_SHAPES, and the resolveTypeExpr predicate branch
 * in compiler/src/type-system.ts.
 *
 * Coverage:
 *   §1  parsePredicateExpr — comparison predicates (>, >=, <, <=, ==, !=)
 *   §2  parsePredicateExpr — property predicates (.length)
 *   §3  parsePredicateExpr — named-shape identifiers
 *   §4  parsePredicateExpr — boolean composition (&&, ||, !)
 *   §5  parsePredicateExpr — nested parentheses
 *   §6  parsePredicateExpr — external reference detection (@identifier → E-CONTRACT-003)
 *   §7  parsePredicateExpr — empty input produces error kind
 *   §8  resolveTypeExpr — number(>0 && <10000) returns PredicatedType
 *   §9  resolveTypeExpr — string(email) returns PredicatedType with named-shape
 *   §10 resolveTypeExpr — number(>0 && <10000)[valid_price] parses label
 *   §11 resolveTypeExpr — integer(...) returns PredicatedType
 *   §12 resolveTypeExpr — unknown type does not match predicate path (no false positive)
 *   §13 NAMED_SHAPES — all 7 built-in shapes present
 *   §14 NAMED_SHAPES — unknown shape not in registry
 *   §15 checkPredicateLiteral — E-CONTRACT-001: number literal fails predicate
 *   §16 checkPredicateLiteral — E-CONTRACT-001: negative number vs >0
 *   §17 checkPredicateLiteral — valid number literal passes predicate (returns true)
 *   §18 checkPredicateLiteral — named shapes statically evaluated (§53.4.2 rule 2): conforming→ok, violating→E-CONTRACT-001
 *   §19 checkPredicateLiteral — E-CONTRACT-002: unknown named shape
 *   §20 checkPredicateLiteral — E-CONTRACT-003: predicate with external @ref
 *   §21 checkPredicateLiteral — string .length predicate vs literal
 *   §22 checkPredicateLiteral — and/or composition (both branches)
 *   §23 Type compatibility: PredicatedType is a subtype of PrimitiveType (T-PRED-3)
 *   §24 evaluatePredicateOnLiteral — range composition (>0 && <10000)
 *   §25 evaluatePredicateOnLiteral — named-shape statically evaluated for string literals; null only for non-string / error
 */

import { describe, test, expect } from "bun:test";
import {
  resolveTypeExpr,
  parsePredicateExpr,
  evaluatePredicateOnLiteral,
  checkPredicateLiteral,
  NAMED_SHAPES,
  tPrimitive,
  TSError,
} from "../../src/type-system.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal span factory for test error emission. */
function span(file = "/test/app.scrml") {
  return { file, start: 0, end: 10, line: 1, col: 1 };
}

/** Minimal empty type registry. */
function emptyRegistry() {
  return new Map();
}

// ---------------------------------------------------------------------------
// §1 parsePredicateExpr — comparison predicates
// ---------------------------------------------------------------------------

describe("§1 parsePredicateExpr — comparison predicates", () => {
  test(">0 produces comparison kind with op > and value 0", () => {
    const r = parsePredicateExpr(">0");
    expect(r.kind).toBe("comparison");
    expect(r.op).toBe(">");
    expect(r.value).toBe(0);
  });

  test(">=5 produces comparison kind with op >= and value 5", () => {
    const r = parsePredicateExpr(">=5");
    expect(r.kind).toBe("comparison");
    expect(r.op).toBe(">=");
    expect(r.value).toBe(5);
  });

  test("<10000 produces comparison kind with op < and value 10000", () => {
    const r = parsePredicateExpr("<10000");
    expect(r.kind).toBe("comparison");
    expect(r.op).toBe("<");
    expect(r.value).toBe(10000);
  });

  test("<=100 produces comparison kind with op <= and value 100", () => {
    const r = parsePredicateExpr("<=100");
    expect(r.kind).toBe("comparison");
    expect(r.op).toBe("<=");
    expect(r.value).toBe(100);
  });

  test("==42 produces comparison kind with op == and value 42", () => {
    const r = parsePredicateExpr("==42");
    expect(r.kind).toBe("comparison");
    expect(r.op).toBe("==");
    expect(r.value).toBe(42);
  });

  test("!=0 produces comparison kind with op != and value 0", () => {
    const r = parsePredicateExpr("!=0");
    expect(r.kind).toBe("comparison");
    expect(r.op).toBe("!=");
    expect(r.value).toBe(0);
  });

  test("negative value: >-1 produces comparison with value -1", () => {
    const r = parsePredicateExpr(">-1");
    expect(r.kind).toBe("comparison");
    expect(r.op).toBe(">");
    expect(r.value).toBe(-1);
  });

  test("floating point: >=0.5 produces comparison with value 0.5", () => {
    const r = parsePredicateExpr(">=0.5");
    expect(r.kind).toBe("comparison");
    expect(r.op).toBe(">=");
    expect(r.value).toBeCloseTo(0.5);
  });
});

// ---------------------------------------------------------------------------
// §2 parsePredicateExpr — property predicates
// ---------------------------------------------------------------------------

describe("§2 parsePredicateExpr — property predicates", () => {
  test(".length > 7 produces property kind", () => {
    const r = parsePredicateExpr(".length > 7");
    expect(r.kind).toBe("property");
    expect(r.prop).toBe("length");
    expect(r.op).toBe(">");
    expect(r.value).toBe(7);
  });

  test(".length >= 8 produces property kind", () => {
    const r = parsePredicateExpr(".length >= 8");
    expect(r.kind).toBe("property");
    expect(r.prop).toBe("length");
    expect(r.op).toBe(">=");
    expect(r.value).toBe(8);
  });

  test(".length < 255 produces property kind", () => {
    const r = parsePredicateExpr(".length < 255");
    expect(r.kind).toBe("property");
    expect(r.prop).toBe("length");
    expect(r.op).toBe("<");
    expect(r.value).toBe(255);
  });

  test(".size > 0 produces property kind with prop 'size'", () => {
    const r = parsePredicateExpr(".size > 0");
    expect(r.kind).toBe("property");
    expect(r.prop).toBe("size");
  });
});

// ---------------------------------------------------------------------------
// §3 parsePredicateExpr — named-shape identifiers
// ---------------------------------------------------------------------------

describe("§3 parsePredicateExpr — named shapes", () => {
  test("'email' identifier produces named-shape kind", () => {
    const r = parsePredicateExpr("email");
    expect(r.kind).toBe("named-shape");
    expect(r.name).toBe("email");
  });

  test("'uuid' identifier produces named-shape kind", () => {
    const r = parsePredicateExpr("uuid");
    expect(r.kind).toBe("named-shape");
    expect(r.name).toBe("uuid");
  });

  test("'phone' identifier produces named-shape kind", () => {
    const r = parsePredicateExpr("phone");
    expect(r.kind).toBe("named-shape");
    expect(r.name).toBe("phone");
  });

  test("'ssn' (unknown) still produces named-shape kind — error checked separately", () => {
    const r = parsePredicateExpr("ssn");
    expect(r.kind).toBe("named-shape");
    expect(r.name).toBe("ssn");
  });
});

// ---------------------------------------------------------------------------
// §4 parsePredicateExpr — boolean composition
// ---------------------------------------------------------------------------

describe("§4 parsePredicateExpr — boolean composition", () => {
  test(">0 && <10000 produces 'and' kind", () => {
    const r = parsePredicateExpr(">0 && <10000");
    expect(r.kind).toBe("and");
    expect(r.left?.kind).toBe("comparison");
    expect(r.left?.op).toBe(">");
    expect(r.right?.kind).toBe("comparison");
    expect(r.right?.op).toBe("<");
  });

  test(">0 || <-1 produces 'or' kind", () => {
    const r = parsePredicateExpr(">0 || <-1");
    expect(r.kind).toBe("or");
    expect(r.left?.kind).toBe("comparison");
    expect(r.right?.kind).toBe("comparison");
  });

  test("!email produces 'not' kind with named-shape operand", () => {
    const r = parsePredicateExpr("!email");
    expect(r.kind).toBe("not");
    expect(r.operand?.kind).toBe("named-shape");
    expect(r.operand?.name).toBe("email");
  });

  test(".length > 7 && .length < 255 produces nested 'and'", () => {
    const r = parsePredicateExpr(".length > 7 && .length < 255");
    expect(r.kind).toBe("and");
    expect(r.left?.kind).toBe("property");
    expect(r.right?.kind).toBe("property");
  });

  test("triple conjunction: >0 && <100 && !=50 parses to nested ands", () => {
    const r = parsePredicateExpr(">0 && <100 && !=50");
    // Left-associative: (>0 && <100) && !=50
    expect(r.kind).toBe("and");
  });
});

// ---------------------------------------------------------------------------
// §5 parsePredicateExpr — nested parentheses
// ---------------------------------------------------------------------------

describe("§5 parsePredicateExpr — nested parentheses", () => {
  test("(>0) parses the same as >0", () => {
    const r = parsePredicateExpr("(>0)");
    expect(r.kind).toBe("comparison");
    expect(r.op).toBe(">");
    expect(r.value).toBe(0);
  });

  test("(>0 && <100) || email produces 'or' at top level", () => {
    const r = parsePredicateExpr("(>0 && <100) || email");
    expect(r.kind).toBe("or");
    expect(r.left?.kind).toBe("and");
    expect(r.right?.kind).toBe("named-shape");
  });
});

// ---------------------------------------------------------------------------
// §6 parsePredicateExpr — external reference detection
// ---------------------------------------------------------------------------

describe("§6 parsePredicateExpr — external @ref detection (E-CONTRACT-003)", () => {
  test("@maxMana in predicate sets hasExternalRef: true", () => {
    const r = parsePredicateExpr(">=0 && <=@maxMana");
    expect(r.hasExternalRef).toBe(true);
  });

  test(">0 (no @ref) keeps hasExternalRef: false", () => {
    const r = parsePredicateExpr(">0");
    expect(r.hasExternalRef).toBe(false);
  });

  test("@var alone sets hasExternalRef: true", () => {
    const r = parsePredicateExpr("@value");
    expect(r.hasExternalRef).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §7 parsePredicateExpr — empty input
// ---------------------------------------------------------------------------

describe("§7 parsePredicateExpr — edge cases", () => {
  test("empty string produces error kind", () => {
    const r = parsePredicateExpr("");
    expect(r.kind).toBe("error");
  });

  test("whitespace only produces error kind", () => {
    const r = parsePredicateExpr("   ");
    expect(r.kind).toBe("error");
  });
});

// ---------------------------------------------------------------------------
// §8-12 resolveTypeExpr — predicate type resolution
// ---------------------------------------------------------------------------

describe("§8 resolveTypeExpr — number(...) returns PredicatedType", () => {
  test("number(>0) resolves to predicated kind with baseType number", () => {
    const r = resolveTypeExpr("number(>0)", emptyRegistry());
    expect(r.kind).toBe("predicated");
    if (r.kind === "predicated") {
      expect(r.baseType).toBe("number");
      expect(r.predicate.kind).toBe("comparison");
      expect(r.predicate.op).toBe(">");
    }
  });

  test("number(>0 && <10000) resolves to predicated with 'and' predicate", () => {
    const r = resolveTypeExpr("number(>0 && <10000)", emptyRegistry());
    expect(r.kind).toBe("predicated");
    if (r.kind === "predicated") {
      expect(r.baseType).toBe("number");
      expect(r.predicate.kind).toBe("and");
    }
  });

  test("number(>=0) resolves to predicated", () => {
    const r = resolveTypeExpr("number(>=0)", emptyRegistry());
    expect(r.kind).toBe("predicated");
  });
});

describe("§9 resolveTypeExpr — string(email) returns PredicatedType with named-shape", () => {
  test("string(email) resolves to predicated with named-shape predicate", () => {
    const r = resolveTypeExpr("string(email)", emptyRegistry());
    expect(r.kind).toBe("predicated");
    if (r.kind === "predicated") {
      expect(r.baseType).toBe("string");
      expect(r.predicate.kind).toBe("named-shape");
      expect(r.predicate.name).toBe("email");
    }
  });

  test("string(url) resolves to predicated", () => {
    const r = resolveTypeExpr("string(url)", emptyRegistry());
    expect(r.kind).toBe("predicated");
    if (r.kind === "predicated") {
      expect(r.predicate.kind).toBe("named-shape");
      expect(r.predicate.name).toBe("url");
    }
  });

  test("string(.length > 7 && .length < 255) resolves to predicated", () => {
    const r = resolveTypeExpr("string(.length > 7 && .length < 255)", emptyRegistry());
    expect(r.kind).toBe("predicated");
    if (r.kind === "predicated") {
      expect(r.predicate.kind).toBe("and");
    }
  });
});

describe("§10 resolveTypeExpr — named constraint label [label]", () => {
  test("number(>0 && <10000)[valid_price] parses label correctly", () => {
    const r = resolveTypeExpr("number(>0 && <10000)[valid_price]", emptyRegistry());
    expect(r.kind).toBe("predicated");
    if (r.kind === "predicated") {
      expect(r.label).toBe("valid_price");
      expect(r.predicate.kind).toBe("and");
    }
  });

  test("string(email)[user_email] sets label to 'user_email'", () => {
    const r = resolveTypeExpr("string(email)[user_email]", emptyRegistry());
    expect(r.kind).toBe("predicated");
    if (r.kind === "predicated") {
      expect(r.label).toBe("user_email");
    }
  });

  test("number(>0) without label sets label to null", () => {
    const r = resolveTypeExpr("number(>0)", emptyRegistry());
    expect(r.kind).toBe("predicated");
    if (r.kind === "predicated") {
      expect(r.label).toBeNull();
    }
  });
});

describe("§11 resolveTypeExpr — integer(...) returns PredicatedType", () => {
  test("integer(>0) resolves to predicated with baseType integer", () => {
    const r = resolveTypeExpr("integer(>0)", emptyRegistry());
    expect(r.kind).toBe("predicated");
    if (r.kind === "predicated") {
      expect(r.baseType).toBe("integer");
    }
  });
});

describe("§12 resolveTypeExpr — no false positive on non-primitive types", () => {
  test("MyStruct(...) does not match predicate path (not a primitive base)", () => {
    const r = resolveTypeExpr("MyStruct(foo)", emptyRegistry());
    // Should fall through to asIs (unknown type), not produce a predicated type
    expect(r.kind).not.toBe("predicated");
    expect(r.kind).toBe("asIs");
  });

  test("snippet(param: number) does not match predicate path", () => {
    const r = resolveTypeExpr("snippet(param: number)", emptyRegistry());
    expect(r.kind).toBe("snippet");
  });
});

// ---------------------------------------------------------------------------
// §13-14 NAMED_SHAPES registry
// ---------------------------------------------------------------------------

describe("§13 NAMED_SHAPES — built-in shapes present", () => {
  test("registry has exactly 7 built-in shapes", () => {
    expect(NAMED_SHAPES.size).toBe(7);
  });

  test("email shape is present with htmlType 'email'", () => {
    const shape = NAMED_SHAPES.get("email");
    expect(shape).toBeDefined();
    expect(shape?.htmlType).toBe("email");
    expect(shape?.baseType).toBe("string");
  });

  test("url shape is present with htmlType 'url'", () => {
    const shape = NAMED_SHAPES.get("url");
    expect(shape).toBeDefined();
    expect(shape?.htmlType).toBe("url");
  });

  test("uuid shape is present with a pattern", () => {
    const shape = NAMED_SHAPES.get("uuid");
    expect(shape).toBeDefined();
    expect(shape?.pattern).toBeDefined();
    expect(shape?.pattern?.length).toBeGreaterThan(0);
  });

  test("phone shape has htmlType 'tel'", () => {
    const shape = NAMED_SHAPES.get("phone");
    expect(shape?.htmlType).toBe("tel");
  });

  test("date, time, color shapes are present", () => {
    expect(NAMED_SHAPES.has("date")).toBe(true);
    expect(NAMED_SHAPES.has("time")).toBe(true);
    expect(NAMED_SHAPES.has("color")).toBe(true);
  });
});

describe("§14 NAMED_SHAPES — unknown shape not in registry", () => {
  test("'ssn' is not in the registry", () => {
    expect(NAMED_SHAPES.has("ssn")).toBe(false);
  });

  test("'zipcode' is not in the registry", () => {
    expect(NAMED_SHAPES.has("zipcode")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §15-22 checkPredicateLiteral — compile-time validation
// ---------------------------------------------------------------------------

describe("§15 checkPredicateLiteral — E-CONTRACT-001: literal fails numeric predicate", () => {
  test("number(>0) with value -5 emits E-CONTRACT-001 and returns false", () => {
    const predType = resolveTypeExpr("number(>0)", emptyRegistry());
    expect(predType.kind).toBe("predicated");
    if (predType.kind !== "predicated") return;

    const errors = [];
    const result = checkPredicateLiteral(predType, -5, span(), errors);
    expect(result).toBe(false);
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe("E-CONTRACT-001");
  });

  test("number(<100) with value 150 emits E-CONTRACT-001", () => {
    const predType = resolveTypeExpr("number(<100)", emptyRegistry());
    expect(predType.kind).toBe("predicated");
    if (predType.kind !== "predicated") return;

    const errors = [];
    const result = checkPredicateLiteral(predType, 150, span(), errors);
    expect(result).toBe(false);
    expect(errors[0].code).toBe("E-CONTRACT-001");
  });
});

describe("§16 checkPredicateLiteral — E-CONTRACT-001: range violation", () => {
  test("number(>0 && <10000) with value 0 fails (boundary: > not >=)", () => {
    const predType = resolveTypeExpr("number(>0 && <10000)", emptyRegistry());
    expect(predType.kind).toBe("predicated");
    if (predType.kind !== "predicated") return;

    const errors = [];
    const result = checkPredicateLiteral(predType, 0, span(), errors);
    expect(result).toBe(false);
    expect(errors[0].code).toBe("E-CONTRACT-001");
  });

  test("number(>0 && <10000) with value 10000 fails (boundary: < not <=)", () => {
    const predType = resolveTypeExpr("number(>0 && <10000)", emptyRegistry());
    expect(predType.kind).toBe("predicated");
    if (predType.kind !== "predicated") return;

    const errors = [];
    const result = checkPredicateLiteral(predType, 10000, span(), errors);
    expect(result).toBe(false);
    expect(errors[0].code).toBe("E-CONTRACT-001");
  });

  test("error message includes the type and value", () => {
    const predType = resolveTypeExpr("number(>0)", emptyRegistry());
    expect(predType.kind).toBe("predicated");
    if (predType.kind !== "predicated") return;

    const errors = [];
    checkPredicateLiteral(predType, -5, span(), errors);
    expect(errors[0].message).toContain("E-CONTRACT-001");
    expect(errors[0].message).toContain("-5");
  });
});

describe("§17 checkPredicateLiteral — valid literal passes predicate (returns true)", () => {
  test("number(>0) with value 5 returns true, no errors", () => {
    const predType = resolveTypeExpr("number(>0)", emptyRegistry());
    expect(predType.kind).toBe("predicated");
    if (predType.kind !== "predicated") return;

    const errors = [];
    const result = checkPredicateLiteral(predType, 5, span(), errors);
    expect(result).toBe(true);
    expect(errors).toHaveLength(0);
  });

  test("number(>0 && <10000) with value 500 returns true", () => {
    const predType = resolveTypeExpr("number(>0 && <10000)", emptyRegistry());
    expect(predType.kind).toBe("predicated");
    if (predType.kind !== "predicated") return;

    const errors = [];
    const result = checkPredicateLiteral(predType, 500, span(), errors);
    expect(result).toBe(true);
    expect(errors).toHaveLength(0);
  });

  test("number(>=0) with value 0 returns true (inclusive boundary)", () => {
    const predType = resolveTypeExpr("number(>=0)", emptyRegistry());
    expect(predType.kind).toBe("predicated");
    if (predType.kind !== "predicated") return;

    const errors = [];
    const result = checkPredicateLiteral(predType, 0, span(), errors);
    expect(result).toBe(true);
  });
});

describe("§18 checkPredicateLiteral — named shapes are statically evaluated (§53.4.2 rule 2)", () => {
  // §53.4.2 rule 2: a built-in named shape against a string LITERAL is decidable
  // (T-PRED-1). A conforming literal is proven valid (returns true, no error); a
  // violating literal fires E-CONTRACT-001 — the string-shape sibling of the
  // numeric §53.12.6 case, and consistent with the property-predicate path (§21).
  test("string(email) with a CONFORMING literal returns true (statically proven)", () => {
    const predType = resolveTypeExpr("string(email)", emptyRegistry());
    expect(predType.kind).toBe("predicated");
    if (predType.kind !== "predicated") return;

    const errors = [];
    const result = checkPredicateLiteral(predType, "user@example.com", span(), errors);
    expect(result).toBe(true);
    expect(errors).toHaveLength(0);
  });

  test("string(email) with a VIOLATING literal returns false and fires E-CONTRACT-001", () => {
    const predType = resolveTypeExpr("string(email)", emptyRegistry());
    expect(predType.kind).toBe("predicated");
    if (predType.kind !== "predicated") return;

    const errors = [];
    const result = checkPredicateLiteral(predType, "not-an-email", span(), errors);
    expect(result).toBe(false);
    expect(errors.some(e => e.code === "E-CONTRACT-001")).toBe(true);
  });

  test("string(url) with a VIOLATING literal fires E-CONTRACT-001", () => {
    const predType = resolveTypeExpr("string(url)", emptyRegistry());
    expect(predType.kind).toBe("predicated");
    if (predType.kind !== "predicated") return;

    const errors = [];
    const result = checkPredicateLiteral(predType, "not a url at all", span(), errors);
    expect(result).toBe(false);
    expect(errors.some(e => e.code === "E-CONTRACT-001")).toBe(true);
  });

  test("string(uuid) with a CONFORMING literal returns true", () => {
    const predType = resolveTypeExpr("string(uuid)", emptyRegistry());
    expect(predType.kind).toBe("predicated");
    if (predType.kind !== "predicated") return;

    const errors = [];
    const result = checkPredicateLiteral(predType, "12345678-1234-1234-1234-123456789abc", span(), errors);
    expect(result).toBe(true);
    expect(errors).toHaveLength(0);
  });

  test("named shape against a NON-string value stays deferred (returns null, no double-fire)", () => {
    // A base-type mismatch (number vs string-shape) is owned by the assignment
    // type-check, not the predicate — the shape evaluator must not double-fire.
    const predType = resolveTypeExpr("string(email)", emptyRegistry());
    expect(predType.kind).toBe("predicated");
    if (predType.kind !== "predicated") return;

    const errors = [];
    const result = checkPredicateLiteral(predType, 42, span(), errors);
    expect(result).toBeNull();
    expect(errors.some(e => e.code === "E-CONTRACT-001")).toBe(false);
  });
});

describe("§19 checkPredicateLiteral — E-CONTRACT-002: unknown named shape", () => {
  test("string(ssn) emits E-CONTRACT-002", () => {
    // Manually construct a predicated type with unknown named shape
    const predType = resolveTypeExpr("string(ssn)", emptyRegistry());
    expect(predType.kind).toBe("predicated");
    if (predType.kind !== "predicated") return;

    const errors = [];
    checkPredicateLiteral(predType, "123-45-6789", span(), errors);
    const e002 = errors.filter(e => e.code === "E-CONTRACT-002");
    expect(e002).toHaveLength(1);
    expect(e002[0].message).toContain("ssn");
    expect(e002[0].message).toContain("email");  // lists built-in shapes
  });

  test("string(zipcode) emits E-CONTRACT-002 with built-in shapes listed", () => {
    const predType = resolveTypeExpr("string(zipcode)", emptyRegistry());
    expect(predType.kind).toBe("predicated");
    if (predType.kind !== "predicated") return;

    const errors = [];
    checkPredicateLiteral(predType, "90210", span(), errors);
    expect(errors.some(e => e.code === "E-CONTRACT-002")).toBe(true);
  });
});

describe("§20 checkPredicateLiteral — E-CONTRACT-003: external @ref in predicate", () => {
  test("predicate with @maxMana emits E-CONTRACT-003", () => {
    const predType = resolveTypeExpr("number(>=0)", emptyRegistry());
    // Manually inject a predicate with hasExternalRef to simulate the detection
    // (resolveTypeExpr would have rejected this at parse time, but we can still test)
    expect(predType.kind).toBe("predicated");
    if (predType.kind !== "predicated") return;

    // Patch the predicate to have hasExternalRef: true
    const patchedPred = Object.assign({}, predType.predicate, { hasExternalRef: true });
    const patchedType = { ...predType, predicate: patchedPred };

    const errors = [];
    const result = checkPredicateLiteral(patchedType, 5, span(), errors);
    expect(result).toBeNull();
    const e003 = errors.filter(e => e.code === "E-CONTRACT-003");
    expect(e003).toHaveLength(1);
    expect(e003[0].message).toContain("E-CONTRACT-003");
  });
});

describe("§21 checkPredicateLiteral — string .length predicate vs literal", () => {
  test("string(.length > 7) with 'hi' (length 2) fails predicate", () => {
    const predType = resolveTypeExpr("string(.length > 7)", emptyRegistry());
    expect(predType.kind).toBe("predicated");
    if (predType.kind !== "predicated") return;

    const errors = [];
    const result = checkPredicateLiteral(predType, "hi", span(), errors);
    expect(result).toBe(false);
    expect(errors[0].code).toBe("E-CONTRACT-001");
  });

  test("string(.length > 7) with 'password123' (length 11) passes", () => {
    const predType = resolveTypeExpr("string(.length > 7)", emptyRegistry());
    expect(predType.kind).toBe("predicated");
    if (predType.kind !== "predicated") return;

    const errors = [];
    const result = checkPredicateLiteral(predType, "password123", span(), errors);
    expect(result).toBe(true);
    expect(errors).toHaveLength(0);
  });
});

describe("§22 checkPredicateLiteral — boolean composition", () => {
  test("number(>0 && <100) with value 50 returns true, no errors", () => {
    const predType = resolveTypeExpr("number(>0 && <100)", emptyRegistry());
    expect(predType.kind).toBe("predicated");
    if (predType.kind !== "predicated") return;

    const errors = [];
    const result = checkPredicateLiteral(predType, 50, span(), errors);
    expect(result).toBe(true);
    expect(errors).toHaveLength(0);
  });

  test("number(>0 || <-10) with value 5 returns true (first branch)", () => {
    const predType = resolveTypeExpr("number(>0 || <-10)", emptyRegistry());
    expect(predType.kind).toBe("predicated");
    if (predType.kind !== "predicated") return;

    const errors = [];
    const result = checkPredicateLiteral(predType, 5, span(), errors);
    expect(result).toBe(true);
  });

  test("number(>0 || <-10) with value -15 returns true (second branch)", () => {
    const predType = resolveTypeExpr("number(>0 || <-10)", emptyRegistry());
    expect(predType.kind).toBe("predicated");
    if (predType.kind !== "predicated") return;

    const errors = [];
    const result = checkPredicateLiteral(predType, -15, span(), errors);
    expect(result).toBe(true);
  });

  test("number(>0 || <-10) with value -5 returns false", () => {
    const predType = resolveTypeExpr("number(>0 || <-10)", emptyRegistry());
    expect(predType.kind).toBe("predicated");
    if (predType.kind !== "predicated") return;

    const errors = [];
    const result = checkPredicateLiteral(predType, -5, span(), errors);
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §23 Type compatibility: PredicatedType is a subtype of PrimitiveType (T-PRED-3)
// ---------------------------------------------------------------------------

describe("§23 Type compatibility (T-PRED-3: predicated is subtype of base)", () => {
  test("resolveTypeExpr('number') returns primitive type", () => {
    const r = resolveTypeExpr("number", emptyRegistry());
    expect(r.kind).toBe("primitive");
  });

  test("resolveTypeExpr('number(>0)') returns predicated type, not primitive", () => {
    const r = resolveTypeExpr("number(>0)", emptyRegistry());
    expect(r.kind).toBe("predicated");
    expect(r.kind).not.toBe("primitive");
  });

  test("PredicatedType carries its base type for subtype checking", () => {
    const r = resolveTypeExpr("number(>0 && <10000)", emptyRegistry());
    expect(r.kind).toBe("predicated");
    if (r.kind === "predicated") {
      // T-PRED-3: a predicated type IS a number
      // The baseType field makes the subtype relationship explicit
      expect(r.baseType).toBe("number");
    }
  });

  test("string predicate baseType is 'string'", () => {
    const r = resolveTypeExpr("string(email)", emptyRegistry());
    expect(r.kind).toBe("predicated");
    if (r.kind === "predicated") {
      expect(r.baseType).toBe("string");
    }
  });
});

// ---------------------------------------------------------------------------
// §24 evaluatePredicateOnLiteral — direct tests
// ---------------------------------------------------------------------------

describe("§24 evaluatePredicateOnLiteral — direct evaluation", () => {
  test(">0 against 5 returns true", () => {
    const pred = parsePredicateExpr(">0");
    expect(evaluatePredicateOnLiteral(pred, 5)).toBe(true);
  });

  test(">0 against -1 returns false", () => {
    const pred = parsePredicateExpr(">0");
    expect(evaluatePredicateOnLiteral(pred, -1)).toBe(false);
  });

  test(">0 && <100 against 50 returns true", () => {
    const pred = parsePredicateExpr(">0 && <100");
    expect(evaluatePredicateOnLiteral(pred, 50)).toBe(true);
  });

  test(">0 && <100 against 200 returns false", () => {
    const pred = parsePredicateExpr(">0 && <100");
    expect(evaluatePredicateOnLiteral(pred, 200)).toBe(false);
  });

  test(">0 && <100 against 0 returns false (> not >=)", () => {
    const pred = parsePredicateExpr(">0 && <100");
    expect(evaluatePredicateOnLiteral(pred, 0)).toBe(false);
  });

  test("!= 0 against 0 returns false", () => {
    const pred = parsePredicateExpr("!=0");
    expect(evaluatePredicateOnLiteral(pred, 0)).toBe(false);
  });

  test("!= 0 against 1 returns true", () => {
    const pred = parsePredicateExpr("!=0");
    expect(evaluatePredicateOnLiteral(pred, 1)).toBe(true);
  });

  test(".length > 7 against 'password' (len=8) returns true", () => {
    const pred = parsePredicateExpr(".length > 7");
    expect(evaluatePredicateOnLiteral(pred, "password")).toBe(true);
  });

  test(".length > 7 against 'hi' (len=2) returns false", () => {
    const pred = parsePredicateExpr(".length > 7");
    expect(evaluatePredicateOnLiteral(pred, "hi")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §25 evaluatePredicateOnLiteral — returns null for undeterminable cases
// ---------------------------------------------------------------------------

describe("§25 evaluatePredicateOnLiteral — returns null for undeterminable", () => {
  test("named-shape 'email' against a CONFORMING string literal returns true (§53.4.2 rule 2)", () => {
    const pred = parsePredicateExpr("email");
    expect(evaluatePredicateOnLiteral(pred, "user@example.com")).toBe(true);
  });

  test("named-shape 'email' against a VIOLATING string literal returns false", () => {
    const pred = parsePredicateExpr("email");
    expect(evaluatePredicateOnLiteral(pred, "not-an-email")).toBe(false);
  });

  test("named-shape 'email' against a NON-string value stays undeterminable (null)", () => {
    // A number reaching a string-shape is a base-type mismatch, not a shape
    // decision — the evaluator defers so the assignment type-check owns it.
    const pred = parsePredicateExpr("email");
    expect(evaluatePredicateOnLiteral(pred, 5)).toBeNull();
  });

  test("comparison against non-number type returns null", () => {
    const pred = parsePredicateExpr(">0");
    expect(evaluatePredicateOnLiteral(pred, "hello")).toBeNull();
  });

  test("error kind predicate returns null", () => {
    const pred = parsePredicateExpr("");
    expect(evaluatePredicateOnLiteral(pred, 5)).toBeNull();
  });

  test("and with one null branch returns null (not false)", () => {
    // >0 && email: >0 is determinable, email is null → result is null
    const pred = parsePredicateExpr(">0 && email");
    // value = 5: >0 is true, email is null → result is null (can't prove fully)
    const result = evaluatePredicateOnLiteral(pred, 5);
    expect(result).toBeNull();
  });

  test("and with false branch short-circuits to false even with null", () => {
    // >0 && email: with value = -1: >0 is false → result is false
    const pred = parsePredicateExpr(">0 && email");
    const result = evaluatePredicateOnLiteral(pred, -1);
    expect(result).toBe(false);
  });
});
