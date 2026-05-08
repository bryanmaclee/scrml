/**
 * c1-shape-aware-cell-emit.test.js — A1c Step C1 unit tests
 *
 * Tests the shape-aware state-decl dispatch in `emit-logic.ts case "state-decl"`:
 *
 *   §C1.1  Shape 1 plain — `<count> = 0` reactive-set emission (regression guard)
 *   §C1.2  Shape 2 decl-with-spec — `<userName req> = <input/>` cell+hook (regression guard)
 *   §C1.3  Shape 3 derived plain — `const <doubled> = @count * 2` (covers BOTH structuralForm forms)
 *   §C1.4  Shape 3 markup-typed derived — `const <badge> = <span>${@x}</span>` placeholder + factory shell
 *   §C1.5  Variant C compound — `<formRes><name>=""</></>` parent-proxy + child decls
 *   §C1.6  default= storage — `<x default=null> = Date.now()` _scrml_default_set sidecar
 *   §C1.7  Engine cells SKIP — engine vars are not state-decl AST, so dispatch never fires
 *   §C1.8  S61 11.5 gap closure — Shape 3 V5-strict (structuralForm:true) now derives
 *   §C1.9  Output stability — existing legacy-form derived/plain emission unchanged
 *   §C1.10 Compound child default= per-field qualified-path
 *
 * SCOPE: per A1c BRIEF §1 + Phase 0 SURVEY §11 — covers Shape dispatch, default= storage,
 * compound recursion, markup-typed placeholder. OUT OF SCOPE: bind:* runtime dispatch (C4),
 * render-spec expansion at use-site (C3), full markup-typed factory body + dep-tracking (C2).
 */

import { describe, test, expect } from "bun:test";
import { emitLogicNode } from "../../src/codegen/emit-logic.js";

// Helper — minimal state-decl synthesis used across sections. Mirrors the
// shape ast-builder.js produces for each form (per ast-builder.js:3320-3382 +
// symbol-table.ts:1480-1490 B5 cell-classifier).
function shape1Plain(name, init) {
  return {
    kind: "state-decl",
    name,
    init,
    initExpr: undefined, // tests rely on init-string fallback (Phase 4 path)
    shape: "plain",
    structuralForm: true,
    isConst: false,
    _cellKind: "plain",
    span: { start: 0, end: 0 },
  };
}

function shape3Derived(name, init, { structuralForm = true } = {}) {
  return {
    kind: "state-decl",
    name,
    init,
    initExpr: undefined,
    shape: "derived",
    structuralForm,
    isConst: true,
    _cellKind: "plain",
    span: { start: 0, end: 0 },
  };
}

function compoundParent(name, children, extraFields = {}) {
  return {
    kind: "state-decl",
    name,
    init: "",
    initExpr: null,
    shape: "plain",
    structuralForm: true,
    isConst: false,
    _cellKind: "compound-parent",
    children,
    span: { start: 0, end: 0 },
    ...extraFields,
  };
}

// ---------------------------------------------------------------------------
// §C1.1 Shape 1 plain — regression guard
// ---------------------------------------------------------------------------

describe("C1 §C1.1 — Shape 1 plain regression guard", () => {
  test("emits _scrml_reactive_set for `<count> = 0`", () => {
    const node = shape1Plain("count", "0");
    const result = emitLogicNode(node);
    expect(result).toContain('_scrml_reactive_set("count"');
    expect(result).not.toContain("_scrml_derived_declare");
  });

  test("emits _scrml_reactive_set for legacy `@count = 0` (structuralForm:false)", () => {
    const node = { ...shape1Plain("count", "0"), structuralForm: false };
    const result = emitLogicNode(node);
    expect(result).toContain('_scrml_reactive_set("count"');
    expect(result).not.toContain("_scrml_derived_declare");
  });
});

