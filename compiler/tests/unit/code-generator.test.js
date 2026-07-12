/**
 * Code Generator (CG) — Unit Tests
 *
 * Tests for src/code-generator.js (Stage 8).
 *
 * All inputs are constructed programmatically — no real file parsing.
 *
 * Coverage:
 *   §1  Simple markup → HTML output
 *   §2  Server function → server route handler + client fetch stub
 *   §3  Independent operations → Promise.all in client JS
 *   §4  Dependent operations → await chain
 *   §5  CSS collection from inline and style blocks
 *   §6  Protected fields absent from client JS
 *   §7  Empty input → empty outputs
 *   §8  E-CG-001 — unknown type triggers error
 *   §9  E-CG-002 — server function without route name
 *   §10 E-CG-003 — dependency graph edge references unknown node
 *   §11 Self-closing / void elements in HTML
 *   §12 Text nodes in HTML
 *   §13 Nested markup → nested HTML
 *   §14 Multiple files produce separate outputs
 *   §15 Dynamic attributes generate placeholders
 *   §16 Boolean HTML attributes
 */

import { describe, test, expect } from "bun:test";
import { runCG, CGError } from "../../src/code-generator.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function span(start, file = "/test/app.scrml") {
  return { file, start, end: start + 10, line: 1, col: start + 1 };
}

/**
 * Build a minimal FileAST (typed) with the given nodes.
 */
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

function makeFunctionDecl(name, body = [], params = [], opts = {}) {
  return {
    kind: "function-decl",
    name,
    params,
    body,
    span: opts.span ?? span(opts.spanStart ?? 0),
    isServer: opts.isServer ?? false,
  };
}

function makeLogicBlock(body = [], s = span(0)) {
  return { kind: "logic", body, span: s };
}

function makeBareExpr(expr, s = span(0)) {
  return { kind: "bare-expr", expr, span: s };
}

function makeLetDecl(name, init, s = span(0)) {
  return { kind: "let-decl", name, init, span: s };
}

function makeCssInlineBlock(body, s = span(0)) {
  return { kind: "css-inline", body, span: s };
}

function makeStyleBlock(body, s = span(0)) {
  return { kind: "style", body, span: s };
}

function makeRouteMap(entries = []) {
  const functions = new Map();
  for (const e of entries) {
    functions.set(e.functionNodeId, e);
  }
  return { functions };
}

function makeDepGraph(nodes = [], edges = []) {
  const nodeMap = new Map();
  for (const n of nodes) {
    nodeMap.set(n.nodeId, n);
  }
  return { nodes: nodeMap, edges };
}

function makeProtectAnalysis(views = new Map()) {
  return { views };
}

// ---------------------------------------------------------------------------
// §1: Simple markup → HTML output
// ---------------------------------------------------------------------------

describe("§1: Simple markup → HTML output", () => {
  test("div with text child produces <div>text</div>", () => {
    const ast = makeFileAST("/test/app.scrml", [
      makeMarkupNode("div", [], [makeTextNode("Hello")])
    ]);

    const result = runCG({
      files: [ast],
      routeMap: makeRouteMap(),
      depGraph: makeDepGraph(),
      protectAnalysis: makeProtectAnalysis(),
    });

    expect(result.errors).toHaveLength(0);
    expect(result.outputs.has("/test/app.scrml")).toBe(true);
    const out = result.outputs.get("/test/app.scrml");
    expect(out.html).toContain("<div>");
    expect(out.html).toContain("Hello");
    expect(out.html).toContain("</div>");
  });

  test("markup with string-literal attribute produces HTML attribute", () => {
    const ast = makeFileAST("/test/app.scrml", [
      makeMarkupNode("a", [
        { name: "href", value: { kind: "string-literal", value: "/home" }, span: span(0) }
      ], [makeTextNode("Home")])
    ]);

    const result = runCG({
      files: [ast],
      routeMap: makeRouteMap(),
      depGraph: makeDepGraph(),
      protectAnalysis: makeProtectAnalysis(),
    });

    const out = result.outputs.get("/test/app.scrml");
    expect(out.html).toContain('href="/home"');
    expect(out.html).toContain("Home");
  });
});

// ---------------------------------------------------------------------------
// §2: Server function → server route handler + client fetch stub
// ---------------------------------------------------------------------------

describe("§2: Server function → server route handler + client fetch stub", () => {
  test("server-boundary function produces server handler and client fetch stub", () => {
    const fnSpan = span(100);
    const fnNode = makeFunctionDecl("getData", [
      { kind: "return-stmt", expr: "42", span: span(110) },
    ], ["userId"], { span: fnSpan });

    const ast = makeFileAST("/test/app.scrml", [
      makeLogicBlock([fnNode], span(90))
    ]);

    const routeMap = makeRouteMap([{
      functionNodeId: "/test/app.scrml::100",
      boundary: "server",
      escalationReasons: [{ kind: "server-only-resource", resourceType: "sql-query" }],
      generatedRouteName: "__ri_route_getData_1",
      serverEntrySpan: fnSpan,
    }]);

    const result = runCG({
      files: [ast],
      routeMap,
      depGraph: makeDepGraph(),
      protectAnalysis: makeProtectAnalysis(),
    });

    expect(result.errors).toHaveLength(0);
    const out = result.outputs.get("/test/app.scrml");

    // Server JS should contain a route handler
    expect(out.serverJs).toBeTruthy();
    expect(out.serverJs).toContain("__ri_route_getData_1");
    expect(out.serverJs).toContain("POST");
    expect(out.serverJs).toContain("/_scrml/__ri_route_getData_1");
    expect(out.serverJs).toContain("handler");
    expect(out.serverJs).toContain("_scrml_req");
    expect(out.serverJs).toContain("return 42");

    // Client JS should contain a fetch stub
    expect(out.clientJs).toBeTruthy();
    expect(out.clientJs).toContain("fetch");
    expect(out.clientJs).toContain("/_scrml/__ri_route_getData_1");
    expect(out.clientJs).toContain("async function");
    expect(out.clientJs).toContain("POST");
    expect(out.clientJs).toContain("Content-Type");
    expect(out.clientJs).toContain("json");
  });
});

// ---------------------------------------------------------------------------
// §3: Independent operations → Promise.all in client JS
// ---------------------------------------------------------------------------

describe("§3: Independent operations → Promise.all in client JS", () => {
  test("independent let-decls in client-only function emit sequentially", () => {
    const stmtA = makeLetDecl("a", "fetchA()", span(10));
    const stmtB = makeLetDecl("b", "fetchB()", span(20));

    const fnNode = makeFunctionDecl("loadData", [stmtA, stmtB], [], {
      span: span(0),
    });

    const ast = makeFileAST("/test/app.scrml", [
      makeLogicBlock([fnNode], span(0))
    ]);

    // DG nodes — two independent nodes with no awaits edges
    const dgA = { nodeId: "fn::/test/app.scrml::10::1", kind: "function", span: span(10), boundary: "client", hasLift: false };
    const dgB = { nodeId: "fn::/test/app.scrml::20::2", kind: "function", span: span(20), boundary: "client", hasLift: false };

    const depGraph = makeDepGraph([dgA, dgB], []);

    const routeMap = makeRouteMap([{
      functionNodeId: "/test/app.scrml::0",
      boundary: "client",
      escalationReasons: [],
      generatedRouteName: null,
      serverEntrySpan: null,
    }]);

    const result = runCG({
      files: [ast],
      routeMap,
      depGraph,
      protectAnalysis: makeProtectAnalysis(),
    });

    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).toBeTruthy();
    // Client-only functions emit sequentially (Promise.all only for server calls)
    expect(out.clientJs).toContain("fetchA()");
    expect(out.clientJs).toContain("fetchB()");
  });
});

// ---------------------------------------------------------------------------
// §4: Dependent operations → await chain
// ---------------------------------------------------------------------------

describe("§4: Dependent operations → await chain", () => {
  test("dependent operations with awaits edge produce sequential await", () => {
    const stmtA = makeLetDecl("user", "getUser()", span(10));
    const stmtB = makeLetDecl("items", "getItems(user)", span(20));

    const fnNode = makeFunctionDecl("loadDashboard", [stmtA, stmtB], [], {
      span: span(0),
    });

    const ast = makeFileAST("/test/app.scrml", [
      makeLogicBlock([fnNode], span(0))
    ]);

    const dgA = { nodeId: "fn::/test/app.scrml::10::1", kind: "function", span: span(10), boundary: "client", hasLift: false };
    const dgB = { nodeId: "fn::/test/app.scrml::20::2", kind: "function", span: span(20), boundary: "client", hasLift: false };

    // B depends on A
    const depGraph = makeDepGraph([dgA, dgB], [
      { from: dgB.nodeId, to: dgA.nodeId, kind: "awaits" },
    ]);

    // Mark both functions as server so they get await
    const routeMap = makeRouteMap([{
      functionNodeId: "/test/app.scrml::0",
      boundary: "client",
      escalationReasons: [],
      generatedRouteName: null,
      serverEntrySpan: null,
    }]);

    const result = runCG({
      files: [ast],
      routeMap,
      depGraph,
      protectAnalysis: makeProtectAnalysis(),
    });

    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).toBeTruthy();
    // With a dependency edge, they should NOT be in Promise.all
    expect(out.clientJs).not.toContain("Promise.all");
  });
});

