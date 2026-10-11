/**
 * stdlib-md — the scrml:md reader (SPEC §67, change-id s462-md-phase1).
 *
 * The reader is stdlib/md/index.scrml; these tests exercise the runtime shim, which is impl#1's
 * library-mode compile of that file (scripts/gen-md-shim.ts — the shim is GENERATED, so this is
 * the scrml reader running, not a hand-written mirror; stdlib-md-shim.test.js pins that).
 *
 *   §A  blocks        paragraphs, headings, rules, fences, quotes, lists, tables
 *   §B  inlines       emphasis (CommonMark 6.2 rules within the subset), strong, del, code spans,
 *                     escapes, breaks, links, images, brackets
 *   §C  OUT           every dropped construct and every second spelling reads as TEXT and reports
 *                     its W-MD code (ruling S462 F3 + Q21: what you type is what is shown)
 *   §D  hostile       nesting limits, huge input in bounded time, HTML / entity / URL look-alikes
 *                     stay text, fuzzed input stays inside the closed node set
 *   §E  diagnostics   positions (offset / line / col), messages name the canonical spelling
 *   §F  dedent        the §67.2 rule for a static body
 *   §G  headingSlugs  static heading ids
 *
 * Expected structure is written as HTML text through compiler/tests/helpers/md-render.js — a test
 * view of the tree that escapes all text, so `&lt;b&gt;` in an expectation proves the reader made
 * the TEXT `<b>`, never an element.
 */

import { describe, test, expect } from "bun:test";
import * as md from "../../runtime/stdlib/md.js";
import { html, codes } from "../helpers/md-render.js";

const { parse, dedent, headingSlugs } = md;
const h = (src) => html(parse(src));

// ---------------------------------------------------------------------------
// §A — blocks
// ---------------------------------------------------------------------------

describe("scrml:md §A blocks — paragraphs and headings", () => {
  test("A1: lines join into one paragraph with soft breaks; a blank line separates paragraphs", () => {
    expect(h("one\ntwo\n\nthree")).toBe("<p>one\ntwo</p><p>three</p>");
  });
  test("A2: leading whitespace of a paragraph line and trailing whitespace of the last line are not content", () => {
    expect(h("  one\n   two   ")).toBe("<p>one\ntwo</p>");
  });
  test("A3: ATX headings 1–6; seven #s and #word are text", () => {
    expect(h("# a\n## b\n### c\n#### d\n##### e\n###### f")).toBe("<h1>a</h1><h2>b</h2><h3>c</h3><h4>d</h4><h5>e</h5><h6>f</h6>");
    expect(h("####### seven")).toBe("<p>####### seven</p>");
    expect(h("#hashtag")).toBe("<p>#hashtag</p>");
  });
  test("A4: a heading's content is inline-parsed; an empty heading is allowed", () => {
    expect(h("## Hello *there*")).toBe("<h2>Hello <em>there</em></h2>");
    expect(h("#")).toBe("<h1></h1>");
  });
  test("A5: a heading interrupts a paragraph", () => {
    expect(h("para\n# Head")).toBe("<p>para</p><h1>Head</h1>");
  });
  test("A6: `---` is a thematic break (3 or more `-`, nothing else)", () => {
    expect(h("---")).toBe("<hr>");
    expect(h("------")).toBe("<hr>");
    expect(h("a\n\n---\n\nb")).toBe("<p>a</p><hr><p>b</p>");
    expect(h("--")).toBe("<p>--</p>");
  });
});

describe("scrml:md §A blocks — fenced code", () => {
  test("A7: a backtick fence keeps its content verbatim and its language word", () => {
    expect(h("```js\nlet x = 1 < 2\n**not bold**\n```")).toBe('<pre><code class="language-js">let x = 1 &lt; 2\n**not bold**\n</code></pre>');
  });
  test("A8: only a [A-Za-z0-9_+-] first word becomes the language; anything else is dropped", () => {
    expect(h("```c++ extra words\nx\n```")).toBe('<pre><code class="language-c++">x\n</code></pre>');
    expect(h('```"><script>\nx\n```')).toBe("<pre><code>x\n</code></pre>");
    expect(h("```\nx\n```")).toBe("<pre><code>x\n</code></pre>");
  });
  test("A9: the closing fence is at least as long as the opener; a shorter one is content", () => {
    expect(h("````\n```\nx\n````")).toBe("<pre><code>```\nx\n</code></pre>");
  });
  test("A10: an unclosed fence runs to the end of its container", () => {
    expect(h("```\nx\ny")).toBe("<pre><code>x\ny\n</code></pre>");
    expect(h("> ```\n> x\n\nafter")).toBe("<blockquote><pre><code>x\n</code></pre></blockquote><p>after</p>");
  });
  test("A11: an info string holding a backtick is not a fence (CommonMark 4.5)", () => {
    expect(h("```a`b")).toBe("<p>```a`b</p>");
  });
  test("A12: an indented fence strips up to its own indentation from content lines", () => {
    expect(h("  ```\n  a\n    b\n```")).toBe("<pre><code>a\n  b\n</code></pre>");
  });
  test("A13: an empty fence has empty content; blank lines inside are kept", () => {
    expect(h("```\n```")).toBe("<pre><code></code></pre>");
    expect(h("```\na\n\nb\n```")).toBe("<pre><code>a\n\nb\n</code></pre>");
  });
});

