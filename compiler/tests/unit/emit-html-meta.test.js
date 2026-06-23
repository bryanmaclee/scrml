/**
 * emit-html.js — Meta Placeholder Tests
 *
 * Tests for the meta node handler in generateHtml().
 * Covers SPEC §22.5: runtime ^{} blocks in markup context emit a placeholder
 * span so that meta.emit(htmlString) can find the correct DOM insertion point.
 *
 * Coverage:
 *   §1  Meta node in markup context emits a placeholder span
 *   §2  Placeholder uses data-scrml-meta attribute with the block's scopeId
 *   §3  ScopeId format is _scrml_meta_<node.id>
 *   §4  Placeholder span is empty by default
 *   §5  Meta node without node.id emits no HTML (no stable anchor)
 *   §6  Multiple meta nodes each emit their own placeholder
 *   §7  Meta placeholder is positioned correctly relative to surrounding markup
 *   §8  Meta node inside a markup element emits placeholder inside that element
 *   §9  Meta placeholder does not interfere with adjacent text nodes
 *   §10 generateHtml still handles logic nodes correctly after meta change (regression)
 */

import { describe, test, expect } from "bun:test";
import { generateHtml } from "../../src/codegen/emit-html.js";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseSource(source, filePath = "/test/app.scrml") {
  const bsResult = splitBlocks(filePath, source);
  const tabResult = buildAST(bsResult);
  return tabResult;
}

function compileHtml(source) {
  const { ast, errors } = parseSource(source);
  const htmlErrors = [];
  const html = generateHtml(ast.nodes, htmlErrors, false, null, ast);
  return { html, errors: htmlErrors, ast };
}

// Build a synthetic meta node with a given id (for unit tests that don't need the full pipeline)
function makeSyntheticMetaNode(id, body = []) {
  return {
    kind: "meta",
    id,
    body,
    parentContext: "markup",
    span: { file: "/test/app.scrml", start: 0, end: 10, line: 1, col: 1 },
  };
}

// ---------------------------------------------------------------------------
// §1: Meta node in markup context emits a placeholder span
// ---------------------------------------------------------------------------

describe("emit-html meta §1: placeholder emission", () => {
  test("meta node with id emits a span element", () => {
    const nodes = [makeSyntheticMetaNode(1)];
    const errors = [];
    const html = generateHtml(nodes, errors, false, null, null);
    expect(html).toContain("<span");
    expect(html).toContain("</span>");
  });

  test("placeholder span contains data-scrml-meta attribute", () => {
    const nodes = [makeSyntheticMetaNode(1)];
    const errors = [];
    const html = generateHtml(nodes, errors, false, null, null);
    expect(html).toContain("data-scrml-meta");
  });
});

// ---------------------------------------------------------------------------
// §2: Placeholder uses data-scrml-meta attribute with the block's scopeId
// ---------------------------------------------------------------------------

describe("emit-html meta §2: data-scrml-meta attribute", () => {
  test("attribute value is the meta block scope ID", () => {
    const nodes = [makeSyntheticMetaNode(3)];
    const errors = [];
    const html = generateHtml(nodes, errors, false, null, null);
    expect(html).toContain('data-scrml-meta="_scrml_meta_3"');
  });

  test("attribute value is quoted correctly", () => {
    const nodes = [makeSyntheticMetaNode(7)];
    const errors = [];
    const html = generateHtml(nodes, errors, false, null, null);
    // Must use double-quote attribute syntax for valid HTML
    expect(html).toMatch(/data-scrml-meta="_scrml_meta_7"/);
  });
});

// ---------------------------------------------------------------------------
// §3: ScopeId format is _scrml_meta_<node.id>
// ---------------------------------------------------------------------------

