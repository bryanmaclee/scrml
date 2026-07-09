// CONF-URL-COMMENT | §27.1 / §27.2
// A bare URL in a CSS `url()` value or in markup prose must NOT have its `//`
// (the `http://` scheme slashes, or a protocol-relative `url(//cdn)`) eaten as
// a `//` line comment. Pre-fix the block-splitter treated the `//` as a comment
// running to end-of-line — swallowing the closing `}` of the `#{}` CSS block or
// the `</p>` closer — and surfaced a spurious E-CTX-001/E-CTX-003 unclosed
// context.
//
// SPEC §27.1 keeps `//` a UNIVERSAL comment valid in ALL contexts (incl. CSS
// §27.2 and markup), so the fix is a narrow URL-exemption (scheme `://` or a
// CSS `url(...)` token in CSS + markup-text only) — a genuine `// comment`
// (whitespace/line-start before `//`) is still stripped as a comment.
import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../../src/block-splitter.js";

function split(src) {
  return splitBlocks("test.scrml", src);
}

// Flatten the block tree into a single array (blocks + all descendants).
function flatten(blocks, acc = []) {
  for (const b of blocks) {
    acc.push(b);
    if (b.children && b.children.length) flatten(b.children, acc);
  }
  return acc;
}

describe("CONF-URL-COMMENT: bare URL // is not a line comment in CSS/markup", () => {
  test("CSS url(http://…) inside #{} closes cleanly (no E-CTX)", () => {
    const src = "<div>\n    #{ background: url(http://example.com/a.png) }\n    <p>x</>\n</div>";
    const { blocks, errors } = split(src);
    expect(errors).toEqual([]);
    const all = flatten(blocks);
    const css = all.find(b => b.type === "css");
    expect(css).toBeDefined();
    // The full URL survives verbatim in the css block's raw slice.
    expect(css.raw).toContain("url(http://example.com/a.png)");
  });

  test("protocol-relative url(//cdn…) inside #{} closes cleanly (no E-CTX)", () => {
    const src = "<div>\n    #{ background: url(//cdn.example.com/x.png) }\n    <p>x</>\n</div>";
    const { blocks, errors } = split(src);
    expect(errors).toEqual([]);
    const css = flatten(blocks).find(b => b.type === "css");
    expect(css).toBeDefined();
    expect(css.raw).toContain("url(//cdn.example.com/x.png)");
  });

  test("markup prose with http:// keeps the URL and the </p> closer (no E-CTX)", () => {
    const src = "<div>\n    <p>Visit http://example.com now</p>\n</div>";
    const { blocks, errors } = split(src);
    expect(errors).toEqual([]);
    const all = flatten(blocks);
    const p = all.find(b => b.type === "markup" && b.name === "p");
    expect(p).toBeDefined();
    // The prose (incl. the URL) survives as text inside <p>.
    const text = flatten(p.children || []).find(
      c => c.type === "text" && c.raw.includes("http://example.com"),
    );
    expect(text).toBeDefined();
    // The URL's // did NOT swallow the rest of the line (`now` survives).
    expect(text.raw).toContain("Visit http://example.com now");
  });

  test("<match> arm prose with a URL finds </match> (raw-body scan not derailed)", () => {
    const src =
      "<div>\n" +
      "    <match for=Phase on=@phase>\n" +
      "        <Idle>\n" +
      "            <p>See http://example.com here</p>\n" +
      "        </>\n" +
      "    </match>\n" +
      "</div>";
    const { blocks, errors } = split(src);
    // The block-splitter must find the </match> closer — no unclosed E-CTX.
    expect(errors).toEqual([]);
    const match = flatten(blocks).find(b => b.name === "match");
    expect(match).toBeDefined();
  });

  // ---- Regression guards: genuine comments must STILL be comments (§27) ----

  test("genuine // comment in a ${} logic block is still stripped as a comment", () => {
    const src = "<div>\n    ${\n        let x = 1 // a real comment\n        let y = 2\n    }\n    <p>x</>\n</div>";
    const { blocks, errors } = split(src);
    expect(errors).toEqual([]);
    // The logic frame's raw still contains the comment text (BS keeps it in the
    // brace-context slice for tokenizeLogic to strip) — the point is it did NOT
    // derail context closing: the logic block closed and <p> is a sibling.
    const all = flatten(blocks);
    const logic = all.find(b => b.type === "logic");
    expect(logic).toBeDefined();
    const p = all.find(b => b.type === "markup" && b.name === "p");
    expect(p).toBeDefined();
  });

  test("a // preceded by whitespace in CSS is still a comment (not exempted)", () => {
    // `red; // note` — the char before `//` is a space, NOT `:`, and not inside
    // url(...), so the URL-exemption does not fire: this remains a comment.
    const src = "<div>\n    #{ color: red; // note\n       font-size: 16px }\n    <p>x</>\n</div>";
    const { errors } = split(src);
    expect(errors).toEqual([]);
  });

  test('quoted "https://…" string in logic is unaffected (S144)', () => {
    const src = '<div>\n    ${\n        let u = "https://example.com/path"\n    }\n    <p>x</>\n</div>';
    const { blocks, errors } = split(src);
    expect(errors).toEqual([]);
    const logic = flatten(blocks).find(b => b.type === "logic");
    expect(logic).toBeDefined();
    expect(logic.raw).toContain("https://example.com/path");
  });

  test("CSS /* */ block comment still works alongside a url()", () => {
    const src = "<div>\n    #{ /* bg */ background: url(http://example.com/a.png) }\n    <p>x</>\n</div>";
    const { blocks, errors } = split(src);
    expect(errors).toEqual([]);
    const css = flatten(blocks).find(b => b.type === "css");
    expect(css).toBeDefined();
    expect(css.raw).toContain("url(http://example.com/a.png)");
  });
});
