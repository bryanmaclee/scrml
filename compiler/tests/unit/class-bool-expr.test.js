/**
 * class:name= boolean expression — Unit Tests
 *
 * Tests for SPEC §5.5.2 widening: class:name= now accepts any boolean expression,
 * not just @variable. Change: b2-class-bool-expr
 *
 * Coverage:
 *   §1  class:active=@isActive — regression: @variable still works (no errors)
 *   §2  class:done=todo.completed — property access (variable-ref, no @, has dot)
 *   §3  class:active=(index == 0) — parenthesized expr with reactive ref
 *   §4  class:selected=(index == selectedIndex) — expr with multiple reactive refs
 *   §5  class:name=isComplete() — function call (call-ref)
 *   §6  class:active=@isActive — reactive subscription wires on change
 *   §7  class:done=todo.completed — subscribes to root reactive key "todo"
 *   §8  class:active=(index == 0) — subscribes to "index" reactive variable
 *   §9  E-ATTR-013 still fires for bare identifier (no @, no dot) — TAB-stage test
 *   §10 No E-ATTR-013 for todo.completed — TAB-stage test
 *   §11 No E-ATTR-013 for @isActive — TAB-stage test
 *   §12 No E-ATTR-013 for (index == 0) — TAB-stage test
 *   §13 HTML output: data-scrml-class-name marker emitted for all forms
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { runCG } from "../../src/code-generator.js";
import { generateHtml } from "../../src/codegen/emit-html.js";
import { emitBindings } from "../../src/codegen/emit-bindings.ts";
import { makeCompileContext } from "../../src/codegen/context.ts";
import { resetVarCounter } from "../../src/codegen/var-counter.ts";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";

// ---------------------------------------------------------------------------
// Helpers — pre-built AST nodes for CG-stage tests (§1-§8, §13)
// ---------------------------------------------------------------------------

function span(start = 0, file = "/test/app.scrml") {
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

function makeRouteMap() {
  return { functions: new Map() };
}

function makeDepGraph() {
  return { nodes: new Map(), edges: [] };
}

function makeProtectAnalysis() {
  return { views: new Map() };
}

/**
 * Build a reactive @variable class: attribute.
 * @param {string} className — the class name after "class:"
 * @param {string} varName — without @, e.g. "isActive"
 */
function reactiveClassAttr(className, varName) {
  return {
    name: `class:${className}`,
    value: { kind: "variable-ref", name: `@${varName}` },
    span: span(0),
  };
}

/**
 * Build a property-access class: attribute (e.g. todo.completed).
 * @param {string} className — the class name after "class:"
 * @param {string} propPath — e.g. "todo.completed"
 */
function propClassAttr(className, propPath) {
  return {
    name: `class:${className}`,
    value: { kind: "variable-ref", name: propPath }, // no @ prefix
    span: span(0),
  };
}

/**
 * Build a parenthesized expression class: attribute.
 * @param {string} className
 * @param {string} rawExpr — the raw expression string, e.g. "(index == 0)"
 * @param {string[]} refs — reactive variable names referenced in the expression
 */
function exprClassAttr(className, rawExpr, refs = []) {
  return {
    name: `class:${className}`,
    value: { kind: "expr", raw: rawExpr, refs },
    span: span(0),
  };
}

/**
 * Build a function call class: attribute.
 * @param {string} className
 * @param {string} fnName — function name without parens
 * @param {string[]} args — argument strings
 */
function callClassAttr(className, fnName, args = []) {
  return {
    name: `class:${className}`,
    value: { kind: "call-ref", name: fnName, args },
    span: span(0),
  };
}

/**
 * Run CG on a single markup node (for client JS wiring tests).
 */
function compile(markupNode) {
  const ast = makeFileAST("/test/app.scrml", [markupNode]);
  return runCG({
    files: [ast],
    routeMap: makeRouteMap(),
    depGraph: makeDepGraph(),
    protectAnalysis: makeProtectAnalysis(),
  });
}

/**
 * Run generateHtml directly for targeted HTML-output tests.
 */
function genHtml(nodes, errors = []) {
  resetVarCounter();
  return generateHtml(nodes, errors, false, null, null);
}

/**
 * Run emitBindings directly for targeted client-JS wiring tests.
 */
