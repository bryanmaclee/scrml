/**
 * @module reachability/outer-fixpoint
 *
 * Outer fixed-point operator — closes the A-2 Reachability Solver wave
 * per SPEC §40.9.1.
 *
 * S91 wave A-2.7 — implements the `closure(...)` outer operator over
 * the five-component union. Per SPEC §40.9.1 normative statements:
 *
 *   > "The outer `closure(...)` SHALL be a fixed-point over the same
 *    operators — adding a component to the set MAY admit further
 *    reactive deps, further server-fn calls, further auth gates,
 *    further vendor units; the fixed point is reached when no operator
 *    adds new elements."
 *
 *   > "The function SHALL terminate: the underlying graphs (reactive
 *    dep, server-fn call, auth, vendor) are finite, and the fixed-point
 *    operator is monotone over a finite lattice. If termination fails
 *    (cycle in the reachability graph that the closure operator does
 *    not collapse to a fixed point), the compiler SHALL emit
 *    `E-CLOSURE-001` (§40.9.11) and halt."
 *
 * Algorithm — `runOuterFixpoint(input)` returns the stabilized
 * `ChunkContents` for one (entry-point, role) pair OR a partial result
 * + `E-CLOSURE-001` when the iteration cap is reached:
 *
 *   prev := input.initialUnion
 *   for i in 1..iterCap:
 *     next := closureStep(prev)          // re-runs C2/C3/C5 over prev.componentNodeIds
 *     if setsEqual(next, prev):
 *       return { result: prev, iterations: i, terminated: true, errors: [] }
 *     assertMonotone(prev, next)         // next MUST be a superset; bug if not
 *     prev := next
 *   return {
 *     result: prev, iterations: iterCap, terminated: false,
 *     errors: [E-CLOSURE-001]
 *   }
 *
 * **Monotonicity invariant.** Each round's union MUST be a superset of
 * the previous. The fixpoint operator is monotone over a finite lattice
 * (per §40.9.1). If `next ⊄ prev` (i.e., elements were lost), that's a
 * bug in the closure-step body — the operator throws an `Error` rather
 * than silently producing an unsound playable surface.
 *
 * **Determinism.** Per SPEC §40.9.8, the closure analysis SHALL be
 * deterministic. Iteration order over node sets is canonical (sorted)
 * inside `closureStep`; the fixpoint loop itself is order-independent
 * because set equality is order-free.
 *
 * **Component 1 is NOT re-run.** Component 1 produces the INITIAL
 * component set from the entry-point root alone; subsequent rounds
 * enrich via the union admission, not via re-deriving initial state.
 * The fixpoint operates on the union as a whole — when the union grows
 * (e.g., C2 admits a new reactive cell whose write-set transitively
 * touches a new markup atom, OR C3 admits a server-fn whose body
 * references new reactive cells), Components 2/3/5 re-run against the
 * expanded `componentNodeIds` view.
 *
 * Cross-references:
 *   - SPEC.md §40.9.1 — five-component union + closure fixed point.
 *   - SPEC.md §40.9.8 — determinism preservation.
 *   - SPEC.md §40.9.11 — E-CLOSURE-001 catalog row.
 *   - SPEC.md §34 — E-CLOSURE-001 catalog row.
 *   - docs/changes/a2-reachability-solver-scoping/SCOPING.md §5 — A-2 wave decomposition.
 */

