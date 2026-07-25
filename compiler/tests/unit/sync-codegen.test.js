/**
 * §52.6 Compiler-Generated Sync Infrastructure — sync-codegen tests
 *
 * Tests for emit-sync.ts (emitInitialLoad, emitUnifiedMountHydrate) and the
 * wiring in emit-reactive-wiring.ts (Step 4c).
 *
 * §52 is a READ-authority layer (Q1=C, ratified 2026-06-14): the compiler emits
 * the initial-load path only. There is NO optimistic subscriber and NO
 * `_scrml_server_sync_<var>` stub — the WRITE is the developer's own `?{}`
 * server fn (§52.6.2 / §52.6.6).
 *
 * Coverage:
 *   SC1  server @cards = loadCards() → client JS contains async IIFE with loadCards
 *   SC2  server @cards = loadCards() → client JS contains NO optimistic subscriber
 *   SC3  server @count = 0 (literal init) → no async IIFE, no sync artefacts
 *   SC4  regular @var = expr → no sync infrastructure
 *   SC5  no try/catch rollback subscriber (auto-rollback retracted)
 *   SC6  no `_scrml_server_sync_` stub (auto-persist retracted)
 */

import { describe, test, expect } from "bun:test";
import { runCG } from "../../src/code-generator.js";
import { foldChunkNamespacing } from "../helpers/chunk-scope.js";

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

/** Create a plain state-decl (no server modifier). */
function makeReactiveDecl(name, init, s = span(0)) {
  return { kind: "state-decl", name, init, span: s };
}

/** Create a server @var state-decl (isServer: true). */
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
    const clientJs =foldChunkNamespacing( foldChunkNamespacing(getClientJs([makeLogicBlock([decl])])));

    // Should contain an async IIFE for the initial load
    expect(clientJs).toContain("(async () => {");
    // Should await the load function
    expect(clientJs).toContain("await (loadCards())");
    // Should set the reactive variable
    expect(clientJs).toContain('_scrml_reactive_set("cards"');
  });

  test("initial load section comment is present", () => {
    const decl = makeServerReactiveDecl("cards", "loadCards()", span(10));
    const clientJs =foldChunkNamespacing( foldChunkNamespacing(getClientJs([makeLogicBlock([decl])])));

    expect(clientJs).toContain("<cards server>");
    expect(clientJs).toContain("§52.6.1");
  });
});

// ---------------------------------------------------------------------------
// SC2: server @cards = loadCards() → optimistic update subscriber
// ---------------------------------------------------------------------------

describe("SC2: no optimistic subscriber — auto-persist retracted (Q1=C)", () => {
  test("does NOT emit a _scrml_reactive_subscribe for the server var write path", () => {
    const decl = makeServerReactiveDecl("cards", "loadCards()", span(10));
    const clientJs =foldChunkNamespacing( foldChunkNamespacing(getClientJs([makeLogicBlock([decl])])));

    expect(clientJs).not.toContain('_scrml_reactive_subscribe("cards"');
  });

  test("does NOT emit a _scrml_server_sync_ stub for the server var", () => {
    const decl = makeServerReactiveDecl("cards", "loadCards()", span(10));
    const clientJs =foldChunkNamespacing( foldChunkNamespacing(getClientJs([makeLogicBlock([decl])])));

    expect(clientJs).not.toContain("_scrml_server_sync_cards");
  });
});

// ---------------------------------------------------------------------------
// SC3: server @count = 0 → literal init, no async IIFE
// ---------------------------------------------------------------------------

describe("SC3: literal init — no initial load IIFE", () => {
  test("no async IIFE when init has no function call", () => {
    const decl = makeServerReactiveDecl("count", "0", span(10));
    const clientJs =foldChunkNamespacing( foldChunkNamespacing(getClientJs([makeLogicBlock([decl])])));

    // The type system emits W-AUTH-001 for this case.
    // The codegen should NOT emit an initial load IIFE.
    expect(clientJs).not.toContain("(async () => {");
  });

  test("literal init emits no sync artefacts at all (no subscriber, no stub)", () => {
    // Under Q1=C the write path is the dev's ?{} server fn; the compiler emits
    // neither an optimistic subscriber nor a _scrml_server_sync_ stub.
    const decl = makeServerReactiveDecl("count", "0", span(10));
    const clientJs =foldChunkNamespacing( foldChunkNamespacing(getClientJs([makeLogicBlock([decl])])));

    expect(clientJs).not.toContain('_scrml_reactive_subscribe("count"');
    expect(clientJs).not.toContain("_scrml_server_sync_count");
  });
});

// ---------------------------------------------------------------------------
// SC4: regular @var = expr → no sync infrastructure
// ---------------------------------------------------------------------------

