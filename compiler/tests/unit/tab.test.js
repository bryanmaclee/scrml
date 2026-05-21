/**
 * TAB Stage — Unit Tests
 *
 * Tests for the Tokenizer (src/tokenizer.js) and AST Builder (src/ast-builder.js).
 * These tests operate at the TAB stage level: they drive the block splitter to
 * produce blocks, then pass those blocks through the TAB stage and assert on
 * the resulting AST.
 *
 * Test coverage:
 *   - Per-block tokenization (markup, state, logic, sql, css, error-effect, meta, text, comment)
 *   - Attribute parsing (three-form: string-literal, variable-ref, call-ref, absent)
 *   - LogicNode production (lift, fn, function, @reactive, let, const, import, export, type)
 *   - SQL block structure (query + chained calls)
 *   - CSS block structure (rules)
 *   - Error-effect block structure (match arms)
 *   - Meta block parentContext recording
 *   - Span presence on every node (every node has a span with file, start, end, line, col)
 *   - Serialisability (JSON.stringify round-trips without error)
 */

import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST, runTAB } from "../../src/ast-builder.js";
import {
  tokenizeAttributes,
  tokenizeLogic,
  tokenizeSQL,
  tokenizeCSS,
} from "../../src/tokenizer.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parse(source) {
  const bsOut = splitBlocks("test.scrml", source);
  return buildAST(bsOut);
}

function parseAST(source) {
  return parse(source).ast;
}

function firstNode(source) {
  return parseAST(source).nodes[0];
}

/** Assert that a node (and all its descendants) carry a valid span. */
function assertSpans(node, path = "root") {
  if (!node || typeof node !== "object") return;

  // If it looks like an AST node (has a `kind`), it must have a span
  if ("kind" in node) {
    expect(node.span, path + ".span must exist").toBeDefined();
    expect(typeof node.span.start, path + ".span.start must be number").toBe("number");
    expect(typeof node.span.end, path + ".span.end must be number").toBe("number");
    expect(typeof node.span.line, path + ".span.line must be number").toBe("number");
    expect(typeof node.span.col, path + ".span.col must be number").toBe("number");
    expect(typeof node.span.file, path + ".span.file must be string").toBe("string");
    expect(node.span.start, path + ".span.start >= 0").toBeGreaterThanOrEqual(0);
    expect(node.span.end, path + ".span.end >= start").toBeGreaterThanOrEqual(node.span.start);
    expect(node.span.line, path + ".span.line >= 1").toBeGreaterThanOrEqual(1);
    expect(node.span.col, path + ".span.col >= 1").toBeGreaterThanOrEqual(1);
  }

  for (const [key, val] of Object.entries(node)) {
    if (key === "span" || key === "id") continue;
    if (Array.isArray(val)) {
      val.forEach((child, idx) => assertSpans(child, path + "." + key + "[" + idx + "]"));
    } else if (val && typeof val === "object") {
      assertSpans(val, path + "." + key);
    }
  }
}

// ---------------------------------------------------------------------------
// §A  Span invariants — every node must carry a full span
// ---------------------------------------------------------------------------

describe("span invariants", () => {
  test("text node has span", () => {
    const node = firstNode("hello world");
    expect(node.kind).toBe("text");
    assertSpans(node);
  });

  test("comment node has span", () => {
    const node = firstNode("// this is a comment\n");
    expect(node.kind).toBe("comment");
    assertSpans(node);
  });

  test("markup node has span", () => {
    const node = firstNode("<p>hello</>");
    assertSpans(node);
  });

  test("state node has span", () => {
    const node = firstNode('< db src="db.sql"></>');
    assertSpans(node);
  });

  test("logic node has span", () => {
    const node = firstNode("${ let x = 1; }");
    assertSpans(node);
  });

  test("guarded-expr node has span (was: error-effect node has span)", () => {
    const logic = firstNode("${ someCall() !{ | _ e -> null } }");
    const err = logic.body.find(n => n.kind === "guarded-expr");
    assertSpans(err);
  });
});

// ---------------------------------------------------------------------------
// §B  Text and comment nodes
// ---------------------------------------------------------------------------

describe("text and comment nodes", () => {
  test("text node has value", () => {
    const node = firstNode("hello world");
    expect(node.value).toBe("hello world");
  });

  test("comment node has value", () => {
    const node = firstNode("// this is a comment\n");
    expect(node.value).toBe("// this is a comment\n");
  });
});

// ---------------------------------------------------------------------------
// §C  Markup block → MarkupElement
// ---------------------------------------------------------------------------

