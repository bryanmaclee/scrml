/**
 * Ext 1 M1.4 — per-batch monotonicity classifier lift.
 *
 * Verifies the monotonicity classifier (SPEC §19.9.6) lifted from per-function
 * to per-batch. Two surfaces:
 *
 *   1. `classifyBatchMonotonicityForTest` — the per-batch core. Each batch is
 *      classified independently over its own `indices`.
 *   2. `analyzeMonotonicity` end-to-end — verifies `batchVerdicts` is the
 *      load-bearing per-batch surface, that `CPSBatch.monotonicity` is
 *      populated, and that the function-level `verdicts` aggregate is the
 *      conservative max (non-monotone dominates).
 *
 * Soundness (body-split DD §B.4): per-batch is strictly finer-grain than
 * per-function — a monotone batch in an otherwise-non-monotone function no
 * longer pays the idempotency-key tax. S5 STRENGTHENED, never weakened.
 *
 * Brief: docs/changes/full-body-split/EXT-1-IMPL-BRIEF.md §M1.4.
 */

import { describe, test, expect } from "bun:test";
import {
  classifyBatchMonotonicityForTest,
  classifyFunctionMonotonicityForTest,
  analyzeMonotonicity,
} from "../../src/monotonicity-analyzer.ts";
import { CPSSplit } from "../../src/route-inference.ts";

// ---------------------------------------------------------------------------
// Helpers (mirror the a9-ext5 classifier-test fixture shapes)
// ---------------------------------------------------------------------------

function span(start) {
  return { file: "/test/app.scrml", start, end: start + 10, line: 1, col: 1 };
}

/** Build a state-decl node with an inline SQL init via `sqlNode` sibling. */
function makeStateDeclWithSql(name, query) {
  return {
    kind: "state-decl",
    name,
    init: "?{...}",
    sqlNode: { kind: "sql", query, chainedCalls: [], span: span(0) },
    span: span(0),
  };
}

/** Build a bare-expr wrapping a SQL node. */
function makeBareSql(query) {
  return {
    kind: "bare-expr",
    exprNode: { kind: "sql", query, chainedCalls: [] },
    span: span(0),
  };
}

/** Build a bare-expr that's a `<engine>.advance(...)` call. */
function makeAdvanceCall() {
  return {
    kind: "bare-expr",
    exprNode: {
      kind: "call",
      callee: {
        kind: "member",
        object: { kind: "ident", name: "marioMachine" },
        property: { name: "advance" },
      },
      args: [{ kind: "literal", value: ".Fire" }],
    },
    span: span(0),
  };
}

/** A statement shape that classifies non-monotone (unrecognized). */
function makeOpaqueStmt() {
  return { kind: "expr-stmt", span: span(0) };
}

/** Build a function-decl with given body + optional .idempotent() modifier. */
function makeFn(body, opts = {}) {
  return {
    kind: "function-decl",
    name: opts.name ?? "testFn",
    params: opts.params ?? [],
    body,
    fnKind: "function",
    isServer: true,
    canFail: false,
    span: span(0),
    ...(opts.idempotentModifier ? { idempotentModifier: true } : {}),
  };
}

/**
 * Build a multi-batch CPSSplit directly. `batchIndexGroups` is an array of
 * index arrays — one per batch, in source order.
 */
function makeMultiBatchSplit(batchIndexGroups, returnVarName = null) {
  const batches = batchIndexGroups.map((indices) => ({
    indices,
    idempotencyTag: "",
  }));
  return new CPSSplit(batches, [], returnVarName);
}

/** Build a single-function RouteMap so analyzeMonotonicity can run end-to-end. */
function makeRouteMap(fnNodeId, cpsSplit) {
  return {
    functions: new Map([
      [fnNodeId, {
        functionNodeId: fnNodeId,
        boundary: "server",
        escalationReasons: [],
        generatedRouteName: null,
        explicitRoute: null,
        explicitMethod: null,
        isSSE: false,
        serverEntrySpan: null,
        cpsSplit,
      }],
    ]),
    pages: new Map(),
    authMiddleware: new Map(),
  };
}