import type { FileAST } from "../types/ast.ts";
import type {
  ChunkContents,
  EntryPointId,
  NodeId,
  RoleVariant,
  RSError,
  VendorUnitId,
} from "../types/reachability.ts";
import type { ConstFoldEnv } from "../codegen/constant-folder.ts";
import {
  computeReactiveDepClosure,
  type ReadOnlyDependencyGraph as ReadOnlyDG_C2,
} from "./component-2.ts";
import {
  computeServerFnReachableWithin,
  type ReadOnlyDependencyGraph as ReadOnlyDG_C3,
} from "./component-3.ts";
import { computeVendorUnitsUsed } from "./component-5.ts";

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/**
 * Default iteration cap.
 *
 * Defensive — the underlying graphs (DG, AuthGraph, server-fn boundary,
 * vendor unit declarations) are finite, so anything beyond ~3-5
 * iterations on production-shape scrml apps indicates a graph anomaly.
 * 16 leaves a comfortable safety margin without permitting pathological
 * runaway. Per SPEC §40.9.1 the bound exists solely to surface
 * `E-CLOSURE-001` on a malformed graph — the operator is monotone over
 * a finite lattice and should terminate in O(graph-depth) rounds on
 * valid input.
 */
export const DEFAULT_ITER_CAP = 16;

// ---------------------------------------------------------------------------
// Input / output shapes
// ---------------------------------------------------------------------------

/**
 * Input bundle for `runOuterFixpoint`.
 *
 * The operator re-runs Components 2/3/5 each iteration; it therefore
 * carries the full closure-step input (depGraph, files, constant-folder
 * env). The `entryPoint` + `viewerRole` fields are diagnostic-only —
 * they participate in the `E-CLOSURE-001` message but do not affect the
 * algorithm.
 */
export interface OuterFixpointInput {
  entryPoint: EntryPointId;
  viewerRole: RoleVariant;
  /** Starting union — `C1 ∪ C2 ∪ C3 ∪ C4 ∪ C5` from the first pass. */
  initialUnion: ChunkContents;
  /** Stage 7 DG — passed through to C2/C3 re-runs. */
  depGraph: (ReadOnlyDG_C2 & ReadOnlyDG_C3) | null | undefined;
  /** Compile-unit FileAST set — passed through to C3/C5 re-runs. */
  files: FileAST[];
  /** Constant-folder env — currently unused by C2/C3/C5; reserved for symmetry with `computeInitiallyRenderedComponents`. */
  env?: ConstFoldEnv;
  /**
   * Iteration cap. Optional — defaults to `DEFAULT_ITER_CAP` (16). The
   * cap-overflow test in the conformance suite passes a small value
   * (e.g. 4) alongside an injected `closureStepFn` to exercise the
   * E-CLOSURE-001 fire-site.
   */
  iterCap?: number;
  /**
   * Optional closure-step override.
   *
   * The default behaviour re-runs Components 2/3/5 against the current
   * `prev.componentNodeIds` view of the union. Tests inject a custom
   * function to:
   *   - Exercise multi-round monotonic growth (closureStepFn admits a
   *     new id each round to verify iteration counting + termination
   *     detection).
   *   - Exercise the monotonicity-violation guard (closureStepFn
   *     returns a strict subset; the operator throws).
   *   - Exercise the cap-overflow path (closureStepFn admits one new
   *     id forever; iteration cap fires + E-CLOSURE-001 surfaces).
   *
   * Production callers always omit this field and use the default
   * closure step.
   */
  closureStepFn?: ClosureStepFn;
}

/**
 * Closure-step function signature.
 *
 * Takes the previous round's union and returns the next round's union
 * (the per-iteration enrichment of `prev` via C2/C3/C5 re-execution).
 *
 * Contract: `next` MUST be a superset of `prev` (monotonicity per
 * §40.9.1). The operator's monotonicity-guard asserts this and throws
 * `Error("monotonicity violation in closure step")` when the contract
 * is breached.
 */
export type ClosureStepFn = (prev: ChunkContents) => ChunkContents;

/**
 * Result of `runOuterFixpoint`.
 *
 * `terminated === true` indicates the operator reached a fixed point
 * within `iterCap` rounds; `errors` is empty in that case. When
 * `terminated === false` the operator hit the iteration cap and
 * `errors` carries the `E-CLOSURE-001` diagnostic — `result` is the
 * partial union at cap-overflow.
 */
