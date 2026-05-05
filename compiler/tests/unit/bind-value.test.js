/**
 * bind:value (and related bind: directives) — Unit Tests
 *
 * Tests for SPEC §5.4 two-way binding compilation.
 *
 * Coverage:
 *   §1  bind:value on <input> — uses "input" event
 *   §2  bind:value on <textarea> — uses "input" event
 *   §3  bind:value on <select> — uses "change" event (not "input")
 *   §4  bind:checked on <input> — uses "change" event
 *   §5  bind:selected on <select> — uses "change" event
 *   §6  bind:group on <input type="radio"> — uses "change" event
 *   §7  HTML output — data-scrml-bind-* placeholder emitted
 *   §8  E-ATTR-010 — bind: target is a plain (non-reactive) variable
 *   §9  E-ATTR-011 — unsupported bind: attribute name
 *   §10 E-ATTR-011 — bind:value on invalid element (e.g. <div>)
 *   §11 E-ATTR-011 — bind:checked on <select> (wrong element)
 *   §12 bind:value + oninput= coexistence — both wired, no E-ATTR-012
 *   §13 bind:checked + onchange= coexistence — both wired, no E-ATTR-012
 *   §14 Valid bind:value — no errors produced
 *   §15 Valid bind:checked — no errors produced
 *   §16 bind:value on <input> + bind:checked on separate <input> — no cross-contamination
 *   §17 bind:value=@obj.field — one-level path binding on <input>
 *   §18 bind:value=@obj.field — one-level path binding on <select>
 *   §19 bind:value=@a.b.c — nested (multi-level) path binding
 *   §20 Path binding produces no errors
 *   §21 Path binding: read uses _scrml_deep_set on write
 *   §22 Path binding: subscription subscribes to root key, projects field
 *   §23 bind:valueAsNumber — Number() coercion on write-back
 *   §24 bind:value + oninput= coexistence — both bind wiring and handler emitted
 */

import { describe, test, expect } from "bun:test";
import { runCG, CGError } from "../../src/code-generator.js";
import { generateHtml } from "../../src/codegen/emit-html.js";
import { resetVarCounter } from "../../src/codegen/var-counter.ts";

// ---------------------------------------------------------------------------
// Helpers
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

