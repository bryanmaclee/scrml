/**
 * g-attr-if-fn-call-misroute (S191) — Unit Tests
 *
 * SPEC §5.1 line 1352: an unquoted CONDITION attribute (`if=` §17.1 / `show=`
 * §17.2) admits the atomic forms identifier-ref, prefix-`!`, AND a CALL `fn()`.
 *
 * Pre-fix BUG: the `call-ref` attribute value branch in emit-html.ts
 * unconditionally routed to `addEventBinding` for ANY attribute name, so
 * `<p if=isVisible()>` emitted `data-scrml-bind-if` + `el.addEventListener("if",
 * …)` — a NONEXISTENT "if" DOM event, never a render predicate. The element
 * always rendered, with no diagnostic.
 *
 * Fix: the `if=` / `show=` call-ref is now routed as a reactive conditional
 * (addLogicBinding), mirroring the `val.kind === "expr"` if/show branch. The fn
 * name is auto-mangled by the whole-buffer post-fn-name-mangle pass; `@`-ref
 * args are rewritten by rewriteExprWithDerived; the runtime `_scrml_effect`
 * dynamically subscribes to the cells the call reads.
 *
 * Coverage:
 *   §1  Registry binding shape — if=fn() / show=fn() register an
 *       isMountToggle / isVisibilityToggle logic binding (NOT an event binding);
 *       reactive @-arg refs are extracted.
 *   §2  Client JS — if=fn() emits a `_scrml_effect`-wrapped conditional calling
 *       the fn; `addEventListener("if"` is ABSENT.
 *   §3  Controls / regressions — if=(fn()), if=@count still conditionals;
 *       onclick=fn() STILL event-binds (the `else` path untouched).
 *
 * Phase 2 finish (S301): `if=` no longer has a display-toggle fallback. Every
 * `if=` — call-ref, paren-expr, varref — lowers to §17.1 template+marker
 * mount/unmount, so the `if=` cases below assert `isMountToggle` +
 * `_scrml_mount_template` where they used to assert `isConditionalDisplay` +
 * `el.style.display`. `show=` (§17.2) keeps the display lowering and is unchanged.
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { generateHtml } from "../../src/codegen/emit-html.js";
import { BindingRegistry } from "../../src/codegen/binding-registry.ts";
import { resetVarCounter } from "../../src/codegen/var-counter.ts";
import { runCG } from "../../src/code-generator.js";
import { foldChunkNamespacing } from "../helpers/chunk-scope.js";

// ---------------------------------------------------------------------------
// Helpers (mirrors if-mount-emission.test.js)
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

function compile(nodes) {
  const ast = makeFileAST(nodes);
  return runCG({
    files: [ast],
    routeMap: { functions: new Map() },
    depGraph: { nodes: new Map(), edges: [] },
    protectAnalysis: { views: new Map() },
  });
}

/** `attr=fn(args)` — the real-source call-ref attribute value shape. */
function callRefAttr(name, fnName, args = []) {
  return {
    name,
    value: { kind: "call-ref", name: fnName, args, span: span(0) },
    span: span(0),
  };
}

/** `attr=${raw}` / `attr=(raw)` — expr attribute value (paren control). */
function exprAttr(name, raw, refs = []) {
  return {
    name,
    value: { kind: "expr", raw, refs, span: span(0) },
    span: span(0),
  };
}

/** `attr=@var` — variable-ref attribute value (varref control). */
function varRefAttr(name, varName) {
  return {
    name,
    value: { kind: "variable-ref", name: varName, span: span(0) },
    span: span(0),
  };
}

beforeEach(() => {
  resetVarCounter();
});

// ---------------------------------------------------------------------------
// §1  Registry binding shape — call-ref if=/show= -> logic binding
// ---------------------------------------------------------------------------

