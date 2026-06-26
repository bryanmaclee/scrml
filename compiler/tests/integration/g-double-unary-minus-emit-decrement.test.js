/**
 * B3 (g-double-unary-minus-emit-decrement) — a stacked prefix unary minus/plus
 * `Unary(-, Unary(-, a))` MUST NOT serialize as the fused `--a` (the `--`
 * pre-DECREMENT token), and `Unary(+, Unary(+, a))` MUST NOT fuse into `++a`.
 *
 * THE BUG: both serializers emitted `${op}${arg}`. When the operand serialized
 * starting with the same sign char, the two `-` (or `+`) fused into the UPDATE
 * operator: `-(-a)` -> `--a`, `+(+a)` -> `++a`. That is (a) the WRONG VALUE
 * (pre-decrement is `a-1`, double-negation is `a`), (b) a STRAY MUTATION of the
 * lvalue, and (c) a hard SyntaxError when the operand is a non-lvalue
 * (`- -5` is valid `=== 5`; `--5` is a SyntaxError).
 *
 * THE FIX (BOTH serializers): insert ONE space when a prefix `-`/`+` operand
 * serializes starting with the same sign char -> `- -a` / `+ +a`. Minimal blast
 * radius — a space is valid JS and shifts no parens (S215). EXCLUDED: the
 * `++`/`--` update operators (already two-char ops), and `!!a` / `~~a` (valid
 * JS — there is no `!!`/`~~` token — they correctly stay fused). Mixed signs
 * (`-+a` / `+-a`) never fuse and are left untouched.
 *
 * §1  emit-expr.ts printer (AST path).
 * §2  emitStringFromTree round-trip twin (source-text serializer).
 * §3  end-to-end — `- -@a` through a decl RHS (emitExpr) AND a markup-interp
 *     (`${...}`, which routes through emitStringFromTree): `- -` present, no
 *     fused `--`, acorn-clean.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import * as acorn from "acorn";
import { emitExpr } from "../../src/codegen/emit-expr.ts";
import { emitStringFromTree } from "../../src/expression-parser.ts";
import { compileScrml } from "../../src/api.js";

const SPAN = { start: 0, end: 0 };
const num = (raw) => ({ kind: "lit", litType: "number", raw, span: SPAN });
const id = (name) => ({ kind: "ident", name, span: SPAN });
const un = (op, argument, prefix = true) => ({ kind: "unary", op, argument, prefix, span: SPAN });
const CTX = { mode: "client" };
const emit = (node) => emitExpr(node, CTX);
const isValidJs = (js) => {
  try { acorn.parse(`let __r = ${js};`, { ecmaVersion: 2022 }); return true; }
  catch { return false; }
};

// ---------------------------------------------------------------------------
// §1 — emit-expr.ts printer (AST path)
// ---------------------------------------------------------------------------
describe("g-double-unary §1: emit-expr.ts space-splits same-sign stacked unaries", () => {
  test("Unary(-, Unary(-, a)) -> `- -a` (NOT `--a`), valid, === a (a=3)", () => {
    const out = emit(un("-", un("-", id("a"))));
    expect(out).toBe("- -a");
    expect(out).not.toContain("--");
    expect(isValidJs(out)).toBe(true);
    expect(eval("- -3")).toBe(3); // double negation preserves the value
  });

  test("Unary(+, Unary(+, a)) -> `+ +a` (NOT `++a`), valid, === a (a=4)", () => {
    const out = emit(un("+", un("+", id("a"))));
    expect(out).toBe("+ +a");
    expect(out).not.toContain("++");
    expect(isValidJs(out)).toBe(true);
    expect(eval("+ +4")).toBe(4);
  });

  test("numeric literal operand: Unary(-, Unary(-, 5)) -> `- -5` (bare `--5` is a SyntaxError)", () => {
    const out = emit(un("-", un("-", num("5"))));
    expect(out).toBe("- -5");
    expect(isValidJs(out)).toBe(true);
    expect(isValidJs("--5")).toBe(false);
    expect(eval("- -5")).toBe(5);
  });

  test("reactive operand: Unary(-, Unary(-, @a)) -> `- -_scrml_reactive_get(\"a\")`", () => {
    const out = emit(un("-", un("-", id("@a"))));
    expect(out).toBe('- -_scrml_reactive_get("a")');
    expect(out).not.toContain("--");
    expect(isValidJs(out)).toBe(true);
  });

  test("NO-CHANGE: `!!a` and `~~a` stay fused (valid JS, no `!!`/`~~` token)", () => {
    expect(emit(un("!", un("!", id("a"))))).toBe("!!a");
    expect(emit(un("~", un("~", id("a"))))).toBe("~~a");
    expect(isValidJs("!!a")).toBe(true);
    expect(isValidJs("~~a")).toBe(true);
  });

  test("NO-CHANGE: mixed signs `-+a` / `+-a` never fuse (no space inserted)", () => {
    expect(emit(un("-", un("+", id("a"))))).toBe("-+a");
    expect(emit(un("+", un("-", id("a"))))).toBe("+-a");
  });

  test("NO-CHANGE: single `-a` is untouched", () => {
    expect(emit(un("-", id("a")))).toBe("-a");
  });

  test("NO-CHANGE: prefix `-` over a postfix update `a--` stays `-a--`", () => {
    expect(emit(un("-", un("--", id("a"), false)))).toBe("-a--");
  });
});

// ---------------------------------------------------------------------------
// §2 — emitStringFromTree round-trip twin
// ---------------------------------------------------------------------------
describe("g-double-unary §2: emitStringFromTree space-splits the same-sign twin", () => {
  test("Unary(-, Unary(-, @a)) reconstructs as `- -@a` (NOT `--@a`)", () => {
    const out = emitStringFromTree(un("-", un("-", id("@a"))));
    expect(out).toBe("- -@a");
    expect(out).not.toContain("--");
  });

  test("Unary(+, Unary(+, @a)) reconstructs as `+ +@a` (NOT `++@a`)", () => {
    const out = emitStringFromTree(un("+", un("+", id("@a"))));
    expect(out).toBe("+ +@a");
    expect(out).not.toContain("++");
  });

  test("NO-CHANGE: `!!@a` / `~~@a` stay fused; mixed `-+@a` untouched", () => {
    expect(emitStringFromTree(un("!", un("!", id("@a"))))).toBe("!!@a");
    expect(emitStringFromTree(un("~", un("~", id("@a"))))).toBe("~~@a");
    expect(emitStringFromTree(un("-", un("+", id("@a"))))).toBe("-+@a");
  });
});

// ---------------------------------------------------------------------------
// §3 — end-to-end compile of `- -@a` through BOTH paths
// ---------------------------------------------------------------------------
let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "gdoubleunary-")); });
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
  try { acorn.parse(js, { ecmaVersion: 2025, sourceType: "module" }); return true; }
  catch { return false; }
};

describe("g-double-unary §3: end-to-end `- -@a` emits split unaries, acorn-clean", () => {
  test("decl RHS `<r> = - -@a` (emitExpr path) — `- -` present, no fused `--`, valid", () => {
    const src = `<program>\n\n<a> = 3\n<r> = - -@a\n\n<div>\${@r}</div>\n\n</program>`;
    const result = compileSource("decl.scrml", src);
    const client = clientJsFor(result, "decl.scrml");
    expect(typeof client).toBe("string");
    expect(clientValid(client)).toBe(true);
    expect(client).toContain('- -_scrml_reactive_get("a")');
    expect(client).not.toMatch(/--_scrml_reactive_get\("a"\)/);
  });

  test("markup-interp `${- -@a}` (emitStringFromTree path) — split, valid, no fused `--`", () => {
    const src = `<program>\n\n<a> = 3\n\n<div>\${- -@a}</div>\n\n</program>`;
    const result = compileSource("interp.scrml", src);
    const client = clientJsFor(result, "interp.scrml");
    expect(typeof client).toBe("string");
    expect(clientValid(client)).toBe(true);
    expect(client).toContain('- -_scrml_reactive_get("a")');
    expect(client).not.toMatch(/--_scrml_reactive_get\("a"\)/);
  });

  test("parenthesized `<r> = -(-@a)` lowers to the same split form", () => {
    const src = `<program>\n\n<a> = 3\n<r> = -(-@a)\n\n<div>\${@r}</div>\n\n</program>`;
    const result = compileSource("paren.scrml", src);
    const client = clientJsFor(result, "paren.scrml");
    expect(typeof client).toBe("string");
    expect(clientValid(client)).toBe(true);
    expect(client).toContain('- -_scrml_reactive_get("a")');
    expect(client).not.toMatch(/--_scrml_reactive_get\("a"\)/);
  });
});