// ---------------------------------------------------------------------------
// 1. Single-batch — per-batch verdict unchanged vs. pre-M1.4 function verdict
// ---------------------------------------------------------------------------

describe("M1.4 single-batch — per-batch verdict matches function verdict", () => {
  test("SELECT-only single batch → monotone (per-batch + per-function agree)", () => {
    const fn = makeFn([makeStateDeclWithSql("rows", "SELECT * FROM users WHERE id = 5")]);
    expect(classifyBatchMonotonicityForTest(fn, [0])).toBe("monotone");
    const cps = CPSSplit.singleBatch([0], [], "rows");
    expect(classifyFunctionMonotonicityForTest(fn, cps)).toBe("monotone");
  });

  test("INSERT-with-RETURNING single batch → non-monotone", () => {
    const fn = makeFn([makeBareSql("INSERT INTO log (msg) VALUES ('x') RETURNING id")]);
    expect(classifyBatchMonotonicityForTest(fn, [0])).toBe("non-monotone");
  });

  test("opaque statement single batch → non-monotone (conservative default)", () => {
    const fn = makeFn([makeOpaqueStmt()]);
    expect(classifyBatchMonotonicityForTest(fn, [0])).toBe("non-monotone");
  });

  test("single .advance() batch → machine-intrinsic", () => {
    const fn = makeFn([makeAdvanceCall()]);
    expect(classifyBatchMonotonicityForTest(fn, [0])).toBe("machine-intrinsic");
  });
});

// ---------------------------------------------------------------------------
// 2. Two-batch mixed monotonicity — the load-bearing M1.4 case
// ---------------------------------------------------------------------------

describe("M1.4 two-batch mixed monotonicity — each batch classified independently", () => {
  test("batch 0 monotone (SELECT), batch 1 non-monotone (INSERT-RETURNING)", () => {
    const body = [
      makeStateDeclWithSql("rows", "SELECT * FROM users"),
      makeBareSql("INSERT INTO log (msg) VALUES ('x') RETURNING id"),
    ];
    const fn = makeFn(body);
    expect(classifyBatchMonotonicityForTest(fn, [0])).toBe("monotone");
    expect(classifyBatchMonotonicityForTest(fn, [1])).toBe("non-monotone");
  });

  test("batch 0 non-monotone, batch 1 monotone — order does not collapse verdicts", () => {
    const body = [
      makeBareSql("INSERT INTO log (msg) VALUES ('x') RETURNING id"),
      makeStateDeclWithSql("rows", "SELECT * FROM users"),
    ];
    const fn = makeFn(body);
    expect(classifyBatchMonotonicityForTest(fn, [0])).toBe("non-monotone");
    expect(classifyBatchMonotonicityForTest(fn, [1])).toBe("monotone");
  });

  test("analyzeMonotonicity — mixed batches: batchVerdicts holds independent verdicts", () => {
    const body = [
      makeStateDeclWithSql("rows", "SELECT * FROM users"),
      makeBareSql("INSERT INTO log (msg) VALUES ('x') RETURNING id"),
    ];
    const fn = makeFn(body);
    const cps = makeMultiBatchSplit([[0], [1]]);
    const routeMap = makeRouteMap("fn1", cps);
    const result = analyzeMonotonicity(routeMap, new Map([["fn1", fn]]));
    expect(result.batchVerdicts.get("fn1")).toEqual(["monotone", "non-monotone"]);
  });

  test("analyzeMonotonicity — mixed batches: CPSBatch.monotonicity populated per batch", () => {
    const body = [
      makeStateDeclWithSql("rows", "SELECT * FROM users"),
      makeBareSql("INSERT INTO log (msg) VALUES ('x') RETURNING id"),
    ];
    const fn = makeFn(body);
    const cps = makeMultiBatchSplit([[0], [1]]);
    const routeMap = makeRouteMap("fn1", cps);
    analyzeMonotonicity(routeMap, new Map([["fn1", fn]]));
    expect(cps.serverBatches[0].monotonicity).toBe("monotone");
    expect(cps.serverBatches[1].monotonicity).toBe("non-monotone");
  });

  test("analyzeMonotonicity — function-level verdict is conservative max (non-monotone dominates)", () => {
    const body = [
      makeStateDeclWithSql("rows", "SELECT * FROM users"),
      makeBareSql("INSERT INTO log (msg) VALUES ('x') RETURNING id"),
    ];
    const fn = makeFn(body);
    const cps = makeMultiBatchSplit([[0], [1]]);
    const routeMap = makeRouteMap("fn1", cps);
    const result = analyzeMonotonicity(routeMap, new Map([["fn1", fn]]));
    expect(result.verdicts.get("fn1")).toBe("non-monotone");
  });

  test("analyzeMonotonicity — all-monotone batches: function verdict monotone", () => {
    const body = [
      makeStateDeclWithSql("a", "SELECT * FROM users"),
      makeStateDeclWithSql("b", "SELECT * FROM posts"),
    ];
    const fn = makeFn(body);
    const cps = makeMultiBatchSplit([[0], [1]]);
    const routeMap = makeRouteMap("fn1", cps);
    const result = analyzeMonotonicity(routeMap, new Map([["fn1", fn]]));
    expect(result.batchVerdicts.get("fn1")).toEqual(["monotone", "monotone"]);
    expect(result.verdicts.get("fn1")).toBe("monotone");
  });
});

