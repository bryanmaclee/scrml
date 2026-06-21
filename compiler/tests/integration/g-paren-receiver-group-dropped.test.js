/**
 * g-paren-binary-group-dropped-before-method (ss3, S210) — grouping parens
 * dropped before a member/method/index/call receiver → silent precedence
 * miscompile.
 *
 * Adopter (flogence) HIGH silent-correctness bug. Acorn parses
 * `(a + " " + b).toUpperCase()` into the structurally-correct tree
 * `Call(Member(Binary(a + " " + b), toUpperCase))` but does NOT retain the
 * source's ParenthesizedExpression node (no `preserveParens`). The receiver
 * printers (`emitMember` / `emitIndex` / `emitCall` / `emitNew`,
 * compiler/src/codegen/emit-expr.ts) historically concatenated `${obj}.${prop}`
 * with no precedence guard, so the correct tree printed as the precedence-WRONG
 * flat JS:
 *
 *     (a + " " + b).toUpperCase()  ->  a + " " + b.toUpperCase()
 *     // `.toUpperCase()` binds to `b` alone → string + (uppercased b) → garbage
 *
 * No diagnostic was emitted — the wrong value compiled silently (green compile,
 * `node --check` clean). Killed a flogence TF-IDF router (every cosine score
 * collapsed to ~0).
 *
 * Fix: a `receiverNeedsParens` guard (the receiver-position sibling of Bug W's
 * binary-OPERAND guard) wraps a receiver/callee whose top form is a looser-
 * binding operator (binary, ternary, assign, unary, arrow). Primaries (idents,
 * literals, array/object literals, member/call/index chains) gain NO parens.
 *
 * §1 printer-level: exact emit string + runtime eval value.
 * §2 NO spurious parens on already-correct primary receivers.
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
const member = (object, property) => ({ kind: "member", object, property, optional: false, span: SPAN });
const index = (object, idx) => ({ kind: "index", object, index: idx, optional: false, span: SPAN });
const call = (callee, args = []) => ({ kind: "call", callee, args, optional: false, span: SPAN });
const tern = (condition, consequent, alternate) => ({ kind: "ternary", condition, consequent, alternate, span: SPAN });
const unary = (op, argument) => ({ kind: "unary", op, argument, prefix: true, span: SPAN });

const CTX = { mode: "client" };
const emit = (node) => emitExpr(node, CTX);

// ---------------------------------------------------------------------------
// §1 — printer-level: exact emit + runtime value correctness
// ---------------------------------------------------------------------------
describe("g-paren-receiver §1: receiver printers re-insert dropped grouping parens", () => {
  test("(a + b).toUpperCase() keeps its parens (method binds to the whole sum)", () => {
    // (a + " " + b).toUpperCase()
    const sum = bin("+", bin("+", id("a"), str(" ")), id("b"));
    const out = emit(call(member(sum, "toUpperCase")));
    expect(out).toBe('(a + " " + b).toUpperCase()');
    // Runtime: a="hi", b="there" → "HI THERE" ; the flat (buggy) form would be
    // "hi " + "THERE" = "hi THERE".
    expect(eval(out.replace(/\ba\b/, '"hi"').replace(/\bb\b/, '"there"'))).toBe("HI THERE");
  });

  test("(a + b)[c] keeps its parens (index binds to the whole sum)", () => {
    const out = emit(index(bin("+", id("a"), id("b")), id("c")));
    expect(out).toBe("(a + b)[c]");
  });

  test("(a ? b : c)() keeps its parens (call on a ternary result)", () => {
    const out = emit(call(tern(id("a"), id("b"), id("c"))));
    expect(out).toBe("(a ? b : c)()");
  });

  test("(a || b).x keeps its parens (member on a logical result)", () => {
    const out = emit(member(bin("||", id("a"), id("b")), "x"));
    expect(out).toBe("(a || b).x");
  });

  test("(-x).foo keeps its parens (unary receiver — `-x.foo` === `-(x.foo)`)", () => {
    const out = emit(member(unary("-", id("x")), "foo"));
    expect(out).toBe("(-x).foo");
  });

  test("(a + b).m()[c] — paren survives through a chained tail", () => {
    const sum = bin("+", id("a"), id("b"));
    const out = emit(index(call(member(sum, "m")), id("c")));
    expect(out).toBe("(a + b).m()[c]");
  });
});

// ---------------------------------------------------------------------------
// §2 — NO spurious parens for primary receivers (no over-wrapping)
// ---------------------------------------------------------------------------
describe("g-paren-receiver §2: primary receivers gain NO spurious parens", () => {
  test("ident receiver: obj.a stays bare", () => {
    expect(emit(member(id("obj"), "a"))).toBe("obj.a");
  });

  test("member-chain receiver: obj.a.b stays bare", () => {
    expect(emit(member(member(id("obj"), "a"), "b"))).toBe("obj.a.b");
  });

  test("call receiver: f().g stays bare", () => {
    expect(emit(member(call(id("f")), "g"))).toBe("f().g");
  });

  test("index receiver: arr[0].x stays bare", () => {
    expect(emit(member(index(id("arr"), num("0")), "x"))).toBe("arr[0].x");
  });

  test("array-literal receiver: [1].length stays bare (array literal is a primary)", () => {
    expect(emit(member({ kind: "array", elements: [num("1")], span: SPAN }, "length"))).toBe("[1].length");
  });
});

// ---------------------------------------------------------------------------
// §3 — end-to-end: compile the flogence repro, validate with acorn, assert parens
// ---------------------------------------------------------------------------
let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "gparenrx-")); });
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

const E2E_SOURCE = `<program>
\${
  <out>: text = ""
  function f(a, b) { return (a + " " + b).toUpperCase() }
  on mount { @out = f("hi", "there") }
}
<p>\${@out}</p>
</program>`;

describe("g-paren-receiver §3: end-to-end compile preserves grouping parens", () => {
  test("(a + ' ' + b).toUpperCase() compiles with parens preserved + valid JS", () => {
    const result = compileSource("repro.scrml", E2E_SOURCE);
    const client = clientJsFor(result, "repro.scrml");
    expect(typeof client).toBe("string");
    expect(isValidEsm(client).ok).toBe(true);
    // The grouped concat is parenthesized before the method call.
    expect(client).toContain('(a + " " + b).toUpperCase()');
    // Guard against regression to the flat (precedence-wrong) form.
    expect(client).not.toContain('a + " " + b.toUpperCase()');
  });
});
