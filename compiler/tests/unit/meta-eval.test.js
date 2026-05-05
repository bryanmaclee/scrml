/**
 * Meta Eval — Unit Tests
 *
 * Tests for src/meta-eval.js (Stage 7.5).
 *
 * Coverage:
 *   §1  emit("<p>hello</>") produces a markup node in the AST
 *   §2  for-loop with emit() produces multiple markup nodes
 *   §3  compile-time JS evaluation works inside emit()
 *   §4  meta block with @reactive var is NOT compile-time evaluated
 *   §5  emit() without ^{} has no effect
 *   §6  bodyReferencesReactiveVars detects @var in bare-expr
 *   §7  bodyReferencesReactiveVars detects reactive-decl nodes
 *   §8  bodyReferencesReactiveVars returns false for clean body
 *   §9  serializeBody serializes bare-expr nodes
 *   §10 serializeBody serializes let-decl and const-decl
 *   §11 evaluateMetaBlock returns [] when no emit() calls
 *   §12 evaluateMetaBlock returns error on bad JS
 *   §13 runMetaEval output shape: files and errors arrays
 *   §14 processNodeList leaves non-compile-time meta blocks unchanged
 *   §15 serializeNode rewrites reflect(TypeName) to reflect("TypeName")
 *   §16 multi-statement body: let variants = reflect(Color).variants + emit
 *   §17 serializeNode does not double-quote reflect("AlreadyString")
 *   §18 reflect(metaLocalConst) resolves meta-local variable at eval time
 *   §19 reflect(t) in for-of loop over type names resolves correctly
 *   §20 reflect("LiteralTypeName") regression guard — still works after meta-local fix
 *   §22 multi-emit concatenation: split emit() calls build one complete element
 *   §23 multi-emit with attributes: form with class survives split emit calls
 *   §24 multi-emit with \n: literal newline in emit() string becomes real newline
 */

import { parseExprToNode } from "../../src/expression-parser.ts";
import { describe, test, expect } from "bun:test";
import {
  runMetaEval,
  bodyReferencesReactiveVars,
  serializeBody,
  serializeNode,
  reparseEmitted,
  evaluateMetaBlock,
  processNodeList,
  MetaEvalError,
} from "../../src/meta-eval.js";

// ---------------------------------------------------------------------------
// Helper: build a minimal meta node from body nodes
// ---------------------------------------------------------------------------

function metaNode(body, span) {
  return {
    id: 1,
    kind: "meta",
    body,
    parentContext: "markup",
    span: span || { file: "test.scrml", start: 0, end: 100, line: 1, col: 1 },
  };
}

function bareExpr(expr) {
  return { id: 2, kind: "bare-expr", expr, exprNode: parseExprToNode(expr, "test.scrml", 0), span: { file: "test.scrml", start: 0, end: 10, line: 1, col: 1 } };
}

function letDecl(name, init) {
  return { id: 3, kind: "let-decl", name, init, span: { file: "test.scrml", start: 0, end: 10, line: 1, col: 1 } };
}

function constDecl(name, init) {
  return { id: 4, kind: "const-decl", name, init, span: { file: "test.scrml", start: 0, end: 10, line: 1, col: 1 } };
}

function forLoop(variable, rawInit, rawTest, rawUpdate, body) {
  return {
    id: 5,
    kind: "for-loop",
    variable,
    indexVariable: variable,
    rawInit,
    rawTest,
    rawUpdate,
    body,
    span: { file: "test.scrml", start: 0, end: 10, line: 1, col: 1 },
  };
}

// Build a minimal type registry with a Color enum for reflect() tests
function colorEnumRegistry() {
  const reg = new Map();
  reg.set("Color", { kind: "enum", name: "Color", variants: ["Red", "Green", "Blue"] });
  return reg;
}

// ---------------------------------------------------------------------------
// §1 emit("<p>hello</>") produces a markup node
// ---------------------------------------------------------------------------

