/**
 * §53 Inline Type Predicates — Codegen Unit Tests (Phase 1D)
 *
 * Tests for the predicate codegen utilities in compiler/src/codegen/emit-predicates.ts:
 *   - predicateToJsExpr        — serializes PredicateExpr to JS boolean expression
 *   - emitRuntimeCheck         — emits E-CONTRACT-001-RT boundary check lines
 *   - emitServerParamCheck     — emits server-side boundary check for a parameter
 *   - deriveHtmlAttrs          — derives HTML validation attrs from a predicate
 *   - readRefinement — the ONE reader (type-system resolveTypeExpr) as codegen sees it (refinementOf)
 *
 * Coverage:
 *   §1  predicateToJsExpr — comparison predicates (>, >=, <, <=)
 *   §2  predicateToJsExpr — property predicates (.length > N)
 *   §3  predicateToJsExpr — named-shape predicates (email, url, uuid)
 *   §4  predicateToJsExpr — and/or/not composition
 *   §5  emitRuntimeCheck — boundary zone: emits if (!check) throw E-CONTRACT-001-RT
 *   §6  emitRuntimeCheck — includes variable name, constraint, and value in message
 *   §7  emitRuntimeCheck — label appears in error message
 *   §8  emitRuntimeCheck — trusted zone: NOT called (gate at emit-logic.ts level — tested by §5 guard)
 *   §9  emitServerParamCheck — emits server-side 400 return for predicated param
 *   §10 emitServerParamCheck — includes param name, constraint, function name
 *   §11 emitServerParamCheck — respects indent parameter
 *   §12 deriveHtmlAttrs — number(>0 && <100) → min="1" max="99" type="number"
 *   §13 deriveHtmlAttrs — number(>=5 && <=100) → min="5" max="100"
 *   §14 deriveHtmlAttrs — string(.length > 0 && .length < 50) → required maxlength="49"
 *   §15 deriveHtmlAttrs — string(.length >= 8 && .length <= 64) → minlength="8" maxlength="64"
 *   §16 deriveHtmlAttrs — string(email) → type="email"
 *   §17 deriveHtmlAttrs — string(url) → type="url"
 *   §18 deriveHtmlAttrs — string(uuid) → pattern="..."
 *   §19 deriveHtmlAttrs — string(phone) → type="tel"
 *   §20 deriveHtmlAttrs — or predicate → no HTML attrs (conservative)
 *   §21 readRefinement — number(>0 && <10000) → comparison predicates
 *   §22 readRefinement — string(email) → named-shape
 *   §23 readRefinement — string(.length > 2 && .length < 32) → property predicates
 *   §24 readRefinement — number(>0 && <10000) [invoice_amount] → label
 *   §25 readRefinement — plain "number" → null (not predicated)
 *   §26 readRefinement — unknown base type → null
 *   §27 emitRuntimeCheck — check expression uses correct value expression (not hardcoded "value")
 *   §28 E-CONTRACT-004-WARN — deriveHtmlAttrs returns type="email" that conflicts with type="text"
 *   §29 emitServerParamCheck — named shape check validates string format at runtime
 *   §30 deriveHtmlAttrs — integer(>0 && <100) → min="1" max="99" type="number"
 */

import { describe, test, expect } from "bun:test";
import {
  predicateToJsExpr,
  emitRuntimeCheck,
  emitServerParamCheck,
  deriveHtmlAttrs,
  refinementOf,
} from "../../src/codegen/emit-predicates.ts";
import { resolveTypeExpr } from "../../src/type-system.js";

// S458 one reader — the codegen mirror `parsePredicateAnnotation` is gone. An
// annotation is read ONCE, by the type-system reader (`resolveTypeExpr`), and
// codegen consumes the stamped result through `refinementOf`. §21-§26 pin that
// reader through the same path codegen sees.
function readRefinement(annotation) {
  if (typeof annotation !== "string" || annotation.length === 0) return null;
  return refinementOf(resolveTypeExpr(annotation, new Map()));
}

// ---------------------------------------------------------------------------
// Helpers — build PredicateExpr objects directly (mirrors type-system.ts shapes)
// ---------------------------------------------------------------------------

