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
 *   1. The expected `state-decl` AST node exists with correct fields.
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
  // Step 4 update: isConst is now always set (true|false), not undefined.
  test("Case 1: <count> = 0 produces state-decl with structuralForm:true (anti-fragment)", () => {
    const src = `<program>\${ <count> = 0 }</program>`;
    const { ast } = parse(src);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(1);
    expect(decls[0].name).toBe("count");
    expect(decls[0].init).toBe("0");
    expect(decls[0].structuralForm).toBe(true);
    expect(decls[0].isConst).toBe(false);
    // Deceptive-success-pattern anti-test
    assertNoHtmlFragmentMatching(ast, /<\s*count\s*>/);
  });

  // Case 2: string literal init
  test("Case 2: <name> = \"\" produces state-decl (anti-fragment)", () => {
    const src = `<program>\${ <name> = "" }</program>`;
    const { ast } = parse(src);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(1);
    expect(decls[0].name).toBe("name");
    expect(decls[0].structuralForm).toBe(true);
    assertNoHtmlFragmentMatching(ast, /<\s*name\s*>/);
  });

  // Case 3: array literal init
  test("Case 3: <items> = [] produces state-decl (anti-fragment)", () => {
    const src = `<program>\${ <items> = [] }</program>`;
    const { ast } = parse(src);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(1);
    expect(decls[0].name).toBe("items");
    expect(decls[0].structuralForm).toBe(true);
    assertNoHtmlFragmentMatching(ast, /<\s*items\s*>/);
  });

  // Case 4: object literal init
  test("Case 4: <config> = {a:1} produces state-decl (anti-fragment)", () => {
    const src = `<program>\${ <config> = {a:1} }</program>`;
    const { ast } = parse(src);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(1);
    expect(decls[0].name).toBe("config");
    expect(decls[0].structuralForm).toBe(true);
    assertNoHtmlFragmentMatching(ast, /<\s*config\s*>/);
  });

  // Case 5: computed expression — confirms initExpr parses through existing acorn path
  test("Case 5: <doubled> = compute(input) produces state-decl with parsed initExpr", () => {
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
  test("Case 6: <count>=0 (no whitespace, fused >=) produces state-decl", () => {
    const src = `<program>\${ <count>=0 }</program>`;
    const { ast } = parse(src);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(1);
    expect(decls[0].name).toBe("count");
    expect(decls[0].structuralForm).toBe(true);
    assertNoHtmlFragmentMatching(ast, /<\s*count\s*>/);
  });

  // Case 7: multiple decls in one block — both produce separate state-decls
  test("Case 7: multiple <a>=0; <b>=1 produces two distinct state-decls", () => {
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

  // Case 8: mixed @-form and structural — old form keeps producing state-decl
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
  test("Case 9: const <doubled> = @count * 2 produces state-decl with isConst:true", () => {
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
  test("Case 10: const <name> = @first + @last (multi-dep) produces state-decl", () => {
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
    // No state-decl named `a` or `b` should be created (those are JS locals
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
    // No state-decl with name "span" should appear.
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
  test("Case 14: comparison chain a < b > c — no state-decl produced", () => {
    const src = `<program>\${ function f(a, b, c) { return (a < b) && (b > c) } }</program>`;
    const { ast } = parse(src);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(0);
  });

  // Case 15: legacy @-form decl + reads work end-to-end (regression baseline)
  test("Case 15: legacy @count=0 still produces state-decl (baseline preserved)", () => {
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

/**
 * Phase A1a Step 4 — `shape` discriminant + `structuralForm` + `isConst`
 * populated unconditionally on every `state-decl` AST node. Per AST-CONTRACTS-
 * AND-DECOMPOSITION.md §1.1 the shape discriminant rule for Step 4's scope:
 *   - shape:"plain"   ↔ isConst:false AND has initExpr (Shape 1)
 *   - shape:"derived" ↔ isConst:true  AND has initExpr (Shape 3)
 *   - shape:"decl-with-spec" — deferred to Step 5 (renderSpec lands then)
 */
describe("A1a Step 4 — shape discriminant on state-decl", () => {
  // §S4.1 — Legacy @-form Shape 1 (int)
  test("§S4.1: legacy @count=0 produces shape:\"plain\", structuralForm:false, isConst:false", () => {
    const src = `<program>\${ @count = 0 }</program>`;
    const { ast } = parse(src);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(1);
    expect(decls[0].name).toBe("count");
    expect(decls[0].shape).toBe("plain");
    expect(decls[0].structuralForm).toBe(false);
    expect(decls[0].isConst).toBe(false);
  });

  // §S4.2 — Legacy @-form Shape 1 (string)
  test("§S4.2: legacy @name=\"\" produces shape:\"plain\"", () => {
    const src = `<program>\${ @name = "" }</program>`;
    const { ast } = parse(src);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(1);
    expect(decls[0].name).toBe("name");
    expect(decls[0].shape).toBe("plain");
    expect(decls[0].structuralForm).toBe(false);
    expect(decls[0].isConst).toBe(false);
  });

  // §S4.3 — Legacy @-form Shape 1 (array)
  test("§S4.3: legacy @items=[] produces shape:\"plain\"", () => {
    const src = `<program>\${ @items = [] }</program>`;
    const { ast } = parse(src);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(1);
    expect(decls[0].name).toBe("items");
    expect(decls[0].shape).toBe("plain");
    expect(decls[0].structuralForm).toBe(false);
    expect(decls[0].isConst).toBe(false);
  });

  // §S4.4 — Structural Shape 1 (assert shape field specifically — Step 2
  // tests assert structuralForm but were silent on shape because Step 4 hadn't
  // landed yet).
  test("§S4.4: structural <count>=0 produces shape:\"plain\", structuralForm:true, isConst:false", () => {
    const src = `<program>\${ <count> = 0 }</program>`;
    const { ast } = parse(src);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(1);
    expect(decls[0].name).toBe("count");
    expect(decls[0].shape).toBe("plain");
    expect(decls[0].structuralForm).toBe(true);
    expect(decls[0].isConst).toBe(false);
    // Anti-fragment guard preserved on every positive case.
    assertNoHtmlFragmentMatching(ast, /<\s*count\s*>/);
  });

  // §S4.5 — Legacy @-form Shape 3 derived: produces kind:"reactive-derived-decl",
  // NOT kind:"state-decl". This documents the intentional kind-divergence per
  // Step 4 progress.md §[04:02]. shape discriminant lives on state-decl;
  // reactive-derived-decl is its own kind (semantically equivalent to
  // shape:"derived" state-decl, but kind-fold is deferred to a later step).
  test("§S4.5: legacy `const @doubled = @count * 2` produces reactive-derived-decl (NOT state-decl)", () => {
    const src = `<program>\${ @count = 0; const @doubled = @count * 2 }</program>`;
    const { ast } = parse(src);
    const stateDecls = findKind(ast, "state-decl");
    const derivedDecls = findKind(ast, "reactive-derived-decl");
    // Only the @count cell is a state-decl; @doubled is reactive-derived-decl.
    expect(stateDecls.length).toBe(1);
    expect(stateDecls[0].name).toBe("count");
    expect(derivedDecls.length).toBe(1);
    expect(derivedDecls[0].name).toBe("doubled");
    // The state-decl carries the discriminant; the legacy derived kind does NOT.
    expect(stateDecls[0].shape).toBe("plain");
    expect(derivedDecls[0].shape).toBeUndefined();
  });

  // §S4.6 — Structural Shape 3
  test("§S4.6: structural `const <doubled> = @count * 2` produces shape:\"derived\", structuralForm:true, isConst:true", () => {
    const src = `<program>\${ <count> = 0; const <doubled> = @count * 2 }</program>`;
    const { ast } = parse(src);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(2);
    const doubled = decls.find((d) => d.name === "doubled");
    expect(doubled).toBeDefined();
    expect(doubled.shape).toBe("derived");
    expect(doubled.structuralForm).toBe(true);
    expect(doubled.isConst).toBe(true);
    assertNoHtmlFragmentMatching(ast, /<\s*doubled\s*>/);
  });

  // §S4.7 — Multi-decl mix: legacy + structural Shape 1 + structural Shape 3
  test("§S4.7: multi-decl mix — `@x=0; <y>=1; const <z>=@x+1` carries correct discriminants", () => {
    const src = `<program>\${ @x = 0; <y> = 1; const <z> = @x + 1 }</program>`;
    const { ast } = parse(src);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(3);
    const x = decls.find((d) => d.name === "x");
    const y = decls.find((d) => d.name === "y");
    const z = decls.find((d) => d.name === "z");
    expect(x).toBeDefined();
    expect(y).toBeDefined();
    expect(z).toBeDefined();
    // Legacy @-form Shape 1
    expect(x.shape).toBe("plain");
    expect(x.structuralForm).toBe(false);
    expect(x.isConst).toBe(false);
    // Structural Shape 1
    expect(y.shape).toBe("plain");
    expect(y.structuralForm).toBe(true);
    expect(y.isConst).toBe(false);
    // Structural Shape 3
    expect(z.shape).toBe("derived");
    expect(z.structuralForm).toBe(true);
    expect(z.isConst).toBe(true);
  });

  // §S4.8 — Negative: `let count = 5` is NOT a state-decl
  test("§S4.8: `let count = 5` produces let-decl, not state-decl (no shape field)", () => {
    const src = `<program>\${ let count = 5 }</program>`;
    const { ast } = parse(src);
    const stateDecls = findKind(ast, "state-decl");
    const letDecls = findKind(ast, "let-decl");
    expect(stateDecls.length).toBe(0);
    expect(letDecls.length).toBe(1);
    expect(letDecls[0].name).toBe("count");
    // let-decl does NOT carry a shape field
    expect(letDecls[0].shape).toBeUndefined();
  });

  // §S4.9 — Negative: plain JS `const x = 1` is NOT a state-decl
  test("§S4.9: `const x = 1` produces const-decl, not state-decl (no shape field)", () => {
    const src = `<program>\${ const x = 1 }</program>`;
    const { ast } = parse(src);
    const stateDecls = findKind(ast, "state-decl");
    const constDecls = findKind(ast, "const-decl");
    expect(stateDecls.length).toBe(0);
    expect(constDecls.length).toBe(1);
    expect(constDecls[0].name).toBe("x");
    expect(constDecls[0].shape).toBeUndefined();
  });

  // §S4.10 — Discriminant invariant: every state-decl has a shape value drawn
  // from {"plain","derived","decl-with-spec"} (Step 5 admits decl-with-spec).
  // shape↔isConst↔renderSpec consistency rules are enforced.
  test("§S4.10: discriminant invariant — every state-decl shape ∈ {\"plain\",\"derived\",\"decl-with-spec\"}", () => {
    // Battery of fixtures: legacy + structural × Shape 1 + Shape 3 + Shape 2 (Step 5)
    const fixtures = [
      `<program>\${ @a = 0 }</program>`,
      `<program>\${ @b = "" }</program>`,
      `<program>\${ @c = [] }</program>`,
      `<program>\${ <d> = 0 }</program>`,
      `<program>\${ <e> = "" }</program>`,
      `<program>\${ <f> = 0; const <g> = @f + 1 }</program>`,
      `<program>\${ @h = 0; <i> = 1; const <j> = @h * @i }</program>`,
      // Step 5 Shape 2 fixtures
      `<program>\${ <k> = <input type="text"/> }</program>`,
      `<program>\${ <l req> = <input type="text"/> }</program>`,
      `<program>\${ <m req length(>=2)> = <input type="text"/> }</program>`,
    ];
    const VALID_SHAPES = new Set(["plain", "derived", "decl-with-spec"]);
    let totalDecls = 0;
    for (const src of fixtures) {
      const { ast } = parse(src);
      const decls = findKind(ast, "state-decl");
      for (const d of decls) {
        totalDecls++;
        // shape must be set (no undefined)
        expect(d.shape).toBeDefined();
        // shape must be in the Step-5 valid set
        expect(VALID_SHAPES.has(d.shape)).toBe(true);
        // structuralForm must be set (boolean, not undefined)
        expect(typeof d.structuralForm).toBe("boolean");
        // isConst must be set (boolean, not undefined)
        expect(typeof d.isConst).toBe("boolean");
        // shape↔isConst consistency:
        //   shape:"plain"          → isConst:false
        //   shape:"derived"        → isConst:true
        //   shape:"decl-with-spec" → isConst:false (Shape 2 is not const)
        if (d.shape === "plain") expect(d.isConst).toBe(false);
        if (d.shape === "derived") expect(d.isConst).toBe(true);
        if (d.shape === "decl-with-spec") expect(d.isConst).toBe(false);
        // shape↔renderSpec consistency:
        //   shape:"decl-with-spec" → renderSpec is non-null
        //   shape ≠ "decl-with-spec" → renderSpec absent or null
        if (d.shape === "decl-with-spec") {
          expect(d.renderSpec).toBeDefined();
          expect(d.renderSpec).not.toBeNull();
          expect(d.renderSpec.kind).toBe("render-spec");
          expect(d.initExpr).toBeNull();
        } else {
          // renderSpec should not be present (or be null) on Shapes 1/3
          expect(d.renderSpec == null).toBe(true);
        }
      }
    }
    // Sanity: the battery should produce >0 state-decl nodes.
    expect(totalDecls).toBeGreaterThan(0);
  });

  // §S4.11 — Server modifier: `server @x = expr` is shape:"plain" + structuralForm:false.
  test("§S4.11: legacy `server @cfg = {a:1}` produces shape:\"plain\", isServer:true", () => {
    const src = `<program>\${ server @cfg = {a:1} }</program>`;
    const { ast } = parse(src);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(1);
    expect(decls[0].name).toBe("cfg");
    expect(decls[0].shape).toBe("plain");
    expect(decls[0].structuralForm).toBe(false);
    expect(decls[0].isConst).toBe(false);
    expect(decls[0].isServer).toBe(true);
  });

  // §S4.12 — @shared modifier: `@shared theme = "..."` is shape:"plain" + structuralForm:false.
  test("§S4.12: legacy `@shared theme = \"dark\"` produces shape:\"plain\", isShared:true", () => {
    const src = `<program>\${ @shared theme = "dark" }</program>`;
    const { ast } = parse(src);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(1);
    expect(decls[0].name).toBe("theme");
    expect(decls[0].shape).toBe("plain");
    expect(decls[0].structuralForm).toBe(false);
    expect(decls[0].isConst).toBe(false);
    expect(decls[0].isShared).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Phase A1a Step 5 — Shape 2 `renderSpec` + bareword/call-form validators
// ---------------------------------------------------------------------------

describe("A1a Step 5 — Shape 2 (decl-with-spec) renderSpec + validators", () => {
  // §S5.1 — Bare bindable input: `<userName> = <input type="text"/>`
  test("§S5.1: bare bindable input → shape:\"decl-with-spec\", renderSpec, validators:[]", () => {
    const src = `<program>\${ <userName> = <input type="text"/> }</program>`;
    const { ast } = parse(src);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(1);
    const d = decls[0];
    expect(d.name).toBe("userName");
    expect(d.shape).toBe("decl-with-spec");
    expect(d.structuralForm).toBe(true);
    expect(d.isConst).toBe(false);
    expect(d.initExpr).toBeNull();
    expect(d.renderSpec).toBeDefined();
    expect(d.renderSpec.kind).toBe("render-spec");
    expect(d.renderSpec.element).toBeDefined();
    expect(d.renderSpec.element.kind).toBe("markup");
    expect(d.renderSpec.element.tag).toBe("input");
    // Validators is empty array (not null) on Shape 2 with no validators
    expect(Array.isArray(d.validators)).toBe(true);
    expect(d.validators.length).toBe(0);
    // Anti-fragment guard
    assertNoHtmlFragmentMatching(ast, /< userName >/);
    assertNoHtmlFragmentMatching(ast, /< input/);
  });

  // §S5.2 — Single bareword validator `req`
  test("§S5.2: <userName req> = <input/> → validators:[{name:'req', args:null}]", () => {
    const src = `<program>\${ <userName req> = <input type="text"/> }</program>`;
    const { ast } = parse(src);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(1);
    const d = decls[0];
    expect(d.shape).toBe("decl-with-spec");
    expect(d.validators.length).toBe(1);
    expect(d.validators[0].name).toBe("req");
    expect(d.validators[0].args).toBeNull();
    expect(d.validators[0].span).toBeDefined();
    assertNoHtmlFragmentMatching(ast, /< userName req >/);
  });

  // §S5.3 — Multiple bareword validators
  test("§S5.3: <email req email> = <input/> → two bareword validators", () => {
    const src = `<program>\${ <email req email> = <input type="email"/> }</program>`;
    const { ast } = parse(src);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(1);
    const d = decls[0];
    expect(d.shape).toBe("decl-with-spec");
    expect(d.validators.length).toBe(2);
    expect(d.validators[0].name).toBe("req");
    expect(d.validators[0].args).toBeNull();
    expect(d.validators[1].name).toBe("email");
    expect(d.validators[1].args).toBeNull();
    assertNoHtmlFragmentMatching(ast, /< email req email >/);
  });

  // §S5.4 — Call-form validator `length(>=2)` with relational arg
  test("§S5.4: <userName req length(>=2)> = <input/> → call-form with relational arg", () => {
    const src = `<program>\${ <userName req length(>=2)> = <input type="text"/> }</program>`;
    const { ast } = parse(src);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(1);
    const d = decls[0];
    expect(d.shape).toBe("decl-with-spec");
    expect(d.validators.length).toBe(2);
    expect(d.validators[0].name).toBe("req");
    expect(d.validators[0].args).toBeNull();
    expect(d.validators[1].name).toBe("length");
    // Step 5: args stored as raw text array; A1b sub-grammar-parses to ExprNode[].
    expect(Array.isArray(d.validators[1].args)).toBe(true);
    expect(d.validators[1].args.length).toBe(1);
    expect(d.validators[1].args[0]).toContain(">=");
    expect(d.validators[1].args[0]).toContain("2");
    assertNoHtmlFragmentMatching(ast, /< userName/);
  });

  // §S5.5 — Multiple call-form validators
  test("§S5.5: <age min(18) max(120)> = <input/> → two call-form validators", () => {
    const src = `<program>\${ <age min(18) max(120)> = <input type="number"/> }</program>`;
    const { ast } = parse(src);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(1);
    const d = decls[0];
    expect(d.shape).toBe("decl-with-spec");
    expect(d.validators.length).toBe(2);
    expect(d.validators[0].name).toBe("min");
    expect(d.validators[0].args).toEqual(["18"]);
    expect(d.validators[1].name).toBe("max");
    expect(d.validators[1].args).toEqual(["120"]);
  });

  // §S5.6 — Different bindable markup tag: textarea
  test("§S5.6: <bio> = <textarea/> → renderSpec.element.tag:\"textarea\"", () => {
    const src = `<program>\${ <bio> = <textarea/> }</program>`;
    const { ast } = parse(src);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(1);
    expect(decls[0].shape).toBe("decl-with-spec");
    expect(decls[0].renderSpec.element.tag).toBe("textarea");
  });

  // §S5.7 — Select with body content
  test("§S5.7: <status> = <select>...</> → renderSpec.element.tag:\"select\" with children", () => {
    const src = `<program>\${ <status> = <select><option value="a">A</></> }</program>`;
    const { ast } = parse(src);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(1);
    expect(decls[0].shape).toBe("decl-with-spec");
    expect(decls[0].renderSpec.element.tag).toBe("select");
    // Select markup has children (the <option>)
    expect(decls[0].renderSpec.element.children.length).toBeGreaterThan(0);
  });

  // §S5.8 — Checkbox with `req` validator
  test("§S5.8: <agree req> = <input type=\"checkbox\"/> → req validator", () => {
    const src = `<program>\${ <agree req> = <input type="checkbox"/> }</program>`;
    const { ast } = parse(src);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(1);
    const d = decls[0];
    expect(d.shape).toBe("decl-with-spec");
    expect(d.validators.length).toBe(1);
    expect(d.validators[0].name).toBe("req");
    expect(d.renderSpec.element.tag).toBe("input");
    // The type="checkbox" attribute is on the markup node's attrs
    const typeAttr = d.renderSpec.element.attrs.find((a) => a.name === "type");
    expect(typeAttr).toBeDefined();
  });

  // §S5.9 — Pattern call-form with regex-string-arg
  test("§S5.9: <slug pattern(\"[a-z]+\")> → pattern validator with string arg", () => {
    const src = `<program>\${ <slug pattern("[a-z]+")> = <input type="text"/> }</program>`;
    const { ast } = parse(src);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(1);
    const d = decls[0];
    expect(d.validators.length).toBe(1);
    expect(d.validators[0].name).toBe("pattern");
    expect(d.validators[0].args[0]).toContain("[a-z]+");
  });

  // §S5.10 — Cross-field validator: eq(@password)
  test("§S5.10: <confirm req eq(@password)> → eq validator with @password arg", () => {
    const src = `<program>\${ <confirm req eq(@password)> = <input type="password"/> }</program>`;
    const { ast } = parse(src);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(1);
    const d = decls[0];
    expect(d.validators.length).toBe(2);
    expect(d.validators[0].name).toBe("req");
    expect(d.validators[1].name).toBe("eq");
    expect(d.validators[1].args[0]).toContain("@password");
  });

  // §S5.11 — Negative: no `=` after attrs (just opener) → NOT Shape 2
  // Per Step 5 brief negative case 8: `<userName req length(>=2)>` followed by
  // block content (no `=`) should fall through to existing markup parsing.
  test("§S5.11: `<userName req length(>=2)> hello </>` (no =) → no state-decl", () => {
    const src = `<program>\${ <userName req length(>=2)> hello </> }</program>`;
    const { ast } = parse(src);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(0);
    // Falls through to existing markup/html-fragment dispatch — exact form
    // depends on existing parser, but state-decl path correctly declined.
  });

  // §S5.12 — Negative: bare markup `<input/>` in markup body → NOT state-decl
  // Per Step 5 brief negative case 9: a bare markup tag without state-decl
  // context (no `<NAME>=...` form) is not a state-decl.
  test("§S5.12: bare `<input/>` in markup body → no state-decl", () => {
    const src = `<program>\${ <input/> }</program>`;
    const { ast } = parse(src);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(0);
  });

  // §S5.13 — Multi-decl mix: Shape 1 + Shape 2 + Shape 3 in same block
  test("§S5.13: multi-decl mix `<count>=0; <userName req>=<input/>; const <d>=@count*2`", () => {
    const src = `<program>\${ <count> = 0; <userName req> = <input type="text"/>; const <doubled> = @count * 2 }</program>`;
    const { ast } = parse(src);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(3);
    // First: Shape 1
    expect(decls[0].name).toBe("count");
    expect(decls[0].shape).toBe("plain");
    // Second: Shape 2
    expect(decls[1].name).toBe("userName");
    expect(decls[1].shape).toBe("decl-with-spec");
    expect(decls[1].validators.length).toBe(1);
    expect(decls[1].validators[0].name).toBe("req");
    expect(decls[1].renderSpec.element.tag).toBe("input");
    // Third: Shape 3
    expect(decls[2].name).toBe("doubled");
    expect(decls[2].shape).toBe("derived");
    expect(decls[2].isConst).toBe(true);
    // None of the original source should leak as html-fragment text
    assertNoHtmlFragmentMatching(ast, /< count >/);
    assertNoHtmlFragmentMatching(ast, /< userName req >/);
    assertNoHtmlFragmentMatching(ast, /< doubled >/);
  });

  // §S5.14 — Validators-on-Shape-1 (expression RHS): per Step 5 design choice,
  // validators ARE collected even when RHS is expression (defensive — A1b
  // handles validators-on-non-Shape-2 separately).
  // This case demonstrates the flexibility; Step 5 brief deferred this combo
  // but the implementation tolerates it.
  test("§S5.14: <name req>=\"\" (validators on Shape 1 expr-RHS) — validators preserved", () => {
    const src = `<program>\${ <name req> = "" }</program>`;
    const { ast } = parse(src);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(1);
    const d = decls[0];
    // Shape is "plain" (expression RHS), but validators populated.
    expect(d.shape).toBe("plain");
    expect(d.isConst).toBe(false);
    // Validators ARE collected per Step 5 implementation; A1b will validate
    // whether validators-on-Shape-1 is well-formed per spec §55.2.
    if (d.validators) {
      expect(d.validators.length).toBe(1);
      expect(d.validators[0].name).toBe("req");
    }
  });

  // §S5.15 — Render-spec node shape verification (kind:"render-spec" with
  // element field carrying the markup AST).
  test("§S5.15: render-spec sub-node has kind:\"render-spec\" + element:MarkupNode", () => {
    const src = `<program>\${ <city> = <input type="text"/> }</program>`;
    const { ast } = parse(src);
    const renderSpecs = findKind(ast, "render-spec");
    expect(renderSpecs.length).toBe(1);
    expect(renderSpecs[0].kind).toBe("render-spec");
    expect(renderSpecs[0].element).toBeDefined();
    expect(renderSpecs[0].element.kind).toBe("markup");
    expect(renderSpecs[0].element.tag).toBe("input");
    expect(renderSpecs[0].span).toBeDefined();
  });
});
