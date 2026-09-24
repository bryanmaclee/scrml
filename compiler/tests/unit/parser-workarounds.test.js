/**
 * parser-workarounds.js (legacy BPP recovery helpers) — unit tests.
 *
 * MOVED from compiler/tests/self-host/bpp.test.js by s430-stage-swap. That file lived under
 * `compiler/tests/self-host/`, which is not in the test gate, but it never tested the self-host
 * module at all: every assertion exercises the JS original
 * (compiler/src/codegen/compat/parser-workarounds.js); its only `bpp.scrml` checks read the scrml
 * SOURCE TEXT for export names. Those three source-text checks were dropped with the move; the
 * behavioural tests below are unchanged. Self-host / bootstrap verification now goes through the
 * hybrid-compiler harness (`bun scripts/hybrid.ts`, bryan S430 P5), not per-module parity files.
 *
 * Retirement: parser-workarounds.js's own header schedules the file (and these tests) for
 * deletion at M6.8.
 */

import { describe, test, expect } from "bun:test";
import {
  isLeakedComment,
  stripLeakedComments,
  splitBareExprStatements,
  splitMergedStatements,
} from "../../src/codegen/compat/parser-workarounds.js";

// ---------------------------------------------------------------------------
// isLeakedComment
// ---------------------------------------------------------------------------

