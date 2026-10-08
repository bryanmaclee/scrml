/**
 * emit-lift.js — Unit Tests
 *
 * Tests for the createElement-based lift emission introduced in Phase 3
 * of the code-generator rewrite (cg-createelement-lift change).
 *
 * Coverage:
 *   §1  parseLiftContentParts — text/interpolation segmentation
 *   §2  emitLiftExpr — expr.kind="expr" with simple tag
 *   §3  emitLiftExpr — expr.kind="expr" with attributes
 *   §4  emitLiftExpr — expr.kind="expr" with expression interpolation
 *   §5  emitLiftExpr — void/self-closing elements
 *   §6  emitLiftExpr — non-tag expression → createTextNode
 *   §7  emitConsolidatedLift — fragmented for-loop body
 *   §8  hasFragmentedLiftBody detection
 *   §9  Runtime _scrml_lift signature (factory function)
 *   §10 BLOCK_REF-split attribute handling (fix-toggle-checkbox bug)
 *   §11 tilde-decl attribute handling (toggle-checkbox-trace bug)
 *       Tests for the actual parser output where attribute tokens appear as tilde-decl nodes
 *       rather than bare-expr nodes, due to the AST builder's IDENT = rule firing on onclick etc.
 *   §12 Nested lift accumulation (b2-nested-lift)
 *       Tests for §10.6 normative rule: inner lift targets nearest enclosing lifted element,
 *       not the outermost element. Verifies emitForStmtWithContainer routes inner lift-exprs
 *       to the correct parent element via containerVar.
 */

import { describe, test, expect } from "bun:test";
import {
  parseLiftContentParts,
  emitLiftExpr,
  emitConsolidatedLift,
  hasFragmentedLiftBody,
} from "../../src/codegen/emit-lift.js";
import { resetVarCounter } from "../../src/codegen/var-counter.ts";

// Reset var counter before each test for deterministic output
function resetAndRun(fn) {
  resetVarCounter();
  return fn();
}

// ---------------------------------------------------------------------------
// §1 parseLiftContentParts
// ---------------------------------------------------------------------------

