/**
 * Template Literal Attribute Interpolation — Unit Tests
 *
 * Tests for the fix that enables `${...}` expressions inside quoted attribute values
 * to be compiled to dynamic runtime wiring rather than emitted as literal strings.
 *
 * Coverage:
 *   §1  hasTemplateInterpolation — detects ${...} in string values
 *   §2  rewriteTemplateAttrValue — single reactive interpolation
 *   §3  rewriteTemplateAttrValue — non-reactive interpolation (no @)
 *   §4  rewriteTemplateAttrValue — multiple interpolations, mixed reactive/non-reactive
 *   §5  rewriteTemplateAttrValue — prefix and suffix text around interpolation
 *   §6  rewriteTemplateAttrValue — backtick escaping in literal text
 *   §7  rewriteTemplateAttrValue — multiple reactive vars (multiple subscriptions)
 *   §8  HTML output — template-attr emits placeholder data attribute
 *   §9  HTML output — static string attr (no ${}) emits as before
 *   §10 HTML output — template-attr class="item-${@status}" correct placeholder shape
 *   §11 Client JS — setAttribute called with interpolated template literal
 *   §12 Client JS — reactive subscription wired for @var in interpolation
 *   §13 Client JS — non-reactive ${expr} does not produce subscription
 *   §14 Client JS — multiple @var refs produce multiple subscriptions
 *   §15 End-to-end — class="item-${@status}" produces correct HTML + JS
 *   §16 End-to-end — class="foo-${a}-bar-${@isActive}" mixed reactive/non-reactive
 *   §17 End-to-end — attribute other than class (e.g. data-id="item-${@id}")
 *   §18 End-to-end — multiple elements each with template-attr
 *   §19 Edge case — empty interpolation ${} handled without crash
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { runCG, CGError } from "../../src/code-generator.js";
import { generateHtml } from "../../src/codegen/emit-html.js";
import { emitBindings } from "../../src/codegen/emit-bindings.ts";
import { hasTemplateInterpolation, rewriteTemplateAttrValue } from "../../src/codegen/rewrite.js";
import { resetVarCounter } from "../../src/codegen/var-counter.ts";
import { foldChunkNamespacing } from "../helpers/chunk-scope.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function strAttr(attrName, value) {
  return {
    name: attrName,
    value: { kind: "string-literal", value },
    span: span(0),
  };
}

function makeRouteMap() {
  return { functions: new Map() };
}

function makeDepGraph() {
  return { nodes: new Map(), edges: [] };
}

function makeProtectAnalysis() {
  return { views: new Map() };
}

beforeEach(() => {
  resetVarCounter();
});

// ---------------------------------------------------------------------------
// §1 hasTemplateInterpolation
// ---------------------------------------------------------------------------

describe("§1 hasTemplateInterpolation", () => {
  test("returns true when value contains ${", () => {
    expect(hasTemplateInterpolation("item-${@status}")).toBe(true);
  });

  test("returns true for multiple interpolations", () => {
    expect(hasTemplateInterpolation("${@a}-${@b}")).toBe(true);
  });

  test("returns false for plain string with no interpolation", () => {
    expect(hasTemplateInterpolation("item-active")).toBe(false);
  });

  test("returns false for empty string", () => {
    expect(hasTemplateInterpolation("")).toBe(false);
  });

  test("returns false for null", () => {
    expect(hasTemplateInterpolation(null)).toBe(false);
  });

  test("returns false for $ without {", () => {
    expect(hasTemplateInterpolation("item-$status")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §2 rewriteTemplateAttrValue — single reactive interpolation
// ---------------------------------------------------------------------------

describe("§2 rewriteTemplateAttrValue — single reactive ref", () => {
  test("rewrites @var to _scrml_reactive_get", () => {
    const { jsExpr, reactiveVars } = rewriteTemplateAttrValue("item-${@status}");
    expect(jsExpr).toBe("`item-${_scrml_reactive_get(\"status\")}`");
    expect(reactiveVars.size).toBe(1);
    expect(reactiveVars.has("status")).toBe(true);
  });

  test("plain prefix preserved", () => {
    const { jsExpr } = rewriteTemplateAttrValue("prefix-${@myVar}");
    expect(jsExpr).toBe("`prefix-${_scrml_reactive_get(\"myVar\")}`");
  });

  test("plain suffix preserved", () => {
    const { jsExpr } = rewriteTemplateAttrValue("${@myVar}-suffix");
    expect(jsExpr).toBe("`${_scrml_reactive_get(\"myVar\")}-suffix`");
  });
});

// ---------------------------------------------------------------------------
// §3 rewriteTemplateAttrValue — non-reactive interpolation (no @)
// ---------------------------------------------------------------------------

describe("§3 rewriteTemplateAttrValue — non-reactive interpolation", () => {
  test("non-reactive ${expr} passes through unchanged", () => {
    const { jsExpr, reactiveVars } = rewriteTemplateAttrValue("item-${idx}");
    expect(jsExpr).toBe("`item-${idx}`");
    expect(reactiveVars.size).toBe(0);
  });

  test("non-reactive method call passes through", () => {
    const { jsExpr, reactiveVars } = rewriteTemplateAttrValue("item-${getClass()}");
    expect(jsExpr).toBe("`item-${getClass()}`");
    expect(reactiveVars.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §4 rewriteTemplateAttrValue — multiple interpolations
// ---------------------------------------------------------------------------

describe("§4 rewriteTemplateAttrValue — multiple interpolations", () => {
  test("two reactive vars both rewritten and collected", () => {
    const { jsExpr, reactiveVars } = rewriteTemplateAttrValue("${@a}-${@b}");
    expect(jsExpr).toBe("`${_scrml_reactive_get(\"a\")}-${_scrml_reactive_get(\"b\")}`");
    expect(reactiveVars.size).toBe(2);
    expect(reactiveVars.has("a")).toBe(true);
    expect(reactiveVars.has("b")).toBe(true);
  });

  test("mixed reactive and non-reactive", () => {
    const { jsExpr, reactiveVars } = rewriteTemplateAttrValue("foo-${idx}-bar-${@isActive}");
    expect(jsExpr).toBe("`foo-${idx}-bar-${_scrml_reactive_get(\"isActive\")}`");
    expect(reactiveVars.size).toBe(1);
    expect(reactiveVars.has("isActive")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §5 rewriteTemplateAttrValue — prefix and suffix text
// ---------------------------------------------------------------------------

describe("§5 rewriteTemplateAttrValue — surrounding literal text", () => {
  test("text before and after single interpolation", () => {
    const { jsExpr } = rewriteTemplateAttrValue("card card-${@variant} selected");
    expect(jsExpr).toBe("`card card-${_scrml_reactive_get(\"variant\")} selected`");
  });

  test("no prefix or suffix — just an interpolation", () => {
    const { jsExpr, reactiveVars } = rewriteTemplateAttrValue("${@status}");
    expect(jsExpr).toBe("`${_scrml_reactive_get(\"status\")}`");
    expect(reactiveVars.has("status")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §6 rewriteTemplateAttrValue — backtick escaping
// ---------------------------------------------------------------------------

describe("§6 rewriteTemplateAttrValue — backtick escaping", () => {
  test("backtick in literal text is escaped", () => {
    // Source: foo`bar-${@x}  (backtick in literal part)
    const { jsExpr } = rewriteTemplateAttrValue("foo`bar-${@x}");
    expect(jsExpr).toBe("`foo\\`bar-${_scrml_reactive_get(\"x\")}`");
  });
});

// ---------------------------------------------------------------------------
// §7 rewriteTemplateAttrValue — multiple reactive vars
// ---------------------------------------------------------------------------

describe("§7 rewriteTemplateAttrValue — multiple reactive vars", () => {
  test("three reactive vars all collected", () => {
    const { reactiveVars } = rewriteTemplateAttrValue("${@a}-${@b}-${@c}");
    expect(reactiveVars.size).toBe(3);
    expect(reactiveVars.has("a")).toBe(true);
    expect(reactiveVars.has("b")).toBe(true);
    expect(reactiveVars.has("c")).toBe(true);
  });

  test("same reactive var referenced twice — collected once (Set)", () => {
    const { reactiveVars } = rewriteTemplateAttrValue("${@x}-${@x}");
    expect(reactiveVars.size).toBe(1);
    expect(reactiveVars.has("x")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §8 HTML output — template-attr emits placeholder data attribute
// ---------------------------------------------------------------------------

describe("§8 HTML output — template-attr placeholder emission", () => {
  test("string-literal attr with ${} emits data-scrml-attr-tpl-<name>", () => {
    const nodes = [makeMarkupNode("div", [strAttr("class", "item-${@status}")])];
    const html = generateHtml(nodes, [], false, null, null);
    expect(html).toContain(`data-scrml-attr-tpl-class="`);
  });

  test("template-attr placeholder sets class to empty string initially", () => {
    const nodes = [makeMarkupNode("div", [strAttr("class", "item-${@status}")])];
    const html = generateHtml(nodes, [], false, null, null);
    expect(html).toMatch(/class=""\s+data-scrml-attr-tpl-class=/);
  });

  test("template-attr does not emit the raw ${@var} string in HTML", () => {
    const nodes = [makeMarkupNode("div", [strAttr("class", "item-${@status}")])];
    const html = generateHtml(nodes, [], false, null, null);
    expect(html).not.toContain("item-${@status}");
    expect(html).not.toContain("${@status}");
  });
});

// ---------------------------------------------------------------------------
// §9 HTML output — static string attr unchanged
// ---------------------------------------------------------------------------

describe("§9 HTML output — static string attr unchanged", () => {
  test("static class attribute emits as before", () => {
    const nodes = [makeMarkupNode("div", [strAttr("class", "foo bar")])];
    const html = generateHtml(nodes, [], false, null, null);
    expect(html).toContain(`class="foo bar"`);
    expect(html).not.toContain("data-scrml-attr-tpl");
  });

  test("static id attribute emits as before", () => {
    const nodes = [makeMarkupNode("div", [strAttr("id", "main")])];
    const html = generateHtml(nodes, [], false, null, null);
    expect(html).toContain(`id="main"`);
  });
});

// ---------------------------------------------------------------------------
// §10 HTML output — placeholder shape
// ---------------------------------------------------------------------------

describe("§10 HTML output — template-attr placeholder shape", () => {
  test("class template-attr placeholder has non-empty id value", () => {
    const nodes = [makeMarkupNode("div", [strAttr("class", "item-${@status}")])];
    const html = generateHtml(nodes, [], false, null, null);
    // data-scrml-attr-tpl-class="_scrml_attr_tpl_class_N" where N is a counter value
    expect(html).toMatch(/data-scrml-attr-tpl-class="_scrml_[^"]+"/);
  });

  test("data-id template-attr uses correct attribute name in data attr", () => {
    const nodes = [makeMarkupNode("div", [strAttr("data-id", "item-${@id}")])];
    const html = generateHtml(nodes, [], false, null, null);
    expect(html).toContain(`data-scrml-attr-tpl-data-id="`);
  });
});

// ---------------------------------------------------------------------------
// §11 Client JS — setAttribute with interpolated template literal
// ---------------------------------------------------------------------------

describe("§11 Client JS — setAttribute call", () => {
  test("setAttribute called with reactive template literal", () => {
    const nodes = [makeMarkupNode("div", [strAttr("class", "item-${@status}")])];
    const fileAST = makeFileAST("/test/app.scrml", nodes);
    const result = runCG({
      files: [fileAST],
      routeMap: makeRouteMap(),
      depGraph: makeDepGraph(),
      protectAnalysis: makeProtectAnalysis(),
      embedRuntime: true,
    });
    const { clientJs: __cjRaw } = result.outputs.get("/test/app.scrml"); const clientJs = foldChunkNamespacing(__cjRaw);
    expect(clientJs).toContain(`setAttribute("class"`);
    expect(clientJs).toContain(`_scrml_reactive_get("status")`);
  });

  test("template literal expression uses backtick form in setAttribute", () => {
    const nodes = [makeMarkupNode("div", [strAttr("class", "item-${@status}")])];
    const fileAST = makeFileAST("/test/app.scrml", nodes);
    const result = runCG({
      files: [fileAST],
      routeMap: makeRouteMap(),
      depGraph: makeDepGraph(),
      protectAnalysis: makeProtectAnalysis(),
      embedRuntime: true,
    });
    const { clientJs: __cjRaw } = result.outputs.get("/test/app.scrml"); const clientJs = foldChunkNamespacing(__cjRaw);
    // Should use a JS template literal (backtick) not string concatenation
    expect(clientJs).toMatch(/setAttribute\("class",\s*`item-\$\{_scrml_reactive_get\("status"\)\}`\)/);
  });
});

// ---------------------------------------------------------------------------
// §12 Client JS — reactive subscription wired
// ---------------------------------------------------------------------------

describe("§12 Client JS — reactive subscription wired", () => {
  test("_scrml_effect called for @var in template", () => {
    const nodes = [makeMarkupNode("div", [strAttr("class", "item-${@status}")])];
    const fileAST = makeFileAST("/test/app.scrml", nodes);
    const result = runCG({
      files: [fileAST],
      routeMap: makeRouteMap(),
      depGraph: makeDepGraph(),
      protectAnalysis: makeProtectAnalysis(),
      embedRuntime: true,
    });
    const { clientJs: __cjRaw } = result.outputs.get("/test/app.scrml"); const clientJs = foldChunkNamespacing(__cjRaw);
    expect(clientJs).toContain(`_scrml_effect`);
    expect(clientJs).toContain(`_scrml_reactive_get("status")`);
  });

  test("effect callback calls setAttribute", () => {
    const nodes = [makeMarkupNode("div", [strAttr("class", "active-${@isActive}")])];
    const fileAST = makeFileAST("/test/app.scrml", nodes);
    const result = runCG({
      files: [fileAST],
      routeMap: makeRouteMap(),
      depGraph: makeDepGraph(),
      protectAnalysis: makeProtectAnalysis(),
      embedRuntime: true,
    });
    const { clientJs: __cjRaw } = result.outputs.get("/test/app.scrml"); const clientJs = foldChunkNamespacing(__cjRaw);
    expect(clientJs).toContain(`_scrml_effect`);
    expect(clientJs).toContain(`setAttribute("class"`);
  });
});

// ---------------------------------------------------------------------------
// §13 Client JS — non-reactive ${expr} does not produce subscription
// ---------------------------------------------------------------------------

describe("§13 Client JS — non-reactive interpolation skips subscription", () => {
  test("${idx} (non-reactive) does not produce _scrml_effect", () => {
    const nodes = [makeMarkupNode("div", [strAttr("class", "item-${idx}")])];
    const fileAST = makeFileAST("/test/app.scrml", nodes);
    const result = runCG({
      files: [fileAST],
      routeMap: makeRouteMap(),
      depGraph: makeDepGraph(),
      protectAnalysis: makeProtectAnalysis(),
      embedRuntime: true,
    });
    const { clientJs: __cjRaw } = result.outputs.get("/test/app.scrml"); const clientJs = foldChunkNamespacing(__cjRaw);
    // setAttribute should still be called (one-time wiring)
    expect(clientJs).toContain(`setAttribute("class"`);
    // But no effect call since idx is not reactive (runtime defines _scrml_effect, but no call emitted)
    expect(clientJs).not.toContain(`_scrml_effect(() =>`);
  });
});

// ---------------------------------------------------------------------------
// §14 Client JS — multiple @var refs produce multiple subscriptions
// ---------------------------------------------------------------------------

describe("§14 Client JS — multiple reactive vars → single auto-tracking effect", () => {
  test("two @vars produce a single _scrml_effect that auto-tracks both", () => {
    const nodes = [makeMarkupNode("div", [strAttr("class", "${@a}-${@b}")])];
    const fileAST = makeFileAST("/test/app.scrml", nodes);
    const result = runCG({
      files: [fileAST],
      routeMap: makeRouteMap(),
      depGraph: makeDepGraph(),
      protectAnalysis: makeProtectAnalysis(),
      embedRuntime: true,
    });
    const { clientJs: __cjRaw } = result.outputs.get("/test/app.scrml"); const clientJs = foldChunkNamespacing(__cjRaw);
    expect(clientJs).toContain(`_scrml_effect`);
    expect(clientJs).toContain(`_scrml_reactive_get("a")`);
    expect(clientJs).toContain(`_scrml_reactive_get("b")`);
  });
});

// ---------------------------------------------------------------------------
// §15 End-to-end — class="item-${@status}"
// ---------------------------------------------------------------------------

describe("§15 E2E — class=\"item-${@status}\"", () => {
  test("HTML has empty class + data-scrml-attr-tpl-class placeholder", () => {
    const nodes = [makeMarkupNode("div", [strAttr("class", "item-${@status}")])];
    const fileAST = makeFileAST("/test/app.scrml", nodes);
    const result = runCG({
      files: [fileAST],
      routeMap: makeRouteMap(),
      depGraph: makeDepGraph(),
      protectAnalysis: makeProtectAnalysis(),
      embedRuntime: true,
    });
    const { html } = result.outputs.get("/test/app.scrml");
    expect(html).toContain(`class=""`);
    expect(html).toContain(`data-scrml-attr-tpl-class="`);
    expect(html).not.toContain("item-${@status}");
  });

  test("JS querySelector uses the same placeholder ID as the HTML data attr", () => {
    const nodes = [makeMarkupNode("div", [strAttr("class", "item-${@status}")])];
    const fileAST = makeFileAST("/test/app.scrml", nodes);
    const result = runCG({
      files: [fileAST],
      routeMap: makeRouteMap(),
      depGraph: makeDepGraph(),
      protectAnalysis: makeProtectAnalysis(),
      embedRuntime: true,
    });
    const { html, clientJs: __cjRaw } = result.outputs.get("/test/app.scrml"); const clientJs = foldChunkNamespacing(__cjRaw);

    // Extract placeholder ID from HTML
    const htmlMatch = html.match(/data-scrml-attr-tpl-class="(_scrml_[^"]+)"/);
    expect(htmlMatch).not.toBeNull();
    const placeholderId = htmlMatch[1];

    // Verify JS uses the same ID in the querySelector
    expect(clientJs).toContain(`data-scrml-attr-tpl-class="${placeholderId}"`);
  });

  test("no errors produced", () => {
    const nodes = [makeMarkupNode("div", [strAttr("class", "item-${@status}")])];
    const fileAST = makeFileAST("/test/app.scrml", nodes);
    const result = runCG({
      files: [fileAST],
      routeMap: makeRouteMap(),
      depGraph: makeDepGraph(),
      protectAnalysis: makeProtectAnalysis(),
      embedRuntime: true,
    });
    expect(result.errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §16 End-to-end — mixed reactive and non-reactive
// ---------------------------------------------------------------------------

describe("§16 E2E — mixed reactive and non-reactive interpolation", () => {
  test("class=\"foo-${idx}-bar-${@isActive}\" — subscription only for isActive", () => {
    const nodes = [makeMarkupNode("div", [strAttr("class", "foo-${idx}-bar-${@isActive}")])];
    const fileAST = makeFileAST("/test/app.scrml", nodes);
    const result = runCG({
      files: [fileAST],
      routeMap: makeRouteMap(),
      depGraph: makeDepGraph(),
      protectAnalysis: makeProtectAnalysis(),
      embedRuntime: true,
    });
    const { clientJs: __cjRaw } = result.outputs.get("/test/app.scrml"); const clientJs = foldChunkNamespacing(__cjRaw);
    expect(clientJs).toContain(`_scrml_effect`);
    expect(clientJs).toContain(`_scrml_reactive_get("isActive")`);
    expect(clientJs).toContain(`setAttribute("class"`);
  });
});

// ---------------------------------------------------------------------------
// §17 End-to-end — attribute other than class
// ---------------------------------------------------------------------------

describe("§17 E2E — template-attr on non-class attribute", () => {
  test("data-id=\"item-${@id}\" compiles correctly", () => {
    const nodes = [makeMarkupNode("li", [strAttr("data-id", "item-${@id}")])];
    const fileAST = makeFileAST("/test/app.scrml", nodes);
    const result = runCG({
      files: [fileAST],
      routeMap: makeRouteMap(),
      depGraph: makeDepGraph(),
      protectAnalysis: makeProtectAnalysis(),
      embedRuntime: true,
    });
    const { html, clientJs: __cjRaw } = result.outputs.get("/test/app.scrml"); const clientJs = foldChunkNamespacing(__cjRaw);
    expect(html).toContain(`data-scrml-attr-tpl-data-id="`);
    expect(clientJs).toContain(`setAttribute("data-id"`);
    expect(clientJs).toContain(`_scrml_effect`);
    expect(result.errors).toHaveLength(0);
  });

  test("aria-label=\"${@count} items\" compiles correctly", () => {
    const nodes = [makeMarkupNode("ul", [strAttr("aria-label", "${@count} items")])];
    const fileAST = makeFileAST("/test/app.scrml", nodes);
    const result = runCG({
      files: [fileAST],
      routeMap: makeRouteMap(),
      depGraph: makeDepGraph(),
      protectAnalysis: makeProtectAnalysis(),
      embedRuntime: true,
    });
    const { clientJs: __cjRaw } = result.outputs.get("/test/app.scrml"); const clientJs = foldChunkNamespacing(__cjRaw);
    expect(clientJs).toContain(`setAttribute("aria-label"`);
    expect(clientJs).toContain(`_scrml_effect`);
  });
});

// ---------------------------------------------------------------------------
// §18 End-to-end — multiple elements with template-attr
// ---------------------------------------------------------------------------

describe("§18 E2E — multiple elements with template-attrs", () => {
  test("two elements each get their own placeholder and subscription", () => {
    const nodes = [
      makeMarkupNode("div", [strAttr("class", "card-${@type}")]),
      makeMarkupNode("span", [strAttr("class", "badge-${@status}")]),
    ];
    const fileAST = makeFileAST("/test/app.scrml", nodes);
    const result = runCG({
      files: [fileAST],
      routeMap: makeRouteMap(),
      depGraph: makeDepGraph(),
      protectAnalysis: makeProtectAnalysis(),
      embedRuntime: true,
    });
    const { html, clientJs: __cjRaw } = result.outputs.get("/test/app.scrml"); const clientJs = foldChunkNamespacing(__cjRaw);

    // Two distinct placeholder IDs in HTML
    const placeholderMatches = [...html.matchAll(/data-scrml-attr-tpl-class="(_scrml_[^"]+)"/g)];
    expect(placeholderMatches.length).toBe(2);
    const [id1, id2] = placeholderMatches.map(m => m[1]);
    expect(id1).not.toBe(id2);

    // Both effects wired
    expect(clientJs).toContain(`_scrml_effect`);
    expect(clientJs).toContain(`_scrml_reactive_get("type")`);
    expect(clientJs).toContain(`_scrml_reactive_get("status")`);
  });
});

// ---------------------------------------------------------------------------
// §19 Edge case — empty interpolation ${}
// ---------------------------------------------------------------------------

describe("§19 Edge case — empty interpolation ${}", () => {
  test("empty ${} does not crash and emits placeholder", () => {
    const nodes = [makeMarkupNode("div", [strAttr("class", "foo-${}")])];
    // Should not throw
    expect(() => {
      const html = generateHtml(nodes, [], false, null, null);
      expect(html).toContain("data-scrml-attr-tpl-class=");
    }).not.toThrow();
  });
});
