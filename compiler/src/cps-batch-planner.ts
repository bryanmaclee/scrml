/**
 * CPS Multi-Batch Planner — Ext 1 M1.3 (multi-batch CPS).
 *
 * The substantive Ext 1 algorithm. Given a statement-grain body-DG (from M1.2's
 * `buildBodyDG`) with tier-classified nodes, produce a MULTI-BATCH PLAN: a list
 * of server batches, each a contiguous run of server statements that commit as
 * one transactional envelope, separated by client work that must observe an
 * earlier batch's commit before a later batch can start.
 *
 * The A9 min-viable body-split (Ext 4 + Ext 5, S72) split a body into exactly
 * ONE server batch. Ext 1 extends to N batches — a body crosses the seam
 * multiple times. This planner is the per-function-body decision procedure.
 *
 * ── Algorithm (scope-dive §B.3 / predecessor §3.1) ─────────────────────────
 *   1. Topologically sort the DG, preferring orderings that keep contiguous
 *      server runs together (server-biased Kahn list-scheduling).
 *   2. Coalesce contiguous server runs into batches: server statements i, j
 *      (i before j in topo order) join the SAME batch iff no client-tier
 *      statement sits between them in topo order. A client statement forces a
 *      wait for batch i to commit before batch j may start — a batch boundary.
 *   3. Detect irreducible cross-batch durable WRITE dependencies — the
 *      write → client-read → write pattern across two batches.
 *   4. Detect `<machine>` `.advance()` transitions that cross batch boundaries.
 *   5. If any irreducible dep / machine crossing → reject with the relevant
 *      diagnostic. Otherwise → return the batch list.
 *
 * ── Soundness (body-split soundness DD §3.4 — S3 is load-bearing) ──────────
 *   S3 monotonicity-preserving-ordering is CLEAN under the reorder verdict IF
 *   AND ONLY IF the DG edges are conservative AND the scheduler respects every
 *   edge. The body-DG (M1.2) is conservative-over-approximate by construction.
 *   This planner's topo sort respects ALL FIVE edge kinds — `reads`, `writes`,
 *   `awaits`, `invalidates`, `control-anchors` — as hard "must-not-precede"
 *   constraints; it NEVER reorders across any of them. Any topological sort of
 *   a data-dependency DAG produces the same observable result at every
 *   observable cut point (Lam/Wegman list-scheduling). The scheduler here only
 *   uses tie-break preference (server-bias) to CHOOSE AMONG already-legal
 *   orderings — it never violates a constraint to satisfy the preference.
 *
 *   `control-anchors` edges are honoured identically to data edges: the
 *   scheduler treats them as ordering constraints and the coalescer can never
 *   merge a server run across a control-flow statement, because the anchor
 *   edges fence the control-flow node to its source-order neighbours.
 *
 * ── Reject paths ──────────────────────────────────────────────────────────
 *   E-CPS-MULTIBATCH-REORDER         — an irreducible cross-batch durable-write
 *                                      dependency (SQL-row identity needing
 *                                      transactional consistency read again in
 *                                      a later batch). §34 registration lands
 *                                      at M1.6; this module produces the
 *                                      diagnostic SHAPE + offending edge.
 *   E-CPS-MULTIBATCH-MACHINE-CROSSING — a `<machine>` `.advance()` chain where
 *                                      two advances on the same machine land
 *                                      in different batches. §34 registration
 *                                      lands at M1.6.
 *
 * ── Admissible cross-batch forwarding ──────────────────────────────────────
 *   A `@reactive` cell written in batch B and read again in batch B' is NOT a
 *   reject — the value is marshalled forward as a parameter to the second stub
 *   (M1.5 emit). Only SQL-row-identity cross-batch deps (the `invalidates` /
 *   SQL-mediated `writes` edge family) are irreducible.
 *
 * Cross-references:
 *   - EXT-1-IMPL-BRIEF.md §M1.3 — implementation brief.
 *   - scrml-support .../ext-1-3-2-full-body-split-scoping-2026-05-21.md §B.3.
 *   - body-dg-builder.ts — `BodyDG` / `BodyDGNode` / `BodyDGEdge` (M1.2).
 *   - route-inference.ts — `CPSBatch` / `CPSSplit` (M1.1); the planner call site.
 */

