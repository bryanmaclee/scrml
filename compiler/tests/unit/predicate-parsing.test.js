/**
 * §53 Inline Type Predicates — AST Parsing Tests (impl-predicate-parsing)
 *
 * Tests for type annotation parsing in ast-builder.js (TAB stage).
 * Covers:
 *   §1  @name: Type(pred) = expr  → reactive-decl with typeAnnotation
 *   §2  @name: string(named_shape) = expr  → named-shape predicate
 *   §3  @name: Type(complex && pred) = expr  → balanced parens in predicate
 *   §4  @name: Type(.prop predicate) = expr  → property predicate
 *   §5  @name: Type(pred)[label] = expr  → label suffix
 *   §6  @name = expr (no annotation)  → backward compat — no typeAnnotation
 *   §7  server @name: Type(pred) = expr  → isServer + typeAnnotation
 *   §8  function calc(x: Type(pred)) {}  → param with typeAnnotation
 *   §9  Regression: existing reactive-decl tests unaffected
 *   §10 Regression: server @var without annotation still works
 *   §11 Multiple params: some typed, some not
 *   §12 parseLogicBody path (block-level while loop) — type annotation
 *   §13 parseLogicBody server path — type annotation
 */

import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseSource(source, filePath = "/test/app.scrml") {
  const bsResult = splitBlocks(filePath, source);
  return buildAST(bsResult);
}

/**
 * Parse a logic block inside a <program> — exercises parseLogicBody outer while-loop path.
 * Note: <program> produces a markup node; logic blocks are in its children.
 * Returns body nodes.
 */
function parseTopLogic(logicSource) {
  const source = `<program>${logicSource}</program>`;
  const { ast } = parseSource(source);
  const programNode = ast.nodes.find(n => n.kind === "markup");
  if (!programNode) return [];
  const logicNode = (programNode.children || []).find(n => n.kind === "logic");
  if (!logicNode) return [];
  return logicNode.body || [];
}

function findAll(nodes, pred) {
  const found = [];
  function walk(list) {
    if (!Array.isArray(list)) return;
    for (const n of list) {
      if (!n) continue;
      if (pred(n)) found.push(n);
      if (Array.isArray(n.children)) walk(n.children);
      if (Array.isArray(n.body)) walk(n.body);
    }
  }
  walk(nodes);
  return found;
}

function findFunctionDecls(ast) {
  return findAll(ast.nodes, n => n.kind === "function-decl");
}

// ---------------------------------------------------------------------------
// §1: @name: Type(pred) = expr → reactive-decl with typeAnnotation
// ---------------------------------------------------------------------------

