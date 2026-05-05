/**
 * Parse mutation shapes — Phase A1a Step 10
 *
 * Verifies that the expression parser + ast-builder produce correctly-shaped AST
 * nodes for the three mutation patterns A1b's L21 walker (E-DERIVED-VALUE-MUTATE)
 * needs to discriminate:
 *   - **MemberCall**       — `@arr.push(x)`, `@obj.foo()`, `@form.errors.push(...)`
 *   - **MemberAssignment** — `@obj.foo = x`, `@obj.foo += 1`, `@arr[i] *= 2`
 *   - **UnaryDelete**      — `delete @obj.foo`, `delete @arr[i]`
 *
 * **Survey finding (Step 10):** scrml does NOT have separate `MemberCall`,
 * `MemberAssignment`, `UnaryDelete` AST kinds. Instead, it uses an ESTree-style
 * flattened representation where:
 *   - Method calls produce `kind: "call"` with `callee.kind: "member" | "index"`.
 *   - Member assignments produce `kind: "assign"` with `target.kind: "member" | "index"`,
 *     and the `op` field carries the assignment operator text (`"="`, `"+="`,
 *     `"*="`, `"&&="`, etc. — full set per AssignExpr.op union).
 *   - Delete produces `kind: "unary"` with `op: "delete"` and `argument.kind:
 *     "member" | "index"`.
 *
 * **Two-layer lowering (Step 10 finding):** ast-builder applies SPECIALIZED
 * lowerings for narrow patterns when they appear in statement position:
 *   - `reactive-array-mutation` — for `@name.method(...)` where `method` is in
 *     ARRAY_MUTATIONS list and `name` is a single segment (line 3531 of
 *     ast-builder.js).
 *   - `reactive-nested-assign` — for `@obj.path = value` with simple `=` only
 *     (line 3555 of ast-builder.js — NOT compound assigns).
 * Other forms (compound assigns, delete, nested-receiver method calls) flow
 * through `bare-expr` with the full ExprNode preserved on `exprNode`.
 *
 * **A1b L21 walker discrimination paths:**
 *   - Specialized kinds  → direct field access (`target`, `path`, `method`).
 *   - Bare-expr kinds    → walk into `exprNode` and inspect `kind` / `op` /
 *                          structural shape.
 *
 * **Scope:** parser-only verification. NO semantic enforcement (that's A1b).
 * NO codegen change. The test asserts AST shape; later A1b will fire L21 on
 * these shapes when the receiver is a `const`-derived cell.
 *
 * **Spec authority:**
 *   §6.6.18 — E-DERIVED-VALUE-MUTATE (L21).
 *   §AST-CONTRACTS-AND-DECOMPOSITION §1.5 — expression nodes; shape preservation only.
 *   §6.6.8 — sibling rule E-DERIVED-WRITE (reassignment form).
 *   §34    — error-code catalog.
 */

import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";

function parse(source) {
  const bs = splitBlocks("test.scrml", source);
  return buildAST(bs);
}

