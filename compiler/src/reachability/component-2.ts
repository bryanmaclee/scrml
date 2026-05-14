/**
 * @module reachability/component-2
 *
 * Component 2 — `reactive_dep_closure(C)` per SPEC §40.9.3.
 *
 * S90 wave A-2.3 — given the component set `C` produced by Component 1
 * (initially-rendered markup AST ids per §40.9.2), compute the forward
 * transitive closure over the post-A-1 Stage 7 Dependency Graph's
 * reactive-read substrate. Output: `Set<NodeId>` of `ReactiveDGNode`
 * ids that the component set transitively reads.
 *
 * **Walk shape (two-phase):**
 *
 *   Phase 1 — Component → reactive entry points.
 *     Component 1 emits AST `MarkupNode.id`s. The DG's `RenderDGNode`
 *     carries `markupNodeId: String(astId)` (dependency-graph.ts:1330).
 *     `MarkupReadDGNode`s reference the enclosing render via the
 *     `sourceRenderNodeId` field (NOT an edge — a structural pointer).
 *     For each component AST id in `C`, locate the matching
 *     `RenderDGNode`, then locate the markup-read nodes whose
 *     `sourceRenderNodeId` equals that render's NodeId, then admit the
 *     `to` of each markup-read's outgoing `reads` edge (a
 *     `ReactiveDGNode`) to the closure seed.
 *
 *   Phase 2 — Forward closure over reactive→reactive edges.
 *     From each seeded reactive node, walk DFS over outgoing `reads`,
 *     `validator-reads`, and `engine-derived-reads` edges. Per SPEC
 *     §40.9.3 normative "all reactive cells R such that there exists
 *     a chain of reactive reads / writes / derivations /
 *     engine-derived-reads / validator-arg edges". The three forward-
 *     reactive edge kinds resolve OQ-A2-J (SCOPING §6.OQ-A2-J,
 *     non-blocking confirmation S89). `writes` is NOT walked here per
 *     OQ-A2-J disposition — Component 3 (A-2.4) handles the writer-
 *     side admission via the interaction graph.
 *
 * **markup-read intermediaries are NOT in the output set.** Per
 * SCOPING §2.4 + A-1.6 consumer-audit finding, markup-read DG nodes
 * are downstream-invisible to non-RS consumers. Component 2 emits the
 * `to` of each `reads` edge (the `ReactiveDGNode`), not the `from`
 * (the markup-read).
 *
 * **Dynamic-key recovery (§40.9.3 normative):** when a `reads` edge
 * targets a reactive cell whose access is statically irreducible
 * (e.g. `@obj[runtimeKey]`), the closure SHALL admit the entire
 * receiver (worst-case union over all keys of the receiver). Per
 * §40.9.3 the runtime-only catalog is empirically empty in the
 * measured 33-file priority corpus + the 61-file A-1.7 ceiling-
 * remeasurement corpus — the present DG has no dedicated dynamic-key
 * flag on edges. We provide a hook (`expandDynamicKeyReceiver`) so
 * future A-1-side dynamic-key tagging can opt in; today it is a
 * no-op pass-through that admits the named reactive node alone.
 *
 * **Cycles:** §31 forbids DIRECT cycles via `E-DERIVED-CIRCULAR-DEP`
 * + `E-VALIDATOR-CIRCULAR-DEP` + `E-DERIVED-ENGINE-CIRCULAR`, but the
 * walker tolerates them defensively via a visited set anyway —
 * synthetic graphs or future relaxations of those errors must not
 * crash Component 2.
 *
 * **Determinism:** the input AST-id iteration is source-order (set
 * insertion order from Component 1); the DG edge iteration is
 * `edges[]` order (DG emission order — deterministic per PIPELINE).
 * The output `Set<NodeId>` is insertion-ordered; serialization at
 * A-2.8 will canonicalize.
 *
 * Cross-references:
 *   - SPEC.md §40.9.3 — normative semantics + dynamic-key recovery.
 *   - SPEC.md §31 — DG edge taxonomy (the eight kinds; `reads`,
 *     `validator-reads`, `engine-derived-reads` walked here).
 *   - SPEC.md §40.9.9 — worked example (Dashboard reads `@count`,
 *     `@count` is in the closure).
 *   - docs/changes/a2-reachability-solver-scoping/SCOPING.md §A-2.3
 *     + §6 OQ-A2-J — sub-task decomposition + disposition.
 *   - compiler/src/dependency-graph.ts — substrate (RenderDGNode +
 *     MarkupReadDGNode + ReactiveDGNode + edges).
 *   - ./component-1.ts — input producer (Component 1).
 */

