/**
 * COMMENT-token faithfulness — Unit Tests
 *
 * THE INVARIANT, and it is total over every COMMENT token the compiler emits:
 *
 *     tok.text === source.slice(tok.span.start, tok.span.end)
 *
 * A COMMENT token that does not satisfy this is a token that cannot be trusted
 * by anything that reassembles source text from a token stream — and the
 * compiler has several such reassemblers (`parseParamList`'s `cur`/`defBuf`
 * buffers, `collectBracedBody`'s `raw`). Before this suite existed, a block
 * comment's `.text` was the comment CONTENT plus the CLOSING `*/` with NO
 * opening `/*`, and its span began two characters inside the comment, so
 * `/* the message *​/ msg` reassembled as `the message *​/ msg` — recorded as a
 * PARAMETER NAME, which then failed E-SCOPE-001 on the real parameter.
 *
 * There are exactly THREE production sites that mint a COMMENT token:
 *   1. `tokenizeLogic` -> `readLineComment`      (tokenizer.ts)
 *   2. `tokenizeLogic` -> `readBlockComment`     (tokenizer.ts)
 *   3. `tokenizePassthrough('comment', ...)`     (tokenizer.ts) — a whole
 *      `<!-- ... -->`-style comment BLOCK from the block splitter. This one was
 *      always faithful (it emits `raw` over `[base, base+raw.length)`); it is
 *      asserted here so it stays that way.
 *
 * Coverage:
 *   §1  Round trip at baseOffset 0 — line + block, every shape in the corpus
 *   §2  Round trip at a NON-ZERO baseOffset — the span is an absolute offset
 *   §3  Round trip through the real block-splitter path (all three sites)
 *   §4  The delimiters are present in `.text`
 *   §5  Line/col point AT the opening delimiter, not two columns past it
 *   §6  Unterminated block comment still round-trips
 *   §7  The trailing newline stays inside a line comment's span AND text
 */

import { describe, test, expect } from "bun:test";
import { tokenizeLogic, tokenizePassthrough, tokenizeBlock } from "../../src/tokenizer.js";
import { splitBlocks } from "../../src/block-splitter.js";

/** Every COMMENT token in `toks`, checked against `source` with `base` subtracted. */
function assertRoundTrip(toks, source, base = 0) {
  const comments = toks.filter((t) => t.kind === "COMMENT");
  expect(comments.length).toBeGreaterThan(0);
  for (const tok of comments) {
    const sliced = source.slice(tok.span.start - base, tok.span.end - base);
    expect(sliced).toBe(tok.text);
  }
  return comments;
}

// A corpus that exercises the shapes measured as broken, plus the ordinary ones.
const CORPUS = [
  "// a line comment\nlet x = 1;",
  "let x = 1; // trailing, no newline at EOF",
  "/* a block comment */ let x = 1;",
  "let x = /* inline */ 1;",
  "function greet(/* the message */ msg) { return msg }",
  "function greet(msg = // join\n  1) { return msg }",
  "function greet(msg = /* join */ 1) { return msg }",
  "function greet(msg = 1 /*c*/ 2) { return msg }",
  "function greet(msg: /* t */ string) { return msg }",
  "function greet(a, /* c */ b) { return a }",
  "function greet(lin /*c*/ msg) { return msg }",
  "/* multi\n   line\n   block */ let x = 1;",
  "/**\n * a jsdoc-shaped block\n */\nlet x = 1;",
  "let re = /a\\/b/g; // a regex then a comment",
  '/* a "quoted" thing and a `tick` */ let x = 1;',
  "//\n", // empty line comment
  "/**/", // empty block comment
  "// one\n// two\n/* three */",
];