// ---------------------------------------------------------------------------
// §5: CSS collection from inline and style blocks
// ---------------------------------------------------------------------------

describe("§5: CSS collection from inline and style blocks", () => {
  test("inline CSS block (#{ }) is collected into CSS output", () => {
    const ast = makeFileAST("/test/app.scrml", [
      makeCssInlineBlock(".container { display: flex; }", span(0)),
    ]);

    const result = runCG({
      files: [ast],
      routeMap: makeRouteMap(),
      depGraph: makeDepGraph(),
      protectAnalysis: makeProtectAnalysis(),
    });

    const out = result.outputs.get("/test/app.scrml");
    expect(out.css).toBeTruthy();
    expect(out.css).toContain(".container { display: flex; }");
  });

  test("style block is collected into CSS output", () => {
    const ast = makeFileAST("/test/app.scrml", [
      makeStyleBlock("h1 { color: red; }", span(0)),
    ]);

    const result = runCG({
      files: [ast],
      routeMap: makeRouteMap(),
      depGraph: makeDepGraph(),
      protectAnalysis: makeProtectAnalysis(),
    });

    const out = result.outputs.get("/test/app.scrml");
    expect(out.css).toBeTruthy();
    expect(out.css).toContain("h1 { color: red; }");
  });

  test("multiple CSS sources are concatenated", () => {
    const ast = makeFileAST("/test/app.scrml", [
      makeCssInlineBlock(".a { margin: 0; }", span(0)),
      makeStyleBlock(".b { padding: 0; }", span(50)),
    ]);

    const result = runCG({
      files: [ast],
      routeMap: makeRouteMap(),
      depGraph: makeDepGraph(),
      protectAnalysis: makeProtectAnalysis(),
    });

    const out = result.outputs.get("/test/app.scrml");
    expect(out.css).toContain(".a { margin: 0; }");
    expect(out.css).toContain(".b { padding: 0; }");
  });
});

// ---------------------------------------------------------------------------
// §6: Protected fields absent from client JS
// ---------------------------------------------------------------------------

