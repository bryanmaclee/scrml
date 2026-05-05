import { emitStringFromTree } from "../expression-parser.ts";

// ---------------------------------------------------------------------------
// Local AST type — loosely typed to match the plain-object AST produced by
// the TAB stage. Using `Record<string, unknown>` with a `kind` discriminant
// preserves runtime compatibility while enabling basic type checking.
// ---------------------------------------------------------------------------

/** A loosely-typed AST node as produced by the TAB / CE stages. */
interface Node {
  kind: string;
  children?: Node[];
  body?: Node[];
  /** Set by CE stage when a node was expanded from a component definition. */
  _expandedFrom?: string;
  /** Set by collect.ts for CSS-in-component scoping. */
  _componentScope?: string | null;
  /** Set by collect.ts for constructor-scoped CSS. */
  _constructorScoped?: boolean;
  rules?: CSSRule[];
  expr?: string;
  init?: string | unknown;
  [key: string]: unknown;
}

/** Minimal CSS rule shape used in collectCssVariableBridges. */
interface CSSRule {
  reactiveRefs?: CSSReactiveRef[];
  isExpression?: boolean;
}

/** A reactive reference inside a CSS value (e.g. `@spacing`). */
interface CSSReactiveRef {
  name: string;
  expr?: string | null;
}

/** A CSS variable bridge descriptor returned by collectCssVariableBridges. */
export interface CSSVariableBridge {
  varName: string;
  customProp: string;
  isExpression: boolean;
  expr: string | null;
  scoped: boolean;
  refs: CSSReactiveRef[];
}

/** A FileAST as produced by the pipeline (may wrap .ast.nodes or expose .nodes directly). */
interface FileAST {
  nodes?: Node[];
  ast?: { nodes: Node[] };
  [key: string]: unknown;
}

/** ProtectAnalysis shape (from PA stage). */
interface ProtectAnalysis {
  views?: Map<unknown, DBViews>;
}

interface DBViews {
  tables?: Map<unknown, TableView>;
}

interface TableView {
  protectedFields?: string[];
}

// ---------------------------------------------------------------------------
// Node access helper
// ---------------------------------------------------------------------------

/**
 * Get nodes from a FileAST (handles both direct .nodes and .ast.nodes).
 */
export function getNodes(fileAST: FileAST): Node[] {
  return fileAST.nodes ?? (fileAST.ast ? fileAST.ast.nodes : []);
}

// ---------------------------------------------------------------------------
// Markup node collection
// ---------------------------------------------------------------------------

/**
 * Collect all markup nodes from the AST.
 */
export function collectMarkupNodes(nodes: Node[]): Node[] {
  const result: Node[] = [];
  function visit(nodeList: Node[]): void {
    for (const node of nodeList) {
      if (!node || typeof node !== "object") continue;
      if (node.kind === "markup") result.push(node);
      if (Array.isArray(node.children)) visit(node.children);
    }
  }
  visit(nodes);
  return result;
}

// ---------------------------------------------------------------------------
// CSS block collection
// ---------------------------------------------------------------------------

/**
 * Collect all CSS inline blocks (#{}) and style blocks from the AST.
 *
 * Each collected block is tagged with `_componentScope: string | null`:
 *   - Non-null when the block lives inside a component expanded by CE
 *     (the nearest ancestor markup node with `_expandedFrom` set).
 *   - null for program-level CSS (not inside any component).
 *
 * The `_componentScope` value is the component name (e.g. "Card", "Button").
 * emit-css.js uses this to wrap component CSS in native CSS @scope blocks.
 */
export function collectCssBlocks(nodes: Node[]): { inlineBlocks: Node[]; styleBlocks: Node[] } {
  const inlineBlocks: Node[] = [];
  const styleBlocks: Node[] = [];

  /**
   * Visit a list of nodes, threading the nearest enclosing component name.
   */
  function visit(nodeList: Node[], componentScope: string | null): void {
    for (const node of nodeList) {
      if (!node || typeof node !== "object") continue;

      // When a node was expanded from a component definition, its subtree
      // belongs to that component. Use the innermost (nearest) _expandedFrom
      // so nested component expansions each get their own scope.
      const scope = node._expandedFrom ?? componentScope;

      if (node.kind === "css-inline") {
        inlineBlocks.push({ ...node, _componentScope: scope });
        continue;
      }
      if (node.kind === "style") {
        styleBlocks.push({ ...node, _componentScope: scope });
        continue;
      }
      if (Array.isArray(node.children)) visit(node.children, scope);
      if (node.kind === "logic" && Array.isArray(node.body)) {
        for (const child of node.body) {
          if (!child) continue;
          if (child.kind === "css-inline") {
            inlineBlocks.push({ ...child, _componentScope: scope });
          } else if (child.kind === "style") {
            styleBlocks.push({ ...child, _componentScope: scope });
          }
        }
      }
    }
  }

  visit(nodes, null);
  return { inlineBlocks, styleBlocks };
}