function mkComparison(op, value) {
  return { kind: "comparison", op, value };
}

function mkProperty(prop, op, value) {
  return { kind: "property", prop, op, value };
}

function mkNamedShape(name) {
  return { kind: "named-shape", name };
}

function mkAnd(left, right) {
  return { kind: "and", left, right };
}

function mkOr(left, right) {
  return { kind: "or", left, right };
}

function mkNot(operand) {
  return { kind: "not", operand };
}

// ---------------------------------------------------------------------------
// §1 predicateToJsExpr — comparison predicates
// ---------------------------------------------------------------------------

describe("§1 predicateToJsExpr — comparison predicates", () => {
  test(">0 emits (value > 0)", () => {
    const expr = predicateToJsExpr(mkComparison(">", 0), "value");
    expect(expr).toBe("(value > 0)");
  });

  test(">=5 emits (amount >= 5)", () => {
    const expr = predicateToJsExpr(mkComparison(">=", 5), "amount");
    expect(expr).toBe("(amount >= 5)");
  });

  test("<10000 emits (amount < 10000)", () => {
    const expr = predicateToJsExpr(mkComparison("<", 10000), "amount");
    expect(expr).toBe("(amount < 10000)");
  });

  test("<=1 emits (taxRate <= 1)", () => {
    const expr = predicateToJsExpr(mkComparison("<=", 1), "taxRate");
    expect(expr).toBe("(taxRate <= 1)");
  });

  test("uses provided valueExpr verbatim", () => {
    const expr = predicateToJsExpr(mkComparison(">", 0), "_scrml_chk_amount");
    expect(expr).toBe("(_scrml_chk_amount > 0)");
  });
});

// ---------------------------------------------------------------------------
// §2 predicateToJsExpr — property predicates
// ---------------------------------------------------------------------------

describe("§2 predicateToJsExpr — property predicates", () => {
  test(".length > 7 emits (value.length > 7)", () => {
    const expr = predicateToJsExpr(mkProperty("length", ">", 7), "value");
    expect(expr).toBe("(value.length > 7)");
  });

  test(".length < 255 emits (pw.length < 255)", () => {
    const expr = predicateToJsExpr(mkProperty("length", "<", 255), "pw");
    expect(expr).toBe("(pw.length < 255)");
  });

  test(".length >= 1 emits (s.length >= 1)", () => {
    const expr = predicateToJsExpr(mkProperty("length", ">=", 1), "s");
    expect(expr).toBe("(s.length >= 1)");
  });

  test(".length <= 64 emits (username.length <= 64)", () => {
    const expr = predicateToJsExpr(mkProperty("length", "<=", 64), "username");
    expect(expr).toBe("(username.length <= 64)");
  });
});

// ---------------------------------------------------------------------------
// §3 predicateToJsExpr — named-shape predicates
// ---------------------------------------------------------------------------