describe("isLeakedComment", () => {
  test("returns false for falsy/non-string input", () => {
    expect(isLeakedComment(null)).toBe(false);
    expect(isLeakedComment(undefined)).toBe(false);
    expect(isLeakedComment("")).toBe(false);
    expect(isLeakedComment(42)).toBe(false);
  });

  test("detects em-dash as leaked comment", () => {
    expect(isLeakedComment("This is a comment — with em-dash")).toBe(true);
  });

  test("detects en-dash as leaked comment", () => {
    expect(isLeakedComment("Some text – with en-dash")).toBe(true);
  });

  test("detects natural language sentence starting with capital", () => {
    expect(isLeakedComment("This is a natural language sentence")).toBe(true);
  });

  test("rejects code-like text with operators/parens", () => {
    expect(isLeakedComment("Foo(bar)")).toBe(false);
    expect(isLeakedComment("Ctx.value = 42")).toBe(false);
    expect(isLeakedComment("Array[0]")).toBe(false);
  });

  test("rejects lowercase-starting text", () => {
    expect(isLeakedComment("foo bar baz")).toBe(false);
  });

  test("rejects code expressions", () => {
    expect(isLeakedComment("ctx.items.map(x => x.id)")).toBe(false);
    expect(isLeakedComment("@count = 0")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// stripLeakedComments
// ---------------------------------------------------------------------------

describe("stripLeakedComments", () => {
  test("returns falsy input as-is", () => {
    expect(stripLeakedComments(null)).toBe(null);
    expect(stripLeakedComments(undefined)).toBe(undefined);
    expect(stripLeakedComments("")).toBe("");
  });

  test("strips pure natural language lines", () => {
    const input = "ctx.update()\nThis is a comment line\nctx.render()";
    const result = stripLeakedComments(input);
    expect(result).toBe("ctx.update()\nctx.render()");
  });

  test("strips trailing comment after code ending with )", () => {
    const input = "saveTodos()  Save the todo items";
    const result = stripLeakedComments(input);
    expect(result).toBe("saveTodos()");
  });

  test("preserves pure code lines", () => {
    const input = "ctx.items.map(x => x.id)\nctx.count = 0";
    expect(stripLeakedComments(input)).toBe(input);
  });
});

// ---------------------------------------------------------------------------
// splitBareExprStatements
// ---------------------------------------------------------------------------

describe("splitBareExprStatements", () => {
  test("returns falsy input wrapped in array", () => {
    expect(splitBareExprStatements(null)).toEqual([null]);
    expect(splitBareExprStatements(undefined)).toEqual([undefined]);
    expect(splitBareExprStatements("")).toEqual([""]);
  });

  test("single expression stays as-is", () => {
    expect(splitBareExprStatements("ctx.update()")).toEqual(["ctx.update()"]);
  });

  test("splits two function calls separated by whitespace", () => {
    const result = splitBareExprStatements("saveTodos() renderList()");
    expect(result).toEqual(["saveTodos()", "renderList()"]);
  });

  test("does not split inside parentheses", () => {
    const result = splitBareExprStatements("foo(bar baz)");
    expect(result).toEqual(["foo(bar baz)"]);
  });

  test("does not split inside braces", () => {
    const result = splitBareExprStatements("{ foo bar }");
    expect(result).toEqual(["{ foo bar }"]);
  });

  test("does not split when next word is a JS operator (of, in)", () => {
    // When nextWord IS in JS_OPERATORS, the split is prevented at that boundary.
    // "for (x of arr)" — inside parens, no split. But at top level "arr of" would
    // not split before "of". Test with a call followed by "of": the "of" boundary is safe.
    const result = splitBareExprStatements("getItems() of");
    // "of" is in JS_OPERATORS so no split before it
    expect(result).toEqual(["getItems() of"]);
  });

  test("does not split after expression keywords (return, await)", () => {
    const result = splitBareExprStatements("return foo");
    expect(result).toEqual(["return foo"]);
  });

  test("does not split after incomplete expressions ending with =", () => {
    const result = splitBareExprStatements("x = foo");
    expect(result).toEqual(["x = foo"]);
  });

  test("handles string literals without splitting inside them", () => {
    const result = splitBareExprStatements('"hello world" callback()');
    expect(result.length).toBe(2);
    expect(result[0]).toBe('"hello world"');
    expect(result[1]).toBe("callback()");
  });

  test("splits match expression followed by function call", () => {
    const input = 'match powerUp { .Mushroom => MarioState.Big .Flower => MarioState.Fire } updateDisplay()';
    const result = splitBareExprStatements(input);
    expect(result.length).toBe(2);
    expect(result[0]).toContain("match powerUp");
    expect(result[0]).toEndWith("}");
    expect(result[1]).toBe("updateDisplay()");
  });

  test("does not split } else in if/else", () => {
    const result = splitBareExprStatements("if (x) { a() } else { b() }");
    expect(result).toEqual(["if (x) { a() } else { b() }"]);
  });

  test("does not split } catch in try/catch", () => {
    const result = splitBareExprStatements("try { a() } catch { b() }");
    expect(result).toEqual(["try { a() } catch { b() }"]);
  });

  test("does not split } finally in try/finally", () => {
    const result = splitBareExprStatements("try { a() } finally { b() }");
    expect(result).toEqual(["try { a() } finally { b() }"]);
  });
});

// ---------------------------------------------------------------------------
// splitMergedStatements
// ---------------------------------------------------------------------------

describe("splitMergedStatements", () => {
  test("single let declaration", () => {
    const result = splitMergedStatements("x", "42", "let");
    expect(result).toContain("let x = 42;");
  });

  test("single const declaration", () => {
    const result = splitMergedStatements("y", '"hello"', "const");
    expect(result).toContain('const y = "hello";');
  });

  test("reactive declaration uses _scrml_reactive_set", () => {
    const result = splitMergedStatements("count", "0", "reactive");
    expect(result).toContain('_scrml_reactive_set("count", 0);');
  });

  test("state-decl also uses _scrml_reactive_set", () => {
    const result = splitMergedStatements("count", "0", "state-decl");
    expect(result).toContain('_scrml_reactive_set("count", 0);');
  });

  test("splits merged reactive declarations (value @name = value)", () => {
    const result = splitMergedStatements("a", "1 @b = 2", "reactive");
    const lines = result.split("\n");
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain('"a"');
    expect(lines[1]).toContain('"b"');
  });

  test("splits merged let declarations (value let name = value)", () => {
    const result = splitMergedStatements("x", "1 let y = 2", "let");
    const lines = result.split("\n");
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain("let x =");
    expect(lines[1]).toContain("let y =");
  });

  test("handles trailing bare expression statements", () => {
    const result = splitMergedStatements("x", '"" saveTodos()', "let");
    const lines = result.split("\n");
    expect(lines.length).toBe(2);
    // First is the let declaration, second is the trailing call
    expect(lines[0]).toContain("let x =");
    expect(lines[1]).toContain("saveTodos()");
  });
});