describe("meta-eval", () => {
  test("§1 emit with simple markup produces a markup node", () => {
    const body = [
      bareExpr('emit("<p>hello</>")'),
    ];
    const typeRegistry = new Map();
    const errors = [];

    const result = evaluateMetaBlock(metaNode(body), typeRegistry, errors);

    expect(errors).toHaveLength(0);
    expect(result).not.toBeNull();
    expect(result.length).toBeGreaterThan(0);
    // The result should contain parsed AST nodes from "<p>hello</>"
    const markup = result.find(n => n.kind === "markup");
    expect(markup).toBeDefined();
    expect(markup.tag).toBe("p");
  });

  // ---------------------------------------------------------------------------
  // §2 for-loop with emit() produces multiple markup nodes
  // ---------------------------------------------------------------------------

  test("§2 for-loop with emit() produces multiple nodes", () => {
    const body = [
      forLoop(
        "i",
        "let i = 0",
        "i < 3",
        "i++",
        [bareExpr('emit("<li>" + i + "</>")')]
      ),
    ];
    const typeRegistry = new Map();
    const errors = [];

    const result = evaluateMetaBlock(metaNode(body), typeRegistry, errors);

    expect(errors).toHaveLength(0);
    expect(result).not.toBeNull();
    // Should produce 3 items (the emit is called 3 times, concatenated, then parsed)
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  // ---------------------------------------------------------------------------
  // §3 compile-time JS evaluation works
  // ---------------------------------------------------------------------------

  test("§3 compile-time evaluation of JS expressions", () => {
    const body = [
      constDecl("x", "2 + 2"),
      bareExpr('emit("<p>" + x + "</>")'),
    ];
    const typeRegistry = new Map();
    const errors = [];

    const result = evaluateMetaBlock(metaNode(body), typeRegistry, errors);

    expect(errors).toHaveLength(0);
    expect(result).not.toBeNull();
    expect(result.length).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // §4 meta block with @reactive var is NOT compile-time evaluated
  // ---------------------------------------------------------------------------

  test("§4 meta block with @var is left for runtime", () => {
    const body = [
      { id: 10, kind: "state-decl", name: "count", init: "0", span: { file: "test.scrml", start: 0, end: 10, line: 1, col: 1 } },
      bareExpr('emit("<p></>")'),
    ];

    // processNodeList should skip this because it has reactive vars
    const nodes = [metaNode(body)];
    const typeRegistry = new Map();
    const errors = [];

    processNodeList(nodes, typeRegistry, errors);

    // The meta node should still be there (not replaced)
    expect(nodes).toHaveLength(1);
    expect(nodes[0].kind).toBe("meta");
  });

  // ---------------------------------------------------------------------------
  // §5 emit() without ^{} has no effect
  // ---------------------------------------------------------------------------

  test("§5 emit() only works inside meta blocks", () => {
    // A bare-expr node with emit() that is NOT inside a meta block
    // processNodeList only processes meta nodes, so bare-expr with emit is ignored
    const nodes = [bareExpr('emit("<p></>")'), { id: 20, kind: "markup", tag: "div", children: [], attributes: {}, span: { file: "test.scrml", start: 0, end: 10, line: 1, col: 1 } }];
    const typeRegistry = new Map();
    const errors = [];

    processNodeList(nodes, typeRegistry, errors);

    // Nodes should be unchanged
    expect(nodes).toHaveLength(2);
    expect(nodes[0].kind).toBe("bare-expr");
    expect(nodes[1].kind).toBe("markup");
  });

  // ---------------------------------------------------------------------------
  // §6 bodyReferencesReactiveVars detects @var in bare-expr
  // ---------------------------------------------------------------------------

  test("§6 bodyReferencesReactiveVars detects @var in expressions", () => {
    const body = [bareExpr("@count + 1")];
    expect(bodyReferencesReactiveVars(body)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // §7 bodyReferencesReactiveVars detects reactive-decl nodes
  // ---------------------------------------------------------------------------

  test("§7 bodyReferencesReactiveVars detects reactive-decl", () => {
    const body = [
      { kind: "state-decl", name: "count", init: "0" },
    ];
    expect(bodyReferencesReactiveVars(body)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // §8 bodyReferencesReactiveVars returns false for clean body
  // ---------------------------------------------------------------------------

  test("§8 bodyReferencesReactiveVars returns false for clean body", () => {
    const body = [
      constDecl("x", "42"),
      bareExpr('emit("<p></>")'),
    ];
    expect(bodyReferencesReactiveVars(body)).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // §9 serializeBody serializes bare-expr nodes
  // ---------------------------------------------------------------------------

  test("§9 serializeBody handles bare-expr", () => {
    const code = serializeBody([bareExpr('emit("hello")')]);
    expect(code).toContain('emit("hello");');
  });

  // ---------------------------------------------------------------------------
  // §10 serializeBody serializes let-decl and const-decl
  // ---------------------------------------------------------------------------

  test("§10 serializeBody handles let and const decls", () => {
    const code = serializeBody([
      letDecl("x", "10"),
      constDecl("y", '"hello"'),
    ]);
    expect(code).toContain("let x = 10;");
    expect(code).toContain('const y = "hello";');
  });

  // ---------------------------------------------------------------------------
  // §11 evaluateMetaBlock returns [] when no emit() calls
  // ---------------------------------------------------------------------------

  test("§11 evaluateMetaBlock returns empty array when nothing emitted", () => {
    const body = [
      constDecl("x", "42"),
    ];
    const errors = [];
    const result = evaluateMetaBlock(metaNode(body), new Map(), errors);

    expect(errors).toHaveLength(0);
    expect(result).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // §12 evaluateMetaBlock returns error on bad JS
  // ---------------------------------------------------------------------------

  test("§12 evaluateMetaBlock reports error for invalid JS", () => {
    const body = [
      bareExpr("throw new Error('test error')"),
    ];
    const errors = [];
    const result = evaluateMetaBlock(metaNode(body), new Map(), errors);

    expect(result).toBeNull();
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe("E-META-EVAL-001");
  });

  // ---------------------------------------------------------------------------
  // §13 runMetaEval output shape
  // ---------------------------------------------------------------------------

  test("§13 runMetaEval returns files and errors arrays", () => {
    const result = runMetaEval({ files: [] });
    expect(result.files).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // §14 processNodeList leaves non-compile-time meta blocks unchanged
  // ---------------------------------------------------------------------------

  test("§14 non-compile-time meta blocks are left unchanged", () => {
    // A meta block that has NO compile-time APIs (no emit, reflect, etc.)
    const body = [
      constDecl("x", "42"),
      bareExpr("console.log(x)"),
    ];
    const nodes = [metaNode(body)];
    const errors = [];

    processNodeList(nodes, new Map(), errors);

    // Meta node should still be there — it doesn't use emit() or reflect()
    expect(nodes).toHaveLength(1);
    expect(nodes[0].kind).toBe("meta");
  });

  // ---------------------------------------------------------------------------
  // §15 serializeNode rewrites reflect(TypeName) to reflect("TypeName")
  //
  // Bug: The AST stores `reflect(Color)` with Color as an unquoted identifier.
  // new Function() would fail because Color is not in scope. The serializer
  // must rewrite it to reflect("Color") before passing to new Function().
  // ---------------------------------------------------------------------------

  test("§15 serializeNode rewrites reflect(TypeName) to reflect(\"TypeName\")", () => {
    const node = letDecl("variants", "reflect ( Color ) . variants");
    const serialized = serializeNode(node);
    expect(serialized).toContain('reflect("Color")');
    expect(serialized).not.toMatch(/reflect\s*\(\s*Color\s*\)/); // no unquoted identifier
    expect(serialized).toContain(". variants");
  });

  test("§15b serializeNode rewrites reflect call in bare-expr", () => {
    const node = bareExpr("emit(reflect(Color).variants.join(\", \"))");
    const serialized = serializeNode(node);
    expect(serialized).toContain('reflect("Color")');
  });

  // ---------------------------------------------------------------------------
  // §16 multi-statement body: let variants = reflect(Color).variants + emit
  //
  // Bug: The tokenizer has no newline tokens, so collectExpr in parseLogicBody
  // greedily consumed `let variants = reflect(Color).variants` AND the following
  // `emit(...)` line into a single let-decl init. This caused a parse error
  // ("Unexpected identifier 'emit'") when the serialized code was passed to
  // new Function(). Fixed by adding a newline-based ASI check to collectExpr.
  // ---------------------------------------------------------------------------

  test("§16 multi-statement body emits correct HTML for enum variants", () => {
    // Simulate the AST that the fixed parser produces for:
    //   let variants = reflect(Color).variants
    //   emit("<p>" + variants.join(", ") + "</>")
    const body = [
      letDecl("variants", "reflect ( Color ) . variants"),
      bareExpr('emit ( "<p>" + variants . join ( ", " ) + "</>" )'),
    ];
    const typeRegistry = colorEnumRegistry();
    const errors = [];

    const result = evaluateMetaBlock(metaNode(body), typeRegistry, errors);

    expect(errors).toHaveLength(0);
    expect(result).not.toBeNull();
    expect(result.length).toBeGreaterThan(0);

    const pNode = result.find(n => n.kind === "markup" && n.tag === "p");
    expect(pNode).toBeDefined();

    // The text child of <p> should be the joined enum variants
    const textChild = pNode.children?.find(c => c.kind === "text");
    expect(textChild).toBeDefined();
    expect(textChild.value).toBe("Red, Green, Blue");
  });

  test("§16b multi-statement body produces no errors", () => {
    const body = [
      letDecl("variants", "reflect ( Color ) . variants"),
      bareExpr('emit ( "<p>" + variants . join ( ", " ) + "</>" )'),
    ];
    const typeRegistry = colorEnumRegistry();
    const errors = [];

    evaluateMetaBlock(metaNode(body), typeRegistry, errors);

    expect(errors).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // §17 serializeNode does NOT double-quote reflect("AlreadyString")
  //
  // The rewriteReflectCalls regex only matches bare identifiers. A string
  // literal argument (reflect("Color")) must pass through unchanged.
  // ---------------------------------------------------------------------------

  test("§17 serializeNode does not double-quote reflect(\"AlreadyString\")", () => {
    const node = letDecl("x", 'reflect("Color").variants');
    const serialized = serializeNode(node);
    // Should still have reflect("Color") — not reflect(""Color"")
    expect(serialized).toContain('reflect("Color")');
    expect(serialized).not.toContain('reflect(""Color"")');
    expect(serialized).not.toContain("reflect(\"\\\"Color\\\"\")");
  });

  // ---------------------------------------------------------------------------
  // §18 reflect(metaLocalConst) resolves meta-local variable at eval time
  //
  // Bug fix: When a const is declared inside the ^{} block, reflect(constName)
  // must NOT be rewritten to reflect("constName"). The variable should resolve
  // to its string value at eval time and be passed to createReflect().
  // ---------------------------------------------------------------------------

  test("§18 reflect(metaLocalConst) resolves via meta-local variable", () => {
    // Simulate the AST for:
    //   const typeName = "Color"
    //   let variants = reflect(typeName).variants
    //   emit("<p>" + variants.join(", ") + "</>")
    const body = [
      constDecl("typeName", '"Color"'),
      letDecl("variants", "reflect ( typeName ) . variants"),
      bareExpr('emit ( "<p>" + variants . join ( ", " ) + "</>" )'),
    ];
    const typeRegistry = colorEnumRegistry();
    const errors = [];

    const result = evaluateMetaBlock(metaNode(body), typeRegistry, errors);

    expect(errors).toHaveLength(0);
    expect(result).not.toBeNull();
    const pNode = result.find(n => n.kind === "markup" && n.tag === "p");
    expect(pNode).toBeDefined();

    const textChild = pNode.children?.find(c => c.kind === "text");
    expect(textChild).toBeDefined();
    expect(textChild.value).toBe("Red, Green, Blue");
  });

  test("§18b serializeNode does NOT rewrite reflect(metaLocalVar)", () => {
    // The serializer should leave reflect(localVar) unchanged when localVar is
    // in the locals set. The variable resolves at eval time.
    const locals = new Set(["typeName"]);
    // serializeNode accepts locals as optional second param
    const node = letDecl("variants", "reflect ( typeName ) . variants");
    const serialized = serializeNode(node, locals);
    // Should preserve reflect(typeName), not rewrite to reflect("typeName")
    expect(serialized).toMatch(/reflect\s*\(\s*typeName\s*\)/);
    expect(serialized).not.toContain('reflect("typeName")');
  });

  // ---------------------------------------------------------------------------
  // §19 reflect(t) inside a for-of loop over type names
  //
  // When a for-of loop iterates over a list of type name strings, the loop
  // variable should resolve at eval time — not be rewritten as a literal.
  // ---------------------------------------------------------------------------

  test("§19 reflect(t) in for-of loop over type names works", () => {
    // Simulate:
    //   const types = ["Color"]
    //   for (const t of types) {
    //     let info = reflect(t)
    //     emit("<p>" + info.name + "</>")
    //   }
    const forBody = [
      letDecl("info", "reflect ( t ) . name"),
      bareExpr('emit ( "<p>" + info + "</>" )'),
    ];
    const body = [
      constDecl("types", '["Color"]'),
      {
        id: 6, kind: "for-loop", variable: "t", indexVariable: null,
        iterable: "types",
        body: forBody,
        span: { file: "test.scrml", start: 0, end: 10, line: 1, col: 1 },
      },
    ];
    const typeRegistry = colorEnumRegistry();
    const errors = [];

    const result = evaluateMetaBlock(metaNode(body), typeRegistry, errors);

    expect(errors).toHaveLength(0);
    expect(result).not.toBeNull();
    expect(result.length).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // §20 reflect("LiteralTypeName") regression guard
  //
  // The literal-string case must continue to work after the meta-local fix.
  // ---------------------------------------------------------------------------

  test("§20 reflect(\"LiteralTypeName\") continues to work (regression guard)", () => {
    const body = [
      letDecl("variants", 'reflect ( "Color" ) . variants'),
      bareExpr('emit ( "<p>" + variants . join ( ", " ) + "</>" )'),
    ];
    const typeRegistry = colorEnumRegistry();
    const errors = [];

    const result = evaluateMetaBlock(metaNode(body), typeRegistry, errors);

    expect(errors).toHaveLength(0);
    expect(result).not.toBeNull();
    const pNode = result.find(n => n.kind === "markup" && n.tag === "p");
    expect(pNode).toBeDefined();
    const textChild = pNode.children?.find(c => c.kind === "text");
    expect(textChild).toBeDefined();
    expect(textChild.value).toBe("Red, Green, Blue");
  });

  // ---------------------------------------------------------------------------
  // §21 emit.raw() — SPEC §22.4.1
  // ---------------------------------------------------------------------------

  test("§21a emit.raw() preserves literal backslash-n (no normalization)", () => {
    // emit.raw("hello\\nworld") should NOT convert \\n to a real newline.
    // The block splitter receives the string verbatim; \\n stays as two chars.
    const body = [
      bareExpr('emit.raw("<pre>hello\\\\nworld</pre>")'),
    ];
    const typeRegistry = new Map();
    const errors = [];

    const result = evaluateMetaBlock(metaNode(body), typeRegistry, errors);

    expect(errors).toHaveLength(0);
    expect(result).not.toBeNull();
    // Find a text node or pre node — the key assertion is that the output
    // contains the literal two-character sequence \n, not a real newline.
    const allText = JSON.stringify(result);
    // A real newline would appear as \n in JSON; literal backslash-n appears as \\n
    expect(allText).toContain("\\\\n");
  });

  test("§21b emit() normalizes \\n to real newline (regression guard)", () => {
    // Contrast: emit() SHOULD convert \\n to a real newline.
    // We verify reparseEmitted() behavior directly.
    const errors = [];
    const nodes = reparseEmitted("<p>hello\\nworld</p>", errors, false);
    // After normalization, the emitted code had a real newline in it.
    // The exact AST shape depends on the parser, but no errors should occur.
    expect(errors).toHaveLength(0);
    // The raw (no-normalization) path should not normalize
    const rawNodes = reparseEmitted("<p>hello\\nworld</p>", errors, true);
    expect(errors).toHaveLength(0);
    // Serializing raw nodes should still contain the literal sequence
    const rawText = JSON.stringify(rawNodes);
    expect(rawText).toContain("\\\\n");
  });

  test("§21c interleaved emit() and emit.raw() preserve output order", () => {
    // A meta block that calls emit() then emit.raw() — order must be preserved.
    const body = [
      bareExpr('emit("<p>first</>")'),
      bareExpr('emit.raw("<p>second</>")'),
    ];
    const typeRegistry = new Map();
    const errors = [];

    const result = evaluateMetaBlock(metaNode(body), typeRegistry, errors);

    expect(errors).toHaveLength(0);
    expect(result).not.toBeNull();
    // Should have at least 2 nodes (one per emit call), in order
    expect(result.length).toBeGreaterThanOrEqual(2);
    // First node should correspond to "first", second to "second"
    const firstMarkup = result[0];
    const secondMarkup = result[1];
    expect(firstMarkup.kind).toBe("markup");
    expect(secondMarkup.kind).toBe("markup");
    const firstText = firstMarkup.children?.find(c => c.kind === "text");
    const secondText = secondMarkup.children?.find(c => c.kind === "text");
    expect(firstText?.value).toBe("first");
    expect(secondText?.value).toBe("second");
  });

  test("§21d emit.raw() is recognized as a compile-time API pattern", () => {
    // The meta-checker must treat emit.raw(...) as a compile-time pattern.
    // We test this by putting only emit.raw() in a meta block body and
    // verifying processNodeList evaluates it (replaces the meta node).
    const body = [
      bareExpr('emit.raw("<p>raw</>")'),
    ];
    const nodes = [metaNode(body)];
    const typeRegistry = new Map();
    const errors = [];

    processNodeList(nodes, typeRegistry, errors);

    // The meta node should have been replaced with parsed markup
    expect(errors).toHaveLength(0);
    expect(nodes.length).toBeGreaterThanOrEqual(1);
    expect(nodes[0].kind).not.toBe("meta");
    expect(nodes[0].kind).toBe("markup");
  });

  // ---------------------------------------------------------------------------
  // §22-§24: Multi-emit concatenation fix (bugs #16/#17)
  // ---------------------------------------------------------------------------

  test("§22 multi-emit: split emit() calls build one complete element", () => {
    // Before the fix, each emit() was reparsed separately — unclosed tags were dropped.
    // Now all emit() calls are concatenated before reparsing.
    const body = [
      bareExpr('emit("<div>")'),
      bareExpr('emit("hello")'),
      bareExpr('emit("</div>")'),
    ];
    const typeRegistry = new Map();
    const errors = [];

    const result = evaluateMetaBlock(metaNode(body), typeRegistry, errors);

    expect(errors).toHaveLength(0);
    expect(result).not.toBeNull();
    // Should produce a single <div> markup node containing "hello"
    const div = result.find(n => n.kind === "markup" && n.tag === "div");
    expect(div).toBeDefined();
    const text = div.children?.find(c => c.kind === "text");
    expect(text?.value).toContain("hello");
  });

  test("§23 multi-emit with attributes: form with class survives split emit calls", () => {
    // Bug #16: attributes on emit()'d elements were lost when parsed as fragments.
    const body = [
      bareExpr('emit("<form class=profile-form>")'),
      bareExpr('emit("<input>")'),
      bareExpr('emit("</form>")'),
    ];
    const typeRegistry = new Map();
    const errors = [];

    const result = evaluateMetaBlock(metaNode(body), typeRegistry, errors);

    expect(errors).toHaveLength(0);
    expect(result).not.toBeNull();
    const form = result.find(n => n.kind === "markup" && n.tag === "form");
    expect(form).toBeDefined();
    // The form should have the class attribute preserved
    const classAttr = form.attrs?.find(a => a.name === "class");
    expect(classAttr).toBeDefined();
  });

  test("§24 multi-emit with \\n: literal newline in emit() becomes real newline", () => {
    // Bug #17: literal \n in emit() strings caused parsing issues.
    // After normalization, \n becomes a real newline which is valid whitespace.
    const body = [
      bareExpr('emit("<div>\\nline1\\nline2\\n</div>")'),
    ];
    const typeRegistry = new Map();
    const errors = [];

    const result = evaluateMetaBlock(metaNode(body), typeRegistry, errors);

    expect(errors).toHaveLength(0);
    expect(result).not.toBeNull();
    const div = result.find(n => n.kind === "markup" && n.tag === "div");
    expect(div).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // BUG-META-2: for-stmt (for-of) inside ^{} meta blocks
  // ---------------------------------------------------------------------------

  test("§25 BUG-META-2: for-stmt (for-of) in meta body serializes correctly", () => {
    // for (const item of items) was parsed as kind "for-stmt" not "for-loop".
    // serializeNode didn't handle "for-stmt", producing empty string and losing
    // the loop body including its emit() calls.
    const forStmtNode = {
      id: 10,
      kind: "for-stmt",
      variable: "item",
      iterable: "items",
      body: [bareExpr('emit("<p>" + item + "</p>")')],
      span: { file: "test.scrml", start: 0, end: 100, line: 1, col: 1 },
    };
    const body = [
      constDecl("items", '["a", "b", "c"]'),
      forStmtNode,
    ];
    const typeRegistry = new Map();
    const errors = [];

    const result = evaluateMetaBlock(metaNode(body), typeRegistry, errors);

    expect(errors).toHaveLength(0);
    expect(result).not.toBeNull();
    // Should produce 3 <p> elements
    const pNodes = result.filter(n => n.kind === "markup" && n.tag === "p");
    expect(pNodes.length).toBe(3);
  });

  test("§25b BUG-META-2: serializeNode handles for-stmt without producing empty string", () => {
    // Direct serializeNode test — must not return empty for for-stmt nodes.
    const forStmtNode = {
      id: 10,
      kind: "for-stmt",
      variable: "x",
      iterable: "arr",
      body: [bareExpr('emit(x)')],
      span: { file: "test.scrml", start: 0, end: 50, line: 1, col: 1 },
    };
    const result = serializeNode(forStmtNode, new Set());
    expect(result).toContain("for");
    expect(result).toContain("x");
    expect(result).toContain("arr");
  });

  // ---------------------------------------------------------------------------
  // BUG-META-4: reflect(variable) in inline callback params must not be rewritten
  // ---------------------------------------------------------------------------

  test("§26 BUG-META-4: reflect(typeName) in forEach callback param not rewritten", () => {
    // `types.forEach(function(typeName) { reflect(typeName) })` — typeName is a
    // callback parameter. It is NOT a meta-local declared at the top level, so
    // collectMetaLocals doesn't see it. rewriteReflectCalls must detect inline
    // function params and skip them.
    const typeRegistry = new Map();
    typeRegistry.set("Product", { kind: "struct", name: "Product", fields: new Map([["name", { kind: "primitive", name: "string" }]]) });
    typeRegistry.set("Customer", { kind: "struct", name: "Customer", fields: new Map([["name", { kind: "primitive", name: "string" }]]) });

    const body = [
      constDecl("types", '["Product", "Customer"]'),
      bareExpr('types.forEach(function(typeName) { const info = reflect(typeName); emit("<section><h2>" + typeName + "</h2></section>"); })'),
    ];
    const errors = [];

    const result = evaluateMetaBlock(metaNode(body), typeRegistry, errors);

    // Should succeed — reflect(typeName) resolves to the string value in the array
    expect(errors).toHaveLength(0);
    expect(result).not.toBeNull();
    // Should produce 2 section elements
    const sections = result.filter(n => n.kind === "markup" && n.tag === "section");
    expect(sections.length).toBe(2);
  });

  test("§26b BUG-META-4: reflect(TypeName) bare type still gets rewritten", () => {
    // Regression guard: bare reflect(Color) with no surrounding function call
    // MUST still be rewritten to reflect("Color"). The BUG-META-4 fix must not
    // prevent rewriting of direct type name references.
    const typeRegistry = new Map();
    typeRegistry.set("Color", { kind: "enum", name: "Color", variants: ["Red", "Green", "Blue"] });

    const body = [
      constDecl("info", "reflect(Color)"),
      bareExpr('emit("<p>" + info.variants.join(",") + "</p>")'),
    ];
    const errors = [];

    const result = evaluateMetaBlock(metaNode(body), typeRegistry, errors);

    expect(errors).toHaveLength(0);
    expect(result).not.toBeNull();
    const p = result.find(n => n.kind === "markup" && n.tag === "p");
    expect(p).toBeDefined();
    // Text should contain enum variant names
    const text = p.children?.find(c => c.kind === "text");
    expect(text?.value).toContain("Red");
  });

  test("§26c BUG-META-4: reflect(param) in arrow function callback not rewritten", () => {
    // Arrow function variant: items.forEach(typeName => reflect(typeName))
    const typeRegistry = new Map();
    typeRegistry.set("Product", { kind: "struct", name: "Product", fields: new Map([["id", { kind: "primitive", name: "number" }]]) });

    const body = [
      constDecl("types", '["Product"]'),
      bareExpr('types.forEach(typeName => { const info = reflect(typeName); emit("<p>" + typeName + "</p>"); })'),
    ];
    const errors = [];

    const result = evaluateMetaBlock(metaNode(body), typeRegistry, errors);

    expect(errors).toHaveLength(0);
    expect(result).not.toBeNull();
    const p = result.find(n => n.kind === "markup" && n.tag === "p");
    expect(p).toBeDefined();
  });

});
