/**
 * BUG-R14-005: State block event wiring — regression tests
 *
 * When a scrml file wraps all markup inside a `< db>` state block, the compiled
 * client JS must still produce a DOMContentLoaded block that wires onclick handlers.
 *
 * Root cause: emit-html.js emitNode() had no handler for kind === "state" nodes.
 * State nodes were silently skipped, their children (including markup with onclick
 * attributes) were never visited, and the BindingRegistry received no event bindings.
 * emitEventWiring saw empty eventBindings and skipped the DOMContentLoaded block.
 *
 * Fix: emit-html.js lines 74-80 add a state node handler that recurses into
 * node.children, allowing all nested markup to be processed correctly.
 *
 * Coverage:
 *   §1  onclick inside < db> block produces DOMContentLoaded in client JS
 *   §2  Multiple onclick buttons inside state block all get wired
 *   §3  Nested markup (button inside div inside state) is wired
 *   §4  State block with handle() middleware still emits DOMContentLoaded
 *   §5  HTML output has data-scrml-bind-onclick for buttons inside state block
 *   §6  Regression — button at top level (outside state) still works
 *   §7  Event delegation registry contains the correct handler for the button
 *   §8  State block with no markup children produces no DOMContentLoaded (correct skip)
 */

import { describe, test, expect } from "bun:test";
import { runCG } from "../../src/code-generator.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function span(start = 0, file = "/test/app.scrml") {
  return { file, start, end: start + 10, line: 1, col: start + 1 };
}

