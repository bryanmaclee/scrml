/**
 * g-unary-left-of-exponent-no-paren (ss21) — a unary LEFT operand of `**`
 * MUST be parenthesized, or the re-serialized JS is a SyntaxError.
 *
 * JS grammar (ExponentiationExpression):
 *     UnaryExpression
 *   | UpdateExpression ** ExponentiationExpression
 * The operand directly to the LEFT of `**` may NOT be an un-parenthesized
 * UnaryExpression (`-`, `+`, `!`, `~`, `typeof`, `void`, `delete`, `await`).
 * `node --check` rejects `-x ** 2`: "Unary operator used immediately before
 * exponentiation expression. Parenthesis must be used to disambiguate."
 * UpdateExpressions (`++` / `--`, prefix or postfix) ARE valid `**` bases.
 *
 * THE BUG (this fix): the user writes the only parseable form that expresses
 * "negate `@a`, then square it" — `(-@a) ** 2`. acorn parses it to the tree
 * `Binary(**, Unary(-, @a), 2)` but DROPS the ParenthesizedExpression (no
 * `preserveParens`). Both AST serializers — `emitBinary`/`binaryOperandNeedsParens`
 * (emit-expr.ts) and its round-trip twin `emitStringFromTree` (expression-parser.ts)
 * — historically re-emitted the flat `-… ** 2`, which is INVALID JS (the LOUD
 * E-CODEGEN-INVALID-LOGIC class — distinct from the SILENT g-paren-ternary drop).
 * The fix wraps a unary LEFT operand of `**` (excluding `++`/`--`).
 *
 * §1  emit-expr.ts printer — exact emit + acorn validity + runtime value.
 * §2  emitStringFromTree round-trip twin — exact source reconstruction.
 * §3  NO-REGRESSION — sibling expr shapes gain NO spurious parens.
 * §4  end-to-end — `(-@a) ** 2` through emit-expr.ts contexts (structural decl,
 *     control-flow condition) emits valid, correctly-parenthesized JS.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import * as acorn from "acorn";
import { emitExpr } from "../../src/codegen/emit-expr.ts";
import { emitStringFromTree } from "../../src/expression-parser.ts";
import { compileScrml } from "../../src/api.js";

// ---------------------------------------------------------------------------
// AST builders (minimal — span is unused by the emit path).
// ---------------------------------------------------------------------------
const SPAN = { start: 0, end: 0 };
const num = (raw) => ({ kind: "lit", litType: "number", raw, span: SPAN });
const id = (name) => ({ kind: "ident", name, span: SPAN });
const bin = (op, left, right) => ({ kind: "binary", op, left, right, span: SPAN });
const un = (op, argument, prefix = true) => ({ kind: "unary", op, argument, prefix, span: SPAN });

const CTX = { mode: "client" };
const emit = (node) => emitExpr(node, CTX);

// `node --check`-faithful validity probe (acorn is the compiler's own dep).
const isValidJs = (js) => {
  try { acorn.parse(`let __r = ${js};`, { ecmaVersion: 2022 }); return true; }
  catch { return false; }
};

// ---------------------------------------------------------------------------
// §1 — emit-expr.ts printer
// ---------------------------------------------------------------------------
describe("g-unary-exp §1: emit-expr.ts wraps a unary LEFT operand of **", () => {
  test("(-@a) ** 2 → (-…) ** 2, valid, === 9 (a=3)", () => {
    const out = emit(bin("**", un("-", id("@a")), num("2")));
    expect(out).toBe('(-_scrml_reactive_get("a")) ** 2');
    expect(isValidJs(out)).toBe(true);
    expect(eval(out.replace('_scrml_reactive_get("a")', "3"))).toBe(9);
  });

  test("(-a) ** b → (-a) ** b, valid, === 9 (a=3,b=2)", () => {
    const out = emit(bin("**", un("-", id("a")), id("b")));
    expect(out).toBe("(-a) ** b");
    expect(isValidJs(out)).toBe(true);
    expect(eval("(-3) ** 2")).toBe(9);
  });

  test("!@flag ** 2 → (!…) ** 2, valid, === 1 (flag=0)", () => {
    const out = emit(bin("**", un("!", id("@flag")), num("2")));
    expect(out).toBe('(!_scrml_reactive_get("flag")) ** 2');
    expect(isValidJs(out)).toBe(true);
    expect(eval(out.replace('_scrml_reactive_get("flag")', "0"))).toBe(1);
  });

  test("~a ** 2 → (~a) ** 2, valid, === 4 (a=1: (~1)=-2, (-2)**2=4)", () => {
    const out = emit(bin("**", un("~", id("a")), num("2")));
    expect(out).toBe("(~a) ** 2");
    expect(isValidJs(out)).toBe(true);
    expect(eval("(~1) ** 2")).toBe(4);
  });

  test("typeof a ** 2 → (typeof a) ** 2, valid JS", () => {
    const out = emit(bin("**", un("typeof", id("a")), num("2")));
    expect(out).toBe("(typeof a) ** 2");
    expect(isValidJs(out)).toBe(true);
  });

  test("right-assoc chain: -a ** b ** c → (-a) ** b ** c, valid, === 256", () => {
    // Right-assoc `**`: Binary(**, Unary(-,a), Binary(**, b, c)). Only the
    // unary LEFT is wrapped; the right `b ** c` stays bare (natural grouping).
    const out = emit(bin("**", un("-", id("a")), bin("**", id("b"), id("c"))));
    expect(out).toBe("(-a) ** b ** c");
    expect(isValidJs(out)).toBe(true);
    expect(eval("(-2) ** 2 ** 3")).toBe(256); // (-2) ** (2**3) = (-2)**8 = 256
  });

  test("nested -(-a) ** 2 → outer unary wrapped + B3 space-split, valid, === 4 (a=2)", () => {
    // Binary(**, Unary(-, Unary(-, a)), 2). The outer unary LEFT operand is
    // wrapped → `(- -a) ** 2`. B3 (g-double-unary-minus-emit-decrement, RE-
    // BASELINED here from the pre-fix `(--a) ** 2`) inserts the space so the
    // stacked unary-minus does NOT fuse into the `--` pre-decrement token — the
    // emitted form is the double-NEGATION (value === a), not a pre-decrement
    // (a-1 + a stray mutation). The runtime value is now assertable.
    const out = emit(bin("**", un("-", un("-", id("a"))), num("2")));
    expect(out).toBe("(- -a) ** 2");
    expect(isValidJs(out)).toBe(true);
    expect(eval("(- -2) ** 2")).toBe(4); // (-(-2))**2 = 2**2 = 4
  });

  test("clean nested -!@flag ** 2 → (-!…) ** 2, valid, === 1 (flag=0)", () => {
    const out = emit(bin("**", un("-", un("!", id("@flag"))), num("2")));
    expect(out).toBe('(-!_scrml_reactive_get("flag")) ** 2');
    expect(isValidJs(out)).toBe(true);
    expect(eval(out.replace('_scrml_reactive_get("flag")', "0"))).toBe(1); // -(!0=1)=-1; (-1)**2=1
  });
});

// ---------------------------------------------------------------------------
// §1b — UpdateExpression bases (`++`/`--`) are VALID `**` bases — NOT wrapped
// ---------------------------------------------------------------------------
describe("g-unary-exp §1b: update-expression `**` bases are NOT wrapped", () => {
  test("postfix x++ ** 2 stays bare (UpdateExpression is a valid ** base)", () => {
    const out = emit(bin("**", un("++", id("x"), false), num("2")));
    expect(out).toBe("x++ ** 2");
    expect(isValidJs(out)).toBe(true);
  });

  test("prefix ++x ** 2 stays bare", () => {
    const out = emit(bin("**", un("++", id("x"), true), num("2")));
    expect(out).toBe("++x ** 2");
    expect(isValidJs(out)).toBe(true);
  });

  test("postfix x-- ** 2 stays bare", () => {
    const out = emit(bin("**", un("--", id("x"), false), num("2")));
    expect(out).toBe("x-- ** 2");
    expect(isValidJs(out)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §2 — emitStringFromTree round-trip twin
// ---------------------------------------------------------------------------
describe("g-unary-exp §2: emitStringFromTree round-trips a unary ** base wrapped", () => {
  test("(-@a) ** 2 reconstructs as (-@a) ** 2", () => {
    expect(emitStringFromTree(bin("**", un("-", id("@a")), num("2")))).toBe("(-@a) ** 2");
  });

  test("!@flag ** 2 reconstructs as (!@flag) ** 2", () => {
    expect(emitStringFromTree(bin("**", un("!", id("@flag")), num("2")))).toBe("(!@flag) ** 2");
  });

  test("right child unary NOT wrapped: @a ** -@b → @a ** -@b", () => {
    expect(emitStringFromTree(bin("**", id("@a"), un("-", id("@b"))))).toBe("@a ** -@b");
  });

  test("postfix update base NOT wrapped: x++ ** 2 → x++ ** 2", () => {
    expect(emitStringFromTree(bin("**", un("++", id("x"), false), num("2")))).toBe("x++ ** 2");
  });
});

// ---------------------------------------------------------------------------
// §3 — NO-REGRESSION: sibling shapes gain NO spurious parens
// ---------------------------------------------------------------------------
describe("g-unary-exp §3: sibling expr shapes are NOT over-parenthesized", () => {
  test("a + -b stays flat (unary binds tighter than +)", () => {
    expect(emit(bin("+", id("a"), un("-", id("b"))))).toBe("a + -b");
    expect(emitStringFromTree(bin("+", id("a"), un("-", id("b"))))).toBe("a + -b");
  });

  test("-a * b stays flat (unary base of * is legal)", () => {
    expect(emit(bin("*", un("-", id("a")), id("b")))).toBe("-a * b");
    expect(emitStringFromTree(bin("*", un("-", id("a")), id("b")))).toBe("-a * b");
  });

  test("RIGHT operand unary of **: a ** -b stays bare (JS allows `2 ** -1`)", () => {
    const out = emit(bin("**", id("a"), un("-", id("b"))));
    expect(out).toBe("a ** -b");
    expect(isValidJs(out)).toBe(true);
    expect(eval("2 ** -3")).toBe(0.125);
  });

  test("** numeric children unaffected: 2 ** 3 ** 2 stays flat (=== 512)", () => {
    const out = emit(bin("**", num("2"), bin("**", num("3"), num("2"))));
    expect(out).toBe("2 ** 3 ** 2");
    expect(eval(out)).toBe(512);
  });

  test("** binary-left child re-paren unaffected: (2 ** 3) ** 2 (=== 64)", () => {
    const out = emit(bin("**", bin("**", num("2"), num("3")), num("2")));
    expect(out).toBe("(2 ** 3) ** 2");
    expect(eval(out)).toBe(64);
  });

  test("plain arithmetic unaffected: (a + b) * c", () => {
    expect(emit(bin("*", bin("+", id("a"), id("b")), id("c")))).toBe("(a + b) * c");
  });
});

// ---------------------------------------------------------------------------
// §4 — end-to-end: `(-@a) ** 2` through emit-expr.ts compile contexts
// ---------------------------------------------------------------------------
let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "gunaryexp-")); });
afterAll(() => { if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true }); });

function compileSource(name, source) {
  const filePath = join(TMP, name);
  writeFileSync(filePath, source);
  return compileScrml({ inputFiles: [filePath], outputDir: join(TMP, "dist"), write: false, log: () => {} });
}
function clientJsFor(result, srcName) {
  for (const [filePath, out] of result.outputs) {
    if (filePath.endsWith(srcName) && typeof out.clientJs === "string") return out.clientJs;
  }
  return undefined;
}
const clientValid = (js) => {
  try { acorn.parse(js, { ecmaVersion: 2022, sourceType: "module" }); return true; }
  catch { return false; }
};

describe("g-unary-exp §4: end-to-end compile of (-@a) ** 2 emits valid JS", () => {
  test("structural decl `<r> = (-@a) ** 2` — parens preserved, valid JS", () => {
    const src = `<program>\n\n<a> = 3\n<r> = (-@a) ** 2\n\n<div>\${@r}</div>\n\n</program>`;
    const result = compileSource("decl.scrml", src);
    const client = clientJsFor(result, "decl.scrml");
    expect(typeof client).toBe("string");
    expect(clientValid(client)).toBe(true);
    // Parenthesized unary base survives.
    expect(client).toContain('(-_scrml_reactive_get("a")) ** 2');
    // Regression guard: the flat (invalid) `…get("a") ** 2` form — one close
    // paren before `**` — must NOT appear (GREEN has the extra wrap close paren).
    expect(client).not.toMatch(/_scrml_reactive_get\("a"\) \*\* 2/);
  });

  test("control-flow condition `if ((-@a) ** 2 > 1)` — parens preserved, valid JS", () => {
    const src = `<program>\n\n<a> = 3\n\${ if ((-@a) ** 2 > 1) { @a = 1 } }\n\n<div>\${@a}</div>\n\n</program>`;
    const result = compileSource("cond.scrml", src);
    const client = clientJsFor(result, "cond.scrml");
    expect(typeof client).toBe("string");
    expect(clientValid(client)).toBe(true);
    expect(client).toContain('(-_scrml_reactive_get("a")) ** 2');
  });
});


// ---------------------------------------------------------------------------
// §5 — B1 (g-unary-left-of-exponent-no-paren, BARE form). The §1 fix wraps a
//      unary LEFT operand of `**` on the AST path — but only when codegen
//      RECEIVES an AST. The BARE source `-@a ** 2` is itself a JS SyntaxError,
//      so acorn REJECTS it when parsing the placeholder-substituted expression
//      → codegen fell back to the string-rewrite path (which never reaches the
//      §1 AST guard) → re-emitted the flat `- … ** 2` SILENTLY (compile exit-0,
//      invalid JS). The B1 fix detects the unary-`**` shape on the acorn-
//      fallback path (expression-parser `detectUnaryLeftOfExponent` →
//      escape-hatch `exponentDiagnostic` → ast-builder TABError) and surfaces a
//      LOUD E-CODEGEN-INVALID-LOGIC instead. The author-paren `(-@a) ** 2` parses
//      cleanly and is UNAFFECTED (Bug-A / §4 guard intact).
// ---------------------------------------------------------------------------
const codesOf = (result) => (result.errors || []).map((e) => e.code);

describe("g-unary-exp §5: BARE `-@a ** 2` is a LOUD E-CODEGEN-INVALID-LOGIC (not silent)", () => {
  test("structured decl `<r> = -@a ** 2` — LOUD reject, not silent-invalid JS", () => {
    const src = `<program>\n\n<a> = 3\n<r> = -@a ** 2\n\n<div>\${@r}</div>\n\n</program>`;
    const result = compileSource("bare-decl.scrml", src);
    // The compile now ABORTS loud (error present) rather than shipping the
    // silently-invalid `- _scrml_reactive_get("a") ** 2` artifact.
    expect(codesOf(result)).toContain("E-CODEGEN-INVALID-LOGIC");
  });

  test("logic-block `${ @r = -@a ** 2 }` — LOUD reject (@a inside ${...})", () => {
    const src = `<program>\n\n<a> = 3\n<r> = 0\n\n\${ @r = -@a ** 2 }\n\n<div>\${@r}</div>\n\n</program>`;
    const result = compileSource("bare-logic.scrml", src);
    expect(codesOf(result)).toContain("E-CODEGEN-INVALID-LOGIC");
  });

  test("bang base `!@flag ** 2` — LOUD reject (any prefix unary, not just `-`)", () => {
    const src = `<program>\n\n<flag> = 0\n<r> = !@flag ** 2\n\n<div>\${@r}</div>\n\n</program>`;
    const result = compileSource("bare-bang.scrml", src);
    expect(codesOf(result)).toContain("E-CODEGEN-INVALID-LOGIC");
  });

  test("author-paren `(-@a) ** 2` still compiles CLEAN — Bug-A guard intact", () => {
    const src = `<program>\n\n<a> = 3\n<r> = (-@a) ** 2\n\n<div>\${@r}</div>\n\n</program>`;
    const result = compileSource("paren-decl.scrml", src);
    expect(codesOf(result)).not.toContain("E-CODEGEN-INVALID-LOGIC");
    const client = clientJsFor(result, "paren-decl.scrml");
    expect(typeof client).toBe("string");
    expect(clientValid(client)).toBe(true);
    expect(client).toContain('(-_scrml_reactive_get("a")) ** 2');
  });

  test("NO false-positive: sibling shapes carrying `**` (or `-`) compile clean", () => {
    // `-@a * 2` (unary base of `*` is legal), `@a ** 2` (no unary base),
    // `@a ** -@b` (RIGHT operand unary is legal: `2 ** -1`), `-@a` (no `**`).
    const fixtures = [
      ["sib-mul.scrml", "-@a * 2"],
      ["sib-pow.scrml", "@a ** 2"],
      ["sib-rpow.scrml", "@a ** -@b"],
      ["sib-neg.scrml", "-@a"],
    ];
    for (const [name, rhs] of fixtures) {
      const src = `<program>\n\n<a> = 3\n<b> = 2\n<r> = ${rhs}\n\n<div>\${@r}</div>\n\n</program>`;
      const result = compileSource(name, src);
      expect(codesOf(result)).not.toContain("E-CODEGEN-INVALID-LOGIC");
    }
  });
});
