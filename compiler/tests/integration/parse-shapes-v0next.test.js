/**
 * Parse-shapes v0next — Phase A1a Steps 8 + 2
 *
 * Step 8 — `E-RESERVED-IDENTIFIER` for `reset` as function name (§6.8 + §34).
 * Step 2 — V5-strict structural state-decl `<NAME> = expr` (Shape 1) and
 *          `const <NAME> = expr` (Shape 3) recognition inside `${...}` logic.
 *
 * Step 2 is the foundational V5-strict parser pass that unblocks Shapes 2/4-6
 * (deferred to Steps 5-11). Per AST-CONTRACTS-AND-DECOMPOSITION §7, every
 * positive test asserts BOTH:
 *   1. The expected `reactive-decl` AST node exists with correct fields.
 *   2. NO `html-fragment` node contains the source text — the deceptive-
 *      success pattern anti-test (PARSER-AUDIT §C.1 / §G.1). Without this
 *      anti-assertion, a "compile-clean but wrong AST" regression would
 *      pass silently.
 */

import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";

function parse(source) {
  const bs = splitBlocks("test.scrml", source);
  return buildAST(bs);
}

function hasReservedIdent(errors) {
  return (errors || []).some((e) => e?.code === "E-RESERVED-IDENTIFIER");
}

/**
 * Walk an AST recursively and collect every node with `kind === target`.
 * Skips circular `block` and `parent` back-refs that some BS-derived nodes
 * carry by ignoring keys that point to nodes we've already visited.
 */
function findKind(ast, target) {
  const out = [];
  const seen = new WeakSet();
  function walk(n) {
    if (!n || typeof n !== "object") return;
    if (seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) {
      n.forEach(walk);
      return;
    }
    if (n.kind === target) out.push(n);
    for (const k of Object.keys(n)) {
      // Skip span (no useful children) and explicit back-refs
      if (k === "span" || k === "parent") continue;
      walk(n[k]);
    }
  }
  walk(ast);
  return out;
}

/**
 * Anti-test helper: assert no html-fragment node's `content` matches the
 * given regex. Catches the deceptive-success pattern where `<count>=0`
 * compiles clean but parses as raw text.
 */
function assertNoHtmlFragmentMatching(ast, regex) {
  const fragments = findKind(ast, "html-fragment");
  for (const f of fragments) {
    expect(f.content || "").not.toMatch(regex);
  }
}

describe("parser emits E-RESERVED-IDENTIFIER for `reset` as function name", () => {
  // §1 Positive — `function reset() {}` in a logic block
  test("§1 `function reset() {}` triggers E-RESERVED-IDENTIFIER", () => {
    const src = `\${ function reset() {} }`;
    const { errors } = parse(src);
    expect(hasReservedIdent(errors)).toBe(true);
  });

  // §2 Positive — `fn reset {}` shorthand in a logic block
  test("§2 `fn reset {}` triggers E-RESERVED-IDENTIFIER", () => {
    const src = `\${ fn reset {} }`;
    const { errors } = parse(src);
    expect(hasReservedIdent(errors)).toBe(true);
  });

  // §3 Negative — function name `notReset` (different identifier)
  test("§3 `function notReset() {}` does NOT trigger E-RESERVED-IDENTIFIER", () => {
    const src = `\${ function notReset() {} }`;
    const { errors } = parse(src);
    expect(hasReservedIdent(errors)).toBe(false);
  });

  // §4 Negative — `function clearCount() {}` (the rename target used in init.js etc.)
  test("§4 `function clearCount() {}` does NOT trigger E-RESERVED-IDENTIFIER", () => {
    const src = `\${ function clearCount() { @count = 0 } }`;
    const { errors } = parse(src);
    expect(hasReservedIdent(errors)).toBe(false);
  });
});

/**
 * Phase A1a Step 2 — Foundational `<NAME>` decl-site recognition.
 *
 * Test cases cover Shapes 1 + 3 + negative guards + anti-html-fragment
 * assertions. Out of scope (deferred): Shape 2 render-spec (Step 5),
 * `default=` / `pinned` modifiers (Step 6), `validators[]` (Step 5),
 * `shape` discriminant population (Step 4), AST kind rename to `state-decl`
 * (Step 3), Variant C compound block parent (Step 11).
 */
