// Conformance test for: SPEC §3.1 (Context Model)
// "Additional context types MAY be added in future versions of this
//  specification." — normative: the TAB stage SHALL produce a discriminated
//  union node whose `kind` field exactly matches one of the defined context
//  types from the §3.1 table.
//
// Pipeline contract (Stage 3 output): "The discriminated union tag (`kind`
// field) is always present and valid on every node."

import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../../src/block-splitter.js";
import { buildAST } from "../../../src/ast-builder.js";

const VALID_KINDS = new Set([
  "markup",
  "state",
  "logic",
  "sql",
  "css-inline",
  "style",
  "error-effect",
  "meta",
  "text",
  "comment",
  // logic-body node kinds (also valid)
  "function-decl",
  "bare-expr",
  "lift-expr",
  "state-decl",
  "let-decl",
  "const-decl",
  "import-decl",
  "export-decl",
  "type-decl",
  "component-def",
  "tilde-decl",
]);

function run(src) {
  const bsOut = splitBlocks("test.scrml", src);
  return buildAST(bsOut);
}

function collectKinds(nodes, seen = new Set()) {
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    if (node.kind) seen.add(node.kind);
    if (node.children) collectKinds(node.children, seen);
    if (node.body) collectKinds(node.body, seen);
    if (node.attrs) {
      for (const a of node.attrs) {
        if (a.value && a.value.kind) seen.add("attr:" + a.value.kind);
      }
    }
  }
  return seen;
}

describe("CONF-TAB-001: every AST node kind is from the defined discriminated union", () => {
  test("markup node has kind 'markup'", () => {
    const { ast } = run("<div>hello</>");
    expect(ast.nodes[0].kind).toBe("markup");
  });

  test("state node has kind 'state'", () => {
    const { ast } = run('< db src="db.sql"></>');
    expect(ast.nodes[0].kind).toBe("state");
  });

  test("logic node has kind 'logic'", () => {
    const { ast } = run("${ let x = 1; }");
    expect(ast.nodes[0].kind).toBe("logic");
  });

  test("text node has kind 'text'", () => {
    const { ast } = run("<p>hello world</>");
    const textChild = ast.nodes[0].children.find((c) => c.kind === "text");
    expect(textChild).toBeDefined();
    expect(textChild.kind).toBe("text");
  });

  test("meta node has kind 'meta'", () => {
    const { ast } = run("<div>^{ let x = 1; }</>");
    const metaChild = ast.nodes[0].children.find((c) => c.kind === "meta");
    expect(metaChild).toBeDefined();
    expect(metaChild.kind).toBe("meta");
  });

  test("every node kind in a multi-context file is a valid known kind", () => {
    const { ast } = run(
      '<div class="c">hello ${ let x = 1; } world</>\n< db></>\n^{ let m = 2; }'
    );
    const kinds = collectKinds(ast.nodes);
    for (const k of kinds) {
      if (k.startsWith("attr:")) continue; // attr value kinds are internal
      expect(VALID_KINDS.has(k)).toBe(true);
    }
  });
});
