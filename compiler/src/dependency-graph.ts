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
  ReactiveDerivedDeclNode,
  ExprNode,
} from "./types/ast.ts";
import { forEachIdentInExprNode, emitStringFromTree } from "./expression-parser.ts";

// ---------------------------------------------------------------------------
// DG-internal types (not in the shared AST, specific to Stage 7 output)
// ---------------------------------------------------------------------------

type NodeId = string;

type DGEdgeKind = "calls" | "reads" | "writes" | "renders" | "awaits" | "invalidates";
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

type DGNode =
  | FunctionDGNode
  | ReactiveDGNode
  | RenderDGNode
  | SqlQueryDGNode
  | ImportDGNode
  | MetaDGNode;

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
 * Collect all reactive-decl nodes from a file AST.
 */
function collectAllReactiveDecls(fileAST: FileAST): ReactiveDeclNode[] {
  const nodeList = fileAST.nodes;
  const result: ReactiveDeclNode[] = [];

  function visit(list: ASTNode[]): void {
    for (const node of list) {
      if (node.kind === "logic" && Array.isArray(node.body)) {
        for (const child of node.body) {
          if (child.kind === "state-decl") result.push(child);
        }
      }
      if (node.kind === "state-decl") result.push(node);
      if ("children" in node && Array.isArray((node as MarkupNode).children)) {
        visit((node as MarkupNode).children as ASTNode[]);
      }
    }
  }

  visit(nodeList);
  return result;
}

/**
 * Collect all reactive-derived-decl nodes from a file AST.
 * These are `const @var = expr` declarations.
 */
function collectAllReactiveDerivedDecls(fileAST: FileAST): ReactiveDerivedDeclNode[] {
  const nodeList = fileAST.nodes;
  const result: ReactiveDerivedDeclNode[] = [];

  function visit(list: ASTNode[]): void {
    for (const node of list) {
      if (node.kind === "logic" && Array.isArray(node.body)) {
        for (const child of node.body) {
          if (child.kind === "reactive-derived-decl") result.push(child as ReactiveDerivedDeclNode);
        }
      }
      if (node.kind === "reactive-derived-decl") result.push(node as ReactiveDerivedDeclNode);
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

    // Another operation node (function-decl, reactive-decl, reactive-derived-decl) stops the scan
    if (stmt.kind === "function-decl" || stmt.kind === "state-decl" || stmt.kind === "reactive-derived-decl") {
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
// Cycle detection for 'awaits' edges (DFS-based)
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
 * Detect cycles in 'awaits' edges using iterative DFS with coloring.
 * Returns the first cycle found as an array of nodeIds, or null.
 */
function detectAwaitsCycle(
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

    // Collect reactive-decl nodes
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

    // Collect reactive-derived-decl nodes (const @var = expr)
    // Also collect tilde-decl nodes whose init references @vars — these compile
    // to _scrml_derived_declare and are semantically equivalent to reactive-derived-decl.
    const derivedDecls = collectAllReactiveDerivedDecls(fileAST);
    const tildeDecls = collectAllTildeDecls(fileAST);
    for (const td of tildeDecls) {
      // Phase 4d: ExprNode-first — check initExpr for @-prefixed idents, string fallback
      const hasReactiveRef = (td as any).initExpr
        ? _exprNodeHasAtIdent((td as any).initExpr)
        : /@/.test(td.init ?? "");
      if (hasReactiveRef) {
        derivedDecls.push(td as unknown as ReactiveDerivedDeclNode);
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

  // Resolve pending derived reads and callees for reactive-derived-decl nodes
  for (const [nodeId, dgNode] of nodes) {
    if (dgNode.kind !== "reactive") continue;
    const anyNode = dgNode as any;

    if (anyNode._pendingDerivedReads) {
      for (const varName of anyNode._pendingDerivedReads) {
        if (varName === dgNode.varName) continue; // no self-edge
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

          // bare-expr / reactive-derived-decl: check for @varName references
          // Prefer ExprNode walk; fall back to string regex.
          if (bodyNode.kind === "bare-expr" || bodyNode.kind === "reactive-derived-decl") {
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

          // reactive-decl in function body = write
          if (bodyNode.kind === "state-decl" && bodyNode.name) {
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
      const transitiveReads = fnTransitiveReads.get(calledFnName);
      if (!transitiveReads) continue;
      for (const varName of transitiveReads) {
        if (varName === dgNode.varName) continue;
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
    const creditReader = (rawName: string): void => {
      const effective = projectedToSource.get(rawName) ?? rawName;
      const readers = reactiveVarReaders.get(effective);
      if (readers) readers.add(MARKUP_READER_SENTINEL);
    };

    function sweepNodeForAtRefs(node: ASTNode): void {
      // Phase 4d: ExprNode-first reactive ref + callee detection, string fallback
      const exprRefs = collectReactiveRefsFromExprNode(node as Record<string, unknown>);
      const exprCallees = collectCalleesFromExprNode(node as Record<string, unknown>);
      for (const varName of exprRefs) {
        creditReader(varName);
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
                creditReader(ref.slice(1));
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
                const varRefName = valObj.name;
                if (typeof varRefName === "string" && varRefName.startsWith("@")) {
                  creditReader(varRefName.slice(1));
                }
                // Expression-valued attributes (e.g. `if=(@a && @b == false)`)
                // are stored as `{ kind: "expr", raw, refs, exprNode }`. The AST
                // builder already collects reactive refs into `refs`; fall back
                // to scanning `raw` for the compound case if `refs` is missing.
                if (Array.isArray(valObj.refs)) {
                  for (const ref of valObj.refs) {
                    if (typeof ref === "string") creditReader(ref);
                  }
                } else if (typeof valObj.raw === "string") {
                  const rawRefs = (valObj.raw as string).match(/@([A-Za-z_$][A-Za-z0-9_$]*)/g);
                  if (rawRefs) {
                    for (const r of rawRefs) creditReader(r.slice(1));
                  }
                }
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
            // BUG-META-6 fix: reactive-decl nodes inside runtime ^{} meta blocks
            // represent @var assignments (e.g. `@message = "changed"` is parsed as
            // reactive-decl with name="message"). The name field is not in exprFields
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
            }
          } else if (target.kind === "markup" && target.node) {
            sweepNodeForAtRefs(target.node as ASTNode);
          }
        }
      }
      // Recurse into children/body/consequent/alternate
      for (const listKey of ["children", "body", "consequent", "alternate"] as const) {
        const list = (node as Record<string, unknown>)[listKey];
        if (Array.isArray(list)) {
          for (const child of list as ASTNode[]) {
            sweepNodeForAtRefs(child);
          }
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
  // Cycle detection in 'awaits' edges (E-DG-001)
  // ------------------------------------------------------------------

  const awaitsAdj = buildAwaitsAdj(edges);
  const allNodeIds = new Set<NodeId>(nodes.keys());
  const cycle = detectAwaitsCycle(awaitsAdj, allNodeIds);

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
