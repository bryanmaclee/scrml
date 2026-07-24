/**
 * Bug W — grouping parens dropped → silent wrong arithmetic.
 *
 * Adopter (6nz) P0 silent-correctness bug. Acorn parses `(2 + 3) * 4` into the
 * structurally-correct tree `Binary(*, Binary(+, 2, 3), 4)` but does NOT retain
 * ParenthesizedExpression nodes (no `preserveParens`). The flat binary printer
 * `emitBinary` (compiler/src/codegen/emit-expr.ts, `default` branch) historically
 * concatenated `left op right` with no precedence guard, so the structurally-
 * correct tree printed as the precedence-WRONG flat JS:
 *
 *     (2 + 3) * 4   ->  2 + 3 * 4    // 14, want 20
 *     (1 + 2) * 3   ->  1 + 2 * 3    // 7,  want 9
 *     (10 - 2) / 4  ->  10 - 2 / 4   // 9.5, want 2
 *     ((@a + 1) % 3)->  @a + 1 % 3
 *
 * No diagnostic was emitted — the wrong value compiled silently.
 *
 * Fix (Approach B, user-ratified): precedence-aware paren re-insertion in
 * `emitBinary` — a JS operator-precedence table + `binaryOperandNeedsParens`
 * wraps a child operand when it binds looser than (or, for associativity, equal-
 * and-wrong-side relative to) the parent operator. Self-bracketed forms
 * (`==`/`!=`/`is*`) are excluded to avoid double-parens. ES2020 `??`-vs-`||`/`&&`
 * mixing is force-wrapped.
 *
 * §1 drives the printer directly (exact emit string + runtime eval value).
 * §2 compiles end-to-end and validates the client bundle with acorn (the
 *    compiler's own parser dep — a faithful in-process `node --check`).
 * §3 asserts no-regression: already-correct expressions gain NO spurious parens.
 * §4 asserts the special-cased forms (==/!=/is-some/is-not) are NOT double-parened.
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
const not = () => ({ kind: "lit", litType: "not", raw: "not", span: SPAN });
const bin = (op, left, right) => ({ kind: "binary", op, left, right, span: SPAN });

const CTX = { mode: "client" };
const emit = (node) => emitExpr(node, CTX);

// ---------------------------------------------------------------------------
// §1 — printer-level: exact emit + runtime value correctness
// ---------------------------------------------------------------------------
describe("Bug W §1: emitBinary re-inserts dropped grouping parens (printer)", () => {
  test("(2+3)*4 → (2 + 3) * 4 === 20", () => {
    const out = emit(bin("*", bin("+", num("2"), num("3")), num("4")));
    expect(out).toBe("(2 + 3) * 4");
    expect(eval(out)).toBe(20);
  });

  test("(1+2)*3 → (1 + 2) * 3 === 9", () => {
    const out = emit(bin("*", bin("+", num("1"), num("2")), num("3")));
    expect(out).toBe("(1 + 2) * 3");
    expect(eval(out)).toBe(9);
  });

  test("(10-2)/4 → (10 - 2) / 4 === 2", () => {
    const out = emit(bin("/", bin("-", num("10"), num("2")), num("4")));
    expect(out).toBe("(10 - 2) / 4");
    expect(eval(out)).toBe(2);
  });

  test("((@a+1)%3) — even double-nested grouping survives (@a as ident)", () => {
    // ((@a + 1) % 3) — outer paren is the whole expr; inner is the + under %.
    const out = emit(bin("%", bin("+", id("@a"), num("1")), num("3")));
    // The reactive read lowers to a call; the + child of % must keep its parens.
    expect(out).toBe('(_scrml_reactive_get("a") + 1) % 3');
    // Runtime check with @a substituted = 5: (5 + 1) % 3 === 0
    expect(eval(out.replace('_scrml_reactive_get("a")', "5"))).toBe(0);
  });

  test("nested: ((a+b)*c)-d → ((a + b) * c) - d", () => {
    const node = bin("-", bin("*", bin("+", id("a"), id("b")), id("c")), id("d"));
    const out = emit(node);
    expect(out).toBe("(a + b) * c - d");
    // a=1,b=2,c=3,d=4 → (1+2)*3-4 = 5
    expect(eval(out.replace(/a/, "1").replace(/b/, "2").replace(/c/, "3").replace(/d/, "4"))).toBe(5);
  });

  test("a*(b+c)*d → a * (b + c) * d", () => {
    const node = bin("*", bin("*", id("a"), bin("+", id("b"), id("c"))), id("d"));
    expect(emit(node)).toBe("a * (b + c) * d");
  });

  test("left-assoc same-prec right child: a-(b-c) → a - (b - c)", () => {
    const node = bin("-", id("a"), bin("-", id("b"), id("c")));
    const out = emit(node);
    expect(out).toBe("a - (b - c)");
    // a=10,b=4,c=1 → 10 - (4 - 1) = 7  (flat 10 - 4 - 1 = 5 would be WRONG)
    expect(eval("10 - (4 - 1)")).toBe(7);
    expect(eval(out.replace("a", "10").replace("b", "4").replace("c", "1"))).toBe(7);
  });

  test("** is right-assoc: 2**(3**2) → 2 ** 3 ** 2 === 512 (no spurious paren)", () => {
    const node = bin("**", num("2"), bin("**", num("3"), num("2")));
    const out = emit(node);
    expect(out).toBe("2 ** 3 ** 2");
    expect(eval(out)).toBe(512);
  });

  test("** left child same-prec needs paren: (2**3)**2 → (2 ** 3) ** 2 === 64", () => {
    const node = bin("**", bin("**", num("2"), num("3")), num("2"));
    const out = emit(node);
    expect(out).toBe("(2 ** 3) ** 2");
    expect(eval(out)).toBe(64);
  });

  test("(a||b)&&c → (a || b) && c", () => {
    const node = bin("&&", bin("||", id("a"), id("b")), id("c"));
    expect(emit(node)).toBe("(a || b) && c");
  });

  test("ES2020 ?? mixing: (a||b)??c → (a || b) ?? c (force-wrapped, valid JS)", () => {
    const node = bin("??", bin("||", id("a"), id("b")), id("c"));
    const out = emit(node);
    expect(out).toBe("(a || b) ?? c");
    // The flat form `a || b ?? c` is a SyntaxError; acorn must accept the wrapped form.
    expect(() => acorn.parse(out, { ecmaVersion: 2022 })).not.toThrow();
  });

  test("ES2020 ?? mixing other direction: a??(b||c) → a ?? (b || c)", () => {
    const node = bin("??", id("a"), bin("||", id("b"), id("c")));
    const out = emit(node);
    expect(out).toBe("a ?? (b || c)");
    expect(() => acorn.parse(out, { ecmaVersion: 2022 })).not.toThrow();
  });

  test("ES2020 ?? mixed with && also force-wrapped: (a&&b)??c", () => {
    const node = bin("??", bin("&&", id("a"), id("b")), id("c"));
    const out = emit(node);
    expect(out).toBe("(a && b) ?? c");
    expect(() => acorn.parse(out, { ecmaVersion: 2022 })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// §2 — NO-OP / NO spurious parens for already-correct expressions
// ---------------------------------------------------------------------------
describe("Bug W §2: already-correct expressions gain NO spurious parens", () => {
  test("a+b*c stays flat (multiply binds tighter — no paren needed)", () => {
    expect(emit(bin("+", id("a"), bin("*", id("b"), id("c"))))).toBe("a + b * c");
  });

  test("a*b+c stays flat", () => {
    expect(emit(bin("+", bin("*", id("a"), id("b")), id("c")))).toBe("a * b + c");
  });

  test("left-assoc natural left grouping: a-b-c stays flat", () => {
    // (a - b) - c is the natural left-assoc grouping — left child needs NO paren.
    expect(emit(bin("-", bin("-", id("a"), id("b")), id("c")))).toBe("a - b - c");
  });

  test("bare ident, no parens", () => {
    expect(emit(id("foo"))).toBe("foo");
  });

  test("@cell ref alone, no parens", () => {
    expect(emit(id("@cell"))).toBe('_scrml_reactive_get("cell")');
  });

  test("tighter child of looser parent: a||b&&c stays flat (&& binds tighter)", () => {
    expect(emit(bin("||", id("a"), bin("&&", id("b"), id("c"))))).toBe("a || b && c");
  });
});

// ---------------------------------------------------------------------------
// §3 — special-cased forms must NOT be double-parened
// ---------------------------------------------------------------------------
describe("Bug W §3: special-cased forms not double-parened (is-some/is-not/==)", () => {
  test("@x is some emits its own single outer parens", () => {
    const out = emit(bin("is-some", id("@x"), not()));
    expect(out).toBe('(_scrml_reactive_get("x") !== null && _scrml_reactive_get("x") !== undefined)');
    // single outer paren only — no `((`
    expect(out.startsWith("((")).toBe(false);
  });

  test("(@x is some) && c — is-some child NOT re-wrapped by the && parent", () => {
    const out = emit(bin("&&", bin("is-some", id("@x"), not()), id("c")));
    expect(out).toBe('(_scrml_reactive_get("x") !== null && _scrml_reactive_get("x") !== undefined) && c');
    expect(out).not.toContain("(("); // no double paren around the is-some
  });

  test("@x is not — single outer parens, not doubled", () => {
    const out = emit(bin("is-not", id("@x"), not()));
    expect(out).toBe('(_scrml_reactive_get("x") === null || _scrml_reactive_get("x") === undefined)');
    expect(out.startsWith("((")).toBe(false);
  });

  test("equality with binary operands routes through helper (call-arg scope), no double-paren", () => {
    // a+b == c → _scrml_structural_eq(a + b, c) — call args provide grouping.
    const out = emit(bin("==", bin("+", id("a"), id("b")), id("c")));
    expect(out).toBe("_scrml_structural_eq(a + b, c)");
  });
});

// ---------------------------------------------------------------------------
// §4 — end-to-end: compile real scrml, validate with acorn, assert parens
// ---------------------------------------------------------------------------
let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "bugw-")); });
afterAll(() => { if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true }); });

function compileSource(name, source) {
  const filePath = join(TMP, name);
  writeFileSync(filePath, source);
  return compileScrml({ inputFiles: [filePath], outputDir: join(TMP, "dist"), write: false, log: () => {} });
}

function clientJsFor(result, srcName) {
  for (const [filePath, out] of result.outputs) {
    if (filePath.endsWith(srcName) && typeof out.clientJs === "string") return foldChunkNamespacing(out.clientJs);
  }
  return undefined;
}

function isValidEsm(js) {
  try { acorn.parse(js, { ecmaVersion: 2022, sourceType: "module" }); return { ok: true, error: null }; }
  catch (e) { return { ok: false, error: e.message }; }
}

const E2E_SOURCE = `<program>

@a = 2
@b = 3
@c = 4
@result = (@a + @b) * @c

<div>\${@result}</div>

</program>`;

describe("Bug W §4: end-to-end compile preserves grouping parens", () => {
  test("(@a + @b) * @c compiles with parens preserved + valid JS", () => {
    const result = compileSource("repro.scrml", E2E_SOURCE);
    const client = clientJsFor(result, "repro.scrml");
    expect(typeof client).toBe("string");
    expect(isValidEsm(client).ok).toBe(true);
    // The grouped sum is parenthesized before the multiply.
    expect(client).toContain('(_scrml_reactive_get("a") + _scrml_reactive_get("b")) * _scrml_reactive_get("c")');
    // Guard against regression to the flat (precedence-wrong) form.
    expect(client).not.toContain('_scrml_reactive_get("a") + _scrml_reactive_get("b") * _scrml_reactive_get("c")');
  });
});
