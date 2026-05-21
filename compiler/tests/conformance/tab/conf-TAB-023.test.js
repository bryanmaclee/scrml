// Conformance test for: Pipeline Stage 3 invariant
// "The AST is a pure value — no mutable shared state, no circular references."
// "Every node carries a `Span` referencing the preprocessed source. Spans are
//  NEVER dropped."
// "The discriminated union tag (`kind` field) is always present and valid on
//  every node."
// "Attribute values are fully classified into their quoting form. No
//  unclassified raw attribute strings remain in the AST."
//
// This test covers the FileAST structure invariants: filePath, nodes, imports,
// exports, components, typeDecls — all required fields must be present.

import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../../src/block-splitter.js";
import { buildAST } from "../../../src/ast-builder.js";

function run(src) {
  const bsOut = splitBlocks("test.scrml", src);
  return buildAST(bsOut);
}

describe("CONF-TAB-023: FileAST output shape satisfies all Stage 3 output contract invariants", () => {
  test("buildAST returns an object with { filePath, ast } at top level", () => {
    const result = run("<div>hello</>");
    expect(typeof result.filePath).toBe("string");
    expect(result.ast).toBeDefined();
    expect(typeof result.ast).toBe("object");
  });

  test("FileAST has all required top-level fields", () => {
    const { ast } = run("<div>hello</>");
    expect(typeof ast.filePath).toBe("string");
    expect(Array.isArray(ast.nodes)).toBe(true);
    expect(Array.isArray(ast.imports)).toBe(true);
    expect(Array.isArray(ast.exports)).toBe(true);
    expect(Array.isArray(ast.components)).toBe(true);
    expect(Array.isArray(ast.typeDecls)).toBe(true);
  });

  test("filePath in FileAST matches the filePath passed to BS", () => {
    const bsOut = splitBlocks("my-component.scrml", "<div>hello</>");
    const { ast } = buildAST(bsOut);
    expect(ast.filePath).toBe("my-component.scrml");
  });

  test("no node in the tree has a circular reference (JSON.stringify succeeds)", () => {
    const { ast } = run(
      '<div class="c">\n  <p>text</>\n  ${ let x = 1; }\n</>\n< db></>\n^{ let m = 1; }'
    );
    expect(() => JSON.stringify(ast)).not.toThrow();
  });

  test("all attribute values have a valid kind field (no raw attribute strings remain)", () => {
    const { ast } = run('<div class="c" id=myId onclick=go()>hello</>');
    const div = ast.nodes[0];
    for (const attr of div.attrs) {
      expect(attr.value).toBeDefined();
      expect(typeof attr.value.kind).toBe("string");
      expect(["string-literal", "variable-ref", "call-ref", "absent"]).toContain(
        attr.value.kind
      );
    }
  });
});
