/**
 * allow-atvar-in-attrs — Unit Tests
 *
 * Tests that @var syntax is accepted in attribute values across the full
 * pipeline: tokenizer → AST builder → codegen.
 *
 * Coverage:
 *   §1  show=@count produces data-scrml-bind-show placeholder (Phase 1 — visibility-toggle directive)
 *   §2  if=@visible compiles correctly (produces data-scrml-bind-if)
 *   §3  show=count (no @) still produces literal HTML attribute (no regression)
 *   §4  bind:value=@var still works (no regression)
 *   §5  Tokenizer accepts @ in attribute values
 *   §6  AST builder preserves @ in variable-ref name
 *   §7  Multiple @-prefixed attributes on same element
 *   §8  @-prefixed attribute with dotted path (show=@obj.field, if=@user.loggedIn)
 *
 * Phase 1 (2026-04-29): show=@var is now a reactive visibility-toggle directive.
 * Previously show=@var was treated as a generic HTML attribute (@ stripped).
 * Generic attributes other than if=/show= still strip @ (e.g., title=@name).
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { tokenizeAttributes } from "../../src/tokenizer.js";
import { generateHtml } from "../../src/codegen/emit-html.js";
import { BindingRegistry } from "../../src/codegen/binding-registry.ts";
import { resetVarCounter } from "../../src/codegen/var-counter.ts";
import { runCG } from "../../src/code-generator.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function span(start = 0, file = "/test/app.scrml") {
  return { file, start, end: start + 10, line: 1, col: start + 1 };
}

/** Parse a scrml source string and return { attrs, errors }. */
function parseSource(source) {
  const bsOut = splitBlocks("test.scrml", source);
  const result = buildAST(bsOut);
  const node = result.ast.nodes.find(n => n.kind === "markup" && n.tag !== "program")
    ?? result.ast.nodes.find(n => n.kind === "markup");
  const attrs = node ? (node.attrs ?? node.attributes ?? []) : [];
  return { attrs, errors: result.errors ?? [] };
}

/** Build a markup AST node with given attributes. */
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

function makeFileAST(nodes) {
  return {
    filePath: "/test/app.scrml",
    nodes,
    imports: [],
    exports: [],
    components: [],
    typeDecls: [],
    nodeTypes: new Map(),
    componentShapes: new Map(),
    scopeChain: null,
  };
}

function makeRouteMap() { return { functions: new Map() }; }
function makeDepGraph() { return { nodes: new Map(), edges: [] }; }
function makeProtectAnalysis() { return { views: new Map() }; }

/** Compile a single markup node through the full CG pipeline. */
function compile(markupNode) {
  const ast = makeFileAST([markupNode]);
  return runCG({
    files: [ast],
    routeMap: makeRouteMap(),
    depGraph: makeDepGraph(),
    protectAnalysis: makeProtectAnalysis(),
  });
}

/** Build a variable-ref attribute value node. */
function varRefAttr(name, varName) {
  return {
    name,
    value: { kind: "variable-ref", name: varName, span: span(0) },
    span: span(0),
  };
}

beforeEach(() => {
  resetVarCounter();
});

// ---------------------------------------------------------------------------
// §1  show=@count produces data-scrml-bind-show placeholder
// ---------------------------------------------------------------------------

describe("§1: show=@count produces data-scrml-bind-show", () => {
  test("tokenizer accepts show=@count", () => {
    const tokens = tokenizeAttributes("<div show=@count>", 0, 1, 1, "markup");
    const identTok = tokens.find(t => t.kind === "ATTR_IDENT");
    expect(identTok).toBeDefined();
    expect(identTok.text).toBe("@count");
  });

  test("AST builder produces variable-ref for show=@count", () => {
    const { attrs, errors } = parseSource("<div show=@count>text</>");
    const showAttr = attrs.find(a => a.name === "show");
    expect(showAttr).toBeDefined();
    expect(showAttr.value.kind).toBe("variable-ref");
    expect(showAttr.value.name).toBe("@count");
    // No errors for @ in attribute value
    const attrErrors = errors.filter(e => e.code && e.code.startsWith("E-ATTR"));
    expect(attrErrors).toHaveLength(0);
  });

  test("codegen produces data-scrml-bind-show for reactive show=@count", () => {
    const node = makeMarkupNode("div", [varRefAttr("show", "@count")], [
      { kind: "text", value: "text", span: span(0) }
    ]);
    const result = compile(node);
    const out = result.outputs.get("/test/app.scrml");
    // Phase 1: show=@var is a reactive visibility-toggle directive
    expect(out.html).toContain("data-scrml-bind-show=");
    // No literal show="count" attribute — the @ form is reactive
    expect(out.html).not.toContain('show="count"');
  });
});

// ---------------------------------------------------------------------------
// §2  if=@visible compiles correctly (produces data-scrml-bind-if)
// ---------------------------------------------------------------------------

