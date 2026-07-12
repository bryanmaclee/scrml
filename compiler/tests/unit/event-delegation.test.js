/**
 * emit-event-wiring.js — Event Delegation (Approach D) Unit Tests
 *
 * Tests for the hybrid delegation pattern: Approach D for delegable events
 * (click, submit) and Approach A for non-delegable events (focus, blur,
 * scroll, change, input, mouseenter, mouseleave, etc.).
 *
 * Coverage:
 *   §1  Single click handler — delegation path (document.addEventListener)
 *   §2  Multiple handlers same delegable event type — one delegated listener
 *   §3  Mixed event types — delegation vs querySelectorAll per type
 *   §4  Empty event bindings — returns empty array (early exit)
 *   §5  Server-escalated handler — fnNameMap resolved name used in registry
 *   §6  Submit with preventDefault — event.preventDefault() in handler body
 *   §7  Handler registry keys are JSON-stringified placeholder IDs
 *   §8  Handler arguments — string literal, number literal, variable-ref
 *   §9  Attribute selector in ancestor walk uses data-scrml-bind-<eventName>
 *   §10 Reactive display wiring unchanged — still uses per-element querySelector
 *   §11 Delegable events use document.addEventListener (not querySelectorAll)
 *   §12 Non-delegable events still use querySelectorAll
 *   §13 Mixed page — delegable + non-delegable events together
 *   §14 Registry variable name for delegation (_scrml_click, not _scrml_click_handlers)
 *   §15 Ancestor walk is present in delegated listener
 *   §16 Raw-string args (splitArgs format) — regression coverage for real AST shape
 *   §17 fn() in handlerExpr — no double-wrap, body correctly rewritten
 */

import { describe, test, expect } from "bun:test";
import { emitEventWiring } from "../../src/codegen/emit-event-wiring.js";
import { makeCompileContext } from "../../src/codegen/context.ts";
import { BindingRegistry } from "../../src/codegen/binding-registry.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal eventBinding entry */
function makeBinding(placeholderId, eventName, handlerName, handlerArgs = []) {
  return { placeholderId, eventName, handlerName, handlerArgs };
}

/** Build a binding with a raw handlerExpr (e.g. from onclick=${...}) */
function makeExprBinding(placeholderId, eventName, handlerExpr) {
  return { placeholderId, eventName, handlerName: "", handlerArgs: [], handlerExpr };
}

/** Run emitEventWiring and join the result lines for assertion */
function run(eventBindings, logicBindings = [], fnNameMap = new Map()) {
  return emitEventWiring(makeCompileContext({
    fileAST: { filePath: "test.scrml" },
    registry: BindingRegistry.from(eventBindings ?? [], logicBindings ?? []),
  }), fnNameMap).join("\n");
}

// ---------------------------------------------------------------------------
// §1: Single click handler — delegation path
// ---------------------------------------------------------------------------

describe("§1: single click handler", () => {
  test("emits a handler registry with one entry", () => {
    const out = run([
      makeBinding("_scrml_attr_onclick_10", "onclick", "handleClick"),
    ]);

    expect(out).toContain("_scrml_click");
    expect(out).toContain('"_scrml_attr_onclick_10"');
    // S96 Bug 14 — SPEC §5.2.2: bare-call `fn()` emits `fn()` in wrapper body;
    // wrapper still takes `event` for the listener signature.
    expect(out).toContain("handleClick();");
  });

  test("emits document.addEventListener for click (not querySelectorAll)", () => {
    const out = run([
      makeBinding("_scrml_attr_onclick_10", "onclick", "handleClick"),
    ]);

    expect(out).toContain('document.addEventListener("click"');
    expect(out).not.toContain("document.querySelectorAll('[data-scrml-bind-onclick]')");
  });

  test("does NOT emit document.querySelector with a specific ID", () => {
    const out = run([
      makeBinding("_scrml_attr_onclick_10", "onclick", "handleClick"),
    ]);

    // The old per-element pattern — should be gone
    expect(out).not.toContain('document.querySelector(\'[data-scrml-bind-onclick="_scrml_attr_onclick_10"]\'');
  });

  test("uses getAttribute in ancestor walk to look up handler in registry", () => {
    const out = run([
      makeBinding("_scrml_attr_onclick_10", "onclick", "handleClick"),
    ]);

    expect(out).toContain('t.getAttribute("data-scrml-bind-onclick")');
    expect(out).toContain("_scrml_click[id]");
  });

  test("delegated listener dispatches handler and returns", () => {
    const out = run([
      makeBinding("_scrml_attr_onclick_10", "onclick", "handleClick"),
    ]);

    expect(out).toContain("_scrml_click[id](event); return;");
  });
});

