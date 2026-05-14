/**
 * @module reachability-solver
 *
 * Reachability Solver — PIPELINE Stage 7.6 (SPEC §40.9).
 *
 * Runs between Stage 7.5 (Batch Planner) and Stage 8 (Code Generator)
 * on the finalized, lift-checked dependency graph. Consumes DG +
 * RouteMap + AuthGraph + ServerFnBoundary + VendorUnitDeclarations +
 * RoleEnum + (informational) BatchPlan and produces a per-entry-point
 * per-role ChunkPlan tree per SPEC §40.9.7.
 *
 * **A-2.5 (S90):** Components 1 + 2 + 3 + 4 + 5 wired through the
 * orchestrator. Remaining waves: A-2.7 (outer fixed-point operator).
 *
 * Wave decomposition:
 *
 *   - A-2.2 — Component 1: initially_rendered_components + entry-point
 *             enumeration (§40.9.2).
 *   - A-2.3 — Component 2: reactive_dep_closure (§40.9.3).
 *   - A-2.4 — Component 3: server_fn_reachable_within +
 *             interaction-graph projection (§40.9.4).
 *   - A-2.5 — Component 4: auth_gated_boundaries_visible_to +
 *             AuthGraph consumption (§40.9.5).
 *   - A-2.6 — Component 5: vendor_units_used_by (§40.9.6).
 *   - A-2.7 — outer fixed-point operator + E-CLOSURE-001 (§40.9.1).
 *   - A-2.8 — JSON serialization for --emit-reachability (A-2.1 wires
 *             a minimal serializer here so the CLI flag is functional;
 *             A-2.8 upgrades it to canonical key-ordering).
 *
 * The current body returns an empty `ReachabilityRecord` for every
 * input. Determinism + monotonicity (PIPELINE Stage 7.6 lines 2391-2392)
 * are trivially satisfied — the empty record IS the deterministic
 * floor; subsequent waves extend rather than replace.
 *
 * Cross-references:
 *   - SPEC.md §40.9 — Closure Analysis (Minimal Playable Surface).
 *   - SPEC.md §40.9.1 — five-component union + closure fixed point.
 *   - SPEC.md §40.9.11 — E-CLOSURE-001 + W-AUTH-RUNTIME-FALLBACK codes.
 *   - PIPELINE.md Stage 7.6 (lines 2332-2412) — verbatim contract.
 *   - docs/changes/a2-reachability-solver-scoping/SCOPING.md §5 — A-2 wave decomposition.
 */

import {
  type ChunkContents,
  type ChunkPlan,
  type EntryPointId,
  type NodeId,
  type ReachabilityRecord,
  type RolePlayableSurface,
  type RoleVariant,
  type RSInput,
  type RSOutput,
  type RSError,
  emptyReachabilityRecord,
} from "./types/reachability.ts";
import type { FileAST } from "./types/ast.ts";
import { enumerateEntryPoints } from "./reachability/entry-points.ts";
import { computeInitiallyRenderedComponents } from "./reachability/component-1.ts";
import {
  computeReactiveDepClosure,
  type ReadOnlyDependencyGraph,
} from "./reachability/component-2.ts";
import { computeServerFnReachableWithin } from "./reachability/component-3.ts";
import {
  ANONYMOUS_ROLE,
  computeAuthGatedBoundariesVisibleTo,
  isVisibleForRole,
  type Component4Result,
} from "./reachability/component-4.ts";
import { computeVendorUnitsUsed } from "./reachability/component-5.ts";
import { runOuterFixpoint } from "./reachability/outer-fixpoint.ts";
import type { VendorUnitId } from "./types/reachability.ts";
import type { ConstFoldEnv } from "./codegen/constant-folder.ts";

