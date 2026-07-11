/**
 * Phase A1b Step B10 (Phase 2) — validator type-check walker (PASS 7) tests.
 *
 * The walker iterates state-decls with `hasValidators: true` and verifies
 * each validator entry against the universal-core catalog
 * (`validator-catalog.ts`). Fires E-TYPE-031 on arity / per-arg-shape
 * mismatches per SPEC §55.1 + §55.10.
 *
 * Cell-type compatibility (e.g., `pattern(re)` on a `number` cell) is
 * DEFERRED per audit §1.3. These tests cover SHAPE checks only.
 */

import { describe, expect, test } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { runSYM } from "../../src/symbol-table.ts";

function runUpToSYM(source, filePath = "test.scrml") {
  const bs = splitBlocks(filePath, source);
  const { ast } = buildAST(bs);
  return runSYM({ filePath, ast });
}

function getTypeErrors(sym) {
  return sym.errors.filter((e) => e.code === "E-TYPE-031");
}

describe("B10 Phase 2 — validator type-check, bareword predicates", () => {
  test("`req` bareword on a Shape-2 cell — no error", () => {
    const sym = runUpToSYM(
      `<program>\${ <name req> = <input type="text"/> }</program>`,
    );
    expect(getTypeErrors(sym)).toEqual([]);
  });

  test("`is some` bareword on a Shape-2 cell — no error", () => {
    const sym = runUpToSYM(
      `<program>\${ <opt is some> = <input type="text"/> }</program>`,
    );
    expect(getTypeErrors(sym)).toEqual([]);
  });

  test("`req(\"custom message\")` inline-override — no error", () => {
    // §55.10 Level-1 — req can take an optional trailing string-literal
    // inline-override per arity "0+inline".
    const sym = runUpToSYM(
      `<program>\${ <name req("Please enter your name")> = <input type="text"/> }</program>`,
    );
    expect(getTypeErrors(sym)).toEqual([]);
  });
});

describe("B10 Phase 2 — `length` (relational-predicate slot)", () => {
  test("`length(>=2)` — no error", () => {
    const sym = runUpToSYM(
      `<program>\${ <name length(>=2)> = <input type="text"/> }</program>`,
    );
    expect(getTypeErrors(sym)).toEqual([]);
  });

  test("`length(<=10)` — no error", () => {
    const sym = runUpToSYM(
      `<program>\${ <name length(<=10)> = <input type="text"/> }</program>`,
    );
    expect(getTypeErrors(sym)).toEqual([]);
  });

  test("`length(>=2, \"too short\")` inline-override — no error", () => {
    const sym = runUpToSYM(
      `<program>\${ <name length(>=2, "Name must be at least 2 chars")> = <input type="text"/> }</program>`,
    );
    expect(getTypeErrors(sym)).toEqual([]);
  });
});

describe("B10 Phase 2 — `pattern` (regex slot)", () => {
  test("regex literal — no error", () => {
    const sym = runUpToSYM(
      `<program>\${ <email pattern(/^[a-z]+@[a-z]+$/)> = <input type="email"/> }</program>`,
    );
    expect(getTypeErrors(sym)).toEqual([]);
  });

  test("string-literal alternative form — no error (acceptable per audit §1.3)", () => {
    const sym = runUpToSYM(
      `<program>\${ <email pattern("[a-z]+@[a-z]+")> = <input type="email"/> }</program>`,
    );
    expect(getTypeErrors(sym)).toEqual([]);
  });
});

describe("B10 Phase 2 — `min` / `max` (numeric slot)", () => {
  test("`min(18)` — no error", () => {
    const sym = runUpToSYM(
      `<program>\${ <age min(18)> = <input type="number"/> }</program>`,
    );
    expect(getTypeErrors(sym)).toEqual([]);
  });

  test("`max(120)` — no error", () => {
    const sym = runUpToSYM(
      `<program>\${ <age max(120)> = <input type="number"/> }</program>`,
    );
    expect(getTypeErrors(sym)).toEqual([]);
  });

  test("`min(\"abc\")` string-literal — fires E-TYPE-031 (numeric expected)", () => {
    const sym = runUpToSYM(
      `<program>\${ <age min("abc")> = <input type="number"/> }</program>`,
    );
    const errs = getTypeErrors(sym);
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0].message).toContain("min");
    expect(errs[0].message).toContain("numeric");
  });
});

describe("B10 Phase 2 — `oneOf` / `notIn` (array-of-cell-type slot)", () => {
  test("`oneOf([.Admin, .Editor])` bare-variant array — no error", () => {
    const sym = runUpToSYM(
      `<program>\${ <role oneOf([.Admin, .Editor])> = <input type="text"/> }</program>`,
    );
    expect(getTypeErrors(sym)).toEqual([]);
  });

  test("`oneOf(\"hello\")` string instead of array — fires E-TYPE-031", () => {
    const sym = runUpToSYM(
      `<program>\${ <role oneOf("Admin")> = <input type="text"/> }</program>`,
    );
    const errs = getTypeErrors(sym);
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0].message).toContain("oneOf");
    expect(errs[0].message).toContain("array literal");
  });
});

