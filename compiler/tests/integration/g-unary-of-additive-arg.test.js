/**
 * g-unary-of-additive-arg (HIGH — SILENT wrong-value miscompile) — a prefix
 * unary applied to a LOOSER-binding argument MUST parenthesize that argument.
 *
 * THE BUG: scrml drops the author's parens (acorn parses without
 * `preserveParens`), so `-(2 + 3)` reaches codegen as `Unary(-, Binary(+, 2, 3))`
 * and emitUnary re-serialized the FLAT `-2 + 3`. That is VALID JS — `node --check`
 * is clean, the compile exits 0 — but it parses as `(-2) + 3` = 1, NOT `-(2 + 3)`
 * = -5. A silent wrong-value miscompile (the worst class). `-(2 - 3)` → `-2 - 3`
 * = -5 (should be 1) is the same shape.
 *
 * THE FIX (this suite): emitUnary GENERALIZES the ss50 `**`-only special case to
 * wrap ANY argument whose top operator binds LOOSER than the prefix unary — every
 * flat binary (additive, multiplicative, relational, shift, bitwise, logical,
 * `**`) and the loose `?:` / assignment / arrow forms — via unaryArgNeedsParens.
 * The mis-association hits ALL prefix unaries: for `-`/`+` over an additive arg it
 * is a SILENT wrong value; for `!`/`~`/`typeof`/`void` over ANY looser arg it is
 * wrong too (`!(a+b)` → `!a + b` = `(!a) + b`). For `-` over a multiplicative arg
 * the value is coincidentally right (negation distributes) but the wrap is still
 * correct and applied uniformly.
 *
 * Sibling guards (this suite asserts they are NOT disturbed):
 *   - ss21 g-unary-left-of-exponent-no-paren — a unary LEFT operand of `**`
 *     (`(-2) ** 3`), handled in binaryOperandNeedsParens (the inverse direction).
 *   - ss50 g-unary-of-exponent-arg-no-paren — `-(2 ** 3)` (the LOUD invalid-JS
 *     instance this fix subsumes into the general looser-binds class).
 *
 * §1  the core bug — additive args wrapped, correct runtime value.
 * §2  every prefix unary operator wraps a looser-binding (additive) argument.
 * §3  other looser-binding arg classes — relational / equality / logical /
 *     shift / bitwise / ternary — wrapped, value-correct, no double-wrap.
 * §4  NO over-wrap (does-not-over-fire) — atom / nested-unary / member / call
 *     args + the ss21 + ss50 siblings stay intact.
 * §5  chained / mixed nesting.
 * §6  end-to-end compile (R26 anchor) — `-(2 + 3)` emits the wrapped form, never
 *     the flat `-2 + 3`.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import * as acorn from "acorn";
import { emitExpr } from "../../src/codegen/emit-expr.ts";
import { compileScrml } from "../../src/api.js";
import { foldChunkNamespacing } from "../helpers/chunk-scope.js";

// ---------------------------------------------------------------------------
// AST builders (minimal — span is unused by the emit path).
// ---------------------------------------------------------------------------
const SPAN = { start: 0, end: 0 };
const num = (raw) => ({ kind: "lit", litType: "number", raw, span: SPAN });
const id = (name) => ({ kind: "ident", name, span: SPAN });
const bin = (op, left, right) => ({ kind: "binary", op, left, right, span: SPAN });
const un = (op, argument, prefix = true) => ({ kind: "unary", op, argument, prefix, span: SPAN });
const tern = (condition, consequent, alternate) => ({ kind: "ternary", condition, consequent, alternate, span: SPAN });
const member = (object, property) => ({ kind: "member", object, property, optional: false, span: SPAN });
const call = (callee, args = []) => ({ kind: "call", callee, args, optional: false, span: SPAN });
const assign = (op, target, value) => ({ kind: "assign", op, target, value, span: SPAN });

const CTX = { mode: "client" };
const emit = (node) => emitExpr(node, CTX);

// `node --check`-faithful validity probe (acorn is the compiler's own dep).
const isValidJs = (js) => {
  try { acorn.parse(`let __r = ${js};`, { ecmaVersion: 2022 }); return true; }
  catch { return false; }
};
// Bind the idents used in runtime-eval checks.
const evalWith = (js) => Function("a", "b", "c", "d", `return (${js});`);

// ---------------------------------------------------------------------------
// §1 — the core bug: a prefix unary over an additive argument
// ---------------------------------------------------------------------------
describe("g-unary-of-additive-arg §1: additive argument is wrapped, value correct", () => {
  test("-(2 + 3) → -(2 + 3), valid, === -5 (NOT the flat -2 + 3 = 1)", () => {
    const out = emit(un("-", bin("+", num("2"), num("3"))));
    expect(out).toBe("-(2 + 3)");
    expect(isValidJs(out)).toBe(true);
    expect(eval(out)).toBe(-5);
    // The bug shipped the flat, value-WRONG form. Guard against its return.
    expect(out).not.toBe("-2 + 3");
    expect(eval("-2 + 3")).toBe(1); // proves the old emit was a wrong value
  });

  test("-(2 - 3) → -(2 - 3), valid, === 1 (NOT the flat -2 - 3 = -5)", () => {
    const out = emit(un("-", bin("-", num("2"), num("3"))));
    expect(out).toBe("-(2 - 3)");
    expect(isValidJs(out)).toBe(true);
    expect(eval(out)).toBe(1);
    expect(eval("-2 - 3")).toBe(-5); // proves the old emit was a wrong value
  });

  test("-(a + b) → -(a + b), valid, === -5 (a=2,b=3)", () => {
    const out = emit(un("-", bin("+", id("a"), id("b"))));
    expect(out).toBe("-(a + b)");
    expect(isValidJs(out)).toBe(true);
    expect(evalWith(out)(2, 3)).toBe(-5);
  });

  test("+(2 + 3) → +(2 + 3), valid, === 5", () => {
    const out = emit(un("+", bin("+", num("2"), num("3"))));
    expect(out).toBe("+(2 + 3)");
    expect(isValidJs(out)).toBe(true);
    expect(eval(out)).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// §2 — every prefix unary operator wraps a looser-binding (additive) argument
// ---------------------------------------------------------------------------
describe("g-unary-of-additive-arg §2: every prefix unary wraps an additive argument", () => {
  test("!(2 + 3) → !(2 + 3), valid, === false (NOT flat !2 + 3 = 3)", () => {
    const out = emit(un("!", bin("+", num("2"), num("3"))));
    expect(out).toBe("!(2 + 3)");
    expect(isValidJs(out)).toBe(true);
    expect(eval(out)).toBe(false);
    expect(eval("!2 + 3")).toBe(3); // the old flat form was a wrong value
  });

  test("~(2 + 3) → ~(2 + 3), valid, === -6 (NOT flat ~2 + 3 = 0)", () => {
    const out = emit(un("~", bin("+", num("2"), num("3"))));
    expect(out).toBe("~(2 + 3)");
    expect(isValidJs(out)).toBe(true);
    expect(eval(out)).toBe(-6);
    expect(eval("~2 + 3")).toBe(0); // ~2 = -3, -3 + 3 = 0 — wrong
  });

  test("typeof (2 + 3) → typeof (2 + 3) (space kept), valid, === 'number'", () => {
    const out = emit(un("typeof", bin("+", num("2"), num("3"))));
    expect(out).toBe("typeof (2 + 3)");
    expect(isValidJs(out)).toBe(true);
    expect(eval(out)).toBe("number");
    expect(eval("typeof 2 + 3")).toBe("number3"); // old flat: "number" + 3
  });

  test("void (2 + 3) → void (2 + 3) (space kept), valid, === undefined", () => {
    const out = emit(un("void", bin("+", num("2"), num("3"))));
    expect(out).toBe("void (2 + 3)");
    expect(isValidJs(out)).toBe(true);
    expect(eval(out)).toBe(undefined);
  });
});

// ---------------------------------------------------------------------------
// §3 — other looser-binding argument classes
// ---------------------------------------------------------------------------
describe("g-unary-of-additive-arg §3: relational / logical / shift / bitwise / ternary / equality args", () => {
  test("relational: !(2 < 3) → !(2 < 3), valid, === false (NOT flat !2 < 3 = true)", () => {
    const out = emit(un("!", bin("<", num("2"), num("3"))));
    expect(out).toBe("!(2 < 3)");
    expect(isValidJs(out)).toBe(true);
    expect(eval(out)).toBe(false);
    expect(eval("!2 < 3")).toBe(true); // (!2) < 3 = false < 3 = 0 < 3 = true — wrong
  });

  test("logical-or: -(0 || 5) → -(0 || 5), valid, === -5", () => {
    const out = emit(un("-", bin("||", num("0"), num("5"))));
    expect(out).toBe("-(0 || 5)");
    expect(isValidJs(out)).toBe(true);
    expect(eval(out)).toBe(-5);
  });

  test("logical-and: !(2 && 0) → !(2 && 0), valid, === true (NOT flat !2 && 0 = 0)", () => {
    const out = emit(un("!", bin("&&", num("2"), num("0"))));
    expect(out).toBe("!(2 && 0)");
    expect(isValidJs(out)).toBe(true);
    expect(eval(out)).toBe(true);
    expect(eval("!2 && 0")).toBe(false); // (!2) && 0 = false && 0 = false — wrong
  });

  test("shift: ~(1 << 2) → ~(1 << 2), valid, === -5 (NOT flat ~1 << 2 = -8)", () => {
    const out = emit(un("~", bin("<<", num("1"), num("2"))));
    expect(out).toBe("~(1 << 2)");
    expect(isValidJs(out)).toBe(true);
    expect(eval(out)).toBe(-5);
    expect(eval("~1 << 2")).toBe(-8); // (~1) << 2 = -2 << 2 = -8 — wrong
  });

  test("bitwise-or: ~(1 | 2) → ~(1 | 2), valid, === -4 (NOT flat ~1 | 2 = -2)", () => {
    const out = emit(un("~", bin("|", num("1"), num("2"))));
    expect(out).toBe("~(1 | 2)");
    expect(isValidJs(out)).toBe(true);
    expect(eval(out)).toBe(-4);
    expect(eval("~1 | 2")).toBe(-2); // (~1) | 2 = -2 | 2 = -2 — wrong
  });

  test("ternary: -(0 ? 2 : 3) → -(0 ? 2 : 3), valid, === -3 (NOT flat -0 ? 2 : 3 = 3)", () => {
    const out = emit(un("-", tern(num("0"), num("2"), num("3"))));
    expect(out).toBe("-(0 ? 2 : 3)");
    expect(isValidJs(out)).toBe(true);
    expect(eval(out)).toBe(-3);
    expect(eval("-0 ? 2 : 3")).toBe(3); // (-0) ? 2 : 3 = 3 (−0 falsy) — wrong
  });

  test("assignment: -(a = 5) → -(a = 5), valid, === -5", () => {
    const out = emit(un("-", assign("=", id("a"), num("5"))));
    expect(out).toBe("-(a = 5)");
    expect(isValidJs(out)).toBe(true);
    expect(evalWith(out)(0)).toBe(-5);
  });

  test("equality (self-bracketed) NOT double-wrapped: !(2 == 3) → !(2 === 3), valid, === true", () => {
    const out = emit(un("!", bin("==", num("2"), num("3"))));
    expect(out).toBe("!(2 === 3)");
    expect(out).not.toContain("((");
    expect(isValidJs(out)).toBe(true);
    expect(eval(out)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §4 — NO over-wrap: tighter-or-equal-binding args + the sibling guards
// ---------------------------------------------------------------------------
describe("g-unary-of-additive-arg §4: tighter-binding args are NOT over-parenthesized", () => {
  test("atom arg: -(a) stays -a", () => {
    expect(emit(un("-", id("a")))).toBe("-a");
  });

  test("unary RIGHT operand of a flat binary stays flat: a + -b", () => {
    // The unary's own argument is the ident `b` (a primary), so no wrap.
    expect(emit(bin("+", id("a"), un("-", id("b"))))).toBe("a + -b");
  });

  test("unary LEFT operand of `*` stays flat: -a * b", () => {
    // `Binary(*, Unary(-, a), b)` — the unary's argument is the ident `a`.
    expect(emit(bin("*", un("-", id("a")), id("b")))).toBe("-a * b");
  });

  test("member arg: -(a.b) stays -a.b (member is a primary)", () => {
    expect(emit(un("-", member(id("a"), "b")))).toBe("-a.b");
  });

  test("call arg: -f(x) stays -f(x) (call is a primary)", () => {
    expect(emit(un("-", call(id("f"), [id("x")])))).toBe("-f(x)");
  });

  test("nested unary: -(-a) → - -a (B3 space-split, NO parens)", () => {
    const out = emit(un("-", un("-", id("a"))));
    expect(out).toBe("- -a");
    expect(isValidJs(out)).toBe(true);
    expect(evalWith(out)(7)).toBe(7);
  });

  test("ss21 intact: (-2) ** 3 stays (-2) ** 3, valid, === -8", () => {
    const out = emit(bin("**", un("-", num("2")), num("3")));
    expect(out).toBe("(-2) ** 3");
    expect(isValidJs(out)).toBe(true);
    expect(eval(out)).toBe(-8);
  });

  test("ss50 intact: -(2 ** 3) stays -(2 ** 3), valid, === -8", () => {
    const out = emit(un("-", bin("**", num("2"), num("3"))));
    expect(out).toBe("-(2 ** 3)");
    expect(isValidJs(out)).toBe(true);
    expect(eval(out)).toBe(-8);
  });
});

// ---------------------------------------------------------------------------
// §5 — chained / mixed nesting
// ---------------------------------------------------------------------------
describe("g-unary-of-additive-arg §5: chained / mixed", () => {
  test("chained: -(-(2 + 3)) → - -(2 + 3), valid, === 5", () => {
    const out = emit(un("-", un("-", bin("+", num("2"), num("3")))));
    expect(out).toBe("- -(2 + 3)");
    expect(isValidJs(out)).toBe(true);
    expect(eval(out)).toBe(5);
  });

  test("mixed: -(2 + 3) * 4 → -(2 + 3) * 4, valid, === -20", () => {
    const out = emit(bin("*", un("-", bin("+", num("2"), num("3"))), num("4")));
    expect(out).toBe("-(2 + 3) * 4");
    expect(isValidJs(out)).toBe(true);
    expect(eval(out)).toBe(-20);
  });

  test("as binary operand: 1 + -(2 + 3) → 1 + -(2 + 3), valid, === -4", () => {
    const out = emit(bin("+", num("1"), un("-", bin("+", num("2"), num("3")))));
    expect(out).toBe("1 + -(2 + 3)");
    expect(isValidJs(out)).toBe(true);
    expect(eval(out)).toBe(-4);
  });
});

// ---------------------------------------------------------------------------
// §6 — end-to-end compile (R26 anchor)
// ---------------------------------------------------------------------------
let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "gunaryadd-")); });
afterAll(() => { if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true }); });

function compileSource(name, source) {
  const filePath = join(TMP, name);
  writeFileSync(filePath, source);
  return compileScrml({ inputFiles: [filePath], outputDir: join(TMP, "dist"), write: false, log: () => {} });
}
function clientJsFor(result, srcName) {
  for (const [filePath, out] of result.outputs) {
    if (filePath.endsWith(srcName) && typeof foldChunkNamespacing(out.clientJs) === "string") return foldChunkNamespacing(out.clientJs);
  }
  return undefined;
}
const clientValid = (js) => {
  try { acorn.parse(js, { ecmaVersion: 2022, sourceType: "module" }); return true; }
  catch { return false; }
};

describe("g-unary-of-additive-arg §6: end-to-end compile emits the wrapped form", () => {
  test("literal decl `<r> = -(2 + 3)` — parens preserved, NOT the flat -2 + 3", () => {
    const src = `<program>\n\n<r> = -(2 + 3)\n\n<div>\${@r}</div>\n\n</program>`;
    const result = compileSource("add-decl.scrml", src);
    const client = clientJsFor(result, "add-decl.scrml");
    expect(typeof client).toBe("string");
    expect(clientValid(client)).toBe(true);
    expect(client).toContain("-(2 + 3)");
    // Regression guard: the flat (value-WRONG) `-2 + 3` must NOT appear.
    expect(client).not.toMatch(/-2 \+ 3/);
  });

  test("reactive derived `<sum> = -(@a + @b)` — wrapped reactive gets, NOT flat", () => {
    const src = `<program>\n\n<a> = 2\n<b> = 3\n<sum> = -(@a + @b)\n\n<div>\${@sum}</div>\n\n</program>`;
    const result = compileSource("add-reactive.scrml", src);
    const client = clientJsFor(result, "add-reactive.scrml");
    expect(typeof client).toBe("string");
    expect(clientValid(client)).toBe(true);
    expect(client).toContain('-(_scrml_reactive_get("a") + _scrml_reactive_get("b"))');
    // The flat mis-form `-_scrml_reactive_get("a") + _scrml_reactive_get("b")`
    // (= (-a) + b) must NOT appear.
    expect(client).not.toMatch(/-_scrml_reactive_get\("a"\) \+ _scrml_reactive_get\("b"\)/);
  });
});
