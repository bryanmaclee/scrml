/* SPDX-License-Identifier: MIT
 * g-typer-bare-variant-non-return-ambiguous (S238) — bare-variant inference
 * in the fn-RETURN position when the return type is a STRUCT or an
 * ARRAY-of-enum, and when a call-arg's param enum differs from the return
 * enum.
 *
 * THE GAP (empirically characterized on base 2b503bdd):
 *   A bare variant `.X` / `.X(payload)` resolved in fn-return position ONLY
 *   when the return type was a plain enum/union (the existing Gap B.3 path).
 *   When the return type was a STRUCT (`return { kind: .A }`) or an
 *   ARRAY-of-enum (`return [.A]`, `return stack.concat([.A])`), the return
 *   path dispatched the FLAT walker `inferBareVariantsInExpr` with the whole
 *   struct/array type as context — which is neither enum nor union → spurious
 *   E-VARIANT-AMBIGUOUS. Additionally, the return path ran the call-arg walker
 *   AFTER the flat walker, so `return wrap(.Paren)` where `wrap(b: Bra) -> Tok`
 *   false-fired E-TYPE-063 (`.Paren` checked against `Tok`, not `Bra`).
 *
 *   The let/state-decl positions ALREADY resolved these shapes (via
 *   `inferBareVariantsWithStructNav` + a call-arg pre-pass); only the
 *   fn-RETURN position was missed.
 *
 * THE FIX (type-system.ts return-stmt case ~10658):
 *   (1) run `inferBareVariantsAtCallArgs` BEFORE the LHS return-type walker
 *       (pre-stamp call-arg idents against their PARAM enum), and
 *   (2) swap the flat `inferBareVariantsInExpr` for the struct-nav walker
 *       `inferBareVariantsWithStructNav` — so a struct/array return type
 *       refines the per-position context. This brings the return position to
 *       exact parity with the let-decl (~9065) and state-decl (~9478) paths.
 *
 * Soundness: a bare variant with NO statically-known target enum still fires
 * E-VARIANT-AMBIGUOUS; a `.X` that is not a variant of the target enum still
 * fires E-TYPE-063; the JS lowering (bare variant → string tag) is unchanged.
 *
 * Spec authority:
 *   §14.10 — "any other position where the type is fixed by the surrounding
 *   declaration" (the fn-return position). §34 — E-VARIANT-AMBIGUOUS /
 *   E-TYPE-063 catalog rows.
 */

import { describe, test, expect } from "bun:test";
import { runTS } from "../../src/type-system.ts";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";

function compile(source, filePath = "/test/app.scrml") {
  const bs = splitBlocks(filePath, source);
  const { ast } = buildAST(bs);
  const fileAST = {
    filePath,
    source,
    nodes: ast.nodes ?? [],
    machineDecls: ast.machineDecls ?? [],
    typeDecls: ast.typeDecls ?? [],
    components: ast.components ?? [],
    imports: ast.imports ?? [],
    exports: ast.exports ?? [],
    ast,
  };
  const result = runTS({
    files: [fileAST],
    protectAnalysis: { views: new Map() },
    routeMap: { functions: new Map() },
  });
  return { ast, errors: result.errors };
}

function errsByCode(errors, code) {
  return (errors ?? []).filter((e) => e?.code === code);
}

// ===========================================================================
// A — the newly-fixed failing positions (return type = struct / array-of-enum)
// ===========================================================================

describe("A — return-position struct/array bare-variant resolves (was E-VARIANT-AMBIGUOUS)", () => {
  test("A.1 struct-field value in return: `return { kind: .A, len: 2 }` — no fire", () => {
    const src = `<program>\${
      type Foo:enum = { A, B(x: int) }
      type Tok:struct = { kind: Foo, len: int }
      function mk() -> Tok { return { kind: .A, len: 2 } }
    }</program>`;
    const { errors } = compile(src);
    expect(errsByCode(errors, "E-VARIANT-AMBIGUOUS").length).toBe(0);
    expect(errsByCode(errors, "E-TYPE-063").length).toBe(0);
  });

  test("A.2 array-element in return: `return [.A, .A]` (Foo[] return) — no fire on either element", () => {
    const src = `<program>\${
      type Foo:enum = { A, B(x: int) }
      function mk() -> Foo[] { return [.A, .A] }
    }</program>`;
    const { errors } = compile(src);
    expect(errsByCode(errors, "E-VARIANT-AMBIGUOUS").length).toBe(0);
    expect(errsByCode(errors, "E-TYPE-063").length).toBe(0);
  });

  test("A.3 array-element via `.concat([.A])` in return — no fire", () => {
    const src = `<program>\${
      type Foo:enum = { A, B(x: int) }
      function mk(stack: Foo[]) -> Foo[] { return stack.concat([.A]) }
    }</program>`;
    const { errors } = compile(src);
    expect(errsByCode(errors, "E-VARIANT-AMBIGUOUS").length).toBe(0);
    expect(errsByCode(errors, "E-TYPE-063").length).toBe(0);
  });

  test("A.4 payload variant in a struct field in return: `return { kind: .B(3), len: 2 }` — no fire", () => {
    const src = `<program>\${
      type Foo:enum = { A, B(x: int) }
      type Tok:struct = { kind: Foo, len: int }
      function mk() -> Tok { return { kind: .B(3), len: 2 } }
    }</program>`;
    const { errors } = compile(src);
    expect(errsByCode(errors, "E-VARIANT-AMBIGUOUS").length).toBe(0);
    expect(errsByCode(errors, "E-TYPE-063").length).toBe(0);
  });

  test("A.5 cross-enum fn-arg in return: `return wrap(.Paren)` where wrap(b:Bra)->Tok — no false E-TYPE-063", () => {
    const src = `<program>\${
      type Bra:enum = { Paren, Brace }
      type Tok:enum = { Num, Str }
      function wrap(b: Bra) -> Tok { return .Num }
      function use1() -> Tok { return wrap(.Paren) }
    }</program>`;
    const { errors } = compile(src);
    expect(errsByCode(errors, "E-TYPE-063").length).toBe(0);
    expect(errsByCode(errors, "E-VARIANT-AMBIGUOUS").length).toBe(0);
  });
});

