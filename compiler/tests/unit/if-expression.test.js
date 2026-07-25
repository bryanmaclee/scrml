/**
 * if= expression support — Unit Tests
 *
 * Tests for the full if= expression pipeline: tokenizer → AST builder → codegen.
 * Covers negation, equality, comparison, logical operators, and multi-ref expressions.
 *
 * Coverage:
 *   §1  Tokenizer: ATTR_EXPR emitted for if= quoted string values
 *   §2  Tokenizer: ATTR_EXPR emitted for unquoted negation (if=!@var)
 *   §3  Tokenizer: ATTR_IDENT still emitted for simple if=@var (backward compat)
 *   §4  Tokenizer: other attributes with quoted values still emit ATTR_STRING
 *   §5  AST builder: expr kind produced from ATTR_EXPR token
 *   §6  AST builder: refs extracted from expression
 *   §7  AST builder: backward compat — if=@var still produces variable-ref
 *   §8  emit-html: data-scrml-bind-if placeholder emitted for expr kind
 *   §9  emit-html: registry binding has condExpr + refs for expr kind
 *   §10 emit-event-wiring: subscribes to all refs in expression
 *   §11 emit-event-wiring: compiled expression uses _scrml_reactive_get() substitution
 *   §12 emit-event-wiring: negation — !_scrml_reactive_get("active")
 *   §13 emit-event-wiring: logical AND — both refs subscribed
 *   §14 emit-event-wiring: logical OR — both refs subscribed
 *   §15 emit-event-wiring: backward compat — if=@var still works via varName path
 *   §16 Tokenizer: ATTR_EXPR emitted for unquoted parenthesized if= expressions
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { tokenizeAttributes } from "../../src/tokenizer.js";
import { generateHtml } from "../../src/codegen/emit-html.js";
import { BindingRegistry } from "../../src/codegen/binding-registry.ts";
import { resetVarCounter } from "../../src/codegen/var-counter.ts";
import { runCG } from "../../src/code-generator.js";
import { foldChunkAccessors } from "../helpers/chunk-scope.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function span(start = 0, file = "/test/app.scrml") {
  return { file, start, end: start + 10, line: 1, col: start + 1 };
}

/** Parse a scrml source string and return the attributes of the first non-program markup node. */
function parseAttrs(source) {
  const bsOut = splitBlocks("test.scrml", source);
  const { ast } = buildAST(bsOut);
  // Find a non-program markup node (or any markup node)
  const node = ast.nodes.find(n => n.kind === "markup" && n.tag !== "program")
    ?? ast.nodes.find(n => n.kind === "markup");
  return node ? (node.attrs ?? node.attributes ?? []) : [];
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
  const result = runCG({
    files: [ast],
    routeMap: makeRouteMap(),
    depGraph: makeDepGraph(),
    protectAnalysis: makeProtectAnalysis(),
  });
  // BUG-6 chunk-namespacing: a single-file compile still gets a chunk token, so
  // cell-accessor CALLS emit as the per-chunk wrapper (`_scrml_cs_reactive_get`).
  // These tests pin the pre-rename lowering contract (`_scrml_reactive_get(...)`),
  // so fold the chunk-scope prefix back off the emitted client JS at the read
  // boundary. A surgical fold (only `_scrml_cs_X` -> `_scrml_X`), not an assertion
  // rewrite — it masks nothing else. Chunk-identity has its own coverage in
  // chunk-namespacing.test.js.
  if (result && result.outputs && typeof result.outputs.forEach === "function") {
    for (const [, out] of result.outputs) {
      if (out && typeof out.clientJs === "string") out.clientJs = foldChunkAccessors(out.clientJs);
    }
  }
  return result;
}

/** Build an expr attribute value node (as produced by ast-builder from ATTR_EXPR). */
function exprAttr(name, raw, refs = null) {
  const extractedRefs = refs ?? Array.from(raw.matchAll(/@([A-Za-z_$][A-Za-z0-9_$]*)/g)).map(m => m[1]);
  return {
    name,
    value: { kind: "expr", raw, refs: extractedRefs, span: span(0) },
    span: span(0),
  };
}

/** Build a variable-ref attribute value node (if=@var simple form). */
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
// §1  Tokenizer: ATTR_EXPR emitted for if= quoted string values
// ---------------------------------------------------------------------------

