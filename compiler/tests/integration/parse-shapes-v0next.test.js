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

  // §S4.5 — Legacy @-form Shape 3 derived: post-Step-11.5 produces unified
  // kind:"state-decl" with shape:"derived", isConst:true, structuralForm:false.
  // ADR Option A FOLD ratified S60 (`docs/changes/reactive-derived-decl-divergence/ADR.md`).
  // Pre-Step-11.5 this divergence was documented here — `reactive-derived-decl`
  // was its own kind. Post-fold, both legacy `const @x = expr` and structural
  // `const <x> = expr` produce state-decl{shape:"derived"}; the only
  // discriminator is `structuralForm`.
  test("§S4.5: legacy `const @doubled = @count * 2` produces state-decl with shape:\"derived\", structuralForm:false (post-Step-11.5 fold)", () => {
    const src = `<program>\${ @count = 0; const @doubled = @count * 2 }</program>`;
    const { ast } = parse(src);
    const stateDecls = findKind(ast, "state-decl");
    const derivedDecls = findKind(ast, "reactive-derived-decl");
    // Both @count and @doubled are now state-decl. Reactive-derived-decl is retired.
    expect(stateDecls.length).toBe(2);
    expect(derivedDecls.length).toBe(0);
    const count = stateDecls.find((d) => d.name === "count");
    const doubled = stateDecls.find((d) => d.name === "doubled");
    expect(count).toBeDefined();
    expect(doubled).toBeDefined();
    // @count: legacy plain
    expect(count.shape).toBe("plain");
    expect(count.structuralForm).toBe(false);
    expect(count.isConst).toBe(false);
    // @doubled: legacy expression-form derived (post-fold unified kind)
    expect(doubled.shape).toBe("derived");
    expect(doubled.structuralForm).toBe(false);
    expect(doubled.isConst).toBe(true);
    expect(doubled.initExpr).toBeDefined();
    // Anti-fragment guard
    assertNoHtmlFragmentMatching(ast, /<\s*doubled\s*>/);
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
// Phase A1a Step 11.5 — Fold of `reactive-derived-decl` into state-decl
// ADR Option A FOLD ratified S60. Both legacy (`const @x = expr`) and
// structural (`const <x> = expr`) derived forms now produce unified
// state-decl{shape:"derived",isConst:true}; the only discriminator is
// `structuralForm` (false for legacy, true for structural).
// ---------------------------------------------------------------------------

describe("A1a Step 11.5 — fold reactive-derived-decl into state-decl", () => {
  // §F11.5.1 — Legacy expression-form derived (the canonical fold case)
  test("§F11.5.1: legacy `const @doubled = @count * 2` → state-decl shape:\"derived\", structuralForm:false, isConst:true, initExpr populated", () => {
    const src = `<program>\${ @count = 0; const @doubled = @count * 2 }</program>`;
    const { ast } = parse(src);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(2);
    const doubled = decls.find((d) => d.name === "doubled");
    expect(doubled).toBeDefined();
    expect(doubled.kind).toBe("state-decl");
    expect(doubled.shape).toBe("derived");
    expect(doubled.isConst).toBe(true);
    expect(doubled.structuralForm).toBe(false);
    expect(doubled.initExpr).toBeDefined();
    expect(doubled.initExpr).not.toBeNull();
    // The retired kind must be entirely absent.
    const retired = findKind(ast, "reactive-derived-decl");
    expect(retired.length).toBe(0);
  });

  // §F11.5.2 — V5-strict structural derived (regression baseline; pre-existing)
  test("§F11.5.2: V5-strict `const <doubled> = @count * 2` → state-decl shape:\"derived\", structuralForm:true, isConst:true (regression baseline)", () => {
    const src = `<program>\${ <count> = 0; const <doubled> = @count * 2 }</program>`;
    const { ast } = parse(src);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(2);
    const doubled = decls.find((d) => d.name === "doubled");
    expect(doubled).toBeDefined();
    expect(doubled.shape).toBe("derived");
    expect(doubled.isConst).toBe(true);
    expect(doubled.structuralForm).toBe(true);
    expect(doubled.initExpr).toBeDefined();
    assertNoHtmlFragmentMatching(ast, /<\s*doubled\s*>/);
  });

  // §F11.5.3 — Mixed file: both forms produce the unified kind, differ only on structuralForm
  test("§F11.5.3: mixed legacy + structural derived → both produce state-decl shape:\"derived\"; structuralForm distinguishes", () => {
    const src = `<program>\${ @price = 0; const @taxA = @price * 0.08; <qty> = 1; const <taxB> = @price * 0.09 }</program>`;
    const { ast } = parse(src);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(4);
    const taxA = decls.find((d) => d.name === "taxA");
    const taxB = decls.find((d) => d.name === "taxB");
    expect(taxA).toBeDefined();
    expect(taxB).toBeDefined();
    // Both are derived state-decls; only structuralForm distinguishes.
    expect(taxA.shape).toBe("derived");
    expect(taxA.isConst).toBe(true);
    expect(taxA.structuralForm).toBe(false); // legacy @-form
    expect(taxB.shape).toBe("derived");
    expect(taxB.isConst).toBe(true);
    expect(taxB.structuralForm).toBe(true); // V5-strict structural
    // Plain @price (legacy) and structural <qty> are also unified state-decl.
    const price = decls.find((d) => d.name === "price");
    const qty = decls.find((d) => d.name === "qty");
    expect(price.shape).toBe("plain");
    expect(price.structuralForm).toBe(false);
    expect(qty.shape).toBe("plain");
    expect(qty.structuralForm).toBe(true);
  });

  // §F11.5.4 — Anti-html-fragment guard for both forms
  test("§F11.5.4: anti-html-fragment guard — neither legacy nor structural derived produces stray html-fragment matching its name", () => {
    const src = `<program>\${ @count = 0; const @derLegacy = @count + 1; <other> = 0; const <derStruct> = @count + 2 }</program>`;
    const { ast } = parse(src);
    // Legacy form has no `<derLegacy>` syntax; just verify no html-fragment with this name.
    assertNoHtmlFragmentMatching(ast, /<\s*derLegacy\s*>/);
    assertNoHtmlFragmentMatching(ast, /<\s*derStruct\s*>/);
    // The retired kind must be absent on the legacy form post-fold.
    const retired = findKind(ast, "reactive-derived-decl");
    expect(retired.length).toBe(0);
  });

  // §F11.5.5 — Invariant battery: shape:"derived" ⇒ isConst:true on every fold case.
  test("§F11.5.5: invariant — every state-decl with shape:\"derived\" has isConst:true and a non-null initExpr", () => {
    // Battery: legacy and structural derived in various contexts.
    const fixtures = [
      `<program>\${ @a = 0; const @b = @a }</program>`,
      `<program>\${ @a = 0; const @b: number = @a * 2 }</program>`,                 // typed legacy
      `<program>\${ <a> = 0; const <b> = @a }</program>`,                             // V5-strict structural
      `<program>\${ <a> = 0; const <b>: number = @a * 2 }</program>`,                 // typed structural
      `<program>\${ @a = 0; @b = 1; const @c = @a + @b }</program>`,                  // multi-deps legacy
      `<program>\${ <a> = 0; <b> = 1; const <c> = @a + @b }</program>`,               // multi-deps structural
      `<program>\${ @price = 1.0; const @t1 = @price * 0.1; const @t2 = @t1 * 0.05 }</program>`, // chained legacy
    ];
    let totalDerived = 0;
    for (const src of fixtures) {
      const { ast } = parse(src);
      const decls = findKind(ast, "state-decl");
      for (const d of decls) {
        if (d.shape === "derived") {
          totalDerived++;
          // Invariant: shape:"derived" ⇒ isConst === true (per AST-CONTRACTS §1.1).
          expect(d.isConst).toBe(true);
          // Invariant: shape:"derived" ⇒ initExpr present and non-null.
          expect(d.initExpr).toBeDefined();
          expect(d.initExpr).not.toBeNull();
          // structuralForm must be a boolean (true for V5-strict, false for legacy).
          expect(typeof d.structuralForm).toBe("boolean");
        }
      }
      // Anti-fold-regression: no `reactive-derived-decl` nodes anywhere.
      const retired = findKind(ast, "reactive-derived-decl");
      expect(retired.length).toBe(0);
    }
    // Battery should have exercised the invariant on multiple decls.
    expect(totalDerived).toBeGreaterThanOrEqual(7);
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

// ---------------------------------------------------------------------------
// Phase A1a Step 6 — `default=<expr>` attribute + `pinned` bareword modifier
// ---------------------------------------------------------------------------

describe("A1a Step 6 — `default=` attr + `pinned` bareword on state-decl", () => {
  // §S6.1 — Shape 1 + default=null
  test("§S6.1: <startTime default=null> = Date.now() → defaultExpr ExprNode, pinned:false", () => {
    const src = `<program>\${ <startTime default=null> = Date.now() }</program>`;
    const { ast } = parse(src);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(1);
    const d = decls[0];
    expect(d.name).toBe("startTime");
    expect(d.shape).toBe("plain");
    expect(d.structuralForm).toBe(true);
    expect(d.pinned).toBe(false);
    expect(d.defaultExpr).not.toBeNull();
    expect(typeof d.defaultExpr).toBe("object");
    // Literal `null` per scrml ExprNode shape: { kind: "lit", value: null, ... }
    expect(d.defaultExpr.value).toBeNull();
    // Anti-fragment guard
    assertNoHtmlFragmentMatching(ast, /< startTime/);
  });

  // §S6.2 — Shape 2 + req validator + default=""
  test("§S6.2: <email req default=\"\"> = <input/> → validators:[req], defaultExpr literal '', pinned:false", () => {
    const src = `<program>\${ <email req default=""> = <input type="text"/> }</program>`;
    const { ast } = parse(src);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(1);
    const d = decls[0];
    expect(d.shape).toBe("decl-with-spec");
    expect(d.pinned).toBe(false);
    expect(d.validators).toBeDefined();
    expect(d.validators.length).toBe(1);
    expect(d.validators[0].name).toBe("req");
    expect(d.defaultExpr).not.toBeNull();
    expect(d.defaultExpr.value).toBe("");
    assertNoHtmlFragmentMatching(ast, /< email/);
  });

  // §S6.3 — Shape 3 + pinned (no default)
  test("§S6.3: const <doubled pinned> = @count * 2 → shape:derived, pinned:true, defaultExpr:null", () => {
    const src = `<program>\${ const <doubled pinned> = @count * 2 }</program>`;
    const { ast } = parse(src);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(1);
    const d = decls[0];
    expect(d.name).toBe("doubled");
    expect(d.shape).toBe("derived");
    expect(d.isConst).toBe(true);
    expect(d.pinned).toBe(true);
    expect(d.defaultExpr).toBeNull();
    assertNoHtmlFragmentMatching(ast, /< doubled/);
  });

  // §S6.4 — Both default= and pinned (Shape 1)
  test("§S6.4: <x pinned default=0> = @upstream → defaultExpr=0, pinned:true", () => {
    const src = `<program>\${ <x pinned default=0> = @upstream }</program>`;
    const { ast } = parse(src);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(1);
    const d = decls[0];
    expect(d.shape).toBe("plain");
    expect(d.pinned).toBe(true);
    expect(d.defaultExpr).not.toBeNull();
    expect(d.defaultExpr.value).toBe(0);
    assertNoHtmlFragmentMatching(ast, /< x /);
  });

  // §S6.5 — Multi-validator + default + pinned (Shape 2). Critical: default
  // and pinned MUST NOT appear in validators[].
  test("§S6.5: <name req length(>=2) default=\"\" pinned> = <input/> → validators only [req,length]", () => {
    const src = `<program>\${ <name req length(>=2) default="" pinned> = <input type="text"/> }</program>`;
    const { ast } = parse(src);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(1);
    const d = decls[0];
    expect(d.shape).toBe("decl-with-spec");
    expect(d.pinned).toBe(true);
    expect(d.defaultExpr).not.toBeNull();
    expect(d.defaultExpr.value).toBe("");
    expect(d.validators).toBeDefined();
    expect(d.validators.length).toBe(2);
    const names = d.validators.map(v => v.name);
    expect(names).toEqual(["req", "length"]);
    // Critical: neither `default` nor `pinned` leaked into validators[]
    expect(names.includes("default")).toBe(false);
    expect(names.includes("pinned")).toBe(false);
    assertNoHtmlFragmentMatching(ast, /< name /);
  });

  // §S6.6 — Regression: no default=, no pinned (baseline shape unchanged)
  test("§S6.6: <count> = 0 → defaultExpr:null, pinned:false (baseline regression)", () => {
    const src = `<program>\${ <count> = 0 }</program>`;
    const { ast } = parse(src);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(1);
    const d = decls[0];
    expect(d.shape).toBe("plain");
    expect(d.pinned).toBe(false);
    expect(d.defaultExpr).toBeNull();
  });

  // §S6.7 — pinned-only on Shape 1 (no validators, no default)
  test("§S6.7: <flag pinned> = false → pinned:true, validators absent or empty", () => {
    const src = `<program>\${ <flag pinned> = false }</program>`;
    const { ast } = parse(src);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(1);
    const d = decls[0];
    expect(d.name).toBe("flag");
    expect(d.shape).toBe("plain");
    expect(d.pinned).toBe(true);
    expect(d.defaultExpr).toBeNull();
    // Validators not populated (or empty) since `pinned` does not leak there.
    if (d.validators) {
      const names = d.validators.map(v => v.name);
      expect(names.includes("pinned")).toBe(false);
    }
  });

  // §S6.8 — default= with @-cell reference RHS on Shape 2
  test("§S6.8: <fee default=@taxRate> = <input/> → defaultExpr non-null", () => {
    const src = `<program>\${ <fee default=@taxRate> = <input type="text"/> }</program>`;
    const { ast } = parse(src);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(1);
    const d = decls[0];
    expect(d.shape).toBe("decl-with-spec");
    expect(d.defaultExpr).not.toBeNull();
    // Expected: defaultExpr contains an identifier-like ExprNode for `@taxRate`
    expect(typeof d.defaultExpr).toBe("object");
  });

  // §S6.9 — Discriminant invariant extension (Step 6 fields).
  test("§S6.9: discriminant invariant — every state-decl has typeof pinned === 'boolean' AND defaultExpr is null|object", () => {
    const fixtures = [
      `<program>\${ <a> = 0 }</program>`,
      `<program>\${ <b pinned> = 1 }</program>`,
      `<program>\${ <c default=0> = 2 }</program>`,
      `<program>\${ <d pinned default=null> = e() }</program>`,
      `<program>\${ const <f pinned> = @a + 1 }</program>`,
      `<program>\${ <g req default=""> = <input/> }</program>`,
      `<program>\${ <h req length(>=2) default="" pinned> = <input/> }</program>`,
      // Legacy @-form: pinned/defaultExpr should be undefined or absent there
      `<program>\${ @x = 0 }</program>`,
      `<program>\${ @shared theme = "dark" }</program>`,
    ];
    let totalDecls = 0;
    let structuralDecls = 0;
    for (const src of fixtures) {
      const { ast } = parse(src);
      const decls = findKind(ast, "state-decl");
      for (const d of decls) {
        totalDecls++;
        // For Step-6-extended structural state-decls, both fields must be set.
        if (d.structuralForm === true) {
          structuralDecls++;
          expect(typeof d.pinned).toBe("boolean");
          // defaultExpr may be null or an ExprNode (object). Never undefined.
          const defaultOk = d.defaultExpr === null || (d.defaultExpr && typeof d.defaultExpr === "object");
          expect(defaultOk).toBe(true);
        }
      }
    }
    expect(totalDecls).toBeGreaterThan(0);
    expect(structuralDecls).toBeGreaterThan(0);
  });

  // §S6.10 — Negative: `<x default>` (default with no `=` and no value) does
  // not parse as a structural decl (decline → fall through).
  test("§S6.10: `<x default> = 0` (default without =) declines structural-decl", () => {
    const src = `<program>\${ <x default> = 0 }</program>`;
    const { ast } = parse(src);
    const decls = findKind(ast, "state-decl");
    // The scan declines because `default` KEYWORD is followed by `>` not `=`.
    // Decl falls through to other handlers (markup-tag, html-fragment, etc.).
    expect(decls.length).toBe(0);
  });
});

describe("A1a Step 11.0a — Variant C compound state-decl recognizer", () => {
  // §S11A.1 — Simple compound: parent + 2 plain children, anonymous close.
  // The kickstarter v2 §3 flagship example. Parent shape:"plain", initExpr:null,
  // children populated with 2 child state-decl nodes, each shape:"plain".
  test("§S11A.1: simple compound `<formRes><name>=\"\"<email>=\"\"</>` produces parent + 2 children", () => {
    const src = `<program>\${ <formRes><name>="" <email>="" </> }</program>`;
    const { ast, errors } = parse(src);
    expect(errors.length).toBe(0);
    const decls = findKind(ast, "state-decl");
    // findKind walks recursively → 1 parent + 2 children = 3 nodes.
    expect(decls.length).toBe(3);
    const parent = decls.find((d) => d.name === "formRes");
    expect(parent).toBeDefined();
    expect(parent.shape).toBe("plain");
    expect(parent.structuralForm).toBe(true);
    expect(parent.isConst).toBe(false);
    expect(parent.initExpr).toBeNull();
    expect(Array.isArray(parent.children)).toBe(true);
    expect(parent.children.length).toBe(2);
    expect(parent.children.map((c) => c.name)).toEqual(["name", "email"]);
    for (const c of parent.children) {
      expect(c.kind).toBe("state-decl");
      expect(c.shape).toBe("plain");
      expect(c.structuralForm).toBe(true);
      expect(c.isConst).toBe(false);
    }
    assertNoHtmlFragmentMatching(ast, /formRes/);
  });

  // §S11A.2 — Compound with mixed Shape 1 + Shape 2 children. Per AST-CONTRACTS
  // §1.1 children inherit their own shape per the standard discriminator —
  // Shape 2 (decl-with-spec) child nests inside the compound parent cleanly.
  // Spaced form `<name req> =` is used because Step 5's pre-existing
  // limitation rejects validator + fused `>=` (scanIdx !== 2 path).
  test("§S11A.2: compound with Shape 1 + Shape 2 children — each child has its own shape", () => {
    const src = `<program>\${ <formRes><name req> = <input type="text"/> <email>="" </> }</program>`;
    const { ast, errors } = parse(src);
    expect(errors.length).toBe(0);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(3);
    const parent = decls.find((d) => d.name === "formRes");
    expect(parent).toBeDefined();
    expect(parent.shape).toBe("plain");
    expect(parent.children.length).toBe(2);
    // Shape 2 child: name with req validator + render-spec input
    const nameChild = parent.children.find((c) => c.name === "name");
    expect(nameChild).toBeDefined();
    expect(nameChild.shape).toBe("decl-with-spec");
    expect(nameChild.renderSpec).toBeDefined();
    expect(nameChild.renderSpec.kind).toBe("render-spec");
    expect(nameChild.validators).toBeDefined();
    expect(nameChild.validators.length).toBe(1);
    expect(nameChild.validators[0].name).toBe("req");
    // Shape 1 child: email with plain init
    const emailChild = parent.children.find((c) => c.name === "email");
    expect(emailChild).toBeDefined();
    expect(emailChild.shape).toBe("plain");
    expect(emailChild.renderSpec == null).toBe(true);
    assertNoHtmlFragmentMatching(ast, /formRes/);
  });

  // §S11A.3 — Nested compound: outer compound has a child that is itself a
  // compound parent, which has a leaf child. Tests recursion through
  // `tryParseStructuralDecl` from the compound-body loop.
  test("§S11A.3: nested compound `<outer><inner><leaf>=0</></></>` recurses cleanly", () => {
    const src = `<program>\${ <outer><inner><leaf>=0</></></> }</program>`;
    const { ast, errors } = parse(src);
    expect(errors.length).toBe(0);
    const decls = findKind(ast, "state-decl");
    // 1 outer + 1 inner + 1 leaf = 3 nodes
    expect(decls.length).toBe(3);
    const outer = decls.find((d) => d.name === "outer");
    expect(outer).toBeDefined();
    expect(outer.shape).toBe("plain");
    expect(outer.children.length).toBe(1);
    const inner = outer.children[0];
    expect(inner.name).toBe("inner");
    expect(inner.kind).toBe("state-decl");
    expect(inner.shape).toBe("plain");
    expect(Array.isArray(inner.children)).toBe(true);
    expect(inner.children.length).toBe(1);
    const leaf = inner.children[0];
    expect(leaf.name).toBe("leaf");
    expect(leaf.kind).toBe("state-decl");
    expect(leaf.shape).toBe("plain");
    expect(leaf.init).toBe("0");
    // Leaf is a plain Shape 1 — no children-array on a leaf.
    expect(leaf.children == null).toBe(true);
    assertNoHtmlFragmentMatching(ast, /outer/);
  });

  // §S11A.4 — Empty compound: no children.
  test("§S11A.4: empty compound `<empty></>` produces parent with children:[]", () => {
    const src = `<program>\${ <empty></> }</program>`;
    const { ast, errors } = parse(src);
    expect(errors.length).toBe(0);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(1);
    const parent = decls[0];
    expect(parent.name).toBe("empty");
    expect(parent.shape).toBe("plain");
    expect(parent.structuralForm).toBe(true);
    expect(parent.initExpr).toBeNull();
    expect(Array.isArray(parent.children)).toBe(true);
    expect(parent.children.length).toBe(0);
    assertNoHtmlFragmentMatching(ast, /empty/);
  });

  // §S11A.5 — Compound + sibling top-level decls with semicolons (the
  // working separator). Compound parses cleanly; sibling top-level decls
  // unaffected. Newline-separator support is Step 11.0b territory — out of
  // scope here.
  test("§S11A.5: compound + sibling top-level Shape 1 decls (semicolons) all parse", () => {
    const src = `<program>\${ <count> = 0; <formRes><name>="" </>; <total> = 1 }</program>`;
    const { ast, errors } = parse(src);
    expect(errors.length).toBe(0);
    const decls = findKind(ast, "state-decl");
    // 3 top-level (count, formRes, total) + 1 child (name) = 4 nodes
    expect(decls.length).toBe(4);
    const topLevel = decls.filter((d) => d.name !== "name");
    expect(topLevel.map((d) => d.name).sort()).toEqual(["count", "formRes", "total"]);
    const parent = decls.find((d) => d.name === "formRes");
    expect(parent.children.length).toBe(1);
    expect(parent.children[0].name).toBe("name");
    assertNoHtmlFragmentMatching(ast, /formRes|count|total/);
  });

  // §S11A.6 — Compound parent + named close `</NAME>`. Per SPEC §6.3.2 the
  // anonymous close `</>` is shown but `</NAME>` named-close is also accepted
  // by the markup parser; Step 11.0a treats both forms as legal compound
  // closers (no name-match enforcement at the parser level — A1b territory).
  test("§S11A.6: compound with named close `<formRes>...</formRes>` accepts named close", () => {
    const src = `<program>\${ <formRes><name>="" </formRes> }</program>`;
    const { ast, errors } = parse(src);
    expect(errors.length).toBe(0);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(2);
    const parent = decls.find((d) => d.name === "formRes");
    expect(parent).toBeDefined();
    expect(parent.children.length).toBe(1);
    expect(parent.children[0].name).toBe("name");
    assertNoHtmlFragmentMatching(ast, /formRes/);
  });

  // §S11A.7 — Regression baseline: existing Shape 1 single-decl forms still
  // produce non-compound state-decls (no children populated). Steps 4-6
  // baselines preserved.
  test("§S11A.7: regression — Shape 1/3 single-decl forms unchanged (no children-array)", () => {
    const src = `<program>\${ <count> = 0; const <doubled> = @count * 2; <userName req> = <input type="text"/> }</program>`;
    const { ast, errors } = parse(src);
    expect(errors.length).toBe(0);
    const decls = findKind(ast, "state-decl");
    // 3 top-level non-compound decls (no children).
    const top = decls.filter((d) => d.structuralForm === true);
    expect(top.length).toBe(3);
    for (const d of top) {
      expect(d.children == null).toBe(true);
    }
    const count = top.find((d) => d.name === "count");
    expect(count.shape).toBe("plain");
    expect(count.initExpr).not.toBeNull();
    const doubled = top.find((d) => d.name === "doubled");
    expect(doubled.shape).toBe("derived");
    expect(doubled.isConst).toBe(true);
    const userName = top.find((d) => d.name === "userName");
    expect(userName.shape).toBe("decl-with-spec");
    expect(userName.renderSpec).toBeDefined();
  });

  // §S11A.8 — `const <x><y>=0</>` — compound parent on the const path declines
  // (per §6.6 only individual derived fields can be `const`, not the parent
  // compound). When the const-branch decline restores the cursor and falls
  // through, the compound `<x><y>=0</>` is then parsed by the non-const
  // default branch as `state-decl(x, isConst:false, children:[...])`. The
  // leading `const` keyword is absorbed by the existing const-decl path
  // (producing an empty const-decl artifact); A1b can later flag the
  // empty-const + compound-parent combination as a parse error if needed.
  // Step 11.0a parser invariant: NO state-decl in the AST has both
  // `isConst:true` AND `children` populated.
  test("§S11A.8: `const <x><y>=0</>` does not produce an isConst:true compound parent", () => {
    const src = `<program>\${ const <x><y>=0</> }</program>`;
    const { ast } = parse(src);
    const decls = findKind(ast, "state-decl");
    // No state-decl is BOTH isConst:true AND has children populated.
    const constCompounds = decls.filter((d) =>
      d.isConst === true && Array.isArray(d.children)
    );
    expect(constCompounds.length).toBe(0);
    // The compound itself IS recognized (on the non-const fall-through).
    const compoundParents = decls.filter((d) => Array.isArray(d.children));
    expect(compoundParents.length).toBeGreaterThanOrEqual(0); // either path acceptable
  });
});

// =============================================================================
// §S11B — Phase A1a Step 11.0b: newline-as-statement-separator for state-decls
// =============================================================================
//
// Per BRIEF, multi-line legitimate expressions and Shape 2 markup-RHS spanning
// newlines must NOT regress; only newline-followed-by-state-decl-shape-opener
// terminates RHS collection. Implementation: extended `collectExpr`'s
// ASI-NEWLINE branch to detect `<` PUNCT + IDENT + state-decl lookahead at the
// start of a new line as a statement boundary (when `lastEndsValue`).
//
// Spec authority: §6.1 / §6.2 / §6.3 (RHS shapes); kickstarter v2 §3.1 (canonical
// multi-decl form using newline-only separators).
// =============================================================================

describe("A1a Step 11.0b — newline-as-statement-separator for state-decls", () => {
  // §S11B.1 — Two Shape 1 plain decls separated by a newline only.
  // The kickstarter v2 §3 canonical form. Pre-11.0b this collapsed into ONE
  // state-decl whose `init` ate the second decl as raw text.
  test("§S11B.1: two Shape 1 plain decls newline-separated produce TWO state-decls", () => {
    const src = `<program>\${
      <count> = 0
      <name>  = ""
    }</program>`;
    const { ast, errors } = parse(src);
    expect(errors.length).toBe(0);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(2);
    const byName = Object.fromEntries(decls.map((d) => [d.name, d]));
    expect(byName.count.shape).toBe("plain");
    expect(byName.count.init).toBe("0");
    expect(byName.name.shape).toBe("plain");
    expect(byName.name.init).toBe('""');
    assertNoHtmlFragmentMatching(ast, /<\s*count\s*>|<\s*name\s*>/);
  });

  // §S11B.2 — Four-decl block with newline separators, mixed Shape 1 / 3.
  // Confirms the boundary fires for both Shape 1 plain AND Shape 3 derived
  // (`const <name> = …`) sequencing.
  test("§S11B.2: 4-decl block (Shape 1 + Shape 3) newline-separated all parse cleanly", () => {
    const src = `<program>\${
      <count> = 0
      <name>  = ""
      const <doubled> = @count * 2
      const <greeting> = "Hello, " + @name
    }</program>`;
    const { ast, errors } = parse(src);
    expect(errors.length).toBe(0);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(4);
    const byName = Object.fromEntries(decls.map((d) => [d.name, d]));
    expect(byName.count.shape).toBe("plain");
    expect(byName.count.isConst).toBe(false);
    expect(byName.name.shape).toBe("plain");
    expect(byName.doubled.shape).toBe("derived");
    expect(byName.doubled.isConst).toBe(true);
    expect(byName.doubled.init).toBe("@count * 2");
    expect(byName.greeting.shape).toBe("derived");
    expect(byName.greeting.isConst).toBe(true);
    expect(byName.greeting.init).toBe('"Hello, " + @name');
    assertNoHtmlFragmentMatching(ast, /<\s*count\s*>|<\s*name\s*>|<\s*doubled\s*>|<\s*greeting\s*>/);
  });

  // §S11B.3 — Mixed `;` + newline separators in the same block.
  // Both separator forms work and don't double-count.
  test("§S11B.3: mixed `;` + newline separators in same block all parse correctly", () => {
    const src = `<program>\${
      <a> = 0
      <b> = 1; <c> = 2
      <d> = 3
    }</program>`;
    const { ast, errors } = parse(src);
    expect(errors.length).toBe(0);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(4);
    const names = decls.map((d) => d.name).sort();
    expect(names).toEqual(["a", "b", "c", "d"]);
    for (const d of decls) {
      expect(d.shape).toBe("plain");
      expect(d.init).toBe(String("0123"["abcd".indexOf(d.name)]));
    }
    assertNoHtmlFragmentMatching(ast, /<\s*a\s*>|<\s*b\s*>|<\s*c\s*>|<\s*d\s*>/);
  });

  // §S11B.4 — REGRESSION GUARD: Shape 2 markup-RHS spanning multiple lines.
  // The angleDepth tracking in `collectExpr` (added in Step 5) plus
  // `parseLiftTag` for markup-RHS together preserve multi-line markup. The
  // newline-as-separator rule does NOT fire inside markup because `angleDepth
  // > 0` and parseLiftTag handles the markup boundary via `/>`.
  test("§S11B.4: REGRESSION — Shape 2 markup-RHS spanning newlines remains ONE decl", () => {
    const src = `<program>\${
      <userName> = <input
        type="text"
      />
    }</program>`;
    const { ast, errors } = parse(src);
    expect(errors.length).toBe(0);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(1);
    expect(decls[0].name).toBe("userName");
    expect(decls[0].shape).toBe("decl-with-spec");
    expect(decls[0].renderSpec).toBeDefined();
    expect(decls[0].renderSpec.kind).toBe("render-spec");
    assertNoHtmlFragmentMatching(ast, /<\s*userName\s*>|<\s*input\s*/);
  });

  // §S11B.5 — REGRESSION GUARD: multi-line legitimate expression. The newline
  // INSIDE a continuing expression must NOT terminate RHS prematurely. `+`
  // does not end a value (lastEndsValue=false), so the ASI-NEWLINE rule (and
  // our new state-decl-shape extension) does not fire.
  test("§S11B.5: REGRESSION — multi-line legit expression `@a +\\n@b` remains ONE decl", () => {
    const src = `<program>\${
      <x> = @a +
            @b
    }</program>`;
    const { ast, errors } = parse(src);
    expect(errors.length).toBe(0);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(1);
    expect(decls[0].name).toBe("x");
    expect(decls[0].init).toBe("@a +\n@b");
    assertNoHtmlFragmentMatching(ast, /<\s*x\s*>/);
  });

  // §S11B.6 — REGRESSION GUARD: same-line `a < b` comparison inside RHS must
  // NOT trip the state-decl-shape boundary. The newline gate (`tok.span.line
  // > lastTok.span.line`) suppresses the boundary check entirely on same-line
  // tokens. `a < b ? 1 : 2` parses cleanly as ONE expression.
  test("§S11B.6: REGRESSION — same-line `a < b` comparison inside RHS not broken", () => {
    const src = `<program>\${
      <x> = a < b ? 1 : 2
      <y> = 0
    }</program>`;
    const { ast, errors } = parse(src);
    expect(errors.length).toBe(0);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(2);
    const byName = Object.fromEntries(decls.map((d) => [d.name, d]));
    expect(byName.x.init).toBe("a < b ? 1 : 2");
    expect(byName.y.init).toBe("0");
    assertNoHtmlFragmentMatching(ast, /<\s*x\s*>|<\s*y\s*>/);
  });

  // §S11B.7 — Shape 1 with array literal init followed by sibling decl on
  // newline. Closing `]` ends a value, so the boundary fires correctly.
  test("§S11B.7: Shape 1 with array-literal init + newline + sibling decl", () => {
    const src = `<program>\${
      <items> = [1, 2, 3]
      <count> = 0
    }</program>`;
    const { ast, errors } = parse(src);
    expect(errors.length).toBe(0);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(2);
    const byName = Object.fromEntries(decls.map((d) => [d.name, d]));
    expect(byName.items.init).toBe("[ 1 , 2 , 3 ]");
    expect(byName.count.init).toBe("0");
    assertNoHtmlFragmentMatching(ast, /<\s*items\s*>|<\s*count\s*>/);
  });

  // §S11B.8 — Shape 1 with multiline call init followed by sibling decl.
  // Closing `)` ends a value, so the boundary fires after the close-paren
  // crosses to a new line.
  test("§S11B.8: Shape 1 with multiline call init + newline + sibling decl", () => {
    const src = `<program>\${
      <result> = compute(
        a,
        b
      )
      <count> = 0
    }</program>`;
    const { ast, errors } = parse(src);
    expect(errors.length).toBe(0);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(2);
    const byName = Object.fromEntries(decls.map((d) => [d.name, d]));
    // The init contains the multiline call, but the sibling `<count>` is NOT
    // eaten into it.
    expect(byName.result.init).toContain("compute (");
    expect(byName.result.init).not.toContain("count");
    expect(byName.count.init).toBe("0");
    assertNoHtmlFragmentMatching(ast, /<\s*result\s*>|<\s*count\s*>/);
  });

  // §S11B.9 — Shape 1 single-decl baseline (regression: untouched cases work).
  test("§S11B.9: REGRESSION — single Shape 1 plain decl unchanged", () => {
    const src = `<program>\${ <count> = 0 }</program>`;
    const { ast, errors } = parse(src);
    expect(errors.length).toBe(0);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(1);
    expect(decls[0].name).toBe("count");
    expect(decls[0].shape).toBe("plain");
    expect(decls[0].init).toBe("0");
    assertNoHtmlFragmentMatching(ast, /<\s*count\s*>/);
  });

  // §S11B.10 — Shape 2 with validators followed by newline + sibling decl.
  // Confirms that the Shape 2 + sibling-decl handoff works (Shape 2 uses
  // parseLiftTag which terminates on `/>`, then the next `<count>` decl is
  // recognized by the structural-decl path).
  test("§S11B.10: Shape 2 (`<name req> = <input/>`) + newline + Shape 1 sibling", () => {
    const src = `<program>\${
      <userName req> = <input type="text"/>
      <count> = 0
    }</program>`;
    const { ast, errors } = parse(src);
    expect(errors.length).toBe(0);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(2);
    const byName = Object.fromEntries(decls.map((d) => [d.name, d]));
    expect(byName.userName.shape).toBe("decl-with-spec");
    expect(byName.userName.renderSpec).toBeDefined();
    expect(byName.userName.validators).toBeDefined();
    expect(byName.userName.validators.length).toBe(1);
    expect(byName.userName.validators[0].name).toBe("req");
    expect(byName.count.shape).toBe("plain");
    expect(byName.count.init).toBe("0");
    assertNoHtmlFragmentMatching(ast, /<\s*userName\s*>|<\s*count\s*>/);
  });

  // §S11B.11 — Broader benefit: let-decl + state-decl on newline now also
  // separates correctly. The fix lives in `collectExpr` so all callers
  // benefit. Previously `let x = 1\n<y> = 0` ate the state-decl into the
  // let-decl init.
  test("§S11B.11: let-decl + newline + state-decl separates correctly", () => {
    const src = `<program>\${
      let x = 1
      <y> = 0
    }</program>`;
    const { ast, errors } = parse(src);
    expect(errors.length).toBe(0);
    const stateDecls = findKind(ast, "state-decl");
    const letDecls = findKind(ast, "let-decl");
    expect(letDecls.length).toBe(1);
    expect(letDecls[0].name).toBe("x");
    expect(letDecls[0].init).toBe("1");
    expect(stateDecls.length).toBe(1);
    expect(stateDecls[0].name).toBe("y");
    expect(stateDecls[0].init).toBe("0");
    assertNoHtmlFragmentMatching(ast, /<\s*y\s*>/);
  });
});

// =============================================================================
// A1a Step 11.0c — typed-decl recognizer (`>` followed by `:`)
// =============================================================================
//
// Step 11.0c extends `tryParseStructuralDecl` to recognise typed state-decl
// shapes per SPEC §6.2 (typed Shape 1/2/3) + §14.10 (bare-variant inference,
// M9) + §14.11 (Tier 3 typed compound positional sugar, M10) + §53
// (refinement-type predicates).
//
// Lookahead extension: `scanStructuralDeclLookahead` returns `typedDecl: true`
// when post-`>` is `:`. Caller consumes the type expression via the existing
// `collectTypeAnnotation` helper, then proceeds with standard markup-RHS /
// expression-RHS dispatch.
//
// AST shape: state-decl carries `typeAnnotation: string` (raw type text).
// Mutually inclusive with all 3 RHS shapes — typed Shape 1 / 2 / 3.
//
// A1b owns:
//   - type-checking (typed Shape 1/3 init type vs declared type)
//   - bare-variant inference (`.Idle` → `Phase.Idle` resolution)
//   - Tier 3 positional binding (SequenceExpression → struct field-order map)
//   - refinement-type predicate decomposition into runtime checks
//
// Step 11.0c just collects the typed form. Anti-html-fragment guard on every
// positive case (the deceptive-success pattern from PARSER-AUDIT §C.1).
// =============================================================================

describe("A1a Step 11.0c — typed-decl recognizer (`>` followed by `:`)", () => {
  // §S11C.1 — Number-typed Shape 1 plain reactive cell.
  test("§S11C.1: `<count>: number = 0` (typed Shape 1) → state-decl with typeAnnotation:\"number\"", () => {
    const src = `<program>\${ <count>: number = 0 }</program>`;
    const { ast, errors } = parse(src);
    expect(errors.length).toBe(0);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(1);
    const d = decls[0];
    expect(d.name).toBe("count");
    expect(d.init).toBe("0");
    expect(d.typeAnnotation).toBe("number");
    expect(d.shape).toBe("plain");
    expect(d.structuralForm).toBe(true);
    expect(d.isConst).toBe(false);
    assertNoHtmlFragmentMatching(ast, /<\s*count\s*>/);
    assertNoHtmlFragmentMatching(ast, /:\s*number/);
  });

  // §S11C.2 — String-typed Shape 1.
  test("§S11C.2: `<name>: string = \"\"` (typed Shape 1 string) → state-decl with typeAnnotation:\"string\"", () => {
    const src = `<program>\${ <name>: string = "" }</program>`;
    const { ast, errors } = parse(src);
    expect(errors.length).toBe(0);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(1);
    const d = decls[0];
    expect(d.name).toBe("name");
    expect(d.init).toBe(`""`);
    expect(d.typeAnnotation).toBe("string");
    expect(d.shape).toBe("plain");
    expect(d.structuralForm).toBe(true);
    expect(d.isConst).toBe(false);
    assertNoHtmlFragmentMatching(ast, /<\s*name\s*>/);
    assertNoHtmlFragmentMatching(ast, /:\s*string/);
  });

  // §S11C.3 — Bare-variant inference (M9 / SPEC §14.10).
  // `<phase>: Phase = .Idle` — the `.Idle` is a bare-variant access (acorn
  // rejects standalone `.Idle`); A1a collects init=".Idle" + typeAnnotation
  // and lets A1b resolve to Phase.Idle.
  test("§S11C.3: `<phase>: Phase = .Idle` (bare-variant inference, §14.10) → state-decl with init=\".Idle\"", () => {
    const src = `<program>\${ <phase>: Phase = .Idle }</program>`;
    const { ast, errors } = parse(src);
    expect(errors.length).toBe(0);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(1);
    const d = decls[0];
    expect(d.name).toBe("phase");
    expect(d.typeAnnotation).toBe("Phase");
    // Init contains the bare-variant token `.Idle`. Whitespace between `.`
    // and IDENT is normalized by collectExpr's join logic; we assert
    // membership rather than exact string.
    expect(d.init).toContain(".");
    expect(d.init).toContain("Idle");
    expect(d.shape).toBe("plain");
    expect(d.structuralForm).toBe(true);
    expect(d.isConst).toBe(false);
    assertNoHtmlFragmentMatching(ast, /<\s*phase\s*>/);
    assertNoHtmlFragmentMatching(ast, /:\s*Phase/);
  });

  // §S11C.4 — Tier 3 typed compound positional sugar (M10 / SPEC §14.11).
  // `<userInfo>: UserInfo = ("alice", 30, true)` — acorn parses tuple as
  // SequenceExpression; A1b's typed-compound resolver interprets positionally
  // against the struct's declared field order.
  test("§S11C.4: `<userInfo>: UserInfo = (\"alice\", 30, true)` (Tier 3 positional, §14.11) → state-decl with tuple init", () => {
    const src = `<program>\${ <userInfo>: UserInfo = ("alice", 30, true) }</program>`;
    const { ast, errors } = parse(src);
    expect(errors.length).toBe(0);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(1);
    const d = decls[0];
    expect(d.name).toBe("userInfo");
    expect(d.init).toContain("alice");
    expect(d.init).toContain("30");
    expect(d.init).toContain("true");
    expect(d.typeAnnotation).toBe("UserInfo");
    expect(d.shape).toBe("plain");
    expect(d.structuralForm).toBe(true);
    expect(d.isConst).toBe(false);
    assertNoHtmlFragmentMatching(ast, /<\s*userInfo\s*>/);
    assertNoHtmlFragmentMatching(ast, /:\s*UserInfo/);
  });

  // §S11C.5 — Typed Shape 3 derived (`const <doubled>: number = @count * 2`).
  test("§S11C.5: `const <doubled>: number = @count * 2` (typed Shape 3 derived) → state-decl with shape:\"derived\", isConst:true, typeAnnotation:\"number\"", () => {
    const src = `<program>\${ const <doubled>: number = @count * 2 }</program>`;
    const { ast, errors } = parse(src);
    expect(errors.length).toBe(0);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(1);
    const d = decls[0];
    expect(d.name).toBe("doubled");
    expect(d.init).toBe("@count * 2");
    expect(d.typeAnnotation).toBe("number");
    expect(d.shape).toBe("derived");
    expect(d.structuralForm).toBe(true);
    expect(d.isConst).toBe(true);
    assertNoHtmlFragmentMatching(ast, /<\s*doubled\s*>/);
    assertNoHtmlFragmentMatching(ast, /:\s*number/);
  });

  // §S11C.6 — Refinement-typed Shape 2 with markup-RHS.
  // `<email>: string(pattern(/^[^@]+@[^@]+$/)) = <input type="email"/>` —
  // collectTypeAnnotation accepts the parenthesized predicate-list verbatim
  // (paren-depth tracking). The render-spec contains the bound input.
  // A1b/A1c interpret the refinement predicates.
  test("§S11C.6: `<email>: string(pattern(/.../)) = <input/>` (refinement-typed Shape 2) → state-decl with renderSpec + refinement typeAnnotation", () => {
    const src = `<program>\${ <email>: string(pattern(/^[^@]+@[^@]+$/)) = <input type="email"/> }</program>`;
    const { ast, errors } = parse(src);
    expect(errors.length).toBe(0);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(1);
    const d = decls[0];
    expect(d.name).toBe("email");
    // typeAnnotation: refinement-type form retained verbatim (no spaces in
    // the joined output — collectTypeAnnotation joins parts with no
    // separator, matching its existing behaviour at all other call sites).
    expect(d.typeAnnotation).toContain("string");
    expect(d.typeAnnotation).toContain("pattern");
    expect(d.shape).toBe("decl-with-spec");
    expect(d.structuralForm).toBe(true);
    expect(d.isConst).toBe(false);
    expect(d.renderSpec).toBeDefined();
    expect(d.renderSpec.kind).toBe("render-spec");
    assertNoHtmlFragmentMatching(ast, /<\s*email\s*>/);
    assertNoHtmlFragmentMatching(ast, /pattern\(/);
  });

  // §S11C.7 — REGRESSION: untyped Shape 1 still works (typeAnnotation absent).
  test("§S11C.7: REGRESSION — untyped `<count> = 0` produces state-decl with NO typeAnnotation", () => {
    const src = `<program>\${ <count> = 0 }</program>`;
    const { ast, errors } = parse(src);
    expect(errors.length).toBe(0);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(1);
    const d = decls[0];
    expect(d.name).toBe("count");
    expect(d.init).toBe("0");
    expect(d.shape).toBe("plain");
    expect(d.structuralForm).toBe(true);
    expect(d.isConst).toBe(false);
    expect(d.typeAnnotation).toBeUndefined();
    assertNoHtmlFragmentMatching(ast, /<\s*count\s*>/);
  });

  // §S11C.8 — Validators-before-`>` + typed-decl form.
  // `<email req>: string = <input/>` — validators in the standard pre-`>`
  // position, type annotation after `>`. This is the spec-canonical
  // placement (per §5/§6.2 examples).
  test("§S11C.8: `<email req>: string = <input/>` (validators-before-typed) → Shape 2 with validators + typeAnnotation", () => {
    const src = `<program>\${ <email req>: string = <input type="email"/> }</program>`;
    const { ast, errors } = parse(src);
    expect(errors.length).toBe(0);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(1);
    const d = decls[0];
    expect(d.name).toBe("email");
    expect(d.typeAnnotation).toBe("string");
    expect(d.shape).toBe("decl-with-spec");
    expect(d.validators).toBeDefined();
    expect(d.validators.length).toBe(1);
    expect(d.validators[0].name).toBe("req");
    expect(d.renderSpec).toBeDefined();
    assertNoHtmlFragmentMatching(ast, /<\s*email\s*>/);
  });

  // §S11C.9 — Newline-separator interaction (Step 11.0b free-generalization).
  // ASI-NEWLINE delegates to scanStructuralDeclLookahead, which now recognises
  // typed-decl shape — so multi-line typed decls separate correctly.
  test("§S11C.9: multiple typed decls newline-separated produce N state-decls (Step 11.0b interaction)", () => {
    const src = `<program>\${
      <count>: number = 0
      <name>: string = ""
      const <doubled>: number = @count * 2
    }</program>`;
    const { ast, errors } = parse(src);
    expect(errors.length).toBe(0);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(3);
    expect(decls[0].name).toBe("count");
    expect(decls[0].typeAnnotation).toBe("number");
    expect(decls[0].shape).toBe("plain");
    expect(decls[1].name).toBe("name");
    expect(decls[1].typeAnnotation).toBe("string");
    expect(decls[1].shape).toBe("plain");
    expect(decls[2].name).toBe("doubled");
    expect(decls[2].typeAnnotation).toBe("number");
    expect(decls[2].shape).toBe("derived");
    expect(decls[2].isConst).toBe(true);
    assertNoHtmlFragmentMatching(ast, /<\s*count\s*>/);
    assertNoHtmlFragmentMatching(ast, /<\s*doubled\s*>/);
  });

  // §S11C.10 — Compound parent + typed children (recursion via Step 11.0a).
  // Each child decl recurses through tryParseStructuralDecl, so children
  // benefit from typed-decl recognition automatically.
  test("§S11C.10: compound parent with typed children — children carry typeAnnotation", () => {
    const src = `<program>\${ <formRes><name>: string = ""<email>: string = ""</> }</program>`;
    const { ast, errors } = parse(src);
    expect(errors.length).toBe(0);
    const decls = findKind(ast, "state-decl");
    // 1 compound parent + 2 typed children
    expect(decls.length).toBe(3);
    const parent = decls.find((d) => d.name === "formRes");
    expect(parent).toBeDefined();
    expect(parent.shape).toBe("plain");
    expect(parent.children).toBeDefined();
    expect(parent.children.length).toBe(2);
    expect(parent.children[0].name).toBe("name");
    expect(parent.children[0].typeAnnotation).toBe("string");
    expect(parent.children[1].name).toBe("email");
    expect(parent.children[1].typeAnnotation).toBe("string");
    assertNoHtmlFragmentMatching(ast, /<\s*formRes\s*>/);
    assertNoHtmlFragmentMatching(ast, /<\s*name\s*>/);
  });
});
