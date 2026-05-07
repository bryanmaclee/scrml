/**
 * Phase A1b Step B9 — validator-arg ExprNode conversion.
 *
 * Tests for `compiler/src/validator-arg-parser.ts` and its wiring into
 * Step 5 (`ast-builder.js:scanStructuralDeclLookahead`). B9 transforms the
 * raw-text `args: string[]` produced by Step 5 into structured
 * `args: ValidatorArg[]` (ExprNode | RelationalPredicateNode).
 *
 * Per audit §1.2: relational-predicate form (`length(>=N)`) gets a
 * RelationalPredicateNode (Option A); standard expression forms get an
 * ExprNode via the existing expression-parser (which already handles
 * @cell, bare-dot variants per S66, and member-access).
 *
 * Per audit §1.5: bareword form (`<x req>`) preserves `args: null`;
 * zero-arg call form (`<x req()>`) preserves `args: []`.
 *
 * Per audit §1.7 + §55.11 cross-field validation: the dep-graph walker
 * traverses through RelationalPredicateNode.value so identifier reads in
 * cross-field args (e.g., `eq(@signup.password)`) are tracked.
 *
 * Test sections:
 *   §B9.1  — direct parser: relational forms (6 ops × 2 RHS shapes)
 *   §B9.2  — direct parser: standard predicates (numeric, string, regex,
 *            @cell, member, call, array-of-bare-variants)
 *   §B9.3  — null vs [] vs [...] preservation (bareword/zero-arg/non-empty)
 *   §B9.4  — Step 5 integration: full source-text parse → structured args
 *   §B9.5  — walker integration: forEachIdentInValidators traverses through
 *            both relational and standard arg forms
 *   §B9.6  — idempotency: calling decorate twice is a no-op the second time
 *   §B9.7  — error path: malformed relational form returns escape-hatch
 */

import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import {
  parseValidatorArg,
  decorateValidatorsWithExprNodes,
  forEachIdentInValidators,
  forEachIdentInValidatorArg,
} from "../../src/validator-arg-parser.ts";

const SPAN = { file: "<probe>", start: 0, end: 10, line: 1, col: 1 };

function parse(source) {
  const bs = splitBlocks("test.scrml", source);
  return buildAST(bs);
}