describe("A1a Step 2 — V5-strict <NAME>=expr decl recognition (Shape 1)", () => {
  // Case 1: literal int — the central case from PARSER-AUDIT §F1c
  test("Case 1: <count> = 0 produces reactive-decl with structuralForm:true (anti-fragment)", () => {
    const src = `<program>\${ <count> = 0 }</program>`;
    const { ast } = parse(src);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(1);
    expect(decls[0].name).toBe("count");
    expect(decls[0].init).toBe("0");
    expect(decls[0].structuralForm).toBe(true);
    expect(decls[0].isConst).toBeUndefined();
    // Deceptive-success-pattern anti-test
    assertNoHtmlFragmentMatching(ast, /<\s*count\s*>/);
  });

  // Case 2: string literal init
  test("Case 2: <name> = \"\" produces reactive-decl (anti-fragment)", () => {
    const src = `<program>\${ <name> = "" }</program>`;
    const { ast } = parse(src);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(1);
    expect(decls[0].name).toBe("name");
    expect(decls[0].structuralForm).toBe(true);
    assertNoHtmlFragmentMatching(ast, /<\s*name\s*>/);
  });

  // Case 3: array literal init
  test("Case 3: <items> = [] produces reactive-decl (anti-fragment)", () => {
    const src = `<program>\${ <items> = [] }</program>`;
    const { ast } = parse(src);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(1);
    expect(decls[0].name).toBe("items");
    expect(decls[0].structuralForm).toBe(true);
    assertNoHtmlFragmentMatching(ast, /<\s*items\s*>/);
  });

  // Case 4: object literal init
  test("Case 4: <config> = {a:1} produces reactive-decl (anti-fragment)", () => {
    const src = `<program>\${ <config> = {a:1} }</program>`;
    const { ast } = parse(src);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(1);
    expect(decls[0].name).toBe("config");
    expect(decls[0].structuralForm).toBe(true);
    assertNoHtmlFragmentMatching(ast, /<\s*config\s*>/);
  });

  // Case 5: computed expression — confirms initExpr parses through existing acorn path
  test("Case 5: <doubled> = compute(input) produces reactive-decl with parsed initExpr", () => {
    const src = `<program>\${ <doubled> = compute(input) }</program>`;
    const { ast } = parse(src);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(1);
    expect(decls[0].name).toBe("doubled");
    expect(decls[0].init).toContain("compute");
    expect(decls[0].structuralForm).toBe(true);
    expect(decls[0].initExpr).toBeDefined();
    assertNoHtmlFragmentMatching(ast, /<\s*doubled\s*>/);
  });

  // Case 6: no-whitespace form — `<count>=0` (tokenizer fuses >= into one OPERATOR token)
  test("Case 6: <count>=0 (no whitespace, fused >=) produces reactive-decl", () => {
    const src = `<program>\${ <count>=0 }</program>`;
    const { ast } = parse(src);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(1);
    expect(decls[0].name).toBe("count");
    expect(decls[0].structuralForm).toBe(true);
    assertNoHtmlFragmentMatching(ast, /<\s*count\s*>/);
  });

  // Case 7: multiple decls in one block — both produce separate reactive-decls
  test("Case 7: multiple <a>=0; <b>=1 produces two distinct reactive-decls", () => {
    const src = `<program>\${ <a> = 0; <b> = 1 }</program>`;
    const { ast } = parse(src);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(2);
    const names = decls.map((d) => d.name).sort();
    expect(names).toEqual(["a", "b"]);
    for (const d of decls) expect(d.structuralForm).toBe(true);
    assertNoHtmlFragmentMatching(ast, /<\s*a\s*>/);
    assertNoHtmlFragmentMatching(ast, /<\s*b\s*>/);
  });

  // Case 8: mixed @-form and structural — old form keeps producing reactive-decl
  // WITHOUT structuralForm; new form gets structuralForm:true.
  test("Case 8: mixed @x=0; <y>=1 — legacy and structural coexist", () => {
    const src = `<program>\${ @x = 0; <y> = 1 }</program>`;
    const { ast } = parse(src);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(2);
    const xDecl = decls.find((d) => d.name === "x");
    const yDecl = decls.find((d) => d.name === "y");
    expect(xDecl).toBeDefined();
    expect(yDecl).toBeDefined();
    // Legacy @-form: structuralForm absent or false
    expect(xDecl.structuralForm).toBeFalsy();
    // New structural form
    expect(yDecl.structuralForm).toBe(true);
    assertNoHtmlFragmentMatching(ast, /<\s*y\s*>/);
  });
});

