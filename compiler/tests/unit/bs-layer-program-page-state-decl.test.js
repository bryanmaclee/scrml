/**
 * BS-LAYER PROGRAM/PAGE STATE-DECL: V5-strict state-decl auto-recognition
 * inside <program> body AND <page> body.
 *
 * SPEC §40.8 normative text:
 *   "Inside <program>, the body parses in default-logic mode under v0.3.
 *    Bare top-level declarations (<x> = 0, function f() { ... }) auto-lift
 *    to the logic context without explicit ${...} wrapping."
 *
 * Before this dispatch, the BS-layer (block-splitter.js) only auto-recognized
 * V5-strict state-decl shape (`<x>=0`, `<x>:Type=…`, derived `const <x>=…`,
 * Shape 2 `<userName req>=<input/>`) at file top OR inside <channel> body.
 * Inside <program> or <page> body, `<x>` was parsed as a markup opener and
 * the state-decl path was never entered.
 *
 * Wave 2 item (b) (commit 41a4706) extended TAB-layer liftBareDeclarations to
 * treat <program>/<page>/<channel> direct text children as state-context, which
 * handles the NON-markup-shaped decls (`function`, `fn`, `type`, `let`, `const`).
 * But the V5-strict <x>=0 shape is markup-text — the BS-layer must produce it
 * as TEXT (not as a markup opener) before TAB can lift it. This file locks the
 * BS-layer extension that closes that gap.
 *
 * Coverage:
 *   §1: 4 V5-strict shapes × 2 contexts (<program> body, <page> body) = 8 positive cases
 *   §2: Markup-opener disambiguation (4 negative cases — <div>/<span>/<p>/<custom>)
 *   §3: Regression pair — file-top + <channel> body recognition unchanged
 *   §4: SPEC §40.8 worked-example dual-form check — bare AND wrapped both compile
 */

import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compile a scrml source string through BS -> TAB and return { ast, errors, blocks }.
 */
function compile(source) {
  const bsResult = splitBlocks("test.scrml", source);
  const tabResult = buildAST(bsResult);
  return {
    ast: tabResult.ast,
    errors: [...bsResult.errors, ...tabResult.errors],
    blocks: bsResult.blocks,
  };
}

/** Recursively collect all nodes matching `kind` from the AST tree. */
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

/** Find the first markup node with the given tag name (top-level only). */
function findTopMarkup(ast, tag) {
  return ast.nodes.find(n => n.kind === "markup" && n.tag === tag);
}

/**
 * Filter error list to only fatal (non-warning) errors that aren't
 * the v0.3 W-PROGRAM-REDUNDANT-LOGIC lint or the file-top W-PROGRAM-001 lint.
 */
function fatalErrors(errors) {
  return errors.filter(e =>
    e.code &&
    !e.code.startsWith("W-") &&
    e.code !== "W-PROGRAM-001"
  );
}

// ---------------------------------------------------------------------------
// §1: Positive — V5-strict state-decl auto-lifts inside <program> + <page> body
// ---------------------------------------------------------------------------