// ---------------------------------------------------------------------------
// Anonymous-viewer role — re-exported from Component 4 for backwards-compat
// ---------------------------------------------------------------------------
//
// PIPELINE Stage 7.6 line 2380 canonical name for the synthesized
// anonymous viewer variant. Component 4 (A-2.5) owns the canonical
// constant; the orchestrator imports it as the floor for the
// no-AuthGraph case.

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Run the Stage 7.6 Reachability Solver.
 *
 * **A-2.7 (S91):** Outer fixed-point operator wired. After Components
 * 1-5 produce the initial union for each (entry-point, role) pair, the
 * orchestrator runs `runOuterFixpoint` over the union per SPEC §40.9.1.
 * The fixed point is reached when no operator (C2 / C3 / C5) adds new
 * elements to the union. `E-CLOSURE-001` (§40.9.11) surfaces when the
 * iteration cap (default 16 per `DEFAULT_ITER_CAP`) is reached without
 * convergence — defensive, SHOULD NOT fire on valid source given the
 * finite-graph guarantees of §31 / §40 / §52 / §41.
 *
 * **A-2.5 (S90):** Component 4 (`auth_gated_boundaries_visible_to`)
 * lands. Per-role ChunkPlan emission replaces the single-anonymous
 * floor: each entry point's `RolePlayableSurface.byRole` carries one
 * ChunkPlan per role variant when the application declares a role
 * enum (§40.1.1); the single-anonymous floor is preserved for
 * applications with no enum or `isImplicitAnonymous === true`.
 *
 * Current scope:
 *   1. Enumerate entry points from `input.files` per §40.8 shapes.
 *   2. For each entry point, compute `initially_rendered_components`
 *      per §40.9.2 (Component 1) — populates `ChunkContents.componentNodeIds`.
 *   3. For each entry point, compute `reactive_dep_closure` per
 *      §40.9.3 (Component 2) — populates `ChunkContents.reactiveCellNodeIds`.
 *      Walks the post-A-1 DG forward from the markup-read substrate
 *      across `reads`/`validator-reads`/`engine-derived-reads` edges
 *      (per OQ-A2-J disposition).
 *   4. For each entry point, compute `server_fn_reachable_within(N, C_set)`
 *      for N ∈ {0, 1, 2} per §40.9.4 (Component 3) — populates
 *      `serverFnNodeIds` for `initialChunk` (tier 0) + `prefetchTier1`
 *      (tier 1 − tier 0) + `prefetchTier2` (tier 2 − tier 1). Per
 *      OQ-A2-B Option a: N=0/N=1/N=2 only; N≥3 on-demand at runtime,
 *      not surfaced in the chunk plan.
 *   5. For each entry point, compute `vendor_units_used_by` per
 *      §40.9.6 (Component 5) — populates `ChunkContents.vendorUnitNames`.
 *      Opacity rule: each §41 vendor unit is admitted as a whole
 *      atom (no internal graph subdivision).
 *   6. (A-2.5) Run Component 4 — derive effective role list +
 *      per-gate per-role visibility verdicts + gate-ancestry index
 *      from the AuthGraph. Stream W-AUTH-RUNTIME-FALLBACK (info) and
 *      E-CLOSURE-002 (error) diagnostics into the orchestrator's
 *      `errors` output.
 *   7. Emit per-role ChunkPlans: one ChunkPlan per entry-point per
 *      effective role variant. Components inside an auth gate
 *      classified OUT for the current role are filtered out of that
 *      role's plan; RUNTIME-FALLBACK gates do NOT drop (eager-ship).
 *      Single-anonymous-keyed emission preserved when the application
 *      has no role enum or roleEnum.isImplicitAnonymous === true.
 *
 * **Determinism:** entry points + walked nodes are emitted in source
 * order (PIPELINE Stage 7.6 line 2391).
 *
 * **No mutation:** does not mutate `input`. PIPELINE Stage 7.6 line 2393.
 *
 * **Termination:** Component 1 is O(markup-nodes); Component 2 is
 * O(|C| × |MarkupReads| + |reactive-edges|) with a visited-set
 * cycle guard. Component 3 is O(|markup-spine| + |call-graph-edges|)
 * also with a visited-set cycle guard. Component 5 is
 * O(|files| × imports + |C|) — single pass per file + per-component
 * file lookup. No fixed-point iteration at this wave; that lands at A-2.7.
 */