describe("scrml:md §A blocks — quotes", () => {
  test("A14: `>` lines form a quote; the space after `>` is optional", () => {
    expect(h("> a\n>b")).toBe("<blockquote><p>a\nb</p></blockquote>");
  });
  test("A15: quotes nest and hold any block", () => {
    expect(h("> # T\n> > inner\n> - x")).toBe("<blockquote><h1>T</h1><blockquote><p>inner</p></blockquote><ul><li>x</li></ul></blockquote>");
  });
  test("A16: a blank line ends a quote", () => {
    expect(h("> a\n\n> b")).toBe("<blockquote><p>a</p></blockquote><blockquote><p>b</p></blockquote>");
  });
});

describe("scrml:md §A blocks — lists", () => {
  test("A17: `- ` bullets make a tight list", () => {
    expect(h("- a\n- b")).toBe("<ul><li>a</li><li>b</li></ul>");
  });
  test("A18: `N. ` items make an ordered list that starts at the first number", () => {
    expect(h("1. a\n2. b")).toBe("<ol><li>a</li><li>b</li></ol>");
    expect(h("3. a\n4. b")).toBe('<ol start="3"><li>a</li><li>b</li></ol>');
    expect(h("007. a")).toBe('<ol start="7"><li>a</li></ol>');
  });
  test("A19: a blank line between items, or between two blocks of one item, makes the list loose", () => {
    expect(h("- a\n\n- b")).toBe("<ul><li><p>a</p></li><li><p>b</p></li></ul>");
    expect(h("- a\n\n  b\n- c")).toBe("<ul><li><p>a</p><p>b</p></li><li><p>c</p></li></ul>");
  });
  test("A20: a nested list is indented to the item's content column", () => {
    expect(h("- a\n  - b\n    - c")).toBe("<ul><li>a<ul><li>b<ul><li>c</li></ul></li></ul></li></ul>");
    expect(h("1. a\n   - b")).toBe("<ol><li>a<ul><li>b</li></ul></li></ol>");
  });
  test("A21: an item holds a fence, a quote, a table", () => {
    expect(h("1. a\n   ```\n   code\n   ```\n2. b")).toBe("<ol><li>a<pre><code>code\n</code></pre></li><li>b</li></ol>");
    expect(h("- > q")).toBe("<ul><li><blockquote><p>q</p></blockquote></li></ul>");
    expect(h("- | a |\n  | - |")).toBe("<ul><li><table><thead><tr><th>a</th></tr></thead></table></li></ul>");
  });
  test("A22: switching between bullet and ordered starts a new list", () => {
    expect(h("- a\n1. b")).toBe("<ul><li>a</li></ul><ol><li>b</li></ol>");
  });
  test("A23: an item may start empty; its content follows indented", () => {
    expect(h("-\n  foo")).toBe("<ul><li>foo</li></ul>");
  });
  test("A24: a bullet interrupts a paragraph; an ordered item only when it starts at 1; an empty item never", () => {
    expect(h("para\n- x")).toBe("<p>para</p><ul><li>x</li></ul>");
    expect(h("para\n1. x")).toBe("<p>para</p><ol><li>x</li></ol>");
    expect(h("para\n2. x")).toBe("<p>para\n2. x</p>");
    expect(h("para\n-")).toBe("<p>para\n-</p>");
  });
  test("A25: list item content keeps its relative indentation", () => {
    expect(h("- a\n\n      deep")).toBe("<ul><li><p>a</p><p>deep</p></li></ul>");
  });
});