describe("emit-html meta §3: scopeId format", () => {
  test("scopeId is _scrml_meta_<id> for integer ids", () => {
    for (const id of [1, 2, 5, 10, 42, 99]) {
      const nodes = [makeSyntheticMetaNode(id)];
      const errors = [];
      const html = generateHtml(nodes, errors, false, null, null);
      expect(html).toContain(`data-scrml-meta="_scrml_meta_${id}"`);
    }
  });

  test("scopeId format matches emit-logic.js meta.scopeId format", () => {
    // emit-logic.js uses `"_scrml_meta_${node.id}"` for the scopeId.
    // emit-html.js must use the same format for _scrml_meta_emit to find the placeholder.
    const id = 15;
    const nodes = [makeSyntheticMetaNode(id)];
    const errors = [];
    const html = generateHtml(nodes, errors, false, null, null);
    expect(html).toContain(`_scrml_meta_${id}`);
  });
});

// ---------------------------------------------------------------------------
// §4: Placeholder span is empty by default
// ---------------------------------------------------------------------------

describe("emit-html meta §4: empty placeholder", () => {
  test("placeholder span has no inner content", () => {
    const nodes = [makeSyntheticMetaNode(1)];
    const errors = [];
    const html = generateHtml(nodes, errors, false, null, null);
    expect(html).toContain('<span data-scrml-meta="_scrml_meta_1"></span>');
  });

  test("placeholder span has no child text", () => {
    const nodes = [makeSyntheticMetaNode(2)];
    const errors = [];
    const html = generateHtml(nodes, errors, false, null, null);
    // The span must be self-closing in the sense that nothing is between open and close tags
    const match = html.match(/<span data-scrml-meta="[^"]+">([^<]*)<\/span>/);
    expect(match).not.toBeNull();
    expect(match[1]).toBe(""); // empty content between tags
  });
});

// ---------------------------------------------------------------------------
// §5: Meta node without node.id emits no HTML
// ---------------------------------------------------------------------------

describe("emit-html meta §5: no id = no HTML", () => {
  test("meta node without id emits empty string", () => {
    // node.id is undefined — no stable anchor, no placeholder emitted
    const node = {
      kind: "meta",
      body: [],
      span: { file: "/test/app.scrml", start: 0, end: 10, line: 1, col: 1 },
    };
    const errors = [];
    const html = generateHtml([node], errors, false, null, null);
    expect(html).toBe("");
  });

  test("meta node with id=null emits empty string", () => {
    const node = {
      kind: "meta",
      id: null,
      body: [],
      span: { file: "/test/app.scrml", start: 0, end: 10, line: 1, col: 1 },
    };
    const errors = [];
    const html = generateHtml([node], errors, false, null, null);
    expect(html).toBe("");
  });
});

// ---------------------------------------------------------------------------
// §6: Multiple meta nodes each emit their own placeholder
// ---------------------------------------------------------------------------

describe("emit-html meta §6: multiple meta nodes", () => {
  test("two meta nodes produce two distinct placeholders", () => {
    const nodes = [makeSyntheticMetaNode(1), makeSyntheticMetaNode(2)];
    const errors = [];
    const html = generateHtml(nodes, errors, false, null, null);
    expect(html).toContain('data-scrml-meta="_scrml_meta_1"');
    expect(html).toContain('data-scrml-meta="_scrml_meta_2"');
    // Two distinct spans
    const spans = html.match(/<span data-scrml-meta="[^"]+"><\/span>/g);
    expect(spans).not.toBeNull();
    expect(spans.length).toBe(2);
  });

  test("three meta nodes produce three placeholders in order", () => {
    const nodes = [
      makeSyntheticMetaNode(10),
      makeSyntheticMetaNode(20),
      makeSyntheticMetaNode(30),
    ];
    const errors = [];
    const html = generateHtml(nodes, errors, false, null, null);
    const pos10 = html.indexOf("_scrml_meta_10");
    const pos20 = html.indexOf("_scrml_meta_20");
    const pos30 = html.indexOf("_scrml_meta_30");
    expect(pos10).toBeGreaterThanOrEqual(0);
    expect(pos20).toBeGreaterThan(pos10);
    expect(pos30).toBeGreaterThan(pos20);
  });
});

// ---------------------------------------------------------------------------
// §7: Meta placeholder is positioned correctly relative to surrounding markup
// ---------------------------------------------------------------------------