// ---------------------------------------------------------------------------
// Function node collection
// ---------------------------------------------------------------------------

/**
 * Collect all function-decl nodes from a file AST.
 */
export function collectFunctions(fileAST: FileAST): Node[] {
  const nodes = getNodes(fileAST);
  const result: Node[] = [];
  function visit(nodeList: Node[]): void {
    for (const node of nodeList) {
      if (!node || typeof node !== "object") continue;
      if (node.kind === "logic" && Array.isArray(node.body)) {
        for (const child of node.body) {
          if (child && (child.kind === "function-decl")) {
            result.push(child);
          }
        }
      }
      if (node.kind === "function-decl") {
        result.push(node);
      }
      if (Array.isArray(node.children)) visit(node.children);
    }
  }
  visit(nodes);
  return result;
}

// ---------------------------------------------------------------------------
// Top-level logic statement collection
// ---------------------------------------------------------------------------

/**
 * Collect all logic block bodies (bare-expr, let-decl, etc.) that are NOT
 * inside a function declaration — these are top-level imperative statements.
 *
 * Also collects top-level `meta` (^{}) nodes and meta nodes inside logic
 * bodies, so that runtime ^{} blocks at the file root are emitted as IIFEs
 * by emitLogicNode (SPEC §22.5).
 */
export function collectTopLevelLogicStatements(fileAST: FileAST): Node[] {
  const nodes = getNodes(fileAST);
  const result: Node[] = [];
  function visit(nodeList: Node[]): void {
    for (const node of nodeList) {
      if (!node || typeof node !== "object") continue;

      // Top-level `^{}` meta block — yield the whole meta node so emitLogicNode
      // can emit it as an IIFE (case "meta": handler in emit-logic.js).
      if (node.kind === "meta") {
        result.push(node);
        continue;
      }

      if (node.kind === "logic" && Array.isArray(node.body)) {
        for (const child of node.body) {
          if (!child) continue;
          if (child.kind === "function-decl") continue;
          // Propagate the placeholder ID from the logic wrapper so the client JS
          // emitter can target lift-exprs to the correct DOM position.
          if ((node as any)._placeholderId && !child._placeholderId) {
            child._placeholderId = (node as any)._placeholderId;
          }
          result.push(child);
        }
      }
      if (Array.isArray(node.children)) visit(node.children);
    }
  }
  visit(nodes);
  return result;
}

// ---------------------------------------------------------------------------
// Protected fields collection
// ---------------------------------------------------------------------------

/**
 * Collect all protected field names from ProtectAnalysis.
 */
export function collectProtectedFields(protectAnalysis: ProtectAnalysis | null | undefined): Set<string> {
  const fields = new Set<string>();
  if (!protectAnalysis || !protectAnalysis.views) return fields;
  for (const [, dbViews] of protectAnalysis.views) {
    if (dbViews.tables) {
      for (const [, tableView] of dbViews.tables) {
        if (tableView.protectedFields) {
          for (const f of tableView.protectedFields) {
            fields.add(f);
          }
        }
      }
    }
  }
  return fields;
}

// ---------------------------------------------------------------------------
// CSS variable bridge collection
// ---------------------------------------------------------------------------

/**
 * Collect all CSS variable bridge entries from CSS inline blocks.
 * Returns an array of { varName, customProp, isExpression, expr, scoped } descriptors.
 *
 * @param nodes — top-level AST nodes
 * @param isScoped — true when inside a constructor (scoped to element)
 */