describe("§1: tokenizer emits ATTR_EXPR for if= quoted string values", () => {
  test("if=\"!@active\" emits ATTR_EXPR token", () => {
    const tokens = tokenizeAttributes('<div if="!@active">', 0, 1, 1, "markup");
    const exprTok = tokens.find(t => t.kind === "ATTR_EXPR");

    expect(exprTok).toBeDefined();
    expect(exprTok.text).toBe("!@active");
  });

  test("if=\"@a === 1\" emits ATTR_EXPR", () => {
    const tokens = tokenizeAttributes('<div if="@a === 1">', 0, 1, 1, "markup");
    const exprTok = tokens.find(t => t.kind === "ATTR_EXPR");

    expect(exprTok).toBeDefined();
    expect(exprTok.text).toBe("@a === 1");
  });

  test("if=\"@a && @b\" emits ATTR_EXPR with full expression", () => {
    const tokens = tokenizeAttributes('<div if="@a && @b">', 0, 1, 1, "markup");
    const exprTok = tokens.find(t => t.kind === "ATTR_EXPR");

    expect(exprTok).toBeDefined();
    expect(exprTok.text).toBe("@a && @b");
  });

  test("if=\"@count > 5\" emits ATTR_EXPR", () => {
    const tokens = tokenizeAttributes('<div if="@count > 5">', 0, 1, 1, "markup");
    const exprTok = tokens.find(t => t.kind === "ATTR_EXPR");

    expect(exprTok).toBeDefined();
    expect(exprTok.text).toBe("@count > 5");
  });

  test("if=\"@a || @b\" emits ATTR_EXPR", () => {
    const tokens = tokenizeAttributes('<div if="@a || @b">', 0, 1, 1, "markup");
    const exprTok = tokens.find(t => t.kind === "ATTR_EXPR");

    expect(exprTok).toBeDefined();
    expect(exprTok.text).toBe("@a || @b");
  });

  test("if=\"@val !== 'draft'\" emits ATTR_EXPR", () => {
    const tokens = tokenizeAttributes("<div if=\"@val !== 'draft'\">", 0, 1, 1, "markup");
    const exprTok = tokens.find(t => t.kind === "ATTR_EXPR");

    expect(exprTok).toBeDefined();
    expect(exprTok.text).toBe("@val !== 'draft'");
  });
});

// ---------------------------------------------------------------------------
// §2  Tokenizer: ATTR_EXPR emitted for unquoted negation (if=!@var)
// ---------------------------------------------------------------------------

describe("§2: tokenizer emits ATTR_EXPR for unquoted if=!@var negation", () => {
  test("if=!@active (no quotes) emits ATTR_EXPR", () => {
    const tokens = tokenizeAttributes("<div if=!@active>", 0, 1, 1, "markup");
    const exprTok = tokens.find(t => t.kind === "ATTR_EXPR");

    expect(exprTok).toBeDefined();
    expect(exprTok.text).toBe("!@active");
  });

  test("unquoted negation reads up to tag-close correctly", () => {
    const tokens = tokenizeAttributes("<div if=!@active>", 0, 1, 1, "markup");
    const exprTok = tokens.find(t => t.kind === "ATTR_EXPR");
    const closeTok = tokens.find(t => t.kind === "TAG_CLOSE_GT");

    expect(exprTok.text).toBe("!@active");
    expect(closeTok).toBeDefined();
  });

  test("unquoted negation reads up to space before next attribute", () => {
    const tokens = tokenizeAttributes('<div if=!@active class="foo">', 0, 1, 1, "markup");
    const exprTok = tokens.find(t => t.kind === "ATTR_EXPR");

    expect(exprTok).toBeDefined();
    expect(exprTok.text).toBe("!@active");
  });
});

// ---------------------------------------------------------------------------
// §3  Tokenizer: ATTR_IDENT still emitted for simple if=@var (backward compat)
// ---------------------------------------------------------------------------

