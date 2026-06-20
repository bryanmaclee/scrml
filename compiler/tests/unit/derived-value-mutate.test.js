/**
 * Phase A1b Step B8 — L21 walker (E-DERIVED-VALUE-MUTATE).
 *
 * Tests the PASS 6 walker added to Stage 3.06 SYM
 * (`compiler/src/symbol-table.ts`). For every in-place mutation form on a
 * `const`-derived cell, fires `E-DERIVED-VALUE-MUTATE` per SPEC §6.6.18 + §34.
 *
 * Three forbidden form classes per §6.6.18:
 *   1. Array mutating methods — 9 names per §6.5.1: push, pop, shift,
 *      unshift, splice, reverse, sort, fill, copyWithin.
 *   2. Object property writes — `=`, plus 14 compound-assignment ops
 *      (+=, -=, *=, /=, %=, **=, &=, |=, ^=, <<=, >>=, >>>=, ??=, ||=, &&=).
 *      Plus `delete @derivedObj.foo`.
 *   3. In-compound derived sub-cell — `@form.derivedField.method(...)` /
 *      `@form.derivedField.foo = x` where `derivedField` is `const`-declared
 *      inside a compound parent.
 *
 * AST shape paths the walker discriminates:
 *   - `reactive-array-mutation`     — case 1 specialized lowering.
 *   - `reactive-nested-assign`      — case 2 plain `=` specialized lowering.
 *   - `bare-expr` containing an `assign` / `call` / `unary` ExprNode —
 *     compound assigns, computed-index assigns, multi-segment receivers,
 *     compound-receiver method calls, delete.
 *
 * **Out of scope (deferred):**
 *   - E-SYNTHESIZED-WRITE (§55.7) — depends on B11/B12 synth-cell registry.
 *   - E-DERIVED-WRITE (§6.6.8) — sibling rule that will join the same pass
 *     when implemented. Tests that exercise `@derived = newval` shape today
 *     fire NO error from B8 (correct — it's a different code).
 *
 * Spec authority:
 *   §6.5.1   — Array mutating methods.
 *   §6.6.8   — E-DERIVED-WRITE (sibling).
 *   §6.6.18  — E-DERIVED-VALUE-MUTATE rule (this test).
 *   §34      — Error catalog.
 */

import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { runSYM } from "../../src/symbol-table.ts";

function parse(source) {
  const bs = splitBlocks("test.scrml", source);
  return buildAST(bs);
}

function buildAndRun(source) {
  const { ast, errors } = parse(source);
  const sym = runSYM({ filePath: "test.scrml", ast });
  return { ast, errors, sym };
}

function errsByCode(sym, code) {
  return sym.errors.filter((e) => e.code === code);
}

// ===========================================================================
// §B8.1 — Case 1: array mutating methods (9 per §6.5.1)
// ===========================================================================

const ARRAY_MUTATIONS = [
  "push", "pop", "shift", "unshift", "splice",
  "reverse", "sort", "fill", "copyWithin",
];

describe("§B8.1 case 1 — array mutating methods on `const`-derived cell", () => {
  for (const method of ARRAY_MUTATIONS) {
    test(`fires on \`@derived.${method}(...)\``, () => {
      const src = `<program>\${
        <items> = []
        const <derived> = @items.filter(i => i)
        function f() { @derived.${method}(0) }
      }</program>`;
      const { sym } = buildAndRun(src);
      const fires = errsByCode(sym, "E-DERIVED-VALUE-MUTATE");
      expect(fires.length).toBeGreaterThanOrEqual(1);
      expect(fires[0].message).toContain("@derived");
      expect(fires[0].message).toContain(`.${method}(...)`);
      expect(fires[0].severity).toBe("error");
    });
  }

  test("does NOT fire on non-derived (Shape 1) array cell", () => {
    const src = `<program>\${
      <items> = []
      function f() { @items.push(1) }
    }</program>`;
    const { sym } = buildAndRun(src);
    const fires = errsByCode(sym, "E-DERIVED-VALUE-MUTATE");
    expect(fires.length).toBe(0);
  });

  test("does NOT fire on non-mutating method `.filter(...)` on derived", () => {
    const src = `<program>\${
      <items> = []
      const <derived> = @items.filter(i => i)
      function f() { let local = @derived.filter(x => x) }
    }</program>`;
    const { sym } = buildAndRun(src);
    const fires = errsByCode(sym, "E-DERIVED-VALUE-MUTATE");
    expect(fires.length).toBe(0);
  });

  test("does NOT fire on `.map(...)` or `.slice(...)` on derived", () => {
    const src = `<program>\${
      <items> = []
      const <derived> = @items.filter(i => i)
      function f() { let a = @derived.map(x => x); let b = @derived.slice(0) }
    }</program>`;
    const { sym } = buildAndRun(src);
    const fires = errsByCode(sym, "E-DERIVED-VALUE-MUTATE");
    expect(fires.length).toBe(0);
  });
});