describe("B10 Phase 2 — `gt`/`lt`/`gte`/`lte` (comparable-with-cell slot)", () => {
  // Per audit §1.3: cell-type compatibility deferred. Shape level: any
  // ExprNode is acceptable.

  test("`gte(@startDate)` cross-field reference — no error", () => {
    const sym = runUpToSYM(
      `<program>\${
        <startDate> = <input type="date"/>
        <endDate gte(@startDate)> = <input type="date"/>
      }</program>`,
    );
    expect(getTypeErrors(sym)).toEqual([]);
  });

  test("`gt(0)` numeric literal — no error", () => {
    const sym = runUpToSYM(
      `<program>\${ <amount gt(0)> = <input type="number"/> }</program>`,
    );
    expect(getTypeErrors(sym)).toEqual([]);
  });
});

describe("B10 Phase 2 — `eq`/`neq` (any-equatable-with-cell slot)", () => {
  test("`eq(@password)` cross-field — no error", () => {
    const sym = runUpToSYM(
      `<program>\${
        <password> = <input type="password"/>
        <confirm eq(@password)> = <input type="password"/>
      }</program>`,
    );
    expect(getTypeErrors(sym)).toEqual([]);
  });
});

describe("B10 Phase 2 — arity violations", () => {
  test("more than 2 args on a `1+inline` predicate — fires E-TYPE-031 (B13 per-arg-split active)", () => {
    // Activated by B13's per-arg-split in ast-builder.js. `min(0, "msg",
    // "extra")` now arrives as 3 distinct ValidatorArg entries; PASS-7's
    // `args.length > 2` branch fires E-TYPE-031.
    const sym = runUpToSYM(
      `<program>\${ <age min(0, "msg", "extra")> = <input type="number"/> }</program>`,
    );
    const errs = getTypeErrors(sym);
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0].message).toContain("min");
    expect(errs[0].message).toContain("at most");
  });
});

describe("B10 Phase 2 — inline-override (Level-1, §55.10) trailing-arg checks", () => {
  test("string-literal trailing arg on `min` — no error", () => {
    const sym = runUpToSYM(
      `<program>\${ <age min(18, "Must be 18 or older")> = <input type="number"/> }</program>`,
    );
    expect(getTypeErrors(sym)).toEqual([]);
  });

  test("non-string-literal trailing arg on `min` — fires E-TYPE-031 (B13 per-arg-split active)", () => {
    // Activated by B13's per-arg-split. `min(18, @minAge)` now arrives as
    // 2 distinct ValidatorArg entries; PASS-7 fires E-TYPE-031 on the
    // non-string-literal trailing arg. B13 ALSO fires the more-specific
    // E-VALIDATOR-INLINE-DYNAMIC for the same condition; both error codes
    // are tolerated. See `derived-with-validators.test.js` §B13.E-DYNAMIC
    // for the more-specific code's tests.
    const sym = runUpToSYM(
      `<program>\${
        <minAge> = 18
        <age min(18, @minAge)> = <input type="number"/>
      }</program>`,
    );
    const errs = getTypeErrors(sym);
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0].message).toContain("static string literal");
  });
});

describe("B10 Phase 2 — unknown predicate names (D-FORM-1, closed vocabulary)", () => {
  test("would-be library-surface `email` predicate — REJECTED (§55.1 closed at 14)", () => {
    // §55.1 line 32517 — the universal-core vocabulary is CLOSED at fourteen.
    // `email` is NOT a first-class predicate; adopters spell it `pattern(/…/)`
    // or `custom(fn)`. An unknown bare-attribute predicate name is REJECTED with
    // E-TYPE-031 (was a silent pass-through → permanently-invalid field, no diag).
    const sym = runUpToSYM(
      `<program>\${ <email email> = <input type="email"/> }</program>`,
    );
    const errs = getTypeErrors(sym);
    expect(errs.length).toBe(1);
    expect(errs[0].message).toContain("unknown validator predicate");
    expect(errs[0].message).toContain("email");
  });

  test("typo'd predicate `lenght` — REJECTED (the footgun D-FORM-1 closes)", () => {
    const sym = runUpToSYM(
      `<program>\${ <name lenght(3)> = <input type="text"/> }</program>`,
    );
    const errs = getTypeErrors(sym);
    expect(errs.length).toBe(1);
    expect(errs[0].message).toContain("unknown validator predicate");
    expect(errs[0].message).toContain("lenght");
  });

  test("`custom(fn)` escape hatch — no error (the single non-core name allowed)", () => {
    const sym = runUpToSYM(
      `<program>\${ <name custom(isValidName)> = <input type="text"/> }</program>`,
    );
    expect(getTypeErrors(sym)).toEqual([]);
  });
});

describe("B10 Phase 2 — multiple validators on multiple cells", () => {
  test("validators on multiple cells — all checked", () => {
    const sym = runUpToSYM(
      `<program>\${
        <name req length(>=2)> = <input type="text"/>
        <email req pattern(/^[^@]+@[^@]+$/)> = <input type="email"/>
        <age min(13) max(120)> = <input type="number"/>
      }</program>`,
    );
    expect(getTypeErrors(sym)).toEqual([]);
  });

  test("error in one validator doesn't suppress others", () => {
    // Both fields have errors; both should fire.
    const sym = runUpToSYM(
      `<program>\${
        <a min("not a number")> = <input type="number"/>
        <b max("also not a number")> = <input type="number"/>
      }</program>`,
    );
    const errs = getTypeErrors(sym);
    expect(errs.length).toBe(2);
  });
});