// ---------------------------------------------------------------------------
// 3. Two-batch with machine-intrinsic batch
// ---------------------------------------------------------------------------

describe("M1.4 two-batch with machine-intrinsic batch", () => {
  test("batch bounded by .advance() classifies machine-intrinsic; sibling SELECT monotone", () => {
    const body = [
      makeStateDeclWithSql("rows", "SELECT * FROM users"),
      makeAdvanceCall(),
    ];
    const fn = makeFn(body);
    expect(classifyBatchMonotonicityForTest(fn, [0])).toBe("monotone");
    expect(classifyBatchMonotonicityForTest(fn, [1])).toBe("machine-intrinsic");
  });

  test("analyzeMonotonicity — machine-intrinsic + monotone batches: no non-monotone, function machine-intrinsic", () => {
    const body = [
      makeStateDeclWithSql("rows", "SELECT * FROM users"),
      makeAdvanceCall(),
    ];
    const fn = makeFn(body);
    const cps = makeMultiBatchSplit([[0], [1]]);
    const routeMap = makeRouteMap("fn1", cps);
    const result = analyzeMonotonicity(routeMap, new Map([["fn1", fn]]));
    expect(result.batchVerdicts.get("fn1")).toEqual(["monotone", "machine-intrinsic"]);
    // No non-monotone batch → machine-intrinsic dominates monotone in the aggregate.
    expect(result.verdicts.get("fn1")).toBe("machine-intrinsic");
  });

  test("analyzeMonotonicity — machine-intrinsic + non-monotone batches: non-monotone still dominates", () => {
    const body = [
      makeAdvanceCall(),
      makeBareSql("INSERT INTO log (msg) VALUES ('x') RETURNING id"),
    ];
    const fn = makeFn(body);
    const cps = makeMultiBatchSplit([[0], [1]]);
    const routeMap = makeRouteMap("fn1", cps);
    const result = analyzeMonotonicity(routeMap, new Map([["fn1", fn]]));
    expect(result.batchVerdicts.get("fn1")).toEqual(["machine-intrinsic", "non-monotone"]);
    expect(result.verdicts.get("fn1")).toBe("non-monotone");
  });
});

// ---------------------------------------------------------------------------
// 4. Per-batch D-CPS-MONOTONE diagnostics + .idempotent() override
// ---------------------------------------------------------------------------

