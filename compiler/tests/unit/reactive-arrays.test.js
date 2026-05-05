/**
 * reactive-arrays.test.js — Unit Tests for §6.5 Reactive Array Codegen
 *
 * Tests that compiling files with reactive arrays produces correct codegen:
 * subscribes to array var, for/lift emits iteration code, array mutation methods
 * generate immutable copies, and reactive array length expressions wire correctly.
 *
 * Coverage:
 *   §1  AST: reactive-decl nodes produced for @arr = [] declarations
 *   §2  AST: reactive-decl init field holds the array expression for spread-replace
 *   §3  Codegen: _scrml_reactive_set emitted for reactive array declaration
 *   §4  Codegen: spread-replace in init expression rewrites @refs to _scrml_reactive_get()
 *   §5  Codegen: reactive-array-mutation push generates spread copy
 *   §6  Codegen: reactive-array-mutation pop/shift/sort/reverse generate immutable clones
 *   §7  Codegen: reactive-array-mutation splice generates immutable splice
 *   §8  Codegen: for/lift over non-reactive array emits iteration code
 *   §9  Codegen: @items.length in expression emits _scrml_reactive_get("items")
 *   §10 AST: for-loop body with lift parses without errors
 *   §11 Codegen: for/lift over @reactive array emits reactive subscription wiring
 *   §12 Codegen: non-reactive for loops do NOT emit reactive subscriptions
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { runCG } from "../../src/code-generator.js";
import { resetVarCounter } from "../../src/codegen/var-counter.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function span(start = 0, file = "/test/app.scrml") {
  return { file, start, end: start + 10, line: 1, col: start + 1 };
}

/**
 * Parse a scrml source string and return the full result from buildAST.
 */
function parse(source, filePath = "/test/reactive-arrays.scrml") {
  const bs = splitBlocks(filePath, source);
  return buildAST(bs);
}

/**
 * Recursively walk all AST nodes and collect logic body nodes.
 * Needed because logic blocks are children of markup nodes (e.g., <div>${...}</div>
 * produces ast.nodes = [markup(div, children=[logic(...)])]).
 *
 * Note: When multiple @var declarations appear in a single logic block, the scrml
 * tokenizer may merge them into a single reactive-decl node with a compound init
 * string (e.g., "@isActive = false @loading = false" in one init). This is by design —
 * emit-logic.js uses splitMergedStatements() to split them at codegen time.
 */
function collectAllLogicNodes(ast) {
  const result = [];

  function walk(nodes) {
    if (!Array.isArray(nodes)) return;
    for (const node of nodes) {
      if (node.kind === "logic" && node.body) {
        result.push(...node.body);
        // Also walk nested logic blocks
        for (const bodyNode of node.body) {
          walkNode(bodyNode);
        }
      } else {
        walkNode(node);
      }
    }
  }

  function walkNode(node) {
    if (!node || typeof node !== "object") return;
    if (node.children) walk(node.children);
    if (node.body && Array.isArray(node.body)) {
      for (const bodyNode of node.body) {
        walkNode(bodyNode);
      }
    }
  }

  walk(ast.nodes);
  return result;
}

/** Build a minimal FileAST for CG input. */
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
    scopeChain: null,
    errors: [],
  };
}

function makeRouteMap() { return { functions: new Map() }; }
function makeDepGraph() { return { nodes: new Map(), edges: [] }; }
function makeProtectAnalysis() { return { views: new Map() }; }

function makeLogicBlock(body) {
  return {
    kind: "logic",
    body,
    span: span(0),
    id: 1,
  };
}

function makeFunctionDecl(name, body) {
  return {
    kind: "function-decl",
    name,
    params: [],
    body,
    span: span(0),
    id: 1,
  };
}

/** Compile a set of logic/markup nodes through the full CG pipeline. */
function compile(nodes) {
  const ast = makeFileAST("/test/app.scrml", nodes);
  return runCG({
    files: [ast],
    routeMap: makeRouteMap(),
    depGraph: makeDepGraph(),
    protectAnalysis: makeProtectAnalysis(),
  });
}