describe("§3: tokenizer backward compat — simple if=@var emits ATTR_IDENT", () => {
  test("if=@active (no quotes, simple var) emits ATTR_IDENT", () => {
    const tokens = tokenizeAttributes("<div if=@active>", 0, 1, 1, "markup");
    const identTok = tokens.find(t => t.kind === "ATTR_IDENT");
    const exprTok = tokens.find(t => t.kind === "ATTR_EXPR");

    expect(identTok).toBeDefined();
    expect(identTok.text).toBe("@active");
    expect(exprTok).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// §4  Tokenizer: other attributes with quoted values still emit ATTR_STRING
// ---------------------------------------------------------------------------

describe("§4: non-if= attributes with quoted values still emit ATTR_STRING", () => {
  test("class=\"foo\" emits ATTR_STRING", () => {
    const tokens = tokenizeAttributes('<div class="foo">', 0, 1, 1, "markup");
    const strTok = tokens.find(t => t.kind === "ATTR_STRING");
    const exprTok = tokens.find(t => t.kind === "ATTR_EXPR");

    expect(strTok).toBeDefined();
    expect(strTok.text).toBe("foo");
    expect(exprTok).toBeUndefined();
  });

  test("id=\"my-id\" emits ATTR_STRING not ATTR_EXPR", () => {
    const tokens = tokenizeAttributes('<div id="my-id">', 0, 1, 1, "markup");
    const strTok = tokens.find(t => t.kind === "ATTR_STRING");

    expect(strTok).toBeDefined();
    expect(strTok.text).toBe("my-id");
  });
});

// ---------------------------------------------------------------------------
// §5  AST builder: expr kind produced from ATTR_EXPR token
// ---------------------------------------------------------------------------

describe("§5: AST builder produces expr kind from if= expression", () => {
  test("if=\"!@active\" → attr value kind: expr", () => {
    const attrs = parseAttrs('<div if="!@active">text</>');
    const ifAttr = attrs.find(a => a.name === "if");

    expect(ifAttr).toBeDefined();
    expect(ifAttr.value.kind).toBe("expr");
  });

  test("expr kind has raw field with original expression text", () => {
    const attrs = parseAttrs('<div if="!@active">text</>');
    const ifAttr = attrs.find(a => a.name === "if");

    expect(ifAttr.value.raw).toBe("!@active");
  });

  test("expr kind has refs array", () => {
    const attrs = parseAttrs('<div if="!@active">text</>');
    const ifAttr = attrs.find(a => a.name === "if");

    expect(Array.isArray(ifAttr.value.refs)).toBe(true);
  });

  test("if=\"@a && @b\" → expr kind", () => {
    const attrs = parseAttrs('<div if="@a && @b">text</>');
    const ifAttr = attrs.find(a => a.name === "if");

    expect(ifAttr.value.kind).toBe("expr");
    expect(ifAttr.value.raw).toBe("@a && @b");
  });
});

// ---------------------------------------------------------------------------
// §6  AST builder: refs extracted from expression
// ---------------------------------------------------------------------------

describe("§6: AST builder extracts @var refs from expression", () => {
  test("!@active → refs: ['active']", () => {
    const attrs = parseAttrs('<div if="!@active">text</>');
    const ifAttr = attrs.find(a => a.name === "if");

    expect(ifAttr.value.refs).toEqual(["active"]);
  });

  test("@a && @b → refs: ['a', 'b']", () => {
    const attrs = parseAttrs('<div if="@a && @b">text</>');
    const ifAttr = attrs.find(a => a.name === "if");

    expect(ifAttr.value.refs).toContain("a");
    expect(ifAttr.value.refs).toContain("b");
    expect(ifAttr.value.refs).toHaveLength(2);
  });

  test("@count > 5 → refs: ['count']", () => {
    const attrs = parseAttrs('<div if="@count > 5">text</>');
    const ifAttr = attrs.find(a => a.name === "if");

    expect(ifAttr.value.refs).toEqual(["count"]);
  });

  test("@a || @b → refs: ['a', 'b']", () => {
    const attrs = parseAttrs('<div if="@a || @b">text</>');
    const ifAttr = attrs.find(a => a.name === "if");

    expect(ifAttr.value.refs).toContain("a");
    expect(ifAttr.value.refs).toContain("b");
  });

  test("duplicate @var refs are deduplicated", () => {
    const attrs = parseAttrs('<div if="@x && @x">text</>');
    const ifAttr = attrs.find(a => a.name === "if");

    expect(ifAttr.value.refs).toHaveLength(1);
    expect(ifAttr.value.refs[0]).toBe("x");
  });
});

// ---------------------------------------------------------------------------
// §7  AST builder: backward compat — if=@var still produces variable-ref
// ---------------------------------------------------------------------------

describe("§7: AST builder backward compat — if=@var still produces variable-ref", () => {
  test("if=@active (unquoted simple var) → kind: variable-ref", () => {
    const attrs = parseAttrs("<div if=@active>text</>");
    const ifAttr = attrs.find(a => a.name === "if");

    expect(ifAttr).toBeDefined();
    expect(ifAttr.value.kind).toBe("variable-ref");
    expect(ifAttr.value.name).toBe("@active");
  });
});

// ---------------------------------------------------------------------------
// §8  emit-html: data-scrml-bind-if placeholder emitted for expr kind
// ---------------------------------------------------------------------------

describe("§8: emit-html emits data-scrml-bind-if for expr kind", () => {
  test("expr if= emits data-scrml-bind-if placeholder", () => {
    const node = makeMarkupNode("div", [exprAttr("if", "!@active", ["active"])], [
      { kind: "text", value: "content", span: span(0) }
    ]);
    const errors = [];
    const registry = new BindingRegistry();
    const html = generateHtml([node], errors, false, registry, null);

    // Phase 2c (B1): clean-subtree if= emits <template id="..."> + marker comment.
    expect(html).toContain('<template id="');
    expect(html).toContain("scrml-if-marker:");
    expect(html).not.toContain("data-scrml-bind-if=");
    expect(errors).toHaveLength(0);
  });

  test("if= expr does NOT emit if= as an HTML attribute (invalid HTML)", () => {
    const node = makeMarkupNode("div", [exprAttr("if", "!@active", ["active"])], []);
    const errors = [];
    const registry = new BindingRegistry();
    const html = generateHtml([node], errors, false, registry, null);

    expect(html).not.toContain(' if="');
    expect(html).not.toContain(" if=");
  });
});

// ---------------------------------------------------------------------------
// §9  emit-html: registry binding has condExpr + refs for expr kind
// ---------------------------------------------------------------------------

describe("§9: emit-html registry binding has condExpr + refs", () => {
  test("binding is recorded with isConditionalDisplay = true", () => {
    const node = makeMarkupNode("div", [exprAttr("if", "!@active", ["active"])], []);
    const errors = [];
    const registry = new BindingRegistry();
    generateHtml([node], errors, false, registry, null);

    // Phase 2c: clean-subtree if= registers an isMountToggle binding (was isConditionalDisplay
    // pre-Phase-2c). isConditionalDisplay is only used for the non-clean fallback path.
    const binding = registry.logicBindings.find(b => b.isMountToggle);
    expect(binding).toBeDefined();
    expect(binding.isMountToggle).toBe(true);
    expect(binding.templateId).toBeDefined();
    expect(binding.markerId).toBeDefined();
  });

  test("binding has condExpr with the raw expression text", () => {
    const node = makeMarkupNode("div", [exprAttr("if", "!@active", ["active"])], []);
    const errors = [];
    const registry = new BindingRegistry();
    generateHtml([node], errors, false, registry, null);

    const binding = registry.logicBindings.find(b => b.isMountToggle);
    expect(binding.condExpr).toBe("!@active");
  });

  test("binding has refs array from expression", () => {
    const node = makeMarkupNode("div", [exprAttr("if", "@a && @b", ["a", "b"])], []);
    const errors = [];
    const registry = new BindingRegistry();
    generateHtml([node], errors, false, registry, null);

    const binding = registry.logicBindings.find(b => b.isMountToggle);
    expect(binding.refs).toContain("a");
    expect(binding.refs).toContain("b");
  });
});

// ---------------------------------------------------------------------------
// §10 emit-event-wiring: subscribes to all refs in expression
// ---------------------------------------------------------------------------

describe("§10: emit-event-wiring subscribes to all refs in expression", () => {
  test("@a && @b — subscribes to both 'a' and 'b'", () => {
    const node = makeMarkupNode("div", [exprAttr("if", "@a && @b", ["a", "b"])], [
      { kind: "text", value: "text", span: span(0) }
    ]);
    const result = compile(node);
    const out = result.outputs.get("/test/app.scrml");

    expect(out.clientJs).toContain('_scrml_effect');
  });

  test("!@active — subscribes to 'active'", () => {
    const node = makeMarkupNode("div", [exprAttr("if", "!@active", ["active"])], [
      { kind: "text", value: "text", span: span(0) }
    ]);
    const result = compile(node);
    const out = result.outputs.get("/test/app.scrml");

    expect(out.clientJs).toContain('_scrml_effect');
  });

  test("@count > 5 — subscribes to 'count'", () => {
    const node = makeMarkupNode("div", [exprAttr("if", "@count > 5", ["count"])], [
      { kind: "text", value: "text", span: span(0) }
    ]);
    const result = compile(node);
    const out = result.outputs.get("/test/app.scrml");

    expect(out.clientJs).toContain('_scrml_effect');
  });
});

// ---------------------------------------------------------------------------
// §11 emit-event-wiring: compiled expression uses _scrml_reactive_get() substitution
// ---------------------------------------------------------------------------

describe("§11: emit-event-wiring compiles @var → _scrml_reactive_get('var')", () => {
  test("!@active → !_scrml_reactive_get('active') in wiring", () => {
    const node = makeMarkupNode("div", [exprAttr("if", "!@active", ["active"])], [
      { kind: "text", value: "text", span: span(0) }
    ]);
    const result = compile(node);
    const out = result.outputs.get("/test/app.scrml");

    expect(out.clientJs).toContain('_scrml_reactive_get("active")');
    expect(out.clientJs).toContain('!_scrml_reactive_get("active")');
  });

  test("@a && @b → _scrml_reactive_get('a') && _scrml_reactive_get('b')", () => {
    const node = makeMarkupNode("div", [exprAttr("if", "@a && @b", ["a", "b"])], [
      { kind: "text", value: "text", span: span(0) }
    ]);
    const result = compile(node);
    const out = result.outputs.get("/test/app.scrml");

    expect(out.clientJs).toContain('_scrml_reactive_get("a")');
    expect(out.clientJs).toContain('_scrml_reactive_get("b")');
    expect(out.clientJs).toContain("&&");
  });

  test("clean-subtree if= emits mount/unmount controller (replaces display-toggle for clean subtrees)", () => {
    // Phase 2c: was "conditional display uses el.style.display toggle" pre-Phase-2c.
    // Clean subtrees now emit the mount/unmount controller; the display-toggle
    // assertion is preserved on the non-clean fallback path (see §11 fallback test
    // and event-delegation.test.js for that branch).
    const node = makeMarkupNode("div", [exprAttr("if", "!@active", ["active"])], [
      { kind: "text", value: "text", span: span(0) }
    ]);
    const result = compile(node);
    const out = result.outputs.get("/test/app.scrml");

    expect(out.clientJs).toContain("_scrml_mount_template");
    expect(out.clientJs).toContain("_scrml_unmount_scope");
    expect(out.clientJs).not.toContain("el.style.display");
  });
});

// ---------------------------------------------------------------------------
// §12 emit-event-wiring: negation expression
// ---------------------------------------------------------------------------

describe("§12: negation expression wiring", () => {
  test("if=!@active: element unmounts when active is truthy", () => {
    // Phase 2c: clean-subtree if= mounts/unmounts. The condition expression
    // (!_scrml_reactive_get("active")) is reused verbatim in the controller —
    // truthy → mount, falsy → unmount. The legacy `"none"` literal is gone.
    const node = makeMarkupNode("div", [exprAttr("if", "!@active", ["active"])], [
      { kind: "text", value: "text", span: span(0) }
    ]);
    const result = compile(node);
    const out = result.outputs.get("/test/app.scrml");

    expect(out.clientJs).toContain('!_scrml_reactive_get("active")');
    expect(out.clientJs).toContain("_scrml_unmount_scope");
  });
});

// ---------------------------------------------------------------------------
// §13 emit-event-wiring: logical AND — both refs subscribed
// ---------------------------------------------------------------------------

describe("§13: logical AND — both refs subscribed", () => {
  test("@a && @b — both 'a' and 'b' trigger re-evaluation", () => {
    const node = makeMarkupNode("div", [exprAttr("if", "@a && @b", ["a", "b"])], [
      { kind: "text", value: "text", span: span(0) }
    ]);
    const result = compile(node);
    const out = result.outputs.get("/test/app.scrml");

    // Single effect auto-tracks both refs
    expect(out.clientJs).toContain('_scrml_effect');
  });
});

// ---------------------------------------------------------------------------
// §14 emit-event-wiring: logical OR — both refs subscribed
// ---------------------------------------------------------------------------

describe("§14: logical OR — both refs subscribed", () => {
  test("@a || @b — both 'a' and 'b' trigger re-evaluation", () => {
    const node = makeMarkupNode("div", [exprAttr("if", "@a || @b", ["a", "b"])], [
      { kind: "text", value: "text", span: span(0) }
    ]);
    const result = compile(node);
    const out = result.outputs.get("/test/app.scrml");

    expect(out.clientJs).toContain('_scrml_effect');
    expect(out.clientJs).toContain("||");
  });
});

// ---------------------------------------------------------------------------
// §15 emit-event-wiring: backward compat — if=@var still works via varName path
// ---------------------------------------------------------------------------

describe("§15: backward compat — if=@var still works via variable-ref", () => {
  test("if=@active emits <template>+marker for clean subtrees (Phase 2c B1)", () => {
    // Phase 2c: clean-subtree if=@var compiles to template + marker, NOT
    // data-scrml-bind-if (which is now reserved for the non-clean fallback path).
    const node = makeMarkupNode("div", [varRefAttr("if", "@active")], [
      { kind: "text", value: "text", span: span(0) }
    ]);
    const result = compile(node);
    const out = result.outputs.get("/test/app.scrml");

    expect(out.html).toContain('<template id="');
    expect(out.html).toContain("scrml-if-marker:");
    expect(out.html).not.toContain("data-scrml-bind-if=");
  });

  test("if=@active subscribes to 'active' and uses mount/unmount controller (Phase 2c B1)", () => {
    // Phase 2c: clean-subtree if=@var emits the mount/unmount controller —
    // _scrml_effect remains (subscription mechanism unchanged) but el.style.display
    // is replaced by _scrml_mount_template / _scrml_unmount_scope.
    const node = makeMarkupNode("div", [varRefAttr("if", "@active")], [
      { kind: "text", value: "text", span: span(0) }
    ]);
    const result = compile(node);
    const out = result.outputs.get("/test/app.scrml");

    expect(out.clientJs).toContain("_scrml_effect");
    expect(out.clientJs).toContain("_scrml_mount_template");
    expect(out.clientJs).not.toContain("el.style.display");
  });

  test("if=@active wiring uses _scrml_reactive_get('active')", () => {
    const node = makeMarkupNode("div", [varRefAttr("if", "@active")], [
      { kind: "text", value: "text", span: span(0) }
    ]);
    const result = compile(node);
    const out = result.outputs.get("/test/app.scrml");

    expect(out.clientJs).toContain('_scrml_reactive_get("active")');
  });
});

// ---------------------------------------------------------------------------
// §16 Tokenizer: ATTR_EXPR emitted for unquoted parenthesized if= expressions
// ---------------------------------------------------------------------------

describe("§16: tokenizer emits ATTR_EXPR for unquoted parenthesized if= expressions", () => {
  test('if=(@state === "loading") emits ATTR_EXPR', () => {
    const tokens = tokenizeAttributes('<div if=(@state === "loading")>', 0, 1, 1, "markup");
    const exprTok = tokens.find(t => t.kind === "ATTR_EXPR");

    expect(exprTok).toBeDefined();
    expect(exprTok.text).toBe('(@state === "loading")');
  });

  test("if=(@count > 0) emits ATTR_EXPR", () => {
    const tokens = tokenizeAttributes("<div if=(@count > 0)>", 0, 1, 1, "markup");
    const exprTok = tokens.find(t => t.kind === "ATTR_EXPR");

    expect(exprTok).toBeDefined();
    expect(exprTok.text).toBe("(@count > 0)");
  });

  test("if=(@a && @b) emits ATTR_EXPR", () => {
    const tokens = tokenizeAttributes("<div if=(@a && @b)>", 0, 1, 1, "markup");
    const exprTok = tokens.find(t => t.kind === "ATTR_EXPR");

    expect(exprTok).toBeDefined();
    expect(exprTok.text).toBe("(@a && @b)");
  });

  test("if=((@a || @b) && @c) — nested parens — emits ATTR_EXPR with full expression", () => {
    const tokens = tokenizeAttributes("<div if=((@a || @b) && @c)>", 0, 1, 1, "markup");
    const exprTok = tokens.find(t => t.kind === "ATTR_EXPR");

    expect(exprTok).toBeDefined();
    expect(exprTok.text).toBe("((@a || @b) && @c)");
  });

  test("parenthesized if= followed by another attribute reads only the expression", () => {
    const tokens = tokenizeAttributes('<div if=(@state === "loading") class="foo">', 0, 1, 1, "markup");
    const exprTok = tokens.find(t => t.kind === "ATTR_EXPR");
    const strToks = tokens.filter(t => t.kind === "ATTR_STRING");

    expect(exprTok).toBeDefined();
    expect(exprTok.text).toBe('(@state === "loading")');
    // class="foo" must still be captured as ATTR_STRING
    expect(strToks.length).toBeGreaterThanOrEqual(1);
    expect(strToks.some(t => t.text === "foo")).toBe(true);
  });

  test('if=(@state === "loading") → AST builder produces expr kind', () => {
    const attrs = parseAttrs('<div if=(@state === "loading")>text</>');
    const ifAttr = attrs.find(a => a.name === "if");

    expect(ifAttr).toBeDefined();
    expect(ifAttr.value.kind).toBe("expr");
  });

  test('if=(@state === "loading") → AST builder extracts refs: ["state"]', () => {
    const attrs = parseAttrs('<div if=(@state === "loading")>text</>');
    const ifAttr = attrs.find(a => a.name === "if");

    expect(ifAttr).toBeDefined();
    expect(ifAttr.value.refs).toContain("state");
  });

  // -------------------------------------------------------------------------
  // §17 — Unquoted if=@obj.prop (property access)
  // -------------------------------------------------------------------------

  test("if=@obj.prop — tokenizer emits ATTR_IDENT for dotted var ref", () => {
    const tokens = tokenizeAttributes("<div if=@obj.prop>", 0, 1, 1, "markup");
    const identTok = tokens.find(t => t.kind === "ATTR_IDENT");
    expect(identTok).toBeDefined();
    expect(identTok.text).toBe("@obj.prop");
  });

  test("if=@obj.prop — AST builder produces variable-ref with dotPath", () => {
    const attrs = parseAttrs("<div if=@obj.prop>text</>");
    const ifAttr = attrs.find(a => a.name === "if");
    expect(ifAttr).toBeDefined();
    expect(ifAttr.value.kind).toBe("variable-ref");
    const name = ifAttr.value.name ?? ifAttr.value.dotPath?.join(".") ?? "";
    expect(name).toContain("obj");
  });

  test("if=@obj.prop — emit-html generates <template>+marker for clean subtree (Phase 2c B1)", () => {
    // Phase 2c: dot-path variable-ref still passes the cleanliness gate; emits
    // template + marker instead of data-scrml-bind-if. The dotPath is preserved
    // on the binding for the controller's _scrml_reactive_get(...).<path> lookup.
    const attrs = parseAttrs("<div if=@obj.prop>text</>");
    const ifAttr = attrs.find(a => a.name === "if");
    const registry = new BindingRegistry();
    const node = makeMarkupNode("div", [ifAttr], []);
    const fileAST = makeFileAST([node]);
    resetVarCounter();
    const html = generateHtml(fileAST.nodes, [], false, registry, fileAST);
    expect(html).toContain('<template id="');
    expect(html).toContain("scrml-if-marker:");
    const binding = registry.logicBindings.find(b => b.isMountToggle);
    expect(binding).toBeDefined();
    expect(binding.dotPath).toBe("obj.prop");
    expect(binding.varName).toBe("obj");
  });

  test("if=@user.loggedIn — property access on reactive var is valid", () => {
    const attrs = parseAttrs("<div if=@user.loggedIn>text</>");
    const ifAttr = attrs.find(a => a.name === "if");
    expect(ifAttr).toBeDefined();
    expect(ifAttr.value.kind).toBe("variable-ref");
  });

  test("if=@settings.darkMode — another property access pattern", () => {
    const attrs = parseAttrs("<div if=@settings.darkMode>text</>");
    const ifAttr = attrs.find(a => a.name === "if");
    expect(ifAttr).toBeDefined();
  });

  test("if=@form.isValid — form validation pattern", () => {
    const attrs = parseAttrs("<div if=@form.isValid>text</>");
    const ifAttr = attrs.find(a => a.name === "if");
    expect(ifAttr).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // §18 — Quoted if="@obj.prop" (property access in expression)
  // -------------------------------------------------------------------------

  test('if="@obj.prop" — tokenizer emits ATTR_EXPR', () => {
    const tokens = tokenizeAttributes('<div if="@obj.prop">', 0, 1, 1, "markup");
    const exprTok = tokens.find(t => t.kind === "ATTR_EXPR");
    expect(exprTok).toBeDefined();
    expect(exprTok.text).toBe("@obj.prop");
  });

  test('if="@obj.prop" — AST builder produces expr kind with refs=["obj"]', () => {
    const attrs = parseAttrs('<div if="@obj.prop">text</>');
    const ifAttr = attrs.find(a => a.name === "if");
    expect(ifAttr).toBeDefined();
    expect(ifAttr.value.kind).toBe("expr");
    expect(ifAttr.value.refs).toContain("obj");
  });

  test('if="!@obj.prop" — negated property access', () => {
    const attrs = parseAttrs('<div if="!@obj.prop">text</>');
    const ifAttr = attrs.find(a => a.name === "if");
    expect(ifAttr).toBeDefined();
    expect(ifAttr.value.kind).toBe("expr");
    expect(ifAttr.value.refs).toContain("obj");
  });

  test('if="@obj.prop === true" — comparison with property access', () => {
    const attrs = parseAttrs('<div if="@obj.prop === true">text</>');
    const ifAttr = attrs.find(a => a.name === "if");
    expect(ifAttr).toBeDefined();
    expect(ifAttr.value.kind).toBe("expr");
  });

  test('if="@user.role === \'admin\'" — string comparison with property', () => {
    const attrs = parseAttrs('<div if="@user.role === \'admin\'">text</>');
    const ifAttr = attrs.find(a => a.name === "if");
    expect(ifAttr).toBeDefined();
    expect(ifAttr.value.kind).toBe("expr");
    expect(ifAttr.value.refs).toContain("user");
  });

  // -------------------------------------------------------------------------
  // §19 — Deep property paths
  // -------------------------------------------------------------------------

  test("if=@obj.prop.nested — deep path produces variable-ref", () => {
    const attrs = parseAttrs("<div if=@obj.prop.nested>text</>");
    const ifAttr = attrs.find(a => a.name === "if");
    expect(ifAttr).toBeDefined();
    expect(ifAttr.value.kind).toBe("variable-ref");
    const name = ifAttr.value.name ?? "";
    expect(name).toContain("obj");
  });

  test('if="@obj.prop.nested" — deep path in quoted expr', () => {
    const attrs = parseAttrs('<div if="@obj.prop.nested">text</>');
    const ifAttr = attrs.find(a => a.name === "if");
    expect(ifAttr).toBeDefined();
    expect(ifAttr.value.kind).toBe("expr");
    expect(ifAttr.value.refs).toContain("obj");
  });

  test("if=@a.b.c.d — four-level deep path", () => {
    const attrs = parseAttrs("<div if=@a.b.c.d>text</>");
    const ifAttr = attrs.find(a => a.name === "if");
    expect(ifAttr).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // §20 — Multi-property access in expressions
  // -------------------------------------------------------------------------

  test('if="@user.loggedIn && @user.verified" — deduplicates refs to ["user"]', () => {
    const attrs = parseAttrs('<div if="@user.loggedIn && @user.verified">text</>');
    const ifAttr = attrs.find(a => a.name === "if");
    expect(ifAttr).toBeDefined();
    expect(ifAttr.value.kind).toBe("expr");
    expect(ifAttr.value.refs).toContain("user");
    const userRefs = ifAttr.value.refs.filter(r => r === "user");
    expect(userRefs.length).toBe(1);
  });

  test('if="@user.name && @settings.theme" — two different base vars', () => {
    const attrs = parseAttrs('<div if="@user.name && @settings.theme">text</>');
    const ifAttr = attrs.find(a => a.name === "if");
    expect(ifAttr).toBeDefined();
    expect(ifAttr.value.refs).toContain("user");
    expect(ifAttr.value.refs).toContain("settings");
  });

  test('if="@cart.items.length > 0" — property chain with comparison', () => {
    const attrs = parseAttrs('<div if="@cart.items.length > 0">text</>');
    const ifAttr = attrs.find(a => a.name === "if");
    expect(ifAttr).toBeDefined();
    expect(ifAttr.value.refs).toContain("cart");
  });

  test('if="@form.email && @form.password && @form.agreed" — three property accesses', () => {
    const attrs = parseAttrs('<div if="@form.email && @form.password && @form.agreed">text</>');
    const ifAttr = attrs.find(a => a.name === "if");
    expect(ifAttr).toBeDefined();
    expect(ifAttr.value.refs).toContain("form");
    const formRefs = ifAttr.value.refs.filter(r => r === "form");
    expect(formRefs.length).toBe(1);
  });
});