describe("§1: if=fn() / show=fn() register a reactive conditional (not an event binding)", () => {
  test("S1: if=isVisible() registers an isMountToggle logic binding", () => {
    // The inner onclick used to force the display-toggle fallback; since Phase 2
    // it does not — the handler simply rides inside the mounted template.
    const inner = makeMarkupNode("button", [callRefAttr("onclick", "handle")], []);
    const node = makeMarkupNode("div", [callRefAttr("if", "isVisible")], [inner]);
    const registry = new BindingRegistry();
    generateHtml([node], [], false, registry, null);

    const binding = registry.logicBindings.find(b => b.isMountToggle);
    expect(binding).toBeDefined();
    expect(binding.condExpr).toBe("isVisible()");
    // It is NOT routed through addEventBinding for the if= attr.
    const ifEvent = registry.eventBindings.find(b => b.eventName === "if");
    expect(ifEvent).toBeUndefined();
  });

  test("S2: show=isVisible() registers an isVisibilityToggle logic binding", () => {
    const node = makeMarkupNode("p", [callRefAttr("show", "isVisible")], [
      { kind: "text", value: "x", span: span(0) },
    ]);
    const registry = new BindingRegistry();
    generateHtml([node], [], false, registry, null);

    const binding = registry.logicBindings.find(b => b.isVisibilityToggle);
    expect(binding).toBeDefined();
    expect(binding.condExpr).toBe("isVisible()");
    const showEvent = registry.eventBindings.find(b => b.eventName === "show");
    expect(showEvent).toBeUndefined();
  });

  test("S3: if=check(@x, 5) carries the args in condExpr and extracts the @-ref", () => {
    const inner = makeMarkupNode("button", [callRefAttr("onclick", "handle")], []);
    const node = makeMarkupNode("div", [callRefAttr("if", "check", ["@x", "5"])], [inner]);
    const registry = new BindingRegistry();
    generateHtml([node], [], false, registry, null);

    const binding = registry.logicBindings.find(b => b.isMountToggle);
    expect(binding).toBeDefined();
    expect(binding.condExpr).toBe("check(@x, 5)");
    // The reactive arg @x is surfaced as a bare-name ref.
    expect(binding.refs).toContain("x");
    // The literal arg is not a ref.
    expect(binding.refs).not.toContain("5");
  });

  test("S4: if=fn() with no args produces condExpr `fn()` and an empty refs array", () => {
    const inner = makeMarkupNode("button", [callRefAttr("onclick", "handle")], []);
    const node = makeMarkupNode("div", [callRefAttr("if", "isVisible")], [inner]);
    const registry = new BindingRegistry();
    generateHtml([node], [], false, registry, null);

    const binding = registry.logicBindings.find(b => b.isMountToggle);
    expect(binding.condExpr).toBe("isVisible()");
    expect(Array.isArray(binding.refs)).toBe(true);
    expect(binding.refs.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §2  Client JS — reactive conditional, NOT an "if" event listener
// ---------------------------------------------------------------------------

describe("§2: if=fn() emits a reactive conditional in client JS", () => {
  test("S5: if=isVisible() emits template+marker and NO addEventListener(\"if\")", () => {
    const inner = makeMarkupNode("button", [callRefAttr("onclick", "handle")], []);
    const node = makeMarkupNode("div", [callRefAttr("if", "isVisible")], [inner]);
    const result = compile([node]);
    const out = result.outputs.get("/test/app.scrml");

    expect(out.html).not.toContain("data-scrml-bind-if=");
    expect(out.html).toContain("scrml-if-marker:");
    // The bug signature MUST be gone.
    expect(foldChunkNamespacing(out.clientJs)).not.toContain('addEventListener("if"');
  });

  test("S6: if=isVisible() emits a _scrml_effect-wrapped conditional calling the fn", () => {
    const inner = makeMarkupNode("button", [callRefAttr("onclick", "handle")], []);
    const node = makeMarkupNode("div", [callRefAttr("if", "isVisible")], [inner]);
    const result = compile([node]);
    const out = result.outputs.get("/test/app.scrml");

    // Reactive effect present and the call site is inside it.
    expect(foldChunkNamespacing(out.clientJs)).toContain("_scrml_effect(");
    expect(foldChunkNamespacing(out.clientJs)).toMatch(/_scrml_effect\(function\(\)[\s\S]*isVisible\(\)/);
    // §17.1 — the conditional drives mount/unmount, never el.style.display.
    expect(foldChunkNamespacing(out.clientJs)).toContain("_scrml_mount_template");
    expect(foldChunkNamespacing(out.clientJs)).not.toContain("el.style.display");
  });

  test("S7: show=isVisible() emits a display-toggle conditional (not event-bound)", () => {
    const node = makeMarkupNode("p", [callRefAttr("show", "isVisible")], [
      { kind: "text", value: "x", span: span(0) },
    ]);
    const result = compile([node]);
    const out = result.outputs.get("/test/app.scrml");

    expect(out.html).toContain("data-scrml-bind-show=");
    expect(foldChunkNamespacing(out.clientJs)).not.toContain('addEventListener("show"');
    expect(foldChunkNamespacing(out.clientJs)).toContain("_scrml_effect(");
    expect(foldChunkNamespacing(out.clientJs)).toContain("el.style.display");
  });

  test("S8: if=check(@x) reactive-arg call surfaces the reactive read in the condition", () => {
    const inner = makeMarkupNode("button", [callRefAttr("onclick", "handle")], []);
    const node = makeMarkupNode("div", [callRefAttr("if", "check", ["@x"])], [inner]);
    const result = compile([node]);
    const out = result.outputs.get("/test/app.scrml");

    expect(foldChunkNamespacing(out.clientJs)).not.toContain('addEventListener("if"');
    // The @x arg is lowered to a reactive read inside the condition.
    expect(foldChunkNamespacing(out.clientJs)).toContain('_scrml_reactive_get("x")');
    expect(foldChunkNamespacing(out.clientJs)).toContain("check(");
  });
});

// ---------------------------------------------------------------------------
// §3  Controls / regressions — the untouched paths
// ---------------------------------------------------------------------------

describe("§3: controls — paren/varref conditionals unchanged; onclick still event-binds", () => {
  test("S9: CONTROL if=(isVisible()) (paren expr) still emits a conditional", () => {
    const inner = makeMarkupNode("button", [callRefAttr("onclick", "handle")], []);
    const node = makeMarkupNode("div", [exprAttr("if", "(isVisible())")], [inner]);
    const result = compile([node]);
    const out = result.outputs.get("/test/app.scrml");

    expect(foldChunkNamespacing(out.clientJs)).not.toContain('addEventListener("if"');
    expect(foldChunkNamespacing(out.clientJs)).toContain("_scrml_effect(");
    expect(foldChunkNamespacing(out.clientJs)).toContain("_scrml_mount_template");
  });

  test("S10: CONTROL if=@count (varref) still emits a conditional", () => {
    const inner = makeMarkupNode("button", [callRefAttr("onclick", "handle")], []);
    const node = makeMarkupNode("div", [varRefAttr("if", "@count")], [inner]);
    const result = compile([node]);
    const out = result.outputs.get("/test/app.scrml");

    expect(foldChunkNamespacing(out.clientJs)).not.toContain('addEventListener("if"');
    expect(foldChunkNamespacing(out.clientJs)).toContain("_scrml_mount_template");
    expect(foldChunkNamespacing(out.clientJs)).toContain('_scrml_reactive_get("count")');
  });

  test("S11: CONTROL onclick=fn() STILL event-binds (the else path is untouched)", () => {
    const node = makeMarkupNode("button", [callRefAttr("onclick", "handle")], [
      { kind: "text", value: "go", span: span(0) },
    ]);
    const registry = new BindingRegistry();
    generateHtml([node], [], false, registry, null);

    // onclick is a genuine event binding — NOT a logic binding.
    const evt = registry.eventBindings.find(b => b.eventName === "onclick");
    expect(evt).toBeDefined();
    expect(evt.handlerName).toBe("handle");
    const logic = registry.logicBindings.find(b => b.isConditionalDisplay || b.isVisibilityToggle);
    expect(logic).toBeUndefined();
  });

  test("S12: CONTROL server-only call name in if= is still dropped (defense-in-depth) — only via the non-condition path", () => {
    // A server-only call name in onclick position must NOT become an event
    // binding (the SERVER_ONLY_CALL guard lives on the non-condition else path).
    const node = makeMarkupNode("button", [callRefAttr("onclick", "Bun.spawn")], []);
    const registry = new BindingRegistry();
    generateHtml([node], [], false, registry, null);
    const evt = registry.eventBindings.find(b => b.eventName === "onclick");
    expect(evt).toBeUndefined();
  });
});
