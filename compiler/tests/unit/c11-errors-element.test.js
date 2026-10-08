/**
 * c11-errors-element.test.js — A1c Step C11 unit tests
 *
 * Tests `<errors of=expr/>` first-class element emission per SPEC §55.8 + L13.
 *
 *   §C11.0  HTML shape — emits placeholder span with anchor id
 *   §C11.1  Per-field rendering — registers binding with isCompoundRollup=false
 *   §C11.2  Per-field with `all` flag — registers allFlag=true
 *   §C11.3  Compound rollup — registers isCompoundRollup=true
 *   §C11.4  Compound rollup with `all` flag
 *   §C11.5  Empty errors → no DOM (per SPEC line 25193-25195)
 *   §C11.6  Body override — captures bodyExpr from arrow-function body
 *   §C11.7  Multi-level compound nav (§6.3.5)
 *   §C11.8  messageFor integration — references _scrml_message_for + stub
 *   §C11.9  Missing `of=` attribute → E-ERRORS-001
 *   §C11.10 Reactive subscription — re-renders on errors-cell update
 *   §C11.11 No-validator field rendering (legal per SPEC line 25209-25210)
 *   §C11.12 Wave-3 closure (default render shape)
 *   §C11.13 Registration — `<errors>` in attribute-registry + html-elements
 *
 * SCOPE: per BRIEF — covers `<errors>` first-class element emission, both per-
 * field and compound-rollup shapes, default and `all` rendering, body-override,
 * empty-errors no-DOM, messageFor integration (stub-fallback).
 *
 * OUT OF SCOPE: 4-level message chain implementation (C10 sibling), cross-field
 * deps refinement (C9 sibling), match Level-4 escape hatch (consumer-side).
 *
 * Pattern: tests construct minimal markup ASTs by hand and exercise
 * `generateHtml` + `emitEventWiring` directly. This mirrors C8's pattern of
 * exercising the emitter in isolation, sidestepping full pipeline parse
 * concerns. End-to-end coverage is C8/C7 territory.
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { generateHtml } from "../../src/codegen/emit-html.js";
import { BindingRegistry } from "../../src/codegen/binding-registry.ts";
import { resetVarCounter } from "../../src/codegen/var-counter.ts";
import { emitEventWiring } from "../../src/codegen/emit-event-wiring.ts";
import { getElementShape } from "../../src/html-elements.js";
import { getElementAttrSchema } from "../../src/attribute-registry.js";

// ---------------------------------------------------------------------------
// Helpers — construct minimal markup AST nodes by hand.
// ---------------------------------------------------------------------------

function span() { return { file: "", start: 0, end: 0, line: 1, col: 1 }; }

/** Build an `<errors of=expr [all]/>` self-closing markup node. */
function errorsNode({ ofPath, all = false, body = null }) {
  const attrs = [];
  if (ofPath !== undefined) {
    attrs.push({
      name: "of",
      value: { kind: "variable-ref", name: `@${ofPath}` },
      span: span(),
    });
  }
  if (all) {
    attrs.push({
      name: "all",
      value: { kind: "absent" },
      span: span(),
    });
  }
  return {
    kind: "markup",
    tag: "errors",
    tagName: "errors",
    attributes: attrs,
    attrs,
    children: body ? [body] : [],
    selfClosing: !body,
    span: span(),
  };
}

/** Build a logic node holding a single bare-expr (the body-override path). */
function logicArrowBody(rawArrowExpr) {
  return {
    kind: "logic",
    body: [
      {
        kind: "bare-expr",
        expr: rawArrowExpr,
        exprNode: undefined,  // not needed for tests; emit-html uses .expr fallback
        span: span(),
      },
    ],
    span: span(),
  };
}

/** Run generateHtml on an array of nodes. */
function runEmit(nodes) {
  resetVarCounter();
  const errors = [];
  const registry = new BindingRegistry();
  const html = generateHtml(nodes, errors, false, registry, null);
  return { html, registry, errors };
}