/** Recursively walk AST and find all state-decls. */
function findStateDecls(ast) {
  const found = [];
  const seen = new WeakSet();
  function walk(n) {
    if (!n || typeof n !== "object") return;
    if (seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (n.kind === "state-decl") found.push(n);
    for (const k of Object.keys(n)) walk(n[k]);
  }
  walk(ast);
  return found;
}

describe("A1b Step B9 — validator-arg ExprNode conversion (direct parser)", () => {
  // §B9.1 — relational predicate: 6 ops × representative RHS

  test("§B9.1a: length(>=2) → RelationalPredicateNode { op: '>=', value: lit 2 }", () => {
    const node = parseValidatorArg("length", ">= 2", SPAN, "<probe>", 0);
    expect(node.kind).toBe("relational-predicate");
    expect(node.op).toBe(">=");
    expect(node.value.kind).toBe("lit");
    expect(node.value.value).toBe(2);
  });

  test("§B9.1b: length(<=100) → op '<=' value lit 100", () => {
    const node = parseValidatorArg("length", "<= 100", SPAN, "<probe>", 0);
    expect(node.kind).toBe("relational-predicate");
    expect(node.op).toBe("<=");
    expect(node.value.value).toBe(100);
  });

  test("§B9.1c: length(<5) → op '<' value lit 5", () => {
    const node = parseValidatorArg("length", "< 5", SPAN, "<probe>", 0);
    expect(node.op).toBe("<");
    expect(node.value.value).toBe(5);
  });

  test("§B9.1d: length(>0) → op '>' value lit 0", () => {
    const node = parseValidatorArg("length", "> 0", SPAN, "<probe>", 0);
    expect(node.op).toBe(">");
    expect(node.value.value).toBe(0);
  });

  test("§B9.1e: length(=7) → op '=' value lit 7", () => {
    const node = parseValidatorArg("length", "= 7", SPAN, "<probe>", 0);
    expect(node.op).toBe("=");
    expect(node.value.value).toBe(7);
  });

  test("§B9.1f: length(!=0) → op '!=' value lit 0", () => {
    const node = parseValidatorArg("length", "!= 0", SPAN, "<probe>", 0);
    expect(node.op).toBe("!=");
    expect(node.value.value).toBe(0);
  });

  // 2-char ops MUST be tried before 1-char — guard against `>=` parsing as `>`.
  test("§B9.1g: 2-char op precedence: '>=' is NOT split as '>' + '=2'", () => {
    const node = parseValidatorArg("length", ">= 2", SPAN, "<probe>", 0);
    expect(node.op).toBe(">=");
    expect(node.value.value).toBe(2);
  });

  test("§B9.1h: relational with @cell rhs: length(>= @minLen)", () => {
    const node = parseValidatorArg("length", ">= @minLen", SPAN, "<probe>", 0);
    expect(node.kind).toBe("relational-predicate");
    expect(node.op).toBe(">=");
    expect(node.value.kind).toBe("ident");
    expect(node.value.name).toBe("@minLen");
  });

  // §B9.2 — standard predicates

  test("§B9.2a: min(18) → lit (number) 18", () => {
    const node = parseValidatorArg("min", "18", SPAN, "<probe>", 0);
    expect(node.kind).toBe("lit");
    expect(node.value).toBe(18);
    expect(node.litType).toBe("number");
  });

  test("§B9.2b: max(120) → lit (number) 120", () => {
    const node = parseValidatorArg("max", "120", SPAN, "<probe>", 0);
    expect(node.kind).toBe("lit");
    expect(node.value).toBe(120);
  });

  test("§B9.2c: pattern(\"[a-z]+\") → lit (string) '[a-z]+'", () => {
    const node = parseValidatorArg("pattern", '"[a-z]+"', SPAN, "<probe>", 0);
    expect(node.kind).toBe("lit");
    expect(node.litType).toBe("string");
    expect(node.value).toBe("[a-z]+");
  });

  test("§B9.2d: pattern(/^[^@]+@[^@]+$/) → escape-hatch with raw preserved", () => {
    // Regex literals fall to escape-hatch (esTreeToExprNode BigInt/exotic
    // branch); raw is preserved so B10 can read it.
    const node = parseValidatorArg("pattern", "/^[^@]+@[^@]+$/", SPAN, "<probe>", 0);
    expect(node.kind).toBe("escape-hatch");
    expect(node.raw).toBe("/^[^@]+@[^@]+$/");
  });

  test("§B9.2e: eq(@signup.password) → member { object: ident('@signup'), property: 'password' }", () => {
    const node = parseValidatorArg("eq", "@signup.password", SPAN, "<probe>", 0);
    expect(node.kind).toBe("member");
    expect(node.object.kind).toBe("ident");
    expect(node.object.name).toBe("@signup");
    expect(node.property).toBe("password");
  });

  test("§B9.2f: gte(@startDate) → ident '@startDate'", () => {
    const node = parseValidatorArg("gte", "@startDate", SPAN, "<probe>", 0);
    expect(node.kind).toBe("ident");
    expect(node.name).toBe("@startDate");
  });

  test("§B9.2g: gt(@startDate.plus(1, 'day')) → call expression", () => {
    const node = parseValidatorArg("gt", "@startDate.plus(1, \"day\")", SPAN, "<probe>", 0);
    expect(node.kind).toBe("call");
    expect(node.callee.kind).toBe("member");
    expect(node.args.length).toBe(2);
  });

  test("§B9.2h: oneOf([.Admin, .Editor]) → array { elements: [ident('.Admin'), ident('.Editor')] }", () => {
    const node = parseValidatorArg("oneOf", "[ .Admin , .Editor ]", SPAN, "<probe>", 0);
    expect(node.kind).toBe("array");
    expect(node.elements.length).toBe(2);
    expect(node.elements[0].kind).toBe("ident");
    expect(node.elements[0].name).toBe(".Admin");
    expect(node.elements[1].kind).toBe("ident");
    expect(node.elements[1].name).toBe(".Editor");
  });

  test("§B9.2i: notIn([.Banned]) → array with single bare-variant ident", () => {
    const node = parseValidatorArg("notIn", "[ .Banned ]", SPAN, "<probe>", 0);
    expect(node.kind).toBe("array");
    expect(node.elements.length).toBe(1);
    expect(node.elements[0].name).toBe(".Banned");
  });

  test("§B9.2j: lt(@maxAge - 1) → binary expression", () => {
    const node = parseValidatorArg("lt", "@maxAge - 1", SPAN, "<probe>", 0);
    expect(node.kind).toBe("binary");
    expect(node.op).toBe("-");
    expect(node.left.kind).toBe("ident");
    expect(node.left.name).toBe("@maxAge");
  });

  // §B9.3 — null vs [] vs [...] preservation

  test("§B9.3a: bareword `args: null` preserved (decorate is a no-op)", () => {
    const validators = [{ name: "req", args: null, span: SPAN }];
    decorateValidatorsWithExprNodes(validators, "<probe>");
    expect(validators[0].args).toBeNull();
  });

  test("§B9.3b: zero-arg-call `args: []` preserved (decorate is a no-op)", () => {
    const validators = [{ name: "req", args: [], span: SPAN }];
    decorateValidatorsWithExprNodes(validators, "<probe>");
    expect(Array.isArray(validators[0].args)).toBe(true);
    expect(validators[0].args.length).toBe(0);
  });

  test("§B9.3c: non-empty raw-text args `[\"...\"]` get parsed into structured nodes", () => {
    const validators = [{ name: "min", args: ["18"], span: SPAN }];
    decorateValidatorsWithExprNodes(validators, "<probe>");
    expect(validators[0].args.length).toBe(1);
    expect(validators[0].args[0].kind).toBe("lit");
    expect(validators[0].args[0].value).toBe(18);
  });

  // §B9.4 — Step 5 integration: full source-text parse

  test("§B9.4a: <userName req length(>=2)> → bareword + relational structured", () => {
    const src = `<program>\${ <userName req length(>=2)> = <input type="text"/> }</program>`;
    const { ast } = parse(src);
    const decls = findStateDecls(ast);
    expect(decls.length).toBe(1);
    const d = decls[0];
    expect(d.validators.length).toBe(2);
    // req: bareword, args:null
    expect(d.validators[0].name).toBe("req");
    expect(d.validators[0].args).toBeNull();
    // length: structured RelationalPredicateNode
    expect(d.validators[1].name).toBe("length");
    expect(d.validators[1].args[0].kind).toBe("relational-predicate");
    expect(d.validators[1].args[0].op).toBe(">=");
    expect(d.validators[1].args[0].value.kind).toBe("lit");
    expect(d.validators[1].args[0].value.value).toBe(2);
  });

  test("§B9.4b: <age min(18) max(120)> → both args parse as numeric ExprNodes", () => {
    const src = `<program>\${ <age min(18) max(120)> = <input type="number"/> }</program>`;
    const { ast } = parse(src);
    const decls = findStateDecls(ast);
    expect(decls.length).toBe(1);
    const d = decls[0];
    expect(d.validators[0].args[0].kind).toBe("lit");
    expect(d.validators[0].args[0].value).toBe(18);
    expect(d.validators[1].args[0].value).toBe(120);
  });

  test("§B9.4c: <confirm req eq(@password)> → cross-field IdentExpr arg", () => {
    const src = `<program>\${ <confirm req eq(@password)> = <input type="password"/> }</program>`;
    const { ast } = parse(src);
    const decls = findStateDecls(ast);
    const d = decls[0];
    expect(d.validators[1].name).toBe("eq");
    expect(d.validators[1].args[0].kind).toBe("ident");
    expect(d.validators[1].args[0].name).toBe("@password");
  });

  test("§B9.4d: <slug pattern(\"[a-z]+\")> → string-literal arg (Step-5 quote-restoration fix)", () => {
    const src = `<program>\${ <slug pattern("[a-z]+")> = <input type="text"/> }</program>`;
    const { ast } = parse(src);
    const decls = findStateDecls(ast);
    const d = decls[0];
    expect(d.validators[0].name).toBe("pattern");
    expect(d.validators[0].args[0].kind).toBe("lit");
    expect(d.validators[0].args[0].litType).toBe("string");
    expect(d.validators[0].args[0].value).toBe("[a-z]+");
  });

  // §B9.5 — walker integration

  test("§B9.5a: forEachIdentInValidatorArg traverses RelationalPredicateNode.value", () => {
    const arg = parseValidatorArg("length", ">= @minLen", SPAN, "<probe>", 0);
    const idents = [];
    forEachIdentInValidatorArg(arg, (id) => idents.push(id.name));
    expect(idents).toContain("@minLen");
  });

  test("§B9.5b: forEachIdentInValidatorArg traverses standard ExprNode (member chain)", () => {
    const arg = parseValidatorArg("eq", "@signup.password", SPAN, "<probe>", 0);
    const idents = [];
    forEachIdentInValidatorArg(arg, (id) => idents.push(id.name));
    // member: walks `object` (the @signup base) but NOT property (static name).
    expect(idents).toEqual(["@signup"]);
  });

  test("§B9.5c: forEachIdentInValidators auto-skips bareword and zero-arg entries", () => {
    const validators = [
      { name: "req", args: null, span: SPAN },
      { name: "noArgs", args: [], span: SPAN },
      { name: "eq", args: ["@password"], span: SPAN },
    ];
    decorateValidatorsWithExprNodes(validators, "<probe>");
    const idents = [];
    forEachIdentInValidators(validators, (id) => idents.push(id.name));
    expect(idents).toEqual(["@password"]);
  });

  test("§B9.5d: forEachIdentInValidators collects across mixed forms (cross-field §55.11)", () => {
    // Mirrors the §55.11 worked example shape:
    // <confirm req eq(@signup.password)> + the dep-graph needs to see @signup.
    const validators = [
      { name: "req", args: null, span: SPAN },
      { name: "eq", args: ["@signup.password"], span: SPAN },
    ];
    decorateValidatorsWithExprNodes(validators, "<probe>");
    const idents = [];
    forEachIdentInValidators(validators, (id) => idents.push(id.name));
    expect(idents).toEqual(["@signup"]);
  });

  test("§B9.5e: walker traverses through nested call expression (gte(@startDate.plus(1, 'day')))", () => {
    const validators = [
      { name: "gte", args: ["@startDate.plus(1, \"day\")"], span: SPAN },
    ];
    decorateValidatorsWithExprNodes(validators, "<probe>");
    const idents = [];
    forEachIdentInValidators(validators, (id) => idents.push(id.name));
    expect(idents).toContain("@startDate");
  });

  test("§B9.5f: walker collects bare-variant + @cell from oneOf array", () => {
    const validators = [
      { name: "oneOf", args: ["[ .Admin , @maybeBanned ]"], span: SPAN },
    ];
    decorateValidatorsWithExprNodes(validators, "<probe>");
    const idents = [];
    forEachIdentInValidators(validators, (id) => idents.push(id.name));
    expect(idents).toContain(".Admin");
    expect(idents).toContain("@maybeBanned");
  });

  // §B9.6 — idempotency

  test("§B9.6a: decorateValidatorsWithExprNodes is idempotent (second call is no-op)", () => {
    const validators = [
      { name: "length", args: [">= 2"], span: SPAN },
      { name: "min", args: ["18"], span: SPAN },
    ];
    decorateValidatorsWithExprNodes(validators, "<probe>");
    const firstLengthArg = validators[0].args[0];
    const firstMinArg = validators[1].args[0];
    decorateValidatorsWithExprNodes(validators, "<probe>");
    // Same object reference — no re-parsing.
    expect(validators[0].args[0]).toBe(firstLengthArg);
    expect(validators[1].args[0]).toBe(firstMinArg);
  });

  // §B9.7 — error paths

  test("§B9.7a: relational form with no rhs (length(>=)) → escape-hatch", () => {
    // Step 5 would store `>=` as the raw text; B9 returns escape-hatch since
    // there's no expression after the operator.
    const node = parseValidatorArg("length", ">=", SPAN, "<probe>", 0);
    expect(node.kind).toBe("escape-hatch");
    expect(node.estreeType).toBe("RelationalPredicateNoRhs");
  });

  test("§B9.7b: length(arg-with-no-rel-op) → escape-hatch", () => {
    // If a non-relational raw text reaches the length predicate (e.g.,
    // someone writes `length(req)`), B9 surfaces escape-hatch — B10 owns
    // the typed error.
    const node = parseValidatorArg("length", "req", SPAN, "<probe>", 0);
    expect(node.kind).toBe("escape-hatch");
    expect(node.estreeType).toBe("RelationalPredicateNoOp");
  });

  test("§B9.7c: empty raw text → escape-hatch", () => {
    const node = parseValidatorArg("min", "", SPAN, "<probe>", 0);
    expect(node.kind).toBe("escape-hatch");
    expect(node.estreeType).toBe("EmptyValidatorArg");
  });

  // §B9.7d: not-a-validator-shape → standard expression-parser path returns
  // escape-hatch (ParseError) cleanly, no throw.
  test("§B9.7d: malformed expr in standard-form → escape-hatch (ParseError), no throw", () => {
    const node = parseValidatorArg("eq", ")(((", SPAN, "<probe>", 0);
    expect(node.kind).toBe("escape-hatch");
    // estreeType comes from parseExprToNode — could be ParseError or similar.
  });
});