export function collectCssVariableBridges(nodes: Node[], isScoped = false): CSSVariableBridge[] {
  const { inlineBlocks } = collectCssBlocks(nodes);
  const bridges: CSSVariableBridge[] = [];
  const seen = new Set<string>();

  for (const block of inlineBlocks) {
    const scoped = isScoped || (block._constructorScoped === true) || (block._componentScope != null);
    if (!block.rules || !Array.isArray(block.rules)) continue;

    for (const rule of block.rules as CSSRule[]) {
      if (!rule.reactiveRefs || rule.reactiveRefs.length === 0) continue;

      if (rule.isExpression) {
        // Expression: one custom property for the whole expression
        const exprPropName = `--scrml-expr-${rule.reactiveRefs.map((r: CSSReactiveRef) => r.name).join("-")}`;
        const key = `expr:${exprPropName}`;
        if (!seen.has(key)) {
          seen.add(key);
          bridges.push({
            varName: rule.reactiveRefs.map((r: CSSReactiveRef) => r.name).join(","),
            customProp: exprPropName,
            isExpression: true,
            expr: rule.reactiveRefs[0].expr ?? null,
            scoped,
            refs: rule.reactiveRefs,
          });
        }
      } else {
        // Simple @var reference(s)
        for (const ref of rule.reactiveRefs) {
          const customProp = `--scrml-${ref.name}`;
          const key = `var:${ref.name}`;
          if (!seen.has(key)) {
            seen.add(key);
            bridges.push({
              varName: ref.name,
              customProp,
              isExpression: false,
              expr: null,
              scoped,
              refs: [ref],
            });
          }
        }
      }
    }
  }

  return bridges;
}

// ---------------------------------------------------------------------------
// Server-only node detection
//
// These patterns identify AST node kinds and expression patterns that MUST NOT
// appear in client JS output. Used by emitReactiveWiring, emitFunctions, and
// scheduleStatements to filter nodes before calling emitLogicNode.
//
// Security invariant: no SQL, transaction, or server-context meta node may
// reach .client.js. Violation is E-CG-006.
// ---------------------------------------------------------------------------

/**
 * Server-only expression patterns for meta block detection.
 * If any expression in a meta block body matches these patterns, the block
 * is classified as server-context and must not be emitted to client JS.
 *
 * These mirror the SERVER_ONLY_PATTERNS in route-inference.js.
 */