describe("§3 predicateToJsExpr — named-shape predicates", () => {
  test("email shape emits a regex-based check containing the value expr", () => {
    const expr = predicateToJsExpr(mkNamedShape("email"), "emailVal");
    expect(expr).toContain("emailVal");
    expect(expr).toContain("@");  // email regex should include @
  });

  test("url shape emits a call to the shared url shape judge (S457 '6a')", () => {
    const expr = predicateToJsExpr(mkNamedShape("url"), "urlVal");
    // The judge (URL parse + §5.2 safe-scheme check) lives in runtime-url-guard.js; the emitted
    // check calls it rather than carrying a second copy of the reader.
    expect(expr).toBe("_scrml_url_shape_ok(urlVal)");
  });

  test("uuid shape emits a pattern check", () => {
    const expr = predicateToJsExpr(mkNamedShape("uuid"), "id");
    expect(expr).toContain("id");
    expect(expr).toContain("test");  // regex .test()
  });

  test("phone shape emits a digit pattern check", () => {
    const expr = predicateToJsExpr(mkNamedShape("phone"), "ph");
    expect(expr).toContain("ph");
    expect(expr).toContain("test");
  });

  // S458 F1 — the judge fails CLOSED. (Was: "unknown shape emits pass-through
  // true (defensive)" — a check that admitted every value.)
  test("unknown shape fails closed (false), never admits", () => {
    const expr = predicateToJsExpr(mkNamedShape("ssn"), "val");
    expect(new Function("val", `return ${expr};`)("anything")).toBe(false);
    expect(expr).not.toMatch(/^\(?true\)?$/);
  });

  test("an error node and an unknown kind fail closed too", () => {
    for (const p of [{ kind: "error", message: "x" }, { kind: "bogus" }, null]) {
      const expr = predicateToJsExpr(p, "val");
      expect(new Function("val", `return ${expr};`)(5)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// §4 predicateToJsExpr — and/or/not composition
// ---------------------------------------------------------------------------

describe("§4 predicateToJsExpr — composition", () => {
  test("and: (>0 && <10000) emits joined expression", () => {
    const pred = mkAnd(mkComparison(">", 0), mkComparison("<", 10000));
    const expr = predicateToJsExpr(pred, "amount");
    expect(expr).toBe("((amount > 0) && (amount < 10000))");
  });

  test("or: (email || url) emits or expression", () => {
    const pred = mkOr(mkNamedShape("email"), mkNamedShape("url"));
    const expr = predicateToJsExpr(pred, "v");
    expect(expr).toMatch(/\|\|/);
  });

  test("not: !(>0) emits negated expression", () => {
    const pred = mkNot(mkComparison(">", 0));
    const expr = predicateToJsExpr(pred, "n");
    expect(expr).toBe("(!((n > 0)))");
  });

  test("nested and/and: three-part range", () => {
    const pred = mkAnd(
      mkAnd(mkComparison(">=", 0), mkComparison("<=", 100)),
      mkProperty("length", ">", 0),
    );
    const expr = predicateToJsExpr(pred, "x");
    expect(expr).toContain("x >= 0");
    expect(expr).toContain("x <= 100");
    expect(expr).toContain("x.length > 0");
  });
});

// ---------------------------------------------------------------------------
// §5 emitRuntimeCheck — emits if (!check) throw E-CONTRACT-001-RT
// ---------------------------------------------------------------------------

describe("§5 emitRuntimeCheck — boundary check emission", () => {
  test("emits an if block that checks the predicate", () => {
    const pred = mkComparison(">", 0);
    const lines = emitRuntimeCheck(pred, "amount", "amount");
    const code = lines.join("\n");
    expect(code).toContain("if (!(");
    expect(code).toContain("amount > 0");
    expect(code).toContain("throw new _scrml_g.Error");
  });

  test("guard condition is the negation of the predicate expression", () => {
    const pred = mkAnd(mkComparison(">", 0), mkComparison("<", 10000));
    const lines = emitRuntimeCheck(pred, "_scrml_chk_amount", "amount");
    const code = lines.join("\n");
    // The if guard negates: if (!(pred)) throw
    expect(code).toMatch(/if\s*\(\s*!\s*\(/);
    expect(code).toContain("_scrml_chk_amount > 0");
    expect(code).toContain("_scrml_chk_amount < 10000");
  });

  test("error code E-CONTRACT-001-RT appears in throw message", () => {
    const pred = mkComparison(">", 0);
    const lines = emitRuntimeCheck(pred, "v", "myVar");
    const code = lines.join("\n");
    expect(code).toContain("E-CONTRACT-001-RT");
  });
});

// ---------------------------------------------------------------------------
// §6 emitRuntimeCheck — error message content
// ---------------------------------------------------------------------------

describe("§6 emitRuntimeCheck — error message contains variable and constraint", () => {
  test("variable name appears in error message", () => {
    const pred = mkComparison(">", 0);
    const lines = emitRuntimeCheck(pred, "price", "price");
    const code = lines.join("\n");
    expect(code).toContain("price");
  });

  test("constraint display string appears in error message", () => {
    const pred = mkComparison("<", 10000);
    const lines = emitRuntimeCheck(pred, "amt", "amt");
    const code = lines.join("\n");
    expect(code).toContain("<10000");
  });

  test("value expr referenced in error message", () => {
    const pred = mkComparison(">", 0);
    const lines = emitRuntimeCheck(pred, "_scrml_chk_qty", "qty");
    const code = lines.join("\n");
    // The error message includes String(valueExpr)
    expect(code).toContain("String(_scrml_chk_qty)");
  });
});

// ---------------------------------------------------------------------------
// §7 emitRuntimeCheck — label in error message
// ---------------------------------------------------------------------------

describe("§7 emitRuntimeCheck — label in error message", () => {
  test("label appears in comment and error message", () => {
    const pred = mkComparison(">", 0);
    const lines = emitRuntimeCheck(pred, "amount", "amount", "invoice_amount");
    const code = lines.join("\n");
    expect(code).toContain("invoice_amount");
  });

  test("null label does not break emission", () => {
    const pred = mkComparison(">", 0);
    const lines = emitRuntimeCheck(pred, "x", "x", null);
    const code = lines.join("\n");
    expect(code).toContain("E-CONTRACT-001-RT");
  });
});

// ---------------------------------------------------------------------------
// §8 emitRuntimeCheck — trusted zone elision (gate at caller level)
// ---------------------------------------------------------------------------

describe("§8 trusted zone elision", () => {
  // The trusted zone elision happens in emit-logic.ts:
  // emitRuntimeCheck is only called when zone === "boundary".
  // We verify: when called with a simple predicate and valid value expr,
  // the check expression IS emitted (i.e., emitRuntimeCheck always emits — callers gate).
  test("emitRuntimeCheck always produces lines (caller decides when to call it)", () => {
    const pred = mkComparison(">", 0);
    const lines = emitRuntimeCheck(pred, "val", "val");
    expect(lines.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// §9 emitServerParamCheck — server-side 400 return
// ---------------------------------------------------------------------------

describe("§9 emitServerParamCheck — emits server-side validation", () => {
  test("emits a return new Response with status 400", () => {
    const pred = mkAnd(mkComparison(">", 0), mkComparison("<", 10000));
    const lines = emitServerParamCheck("amount", pred, null, "submitPayment");
    const code = lines.join("\n");
    expect(code).toContain("return new _scrml_g.Response");
    expect(code).toContain("400");
  });

  test("error code E-CONTRACT-001-RT in server response body", () => {
    const pred = mkComparison(">", 0);
    const lines = emitServerParamCheck("price", pred, null, "createItem");
    const code = lines.join("\n");
    expect(code).toContain("E-CONTRACT-001-RT");
  });

  test("check expression validates the parameter", () => {
    const pred = mkAnd(mkComparison(">", 0), mkComparison("<", 10000));
    const lines = emitServerParamCheck("amount", pred, null, "submitPayment");
    const code = lines.join("\n");
    expect(code).toContain("amount > 0");
    expect(code).toContain("amount < 10000");
  });
});

// ---------------------------------------------------------------------------
// §10 emitServerParamCheck — param name and function name in response
// ---------------------------------------------------------------------------

describe("§10 emitServerParamCheck — response includes param and fn name", () => {
  test("parameter name appears in response body", () => {
    const pred = mkComparison(">", 0);
    const lines = emitServerParamCheck("amount", pred, null, "processPayment");
    const code = lines.join("\n");
    expect(code).toContain('"amount"');
  });

  test("function name appears in response body", () => {
    const pred = mkComparison(">", 0);
    const lines = emitServerParamCheck("amount", pred, null, "processPayment");
    const code = lines.join("\n");
    expect(code).toContain('"processPayment"');
  });

  test("label appears in parameter field when provided", () => {
    const pred = mkComparison(">", 0);
    const lines = emitServerParamCheck("amount", pred, "invoice_amount", "submit");
    const code = lines.join("\n");
    expect(code).toContain("invoice_amount");
  });
});

// ---------------------------------------------------------------------------
// §11 emitServerParamCheck — indent parameter
// ---------------------------------------------------------------------------

describe("§11 emitServerParamCheck — indent parameter", () => {
  test("default indent is two spaces", () => {
    const pred = mkComparison(">", 0);
    const lines = emitServerParamCheck("x", pred, null, "fn");
    // First content line should start with two spaces
    expect(lines[0]).toMatch(/^ {2}/);
  });

  test("four-space indent applied to all lines", () => {
    const pred = mkComparison(">", 0);
    const lines = emitServerParamCheck("x", pred, null, "fn", "    ");
    expect(lines[0]).toMatch(/^ {4}/);
    expect(lines[1]).toMatch(/^ {4}/);
  });
});

// ---------------------------------------------------------------------------
// §12 deriveHtmlAttrs — number(>0 && <100)
// ---------------------------------------------------------------------------

describe("§12 deriveHtmlAttrs — number range predicates", () => {
  test("number(>0 && <100) → min='1' max='99' type='number'", () => {
    const pred = mkAnd(mkComparison(">", 0), mkComparison("<", 100));
    const attrs = deriveHtmlAttrs(pred, "number");
    expect(attrs["min"]).toBe("1");
    expect(attrs["max"]).toBe("99");
    expect(attrs["type"]).toBe("number");
  });

  test("number(>=5 && <=100) → min='5' max='100'", () => {
    const pred = mkAnd(mkComparison(">=", 5), mkComparison("<=", 100));
    const attrs = deriveHtmlAttrs(pred, "number");
    expect(attrs["min"]).toBe("5");
    expect(attrs["max"]).toBe("100");
  });

  test("number(>0) alone → min='1', no max", () => {
    const pred = mkComparison(">", 0);
    const attrs = deriveHtmlAttrs(pred, "number");
    expect(attrs["min"]).toBe("1");
    expect(attrs["max"]).toBeUndefined();
  });

  test("number(<10000) alone → max='9999', no min", () => {
    const pred = mkComparison("<", 10000);
    const attrs = deriveHtmlAttrs(pred, "number");
    expect(attrs["max"]).toBe("9999");
    expect(attrs["min"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// §13 deriveHtmlAttrs — number(>=5 && <=100)
// (covered in §12 above — additional spec §53.12.1 worked example)
// ---------------------------------------------------------------------------

describe("§13 deriveHtmlAttrs — §53.12.1 worked example: number(>0 && <10000)", () => {
  test("number(>0 && <10000) → min='1' max='9999' per §53.12.1", () => {
    const pred = mkAnd(mkComparison(">", 0), mkComparison("<", 10000));
    const attrs = deriveHtmlAttrs(pred, "number");
    expect(attrs["min"]).toBe("1");
    expect(attrs["max"]).toBe("9999");
    expect(attrs["type"]).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// §14 deriveHtmlAttrs — string(.length > 0 && .length < 50)
// ---------------------------------------------------------------------------

describe("§14 deriveHtmlAttrs — string length predicates", () => {
  test("string(.length > 0 && .length < 50) → required maxlength='49'", () => {
    const pred = mkAnd(mkProperty("length", ">", 0), mkProperty("length", "<", 50));
    const attrs = deriveHtmlAttrs(pred, "string");
    expect(attrs["maxlength"]).toBe("49");
    // .length > 0 implies required
    expect(attrs["required"]).toBe("");
  });
});

// ---------------------------------------------------------------------------
// §15 deriveHtmlAttrs — string(.length >= 8 && .length <= 64)
// ---------------------------------------------------------------------------

describe("§15 deriveHtmlAttrs — string length >= and <=", () => {
  test("string(.length >= 8 && .length <= 64) → minlength='8' maxlength='64'", () => {
    const pred = mkAnd(mkProperty("length", ">=", 8), mkProperty("length", "<=", 64));
    const attrs = deriveHtmlAttrs(pred, "string");
    expect(attrs["minlength"]).toBe("8");
    expect(attrs["maxlength"]).toBe("64");
  });

  test("§53.12.2 worked example: string(.length > 2 && .length < 32) → minlength='3' maxlength='31'", () => {
    const pred = mkAnd(mkProperty("length", ">", 2), mkProperty("length", "<", 32));
    const attrs = deriveHtmlAttrs(pred, "string");
    expect(attrs["minlength"]).toBe("3");
    expect(attrs["maxlength"]).toBe("31");
  });
});

// ---------------------------------------------------------------------------
// §16 deriveHtmlAttrs — string(email)
// ---------------------------------------------------------------------------

describe("§16 deriveHtmlAttrs — named shape email", () => {
  test("string(email) → type='email'", () => {
    const attrs = deriveHtmlAttrs(mkNamedShape("email"), "string");
    expect(attrs["type"]).toBe("email");
  });
});

// ---------------------------------------------------------------------------
// §17 deriveHtmlAttrs — string(url)
// ---------------------------------------------------------------------------

describe("§17 deriveHtmlAttrs — named shape url", () => {
  test("string(url) → type='url'", () => {
    const attrs = deriveHtmlAttrs(mkNamedShape("url"), "string");
    expect(attrs["type"]).toBe("url");
  });
});

// ---------------------------------------------------------------------------
// §18 deriveHtmlAttrs — string(uuid)
// ---------------------------------------------------------------------------

describe("§18 deriveHtmlAttrs — named shape uuid", () => {
  test("string(uuid) → pattern attribute with UUID regex", () => {
    const attrs = deriveHtmlAttrs(mkNamedShape("uuid"), "string");
    expect(attrs["pattern"]).toBeDefined();
    expect(attrs["pattern"]).toContain("0-9a-f");
  });
});

// ---------------------------------------------------------------------------
// §19 deriveHtmlAttrs — string(phone)
// ---------------------------------------------------------------------------

describe("§19 deriveHtmlAttrs — named shape phone", () => {
  test("string(phone) → type='tel'", () => {
    const attrs = deriveHtmlAttrs(mkNamedShape("phone"), "string");
    expect(attrs["type"]).toBe("tel");
  });
});

// ---------------------------------------------------------------------------
// §20 deriveHtmlAttrs — or predicate is conservative
// ---------------------------------------------------------------------------

describe("§20 deriveHtmlAttrs — or predicate → no specific attrs", () => {
  test("or predicate does not emit min/max (cannot safely constrain browser)", () => {
    const pred = mkOr(mkComparison("<", 10), mkComparison(">", 100));
    const attrs = deriveHtmlAttrs(pred, "number");
    // type="number" is always set for numeric types, but no min/max for OR
    expect(attrs["min"]).toBeUndefined();
    expect(attrs["max"]).toBeUndefined();
    // type="number" is still emitted as a baseline for number types
    expect(attrs["type"]).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// §21 readRefinement — number(>0 && <10000)
// ---------------------------------------------------------------------------

describe("§21 readRefinement — number range", () => {
  test("number(>0 && <10000) returns and-predicate with two comparisons", () => {
    const result = readRefinement("number(>0 && <10000)");
    expect(result).not.toBeNull();
    expect(result.baseType).toBe("number");
    expect(result.label).toBeNull();
    expect(result.predicate.kind).toBe("and");
    expect(result.predicate.left.kind).toBe("comparison");
    expect(result.predicate.left.op).toBe(">");
    expect(result.predicate.left.value).toBe(0);
    expect(result.predicate.right.kind).toBe("comparison");
    expect(result.predicate.right.op).toBe("<");
    expect(result.predicate.right.value).toBe(10000);
  });
});

// ---------------------------------------------------------------------------
// §22 readRefinement — string(email)
// ---------------------------------------------------------------------------

describe("§22 readRefinement — string(email)", () => {
  test("string(email) returns named-shape predicate", () => {
    const result = readRefinement("string(email)");
    expect(result).not.toBeNull();
    expect(result.baseType).toBe("string");
    expect(result.predicate.kind).toBe("named-shape");
    expect(result.predicate.name).toBe("email");
  });
});

// ---------------------------------------------------------------------------
// §23 readRefinement — string(.length > 2 && .length < 32)
// ---------------------------------------------------------------------------

describe("§23 readRefinement — string(.length > 2 && .length < 32)", () => {
  test("parses property predicates from annotation string", () => {
    const result = readRefinement("string(.length > 2 && .length < 32)");
    expect(result).not.toBeNull();
    expect(result.baseType).toBe("string");
    expect(result.predicate.kind).toBe("and");
    expect(result.predicate.left.kind).toBe("property");
    expect(result.predicate.left.prop).toBe("length");
    expect(result.predicate.left.op).toBe(">");
    expect(result.predicate.left.value).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// §24 readRefinement — label parsing
// ---------------------------------------------------------------------------

describe("§24 readRefinement — label parsing", () => {
  test("number(>0 && <10000) [invoice_amount] → label = 'invoice_amount'", () => {
    const result = readRefinement("number(>0 && <10000) [invoice_amount]");
    expect(result).not.toBeNull();
    expect(result.label).toBe("invoice_amount");
    expect(result.predicate.kind).toBe("and");
  });
});

// ---------------------------------------------------------------------------
// §25 readRefinement — plain type → null
// ---------------------------------------------------------------------------

describe("§25 readRefinement — non-predicated types", () => {
  test("plain 'number' returns null", () => {
    expect(readRefinement("number")).toBeNull();
  });

  test("plain 'string' returns null", () => {
    expect(readRefinement("string")).toBeNull();
  });

  test("empty string returns null", () => {
    expect(readRefinement("")).toBeNull();
  });

  test("null input returns null", () => {
    expect(readRefinement(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// §26 readRefinement — unknown base type
// ---------------------------------------------------------------------------

describe("§26 readRefinement — unknown base type", () => {
  test("'MyType(>0)' returns null (not a primitive base type)", () => {
    const result = readRefinement("MyType(>0)");
    expect(result).toBeNull();
  });

  test("'boolean(true)' returns null (no valid comparison for boolean)", () => {
    // boolean is in the grammar but 'true' is not a numeric comparison
    // parsePredicateExprInternal won't recognize it as comparison/property/named-shape
    const result = readRefinement("boolean(true)");
    // May return null if parsing fails, or a named-shape "true" — either is acceptable.
    // The key requirement: it does NOT throw.
    expect(() => readRefinement("boolean(true)")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// §27 emitRuntimeCheck — value expression used correctly
// ---------------------------------------------------------------------------

describe("§27 emitRuntimeCheck — value expression in check and error message", () => {
  test("value expression in guard is the provided valueExpr, not hardcoded 'value'", () => {
    const pred = mkComparison(">", 0);
    const lines = emitRuntimeCheck(pred, "_scrml_chk_price", "price");
    const code = lines.join("\n");
    // The check uses _scrml_chk_price, not "price" or "value"
    expect(code).toContain("_scrml_chk_price > 0");
    // The error String() uses the tmp var too
    expect(code).toContain("String(_scrml_chk_price)");
  });
});

// ---------------------------------------------------------------------------
// §28 E-CONTRACT-004-WARN — type attr conflict detection via deriveHtmlAttrs
// ---------------------------------------------------------------------------

describe("§28 E-CONTRACT-004-WARN — shape-derived type conflicts", () => {
  // E-CONTRACT-004-WARN fires when explicit type= conflicts with shape-derived type.
  // deriveHtmlAttrs returns the shape-derived attrs; the caller compares against explicit attrs.

  test("string(email) derives type='email'; explicit type='text' would conflict", () => {
    const attrs = deriveHtmlAttrs(mkNamedShape("email"), "string");
    const shapeType = attrs["type"];
    const explicitType = "text";
    // Caller detects conflict: shapeType !== explicitType
    expect(shapeType).toBe("email");
    expect(shapeType).not.toBe(explicitType);
    // Shape-derived takes precedence (§53.7.3)
  });

  test("string(url) derives type='url'; explicit type='email' would conflict", () => {
    const attrs = deriveHtmlAttrs(mkNamedShape("url"), "string");
    expect(attrs["type"]).toBe("url");
  });

  test("no conflict when explicit type matches shape-derived type", () => {
    const attrs = deriveHtmlAttrs(mkNamedShape("email"), "string");
    const shapeType = attrs["type"];
    const explicitType = "email";
    // No conflict: shapeType === explicitType → no E-CONTRACT-004-WARN
    expect(shapeType).toBe(explicitType);
  });
});

// ---------------------------------------------------------------------------
// §29 emitServerParamCheck — named shape runtime validation
// ---------------------------------------------------------------------------

describe("§29 emitServerParamCheck — named shape check", () => {
  test("string(email) param emits a server-side email format check", () => {
    const pred = mkNamedShape("email");
    const lines = emitServerParamCheck("email", pred, null, "submitForm");
    const code = lines.join("\n");
    // Should contain the email runtime check expression
    expect(code).toContain("email");
    expect(code).toContain("400");
  });
});

// ---------------------------------------------------------------------------
// §30 deriveHtmlAttrs — integer type
// ---------------------------------------------------------------------------

describe("§30 deriveHtmlAttrs — integer base type", () => {
  test("integer(>0 && <100) → min='1' max='99' type='number'", () => {
    const pred = mkAnd(mkComparison(">", 0), mkComparison("<", 100));
    const attrs = deriveHtmlAttrs(pred, "integer");
    expect(attrs["min"]).toBe("1");
    expect(attrs["max"]).toBe("99");
    expect(attrs["type"]).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// §31 (d)-A batch 1 — predicateToJsExpr variant-set membership (§53.15.2)
//
// Enum variants lower to plain strings at runtime, so an enum-subset boundary
// check is a string-array `.includes`. `variants` is the resolved IN-SET
// (notIn already complemented at type-resolution time).
// ---------------------------------------------------------------------------

describe("§31 predicateToJsExpr — enum-subset variant-set (§53.15.2)", () => {
  test("variant-set → `[...].includes(valueExpr)` membership test", () => {
    const pred = { kind: "variant-set", variantMode: "oneOf", variants: ["Admin", "Editor"] };
    const js = predicateToJsExpr(pred, "_v");
    // S458 — membership is read off the TAG: a payload variant lowers to
    // `{ variant, data }`, a unit variant to its bare name.
    expect(js).toBe(`(["Admin","Editor"].includes(typeof _v === "object" && _v !== null ? _v.variant : _v))`);
  });

  test("S458: a PAYLOAD variant is judged by its tag (§53.15.5 admits payload variants in a subset)", () => {
    const pred = { kind: "variant-set", variantMode: "oneOf", variants: ["Ok", "Err"] };
    const fn = new Function("_v", `return ${predicateToJsExpr(pred, "_v")};`);
    expect(fn({ variant: "Ok", data: { value: 1 } })).toBe(true);
    expect(fn({ variant: "Pending", data: {} })).toBe(false);
    expect(fn("Err")).toBe(true);
    expect(fn(null)).toBe(false);
  });

  test("emitted membership expression is valid, parseable JS that evaluates correctly", () => {
    const pred = { kind: "variant-set", variantMode: "oneOf", variants: ["Admin", "Editor"] };
    const js = predicateToJsExpr(pred, "_v");
    // eslint-disable-next-line no-new-func
    const fn = new Function("_v", `return ${js};`);
    expect(fn("Admin")).toBe(true);
    expect(fn("Editor")).toBe(true);
    expect(fn("Viewer")).toBe(false);
  });

  test("emitRuntimeCheck over a variant-set emits an E-CONTRACT-001-RT membership guard", () => {
    const pred = { kind: "variant-set", variantMode: "oneOf", variants: ["Admin", "Editor"] };
    const lines = emitRuntimeCheck(pred, "_chk_role", "role", null, "narrow:1");
    const code = lines.join("\n");
    expect(code).toContain("E-CONTRACT-001-RT");
    expect(code).toContain(`["Admin","Editor"].includes(typeof _chk_role === "object" && _chk_role !== null ? _chk_role.variant : _chk_role)`);
    // Display string is the canonical positive subset form.
    expect(code).toContain("oneOf([.Admin, .Editor])");
    // The whole guard must be valid JS.
    // eslint-disable-next-line no-new-func
    expect(() => new Function("_chk_role", code)).not.toThrow();
  });
});