function genBindings(markupNode) {
  resetVarCounter();
  const fileAST = makeFileAST("/test/app.scrml", [markupNode]);
  return emitBindings(makeCompileContext({ fileAST })).join("\n");
}

/**
 * Parse scrml source through BS + TAB and return the TAB errors.
 * Used for §9-§12 to test E-ATTR-013 validation at the TAB stage.
 */
function parseErrors(source) {
  const bsOut = splitBlocks("test.scrml", source);
  const tabOut = buildAST(bsOut);
  return tabOut.errors ?? [];
}

beforeEach(() => {
  resetVarCounter();
});

// ---------------------------------------------------------------------------
// §1  class:active=@isActive — regression: @variable still works
// ---------------------------------------------------------------------------

describe("§1: class:active=@isActive — @variable regression", () => {
  test("clientJs contains _scrml_effect for @isActive", () => {
    const node = makeMarkupNode("button", [reactiveClassAttr("active", "isActive")], [], { selfClosing: false });
    const result = compile(node);
    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).toContain('_scrml_effect');
    expect(out.clientJs).toContain('classList.toggle("active"');
  });

  test("clientJs uses _scrml_reactive_get for initial mount check", () => {
    const node = makeMarkupNode("button", [reactiveClassAttr("active", "isActive")], [], { selfClosing: false });
    const result = compile(node);
    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).toContain('_scrml_reactive_get("isActive")');
    expect(out.clientJs).toContain('classList.add("active")');
  });

  test("effect uses classList.toggle with _scrml_reactive_get", () => {
    const node = makeMarkupNode("button", [reactiveClassAttr("active", "isActive")], [], { selfClosing: false });
    const wiring = genBindings(node);
    expect(wiring).toContain('classList.toggle("active", !!_scrml_reactive_get("isActive"))');
  });
});

// ---------------------------------------------------------------------------
// §2  class:done=todo.completed — property access
// ---------------------------------------------------------------------------

describe("§2: class:done=todo.completed — property access", () => {
  test("clientJs uses _scrml_effect for reactive updates", () => {
    const node = makeMarkupNode("li", [propClassAttr("done", "todo.completed")], [], { selfClosing: false });
    const wiring = genBindings(node);
    expect(wiring).toContain('_scrml_effect');
  });

  test("clientJs projects .completed from root", () => {
    const node = makeMarkupNode("li", [propClassAttr("done", "todo.completed")], [], { selfClosing: false });
    const wiring = genBindings(node);
    expect(wiring).toContain('_scrml_reactive_get("todo").completed');
  });

  test("clientJs toggles 'done' class", () => {
    const node = makeMarkupNode("li", [propClassAttr("done", "todo.completed")], [], { selfClosing: false });
    const wiring = genBindings(node);
    expect(wiring).toContain('classList.toggle("done"');
  });

  test("subscription targets root key 'todo', not full path 'todo.completed'", () => {
    const node = makeMarkupNode("li", [propClassAttr("done", "todo.completed")], [], { selfClosing: false });
    const wiring = genBindings(node);
    // Must subscribe to "todo" not "todo.completed"
    expect(wiring).toContain('"todo"');
    expect(wiring).not.toContain('"todo.completed"');
  });
});

// ---------------------------------------------------------------------------
// §3  class:active=(index == 0) — parenthesized expr with reactive ref
// ---------------------------------------------------------------------------

describe("§3: class:active=(index == 0) — parenthesized expression", () => {
  test("clientJs uses _scrml_effect for reactive updates", () => {
    const node = makeMarkupNode("li", [exprClassAttr("active", "(index == 0)", ["index"])], [], { selfClosing: false });
    const wiring = genBindings(node);
    expect(wiring).toContain('_scrml_effect');
  });

  test("clientJs toggles 'active' class", () => {
    const node = makeMarkupNode("li", [exprClassAttr("active", "(index == 0)", ["index"])], [], { selfClosing: false });
    const wiring = genBindings(node);
    expect(wiring).toContain('classList.toggle("active"');
  });

  test("clientJs evaluates the expression at mount time", () => {
    const node = makeMarkupNode("li", [exprClassAttr("active", "(index == 0)", ["index"])], [], { selfClosing: false });
    const wiring = genBindings(node);
    expect(wiring).toContain("(index == 0)");
    expect(wiring).toContain('classList.add("active")');
  });
});