import type {
  BodyDG,
  BodyDGNode,
  BodyDGEdge,
  BodyDGTier,
} from "./body-dg-builder.ts";
import type { CPSBatch } from "./route-inference.ts";
import type { LogicStatement, ExprNode } from "./types/ast.ts";

// ---------------------------------------------------------------------------
// Public result types
// ---------------------------------------------------------------------------

/** Reject-path diagnostic codes (registered in SPEC §34 at M1.6). */
export type CPSPlannerRejectCode =
  | "E-CPS-MULTIBATCH-REORDER"
  | "E-CPS-MULTIBATCH-MACHINE-CROSSING";

/**
 * A planner rejection — an irreducible cross-batch dependency, or a
 * `<machine>` advance crossing a batch boundary. Carries the offending edge
 * (when the rejection is edge-mediated) and the offending statement indices so
 * the caller can build a precise diagnostic span.
 */
export interface CPSPlannerReject {
  status: "reject";
  /** The §34 diagnostic code. */
  code: CPSPlannerRejectCode;
  /**
   * The body-DG edge that could not be satisfied across the batch boundary —
   * present for `E-CPS-MULTIBATCH-REORDER`. `undefined` for machine-crossing
   * rejections (those are statement-mediated, not edge-mediated).
   */
  offendingEdge?: BodyDGEdge;
  /**
   * The body-statement indices implicated in the rejection. For a reorder
   * reject: `[writerIndex, laterReaderIndex]`. For a machine crossing: the
   * indices of the two `.advance()` calls in different batches.
   */
  offendingStmtIndices: number[];
  /** Human-readable explanation (the caller wraps this into a diagnostic). */
  message: string;
}

/**
 * A successful multi-batch plan. `batches` are in source order; `topoOrder` is
 * the full statement schedule the planner derived (server + client interleaved)
 * — M1.5's emit consumes it to sequence the client wrapper's awaits.
 */
export interface CPSPlannerOk {
  status: "ok";
  /** Server batches in source order. Each batch is a contiguous server run. */
  batches: CPSBatch[];
  /**
   * The full statement schedule (every body index, server + client) in the
   * topological order the planner chose. M1.5 sequences client statements
   * between batch awaits using this order.
   */
  topoOrder: number[];
}

/** The planner result — either a multi-batch plan, or a static rejection. */
export type CPSPlannerResult = CPSPlannerOk | CPSPlannerReject;

// ---------------------------------------------------------------------------
// planMultiBatchCPS — the entry point
// ---------------------------------------------------------------------------

/**
 * Plan the multi-batch CPS split for one function body.
 *
 * @param dg    the statement-grain body-DG from `buildBodyDG` (M1.2).
 * @param body  the function body's `LogicStatement[]` — needed for
 *              machine-advance detection and offending-statement reporting.
 * @returns     a `CPSPlannerOk` with the batch list, or a `CPSPlannerReject`.
 */