// ===========================================================================
// §B8.2 — Case 2: object property writes (plain `=` + 14 compound + delete)
// ===========================================================================

// All 15 compound-assignment operators per SPEC §6.6.18 normative.
// S209 ss4: the bit-shift forms (`<<=`, `>>=`, `>>>=`) PARSE end-to-end now.
// Two front-end fixes landed: (1) tokenizer MULTI_OPS gained `<<=`/`>>=`/`>>>=`
// (previously `<<=` lexed as `<<` + `=` -> `<< =`); (2) ast-builder.js
// COMPOUND_OPS was completed so a newline-separated second `@x <op>= n` for
// these ops triggers a statement boundary (previously merged + silently
// dropped). The walker already handled them (derived-mutation-ops.ts
// COMPOUND_ASSIGNMENT_OPS); all 15 are now active below.
const COMPOUND_OPS_PARSED = [
  "+=", "-=", "*=", "/=", "%=", "**=",
  "<<=", ">>=", ">>>=",
  "&=", "|=", "^=",
  "??=", "||=", "&&=",
];

describe("§B8.2a case 2 plain `=` — `@derived.foo = x`", () => {
  test("fires on plain `=` property write on derived object", () => {
    const src = `<program>\${
      <data> = { a: 1 }
      const <copy> = { ...@data }
      function f() { @copy.a = 2 }
    }</program>`;
    const { sym } = buildAndRun(src);
    const fires = errsByCode(sym, "E-DERIVED-VALUE-MUTATE");
    expect(fires.length).toBe(1);
    expect(fires[0].message).toContain("@copy");
  });

  test("does NOT fire on plain `=` to NON-derived object", () => {
    const src = `<program>\${
      <data> = { a: 1 }
      function f() { @data.a = 2 }
    }</program>`;
    const { sym } = buildAndRun(src);
    const fires = errsByCode(sym, "E-DERIVED-VALUE-MUTATE");
    expect(fires.length).toBe(0);
  });
});

describe("§B8.2b case 2 compound-assigns — 15 parser-supported ops on derived", () => {
  for (const op of COMPOUND_OPS_PARSED) {
    test(`fires on \`@derived.foo ${op} x\``, () => {
      const src = `<program>\${
        <data> = { a: 1 }
        const <copy> = { ...@data }
        function f() { @copy.a ${op} 1 }
      }</program>`;
      const { sym } = buildAndRun(src);
      const fires = errsByCode(sym, "E-DERIVED-VALUE-MUTATE");
      expect(fires.length).toBe(1);
      expect(fires[0].message).toContain("@copy");
      expect(fires[0].message).toContain(op);
    });
  }
});

describe("§B8.2c case 2 delete — `delete @derived.foo`", () => {
  test("fires on `delete @derived.foo`", () => {
    const src = `<program>\${
      <data> = { a: 1 }
      const <copy> = { ...@data }
      function f() { delete @copy.a }
    }</program>`;
    const { sym } = buildAndRun(src);
    const fires = errsByCode(sym, "E-DERIVED-VALUE-MUTATE");
    expect(fires.length).toBe(1);
    expect(fires[0].message).toContain("@copy");
    expect(fires[0].message).toContain("delete");
  });

  test("fires on `delete @derived[i]` (computed-index)", () => {
    const src = `<program>\${
      <items> = []
      const <derived> = @items.filter(i => i)
      function f() { delete @derived[0] }
    }</program>`;
    const { sym } = buildAndRun(src);
    const fires = errsByCode(sym, "E-DERIVED-VALUE-MUTATE");
    expect(fires.length).toBe(1);
  });

  test("does NOT fire on `delete` of non-derived", () => {
    const src = `<program>\${
      <data> = { a: 1 }
      function f() { delete @data.a }
    }</program>`;
    const { sym } = buildAndRun(src);
    const fires = errsByCode(sym, "E-DERIVED-VALUE-MUTATE");
    expect(fires.length).toBe(0);
  });
});

// ===========================================================================
// §B8.3 — Case 3: in-compound derived sub-cell
// ===========================================================================

