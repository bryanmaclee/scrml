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
import { forEachIdentInExprNode, emitStringFromTree } from "./expression-parser.ts";
import { forEachIdentInValidators } from "./validator-arg-parser.ts";

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
 */
interface DGInput {
  files: unknown[];
  routeMap: RouteMap;
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
  }
  return refs;
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
 * up the same state-decl, this function EXCLUDES nodes that are the legacy
 * folded-derived form (shape:"derived" + structuralForm:false). Those flow
 * through `collectAllReactiveDerivedDecls` exclusively and get
 * `_pendingDerivedReads` populated for read-edge resolution.
 *
 * Shape 3 V5-strict (`const <x> = expr`, structuralForm:true) is INCLUDED
 * here — its codegen path (latent gap) treats it as a plain state-decl.
 */
function collectAllReactiveDecls(fileAST: FileAST): ReactiveDeclNode[] {
  const nodeList = fileAST.nodes;
  const result: ReactiveDeclNode[] = [];

  function isFoldedDerived(n: ASTNode): boolean {
    if (n.kind !== "state-decl") return false;
    const sd = n as Record<string, unknown>;
    return sd.shape === "derived" && sd.structuralForm === false;
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
 * `shape === "derived"` AND `structuralForm === false` (the legacy
 * `@`-form). The function name is preserved for blame-traceability across
 * the rename.
 *
 * Note: Shape 3 V5-strict (`const <x> = expr`, structuralForm:true) is
 * NOT collected — its codegen path (latent gap) is left untouched per
 * BRIEF §2.2. The plain state-decl loop in `nodes.set` covers it.
 */
function collectAllReactiveDerivedDecls(fileAST: FileAST): ReactiveDeclNode[] {
  const nodeList = fileAST.nodes;
  const result: ReactiveDeclNode[] = [];

  function isLegacyDerivedFold(n: ASTNode): boolean {
    if (n.kind !== "state-decl") return false;
    const sd = n as Record<string, unknown>;
    return sd.shape === "derived" && sd.structuralForm === false;
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
 * Collect all meta blocks from a file AST.
 */
function collectAllMetaBlocks(fileAST: FileAST): MetaNode[] {
  const nodeList = fileAST.nodes;
  const result: MetaNode[] = [];

  function visit(list: ASTNode[]): void {
    for (const node of list) {
      if (node.kind === "meta") result.push(node);
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

  _nodeCounter = 0;

  const nodes = new Map<NodeId, DGNode>();
  const edges: DGEdge[] = [];
  const errors: DGError[] = [];

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
  // Build function name -> boundary mapping from RouteMap
  const functionNameToBoundary = new Map<string, Boundary>();

  // ------------------------------------------------------------------
  // Phase 1: Graph construction
  // ------------------------------------------------------------------

  // Track which logic blocks contain which DGNode IDs (for Phase 2 lift checker)
  // Map<logicBlockId, Array<{ nodeId: string, bodyIndex: number }>>
  const logicBlockNodes = new Map<string, Array<{ nodeId: NodeId; bodyIndex: number }>>();

  for (const rawFile of files) {
    const fileAST = resolveFileAST(rawFile);
    if (!fileAST) continue;

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
        // Future: when `derivedExpr` becomes a parsed ExprNode, walk it
        // here with `forEachIdentInExprNode` to collect upstream `@cell`
        // reads.
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
  }

  // ------------------------------------------------------------------
  // Resolve pending callees into edges
  // ------------------------------------------------------------------

  for (const [nodeId, dgNode] of nodes) {
    if (dgNode.kind !== "function" || !dgNode._pendingCallees) continue;

    for (const calleeName of dgNode._pendingCallees) {
      const calleeNodeId = functionNameToNodeId.get(calleeName);
      if (!calleeNodeId) continue;

      const boundary = functionNameToBoundary.get(calleeName) ?? "client";
      const edgeKind: DGEdgeKind = boundary === "server" ? "awaits" : "calls";

      edges.push({
        from: nodeId,
        to: calleeNodeId,
        kind: edgeKind,
      });
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
          edges.push({ from: nodeId, to: targetNodeId, kind: "reads" });
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
          edges.push({ from: nodeId, to: calleeNodeId, kind: edgeKind });
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
        edges.push({ from: nodeId, to: targetNodeId, kind: "engine-derived-reads" });
        const readers = reactiveVarReaders.get(upstreamVarName);
        if (readers) readers.add(nodeId);
      }
      // If the upstream var is unknown, silently skip (downstream typer
      // surfaces unresolved-name errors; B16 doesn't double-fire here).
    }
    delete anyNode._pendingEngineDerivedReads;
  }

  // Scan function bodies for reactive variable references
  for (const rawFile of files) {
    const fileAST = resolveFileAST(rawFile);
    if (!fileAST) continue;

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
                edges.push({ from: fnDGNodeId, to: reactiveNodeId, kind: "reads" });
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
              edges.push({ from: fnDGNodeId, to: reactiveNodeId, kind: "writes" });
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
                edges.push({ from: fnDGNodeId, to: reactiveNodeId, kind: "reads" });
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
                edges.push({ from: fnDGNodeId, to: reactiveNodeId, kind: "reads" });
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

  for (const rawFile of files) {
    const fileAST = resolveFileAST(rawFile);
    if (!fileAST) continue;

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
  }

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
              const exists = edges.some(
                e => e.from === callerNodeId && e.to === reactiveNodeId && e.kind === "reads"
              );
              if (!exists) {
                edges.push({ from: callerNodeId, to: reactiveNodeId, kind: "reads" });
              }
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
  for (const [nodeId, dgNode] of nodes) {
    if (dgNode.kind !== "reactive") continue;
    const callEdges = edges.filter(e => e.from === nodeId && (e.kind === "calls" || e.kind === "awaits"));
    for (const callEdge of callEdges) {
      const calledNode = nodes.get(callEdge.to);
      if (!calledNode || calledNode.kind !== "function") continue;
      let calledFnName: string | null = null;
      for (const [fnName, fnNodeId] of functionNameToNodeId) {
        if (fnNodeId === callEdge.to) { calledFnName = fnName; break; }
      }
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
        const exists = edges.some(
          e => e.from === nodeId && e.to === reactiveNodeId && e.kind === "reads"
        );
        if (!exists) {
          edges.push({ from: nodeId, to: reactiveNodeId, kind: "reads" });
          const readers = reactiveVarReaders.get(varName);
          if (readers) readers.add(nodeId);
        }
      }
    }
  }

  // Scan ALL AST nodes (markup, attributes, top-level logic) for @var references
  // not captured by the function-body scan above. Markup interpolations like ${@var}
  // are the primary case — they consume reactive variables but don't go through
  // function DG nodes. Any @var read anywhere outside a function still satisfies
  // the "has readers" check for E-DG-002 purposes.
  const MARKUP_READER_SENTINEL = "__markup__";
  for (const rawFile of files) {
    const fileAST = resolveFileAST(rawFile);
    if (!fileAST) continue;

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
    const creditReader = (rawName: string): void => {
      const readers = reactiveVarReaders.get(rawName);
      if (readers) readers.add(MARKUP_READER_SENTINEL);
      const upstream = projectedToSource.get(rawName);
      if (upstream && upstream !== rawName) {
        const upstreamReaders = reactiveVarReaders.get(upstream);
        if (upstreamReaders) upstreamReaders.add(MARKUP_READER_SENTINEL);
      }
    };

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

    // Helper: push one MarkupReadDGNode + one reads edge for a reactive var read
    // discovered at a markup-context site. Called from the 4 high-frequency shapes
    // below. attrSpan is the span of the interpolation or attribute site.
    function emitMarkupReadEdge(attrSpan: Span, varName: string): void {
      const reactiveNodeId = reactiveVarNodeIds.get(varName);
      if (!reactiveNodeId) return; // var not in DG — nothing to link to
      const sourceRenderNodeId = findOwningRenderDGNode({ span: attrSpan } as ASTNode, nodes);
      const { nodeId: mrNodeId, dgNode: mrDGNode } = createMarkupReadNode(
        attrSpan,
        sourceRenderNodeId,
        fileAST.filePath,
      );
      nodes.set(mrNodeId, mrDGNode);
      edges.push({ from: mrNodeId, to: reactiveNodeId, kind: "reads" });
    }

    function sweepNodeForAtRefs(node: ASTNode): void {
      // Phase 4d: ExprNode-first reactive ref + callee detection, string fallback
      const exprRefs = collectReactiveRefsFromExprNode(node as Record<string, unknown>);
      const exprCallees = collectCalleesFromExprNode(node as Record<string, unknown>);
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
      const metaExprRefs = collectMetaVarRefsFromExprNode(node as Record<string, unknown>);
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
      if (node.kind === "meta") {
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
    }

    for (const topNode of fileAST.nodes) {
      sweepNodeForAtRefs(topNode);
    }
  }

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

        const exists = edges.some(
          (e) => e.from === fromNodeId && e.to === toNodeId
            && e.kind === "validator-reads",
        );
        if (!exists) {
          edges.push({ from: fromNodeId, to: toNodeId, kind: "validator-reads" });
        }
      });
    }
  }

  for (const rawFile of files) {
    const fileAST = resolveFileAST(rawFile);
    if (!fileAST) continue;
    emitValidatorArgEdgesForFile(fileAST);
  }

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

  // E-VALIDATOR-CIRCULAR-DEP: per §55.11 line 24631, "the validator-dep
  // graph is a DAG; cycles are forbidden". Like E-DERIVED-CIRCULAR-DEP,
  // this is a hard error that should fail-fast before the derived-cycle
  // scan to give clean diagnostics.
  if (selfReferencingValidatorNodes.size > 0 || validatorCycle) {
    return { depGraph: { nodes, edges }, errors };
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
    return { depGraph: { nodes, edges }, errors };
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
    return { depGraph: { nodes, edges }, errors };
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
    return { depGraph: { nodes, edges }, errors };
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

  return { depGraph: { nodes, edges }, errors };
}
