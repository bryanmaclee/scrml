/**
 * State Authority — AST Parsing (§52.4)
 *
 * Tests for `server @var` reactive declaration modifier in the AST builder
 * (TAB stage). The `server` modifier marks an instance-level reactive variable
 * as server-authoritative.
 *
 * §1  AST: `server @cards = []` → reactive-decl with isServer: true, name: 'cards'
 * §2  AST: `server @count = 0` → reactive-decl with isServer: true, name: 'count', init: '0'
 * §3  AST: `@cards = []` (no server) → reactive-decl WITHOUT isServer (backward compat)
 * §4  AST: `server @data = loadData()` with function call init → isServer: true, init has 'loadData'
 * §5  AST: `server @var` inside a logic body block (parseLogicBody block-loop path)
 * §6  AST: `server @count` in separate logic blocks mixed with non-server vars
 * §7  Regression: `server function` still parses as function-decl (no regression)
 * §8  Regression: `server fn` still parses as function-decl (no regression)
 * §9  AST: `server` without AT_IDENT next (falls through — not consumed as authority modifier)
 *
 * NOTE on multi-statement blocks: scrml merges multiple statements in a single ${}
 * block into the first node's init string (compound reactive-decl). For tests with
 * multiple distinct declarations, use separate ${} blocks.
 */

import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";

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
 * Uses parseOneStatement path (single-statement returns).
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

function findFunctionDecls(ast) {
  return findAll(ast.nodes, n => n.kind === "function-decl");
}

// ---------------------------------------------------------------------------
// §1: server @cards = [] → reactive-decl with isServer: true, name: 'cards'
// ---------------------------------------------------------------------------

describe("state-authority §1: server @cards = [] → reactive-decl isServer: true", () => {
  test("produces a reactive-decl node", () => {
    const nodes = parseLogicBlock(`\${ server @cards = [] }`);
    const decl = nodes.find(n => n.kind === "state-decl");
    expect(decl).toBeDefined();
  });

  test("reactive-decl has isServer: true", () => {
    const nodes = parseLogicBlock(`\${ server @cards = [] }`);
    const decl = nodes.find(n => n.kind === "state-decl");
    expect(decl).toBeDefined();
    expect(decl.isServer).toBe(true);
  });

  test("reactive-decl name is 'cards' (not 'server')", () => {
    const nodes = parseLogicBlock(`\${ server @cards = [] }`);
    const decl = nodes.find(n => n.kind === "state-decl" && n.isServer === true);
    expect(decl).toBeDefined();
    expect(decl.name).toBe("cards");
  });

  test("reactive-decl init contains '[]'", () => {
    const nodes = parseLogicBlock(`\${ server @cards = [] }`);
    const decl = nodes.find(n => n.kind === "state-decl" && n.isServer === true);
    expect(decl).toBeDefined();
    // Tokenizer preserves internal whitespace: "[ ]" not "[]"
    expect(decl.init).toMatch(/\[\s*\]/);
  });
});

// ---------------------------------------------------------------------------
// §2: server @count = 0 → reactive-decl with isServer: true, init: '0'
// ---------------------------------------------------------------------------

describe("state-authority §2: server @count = 0 → reactive-decl isServer: true, init: '0'", () => {
  test("produces reactive-decl with isServer: true", () => {
    const nodes = parseLogicBlock(`\${ server @count = 0 }`);
    const decl = nodes.find(n => n.kind === "state-decl" && n.isServer === true);
    expect(decl).toBeDefined();
  });

  test("name is 'count'", () => {
    const nodes = parseLogicBlock(`\${ server @count = 0 }`);
    const decl = nodes.find(n => n.kind === "state-decl" && n.isServer === true);
    expect(decl).toBeDefined();
    expect(decl.name).toBe("count");
  });

  test("init contains '0'", () => {
    const nodes = parseLogicBlock(`\${ server @count = 0 }`);
    const decl = nodes.find(n => n.kind === "state-decl" && n.isServer === true);
    expect(decl).toBeDefined();
    expect(decl.init).toContain("0");
  });
});

