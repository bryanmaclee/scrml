/**
 * Phase A1b Step B10 (Phase 1) — validator-catalog tests.
 *
 * Tests the universal-core predicate signature catalog at
 * compiler/src/validator-catalog.ts. Catalog is the single source of truth
 * for B10 (state validators), B21 (refinement-type predicates, future), and
 * future schema-column unification.
 */

import { describe, expect, test } from "bun:test";
import {
  UNIVERSAL_CORE_PREDICATES,
  isUniversalCorePredicate,
  lookupPredicate,
  universalCorePredicateCount,
} from "../../src/validator-catalog.ts";

describe("validator-catalog: 14 universal-core predicates per SPEC §55.1", () => {
  test("count is exactly 14 (not 18 — primer §8 correction; no email/url/numeric/integer/custom)", () => {
    expect(universalCorePredicateCount()).toBe(14);
    expect(UNIVERSAL_CORE_PREDICATES).toHaveLength(14);
  });

  test("the 14 names match §55.1 vocabulary table exactly", () => {
    const names = UNIVERSAL_CORE_PREDICATES.map((p) => p.name);
    expect(names).toEqual([
      "req",
      "is given",
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

  test("library-surface predicate-builders are NOT in the catalog (per primer §8 correction)", () => {
    // These are stdlib `scrml:data` predicate-builders; not language-core.
    expect(isUniversalCorePredicate("email")).toBe(false);
    expect(isUniversalCorePredicate("url")).toBe(false);
    expect(isUniversalCorePredicate("numeric")).toBe(false);
    expect(isUniversalCorePredicate("integer")).toBe(false);
  });

  test("'custom' is a ValidationError tag (§55.9), NOT a predicate", () => {
    expect(isUniversalCorePredicate("custom")).toBe(false);
  });
});

describe("validator-catalog: lookup API", () => {
  test("lookupPredicate returns the signature for a valid name", () => {
    const sig = lookupPredicate("req");
    expect(sig).toBeDefined();
    expect(sig?.name).toBe("req");
    expect(sig?.arity).toBe("0+inline");
    expect(sig?.errorTag).toBe("Required");
  });

  test("lookupPredicate returns undefined for non-core predicates", () => {
    expect(lookupPredicate("email")).toBeUndefined();
    expect(lookupPredicate("nonexistent")).toBeUndefined();
  });

  test("lookupPredicate matches multi-word name 'is given' verbatim", () => {
    const sig = lookupPredicate("is given");
    expect(sig).toBeDefined();
    expect(sig?.errorTag).toBe("NotSome");
  });

  test("S462 — the soft-deprecated spelling 'is some' resolves to the same predicate", () => {
    expect(lookupPredicate("is some")).toBe(lookupPredicate("is given"));
    expect(isUniversalCorePredicate("is some")).toBe(true);
  });

  test("isUniversalCorePredicate is consistent with lookupPredicate", () => {
    for (const sig of UNIVERSAL_CORE_PREDICATES) {
      expect(isUniversalCorePredicate(sig.name)).toBe(true);
    }
  });
});

describe("validator-catalog: arity classification", () => {
  test("bareword-or-inline predicates are arity '0+inline' with inline-message-override slot", () => {
    // req and is-some are bareword predicates with an optional inline-
    // message-override slot per §55.10 (`<name req("custom message")>`).
    // arity is '0+inline' — bareword OR one optional trailing string-literal.
    const req = lookupPredicate("req");
    expect(req.arity).toBe("0+inline");
    expect(req.args).toEqual([{ kind: "inline-message-override" }]);

    const isSome = lookupPredicate("is some");
    expect(isSome.arity).toBe("0+inline");
    expect(isSome.args).toEqual([{ kind: "inline-message-override" }]);
  });

  test("call-form predicates have '1+inline' arity (one required arg + optional inline override)", () => {
    const onePlusInline = [
      "length", "pattern", "min", "max",
      "gt", "lt", "gte", "lte",
      "eq", "neq",
      "oneOf", "notIn",
    ];
    for (const name of onePlusInline) {
      const sig = lookupPredicate(name);
      expect(sig.arity).toBe("1+inline");
      expect(sig.args).not.toBeNull();
      expect(sig.args).toHaveLength(2);
      expect(sig.args[1]).toEqual({ kind: "inline-message-override" });
    }
  });
});

describe("validator-catalog: per-predicate arg-kind shapes", () => {
  test("length expects relational-predicate (covers `length(>=2)` form)", () => {
    const sig = lookupPredicate("length");
    expect(sig.args[0]).toEqual({ kind: "relational-predicate" });
  });

  test("pattern expects regex literal", () => {
    const sig = lookupPredicate("pattern");
    expect(sig.args[0]).toEqual({ kind: "regex" });
  });

  test("min/max expect numeric", () => {
    expect(lookupPredicate("min").args[0]).toEqual({ kind: "numeric" });
    expect(lookupPredicate("max").args[0]).toEqual({ kind: "numeric" });
  });

  test("gt/lt/gte/lte expect comparable-with-cell", () => {
    for (const name of ["gt", "lt", "gte", "lte"]) {
      const sig = lookupPredicate(name);
      expect(sig.args[0]).toEqual({ kind: "comparable-with-cell" });
    }
  });

  test("eq/neq expect any-equatable-with-cell", () => {
    expect(lookupPredicate("eq").args[0]).toEqual({ kind: "any-equatable-with-cell" });
    expect(lookupPredicate("neq").args[0]).toEqual({ kind: "any-equatable-with-cell" });
  });

  test("oneOf/notIn expect array-of-cell-type", () => {
    expect(lookupPredicate("oneOf").args[0]).toEqual({ kind: "array-of-cell-type" });
    expect(lookupPredicate("notIn").args[0]).toEqual({ kind: "array-of-cell-type" });
  });
});

describe("validator-catalog: cell-type requirements per SPEC §55.1", () => {
  test("req and is some apply to any cell type", () => {
    expect(lookupPredicate("req").cellTypeRequirement).toBe("any");
    expect(lookupPredicate("is some").cellTypeRequirement).toBe("any");
  });

  test("length applies to string-or-array", () => {
    expect(lookupPredicate("length").cellTypeRequirement).toBe("string-or-array");
  });

  test("pattern applies only to string", () => {
    expect(lookupPredicate("pattern").cellTypeRequirement).toBe("string");
  });

  test("min/max apply only to number", () => {
    expect(lookupPredicate("min").cellTypeRequirement).toBe("number");
    expect(lookupPredicate("max").cellTypeRequirement).toBe("number");
  });

  test("gt/lt/gte/lte require orderable", () => {
    for (const name of ["gt", "lt", "gte", "lte"]) {
      expect(lookupPredicate(name).cellTypeRequirement).toBe("orderable");
    }
  });

  test("eq/neq/oneOf/notIn require equatable", () => {
    for (const name of ["eq", "neq", "oneOf", "notIn"]) {
      expect(lookupPredicate(name).cellTypeRequirement).toBe("equatable");
    }
  });
});

describe("validator-catalog: ValidationError enum tag mapping per SPEC §55.9", () => {
  test("each predicate has a non-empty errorTag", () => {
    for (const sig of UNIVERSAL_CORE_PREDICATES) {
      expect(sig.errorTag).toBeDefined();
      expect(sig.errorTag.length).toBeGreaterThan(0);
    }
  });

  test("error tags match §55.9 enum exactly", () => {
    // From SPEC §55.9 line 24523-24535 (ValidationError enum).
    const expected = {
      req: "Required",
      "is given": "NotSome",
      length: "LengthFailed",
      pattern: "PatternMismatch",
      min: "MinFailed",
      max: "MaxFailed",
      gt: "GtFailed",
      lt: "LtFailed",
      gte: "GteFailed",
      lte: "LteFailed",
      eq: "EqFailed",
      neq: "NeqFailed",
      oneOf: "OneOfFailed",
      notIn: "NotInFailed",
    };
    for (const [name, tag] of Object.entries(expected)) {
      expect(lookupPredicate(name).errorTag).toBe(tag);
    }
  });

  test("Custom is NOT in the predicate catalog (it's an enum tag, not a predicate)", () => {
    const tags = UNIVERSAL_CORE_PREDICATES.map((p) => p.errorTag);
    expect(tags).not.toContain("Custom");
  });
});

describe("validator-catalog: spec-reference traceability", () => {
  test("every entry has a non-empty specRef pointing at §55.1 or related", () => {
    for (const sig of UNIVERSAL_CORE_PREDICATES) {
      expect(sig.specRef).toBeDefined();
      expect(sig.specRef.length).toBeGreaterThan(0);
      // All universal-core predicates trace to §55.1.
      expect(sig.specRef).toContain("§55");
    }
  });
});