describe("SC4: no sync for regular reactive vars", () => {
  test("regular @var emits no async IIFE", () => {
    const decl = makeReactiveDecl("count", "0", span(10));
    const clientJs =foldChunkNamespacing( foldChunkNamespacing(getClientJs([makeLogicBlock([decl])])));

    expect(clientJs).not.toContain("(async () => {");
  });

  test("regular @var emits no server sync subscribe", () => {
    const decl = makeReactiveDecl("count", "0", span(10));
    const clientJs =foldChunkNamespacing( foldChunkNamespacing(getClientJs([makeLogicBlock([decl])])));

    // Check for the generated call site with the specific variable name.
    // The runtime defines _scrml_reactive_subscribe as a function, but only
    // generated sync code will call it with "count" as an argument.
    expect(clientJs).not.toContain('_scrml_reactive_subscribe("count"');
  });

  test("regular @var emits no server sync stub", () => {
    const decl = makeReactiveDecl("count", "0", span(10));
    const clientJs =foldChunkNamespacing( foldChunkNamespacing(getClientJs([makeLogicBlock([decl])])));

    expect(clientJs).not.toContain("_scrml_server_sync_");
  });
});

// ---------------------------------------------------------------------------
// SC5: optimistic update contains try/catch with rollback
// ---------------------------------------------------------------------------

describe("SC5: no auto-rollback subscriber — auto-rollback retracted (Q1=C)", () => {
  test("emits no _scrml_prev_<var> rollback-tracking variable", () => {
    const decl = makeServerReactiveDecl("cards", "loadCards()", span(10));
    const clientJs =foldChunkNamespacing( foldChunkNamespacing(getClientJs([makeLogicBlock([decl])])));

    expect(clientJs).not.toContain("_scrml_prev_cards");
    expect(clientJs).not.toContain("_scrml_rollback_cards");
  });

  test("the READ (load) path still sets the reactive var on mount", () => {
    const decl = makeServerReactiveDecl("cards", "loadCards()", span(10));
    const clientJs =foldChunkNamespacing( foldChunkNamespacing(getClientJs([makeLogicBlock([decl])])));

    // The load IIFE remains: it sets @cards from loadCards() on mount.
    expect(clientJs).toContain('_scrml_reactive_set("cards"');
  });
});

// ---------------------------------------------------------------------------
// SC6: server sync stub is emitted
// ---------------------------------------------------------------------------

describe("SC6: no server sync stub — auto-persist retracted (Q1=C)", () => {
  test("emits no _scrml_server_sync_<var> stub function", () => {
    const decl = makeServerReactiveDecl("cards", "loadCards()", span(10));
    const clientJs =foldChunkNamespacing( foldChunkNamespacing(getClientJs([makeLogicBlock([decl])])));

    expect(clientJs).not.toContain("_scrml_server_sync_cards");
  });

  test("emits no /_scrml/sync/ route path stub comment", () => {
    const decl = makeServerReactiveDecl("cards", "loadCards()", span(10));
    const clientJs =foldChunkNamespacing( foldChunkNamespacing(getClientJs([makeLogicBlock([decl])])));

    expect(clientJs).not.toContain("/_scrml/sync/cards");
  });

  test("emits no 'server sync stub' console.warn no-op", () => {
    const decl = makeServerReactiveDecl("cards", "loadCards()", span(10));
    const clientJs =foldChunkNamespacing( foldChunkNamespacing(getClientJs([makeLogicBlock([decl])])));

    expect(clientJs).not.toContain("server sync stub");
  });
});

// ---------------------------------------------------------------------------
// Multiple server vars in same file
// ---------------------------------------------------------------------------

describe("multiple server @vars in same file", () => {
  test("each server var gets its own READ (load) path, none gets a write stub", () => {
    const decl1 = makeServerReactiveDecl("cards", "loadCards()", span(10));
    const decl2 = makeServerReactiveDecl("users", "loadUsers()", span(20));
    const clientJs =foldChunkNamespacing( foldChunkNamespacing(getClientJs([makeLogicBlock([decl1, decl2])])));

    // Note: with 2 callable server vars, §8.11 coalesces the loads into one
    // /__mountHydrate fetch — so the per-var reactive_set is via _scrml_mh_json.
    expect(clientJs).toContain('_scrml_reactive_set("cards"');
    expect(clientJs).toContain('_scrml_reactive_set("users"');
    expect(clientJs).not.toContain("_scrml_server_sync_cards");
    expect(clientJs).not.toContain("_scrml_server_sync_users");
    expect(clientJs).not.toContain('_scrml_reactive_subscribe("cards"');
    expect(clientJs).not.toContain('_scrml_reactive_subscribe("users"');
  });
});

// ---------------------------------------------------------------------------
// Regression: section header comment is emitted
// ---------------------------------------------------------------------------

describe("section header comment", () => {
  test("<var server> read-authority sync section comment is emitted", () => {
    const decl = makeServerReactiveDecl("cards", "loadCards()", span(10));
    const clientJs =foldChunkNamespacing( foldChunkNamespacing(getClientJs([makeLogicBlock([decl])])));

    expect(clientJs).toContain("<var server> read-authority sync");
  });
});