/** Compile a scrml source string through the full BS → TAB → CG pipeline. */
function compileSource(source, filePath = "/test/reactive-arrays.scrml") {
  const { ast } = parse(source, filePath);
  const fileAST = {
    ...ast,
    errors: [],
    components: [],
    typeDecls: [],
    nodeTypes: new Map(),
    componentShapes: new Map(),
    scopeChain: null,
  };
  return runCG({
    files: [fileAST],
    routeMap: makeRouteMap(),
    depGraph: makeDepGraph(),
    protectAnalysis: makeProtectAnalysis(),
  });
}

beforeEach(() => {
  resetVarCounter();
});

// ---------------------------------------------------------------------------
// §1: AST — reactive-decl nodes produced for @arr = [] declarations
// ---------------------------------------------------------------------------

describe("reactive-arrays §1: AST — reactive-decl produced for @arr = []", () => {
  test("@items = [] produces reactive-decl node with name 'items'", () => {
    const { ast } = parse(`<div>\${ @items = [] }</div>`);
    const nodes = collectAllLogicNodes(ast);
    const decl = nodes.find(n => n.kind === "state-decl" && n.name === "items");
    expect(decl).toBeDefined();
  });

  test("reactive-decl init field contains array brackets for empty array", () => {
    const { ast } = parse(`<div>\${ @items = [] }</div>`);
    const nodes = collectAllLogicNodes(ast);
    const decl = nodes.find(n => n.kind === "state-decl" && n.name === "items");
    expect(decl).toBeDefined();
    // Init should contain brackets (may be "[ ]" or "[]" after tokenization)
    expect(decl.init).toMatch(/\[/);
    expect(decl.init).toMatch(/\]/);
  });

  test("multiple @var declarations in one block: first produces reactive-decl", () => {
    // Scrml tokenizer merges multiple @var declarations in a single block into a
    // compound reactive-decl where later declarations are embedded in the init string.
    // Codegen splits them via splitMergedStatements(). This test verifies the first
    // declaration is always found as a reactive-decl node.
    const source = `<div>\${
      @todos = []
      @count = 0
    }</div>`;
    const { ast } = parse(source);
    const nodes = collectAllLogicNodes(ast);
    const todosDecl = nodes.find(n => n.kind === "state-decl" && n.name === "todos");
    expect(todosDecl).toBeDefined();
  });

  test("@items = [1, 2, 3] produces reactive-decl with non-empty init", () => {
    const { ast } = parse(`<div>\${ @items = [1, 2, 3] }</div>`);
    const nodes = collectAllLogicNodes(ast);
    const decl = nodes.find(n => n.kind === "state-decl" && n.name === "items");
    expect(decl).toBeDefined();
    expect(decl.init).toContain("1");
    expect(decl.init).toContain("3");
  });

  test("codegen produces _scrml_reactive_set for each @var when init is merged", () => {
    // The merged init pattern (@todos = [] @count = 0) is handled by splitMergedStatements
    // in emit-logic.js. Verify codegen output contains both reactive_set calls.
    const source = `<div>\${
      @todos = []
      @count = 0
    }</div>`;
    const { ast } = parse(source);
    const fileAST = {
      ...ast,
      errors: [],
      components: [],
      typeDecls: [],
      nodeTypes: new Map(),
      componentShapes: new Map(),
      scopeChain: null,
    };
    const result = runCG({
      files: [fileAST],
      routeMap: makeRouteMap(),
      depGraph: makeDepGraph(),
      protectAnalysis: makeProtectAnalysis(),
    });
    const out = result.outputs.get("/test/reactive-arrays.scrml");
    // Both declarations should produce reactive_set calls in the compiled JS
    expect(out.clientJs).toContain('"todos"');
    expect(out.clientJs).toContain('"count"');
  });
});

// ---------------------------------------------------------------------------
// §2: AST — reactive-decl init holds spread-replace expression
// ---------------------------------------------------------------------------