export interface OuterFixpointResult {
  result: ChunkContents;
  iterations: number;
  terminated: boolean;
  errors: RSError[];
}

// ---------------------------------------------------------------------------
// Top-level entry point
// ---------------------------------------------------------------------------

/**
 * Run the outer fixed-point operator over the five-component union.
 *
 * Per SPEC §40.9.1 normative algorithm:
 *
 *   playable_surface(E, N) := closure(
 *     initially_rendered_components(E)
 *     ∪ reactive_dep_closure(...)
 *     ∪ server_fn_reachable_within(N, ...)
 *     ∪ auth_gated_boundaries_visible_to(...)
 *     ∪ vendor_units_used_by(...)
 *   )
 *
 * The outer `closure(...)` re-applies the operators until no new
 * elements are admitted. This function implements that operator over
 * the `ChunkContents` lattice (component ids × reactive cell ids ×
 * server-fn ids × vendor unit names, all under subset-ordering).
 *
 * Termination is guaranteed on valid input: the lattice is finite
 * (the underlying graphs are finite per §31 / §40 / §52 / §41) and the
 * closure step is monotone, so the operator is monotone over a finite
 * lattice and reaches a fixed point in O(lattice-height) rounds.
 *
 * The `iterCap` parameter is defensive — it surfaces `E-CLOSURE-001`
 * if the underlying assumption fails (a cycle the operator does not
 * collapse). Per §40.9.1: *"`E-CLOSURE-001` is defensive: it SHOULD
 * NOT fire on valid source"*.
 */
export function runOuterFixpoint(input: OuterFixpointInput): OuterFixpointResult {
  const iterCap = input.iterCap ?? DEFAULT_ITER_CAP;
  if (!Number.isFinite(iterCap) || iterCap < 1) {
    throw new Error(
      `outer-fixpoint: iterCap must be a positive integer; got ${input.iterCap}`,
    );
  }

  const step =
    input.closureStepFn ??
    makeDefaultClosureStep(input.entryPoint, input.depGraph, input.files, input.env);

  let prev = cloneChunkContents(input.initialUnion);
  let iterations = 0;

  for (let i = 0; i < iterCap; i++) {
    iterations = i + 1;
    const next = step(prev);
    assertMonotone(prev, next, iterations);
    if (chunkContentsEqual(prev, next)) {
      return { result: prev, iterations, terminated: true, errors: [] };
    }
    prev = next;
  }

  // Iteration cap reached without convergence — emit E-CLOSURE-001
  // per SPEC §40.9.1.
  const err: RSError = {
    code: "E-CLOSURE-001",
    severity: "error",
    message: closureCapMessage(input.entryPoint, input.viewerRole, iterCap),
  };
  return { result: prev, iterations, terminated: false, errors: [err] };
}

// ---------------------------------------------------------------------------
// Default closure-step — re-runs C2 + C3 + C5 over prev.componentNodeIds
// ---------------------------------------------------------------------------

/**
 * Build a closure-step function bound to a single entry point.
 *
 * The returned function takes the previous round's `ChunkContents` and
 * produces the next round's union by:
 *
 *   1. Treating `prev.componentNodeIds` as the C1 input for this round.
 *   2. Re-running Component 2 (`reactive_dep_closure`) over that set;
 *      unioning the result into the carried `reactiveCellNodeIds`.
 *   3. Re-running Component 3 (`server_fn_reachable_within`) over that
 *      set + the call-graph; unioning ALL tier server-fn ids into the
 *      carried `serverFnNodeIds` (the per-tier difference happens at
 *      the orchestrator's chunk-plan materialization step, not here —
 *      the fixpoint operates over the playable-surface superset).
 *   4. Re-running Component 5 (`vendor_units_used_by`) over that set;
 *      unioning the result into the carried `vendorUnitNames`.
 *
 * Component 1 is NOT re-run — per SPEC §40.9.1, the initial component
 * set is bound to the entry point's root and does not change across
 * iterations. The fixpoint enrichment happens via the union: if C2/C3
 * admits a new cell or server-fn whose downstream graph touches a new
 * markup id, the next iteration's `componentNodeIds` view (carried
 * through from the previous round) is the canonical handle.
 *
 * **Pass-through invariant:** the carried `componentNodeIds` is
 * preserved verbatim — the closure step does not strip components.
 * The C4-per-role filter is applied at the orchestrator level AFTER
 * the fixpoint converges, not inside the step.
 */
