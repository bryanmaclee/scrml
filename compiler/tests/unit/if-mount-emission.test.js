/**
 * Phase 2c if= mount/unmount emission — Unit Tests
 *
 * Coverage for the new B1 emission path activated in Phase 2c
 * (per recon §4 N1-N24, deep-dive §3).
 *
 * Coverage:
 *   §1  HTML emission shape (N1-N11)         — clean-subtree → template+marker;
 *                                               non-clean → display-toggle fallback
 *   §2  Registry binding shape (N12-N15)     — isMountToggle, templateId, markerId,
 *                                               varName/dotPath/condExpr/refs
 *   §3  Client JS controller (N16-N21)       — _scrml_create_scope, _scrml_mount_template,
 *                                               _scrml_unmount_scope, initial mount, effect
 *   §4  Round-trip via runCG (N22-N24)       — full pipeline B1 emission shape
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { generateHtml } from "../../src/codegen/emit-html.js";
import { BindingRegistry } from "../../src/codegen/binding-registry.ts";
import { resetVarCounter } from "../../src/codegen/var-counter.ts";
import { runCG } from "../../src/code-generator.js";
import { foldChunkNamespacing } from "../helpers/chunk-scope.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function span(start = 0, file = "/test/app.scrml") {
  return { file, start, end: start + 10, line: 1, col: start + 1 };
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

function makeFileAST(nodes) {
  return {
    filePath: "/test/app.scrml",
    nodes,
    imports: [],
    exports: [],
    components: [],
    typeDecls: [],
    nodeTypes: new Map(),
    componentShapes: new Map(),
    scopeChain: null,
  };
}

function makeRouteMap() { return { functions: new Map() }; }
function makeDepGraph() { return { nodes: new Map(), edges: [] }; }
function makeProtectAnalysis() { return { views: new Map() }; }

function compile(markupNode) {
  const ast = makeFileAST([markupNode]);
  return runCG({
    files: [ast],
    routeMap: makeRouteMap(),
    depGraph: makeDepGraph(),
    protectAnalysis: makeProtectAnalysis(),
  });
}

function varRefAttr(name, varName) {
  return {
    name,
    value: { kind: "variable-ref", name: varName, span: span(0) },
    span: span(0),
  };
}

function exprAttr(name, raw, refs = []) {
  return {
    name,
    value: { kind: "expr", raw, refs, span: span(0) },
    span: span(0),
  };
}

function eventAttr(name, handlerName) {
  return {
    name,
    value: { kind: "call-ref", name: handlerName, args: [], span: span(0) },
    span: span(0),
  };
}

beforeEach(() => {
  resetVarCounter();
});

// ---------------------------------------------------------------------------
// §1  HTML emission shape (N1-N11)
// ---------------------------------------------------------------------------

describe("§1: clean-subtree if= emits template + marker (N1-N3)", () => {
  test("N1: clean if= emits <template id=\"...\"> wrapping the element", () => {
    const node = makeMarkupNode("div", [varRefAttr("if", "@visible")], [
      { kind: "text", value: "hello", span: span(0) }
    ]);
    const registry = new BindingRegistry();
    const html = generateHtml([node], [], false, registry, null);
    expect(html).toMatch(/<template id="_scrml_scrml_tpl_/);
  });

  test("N2: template content is the element with if= attr stripped", () => {
    const node = makeMarkupNode("div", [varRefAttr("if", "@visible")], [
      { kind: "text", value: "hello", span: span(0) }
    ]);
    const registry = new BindingRegistry();
    const html = generateHtml([node], [], false, registry, null);
    // Template content has the inner div with NO if= attribute and NO data-scrml-bind-if.
    const tplMatch = html.match(/<template id="[^"]+">(.*?)<\/template>/s);
    expect(tplMatch).not.toBeNull();
    const tplContent = tplMatch[1];
    expect(tplContent).toContain("<div>hello</div>");
    expect(tplContent).not.toContain("if=");
    expect(tplContent).not.toContain("data-scrml-bind-if");
  });

  test("N3: marker comment appears immediately after the template", () => {
    const node = makeMarkupNode("div", [varRefAttr("if", "@visible")], [
      { kind: "text", value: "hi", span: span(0) }
    ]);
    const registry = new BindingRegistry();
    const html = generateHtml([node], [], false, registry, null);
    expect(html).toMatch(/<\/template><!--scrml-if-marker:_scrml_if_marker_/);
  });
});

describe("§1: non-clean if= falls back to display-toggle (N4-N9)", () => {
  test("N4: if= on element with onclick child falls back", () => {
    const inner = makeMarkupNode("button", [eventAttr("onclick", "handle")], []);
    const node = makeMarkupNode("div", [varRefAttr("if", "@visible")], [inner]);
    const registry = new BindingRegistry();
    const html = generateHtml([node], [], false, registry, null);
    // Fallback path emits data-scrml-bind-if; no <template>+marker.
    expect(html).toContain("data-scrml-bind-if=");
    expect(html).not.toContain("<template");
    expect(html).not.toContain("scrml-if-marker:");
  });

  test("N5: if= on uppercase tag (component) falls back", () => {
    const node = makeMarkupNode("MyComp", [varRefAttr("if", "@x")], [
      { kind: "text", value: "hi", span: span(0) }
    ]);
    const registry = new BindingRegistry();
    const html = generateHtml([node], [], false, registry, null);
    expect(html).toContain("data-scrml-bind-if=");
    expect(html).not.toContain("<template");
  });

  test("N6: if= on element with bind:value falls back", () => {
    const node = makeMarkupNode("input",
      [
        varRefAttr("if", "@visible"),
        { name: "bind:value", value: { kind: "variable-ref", name: "@x" }, span: span(0) },
      ],
      [],
      { selfClosing: true },
    );
    const registry = new BindingRegistry();
    const html = generateHtml([node], [], false, registry, null);
    expect(html).toContain("data-scrml-bind-if=");
    expect(html).not.toContain("<template");
  });

  test("N7: if= on element with reactive interpolation in child attribute falls back", () => {
    const inner = makeMarkupNode("span",
      [{ name: "class", value: { kind: "string-literal", value: "${@count}-class" }, span: span(0) }],
      [],
    );
    const node = makeMarkupNode("div", [varRefAttr("if", "@visible")], [inner]);
    const registry = new BindingRegistry();
    const html = generateHtml([node], [], false, registry, null);
    expect(html).toContain("data-scrml-bind-if=");
    expect(html).not.toContain("<template");
  });

  test("N8: transition:fade on if= element falls back", () => {
    const node = makeMarkupNode("p",
      [varRefAttr("if", "@visible"),
       { name: "transition:fade", value: { kind: "absent" }, span: span(0) }],
      [{ kind: "text", value: "fading", span: span(0) }],
    );
    const registry = new BindingRegistry();
    const html = generateHtml([node], [], false, registry, null);
    expect(html).toContain("data-scrml-bind-if=");
    expect(html).not.toContain("<template");
  });

  test("N9: if= with show= on same element falls back (show is not wiring-free)", () => {
    const node = makeMarkupNode("div",
      [varRefAttr("if", "@a"),
       varRefAttr("show", "@b")],
      [{ kind: "text", value: "x", span: span(0) }],
    );
    const registry = new BindingRegistry();
    const html = generateHtml([node], [], false, registry, null);
    expect(html).toContain("data-scrml-bind-if=");
    expect(html).not.toContain("<template");
  });
});

// ---------------------------------------------------------------------------
// §2  Registry binding shape (N12-N15)
// ---------------------------------------------------------------------------

describe("§2: clean-subtree if= registers an isMountToggle binding (N12-N14)", () => {
  test("N12: clean-subtree if= registers binding with isMountToggle: true", () => {
    const node = makeMarkupNode("div", [varRefAttr("if", "@visible")], [
      { kind: "text", value: "hi", span: span(0) }
    ]);
    const registry = new BindingRegistry();
    generateHtml([node], [], false, registry, null);
    const binding = registry.logicBindings.find(b => b.isMountToggle);
    expect(binding).toBeDefined();
    expect(binding.isMountToggle).toBe(true);
    expect(binding.templateId).toBeDefined();
    expect(binding.markerId).toBeDefined();
  });

  test("N13: clean-subtree if= binding has condExpr and refs for expr kind", () => {
    const node = makeMarkupNode("div", [exprAttr("if", "!@active", ["active"])], [
      { kind: "text", value: "hi", span: span(0) }
    ]);
    const registry = new BindingRegistry();
    generateHtml([node], [], false, registry, null);
    const binding = registry.logicBindings.find(b => b.isMountToggle);
    expect(binding.condExpr).toBe("!@active");
    expect(binding.refs).toContain("active");
  });

  test("N14: clean-subtree if=@user.loggedIn binding has varName and dotPath", () => {
    const node = makeMarkupNode("div", [varRefAttr("if", "@user.loggedIn")], [
      { kind: "text", value: "hi", span: span(0) }
    ]);
    const registry = new BindingRegistry();
    generateHtml([node], [], false, registry, null);
    const binding = registry.logicBindings.find(b => b.isMountToggle);
    expect(binding.varName).toBe("user");
    expect(binding.dotPath).toBe("user.loggedIn");
  });

  test("N15: non-clean if= binding has isConditionalDisplay (regression — fallback path)", () => {
    const inner = makeMarkupNode("button", [eventAttr("onclick", "handle")], []);
    const node = makeMarkupNode("div", [varRefAttr("if", "@visible")], [inner]);
    const registry = new BindingRegistry();
    generateHtml([node], [], false, registry, null);
    const fallback = registry.logicBindings.find(b => b.isConditionalDisplay);
    expect(fallback).toBeDefined();
    expect(fallback.varName).toBe("visible");
    // No mount-toggle binding emitted on the fallback path.
    const mount = registry.logicBindings.find(b => b.isMountToggle);
    expect(mount).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// §3  Client JS controller (N16-N21)
// ---------------------------------------------------------------------------

describe("§3: clean-subtree if= emits mount/unmount controller (N16-N20)", () => {
  test("N16: clean if= emits _scrml_create_scope, _scrml_mount_template, _scrml_unmount_scope", () => {
    const node = makeMarkupNode("div", [varRefAttr("if", "@visible")], [
      { kind: "text", value: "hi", span: span(0) }
    ]);
    const result = compile(node);
    const out = result.outputs.get("/test/app.scrml");
    expect(foldChunkNamespacing(out.clientJs)).toContain("_scrml_create_scope");
    expect(foldChunkNamespacing(out.clientJs)).toContain("_scrml_mount_template");
    expect(foldChunkNamespacing(out.clientJs)).toContain("_scrml_unmount_scope");
  });

  test("N17: clean if= controller wraps in `{` block scope and declares per-marker locals", () => {
    const node = makeMarkupNode("div", [varRefAttr("if", "@visible")], [
      { kind: "text", value: "hi", span: span(0) }
    ]);
    const result = compile(node);
    const out = result.outputs.get("/test/app.scrml");
    expect(foldChunkNamespacing(out.clientJs)).toMatch(/let _scrml_mr_[A-Za-z0-9_]+ = null;/);
    expect(foldChunkNamespacing(out.clientJs)).toMatch(/let _scrml_ms_[A-Za-z0-9_]+ = null;/);
  });

  test("N18: initial mount emitted when condition truthy on first render", () => {
    const node = makeMarkupNode("div", [varRefAttr("if", "@visible")], [
      { kind: "text", value: "hi", span: span(0) }
    ]);
    const result = compile(node);
    const out = result.outputs.get("/test/app.scrml");
    // The initial-mount call appears BEFORE the _scrml_effect reactive registration.
    const idxInit = foldChunkNamespacing(out.clientJs).indexOf("_scrml_if_mount_");
    const idxEffect = foldChunkNamespacing(out.clientJs).indexOf("_scrml_effect(");
    expect(idxInit).toBeGreaterThan(-1);
    expect(idxEffect).toBeGreaterThan(idxInit);
  });

  test("N19: mount-cycle re-evaluates inside _scrml_effect", () => {
    const node = makeMarkupNode("div", [varRefAttr("if", "@visible")], [
      { kind: "text", value: "hi", span: span(0) }
    ]);
    const result = compile(node);
    const out = result.outputs.get("/test/app.scrml");
    // The _scrml_effect block contains both the truthy-mount and falsy-unmount branches.
    expect(foldChunkNamespacing(out.clientJs)).toMatch(/_scrml_effect\(function\(\) \{[\s\S]*?_scrml_if_mount_[\s\S]*?_scrml_if_unmount_/);
  });

  test("N20: unmount path destroys scope and clears refs to null", () => {
    const node = makeMarkupNode("div", [varRefAttr("if", "@visible")], [
      { kind: "text", value: "hi", span: span(0) }
    ]);
    const result = compile(node);
    const out = result.outputs.get("/test/app.scrml");
    // _scrml_unmount_scope is called; both mr/ms refs are reset to null.
    expect(foldChunkNamespacing(out.clientJs)).toContain("_scrml_unmount_scope(_scrml_mr_");
    expect(foldChunkNamespacing(out.clientJs)).toMatch(/_scrml_mr_[A-Za-z0-9_]+ = null;\s*\n\s*_scrml_ms_[A-Za-z0-9_]+ = null;/);
  });

  test("N21: non-clean if= still emits el.style.display (regression — fallback path)", () => {
    const inner = makeMarkupNode("button", [eventAttr("onclick", "handle")], []);
    const node = makeMarkupNode("div", [varRefAttr("if", "@visible")], [inner]);
    const result = compile(node);
    const out = result.outputs.get("/test/app.scrml");
    expect(foldChunkNamespacing(out.clientJs)).toContain("el.style.display");
    // And NOT a mount controller.
    expect(foldChunkNamespacing(out.clientJs)).not.toContain("_scrml_mount_template");
  });
});

// ---------------------------------------------------------------------------
// §4  Round-trip via runCG (N22-N24)
// ---------------------------------------------------------------------------

describe("§4: full pipeline round-trip (N22-N24)", () => {
  test("N22: <div if=@visible>text</div> through full pipeline produces template+marker html", () => {
    const node = makeMarkupNode("div", [varRefAttr("if", "@visible")], [
      { kind: "text", value: "Welcome back!", span: span(0) }
    ]);
    const result = compile(node);
    const out = result.outputs.get("/test/app.scrml");
    expect(out.html).toContain('<template id="');
    expect(out.html).toContain("scrml-if-marker:");
    expect(out.html).toContain("Welcome back!");
    expect(foldChunkNamespacing(out.clientJs)).toContain("_scrml_mount_template");
  });

  test("N23: <MyComp if=@a> uses fallback (component if=)", () => {
    const node = makeMarkupNode("MyComp", [varRefAttr("if", "@a")], []);
    const result = compile(node);
    const out = result.outputs.get("/test/app.scrml");
    expect(out.html).toContain("data-scrml-bind-if=");
    expect(out.html).not.toContain("<template");
  });

  test("N24: if=@user.loggedIn dot-path mount-toggle controller", () => {
    const node = makeMarkupNode("div", [varRefAttr("if", "@user.loggedIn")], [
      { kind: "text", value: "hi", span: span(0) }
    ]);
    const result = compile(node);
    const out = result.outputs.get("/test/app.scrml");
    // Controller condition reads `_scrml_reactive_get("user").loggedIn`.
    expect(foldChunkNamespacing(out.clientJs)).toContain('_scrml_reactive_get("user")');
    expect(foldChunkNamespacing(out.clientJs)).toContain(".loggedIn");
    expect(foldChunkNamespacing(out.clientJs)).toContain("_scrml_mount_template");
  });
});
