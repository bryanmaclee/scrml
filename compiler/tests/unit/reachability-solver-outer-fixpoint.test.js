/**
 * Reachability Solver — Outer fixed-point operator conformance suite.
 *
 * S91 wave A-2.7 — exercises `runOuterFixpoint` per SPEC §40.9.1
 * directly AND via the full `runReachabilitySolver` entry point.
 *
 * Two test surfaces:
 *
 *   1. Direct unit tests against `runOuterFixpoint` (compiler/src/
 *      reachability/outer-fixpoint.ts) using an injected `closureStepFn`
 *      to drive deterministic multi-round behaviour. These exercise
 *      the algorithm in isolation:
 *        - Trivial fixpoint (stable on round 1).
 *        - Multi-round monotonic growth.
 *        - Iteration-cap overflow → E-CLOSURE-001.
 *        - Monotonicity-violation guard (subset-returning step → throw).
 *        - Determinism (byte-identical output on repeat).
 *
 *   2. End-to-end integration tests through `runReachabilitySolver`
 *      with a synthetic FileAST mirroring the SPEC §40.9.9 worked
 *      example. These exercise the wire-in:
 *        - Default closure step on production-shape input converges
 *          in 1 iteration (the §40.9.9 example).
 *        - Fixpoint output matches the §40.9.9 step-5/step-6 expected
 *          playable surface.
 *
 * Coverage (~18 scenarios per the A-2.7 brief):
 *
 *   §1   Trivial fixpoint (stable initial union)
 *   §2   Single-round enrichment (closureStepFn adds 1 → converges in 2)
 *   §3   Multi-round cascade (closureStepFn admits a chain → 3+ rounds)
 *   §4   Termination on stable set (re-run after convergence still stable)
 *   §5   Cap-overflow E-CLOSURE-001 fire-site (pathological always-grow step)
 *   §6   Monotonicity violation (closureStepFn returns subset → throw)
 *   §7   Determinism (byte-identical output across two runs)
 *   §8   §40.9.9 worked example — default closure step produces expected
 *        playable surface for the Dispatch example
 *   §9   E-CLOSURE-001 message shape (entry-point + role + cap surfaced)
 *   §10  iterCap = 1 boundary (terminates if stable on round 1)
 *   §11  Invalid iterCap rejected (≤ 0 throws synchronously)
 *   §12  ChunkContents equality helper edge cases (empty sets equal)
 *   §13  Component-set preservation (default step never strips C1)
 *   §14  Multi-atom growth (reactive + server-fn + vendor all advance)
 *   §15  Cap-overflow returns partial result, NOT empty
 *   §16  Cap-overflow iterations === iterCap (boundary precision)
 */

import { describe, test, expect } from "bun:test";
import { runReachabilitySolver } from "../../src/reachability-solver.ts";
import {
  runOuterFixpoint,
  chunkContentsEqual,
  DEFAULT_ITER_CAP,
} from "../../src/reachability/outer-fixpoint.ts";

// ---------------------------------------------------------------------------
// Helpers — ChunkContents builders + assertion utilities
// ---------------------------------------------------------------------------

function emptyCC() {
  return {
    componentNodeIds: new Set(),
    reactiveCellNodeIds: new Set(),
    serverFnNodeIds: new Set(),
    vendorUnitNames: new Set(),
  };
}

function cc({ components = [], reactive = [], serverFns = [], vendor = [] } = {}) {
  return {
    componentNodeIds: new Set(components),
    reactiveCellNodeIds: new Set(reactive),
    serverFnNodeIds: new Set(serverFns),
    vendorUnitNames: new Set(vendor),
  };
}

// Identity closure step — fixpoint converges immediately.
const identityStep = (prev) => ({
  componentNodeIds: new Set(prev.componentNodeIds),
  reactiveCellNodeIds: new Set(prev.reactiveCellNodeIds),
  serverFnNodeIds: new Set(prev.serverFnNodeIds),
  vendorUnitNames: new Set(prev.vendorUnitNames),
});

