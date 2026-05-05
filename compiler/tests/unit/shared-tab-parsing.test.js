/**
 * @shared TAB parsing — §37.4
 *
 * Tests for `@shared` reactive declaration modifier in the tokenizer and
 * AST builder (TAB stage). The `@shared` modifier is used inside `<channel>`
 * bodies to mark reactive variables as automatically synchronized across all
 * connected WebSocket clients.
 *
 * §1  Tokenizer: `@shared count = 0` produces AT_IDENT "@shared" then IDENT "count"
 * §2  AST: `@shared count = 0` in a logic block produces reactive-decl with isShared: true
 * §3  AST: name field is "count" (not "shared"), init is "0"
 * §4  AST: non-shared `@count = 0` produces reactive-decl WITHOUT isShared: true
 * §5  AST: multiple declarations — @shared and non-shared mix parsed correctly (separate blocks)
 * §6  AST: @shared with string init → isShared: true, init is the string value
 * §7  Integration: full pipeline parse of <channel> body → extractSharedVars finds the variable
 * §8  AST: @shared outside channel still produces reactive-decl with isShared: true (TAB is context-free)
 *
 * NOTE on multi-statement blocks: scrml merges multiple statements in a single ${}
 * block into the first node's init string (compound reactive-decl). For tests with
 * multiple distinct declarations, use separate ${} blocks. This is the same behavior
 * documented in reactive-arrays.test.js.
 */

import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { tokenizeBlock } from "../../src/tokenizer.js";
import { extractSharedVars, emitChannelClientJs } from "../../src/codegen/emit-channel.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseSource(source, filePath = "/test/app.scrml") {
  const bsResult = splitBlocks(filePath, source);
  const tabResult = buildAST(bsResult);
  return tabResult;
}

/**
 * Parse a logic block inside a <div> and return body nodes.
 * Finds the logic block by recursively searching block children.
 */
function parseLogicBlock(logicSource) {
  const source = `<div>${logicSource}</div>`;
  const { ast } = parseSource(source);
  const divNode = ast.nodes.find(n => n.kind === "markup" && n.tag === "div");
  if (!divNode) return [];
  const logicChild = divNode.children.find(n => n.kind === "logic");
  if (!logicChild) return [];
  return logicChild.body || [];
}

/**
 * Find the logic Block from BS output — searches inside markup children.
 * Logic blocks are nested inside the enclosing markup block's children array.
 */
