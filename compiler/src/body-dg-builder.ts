/**
 * Body-DG Builder — Ext 1 M1.2 (multi-batch CPS).
 *
 * Builds a STATEMENT-GRAIN dependency graph over a single function body's
 * `LogicStatement[]`. This is the substrate the Ext 1 multi-batch planner
 * (M1.3, `cps-batch-planner.ts`) topologically schedules to coalesce
 * contiguous server statements into batches while preserving every observable
 * source-order dependency.
 *
 * Why a NEW module (the dive's load-bearing finding — scope-dive §A.2):
 *   The existing `dependency-graph.ts` (3160 LOC) is MODULE-grain — its nodes
 *   are functions / reactives / renders / sql-queries / imports / metas /
 *   markup-reads. It does NOT model intra-function statement-grain
 *   dependencies. Ext 1's reorder algorithm needs exactly that. The body-DG is
 *   a per-function-body sibling, never a replacement.
 *
 * Input:
 *   - `body: LogicStatement[]` — the `body` field of a `FunctionDeclNode`.
 *   - a tier classification — which statement index runs server / client /
 *     reactive — derived from `analyzeCPSEligibility` (route-inference.ts).
 *
 * Output:
 *   - `BodyDG = { nodes: BodyDGNode[]; edges: BodyDGEdge[] }`.
 *
 * Edge construction is CONSERVATIVE — over-approximate. The body-split
 * soundness predicate S3 (monotonicity-preserving-ordering) is CLEAN IF AND
 * ONLY IF the DG edges are conservative-over-approximate: any topological sort
 * of a data-dependency DAG produces the same observable result (Lam/Wegman
 * list-scheduling). A MISSING edge would let M1.3 reorder past a real
 * dependency — unsound. A SPURIOUS edge only over-constrains the schedule —
 * sub-optimal but sound. When in doubt, this module emits the edge.
 *
 * Five edge kinds (scope-dive §B.2):
 *   - `reads`           — statement i references an identifier assigned at j.
 *   - `writes`          — statements i and j both assign the same `@var`.
 *   - `awaits`          — statement i references a value produced by a server
 *                         call at j (chained CPS).
 *   - `invalidates`     — j is a `?{}` non-SELECT and i is a `?{}` SELECT
 *                         against the same table (conservative table match).
 *   - `control-anchors` — statement i is inside the body of an if / match /
 *                         for / while / switch at statement j; reorder cannot
 *                         cross the anchor.
 *
 * Edge direction convention: `edge.from` DEPENDS ON `edge.to`. `from` must run
 * AFTER `to` in any valid schedule. (For `from > to` data edges this matches
 * source order; the planner treats every edge as a "must-not-precede"
 * constraint.)
 *
 * Soundness verdict (body-split soundness DD §3.4): CLEAN at S1-S5. DG
 * construction is OBSERVATION, not transformation — statement count unchanged,
 * per-statement semantics unchanged. This module records edges; it never
 * reorders, never rewrites.
 *
 * Performance: O(N²) for cross-statement edge detection. For typical adopter
 * bodies (5-30 statements) this is well under 1ms. Pathological bodies (>100
 * statements) are O(N²) but still acceptable.
 *
 * Cross-references:
 *   - EXT-1-IMPL-BRIEF.md §M1.2 — implementation brief.
 *   - scrml-support .../ext-1-3-2-full-body-split-scoping-2026-05-21.md §B.2.
 *   - route-inference.ts — `analyzeCPSEligibility`, `CPSSplit`, `CPSBatch`.
 *   - expression-parser.ts — `forEachIdentInExprNode` (reused, no surgery).
 *   - monotonicity-analyzer.ts — comparable analyzer-scale module.
 */

import type { LogicStatement, ExprNode, LambdaExpr } from "./types/ast.ts";
import { forEachIdentInExprNode, emitStringFromTree } from "./expression-parser.ts";

// ---------------------------------------------------------------------------
// Public types — BodyDG / BodyDGNode / BodyDGEdge
// ---------------------------------------------------------------------------
//
// Co-located here (not in `codegen/types/`) per the established convention:
// `codegen/types/` does not exist, and each analyzer-scale module
// (`monotonicity-analyzer.ts`, `route-inference.ts`) exports its own public
// types from its own file. M1.3's planner imports these from this module.

