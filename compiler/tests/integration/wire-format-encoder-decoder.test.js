/**
 * M-7C-D-12 Track 2 — Wire-format encoder + dual-decoder integration tests
 * (D-12.2d, per SCOPING §4 Track 2).
 *
 * SPEC anchors:
 *   - §57 Wire Format (envelope shape, encoder rules, dual-decoder)
 *   - §12.5.1 Server-function return wire format
 *   - §42.5 / §42.8 Runtime absence sentinel = JS null
 *
 * Test classes:
 *   1. Encoder type-gating + emission shape. A server fn with declared
 *      return type `T | not` emits `_scrml_wire_encode(_scrml_result)` at
 *      the response-emit site AND inlines the encoder helper. A pure-`T`
 *      return emits the legacy raw `?? null` form AND skips the helper.
 *   2. Decoder type-gating. The client fetch stub for a `T | not` fn wraps
 *      `await _scrml_resp.json()` through `_scrml_wire_decode`. The pure-`T`
 *      fn does NOT.
 *   3. Regression: pure-`T` returns do NOT pull in encoder helper.
 */

import { describe, test, expect } from "bun:test";
import { runCG } from "../../src/code-generator.js";

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

function makeRouteMap(entries = []) {
  const functions = new Map();
  for (const e of entries) {
    functions.set(e.functionNodeId, e);
  }
  return { functions };
}

function makeDepGraph() { return { nodes: new Map(), edges: [] }; }
function makeProtectAnalysis() { return { views: new Map() }; }

function runCGForFile(nodes, routeMap = makeRouteMap()) {
  const ast = makeFileAST("/test/app.scrml", nodes);
  return runCG({
    files: [ast],
    routeMap,
    depGraph: makeDepGraph(),
    protectAnalysis: makeProtectAnalysis(),
    embedRuntime: true,
  });
}

/**
 * Build a server-boundary function with a declared return-type annotation.
 * The non-CSRF dedup path is exercised by giving the fn a `cpsSplit` with
 * `monotonicity: "non-monotone"` (matches the a9-ext5 emission test shape).
 * The CSRF / non-CPS path is exercised by giving the fn NO `cpsSplit`.
 */
function makeServerFn(fnName, returnTypeAnnotation, opts = {}) {
  const fnSpan = span(100);
  // Body: a single bare-expression statement that resolves to a string
  // literal. The CG emits `"hello";` then the response wrapper emits
  // `JSON.stringify(_scrml_result ?? null)` or `_scrml_wire_encode(...)`
  // depending on the return-type annotation. The body shape is intentionally
  // minimal — only the response-emit site is under test.
  const fnNode = {
    kind: "function-decl",
    name: fnName,
    params: [],
    body: [{
      kind: "bare-expr",
      expr: '"hello"',
      span: span(120),
    }],
    fnKind: "function",
    isServer: true,
    span: fnSpan,
  };
  if (returnTypeAnnotation) {
    fnNode.returnTypeAnnotation = returnTypeAnnotation;
  }
  const routeEntry = {
    functionNodeId: "/test/app.scrml::100",
    boundary: "server",
    escalationReasons: [],
    generatedRouteName: `__ri_route_${fnName}_1`,
    serverEntrySpan: fnSpan,
  };
  if (opts.cpsSplit) routeEntry.cpsSplit = opts.cpsSplit;
  const routeMap = makeRouteMap([routeEntry]);
  const result = runCGForFile([{ kind: "logic", body: [fnNode], span: span(90) }], routeMap);
  const out = result.outputs.get("/test/app.scrml") ?? {};
  return { result, serverJs: out.serverJs ?? "", clientJs: out.clientJs ?? "" };
}

// ---------------------------------------------------------------------------
// Class 1 — Encoder type-gating + emission shape
// ---------------------------------------------------------------------------

