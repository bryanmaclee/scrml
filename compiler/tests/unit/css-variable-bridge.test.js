/**
 * CSS Variable Bridge — Unit Tests
 *
 * Tests for the CSS variable bridge feature: @var references and expressions
 * inside #{} CSS blocks are compiled to CSS custom properties + reactive JS wiring.
 *
 * Coverage:
 *   T1  @var in CSS produces CSS custom property var(--scrml-varName) in CSS output
 *   T2  @var in CSS produces setProperty call in client JS output
 *   T3  @var in CSS produces reactive subscription in client JS output
 *   T4  Expression (@x * 2) in CSS produces derived computation + custom property
 *   T5  Ternary expression in CSS value position
 *   T6  Multiple @var references in one CSS rule
 *   T7  @var with unit suffix (@spacing px) produces correct custom property
 *   T8  Scoped @var in constructor context targets element, not :root
 *   T9  CSS without @var remains unchanged (regression guard)
 *   T10 Multiple CSS rules with mixed reactive/non-reactive values
 */

import { describe, test, expect } from "bun:test";
import { runCG } from "../../src/code-generator.js";
import { tokenizeCSS } from "../../src/tokenizer.js";

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

function makeTextNode(text, s = span(0)) {
  return { kind: "text", value: text, span: s };
}

/**
 * Build a css-inline node with rules array (as the AST builder produces).
 */
function makeCssInlineWithRules(rules, s = span(0)) {
  return { kind: "css-inline", rules, span: s };
}

/**
 * Build a css-inline node with body string (legacy/simple format).
 */
function makeCssInlineBlock(body, s = span(0)) {
  return { kind: "css-inline", body, span: s };
}

function makeRouteMap(entries = []) {
  const functions = new Map();
  for (const e of entries) {
    functions.set(e.functionNodeId, e);
  }
  return { functions };
}

function makeDepGraph() {
  return { nodes: new Map(), edges: [] };
}

