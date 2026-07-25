/**
 * §5.2.1 — ${...} expression in attribute values + event handler expr wiring
 *
 * Tests for the attr-expr-arrow feature:
 *   §1 Tokenizer: onclick=${() => fn(arg)} → ATTR_EXPR with content "() => fn(arg)"
 *   §2 Tokenizer: if=${count > 0} → ATTR_EXPR with content "count > 0"
 *   §3 Tokenizer: show=${a && b} → ATTR_EXPR
 *   §4 Tokenizer: nested braces in ${...} — ${() => { fn(); g(); }}
 *   §5 AST builder: onclick=${() => deleteItem(id)} → expr node
 *   §6 Codegen (E2E): onclick=${() => fn("test")} compiles without error
 *   §7 Codegen (E2E): onclick=fn(arg) does NOT produce W-EVENT-001
 *   §8 Codegen (E2E): event handler with ${...} expression produces correct JS
 *   §9 Codegen (E2E): ${...} expression with @var references rewrites reactive gets
 */

import { describe, test, expect } from "bun:test";
import { tokenizeAttributes } from "../../src/tokenizer.js";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { runCG } from "../../src/code-generator.js";
import { foldChunkNamespacing } from "../helpers/chunk-scope.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parse(source) {
  const bsOut = splitBlocks("test.scrml", source);
  return buildAST(bsOut);
}

function firstNode(source) {
  return parse(source).ast.nodes[0];
}

function span(start, file = "/test/app.scrml") {
  return { file, start, end: start + 10, line: 1, col: start + 1 };
}

function makeFileAST(filePath, nodes, opts = {}) {
  return {
    filePath,
    nodes,
    imports: opts.imports ?? [],
    exports: opts.exports ?? [],
    components: opts.components ?? [],
    typeDecls: opts.typeDecls ?? [],
    nodeTypes: opts.nodeTypes ?? new Map(),
    componentShapes: opts.componentShapes ?? new Map(),
    scopeChain: opts.scopeChain ?? null,
  };
}

function makeMarkupNode(tag, attrs = [], children = [], opts = {}) {
  return {
    kind: "markup",
    tag,
    attributes: attrs,
    children,
    selfClosing: opts.selfClosing ?? false,
    span: opts.span ?? span(0),
  };
}

function makeTextNode(text, s = span(0)) {
  return { kind: "text", value: text, span: s };
}

function runCGSimple(nodes) {
  return runCG({
    files: [makeFileAST("/test/app.scrml", nodes)],
    routeMap: { functions: new Map() },
    depGraph: { nodes: new Map(), edges: [] },
    protectAnalysis: { views: new Map() },
  });
}

// ---------------------------------------------------------------------------
// §1: Tokenizer — onclick=${() => fn(arg)} → ATTR_EXPR
// ---------------------------------------------------------------------------

describe("§1: tokenizer — ${...} expression in event attribute", () => {
  test("onclick=${() => fn(arg)} produces ATTR_EXPR token", () => {
    const tokens = tokenizeAttributes('<button onclick=${() => fn(arg)}>', 0, 1, 1, "markup");
    const expr = tokens.find(t => t.kind === "ATTR_EXPR");
    expect(expr).toBeDefined();
    expect(expr.text).toBe("() => fn(arg)");
  });

  test("onclick=${() => alert(\"hi\")} produces ATTR_EXPR with correct content", () => {
    const tokens = tokenizeAttributes('<button onclick=${() => alert("hi")}>', 0, 1, 1, "markup");
    const expr = tokens.find(t => t.kind === "ATTR_EXPR");
    expect(expr).toBeDefined();
    expect(expr.text).toBe('() => alert("hi")');
  });

  test("ATTR_NAME precedes ATTR_EXPR for onclick", () => {
    const tokens = tokenizeAttributes('<button onclick=${() => fn()}>', 0, 1, 1, "markup");
    const nameIdx = tokens.findIndex(t => t.kind === "ATTR_NAME" && t.text === "onclick");
    const exprIdx = tokens.findIndex(t => t.kind === "ATTR_EXPR");
    expect(nameIdx).toBeGreaterThanOrEqual(0);
    expect(exprIdx).toBeGreaterThan(nameIdx);
  });

  test("ATTR_EQ is between ATTR_NAME and ATTR_EXPR", () => {
    const tokens = tokenizeAttributes('<button onclick=${() => fn()}>', 0, 1, 1, "markup");
    const nameIdx = tokens.findIndex(t => t.kind === "ATTR_NAME" && t.text === "onclick");
    const eqIdx = tokens.findIndex(t => t.kind === "ATTR_EQ");
    const exprIdx = tokens.findIndex(t => t.kind === "ATTR_EXPR");
    expect(eqIdx).toBeGreaterThan(nameIdx);
    expect(exprIdx).toBeGreaterThan(eqIdx);
  });
});

// ---------------------------------------------------------------------------
// §2: Tokenizer — if=${count > 0} → ATTR_EXPR
// ---------------------------------------------------------------------------