export function planMultiBatchCPS(
  dg: BodyDG,
  body: LogicStatement[],
): CPSPlannerResult {
  // Empty / single-node bodies: trivially one batch (or zero).
  if (!dg || dg.nodes.length === 0) {
    return { status: "ok", batches: [], topoOrder: [] };
  }

  // --- Step 1: server-biased topological sort -----------------------------
  const topo = topologicalSort(dg);
  if (topo.status === "cycle") {
    // A genuine dependency cycle in the body-DG. The body-DG is built from
    // a straight-line statement list with conservative edges; a cycle here
    // would mean two statements mutually depend. Treat as an irreducible
    // reorder rejection — the offending edge is the back-edge.
    return {
      status: "reject",
      code: "E-CPS-MULTIBATCH-REORDER",
      offendingEdge: topo.backEdge,
      offendingStmtIndices: [topo.backEdge.from, topo.backEdge.to],
      message:
        `multi-batch CPS planning found a dependency cycle between ` +
        `statement ${topo.backEdge.to} and statement ${topo.backEdge.from} ` +
        `(${topo.backEdge.kind} edge) — the body cannot be linearised into ` +
        `independent server batches.`,
    };
  }
  const topoOrder = topo.order;

  // --- Step 2: coalesce contiguous server runs into batches ---------------
  const nodeByIndex = new Map<number, BodyDGNode>();
  for (const n of dg.nodes) nodeByIndex.set(n.index, n);

  const batchGroups = coalesceServerRuns(topoOrder, nodeByIndex);

  // --- Step 3 + 4: cross-batch dependency + machine-crossing rejection ----
  // Build a stmt-index → batch-number map (client statements map to -1).
  const batchOf = new Map<number, number>();
  batchGroups.forEach((group, batchNum) => {
    for (const idx of group) batchOf.set(idx, batchNum);
  });

  // Step 3 — irreducible cross-batch durable-write dependency.
  const reorderReject = detectCrossBatchReject(dg, batchOf, topoOrder);
  if (reorderReject) return reorderReject;

  // Step 4 — `<machine>` `.advance()` crossing a batch boundary.
  const machineReject = detectMachineCrossing(body, batchOf);
  if (machineReject) return machineReject;

  // --- Step 5: success — build the CPSBatch list --------------------------
  const batches: CPSBatch[] = batchGroups.map((group) => ({
    // Indices in ascending source order — matches M1.1's `singleBatch`
    // construction and `CPSSplit.serverStmtIndices` getter expectations.
    indices: [...group].sort((a, b) => a - b),
    idempotencyTag: "",
  }));

  return { status: "ok", batches, topoOrder };
}

// ---------------------------------------------------------------------------
// Step 1 — server-biased topological sort
// ---------------------------------------------------------------------------

type TopoResult =
  | { status: "ok"; order: number[] }
  | { status: "cycle"; backEdge: BodyDGEdge };

/**
 * Kahn's-algorithm topological sort over the body-DG.
 *
 * Edge direction (M1.2 convention): `edge.from` DEPENDS ON `edge.to` —
 * `from` must run AFTER `to`. So `to` must be scheduled BEFORE `from`: the
 * edge contributes one unit of in-degree to `from`, and a successor `from` to
 * `to`'s adjacency list.
 *
 * SOUNDNESS: every edge is an absolute ordering constraint. The tie-break
 * (below) only ever selects among nodes that are ALL currently ready
 * (in-degree 0) — it never violates a constraint. Any topological sort of a
 * data-dependency DAG is observationally equivalent (S3 reorder verdict).
 *
 * Tie-break, when multiple nodes are ready: prefer the LOWEST source index.
 *
 * Why source-order and NOT a server-bias hoist: a server-bias that hoisted an
 * independent later server past an intervening client statement would COLLAPSE
 * two batches into one — defeating the multi-batch shape the brief's two-batch
 * and three-batch fixtures require (server / client / server MUST be two
 * batches). A client statement that sits between two server statements in
 * SOURCE ORDER represents observable client work between two server round
 * trips; the planner must NOT reorder it away. Source-order tie-break keeps
 * the schedule faithful to the source and lets the coalescer (Step 2) see the
 * genuine batch boundaries. The conservative body-DG already guarantees source
 * order is a legal topological order; the tie-break only deviates from source
 * order when a DG edge forces a later statement to run earlier — which never
 * happens for a straight-line list whose edges all run `from > to`. "Preferring
 * contiguous server runs" (scope-dive §B.3) is satisfied trivially: source
 * order already keeps every contiguous source-order server run contiguous.
 */
