/**
 * S465 r3 — `isWholeBraceBlock`: a block's braces are stripped only when the
 * first `{` provably closes at the last `}` (compiler/src/brace-pair.ts). The
 * r3 finding: `{ A }⏎{ B }` passed a starts-with/ends-with test, its "outer"
 * braces were stripped, and the reader closed after A and dropped B.
 */
import { describe, test, expect } from "bun:test";
import { isWholeBraceBlock } from "../../src/brace-pair.ts";

describe("isWholeBraceBlock", () => {
  const cases = [
    ["{ a = 1 }", true],
    ["{ { a = 1 } }", true],
    ["{ a = 1 }\n{ b = 2 }", false],
    ["{ a } { b }", false],
    ["{ { r = \"W\" }\n{ if (!ok) { r = \"R\" } } }", true],
    ["{ s = \"}\" + '{' }", true],
    ["{ s = `${ { a: 1 }.a }}` }", true],
    ["{ s = `a${\"`\"}b` }", true],
    ["{ s = x.replace(/'/g, \"y\") }", true],
    ["{ s = x.replace(/[}]/g, \"y\") }", true],
    ["{ n = a / b / c }", true],
    ["{ // }\n a = 1 }", true],
    ["{ /* } */ a = 1 }", true],
    ["{ a = \"unterminated }", false],
    ["{ a = 1", false],
    ["a = 1", false],
    ["", false],
  ];
  for (const [text, want] of cases) {
    test(`${JSON.stringify(text)} → ${want}`, () => {
      expect(isWholeBraceBlock(text)).toBe(want);
    });
  }
});