describe("§2: tokenizer — ${...} expression in if= attribute", () => {
  test("if=${count > 0} produces ATTR_EXPR with content 'count > 0'", () => {
    const tokens = tokenizeAttributes('<div if=${count > 0}>', 0, 1, 1, "markup");
    const expr = tokens.find(t => t.kind === "ATTR_EXPR");
    expect(expr).toBeDefined();
    expect(expr.text).toBe("count > 0");
  });

  test("if=${@count > 0} preserves @ sigil in expression", () => {
    const tokens = tokenizeAttributes('<div if=${@count > 0}>', 0, 1, 1, "markup");
    const expr = tokens.find(t => t.kind === "ATTR_EXPR");
    expect(expr).toBeDefined();
    expect(expr.text).toBe("@count > 0");
  });
});

// ---------------------------------------------------------------------------
// §3: Tokenizer — show=${a && b} → ATTR_EXPR
// ---------------------------------------------------------------------------

describe("§3: tokenizer — ${...} expression in show= attribute", () => {
  test("show=${a && b} produces ATTR_EXPR", () => {
    const tokens = tokenizeAttributes('<div show=${a && b}>', 0, 1, 1, "markup");
    const expr = tokens.find(t => t.kind === "ATTR_EXPR");
    expect(expr).toBeDefined();
    expect(expr.text).toBe("a && b");
  });

  test("show=${@visible && @ready} preserves both @var references", () => {
    const tokens = tokenizeAttributes('<div show=${@visible && @ready}>', 0, 1, 1, "markup");
    const expr = tokens.find(t => t.kind === "ATTR_EXPR");
    expect(expr).toBeDefined();
    expect(expr.text).toContain("@visible");
    expect(expr.text).toContain("@ready");
  });
});

// ---------------------------------------------------------------------------
// §4: Tokenizer — nested braces in ${...}
// ---------------------------------------------------------------------------

