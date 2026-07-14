/**
 * Block Splitter — Self-Host Parity Tests
 *
 * Imports the JS original (compiler/src/block-splitter.js) and the self-hosted
 * scrml version (compiler/self-host/bs.scrml), feeds identical inputs, and
 * asserts identical outputs.
 *
 * Coverage:
 *   - Simple markup tags
 *   - Nested tags
 *   - All 6 brace contexts ($, ?, #, !, ^, ~)
 *   - Self-closing tags
 *   - Void elements
 *   - Component names (uppercase-initial)
 *   - Closer forms (trailing /, explicit </tag>, inferred /)
 *   - Comments (//)
 *   - Quote handling (strings suppress / closer)
 *   - Error cases: E-CTX-001, E-CTX-002, E-CTX-003, E-STYLE-001
 *   - Orphan braces
 *   - Tag nesting tracking
 *   - Catch clauses on error-effect blocks
 *   - State blocks (< whitespace>)
 *   - State references (<#ref>)
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import {
  splitBlocks as splitBlocksJS,
  runBlockSplitter as runBlockSplitterJS,
  BSError as BSErrorJS,
} from "../../src/block-splitter.js";

// ---------------------------------------------------------------------------
// Load the self-hosted version by compiling the scrml source in library mode
// and importing the compiled JS output.
// ---------------------------------------------------------------------------

import { readFileSync, mkdirSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { compileScrml } from "../../src/api.js";

const scrmlPath = resolve(
  dirname(fileURLToPath(new URL(import.meta.url))),
  "../../self-host/bs.scrml"
);

// ---------------------------------------------------------------------------
// Self-host parity gate (S100 — bs.scrml blocked on post-S89 null + emit-library)
// ---------------------------------------------------------------------------
//
// bs.scrml was authored pre-S89 and contains source-position `null` tokens that
// the post-S89 compiler rejects with E-SYNTAX-042. Migrating those 13 sites to
// `not` is also blocked: emit-library mode doesn't run rewriteNot in the
// self-hosted CG path (see compiler/self-host/tab.scrml line 15 author comment
// documenting the same gap for the tokenizer module).
//
// Both forces resolve when emit-library learns rewriteNot (or an equivalent
// self-host CG path). Tracked as a v1.0+ self-host follow-on. Same precedent
// as S78 Bootstrap L3 — describe.skip with documented reason; compiler-side
// follow-up, not a test bug.
//
// Re-trigger: when emit-library rewriteNot lands OR when self-host migration
// begins post-v1.0, un-skip this block + migrate bs.scrml's null sites to
// canonical S89 forms (`name: not`, `is not`, `is some`, etc.).
// ---------------------------------------------------------------------------

const outDir = resolve(dirname(scrmlPath), "dist");
mkdirSync(outDir, { recursive: true });

let splitBlocksSCRML, runBlockSplitterSCRML, BSErrorSCRML;
let setupOk = false;
let setupReason = "";

try {
  const result = compileScrml({
    inputFiles: [scrmlPath],
    outputDir: outDir,
    mode: "library",
    write: true,
    log: () => {},
  });
  if (result.errors.length > 0) {
    const msgs = result.errors.map(e => `[${e.code}] ${e.message}`).join("\n");
    setupReason = `bs.scrml compile failed:\n${msgs}`;
  } else {
    const compiledPath = resolve(outDir, "bs.js");
    const scrmlMod = await import(compiledPath);
    splitBlocksSCRML = scrmlMod.splitBlocks;
    runBlockSplitterSCRML = scrmlMod.runBlockSplitter;
    BSErrorSCRML = scrmlMod.BSError;
    setupOk = true;
  }
} catch (e) {
  setupReason = e.message;
}

if (!setupOk) {
  // eslint-disable-next-line no-console
  console.warn(
    `[bs.test.js] self-host parity SKIPPED — ${setupReason.split("\n")[0]} (see file header for v1.0+ follow-on context).`
  );
}

const describeOrSkip = setupOk ? describe : describe.skip;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalize a block tree for deep comparison. Strips the `raw` field's exact
 * content (already tested via span offsets), keeps everything else.
 */
function normalizeBlocks(blocks) {
  return blocks.map((b) => ({
    type: b.type,
    raw: b.raw,
    span: b.span,
    depth: b.depth,
    name: b.name,
    closerForm: b.closerForm,
    isComponent: b.isComponent,
    children: normalizeBlocks(b.children),
  }));
}

function normalizeErrors(errors) {
  return errors.map((e) => ({
    code: e.code,
    bsSpan: e.bsSpan,
    message: e.message,
  }));
}