function compileWithCss(nodes, filePath = "/test/app.scrml") {
  const fileAST = makeFileAST(filePath, nodes);
  const result = runCG({
    files: [fileAST],
    routeMap: makeRouteMap(),
    depGraph: makeDepGraph(),
    protectAnalysis: { views: new Map() },
  });
  return result.outputs.get(filePath);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CSS Variable Bridge", () => {

  // T1: @var in CSS produces CSS custom property
  test("T1: @var in CSS value produces var(--scrml-varName) in CSS output", () => {
    const output = compileWithCss([
      makeCssInlineWithRules([
        { prop: "color", value: "@brandColor", span: span(0),
          reactiveRefs: [{ name: "brandColor", expr: null }],
          isExpression: false },
      ]),
    ]);

    expect(output.css).toBeTruthy();
    expect(output.css).toContain("var(--scrml-brandColor)");
    expect(output.css).toContain("color: var(--scrml-brandColor);");
  });

  // T2: @var in CSS produces setProperty in client JS
  test("T2: @var in CSS produces setProperty call in client JS", () => {
    const output = compileWithCss([
      makeMarkupNode("div", [], [makeTextNode("content")]),
      makeCssInlineWithRules([
        { prop: "color", value: "@brandColor", span: span(0),
          reactiveRefs: [{ name: "brandColor", expr: null }],
          isExpression: false },
      ]),
    ]);

    expect(output.clientJs).toBeTruthy();
    expect(output.clientJs).toContain('style.setProperty("--scrml-brandColor"');
    expect(output.clientJs).toContain('_scrml_reactive_get("brandColor")');
  });

  // T3: @var in CSS produces reactive subscription
  test("T3: @var in CSS produces reactive subscription in client JS", () => {
    const output = compileWithCss([
      makeMarkupNode("div", [], [makeTextNode("content")]),
      makeCssInlineWithRules([
        { prop: "color", value: "@brandColor", span: span(0),
          reactiveRefs: [{ name: "brandColor", expr: null }],
          isExpression: false },
      ]),
    ]);

    expect(output.clientJs).toBeTruthy();
    expect(output.clientJs).toContain('_scrml_effect');
    expect(output.clientJs).toContain('style.setProperty("--scrml-brandColor"');
  });

  // T4: Expression in CSS produces derived computation
  test("T4: expression (@x * 2) produces derived computation + custom property", () => {
    const output = compileWithCss([
      makeMarkupNode("div", [], [makeTextNode("content")]),
      makeCssInlineWithRules([
        { prop: "padding", value: "@spacing * 2", span: span(0),
          reactiveRefs: [{ name: "spacing", expr: "@spacing * 2" }],
          isExpression: true },
      ]),
    ]);

    expect(output.css).toBeTruthy();
    expect(output.css).toContain("var(--scrml-expr-spacing)");

    expect(output.clientJs).toBeTruthy();
    expect(output.clientJs).toContain('_scrml_reactive_get("spacing")');
    expect(output.clientJs).toContain('_scrml_effect');
    // The expression should be wrapped in a function
    expect(output.clientJs).toMatch(/function _scrml_css_expr_\d+\(\)/);
  });

  // T5: Ternary expression in CSS value position
  test("T5: ternary expression in CSS value position", () => {
    const output = compileWithCss([
      makeMarkupNode("div", [], [makeTextNode("content")]),
      makeCssInlineWithRules([
        { prop: "background", value: '@isDark ? "#1a1a1a" : "#fff"', span: span(0),
          reactiveRefs: [{ name: "isDark", expr: '@isDark ? "#1a1a1a" : "#fff"' }],
          isExpression: true },
      ]),
    ]);

    expect(output.css).toBeTruthy();
    expect(output.css).toContain("var(--scrml-expr-isDark)");

    expect(output.clientJs).toBeTruthy();
    expect(output.clientJs).toContain('_scrml_reactive_get("isDark")');
    expect(output.clientJs).toContain('? "#1a1a1a" : "#fff"');
  });

  // T6: Multiple @var references in one rule
  test("T6: multiple @var references in one CSS rule", () => {
    const output = compileWithCss([
      makeMarkupNode("div", [], [makeTextNode("content")]),
      makeCssInlineWithRules([
        { prop: "border", value: "@borderWidth solid @borderColor", span: span(0),
          reactiveRefs: [
            { name: "borderWidth", expr: "@borderWidth solid @borderColor" },
            { name: "borderColor", expr: "@borderWidth solid @borderColor" },
          ],
          isExpression: true },
      ]),
    ]);

    expect(output.css).toBeTruthy();
    // Expression with multiple vars gets a combined custom property name
    expect(output.css).toContain("var(--scrml-expr-borderWidth-borderColor)");

    expect(output.clientJs).toBeTruthy();
    // Single effect auto-tracks both vars
    expect(output.clientJs).toContain('_scrml_effect');
  });

  // T7: @var with unit suffix
  test("T7: @var with unit suffix (@spacing px) produces correct custom property", () => {
    const output = compileWithCss([
      makeCssInlineWithRules([
        { prop: "padding", value: "@spacing px", span: span(0),
          reactiveRefs: [{ name: "spacing", expr: null }],
          isExpression: false },
      ]),
    ]);

    expect(output.css).toBeTruthy();
    // Simple @var with unit: the @var is replaced but unit stays
    expect(output.css).toContain("var(--scrml-spacing)");
    expect(output.css).toContain("padding: var(--scrml-spacing) px;");
  });

  // T8: A reactive CSS var ALWAYS targets document.documentElement (:root).
  // Components are compile-time INLINED — there is no per-instance runtime
  // element, so the reactive cell (always a GLOBAL cell) sets the custom
  // property on :root, which inherits into the component's inline style.
  // Regression guard for the `_scrml_el is not defined` load-time crash: a
  // "scoped" `#{}` MUST NOT emit an undefined `_scrml_el` target.
  test("T8: a reactive @var (scoped or not) targets document.documentElement, never _scrml_el", () => {
    const output = compileWithCss([
      makeMarkupNode("div", [], [makeTextNode("content")]),
      makeCssInlineWithRules([
        { prop: "color", value: "@brandColor", span: span(0),
          reactiveRefs: [{ name: "brandColor", expr: null }],
          isExpression: false,
        },
      ]),
    ]);

    // Program-level (non-scoped): targets document.documentElement.
    expect(output.clientJs).toContain("document.documentElement.style.setProperty");

    // A component/constructor-scoped block targets the SAME :root — NOT a
    // per-instance `_scrml_el` (which is never defined → a ReferenceError at
    // bundle load that halts the whole client). The custom property on :root
    // inherits into the component's inline `style="… var(--scrml-brandColor)"`.
    const scopedNodes = [
      makeMarkupNode("div", [], [makeTextNode("content")]),
      {
        kind: "css-inline",
        rules: [
          { prop: "color", value: "@brandColor", span: span(0),
            reactiveRefs: [{ name: "brandColor", expr: null }],
            isExpression: false },
        ],
        _componentScope: "Card",
        span: span(0),
      },
    ];
    const scopedOutput = compileWithCss(scopedNodes);

    expect(scopedOutput.clientJs).toBeTruthy();
    expect(scopedOutput.clientJs).toContain("document.documentElement.style.setProperty");
    expect(scopedOutput.clientJs).not.toContain("_scrml_el");
  });

  // T9: CSS without @var remains unchanged (regression guard)
  test("T9: CSS without @var remains unchanged", () => {
    // Using body string format (legacy)
    const bodyOutput = compileWithCss([
      makeCssInlineBlock(".container { display: flex; }"),
    ]);
    expect(bodyOutput.css).toBeTruthy();
    expect(bodyOutput.css).toContain(".container { display: flex; }");
    expect(bodyOutput.css).not.toContain("var(--scrml-");

    // Using rules format without reactive refs
    const rulesOutput = compileWithCss([
      makeCssInlineWithRules([
        { prop: "display", value: "flex", span: span(0) },
        { prop: "color", value: "red", span: span(0) },
      ]),
    ]);
    expect(rulesOutput.css).toBeTruthy();
    expect(rulesOutput.css).toContain("display: flex;");
    expect(rulesOutput.css).toContain("color: red;");
    expect(rulesOutput.css).not.toContain("var(--scrml-");
  });

  // T10: Mixed reactive/non-reactive rules
  test("T10: mixed reactive and non-reactive CSS rules", () => {
    const output = compileWithCss([
      makeMarkupNode("div", [], [makeTextNode("content")]),
      makeCssInlineWithRules([
        { prop: "display", value: "flex", span: span(0) },
        { prop: "color", value: "@brandColor", span: span(0),
          reactiveRefs: [{ name: "brandColor", expr: null }],
          isExpression: false },
        { prop: "padding", value: "1rem", span: span(0) },
      ]),
    ]);

    expect(output.css).toBeTruthy();
    expect(output.css).toContain("display: flex;");
    expect(output.css).toContain("color: var(--scrml-brandColor);");
    expect(output.css).toContain("padding: 1rem;");

    expect(output.clientJs).toBeTruthy();
    expect(output.clientJs).toContain('_scrml_effect');
  });
});

