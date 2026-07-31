/**
 * v0.3 Wave 2 item (b) — TAB extension integration tests
 *
 * Coverage (per dispatch brief §4.4 acceptance criteria):
 *   1. <page> direct text children parse with `state` parent context.
 *   2. 7 new declaration shapes auto-lift inside <program> AND <page>:
 *      function, fn, server-function, type-enum, type-struct, let, const.
 *   3. W-PROGRAM-REDUNDANT-LOGIC fires on redundant `${...}` wrappers
 *      inside <program> / <page>.
 *      Negative: mixed-content `${...}` body suppresses the warning.
 *   4. E-PAGE-INVALID-ATTR fires per disallowed attr.
 *      E-PAGE-ROUTE-ATTR-FORBIDDEN takes precedence for `route=`.
 *      Multi-violation files emit multiple errors.
 *   5. Markup-text suppression intact: <p>function name() { ... }</p>
 *      does NOT lift.
 *   6. Multi-decl text blocks split correctly.
 *
 * SPEC anchors: §40.8 (program-as-container), §4.15 (<page> registration),
 * §34 (diagnostic catalog rows for W-PROGRAM-REDUNDANT-LOGIC,
 * E-PAGE-INVALID-ATTR, E-PAGE-ROUTE-ATTR-FORBIDDEN).
 */

import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";

/** Compile a source string through BS -> TAB. */
function compile(source, filePath = "test.scrml") {
  const bs = splitBlocks(filePath, source);
  return buildAST(bs);
}

/** Find every error with the given diagnostic code. */
function errorsByCode(errors, code) {
  return (errors || []).filter(e => e?.code === code);
}

/** Recursively collect every node matching `kind`. */
function collectNodes(root, kind) {
  const out = [];
  function walk(n) {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (n.kind === kind) out.push(n);
    if (Array.isArray(n.children)) walk(n.children);
    if (Array.isArray(n.body)) walk(n.body);
    if (Array.isArray(n.nodes)) walk(n.nodes);
  }
  walk(root);
  return out;
}

// =============================================================================
// §1 — <page> default-logic body recognition (brief §4.3.1)
// =============================================================================

describe("v0.3 W2b §1 — <page> as default-logic body container", () => {
  // Note: V5-strict state-decl shape `<x> = …` inside <program>/<page> body
  // still requires explicit `${...}` wrapping at the BS layer (BS peeks for
  // state-decl shape only at file top level / inside <channel>; markup body
  // context auto-parses `<x>` as a markup opener). The auto-lift extension
  // recognised by this dispatch is for the NON-markup-shaped declarations
  // (function / fn / server-fn / type / let / const) that BS does emit as
  // text blocks inside markup body.

  test("<page> auto-lifts a function declaration", () => {
    const src = "<page>\n  function greet(name) { return \"hi \" + name }\n  <div>page</div>\n</page>";
    const { ast } = compile(src);
    const fns = collectNodes(ast, "function-decl");
    const greet = fns.find(f => f.name === "greet");
    expect(greet).toBeDefined();
  });

  test("<page> auto-lifts a type declaration", () => {
    const src = "<page>\n  type Status:enum = { Idle, Loading, Done }\n  <div>page</div>\n</page>";
    const { ast } = compile(src);
    const tdecls = collectNodes(ast, "type-decl").filter(t => t.name === "Status");
    expect(tdecls.length).toBeGreaterThanOrEqual(1);
  });

  test("nested <program><page> — <page> body auto-lifts function", () => {
    const src = "<program>\n  <page auth=\"required\">\n    function greet(name) { return name }\n  </page>\n</program>";
    const { ast } = compile(src);
    const fns = collectNodes(ast, "function-decl").filter(f => f.name === "greet");
    expect(fns.length).toBeGreaterThanOrEqual(1);
  });
});

// =============================================================================
// §2 — Extended top-level declaration regex catalog (brief §4.3.2)
// =============================================================================