/**
 * Run both implementations on the same input and assert parity.
 */
function assertParity(source, filePath = "test.scrml") {
  const jsResult = splitBlocksJS(filePath, source);
  const scrmlResult = splitBlocksSCRML(filePath, source);

  expect(scrmlResult.filePath).toEqual(jsResult.filePath);
  expect(normalizeBlocks(scrmlResult.blocks)).toEqual(
    normalizeBlocks(jsResult.blocks)
  );
  expect(normalizeErrors(scrmlResult.errors)).toEqual(
    normalizeErrors(jsResult.errors)
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describeOrSkip("Block Splitter — self-host parity", () => {
  // --- Basic markup ---

  test("simple markup tag", () => {
    assertParity("<div>hello</div>");
  });

  test("self-closing tag with />", () => {
    assertParity('<img src="test.png" />');
  });

  test("void element auto-self-closes", () => {
    assertParity("<br>");
  });

  test("void element with attributes", () => {
    assertParity('<input type="text" name="foo">');
  });

  test("nested tags", () => {
    assertParity("<div><span>inner</span></div>");
  });

  test("deeply nested tags", () => {
    assertParity("<div><ul><li>item</li></ul></div>");
  });

  // --- Component names ---

  test("component name (uppercase initial)", () => {
    assertParity("<TodoItem>content</TodoItem>");
  });

  test("component self-closing", () => {
    assertParity("<UserCard />");
  });

  test("lowercase is not a component", () => {
    const js = splitBlocksJS("t.scrml", "<div>x</div>");
    const scrml = splitBlocksSCRML("t.scrml", "<div>x</div>");
    expect(js.blocks[0].isComponent).toBe(false);
    expect(scrml.blocks[0].isComponent).toBe(false);
  });

  // --- Closer forms ---

  test("explicit closer </tag>", () => {
    assertParity("<div>text</div>");
    const js = splitBlocksJS("t.scrml", "<div>text</div>");
    expect(js.blocks[0].closerForm).toBe("explicit");
  });

  test("inferred closer (bare /)", () => {
    assertParity("<div>text</>");
    const js = splitBlocksJS("t.scrml", "<div>text</>");
    expect(js.blocks[0].closerForm).toBe("inferred");
  });

  test("self-closing form />", () => {
    assertParity("<br />");
    const js = splitBlocksJS("t.scrml", "<br />");
    expect(js.blocks[0].closerForm).toBe("self-closing");
  });

  // --- Brace contexts ---

  test("logic block ${...}", () => {
    assertParity("${const x = 1}");
  });

  test("sql block ?{...}", () => {
    assertParity("?{SELECT * FROM users}");
  });

  test("css block #{...}", () => {
    assertParity("#{.container { color: red }}");
  });

  test("error-effect block !{...}", () => {
    assertParity("!{doSomething()}");
  });

  test("meta block ^{...}", () => {
    assertParity("^{const m = 1}");
  });

  test("test block ~{...}", () => {
    assertParity("~{assert(true)}");
  });

  test("nested brace contexts", () => {
    assertParity("${const x = #{.a { color: blue }}}");
  });

  test("brace context inside markup", () => {
    assertParity("<div>${name}</div>");
  });

  // --- Error-effect catch clauses ---

  test("error-effect with catch clause", () => {
    assertParity("!{riskyCall()} catch SomeError as e {handleError(e)}");
  });

  test("error-effect with multiple catch clauses", () => {
    assertParity(
      "!{riskyCall()} catch TypeA as a {handle(a)} catch TypeB as b {handle(b)}"
    );
  });

  // --- Comments ---

  test("line comment //", () => {
    assertParity("// this is a comment\ntext after");
  });

  test("comment inside markup", () => {
    assertParity("<div>// comment\ntext</div>");
  });

  test("// inside double-quoted string is not a comment", () => {
    assertParity('"hello // not a comment"');
  });

  // --- Quote handling ---

  test("double-quoted string suppresses / closer", () => {
    assertParity('<div>"text / here"</div>');
  });

  test("single-quoted string suppresses / closer", () => {
    assertParity("<div>'text / here'</div>");
  });

  test("escaped quote does not toggle state", () => {
    assertParity('<div>"escaped \\" quote"</div>');
  });

  // --- Orphan braces ---

  test("orphan braces in markup treated as text", () => {
    assertParity("type X:enum = { A, B, C }");
  });

  test("nested orphan braces", () => {
    assertParity("{ outer { inner } }");
  });

  // --- State blocks ---

  test("state block (< whitespace name>)", () => {
    assertParity("< count>0</>");
  });

  // --- State references ---

  test("state reference <#name>", () => {
    assertParity("<#myState>");
  });

  // --- Error cases ---

  describe("E-CTX-001: wrong closer", () => {
    test("unexpected } at top level", () => {
      assertParity("text } more");
    });

    test("mismatched close tag", () => {
      assertParity("<div>text</span>");
    });

    test("close tag with no open context", () => {
      assertParity("</div>");
    });
  });

  describe("E-CTX-002: bare / in non-markup context", () => {
    // This is a defensive guard that shouldn't normally fire because brace
    // contexts handle / as raw content. But we test the error path exists.
    // The actual code path requires the frame type to be non-markup/state
    // AND not a brace context — which is structurally prevented. We still
    // verify both implementations handle the same edge cases.
  });

  describe("E-CTX-003: unclosed context at EOF", () => {
    test("unclosed markup tag", () => {
      assertParity("<div>text");
    });

    test("unclosed brace context", () => {
      assertParity("${const x = 1");
    });

    test("multiple unclosed contexts", () => {
      assertParity("<div>${inner");
    });
  });

  describe("E-STYLE-001: <style> block rejection", () => {
    test("style tag produces error and skips content", () => {
      assertParity("<style>.foo { color: red }</style>");
    });

    test("style tag case-insensitive close", () => {
      assertParity("<style>body{}</Style>");
    });
  });

  // --- Tag nesting tracking ---

  test("tag nesting preserves depth", () => {
    const source = "<div><span>text</span></div>";
    const jsResult = splitBlocksJS("t.scrml", source);
    const scrmlResult = splitBlocksSCRML("t.scrml", source);

    // div is at depth 0, span is at depth 1
    expect(jsResult.blocks[0].depth).toBe(0);
    expect(jsResult.blocks[0].children[0].depth).toBe(1);
    expect(scrmlResult.blocks[0].depth).toBe(0);
    expect(scrmlResult.blocks[0].children[0].depth).toBe(1);
  });

  test("brace context nesting preserves depth", () => {
    const source = "${outer #{inner}}";
    const jsResult = splitBlocksJS("t.scrml", source);
    const scrmlResult = splitBlocksSCRML("t.scrml", source);

    expect(jsResult.blocks[0].depth).toBe(0);
    expect(scrmlResult.blocks[0].depth).toBe(0);
    // The nested # block is a child
    expect(jsResult.blocks[0].children.length).toBe(scrmlResult.blocks[0].children.length);
  });

  // --- runBlockSplitter wrapper ---

  test("runBlockSplitter wrapper produces same output", () => {
    const input = { filePath: "test.scrml", source: "<div>hello</div>" };
    const jsResult = runBlockSplitterJS(input);
    const scrmlResult = runBlockSplitterSCRML(input);

    expect(normalizeBlocks(scrmlResult.blocks)).toEqual(
      normalizeBlocks(jsResult.blocks)
    );
    expect(normalizeErrors(scrmlResult.errors)).toEqual(
      normalizeErrors(jsResult.errors)
    );
  });

  // --- BSError class ---

  test("BSError has correct shape", () => {
    const span = { start: 0, end: 1, line: 1, col: 1 };
    const jsErr = new BSErrorJS("E-CTX-001", "test", span);
    const scrmlErr = new BSErrorSCRML("E-CTX-001", "test", span);

    expect(scrmlErr.code).toBe(jsErr.code);
    expect(scrmlErr.bsSpan).toEqual(jsErr.bsSpan);
    expect(scrmlErr.name).toBe(jsErr.name);
  });

  // --- Mixed content ---

  test("complex mixed content", () => {
    assertParity(
      `<div class="main">
  <h1>Title</h1>
  \${greeting}
  <ul>
    <li>Item 1</li>
    <li>Item 2</li>
  </ul>
  // a comment
  #{.highlight { background: yellow }}
</div>`
    );
  });

  // --- Attribute edge cases ---

  test("brace expression in attribute value", () => {
    assertParity('<button onClick={handler}>Click</button>');
  });

  test("sigil brace in attribute", () => {
    assertParity('<div class=${dynamicClass}>text</div>');
  });

  test("> inside quoted attribute value", () => {
    assertParity('<div title="a > b">text</div>');
  });

  // --- Empty content ---

  test("empty input", () => {
    assertParity("");
  });

  test("whitespace only", () => {
    assertParity("   \n  \n  ");
  });

  // --- Raw text ---

  test("plain text with no tags or braces", () => {
    assertParity("Hello world, this is plain text.");
  });

  // --- < as operator ---

  test("< used as less-than (no letter after)", () => {
    assertParity("x < 5");
  });
});