describe("§53 Inline Type Predicates — AST Parsing", () => {

  test("§1  @amount: number(>0) = 5 → reactive-decl with typeAnnotation 'number(>0)'", () => {
    const nodes = parseTopLogic("${ @amount: number(>0) = 5 }");
    const decl = nodes.find(n => n.kind === "state-decl");
    expect(decl).toBeDefined();
    expect(decl.name).toBe("amount");
    expect(decl.typeAnnotation).toBe("number(>0)");
    expect(decl.init).toBe("5");
  });

  // ---------------------------------------------------------------------------
  // §2: Named-shape predicate
  // ---------------------------------------------------------------------------

  test("§2  @email: string(email) = '' → typeAnnotation 'string(email)'", () => {
    const nodes = parseTopLogic('${ @email: string(email) = "" }');
    const decl = nodes.find(n => n.kind === "state-decl");
    expect(decl).toBeDefined();
    expect(decl.name).toBe("email");
    expect(decl.typeAnnotation).toBe("string(email)");
  });

  // ---------------------------------------------------------------------------
  // §3: Balanced parens in predicate
  // ---------------------------------------------------------------------------

  test("§3  @range: number(>0 && <10000) = input → balanced parens in predicate", () => {
    const nodes = parseTopLogic("${ @range: number(>0 && <10000) = input }");
    const decl = nodes.find(n => n.kind === "state-decl");
    expect(decl).toBeDefined();
    expect(decl.name).toBe("range");
    // The annotation preserves the type and predicate; whitespace may be normalized by tokenizer
    expect(decl.typeAnnotation).toBeDefined();
    expect(decl.typeAnnotation).toContain("number(");
    expect(decl.typeAnnotation).toContain(">0");
    expect(decl.typeAnnotation).toContain("<10000)");
  });

  // ---------------------------------------------------------------------------
  // §4: Property predicate
  // ---------------------------------------------------------------------------

  test("§4  @name: string(.length > 3) = '' → property predicate", () => {
    const nodes = parseTopLogic('${ @name: string(.length > 3) = "" }');
    const decl = nodes.find(n => n.kind === "state-decl");
    expect(decl).toBeDefined();
    expect(decl.name).toBe("name");
    expect(decl.typeAnnotation).toBeDefined();
    expect(decl.typeAnnotation).toContain("string");
    expect(decl.typeAnnotation).toContain("length");
  });

  // ---------------------------------------------------------------------------
  // §5: Label suffix [ident]
  // ---------------------------------------------------------------------------

  test("§5  @x: number(>0)[valid_x] = 1 → typeAnnotation includes label suffix", () => {
    const nodes = parseTopLogic("${ @x: number(>0)[valid_x] = 1 }");
    const decl = nodes.find(n => n.kind === "state-decl");
    expect(decl).toBeDefined();
    expect(decl.name).toBe("x");
    expect(decl.typeAnnotation).toBeDefined();
    expect(decl.typeAnnotation).toContain("number(>0)");
    expect(decl.typeAnnotation).toContain("[valid_x]");
  });

  // ---------------------------------------------------------------------------
  // §6: Backward compat — @name = expr with no annotation
  // ---------------------------------------------------------------------------

  test("§6  @cards = [] → reactive-decl WITHOUT typeAnnotation (backward compat)", () => {
    const nodes = parseTopLogic("${ @cards = [] }");
    const decl = nodes.find(n => n.kind === "state-decl");
    expect(decl).toBeDefined();
    expect(decl.name).toBe("cards");
    expect(decl.typeAnnotation).toBeUndefined();
    expect(decl.init).toContain("["); // tokenizer normalizes [] to [ ]
  });

  // ---------------------------------------------------------------------------
  // §7: server @name: Type(pred) = expr — server modifier + type annotation
  // ---------------------------------------------------------------------------

  test("§7  server @price: number(>0) = 0 → isServer: true AND typeAnnotation", () => {
    const nodes = parseTopLogic("${ server @price: number(>0) = 0 }");
    const decl = nodes.find(n => n.kind === "state-decl");
    expect(decl).toBeDefined();
    expect(decl.name).toBe("price");
    expect(decl.isServer).toBe(true);
    expect(decl.typeAnnotation).toBe("number(>0)");
    expect(decl.init).toBe("0");
  });

  // ---------------------------------------------------------------------------
  // §8: Function param with type annotation
  // ---------------------------------------------------------------------------

  test("§8  function calc(x: number(>0)) {} → param with name and typeAnnotation", () => {
    const { ast } = parseSource("<program>${function calc(x: number(>0)) { return x }}</program>");
    const fnDecls = findFunctionDecls(ast);
    const fn = fnDecls.find(n => n.name === "calc");
    expect(fn).toBeDefined();
    expect(fn.params).toBeDefined();
    expect(fn.params.length).toBe(1);
    const param = fn.params[0];
    expect(typeof param).toBe("object");
    expect(param.name).toBe("x");
    expect(param.typeAnnotation).toBeDefined();
    expect(param.typeAnnotation).toContain("number(>0)");
  });

  // ---------------------------------------------------------------------------
  // §9: Regression — existing reactive-decl tests
  // ---------------------------------------------------------------------------

  test("§9  @count = 0 still works (regression)", () => {
    const nodes = parseTopLogic("${ @count = 0 }");
    const decl = nodes.find(n => n.kind === "state-decl");
    expect(decl).toBeDefined();
    expect(decl.name).toBe("count");
    expect(decl.init).toBe("0");
    expect(decl.typeAnnotation).toBeUndefined();
    expect(decl.isServer).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // §10: Regression — server @var without annotation
  // ---------------------------------------------------------------------------

  test("§10 server @data = loadData() still works (regression)", () => {
    const nodes = parseTopLogic("${ server @data = loadData() }");
    const decl = nodes.find(n => n.kind === "state-decl");
    expect(decl).toBeDefined();
    expect(decl.name).toBe("data");
    expect(decl.isServer).toBe(true);
    expect(decl.typeAnnotation).toBeFalsy();
    expect(decl.init).toContain("loadData");
  });

  // ---------------------------------------------------------------------------
  // §11: Multiple params — some typed, some not
  // ---------------------------------------------------------------------------

  test("§11 function fn(a, b: number(>0), c) — mixed typed and untyped params", () => {
    const { ast } = parseSource("<program>${function fn(a, b: number(>0), c) { return a }}</program>");
    const fnDecls = findFunctionDecls(ast);
    const fn = fnDecls.find(n => n.name === "fn");
    expect(fn).toBeDefined();
    expect(fn.params.length).toBe(3);
    expect(fn.params[0].name).toBe("a");
    expect(fn.params[0].typeAnnotation).toBeFalsy();
    expect(fn.params[1].name).toBe("b");
    expect(fn.params[1].typeAnnotation).toBeDefined();
    expect(fn.params[1].typeAnnotation).toContain("number(>0)");
    expect(fn.params[2].name).toBe("c");
    expect(fn.params[2].typeAnnotation).toBeFalsy();
  });

  // ---------------------------------------------------------------------------
  // §12: parseLogicBody outer while-loop — type annotation (same as §1, different purpose)
  // Tests that the outer while-loop in parseLogicBody handles type annotations
  // ---------------------------------------------------------------------------

  test("§12 parseLogicBody while-loop @amount: number(>0) = 5 → typeAnnotation", () => {
    // <program>${...}</program> exercises the parseLogicBody outer while-loop directly
    const nodes = parseTopLogic("${ @amount: number(>0) = 5 }");
    const decl = nodes.find(n => n.kind === "state-decl");
    expect(decl).toBeDefined();
    expect(decl.typeAnnotation).toBe("number(>0)");
  });

  // ---------------------------------------------------------------------------
  // §13: parseLogicBody server path — type annotation via outer while-loop
  // ---------------------------------------------------------------------------

  test("§13 parseLogicBody server @items: string(email) = '' → isServer + typeAnnotation", () => {
    const nodes = parseTopLogic('${ server @items: string(email) = "" }');
    const decl = nodes.find(n => n.kind === "state-decl");
    expect(decl).toBeDefined();
    expect(decl.isServer).toBe(true);
    expect(decl.typeAnnotation).toBe("string(email)");
  });

});