describe("scrml:md §A blocks — tables", () => {
  test("A26: a header row, a delimiter row, body rows; alignment from colons", () => {
    expect(h("| a | b | c | d |\n| --- | :-- | :-: | --: |\n| 1 | 2 | 3 | 4 |")).toBe(
      "<table><thead><tr><th>a</th>" +
        '<th style="text-align:left">b</th><th style="text-align:center">c</th><th style="text-align:right">d</th></tr></thead>' +
        "<tbody><tr><td>1</td>" +
        '<td style="text-align:left">2</td><td style="text-align:center">3</td><td style="text-align:right">4</td></tr></tbody></table>',
    );
  });
  test("A27: a row is padded with empty cells or cut to the header's width", () => {
    expect(h("| a | b |\n| - | - |\n| x |\n| 1 | 2 | 3 |")).toBe(
      "<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>x</td><td></td></tr><tr><td>1</td><td>2</td></tr></tbody></table>",
    );
  });
  test("A28: cells are inline-parsed; `\\|` is a literal pipe, also inside code", () => {
    expect(h("| *a* \\| b | `c\\|d` |\n| - | - |")).toBe("<table><thead><tr><th><em>a</em> | b</th><th><code>c|d</code></th></tr></thead></table>");
  });
  test("A29: a header and delimiter with different cell counts is not a table", () => {
    expect(h("| a | b |\n| - |")).toBe("<p>| a | b |\n| - |</p>");
  });
  test("A30: a table interrupts a paragraph and ends at a blank line or a non-row", () => {
    expect(h("x\n| a |\n| - |\n| 1 |\nafter")).toBe("<p>x</p><table><thead><tr><th>a</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table><p>after</p>");
  });
});

// ---------------------------------------------------------------------------
// §B — inlines
// ---------------------------------------------------------------------------

describe("scrml:md §B inlines — emphasis, strong, del (CommonMark 6.2 within the subset)", () => {
  const cases = [
    ["*em*", "<p><em>em</em></p>"],
    ["**strong**", "<p><strong>strong</strong></p>"],
    ["***both***", "<p><em><strong>both</strong></em></p>"],
    ["*foo**bar**baz*", "<p><em>foo<strong>bar</strong>baz</em></p>"],
    ["**foo*", "<p>*<em>foo</em></p>"],
    ["*foo**", "<p><em>foo</em>*</p>"],
    ["foo*bar*", "<p>foo<em>bar</em></p>"],
    ["a * b * c", "<p>a * b * c</p>"],
    ["* a *", "<p>* a *</p>"],
    ["*(*foo*)*", "<p><em>(<em>foo</em>)</em></p>"],
    ['**foo "*bar*" foo**', "<p><strong>foo &quot;<em>bar</em>&quot; foo</strong></p>"],
    ["*foo *bar**", "<p><em>foo <em>bar</em></em></p>"],
    ["**foo**bar", "<p><strong>foo</strong>bar</p>"],
    ["*$*alpha.", "<p>*$*alpha.</p>"],
    ["~~del~~", "<p><del>del</del></p>"],
    ["~~a **b** c~~", "<p><del>a <strong>b</strong> c</del></p>"],
    ["~~~x~~~", "<p>~~~x~~~</p>"],
    ["~~unclosed", "<p>~~unclosed</p>"],
    ["\\*not\\*", "<p>*not*</p>"],
    ["snake_case_word", "<p>snake_case_word</p>"],
  ];
  for (const [src, want] of cases) {
    test(`B: ${JSON.stringify(src)}`, () => {
      expect(h(src)).toBe(want);
    });
  }
});

describe("scrml:md §B inlines — code spans", () => {
  test("B1: a code span ends at the next run of the same length; its content is literal", () => {
    expect(h("`a *b* <c>`")).toBe("<p><code>a *b* &lt;c&gt;</code></p>");
    expect(h("`` a`b ``")).toBe("<p><code>a`b</code></p>");
  });
  test("B2: one space each side is stripped only when both sides have one and it is not all spaces", () => {
    expect(h("` a `")).toBe("<p><code>a</code></p>");
    expect(h("`  `")).toBe("<p><code>  </code></p>");
    expect(h("` a`")).toBe("<p><code> a</code></p>");
  });
  test("B3: line ends inside a code span become spaces", () => {
    expect(h("`a\nb`")).toBe("<p><code>a b</code></p>");
  });
  test("B4: backslash escapes do not apply inside a code span; an escaped backtick opens nothing", () => {
    expect(h("`foo\\`bar`")).toBe("<p><code>foo\\</code>bar`</p>");
    expect(h("\\`not code`")).toBe("<p>`not code`</p>");
  });
  test("B5: an unmatched run is literal backticks", () => {
    expect(h("```a``")).toBe("<p>```a``</p>");
  });
  test("B6: a code span binds tighter than emphasis and links", () => {
    expect(h("*a `*` b*")).toBe("<p><em>a <code>*</code> b</em></p>");
    expect(h("[a `]` b](/u)")).toBe('<p><a href="/u">a <code>]</code> b</a></p>');
  });
});