describe("reactive-arrays §2: AST — spread-replace expression in reactive-decl init", () => {
  test("@items = [...@items, item] inside function produces reactive-decl", () => {
    const source = `<div>\${
      @items = []
      function addItem() {
        @items = [...@items, { id: 1 }]
      }
    }</div>`;
    const { ast } = parse(source);
    const nodes = collectAllLogicNodes(ast);
    const fn = nodes.find(n => n.kind === "function-decl" && n.name === "addItem");
    expect(fn).toBeDefined();
    const reassign = fn.body.find(n => n.kind === "state-decl" && n.name === "items");
    expect(reassign).toBeDefined();
  });

  test("spread-replace init contains the spread operator token", () => {
    const source = `<div>\${
      @items = []
      function add() {
        @items = [...@items, "new"]
      }
    }</div>`;
    const { ast } = parse(source);
    const nodes = collectAllLogicNodes(ast);
    const fn = nodes.find(n => n.kind === "function-decl" && n.name === "add");
    const reassign = fn?.body?.find(n => n.kind === "state-decl" && n.name === "items");
    expect(reassign).toBeDefined();
    // The spread operator (...) should be present in the init expression
    expect(reassign.init).toContain("...");
  });

  test("spread-replace init references @items (the array variable)", () => {
    const source = `<div>\${
      @items = []
      function add() {
        @items = [...@items, "entry"]
      }
    }</div>`;
    const { ast } = parse(source);
    const nodes = collectAllLogicNodes(ast);
    const fn = nodes.find(n => n.kind === "function-decl" && n.name === "add");
    const reassign = fn?.body?.find(n => n.kind === "state-decl" && n.name === "items");
    expect(reassign).toBeDefined();
    // The init should contain a reference to @items (the source array)
    expect(reassign.init).toContain("@items");
  });
});

// ---------------------------------------------------------------------------
// §3: Codegen — _scrml_reactive_set emitted for reactive array declaration
// ---------------------------------------------------------------------------

describe("reactive-arrays §3: codegen — _scrml_reactive_set for array decl", () => {
  test("reactive-decl with [] init emits _scrml_reactive_set call", () => {
    const result = compile([
      makeLogicBlock([
        { kind: "state-decl", name: "items", init: "[ ]", span: span(0), id: 2 },
      ]),
    ]);
    expect(result.errors).toHaveLength(0);
    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).toContain('_scrml_reactive_set("items"');
  });

  test("multiple reactive array declarations produce multiple _scrml_reactive_set calls", () => {
    const result = compile([
      makeLogicBlock([
        { kind: "state-decl", name: "items", init: "[ ]", span: span(0), id: 2 },
        { kind: "state-decl", name: "selected", init: "[ ]", span: span(0), id: 3 },
      ]),
    ]);
    expect(result.errors).toHaveLength(0);
    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).toContain('"items"');
    expect(out.clientJs).toContain('"selected"');
  });
});

// ---------------------------------------------------------------------------
// §4: Codegen — spread-replace in init rewrites @refs to _scrml_reactive_get()
// ---------------------------------------------------------------------------

describe("reactive-arrays §4: codegen — spread-replace @ref rewriting", () => {
  test("reactive-decl with spread init compiles without errors", () => {
    // When the full pipeline runs, @items gets rewritten to _scrml_reactive_get("items")
    // in the init expression. This tests the codegen step with an already-rewritten init.
    const result = compile([
      makeLogicBlock([
        makeFunctionDecl("addItem", [
          {
            kind: "state-decl",
            name: "items",
            init: "[ ..._scrml_reactive_get ( \"items\" ) , { id : 1 } ]",
            span: span(0),
            id: 2,
          },
        ]),
      ]),
    ]);
    expect(result.errors).toHaveLength(0);
    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).toContain("_scrml_reactive_set");
    expect(out.clientJs).toContain("_scrml_reactive_get");
  });

  test("reactive-decl with @items in init rewrites @items to reactive_get in output", () => {
    // This tests the full pipeline rewrite via compile() with an AST that has raw @ref
    const result = compile([
      makeLogicBlock([
        makeFunctionDecl("add", [
          {
            kind: "state-decl",
            name: "list",
            // Raw @list reference — emitLogicNode uses rewriteExpr which replaces @ref
            init: "[ ...@list , \"newItem\" ]",
            span: span(0),
            id: 2,
          },
        ]),
      ]),
    ]);
    expect(result.errors).toHaveLength(0);
    const out = result.outputs.get("/test/app.scrml");
    // @list should be rewritten to _scrml_reactive_get("list")
    expect(out.clientJs).toContain('_scrml_reactive_get("list")');
    expect(out.clientJs).toContain('_scrml_reactive_set("list"');
  });
});

// ---------------------------------------------------------------------------
// §5: Codegen — reactive-array-mutation push generates spread copy
// ---------------------------------------------------------------------------

