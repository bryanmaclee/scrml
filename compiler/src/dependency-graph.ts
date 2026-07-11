/**
 * Dependency Graph Builder -- Stage 7 of the scrml compiler pipeline (DG).
 *
 * Input:
 *   { files: FileAST[], routeMap: RouteMap }
 *
 * Output:
 *   { depGraph: DependencyGraph, errors: DGError[] }
 *
 * DependencyGraph = {
 *   nodes: Map<NodeId, DGNode>,
 *   edges: DGEdge[],
 * }
 *
 * DGNode =
 *   | { kind: 'function',  nodeId, boundary, hasLift, span }
 *   | { kind: 'reactive',  nodeId, varName,  hasLift, span }
 *   | { kind: 'render',    nodeId, markupNodeId, hasLift, span }
 *   | { kind: 'sql-query', nodeId, query,    hasLift, span }
 *   | { kind: 'import',    nodeId, source,   hasLift, span }
 *   | { kind: 'meta',      nodeId, deterministic, hasLift, span }
 *   | { kind: 'markup-read', nodeId, sourceRenderNodeId, ownerScope, hasLift, span }
 *      (A-1.2: per-interpolation markup-context read node; edge emission in A-1.3)
 *
 * DGEdge = { from: NodeId, to: NodeId, kind: 'calls'|'reads'|'writes'|'renders'|'awaits'|'invalidates' }
 *
 * Error codes:
 *   E-DG-001   Cyclic dependency in 'awaits' edges
 *   E-DG-002   Reactive variable has no readers (warning)
 *   E-LIFT-001 Independent lift-bearing nodes in same logic block
 *
 * Performance budget: <= 20 ms for the full project.
 */

import type {
  Span,
  FileAST,
  ASTNode,
  LogicStatement,
  FunctionDeclNode,
  ReactiveDeclNode,
  SQLNode,
  MetaNode,
  MarkupNode,
  ImportDeclNode,
  LogicNode,
  ExprNode,
} from "./types/ast.ts";
// F8 / v0.6 — dual-mode meta-block kind test (live `"meta"` / native `"Meta"`).
import { isMetaKind } from "./types/ast.ts";
import { forEachIdentInExprNode, emitStringFromTree } from "./expression-parser.ts";
import { forEachIdentInValidators, forEachQualifiedCellRefInValidators } from "./validator-arg-parser.ts";

// ---------------------------------------------------------------------------
// DG-internal types (not in the shared AST, specific to Stage 7 output)
// ---------------------------------------------------------------------------

type NodeId = string;

type DGEdgeKind = "calls" | "reads" | "writes" | "renders" | "awaits" | "invalidates" | "validator-reads" | "engine-derived-reads";
type Boundary = "client" | "server";
type Severity = "error" | "warning";

interface BaseDGNode {
  nodeId: NodeId;
  hasLift: boolean;
  span: Span;
}

interface FunctionDGNode extends BaseDGNode {
  kind: "function";
  boundary: Boundary;
  /** Scratch field for pending callee resolution — deleted before returning. */
  _pendingCallees?: string[];
}

interface ReactiveDGNode extends BaseDGNode {
  kind: "reactive";
  varName: string;
}

interface RenderDGNode extends BaseDGNode {
  kind: "render";
  markupNodeId: string;
}

interface SqlQueryDGNode extends BaseDGNode {
  kind: "sql-query";
  query: string;
}

interface ImportDGNode extends BaseDGNode {
  kind: "import";
  source: string;
}

interface MetaDGNode extends BaseDGNode {
  kind: "meta";
  deterministic: boolean;
}

/**
 * A-1.2 — Per-interpolation markup-context read node (Option Y).
 *
 * Each site where a reactive variable is read from markup context gets its
 * own MarkupReadDGNode. This gives the §40.9.3 closure analysis per-
 * interpolation reachability precision — it can ask "which render block
 * reads @counter?" instead of only "does anything read @counter?".
 *
 * Fields:
 *   sourceRenderNodeId  — the NodeId of the enclosing RenderDGNode (the
 *                         markup block that contains this interpolation).
 *                         Resolved by findOwningRenderDGNode. Null when
 *                         the owning render block cannot be statically
 *                         determined (e.g. top-level orphan interpolation).
 *   ownerScope          — string key identifying the lexical scope of the
 *                         containing markup block. Typically the filePath
 *                         plus a stable positional discriminator.
 *
 * Lifecycle:
 *   A-1.2: node kind defined; createMarkupReadNode factory present;
 *          markupContextEmitEdges flag is false — no nodes emitted yet.
 *   A-1.3: markupContextEmitEdges = true; nodes + reads edges emitted.
 */
interface MarkupReadDGNode extends BaseDGNode {
  kind: "markup-read";
  /** NodeId of the RenderDGNode that lexically contains this interpolation. */
  sourceRenderNodeId: NodeId | null;
  /** Lexical scope key — filePath::blockStart, used for grouping. */
  ownerScope: string;
}

type DGNode =
  | FunctionDGNode
  | ReactiveDGNode
  | RenderDGNode
  | SqlQueryDGNode
  | ImportDGNode
  | MetaDGNode
  | MarkupReadDGNode;

interface DGEdge {
  from: NodeId;
  to: NodeId;
  kind: DGEdgeKind;
}

interface DependencyGraph {
  nodes: Map<NodeId, DGNode>;
  edges: DGEdge[];
}

// RouteMap shape as consumed by DG (minimal subset of RI output)
interface RouteEntry {
  boundary: Boundary;
}

interface RouteMap {
  functions?: Map<string, RouteEntry>;
}

/**
 * DG accepts either a raw FileAST (from unit tests) or a TABResult-shaped
 * object (from the real pipeline) where the FileAST is nested under `.ast`.
 * The JS original used duck-typing with `fileAST.nodes ?? fileAST.ast?.nodes`.
 * We preserve that here using `unknown` at the boundary.
 *
 * PGO P1.3 (S102) — when `debugPerf === true`, DG emits two sub-stage timing
 * lines via the `log` channel:
 *   `[DG-PER-FILE] <total>ms across <F> files (avg <M>ms/file, Q1=<P1>ms Q2=<P2>ms Q3=<P3>ms Q4=<P4>ms)`
 *   `[DG-CROSS-FILE] <N>ms`
 * The quartile breakdown samples per-file work at four evenly-spaced bins
 * through the file list to surface whether the S94-observed 8.5× super-
 * linear DG growth is (a) per-file work growing as corpus grows OR
 * (b) cross-file repeated lookups against a growing structure.
 * When `debugPerf` is unset, NO instrumentation overhead is incurred and
 * NO lines are emitted.
 */
interface DGInput {
  files: unknown[];
  routeMap: RouteMap;
  /** PGO P1.3 — opt-in sub-stage timing (default false, zero overhead when unset). */
  debugPerf?: boolean;
  /** PGO P1.3 — log channel for sub-stage lines; defaults to console.log when emitting. */
  log?: (msg: string) => void;
}

interface DGOutput {
  depGraph: DependencyGraph;
  errors: DGError[];
}

// ---------------------------------------------------------------------------
// FileAST resolution helper
//
// The pipeline passes TABResult objects ({ filePath, ast: FileAST, errors })
// while unit tests pass raw FileAST objects ({ filePath, nodes, ... }).
// This helper extracts the effective FileAST from either shape.
// ---------------------------------------------------------------------------

/**
 * Extract a normalized FileAST from either a raw FileAST or a TABResult wrapper.
 * Mirrors the JS pattern: `fileAST.nodes ?? (fileAST.ast ? fileAST.ast.nodes : [])`.
 */
