/**
 * §52.6 Compiler-Generated Sync Infrastructure — sync-codegen tests
 *
 * Tests for emit-sync.ts (emitInitialLoad, emitOptimisticUpdate, emitServerSyncStub)
 * and the wiring in emit-reactive-wiring.ts (Step 4b).
 *
 * Coverage:
 *   SC1  server @cards = loadCards() → client JS contains async IIFE with loadCards
 *   SC2  server @cards = loadCards() → client JS contains _scrml_reactive_subscribe for @cards
 *   SC3  server @count = 0 (literal init) → no async IIFE in client JS
 *   SC4  regular @var = expr → no sync infrastructure
 *   SC5  optimistic update subscriber contains try/catch with rollback
 *   SC6  _scrml_server_sync_cards stub function is emitted
 */

import { describe, test, expect } from "bun:test";
import { runCG } from "../../src/code-generator.js";

// ---------------------------------------------------------------------------
// Helpers (adapted from server-reactive-refs.test.js pattern)
// ---------------------------------------------------------------------------

function span(start, file = "/test/app.scrml") {
  return { file, start, end: start + 10, line: 1, col: start + 1 };
}

function makeFileAST(filePath, nodes, opts = {}) {
  return {
    filePath,
    nodes,
    imports: opts.imports ?? [],
    exports: opts.exports ?? [],
    components: opts.components ?? [],
    typeDecls: opts.typeDecls ?? [],
    nodeTypes: opts.nodeTypes ?? new Map(),
    componentShapes: opts.componentShapes ?? new Map(),
    scopeChain: opts.scopeChain ?? null,
  };
}

function makeLogicBlock(body = [], s = span(0)) {
  return { kind: "logic", body, span: s };
}

/** Create a plain reactive-decl (no server modifier). */
function makeReactiveDecl(name, init, s = span(0)) {
  return { kind: "state-decl", name, init, span: s };
}

/** Create a server @var reactive-decl (isServer: true). */
function makeServerReactiveDecl(name, init, s = span(0)) {
  return { kind: "state-decl", name, init, isServer: true, span: s };
}

function makeRouteMap(entries = []) {
  const functions = new Map();
  for (const e of entries) {
    functions.set(e.functionNodeId, e);
  }
  return { functions };
}

function makeDepGraph() {
  return { nodes: new Map(), edges: [] };
}

function makeProtectAnalysis() {
  return { views: new Map() };
}

function runCGForFile(nodes, opts = {}) {
  const ast = makeFileAST("/test/app.scrml", nodes, opts);
  return runCG({
    files: [ast],
    routeMap: makeRouteMap(),
    depGraph: makeDepGraph(),
    protectAnalysis: makeProtectAnalysis(),
    embedRuntime: true,
  });
}

function getClientJs(nodes, opts = {}) {
  const result = runCGForFile(nodes, opts);
  return result.outputs.get("/test/app.scrml")?.clientJs ?? "";
}

// ---------------------------------------------------------------------------
// SC1: server @cards = loadCards() → async IIFE with loadCards in client JS
// ---------------------------------------------------------------------------

describe("SC1: initial load — server @var with function call init", () => {
  test("emits async IIFE that calls the load function", () => {
    const decl = makeServerReactiveDecl("cards", "loadCards()", span(10));
    const clientJs = getClientJs([makeLogicBlock([decl])]);

    // Should contain an async IIFE for the initial load
    expect(clientJs).toContain("(async () => {");
    // Should await the load function
    expect(clientJs).toContain("await (loadCards())");
    // Should set the reactive variable
    expect(clientJs).toContain('_scrml_reactive_set("cards"');
  });

  test("initial load section comment is present", () => {
    const decl = makeServerReactiveDecl("cards", "loadCards()", span(10));
    const clientJs = getClientJs([makeLogicBlock([decl])]);

    expect(clientJs).toContain("server @cards");
    expect(clientJs).toContain("§52.6.1");
  });
});

// ---------------------------------------------------------------------------
// SC2: server @cards = loadCards() → optimistic update subscriber
// ---------------------------------------------------------------------------

describe("SC2: optimistic update — server @var has reactive subscriber", () => {
  test("emits _scrml_reactive_subscribe for the server var", () => {
    const decl = makeServerReactiveDecl("cards", "loadCards()", span(10));
    const clientJs = getClientJs([makeLogicBlock([decl])]);

    expect(clientJs).toContain('_scrml_reactive_subscribe("cards"');
  });

  test("subscriber is async", () => {
    const decl = makeServerReactiveDecl("cards", "loadCards()", span(10));
    const clientJs = getClientJs([makeLogicBlock([decl])]);

    // The subscriber function must be async for the await server sync call
    expect(clientJs).toContain("async function");
  });
});

// ---------------------------------------------------------------------------
// SC3: server @count = 0 → literal init, no async IIFE
// ---------------------------------------------------------------------------

