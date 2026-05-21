/**
 * Ext 1 M1.5 — multi-stub emit + client-wrapper multi-await.
 *
 * Verifies the codegen surface for multi-batch CPS (SPEC §19.9; Ext 1):
 *
 *   emit-server.ts — a multi-batch CPS route emits `serverBatches.length`
 *   route handlers, each `_scrml_..._batch_<i>` at `<path>__batch_<i>`. Each
 *   stub gets its own Ext 4 `!`-wrap; each NON-MONOTONE stub gets its own
 *   Ext 5 idempotency-key dedup middleware (gated on the per-batch verdict M1.4
 *   populated — monotone batches in a mixed function skip the dedup layer).
 *
 *   emit-functions.ts — the CPS client wrapper emits N `await`s in the
 *   planner's topological order, interleaving the client statements; each
 *   await sits in its own try/catch producing a tagged `__scrml_error`
 *   envelope that names the failing batch index.
 *
 * Test categories (per EXT-1-IMPL-BRIEF.md §M1.5 + scope-dive §B.5):
 *   - two-batch emit (N=2 stubs; wrapper sequences two awaits)
 *   - three-batch emit
 *   - mixed-monotonicity per-batch gating (only non-monotone batch gets the key)
 *   - per-batch error-envelope (envelope carries the correct batch index + fn)
 *   - cross-batch parameter forwarding (prior batch result rides as a param)
 *   - single-batch back-compat (one stub / one await — pre-Ext-1 shape)
 *
 * Soundness (body-split DD §B.5): per-batch atomicity preserved (each emitted
 * stub = one server request = one §8.9 transactional envelope); per-batch
 * try/catch catches each batch's failure independently; earlier-batch commits
 * stand on later-batch failure (predecessor Q3 / §19.6.7). CLEAN at S1-S5.
 */

import { describe, test, expect } from "bun:test";
import { runCG } from "../../src/code-generator.js";

// ---------------------------------------------------------------------------
// Helpers (mirror a9-ext4-cps-failable-wiring.test.js)
// ---------------------------------------------------------------------------

function span(start, file = "/test/app.scrml") {
  return { file, start, end: start + 10, line: 1, col: start + 1 };
}

function makeFileAST(filePath, nodes) {
  return {
    filePath,
    nodes,
    imports: [],
    exports: [],
    components: [],
    typeDecls: [],
    nodeTypes: new Map(),
    componentShapes: new Map(),
    scopeChain: null,
  };
}

function makeLogicBlock(body = [], s = span(0)) {
  return { kind: "logic", body, span: s };
}

function makeFunctionDecl(name, body = [], params = [], opts = {}) {
  return {
    kind: "function-decl",
    name,
    params,
    body,
    span: opts.span ?? span(opts.spanStart ?? 0),
    isServer: opts.isServer ?? true,
  };
}

function makeBareExpr(expr, s = span(0)) {
  return { kind: "bare-expr", expr, span: s };
}

function makeReactiveDecl(name, init, s = span(0)) {
  return { kind: "state-decl", name, init, span: s };
}

function makeRouteMap(entries = []) {
  const functions = new Map();
  for (const e of entries) functions.set(e.functionNodeId, e);
  return { functions };
}

function runCGForFile(nodes, routeMap) {
  const ast = makeFileAST("/test/app.scrml", nodes);
  return runCG({
    files: [ast],
    routeMap,
    depGraph: { nodes: new Map(), edges: [] },
    protectAnalysis: { views: new Map() },
    embedRuntime: true,
  });
}

/**
 * Build a multi-batch CPS server function.
 *
 * `batches` is an array of `{ indices, monotonicity }`. The `body` is the
 * full function body (server + client statements). `returnVarName` is the
 * function's final return cell.
 */
function makeMultiBatchHandler(fnName, body, batches, opts = {}) {
  const fnSpan = span(100);
  const fnNode = makeFunctionDecl(fnName, body, opts.params ?? [], { span: fnSpan });
  const flatServer = [];
  for (const b of batches) for (const i of b.indices) flatServer.push(i);
  flatServer.sort((a, c) => a - c);
  const allIdx = body.map((_, i) => i);
  const clientIdx = allIdx.filter((i) => !flatServer.includes(i));
  const cpsSplit = {
    serverStmtIndices: flatServer,
    clientStmtIndices: clientIdx,
    returnVarName: opts.returnVarName ?? null,
    serverBatches: batches.map((b) => ({
      indices: b.indices,
      monotonicity: b.monotonicity,
      idempotencyTag: "",
    })),
    monotonicity: opts.fnMonotonicity,
    topoOrder: opts.topoOrder ?? allIdx,
  };
  const routeMap = makeRouteMap([{
    functionNodeId: "/test/app.scrml::100",
    boundary: "server",
    escalationReasons: [],
    generatedRouteName: `__ri_route_${fnName}_1`,
    serverEntrySpan: fnSpan,
    cpsSplit,
  }]);
  const result = runCGForFile([makeLogicBlock([fnNode], span(90))], routeMap);
  const out = result.outputs.get("/test/app.scrml") ?? {};
  return { result, serverJs: out.serverJs ?? "", clientJs: out.clientJs ?? "" };
}