describe("§4: tokenizer — nested braces in ${...}", () => {
  test("${() => { fn(); g(); }} handles nested braces", () => {
    const tokens = tokenizeAttributes('<button onclick=${() => { fn(); g(); }}>', 0, 1, 1, "markup");
    const expr = tokens.find(t => t.kind === "ATTR_EXPR");
    expect(expr).toBeDefined();
    expect(expr.text).toBe("() => { fn(); g(); }");
  });

  test("${condition ? {a: 1} : {b: 2}} handles object literals", () => {
    const tokens = tokenizeAttributes('<div data=${condition ? {a: 1} : {b: 2}}>', 0, 1, 1, "markup");
    const expr = tokens.find(t => t.kind === "ATTR_EXPR");
    expect(expr).toBeDefined();
    expect(expr.text).toContain("{a: 1}");
    expect(expr.text).toContain("{b: 2}");
  });

  test("TAG_CLOSE_GT is still produced after ${...}", () => {
    const tokens = tokenizeAttributes('<button onclick=${() => fn()}>', 0, 1, 1, "markup");
    const close = tokens.find(t => t.kind === "TAG_CLOSE_GT");
    expect(close).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// §5: AST builder — onclick=${() => deleteItem(id)} → expr node
// ---------------------------------------------------------------------------

describe("§5: AST builder — ${...} event attribute produces expr node", () => {
  test("onclick=${() => deleteItem(id)} produces expr-kind attribute value", () => {
    const node = firstNode('<div><button onclick=${() => deleteItem(id)}>Click</></div>');
    const button = node.children[0];
    expect(button).toBeDefined();
    expect(button.tag).toBe("button");
    const onclickAttr = (button.attrs ?? button.attributes ?? []).find(a => a.name === "onclick");
    expect(onclickAttr).toBeDefined();
    expect(onclickAttr.value.kind).toBe("expr");
    expect(onclickAttr.value.raw).toBe("() => deleteItem(id)");
  });

  test("expr value extracts @var refs", () => {
    const node = firstNode('<div><button onclick=${() => update(@count)}>Click</></div>');
    const button = node.children[0];
    const onclickAttr = (button.attrs ?? button.attributes ?? []).find(a => a.name === "onclick");
    expect(onclickAttr.value.kind).toBe("expr");
    expect(onclickAttr.value.refs).toContain("count");
  });

  test("no E-ATTR-001 error for ${...} attribute value", () => {
    const result = parse('<div><button onclick=${() => fn()}>Click</></div>');
    const attrErrors = result.errors.filter(e => e.code === "E-ATTR-001");
    expect(attrErrors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §6: Codegen (E2E) — onclick=${() => fn("test")} compiles without error
// ---------------------------------------------------------------------------

describe("§6: codegen — ${...} event handler compiles without error", () => {
  test("onclick with arrow fn expression compiles cleanly", () => {
    const result = runCGSimple([
      makeMarkupNode("div", [], [
        makeMarkupNode("button", [
          {
            name: "onclick",
            value: { kind: "expr", raw: '() => alert("test")', refs: [], span: span(0) },
            span: span(0),
          },
        ], [makeTextNode("Click")]),
      ]),
    ]);

    expect(result.errors).toHaveLength(0);
    const out = result.outputs.get("/test/app.scrml");
    expect(out).toBeDefined();
    expect(out.html).toContain("data-scrml-bind-onclick");
  });

  test("handler expression appears in client JS output", () => {
    const result = runCGSimple([
      makeMarkupNode("div", [], [
        makeMarkupNode("button", [
          {
            name: "onclick",
            value: { kind: "expr", raw: '() => save("draft")', refs: [], span: span(0) },
            span: span(0),
          },
        ], [makeTextNode("Save")]),
      ]),
    ]);

    expect(result.errors).toHaveLength(0);
    const out = result.outputs.get("/test/app.scrml");
    expect(foldChunkNamespacing(out.clientJs)).toContain('save("draft")');
  });
});

// ---------------------------------------------------------------------------
// §7: Codegen (E2E) — onclick=fn(arg) does NOT produce W-EVENT-001
// ---------------------------------------------------------------------------

describe("§7: codegen — onclick=fn(arg) does NOT produce W-EVENT-001", () => {
  test("call-ref event handler produces no W-EVENT-001 warning", () => {
    const result = runCGSimple([
      makeMarkupNode("button", [
        {
          name: "onclick",
          value: { kind: "call-ref", name: "handleClick", args: ['"item1"'], span: span(0) },
          span: span(0),
        },
      ], [makeTextNode("Click")]),
    ]);

    const warnings = result.errors.filter(e => e.code === "W-EVENT-001");
    expect(warnings).toHaveLength(0);
  });

  test("call-ref with multiple args produces no W-EVENT-001", () => {
    const result = runCGSimple([
      makeMarkupNode("button", [
        {
          name: "onclick",
          value: { kind: "call-ref", name: "update", args: ['"key"', "42"], span: span(0) },
          span: span(0),
        },
      ], [makeTextNode("Update")]),
    ]);

    const warnings = result.errors.filter(e => e.code === "W-EVENT-001");
    expect(warnings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §8: Codegen — event handler with ${...} expression produces correct JS
// ---------------------------------------------------------------------------

describe("§8: codegen — ${...} event handler wiring in client JS", () => {
  test("arrow fn expression is wired as event handler", () => {
    const result = runCGSimple([
      makeMarkupNode("div", [], [
        makeMarkupNode("button", [
          {
            name: "onclick",
            value: { kind: "expr", raw: "() => deleteItem(42)", refs: [], span: span(0) },
            span: span(0),
          },
        ], [makeTextNode("Delete")]),
      ]),
    ]);

    expect(result.errors).toHaveLength(0);
    const out = result.outputs.get("/test/app.scrml");
    // The expression should appear directly in the wiring
    expect(foldChunkNamespacing(out.clientJs)).toContain("deleteItem(42)");
  });

  test("onclick delegation uses handler registry with expr handler", () => {
    const result = runCGSimple([
      makeMarkupNode("div", [], [
        makeMarkupNode("button", [
          {
            name: "onclick",
            value: { kind: "expr", raw: "() => fn()", refs: [], span: span(0) },
            span: span(0),
          },
        ], [makeTextNode("Test")]),
      ]),
    ]);

    expect(result.errors).toHaveLength(0);
    const out = result.outputs.get("/test/app.scrml");
    // Click is delegable, so should use _scrml_click registry
    expect(foldChunkNamespacing(out.clientJs)).toContain("_scrml_click");
    expect(foldChunkNamespacing(out.clientJs)).toContain("document.addEventListener");
  });

  test("non-delegable event (onchange) with expr uses querySelectorAll path", () => {
    const result = runCGSimple([
      makeMarkupNode("div", [], [
        makeMarkupNode("select", [
          {
            name: "onchange",
            value: { kind: "expr", raw: "(e) => setTheme(e.target.value)", refs: [], span: span(0) },
            span: span(0),
          },
        ], [makeTextNode("Options")]),
      ]),
    ]);

    expect(result.errors).toHaveLength(0);
    const out = result.outputs.get("/test/app.scrml");
    // Change is non-delegable, so should use querySelectorAll
    expect(foldChunkNamespacing(out.clientJs)).toContain("querySelectorAll");
    expect(foldChunkNamespacing(out.clientJs)).toContain("setTheme");
  });
});

// ---------------------------------------------------------------------------
// §9: Codegen — ${...} expression with @var references rewrites reactive gets
// ---------------------------------------------------------------------------

describe("§9: codegen — ${...} with @var references in expr handler", () => {
  test("@var in expression is rewritten to _scrml_reactive_get", () => {
    const result = runCGSimple([
      makeMarkupNode("div", [], [
        makeMarkupNode("button", [
          {
            name: "onclick",
            value: { kind: "expr", raw: "() => save(@draft)", refs: ["draft"], span: span(0) },
            span: span(0),
          },
        ], [makeTextNode("Save")]),
      ]),
    ]);

    expect(result.errors).toHaveLength(0);
    const out = result.outputs.get("/test/app.scrml");
    expect(foldChunkNamespacing(out.clientJs)).toContain('_scrml_reactive_get("draft")');
  });
});