describe("COMMENT-token faithfulness", () => {
  // ---------------------------------------------------------------------------
  // §1 Round trip at baseOffset 0
  // ---------------------------------------------------------------------------

  test("§1 every COMMENT token round-trips against its source at baseOffset 0", () => {
    for (const src of CORPUS) {
      const toks = tokenizeLogic(src, 0, 1, 1, []);
      const comments = toks.filter((t) => t.kind === "COMMENT");
      expect(comments.length).toBeGreaterThan(0);
      for (const tok of comments) {
        // Reported with the source inline so a failure names the shape.
        expect({ src, text: tok.text }).toEqual({
          src,
          text: src.slice(tok.span.start, tok.span.end),
        });
      }
    }
  });

  // ---------------------------------------------------------------------------
  // §2 Round trip at a NON-ZERO baseOffset
  // ---------------------------------------------------------------------------

  test("§2 spans are ABSOLUTE — the invariant holds under a non-zero baseOffset", () => {
    const BASE = 137;
    for (const src of CORPUS) {
      const toks = tokenizeLogic(src, BASE, 4, 9, []);
      assertRoundTrip(toks, src, BASE);
    }
  });

  // ---------------------------------------------------------------------------
  // §3 Round trip through the real block-splitter path — all three sites
  // ---------------------------------------------------------------------------

  test("§3 tokenizePassthrough('comment') is faithful", () => {
    const raw = "<!-- a whole comment block -->";
    const toks = tokenizePassthrough("comment", raw, 42, 3, 7);
    const comments = assertRoundTrip(toks, raw, 42);
    expect(comments).toHaveLength(1);
    expect(comments[0].text).toBe(raw);
  });

  test("§3 every COMMENT token in a real file round-trips against the FULL source", () => {
    const source = [
      "<!-- a comment block at the top -->",
      "${",
      "  // a line comment in logic",
      "  function greet(/* the message */ msg) { return msg }",
      "  let x = /* inline */ 1;",
      "}",
      "<p>{greet('hi')}</p>",
      "",
    ].join("\n");

    const bs = splitBlocks("comment-faithfulness.scrml", source);
    let seen = 0;
    for (const block of bs.blocks) {
      for (const tok of tokenizeBlock(block, "comment-faithfulness.scrml")) {
        if (tok.kind !== "COMMENT") continue;
        seen++;
        expect(source.slice(tok.span.start, tok.span.end)).toBe(tok.text);
      }
    }
    // The markup comment block plus the three logic comments.
    expect(seen).toBeGreaterThanOrEqual(3);
  });

  // ---------------------------------------------------------------------------
  // §4 The delimiters are present in `.text`
  // ---------------------------------------------------------------------------

  test("§4 a line comment's text STARTS with `//`", () => {
    const toks = tokenizeLogic("// hello\nlet x = 1;", 0, 1, 1, []);
    const c = toks.find((t) => t.kind === "COMMENT");
    expect(c.text).toBe("// hello\n");
  });

  test("§4 a block comment's text is delimiter-to-delimiter", () => {
    const toks = tokenizeLogic("/* hello */ let x = 1;", 0, 1, 1, []);
    const c = toks.find((t) => t.kind === "COMMENT");
    expect(c.text).toBe("/* hello */");
  });

  // ---------------------------------------------------------------------------
  // §5 Line/col point AT the opening delimiter
  // ---------------------------------------------------------------------------

  test("§5 a comment's col points AT the `/`, not two columns past it", () => {
    // `let x = 1; /* c */` — the `/` is the 12th character, i.e. col 12.
    const src = "let x = 1; /* c */";
    const toks = tokenizeLogic(src, 0, 1, 1, []);
    const c = toks.find((t) => t.kind === "COMMENT");
    expect(c.span.col).toBe(12);
    expect(c.span.start).toBe(11);
  });

  test("§5 a line comment at the start of line 2 reports line 2, col 1", () => {
    const src = "let x = 1;\n// second line\n";
    const toks = tokenizeLogic(src, 0, 1, 1, []);
    const c = toks.find((t) => t.kind === "COMMENT");
    expect(c.span.line).toBe(2);
    expect(c.span.col).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // §6 Unterminated block comment
  // ---------------------------------------------------------------------------

  test("§6 an UNTERMINATED block comment still round-trips", () => {
    const src = "let x = 1; /* never closed";
    const toks = tokenizeLogic(src, 0, 1, 1, []);
    const c = toks.find((t) => t.kind === "COMMENT");
    expect(c.text).toBe("/* never closed");
    expect(src.slice(c.span.start, c.span.end)).toBe(c.text);
  });

  test("§6 a bare `/*` at EOF still round-trips", () => {
    const src = "let x = 1; /*";
    const toks = tokenizeLogic(src, 0, 1, 1, []);
    const c = toks.find((t) => t.kind === "COMMENT");
    expect(c.text).toBe("/*");
    expect(src.slice(c.span.start, c.span.end)).toBe(c.text);
  });

  // ---------------------------------------------------------------------------
  // §7 The trailing newline
  // ---------------------------------------------------------------------------

  test("§7 a line comment's trailing newline is inside BOTH the span and the text", () => {
    const src = "// c\nlet x = 1;";
    const toks = tokenizeLogic(src, 0, 1, 1, []);
    const c = toks.find((t) => t.kind === "COMMENT");
    expect(c.text.endsWith("\n")).toBe(true);
    expect(c.span.end).toBe(5); // `// c\n` is 5 chars
    expect(src.slice(c.span.start, c.span.end)).toBe(c.text);
  });

  test("§7 a line comment terminated by EOF has no trailing newline and still round-trips", () => {
    const src = "let x = 1; // c";
    const toks = tokenizeLogic(src, 0, 1, 1, []);
    const c = toks.find((t) => t.kind === "COMMENT");
    expect(c.text).toBe("// c");
    expect(src.slice(c.span.start, c.span.end)).toBe(c.text);
  });
});