function makeDefaultClosureStep(
  entryPoint: EntryPointId,
  depGraph: (ReadOnlyDG_C2 & ReadOnlyDG_C3) | null | undefined,
  files: FileAST[],
  _env: ConstFoldEnv | undefined,
): ClosureStepFn {
  // Synthesize the single-entry-point input map shape that C2/C3/C5
  // expect. The closure step constructs a fresh single-entry map per
  // call so the re-runs operate on the CURRENT round's component view.
  return function defaultClosureStep(prev: ChunkContents): ChunkContents {
    const componentSet = canonicalSortedSet(prev.componentNodeIds);
    const epMap = new Map<EntryPointId, Set<NodeId>>();
    epMap.set(entryPoint, componentSet);

    // Component 2 — reactive_dep_closure over prev's componentNodeIds.
    const reactiveByEp = computeReactiveDepClosure(epMap, depGraph);
    const newReactive = reactiveByEp.get(entryPoint) ?? new Set<NodeId>();

    // Component 3 — server_fn_reachable_within over prev's componentNodeIds.
    // Union all tiers — the fixpoint operates on the playable-surface
    // SUPERSET. Tier differencing is the orchestrator's concern at
    // ChunkPlan materialization.
    const serverFnByEp = computeServerFnReachableWithin(epMap, files, depGraph);
    const tiers = serverFnByEp.get(entryPoint) ?? {
      tier0: new Set<NodeId>(),
      tier1: new Set<NodeId>(),
      tier2: new Set<NodeId>(),
    };
    const newServerFns = new Set<NodeId>();
    addAll(newServerFns, tiers.tier0);
    addAll(newServerFns, tiers.tier1);
    addAll(newServerFns, tiers.tier2);

    // Component 5 — vendor_units_used_by over prev's componentNodeIds.
    const vendorByEp = computeVendorUnitsUsed(epMap, files);
    const newVendor = vendorByEp.get(entryPoint) ?? new Set<VendorUnitId>();

    // Union the new sets into the carried previous-round sets to
    // produce the next-round superset. componentNodeIds is preserved
    // verbatim (Component 1 is not re-run).
    return {
      componentNodeIds: new Set(prev.componentNodeIds),
      reactiveCellNodeIds: unionSet(prev.reactiveCellNodeIds, newReactive),
      serverFnNodeIds: unionSet(prev.serverFnNodeIds, newServerFns),
      vendorUnitNames: unionSet(prev.vendorUnitNames, newVendor),
    };
  };
}

// ---------------------------------------------------------------------------
// Set / ChunkContents helpers
// ---------------------------------------------------------------------------

/**
 * Produce a deterministic iteration view of a set.
 *
 * Per SPEC §40.9.8: closure analysis is deterministic. When the
 * closure step builds the next-round component view, it iterates the
 * previous set in canonical (sorted) order so the C2/C3/C5 re-runs
 * see the same input shape on every call.
 */
function canonicalSortedSet(set: Set<NodeId>): Set<NodeId> {
  const arr = Array.from(set).sort((a, b) => {
    const sa = String(a);
    const sb = String(b);
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  });
  return new Set(arr);
}

function unionSet<T>(a: Set<T>, b: Set<T>): Set<T> {
  const out = new Set<T>(a);
  for (const v of b) out.add(v);
  return out;
}

function addAll<T>(target: Set<T>, src: Set<T>): void {
  for (const v of src) target.add(v);
}

