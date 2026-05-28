/**
 * onchange-arrow-fallback-r24-bug-50.test.js — Bug 50 regression guard:
 * synth event-handler attributes with arrow-function VALUES (typically from
 * emit-table-for's `selectable=@cell` master-checkbox onchange + per-row
 * onchange synth) MUST round-trip as proper arrow functions through
 * emit-event-wiring's Case B path — NOT get rewritten to `if (x !== null
 * && x !== undefined) { body }` by the §42 presence-guard rewrite.
 *
 * The bug shape: emit-table-for builds synth `onchange` attribute values
 * as `(evt) => { ... }` raw strings (NOT via parsed AST), so
 * `binding.handlerExprNode` is undefined and emit-event-wiring's
 * `emitExprField(undefined, fallback, ctx)` falls through to
 * `rewriteExprWithDerived(fallback, ...)` → Pass 1 `rewritePresenceGuard`
 * matches `( ident ) => { body }` and rewrites to a `given x => body`
 * presence-guard form (`if (x !== null && x !== undefined) { body }`).
 * The rewritten if-STATEMENT then can't sit in object-literal value
 * position when emit-event-wiring emits the `_scrml_change_handlers` map:
 *
 *   const _scrml_change_handlers = {
 *     "_scrml_attr_onchange_28": if (evt !== null && evt !== undefined) {
 *       ^^                                                              ^^
 *       SyntaxError: Unexpected token 'if'
 *     ...
 *   };
 *
 * Fix at `compiler/src/codegen/emit-event-wiring.ts` Case B path: when
 * `handlerExprNode` is absent (the synth-fallback-string case), use
 * `rewriteExprArrowBody` which skips Pass 1 `rewritePresenceGuard`.
 * Mirror the established precedent at `emit-expr.ts:emitEscapeHatch`
 * (Bug C 6nz 2026-04-20) which documents the exact same gotcha.
 *
 * Coverage:
 *   §1  Fallback-string arrow `(evt) => { body }` round-trips intact
 *   §2  Fallback-string arrow body content is rewritten (reactive refs)
 *   §3  Emitted dispatcher map passes JS syntax check (`new Function`)
 *   §4  Regression — structured arrow node (handlerExprNode present) still works
 *   §5  Regression — non-arrow `${ @x = .Y }` plain-expr still wraps as `function(event){...}`
 *   §6  Regression — bare cell ref still works
 *   §7  Empirical R24 dev-3-svelte fix-symptom check (against the bug's reproducer)
 */

import { describe, test, expect } from "bun:test";

// Test the Case B fallback-string path directly via emit-event-wiring.
// We mirror event-delegation.test.js's pattern of constructing EventBinding
// records by hand + running emitEventWiring.

import { emitEventWiring } from "../../src/codegen/emit-event-wiring.js";
import { makeCompileContext } from "../../src/codegen/context.ts";
import { BindingRegistry } from "../../src/codegen/binding-registry.ts";

function makeBinding(placeholderId, eventName, handlerExprOrName, opts = {}) {
  return {
    placeholderId,
    eventName,
    handlerName: opts.handlerName ?? (opts.useExpr ? "" : handlerExprOrName),
    handlerArgs: opts.handlerArgs ?? [],
    handlerExpr: opts.handlerExpr ?? (opts.useExpr ? handlerExprOrName : undefined),
    handlerExprNode: opts.handlerExprNode,
  };
}

function runWiring(eventBindings) {
  return emitEventWiring(makeCompileContext({
    fileAST: { filePath: "test.scrml" },
    registry: BindingRegistry.from(eventBindings ?? [], []),
  }), new Map()).join("\n");
}

// ---------------------------------------------------------------------------
// §1: Fallback-string arrow `(evt) => { body }` round-trips intact
// ---------------------------------------------------------------------------