// ===========================================================================
// B — negatives / soundness (unsound / typo cases STILL error)
// ===========================================================================

describe("B — soundness: still-ambiguous / typo returns still error", () => {
  test("B.1 typo in array return: `return [.A, .Nope]` fires E-TYPE-063 on `.Nope`", () => {
    const src = `<program>\${
      type Foo:enum = { A, B(x: int) }
      function mk() -> Foo[] { return [.A, .Nope] }
    }</program>`;
    const { errors } = compile(src);
    const e063 = errsByCode(errors, "E-TYPE-063");
    expect(e063.some((e) => e.message.includes(".Nope") && e.message.includes("Foo"))).toBe(true);
  });

  test("B.2 typo in struct-field return: `return { kind: .Nope }` fires E-TYPE-063 on `.Nope`", () => {
    const src = `<program>\${
      type Foo:enum = { A, B(x: int) }
      type Tok:struct = { kind: Foo, len: int }
      function mk() -> Tok { return { kind: .Nope, len: 2 } }
    }</program>`;
    const { errors } = compile(src);
    const e063 = errsByCode(errors, "E-TYPE-063");
    expect(e063.some((e) => e.message.includes(".Nope") && e.message.includes("Foo"))).toBe(true);
  });

  test("B.3 bare variant returned where return type is primitive `int` — E-VARIANT-AMBIGUOUS", () => {
    const src = `<program>\${
      type Foo:enum = { A, B(x: int) }
      function mk() -> int { return .A }
    }</program>`;
    const { errors } = compile(src);
    expect(errsByCode(errors, "E-VARIANT-AMBIGUOUS").length).toBeGreaterThan(0);
  });

  test("B.4 `.A` in a struct field typed as a DIFFERENT enum (`Bar`) — E-TYPE-063 against Bar (no over-resolve)", () => {
    const src = `<program>\${
      type Foo:enum = { A, B(x: int) }
      type Bar:enum = { X, Y }
      type Tok:struct = { kind: Bar, len: int }
      function mk() -> Tok { return { kind: .A, len: 2 } }
    }</program>`;
    const { errors } = compile(src);
    const e063 = errsByCode(errors, "E-TYPE-063");
    expect(e063.some((e) => e.message.includes(".A") && e.message.includes("Bar"))).toBe(true);
  });

  test("B.5 union-typed struct field, unique declarer: `return { kind: .A }` (Foo|Bar) — no fire", () => {
    const src = `<program>\${
      type Foo:enum = { A, B(x: int) }
      type Bar:enum = { X, Y }
      type Tok:struct = { kind: Foo | Bar, len: int }
      function mk() -> Tok { return { kind: .A, len: 2 } }
    }</program>`;
    const { errors } = compile(src);
    expect(errsByCode(errors, "E-VARIANT-AMBIGUOUS").length).toBe(0);
    expect(errsByCode(errors, "E-TYPE-063").length).toBe(0);
  });

  test("B.6 union-typed struct field, SHARED variant name: `return { kind: .Shared }` — E-VARIANT-AMBIGUOUS", () => {
    const src = `<program>\${
      type Foo:enum = { Shared, B(x: int) }
      type Bar:enum = { Shared, Y }
      type Tok:struct = { kind: Foo | Bar, len: int }
      function mk() -> Tok { return { kind: .Shared, len: 2 } }
    }</program>`;
    const { errors } = compile(src);
    expect(errsByCode(errors, "E-VARIANT-AMBIGUOUS").length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// C — no-regression: the pre-existing return forms are byte-identical
// ===========================================================================

describe("C — no-regression: plain enum / union / ctor-arg returns unchanged", () => {
  test("C.1 plain enum return `return .A` (-> Foo) — no fire", () => {
    const src = `<program>\${
      type Foo:enum = { A, B(x: int) }
      function mk() -> Foo { return .A }
    }</program>`;
    const { errors } = compile(src);
    expect(errsByCode(errors, "E-VARIANT-AMBIGUOUS").length).toBe(0);
    expect(errsByCode(errors, "E-TYPE-063").length).toBe(0);
  });

  test("C.2 union return `return .A` (-> Foo | Bar, unique declarer) — no fire", () => {
    const src = `<program>\${
      type Foo:enum = { A, B(x: int) }
      type Bar:enum = { X, Y }
      function mk() -> Foo | Bar { return .A }
    }</program>`;
    const { errors } = compile(src);
    expect(errsByCode(errors, "E-VARIANT-AMBIGUOUS").length).toBe(0);
    expect(errsByCode(errors, "E-TYPE-063").length).toBe(0);
  });

  test("C.3 payload ctor-arg return `return .OnePlayer(.Easy)` (ss16 C5) — no fire", () => {
    const src = `<program>\${
      type Difficulty:enum = { Easy, Hard }
      type Mode:enum = { OnePlayer(d: Difficulty), TwoPlayer }
      function mk() -> Mode { return .OnePlayer(.Easy) }
    }</program>`;
    const { errors } = compile(src);
    expect(errsByCode(errors, "E-VARIANT-AMBIGUOUS").length).toBe(0);
    expect(errsByCode(errors, "E-TYPE-063").length).toBe(0);
  });

  test("C.4 enum-typo plain return `return .Nope` (-> Foo) — E-TYPE-063", () => {
    const src = `<program>\${
      type Foo:enum = { A, B(x: int) }
      function mk() -> Foo { return .Nope }
    }</program>`;
    const { errors } = compile(src);
    const e063 = errsByCode(errors, "E-TYPE-063");
    expect(e063.some((e) => e.message.includes(".Nope"))).toBe(true);
  });
});

// ===========================================================================
// D — state/reactive-decl cross-enum call-arg (same ordering fix as return)
//
// The reactive/state-decl path ran the call-arg walker AFTER the struct-nav
// walker, so a call-arg whose param enum differed from the state-cell's
// annotation type false-fired E-TYPE-063 against the annotation type
// (`<t>: Tok = wrap(.Paren)` where `wrap(b: Bra) -> Tok`). The let-decl path
// already ran call-args first; the fix reorders the reactive path to match.
// ===========================================================================

describe("D — state/reactive-decl cross-enum call-arg resolves against param enum", () => {
  test("D.1 `<t>: Tok = wrap(.Paren)` where wrap(b:Bra)->Tok — no false E-TYPE-063", () => {
    const src = `<program>\${
      type Bra:enum = { Paren, Brace }
      type Tok:enum = { Num, Str }
      function wrap(b: Bra) -> Tok { return .Num }
      <t>: Tok = wrap(.Paren)
    }</program>`;
    const { errors } = compile(src);
    expect(errsByCode(errors, "E-TYPE-063").length).toBe(0);
    expect(errsByCode(errors, "E-VARIANT-AMBIGUOUS").length).toBe(0);
  });

  test("D.2 typo call-arg at state-decl: `<t>: Tok = wrap(.Nope)` — E-TYPE-063 against Bra (soundness)", () => {
    const src = `<program>\${
      type Bra:enum = { Paren, Brace }
      type Tok:enum = { Num, Str }
      function wrap(b: Bra) -> Tok { return .Num }
      <t>: Tok = wrap(.Nope)
    }</program>`;
    const { errors } = compile(src);
    const e063 = errsByCode(errors, "E-TYPE-063");
    expect(e063.some((e) => e.message.includes(".Nope") && e.message.includes("Bra"))).toBe(true);
  });

  test("D.3 ss16 C5 ctor-arg at state-decl still resolves after reorder: `<mode>: Mode = .OnePlayer(.Easy)` — no fire", () => {
    const src = `<program>\${
      type Difficulty:enum = { Easy, Hard }
      type Mode:enum = { OnePlayer(d: Difficulty), TwoPlayer }
      <mode>: Mode = .OnePlayer(.Easy)
    }</program>`;
    const { errors } = compile(src);
    expect(errsByCode(errors, "E-TYPE-063").length).toBe(0);
    expect(errsByCode(errors, "E-VARIANT-AMBIGUOUS").length).toBe(0);
  });

  test("D.4 same-enum call-arg at state-decl: `<t>: Foo = pick(.A)` (pick(f:Foo)->Foo) — no fire", () => {
    const src = `<program>\${
      type Foo:enum = { A, B(x: int) }
      function pick(f: Foo) -> Foo { return f }
      <t>: Foo = pick(.A)
    }</program>`;
    const { errors } = compile(src);
    expect(errsByCode(errors, "E-TYPE-063").length).toBe(0);
    expect(errsByCode(errors, "E-VARIANT-AMBIGUOUS").length).toBe(0);
  });
});