function makeTextNode(text) {
  return { kind: "text", value: text, span: span(0) };
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
 * Build a reactive variable-ref attribute value.
 * @param {string} varName — without @, e.g. "name" or "form.email"
 */
function reactiveAttr(bindName, varName) {
  return {
    name: bindName,
    value: { kind: "variable-ref", name: `@${varName}` },
    span: span(0),
  };
}

/**
 * Build a plain (non-reactive) variable-ref attribute value.
 */
function plainAttr(bindName, varName) {
  return {
    name: bindName,
    value: { kind: "variable-ref", name: varName }, // no @ prefix
    span: span(0),
  };
}

/**
 * Build a string-literal attribute (e.g. oninput="handler()").
 */
function strAttr(attrName, value) {
  return {
    name: attrName,
    value: { kind: "string-literal", value },
    span: span(0),
  };
}

/**
 * Build a call-ref attribute (e.g. oninput=handler()).
 */
function callAttr(attrName, handlerName) {
  return {
    name: attrName,
    value: { kind: "call-ref", name: handlerName, args: [] },
    span: span(0),
  };
}

/**
 * Run CG on a single file with one top-level markup node.
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

// ---------------------------------------------------------------------------
// §1  bind:value on <input> — uses "input" event
// ---------------------------------------------------------------------------

describe("§1: bind:value on <input> uses 'input' event", () => {
  test("clientJs contains addEventListener(\"input\", ...) for <input bind:value=@name>", () => {
    const node = makeMarkupNode("input", [reactiveAttr("bind:value", "name")], [], { selfClosing: true });
    const result = compile(node);

    expect(result.errors.filter(e => e.code === "E-ATTR-010" || e.code === "E-ATTR-011" || e.code === "E-ATTR-012")).toHaveLength(0);
    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).toContain('addEventListener("input"');
  });

  test("clientJs subscribes reactively for <input bind:value=@name>", () => {
    const node = makeMarkupNode("input", [reactiveAttr("bind:value", "name")], [], { selfClosing: true });
    const result = compile(node);

    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).toContain("_scrml_effect");
    expect(out.clientJs).toContain('"name"');
  });
});

// ---------------------------------------------------------------------------
// §2  bind:value on <textarea> — uses "input" event
// ---------------------------------------------------------------------------

describe("§2: bind:value on <textarea> uses 'input' event", () => {
  test("clientJs contains addEventListener(\"input\", ...) for <textarea bind:value=@body>", () => {
    const node = makeMarkupNode("textarea", [reactiveAttr("bind:value", "body")]);
    const result = compile(node);

    expect(result.errors.filter(e => e.code === "E-ATTR-010" || e.code === "E-ATTR-011" || e.code === "E-ATTR-012")).toHaveLength(0);
    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).toContain('addEventListener("input"');
  });
});

// ---------------------------------------------------------------------------
// §3  bind:value on <select> — uses "change" event (not "input")
// ---------------------------------------------------------------------------

describe("§3: bind:value on <select> uses 'change' event", () => {
  test("clientJs contains addEventListener(\"change\", ...) for <select bind:value=@choice>", () => {
    const node = makeMarkupNode("select", [reactiveAttr("bind:value", "choice")]);
    const result = compile(node);

    expect(result.errors.filter(e => e.code === "E-ATTR-010" || e.code === "E-ATTR-011" || e.code === "E-ATTR-012")).toHaveLength(0);
    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).toContain('addEventListener("change"');
    expect(out.clientJs).not.toContain('addEventListener("input"');
  });

  test("select bind:value comment says bind:value=@choice", () => {
    const node = makeMarkupNode("select", [reactiveAttr("bind:value", "choice")]);
    const result = compile(node);

    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).toContain("// bind:value=@choice");
  });
});

// ---------------------------------------------------------------------------
// §4  bind:checked on <input> — uses "change" event
// ---------------------------------------------------------------------------

describe("§4: bind:checked on <input> uses 'change' event", () => {
  test("clientJs contains addEventListener(\"change\", ...) for <input bind:checked=@agreed>", () => {
    const node = makeMarkupNode("input", [
      strAttr("type", "checkbox"),
      reactiveAttr("bind:checked", "agreed"),
    ], [], { selfClosing: true });
    const result = compile(node);

    expect(result.errors.filter(e => e.code === "E-ATTR-010" || e.code === "E-ATTR-011" || e.code === "E-ATTR-012")).toHaveLength(0);
    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).toContain('addEventListener("change"');
    expect(out.clientJs).toContain("event.target.checked");
  });
});

// ---------------------------------------------------------------------------
// §5  bind:selected on <select> — uses "change" event
// ---------------------------------------------------------------------------

describe("§5: bind:selected on <select> uses 'change' event", () => {
  test("clientJs contains addEventListener(\"change\", ...) for <select bind:selected=@opt>", () => {
    const node = makeMarkupNode("select", [reactiveAttr("bind:selected", "opt")]);
    const result = compile(node);

    expect(result.errors.filter(e => e.code === "E-ATTR-010" || e.code === "E-ATTR-011" || e.code === "E-ATTR-012")).toHaveLength(0);
    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).toContain('addEventListener("change"');
  });
});

// ---------------------------------------------------------------------------
// §6  bind:group on <input type="radio"> — uses "change" event
// ---------------------------------------------------------------------------

describe("§6: bind:group on <input type=radio> uses 'change' event", () => {
  test("clientJs contains addEventListener(\"change\", ...) for <input bind:group=@color>", () => {
    const node = makeMarkupNode("input", [
      strAttr("type", "radio"),
      strAttr("value", "red"),
      reactiveAttr("bind:group", "color"),
    ], [], { selfClosing: true });
    const result = compile(node);

    expect(result.errors.filter(e => e.code === "E-ATTR-010" || e.code === "E-ATTR-011" || e.code === "E-ATTR-012")).toHaveLength(0);
    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).toContain('addEventListener("change"');
    expect(out.clientJs).toContain(".checked");
  });
});

// ---------------------------------------------------------------------------
// §7  HTML output — data-scrml-bind-* placeholder emitted
// ---------------------------------------------------------------------------

describe("§7: HTML output emits data-scrml-bind-* placeholder", () => {
  test("<input bind:value=@name> emits data-scrml-bind-value attribute in HTML", () => {
    const node = makeMarkupNode("input", [reactiveAttr("bind:value", "name")], [], { selfClosing: true });
    const result = compile(node);

    const out = result.outputs.get("/test/app.scrml");
    expect(out.html).toContain("data-scrml-bind-value=");
  });

  test("<input bind:value=@name> does NOT emit bind:value= literally in HTML", () => {
    const node = makeMarkupNode("input", [reactiveAttr("bind:value", "name")], [], { selfClosing: true });
    const result = compile(node);

    const out = result.outputs.get("/test/app.scrml");
    expect(out.html).not.toContain("bind:value=");
  });

  test("<input bind:checked=@agreed> emits data-scrml-bind-checked attribute in HTML", () => {
    const node = makeMarkupNode("input", [reactiveAttr("bind:checked", "agreed")], [], { selfClosing: true });
    const result = compile(node);

    const out = result.outputs.get("/test/app.scrml");
    expect(out.html).toContain("data-scrml-bind-checked=");
  });
});

// ---------------------------------------------------------------------------
// §8  E-ATTR-010 — bind: target is a plain (non-reactive) variable
// ---------------------------------------------------------------------------

describe("§8: E-ATTR-010 — bind: target must be reactive @variable", () => {
  test("bind:value=name (no @) produces E-ATTR-010 error", () => {
    const node = makeMarkupNode("input", [plainAttr("bind:value", "name")], [], { selfClosing: true });
    const result = compile(node);

    const e010 = result.errors.filter(e => e.code === "E-ATTR-010");
    expect(e010).toHaveLength(1);
    expect(e010[0].message).toContain("E-ATTR-010");
    expect(e010[0].message).toContain("reactive");
  });

  test("E-ATTR-010 message includes the variable name", () => {
    const node = makeMarkupNode("input", [plainAttr("bind:value", "username")], [], { selfClosing: true });
    const result = compile(node);

    const e010 = result.errors.filter(e => e.code === "E-ATTR-010");
    expect(e010[0].message).toContain("username");
  });

  test("bind:checked=agreed (no @) produces E-ATTR-010 error", () => {
    const node = makeMarkupNode("input", [plainAttr("bind:checked", "agreed")], [], { selfClosing: true });
    const result = compile(node);

    const e010 = result.errors.filter(e => e.code === "E-ATTR-010");
    expect(e010).toHaveLength(1);
  });

  test("bind:value=@name (with @) does not produce E-ATTR-010", () => {
    const node = makeMarkupNode("input", [reactiveAttr("bind:value", "name")], [], { selfClosing: true });
    const result = compile(node);

    const e010 = result.errors.filter(e => e.code === "E-ATTR-010");
    expect(e010).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §9  E-ATTR-011 — unsupported bind: attribute name
// ---------------------------------------------------------------------------

describe("§9: E-ATTR-011 — unsupported bind: attribute name", () => {
  test("bind:href=@url produces E-ATTR-011", () => {
    const node = makeMarkupNode("a", [reactiveAttr("bind:href", "url")]);
    const result = compile(node);

    const e011 = result.errors.filter(e => e.code === "E-ATTR-011");
    expect(e011).toHaveLength(1);
    expect(e011[0].message).toContain("E-ATTR-011");
    expect(e011[0].message).toContain("bind:href");
  });

  test("bind:class=@active produces E-ATTR-011", () => {
    const node = makeMarkupNode("div", [reactiveAttr("bind:class", "active")]);
    const result = compile(node);

    const e011 = result.errors.filter(e => e.code === "E-ATTR-011");
    expect(e011.length).toBeGreaterThanOrEqual(1);
    expect(e011.some(e => e.message.includes("bind:class"))).toBe(true);
  });

  test("E-ATTR-011 message lists supported bind: names", () => {
    const node = makeMarkupNode("input", [reactiveAttr("bind:data", "x")], [], { selfClosing: true });
    const result = compile(node);

    const e011 = result.errors.filter(e => e.code === "E-ATTR-011");
    expect(e011).toHaveLength(1);
    expect(e011[0].message).toContain("value");
    expect(e011[0].message).toContain("checked");
  });

  test("bind:value (supported) does NOT produce E-ATTR-011", () => {
    const node = makeMarkupNode("input", [reactiveAttr("bind:value", "name")], [], { selfClosing: true });
    const result = compile(node);

    const e011 = result.errors.filter(e => e.code === "E-ATTR-011");
    expect(e011).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §10 E-ATTR-011 — bind:value on invalid element (e.g. <div>)
// ---------------------------------------------------------------------------

describe("§10: E-ATTR-011 — bind:value only valid on input/textarea/select", () => {
  test("bind:value on <div> produces E-ATTR-011", () => {
    const node = makeMarkupNode("div", [reactiveAttr("bind:value", "x")]);
    const result = compile(node);

    const e011 = result.errors.filter(e => e.code === "E-ATTR-011");
    expect(e011).toHaveLength(1);
    expect(e011[0].message).toContain("<div>");
  });

  test("bind:value on <button> produces E-ATTR-011", () => {
    const node = makeMarkupNode("button", [reactiveAttr("bind:value", "x")]);
    const result = compile(node);

    const e011 = result.errors.filter(e => e.code === "E-ATTR-011");
    expect(e011).toHaveLength(1);
  });

  test("bind:value on <input> does NOT produce E-ATTR-011", () => {
    const node = makeMarkupNode("input", [reactiveAttr("bind:value", "x")], [], { selfClosing: true });
    const result = compile(node);

    const e011 = result.errors.filter(e => e.code === "E-ATTR-011");
    expect(e011).toHaveLength(0);
  });

  test("bind:value on <textarea> does NOT produce E-ATTR-011", () => {
    const node = makeMarkupNode("textarea", [reactiveAttr("bind:value", "x")]);
    const result = compile(node);

    const e011 = result.errors.filter(e => e.code === "E-ATTR-011");
    expect(e011).toHaveLength(0);
  });

  test("bind:value on <select> does NOT produce E-ATTR-011", () => {
    const node = makeMarkupNode("select", [reactiveAttr("bind:value", "x")]);
    const result = compile(node);

    const e011 = result.errors.filter(e => e.code === "E-ATTR-011");
    expect(e011).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §11 E-ATTR-011 — bind:checked on wrong element type
// ---------------------------------------------------------------------------

describe("§11: E-ATTR-011 — bind:checked only valid on <input>", () => {
  test("bind:checked on <select> produces E-ATTR-011", () => {
    const node = makeMarkupNode("select", [reactiveAttr("bind:checked", "flag")]);
    const result = compile(node);

    const e011 = result.errors.filter(e => e.code === "E-ATTR-011");
    expect(e011).toHaveLength(1);
    expect(e011[0].message).toContain("<select>");
  });

  test("bind:checked on <textarea> produces E-ATTR-011", () => {
    const node = makeMarkupNode("textarea", [reactiveAttr("bind:checked", "flag")]);
    const result = compile(node);

    const e011 = result.errors.filter(e => e.code === "E-ATTR-011");
    expect(e011).toHaveLength(1);
  });

  test("bind:checked on <input> does NOT produce E-ATTR-011", () => {
    const node = makeMarkupNode("input", [reactiveAttr("bind:checked", "flag")], [], { selfClosing: true });
    const result = compile(node);

    const e011 = result.errors.filter(e => e.code === "E-ATTR-011");
    expect(e011).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §12 bind:value + oninput= coexistence (E-ATTR-012 removed — composable by design)
// ---------------------------------------------------------------------------

describe("§12: bind:value + explicit oninput= coexistence — no E-ATTR-012", () => {
  test("bind:value + oninput= on same <input> compiles without error", () => {
    const node = makeMarkupNode("input", [
      reactiveAttr("bind:value", "name"),
      callAttr("oninput", "handleInput"),
    ], [], { selfClosing: true });
    const result = compile(node);

    const e012 = result.errors.filter(e => e.code === "E-ATTR-012");
    expect(e012).toHaveLength(0);
  });

  test("bind:value + oninput= produces no bind: errors at all", () => {
    const node = makeMarkupNode("input", [
      reactiveAttr("bind:value", "name"),
      callAttr("oninput", "handleInput"),
    ], [], { selfClosing: true });
    const result = compile(node);

    const bindErrors = result.errors.filter(e =>
      e.code === "E-ATTR-010" || e.code === "E-ATTR-011" || e.code === "E-ATTR-012"
    );
    expect(bindErrors).toHaveLength(0);
  });

  test("bind:value + onchange= (different event) also produces no E-ATTR-012", () => {
    const node = makeMarkupNode("input", [
      reactiveAttr("bind:value", "name"),
      callAttr("onchange", "handleChange"),
    ], [], { selfClosing: true });
    const result = compile(node);

    const e012 = result.errors.filter(e => e.code === "E-ATTR-012");
    expect(e012).toHaveLength(0);
  });

  test("bind:value alone does NOT produce E-ATTR-012", () => {
    const node = makeMarkupNode("input", [reactiveAttr("bind:value", "name")], [], { selfClosing: true });
    const result = compile(node);

    const e012 = result.errors.filter(e => e.code === "E-ATTR-012");
    expect(e012).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §13 bind:checked + onchange= coexistence (E-ATTR-012 removed — composable by design)
// ---------------------------------------------------------------------------

describe("§13: bind:checked + explicit onchange= coexistence — no E-ATTR-012", () => {
  test("bind:checked + onchange= on same <input> compiles without error", () => {
    const node = makeMarkupNode("input", [
      strAttr("type", "checkbox"),
      reactiveAttr("bind:checked", "agreed"),
      callAttr("onchange", "handleChange"),
    ], [], { selfClosing: true });
    const result = compile(node);

    const e012 = result.errors.filter(e => e.code === "E-ATTR-012");
    expect(e012).toHaveLength(0);
  });

  test("bind:checked + onchange= produces no bind: errors", () => {
    const node = makeMarkupNode("input", [
      strAttr("type", "checkbox"),
      reactiveAttr("bind:checked", "agreed"),
      callAttr("onchange", "handleChange"),
    ], [], { selfClosing: true });
    const result = compile(node);

    const bindErrors = result.errors.filter(e =>
      e.code === "E-ATTR-010" || e.code === "E-ATTR-011" || e.code === "E-ATTR-012"
    );
    expect(bindErrors).toHaveLength(0);
  });

  test("bind:checked + oninput= (different event) also produces no E-ATTR-012", () => {
    const node = makeMarkupNode("input", [
      reactiveAttr("bind:checked", "agreed"),
      callAttr("oninput", "handleInput"),
    ], [], { selfClosing: true });
    const result = compile(node);

    const e012 = result.errors.filter(e => e.code === "E-ATTR-012");
    expect(e012).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §14 Valid bind:value — no errors produced
// ---------------------------------------------------------------------------

describe("§14: Valid bind:value usage — no errors", () => {
  test("<input bind:value=@name> produces no bind errors", () => {
    const node = makeMarkupNode("input", [reactiveAttr("bind:value", "name")], [], { selfClosing: true });
    const result = compile(node);

    const bindErrors = result.errors.filter(e =>
      e.code === "E-ATTR-010" || e.code === "E-ATTR-011" || e.code === "E-ATTR-012"
    );
    expect(bindErrors).toHaveLength(0);
  });

  test("<textarea bind:value=@content> produces no bind errors", () => {
    const node = makeMarkupNode("textarea", [reactiveAttr("bind:value", "content")]);
    const result = compile(node);

    const bindErrors = result.errors.filter(e =>
      e.code === "E-ATTR-010" || e.code === "E-ATTR-011" || e.code === "E-ATTR-012"
    );
    expect(bindErrors).toHaveLength(0);
  });

  test("<select bind:value=@choice> produces no bind errors", () => {
    const node = makeMarkupNode("select", [reactiveAttr("bind:value", "choice")]);
    const result = compile(node);

    const bindErrors = result.errors.filter(e =>
      e.code === "E-ATTR-010" || e.code === "E-ATTR-011" || e.code === "E-ATTR-012"
    );
    expect(bindErrors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §15 Valid bind:checked — no errors produced
// ---------------------------------------------------------------------------

describe("§15: Valid bind:checked usage — no errors", () => {
  test("<input type=checkbox bind:checked=@agreed> produces no bind errors", () => {
    const node = makeMarkupNode("input", [
      strAttr("type", "checkbox"),
      reactiveAttr("bind:checked", "agreed"),
    ], [], { selfClosing: true });
    const result = compile(node);

    const bindErrors = result.errors.filter(e =>
      e.code === "E-ATTR-010" || e.code === "E-ATTR-011" || e.code === "E-ATTR-012"
    );
    expect(bindErrors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §16 No cross-contamination between two separate bind: elements
// ---------------------------------------------------------------------------

describe("§16: Multiple bind: elements — no cross-contamination", () => {
  test("bind:value on <input> and bind:checked on <input> both compile cleanly", () => {
    const ast = makeFileAST("/test/app.scrml", [
      makeMarkupNode("input", [reactiveAttr("bind:value", "name")], [], { selfClosing: true }),
      makeMarkupNode("input", [
        strAttr("type", "checkbox"),
        reactiveAttr("bind:checked", "agreed"),
      ], [], { selfClosing: true }),
    ]);

    const result = runCG({
      files: [ast],
      routeMap: makeRouteMap(),
      depGraph: makeDepGraph(),
      protectAnalysis: makeProtectAnalysis(),
    });

    const bindErrors = result.errors.filter(e =>
      e.code === "E-ATTR-010" || e.code === "E-ATTR-011" || e.code === "E-ATTR-012"
    );
    expect(bindErrors).toHaveLength(0);

    const out = result.outputs.get("/test/app.scrml");
    // Both HTML placeholders present
    expect(out.html).toContain("data-scrml-bind-value=");
    expect(out.html).toContain("data-scrml-bind-checked=");
    // input event for bind:value, change event for bind:checked
    expect(out.clientJs).toContain('addEventListener("input"');
    expect(out.clientJs).toContain('addEventListener("change"');
  });
});

// ---------------------------------------------------------------------------
// §17 bind:value=@obj.field — one-level path binding on <input>
// ---------------------------------------------------------------------------

describe("§17: bind:value=@obj.field — one-level path binding on <input>", () => {
  test("produces no bind errors for <input bind:value=@form.email>", () => {
    const node = makeMarkupNode("input", [reactiveAttr("bind:value", "form.email")], [], { selfClosing: true });
    const result = compile(node);

    const bindErrors = result.errors.filter(e =>
      e.code === "E-ATTR-010" || e.code === "E-ATTR-011" || e.code === "E-ATTR-012"
    );
    expect(bindErrors).toHaveLength(0);
  });

  test("read uses _scrml_reactive_get(\"form\").email, not _scrml_reactive_get(\"form.email\")", () => {
    const node = makeMarkupNode("input", [reactiveAttr("bind:value", "form.email")], [], { selfClosing: true });
    const result = compile(node);

    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).toContain('_scrml_reactive_get("form").email');
    expect(out.clientJs).not.toContain('_scrml_reactive_get("form.email")');
  });

  test("write uses _scrml_deep_set on event", () => {
    const node = makeMarkupNode("input", [reactiveAttr("bind:value", "form.email")], [], { selfClosing: true });
    const result = compile(node);

    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).toContain('_scrml_deep_set');
    expect(out.clientJs).toContain('"form"');
    expect(out.clientJs).toContain('["email"]');
    expect(out.clientJs).toContain('event.target.value');
  });

  test("subscription subscribes to root key 'form', not 'form.email'", () => {
    const node = makeMarkupNode("input", [reactiveAttr("bind:value", "form.email")], [], { selfClosing: true });
    const result = compile(node);

    const out = result.outputs.get("/test/app.scrml");
    // Effect reads the root "form" key via _scrml_reactive_get
    expect(out.clientJs).toContain('_scrml_effect');
    expect(out.clientJs).toContain('_scrml_reactive_get("form")');
    // Must NOT subscribe to the dotted key directly
    expect(out.clientJs).not.toContain('_scrml_reactive_get("form.email"');
  });

  test("effect reads the path directly via _scrml_reactive_get", () => {
    const node = makeMarkupNode("input", [reactiveAttr("bind:value", "form.email")], [], { selfClosing: true });
    const result = compile(node);

    const out = result.outputs.get("/test/app.scrml");
    // Effect reads the full path: _scrml_reactive_get("form").email
    expect(out.clientJs).toContain('_scrml_reactive_get("form").email');
  });

  test("uses 'input' event (not 'change') for <input>", () => {
    const node = makeMarkupNode("input", [reactiveAttr("bind:value", "form.email")], [], { selfClosing: true });
    const result = compile(node);

    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).toContain('addEventListener("input"');
  });

  test("comment identifies the path variable correctly", () => {
    const node = makeMarkupNode("input", [reactiveAttr("bind:value", "form.email")], [], { selfClosing: true });
    const result = compile(node);

    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).toContain("// bind:value=@form.email");
  });
});

// ---------------------------------------------------------------------------
// §18 bind:value=@obj.field — one-level path binding on <select>
// ---------------------------------------------------------------------------

describe("§18: bind:value=@obj.field path binding on <select>", () => {
  test("produces no bind errors for <select bind:value=@form.country>", () => {
    const node = makeMarkupNode("select", [reactiveAttr("bind:value", "form.country")]);
    const result = compile(node);

    const bindErrors = result.errors.filter(e =>
      e.code === "E-ATTR-010" || e.code === "E-ATTR-011" || e.code === "E-ATTR-012"
    );
    expect(bindErrors).toHaveLength(0);
  });

  test("uses 'change' event (not 'input') for <select>", () => {
    const node = makeMarkupNode("select", [reactiveAttr("bind:value", "form.country")]);
    const result = compile(node);

    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).toContain('addEventListener("change"');
    expect(out.clientJs).not.toContain('addEventListener("input"');
  });

  test("write uses _scrml_deep_set for <select bind:value=@form.country>", () => {
    const node = makeMarkupNode("select", [reactiveAttr("bind:value", "form.country")]);
    const result = compile(node);

    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).toContain('_scrml_deep_set');
    expect(out.clientJs).toContain('"form"');
    expect(out.clientJs).toContain('["country"]');
  });

  test("subscription subscribes to root key 'form' for <select bind:value=@form.country>", () => {
    const node = makeMarkupNode("select", [reactiveAttr("bind:value", "form.country")]);
    const result = compile(node);

    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).toContain('_scrml_effect');
    expect(out.clientJs).toContain('_scrml_reactive_get("form")');
    expect(out.clientJs).not.toContain('_scrml_reactive_get("form.country"');
  });
});

// ---------------------------------------------------------------------------
// §19 bind:value=@a.b.c — nested (multi-level) path binding
// ---------------------------------------------------------------------------

describe("§19: bind:value=@a.b.c — multi-level path binding", () => {
  test("produces no bind errors for <input bind:value=@config.user.name>", () => {
    const node = makeMarkupNode("input", [reactiveAttr("bind:value", "config.user.name")], [], { selfClosing: true });
    const result = compile(node);

    const bindErrors = result.errors.filter(e =>
      e.code === "E-ATTR-010" || e.code === "E-ATTR-011" || e.code === "E-ATTR-012"
    );
    expect(bindErrors).toHaveLength(0);
  });

  test("read uses _scrml_reactive_get(\"config\").user.name", () => {
    const node = makeMarkupNode("input", [reactiveAttr("bind:value", "config.user.name")], [], { selfClosing: true });
    const result = compile(node);

    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).toContain('_scrml_reactive_get("config").user.name');
  });

  test("write uses _scrml_deep_set with path [\"user\",\"name\"]", () => {
    const node = makeMarkupNode("input", [reactiveAttr("bind:value", "config.user.name")], [], { selfClosing: true });
    const result = compile(node);

    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).toContain('["user","name"]');
    expect(out.clientJs).toContain('"config"');
  });

  test("subscription subscribes to root key 'config'", () => {
    const node = makeMarkupNode("input", [reactiveAttr("bind:value", "config.user.name")], [], { selfClosing: true });
    const result = compile(node);

    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).toContain('_scrml_effect');
    expect(out.clientJs).toContain('_scrml_reactive_get("config")');
    expect(out.clientJs).not.toContain('_scrml_reactive_get("config.user.name"');
  });

  test("effect reads the full path via _scrml_reactive_get", () => {
    const node = makeMarkupNode("input", [reactiveAttr("bind:value", "config.user.name")], [], { selfClosing: true });
    const result = compile(node);

    const out = result.outputs.get("/test/app.scrml");
    // Effect reads _scrml_reactive_get("config").user.name directly
    expect(out.clientJs).toContain('_scrml_reactive_get("config").user.name');
  });
});

// ---------------------------------------------------------------------------
// §20 Path binding: simple (@var) still uses flat reactive key
// ---------------------------------------------------------------------------

describe("§20: Simple @var binding still uses flat reactive key (no regression)", () => {
  test("<input bind:value=@name> does NOT use _scrml_deep_set", () => {
    const node = makeMarkupNode("input", [reactiveAttr("bind:value", "name")], [], { selfClosing: true });
    const result = compile(node);

    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).not.toContain('_scrml_deep_set');
  });

  test("<input bind:value=@name> subscribe key is 'name' (no dot)", () => {
    const node = makeMarkupNode("input", [reactiveAttr("bind:value", "name")], [], { selfClosing: true });
    const result = compile(node);

    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).toContain('_scrml_effect');
  });

  test("<input bind:value=@name> set call uses flat _scrml_reactive_set(\"name\", ...)", () => {
    const node = makeMarkupNode("input", [reactiveAttr("bind:value", "name")], [], { selfClosing: true });
    const result = compile(node);

    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).toContain('_scrml_reactive_set("name", event.target.value)');
  });
});

// ---------------------------------------------------------------------------
// §21 Path binding: HTML still emits data-scrml-bind-value placeholder
// ---------------------------------------------------------------------------

describe("§21: Path binding HTML output — data-scrml-bind-value placeholder emitted", () => {
  test("<input bind:value=@form.email> emits data-scrml-bind-value in HTML", () => {
    const node = makeMarkupNode("input", [reactiveAttr("bind:value", "form.email")], [], { selfClosing: true });
    const result = compile(node);

    const out = result.outputs.get("/test/app.scrml");
    expect(out.html).toContain("data-scrml-bind-value=");
    expect(out.html).not.toContain("bind:value=");
  });
});

// ---------------------------------------------------------------------------
// §22 Path binding: two path-bound fields do not cross-contaminate
// ---------------------------------------------------------------------------

describe("§22: Two path-bound inputs — no cross-contamination", () => {
  test("form.email and form.password both bind correctly on separate inputs", () => {
    const ast = makeFileAST("/test/app.scrml", [
      makeMarkupNode("input", [reactiveAttr("bind:value", "form.email")], [], { selfClosing: true }),
      makeMarkupNode("input", [reactiveAttr("bind:value", "form.password")], [], { selfClosing: true }),
    ]);

    const result = runCG({
      files: [ast],
      routeMap: makeRouteMap(),
      depGraph: makeDepGraph(),
      protectAnalysis: makeProtectAnalysis(),
    });

    const bindErrors = result.errors.filter(e =>
      e.code === "E-ATTR-010" || e.code === "E-ATTR-011" || e.code === "E-ATTR-012"
    );
    expect(bindErrors).toHaveLength(0);

    const out = result.outputs.get("/test/app.scrml");
    // Both fields projected in callbacks
    expect(out.clientJs).toContain('["email"]');
    expect(out.clientJs).toContain('["password"]');
    // Both fields use _scrml_effect that reads _scrml_reactive_get("form")
    const effectMatches = [...out.clientJs.matchAll(/_scrml_effect\(\(\) => \{/g)];
    expect(effectMatches.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// §23 bind:valueAsNumber — Number() coercion on write-back
// ---------------------------------------------------------------------------

describe("§23: bind:valueAsNumber — Number() coercion", () => {
  test("bind:valueAsNumber on <input> compiles without error", () => {
    const node = makeMarkupNode("input", [
      strAttr("type", "number"),
      reactiveAttr("bind:valueAsNumber", "count"),
    ], [], { selfClosing: true });
    const result = compile(node);

    const bindErrors = result.errors.filter(e =>
      e.code === "E-ATTR-010" || e.code === "E-ATTR-011" || e.code === "E-ATTR-012"
    );
    expect(bindErrors).toHaveLength(0);
  });

  test("bind:valueAsNumber emits Number(event.target.value) in the JS output", () => {
    const node = makeMarkupNode("input", [
      strAttr("type", "number"),
      reactiveAttr("bind:valueAsNumber", "count"),
    ], [], { selfClosing: true });
    const result = compile(node);

    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).toContain("Number(event.target.value)");
  });

  test("bind:valueAsNumber emits input event (not change) for <input>", () => {
    const node = makeMarkupNode("input", [
      strAttr("type", "number"),
      reactiveAttr("bind:valueAsNumber", "count"),
    ], [], { selfClosing: true });
    const result = compile(node);

    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).toContain('addEventListener("input"');
  });

  test("bind:valueAsNumber emits change event for <select>", () => {
    const node = makeMarkupNode("select", [reactiveAttr("bind:valueAsNumber", "selectedId")]);
    const result = compile(node);

    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).toContain('addEventListener("change"');
  });

  test("bind:valueAsNumber emits data-scrml-bind-valueAsNumber placeholder in HTML", () => {
    const node = makeMarkupNode("input", [
      strAttr("type", "number"),
      reactiveAttr("bind:valueAsNumber", "count"),
    ], [], { selfClosing: true });
    const result = compile(node);

    const out = result.outputs.get("/test/app.scrml");
    expect(out.html).toContain("data-scrml-bind-valueAsNumber=");
  });

  test("bind:valueAsNumber on invalid element (<div>) produces E-ATTR-011", () => {
    const node = makeMarkupNode("div", [reactiveAttr("bind:valueAsNumber", "count")]);
    const result = compile(node);

    const e011 = result.errors.filter(e => e.code === "E-ATTR-011");
    expect(e011.length).toBeGreaterThan(0);
  });

  test("bind:valueAsNumber with non-reactive variable produces E-ATTR-010", () => {
    const node = makeMarkupNode("input", [
      strAttr("type", "number"),
      plainAttr("bind:valueAsNumber", "count"),
    ], [], { selfClosing: true });
    const result = compile(node);

    const e010 = result.errors.filter(e => e.code === "E-ATTR-010");
    expect(e010).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// §24 bind:value + oninput= coexistence — both bind wiring and handler emitted
// ---------------------------------------------------------------------------

describe("§24: bind:value + oninput= coexistence — both bindings emitted", () => {
  test("bind:value + oninput= emits bind wiring (addEventListener for reactive set)", () => {
    const node = makeMarkupNode("input", [
      reactiveAttr("bind:value", "filter"),
      callAttr("oninput", "resetPage"),
    ], [], { selfClosing: true });
    const result = compile(node);

    const out = result.outputs.get("/test/app.scrml");
    // bind:value wiring — reactive set on input event
    expect(out.clientJs).toContain('addEventListener("input"');
    expect(out.clientJs).toContain('_scrml_reactive_set("filter"');
  });

  test("bind:value + oninput= registers the explicit handler in event bindings", () => {
    const node = makeMarkupNode("input", [
      reactiveAttr("bind:value", "filter"),
      callAttr("oninput", "resetPage"),
    ], [], { selfClosing: true });
    const result = compile(node);

    // The explicit handler should be registered in the binding registry for event wiring
    // data-scrml-bind-oninput placeholder must appear in HTML
    const out = result.outputs.get("/test/app.scrml");
    expect(out.html).toContain("data-scrml-bind-oninput=");
  });

  test("bind:checked + onchange= coexistence emits reactive subscribe and handler wiring", () => {
    const node = makeMarkupNode("input", [
      strAttr("type", "checkbox"),
      reactiveAttr("bind:checked", "agreed"),
      callAttr("onchange", "handleAgree"),
    ], [], { selfClosing: true });
    const result = compile(node);

    const out = result.outputs.get("/test/app.scrml");
    // bind:checked uses _scrml_effect for reactive updates
    expect(out.clientJs).toContain('_scrml_effect');
    // explicit handler placeholder in HTML
    expect(out.html).toContain("data-scrml-bind-onchange=");
  });
});


// ---------------------------------------------------------------------------
// §25 bind:value on <select> with enum-typed @var — auto-coercion (§14.4.1 / §5.4)
// ---------------------------------------------------------------------------

describe("§25: bind:value on <select> with enum-typed @var — toEnum coercion", () => {
  function makeEnumDecl(name, variantNames) {
    return {
      kind: "type-decl",
      typeKind: "enum",
      name,
      variants: variantNames.map(v => ({ name: v, payload: null })),
      raw: `{ ${variantNames.join(" | ")} }`,
      span: span(0),
    };
  }

  function makeLogicNode(bodyNodes) {
    return { kind: "logic", body: bodyNodes, span: span(0) };
  }

  function makeReactiveDecl(name, init) {
    return { kind: "state-decl", name, init, span: span(0) };
  }

  test("§25.1 enum-typed @var on <select> generates Theme_toEnum coercion in change handler", () => {
    const themeDecl = makeEnumDecl("Theme", ["Light", "Dark", "System"]);
    const logicNode = makeLogicNode([makeReactiveDecl("theme", "Light")]);
    const selectNode = makeMarkupNode("select", [reactiveAttr("bind:value", "theme")]);

    const ast = makeFileAST("/test/app.scrml", [logicNode, selectNode], {
      typeDecls: [themeDecl],
    });
    const result = runCG({
      files: [ast],
      routeMap: makeRouteMap(),
      depGraph: makeDepGraph(),
      protectAnalysis: makeProtectAnalysis(),
    });

    const out = result.outputs.get("/test/app.scrml");
    expect(result.errors.filter(e => e.code && e.code.startsWith("E-ATTR"))).toHaveLength(0);
    expect(out.clientJs).toContain("Theme_toEnum[event.target.value]");
    expect(out.clientJs).toContain('addEventListener("change"');
  });

  test("§25.2 non-enum @var on <select> does NOT get toEnum coercion", () => {
    const logicNode = makeLogicNode([makeReactiveDecl("country", "us")]);
    const selectNode = makeMarkupNode("select", [reactiveAttr("bind:value", "country")]);

    const ast = makeFileAST("/test/app.scrml", [logicNode, selectNode]);
    const result = runCG({
      files: [ast],
      routeMap: makeRouteMap(),
      depGraph: makeDepGraph(),
      protectAnalysis: makeProtectAnalysis(),
    });

    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).not.toContain("_toEnum[event.target.value]");
    expect(out.clientJs).toContain("event.target.value");
  });

  test("§25.3 enum-typed @var on <input> (not <select>) does NOT get toEnum coercion", () => {
    const statusDecl = makeEnumDecl("Status", ["Active", "Inactive"]);
    const logicNode = makeLogicNode([makeReactiveDecl("status", "Active")]);
    const inputNode = makeMarkupNode("input", [reactiveAttr("bind:value", "status")], [], { selfClosing: true });

    const ast = makeFileAST("/test/app.scrml", [logicNode, inputNode], {
      typeDecls: [statusDecl],
    });
    const result = runCG({
      files: [ast],
      routeMap: makeRouteMap(),
      depGraph: makeDepGraph(),
      protectAnalysis: makeProtectAnalysis(),
    });

    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).not.toContain("Status_toEnum[event.target.value]");
    expect(out.clientJs).toContain("event.target.value");
  });

  test("§25.4 enum select with dot-prefix init (.Light) is correctly inferred", () => {
    const themeDecl = makeEnumDecl("Theme", ["Light", "Dark"]);
    const logicNode = makeLogicNode([makeReactiveDecl("theme", ".Light")]);
    const selectNode = makeMarkupNode("select", [reactiveAttr("bind:value", "theme")]);

    const ast = makeFileAST("/test/app.scrml", [logicNode, selectNode], {
      typeDecls: [themeDecl],
    });
    const result = runCG({
      files: [ast],
      routeMap: makeRouteMap(),
      depGraph: makeDepGraph(),
      protectAnalysis: makeProtectAnalysis(),
    });

    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).toContain("Theme_toEnum[event.target.value]");
  });

  test("§25.5 enum select with :: prefix init (::Light) is correctly inferred", () => {
    const themeDecl = makeEnumDecl("Theme", ["Light", "Dark"]);
    const logicNode = makeLogicNode([makeReactiveDecl("theme", "::Light")]);
    const selectNode = makeMarkupNode("select", [reactiveAttr("bind:value", "theme")]);

    const ast = makeFileAST("/test/app.scrml", [logicNode, selectNode], {
      typeDecls: [themeDecl],
    });
    const result = runCG({
      files: [ast],
      routeMap: makeRouteMap(),
      depGraph: makeDepGraph(),
      protectAnalysis: makeProtectAnalysis(),
    });

    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).toContain("Theme_toEnum[event.target.value]");
  });

  test("§25.6 coercion uses fallback: ?? event.target.value for unknown variants", () => {
    const themeDecl = makeEnumDecl("Theme", ["Light", "Dark"]);
    const logicNode = makeLogicNode([makeReactiveDecl("theme", "Light")]);
    const selectNode = makeMarkupNode("select", [reactiveAttr("bind:value", "theme")]);

    const ast = makeFileAST("/test/app.scrml", [logicNode, selectNode], {
      typeDecls: [themeDecl],
    });
    const result = runCG({
      files: [ast],
      routeMap: makeRouteMap(),
      depGraph: makeDepGraph(),
      protectAnalysis: makeProtectAnalysis(),
    });

    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).toContain("?? event.target.value");
  });

  test("§25.7 multiple enum types — each select var coerces to its own enum type", () => {
    const themeDecl = makeEnumDecl("Theme", ["Light", "Dark"]);
    const roleDecl = makeEnumDecl("Role", ["Admin", "User"]);
    const logicNode = makeLogicNode([
      makeReactiveDecl("theme", "Light"),
      makeReactiveDecl("role", "User"),
    ]);
    const themeSelect = makeMarkupNode("select", [reactiveAttr("bind:value", "theme")]);
    const roleSelect = makeMarkupNode("select", [reactiveAttr("bind:value", "role")]);

    const ast = makeFileAST("/test/app.scrml", [logicNode, themeSelect, roleSelect], {
      typeDecls: [themeDecl, roleDecl],
    });
    const result = runCG({
      files: [ast],
      routeMap: makeRouteMap(),
      depGraph: makeDepGraph(),
      protectAnalysis: makeProtectAnalysis(),
    });

    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).toContain("Theme_toEnum[event.target.value]");
    expect(out.clientJs).toContain("Role_toEnum[event.target.value]");
  });

  test("§25.8 enum lookup tables are emitted when typeDecls includes enum", () => {
    const themeDecl = makeEnumDecl("Theme", ["Light", "Dark", "System"]);
    const logicNode = makeLogicNode([makeReactiveDecl("theme", "Light")]);
    const selectNode = makeMarkupNode("select", [reactiveAttr("bind:value", "theme")]);

    const ast = makeFileAST("/test/app.scrml", [logicNode, selectNode], {
      typeDecls: [themeDecl],
    });
    const result = runCG({
      files: [ast],
      routeMap: makeRouteMap(),
      depGraph: makeDepGraph(),
      protectAnalysis: makeProtectAnalysis(),
    });

    const out = result.outputs.get("/test/app.scrml");
    expect(out.clientJs).toContain('const Theme_toEnum');
    expect(out.clientJs).toContain('"Light": "Light"');
    expect(out.clientJs).toContain('"Dark": "Dark"');
  });
});