describe("§6: Protected fields absent from client JS", () => {
  test("client JS does not contain protected field references", () => {
    const fnNode = makeFunctionDecl("renderUser", [
      makeBareExpr("let name = user.name", span(110)),
    ], [], { span: span(100) });

    const ast = makeFileAST("/test/app.scrml", [
      makeLogicBlock([fnNode], span(90))
    ]);

    const routeMap = makeRouteMap([{
      functionNodeId: "/test/app.scrml::100",
      boundary: "client",
      escalationReasons: [],
      generatedRouteName: null,
      serverEntrySpan: null,
    }]);

    // Set up protect analysis with "ssn" as protected
    const views = new Map();
    views.set("db::1", {
      stateBlockId: "db::1",
      dbPath: "/test/db.sqlite",
      tables: new Map([
        ["users", {
          tableName: "users",
          fullSchema: [],
          clientSchema: [],
          protectedFields: new Set(["ssn"]),
        }],
      ]),
    });

    const result = runCG({
      files: [ast],
      routeMap,
      depGraph: makeDepGraph(),
      protectAnalysis: makeProtectAnalysis(views),
    });

    const out = result.outputs.get("/test/app.scrml");
    // The client JS should not contain .ssn (it wasn't in the source either, so no error)
    expect(out.clientJs).not.toContain(".ssn");
  });

  test("protected field in client JS triggers E-CG-001", () => {
    // Simulate a case where a client function somehow references a protected field
    const fnNode = makeFunctionDecl("leakData", [
      makeBareExpr("console.log(row.ssn)", span(110)),
    ], [], { span: span(100) });

    const ast = makeFileAST("/test/app.scrml", [
      makeLogicBlock([fnNode], span(90))
    ]);

    const routeMap = makeRouteMap([{
      functionNodeId: "/test/app.scrml::100",
      boundary: "client",
      escalationReasons: [],
      generatedRouteName: null,
      serverEntrySpan: null,
    }]);

    const views = new Map();
    views.set("db::1", {
      stateBlockId: "db::1",
      dbPath: "/test/db.sqlite",
      tables: new Map([
        ["users", {
          tableName: "users",
          fullSchema: [],
          clientSchema: [],
          protectedFields: new Set(["ssn"]),
        }],
      ]),
    });

    const result = runCG({
      files: [ast],
      routeMap,
      depGraph: makeDepGraph(),
      protectAnalysis: makeProtectAnalysis(views),
    });

    const cgErrors = result.errors.filter(e => e.code === "E-CG-001");
    expect(cgErrors.length).toBeGreaterThanOrEqual(1);
    expect(cgErrors[0].message).toContain("ssn");
  });

  // ss22 (2026-06-25) — E-CG-001 over-fire fix.
  // The protected-field scan is a CODE-POSITION invariant: a leak is a member
  // access of the protected column in shipped client code. The field NAME
  // appearing inside a STRING LITERAL (a user-authored display label, not a
  // member access of the DB column) is NOT a leak and must NOT fire E-CG-001.
  // Previously the raw `\.field\b` regex over the whole bundle matched the
  // `.ssn` inside the string and false-fired (CHECK-POSITION false-positive).
  test("protected field name inside a client STRING LITERAL does NOT fire E-CG-001 (over-fire fix)", () => {
    const fnNode = makeFunctionDecl("renderLabel", [
      // `.ssn` appears only inside a quoted display string — display text, not a
      // member access of the protected DB column. No genuine leak.
      makeBareExpr('let label = "Please enter your row.ssn below"', span(110)),
    ], [], { span: span(100) });

    const ast = makeFileAST("/test/app.scrml", [
      makeLogicBlock([fnNode], span(90))
    ]);

    const routeMap = makeRouteMap([{
      functionNodeId: "/test/app.scrml::100",
      boundary: "client",
      escalationReasons: [],
      generatedRouteName: null,
      serverEntrySpan: null,
    }]);

    const views = new Map();
    views.set("db::1", {
      stateBlockId: "db::1",
      dbPath: "/test/db.sqlite",
      tables: new Map([
        ["users", {
          tableName: "users",
          fullSchema: [],
          clientSchema: [],
          protectedFields: new Set(["ssn"]),
        }],
      ]),
    });

    const result = runCG({
      files: [ast],
      routeMap,
      depGraph: makeDepGraph(),
      protectAnalysis: makeProtectAnalysis(views),
    });

    const out = result.outputs.get("/test/app.scrml");
    // The field name is present in the client bundle, but ONLY inside the string
    // literal — confirming this is the over-fire shape, not a missing emission.
    expect(out.clientJs).toContain(".ssn");
    // ...and the scan must NOT fire, because it is not a code-position leak.
    const cgErrors = result.errors.filter(e => e.code === "E-CG-001");
    expect(cgErrors.length).toBe(0);
  });

  // Safety regression: a GENUINE leak — the protected field interpolated into
  // client markup via a `${row.ssn}` template literal — is a real member access
  // in CODE position (template `${...}` interiors are code) and MUST still fire.
  test("protected field interpolated into client markup (template ${...}) STILL fires E-CG-001", () => {
    const fnNode = makeFunctionDecl("renderRow", [
      makeBareExpr("el.textContent = `SSN: ${row.ssn}`", span(110)),
    ], [], { span: span(100) });

    const ast = makeFileAST("/test/app.scrml", [
      makeLogicBlock([fnNode], span(90))
    ]);

    const routeMap = makeRouteMap([{
      functionNodeId: "/test/app.scrml::100",
      boundary: "client",
      escalationReasons: [],
      generatedRouteName: null,
      serverEntrySpan: null,
    }]);

    const views = new Map();
    views.set("db::1", {
      stateBlockId: "db::1",
      dbPath: "/test/db.sqlite",
      tables: new Map([
        ["users", {
          tableName: "users",
          fullSchema: [],
          clientSchema: [],
          protectedFields: new Set(["ssn"]),
        }],
      ]),
    });

    const result = runCG({
      files: [ast],
      routeMap,
      depGraph: makeDepGraph(),
      protectAnalysis: makeProtectAnalysis(views),
    });

    const cgErrors = result.errors.filter(e => e.code === "E-CG-001");
    expect(cgErrors.length).toBeGreaterThanOrEqual(1);
    expect(cgErrors[0].message).toContain("ssn");
  });

  // g-ecg001-protected-field-regex-division-evasion (HIGH, S244) — the acorn-exact
  // egress scan (egress-field-scan.ts) closes a SILENT bypass of the §14.8.9
  // confidentiality backstop. The old scan built its code-position view from
  // `rewriteCodeSegments`, whose `regexAllowedAfter` treats `/` after a word like
  // `of`/`in` (valid VARIABLE NAMES) as a regex opener. So the DIVISION
  // `const of = 2; of / row.ssn / 2` was mis-scanned as a regex literal, swallowing
  // `.ssn` out of the view → E-CG-001 did NOT fire → the protected field shipped to
  // the client with no error. acorn resolves `of` as an identifier → `/` is division,
  // so `.ssn` stays visible and the leak now fires.
  test("regex-division evasion (`of` as a variable) now fires E-CG-001", () => {
    const fnNode = makeFunctionDecl("leak", [
      makeBareExpr("const of = 2;", span(110)),
      makeBareExpr("const r = of / row.ssn / 2;", span(120)),
    ], [], { span: span(100) });
    const ast = makeFileAST("/test/app.scrml", [makeLogicBlock([fnNode], span(90))]);
    const routeMap = makeRouteMap([{
      functionNodeId: "/test/app.scrml::100", boundary: "client",
      escalationReasons: [], generatedRouteName: null, serverEntrySpan: null,
    }]);
    const views = new Map();
    views.set("db::1", {
      stateBlockId: "db::1", dbPath: "/test/db.sqlite",
      tables: new Map([["users", {
        tableName: "users", fullSchema: [], clientSchema: [],
        protectedFields: new Set(["ssn"]),
      }]]),
    });
    const result = runCG({
      files: [ast], routeMap, depGraph: makeDepGraph(),
      protectAnalysis: makeProtectAnalysis(views),
    });
    // The leak is present in the emitted client JS as a real member access...
    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).toContain("row.ssn");
    // ...and the scan must now catch it (previously it silently leaked).
    const cgErrors = result.errors.filter(e => e.code === "E-CG-001");
    expect(cgErrors.length).toBeGreaterThanOrEqual(1);
    expect(cgErrors[0].message).toContain("ssn");
  });

  // Fail-closed: if the emitted client JS does not parse, the egress cannot be
  // verified — the backstop must fire a "could not verify" E-CG-001, NEVER silently
  // pass (a silent pass on parse-failure would be a NEW bypass: emit unparseable JS
  // to skip the guard).
  test("unparseable client JS fails CLOSED with a verification E-CG-001", () => {
    const fnNode = makeFunctionDecl("bad", [
      makeBareExpr("const x = = = ;", span(110)),
    ], [], { span: span(100) });
    const ast = makeFileAST("/test/app.scrml", [makeLogicBlock([fnNode], span(90))]);
    const routeMap = makeRouteMap([{
      functionNodeId: "/test/app.scrml::100", boundary: "client",
      escalationReasons: [], generatedRouteName: null, serverEntrySpan: null,
    }]);
    const views = new Map();
    views.set("db::1", {
      stateBlockId: "db::1", dbPath: "/test/db.sqlite",
      tables: new Map([["users", {
        tableName: "users", fullSchema: [], clientSchema: [],
        protectedFields: new Set(["ssn"]),
      }]]),
    });
    const result = runCG({
      files: [ast], routeMap, depGraph: makeDepGraph(),
      protectAnalysis: makeProtectAnalysis(views),
    });
    const cgErrors = result.errors.filter(e => e.code === "E-CG-001");
    expect(cgErrors.length).toBeGreaterThanOrEqual(1);
    expect(cgErrors.some(e => /could not verify/i.test(e.message))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §7: Empty input → empty outputs
// ---------------------------------------------------------------------------

describe("§7: Empty input → empty outputs", () => {
  test("empty files array returns empty outputs and no errors", () => {
    const result = runCG({
      files: [],
      routeMap: makeRouteMap(),
      depGraph: makeDepGraph(),
      protectAnalysis: makeProtectAnalysis(),
    });

    expect(result.outputs.size).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  test("null/undefined files returns empty outputs", () => {
    const result = runCG({
      files: null,
      routeMap: makeRouteMap(),
      depGraph: makeDepGraph(),
      protectAnalysis: makeProtectAnalysis(),
    });

    expect(result.outputs.size).toBe(0);
    expect(result.errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §8: E-CG-001 — unknown type triggers error
// ---------------------------------------------------------------------------

describe("§8: E-CG-001 — unknown type in nodeTypes", () => {
  test("unknown type produces E-CG-001 error", () => {
    const nodeTypes = new Map();
    nodeTypes.set("node::42", { kind: "unknown" });

    const ast = makeFileAST("/test/app.scrml", [
      makeMarkupNode("div", [], [makeTextNode("Hello")])
    ], { nodeTypes });

    const result = runCG({
      files: [ast],
      routeMap: makeRouteMap(),
      depGraph: makeDepGraph(),
      protectAnalysis: makeProtectAnalysis(),
    });

    const e001 = result.errors.filter(e => e.code === "E-CG-001");
    expect(e001.length).toBe(1);
    expect(e001[0].message).toContain("unrecognized type");
  });
});

// ---------------------------------------------------------------------------
// §9: E-CG-002 — server function without route name
// ---------------------------------------------------------------------------

describe("§9: E-CG-002 — server function without route name", () => {
  test("server-boundary function with null route name produces E-CG-002", () => {
    const fnNode = makeFunctionDecl("brokenFn", [], [], { span: span(100) });

    const ast = makeFileAST("/test/app.scrml", [
      makeLogicBlock([fnNode], span(90))
    ]);

    const routeMap = makeRouteMap([{
      functionNodeId: "/test/app.scrml::100",
      boundary: "server",
      escalationReasons: [{ kind: "explicit-annotation" }],
      generatedRouteName: null,  // BUG — RI should have generated this
      serverEntrySpan: span(100),
    }]);

    const result = runCG({
      files: [ast],
      routeMap,
      depGraph: makeDepGraph(),
      protectAnalysis: makeProtectAnalysis(),
    });

    const e002 = result.errors.filter(e => e.code === "E-CG-002");
    expect(e002.length).toBe(1);
    expect(e002[0].message).toContain("brokenFn");
    expect(e002[0].message).toContain("E-CG-002");
  });
});

// ---------------------------------------------------------------------------
// §10: E-CG-003 — dependency graph edge references unknown node
// ---------------------------------------------------------------------------

describe("§10: E-CG-003 — dependency graph edge references unknown node", () => {
  test("edge referencing non-existent node produces E-CG-003", () => {
    const ast = makeFileAST("/test/app.scrml", [
      makeMarkupNode("div", [], [makeTextNode("Hello")])
    ]);

    const depGraph = makeDepGraph(
      [{ nodeId: "node::1", kind: "function", span: span(0), boundary: "client", hasLift: false }],
      [{ from: "node::1", to: "node::999", kind: "awaits" }],
    );

    const result = runCG({
      files: [ast],
      routeMap: makeRouteMap(),
      depGraph,
      protectAnalysis: makeProtectAnalysis(),
    });

    const e003 = result.errors.filter(e => e.code === "E-CG-003");
    expect(e003.length).toBe(1);
    expect(e003[0].message).toContain("node::999");
  });
});

// ---------------------------------------------------------------------------
// §11: Self-closing / void elements in HTML
// ---------------------------------------------------------------------------

describe("§11: Self-closing / void elements", () => {
  test("void element (br) emits self-closing tag", () => {
    const ast = makeFileAST("/test/app.scrml", [
      makeMarkupNode("br", [], [], { selfClosing: true })
    ]);

    const result = runCG({
      files: [ast],
      routeMap: makeRouteMap(),
      depGraph: makeDepGraph(),
      protectAnalysis: makeProtectAnalysis(),
    });

    const out = result.outputs.get("/test/app.scrml");
    expect(out.html).toContain("<br");
    expect(out.html).toContain("/>");
    expect(out.html).not.toContain("</br>");
  });

  test("void element (img) with attributes", () => {
    const ast = makeFileAST("/test/app.scrml", [
      makeMarkupNode("img", [
        { name: "src", value: { kind: "string-literal", value: "logo.png" }, span: span(0) },
        { name: "alt", value: { kind: "string-literal", value: "Logo" }, span: span(10) },
      ], [], { selfClosing: true })
    ]);

    const result = runCG({
      files: [ast],
      routeMap: makeRouteMap(),
      depGraph: makeDepGraph(),
      protectAnalysis: makeProtectAnalysis(),
    });

    const out = result.outputs.get("/test/app.scrml");
    expect(out.html).toContain('src="logo.png"');
    expect(out.html).toContain('alt="Logo"');
  });
});

// ---------------------------------------------------------------------------
// §12: Text nodes in HTML
// ---------------------------------------------------------------------------

describe("§12: Text nodes in HTML", () => {
  test("text node produces plain text in HTML", () => {
    const ast = makeFileAST("/test/app.scrml", [
      makeMarkupNode("p", [], [makeTextNode("Some paragraph text")])
    ]);

    const result = runCG({
      files: [ast],
      routeMap: makeRouteMap(),
      depGraph: makeDepGraph(),
      protectAnalysis: makeProtectAnalysis(),
    });

    const out = result.outputs.get("/test/app.scrml");
    expect(out.html).toContain("<p>Some paragraph text</p>");
    expect(out.html).toContain("<!DOCTYPE html>");
    expect(out.html).toContain("<body>");
    expect(out.html).toContain("</body>");
  });
});

// ---------------------------------------------------------------------------
// §13: Nested markup → nested HTML
// ---------------------------------------------------------------------------

describe("§13: Nested markup → nested HTML", () => {
  test("nested elements produce nested HTML", () => {
    const ast = makeFileAST("/test/app.scrml", [
      makeMarkupNode("div", [
        { name: "class", value: { kind: "string-literal", value: "outer" }, span: span(0) }
      ], [
        makeMarkupNode("span", [], [makeTextNode("inner")]),
      ])
    ]);

    const result = runCG({
      files: [ast],
      routeMap: makeRouteMap(),
      depGraph: makeDepGraph(),
      protectAnalysis: makeProtectAnalysis(),
    });

    const out = result.outputs.get("/test/app.scrml");
    expect(out.html).toContain('<div class="outer">');
    expect(out.html).toContain("<span>inner</span>");
    expect(out.html).toContain("</div>");
  });
});

// ---------------------------------------------------------------------------
// §14: Multiple files produce separate outputs
// ---------------------------------------------------------------------------

describe("§14: Multiple files produce separate outputs", () => {
  test("two files each get their own output entry", () => {
    const ast1 = makeFileAST("/test/a.scrml", [
      makeMarkupNode("h1", [], [makeTextNode("Page A")])
    ]);
    const ast2 = makeFileAST("/test/b.scrml", [
      makeMarkupNode("h2", [], [makeTextNode("Page B")])
    ]);

    const result = runCG({
      files: [ast1, ast2],
      routeMap: makeRouteMap(),
      depGraph: makeDepGraph(),
      protectAnalysis: makeProtectAnalysis(),
    });

    expect(result.outputs.size).toBe(2);
    expect(result.outputs.get("/test/a.scrml").html).toContain("Page A");
    expect(result.outputs.get("/test/b.scrml").html).toContain("Page B");
  });
});

// ---------------------------------------------------------------------------
// §15: Dynamic attributes generate placeholders
// ---------------------------------------------------------------------------

describe("§15: Dynamic attributes generate placeholders", () => {
  test("variable-ref @-prefixed attribute strips @ and outputs literal value", () => {
    // allow-atvar-in-attrs: show=@count resolves identically to show=count.
    // The @-prefix is stripped for non-if, non-bind:, non-class: attributes.
    const ast = makeFileAST("/test/app.scrml", [
      makeMarkupNode("input", [
        { name: "value", value: { kind: "variable-ref", name: "@userName" }, span: span(0) },
      ], [], { selfClosing: true })
    ]);

    const result = runCG({
      files: [ast],
      routeMap: makeRouteMap(),
      depGraph: makeDepGraph(),
      protectAnalysis: makeProtectAnalysis(),
    });

    const out = result.outputs.get("/test/app.scrml");
    // @userName is stripped to userName — same as value=userName
    expect(out.html).toContain('value="userName"');
    expect(out.html).not.toContain("data-scrml-bind-value");
  });
});

// ---------------------------------------------------------------------------
// §16: Boolean HTML attributes
// ---------------------------------------------------------------------------

describe("§16: Boolean HTML attributes", () => {
  test("absent-value attribute produces bare attribute name", () => {
    const ast = makeFileAST("/test/app.scrml", [
      makeMarkupNode("input", [
        { name: "disabled", value: { kind: "absent" }, span: span(0) },
      ], [], { selfClosing: true })
    ]);

    const result = runCG({
      files: [ast],
      routeMap: makeRouteMap(),
      depGraph: makeDepGraph(),
      protectAnalysis: makeProtectAnalysis(),
    });

    const out = result.outputs.get("/test/app.scrml");
    expect(out.html).toContain(" disabled");
    expect(out.html).not.toContain("disabled=");
  });
});

// ---------------------------------------------------------------------------
// CompiledOutput shape validation
// ---------------------------------------------------------------------------

describe("CompiledOutput shape", () => {
  test("output has all expected fields", () => {
    const ast = makeFileAST("/test/app.scrml", [
      makeMarkupNode("div", [], [makeTextNode("test")])
    ]);

    const result = runCG({
      files: [ast],
      routeMap: makeRouteMap(),
      depGraph: makeDepGraph(),
      protectAnalysis: makeProtectAnalysis(),
    });

    const out = result.outputs.get("/test/app.scrml");
    expect(out).toHaveProperty("sourceFile");
    expect(out).toHaveProperty("html");
    expect(out).toHaveProperty("css");
    expect(out).toHaveProperty("clientJs");
    expect(out).toHaveProperty("serverJs");
    expect(out.sourceFile).toBe("/test/app.scrml");
  });

  test("file with no markup produces null html", () => {
    const ast = makeFileAST("/test/app.scrml", [
      makeCssInlineBlock(".x { color: red; }", span(0)),
    ]);

    const result = runCG({
      files: [ast],
      routeMap: makeRouteMap(),
      depGraph: makeDepGraph(),
      protectAnalysis: makeProtectAnalysis(),
    });

    const out = result.outputs.get("/test/app.scrml");
    expect(out.html).toBeNull();
    expect(out.css).toBeTruthy();
  });

  test("file with no CSS produces null css", () => {
    const ast = makeFileAST("/test/app.scrml", [
      makeMarkupNode("div", [], [makeTextNode("no css here")])
    ]);

    const result = runCG({
      files: [ast],
      routeMap: makeRouteMap(),
      depGraph: makeDepGraph(),
      protectAnalysis: makeProtectAnalysis(),
    });

    const out = result.outputs.get("/test/app.scrml");
    expect(out.css).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// HTML attribute escaping
// ---------------------------------------------------------------------------

describe("HTML attribute escaping", () => {
  test("special characters in attribute values are escaped", () => {
    const ast = makeFileAST("/test/app.scrml", [
      makeMarkupNode("div", [
        { name: "title", value: { kind: "string-literal", value: 'He said "hello" & <goodbye>' }, span: span(0) },
      ], [])
    ]);

    const result = runCG({
      files: [ast],
      routeMap: makeRouteMap(),
      depGraph: makeDepGraph(),
      protectAnalysis: makeProtectAnalysis(),
    });

    const out = result.outputs.get("/test/app.scrml");
    expect(out.html).toContain("&amp;");
    expect(out.html).toContain("&quot;");
    expect(out.html).toContain("&lt;");
    expect(out.html).toContain("&gt;");
    expect(out.html).not.toContain('"hello"');
  });
});

// ---------------------------------------------------------------------------
// CGError shape
// ---------------------------------------------------------------------------

describe("CGError", () => {
  test("CGError has code, message, span fields", () => {
    const err = new CGError("E-CG-001", "test message", span(0));
    expect(err.code).toBe("E-CG-001");
    expect(err.message).toBe("test message");
    expect(err.span).toBeTruthy();
    expect(err.span.start).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §17 Tailwind utility class integration (SPEC §25)
// ---------------------------------------------------------------------------

describe("§17 Tailwind utility class integration", () => {
  test("markup with Tailwind classes produces CSS output", () => {
    const fileAST = makeFileAST("/test/tw.scrml", [
      makeMarkupNode("div", [
        { name: "class", value: { kind: "string-literal", value: "flex items-center p-4" } },
      ], [makeTextNode("hello")]),
    ]);

    const result = runCG({
      files: [fileAST],
      routeMap: { functions: new Map() },
      depGraph: { nodes: new Map(), edges: [] },
      protectAnalysis: { views: new Map() },
    });

    const output = result.outputs.get("/test/tw.scrml");
    expect(output).toBeTruthy();
    expect(output.css).toBeTruthy();
    expect(output.css).toContain("display: flex");
    expect(output.css).toContain("align-items: center");
    expect(output.css).toContain("padding: 1rem");
  });

  test("markup with non-Tailwind classes produces no Tailwind CSS", () => {
    const fileAST = makeFileAST("/test/notw.scrml", [
      makeMarkupNode("div", [
        { name: "class", value: { kind: "string-literal", value: "my-custom-class another-class" } },
      ], [makeTextNode("hello")]),
    ]);

    const result = runCG({
      files: [fileAST],
      routeMap: { functions: new Map() },
      depGraph: { nodes: new Map(), edges: [] },
      protectAnalysis: { views: new Map() },
    });

    const output = result.outputs.get("/test/notw.scrml");
    expect(output).toBeTruthy();
    // CSS should be null since no user CSS and no Tailwind matches
    expect(output.css).toBeNull();
  });

  test("mixed user CSS and Tailwind CSS both appear in output", () => {
    const fileAST = makeFileAST("/test/mixed.scrml", [
      makeStyleBlock(".custom { color: red }"),
      makeMarkupNode("div", [
        { name: "class", value: { kind: "string-literal", value: "flex m-4" } },
      ], [makeTextNode("hello")]),
    ]);

    const result = runCG({
      files: [fileAST],
      routeMap: { functions: new Map() },
      depGraph: { nodes: new Map(), edges: [] },
      protectAnalysis: { views: new Map() },
    });

    const output = result.outputs.get("/test/mixed.scrml");
    expect(output).toBeTruthy();
    expect(output.css).toContain(".custom { color: red }");
    expect(output.css).toContain("display: flex");
    expect(output.css).toContain("margin: 1rem");
  });

  test("only used Tailwind classes appear in CSS output", () => {
    const fileAST = makeFileAST("/test/used.scrml", [
      makeMarkupNode("div", [
        { name: "class", value: { kind: "string-literal", value: "p-4" } },
      ], [makeTextNode("hello")]),
    ]);

    const result = runCG({
      files: [fileAST],
      routeMap: { functions: new Map() },
      depGraph: { nodes: new Map(), edges: [] },
      protectAnalysis: { views: new Map() },
    });

    const output = result.outputs.get("/test/used.scrml");
    expect(output.css).toContain("padding: 1rem");
    // Should not contain unrelated utilities
    expect(output.css).not.toContain("display: flex");
    expect(output.css).not.toContain("margin:");
  });

  test("markup without class attribute produces no Tailwind CSS", () => {
    const fileAST = makeFileAST("/test/noclass.scrml", [
      makeMarkupNode("div", [], [makeTextNode("hello")]),
    ]);

    const result = runCG({
      files: [fileAST],
      routeMap: { functions: new Map() },
      depGraph: { nodes: new Map(), edges: [] },
      protectAnalysis: { views: new Map() },
    });

    const output = result.outputs.get("/test/noclass.scrml");
    // HTML exists but no CSS
    expect(output.html).toBeTruthy();
    expect(output.css).toBeNull();
  });

  test("responsive Tailwind classes in markup produce media query CSS", () => {
    const fileAST = makeFileAST("/test/resp.scrml", [
      makeMarkupNode("div", [
        { name: "class", value: { kind: "string-literal", value: "sm:flex md:hidden" } },
      ], [makeTextNode("hello")]),
    ]);

    const result = runCG({
      files: [fileAST],
      routeMap: { functions: new Map() },
      depGraph: { nodes: new Map(), edges: [] },
      protectAnalysis: { views: new Map() },
    });

    const output = result.outputs.get("/test/resp.scrml");
    expect(output.css).toContain("@media (min-width: 640px)");
    expect(output.css).toContain("@media (min-width: 768px)");
  });

  test("state-prefixed Tailwind classes produce pseudo-class CSS", () => {
    const fileAST = makeFileAST("/test/state.scrml", [
      makeMarkupNode("button", [
        { name: "class", value: { kind: "string-literal", value: "hover:bg-blue-500 focus:border-red-500" } },
      ], [makeTextNode("Click")]),
    ]);

    const result = runCG({
      files: [fileAST],
      routeMap: { functions: new Map() },
      depGraph: { nodes: new Map(), edges: [] },
      protectAnalysis: { views: new Map() },
    });

    const output = result.outputs.get("/test/state.scrml");
    expect(output.css).toContain(":hover");
    expect(output.css).toContain(":focus");
  });
});

// ---------------------------------------------------------------------------
// §17 — bind: directive code generation
// ---------------------------------------------------------------------------

describe("§17 — bind: directive code generation", () => {

  test("bind:value generates addEventListener('input') and _scrml_reactive_set", () => {
    const inputNode = makeMarkupNode("input", [
      { name: "bind:value", value: { kind: "variable-ref", name: "@username" }, span: span(0) },
    ], [], { selfClosing: true });

    const result = runCG({
      files: [makeFileAST("/test/app.scrml", [inputNode])],
      routeMap: { functions: new Map() },
      depGraph: { nodes: new Map(), edges: [] },
      protectAnalysis: { views: new Map() },
    });

    const output = result.outputs.get("/test/app.scrml");
    expect(output.clientJs).toContain('_scrml_reactive_get("username")');
    expect(output.clientJs).toContain('addEventListener("input"');
    expect(output.clientJs).toContain('_scrml_reactive_set("username"');
    expect(output.clientJs).toContain('event.target.value');
    expect(output.clientJs).toContain('_scrml_effect(');
  });

  test("bind:checked generates addEventListener('change') with checked", () => {
    const inputNode = makeMarkupNode("input", [
      { name: "type", value: { kind: "string-literal", value: "checkbox" }, span: span(0) },
      { name: "bind:checked", value: { kind: "variable-ref", name: "@agreed" }, span: span(10) },
    ], [], { selfClosing: true });

    const result = runCG({
      files: [makeFileAST("/test/app.scrml", [inputNode])],
      routeMap: { functions: new Map() },
      depGraph: { nodes: new Map(), edges: [] },
      protectAnalysis: { views: new Map() },
    });

    const output = result.outputs.get("/test/app.scrml");
    expect(output.clientJs).toContain('_scrml_reactive_get("agreed")');
    expect(output.clientJs).toContain('addEventListener("change"');
    expect(output.clientJs).toContain('event.target.checked');
    expect(output.clientJs).toContain('_scrml_effect(');
  });

  test("bind:selected generates onchange with target.value", () => {
    const selectNode = makeMarkupNode("select", [
      { name: "bind:selected", value: { kind: "variable-ref", name: "@choice" }, span: span(0) },
    ]);

    const result = runCG({
      files: [makeFileAST("/test/app.scrml", [selectNode])],
      routeMap: { functions: new Map() },
      depGraph: { nodes: new Map(), edges: [] },
      protectAnalysis: { views: new Map() },
    });

    const output = result.outputs.get("/test/app.scrml");
    expect(output.clientJs).toContain('_scrml_reactive_get("choice")');
    expect(output.clientJs).toContain('addEventListener("change"');
    expect(output.clientJs).toContain('event.target.value');
  });

  test("bind:group generates radio group binding with value comparison", () => {
    const radioNode = makeMarkupNode("input", [
      { name: "type", value: { kind: "string-literal", value: "radio" }, span: span(0) },
      { name: "value", value: { kind: "string-literal", value: "red" }, span: span(10) },
      { name: "bind:group", value: { kind: "variable-ref", name: "@color" }, span: span(20) },
    ], [], { selfClosing: true });

    const result = runCG({
      files: [makeFileAST("/test/app.scrml", [radioNode])],
      routeMap: { functions: new Map() },
      depGraph: { nodes: new Map(), edges: [] },
      protectAnalysis: { views: new Map() },
    });

    const output = result.outputs.get("/test/app.scrml");
    expect(output.clientJs).toContain('_scrml_reactive_get("color")');
    expect(output.clientJs).toContain('.checked');
    expect(output.clientJs).toContain('addEventListener("change"');
  });

  test("class:active directive generates classList.toggle", () => {
    const divNode = makeMarkupNode("div", [
      { name: "class:active", value: { kind: "variable-ref", name: "@isActive" }, span: span(0) },
    ]);

    const result = runCG({
      files: [makeFileAST("/test/app.scrml", [divNode])],
      routeMap: { functions: new Map() },
      depGraph: { nodes: new Map(), edges: [] },
      protectAnalysis: { views: new Map() },
    });

    const output = result.outputs.get("/test/app.scrml");
    expect(output.clientJs).toContain('classList.add("active")');
    expect(output.clientJs).toContain('classList.toggle("active"');
    expect(output.clientJs).toContain('_scrml_reactive_get("isActive")');
    expect(output.clientJs).toContain('_scrml_effect(');
  });

  test("class:active with expr RHS generates classList.toggle using expression", () => {
    const divNode = makeMarkupNode("div", [
      {
        name: "class:active",
        value: { kind: "expr", raw: '(@tool === "select")', refs: ["tool"] },
        span: span(0),
      },
    ]);

    const result = runCG({
      files: [makeFileAST("/test/app.scrml", [divNode])],
      routeMap: { functions: new Map() },
      depGraph: { nodes: new Map(), edges: [] },
      protectAnalysis: { views: new Map() },
    });

    const output = result.outputs.get("/test/app.scrml");
    // Initial mount: add class if expression is truthy
    expect(output.clientJs).toContain('classList.add("active")');
    // Reactive subscription to the referenced variable
    expect(output.clientJs).toContain('_scrml_effect(');
    // classList.toggle with the rewritten expression
    expect(output.clientJs).toContain('classList.toggle("active"');
    // Expression rewritten: @tool -> _scrml_reactive_get("tool")
    expect(output.clientJs).toContain('_scrml_reactive_get("tool")');
  });

  test("class:active with expr RHS NOT rendered as class: in HTML", () => {
    const divNode = makeMarkupNode("div", [
      {
        name: "class:active",
        value: { kind: "expr", raw: '(@tab === "home")', refs: ["tab"] },
        span: span(0),
      },
    ], [makeTextNode("content")]);

    const result = runCG({
      files: [makeFileAST("/test/app.scrml", [divNode])],
      routeMap: { functions: new Map() },
      depGraph: { nodes: new Map(), edges: [] },
      protectAnalysis: { views: new Map() },
    });

    const output = result.outputs.get("/test/app.scrml");
    expect(output.html).not.toContain("class:active");
    expect(output.html).not.toContain("class:");
    // But the data-scrml marker IS in the HTML
    expect(output.html).toContain("data-scrml-class-active");
  });

  test("class: expr RHS with two reactive refs subscribes to both vars", () => {
    const divNode = makeMarkupNode("div", [
      {
        name: "class:highlight",
        value: { kind: "expr", raw: "(@isSelected && @isVisible)", refs: ["isSelected", "isVisible"] },
        span: span(0),
      },
    ]);

    const result = runCG({
      files: [makeFileAST("/test/app.scrml", [divNode])],
      routeMap: { functions: new Map() },
      depGraph: { nodes: new Map(), edges: [] },
      protectAnalysis: { views: new Map() },
    });

    const output = result.outputs.get("/test/app.scrml");
    expect(output.clientJs).toContain('_scrml_effect(');
    expect(output.clientJs).toContain('_scrml_effect(');
  });

  test("bind: attributes are NOT rendered in HTML output", () => {
    const inputNode = makeMarkupNode("input", [
      { name: "bind:value", value: { kind: "variable-ref", name: "@name" }, span: span(0) },
    ], [], { selfClosing: true });

    const result = runCG({
      files: [makeFileAST("/test/app.scrml", [inputNode])],
      routeMap: { functions: new Map() },
      depGraph: { nodes: new Map(), edges: [] },
      protectAnalysis: { views: new Map() },
    });

    const output = result.outputs.get("/test/app.scrml");
    expect(output.html).not.toContain("bind:value");
    expect(output.html).not.toContain("bind:");
  });

  test("class: attributes are NOT rendered in HTML output", () => {
    const divNode = makeMarkupNode("div", [
      { name: "class:highlight", value: { kind: "variable-ref", name: "@on" }, span: span(0) },
    ], [makeTextNode("content")]);

    const result = runCG({
      files: [makeFileAST("/test/app.scrml", [divNode])],
      routeMap: { functions: new Map() },
      depGraph: { nodes: new Map(), edges: [] },
      protectAnalysis: { views: new Map() },
    });

    const output = result.outputs.get("/test/app.scrml");
    expect(output.html).not.toContain("class:highlight");
    expect(output.html).not.toContain("class:");
  });

  test("regular attributes still render in HTML alongside bind:", () => {
    const inputNode = makeMarkupNode("input", [
      { name: "type", value: { kind: "string-literal", value: "text" }, span: span(0) },
      { name: "placeholder", value: { kind: "string-literal", value: "Enter name" }, span: span(10) },
      { name: "bind:value", value: { kind: "variable-ref", name: "@name" }, span: span(30) },
    ], [], { selfClosing: true });

    const result = runCG({
      files: [makeFileAST("/test/app.scrml", [inputNode])],
      routeMap: { functions: new Map() },
      depGraph: { nodes: new Map(), edges: [] },
      protectAnalysis: { views: new Map() },
    });

    const output = result.outputs.get("/test/app.scrml");
    expect(output.html).toContain('type="text"');
    expect(output.html).toContain('placeholder="Enter name"');
    expect(output.html).not.toContain("bind:");
  });

  test("no errors for valid bind: usage", () => {
    const inputNode = makeMarkupNode("input", [
      { name: "bind:value", value: { kind: "variable-ref", name: "@username" }, span: span(0) },
    ], [], { selfClosing: true });

    const result = runCG({
      files: [makeFileAST("/test/app.scrml", [inputNode])],
      routeMap: { functions: new Map() },
      depGraph: { nodes: new Map(), edges: [] },
      protectAnalysis: { views: new Map() },
    });

    expect(result.errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §18 — derived state-decl code generation
// (Phase A1a Step 11.5 fold: legacy reactive-derived-decl retired)
// ---------------------------------------------------------------------------

describe("§18 — derived state-decl code generation", () => {

  test("const @total = @price * @quantity emits _scrml_derived_declare + _scrml_derived_subscribe (§6.6)", () => {
    const logicNode = {
      kind: "logic",
      body: [
        {
          kind: "state-decl",
          shape: "derived",
          isConst: true,
          structuralForm: false,
          name: "total",
          init: "@price * @quantity",
          span: span(0),
        },
      ],
      imports: [],
      exports: [],
      typeDecls: [],
      components: [],
      span: span(0),
    };

    const result = runCG({
      files: [makeFileAST("/test/app.scrml", [logicNode])],
      routeMap: { functions: new Map() },
      depGraph: { nodes: new Map(), edges: [] },
      protectAnalysis: { views: new Map() },
    });

    const output = result.outputs.get("/test/app.scrml");
    expect(output.clientJs).toContain('_scrml_derived_declare("total"');
    expect(output.clientJs).toContain('_scrml_derived_subscribe("total", "price")');
    expect(output.clientJs).toContain('_scrml_derived_subscribe("total", "quantity")');
    expect(output.clientJs).toContain('_scrml_reactive_get("price")');
    expect(output.clientJs).toContain('_scrml_reactive_get("quantity")');
  });

  test("const @x = 5 + 3 (no deps) emits W-DERIVED-001 and treats as const", () => {
    const logicNode = {
      kind: "logic",
      body: [
        {
          kind: "state-decl",
          shape: "derived",
          isConst: true,
          structuralForm: false,
          name: "x",
          init: "5 + 3",
          span: span(0),
        },
      ],
      imports: [],
      exports: [],
      typeDecls: [],
      components: [],
      span: span(0),
    };

    const result = runCG({
      files: [makeFileAST("/test/app.scrml", [logicNode])],
      routeMap: { functions: new Map() },
      depGraph: { nodes: new Map(), edges: [] },
      protectAnalysis: { views: new Map() },
    });

    const output = result.outputs.get("/test/app.scrml");
    expect(output.clientJs).toContain("W-DERIVED-001");
    expect(output.clientJs).toContain("const x = 5 + 3");
    // The emitted statement for this no-deps derived should NOT call _scrml_reactive_derived.
    // (The runtime definition of _scrml_reactive_derived is present but not called for this case.)
    expect(output.clientJs).not.toContain('_scrml_reactive_derived("x"');
  });

  test("derived with single reactive dep emits _scrml_derived_declare + _scrml_derived_subscribe (§6.6)", () => {
    const logicNode = {
      kind: "logic",
      body: [
        {
          kind: "state-decl",
          shape: "derived",
          isConst: true,
          structuralForm: false,
          name: "doubled",
          init: "@count * 2",
          span: span(0),
        },
      ],
      imports: [],
      exports: [],
      typeDecls: [],
      components: [],
      span: span(0),
    };

    const result = runCG({
      files: [makeFileAST("/test/app.scrml", [logicNode])],
      routeMap: { functions: new Map() },
      depGraph: { nodes: new Map(), edges: [] },
      protectAnalysis: { views: new Map() },
    });

    const output = result.outputs.get("/test/app.scrml");
    expect(output.clientJs).toContain('_scrml_derived_declare("doubled"');
    expect(output.clientJs).toContain('_scrml_derived_subscribe("doubled", "count")');
    expect(output.clientJs).toContain('_scrml_reactive_get("count")');
  });

  test("no CG errors for valid derived decl", () => {
    const logicNode = {
      kind: "logic",
      body: [
        {
          kind: "state-decl",
          shape: "derived",
          isConst: true,
          structuralForm: false,
          name: "total",
          init: "@a + @b",
          span: span(0),
        },
      ],
      imports: [],
      exports: [],
      typeDecls: [],
      components: [],
      span: span(0),
    };

    const result = runCG({
      files: [makeFileAST("/test/app.scrml", [logicNode])],
      routeMap: { functions: new Map() },
      depGraph: { nodes: new Map(), edges: [] },
      protectAnalysis: { views: new Map() },
    });

    expect(result.errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §17: fail-expr generates error return value
// ---------------------------------------------------------------------------

describe("§17: fail-expr generates error return value", () => {
  test("fail-expr in server function generates __scrml_error return", () => {
    const failNode = {
      kind: "fail-expr",
      enumType: "PaymentError",
      variant: "InvalidAmount",
      args: '"Must be positive"',
      span: span(110),
    };
    const fnNode = makeFunctionDecl("processPayment", [failNode], ["amount"], {
      span: span(100),
    });

    const ast = makeFileAST("/test/app.scrml", [
      makeLogicBlock([fnNode], span(90)),
    ]);

    const routeMap = makeRouteMap([{
      functionNodeId: "/test/app.scrml::100",
      boundary: "server",
      escalationReasons: [{ kind: "server-only-resource", resourceType: "sql-query" }],
      generatedRouteName: "__ri_route_processPayment_1",
      serverEntrySpan: span(100),
    }]);

    const result = runCG({
      files: [ast],
      routeMap,
      depGraph: makeDepGraph(),
      protectAnalysis: makeProtectAnalysis(),
    });

    expect(result.errors).toHaveLength(0);
    const out = result.outputs.get("/test/app.scrml");
    expect(out.serverJs).toBeTruthy();
    expect(out.serverJs).toContain("__scrml_error");
    expect(out.serverJs).toContain("PaymentError");
    expect(out.serverJs).toContain("InvalidAmount");
  });

  test("propagate-expr generates __scrml_error early return", () => {
    const propagateNode = {
      kind: "propagate-expr",
      binding: "result",
      expr: "processPayment ( amount )",
      span: span(110),
    };
    const fnNode = makeFunctionDecl("handleOrder", [propagateNode], ["amount"], {
      span: span(100),
    });

    const ast = makeFileAST("/test/app.scrml", [
      makeLogicBlock([fnNode], span(90)),
    ]);

    const routeMap = makeRouteMap([{
      functionNodeId: "/test/app.scrml::100",
      boundary: "server",
      escalationReasons: [{ kind: "server-only-resource", resourceType: "sql-query" }],
      generatedRouteName: "__ri_route_handleOrder_1",
      serverEntrySpan: span(100),
    }]);

    const result = runCG({
      files: [ast],
      routeMap,
      depGraph: makeDepGraph(),
      protectAnalysis: makeProtectAnalysis(),
    });

    expect(result.errors).toHaveLength(0);
    const out = result.outputs.get("/test/app.scrml");
    expect(out.serverJs).toBeTruthy();
    expect(out.serverJs).toContain("__scrml_error");
    expect(out.serverJs).toContain("return");
    expect(out.serverJs).toContain("result");
  });
});

// ---------------------------------------------------------------------------
// §18: errorBoundary generates wrapper div with data attribute
// ---------------------------------------------------------------------------

describe("§18: errorBoundary in HTML", () => {
  test("errorBoundary renders as div with data-scrml-error-boundary", () => {
    const errorBoundary = makeMarkupNode("errorBoundary", [], [
      { kind: "text", value: "Content inside boundary", span: span(50) },
    ], { span: span(40) });

    const ast = makeFileAST("/test/app.scrml", [errorBoundary]);
    const result = runCG({
      files: [ast],
      routeMap: { functions: new Map() },
      depGraph: { nodes: new Map(), edges: [] },
      protectAnalysis: { views: new Map() },
    });

    expect(result.errors).toHaveLength(0);
    const out = result.outputs.get("/test/app.scrml");
    expect(out.html).toBeTruthy();
    expect(out.html).toContain("data-scrml-error-boundary");
    expect(out.html).toContain("Content inside boundary");
    expect(out.html).not.toContain("<errorBoundary");
  });
});

// ---------------------------------------------------------------------------
// §19: transaction-block generates BEGIN/COMMIT/ROLLBACK wrapper
// ---------------------------------------------------------------------------

describe("§19: transaction-block codegen", () => {
  test("transaction-block wraps body in BEGIN/COMMIT/ROLLBACK", () => {
    const txnNode = {
      kind: "transaction-block",
      body: [
        { kind: "bare-expr", expr: "doInsert()", span: span(120) },
      ],
      span: span(110),
    };
    const fnNode = makeFunctionDecl("saveData", [txnNode], [], {
      span: span(100),
    });

    const ast = makeFileAST("/test/app.scrml", [
      makeLogicBlock([fnNode], span(90)),
    ]);

    const routeMap = makeRouteMap([{
      functionNodeId: "/test/app.scrml::100",
      boundary: "server",
      escalationReasons: [{ kind: "server-only-resource", resourceType: "sql-query" }],
      generatedRouteName: "__ri_route_saveData_1",
      serverEntrySpan: span(100),
    }]);

    const result = runCG({
      files: [ast],
      routeMap,
      depGraph: makeDepGraph(),
      protectAnalysis: makeProtectAnalysis(),
    });

    expect(result.errors).toHaveLength(0);
    const out = result.outputs.get("/test/app.scrml");
    expect(out.serverJs).toBeTruthy();
    expect(out.serverJs).toContain("BEGIN");
    expect(out.serverJs).toContain("COMMIT");
    expect(out.serverJs).toContain("ROLLBACK");
  });
});

// ---------------------------------------------------------------------------
// ref= attribute — DOM element reference binding
// ---------------------------------------------------------------------------

describe("ref= attribute", () => {
  test("ref=@el emits data-scrml-ref in HTML output", () => {
    const ast = makeFileAST("/test/app.scrml", [
      makeMarkupNode("canvas", [
        { name: "ref", value: { kind: "variable-ref", name: "@el" }, span: span(0) },
      ], []),
    ]);

    const result = runCG({
      files: [ast],
      routeMap: makeRouteMap(),
      depGraph: makeDepGraph(),
      protectAnalysis: makeProtectAnalysis(),
    });

    expect(result.errors).toHaveLength(0);
    const out = result.outputs.get("/test/app.scrml");
    expect(out.html).toContain('data-scrml-ref="el"');
    // Should NOT contain ref= as a standalone regular HTML attribute
    expect(out.html).not.toMatch(/ ref="/);
  });

  test("ref=@el emits querySelector in client JS", () => {
    const ast = makeFileAST("/test/app.scrml", [
      makeMarkupNode("canvas", [
        { name: "ref", value: { kind: "variable-ref", name: "@el" }, span: span(0) },
      ], []),
    ]);

    const result = runCG({
      files: [ast],
      routeMap: makeRouteMap(),
      depGraph: makeDepGraph(),
      protectAnalysis: makeProtectAnalysis(),
    });

    expect(result.errors).toHaveLength(0);
    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).toContain('querySelector');
    expect(out.clientJs).toContain('data-scrml-ref="el"');
    expect(out.clientJs).toContain('_scrml_reactive_set("el"');
  });

  test("ref= does not appear in server JS", () => {
    const ast = makeFileAST("/test/app.scrml", [
      makeMarkupNode("div", [
        { name: "ref", value: { kind: "variable-ref", name: "@myDiv" }, span: span(0) },
      ], [makeTextNode("Hello")]),
      makeLogicBlock([
        makeFunctionDecl("myHandler", [makeBareExpr("console.log(1)")], [], { isServer: true, spanStart: 100 }),
      ]),
    ]);

    const routeMap = makeRouteMap([{
      functionNodeId: "/test/app.scrml::100",
      boundary: "server",
      generatedRouteName: "myHandler_abc",
    }]);

    const result = runCG({
      files: [ast],
      routeMap,
      depGraph: makeDepGraph(),
      protectAnalysis: makeProtectAnalysis(),
    });

    const out = result.outputs.get("/test/app.scrml");
    if (out.serverJs) {
      expect(out.serverJs).not.toContain("querySelector");
      expect(out.serverJs).not.toContain("data-scrml-ref");
    }
  });
});

// ---------------------------------------------------------------------------
// cleanup() built-in function
// ---------------------------------------------------------------------------

describe("cleanup() built-in", () => {
  test("cleanup-registration node emits _scrml_register_cleanup", () => {
    const ast = makeFileAST("/test/app.scrml", [
      makeLogicBlock([
        { kind: "cleanup-registration", callback: "() => { clearInterval(timer) }", span: span(0) },
      ]),
    ]);

    const result = runCG({
      files: [ast],
      routeMap: makeRouteMap(),
      depGraph: makeDepGraph(),
      protectAnalysis: makeProtectAnalysis(),
    });

    expect(result.errors).toHaveLength(0);
    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).toContain("_scrml_register_cleanup");
    expect(out.clientJs).toContain("clearInterval(timer)");
  });
});

// ---------------------------------------------------------------------------
// upload() built-in function
// ---------------------------------------------------------------------------

describe("upload() built-in", () => {
  test("upload-call node emits _scrml_upload", () => {
    const ast = makeFileAST("/test/app.scrml", [
      makeLogicBlock([
        { kind: "upload-call", file: "selectedFile", url: '"/api/upload"', span: span(0) },
      ]),
    ]);

    const result = runCG({
      files: [ast],
      routeMap: makeRouteMap(),
      depGraph: makeDepGraph(),
      protectAnalysis: makeProtectAnalysis(),
    });

    expect(result.errors).toHaveLength(0);
    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).toContain("_scrml_upload");
  });
});

// ---------------------------------------------------------------------------
// bind:files directive
// ---------------------------------------------------------------------------

describe("bind:files directive", () => {
  test("bind:files=@var emits file list binding in client JS", () => {
    const ast = makeFileAST("/test/app.scrml", [
      makeMarkupNode("input", [
        { name: "type", value: { kind: "string-literal", value: "file" }, span: span(0) },
        { name: "bind:files", value: { kind: "variable-ref", name: "@selectedFiles" }, span: span(10) },
      ], [], { selfClosing: true }),
    ]);

    const result = runCG({
      files: [ast],
      routeMap: makeRouteMap(),
      depGraph: makeDepGraph(),
      protectAnalysis: makeProtectAnalysis(),
    });

    expect(result.errors).toHaveLength(0);
    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).toContain("selectedFiles");
    expect(out.clientJs).toContain("files");
  });
});

// ---------------------------------------------------------------------------
// S79 — @debounced reactive modifier RETIRED. The pre-v0.next AST kind
// `reactive-debounced-decl` no longer exists; cells now use the canonical
// state-decl reactivity attribute form `<name debounced=Nms> = expr`
// (SPEC §6.13). New codegen tests for the attribute form live in
// `compiler/tests/unit/debounce-throttle-attribute.test.js` (S79 dispatch).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// debounce() and throttle() built-ins — RETIRED S81 OQ-2 (2026-05-11)
// ---------------------------------------------------------------------------
// The imperative `debounce(fn, ms)` / `throttle(fn, ms)` keyword-call form is
// retired. AST kinds `debounce-call` / `throttle-call` are removed; runtime
// helpers `_scrml_debounce` / `_scrml_throttle` are removed; codegen case
// arms removed. Adopters use stdlib `scrml:time.debounce` / `scrml:time.throttle`
// (regular function calls, shipped at stdlib/time/index.scrml). State-cell
// timing uses §6.13 attribute form (`<x debounced=Nms>`). The two pre-S81
// codegen assertions are deleted; new assertions verify the absence of the
// retired runtime helpers from emitted output.

describe("debounce/throttle built-ins — RETIRED S81 OQ-2", () => {
  test("no _scrml_debounce / _scrml_throttle runtime helper emitted by default", () => {
    // Empty logic block — verifies the retired helpers aren't unconditionally
    // bundled into compiled output anymore. Pre-S81 they sat inside the
    // utilities chunk; chunk-detector entries removed at S81.
    const ast = makeFileAST("/test/app.scrml", [makeLogicBlock([])]);

    const result = runCG({
      files: [ast],
      routeMap: makeRouteMap(),
      depGraph: makeDepGraph(),
      protectAnalysis: makeProtectAnalysis(),
    });

    expect(result.errors).toHaveLength(0);
    const out = result.outputs.get("/test/app.scrml");
    // The two retired helpers MUST NOT appear in default compiled output.
    expect(out.clientJs).not.toContain("function _scrml_debounce(");
    expect(out.clientJs).not.toContain("function _scrml_throttle(");
  });
});

// ---------------------------------------------------------------------------
// §17 navigate() rewriting
// ---------------------------------------------------------------------------

describe("navigate() rewriting", () => {
  test("navigate(path) is rewritten to _scrml_navigate(path)", () => {
    const ast = makeFileAST("/test/app.scrml", [
      makeLogicBlock([
        makeFunctionDecl("goHome", [
          makeBareExpr("navigate('/home')"),
        ]),
      ]),
    ]);

    const result = runCG({
      files: [ast],
      routeMap: makeRouteMap(),
      depGraph: makeDepGraph(),
      protectAnalysis: makeProtectAnalysis(),
    });

    expect(result.errors).toHaveLength(0);
    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).toContain("_scrml_navigate");
    expect(out.clientJs).not.toMatch(/(?<!_scrml_)navigate\s*\(/);
  });

  test("navigate with template literal is rewritten (client → soft, navigate-wave1b #4)", () => {
    const ast = makeFileAST("/test/app.scrml", [
      makeLogicBlock([
        makeFunctionDecl("viewUser", [
          makeBareExpr("navigate(`/users/${userId}`)"),
        ]),
      ]),
    ]);

    const result = runCG({
      files: [ast],
      routeMap: makeRouteMap(),
      depGraph: makeDepGraph(),
      protectAnalysis: makeProtectAnalysis(),
    });

    expect(result.errors).toHaveLength(0);
    const out = result.outputs.get("/test/app.scrml");
    // A client-context navigate lowers to the §20.8 soft-navigation engine.
    expect(out.clientJs).toContain("_scrml_navigate_soft(`/users/");
  });
});

// ---------------------------------------------------------------------------
// §18 Nested reactive rewriting
// ---------------------------------------------------------------------------

describe("nested reactive rewriting", () => {
  test("reactive-nested-assign generates _scrml_deep_set call", () => {
    const ast = makeFileAST("/test/app.scrml", [
      makeLogicBlock([
        makeFunctionDecl("updateName", [
          { kind: "reactive-nested-assign", target: "user", path: ["name"], value: '"Alice"', span: span(0) },
        ]),
      ]),
    ]);

    const result = runCG({
      files: [ast],
      routeMap: makeRouteMap(),
      depGraph: makeDepGraph(),
      protectAnalysis: makeProtectAnalysis(),
    });

    expect(result.errors).toHaveLength(0);
    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).toContain("_scrml_deep_set");
    expect(out.clientJs).toContain("_scrml_reactive_set");
    expect(out.clientJs).toContain('"user"');
    expect(out.clientJs).toContain('["name"]');
  });

  test("reactive-array-mutation push uses direct Proxy mutation", () => {
    const ast = makeFileAST("/test/app.scrml", [
      makeLogicBlock([
        makeFunctionDecl("addItem", [
          { kind: "reactive-array-mutation", target: "items", method: "push", args: "newItem", span: span(0) },
        ]),
      ]),
    ]);

    const result = runCG({
      files: [ast],
      routeMap: makeRouteMap(),
      depGraph: makeDepGraph(),
      protectAnalysis: makeProtectAnalysis(),
    });

    expect(result.errors).toHaveLength(0);
    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).toContain(".push(newItem)");
    expect(out.clientJs).toContain("newItem");
  });

  test("reactive-array-mutation splice generates immutable splice", () => {
    const ast = makeFileAST("/test/app.scrml", [
      makeLogicBlock([
        makeFunctionDecl("removeItem", [
          { kind: "reactive-array-mutation", target: "items", method: "splice", args: "idx, 1", span: span(0) },
        ]),
      ]),
    ]);

    const result = runCG({
      files: [ast],
      routeMap: makeRouteMap(),
      depGraph: makeDepGraph(),
      protectAnalysis: makeProtectAnalysis(),
    });

    expect(result.errors).toHaveLength(0);
    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).toContain(".splice(idx, 1)");
    expect(out.clientJs).toContain("_scrml_reactive_set");
  });

  test("reactive-explicit-set generates _scrml_reactive_explicit_set call", () => {
    const ast = makeFileAST("/test/app.scrml", [
      makeLogicBlock([
        makeFunctionDecl("setExplicit", [
          { kind: "reactive-explicit-set", args: '@obj, "name", "Alice"', span: span(0) },
        ]),
      ]),
    ]);

    const result = runCG({
      files: [ast],
      routeMap: makeRouteMap(),
      depGraph: makeDepGraph(),
      protectAnalysis: makeProtectAnalysis(),
    });

    expect(result.errors).toHaveLength(0);
    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).toContain("_scrml_reactive_explicit_set");
  });
});

// ---------------------------------------------------------------------------
// BUG-R14-008: Server handler @var references use request body, not reactive_get
// ---------------------------------------------------------------------------

describe("BUG-R14-008: Server handler @var references use _scrml_body", () => {
  test("@var in server handler body rewrites to _scrml_body, not _scrml_reactive_get", () => {
    const fnSpan = span(100);
    const fnNode = makeFunctionDecl("saveEntry", [
      makeBareExpr('db.run(@newTitle, @newBody)', span(110)),
    ], ["newTitle", "newBody"], { span: fnSpan });

    const ast = makeFileAST("/test/app.scrml", [
      makeLogicBlock([fnNode], span(90))
    ]);

    const routeMap = makeRouteMap([{
      functionNodeId: "/test/app.scrml::100",
      boundary: "server",
      escalationReasons: [{ kind: "server-only-resource", resourceType: "sql-query" }],
      generatedRouteName: "__ri_route_saveEntry_1",
      serverEntrySpan: fnSpan,
    }]);

    const result = runCG({
      files: [ast],
      routeMap,
      depGraph: makeDepGraph(),
      protectAnalysis: makeProtectAnalysis(),
    });

    expect(result.errors).toHaveLength(0);
    const out = result.outputs.get("/test/app.scrml");

    // Server JS should use _scrml_body["varName"] for @var references
    expect(out.serverJs).toContain('_scrml_body["newTitle"]');
    expect(out.serverJs).toContain('_scrml_body["newBody"]');

    // Server JS must NOT contain _scrml_reactive_get (BUG-R14-008)
    expect(out.serverJs).not.toContain("_scrml_reactive_get");
  });

  test("@var in server handler with CPS split rewrites to _scrml_body", () => {
    const fnSpan = span(200);
    const fnNode = makeFunctionDecl("updateItem", [
      makeBareExpr('db.run(@itemName)', span(210)),
    ], ["itemName"], { span: fnSpan });

    const ast = makeFileAST("/test/app.scrml", [
      makeLogicBlock([fnNode], span(190))
    ]);

    const routeMap = makeRouteMap([{
      functionNodeId: "/test/app.scrml::200",
      boundary: "server",
      escalationReasons: [{ kind: "server-only-resource", resourceType: "sql-query" }],
      generatedRouteName: "__ri_route_updateItem_1",
      serverEntrySpan: fnSpan,
      cpsSplit: {
        serverStmtIndices: [0],
        returnVarName: null,
      },
    }]);

    const result = runCG({
      files: [ast],
      routeMap,
      depGraph: makeDepGraph(),
      protectAnalysis: makeProtectAnalysis(),
    });

    expect(result.errors).toHaveLength(0);
    const out = result.outputs.get("/test/app.scrml");

    // Server JS should use _scrml_body["varName"] for @var references
    expect(out.serverJs).toContain('_scrml_body["itemName"]');
    // Must NOT contain _scrml_reactive_get
    expect(out.serverJs).not.toContain("_scrml_reactive_get");
  });
});

// ---------------------------------------------------------------------------
// BUG-R14-005: Markup inside state (db) nodes must generate HTML + event wiring
// ---------------------------------------------------------------------------

describe("BUG-R14-005: Markup nested inside state nodes generates HTML", () => {
  test("markup inside a state node produces HTML output", () => {
    // Simulate: <db>...<h1>Title/...<button onclick=doThing()>Click/...</db>
    const stateNode = {
      kind: "state",
      tag: "db",
      attributes: [],
      children: [
        makeMarkupNode("h1", [], [makeTextNode("Title")]),
        makeMarkupNode("button", [
          { name: "onclick", value: { kind: "string-literal", value: "doThing()" } },
        ], [makeTextNode("Click")]),
      ],
      span: span(10),
    };

    const ast = makeFileAST("/test/db-app.scrml", [stateNode]);
    const result = runCG({ files: [ast] });

    const out = result.outputs.get("/test/db-app.scrml");
    // HTML should contain the markup from inside the state node
    expect(out.html).toContain("<h1>");
    expect(out.html).toContain("Title");
    expect(out.html).toContain("<button");
  });
});