function cloneChunkContents(cc: ChunkContents): ChunkContents {
  return {
    componentNodeIds: new Set(cc.componentNodeIds),
    reactiveCellNodeIds: new Set(cc.reactiveCellNodeIds),
    serverFnNodeIds: new Set(cc.serverFnNodeIds),
    vendorUnitNames: new Set(cc.vendorUnitNames),
  };
}

/**
 * Set-equality across all four atoms of a `ChunkContents` value.
 *
 * Used as the fixed-point detector: when the next round's union is
 * pointwise-equal to the previous round's union, the operator has
 * converged.
 */
export function chunkContentsEqual(a: ChunkContents, b: ChunkContents): boolean {
  return (
    setsEqual(a.componentNodeIds, b.componentNodeIds) &&
    setsEqual(a.reactiveCellNodeIds, b.reactiveCellNodeIds) &&
    setsEqual(a.serverFnNodeIds, b.serverFnNodeIds) &&
    setsEqual(a.vendorUnitNames, b.vendorUnitNames)
  );
}

function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) {
    if (!b.has(v)) return false;
  }
  return true;
}

/**
 * Monotonicity invariant guard.
 *
 * Per SPEC §40.9.1: *"the fixed-point operator is monotone over a
 * finite lattice"*. Each round's union MUST be a superset of the
 * previous. If a closure step ever returns a STRICT subset (or even
 * loses a single element), that is a bug in the closure-step body —
 * the playable surface would be unsound (under-inclusion is the
 * disallowed failure mode per §40.9.2).
 *
 * Throws `Error` with a diagnostic message naming the iteration index
 * + the lost element kind. The operator does NOT recover; the throw
 * surfaces a compiler-bug-class condition that should be fixed at the
 * source.
 */
function assertMonotone(
  prev: ChunkContents,
  next: ChunkContents,
  iteration: number,
): void {
  checkSubset(prev.componentNodeIds, next.componentNodeIds, "componentNodeIds", iteration);
  checkSubset(prev.reactiveCellNodeIds, next.reactiveCellNodeIds, "reactiveCellNodeIds", iteration);
  checkSubset(prev.serverFnNodeIds, next.serverFnNodeIds, "serverFnNodeIds", iteration);
  checkSubset(prev.vendorUnitNames, next.vendorUnitNames, "vendorUnitNames", iteration);
}

function checkSubset<T>(
  prev: Set<T>,
  next: Set<T>,
  fieldName: string,
  iteration: number,
): void {
  for (const v of prev) {
    if (!next.has(v)) {
      throw new Error(
        `outer-fixpoint: monotonicity violation at iteration ${iteration} — ` +
          `closure step lost element \`${String(v)}\` from ${fieldName} ` +
          `(prev.size=${prev.size}, next.size=${next.size}). ` +
          `The fixpoint operator requires the closure step to be monotone ` +
          `(next ⊇ prev) per SPEC §40.9.1; subset-returning steps indicate ` +
          `a bug in Component 2/3/5 or the orchestrator's closure-step builder.`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Diagnostic message builder
// ---------------------------------------------------------------------------

function closureCapMessage(
  entryPoint: EntryPointId,
  viewerRole: RoleVariant,
  iterCap: number,
): string {
  return (
    `Closure analysis failed to terminate within ${iterCap} iterations for ` +
    `entry point \`${entryPoint}\` (viewer role \`${viewerRole}\`). ` +
    `Per SPEC §40.9.1 the underlying graphs (§31 DG, §40 auth, §52 server-fn, ` +
    `§41 vendor) are finite, so the fixed-point operator MUST terminate on ` +
    `valid source. This diagnostic is defensive — if observed, file a compiler ` +
    `bug per SPEC §34 catalog row E-CLOSURE-001: indicates either a missing ` +
    `fixed-point fold case in the Stage 7.6 Reachability Solver or a divergence ` +
    `between the input graphs and their finiteness guarantees.`
  );
}