export function runReachabilitySolver(input: RSInput): RSOutput {
  const record: ReachabilityRecord = emptyReachabilityRecord();
  const errors: RSError[] = [];

  // `files` is the list of typed file ASTs from META. When the field
  // is missing (e.g. unit tests bypassing the pipeline) we degrade
  // gracefully to the empty record — matches A-2.1 scaffold behavior.
  const files = (input.files as FileAST[] | undefined) ?? [];
  if (files.length === 0) {
    return { record, errors };
  }

  // Component 1 — entry-point enumeration + initially-rendered set.
  const entryPoints = enumerateEntryPoints(files);
  const env: ConstFoldEnv = { constBindings: new Map() };
  const irc = computeInitiallyRenderedComponents(entryPoints, files, env);

  // Component 2 — reactive-dep closure over the post-A-1 DG. The DG
  // is duck-typed at the boundary; when absent (tests bypassing the
  // full pipeline) Component 2 returns empty closures per entry point.
  const dg = input.depGraph as ReadOnlyDependencyGraph | null | undefined;
  const reactiveClosures = computeReactiveDepClosure(irc, dg);

  // Component 3 (A-2.4) — `server_fn_reachable_within` at N=0/N=1/N=2.
  // Builds the interaction-graph projection per OQ-A2-H Option α
  // (pure AST projection — no DG extension). Returns cumulative
  // tier-0/tier-1/tier-2 sets per entry point; ChunkPlan construction
  // (below) differences them into per-tier admission per §40.9.7.
  const serverFnByEntry = computeServerFnReachableWithin(irc, files, dg);

  // Component 5 — §41 vendor units referenced by each entry point's
  // component set. Opacity rule (§40.9.6): the vendor unit's internal
  // module graph is NOT subdivided; Component 5 admits the unit as a
  // whole by VendorUnitId. Per-unit chunking is A-4's concern.
  const vendorUnits = computeVendorUnitsUsed(irc, files);

  // Component 4 (A-2.5) — auth-gated boundaries visible per role. The
  // AuthGraph is duck-typed at the boundary; when absent (unit tests
  // bypassing A-3 or pipeline configurations where A-3 hasn't wired in
  // yet, e.g. before A-3.5) Component 4 degrades to the
  // single-anonymous-role floor (no gates, no role enum, no per-role
  // filtering). The diagnostics stream from C4 — W-AUTH-RUNTIME-FALLBACK
  // info-level lint per OQ-A2-I + E-CLOSURE-002 error per OQ-A2-F — is
  // unioned into the orchestrator's `errors` output verbatim.
  const c4 = computeAuthGatedBoundariesVisibleTo(input.authGraph, files);
  for (const e of c4.errors) errors.push(e);

  // Materialize per-entry-point per-role ChunkPlans.
  //
  // Per-role emission shape (A-2.5 structural extension):
  //   - When `c4.effectiveRoles === ["_anonymous"]` (no role enum or
  //     implicit-anonymous) the inner loop runs once per entry point
  //     with role = "_anonymous" — matches the pre-A-2.5 behaviour
  //     (single-keyed ChunkPlan).
  //   - When `c4.effectiveRoles.length > 1` the loop runs once per
  //     role; each iteration filters the closure's componentNodeIds
  //     by per-role gate-ancestry visibility (Component 4's
  //     `gateAncestry` × `gateVisibility`). Markup nodes inside a gate
  //     classified OUT for the current role are dropped from that
  //     role's plan. RUNTIME-FALLBACK gates do NOT drop (eager-ship
  //     per §40.9.5).
  //
  // Per-role filtering is currently applied to `componentNodeIds`
  // only. Reactive cells (Component 2) carry DG node ids that have no
  // direct markup-tree ancestry through the present pipeline; same
  // for server-fns (Component 3). Per-cell / per-server-fn gating is
  // out of scope for A-2.5 — admission proceeds at the entry-point
  // closure level for these, matching the conservative ship-eagerly
  // floor (§40.9.5 runtime-fallback semantics). The follow-up at
  // A-2.7 (outer fixpoint) and A-4 (artifact splitter) will refine.
  // Vendor units are per-file declarations (§40.9.6 opacity rule) and
  // are not filtered per role for the same reason.
  for (const ep of entryPoints) {
    const componentIds: Set<NodeId> = irc.get(ep.id) ?? new Set();
    const reactiveCellIds: Set<NodeId> =
      reactiveClosures.get(ep.id) ?? new Set();
    const serverFnTiers = serverFnByEntry.get(ep.id) ?? {
      tier0: new Set<NodeId>(),
      tier1: new Set<NodeId>(),
      tier2: new Set<NodeId>(),
    };
    const vendorUnitNames: Set<VendorUnitId> =
      vendorUnits.get(ep.id) ?? new Set();

    const rps: RolePlayableSurface = { byRole: new Map() };
    for (const role of c4.effectiveRoles) {
      const roleComponents = filterComponentsByRole(componentIds, role, c4);

      // -------------------------------------------------------------
      // A-2.7 — outer fixpoint over the five-component union.
      // -------------------------------------------------------------
      //
      // Build the initial union (`C1 ∪ C2 ∪ C3 ∪ C4 ∪ C5`) for this
      // (entry-point, role) pair. The fixpoint operator iterates until
      // no operator (C2 / C3 / C5) admits new elements. C1 is NOT
      // re-run — the entry-point seed is bound; the fixpoint enriches
      // via the leaf-atom unions.
      //
      // The fixpoint's `serverFnNodeIds` field carries the UNION of
      // all tier sets (per-tier differencing happens at chunk-plan
      // materialization, not inside the fixpoint). Tier1/tier2 deltas
      // are preserved from the initial-pass Component 3 output —
      // Component 3 is pure-functional given the same componentSet +
      // DG + files, so re-running it inside the fixpoint produces the
      // same tier shape on stable input.
      //
      // E-CLOSURE-001 surfaces as a per-(entry-point, role) error when
      // the iteration cap is reached without convergence.
      const initialUnion = {
        componentNodeIds: roleComponents,
        reactiveCellNodeIds: reactiveCellIds,
        // Union all tiers for the fixpoint's playable-surface superset.
        serverFnNodeIds: unionTierIds(serverFnTiers),
        vendorUnitNames,
      };
      const fp = runOuterFixpoint({
        entryPoint: ep.id,
        viewerRole: role,
        initialUnion,
        depGraph: dg as any,
        files,
        env,
      });
      for (const e of fp.errors) errors.push(e);

      const plan = makeChunkPlanFromFixpoint(
        fp.result,
        serverFnTiers,
        vendorUnitNames,
      );
      rps.byRole.set(role, plan);
    }
    record.closures.set(ep.id satisfies EntryPointId, rps);
  }

  return { record, errors };
}