describe("§1: V5-strict <x>=0 auto-lifts inside <program> body", () => {
  test("bare <count>=0 inside <program> compiles without fatal errors", () => {
    const source = "<program>\n  <count> = 0\n</program>";
    const { errors } = compile(source);
    expect(fatalErrors(errors)).toHaveLength(0);
  });

  test("bare <count>=0 produces a state-decl node, NOT a markup opener", () => {
    const source = "<program>\n  <count> = 0\n</program>";
    const { ast } = compile(source);
    const stateDecls = collectNodes(ast.nodes, "state-decl");
    const countDecl = stateDecls.find(d => d.name === "count");
    expect(countDecl).toBeDefined();
    // V5-strict shape carries structuralForm: true (channel auto-sync uses this marker)
    expect(countDecl?.structuralForm).toBe(true);
  });

  test("bare <count>=0 produces a synthetic logic node in program children", () => {
    const source = "<program>\n  <count> = 0\n</program>";
    const { ast } = compile(source);
    const programNode = findTopMarkup(ast, "program");
    expect(programNode).toBeDefined();
    const logicChildren = (programNode?.children || []).filter(n => n.kind === "logic");
    expect(logicChildren.length).toBeGreaterThanOrEqual(1);
  });

  test("bare <count>:number=0 (typed) inside <program> compiles + produces state-decl", () => {
    const source = "<program>\n  <count>: number = 0\n</program>";
    const { ast, errors } = compile(source);
    expect(fatalErrors(errors)).toHaveLength(0);
    const stateDecls = collectNodes(ast.nodes, "state-decl");
    const countDecl = stateDecls.find(d => d.name === "count");
    expect(countDecl).toBeDefined();
  });

  test("bare const <doubled>=@count*2 (derived) inside <program> compiles + produces derived-decl", () => {
    const source = "<program>\n  <count> = 0\n  const <doubled> = @count * 2\n</program>";
    const { ast, errors } = compile(source);
    expect(fatalErrors(errors)).toHaveLength(0);
    const stateDecls = collectNodes(ast.nodes, "state-decl");
    const doubledDecl = stateDecls.find(d => d.name === "doubled");
    expect(doubledDecl).toBeDefined();
  });

  test("Shape 2 <userName req>=<input/> (decl-coupled-with-render-spec) inside <program> compiles", () => {
    const source = '<program>\n  <userName req length(>=2)> = <input type="text"/>\n</program>';
    const { ast, errors } = compile(source);
    expect(fatalErrors(errors)).toHaveLength(0);
    const stateDecls = collectNodes(ast.nodes, "state-decl");
    const userNameDecl = stateDecls.find(d => d.name === "userName");
    expect(userNameDecl).toBeDefined();
  });
});