describe("emit-html meta §7: positioning", () => {
  test("meta placeholder appears between surrounding text nodes", () => {
    const nodes = [
      { kind: "text", value: "before" },
      makeSyntheticMetaNode(5),
      { kind: "text", value: "after" },
    ];
    const errors = [];
    const html = generateHtml(nodes, errors, false, null, null);
    const beforePos = html.indexOf("before");
    const placeholderPos = html.indexOf("data-scrml-meta");
    const afterPos = html.indexOf("after");
    expect(beforePos).toBeGreaterThanOrEqual(0);
    expect(placeholderPos).toBeGreaterThan(beforePos);
    expect(afterPos).toBeGreaterThan(placeholderPos);
  });
});

// ---------------------------------------------------------------------------
// §8: Meta node inside a markup element emits placeholder inside that element
// ---------------------------------------------------------------------------

describe("emit-html meta §8: meta nested in markup", () => {
  test("meta inside a div produces placeholder inside the div", () => {
    // Build a div node containing a meta child
    const divNode = {
      kind: "markup",
      tag: "div",
      attributes: [],
      children: [makeSyntheticMetaNode(6)],
      selfClosing: false,
    };
    const errors = [];
    const html = generateHtml([divNode], errors, false, null, null);
    // The placeholder must be between <div> and </div>
    const divOpen = html.indexOf("<div>");
    const placeholder = html.indexOf('data-scrml-meta="_scrml_meta_6"');
    const divClose = html.indexOf("</div>");
    expect(divOpen).toBeGreaterThanOrEqual(0);
    expect(placeholder).toBeGreaterThan(divOpen);
    expect(divClose).toBeGreaterThan(placeholder);
  });
});

// ---------------------------------------------------------------------------
// §9: Meta placeholder does not interfere with adjacent text
// ---------------------------------------------------------------------------

describe("emit-html meta §9: no text interference", () => {
  test("text adjacent to meta placeholder is unmodified", () => {
    const nodes = [
      { kind: "text", value: "Hello " },
      makeSyntheticMetaNode(8),
      { kind: "text", value: " World" },
    ];
    const errors = [];
    const html = generateHtml(nodes, errors, false, null, null);
    expect(html).toContain("Hello ");
    expect(html).toContain(" World");
    // Text must not be inside the placeholder span
    expect(html).toContain('><\/span>');
  });

  test("no errors are emitted for valid meta nodes", () => {
    const nodes = [makeSyntheticMetaNode(9)];
    const errors = [];
    generateHtml(nodes, errors, false, null, null);
    expect(errors.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §10: Regression — logic nodes still work correctly
// ---------------------------------------------------------------------------

describe("emit-html meta §10: logic node regression", () => {
  // ss15 item-2 (S214): a `${...}` logic node emits a data-scrml-logic render
  // slot only in a MARKUP-INTERPOLATION position (nested inside a real markup
  // element). A bare-expr logic node at the file top-level / <program>-body is
  // a §40.8 default-logic EFFECT (no render slot) per SPEC §17.3. These
  // regression tests verify the logic-vs-meta ROUTING (logic -> data-scrml-
  // logic, NOT data-scrml-meta), so the logic node is wrapped in a <div> to put
  // it in render position -- preserving the test's intent under the corrected
  // default-logic semantics.
  const markupLogicNode = () => ({
    kind: "markup",
    tag: "div",
    attrs: [],
    children: [{
      kind: "logic",
      body: [{ kind: "bare-expr", expr: "@count" }],
      span: { file: "/test/app.scrml", start: 0, end: 10, line: 1, col: 1 },
    }],
    span: { file: "/test/app.scrml", start: 0, end: 12, line: 1, col: 1 },
  });

  test("logic nodes still emit data-scrml-logic placeholders", () => {
    const errors = [];
    const html = generateHtml([markupLogicNode()], errors, false, null, null);
    expect(html).toContain("data-scrml-logic");
    // Must NOT use data-scrml-meta for logic nodes
    expect(html).not.toContain("data-scrml-meta");
  });

  test("meta and logic nodes can coexist in the same node list", () => {
    const metaNode = makeSyntheticMetaNode(11);
    const errors = [];
    const html = generateHtml([metaNode, markupLogicNode()], errors, false, null, null);
    expect(html).toContain('data-scrml-meta="_scrml_meta_11"');
    expect(html).toContain("data-scrml-logic");
  });
});
