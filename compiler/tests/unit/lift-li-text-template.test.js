/**
 * S87 Bug-6 — `<li>` text-template lift inline codegen
 *
 * Regression coverage for the silent-drop bug in `emitCreateElementFromMarkup`
 * where a `lift <ul>${ for (r of @rows) { lift <li>${r.name}/ } }</ul>` shape
 * lowered to a bare `<ul>` with NO `<li>` children — the inner for-loop and
 * its nested `lift <li>` were dropped on the floor.
 *
 * Root cause: `emitCreateElementFromMarkup`'s `child.kind === "logic"` branch
 * only handled `bare-expr` children, ignoring `for-stmt`, `if-stmt`, and nested
 * `lift-expr`.
 *
 * Fix: dispatch each logic-body child by `kind` and route inner lifts via the
 * existing `emitForStmtWithContainer` (and a new `emitIfStmtWithContainer`)
 * sibling so the inner createElement chain `appendChild`s to the enclosing
 * `<ul>` instead of falling out of the factory.
 *
 * The bug surfaces under structured-markup AST shapes (lift-expr.expr.kind ===
 * "markup"), which is what the parser produces for `lift <tag>...content...</tag>`
 * with explicit closers and structured children.
 */

import { describe, test, expect } from "bun:test";
import { emitLiftExpr, emitCreateElementFromMarkup } from "../../src/codegen/emit-lift.js";
import { resetVarCounter } from "../../src/codegen/var-counter.ts";

const span = (start = 0) => ({ file: "", start, end: start + 1, line: 1, col: 1 });

function reset(fn) {
  resetVarCounter();
  return fn();
}

// Build a structured markup node: <tag attrs>...children...</tag>
function markup(tag, attrs, children) {
  return {
    kind: "markup",
    tag,
    attrs: attrs ?? [],
    children: children ?? [],
    selfClosing: false,
    closerForm: "explicit",
    isComponent: false,
    span: span(0),
  };
}

function strAttr(name, value) {
  return { name, value: { kind: "string-literal", value } };
}

function logicBlock(body) {
  return { kind: "logic", body, imports: [], exports: [], typeDecls: [], components: [], span: span(5) };
}

function forStmt(variable, iterable, body) {
  return { kind: "for-stmt", variable, iterable, body, span: span(10) };
}

function ifStmt(condition, consequent, alternate) {
  const node = { kind: "if-stmt", condition, consequent, span: span(10) };
  if (alternate !== undefined) node.alternate = alternate;
  return node;
}

function liftExprMarkup(node) {
  return { kind: "lift-expr", expr: { kind: "markup", node }, span: span(0) };
}

function bareExpr(expr) {
  return { kind: "bare-expr", expr, span: span(0) };
}

// ---------------------------------------------------------------------------
// §1 The canonical bug shape: lift <ul>${ for (r of @rows) { lift <li>${r.name}<span>${r.email}</span></li> } }</ul>
// ---------------------------------------------------------------------------