/** Find the body[] of the first logic block in the AST. */
function getLogicBody(ast) {
  let body = null;
  const seen = new WeakSet();
  function walk(n) {
    if (!n || typeof n !== "object" || seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (n.kind === "logic" && Array.isArray(n.body) && body === null) body = n.body;
    for (const k of Object.keys(n)) {
      if (k === "span" || k === "parent") continue;
      walk(n[k]);
    }
  }
  walk(ast);
  return body;
}

/** Walk the leaf-most `ident` inside a chained member/index expression. */
function leafIdent(node) {
  let cur = node;
  while (cur && typeof cur === "object") {
    if (cur.kind === "ident") return cur;
    if (cur.kind === "member") { cur = cur.object; continue; }
    if (cur.kind === "index")  { cur = cur.object; continue; }
    return null;
  }
  return null;
}

describe("A1a Step 10 — mutation shape verification (MemberCall / MemberAssignment / UnaryDelete)", () => {
  // ---------------------------------------------------------------------------
  // §M10.1 — `@arr.push(1)` produces specialized `reactive-array-mutation`
  //
  // Direct array-mutating method on a single-segment @-cell — ast-builder
  // applies the specialized lowering (ast-builder.js:3531). A1b's L21 walker
  // discriminates this form via direct field access on the body node.
  // ---------------------------------------------------------------------------
  test("§M10.1 `@arr.push(1)` → kind: reactive-array-mutation with target=arr, method=push", () => {
    const src = `<program>\${ @arr.push(1) }</program>`;
    const { ast, errors } = parse(src);
    expect(errors.length).toBe(0);
    const body = getLogicBody(ast);
    expect(body).toBeTruthy();
    expect(body.length).toBe(1);
    const node = body[0];
    expect(node.kind).toBe("reactive-array-mutation");
    expect(node.target).toBe("arr");
    expect(node.method).toBe("push");
    expect(node.argsExpr).toBeTruthy();
    // argsExpr should preserve the single argument
    expect(node.argsExpr.kind).toBe("lit");
    expect(node.argsExpr.value).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // §M10.2 — `@obj.foo = 1` produces specialized `reactive-nested-assign`
  //
  // Simple-`=` assignment to dotted path on @-cell — ast-builder applies the
  // specialized lowering (ast-builder.js:3555). A1b's L21 walker discriminates
  // this form via direct field access on the body node.
  // ---------------------------------------------------------------------------
  test("§M10.2 `@obj.foo = 1` → kind: reactive-nested-assign with target=obj, path=[foo]", () => {
    const src = `<program>\${ @obj.foo = 1 }</program>`;
    const { ast, errors } = parse(src);
    expect(errors.length).toBe(0);
    const body = getLogicBody(ast);
    expect(body.length).toBe(1);
    const node = body[0];
    expect(node.kind).toBe("reactive-nested-assign");
    expect(node.target).toBe("obj");
    expect(node.path).toEqual(["foo"]);
    expect(node.valueExpr).toBeTruthy();
    expect(node.valueExpr.kind).toBe("lit");
    expect(node.valueExpr.value).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // §M10.3 — `@obj.foo += 1` (compound assignment) flows through bare-expr
  //
  // Compound assignments are NOT covered by the `reactive-nested-assign`
  // specialized lowering (which is `=` only — ast-builder.js:3555). The body
  // node is `bare-expr` with the full ExprNode preserved, where
  // `exprNode.kind === "assign"` and `exprNode.op === "+="`. This is the path
  // A1b's L21 walker takes for compound-assign discrimination.
  //
  // **CRITICAL FOR A1b:** the `op` field carries the operator text; A1b uses
  // it to confirm "this is a writeback to a derived cell" without having to
  // re-parse the source.
  // ---------------------------------------------------------------------------
  test("§M10.3 `@obj.foo += 1` → kind: bare-expr; exprNode.kind=assign, op=+=", () => {
    const src = `<program>\${ @obj.foo += 1 }</program>`;
    const { ast, errors } = parse(src);
    expect(errors.length).toBe(0);
    const body = getLogicBody(ast);
    expect(body.length).toBe(1);
    const node = body[0];
    expect(node.kind).toBe("bare-expr");
    expect(node.exprNode).toBeTruthy();
    expect(node.exprNode.kind).toBe("assign");
    expect(node.exprNode.op).toBe("+=");
    // target should be a member access on @obj
    expect(node.exprNode.target.kind).toBe("member");
    expect(node.exprNode.target.property).toBe("foo");
    // leaf ident name preserves the @-prefix for A1b discrimination
    const leaf = leafIdent(node.exprNode.target);
    expect(leaf).toBeTruthy();
    expect(leaf.name).toBe("@obj");
  });

  // ---------------------------------------------------------------------------
  // §M10.4 — `@arr[0] = "x"` (computed index assignment) flows through bare-expr
  //
  // Computed-index access does NOT match the `reactive-nested-assign` shape
  // (which expects dotted-path segments via the IDENT/KEYWORD continuation in
  // ast-builder.js:3519). It flows through bare-expr; `target.kind === "index"`
  // distinguishes it from dotted-path forms.
  // ---------------------------------------------------------------------------
  test("§M10.4 `@arr[0] = \"x\"` → kind: bare-expr; exprNode.target.kind=index", () => {
    const src = `<program>\${ @arr[0] = "x" }</program>`;
    const { ast, errors } = parse(src);
    expect(errors.length).toBe(0);
    const body = getLogicBody(ast);
    expect(body.length).toBe(1);
    const node = body[0];
    expect(node.kind).toBe("bare-expr");
    expect(node.exprNode.kind).toBe("assign");
    expect(node.exprNode.op).toBe("=");
    // target is an index expression (computed access)
    expect(node.exprNode.target.kind).toBe("index");
    expect(node.exprNode.target.object.kind).toBe("ident");
    expect(node.exprNode.target.object.name).toBe("@arr");
    // index is the literal 0
    expect(node.exprNode.target.index.kind).toBe("lit");
    expect(node.exprNode.target.index.value).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // §M10.5 — `@arr.length = 0` produces specialized `reactive-nested-assign`
  //
  // `.length =` is a common idiom for clearing arrays and the lowering does
  // NOT special-case it — it uses the generic dotted-path nested-assign
  // shape. A1b will recognize this and fire L21 when @arr is derived
  // (the property write would otherwise lower to clone-mutate-replace per
  // §6.5.1).
  // ---------------------------------------------------------------------------
  test("§M10.5 `@arr.length = 0` → kind: reactive-nested-assign with path=[length]", () => {
    const src = `<program>\${ @arr.length = 0 }</program>`;
    const { ast, errors } = parse(src);
    expect(errors.length).toBe(0);
    const body = getLogicBody(ast);
    expect(body.length).toBe(1);
    const node = body[0];
    expect(node.kind).toBe("reactive-nested-assign");
    expect(node.target).toBe("arr");
    expect(node.path).toEqual(["length"]);
    expect(node.valueExpr.kind).toBe("lit");
    expect(node.valueExpr.value).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // §M10.6 — `delete @obj.foo` flows through bare-expr; exprNode.kind=unary, op=delete
  //
  // `delete` is the standard ESTree UnaryExpression with operator="delete";
  // scrml maps `operator` → `op` at esTreeToExprNode boundary
  // (expression-parser.ts:957-967). The body node is `bare-expr`; A1b walks
  // into `exprNode` and checks `op === "delete"` + that `argument` is a
  // member/index expression with @-prefixed leaf.
  // ---------------------------------------------------------------------------
  test("§M10.6 `delete @obj.foo` → kind: bare-expr; exprNode.kind=unary, op=delete, argument=member", () => {
    const src = `<program>\${ delete @obj.foo }</program>`;
    const { ast, errors } = parse(src);
    expect(errors.length).toBe(0);
    const body = getLogicBody(ast);
    expect(body.length).toBe(1);
    const node = body[0];
    expect(node.kind).toBe("bare-expr");
    expect(node.exprNode.kind).toBe("unary");
    expect(node.exprNode.op).toBe("delete");
    expect(node.exprNode.prefix).toBe(true);
    expect(node.exprNode.argument.kind).toBe("member");
    expect(node.exprNode.argument.property).toBe("foo");
    const leaf = leafIdent(node.exprNode.argument);
    expect(leaf.name).toBe("@obj");
  });

  // ---------------------------------------------------------------------------
  // §M10.7 — Compound-receiver method call: `@form.errors.push(@form.errors.length)`
  //
  // The `reactive-array-mutation` specialization requires `pathSegments.length === 1`
  // (ast-builder.js:3531). For nested receivers like `@form.errors.push(...)`,
  // `pathSegments = ["errors", "push"]` (length 2), so it falls through to
  // bare-expr. The exprNode is `kind: "call"` with `callee.kind: "member"`
  // and the leaf ident in the receiver chain is `@form`.
  //
  // **CRITICAL FOR A1b:** in-compound derived sub-cells (§6.6.18 case 3) use
  // exactly this shape — `@compound.derivedField.push(x)`. A1b walks
  // callee.object until it finds the leaf ident, then resolves the canonical
  // path through the compound to determine if the sub-cell is derived.
  // ---------------------------------------------------------------------------
  test("§M10.7 `@form.errors.push(@form.errors.length)` → kind: bare-expr; chained member receiver", () => {
    const src = `<program>\${ @form.errors.push(@form.errors.length) }</program>`;
    const { ast, errors } = parse(src);
    expect(errors.length).toBe(0);
    const body = getLogicBody(ast);
    expect(body.length).toBe(1);
    const node = body[0];
    expect(node.kind).toBe("bare-expr");
    expect(node.exprNode.kind).toBe("call");
    expect(node.exprNode.callee.kind).toBe("member");
    expect(node.exprNode.callee.property).toBe("push");
    // callee.object is the receiver — itself a member node `@form.errors`
    expect(node.exprNode.callee.object.kind).toBe("member");
    expect(node.exprNode.callee.object.property).toBe("errors");
    // leaf ident at the receiver chain root
    const leaf = leafIdent(node.exprNode.callee);
    expect(leaf).toBeTruthy();
    expect(leaf.name).toBe("@form");
    // args[0] is `@form.errors.length` — its leaf ident should also be @form
    expect(node.exprNode.args.length).toBe(1);
    expect(node.exprNode.args[0].kind).toBe("member");
    expect(node.exprNode.args[0].property).toBe("length");
    const argLeaf = leafIdent(node.exprNode.args[0]);
    expect(argLeaf.name).toBe("@form");
  });

  // ---------------------------------------------------------------------------
  // §M10.8 — Negative: `arr.push(1)` (no `@`) parses as plain JS, leaf ident
  //          has NO `@`-prefix. A1b will use this distinction to skip non-
  //          reactive method calls.
  //
  // The bare identifier `arr` is treated as a plain JS local; the body node
  // is `bare-expr` and `leaf.name === "arr"` (no `@`). A1b's walker checks
  // `name.startsWith("@")` to filter.
  // ---------------------------------------------------------------------------
  test("§M10.8 `arr.push(1)` (no @) → kind: bare-expr; leaf ident has NO @-prefix", () => {
    const src = `<program>\${ arr.push(1) }</program>`;
    const { ast, errors } = parse(src);
    expect(errors.length).toBe(0);
    const body = getLogicBody(ast);
    expect(body.length).toBe(1);
    const node = body[0];
    expect(node.kind).toBe("bare-expr");
    expect(node.exprNode.kind).toBe("call");
    expect(node.exprNode.callee.kind).toBe("member");
    const leaf = leafIdent(node.exprNode.callee);
    expect(leaf.name).toBe("arr");
    expect(leaf.name.startsWith("@")).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // §M10.9 — Computed-index delete: `delete @arr[i]`
  //
  // Mirror of §M10.6 but with computed (index) access on the argument. A1b
  // discriminates by checking `argument.kind === "index"` instead of "member".
  // ---------------------------------------------------------------------------
  test("§M10.9 `delete @arr[i]` → kind: bare-expr; exprNode.argument.kind=index", () => {
    const src = `<program>\${ delete @arr[i] }</program>`;
    const { ast, errors } = parse(src);
    expect(errors.length).toBe(0);
    const body = getLogicBody(ast);
    expect(body.length).toBe(1);
    const node = body[0];
    expect(node.kind).toBe("bare-expr");
    expect(node.exprNode.kind).toBe("unary");
    expect(node.exprNode.op).toBe("delete");
    expect(node.exprNode.argument.kind).toBe("index");
    expect(node.exprNode.argument.object.kind).toBe("ident");
    expect(node.exprNode.argument.object.name).toBe("@arr");
    // index is the local variable `i` (a plain ident in this expression)
    expect(node.exprNode.argument.index.kind).toBe("ident");
    expect(node.exprNode.argument.index.name).toBe("i");
  });

  // ---------------------------------------------------------------------------
  // §M10.10 — Logical compound assign on chained member: `@form.config.mode ??= "default"`
  //
  // Verifies the full `op` repertoire on AssignExpr (per types/ast.ts:1398-1401)
  // round-trips through esTreeToExprNode. The `??=` form is critical for A1b:
  // it's logically a writeback to the derived cell when the property is null,
  // so L21 must fire on derived cells with this op as well.
  // ---------------------------------------------------------------------------
  test("§M10.10 `@form.config.mode ??= \"default\"` → kind: bare-expr; exprNode.op=??=", () => {
    const src = `<program>\${ @form.config.mode ??= "default" }</program>`;
    const { ast, errors } = parse(src);
    expect(errors.length).toBe(0);
    const body = getLogicBody(ast);
    expect(body.length).toBe(1);
    const node = body[0];
    expect(node.kind).toBe("bare-expr");
    expect(node.exprNode.kind).toBe("assign");
    expect(node.exprNode.op).toBe("??=");
    // chained member target
    expect(node.exprNode.target.kind).toBe("member");
    expect(node.exprNode.target.property).toBe("mode");
    expect(node.exprNode.target.object.kind).toBe("member");
    expect(node.exprNode.target.object.property).toBe("config");
    const leaf = leafIdent(node.exprNode.target);
    expect(leaf.name).toBe("@form");
    // value is the literal "default"
    expect(node.exprNode.value.kind).toBe("lit");
    expect(node.exprNode.value.value).toBe("default");
  });
});
