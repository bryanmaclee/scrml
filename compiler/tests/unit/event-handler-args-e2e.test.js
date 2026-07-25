/**
 * Event handler argument serialization — end-to-end pipeline tests
 *
 * These tests exercise the full path: call-ref AST node (with raw-string args
 * as produced by ast-builder.js splitArgs) → emit-html.js BindingRegistry →
 * emit-event-wiring.js → compiled clientJs output.
 *
 * Bug context: onclick=fn("arg") was reported to compile to fn() with the
 * argument silently dropped. These tests verify that the current implementation
 * is correct and provide regression coverage to prevent future regressions.
 *
 * The key insight: ast-builder.js parseAttributes() calls splitArgs() on the
 * raw content between parentheses, producing raw strings NOT structured objects.
 * For example:
 *   onclick=fn("apple")         → call-ref args: ['"apple"']
 *   onclick=fn(@counter)        → call-ref args: ['@counter']
 *   onclick=fn(item.id,"action")→ call-ref args: ['item.id', '"action"']
 *   onclick=fn()                → call-ref args: []
 *
 * Coverage:
 *   §1 String literal arg preserved — onclick=fn("apple") → fn("apple")
 *   §2 Reactive variable arg rewritten — onclick=fn(@counter) → fn(_scrml_reactive_get("counter"))
 *   §3 Multiple args preserved — onclick=fn(item.id,"action") → fn(item.id,"action")
 *   §4 No args — onclick=fn() → fn(event) (implicit event arg, tutorial §1.5)
 *   §5 HTML side — data-scrml-bind-onclick attribute emitted for delegation walk
 *   §6 Delegation path — args preserved in _scrml_click registry
 *   §7 Non-delegable path (onchange) — args preserved via querySelectorAll path
 */

import { describe, test, expect } from "bun:test";
import { runCG, CGError } from "../../src/code-generator.js";
import { foldChunkNamespacing } from "../helpers/chunk-scope.js";

// ---------------------------------------------------------------------------
// Helpers (mirrors code-generator.test.js conventions)
// ---------------------------------------------------------------------------

