/**
 * TOP-LEVEL-DECLS: bare top-level declaration lifting
 *
 * Tests that type, fn, function, server fn, and server function declarations
 * can be written bare inside <program> (and other markup/state contexts) without
 * requiring an explicit ${ } wrapper.
 *
 * Feature: liftBareDeclarations() pre-pass in buildAST (ast-builder.js).
 *
 * Error codes verified:
 *   E-PARSE-002 must NOT fire for bare declarations (they are lifted to logic context)
 */

import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compile a scrml source string through BS -> TAB and return { ast, errors }.
 */
function compile(source) {
  const bsResult = splitBlocks("test.scrml", source);
  const tabResult = buildAST(bsResult);
  return { ast: tabResult.ast, errors: [...bsResult.errors, ...tabResult.errors] };
}

/**
 * Collect all nodes of a given kind, recursively (top-level + inside logic blocks).
 */
function collectNodes(nodes, kind) {
  const found = [];
  function walk(nodeList) {
    for (const node of nodeList) {
      if (!node) continue;
      if (node.kind === kind) found.push(node);
      if (node.kind === "logic") walk(node.body || []);
      if (node.kind === "markup" || node.kind === "state") walk(node.children || []);
    }
  }
  walk(nodes);
  return found;
}

// ---------------------------------------------------------------------------
// §1: bare type declarations
// ---------------------------------------------------------------------------