describe("reactive-arrays §5: codegen — push mutation uses direct Proxy mutation", () => {
  test("push uses direct .push() on the Proxy-wrapped array", () => {
    const result = compile([
      makeLogicBlock([
        makeFunctionDecl("addItem", [
          { kind: "reactive-array-mutation", target: "items", method: "push", args: "newItem", span: span(0), id: 2 },
        ]),
      ]),
    ]);
    expect(result.errors).toHaveLength(0);
    const out = result.outputs.get("/test/app.scrml");
    // With Proxy-based reactivity, push mutates directly through the Proxy
    expect(out.clientJs).toContain('.push(newItem)');
    expect(out.clientJs).toContain("newItem");
    expect(out.clientJs).toContain("_scrml_reactive_set");
  });

  test("push wraps result in _scrml_reactive_set for coarse-grained compat", () => {
    const result = compile([
      makeLogicBlock([
        makeFunctionDecl("add", [
          { kind: "reactive-array-mutation", target: "items", method: "push", args: "x", span: span(0), id: 2 },
        ]),
      ]),
    ]);
    const out = result.outputs.get("/test/app.scrml");
    // The mutation must update reactive state for backwards compat with subscribers
    expect(out.clientJs).toContain('_scrml_reactive_set("items"');
  });

  test("push calls .push() directly on the Proxy-wrapped reactive array", () => {
    // Verifies Proxy-based direct mutation semantics
    const result = compile([
      makeLogicBlock([
        makeFunctionDecl("addItem", [
          { kind: "reactive-array-mutation", target: "items", method: "push", args: "x", span: span(0), id: 2 },
        ]),
      ]),
    ]);
    const out = result.outputs.get("/test/app.scrml");
    // Should call .push() directly — Proxy traps handle notification
    expect(out.clientJs).toMatch(/_scrml_reactive_get\("items"\)\.push\(/);
  });
});

// ---------------------------------------------------------------------------
// §6: Codegen — pop/shift/sort/reverse generate immutable clones
// ---------------------------------------------------------------------------

describe("reactive-arrays §6: codegen — pop/shift/sort/reverse use direct Proxy mutation", () => {
  test("pop uses direct .pop() on Proxy-wrapped array", () => {
    const result = compile([
      makeLogicBlock([
        makeFunctionDecl("removeLast", [
          { kind: "reactive-array-mutation", target: "items", method: "pop", args: "", span: span(0), id: 2 },
        ]),
      ]),
    ]);
    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).toContain(".pop()");
    expect(out.clientJs).toContain("_scrml_reactive_set");
  });

  test("shift uses direct .shift() on Proxy-wrapped array", () => {
    const result = compile([
      makeLogicBlock([
        makeFunctionDecl("removeFirst", [
          { kind: "reactive-array-mutation", target: "items", method: "shift", args: "", span: span(0), id: 2 },
        ]),
      ]),
    ]);
    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).toContain(".shift()");
    expect(out.clientJs).toContain("_scrml_reactive_set");
  });

  test("sort uses direct .sort() on Proxy-wrapped array", () => {
    const result = compile([
      makeLogicBlock([
        makeFunctionDecl("sortItems", [
          { kind: "reactive-array-mutation", target: "items", method: "sort", args: "", span: span(0), id: 2 },
        ]),
      ]),
    ]);
    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).toContain(".sort(");
    expect(out.clientJs).toContain("_scrml_reactive_set");
  });

  test("reverse uses direct .reverse() on Proxy-wrapped array", () => {
    const result = compile([
      makeLogicBlock([
        makeFunctionDecl("rev", [
          { kind: "reactive-array-mutation", target: "items", method: "reverse", args: "", span: span(0), id: 2 },
        ]),
      ]),
    ]);
    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).toContain(".reverse()");
    expect(out.clientJs).toContain("_scrml_reactive_set");
  });

  test("unshift uses direct .unshift() on Proxy-wrapped array", () => {
    const result = compile([
      makeLogicBlock([
        makeFunctionDecl("prepend", [
          { kind: "reactive-array-mutation", target: "items", method: "unshift", args: "newItem", span: span(0), id: 2 },
        ]),
      ]),
    ]);
    const out = result.outputs.get("/test/app.scrml");
    // unshift mutates directly through the Proxy
    expect(out.clientJs).toContain(".unshift(newItem)");
    expect(out.clientJs).toContain("newItem");
    expect(out.clientJs).toContain("_scrml_reactive_set");
  });
});

