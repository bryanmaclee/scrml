import { describe, test, expect } from "bun:test";
import { splitBlocks, BSError } from "../../src/block-splitter.js";

function split(source) {
  return splitBlocks("test.scrml", source).blocks;
}

// ---------------------------------------------------------------------------
// ~{} test context
// ---------------------------------------------------------------------------

describe("test context ~{}", () => {
  test("basic test block at top level", () => {
    const blocks = split("~{ assert 1 === 1 }");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("test");
    expect(blocks[0].raw).toBe("~{ assert 1 === 1 }");
    expect(blocks[0].name).toBeNull();
    expect(blocks[0].closerForm).toBeNull();
  });

  test("test block inside markup", () => {
    const blocks = split("<p>~{ assert true }</>");
    expect(blocks).toHaveLength(1);
    const p = blocks[0];
    const testBlock = p.children.find(c => c.type === "test");
    expect(testBlock).toBeDefined();
    expect(testBlock.depth).toBe(1);
  });

  test("test block inside logic", () => {
    const blocks = split("${ ~{ assert true } }");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("logic");
    const testBlock = blocks[0].children.find(c => c.type === "test");
    expect(testBlock).toBeDefined();
  });

  test("test block inside state", () => {
    const blocks = split("< db>~{ assert true }</>");
    expect(blocks).toHaveLength(1);
    const state = blocks[0];
    const testBlock = state.children.find(c => c.type === "test");
    expect(testBlock).toBeDefined();
  });

  test("nested braces inside test do not close it", () => {
    const blocks = split("~{ if (true) { let x = 1; } }");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("test");
    expect(blocks[0].raw).toBe("~{ if (true) { let x = 1; } }");
  });

  test("text before and after test block", () => {
    const blocks = split("before~{ x }after");
    expect(blocks).toHaveLength(3);
    expect(blocks[0].type).toBe("text");
    expect(blocks[1].type).toBe("test");
    expect(blocks[2].type).toBe("text");
  });

  test("< inside test is suppressed", () => {
    const blocks = split("~{ if (count < limit) { } }");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("test");
    const markupChildren = blocks[0].children.filter(c => c.type === "markup");
    expect(markupChildren).toHaveLength(0);
  });

  test("/ inside test is not a closer", () => {
    const blocks = split("~{ let r = a / b; }");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("test");
  });

  test("unclosed test context reports E-CTX-003 (does not throw)", () => {
    // splitBlocks() collects errors rather than throwing
    let result;
    expect(() => {
      result = splitBlocks("test.scrml", "~{ assert true");
    }).not.toThrow();
    const err = result.errors.find(e => e.code === "E-CTX-003");
    expect(err).toBeDefined();
    expect(err).toBeInstanceOf(BSError);
  });

  test("multiple test blocks at top level", () => {
    const blocks = split("~{ a }~{ b }");
    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe("test");
    expect(blocks[1].type).toBe("test");
  });

  test("test block can contain other brace contexts", () => {
    const blocks = split("~{ ${ let x = 1 } }");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("test");
    const logic = blocks[0].children.find(c => c.type === "logic");
    expect(logic).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// <#ref> reference syntax
// ---------------------------------------------------------------------------
// After fix (bs-hash-fix): <#name> at markup/state level is ALWAYS kept as
// text — never a "reference" block. The "reference" block type was previously
// emitted but TAB had no handler for it (E-PARSE-001 on any <#name> in markup
// context). All downstream handling uses regex-based rewriting:
//   - <#name>.send(expr) → rewriteWorkerRefs in CG
//   - when message from <#name> → preprocessWorkerAndStateRefs in TAB
//   - <#name> standalone → rewriteInputStateRefs in CG
// ---------------------------------------------------------------------------

describe("reference syntax <#ref>", () => {
  test("<#name> at top level becomes text block (not reference)", () => {
    const blocks = split("<#myRef>");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("text");
    expect(blocks[0].raw).toBe("<#myRef>");
  });

  test("<#name> inside markup becomes text child (not reference)", () => {
    const blocks = split("<div><#author></>");
    expect(blocks).toHaveLength(1);
    const div = blocks[0];
    const textChild = div.children.find(c => c.type === "text" && c.raw.includes("<#author>"));
    expect(textChild).toBeDefined();
    expect(textChild.raw).toBe("<#author>");
  });

  test("<#name> inside state becomes text child (not reference)", () => {
    const blocks = split("< db><#table></>");
    expect(blocks).toHaveLength(1);
    const textChild = blocks[0].children.find(c => c.type === "text" && c.raw.includes("<#table>"));
    expect(textChild).toBeDefined();
    expect(textChild.raw).toBe("<#table>");
  });

  test("<#name> text block has no children and null closerForm", () => {
    const blocks = split("<#myRef>");
    expect(blocks[0].children).toHaveLength(0);
    expect(blocks[0].closerForm).toBeNull();
  });

  test("multiple <#name> patterns become separate text blocks", () => {
    const blocks = split("<#a><#b>");
    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe("text");
    expect(blocks[0].raw).toBe("<#a>");
    expect(blocks[1].type).toBe("text");
    expect(blocks[1].raw).toBe("<#b>");
  });

  // S444 (g-request-refetch-statement-dropped): the REFERENCE form `<#name>.`
  // CONTINUES the open text run instead of flushing it. The split used to cut
  // `function f() { <#r>.refetch() }` at a <program> default-logic body into two
  // blocks, lifting an empty function and shipping the rest as page text. Only
  // the `<#name>.` form continues; other `<#…` forms keep the split (native
  // parser parity).
  test("the <#name> element form still starts its own text block", () => {
    const blocks = split("<p>x</p><#tick when @s is .Active />");
    const last = blocks[blocks.length - 1];
    expect(last.type).toBe("text");
    expect(last.raw.startsWith("<#tick")).toBe(true);
  });

  test("text before a <#name>.member reference is the same run as the ref", () => {
    const blocks = split("function f() {\n  <#r>.refetch()\n}");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("text");
    expect(blocks[0].raw).toBe("function f() {\n  <#r>.refetch()\n}");
  });

  test("<# does not conflict with #{} css context", () => {
    // <# produces text, #{ produces css — they don't interfere
    const blocks = split("#{ color: red }<#myRef>");
    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe("css");
    expect(blocks[1].type).toBe("text");
    expect(blocks[1].raw).toBe("<#myRef>");
  });

  test("<#name>.send() stays as text (worker invocation)", () => {
    // <#name>.send() stays as text so rewriteWorkerRefs in CG can handle it.
    const blocks = split("<#calc>.send(5)");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("text");
    expect(blocks[0].raw).toContain("<#calc>.send(5)");
  });

  test("<#name> without .send() is also text (input state ref)", () => {
    // <#keyboard> stays as text so rewriteInputStateRefs in CG handles it.
    const blocks = split("<#keyboard>");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("text");
    expect(blocks[0].raw).toBe("<#keyboard>");
  });

  test("<#name>.send() inside logic block stays as text", () => {
    const blocks = split("${<#worker>.send(data)}");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("logic");
    // The child should be text containing the full expression
    const text = blocks[0].children.find(c => c.type === "text");
    expect(text).toBeDefined();
    expect(text.raw).toContain("<#worker>.send(data)");
  });
});

// ---------------------------------------------------------------------------
// State constructor with typed attributes (verify existing works)
// ---------------------------------------------------------------------------

describe("state constructor typed attributes", () => {
  test("state with typed attributes parses correctly", () => {
    const blocks = split("< user id(number) name(string)>content</>");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("state");
    expect(blocks[0].name).toBe("user");
  });

  test("state with optional type annotation", () => {
    const blocks = split("< user bio(string?)>content</>");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("state");
  });

  test("state with default value annotation", () => {
    const blocks = split("< user count(number = 0)>content</>");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("state");
  });

  test("state with multiple typed attributes", () => {
    const blocks = split("< session token(string) userId(number) username(string)>content</>");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("state");
    expect(blocks[0].name).toBe("session");
  });

  test("state with multiline typed attributes", () => {
    const blocks = split("< user\n    id(number)\n    name(string)\n>content</>");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("state");
    expect(blocks[0].name).toBe("user");
  });
});

// ---------------------------------------------------------------------------
// ${...} inside tag attributes (scanAttributes brace tracking)
// ---------------------------------------------------------------------------

describe("brace expressions inside tag attributes", () => {
  test("arrow function with > in attribute does not close tag", () => {
    const blocks = split('<button onclick=${e => handleClick(e)}>Click</>');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("markup");
    expect(blocks[0].name).toBe("button");
    expect(blocks[0].closerForm).toBe("inferred");
  });

  test("comparison inside attribute expression does not close tag", () => {
    const blocks = split('<div if=${count > 0}>content</>');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("markup");
    expect(blocks[0].name).toBe("div");
  });

  test("nested braces in attribute expression", () => {
    const blocks = split('<div class=${cond ? "a" : "b"}>content</>');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("markup");
  });

  test("arrow function with body in attribute (self-closing)", () => {
    const blocks = split('<input oninput=${e => { x() }}/>');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("markup");
    expect(blocks[0].closerForm).toBe("self-closing");
  });

  test("arrow function with body in attribute (>)", () => {
    // Use div — input is void/auto-self-closing so can't wrap content
    const blocks = split('<div oninput=${e => { setValue(e.target.value) }}>done</div>');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("markup");
    expect(blocks[0].name).toBe("div");
  });

  test("self-closing with expression in attribute", () => {
    const blocks = split('<img src=${getUrl(id)} alt="photo"/>');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("markup");
    expect(blocks[0].closerForm).toBe("self-closing");
  });

  test("basic ${} in attribute value", () => {
    const blocks = split('<input value=${x}/>');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("markup");
    expect(blocks[0].closerForm).toBe("self-closing");
  });
});

// ---------------------------------------------------------------------------
// Orphan braces at top/markup level (type declarations etc.)
// ---------------------------------------------------------------------------

describe("orphan braces (type declarations)", () => {
  test("bare { } at top level treated as text, not error", () => {
    const blocks = split("type X:enum = { A, B, C }");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("text");
    expect(blocks[0].raw).toBe("type X:enum = { A, B, C }");
  });

  test("bare { } inside markup treated as text", () => {
    const blocks = split("<div>type X = { A }</>");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("markup");
  });

  test("nested orphan braces", () => {
    const blocks = split("type X = { y: { z: number } }");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("text");
  });

  test("orphan braces do not interfere with context openers", () => {
    const blocks = split("type X = { A } ${ let y = 1 }");
    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe("text");
    expect(blocks[1].type).toBe("logic");
  });

  test("unmatched } with no orphan { reports E-CTX-001 (does not throw)", () => {
    // splitBlocks() collects errors rather than throwing
    let result;
    expect(() => {
      result = splitBlocks("test.scrml", "}");
    }).not.toThrow();
    const err = result.errors.find(e => e.code === "E-CTX-001");
    expect(err).toBeDefined();
    expect(err).toBeInstanceOf(BSError);
  });
});