import type {
  EntryPointId,
  NodeId as RSNodeId,
} from "../types/reachability.ts";

// ---------------------------------------------------------------------------
// Local DG types — duck-typed at the boundary
// ---------------------------------------------------------------------------
//
// The DG types in `compiler/src/dependency-graph.ts` are file-local
// (not exported). We declare a minimal structural subset here so
// Component 2 stays decoupled from the full DG type surface. Anything
// not consumed by Component 2's walk is omitted.

type DGNodeId = string;

interface DGRenderNode {
  kind: "render";
  nodeId: DGNodeId;
  markupNodeId: string;
}

interface DGMarkupReadNode {
  kind: "markup-read";
  nodeId: DGNodeId;
  sourceRenderNodeId: DGNodeId | null;
}

interface DGReactiveNode {
  kind: "reactive";
  nodeId: DGNodeId;
  varName: string;
}

interface DGGenericNode {
  kind: string;
  nodeId: DGNodeId;
  varName?: string;
  markupNodeId?: string;
  sourceRenderNodeId?: DGNodeId | null;
}

interface DGEdge {
  from: DGNodeId;
  to: DGNodeId;
  kind: string;
}

/** Structural subset of the Stage 7 DG consumed by Component 2. */
export interface ReadOnlyDependencyGraph {
  nodes: Map<DGNodeId, DGGenericNode>;
  edges: DGEdge[];
}

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/**
 * Per-entry-point reactive-dependency closure.
 *
 * Keyed by `EntryPointId` so downstream components (A-2.4..A-2.6) and
 * the outer fixpoint (A-2.7) can union per-entry-point closures into
 * the per-(entry-point, role) `ChunkPlan` populated by
 * `runReachabilitySolver`.
 *
 * Set members are `ReactiveDGNode.nodeId` strings (DG-style ids).
 */
export type ReactiveDepClosure = Map<EntryPointId, Set<RSNodeId>>;

/**
 * Edge kinds that Component 2 walks per SPEC §40.9.3 + §31.
 *
 * Per OQ-A2-J disposition: forward closure over `reads`,
 * `validator-reads`, and `engine-derived-reads`. `writes` is excluded
 * (handled by Component 3 — writer-side admission via interaction
 * graph). `calls`, `awaits`, `invalidates`, `renders` are not
 * reactive-dependency edges.
 */
const REACTIVE_DEP_EDGE_KINDS: ReadonlySet<string> = new Set([
  "reads",
  "validator-reads",
  "engine-derived-reads",
]);

/**
 * Compute Component 2's output for the full compile unit.
 *
 * For each entry point's component set (Component 1's output), walks
 * the DG forward from the markup-read substrate to admit the
 * transitive reactive-cell closure.
 *
 * **Pure:** does not mutate inputs. Returns a fresh Map / Sets.
 *
 * **Complexity:** O(|C| × |MarkupReadNodes| + |reactive edges|)
 * worst-case. The first factor is the per-component render-node
 * lookup; the second is the bounded forward walk. The DG iteration
 * is linear in `edges.length`; we pre-index for the inner closure
 * walk to keep per-component work bounded.
 *
 * @param initiallyRendered Output of Component 1 — per-entry-point
 *   set of `MarkupNode.id` values (AST ids, NOT DG ids).
 * @param depGraph Stage 7 DG with A-1 markup-read substrate active.
 *   When absent (null/undefined — typical for tests that bypass the
 *   full pipeline), returns empty closures for every entry point.
 */
export function computeReactiveDepClosure(
  initiallyRendered: Map<EntryPointId, Set<RSNodeId>>,
  depGraph: ReadOnlyDependencyGraph | null | undefined,
): ReactiveDepClosure {
  const out: ReactiveDepClosure = new Map();

  // Degrade gracefully when the DG is absent — every entry point gets
  // an empty closure. This matches Component 1's empty-input pattern
  // and lets the orchestrator wire Component 2 unconditionally.
  if (!depGraph || !depGraph.nodes || !depGraph.edges) {
    for (const ep of initiallyRendered.keys()) {
      out.set(ep, new Set());
    }
    return out;
  }

  // Pre-index the DG for the per-entry-point walks:
  //   1. markupNodeId → RenderDGNode.nodeId  — bridges Component 1's
  //      AST ids into the DG's render-node id space.
  //   2. RenderDGNode.nodeId → MarkupReadDGNode.nodeId[] — the
  //      markup-reads contained by each render block.
  //   3. DG NodeId → outgoing reactive-dep edges adjacency map —
  //      reused across every entry point for amortized closure work.
  const renderByMarkupId = buildRenderByMarkupId(depGraph);
  const markupReadsByRender = buildMarkupReadsByRender(depGraph);
  const reactiveDepAdj = buildReactiveDepAdjacency(depGraph);

  // Per-entry-point forward closure.
  for (const [ep, componentSet] of initiallyRendered) {
    const seeded = seedFromComponents(
      componentSet,
      renderByMarkupId,
      markupReadsByRender,
      depGraph,
    );
    const closure = transitiveClose(seeded, reactiveDepAdj, depGraph);
    out.set(ep, closure);
  }

  return out;
}