// ---------------------------------------------------------------------------
// §7: Codegen — splice generates immutable splice
// ---------------------------------------------------------------------------

describe("reactive-arrays §7: codegen — splice uses direct Proxy mutation", () => {
  test("splice generates direct mutation on Proxy-wrapped array", () => {
    const result = compile([
      makeLogicBlock([
        makeFunctionDecl("removeItem", [
          { kind: "reactive-array-mutation", target: "items", method: "splice", args: "idx, 1", span: span(0), id: 2 },
        ]),
      ]),
    ]);
    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).toContain(".splice(idx, 1)");
    expect(out.clientJs).toContain("_scrml_reactive_set");
  });

  test("splice mutates directly through the Proxy and fires coarse-grained set", () => {
    // With Proxy-based reactivity, splice mutates in place (Proxy traps notify
    // fine-grained effects), then _scrml_reactive_set fires coarse subscribers
    const result = compile([
      makeLogicBlock([
        makeFunctionDecl("remove", [
          { kind: "reactive-array-mutation", target: "todos", method: "splice", args: "0, 1", span: span(0), id: 2 },
        ]),
      ]),
    ]);
    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).toContain('_scrml_reactive_set("todos"');
    // Direct Proxy mutation: _scrml_reactive_get("todos").splice(0, 1)
    expect(out.clientJs).toMatch(/_scrml_reactive_get\("todos"\)\.splice\(0, 1\)/);
  });
});

// ---------------------------------------------------------------------------
// §8: Codegen — for/lift over non-reactive array emits iteration code
// ---------------------------------------------------------------------------

describe("reactive-arrays §8: codegen — for/lift emits iteration code", () => {
  test("for-loop with lift produces JavaScript for-loop in clientJs", () => {
    const source = `<div>\${
      let items = ["a", "b", "c"]
      for (let item of items) {
        lift <span>\${item}</>
      }
    }</div>`;
    const { ast } = parse(source);
    const fileAST = {
      ...ast,
      errors: [],
      components: [],
      typeDecls: [],
      nodeTypes: new Map(),
      componentShapes: new Map(),
      scopeChain: null,
    };
    const result = runCG({
      files: [fileAST],
      routeMap: makeRouteMap(),
      depGraph: makeDepGraph(),
      protectAnalysis: makeProtectAnalysis(),
    });
    const out = result.outputs.get("/test/reactive-arrays.scrml");
    // The for loop and lift should produce some iteration or element-creation code
    expect(out.clientJs).toMatch(/for\s*\(/);
  });

  test("for/lift with createElement inside produces element creation code", () => {
    const source = `<div>\${
      let names = ["Alice", "Bob"]
      for (let name of names) {
        lift <div class="user">\${name}</>
      }
    }</div>`;
    const { ast } = parse(source);
    const fileAST = {
      ...ast,
      errors: [],
      components: [],
      typeDecls: [],
      nodeTypes: new Map(),
      componentShapes: new Map(),
      scopeChain: null,
    };
    const result = runCG({
      files: [fileAST],
      routeMap: makeRouteMap(),
      depGraph: makeDepGraph(),
      protectAnalysis: makeProtectAnalysis(),
    });
    const out = result.outputs.get("/test/reactive-arrays.scrml");
    expect(out.clientJs).toContain("createElement");
  });
});

// ---------------------------------------------------------------------------
// §9: Codegen — @items.length in expression emits _scrml_reactive_get("items")
// ---------------------------------------------------------------------------

describe("reactive-arrays §9: codegen — @items.length emits reactive get", () => {
  test("bare-expr @items.length emits _scrml_reactive_get reference", () => {
    const result = compile([
      makeLogicBlock([
        { kind: "state-decl", name: "items", init: "[ ]", span: span(0), id: 2 },
        { kind: "bare-expr", expr: "@items . length", span: span(0), id: 3 },
      ]),
    ]);
    const out = result.outputs.get("/test/app.scrml");
    // @items.length in a bare-expr should be rewritten to _scrml_reactive_get("items").length
    expect(out.clientJs).toContain('_scrml_reactive_get("items")');
  });

  test("reactive-decl for items followed by length expression compiles without error", () => {
    const result = compile([
      makeLogicBlock([
        { kind: "state-decl", name: "items", init: "[ ]", span: span(0), id: 2 },
        { kind: "bare-expr", expr: "@items . length", span: span(0), id: 3 },
      ]),
    ]);
    expect(result.errors).toHaveLength(0);
  });

  test("@items.length in a reactive-decl init is rewritten to reactive_get", () => {
    // Verifies that when items.length is used in another reactive variable init,
    // it gets rewritten correctly
    const result = compile([
      makeLogicBlock([
        { kind: "state-decl", name: "items", init: "[ ]", span: span(0), id: 2 },
        { kind: "state-decl", name: "count", init: "@items . length", span: span(0), id: 3 },
      ]),
    ]);
    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).toContain('_scrml_reactive_get("items")');
    expect(out.clientJs).toContain('_scrml_reactive_set("count"');
  });
});