describe("v0.3 W2b §2 — extended top-level declaration lift", () => {
  test("bare let auto-lifts inside <program>", () => {
    const src = "<program>\n  let x = 5\n  <div>${x}</div>\n</program>";
    const { ast } = compile(src);
    const lets = collectNodes(ast, "let-decl").filter(l => l.name === "x");
    expect(lets.length).toBeGreaterThanOrEqual(1);
  });

  test("bare const auto-lifts inside <program>", () => {
    const src = "<program>\n  const N = 42\n  <div>${N}</div>\n</program>";
    const { ast } = compile(src);
    const consts = collectNodes(ast, "const-decl").filter(c => c.name === "N");
    expect(consts.length).toBeGreaterThanOrEqual(1);
  });

  test("bare function auto-lifts inside <program>", () => {
    const src = "<program>\n  function add(a, b) { return a + b }\n  <div>page</div>\n</program>";
    const { ast } = compile(src);
    const fns = collectNodes(ast, "function-decl").filter(f => f.name === "add");
    expect(fns.length).toBeGreaterThanOrEqual(1);
  });

  test("bare fn auto-lifts inside <program>", () => {
    const src = "<program>\n  fn greet(name) { return \"hi \" + name }\n  <div>page</div>\n</program>";
    const { ast } = compile(src);
    const fns = collectNodes(ast, "function-decl").filter(f => f.name === "greet");
    expect(fns.length).toBeGreaterThanOrEqual(1);
  });

  test("bare server function auto-lifts inside <program>", () => {
    const src = "<program>\n  server function fetchData() { return 1 }\n  <div>page</div>\n</program>";
    const { ast } = compile(src);
    const fns = collectNodes(ast, "function-decl").filter(f => f.name === "fetchData");
    expect(fns.length).toBeGreaterThanOrEqual(1);
  });

  test("bare type:enum auto-lifts inside <program>", () => {
    const src = "<program>\n  type Color:enum = { Red, Green, Blue }\n  <div>page</div>\n</program>";
    const { ast } = compile(src);
    const tdecls = collectNodes(ast, "type-decl").filter(t => t.name === "Color");
    expect(tdecls.length).toBeGreaterThanOrEqual(1);
  });

  test("bare type struct auto-lifts inside <program>", () => {
    const src = "<program>\n  type Point = { x: number, y: number }\n  <div>page</div>\n</program>";
    const { ast } = compile(src);
    const tdecls = collectNodes(ast, "type-decl").filter(t => t.name === "Point");
    expect(tdecls.length).toBeGreaterThanOrEqual(1);
  });

  // --- Symmetric coverage inside <page> ---

  test("bare let auto-lifts inside <page>", () => {
    const src = "<page>\n  let x = 5\n  <div>${x}</div>\n</page>";
    const { ast } = compile(src);
    expect(collectNodes(ast, "let-decl").some(l => l.name === "x")).toBe(true);
  });

  test("bare const auto-lifts inside <page>", () => {
    const src = "<page>\n  const N = 42\n  <div>${N}</div>\n</page>";
    const { ast } = compile(src);
    expect(collectNodes(ast, "const-decl").some(c => c.name === "N")).toBe(true);
  });

  test("bare function auto-lifts inside <page>", () => {
    const src = "<page>\n  function add(a, b) { return a + b }\n  <div>page</div>\n</page>";
    const { ast } = compile(src);
    expect(collectNodes(ast, "function-decl").some(f => f.name === "add")).toBe(true);
  });

  test("bare type:enum auto-lifts inside <page>", () => {
    const src = "<page>\n  type Status:enum = { Idle, Loading, Done }\n  <div>page</div>\n</page>";
    const { ast } = compile(src);
    expect(collectNodes(ast, "type-decl").some(t => t.name === "Status")).toBe(true);
  });
});

// =============================================================================
// §3 — Multi-decl text-block splitting + markup suppression (brief §4.4 #6, #7)
// =============================================================================

describe("v0.3 W2b §3 — multi-decl splitting + markup suppression", () => {
  test("three separate declarations in one block all lift", () => {
    // Three NON-markup-shaped top-level decls separated by blank lines.
    // V5-strict state-decl `<x>=0` shape still requires ${...} wrap (BS-layer
    // limitation outside this dispatch scope).
    const src = [
      "<program>",
      "  let counter = 0",
      "",
      "  function inc() { counter = counter + 1 }",
      "",
      "  type Status:enum = { Idle, Done }",
      "  <div>page</div>",
      "</program>",
    ].join("\n");
    const { ast } = compile(src);
    const lets = collectNodes(ast, "let-decl").filter(d => d.name === "counter");
    const fns = collectNodes(ast, "function-decl").filter(f => f.name === "inc");
    const types = collectNodes(ast, "type-decl").filter(t => t.name === "Status");
    expect(lets.length).toBeGreaterThanOrEqual(1);
    expect(fns.length).toBeGreaterThanOrEqual(1);
    expect(types.length).toBeGreaterThanOrEqual(1);
  });

  test("function-shaped text inside <p>...</p> is NOT lifted", () => {
    // Inside a markup descendant of <program>, text is prose — must remain text.
    const src = "<program>\n  <p>function name() { ... }</p>\n</program>";
    const { ast } = compile(src);
    // No function-decl named "name" should have been created.
    const fns = collectNodes(ast, "function-decl").filter(f => f.name === "name");
    expect(fns.length).toBe(0);
  });

  test("function-shaped text inside <p>...</p> nested in <page> is NOT lifted", () => {
    const src = "<page>\n  <div><p>function name() { ... }</p></div>\n</page>";
    const { ast } = compile(src);
    const fns = collectNodes(ast, "function-decl").filter(f => f.name === "name");
    expect(fns.length).toBe(0);
  });
});

// =============================================================================
// §4 — W-PROGRAM-REDUNDANT-LOGIC (brief §4.3.3, §4.4 #3)
// =============================================================================