// ---------------------------------------------------------------------------
// §4  class:selected=(index == selectedIndex) — expr with multiple refs
// ---------------------------------------------------------------------------

describe("§4: class:selected=(index == selectedIndex) — multi-ref expression", () => {
  test("clientJs uses single _scrml_effect that auto-tracks both refs", () => {
    const attr = exprClassAttr("selected", "(index == selectedIndex)", ["index", "selectedIndex"]);
    const node = makeMarkupNode("li", [attr], [], { selfClosing: false });
    const wiring = genBindings(node);
    // With _scrml_effect, a single effect auto-tracks both variables
    expect(wiring).toContain('_scrml_effect');
    // Only one effect call needed (not two separate subscribes)
    const effectCount = (wiring.match(/_scrml_effect/g) || []).length;
    expect(effectCount).toBe(1);
  });

  test("subscription re-evaluates entire expression on change", () => {
    const attr = exprClassAttr("selected", "(index == selectedIndex)", ["index", "selectedIndex"]);
    const node = makeMarkupNode("li", [attr], [], { selfClosing: false });
    const wiring = genBindings(node);
    expect(wiring).toContain('classList.toggle("selected"');
  });
});

// ---------------------------------------------------------------------------
// §5  class:name=isComplete() — function call
// ---------------------------------------------------------------------------

describe("§5: class:name=isComplete() — function call", () => {
  test("clientJs emits the function call expression", () => {
    const node = makeMarkupNode("li", [callClassAttr("done", "isComplete", [])], [], { selfClosing: false });
    const wiring = genBindings(node);
    expect(wiring).toContain("isComplete()");
  });

  test("clientJs adds class if function returns truthy at mount", () => {
    const node = makeMarkupNode("li", [callClassAttr("done", "isComplete", [])], [], { selfClosing: false });
    const wiring = genBindings(node);
    expect(wiring).toContain('classList.add("done")');
  });

  test("clientJs emits comment noting no reactive refs when call has no @args", () => {
    const node = makeMarkupNode("li", [callClassAttr("done", "isComplete", [])], [], { selfClosing: false });
    const wiring = genBindings(node);
    expect(wiring).toContain("No reactive refs in call args");
  });
});

// ---------------------------------------------------------------------------
// §6  class:active=@isActive — reactive subscription wires correctly
// ---------------------------------------------------------------------------

describe("§6: reactive effect — @variable effect format", () => {
  test("effect callback uses !!_scrml_reactive_get for boolean coercion", () => {
    const node = makeMarkupNode("div", [reactiveClassAttr("active", "flag")], [], { selfClosing: false });
    const wiring = genBindings(node);
    expect(wiring).toContain('classList.toggle("active", !!_scrml_reactive_get("flag"))');
  });
});

// ---------------------------------------------------------------------------
// §7  class:done=todo.completed — subscribes to root key
// ---------------------------------------------------------------------------

describe("§7: property access — root key subscription", () => {
  test("toggle callback re-projects the path on each update", () => {
    const node = makeMarkupNode("li", [propClassAttr("done", "todo.completed")], [], { selfClosing: false });
    const wiring = genBindings(node);
    expect(wiring).toContain('_scrml_reactive_get("todo").completed');
  });

  test("initial add also uses projected read expression", () => {
    const node = makeMarkupNode("li", [propClassAttr("done", "todo.completed")], [], { selfClosing: false });
    const wiring = genBindings(node);
    expect(wiring).toContain('classList.add("done")');
  });
});

// ---------------------------------------------------------------------------
// §8  class:active=(index == 0) — expression re-evaluated on reactive change
// ---------------------------------------------------------------------------

describe("§8: expression — reactive re-evaluation", () => {
  test("subscription callback toggles class using re-evaluated expression", () => {
    const node = makeMarkupNode("li", [exprClassAttr("first", "(index == 0)", ["index"])], [], { selfClosing: false });
    const wiring = genBindings(node);
    expect(wiring).toContain('_scrml_effect');
    expect(wiring).toContain('classList.toggle("first"');
    // The toggle callback should re-evaluate the expression, not use a cached value
    expect(wiring).toContain("(index == 0)");
  });
});

// ---------------------------------------------------------------------------
// §9  E-ATTR-013 still fires for bare identifier (no @, no dot) — TAB stage
// ---------------------------------------------------------------------------