describe("§2: if=@visible compiles correctly", () => {
  test("if=@visible produces <template>+marker for clean subtrees (Phase 2c B1)", () => {
    // Phase 2c: clean-subtree if=@var emits template + marker instead of
    // data-scrml-bind-if. The placeholder mechanism shifts from a DOM attribute
    // to a comment marker that _scrml_mount_template / _scrml_unmount_scope locate.
    const node = makeMarkupNode("div", [varRefAttr("if", "@visible")], [
      { kind: "text", value: "text", span: span(0) }
    ]);
    const result = compile(node);
    const out = result.outputs.get("/test/app.scrml");
    expect(out.html).toContain('<template id="');
    expect(out.html).toContain("scrml-if-marker:");
    expect(out.html).not.toContain("data-scrml-bind-if=");
  });

  test("if=@visible wires reactive subscription via mount/unmount controller (Phase 2c B1)", () => {
    // Phase 2c: clean-subtree if=@var emits the mount/unmount controller. The
    // _scrml_effect subscription is preserved; el.style.display is replaced by
    // _scrml_mount_template / _scrml_unmount_scope.
    const node = makeMarkupNode("div", [varRefAttr("if", "@visible")], [
      { kind: "text", value: "text", span: span(0) }
    ]);
    const result = compile(node);
    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).toContain("_scrml_effect(");
    expect(out.clientJs).toContain("_scrml_mount_template");
    expect(out.clientJs).not.toContain("el.style.display");
  });

  test("if=@visible does not strip the @ prefix (Phase 2c emits <template>+marker)", () => {
    // Phase 2c: clean-subtree if=@var emits template + marker. The original
    // assertion (no leaked literal `if="visible"` HTML attribute) still holds —
    // the @-prefixed reactive form must NEVER produce a literal HTML attribute.
    const node = makeMarkupNode("span", [varRefAttr("if", "@visible")], [
      { kind: "text", value: "shown", span: span(0) }
    ]);
    const result = compile(node);
    const out = result.outputs.get("/test/app.scrml");
    expect(out.html).not.toContain('if="visible"');
    expect(out.html).toContain('<template id="');
    expect(out.html).toContain("scrml-if-marker:");
  });
});

// ---------------------------------------------------------------------------
// §3  show=count still works (no regression)
// ---------------------------------------------------------------------------

describe("§3: show=count (no @) still produces literal HTML attribute", () => {
  test("show=count (no @) produces show=\"count\" literal", () => {
    const node = makeMarkupNode("div", [varRefAttr("show", "count")], [
      { kind: "text", value: "text", span: span(0) }
    ]);
    const result = compile(node);
    const out = result.outputs.get("/test/app.scrml");
    expect(out.html).toContain('show="count"');
    // No reactive placeholder — non-@ form is still literal
    expect(out.html).not.toContain("data-scrml-bind-show");
  });

  test("show=@count (reactive) and show=count (literal) produce DIFFERENT output", () => {
    // With @ — reactive visibility-toggle
    const nodeWith = makeMarkupNode("div", [varRefAttr("show", "@count")], [
      { kind: "text", value: "a", span: span(0) }
    ]);
    const resultWith = compile(nodeWith);
    const htmlWith = resultWith.outputs.get("/test/app.scrml").html;
    expect(htmlWith).toContain("data-scrml-bind-show=");

    resetVarCounter();

    // Without @ — literal HTML attribute
    const nodeWithout = makeMarkupNode("div", [varRefAttr("show", "count")], [
      { kind: "text", value: "a", span: span(0) }
    ]);
    const resultWithout = compile(nodeWithout);
    const htmlWithout = resultWithout.outputs.get("/test/app.scrml").html;
    expect(htmlWithout).toContain('show="count"');
    expect(htmlWithout).not.toContain("data-scrml-bind-show");

    // Phase 1: these are now distinct directives
    expect(htmlWith).not.toBe(htmlWithout);
  });
});

// ---------------------------------------------------------------------------
// §4  bind:value=@var still works (no regression)
// ---------------------------------------------------------------------------

describe("§4: bind:value=@var still works (no regression)", () => {
  test("bind:value=@name produces data-scrml-bind-value", () => {
    const node = makeMarkupNode("input", [
      { name: "bind:value", value: { kind: "variable-ref", name: "@name" }, span: span(0) }
    ], [], { selfClosing: true });
    const result = compile(node);
    const out = result.outputs.get("/test/app.scrml");
    // bind: attributes are handled separately (before the variable-ref path)
    expect(out.html).toContain("data-scrml-bind-value=");
  });

  test("bind:checked=@agreed produces data-scrml-bind-checked", () => {
    const node = makeMarkupNode("input", [
      { name: "type", value: { kind: "string-literal", value: "checkbox" }, span: span(0) },
      { name: "bind:checked", value: { kind: "variable-ref", name: "@agreed" }, span: span(0) }
    ], [], { selfClosing: true });
    const result = compile(node);
    const out = result.outputs.get("/test/app.scrml");
    expect(out.html).toContain("data-scrml-bind-checked=");
  });
});

// ---------------------------------------------------------------------------
// §5  Tokenizer accepts @ in attribute values
// ---------------------------------------------------------------------------

