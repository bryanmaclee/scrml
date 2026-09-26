/**
 * when @var changes {} — Reactive Effects (§6.7.4)
 *
 * Tests for the when-effect AST node and codegen output.
 *
 * §1  Single dependency parses correctly
 * §2  Multi-dependency parses correctly
 * §3  Codegen emits _scrml_when_changes + one _scrml_reactive_subscribe per dependency
 * §4  Body contains rewritten reactive references
 * §5  when does not emit on mount (no immediate call)
 * §6  Keywords "when" and "changes" are recognized
 */

import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { tokenizeLogic } from "../../src/tokenizer.js";
import { emitLogicNode } from "../../src/codegen/emit-logic.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseSource(source, filePath = "/test/app.scrml") {
  const bsResult = splitBlocks(filePath, source);
  const tabResult = buildAST(bsResult);
  return tabResult;
}

function findNodes(nodes, kind) {
  const found = [];
  function walk(list) {
    for (const node of list) {
      if (!node) continue;
      if (node.kind === kind) found.push(node);
      if (Array.isArray(node.children)) walk(node.children);
      if (Array.isArray(node.body)) walk(node.body);
    }
  }
  walk(nodes);
  return found;
}

// ---------------------------------------------------------------------------
// §1: Single dependency
// ---------------------------------------------------------------------------

describe("§1: single dependency when effect", () => {
  test("parses when @query changes { body }", () => {
    const source = `<program>
@query = ""
@page = 1
\${ when @query changes { @page = 1 } }
</>`;
    const { ast, errors } = parseSource(source);
    const whenNodes = findNodes(ast.nodes, "when-effect");
    expect(whenNodes).toHaveLength(1);
    expect(whenNodes[0].dependencies).toEqual(["query"]);
  });

  test("body raw contains the effect body", () => {
    const source = `<program>
@query = ""
@page = 1
\${ when @query changes { @page = 1 } }
</>`;
    const { ast } = parseSource(source);
    const whenNodes = findNodes(ast.nodes, "when-effect");
    expect(whenNodes[0].bodyRaw).toContain("@page");
    expect(whenNodes[0].bodyRaw).toContain("1");
  });
});

// ---------------------------------------------------------------------------
// §2: Multi-dependency
// ---------------------------------------------------------------------------

describe("§2: multi-dependency when effect", () => {
  test("parses when (@query, @minPrice) changes { body }", () => {
    const source = `<program>
@query = ""
@minPrice = 0
@page = 1
\${ when (@query, @minPrice) changes { @page = 1 } }
</>`;
    const { ast } = parseSource(source);
    const whenNodes = findNodes(ast.nodes, "when-effect");
    expect(whenNodes).toHaveLength(1);
    expect(whenNodes[0].dependencies).toEqual(["query", "minPrice"]);
  });

  test("three dependencies parse correctly", () => {
    const source = `<program>
@a = 1
@b = 2
@c = 3
@result = 0
\${ when (@a, @b, @c) changes { @result = @a + @b + @c } }
</>`;
    const { ast } = parseSource(source);
    const whenNodes = findNodes(ast.nodes, "when-effect");
    expect(whenNodes[0].dependencies).toEqual(["a", "b", "c"]);
  });
});

// ---------------------------------------------------------------------------
// §3: Codegen emits subscriptions
//
// SPEC §6.7.4: "The body executes whenever any listed dependency changes value.
// Change detection is based on `_scrml_reactive_set` calls" and "The dependency
// list is explicit and exhaustive. The compiler does NOT auto-track `@variable`
// reads inside the body." So the effect is one `_scrml_reactive_subscribe` per
// LISTED dep — never a `_scrml_effect`, which auto-tracks the body's reads (S429:
// these tests used to pin `_scrml_effect(`, the non-conformant shape).
// ---------------------------------------------------------------------------

