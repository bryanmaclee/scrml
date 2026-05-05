/**
 * Type Encoding Phase 4 — Pipeline Integration Tests
 *
 * Tests that the EncodingContext is correctly wired into the full compilation
 * pipeline via runCG:
 *   1. Default (encoding: false) — no decode table in output
 *   2. encoding: true — reactive vars get encoded names
 *   3. encoding: true + runtime meta blocks — decode table + reflect emitted
 *   4. encoding: true, no meta blocks — decode table NOT emitted (tree-shaking)
 *   5. encoding: { enabled: true, debug: true } — encoded names contain $ suffix
 *   6. Encoded reactive-decl names appear in _scrml_reactive_set calls
 */

import { describe, test, expect } from "bun:test";
import { runCG } from "../../src/code-generator.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function span(start, file = "/test/app.scrml") {
  return { file, start, end: start + 10, line: 1, col: start + 1 };
}

/**
 * Build a minimal FileAST with the given nodes.
 */
function makeFileAST(filePath, nodes, opts = {}) {
  return {
    filePath,
    nodes,
    ast: { nodes },
    imports: opts.imports ?? [],
    exports: opts.exports ?? [],
    components: opts.components ?? [],
    typeDecls: opts.typeDecls ?? [],
    nodeTypes: opts.nodeTypes ?? new Map(),
    componentShapes: opts.componentShapes ?? new Map(),
    scopeChain: opts.scopeChain ?? null,
  };
}

function makeRouteMap() {
  return { functions: new Map() };
}

function makeDepGraph() {
  return { nodes: new Map(), edges: [] };
}

/**
 * Build a logic block containing reactive-decl nodes.
 */
function makeReactiveLogicBlock(reactiveDecls) {
  return {
    kind: "logic",
    body: reactiveDecls.map(({ name, init }) => ({
      kind: "state-decl",
      name,
      init: init ?? "undefined",
      span: span(0),
    })),
    span: span(0),
  };
}

/**
 * Build a meta block with capturedScope (runtime meta block).
 */
function makeRuntimeMetaBlock(body = [], capturedScope = []) {
  return {
    kind: "meta",
    body: body.length > 0 ? body : [{ kind: "bare-expr", expr: 'console.log("meta")', span: span(0) }],
    capturedScope,
    span: span(0),
  };
}

/**
 * Build a markup node so HTML output is generated.
 */
function makeMarkupNode(tag, children = []) {
  return {
    kind: "markup",
    tag,
    attributes: [],
    children,
    selfClosing: false,
    span: span(0),
  };
}

function makeTextNode(text) {
  return { kind: "text", value: text, span: span(0) };
}

// ---------------------------------------------------------------------------
// §1: Default (encoding: false) — no decode table in output
// ---------------------------------------------------------------------------

describe("§1: encoding disabled by default", () => {
  test("runCG without encoding option does not emit decode table", () => {
    const ast = makeFileAST("/test/app.scrml", [
      makeMarkupNode("div", [makeTextNode("Hello")]),
      makeReactiveLogicBlock([{ name: "count", init: "0" }]),
    ]);

    const result = runCG({
      files: [ast],
      routeMap: makeRouteMap(),
      depGraph: makeDepGraph(),
    });

    expect(result.errors).toHaveLength(0);
    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).toBeDefined();
    expect(out.clientJs).not.toContain("_scrml_decode_table");
    expect(out.clientJs).not.toContain("_scrml_reflect");
  });

  test("runCG with encoding: false does not emit decode table", () => {
    const ast = makeFileAST("/test/app.scrml", [
      makeMarkupNode("div", [makeTextNode("Hello")]),
      makeReactiveLogicBlock([{ name: "count", init: "0" }]),
    ]);

    const result = runCG({
      files: [ast],
      routeMap: makeRouteMap(),
      depGraph: makeDepGraph(),
      encoding: false,
    });

    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).not.toContain("_scrml_decode_table");
    // Original name should appear as-is
    expect(out.clientJs).toContain('"count"');
  });
});

// ---------------------------------------------------------------------------
// §2: encoding: true — reactive vars get encoded names
// ---------------------------------------------------------------------------