describe("emit-lift §1: parseLiftContentParts", () => {
  test("pure text produces single text part", () => {
    const parts = [];
    parseLiftContentParts("Hello World", parts);
    expect(parts).toEqual([{ type: "text", value: "Hello World" }]);
  });

  test("compact interpolation ${expr} produces text + expr parts", () => {
    const parts = [];
    parseLiftContentParts("Hello ${name}", parts);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toEqual({ type: "text", value: "Hello " });
    expect(parts[1]).toEqual({ type: "expr", value: "name" });
  });

  test("tokenizer-spaced interpolation $ { expr } is detected", () => {
    const parts = [];
    parseLiftContentParts("Step $ { idx } done", parts);
    expect(parts).toHaveLength(3);
    expect(parts[0]).toEqual({ type: "text", value: "Step " });
    expect(parts[1]).toEqual({ type: "expr", value: "idx" });
    expect(parts[2]).toEqual({ type: "text", value: " done" });
  });

  test("$$ { expr } produces literal $ + expr parts", () => {
    const parts = [];
    parseLiftContentParts("Price: $$ { amount }", parts);
    expect(parts[0]).toEqual({ type: "text", value: "Price: " });
    expect(parts[1]).toEqual({ type: "text", value: "$" });
    expect(parts[2]).toEqual({ type: "expr", value: "amount" });
  });

  test("pure whitespace produces no parts", () => {
    const parts = [];
    parseLiftContentParts("   ", parts);
    expect(parts).toHaveLength(0);
  });

  test("multiple interpolations in sequence", () => {
    const parts = [];
    parseLiftContentParts("${a}:${b}", parts);
    expect(parts).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// §2 emitLiftExpr — simple tag (no attrs, no expressions)
// ---------------------------------------------------------------------------

describe("emit-lift §2: emitLiftExpr simple tag", () => {
  test("< li > text / emits createElement('li') with textContent", () => {
    const output = resetAndRun(() =>
      emitLiftExpr({ kind: "lift-expr", expr: { kind: "expr", expr: "< li > Hello /" } })
    );
    expect(output).toContain("_scrml_lift(");
    expect(output).toContain('document.createElement("li")');
    // Either createTextNode (structured path) or textContent (legacy string parser)
    // is acceptable for simple text-only content; both are semantically equivalent
    // when there are no sibling children.
    expect(output).toMatch(/(createTextNode|textContent\s*=)/);
    expect(output).toMatch(/Hello/);
  });

  test("factory function pattern: () => { ... return el; }", () => {
    const output = resetAndRun(() =>
      emitLiftExpr({ kind: "lift-expr", expr: { kind: "expr", expr: "< li > item /" } })
    );
    expect(output).toMatch(/_scrml_lift\(\(\) =>/);
    expect(output).toMatch(/return _scrml_lift_el_\d+/);
  });

  test("empty tag with no content emits createElement with no content assignment", () => {
    const output = resetAndRun(() =>
      emitLiftExpr({ kind: "lift-expr", expr: { kind: "expr", expr: "< div > /" } })
    );
    expect(output).toContain('document.createElement("div")');
  });
});

// ---------------------------------------------------------------------------
// §3 emitLiftExpr — tag with attributes
// ---------------------------------------------------------------------------

describe("emit-lift §3: emitLiftExpr with attributes", () => {
  test("class attribute is set via setAttribute", () => {
    const output = resetAndRun(() =>
      emitLiftExpr({ kind: "lift-expr", expr: { kind: "expr", expr: '< div class = "card" > content /' } })
    );
    expect(output).toContain('document.createElement("div")');
    expect(output).toContain('setAttribute("class", "card")');
    expect(output).toMatch(/content/);
  });

  test("multiple attributes are all set via setAttribute", () => {
    const output = resetAndRun(() =>
      emitLiftExpr({ kind: "lift-expr", expr: { kind: "expr", expr: '< a href = "#" class = "link" > text /' } })
    );
    expect(output).toContain('setAttribute("href", "#")');
    expect(output).toContain('setAttribute("class", "link")');
  });

  test("boolean attribute has empty string value", () => {
    const output = resetAndRun(() =>
      emitLiftExpr({ kind: "lift-expr", expr: { kind: "expr", expr: "< input disabled > /" } })
    );
    expect(output).toContain('setAttribute("disabled", "")');
  });
});

// ---------------------------------------------------------------------------
// §4 emitLiftExpr — expression interpolation in content
// ---------------------------------------------------------------------------

describe("emit-lift §4: emitLiftExpr with expression content", () => {
  test("${item} interpolation produces createTextNode via re-parse", () => {
    const output = resetAndRun(() =>
      emitLiftExpr({ kind: "lift-expr", expr: { kind: "expr", expr: "< li > ${item} /" } })
    );
    expect(output).toContain('document.createElement("li")');
    expect(output).toContain("createTextNode");
    // Re-parse path resolves ${item} as a logic block → String(item ?? "")
    expect(output).toMatch(/item/);
  });

  test("tokenizer-spaced $ { item } interpolation is detected", () => {
    const output = resetAndRun(() =>
      emitLiftExpr({ kind: "lift-expr", expr: { kind: "expr", expr: "< li > $ { item } /" } })
    );
    expect(output).toContain("createTextNode");
    // Tokenizer-spaced interpolation may be treated as text or resolved
    expect(output).toMatch(/item/);
  });

  test("@reactive reference inside ${} interpolation is rewritten", () => {
    // In scrml, @var in expression context gets rewritten to _scrml_reactive_get("var")
    // This is the case where the expr string contains "${@count}"
    const output = resetAndRun(() =>
      emitLiftExpr({ kind: "lift-expr", expr: { kind: "expr", expr: "< span > ${@count} /" } })
    );
    expect(output).toContain('_scrml_reactive_get("count")');
    expect(output).toContain("createTextNode");
  });

  test("attribute value with interpolation uses template literal", () => {
    const output = resetAndRun(() =>
      emitLiftExpr({ kind: "lift-expr", expr: { kind: "expr", expr: '< img src = "${url}" /' } })
    );
    expect(output).toContain('setAttribute("src"');
    expect(output).toContain("${url}");
  });
});

// ---------------------------------------------------------------------------
// §5 emitLiftExpr — void/self-closing elements
// ---------------------------------------------------------------------------

describe("emit-lift §5: emitLiftExpr void elements", () => {
  test("img tag is a void element — no textContent assignment", () => {
    const output = resetAndRun(() =>
      emitLiftExpr({ kind: "lift-expr", expr: { kind: "expr", expr: '< img src = "cat.jpg" alt = "Photo" /' } })
    );
    expect(output).toContain('document.createElement("img")');
    expect(output).toContain('setAttribute("src", "cat.jpg")');
    expect(output).toContain('setAttribute("alt", "Photo")');
    expect(output).not.toContain("textContent");
    expect(output).not.toContain("createTextNode");
  });

  test("input tag is a void element", () => {
    const output = resetAndRun(() =>
      emitLiftExpr({ kind: "lift-expr", expr: { kind: "expr", expr: '< input type = "checkbox" checked /' } })
    );
    expect(output).toContain('document.createElement("input")');
    expect(output).toContain('setAttribute("type", "checkbox")');
  });
});

// ---------------------------------------------------------------------------
// §6 emitLiftExpr — non-tag expression
// ---------------------------------------------------------------------------

describe("emit-lift §6: emitLiftExpr non-tag expression", () => {
  test("plain identifier produces createTextNode", () => {
    const output = resetAndRun(() =>
      emitLiftExpr({ kind: "lift-expr", expr: { kind: "expr", expr: "myVar" } })
    );
    expect(output).toContain("_scrml_lift");
    expect(output).toContain("createTextNode");
    expect(output).toContain("myVar");
  });

  test("@reactive plain identifier is rewritten in createTextNode", () => {
    const output = resetAndRun(() =>
      emitLiftExpr({ kind: "lift-expr", expr: { kind: "expr", expr: "@count" } })
    );
    expect(output).toContain('_scrml_reactive_get("count")');
    expect(output).toContain("createTextNode");
  });
});

// ---------------------------------------------------------------------------
// §7 emitConsolidatedLift — fragmented for-loop body
// ---------------------------------------------------------------------------

describe("emit-lift §7: emitConsolidatedLift fragmented body", () => {
  function span(start = 0) {
    return { file: "test.scrml", start, end: start + 10, line: 1, col: start + 1 };
  }

  test("fragmented body with lift-expr + logic child produces createElement", () => {
    const body = [
      {
        kind: "lift-expr",
        expr: { kind: "expr", expr: "< li >" },
        span: span(0),
      },
      {
        kind: "logic",
        body: [{ kind: "bare-expr", expr: "item", span: span(10) }],
        span: span(5),
      },
      {
        kind: "bare-expr",
        expr: "/",
        span: span(20),
      },
    ];

    const output = resetAndRun(() => emitConsolidatedLift(body));
    expect(output).toContain('document.createElement("li")');
    expect(output).toContain("_scrml_lift");
    expect(output).toContain("${item}");
  });

  test("pre-statements before lift are emitted first", () => {
    const body = [
      {
        kind: "bare-expr",
        expr: "let x = 1",
        span: span(0),
      },
      {
        kind: "lift-expr",
        expr: { kind: "expr", expr: "< span >" },
        span: span(10),
      },
    ];

    const output = resetAndRun(() => emitConsolidatedLift(body));
    // Pre-statement should appear before the lift call
    const preIdx = output.indexOf("let x = 1");
    const liftIdx = output.indexOf("_scrml_lift");
    expect(preIdx).toBeGreaterThanOrEqual(0);
    expect(liftIdx).toBeGreaterThan(preIdx);
  });

  test("closing tag fragments are skipped (< / li > or /)", () => {
    const body = [
      {
        kind: "lift-expr",
        expr: { kind: "expr", expr: "< li >" },
        span: span(0),
      },
      {
        kind: "logic",
        body: [{ kind: "bare-expr", expr: "item", span: span(5) }],
        span: span(3),
      },
      {
        kind: "bare-expr",
        expr: "< / li >",
        span: span(10),
      },
    ];

    const output = resetAndRun(() => emitConsolidatedLift(body));
    // The < / li > closing tag fragment should NOT appear in the output as text
    expect(output).not.toContain('"< / li >"');
    expect(output).not.toContain("< / li >");
    expect(output).toContain('document.createElement("li")');
  });

  test("class attribute from lift-expr is correctly parsed", () => {
    const body = [
      {
        kind: "lift-expr",
        expr: { kind: "expr", expr: '< div class = "card" >' },
        span: span(0),
      },
    ];

    const output = resetAndRun(() => emitConsolidatedLift(body));
    expect(output).toContain('document.createElement("div")');
    expect(output).toContain('setAttribute("class", "card")');
  });

  test("returns empty string if no lift-expr in body", () => {
    const body = [
      { kind: "bare-expr", expr: "x = 1", span: span(0) },
    ];
    const output = resetAndRun(() => emitConsolidatedLift(body));
    expect(output).toBe("");
  });
});

// ---------------------------------------------------------------------------
// §8 hasFragmentedLiftBody detection
// ---------------------------------------------------------------------------

describe("emit-lift §8: hasFragmentedLiftBody", () => {
  function span(start = 0) {
    return { file: "test.scrml", start, end: start + 10, line: 1, col: start + 1 };
  }

  test("returns true when lift-expr + bare-expr with HTML chars are both present", () => {
    const body = [
      { kind: "lift-expr", expr: { kind: "expr", expr: "< li >" }, span: span(0) },
      { kind: "bare-expr", expr: "< / li >", span: span(10) },
    ];
    expect(hasFragmentedLiftBody(body)).toBe(true);
  });

  test("returns false when only one node", () => {
    const body = [
      { kind: "lift-expr", expr: { kind: "expr", expr: "< li > text /" }, span: span(0) },
    ];
    expect(hasFragmentedLiftBody(body)).toBe(false);
  });

  test("returns false when no lift-expr present", () => {
    const body = [
      { kind: "bare-expr", expr: "x = 1", span: span(0) },
      { kind: "bare-expr", expr: "y = 2", span: span(5) },
    ];
    expect(hasFragmentedLiftBody(body)).toBe(false);
  });

  test("returns false when lift-expr present but no HTML fragments", () => {
    const body = [
      { kind: "lift-expr", expr: { kind: "expr", expr: "myVar" }, span: span(0) },
      { kind: "bare-expr", expr: "x = 1", span: span(5) },
    ];
    expect(hasFragmentedLiftBody(body)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §9 Runtime _scrml_lift signature
// ---------------------------------------------------------------------------

describe("emit-lift §9: runtime _scrml_lift factory signature", () => {
  test("emitLiftExpr output calls _scrml_lift with arrow function", () => {
    const output = resetAndRun(() =>
      emitLiftExpr({ kind: "lift-expr", expr: { kind: "expr", expr: "< p > text /" } })
    );
    expect(output).toMatch(/_scrml_lift\(\(\) =>/);
  });

  test("emitLiftExpr output does NOT use old (tag, attrs, content) string signature", () => {
    const output = resetAndRun(() =>
      emitLiftExpr({ kind: "lift-expr", expr: { kind: "expr", expr: '< div class = "foo" > text /' } })
    );
    // Old signature: _scrml_lift("div", ...) — tag as first string argument
    expect(output).not.toMatch(/_scrml_lift\("div"/);
    expect(output).not.toMatch(/_scrml_lift\("p"/);
  });

  test("emitConsolidatedLift output calls _scrml_lift with arrow function", () => {
    const body = [
      { kind: "lift-expr", expr: { kind: "expr", expr: "< li >" }, span: { file: "t", start: 0, end: 5, line: 1, col: 1 } },
    ];
    const output = resetAndRun(() => emitConsolidatedLift(body));
    expect(output).toMatch(/_scrml_lift\(\(\) =>/);
  });
});

// ---------------------------------------------------------------------------
// §10 BLOCK_REF-split attribute handling (fix-toggle-checkbox)
//
// Tests for the bug where BLOCK_REF boundaries (interpolations like ${expr})
// inside element attributes caused the tokenizer to fragment the attribute
// stream. The fix adds pendingAttrName tracking and attr-continuation detection
// to emitConsolidatedLift.
// ---------------------------------------------------------------------------

describe("emit-lift §10: BLOCK_REF-split attribute handling", () => {
  function span(start = 0) {
    return { file: "test.scrml", start, end: start + 10, line: 1, col: start + 1 };
  }

  // Simulates: lift <li class="todo-item" data-id=${todo.id}>
  // The `data-id =` gets cut off at the BLOCK_REF boundary.
  test("BLOCK_REF-split attr: logic node after 'attrname =' is emitted as setAttribute", () => {
    const body = [
      {
        kind: "lift-expr",
        // attrsStr ends with `data-id =` — incomplete, value is in the next logic node
        expr: { kind: "expr", expr: '< li class = "item" data-id =' },
        span: span(0),
      },
      {
        kind: "logic",
        body: [{ kind: "bare-expr", expr: "todo . id", span: span(10) }],
        span: span(5),
      },
      {
        kind: "bare-expr",
        expr: "< / li >",
        span: span(20),
      },
    ];

    const output = resetAndRun(() => emitConsolidatedLift(body));
    // data-id should be set as an attribute, not text content
    expect(output).toContain('setAttribute("data-id"');
    expect(output).toContain("todo . id");
    // Must NOT appear as textContent
    expect(output).not.toMatch(/textContent.*todo/);
  });

  // Simulates: <input class="toggle" type="checkbox" checked=${todo.completed} onclick=...>
  // The tokenizer fragments this into:
  //   bare-expr: `< input class = "toggle" type = "checkbox" checked =`  (truncated at BLOCK_REF)
  //   logic node: `${todo.completed}`
  //   bare-expr: `onclick = toggleTodo ( todo . id ) / >`
  test("void element with BLOCK_REF-split checked attr: no textContent on input", () => {
    const body = [
      {
        kind: "lift-expr",
        expr: { kind: "expr", expr: '< li >' },
        span: span(0),
      },
      {
        kind: "bare-expr",
        // div.view containing input with attrs cut off at BLOCK_REF
        expr: '< div class = "view" > < input class = "toggle" type = "checkbox" checked =',
        span: span(5),
      },
      {
        kind: "logic",
        body: [{ kind: "bare-expr", expr: "todo . completed", span: span(10) }],
        span: span(8),
      },
      {
        kind: "bare-expr",
        // Remaining attrs after BLOCK_REF: onclick=..., then closing tags
        expr: 'onclick = toggleTodo ( todo . id ) / > < / div > < / li >',
        span: span(15),
      },
    ];

    const output = resetAndRun(() => emitConsolidatedLift(body));

    // Input element must be created
    expect(output).toContain('document.createElement("input")');
    // class="toggle" must be set as attribute
    expect(output).toContain('setAttribute("class", "toggle")');
    // type="checkbox" must be set as attribute
    expect(output).toContain('setAttribute("type", "checkbox")');
    // checked=${todo.completed} must be setAttribute, not textContent
    expect(output).toContain('setAttribute("checked"');
    expect(output).toContain("todo . completed");
    // onclick must use addEventListener, not setAttribute
    expect(output).toContain('addEventListener("click"');
    expect(output).toContain("toggleTodo");
    // Must NOT set textContent on the input (it's a void element)
    expect(output).not.toMatch(/createElement\("input"\)[^;]*textContent/s);
  });

  // Simulates attr continuation: `onclick = handler ( arg ) / >` arriving as bare-expr
  // after the element is already on the stack.
  test("attr continuation bare-expr: onclick is wired as addEventListener", () => {
    const body = [
      {
        kind: "lift-expr",
        expr: { kind: "expr", expr: '< button class = "destroy"' },
        span: span(0),
      },
      {
        kind: "bare-expr",
        // The onclick= and remaining attrs arrive after the element is pushed
        expr: 'onclick = deleteTodo ( todo . id ) / >',
        span: span(5),
      },
    ];

    const output = resetAndRun(() => emitConsolidatedLift(body));
    expect(output).toContain('document.createElement("button")');
    expect(output).toContain('addEventListener("click"');
    expect(output).toContain("deleteTodo");
    // onclick should NOT appear as text content
    expect(output).not.toContain('"onclick"');
    expect(output).not.toContain('textContent = "onclick');
  });

  // Void element with all attrs in-line (no BLOCK_REF split) — should still work
  test("void element with no BLOCK_REF split has no textContent", () => {
    const body = [
      {
        kind: "lift-expr",
        expr: { kind: "expr", expr: '< input class = "toggle" type = "checkbox" /' },
        span: span(0),
      },
    ];

    const output = resetAndRun(() => emitConsolidatedLift(body));
    expect(output).toContain('document.createElement("input")');
    expect(output).toContain('setAttribute("class", "toggle")');
    expect(output).toContain('setAttribute("type", "checkbox")');
    expect(output).not.toContain("textContent");
    expect(output).not.toContain("createTextNode");
  });

  // ">" bare fragment should not become text content
  test("bare > fragment is silently skipped", () => {
    const body = [
      {
        kind: "lift-expr",
        expr: { kind: "expr", expr: '< li class = "item"' },
        span: span(0),
      },
      {
        kind: "bare-expr",
        expr: ">",
        span: span(5),
      },
      {
        kind: "logic",
        body: [{ kind: "bare-expr", expr: "item . title", span: span(10) }],
        span: span(8),
      },
    ];

    const output = resetAndRun(() => emitConsolidatedLift(body));
    expect(output).toContain('document.createElement("li")');
    // The ">" should NOT appear as textContent
    expect(output).not.toContain('textContent = ">"');
    expect(output).not.toContain('">"');
  });
});

// ---------------------------------------------------------------------------
// §11 tilde-decl attribute handling (toggle-checkbox-trace fix)
//
// The AST builder's parseOneStatement fires the tilde-decl rule when it sees
// IDENT "=" at depth 0 (e.g. `onclick = toggleTodo(id)`). This produces
// tilde-decl{name:"onclick", init:"toggleTodo ( todo . id ) / > ..."} nodes
// that emitConsolidatedLift must treat as attribute continuations.
//
// Root causes fixed:
//   1. hasFragmentedLiftBody: detect tilde-decl fragmentation pattern
//   2. emitConsolidatedLift: handle tilde-decl nodes as attr continuations
//   3. pushElement: strip trailing `name =` BEFORE parseAttrs to avoid
//      spurious empty-value entries for hyphenated attrs like `data-id`
// ---------------------------------------------------------------------------

describe("emit-lift §11: tilde-decl attribute handling (toggle-checkbox-trace)", () => {
  function span(start = 0) {
    return { file: "test.scrml", start, end: start + 10, line: 1, col: start + 1 };
  }

  // hasFragmentedLiftBody must detect tilde-decl nodes as fragmentation indicators
  test("hasFragmentedLiftBody: returns true when lift-expr + tilde-decl with HTML attr name", () => {
    const body = [
      { kind: "lift-expr", expr: { kind: "expr", expr: "< li >" }, span: span(0) },
      { kind: "tilde-decl", name: "onclick", init: "deleteTodo ( id )", span: span(5) },
    ];
    expect(hasFragmentedLiftBody(body)).toBe(true);
  });

  test("hasFragmentedLiftBody: returns false when tilde-decl has non-attribute name (e.g. camelCase)", () => {
    const body = [
      { kind: "lift-expr", expr: { kind: "expr", expr: "< li >" }, span: span(0) },
      // 'myHandler' is camelCase — not a pure HTML attribute name (has uppercase)
      { kind: "tilde-decl", name: "myHandler", init: "deleteTodo ( id )", span: span(5) },
    ];
    // This would also trigger bare-expr detection if there's an HTML fragment, but by itself
    // should NOT be detected as fragmentation (no bare-expr HTML chars either)
    expect(hasFragmentedLiftBody(body)).toBe(false);
  });

  // Simulates the ACTUAL parser output for:
  //   <input class="toggle" type="checkbox" checked=${todo.completed} onclick=toggleTodo(todo.id)/>
  // The parser produces a tilde-decl for onclick because IDENT "=" fires the tilde-decl rule.
  // The onclick init includes the self-closer ` / >` followed by sibling tags.
  test("tilde-decl onclick after BLOCK_REF split: wired as addEventListener", () => {
    const body = [
      {
        kind: "lift-expr",
        expr: { kind: "expr", expr: '< li >' },
        span: span(0),
      },
      {
        kind: "bare-expr",
        expr: '< div class = "view" > < input class = "toggle" type = "checkbox"',
        span: span(5),
      },
      {
        // checked = ${todo.completed} — the BLOCK_REF for todo.completed
        kind: "logic",
        body: [{ kind: "bare-expr", expr: "todo . completed", span: span(10) }],
        span: span(8),
      },
      {
        // onclick = ... fires tilde-decl rule; init includes / > and sibling tags
        kind: "tilde-decl",
        name: "onclick",
        init: "toggleTodo ( todo . id ) / > < / div > < / li >",
        span: span(15),
      },
    ];

    const output = resetAndRun(() => emitConsolidatedLift(body));

    // Input element must be created
    expect(output).toContain('document.createElement("input")');
    // class="toggle" must be set
    expect(output).toContain('setAttribute("class", "toggle")');
    // onclick must be wired as addEventListener — this is the fix
    expect(output).toContain('addEventListener("click"');
    expect(output).toContain("toggleTodo");
    // onclick must NOT appear as a text node or bare statement
    expect(output).not.toContain('"onclick"');
    // The input element must NOT have other elements appended to it (it's void)
    expect(output).not.toMatch(/createElement\("input"\)[^;]*appendChild/s);
  });

  // Simulates the ACTUAL parser output for `data-id=${todo.id}`:
  // The tokenizer spaces hyphens: `data-id` becomes `data - id`.
  // The trailing `data - id =` regex must match and extract `data-id` as pendingAttrName,
  // and must NOT emit a spurious empty-value setAttribute("data-id", "").
  test("hyphenated attr data-id from tokenizer spacing: no empty setAttribute, correct pending", () => {
    const body = [
      {
        kind: "lift-expr",
        // Tokenizer-spaced: `data - id =` at the end (no value — BLOCK_REF split)
        expr: { kind: "expr", expr: '< li class = "todo-item" data - id =' },
        span: span(0),
      },
      {
        kind: "logic",
        body: [{ kind: "bare-expr", expr: "todo . id", span: span(10) }],
        span: span(5),
      },
      {
        kind: "bare-expr",
        expr: "< / li >",
        span: span(20),
      },
    ];

    const output = resetAndRun(() => emitConsolidatedLift(body));

    // data-id must be set to the expression from the logic node
    expect(output).toContain('setAttribute("data-id"');
    expect(output).toContain("todo . id");
    // Must NOT have setAttribute("data-id", "") — the empty-value spurious entry
    expect(output).not.toContain('setAttribute("data-id", "")');
    // Must NOT have setAttribute("id", ...) — the old buggy behavior using just `id`
    // from the trailing regex matching the partial name `id` instead of `data-id`
    expect(output).not.toMatch(/setAttribute\("id",\s*(?:_scrml_g\.)?String\(todo/);
  });

  // tilde-decl with ondblclick (label's event handler)
  test("tilde-decl ondblclick is wired as addEventListener on the correct element", () => {
    const body = [
      {
        kind: "lift-expr",
        expr: { kind: "expr", expr: '< li >' },
        span: span(0),
      },
      {
        kind: "bare-expr",
        expr: '< label',
        span: span(5),
      },
      {
        // ondblclick fires tilde-decl rule
        kind: "tilde-decl",
        name: "ondblclick",
        init: "startEdit ( todo . id , todo . title ) > text /",
        span: span(10),
      },
    ];

    const output = resetAndRun(() => emitConsolidatedLift(body));

    expect(output).toContain('document.createElement("label")');
    expect(output).toContain('addEventListener("dblclick"');
    expect(output).toContain("startEdit");
  });

  // tilde-decl for a non-event attribute (e.g. `checked = ${...}` misparsed as tilde-decl)
  // This happens when checked=${todo.completed} and the BLOCK_REF is collected into the init.
  test("tilde-decl checked with raw BLOCK_REF text: emitted as setAttribute", () => {
    const body = [
      {
        kind: "lift-expr",
        expr: { kind: "expr", expr: '< li >' },
        span: span(0),
      },
      {
        kind: "bare-expr",
        expr: '< input class = "toggle" type = "checkbox"',
        span: span(5),
      },
      {
        // checked = ${todo.completed} — parser fires tilde-decl, init is BLOCK_REF raw text
        kind: "tilde-decl",
        name: "checked",
        init: "${todo.completed}",
        span: span(10),
      },
      {
        kind: "bare-expr",
        expr: "< / li >",
        span: span(15),
      },
    ];

    const output = resetAndRun(() => emitConsolidatedLift(body));

    expect(output).toContain('document.createElement("input")');
    // checked must be set as an attribute (not ignored or treated as text)
    expect(output).toContain('setAttribute("checked"');
    // The value should reference todo.completed
    expect(output).toContain("todo.completed");
  });
});

// ---------------------------------------------------------------------------
// §12 Nested lift accumulation (b2-nested-lift)
//
// Tests for §10.6 normative rule: inner lift targets the nearest enclosing
// lifted element (its immediate parent), not the outermost element.
//
// Before the fix, inner for-loops containing lift-exprs called emitLogicNode()
// without a containerVar, emitting _scrml_lift() globally (targeting document.body).
// After the fix, emitForStmtWithContainer() routes inner lift-exprs to the
// current element via containerVar = appendChild(), not _scrml_lift().
// ---------------------------------------------------------------------------

describe("emit-lift §12: nested lift accumulation (§10.6 scoping rule)", () => {
  function span(start = 0) {
    return { file: "test.scrml", start, end: start + 10, line: 1, col: start + 1 };
  }

  // Test A: single-level lift regression — must still work after fix
  test("single-level lift: emitConsolidatedLift still emits _scrml_lift", () => {
    const body = [
      {
        kind: "lift-expr",
        expr: { kind: "expr", expr: "< li > text /" },
        span: span(0),
      },
    ];
    const output = resetAndRun(() => emitConsolidatedLift(body));
    expect(output).toContain("_scrml_lift(");
    expect(output).toContain('document.createElement("li")');
  });

  // Test A2: containerVar still works — outer emitConsolidatedLift with containerVar
  test("single-level lift with containerVar: uses appendChild not _scrml_lift", () => {
    const body = [
      {
        kind: "lift-expr",
        expr: { kind: "expr", expr: "< li > text /" },
        span: span(0),
      },
    ];
    const output = resetAndRun(() => emitConsolidatedLift(body, { containerVar: "myList" }));
    expect(output).toContain("myList.appendChild(");
    expect(output).not.toContain("_scrml_lift(");
  });

  // Test B: nested for/lift — inner lift must target the <li>, not use _scrml_lift() globally
  // Simulates: lift <li>${ for (item of group.items) { lift <span>${item.name}/; } }/
  //
  // Body structure: [lift-expr(<li>), logic{for-stmt{body:[lift-expr(<span>)]}}]
  // Expected: inner lift-expr emits <li-var>.appendChild(...) not _scrml_lift(...)
  test("nested for/lift: inner lift-expr appends to <li>, not _scrml_lift globally", () => {
    const innerLiftNode = {
      kind: "lift-expr",
      expr: { kind: "expr", expr: "< span > $ { item . name } /" },
      span: span(30),
    };
    const innerForStmt = {
      kind: "for-stmt",
      variable: "item",
      iterable: "( item of group . items )",
      body: [innerLiftNode],
      span: span(20),
    };
    const body = [
      {
        kind: "lift-expr",
        expr: { kind: "expr", expr: "< li >" },
        span: span(0),
      },
      {
        kind: "logic",
        body: [innerForStmt],
        span: span(10),
      },
      {
        kind: "bare-expr",
        expr: "< / li >",
        span: span(40),
      },
    ];

    const output = resetAndRun(() => emitConsolidatedLift(body));

    // Outer <li> must be created
    expect(output).toContain('document.createElement("li")');
    // Inner <span> must be created
    expect(output).toContain('document.createElement("span")');
    // Inner lift must NOT use _scrml_lift() — that would target document.body
    // The output should have the for-loop with appendChild routing to the <li>
    // Count occurrences of _scrml_lift( — only the outer wrapper should use it
    const liftCalls = (output.match(/_scrml_lift\(/g) || []).length;
    expect(liftCalls).toBe(1); // Only the outer _scrml_lift() wrapper
    // The inner span must be appended via appendChild, not via _scrml_lift
    expect(output).toContain("appendChild(");
    // The for-loop variable must appear
    expect(output).toContain("group . items");
  });

  // Test B2: nested for/lift with top-level for-stmt (not inside logic wrapper)
  // Simulates a for-stmt directly in the body after the lift-expr, not wrapped in a logic node.
  // This exercises fix location 2 (the `else if (child.kind === "for-stmt")` top-level branch).
  test("nested for/lift as top-level for-stmt: inner lift appends to root element", () => {
    const innerLiftNode = {
      kind: "lift-expr",
      expr: { kind: "expr", expr: "< span > text /" },
      span: span(20),
    };
    const topLevelForStmt = {
      kind: "for-stmt",
      variable: "item",
      iterable: "( item of items )",
      body: [innerLiftNode],
      span: span(10),
    };
    const body = [
      {
        kind: "lift-expr",
        expr: { kind: "expr", expr: "< div >" },
        span: span(0),
      },
      topLevelForStmt,
    ];

    const output = resetAndRun(() => emitConsolidatedLift(body));

    // Outer <div> must be created
    expect(output).toContain('document.createElement("div")');
    // Inner <span> must be created
    expect(output).toContain('document.createElement("span")');
    // Only 1 _scrml_lift call — the outer wrapper
    const liftCalls = (output.match(/_scrml_lift\(/g) || []).length;
    expect(liftCalls).toBe(1);
    // The for-loop must appear in the output
    expect(output).toContain("of items");
  });

  // Test C: single-level lift produces the correct element (no regressions from fix)
  test("regression: single-level emitLiftExpr still works correctly", () => {
    const output = resetAndRun(() =>
      emitLiftExpr({ kind: "lift-expr", expr: { kind: "expr", expr: "< li > item /" } })
    );
    expect(output).toContain("_scrml_lift(");
    expect(output).toContain('document.createElement("li")');
  });

  // Test D: verify emitLiftExpr with containerVar routes correctly (existing behavior)
  test("emitLiftExpr with containerVar: uses containerVar.appendChild not _scrml_lift", () => {
    const output = resetAndRun(() =>
      emitLiftExpr(
        { kind: "lift-expr", expr: { kind: "expr", expr: "< span > text /" } },
        { containerVar: "parentEl" }
      )
    );
    expect(output).toContain("parentEl.appendChild(");
    expect(output).not.toContain("_scrml_lift(");
  });
});
