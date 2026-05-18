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

  // PGO P1.2 — per-component timing instrumentation (zero overhead
  // when `debugPerf` is unset; the `performance.now()` calls are
  // guarded by the flag so the disabled path issues no host calls).
  const debugPerf = input.debugPerf === true;
  const perfLog = input.log ?? ((msg: string) => console.log(msg));

  // Component 1 — entry-point enumeration + initially-rendered set.
  const c1Start = debugPerf ? performance.now() : 0;
  const entryPoints = enumerateEntryPoints(files);
  const env: ConstFoldEnv = { constBindings: new Map() };
  const irc = computeInitiallyRenderedComponents(entryPoints, files, env);
  const c1Ms = debugPerf ? performance.now() - c1Start : 0;

  // Component 2 — reactive-dep closure over the post-A-1 DG. The DG
  // is duck-typed at the boundary; when absent (tests bypassing the
  // full pipeline) Component 2 returns empty closures per entry point.
  const dg = input.depGraph as ReadOnlyDependencyGraph | null | undefined;
  const c2Start = debugPerf ? performance.now() : 0;
  const reactiveClosures = computeReactiveDepClosure(irc, dg);
  const c2Ms = debugPerf ? performance.now() - c2Start : 0;

  // Component 3 (A-2.4) — `server_fn_reachable_within` at N=0/N=1/N=2.
  // Builds the interaction-graph projection per OQ-A2-H Option α
  // (pure AST projection — no DG extension). Returns cumulative
  // tier-0/tier-1/tier-2 sets per entry point; ChunkPlan construction
  // (below) differences them into per-tier admission per §40.9.7.
  const c3Start = debugPerf ? performance.now() : 0;
  const serverFnByEntry = computeServerFnReachableWithin(irc, files, dg);
  const c3Ms = debugPerf ? performance.now() - c3Start : 0;

  // Component 5 — §41 vendor units referenced by each entry point's
  // component set. Opacity rule (§40.9.6): the vendor unit's internal
  // module graph is NOT subdivided; Component 5 admits the unit as a
  // whole by VendorUnitId. Per-unit chunking is A-4's concern.
  const c5Start = debugPerf ? performance.now() : 0;
  const vendorUnits = computeVendorUnitsUsed(irc, files);
  const c5Ms = debugPerf ? performance.now() - c5Start : 0;

  // Component 4 (A-2.5) — auth-gated boundaries visible per role. The
  // AuthGraph is duck-typed at the boundary; when absent (unit tests
  // bypassing A-3 or pipeline configurations where A-3 hasn't wired in
  // yet, e.g. before A-3.5) Component 4 degrades to the
  // single-anonymous-role floor (no gates, no role enum, no per-role
  // filtering). The diagnostics stream from C4 — W-AUTH-RUNTIME-FALLBACK
  // info-level lint per OQ-A2-I + E-CLOSURE-002 error per OQ-A2-F — is
  // unioned into the orchestrator's `errors` output verbatim.
  const c4Start = debugPerf ? performance.now() : 0;
  const c4 = computeAuthGatedBoundariesVisibleTo(input.authGraph, files);
  for (const e of c4.errors) errors.push(e);
  const c4Ms = debugPerf ? performance.now() - c4Start : 0;

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
  //
  // PGO P1.2 — accumulate outer-fixpoint time across every
  // (entry-point, role) pair PLUS the per-EP loop glue
  // (`filterComponentsByRole`, `makeChunkPlanFromFixpoint`,
  // `unionTierIds`). The whole loop is attributed to the
  // `RS-OUTER-FIXPOINT` bucket — the fixpoint dominates per-EP cost in
  // practice, and folding the glue here keeps the per-component sum
  // within ±1ms of the aggregate `[RS]` line.
  const fpStart = debugPerf ? performance.now() : 0;
  let fpIterTotal = 0;
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
      if (debugPerf) fpIterTotal += fp.iterations;

      const plan = makeChunkPlanFromFixpoint(
        fp.result,
        serverFnTiers,
        vendorUnitNames,
      );
      rps.byRole.set(role, plan);
    }
    record.closures.set(ep.id satisfies EntryPointId, rps);
  }
  const fpMs = debugPerf ? performance.now() - fpStart : 0;

  // PGO P1.2 — emit per-component breakdown ONLY when `debugPerf` is
  // set. The component bucket numbers SHALL sum to within ±1ms of the
  // existing `[RS] Nms` aggregate (the per-EP fixpoint loop folds its
  // glue cost into the `RS-OUTER-FIXPOINT` bucket; see comment above).
  if (debugPerf) {
    perfLog(`  [RS-COMPONENT 1] initially-rendered: ${c1Ms.toFixed(2)}ms`);
    perfLog(`  [RS-COMPONENT 2] reactive-dep-closure: ${c2Ms.toFixed(2)}ms`);
    perfLog(`  [RS-COMPONENT 3] server-fn-reachable-within: ${c3Ms.toFixed(2)}ms`);
    perfLog(`  [RS-COMPONENT 4] auth-gated-boundaries-visible-to: ${c4Ms.toFixed(2)}ms`);
    perfLog(`  [RS-COMPONENT 5] vendor-units-used-by: ${c5Ms.toFixed(2)}ms`);
    perfLog(`  [RS-OUTER-FIXPOINT] ${fpIterTotal} iters, ${fpMs.toFixed(2)}ms`);
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
// JSON serialization — A-2.8 canonical bit-identical serializer
// ---------------------------------------------------------------------------
//
// **SPEC anchor (§40.9.8 — Determinism preservation, lines 17794-17812):**
//
//   "All inputs to playable_surface(E, N) are STATIC — source files +
//    spec semantics + the role enum declared at app scope. The analysis
//    takes NO telemetry input in v0.3. The output is therefore
//    deterministic-from-source-only: same source produces same closure
//    produces same chunk assignments produces same content addresses."
//
//   "The analysis output SHALL be incorporated into per-route content
//    addresses (§47) such that two builds of the same source produce
//    identical content addresses for the same per-tier chunks."
//
// `serializeReachabilityRecord` enforces this normative invariant at the
// JSON-output boundary: same `ReachabilityRecord` input MUST produce
// byte-identical UTF-8 output across runs, JS-engine versions, and host
// Map/Set insertion orders. This is the bit-identical invariant.
//
// **Canonical-ordering rules (the rules that achieve bit-identicality):**
//
// 1. Object keys (closures map, byRole map, ChunkPlan shape, ChunkContents
//    shape, diagnostic objects) — emitted in a FIXED key order, NOT
//    insertion order. `JSON.stringify` honours the property order of the
//    plain-object literal we build, so we construct the literal with the
//    canonical key sequence.
//
// 2. Map-as-object emission (closures, byRole) — outer map keys
//    (EntryPointId strings) and inner map keys (RoleVariant strings) are
//    string-sorted by codepoint comparison (`<` / `>`); NOT `localeCompare`
//    (whose collation can vary by ICU version on the host).
//
// 3. Set members — sorted via `canonicalIdComparator`. Set members may be
//    primitive numbers (`NodeId = number`), primitive strings (NodeId
//    string forms + EntryPointId / RoleVariant / VendorUnitId strings),
//    or — defensively for forward-compat — arbitrary objects (canonicalized
//    via `canonicalStringify`). The stratification rule is:
//
//      class 0: numbers      — compared numerically (so "42" sorts AFTER "7"
//                              when both are numeric NodeIds).
//      class 1: strings      — compared by codepoint order.
//      class 2: objects/etc  — compared by canonical-stringified form.
//
//    Numbers sort BEFORE strings; strings BEFORE objects. The point is
//    bit-identical output across runs, NOT human-readable sort order.
//    The strata are stable; within a stratum the comparator is total.
//
// 4. Diagnostic array — emitted in canonical sort order keyed by
//    (code, severity, entryPoint ?? "", role ?? "", message). Insertion
//    order varies across runs depending on the orchestrator's iteration
//    over Maps; canonical order does not. Empty string serves as the
//    absent-field sentinel — keeps the comparator total without branching.
//
// **Why not `localeCompare`?** ICU collation differs between Bun, Node,
// and browser hosts; `localeCompare` is locale-dependent by default.
// Codepoint comparison via `<` / `>` is deterministic across hosts.
//
// **Why not `Object.keys(...).sort()` on an unordered intermediate?**
// V8 / JavaScriptCore preserve insertion order for string-keyed objects
// per ES2015. Building the literal with canonical key sequence is
// equivalent to (and faster than) post-sorting `Object.keys`.

/**
 * Serialize a `ReachabilityRecord` to canonical JSON for the
 * `--emit-reachability` CLI flag.
 *
 * **Bit-identical invariant:** for any two `ReachabilityRecord` values
 * that are structurally equal (same closures map, same diagnostics
 * array contents), this function returns byte-identical UTF-8 strings —
 * regardless of Map/Set insertion order in the inputs.
 *
 * See the module-level comment block above for the full set of
 * canonical-ordering rules and SPEC anchors.
 */
export function serializeReachabilityRecord(record: ReachabilityRecord): string {
  const closures: Record<string, unknown> = {};
  // Outer keys: EntryPointId strings — codepoint-sorted for determinism.
  const epKeys = Array.from(record.closures.keys()).sort(compareStrings);
  for (const ep of epKeys) {
    const rps = record.closures.get(ep);
    if (!rps) continue;
    const byRole: Record<string, unknown> = {};
    // Inner keys: RoleVariant strings — codepoint-sorted.
    const roleKeys = Array.from(rps.byRole.keys()).sort(compareStrings);
    for (const role of roleKeys) {
      const plan = rps.byRole.get(role);
      if (!plan) continue;
      // ChunkPlan fixed key order: initialChunk → prefetchTier1 →
      // prefetchTier2 → prefetchTierN. The `prefetchTierN` array preserves
      // its source order (per SPEC §40.9.7 — N indexes the interaction
      // depth, so array index IS the canonical key).
      byRole[role] = {
        initialChunk: serializeChunkContents(plan.initialChunk),
        prefetchTier1: serializeChunkContents(plan.prefetchTier1),
        prefetchTier2: serializeChunkContents(plan.prefetchTier2),
        prefetchTierN: plan.prefetchTierN.map(serializeChunkContents),
      };
    }
    // RolePlayableSurface fixed key order: byRole only (single field).
    closures[ep] = { byRole };
  }

  // Diagnostics — canonical sort by (code, severity, entryPoint, role,
  // message). The map function emits a fixed key order per diagnostic
  // (code → severity → entryPoint? → role? → message). Optional fields
  // are emitted only when present so the JSON shape is minimal when the
  // diagnostic carries no entry-point / role context.
  const sortedDiagnostics = [...record.diagnostics].sort(compareDiagnostics);
  const diagnostics = sortedDiagnostics.map((d) => {
    const out: Record<string, unknown> = {
      code: d.code,
      severity: d.severity,
    };
    if (d.entryPoint !== undefined) out.entryPoint = d.entryPoint;
    if (d.role !== undefined) out.role = d.role;
    out.message = d.message;
    return out;
  });

  // Top-level fixed key order: closures → diagnostics. `JSON.stringify`
  // serializes object keys in insertion order (ES2015 string-key order
  // preservation) — building the literal with this sequence produces
  // bit-identical output.
  return JSON.stringify({ closures, diagnostics }, null, 2);
}

/**
 * Per-`ChunkContents` canonical emission.
 *
 * Fixed key order: componentNodeIds → reactiveCellNodeIds →
 * serverFnNodeIds → vendorUnitNames (mirrors the `ChunkContents`
 * TypeScript declaration in `types/reachability.ts:145`). Each set is
 * sorted via the structured comparator below.
 */
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

/**
 * Materialize a Set into an array sorted via `canonicalIdComparator`.
 *
 * Used for every Set field in the serialized output (componentNodeIds,
 * reactiveCellNodeIds, serverFnNodeIds, vendorUnitNames). The comparator
 * is stable and total — see `canonicalIdComparator` for the
 * stratification rule.
 */
function sortedArrayFromSet(set: Set<unknown>): unknown[] {
  return Array.from(set).sort(canonicalIdComparator);
}

/**
 * Codepoint-order string comparator.
 *
 * Avoids `localeCompare` (whose collation depends on host ICU version)
 * and avoids `String.prototype.normalize` (whose default form is also
 * host-dependent for some characters). Plain `<` / `>` compares JS
 * strings by UTF-16 codepoint, which is stable across hosts.
 */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Canonical comparator for Set members in the serialized output.
 *
 * Stratification (the bit-identical invariant — same logical set
 * produces same sorted array):
 *
 *   class 0 (numbers)  — sorted numerically. `7` sorts BEFORE `42`,
 *                        which would not hold under string-coercion
 *                        ("42" < "7" lexicographically).
 *   class 1 (strings)  — sorted by codepoint (`<` / `>`).
 *   class 2 (other)    — sorted by `canonicalStringify` (recursive
 *                        canonical-key JSON form). Defensive — current
 *                        ChunkContents type doesn't carry object-typed
 *                        ids, but the comparator handles them for
 *                        forward-compat (e.g. structured NodeId forms
 *                        a future wave might introduce).
 *
 * Cross-class ordering: numbers < strings < other. This is a documented
 * rule — the goal is bit-identical output across runs, NOT
 * human-readable sort order.
 *
 * For numeric strings (e.g. `"42"`) the comparator does NOT treat them
 * as numbers — they're class 1 strings and string-sorted. Only actual
 * `typeof === "number"` values land in class 0.
 */
function canonicalIdComparator(a: unknown, b: unknown): number {
  const ca = canonicalClass(a);
  const cb = canonicalClass(b);
  if (ca !== cb) return ca - cb;
  if (ca === 0) {
    // Both numbers — numeric compare. NaN is not a valid NodeId; if it
    // appears, treat it as equal to itself and after all finite numbers
    // for stability (defensive — should not occur in practice).
    const na = a as number;
    const nb = b as number;
    if (Number.isNaN(na) && Number.isNaN(nb)) return 0;
    if (Number.isNaN(na)) return 1;
    if (Number.isNaN(nb)) return -1;
    return na < nb ? -1 : na > nb ? 1 : 0;
  }
  if (ca === 1) return compareStrings(a as string, b as string);
  // class 2 — canonical-stringify then codepoint compare.
  return compareStrings(canonicalStringify(a), canonicalStringify(b));
}

/**
 * Strata classifier for `canonicalIdComparator`.
 *
 * Returns:
 *   0 — `typeof === "number"` (excludes string-typed numeric forms).
 *   1 — `typeof === "string"`.
 *   2 — anything else (objects, arrays, booleans, bigints, symbols).
 */
function canonicalClass(v: unknown): number {
  const t = typeof v;
  if (t === "number") return 0;
  if (t === "string") return 1;
  return 2;
}

/**
 * Canonical-key JSON stringification.
 *
 * Used by `canonicalIdComparator` to compare class-2 values (objects,
 * arrays, etc.) by a stable canonical form. Recursive: object keys are
 * sorted by codepoint before serialization; arrays preserve order
 * (array index IS the canonical key).
 *
 * Primitives serialize via `JSON.stringify` directly. `undefined`
 * surfaces as the string `"undefined"` (not legal JSON, but used here
 * only for comparison-key construction — never emitted in the
 * serializer output, since the `ChunkContents` types do not permit
 * `undefined` members).
 */
function canonicalStringify(v: unknown): string {
  if (v === undefined) return "undefined";
  if (v === null) return "null";
  const t = typeof v;
  if (t === "number" || t === "boolean" || t === "string") {
    return JSON.stringify(v);
  }
  if (t === "bigint") return `"${(v as bigint).toString()}n"`;
  if (Array.isArray(v)) {
    return "[" + v.map(canonicalStringify).join(",") + "]";
  }
  if (t === "object") {
    const obj = v as Record<string, unknown>;
    const keys = Object.keys(obj).sort(compareStrings);
    const parts = keys.map((k) => JSON.stringify(k) + ":" + canonicalStringify(obj[k]));
    return "{" + parts.join(",") + "}";
  }
  // Symbol / function — defensive; shouldn't appear in record sets.
  return JSON.stringify(String(v));
}

/**
 * Diagnostic-array comparator. Sort key:
 *
 *   (code, severity, entryPoint ?? "", role ?? "", message)
 *
 * Empty string serves as the "absent" sentinel for the optional
 * `entryPoint` and `role` fields — keeps the comparator total without
 * branching on undefined.
 */
function compareDiagnostics(
  a: { code: string; severity: string; entryPoint?: unknown; role?: unknown; message: string },
  b: { code: string; severity: string; entryPoint?: unknown; role?: unknown; message: string },
): number {
  const c = compareStrings(a.code, b.code);
  if (c !== 0) return c;
  const s = compareStrings(a.severity, b.severity);
  if (s !== 0) return s;
  const ep = compareStrings(
    a.entryPoint === undefined ? "" : String(a.entryPoint),
    b.entryPoint === undefined ? "" : String(b.entryPoint),
  );
  if (ep !== 0) return ep;
  const r = compareStrings(
    a.role === undefined ? "" : String(a.role),
    b.role === undefined ? "" : String(b.role),
  );
  if (r !== 0) return r;
  return compareStrings(a.message, b.message);
}
