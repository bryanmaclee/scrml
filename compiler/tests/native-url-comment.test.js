// native-url-comment.test.js — Charter B parity for the block-splitter
// url-comment fix.
//
// The native parser's markup trampoline (parse-markup.js emitComment) treated a
// `//` in markup prose (`Visit http://x`) as a `//` Line comment, consuming to
// end-of-line and swallowing the `</p>` closer (spurious E-MARKUP-002 /
// E-CTX-001). The fix adds a pure `urlSlashesAt(cursor)` calculation
// (block-context.js) — TRUE when the `//` is URL DATA (a scheme separator `://`
// or inside a CSS `url(...)` token) — that emitComment consults for the Line
// form. SPEC §27.1 keeps `//` a universal comment; the carve-out is narrow, so a
// genuine `// comment` is still a Comment block.

import { describe, test, expect } from "bun:test";

import { urlSlashesAt } from "../native-parser/block-context.js";
import { parseMarkup } from "../native-parser/parse-markup.js";
import { makeCursor, advance } from "../native-parser/cursor.js";

// A cursor positioned AT the `//` at byte offset `idx` in `src`.
function cursorAt(src, idx) {
  const c = makeCursor(src);
  advance(c, idx);
  return c;
}

// The offset of the first `//` in `src`.
function firstSlashes(src) {
  return src.indexOf("//");
}

describe("urlSlashesAt — the pure URL-vs-comment discriminator", () => {
  test("`http://` scheme slashes are URL content (preceded by `:`)", () => {
    const src = "Visit http://example.com now";
    expect(urlSlashesAt(cursorAt(src, firstSlashes(src)))).toBe(true);
  });

  test("`https://` scheme slashes are URL content", () => {
    const src = "See https://example.com/x";
    expect(urlSlashesAt(cursorAt(src, firstSlashes(src)))).toBe(true);
  });

  test("protocol-relative `url(//cdn…)` is URL content (inside url())", () => {
    const src = "background: url(//cdn.example.com/x.png)";
    expect(urlSlashesAt(cursorAt(src, firstSlashes(src)))).toBe(true);
  });

  test("`url(http://…)` is URL content (both signals)", () => {
    const src = "background: url(http://example.com/a.png)";
    expect(urlSlashesAt(cursorAt(src, firstSlashes(src)))).toBe(true);
  });

  test("a `//` after whitespace is NOT URL content (a real comment)", () => {
    const src = "red; // note";
    expect(urlSlashesAt(cursorAt(src, firstSlashes(src)))).toBe(false);
  });

  test("a `//` at line start is NOT URL content (a real comment)", () => {
    const src = "// a comment";
    expect(urlSlashesAt(cursorAt(src, 0))).toBe(false);
  });

  test("`curl(//x)` is NOT a url() token (identifier-boundary rejects it)", () => {
    // `curl(` — the char before `url(` is `c` (an identifier char), so the
    // url() detection does not fire; with no `:` before `//` this is a comment.
    const src = "curl(//x)";
    expect(urlSlashesAt(cursorAt(src, firstSlashes(src)))).toBe(false);
  });
});

describe("parseMarkup — a prose URL is not consumed as a comment", () => {
  test("markup prose with http:// yields one Markup block (no Comment)", () => {
    const blocks = parseMarkup("<p>Visit http://example.com now</p>");
    const kinds = blocks.map(b => b.kind);
    expect(kinds).not.toContain("Comment");
    const markup = blocks.filter(b => b.kind === "Markup");
    expect(markup.length).toBe(1);
    // The whole element (incl. the URL) is spanned — the `//` did not truncate.
    expect(markup[0].span.end).toBe("<p>Visit http://example.com now</p>".length);
  });

  test("a genuine // comment in markup STILL emits a Comment block (§27)", () => {
    const blocks = parseMarkup("<p>hi</p>\n// a comment\n<p>bye</p>");
    expect(blocks.map(b => b.kind)).toContain("Comment");
  });
});