// ---------------------------------------------------------------------------
// §C1.2 Shape 2 decl-with-spec — regression guard
// (cell declaration only; bind:* dispatch is C4, render-spec expansion is C3)
// ---------------------------------------------------------------------------

describe("C1 §C1.2 — Shape 2 decl-with-spec regression guard", () => {
  test("emits _scrml_reactive_set with default-undefined for `<userName req> = <input/>`", () => {
    const node = {
      kind: "state-decl",
      name: "userName",
      init: "",
      initExpr: undefined,
      shape: "decl-with-spec",
      structuralForm: true,
      isConst: false,
      _cellKind: "bindable",
      _isBindable: true,
      renderSpec: { kind: "render-spec", element: { kind: "markup", tag: "input" } },
      validators: [{ name: "req", args: null, span: { start: 0, end: 0 } }],
      span: { start: 0, end: 0 },
    };
    const result = emitLogicNode(node);
    expect(result).toContain('_scrml_reactive_set("userName"');
    expect(result).not.toContain("_scrml_derived_declare");
  });
});

// ---------------------------------------------------------------------------
// §C1.3 Shape 3 derived plain — V5-strict + legacy
// ---------------------------------------------------------------------------

describe("C1 §C1.3 — Shape 3 derived plain (both structural forms)", () => {
  test("V5-strict `const <doubled> = @count * 2` emits _scrml_derived_declare", () => {
    const node = shape3Derived("doubled", "@count * 2", { structuralForm: true });
    const result = emitLogicNode(node);
    expect(result).toContain('_scrml_derived_declare("doubled"');
    expect(result).toContain('_scrml_derived_subscribe("doubled", "count")');
    expect(result).not.toContain('_scrml_reactive_set("doubled"');
  });

  test("legacy `const @doubled = @count * 2` (structuralForm:false) STILL emits _scrml_derived_declare", () => {
    const node = shape3Derived("doubled", "@count * 2", { structuralForm: false });
    const result = emitLogicNode(node);
    expect(result).toContain('_scrml_derived_declare("doubled"');
    expect(result).toContain('_scrml_derived_subscribe("doubled", "count")');
  });

  test("two-dep derived emits one _scrml_derived_subscribe per unique upstream", () => {
    const node = shape3Derived("total", "@price * @quantity");
    const result = emitLogicNode(node);
    expect(result).toContain('_scrml_derived_subscribe("total", "price")');
    expect(result).toContain('_scrml_derived_subscribe("total", "quantity")');
    const declareCount = (result.match(/_scrml_derived_declare/g) ?? []).length;
    expect(declareCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// §C1.4 Shape 3 markup-typed derived — placeholder + factory shell
// (Per SURVEY §5.2 Option (b): C1 emits the declaration; C2 lifts the shell.)
// ---------------------------------------------------------------------------

describe("C1 §C1.4 — Shape 3 markup-typed derived placeholder", () => {
  test("emits _scrml_derived_declare with factory reference", () => {
    // Per ast-builder.js:3320-3338, markup-typed derived gets shape:"decl-with-spec"
    // with isConst:true and renderSpec set to the markup. B5 stamps _cellKind:"markup-typed".
    const node = {
      kind: "state-decl",
      name: "badge",
      init: "",
      initExpr: null,
      shape: "decl-with-spec",
      structuralForm: true,
      isConst: true,
      _cellKind: "markup-typed",
      renderSpec: { kind: "render-spec", element: { kind: "markup", tag: "span" } },
      span: { start: 0, end: 0 },
    };
    const result = emitLogicNode(node);
    expect(result).toContain('_scrml_derived_declare("badge"');
    expect(result).toContain("_scrml_markup_factory_badge");
  });

  test("emits factory function shell as a function declaration", () => {
    const node = {
      kind: "state-decl",
      name: "badge",
      init: "",
      initExpr: null,
      shape: "decl-with-spec",
      structuralForm: true,
      isConst: true,
      _cellKind: "markup-typed",
      renderSpec: { kind: "render-spec", element: { kind: "markup", tag: "span" } },
      span: { start: 0, end: 0 },
    };
    const result = emitLogicNode(node);
    expect(result).toMatch(/function _scrml_markup_factory_badge\w*\(\)/);
    expect(result).toContain("/* C2:");
    expect(result).toContain("return null;");
  });

  test("does NOT emit _scrml_reactive_set for markup-typed derived (no longer falls through to legacy path)", () => {
    const node = {
      kind: "state-decl",
      name: "badge",
      init: "",
      initExpr: null,
      shape: "decl-with-spec",
      structuralForm: true,
      isConst: true,
      _cellKind: "markup-typed",
      renderSpec: { kind: "render-spec", element: { kind: "markup", tag: "span" } },
      span: { start: 0, end: 0 },
    };
    const result = emitLogicNode(node);
    expect(result).not.toContain('_scrml_reactive_set("badge"');
  });
});

// ---------------------------------------------------------------------------
// §C1.5 Variant C compound — parent proxy + recursive children
// ---------------------------------------------------------------------------

describe("C1 §C1.5 — Variant C compound (parent + children)", () => {
  test("emits parent _scrml_derived_declare with reconstruction closure", () => {
    const node = compoundParent("formRes", [
      shape1Plain("name", '""'),
      shape1Plain("email", '""'),
    ]);
    const result = emitLogicNode(node);
    expect(result).toContain('_scrml_derived_declare("formRes"');
    expect(result).toContain('_scrml_reactive_get("formRes.name")');
    expect(result).toContain('_scrml_reactive_get("formRes.email")');
  });

  test("emits child _scrml_reactive_set with qualified-path keys", () => {
    const node = compoundParent("formRes", [
      shape1Plain("name", '""'),
      shape1Plain("email", '""'),
    ]);
    const result = emitLogicNode(node);
    expect(result).toContain('_scrml_reactive_set("formRes.name"');
    expect(result).toContain('_scrml_reactive_set("formRes.email"');
  });

  test("emits _scrml_derived_subscribe edges from each child to the parent", () => {
    const node = compoundParent("formRes", [
      shape1Plain("name", '""'),
      shape1Plain("email", '""'),
    ]);
    const result = emitLogicNode(node);
    expect(result).toContain('_scrml_derived_subscribe("formRes", "formRes.name")');
    expect(result).toContain('_scrml_derived_subscribe("formRes", "formRes.email")');
  });

  test("emits children BEFORE parent declaration (so children exist on first lazy pull)", () => {
    const node = compoundParent("formRes", [shape1Plain("name", '""')]);
    const result = emitLogicNode(node);
    const childIdx = result.indexOf('_scrml_reactive_set("formRes.name"');
    const parentIdx = result.indexOf('_scrml_derived_declare("formRes"');
    expect(childIdx).toBeGreaterThanOrEqual(0);
    expect(parentIdx).toBeGreaterThanOrEqual(0);
    expect(childIdx).toBeLessThan(parentIdx);
  });

  test("empty compound (`children: []`) emits empty object literal as value", () => {
    const node = compoundParent("emptyCompound", []);
    const result = emitLogicNode(node);
    expect(result).toContain('_scrml_derived_declare("emptyCompound"');
    expect(result).toContain("({})");
  });

  test("nested compound (compound child within compound parent) recurses correctly", () => {
    const inner = compoundParent("inner", [shape1Plain("leaf", "0")]);
    const outer = compoundParent("outer", [inner]);
    const result = emitLogicNode(outer);
    // Inner registered at outer.inner; leaf at outer.inner.leaf.
    expect(result).toContain('_scrml_reactive_set("outer.inner.leaf"');
    expect(result).toContain('_scrml_derived_declare("outer.inner"');
    expect(result).toContain('_scrml_derived_declare("outer"');
    // Outer subscribes to outer.inner; outer.inner subscribes to outer.inner.leaf.
    expect(result).toContain('_scrml_derived_subscribe("outer", "outer.inner")');
    expect(result).toContain('_scrml_derived_subscribe("outer.inner", "outer.inner.leaf")');
  });

  test("compound with derived child (in-compound derived per §6.6.16) routes to derived emitter", () => {
    const node = compoundParent("signup", [
      shape1Plain("first", '""'),
      shape1Plain("last", '""'),
      shape3Derived("displayName", "@signup.first + ' ' + @signup.last"),
    ]);
    const result = emitLogicNode(node);
    // The derived child is registered at qualified path `signup.displayName`.
    expect(result).toContain('_scrml_derived_declare("signup.displayName"');
    // Plus the compound parent itself is also derived.
    expect(result).toContain('_scrml_derived_declare("signup"');
  });
});

// ---------------------------------------------------------------------------
// §C1.6 default= storage sidecar
// ---------------------------------------------------------------------------

describe("C1 §C1.6 — default= storage sidecar", () => {
  test("emits _scrml_default_set alongside Shape 1 plain reactive-set", () => {
    const node = {
      ...shape1Plain("startTime", "Date.now()"),
      defaultExpr: { kind: "lit", litType: "null", raw: "null", span: { start: 0, end: 0 } },
    };
    const result = emitLogicNode(node);
    expect(result).toContain('_scrml_reactive_set("startTime"');
    expect(result).toContain('_scrml_default_set("startTime"');
    // The closure body is the defaultExpr — for `null` literal, just `null`.
    expect(result).toMatch(/_scrml_default_set\("startTime", \(\) => null\)/);
  });

  test("does NOT emit _scrml_default_set when defaultExpr is null/absent", () => {
    const node = shape1Plain("count", "0");
    const result = emitLogicNode(node);
    expect(result).not.toContain("_scrml_default_set");
  });

  test("emits defensive comment for default= on const derived (E-DERIVED-WRITE territory; A1b/B22 should reject upstream)", () => {
    const node = {
      ...shape3Derived("doubled", "@count * 2"),
      defaultExpr: { kind: "lit", litType: "number", raw: "0", span: { start: 0, end: 0 } },
    };
    const result = emitLogicNode(node);
    // Per SURVEY §6.5: a well-formed AST won't reach here because A1b/B22
    // rejects E-DERIVED-WRITE before codegen. Defensive marker fires if it does.
    expect(result).toContain("E-DERIVED-WRITE");
    expect(result).toContain("SHOULD NOT REACH");
  });
});

// ---------------------------------------------------------------------------
// §C1.7 Engine cells SKIP — verify dispatch never fires for engines
// ---------------------------------------------------------------------------

describe("C1 §C1.7 — Engine cells SKIP", () => {
  test("engine cells are NOT state-decl AST nodes, so case never reaches them", () => {
    // Engine cells are declared via `<engine for=Type/>` MARKUP elements
    // (kind:"markup" or kind:"engine-decl"), NOT state-decl AST nodes.
    // The case "state-decl" handler is structurally bypassed for engines.
    // This test asserts the structural invariant — emitting an engine-decl
    // node-shape does not fire any state-decl-emit code.
    //
    // SURVEY §10.6: "naturally satisfied by AST kind discrimination."
    //
    // We test this by passing an engine-decl-like node and confirming
    // emitLogicNode either dispatches elsewhere or returns the legacy fallthrough.
    const engineNode = {
      kind: "engine-decl",
      name: "Phase",
      governedType: "Phase",
      span: { start: 0, end: 0 },
    };
    // emitLogicNode falls through to default case for unknown kinds — returns "".
    // The key invariant: `case "state-decl"` is NOT reached for engine kinds.
    const result = emitLogicNode(engineNode);
    expect(result).not.toContain("_scrml_reactive_set");
    expect(result).not.toContain("_scrml_derived_declare");
  });
});

// ---------------------------------------------------------------------------
// §C1.8 S61 11.5 gap closure — Shape 3 V5-strict now routes to derived
// ---------------------------------------------------------------------------

describe("C1 §C1.8 — S61 11.5 gap closure (Shape 3 V5-strict)", () => {
  test("V5-strict `const <doubled> = @count * 2` emits derived-declare not reactive-set", () => {
    // Pre-C1: structuralForm:true was gated OUT of the derived branch and
    // fell through to the legacy `_scrml_reactive_set` path. Post-C1: both
    // forms route to `_scrml_derived_declare` (S61 11.5 deferred work).
    const node = {
      kind: "state-decl",
      name: "doubled",
      init: "@count * 2",
      shape: "derived",
      isConst: true,
      structuralForm: true, // V5-strict — was the broken path pre-C1
      _cellKind: "plain",
      span: { start: 0, end: 0 },
    };
    const result = emitLogicNode(node);
    expect(result).toContain('_scrml_derived_declare("doubled"');
    expect(result).toContain('_scrml_derived_subscribe("doubled", "count")');
    // Critical regression guard: must NOT emit the legacy reactive-set for derived.
    expect(result).not.toContain('_scrml_reactive_set("doubled"');
  });
});

// ---------------------------------------------------------------------------
// §C1.9 Output-stability — existing legacy emission unchanged
// ---------------------------------------------------------------------------

describe("C1 §C1.9 — Output stability (existing emission preserved)", () => {
  test("legacy `@count = 0` (Shape 1, structuralForm:false) still emits reactive-set", () => {
    const node = {
      kind: "state-decl",
      name: "count",
      init: "0",
      shape: "plain",
      structuralForm: false,
      isConst: false,
      _cellKind: "plain",
      span: { start: 0, end: 0 },
    };
    const result = emitLogicNode(node);
    expect(result).toContain('_scrml_reactive_set("count"');
    expect(result).not.toContain("_scrml_derived_declare");
    expect(result).not.toContain("_scrml_default_set");
  });

  test("legacy derived `const @total = @price * @quantity` (structuralForm:false) emits derived-declare (pre-existing behavior)", () => {
    const node = {
      kind: "state-decl",
      name: "total",
      init: "@price * @quantity",
      shape: "derived",
      isConst: true,
      structuralForm: false, // legacy form — was already routed correctly
      _cellKind: "plain",
      span: { start: 0, end: 0 },
    };
    const result = emitLogicNode(node);
    expect(result).toContain('_scrml_derived_declare("total"');
  });
});

// ---------------------------------------------------------------------------
// §C1.10 Compound-child default= per-field qualified path
// ---------------------------------------------------------------------------

describe("C1 §C1.10 — Compound-child default= qualified-path storage", () => {
  test("default= on a compound child stores under <parent>.<child> key", () => {
    const node = compoundParent("signup", [
      {
        ...shape1Plain("name", '""'),
        defaultExpr: { kind: "lit", litType: "string", raw: '""', span: { start: 0, end: 0 } },
      },
    ]);
    const result = emitLogicNode(node);
    // Child decl registers at qualified path; default= sidecar uses the same key.
    expect(result).toContain('_scrml_reactive_set("signup.name"');
    expect(result).toContain('_scrml_default_set("signup.name"');
  });

  test("default= on the parent itself stores at the parent qualified path", () => {
    // SPEC §6.8.2 says reset() recurses into children; a parent-level default=
    // is structurally allowed but unusual. Test stores correctly when present.
    const node = compoundParent(
      "form",
      [shape1Plain("name", '""')],
      { defaultExpr: { kind: "lit", litType: "null", raw: "null", span: { start: 0, end: 0 } } },
    );
    const result = emitLogicNode(node);
    expect(result).toContain('_scrml_default_set("form"');
  });
});