describe("§1: V5-strict <x>=0 auto-lifts inside <page> body", () => {
  test("bare <count>=0 inside <page> compiles without fatal errors", () => {
    const source = "<page>\n  <count> = 0\n</page>";
    const { errors } = compile(source);
    expect(fatalErrors(errors)).toHaveLength(0);
  });

  test("bare <count>=0 inside <page> produces a state-decl node", () => {
    const source = "<page>\n  <count> = 0\n</page>";
    const { ast } = compile(source);
    const stateDecls = collectNodes(ast.nodes, "state-decl");
    const countDecl = stateDecls.find(d => d.name === "count");
    expect(countDecl).toBeDefined();
    expect(countDecl?.structuralForm).toBe(true);
  });

  test("bare <count>:number=0 (typed) inside <page> compiles", () => {
    const source = "<page>\n  <count>: number = 0\n</page>";
    const { ast, errors } = compile(source);
    expect(fatalErrors(errors)).toHaveLength(0);
    const countDecl = collectNodes(ast.nodes, "state-decl").find(d => d.name === "count");
    expect(countDecl).toBeDefined();
  });

  test("bare const <doubled>=@count*2 (derived) inside <page> compiles", () => {
    const source = "<page>\n  <count> = 0\n  const <doubled> = @count * 2\n</page>";
    const { ast, errors } = compile(source);
    expect(fatalErrors(errors)).toHaveLength(0);
    const doubledDecl = collectNodes(ast.nodes, "state-decl").find(d => d.name === "doubled");
    expect(doubledDecl).toBeDefined();
  });

  test("Shape 2 <userName req>=<input/> inside <page> compiles", () => {
    const source = '<page>\n  <userName req length(>=2)> = <input type="text"/>\n</page>';
    const { ast, errors } = compile(source);
    expect(fatalErrors(errors)).toHaveLength(0);
    const userNameDecl = collectNodes(ast.nodes, "state-decl").find(d => d.name === "userName");
    expect(userNameDecl).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// §2: Negative — markup tags inside <program>/<page> still parse as markup
// ---------------------------------------------------------------------------

describe("§2: markup-opener disambiguation inside <program> body", () => {
  test("<div>...</div> inside <program> body parses as markup, NOT state-decl", () => {
    const source = "<program>\n  <div>hello</div>\n</program>";
    const { ast, errors } = compile(source);
    expect(fatalErrors(errors)).toHaveLength(0);
    const programNode = findTopMarkup(ast, "program");
    const divChildren = (programNode?.children || []).filter(n => n.kind === "markup" && n.tag === "div");
    expect(divChildren).toHaveLength(1);
    // Critical: NO state-decl should be produced from <div>
    const stateDecls = collectNodes(ast.nodes, "state-decl");
    expect(stateDecls.find(d => d.name === "div")).toBeUndefined();
  });

  test("<span>...</span> inside <program> body parses as markup", () => {
    const source = "<program>\n  <span>hi</span>\n</program>";
    const { ast, errors } = compile(source);
    expect(fatalErrors(errors)).toHaveLength(0);
    const programNode = findTopMarkup(ast, "program");
    const spanChildren = (programNode?.children || []).filter(n => n.kind === "markup" && n.tag === "span");
    expect(spanChildren).toHaveLength(1);
  });
});

describe("§2: markup-opener disambiguation inside <page> body", () => {
  test("<div>...</div> inside <page> body parses as markup, NOT state-decl", () => {
    const source = "<page>\n  <div>hello</div>\n</page>";
    const { ast, errors } = compile(source);
    expect(fatalErrors(errors)).toHaveLength(0);
    const pageNode = findTopMarkup(ast, "page");
    const divChildren = (pageNode?.children || []).filter(n => n.kind === "markup" && n.tag === "div");
    expect(divChildren).toHaveLength(1);
    const stateDecls = collectNodes(ast.nodes, "state-decl");
    expect(stateDecls.find(d => d.name === "div")).toBeUndefined();
  });

  test("<p>some text</p> inside <page> body parses as markup", () => {
    const source = "<page>\n  <p>some text</p>\n</page>";
    const { ast, errors } = compile(source);
    expect(fatalErrors(errors)).toHaveLength(0);
    const pageNode = findTopMarkup(ast, "page");
    const pChildren = (pageNode?.children || []).filter(n => n.kind === "markup" && n.tag === "p");
    expect(pChildren).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// §3: Regression — file-top + <channel> body recognition unchanged
// ---------------------------------------------------------------------------

describe("§3: regression — file-top V5-strict state-decl still works", () => {
  test("file-top <count>=0 (no <program> wrapper) auto-lifts as state-decl", () => {
    const source = "<count> = 0\n";
    const { ast, errors } = compile(source);
    expect(fatalErrors(errors)).toHaveLength(0);
    const stateDecls = collectNodes(ast.nodes, "state-decl");
    const countDecl = stateDecls.find(d => d.name === "count");
    expect(countDecl).toBeDefined();
    expect(countDecl?.structuralForm).toBe(true);
  });
});

describe("§3: regression — <channel> body V5-strict state-decl still works", () => {
  test("bare <messages>=[] inside <channel> auto-lifts as state-decl", () => {
    const source = '<program>\n  <channel name="chat">\n    <messages> = []\n  </channel>\n</program>';
    const { ast, errors } = compile(source);
    expect(fatalErrors(errors)).toHaveLength(0);
    const stateDecls = collectNodes(ast.nodes, "state-decl");
    const messagesDecl = stateDecls.find(d => d.name === "messages");
    expect(messagesDecl).toBeDefined();
    expect(messagesDecl?.structuralForm).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §4: SPEC §40.8 worked-example dual-form (bare AND wrapped both compile)
// ---------------------------------------------------------------------------

describe("§4: SPEC §40.8 worked example — both bare and wrapped forms compile", () => {
  test("worked example bare form: <program> with bare <count>=0 compiles", () => {
    // The new BS-layer-recognized form (no ${...} wrapper).
    const source = '<program title="Counter">\n  <count> = 0\n  <button onclick=${@count = @count + 1}>+</button>\n  <span>${@count}</span>\n</program>';
    const { errors } = compile(source);
    expect(fatalErrors(errors)).toHaveLength(0);
  });

  test("worked example wrapped form: <program> with ${ <count>=0 } compiles + fires W-PROGRAM-REDUNDANT-LOGIC", () => {
    // The legacy wrapped form per SPEC §40.8 worked example — still legal, fires lint.
    const source = '<program title="Counter">\n  ${ <count> = 0 }\n  <button onclick=${@count = @count + 1}>+</button>\n  <span>${@count}</span>\n</program>';
    const { errors } = compile(source);
    expect(fatalErrors(errors)).toHaveLength(0);
    // Wave 2 item (b) introduced W-PROGRAM-REDUNDANT-LOGIC for this exact shape.
    const lint = errors.find(e => e.code === "W-PROGRAM-REDUNDANT-LOGIC");
    expect(lint).toBeDefined();
  });
});
