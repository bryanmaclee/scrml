/**
 * `not` keyword — Unit Tests (§42)
 *
 * Tests for scrml's unified absence value:
 *   §1  Tokenizer: `not` is recognized as a keyword
 *   §2  AST: `x = not` parses as assignment with not literal
 *   §3  AST: `x is not` parses as expression
 *   §4  Codegen: `not` rewrites to `null`
 *   §5  Codegen: `is not` rewrites to null check
 *   §6  Type system: `not` is a builtin type
 *   §7  Type system: tNot() produces correct shape
 *   §8  Codegen: `x != not` pattern
 */

import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { rewriteNotKeyword, rewritePresenceGuard, rewriteExpr } from "../../src/codegen/rewrite.ts";
import { resetVarCounter } from "../../src/codegen/var-counter.ts";
import { emitLogicNode } from "../../src/codegen/emit-logic.ts";
import { parseExprToNode, emitStringFromTree } from "../../src/expression-parser.ts";
import { tNot, tPrimitive, tUnion, tEnum, tUnknown, tAsIs, checkExhaustiveness, checkUnionExhaustiveness, isOptionalType, checkNotAssignment, checkNotReturn, BUILTIN_TYPES } from "../../src/type-system.ts";

// GITI-017 residual (S125): round-trip an expression through preprocessForAcorn
// (the SECOND `not`-lowering site, in expression-parser.ts). parseExprToNode
// runs preprocess + acorn parse; emitStringFromTree renders the resulting node.
function roundTripExpr(src) {
  const node = parseExprToNode(src, "not-keyword.test.scrml", 0);
  return emitStringFromTree(node);
}

function parse(source) {
  const bsOut = splitBlocks("test.scrml", source);
  return buildAST(bsOut);
}

// ---------------------------------------------------------------------------
// §1-§3: Tokenizer + AST
// ---------------------------------------------------------------------------