describe("v0.3 W2b §4 — W-PROGRAM-REDUNDANT-LOGIC", () => {
  test("fires on <program>${decls-only}</program>", () => {
    const src = "<program>${ <count> = 0; let x = 5 }</program>";
    const { errors } = compile(src);
    const hits = errorsByCode(errors, "W-PROGRAM-REDUNDANT-LOGIC");
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0].severity).toBe("warning");
  });

  test("fires on <page>${decls-only}</page>", () => {
    const src = "<page>${ <q> = \"\"; function clear() { @q = \"\" } }</page>";
    const { errors } = compile(src);
    const hits = errorsByCode(errors, "W-PROGRAM-REDUNDANT-LOGIC");
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  test("does NOT fire when ${...} body mixes decls with non-decl logic", () => {
    // A `for` loop inside the ${...} body is "real work" — wrapping is not
    // redundant per brief §4.3.3 edge case.
    const src = "<program>${ <count> = 0; for (x of @items) { @count = @count + 1 } }</program>";
    const { errors } = compile(src);
    const hits = errorsByCode(errors, "W-PROGRAM-REDUNDANT-LOGIC");
    expect(hits.length).toBe(0);
  });

  test("does NOT fire when <program> body uses default-logic auto-lift", () => {
    // The canonical v0.3 shape — no explicit ${...} wrapper.
    const src = "<program>\n  <count> = 0\n  function inc() { @count = @count + 1 }\n  <div>page</div>\n</program>";
    const { errors } = compile(src);
    const hits = errorsByCode(errors, "W-PROGRAM-REDUNDANT-LOGIC");
    expect(hits.length).toBe(0);
  });

  test("does NOT fire on synthetic lift wrappers (compiler-synthesised)", () => {
    // Bare decls get wrapped in synthetic ${...} blocks by liftBareDeclarations
    // — the resulting LogicNode carries _synthetic:true and is exempt.
    const src = "<program>\n  let y = 1\n</program>";
    const { errors } = compile(src);
    const hits = errorsByCode(errors, "W-PROGRAM-REDUNDANT-LOGIC");
    expect(hits.length).toBe(0);
  });
});

// =============================================================================
// §5 — <page> per-route attribute validation (brief §4.3.4, §4.4 #4)
// =============================================================================

describe("v0.3 W2b §5 — <page> per-route attribute validation", () => {
  test("E-PAGE-ROUTE-ATTR-FORBIDDEN fires on <page route='...'>", () => {
    const src = "<page route=\"/loads\">content</page>";
    const { errors } = compile(src);
    const hits = errorsByCode(errors, "E-PAGE-ROUTE-ATTR-FORBIDDEN");
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  test("E-PAGE-ROUTE-ATTR-FORBIDDEN does NOT also fire E-PAGE-INVALID-ATTR for route=", () => {
    const src = "<page route=\"/x\">content</page>";
    const { errors } = compile(src);
    const routeHits = errorsByCode(errors, "E-PAGE-ROUTE-ATTR-FORBIDDEN");
    const invalidHits = errorsByCode(errors, "E-PAGE-INVALID-ATTR").filter(e => /\broute\b/.test(e.message));
    // The catalog rule: route= fires its dedicated code, never both. The
    // E-PAGE-INVALID-ATTR walker filters route= out of its candidate set.
    expect(routeHits.length).toBeGreaterThanOrEqual(1);
    expect(invalidHits.length).toBe(0);
  });

  test("E-PAGE-INVALID-ATTR fires on app-wide attr (title=)", () => {
    const src = "<page title=\"My Page\">content</page>";
    const { errors } = compile(src);
    const hits = errorsByCode(errors, "E-PAGE-INVALID-ATTR");
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0].message).toMatch(/title/);
  });

  test("E-PAGE-INVALID-ATTR fires on nested-program attr (name=)", () => {
    const src = "<page name=\"worker\">content</page>";
    const { errors } = compile(src);
    const hits = errorsByCode(errors, "E-PAGE-INVALID-ATTR");
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0].message).toMatch(/name/);
  });

  test("ALL four allowed attrs pass without diagnostics", () => {
    const src = "<page db=\"./app.db\" auth=\"required\" csrf=\"auto\" ratelimit=\"100/min\">content</page>";
    const { errors } = compile(src);
    const pageHits = (errors || []).filter(e => e?.code === "E-PAGE-INVALID-ATTR" || e?.code === "E-PAGE-ROUTE-ATTR-FORBIDDEN");
    expect(pageHits.length).toBe(0);
  });

  test("multi-violation file emits multiple errors (no bail)", () => {
    // route= + title= + name= — three violations, all reported.
    const src = "<page route=\"/x\" title=\"T\" name=\"w\">content</page>";
    const { errors } = compile(src);
    const routeHits = errorsByCode(errors, "E-PAGE-ROUTE-ATTR-FORBIDDEN");
    const invalidHits = errorsByCode(errors, "E-PAGE-INVALID-ATTR");
    expect(routeHits.length).toBeGreaterThanOrEqual(1);
    expect(invalidHits.length).toBeGreaterThanOrEqual(2); // title + name
  });

  test("validates <page> nested inside <program>", () => {
    const src = "<program>\n  <page title=\"X\">content</page>\n</program>";
    const { errors } = compile(src);
    const hits = errorsByCode(errors, "E-PAGE-INVALID-ATTR");
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });
});