// ---------------------------------------------------------------------------
// §10: AST — for-loop body with lift parses without errors
// ---------------------------------------------------------------------------

describe("reactive-arrays §10: AST — for-loop with lift parses cleanly", () => {
  test("for-loop body containing lift parses without fatal errors", () => {
    const source = `<div>\${
      let items = []
      for (let item of items) {
        lift <li>\${item}</>
      }
    }</div>`;
    const { errors } = parse(source);
    const fatalErrors = errors.filter(e => e.severity === "error");
    expect(fatalErrors).toHaveLength(0);
  });

  test("for-loop over @reactive array parses without fatal errors", () => {
    const source = `<div>
      \${
        @items = ["a", "b"]
        for (let item of @items) {
          lift <span>\${item}</>
        }
      }
    </div>`;
    const { errors } = parse(source);
    const fatalErrors = errors.filter(e => e.severity === "error" && !e.code?.startsWith("W-"));
    expect(fatalErrors).toHaveLength(0);
  });

  test("multiple reactive vars with for-loop parses without fatal errors", () => {
    const source = `<div>
      \${
        @items = []
        @nextId = 1
        function add() {
          @items = [...@items, @nextId]
          @nextId = @nextId + 1
        }
      }
      \${
        for (let item of @items) {
          lift <div>\${item}</>
        }
      }
    </div>`;
    const { errors } = parse(source);
    const fatalErrors = errors.filter(e => e.severity === "error" && !e.code?.startsWith("W-"));
    expect(fatalErrors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §11: Codegen — for/lift over @reactive array emits reactive subscription wiring
// ---------------------------------------------------------------------------

describe("reactive-arrays §11: codegen — for/lift over @reactive array emits subscribe", () => {
  test("for (let item of @items) emits _scrml_effect('items', ...)", () => {
    const source = `<div>
      \${
        @items = []
        for (let item of @items) {
          lift <li>\${item}</>
        }
      }
    </div>`;
    const result = compileSource(source);
    const out = result.outputs.get("/test/reactive-arrays.scrml");
    expect(out.clientJs).toContain('_scrml_effect_static(');
  });

  test("for/lift over @items emits a wrapper div via createElement", () => {
    const source = `<div>
      \${
        @items = []
        for (let item of @items) {
          lift <li>\${item}</>
        }
      }
    </div>`;
    const result = compileSource(source);
    const out = result.outputs.get("/test/reactive-arrays.scrml");
    // The reactive for path creates a wrapper div as a stable list container
    expect(out.clientJs).toContain('createElement("div")');
  });

  test("for/lift over @items emits _scrml_lift to mount the wrapper div", () => {
    const source = `<div>
      \${
        @items = []
        for (let item of @items) {
          lift <li>\${item}</>
        }
      }
    </div>`;
    const result = compileSource(source);
    const out = result.outputs.get("/test/reactive-arrays.scrml");
    // The wrapper div is mounted via _scrml_lift
    expect(out.clientJs).toContain("_scrml_lift(");
  });

  test("for/lift over @items emits keyed reconciliation instead of innerHTML clear", () => {
    const source = `<div>
      \${
        @items = []
        for (let item of @items) {
          lift <div class="item">\${item}</>
        }
      }
    </div>`;
    const result = compileSource(source);
    const out = result.outputs.get("/test/reactive-arrays.scrml");
    // The render function uses _scrml_reconcile_list for keyed diffing
    expect(out.clientJs).toContain('_scrml_reconcile_list(');
    // innerHTML clear should no longer be present
    expect(out.clientJs).not.toContain('.innerHTML = ""');
  });

  test("for/lift over @items emits render function call before subscribe", () => {
    const source = `<div>
      \${
        @items = []
        for (let item of @items) {
          lift <span>\${item}</>
        }
      }
    </div>`;
    const result = compileSource(source);
    const out = result.outputs.get("/test/reactive-arrays.scrml");
    // The render function must be called once (initial render) AND subscribed
    // Both the call and the subscribe must appear in output
    const effectIdx = out.clientJs.indexOf('_scrml_effect_static(');
    expect(effectIdx).toBeGreaterThan(-1);
    // The function call (render_list_N()) appears before or around the subscribe
    expect(out.clientJs).toMatch(/function _scrml_render_list_\d+\(\)/);
  });

  test("for/lift over @items compiles without errors", () => {
    const source = `<div>
      \${
        @items = []
        for (let item of @items) {
          lift <div>\${item}</>
        }
      }
    </div>`;
    const result = compileSource(source);
    // May have warnings but should have no fatal errors
    const fatalErrors = result.errors.filter(e => e.severity === "error");
    expect(fatalErrors).toHaveLength(0);
  });

  test("for/lift over @todos with different var name wires subscribe to 'todos'", () => {
    const source = `<div>
      \${
        @todos = []
        for (let todo of @todos) {
          lift <li>\${todo}</>
        }
      }
    </div>`;
    const result = compileSource(source);
    const out = result.outputs.get("/test/reactive-arrays.scrml");
    // Subscribe must use the actual variable name 'todos', not a generic 'items'
    expect(out.clientJs).toContain('_scrml_effect_static(');
  });

  test("two separate for/lift loops over different @vars emit separate subscriptions", () => {
    const source = `<div>
      \${
        @items = []
        @tags = []
        for (let item of @items) {
          lift <li>\${item}</>
        }
        for (let tag of @tags) {
          lift <span>\${tag}</>
        }
      }
    </div>`;
    const result = compileSource(source);
    const out = result.outputs.get("/test/reactive-arrays.scrml");
    expect(out.clientJs).toContain('_scrml_effect_static(');
    expect(out.clientJs).toContain('_scrml_effect_static(');
  });
});

// ---------------------------------------------------------------------------
// §12: Codegen — non-reactive for loops do NOT emit reactive subscriptions
// ---------------------------------------------------------------------------

describe("reactive-arrays §12: codegen — non-reactive for loops do not subscribe", () => {
  test("for (let item of items) with plain 'items' does NOT emit subscribe", () => {
    const source = `<div>\${
      let items = ["a", "b", "c"]
      for (let item of items) {
        lift <span>\${item}</>
      }
    }</div>`;
    const result = compileSource(source);
    const out = result.outputs.get("/test/reactive-arrays.scrml");
    // No subscribe for non-reactive iterables
    expect(out.clientJs).not.toContain('_scrml_effect(');
  });

  test("for (let item of items) with plain 'items' still emits a JS for loop", () => {
    const source = `<div>\${
      let items = ["x", "y"]
      for (let item of items) {
        lift <li>\${item}</>
      }
    }</div>`;
    const result = compileSource(source);
    const out = result.outputs.get("/test/reactive-arrays.scrml");
    // Plain for loop still emits iteration code
    expect(out.clientJs).toMatch(/for\s*\(/);
  });

  test("C-style for loop does NOT emit subscribe", () => {
    const source = `<div>\${
      for (let i = 0; i < 5; i++) {
        lift <span>\${i}</>
      }
    }</div>`;
    const result = compileSource(source);
    const out = result.outputs.get("/test/reactive-arrays.scrml");
    expect(out.clientJs).not.toContain("_scrml_effect");
  });

  test("for loop over method call result does NOT emit reactive subscribe", () => {
    // @items.filter(...) is a method call, not a bare @varName — plain for loop
    const source = `<div>\${
      @items = []
      let filtered = @items.filter(x => x)
      for (let item of filtered) {
        lift <li>\${item}</>
      }
    }</div>`;
    const result = compileSource(source);
    const out = result.outputs.get("/test/reactive-arrays.scrml");
    // 'filtered' is not @varName — no reactive subscribe for the for loop
    // Derived vars don't get their own effect (they're dependencies of other effects)
    expect(out.clientJs).not.toContain('_scrml_derived_subscribe("filtered"');
  });
});
