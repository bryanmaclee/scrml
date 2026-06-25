/**
 * g-paren-ternary-operand-paren-dropped (S220) — grouping parens dropped around
 * a ternary (`?:`) operand of a binary operator → silent precedence miscompile.
 *
 * Adopter (flogence) HIGH silent-correctness bug. Acorn parses
 * `(@br.length > 0 ? "[" + @br + "] " : "") + @body` into the structurally-
 * correct tree `Binary(+, Ternary(...), @body)` but does NOT retain the source's
 * ParenthesizedExpression node (no `preserveParens`). The flat binary printer
 * `emitBinary` (compiler/src/codegen/emit-expr.ts) wraps a binary CHILD operand
 * that binds looser (Bug W / S205) and S210 added the RECEIVER-side guard — but
 * a TERNARY operand fell through `binaryOperandNeedsParens`' `child.kind !==
 * "binary"` bail, so it printed flat:
 *
 *     (a ? b : c) + d   ->   a ? b : c + d
 *     // `+ d` is silently swallowed into the ternary's ELSE branch; when the
 *     // condition is TRUE the `+ d` operand is lost entirely. No diagnostic
 *     // (green compile, `node --check` clean, wrong runtime value).
 *
 * Fix: `binaryOperandNeedsParens` now returns true for ternary / assign / lambda
 * children — the non-binary LOOSE forms that bind looser than every binary
 * operator and never self-bracket. Sibling of S210 receiverNeedsParens (the
 * receiver-position guard) and S205 emitStringFromTree exprPrec wrap (the
 * round-trip twin). `unary` is deliberately NOT wrapped (it binds tighter than
 * the flat binary ops — `a + -b` needs no parens).
 *
 * §1 printer-level: exact emit string + runtime eval value (true-condition case
 *    distinguishes correct from the precedence-wrong flat form).
 * §2 NO spurious parens on already-correct shapes (unary operand, binary
 *    grouping, primaries, paren-group receiver).
 * §3 end-to-end: the flogence repro compiles with parens preserved + valid JS.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import * as acorn from "acorn";
import { emitExpr } from "../../src/codegen/emit-expr.ts";
import { compileScrml } from "../../src/api.js";

// ---------------------------------------------------------------------------
// AST builders (minimal — span unused by the emit path).
// ---------------------------------------------------------------------------
const SPAN = { start: 0, end: 0 };
const num = (raw) => ({ kind: "lit", litType: "number", raw, span: SPAN });
const str = (value) => ({ kind: "lit", litType: "string", raw: JSON.stringify(value), value, span: SPAN });
const id = (name) => ({ kind: "ident", name, span: SPAN });
const bin = (op, left, right) => ({ kind: "binary", op, left, right, span: SPAN });
const tern = (condition, consequent, alternate) => ({ kind: "ternary", condition, consequent, alternate, span: SPAN });
const unary = (op, argument) => ({ kind: "unary", op, argument, prefix: true, span: SPAN });
const member = (object, property) => ({ kind: "member", object, property, optional: false, span: SPAN });
const call = (callee, args = []) => ({ kind: "call", callee, args, optional: false, span: SPAN });
const assign = (op, target, value) => ({ kind: "assign", op, target, value, span: SPAN });
const arrow = (param, body) => ({
  kind: "lambda",
  params: [{ name: param, isLin: false, isRest: false }],
  body: { kind: "expr", value: body },
  fnStyle: "arrow",
  isAsync: false,
  span: SPAN,
});

const CTX = { mode: "client" };
const emit = (node) => emitExpr(node, CTX);

// Bind the four idents used in runtime-eval checks.
const evalWith = (js) => {
  // eslint-disable-next-line no-new-func
  return Function("a", "b", "c", "d", `return (${js});`);
};

// ---------------------------------------------------------------------------
// §1 — printer-level: exact emit + runtime value correctness
// ---------------------------------------------------------------------------
describe("g-paren-ternary-operand §1: a ternary binary-operand keeps its parens", () => {
  test("(a ? b : c) + d — LHS ternary wrapped (the flogence shape)", () => {
    const out = emit(bin("+", tern(id("a"), id("b"), id("c")), id("d")));
    expect(out).toBe("(a ? b : c) + d");
    // a=1 (truthy): correct → b + d = "X"+"Z" = "XZ"; flat (buggy) → just "X".
    expect(evalWith(out)(1, "X", "Y", "Z")).toBe("XZ");
    // Guard the precedence-wrong flat form would have produced.
    expect(evalWith("a ? b : c + d")(1, "X", "Y", "Z")).toBe("X");
  });

  test("d + (a ? b : c) — RHS ternary wrapped", () => {
    const out = emit(bin("+", id("d"), tern(id("a"), id("b"), id("c"))));
    expect(out).toBe("d + (a ? b : c)");
    // d="Z", a=1 → "Z"+"X" = "ZX"; the flat form `d + a ? b : c` would parse the
    // condition as `(d + a)` → wrong.
    expect(evalWith(out)(1, "X", "Y", "Z")).toBe("ZX");
  });

  test("(a ? b : c) * d — LHS ternary wrapped under a higher-precedence op", () => {
    const out = emit(bin("*", tern(id("a"), id("b"), id("c")), id("d")));
    expect(out).toBe("(a ? b : c) * d");
    expect(evalWith(out)(1, 2, 3, 4)).toBe(8); // (1?2:3)*4
  });

  test("nested ternary operand — (a ? b : c ? d : a) + d wrapped once at the top", () => {
    const nested = tern(id("a"), id("b"), tern(id("c"), id("d"), id("a")));
    const out = emit(bin("+", nested, id("d")));
    expect(out).toBe("(a ? b : c ? d : a) + d");
  });

  test("string-concat chain with a ternary head — (a ? b : c) + d + a", () => {
    // Binary(+, Binary(+, Ternary, d), a)
    const out = emit(bin("+", bin("+", tern(id("a"), id("b"), id("c")), id("d")), id("a")));
    expect(out).toBe("(a ? b : c) + d + a");
  });

  test("assignment operand — (a = b) + d wrapped (assignment binds looser)", () => {
    const out = emit(bin("+", assign("=", id("a"), id("b")), id("d")));
    expect(out).toBe("(a = b) + d");
  });

  test("arrow operand — (a => b) + d wrapped (arrow binds looser)", () => {
    // The arrow emits its single param as `(a)`; the operand wrap adds the outer pair.
    const out = emit(bin("+", arrow("a", id("b")), id("d")));
    expect(out).toBe("((a) => b) + d");
  });
});

// ---------------------------------------------------------------------------
// §2 — NO spurious parens for already-correct shapes (no over-wrapping)
// ---------------------------------------------------------------------------
describe("g-paren-ternary-operand §2: correct shapes gain NO spurious parens", () => {
  test("unary operand stays bare: a + -b (unary binds tighter than +)", () => {
    expect(emit(bin("+", id("a"), unary("-", id("b"))))).toBe("a + -b");
  });

  test("left-assoc same-prec grouping stays flat: (a + b) + c -> a + b + c", () => {
    expect(emit(bin("+", bin("+", id("a"), id("b")), id("c")))).toBe("a + b + c");
  });

  test("right same-prec child keeps its needed parens: a + (b + c)", () => {
    expect(emit(bin("+", id("a"), bin("+", id("b"), id("c"))))).toBe("a + (b + c)");
  });

  test("ternary condition is NOT a binary operand — (a && b) ? c : d stays unparenthesized condition", () => {
    // `a && b ? c : d` parses as `(a && b) ? c : d` already (&& binds tighter
    // than ?:), so the condition needs no parens.
    expect(emit(tern(bin("&&", id("a"), id("b")), id("c"), id("d")))).toBe("a && b ? c : d");
  });

  test("method chain on a paren-group receiver: (a ? b : c).toUpperCase() — no double paren", () => {
    // The S210 receiver guard wraps the ternary receiver exactly once.
    const out = emit(call(member(tern(id("a"), id("b"), id("c")), "toUpperCase")));
    expect(out).toBe("(a ? b : c).toUpperCase()");
    expect(out).not.toContain("((");
  });

  test("plain binary with literal operands stays flat: a + b", () => {
    expect(emit(bin("+", id("a"), id("b")))).toBe("a + b");
  });
});

// ---------------------------------------------------------------------------
// §3 — end-to-end: compile the flogence repro, validate with acorn, assert parens
// ---------------------------------------------------------------------------
let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "gparentern-")); });
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

function isValidEsm(js) {
  try { acorn.parse(js, { ecmaVersion: 2022, sourceType: "module" }); return { ok: true, error: null }; }
  catch (e) { return { ok: false, error: e.message }; }
}

// The flogence repro shape: a parenthesized ternary as the LHS of a `+` concat.
// `<br>` collides with the HTML void element, so use `<branch>`.
const E2E_SOURCE = `<program>
\${
  <branch> = "main"
  <body> = "hello"
  <stored> = (@branch.length > 0 ? "[" + @branch + "] " : "") + @body
}
<p>\${@stored}</p>
</program>`;

describe("g-paren-ternary-operand §3: end-to-end compile preserves grouping parens", () => {
  test("(cond ? ... : '') + @body compiles with parens preserved + valid JS + operand retained", () => {
    const result = compileSource("repro.scrml", E2E_SOURCE);
    const client = clientJsFor(result, "repro.scrml");
    expect(typeof client).toBe("string");
    expect(isValidEsm(client).ok).toBe(true);
    // The ternary is parenthesized and the `+ @body` operand survives.
    expect(client).toContain('"[" + _scrml_reactive_get("branch") + "] " : "") + _scrml_reactive_get("body")');
    // Guard against regression to the flat (precedence-wrong) form where `+ body`
    // was swallowed into the ternary's else-branch.
    expect(client).not.toContain('"] " : "" + _scrml_reactive_get("body")');
  });
});