describe("SC3: literal init — no initial load IIFE", () => {
  test("no async IIFE when init has no function call", () => {
    const decl = makeServerReactiveDecl("count", "0", span(10));
    const clientJs = getClientJs([makeLogicBlock([decl])]);

    // The type system emits W-AUTH-001 for this case.
    // The codegen should NOT emit an initial load IIFE.
    expect(clientJs).not.toContain("(async () => {");
  });

  test("optimistic update subscriber still emitted for literal init vars", () => {
    // Even with a literal init (no load fn), the optimistic update subscriber
    // must be present to handle future assignments.
    const decl = makeServerReactiveDecl("count", "0", span(10));
    const clientJs = getClientJs([makeLogicBlock([decl])]);

    expect(clientJs).toContain('_scrml_reactive_subscribe("count"');
  });
});

// ---------------------------------------------------------------------------
// SC4: regular @var = expr → no sync infrastructure
// ---------------------------------------------------------------------------

describe("SC4: no sync for regular reactive vars", () => {
  test("regular @var emits no async IIFE", () => {
    const decl = makeReactiveDecl("count", "0", span(10));
    const clientJs = getClientJs([makeLogicBlock([decl])]);

    expect(clientJs).not.toContain("(async () => {");
  });

  test("regular @var emits no server sync subscribe", () => {
    const decl = makeReactiveDecl("count", "0", span(10));
    const clientJs = getClientJs([makeLogicBlock([decl])]);

    // Check for the generated call site with the specific variable name.
    // The runtime defines _scrml_reactive_subscribe as a function, but only
    // generated sync code will call it with "count" as an argument.
    expect(clientJs).not.toContain('_scrml_reactive_subscribe("count"');
  });

  test("regular @var emits no server sync stub", () => {
    const decl = makeReactiveDecl("count", "0", span(10));
    const clientJs = getClientJs([makeLogicBlock([decl])]);

    expect(clientJs).not.toContain("_scrml_server_sync_");
  });
});

// ---------------------------------------------------------------------------
// SC5: optimistic update contains try/catch with rollback
// ---------------------------------------------------------------------------

describe("SC5: rollback on error — try/catch in subscriber", () => {
  test("subscriber has try block", () => {
    const decl = makeServerReactiveDecl("cards", "loadCards()", span(10));
    const clientJs = getClientJs([makeLogicBlock([decl])]);

    expect(clientJs).toContain("try {");
  });

  test("subscriber has catch block with rollback", () => {
    const decl = makeServerReactiveDecl("cards", "loadCards()", span(10));
    const clientJs = getClientJs([makeLogicBlock([decl])]);

    expect(clientJs).toContain("} catch (_e) {");
  });

  test("rollback sets reactive var to previous value", () => {
    const decl = makeServerReactiveDecl("cards", "loadCards()", span(10));
    const clientJs = getClientJs([makeLogicBlock([decl])]);

    // The rollback must restore _scrml_prev_cards
    expect(clientJs).toContain("_scrml_prev_cards");
    expect(clientJs).toContain("_scrml_reactive_set");
  });
});

// ---------------------------------------------------------------------------
// SC6: server sync stub is emitted
// ---------------------------------------------------------------------------

describe("SC6: server sync stub function", () => {
  test("stub function is emitted for server var", () => {
    const decl = makeServerReactiveDecl("cards", "loadCards()", span(10));
    const clientJs = getClientJs([makeLogicBlock([decl])]);

    expect(clientJs).toContain("async function _scrml_server_sync_cards");
  });

  test("stub contains route path comment", () => {
    const decl = makeServerReactiveDecl("cards", "loadCards()", span(10));
    const clientJs = getClientJs([makeLogicBlock([decl])]);

    expect(clientJs).toContain("/_scrml/sync/cards");
  });

  test("stub has TODO comment for follow-up", () => {
    const decl = makeServerReactiveDecl("cards", "loadCards()", span(10));
    const clientJs = getClientJs([makeLogicBlock([decl])]);

    expect(clientJs).toContain("TODO");
  });
});

// ---------------------------------------------------------------------------
// Multiple server vars in same file
// ---------------------------------------------------------------------------

describe("multiple server @vars in same file", () => {
  test("each server var gets its own sync infrastructure", () => {
    const decl1 = makeServerReactiveDecl("cards", "loadCards()", span(10));
    const decl2 = makeServerReactiveDecl("users", "loadUsers()", span(20));
    const clientJs = getClientJs([makeLogicBlock([decl1, decl2])]);

    expect(clientJs).toContain("async function _scrml_server_sync_cards");
    expect(clientJs).toContain("async function _scrml_server_sync_users");
    expect(clientJs).toContain('_scrml_reactive_subscribe("cards"');
    expect(clientJs).toContain('_scrml_reactive_subscribe("users"');
  });
});

// ---------------------------------------------------------------------------
// Regression: section header comment is emitted
// ---------------------------------------------------------------------------

describe("section header comment", () => {
  test("server @var sync section comment is emitted", () => {
    const decl = makeServerReactiveDecl("cards", "loadCards()", span(10));
    const clientJs = getClientJs([makeLogicBlock([decl])]);

    expect(clientJs).toContain("server @var sync infrastructure");
  });
});