describe("§5: tokenizer accepts @ in attribute values", () => {
  test("@myVar produces ATTR_IDENT with @ prefix", () => {
    const tokens = tokenizeAttributes("<div data-x=@myVar>", 0, 1, 1, "markup");
    const identTok = tokens.find(t => t.kind === "ATTR_IDENT");
    expect(identTok).toBeDefined();
    expect(identTok.text).toBe("@myVar");
  });

  test("@ at start of value does not produce ATTR_EXPR", () => {
    const tokens = tokenizeAttributes("<div show=@count>", 0, 1, 1, "markup");
    const exprTok = tokens.find(t => t.kind === "ATTR_EXPR");
    expect(exprTok).toBeUndefined();
  });

  test("@dotted.path tokenizes as single ATTR_IDENT", () => {
    const tokens = tokenizeAttributes("<div show=@obj.field>", 0, 1, 1, "markup");
    const identTok = tokens.find(t => t.kind === "ATTR_IDENT");
    expect(identTok).toBeDefined();
    expect(identTok.text).toBe("@obj.field");
  });
});

// ---------------------------------------------------------------------------
// §6  AST builder preserves @ in variable-ref name
// ---------------------------------------------------------------------------

describe("§6: AST builder preserves @ in variable-ref name", () => {
  test("show=@count creates variable-ref with name @count", () => {
    const { attrs } = parseSource("<div show=@count>text</>");
    const attr = attrs.find(a => a.name === "show");
    expect(attr.value.kind).toBe("variable-ref");
    expect(attr.value.name).toBe("@count");
  });

  test("if=@visible creates variable-ref with name @visible", () => {
    const { attrs } = parseSource("<div if=@visible>text</>");
    const attr = attrs.find(a => a.name === "if");
    expect(attr.value.kind).toBe("variable-ref");
    expect(attr.value.name).toBe("@visible");
  });

  test("no E-ATTR errors for @-prefixed regular attribute values", () => {
    const { errors } = parseSource("<div show=@count title=@name>text</>");
    const attrErrors = errors.filter(e => e.code && e.code.startsWith("E-ATTR"));
    expect(attrErrors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §7  Multiple @-prefixed attributes on same element
// ---------------------------------------------------------------------------

describe("§7: multiple @-prefixed attributes on same element", () => {
  test("show=@x reactive, title=@y strips @ to literal", () => {
    const node = makeMarkupNode("div", [
      varRefAttr("show", "@x"),
      varRefAttr("title", "@y"),
    ], [
      { kind: "text", value: "text", span: span(0) }
    ]);
    const result = compile(node);
    const out = result.outputs.get("/test/app.scrml");
    // show= is a directive — reactive placeholder
    expect(out.html).toContain("data-scrml-bind-show=");
    // title= is a generic HTML attribute — @ stripped to literal
    expect(out.html).toContain('title="y"');
  });

  // Phase 2 finish (S301) — both are still reactive, but they lower DIFFERENTLY
  // now, which is the §17.2 contract: "show= hides, if= removes". `if=` becomes a
  // template + marker mount controller; `show=` keeps its display placeholder,
  // emitted INSIDE the template so it binds when the subtree mounts.
  test("if=@visible + show=@count — if= mounts, show= toggles display", () => {
    const node = makeMarkupNode("div", [
      varRefAttr("if", "@visible"),
      varRefAttr("show", "@count"),
    ], [
      { kind: "text", value: "text", span: span(0) }
    ]);
    const result = compile(node);
    const out = result.outputs.get("/test/app.scrml");
    expect(out.html).not.toContain("data-scrml-bind-if=");
    expect(out.html).toContain("scrml-if-marker:");
    expect(out.html).toContain("data-scrml-bind-show=");
    // Neither is a literal HTML attribute
    expect(out.html).not.toContain('show="count"');
    expect(out.html).not.toContain('if="visible"');
  });
});

// ---------------------------------------------------------------------------
// §8  @-prefixed attribute with dotted path (show=@obj.field)
// ---------------------------------------------------------------------------

describe("§8: @-prefixed attribute with dotted path", () => {
  test("show=@obj.field produces data-scrml-bind-show with reactive dot-path", () => {
    const node = makeMarkupNode("div", [varRefAttr("show", "@obj.field")], [
      { kind: "text", value: "text", span: span(0) }
    ]);
    const result = compile(node);
    const out = result.outputs.get("/test/app.scrml");
    // Phase 1: show= is a directive; dot-paths route through reactive binding
    expect(out.html).toContain("data-scrml-bind-show=");
    expect(out.html).not.toContain('show="obj.field"');
  });

  test("if=@user.loggedIn keeps @ behavior (reactive binding via Phase 2c B1)", () => {
    // Phase 2c: dot-path variable-ref passes the cleanliness gate. Emits
    // template + marker; the `if="user.loggedIn"` literal-HTML attribute
    // must still NEVER leak (the original guarantee).
    const node = makeMarkupNode("div", [varRefAttr("if", "@user.loggedIn")], [
      { kind: "text", value: "text", span: span(0) }
    ]);
    const result = compile(node);
    const out = result.outputs.get("/test/app.scrml");
    expect(out.html).toContain('<template id="');
    expect(out.html).toContain("scrml-if-marker:");
    expect(out.html).not.toContain('if="user.loggedIn"');
  });
});