describe("§2: encoding enabled — reactive vars get encoded names", () => {
  test("reactive-decl names are encoded in _scrml_reactive_set calls", () => {
    const nodeTypes = new Map();
    nodeTypes.set("count", { kind: "asIs", constraint: null });

    const ast = makeFileAST("/test/app.scrml", [
      makeMarkupNode("div", [makeTextNode("Hello")]),
      makeReactiveLogicBlock([{ name: "count", init: "0" }]),
    ], { nodeTypes });

    const result = runCG({
      files: [ast],
      routeMap: makeRouteMap(),
      depGraph: makeDepGraph(),
      encoding: true,
    });

    expect(result.errors).toHaveLength(0);
    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).toBeDefined();
    // The encoded name starts with _x (asIs kind marker)
    expect(out.clientJs).toContain("_scrml_reactive_set(");
    // Original name "count" should NOT appear as a reactive key
    expect(out.clientJs).not.toContain('_scrml_reactive_set("count"');
  });

  test("multiple reactive vars each get distinct encoded names", () => {
    const nodeTypes = new Map();
    nodeTypes.set("a", { kind: "primitive", name: "string" });
    nodeTypes.set("b", { kind: "primitive", name: "string" });

    const ast = makeFileAST("/test/app.scrml", [
      makeMarkupNode("div", [makeTextNode("Hello")]),
      makeReactiveLogicBlock([
        { name: "a", init: '""' },
        { name: "b", init: '""' },
      ]),
    ], { nodeTypes });

    const result = runCG({
      files: [ast],
      routeMap: makeRouteMap(),
      depGraph: makeDepGraph(),
      encoding: true,
    });

    const out = result.outputs.get("/test/app.scrml");
    // Neither "a" nor "b" should appear as reactive keys
    expect(out.clientJs).not.toContain('_scrml_reactive_set("a"');
    expect(out.clientJs).not.toContain('_scrml_reactive_set("b"');
    // Should have two _scrml_reactive_set calls with encoded names
    const setMatches = out.clientJs.match(/_scrml_reactive_set\("/g);
    expect(setMatches.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// §3: encoding: true + runtime meta blocks — decode table + reflect emitted
// ---------------------------------------------------------------------------

describe("§3: encoding + runtime meta blocks — decode table emitted", () => {
  test("decode table and reflect emitted when runtime meta blocks present", () => {
    const nodeTypes = new Map();
    nodeTypes.set("count", { kind: "asIs", constraint: null });

    const ast = makeFileAST("/test/app.scrml", [
      makeMarkupNode("div", [makeTextNode("Hello")]),
      makeReactiveLogicBlock([{ name: "count", init: "0" }]),
      makeRuntimeMetaBlock(
        [{ kind: "bare-expr", expr: 'meta.types.reflect("count")', span: span(0) }],
        [{ name: "count", kind: "reactive" }],
      ),
    ], { nodeTypes });

    const result = runCG({
      files: [ast],
      routeMap: makeRouteMap(),
      depGraph: makeDepGraph(),
      encoding: true,
    });

    expect(result.errors).toHaveLength(0);
    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).toContain("_scrml_decode_table");
    expect(out.clientJs).toContain("_scrml_reflect");
    expect(out.clientJs).toContain("type decode table");
  });
});

// ---------------------------------------------------------------------------
// §4: encoding: true, no meta blocks — decode table NOT emitted (tree-shaking)
// ---------------------------------------------------------------------------

describe("§4: encoding without meta blocks — decode table tree-shaken", () => {
  test("no decode table when no runtime meta blocks exist", () => {
    const nodeTypes = new Map();
    nodeTypes.set("count", { kind: "asIs", constraint: null });

    const ast = makeFileAST("/test/app.scrml", [
      makeMarkupNode("div", [makeTextNode("Hello")]),
      makeReactiveLogicBlock([{ name: "count", init: "0" }]),
    ], { nodeTypes });

    const result = runCG({
      files: [ast],
      routeMap: makeRouteMap(),
      depGraph: makeDepGraph(),
      encoding: true,
    });

    const out = result.outputs.get("/test/app.scrml");
    // Encoding is enabled and names are encoded, but no decode table
    expect(out.clientJs).not.toContain("_scrml_decode_table");
    expect(out.clientJs).not.toContain("_scrml_reflect");
  });

  test("meta block without capturedScope is NOT a runtime meta block", () => {
    const nodeTypes = new Map();
    nodeTypes.set("count", { kind: "asIs", constraint: null });

    const ast = makeFileAST("/test/app.scrml", [
      makeMarkupNode("div", [makeTextNode("Hello")]),
      makeReactiveLogicBlock([{ name: "count", init: "0" }]),
      // Meta block without capturedScope — compile-time only
      {
        kind: "logic",
        body: [{
          kind: "meta",
          body: [{ kind: "bare-expr", expr: 'console.log("test")', span: span(0) }],
          // No capturedScope — not a runtime meta block
          span: span(0),
        }],
        span: span(0),
      },
    ], { nodeTypes });

    const result = runCG({
      files: [ast],
      routeMap: makeRouteMap(),
      depGraph: makeDepGraph(),
      encoding: true,
    });

    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).not.toContain("_scrml_decode_table");
  });
});

// ---------------------------------------------------------------------------
// §5: debug mode — encoded names contain $ suffix
// ---------------------------------------------------------------------------

describe("§5: debug mode encoding", () => {
  test("encoding: { enabled: true, debug: true } produces $-suffixed names", () => {
    const nodeTypes = new Map();
    nodeTypes.set("score", { kind: "primitive", name: "number" });

    const ast = makeFileAST("/test/app.scrml", [
      makeMarkupNode("div", [makeTextNode("Hello")]),
      makeReactiveLogicBlock([{ name: "score", init: "0" }]),
    ], { nodeTypes });

    const result = runCG({
      files: [ast],
      routeMap: makeRouteMap(),
      depGraph: makeDepGraph(),
      encoding: { enabled: true, debug: true },
    });

    const out = result.outputs.get("/test/app.scrml");
    // Debug mode: encoded names contain $originalName
    expect(out.clientJs).toContain("$score");
  });

  test("non-debug mode does not produce $ in encoded names", () => {
    const nodeTypes = new Map();
    nodeTypes.set("score", { kind: "primitive", name: "number" });

    const ast = makeFileAST("/test/app.scrml", [
      makeMarkupNode("div", [makeTextNode("Hello")]),
      makeReactiveLogicBlock([{ name: "score", init: "0" }]),
    ], { nodeTypes });

    const result = runCG({
      files: [ast],
      routeMap: makeRouteMap(),
      depGraph: makeDepGraph(),
      encoding: { enabled: true, debug: false },
    });

    const out = result.outputs.get("/test/app.scrml");
    // The reactive set call should not contain $ (debug suffix)
    const setCallMatch = out.clientJs.match(/_scrml_reactive_set\("([^"]+)"/);
    expect(setCallMatch).toBeTruthy();
    expect(setCallMatch[1]).not.toContain("$");
  });
});

// ---------------------------------------------------------------------------
// §6: Encoded reactive-decl names in _scrml_reactive_set calls
// ---------------------------------------------------------------------------

describe("§6: encoded names in reactive_set calls", () => {
  test("encoded name format is correct in output", () => {
    const nodeTypes = new Map();
    nodeTypes.set("user", {
      kind: "struct",
      name: "User",
      fields: new Map([
        ["name", { kind: "primitive", name: "string" }],
      ]),
    });

    const ast = makeFileAST("/test/app.scrml", [
      makeMarkupNode("div", [makeTextNode("Hello")]),
      makeReactiveLogicBlock([{ name: "user", init: "null" }]),
    ], { nodeTypes });

    const result = runCG({
      files: [ast],
      routeMap: makeRouteMap(),
      depGraph: makeDepGraph(),
      encoding: true,
    });

    const out = result.outputs.get("/test/app.scrml");
    // The encoded name should start with _s (struct kind marker)
    const setCallMatch = out.clientJs.match(/_scrml_reactive_set\("(_[a-z][0-9a-z]{8}[0-9a-z])"/);
    expect(setCallMatch).toBeTruthy();
    // Kind marker 's' for struct
    expect(setCallMatch[1][1]).toBe("s");
  });

  test("variables without nodeTypes get asIs type (marker 'x')", () => {
    // No nodeTypes set — falls back to { kind: "asIs", constraint: null }
    const ast = makeFileAST("/test/app.scrml", [
      makeMarkupNode("div", [makeTextNode("Hello")]),
      makeReactiveLogicBlock([{ name: "val", init: "42" }]),
    ]);

    const result = runCG({
      files: [ast],
      routeMap: makeRouteMap(),
      depGraph: makeDepGraph(),
      encoding: true,
    });

    const out = result.outputs.get("/test/app.scrml");
    // Should use 'x' kind marker for asIs
    const setCallMatch = out.clientJs.match(/_scrml_reactive_set\("(_[a-z][0-9a-z]{8}[0-9a-z])"/);
    expect(setCallMatch).toBeTruthy();
    expect(setCallMatch[1][1]).toBe("x");
  });
});

// ---------------------------------------------------------------------------
// §7: CgInput.encoding field validation
// ---------------------------------------------------------------------------

describe("§7: CgInput.encoding field variants", () => {
  test("encoding: undefined treated as disabled", () => {
    const ast = makeFileAST("/test/app.scrml", [
      makeMarkupNode("div", [makeTextNode("Hello")]),
      makeReactiveLogicBlock([{ name: "x", init: "1" }]),
    ]);

    const result = runCG({
      files: [ast],
      routeMap: makeRouteMap(),
      depGraph: makeDepGraph(),
      // encoding not set
    });

    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).toContain('"x"');
  });

  test("encoding: { enabled: false } treated as disabled", () => {
    const ast = makeFileAST("/test/app.scrml", [
      makeMarkupNode("div", [makeTextNode("Hello")]),
      makeReactiveLogicBlock([{ name: "x", init: "1" }]),
    ]);

    const result = runCG({
      files: [ast],
      routeMap: makeRouteMap(),
      depGraph: makeDepGraph(),
      encoding: { enabled: false },
    });

    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).toContain('"x"');
  });
});