// §B8.3 — In-compound derived sub-cell (case 3).
//
// **Parser-blocked today.** The compound-with-`const`-child syntax per SPEC
// §6.6.16 (`<form> <items>=[] const <derivedField> = ... </>`) does not parse
// into a populated state-cell registry in current ast-builder — see
// `parse-shapes-v0next.test.js §S11A.8` ("compound parent on the const path
// declines"). The B8 walker handles this case CORRECTLY when the AST is
// shaped as spec'd: `walkDerivedValueMutate` descends compound `_scope`,
// `findDeepestRegisteredOnPrefix` walks `["form", "derivedField"]` and
// matches the deepest registered record, and `record.isConst` discriminates.
// ss4 item 7 (b) — parser support for in-compound `const <derived>` LANDED
// (ast-builder.js compound child-loop now dispatches a leading `const` opener
// into tryParseStructuralDecl with isConst:true; SPEC §6.6.16). These tests are
// now active assertions with NO walker change.
describe("§B8.3 case 3 — in-compound derived sub-cell", () => {
  test("fires on method call: `@form.derivedField.push(x)`", () => {
    const src = `<program>\${
      <form>
        <items> = []
        const <derivedField> = @form.items.filter(i => i)
      </>
      function f() { @form.derivedField.push(1) }
    }</program>`;
    const { sym } = buildAndRun(src);
    const fires = errsByCode(sym, "E-DERIVED-VALUE-MUTATE");
    expect(fires.length).toBe(1);
    expect(fires[0].message).toContain("@form.derivedField");
  });

  test("fires on plain `=` to in-compound derived: `@form.derivedField.foo = x`", () => {
    const src = `<program>\${
      <form>
        <data> = { a: 1 }
        const <derivedField> = { ...@form.data }
      </>
      function f() { @form.derivedField.a = 2 }
    }</program>`;
    const { sym } = buildAndRun(src);
    const fires = errsByCode(sym, "E-DERIVED-VALUE-MUTATE");
    expect(fires.length).toBe(1);
    expect(fires[0].message).toContain("@form.derivedField");
  });

  test("fires on compound-assign to in-compound derived: `@form.derivedField.a += 1`", () => {
    const src = `<program>\${
      <form>
        <data> = { a: 1 }
        const <derivedField> = { ...@form.data }
      </>
      function f() { @form.derivedField.a += 1 }
    }</program>`;
    const { sym } = buildAndRun(src);
    const fires = errsByCode(sym, "E-DERIVED-VALUE-MUTATE");
    expect(fires.length).toBe(1);
  });

  test("fires on delete on in-compound derived: `delete @form.derivedField.a`", () => {
    const src = `<program>\${
      <form>
        <data> = { a: 1 }
        const <derivedField> = { ...@form.data }
      </>
      function f() { delete @form.derivedField.a }
    }</program>`;
    const { sym } = buildAndRun(src);
    const fires = errsByCode(sym, "E-DERIVED-VALUE-MUTATE");
    expect(fires.length).toBe(1);
  });

});

// §B8.3-neg — Variant C compound parent with NON-derived (Shape 1) child IS
// supported by the parser today (no `const` involvement). This negative
// test confirms B8 doesn't false-fire on plain in-compound mutations.
describe("§B8.3-neg — non-derived in-compound sub-cell does NOT fire", () => {
  test("does NOT fire on `@form.items.push(x)` (Shape 1 child)", () => {
    const src = `<program>\${ <form><items>=[] </> function f() { @form.items.push(1) } }</program>`;
    const { sym } = buildAndRun(src);
    const fires = errsByCode(sym, "E-DERIVED-VALUE-MUTATE");
    expect(fires.length).toBe(0);
  });
});

// ===========================================================================
// §B8.4 — No false positives on E-DERIVED-WRITE territory (`@derived = ...`)
// ===========================================================================

describe("§B8.4 no false positives — E-DERIVED-WRITE territory is distinct", () => {
  test("`@derived = newval` does NOT fire E-DERIVED-VALUE-MUTATE (different rule)", () => {
    const src = `<program>\${
      <items> = []
      const <derived> = @items.filter(i => i)
      function f() { @derived = [1, 2, 3] }
    }</program>`;
    const { sym } = buildAndRun(src);
    // Reassignment is E-DERIVED-WRITE (sibling rule, not implemented today).
    // B8 must NOT fire on this form.
    const fires = errsByCode(sym, "E-DERIVED-VALUE-MUTATE");
    expect(fires.length).toBe(0);
  });
});

// ===========================================================================
// §B8.5 — Computed-index assignment
// ===========================================================================