describe("M1.4 per-batch diagnostics", () => {
  test("D-CPS-MONOTONE fires once per monotone batch, carrying batchIndex", () => {
    const body = [
      makeStateDeclWithSql("a", "SELECT * FROM users"),
      makeStateDeclWithSql("b", "SELECT * FROM posts"),
    ];
    const fn = makeFn(body);
    const cps = makeMultiBatchSplit([[0], [1]]);
    const routeMap = makeRouteMap("fn1", cps);
    const result = analyzeMonotonicity(routeMap, new Map([["fn1", fn]]));
    const monoDiags = result.diagnostics.filter((d) => d.code === "D-CPS-MONOTONE");
    expect(monoDiags.length).toBe(2);
    expect(monoDiags.map((d) => d.batchIndex).sort()).toEqual([0, 1]);
  });

  test("D-CPS-MACHINE-INTRINSIC-MONOTONE carries the batchIndex of the machine batch", () => {
    const body = [
      makeStateDeclWithSql("rows", "SELECT * FROM users"),
      makeAdvanceCall(),
    ];
    const fn = makeFn(body);
    const cps = makeMultiBatchSplit([[0], [1]]);
    const routeMap = makeRouteMap("fn1", cps);
    const result = analyzeMonotonicity(routeMap, new Map([["fn1", fn]]));
    const machineDiags = result.diagnostics.filter(
      (d) => d.code === "D-CPS-MACHINE-INTRINSIC-MONOTONE",
    );
    expect(machineDiags.length).toBe(1);
    expect(machineDiags[0].batchIndex).toBe(1);
  });

  test("non-monotone batch fires no info diagnostic", () => {
    const body = [makeBareSql("INSERT INTO log (msg) VALUES ('x') RETURNING id")];
    const fn = makeFn(body);
    const cps = makeMultiBatchSplit([[0]]);
    const routeMap = makeRouteMap("fn1", cps);
    const result = analyzeMonotonicity(routeMap, new Map([["fn1", fn]]));
    expect(result.diagnostics.length).toBe(0);
  });

  test(".idempotent() override — all batches monotone, single function-wide D-CPS-IDEMPOTENT-OVERRIDE", () => {
    const body = [
      makeBareSql("INSERT INTO log (msg) VALUES ('x') RETURNING id"),
      makeBareSql("UPDATE counters SET n = random() WHERE id = 1"),
    ];
    const fn = makeFn(body, { idempotentModifier: true });
    const cps = makeMultiBatchSplit([[0], [1]]);
    const routeMap = makeRouteMap("fn1", cps);
    const result = analyzeMonotonicity(routeMap, new Map([["fn1", fn]]));
    // Override forces every batch monotone.
    expect(result.batchVerdicts.get("fn1")).toEqual(["monotone", "monotone"]);
    expect(result.verdicts.get("fn1")).toBe("monotone");
    // Exactly one function-wide override diagnostic; no per-batch D-CPS-MONOTONE.
    const overrideDiags = result.diagnostics.filter((d) => d.code === "D-CPS-IDEMPOTENT-OVERRIDE");
    expect(overrideDiags.length).toBe(1);
    expect(overrideDiags[0].batchIndex).toBeUndefined();
    expect(result.diagnostics.filter((d) => d.code === "D-CPS-MONOTONE").length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 5. Three-batch — verdict array length + per-batch independence
// ---------------------------------------------------------------------------

describe("M1.4 three-batch — verdict array tracks every batch", () => {
  test("three batches: monotone / non-monotone / machine-intrinsic", () => {
    const body = [
      makeStateDeclWithSql("rows", "SELECT * FROM users"),
      makeBareSql("INSERT INTO log (msg) VALUES ('x') RETURNING id"),
      makeAdvanceCall(),
    ];
    const fn = makeFn(body);
    const cps = makeMultiBatchSplit([[0], [1], [2]]);
    const routeMap = makeRouteMap("fn1", cps);
    const result = analyzeMonotonicity(routeMap, new Map([["fn1", fn]]));
    expect(result.batchVerdicts.get("fn1")).toEqual([
      "monotone",
      "non-monotone",
      "machine-intrinsic",
    ]);
    expect(cps.serverBatches[0].monotonicity).toBe("monotone");
    expect(cps.serverBatches[1].monotonicity).toBe("non-monotone");
    expect(cps.serverBatches[2].monotonicity).toBe("machine-intrinsic");
    expect(result.verdicts.get("fn1")).toBe("non-monotone");
  });
});