/**
 * Union the per-tier server-fn id sets (tier0 ∪ tier1 ∪ tier2) into a
 * single superset for the fixpoint's `serverFnNodeIds` field.
 *
 * The fixpoint operates over the playable-surface SUPERSET (Σ_N
 * playable_surface(E, N) for N=0..2); per-tier differencing is
 * preserved at chunk-plan materialization.
 */
function unionTierIds(t: {
  tier0: Set<NodeId>;
  tier1: Set<NodeId>;
  tier2: Set<NodeId>;
}): Set<NodeId> {
  const out = new Set<NodeId>(t.tier0);
  for (const v of t.tier1) out.add(v);
  for (const v of t.tier2) out.add(v);
  return out;
}

/**
 * Filter a closure's componentNodeIds set by per-role gate-ancestry
 * visibility.
 *
 * For each markup id in the input set, look up its ancestor gate chain
 * (via `c4.gateAncestry`) and the per-role visibility of each ancestor
 * (via `c4.gateVisibility`). The component is admitted to the role's
 * plan iff `isVisibleForRole` returns true (no ancestor gate is OUT for
 * the role; RUNTIME-FALLBACK ancestors do not drop).
 *
 * Short-circuits when `c4.effectiveRoles.length === 1` AND the role IS
 * `_anonymous` AND the ancestry index is empty — preserves the
 * pre-A-2.5 zero-filter floor for the trivial case.
 */
