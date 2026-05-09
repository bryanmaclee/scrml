/**
 * c6-validator-runtime-catalog.test.js — A1c Step C6 unit tests
 *
 * Tests the validator predicate RUNTIME catalog at
 * `compiler/src/runtime-validators.js`. Mirror of B10's compile-time catalog
 * at `compiler/src/validator-catalog.ts`. 14 universal-core predicates per
 * SPEC §55.1.
 *
 *   §C6.0  Catalog shape — 14 entries; names + order match compile-time
 *   §C6.1  req — non-empty value semantics (§55.1 + §42.2.5)
 *   §C6.2  is some — exists-only semantics (§42.2.5 — `""` IS some)
 *   §C6.3  length — string + array length via relational predicate (§55.1)
 *   §C6.4  pattern — string regex test (§55.1)
 *   §C6.5  min — numeric minimum (§55.1)
 *   §C6.6  max — numeric maximum (§55.1)
 *   §C6.7  gt / lt / gte / lte — comparisons (§55.1)
 *   §C6.8  eq / neq — equality (§55.1)
 *   §C6.9  oneOf / notIn — set membership (§55.1)
 *   §C6.10 Cross-field thunk-unwrap — args may be `() => @cell` (§55.11, L14)
 *   §C6.11 Relational predicate evaluator — all 6 ops (§55.1, B9 §1.2)
 *   §C6.12 errorTag mirrors compile-time `errorTag` field (single source of truth)
 *   §C6.13 fireValidator dispatch — returns undefined for unknown names
 *
 * SCOPE: per A1c BRIEF C6 §scope-IN — runtime fire functions only. Per-cell
 * runner orchestration (declaration order, short-circuit on req/is some
 * failure per §55.12) is C7. Validity-surface synthesis is C8. 4-level
 * message resolution is C10. This file tests the catalog in isolation.
 */

import { describe, expect, test } from "bun:test";
import {
  VALIDATOR_RUNTIME,
  VALIDATOR_RUNTIME_NAMES,
  fireReq,
  fireIsSome,
  fireLength,
  firePattern,
  fireMin,
  fireMax,
  fireGt,
  fireLt,
  fireGte,
  fireLte,
  fireEq,
  fireNeq,
  fireOneOf,
  fireNotIn,
  fireValidator,
  hasValidator,
  runRelationalPredicate,
  validatorRuntimeCount,
} from "../../src/runtime-validators.js";

import {
  UNIVERSAL_CORE_PREDICATES,
  universalCorePredicateCount,
} from "../../src/validator-catalog.ts";

// ---------------------------------------------------------------------------
// §C6.0  Catalog shape
// ---------------------------------------------------------------------------