describe("lift-li-text-template §1: canonical for/lift inside structured <ul> markup", () => {
  test("structured <ul> with inner for/lift <li> emits the <li> createElement chain (was silently dropped)", () => {
    // AST: <ul class="rows">[ logic{ for r of rows { lift <li>${r.name}<span class="email">${r.email}</span>/ } } ]</ul>
    const innerLi = markup("li", [], [
      logicBlock([bareExpr("r . name")]),
      markup("span", [strAttr("class", "email")], [
        logicBlock([bareExpr("r . email")]),
      ]),
    ]);
    const innerLift = liftExprMarkup(innerLi);
    const forNode = forStmt("r", "rows", [innerLift]);
    const ulMarkup = markup("ul", [strAttr("class", "rows")], [
      logicBlock([forNode]),
    ]);
    const node = liftExprMarkup(ulMarkup);

    const output = reset(() => emitLiftExpr(node));

    // Outer <ul> created
    expect(output).toContain('document.createElement("ul")');
    // Inner <li> created (this is the regression — previously absent)
    expect(output).toContain('document.createElement("li")');
    // Inner <span class="email"> created
    expect(output).toContain('document.createElement("span")');
    // The for-of loop must drive the iteration
    expect(output).toContain("for (const r of rows)");
    // The interpolated text-templates must appear (tokenizer-spaced form preserved)
    expect(output).toContain("r . name");
    expect(output).toContain("r . email");
    // Inner lift must be appended to the <ul>, not _scrml_lift'd globally
    // Only ONE _scrml_lift call: the outer wrapper for <ul>
    const liftCalls = (output.match(/_scrml_lift\(/g) || []).length;
    expect(liftCalls).toBe(1);
    // The <li> factory IIFE must appendChild to the <ul>
    expect(output).toMatch(/appendChild\(\(\(\) => \{[\s\S]*createElement\("li"\)[\s\S]*\}\)\(\)\)/);
  });

  test("for/lift with no other interpolations also works (minimal case)", () => {
    const innerLi = markup("li", [], [logicBlock([bareExpr("r")])]);
    const innerLift = liftExprMarkup(innerLi);
    const forNode = forStmt("r", "rows", [innerLift]);
    const ulMarkup = markup("ul", [], [logicBlock([forNode])]);
    const node = liftExprMarkup(ulMarkup);

    const output = reset(() => emitLiftExpr(node));
    expect(output).toContain('document.createElement("ul")');
    expect(output).toContain('document.createElement("li")');
    expect(output).toContain("for (const r of rows)");
  });
});

// ---------------------------------------------------------------------------
// §2 if-stmt-in-markup: same dispatch path
// ---------------------------------------------------------------------------

describe("lift-li-text-template §2: ${ if (cond) { lift <inner/> } } inside structured markup", () => {
  test("if-stmt with inner lift inside structured <div> emits conditional appendChild (was silently dropped)", () => {
    const innerLift = liftExprMarkup(
      markup("p", [strAttr("class", "ok")], [{ kind: "text", value: "shown when ready" }]),
    );
    const ifNode = ifStmt("ready", [innerLift]);
    const root = markup("div", [strAttr("class", "wrap")], [logicBlock([ifNode])]);
    const node = liftExprMarkup(root);

    const output = reset(() => emitLiftExpr(node));
    expect(output).toContain('document.createElement("div")');
    expect(output).toContain('document.createElement("p")');
    expect(output).toContain("if (ready)");
    // Inner <p> appended to <div>, not _scrml_lift'd
    const liftCalls = (output.match(/_scrml_lift\(/g) || []).length;
    expect(liftCalls).toBe(1);
  });

  test("if/else with lift in both branches: both are appended to parent", () => {
    const ok = liftExprMarkup(markup("p", [], [{ kind: "text", value: "yes" }]));
    const no = liftExprMarkup(markup("p", [], [{ kind: "text", value: "no" }]));
    const ifNode = ifStmt("ready", [ok], [no]);
    const root = markup("div", [], [logicBlock([ifNode])]);
    const node = liftExprMarkup(root);

    const output = reset(() => emitLiftExpr(node));
    expect(output).toContain("if (ready)");
    expect(output).toContain("else");
    // Both <p> elements must be created
    const pCount = (output.match(/createElement\("p"\)/g) || []).length;
    expect(pCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// §3 nested for/for/lift — doubly-nested case
// ---------------------------------------------------------------------------

describe("lift-li-text-template §3: doubly-nested for/for/lift inside structured markup", () => {
  test("for(group){ for(item){ lift <li/> } } emits both loops with correct routing", () => {
    const innerLift = liftExprMarkup(
      markup("li", [], [logicBlock([bareExpr("item . name")])]),
    );
    const innerFor = forStmt("item", "group . items", [innerLift]);
    const outerFor = forStmt("group", "groups", [innerFor]);
    const root = markup("ul", [], [logicBlock([outerFor])]);
    const node = liftExprMarkup(root);

    const output = reset(() => emitLiftExpr(node));
    expect(output).toContain("for (const group of groups)");
    expect(output).toContain("for (const item of group . items)");
    expect(output).toContain('document.createElement("li")');
    // Only ONE _scrml_lift wrapper
    const liftCalls = (output.match(/_scrml_lift\(/g) || []).length;
    expect(liftCalls).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// §4 Mixed bare-expr + for/lift — text interpolation BEFORE the for-loop
// ---------------------------------------------------------------------------

describe("lift-li-text-template §4: mixed text-template and for/lift inside structured markup", () => {
  test("bare-expr ${count} sibling to a for/lift block: both emit", () => {
    const headerLogic = logicBlock([bareExpr("count")]);
    const innerLift = liftExprMarkup(
      markup("li", [], [logicBlock([bareExpr("r")])]),
    );
    const forNode = forStmt("r", "rows", [innerLift]);
    const listLogic = logicBlock([forNode]);
    const root = markup("section", [], [
      markup("h2", [], [headerLogic]),
      markup("ul", [], [listLogic]),
    ]);
    const node = liftExprMarkup(root);

    const output = reset(() => emitLiftExpr(node));
    // header text-template must appear
    expect(output).toContain('createTextNode(String(count');
    // for-loop and inner <li> must appear
    expect(output).toContain("for (const r of rows)");
    expect(output).toContain('document.createElement("li")');
  });
});

// ---------------------------------------------------------------------------
// §5 Regression: bare-expr-only logic block still emits a text node
// ---------------------------------------------------------------------------

describe("lift-li-text-template §5: bare-expr-only logic block (regression guard)", () => {
  test("structured <li>${r.name}</li> still produces a text-node interpolation (no regression)", () => {
    const root = markup("li", [], [logicBlock([bareExpr("r . name")])]);
    const node = liftExprMarkup(root);
    const output = reset(() => emitLiftExpr(node));
    expect(output).toContain('document.createElement("li")');
    expect(output).toContain('createTextNode(String(r . name');
  });
});