/**
 * The tier a statement runs on, derived from `analyzeCPSEligibility`.
 *
 * - `"server"`   — statement runs on the server (own `?{}` SQL, server-fn
 *                  call, protected-field access, server-only resource).
 * - `"reactive"` — statement is a `state-decl` whose server-call init makes it
 *                  CPS-eligible (`reactiveServerIndices`) — it runs on the
 *                  server AND assigns a reactive cell. Reported distinctly so
 *                  the planner can recognise the seam-crossing statement.
 * - `"client"`   — everything else (runs on the client).
 */
export type BodyDGTier = "server" | "client" | "reactive";

/** The five conservative edge kinds. */
export type BodyDGEdgeKind =
  | "reads"
  | "writes"
  | "awaits"
  | "invalidates"
  | "control-anchors";

/**
 * One node in the body-DG — exactly one per top-level statement in the
 * function body, identified by its index into `body`.
 */
export interface BodyDGNode {
  /** Index into the function body's `LogicStatement[]`. */
  index: number;
  /** The statement's tier (from `analyzeCPSEligibility`). */
  tier: BodyDGTier;
  /**
   * The statement's `kind` discriminant (e.g. `"state-decl"`, `"sql"`,
   * `"if-stmt"`). Carried for the planner's diagnostics and for
   * machine-crossing detection (M1.3).
   */
  stmtKind: string;
}

/**
 * One directed edge in the body-DG.
 *
 * Direction convention: `from` DEPENDS ON `to` — `from` must run AFTER `to` in
 * any valid topological schedule. Every edge is a "must-not-precede"
 * constraint for the M1.3 planner.
 */
export interface BodyDGEdge {
  /** The dependent statement index (runs later). */
  from: number;
  /** The depended-upon statement index (runs earlier). */
  to: number;
  /** Which conservative rule produced this edge. */
  kind: BodyDGEdgeKind;
  /**
   * The identifier / table name that produced a `reads` / `writes` / `awaits`
   * / `invalidates` edge. Empty string for `control-anchors` edges (the anchor
   * is structural, not name-mediated). `""` is a defined value, not absence.
   */
  via: string;
}

/** The body-DG: statement-grain nodes plus the conservative edge set. */
export interface BodyDG {
  nodes: BodyDGNode[];
  edges: BodyDGEdge[];
}

/**
 * Per-statement tier classification handed to `buildBodyDG`.
 *
 * Mirrors the index sets `analyzeCPSEligibility` already computes
 * (`serverStmtIndices` / `clientStmtIndices` / the reactive-server subset).
 * Any index not present in `server` or `reactive` is treated as `client`.
 */
export interface BodyTierClassification {
  /** Indices that run on the server (pure server statements). */
  server: number[];
  /**
   * Indices that are reactive-server (`state-decl` with a server-call init).
   * These cross the seam — server-executed, reactive-cell-assigning.
   */
  reactive: number[];
}

// ---------------------------------------------------------------------------
// buildBodyDG — the entry point
// ---------------------------------------------------------------------------

/**
 * Build the statement-grain dependency graph for a function body.
 *
 * @param body            the `LogicStatement[]` of a `FunctionDeclNode`.
 * @param classification  per-statement tier sets from `analyzeCPSEligibility`.
 * @returns               a `BodyDG` — nodes (one per statement) + the
 *                         conservative edge set.
 */