/** Build a minimal CompileContext + run emitEventWiring on the registry. */
function runEventWiring(registry, opts = {}) {
  const ctx = {
    registry,
    encodingCtx: opts.encodingCtx ?? null,
    fileAST: null,
    errors: [],
    csrfEnabled: false,
  };
  const fnNameMap = new Map();
  const lines = emitEventWiring(ctx, fnNameMap);
  return lines.join("\n");
}

beforeEach(() => {
  resetVarCounter();
});

// ---------------------------------------------------------------------------
// §C11.13 — Registration in attribute-registry + html-elements
// (per primer §12 amendment)
// ---------------------------------------------------------------------------

describe("C11 §C11.13 — `<errors>` registration", () => {
  test("`errors` is registered in html-elements with rendersToDom: false", () => {
    const shape = getElementShape("errors");
    expect(shape).not.toBeNull();
    expect(shape.tag).toBe("errors");
    expect(shape.rendersToDom).toBe(false);
  });

  test("`errors` shape declares `of` (required) and `all` attributes", () => {
    const shape = getElementShape("errors");
    expect(shape.attributes.has("of")).toBe(true);
    expect(shape.attributes.has("all")).toBe(true);
    const ofAttr = shape.attributes.get("of");
    expect(ofAttr.required).toBe(true);
  });

  test("`errors` is registered in attribute-registry (VP-1/VP-3 coverage)", () => {
    const schema = getElementAttrSchema("errors");
    expect(schema).not.toBeNull();
    expect(schema.allowedAttrs.has("of")).toBe(true);
    expect(schema.allowedAttrs.has("all")).toBe(true);
  });

  test("`errors` `of` attribute does NOT support template interpolation", () => {
    const schema = getElementAttrSchema("errors");
    const ofSpec = schema.allowedAttrs.get("of");
    expect(ofSpec.supportsInterpolation).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §C11.0 — HTML emission shape: placeholder anchor span
// ---------------------------------------------------------------------------

describe("C11 §C11.0 — HTML emission shape", () => {
  test("emits a single placeholder span with data-scrml-errors-anchor", () => {
    const node = errorsNode({ ofPath: "signup.name" });
    const { html, errors } = runEmit([node]);
    expect(errors.length).toBe(0);
    expect(html).toMatch(/<span data-scrml-errors-anchor="[^"]+"><\/span>/);
  });

  test("placeholder span has empty inner content (no DOM produced at compile time)", () => {
    const node = errorsNode({ ofPath: "signup.name" });
    const { html } = runEmit([node]);
    expect(html).toMatch(/<span data-scrml-errors-anchor="[^"]+"><\/span>/);
    // Strict: no nested HTML element appears between the open and close span tags.
    const m = html.match(/<span data-scrml-errors-anchor="[^"]+">([\s\S]*?)<\/span>/);
    expect(m).not.toBeNull();
    expect(m[1]).toBe("");
  });

  test("multiple <errors> elements emit distinct anchor ids", () => {
    const a = errorsNode({ ofPath: "signup.name" });
    const b = errorsNode({ ofPath: "signup.email" });
    const { html } = runEmit([a, b]);
    const matches = html.match(/data-scrml-errors-anchor="([^"]+)"/g) ?? [];
    expect(matches.length).toBe(2);
    expect(matches[0]).not.toBe(matches[1]);
  });
});

// ---------------------------------------------------------------------------
// §C11.1 — Per-field binding shape
// ---------------------------------------------------------------------------

describe("C11 §C11.1 — Per-field binding (default, first error)", () => {
  test("registry records errors-element binding with isCompoundRollup=false", () => {
    const node = errorsNode({ ofPath: "signup.name" });
    const { registry } = runEmit([node]);
    const errBindings = registry.logicBindings.filter((b) => b.kind === "errors-element");
    expect(errBindings.length).toBe(1);
    expect(errBindings[0].isCompoundRollup).toBe(false);
    expect(errBindings[0].errorsKey).toBe("signup.name");
    expect(errBindings[0].fieldName).toBe("name");
    expect(errBindings[0].allFlag).toBe(false);
  });

  test("event-wiring uses default `<p class=\"scrml-error\">` render when no body", () => {
    const node = errorsNode({ ofPath: "signup.name" });
    const { registry } = runEmit([node]);
    const wiring = runEventWiring(registry);
    // Default render shape per SPEC §55.8 line 25190.
    expect(wiring).toContain('<p class="scrml-error">');
  });
});

// ---------------------------------------------------------------------------
// §C11.2 — Per-field with `all` flag
// ---------------------------------------------------------------------------

describe("C11 §C11.2 — Per-field `all` flag", () => {
  test("registry records allFlag=true when `all` attribute is present", () => {
    const node = errorsNode({ ofPath: "signup.name", all: true });
    const { registry } = runEmit([node]);
    const errBindings = registry.logicBindings.filter((b) => b.kind === "errors-element");
    expect(errBindings.length).toBe(1);
    expect(errBindings[0].allFlag).toBe(true);
    expect(errBindings[0].isCompoundRollup).toBe(false);
  });

  test("emit-event-wiring iterates the full array on `all`", () => {
    const node = errorsNode({ ofPath: "signup.name", all: true });
    const { registry } = runEmit([node]);
    const wiring = runEventWiring(registry);
    // The `all` flag emits a `for (const tag of src)` loop.
    expect(wiring).toMatch(/for\s*\(\s*const\s+tag\s+of\s+src\s*\)/);
  });
});

// ---------------------------------------------------------------------------
// §C11.3 — Compound rollup (default)
// ---------------------------------------------------------------------------

describe("C11 §C11.3 — Compound rollup (default)", () => {
  test("registry records isCompoundRollup=true when `of=` lacks dot path", () => {
    const node = errorsNode({ ofPath: "signup" });
    const { registry } = runEmit([node]);
    const errBindings = registry.logicBindings.filter((b) => b.kind === "errors-element");
    expect(errBindings.length).toBe(1);
    expect(errBindings[0].isCompoundRollup).toBe(true);
    expect(errBindings[0].errorsKey).toBe("signup");
    expect(errBindings[0].allFlag).toBe(false);
    // No per-field name on compound rollup.
    expect(errBindings[0].fieldName).toBeUndefined();
  });

  test("event-wiring iterates Object.entries on compound rollup", () => {
    const node = errorsNode({ ofPath: "signup" });
    const { registry } = runEmit([node]);
    const wiring = runEventWiring(registry);
    expect(wiring).toContain("Object.entries(src)");
  });
});

// ---------------------------------------------------------------------------
// §C11.4 — Compound rollup with `all` flag
// ---------------------------------------------------------------------------

describe("C11 §C11.4 — Compound rollup with `all` flag", () => {
  test("registry records allFlag=true + isCompoundRollup=true", () => {
    const node = errorsNode({ ofPath: "signup", all: true });
    const { registry } = runEmit([node]);
    const errBindings = registry.logicBindings.filter((b) => b.kind === "errors-element");
    expect(errBindings.length).toBe(1);
    expect(errBindings[0].isCompoundRollup).toBe(true);
    expect(errBindings[0].allFlag).toBe(true);
  });

  test("event-wiring iterates Object.entries + per-tag inner loop on `all`", () => {
    const node = errorsNode({ ofPath: "signup", all: true });
    const { registry } = runEmit([node]);
    const wiring = runEventWiring(registry);
    expect(wiring).toContain("Object.entries(src)");
    // Inner loop iterates per tag in arr.
    expect(wiring).toMatch(/for\s*\(\s*const\s+tag\s+of\s+arr\s*\)/);
  });
});

// ---------------------------------------------------------------------------
// §C11.5 — Empty errors → no DOM (per SPEC line 25193-25195)
// ---------------------------------------------------------------------------

describe("C11 §C11.5 — Empty errors → no DOM", () => {
  test("per-field render path sets innerHTML='' when source array is empty", () => {
    const node = errorsNode({ ofPath: "signup.name" });
    const { registry } = runEmit([node]);
    const wiring = runEventWiring(registry);
    // Empty-array branch: !Array.isArray(src) || src.length === 0 → innerHTML = "".
    expect(wiring).toMatch(/if\s*\(\s*!Array\.isArray\(src\)\s*\|\|\s*src\.length\s*===\s*0\s*\)\s*\{\s*_scrml_el\.innerHTML\s*=\s*""/);
  });

  test("compound-rollup render path sets innerHTML='' when source is null/non-object", () => {
    const node = errorsNode({ ofPath: "signup" });
    const { registry } = runEmit([node]);
    const wiring = runEventWiring(registry);
    // Empty-map branch.
    expect(wiring).toMatch(/if\s*\(\s*!src\s*\|\|\s*typeof\s+src\s*!==\s*"object"\s*\)\s*\{\s*_scrml_el\.innerHTML\s*=\s*""/);
  });

  test("compound-rollup skips fields whose error-array is empty", () => {
    const node = errorsNode({ ofPath: "signup" });
    const { registry } = runEmit([node]);
    const wiring = runEventWiring(registry);
    // Inside the entries loop, skip when the per-field array is empty.
    expect(wiring).toMatch(/if\s*\(\s*!Array\.isArray\(arr\)\s*\|\|\s*arr\.length\s*===\s*0\s*\)\s*continue/);
  });
});

// ---------------------------------------------------------------------------
// §C11.6 — Body override
// ---------------------------------------------------------------------------

describe("C11 §C11.6 — Body override", () => {
  test("registry captures bodyExpr when arrow-function body is present", () => {
    const body = logicArrowBody(`(err) => "<span>!" + err.tag + "</span>"`);
    const node = errorsNode({ ofPath: "signup.name", body });
    const { registry } = runEmit([node]);
    const errBindings = registry.logicBindings.filter((b) => b.kind === "errors-element");
    expect(errBindings.length).toBe(1);
    expect(errBindings[0].bodyExpr).toBeDefined();
    expect(errBindings[0].bodyExpr).toMatch(/=>/);
  });

  test("event-wiring emits a bodyFn local when bodyExpr is present", () => {
    const body = logicArrowBody(`(err) => "boom"`);
    const node = errorsNode({ ofPath: "signup.name", body });
    const { registry } = runEmit([node]);
    const wiring = runEventWiring(registry);
    expect(wiring).toMatch(/const\s+bodyFn_/);
  });

  test("body-override path replaces default render shape (no scrml-error class wrap)", () => {
    const body = logicArrowBody(`(err) => "<span>" + err.tag + "</span>"`);
    const node = errorsNode({ ofPath: "signup.name", body });
    const { registry } = runEmit([node]);
    const wiring = runEventWiring(registry);
    // The renderOne_<id> for body-override calls bodyFn_<id> directly; the
    // default `<p class="scrml-error">` template wrap is NOT emitted in this
    // binding's renderOne. Per SPEC line 25204: body REPLACES default.
    // We check that bodyFn is called inside renderOne.
    expect(wiring).toMatch(/const\s+out\s*=\s*bodyFn_[a-zA-Z0-9_]+\s*\(/);
  });

  test("default render path (no body) wraps with `<p class=\"scrml-error\">`", () => {
    const node = errorsNode({ ofPath: "signup.name" });
    const { registry } = runEmit([node]);
    const wiring = runEventWiring(registry);
    expect(wiring).toContain('<p class="scrml-error">');
    // No body-override locals when bodyExpr is absent.
    expect(wiring).not.toMatch(/const\s+bodyFn_/);
  });
});

// ---------------------------------------------------------------------------
// §C11.7 — Multi-level compound nav (§6.3.5)
// ---------------------------------------------------------------------------

describe("C11 §C11.7 — Multi-level compound nav (§6.3.5)", () => {
  test("of=@outer.inner.field treats the leaf as per-field (errors is array)", () => {
    const node = errorsNode({ ofPath: "outer.inner.field" });
    const { registry } = runEmit([node]);
    const errBindings = registry.logicBindings.filter((b) => b.kind === "errors-element");
    expect(errBindings.length).toBe(1);
    expect(errBindings[0].errorsKey).toBe("outer.inner.field");
    expect(errBindings[0].fieldName).toBe("field");
    expect(errBindings[0].isCompoundRollup).toBe(false);
  });

  test("event-wiring uses the full dotted path as the source errors key", () => {
    const node = errorsNode({ ofPath: "outer.inner.field" });
    const { registry } = runEmit([node]);
    const wiring = runEventWiring(registry);
    expect(wiring).toContain('"outer.inner.field.errors"');
  });
});

// ---------------------------------------------------------------------------
// §C11.8 — messageFor integration (with C10 stub fallback)
// ---------------------------------------------------------------------------

describe("C11 §C11.8 — messageFor integration", () => {
  test("event-wiring references _scrml_message_for with stub fallback", () => {
    const node = errorsNode({ ofPath: "signup.name" });
    const { registry } = runEmit([node]);
    const wiring = runEventWiring(registry);
    // Output prefers a globally-defined _scrml_message_for (C10), fallback when undefined.
    expect(wiring).toContain('typeof _scrml_message_for');
    expect(wiring).toContain('_scrml_message_for');
  });

  test("stub fallback preserves SPEC §55.9 tag-shape (returns String(errTag.tag))", () => {
    const node = errorsNode({ ofPath: "signup.name" });
    const { registry } = runEmit([node]);
    const wiring = runEventWiring(registry);
    // Stub: errTag.tag != null → String(errTag.tag); fallback String(errTag).
    expect(wiring).toContain("String(errTag.tag)");
  });

  test("messageForFn is defined per binding (avoids global state pollution)", () => {
    const a = errorsNode({ ofPath: "signup.name" });
    const b = errorsNode({ ofPath: "signup.email" });
    const { registry } = runEmit([a, b]);
    const wiring = runEventWiring(registry);
    // Two bindings → two messageForFn_<suffix> locals.
    const matches = wiring.match(/const\s+messageForFn_/g) ?? [];
    expect(matches.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// §C11.9 — Required `of=` attribute
// ---------------------------------------------------------------------------

describe("C11 §C11.9 — Required `of=` attribute", () => {
  test("emits E-ERRORS-001 when of= is missing", () => {
    const node = errorsNode({ ofPath: undefined });
    const { errors, registry } = runEmit([node]);
    expect(errors.some((e) => e.code === "E-ERRORS-001")).toBe(true);
    // No binding recorded (errorsKey null), but the placeholder span still emitted.
    expect(registry.logicBindings.filter((b) => b.kind === "errors-element").length).toBe(0);
  });

  test("placeholder span emitted even on missing of= (page still renders)", () => {
    const node = errorsNode({ ofPath: undefined });
    const { html } = runEmit([node]);
    expect(html).toMatch(/<span data-scrml-errors-anchor="[^"]+"><\/span>/);
  });
});

// ---------------------------------------------------------------------------
// §C11.10 — Reactive subscription
// ---------------------------------------------------------------------------

describe("C11 §C11.10 — Reactive subscription", () => {
  // ss21 item-5 — the errors anchor drives its render from `_scrml_effect`, NOT
  // a `_scrml_reactive_subscribe` on the source `.errors` key. The source is a
  // DERIVED cell; a subscribe on a derived never fires (`_scrml_reactive_set`
  // fans dirtied derived cells via `_scrml_trigger`/effects only), so the anchor
  // would never reactively clear. `_scrml_effect` auto-tracks the
  // `_scrml_derived_get` read and re-runs on recompute.
  test("drives the render via _scrml_effect (NOT a subscribe on the derived errors key)", () => {
    const node = errorsNode({ ofPath: "signup.name" });
    const { registry } = runEmit([node]);
    const wiring = runEventWiring(registry);
    expect(wiring).toMatch(/_scrml_effect\(function\(\) \{ render_[a-zA-Z0-9_]+\(\); \}\)/);
    // Regression guard: must NOT subscribe to the derived errors cell (the bug).
    expect(wiring).not.toMatch(/_scrml_reactive_subscribe\("signup\.name\.errors"/);
  });

  test("initial render is invoked by the effect's initial run", () => {
    const node = errorsNode({ ofPath: "signup.name" });
    const { registry } = runEmit([node]);
    const wiring = runEventWiring(registry);
    // The effect's initial run IS the first render (no separate pre-call).
    expect(wiring).toMatch(/_scrml_effect\(function\(\) \{ render_[a-zA-Z0-9_]+\(\); \}\)/);
  });

  test("reads source via _scrml_derived_get (lazy pull from C8 derived)", () => {
    const node = errorsNode({ ofPath: "signup.name" });
    const { registry } = runEmit([node]);
    const wiring = runEventWiring(registry);
    expect(wiring).toMatch(/_scrml_derived_get\("signup\.name\.errors"\)/);
  });
});

// ---------------------------------------------------------------------------
// §C11.11 — No-validator field rendering (legal per SPEC line 25209-25210)
// ---------------------------------------------------------------------------

describe("C11 §C11.11 — No-validator field", () => {
  test("emits binding for <errors of=@signup.someUnvalidated/> without diagnostic", () => {
    // C7+C8 emit `errors === []` for any non-validated field. C11's runtime then
    // sees src.length === 0 and writes innerHTML = "" — empty-array path applies
    // unconditionally. The compile-time emission is identical to a validated
    // field (we don't know at codegen time whether the source has validators).
    const node = errorsNode({ ofPath: "signup.someUnvalidated" });
    const { registry, errors } = runEmit([node]);
    expect(errors.filter((e) => e.code === "E-ERRORS-001" || e.code === "E-ERRORS-002")).toEqual([]);
    const errBindings = registry.logicBindings.filter((b) => b.kind === "errors-element");
    expect(errBindings.length).toBe(1);
    expect(errBindings[0].errorsKey).toBe("signup.someUnvalidated");
  });

  test("runtime: empty-errors-array path produces no DOM", () => {
    // The runtime code is uniform — when src is [] (no validators), the
    // empty-array branch sets innerHTML = "" and returns.
    const node = errorsNode({ ofPath: "signup.someUnvalidated" });
    const { registry } = runEmit([node]);
    const wiring = runEventWiring(registry);
    expect(wiring).toMatch(/innerHTML\s*=\s*""/);
  });
});

// ---------------------------------------------------------------------------
// §C11.12 — Wave-3 closure: default render shape (sentinel)
// ---------------------------------------------------------------------------

describe("C11 §C11.12 — Default render shape", () => {
  test("default render emits SPEC §55.8 line 25190 shape: <p class=\"scrml-error\">${ messageFor(errors[0]) }</p>", () => {
    // This sentinel test pins the canonical default render template. Wave 3
    // closes with this shape; future refinements should preserve the
    // structural intent (a class-tagged single-error wrapper).
    const node = errorsNode({ ofPath: "signup.name" });
    const { registry } = runEmit([node]);
    const wiring = runEventWiring(registry);
    expect(wiring).toContain('<p class="scrml-error">');
    // The output is constructed via string concat: prefix + messageForFn(...) + suffix.
    expect(wiring).toMatch(/<p class="scrml-error">[\s\S]*messageForFn_[a-zA-Z0-9_]+[\s\S]*<\/p>/);
  });
});