describe("§3: codegen subscribes to the dep-list, not the body's reads", () => {
  test("single dep emits one subscription inside _scrml_when_changes", () => {
    const node = {
      kind: "when-effect",
      dependencies: ["query"],
      bodyRaw: "@page = 1",
    };
    const output = emitLogicNode(node, { fnNameMap: new Map() });
    expect(output).toContain("_scrml_when_changes(");
    expect(output).toContain('_scrml_reactive_subscribe("query", _h)');
    expect(output).not.toContain("_scrml_effect(");
  });

  test("multi dep emits one subscription per listed dep", () => {
    const node = {
      kind: "when-effect",
      dependencies: ["query", "minPrice"],
      bodyRaw: "@page = 1",
    };
    const output = emitLogicNode(node, { fnNameMap: new Map() });
    expect(output).toContain('_scrml_reactive_subscribe("query", _h)');
    expect(output).toContain('_scrml_reactive_subscribe("minPrice", _h)');
    expect(output.match(/_scrml_reactive_subscribe\(/g)).toHaveLength(2);
    expect(output).not.toContain("_scrml_effect(");
  });

  test("an unlisted @var read in the body is NOT subscribed", () => {
    // SPEC §6.7.4: "Reading an unlisted `@variable` inside the `when` body is
    // valid ... without making that variable a trigger."
    const node = {
      kind: "when-effect",
      dependencies: ["n"],
      bodyRaw: '@log = @log + "n:" + @m',
    };
    const output = emitLogicNode(node, { fnNameMap: new Map() });
    expect(output).toContain('_scrml_reactive_subscribe("n", _h)');
    expect(output).not.toContain('_scrml_reactive_subscribe("m"');
    expect(output).not.toContain('_scrml_reactive_subscribe("log"');
    // …but the body still reads it (the current value at fire time).
    expect(output).toContain('_scrml_reactive_get("m")');
  });

  test("a dep listed twice subscribes once (one fire per write)", () => {
    const node = {
      kind: "when-effect",
      dependencies: ["a", "a", "b"],
      bodyRaw: "@page = 1",
    };
    const output = emitLogicNode(node, { fnNameMap: new Map() });
    expect(output.match(/_scrml_reactive_subscribe\("a"/g)).toHaveLength(1);
    expect(output.match(/_scrml_reactive_subscribe\(/g)).toHaveLength(2);
  });

  test("dep keys go through the encoding context like the body's own reads", () => {
    const node = {
      kind: "when-effect",
      dependencies: ["query"],
      bodyRaw: "@page = 1",
    };
    const encodingCtx = { encode: (n) => "enc_" + n };
    const output = emitLogicNode(node, { fnNameMap: new Map(), encodingCtx });
    expect(output).toContain('_scrml_reactive_subscribe("enc_query", _h)');
  });

  test("a body with no server call is a plain (non-async) function", () => {
    const node = {
      kind: "when-effect",
      dependencies: ["query"],
      bodyRaw: "@page = 1",
    };
    const output = emitLogicNode(node, { fnNameMap: new Map() });
    expect(output).not.toContain("async function");
    // No doubled terminator at the body's end (cosmetic rider of the S385 gap).
    expect(output).not.toMatch(/;;\s*\}\);$/);
  });

  test("a body calling a server fn is an async function that awaits the call (§6.7.4 / §13.2)", () => {
    const node = {
      kind: "when-effect",
      dependencies: ["n"],
      bodyRaw: "@log = double(@n)\nconst r = double(1)\n@out = r",
    };
    const output = emitLogicNode(node, { fnNameMap: new Map(), whenServerFnNames: new Set(["double"]) });
    expect(output).toContain("async function()");
    // expression position (AST path) and statement position (block injector)
    expect(output).toContain('_scrml_reactive_set("log", await double(_scrml_reactive_get("n")))');
    expect(output).toContain("const r = await double(1)");
  });
});

// ---------------------------------------------------------------------------
// §4: Body rewriting
// ---------------------------------------------------------------------------

describe("§4: body contains rewritten reactive references", () => {
  test("@var reads in body become _scrml_reactive_get", () => {
    // emitLogicNode imported at top level
    const node = {
      kind: "when-effect",
      dependencies: ["query"],
      bodyRaw: "@page = 1",
    };
    const output = emitLogicNode(node, { fnNameMap: new Map() });
    // rewriteExpr converts @page = 1 to _scrml_reactive_set("page", 1)
    expect(output).toContain("_scrml_reactive_set(\"page\", 1)");
  });
});

// ---------------------------------------------------------------------------
// §5: Does not execute on mount
//
// SPEC §6.7.4: "The body of a `when` statement SHALL NOT execute on initial
// mount." `_scrml_effect(fn)` runs fn at registration, so the old test —
// which asserted `_scrml_effect(` was present — pinned the violation. The
// emitted registration must be one that does not call the body.
// ---------------------------------------------------------------------------

describe("§5: when does not emit immediate execution", () => {
  test("output registers the body through _scrml_when_changes, not _scrml_effect", () => {
    const node = {
      kind: "when-effect",
      dependencies: ["query"],
      bodyRaw: "@page = 1",
    };
    const output = emitLogicNode(node, { fnNameMap: new Map() });
    expect(output).not.toContain("_scrml_effect(");
    expect(output).toMatch(/^_scrml_when_changes\(function\(_h\) \{ return \[[^\]]*\]; \}, function\(\) \{ /);
  });
});

// ---------------------------------------------------------------------------
// §6: Keywords recognized
// ---------------------------------------------------------------------------

describe("§6: when and changes are keywords", () => {
  test("when tokenizes as KEYWORD", () => {
    const tokens = tokenizeLogic("when", 0, 1, 1, []);
    const whenTok = tokens.find(t => t.text === "when");
    expect(whenTok).toBeDefined();
    expect(whenTok.kind).toBe("KEYWORD");
  });

  test("changes tokenizes as KEYWORD", () => {
    const tokens = tokenizeLogic("changes", 0, 1, 1, []);
    const changesTok = tokens.find(t => t.text === "changes");
    expect(changesTok).toBeDefined();
    expect(changesTok.kind).toBe("KEYWORD");
  });
});
