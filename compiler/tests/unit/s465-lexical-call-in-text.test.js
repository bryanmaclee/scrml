/**
 * S465 r5 — `lexicalCallInText`, the fail-closed server text guard: could this text
 * hold a call? Nothing is skipped (no string / template / comment / regex reading), so
 * no mis-read literal can hide a call. r5 holes in the earlier scanner, pinned here:
 * a callee named `of` (a contextual word, not reserved) and a `/` after a postfix
 * `++` / `--` read as a regex start.
 */
import { describe, test, expect } from "bun:test";
import { lexicalCallInText, firstCallInText } from "../../src/brace-pair.ts";

describe("lexicalCallInText — calls are found", () => {
  const CALLS = [
    ["of(x)", "of"],
    ["[of(pass, h), .Found(name: \"c\")]", "of"],
    ["i++ / check(a, b) / 2", "check"],
    ["i-- / 1 + (check(a, b) ? 1 : 0) / 1", "check"],
    ["async (x) => x", "async"],
    ["let(x)", "let"],
    ["get(x)", "get"],
    ["row.fn(x)", "row.fn"],
    ["f?.(x)", "f"],
    ["f(a)(b)", "f"],
    ["xs[0](a)", "xs"],
    ["tag`x${y}`", "tag"],
    ["\"text (\" + f(x)", null],
    ["/re(/.test(s)", null],
    ["obj.Found(x)", "obj.Found"],
    ["\"s\".Found(x)", null],
    ["a ...Found(x)", "Found"],
    ["`a`(x)", null],
    ["x.if(y)", "x.if"],
    ["new a.B(x)", "a.B"],
    // An optional member call and a member of a closed object literal are calls, even
    // when the name is capitalised like a variant constructor.
    ["x?.Check(a)", "Check"],
    ["{ A: f }.A(x)", "A"],
    ["[{ A: f }][0].A(x)", "A"],
  ];
  for (const [text, callee] of CALLS) {
    test(`${text}`, () => {
      const got = lexicalCallInText(text);
      expect(got).not.toBeNull();
      if (callee !== null) expect(got).toContain(callee);
    });
  }
  test("the r5 holes in the earlier scanner (it answered null)", () => {
    expect(firstCallInText("[of(pass, h), .Found(name: \"c\")]")).toBeNull();
    expect(firstCallInText("[i++ / 1 + (check(a, b) ? 1 : 0) / 1]")).toBeNull();
    expect(lexicalCallInText("[of(pass, h), .Found(name: \"c\")]")).toBe("of");
    expect(lexicalCallInText("[i++ / 1 + (check(a, b) ? 1 : 0) / 1]")).toBe("check");
  });
  test("a `(` inside a string counts (fail closed)", () => {
    expect(lexicalCallInText("\"see note (1)\"")).not.toBeNull();
  });
});

describe("lexicalCallInText — the grammar's own non-call parens", () => {
  const NOT_CALLS = [
    "if (x) { y = 1 }",
    "for (const k of xs) { n = n + 1 }",
    "while (i < 3) { i = i + 1 }",
    "return (a + b)",
    "typeof (x)",
    "a in (b)",
    "x instanceof (Y)",
    "function (q) { return q }",
    "function g(q) { return q }",
    "function* g(q) { yield q }",
    "new Date",
    "new Error(\"x\")",
    ".Found(name: \"carol\")",
    "return .Found(name: \"carol\")",
    "[1, .Found(name: \"c\")]",
    "(a, b) => a + b",
    "x => (x + 1)",
    "a + (b * c)",
    "`plain ${x} .`",
    "",
  ];
  for (const text of NOT_CALLS) {
    test(JSON.stringify(text), () => expect(lexicalCallInText(text)).toBeNull());
  }
});