// ---------------------------------------------------------------------------
// DG pre-indexing
// ---------------------------------------------------------------------------

/**
 * Build a `markupNodeId → RenderDGNode.nodeId` index.
 *
 * Component 1 emits AST `MarkupNode.id` values; the DG keys render
 * nodes by their own `nodeId` and stores the source AST id on the
 * `markupNodeId` field (dependency-graph.ts:1330). This index lets
 * us bridge from Component 1's output into the DG's id space.
 *
 * If a markup AST id has no corresponding render DG node (e.g. a
 * markup node inside a closed-form-OUT subtree the DG-builder
 * skipped, or a synthetic AST not yet round-tripped), the lookup
 * returns null and the component is silently dropped from Phase 1
 * seeding. This is conservative: Component 1 may admit nodes that
 * the DG never registers; their reactive deps were already not
 * inferable, so admitting nothing is the correct floor.
 */
function buildRenderByMarkupId(
  dg: ReadOnlyDependencyGraph,
): Map<string, DGNodeId> {
  const out = new Map<string, DGNodeId>();
  for (const node of dg.nodes.values()) {
    if (node.kind !== "render") continue;
    const render = node as unknown as DGRenderNode;
    if (typeof render.markupNodeId !== "string") continue;
    // First-wins on the rare case of duplicate markupNodeId (should
    // not happen in well-formed DG output); deterministic over
    // `nodes` iteration order.
    if (!out.has(render.markupNodeId)) {
      out.set(render.markupNodeId, render.nodeId);
    }
  }
  return out;
}

/**
 * Build a `RenderDGNode.nodeId → MarkupReadDGNode.nodeId[]` index.
 *
 * Each `MarkupReadDGNode` carries `sourceRenderNodeId` pointing to
 * its enclosing render block. Reverse-index so we can look up "which
 * markup-reads belong to this render" in O(1) per render block
 * during seeding.
 *
 * Markup-read nodes with `sourceRenderNodeId === null` are top-level
 * orphans (no enclosing render) — they are not associated with any
 * component and are skipped here. They MAY be admitted by future
 * sub-phases via different paths but are not Component 2's input.
 */
function buildMarkupReadsByRender(
  dg: ReadOnlyDependencyGraph,
): Map<DGNodeId, DGNodeId[]> {
  const out = new Map<DGNodeId, DGNodeId[]>();
  for (const node of dg.nodes.values()) {
    if (node.kind !== "markup-read") continue;
    const mr = node as unknown as DGMarkupReadNode;
    const src = mr.sourceRenderNodeId;
    if (src === null || src === undefined) continue;
    let list = out.get(src);
    if (!list) {
      list = [];
      out.set(src, list);
    }
    list.push(mr.nodeId);
  }
  return out;
}

/**
 * Build a `fromNodeId → Set<toNodeId>` adjacency for reactive-dep
 * edges — the union of `reads`, `validator-reads`, and
 * `engine-derived-reads` (the three forward-reactive edge kinds per
 * OQ-A2-J).
 *
 * The Set semantics deduplicate self-edges and parallel edges of
 * different kinds between the same node pair. Insertion order is
 * preserved (Set iteration order).
 *
 * Mirrors the precedent of `buildDerivedReadsAdj` /
 * `buildValidatorArgsAdj` / `buildEngineDerivedAdj` in
 * dependency-graph.ts:873-955 — but unions the three kinds in a
 * single pass since Component 2 needs the joint adjacency.
 */