function findLogicBlock(bsResult) {
  for (const block of bsResult.blocks) {
    if (block.type === "logic") return block;
    if (Array.isArray(block.children)) {
      const found = block.children.find(c => c.type === "logic");
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * Walk all nodes recursively and collect those matching predicate.
 */
function findAll(nodes, pred) {
  const found = [];
  function walk(list) {
    if (!Array.isArray(list)) return;
    for (const n of list) {
      if (!n) continue;
      if (pred(n)) found.push(n);
      if (Array.isArray(n.children)) walk(n.children);
      if (n.kind === "logic" && Array.isArray(n.body)) walk(n.body);
    }
  }
  walk(nodes);
  return found;
}

function findReactiveDecls(ast) {
  return findAll(ast.nodes, n => n.kind === "state-decl");
}

function findChannel(nodes) {
  for (const n of nodes) {
    if (!n) continue;
    if (n.kind === "markup" && n.tag === "channel") return n;
    if (Array.isArray(n.children)) {
      const found = findChannel(n.children);
      if (found) return found;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// §1: Tokenizer output for `@shared count = 0`
// ---------------------------------------------------------------------------

describe("shared-tab §1: tokenizer — @shared produces AT_IDENT '@shared' + IDENT 'count'", () => {
  test("AT_IDENT token text is '@shared'", () => {
    const bsResult = splitBlocks("/test/app.scrml", `<div>\${ @shared count = 0 }</div>`);
    const logicBlock = findLogicBlock(bsResult);
    expect(logicBlock).toBeDefined();
    const tokens = tokenizeBlock(logicBlock, "/test/app.scrml");
    const atShared = tokens.find(t => t.kind === "AT_IDENT" && t.text === "@shared");
    expect(atShared).toBeDefined();
  });

  test("IDENT 'count' follows the AT_IDENT '@shared' token", () => {
    const bsResult = splitBlocks("/test/app.scrml", `<div>\${ @shared count = 0 }</div>`);
    const logicBlock = findLogicBlock(bsResult);
    expect(logicBlock).toBeDefined();
    const tokens = tokenizeBlock(logicBlock, "/test/app.scrml");
    const sharedIdx = tokens.findIndex(t => t.kind === "AT_IDENT" && t.text === "@shared");
    expect(sharedIdx).toBeGreaterThanOrEqual(0);
    const nextTok = tokens[sharedIdx + 1];
    expect(nextTok).toBeDefined();
    expect(nextTok.kind).toBe("IDENT");
    expect(nextTok.text).toBe("count");
  });

  test("'=' token follows the IDENT 'count' in token stream", () => {
    const bsResult = splitBlocks("/test/app.scrml", `<div>\${ @shared count = 0 }</div>`);
    const logicBlock = findLogicBlock(bsResult);
    expect(logicBlock).toBeDefined();
    const tokens = tokenizeBlock(logicBlock, "/test/app.scrml");
    const sharedIdx = tokens.findIndex(t => t.kind === "AT_IDENT" && t.text === "@shared");
    expect(sharedIdx).toBeGreaterThanOrEqual(0);
    // tokens[sharedIdx+1] = IDENT "count", tokens[sharedIdx+2] = PUNCT "="
    const eqTok = tokens[sharedIdx + 2];
    expect(eqTok).toBeDefined();
    expect(eqTok.text).toBe("=");
  });

  test("regular @count = 0 does NOT produce AT_IDENT '@shared' token", () => {
    const bsResult = splitBlocks("/test/app.scrml", `<div>\${ @count = 0 }</div>`);
    const logicBlock = findLogicBlock(bsResult);
    expect(logicBlock).toBeDefined();
    const tokens = tokenizeBlock(logicBlock, "/test/app.scrml");
    const atShared = tokens.find(t => t.kind === "AT_IDENT" && t.text === "@shared");
    expect(atShared).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// §2–§3: AST — @shared count = 0 → reactive-decl with isShared: true
// ---------------------------------------------------------------------------

describe("shared-tab §2–3: @shared count = 0 → reactive-decl isShared: true, name: 'count'", () => {
  test("produces a reactive-decl node", () => {
    const nodes = parseLogicBlock(`\${ @shared count = 0 }`);
    const decl = nodes.find(n => n.kind === "state-decl");
    expect(decl).toBeDefined();
  });

  test("reactive-decl has isShared: true", () => {
    const nodes = parseLogicBlock(`\${ @shared count = 0 }`);
    const decl = nodes.find(n => n.kind === "state-decl");
    expect(decl).toBeDefined();
    expect(decl.isShared).toBe(true);
  });

  test("reactive-decl name is 'count' (not 'shared')", () => {
    const nodes = parseLogicBlock(`\${ @shared count = 0 }`);
    const decl = nodes.find(n => n.kind === "state-decl" && n.isShared === true);
    expect(decl).toBeDefined();
    expect(decl.name).toBe("count");
  });

  test("reactive-decl init contains '0'", () => {
    const nodes = parseLogicBlock(`\${ @shared count = 0 }`);
    const decl = nodes.find(n => n.kind === "state-decl" && n.isShared === true);
    expect(decl).toBeDefined();
    expect(decl.init).toContain("0");
  });
});

// ---------------------------------------------------------------------------
// §4: Non-shared @count = 0 is unchanged — no isShared flag
// ---------------------------------------------------------------------------

describe("shared-tab §4: non-shared @count = 0 → reactive-decl WITHOUT isShared", () => {
  test("regular reactive decl has no isShared property", () => {
    const nodes = parseLogicBlock(`\${ @count = 0 }`);
    const decl = nodes.find(n => n.kind === "state-decl" && n.name === "count");
    expect(decl).toBeDefined();
    expect(decl.isShared).toBeUndefined();
  });

  test("regular reactive decl name and init are correct", () => {
    const nodes = parseLogicBlock(`\${ @count = 0 }`);
    const decl = nodes.find(n => n.kind === "state-decl" && n.name === "count");
    expect(decl).toBeDefined();
    expect(decl.name).toBe("count");
    expect(decl.init).toContain("0");
  });
});

// ---------------------------------------------------------------------------
// §5: Multiple @shared and non-shared declarations
//
// NOTE: scrml merges multiple statements in a SINGLE ${}  block into the first
// node's init string (compound reactive-decl). To test independent declarations,
// use SEPARATE ${}  blocks. This is documented behavior in reactive-arrays.test.js.
// ---------------------------------------------------------------------------

describe("shared-tab §5: @shared and non-shared declarations in separate blocks", () => {
  test("@shared title and non-shared @count in separate blocks parse correctly", () => {
    // Use separate ${} blocks to avoid compound reactive-decl merging
    const { ast } = parseSource(`<div>\${ @shared title = "hello" }\${ @count = 0 }</div>`);
    const decls = findReactiveDecls(ast);
    const shared = decls.find(n => n.name === "title");
    const nonShared = decls.find(n => n.name === "count");
    expect(shared).toBeDefined();
    expect(shared.isShared).toBe(true);
    expect(nonShared).toBeDefined();
    expect(nonShared.isShared).toBeUndefined();
  });

  test("two @shared vars in separate blocks both get isShared: true", () => {
    const { ast } = parseSource(`<div>\${ @shared title = "hello" }\${ @shared count = 0 }</div>`);
    const decls = findReactiveDecls(ast);
    const sharedDecls = decls.filter(n => n.isShared === true);
    const names = sharedDecls.map(n => n.name);
    expect(names).toContain("title");
    expect(names).toContain("count");
  });

  test("@shared does not contaminate adjacent non-shared declaration in separate block", () => {
    const { ast } = parseSource(`<div>\${ @shared title = "hello" }\${ @visible = true }</div>`);
    const decls = findReactiveDecls(ast);
    const visible = decls.find(n => n.name === "visible");
    expect(visible).toBeDefined();
    expect(visible.isShared).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// §6: @shared with string initializer
// ---------------------------------------------------------------------------

describe("shared-tab §6: @shared with string init → isShared: true", () => {
  test("@shared title = 'hello' → isShared: true, name: 'title'", () => {
    const nodes = parseLogicBlock(`\${ @shared title = "hello" }`);
    const decl = nodes.find(n => n.kind === "state-decl" && n.isShared === true);
    expect(decl).toBeDefined();
    expect(decl.name).toBe("title");
  });

  test("@shared title = 'hello' → init contains the string value", () => {
    const nodes = parseLogicBlock(`\${ @shared title = "hello" }`);
    const decl = nodes.find(n => n.kind === "state-decl" && n.isShared === true);
    expect(decl).toBeDefined();
    expect(decl.init).toContain("hello");
  });
});

// ---------------------------------------------------------------------------
// §7: Integration — full pipeline: <channel> + @shared → extractSharedVars
// ---------------------------------------------------------------------------

describe("shared-tab §7: integration — <channel> with @shared → extractSharedVars", () => {
  test("extractSharedVars returns ['count'] when @shared count = 0 is in channel body", () => {
    const source = `<program>
<div>
<channel name="chat">
\${ @shared count = 0 }
</>
</>
</>`;
    const { ast } = parseSource(source);
    const channelNode = findChannel(ast.nodes);
    expect(channelNode).toBeDefined();
    const sharedVars = extractSharedVars(channelNode);
    expect(sharedVars).toContain("count");
  });

  test("extractSharedVars returns [] when channel has only non-shared @vars", () => {
    const source = `<program>
<div>
<channel name="chat">
\${ @count = 0 }
</>
</>
</>`;
    const { ast } = parseSource(source);
    const channelNode = findChannel(ast.nodes);
    expect(channelNode).toBeDefined();
    const sharedVars = extractSharedVars(channelNode);
    expect(sharedVars).toHaveLength(0);
  });

  test("reactive-decl in channel body has isShared: true after full parse", () => {
    const source = `<program>
<div>
<channel name="chat">
\${ @shared count = 0 }
</>
</>
</>`;
    const { ast } = parseSource(source);
    const decls = findAll(ast.nodes, n => n.kind === "state-decl" && n.isShared === true);
    expect(decls.length).toBeGreaterThan(0);
    expect(decls[0].name).toBe("count");
  });

  test("emitChannelClientJs emits sync infrastructure when @shared var parsed from source", () => {
    const source = `<program>
<div>
<channel name="chat">
\${ @shared count = 0 }
</>
</>
</>`;
    const { ast } = parseSource(source);
    const channelNode = findChannel(ast.nodes);
    expect(channelNode).toBeDefined();
    const errors = [];
    const lines = emitChannelClientJs(channelNode, errors, "/test/app.scrml");
    const code = lines.join("\n");
    // The sync infrastructure (syncShared helper + __sync message + subscription)
    // should be present because isShared: true is now set by the TAB parser
    expect(code).toContain("syncShared");
    expect(code).toContain("__sync");
    expect(code).toContain("count");
  });

  test("multiple @shared vars in channel body all appear in extractSharedVars", () => {
    const source = `<program>
<div>
<channel name="chat">
\${ @shared count = 0 }
\${ @shared title = "hello" }
</>
</>
</>`;
    const { ast } = parseSource(source);
    const channelNode = findChannel(ast.nodes);
    expect(channelNode).toBeDefined();
    const sharedVars = extractSharedVars(channelNode);
    expect(sharedVars).toContain("count");
    expect(sharedVars).toContain("title");
  });
});

// ---------------------------------------------------------------------------
// §8: @shared outside channel — TAB is context-free for this modifier
// ---------------------------------------------------------------------------

describe("shared-tab §8: @shared in non-channel context → reactive-decl isShared: true", () => {
  test("@shared in plain div logic block → reactive-decl with isShared: true", () => {
    // The compiler does not enforce E-CHANNEL-002 at TAB stage (parse-time).
    // E-CHANNEL-002 is a codegen-time check. The AST builder always produces
    // isShared: true for any @shared decl, regardless of enclosing context.
    const nodes = parseLogicBlock(`\${ @shared msg = "hi" }`);
    const decl = nodes.find(n => n.kind === "state-decl" && n.isShared === true);
    expect(decl).toBeDefined();
    expect(decl.name).toBe("msg");
  });
});