describe("§B8.5 computed-index — `@derived[i] = x`", () => {
  test("fires plain `=` on computed-index of derived", () => {
    const src = `<program>\${
      <items> = []
      const <derived> = @items.filter(i => i)
      function f() { @derived[0] = 99 }
    }</program>`;
    const { sym } = buildAndRun(src);
    const fires = errsByCode(sym, "E-DERIVED-VALUE-MUTATE");
    expect(fires.length).toBe(1);
  });

  test("does NOT fire on computed-index assign of NON-derived", () => {
    const src = `<program>\${
      <items> = []
      function f() { @items[0] = 99 }
    }</program>`;
    const { sym } = buildAndRun(src);
    const fires = errsByCode(sym, "E-DERIVED-VALUE-MUTATE");
    expect(fires.length).toBe(0);
  });
});

// ===========================================================================
// §B8.6 — Compound-receiver method call (multi-segment receiver chain)
// ===========================================================================

// §B8.6 multi-segment — parser support landed with ss4 item 7 (b); see §B8.3.
describe("§B8.6 multi-segment receiver", () => {
  test("fires on multi-segment receiver where leaf is in-compound derived", () => {
    const src = `<program>\${
      <form>
        <items> = []
        const <derivedField> = @form.items.filter(i => i)
      </>
      function f() { @form.derivedField.push(1) }
    }</program>`;
    const { sym } = buildAndRun(src);
    const fires = errsByCode(sym, "E-DERIVED-VALUE-MUTATE");
    expect(fires.length).toBe(1);
  });
});

// ===========================================================================
// §B8.7 — Negative: bare-name (no `@`) calls + reads + locals
// ===========================================================================

describe("§B8.7 negative — non-reactive forms do not fire", () => {
  test("`arr.push(1)` (no @-prefix) does NOT fire", () => {
    const src = `<program>\${
      function f() { let arr = []; arr.push(1) }
    }</program>`;
    const { sym } = buildAndRun(src);
    const fires = errsByCode(sym, "E-DERIVED-VALUE-MUTATE");
    expect(fires.length).toBe(0);
  });

  test("read of derived: `@derived.length` does NOT fire", () => {
    const src = `<program>\${
      <items> = []
      const <derived> = @items.filter(i => i)
      function f() { let n = @derived.length }
    }</program>`;
    const { sym } = buildAndRun(src);
    const fires = errsByCode(sym, "E-DERIVED-VALUE-MUTATE");
    expect(fires.length).toBe(0);
  });

  test("destructuring derived does NOT fire", () => {
    const src = `<program>\${
      <items> = []
      const <derived> = @items.filter(i => i)
      function f() { let [first] = @derived }
    }</program>`;
    const { sym } = buildAndRun(src);
    const fires = errsByCode(sym, "E-DERIVED-VALUE-MUTATE");
    expect(fires.length).toBe(0);
  });

  test("local copy mutation is fine: `let local = [...@derived]; local.push(x)`", () => {
    const src = `<program>\${
      <items> = []
      const <derived> = @items.filter(i => i)
      function f() { let local = [...@derived]; local.push(1) }
    }</program>`;
    const { sym } = buildAndRun(src);
    const fires = errsByCode(sym, "E-DERIVED-VALUE-MUTATE");
    expect(fires.length).toBe(0);
  });
});

// ===========================================================================
// §B8.8 — Diagnostic shape
// ===========================================================================

describe("§B8.8 diagnostic shape", () => {
  test("emits code, message, span, severity", () => {
    const src = `<program>\${
      <items> = []
      const <derived> = @items.filter(i => i)
      function f() { @derived.push(1) }
    }</program>`;
    const { sym } = buildAndRun(src);
    const fires = errsByCode(sym, "E-DERIVED-VALUE-MUTATE");
    expect(fires.length).toBe(1);
    const d = fires[0];
    expect(d.code).toBe("E-DERIVED-VALUE-MUTATE");
    expect(d.severity).toBe("error");
    expect(d.span).toBeTruthy();
    expect(typeof d.span.file).toBe("string");
    expect(typeof d.message).toBe("string");
    expect(d.message).toContain("§6.6.18");
  });
});

// ===========================================================================
// §B8.9 — Multiple mutations in a single function
// ===========================================================================

describe("§B8.9 multiple mutations fire independently", () => {
  test("two mutations → two diagnostics", () => {
    const src = `<program>\${
      <items> = []
      const <derived> = @items.filter(i => i)
      function f() {
        @derived.push(1)
        @derived.pop()
      }
    }</program>`;
    const { sym } = buildAndRun(src);
    const fires = errsByCode(sym, "E-DERIVED-VALUE-MUTATE");
    expect(fires.length).toBe(2);
  });
});