describe("§57 wire encoder — type-gating on `T | not` (CSRF path)", () => {
  test("declared `string | not` return emits `_scrml_wire_encode(_scrml_result)` at CSRF response", () => {
    const { serverJs } = makeServerFn("loadName", "string | not");
    expect(serverJs).toContain("_scrml_wire_encode(_scrml_result)");
    expect(serverJs).not.toContain("_scrml_result ?? null");
  });

  test("declared `string | not` return inlines encoder helper at top of server module", () => {
    const { serverJs } = makeServerFn("loadName", "string | not");
    expect(serverJs).toContain("function _scrml_wire_encode(value)");
    expect(serverJs).toContain("__scrml_absent: true");
  });

  test("declared `not | string` (reversed order) also triggers envelope wrap", () => {
    const { serverJs } = makeServerFn("loadName", "not | string");
    expect(serverJs).toContain("_scrml_wire_encode(_scrml_result)");
  });

  test("postfix `string?` sugar triggers envelope wrap", () => {
    const { serverJs } = makeServerFn("loadName", "string?");
    expect(serverJs).toContain("_scrml_wire_encode(_scrml_result)");
  });

  test("generic-typed `Array<User> | not` triggers envelope wrap", () => {
    const { serverJs } = makeServerFn("loadUsers", "Array<User> | not");
    expect(serverJs).toContain("_scrml_wire_encode(_scrml_result)");
  });
});

describe("§57 wire encoder — type-gating on `T | not` (non-CSRF idempotency path)", () => {
  test("declared `string | not` return emits encoder at non-CSRF idempotency response", () => {
    const cpsSplit = {
      serverStmtIndices: [0],
      clientStmtIndices: [],
      monotonicity: "non-monotone",
    };
    const { serverJs } = makeServerFn("nonCsrfLoad", "string | not", { cpsSplit });
    expect(serverJs).toContain("_scrml_wire_encode(_scrml_result)");
    expect(serverJs).toContain("function _scrml_wire_encode(value)");
  });
});

// ---------------------------------------------------------------------------
// Class 2 — Decoder type-gating (client fetch stub)
// ---------------------------------------------------------------------------

describe("§57 wire dual-decoder — type-gating on client fetch stub", () => {
  test("declared `string | not` return wraps client fetch in `_scrml_wire_decode`", () => {
    const { clientJs } = makeServerFn("loadName", "string | not");
    expect(clientJs).toContain("_scrml_wire_decode(await _scrml_resp.json())");
  });

  test("declared `string` return does NOT wrap in decoder", () => {
    const { clientJs } = makeServerFn("loadName", "string");
    expect(clientJs).not.toContain("_scrml_wire_decode(await _scrml_resp.json())");
    // Peter #20 — the stub now binds `const _scrml_body_json = await
    // _scrml_resp.json();`, applies the §6.7.7/§19.9.2 non-2xx ok-check (a
    // non-`{__scrml_error}` non-2xx throws), then `return _scrml_body_json;`.
    // Pure-`T` still takes the RAW `.json()` (no decoder wrap).
    expect(clientJs).toContain("const _scrml_body_json = await _scrml_resp.json();");
    expect(clientJs).toContain("return _scrml_body_json;");
  });

  test("postfix `User?` sugar triggers decoder wrap", () => {
    const { clientJs } = makeServerFn("loadUser", "User?");
    expect(clientJs).toContain("_scrml_wire_decode(await _scrml_resp.json())");
  });

  test("`_scrml_wire_decode` helper is present in client runtime (core chunk)", () => {
    const { clientJs } = makeServerFn("loadName", "string | not");
    expect(clientJs).toContain("function _scrml_wire_decode(value)");
    expect(clientJs).toContain("__scrml_absent === true");
  });
});

// ---------------------------------------------------------------------------
// Class 3 — Regression: pure-`T` returns skip encoder
// ---------------------------------------------------------------------------

describe("§57 wire format — regression: pure-`T` returns skip encoder", () => {
  test("declared `string` return uses raw `?? null` emission (NO encoder)", () => {
    const { serverJs } = makeServerFn("loadName", "string");
    expect(serverJs).not.toContain("_scrml_wire_encode(_scrml_result)");
    expect(serverJs).toContain("_scrml_result ?? null");
  });

  test("declared `string` return does NOT inline encoder helper", () => {
    const { serverJs } = makeServerFn("loadName", "string");
    expect(serverJs).not.toContain("function _scrml_wire_encode(value)");
  });

  test("missing return-type annotation is conservatively treated as pure-T (no envelope)", () => {
    const { serverJs } = makeServerFn("loadName", undefined);
    expect(serverJs).not.toContain("_scrml_wire_encode(_scrml_result)");
    expect(serverJs).not.toContain("function _scrml_wire_encode(value)");
  });

  test("non-absence union (e.g. `string | number`) is NOT envelope-wrapped", () => {
    const { serverJs } = makeServerFn("loadName", "string | number");
    expect(serverJs).not.toContain("_scrml_wire_encode(_scrml_result)");
  });
});