describe("scrml:md §B inlines — escapes and breaks", () => {
  test("B7: a backslash escapes ASCII punctuation; before anything else it is literal", () => {
    expect(h("\\# \\[x\\] \\\\ \\a")).toBe("<p># [x] \\ \\a</p>");
  });
  test("B8: a trailing backslash is a hard break; at the end of a paragraph it is literal", () => {
    expect(h("a\\\nb")).toBe("<p>a<br>b</p>");
    expect(h("a\\")).toBe("<p>a\\</p>");
  });
  test("B9: a line end is a soft break", () => {
    expect(h("a\nb")).toBe("<p>a\nb</p>");
  });
});

describe("scrml:md §B inlines — links and images", () => {
  test("B10: an inline link with and without a double-quoted title", () => {
    expect(h("[a](/u)")).toBe('<p><a href="/u">a</a></p>');
    expect(h('[a](/u "T")')).toBe('<p><a href="/u" title="T">a</a></p>');
  });
  test("B11: the destination may hold balanced parentheses and escapes; it may be empty", () => {
    expect(h("[a](/u(1)(2))")).toBe('<p><a href="/u(1)(2)">a</a></p>');
    expect(h("[a](/u\\)x)")).toBe('<p><a href="/u)x">a</a></p>');
    expect(h("[a]()")).toBe('<p><a href="">a</a></p>');
  });
  test("B12: link text is inline content; brackets nest when balanced", () => {
    expect(h("[*a* `b`](/u)")).toBe('<p><a href="/u"><em>a</em> <code>b</code></a></p>');
    expect(h("[link [foo [bar]]](/uri)")).toBe('<p><a href="/uri">link [foo [bar]]</a></p>');
  });
  test("B13: links do not contain links (the inner one wins)", () => {
    expect(h("[foo [bar](/a)](/b)")).toBe('<p>[foo <a href="/a">bar</a>](/b)</p>');
  });
  test("B14: emphasis does not cross a link boundary", () => {
    expect(h("*[foo*](/uri)")).toBe('<p>*<a href="/uri">foo*</a></p>');
  });
  test("B15: an image's alt is the plain text of its content; an image may sit in a link", () => {
    expect(h("![a *b* [c](/x)](/i.png)")).toBe('<p><img src="/i.png" alt="a b c"></p>');
    expect(h('[![i](a.png "t")](/u)')).toBe('<p><a href="/u"><img src="a.png" alt="i" title="t"></a></p>');
  });
  test("B16: brackets with no inline destination are text (there are no reference links)", () => {
    expect(h("[a] and [b]")).toBe("<p>[a] and [b]</p>");
    expect(h("[a] (/u)")).toBe("<p>[a] (/u)</p>");
    expect(h("! [a](/u)")).toBe('<p>! <a href="/u">a</a></p>');
  });
  test("B17: a destination with a space is not a link", () => {
    expect(h("[a](/u v)")).toBe("<p>[a](/u v)</p>");
  });
  test("B18: the destination is kept exactly as written (the reader never judges or decodes a URL)", () => {
    const d = parse("[x](javascript:alert(1)) [y](jav&#97;script:z)");
    const links = d.blocks[0].data.children.filter((n) => n.variant === "Link");
    expect(links.map((l) => l.data.dest)).toEqual([[md.MdSeg.Lit("javascript:alert(1)")], [md.MdSeg.Lit("jav&#97;script:z")]]);
  });
});

// ---------------------------------------------------------------------------
// §C — OUT constructs and second spellings: text + the W-MD code
// ---------------------------------------------------------------------------