describe("not keyword — tokenizer and AST", () => {
  test("§1 `not` in logic body does not produce parse error", () => {
    const result = parse("${ let x = not }");
    // Should parse without fatal errors (not may appear as ident or keyword)
    const fatalErrors = result.errors.filter(e => !e.code?.startsWith("W-"));
    // not might trigger some warnings but shouldn't be a fatal parse error
    expect(result.ast).toBeDefined();
    expect(result.ast.nodes.length).toBeGreaterThan(0);
  });

  test("§2 `x = not` produces logic node with not in expression", () => {
    const result = parse("${ let x = not }");
    const logic = result.ast.nodes.find(n => n.kind === "logic");
    expect(logic).toBeDefined();
    if (logic?.body) {
      const decl = logic.body.find(n => n.kind === "let-decl");
      if (decl) {
        expect(decl.init).toContain("not");
      }
    }
  });

  test("§3 `x is not` parses as expression", () => {
    const result = parse("${ let check = x is not }");
    const logic = result.ast.nodes.find(n => n.kind === "logic");
    expect(logic).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// §4-§5, §8: Codegen rewrite
// ---------------------------------------------------------------------------

describe("not keyword — codegen rewrite", () => {
  test("§4 standalone `not` rewrites to `null`", () => {
    const result = rewriteNotKeyword("not");
    expect(result).toBe("null");
  });

  test("§4b `let x = not` rewrites not to null", () => {
    const result = rewriteNotKeyword("let x = not");
    expect(result).toContain("null");
    expect(result).not.toContain("not");
  });

  test("§5 `x is not` rewrites to null/undefined check", () => {
    const result = rewriteNotKeyword("x is not");
    expect(result).toBe("(x === null || x === undefined)");
  });

  test("§5b `is not` with reactive var (@name) preserves @ for later rewrite", () => {
    const result = rewriteNotKeyword("@name is not");
    // @ is preserved so the reactive rewrite can expand it later
    expect(result).toBe("(@name === null || @name === undefined)");
  });

  test("§5c `is not` with dotted property access", () => {
    const result = rewriteNotKeyword("obj.prop is not");
    expect(result).toBe("(obj.prop === null || obj.prop === undefined)");
  });

  test("§5d negated `is not` pattern", () => {
    const result = rewriteNotKeyword("!(@x is not)");
    // inner `@x is not` rewrites correctly
    expect(result).toContain("@x === null || @x === undefined");
  });

  // bug-18 / GITI-015 (S210) — is-op with a computed (bracket-index) LHS. The
  // library-mode line-by-line path (rewriteIsOperator(rewriteNotKeyword(line)))
  // had NO fallback for `is some` / `is not not` once the LHS was a bracket
  // index, so the keyword survived literal → E-CODEGEN-INVALID-LOGIC
  // (`arr[i + 1] is some ? …`). The LHS chain now admits a bracket-index tail.
  test("§5e `is not` with simple bracket-index LHS", () => {
    expect(rewriteNotKeyword("arr[i] is not")).toBe("(arr[i] === null || arr[i] === undefined)");
  });

  test("§5f `is some` with arithmetic bracket-index LHS (the bug-18 repro)", () => {
    expect(rewriteNotKeyword("args[i + 1] is some")).toBe("(args[i + 1] !== null && args[i + 1] !== undefined)");
  });

  test("§5g `is not not` with bracket-index LHS", () => {
    expect(rewriteNotKeyword("arr[i] is not not")).toBe("(arr[i] !== null && arr[i] !== undefined)");
  });

  test("§5h mixed member + index chain LHS", () => {
    expect(rewriteNotKeyword("a.b[i].c is some")).toBe("(a.b[i].c !== null && a.b[i].c !== undefined)");
  });

  test("§5i one level of nested-bracket index LHS", () => {
    expect(rewriteNotKeyword("arr[idx[0]] is some")).toBe("(arr[idx[0]] !== null && arr[idx[0]] !== undefined)");
  });

  test("§5j reactive @-prefixed bracket-index LHS preserves @", () => {
    expect(rewriteNotKeyword("@arr[i] is not")).toBe("(@arr[i] === null || @arr[i] === undefined)");
  });

  // g-isop-call-tail-lhs-paren-miscompile (ss3, S210) — an is-op whose LHS ends
  // in a CALL (`re.exec(s) is some`). The pre-fix `_rewriteParenthesizedIsOp`
  // matched the call's `)` and grabbed only its OWN arg-parens (`(s)`), emitting
  // `re.exec((s) != null)` — the receiver `re.exec` was swallowed into the
  // comparison (valid JS, silent-WRONG). The call-vs-grouping guard now captures
  // the WHOLE call chain as the LHS (single-eval), emitting `(re.exec(s) != null)`.
  test("§5k `is some` with a call-tail LHS (the bug repro)", () => {
    expect(rewriteNotKeyword("re.exec(s) is some")).toBe("(re.exec(s) != null)");
  });

  test("§5l `is not` (absence) with a call-tail LHS", () => {
    expect(rewriteNotKeyword("re.exec(s) is not")).toBe("(re.exec(s) == null)");
  });

  test("§5m `is not not` with a call-tail LHS", () => {
    expect(rewriteNotKeyword("re.exec(s) is not not")).toBe("(re.exec(s) != null)");
  });

  test("§5n nested-call LHS `f(g(x))`", () => {
    expect(rewriteNotKeyword("f(g(x)) is some")).toBe("(f(g(x)) != null)");
  });

  test("§5o member-chain call LHS `o.a.b(x)`", () => {
    expect(rewriteNotKeyword("o.a.b(x) is some")).toBe("(o.a.b(x) != null)");
  });

  test("§5p index+member+call chain LHS `arr[i].f(x)`", () => {
    expect(rewriteNotKeyword("arr[i].f(x) is some")).toBe("(arr[i].f(x) != null)");
  });

  test("§5q explicit-grouping form `(re.exec(s)) is some` still works (keyword not swallowed)", () => {
    // `(...)` whose `(` is preceded by the `return` keyword must be read as a
    // GROUPING paren, not a call — else the keyword is swallowed into the LHS.
    expect(rewriteNotKeyword("(re.exec(s)) is some")).toBe("((re.exec(s)) != null)");
    expect(rewriteNotKeyword("return re.exec(s) is some")).toBe("return (re.exec(s) != null)");
  });

  test("§5r call-tail fix does NOT disturb the bare-ident / dotted regex path", () => {
    expect(rewriteNotKeyword("x is some")).toBe("(x !== null && x !== undefined)");
    expect(rewriteNotKeyword("obj.prop is some")).toBe("(obj.prop !== null && obj.prop !== undefined)");
  });

  test("§8 no-op when no `not` keyword present", () => {
    expect(rewriteNotKeyword("a + b")).toBe("a + b");
  });

  test("§8b preserves `not` inside string literals", () => {
    const input = '"this is not a test"';
    const result = rewriteNotKeyword(input);
    expect(result).toBe(input);
  });

  test("§8c empty/null input", () => {
    expect(rewriteNotKeyword("")).toBe("");
    expect(rewriteNotKeyword(null)).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// §9-§12: Presence guard `(x) => { body }` (§42)
// ---------------------------------------------------------------------------

describe("presence guard — rewritePresenceGuard (§42)", () => {
  test("§9 basic presence guard rewrites to if-statement", () => {
    const result = rewritePresenceGuard("( x ) => { use ( x ) }");
    expect(result).toContain("if (x !== null && x !== undefined)");
    expect(result).toContain("use ( x )");
    expect(result).not.toContain("=>");
  });

  test("§9b presence guard with longer variable name", () => {
    const result = rewritePresenceGuard("( userName ) => { console . log ( userName ) }");
    expect(result).toBe("if (userName !== null && userName !== undefined) { console . log ( userName ) }");
  });

  test("§9c presence guard with underscore-prefixed variable", () => {
    const result = rewritePresenceGuard("( _val ) => { doSomething ( _val ) }");
    expect(result).toContain("if (_val !== null && _val !== undefined)");
  });

  test("§10 multi-param arrow is NOT rewritten (regression guard)", () => {
    const result = rewritePresenceGuard("( x , y ) => { return x + y }");
    expect(result).not.toContain("if (");
    expect(result).toContain("=>");
  });

  test("§10b expression-body arrow with parens is NOT rewritten (regression guard)", () => {
    // Single-param with parens but expression body (no braces) — not a presence guard
    const result = rewritePresenceGuard("( x ) => x . value");
    expect(result).not.toContain("if (");
    expect(result).toContain("=>");
  });

  test("§10c inline callback in method call is NOT rewritten (regression guard)", () => {
    // The whole expression is not `(x) => { ... }` at the top level
    const result = rewritePresenceGuard("items . map ( ( x ) => x . value )");
    expect(result).not.toContain("if (");
    expect(result).toContain("map");
  });

  test("§10d no-op when no arrow present", () => {
    const result = rewritePresenceGuard("a + b");
    expect(result).toBe("a + b");
  });

  test("§10e no-op when null/undefined input", () => {
    expect(rewritePresenceGuard("")).toBe("");
    expect(rewritePresenceGuard(null)).toBe(null);
  });
});

describe("presence guard — rewriteExpr integration (§42)", () => {
  test("§11 rewriteExpr rewrites presence guard in full pipeline", () => {
    const result = rewriteExpr("( x ) => { use ( x ) }");
    expect(result).toContain("if (x !== null && x !== undefined)");
    expect(result).not.toContain("=>");
  });

  test("§11b rewriteExpr does not affect regular arrow in expression context", () => {
    // This is not a top-level presence guard (there's surrounding code)
    const result = rewriteExpr("items.map(x => x.value)");
    expect(result).toContain("map");
    expect(result).toContain("=>");
    expect(result).not.toContain("if (x !== null");
  });

  test("§11c rewriteExpr does not affect multi-param arrow", () => {
    const result = rewriteExpr("( x , y ) => x + y");
    expect(result).not.toContain("if (x !== null");
    expect(result).toContain("=>");
  });
});

describe("presence guard — emitLogicNode bare-expr (§42)", () => {
  test("§12 bare-expr presence guard emits clean if-block without trailing semicolon", () => {
    const node = {
      id: 1,
      kind: "bare-expr",
      expr: "( x ) => { use ( x ) }",
      span: { file: "test.scrml", start: 0, end: 22, line: 1, col: 1 },
    };
    const result = emitLogicNode(node);
    expect(result).toContain("if (x !== null && x !== undefined)");
    expect(result).not.toMatch(/\}\s*;$/);  // should not end with };
    expect(result).toContain("use");
  });

  test("§12b bare-expr presence guard with @reactive var in body", () => {
    const node = {
      id: 2,
      kind: "bare-expr",
      expr: "( item ) => { @items . push ( item ) }",
      span: { file: "test.scrml", start: 0, end: 38, line: 1, col: 1 },
    };
    const result = emitLogicNode(node);
    expect(result).toContain("if (item !== null && item !== undefined)");
    expect(result).toContain("push");
  });

  test("§12c regular bare-expr arrow (multi-param) is NOT rewritten to if-block", () => {
    const node = {
      id: 3,
      kind: "bare-expr",
      expr: "arr.sort(( a , b ) => a - b)",
      span: { file: "test.scrml", start: 0, end: 28, line: 1, col: 1 },
    };
    const result = emitLogicNode(node);
    expect(result).not.toContain("if (a !== null");
    expect(result).not.toContain("if (b !== null");
  });
});

// ---------------------------------------------------------------------------
// §6-§7: Type system
// ---------------------------------------------------------------------------

describe("not keyword — type system", () => {
  test("§6 `not` is in BUILTIN_TYPES", () => {
    expect(BUILTIN_TYPES.has("not")).toBe(true);
  });

  test("§7 tNot() produces { kind: 'not' }", () => {
    const t = tNot();
    expect(t.kind).toBe("not");
  });

  test("§7b BUILTIN_TYPES.get('not') has kind 'not'", () => {
    const t = BUILTIN_TYPES.get("not");
    expect(t).toBeDefined();
    expect(t.kind).toBe("not");
  });
});

// ---------------------------------------------------------------------------
// §13-§16: E-SYNTAX-010 — reject `null`/`undefined` in value position (§42)
// ---------------------------------------------------------------------------

describe("E-SYNTAX-010 — null/undefined rejection (§42)", () => {
  test("§13 rewriteNotKeyword detects `null` and pushes E-SYNTAX-010", () => {
    const errors = [];
    rewriteNotKeyword("let x = null", errors);
    const syntaxErrors = errors.filter(e => e.code === "E-SYNTAX-010");
    expect(syntaxErrors.length).toBe(1);
    expect(syntaxErrors[0].message).toContain("null");
    expect(syntaxErrors[0].message).toContain("not");
  });

  test("§13b rewriteNotKeyword detects `undefined` and pushes E-SYNTAX-010", () => {
    const errors = [];
    rewriteNotKeyword("let x = undefined", errors);
    const syntaxErrors = errors.filter(e => e.code === "E-SYNTAX-010");
    expect(syntaxErrors.length).toBe(1);
    expect(syntaxErrors[0].message).toContain("undefined");
  });

  test("§14 E-SYNTAX-010 not triggered without errors array", () => {
    // Should not throw when no errors array provided
    const result = rewriteNotKeyword("let x = null");
    expect(result).toBe("let x = null");
  });

  test("§14b `null` inside string literal does NOT trigger E-SYNTAX-010", () => {
    const errors = [];
    rewriteNotKeyword('"null value"', errors);
    const syntaxErrors = errors.filter(e => e.code === "E-SYNTAX-010");
    expect(syntaxErrors.length).toBe(0);
  });

  test("§14c `nullify` (identifier containing null) does NOT trigger E-SYNTAX-010", () => {
    const errors = [];
    rewriteNotKeyword("nullify(x)", errors);
    const syntaxErrors = errors.filter(e => e.code === "E-SYNTAX-010");
    expect(syntaxErrors.length).toBe(0);
  });

  test("§14d `undefined` inside string literal does NOT trigger E-SYNTAX-010", () => {
    const errors = [];
    rewriteNotKeyword('"check for undefined"', errors);
    const syntaxErrors = errors.filter(e => e.code === "E-SYNTAX-010");
    expect(syntaxErrors.length).toBe(0);
  });

  test("§15 rewriteExpr propagates E-SYNTAX-010 via errors array", () => {
    const errors = [];
    rewriteExpr("let x = null", errors);
    const syntaxErrors = errors.filter(e => e.code === "E-SYNTAX-010");
    expect(syntaxErrors.length).toBe(1);
  });

  test("§16 AST parser produces E-EQ-002 for `== not`", () => {
    const result = parse("${ let check = x == not }");
    const eqErrors = result.errors.filter(e => e.code === "E-EQ-002");
    expect(eqErrors.length).toBeGreaterThan(0);
    expect(eqErrors[0].message).toContain("is not");
  });

  test("§16b AST parser produces E-EQ-002 for `!= not`", () => {
    const result = parse("${ let check = x != not }");
    const eqErrors = result.errors.filter(e => e.code === "E-EQ-002");
    expect(eqErrors.length).toBeGreaterThan(0);
    expect(eqErrors[0].message).toContain("is not");
  });

  test("§16c `== not` is rewritten to `is not` in output (recovery)", () => {
    const result = parse("${ let check = x == not }");
    const logic = result.ast.nodes.find(n => n.kind === "logic");
    expect(logic).toBeDefined();
    // The expression should contain "is not" after recovery rewrite
    const decl = logic?.body?.find(n => n.kind === "let-decl");
    if (decl && decl.init) {
      expect(decl.init).toContain("is not");
      expect(decl.init).not.toContain("==");
    }
  });
});

// ---------------------------------------------------------------------------
// §17-§19: E-TYPE-042 — reject `== not` / `=== not` in rewrite pass (§42)
// ---------------------------------------------------------------------------

describe("E-TYPE-042 — equality-based not check rejection (§42)", () => {
  test("§17 rewriteNotKeyword detects `== not` and pushes E-TYPE-042", () => {
    const errors = [];
    rewriteNotKeyword("x == not", errors);
    const typeErrors = errors.filter(e => e.code === "E-TYPE-042");
    expect(typeErrors.length).toBe(1);
    expect(typeErrors[0].message).toContain("== not");
    expect(typeErrors[0].message).toContain("is not");
  });

  test("§17b rewriteNotKeyword detects `!= not` and pushes E-TYPE-042", () => {
    const errors = [];
    rewriteNotKeyword("x != not", errors);
    const typeErrors = errors.filter(e => e.code === "E-TYPE-042");
    expect(typeErrors.length).toBe(1);
    expect(typeErrors[0].message).toContain("!(x is not)");
  });

  test("§17c rewriteNotKeyword detects `=== not` and pushes E-TYPE-042", () => {
    const errors = [];
    rewriteNotKeyword("x === not", errors);
    const typeErrors = errors.filter(e => e.code === "E-TYPE-042");
    expect(typeErrors.length).toBe(1);
  });

  test("§17d rewriteNotKeyword detects `!== not` and pushes E-TYPE-042", () => {
    const errors = [];
    rewriteNotKeyword("x !== not", errors);
    const typeErrors = errors.filter(e => e.code === "E-TYPE-042");
    expect(typeErrors.length).toBe(1);
  });

  test("§18 `== not` inside string literal does NOT trigger E-TYPE-042", () => {
    const errors = [];
    rewriteNotKeyword('"x == not"', errors);
    const typeErrors = errors.filter(e => e.code === "E-TYPE-042");
    expect(typeErrors.length).toBe(0);
  });

  test("§18b no E-TYPE-042 when valid `is not` is used", () => {
    const errors = [];
    rewriteNotKeyword("x is not", errors);
    const typeErrors = errors.filter(e => e.code === "E-TYPE-042");
    expect(typeErrors.length).toBe(0);
  });

  test("§19 `== not` triggers E-TYPE-042 via rewriteExpr", () => {
    const errors = [];
    rewriteExpr("x == not", errors);
    const typeErrors = errors.filter(e => e.code === "E-TYPE-042");
    expect(typeErrors.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// §20-§22: T | not type union inference
// ---------------------------------------------------------------------------

describe("T | not type union (§42)", () => {
  test("§20 tNot() is distinct from other builtin types", () => {
    const notType = tNot();
    const stringType = BUILTIN_TYPES.get("string");
    expect(notType.kind).toBe("not");
    expect(stringType.kind).not.toBe("not");
  });

  test("§21 `not` in match arm is valid pattern", () => {
    // `match x { not => ... (x) => ... }` should parse
    const result = parse("${ match val { not => handleAbsence ( ) , (val) => handlePresence ( val ) } }");
    expect(result.ast).toBeDefined();
    expect(result.ast.nodes.length).toBeGreaterThan(0);
  });

  test("§22 `not` as return value parses correctly", () => {
    const result = parse("${ return not }");
    expect(result.ast).toBeDefined();
    const logic = result.ast.nodes.find(n => n.kind === "logic");
    expect(logic).toBeDefined();
  });

  test("§22b tUnion with tNot produces a union containing not", () => {
    const unionType = tUnion([tPrimitive("string"), tNot()]);
    expect(unionType.kind).toBe("union");
    expect(unionType.members.length).toBe(2);
    expect(unionType.members.some(m => m.kind === "not")).toBe(true);
    expect(unionType.members.some(m => m.kind === "primitive")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §23-§27: E-MATCH-012 — match on T | not without not arm (§42)
// ---------------------------------------------------------------------------

describe("E-MATCH-012 — match exhaustiveness with not (§42)", () => {
  test("§23 checkUnionExhaustiveness reports `not` missing from T | not", () => {
    const unionType = tUnion([tPrimitive("string"), tNot()]);
    // Only cover string, not `not`
    const armPatterns = [
      { kind: "is-type", typeName: "string" },
    ];
    const result = checkUnionExhaustiveness(unionType, armPatterns);
    expect(result.missing).toContain("not");
  });

  test("§23b checkUnionExhaustiveness reports nothing missing when both covered", () => {
    const unionType = tUnion([tPrimitive("string"), tNot()]);
    const armPatterns = [
      { kind: "is-type", typeName: "string" },
      { kind: "is-type", typeName: "not" },
    ];
    const result = checkUnionExhaustiveness(unionType, armPatterns);
    expect(result.missing.length).toBe(0);
  });

  test("§23c checkUnionExhaustiveness reports nothing missing when wildcard covers all", () => {
    const unionType = tUnion([tPrimitive("string"), tNot()]);
    const armPatterns = [
      { kind: "is-type", typeName: "string" },
      { kind: "wildcard" },
    ];
    const result = checkUnionExhaustiveness(unionType, armPatterns);
    expect(result.missing.length).toBe(0);
  });

  test("§24 checkExhaustiveness emits E-MATCH-012 for T | not missing not arm", () => {
    const unionType = tUnion([tPrimitive("string"), tNot()]);
    const matchNode = {
      arms: [
        { pattern: { kind: "is-type", typeName: "string" } },
      ],
    };
    const span = { file: "test.scrml", start: 0, end: 10, line: 1, col: 1 };
    const errors = [];
    checkExhaustiveness(matchNode, unionType, span, errors);
    const matchErrors = errors.filter(e => e.code === "E-MATCH-012");
    expect(matchErrors.length).toBe(1);
    expect(matchErrors[0].message).toContain("not");
    expect(matchErrors[0].message).toContain("§42");
  });

  test("§24b checkExhaustiveness does NOT emit E-MATCH-012 when wildcard present", () => {
    const unionType = tUnion([tPrimitive("string"), tNot()]);
    const matchNode = {
      arms: [
        { pattern: { kind: "is-type", typeName: "string" } },
        { pattern: { kind: "wildcard" } },
      ],
    };
    const span = { file: "test.scrml", start: 0, end: 10, line: 1, col: 1 };
    const errors = [];
    checkExhaustiveness(matchNode, unionType, span, errors);
    const matchErrors = errors.filter(e => e.code === "E-MATCH-012");
    expect(matchErrors.length).toBe(0);
  });

  test("§25 checkExhaustiveness does NOT emit E-MATCH-012 when not arm is present", () => {
    const unionType = tUnion([tPrimitive("string"), tNot()]);
    const matchNode = {
      arms: [
        { pattern: { kind: "is-type", typeName: "string" } },
        { pattern: { kind: "is-type", typeName: "not" } },
      ],
    };
    const span = { file: "test.scrml", start: 0, end: 10, line: 1, col: 1 };
    const errors = [];
    checkExhaustiveness(matchNode, unionType, span, errors);
    expect(errors.length).toBe(0);
  });

  test("§26 non-not union still uses E-TYPE-006", () => {
    const unionType = tUnion([tPrimitive("string"), tPrimitive("number")]);
    const matchNode = {
      arms: [
        { pattern: { kind: "is-type", typeName: "string" } },
      ],
    };
    const span = { file: "test.scrml", start: 0, end: 10, line: 1, col: 1 };
    const errors = [];
    checkExhaustiveness(matchNode, unionType, span, errors);
    const typeErrors = errors.filter(e => e.code === "E-TYPE-006");
    expect(typeErrors.length).toBe(1);
    const matchErrors = errors.filter(e => e.code === "E-MATCH-012");
    expect(matchErrors.length).toBe(0);
  });

  test("§27 T | not missing both T and not still emits E-MATCH-012 + E-TYPE-006", () => {
    const unionType = tUnion([tPrimitive("string"), tNot()]);
    const matchNode = {
      arms: [],  // no arms at all
    };
    const span = { file: "test.scrml", start: 0, end: 10, line: 1, col: 1 };
    const errors = [];
    checkExhaustiveness(matchNode, unionType, span, errors);
    const matchErrors = errors.filter(e => e.code === "E-MATCH-012");
    const typeErrors = errors.filter(e => e.code === "E-TYPE-006");
    expect(matchErrors.length).toBe(1);
    expect(typeErrors.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// §23d-§25d: E-MATCH-012 — REAL-representation `T | not` enum exhaustiveness.
//
// The §23-§27 block above models a `not` arm as `{kind:"is-type",typeName:"not"}`
// — a SYNTHETIC shape the real pipeline never emits. `extractArmsFromMatchNode`
// (the single-scrutinee path) records a `not :>` arm as `{kind:"variant",
// variantName:"not"}` (`not` is a keyword — never a real enum variant), a
// present `.Variant` arm as `{kind:"variant",variantName:<V>}`, and a canonical
// §18 `given u :>` present-case arm as `{kind:"present-binding"}`. These are the
// shapes that were mis-counted, letting E-MATCH-012 + E-TYPE-006 co-fire on a
// SPEC-canonical exhaustive `T | not` match (SPEC.md:23152, SPEC.md:8594-8606).
// These tests pin the fix at the shapes the real pipeline produces.
// ---------------------------------------------------------------------------

describe("E-MATCH-012 — real-representation T | not enum exhaustiveness (§42)", () => {
  const roleUnion = () => tUnion([
    tEnum("Role", [
      { name: "Admin", payload: null, renders: null },
      { name: "Editor", payload: null, renders: null },
    ]),
    tNot(),
  ]);
  const span = () => ({ file: "test.scrml", start: 0, end: 10, line: 1, col: 1 });

  // (a) not-arm-clean — `not` arm + all present variant arms → exhaustive.
  test("§23d checkUnionExhaustiveness — `not` arm + all present variants clears T | not", () => {
    const result = checkUnionExhaustiveness(roleUnion(), [
      { kind: "variant", variantName: "Admin" },
      { kind: "variant", variantName: "Editor" },
      { kind: "variant", variantName: "not" },
    ]);
    expect(result.missing.length).toBe(0);
  });

  test("§23e checkUnionExhaustiveness — `not` arm + `given` present-binding clears T | not", () => {
    const result = checkUnionExhaustiveness(roleUnion(), [
      { kind: "variant", variantName: "not" },
      { kind: "present-binding" },
    ]);
    expect(result.missing.length).toBe(0);
  });

  // (b) not-arm-only-still-fires — `not` arm but NO present coverage → the T
  // member is still missing (soundness: absence handled, present is not).
  test("§23f checkUnionExhaustiveness — `not` arm only (missing T) reports the T member missing", () => {
    const result = checkUnionExhaustiveness(roleUnion(), [
      { kind: "variant", variantName: "not" },
    ]);
    expect(result.missing).toContain("Role");
    expect(result.missing).not.toContain("not");
  });

  // Adversarial: a `not` arm + a PARTIAL present variant set (missing `.Editor`)
  // must NOT be accepted as exhaustive (do-not-over-accept).
  test("§23g checkUnionExhaustiveness — `not` arm + partial variants (missing .Editor) is non-exhaustive", () => {
    const result = checkUnionExhaustiveness(roleUnion(), [
      { kind: "variant", variantName: "Admin" },
      { kind: "variant", variantName: "not" },
    ]);
    expect(result.missing).toContain("Role");
  });

  // End-to-end via checkExhaustiveness — the three core shapes.
  test("§25b checkExhaustiveness — `not` arm + present variants emits NO E-MATCH-012 / E-TYPE-006", () => {
    const errors = [];
    checkExhaustiveness({ arms: [
      { kind: "variant", variantName: "Admin" },
      { kind: "variant", variantName: "Editor" },
      { kind: "variant", variantName: "not" },
    ] }, roleUnion(), span(), errors);
    expect(errors.filter(e => e.code === "E-MATCH-012").length).toBe(0);
    expect(errors.filter(e => e.code === "E-TYPE-006").length).toBe(0);
  });

  test("§25c checkExhaustiveness — `not` arm only (missing T) fires E-TYPE-006, NOT E-MATCH-012", () => {
    const errors = [];
    checkExhaustiveness({ arms: [
      { kind: "variant", variantName: "not" },
    ] }, roleUnion(), span(), errors);
    expect(errors.filter(e => e.code === "E-TYPE-006").length).toBe(1);
    expect(errors.filter(e => e.code === "E-MATCH-012").length).toBe(0);
  });

  test("§25d checkExhaustiveness — present arms only (no not) fires E-MATCH-012, NOT E-TYPE-006", () => {
    const errors = [];
    checkExhaustiveness({ arms: [
      { kind: "variant", variantName: "Admin" },
      { kind: "variant", variantName: "Editor" },
    ] }, roleUnion(), span(), errors);
    expect(errors.filter(e => e.code === "E-MATCH-012").length).toBe(1);
    expect(errors.filter(e => e.code === "E-TYPE-006").length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §28-§32: E-TYPE-041 — reject `not` assigned to non-optional type (§42)
// ---------------------------------------------------------------------------

describe("E-TYPE-041 — not assignment to non-optional type (§42)", () => {
  test("§28 isOptionalType returns true for `not` type", () => {
    expect(isOptionalType(tNot())).toBe(true);
  });

  test("§28b isOptionalType returns true for `string | not` union", () => {
    expect(isOptionalType(tUnion([tPrimitive("string"), tNot()]))).toBe(true);
  });

  test("§28c isOptionalType returns false for plain `string`", () => {
    expect(isOptionalType(tPrimitive("string"))).toBe(false);
  });

  test("§28d isOptionalType returns true for `unknown` (permissive)", () => {
    expect(isOptionalType(tUnknown())).toBe(true);
  });

  test("§28e isOptionalType returns true for `asIs` (permissive)", () => {
    expect(isOptionalType(tAsIs())).toBe(true);
  });

  test("§29 checkNotAssignment returns null for optional type", () => {
    const result = checkNotAssignment(tUnion([tPrimitive("string"), tNot()]), "x");
    expect(result).toBeNull();
  });

  test("§29b checkNotAssignment returns error for non-optional type", () => {
    const result = checkNotAssignment(tPrimitive("string"), "x");
    expect(result).not.toBeNull();
    expect(result).toContain("E-TYPE-041");
    expect(result).toContain("string | not");
  });

  test("§30 checkNotAssignment returns null for `not` type itself", () => {
    expect(checkNotAssignment(tNot(), "x")).toBeNull();
  });

  test("§30b checkNotAssignment includes variable name in error", () => {
    const result = checkNotAssignment(tPrimitive("number"), "myVar");
    expect(result).toContain("myVar");
    expect(result).toContain("number");
  });
});

// ---------------------------------------------------------------------------
// §33-§35: E-TYPE-043 — reject function returning `not` on non-optional return (§42)
// ---------------------------------------------------------------------------

describe("E-TYPE-043 — function returning not with non-optional return type (§42)", () => {
  test("§33 checkNotReturn returns null for optional return type", () => {
    const result = checkNotReturn(tUnion([tPrimitive("string"), tNot()]), "getData");
    expect(result).toBeNull();
  });

  test("§33b checkNotReturn returns error for non-optional return type", () => {
    const result = checkNotReturn(tPrimitive("string"), "getData");
    expect(result).not.toBeNull();
    expect(result).toContain("E-TYPE-043");
    expect(result).toContain("getData");
    expect(result).toContain("string | not");
  });

  test("§34 checkNotReturn returns null for unknown return type", () => {
    expect(checkNotReturn(tUnknown(), "fn")).toBeNull();
  });

  test("§35 checkNotReturn includes function name in error", () => {
    const result = checkNotReturn(tPrimitive("boolean"), "isValid");
    expect(result).toContain("isValid");
    expect(result).toContain("boolean");
  });
});

// ---------------------------------------------------------------------------
// §42.2.2a: `is some` — positive presence check
// ---------------------------------------------------------------------------

describe("§42.2.2a: is some — positive presence check", () => {
  test("@var is some compiles to !== null && !== undefined", () => {
    const result = rewriteExpr("@x is some", {});
    expect(result).toContain("!== null");
    expect(result).toContain("!== undefined");
  });

  test("identifier is some compiles correctly", () => {
    const result = rewriteExpr("user is some", {});
    expect(result).toContain("user !== null");
    expect(result).toContain("user !== undefined");
  });

  test("dotted.path is some compiles correctly", () => {
    const result = rewriteExpr("card.title is some", {});
    expect(result).toContain("card.title !== null");
    expect(result).toContain("card.title !== undefined");
  });

  test("is some does not match inside strings", () => {
    const result = rewriteExpr('"x is some"', {});
    expect(result).toBe('"x is some"');
  });

  test("is some does not match partial identifiers", () => {
    const result = rewriteExpr("isSomething is some", {});
    // isSomething should not be mangled — only the `is some` operator applies
    expect(result).toContain("isSomething !== null");
  });

  test("is null rewrites to === null (after not→null conversion)", () => {
    const result = rewriteExpr("x is null");
    expect(result).toContain("=== null");
    expect(result).not.toContain("is null");
  });

  test("not (expr) rewrites to !(expr) for logical negation", () => {
    const result = rewriteExpr("not (x === null)");
    expect(result).toContain("!(");
    expect(result).not.toMatch(/null\s*\(/);
  });

  test("not (x is not) rewrites to !(x === null || x === undefined)", () => {
    const result = rewriteExpr("not (x is not)");
    expect(result).toContain("!(");
    expect(result).toContain("=== null");
  });
});


// ---------------------------------------------------------------------------
// §42.2.4 Phase A: (expr) is not / is some / is not not — parenthesized form
// ---------------------------------------------------------------------------

describe("§42.2.4 Phase A — parenthesized compound is not / is some (DQ-12)", () => {
  // S103: paren-form lowering no longer interposes a tmpvar. Single-evaluation
  // is intrinsic to the paren form — `(expr) cmp null` evaluates expr exactly
  // once on the LHS; `null` is a constant on the RHS, no second reference.
  // Prior emit `((_scrml_tmp_N = (expr)) cmp null)` used an undeclared tmpvar
  // which threw ReferenceError in ES-module strict mode (caught when
  // regenerated self-host meta-checker.js was executed against module-resolver.scrml).

  test("§A1 (regex.exec(str)) is not — absence form", () => {
    const result = rewriteNotKeyword("(regex.exec(str)) is not");
    expect(result).toBe("((regex.exec(str)) == null)");
    expect(result).not.toContain("is not");
    expect(result).not.toContain("=== null");  // must use double-equals for null+undefined
  });

  test("§A2 (regex.exec(str)) is some — presence form", () => {
    const result = rewriteNotKeyword("(regex.exec(str)) is some");
    expect(result).toBe("((regex.exec(str)) != null)");
    expect(result).not.toContain("is some");
  });

  test("§A3 (getUser(id)) is not not — presence form", () => {
    const result = rewriteNotKeyword("(getUser(id)) is not not");
    expect(result).toBe("((getUser(id)) != null)");
    expect(result).not.toContain("is not not");
    expect(result).not.toContain("is not");  // fully consumed
  });

  test("§A4 (arr[0]) is not — absence form", () => {
    const result = rewriteNotKeyword("(arr[0]) is not");
    expect(result).toBe("((arr[0]) == null)");
    expect(result).not.toContain("is not");
  });

  test("§A5 (x + y) is some — presence form", () => {
    const result = rewriteNotKeyword("(x + y) is some");
    expect(result).toBe("((x + y) != null)");
    expect(result).not.toContain("is some");
  });

  test("§A6 nested parens ((f(g()))) is not — correctly finds outermost paren", () => {
    const result = rewriteNotKeyword("((f(g()))) is not");
    // Should capture the full ((f(g()))) expression, not a partial inner paren
    expect(result).toBe("(((f(g()))) == null)");
    expect(result).not.toContain("is not");
  });

  test("§A7 single-evaluation — expr appears in output exactly once", () => {
    const result = rewriteNotKeyword("(sideEffect()) is not");
    // sideEffect() must appear exactly once — single-evaluation is the load-bearing
    // invariant. The paren-form emit guarantees this: expr is on the LHS, `null` is
    // a constant on the RHS, no duplication.
    expect(result.indexOf("sideEffect()")).toBe(result.lastIndexOf("sideEffect()"));
    expect(result).toContain("== null");
  });

  test("§A8 regression — existing identifier is not still works unchanged", () => {
    const result = rewriteNotKeyword("x is not");
    expect(result).toBe("(x === null || x === undefined)");
  });

  test("§A9 regression — dotted.path is not still works unchanged", () => {
    const result = rewriteNotKeyword("obj.prop is not");
    expect(result).toBe("(obj.prop === null || obj.prop === undefined)");
  });

  test("§A10 regression — @var is some still works unchanged", () => {
    const result = rewriteNotKeyword("@name is some");
    expect(result).toBe("(@name !== null && @name !== undefined)");
  });

  test("§A11 regression — is not inside string literal NOT rewritten", () => {
    const input = '"(regex.exec(str)) is not"';
    const result = rewriteNotKeyword(input);
    expect(result).toBe(input);  // unchanged — inside string literal
  });

  test("§A12 rewriteExpr pipeline — (regex.exec(str)) is not rewrites end-to-end", () => {
    const result = rewriteExpr("(regex.exec(str)) is not");
    // Client pipeline applies rewriteEqualityOps after rewriteNotKeyword:
    // `== null` → `=== null` (strict). Library-mode emit skips rewriteEqualityOps
    // and preserves `== null` (matches both null + undefined).
    expect(result).toContain("(regex.exec(str)) === null");
  });

  test("§A13 multiple parenthesized expressions in one segment", () => {
    const result = rewriteNotKeyword("(a()) is not && (b()) is some");
    expect(result).toBe("((a()) == null) && ((b()) != null)");
    expect(result).not.toContain("is not");
    expect(result).not.toContain("is some");
  });

  test("§A14 (expr) is not not — presence, not absence", () => {
    const result = rewriteNotKeyword("(getValue()) is not not");
    // is not not = presence check = != null
    expect(result).toContain("!= null");
    expect(result).not.toContain("== null");
  });

  test("§A15 bare paren around identifier — paren form lowers directly", () => {
    const result = rewriteNotKeyword("(x) is not");
    expect(result).toBe("((x) == null)");
  });
});

// ---------------------------------------------------------------------------
// §B: GITI-017 — regex-literal + comment awareness (S124, 2026-05-23)
//
// Prior to S124, rewriteNotKeyword's text-substitution pass had string-literal
// skip but no regex-literal or comment skip. Result: `/not foo/i` corrupted
// silently to `/!foo/i` (boolean-negation lowering) and `/(not)/` to
// `/(null)/` (absence-sentinel lowering). Silent-corruption class — emitted
// JS parsed clean, regex was syntactically valid, runtime executed — but
// matched a different string than the author wrote.
//
// Fix: regex-literal-aware state machine extending the existing string skip.
// Regex detection uses ECMA-262-style trailing-context disambiguation
// (regexAllowedAfter) — `/` opens a regex after operator/punctuation/
// regex-permissive-keyword, otherwise it's division.
// ---------------------------------------------------------------------------
describe("§B GITI-017: regex-literal + comment awareness", () => {
  // ---- Regex literals — the core silent-corruption class ----

  test("§B1 /not foo/i preserved verbatim (the GITI-017 minimal case)", () => {
    const result = rewriteNotKeyword("return /not a jj repo/i.test(input)");
    expect(result).toBe("return /not a jj repo/i.test(input)");
    expect(result).not.toContain("/!");
  });

  test("§B2 /bookmark.*not found/i preserved (not<space><ident> form)", () => {
    const result = rewriteNotKeyword("return /bookmark.*not found/i.test(input)");
    expect(result).toBe("return /bookmark.*not found/i.test(input)");
  });

  test("§B3 /(not)/ preserved (bare not between parens)", () => {
    const result = rewriteNotKeyword("return /(not) a jj repo/i.test(input)");
    expect(result).toBe("return /(not) a jj repo/i.test(input)");
    expect(result).not.toContain("/(null)");
  });

  test("§B4 /not[ ]a/ preserved (not before char-class)", () => {
    const result = rewriteNotKeyword("return /not[ ]a jj repo/i.test(input)");
    expect(result).toBe("return /not[ ]a jj repo/i.test(input)");
  });

  test("§B5 /(?:not)/ preserved (not inside non-capturing group)", () => {
    const result = rewriteNotKeyword("return /(?:not) a jj repo/i.test(input)");
    expect(result).toBe("return /(?:not) a jj repo/i.test(input)");
  });

  test("§B6 /nothing/ preserved (no `not` token boundary)", () => {
    const result = rewriteNotKeyword("return /nothing changed/i.test(input)");
    expect(result).toBe("return /nothing changed/i.test(input)");
  });

  // ---- Regex-vs-division disambiguation ----

  test("§B7 division a/b/c is NOT treated as regex", () => {
    // After identifier `a`, `/` is division — `b` is identifier, not regex body.
    // The expression has no `not`/`some`/`null`/`undefined` so the fast-path
    // returns early; force the substitution surface by including `is not`.
    const result = rewriteNotKeyword("let x = a/b/c; let y = z is not");
    // Division preserved; `is not` rewritten on the second statement.
    expect(result).toContain("a/b/c");
    expect(result).toContain("(z === null || z === undefined)");
  });

  test("§B8 division of identifier-tail.method() does not mask following code", () => {
    const result = rewriteNotKeyword("result = arr.length / 2; return x is not");
    expect(result).toContain("arr.length / 2");
    expect(result).toContain("(x === null || x === undefined)");
  });

  test("§B9 regex after `=` recognized as regex", () => {
    const result = rewriteNotKeyword("const re = /not foo/i");
    expect(result).toBe("const re = /not foo/i");
  });

  test("§B10 regex after `(` recognized as regex", () => {
    const result = rewriteNotKeyword("test(/not bar/i)");
    expect(result).toBe("test(/not bar/i)");
  });

  test("§B11 regex after `,` recognized as regex", () => {
    const result = rewriteNotKeyword("call(arg, /not baz/i)");
    expect(result).toBe("call(arg, /not baz/i)");
  });

  test("§B12 regex containing escaped slash /a\\/b\\/c/i correctly closed", () => {
    const result = rewriteNotKeyword("return /a\\/not\\/b/i.test(s)");
    expect(result).toBe("return /a\\/not\\/b/i.test(s)");
  });

  test("§B13 regex char-class containing `/` /[/not]/ correctly closed", () => {
    const result = rewriteNotKeyword("return /[/not]/i.test(s)");
    expect(result).toBe("return /[/not]/i.test(s)");
  });

  // ---- Comments ----

  test("§B14 block comment containing `not` preserved verbatim", () => {
    const result = rewriteNotKeyword("/* foo is not bar */ let x = 1");
    expect(result).toBe("/* foo is not bar */ let x = 1");
  });

  test("§B15 line comment containing `not` preserved verbatim", () => {
    const result = rewriteNotKeyword("let x = 1; // x is not zero\nlet y = 2");
    expect(result).toBe("let x = 1; // x is not zero\nlet y = 2");
  });

  test("§B16 code AFTER a block-comment still rewrites correctly", () => {
    const result = rewriteNotKeyword("/* not affected */ return x is not");
    expect(result).toBe("/* not affected */ return (x === null || x === undefined)");
  });

  test("§B17 code AFTER a line-comment still rewrites correctly", () => {
    const result = rewriteNotKeyword("// not affected\nreturn x is not");
    expect(result).toBe("// not affected\nreturn (x === null || x === undefined)");
  });

  // ---- Round-trip regression: substitution still works in code segments ----

  test("§B18 mixed: regex preserved AND surrounding `is not` rewritten", () => {
    const result = rewriteNotKeyword(
      "if (x is not) { return /not found/i.test(s) }"
    );
    expect(result).toContain("(x === null || x === undefined)");
    expect(result).toContain("/not found/i");
  });

  test("§B19 regression: `is not` inside string still skipped (S124 didn't break this)", () => {
    const result = rewriteNotKeyword('let s = "x is not y"');
    expect(result).toBe('let s = "x is not y"');
  });

  test("§B20 regression: bare `not` as value still rewrites to null", () => {
    const result = rewriteNotKeyword("let x = not");
    expect(result).toBe("let x = null");
  });
});

// ---------------------------------------------------------------------------
// §C: GITI-017 RESIDUAL — preprocessForAcorn regex fence (S125, 2026-05-24)
// ---------------------------------------------------------------------------
//
// f181d60a (S124) fenced the CODEGEN `not`-lowering pass (rewriteNotKeyword,
// covered by §B above). But scrml has a SECOND, separately-located `not `→`!`
// boolean-negation lowering inside `preprocessForAcorn` (expression-parser.ts),
// which had NO literal/comment fence. It corrupted regex-literal interiors at
// PARSE time — BEFORE the codegen pass ran — so §B's coverage never caught it:
//
//   `/not a jj repo/i`        → `/!a jj repo/i`     (boolean-negation — was broken)
//   `/bookmark.*not found/i`  → `/bookmark.*!found/i`  (boolean-negation — was broken)
//
// The PA-verified end-to-end symptom: `const re = /not a jj repo/i` emitted
// `const re = /!a jj repo/i;` (silent corruption — valid JS, valid regex, wrong
// pattern). S125 routes both `not` substitutions in preprocessForAcorn through
// the SAME shared fence (rewriteCodeSegments). These tests exercise that path
// via parseExprToNode → emitStringFromTree (round-trip through preprocessForAcorn).
describe("§C GITI-017 residual: preprocessForAcorn regex fence", () => {
  // Full repro-13 matrix — every regex literal must round-trip VERBATIM.

  test("§C1 /not a jj repo/i preserved (boolean-negation — the residual bug)", () => {
    expect(roundTripExpr("/not a jj repo/i")).toBe("/not a jj repo/i");
  });

  test("§C2 /bookmark.*not found/i preserved (boolean-negation — the residual bug)", () => {
    expect(roundTripExpr("/bookmark.*not found/i")).toBe("/bookmark.*not found/i");
  });

  test("§C3 /(not) a jj repo/i preserved (absence-sentinel — must NOT regress)", () => {
    expect(roundTripExpr("/(not) a jj repo/i")).toBe("/(not) a jj repo/i");
  });

  test("§C4 /nothing changed/i preserved (control — `not` inside `nothing`)", () => {
    expect(roundTripExpr("/nothing changed/i")).toBe("/nothing changed/i");
  });

  test("§C5 /n[o]t a jj repo/i preserved (char-class workaround — must stay verbatim)", () => {
    expect(roundTripExpr("/n[o]t a jj repo/i")).toBe("/n[o]t a jj repo/i");
  });

  // Regex appearing mid-expression (after `=`, after `(`) — fence must still fire.

  test("§C6 regex after `=` in a larger expression preserved", () => {
    // The `/` after `=` opens a regex; its `not ` body must survive.
    expect(roundTripExpr("re = /not a jj repo/i")).toContain("/not a jj repo/i");
  });

  test("§C7 regex as a call argument preserved", () => {
    expect(roundTripExpr("test(/not bar/i)")).toContain("/not bar/i");
  });

  // CODE-context `not` lowering MUST still work (the fix only fences literals).

  test("§C8 code-context `not @x` still lowers to `!@x`", () => {
    expect(roundTripExpr("not @x")).toBe("!@x");
  });

  test("§C9 code-context `not (a)` still lowers to negation (`!a`)", () => {
    // `not (` prefix-negation form. The AST emitter drops the redundant parens
    // around a single identifier, so `not (a)` normalizes to `!a` (same as the
    // hand-written `!(a)` — verified equivalent below).
    const out = roundTripExpr("not (a)");
    expect(out).toBe("!a");
    expect(roundTripExpr("!(a)")).toBe(out);
  });

  test("§C10 regex preserved AND surrounding code-context `not` still lowered", () => {
    // The regex body is fenced; the trailing `not flag` outside it is lowered.
    const out = roundTripExpr("test(/not bar/i) && not flag");
    expect(out).toContain("/not bar/i");
    expect(out).toContain("!flag");
  });

  test("§C11 `not` inside a string literal is preserved (string fence)", () => {
    expect(roundTripExpr('"a not b"')).toBe('"a not b"');
  });
});