/** Single-batch CPS function (pre-Ext-1 back-compat shape). */
function makeSingleBatchHandler(fnName, monotonicity) {
  const body = [makeReactiveDecl("profile", "?{`SELECT * FROM users`}.get()", span(110))];
  return makeMultiBatchHandler(fnName, body, [{ indices: [0], monotonicity }], {
    returnVarName: "profile",
  });
}

/** Count `export const <name>__batch_<i> = {` route exports. */
function countBatchRouteExports(serverJs) {
  const m = serverJs.match(/export const \S+__batch_\d+ = \{/g);
  return m ? m.length : 0;
}

/** Count per-batch `await` occurrences in the client CPS wrapper. */
function countAwaits(clientJs) {
  const m = clientJs.match(/_scrml_batch_\d+_result = await /g);
  return m ? m.length : 0;
}

// A canonical two-batch body: server / client / server.
//   0: server  @users = ?{SELECT ...}.get()
//   1: client  @flag  = true
//   2: server  @orders = ?{SELECT ...}.get()
function twoBatchBody() {
  return [
    makeReactiveDecl("users", "?{`SELECT * FROM users`}.get()", span(110)),
    makeReactiveDecl("flag", "true", span(120)),
    makeReactiveDecl("orders", "?{`SELECT * FROM orders`}.get()", span(130)),
  ];
}

// A canonical three-batch body: server / client / server / client / server.
function threeBatchBody() {
  return [
    makeReactiveDecl("a", "?{`SELECT * FROM a`}.get()", span(110)),
    makeReactiveDecl("c1", "1", span(120)),
    makeReactiveDecl("b", "?{`SELECT * FROM b`}.get()", span(130)),
    makeReactiveDecl("c2", "2", span(140)),
    makeReactiveDecl("c", "?{`SELECT * FROM c`}.get()", span(150)),
  ];
}

// ===========================================================================
// Category 1 — two-batch emit
// ===========================================================================

describe("M1.5 two-batch emit", () => {
  test("F1: emits exactly 2 batch route handlers", () => {
    const { serverJs } = makeMultiBatchHandler(
      "loadData", twoBatchBody(),
      [{ indices: [0], monotonicity: "monotone" }, { indices: [2], monotonicity: "monotone" }],
      { returnVarName: "orders" },
    );
    expect(countBatchRouteExports(serverJs)).toBe(2);
  });

  test("F2: batch route names are _batch_0 and _batch_1", () => {
    const { serverJs } = makeMultiBatchHandler(
      "loadData", twoBatchBody(),
      [{ indices: [0], monotonicity: "monotone" }, { indices: [2], monotonicity: "monotone" }],
      { returnVarName: "orders" },
    );
    expect(serverJs).toContain("__batch_0 = {");
    expect(serverJs).toContain("__batch_1 = {");
  });

  test("F3: batch route paths carry the __batch_<i> suffix", () => {
    const { serverJs } = makeMultiBatchHandler(
      "loadData", twoBatchBody(),
      [{ indices: [0], monotonicity: "monotone" }, { indices: [2], monotonicity: "monotone" }],
      { returnVarName: "orders" },
    );
    expect(serverJs).toMatch(/path:\s*"[^"]*__batch_0"/);
    expect(serverJs).toMatch(/path:\s*"[^"]*__batch_1"/);
  });

  test("F4: client wrapper sequences exactly 2 awaits", () => {
    const { clientJs } = makeMultiBatchHandler(
      "loadData", twoBatchBody(),
      [{ indices: [0], monotonicity: "monotone" }, { indices: [2], monotonicity: "monotone" }],
      { returnVarName: "orders" },
    );
    expect(countAwaits(clientJs)).toBe(2);
  });

  test("F5: client wrapper emits per-batch CPS markers for both batches", () => {
    const { clientJs } = makeMultiBatchHandler(
      "loadData", twoBatchBody(),
      [{ indices: [0], monotonicity: "monotone" }, { indices: [2], monotonicity: "monotone" }],
      { returnVarName: "orders" },
    );
    expect(clientJs).toContain("CPS batch 0");
    expect(clientJs).toContain("CPS batch 1");
  });
});

// ===========================================================================
// Category 2 — three-batch emit
// ===========================================================================

describe("M1.5 three-batch emit", () => {
  const batches = [
    { indices: [0], monotonicity: "monotone" },
    { indices: [2], monotonicity: "monotone" },
    { indices: [4], monotonicity: "monotone" },
  ];

  test("F6: emits exactly 3 batch route handlers", () => {
    const { serverJs } = makeMultiBatchHandler("loadTriple", threeBatchBody(), batches, {
      returnVarName: "c",
    });
    expect(countBatchRouteExports(serverJs)).toBe(3);
  });

  test("F7: batch route names span _batch_0 .. _batch_2", () => {
    const { serverJs } = makeMultiBatchHandler("loadTriple", threeBatchBody(), batches, {
      returnVarName: "c",
    });
    expect(serverJs).toContain("__batch_0 = {");
    expect(serverJs).toContain("__batch_1 = {");
    expect(serverJs).toContain("__batch_2 = {");
  });

  test("F8: client wrapper sequences exactly 3 awaits", () => {
    const { clientJs } = makeMultiBatchHandler("loadTriple", threeBatchBody(), batches, {
      returnVarName: "c",
    });
    expect(countAwaits(clientJs)).toBe(3);
  });

  test("F9: client wrapper emits 3 per-batch CPS markers", () => {
    const { clientJs } = makeMultiBatchHandler("loadTriple", threeBatchBody(), batches, {
      returnVarName: "c",
    });
    expect(clientJs).toContain("CPS batch 0");
    expect(clientJs).toContain("CPS batch 1");
    expect(clientJs).toContain("CPS batch 2");
  });
});

// ===========================================================================
// Category 3 — mixed-monotonicity per-batch gating
// ===========================================================================

describe("M1.5 mixed-monotonicity per-batch gating", () => {
  // Batch 0 monotone, batch 1 non-monotone.
  const mixed = [
    { indices: [0], monotonicity: "monotone" },
    { indices: [2], monotonicity: "non-monotone" },
  ];

  test("F10: only the non-monotone batch's server stub emits dedup middleware", () => {
    const { serverJs } = makeMultiBatchHandler("loadMixed", twoBatchBody(), mixed, {
      returnVarName: "orders",
    });
    // Exactly one idempotency-key dedup middleware block (batch 1 only).
    const dedupHits = (serverJs.match(/idempotency-key dedup middleware/g) || []).length;
    expect(dedupHits).toBe(1);
  });

  test("F11: only the non-monotone batch's client stub emits the Idempotency-Key", () => {
    const { clientJs } = makeMultiBatchHandler("loadMixed", twoBatchBody(), mixed, {
      returnVarName: "orders",
    });
    const keyHits = (clientJs.match(/_scrml_idempotency_key =/g) || []).length;
    expect(keyHits).toBe(1);
  });

  test("F12: both-monotone two-batch route emits NO dedup middleware", () => {
    const { serverJs, clientJs } = makeMultiBatchHandler(
      "loadClean", twoBatchBody(),
      [{ indices: [0], monotonicity: "monotone" }, { indices: [2], monotonicity: "monotone" }],
      { returnVarName: "orders" },
    );
    expect(serverJs).not.toContain("idempotency-key dedup middleware");
    expect(clientJs).not.toContain("_scrml_idempotency_key =");
  });

  test("F13: both-non-monotone two-batch route emits dedup on BOTH stubs", () => {
    const { serverJs } = makeMultiBatchHandler(
      "loadDirty", twoBatchBody(),
      [{ indices: [0], monotonicity: "non-monotone" }, { indices: [2], monotonicity: "non-monotone" }],
      { returnVarName: "orders" },
    );
    const dedupHits = (serverJs.match(/idempotency-key dedup middleware/g) || []).length;
    expect(dedupHits).toBe(2);
  });
});

// ===========================================================================
// Category 4 — per-batch error envelope
// ===========================================================================

describe("M1.5 per-batch error envelope", () => {
  const batches = [
    { indices: [0], monotonicity: "monotone" },
    { indices: [2], monotonicity: "monotone" },
  ];

  test("F14: each batch await sits in its own try/catch", () => {
    const { clientJs } = makeMultiBatchHandler("loadEnv", twoBatchBody(), batches, {
      returnVarName: "orders",
    });
    // Each batch emits a `try {` — at least 2 in the wrapper.
    const tryHits = (clientJs.match(/try \{/g) || []).length;
    expect(tryHits).toBeGreaterThanOrEqual(2);
  });

  test("F15: error envelope carries the failing batch index", () => {
    const { clientJs } = makeMultiBatchHandler("loadEnv", twoBatchBody(), batches, {
      returnVarName: "orders",
    });
    // The tagged envelope names `batch: 0` and `batch: 1`.
    expect(clientJs).toMatch(/batch:\s*0/);
    expect(clientJs).toMatch(/batch:\s*1/);
  });

  test("F16: error envelope is the tagged __scrml_error CpsError shape", () => {
    const { clientJs } = makeMultiBatchHandler("loadEnv", twoBatchBody(), batches, {
      returnVarName: "orders",
    });
    expect(clientJs).toContain("__scrml_error: true");
    expect(clientJs).toContain('type: "CpsError"');
    expect(clientJs).toContain('variant: "NetworkError"');
  });

  test("F17: error envelope names the function", () => {
    const { clientJs } = makeMultiBatchHandler("loadEnv", twoBatchBody(), batches, {
      returnVarName: "orders",
    });
    expect(clientJs).toContain('fn: "loadEnv"');
  });

  test("F18: each batch checks the server-serialized __scrml_error envelope", () => {
    const { clientJs } = makeMultiBatchHandler("loadEnv", twoBatchBody(), batches, {
      returnVarName: "orders",
    });
    expect(clientJs).toMatch(/_scrml_batch_0_result\.__scrml_error/);
    expect(clientJs).toMatch(/_scrml_batch_1_result\.__scrml_error/);
  });
});

// ===========================================================================
// Category 5 — cross-batch parameter forwarding
// ===========================================================================

describe("M1.5 cross-batch parameter forwarding", () => {
  // Batch 0 produces @token; batch 1 reads it. The wrapper forwards @token
  // (batch 0's return cell) as a param to batch 1's stub.
  function fwdBody() {
    return [
      makeReactiveDecl("token", "?{`SELECT token FROM sessions`}.get()", span(110)),
      makeReactiveDecl("seen", "true", span(120)),
      makeReactiveDecl("rows", "?{`SELECT * FROM rows`}.get()", span(130)),
    ];
  }
  const batches = [
    { indices: [0], monotonicity: "monotone" },
    { indices: [2], monotonicity: "monotone" },
  ];

  test("F19: batch 1's server handler destructures the forwarded cell", () => {
    const { serverJs } = makeMultiBatchHandler("loadFwd", fwdBody(), batches, {
      returnVarName: "rows",
    });
    // Batch 0's return cell `token` is forwarded — batch 1's handler reads it
    // from the request body.
    expect(serverJs).toContain('const token = _scrml_body["token"];');
  });

  test("F20: batch 1's client wrapper binds the forwarded cell locally", () => {
    const { clientJs } = makeMultiBatchHandler("loadFwd", fwdBody(), batches, {
      returnVarName: "rows",
    });
    // After batch 0's await the wrapper binds `token` so batch 1's call args
    // (and any interleaved client statement) can reference it.
    expect(clientJs).toMatch(/let token = _scrml_batch_0_result/);
  });

  test("F21: batch 0's stub does NOT receive any forwarded param", () => {
    const { clientJs } = makeMultiBatchHandler("loadFwd", fwdBody(), batches, {
      returnVarName: "rows",
    });
    // Batch 0 is first — its call carries no prior-batch result.
    expect(clientJs).toMatch(/await _scrml_fetch_loadFwd_batch_0[A-Za-z0-9_]*\(\)/);
  });
});

// ===========================================================================
// Category 6 — single-batch back-compat
// ===========================================================================

describe("M1.5 single-batch back-compat", () => {
  test("F22: single-batch CPS route emits exactly ONE route handler (no __batch_ suffix)", () => {
    const { serverJs } = makeSingleBatchHandler("loadOne", "monotone");
    expect(countBatchRouteExports(serverJs)).toBe(0);
    expect(serverJs).toContain("export const __ri_route_loadOne_1 = {");
  });

  test("F23: single-batch CPS wrapper keeps the pre-Ext-1 single-await shape", () => {
    const { clientJs } = makeSingleBatchHandler("loadOne", "monotone");
    // The pre-Ext-1 wrapper uses `_scrml_server_result`, not `_scrml_batch_N_result`.
    expect(clientJs).toContain("_scrml_server_result");
    expect(clientJs).not.toContain("_scrml_batch_0_result");
  });

  test("F24: single-batch non-monotone route still emits dedup middleware", () => {
    const { serverJs } = makeSingleBatchHandler("loadOneDirty", "non-monotone");
    expect(serverJs).toContain("idempotency-key dedup middleware");
  });
});
