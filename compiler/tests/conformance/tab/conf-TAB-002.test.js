// Conformance test for: SPEC §3.1 (Context Model)
// Pipeline contract Stage 3 invariant: "Every node carries a `Span`
// referencing the preprocessed source. Spans are NEVER dropped."
//
// Every ASTNode produced by the TAB stage SHALL carry a `span` field with
// `file`, `start`, `end`, `line`, and `col` properties. No span may be null,
// undefined, or missing a required field.

import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../../src/block-splitter.js";
import { buildAST } from "../../../src/ast-builder.js";

function run(src) {
  const bsOut = splitBlocks("test.scrml", src);
  return buildAST(bsOut);
}

function assertSpan(span, label) {
  expect(span, `${label} must have a span`).toBeDefined();
  expect(typeof span.file, `${label} span.file must be a string`).toBe("string");
  expect(typeof span.start, `${label} span.start must be a number`).toBe("number");
  expect(typeof span.end, `${label} span.end must be a number`).toBe("number");
  expect(typeof span.line, `${label} span.line must be a number`).toBe("number");
  expect(typeof span.col, `${label} span.col must be a number`).toBe("number");
  expect(span.end >= span.start, `${label} span.end >= span.start`).toBe(true);
  expect(span.line >= 1, `${label} span.line >= 1`).toBe(true);
  expect(span.col >= 1, `${label} span.col >= 1`).toBe(true);
}

function walkSpans(nodes, label = "node") {
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    assertSpan(node.span, `${label}[kind=${node.kind}]`);
    if (node.children) walkSpans(node.children, `child of ${node.kind}`);
    if (node.body) walkSpans(node.body, `body of ${node.kind}`);
    if (node.attrs) {
      for (const a of node.attrs) {
        assertSpan(a.span, `attr(${a.name})`);
      }
    }
  }
}

describe("CONF-TAB-002: every AST node carries a valid span — spans are never dropped", () => {
  test("markup node has a valid span", () => {
    const { ast } = run("<div>hello</>");
    walkSpans(ast.nodes);
  });

  test("state node has a valid span", () => {
    const { ast } = run('< db src="db.sql"></>');
    walkSpans(ast.nodes);
  });

  test("logic node and all its body nodes carry spans", () => {
    const { ast } = run("${ let x = 1; function f(a) { return a; } lift x; }");
    walkSpans(ast.nodes);
  });

  test("nested child markup nodes carry spans", () => {
    const { ast } = run("<ul><li>item</></ul>");
    walkSpans(ast.nodes);
  });

  test("attribute nodes carry spans", () => {
    const { ast } = run('<button class="btn" onclick=save() disabled=submitting>OK</>');
    walkSpans(ast.nodes);
  });

  test("span.file matches the filePath passed to buildAST", () => {
    const bsOut = splitBlocks("my-file.scrml", "<div>hello</>");
    const { ast } = buildAST(bsOut);
    const node = ast.nodes[0];
    expect(node.span.file).toBe("my-file.scrml");
  });
});