function filterComponentsByRole(
  componentIds: Set<NodeId>,
  role: RoleVariant,
  c4: Component4Result,
): Set<NodeId> {
  // Floor: no gates at all — nothing to filter, return the input set.
  if (c4.gateVisibility.size === 0) {
    return new Set(componentIds);
  }
  const out = new Set<NodeId>();
  for (const id of componentIds) {
    if (isVisibleForRole(id, role, c4.gateVisibility, c4.gateAncestry)) {
      out.add(id);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// ChunkPlan construction
// ---------------------------------------------------------------------------

/**
 * Build the per-tier ChunkPlan for a single (entry-point, role) pair
 * from the outer-fixpoint result.
 *
 * The fixpoint output (`fp.result`) carries the post-closure
 * playable-surface SUPERSET for this (entry-point, role) pair:
 * `componentNodeIds` (post-per-role-filter), `reactiveCellNodeIds`
 * (post-C2-enrichment), `serverFnNodeIds` (union of all tiers,
 * post-C3-enrichment), and `vendorUnitNames` (post-C5-enrichment).
 *
 * The orchestrator decomposes the server-fn superset back into per-tier
 * deltas via the initial-pass Component 3 output (`serverFnTiers`):
 *   - `initialChunk.serverFnNodeIds` = tier-0 ∪ any fixpoint-admitted
 *     server-fns that are NOT in tier0/tier1/tier2 (eager-ship floor —
 *     newly-admitted server-fns from the fixpoint enrichment go to the
 *     initial chunk since we have no tier metadata for them).
 *   - `prefetchTier1.serverFnNodeIds` = tier-1 − tier-0 (initial-pass
 *     tier-cumulative delta; preserved verbatim).
 *   - `prefetchTier2.serverFnNodeIds` = tier-2 − tier-1.
 *
 * Reactive cells + components + vendor units use the fixpoint result
 * verbatim — they are not tiered per the §40.9.7 contract (tiers
 * differentiate server-fn prefetch cadence; components/reactive/vendor
 * ship as part of the initial chunk).
 *
 * Monotonicity (PIPELINE Stage 7.6 line 2392) is preserved: the
 * initial-pass tier sets are tier-cumulative by C3 construction; the
 * fixpoint enriches without reordering.
 */
function makeChunkPlanFromFixpoint(
  fpResult: ChunkContents,
  serverFnTiers: { tier0: Set<NodeId>; tier1: Set<NodeId>; tier2: Set<NodeId> },
  initialPassVendorUnits: Set<VendorUnitId>,
): ChunkPlan {
  // Identify any server-fns admitted by the fixpoint that are NOT in
  // the initial-pass tier sets. These come from fixpoint-driven
  // enrichment (e.g., a custom closureStepFn in tests, or a future
  // feedback edge from C2/C5 admitting components that C3 then sees).
  // Eager-ship them in the initial chunk — no tier metadata available.
  const fixpointAdmittedExtras = new Set<NodeId>();
  for (const id of fpResult.serverFnNodeIds) {
    if (!serverFnTiers.tier2.has(id)) fixpointAdmittedExtras.add(id);
  }

  const initialServerFns = new Set<NodeId>(serverFnTiers.tier0);
  for (const id of fixpointAdmittedExtras) initialServerFns.add(id);

  return {
    initialChunk: {
      componentNodeIds: new Set(fpResult.componentNodeIds),
      reactiveCellNodeIds: new Set(fpResult.reactiveCellNodeIds),
      serverFnNodeIds: initialServerFns,
      vendorUnitNames: new Set(fpResult.vendorUnitNames),
    },
    prefetchTier1: {
      componentNodeIds: new Set(),
      reactiveCellNodeIds: new Set(),
      serverFnNodeIds: differenceSet(serverFnTiers.tier1, serverFnTiers.tier0),
      vendorUnitNames: new Set(),
    },
    prefetchTier2: {
      componentNodeIds: new Set(),
      reactiveCellNodeIds: new Set(),
      serverFnNodeIds: differenceSet(serverFnTiers.tier2, serverFnTiers.tier1),
      vendorUnitNames: new Set(),
    },
    prefetchTierN: [],
  };
}

function differenceSet<T>(a: Set<T>, b: Set<T>): Set<T> {
  const out = new Set<T>();
  for (const v of a) if (!b.has(v)) out.add(v);
  return out;
}

// ---------------------------------------------------------------------------
// JSON serialization — A-2.1 minimal scaffold + A-2.8 canonicalization target
// ---------------------------------------------------------------------------

/**
 * Serialize a `ReachabilityRecord` to JSON for the `--emit-reachability`
 * CLI flag.
 *
 * **A-2.1 scaffold:** emits a well-formed empty-shape JSON document.
 * Maps are serialized as objects with sorted string keys; Sets as
 * sorted arrays. The shape mirrors the TypeScript surface verbatim
 * so downstream tests can assert structure without depending on the
 * algorithm.
 *
 * **A-2.8 will replace this body** with the canonical-key-ordering
 * serializer per PIPELINE Stage 7.6 line 2391 determinism invariant.
 * The signature is stable.
 */
export function serializeReachabilityRecord(record: ReachabilityRecord): string {
  const closures: Record<string, unknown> = {};
  // Sort entry-point keys for deterministic output.
  const epKeys = Array.from(record.closures.keys()).sort();
  for (const ep of epKeys) {
    const rps = record.closures.get(ep);
    if (!rps) continue;
    const byRole: Record<string, unknown> = {};
    const roleKeys = Array.from(rps.byRole.keys()).sort();
    for (const role of roleKeys) {
      const plan = rps.byRole.get(role);
      if (!plan) continue;
      byRole[role] = {
        initialChunk: serializeChunkContents(plan.initialChunk),
        prefetchTier1: serializeChunkContents(plan.prefetchTier1),
        prefetchTier2: serializeChunkContents(plan.prefetchTier2),
        prefetchTierN: plan.prefetchTierN.map(serializeChunkContents),
      };
    }
    closures[ep] = { byRole };
  }

  const diagnostics = record.diagnostics.map((d) => ({
    code: d.code,
    severity: d.severity,
    message: d.message,
    ...(d.entryPoint !== undefined ? { entryPoint: d.entryPoint } : {}),
    ...(d.role !== undefined ? { role: d.role } : {}),
  }));

  return JSON.stringify({ closures, diagnostics }, null, 2);
}

function serializeChunkContents(cc: {
  componentNodeIds: Set<unknown>;
  reactiveCellNodeIds: Set<unknown>;
  serverFnNodeIds: Set<unknown>;
  vendorUnitNames: Set<unknown>;
}): Record<string, unknown> {
  return {
    componentNodeIds: sortedArrayFromSet(cc.componentNodeIds),
    reactiveCellNodeIds: sortedArrayFromSet(cc.reactiveCellNodeIds),
    serverFnNodeIds: sortedArrayFromSet(cc.serverFnNodeIds),
    vendorUnitNames: sortedArrayFromSet(cc.vendorUnitNames),
  };
}

function sortedArrayFromSet(set: Set<unknown>): unknown[] {
  return Array.from(set).sort((a, b) => {
    const sa = String(a);
    const sb = String(b);
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  });
}
