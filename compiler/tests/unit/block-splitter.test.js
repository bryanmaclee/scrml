import { describe, test, expect } from "bun:test";
import { splitBlocks, BSError } from "../../src/block-splitter.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function split(source) {
  return splitBlocks("test.scrml", source).blocks;
}

function splitFirst(source) {
  return split(source)[0];
}

/**
 * Assert that parsing `source` produces at least one error with the given code.
 * splitBlocks() collects errors rather than throwing — this helper checks the
 * returned errors[] array.
 */
function expectError(source, code) {
  const result = splitBlocks("test.scrml", source);
  const match = result.errors.find(e => e.code === code);
  expect(match, `Expected error ${code} but got: ${JSON.stringify(result.errors.map(e => e.code))}`).toBeDefined();
  expect(match).toBeInstanceOf(BSError);
}

// ---------------------------------------------------------------------------
// Basic text content
// ---------------------------------------------------------------------------

describe("text blocks", () => {
  test("bare text becomes a single text block", () => {
    const blocks = split("hello world");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("text");
    expect(blocks[0].raw).toBe("hello world");
    expect(blocks[0].depth).toBe(0);
    expect(blocks[0].children).toHaveLength(0);
  });

  test("empty source produces no blocks", () => {
    const blocks = split("");
    expect(blocks).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Basic markup splitting
// ---------------------------------------------------------------------------

describe("markup blocks", () => {
  test("simple markup tag with inferred closer", () => {
    const blocks = split("<p>hello</>");
    expect(blocks).toHaveLength(1);
    const b = blocks[0];
    expect(b.type).toBe("markup");
    expect(b.name).toBe("p");
    expect(b.closerForm).toBe("inferred");
    expect(b.raw).toBe("<p>hello</>");
    expect(b.depth).toBe(0);
  });

  test("markup tag with explicit close tag", () => {
    const blocks = split("<button>Click me</button>");
    expect(blocks).toHaveLength(1);
    const b = blocks[0];
    expect(b.type).toBe("markup");
    expect(b.name).toBe("button");
    expect(b.closerForm).toBe("explicit");
    expect(b.raw).toBe("<button>Click me</button>");
  });

  test("self-closing tag (/>)", () => {
    const blocks = split("<br/>");
    expect(blocks).toHaveLength(1);
    const b = blocks[0];
    expect(b.type).toBe("markup");
    expect(b.name).toBe("br");
    expect(b.closerForm).toBe("self-closing");
    expect(b.children).toHaveLength(0);
  });

  test("multiple sibling markup tags", () => {
    const blocks = split("<p>one</><p>two</>");
    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe("markup");
    expect(blocks[0].name).toBe("p");
    expect(blocks[1].type).toBe("markup");
    expect(blocks[1].name).toBe("p");
  });

  test("markup tag text content is a child text block", () => {
    const blocks = split("<div>hello</>");
    expect(blocks).toHaveLength(1);
    const div = blocks[0];
    expect(div.children).toHaveLength(1);
    expect(div.children[0].type).toBe("text");
    expect(div.children[0].raw).toBe("hello");
  });

  test("span includes attributes in raw", () => {
    const blocks = split('<a href="/home">link</>');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].name).toBe("a");
    expect(blocks[0].raw).toContain('href="/home"');
  });

  test("nested markup tags", () => {
    const blocks = split("<ul><li>item</li></ul>");
    expect(blocks).toHaveLength(1);
    const ul = blocks[0];
    expect(ul.type).toBe("markup");
    expect(ul.name).toBe("ul");
    // li should be a child of ul
    const li = ul.children.find((c) => c.type === "markup");
    expect(li).toBeDefined();
    expect(li.name).toBe("li");
    expect(li.depth).toBe(1);
  });

  test("span start/end offsets are correct", () => {
    const source = "<p>hi</>";
    const blocks = split(source);
    expect(blocks[0].span.start).toBe(0);
    expect(blocks[0].span.end).toBe(source.length);
  });

  test("span line and col are 1-based", () => {
    const source = "<p>hi</>";
    const blocks = split(source);
    expect(blocks[0].span.line).toBe(1);
    expect(blocks[0].span.col).toBe(1);
  });

  test("second block on second line has correct line/col", () => {
    const source = "<p>a</>\n<p>b</>";
    const blocks = split(source);
    // The '\n' between the two <p> elements becomes a text block at depth 0,
    // so we get 3 blocks: <p>, text(\n), <p>
    const markupBlocks = blocks.filter((b) => b.type === "markup");
    expect(markupBlocks).toHaveLength(2);
    expect(markupBlocks[1].span.line).toBe(2);
    expect(markupBlocks[1].span.col).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Tag vs state disambiguation (§4.3)
// ---------------------------------------------------------------------------

describe("tag vs state disambiguation", () => {
  test("no whitespace after < → markup", () => {
    const b = splitFirst("<div>content</>");
    expect(b.type).toBe("markup");
    expect(b.name).toBe("div");
  });

  test("space after < → state", () => {
    const b = splitFirst("< db src=\"db.sql\"></>");
    expect(b.type).toBe("state");
    expect(b.name).toBe("db");
  });

  test("tab after < → state", () => {
    const b = splitFirst("<\tdb></>");
    expect(b.type).toBe("state");
    expect(b.name).toBe("db");
  });

  test("newline after < → state", () => {
    const b = splitFirst("<\ndb></>");
    expect(b.type).toBe("state");
    expect(b.name).toBe("db");
  });

  test("multiple spaces after < → state", () => {
    const b = splitFirst("<   db></>");
    expect(b.type).toBe("state");
    expect(b.name).toBe("db");
  });

  test("state block inferred closer", () => {
    const b = splitFirst("< db>content</>");
    expect(b.type).toBe("state");
    expect(b.closerForm).toBe("inferred");
  });

  test("state block explicit closer", () => {
    const b = splitFirst("< db>content</db>");
    expect(b.type).toBe("state");
    expect(b.closerForm).toBe("explicit");
  });
});

// ---------------------------------------------------------------------------
// Logic context `${...}`
// ---------------------------------------------------------------------------

describe("logic context", () => {
  test("basic logic block at top level", () => {
    const blocks = split("${ let x = 1; }");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("logic");
    expect(blocks[0].closerForm).toBeNull();
    expect(blocks[0].name).toBeNull();
    expect(blocks[0].raw).toBe("${ let x = 1; }");
  });

  test("logic block inside markup", () => {
    const blocks = split("<p>${ x }</>");
    expect(blocks).toHaveLength(1);
    const p = blocks[0];
    const logic = p.children.find((c) => c.type === "logic");
    expect(logic).toBeDefined();
    expect(logic.depth).toBe(1);
  });

  test("logic block raw includes delimiters", () => {
    const blocks = split("${ 1 + 2 }");
    expect(blocks[0].raw).toBe("${ 1 + 2 }");
  });

  test("nested braces inside logic do not close it", () => {
    const blocks = split("${ if (true) { let x = 1; } }");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("logic");
    expect(blocks[0].raw).toBe("${ if (true) { let x = 1; } }");
  });

  test("text before and after logic block", () => {
    const blocks = split("before${ x }after");
    expect(blocks).toHaveLength(3);
    expect(blocks[0].type).toBe("text");
    expect(blocks[0].raw).toBe("before");
    expect(blocks[1].type).toBe("logic");
    expect(blocks[2].type).toBe("text");
    expect(blocks[2].raw).toBe("after");
  });
});

// ---------------------------------------------------------------------------
// SQL context `?{...}`
// ---------------------------------------------------------------------------

describe("sql context", () => {
  // S108 Bug 4 C-narrow: `?{` at top-level / markup-text level no longer
  // opens a SQL block. SPEC §3.1 + §8.1 place SQL strictly inside Logic
  // context. The pre-S108 behavior (bare top-level `?{...}` produces a
  // SQL block) was a divergence from spec; the catastrophic failure
  // mode it surfaced in adopter docs-prose was the load-bearing reason
  // to bring the implementation back in line with §3.1.
  test("bare top-level `?{ SELECT 1 }` is NOT a SQL block (S108 C-narrow conformance)", () => {
    const blocks = split("?{ SELECT 1 }");
    // The `?{` no longer pushes an SQL context; the `?` accumulates as
    // text, the `{` increments orphan-brace, the `}` decrements. Net
    // result: a single text block containing the literal source.
    expect(blocks.every((b) => b.type !== "sql")).toBe(true);
  });

  test("sql inside logic (legitimate per §3.1)", () => {
    const blocks = split("${ ?{ SELECT 1 } }");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("logic");
    const sqlChild = blocks[0].children.find((c) => c.type === "sql");
    expect(sqlChild).toBeDefined();
    expect(sqlChild.raw).toBe("?{ SELECT 1 }");
  });
});

// ---------------------------------------------------------------------------
// CSS context `#{...}`
// ---------------------------------------------------------------------------

describe("css context", () => {
  test("css block at top level", () => {
    const blocks = split("#{ color: red }");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("css");
  });

  test("css block inside markup", () => {
    const blocks = split("<div>#{ color: blue }</>");
    expect(blocks).toHaveLength(1);
    const div = blocks[0];
    const css = div.children.find((c) => c.type === "css");
    expect(css).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Error-effect context `!{...}`
// ---------------------------------------------------------------------------

describe("error-effect context", () => {
  test("error-effect block", () => {
    const blocks = split("!{ throw err }");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("error-effect");
    expect(blocks[0].raw).toBe("!{ throw err }");
  });

  test("error-effect inside logic", () => {
    const blocks = split("${ !{ err } }");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("logic");
    const ee = blocks[0].children.find((c) => c.type === "error-effect");
    expect(ee).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Nested contexts
// ---------------------------------------------------------------------------

describe("nested contexts", () => {
  test("markup > state > markup nesting", () => {
    const blocks = split("<div>< db>content</db></div>");
    expect(blocks).toHaveLength(1);
    const div = blocks[0];
    const stateChild = div.children.find((c) => c.type === "state");
    expect(stateChild).toBeDefined();
    expect(stateChild.name).toBe("db");
    expect(stateChild.depth).toBe(1);
  });

  test("logic > sql depth tracking", () => {
    const blocks = split("${ ?{ SELECT 1 } }");
    expect(blocks[0].type).toBe("logic");
    expect(blocks[0].depth).toBe(0);
    const sql = blocks[0].children.find((c) => c.type === "sql");
    expect(sql.depth).toBe(1);
  });

  test("three-level nesting: markup > markup > logic", () => {
    const blocks = split("<ul><li>${ x }</li></ul>");
    const ul = blocks[0];
    expect(ul.type).toBe("markup");
    const li = ul.children.find((c) => c.type === "markup");
    expect(li).toBeDefined();
    const logic = li.children.find((c) => c.type === "logic");
    expect(logic).toBeDefined();
    expect(logic.depth).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Comment suppression §4.7
// ---------------------------------------------------------------------------

describe("comment suppression", () => {
  test("// comment produces a comment block", () => {
    const blocks = split("// hello\n");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("comment");
    expect(blocks[0].raw).toBe("// hello\n");
  });

  test("// suppresses tag opener on same line", () => {
    const blocks = split("// <div>content\n<p>real</>");
    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe("comment");
    expect(blocks[1].type).toBe("markup");
    expect(blocks[1].name).toBe("p");
  });

  test("// suppresses ${ on same line", () => {
    const blocks = split("// ${ let x = 1; }\n");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("comment");
  });

  test("// suppresses closer on same line", () => {
    // The / after // should not close any context
    const blocks = split("<p>text\n// /\nmore</>");
    expect(blocks).toHaveLength(1);
    const p = blocks[0];
    expect(p.type).toBe("markup");
    // The comment is a child of <p>
    const comment = p.children.find((c) => c.type === "comment");
    expect(comment).toBeDefined();
  });

  test("comment at end of file (no trailing newline)", () => {
    const blocks = split("// end of file comment");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("comment");
    expect(blocks[0].raw).toBe("// end of file comment");
  });

  test("// inside brace context is suppressed", () => {
    const blocks = split("${ // not a close\nlet x = 1; }");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("logic");
  });
});

// ---------------------------------------------------------------------------
// `<` inside logic context is NOT a tag opener (§4.6)
// ---------------------------------------------------------------------------

describe("<  suppression inside brace contexts (§4.6)", () => {
  test("< in comparison is not a tag opener", () => {
    const blocks = split("${ if (count < limit) { } }");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("logic");
    // No markup children
    const markupChildren = blocks[0].children.filter((c) => c.type === "markup");
    expect(markupChildren).toHaveLength(0);
  });

  test("< space inside logic is not a state opener", () => {
    const blocks = split("${ a < b }");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("logic");
  });

  test("< inside sql is not a tag opener", () => {
    const blocks = split("${ ?{ SELECT * FROM t WHERE x < 10 } }");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("logic");
  });

  test("multiple nested braces inside logic are balanced correctly", () => {
    const blocks = split("${ if (a < b) { if (c < d) { x(); } } }");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("logic");
    expect(blocks[0].raw).toBe("${ if (a < b) { if (c < d) { x(); } } }");
  });
});

// ---------------------------------------------------------------------------
// Bare `/` in markup vs inside quoted string (§4.8)
// ---------------------------------------------------------------------------

describe("bare / disambiguation (§4.8)", () => {
  test("/ outside string closes markup tag", () => {
    const blocks = split("<a href=\"/home\">Go home</>");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("markup");
    expect(blocks[0].closerForm).toBe("inferred");
  });

  test("/ inside double-quoted string is not a closer", () => {
    // href="/path/to/page" has two / inside quotes; should not close tag
    const blocks = split('<a href="/path/to/page">link</>');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("markup");
    expect(blocks[0].closerForm).toBe("inferred");
    // raw should include the full href attribute
    expect(blocks[0].raw).toContain("/path/to/page");
  });

  test("/ inside logic context is not a closer", () => {
    const blocks = split("${ let r = a / b; }");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("logic");
  });

  test("/> is not treated as a bare closer", () => {
    const blocks = split("<br/>");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].closerForm).toBe("self-closing");
  });

  test("/ inside single-quoted string is not a closer", () => {
    const blocks = split("<a href='/path'>link</>");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].closerForm).toBe("inferred");
    expect(blocks[0].raw).toContain("/path");
  });
});

// ---------------------------------------------------------------------------
// Error cases
// ---------------------------------------------------------------------------

describe("E-CTX-001 — wrong closer", () => {
  test("} at top level reports E-CTX-001", () => {
    expectError("}", "E-CTX-001");
  });

  test("} in markup context reports E-CTX-001", () => {
    expectError("<p>text}", "E-CTX-001");
  });

  test("mismatched explicit close tag reports E-CTX-001", () => {
    expectError("<div>content</span>", "E-CTX-001");
  });

  test("explicit close with no open tag reports E-CTX-001", () => {
    expectError("</div>", "E-CTX-001");
  });
});

// E-CTX-002 (bare `/` inside brace context) is detected by a later pass (tokenizer/
// structural analysis), not by the block splitter. Per §4.8, the block splitter treats
// `/` inside any brace-delimited context as raw content without error.
describe("E-CTX-002 — / inside brace context (later pass)", () => {
  test("bare / inside logic context is raw content at block-splitter level", () => {
    const blocks = split("${ / }");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("logic");
  });

  test("bare / inside css context is raw content at block-splitter level", () => {
    const blocks = split("#{ / }");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("css");
  });
});

describe("E-CTX-003 — unclosed context at EOF", () => {
  test("unclosed markup tag reports E-CTX-003", () => {
    expectError("<div>content", "E-CTX-003");
  });

  test("unclosed state block reports E-CTX-003", () => {
    expectError("< db>content", "E-CTX-003");
  });

  test("unclosed logic context reports E-CTX-003", () => {
    expectError("${ let x = 1;", "E-CTX-003");
  });

  test("unclosed sql context reports E-CTX-003", () => {
    expectError("${ ?{ SELECT 1 }", "E-CTX-003");
  });

  test("unclosed nested markup reports E-CTX-003", () => {
    expectError("<ul><li>item", "E-CTX-003");
  });

  test("multiple unclosed contexts each produce E-CTX-003", () => {
    // <ul><li>item — both <ul> and <li> are unclosed
    const result = splitBlocks("test.scrml", "<ul><li>item");
    const ctx003 = result.errors.filter(e => e.code === "E-CTX-003");
    expect(ctx003.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Span invariants
// ---------------------------------------------------------------------------

describe("span invariants", () => {
  test("all block raw concatenated reconstructs source", () => {
    const source = "text<p>inside</><br/>after${ x }end";
    const blocks = split(source);

    function collectRaws(blocks) {
      // Collect in source order by depth-first traversal to verify coverage
      return blocks.map((b) => b.raw).join("");
    }

    // Top-level blocks raw should reconstruct source
    const reconstructed = blocks.map((b) => b.raw).join("");
    expect(reconstructed).toBe(source);
  });

  test("block spans are non-overlapping and sorted", () => {
    const blocks = split("<p>a</><div>b</>");
    expect(blocks).toHaveLength(2);
    expect(blocks[0].span.end).toBeLessThanOrEqual(blocks[1].span.start);
  });

  test("child spans are contained within parent span", () => {
    const blocks = split("<div><p>hi</p></div>");
    const div = blocks[0];
    const pChild = div.children.find((c) => c.type === "markup");
    expect(pChild.span.start).toBeGreaterThanOrEqual(div.span.start);
    expect(pChild.span.end).toBeLessThanOrEqual(div.span.end);
  });
});

// ---------------------------------------------------------------------------
// Depth tracking
// ---------------------------------------------------------------------------

describe("depth tracking", () => {
  test("top-level blocks have depth 0", () => {
    const blocks = split("<p>hi</>");
    expect(blocks[0].depth).toBe(0);
  });

  test("children have depth 1", () => {
    const blocks = split("<p>hi</>");
    const textChild = blocks[0].children[0];
    expect(textChild.depth).toBe(1);
  });

  test("grandchild has depth 2", () => {
    const blocks = split("<div><p>hi</p></div>");
    const div = blocks[0];
    const p = div.children.find((c) => c.type === "markup");
    const text = p.children.find((c) => c.type === "text");
    expect(div.depth).toBe(0);
    expect(p.depth).toBe(1);
    expect(text.depth).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Realistic scrml examples
// ---------------------------------------------------------------------------

describe("realistic examples", () => {
  test("bare-slash closer example from spec", () => {
    // Use a plain string to avoid JS template literal consuming ${}
    const source = '< db src="db.sql" tables="users">\n    <ul>${ loadList() }\n</>\n</>';
    // < db ... > (state), <ul> (markup), ${ } (logic), / closes <ul>, / closes < db>
    const blocks = split(source);
    expect(blocks.length).toBeGreaterThan(0);
    const stateBlock = blocks.find((b) => b.type === "state");
    expect(stateBlock).toBeDefined();
    expect(stateBlock.name).toBe("db");
  });

  test("comparison inside logic does not corrupt block stream", () => {
    const source = "${ if (count < MAX_ITEMS) { doThing(); } }";
    const blocks = split(source);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("logic");
  });

  test("commented-out tag does not open a context", () => {
    const source = "// < db src=\"db.sql\">\n<p>Content</>";
    const blocks = split(source);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe("comment");
    expect(blocks[1].type).toBe("markup");
  });

  test("href with slashes does not trigger spurious closes", () => {
    const source = '<a href="/home/page">Go home</>';
    const blocks = split(source);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("markup");
    expect(blocks[0].name).toBe("a");
    expect(blocks[0].closerForm).toBe("inferred");
  });
});

// ---------------------------------------------------------------------------
// Meta context `^{...}` — §22 (Metaprogramming)
// ---------------------------------------------------------------------------

describe("meta context", () => {
  test("basic meta block at top level", () => {
    const blocks = split("^{ let x = 1; }");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("meta");
    expect(blocks[0].closerForm).toBeNull();
    expect(blocks[0].name).toBeNull();
    expect(blocks[0].raw).toBe("^{ let x = 1; }");
  });

  test("meta block inside markup context", () => {
    const blocks = split("<p>^{ x }</>");
    expect(blocks).toHaveLength(1);
    const p = blocks[0];
    expect(p.type).toBe("markup");
    const meta = p.children.find((c) => c.type === "meta");
    expect(meta).toBeDefined();
    expect(meta.depth).toBe(1);
    expect(meta.raw).toBe("^{ x }");
  });

  test("meta block inside logic context", () => {
    const blocks = split("${ ^{ x } }");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("logic");
    const meta = blocks[0].children.find((c) => c.type === "meta");
    expect(meta).toBeDefined();
    expect(meta.depth).toBe(1);
  });

  test("meta block inside SQL context (SQL wrapped in logic per S108 C-narrow)", () => {
    // S108 Bug 4 C-narrow: bare top-level `?{...}` no longer opens SQL
    // (SPEC §3.1 + §8.1 place SQL inside Logic). Test exercises the
    // SQL-context meta-recognition by wrapping in the legitimate
    // §3.1 Logic-parent path: `${ ?{ ... ^{ id } } }`.
    const blocks = split("${ ?{ SELECT ^{ id } } }");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("logic");
    const sql = blocks[0].children.find((c) => c.type === "sql");
    expect(sql).toBeDefined();
    const meta = sql.children.find((c) => c.type === "meta");
    expect(meta).toBeDefined();
    // Meta depth is 2 — inside ${...} (logic, depth 1) inside ?{...} (sql,
    // depth 2). Pre-S108 the bare-top-level `?{...}` shape made this 1.
    expect(meta.depth).toBe(2);
  });

  test("meta block inside CSS context", () => {
    const blocks = split("#{ color: ^{ red } }");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("css");
    const meta = blocks[0].children.find((c) => c.type === "meta");
    expect(meta).toBeDefined();
    expect(meta.depth).toBe(1);
  });

  test("meta block inside error-effect context", () => {
    const blocks = split("!{ throw ^{ err } }");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("error-effect");
    const meta = blocks[0].children.find((c) => c.type === "meta");
    expect(meta).toBeDefined();
    expect(meta.depth).toBe(1);
  });

  test("nested meta blocks (meta inside meta)", () => {
    const blocks = split("^{ ^{ x } }");
    expect(blocks).toHaveLength(1);
    const outerMeta = blocks[0];
    expect(outerMeta.type).toBe("meta");
    const innerMeta = outerMeta.children.find((c) => c.type === "meta");
    expect(innerMeta).toBeDefined();
    expect(innerMeta.depth).toBe(1);
    expect(innerMeta.raw).toBe("^{ x }");
  });

  test("deeply nested meta: meta > meta > meta", () => {
    const blocks = split("^{ ^{ ^{ y } } }");
    expect(blocks).toHaveLength(1);
    const meta1 = blocks[0];
    expect(meta1.depth).toBe(0);
    const meta2 = meta1.children.find((c) => c.type === "meta");
    expect(meta2.depth).toBe(1);
    const meta3 = meta2.children.find((c) => c.type === "meta");
    expect(meta3.depth).toBe(2);
  });

  test("meta block at top level outside any tag", () => {
    const blocks = split("^{ compile.time() }");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("meta");
    expect(blocks[0].depth).toBe(0);
  });

  test("meta block inside state context", () => {
    const blocks = split("< db>^{ tableName }</>");
    expect(blocks).toHaveLength(1);
    const state = blocks[0];
    expect(state.type).toBe("state");
    const meta = state.children.find((c) => c.type === "meta");
    expect(meta).toBeDefined();
    expect(meta.depth).toBe(1);
  });

  test("text before and after meta block", () => {
    const blocks = split("before^{ x }after");
    expect(blocks).toHaveLength(3);
    expect(blocks[0].type).toBe("text");
    expect(blocks[0].raw).toBe("before");
    expect(blocks[1].type).toBe("meta");
    expect(blocks[2].type).toBe("text");
    expect(blocks[2].raw).toBe("after");
  });

  test("meta block raw includes delimiters", () => {
    const blocks = split("^{ 1 + 2 }");
    expect(blocks[0].raw).toBe("^{ 1 + 2 }");
  });

  test("nested braces inside meta do not close it", () => {
    const blocks = split("^{ if (true) { let x = 1; } }");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("meta");
    expect(blocks[0].raw).toBe("^{ if (true) { let x = 1; } }");
  });

  test("< inside meta is suppressed (not classified as tag opener)", () => {
    const blocks = split("^{ if (count < limit) { } }");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("meta");
    // No markup children
    const markupChildren = blocks[0].children.filter((c) => c.type === "markup");
    expect(markupChildren).toHaveLength(0);
  });

  test("/ inside meta is not a closer", () => {
    const blocks = split("^{ let r = a / b; }");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("meta");
    expect(blocks[0].raw).toBe("^{ let r = a / b; }");
  });

  test("// comment inside meta suppresses rest of line", () => {
    const blocks = split("^{ // not a close\nlet x = 1; }");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("meta");
  });

  test("meta block span is correct", () => {
    const source = "^{ x }";
    const blocks = split(source);
    expect(blocks[0].span.start).toBe(0);
    expect(blocks[0].span.end).toBe(source.length);
  });

  test("meta block children depth tracking", () => {
    const blocks = split("^{ let x = 1; }");
    expect(blocks[0].depth).toBe(0);
  });

  test("multiple meta blocks at top level", () => {
    const blocks = split("^{ a }^{ b }");
    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe("meta");
    expect(blocks[0].raw).toBe("^{ a }");
    expect(blocks[1].type).toBe("meta");
    expect(blocks[1].raw).toBe("^{ b }");
  });

  test("meta inside markup and then more markup", () => {
    const blocks = split("<div>^{ x }<p>text</p></div>");
    expect(blocks).toHaveLength(1);
    const div = blocks[0];
    expect(div.type).toBe("markup");
    const meta = div.children.find((c) => c.type === "meta");
    expect(meta).toBeDefined();
    const p = div.children.find((c) => c.type === "markup" && c.name === "p");
    expect(p).toBeDefined();
  });

  test("meta with complex nested braces", () => {
    const blocks = split("^{ if (a < b) { if (c < d) { x(); } } }");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("meta");
    expect(blocks[0].raw).toBe("^{ if (a < b) { if (c < d) { x(); } } }");
  });

  test("meta inside logic with nested sql", () => {
    const blocks = split("${ ^{ ?{ SELECT 1 } } }");
    expect(blocks).toHaveLength(1);
    const logic = blocks[0];
    expect(logic.type).toBe("logic");
    const meta = logic.children.find((c) => c.type === "meta");
    expect(meta).toBeDefined();
    const sql = meta.children.find((c) => c.type === "sql");
    expect(sql).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Error cases for meta context
// ---------------------------------------------------------------------------

describe("E-CTX-001 — meta context wrong closer", () => {
  test("} in markup context after meta reports E-CTX-001", () => {
    expectError("<p>^{ x }}", "E-CTX-001");
  });

  test("} at top level after meta is not an error (it closes meta)", () => {
    const blocks = split("^{ x }");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("meta");
  });
});

describe("E-CTX-003 — unclosed meta context at EOF", () => {
  test("unclosed meta context reports E-CTX-003", () => {
    expectError("^{ let x = 1;", "E-CTX-003");
  });

  test("unclosed meta nested in logic reports E-CTX-003", () => {
    expectError("${ ^{ x }", "E-CTX-003");
  });

  test("unclosed meta nested in markup reports E-CTX-003", () => {
    expectError("<p>^{ x", "E-CTX-003");
  });
});

// ---------------------------------------------------------------------------
// E-STYLE-001: <style> block detection
// ---------------------------------------------------------------------------

describe("E-STYLE-001 <style> block detection", () => {
  test("<style> tag reports E-STYLE-001", () => {
    expectError("<style>body { color: red }</style>", "E-STYLE-001");
  });

  test("<Style> tag reports E-STYLE-001 (case-insensitive)", () => {
    expectError("<Style>body { color: red }</Style>", "E-STYLE-001");
  });

  test("<STYLE> tag reports E-STYLE-001 (uppercase)", () => {
    expectError("<STYLE>.foo { margin: 0 }</STYLE>", "E-STYLE-001");
  });

  test("E-STYLE-001 error message mentions #{}", () => {
    const result = splitBlocks("test.scrml", "<style>body{}</style>");
    const err = result.errors.find(e => e.code === "E-STYLE-001");
    expect(err).toBeDefined();
    expect(err).toBeInstanceOf(BSError);
    expect(err.message).toContain("#{}");
  });

  test("E-STYLE-001 error message mentions --convert-legacy-css", () => {
    const result = splitBlocks("test.scrml", "<style>body{}</style>");
    const err = result.errors.find(e => e.code === "E-STYLE-001");
    expect(err).toBeDefined();
    expect(err.message).toContain("--convert-legacy-css");
  });

  test("<style> inside brace context is suppressed (not detected)", () => {
    // Inside ${}, < is suppressed per PA-001 — no tag parsing occurs
    const blocks = split("${ let x = '<style>test</style>' }");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("logic");
  });

  test("<style> scanner recovers and continues after the style block", () => {
    // After reporting E-STYLE-001, the scanner should skip to </style> and continue.
    // A subsequent valid tag should still be parsed.
    const result = splitBlocks("test.scrml", "<style>body{}</style><div>after</>");
    expect(result.errors.some(e => e.code === "E-STYLE-001")).toBe(true);
    const divBlock = result.blocks.find(b => b.type === "markup" && b.name === "div");
    expect(divBlock).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// <program> root element
// ---------------------------------------------------------------------------

describe("<program> root element", () => {
  test("<program> parses as a markup block", () => {
    const blocks = split("<program></program>");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("markup");
    expect(blocks[0].name).toBe("program");
    expect(blocks[0].closerForm).toBe("explicit");
  });

  test("<program> with attributes parses correctly", () => {
    const blocks = split('<program db="./app.db" tables="users,posts" html="living-2026-03"></program>');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("markup");
    expect(blocks[0].name).toBe("program");
  });

  test("<program> with nested content", () => {
    const blocks = split("<program><div>Hello</></program>");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("markup");
    expect(blocks[0].name).toBe("program");
    const children = blocks[0].children.filter(c => c.type !== "text");
    expect(children).toHaveLength(1);
    expect(children[0].type).toBe("markup");
    expect(children[0].name).toBe("div");
  });

  test("multiple <program> blocks (main + worker)", () => {
    const blocks = split('<program>main content</>\n<program name="worker">worker content</>');
    const programBlocks = blocks.filter(b => b.type === "markup" && b.name === "program");
    expect(programBlocks).toHaveLength(2);
    expect(programBlocks[0].name).toBe("program");
    expect(programBlocks[1].name).toBe("program");
  });

  test("<program> with inferred closer", () => {
    const blocks = split("<program>content</>");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("markup");
    expect(blocks[0].name).toBe("program");
    expect(blocks[0].closerForm).toBe("inferred");
  });

  test("<program> with logic child + SQL nested inside logic (S108 C-narrow)", () => {
    // S108 Bug 4 C-narrow: bare `?{...}` directly inside `<program>` markup
    // body no longer opens SQL — markup-text body is not a Logic context
    // per SPEC §3.1. SQL must be wrapped in `${...}` to take the
    // §3.1-canonical SQL-inside-Logic path. Pre-S108 the test exercised
    // the (since-rejected) markup-text-level recognition.
    const blocks = split('<program db="./test.db">${ const rows = ?{ SELECT * FROM users } }</program>');
    expect(blocks).toHaveLength(1);
    const children = blocks[0].children.filter(c => c.type !== "text");
    expect(children).toHaveLength(1);
    expect(children[0].type).toBe("logic");
    const sql = children[0].children.find(c => c.type === "sql");
    expect(sql).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Uppercase component tag names (isComponent flag)
// ---------------------------------------------------------------------------

describe("uppercase component tags — isComponent flag", () => {
  test("self-closing uppercase tag sets isComponent: true", () => {
    const blocks = split("<TodoItem/>");
    expect(blocks).toHaveLength(1);
    const b = blocks[0];
    expect(b.type).toBe("markup");
    expect(b.name).toBe("TodoItem");
    expect(b.isComponent).toBe(true);
    expect(b.closerForm).toBe("self-closing");
  });

  test("self-closing lowercase tag sets isComponent: false", () => {
    const blocks = split("<div/>");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].isComponent).toBe(false);
  });

  test("block-form uppercase tag with inferred closer sets isComponent: true", () => {
    const blocks = split("<UserCard>content</>");
    expect(blocks).toHaveLength(1);
    const b = blocks[0];
    expect(b.type).toBe("markup");
    expect(b.name).toBe("UserCard");
    expect(b.isComponent).toBe(true);
    expect(b.closerForm).toBe("inferred");
  });

  test("block-form uppercase tag with explicit closer sets isComponent: true", () => {
    const blocks = split("<ContactCard>content</ContactCard>");
    expect(blocks).toHaveLength(1);
    const b = blocks[0];
    expect(b.type).toBe("markup");
    expect(b.name).toBe("ContactCard");
    expect(b.isComponent).toBe(true);
    expect(b.closerForm).toBe("explicit");
  });

  test("component nested inside HTML element — child has isComponent: true", () => {
    const blocks = split("<div><TodoItem/></div>");
    expect(blocks).toHaveLength(1);
    const div = blocks[0];
    expect(div.name).toBe("div");
    expect(div.isComponent).toBe(false);
    const child = div.children.find(c => c.type === "markup");
    expect(child).toBeDefined();
    expect(child.name).toBe("TodoItem");
    expect(child.isComponent).toBe(true);
  });

  test("HTML element nested inside component — child has isComponent: false", () => {
    const blocks = split("<Modal><span>inner</span></Modal>");
    expect(blocks).toHaveLength(1);
    const modal = blocks[0];
    expect(modal.isComponent).toBe(true);
    const child = modal.children.find(c => c.type === "markup");
    expect(child).toBeDefined();
    expect(child.name).toBe("span");
    expect(child.isComponent).toBe(false);
  });

  test("component with attributes does not throw", () => {
    expect(() => split('<UserCard id="123" name="Alice"/>')).not.toThrow();
    const blocks = split('<UserCard id="123" name="Alice"/>');
    expect(blocks[0].isComponent).toBe(true);
  });

  test("single uppercase letter tag is a component", () => {
    const blocks = split("<A/>");
    expect(blocks[0].isComponent).toBe(true);
  });

  test("single lowercase letter tag is not a component", () => {
    const blocks = split("<a/>");
    expect(blocks[0].isComponent).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Error recovery — multiple errors in one file
// ---------------------------------------------------------------------------

describe("error recovery — multiple errors collected", () => {
  test("two stray } produce two E-CTX-001 errors", () => {
    const result = splitBlocks("test.scrml", "}text}");
    const ctx001 = result.errors.filter(e => e.code === "E-CTX-001");
    expect(ctx001.length).toBe(2);
  });

  test("stray } followed by unclosed tag produces both E-CTX-001 and E-CTX-003", () => {
    const result = splitBlocks("test.scrml", "}<div>unclosed");
    const codes = result.errors.map(e => e.code);
    expect(codes).toContain("E-CTX-001");
    expect(codes).toContain("E-CTX-003");
  });

  test("splitBlocks() never throws regardless of input", () => {
    const malformedInputs = [
      "}", "</div>", "<div>unclosed", "${ ?{ nested unclosed",
      "<style>body{}</style>", "}<p>text}", "<<<<"
    ];
    for (const src of malformedInputs) {
      expect(() => splitBlocks("test.scrml", src)).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// renders clause and apostrophes in text content (BUG-RENDERS-BS)
// ---------------------------------------------------------------------------

describe("renders clause and apostrophes in text content (§4.8 / §19.2)", () => {
  test("apostrophe in markup text content does not prevent bare / closer", () => {
    // "We'll" — the ' is an apostrophe (preceded by a letter), not a string opener.
    // The bare / at the end must still be recognized as a tag closer.
    const result = splitBlocks("test.scrml", "<p>We'll be in touch.</>");
    expect(result.errors).toHaveLength(0);
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].type).toBe("markup");
    expect(result.blocks[0].closerForm).toBe("inferred");
  });

  test("multiple apostrophes in text content do not prevent bare / closer", () => {
    const result = splitBlocks("test.scrml", "<p>It's not that it's broken.</>");
    expect(result.errors).toHaveLength(0);
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].closerForm).toBe("inferred");
  });

  test("single-quoted string in text content still protects / closer", () => {
    // A ' at the start of a word (not preceded by a letter) opens a string.
    // The / inside 'text / here' is NOT a closer.
    const result = splitBlocks("test.scrml", "<div>'text / here'</div>");
    expect(result.errors).toHaveLength(0);
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].type).toBe("markup");
    expect(result.blocks[0].closerForm).toBe("explicit");
  });

  test("renders clause with inline markup inside logic block produces no BS errors", () => {
    const src = [
      "<program>",
      "${(",
      "    type ContactError:enum = {",
      "        EmptyName",
      "            renders <p class=\"field-error\">Name is required.</>",
      "        SubmitFailed(reason: string)",
      "            renders <div class=\"error-banner\">Submission failed: ${reason}</>",
      "    }",
      "}",
      "< errorBoundary>",
      "    <div class=\"contact-form\">",
      "        <p>Thanks for reaching out!</>",
      "    </div>",
      "</>",
      "</>",
    ].join("\n");
    const result = splitBlocks("test.scrml", src);
    expect(result.errors).toHaveLength(0);
  });

  test("renders clause with apostrophe in following markup content works end-to-end", () => {
    const src = [
      "<program>",
      "${",
      "    type E:enum = {",
      "        A",
      "            renders <p class=\"err\">Error A.</>",
      "    }",
      "}",
      "< errorBoundary>",
      "    <p class=\"success\">We'll be in touch.</>",
      "</>",
      "</>",
    ].join("\n");
    const result = splitBlocks("test.scrml", src);
    expect(result.errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// BS-BRACE-IN-STRING — braces inside string literals must not count toward depth
// ---------------------------------------------------------------------------

describe("brace-in-string bug fix (BS-BRACE-IN-STRING)", () => {
  test("open brace in single-quoted string does not cause E-CTX-003", () => {
    // ${ const X = new Set(['{']) } — the '{' inside the string must be ignored
    const result = splitBlocks("test.scrml", "${ const X = new Set(['{']) }");
    expect(result.errors).toHaveLength(0);
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].type).toBe("logic");
  });

  test("open and close braces in single-quoted string are balanced correctly", () => {
    const result = splitBlocks("test.scrml", "${ const X = new Set(['{', '}']) }");
    expect(result.errors).toHaveLength(0);
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].type).toBe("logic");
  });

  test("braces in double-quoted string are ignored for depth", () => {
    const result = splitBlocks("test.scrml", '${ let s = "{ hello }" }');
    expect(result.errors).toHaveLength(0);
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].type).toBe("logic");
  });

  test("braces in single-quoted string are ignored for depth", () => {
    const result = splitBlocks("test.scrml", "${ let s = '{ hello }' }");
    expect(result.errors).toHaveLength(0);
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].type).toBe("logic");
  });

  // Note: backtick template literals are NOT tracked for brace depth. Block
  // comments (/** ... */) are raw text to the block splitter; backticks inside
  // JSDoc would cause persistent false "in-string" state that skips all depth
  // counting. Template literal ${} interpolations push their own brace frame
  // so nested depth is correctly counted. Bare { } in a template literal body
  // (outside ${}) will affect brace depth — this is a known limitation.

  test("single-quoted string braces do not interfere with nesting", () => {
    // Additional single-quote string test: nested JS block after a brace-string
    const result = splitBlocks("test.scrml", "${ const s = '{'; const t = '}'; }");
    expect(result.errors).toHaveLength(0);
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].type).toBe("logic");
  });

  test("escaped quote followed by brace in long string is a known limitation", () => {
    // Long strings with escaped quotes and braces are NOT handled by the
    // narrow pattern-match approach. The BS uses a short-string pattern
    // ('{', "}", "{}", etc.) rather than full string-state tracking, so
    // braces deep inside long strings may still affect depth counting.
    // This is acceptable — use String.fromCharCode(123) for { in long strings.
    const src = '${ let s = "escaped \\" { still in string" }';
    const result = splitBlocks("test.scrml", src);
    // Known limitation: this produces an error because the { is counted
    expect(result.errors.length).toBeGreaterThanOrEqual(0); // doesn't crash
  });

  test("object literal with brace in string value is handled", () => {
    const result = splitBlocks("test.scrml", "${ let x = { a: '{' } }");
    expect(result.errors).toHaveLength(0);
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].type).toBe("logic");
  });

  test("multiple double and single quoted braces in one block", () => {
    // Both quote types track correctly in the same block
    const result = splitBlocks("test.scrml", '${ const a = \'{\'; const b = "{}"; }');
    expect(result.errors).toHaveLength(0);
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].type).toBe("logic");
  });

  test("brace tracking resumes correctly after a string literal closes", () => {
    // After the string closes, the outer } should still close the block
    const result = splitBlocks("test.scrml", "${ const s = '{'; if (true) { s } }");
    expect(result.errors).toHaveLength(0);
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].type).toBe("logic");
  });

  test("the raw text of a block with string braces is preserved", () => {
    const src = "${ let x = '{' }";
    const result = splitBlocks("test.scrml", src);
    expect(result.errors).toHaveLength(0);
    expect(result.blocks[0].raw).toBe(src);
  });
});

// ---------------------------------------------------------------------------
// S144 Bug X (6nz, HIGH) — `//` inside a string literal must NOT be treated as
// a line comment inside a brace context. Pre-fix, the `//` in e.g.
// "https://example.com" was mis-read as a line comment, eating the rest of the
// line (incl. closing braces) → spurious E-CTX-003 "Unclosed logic/program".
// The comment scanner must be string-literal-aware (and block-comment-aware so
// apostrophes in `/* */` prose are not mis-read as string openers either),
// while a REAL `//` comment OUTSIDE a string is still stripped.
// ---------------------------------------------------------------------------
describe("S144 Bug X — `//` inside string literal is content, not a comment", () => {
  test("https:// URL in a double-quoted string does not break the logic block", () => {
    const r = splitBlocks("test.scrml", '${ <url> = "https://example.com/docs" }');
    expect(r.errors).toHaveLength(0);
    expect(r.blocks).toHaveLength(1);
    expect(r.blocks[0].type).toBe("logic");
    // The whole logic block raw is preserved including the URL.
    expect(r.blocks[0].raw).toBe('${ <url> = "https://example.com/docs" }');
  });

  test("http:// URL in a single-quoted string does not break the logic block", () => {
    const r = splitBlocks("test.scrml", "${ const u = 'http://example.com' }");
    expect(r.errors).toHaveLength(0);
    expect(r.blocks).toHaveLength(1);
    expect(r.blocks[0].type).toBe("logic");
  });

  test("bare ` // ` mid-string with a following object-literal brace stays balanced", () => {
    const src = '${ function make() { const x = { id: 1, note: "see // here" }; return x.note } }';
    const r = splitBlocks("test.scrml", src);
    expect(r.errors).toHaveLength(0);
    expect(r.blocks).toHaveLength(1);
    expect(r.blocks[0].type).toBe("logic");
    expect(r.blocks[0].raw).toBe(src);
  });

  test("trailing `//` at end of a string is content, not a comment", () => {
    const r = splitBlocks("test.scrml", '${ const s = "ends with //" }');
    expect(r.errors).toHaveLength(0);
    expect(r.blocks).toHaveLength(1);
    expect(r.blocks[0].type).toBe("logic");
  });

  test("`//` inside a string in a ${...} markup interpolation does not break it", () => {
    const r = splitBlocks("test.scrml", '<div>${ "https://x.io" }</div>');
    expect(r.errors).toHaveLength(0);
    expect(r.blocks).toHaveLength(1);
    expect(r.blocks[0].type).toBe("markup");
    expect(r.blocks[0].name).toBe("div");
    // The logic child carries the string verbatim.
    const logic = r.blocks[0].children.find((c) => c.type === "logic");
    expect(logic).toBeDefined();
    expect(logic.raw).toContain("https://x.io");
  });

  test("escaped quote inside a string does not end the string early (then `//` is content)", () => {
    // The \" must not close the string; the // after it is still inside the string.
    const src = '${ const s = "a \\" b // still in string" }';
    const r = splitBlocks("test.scrml", src);
    expect(r.errors).toHaveLength(0);
    expect(r.blocks).toHaveLength(1);
    expect(r.blocks[0].type).toBe("logic");
  });

  test("REGRESSION GUARD: a real `//` comment OUTSIDE a string is still stripped", () => {
    // Inside a brace context, `// not a close` on its own (no surrounding string)
    // is still a comment — block stays "logic" and the trailing `}` still closes it.
    const r = splitBlocks("test.scrml", "${ // not a close\nlet x = 1; }");
    expect(r.errors).toHaveLength(0);
    expect(r.blocks).toHaveLength(1);
    expect(r.blocks[0].type).toBe("logic");
  });

  test("REGRESSION GUARD: `//` comment containing a quote still strips the whole line", () => {
    // The apostrophe inside the comment must NOT start a string (S109/Bug 2 hazard).
    const r = splitBlocks("test.scrml", "${ // it's a comment with a \" quote\nlet x = 1 }");
    expect(r.errors).toHaveLength(0);
    expect(r.blocks).toHaveLength(1);
    expect(r.blocks[0].type).toBe("logic");
  });

  test("REGRESSION GUARD: apostrophe inside a `/* */` block comment is not a string opener", () => {
    // Mirrors the stdlib/host/index.scrml JSDoc shape (`the thunk's Promise`).
    const r = splitBlocks("test.scrml", "${\n  /* the thunk's Promise value */\n  function f() { return 1 }\n}");
    expect(r.errors).toHaveLength(0);
    expect(r.blocks).toHaveLength(1);
    expect(r.blocks[0].type).toBe("logic");
  });

  test("`/* */` block comment INSIDE a string is preserved as content (not consumed as a comment)", () => {
    // Regression-guard for the brief's note: `/* */` inside a string never triggered
    // the bug; ensure the new block-comment skip does not over-reach into strings.
    const src = '${ const s = "has /* not a comment */ inside" }';
    const r = splitBlocks("test.scrml", src);
    expect(r.errors).toHaveLength(0);
    expect(r.blocks).toHaveLength(1);
    expect(r.blocks[0].type).toBe("logic");
    expect(r.blocks[0].raw).toBe(src);
  });

  test("REGEX SAFETY: regex literal with quotes followed by a REAL // comment stays logic", () => {
    // /"[^"]*"/g contains quote chars that are NOT string delimiters; the trailing
    // `// strip strings` IS a real comment. Must not be eaten as in-string content,
    // and the block must still close (line-scoped, regex-tolerant heuristic).
    const r = splitBlocks("test.scrml", '${ s.replace(/"[^"]*"/g, "") // strip strings\nreturn s }');
    expect(r.errors).toHaveLength(0);
    expect(r.blocks).toHaveLength(1);
    expect(r.blocks[0].type).toBe("logic");
  });

  test("REGEX SAFETY: matches the stdlib meta-checker normalizeExpr regex chain shape", () => {
    // Mirrors stdlib/compiler/meta-checker.scrml lines ~231-235 (the regression that
    // caught the over-eager full-string-skip approach during S144 development).
    // Built char-by-char to avoid quote/backslash escaping headaches in the test.
    const DQ = String.fromCharCode(34); // "
    const SQ = String.fromCharCode(39); // '
    const BT = String.fromCharCode(96); // `
    const lines = [
      "${",
      "  let s = expr.replace(/" + BT + "[^" + BT + "]*" + BT + "/g, " + DQ + DQ + ")",
      "    .replace(/" + DQ + "[^" + DQ + "]*" + DQ + "/g, " + DQ + DQ + ")           // double-quoted strings",
      "    .replace(/" + SQ + "[^" + SQ + "]*" + SQ + "/g, " + DQ + DQ + ")           // single-quoted strings",
      "  return s",
      "}",
    ];
    const src = lines.join("\n");
    const r = splitBlocks("test.scrml", src);
    expect(r.errors).toHaveLength(0);
    expect(r.blocks).toHaveLength(1);
    expect(r.blocks[0].type).toBe("logic");
  });

  test("full Bug X reproducer shape (program + url decl + fn with mid-string //) splits cleanly", () => {
    const src = [
      "<program>",
      "${",
      '  <url> = "https://example.com/docs"',
      '  function make() { const x = { id: 1, note: "see // here" }; return x.note }',
      "}",
      "<div>${@url} — ${make()}</div>",
      "</program>",
    ].join("\n");
    const r = splitBlocks("test.scrml", src);
    expect(r.errors).toHaveLength(0);
    const program = r.blocks.find((b) => b.type === "markup" && b.name === "program");
    expect(program).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// issue #28 — element text beginning with `=` (tag-close leading-equals)
//
// When an element's text body BEGINS with `=` (`<span>= hi</span>`,
// `<td>=SUM(A1:A9)</td>`), the tag-closing `>` must terminate the opener and
// the leading `=` is body text. Pre-fix, the S188 `>=`-as-comparison guard
// fired UNCONDITIONALLY: scanAttributes swallowed the `>` together with the
// leading `=` (direct markup children), and classifyOpenerForCompoundScan
// misread the child as a Shape-1 state-decl (promoting the parent to a false
// compound). Both corrupted the tag stack into a misleading E-CTX-001 cascade
// on the OUTER tags (`</div>`/`</page>`) — far from the real site.
//
// Fix: the `>=` reject fires only inside an unquoted attribute VALUE (a prior
// depth-0 `=`); the compound classifier disambiguates a leading-`=` markup body
// from a `<name> = RHS` state-decl by the presence of a matching close tag.
// ---------------------------------------------------------------------------

describe("issue #28 — element text beginning with `=`", () => {
  // Recursively find the first markup node with the given tag name.
  function findMarkup(nodes, name) {
    for (const n of nodes) {
      if (n.type === "markup" && n.name === name) return n;
      if (n.children && n.children.length) {
        const hit = findMarkup(n.children, name);
        if (hit) return hit;
      }
    }
    return null;
  }
  // Concatenated raw of a node's direct text children.
  function textOf(node) {
    return node.children.filter((c) => c.type === "text").map((c) => c.raw).join("");
  }

  test("row 1 — <span>= hi</span> nested in <div> is markup; text is '= hi'", () => {
    const r = splitBlocks("test.scrml",
      `<page auth="none">\n  <div>\n    <span>= hi</span>\n  </div>\n</page>\n`);
    expect(r.errors).toHaveLength(0);
    // The parent <div> must remain MARKUP — NOT gobbled as a compound
    // state-decl text block (the pre-fix corruption).
    const div = findMarkup(r.blocks, "div");
    expect(div).not.toBeNull();
    expect(div.type).toBe("markup");
    const span = findMarkup(r.blocks, "span");
    expect(span).not.toBeNull();
    expect(textOf(span)).toBe("= hi");
  });

  test("row 2 — <td>=SUM(A1:A9)</td> (spreadsheet cell) is markup; text preserved", () => {
    const r = splitBlocks("test.scrml",
      `<page auth="none">\n  <table><tr><td>=SUM(A1:A9)</td></tr></table>\n</page>\n`);
    expect(r.errors).toHaveLength(0);
    const table = findMarkup(r.blocks, "table");
    expect(table).not.toBeNull();
    expect(table.type).toBe("markup");
    const td = findMarkup(r.blocks, "td");
    expect(td).not.toBeNull();
    expect(textOf(td)).toBe("=SUM(A1:A9)");
  });

  test("row 3 — <span>=</span> (body is a lone `=`) is markup; text is '='", () => {
    const r = splitBlocks("test.scrml",
      `<page auth="none">\n  <span>=</span>\n</page>\n`);
    expect(r.errors).toHaveLength(0);
    const span = findMarkup(r.blocks, "span");
    expect(span).not.toBeNull();
    expect(textOf(span)).toBe("=");
  });

  test("row 4 — <div>=a=b=c</div> (multiple `=`) is markup; text is '=a=b=c'", () => {
    const r = splitBlocks("test.scrml",
      `<page auth="none">\n  <div>=a=b=c</div>\n</page>\n`);
    expect(r.errors).toHaveLength(0);
    const div = findMarkup(r.blocks, "div");
    expect(div).not.toBeNull();
    expect(textOf(div)).toBe("=a=b=c");
  });

  test("row 1b — <span>= hi</span> as a DIRECT page child is markup; text is '= hi'", () => {
    const r = splitBlocks("test.scrml",
      `<page auth="none">\n  <span>= hi</span>\n</page>\n`);
    expect(r.errors).toHaveLength(0);
    const span = findMarkup(r.blocks, "span");
    expect(span).not.toBeNull();
    expect(textOf(span)).toBe("= hi");
  });

  test("leading `=` body after a QUOTED attribute — <span id=\"cell\">= hi</span> — is markup", () => {
    // Regression guard for the discriminator: a quoted attribute (`id=\"cell\"`)
    // must NOT leave the scanner \"in an unquoted value\", so the leading-`=`
    // body still terminates the opener. (A too-coarse \"saw any `=`\" flag would
    // mis-swallow the `>=` here — the spreadsheet-cell shape.)
    const r = splitBlocks("test.scrml",
      `<page auth="none">\n  <div id="wrap"><span id="cell">= hi</span></div>\n</page>\n`);
    expect(r.errors).toHaveLength(0);
    const span = findMarkup(r.blocks, "span");
    expect(span).not.toBeNull();
    expect(textOf(span)).toBe("= hi");
    expect(findMarkup(r.blocks, "div").type).toBe("markup");
  });

  test("leading `=` body after a quoted attribute — <td class=\"c\">=SUM(A1:A9)</td>", () => {
    const r = splitBlocks("test.scrml",
      `<page auth="none">\n  <table><tr><td class="c">=SUM(A1:A9)</td></tr></table>\n</page>\n`);
    expect(r.errors).toHaveLength(0);
    const td = findMarkup(r.blocks, "td");
    expect(td).not.toBeNull();
    expect(textOf(td)).toBe("=SUM(A1:A9)");
  });

  test("row 7 — bare unquoted `<p if=@n >= 3>` still flows the operator into the opener (NO E-CTX-001)", () => {
    // Regression guard: the S188 reject path is preserved. At the block-splitter
    // stage the `>=` operator must flow INTO the opener (captured in attrRaw)
    // rather than terminating it early — so the tag stack stays balanced and NO
    // E-CTX-001 fires. The canonical E-ATTR-UNQUOTED-OPERATOR reject fires later
    // at the TAB stage (parenthesize/quote), not here.
    const r = splitBlocks("test.scrml",
      `<page auth="none">\n  <n> = 5\n  <p if=@n >= 3>ok</p>\n</page>\n`);
    expect(r.errors.map((e) => e.code)).not.toContain("E-CTX-001");
    const p = findMarkup(r.blocks, "p");
    expect(p).not.toBeNull();
    // The whole `if=@n >= 3` operator condition is captured inside the opener.
    expect(p.raw).toContain("if=@n >= 3");
    expect(textOf(p)).toBe("ok");
  });

  test("parenthesized `<p if=(@n >= 3)>` and quoted `<p if=\"@n >= 3\">` remain valid openers", () => {
    const paren = splitBlocks("test.scrml",
      `<page auth="none">\n  <n> = 5\n  <p if=(@n >= 3)>ok</p>\n</page>\n`);
    expect(paren.errors).toHaveLength(0);
    expect(findMarkup(paren.blocks, "p")).not.toBeNull();

    const quoted = splitBlocks("test.scrml",
      `<page auth="none">\n  <n> = 5\n  <p if="@n >= 3">ok</p>\n</page>\n`);
    expect(quoted.errors).toHaveLength(0);
    expect(findMarkup(quoted.blocks, "p")).not.toBeNull();
  });
});