function makeCallRefAttr(eventName, handlerName, args = []) {
  return {
    name: eventName,
    value: { kind: "call-ref", name: handlerName, args },
    span: span(0),
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

function makeTextNode(text) {
  return { kind: "text", value: text, span: span(0) };
}

/**
 * Build a state node (< db>) containing the given children.
 * Mirrors what ast-builder.js produces for a state block.
 */
function makeStateNode(stateType, children, attrs = []) {
  return {
    kind: "state",
    stateType,
    attrs,
    children,
    span: span(0),
  };
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

function runCGSimple(nodes) {
  return runCG({
    files: [makeFileAST("/test/app.scrml", nodes)],
    routeMap: { functions: new Map() },
    depGraph: { nodes: new Map(), edges: [] },
    protectAnalysis: { views: new Map() },
  });
}

// ---------------------------------------------------------------------------
// §1: onclick inside < db> block produces DOMContentLoaded in client JS
// ---------------------------------------------------------------------------

describe("BUG-R14-005 §1: onclick inside state block → DOMContentLoaded", () => {
  test("client JS has document.addEventListener('DOMContentLoaded', ...)", () => {
    const result = runCGSimple([
      makeStateNode("db", [
        makeMarkupNode("button", [
          makeCallRefAttr("onclick", "doSomething"),
        ], [makeTextNode("Click me")]),
      ]),
    ]);

    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).toContain("function _scrml_boot()");
  });

  test("client JS has event handler wiring inside DOMContentLoaded", () => {
    const result = runCGSimple([
      makeStateNode("db", [
        makeMarkupNode("button", [
          makeCallRefAttr("onclick", "doSomething"),
        ], [makeTextNode("Click me")]),
      ]),
    ]);

    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).toContain("doSomething()");
  });

  test("client JS uses event delegation (document.addEventListener('click', ...))", () => {
    const result = runCGSimple([
      makeStateNode("db", [
        makeMarkupNode("button", [
          makeCallRefAttr("onclick", "handleClick"),
        ], [makeTextNode("Click")]),
      ]),
    ]);

    const out = result.outputs.get("/test/app.scrml");
    // click is a delegable event — uses document.addEventListener + ancestor walk
    expect(out.clientJs).toContain('document.addEventListener("click"');
  });
});

// ---------------------------------------------------------------------------
// §2: Multiple onclick buttons inside state block all get wired
// ---------------------------------------------------------------------------

describe("BUG-R14-005 §2: multiple buttons inside state block all wired", () => {
  test("all three buttons appear in the click delegation registry", () => {
    const result = runCGSimple([
      makeStateNode("db", [
        makeMarkupNode("div", [], [
          makeMarkupNode("button", [makeCallRefAttr("onclick", "actionA")], [makeTextNode("A")]),
          makeMarkupNode("button", [makeCallRefAttr("onclick", "actionB")], [makeTextNode("B")]),
          makeMarkupNode("button", [makeCallRefAttr("onclick", "actionC")], [makeTextNode("C")]),
        ]),
      ]),
    ]);

    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).toContain("actionA()");
    expect(out.clientJs).toContain("actionB()");
    expect(out.clientJs).toContain("actionC()");
  });

  test("DOMContentLoaded block appears exactly once", () => {
    const result = runCGSimple([
      makeStateNode("db", [
        makeMarkupNode("button", [makeCallRefAttr("onclick", "fn1")], [makeTextNode("1")]),
        makeMarkupNode("button", [makeCallRefAttr("onclick", "fn2")], [makeTextNode("2")]),
      ]),
    ]);

    const out = result.outputs.get("/test/app.scrml");
    const matches = (out.clientJs ?? "").match(/function _scrml_boot\(\)/g);
    expect(matches).not.toBeNull();
    expect(matches.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// §3: Nested markup (button inside div inside state) is wired
// ---------------------------------------------------------------------------

describe("BUG-R14-005 §3: deeply nested button inside state block", () => {
  test("button nested two levels inside state block is wired", () => {
    const result = runCGSimple([
      makeStateNode("db", [
        makeMarkupNode("div", [], [
          makeMarkupNode("header", [], [
            makeMarkupNode("button", [
              makeCallRefAttr("onclick", "openForm"),
            ], [makeTextNode("Add")]),
          ]),
        ]),
      ]),
    ]);

    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).toContain("function _scrml_boot()");
    expect(out.clientJs).toContain("openForm()");
  });

  test("HTML has data-scrml-bind-onclick for deeply nested button", () => {
    const result = runCGSimple([
      makeStateNode("db", [
        makeMarkupNode("div", [], [
          makeMarkupNode("button", [
            makeCallRefAttr("onclick", "deepAction"),
          ], [makeTextNode("Deep")]),
        ]),
      ]),
    ]);

    const out = result.outputs.get("/test/app.scrml");
    expect(out.html).toContain("data-scrml-bind-onclick");
  });
});

// ---------------------------------------------------------------------------
// §4: State block with handle() middleware still emits DOMContentLoaded
// ---------------------------------------------------------------------------

describe("BUG-R14-005 §4: handle() middleware does not suppress DOMContentLoaded", () => {
  test("file with handle() server function and state block emits DOMContentLoaded", () => {
    // handle() is a middleware function — server-classified by route inference.
    // It should not affect client-side event wiring.
    const handleFn = {
      kind: "function-decl",
      name: "handle",
      params: ["request", "resolve"],
      body: [],
      isMiddleware: true,
      span: span(0),
    };

    const logicNode = {
      kind: "logic",
      body: [handleFn],
      span: span(0),
    };

    const result = runCGSimple([
      makeStateNode("db", [
        logicNode,
        makeMarkupNode("button", [
          makeCallRefAttr("onclick", "createEntry"),
        ], [makeTextNode("Create")]),
      ]),
    ]);

    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).toContain("function _scrml_boot()");
    expect(out.clientJs).toContain("createEntry()");
  });
});

// ---------------------------------------------------------------------------
// §5: HTML output has data-scrml-bind-onclick for buttons inside state block
// ---------------------------------------------------------------------------

describe("BUG-R14-005 §5: HTML data attribute wiring for buttons in state block", () => {
  test("button inside state block emits data-scrml-bind-onclick in HTML", () => {
    const result = runCGSimple([
      makeStateNode("db", [
        makeMarkupNode("button", [
          makeCallRefAttr("onclick", "handleClick"),
        ], [makeTextNode("Click")]),
      ]),
    ]);

    const out = result.outputs.get("/test/app.scrml");
    expect(out.html).toContain("data-scrml-bind-onclick");
  });

  test("button inside state block does NOT emit bare onclick=... with the function name", () => {
    // The onclick attribute should be replaced with data-scrml-bind-onclick.
    // No bare onclick="handleClick()" should appear in the HTML.
    const result = runCGSimple([
      makeStateNode("db", [
        makeMarkupNode("button", [
          makeCallRefAttr("onclick", "handleClick"),
        ], [makeTextNode("Click")]),
      ]),
    ]);

    const out = result.outputs.get("/test/app.scrml");
    // Bare onclick with the handler name should not appear in HTML
    expect(out.html).not.toContain('onclick="handleClick');
  });

  test("data-scrml-bind-onclick placeholder ID matches registry entry in client JS", () => {
    const result = runCGSimple([
      makeStateNode("db", [
        makeMarkupNode("button", [
          makeCallRefAttr("onclick", "submit"),
        ], [makeTextNode("Submit")]),
      ]),
    ]);

    const out = result.outputs.get("/test/app.scrml");
    // Extract the placeholder ID from HTML
    const htmlMatch = out.html?.match(/data-scrml-bind-onclick="(_scrml_attr_onclick_\d+)"/);
    expect(htmlMatch).not.toBeNull();
    const placeholderId = htmlMatch[1];

    // The same ID must appear in the client JS delegation registry
    expect(out.clientJs).toContain(placeholderId);
  });
});

// ---------------------------------------------------------------------------
// §6: Regression — button at top level (outside state) still works
// ---------------------------------------------------------------------------

describe("BUG-R14-005 §6: top-level button regression (outside state block)", () => {
  test("button outside state block still emits DOMContentLoaded", () => {
    const result = runCGSimple([
      makeMarkupNode("div", [], [
        makeMarkupNode("button", [
          makeCallRefAttr("onclick", "topLevelAction"),
        ], [makeTextNode("Top Level")]),
      ]),
    ]);

    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).toContain("function _scrml_boot()");
    expect(out.clientJs).toContain("topLevelAction()");
  });
});

// ---------------------------------------------------------------------------
// §7: Event delegation registry contains the correct handler
// ---------------------------------------------------------------------------

describe("BUG-R14-005 §7: delegation registry contents for state block buttons", () => {
  test("_scrml_click registry key is the data-scrml-bind-onclick placeholder ID", () => {
    const result = runCGSimple([
      makeStateNode("db", [
        makeMarkupNode("button", [
          makeCallRefAttr("onclick", "execute"),
        ], [makeTextNode("Execute")]),
      ]),
    ]);

    const out = result.outputs.get("/test/app.scrml");
    // The click registry must exist
    expect(out.clientJs).toContain("const _scrml_click = {");
    // It must contain an entry calling execute()
    expect(out.clientJs).toContain("execute()");
  });

  test("ancestor walk uses data-scrml-bind-onclick attribute name", () => {
    const result = runCGSimple([
      makeStateNode("db", [
        makeMarkupNode("button", [
          makeCallRefAttr("onclick", "handler"),
        ], [makeTextNode("Go")]),
      ]),
    ]);

    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).toContain('"data-scrml-bind-onclick"');
  });
});

// ---------------------------------------------------------------------------
// §8: State block with no markup children produces no DOMContentLoaded
// ---------------------------------------------------------------------------

describe("BUG-R14-005 §8: state block with no onclick markup — no spurious block", () => {
  test("state block with only logic nodes produces no DOMContentLoaded", () => {
    const logicNode = {
      kind: "logic",
      body: [],
      span: span(0),
    };

    const result = runCGSimple([
      makeStateNode("db", [logicNode]),
    ]);

    const out = result.outputs.get("/test/app.scrml");
    // No event bindings → no DOMContentLoaded block
    expect(out.clientJs).not.toContain("function _scrml_boot()");
  });

  test("state block with markup but no onclick attributes produces no DOMContentLoaded", () => {
    const result = runCGSimple([
      makeStateNode("db", [
        makeMarkupNode("h1", [], [makeTextNode("Title")]),
        makeMarkupNode("p", [], [makeTextNode("Content")]),
      ]),
    ]);

    const out = result.outputs.get("/test/app.scrml");
    // No event bindings → no DOMContentLoaded block
    expect(out.clientJs).not.toContain("function _scrml_boot()");
  });
});