// ---------------------------------------------------------------------------
// §3: @cards = [] (no server) → reactive-decl WITHOUT isServer (backward compat)
// ---------------------------------------------------------------------------

describe("state-authority §3: @cards = [] → reactive-decl WITHOUT isServer (backward compat)", () => {
  test("regular reactive-decl has no isServer property", () => {
    const nodes = parseLogicBlock(`\${ @cards = [] }`);
    const decl = nodes.find(n => n.kind === "state-decl" && n.name === "cards");
    expect(decl).toBeDefined();
    expect(decl.isServer).toBeUndefined();
  });

  test("regular reactive-decl name and init are correct", () => {
    const nodes = parseLogicBlock(`\${ @count = 0 }`);
    const decl = nodes.find(n => n.kind === "state-decl" && n.name === "count");
    expect(decl).toBeDefined();
    expect(decl.name).toBe("count");
    expect(decl.init).toContain("0");
  });

  test("regular reactive-decl does not have isServer: true", () => {
    const nodes = parseLogicBlock(`\${ @data = [] }`);
    const decl = nodes.find(n => n.kind === "state-decl");
    expect(decl).toBeDefined();
    expect(decl.isServer).not.toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §4: server @data = loadData() — function call init
// ---------------------------------------------------------------------------

describe("state-authority §4: server @data = loadData() → isServer: true, init has 'loadData'", () => {
  test("reactive-decl has isServer: true", () => {
    const nodes = parseLogicBlock(`\${ server @data = loadData() }`);
    const decl = nodes.find(n => n.kind === "state-decl" && n.isServer === true);
    expect(decl).toBeDefined();
  });

  test("name is 'data'", () => {
    const nodes = parseLogicBlock(`\${ server @data = loadData() }`);
    const decl = nodes.find(n => n.kind === "state-decl" && n.isServer === true);
    expect(decl).toBeDefined();
    expect(decl.name).toBe("data");
  });

  test("init contains 'loadData'", () => {
    const nodes = parseLogicBlock(`\${ server @data = loadData() }`);
    const decl = nodes.find(n => n.kind === "state-decl" && n.isServer === true);
    expect(decl).toBeDefined();
    expect(decl.init).toContain("loadData");
  });
});

// ---------------------------------------------------------------------------
// §5: server @var inside a logic body block (block-loop path)
//
// The parseLogicBody() while(true) loop is a second parsing path that also
// needs server @var support. This test verifies the block-loop path.
// ---------------------------------------------------------------------------

describe("state-authority §5: server @var in logic body (block-loop parseLogicBody path)", () => {
  test("server @cards = [] in program-level logic block → isServer: true", () => {
    const source = `<program>
\${ server @cards = [] }
</>`;
    const { ast } = parseSource(source);
    const decls = findReactiveDecls(ast);
    const decl = decls.find(n => n.name === "cards");
    expect(decl).toBeDefined();
    expect(decl.isServer).toBe(true);
  });

  test("server @count = 0 in program-level logic block → name: 'count', isServer: true", () => {
    const source = `<program>
\${ server @count = 0 }
</>`;
    const { ast } = parseSource(source);
    const decls = findReactiveDecls(ast);
    const decl = decls.find(n => n.name === "count");
    expect(decl).toBeDefined();
    expect(decl.isServer).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §6: Mixed server and non-server vars in separate logic blocks
// ---------------------------------------------------------------------------

describe("state-authority §6: server @var and non-server @var in separate blocks", () => {
  test("server @cards and non-server @editingId parsed in separate blocks", () => {
    const { ast } = parseSource(`<div>\${ server @cards = [] }\${ @editingId = null }</div>`);
    const decls = findReactiveDecls(ast);
    const serverDecl = decls.find(n => n.name === "cards");
    const localDecl = decls.find(n => n.name === "editingId");
    expect(serverDecl).toBeDefined();
    expect(serverDecl.isServer).toBe(true);
    expect(localDecl).toBeDefined();
    expect(localDecl.isServer).toBeUndefined();
  });

  test("two server @vars in separate blocks both get isServer: true", () => {
    const { ast } = parseSource(`<div>\${ server @cards = [] }\${ server @count = 0 }</div>`);
    const decls = findReactiveDecls(ast);
    const serverDecls = decls.filter(n => n.isServer === true);
    const names = serverDecls.map(n => n.name);
    expect(names).toContain("cards");
    expect(names).toContain("count");
  });

  test("server @var does not contaminate adjacent non-server declaration", () => {
    const { ast } = parseSource(`<div>\${ server @cards = [] }\${ @visible = true }</div>`);
    const decls = findReactiveDecls(ast);
    const visible = decls.find(n => n.name === "visible");
    expect(visible).toBeDefined();
    expect(visible.isServer).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// §7: Regression — `server function` still parses as function-decl (no regression)
// ---------------------------------------------------------------------------

describe("state-authority §7: regression — server function not affected by server @var handler", () => {
  test("server function getData() parses as function-decl with isServer: true", () => {
    const source = `<program>
\${ server function getData() { return [] } }
</>`;
    const { ast } = parseSource(source);
    const fnDecls = findFunctionDecls(ast);
    const fn = fnDecls.find(n => n.name === "getData");
    expect(fn).toBeDefined();
    expect(fn.kind).toBe("function-decl");
    expect(fn.isServer).toBe(true);
  });

  test("server function returns function-decl, NOT reactive-decl", () => {
    const source = `<program>
\${ server function save() { return true } }
</>`;
    const { ast } = parseSource(source);
    const fnDecls = findFunctionDecls(ast);
    const fn = fnDecls.find(n => n.name === "save");
    expect(fn).toBeDefined();
    expect(fn.kind).toBe("function-decl");
    // No reactive-decl for "save" should exist
    const allDecls = findReactiveDecls(ast);
    const wrongDecl = allDecls.find(n => n.name === "save");
    expect(wrongDecl).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// §8: Regression — `server fn` still parses correctly (no regression)
// ---------------------------------------------------------------------------

describe("state-authority §8: regression — server fn not affected by server @var handler", () => {
  test("server fn getData parses as function-decl with isServer: true", () => {
    const source = `<program>
\${ server fn getData { return [] } }
</>`;
    const { ast } = parseSource(source);
    const fnDecls = findFunctionDecls(ast);
    const fn = fnDecls.find(n => n.name === "getData");
    expect(fn).toBeDefined();
    expect(fn.kind).toBe("function-decl");
    expect(fn.isServer).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §9: server followed by non-AT_IDENT — falls through, not consumed as authority modifier
// ---------------------------------------------------------------------------

describe("state-authority §9: server without AT_IDENT next — not consumed as authority modifier", () => {
  test("server function still works when adjacent to server @var declarations", () => {
    // Both server function and server @var in the same program — no conflict
    const source = `<program>
\${ server @cards = [] }
\${ server function loadCards() { return [] } }
</>`;
    const { ast } = parseSource(source);
    const decls = findReactiveDecls(ast);
    const fnDecls = findFunctionDecls(ast);
    const serverDecl = decls.find(n => n.name === "cards");
    const serverFn = fnDecls.find(n => n.name === "loadCards");
    expect(serverDecl).toBeDefined();
    expect(serverDecl.isServer).toBe(true);
    expect(serverFn).toBeDefined();
    expect(serverFn.kind).toBe("function-decl");
    expect(serverFn.isServer).toBe(true);
  });

  test("server @userProfile = not → reactive-decl with isServer: true (§52.4.3 — not placeholder)", () => {
    // `not` as initial value is valid per §52.4.3
    const nodes = parseLogicBlock(`\${ server @userProfile = not }`);
    const decl = nodes.find(n => n.kind === "state-decl" && n.isServer === true);
    expect(decl).toBeDefined();
    expect(decl.name).toBe("userProfile");
    // init should contain "not"
    expect(decl.init).toContain("not");
  });
});