function span(start, file = "/test/app.scrml") {
  return { file, start, end: start + 10, line: 1, col: start + 1 };
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

function runCGSimple(nodes) {
  return runCG({
    files: [makeFileAST("/test/app.scrml", nodes)],
    routeMap: { functions: new Map() },
    depGraph: { nodes: new Map(), edges: [] },
    protectAnalysis: { views: new Map() },
  });
}

// ---------------------------------------------------------------------------
// §1: String literal arg preserved
// ---------------------------------------------------------------------------

describe("§1: string literal arg — onclick=fn(\"apple\") → fn(\"apple\")", () => {
  test("arg is present in compiled clientJs", () => {
    const result = runCGSimple([
      makeMarkupNode("button", [
        {
          name: "onclick",
          value: { kind: "call-ref", name: "selectItem", args: ['"apple"'] },
          span: span(0),
        },
      ], [makeTextNode("Apple")]),
    ]);

    expect(result.errors).toHaveLength(0);
    const out = result.outputs.get("/test/app.scrml");
    expect(foldChunkNamespacing(out.clientJs)).toContain('selectItem("apple")');
  });

  test("arg is not silently dropped — fn() form is absent", () => {
    const result = runCGSimple([
      makeMarkupNode("button", [
        {
          name: "onclick",
          value: { kind: "call-ref", name: "selectItem", args: ['"apple"'] },
          span: span(0),
        },
      ], [makeTextNode("Apple")]),
    ]);

    const out = result.outputs.get("/test/app.scrml");
    // selectItem() with no args must not appear
    expect(foldChunkNamespacing(out.clientJs)).not.toMatch(/selectItem\(\s*\)/);
  });

  test("multiple buttons with distinct string args each get the correct arg", () => {
    const result = runCGSimple([
      makeMarkupNode("div", [], [
        makeMarkupNode("button", [
          { name: "onclick", value: { kind: "call-ref", name: "select", args: ['"apple"'] }, span: span(0) },
        ], [makeTextNode("Apple")]),
        makeMarkupNode("button", [
          { name: "onclick", value: { kind: "call-ref", name: "select", args: ['"banana"'] }, span: span(10) },
        ], [makeTextNode("Banana")]),
        makeMarkupNode("button", [
          { name: "onclick", value: { kind: "call-ref", name: "select", args: ['"cherry"'] }, span: span(20) },
        ], [makeTextNode("Cherry")]),
      ]),
    ]);

    expect(result.errors).toHaveLength(0);
    const out = result.outputs.get("/test/app.scrml");
    expect(foldChunkNamespacing(out.clientJs)).toContain('select("apple")');
    expect(foldChunkNamespacing(out.clientJs)).toContain('select("banana")');
    expect(foldChunkNamespacing(out.clientJs)).toContain('select("cherry")');
  });
});

// ---------------------------------------------------------------------------
// §2: Reactive variable arg rewritten
// ---------------------------------------------------------------------------

describe("§2: reactive variable arg — onclick=fn(@counter) → fn(_scrml_reactive_get(\"counter\"))", () => {
  test("@-prefixed raw string arg is rewritten to reactive getter", () => {
    const result = runCGSimple([
      makeMarkupNode("button", [
        {
          name: "onclick",
          value: { kind: "call-ref", name: "increment", args: ["@counter"] },
          span: span(0),
        },
      ], [makeTextNode("+")]),
    ]);

    expect(result.errors).toHaveLength(0);
    const out = result.outputs.get("/test/app.scrml");
    expect(foldChunkNamespacing(out.clientJs)).toContain('increment(_scrml_reactive_get("counter"))');
  });

  test("bare @var is not left unrewritten in output", () => {
    const result = runCGSimple([
      makeMarkupNode("button", [
        {
          name: "onclick",
          value: { kind: "call-ref", name: "increment", args: ["@counter"] },
          span: span(0),
        },
      ], [makeTextNode("+")]),
    ]);

    const out = result.outputs.get("/test/app.scrml");
    expect(foldChunkNamespacing(out.clientJs)).not.toContain("increment(@counter)");
    expect(foldChunkNamespacing(out.clientJs)).not.toMatch(/increment\(\s*\)/);
  });
});

// ---------------------------------------------------------------------------
// §3: Multiple args preserved
// ---------------------------------------------------------------------------

describe("§3: multiple args — onclick=fn(item.id, \"action\") → fn(item.id, \"action\")", () => {
  test("two raw-string args both appear in the compiled call", () => {
    const result = runCGSimple([
      makeMarkupNode("button", [
        {
          name: "onclick",
          value: { kind: "call-ref", name: "handleAction", args: ["item.id", '"action"'] },
          span: span(0),
        },
      ], [makeTextNode("Do it")]),
    ]);

    expect(result.errors).toHaveLength(0);
    const out = result.outputs.get("/test/app.scrml");
    expect(foldChunkNamespacing(out.clientJs)).toContain('handleAction(item.id, "action")');
  });

  test("neither arg is dropped from the call", () => {
    const result = runCGSimple([
      makeMarkupNode("button", [
        {
          name: "onclick",
          value: { kind: "call-ref", name: "handleAction", args: ["item.id", '"action"'] },
          span: span(0),
        },
      ], [makeTextNode("Do it")]),
    ]);

    const out = result.outputs.get("/test/app.scrml");
    expect(foldChunkNamespacing(out.clientJs)).not.toMatch(/handleAction\(\s*\)/);
    expect(foldChunkNamespacing(out.clientJs)).not.toMatch(/handleAction\(\s*item\.id\s*\)/);
  });
});

// ---------------------------------------------------------------------------
// §4: No args — onclick=fn() → function(event) { fn(); } per SPEC §5.2.2
// ---------------------------------------------------------------------------
//
// S96 Bug 14 — SPEC §5.2.2 normative wording (line 1128):
//   "`onclick=fn()` SHALL wire `fn` as a click handler. The compiler MUST
//    auto-wrap the call as `function(event) { fn(); }`. `fn` is NOT invoked
//    at render time."
//
// Spec is explicit: `fn()` SHALL emit `fn()` inside the wrapper — NOT
// `fn(event)`. The escape-hatch for handlers needing the event object is
// `onclick=${(e) => fn(e)}` per §5.2.2 line 1123.
//
// Pre-S96 the implementation auto-threaded `event` here citing tutorial §1.5
// (non-normative) and locking the behavior in these tests. Per pa.md Rule 4
// (SPEC normative; derived docs are NOT) and user-decision S96 option-1,
// the implementation was reverted to the spec-compliant shape and these
// tests were updated in lockstep.

describe("§4: no args — onclick=fn() → function(event) { fn(); } (SPEC §5.2.2)", () => {
  test("empty args array preserves bare-call shape — does NOT thread event into fn", () => {
    const result = runCGSimple([
      makeMarkupNode("button", [
        {
          name: "onclick",
          value: { kind: "call-ref", name: "doThing", args: [] },
          span: span(0),
        },
      ], [makeTextNode("Go")]),
    ]);

    expect(result.errors).toHaveLength(0);
    const out = result.outputs.get("/test/app.scrml");
    // SPEC §5.2.2: fn() stays fn() — wrapper takes `event` but doesn't forward it
    expect(foldChunkNamespacing(out.clientJs)).toMatch(/function\(event\)\s*\{\s*doThing\(\);/);
    // Pre-S96 spec-divergent shape must not reappear
    expect(foldChunkNamespacing(out.clientJs)).not.toContain("doThing(event)");
  });

  test("onkeydown=handleKey() — bare-call wrapped without event-threading (SPEC §5.2.2)", () => {
    const result = runCGSimple([
      makeMarkupNode("input", [
        {
          name: "onkeydown",
          value: { kind: "call-ref", name: "handleKey", args: [] },
          span: span(0),
        },
      ], [], { selfClosing: true }),
    ]);

    expect(result.errors).toHaveLength(0);
    const out = result.outputs.get("/test/app.scrml");
    // SPEC: `handleKey()` is invoked with the user's declared args (none here).
    // The wrapper still takes `event` so the listener signature is satisfied,
    // but `event` is NOT forwarded into the call. The escape-hatch for keyboard
    // handlers that need the event is `onkeydown=${(e) => handleKey(e)}`.
    expect(foldChunkNamespacing(out.clientJs)).toMatch(/function\(event\)\s*\{\s*handleKey\(\);/);
    expect(foldChunkNamespacing(out.clientJs)).not.toContain("handleKey(event)");
  });

  test("non-empty args are NOT auto-injected (user was explicit)", () => {
    const result = runCGSimple([
      makeMarkupNode("button", [
        {
          name: "onclick",
          value: { kind: "call-ref", name: "classify", args: ["10"] },
          span: span(0),
        },
      ], [makeTextNode("10")]),
    ]);

    expect(result.errors).toHaveLength(0);
    const out = result.outputs.get("/test/app.scrml");
    expect(foldChunkNamespacing(out.clientJs)).toContain("classify(10)");
    // No auto-injection of event when args were explicit
    expect(foldChunkNamespacing(out.clientJs)).not.toContain("classify(10, event)");
    expect(foldChunkNamespacing(out.clientJs)).not.toContain("classify(event, 10)");
  });
});

// ---------------------------------------------------------------------------
// §5: HTML side — data-scrml-bind-onclick attribute emitted
// ---------------------------------------------------------------------------

describe("§5: HTML — data-scrml-bind-onclick attribute emitted for delegation walk", () => {
  test("call-ref onclick attr produces data-scrml-bind-onclick in HTML", () => {
    const result = runCGSimple([
      makeMarkupNode("button", [
        {
          name: "onclick",
          value: { kind: "call-ref", name: "go", args: ['"home"'] },
          span: span(0),
        },
      ], [makeTextNode("Go home")]),
    ]);

    expect(result.errors).toHaveLength(0);
    const out = result.outputs.get("/test/app.scrml");
    expect(out.html).toContain("data-scrml-bind-onclick");
    // clientJs must also have the delegation wiring with the arg
    expect(foldChunkNamespacing(out.clientJs)).toContain('go("home")');
  });

  test("HTML does not contain onclick= attribute directly", () => {
    // scrml never emits raw onclick= attributes — always data-scrml-bind-onclick
    const result = runCGSimple([
      makeMarkupNode("button", [
        {
          name: "onclick",
          value: { kind: "call-ref", name: "go", args: ['"home"'] },
          span: span(0),
        },
      ], [makeTextNode("Go home")]),
    ]);

    const out = result.outputs.get("/test/app.scrml");
    expect(out.html).not.toContain(' onclick=');
  });
});

// ---------------------------------------------------------------------------
// §6: Delegation path — args preserved in _scrml_click registry
// ---------------------------------------------------------------------------

describe("§6: delegation path — click registry entry includes the arg", () => {
  test("_scrml_click registry entry contains the full handler with arg", () => {
    const result = runCGSimple([
      makeMarkupNode("button", [
        {
          name: "onclick",
          value: { kind: "call-ref", name: "selectItem", args: ['"banana"'] },
          span: span(0),
        },
      ], [makeTextNode("Banana")]),
    ]);

    expect(result.errors).toHaveLength(0);
    const out = result.outputs.get("/test/app.scrml");
    // The delegation registry must contain the handler with the arg
    expect(foldChunkNamespacing(out.clientJs)).toContain("_scrml_click");
    expect(foldChunkNamespacing(out.clientJs)).toContain('selectItem("banana")');
  });

  test("delegated click uses document.addEventListener (not querySelectorAll)", () => {
    const result = runCGSimple([
      makeMarkupNode("button", [
        {
          name: "onclick",
          value: { kind: "call-ref", name: "go", args: ['"page"'] },
          span: span(0),
        },
      ], [makeTextNode("Go")]),
    ]);

    const out = result.outputs.get("/test/app.scrml");
    expect(foldChunkNamespacing(out.clientJs)).toContain('document.addEventListener("click"');
    expect(foldChunkNamespacing(out.clientJs)).not.toContain("querySelectorAll('[data-scrml-bind-onclick]')");
  });
});

// ---------------------------------------------------------------------------
// §7: Non-delegable path — args preserved via querySelectorAll path
// ---------------------------------------------------------------------------

describe("§7: non-delegable path — args preserved in onchange handler", () => {
  test("onchange handler with raw-string arg emits correct arg in querySelectorAll path", () => {
    const result = runCGSimple([
      makeMarkupNode("select", [
        {
          name: "onchange",
          value: { kind: "call-ref", name: "onChange", args: ['"option"'] },
          span: span(0),
        },
      ], []),
    ]);

    expect(result.errors).toHaveLength(0);
    const out = result.outputs.get("/test/app.scrml");
    expect(foldChunkNamespacing(out.clientJs)).toContain('onChange("option")');
    expect(foldChunkNamespacing(out.clientJs)).toContain("_scrml_change_handlers");
    expect(foldChunkNamespacing(out.clientJs)).toContain("querySelectorAll('[data-scrml-bind-onchange]')");
  });
});