// ---------------------------------------------------------------------------
// AST builder integration: scanCSSValueForReactiveRefs
// ---------------------------------------------------------------------------

describe("CSS Variable Bridge — AST Builder integration", () => {
  test("parseCSSTokens annotates @var in CSS value with reactiveRefs", () => {
    const css = "color: @brandColor;";
    const tokens = tokenizeCSS(css, 0, 1, 1);

    // CSS_VALUE token should contain "@brandColor"
    const valueToken = tokens.find(t => t.kind === "CSS_VALUE");
    expect(valueToken).toBeTruthy();
    expect(valueToken.text).toBe("@brandColor");
  });

  test("tokenizeCSS preserves @var in CSS value text", () => {
    const css = "padding: @spacing * 2 px; background: @isDark ? #1a1a1a : #fff;";
    const tokens = tokenizeCSS(css, 0, 1, 1);

    const valueTokens = tokens.filter(t => t.kind === "CSS_VALUE");
    expect(valueTokens.length).toBe(2);
    expect(valueTokens[0].text).toContain("@spacing");
    expect(valueTokens[1].text).toContain("@isDark");
  });

  test("tokenizeCSS handles CSS rule with selector and @var value", () => {
    const css = ".card { color: @brandColor; }";
    const tokens = tokenizeCSS(css, 0, 1, 1);

    // Should have selector, then nested content with @brandColor
    // Note: the current tokenizer parses selectors up to {, so the value
    // will be in the nested content parsing
    const selectorToken = tokens.find(t => t.kind === "CSS_SELECTOR");
    expect(selectorToken).toBeTruthy();
    expect(selectorToken.text).toContain(".card");
  });
});