describe("scrml:md §C OUT — each dropped construct is text and reports its code", () => {
  const cases = [
    // [source, rendered, codes]
    ["a <b>bold</b> c", "<p>a &lt;b&gt;bold&lt;/b&gt; c</p>", ["W-MD-RAW-HTML", "W-MD-RAW-HTML"]],
    ['<div onclick="x()">hi</div>', "<p>&lt;div onclick=&quot;x()&quot;&gt;hi&lt;/div&gt;</p>", ["W-MD-RAW-HTML", "W-MD-RAW-HTML"]],
    ["<!-- note -->", "<p>&lt;!-- note --&gt;</p>", ["W-MD-RAW-HTML"]],
    ["&copy; &#169; &#xA9;", "<p>&amp;copy; &amp;#169; &amp;#xA9;</p>", ["W-MD-ENTITY", "W-MD-ENTITY", "W-MD-ENTITY"]],
    ["<https://x.y>", "<p>&lt;https://x.y&gt;</p>", ["W-MD-AUTOLINK"]],
    ["<me@x.y>", "<p>&lt;me@x.y&gt;</p>", ["W-MD-AUTOLINK"]],
    ["[a][ref]", "<p>[a][ref]</p>", ["W-MD-REFERENCE-LINK"]],
    ["[a][]", "<p>[a][]</p>", ["W-MD-REFERENCE-LINK"]],
    ["[ref]: /url", "<p>[ref]: /url</p>", ["W-MD-REFERENCE-LINK"]],
    ["see [^1]", "<p>see [^1]</p>", ["W-MD-FOOTNOTE"]],
    ["[^1]: the note", "<p>[^1]: the note</p>", ["W-MD-FOOTNOTE"]],
    ["- [ ] todo\n- [x] done", "<ul><li>[ ] todo</li><li>[x] done</li></ul>", ["W-MD-TASK-LIST", "W-MD-TASK-LIST"]],
    ["Title\n=====", "<p>Title\n=====</p>", ["W-MD-SETEXT"]],
    ["Title\n---", "<p>Title</p><hr>", ["W-MD-SETEXT"]],
    ["    indented", "<p>indented</p>", ["W-MD-INDENTED-CODE"]],
    ["_em_ and __strong__", "<p>_em_ and __strong__</p>", ["W-MD-EMPHASIS-UNDERSCORE", "W-MD-EMPHASIS-UNDERSCORE"]],
    ["~one~", "<p>~one~</p>", ["W-MD-STRIKETHROUGH"]],
    ["* item", "<p>* item</p>", ["W-MD-BULLET-MARKER"]],
    ["+ item", "<p>+ item</p>", ["W-MD-BULLET-MARKER"]],
    ["1) item", "<p>1) item</p>", ["W-MD-ORDERED-MARKER"]],
    ["***", "<p>***</p>", ["W-MD-THEMATIC-BREAK"]],
    ["___", "<p>___</p>", ["W-MD-THEMATIC-BREAK"]],
    ["- - -", "<p>- - -</p>", ["W-MD-THEMATIC-BREAK"]],
    ["~~~\ncode\n~~~", "<p>~~~\ncode\n~~~</p>", ["W-MD-FENCE-TILDE", "W-MD-FENCE-TILDE"]],
    ["## Title ##", "<h2>Title ##</h2>", ["W-MD-HEADING-CLOSE"]],
    ["a  \nb", "<p>a\nb</p>", ["W-MD-HARD-BREAK-SPACES"]],
    ["[a](/u 'T')", "<p>[a](/u 'T')</p>", ["W-MD-LINK-TITLE"]],
    ["[a](/u (T))", "<p>[a](/u (T))</p>", ["W-MD-LINK-TITLE"]],
    ["[a](<my url>)", "<p>[a](&lt;my url&gt;)</p>", ["W-MD-LINK-DESTINATION"]],
    ["a | b\n--- | ---\n1 | 2", "<p>a | b\n--- | ---\n1 | 2</p>", ["W-MD-TABLE-PIPES"]],
    ["> a\nb", "<blockquote><p>a</p></blockquote><p>b</p>", ["W-MD-LAZY-CONTINUATION"]],
    ["- a\nb", "<ul><li>a</li></ul><p>b</p>", ["W-MD-LAZY-CONTINUATION"]],
  ];
  for (const [src, want, wantCodes] of cases) {
    test(`C: ${JSON.stringify(src)} → ${wantCodes[0]}`, () => {
      const d = parse(src);
      expect(html(d)).toBe(want);
      expect(codes(d)).toEqual(wantCodes);
    });
  }

  test("C-none: canonical scrml-md reports nothing", () => {
    const src = [
      "# Title", "", "Some *em*, **strong**, `code`, ~~del~~ and a [link](/u \"t\").", "",
      "- one", "- two", "  - nested", "", "1. first", "2. second", "", "> quoted", "", "---", "",
      "```js", "let x = 1", "```", "", "| a | b |", "| :- | -: |", "| 1 | 2 |", "", "![img](/i.png)", "line\\", "break",
    ].join("\n");
    expect(codes(parse(src))).toEqual([]);
  });

  test("C-lazy: a second-spelling block start after a list item is not reported as lazy", () => {
    expect(codes(parse("- a\n * b"))).toEqual(["W-MD-BULLET-MARKER"]);
  });

  test("C-code: OUT look-alikes inside code spans and fences are content and report nothing", () => {
    expect(codes(parse("`<b> &amp; _x_ [a][b]`\n\n```\n<b> &amp; * item\n```"))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §D — hostile input: bounded, closed, text-only
// ---------------------------------------------------------------------------

const BLOCK_KINDS = new Set(["Paragraph", "Heading", "CodeBlock", "Quote", "List", "Rule", "Table"]);
const INLINE_KINDS = new Set(["Text", "Slot", "Code", "Em", "Strong", "Del", "Link", "Image", "SoftBreak", "HardBreak"]);
const tagOf = (v) => (typeof v === "string" ? v : v.variant);

/** Walk a doc; assert every node is in the closed set; return the max nesting depth. */
function checkClosed(doc) {
  let max = 0;
  const segs = (list) => {
    expect(Array.isArray(list)).toBe(true);
    for (const g of list) expect(["Lit", "Slot"]).toContain(tagOf(g));
  };
  const inl = (nodes, d) => {
    for (const n of nodes) {
      const t = tagOf(n);
      expect(INLINE_KINDS.has(t)).toBe(true);
      if (d > max) max = d;
      if (t === "Link") { segs(n.data.dest); segs(n.data.title); inl(n.data.children, d + 1); }
      else if (t === "Image") { segs(n.data.src); segs(n.data.alt); segs(n.data.title); }
      else if (t === "Em" || t === "Strong" || t === "Del") inl(n.data.children, d + 1);
      else if (t === "Text" || t === "Code") expect(typeof n.data.text).toBe("string");
    }
  };
  const blk = (list, d) => {
    for (const b of list) {
      const t = tagOf(b);
      expect(BLOCK_KINDS.has(t)).toBe(true);
      if (d > max) max = d;
      if (t === "Paragraph") inl(b.data.children, 1);
      else if (t === "Heading") { expect(b.data.level >= 1 && b.data.level <= 6).toBe(true); inl(b.data.children, 1); }
      else if (t === "CodeBlock") expect(/^([A-Za-z0-9_+-]+)?$/.test(b.data.lang)).toBe(true);
      else if (t === "Quote") blk(b.data.children, d + 1);
      else if (t === "List") { expect(Number.isInteger(b.data.start)).toBe(true); for (const it of b.data.items) blk(it.children, d + 1); }
      else if (t === "Table") {
        for (const a of b.data.align) expect(["Default", "Left", "Center", "Right"]).toContain(tagOf(a));
        for (const c of b.data.head.cells) inl(c.children, 1);
        for (const r of b.data.rows) for (const c of r.cells) inl(c.children, 1);
      }
    }
  };
  blk(doc.blocks, 0);
  return max;
}

function timed(src) {
  const t0 = performance.now();
  const doc = parse(src);
  return { doc, ms: performance.now() - t0 };
}

describe("scrml:md §D hostile — nesting limits (32)", () => {
  test("D1: 1000 nested quotes stop at 32 levels and report W-MD-DEPTH-LIMIT", () => {
    const doc = parse(">".repeat(1000) + " x");
    let depth = 0;
    let b = doc.blocks[0];
    while (b && b.variant === "Quote") { depth++; b = b.data.children[0]; }
    expect(depth).toBe(32);
    expect(codes(doc)).toContain("W-MD-DEPTH-LIMIT");
  });
  test("D2: 1000 nested list items stop at 32 levels", () => {
    const doc = parse(Array.from({ length: 1000 }, (_, i) => " ".repeat(i * 2) + "- x").join("\n"));
    expect(checkClosed(doc)).toBeLessThanOrEqual(32);
    expect(codes(doc)).toContain("W-MD-DEPTH-LIMIT");
  });
  test("D3: 5000 nested emphasis runs stop at 32 levels, in linear time", () => {
    const { doc, ms } = timed("*a ".repeat(5000) + "b" + " a*".repeat(5000));
    expect(checkClosed(doc)).toBeLessThanOrEqual(33);
    expect(codes(doc)).toContain("W-MD-DEPTH-LIMIT");
    expect(ms).toBeLessThan(2000);
  });
  test("D4: at most 32 link brackets are open at once; deeper `[` are text", () => {
    const doc = parse("[".repeat(40) + "a" + "](u)".repeat(40));
    expect(checkClosed(doc)).toBeLessThanOrEqual(33);
    expect(codes(doc)).toContain("W-MD-DEPTH-LIMIT");
  });
});

describe("scrml:md §D hostile — huge and pathological input in bounded time", () => {
  const N = 200000;
  const shapes = [
    ["plain words", "word ".repeat(N)],
    ["many lines", "x\n".repeat(N / 2)],
    ["open brackets", "[".repeat(N)],
    ["link tails with no close", "[a](x".repeat(N / 5)],
    ["unterminated titles", '[a](b "'.repeat(N / 7)],
    ["backtick runs", "` ``  ".repeat(N / 6)],
    ["escaped backticks", "\\``x".repeat(N / 4)],
    ["mixed delimiters", "*_~".repeat(N / 3)],
    ["tag look-alikes", "<a ".repeat(N / 3)],
    ["entity look-alikes", "&amp;".repeat(N / 5)],
    ["autolink look-alikes", "<a:".repeat(N / 3)],
    ["nested parens", "[a](" + "(".repeat(N / 2)],
    ["links among open brackets", "[x [a](b) ".repeat(N / 10)],
    ["many headings", "# h\n".repeat(N / 4)],
    ["table rows", "| a | b |\n| - | - |\n" + "| 1 | 2 |\n".repeat(N / 10)],
  ];
  for (const [label, src] of shapes) {
    test(`D: ${label} (${Math.round(src.length / 1024)} KB) parses in bounded time`, () => {
      const { doc, ms } = timed(src);
      checkClosed(doc);
      expect(ms).toBeLessThan(5000);
    });
  }
  test("D5: an unterminated link tail stops on the scan budget and reports W-MD-SCAN-LIMIT", () => {
    expect(codes(parse("[a](x".repeat(N / 5)))).toContain("W-MD-SCAN-LIMIT");
  });
});

describe("scrml:md §D hostile — look-alikes are text", () => {
  test("D6: script and handler markup is text, never a node", () => {
    const src = '<script>alert(1)</script>\n<img src=x onerror="alert(1)">\n<iframe srcdoc="<script>x</script>"></iframe>';
    const doc = parse(src);
    checkClosed(doc);
    expect(html(doc)).toBe(
      "<p>&lt;script&gt;alert(1)&lt;/script&gt;\n&lt;img src=x onerror=&quot;alert(1)&quot;&gt;\n&lt;iframe srcdoc=&quot;&lt;script&gt;x&lt;/script&gt;&quot;&gt;&lt;/iframe&gt;</p>",
    );
  });
  test("D7: character references are never decoded — in text, in a destination, in a title", () => {
    const doc = parse('&lt;b&gt; [x](jav&#x61;script:1 "&quot;")');
    const [t, link] = doc.blocks[0].data.children;
    expect(t.data.text).toBe("&lt;b&gt; ");
    expect(link.data.dest).toEqual([md.MdSeg.Lit("jav&#x61;script:1")]);
    expect(link.data.title).toEqual([md.MdSeg.Lit("&quot;")]);
  });
  test("D8: U+0000 becomes U+FFFD; CRLF line ends read as LF", () => {
    expect(h("a\u0000b")).toBe("<p>a\uFFFDb</p>");
    expect(h("a\r\nb\r\n\r\n# c")).toBe("<p>a\nb</p><h1>c</h1>");
  });
  test("D9: fuzzed input never throws, stays in the closed set and is deterministic", () => {
    const alphabet = ["*", "_", "~", "`", "[", "]", "(", ")", "!", "<", ">", "&", ";", "#", "-", "|", ":", "\\", "\n", "\n\n", " ", "  ", "a", "b", "1.", "- ", "> ", '"', "'", "http://", "x"];
    let seed = 1234567;
    const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    for (let k = 0; k < 600; k++) {
      let s = "";
      const len = 1 + Math.floor(rand() * 120);
      for (let i = 0; i < len; i++) s += alphabet[Math.floor(rand() * alphabet.length)];
      const a = parse(s);
      checkClosed(a);
      expect(JSON.stringify(parse(s))).toBe(JSON.stringify(a));
      for (const d of a.diags) {
        expect(d.offset >= 0 && d.offset <= s.length).toBe(true);
        expect(d.message.length).toBeGreaterThan(0);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// §E — diagnostics
// ---------------------------------------------------------------------------

describe("scrml:md §E diagnostics", () => {
  test("E1: offset, line and column point at the construct", () => {
    const d = parse("ok\n\nsome <b>x\n\n  * item").diags;
    expect(d.map((x) => [x.code, x.offset, x.line, x.col])).toEqual([
      ["W-MD-RAW-HTML", 9, 3, 6],
      ["W-MD-BULLET-MARKER", 17, 5, 3],
    ]);
  });
  test("E2: positions inside a quote and a list item are positions in the input", () => {
    const d = parse("> a &amp;\n- b <i>").diags;
    expect(d.map((x) => [x.code, x.line, x.col])).toEqual([["W-MD-ENTITY", 1, 5], ["W-MD-RAW-HTML", 2, 5]]);
  });
  test("E3: diagnostics are in input order, one per (code, offset)", () => {
    const d = parse("_a_ <b> &amp;").diags;
    expect(d.map((x) => x.code)).toEqual(["W-MD-EMPHASIS-UNDERSCORE", "W-MD-RAW-HTML", "W-MD-ENTITY"]);
  });
  test("E4: every message names the scrml-md spelling to write instead", () => {
    const canonical = {
      "W-MD-RAW-HTML": "**bold**", "W-MD-ENTITY": "character itself", "W-MD-AUTOLINK": "[text](url)",
      "W-MD-REFERENCE-LINK": "[text](url)", "W-MD-FOOTNOTE": "inline", "W-MD-TASK-LIST": "- item",
      "W-MD-SETEXT": "# Title", "W-MD-INDENTED-CODE": "fenced", "W-MD-EMPHASIS-UNDERSCORE": "*emphasis*",
      "W-MD-STRIKETHROUGH": "~~deleted~~", "W-MD-BULLET-MARKER": "- item", "W-MD-ORDERED-MARKER": "1. item",
      "W-MD-THEMATIC-BREAK": "---", "W-MD-FENCE-TILDE": "three backticks", "W-MD-HEADING-CLOSE": "## Title",
      "W-MD-HARD-BREAK-SPACES": "backslash", "W-MD-LINK-TITLE": "double quotes", "W-MD-LINK-DESTINATION": "%20",
      "W-MD-TABLE-PIPES": "| a | b |", "W-MD-LAZY-CONTINUATION": "indent",
    };
    const srcs = ["<b>x</b>", "&amp;", "<ab:c>", "[a][b]", "[^1]", "- [ ] t", "a\n===", "    c", "_a_", "~a~", "* i", "1) i",
      "***", "~~~", "# a #", "a  \nb", "[a](b 'c')", "[a](<b>)", "a | b\n- | -", "> a\nb"];
    const seen = new Map();
    for (const s of srcs) for (const d of parse(s).diags) seen.set(d.code, d.message);
    for (const [code, needle] of Object.entries(canonical)) {
      expect({ code, has: (seen.get(code) ?? "").includes(needle) }).toEqual({ code, has: true });
    }
  });
});

// ---------------------------------------------------------------------------
// §F — dedent (§67.2)
// ---------------------------------------------------------------------------

describe("scrml:md §F dedent", () => {
  test("F1: the newline after the opener and the closer's line are dropped; the content's minimum indentation is stripped", () => {
    // the deep-dive §6f layout: <md> and </md> at 8, content at 12
    expect(dedent("\n            ## Notes\n\n            1. Merge.\n               Then tag.\n        ")).toEqual({
      text: "## Notes\n\n1. Merge.\n   Then tag.", indent: 12, dropFirst: true, mixed: false,
    });
  });
  test("F2: the closer's line does not count (it sits left of the content)", () => {
    expect(dedent("\n    a\n    b\n    ").text).toBe("a\nb");
    expect(dedent("\n    a\n  ").text).toBe("a");
    expect(dedent("\n    a\n      ").text).toBe("a");
  });
  test("F3: blank lines do not count and become empty", () => {
    expect(dedent("\n    a\n\n      \n    b\n    ").text).toBe("a\n\n\nb");
  });
  test("F4: a one-line body is kept as written", () => {
    expect(dedent("Saved **3** issues.")).toEqual({ text: "Saved **3** issues.", indent: 0, dropFirst: false, mixed: false });
  });
  test("F5: content on the opener's line is kept and not counted", () => {
    expect(dedent("# Title\n    para\n    ").text).toBe("# Title\npara");
  });
  test("F6: content on the closer's line is a content line", () => {
    expect(dedent("\n    a\n    b").text).toBe("a\nb");
  });
  test("F7: stripped prefixes that differ (a tab here, spaces there) are mixed", () => {
    expect(dedent("\n\ta\n    b\n    ").mixed).toBe(true);
    expect(dedent("\n\ta\n\tb\n\t").mixed).toBe(false);
  });
  test("F8: a dedented body parses as markdown, not as indented code", () => {
    const body = "\n        ## Filing a bug\n\n        Before you file, **search**.\n\n        - Say what you *expected*.\n    ";
    const doc = parse(dedent(body).text);
    expect(html(doc)).toBe("<h2>Filing a bug</h2><p>Before you file, <strong>search</strong>.</p><ul><li>Say what you <em>expected</em>.</li></ul>");
    expect(codes(doc)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §G — headingSlugs
// ---------------------------------------------------------------------------

describe("scrml:md §G headingSlugs", () => {
  test("G1: lower case; letters and digits kept; spaces and `-` become `-`; the rest dropped", () => {
    expect(headingSlugs(parse("# Filing a Bug!\n## Step 2: *Triage*\n### Café & co"), [])).toEqual(["filing-a-bug", "step-2-triage", "caf--co"]);
  });
  test("G2: duplicates get -1, -2 in document order; taken ids are avoided; nested headings count", () => {
    expect(headingSlugs(parse("# A\n## A\n> # A\n- # A"), ["a-1"])).toEqual(["a", "a-2", "a-3", "a-4"]);
  });
  test("G3: a heading with no letters or digits gets `section`", () => {
    expect(headingSlugs(parse("# !!!\n# ..."), [])).toEqual(["section", "section-1"]);
  });
  test("G4: ids render on the headings in document order", () => {
    const doc = parse("# One\n# Two");
    expect(html(doc, { ids: headingSlugs(doc, []) })).toBe('<h1 id="one">One</h1><h1 id="two">Two</h1>');
  });
});