// ---------------------------------------------------------------------------
// §2: Multiple handlers same delegable event type — one delegated listener
// ---------------------------------------------------------------------------

describe("§2: multiple handlers same delegable event type", () => {
  test("all handlers go into the same registry", () => {
    const out = run([
      makeBinding("_scrml_attr_onclick_10", "onclick", "pressDigit", [{ kind: "string-literal", value: "1" }]),
      makeBinding("_scrml_attr_onclick_11", "onclick", "pressDigit", [{ kind: "string-literal", value: "2" }]),
      makeBinding("_scrml_attr_onclick_12", "onclick", "pressDigit", [{ kind: "string-literal", value: "3" }]),
    ]);

    expect(out).toContain('"_scrml_attr_onclick_10"');
    expect(out).toContain('"_scrml_attr_onclick_11"');
    expect(out).toContain('"_scrml_attr_onclick_12"');
  });

  test("only ONE document.addEventListener for multiple click handlers", () => {
    const out = run([
      makeBinding("_scrml_attr_onclick_10", "onclick", "pressDigit", [{ kind: "string-literal", value: "1" }]),
      makeBinding("_scrml_attr_onclick_11", "onclick", "pressDigit", [{ kind: "string-literal", value: "2" }]),
    ]);

    const listenerMatches = out.match(/document\.addEventListener\("click"/g);
    expect(listenerMatches).toHaveLength(1);
  });

  test("argument values differ per registry entry", () => {
    const out = run([
      makeBinding("_scrml_attr_onclick_10", "onclick", "pressDigit", [{ kind: "string-literal", value: "7" }]),
      makeBinding("_scrml_attr_onclick_11", "onclick", "pressDigit", [{ kind: "string-literal", value: "8" }]),
    ]);

    expect(out).toContain('pressDigit("7")');
    expect(out).toContain('pressDigit("8")');
  });
});

// ---------------------------------------------------------------------------
// §3: Mixed event types — delegation vs querySelectorAll per type
// ---------------------------------------------------------------------------

describe("§3: mixed event types", () => {
  test("click and submit get separate registries", () => {
    const out = run([
      makeBinding("_scrml_attr_onclick_10", "onclick", "handleClick"),
      makeBinding("_scrml_attr_onsubmit_20", "onsubmit", "handleSubmit"),
    ]);

    expect(out).toContain("_scrml_click");
    expect(out).toContain("_scrml_submit");
  });

  test("click and submit get separate document.addEventListener calls", () => {
    const out = run([
      makeBinding("_scrml_attr_onclick_10", "onclick", "handleClick"),
      makeBinding("_scrml_attr_onsubmit_20", "onsubmit", "handleSubmit"),
    ]);

    expect(out).toContain('document.addEventListener("click"');
    expect(out).toContain('document.addEventListener("submit"');
    // Neither should use querySelectorAll
    expect(out).not.toContain("querySelectorAll('[data-scrml-bind-onclick]')");
    expect(out).not.toContain("querySelectorAll('[data-scrml-bind-onsubmit]')");
  });

  test("click delegates but change still uses querySelectorAll", () => {
    const out = run([
      makeBinding("_scrml_attr_onclick_10", "onclick", "handleClick"),
      makeBinding("_scrml_attr_onchange_30", "onchange", "handleChange"),
    ]);

    // click: delegation
    expect(out).toContain('document.addEventListener("click"');
    expect(out).not.toContain("querySelectorAll('[data-scrml-bind-onclick]')");

    // change: Approach A
    expect(out).toContain("_scrml_change_handlers");
    expect(out).toContain("querySelectorAll('[data-scrml-bind-onchange]')");
  });
});

// ---------------------------------------------------------------------------
// §4: Empty event bindings — returns empty array (early exit)
// ---------------------------------------------------------------------------

describe("§4: empty event bindings", () => {
  test("null eventBindings returns empty array", () => {
    const result = emitEventWiring(makeCompileContext({
      fileAST: { filePath: "test.scrml" },
      registry: BindingRegistry.from([], []),
    }), new Map());
    expect(result).toEqual([]);
  });

  test("empty array returns empty array", () => {
    const result = emitEventWiring(makeCompileContext({
      fileAST: { filePath: "test.scrml" },
      registry: BindingRegistry.from([], []),
    }), new Map());
    expect(result).toEqual([]);
  });

  test("undefined eventBindings returns empty array", () => {
    const result = emitEventWiring(makeCompileContext({
      fileAST: { filePath: "test.scrml" },
      registry: BindingRegistry.from([], []),
    }), new Map());
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §5: Server-escalated handler — fnNameMap resolved name used in registry
// ---------------------------------------------------------------------------

describe("§5: server-escalated handler name resolution", () => {
  test("fnNameMap resolved name appears in the registry entry", () => {
    const fnNameMap = new Map([["saveData", "_scrml_saveData_42"]]);
    const out = run(
      [makeBinding("_scrml_attr_onclick_10", "onclick", "saveData")],
      [],
      fnNameMap
    );

    // S96 Bug 14 — SPEC §5.2.2: server-escalated bare-call still emits `fn()`
    // in wrapper body (no event auto-thread).
    expect(out).toContain("_scrml_saveData_42();");
    expect(out).not.toContain("saveData(event)");
    expect(out).not.toContain("_scrml_saveData_42(event)");
  });

  test("original name used as fallback when not in fnNameMap", () => {
    const fnNameMap = new Map(); // empty
    const out = run(
      [makeBinding("_scrml_attr_onclick_10", "onclick", "handleClick")],
      [],
      fnNameMap
    );

    expect(out).toContain("handleClick();");
  });
});

// ---------------------------------------------------------------------------
// §6: Submit with preventDefault
// ---------------------------------------------------------------------------

describe("§6: submit event with preventDefault", () => {
  test("submit registry entry includes event.preventDefault()", () => {
    const out = run([
      makeBinding("_scrml_attr_onsubmit_20", "onsubmit", "handleSubmit"),
    ]);

    expect(out).toContain("event.preventDefault()");
    // S96 Bug 14 — SPEC §5.2.2: submit bare-call emits `handleSubmit()` in
    // wrapper body. The auto-injected preventDefault() before the call runs
    // in the wrapper, not as an arg to the user's fn.
    expect(out).toContain("handleSubmit();");
  });

  test("click handler does NOT include event.preventDefault()", () => {
    const out = run([
      makeBinding("_scrml_attr_onclick_10", "onclick", "handleClick"),
    ]);

    expect(out).not.toContain("event.preventDefault()");
  });
});

// ---------------------------------------------------------------------------
// §7: Handler registry keys are JSON-stringified placeholder IDs
// ---------------------------------------------------------------------------

describe("§7: handler registry key format", () => {
  test("registry key is a JSON string (double-quoted)", () => {
    const out = run([
      makeBinding("_scrml_attr_onclick_118", "onclick", "pressDigit", [{ kind: "string-literal", value: "7" }]),
    ]);

    // Key must appear as a JSON-quoted string in the registry literal
    expect(out).toContain('"_scrml_attr_onclick_118": function(event)');
  });
});

// ---------------------------------------------------------------------------
// §8: Handler arguments — string literal, number literal, variable-ref
// ---------------------------------------------------------------------------

describe("§8: handler argument serialization", () => {
  test("string-literal arg is JSON-encoded", () => {
    const out = run([
      makeBinding("_scrml_attr_onclick_10", "onclick", "doThing", [{ kind: "string-literal", value: "hello" }]),
    ]);
    expect(out).toContain('doThing("hello")');
  });

  test("number-literal arg is a bare number", () => {
    const out = run([
      makeBinding("_scrml_attr_onclick_10", "onclick", "doThing", [{ kind: "number-literal", value: 42 }]),
    ]);
    expect(out).toContain("doThing(42)");
  });

  test("variable-ref arg becomes _scrml_reactive_get call", () => {
    const out = run([
      makeBinding("_scrml_attr_onclick_10", "onclick", "doThing", [{ kind: "variable-ref", name: "@counter" }]),
    ]);
    expect(out).toContain('doThing(_scrml_reactive_get("counter"))');
  });

  test("string expression arg (raw) passes through rewriteExpr", () => {
    const out = run([
      makeBinding("_scrml_attr_onclick_10", "onclick", "doThing", ["someVar"]),
    ]);
    expect(out).toContain("doThing(someVar)");
  });

  test("multiple args are comma-separated", () => {
    const out = run([
      makeBinding("_scrml_attr_onclick_10", "onclick", "doThing", [
        { kind: "string-literal", value: "a" },
        { kind: "number-literal", value: 1 },
      ]),
    ]);
    expect(out).toContain('doThing("a", 1)');
  });
});

// ---------------------------------------------------------------------------
// §9: getAttribute selector in ancestor walk uses correct attribute name
// ---------------------------------------------------------------------------

describe("§9: attribute name in ancestor walk", () => {
  test("onclick walk uses getAttribute(\"data-scrml-bind-onclick\")", () => {
    const out = run([
      makeBinding("_scrml_attr_onclick_10", "onclick", "handleClick"),
    ]);
    expect(out).toContain('"data-scrml-bind-onclick"');
    // Does NOT use a specific ID inside getAttribute
    expect(out).not.toContain('"data-scrml-bind-onclick="_scrml_attr_onclick_10"');
  });

  test("onsubmit walk uses getAttribute(\"data-scrml-bind-onsubmit\")", () => {
    const out = run([
      makeBinding("_scrml_attr_onsubmit_20", "onsubmit", "handleSubmit"),
    ]);
    expect(out).toContain('"data-scrml-bind-onsubmit"');
  });
});

// ---------------------------------------------------------------------------
// §10: Reactive display wiring unchanged — still per-element querySelector
// ---------------------------------------------------------------------------

describe("§10: reactive display wiring unchanged", () => {
  test("logicBinding with reactive refs still emits querySelector (not qSA)", () => {
    const result = emitEventWiring(makeCompileContext({
      fileAST: { filePath: "test.scrml" },
      registry: BindingRegistry.from(
        [makeBinding("_scrml_attr_onclick_10", "onclick", "handleClick")],
        [
          {
            placeholderId: "_scrml_logic_50",
            expr: "@counter",
            reactiveRefs: new Set(["counter"]),
          },
        ]
      ),
    }), new Map());
    const out = result.join("\n");

    // Reactive display still uses per-element querySelector (navigate-wave1b:
    // wired inside `_scrml_nav_rewire(root)`, so `(root || document)`-scoped —
    // NOT batch querySelectorAll).
    expect(out).toContain('.querySelector(\'[data-scrml-logic="_scrml_logic_50"]\'');
    expect(out).not.toContain('querySelectorAll(\'[data-scrml-logic="_scrml_logic_50"]\'');
    // Event wiring uses delegation for click
    expect(out).toContain('document.addEventListener("click"');
  });

  test("conditional display still uses per-element querySelector", () => {
    const result = emitEventWiring(makeCompileContext({
      fileAST: { filePath: "test.scrml" },
      registry: BindingRegistry.from(
        [makeBinding("_scrml_attr_onclick_10", "onclick", "handleClick")],
        [
          {
            placeholderId: "_scrml_if_60",
            expr: "@visible",
            isConditionalDisplay: true,
            varName: "visible",
          },
        ]
      ),
    }), new Map());
    const out = result.join("\n");

    expect(out).toContain('document.querySelector(\'[data-scrml-bind-if="_scrml_if_60"]\'');
  });
});

// ---------------------------------------------------------------------------
// §11: Delegable events use document.addEventListener (not querySelectorAll)
// ---------------------------------------------------------------------------

describe("§11: delegable events use document.addEventListener", () => {
  test("click emits document.addEventListener(\"click\", ...)", () => {
    const out = run([
      makeBinding("_scrml_attr_onclick_10", "onclick", "handleClick"),
    ]);
    expect(out).toContain('document.addEventListener("click"');
  });

  test("submit emits document.addEventListener(\"submit\", ...)", () => {
    const out = run([
      makeBinding("_scrml_attr_onsubmit_20", "onsubmit", "handleSubmit"),
    ]);
    expect(out).toContain('document.addEventListener("submit"');
  });

  test("click does NOT use querySelectorAll", () => {
    const out = run([
      makeBinding("_scrml_attr_onclick_10", "onclick", "handleClick"),
    ]);
    expect(out).not.toContain("querySelectorAll('[data-scrml-bind-onclick]')");
  });

  test("submit does NOT use querySelectorAll", () => {
    const out = run([
      makeBinding("_scrml_attr_onsubmit_20", "onsubmit", "handleSubmit"),
    ]);
    expect(out).not.toContain("querySelectorAll('[data-scrml-bind-onsubmit]')");
  });

  test("multiple click handlers produce exactly one document.addEventListener", () => {
    const out = run([
      makeBinding("_scrml_attr_onclick_10", "onclick", "doA"),
      makeBinding("_scrml_attr_onclick_11", "onclick", "doB"),
      makeBinding("_scrml_attr_onclick_12", "onclick", "doC"),
    ]);
    const matches = out.match(/document\.addEventListener\("click"/g);
    expect(matches).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// §12: Non-delegable events still use querySelectorAll
// ---------------------------------------------------------------------------

describe("§12: non-delegable events use querySelectorAll", () => {
  test("onchange uses querySelectorAll (Approach A)", () => {
    const out = run([
      makeBinding("_scrml_attr_onchange_10", "onchange", "handleChange"),
    ]);
    expect(out).toContain("_scrml_change_handlers");
    expect(out).toContain("querySelectorAll('[data-scrml-bind-onchange]')");
    expect(out).not.toContain('document.addEventListener("change"');
  });

  test("onfocus uses querySelectorAll (Approach A)", () => {
    const out = run([
      makeBinding("_scrml_attr_onfocus_10", "onfocus", "handleFocus"),
    ]);
    expect(out).toContain("_scrml_focus_handlers");
    expect(out).toContain("querySelectorAll('[data-scrml-bind-onfocus]')");
    expect(out).not.toContain('document.addEventListener("focus"');
  });

  test("onblur uses querySelectorAll (Approach A)", () => {
    const out = run([
      makeBinding("_scrml_attr_onblur_10", "onblur", "handleBlur"),
    ]);
    expect(out).toContain("_scrml_blur_handlers");
    expect(out).toContain("querySelectorAll('[data-scrml-bind-onblur]')");
    expect(out).not.toContain('document.addEventListener("blur"');
  });
});

// ---------------------------------------------------------------------------
// §13: Mixed page — delegable + non-delegable events together
// ---------------------------------------------------------------------------

describe("§13: mixed page — delegable + non-delegable", () => {
  test("onclick delegates, onchange uses querySelectorAll", () => {
    const out = run([
      makeBinding("_scrml_attr_onclick_10", "onclick", "handleClick"),
      makeBinding("_scrml_attr_onchange_20", "onchange", "handleChange"),
    ]);

    // click → delegation
    expect(out).toContain('document.addEventListener("click"');
    expect(out).not.toContain("querySelectorAll('[data-scrml-bind-onclick]')");

    // change → Approach A
    expect(out).toContain("_scrml_change_handlers");
    expect(out).toContain("querySelectorAll('[data-scrml-bind-onchange]')");
  });

  test("onsubmit delegates, onfocus uses querySelectorAll", () => {
    const out = run([
      makeBinding("_scrml_attr_onsubmit_10", "onsubmit", "handleSubmit"),
      makeBinding("_scrml_attr_onfocus_20", "onfocus", "handleFocus"),
    ]);

    // submit → delegation
    expect(out).toContain('document.addEventListener("submit"');
    expect(out).not.toContain("querySelectorAll('[data-scrml-bind-onsubmit]')");

    // focus → Approach A
    expect(out).toContain("_scrml_focus_handlers");
    expect(out).toContain("querySelectorAll('[data-scrml-bind-onfocus]')");
  });

  test("onclick and onblur both present — click delegates, blur uses querySelectorAll", () => {
    const out = run([
      makeBinding("_scrml_attr_onclick_10", "onclick", "save"),
      makeBinding("_scrml_attr_onblur_20", "onblur", "validate"),
    ]);

    expect(out).toContain('document.addEventListener("click"');
    expect(out).toContain("_scrml_blur_handlers");
    expect(out).toContain("querySelectorAll('[data-scrml-bind-onblur]')");
  });
});

// ---------------------------------------------------------------------------
// §14: Registry variable name for delegation
// ---------------------------------------------------------------------------

describe("§14: registry variable name for delegated events", () => {
  test("click registry uses _scrml_click (not _scrml_click_handlers)", () => {
    const out = run([
      makeBinding("_scrml_attr_onclick_10", "onclick", "handleClick"),
    ]);
    // Delegation path uses _scrml_click
    expect(out).toContain("const _scrml_click = {");
    // Should NOT use the Approach A naming convention
    expect(out).not.toContain("const _scrml_click_handlers");
  });

  test("submit registry uses _scrml_submit (not _scrml_submit_handlers)", () => {
    const out = run([
      makeBinding("_scrml_attr_onsubmit_20", "onsubmit", "handleSubmit"),
    ]);
    expect(out).toContain("const _scrml_submit = {");
    expect(out).not.toContain("const _scrml_submit_handlers");
  });

  test("non-delegable change still uses _scrml_change_handlers", () => {
    const out = run([
      makeBinding("_scrml_attr_onchange_10", "onchange", "handleChange"),
    ]);
    expect(out).toContain("const _scrml_change_handlers = {");
  });
});

// ---------------------------------------------------------------------------
// §15: Ancestor walk is present in delegated listener
// ---------------------------------------------------------------------------

describe("§15: ancestor walk in delegated listener", () => {
  test("click listener contains while loop walking to document", () => {
    const out = run([
      makeBinding("_scrml_attr_onclick_10", "onclick", "handleClick"),
    ]);
    expect(out).toContain("while (t && t !== document)");
  });

  test("click listener walks parentElement", () => {
    const out = run([
      makeBinding("_scrml_attr_onclick_10", "onclick", "handleClick"),
    ]);
    expect(out).toContain("t = t.parentElement");
  });

  test("submit listener also contains while loop", () => {
    const out = run([
      makeBinding("_scrml_attr_onsubmit_20", "onsubmit", "handleSubmit"),
    ]);
    expect(out).toContain("while (t && t !== document)");
    expect(out).toContain("t = t.parentElement");
  });

  test("walk starts at event.target", () => {
    const out = run([
      makeBinding("_scrml_attr_onclick_10", "onclick", "handleClick"),
    ]);
    expect(out).toContain("let t = event.target");
  });
});

// ---------------------------------------------------------------------------
// §16: Raw-string args (splitArgs format) — regression coverage for real AST shape
//
// Context: ast-builder.js parseAttributes() calls splitArgs() on the raw content
// between parentheses in onclick=fn(...). The result is an array of raw strings,
// NOT structured objects. For example:
//   onclick=fn("apple")  → handlerArgs: ['"apple"']   (raw string with quotes)
//   onclick=fn(@counter) → handlerArgs: ['@counter']  (raw string with @ sigil)
//   onclick=fn(item.id, "action") → handlerArgs: ['item.id', '"action"']
//   onclick=fn()         → handlerArgs: []             (empty — zero args)
//
// These tests verify that the raw-string path through emit-event-wiring.js
// preserves args correctly. The §8 tests above use structured objects which are
// a supported format but NOT what the real parser produces.
// ---------------------------------------------------------------------------

describe("§16: raw-string args from splitArgs — real AST shape regression", () => {
  test("onclick=fn(\"hello\") — raw string arg with quotes preserved", () => {
    // splitArgs('"hello"') returns ['"hello"'] — the quotes are part of the string
    const out = run([
      makeBinding("_scrml_attr_onclick_10", "onclick", "selectItem", ['"hello"']),
    ]);
    expect(out).toContain('selectItem("hello")');
    expect(out).not.toContain("selectItem()");
  });

  test("onclick=fn(\"apple\") — string literal arg not dropped", () => {
    const out = run([
      makeBinding("_scrml_attr_onclick_10", "onclick", "selectItem", ['"apple"']),
    ]);
    // The arg must be present in the emitted function call
    expect(out).toContain('selectItem("apple")');
  });

  test("onclick=fn(@counter) — reactive variable ref preserved via rewriteExpr", () => {
    // splitArgs('@counter') returns ['@counter'] — raw @-prefixed identifier
    // rewriteExpr('@counter') → '_scrml_reactive_get("counter")'
    const out = run([
      makeBinding("_scrml_attr_onclick_10", "onclick", "doThing", ["@counter"]),
    ]);
    expect(out).toContain('doThing(_scrml_reactive_get("counter"))');
    expect(out).not.toContain("doThing()");
  });

  test("onclick=fn(item.id, \"action\") — multiple raw-string args preserved", () => {
    // splitArgs('item.id, "action"') returns ['item.id', '"action"']
    const out = run([
      makeBinding("_scrml_attr_onclick_10", "onclick", "handleAction", ["item.id", '"action"']),
    ]);
    expect(out).toContain('handleAction(item.id, "action")');
    expect(out).not.toContain("handleAction()");
  });

  test("onclick=fn() — no args wraps as fn() inside event handler (SPEC §5.2.2)", () => {
    // splitArgs('') with empty rawArgs → argList = [] (early exit in ast-builder).
    // S96 Bug 14 — SPEC §5.2.2 normative: `onclick=fn()` SHALL emit
    // `function(event) { fn(); }`. The escape-hatch for handlers needing the
    // event is `onclick=${(e) => fn(e)}`. Pre-S96 the impl auto-threaded event
    // citing tutorial §1.5 (non-normative); reverted per pa.md Rule 4.
    const out = run([
      makeBinding("_scrml_attr_onclick_10", "onclick", "doThing", []),
    ]);
    expect(out).toContain("doThing();");
    expect(out).not.toContain("doThing(event)");
  });

  test("raw-string arg with reactive ref inside delegated handler", () => {
    // Verify that @var inside a raw-string arg gets rewritten in the delegation path
    const out = run([
      makeBinding("_scrml_attr_onclick_10", "onclick", "remove", ["@userId"]),
    ]);
    // Should appear in the _scrml_click registry entry, not as a bare @userId
    expect(out).toContain('remove(_scrml_reactive_get("userId"))');
    expect(out).not.toContain("remove(@userId)");
  });

  test("raw-string arg with reactive ref inside non-delegable handler", () => {
    // Same arg rewrite must work for Approach A (querySelectorAll) path
    const out = run([
      makeBinding("_scrml_attr_onchange_10", "onchange", "onChange", ["@value"]),
    ]);
    expect(out).toContain('onChange(_scrml_reactive_get("value"))');
    expect(out).not.toContain("onChange(@value)");
  });

  test("multiple click handlers with distinct raw-string args each get correct arg", () => {
    // Regression: each handler entry must use its own arg, not a shared argsStr
    const out = run([
      makeBinding("_scrml_attr_onclick_10", "onclick", "select", ['"apple"']),
      makeBinding("_scrml_attr_onclick_11", "onclick", "select", ['"banana"']),
      makeBinding("_scrml_attr_onclick_12", "onclick", "select", ['"cherry"']),
    ]);
    expect(out).toContain('select("apple")');
    expect(out).toContain('select("banana")');
    expect(out).toContain('select("cherry")');
  });

  test("raw-string arg passes through without modification for plain identifiers", () => {
    // onclick=fn(userId) → splitArgs('userId') → ['userId']
    // rewriteExpr('userId') → 'userId' (no @ prefix, no transformation)
    const out = run([
      makeBinding("_scrml_attr_onclick_10", "onclick", "doThing", ["userId"]),
    ]);
    expect(out).toContain("doThing(userId)");
  });
});

// ---------------------------------------------------------------------------
// §17: fn() in handlerExpr — no double-wrap, body correctly rewritten
//
// Bug: onclick=${fn() { @color = "black" }} produced:
//   function(event) { function() { @color = "black" }; }
// The inner unnamed function declaration is a JS syntax error.
//
// Fix: parseFnExpression() detects the fn() form, extracts body, rewrites it
// with rewriteBlockBody (so @var = expr becomes _scrml_reactive_set), and
// constructs function(params) { rewritten_body } directly.
// ---------------------------------------------------------------------------

describe("§17: fn() handlerExpr — no double function wrapping", () => {
  test("fn() { @color = 'black' } — no double-wrap, reactive set emitted", () => {
    const out = run([
      makeExprBinding("_scrml_attr_onclick_2", "onclick", 'fn() { @color = "black" }'),
    ]);
    // Must NOT produce nested function declarations
    expect(out).not.toContain("function(event) { function()");
    // Must produce a single function with the reactive set inside
    expect(out).toContain('_scrml_reactive_set("color", "black")');
    // The outer wrapper must be function(), not function(event)
    expect(out).toContain('"_scrml_attr_onclick_2": function() {');
  });

  test("fn() with multiple reactive assignments — all rewritten", () => {
    const out = run([
      makeExprBinding("_scrml_attr_onclick_3", "onclick", 'fn() { @x = 1; @y = 2 }'),
    ]);
    expect(out).toContain('_scrml_reactive_set("x", 1)');
    expect(out).toContain('_scrml_reactive_set("y", 2)');
    expect(out).not.toContain("function(event) { function()");
  });

  test("fn() with params — params preserved in output", () => {
    const out = run([
      makeExprBinding("_scrml_attr_onclick_4", "onclick", 'fn(e) { @x = e.value }'),
    ]);
    // Parameters must be preserved
    expect(out).toContain("function(e)");
    expect(out).not.toContain("function(event) { function(");
  });

  test("plain expression still wraps in function(event)", () => {
    const out = run([
      makeExprBinding("_scrml_attr_onclick_5", "onclick", "doSomething()"),
    ]);
    expect(out).toContain("function(event) { doSomething();");
  });

  test("arrow function used directly without outer wrapper", () => {
    const out = run([
      makeExprBinding("_scrml_attr_onclick_6", "onclick", "() => doSomething()"),
    ]);
    // Arrow functions should not be double-wrapped
    expect(out).not.toContain("function(event) { () =>");
    expect(out).toContain("() => doSomething()");
  });

  test("fn() handler is syntactically valid JS (no unnamed fn decl)", () => {
    // The registry entry must be a valid function expression, not a statement
    const out = run([
      makeExprBinding("_scrml_attr_onclick_7", "onclick", 'fn() { @active = true }'),
    ]);
    // A function declaration statement inside an object literal is a syntax error.
    // We check the pattern that caused the bug: `function(event) { function() {`
    expect(out).not.toMatch(/"_scrml_attr_onclick_7":\s*function\(event\)\s*\{\s*function\(\)/);
  });

  test("multiple fn() handlers on same page — each rewritten independently", () => {
    const out = run([
      makeExprBinding("_scrml_attr_onclick_8", "onclick", 'fn() { @color = "black" }'),
      makeExprBinding("_scrml_attr_onclick_9", "onclick", 'fn() { @color = "red" }'),
      makeExprBinding("_scrml_attr_onclick_10", "onclick", 'fn() { @color = "blue" }'),
    ]);
    expect(out).toContain('_scrml_reactive_set("color", "black")');
    expect(out).toContain('_scrml_reactive_set("color", "red")');
    expect(out).toContain('_scrml_reactive_set("color", "blue")');
    // None should have the double-wrap
    expect(out).not.toContain("function(event) { function()");
  });

  test("§18 bare function reference in handlerExpr gets called", () => {
    // onclick=${advance} — no parens — should still emit advance() not bare advance;
    const binding = { placeholderId: "_scrml_attr_onclick_1", eventName: "onclick", handlerName: "", handlerArgs: [], handlerExpr: "advance" };
    const ctx = makeCompileContext({
      fileAST: { filePath: "test.scrml" },
      registry: BindingRegistry.from([binding], []),
    });
    const out = emitEventWiring(ctx, new Map());
    const joined = out.join("\n");
    expect(joined).toContain("advance()");
    expect(joined).not.toMatch(/advance;/);
  });
});