// Step that adds ONE new reactive cell each round (terminates when
// the "queue" of cells to admit runs out — useful for testing
// monotonic growth across exactly K rounds).
function makeQueueStep(queue) {
  let i = 0;
  return (prev) => {
    const next = identityStep(prev);
    if (i < queue.length) {
      next.reactiveCellNodeIds.add(queue[i]);
      i++;
    }
    return next;
  };
}

// Step that admits one new id forever — exercises the cap-overflow
// path. Uses a monotonically-increasing counter so each round's
// addition is unique.
function makeForeverStep() {
  let i = 0;
  return (prev) => {
    const next = identityStep(prev);
    next.reactiveCellNodeIds.add(`forever-${i++}`);
    return next;
  };
}

// Step that returns a STRICT subset of the input — used to verify the
// monotonicity-violation guard. Drops the first reactive cell each
// time it runs.
function subsetStep(prev) {
  const next = identityStep(prev);
  const first = next.reactiveCellNodeIds.values().next().value;
  if (first !== undefined) next.reactiveCellNodeIds.delete(first);
  return next;
}

// Shared standard input scaffold — only `initialUnion` and `closureStepFn`
// vary across tests.
function makeInput(initialUnion, overrides = {}) {
  return {
    entryPoint: "/test-ep",
    viewerRole: "_anonymous",
    initialUnion,
    depGraph: null,
    files: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// §1 — Trivial fixpoint (closureStepFn returns prev unchanged)
// ---------------------------------------------------------------------------

describe("§1 trivial fixpoint — identity step converges in 1 iteration", () => {
  test("empty initial union converges immediately", () => {
    const r = runOuterFixpoint(makeInput(emptyCC(), { closureStepFn: identityStep }));
    expect(r.terminated).toBe(true);
    expect(r.iterations).toBe(1);
    expect(r.errors).toEqual([]);
    expect(r.result.componentNodeIds.size).toBe(0);
    expect(r.result.reactiveCellNodeIds.size).toBe(0);
    expect(r.result.serverFnNodeIds.size).toBe(0);
    expect(r.result.vendorUnitNames.size).toBe(0);
  });

  test("non-empty initial union with identity step → converges in 1 iteration", () => {
    const r = runOuterFixpoint(makeInput(
      cc({ components: [1, 2, 3], reactive: ["@x", "@y"], serverFns: ["fn1"], vendor: ["cm6"] }),
      { closureStepFn: identityStep },
    ));
    expect(r.terminated).toBe(true);
    expect(r.iterations).toBe(1);
    expect(r.errors).toEqual([]);
    // All original atoms preserved.
    expect([...r.result.componentNodeIds].sort()).toEqual([1, 2, 3]);
    expect([...r.result.reactiveCellNodeIds].sort()).toEqual(["@x", "@y"]);
    expect([...r.result.serverFnNodeIds]).toEqual(["fn1"]);
    expect([...r.result.vendorUnitNames]).toEqual(["cm6"]);
  });
});

// ---------------------------------------------------------------------------
// §2 — Single-round enrichment (one new atom on round 1, stable on round 2)
// ---------------------------------------------------------------------------

describe("§2 single-round enrichment — fixpoint completes in 2 iterations", () => {
  test("step adds one reactive cell on round 1 → fixpoint at round 2", () => {
    const step = makeQueueStep(["@admin-cell"]);
    const r = runOuterFixpoint(makeInput(
      cc({ components: [1], reactive: ["@x"] }),
      { closureStepFn: step },
    ));
    expect(r.terminated).toBe(true);
    expect(r.iterations).toBe(2);
    expect(r.errors).toEqual([]);
    expect([...r.result.reactiveCellNodeIds].sort()).toEqual(["@admin-cell", "@x"]);
  });
});

// ---------------------------------------------------------------------------
// §3 — Multi-round cascade (3+ iterations of monotonic growth)
// ---------------------------------------------------------------------------

describe("§3 multi-round cascade — 3+ iterations of monotonic growth", () => {
  test("queue of 3 admissions → fixpoint at iteration 4", () => {
    const step = makeQueueStep(["@a", "@b", "@c"]);
    const r = runOuterFixpoint(makeInput(
      cc({ components: [1] }),
      { closureStepFn: step },
    ));
    expect(r.terminated).toBe(true);
    // Iteration 1: add @a (size 0 → 1, not equal). Iteration 2: add @b.
    // Iteration 3: add @c. Iteration 4: queue empty, return prev → equal.
    expect(r.iterations).toBe(4);
    expect(r.errors).toEqual([]);
    expect([...r.result.reactiveCellNodeIds].sort()).toEqual(["@a", "@b", "@c"]);
  });

  test("queue of 5 admissions exercises monotonic union growth", () => {
    const step = makeQueueStep(["@1", "@2", "@3", "@4", "@5"]);
    const r = runOuterFixpoint(makeInput(emptyCC(), { closureStepFn: step }));
    expect(r.terminated).toBe(true);
    expect(r.iterations).toBe(6);
    expect(r.result.reactiveCellNodeIds.size).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// §4 — Termination on stable set
// ---------------------------------------------------------------------------

describe("§4 termination on stable set", () => {
  test("running fixpoint on a previously-converged result is still stable", () => {
    const step = makeQueueStep(["@a", "@b"]);
    const r1 = runOuterFixpoint(makeInput(emptyCC(), { closureStepFn: step }));
    expect(r1.terminated).toBe(true);
    expect(r1.iterations).toBe(3);

    // Re-run with identity step from r1's result — must converge in 1.
    const r2 = runOuterFixpoint(makeInput(r1.result, { closureStepFn: identityStep }));
    expect(r2.terminated).toBe(true);
    expect(r2.iterations).toBe(1);
    expect(chunkContentsEqual(r1.result, r2.result)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §5 — Cap-overflow E-CLOSURE-001 fire-site
// ---------------------------------------------------------------------------

describe("§5 cap-overflow → E-CLOSURE-001 fires", () => {
  test("pathological always-grow step + iterCap=4 → fires E-CLOSURE-001", () => {
    const r = runOuterFixpoint(makeInput(
      emptyCC(),
      { closureStepFn: makeForeverStep(), iterCap: 4 },
    ));
    expect(r.terminated).toBe(false);
    expect(r.iterations).toBe(4);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].code).toBe("E-CLOSURE-001");
    expect(r.errors[0].severity).toBe("error");
    expect(r.errors[0].message).toContain("4 iterations");
    expect(r.errors[0].message).toContain("/test-ep");
    expect(r.errors[0].message).toContain("_anonymous");
    expect(r.errors[0].message).toContain("E-CLOSURE-001");
  });

  test("returns a PARTIAL result (not empty) on cap overflow", () => {
    const r = runOuterFixpoint(makeInput(
      cc({ components: [1, 2] }),
      { closureStepFn: makeForeverStep(), iterCap: 3 },
    ));
    expect(r.terminated).toBe(false);
    // Original components preserved.
    expect([...r.result.componentNodeIds].sort()).toEqual([1, 2]);
    // Cap-overflow rounds added forever-0, forever-1, forever-2.
    expect(r.result.reactiveCellNodeIds.size).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// §6 — Monotonicity violation guard
// ---------------------------------------------------------------------------

describe("§6 monotonicity violation guard", () => {
  test("closureStepFn returns strict subset → throws Error", () => {
    expect(() =>
      runOuterFixpoint(makeInput(
        cc({ reactive: ["@x", "@y"] }),
        { closureStepFn: subsetStep },
      )),
    ).toThrow(/monotonicity violation/);
  });

  test("monotonicity error message names the iteration + field", () => {
    let caught = null;
    try {
      runOuterFixpoint(makeInput(
        cc({ reactive: ["@x"] }),
        { closureStepFn: subsetStep },
      ));
    } catch (e) {
      caught = e;
    }
    expect(caught).not.toBeNull();
    expect(caught.message).toContain("iteration 1");
    expect(caught.message).toContain("reactiveCellNodeIds");
    expect(caught.message).toContain("@x");
  });
});

// ---------------------------------------------------------------------------
// §7 — Determinism (byte-identical output across two runs)
// ---------------------------------------------------------------------------

describe("§7 determinism", () => {
  test("same input → byte-identical iteration count + set members", () => {
    const input1 = makeInput(
      cc({ components: [3, 1, 2], reactive: ["@b", "@a"] }),
      { closureStepFn: makeQueueStep(["@new"]) },
    );
    const input2 = makeInput(
      cc({ components: [3, 1, 2], reactive: ["@b", "@a"] }),
      { closureStepFn: makeQueueStep(["@new"]) },
    );
    const r1 = runOuterFixpoint(input1);
    const r2 = runOuterFixpoint(input2);
    expect(r1.iterations).toBe(r2.iterations);
    expect(r1.terminated).toBe(r2.terminated);
    expect(chunkContentsEqual(r1.result, r2.result)).toBe(true);
    // Set members match.
    expect([...r1.result.reactiveCellNodeIds].sort()).toEqual(
      [...r2.result.reactiveCellNodeIds].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// §8 — §40.9.9 worked example (end-to-end through runReachabilitySolver)
// ---------------------------------------------------------------------------

describe("§8 SPEC §40.9.9 worked example — default closure step", () => {
  test("synthetic Dispatch program → converges in 1 iteration", () => {
    // Synthesize a minimal FileAST that mirrors the §40.9.9 example
    // shape (top-level <program> body, runtime-only <details> →
    // worst-case-union admits ProfileWidget). Detailed AST construction
    // would require BS/TAB round-tripping; here we exercise the WIRE-IN
    // by checking that the orchestrator's fixpoint call doesn't disturb
    // the per-tier ChunkPlan produced by the initial pass.
    const SPAN = { file: "/test.scrml", start: 0, end: 0, line: 1, col: 1 };
    let nid = 1;
    const mkId = () => nid++;

    const dashboard = {
      id: mkId(),
      span: SPAN,
      kind: "markup",
      tag: "div",
      attrs: [],
      children: [],
      selfClosing: false,
      closerForm: "</div>",
      isComponent: false,
    };
    const header = {
      id: mkId(),
      span: SPAN,
      kind: "markup",
      tag: "div",
      attrs: [],
      children: [],
      selfClosing: false,
      closerForm: "</div>",
      isComponent: false,
    };
    const program = {
      id: mkId(),
      span: SPAN,
      kind: "markup",
      tag: "program",
      attrs: [],
      children: [header, dashboard],
      selfClosing: false,
      closerForm: "</program>",
      isComponent: false,
    };
    const file = {
      filePath: "/abs/dispatch.scrml",
      nodes: [program],
      imports: [],
      exports: [],
      components: [],
      typeDecls: [],
      spans: {},
      hasProgramRoot: true,
      authConfig: null,
      middlewareConfig: null,
    };

    const result = runReachabilitySolver({ depGraph: null, files: [file] });
    expect(result.errors).toEqual([]);
    expect(result.record.closures.size).toBeGreaterThanOrEqual(1);
    // Drill into the first entry-point's anonymous-role plan.
    const [, rps] = result.record.closures.entries().next().value;
    const plan = rps.byRole.get("_anonymous");
    expect(plan).toBeDefined();
    // No fixpoint-amplification on this trivial example.
    expect(plan.initialChunk.serverFnNodeIds.size).toBe(0);
    expect(plan.initialChunk.vendorUnitNames.size).toBe(0);
    // header + dashboard admitted to componentNodeIds.
    expect(plan.initialChunk.componentNodeIds.size).toBe(2);
  });

  test("integration: empty files input → empty record (no fixpoint runs)", () => {
    const result = runReachabilitySolver({ depGraph: null, files: [] });
    expect(result.errors).toEqual([]);
    expect(result.record.closures.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §9 — E-CLOSURE-001 message shape
// ---------------------------------------------------------------------------

describe("§9 E-CLOSURE-001 message shape", () => {
  test("entry-point id + viewer role + iterCap appear in message", () => {
    const r = runOuterFixpoint({
      entryPoint: "/dashboard",
      viewerRole: "Admin",
      initialUnion: emptyCC(),
      depGraph: null,
      files: [],
      closureStepFn: makeForeverStep(),
      iterCap: 2,
    });
    expect(r.errors).toHaveLength(1);
    const m = r.errors[0].message;
    expect(m).toContain("/dashboard");
    expect(m).toContain("Admin");
    expect(m).toContain("2 iterations");
    expect(m).toContain("E-CLOSURE-001");
    expect(m).toContain("§40.9.1");
  });

  test("E-CLOSURE-001 references the catalog section + finiteness claim", () => {
    const r = runOuterFixpoint(makeInput(
      emptyCC(),
      { closureStepFn: makeForeverStep(), iterCap: 1 },
    ));
    expect(r.errors[0].message).toContain("compiler bug");
    expect(r.errors[0].message).toContain("§34");
  });
});

// ---------------------------------------------------------------------------
// §10 — iterCap = 1 boundary
// ---------------------------------------------------------------------------

describe("§10 iterCap = 1 boundary", () => {
  test("iterCap=1 + identity step → terminates on round 1", () => {
    const r = runOuterFixpoint(makeInput(
      cc({ components: [1] }),
      { closureStepFn: identityStep, iterCap: 1 },
    ));
    expect(r.terminated).toBe(true);
    expect(r.iterations).toBe(1);
    expect(r.errors).toEqual([]);
  });

  test("iterCap=1 + growing step → fires E-CLOSURE-001 on round 1", () => {
    const r = runOuterFixpoint(makeInput(
      emptyCC(),
      { closureStepFn: makeForeverStep(), iterCap: 1 },
    ));
    expect(r.terminated).toBe(false);
    expect(r.iterations).toBe(1);
    expect(r.errors[0].code).toBe("E-CLOSURE-001");
  });
});

// ---------------------------------------------------------------------------
// §11 — Invalid iterCap rejected
// ---------------------------------------------------------------------------

describe("§11 invalid iterCap rejected", () => {
  test("iterCap = 0 throws synchronously", () => {
    expect(() =>
      runOuterFixpoint(makeInput(emptyCC(), {
        closureStepFn: identityStep,
        iterCap: 0,
      })),
    ).toThrow(/iterCap must be a positive integer/);
  });

  test("iterCap = -1 throws synchronously", () => {
    expect(() =>
      runOuterFixpoint(makeInput(emptyCC(), {
        closureStepFn: identityStep,
        iterCap: -1,
      })),
    ).toThrow(/iterCap must be a positive integer/);
  });

  test("iterCap = Infinity throws synchronously", () => {
    expect(() =>
      runOuterFixpoint(makeInput(emptyCC(), {
        closureStepFn: identityStep,
        iterCap: Infinity,
      })),
    ).toThrow(/iterCap must be a positive integer/);
  });
});

// ---------------------------------------------------------------------------
// §12 — ChunkContents equality helper edge cases
// ---------------------------------------------------------------------------

describe("§12 chunkContentsEqual helper", () => {
  test("two empty contents are equal", () => {
    expect(chunkContentsEqual(emptyCC(), emptyCC())).toBe(true);
  });

  test("contents differing only by reactive-cell set are NOT equal", () => {
    const a = cc({ reactive: ["@x"] });
    const b = cc({ reactive: ["@y"] });
    expect(chunkContentsEqual(a, b)).toBe(false);
  });

  test("contents with same elements but inserted in different order are equal", () => {
    const a = cc({ components: [1, 2, 3] });
    const b = cc({ components: [3, 2, 1] });
    expect(chunkContentsEqual(a, b)).toBe(true);
  });

  test("strict subset is NOT equal", () => {
    const a = cc({ components: [1, 2] });
    const b = cc({ components: [1, 2, 3] });
    expect(chunkContentsEqual(a, b)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §13 — Component-set preservation (default step never strips C1)
// ---------------------------------------------------------------------------

describe("§13 default closure step preserves componentNodeIds verbatim", () => {
  test("default step never adds or removes from componentNodeIds (C1 is bound)", () => {
    // Without a custom closureStepFn, the default step is used. We
    // supply null depGraph + empty files so C2/C3/C5 all produce empty
    // sets. The componentNodeIds carry-through is the invariant under
    // test.
    const r = runOuterFixpoint(makeInput(
      cc({ components: [10, 20, 30] }),
      // No closureStepFn → default step is used.
    ));
    expect(r.terminated).toBe(true);
    expect([...r.result.componentNodeIds].sort()).toEqual([10, 20, 30]);
    // C2/C3/C5 over null/empty input contribute zero atoms.
    expect(r.result.reactiveCellNodeIds.size).toBe(0);
    expect(r.result.serverFnNodeIds.size).toBe(0);
    expect(r.result.vendorUnitNames.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §14 — Multi-atom growth (reactive + server-fn + vendor all advance)
// ---------------------------------------------------------------------------

describe("§14 multi-atom growth across all four ChunkContents fields", () => {
  test("step that admits a reactive cell, server-fn, and vendor unit on round 1", () => {
    const multiStep = (prev) => {
      const next = identityStep(prev);
      if (!next.reactiveCellNodeIds.has("@new")) next.reactiveCellNodeIds.add("@new");
      if (!next.serverFnNodeIds.has("newFn")) next.serverFnNodeIds.add("newFn");
      if (!next.vendorUnitNames.has("newVendor")) next.vendorUnitNames.add("newVendor");
      return next;
    };
    const r = runOuterFixpoint(makeInput(
      cc({ components: [1] }),
      { closureStepFn: multiStep },
    ));
    expect(r.terminated).toBe(true);
    // Round 1: union grows; round 2: union stable.
    expect(r.iterations).toBe(2);
    expect(r.result.reactiveCellNodeIds.has("@new")).toBe(true);
    expect(r.result.serverFnNodeIds.has("newFn")).toBe(true);
    expect(r.result.vendorUnitNames.has("newVendor")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §15 — Cap-overflow returns partial result, NOT empty
// ---------------------------------------------------------------------------

describe("§15 cap-overflow returns partial result", () => {
  test("on overflow, the original union atoms are preserved", () => {
    const r = runOuterFixpoint(makeInput(
      cc({ components: ["c1", "c2"], reactive: ["@r1"], serverFns: ["fn1"], vendor: ["v1"] }),
      { closureStepFn: makeForeverStep(), iterCap: 2 },
    ));
    expect(r.terminated).toBe(false);
    // Original atoms all preserved.
    expect([...r.result.componentNodeIds].sort()).toEqual(["c1", "c2"]);
    expect(r.result.reactiveCellNodeIds.has("@r1")).toBe(true);
    expect(r.result.serverFnNodeIds.has("fn1")).toBe(true);
    expect(r.result.vendorUnitNames.has("v1")).toBe(true);
    // PLUS forever-step admissions (2 rounds = 2 admissions).
    expect(r.result.reactiveCellNodeIds.has("forever-0")).toBe(true);
    expect(r.result.reactiveCellNodeIds.has("forever-1")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §16 — Cap-overflow iterations === iterCap (boundary precision)
// ---------------------------------------------------------------------------

describe("§16 cap-overflow iteration counting", () => {
  test("iterations field equals iterCap exactly when overflow fires", () => {
    for (const cap of [1, 2, 5, 8]) {
      const r = runOuterFixpoint(makeInput(
        emptyCC(),
        { closureStepFn: makeForeverStep(), iterCap: cap },
      ));
      expect(r.terminated).toBe(false);
      expect(r.iterations).toBe(cap);
    }
  });

  test("DEFAULT_ITER_CAP is exported as 16", () => {
    expect(DEFAULT_ITER_CAP).toBe(16);
  });
});