function resolveFileAST(input: unknown): FileAST | null {
  if (!input || typeof input !== "object") return null;
  const obj = input as Record<string, unknown>;

  // If it has `.nodes` directly — it's a FileAST
  if (Array.isArray(obj.nodes) && typeof obj.filePath === "string") {
    return obj as unknown as FileAST;
  }

  // If it has `.ast.nodes` — it's a TABResult wrapper
  if (obj.ast && typeof obj.ast === "object") {
    const ast = obj.ast as Record<string, unknown>;
    if (Array.isArray(ast.nodes) && typeof ast.filePath === "string") {
      return ast as unknown as FileAST;
    }
    // TABResult may have filePath on the wrapper, not on ast
    if (Array.isArray(ast.nodes) && typeof obj.filePath === "string") {
      return { ...(ast as unknown as FileAST), filePath: obj.filePath as string };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class DGError {
  code: string;
  message: string;
  span: Span;
  severity: Severity;

  constructor(code: string, message: string, span: Span, severity: Severity = "error") {
    this.code = code;
    this.message = message;
    this.span = span;
    this.severity = severity;
  }
}

// ---------------------------------------------------------------------------
// NodeId generation
// ---------------------------------------------------------------------------

let _nodeCounter = 0;

/**
 * Generate a unique node ID from a file path and span.
 */
function makeNodeId(filePath: string, span: Span, prefix: string): NodeId {
  _nodeCounter++;
  return `${prefix}::${filePath}::${span.start}::${_nodeCounter}`;
}

// ---------------------------------------------------------------------------
// A-1.2 — MarkupReadDGNode helpers (module-level, exported for testability)
// ---------------------------------------------------------------------------

/**
 * findOwningRenderDGNode — given an AST node that lives inside a markup
 * context, return the NodeId of the RenderDGNode for the tightest enclosing
 * markup block in the given nodes map. Returns null when no enclosing render
 * node is registered (e.g. a top-level orphan interpolation).
 *
 * Strategy: linear scan over all DGNodes looking for RenderDGNode candidates
 * whose span contains astNode.span. Prefers the innermost (tightest) match.
 * The scan is O(n) in the number of registered DG nodes — acceptable because
 * the set of render nodes per compilation unit is small. A-1.3 may replace
 * this with a pre-built interval tree if profiling shows a bottleneck.
 *
 * Exported for unit-testing in A-1.2; consumed by the emission logic in A-1.3.
 */
export function findOwningRenderDGNode(
  astNode: ASTNode,
  dgNodes: Map<NodeId, DGNode>,
): NodeId | null {
  const nodeSpan = astNode.span;
  if (!nodeSpan) return null;
  let bestId: NodeId | null = null;
  let bestSize = Infinity;
  for (const [candidateId, candidate] of dgNodes) {
    if (candidate.kind !== "render") continue;
    const cs = candidate.span;
    if (!cs) continue;
    // A render node encloses the astNode if it starts at or before the
    // astNode's start and ends at or after the astNode's end.
    if (cs.start <= nodeSpan.start && cs.end >= nodeSpan.end) {
      const size = cs.end - cs.start;
      // Prefer the tightest (innermost) enclosing render block.
      if (size < bestSize) {
        bestSize = size;
        bestId = candidateId;
      }
    }
  }
  return bestId;
}

/**
 * createMarkupReadNode — factory for MarkupReadDGNode (A-1.2 Option Y shape).
 *
 * Generates a unique NodeId using the same makeNodeId convention as all other
 * DG node factories. Returns both the ID and the constructed node so the
 * caller can insert into nodes and emit the associated 'reads' edge.
 *
 * Exported for unit-testing in A-1.2; called from the emission logic in A-1.3.
 *
 * @param astSpan            Span of the interpolation site in the source.
 * @param sourceRenderNodeId NodeId of the enclosing RenderDGNode, or null.
 * @param ownerScope         Lexical scope key (typically filePath).
 */
export function createMarkupReadNode(
  astSpan: Span,
  sourceRenderNodeId: NodeId | null,
  ownerScope: string,
): { nodeId: NodeId; dgNode: MarkupReadDGNode } {
  const nodeId = makeNodeId(ownerScope, astSpan, "markup-read");
  const dgNode: MarkupReadDGNode = {
    kind: "markup-read",
    nodeId,
    sourceRenderNodeId,
    ownerScope,
    hasLift: false,
    span: astSpan,
  };
  return { nodeId, dgNode };
}

// ---------------------------------------------------------------------------
// AST walking helpers
// ---------------------------------------------------------------------------

/**
 * Collect @var reference names from a node's ExprNode parallel fields.
 * Returns an array of variable names (without the @ prefix).
 */
/** Phase 4d: quick boolean check — does an ExprNode tree contain any @-prefixed ident? */
function _exprNodeHasAtIdent(exprNode: unknown): boolean {
  if (!exprNode || typeof exprNode !== "object") return false;
  let found = false;
  forEachIdentInExprNode(exprNode as ExprNode, (ident) => {
    if (!found && ident.name.startsWith("@")) found = true;
  });
  return found;
}

function collectReactiveRefsFromExprNode(node: Record<string, unknown>): string[] {
  const refs: string[] = [];
  const exprNodeFields = [
    node.exprNode, node.initExpr, node.condExpr,
    node.valueExpr, node.iterExpr, node.headerExpr,
  ];
  for (const field of exprNodeFields) {
    if (!field || typeof field !== "object" || !(field as { kind?: string }).kind) continue;
    forEachIdentInExprNode(field as ExprNode, (ident) => {
      if (ident.name.startsWith("@")) refs.push(ident.name.slice(1));
    });
    // E-DG-002 false-positive class (SB1) — `forEachIdentInExprNode` is a
    // SHARED helper that deliberately stops at LambdaExpr bodies (a new
    // lin-scope boundary; capture tracking for `checkLinear` is handled
    // separately via the closure node's `captures` array). For DG
    // "has-readers" accounting that boundary is wrong: a `@var` read inside a
    // `.map`/`.filter`/`.reduce` callback body (e.g.
    // `@items.filter(x => x > @threshold)`) IS a real consumption of `@var` —
    // the callback runs with the cell captured. Without descending into lambda
    // bodies, `@threshold` is invisible to the reader set and E-DG-002
    // false-fires on it. Widening the shared helper would change lin-capture
    // semantics, so we descend here, DG-locally, only for reader-credit.
    collectLambdaBodyReactiveRefs(field as ExprNode, refs);
  }
  return refs;
}

/**
 * Walk an ExprNode tree finding every LambdaExpr and collect the `@var`
 * reactive reads inside each lambda body — the reads that
 * `forEachIdentInExprNode` intentionally skips at the lambda scope boundary.
 *
 * Pushes bare names (without the `@`) onto `out`. Nested lambdas are handled
 * (a lambda body's `forEachIdentInExprNode` walk stops at any inner lambda, so
 * we recurse into the inner one here too). Block-body lambdas
 * (`{ kind: "block", stmts }`) walk each statement's parallel ExprNode fields
 * (the same field set `collectReactiveRefsFromExprNode` uses).
 *
 * Scope note: this descends ONLY for E-DG-002 reader-accounting. It does NOT
 * change lin tracking (which keeps the shared helper's scope boundary).
 */
function collectLambdaBodyReactiveRefs(node: ExprNode, out: string[]): void {
  if (!node || typeof node !== "object") return;

  if ((node as { kind?: string }).kind === "lambda") {
    const lambda = node as Record<string, unknown>;
    const body = lambda.body as
      | { kind: "expr"; value: ExprNode }
      | { kind: "block"; stmts: unknown[] }
      | undefined;
    if (body && body.kind === "expr" && body.value) {
      // Credit `@var` reads in the arrow's expression body, then recurse so
      // any lambda nested inside the body is also descended into.
      forEachIdentInExprNode(body.value, (ident) => {
        if (ident.name.startsWith("@")) out.push(ident.name.slice(1));
      });
      collectLambdaBodyReactiveRefs(body.value, out);
    } else if (body && body.kind === "block" && Array.isArray(body.stmts)) {
      // Block-body lambda — walk each statement's parallel ExprNode fields
      // (mirrors collectReactiveRefsFromExprNode's field set), descending into
      // any nested lambdas.
      for (const stmt of body.stmts) {
        if (!stmt || typeof stmt !== "object") continue;
        const s = stmt as Record<string, unknown>;
        for (const field of [s.exprNode, s.initExpr, s.condExpr, s.valueExpr, s.iterExpr, s.headerExpr]) {
          if (!field || typeof field !== "object" || !(field as { kind?: string }).kind) continue;
          forEachIdentInExprNode(field as ExprNode, (ident) => {
            if (ident.name.startsWith("@")) out.push(ident.name.slice(1));
          });
          collectLambdaBodyReactiveRefs(field as ExprNode, out);
        }
      }
    }
    // Lambda default-parameter values are in the OUTER scope and are already
    // covered by forEachIdentInExprNode's lambda case; no extra walk needed.
    return;
  }

  // Non-lambda node: structurally recurse into every ExprNode-shaped child so
  // we reach lambdas nested anywhere in the tree (call args, ternary arms,
  // array elements, object prop values, member objects, etc.).
  for (const key of Object.keys(node as Record<string, unknown>)) {
    const child = (node as Record<string, unknown>)[key];
    if (child && typeof child === "object" && (child as { kind?: string }).kind) {
      collectLambdaBodyReactiveRefs(child as ExprNode, out);
    } else if (Array.isArray(child)) {
      for (const item of child) {
        if (item && typeof item === "object" && (item as { kind?: string }).kind) {
          collectLambdaBodyReactiveRefs(item as ExprNode, out);
        }
      }
    }
  }
}

/**
 * Collect direct callee function names from a node's ExprNode parallel fields.
 * Finds CallExpr nodes with IdentExpr callees.
 */
function collectCalleesFromExprNode(node: Record<string, unknown>): string[] {
  const names: string[] = [];
  const exprNodeFields = [
    node.exprNode, node.initExpr, node.condExpr,
    node.valueExpr, node.iterExpr, node.headerExpr,
  ];
  for (const field of exprNodeFields) {
    if (!field || typeof field !== "object" || !(field as { kind?: string }).kind) continue;
    walkExprNodeForCalls(field as ExprNode, names);
  }
  return names;
}

/** Recursively walk an ExprNode tree to find CallExpr nodes with IdentExpr callees. */
function walkExprNodeForCalls(node: ExprNode, out: string[]): void {
  if (!node || typeof node !== "object") return;
  if (node.kind === "call") {
    const callee = (node as { callee?: ExprNode }).callee;
    if (callee && callee.kind === "ident" && (callee as { name?: string }).name) {
      out.push((callee as { name: string }).name);
    }
  }
  // Recurse into child ExprNodes
  for (const key of Object.keys(node)) {
    const child = (node as Record<string, unknown>)[key];
    if (child && typeof child === "object" && (child as { kind?: string }).kind) {
      walkExprNodeForCalls(child as ExprNode, out);
    }
    if (Array.isArray(child)) {
      for (const item of child) {
        if (item && typeof item === "object" && (item as { kind?: string }).kind) {
          walkExprNodeForCalls(item as ExprNode, out);
        }
      }
    }
  }
}

/**
 * Collect reactive var names referenced via meta.get("name") and
 * meta.bindings.name patterns inside a node's ExprNode fields.
 *
 * Runtime semantics (§22 meta):
 *   - `meta.get("theme")` is the tracking reactive getter (trackingGet in
 *     runtime-template.js) — it subscribes the surrounding meta-effect to
 *     @theme, so this IS a reactive read of @theme.
 *   - `meta.bindings.userCount` is a lexical snapshot captured at breakout.
 *     Not reactive at runtime, but it IS a read of @userCount at the call
 *     site for purposes of "has readers" accounting (E-DG-002).
 *
 * Without this helper, both patterns are invisible to the DG's @var scan
 * (no `@theme` ident appears — just strings / property names), so E-DG-002
 * false-positives on vars that are consumed through meta.
 */
function collectMetaVarRefsFromExprNode(node: Record<string, unknown>): string[] {
  const refs: string[] = [];
  const fields = [
    node.exprNode, node.initExpr, node.condExpr,
    node.valueExpr, node.iterExpr, node.headerExpr,
  ];
  for (const field of fields) {
    if (!field || typeof field !== "object" || !(field as { kind?: string }).kind) continue;
    walkExprNodeForMetaVars(field as ExprNode, refs);
  }
  return refs;
}

/** Walk an ExprNode tree for meta.get("name") and meta.bindings.name patterns. */
function walkExprNodeForMetaVars(node: ExprNode, out: string[]): void {
  if (!node || typeof node !== "object") return;

  // Pattern 1: meta.get("name") — CallExpr with callee member(ident("meta"), "get")
  if (node.kind === "call") {
    const call = node as Record<string, unknown>;
    const callee = call.callee as Record<string, unknown> | undefined;
    if (callee && callee.kind === "member") {
      const obj = callee.object as Record<string, unknown> | undefined;
      const prop = callee.property;
      if (obj && obj.kind === "ident" && (obj as { name?: string }).name === "meta" && prop === "get") {
        const args = call.args as unknown[] | undefined;
        const first = Array.isArray(args) ? args[0] : undefined;
        if (first && typeof first === "object" && (first as { kind?: string }).kind === "lit") {
          const v = (first as { value?: unknown }).value;
          if (typeof v === "string") out.push(v);
        }
      }
    }
  }

  // Pattern 2: meta.bindings.name — MemberExpr whose object is member(ident("meta"), "bindings")
  if (node.kind === "member") {
    const m = node as Record<string, unknown>;
    const inner = m.object as Record<string, unknown> | undefined;
    if (inner && inner.kind === "member") {
      const innerObj = inner.object as Record<string, unknown> | undefined;
      const innerProp = inner.property;
      if (innerObj && innerObj.kind === "ident" && (innerObj as { name?: string }).name === "meta" && innerProp === "bindings") {
        const prop = m.property;
        if (typeof prop === "string") out.push(prop);
      }
    }
  }

  // Recurse through all ExprNode children.
  for (const key of Object.keys(node)) {
    const child = (node as Record<string, unknown>)[key];
    if (child && typeof child === "object" && (child as { kind?: string }).kind) {
      walkExprNodeForMetaVars(child as ExprNode, out);
    }
    if (Array.isArray(child)) {
      for (const item of child) {
        if (item && typeof item === "object" && (item as { kind?: string }).kind) {
          walkExprNodeForMetaVars(item as ExprNode, out);
        }
      }
    }
  }
}

/**
 * String-fallback for collectMetaVarRefsFromExprNode — scans an expression
 * string for meta.get("name") and meta.bindings.name patterns. String literal
 * boundaries are NOT respected (simple regex), but this is a best-effort path
 * that only matters when ExprNode annotation is missing.
 */
function collectMetaVarRefsFromString(expr: string): string[] {
  const refs: string[] = [];
  // meta.get("name") or meta.get('name') — quoted string arg
  const getRe = /meta\s*\.\s*get\s*\(\s*(["'])([A-Za-z_$][A-Za-z0-9_$]*)\1\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = getRe.exec(expr)) !== null) refs.push(m[2]);
  // meta.bindings.name — member chain
  const bRe = /meta\s*\.\s*bindings\s*\.\s*([A-Za-z_$][A-Za-z0-9_$]*)/g;
  while ((m = bRe.exec(expr)) !== null) refs.push(m[1]);
  return refs;
}

/**
 * Extract direct callee names from an expression string.
 * Matches `identifier(` patterns.
 */
function extractCallees(expr: string): string[] {
  const names: string[] = [];
  const re = /\b([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(expr)) !== null) {
    names.push(m[1]);
  }
  return names;
}

/**
 * Recursively collect all function nodes from a file AST.
 */
function collectAllFunctions(fileAST: FileAST): FunctionDeclNode[] {
  const nodeList = fileAST.nodes;
  const result: FunctionDeclNode[] = [];

  function visit(list: ASTNode[]): void {
    for (const node of list) {
      if (node.kind === "logic") {
        if (Array.isArray(node.body)) {
          for (const child of node.body) {
            if (child.kind === "function-decl") {
              result.push(child);
              if (Array.isArray(child.body)) visitBody(child.body);
            }
          }
        }
      }
      if (node.kind === "function-decl") {
        result.push(node);
        if (Array.isArray(node.body)) visitBody(node.body);
      }
      if ("children" in node && Array.isArray((node as MarkupNode).children)) {
        visit((node as MarkupNode).children as ASTNode[]);
      }
    }
  }

  function visitBody(body: LogicStatement[]): void {
    for (const node of body) {
      if (node.kind === "function-decl") {
        result.push(node);
        if (Array.isArray(node.body)) visitBody(node.body);
      }
    }
  }

  visit(nodeList);
  return result;
}

/**
 * Collect all PLAIN state-decl nodes from a file AST.
 *
 * Phase A1a Step 11.5 — `reactive-derived-decl` folded into state-decl. To
 * avoid duplicate DG nodes when the dedicated derived collector also picks
 * up the same state-decl, this function EXCLUDES ALL derived-shape state-decl
 * nodes (shape:"derived"). Those flow through `collectAllReactiveDerivedDecls`
 * exclusively and get `_pendingDerivedReads` populated for read-edge
 * resolution (required for E-DERIVED-CIRCULAR-DEP cycle detection).
 *
 * Rx-1 (§6.6.10) — this predicate previously keyed on `structuralForm ===
 * false`, which routed the V5-strict form (`const <x> = expr`,
 * structuralForm:true) through THIS plain collector. That left its
 * `_pendingDerivedReads` unpopulated, so the derived-reads cycle detector
 * never saw its edges and E-DERIVED-CIRCULAR-DEP silently failed to fire in
 * the real pipeline (the 22/22 unit test only exercised the legacy @-form,
 * structuralForm:false). Both forms are derived cells and both emit
 * `_scrml_derived_subscribe` in codegen, so both must participate in the
 * derived subgraph. The predicate now keys on `shape === "derived"` alone.
 */
function collectAllReactiveDecls(fileAST: FileAST): ReactiveDeclNode[] {
  const nodeList = fileAST.nodes;
  const result: ReactiveDeclNode[] = [];

  function isFoldedDerived(n: ASTNode): boolean {
    if (n.kind !== "state-decl") return false;
    const sd = n as Record<string, unknown>;
    return sd.shape === "derived";
  }

  function visit(list: ASTNode[]): void {
    for (const node of list) {
      if (node.kind === "logic" && Array.isArray(node.body)) {
        for (const child of node.body) {
          if (child.kind === "state-decl" && !isFoldedDerived(child)) result.push(child);
        }
      }
      if (node.kind === "state-decl" && !isFoldedDerived(node)) result.push(node);
      if ("children" in node && Array.isArray((node as MarkupNode).children)) {
        visit((node as MarkupNode).children as ASTNode[]);
      }
    }
  }

  visit(nodeList);
  return result;
}

/**
 * Collect all derived-shape state-decl nodes from a file AST.
 * These are `const @var = expr` declarations (legacy expression-form).
 *
 * Phase A1a Step 11.5 — `reactive-derived-decl` retired and folded into
 * state-decl. Post-fold this collects `kind: "state-decl"` with
 * `shape === "derived"`. The function name is preserved for
 * blame-traceability across the rename.
 *
 * Rx-1 (§6.6.10) — this now collects BOTH derived forms: the legacy `@`-form
 * (structuralForm:false) AND Shape 3 V5-strict (`const <x> = expr`,
 * structuralForm:true). Both are derived cells that emit
 * `_scrml_derived_subscribe` in codegen, so both must feed
 * `_pendingDerivedReads` for E-DERIVED-CIRCULAR-DEP cycle detection. The
 * V5-strict form was previously excluded (routed to the plain collector),
 * which is why circular V5-strict derived cells compiled clean and shipped an
 * infinite-recompute loop to the client. Derived cells with no `@`-refs
 * (e.g. `const <PI> = 3.14`) are still collected here but produce no
 * `_pendingDerivedReads` (empty ref set) and therefore no edges — identical
 * DG shape to their prior plain-node registration.
 */
function collectAllReactiveDerivedDecls(fileAST: FileAST): ReactiveDeclNode[] {
  const nodeList = fileAST.nodes;
  const result: ReactiveDeclNode[] = [];

  function isLegacyDerivedFold(n: ASTNode): boolean {
    if (n.kind !== "state-decl") return false;
    const sd = n as Record<string, unknown>;
    return sd.shape === "derived";
  }

  function visit(list: ASTNode[]): void {
    for (const node of list) {
      if (node.kind === "logic" && Array.isArray(node.body)) {
        for (const child of node.body) {
          if (isLegacyDerivedFold(child)) result.push(child as ReactiveDeclNode);
        }
      }
      if (isLegacyDerivedFold(node)) result.push(node as ReactiveDeclNode);
      if ("children" in node && Array.isArray((node as MarkupNode).children)) {
        visit((node as MarkupNode).children as ASTNode[]);
      }
    }
  }

  visit(nodeList);
  return result;
}

/**
 * Collect all `engine-decl` AST nodes from a file AST.
 *
 * Phase A1b B16 — engine cells live as top-level markup children (per
 * `ast-builder.js` line 9150 — `engine-decl` nodes are children of markup,
 * not logic). The walker descends into markup containers but does NOT
 * descend into logic blocks (engines may not be declared inside function
 * bodies per §51.0.K Machine Cohesion).
 *
 * Returns the engine-decl AST nodes (which carry `_record` annotations
 * by SYM PASS 10.A — see `symbol-table.ts:walkRegisterEngines`). The
 * record's `engineMeta.derivedExpr` field is the trigger predicate for
 * B16's downstream walking.
 */
function collectAllEngineDecls(fileAST: FileAST): ASTNode[] {
  const nodeList = fileAST.nodes;
  const result: ASTNode[] = [];

  function visit(list: ASTNode[]): void {
    for (const node of list) {
      if (node.kind === "engine-decl") result.push(node);
      if ("children" in node && Array.isArray((node as MarkupNode).children)) {
        visit((node as MarkupNode).children as ASTNode[]);
      }
    }
  }

  visit(nodeList);
  return result;
}

/**
 * Collect all tilde-decl nodes from a file AST.
 * These are `~var = expr` declarations that may compile to derived reactives.
 */
function collectAllTildeDecls(fileAST: FileAST): ASTNode[] {
  const nodeList = fileAST.nodes;
  const result: ASTNode[] = [];

  function visit(list: ASTNode[]): void {
    for (const node of list) {
      if (node.kind === "logic" && Array.isArray(node.body)) {
        for (const child of node.body) {
          if (child.kind === "tilde-decl") result.push(child);
        }
      }
      if (node.kind === "tilde-decl") result.push(node);
      if ("children" in node && Array.isArray((node as MarkupNode).children)) {
        visit((node as MarkupNode).children as ASTNode[]);
      }
    }
  }

  visit(nodeList);
  return result;
}

/**
 * Collect all sql blocks from a file AST.
 */
function collectAllSqlBlocks(fileAST: FileAST): SQLNode[] {
  const nodeList = fileAST.nodes;
  const result: SQLNode[] = [];

  function visit(list: ASTNode[]): void {
    for (const node of list) {
      if (node.kind === "sql") result.push(node);
      if (node.kind === "logic" && Array.isArray(node.body)) {
        for (const child of node.body) {
          if (child.kind === "sql") result.push(child);
        }
      }
      if ("children" in node && Array.isArray((node as MarkupNode).children)) {
        visit((node as MarkupNode).children as ASTNode[]);
      }
    }
  }

  visit(nodeList);
  return result;
}

/**
 * §52.4.4 (E-AUTH-001 companion) — the base names of `@`-sigil reactive reads
 * appearing inside the `${...}` interpolations of a `?{}` SQL query. String
 * literals inside an interpolation are stripped first so an `@` inside a quoted
 * value (e.g. an email address) is not mistaken for a reactive read.
 * `@obj.field` / `@arr[i]` yield the base name `obj` / `arr`. A balanced-brace
 * scan handles nested braces inside an interpolation body. Mirrors the
 * type-system.ts `sqlInterpolationSigilReads` used by the E-AUTH-001 check so
 * the DG "consumed" credit and the guard agree on what a bound-param read is.
 */
function sqlQueryInterpolationSigilReads(query: string): string[] {
  const out: string[] = [];
  const n = query.length;
  let i = 0;
  while (i < n) {
    if (query.charCodeAt(i) === 36 /* $ */ && i + 1 < n && query.charCodeAt(i + 1) === 123 /* { */) {
      let depth = 1;
      let j = i + 2;
      while (j < n && depth > 0) {
        const ch = query.charCodeAt(j);
        if (ch === 123 /* { */) depth++;
        else if (ch === 125 /* } */) { depth--; if (depth === 0) break; }
        j++;
      }
      const body = query.slice(i + 2, j)
        .replace(/"(?:[^"\\]|\\.)*"/g, " ")
        .replace(/'(?:[^'\\]|\\.)*'/g, " ")
        .replace(/`(?:[^`\\]|\\.)*`/g, " ");
      const m = body.match(/@([A-Za-z_$][A-Za-z0-9_$]*)/g);
      if (m) for (const r of m) out.push(r.slice(1));
      i = j + 1;
    } else {
      i++;
    }
  }
  return out;
}

/**
 * Collect all meta blocks from a file AST.
 */
function collectAllMetaBlocks(fileAST: FileAST): MetaNode[] {
  const nodeList = fileAST.nodes;
  const result: MetaNode[] = [];

  function visit(list: ASTNode[]): void {
    for (const node of list) {
      if (isMetaKind(node.kind)) result.push(node);
      if ("children" in node && Array.isArray((node as MarkupNode).children)) {
        visit((node as MarkupNode).children as ASTNode[]);
      }
    }
  }

  visit(nodeList);
  return result;
}

/**
 * Collect all markup nodes from a file AST.
 */
function collectAllMarkupNodes(fileAST: FileAST): MarkupNode[] {
  const nodeList = fileAST.nodes;
  const result: MarkupNode[] = [];

  function visit(list: ASTNode[]): void {
    for (const node of list) {
      if (node.kind === "markup") result.push(node);
      if ("children" in node && Array.isArray((node as MarkupNode).children)) {
        visit((node as MarkupNode).children as ASTNode[]);
      }
    }
  }

  visit(nodeList);
  return result;
}

/**
 * Collect all import-decl nodes from a file AST.
 */
function collectAllImports(fileAST: FileAST): ImportDeclNode[] {
  const nodeList = fileAST.nodes;
  const result: ImportDeclNode[] = [];

  function visit(list: ASTNode[]): void {
    for (const node of list) {
      if (node.kind === "import-decl") result.push(node);
      if (node.kind === "logic") {
        if (Array.isArray(node.imports)) result.push(...node.imports);
      }
      if ("children" in node && Array.isArray((node as MarkupNode).children)) {
        visit((node as MarkupNode).children as ASTNode[]);
      }
    }
  }

  visit(nodeList);
  return result;
}

/**
 * Collect all anonymous logic blocks from a file AST.
 * An anonymous logic block is a `${ }` block in the AST (kind=logic).
 */
function collectAnonymousLogicBlocks(fileAST: FileAST): LogicNode[] {
  const nodeList = fileAST.nodes;
  const result: LogicNode[] = [];

  function visit(list: ASTNode[]): void {
    for (const node of list) {
      if (node.kind === "logic") {
        result.push(node);
      }
      if ("children" in node && Array.isArray((node as MarkupNode).children)) {
        visit((node as MarkupNode).children as ASTNode[]);
      }
    }
  }

  visit(nodeList);
  return result;
}

// ---------------------------------------------------------------------------
// hasLift detection
//
// For a DGNode N in a logic block body: scan the statements that follow N's
// corresponding AST position for lift-expr nodes at the direct body level.
// If any such lift-expr exists before the next server-call statement or end
// of block, hasLift is true.
// ---------------------------------------------------------------------------

/**
 * Determine if a body node at a given index has a lift-expr following it
 * (before the next server call or end of block).
 */
function hasLiftAfter(
  body: LogicStatement[],
  nodeIndex: number,
  serverFunctionNames: Set<string>,
): boolean {
  for (let i = nodeIndex + 1; i < body.length; i++) {
    const stmt = body[i];

    // Found a lift-expr at direct body level => hasLift is true
    if (stmt.kind === "lift-expr") return true;

    // A server call statement (bare-expr calling a server function) ends the scan
    if (stmt.kind === "bare-expr") {
      const callees = collectCalleesFromExprNode(stmt as Record<string, unknown>);
      const _exprStr = (stmt as any).exprNode ? emitStringFromTree((stmt as any).exprNode as import("./types/ast.ts").ExprNode) : (stmt.expr ?? null);
      const finalCallees = callees.length > 0 ? callees : (_exprStr ? extractCallees(_exprStr) : []);
      if (finalCallees.some(c => serverFunctionNames.has(c))) return false;
    }

    // A function-decl or sql block also acts as a server-call boundary
    if (stmt.kind === "sql") return false;

    // Another operation node (function-decl, state-decl) stops the scan.
    // Phase A1a Step 11.5 — `reactive-derived-decl` folded into state-decl.
    if (stmt.kind === "function-decl" || stmt.kind === "state-decl") {
      return false;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Reachability check for 'awaits' edges
// ---------------------------------------------------------------------------

/**
 * Build an adjacency map from 'awaits' edges.
 */
function buildAwaitsAdj(edges: DGEdge[]): Map<NodeId, Set<NodeId>> {
  const adj = new Map<NodeId, Set<NodeId>>();
  for (const edge of edges) {
    if (edge.kind !== "awaits") continue;
    if (!adj.has(edge.from)) adj.set(edge.from, new Set());
    adj.get(edge.from)!.add(edge.to);
  }
  return adj;
}

/**
 * Build an adjacency map of `reads` edges restricted to reactive→reactive
 * connections (the derived-cell dependency subgraph).
 *
 * Phase A1b B7 — used by E-DERIVED-CIRCULAR-DEP cycle detection (§6.6.10,
 * §31.5). A `derived → upstream` edge in this subgraph means: when `upstream`
 * changes, `derived` recomputes. A cycle here is a circular derived
 * dependency that blocks code generation.
 *
 * Self-edges are NOT in the live `edges` array (suppressed at line ~1120 to
 * avoid polluting the read-edge list); self-references are tracked separately
 * via `selfReferencingDerivedNodes` and reported alongside cycle results.
 */
function buildDerivedReadsAdj(
  edges: DGEdge[],
  nodes: Map<NodeId, DGNode>,
): Map<NodeId, Set<NodeId>> {
  const adj = new Map<NodeId, Set<NodeId>>();
  for (const edge of edges) {
    if (edge.kind !== "reads") continue;
    const fromNode = nodes.get(edge.from);
    const toNode = nodes.get(edge.to);
    if (!fromNode || !toNode) continue;
    if (fromNode.kind !== "reactive" || toNode.kind !== "reactive") continue;
    if (!adj.has(edge.from)) adj.set(edge.from, new Set());
    adj.get(edge.from)!.add(edge.to);
  }
  return adj;
}

/**
 * Build an adjacency map of `validator-reads` edges (B10 Phase 3).
 *
 * A `validator-reads` edge from cell A to cell B means: cell A's validators
 * reference cell B via cross-field predicate args (e.g., `<a eq(@b)>`). A
 * cycle in this subgraph violates SPEC §55.11 and fires
 * `E-VALIDATOR-CIRCULAR-DEP` per §34.
 *
 * Sibling of `buildDerivedReadsAdj`. Same DFS (`detectCycle`) consumes the
 * adjacency. Self-edges are NOT pushed into `edges` (mirrors the derived-
 * reads handling — `<a eq(@a)>` is tracked separately via the cycle check
 * if needed; today the walker emits the self-edge into the adjacency so
 * `detectCycle`'s degenerate-1-cycle behavior fires uniformly).
 */
function buildValidatorArgsAdj(
  edges: DGEdge[],
  nodes: Map<NodeId, DGNode>,
): Map<NodeId, Set<NodeId>> {
  const adj = new Map<NodeId, Set<NodeId>>();
  for (const edge of edges) {
    if (edge.kind !== "validator-reads") continue;
    const fromNode = nodes.get(edge.from);
    const toNode = nodes.get(edge.to);
    if (!fromNode || !toNode) continue;
    if (fromNode.kind !== "reactive" || toNode.kind !== "reactive") continue;
    if (!adj.has(edge.from)) adj.set(edge.from, new Set());
    adj.get(edge.from)!.add(edge.to);
  }
  return adj;
}

/**
 * Build an adjacency map of `engine-derived-reads` edges (B16).
 *
 * An `engine-derived-reads` edge from engine cell A to cell B means: engine
 * cell A's `derived=expr` references cell B (a reactive cell or another
 * engine cell). A cycle in this subgraph violates §51.0.J line 20411
 * "Chained derivation (A → B → C) | LEGAL. Cycle detection at compile time
 * → `E-DERIVED-ENGINE-CIRCULAR` (§34)" and fires the corresponding error
 * code.
 *
 * Sibling of `buildDerivedReadsAdj` (B7) and `buildValidatorArgsAdj` (B10).
 * Same DFS (`detectCycle`) consumes the adjacency. B16 is the SECOND
 * consumer of B7's reusability promise per primer §13.7 B7 specifics
 * ("B16 ... will reuse the same DFS with their own filtered adjacency").
 *
 * Self-edges are NOT pushed into `edges` (would pollute the read-edge
 * list and cause spurious behavior). The walker tracks self-references
 * separately for B16's degenerate 1-cycle case (mirrors B7 + B10
 * patterns).
 */
function buildEngineDerivedAdj(
  edges: DGEdge[],
  nodes: Map<NodeId, DGNode>,
): Map<NodeId, Set<NodeId>> {
  const adj = new Map<NodeId, Set<NodeId>>();
  for (const edge of edges) {
    if (edge.kind !== "engine-derived-reads") continue;
    const fromNode = nodes.get(edge.from);
    const toNode = nodes.get(edge.to);
    if (!fromNode || !toNode) continue;
    if (fromNode.kind !== "reactive" || toNode.kind !== "reactive") continue;
    if (!adj.has(edge.from)) adj.set(edge.from, new Set());
    adj.get(edge.from)!.add(edge.to);
  }
  return adj;
}

/**
 * Check if `from` can reach `to` via 'awaits' edges.
 */
function isReachable(from: NodeId, to: NodeId, adj: Map<NodeId, Set<NodeId>>): boolean {
  if (from === to) return true;
  const visited = new Set<NodeId>();
  const stack: NodeId[] = [from];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (cur === to) return true;
    if (visited.has(cur)) continue;
    visited.add(cur);
    const neighbors = adj.get(cur);
    if (neighbors) {
      for (const n of neighbors) stack.push(n);
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Generic cycle detection (DFS-based, iterative with coloring)
//
// Used by:
//   - 'awaits' edge cycle detection (E-DG-001)
//   - derived-cell 'reads' subgraph cycle detection (E-DERIVED-CIRCULAR-DEP, B7)
//   - validator-args subgraph cycle detection (E-VALIDATOR-CIRCULAR-DEP, B10)
//   - engine-derived subgraph cycle detection (E-DERIVED-ENGINE-CIRCULAR, B16)
//
// A1b B7: generalized from `detectAwaitsCycle` to support derived-cell cycle
// detection. Same algorithm; the caller supplies the adjacency map (filtered
// from a chosen edge subset) and the node set.
//
// B10 was the FIRST consumer of B7's reusability promise (validator-arg deps,
// §31.4). B16 is the SECOND consumer (engine-derived deps, §51.0.J line
// 20411). The pattern is: each consumer supplies a `buildXAdj` filter
// alongside its edge-kind enum addition; `detectCycle` is unchanged.
// ---------------------------------------------------------------------------

type DFSColor = 0 | 1 | 2; // WHITE | GRAY | BLACK
const WHITE: DFSColor = 0;
const GRAY: DFSColor = 1;
const BLACK: DFSColor = 2;

interface DFSFrame {
  nodeId: NodeId;
  iter: IterableIterator<NodeId> | null;
}

/**
 * Detect cycles in a directed graph using iterative DFS with coloring.
 * Returns the first cycle found as an array of nodeIds, or null.
 *
 * Generic over edge kind — the adjacency map is supplied pre-filtered by
 * the caller. See `buildAwaitsAdj` and `buildDerivedReadsAdj`.
 */
function detectCycle(
  adj: Map<NodeId, Set<NodeId>>,
  allNodes: Set<NodeId>,
): NodeId[] | null {
  const color = new Map<NodeId, DFSColor>();

  for (const nodeId of allNodes) {
    color.set(nodeId, WHITE);
  }

  for (const startNode of allNodes) {
    if (color.get(startNode) !== WHITE) continue;

    const stack: DFSFrame[] = [{ nodeId: startNode, iter: null }];
    color.set(startNode, GRAY);

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (!frame.iter) {
        const neighbors = adj.get(frame.nodeId);
        frame.iter = neighbors
          ? neighbors.values()
          : ([][Symbol.iterator]() as IterableIterator<NodeId>);
      }

      const next = frame.iter.next();
      if (next.done) {
        color.set(frame.nodeId, BLACK);
        stack.pop();
        continue;
      }

      const neighbor = next.value;
      const nc = color.get(neighbor);
      if (nc === GRAY) {
        // Found a cycle -- collect it
        const cycle: NodeId[] = [neighbor];
        for (let i = stack.length - 1; i >= 0; i--) {
          cycle.push(stack[i].nodeId);
          if (stack[i].nodeId === neighbor) break;
        }
        return cycle;
      }
      if (nc === WHITE) {
        color.set(neighbor, GRAY);
        stack.push({ nodeId: neighbor, iter: null });
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Run the Dependency Graph Builder (DG, Stage 7).
 */
export function runDG(input: DGInput): DGOutput {
  const { files, routeMap } = input;
  const debugPerf = input.debugPerf === true;
  const log = input.log ?? console.log;

  _nodeCounter = 0;

  // ------------------------------------------------------------------
  // PGO P1.3 (S102) — sub-stage timing instrumentation
  //
  // Gated on `debugPerf === true`. When unset, ALL timing code is skipped
  // (the `_t` / `_perFileEnd` helpers are no-ops). When set, we accumulate
  // per-file iteration time by file-index across all five `for (const rawFile
  // of files)` loops in this function, and cross-file resolution time as a
  // separate scalar. At end of runDG we emit:
  //   [DG-PER-FILE] <total>ms across <F> files (avg <M>ms/file, Q1=... Q4=...)
  //   [DG-CROSS-FILE] <N>ms
  //
  // Cost model: Hypothesis (a) — per-file work grows AS the corpus is
  // processed — manifests as Q4 >> Q1. Hypothesis (b) — cross-file repeated
  // lookups against a growing structure — manifests as Q1 ≈ Q4 with the
  // cross-file scalar carrying the slope. S94 observed 8.5× growth in
  // marginal DG cost (0.064 → 0.546 ms/file across 28→108 sweep); P1.3's
  // job is to attribute that slope to (a) or (b).
  //
  // The five per-file loops in runDG (file-index keys this measurement):
  //   1. Phase 1 graph construction (line ~1140 of original) — function /
  //      reactive / engine / tilde / markup / import / SQL / meta node
  //      collection + within-file edge prep.
  //   2. Reactive-var function-body @var scan (line ~1545) — emits reads /
  //      writes / invalidates edges within fn bodies.
  //   3. Direct-reads + call-graph build (line ~1689) — pre-fixpoint per-fn
  //      bookkeeping.
  //   4. Markup AST sweep (line ~1871) — the large per-file pass that emits
  //      markup-read nodes + creditReader sentinel edges.
  //   5. Validator-arg edge emission (line ~2453) — emitValidatorArgEdgesForFile.
  //
  // Cross-file blocks (all interleaved between the per-file loops):
  //   - Resolve pending callees → edges (functionNameToNodeId lookup)
  //   - Reactive-var nodeId map build + derived/engine read-edge resolution
  //   - Transitive read fixpoint
  //   - Derived-cell transitive reads via call edges
  //   - E-DG-002 sweep
  //   - All cycle detection (validator, derived, engine, awaits)
  //   - Lift concurrent detection
  // ------------------------------------------------------------------
  const perFileMs: number[] = debugPerf ? new Array(files.length).fill(0) : [];
  let crossFileMs = 0;
  let _perFileStart = 0;
  let _crossFileStart = 0;
  const _tPerFileStart = (): void => {
    if (debugPerf) _perFileStart = performance.now();
  };
  const _tPerFileEnd = (fileIdx: number): void => {
    if (debugPerf) perFileMs[fileIdx] += performance.now() - _perFileStart;
  };
  const _tCrossStart = (): void => {
    if (debugPerf) _crossFileStart = performance.now();
  };
  const _tCrossEnd = (): void => {
    if (debugPerf) crossFileMs += performance.now() - _crossFileStart;
  };

  /**
   * Finalize timing + emit the two PGO P1.3 sub-stage lines, then return the
   * DG result. Called from every `return` path inside runDG so per-file +
   * cross-file totals are always reported when `debugPerf` is enabled, even
   * on fail-fast cycle-detection exits. The `_crossOpen` parameter signals
   * whether a cross-file timing block is currently open and needs closing
   * (most early-return sites are inside the cycle-detection cross-file
   * window, so default = true).
   */
  const _finalizeDG = (_crossOpen: boolean = true): DGOutput => {
    if (debugPerf) {
      if (_crossOpen) _tCrossEnd();
      const F = perFileMs.length;
      let total = 0;
      for (const ms of perFileMs) total += ms;
      const avg = F > 0 ? total / F : 0;
      // Quartile bins: split file-index range into 4 even slices.
      // Q1 = first 25% of files, Q4 = last 25%. Each Qn reports the AVERAGE
      // per-file time within its bin so growth pattern is readable
      // independently of file-count.
      const quartileAvgs: number[] = [0, 0, 0, 0];
      if (F > 0) {
        const bin = (i: number): number => {
          // Map file-index i ∈ [0, F) → quartile ∈ [0, 4). Floor-divide.
          const q = Math.floor((i * 4) / F);
          return q > 3 ? 3 : q;
        };
        const bucketSums: number[] = [0, 0, 0, 0];
        const bucketCounts: number[] = [0, 0, 0, 0];
        for (let i = 0; i < F; i++) {
          const q = bin(i);
          bucketSums[q] += perFileMs[i];
          bucketCounts[q]++;
        }
        for (let q = 0; q < 4; q++) {
          quartileAvgs[q] = bucketCounts[q] > 0 ? bucketSums[q] / bucketCounts[q] : 0;
        }
      }
      const fmt = (n: number): string => n.toFixed(2);
      log(
        `  [DG-PER-FILE] ${fmt(total)}ms across ${F} files (avg ${fmt(avg)}ms/file, ` +
          `Q1=${fmt(quartileAvgs[0])}ms Q2=${fmt(quartileAvgs[1])}ms ` +
          `Q3=${fmt(quartileAvgs[2])}ms Q4=${fmt(quartileAvgs[3])}ms)`,
      );
      log(`  [DG-CROSS-FILE] ${fmt(crossFileMs)}ms`);

      // PGO P2.2 — emit per-call-site breakdown for the markup AST sweep
      // (per-file loop #4). The `total` value here is the [DG-PER-FILE]
      // aggregate computed above (sum of all five per-file loops); the
      // markup sweep `sweepNodeForAtRefs` total represents loop #4's
      // contribution. % is reported against the sweep gross
      // (sweepNodeForAtRefs.total) — NOT against [DG-PER-FILE] — so each
      // call-site percentage is meaningful relative to the sweep itself.
      // Sorted descending by total ms. Per-quartile cumulative ms within
      // each call-site bin enables Q1→Q4 growth-slope reading.
      if (markupSweepStats) {
        const sweepTotal = markupSweepStats.sweepNodeForAtRefs.total;
        const entries = Object.entries(markupSweepStats).sort(
          (a, b) => b[1].total - a[1].total,
        );
        for (const [siteName, stat] of entries) {
          const pct = sweepTotal > 0 ? (stat.total / sweepTotal) * 100 : 0;
          log(
            `  [DG-MARKUP-SWEEP] ${siteName}: ${fmt(stat.total)}ms (${pct.toFixed(1)}% of sweep) ` +
              `Q1=${fmt(stat.q[0])}ms Q2=${fmt(stat.q[1])}ms ` +
              `Q3=${fmt(stat.q[2])}ms Q4=${fmt(stat.q[3])}ms`,
          );
        }
        // P3.C diagnostic — non-zero only if the stack-empty fallback to the
        // legacy linear scan produced a non-null result. Healthy walker = 0.
        if (renderOwnerStackFallbackFires_total > 0) {
          log(
            `  [DG-OWNER-STACK-FALLBACK] ${renderOwnerStackFallbackFires_total} ` +
              `markup-read emit(s) fell back to findOwningRenderDGNode ` +
              `(stack empty); possible missed boundary push.`,
          );
        }
      }
    }
    return { depGraph: { nodes, edges }, errors };
  };

  // P1.3 — pre-loop setup (node maps, RouteMap iteration, pushEdge closure
  // allocation) counts as cross-file work — it operates on accumulated input,
  // not per-file. Captures the small startup overhead so per-file +
  // cross-file ≈ DG aggregate.
  _tCrossStart();

  const nodes = new Map<NodeId, DGNode>();
  const edges: DGEdge[] = [];
  const errors: DGError[] = [];

  // S99 perf — Edge-existence index for O(1) dedup lookups inside fixpoint and
  // per-reactive-node loops. Maintained in lockstep with `edges` via `pushEdge`.
  // Replaces the prior O(E) `edges.some(...)` scans at the fixpoint sites that
  // S94 perf-characterization identified as the source of DG's super-linear scaling
  // (8.5× growth in marginal per-file cost across the 28→108-file sweep).
  const edgeKeySet = new Set<string>();
  const edgeKey = (from: NodeId, to: NodeId, kind: string): string =>
    `${from}|${to}|${kind}`;
  // Helper: push an edge AND register its key. Use everywhere `edges.push` was
  // previously called so the index never drifts. Returns true if the edge was
  // newly added, false if it already existed (caller may use this to skip
  // companion side-effects, e.g. `reactiveVarReaders` registration).
  const pushEdge = (from: NodeId, to: NodeId, kind: DGEdgeKind): boolean => {
    const k = edgeKey(from, to, kind);
    if (edgeKeySet.has(k)) return false;
    edgeKeySet.add(k);
    edges.push({ from, to, kind });
    return true;
  };

  // Build a set of server-boundary function names from RouteMap
  const serverFunctionNames = new Set<string>();
  const functionBoundaryById = new Map<string, Boundary>();
  if (routeMap && routeMap.functions) {
    for (const [fnNodeId, route] of routeMap.functions) {
      functionBoundaryById.set(fnNodeId, route.boundary);
    }
  }

  // Build a global function name -> DGNode ID mapping (populated during node creation)
  const functionNameToNodeId = new Map<string, NodeId>();
  // S99 perf — reverse index (nodeId → fnName) maintained in lockstep with
  // `functionNameToNodeId.set(...)`. Replaces the O(F) iterate-by-value lookup
  // inside the derived-cell transitive-reads loop.
  const nodeIdToFunctionName = new Map<NodeId, string>();
  // Build function name -> boundary mapping from RouteMap
  const functionNameToBoundary = new Map<string, Boundary>();

  // P3.C (S102) — AST-walk-derived owner stack for findOwningRenderDGNode.
  //
  // Markup AST node identity → RenderDGNode NodeId. Populated in loop #1 at the
  // render node creation site (one entry per markup AST node that becomes a
  // RenderDGNode). Consumed by loop #4 (markup sweep) which pushes the NodeId
  // onto an in-flight owner stack as the recursion descends into a markup
  // node's children, and pops on the way out. Lookups at emit time read the
  // stack top instead of scanning all dgNodes — eliminates the O(n)-per-call
  // linear scan that P2.2 measured at 42-53% of [DG-MARKUP-SWEEP] on trucking.
  //
  // Identity-keyed (Map<ASTNode, NodeId>) because makeNodeId embeds a monotonic
  // counter and cannot be recomputed from (filePath, span) post-hoc; and because
  // the sweep walks the same AST node references collected by
  // collectAllMarkupNodes (no copying / cloning between the two passes).
  const markupAstToRenderId = new Map<ASTNode, NodeId>();
  // §52.4.4 (E-AUTH-001 companion) — sql AST node identity → its registered
  // sql-query DGNode NodeId. Populated in loop #1 at the sql node creation site;
  // consumed in loop #2 to credit `${@var}` bound-param reads as consumers for
  // E-DG-002. Identity-keyed for the same reason as `markupAstToRenderId`
  // (makeNodeId embeds a monotonic counter, non-recomputable from filePath/span).
  const sqlAstToNodeId = new Map<ASTNode, NodeId>();
  // Cross-file aggregate — counts the number of times the stack-empty fallback
  // to findOwningRenderDGNode produced a non-null result, which would indicate
  // a missed boundary push in the walker. Reported via [DG-OWNER-STACK-FALLBACK]
  // alongside the [DG-MARKUP-SWEEP] surfaces when --debug-perf is set AND the
  // counter is non-zero.
  let renderOwnerStackFallbackFires_total = 0;

  // ------------------------------------------------------------------
  // Phase 1: Graph construction
  // ------------------------------------------------------------------

  // Track which logic blocks contain which DGNode IDs (for Phase 2 lift checker)
  // Map<logicBlockId, Array<{ nodeId: string, bodyIndex: number }>>
  const logicBlockNodes = new Map<string, Array<{ nodeId: NodeId; bodyIndex: number }>>();

  // P1.3 — close cross-file startup block before entering per-file loop #1.
  _tCrossEnd();

  // P1.3 — per-file loop #1: Phase 1 graph construction
  for (let _fileIdx = 0; _fileIdx < files.length; _fileIdx++) {
    const rawFile = files[_fileIdx];
    _tPerFileStart();
    const fileAST = resolveFileAST(rawFile);
    if (!fileAST) { _tPerFileEnd(_fileIdx); continue; }

    const filePath = fileAST.filePath;

    // Collect all function nodes and build DGNodes for them
    const fnNodes = collectAllFunctions(fileAST);

    for (const fnNode of fnNodes) {
      const fnNodeId = `${filePath}::${fnNode.span.start}`;
      const boundary: Boundary = functionBoundaryById.get(fnNodeId) ?? "client";
      const nodeId = makeNodeId(filePath, fnNode.span, "fn");

      const dgNode: FunctionDGNode = {
        kind: "function",
        nodeId,
        boundary,
        hasLift: false,
        span: fnNode.span,
      };

      nodes.set(nodeId, dgNode);
      if (fnNode.name) {
        functionNameToNodeId.set(fnNode.name, nodeId);
        nodeIdToFunctionName.set(nodeId, fnNode.name);
        functionNameToBoundary.set(fnNode.name, boundary);
        if (boundary === "server") {
          serverFunctionNames.add(fnNode.name);
        }
      }

      // Build edges for function calls within the body
      if (Array.isArray(fnNode.body)) {
        for (const bodyNode of fnNode.body) {
          if (bodyNode.kind === "bare-expr") {
            const exprCallees = collectCalleesFromExprNode(bodyNode as Record<string, unknown>);
            const _bExprStr = (bodyNode as any).exprNode ? emitStringFromTree((bodyNode as any).exprNode as import("./types/ast.ts").ExprNode) : (bodyNode.expr ?? null);
            const callees = exprCallees.length > 0 ? exprCallees : (_bExprStr ? extractCallees(_bExprStr) : []);
            for (const calleeName of callees) {
              if (!dgNode._pendingCallees) dgNode._pendingCallees = [];
              dgNode._pendingCallees.push(calleeName);
            }
          }
        }
      }
    }

    // Collect state-decl nodes
    const reactiveDecls = collectAllReactiveDecls(fileAST);
    for (const rNode of reactiveDecls) {
      const nodeId = makeNodeId(filePath, rNode.span, "reactive");
      const dgNode: ReactiveDGNode = {
        kind: "reactive",
        nodeId,
        varName: rNode.name ?? "",
        hasLift: false,
        span: rNode.span,
      };
      nodes.set(nodeId, dgNode);
    }

    // Collect derived-shape state-decl nodes (post-Step-11.5 representation
    // of legacy `const @var = expr`). Also collect tilde-decl nodes whose
    // init references @vars — these compile to _scrml_derived_declare and
    // are semantically equivalent to a derived state-decl.
    const derivedDecls = collectAllReactiveDerivedDecls(fileAST);
    const tildeDecls = collectAllTildeDecls(fileAST);
    for (const td of tildeDecls) {
      // Phase 4d: ExprNode-first — check initExpr for @-prefixed idents, string fallback
      const hasReactiveRef = (td as any).initExpr
        ? _exprNodeHasAtIdent((td as any).initExpr)
        : /@/.test(td.init ?? "");
      if (hasReactiveRef) {
        derivedDecls.push(td as unknown as ReactiveDeclNode);
      }
    }
    for (const dNode of derivedDecls) {
      const nodeId = makeNodeId(filePath, dNode.span, "reactive");
      const dgNode: ReactiveDGNode = {
        kind: "reactive",
        nodeId,
        varName: dNode.name ?? "",
        hasLift: false,
        span: dNode.span,
      };
      nodes.set(nodeId, dgNode);

      // Scan init expression for @var references and function calls.
      // Prefer ExprNode walk; fall back to string regex.
      const exprRefs = collectReactiveRefsFromExprNode(dNode as Record<string, unknown>);
      const exprCallees = collectCalleesFromExprNode(dNode as Record<string, unknown>);
      if (exprRefs.length > 0) {
        (dgNode as any)._pendingDerivedReads = exprRefs;
      } else {
        const _initStr = (dNode as any).initExpr
          ? emitStringFromTree((dNode as any).initExpr as import("./types/ast.ts").ExprNode)
          : (dNode.init ?? null);
        if (_initStr) {
          const atRefs = _initStr.match(/@([A-Za-z_$][A-Za-z0-9_$]*)/g);
          if (atRefs) {
            (dgNode as any)._pendingDerivedReads = atRefs.map((r: string) => r.slice(1));
          }
        }
      }
      if (exprCallees.length > 0) {
        (dgNode as any)._pendingDerivedCallees = exprCallees;
      } else {
        const _initStr2 = (dNode as any).initExpr
          ? emitStringFromTree((dNode as any).initExpr as import("./types/ast.ts").ExprNode)
          : (dNode.init ?? null);
        if (_initStr2) {
          const callees = extractCallees(_initStr2);
          if (callees.length > 0) {
            (dgNode as any)._pendingDerivedCallees = callees;
          }
        }
      }
    }

    // ------------------------------------------------------------------
    // Phase A1b B16 — Engine cells as DG nodes + engine-derived edges
    //
    // Per primer §13.7 B14: every engine-decl carries a `_record`
    // annotation populated by SYM PASS 10.A (`walkRegisterEngines`). The
    // record's `engineMeta.varName` is the auto-declared variable name
    // (§51.0.C); `engineMeta.derivedExpr` is non-null iff the engine is
    // derived (§51.0.J).
    //
    // B16 registers EVERY engine cell as a `reactive` DG node (so other
    // cells can `reads` it and engine-vs-engine cycle detection works).
    // For each derived engine, B16 records the upstream cell read(s) for
    // `engine-derived-reads` edge emission in the post-collection phase
    // (after `reactiveVarNodeIds` is built).
    //
    // Note: B14's `derivedExpr` today carries the LEGACY single-source
    // form (`{ kind: "legacy-source-var", varName: <upstream> }`) when
    // `derived=@varname` is parsed (ast-builder.js line 8449). The §51.0.J
    // rich `derived=match @x { ... }` form is NOT yet structurally
    // parsed; when ast-builder learns it, B16's collector reads the parsed
    // expression and uses `forEachIdentInExprNode` to enumerate ALL
    // upstream cell reads. The cycle-detection mechanism is invariant.
    // ------------------------------------------------------------------
    const engineDecls = collectAllEngineDecls(fileAST);
    for (const eDecl of engineDecls) {
      const eAny = eDecl as any;
      const record = eAny._record;
      if (!record || !record.engineMeta) continue; // pre-SYM AST or non-engine
      const varName: string = record.engineMeta.varName ?? "";
      if (!varName) continue;
      const nodeId = makeNodeId(filePath, eDecl.span ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 }, "engine");
      const dgNode: ReactiveDGNode = {
        kind: "reactive",
        nodeId,
        varName,
        hasLift: false,
        span: eDecl.span ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 },
      };
      nodes.set(nodeId, dgNode);

      // Record pending engine-derived reads. For the legacy single-source
      // shape, the only upstream is `derivedExpr.varName`. Stored on the
      // DG node as `_pendingEngineDerivedReads: string[]` so the
      // post-`reactiveVarNodeIds` resolution loop can emit edges.
      const derivedExpr = record.engineMeta.derivedExpr;
      if (derivedExpr && typeof derivedExpr === "object") {
        const derivedKind = (derivedExpr as Record<string, unknown>).kind;
        if (derivedKind === "legacy-source-var") {
          const upstream = (derivedExpr as Record<string, unknown>).varName;
          if (typeof upstream === "string" && upstream.length > 0) {
            (dgNode as any)._pendingEngineDerivedReads = [upstream];
          }
        }
        // S83 B3 — Move-14 inline-expression `match @VAR { ... }` form. Single
        // upstream (the match subject) suffices for cycle detection. Multi-
        // upstream inline forms (e.g. `derived=if @a then @b else @c`) are
        // future work.
        if (derivedKind === "inline-match") {
          const upstream = (derivedExpr as Record<string, unknown>).upstream;
          if (typeof upstream === "string" && upstream.length > 0) {
            (dgNode as any)._pendingEngineDerivedReads = [upstream];
          }
        }
        // §51.0.J modern EXPRESSION form (S190) — ternary / call / conditional.
        // SYM already enumerated every `@cell` the expression reads onto
        // `upstreams`; draw a dep edge per upstream so a change in ANY of them
        // recomputes the variant AND so cycle detection sees the full edge set
        // (a multi-cell derived expr that transitively depends on its own
        // engine variant fires E-DERIVED-ENGINE-CIRCULAR).
        if (derivedKind === "expr") {
          const ups = (derivedExpr as Record<string, unknown>).upstreams;
          if (Array.isArray(ups)) {
            const reads = (ups as unknown[]).filter(
              (u): u is string => typeof u === "string" && u.length > 0,
            );
            if (reads.length > 0) (dgNode as any)._pendingEngineDerivedReads = reads;
          }
        }
      }
    }

    // Collect SQL blocks
    const sqlBlocks = collectAllSqlBlocks(fileAST);
    for (const sqlNode of sqlBlocks) {
      const nodeId = makeNodeId(filePath, sqlNode.span, "sql");
      const dgNode: SqlQueryDGNode = {
        kind: "sql-query",
        nodeId,
        query: sqlNode.query ?? "",
        hasLift: false,
        span: sqlNode.span,
      };
      nodes.set(nodeId, dgNode);
      sqlAstToNodeId.set(sqlNode as ASTNode, nodeId);
    }

    // Collect meta blocks
    const metaBlocks = collectAllMetaBlocks(fileAST);
    for (const metaNode of metaBlocks) {
      const deterministic =
        metaNode.deterministic !== undefined ? metaNode.deterministic : false;
      const nodeId = makeNodeId(filePath, metaNode.span, "meta");
      const dgNode: MetaDGNode = {
        kind: "meta",
        nodeId,
        deterministic,
        hasLift: false,
        span: metaNode.span,
      };
      nodes.set(nodeId, dgNode);
    }

    // Collect markup nodes (render nodes)
    const markupNodes = collectAllMarkupNodes(fileAST);
    for (const mkNode of markupNodes) {
      const nodeId = makeNodeId(filePath, mkNode.span, "render");
      const dgNode: RenderDGNode = {
        kind: "render",
        nodeId,
        markupNodeId: mkNode.id ? String(mkNode.id) : nodeId,
        hasLift: false,
        span: mkNode.span,
      };
      nodes.set(nodeId, dgNode);
      // P3.C — register AST identity → render NodeId so the markup-sweep
      // walker (loop #4) can resolve the enclosing render node by stack-push
      // on AST descent instead of an O(n) span scan over `nodes`.
      markupAstToRenderId.set(mkNode as ASTNode, nodeId);
    }

    // Collect import nodes
    const importNodes = collectAllImports(fileAST);
    for (const impNode of importNodes) {
      const nodeId = makeNodeId(filePath, impNode.span, "import");
      const dgNode: ImportDGNode = {
        kind: "import",
        nodeId,
        source: impNode.source ?? "",
        hasLift: false,
        span: impNode.span,
      };
      nodes.set(nodeId, dgNode);
    }

    // ------------------------------------------------------------------
    // Process logic blocks for hasLift and block node tracking
    // ------------------------------------------------------------------

    const logicBlocks = collectAnonymousLogicBlocks(fileAST);

    for (const lb of logicBlocks) {
      if (!Array.isArray(lb.body)) continue;

      const blockId = `${filePath}::lb::${lb.span ? lb.span.start : 0}`;
      const blockNodeEntries: Array<{ nodeId: NodeId; bodyIndex: number }> = [];

      // For each direct body node that has a corresponding DGNode, record it
      for (let i = 0; i < lb.body.length; i++) {
        const bodyNode = lb.body[i];

        // Find matching DGNode by span
        let matchingNodeId: NodeId | null = null;
        for (const [nid, dgn] of nodes) {
          if (
            dgn.span &&
            "span" in bodyNode &&
            bodyNode.span &&
            dgn.span.start === bodyNode.span.start &&
            dgn.span.file === bodyNode.span.file
          ) {
            matchingNodeId = nid;
            break;
          }
        }

        if (matchingNodeId) {
          // Compute hasLift for this node
          const hl = hasLiftAfter(lb.body, i, serverFunctionNames);
          const dgNode = nodes.get(matchingNodeId);
          if (dgNode) dgNode.hasLift = hl;

          blockNodeEntries.push({ nodeId: matchingNodeId, bodyIndex: i });
        }
      }

      if (blockNodeEntries.length > 0) {
        logicBlockNodes.set(blockId, blockNodeEntries);
      }
    }
    _tPerFileEnd(_fileIdx);
  }

  // ------------------------------------------------------------------
  // Resolve pending callees into edges
  // ------------------------------------------------------------------
  // P1.3 — cross-file block start: name-resolution + reactive-var edge maps +
  // engine-derived reads + transitive read fixpoint + derived-cell transitive
  // reads via call edges. All operate on the accumulated maps (functionNameToNodeId,
  // reactiveVarNodeIds, fnTransitiveReads, etc.) — no per-file iteration.
  _tCrossStart();

  for (const [nodeId, dgNode] of nodes) {
    if (dgNode.kind !== "function" || !dgNode._pendingCallees) continue;

    for (const calleeName of dgNode._pendingCallees) {
      const calleeNodeId = functionNameToNodeId.get(calleeName);
      if (!calleeNodeId) continue;

      const boundary = functionNameToBoundary.get(calleeName) ?? "client";
      const edgeKind: DGEdgeKind = boundary === "server" ? "awaits" : "calls";

      pushEdge(nodeId, calleeNodeId, edgeKind);
    }

    delete dgNode._pendingCallees;
  }

  // ------------------------------------------------------------------
  // Reactive variable edges: reads, writes, invalidates
  // ------------------------------------------------------------------

  // Build reactive var name -> nodeId mapping
  const reactiveVarNodeIds = new Map<string, NodeId>();
  const reactiveVarReaders = new Map<string, Set<NodeId>>();

  for (const [nodeId, dgNode] of nodes) {
    if (dgNode.kind === "reactive") {
      reactiveVarNodeIds.set(dgNode.varName, nodeId);
      reactiveVarReaders.set(dgNode.varName, new Set());
    }
  }

  // Phase A1b B7 — track self-referencing derived cells separately so the
  // E-DERIVED-CIRCULAR-DEP detector can report the degenerate 1-cycle case
  // (`const <x> = @x + 1`, SPEC §6.6.10 line 2712). Self-refs are NOT pushed
  // into `edges` (would pollute the read-edge list and cause spurious
  // cycle-of-length-0 issues elsewhere); they are reported alongside multi-
  // hop cycles in the cycle-detection phase below.
  const selfReferencingDerivedNodes = new Set<NodeId>();

  // Resolve pending derived reads and callees for derived state-decl nodes
  // (post-Step-11.5 representation of legacy reactive-derived-decl).
  for (const [nodeId, dgNode] of nodes) {
    if (dgNode.kind !== "reactive") continue;
    const anyNode = dgNode as any;

    if (anyNode._pendingDerivedReads) {
      for (const varName of anyNode._pendingDerivedReads) {
        if (varName === dgNode.varName) {
          // Phase A1b B7 — degenerate cycle (self-reference), tracked
          // separately for E-DERIVED-CIRCULAR-DEP reporting (SPEC §6.6.10).
          selfReferencingDerivedNodes.add(nodeId);
          continue;
        }
        const targetNodeId = reactiveVarNodeIds.get(varName);
        if (targetNodeId) {
          pushEdge(nodeId, targetNodeId, "reads");
          const readers = reactiveVarReaders.get(varName);
          if (readers) readers.add(nodeId);
        }
      }
      delete anyNode._pendingDerivedReads;
    }

    if (anyNode._pendingDerivedCallees) {
      for (const calleeName of anyNode._pendingDerivedCallees) {
        const calleeNodeId = functionNameToNodeId.get(calleeName);
        if (calleeNodeId) {
          const boundary = functionNameToBoundary.get(calleeName) ?? "client";
          const edgeKind: DGEdgeKind = boundary === "server" ? "awaits" : "calls";
          pushEdge(nodeId, calleeNodeId, edgeKind);
        }
      }
      delete anyNode._pendingDerivedCallees;
    }
  }

  // ------------------------------------------------------------------
  // Phase A1b B16 — Resolve pending engine-derived reads into edges
  //
  // For each engine cell (registered above) with `_pendingEngineDerivedReads`,
  // emit `engine-derived-reads` edges to the upstream cell DG nodes. Self-
  // references are tracked separately (degenerate 1-cycle case, mirrors
  // B7's `selfReferencingDerivedNodes` and B10's
  // `selfReferencingValidatorNodes` patterns).
  // ------------------------------------------------------------------
  const selfReferencingDerivedEngineNodes = new Set<NodeId>();
  for (const [nodeId, dgNode] of nodes) {
    if (dgNode.kind !== "reactive") continue;
    const anyNode = dgNode as any;
    if (!anyNode._pendingEngineDerivedReads) continue;
    for (const upstreamVarName of anyNode._pendingEngineDerivedReads) {
      if (upstreamVarName === dgNode.varName) {
        // Self-reference: derived engine reads itself. Degenerate 1-cycle.
        selfReferencingDerivedEngineNodes.add(nodeId);
        continue;
      }
      const targetNodeId = reactiveVarNodeIds.get(upstreamVarName);
      if (targetNodeId) {
        pushEdge(nodeId, targetNodeId, "engine-derived-reads");
        const readers = reactiveVarReaders.get(upstreamVarName);
        if (readers) readers.add(nodeId);
      }
      // If the upstream var is unknown, silently skip (downstream typer
      // surfaces unresolved-name errors; B16 doesn't double-fire here).
    }
    delete anyNode._pendingEngineDerivedReads;
  }

  // P1.3 — cross-file block end (resolve callees + reactive-var map + engine-derived).
  _tCrossEnd();

  // Scan function bodies for reactive variable references
  // P1.3 — per-file loop #2: function-body @var ref scan
  for (let _fileIdx2 = 0; _fileIdx2 < files.length; _fileIdx2++) {
    const rawFile = files[_fileIdx2];
    _tPerFileStart();
    const fileAST = resolveFileAST(rawFile);
    if (!fileAST) { _tPerFileEnd(_fileIdx2); continue; }

    const fnNodes = collectAllFunctions(fileAST);
    for (const fnNode of fnNodes) {
      if (!Array.isArray(fnNode.body)) continue;
      const fnDGNodeId = functionNameToNodeId.get(fnNode.name);
      if (!fnDGNodeId) continue;

      // Recursively walk function body for @var reads/writes, including
      // match arms, if/else branches, for/while bodies, and try/catch blocks.
      function walkBodyForReactiveRefs(nodes: any[]): void {
        for (const bodyNode of nodes) {
          if (!bodyNode || typeof bodyNode !== "object") continue;

          // bare-expr / derived state-decl: check for @varName references.
          // Prefer ExprNode walk; fall back to string regex.
          // Phase A1a Step 11.5 — `reactive-derived-decl` folded into
          // state-decl with shape:"derived" + structuralForm:false. The
          // derived form in a function body is a READ (deps from RHS),
          // unlike a plain state-decl which is a WRITE.
          const _isFoldedDerived =
            bodyNode.kind === "state-decl" &&
            bodyNode.shape === "derived" &&
            bodyNode.structuralForm === false;
          if (bodyNode.kind === "bare-expr" || _isFoldedDerived) {
            const exprRefs = collectReactiveRefsFromExprNode(bodyNode as Record<string, unknown>);
            const refs = exprRefs.length > 0 ? exprRefs : (() => {
              const field = bodyNode.exprNode
                ? emitStringFromTree(bodyNode.exprNode as import("./types/ast.ts").ExprNode)
                : (bodyNode.initExpr
                  ? emitStringFromTree(bodyNode.initExpr as import("./types/ast.ts").ExprNode)
                  : (bodyNode.expr ?? bodyNode.init));
              if (typeof field !== "string") return [];
              const m = field.match(/@([A-Za-z_$][A-Za-z0-9_$]*)/g);
              return m ? m.map((r: string) => r.slice(1)) : [];
            })();
            for (const varName of refs) {
              const reactiveNodeId = reactiveVarNodeIds.get(varName);
              if (reactiveNodeId) {
                pushEdge(fnDGNodeId, reactiveNodeId, "reads");
                const readers = reactiveVarReaders.get(varName);
                if (readers) readers.add(fnDGNodeId);
              }
            }
          }

          // state-decl in function body = write
          // Phase A1a Step 11.5 — fold: skip the legacy `const @x = expr`
          // form (shape:"derived", structuralForm:false) which the upper
          // branch already handles as a READ.
          if (bodyNode.kind === "state-decl" && bodyNode.name && !_isFoldedDerived) {
            const reactiveNodeId = reactiveVarNodeIds.get(bodyNode.name);
            if (reactiveNodeId) {
              pushEdge(fnDGNodeId, reactiveNodeId, "writes");
            }
          }

          // §52.4.4 (E-AUTH-001 companion) — a `?{}` SQL statement in a function
          // body reads its `${@var}` bound params. `collectAllSqlBlocks` (the
          // top-level credit) does NOT descend into function bodies, so credit
          // those reads here so the function counts as a consumer for E-DG-002
          // (a var interpolated into a `?{}` write IS consumed — E-AUTH-001,
          // §52.11, is the sole diagnostic for the client-local write-param
          // leak, not a misleading "unused variable").
          if (bodyNode.kind === "sql" && typeof bodyNode.query === "string") {
            for (const varName of sqlQueryInterpolationSigilReads(bodyNode.query)) {
              const reactiveNodeId = reactiveVarNodeIds.get(varName);
              if (reactiveNodeId) {
                pushEdge(fnDGNodeId, reactiveNodeId, "reads");
                const readers = reactiveVarReaders.get(varName);
                if (readers) readers.add(fnDGNodeId);
              }
            }
          }

          // Recurse into control flow bodies
          if (bodyNode.kind === "match-stmt") {
            // Match stmt header may contain @var refs — ExprNode-first, string fallback
            const matchHeaderRefs = collectReactiveRefsFromExprNode(bodyNode as Record<string, unknown>);
            const headerRefNames = matchHeaderRefs.length > 0 ? matchHeaderRefs : (() => {
              const _hdr = (bodyNode as any).headerExpr
                ? emitStringFromTree((bodyNode as any).headerExpr as import("./types/ast.ts").ExprNode)
                : (typeof bodyNode.header === "string" ? bodyNode.header : null);
              if (!_hdr) return [];
              const m = _hdr.match(/@([A-Za-z_$][A-Za-z0-9_$]*)/g);
              return m ? m.map((r: string) => r.slice(1)) : [];
            })();
            for (const varName of headerRefNames) {
              const reactiveNodeId = reactiveVarNodeIds.get(varName);
              if (reactiveNodeId) {
                pushEdge(fnDGNodeId, reactiveNodeId, "reads");
                const readers = reactiveVarReaders.get(varName);
                if (readers) readers.add(fnDGNodeId);
              }
            }
            // Match stmt body contains the arm nodes — recurse into them
            if (Array.isArray(bodyNode.body)) walkBodyForReactiveRefs(bodyNode.body);
          }
          if (bodyNode.kind === "if-stmt") {
            // Scan condition for @var refs — ExprNode-first, string fallback
            const condRefs = collectReactiveRefsFromExprNode(bodyNode as Record<string, unknown>);
            const condRefNames = condRefs.length > 0 ? condRefs : (() => {
              const _cond = (bodyNode as any).condExpr
                ? emitStringFromTree((bodyNode as any).condExpr as import("./types/ast.ts").ExprNode)
                : (typeof bodyNode.condition === "string" ? bodyNode.condition : null);
              if (!_cond) return [];
              const m = _cond.match(/@([A-Za-z_$][A-Za-z0-9_$]*)/g);
              return m ? m.map((r: string) => r.slice(1)) : [];
            })();
            for (const varName of condRefNames) {
              const reactiveNodeId = reactiveVarNodeIds.get(varName);
              if (reactiveNodeId) {
                pushEdge(fnDGNodeId, reactiveNodeId, "reads");
                const readers = reactiveVarReaders.get(varName);
                if (readers) readers.add(fnDGNodeId);
              }
            }
            if (Array.isArray(bodyNode.consequent)) walkBodyForReactiveRefs(bodyNode.consequent);
            if (Array.isArray(bodyNode.alternate)) walkBodyForReactiveRefs(bodyNode.alternate);
          }
          if ((bodyNode.kind === "for-stmt" || bodyNode.kind === "while-stmt") && Array.isArray(bodyNode.body)) {
            walkBodyForReactiveRefs(bodyNode.body);
          }
          if (bodyNode.kind === "try-stmt") {
            if (Array.isArray(bodyNode.body)) walkBodyForReactiveRefs(bodyNode.body);
            if (bodyNode.catchNode && Array.isArray(bodyNode.catchNode.body)) walkBodyForReactiveRefs(bodyNode.catchNode.body);
            if (Array.isArray(bodyNode.finallyBody)) walkBodyForReactiveRefs(bodyNode.finallyBody);
          }
          // logic nodes may contain nested body arrays
          if (bodyNode.kind === "logic" && Array.isArray(bodyNode.body)) {
            walkBodyForReactiveRefs(bodyNode.body);
          }
        }
      }
      walkBodyForReactiveRefs(fnNode.body);
    }

    // §52.4.4 (E-AUTH-001 companion) — credit `${@var}` reads inside a `?{}` SQL
    // query as consumers for E-DG-002 accounting. A cell interpolated as a bound
    // parameter IS consumed by the query (a read for SELECT; a persisted write
    // for INSERT/UPDATE/DELETE), so the "declared but never consumed" sweep must
    // not false-fire on it. This is the E-DG-002-interaction resolution the
    // §52.4.6 worked example fixes: a client-local write-param must surface as
    // E-AUTH-001 (§52.11) ALONE — the value IS consumed, just illegally — not as
    // a misleading "unused variable" warning. The prior fn-body walk never
    // visited `sql` nodes, so a bound-param read went uncounted.
    for (const sqlNode of collectAllSqlBlocks(fileAST)) {
      const q = typeof sqlNode.query === "string" ? sqlNode.query : "";
      if (!q) continue;
      // Look up the sql node's ALREADY-REGISTERED DGNode id (loop #1); makeNodeId
      // embeds a monotonic counter so it cannot be recomputed here.
      const sqlNodeId = sqlAstToNodeId.get(sqlNode as ASTNode);
      if (!sqlNodeId) continue;
      for (const varName of sqlQueryInterpolationSigilReads(q)) {
        const reactiveNodeId = reactiveVarNodeIds.get(varName);
        if (reactiveNodeId) {
          pushEdge(sqlNodeId, reactiveNodeId, "reads");
          const readers = reactiveVarReaders.get(varName);
          if (readers) readers.add(sqlNodeId);
        }
      }
    }
    _tPerFileEnd(_fileIdx2);
  }

  // ------------------------------------------------------------------
  // Function call graph propagation: build transitive reactive reads
  //
  // After scanning function bodies for direct @var reads, propagate
  // reactive reads through the call graph. If fn1 calls fn2 and fn2
  // reads @var, fn1 transitively reads @var too. This ensures:
  //   - "reads" edges are created for transitive dependencies
  //   - E-DG-002 accounts for transitive consumption via function calls
  // ------------------------------------------------------------------

  // Step 1: Build functionName -> Set<varName> for direct reactive reads
  const fnDirectReactiveReads = new Map<string, Set<string>>();
  const fnCallGraphMap = new Map<string, Set<string>>();
  // Phase A1b B7: track per-function purity for transitive-read filtering.
  // Pure `fn` (§48) calls have NO implicit reactive deps; reactive `function`
  // calls inherit their callees' deps (SPEC §31.5, audit §1.1). In well-formed
  // programs pure-fn bodies cannot read reactive cells (E-FN-001..E-FN-005),
  // so this map is mostly defensive — but it makes the design contract
  // explicit and prevents silent staleness if upstream purity enforcement
  // ever has a hole.
  const fnPurityMap = new Map<string, boolean>(); // fnName -> isPure

  // P1.3 — per-file loop #3: direct reactive reads + call-graph build
  for (let _fileIdx3 = 0; _fileIdx3 < files.length; _fileIdx3++) {
    const rawFile = files[_fileIdx3];
    _tPerFileStart();
    const fileAST = resolveFileAST(rawFile);
    if (!fileAST) { _tPerFileEnd(_fileIdx3); continue; }

    const fnNodes = collectAllFunctions(fileAST);
    for (const fnNode of fnNodes) {
      if (!fnNode.name) continue;
      if (!fnDirectReactiveReads.has(fnNode.name)) {
        fnDirectReactiveReads.set(fnNode.name, new Set());
      }
      if (!fnCallGraphMap.has(fnNode.name)) {
        fnCallGraphMap.set(fnNode.name, new Set());
      }
      // Record purity: `fn` keyword (§48) ⇒ pure; otherwise reactive.
      if (!fnPurityMap.has(fnNode.name)) {
        fnPurityMap.set(fnNode.name, (fnNode as { fnKind?: string }).fnKind === "fn");
      }

      if (!Array.isArray(fnNode.body)) continue;

      function collectReadsAndCalls(nodes: any[]): void {
        for (const bodyNode of nodes) {
          if (!bodyNode || typeof bodyNode !== "object") continue;
          // Prefer ExprNode walk for @var refs and callees.
          const exprRefs = collectReactiveRefsFromExprNode(bodyNode as Record<string, unknown>);
          const exprCallees = collectCalleesFromExprNode(bodyNode as Record<string, unknown>);
          if (exprRefs.length > 0 || exprCallees.length > 0) {
            for (const varName of exprRefs) {
              if (reactiveVarNodeIds.has(varName)) {
                fnDirectReactiveReads.get(fnNode.name)!.add(varName);
              }
            }
            for (const callee of exprCallees) {
              fnCallGraphMap.get(fnNode.name)!.add(callee);
            }
          }
          // String fallback for nodes without ExprNode fields.
          for (const field of ["expr", "init", "header", "condition"] as const) {
            const val = bodyNode[field];
            if (typeof val !== "string") continue;
            // Skip string scan if ExprNode already covered this node.
            if (exprRefs.length > 0 || exprCallees.length > 0) continue;
            const atRefs = val.match(/@([A-Za-z_$][A-Za-z0-9_$]*)/g);
            if (atRefs) {
              for (const ref of atRefs) {
                const varName = ref.slice(1);
                if (reactiveVarNodeIds.has(varName)) {
                  fnDirectReactiveReads.get(fnNode.name)!.add(varName);
                }
              }
            }
            const callees = extractCallees(val);
            for (const callee of callees) {
              fnCallGraphMap.get(fnNode.name)!.add(callee);
            }
          }
          if (bodyNode.kind === "match-stmt" && Array.isArray(bodyNode.body)) {
            collectReadsAndCalls(bodyNode.body);
          }
          if (bodyNode.kind === "if-stmt") {
            if (Array.isArray(bodyNode.consequent)) collectReadsAndCalls(bodyNode.consequent);
            if (Array.isArray(bodyNode.alternate)) collectReadsAndCalls(bodyNode.alternate);
          }
          if ((bodyNode.kind === "for-stmt" || bodyNode.kind === "while-stmt") && Array.isArray(bodyNode.body)) {
            collectReadsAndCalls(bodyNode.body);
          }
          if (bodyNode.kind === "try-stmt") {
            if (Array.isArray(bodyNode.body)) collectReadsAndCalls(bodyNode.body);
            if (bodyNode.catchNode && Array.isArray(bodyNode.catchNode.body)) collectReadsAndCalls(bodyNode.catchNode.body);
            if (Array.isArray(bodyNode.finallyBody)) collectReadsAndCalls(bodyNode.finallyBody);
          }
          if (bodyNode.kind === "logic" && Array.isArray(bodyNode.body)) {
            collectReadsAndCalls(bodyNode.body);
          }
        }
      }
      collectReadsAndCalls(fnNode.body);
    }
    _tPerFileEnd(_fileIdx3);
  }

  // P1.3 — cross-file block: transitive read fixpoint + derived-cell transitive reads.
  _tCrossStart();

  // Step 2: Propagate transitive reactive reads through the call graph (fixed-point)
  const fnTransitiveReads = new Map<string, Set<string>>();
  for (const [fnName, directReads] of fnDirectReactiveReads) {
    fnTransitiveReads.set(fnName, new Set(directReads));
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const [fnName, callees] of fnCallGraphMap) {
      const myReads = fnTransitiveReads.get(fnName);
      if (!myReads) continue;
      for (const callee of callees) {
        // Phase A1b B7 — pure-fn filter (§31.5, §48): pure `fn` calls do NOT
        // contribute implicit reactive dependencies to the caller. Reactive
        // `function` calls DO inherit their callees' reactive reads.
        if (fnPurityMap.get(callee) === true) continue;
        const calleeReads = fnTransitiveReads.get(callee);
        if (!calleeReads) continue;
        for (const varName of calleeReads) {
          if (!myReads.has(varName)) {
            myReads.add(varName);
            changed = true;
            const callerNodeId = functionNameToNodeId.get(fnName);
            const reactiveNodeId = reactiveVarNodeIds.get(varName);
            if (callerNodeId && reactiveNodeId) {
              // S99 perf — O(1) edge-existence lookup via edgeKeySet (was O(E)
              // `edges.some(...)` scan inside this fixpoint hot loop).
              pushEdge(callerNodeId, reactiveNodeId, "reads");
              const readers = reactiveVarReaders.get(varName);
              if (readers) readers.add(callerNodeId);
            }
          }
        }
      }
    }
  }

  // Propagate transitive reactive reads through function calls made by derived decls.
  // Phase A1b B7 — pure-fn filter (§31.5, §48): pure `fn` callees do NOT
  // contribute reactive deps to the deriving cell. `formatCount(@n)` where
  // `formatCount` is `fn` adds NO transitive deps; `reactiveLog(@n)` where
  // `reactiveLog` is `function` DOES inherit `reactiveLog`'s reactive reads.
  // S99 perf — bucket calls/awaits edges by `from` node ONCE before the per-
  // reactive-node loop, replacing the O(R·E) `edges.filter(...)` scan inside
  // the loop with an O(E) one-shot index build + O(1) lookup. Only edges
  // emitted by Phase 1 are visible here; the fixpoint above only adds `reads`
  // edges, never `calls`/`awaits`, so the bucket is stable for this pass.
  const callOrAwaitEdgesByFrom = new Map<NodeId, DGEdge[]>();
  for (const e of edges) {
    if (e.kind !== "calls" && e.kind !== "awaits") continue;
    let bucket = callOrAwaitEdgesByFrom.get(e.from);
    if (!bucket) {
      bucket = [];
      callOrAwaitEdgesByFrom.set(e.from, bucket);
    }
    bucket.push(e);
  }
  for (const [nodeId, dgNode] of nodes) {
    if (dgNode.kind !== "reactive") continue;
    const callEdges = callOrAwaitEdgesByFrom.get(nodeId);
    if (!callEdges) continue;
    for (const callEdge of callEdges) {
      const calledNode = nodes.get(callEdge.to);
      if (!calledNode || calledNode.kind !== "function") continue;
      // S99 perf — O(1) reverse lookup via nodeIdToFunctionName (was O(F)
      // iterate-by-value of functionNameToNodeId).
      const calledFnName = nodeIdToFunctionName.get(callEdge.to) ?? null;
      if (!calledFnName) continue;
      // Pure `fn` callees skip transitive read propagation (audit §1.1).
      if (fnPurityMap.get(calledFnName) === true) continue;
      const transitiveReads = fnTransitiveReads.get(calledFnName);
      if (!transitiveReads) continue;
      for (const varName of transitiveReads) {
        if (varName === dgNode.varName) {
          // Phase A1b B7 — a reactive `function` called by this derived
          // cell transitively reads the derived's own var: self-cycle
          // through a reactive call. Track as degenerate cycle for
          // E-DERIVED-CIRCULAR-DEP reporting (§31.5 + §6.6.10).
          selfReferencingDerivedNodes.add(nodeId);
          continue;
        }
        const reactiveNodeId = reactiveVarNodeIds.get(varName);
        if (!reactiveNodeId) continue;
        // S99 perf — O(1) edge-existence lookup via pushEdge (was O(E)
        // `edges.some(...)` scan inside this per-reactive-node loop).
        // pushEdge returns true on first insert; mirror the prior
        // `if (!exists)` branch by only crediting the reader then.
        if (pushEdge(nodeId, reactiveNodeId, "reads")) {
          const readers = reactiveVarReaders.get(varName);
          if (readers) readers.add(nodeId);
        }
      }
    }
  }

  // P1.3 — cross-file block end (transitive fixpoint + derived-cell transitive reads).
  _tCrossEnd();

  // Scan ALL AST nodes (markup, attributes, top-level logic) for @var references
  // not captured by the function-body scan above. Markup interpolations like ${@var}
  // are the primary case — they consume reactive variables but don't go through
  // function DG nodes. Any @var read anywhere outside a function still satisfies
  // the "has readers" check for E-DG-002 purposes.
  const MARKUP_READER_SENTINEL = "__markup__";

  // ------------------------------------------------------------------
  // PGO P2.2 (S102) — markup AST sweep per-call-site characterization.
  //
  // P1.3 surfaced that DG super-linear growth lives in the per-file work
  // loop, with per-file loop #4 (markup AST sweep) carrying ~80ms of 103ms
  // on trucking-dispatch. This P2.2 instrumentation drills INTO loop #4 and
  // attributes cumulative cost to specific call sites:
  //
  //   creditReader           — closure called per @ref discovered. Sentinel
  //                            credit for E-DG-002 + projected->source upstream.
  //   emitMarkupReadEdge     — emission boundary. Calls findOwningRenderDGNode
  //                            + createMarkupReadNode + pushEdge.
  //   findOwningRenderDGNode — exported O(n) linear scan over the GLOWING
  //                            `nodes` Map (the candidate for V8-hash-rehash /
  //                            growing-data-structure cost growth).
  //   sweepNodeForAtRefs     — top-level entry-to-exit recursion per top-level
  //                            AST node (measures gross per-node cost).
  //   collectReactiveRefs    — ExprNode walker for @var refs.
  //   collectCallees         — ExprNode walker for direct callees.
  //   collectMetaVarRefs     — ExprNode walker for meta.get / meta.bindings.
  //
  // Output (when `debugPerf` is set; sorted desc by total ms):
  //
  //   [DG-MARKUP-SWEEP] <site>: <total>ms (<pct>% of sweep) Q1=...ms Q4=...ms
  //
  // Quartiles split the file-index range into 4 even bins, same shape as
  // [DG-PER-FILE]. Q1 = first 25% of files in iteration order; Q4 = last 25%.
  // Per-site cumulative ms across all files in a bin (NOT per-file average).
  //
  // Granularity discipline (per SCOPING §3.1): instrument at the closure /
  // helper boundary, NOT inside the recursive walker per AST-node iteration.
  // Per-call overhead is ~100-200ns × N calls = leaks with flag ON, which is
  // expected (instrumentation is opt-in). Flag-OFF path is the original
  // closure (zero overhead) via the ternary-on-debugPerf wrapping pattern.
  // ------------------------------------------------------------------
  interface MarkupSweepStat { total: number; q: number[] }
  const markupSweepStats: Record<string, MarkupSweepStat> | null = debugPerf
    ? {
        creditReader:           { total: 0, q: [0, 0, 0, 0] },
        emitMarkupReadEdge:     { total: 0, q: [0, 0, 0, 0] },
        findOwningRenderDGNode: { total: 0, q: [0, 0, 0, 0] },
        sweepNodeForAtRefs:     { total: 0, q: [0, 0, 0, 0] },
        collectReactiveRefs:    { total: 0, q: [0, 0, 0, 0] },
        collectCallees:         { total: 0, q: [0, 0, 0, 0] },
        collectMetaVarRefs:     { total: 0, q: [0, 0, 0, 0] },
      }
    : null;
  const _markupQuartileBin = (fileIdx: number, F: number): number => {
    if (F <= 0) return 0;
    const q = Math.floor((fileIdx * 4) / F);
    return q > 3 ? 3 : q;
  };

  // P1.3 — per-file loop #4: markup AST sweep for @var refs + markup-read edges
  for (let _fileIdx4 = 0; _fileIdx4 < files.length; _fileIdx4++) {
    const rawFile = files[_fileIdx4];
    _tPerFileStart();
    const fileAST = resolveFileAST(rawFile);
    if (!fileAST) { _tPerFileEnd(_fileIdx4); continue; }

    // §51.9 — projected vars (e.g. @ui) read their source var (e.g. @order)
    // at runtime via the derived-fn chain. A reference to @ui therefore also
    // counts as a read of @order for the purposes of E-DG-002 ("has readers").
    // Build the projected→source map from this file's machineRegistry.
    // machineRegistry is attached by runTS on the OUTER TypedFileAST (the
    // rawFile wrapper), not on the resolved inner FileAST — so read it from
    // rawFile, with a fallback to fileAST for shapes where it's hoisted.
    const projectedToSource = new Map<string, string>();
    const registryHolder =
      ((rawFile as { machineRegistry?: unknown }).machineRegistry as Map<string, unknown> | undefined) ??
      ((fileAST as unknown as { machineRegistry?: Map<string, unknown> }).machineRegistry);
    if (registryHolder && typeof registryHolder.values === "function") {
      for (const m of registryHolder.values() as Iterable<{ isDerived?: boolean; projectedVarName?: string | null; sourceVar?: string | null }>) {
        if (m && m.isDerived && m.projectedVarName && m.sourceVar) {
          projectedToSource.set(m.projectedVarName, m.sourceVar);
        }
      }
    }
    // §51.9 — a read of a projected var (e.g. `@healthRisk`) ALSO credits
    // its upstream source (e.g. `@marioState`), because the projection is
    // recomputed transitively through the derived-fn chain. BUT the projected
    // var itself is ALSO a real reader — without crediting it directly, the
    // post-walk E-DG-002 sweep would false-fire on every projected var that
    // has downstream consumers (the redirect would zero out its direct
    // reader set). Credit BOTH names; when there is no redirect the two
    // collapse to the same key and only one entry is touched.
    // P2.2 — quartile bin for this file (constant within the per-file iteration).
    const _markupQBin = debugPerf ? _markupQuartileBin(_fileIdx4, files.length) : 0;

    const _baseCreditReader = (rawName: string): void => {
      const readers = reactiveVarReaders.get(rawName);
      if (readers) readers.add(MARKUP_READER_SENTINEL);
      const upstream = projectedToSource.get(rawName);
      if (upstream && upstream !== rawName) {
        const upstreamReaders = reactiveVarReaders.get(upstream);
        if (upstreamReaders) upstreamReaders.add(MARKUP_READER_SENTINEL);
      }
    };
    // P2.2 — tracked variant when debugPerf is set; otherwise the bare closure.
    // The flag-OFF path is the original `_baseCreditReader` reference — zero
    // overhead. The flag-ON path adds two `performance.now()` calls per
    // invocation, which IS overhead but is opt-in.
    const creditReader: (rawName: string) => void = debugPerf && markupSweepStats
      ? (rawName: string): void => {
          const s = performance.now();
          _baseCreditReader(rawName);
          const d = performance.now() - s;
          const slot = markupSweepStats.creditReader;
          slot.total += d;
          slot.q[_markupQBin] += d;
        }
      : _baseCreditReader;

    // g-compound-field-render-by-tag-unexpanded — map each compound MEMBER leaf
    // name to its parent compound's bare name for this file. A bare render-by-tag
    // `<uname/>` whose decl is a compound member (NOT a top-level cell) consumes
    // the PARENT compound (`@signup`) per SPEC §6.3.5; the parent is the cell
    // that owns a DG node (members are folded into the parent — see
    // collectAllReactiveDecls, which does NOT descend into a state-decl's
    // children). Without crediting the parent on a member render-by-tag, E-DG-002
    // false-fires on a compound consumed ONLY through a member `<field/>`.
    // Built once per file; only populated when compound parents exist.
    const compoundMemberToParent = new Map<string, string>();
    {
      const collectCompoundMembers = (list: ASTNode[]): void => {
        for (const n of list) {
          if (n.kind === "state-decl") {
            const sd = n as Record<string, unknown>;
            const parentName = sd.name as string | undefined;
            const kids = sd.children as ASTNode[] | undefined;
            if (parentName && Array.isArray(kids) && kids.length > 0) {
              for (const kid of kids) {
                if (kid.kind === "state-decl") {
                  const kidName = (kid as Record<string, unknown>).name as string | undefined;
                  // Last writer wins is fine; an ambiguous duplicate member name
                  // is handled at the render-by-tag resolver (codegen) — here we
                  // only need ANY parent to credit so E-DG-002 doesn't false-fire.
                  if (kidName && !compoundMemberToParent.has(kidName)) {
                    compoundMemberToParent.set(kidName, parentName);
                  }
                }
              }
            }
          }
          if ((n as Record<string, unknown>).kind === "logic" && Array.isArray((n as Record<string, unknown>).body)) {
            collectCompoundMembers((n as Record<string, unknown>).body as ASTNode[]);
          }
          if ("children" in n && Array.isArray((n as MarkupNode).children)) {
            collectCompoundMembers((n as MarkupNode).children as ASTNode[]);
          }
        }
      };
      collectCompoundMembers(fileAST.nodes);
    }

    // -------------------------------------------------------------------------
    // A-1.3 — markup-context read emission (flag activated)
    //
    // Flipped to true in A-1.3. The high-frequency shapes (text interpolation,
    // variable-ref attribute, bind:value, if-condition) now push a MarkupReadDGNode
    // into nodes and a reads edge into edges at each creditReader call site that
    // corresponds to one of those 4 shapes. creditReader calls are KEPT (additive);
    // E-DG-002 sentinel credit is unchanged. A-1.6 will audit all consumers.
    //
    // A-1.4 wired the remaining shapes (call-ref, for-iterable, lift-template-body).
    // A-1.5 wired engine state-child + onTransition/onTimeout/onIdle.
    // -------------------------------------------------------------------------
    const markupContextEmitEdges = true;

    // Depth counter: incremented when entering a markup node's children, decremented
    // on exit. Shape 1 emission (bare-expr text interpolation) gates on depth > 0
    // to avoid emitting edges for bare-expr nodes that appear in top-level logic
    // blocks, which are already captured by the function-body DG scan above.
    let markupChildDepth = 0;

    // P3.C — owner-stack of enclosing RenderDGNode NodeIds. Pushed when the
    // recursion enters a markup AST node whose identity is registered in
    // `markupAstToRenderId`; popped on exit. emitMarkupReadEdge reads the top
    // of this stack as the `sourceRenderNodeId` for the emitted markup-read
    // node, replacing the per-call O(n) findOwningRenderDGNode scan over the
    // global `nodes` Map. findOwningRenderDGNode is kept as a fallback for
    // call paths whose enclosing render node is not on the stack (e.g. the
    // outer engine-decl self-read, lift-expr markup targets that are not
    // registered as render nodes).
    const renderOwnerStack: NodeId[] = [];

    // Helper: push one MarkupReadDGNode + one reads edge for a reactive var read
    // discovered at a markup-context site. Called from the 4 high-frequency shapes
    // below. attrSpan is the span of the interpolation or attribute site.
    //
    // P2.2 — split base vs tracked. Base shape unchanged. Tracked variant
    // additionally splits findOwningRenderDGNode time from the rest of the
    // emission cost (Map writes + pushEdge) so the V8-hash-rehash hypothesis
    // can be evaluated against the linear-scan-over-growing-nodes hypothesis.
    // P3.C — owner-stack-derived source render NodeId resolver. Returns the
    // top of `renderOwnerStack` (the tightest enclosing RenderDGNode), or
    // falls back to the legacy O(n) findOwningRenderDGNode scan when the
    // stack is empty (which happens when emit is called from a context not
    // nested inside any registered markup AST node — e.g. an engine-decl at
    // file top-level, or a lift-expr whose target markup is not in the
    // RenderDGNode registry). Increments a diagnostic counter when the
    // fallback returns a non-null result, surfacing potential missed
    // boundary pushes.
    const resolveSourceRenderNodeId = (attrSpan: Span): NodeId | null => {
      const stackTop =
        renderOwnerStack.length > 0
          ? renderOwnerStack[renderOwnerStack.length - 1]
          : null;
      if (stackTop !== null) return stackTop;
      // Stack empty — fall back. If fallback finds something, that's a
      // potential gap in boundary-push coverage; count it for diagnostics.
      const fallback = findOwningRenderDGNode({ span: attrSpan } as ASTNode, nodes);
      if (fallback !== null) renderOwnerStackFallbackFires_total++;
      return fallback;
    };

    const _baseEmitMarkupReadEdge = (attrSpan: Span, varName: string): void => {
      const reactiveNodeId = reactiveVarNodeIds.get(varName);
      if (!reactiveNodeId) return; // var not in DG — nothing to link to
      const sourceRenderNodeId = resolveSourceRenderNodeId(attrSpan);
      const { nodeId: mrNodeId, dgNode: mrDGNode } = createMarkupReadNode(
        attrSpan,
        sourceRenderNodeId,
        fileAST.filePath,
      );
      nodes.set(mrNodeId, mrDGNode);
      pushEdge(mrNodeId, reactiveNodeId, "reads");
    };
    const emitMarkupReadEdge: (attrSpan: Span, varName: string) => void = debugPerf && markupSweepStats
      ? (attrSpan: Span, varName: string): void => {
          const reactiveNodeId = reactiveVarNodeIds.get(varName);
          if (!reactiveNodeId) return;
          const outerS = performance.now();
          // P3.C — sub-timing now measures the owner-stack-derived resolver
          // (stack-top read + null-fallback to the legacy linear scan). On a
          // healthy walker the fallback never fires, so the bulk of this
          // attributed time is the stack-top read itself (~constant).
          const fS = performance.now();
          const sourceRenderNodeId = resolveSourceRenderNodeId(attrSpan);
          const fD = performance.now() - fS;
          const fSlot = markupSweepStats.findOwningRenderDGNode;
          fSlot.total += fD;
          fSlot.q[_markupQBin] += fD;
          // Remainder of the emission (Map writes + pushEdge).
          const { nodeId: mrNodeId, dgNode: mrDGNode } = createMarkupReadNode(
            attrSpan,
            sourceRenderNodeId,
            fileAST.filePath,
          );
          nodes.set(mrNodeId, mrDGNode);
          pushEdge(mrNodeId, reactiveNodeId, "reads");
          const outerD = performance.now() - outerS;
          const slot = markupSweepStats.emitMarkupReadEdge;
          slot.total += outerD;
          slot.q[_markupQBin] += outerD;
        }
      : _baseEmitMarkupReadEdge;

    function sweepNodeForAtRefs(node: ASTNode): void {
      // P3.C — push the enclosing-render-NodeId onto renderOwnerStack BEFORE
      // any emit calls fire for this node. Markup nodes' own attribute emits
      // (variable-ref / call-ref / if= conditional) run inside this function
      // BEFORE the child-recursion at the bottom, so the push must happen at
      // the top to make the stack reflect "we are now inside this markup's
      // emit zone." Pop happens via the try/finally pattern at the bottom of
      // the function to handle every return path consistently.
      let pushedRenderOwner: NodeId | null = null;
      if (node.kind === "markup") {
        const ownId = markupAstToRenderId.get(node);
        if (ownId !== undefined) {
          renderOwnerStack.push(ownId);
          pushedRenderOwner = ownId;
        }
      }

      // Phase 4d: ExprNode-first reactive ref + callee detection, string fallback
      // P2.2 — wrap the 3 ExprNode-walker calls. Each fires per AST node visited
      // by the recursion; aggregate cost grows with markup size + ExprNode depth.
      let exprRefs: string[];
      let exprCallees: string[];
      if (debugPerf && markupSweepStats) {
        const s1 = performance.now();
        exprRefs = collectReactiveRefsFromExprNode(node as Record<string, unknown>);
        const d1 = performance.now() - s1;
        const slot1 = markupSweepStats.collectReactiveRefs;
        slot1.total += d1;
        slot1.q[_markupQBin] += d1;

        const s2 = performance.now();
        exprCallees = collectCalleesFromExprNode(node as Record<string, unknown>);
        const d2 = performance.now() - s2;
        const slot2 = markupSweepStats.collectCallees;
        slot2.total += d2;
        slot2.q[_markupQBin] += d2;
      } else {
        exprRefs = collectReactiveRefsFromExprNode(node as Record<string, unknown>);
        exprCallees = collectCalleesFromExprNode(node as Record<string, unknown>);
      }
      for (const varName of exprRefs) {
        creditReader(varName);
        // A-1.3 Shape 1 — ${@x} text interpolation inside markup.
        // Only emit markup-read nodes when (a) the flag is on, (b) the node is
        // specifically a bare-expr (the interpolation AST shape), and (c) we are
        // inside a markup element's children (markupChildDepth > 0), distinguishing
        // markup-context reads from top-level logic reads already in the DG.
        if (markupContextEmitEdges && node.kind === "bare-expr" && markupChildDepth > 0) {
          const interSpan = node.span;
          if (interSpan) emitMarkupReadEdge(interSpan, varName);
        }
        // A-1.4 Shape 2 — for-iterable @var ref inside markup context.
        // A for-stmt / for-expr whose iterable is a reactive cell (e.g.
        // `for (item of @items)`) reads @items at the loop site. The iterable
        // ExprNode is walked by collectReactiveRefsFromExprNode via iterExpr.
        // Emit a markup-read edge when the for node is inside markup children.
        if (markupContextEmitEdges &&
            (node.kind === "for-stmt" || node.kind === "for-expr") &&
            markupChildDepth > 0 &&
            node.span) {
          emitMarkupReadEdge(node.span, varName);
        }
      }
      for (const callee of exprCallees) {
        const transitiveReads = fnTransitiveReads.get(callee);
        if (transitiveReads) {
          for (const varName of transitiveReads) {
            creditReader(varName);
          }
        }
      }
      // §22 meta: meta.get("name") and meta.bindings.name count as reads of
      // @name. Walks the node's ExprNode fields for these patterns — the
      // normal @var scan misses them because the AST has no "@name" ident.
      // P2.2 — wrap the third ExprNode walker call.
      let metaExprRefs: string[];
      if (debugPerf && markupSweepStats) {
        const sM = performance.now();
        metaExprRefs = collectMetaVarRefsFromExprNode(node as Record<string, unknown>);
        const dM = performance.now() - sM;
        const slotM = markupSweepStats.collectMetaVarRefs;
        slotM.total += dM;
        slotM.q[_markupQBin] += dM;
      } else {
        metaExprRefs = collectMetaVarRefsFromExprNode(node as Record<string, unknown>);
      }
      for (const varName of metaExprRefs) {
        creditReader(varName);
      }
      // String fallback for nodes without ExprNode fields
      if (exprRefs.length === 0 && exprCallees.length === 0) {
        const exprFields = ["expr", "init", "condition", "value", "test", "header", "iterable"] as const;
        for (const field of exprFields) {
          const val = (node as Record<string, unknown>)[field];
          if (typeof val === "string") {
            const atRefs = val.match(/@([A-Za-z_$][A-Za-z0-9_$]*)/g);
            if (atRefs) {
              for (const ref of atRefs) {
                const fbVarName = ref.slice(1);
                creditReader(fbVarName);
                // A-1.4 Shape 2 string-fallback — for-iterable @var via "iterable" field.
                // The iterExpr path (edit 2) handles ExprNode-parsed iterables; this
                // covers the string-only fallback when iterExpr is absent.
                if (markupContextEmitEdges &&
                    field === "iterable" &&
                    (node.kind === "for-stmt" || node.kind === "for-expr") &&
                    markupChildDepth > 0 &&
                    node.span) {
                  emitMarkupReadEdge(node.span, fbVarName);
                }
              }
            }
            const callees = extractCallees(val);
            for (const callee of callees) {
              const transitiveReads = fnTransitiveReads.get(callee);
              if (transitiveReads) {
                for (const varName of transitiveReads) {
                  creditReader(varName);
                }
              }
            }
            // String-level fallback for meta.get/bindings patterns.
            for (const ref of collectMetaVarRefsFromString(val)) {
              creditReader(ref);
            }
          }
        }
      }
      // Check attribute values on markup nodes
      if (node.kind === "markup") {
        // Bug 60 (S157) — render-by-tag structural-read credit (E-DG-002).
        //
        // A markup tag that matches a declared reactive var name IS a render-by-
        // tag use site (SPEC §6.4): a self-tag `<userName/>` (Shape-2 bindable)
        // or a BLOCK-form `<signupForm>...</signupForm>` namespace wrapper for a
        // compound parent (§6.3.5). In both shapes the tag NAME is the cell's
        // structural consumption — it is invisible to the @-ref / attr scans
        // (the tag is not an `@`-sigil read), so without this credit E-DG-002
        // false-fires on a cell consumed ONLY through render-by-tag. This mirrors
        // the each-block / engine-cell / match-block structural-read credits
        // already in this sweep. The compound parent is registered under its bare
        // name (`signupForm`); the wrapper tag matches it and clears the warning
        // once the nested fields render through the wrapper. Lowercase-only (the
        // render-by-tag legal-tag set; PascalCase is component territory).
        const rbtTag = ((node as Record<string, unknown>).tag ??
          (node as Record<string, unknown>).tagName) as string | undefined;
        if (
          typeof rbtTag === "string" &&
          rbtTag.length > 0 &&
          /^[a-z]/.test(rbtTag) &&
          reactiveVarNodeIds.has(rbtTag)
        ) {
          creditReader(rbtTag);
          if (markupContextEmitEdges && node.span) {
            emitMarkupReadEdge(node.span, rbtTag);
          }
        } else if (
          // g-compound-field-render-by-tag-unexpanded — the tag is not a
          // top-level cell, but it IS a compound member used as render-by-tag
          // (`<uname/>` for `<signup><uname/>...</>`). Credit the PARENT compound
          // (the cell that owns the DG node) so E-DG-002 does not false-fire on a
          // compound consumed only through a member `<field/>` (SPEC §6.3.5).
          typeof rbtTag === "string" &&
          rbtTag.length > 0 &&
          /^[a-z]/.test(rbtTag) &&
          compoundMemberToParent.has(rbtTag)
        ) {
          const parentName = compoundMemberToParent.get(rbtTag)!;
          if (reactiveVarNodeIds.has(parentName)) {
            creditReader(parentName);
            if (markupContextEmitEdges && node.span) {
              emitMarkupReadEdge(node.span, parentName);
            }
          }
        }
        const attrs = (node as Record<string, unknown>).attrs;
        if (Array.isArray(attrs)) {
          for (const attr of attrs) {
            if (attr && typeof attr === "object") {
              const attrVal = (attr as Record<string, unknown>).value;
              if (typeof attrVal === "string") {
                const atRefs = attrVal.match(/@([A-Za-z_$][A-Za-z0-9_$]*)/g);
                if (atRefs) {
                  for (const ref of atRefs) {
                    creditReader(ref.slice(1));
                  }
                }
              } else if (attrVal && typeof attrVal === "object") {
                const valObj = attrVal as Record<string, unknown>;
                // e.g. bind:value={ kind: "variable-ref", name: "@country" }
                // Also handles attr=@x simple variable-ref attribute.
                // A-1.3 Shapes 2 + 3: variable-ref attr + bind:value=@x.
                const varRefName = valObj.name;
                if (typeof varRefName === "string" && varRefName.startsWith("@")) {
                  const vrName = varRefName.slice(1);
                  creditReader(vrName);
                  // Emit markup-read node + reads edge for this variable-ref attribute site.
                  if (markupContextEmitEdges) {
                    const attrSpan = (attr as Record<string, unknown>).span as Span | undefined;
                    emitMarkupReadEdge(attrSpan ?? node.span, vrName);
                  }
                }
                // Expression-valued attributes (e.g. `if=(@a && @b == false)`)
                // are stored as `{ kind: "expr", raw, refs, exprNode }`. The AST
                // builder already collects reactive refs into `refs`; fall back
                // to scanning `raw` for the compound case if `refs` is missing.
                // A-1.3 Shape 4 — if=@x / if=(expr) condition attribute.
                // valObj.refs is pre-populated by the AST builder; valObj.raw is the
                // fallback. Emit one markup-read node per reactive var in the expr.
                if (Array.isArray(valObj.refs)) {
                  for (const ref of valObj.refs) {
                    if (typeof ref === "string") {
                      creditReader(ref);
                      if (markupContextEmitEdges) {
                        const attrSpan = (attr as Record<string, unknown>).span as Span | undefined;
                        emitMarkupReadEdge(attrSpan ?? node.span, ref);
                      }
                    }
                  }
                } else if (typeof valObj.raw === "string") {
                  const rawRefs = (valObj.raw as string).match(/@([A-Za-z_$][A-Za-z0-9_$]*)/g);
                  if (rawRefs) {
                    for (const r of rawRefs) {
                      const rName = r.slice(1);
                      creditReader(rName);
                      if (markupContextEmitEdges) {
                        const attrSpan = (attr as Record<string, unknown>).span as Span | undefined;
                        emitMarkupReadEdge(attrSpan ?? node.span, rName);
                      }
                    }
                  }
                }
                // Bug 4.5 / S87 — call-ref attribute values
                // (`<button onclick=fn(@var)>`) are stored as
                //   `{ kind: "call-ref", name: "fn", args: ["@var", ...],
                //      argExprNodes?: [ExprNode, ...] }`
                // (see ast-builder.js parseAttributes ATTR_CALL branch, line 1239).
                // Pre-fix: only the `variable-ref` / `expr` / raw-string branches
                // above were considered, so `@var` inside a call-ref arg never
                // reached `creditReader`. If `@var` had no other reader, E-DG-002
                // false-fired on it. (W-DEAD-FUNCTION on the called function is
                // already correctly handled by route-inference.ts:2087-2100, which
                // walks call-ref `name` + `args` + `argExprNodes` for the markup-
                // referenced-names set.)
                //
                // Symmetric to Bug 4 (commit cee4469) which extended the
                // route-inference walkMarkupContext walker to recurse into
                // string-typed nested expression fields. This is the SIBLING
                // fix on the dependency-graph "has-readers" walker.
                if (valObj.kind === "call-ref") {
                  // ExprNode-first walk for `@var` references (preferred —
                  // robust against nested member-access like `@compound.field`,
                  // unary/binary operators, conditional expressions, etc.).
                  // A-1.4 Shape 1 — call-ref attr @var args emit markup-read edges.
                  // `onclick=fn(@x)` — @x is read at the event-wiring call site.
                  // Emit one markup-read node + reads edge per @var found in the args.
                  const callRefAttrSpan = (attr as Record<string, unknown>).span as Span | undefined;
                  if (Array.isArray(valObj.argExprNodes)) {
                    for (const en of valObj.argExprNodes) {
                      if (en && typeof en === "object" && (en as { kind?: string }).kind) {
                        forEachIdentInExprNode(en as ExprNode, (ident) => {
                          if (ident.name.startsWith("@")) {
                            const crVarName = ident.name.slice(1);
                            creditReader(crVarName);
                            if (markupContextEmitEdges) emitMarkupReadEdge(callRefAttrSpan ?? node.span, crVarName);
                          }
                        });
                      }
                    }
                  }
                  // String-fallback for raw arg text — covers @var refs whose
                  // ExprNode parse failed (e.g. parse errors elsewhere) and
                  // duplicates the ExprNode walk for the simple-ident case
                  // (creditReader is idempotent on the per-var Set).
                  if (Array.isArray(valObj.args)) {
                    for (const arg of valObj.args) {
                      if (typeof arg === "string") {
                        const argRefs = arg.match(/@([A-Za-z_$][A-Za-z0-9_$]*)/g);
                        if (argRefs) {
                          for (const r of argRefs) {
                            const crVarName2 = r.slice(1);
                            creditReader(crVarName2);
                            if (markupContextEmitEdges) emitMarkupReadEdge(callRefAttrSpan ?? node.span, crVarName2);
                          }
                        }
                      }
                    }
                  }
                  // Credit transitive reactive reads from the called function
                  // body — `<button onclick=updateAll()>` should credit any
                  // reactive cell that `updateAll` (transitively) reads, same
                  // as the `extractCallees` path at line 1795-1803 above. The
                  // call-ref's `name` field is the bare callee identifier.
                  if (typeof valObj.name === "string" && valObj.name.length > 0) {
                    const transitiveReads = fnTransitiveReads.get(valObj.name);
                    if (transitiveReads) {
                      for (const varName of transitiveReads) {
                        creditReader(varName);
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
      // §51.0.D — an `<engine>` block's declaration position IS its rendered
      // output position; the block renders its variant arms based on the
      // engine's auto-declared cell (§51.0.C). The engine block is therefore
      // the structural reader of its own cell. Without this credit, an engine
      // whose cell is never explicitly referenced anywhere else
      // (e.g. `${@driverStatus}`, `@driverStatus.advance(...)`) false-fires
      // E-DG-002 — even though the cell IS consumed by the engine's own body
      // render (cf. Bug 3 — derived-engine projected vars; analogous case for
      // the bare engine-cell consumption pattern). Per `dependency-graph.ts`
      // engine-cell registration at line 1147-1154, the cell is registered as
      // a generic `reactive` DG node from `engineMeta.varName`; the engine's
      // structural read is invisible to the rest of the markup-sweep machinery.
      // S130 HU-1 iteration Landing 1 — each-block credits the @-cells
      // referenced in its in= / of= / key= opener attributes AND in its
      // bodyRaw fallback. Without this, an each-block over @contacts
      // (`<each in=@contacts>...</each>`) false-fires E-DG-002 on
      // @contacts because the structural read sits in an opener attr
      // that the generic markup-walk doesn't see (the body itself uses
      // the `as name` binding, not the cell sigil — and the `<each>`
      // node was BS-captured raw, so the opener attrs were never tokenized
      // by the normal attribute pipeline).
      if ((node as Record<string, unknown>).kind === "each-block") {
        const eachAny = node as Record<string, unknown>;
        // Scan opener-attr raw values for @cellName refs.
        for (const key of ["inExprRaw", "ofExprRaw", "keyExprRaw"]) {
          const raw = eachAny[key];
          if (typeof raw === "string" && raw.length > 0) {
            const atRefs = raw.match(/@([A-Za-z_$][A-Za-z0-9_$]*)/g);
            if (atRefs) {
              for (const ref of atRefs) {
                const cellName = ref.slice(1);
                // Skip `@.` contextual sigil (single dot, no ident).
                if (!cellName) continue;
                creditReader(cellName);
                if (markupContextEmitEdges && node.span) {
                  emitMarkupReadEdge(node.span, cellName);
                }
              }
            }
          }
        }
        // bodyRaw fallback — scan for direct @cell refs (the `as name`
        // override doesn't generate @-refs, but free `@cell` refs inside
        // the per-item template body do).
        const bodyRaw = eachAny.bodyRaw;
        if (typeof bodyRaw === "string" && bodyRaw.length > 0) {
          const atRefs = bodyRaw.match(/@([A-Za-z_$][A-Za-z0-9_$]*)/g);
          if (atRefs) {
            for (const ref of atRefs) {
              const cellName = ref.slice(1);
              if (!cellName) continue;
              creditReader(cellName);
              if (markupContextEmitEdges && node.span) {
                emitMarkupReadEdge(node.span, cellName);
              }
            }
          }
        }
        // Body walking continues via the generic markup-walk on
        // bodyChildren / templateChildren (handled by the outer recursion).
      }

      // E-DG-002 false-positive class (SB2) — block-form `<match on=@cell>`.
      // The markup match-block node is captured raw by the block-splitter
      // (NOT in the §4.15 markup-element table — see ast-builder.js line 173),
      // so it carries its match subject as a raw string on `onExprRaw`
      // (e.g. `@phase`, `@wrapper.phase`) rather than a walkable ExprNode.
      // The generic ExprNode markup-sweep above therefore never sees the
      // subject, and E-DG-002 false-fires on a cell consumed ONLY by a
      // block-form match dispatch. Structurally identical to the each-block
      // opener-attr credit above (inExprRaw/ofExprRaw/keyExprRaw): scan
      // `onExprRaw` for the subject cell, with `armsRaw` as the raw fallback
      // for @cell reads inside the arm bodies (the arms are raw-captured into
      // `bodyChildren` text, mirroring each-block's bodyRaw fallback).
      if ((node as Record<string, unknown>).kind === "match-block") {
        const matchAny = node as Record<string, unknown>;
        for (const key of ["onExprRaw", "armsRaw"]) {
          const raw = matchAny[key];
          if (typeof raw === "string" && raw.length > 0) {
            const atRefs = raw.match(/@([A-Za-z_$][A-Za-z0-9_$]*)/g);
            if (atRefs) {
              for (const ref of atRefs) {
                const cellName = ref.slice(1);
                // Skip `@.` contextual sigil (single dot, no ident).
                if (!cellName) continue;
                creditReader(cellName);
                if (markupContextEmitEdges && node.span) {
                  emitMarkupReadEdge(node.span, cellName);
                }
              }
            }
          }
        }
        // Arm body markup continues via the generic markup-walk on
        // bodyChildren (handled by the outer recursion).
      }

      if (node.kind === "engine-decl") {
        const eAny = node as Record<string, unknown>;
        const record = eAny._record as Record<string, unknown> | undefined;
        const engineMeta = record?.engineMeta as Record<string, unknown> | undefined;
        const varName = engineMeta?.varName;
        if (typeof varName === "string" && varName.length > 0) {
          // A-1.3 additive: sentinel credit preserved for E-DG-002.
          creditReader(varName);
          // A-1.5 Shape 3 — engine-cell self-read. The engine block structurally
          // reads its own cell (it renders variant arms based on the cell value).
          // Lift that structural read to a real markup-read edge so A-2's closure
          // analysis sees the engine as a consumer of its own cell.
          if (markupContextEmitEdges && node.span) {
            emitMarkupReadEdge(node.span, varName);
          }
        }
        // §51.0.E (S198 — Approach F A-leg) — `initial=@cell` runtime-cell
        // hydration READS the referenced cell at engine-construction. Credit it
        // as a reader so E-DG-002 ("declared but never consumed") does not
        // false-fire on a persisted-status cell whose only consumer is the
        // engine's hydration. Mirrors the engine self-read credit above.
        const initialCell = engineMeta?.initialCell;
        if (typeof initialCell === "string" && initialCell.length > 0) {
          creditReader(initialCell);
          if (markupContextEmitEdges && node.span) {
            emitMarkupReadEdge(node.span, initialCell);
          }
        }
        // §52 (S199 — the E-leg) — `server=@source` server-authoritative
        // hydration SUBSCRIBES to (reads) the source cell reactively. Credit the
        // ROOT cell of the dotted source path as a reader so E-DG-002 ("declared
        // but never consumed") does not false-fire on a server-owned source whose
        // only consumer is the engine's reactive hydration. Mirrors the A-leg
        // `initial=@cell` credit above; the root segment is the subscribed cell
        // (`@driver.current_status` -> `driver`).
        const serverSource = engineMeta?.serverSource;
        if (typeof serverSource === "string" && serverSource.length > 0) {
          const serverSourceRoot = serverSource.split(".")[0];
          if (serverSourceRoot && serverSourceRoot.length > 0) {
            creditReader(serverSourceRoot);
            if (markupContextEmitEdges && node.span) {
              emitMarkupReadEdge(node.span, serverSourceRoot);
            }
          }
        }
        // A-1.5 Shape 1 — engine state-child body raw text.
        // The engine body lives in engineMeta.stateChildren[i].bodyRaw (raw
        // text, not walkable AST — see engine-statechild-parser.ts, primer §13.7 B14).
        // Regex-scan each state-child's bodyRaw for @var refs and emit
        // markup-read edges for each reactive var found.
        const stateChildren = engineMeta?.stateChildren;
        if (Array.isArray(stateChildren)) {
          for (const sc of stateChildren as Array<Record<string, unknown>>) {
            const bodyRaw = sc.bodyRaw;
            if (typeof bodyRaw === "string" && bodyRaw.length > 0) {
              const atRefs = bodyRaw.match(/@([A-Za-z_$][A-Za-z0-9_$]*)/g);
              if (atRefs) {
                for (const ref of atRefs) {
                  const scVarName = ref.slice(1);
                  creditReader(scVarName);
                  if (markupContextEmitEdges && node.span) {
                    emitMarkupReadEdge(node.span, scVarName);
                  }
                }
              }
            }
            // A-1.5 Shape 2 — <onTransition> body. Each <onTransition> element
            // in the state-child may carry a bodyRaw with @var reads (e.g., a
            // logic-context effect statement that reads a reactive cell).
            const onTransitionElements = sc.onTransitionElements;
            if (Array.isArray(onTransitionElements)) {
              for (const ot of onTransitionElements as Array<Record<string, unknown>>) {
                const otBodyRaw = ot.bodyRaw;
                if (typeof otBodyRaw === "string" && otBodyRaw.length > 0) {
                  const otRefs = otBodyRaw.match(/@([A-Za-z_$][A-Za-z0-9_$]*)/g);
                  if (otRefs) {
                    for (const ref of otRefs) {
                      const otVarName = ref.slice(1);
                      creditReader(otVarName);
                      if (markupContextEmitEdges && node.span) {
                        emitMarkupReadEdge(node.span, otVarName);
                      }
                    }
                  }
                }
              }
            }
            // A-1.5 Shape 2b — <onTimeout> computed after= form. The after= value
            // may be a computed expression ${expr}<unit> (§51.12.3.1). Extract
            // any @var refs from the expression portion.
            const onTimeoutElements = sc.onTimeoutElements;
            if (Array.isArray(onTimeoutElements)) {
              for (const oto of onTimeoutElements as Array<Record<string, unknown>>) {
                const afterVal = oto.after;
                if (typeof afterVal === "string" && (afterVal as string).startsWith("${" )) {
                  const afterRefs = (afterVal as string).match(/@([A-Za-z_$][A-Za-z0-9_$]*)/g);
                  if (afterRefs) {
                    for (const ref of afterRefs) {
                      const afterVarName = ref.slice(1);
                      creditReader(afterVarName);
                      if (markupContextEmitEdges && node.span) {
                        emitMarkupReadEdge(node.span, afterVarName);
                      }
                    }
                  }
                }
              }
            }
          }
        }
        // A-1.5 Shape 2c — <onIdle> computed after= form. The engine-wide
        // idle watchdog after= may also use the computed ${expr}<unit> form.
        const idleWatchdog = engineMeta?.idleWatchdog as Record<string, unknown> | null | undefined;
        if (idleWatchdog && typeof idleWatchdog.after === "string" && (idleWatchdog.after as string).startsWith("${" )) {
          const idleRefs = (idleWatchdog.after as string).match(/@([A-Za-z_$][A-Za-z0-9_$]*)/g);
          if (idleRefs) {
            for (const ref of idleRefs) {
              const idleVarName = ref.slice(1);
              creditReader(idleVarName);
              if (markupContextEmitEdges && node.span) {
                emitMarkupReadEdge(node.span, idleVarName);
              }
            }
          }
        }
      }
      // Explicitly walk meta block bodies — ^{} blocks can contain @var reads
      // in their logic statements. Meta nodes have no children/consequent/alternate.
      if (isMetaKind(node.kind)) {
        const metaBody = (node as Record<string, unknown>).body;
        if (Array.isArray(metaBody)) {
          for (const child of metaBody as ASTNode[]) {
            const c = child as Record<string, unknown>;
            // BUG-META-6 fix: state-decl nodes inside runtime ^{} meta blocks
            // represent @var assignments (e.g. `@message = "changed"` is parsed as
            // state-decl with name="message"). The name field is not in exprFields
            // so sweepNodeForAtRefs misses it. Treat the name as an @var consumption.
            if (c.kind === "state-decl" && typeof c.name === "string") {
              creditReader(c.name as string);
            }
            // §2e: html-fragment children of a runtime ^{} meta body carry their
            // body text in `.content` as a single raw string (e.g.
            // `< p > @counter += 1 < / p >`). sweepNodeForAtRefs's exprFields
            // list does not include `content`, so @var references inside the
            // fragment's raw text get silently dropped. Regex-scan `content`
            // for @var patterns and credit each one.
            if (c.kind === "html-fragment" && typeof c.content === "string") {
              const contentRefs = (c.content as string).match(/@([A-Za-z_$][A-Za-z0-9_$]*)/g);
              if (contentRefs) {
                for (const ref of contentRefs) creditReader(ref.slice(1));
              }
            }
            sweepNodeForAtRefs(child);
          }
        }
        return;
      }
      // Walk lift-expr nodes — the .expr field is a LiftTarget union, not a
      // plain string, so the exprFields scan above won't reach it.
      if (node.kind === "lift-expr") {
        const target = (node as Record<string, unknown>).expr as
          | { kind: "expr"; expr: string; exprNode?: ExprNode }
          | { kind: "markup"; node: ASTNode }
          | undefined;
        if (target) {
          if (target.kind === "expr") {
            // Phase 4d: ExprNode-first, string fallback
            const liftRefs: string[] = [];
            if (target.exprNode) {
              forEachIdentInExprNode(target.exprNode, (ident) => {
                if (ident.name.startsWith("@")) liftRefs.push(ident.name.slice(1));
              });
            } else if (typeof target.expr === "string") {
              const atRefs = target.expr.match(/@([A-Za-z_$][A-Za-z0-9_$]*)/g);
              if (atRefs) for (const ref of atRefs) liftRefs.push(ref.slice(1));
            }
            for (const varName of liftRefs) {
              creditReader(varName);
              // A-1.4 Shape 3 — lift-expr body expression @var ref.
              // `lift @x` (non-markup lift target) inside markup context reads @x
              // to produce the lifted value. Emit a markup-read edge when inside
              // markup children (markupChildDepth > 0).
              if (markupContextEmitEdges && markupChildDepth > 0 && node.span) {
                emitMarkupReadEdge(node.span, varName);
              }
            }
          } else if (target.kind === "markup" && target.node) {
            // A-1.4 Shape 3 — lift-expr with markup body. Recurse into the lift
            // markup so its attrs + interpolations get edges via A-1.3 shapes 2/3
            // (variable-ref attrs) and shape 1 (bare-expr children).
            sweepNodeForAtRefs(target.node as ASTNode);
          }
        }
      }
      // Recurse into children/body/consequent/alternate.
      // When recursing into a markup node's children, increment markupChildDepth
      // so that bare-expr nodes encountered within emit markup-read edges (Shape 1).
      for (const listKey of ["children", "body", "consequent", "alternate"] as const) {
        const list = (node as Record<string, unknown>)[listKey];
        if (Array.isArray(list)) {
          const enteringMarkupChildren = node.kind === "markup" && listKey === "children";
          if (enteringMarkupChildren) markupChildDepth++;
          for (const child of list as ASTNode[]) {
            sweepNodeForAtRefs(child);
          }
          if (enteringMarkupChildren) markupChildDepth--;
        }
      }

      // P3.C — pop the renderOwnerStack entry pushed at function entry. Only
      // fires when push succeeded (gated on `pushedRenderOwner`). Early-return
      // paths above (meta case at line ~2686, return path) are reached only
      // when node.kind !== "markup", so the corresponding push never ran and
      // there is nothing to leak.
      if (pushedRenderOwner !== null) {
        renderOwnerStack.pop();
      }
    }

    // P2.2 — wrap the top-level sweep entry point. This captures gross
    // per-file recursion time (including all child sweepNodeForAtRefs calls).
    // The 3 collect* timings + creditReader / emitMarkupReadEdge timings
    // measured separately above attribute the cost INSIDE the recursion.
    if (debugPerf && markupSweepStats) {
      const sweepS = performance.now();
      for (const topNode of fileAST.nodes) {
        sweepNodeForAtRefs(topNode);
      }
      const sweepD = performance.now() - sweepS;
      const slot = markupSweepStats.sweepNodeForAtRefs;
      slot.total += sweepD;
      slot.q[_markupQBin] += sweepD;
    } else {
      for (const topNode of fileAST.nodes) {
        sweepNodeForAtRefs(topNode);
      }
    }
    _tPerFileEnd(_fileIdx4);
  }

  // P1.3 — cross-file block: E-DG-002 sweep + validator/derived/engine cycle
  // detection + lift-concurrent detection. All operate on accumulated maps.
  _tCrossStart();

  // E-DG-002: reactive variables with no readers
  for (const [varName, readers] of reactiveVarReaders) {
    if (readers.size === 0) {
      const reactiveNodeId = reactiveVarNodeIds.get(varName);
      if (reactiveNodeId) {
        const dgNode = nodes.get(reactiveNodeId);
        if (dgNode) {
          errors.push(
            new DGError(
              "E-DG-002",
              `E-DG-002: Reactive variable \`@${varName}\` is declared but never consumed ` +
                `in a render or logic context. Consider removing the unused variable, ` +
                `or prefix with \`_\` (e.g., \`@_${varName}\`) to suppress this warning.`,
              dgNode.span,
              "warning",
            ),
          );
        }
      }
    }
  }

  // ------------------------------------------------------------------
  // Phase A1b B10 (Phase 3) — Validator-arg dep edges + cycle detection
  // (E-VALIDATOR-CIRCULAR-DEP, SPEC §55.11, §31.4)
  //
  // For every state-decl with validators, walk validator-arg ExprNodes
  // (using B9's `forEachIdentInValidators` traversal) collecting `@cell`
  // references. Each ref emits a `validator-reads` edge from THIS cell to
  // the referenced cell. A cycle in this subgraph is the canonical
  // §55.11 case: `<a eq(@b)>` + `<b eq(@a)>`.
  //
  // FIRST consumer of B7's reusability promise: same generic `detectCycle`
  // DFS, distinct adjacency-builder (`buildValidatorArgsAdj`) filtering by
  // edge.kind === "validator-reads".
  // ------------------------------------------------------------------

  // Self-references in validator args (e.g., `<a eq(@a)>`) — degenerate
  // 1-cycle case; track separately so the diagnostic can identify the
  // self-cell explicitly. Per §55.11 the canonical example is the 2-cell
  // case but the self-case is a clear degenerate cycle.
  const selfReferencingValidatorNodes = new Set<NodeId>();

  // D-FORM-3 (§55.11) — compound-child validator cycle detection.
  //
  // Compound CHILD cells (`<signup><a eq(@signup.b)>...`) are NOT registered
  // as standalone reactive DG nodes — only the compound PARENT (`signup`) is
  // (see the Q1 collectors; `reactiveVarNodeIds` holds only `"signup"`). So
  // the global node-id path below builds NO edge for a cross-field ref that
  // member-accesses a sibling: `@signup.b` resolves to the qualified child
  // key `"signup.b"`, which has no node, AND the child decl's bare name
  // (`"a"`) has no `reactiveVarNodeIds` entry either — so `<a eq(@signup.b)>`
  // + `<b eq(@signup.a)>` (and the self form `<a eq(@signup.a)>`) compiled
  // clean, missing the §55.11 cycle.
  //
  // This self-contained qualified-name subgraph closes that gap: it keys
  // compound-child cells by their fully-qualified path (`signup.a`,
  // `signup.b`), resolves compound member-access refs via
  // `forEachQualifiedCellRefInValidators` (which yields `"signup.b"` for the
  // MemberExpr `@signup.b`), and runs the SAME generic `detectCycle` DFS. It
  // is deliberately kept separate from the global node-id path so top-level
  // (Shape-1) validator-cycle detection is byte-for-byte unchanged.
  const compoundValidatorAdj = new Map<string, Set<string>>();
  const compoundValidatorSelfRefs = new Set<string>();
  const compoundValidatorSpans = new Map<string, Span>();

  function emitValidatorArgEdgesForFile(fileAST: FileAST): void {
    // Walk the full AST collecting state-decls with validators. Compound
    // CHILDREN are visited too — validators commonly sit on Shape-2
    // children of compound parents (`<form><name req length(>=2)>...`).
    const decls: ReactiveDeclNode[] = [];
    function visit(list: ASTNode[]): void {
      for (const node of list) {
        if (node.kind === "logic" && Array.isArray((node as any).body)) {
          visit((node as any).body);
        }
        if (node.kind === "state-decl") {
          const validators = (node as any).validators;
          if (Array.isArray(validators) && validators.length > 0) {
            decls.push(node as ReactiveDeclNode);
          }
          const children = (node as any).children;
          if (Array.isArray(children)) {
            visit(children);
          }
        }
        if ("children" in node && Array.isArray((node as MarkupNode).children)) {
          visit((node as MarkupNode).children as ASTNode[]);
        }
      }
    }
    visit(fileAST.nodes);

    for (const decl of decls) {
      const fromNodeId = reactiveVarNodeIds.get(decl.name);
      if (!fromNodeId) continue;

      const validators = (decl as any).validators;
      if (!Array.isArray(validators)) continue;

      forEachIdentInValidators(validators, (ident) => {
        const name = (ident as any).name;
        if (typeof name !== "string" || !name.startsWith("@")) return;
        const targetVarName = name.slice(1);
        const toNodeId = reactiveVarNodeIds.get(targetVarName);
        if (!toNodeId) return;

        if (fromNodeId === toNodeId) {
          selfReferencingValidatorNodes.add(fromNodeId);
          return;
        }

        // S99 perf — O(1) edge-existence lookup via pushEdge (was O(E)
        // `edges.some(...)` scan inside this per-validator-ident loop).
        pushEdge(fromNodeId, toNodeId, "validator-reads");
      });
    }

    // D-FORM-3 — compound-child qualified-name subgraph. A dedicated walk
    // that tracks the compound-parent prefix so each validator-bearing child
    // gets its fully-qualified key. Separate from the flattened `decls` walk
    // above (which loses parent context) so the global path is untouched.
    function visitCompound(list: ASTNode[], prefix: string): void {
      for (const node of list) {
        if (node.kind === "logic" && Array.isArray((node as any).body)) {
          visitCompound((node as any).body, prefix);
          continue;
        }
        if (node.kind === "state-decl") {
          const name = (node as any).name;
          if (typeof name !== "string" || name.length === 0) continue;
          const qname = prefix ? `${prefix}.${name}` : name;
          const validators = (node as any).validators;

          // A compound CHILD is a validator-bearing state-decl reached under a
          // non-empty prefix. Only these participate in this subgraph; the
          // top-level (prefix-less) cells flow through the global path above.
          if (prefix && Array.isArray(validators) && validators.length > 0) {
            compoundValidatorSpans.set(qname, (node as any).span);
            forEachQualifiedCellRefInValidators(validators, (target) => {
              if (target === qname) {
                compoundValidatorSelfRefs.add(qname);
                return;
              }
              let set = compoundValidatorAdj.get(qname);
              if (!set) { set = new Set<string>(); compoundValidatorAdj.set(qname, set); }
              set.add(target);
            });
          }

          // Recurse into child STATE-DECLs (compound members) with this node's
          // qname as the new prefix. Non-state-decl children (the `= <input/>`
          // markup binding) carry no qualified cells, so they are skipped —
          // qualification only deepens through the compound-cell tree.
          const children = (node as any).children;
          if (Array.isArray(children)) {
            for (const child of children) {
              if (child && (child as ASTNode).kind === "state-decl") {
                visitCompound([child as ASTNode], qname);
              }
            }
          }
          continue;
        }
        if ("children" in node && Array.isArray((node as MarkupNode).children)) {
          // Markup container — descend without deepening the qualified prefix.
          visitCompound((node as MarkupNode).children as ASTNode[], prefix);
        }
      }
    }
    visitCompound(fileAST.nodes, "");
  }

  // P1.3 — pause cross-file timing for per-file loop #5 (validator-arg edge emission).
  _tCrossEnd();
  for (let _fileIdx5 = 0; _fileIdx5 < files.length; _fileIdx5++) {
    const rawFile = files[_fileIdx5];
    _tPerFileStart();
    const fileAST = resolveFileAST(rawFile);
    if (!fileAST) { _tPerFileEnd(_fileIdx5); continue; }
    emitValidatorArgEdgesForFile(fileAST);
    _tPerFileEnd(_fileIdx5);
  }
  // P1.3 — resume cross-file timing for cycle detection + lift-concurrent detection.
  _tCrossStart();

  // ------------------------------------------------------------------
  // Phase A1b B7 — Cycle detection in derived-cell `reads` subgraph
  // (E-DERIVED-CIRCULAR-DEP, SPEC §6.6.10, §31.5)
  //
  // A derived cell whose RHS depends on itself directly (self-reference)
  // or transitively (multi-hop cycle through other derived cells, or
  // through reactive-`function` calls per §31.5) is an error.
  //
  // Pure `fn` calls do NOT contribute to dep edges (handled upstream in
  // the propagation step), so cycles through pure functions cannot form.
  //
  // Reusability — the same DFS (`detectCycle`) and adjacency-builder
  // pattern (`buildDerivedReadsAdj`) is reused by:
  //   • B10 (validator-arg deps, §55.11) — implemented above this section
  //   • B16 (engine-derived, E-DERIVED-ENGINE-CIRCULAR, §51.0.J)
  // ------------------------------------------------------------------

  const allNodeIds = new Set<NodeId>(nodes.keys());

  // ------------------------------------------------------------------
  // Phase A1b B10 (Phase 3) — Cycle detection in validator-args subgraph
  // (E-VALIDATOR-CIRCULAR-DEP, SPEC §55.11, §31.4, §34)
  //
  // Runs BEFORE derived-cell cycle detection because a validator-cycle is
  // a distinct error class — devs need clear "your validators reference
  // each other circularly" messaging, not "your derived cells".
  // ------------------------------------------------------------------

  // Self-references: degenerate 1-cycle case (`<a eq(@a)>`).
  for (const selfNodeId of selfReferencingValidatorNodes) {
    const dgNode = nodes.get(selfNodeId);
    if (!dgNode || dgNode.kind !== "reactive") continue;
    errors.push(
      new DGError(
        "E-VALIDATOR-CIRCULAR-DEP",
        `E-VALIDATOR-CIRCULAR-DEP: Validator on \`@${dgNode.varName}\` ` +
          `references the cell itself via cross-field predicate args ` +
          `(e.g., \`<${dgNode.varName} eq(@${dgNode.varName})>\`). ` +
          `Validator predicate args form a DAG; self-references are ` +
          `forbidden (SPEC §55.11). Break the self-reference.`,
        dgNode.span,
      ),
    );
  }

  // Multi-node cycles in the validator-args subgraph.
  const validatorArgsAdj = buildValidatorArgsAdj(edges, nodes);
  const validatorCycle = detectCycle(validatorArgsAdj, allNodeIds);
  if (validatorCycle) {
    const varChain = validatorCycle
      .map((nid) => {
        const n = nodes.get(nid);
        return n && n.kind === "reactive" ? `@${n.varName}` : nid;
      })
      .join(" -> ");
    const firstReactive = nodes.get(validatorCycle[0]);
    errors.push(
      new DGError(
        "E-VALIDATOR-CIRCULAR-DEP",
        `E-VALIDATOR-CIRCULAR-DEP: Circular dependency detected among ` +
          `validator predicate args: ${varChain}. ` +
          `Each cell's validator references a cell whose validator eventually ` +
          `references back to the first — break the cycle (SPEC §55.11).`,
        firstReactive
          ? firstReactive.span
          : { file: "", start: 0, end: 0, line: 1, col: 1 },
      ),
    );
  }

  // D-FORM-3 — compound-child validator cycle detection (§55.11). Same
  // diagnostics as the top-level path above, but over the qualified-name
  // subgraph (`signup.a`, `signup.b`) that the global node-id path cannot
  // reach (compound children have no standalone reactive DG nodes).
  for (const selfQName of compoundValidatorSelfRefs) {
    errors.push(
      new DGError(
        "E-VALIDATOR-CIRCULAR-DEP",
        `E-VALIDATOR-CIRCULAR-DEP: Validator on \`@${selfQName}\` ` +
          `references the cell itself via cross-field predicate args ` +
          `(e.g., \`<${selfQName.split(".").pop()} eq(@${selfQName})>\`). ` +
          `Validator predicate args form a DAG; self-references are ` +
          `forbidden (SPEC §55.11). Break the self-reference.`,
        compoundValidatorSpans.get(selfQName) ??
          { file: "", start: 0, end: 0, line: 1, col: 1 },
      ),
    );
  }

  const compoundValidatorNodeIds = new Set<string>();
  for (const q of compoundValidatorAdj.keys()) compoundValidatorNodeIds.add(q);
  for (const targets of compoundValidatorAdj.values()) {
    for (const t of targets) compoundValidatorNodeIds.add(t);
  }
  const compoundValidatorCycle = detectCycle(compoundValidatorAdj, compoundValidatorNodeIds);
  if (compoundValidatorCycle) {
    const chain = compoundValidatorCycle.map((q) => `@${q}`).join(" -> ");
    errors.push(
      new DGError(
        "E-VALIDATOR-CIRCULAR-DEP",
        `E-VALIDATOR-CIRCULAR-DEP: Circular dependency detected among ` +
          `validator predicate args: ${chain}. ` +
          `Each cell's validator references a cell whose validator eventually ` +
          `references back to the first — break the cycle (SPEC §55.11).`,
        compoundValidatorSpans.get(compoundValidatorCycle[0]) ??
          { file: "", start: 0, end: 0, line: 1, col: 1 },
      ),
    );
  }

  // E-VALIDATOR-CIRCULAR-DEP: per §55.11 line 24631, "the validator-dep
  // graph is a DAG; cycles are forbidden". Like E-DERIVED-CIRCULAR-DEP,
  // this is a hard error that should fail-fast before the derived-cycle
  // scan to give clean diagnostics.
  if (
    selfReferencingValidatorNodes.size > 0 ||
    validatorCycle ||
    compoundValidatorSelfRefs.size > 0 ||
    compoundValidatorCycle
  ) {
    return _finalizeDG();
  }

  // Self-references: degenerate 1-cycle case (SPEC §6.6.10 line 2712).
  for (const selfNodeId of selfReferencingDerivedNodes) {
    const dgNode = nodes.get(selfNodeId);
    if (!dgNode || dgNode.kind !== "reactive") continue;
    errors.push(
      new DGError(
        "E-DERIVED-CIRCULAR-DEP",
        `E-DERIVED-CIRCULAR-DEP: Derived reactive value \`@${dgNode.varName}\` ` +
          `references itself in its initializer. A derived cell cannot depend ` +
          `on its own value — this would form an infinite recompute loop. ` +
          `Break the self-reference.`,
        dgNode.span,
      ),
    );
  }

  // Multi-node cycles in the derived-reads subgraph.
  const derivedReadsAdj = buildDerivedReadsAdj(edges, nodes);
  const derivedCycle = detectCycle(derivedReadsAdj, allNodeIds);
  if (derivedCycle) {
    // Translate node IDs to var names for a readable diagnostic.
    const varChain = derivedCycle
      .map((nid) => {
        const n = nodes.get(nid);
        return n && n.kind === "reactive" ? `@${n.varName}` : nid;
      })
      .join(" -> ");
    const firstReactive = nodes.get(derivedCycle[0]);
    errors.push(
      new DGError(
        "E-DERIVED-CIRCULAR-DEP",
        `E-DERIVED-CIRCULAR-DEP: Circular dependency detected among derived ` +
          `reactive values: ${varChain}. Each derived cell's RHS depends on a ` +
          `cell whose RHS eventually depends back on the first — break the cycle.`,
        firstReactive
          ? firstReactive.span
          : { file: "", start: 0, end: 0, line: 1, col: 1 },
      ),
    );
  }

  // E-DERIVED-CIRCULAR-DEP blocks code generation (SPEC §6.6.10 line 2710).
  // Fail-fast if any derived cycle was found, mirroring E-DG-001 behaviour.
  if (selfReferencingDerivedNodes.size > 0 || derivedCycle) {
    return _finalizeDG();
  }

  // ------------------------------------------------------------------
  // Phase A1b B16 — Cycle detection in engine-derived subgraph
  // (E-DERIVED-ENGINE-CIRCULAR, SPEC §51.0.J line 20411, §31.5)
  //
  // A derived engine whose `derived=expr` depends on its own variant —
  // directly (self-reference) or transitively through a chain of derived
  // engines (A → B → C → A) — is a compile-time cycle. Per §31.5 line
  // 13711: "A derived engine whose `derived=expr` depends on the engine's
  // own variant is `E-DERIVED-ENGINE-CIRCULAR` (§34, also cross-ref
  // §51.0.J)."
  //
  // SECOND consumer of B7's reusability promise (B10 was first). Same
  // generic `detectCycle` DFS, distinct adjacency-builder
  // (`buildEngineDerivedAdj`) filtering by `edge.kind ===
  // "engine-derived-reads"`.
  //
  // Distinct from E-DERIVED-CIRCULAR-DEP (cells, §6.6.10) per §34 catalog
  // line 14253: "Distinct from `E-DERIVED-ENGINE-CIRCULAR` (§51.0.J) which
  // is the engine-form cycle."
  // ------------------------------------------------------------------

  // Self-references: degenerate 1-cycle case (`<engine for=T derived=@varname>`
  // where `varname` resolves to the engine's own auto-declared variable —
  // unrepresentable today since the parser requires `derived=@x` and the
  // auto-declared name and source are same-file scoped to different
  // identifiers; defensive handling for future ast-builder shapes).
  for (const selfNodeId of selfReferencingDerivedEngineNodes) {
    const dgNode = nodes.get(selfNodeId);
    if (!dgNode || dgNode.kind !== "reactive") continue;
    errors.push(
      new DGError(
        "E-DERIVED-ENGINE-CIRCULAR",
        `E-DERIVED-ENGINE-CIRCULAR: Derived engine \`@${dgNode.varName}\` ` +
          `references its own variant in its \`derived=\` expression. A derived ` +
          `engine cannot depend on its own value — this would form an infinite ` +
          `recompute loop (SPEC §51.0.J + §31.5). Break the self-reference by ` +
          `deriving from a different cell.`,
        dgNode.span,
      ),
    );
  }

  // Multi-node cycles in the engine-derived subgraph.
  const engineDerivedAdj = buildEngineDerivedAdj(edges, nodes);
  const engineCycle = detectCycle(engineDerivedAdj, allNodeIds);
  if (engineCycle) {
    const varChain = engineCycle
      .map((nid) => {
        const n = nodes.get(nid);
        return n && n.kind === "reactive" ? `@${n.varName}` : nid;
      })
      .join(" -> ");
    const firstReactive = nodes.get(engineCycle[0]);
    errors.push(
      new DGError(
        "E-DERIVED-ENGINE-CIRCULAR",
        `E-DERIVED-ENGINE-CIRCULAR: Circular dependency detected among ` +
          `derived engines: ${varChain}. Each derived engine's \`derived=\` ` +
          `expression depends on an engine whose own derivation eventually ` +
          `depends back on the first — break the cycle (SPEC §51.0.J + §31.5).`,
        firstReactive
          ? firstReactive.span
          : { file: "", start: 0, end: 0, line: 1, col: 1 },
      ),
    );
  }

  // E-DERIVED-ENGINE-CIRCULAR blocks code generation (per §51.0.J + §34).
  // Fail-fast mirrors E-DERIVED-CIRCULAR-DEP and E-VALIDATOR-CIRCULAR-DEP.
  if (selfReferencingDerivedEngineNodes.size > 0 || engineCycle) {
    return _finalizeDG();
  }

  // ------------------------------------------------------------------
  // Cycle detection in 'awaits' edges (E-DG-001)
  // ------------------------------------------------------------------

  const awaitsAdj = buildAwaitsAdj(edges);
  const cycle = detectCycle(awaitsAdj, allNodeIds);

  if (cycle) {
    const firstNode = nodes.get(cycle[0]);
    errors.push(
      new DGError(
        "E-DG-001",
        `E-DG-001: Cyclic dependency detected in 'awaits' edges. ` +
          `The following nodes form a cycle: ${cycle.join(" -> ")}. ` +
          `These async operations depend on each other in a circle, so none can start.`,
        firstNode
          ? firstNode.span
          : { file: "", start: 0, end: 0, line: 1, col: 1 },
      ),
    );

    // Fail-fast on E-DG-001
    return _finalizeDG();
  }

  // ------------------------------------------------------------------
  // Phase 2: Lift concurrent detection (E-LIFT-001)
  // ------------------------------------------------------------------

  for (const [, blockEntries] of logicBlockNodes) {
    // Collect all nodes in this block with hasLift: true
    const liftNodes: DGNode[] = [];
    for (const entry of blockEntries) {
      const dgNode = nodes.get(entry.nodeId);
      if (dgNode && dgNode.hasLift) {
        liftNodes.push(dgNode);
      }
    }

    if (liftNodes.length < 2) continue;

    // Check all pairs: if two lift-bearing nodes are not connected via 'awaits',
    // fire E-LIFT-001
    for (let i = 0; i < liftNodes.length; i++) {
      for (let j = i + 1; j < liftNodes.length; j++) {
        const p1 = liftNodes[i];
        const p2 = liftNodes[j];

        const p1ReachesP2 = isReachable(p1.nodeId, p2.nodeId, awaitsAdj);
        const p2ReachesP1 = isReachable(p2.nodeId, p1.nodeId, awaitsAdj);

        if (!p1ReachesP2 && !p2ReachesP1) {
          errors.push(
            new DGError(
              "E-LIFT-001",
              `E-LIFT-001: Two independent operations in the same logic block both have ` +
                `lift calls. Node \`${p1.nodeId}\` and node \`${p2.nodeId}\` have ` +
                `hasLift: true but no 'awaits' dependency between them. They would be ` +
                `parallelized by Promise.all, causing non-deterministic accumulator order. ` +
                `Restructure to separate parallel fetches from lift calls (see spec section 10.5.3).`,
              p1.span,
            ),
          );
        }
      }
    }
  }

  return _finalizeDG();
}