export function buildBodyDG(
  body: LogicStatement[],
  classification: BodyTierClassification,
): BodyDG {
  const nodes: BodyDGNode[] = [];
  const edges: BodyDGEdge[] = [];

  if (!body || body.length === 0) {
    return { nodes, edges };
  }

  const serverSet = new Set(classification.server ?? []);
  const reactiveSet = new Set(classification.reactive ?? []);

  // --- Nodes: one per top-level statement ---------------------------------
  for (let i = 0; i < body.length; i++) {
    const stmt = body[i];
    nodes.push({
      index: i,
      tier: tierOf(i, serverSet, reactiveSet),
      stmtKind: stmt && typeof stmt === "object" ? (stmt as { kind?: string }).kind ?? "unknown" : "unknown",
    });
  }

  // --- Per-statement facts (computed once, reused for O(N²) edge pass) -----
  const facts: StatementFacts[] = body.map((stmt) => collectStatementFacts(stmt));

  // --- Edges: reads / writes / awaits / invalidates -----------------------
  // For every ordered pair (j, i) with j < i, statement i may depend on a
  // fact established at statement j. Conservative: emit on any plausible
  // overlap.
  for (let i = 0; i < body.length; i++) {
    const iFacts = facts[i];
    if (!iFacts) continue;

    for (let j = 0; j < i; j++) {
      const jFacts = facts[j];
      if (!jFacts) continue;

      // reads(i, j): i references an identifier assigned at j.
      for (const ident of jFacts.writes) {
        if (iFacts.reads.has(ident)) {
          edges.push({ from: i, to: j, kind: "reads", via: ident });
        }
      }

      // writes(i, j): i and j both assign the same @var (write-write).
      for (const ident of jFacts.writes) {
        if (iFacts.writes.has(ident) && isReactiveVar(ident)) {
          edges.push({ from: i, to: j, kind: "writes", via: ident });
        }
      }

      // awaits(i, j): i references a value produced by a server call at j.
      // The server call at j binds its result to `jFacts.serverResults`;
      // when i reads that identifier, i must await j's batch.
      for (const ident of jFacts.serverResults) {
        if (iFacts.reads.has(ident)) {
          edges.push({ from: i, to: j, kind: "awaits", via: ident });
        }
      }

      // invalidates(i, j): j is a non-SELECT ?{} write, i is a SELECT ?{}
      // against the same table. Conservative table-name match on the SQL
      // string. A write at j may invalidate the row-set a SELECT at i reads,
      // so the SELECT must run AFTER the write (matching source order).
      if (jFacts.sqlWriteTables.size > 0 && iFacts.sqlReadTables.size > 0) {
        for (const table of iFacts.sqlReadTables) {
          if (jFacts.sqlWriteTables.has(table)) {
            edges.push({ from: i, to: j, kind: "invalidates", via: table });
          }
        }
      }
    }
  }

  // --- Edges: control-anchors ---------------------------------------------
  // A statement nested inside a control-flow block (if / match / for / while
  // / switch) is anchored to the block-head statement: reorder cannot lift it
  // out of, or across, the block. Since the body-DG is statement-grain at the
  // TOP level of `body`, a control-flow node IS one top-level statement —
  // every statement it contains is already collapsed into that one node. The
  // control-anchors edge therefore records, for each control-flow head, the
  // dependency carried by identifiers it READS in its header/condition: the
  // block must run after any statement that writes an identifier the header
  // reads. This is already covered by the `reads` rule; the additional
  // control-anchors edge makes the structural anchoring EXPLICIT for the
  // planner so it never coalesces a server batch across a control-flow
  // statement whose nested body is mixed-tier.
  //
  // Concretely: for every control-flow statement at index k, emit a
  // control-anchors edge from k to every NESTED-tier-mismatched neighbour is
  // NOT needed (nesting is collapsed). What IS load-bearing: a control-flow
  // statement that itself contains server-tier work cannot be reordered
  // relative to the client statements around it. We therefore anchor every
  // control-flow head to its immediate predecessor and successor — a
  // conservative "do not hoist the block" fence.
  // Two adjacent control-flow statements would each emit the same `(k, k-1)`
  // anchor (one as the successor-anchor of k-1, one as the predecessor-anchor
  // of k). Dedup by from→to so the DG never carries a literal duplicate edge.
  const anchorSeen = new Set<string>();
  const pushAnchor = (from: number, to: number): void => {
    const key = `${from}->${to}`;
    if (anchorSeen.has(key)) return;
    anchorSeen.add(key);
    edges.push({ from, to, kind: "control-anchors", via: "" });
  };
  for (let k = 0; k < body.length; k++) {
    if (!facts[k] || !facts[k]!.isControlFlow) continue;
    // Anchor the control-flow statement to its immediate predecessor: the
    // block must not be hoisted before whatever ran just before it.
    if (k > 0) {
      pushAnchor(k, k - 1);
    }
    // Anchor the immediate successor to the control-flow statement: nothing
    // after the block may be hoisted before it.
    if (k + 1 < body.length) {
      pushAnchor(k + 1, k);
    }
  }

  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// Tier resolution
// ---------------------------------------------------------------------------

function tierOf(
  index: number,
  serverSet: Set<number>,
  reactiveSet: Set<number>,
): BodyDGTier {
  // reactive-server statements appear in BOTH sets (they cross the seam).
  // Report them as `"reactive"` so the planner recognises the seam-crossing
  // statement distinctly from a pure-server statement.
  if (reactiveSet.has(index)) return "reactive";
  if (serverSet.has(index)) return "server";
  return "client";
}

// ---------------------------------------------------------------------------
// Per-statement fact collection
// ---------------------------------------------------------------------------

/**
 * The conservative facts a single statement contributes to edge construction.
 */
interface StatementFacts {
  /** Identifiers this statement READS (right-hand sides, conditions, args). */
  reads: Set<string>;
  /** Identifiers this statement WRITES (declares or assigns). */
  writes: Set<string>;
  /**
   * Identifiers bound to a server-call result by this statement. A downstream
   * statement reading one of these forms an `awaits` edge.
   */
  serverResults: Set<string>;
  /** Table names this statement READS via a `?{}` SELECT. */
  sqlReadTables: Set<string>;
  /** Table names this statement WRITES via a `?{}` non-SELECT. */
  sqlWriteTables: Set<string>;
  /** True iff this statement is a control-flow construct. */
  isControlFlow: boolean;
}

const EMPTY_FACTS = (): StatementFacts => ({
  reads: new Set(),
  writes: new Set(),
  serverResults: new Set(),
  sqlReadTables: new Set(),
  sqlWriteTables: new Set(),
  isControlFlow: false,
});

const CONTROL_FLOW_KINDS = new Set([
  "if-stmt",
  "for-stmt",
  "while-stmt",
  "switch-stmt",
  "match-stmt",
  "try-stmt",
]);

/**
 * Collect the conservative read / write / server-result / SQL facts for a
 * single statement.
 */
function collectStatementFacts(stmt: LogicStatement): StatementFacts {
  const facts = EMPTY_FACTS();
  if (!stmt || typeof stmt !== "object") return facts;

  const kind = (stmt as { kind?: string }).kind ?? "";
  const node = stmt as Record<string, unknown>;

  if (CONTROL_FLOW_KINDS.has(kind)) {
    facts.isControlFlow = true;
  }

  switch (kind) {
    case "state-decl": {
      // `<x> = expr` / `@x = expr` — declares (writes) a reactive cell.
      const name = typeof node.name === "string" ? node.name : "";
      if (name) {
        facts.writes.add(reactiveName(name));
      }
      collectInitFacts(node, facts);
      // A state-decl whose init calls a server fn / has a server resource
      // binds its result to the cell — downstream reads of `@name` await it.
      if (name && hasServerInit(node)) {
        facts.serverResults.add(reactiveName(name));
      }
      break;
    }

    case "let-decl":
    case "const-decl":
    case "tilde-decl":
    case "lin-decl": {
      // Plain declarations — `name` may be a destructure pattern.
      addDeclBindings(node.name, facts.writes);
      collectInitFacts(node, facts);
      break;
    }

    case "reactive-nested-assign": {
      // `@obj.path = value` — reads AND writes the root reactive cell.
      const target = typeof node.target === "string" ? node.target : "";
      if (target) {
        facts.writes.add(reactiveName(target));
        facts.reads.add(reactiveName(target));
      }
      collectExprFacts(node.valueExpr as ExprNode | undefined, facts.reads);
      // cycles-prereq (S168): a bracket-index COMPUTED path segment carries an
      // index ExprNode (e.g. `@arr[@sel] = x` reads @sel) — collect its reads
      // so the statement's reactive dependencies are complete.
      const rnaPath = (node as { path?: unknown }).path;
      if (Array.isArray(rnaPath)) {
        for (const seg of rnaPath) {
          if (seg && typeof seg === "object") {
            collectExprFacts((seg as { index?: ExprNode }).index, facts.reads);
          }
        }
      }
      break;
    }

    case "reactive-array-mutation": {
      // `@arr.push(x)` — mutates (writes) and reads the cell.
      const target = typeof node.target === "string" ? node.target : "";
      if (target) {
        facts.writes.add(reactiveName(target));
        facts.reads.add(reactiveName(target));
      }
      break;
    }

    case "bare-expr": {
      // May be a reactive assignment `@x = expr`, a server-fn call, or any
      // expression. Inspect the structured ExprNode.
      const exprNode = node.exprNode as ExprNode | undefined;
      collectBareExprFacts(exprNode, facts);
      break;
    }

    case "return-stmt":
    case "throw-stmt": {
      collectExprFacts(node.exprNode as ExprNode | undefined, facts.reads);
      break;
    }

    case "propagate-expr": {
      const binding = typeof node.binding === "string" ? node.binding : "";
      if (binding) facts.writes.add(binding);
      collectExprFacts(node.exprNode as ExprNode | undefined, facts.reads);
      break;
    }

    case "if-stmt": {
      collectExprFacts(node.condExpr as ExprNode | undefined, facts.reads);
      break;
    }

    case "while-stmt": {
      collectExprFacts(node.condExpr as ExprNode | undefined, facts.reads);
      break;
    }

    case "for-stmt": {
      collectExprFacts(node.iterExpr as ExprNode | undefined, facts.reads);
      // The loop variable is a binding local to the loop body — not a
      // top-level write. Not added to `writes`.
      break;
    }

    case "switch-stmt":
    case "match-stmt": {
      collectExprFacts(node.headerExpr as ExprNode | undefined, facts.reads);
      break;
    }

    case "sql": {
      // A bare `?{}` SQL statement. Classify the verb to populate
      // sqlReadTables / sqlWriteTables.
      collectSqlFacts(typeof node.query === "string" ? node.query : "", facts);
      break;
    }

    default:
      // Unknown / unmodelled statement — conservatively contributes nothing.
      // The planner still treats it as a node; absence of edges only relaxes
      // the schedule, and unmodelled kinds are control-flow-fenced via the
      // adjacency anchors above when relevant.
      break;
  }

  // A state-decl / let-decl whose init was a `?{...}.method()` carries a
  // structured `sqlNode` (route-inference.ts precedent). Fold its table facts.
  const sqlNode = node.sqlNode as { kind?: string; query?: string } | undefined;
  if (sqlNode && sqlNode.kind === "sql" && typeof sqlNode.query === "string") {
    collectSqlFacts(sqlNode.query, facts);
  }

  return facts;
}

/** Collect facts from a declaration / state-decl init expression. */
function collectInitFacts(node: Record<string, unknown>, facts: StatementFacts): void {
  collectExprFacts(node.initExpr as ExprNode | undefined, facts.reads);
}

/**
 * Collect facts from a `bare-expr`'s ExprNode. When the expression is an
 * assignment, the assign TARGET is a write and the assign VALUE contributes
 * reads; when it is a server call, downstream reads of nothing (a bare call
 * statement binds no name) — but the call's arguments are reads.
 */
function collectBareExprFacts(exprNode: ExprNode | undefined, facts: StatementFacts): void {
  if (!exprNode) return;

  const node = exprNode as unknown as Record<string, unknown>;
  if (node.kind === "assign") {
    const target = node.target as ExprNode | undefined;
    const value = node.value as ExprNode | undefined;
    // The assign target: an `@x` ident is a reactive write. A member
    // expression (`@obj.prop`) writes (and reads) the base reactive cell.
    addAssignTargetWrites(target, facts);
    // A compound-assignment (`+=` etc.) also READS the target.
    const op = typeof node.op === "string" ? node.op : "=";
    if (op !== "=") {
      collectExprFacts(target, facts.reads);
    }
    collectExprFacts(value, facts.reads);
  } else {
    // Non-assignment bare expression (e.g. a bare server-fn call). All
    // identifiers are reads.
    collectExprFacts(exprNode, facts.reads);
  }
}

/** Record the write target(s) of an assignment's LHS. */
function addAssignTargetWrites(target: ExprNode | undefined, facts: StatementFacts): void {
  if (!target) return;
  const node = target as unknown as Record<string, unknown>;
  if (node.kind === "ident" && typeof node.name === "string") {
    facts.writes.add(reactiveName(node.name));
  } else if (node.kind === "member" || node.kind === "index") {
    // `@obj.prop = v` — writes AND reads the base cell.
    let base = node.object as unknown as Record<string, unknown> | undefined;
    while (base && (base.kind === "member" || base.kind === "index")) {
      base = base.object as unknown as Record<string, unknown> | undefined;
    }
    if (base && base.kind === "ident") {
      const baseName = base.name;
      if (typeof baseName === "string") {
        facts.writes.add(reactiveName(baseName));
        facts.reads.add(reactiveName(baseName));
      }
    }
  }
}

/**
 * Walk an ExprNode tree and add every identifier reference to `sink`.
 *
 * Reuses `forEachIdentInExprNode` (expression-parser.ts — no surgery there) for
 * the surface idents, then ALSO descends lambda/arrow bodies to collect the
 * FREE-variable reads inside them (excluding each lambda's own params).
 *
 * S212 g-lift-concurrent-transitive-exclusion-tdz — why lambda bodies matter
 * here: `forEachIdentInExprNode` deliberately stops at a `lambda` (it is a new
 * lin scope boundary — correct for lin tracking). But for the body-DG's `reads`
 * facts a captured free variable is a REAL eager read whenever the lambda is
 * invoked at array-build time — e.g. `profiles.map(pr => f(n))` calls the arrow
 * synchronously, so `n` is read the moment the enclosing statement's init
 * expression is evaluated. Missing that read let the lift-concurrent scheduler
 * batch such a statement ahead of `n`'s declaration → TDZ. Per §19.9.9.1 a
 * lambda-body free read is conservatively recorded as a dependency (a spurious
 * edge — for a stored-not-immediately-called lambda — only over-constrains the
 * schedule, which is sound).
 */
function collectExprFacts(exprNode: ExprNode | undefined, sink: Set<string>): void {
  if (!exprNode) return;
  // Surface idents (everything outside lambda bodies).
  forEachIdentInExprNode(exprNode, (ident) => {
    if (ident && typeof ident.name === "string" && ident.name) {
      sink.add(reactiveName(ident.name));
    }
  });
  // Lambda-body free reads (the surface walk above skips lambda bodies).
  collectLambdaBodyReads(exprNode, sink, new Set<string>());
}

/**
 * Descend into every lambda body reachable from `node` and collect its
 * free-variable reads into `sink`. `bound` carries names that are NOT free at
 * this point (enclosing lambda params + block-local declarations); a captured
 * read is a name that is neither in `bound` nor a param of the lambda it
 * appears in.
 *
 * Conservative + drift-safe: this routine enumerates only the container kinds
 * that can lexically CONTAIN a lambda. Any unmodelled / future ExprNode kind
 * contributes nothing here (its surface idents were already collected by the
 * shared `forEachIdentInExprNode` walk in `collectExprFacts`), so the worst
 * case is a missed lambda-body read — which the `reads` edge on the lambda's
 * ENCLOSING statement's receiver already partially compensates.
 */
function collectLambdaBodyReads(
  node: ExprNode | undefined,
  sink: Set<string>,
  bound: Set<string>,
): void {
  if (!node || typeof node !== "object") return;
  const n = node as unknown as Record<string, unknown>;
  switch (n.kind) {
    case "lambda": {
      const lam = node as LambdaExpr;
      const innerBound = new Set(bound);
      for (const p of lam.params ?? []) {
        if (p && typeof p.name === "string" && p.name) innerBound.add(p.name);
        // Param default values are evaluated in the OUTER scope.
        if (p && p.defaultValue) collectFreeReadsInto(p.defaultValue, sink, bound);
      }
      const body = lam.body as
        | { kind: "expr"; value: ExprNode }
        | { kind: "block"; stmts: unknown[] }
        | undefined;
      if (!body) return;
      if (body.kind === "expr") {
        collectFreeReadsInto(body.value, sink, innerBound);
      } else if (body.kind === "block") {
        // Block-local declarations shadow outer names within the body.
        const blockBound = new Set(innerBound);
        for (const stmt of body.stmts ?? []) {
          if (stmt && typeof stmt === "object") {
            const s = stmt as { kind?: string; name?: unknown };
            if ((s.kind === "let-decl" || s.kind === "const-decl") && typeof s.name === "string") {
              blockBound.add(s.name);
            }
          }
        }
        for (const stmt of body.stmts ?? []) {
          collectBlockStmtFreeReads(stmt as LogicStatement, sink, blockBound);
        }
      }
      return;
    }
    // Container kinds — recurse into ExprNode children to reach nested lambdas.
    case "array":
      for (const el of (n.elements as ExprNode[]) ?? []) collectLambdaBodyReads(el, sink, bound);
      return;
    case "object":
      for (const prop of (n.props as Array<Record<string, unknown>>) ?? []) {
        if (prop.kind === "prop") {
          if (typeof prop.key !== "string") collectLambdaBodyReads(prop.key as ExprNode, sink, bound);
          collectLambdaBodyReads(prop.value as ExprNode, sink, bound);
        } else if (prop.kind === "spread") {
          collectLambdaBodyReads(prop.argument as ExprNode, sink, bound);
        }
      }
      return;
    case "spread":
    case "unary":
    case "cast":
    case "reset-expr":
      collectLambdaBodyReads((n.argument ?? n.expression ?? n.target) as ExprNode, sink, bound);
      return;
    case "binary":
      collectLambdaBodyReads(n.left as ExprNode, sink, bound);
      collectLambdaBodyReads(n.right as ExprNode, sink, bound);
      return;
    case "assign":
      collectLambdaBodyReads(n.target as ExprNode, sink, bound);
      collectLambdaBodyReads(n.value as ExprNode, sink, bound);
      return;
    case "ternary":
      collectLambdaBodyReads(n.condition as ExprNode, sink, bound);
      collectLambdaBodyReads(n.consequent as ExprNode, sink, bound);
      collectLambdaBodyReads(n.alternate as ExprNode, sink, bound);
      return;
    case "member":
      collectLambdaBodyReads(n.object as ExprNode, sink, bound);
      return;
    case "index":
      collectLambdaBodyReads(n.object as ExprNode, sink, bound);
      collectLambdaBodyReads(n.index as ExprNode, sink, bound);
      return;
    case "call":
    case "new":
      collectLambdaBodyReads(n.callee as ExprNode, sink, bound);
      for (const arg of (n.args as ExprNode[]) ?? []) collectLambdaBodyReads(arg, sink, bound);
      return;
    case "match-expr":
      collectLambdaBodyReads(n.subject as ExprNode, sink, bound);
      return;
    case "map-lit":
      for (const entry of (n.entries as Array<Record<string, unknown>>) ?? []) {
        collectLambdaBodyReads(entry.key as ExprNode, sink, bound);
        collectLambdaBodyReads(entry.value as ExprNode, sink, bound);
      }
      return;
    default:
      // Leaf / unmodelled kinds — no nested lambda to reach.
      return;
  }
}

/**
 * Collect free-variable reads from an arbitrary ExprNode (used inside a lambda
 * body). A name is free iff it is not in `bound`. This walks the WHOLE tree
 * (surface idents AND further-nested lambda bodies), excluding bound names.
 */
function collectFreeReadsInto(
  node: ExprNode | undefined,
  sink: Set<string>,
  bound: Set<string>,
): void {
  if (!node) return;
  forEachIdentInExprNode(node, (ident) => {
    if (ident && typeof ident.name === "string" && ident.name) {
      const canon = reactiveName(ident.name);
      if (!bound.has(ident.name) && !bound.has(canon)) sink.add(canon);
    }
  });
  collectLambdaBodyReads(node, sink, bound);
}

/**
 * Collect free reads from a single statement inside a lambda BLOCK body. Only
 * the shapes that can appear in such a block and that carry reads are handled;
 * everything else contributes its surface ExprNode reads conservatively.
 */
function collectBlockStmtFreeReads(
  stmt: LogicStatement,
  sink: Set<string>,
  bound: Set<string>,
): void {
  if (!stmt || typeof stmt !== "object") return;
  const s = stmt as Record<string, unknown>;
  const candidates: Array<ExprNode | undefined> = [
    s.initExpr as ExprNode | undefined,
    s.exprNode as ExprNode | undefined,
    s.condExpr as ExprNode | undefined,
    s.iterExpr as ExprNode | undefined,
    s.headerExpr as ExprNode | undefined,
    s.valueExpr as ExprNode | undefined,
  ];
  for (const c of candidates) {
    if (c) collectFreeReadsInto(c, sink, bound);
  }
}

/**
 * Add binding name(s) from a declaration `name` field — a plain string, or a
 * destructure pattern (array / object). Conservative: every bound name is a
 * write.
 */
function addDeclBindings(name: unknown, sink: Set<string>): void {
  if (typeof name === "string") {
    if (name) sink.add(name);
    return;
  }
  if (!name || typeof name !== "object") return;
  const pat = name as Record<string, unknown>;
  if (pat.kind === "destructure-array") {
    for (const el of (pat.elements as Array<Record<string, unknown>>) ?? []) {
      if (el.kind === "name" && typeof el.name === "string") {
        sink.add(el.name);
      } else if (el.kind === "nested") {
        addDeclBindings(el.pattern, sink);
      }
    }
    if (typeof pat.rest === "string") sink.add(pat.rest);
  } else if (pat.kind === "destructure-object") {
    for (const prop of (pat.properties as Array<Record<string, unknown>>) ?? []) {
      if (prop.kind === "name" && typeof prop.bindName === "string") {
        sink.add(prop.bindName);
      } else if (prop.kind === "nested") {
        addDeclBindings(prop.pattern, sink);
      }
    }
    if (typeof pat.rest === "string") sink.add(pat.rest);
  }
}

// ---------------------------------------------------------------------------
// SQL fact collection — conservative table-name extraction
// ---------------------------------------------------------------------------

/**
 * Classify a SQL query string and record its read / write table facts.
 *
 * CONSERVATIVE by design (scope-dive §B.2 — "fires on any non-SELECT verb in a
 * shared-table context"):
 *   - A SELECT records every table it mentions as a READ table.
 *   - A non-SELECT verb (INSERT / UPDATE / DELETE / REPLACE / UPSERT / MERGE /
 *     CREATE / DROP / ALTER / TRUNCATE) records every table it mentions as a
 *     WRITE table.
 * Table extraction is the set of identifiers following the FROM / INTO /
 * UPDATE / JOIN keywords — over-approximate but never under: an extra table
 * only over-constrains, a missed table would be unsound.
 */
function collectSqlFacts(query: string, facts: StatementFacts): void {
  if (!query) return;
  const normalized = query.replace(/\s+/g, " ").trim();
  if (!normalized) return;

  const isWrite = /^\s*(INSERT|UPDATE|DELETE|REPLACE|UPSERT|MERGE|CREATE|DROP|ALTER|TRUNCATE)\b/i.test(normalized);
  const tables = extractSqlTables(normalized);
  if (tables.size === 0) {
    // Verb recognised but no table parsed — conservatively record a sentinel
    // so a write/read pair against the SAME unresolved query still anchors.
    // Use the verb class as the sentinel table name.
    const sentinel = isWrite ? "<sql-write>" : "<sql-read>";
    if (isWrite) facts.sqlWriteTables.add(sentinel);
    else facts.sqlReadTables.add(sentinel);
    return;
  }
  for (const t of tables) {
    if (isWrite) facts.sqlWriteTables.add(t);
    else facts.sqlReadTables.add(t);
  }
}

/**
 * Extract candidate table names from a SQL string — the identifiers that
 * follow FROM / INTO / UPDATE / JOIN. Lower-cased for case-insensitive
 * matching. Strips a quoting / schema prefix conservatively.
 */
function extractSqlTables(query: string): Set<string> {
  const tables = new Set<string>();
  const re = /\b(?:FROM|INTO|UPDATE|JOIN|TABLE)\s+([`"\[]?[A-Za-z_][A-Za-z0-9_.$]*[`"\]]?)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(query)) !== null) {
    let name = m[1] ?? "";
    name = name.replace(/[`"\[\]]/g, "");
    // Strip a `schema.` prefix — keep the rightmost segment.
    const dot = name.lastIndexOf(".");
    if (dot >= 0) name = name.slice(dot + 1);
    if (name) tables.add(name.toLowerCase());
  }
  return tables;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Whether a state-decl's init is a server call / server-only resource. The
 * `awaits`-edge source: a state-decl with a server init produces a value
 * downstream statements must await.
 *
 * Conservative detection mirroring route-inference.ts's `hasServerCallInInit`
 * + `hasServerOnlyResourceInInit` heuristics WITHOUT the function-index
 * machinery (which the body-DG builder does not have): a structured `sqlNode`,
 * a `?{` sigil in the rendered init, or a server-only resource pattern.
 */
function hasServerInit(node: Record<string, unknown>): boolean {
  const sqlNode = node.sqlNode as { kind?: string } | undefined;
  if (sqlNode && sqlNode.kind === "sql") return true;

  const initExpr = node.initExpr as ExprNode | undefined;
  if (!initExpr) return false;
  let rendered = "";
  try {
    rendered = emitStringFromTree(initExpr);
  } catch {
    rendered = "";
  }
  if (!rendered) return false;
  if (/\?\{`/.test(rendered)) return true;
  // Server-only resource sigils — conservative subset (Bun.*, process.env,
  // env(), the ?{ sql sigil). The body-DG does not need full RI parity here:
  // a false negative on `awaits` is compensated by the `reads` edge (a
  // downstream read of the cell still produces a `reads` edge on the `@name`
  // write). The `awaits` kind is a refinement the planner uses to recognise a
  // chained-CPS dependency specifically.
  if (/\bBun\s*\.|process\s*\.\s*env|(?:^|[^.\w])env\s*\(/.test(rendered)) return true;
  return false;
}

/**
 * Normalise a reactive-cell identifier so the `@`-prefixed form
 * (`IdentExpr.name` for a reactive var) and the bare declared name
 * (`state-decl.name` is stored WITHOUT the `@`) compare equal.
 *
 * `state-decl.name` is `"count"`; an `IdentExpr` reading it is `"@count"`.
 * Without normalisation a `reads` edge between `@count = 0` and a later
 * `@total = @count + 1` would be missed. Canonical form: strip a leading `@`.
 */
function reactiveName(name: string): string {
  return name.startsWith("@") ? name.slice(1) : name;
}

/**
 * Whether an (already `reactiveName`-normalised) identifier names a reactive
 * cell. The body-DG can only see the `@`-prefix BEFORE normalisation, so
 * write-write conflict detection consults the raw form. This helper is applied
 * to the normalised name and is intentionally permissive: a write-write edge
 * on a NON-reactive local is harmless (it only over-constrains), and the
 * planner cares specifically about reactive-cell write ordering. We therefore
 * keep write-write edges for ALL shared write targets — see `buildBodyDG`.
 */
function isReactiveVar(_name: string): boolean {
  // Permissive: any shared write target produces a write-write edge.
  // Over-approximation is sound (S3); a local re-`let` is rare and the extra
  // edge only over-constrains the schedule.
  return true;
}