const SERVER_CONTEXT_META_PATTERNS: RegExp[] = [
  /\bprocess\.env\b/,
  /\bBun\.env\b/,
  /\bbun\.eval\s*\(/,
  /\bBun\.file\s*\(/,
  /\bBun\.write\s*\(/,
  /\bBun\.spawn\s*\(/,
  /\bBun\.serve\s*\(/,
  /\bnew\s+Database\s*\(/,
  /\bfs\./,
  /(?<!public )\benv\s*\(/,
];

/**
 * Regex that matches the raw ?{} SQL sigil in an expression string.
 * This catches cases where a `let-decl` or `bare-expr` node contains an inline
 * SQL block as its init/expr value — e.g. `let users = ?{`SELECT ...`}`.
 * These are server-only regardless of whether they have a method call chained.
 */
const SQL_SIGIL_PATTERN = /\?\{`/;

// Pattern to detect secret env() calls (server-only unless public)
const ENV_PATTERN = /(?<!public )\benv\s*\(/;

/**
 * Walk a meta block body and extract all bare-expr and let/const init strings.
 */
function collectMetaExprStrings(body: Node[]): string[] {
  const exprs: string[] = [];
  function walk(nodes: unknown[]): void {
    if (!Array.isArray(nodes)) return;
    for (const node of nodes) {
      if (!node || typeof node !== "object") continue;
      const n = node as Node;
      // Phase 4d Step 8: ExprNode-first; runtime-only string fallback (bare-expr.expr TS field deleted)
      if (n.kind === "bare-expr") {
        if ((n as any).exprNode) exprs.push(emitStringFromTree((n as any).exprNode));
        else if (n.expr) exprs.push(n.expr as string);
      }
      if (n.kind === "let-decl" || n.kind === "const-decl") {
        if ((n as any).initExpr) exprs.push(emitStringFromTree((n as any).initExpr));
        else if (n.init) exprs.push(typeof n.init === "string" ? n.init : String(n.init));
      }
      if (Array.isArray(n.body)) walk(n.body);
      if (Array.isArray(n.children)) walk(n.children);
      if (Array.isArray((n as Record<string, unknown>)["consequent"])) walk((n as Record<string, unknown>)["consequent"] as unknown[]);
      if (Array.isArray((n as Record<string, unknown>)["alternate"])) walk((n as Record<string, unknown>)["alternate"] as unknown[]);
    }
  }
  walk(body);
  return exprs;
}

/**
 * Determine whether an AST node is server-only and must NOT be emitted to
 * client JavaScript output.
 *
 * Returns true for:
 *   - kind === "sql" — all SQL blocks are server-only
 *   - kind === "transaction-block" — all transaction blocks are server-only
 *   - kind === "meta" whose body contains server-context API patterns
 *     (process.env, Bun.env, bun.eval, Bun.file, fs.*, etc.)
 *   - kind === "let-decl" or "const-decl" whose init string contains ?{` SQL sigil
 *   - kind === "bare-expr" whose expr string contains ?{` SQL sigil
 *
 * The last two cases catch inline ?{} SQL blocks that appear as expression-level
 * SQL (e.g., `let users = ?{`SELECT ...`}` parsed as a let-decl with SQL init).
 * After rewriteSqlRefs transforms ?{...} to _scrml_sql_exec(...), these nodes
 * would produce `_scrml_sql_exec(...)` in client JS — a security violation.
 */
export function isServerOnlyNode(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;
  const n = node as Node;

  if (n.kind === "sql") return true;
  if (n.kind === "transaction-block") return true;

  if (n.kind === "meta") {
    const body = n.body;
    if (!Array.isArray(body) || body.length === 0) return false;
    const exprs = collectMetaExprStrings(body);
    return exprs.some(expr =>
      SERVER_CONTEXT_META_PATTERNS.some(pattern => pattern.test(expr))
    );
  }

  // Catch inline ?{} SQL sigil in let-decl / const-decl / reactive-decl init strings.
  // Phase 4d: ExprNode-first, string fallback
  if (n.kind === "let-decl" || n.kind === "const-decl" || n.kind === "state-decl") {
    const init = (n as any).initExpr ? emitStringFromTree((n as any).initExpr) : (typeof n.init === "string" ? n.init : "");
    if (SQL_SIGIL_PATTERN.test(init)) return true;
    if (ENV_PATTERN.test(init)) return true;
  }

  // Catch inline ?{} SQL sigil in bare-expr nodes.
  // Phase 4d Step 8: ExprNode-first; runtime-only string fallback (bare-expr.expr TS field deleted)
  if (n.kind === "bare-expr") {
    const expr = (n as any).exprNode ? emitStringFromTree((n as any).exprNode) : (typeof n.expr === "string" ? n.expr : "");
    if (SQL_SIGIL_PATTERN.test(expr)) return true;
    if (ENV_PATTERN.test(expr)) return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// §8.11 / §52.6 server @var declaration collector
// ---------------------------------------------------------------------------

/**
 * Walk the file AST and return all `server @var` reactive-decl nodes found inside
 * logic-block bodies. Shared by emit-reactive-wiring (client) and emit-server
 * (synthetic __mountHydrate route emission).
 */
export function collectServerVarDecls(fileAST: FileAST): Node[] {
  const nodes = getNodes(fileAST);
  const result: Node[] = [];
  function visit(list: Node[]): void {
    for (const node of list) {
      if (!node || typeof node !== "object") continue;
      if (node.kind === "logic" && Array.isArray(node.body)) {
        for (const child of node.body) {
          if (child && child.kind === "state-decl" && (child as any).isServer === true) {
            result.push(child);
          }
        }
      }
      if (Array.isArray(node.children)) visit(node.children);
    }
  }
  visit(nodes);
  return result;
}

/**
 * Return the subset of server @var decls whose initExpr is a callable (contains
 * a function-call `(` — the loader pattern). Non-callable placeholders (literal
 * initializers) are excluded per §52.6.1 / W-AUTH-001 and are not eligible for
 * mount-hydrate coalescing (§8.11.1).
 */
export function callableServerVarDecls(decls: Node[]): Node[] {
  return decls.filter((decl) => {
    const initExpr: string = (decl as any).initExpr
      ? emitStringFromTree((decl as any).initExpr)
      : (typeof (decl as any).init === "string" ? ((decl as any).init as string) : "");
    return !!initExpr && initExpr.includes("(");
  });
}