function buildReactiveDepAdjacency(
  dg: ReadOnlyDependencyGraph,
): Map<DGNodeId, Set<DGNodeId>> {
  const out = new Map<DGNodeId, Set<DGNodeId>>();
  for (const edge of dg.edges) {
    if (!REACTIVE_DEP_EDGE_KINDS.has(edge.kind)) continue;
    let bucket = out.get(edge.from);
    if (!bucket) {
      bucket = new Set();
      out.set(edge.from, bucket);
    }
    bucket.add(edge.to);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Phase 1 — seeding from the component set
// ---------------------------------------------------------------------------

/**
 * Translate Component 1's AST-id component set into the DG-id space
 * + admit the reactive-cell entry points reached via markup-read
 * intermediaries.
 *
 * For each AST id in `componentSet`:
 *   1. Look up the matching `RenderDGNode.nodeId` via
 *      `renderByMarkupId`. Skip if absent (component has no DG
 *      footprint — its reactive deps are not statically inferable
 *      via the markup-read substrate).
 *   2. Look up the markup-read DG nodes whose `sourceRenderNodeId`
 *      is that render's nodeId.
 *   3. For each markup-read, follow its outgoing reactive-dep edges
 *      (typically a single `reads` edge — that is the
 *      markup-context interpolation's read target) and admit each
 *      `to` (a reactive node) to the seed set.
 *
 * Dynamic-key recovery (§40.9.3) is dispatched per-target via
 * `expandDynamicKeyReceiver`. Today's DG has no dynamic-key flag —
 * the receiver-expansion is a hook for future A-1-side tagging; the
 * current implementation is a pass-through (admits only the named
 * target).
 *
 * The seed set contains ONLY reactive nodes — markup-read
 * intermediaries are never admitted (SCOPING §2.4).
 */
function seedFromComponents(
  componentSet: Set<RSNodeId>,
  renderByMarkupId: Map<string, DGNodeId>,
  markupReadsByRender: Map<DGNodeId, DGNodeId[]>,
  dg: ReadOnlyDependencyGraph,
): Set<DGNodeId> {
  const seed = new Set<DGNodeId>();

  for (const astId of componentSet) {
    // Component 1's NodeId payload is the AST `MarkupNode.id`. The
    // type is `string | number`; the DG-side index keys on string.
    const astIdStr = String(astId);
    const renderNodeId = renderByMarkupId.get(astIdStr);
    if (!renderNodeId) continue;

    const markupReads = markupReadsByRender.get(renderNodeId);
    if (!markupReads) continue;

    for (const mrNodeId of markupReads) {
      // Walk this markup-read's outgoing reactive-dep edges. In
      // practice each markup-read emits exactly one `reads` edge
      // (dependency-graph.ts:1902); we still iterate the adjacency
      // in case of future shape extensions.
      const outgoing = collectOutgoingReactiveDepTargets(mrNodeId, dg);
      for (const targetNodeId of outgoing) {
        for (const admitted of expandDynamicKeyReceiver(targetNodeId, dg)) {
          seed.add(admitted);
        }
      }
    }
  }

  return seed;
}

/**
 * Walk a single node's outgoing reactive-dep edges.
 *
 * Used by Phase 1 for markup-read intermediaries. The adjacency-map
 * approach used in Phase 2 isn't reused here because markup-read
 * nodes are NEVER targets of reactive-dep edges (they are only
 * sources), and pre-indexing on every markup-read would waste space
 * for the rare large-fan-out case. We do a single linear edge scan
 * per markup-read instead — bounded by `edges.length` and the
 * markup-read count (523 in the A-1.7 ceiling-remeasurement corpus).
 */
function collectOutgoingReactiveDepTargets(
  fromNodeId: DGNodeId,
  dg: ReadOnlyDependencyGraph,
): DGNodeId[] {
  const out: DGNodeId[] = [];
  for (const edge of dg.edges) {
    if (edge.from !== fromNodeId) continue;
    if (!REACTIVE_DEP_EDGE_KINDS.has(edge.kind)) continue;
    out.push(edge.to);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Phase 2 — transitive forward closure
// ---------------------------------------------------------------------------

/**
 * DFS-walk the reactive-dep adjacency forward from each seed node.
 *
 * Worklist + visited-set pattern. Tolerates cycles defensively —
 * §31 forbids direct cycles via `E-DERIVED-CIRCULAR-DEP` /
 * `E-VALIDATOR-CIRCULAR-DEP` / `E-DERIVED-ENGINE-CIRCULAR`, but
 * the walker is robust to violations or future synthetic-graph
 * scenarios that bypass those error paths (e.g. unit tests).
 *
 * Self-edges are absent from the live `edges` array
 * (dependency-graph.ts:1455 suppresses derived-self-refs; the same
 * convention applies to validator-args and engine-derived-reads
 * per the buildAdj precedents at 873 / 904 / 941). The visited-
 * set is the only cycle-guard we need.
 *
 * Returns only reactive-DG nodes. Non-reactive targets (should be
 * impossible in well-formed DG output — reactive-dep edges target
 * reactive nodes by construction) are filtered.
 */
function transitiveClose(
  seed: Set<DGNodeId>,
  reactiveDepAdj: Map<DGNodeId, Set<DGNodeId>>,
  dg: ReadOnlyDependencyGraph,
): Set<DGNodeId> {
  const closure = new Set<DGNodeId>();
  // Worklist is a stack — DFS order. The output Set's insertion
  // order is DFS-first-visit order; deterministic per the input seed
  // iteration order + the adjacency map's Set iteration order.
  const stack: DGNodeId[] = [];

  for (const seedNode of seed) {
    if (!isReactive(dg, seedNode)) {
      // Defensive: a seed that is not a reactive node is dropped.
      // Phase 1 only ever pushes reactive targets (per
      // dependency-graph.ts:1893 — `reactiveVarNodeIds` lookup), but
      // we re-check here so future Phase-1 evolution can't silently
      // pollute the closure.
      continue;
    }
    if (!closure.has(seedNode)) {
      closure.add(seedNode);
      stack.push(seedNode);
    }
  }

  while (stack.length > 0) {
    const current = stack.pop()!;
    const neighbors = reactiveDepAdj.get(current);
    if (!neighbors) continue;
    for (const neighbor of neighbors) {
      if (closure.has(neighbor)) continue;
      if (!isReactive(dg, neighbor)) continue;
      closure.add(neighbor);
      stack.push(neighbor);
    }
  }

  return closure;
}

// ---------------------------------------------------------------------------
// Dynamic-key recovery hook (§40.9.3 normative)
// ---------------------------------------------------------------------------

/**
 * Per §40.9.3 normative: a statically-irreducible reactive read
 * (e.g. `@obj[runtimeKey]` where `runtimeKey` is not a compile-time
 * constant) SHALL cause the analysis to admit the entire reactive-
 * cell receiver to the closure (worst-case union over all keys of
 * the receiver).
 *
 * **Current implementation:** pass-through. Today's DG has no
 * dynamic-key flag — the empirical corpus (A-1.7 ceiling
 * remeasurement: 61 files / 523 markup-read sites) contains zero
 * dynamic-key patterns; §40.9.3 itself states "the runtime-only
 * catalog is empirically empty for the corpus measured."
 *
 * **Future:** when A-1's emit path begins flagging dynamic-key sites
 * (likely a `dynamicKey: true` field on `MarkupReadDGNode` or a new
 * edge attribute), this function expands its return set to include
 * every reactive sibling that shares the receiver's name root.
 *
 * The hook lives here (Component 2) rather than in A-1 because the
 * expansion semantics are A-2's reachability decision; A-1 only
 * tags. Test coverage at A-2.3.d exercises a synthetic dynamic-key
 * scenario by constructing a DG with the expanded edges directly.
 */
function expandDynamicKeyReceiver(
  targetNodeId: DGNodeId,
  _dg: ReadOnlyDependencyGraph,
): DGNodeId[] {
  // Today's DG has no dynamic-key flag — pass-through.
  // Future hook: read a flag off the edge or node, look up the
  // receiver's reactive siblings (`varName.split(".")[0]` shared
  // root), and return the union.
  return [targetNodeId];
}

// ---------------------------------------------------------------------------
// DG node-kind probe
// ---------------------------------------------------------------------------

/**
 * Check whether a DG NodeId resolves to a `ReactiveDGNode`.
 *
 * Used as a defensive filter in Phase 2 — reactive-dep edges
 * target reactive nodes by construction (dependency-graph.ts:1455
 * + 1556 + 1589 + 1611 + 1769 + 1815 + 1902 all push targets from
 * `reactiveVarNodeIds`), but a synthetic DG (unit test) could in
 * principle push a non-reactive target. The filter ensures
 * Component 2's output only contains reactive node ids per the
 * `ChunkContents.reactiveCellNodeIds` contract (PIPELINE Stage 7.6
 * line 2351).
 */
function isReactive(dg: ReadOnlyDependencyGraph, nodeId: DGNodeId): boolean {
  const node = dg.nodes.get(nodeId);
  return Boolean(node && node.kind === "reactive");
}