describe("A1a Step 2 — V5-strict const <NAME>=expr derived (Shape 3)", () => {
  // Case 9: single dependency
  test("Case 9: const <doubled> = @count * 2 produces reactive-decl with isConst:true", () => {
    const src = `<program>\${ <count> = 0; const <doubled> = @count * 2 }</program>`;
    const { ast } = parse(src);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(2);
    const doubled = decls.find((d) => d.name === "doubled");
    expect(doubled).toBeDefined();
    expect(doubled.isConst).toBe(true);
    expect(doubled.structuralForm).toBe(true);
    expect(doubled.init).toContain("@count");
    expect(doubled.initExpr).toBeDefined();
    assertNoHtmlFragmentMatching(ast, /<\s*doubled\s*>/);
  });

  // Case 10: multi-dependency
  test("Case 10: const <name> = @first + @last (multi-dep) produces reactive-decl", () => {
    const src = `<program>\${ <first> = ""; <last> = ""; const <name> = @first + " " + @last }</program>`;
    const { ast } = parse(src);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(3);
    const nameDecl = decls.find((d) => d.name === "name");
    expect(nameDecl).toBeDefined();
    expect(nameDecl.isConst).toBe(true);
    expect(nameDecl.structuralForm).toBe(true);
    expect(nameDecl.init).toContain("@first");
    expect(nameDecl.init).toContain("@last");
    assertNoHtmlFragmentMatching(ast, /<\s*name\s*>/);
  });
});

describe("A1a Step 2 — Negative guards", () => {
  // Case 11: bare `<` JS comparison must NOT trigger decl recognition.
  // Reuses the disambiguation logic verified by ast-builder-lt-vs-tag-open.test.js.
  test("Case 11: if (a < b) {...} — bare < is comparison, not decl", () => {
    const src = `<program>\${ function f(a, b) { if (a < b) { @count = 1 } } }</program>`;
    const { ast, errors } = parse(src);
    // No reactive-decl named `a` or `b` should be created (those are JS locals
    // in the function param list — not state cells).
    const decls = findKind(ast, "state-decl");
    const a = decls.find((d) => d.name === "a");
    const b = decls.find((d) => d.name === "b");
    expect(a).toBeUndefined();
    expect(b).toBeUndefined();
    // Function declaration was parsed (recognizable function-decl node).
    const fns = findKind(ast, "function-decl");
    expect(fns.length).toBe(1);
    expect(fns[0].name).toBe("f");
  });

  // Case 12: markup tag in expression position is still markup (after `lift` keyword).
  test("Case 12: lift <span>hello</span> — markup, not decl", () => {
    const src = `<program>\${ function f() { lift <span>hello</span> } }</program>`;
    const { ast } = parse(src);
    // No reactive-decl with name "span" should appear.
    const decls = findKind(ast, "state-decl");
    const spanDecl = decls.find((d) => d.name === "span");
    expect(spanDecl).toBeUndefined();
    // The function should still parse.
    const fns = findKind(ast, "function-decl");
    expect(fns.length).toBe(1);
  });

  // Case 13: <Name> with uppercase initial = component-def, NOT state-decl.
  // S26-style: `const Badge = <span>...` is a component-def, but bare `<Badge> = expr`
  // at expression position is the state-decl form. The recognizer DOES match because
  // the lookahead pattern is `<` IDENT `>` `=` regardless of case. This is intentional
  // — the AST contract treats both lowercase and uppercase IDENTs as state-decl names
  // when the structural form is used. Component definitions use the `const Name = <markup>`
  // form (caught by the component-def detector after collectExpr; see line ~5163).
  // For Step 2 we just confirm the legacy const Badge=<span/> path is unchanged.
  test("Case 13: const Badge = <span>hello</span> still produces component-def (regression guard)", () => {
    const src = `<program>\${ const Badge = <span class="badge">hello</span> }</program>`;
    const { ast } = parse(src);
    // The legacy component-def path runs because <span> is reached AFTER the IDENT
    // `Badge` was consumed (i.e., the recognizer saw `const` then `Badge` IDENT, not
    // `const` then `<` PUNCT). So our hook does not fire and the existing path runs.
    const comps = findKind(ast, "component-def");
    expect(comps.length).toBe(1);
    expect(comps[0].name).toBe("Badge");
  });

  // Case 14: less-than with complex RHS — `if (count > 0)` — must NOT trigger.
  // This guards against false-positive on `<` followed by IDENT followed by something
  // that looks like `>`-then-`=` but really isn't.
  test("Case 14: comparison chain a < b > c — no reactive-decl produced", () => {
    const src = `<program>\${ function f(a, b, c) { return (a < b) && (b > c) } }</program>`;
    const { ast } = parse(src);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(0);
  });

  // Case 15: legacy @-form decl + reads work end-to-end (regression baseline)
  test("Case 15: legacy @count=0 still produces reactive-decl (baseline preserved)", () => {
    const src = `<program>\${ @count = 0 }</program>`;
    const { ast } = parse(src);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(1);
    expect(decls[0].name).toBe("count");
    expect(decls[0].init).toBe("0");
    // Legacy form does NOT set structuralForm
    expect(decls[0].structuralForm).toBeFalsy();
  });
});