describe("bare type declarations", () => {
  test("bare type:enum declaration compiles without error", () => {
    const source = "<program>\n  type Color:enum = { Red, Green, Blue }\n</program>";
    const { errors } = compile(source);
    const relevant = errors.filter(e => e.code && e.code !== "W-PROGRAM-001");
    expect(relevant).toHaveLength(0);
  });

  test("bare type declaration produces a type-decl node", () => {
    const source = "<program>\n  type Color:enum = { Red, Green, Blue }\n</program>";
    const { ast } = compile(source);
    expect(ast.typeDecls).toBeDefined();
    expect(ast.typeDecls.length).toBeGreaterThanOrEqual(1);
    const typeDecl = ast.typeDecls.find(t => t.name === "Color");
    expect(typeDecl).toBeDefined();
  });

  test("bare type declaration produces a synthetic logic node in program children", () => {
    const source = "<program>\n  type Color:enum = { Red, Green, Blue }\n  <div>hello</div>\n</program>";
    const { ast } = compile(source);
    const programNode = ast.nodes.find(n => n.kind === "markup" && n.tag === "program");
    expect(programNode).toBeDefined();
    const logicNodes = (programNode?.children || []).filter(n => n.kind === "logic");
    expect(logicNodes.length).toBeGreaterThanOrEqual(1);
  });

  test("multiple bare type declarations all compile", () => {
    const source = "<program>\n  type Color:enum = { Red, Green, Blue }\n  type Size:enum = { Small, Medium, Large }\n</program>";
    const { errors } = compile(source);
    const relevant = errors.filter(e => e.code && e.code !== "W-PROGRAM-001");
    expect(relevant).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §2: bare fn declarations
// ---------------------------------------------------------------------------

describe("bare fn declarations", () => {
  test("bare fn declaration does NOT trigger E-PARSE-002", () => {
    const source = "<program>\n  fn greet(name) { return \"Hello \" + name }\n</program>";
    const { errors } = compile(source);
    const parseErr = errors.find(e => e.code === "E-PARSE-002");
    expect(parseErr).toBeUndefined();
  });

  test("bare fn declaration produces a function-decl node in AST", () => {
    const source = "<program>\n  fn greet(name) { return \"Hello \" + name }\n</program>";
    const { ast } = compile(source);
    const funcDecls = collectNodes(ast.nodes, "function-decl");
    expect(funcDecls.length).toBeGreaterThanOrEqual(1);
    const greetDecl = funcDecls.find(f => f.name === "greet");
    expect(greetDecl).toBeDefined();
    expect(greetDecl?.fnKind).toBe("fn");
  });

  test("bare fn with no params compiles without E-PARSE-002", () => {
    const source = "<program>\n  fn render { return 42 }\n</program>";
    const { errors } = compile(source);
    const parseErr = errors.find(e => e.code === "E-PARSE-002");
    expect(parseErr).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// §3: bare function declarations
// ---------------------------------------------------------------------------

describe("bare function declarations", () => {
  test("bare function declaration compiles without error", () => {
    const source = "<program>\n  function greet(name) { return \"Hello \" + name }\n</program>";
    const { errors } = compile(source);
    const relevant = errors.filter(e => e.code && e.code !== "W-PROGRAM-001");
    expect(relevant).toHaveLength(0);
  });

  test("bare function declaration produces a function-decl node", () => {
    const source = "<program>\n  function add(a, b) { return a + b }\n</program>";
    const { ast } = compile(source);
    const funcDecls = collectNodes(ast.nodes, "function-decl");
    const addDecl = funcDecls.find(f => f.name === "add");
    expect(addDecl).toBeDefined();
    expect(addDecl?.fnKind).toBe("function");
  });

  test("bare function with multiple params compiles", () => {
    const source = "<program>\n  function clamp(value, min, max) { return value }\n</program>";
    const { errors } = compile(source);
    const relevant = errors.filter(e => e.code && e.code !== "W-PROGRAM-001");
    expect(relevant).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §4: bare server fn declarations
// ---------------------------------------------------------------------------

describe("bare server fn declarations", () => {
  test("bare server fn declaration does NOT trigger E-PARSE-002", () => {
    const source = "<program>\n  server fn getData() { return \"data\" }\n</program>";
    const { errors } = compile(source);
    const parseErr = errors.find(e => e.code === "E-PARSE-002");
    expect(parseErr).toBeUndefined();
  });

  test("bare server fn produces a function-decl with isServer=true", () => {
    const source = "<program>\n  server fn getData() { return \"data\" }\n</program>";
    const { ast } = compile(source);
    const funcDecls = collectNodes(ast.nodes, "function-decl");
    const decl = funcDecls.find(f => f.name === "getData");
    expect(decl).toBeDefined();
    expect(decl?.isServer).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §5: bare server function declarations
// ---------------------------------------------------------------------------

describe("bare server function declarations", () => {
  test("bare server function declaration compiles without error", () => {
    const source = "<program>\n  server function process(x) { return x }\n</program>";
    const { errors } = compile(source);
    const relevant = errors.filter(e => e.code && e.code !== "W-PROGRAM-001");
    expect(relevant).toHaveLength(0);
  });

  test("bare server function produces a function-decl with isServer=true", () => {
    const source = "<program>\n  server function process(x) { return x }\n</program>";
    const { ast } = compile(source);
    const funcDecls = collectNodes(ast.nodes, "function-decl");
    const decl = funcDecls.find(f => f.name === "process");
    expect(decl).toBeDefined();
    expect(decl?.isServer).toBe(true);
    expect(decl?.fnKind).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// §6: mixing bare declarations with explicit ${ } blocks
// ---------------------------------------------------------------------------

describe("bare declarations mixed with explicit logic blocks", () => {
  // Note: source strings using ${ } use escaped \$ in template literals
  test("bare fn + explicit logic block both work", () => {
    const source = "<program>\n  fn greet(name) { return \"Hello \" + name }\n  \${ let x = 1 }\n</program>";
    const { errors } = compile(source);
    // v0.3 Wave 2: explicit ${ } wrapping in <program> body is now lint-warned
    // via W-PROGRAM-REDUNDANT-LOGIC (SPEC §40.8). Filter the lint here so the
    // assertion focuses on fatal-error absence.
    const relevant = errors.filter(e => e.code && e.code !== "W-PROGRAM-001" && e.code !== "E-PARSE-002" && e.code !== "W-PROGRAM-REDUNDANT-LOGIC");
    expect(relevant).toHaveLength(0);
  });

  test("bare type + explicit fn in logic block both appear in AST", () => {
    const source = "<program>\n  type Color:enum = { Red, Green, Blue }\n  \${ fn format(c) { return c } }\n</program>";
    const { ast } = compile(source);
    expect(ast.typeDecls.length).toBeGreaterThanOrEqual(1);
    const funcDecls = collectNodes(ast.nodes, "function-decl");
    expect(funcDecls.length).toBeGreaterThanOrEqual(1);
  });

  test("bare decl followed by markup element calling it", () => {
    const source = "<program>\n  fn greet(name) { return \"Hello \" + name }\n  <div>\${ greet(\"world\") }</div>\n</program>";
    const { errors } = compile(source);
    const relevant = errors.filter(e => e.code && e.code !== "W-PROGRAM-001" && e.code !== "E-PARSE-002");
    expect(relevant).toHaveLength(0);
  });

  test("multiple bare declarations before markup", () => {
    const source = [
      "<program>",
      "  type Color:enum = { Red, Green, Blue }",
      "  fn greet(name) { return \"Hello \" + name }",
      "  function add(a, b) { return a + b }",
      "  <div>content</div>",
      "</program>",
    ].join("\n");
    const { errors } = compile(source);
    const relevant = errors.filter(e => e.code && e.code !== "W-PROGRAM-001" && e.code !== "E-PARSE-002");
    expect(relevant).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §7: non-declaration text is NOT lifted
// ---------------------------------------------------------------------------

describe("plain text is not lifted to logic blocks", () => {
  test("whitespace-only text in program children is not converted to logic", () => {
    const source = "<program>\n  <div>hello</div>\n</program>";
    const { ast } = compile(source);
    const programNode = ast.nodes.find(n => n.kind === "markup" && n.tag === "program");
    expect(programNode).toBeDefined();
    // whitespace text between program and div should remain text, not become logic
    const logicChildren = (programNode?.children || []).filter(n => n.kind === "logic");
    expect(logicChildren).toHaveLength(0);
  });

  // S441 (SPEC §40.8 S441 bullet) — a `<program>` body carries no loose prose:
  // a bare run there is CODE (it is lifted and checked), and displayed text is
  // declared by a markup element or a `"..."` literal. Pre-S441 these two tests
  // pinned "non-declaration text stays text"; they now pin the S441 contract.
  test("S441 — bare 'hello world' in a <program> body is code, and not valid code: E-UNQUOTED-DISPLAY-TEXT", () => {
    const bsResult = splitBlocks("test.scrml", "<program>hello world</program>");
    const { ast, errors } = buildAST(bsResult);
    const programNode = ast.nodes.find(n => n.kind === "markup" && n.tag === "program");
    const textChildren = (programNode?.children || []).filter(n => n.kind === "text" && n.value.trim() !== "");
    expect(textChildren).toHaveLength(0);
    expect(errors.filter(e => e.code === "E-UNQUOTED-DISPLAY-TEXT")).toHaveLength(1);
  });

  test("S441/S445 — 'typewriter' (a lone identifier) in a <program> body is code, not text — and has no effect: E-STMT-NO-EFFECT", () => {
    // `typewriter` is valid code (an identifier), so it is NOT E-UNQUOTED.
    // Ruling S445 item 2: an expression statement with no effect is an error
    // (was: checked downstream, E-SCOPE-001 when undeclared).
    const bsResult = splitBlocks("test.scrml", "<program>typewriter</program>");
    const { errors } = buildAST(bsResult);
    expect(errors.filter(e => e.code === "E-UNQUOTED-DISPLAY-TEXT")).toHaveLength(0);
    expect(errors.filter(e => e.code === "E-STMT-NO-EFFECT")).toHaveLength(1);
  });

  test("S441 — text inside a markup element in a <program> body stays free text", () => {
    const bsResult = splitBlocks("test.scrml", "<program><p>hello world</p></program>");
    const { ast, errors } = buildAST(bsResult);
    const programNode = ast.nodes.find(n => n.kind === "markup" && n.tag === "program");
    const p = (programNode?.children || []).find(n => n.kind === "markup" && n.tag === "p");
    expect(p.children[0].kind).toBe("text");
    expect(p.children[0].value).toBe("hello world");
    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §8: backward compatibility — explicit ${ } wrapping still works
// ---------------------------------------------------------------------------

describe("explicit logic block wrapping still works (no regression)", () => {
  // v0.3 Wave 2 — these tests assert the explicit `${ }` wrapping form
  // still PARSES the same shape under v0.3. The form now triggers the
  // W-PROGRAM-REDUNDANT-LOGIC lint (SPEC §40.8) but remains a legal compile;
  // filter the lint here so the regression assertions focus on parse-shape.
  test("explicit type in logic block still works", () => {
    const source = "<program>\n  \${ type Color:enum = { Red, Green, Blue } }\n</program>";
    const { errors } = compile(source);
    const relevant = errors.filter(e => e.code && e.code !== "W-PROGRAM-001" && e.code !== "W-PROGRAM-REDUNDANT-LOGIC");
    expect(relevant).toHaveLength(0);
  });

  test("explicit fn in logic block still works", () => {
    const source = "<program>\n  \${ fn greet(name) { return \"Hello \" + name } }\n</program>";
    const { errors } = compile(source);
    const relevant = errors.filter(e => e.code && e.code !== "W-PROGRAM-001" && e.code !== "E-PARSE-002" && e.code !== "W-PROGRAM-REDUNDANT-LOGIC");
    expect(relevant).toHaveLength(0);
  });

  test("explicit function in logic block still works", () => {
    const source = "<program>\n  \${ function add(a, b) { return a + b } }\n</program>";
    const { errors } = compile(source);
    const relevant = errors.filter(e => e.code && e.code !== "W-PROGRAM-001" && e.code !== "W-PROGRAM-REDUNDANT-LOGIC");
    expect(relevant).toHaveLength(0);
  });

  test("explicit fn in logic block still produces function-decl with fnKind=fn", () => {
    const source = "<program>\n  \${ fn greet(name) { return name } }\n</program>";
    const { ast } = compile(source);
    const funcDecls = collectNodes(ast.nodes, "function-decl");
    const greetDecl = funcDecls.find(f => f.name === "greet");
    expect(greetDecl).toBeDefined();
    expect(greetDecl?.fnKind).toBe("fn");
  });
});