function topologicalSort(dg: BodyDG): TopoResult {
  const indices = dg.nodes.map((n) => n.index);

  // Adjacency: for each node, the set of nodes that must run AFTER it.
  const successors = new Map<number, Set<number>>();
  const inDegree = new Map<number, number>();
  for (const idx of indices) {
    successors.set(idx, new Set());
    inDegree.set(idx, 0);
  }
  for (const edge of dg.edges) {
    // `edge.to` must precede `edge.from`.
    const succ = successors.get(edge.to);
    if (!succ) continue; // edge endpoint not a node — defensive.
    if (succ.has(edge.from)) continue; // duplicate edge — count once.
    succ.add(edge.from);
    inDegree.set(edge.from, (inDegree.get(edge.from) ?? 0) + 1);
  }

  const order: number[] = [];
  // Ready set — all nodes with in-degree 0.
  const ready: number[] = indices.filter((idx) => (inDegree.get(idx) ?? 0) === 0);

  while (ready.length > 0) {
    // Tie-break: lowest source index among the ready nodes (source-order
    // stable). See the function doc for why source order, not a server hoist.
    let bestPos = 0;
    for (let p = 1; p < ready.length; p++) {
      if (ready[p] < ready[bestPos]) bestPos = p;
    }
    const chosen = ready.splice(bestPos, 1)[0];
    order.push(chosen);

    // Relax successors.
    for (const succ of successors.get(chosen) ?? []) {
      const d = (inDegree.get(succ) ?? 0) - 1;
      inDegree.set(succ, d);
      if (d === 0) ready.push(succ);
    }
  }

  if (order.length !== indices.length) {
    // A cycle: some node never reached in-degree 0. Find a back-edge — an
    // edge between two still-unscheduled nodes — for the diagnostic.
    const scheduled = new Set(order);
    let backEdge: BodyDGEdge | undefined;
    for (const edge of dg.edges) {
      if (!scheduled.has(edge.from) && !scheduled.has(edge.to)) {
        backEdge = edge;
        break;
      }
    }
    // Defensive fallback — there must be at least one such edge.
    return {
      status: "cycle",
      backEdge: backEdge ?? dg.edges[0],
    };
  }

  return { status: "ok", order };
}

// ---------------------------------------------------------------------------
// Step 2 — coalesce contiguous server runs
// ---------------------------------------------------------------------------

/**
 * Walk the topological order and group contiguous server-tier statements into
 * batches. A `client`-tier statement between two server statements forces a
 * batch boundary (it must observe batch i's commit before batch j starts).
 *
 * Tier note: a `reactive`-tier statement is a seam-crossing `state-decl` whose
 * server-call init runs server-side. It belongs IN a server batch — it IS
 * server work. Only a pure `client`-tier statement breaks a run.
 *
 * @returns an array of batches; each batch is an array of body indices in
 *          TOPOLOGICAL order (the caller re-sorts to source order).
 */
function coalesceServerRuns(
  topoOrder: number[],
  nodeByIndex: Map<number, BodyDGNode>,
): number[][] {
  const groups: number[][] = [];
  let current: number[] | null = null;
  let sawClientSinceLastServer = false;

  for (const idx of topoOrder) {
    const node = nodeByIndex.get(idx);
    const tier: BodyDGTier = node ? node.tier : "client";
    const isServerWork = tier === "server" || tier === "reactive";

    if (isServerWork) {
      if (current === null || sawClientSinceLastServer) {
        // Start a new batch: either the first server statement, or a client
        // statement intervened since the previous server statement.
        current = [];
        groups.push(current);
      }
      current.push(idx);
      sawClientSinceLastServer = false;
    } else {
      // A client statement. If a batch is open, the NEXT server statement
      // must start a fresh batch.
      if (current !== null) sawClientSinceLastServer = true;
    }
  }

  return groups;
}

// ---------------------------------------------------------------------------
// Step 3 — irreducible cross-batch durable-write dependency
// ---------------------------------------------------------------------------

/**
 * Detect the write → client-read → write cross-batch pattern that cannot be
 * safely reordered.
 *
 * The body-DG carries `writes` edges (`@var` write-write) and `invalidates`
 * edges (SQL non-SELECT → SQL SELECT, same table). When such an edge connects
 * a statement in batch B' back to a statement in an EARLIER batch B
 * (B' > B), the two server batches both touch the same durable resource and a
 * client statement sits between them.
 *
 * TWO SUB-CASES (scope-dive §B.3 / predecessor §3.1 step 5):
 *   - `writes` edge on a `@reactive` cell → ADMISSIBLE. The cell's value is
 *     marshalled forward as a parameter to the later stub (M1.5 emit). A
 *     reactive cell is a single in-memory value, not a transactional row —
 *     forwarding it preserves the observable result.
 *   - `invalidates` edge (SQL-row identity) → IRREDUCIBLE. The later batch's
 *     SELECT needs transactional consistency with the earlier batch's write;
 *     splitting them across two server requests breaks that consistency
 *     envelope. REJECT with E-CPS-MULTIBATCH-REORDER.
 *
 * `awaits` edges are NOT reject candidates — they are exactly the chained-CPS
 * pattern multi-batch CPS is designed to support (the later batch awaits the
 * earlier batch's result; M1.5 forwards it as a parameter). `reads` edges on
 * non-reactive locals likewise forward as parameters. `control-anchors` edges
 * never cross a batch boundary by construction (the coalescer fences them).
 *
 * @param dg          the body-DG.
 * @param batchOf     stmt index → batch number (client statements absent).
 * @param topoOrder   the full schedule — used to confirm a client statement
 *                    genuinely sits between the two server statements.
 */