describe("markup blocks", () => {
  test("simple markup → kind: 'markup'", () => {
    const node = firstNode("<p>hello</>");
    expect(node.kind).toBe("markup");
  });

  test("tag name is preserved", () => {
    const node = firstNode("<button>click</>");
    expect(node.tag).toBe("button");
  });

  test("children are parsed recursively", () => {
    const node = firstNode("<div><p>inner</p></div>");
    expect(node.kind).toBe("markup");
    const child = node.children.find(c => c.kind === "markup");
    expect(child).toBeDefined();
    expect(child.tag).toBe("p");
  });

  test("text children become TextNode", () => {
    const node = firstNode("<p>hello</>");
    const text = node.children.find(c => c.kind === "text");
    expect(text).toBeDefined();
    expect(text.value).toBe("hello");
  });

  test("self-closing markup → selfClosing: true", () => {
    const node = firstNode("<br/>");
    expect(node.kind).toBe("markup");
    expect(node.selfClosing).toBe(true);
  });

  test("self-closing markup has no children", () => {
    const node = firstNode("<br/>");
    expect(node.children).toHaveLength(0);
  });

  test("closerForm is 'inferred' for slash-closed tags", () => {
    const inferred = firstNode("<p>hi</>");
    expect(inferred.closerForm).toBe("inferred");
  });

  test("closerForm is 'explicit' for explicitly closed tags", () => {
    const explicit = firstNode("<p>hi</p>");
    expect(explicit.closerForm).toBe("explicit");
  });

  test("logic child block appears as child LogicBlock node", () => {
    const node = firstNode("<p>${ 1 + 1 }</p>");
    const logic = node.children.find(c => c.kind === "logic");
    expect(logic).toBeDefined();
  });

  test("span covers the full raw block including tag delimiters", () => {
    const src = "<p>hello</>";
    const node = firstNode(src);
    expect(node.span.start).toBe(0);
    expect(node.span.end).toBe(src.length);
  });

  test("deeply nested markup all have spans", () => {
    const node = firstNode("<ul><li><span>text</span></li></ul>");
    assertSpans(node);
  });

  test("multiple top-level markup nodes", () => {
    const ast = parseAST("<p>a</><p>b</>");
    const markups = ast.nodes.filter(n => n.kind === "markup");
    expect(markups).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// §D  Attribute parsing — §5 three-form distinction
// ---------------------------------------------------------------------------

describe("attribute parsing", () => {
  // String-literal form: attr="value"
  test('attr="value" → kind: string-literal', () => {
    const node = firstNode('<div class="container">content</>');
    const attr = node.attrs.find(a => a.name === "class");
    expect(attr).toBeDefined();
    expect(attr.value.kind).toBe("string-literal");
    expect(attr.value.value).toBe("container");
  });

  test("quoted attribute value preserves the string content", () => {
    const node = firstNode('<a href="/home/page">link</>');
    const attr = node.attrs.find(a => a.name === "href");
    expect(attr.value.kind).toBe("string-literal");
    expect(attr.value.value).toBe("/home/page");
  });

  // Variable-ref form: attr=name
  test("attr=name → kind: variable-ref", () => {
    const node = firstNode("<input disabled=submitting/>");
    const attr = node.attrs.find(a => a.name === "disabled");
    expect(attr).toBeDefined();
    expect(attr.value.kind).toBe("variable-ref");
    expect(attr.value.name).toBe("submitting");
  });

  test("unquoted identifier attribute preserves name", () => {
    const node = firstNode("<div class=dynamicClass>content</>");
    const attr = node.attrs.find(a => a.name === "class");
    expect(attr.value.kind).toBe("variable-ref");
    expect(attr.value.name).toBe("dynamicClass");
  });

  // Call-ref form: attr=fn()
  test("attr=fn() → kind: call-ref", () => {
    const node = firstNode("<button onclick=save()>Save</>");
    const attr = node.attrs.find(a => a.name === "onclick");
    expect(attr).toBeDefined();
    expect(attr.value.kind).toBe("call-ref");
    expect(attr.value.name).toBe("save");
    expect(Array.isArray(attr.value.args)).toBe(true);
  });

  test("call-ref captures function name", () => {
    const node = firstNode("<form onsubmit=handleSubmit()>content</>");
    const attr = node.attrs.find(a => a.name === "onsubmit");
    expect(attr.value.kind).toBe("call-ref");
    expect(attr.value.name).toBe("handleSubmit");
  });

  test("call-ref with args captures args array", () => {
    const node = firstNode("<button onclick=load(userId)>Click</>");
    const attr = node.attrs.find(a => a.name === "onclick");
    expect(attr.value.kind).toBe("call-ref");
    expect(attr.value.args).toContain("userId");
  });

  // Boolean / absent form
  test("boolean attribute (no value) → kind: absent", () => {
    const node = firstNode("<input required/>");
    const attr = node.attrs.find(a => a.name === "required");
    expect(attr).toBeDefined();
    expect(attr.value.kind).toBe("absent");
  });

  test("multiple attributes are all parsed", () => {
    const node = firstNode('<input type="text" name="email" required/>');
    expect(node.attrs.length).toBeGreaterThanOrEqual(3);
    const type = node.attrs.find(a => a.name === "type");
    const name = node.attrs.find(a => a.name === "name");
    expect(type).toBeDefined();
    expect(name).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// §E  State blocks → StateBlock
// ---------------------------------------------------------------------------

describe("state blocks", () => {
  test("state block → kind: 'state'", () => {
    const node = firstNode('< db src="db.sql"></>');
    expect(node.kind).toBe("state");
  });

  test("state type is recorded", () => {
    const node = firstNode('< db src="db.sql"></>');
    expect(node.stateType).toBe("db");
  });

  test("state attributes are parsed", () => {
    const node = firstNode('< db src="db.sql" tables="users"></>');
    expect(node.attrs.length).toBeGreaterThan(0);
    const src = node.attrs.find(a => a.name === "src");
    expect(src).toBeDefined();
    expect(src.value.kind).toBe("string-literal");
  });

  test("state node has children array", () => {
    const node = firstNode('< db></>');
    expect(Array.isArray(node.children)).toBe(true);
  });

  test("state children can include markup", () => {
    const node = firstNode('< db><p>content</p></db>');
    const markup = node.children.find(c => c.kind === "markup");
    expect(markup).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// §F  Logic blocks → LogicBlock
// ---------------------------------------------------------------------------

describe("logic blocks", () => {
  test("logic block → kind: 'logic'", () => {
    const node = firstNode("${ let x = 1; }");
    expect(node.kind).toBe("logic");
  });

  test("logic block body is an array", () => {
    const node = firstNode("${ let x = 1; }");
    expect(Array.isArray(node.body)).toBe(true);
  });

  test("let produces let-decl node", () => {
    const node = firstNode("${ let x = 1; }");
    const decl = node.body.find(n => n.kind === "let-decl");
    expect(decl).toBeDefined();
  });

  test("const produces const-decl node", () => {
    const node = firstNode("${ const y = 2; }");
    const decl = node.body.find(n => n.kind === "const-decl");
    expect(decl).toBeDefined();
  });

  test("reactive @name produces state-decl node", () => {
    const node = firstNode("${ @counter = 0 }");
    const decl = node.body.find(n => n.kind === "state-decl");
    expect(decl).toBeDefined();
  });

  test("function produces function-decl node", () => {
    const node = firstNode("${ function greet(name) { } }");
    const decl = node.body.find(n => n.kind === "function-decl");
    expect(decl).toBeDefined();
    expect(decl.fnKind).toBe("function");
  });

  test("fn shorthand produces function-decl node with fnKind: fn", () => {
    const node = firstNode("${ fn greet { } }");
    const decl = node.body.find(n => n.kind === "function-decl");
    expect(decl).toBeDefined();
    expect(decl.fnKind).toBe("fn");
  });

  test("fail keyword produces fail-expr node", () => {
    const node = firstNode('${ fail PaymentError::InvalidAmount("bad") }');
    const decl = node.body.find(n => n.kind === "fail-expr");
    expect(decl).toBeDefined();
    expect(decl.enumType).toBe("PaymentError");
    expect(decl.variant).toBe("InvalidAmount");
    expect(decl.args).toContain("bad");
  });

  test("fail with unit variant (no args)", () => {
    const node = firstNode("${ fail PaymentError::NotFound }");
    const decl = node.body.find(n => n.kind === "fail-expr");
    expect(decl).toBeDefined();
    expect(decl.enumType).toBe("PaymentError");
    expect(decl.variant).toBe("NotFound");
    expect(decl.args).toBe("");
  });

  test("function with ! produces canFail=true", () => {
    const node = firstNode("${ function process()! { } }");
    const decl = node.body.find(n => n.kind === "function-decl");
    expect(decl).toBeDefined();
    expect(decl.canFail).toBe(true);
  });

  test("function with ! and error type", () => {
    const node = firstNode("${ function process()! -> PaymentError { } }");
    const decl = node.body.find(n => n.kind === "function-decl");
    expect(decl).toBeDefined();
    expect(decl.canFail).toBe(true);
    expect(decl.errorType).toBe("PaymentError");
  });

  test("function without ! has canFail=false", () => {
    const node = firstNode("${ function process() { } }");
    const decl = node.body.find(n => n.kind === "function-decl");
    expect(decl).toBeDefined();
    expect(decl.canFail).toBe(false);
  });

  test("fn shorthand with ! produces canFail=true", () => {
    const node = firstNode("${ fn process()! { } }");
    const decl = node.body.find(n => n.kind === "function-decl");
    expect(decl).toBeDefined();
    expect(decl.canFail).toBe(true);
    expect(decl.fnKind).toBe("fn");
  });

  test("let with ? produces propagate-expr node", () => {
    const node = firstNode("${ let x = foo()? }");
    const decl = node.body.find(n => n.kind === "propagate-expr");
    expect(decl).toBeDefined();
    expect(decl.binding).toBe("x");
    expect(decl.expr).toContain("foo");
  });

  test("bare expression with ? produces propagate-expr node", () => {
    const node = firstNode("${ doSomething()? }");
    const decl = node.body.find(n => n.kind === "propagate-expr");
    expect(decl).toBeDefined();
    expect(decl.binding).toBeNull();
    expect(decl.expr).toContain("doSomething");
  });

  test("transaction block produces transaction-block node", () => {
    const node = firstNode("${ transaction { let x = 1; } }");
    const decl = node.body.find(n => n.kind === "transaction-block");
    expect(decl).toBeDefined();
    expect(Array.isArray(decl.body)).toBe(true);
    expect(decl.body.length).toBeGreaterThan(0);
  });

  test("import statement produces import-decl node", () => {
    const node = firstNode("${ import x from 'mod'; }");
    const decl = node.body.find(n => n.kind === "import-decl");
    expect(decl).toBeDefined();
  });

  test("export statement produces export-decl node", () => {
    const node = firstNode("${ export const x = 1; }");
    const decl = node.body.find(n => n.kind === "export-decl");
    expect(decl).toBeDefined();
  });

  test("type declaration produces type-decl node", () => {
    const node = firstNode("${ type Point = { x: number; y: number }; }");
    const decl = node.body.find(n => n.kind === "type-decl");
    expect(decl).toBeDefined();
  });

  test("logic block has imports array", () => {
    const node = firstNode("${ import x from 'mod'; }");
    expect(Array.isArray(node.imports)).toBe(true);
  });

  test("logic block has exports array", () => {
    const node = firstNode("${ export const x = 1; }");
    expect(Array.isArray(node.exports)).toBe(true);
  });

  test("logic block has typeDecls array", () => {
    const node = firstNode("${ type Point = { x: number }; }");
    expect(Array.isArray(node.typeDecls)).toBe(true);
  });

  test("logic block has components array", () => {
    const node = firstNode("${ component Box {} }");
    expect(Array.isArray(node.components)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §G  SQL blocks → SQLBlock
// ---------------------------------------------------------------------------

describe("sql blocks", () => {
  test("sql block → kind: 'sql'", () => {
    const node = firstNode("${ ?{ `SELECT 1` } }");
    expect(node.kind).toBe("logic");
    const sql = node.body.find(n => n.kind === "sql");
    expect(sql).toBeDefined();
  });

  test("sql block has query string", () => {
    const logic = firstNode("${ ?{ `SELECT id FROM users` } }");
    const sql = logic.body.find(n => n.kind === "sql");
    expect(sql).toBeDefined();
    expect(sql.query).toBeDefined();
    expect(typeof sql.query).toBe("string");
  });

  test("sql block has chainedCalls array", () => {
    const logic = firstNode("${ ?{ `SELECT 1` } }");
    const sql = logic.body.find(n => n.kind === "sql");
    expect(sql).toBeDefined();
    expect(Array.isArray(sql.chainedCalls)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §H  CSS inline blocks
// ---------------------------------------------------------------------------

describe("css inline blocks", () => {
  test("css inline block → kind: 'css-inline'", () => {
    const logic = firstNode("${ #{ color: red; } }");
    expect(logic.kind).toBe("logic");
    const css = logic.body.find(n => n.kind === "css-inline");
    expect(css).toBeDefined();
  });

  test("css inline block has rules array", () => {
    const logic = firstNode("${ #{ color: red; } }");
    const css = logic.body.find(n => n.kind === "css-inline");
    expect(css).toBeDefined();
    expect(Array.isArray(css.rules)).toBe(true);
  });

  test("css rule is captured", () => {
    const logic = firstNode("${ #{ color: red; } }");
    const css = logic.body.find(n => n.kind === "css-inline");
    expect(css).toBeDefined();
    expect(css.rules.length).toBeGreaterThan(0);
    const rule = css.rules[0];
    expect(rule.prop).toBe("color");
    expect(rule.value).toBe("red");
  });

  test("multiple css rules are captured", () => {
    const logic = firstNode("${ #{ color: red; font-size: 14px; } }");
    const css = logic.body.find(n => n.kind === "css-inline");
    expect(css).toBeDefined();
    expect(css.rules.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// §I  Error-effect blocks → ErrorEffectBlock
// ---------------------------------------------------------------------------

describe("error-effect blocks (§19 — now guarded-expr)", () => {
  test("!{} postfix produces guarded-expr node", () => {
    const logic = firstNode("${ someCall() !{ | _ e -> null } }");
    const err = logic.body.find(n => n.kind === "guarded-expr");
    expect(err).toBeDefined();
  });

  test("guarded-expr arms array is present", () => {
    const logic = firstNode("${ someCall() !{ | _ e -> null } }");
    const err = logic.body.find(n => n.kind === "guarded-expr");
    expect(err).toBeDefined();
    expect(Array.isArray(err.arms)).toBe(true);
  });

  test("guarded-expr node has span", () => {
    const logic = firstNode("${ someCall() !{ | _ e -> null } }");
    const err = logic.body.find(n => n.kind === "guarded-expr");
    expect(err).toBeDefined();
    assertSpans(err);
  });
});

// ---------------------------------------------------------------------------
// §J  Meta blocks → MetaBlock
// ---------------------------------------------------------------------------

describe("meta blocks", () => {
  test("meta block → kind: 'meta'", () => {
    const node = firstNode("^{ let x = 1; }");
    expect(node.kind).toBe("meta");
  });

  test("meta block has a body array", () => {
    const node = firstNode("^{ let x = 1; }");
    expect(Array.isArray(node.body)).toBe(true);
  });

  test("meta block at top level has parentContext set", () => {
    const node = firstNode("^{ let x = 1; }");
    expect(node.parentContext).toBeDefined();
    // Top-level → defaults to 'markup' per PIPELINE.md
    expect(node.parentContext).toBe("markup");
  });

  test("meta block inside markup has parentContext: 'markup'", () => {
    const markup = firstNode("<p>^{ let x = 1; }</>");
    const meta = markup.children.find(c => c.kind === "meta");
    expect(meta).toBeDefined();
    expect(meta.parentContext).toBe("markup");
  });

  test("meta block inside logic has parentContext: 'logic'", () => {
    const logic = firstNode("${ ^{ let x = 1; } }");
    const meta = logic.body.find(n => n.kind === "meta");
    expect(meta).toBeDefined();
    expect(meta.parentContext).toBe("logic");
  });

  test("meta block inside state has parentContext: 'state'", () => {
    const state = firstNode("< db>^{ let x = 1; }</>");
    const meta = state.children.find(c => c.kind === "meta");
    expect(meta).toBeDefined();
    expect(meta.parentContext).toBe("state");
  });

  test("meta block body nodes carry spans", () => {
    const node = firstNode("^{ let x = 1; }");
    assertSpans(node);
  });

  test("nested meta block parentContext: 'meta'", () => {
    const outer = firstNode("^{ ^{ let y = 2; } }");
    expect(outer.kind).toBe("meta");
    const inner = outer.body.find(n => n.kind === "meta");
    expect(inner).toBeDefined();
    expect(inner.parentContext).toBe("meta");
  });

  test("meta block body can contain logic-like nodes", () => {
    const node = firstNode("^{ let x = 1; function f(a) { } }");
    const letDecl = node.body.find(n => n.kind === "let-decl");
    expect(letDecl).toBeDefined();
    const fnDecl = node.body.find(n => n.kind === "function-decl");
    expect(fnDecl).toBeDefined();
  });

  // BUG-R14-gauntlet-003: PascalCase const in meta block misclassified as component-def
  test("const with PascalCase name in meta block produces const-decl, not component-def", () => {
    const node = firstNode('^{ const ENV = "production"; }');
    const constNode = node.body.find(n => n.name === "ENV");
    expect(constNode).toBeDefined();
    expect(constNode.kind).toBe("const-decl");
  });

  test("const with ALL_CAPS name in meta block produces const-decl", () => {
    const node = firstNode("^{ const ALL_CAPS = 42; }");
    const constNode = node.body.find(n => n.name === "ALL_CAPS");
    expect(constNode).toBeDefined();
    expect(constNode.kind).toBe("const-decl");
  });

  test("const with PascalCase name + non-markup RHS produces const-decl", () => {
    // Regression: the ast-builder used to classify ANY uppercase-initial const
    // as component-def regardless of RHS. That vacuumed subsequent siblings
    // into phantom defChildren and broke module-scope lookup in later function
    // bodies (E-SCOPE-001 cascade). Component-def requires markup RHS.
    const node = firstNode("${ const MyComponent = 42; }");
    const decl = node.body.find(n => n.name === "MyComponent");
    expect(decl).toBeDefined();
    expect(decl.kind).toBe("const-decl");
  });

  test("const with UPPER_SNAKE_CASE name + non-markup RHS produces const-decl", () => {
    const node = firstNode("${ const ASCII_WS = new Set([\"x\"]); }");
    const decl = node.body.find(n => n.name === "ASCII_WS");
    expect(decl).toBeDefined();
    expect(decl.kind).toBe("const-decl");
  });

  test("const with PascalCase + markup RHS still produces component-def", () => {
    const node = firstNode("${ const Card = <div>hi</div>; }");
    const decl = node.body.find(n => n.name === "Card");
    expect(decl).toBeDefined();
    expect(decl.kind).toBe("component-def");
  });

  test("uppercase non-markup const does not vacuum subsequent sibling decls", () => {
    // The defChildren attach pass collects following siblings into the first
    // component-def it encounters. If `const ASCII_WS = ...` were mis-classified
    // as component-def, `helper` would be absorbed as a defChild and no longer
    // appear at the top-level body.
    const src = "${ const ASCII_WS = new Set([\"x\"]); function helper() { return 1 } }";
    const node = firstNode(src);
    const helper = node.body.find(n => n.kind === "function-decl" && n.name === "helper");
    expect(helper).toBeDefined();
    // ASCII_WS is a const-decl, not a component-def — no vacuuming.
    const ascii = node.body.find(n => n.name === "ASCII_WS");
    expect(ascii.kind).toBe("const-decl");
  });
});

// ---------------------------------------------------------------------------
// §K  FileAST structure
// ---------------------------------------------------------------------------

describe("FileAST structure", () => {
  test("buildAST returns { filePath, ast, errors }", () => {
    const bsOut = splitBlocks("test.scrml", "<p>hi</>");
    const result = buildAST(bsOut);
    expect(result.filePath).toBeDefined();
    expect(result.ast).toBeDefined();
    expect(Array.isArray(result.errors)).toBe(true);
  });

  test("FileAST has nodes array", () => {
    const ast = parseAST("<p>hi</>");
    expect(Array.isArray(ast.nodes)).toBe(true);
  });

  test("FileAST has imports array", () => {
    const ast = parseAST("<p>hi</>");
    expect(Array.isArray(ast.imports)).toBe(true);
  });

  test("FileAST has exports array", () => {
    const ast = parseAST("<p>hi</>");
    expect(Array.isArray(ast.exports)).toBe(true);
  });

  test("FileAST has components array", () => {
    const ast = parseAST("<p>hi</>");
    expect(Array.isArray(ast.components)).toBe(true);
  });

  test("FileAST has typeDecls array", () => {
    const ast = parseAST("<p>hi</>");
    expect(Array.isArray(ast.typeDecls)).toBe(true);
  });

  test("runTAB is an alias for buildAST with same output shape", () => {
    const bsOut = splitBlocks("test.scrml", "<p>hi</>");
    const r1 = buildAST(bsOut);
    const bsOut2 = splitBlocks("test.scrml", "<p>hi</>");
    const r2 = runTAB(bsOut2);
    expect(r1.filePath).toBe(r2.filePath);
    expect(r1.ast.nodes[0].kind).toBe(r2.ast.nodes[0].kind);
  });

  test("empty source → FileAST with empty nodes", () => {
    const ast = parseAST("");
    expect(ast.nodes).toHaveLength(0);
  });

  test("filePath in ast matches input filePath", () => {
    const bsOut = splitBlocks("my-component.scrml", "<p>hi</>");
    const { ast } = buildAST(bsOut);
    expect(ast.filePath).toBe("my-component.scrml");
  });
});

// ---------------------------------------------------------------------------
// §L  Tokenizer unit tests (direct)
// ---------------------------------------------------------------------------

describe("tokenizer: tokenizeAttributes", () => {
  test("produces TAG_OPEN token with tag name", () => {
    const tokens = tokenizeAttributes("<div>", 0, 1, 1, "markup");
    const tagOpen = tokens.find(t => t.kind === "TAG_OPEN");
    expect(tagOpen).toBeDefined();
    expect(tagOpen.text).toBe("div");
  });

  test("produces TAG_CLOSE_GT for >", () => {
    const tokens = tokenizeAttributes("<p>", 0, 1, 1, "markup");
    const close = tokens.find(t => t.kind === "TAG_CLOSE_GT");
    expect(close).toBeDefined();
  });

  test("produces TAG_SELF_CLOSE for />", () => {
    const tokens = tokenizeAttributes("<br/>", 0, 1, 1, "markup");
    const sc = tokens.find(t => t.kind === "TAG_SELF_CLOSE");
    expect(sc).toBeDefined();
  });

  test("produces ATTR_NAME for quoted attribute", () => {
    const tokens = tokenizeAttributes('<div class="foo">', 0, 1, 1, "markup");
    const name = tokens.find(t => t.kind === "ATTR_NAME" && t.text === "class");
    expect(name).toBeDefined();
  });

  test("produces ATTR_STRING for quoted value", () => {
    const tokens = tokenizeAttributes('<div class="foo">', 0, 1, 1, "markup");
    const val = tokens.find(t => t.kind === "ATTR_STRING" && t.text === "foo");
    expect(val).toBeDefined();
  });

  test("produces ATTR_IDENT for unquoted identifier value", () => {
    const tokens = tokenizeAttributes("<div class=myClass>", 0, 1, 1, "markup");
    const val = tokens.find(t => t.kind === "ATTR_IDENT" && t.text === "myClass");
    expect(val).toBeDefined();
  });

  test("produces ATTR_CALL for unquoted call value", () => {
    const tokens = tokenizeAttributes("<button onclick=save()>", 0, 1, 1, "markup");
    const val = tokens.find(t => t.kind === "ATTR_CALL");
    expect(val).toBeDefined();
    const parsed = JSON.parse(val.text);
    expect(parsed.name).toBe("save");
  });

  test("all tokens carry span.start and span.end", () => {
    const tokens = tokenizeAttributes('<div class="foo">', 0, 1, 1, "markup");
    for (const tok of tokens) {
      if (tok.kind === "EOF") continue;
      expect(typeof tok.span.start).toBe("number");
      expect(typeof tok.span.end).toBe("number");
    }
  });

  test("state block skips whitespace before name", () => {
    const tokens = tokenizeAttributes("< db>", 0, 1, 1, "state");
    const tagOpen = tokens.find(t => t.kind === "TAG_OPEN");
    expect(tagOpen.text).toBe("db");
  });
});

describe("tokenizer: tokenizeLogic", () => {
  test("produces KEYWORD token for 'lift'", () => {
    const tokens = tokenizeLogic("lift row;", 0, 1, 1, []);
    const kw = tokens.find(t => t.kind === "KEYWORD" && t.text === "lift");
    expect(kw).toBeDefined();
  });

  test("produces KEYWORD token for 'function'", () => {
    const tokens = tokenizeLogic("function foo() {}", 0, 1, 1, []);
    const kw = tokens.find(t => t.kind === "KEYWORD" && t.text === "function");
    expect(kw).toBeDefined();
  });

  test("produces KEYWORD token for 'fn'", () => {
    const tokens = tokenizeLogic("fn foo {}", 0, 1, 1, []);
    const kw = tokens.find(t => t.kind === "KEYWORD" && t.text === "fn");
    expect(kw).toBeDefined();
  });

  test("produces IDENT token for identifiers", () => {
    const tokens = tokenizeLogic("let myVar;", 0, 1, 1, []);
    const ident = tokens.find(t => t.kind === "IDENT" && t.text === "myVar");
    expect(ident).toBeDefined();
  });

  test("produces NUMBER token for numbers", () => {
    const tokens = tokenizeLogic("let x = 42;", 0, 1, 1, []);
    const num = tokens.find(t => t.kind === "NUMBER");
    expect(num).toBeDefined();
  });

  test("produces STRING token for strings", () => {
    const tokens = tokenizeLogic('let s = "hello";', 0, 1, 1, []);
    const str = tokens.find(t => t.kind === "STRING");
    expect(str.text).toBe("hello");
  });

  test("produces COMMENT for // comment", () => {
    const tokens = tokenizeLogic("// a comment\nlet x = 1;", 0, 1, 1, []);
    const comment = tokens.find(t => t.kind === "COMMENT");
    expect(comment).toBeDefined();
  });

  test("produces OPERATOR for =>", () => {
    const tokens = tokenizeLogic("x => x + 1", 0, 1, 1, []);
    const op = tokens.find(t => t.kind === "OPERATOR" && t.text === "=>");
    expect(op).toBeDefined();
  });

  test("produces OPERATOR for ::", () => {
    const tokens = tokenizeLogic("Direction::North", 0, 1, 1, []);
    const op = tokens.find(t => t.kind === "OPERATOR" && t.text === "::");
    expect(op).toBeDefined();
  });

  test("all tokens carry span with start/end/line/col", () => {
    const tokens = tokenizeLogic("let x = 1;", 0, 1, 1, []);
    for (const tok of tokens) {
      if (tok.kind === "EOF") continue;
      expect(typeof tok.span.start).toBe("number");
      expect(typeof tok.span.end).toBe("number");
      expect(typeof tok.span.line).toBe("number");
      expect(typeof tok.span.col).toBe("number");
    }
  });

  test("EOF token is always last", () => {
    const tokens = tokenizeLogic("let x = 1;", 0, 1, 1, []);
    expect(tokens[tokens.length - 1].kind).toBe("EOF");
  });
});

describe("tokenizer: tokenizeSQL", () => {
  test("produces SQL_RAW token with query content", () => {
    const tokens = tokenizeSQL("`SELECT id FROM users`", 0, 1, 1);
    const raw = tokens.find(t => t.kind === "SQL_RAW");
    expect(raw).toBeDefined();
    expect(raw.text).toContain("SELECT id FROM users");
  });

  test("EOF is last token", () => {
    const tokens = tokenizeSQL("`SELECT 1`", 0, 1, 1);
    expect(tokens[tokens.length - 1].kind).toBe("EOF");
  });
});

describe("tokenizer: tokenizeCSS", () => {
  test("produces CSS_PROP for property name", () => {
    const tokens = tokenizeCSS("color: red;", 0, 1, 1);
    const prop = tokens.find(t => t.kind === "CSS_PROP");
    expect(prop).toBeDefined();
    expect(prop.text).toBe("color");
  });

  test("produces CSS_VALUE for property value", () => {
    const tokens = tokenizeCSS("color: red;", 0, 1, 1);
    const val = tokens.find(t => t.kind === "CSS_VALUE");
    expect(val).toBeDefined();
    expect(val.text).toBe("red");
  });

  test("produces CSS_COLON", () => {
    const tokens = tokenizeCSS("color: red;", 0, 1, 1);
    const colon = tokens.find(t => t.kind === "CSS_COLON");
    expect(colon).toBeDefined();
  });

  test("produces CSS_SEMI", () => {
    const tokens = tokenizeCSS("color: red;", 0, 1, 1);
    const semi = tokens.find(t => t.kind === "CSS_SEMI");
    expect(semi).toBeDefined();
  });

  test("multiple properties produce multiple CSS_PROP tokens", () => {
    const tokens = tokenizeCSS("color: red; font-size: 14px;", 0, 1, 1);
    const props = tokens.filter(t => t.kind === "CSS_PROP");
    expect(props.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// §M  Integration: canonical SPEC examples
// ---------------------------------------------------------------------------

describe("integration: canonical spec examples", () => {
  test("§4.4.1 trailing-slash closer: <button onclick=save()>Save</>", () => {
    const node = firstNode("<button onclick=save()>Save</>");
    expect(node.kind).toBe("markup");
    expect(node.tag).toBe("button");
    const onclick = node.attrs.find(a => a.name === "onclick");
    expect(onclick.value.kind).toBe("call-ref");
    expect(onclick.value.name).toBe("save");
  });

  test("§5.3 boolean attr: <button disabled=submitting>", () => {
    const node = firstNode("<button disabled=submitting>Submit</>");
    const attr = node.attrs.find(a => a.name === "disabled");
    expect(attr.value.kind).toBe("variable-ref");
    expect(attr.value.name).toBe("submitting");
  });

  test("§6.1 reactive decl: @counter = 0", () => {
    const node = firstNode("${ @counter = 0 }");
    const decl = node.body.find(n => n.kind === "state-decl");
    expect(decl).toBeDefined();
    expect(decl.name).toBe("counter");
  });

  test("§7.3 fn shorthand normalises to function-decl kind:fn", () => {
    const node = firstNode("${ fn greet { } }");
    const decl = node.body.find(n => n.kind === "function-decl");
    expect(decl.fnKind).toBe("fn");
  });

  test("§11.1 < db> state block with protect= attr parsed", () => {
    const node = firstNode('< db src="db.sql" protect="password" tables="users"></>');
    expect(node.kind).toBe("state");
    expect(node.stateType).toBe("db");
    const protect = node.attrs.find(a => a.name === "protect");
    expect(protect).toBeDefined();
    expect(protect.value.kind).toBe("string-literal");
    expect(protect.value.value).toBe("password");
  });

  test("§22 meta block at top level", () => {
    const node = firstNode("^{ let x = 1; }");
    expect(node.kind).toBe("meta");
    expect(node.parentContext).toBe("markup");
  });

  test("§22 nested meta: ^{ ^{ } }", () => {
    const outer = firstNode("^{ ^{ let y = 2; } }");
    expect(outer.kind).toBe("meta");
    const inner = outer.body.find(n => n.kind === "meta");
    expect(inner).toBeDefined();
    expect(inner.parentContext).toBe("meta");
  });

  test("full program: state+logic produces valid AST tree", () => {
    // Source string built with concatenation to avoid JS template-literal interpolation of ${
    const src =
      '< db src="db.sql" tables="users">\n' +
      '    <ul>${ for (row of items) {\n' +
      '    } }\n' +
      '    </ul>\n' +
      '</>';
    const ast = parseAST(src);
    expect(ast.nodes.length).toBeGreaterThan(0);
    for (const node of ast.nodes) {
      assertSpans(node);
    }
  });
});

// ---------------------------------------------------------------------------
// §N  REGRESSION TESTS: TAB Review Defect Fixes
// ---------------------------------------------------------------------------

describe("regression: TAB review defect fixes", () => {
  // Defect 4: Exact-count hoisting — ensure imports/exports aren't double-hoisted
  describe("Defect 4: Exact-count hoisting", () => {
    test("single import hoisted exactly once to FileAST", () => {
      const src = "${ import x from 'mod'; }";
      const result = parse(src);
      expect(result.ast.imports.length).toBe(1);
      expect(result.ast.imports[0].kind).toBe("import-decl");
    });

    test("single export hoisted exactly once to FileAST", () => {
      const src = "${ export const x = 1; }";
      const result = parse(src);
      expect(result.ast.exports.length).toBe(1);
      expect(result.ast.exports[0].kind).toBe("export-decl");
    });

    test("exactly 1 import and 1 export hoisted correctly", () => {
      const src = "${ import y from 'mod'; export const z = 1; }";
      const result = parse(src);
      expect(result.ast.imports.length).toBe(1);
      expect(result.ast.exports.length).toBe(1);
    });

    test("multiple imports all hoisted exactly", () => {
      const src = "${ import a from 'mod1'; import b from 'mod2'; }";
      const result = parse(src);
      expect(result.ast.imports.length).toBe(2);
    });

    test("multiple exports all hoisted exactly", () => {
      const src = "${ export const a = 1; export const b = 2; }";
      const result = parse(src);
      expect(result.ast.exports.length).toBe(2);
    });
  });

  // Defect 5: Error emission — verify errors are reported correctly
  describe("Defect 5: Error emission", () => {
    test("boolean attribute with quoted string value triggers E-ATTR-002", () => {
      const src = '<input disabled="true"/>';
      const result = parse(src);
      expect(Array.isArray(result.errors)).toBe(true);
      const attr002 = result.errors.find(e => e.code === "E-ATTR-002");
      expect(attr002).toBeDefined();
      expect(attr002.code).toBe("E-ATTR-002");
    });

    test("E-ATTR-002 error has non-empty message", () => {
      const src = '<button disabled="yes">Click</>';
      const result = parse(src);
      const attr002 = result.errors.find(e => e.code === "E-ATTR-002");
      expect(attr002).toBeDefined();
      expect(attr002.message.length).toBeGreaterThan(0);
    });

    test("E-ATTR-002 error has a valid span", () => {
      const src = '<div hidden="value">content</>';
      const result = parse(src);
      const attr002 = result.errors.find(e => e.code === "E-ATTR-002");
      expect(attr002).toBeDefined();
      expect(typeof attr002.tabSpan.start).toBe("number");
      expect(typeof attr002.tabSpan.end).toBe("number");
      expect(typeof attr002.tabSpan.line).toBe("number");
      expect(typeof attr002.tabSpan.col).toBe("number");
    });

    test("buildAST always returns errors array (even if empty)", () => {
      const src = "<p>hello</>";
      const result = parse(src);
      expect(Array.isArray(result.errors)).toBe(true);
    });

    test("valid markup produces no errors (warnings excluded)", () => {
      const src = "<p>hello</>";
      const result = parse(src);
      const realErrors = result.errors.filter(e => !e.code?.startsWith("W-"));
      expect(realErrors.length).toBe(0);
    });

    test("valid attributes with all three forms produce no errors (warnings excluded)", () => {
      const src = '<button class="btn" onclick=save() disabled>Click</>';
      const result = parse(src);
      const realErrors = result.errors.filter(e => !e.code?.startsWith("W-"));
      expect(realErrors.length).toBe(0);
    });

    test("fn shorthand outside logic block (in meta) triggers E-PARSE-002", () => {
      const src = "^{ fn myFunc { } }";
      const result = parse(src);
      expect(Array.isArray(result.errors)).toBe(true);
      const parse002 = result.errors.find(e => e.code === "E-PARSE-002");
      expect(parse002).toBeDefined();
      expect(parse002.code).toBe("E-PARSE-002");
      expect(parse002.message.length).toBeGreaterThan(0);
      expect(parse002.message).toContain("^{ }");
    });

    test("E-PARSE-002 error has a valid span when fn used in meta block", () => {
      const src = "^{ fn greet { } }";
      const result = parse(src);
      const parse002 = result.errors.find(e => e.code === "E-PARSE-002");
      expect(parse002).toBeDefined();
      expect(typeof parse002.tabSpan.start).toBe("number");
      expect(typeof parse002.tabSpan.end).toBe("number");
      expect(typeof parse002.tabSpan.line).toBe("number");
      expect(typeof parse002.tabSpan.col).toBe("number");
    });

    test("fn shorthand outside logic block (in meta) returns correct error code E-PARSE-002", () => {
      const src = "^{ fn test { } }";
      const result = parse(src);
      const errors = result.errors;
      expect(errors.length).toBeGreaterThan(0);
      const e002 = errors.find(e => e.code === "E-PARSE-002");
      expect(e002).toBeDefined();
    });

    test("semicolons in logic blocks do not trigger E-PARSE-001", () => {
      const src = "${ ; }"; // Semicolons are valid statement boundaries, not stuck tokens
      const result = parse(src);
      expect(Array.isArray(result.errors)).toBe(true);
      const hasParseError = result.errors.some(e => e.code === "E-PARSE-001");
      expect(hasParseError).toBe(false);
    });

    test("semicolons in meta blocks do not trigger E-META-002", () => {
      const src = "^{ ; }"; // Semicolons are valid statement boundaries, not stuck tokens
      const result = parse(src);
      expect(Array.isArray(result.errors)).toBe(true);
      const hasMetaError = result.errors.some(e => e.code === "E-META-002");
      expect(hasMetaError).toBe(false);
    });
  });

  // Defect 6: Sequential multi-file ID uniqueness
  describe("Defect 6: Sequential multi-file ID uniqueness", () => {
    test("IDs are unique within a single FileAST", () => {
      const src = "<p>a</><p>b</><p>c</>";
      const result = parse(src);

      const ids = new Set();
      function collectIds(node) {
        if (node && typeof node === "object" && "id" in node) {
          expect(ids.has(node.id)).toBe(false);
          ids.add(node.id);
          for (const [key, val] of Object.entries(node)) {
            if (key !== "id" && key !== "span") {
              if (Array.isArray(val)) {
                val.forEach(child => collectIds(child));
              } else if (val && typeof val === "object") {
                collectIds(val);
              }
            }
          }
        }
      }

      for (const node of result.ast.nodes) {
        collectIds(node);
      }

      expect(ids.size).toBeGreaterThan(0);
    });

    test("each file's ID counter starts from 1 (sequential builds reset counter)", () => {
      const src1 = "<p>hello</>";
      const src2 = "<div>world</>";

      const result1 = parse(src1);
      const result2 = parse(src2);

      // Helper to find min ID in a result
      function getMinId(result) {
        let minId = Infinity;
        function walk(node) {
          if (node && typeof node === "object" && "id" in node) {
            minId = Math.min(minId, node.id);
            for (const [key, val] of Object.entries(node)) {
              if (key !== "id" && key !== "span") {
                if (Array.isArray(val)) {
                  val.forEach(child => walk(child));
                } else if (val && typeof val === "object") {
                  walk(val);
                }
              }
            }
          }
        }
        for (const node of result.ast.nodes) {
          walk(node);
        }
        return minId === Infinity ? -1 : minId;
      }

      const minId1 = getMinId(result1);
      const minId2 = getMinId(result2);

      // Both should start from 1 since counter starts at 0 and increments before use
      expect(minId1).toBe(1);
      expect(minId2).toBe(1);
    });
  });

  // Defect 7: No `_id` mutation
  describe("Defect 7: No `_id` mutation", () => {
    test("AST nodes have numeric id property, not _id", () => {
      const src = "${ let x = 1; }";
      const result = parse(src);
      const logic = result.ast.nodes[0];
      expect(typeof logic.id).toBe("number");
      expect(logic.id).toBeGreaterThan(0);
    });

    test("no node in the AST has an _id property", () => {
      const src = "<div><p>text</p></div>";
      const result = parse(src);

      let hasInvalidId = false;
      function walk(node) {
        if (node && typeof node === "object") {
          if ("_id" in node) {
            hasInvalidId = true;
          }
          for (const [key, val] of Object.entries(node)) {
            if (key !== "id" && key !== "span") {
              if (Array.isArray(val)) {
                val.forEach(child => walk(child));
              } else if (val && typeof val === "object") {
                walk(val);
              }
            }
          }
        }
      }

      for (const node of result.ast.nodes) {
        walk(node);
      }
      expect(hasInvalidId).toBe(false);
    });

    test("every node with a kind property has a numeric id", () => {
      const src = '<button onclick=save()>Save</>';
      const result = parse(src);

      let allHaveId = true;
      function walk(node) {
        if (node && typeof node === "object" && "kind" in node) {
          if (typeof node.id !== "number" || node.id <= 0) {
            allHaveId = false;
          }
          for (const [key, val] of Object.entries(node)) {
            if (key !== "id" && key !== "span") {
              if (Array.isArray(val)) {
                val.forEach(child => walk(child));
              } else if (val && typeof val === "object") {
                walk(val);
              }
            }
          }
        }
      }

      for (const node of result.ast.nodes) {
        walk(node);
      }
      expect(allHaveId).toBe(true);
    });
  });

  // Review gap: Error-effect positive assertion
  describe("Review gap: Error-effect positive assertions", () => {
    test("guarded-expr with single arm is captured (was: error-effect)", () => {
      const logic = firstNode("${ someCall() !{ | _ e -> null } }");
      const err = logic.body.find(n => n.kind === "guarded-expr");
      expect(err).toBeDefined();
      expect(Array.isArray(err.arms)).toBe(true);
      expect(err.arms.length).toBeGreaterThan(0);
    });

    test("guarded-expr arms array has proper structure (was: error-effect)", () => {
      const logic = firstNode("${ call() !{ | a b -> a + b } }");
      const err = logic.body.find(n => n.kind === "guarded-expr");
      expect(err).toBeDefined();
      for (const arm of err.arms) {
        expect(arm).toBeDefined();
        expect(typeof arm === "object").toBe(true);
      }
    });

    test("guarded-expr node always has a span field (was: error-effect)", () => {
      const logic = firstNode("${ fn() !{ | x e -> x } }");
      const err = logic.body.find(n => n.kind === "guarded-expr");
      expect(err).toBeDefined();
      expect(err.span).toBeDefined();
      expect(typeof err.span.start).toBe("number");
      expect(typeof err.span.end).toBe("number");
    });
  });

  // Review gap: Previously untested error codes (per tab-re-review-2026-03-26.md)
  describe("Review gap: Untested error codes E-PARSE-001, E-PARSE-002, E-META-002", () => {
    test("E-PARSE-002: fn outside logic context (in meta block)", () => {
      const src = "^{ fn myFunc { } }";
      const result = parse(src);
      expect(Array.isArray(result.errors)).toBe(true);
      const e002 = result.errors.find(e => e.code === "E-PARSE-002");
      expect(e002).toBeDefined();
      expect(e002.code).toBe("E-PARSE-002");
    });

    test("E-PARSE-002 error message mentions the correct context", () => {
      const src = "^{ fn x { } }";
      const result = parse(src);
      const e002 = result.errors.find(e => e.code === "E-PARSE-002");
      expect(e002).toBeDefined();
      expect(e002.message).toBeTruthy();
      expect(e002.message.length).toBeGreaterThan(0);
    });

    test("E-PARSE-002 error has valid span fields", () => {
      const src = "^{ fn x { } }";
      const result = parse(src);
      const e002 = result.errors.find(e => e.code === "E-PARSE-002");
      expect(e002).toBeDefined();
      expect(typeof e002.tabSpan.start).toBe("number");
      expect(typeof e002.tabSpan.end).toBe("number");
      expect(typeof e002.tabSpan.line).toBe("number");
      expect(typeof e002.tabSpan.col).toBe("number");
    });
  });
});

// ===========================================================================
// §35.2 State Constructor Parsing
// ===========================================================================

describe("§35.2 State Constructor Parsing", () => {
  // -----------------------------------------------------------------------
  // Tokenizer: ATTR_TYPED_DECL
  // -----------------------------------------------------------------------

  describe("tokenizer — ATTR_TYPED_DECL", () => {
    test("name(type) produces ATTR_TYPED_DECL token in state context", () => {
      const tokens = tokenizeAttributes("< session token(string)>", 0, 1, 1, "state");
      const typed = tokens.filter(t => t.kind === "ATTR_TYPED_DECL");
      expect(typed).toHaveLength(1);
      const parsed = JSON.parse(typed[0].text);
      expect(parsed.name).toBe("token");
      expect(parsed.typeExpr).toBe("string");
    });

    test("multiple typed declarations", () => {
      const tokens = tokenizeAttributes("< theme mode(string) size(number)>", 0, 1, 1, "state");
      const typed = tokens.filter(t => t.kind === "ATTR_TYPED_DECL");
      expect(typed).toHaveLength(2);
      const p0 = JSON.parse(typed[0].text);
      const p1 = JSON.parse(typed[1].text);
      expect(p0.name).toBe("mode");
      expect(p0.typeExpr).toBe("string");
      expect(p1.name).toBe("size");
      expect(p1.typeExpr).toBe("number");
    });

    test("name(type) NOT produced in markup context", () => {
      // In markup context, name(type) is just ATTR_NAME + unexpected chars
      const tokens = tokenizeAttributes("<div class(string)>", 0, 1, 1, "markup");
      const typed = tokens.filter(t => t.kind === "ATTR_TYPED_DECL");
      expect(typed).toHaveLength(0);
    });

    test("optional type with ?", () => {
      const tokens = tokenizeAttributes("< widget label(string?)>", 0, 1, 1, "state");
      const typed = tokens.filter(t => t.kind === "ATTR_TYPED_DECL");
      expect(typed).toHaveLength(1);
      const parsed = JSON.parse(typed[0].text);
      expect(parsed.name).toBe("label");
      expect(parsed.typeExpr).toBe("string?");
    });

    test("type with default value", () => {
      const tokens = tokenizeAttributes('< theme color(string = "#fff")>', 0, 1, 1, "state");
      const typed = tokens.filter(t => t.kind === "ATTR_TYPED_DECL");
      expect(typed).toHaveLength(1);
      const parsed = JSON.parse(typed[0].text);
      expect(parsed.name).toBe("color");
      expect(parsed.typeExpr).toContain("string");
    });

    test("regular state block (no typed decls) produces ATTR_NAME tokens", () => {
      const tokens = tokenizeAttributes("< db>", 0, 1, 1, "state");
      const typed = tokens.filter(t => t.kind === "ATTR_TYPED_DECL");
      expect(typed).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // AST Builder: state-constructor-def node
  // -----------------------------------------------------------------------

  describe("AST builder — state-constructor-def", () => {
    test("< name attr(type)> produces state-constructor-def node", () => {
      const result = parseAST("< session token(string)>\nHello\n</>");
      const ctor = result.nodes.find(n => n.kind === "state-constructor-def");
      expect(ctor).toBeDefined();
      expect(ctor.stateType).toBe("session");
      expect(ctor.typedAttrs).toHaveLength(1);
      expect(ctor.typedAttrs[0].name).toBe("token");
      expect(ctor.typedAttrs[0].typeExpr).toBe("string");
      expect(ctor.typedAttrs[0].optional).toBe(false);
    });

    test("optional attribute parsed correctly", () => {
      const result = parseAST("< widget label(string?)>\n</>");
      const ctor = result.nodes.find(n => n.kind === "state-constructor-def");
      expect(ctor).toBeDefined();
      expect(ctor.typedAttrs[0].optional).toBe(true);
      expect(ctor.typedAttrs[0].typeExpr).toBe("string");
    });

    test("default value parsed correctly", () => {
      const result = parseAST('< counter start(number = 0)>\n</>');
      const ctor = result.nodes.find(n => n.kind === "state-constructor-def");
      expect(ctor).toBeDefined();
      expect(ctor.typedAttrs[0].name).toBe("start");
      expect(ctor.typedAttrs[0].typeExpr).toBe("number");
      expect(ctor.typedAttrs[0].defaultValue).toBe("0");
      expect(ctor.typedAttrs[0].optional).toBe(true); // default implies optional
    });

    test("multiple typed attributes", () => {
      const result = parseAST("< theme mode(string) fontSize(number) custom(string?)>\n</>");
      const ctor = result.nodes.find(n => n.kind === "state-constructor-def");
      expect(ctor).toBeDefined();
      expect(ctor.typedAttrs).toHaveLength(3);
      expect(ctor.typedAttrs[0].name).toBe("mode");
      expect(ctor.typedAttrs[1].name).toBe("fontSize");
      expect(ctor.typedAttrs[2].name).toBe("custom");
      expect(ctor.typedAttrs[2].optional).toBe(true);
    });

    test("regular state block < db> is unchanged (kind=state)", () => {
      const result = parseAST("< db>\n</>");
      const state = result.nodes.find(n => n.kind === "state");
      expect(state).toBeDefined();
      expect(state.stateType).toBe("db");
      // No state-constructor-def
      const ctor = result.nodes.find(n => n.kind === "state-constructor-def");
      expect(ctor).toBeUndefined();
    });

    test("state-constructor-def has children (body)", () => {
      const result = parseAST("< wrapper padding(number)>\n<div>\nContent\n</>\n</>");
      const ctor = result.nodes.find(n => n.kind === "state-constructor-def");
      expect(ctor).toBeDefined();
      expect(ctor.children.length).toBeGreaterThanOrEqual(1);
    });

    test("state-constructor-def has span", () => {
      const result = parseAST("< session token(string)>\n</>");
      const ctor = result.nodes.find(n => n.kind === "state-constructor-def");
      expect(ctor).toBeDefined();
      expect(ctor.span).toBeDefined();
      expect(typeof ctor.span.start).toBe("number");
      expect(typeof ctor.span.line).toBe("number");
    });
  });
});

// ---------------------------------------------------------------------------
// §5.4 — bind: directives
// ---------------------------------------------------------------------------

describe("§5.4 — bind: directives", () => {

  test("bind:value=@var parsed as attribute with variable-ref", () => {
    const src = '<input bind:value=@username/>';
    const node = firstNode(src);
    expect(node.kind).toBe("markup");
    const bindAttr = (node.attrs ?? []).find(a => a.name === "bind:value");
    expect(bindAttr).toBeDefined();
    expect(bindAttr.value.kind).toBe("variable-ref");
    expect(bindAttr.value.name).toBe("@username");
  });

  test("bind:checked=@var parsed correctly", () => {
    const src = '<input type="checkbox" bind:checked=@agreed/>';
    const node = firstNode(src);
    const bindAttr = (node.attrs ?? []).find(a => a.name === "bind:checked");
    expect(bindAttr).toBeDefined();
    expect(bindAttr.value.kind).toBe("variable-ref");
    expect(bindAttr.value.name).toBe("@agreed");
  });

  test("bind:selected=@var parsed correctly", () => {
    const src = '<select bind:selected=@choice>options</>';
    const node = firstNode(src);
    const bindAttr = (node.attrs ?? []).find(a => a.name === "bind:selected");
    expect(bindAttr).toBeDefined();
    expect(bindAttr.value.kind).toBe("variable-ref");
    expect(bindAttr.value.name).toBe("@choice");
  });

  test("bind:group=@var parsed correctly on radio", () => {
    const src = '<input type="radio" name="color" value="red" bind:group=@color/>';
    const node = firstNode(src);
    const bindAttr = (node.attrs ?? []).find(a => a.name === "bind:group");
    expect(bindAttr).toBeDefined();
    expect(bindAttr.value.kind).toBe("variable-ref");
    expect(bindAttr.value.name).toBe("@color");
  });

  test("bind:value=@state.field — one-level dotted path parsed without E-ATTR-010", () => {
    // §15.11.2: state instance field access via bind:value=@stateRef.fieldName
    const src = '<input bind:value=@state.fieldName/>';
    const result = parse(src);
    // No E-ATTR-010 — @-prefixed dotted path is valid
    const err010 = result.errors.find(e => e.code === "E-ATTR-010");
    expect(err010).toBeUndefined();
    const node = firstNode(src);
    const bindAttr = (node.attrs ?? []).find(a => a.name === "bind:value");
    expect(bindAttr).toBeDefined();
    expect(bindAttr.value.kind).toBe("variable-ref");
    expect(bindAttr.value.name).toBe("@state.fieldName");
  });

  test("bind:value=@obj.nested.field — deep dotted path parsed without errors", () => {
    // §15.11.2: multi-level state field path
    const src = '<input bind:value=@obj.nested.field/>';
    const result = parse(src);
    const err010 = result.errors.find(e => e.code === "E-ATTR-010");
    expect(err010).toBeUndefined();
    const node = firstNode(src);
    const bindAttr = (node.attrs ?? []).find(a => a.name === "bind:value");
    expect(bindAttr).toBeDefined();
    expect(bindAttr.value.kind).toBe("variable-ref");
    expect(bindAttr.value.name).toBe("@obj.nested.field");
  });

  test("bind:value=@simple — plain reactive variable regression", () => {
    // Regression: plain @variable still parses as before
    const src = '<input bind:value=@simple/>';
    const result = parse(src);
    const err010 = result.errors.find(e => e.code === "E-ATTR-010");
    expect(err010).toBeUndefined();
    const node = firstNode(src);
    const bindAttr = (node.attrs ?? []).find(a => a.name === "bind:value");
    expect(bindAttr).toBeDefined();
    expect(bindAttr.value.kind).toBe("variable-ref");
    expect(bindAttr.value.name).toBe("@simple");
  });

  test("class:name=@condition parsed as attribute", () => {
    const src = '<div class:active=@isActive>content</>';
    const node = firstNode(src);
    const classAttr = (node.attrs ?? []).find(a => a.name === "class:active");
    expect(classAttr).toBeDefined();
    expect(classAttr.value.kind).toBe("variable-ref");
    expect(classAttr.value.name).toBe("@isActive");
  });

  test("E-ATTR-013: class: directive with non-reactive variable", () => {
    const src = '<div class:active=isActive>content</>';
    const result = parse(src);
    const err = result.errors.find(e => e.code === "E-ATTR-013");
    expect(err).toBeDefined();
    expect(err.message).toContain("E-ATTR-013");
    expect(err.message).toContain("bare identifier");
  });

  test("E-ATTR-013: class: directive with string literal", () => {
    const src = '<div class:active="true">content</>';
    const result = parse(src);
    const err = result.errors.find(e => e.code === "E-ATTR-013");
    expect(err).toBeDefined();
    expect(err.message).toContain("E-ATTR-013");
  });

  test("E-ATTR-013: class: directive with absent value (boolean form)", () => {
    const src = '<div class:active>content</>';
    const result = parse(src);
    const err = result.errors.find(e => e.code === "E-ATTR-013");
    expect(err).toBeDefined();
    expect(err.message).toContain("E-ATTR-013");
  });

  test("no E-ATTR-013 for valid class:name=@condition", () => {
    const src = '<div class:active=@isActive>content</>';
    const result = parse(src);
    const err = result.errors.find(e => e.code === "E-ATTR-013");
    expect(err).toBeUndefined();
  });

  // §5.5.2: class: directive with parenthesized expression RHS
  test("class:active=(@tool === 'select') parsed as expr attribute", () => {
    const src = "<div class:active=(@tool === \"select\")>content</>";
    const node = firstNode(src);
    const classAttr = (node.attrs ?? []).find(a => a.name === "class:active");
    expect(classAttr).toBeDefined();
    expect(classAttr.value.kind).toBe("expr");
    expect(classAttr.value.raw).toBe("(@tool === \"select\")");
  });

  test("class:active=(@a && @b) has refs for both reactive vars", () => {
    const src = "<div class:active=(@a && @b)>content</>";
    const node = firstNode(src);
    const classAttr = (node.attrs ?? []).find(a => a.name === "class:active");
    expect(classAttr).toBeDefined();
    expect(classAttr.value.kind).toBe("expr");
    expect(classAttr.value.refs).toContain("a");
    expect(classAttr.value.refs).toContain("b");
  });

  test("no E-ATTR-013 for class: with parenthesized expression", () => {
    const src = "<div class:active=(@tool === \"select\")>content</>";
    const result = parse(src);
    const err = result.errors.find(e => e.code === "E-ATTR-013");
    expect(err).toBeUndefined();
  });

  test("class: expression RHS with single reactive var has correct ref", () => {
    const src = "<button class:selected=(@tab === \"home\")>content</>";
    const node = firstNode(src);
    const attr = (node.attrs ?? []).find(a => a.name === "class:selected");
    expect(attr).toBeDefined();
    expect(attr.value.kind).toBe("expr");
    expect(attr.value.refs).toContain("tab");
    expect(attr.value.refs).not.toContain("home");
  });

  test("E-ATTR-010: bind:value with non-reactive variable", () => {
    const src = '<input bind:value=plainName/>';
    const result = parse(src);
    const err = result.errors.find(e => e.code === "E-ATTR-010");
    expect(err).toBeDefined();
    expect(err.message).toContain("E-ATTR-010");
    expect(err.message).toContain("reactive");
  });

  test("E-ATTR-010: bind:value with string literal", () => {
    const src = '<input bind:value="hello"/>';
    const result = parse(src);
    const err = result.errors.find(e => e.code === "E-ATTR-010");
    expect(err).toBeDefined();
    expect(err.message).toContain("E-ATTR-010");
  });

  test("E-ATTR-011: bind: on unsupported attribute name", () => {
    const src = '<input bind:placeholder=@name/>';
    const result = parse(src);
    const err = result.errors.find(e => e.code === "E-ATTR-011");
    expect(err).toBeDefined();
    expect(err.message).toContain("E-ATTR-011");
    expect(err.message).toContain("bind:placeholder");
  });

  test("bind:value + oninput coexistence: no E-ATTR-012 (composable by design)", () => {
    // §5.4 updated: bind: directives and explicit handlers are composable.
    // Both the bind wiring and the explicit handler fire independently.
    const src = '<input bind:value=@name oninput=handleInput()>';
    const result = parse(src);
    const err = result.errors.find(e => e.code === "E-ATTR-012");
    expect(err).toBeUndefined();
  });

  test("bind:checked + onchange coexistence: no E-ATTR-012 (composable by design)", () => {
    // §5.4 updated: bind:checked and explicit onchange= are composable.
    const src = '<input type="checkbox" bind:checked=@val onchange=handler()>';
    const result = parse(src);
    const err = result.errors.find(e => e.code === "E-ATTR-012");
    expect(err).toBeUndefined();
  });

  test("no E-ATTR-012 when bind:value has no conflicting event handler", () => {
    const src = '<input bind:value=@name onclick=handler()>';
    const result = parse(src);
    const err012 = result.errors.find(e => e.code === "E-ATTR-012");
    expect(err012).toBeUndefined();
  });

  test("bind: attributes have valid spans", () => {
    const src = '<input bind:value=@name/>';
    const node = firstNode(src);
    const bindAttr = (node.attrs ?? []).find(a => a.name === "bind:value");
    expect(bindAttr).toBeDefined();
    expect(bindAttr.span).toBeDefined();
    expect(typeof bindAttr.span.start).toBe("number");
    expect(typeof bindAttr.span.line).toBe("number");
  });

  test("multiple bind: directives on different elements", () => {
    const src = '<div><input bind:value=@name/><input type="checkbox" bind:checked=@agreed/></>';
    const ast = parseAST(src);
    const inputs = [];
    function findMarkup(nodes) {
      for (const n of nodes) {
        if (n && n.kind === "markup" && n.tag === "input") inputs.push(n);
        if (n && n.children) findMarkup(n.children);
      }
    }
    findMarkup(ast.nodes);
    expect(inputs.length).toBe(2);
    expect(inputs[0].attrs.find(a => a.name === "bind:value")).toBeDefined();
    expect(inputs[1].attrs.find(a => a.name === "bind:checked")).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// §6.6 — Derived reactive values (const @name = expr)
// Phase A1a Step 11.5 fold: legacy `const @x = expr` produces unified
// state-decl with shape:"derived", isConst:true, structuralForm:false.
// ADR Option A FOLD ratified S60. The retired `reactive-derived-decl` kind
// is asserted ABSENT post-fold.
// ---------------------------------------------------------------------------

// Helper: find a folded-derived state-decl by name in a body array.
function findDerivedDecl(body, name) {
  return body.find(
    (n) =>
      n.kind === "state-decl" &&
      n.shape === "derived" &&
      n.structuralForm === false &&
      n.name === name,
  );
}

describe("§6.6 — derived reactive values (post-Step-11.5 fold to state-decl)", () => {

  test("const @total = @price * @quantity produces state-decl{shape:\"derived\",structuralForm:false}", () => {
    const src = "${ const @total = @price * @quantity; }";
    const ast = parseAST(src);
    const logic = ast.nodes.find(n => n.kind === "logic");
    expect(logic).toBeDefined();
    const derived = findDerivedDecl(logic.body, "total");
    expect(derived).toBeDefined();
    expect(derived.kind).toBe("state-decl");
    expect(derived.shape).toBe("derived");
    expect(derived.isConst).toBe(true);
    expect(derived.structuralForm).toBe(false);
    expect(derived.name).toBe("total");
    expect(derived.init).toContain("@price");
    expect(derived.init).toContain("@quantity");
    // The retired kind must be absent.
    const retired = logic.body.find(n => n.kind === "reactive-derived-decl");
    expect(retired).toBeUndefined();
  });

  test("const @x = 5 + 3 (no reactive deps) produces state-decl{shape:\"derived\"}", () => {
    const src = "${ const @x = 5 + 3; }";
    const ast = parseAST(src);
    const logic = ast.nodes.find(n => n.kind === "logic");
    const derived = findDerivedDecl(logic.body, "x");
    expect(derived).toBeDefined();
    expect(derived.name).toBe("x");
    expect(derived.init).toContain("5");
    expect(derived.init).toContain("3");
  });

  test("const total = @price * @quantity (no @ on binding) produces const-decl, NOT derived state-decl", () => {
    const src = "${ const total = @price * @quantity; }";
    const ast = parseAST(src);
    const logic = ast.nodes.find(n => n.kind === "logic");
    const constDecl = logic.body.find(n => n.kind === "const-decl" && n.name === "total");
    expect(constDecl).toBeDefined();
    expect(constDecl.init).toContain("@price");
    // NOT a derived state-decl; the retired kind is also absent.
    const derived = findDerivedDecl(logic.body, "total");
    expect(derived).toBeUndefined();
    const retired = logic.body.find(n => n.kind === "reactive-derived-decl");
    expect(retired).toBeUndefined();
  });

  test("derived state-decl carries a valid span", () => {
    const src = "${ const @total = @price * @quantity; }";
    const ast = parseAST(src);
    const logic = ast.nodes.find(n => n.kind === "logic");
    const derived = findDerivedDecl(logic.body, "total");
    expect(derived).toBeDefined();
    assertSpans(derived);
  });

  test("derived state-decl has id field", () => {
    const src = "${ const @count = @items . length; }";
    const ast = parseAST(src);
    const logic = ast.nodes.find(n => n.kind === "logic");
    const derived = findDerivedDecl(logic.body, "count");
    expect(derived).toBeDefined();
    expect(typeof derived.id).toBe("number");
  });

  test("const @name inside nested function body produces folded-derived state-decl", () => {
    const src = "${ function foo() { const @x = @a + @b; } }";
    const ast = parseAST(src);
    const logic = ast.nodes.find(n => n.kind === "logic");
    const fn = logic.body.find(n => n.kind === "function-decl");
    expect(fn).toBeDefined();
    const derived = findDerivedDecl(fn.body, "x");
    expect(derived).toBeDefined();
    expect(derived.name).toBe("x");
    expect(derived.shape).toBe("derived");
    expect(derived.structuralForm).toBe(false);
  });

  test("const @empty with no init produces folded-derived state-decl with empty init", () => {
    const src = "${ const @empty; }";
    const ast = parseAST(src);
    const logic = ast.nodes.find(n => n.kind === "logic");
    const derived = findDerivedDecl(logic.body, "empty");
    expect(derived).toBeDefined();
    expect(derived.name).toBe("empty");
    expect(derived.init).toBe("");
  });
});

// ---------------------------------------------------------------------------
// W-PROGRAM-001: <program> root detection
// ---------------------------------------------------------------------------

describe("W-PROGRAM-001: program root detection", () => {
  test("file without <program> emits W-PROGRAM-001 warning", () => {
    const src = "<div>Hello</>";
    const result = parse(src);
    const warning = result.errors.find(e => e.code === "W-PROGRAM-001");
    expect(warning).toBeDefined();
    expect(warning.severity).toBe("warning");
    expect(warning.message).toContain("program");
  });

  test("file with <program> root does NOT emit W-PROGRAM-001", () => {
    const src = "<program><div>Hello</></program>";
    const result = parse(src);
    const warning = result.errors.find(e => e.code === "W-PROGRAM-001");
    expect(warning).toBeUndefined();
  });

  test("hasProgramRoot is true when <program> is present", () => {
    const src = "<program>content</>";
    const result = parse(src);
    expect(result.ast.hasProgramRoot).toBe(true);
  });

  test("hasProgramRoot is false when <program> is absent", () => {
    const src = "<div>content</>";
    const result = parse(src);
    expect(result.ast.hasProgramRoot).toBe(false);
  });

  test("file with only logic blocks (pure module shape) suppresses W-PROGRAM-001 (S93 Bug 6B)", () => {
    // S93 Bug 6B (pure-module file): files with NO top-level markup are
    // recognized canonical "pure module" shape per S85 Q2 + SPEC §21.5.
    // The W-PROGRAM-001 "wrap your content in <program>" hint would be
    // misleading for them — they're correctly module-shaped.
    const src = "${ let x = 1 }";
    const result = parse(src);
    const warning = result.errors.find(e => e.code === "W-PROGRAM-001");
    expect(warning).toBeUndefined();
  });

  test("file with no program AND top-level markup emits W-PROGRAM-001", () => {
    // The opposite branch: a file with bare top-level markup but no
    // <program> wrapper is NOT a pure-module shape — the W-PROGRAM-001
    // hint is still useful.
    const src = "<div>content</>";
    const result = parse(src);
    const warning = result.errors.find(e => e.code === "W-PROGRAM-001");
    expect(warning).toBeDefined();
  });

  test("program with attributes does not emit W-PROGRAM-001", () => {
    const src = '<program db="./test.db" name="myapp"></program>';
    const result = parse(src);
    const warning = result.errors.find(e => e.code === "W-PROGRAM-001");
    expect(warning).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// §21 Structured import/export parsing
// ---------------------------------------------------------------------------

describe("§21 — structured import/export parsing", () => {
  test("named import parses names and source", () => {
    const src = "${ import { Status, Config } from './types.scrml' }";
    const ast = parseAST(src);
    const imp = ast.imports[0];
    expect(imp).toBeDefined();
    expect(imp.kind).toBe("import-decl");
    expect(imp.names).toEqual(["Status", "Config"]);
    expect(imp.source).toBe("./types.scrml");
    expect(imp.isDefault).toBe(false);
  });

  test("default import parses name and source", () => {
    const src = "${ import MyModule from './module.scrml' }";
    const ast = parseAST(src);
    const imp = ast.imports[0];
    expect(imp).toBeDefined();
    expect(imp.names).toEqual(["MyModule"]);
    expect(imp.source).toBe("./module.scrml");
    expect(imp.isDefault).toBe(true);
  });

  test("import from .js file parses source", () => {
    const src = "${ import { helper } from './helper.js' }";
    const ast = parseAST(src);
    const imp = ast.imports[0];
    expect(imp).toBeDefined();
    expect(imp.names).toEqual(["helper"]);
    expect(imp.source).toBe("./helper.js");
  });

  test("export type parses exported name and kind", () => {
    const src = "${ export type Status:enum = { Active, Inactive } }";
    const ast = parseAST(src);
    const exp = ast.exports[0];
    expect(exp).toBeDefined();
    expect(exp.kind).toBe("export-decl");
    expect(exp.exportedName).toBe("Status");
    expect(exp.exportKind).toBe("type");
  });

  test("export function parses exported name and kind", () => {
    const src = "${ export function formatDate(d) { return d; } }";
    const ast = parseAST(src);
    const exp = ast.exports[0];
    expect(exp).toBeDefined();
    expect(exp.exportedName).toBe("formatDate");
    expect(exp.exportKind).toBe("function");
  });

  test("export const parses exported name", () => {
    const src = "${ export const MAX_RETRIES = 3 }";
    const ast = parseAST(src);
    const exp = ast.exports[0];
    expect(exp).toBeDefined();
    expect(exp.exportedName).toBe("MAX_RETRIES");
    expect(exp.exportKind).toBe("const");
  });

  test("export let parses exported name", () => {
    const src = "${ export let counter = 0 }";
    const ast = parseAST(src);
    const exp = ast.exports[0];
    expect(exp).toBeDefined();
    expect(exp.exportedName).toBe("counter");
    expect(exp.exportKind).toBe("let");
  });

  test("multiple imports in separate logic blocks", () => {
    const src = "${ import { A } from './a.scrml' }\n${ import { B } from './b.scrml' }";
    const ast = parseAST(src);
    expect(ast.imports).toHaveLength(2);
    expect(ast.imports[0].names).toEqual(["A"]);
    expect(ast.imports[1].names).toEqual(["B"]);
  });

  test("mixed imports and exports", () => {
    const src = "${ import { Base } from './base.scrml' }\n${ export type Extended:struct = { name: string } }";
    const ast = parseAST(src);
    expect(ast.imports).toHaveLength(1);
    expect(ast.exports).toHaveLength(1);
  });

  test("import raw still contains the full statement", () => {
    const src = "${ import { Foo } from './foo.scrml' }";
    const ast = parseAST(src);
    expect(ast.imports[0].raw).toContain("import");
    expect(ast.imports[0].raw).toContain("Foo");
  });
});

// ---------------------------------------------------------------------------
// ref= attribute parsing
// ---------------------------------------------------------------------------

describe("ref= attribute", () => {
  test("ref=@el produces a variable-ref AttrNode", () => {
    const node = firstNode('<canvas ref=@el></canvas>');
    expect(node.kind).toBe("markup");
    expect(node.tag).toBe("canvas");
    const refAttr = node.attrs.find(a => a.name === "ref");
    expect(refAttr).toBeDefined();
    expect(refAttr.value.kind).toBe("variable-ref");
    expect(refAttr.value.name).toBe("@el");
  });

  test("ref with string literal is a regular attribute", () => {
    const node = firstNode('<div ref="myId"></div>');
    const refAttr = node.attrs.find(a => a.name === "ref");
    expect(refAttr).toBeDefined();
    expect(refAttr.value.kind).toBe("string-literal");
    expect(refAttr.value.value).toBe("myId");
  });
});

// ---------------------------------------------------------------------------
// cleanup() built-in parsing
// ---------------------------------------------------------------------------

describe("cleanup() built-in", () => {
  test("cleanup(...) produces a cleanup-registration node", () => {
    const ast = parseAST("${ cleanup(() => { clearInterval(timer) }) }");
    const logic = ast.nodes[0];
    expect(logic.kind).toBe("logic");
    const cleanupNode = logic.body.find(n => n.kind === "cleanup-registration");
    expect(cleanupNode).toBeDefined();
    expect(cleanupNode.callback).toContain("clearInterval");
  });
});

// ---------------------------------------------------------------------------
// upload() built-in parsing
// ---------------------------------------------------------------------------

describe("upload() built-in", () => {
  test("upload(file, url) produces an upload-call node", () => {
    const ast = parseAST('${ upload(selectedFile, "/api/upload") }');
    const logic = ast.nodes[0];
    expect(logic.kind).toBe("logic");
    const uploadNode = logic.body.find(n => n.kind === "upload-call");
    expect(uploadNode).toBeDefined();
    expect(uploadNode.file).toBe("selectedFile");
    expect(uploadNode.url).toContain("/api/upload");
  });
});

// ---------------------------------------------------------------------------
// S79 — `@debounced(N) name = expr` keyword-form modifier parsing tests
// RETIRED. The pre-v0.next form is superseded by the canonical state-decl
// reactivity attribute form `<name debounced=Nms> = expr` (SPEC §6.13).
// New parser tests for the attribute form live in
// `compiler/tests/unit/debounce-throttle-attribute.test.js` (S79 dispatch).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// debounce() and throttle() built-in parsing — RETIRED S81 OQ-2 (2026-05-11)
// ---------------------------------------------------------------------------
// The imperative keyword-call form is retired. Post-retirement,
// `debounce(handleSearch, 250)` parses as a regular function call (no
// special AST kind). Tokenizer no longer reserves `debounce`/`throttle` as
// KEYWORDs (see tokenizer.ts ~line 70); they tokenize as IDENT and the
// expression-parser produces a generic CallExpr. The canonical surfaces
// are §6.13 attribute form (`<x debounced=Nms>`) and stdlib
// `scrml:time.debounce` / `scrml:time.throttle`.

describe("debounce() and throttle() built-ins — RETIRED S81 OQ-2", () => {
  test("debounce(fn, ms) NO LONGER produces a special AST kind — parses as bare-expr CallExpr", () => {
    const ast = parseAST("${ debounce(handleSearch, 250) }");
    const logic = ast.nodes[0];
    // Pre-S81: produced a `debounce-call` AST kind. Post-S81: no such kind.
    const oldKindNode = logic.body.find(n => n.kind === "debounce-call");
    expect(oldKindNode).toBeUndefined();
    // The form parses as a regular call statement. Exact shape depends on
    // post-tokenization parsing; the key invariant is "no special kind."
    const hasDebounceCall = logic.body.some(n =>
      n && (n.kind === "bare-expr" || n.kind === "expression-statement"));
    expect(hasDebounceCall).toBe(true);
  });

  test("throttle(fn, ms) NO LONGER produces a special AST kind — parses as bare-expr CallExpr", () => {
    const ast = parseAST("${ throttle(handleScroll, 100) }");
    const logic = ast.nodes[0];
    const oldKindNode = logic.body.find(n => n.kind === "throttle-call");
    expect(oldKindNode).toBeUndefined();
    const hasThrottleCall = logic.body.some(n =>
      n && (n.kind === "bare-expr" || n.kind === "expression-statement"));
    expect(hasThrottleCall).toBe(true);
  });

  test("debounce/throttle as user-defined identifier — no longer E-RESERVED-IDENTIFIER", () => {
    // Pre-S81 these names were reserved at tokenize-time so `let debounce = ...`
    // fired E-RESERVED-IDENTIFIER. Post-S81 retirement, they're ordinary
    // identifiers and can be used as variable / function names.
    const ast = parseAST("${ let debounce = 42 }");
    const logic = ast.nodes[0];
    const letDecl = logic.body.find(n => n && n.kind === "let-decl" && n.name === "debounce");
    expect(letDecl).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// bind:files directive parsing
// ---------------------------------------------------------------------------

describe("bind:files directive", () => {
  test("bind:files=@var is a valid bind directive", () => {
    const result = parse('<input type="file" bind:files=@selectedFiles />');
    // Only the W-PROGRAM-001 warning is expected, no bind directive errors
    const bindErrors = result.errors.filter(e => e.code !== "W-PROGRAM-001");
    expect(bindErrors).toHaveLength(0);
    const node = result.ast.nodes[0];
    const bindAttr = node.attrs.find(a => a.name === "bind:files");
    expect(bindAttr).toBeDefined();
    expect(bindAttr.value.kind).toBe("variable-ref");
    expect(bindAttr.value.name).toBe("@selectedFiles");
  });
});

// ---------------------------------------------------------------------------
// Nested reactive assignment AST nodes
// ---------------------------------------------------------------------------

describe("nested reactive assignments", () => {
  test("@obj.prop = value produces reactive-nested-assign node", () => {
    const node = firstNode('${ @obj.prop = "hello" }');
    const decl = node.body.find(n => n.kind === "reactive-nested-assign");
    expect(decl).toBeDefined();
    expect(decl.target).toBe("obj");
    expect(decl.path).toEqual(["prop"]);
    expect(decl.value).toContain("hello");
  });

  test("@obj.path.to.deep = value produces correct path array", () => {
    const node = firstNode('${ @obj.path.to.deep = 42 }');
    const decl = node.body.find(n => n.kind === "reactive-nested-assign");
    expect(decl).toBeDefined();
    expect(decl.target).toBe("obj");
    expect(decl.path).toEqual(["path", "to", "deep"]);
  });

  test("@arr.push(item) produces reactive-array-mutation node", () => {
    const node = firstNode('${ @arr.push(newItem) }');
    const decl = node.body.find(n => n.kind === "reactive-array-mutation");
    expect(decl).toBeDefined();
    expect(decl.target).toBe("arr");
    expect(decl.method).toBe("push");
    expect(decl.args).toContain("newItem");
  });

  test("@arr.splice(idx, 1) produces reactive-array-mutation node", () => {
    const node = firstNode('${ @arr.splice(idx, 1) }');
    const decl = node.body.find(n => n.kind === "reactive-array-mutation");
    expect(decl).toBeDefined();
    expect(decl.target).toBe("arr");
    expect(decl.method).toBe("splice");
  });

  test("@set(@obj, path, value) produces reactive-explicit-set node", () => {
    const node = firstNode('${ @set(@obj, "name", "Alice") }');
    const decl = node.body.find(n => n.kind === "reactive-explicit-set");
    expect(decl).toBeDefined();
    expect(decl.args).toContain("@obj");
  });

  test("simple @name = expr still produces state-decl", () => {
    const node = firstNode('${ @count = 0 }');
    const decl = node.body.find(n => n.kind === "state-decl");
    expect(decl).toBeDefined();
    expect(decl.name).toBe("count");
  });
});