describe("§C6.0 — runtime catalog shape mirrors compile-time", () => {
  test("count is exactly 14 (matches compile-time count)", () => {
    expect(validatorRuntimeCount()).toBe(14);
    expect(VALIDATOR_RUNTIME_NAMES).toHaveLength(14);
    // Symmetry: runtime count == compile-time count.
    expect(validatorRuntimeCount()).toBe(universalCorePredicateCount());
  });

  test("the 14 names match compile-time order verbatim", () => {
    const compileTimeNames = UNIVERSAL_CORE_PREDICATES.map((p) => p.name);
    expect(VALIDATOR_RUNTIME_NAMES).toEqual(compileTimeNames);
    expect([...VALIDATOR_RUNTIME_NAMES]).toEqual([
      "req",
      "is some",
      "length",
      "pattern",
      "min",
      "max",
      "gt",
      "lt",
      "gte",
      "lte",
      "eq",
      "neq",
      "oneOf",
      "notIn",
    ]);
  });

  test("every compile-time predicate has a runtime fire function", () => {
    for (const sig of UNIVERSAL_CORE_PREDICATES) {
      expect(typeof VALIDATOR_RUNTIME[sig.name]).toBe("function");
    }
  });

  test("library-surface predicates are NOT in the runtime catalog (Rule 4)", () => {
    expect(hasValidator("email")).toBe(false);
    expect(hasValidator("url")).toBe(false);
    expect(hasValidator("numeric")).toBe(false);
    expect(hasValidator("integer")).toBe(false);
    // `custom` is a ValidationError tag (§55.9), not a predicate.
    expect(hasValidator("custom")).toBe(false);
  });

  test("VALIDATOR_RUNTIME is frozen (no accidental mutation)", () => {
    expect(Object.isFrozen(VALIDATOR_RUNTIME)).toBe(true);
    expect(Object.isFrozen(VALIDATOR_RUNTIME_NAMES)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §C6.1  req
// ---------------------------------------------------------------------------

describe("§C6.1 — req: non-empty value (§55.1 + §42.2.5)", () => {
  test("passes on meaningful primitives", () => {
    expect(fireReq("hello")).toBeNull();
    expect(fireReq(0)).toBeNull(); // 0 is meaningful
    expect(fireReq(false)).toBeNull(); // false is meaningful
    expect(fireReq(42)).toBeNull();
    expect(fireReq(true)).toBeNull();
  });

  test("passes on non-empty arrays", () => {
    expect(fireReq([1])).toBeNull();
    expect(fireReq(["a", "b"])).toBeNull();
  });

  test("fails on null", () => {
    expect(fireReq(null)).toEqual({ tag: "Required" });
  });

  test("fails on undefined", () => {
    expect(fireReq(undefined)).toEqual({ tag: "Required" });
  });

  test("fails on empty string (the canonical req-vs-is-some discriminant)", () => {
    expect(fireReq("")).toEqual({ tag: "Required" });
  });

  test("fails on empty array", () => {
    expect(fireReq([])).toEqual({ tag: "Required" });
  });
});

// ---------------------------------------------------------------------------
// §C6.2  is some
// ---------------------------------------------------------------------------

describe("§C6.2 — is some: exists semantics (§42.2.5 — `\"\"` IS some)", () => {
  test("PASSES on empty string (key distinction vs req)", () => {
    expect(fireIsSome("")).toBeNull();
  });

  test("passes on empty array", () => {
    expect(fireIsSome([])).toBeNull();
  });

  test("passes on 0 / false", () => {
    expect(fireIsSome(0)).toBeNull();
    expect(fireIsSome(false)).toBeNull();
  });

  test("passes on any value", () => {
    expect(fireIsSome("hello")).toBeNull();
    expect(fireIsSome(42)).toBeNull();
    expect(fireIsSome([1, 2, 3])).toBeNull();
  });

  test("fails on null", () => {
    expect(fireIsSome(null)).toEqual({ tag: "NotSome" });
  });

  test("fails on undefined", () => {
    expect(fireIsSome(undefined)).toEqual({ tag: "NotSome" });
  });
});

// ---------------------------------------------------------------------------
// §C6.3  length
// ---------------------------------------------------------------------------

describe("§C6.3 — length: string + array length via relational predicate", () => {
  test("passes when string length satisfies >=N", () => {
    expect(fireLength("ab", { op: ">=", value: 2 })).toBeNull();
    expect(fireLength("abcdef", { op: ">=", value: 2 })).toBeNull();
  });

  test("fails when string length does not satisfy >=N", () => {
    const err = fireLength("a", { op: ">=", value: 2 });
    expect(err).toEqual({
      tag: "LengthFailed",
      predicate: { op: ">=", value: 2 },
    });
  });

  test("passes when array length satisfies the relation", () => {
    expect(fireLength([1, 2, 3], { op: ">=", value: 2 })).toBeNull();
    expect(fireLength([1, 2], { op: "<=", value: 5 })).toBeNull();
  });

  test("fails when array length does not satisfy", () => {
    const err = fireLength([1], { op: ">=", value: 2 });
    expect(err).toEqual({
      tag: "LengthFailed",
      predicate: { op: ">=", value: 2 },
    });
  });

  test("treats null/undefined as length 0 (short-circuit-friendly)", () => {
    // The req/is some short-circuit (§55.12) typically suppresses this in C7.
    // Standalone the predicate must still answer:
    expect(fireLength(null, { op: ">=", value: 2 })).toEqual({
      tag: "LengthFailed",
      predicate: { op: ">=", value: 2 },
    });
    expect(fireLength(null, { op: "<=", value: 5 })).toBeNull(); // 0 <= 5
  });
});

// ---------------------------------------------------------------------------
// §C6.4  pattern
// ---------------------------------------------------------------------------

describe("§C6.4 — pattern: string regex test", () => {
  test("passes when string matches RegExp", () => {
    expect(firePattern("abc", /^[a-z]+$/)).toBeNull();
    expect(firePattern("foo@bar.com", /^[^@]+@[^@]+$/)).toBeNull();
  });

  test("fails when string does not match", () => {
    const err = firePattern("abc1", /^[a-z]+$/);
    expect(err.tag).toBe("PatternMismatch");
    expect(err.re).toEqual(/^[a-z]+$/);
  });

  test("accepts raw `/.../[flags]` string regex (B10 escape-hatch path)", () => {
    expect(firePattern("ABC", "/^[a-z]+$/i")).toBeNull();
    const err = firePattern("123", "/^[a-z]+$/i");
    expect(err.tag).toBe("PatternMismatch");
  });

  test("fails on null/undefined string (defensive)", () => {
    expect(firePattern(null, /./).tag).toBe("PatternMismatch");
    expect(firePattern(undefined, /./).tag).toBe("PatternMismatch");
  });

  test("fails when raw regex string is unparseable", () => {
    expect(firePattern("abc", "not-a-regex").tag).toBe("PatternMismatch");
  });
});

// ---------------------------------------------------------------------------
// §C6.5  min
// ---------------------------------------------------------------------------

describe("§C6.5 — min: numeric minimum", () => {
  test("passes when value >= threshold", () => {
    expect(fireMin(18, 18)).toBeNull();
    expect(fireMin(20, 18)).toBeNull();
  });

  test("fails when value < threshold", () => {
    expect(fireMin(17, 18)).toEqual({ tag: "MinFailed", threshold: 18 });
    expect(fireMin(0, 1)).toEqual({ tag: "MinFailed", threshold: 1 });
  });

  test("fails when value is not a number (defensive — type-check should prevent)", () => {
    expect(fireMin("18", 18).tag).toBe("MinFailed");
    expect(fireMin(null, 18).tag).toBe("MinFailed");
  });
});

// ---------------------------------------------------------------------------
// §C6.6  max
// ---------------------------------------------------------------------------

describe("§C6.6 — max: numeric maximum", () => {
  test("passes when value <= threshold", () => {
    expect(fireMax(120, 120)).toBeNull();
    expect(fireMax(50, 120)).toBeNull();
  });

  test("fails when value > threshold", () => {
    expect(fireMax(121, 120)).toEqual({ tag: "MaxFailed", threshold: 120 });
    expect(fireMax(1000, 100)).toEqual({ tag: "MaxFailed", threshold: 100 });
  });

  test("fails when value is not a number", () => {
    expect(fireMax("50", 120).tag).toBe("MaxFailed");
  });
});

// ---------------------------------------------------------------------------
// §C6.7  gt / lt / gte / lte
// ---------------------------------------------------------------------------

describe("§C6.7 — gt / lt / gte / lte: orderable comparisons", () => {
  test("gt passes only on strict greater", () => {
    expect(fireGt(5, 3)).toBeNull();
    expect(fireGt(3, 3)).toEqual({ tag: "GtFailed", expected: 3 });
    expect(fireGt(2, 3)).toEqual({ tag: "GtFailed", expected: 3 });
  });

  test("lt passes only on strict less", () => {
    expect(fireLt(3, 5)).toBeNull();
    expect(fireLt(5, 5)).toEqual({ tag: "LtFailed", expected: 5 });
    expect(fireLt(7, 5)).toEqual({ tag: "LtFailed", expected: 5 });
  });

  test("gte passes on >= (boundary inclusive)", () => {
    expect(fireGte(5, 5)).toBeNull();
    expect(fireGte(6, 5)).toBeNull();
    expect(fireGte(4, 5)).toEqual({ tag: "GteFailed", expected: 5 });
  });

  test("lte passes on <= (boundary inclusive)", () => {
    expect(fireLte(5, 5)).toBeNull();
    expect(fireLte(4, 5)).toBeNull();
    expect(fireLte(6, 5)).toEqual({ tag: "LteFailed", expected: 5 });
  });

  test("gt/lt comparisons work on strings (orderable per §55.1)", () => {
    expect(fireGt("b", "a")).toBeNull();
    expect(fireLt("a", "b")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// §C6.8  eq / neq
// ---------------------------------------------------------------------------

describe("§C6.8 — eq / neq: equality", () => {
  test("eq passes on equal primitives", () => {
    expect(fireEq("hello", "hello")).toBeNull();
    expect(fireEq(42, 42)).toBeNull();
    expect(fireEq(true, true)).toBeNull();
  });

  test("eq fails on unequal primitives", () => {
    expect(fireEq("a", "b")).toEqual({ tag: "EqFailed", expected: "b" });
    expect(fireEq(1, 2)).toEqual({ tag: "EqFailed", expected: 2 });
  });

  test("eq treats NaN as equal to itself (SameValueZero)", () => {
    expect(fireEq(NaN, NaN)).toBeNull();
  });

  test("neq fails on equal primitives, passes on unequal", () => {
    expect(fireNeq("a", "a")).toEqual({ tag: "NeqFailed", forbidden: "a" });
    expect(fireNeq(42, 42)).toEqual({ tag: "NeqFailed", forbidden: 42 });
    expect(fireNeq("a", "b")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// §C6.9  oneOf / notIn
// ---------------------------------------------------------------------------

describe("§C6.9 — oneOf / notIn: set membership", () => {
  test("oneOf passes when value is in set", () => {
    expect(fireOneOf("Admin", ["Admin", "Editor"])).toBeNull();
    expect(fireOneOf(2, [1, 2, 3])).toBeNull();
  });

  test("oneOf fails when value is not in set", () => {
    const err = fireOneOf("Viewer", ["Admin", "Editor"]);
    expect(err).toEqual({ tag: "OneOfFailed", set: ["Admin", "Editor"] });
  });

  test("oneOf fails on empty set", () => {
    const err = fireOneOf("anything", []);
    expect(err.tag).toBe("OneOfFailed");
  });

  test("notIn passes when value is NOT in set", () => {
    expect(fireNotIn("Owner", ["Admin", "Editor"])).toBeNull();
    expect(fireNotIn(99, [1, 2, 3])).toBeNull();
  });

  test("notIn fails when value IS in set", () => {
    const err = fireNotIn("Admin", ["Admin", "Editor"]);
    expect(err).toEqual({ tag: "NotInFailed", set: ["Admin", "Editor"] });
  });

  test("notIn passes on empty set (vacuously not-in)", () => {
    expect(fireNotIn("anything", [])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// §C6.10  Cross-field thunk-unwrap (L14)
// ---------------------------------------------------------------------------

describe("§C6.10 — cross-field thunk-unwrap (L14, §55.11)", () => {
  test("eq unwraps a thunk arg (the @cell ref shape from C7)", () => {
    let pwd = "secret";
    const readPwd = () => pwd;
    expect(fireEq("secret", readPwd)).toBeNull();
    expect(fireEq("typo", readPwd)).toEqual({
      tag: "EqFailed",
      expected: "secret",
    });
    pwd = "different"; // mutate the upstream
    expect(fireEq("different", readPwd)).toBeNull(); // re-reads at fire time
  });

  test("gte unwraps a thunk arg (cross-field date comparison)", () => {
    let startDate = 100;
    const readStart = () => startDate;
    expect(fireGte(120, readStart)).toBeNull();
    startDate = 200;
    expect(fireGte(150, readStart)).toEqual({ tag: "GteFailed", expected: 200 });
  });

  test("oneOf unwraps thunked elements inside the array", () => {
    let allowed = "Admin";
    const arr = [() => allowed, "Editor"];
    expect(fireOneOf("Admin", arr)).toBeNull();
    expect(fireOneOf("Editor", arr)).toBeNull();
    expect(fireOneOf("Viewer", arr).tag).toBe("OneOfFailed");
    allowed = "Owner";
    expect(fireOneOf("Owner", arr)).toBeNull();
  });

  test("oneOf unwraps the entire-set thunk too", () => {
    const setThunk = () => ["A", "B"];
    expect(fireOneOf("A", setThunk)).toBeNull();
    expect(fireOneOf("C", setThunk).tag).toBe("OneOfFailed");
  });

  test("min unwraps thunked threshold (cross-field min)", () => {
    let minAge = 18;
    const readMinAge = () => minAge;
    expect(fireMin(20, readMinAge)).toBeNull();
    expect(fireMin(15, readMinAge)).toEqual({ tag: "MinFailed", threshold: 18 });
  });
});

// ---------------------------------------------------------------------------
// §C6.11  Relational predicate evaluator
// ---------------------------------------------------------------------------

describe("§C6.11 — runRelationalPredicate: 6 ops", () => {
  test(">=", () => {
    expect(runRelationalPredicate(5, { op: ">=", value: 5 })).toBe(true);
    expect(runRelationalPredicate(6, { op: ">=", value: 5 })).toBe(true);
    expect(runRelationalPredicate(4, { op: ">=", value: 5 })).toBe(false);
  });

  test("<=", () => {
    expect(runRelationalPredicate(5, { op: "<=", value: 5 })).toBe(true);
    expect(runRelationalPredicate(4, { op: "<=", value: 5 })).toBe(true);
    expect(runRelationalPredicate(6, { op: "<=", value: 5 })).toBe(false);
  });

  test("<", () => {
    expect(runRelationalPredicate(4, { op: "<", value: 5 })).toBe(true);
    expect(runRelationalPredicate(5, { op: "<", value: 5 })).toBe(false);
    expect(runRelationalPredicate(6, { op: "<", value: 5 })).toBe(false);
  });

  test(">", () => {
    expect(runRelationalPredicate(6, { op: ">", value: 5 })).toBe(true);
    expect(runRelationalPredicate(5, { op: ">", value: 5 })).toBe(false);
    expect(runRelationalPredicate(4, { op: ">", value: 5 })).toBe(false);
  });

  test("=", () => {
    expect(runRelationalPredicate(5, { op: "=", value: 5 })).toBe(true);
    expect(runRelationalPredicate(4, { op: "=", value: 5 })).toBe(false);
  });

  test("!=", () => {
    expect(runRelationalPredicate(4, { op: "!=", value: 5 })).toBe(true);
    expect(runRelationalPredicate(5, { op: "!=", value: 5 })).toBe(false);
  });

  test("unknown op fails closed", () => {
    expect(runRelationalPredicate(5, { op: "??", value: 5 })).toBe(false);
  });

  test("unwraps a thunked value field", () => {
    let n = 2;
    const thunk = () => n;
    expect(runRelationalPredicate(3, { op: ">=", value: thunk })).toBe(true);
    n = 5;
    expect(runRelationalPredicate(3, { op: ">=", value: thunk })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §C6.12  errorTag mirrors compile-time
// ---------------------------------------------------------------------------

describe("§C6.12 — errorTag mirrors compile-time `errorTag` field 1:1", () => {
  // Hard-coded value-pair list (one fail case per predicate). Verifies that
  // the runtime tag returned on failure is identical to the compile-time
  // `errorTag` field on the corresponding signature.
  const cases = [
    { name: "req", call: () => fireReq(null) },
    { name: "is some", call: () => fireIsSome(null) },
    { name: "length", call: () => fireLength("a", { op: ">=", value: 2 }) },
    { name: "pattern", call: () => firePattern("abc1", /^[a-z]+$/) },
    { name: "min", call: () => fireMin(0, 18) },
    { name: "max", call: () => fireMax(200, 120) },
    { name: "gt", call: () => fireGt(2, 3) },
    { name: "lt", call: () => fireLt(7, 5) },
    { name: "gte", call: () => fireGte(2, 3) },
    { name: "lte", call: () => fireLte(7, 5) },
    { name: "eq", call: () => fireEq("a", "b") },
    { name: "neq", call: () => fireNeq("a", "a") },
    { name: "oneOf", call: () => fireOneOf("X", ["A", "B"]) },
    { name: "notIn", call: () => fireNotIn("A", ["A", "B"]) },
  ];

  for (const c of cases) {
    test(`${c.name}: runtime tag === compile-time errorTag`, () => {
      const sig = UNIVERSAL_CORE_PREDICATES.find((p) => p.name === c.name);
      expect(sig).toBeDefined();
      const fail = c.call();
      expect(fail).not.toBeNull();
      expect(fail.tag).toBe(sig.errorTag);
    });
  }
});

// ---------------------------------------------------------------------------
// §C6.13  fireValidator dispatch
// ---------------------------------------------------------------------------

describe("§C6.13 — fireValidator dispatch helper", () => {
  test("dispatches by name and returns the fire result", () => {
    expect(fireValidator("req", "hello")).toBeNull();
    expect(fireValidator("req", "")).toEqual({ tag: "Required" });
    expect(fireValidator("min", 5, 10)).toEqual({ tag: "MinFailed", threshold: 10 });
  });

  test("multi-word name 'is some' dispatches verbatim", () => {
    expect(fireValidator("is some", "")).toBeNull();
    expect(fireValidator("is some", null)).toEqual({ tag: "NotSome" });
  });

  test("returns undefined for unknown predicate names", () => {
    expect(fireValidator("email", "foo@bar.com")).toBeUndefined();
    expect(fireValidator("zorp", "anything")).toBeUndefined();
  });

  test("forwards extra positional args to the fire function", () => {
    expect(fireValidator("length", "ab", { op: ">=", value: 2 })).toBeNull();
    expect(
      fireValidator("length", "a", { op: ">=", value: 2 }),
    ).toEqual({
      tag: "LengthFailed",
      predicate: { op: ">=", value: 2 },
    });
  });
});