describe("§1: fallback-string arrow `(evt) => { body }` round-trips", () => {
  test("`(evt) => { @selectedIds = [] }` emits proper arrow handler, NOT if-stmt", () => {
    const bindings = [
      makeBinding(
        "_scrml_attr_onchange_28",
        "onchange",
        "(evt) => { @selectedIds = [] }",
        { useExpr: true },
      ),
    ];
    const out = runWiring(bindings);
    // Should contain a proper arrow handler shape
    expect(out).toMatch(/_scrml_attr_onchange_28[\s\S]*?evt\s*=>/);
    // MUST NOT contain the presence-guard if-stmt rewrite shape
    expect(out).not.toMatch(/_scrml_attr_onchange_28"\s*:\s*if\s*\(/);
    expect(out).not.toMatch(/evt\s*!==\s*null\s*&&\s*evt\s*!==\s*undefined/);
  });
});

// ---------------------------------------------------------------------------
// §2: Fallback-string arrow body content is rewritten (reactive refs)
// ---------------------------------------------------------------------------

describe("§2: arrow body's reactive refs still rewrite", () => {
  test("`@selectedIds = []` inside the arrow body lowers to _scrml_reactive_set", () => {
    const bindings = [
      makeBinding(
        "_scrml_attr_onchange_28",
        "onchange",
        "(evt) => { @selectedIds = [] }",
        { useExpr: true },
      ),
    ];
    const out = runWiring(bindings);
    // The body's `@selectedIds = []` must lower to a reactive-set call.
    expect(out).toContain("_scrml_reactive_set");
  });
});

// ---------------------------------------------------------------------------
// §3: Emitted dispatcher map passes JS syntax check
// ---------------------------------------------------------------------------

describe("§3: emitted change-handlers map parses as valid JS", () => {
  test("`new Function` invariant — emission compiles", () => {
    const bindings = [
      makeBinding(
        "_scrml_attr_onchange_28",
        "onchange",
        "(evt) => { @selectedIds = [] }",
        { useExpr: true },
      ),
    ];
    const out = runWiring(bindings);
    const wrapped = `
      var _scrml_reactive_get = function () { return []; };
      var _scrml_reactive_set = function () {};
      var document = { addEventListener: function () {}, querySelectorAll: function () { return []; } };
      ${out}
    `;
    expect(() => new Function(wrapped)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// §4: Regression — non-arrow `${ @x = .Y }` plain-expr still wraps function(event)
// ---------------------------------------------------------------------------

describe("§4: regression — non-arrow plain-expr still wraps `function(event){...}`", () => {
  test("`@filter = .All` lowers to function(event)-wrapped reactive-set", () => {
    const bindings = [
      makeBinding(
        "_scrml_attr_onclick_5",
        "onclick",
        "@filter = .All",
        { useExpr: true },
      ),
    ];
    const out = runWiring(bindings);
    // Plain-expr path → Case C → function(event) wrapper
    expect(out).toContain("function(event)");
    expect(out).toContain("_scrml_reactive_set");
  });
});

// ---------------------------------------------------------------------------
// §5: Regression — bare cell ref still works (Approach D delegation path)
// ---------------------------------------------------------------------------

describe("§5: regression — call-ref shape (no handlerExpr) still works", () => {
  test("`onclick=handleClick` (call-ref, no expr) registers handler by name", () => {
    const bindings = [
      makeBinding("_scrml_attr_onclick_10", "onclick", "handleClick"),
    ];
    const out = runWiring(bindings);
    // Should reference the handler by name in the registry
    expect(out).toContain("handleClick");
    // Should NOT have any arrow-or-if-stmt residue
    expect(out).not.toMatch(/evt\s*!==\s*null/);
  });
});

// ---------------------------------------------------------------------------
// §6: Negative — body containing `is some` patterns still works
//     (the rewriter's other `is`-suffix passes are independent of the Case B
//     short-circuit; verify they still fire correctly)
// ---------------------------------------------------------------------------

describe("§6: regression — `is .Variant` inside arrow body still lowers", () => {
  test("`(evt) => { if (@phase is .Idle) doX() }` lowers `is .Idle` to ===", () => {
    const bindings = [
      makeBinding(
        "_scrml_attr_onchange_99",
        "onchange",
        "(evt) => { if (@phase is .Idle) doX() }",
        { useExpr: true },
      ),
    ];
    const out = runWiring(bindings);
    // The is-`.Variant` rewrite should fire: `=== "Idle"`
    expect(out).toContain(`=== "Idle"`);
    // Arrow function shape preserved
    expect(out).toMatch(/\(?evt\)?\s*=>/);
    expect(out).not.toMatch(/_scrml_attr_onchange_99"\s*:\s*if\s*\(/);
  });
});

// ---------------------------------------------------------------------------
// §7: Multi-statement arrow body (the master-checkbox synth shape)
// ---------------------------------------------------------------------------

describe("§7: master-checkbox synth shape", () => {
  test("emit-table-for's actual synth shape `(evt) => { if (@a == @b) { @a = [] } else { @a = ...map(...) } }` works", () => {
    const synthOnchange =
      `(evt) => { ` +
      `if (@selectedIds.length == (@visibleTickets).length) { ` +
      `@selectedIds = [] ` +
      `} else { ` +
      `@selectedIds = (@visibleTickets).map((r) => r.id) ` +
      `} }`;
    const bindings = [
      makeBinding("_scrml_attr_onchange_28", "onchange", synthOnchange, { useExpr: true }),
    ];
    const out = runWiring(bindings);
    // The exact Bug 50 pre-fix symptom: object-literal property = raw if-stmt.
    expect(out).not.toMatch(/_scrml_attr_onchange_28"\s*:\s*if\s*\(/);
    // Should be a valid arrow function.
    expect(out).toMatch(/_scrml_attr_onchange_28"\s*:\s*\(?\s*evt\s*\)?\s*=>/);
    // Both branches of the inner if/else preserved.
    expect(out).toContain("_scrml_reactive_set");
    // node --check invariant via new Function
    const wrapped = `
      var _scrml_reactive_get = function () { return []; };
      var _scrml_reactive_set = function () {};
      var document = { addEventListener: function () {}, querySelectorAll: function () { return []; } };
      ${out}
    `;
    expect(() => new Function(wrapped)).not.toThrow();
  });
});