describe("§9: E-ATTR-013 — bare identifier still rejected at TAB stage", () => {
  test("class:active=bareIdent fires E-ATTR-013", () => {
    const errors = parseErrors(`<program>\n<button class:active=bareIdent>Toggle</>\n</>`);
    const err013 = errors.find(e => e.code === "E-ATTR-013");
    expect(err013).toBeDefined();
  });

  test("E-ATTR-013 message mentions the bare identifier and suggests @prefix", () => {
    const errors = parseErrors(`<program>\n<button class:active=bareIdent>Toggle</>\n</>`);
    const err013 = errors.find(e => e.code === "E-ATTR-013");
    expect(err013?.message ?? "").toContain("bareIdent");
    expect(err013?.message ?? "").toContain("@bareIdent");
  });
});

// ---------------------------------------------------------------------------
// §10 No E-ATTR-013 for todo.completed (property access) — TAB stage
// ---------------------------------------------------------------------------

describe("§10: No E-ATTR-013 for property access form — TAB stage", () => {
  test("class:done=todo.completed does not produce E-ATTR-013", () => {
    const errors = parseErrors(`<program>\n<li class:done=todo.completed>item/\n</>`);
    const err013 = errors.find(e => e.code === "E-ATTR-013");
    expect(err013).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// §11 No E-ATTR-013 for @isActive — TAB stage
// ---------------------------------------------------------------------------

describe("§11: No E-ATTR-013 for @reactive variable — TAB stage", () => {
  test("class:active=@isActive does not produce E-ATTR-013", () => {
    const errors = parseErrors(`<program>\n@isActive = false\n<button class:active=@isActive>Toggle</>\n</>`);
    const err013 = errors.find(e => e.code === "E-ATTR-013");
    expect(err013).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// §12 No E-ATTR-013 for (index == 0) — TAB stage
// ---------------------------------------------------------------------------

describe("§12: No E-ATTR-013 for parenthesized expression — TAB stage", () => {
  test("class:active=(index == 0) does not produce E-ATTR-013", () => {
    const errors = parseErrors(`<program>\n<li class:active=(index == 0)>item/\n</>`);
    const err013 = errors.find(e => e.code === "E-ATTR-013");
    expect(err013).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// §13 HTML output: data-scrml-class-* marker emitted for all forms
// ---------------------------------------------------------------------------

describe("§13: HTML output — data-scrml-class-* marker emitted for all forms", () => {
  test("@variable form emits data-scrml-class-active marker", () => {
    const node = makeMarkupNode("button", [reactiveClassAttr("active", "isActive")], [], { selfClosing: false });
    const html = genHtml([node]);
    expect(html).toContain("data-scrml-class-active");
  });

  test("property access form emits data-scrml-class-done marker", () => {
    const node = makeMarkupNode("li", [propClassAttr("done", "todo.completed")], [], { selfClosing: false });
    const html = genHtml([node]);
    expect(html).toContain("data-scrml-class-done");
  });

  test("expr form emits data-scrml-class-active marker", () => {
    const node = makeMarkupNode("li", [exprClassAttr("active", "(index == 0)", ["index"])], [], { selfClosing: false });
    const html = genHtml([node]);
    expect(html).toContain("data-scrml-class-active");
  });

  test("call-ref form emits data-scrml-class-done marker", () => {
    const node = makeMarkupNode("li", [callClassAttr("done", "isComplete", [])], [], { selfClosing: false });
    const html = genHtml([node]);
    expect(html).toContain("data-scrml-class-done");
  });
});

// ---------------------------------------------------------------------------
// §R13-4: class:name=(@expr > val) — parenthesized expression with '>' (R13 #4)
// ---------------------------------------------------------------------------

describe("class:name with parenthesized '>' expression (R13 #4)", () => {
  test("class:active=(@count > 0) parses as expr attr", () => {
    const { splitBlocks } = require("../../src/block-splitter.js");
    const { buildAST } = require("../../src/ast-builder.js");
    const src = '<program><div class:active=(@count > 0)/></program>';
    const r = buildAST(splitBlocks('t.scrml', src));
    const div = r.ast.nodes[0]?.children?.[0];
    const attr = div?.attrs?.find(a => a.name === "class:active");
    expect(attr).toBeDefined();
    expect(attr.value.kind).toBe("expr");
    expect(attr.value.raw).toContain("@count > 0");
  });

  test("if=(@a > @b) parses as expr attr", () => {
    const { splitBlocks } = require("../../src/block-splitter.js");
    const { buildAST } = require("../../src/ast-builder.js");
    const src = '<program><div if=(@a > @b)>content</></program>';
    const r = buildAST(splitBlocks('t.scrml', src));
    const div = r.ast.nodes[0]?.children?.[0];
    const attr = div?.attrs?.find(a => a.name === "if");
    expect(attr).toBeDefined();
    expect(attr.value.kind).toBe("expr");
  });

  test("nested parens with '>' parse correctly", () => {
    const { splitBlocks } = require("../../src/block-splitter.js");
    const { buildAST } = require("../../src/ast-builder.js");
    const src = '<program><div class:visible=((@a > 0) && (@b > 0))/></program>';
    const r = buildAST(splitBlocks('t.scrml', src));
    const div = r.ast.nodes[0]?.children?.[0];
    const attr = div?.attrs?.find(a => a.name === "class:visible");
    expect(attr).toBeDefined();
    expect(attr.value.kind).toBe("expr");
    expect(attr.value.raw).toContain("@a > 0");
    expect(attr.value.raw).toContain("@b > 0");
  });
});

// ---------------------------------------------------------------------------
// fix-class-negation: class:name=!@var negated reactive variable (E-ATTR-013 fix)
// ---------------------------------------------------------------------------
// Tests that negated boolean expressions compile without E-ATTR-013 false positive.
// Before this fix: the tokenizer only handled `!@var` for `if=` attributes.
// After this fix: `!@var`, `!!@var`, `!obj.prop`, etc. work for any attribute.

describe("class:name=!@var — negated reactive variable (fix-class-negation)", () => {
  test("class:hidden=!@isVisible — no E-ATTR-013 error", () => {
    const { splitBlocks } = require("../../src/block-splitter.js");
    const { buildAST } = require("../../src/ast-builder.js");
    const src = '<program><div class:hidden=!@isVisible/></program>';
    const r = buildAST(splitBlocks('t.scrml', src));
    const errors = r.errors.filter(e => e.code === "E-ATTR-013");
    expect(errors).toHaveLength(0);
  });

  test("class:hidden=!@isVisible — attr value is expr kind", () => {
    const { splitBlocks } = require("../../src/block-splitter.js");
    const { buildAST } = require("../../src/ast-builder.js");
    const src = '<program><div class:hidden=!@isVisible/></program>';
    const r = buildAST(splitBlocks('t.scrml', src));
    const div = r.ast.nodes[0]?.children?.[0];
    const attr = div?.attrs?.find(a => a.name === "class:hidden");
    expect(attr).toBeDefined();
    expect(attr.value.kind).toBe("expr");
    expect(attr.value.raw).toBe("!@isVisible");
  });

  test("class:invalid=!@isValid — no E-ATTR-013 error", () => {
    const { splitBlocks } = require("../../src/block-splitter.js");
    const { buildAST } = require("../../src/ast-builder.js");
    const src = '<program><input class:invalid=!@isValid/></program>';
    const r = buildAST(splitBlocks('t.scrml', src));
    const errors = r.errors.filter(e => e.code === "E-ATTR-013");
    expect(errors).toHaveLength(0);
  });

  test("class:done=!todo.completed — negated dot path, no error", () => {
    const { splitBlocks } = require("../../src/block-splitter.js");
    const { buildAST } = require("../../src/ast-builder.js");
    const src = '<program><li class:done=!todo.completed/></program>';
    const r = buildAST(splitBlocks('t.scrml', src));
    const errors = r.errors.filter(e => e.code === "E-ATTR-013");
    expect(errors).toHaveLength(0);
    const li = r.ast.nodes[0]?.children?.[0];
    const attr = li?.attrs?.find(a => a.name === "class:done");
    expect(attr).toBeDefined();
    expect(attr.value.kind).toBe("expr");
    expect(attr.value.raw).toBe("!todo.completed");
  });

  test("class:visible=!!@isHidden — double negation, no error", () => {
    const { splitBlocks } = require("../../src/block-splitter.js");
    const { buildAST } = require("../../src/ast-builder.js");
    const src = '<program><div class:visible=!!@isHidden/></program>';
    const r = buildAST(splitBlocks('t.scrml', src));
    const errors = r.errors.filter(e => e.code === "E-ATTR-013");
    expect(errors).toHaveLength(0);
    const div = r.ast.nodes[0]?.children?.[0];
    const attr = div?.attrs?.find(a => a.name === "class:visible");
    expect(attr).toBeDefined();
    expect(attr.value.kind).toBe("expr");
    expect(attr.value.raw).toBe("!!@isHidden");
  });

  test("if=!@isLoading — regression: if= negation still works", () => {
    const { splitBlocks } = require("../../src/block-splitter.js");
    const { buildAST } = require("../../src/ast-builder.js");
    const src = '<program><div if=!@isLoading>content</div></program>';
    const r = buildAST(splitBlocks('t.scrml', src));
    const errors = r.errors.filter(e => e.code === "E-ATTR-013");
    expect(errors).toHaveLength(0);
    const div = r.ast.nodes[0]?.children?.[0];
    const attr = div?.attrs?.find(a => a.name === "if");
    expect(attr).toBeDefined();
    expect(attr.value.kind).toBe("expr");
    expect(attr.value.raw).toBe("!@isLoading");
  });
});

// ---------------------------------------------------------------------------
// gate-found-invalid-js-fix-wave (S141 follow-on): class:name= and else-if=
// expressions that COMPARE against a VARIANT LITERAL must lower the variant
// (.Variant / Type::Variant) + the ==/!= operator through the variant-aware
// ExprNode emitter, NOT leave them RAW. Before the fix, the class: form-3
// path + the else-if chain cascade used the raw-string rewriteReactiveRefs
// shortcut, which left `.Home` / `Step::Info` and `==`/`!=` verbatim in the
// emitted JS -> E-CODEGEN-INVALID-JS. Examples 05-multi-step-form (Step::Info)
// and 21-navigation (.Home) shipped invalid .client.js as a result.
// ---------------------------------------------------------------------------

describe("variant-literal class: directive lowers to valid JS (gate fix-wave)", () => {
  const acorn = require("acorn");
  const assertValidJs = (src) => {
    // Wrap fragments that are statements/comments into a parseable module.
    expect(() => acorn.parse(src, { ecmaVersion: 2022, sourceType: "module" })).not.toThrow();
  };

  test("class:active=(@view == .Home) — leading-dot variant lowers to structural_eq + string tag (no raw `.Home`)", () => {
    const node = makeMarkupNode(
      "button",
      [exprClassAttr("active", "(@view == .Home)", ["view"])],
      [],
      { selfClosing: false },
    );
    const wiring = genBindings(node);
    // The EMITTED expression (not the leading `// class:...=...` comment line)
    // must be valid JS — no bare `== .Home`.
    expect(wiring).toContain("_scrml_structural_eq");
    expect(wiring).toContain('"Home"');
    // The classList.add/toggle lines (everything after the comment) must parse.
    const codeLines = wiring.split("\n").filter((l) => !l.trim().startsWith("//"));
    assertValidJs(codeLines.join("\n"));
    // No dangling raw variant-literal comparison survived into code.
    expect(codeLines.join("\n")).not.toContain("== .Home");
  });

  test("class:active=(@step == Step::Info) — qualified variant lowers to structural_eq + Step.Info (no raw `Step::Info`)", () => {
    const node = makeMarkupNode(
      "span",
      [exprClassAttr("active", "(@step == Step::Info)", ["step"])],
      [],
      { selfClosing: false },
    );
    const wiring = genBindings(node);
    expect(wiring).toContain("_scrml_structural_eq");
    const codeLines = wiring.split("\n").filter((l) => !l.trim().startsWith("//"));
    assertValidJs(codeLines.join("\n"));
    expect(codeLines.join("\n")).not.toContain("Step::Info");
  });

  test("end-to-end: class:active=(@view == .Home) emits valid client.js via runCG", () => {
    resetVarCounter();
    const node = makeMarkupNode(
      "button",
      [exprClassAttr("active", "(@view == .Home)", ["view"])],
      [],
      { selfClosing: false },
    );
    const result = compile(node);
    const out = result.outputs.get("/test/app.scrml");
    expect(() => acorn.parse(out.clientJs, { ecmaVersion: 2022, sourceType: "module" })).not.toThrow();
  });
});