function detectCrossBatchReject(
  dg: BodyDG,
  batchOf: Map<number, number>,
  topoOrder: number[],
): CPSPlannerReject | null {
  const posInTopo = new Map<number, number>();
  topoOrder.forEach((idx, pos) => posInTopo.set(idx, pos));

  for (const edge of dg.edges) {
    // Only durable-write edge kinds are reject candidates.
    if (edge.kind !== "invalidates" && edge.kind !== "writes") continue;

    const fromBatch = batchOf.get(edge.from);
    const toBatch = batchOf.get(edge.to);
    // Both endpoints must be server statements (in some batch).
    if (fromBatch === undefined || toBatch === undefined) continue;
    // Same batch — the dependency is satisfied within one transactional
    // envelope. Not a cross-batch concern.
    if (fromBatch === toBatch) continue;

    // A cross-batch durable-write edge. `invalidates` is always irreducible
    // (SQL-row identity / transactional consistency). A `writes` edge is
    // reducible iff it is a reactive-cell write-write — those forward as a
    // parameter (admissible). The body-DG's `writes` edges are emitted for
    // shared `@var` write targets (reactive cells), so a `writes` edge is the
    // ADMISSIBLE param-forwarding case; an `invalidates` edge is the REJECT.
    if (edge.kind === "writes") {
      // Reactive-cell cross-batch write-write — admissible (param-forwarded).
      continue;
    }

    // `invalidates` — irreducible SQL-row-identity cross-batch dependency.
    const writerIdx = Math.min(edge.from, edge.to);
    const laterIdx = Math.max(edge.from, edge.to);
    return {
      status: "reject",
      code: "E-CPS-MULTIBATCH-REORDER",
      offendingEdge: edge,
      offendingStmtIndices: [writerIdx, laterIdx],
      message:
        `multi-batch CPS cannot split this body: statement ${edge.to} and ` +
        `statement ${edge.from} both touch the SQL table '${edge.via}' ` +
        `across a batch boundary (batch ${toBatch} → batch ${fromBatch}). ` +
        `The later SELECT needs transactional consistency with the earlier ` +
        `write; splitting them across two server requests breaks that ` +
        `consistency envelope. Keep both statements in one server run, or ` +
        `move the intervening client statement.`,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Step 4 — `<machine>` `.advance()` crossing a batch boundary
// ---------------------------------------------------------------------------

/**
 * Detect a `<machine>` `.advance()` chain whose transitions land in DIFFERENT
 * batches.
 *
 * Open-question resolution (scope-dive §I): machine-crossing is a guard
 * violation ONLY WHEN A BATCH BOUNDARY INTERVENES between two advances on the
 * SAME machine. Two `.advance()` calls inside ONE batch's serial execution do
 * NOT cross — the batch runs as one server request, the §51 allowed-from-state
 * guard sees the intermediate state, and the transition chain is observable
 * exactly as written. The "batch boundary intervenes" refinement is therefore
 * BUILT IN, not a follow-up: this function only fires when two advances on the
 * same machine receiver have DISTINCT batch numbers. A single batch with N
 * advances on one machine produces NO diagnostic. There is no false-positive
 * surface for the within-batch case.
 *
 * Detection: for each statement, extract the machine receiver of an `.advance`
 * call (the identifier the `.advance` member is called on). Group advances by
 * receiver name. If any receiver has advances mapped to two or more distinct
 * batch numbers → reject.
 *
 * @param body     the function body — `.advance` shapes are inspected here.
 * @param batchOf  stmt index → batch number (client statements absent).
 */
function detectMachineCrossing(
  body: LogicStatement[],
  batchOf: Map<number, number>,
): CPSPlannerReject | null {
  // receiver name → list of { stmtIndex, batch }.
  const advancesByMachine = new Map<
    string,
    Array<{ stmtIndex: number; batch: number }>
  >();

  for (let i = 0; i < body.length; i++) {
    const receiver = machineAdvanceReceiver(body[i]);
    if (!receiver) continue;
    const batch = batchOf.get(i);
    // An `.advance()` on the client tier has no batch — it cannot cross a
    // SERVER batch boundary (the planner only batches server work). Skip.
    if (batch === undefined) continue;
    let list = advancesByMachine.get(receiver);
    if (!list) {
      list = [];
      advancesByMachine.set(receiver, list);
    }
    list.push({ stmtIndex: i, batch });
  }

  for (const [receiver, advances] of advancesByMachine) {
    if (advances.length < 2) continue;
    // Two advances in DIFFERENT batches → crossing.
    for (let a = 0; a < advances.length; a++) {
      for (let b = a + 1; b < advances.length; b++) {
        if (advances[a].batch !== advances[b].batch) {
          const first = advances[a].stmtIndex;
          const second = advances[b].stmtIndex;
          return {
            status: "reject",
            code: "E-CPS-MULTIBATCH-MACHINE-CROSSING",
            // Machine crossing is statement-mediated, not edge-mediated.
            offendingEdge: undefined,
            offendingStmtIndices: [Math.min(first, second), Math.max(first, second)],
            message:
              `multi-batch CPS cannot split this body: '${receiver}.advance()' ` +
              `is called at statement ${first} (batch ${advances[a].batch}) and ` +
              `again at statement ${second} (batch ${advances[b].batch}). ` +
              `A '<engine>' transition chain that crosses a server batch ` +
              `boundary cannot guarantee the §51 allowed-from-state guard — ` +
              `the intermediate state is not observable across two server ` +
              `requests. Keep all transitions of '${receiver}' in one server ` +
              `run.`,
          };
        }
      }
    }
  }

  return null;
}

/**
 * If `stmt` is a bare `<machine>` `.advance(...)` call, return the receiver
 * identifier name (the machine the transition acts on). Otherwise return `""`.
 *
 * Mirrors `monotonicity-analyzer.ts:isMachineAdvanceCall` but additionally
 * extracts the receiver so advances on DIFFERENT machines are not conflated.
 * The shape is `bare-expr` → `call` → callee `member` whose `property` is
 * `advance`; the receiver is the member's `object`.
 */
function machineAdvanceReceiver(stmt: LogicStatement): string {
  if (!stmt || typeof stmt !== "object") return "";
  const node = stmt as Record<string, unknown>;
  if (node.kind !== "bare-expr") return "";
  const exprNode = node.exprNode as ExprNode | undefined;
  if (!exprNode) return "";
  const call = exprNode as unknown as Record<string, unknown>;
  if (call.kind !== "call") return "";
  const callee = call.callee as Record<string, unknown> | undefined;
  if (!callee || callee.kind !== "member") return "";
  // `member.property` may be a plain string (`parseExprToNode` shape) or a
  // node carrying `name` / `text` — handle both conservatively.
  const prop = callee.property;
  let propName: string | undefined;
  if (typeof prop === "string") {
    propName = prop;
  } else if (prop && typeof prop === "object") {
    const p = prop as Record<string, unknown>;
    propName =
      (typeof p.name === "string" ? p.name : undefined) ??
      (typeof p.text === "string" ? p.text : undefined);
  }
  if (propName !== "advance") return "";
  // Extract the receiver — the object the `.advance` member is on. Conservative:
  // a plain identifier receiver. A member-chain receiver (`a.b.advance()`) uses
  // its leftmost identifier so two advances on the same root machine conflate.
  let recv = callee.object as Record<string, unknown> | undefined;
  while (recv && (recv.kind === "member" || recv.kind === "index")) {
    recv = recv.object as Record<string, unknown> | undefined;
  }
  if (recv && recv.kind === "ident" && typeof recv.name === "string") {
    return recv.name;
  }
  return "";
}
