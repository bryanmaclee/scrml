/**
 * derived-machines.test.js — S22 §51.9 (I): derived / projection machines.
 *
 * Slice 1 (type-system): parses `< machine name=UI for=UIMode derived=@order>`,
 * registers the derived machine with isDerived/sourceVar/projectedVarName,
 * and validates exhaustiveness over the source enum's variants
 * (E-ENGINE-018). Runtime codegen lands in a follow-up slice — these tests
 * exercise the parser + validator directly.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  buildMachineRegistry,
  buildTypeRegistry,
  validateDerivedMachines,
  rejectWritesToDerivedVars,
} from "../../../src/type-system.js";
import {
  emitProjectionFunction,
  emitDerivedDeclaration,
} from "../../../src/codegen/emit-machines.ts";
import { compileScrml } from "../../../src/api.js";
import { SCRML_RUNTIME } from "../../../src/runtime-template.js";

const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/derived-machines");
const FIXTURE_OUTPUT = join(FIXTURE_DIR, "dist");

beforeAll(() => { mkdirSync(FIXTURE_DIR, { recursive: true }); });
afterAll(() => { rmSync(FIXTURE_DIR, { recursive: true, force: true }); });

function compileSource(source, filename = "test.scrml") {
  const filePath = resolve(join(FIXTURE_DIR, filename));
  writeFileSync(filePath, source);
  const result = compileScrml({ inputFiles: [filePath], outputDir: FIXTURE_OUTPUT, write: true });
  // api.js splits diagnostics into `result.errors` (fatal-grade) and
  // `result.warnings` (warning-severity, including E-DG-002). Surface both.
  const fatalErrors = result.errors || [];
  const warnings = result.warnings || [];
  // Backward compat: pre-v024-3 `errors` was the union; some assertions
  // pattern-match on that. Keep the union as `errors`.
  const allErrors = [...fatalErrors, ...warnings];
  const outPath = join(FIXTURE_OUTPUT, filename.replace(/\.scrml$/, ".client.js"));
  const clientJs = existsSync(outPath) ? readFileSync(outPath, "utf8") : "";
  return { errors: allErrors, fatalErrors, warnings, clientJs };
}

function span() {
  return { file: "test.scrml", start: 0, end: 0, line: 1, col: 1 };
}

function makeTypeDecl(name, kind, raw) {
  return { kind: "type-decl", name, typeKind: kind, raw, span: span() };
}

function makeMachineDecl(engineName, governedType, rulesRaw, sourceVar = null) {
  return { kind: "engine-decl", engineName, governedType, rulesRaw, sourceVar, span: span() };
}

// Shared: a source machine + a projection enum used across the tests.
const ORDER_ENUM = makeTypeDecl("OrderState", "enum",
  "{ Draft\nSubmitted\nPaid\nShipping\nDelivered\nCancelled\nRefunded }");
const UIMODE_ENUM = makeTypeDecl("UIMode", "enum", "{ Editable\nReadOnly\nTerminal }");

describe("§51.9 slice 1 — derived-machine registration", () => {
  test("registers a derived machine with isDerived/sourceVar/projectedVarName", () => {
    const typeRegistry = buildTypeRegistry([ORDER_ENUM, UIMODE_ENUM], [], span());
    const orderMachine = makeMachineDecl("OrderMachine", "OrderState",
      ".Draft => .Submitted\n.Submitted => .Paid\n.Paid => .Shipping\n" +
      ".Shipping => .Delivered\n.Draft => .Cancelled\n.Paid => .Refunded",
    );
    const uiMachine = makeMachineDecl("UI", "UIMode",
      ".Draft => .Editable\n" +
      ".Submitted | .Paid | .Shipping => .ReadOnly\n" +
      ".Delivered | .Cancelled | .Refunded => .Terminal",
      "order",
    );
    const errors = [];
    const registry = buildMachineRegistry([orderMachine, uiMachine], typeRegistry, errors, span());
    expect(errors).toEqual([]);
    const ui = registry.get("UI");
    expect(ui).toBeDefined();
    expect(ui.isDerived).toBe(true);
    expect(ui.sourceVar).toBe("order");
    expect(ui.projectedVarName).toBe("ui");
    // Rules were expanded via | alternation: 1 + 3 + 3 = 7 projection rules.
    expect(ui.rules).toHaveLength(7);
    // Each rule RHS resolves to a single projection variant.
    expect(ui.rules.every(r => ["Editable", "ReadOnly", "Terminal"].includes(r.to))).toBe(true);
  });

  test("non-derived machines keep isDerived absent (falsy)", () => {
    const typeRegistry = buildTypeRegistry([ORDER_ENUM], [], span());
    const m = makeMachineDecl("OrderMachine", "OrderState", ".Draft => .Submitted");
    const errors = [];
    const registry = buildMachineRegistry([m], typeRegistry, errors, span());
    expect(errors).toEqual([]);
    expect(registry.get("OrderMachine").isDerived).toBeFalsy();
  });

  test("LHS variant names on projection rules are NOT validated against the projection enum", () => {
    // `.Draft` is a variant of OrderState (the source), not UIMode. The
    // projection rule's LHS refers to source variants; we must not flag it as
    // an unknown UIMode variant.
    const typeRegistry = buildTypeRegistry([ORDER_ENUM, UIMODE_ENUM], [], span());
    const uiMachine = makeMachineDecl("UI", "UIMode",
      ".Draft => .Editable\n" +
      ".Submitted | .Paid | .Shipping => .ReadOnly\n" +
      ".Delivered | .Cancelled | .Refunded => .Terminal",
      "order",
    );
    const errors = [];
    buildMachineRegistry([uiMachine], typeRegistry, errors, span());
    // Only the source-var resolution error (no '@order' reactive in this
    // stripped test) should appear — not an E-ENGINE-004 on `.Draft` etc.
    for (const e of errors) {
      expect(e.message).not.toContain(".Draft");
      expect(e.message).not.toContain(".Submitted");
    }
  });

  test("RHS variant names ARE validated against the projection enum (E-ENGINE-004)", () => {
    const typeRegistry = buildTypeRegistry([ORDER_ENUM, UIMODE_ENUM], [], span());
    const uiMachine = makeMachineDecl("UI", "UIMode",
      ".Draft => .Bogus",  // Bogus isn't a UIMode variant
      "order",
    );
    const errors = [];
    buildMachineRegistry([uiMachine], typeRegistry, errors, span());
    const e = errors.find(e => e.code === "E-ENGINE-004" && e.message.includes("Bogus"));
    expect(e).toBeDefined();
  });
});

describe("§51.9 slice 1 — validateDerivedMachines (exhaustiveness + source resolution)", () => {
  test("E-ENGINE-018: missing source-enum variant", () => {
    const typeRegistry = buildTypeRegistry([ORDER_ENUM, UIMODE_ENUM], [], span());
    const orderMachine = makeMachineDecl("OrderMachine", "OrderState",
      ".Draft => .Submitted",
    );
    // UI machine DOES NOT cover Refunded.
    const uiMachine = makeMachineDecl("UI", "UIMode",
      ".Draft => .Editable\n" +
      ".Submitted | .Paid | .Shipping => .ReadOnly\n" +
      ".Delivered | .Cancelled => .Terminal",
      "order",
    );
    const errors = [];
    const registry = buildMachineRegistry([orderMachine, uiMachine], typeRegistry, errors, span());

    // Simulate the post-annotation step: reactive `@order: OrderMachine = ...`.
    const reactiveBindings = new Map([["order", registry.get("OrderMachine")]]);
    validateDerivedMachines(registry, reactiveBindings, errors, span());

    const e = errors.find(e => e.code === "E-ENGINE-018");
    expect(e).toBeDefined();
    expect(e.message).toContain("Refunded");
    expect(e.message).toContain("OrderState");
  });

  test("Fully exhaustive derived machine passes with no errors", () => {
    const typeRegistry = buildTypeRegistry([ORDER_ENUM, UIMODE_ENUM], [], span());
    const orderMachine = makeMachineDecl("OrderMachine", "OrderState", ".Draft => .Submitted");
    const uiMachine = makeMachineDecl("UI", "UIMode",
      ".Draft => .Editable\n" +
      ".Submitted | .Paid | .Shipping => .ReadOnly\n" +
      ".Delivered | .Cancelled | .Refunded => .Terminal",
      "order",
    );
    const errors = [];
    const registry = buildMachineRegistry([orderMachine, uiMachine], typeRegistry, errors, span());
    const reactiveBindings = new Map([["order", registry.get("OrderMachine")]]);
    validateDerivedMachines(registry, reactiveBindings, errors, span());
    expect(errors.filter(e => e.code === "E-ENGINE-018")).toHaveLength(0);
  });

  test("E-ENGINE-004: source-var not bound to a machine", () => {
    const typeRegistry = buildTypeRegistry([ORDER_ENUM, UIMODE_ENUM], [], span());
    const uiMachine = makeMachineDecl("UI", "UIMode", ".Draft => .Editable", "order");
    const errors = [];
    const registry = buildMachineRegistry([uiMachine], typeRegistry, errors, span());
    // Empty reactiveBindings — `@order` does not exist in scope.
    validateDerivedMachines(registry, new Map(), errors, span());
    const e = errors.find(e => e.code === "E-ENGINE-004" && e.message.includes("source variable"));
    expect(e).toBeDefined();
    expect(e.message).toContain("@order");
  });

  test("E-ENGINE-004: transitive projection (deferred per §51.9.7)", () => {
    const typeRegistry = buildTypeRegistry([ORDER_ENUM, UIMODE_ENUM], [], span());
    const orderMachine = makeMachineDecl("OrderMachine", "OrderState", ".Draft => .Submitted");
    // First projection: from @order.
    const uiMachine = makeMachineDecl("UI", "UIMode",
      ".Draft => .Editable\n" +
      ".Submitted | .Paid | .Shipping => .ReadOnly\n" +
      ".Delivered | .Cancelled | .Refunded => .Terminal",
      "order",
    );
    // Second projection: from @ui — transitive, not supported.
    const stageEnum = makeTypeDecl("Stage", "enum", "{ Active\nDone }");
    const stageMachine = makeMachineDecl("Stage", "Stage",
      ".Editable => .Active\n.ReadOnly | .Terminal => .Done",
      "ui",
    );

    const errors = [];
    const registry = buildMachineRegistry(
      [orderMachine, uiMachine, stageMachine],
      buildTypeRegistry([ORDER_ENUM, UIMODE_ENUM, stageEnum], [], span()),
      errors, span(),
    );
    const reactiveBindings = new Map([
      ["order", registry.get("OrderMachine")],
      ["ui", registry.get("UI")],
    ]);
    validateDerivedMachines(registry, reactiveBindings, errors, span());
    const e = errors.find(e =>
      e.code === "E-ENGINE-004" && e.message.includes("transitive") || e.message.includes("Transitive")
    );
    expect(e).toBeDefined();
  });

  test("guarded projection rules are NOT counted for exhaustiveness (needs unguarded sibling)", () => {
    // .Paid can be either .ReadOnly (if isAdmin) or .Editable (else).
    // Without a final unguarded rule for .Paid, coverage is incomplete.
    const typeRegistry = buildTypeRegistry([ORDER_ENUM, UIMODE_ENUM], [], span());
    const orderMachine = makeMachineDecl("OrderMachine", "OrderState", ".Draft => .Submitted");
    const uiMachine = makeMachineDecl("UI", "UIMode",
      ".Draft => .Editable\n" +
      ".Submitted => .ReadOnly\n" +
      ".Paid given (isAdmin) => .Editable\n" + // guarded — doesn't fully cover .Paid
      ".Shipping => .ReadOnly\n" +
      ".Delivered | .Cancelled | .Refunded => .Terminal",
      "order",
    );
    const errors = [];
    const registry = buildMachineRegistry([orderMachine, uiMachine], typeRegistry, errors, span());
    const reactiveBindings = new Map([["order", registry.get("OrderMachine")]]);
    validateDerivedMachines(registry, reactiveBindings, errors, span());
    // Either E-ENGINE-018 on .Paid (preferred) — or we accept the rule as total
    // (implementation may later prove a guard is exhaustive; for now require
    // the unguarded sibling).
    const e = errors.find(e => e.code === "E-ENGINE-018" && e.message.includes("Paid"));
    expect(e).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// §51.9 slice 2 — codegen (projection function + derived registration)
// ---------------------------------------------------------------------------

function makeDerivedMachine(overrides = {}) {
  return {
    name: "UI",
    governedTypeName: "UIMode",
    sourceVar: "order",
    projectedVarName: "ui",
    rules: [
      { from: "Draft", to: "Editable", guard: null, label: null, effectBody: null, fromBindings: null, toBindings: null },
      { from: "Submitted", to: "ReadOnly", guard: null, label: null, effectBody: null, fromBindings: null, toBindings: null },
      { from: "Paid", to: "ReadOnly", guard: null, label: null, effectBody: null, fromBindings: null, toBindings: null },
      { from: "Shipping", to: "ReadOnly", guard: null, label: null, effectBody: null, fromBindings: null, toBindings: null },
      { from: "Delivered", to: "Terminal", guard: null, label: null, effectBody: null, fromBindings: null, toBindings: null },
      { from: "Cancelled", to: "Terminal", guard: null, label: null, effectBody: null, fromBindings: null, toBindings: null },
      { from: "Refunded", to: "Terminal", guard: null, label: null, effectBody: null, fromBindings: null, toBindings: null },
    ],
    ...overrides,
  };
}

describe("§51.9 slice 2 — emitProjectionFunction", () => {
  test("emits a function that dispatches on src.variant and returns destination strings", () => {
    const lines = emitProjectionFunction(makeDerivedMachine());
    const code = lines.join("\n");
    expect(code).toContain("function _scrml_project_UI(src) {");
    expect(code).toContain('var tag = (src != null && typeof src === "object") ? src.variant : src;');
    expect(code).toContain('if (tag === "Draft") return "Editable";');
    expect(code).toContain('if (tag === "Refunded") return "Terminal";');
    // S93 — defensive fallthrough returns `null` (canonical scrml absence
    // per M-7C-D-12) rather than bare `undefined` keyword (W-CG-UNDEFINED-
    // INTERPOLATION leak in compiled output).
    expect(code).toContain("return null;");
    // Execute the function and check runtime behavior.
    const project = new Function(code + "\nreturn _scrml_project_UI;")();
    expect(project("Draft")).toBe("Editable");
    expect(project("Paid")).toBe("ReadOnly");
    expect(project("Refunded")).toBe("Terminal");
    expect(project({ variant: "Delivered", data: {} })).toBe("Terminal");
    // S93 — defensive fallthrough returns null (canonical absence per
    // M-7C-D-12), not undefined.
    expect(project("Unknown")).toBeNull();
  });

  test("guarded rules become `if (tag === X && (guard)) return Y;`", () => {
    const machine = makeDerivedMachine({
      rules: [
        { from: "Paid", to: "Editable", guard: "isAdmin", label: null, effectBody: null, fromBindings: null, toBindings: null },
        { from: "Paid", to: "ReadOnly", guard: null, label: null, effectBody: null, fromBindings: null, toBindings: null },
      ],
    });
    const code = emitProjectionFunction(machine).join("\n");
    expect(code).toContain('if (tag === "Paid" && (isAdmin)) return "Editable";');
    expect(code).toContain('if (tag === "Paid") return "ReadOnly";');
    // The guarded rule must appear BEFORE the unguarded one (top-to-bottom).
    expect(code.indexOf("Editable")).toBeLessThan(code.indexOf("ReadOnly"));
  });
});

describe("§51.9 slice 2 — emitDerivedDeclaration", () => {
  test("registers the projected var in _scrml_derived_fns and subscribes to source dirty-propagation", () => {
    const lines = emitDerivedDeclaration(makeDerivedMachine());
    const code = lines.join("\n");
    expect(code).toContain('_scrml_derived_fns["ui"] = function() { return _scrml_project_UI(_scrml_reactive_get("order")); };');
    expect(code).toContain('_scrml_derived_dirty["ui"] = true;');
    expect(code).toContain('_scrml_derived_downstreams["order"]');
    expect(code).toContain('.add("ui")');
  });

  test("runtime round-trip: writing @order updates @ui through the dirty-propagation chain", () => {
    const projFn = emitProjectionFunction(makeDerivedMachine()).join("\n");
    const decl = emitDerivedDeclaration(makeDerivedMachine()).join("\n");
    // Minimal runtime stubs, matching the real ones' shape.
    const stubs = `
      var _scrml_state = {};
      var _scrml_derived_fns = {};
      var _scrml_derived_cache = {};
      var _scrml_derived_dirty = {};
      var _scrml_derived_downstreams = {};
      function _scrml_reactive_get(name) {
        if (_scrml_derived_fns[name]) return _scrml_derived_get(name);
        return _scrml_state[name];
      }
      function _scrml_derived_get(name) {
        if (_scrml_derived_dirty[name] || !(name in _scrml_derived_cache)) {
          _scrml_derived_cache[name] = _scrml_derived_fns[name]();
          _scrml_derived_dirty[name] = false;
        }
        return _scrml_derived_cache[name];
      }
      function _scrml_reactive_set(name, value) {
        _scrml_state[name] = value;
        var ds = _scrml_derived_downstreams[name];
        if (ds) for (var d of ds) _scrml_derived_dirty[d] = true;
      }
    `;
    const harness = stubs + projFn + "\n" + decl + `
      _scrml_reactive_set("order", "Draft");
      var a = _scrml_reactive_get("ui");
      _scrml_reactive_set("order", "Paid");
      var b = _scrml_reactive_get("ui");
      _scrml_reactive_set("order", "Refunded");
      var c = _scrml_reactive_get("ui");
      return [a, b, c];
    `;
    const result = new Function(harness)();
    expect(result).toEqual(["Editable", "ReadOnly", "Terminal"]);
  });
});

describe("§51.9 slice 2 — E-ENGINE-017 reject writes to projected vars", () => {
  test("state-decl of a projected var name fires E-ENGINE-017", () => {
    const projectedVars = new Map([["ui", makeDerivedMachine()]]);
    const errors = [];
    const nodes = [{ kind: "state-decl", name: "ui", span: span() }];
    rejectWritesToDerivedVars(nodes, projectedVars, errors, span());
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe("E-ENGINE-017");
    expect(errors[0].message).toContain("'@ui'");
    expect(errors[0].message).toContain("'@order'");
    expect(errors[0].message).toContain("< machine UI>");
  });

  test("bare-expr `@ui = X` inside a function body fires E-ENGINE-017", () => {
    const projectedVars = new Map([["ui", makeDerivedMachine()]]);
    const errors = [];
    const nodes = [
      {
        kind: "function-decl",
        name: "setMode",
        body: [{ kind: "bare-expr", expr: "@ui = 1", span: span() }],
        span: span(),
      },
    ];
    rejectWritesToDerivedVars(nodes, projectedVars, errors, span());
    const e = errors.find(e => e.code === "E-ENGINE-017");
    expect(e).toBeDefined();
  });

  test("bare-expr `@ui += X` fires E-ENGINE-017 (compound assignment)", () => {
    const projectedVars = new Map([["ui", makeDerivedMachine()]]);
    const errors = [];
    const nodes = [{ kind: "bare-expr", expr: "@ui += 1", span: span() }];
    rejectWritesToDerivedVars(nodes, projectedVars, errors, span());
    expect(errors.find(e => e.code === "E-ENGINE-017")).toBeDefined();
  });

  test("writes to non-projected reactives are unaffected", () => {
    const projectedVars = new Map([["ui", makeDerivedMachine()]]);
    const errors = [];
    const nodes = [
      { kind: "state-decl", name: "order", span: span() },
      { kind: "bare-expr", expr: "@order = 1", span: span() },
    ];
    rejectWritesToDerivedVars(nodes, projectedVars, errors, span());
    expect(errors).toEqual([]);
  });
});

describe("§51.9 slice 2 — end-to-end compilation", () => {
  test("full file compiles and emits projection function + derived registration", () => {
    const source = `\${\n  type OrderState:enum = { Draft, Submitted, Paid, Shipping, Delivered, Cancelled, Refunded }\n  type UIMode:enum = { Editable, ReadOnly, Terminal }\n\n  @order: OrderMachine = OrderState.Draft\n}\n\n< machine name=OrderMachine for=OrderState>\n    .Draft => .Submitted\n</>\n\n< machine name=UI for=UIMode derived=@order>\n    .Draft => .Editable\n    .Submitted | .Paid | .Shipping => .ReadOnly\n    .Delivered | .Cancelled | .Refunded => .Terminal\n</>\n\n<program>\n    <p>ok</>\n</>\n`;
    const { fatalErrors, clientJs } = compileSource(source, "end-to-end.scrml");
    expect(fatalErrors).toEqual([]);
    expect(clientJs).toContain("function _scrml_project_UI(src)");
    expect(clientJs).toContain('_scrml_derived_fns["ui"]');
    expect(clientJs).toContain('_scrml_derived_downstreams["order"]');
    // Transition table should NOT be emitted for derived machines.
    expect(clientJs).not.toContain("__scrml_transitions_UI");
  });

  test("E-ENGINE-017: assigning `@ui = X` inside a function is rejected end-to-end", () => {
    // Two ${ } blocks so the pre-existing BPP statement-boundary quirk on
    // consecutive machine-typed state-decls doesn't drop nodes before our
    // checker sees them. The function-body assignment to @ui is the case we
    // actually care about — the user attempting to write through the
    // projected var from user code.
    const source = `\${\n  type OrderState:enum = { Draft, Submitted }\n  type UIMode:enum = { Editable, ReadOnly }\n  @order: OrderMachine = OrderState.Draft\n}\n\n\${\n  function badWrite() { @ui = "Editable" }\n}\n\n< machine name=OrderMachine for=OrderState>\n    .Draft => .Submitted\n</>\n\n< machine name=UI for=UIMode derived=@order>\n    .Draft => .Editable\n    .Submitted => .ReadOnly\n</>\n\n<program><p>ok</></>\n`;
    const { errors } = compileSource(source, "write-rejected.scrml");
    const e = errors.find(e => e.code === "E-ENGINE-017");
    expect(e).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// §51.9 follow-up — DOM read-wiring for ${@ui} in markup
// ---------------------------------------------------------------------------
//
// Regression guard for the S23 fix: before this fix, ${@ui} in markup compiled
// to a placeholder <span> but no _scrml_effect wrapper, so writing @order did
// not update the DOM. The cause was that collectReactiveVarNames didn't
// include projected var names, which filtered @ui out of the logic binding's
// reactiveRefs set, which made emit-event-wiring skip effect emission.
//
// This test loads the compiled file into happy-dom, drives @order transitions,
// and asserts the DOM text reflects the projected value after each write.
describe("§51.9 follow-up — DOM read-wiring for projected vars", () => {
  test("compile emits _scrml_effect for ${@ui} and suppresses E-DG-002 on @order", () => {
    const source = [
      "${",
      "  type OrderState:enum = { Draft, Submitted, Paid, Shipping, Delivered, Cancelled, Refunded }",
      "  type UIMode:enum = { Editable, ReadOnly, Terminal }",
      "  @order: OrderMachine = OrderState.Draft",
      "}",
      "",
      "< machine name=OrderMachine for=OrderState>",
      "  .Draft => .Submitted",
      "  .Submitted => .Paid",
      "  .Paid => .Shipping",
      "  .Shipping => .Delivered",
      "  .Draft => .Cancelled",
      "  .Paid => .Refunded",
      "</>",
      "",
      "< machine name=UI for=UIMode derived=@order>",
      "  .Draft => .Editable",
      "  .Submitted | .Paid | .Shipping => .ReadOnly",
      "  .Delivered | .Cancelled | .Refunded => .Terminal",
      "</>",
      "",
      "<program>",
      "  <p>Mode: ${@ui}</>",
      "</>",
      "",
    ].join("\n");
    const { fatalErrors, errors, clientJs } = compileSource(source, "dom-wiring.scrml");
    expect(fatalErrors).toEqual([]);
    // The derived-fn wiring is present (regression guard from slice 2).
    expect(clientJs).toContain('_scrml_derived_fns["ui"]');
    // The reactive display effect for ${@ui} MUST be emitted — the whole fix.
    // markup-value-in-expression-2026-06-17: the display routes through the
    // node-aware `_scrml_render_value(el, expr)` helper (was `el.textContent =`).
    expect(clientJs).toContain("_scrml_render_value(el, _scrml_reactive_get(\"ui\"))");
    expect(clientJs).toMatch(/_scrml_effect\(function\(\)\s*\{\s*_scrml_render_value\(el,\s*_scrml_reactive_get\("ui"\)\)/);
    // No false-positive E-DG-002 on @order.
    const falseDg = errors.find(e => e.code === "E-DG-002" && /@order/.test(e.message));
    expect(falseDg).toBeUndefined();
    // v024-3 regression — no false-positive E-DG-002 on the PROJECTED var @ui
    // either. Pre-fix, `creditReader` redirected reads of @ui to @order only,
    // leaving @ui with zero credited readers; the unused-reactive sweep then
    // false-fired E-DG-002 on @ui despite `${@ui}` being read in markup.
    const falseDgProjected = errors.find(e => e.code === "E-DG-002" && /@ui/.test(e.message));
    expect(falseDgProjected).toBeUndefined();
  });

  test("happy-dom: writing @order updates ${@ui} text content", () => {
    if (!globalThis.document) GlobalRegistrator.register();

    const source = [
      "${",
      "  type OrderState:enum = { Draft, Submitted, Paid, Shipping, Delivered, Cancelled, Refunded }",
      "  type UIMode:enum = { Editable, ReadOnly, Terminal }",
      "  @order: OrderMachine = OrderState.Draft",
      "}",
      "",
      "< machine name=OrderMachine for=OrderState>",
      "  .Draft => .Submitted",
      "  .Submitted => .Paid",
      "  .Paid => .Shipping",
      "  .Shipping => .Delivered",
      "  .Draft => .Cancelled",
      "  .Paid => .Refunded",
      "</>",
      "",
      "< machine name=UI for=UIMode derived=@order>",
      "  .Draft => .Editable",
      "  .Submitted | .Paid | .Shipping => .ReadOnly",
      "  .Delivered | .Cancelled | .Refunded => .Terminal",
      "</>",
      "",
      "<program>",
      "  <p id=\"mode\">Mode: ${@ui}</>",
      "</>",
      "",
    ].join("\n");

    const filename = "dom-wiring-runtime.scrml";
    const filePath = resolve(join(FIXTURE_DIR, filename));
    writeFileSync(filePath, source);
    const result = compileScrml({ inputFiles: [filePath], outputDir: FIXTURE_OUTPUT, write: true });
    const fatal = (result.errors || []).filter(e => e.severity !== "warning");
    expect(fatal).toEqual([]);

    const htmlPath = join(FIXTURE_OUTPUT, filename.replace(/\.scrml$/, ".html"));
    const jsPath = join(FIXTURE_OUTPUT, filename.replace(/\.scrml$/, ".client.js"));
    expect(existsSync(htmlPath)).toBe(true);
    expect(existsSync(jsPath)).toBe(true);

    const htmlContent = readFileSync(htmlPath, "utf-8");
    const clientJs = readFileSync(jsPath, "utf-8");
    const bodyMatch = htmlContent.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    const bodyHtml = bodyMatch ? bodyMatch[1] : htmlContent;
    const cleanHtml = bodyHtml.replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();

    document.body.innerHTML = cleanHtml;

    const code = `(function() {\n${SCRML_RUNTIME}\n${clientJs}\n` +
      `window._scrml_reactive_get = _scrml_reactive_get;\n` +
      `window._scrml_reactive_set = _scrml_reactive_set;\n` +
      `})();`;
    eval(code);
    document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));

    const p = document.getElementById("mode");
    expect(p).not.toBeNull();
    // Initial: @order=Draft → @ui=Editable
    expect(p.textContent).toContain("Editable");

    // Drive the source machine through transitions. The write goes through
    // the runtime's machine-guarded _scrml_reactive_set path; _scrml_propagate_dirty
    // marks @ui dirty; _scrml_trigger fires the effect tracking @order, which
    // re-evaluates _scrml_reactive_get("ui") → _scrml_derived_get("ui") → fresh
    // projection → DOM text update.
    window._scrml_reactive_set("order", "Submitted");
    expect(p.textContent).toContain("ReadOnly");

    window._scrml_reactive_set("order", "Paid");
    expect(p.textContent).toContain("ReadOnly");

    window._scrml_reactive_set("order", "Refunded");
    expect(p.textContent).toContain("Terminal");

    window._scrml_reactive_set("order", "Draft");
    expect(p.textContent).toContain("Editable");
  });
});
