import { emitStringFromTree } from "../expression-parser.ts";
// F8 / v0.6 — dual-mode meta-block kind test (live `"meta"` / native `"Meta"`).
import { isMetaKind } from "../types/ast.ts";

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
      if (isMetaKind(node.kind)) {
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
          // S108 Bug 5 Phase 3 — Propagate the constant-folded marker from the
          // logic wrapper (set by emit-html.ts when an interpolation folds to a
          // compile-time literal). emit-reactive-wiring.ts's file-scope walker
          // (Anomaly B skip clause) consumes this marker to skip emitting the
          // orphan bare-expr at file scope — the value has already been inlined
          // into the HTML at the interpolation site by emit-html.ts.
          if ((node as any)._constantFolded && !(child as any)._constantFolded) {
            (child as any)._constantFolded = true;
          }
          // inline-value-form-interp (§18.0 / §17.6) — propagate the value-form
          // control-flow marker (set by emit-html.ts when a `${ match … }` /
          // `${ if … }` whose sole content is a value-producing control-flow
          // construct is rendered via a `value-control-flow` logic-binding). The
          // emit-reactive-wiring file-scope walker consumes it to skip re-emitting
          // the control-flow body as a value-discarding file-scope statement.
          if ((node as any)._valueControlFlowRendered && !(child as any)._valueControlFlowRendered) {
            (child as any)._valueControlFlowRendered = true;
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
 * M6.5.b.4 (SECONDARY, defense-in-depth) — does this ExprNode tree contain a
 * `sql-ref` node ANYWHERE within it? A `sql-ref` is a reference to a server-
 * only `?{}` SQL block (§8 — SQL contexts are server-only); its presence in a
 * `bare-expr` means the statement is server-only regardless of how
 * `emitStringFromTree` round-trips it (the round-trip emits a comment
 * placeholder for the sql-ref, which the `SQL_SIGIL_PATTERN` backtick-anchored
 * test never matches — the gap the M6.7-STOP leak rode through).
 *
 * The PRIMARY fix (translate-stmt.js) promotes a BARE `?{}` statement to
 * `kind:"sql"` (caught at the top of isServerOnlyNode). This scanner closes the
 * RESIDUAL leak CLASS: a `sql-ref` nested inside a CHAINED form
 * (`?{...}.get()` -> `call -> member.object -> sql-ref`) or any other
 * non-promoted `bare-expr` position. It is ADDITIVE — it can only classify
 * MORE nodes as server-only, which is strictly safer for the leak (a false
 * positive would over-suppress a client expression, but a `sql-ref` is by
 * definition server-only, so there is no legitimate client-side `sql-ref`).
 *
 * Bounded recursion over the known ExprNode child-bearing fields; depth is the
 * expression nesting depth (small in practice). Defensive against cycles via a
 * visited set is unnecessary — the AST is a tree.
 */
function exprTreeContainsSqlRef(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;
  const n = node as Record<string, unknown>;
  if (n.kind === "sql-ref") return true;
  for (const key of Object.keys(n)) {
    const v = n[key];
    if (Array.isArray(v)) {
      for (const item of v) {
        if (exprTreeContainsSqlRef(item)) return true;
      }
    } else if (v && typeof v === "object") {
      if (exprTreeContainsSqlRef(v)) return true;
    }
  }
  return false;
}

/**
 * W5b (g-library-mode-sql-no-db-context) — deep structural scan for a `?{}` SQL
 * node (`sql` / `sql-ref`) or a `transaction-block` ANYWHERE beneath `node`.
 *
 * Unlike `isServerOnlyNode` (a single-node classifier that inspects a statement
 * in isolation and, for the chained `const r = ?{...}.get()` form, relies on an
 * `emitStringFromTree` round-trip that yields a comment placeholder instead of
 * the `?{` sigil), this walks the full node tree by node KIND, so it catches a
 * `?{}` nested in a const/let init or a return-expr. Used by:
 *   - the §12.6 library-mode discriminator (emit-server.ts) to retain a
 *     `?{}`-bearing fn's route-handler wrapper (its server home);
 *   - the library `.js` emitter (emit-library.ts) to prune a `?{}`-bearing fn
 *     from the client-facing artifact (a raw `?{}` there is invalid JS, §2.2.1).
 * `span` is skipped to keep the walk on structural fields only.
 */
export function containsSqlOrTransaction(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;
  if (Array.isArray(node)) return node.some((child) => containsSqlOrTransaction(child));
  const n = node as Record<string, unknown>;
  const k = n.kind;
  if (k === "sql" || k === "sql-ref" || k === "transaction-block") return true;
  for (const key of Object.keys(n)) {
    if (key === "span") continue;
    const v = n[key];
    if (v && typeof v === "object" && containsSqlOrTransaction(v)) return true;
  }
  return false;
}

/**
 * W5b (S239) — the SQL-ONLY sibling of `containsSqlOrTransaction`: true iff the
 * subtree contains a `?{}` SQL block (`sql` / `sql-ref`), EXCLUDING a
 * `<transaction>` block. The in-process library routing gate (codegen/index.ts)
 * and per-fn skip (emit-tool.ts) use this so a `<transaction>`-ONLY library — a
 * still-STAGED shape (§44.6 / SPEC-ISSUE-018, no async-coloring seed) — does NOT
 * route to the in-process `?{}` emit, where a sync fn + injected transaction
 * `await` would be a SyntaxError.
 */
export function containsSql(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;
  if (Array.isArray(node)) return node.some((child) => containsSql(child));
  const n = node as Record<string, unknown>;
  const k = n.kind;
  if (k === "sql" || k === "sql-ref") return true;
  for (const key of Object.keys(n)) {
    if (key === "span") continue;
    const v = n[key];
    if (v && typeof v === "object" && containsSql(v)) return true;
  }
  return false;
}

/**
 * Determine whether an AST node is server-only and must NOT be emitted to
 * client JavaScript output.
 *
 * Returns true for:
 *   - kind === "sql" — all SQL blocks are server-only
 *   - kind === "transaction-block" — all transaction blocks are server-only
 *   - kind === "meta" whose body contains server-context API patterns
 *     (process.env, Bun.env, Bun.file, fs.*, etc.).
 *     Per S130 (HU-2 Q4 / F-003) Approach C extension: `bun.eval()` retires
 *     as a user-facing surface entirely (no longer a recognized compile-time
 *     API per SPEC §22.12). The defense-in-depth `bun.eval` entry in
 *     SERVER_CONTEXT_META_PATTERNS is retained as a stale-emission guard
 *     against any residual literal bun.eval calls.
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

  if (isMetaKind(n.kind)) {
    const body = n.body;
    if (!Array.isArray(body) || body.length === 0) return false;
    const exprs = collectMetaExprStrings(body);
    return exprs.some(expr =>
      SERVER_CONTEXT_META_PATTERNS.some(pattern => pattern.test(expr))
    );
  }

  // Catch inline ?{} SQL sigil in let-decl / const-decl / state-decl init strings.
  // Phase 4d: ExprNode-first, string fallback
  if (n.kind === "let-decl" || n.kind === "const-decl" || n.kind === "state-decl") {
    const init = (n as any).initExpr ? emitStringFromTree((n as any).initExpr) : (typeof n.init === "string" ? n.init : "");
    if (SQL_SIGIL_PATTERN.test(init)) return true;
    if (ENV_PATTERN.test(init)) return true;
    // NOTE (S93 cg-006): we intentionally do NOT short-circuit on
    // `(n as any).sqlNode` here. Top-level `@x = ?{...}` (state-decl) is
    // legitimately handled at emit time as a client-boundary stub (see
    // emit-logic.ts case "state-decl" line ~1844 — "// SQL-init for @<name>"
    // client-cannot-evaluate comment). Treating it as server-only here
    // would suppress that defensive emission and emit W-CG-001 instead
    // (see emit-reactive-wiring.ts line 373).  The codegen path is
    // already correct for state-decls; the return-stmt/throw-stmt case
    // below is the actual bug the S93 fix addresses.
  }

  // Catch inline ?{} SQL sigil in bare-expr nodes.
  // Phase 4d Step 8: ExprNode-first; runtime-only string fallback (bare-expr.expr TS field deleted)
  if (n.kind === "bare-expr") {
    // M6.5.b.4 (SECONDARY) — a `sql-ref` ANYWHERE in the exprNode tree is
    // server-only SQL (§8). Catches the chained `?{...}.get()` form whose
    // sql-ref is nested under `call -> member.object` and which the
    // emitStringFromTree round-trip below does NOT match (the comment
    // placeholder fails SQL_SIGIL_PATTERN). Additive — strictly safer for
    // the leak; the bare un-chained `?{}` statement is already promoted to
    // `kind:"sql"` upstream (translate-stmt.js, PRIMARY).
    if ((n as any).exprNode && exprTreeContainsSqlRef((n as any).exprNode)) return true;
    const expr = (n as any).exprNode ? emitStringFromTree((n as any).exprNode) : (typeof n.expr === "string" ? n.expr : "");
    if (SQL_SIGIL_PATTERN.test(expr)) return true;
    if (ENV_PATTERN.test(expr)) return true;
  }

  // S93 cg-006 fix (Layer 3): return-stmt / throw-stmt with a structured
  // `sqlNode` field (produced by ast-builder.js for `return ?{...}.method()` /
  // `throw ?{...}` shapes — see ast-builder.js:4755-4773). Same shape as the
  // let-decl/const-decl/state-decl sqlNode handling above.
  //
  // Layer 1 (RI) already classifies such functions as server-bound so they
  // never reach the client-emission Step 3 path. This is defense-in-depth
  // for cases where Step 3 is invoked anyway (test harnesses, future RI
  // changes that miss a case). E-CG-006 remains the final post-emission scan.
  if (n.kind === "return-stmt" || n.kind === "throw-stmt") {
    if ((n as any).sqlNode && (n as any).sqlNode.kind === "sql") return true;
    const expr = (n as any).exprNode ? emitStringFromTree((n as any).exprNode) : (typeof (n as any).expr === "string" ? (n as any).expr : "");
    if (SQL_SIGIL_PATTERN.test(expr)) return true;
    if (ENV_PATTERN.test(expr)) return true;
  }

  // S93 cg-006 fix (Layer 3, continued): lift-expr with a `sql` child carries
  // SQL the same way (`expr: { kind: "sql", node: <sqlNode> }`). The lift-expr
  // node only appears as a stand-alone statement in markup-yielding contexts,
  // but if it ever reaches a client-emission filter, treat as server-only.
  if (n.kind === "lift-expr") {
    const liftE = (n as any).expr;
    if (liftE && liftE.kind === "sql") return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// §8.11 / §52.6 server @var declaration collector
// ---------------------------------------------------------------------------

/**
 * Walk the file AST and return all `server @var` state-decl nodes found inside
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
          if (
            child && child.kind === "state-decl" && (child as any).isServer === true &&
            // Tier-1 server-authority TYPE instances (serverAuthorityTable) are
            // collected separately by collectServerAuthorityTypes — keep the two
            // paths disjoint (§52.3 vs §52.4).
            !(child as any).serverAuthorityTable
          ) {
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
 * §52.3.5 Tier-1 server-authority TYPE instances (read-authority codegen).
 *
 * change-id state-decl-shape-disambiguation-2026-06-14. The recogniser
 * (ast-builder tryParseServerAuthorityDecl) produces, for each
 * `< Name authority="server" table="…">` type-decl + its `< Name> @var`
 * instance, a `state-decl{ isServer:true, stateType, serverAuthorityTable }`
 * node. This collector returns those instances so the read-authority codegen
 * (the `SELECT * FROM <table>` mount load + SSR pre-render, §52.6.1/§52.8) can
 * attach. These are the Tier-1 cells; `collectServerVarDecls` above returns the
 * Tier-2 `<var server>` cells. They are disjoint (Tier-1 carries
 * `serverAuthorityTable`; Tier-2 does not), and a cell is in exactly one.
 *
 * The WRITE is always the developer's own `?{}` server fn (§52.6.2, Q1=C) — no
 * write route is generated here.
 */
export function collectServerAuthorityTypes(fileAST: FileAST): Node[] {
  const nodes = getNodes(fileAST);
  const result: Node[] = [];
  function visit(list: Node[]): void {
    for (const node of list) {
      if (!node || typeof node !== "object") continue;
      if (node.kind === "logic" && Array.isArray(node.body)) {
        for (const child of node.body) {
          if (
            child && child.kind === "state-decl" &&
            (child as any).isServer === true &&
            typeof (child as any).serverAuthorityTable === "string" &&
            (child as any).serverAuthorityTable.length > 0
          ) {
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

/**
 * §52.6.5 Pattern C — inline-`?{}` RHS LOAD classification for a Tier-2
 * `<var server>` declaration (S216 ruling, disposition A=LOAD).
 *
 * The ss1 item-3 parser leak-stop attaches a structured `sqlNode`
 * (`{ kind:"sql", query, chainedCalls }`) to a `<var server> = ?{…}` decl
 * (and the `server @var = ?{}` form). That `?{}` IS the cell's mount load:
 * the compiler emits a `/__serverLoad/<var>` route that runs the query
 * server-side and a client fetch that hydrates the cell on mount.
 *
 * Returns the load CLASS:
 *   - "sql-load"      — the RHS is a PARAM-FREE inline `?{}` (the shipped core).
 *                       The query has no `${}` interpolation, so the built
 *                       `/__serverLoad/<var>` POST-empty-body path serves it.
 *   - "param-bearing" — the RHS is an inline `?{}` whose query interpolates a
 *                       client-local cell (`${@driverId}`). This needs POST-body
 *                       param-passing on `/__serverLoad/<var>` — a bounded
 *                       follow-on, OUT OF SCOPE for the param-free core. The
 *                       caller emits a graceful diagnostic (W-AUTH-004) and NO
 *                       load (the cell shows its placeholder).
 *   - "none"          — no inline `?{}` on the RHS (a literal placeholder like
 *                       `= 0` / `= []` / `= not`, or a Pattern-A/B load). Handled
 *                       by the existing emitInitialLoad / §52.6.5 A/B paths.
 *
 * The `${@cell}` detection is on the RAW query text (the parser preserves the
 * interpolation verbatim in `sqlNode.query`); a param-free query never contains
 * the `${` token.
 */
export type ServerVarLoadKind = "sql-load" | "param-bearing" | "none";

/**
 * §52 / §20.5 (S233) — does EVERY `${...}` interpolation in a `?{}` query
 * reference ONLY the server-ambient `@currentUser` cell (and no client-local
 * `@cell`)? Such a query is fully SERVER-resolvable (the client passes no
 * params), so a `<var server> = ?{ … ${@currentUser.id} … }` row-scope load is a
 * plain server-side `sql-load`, NOT the param-bearing (client-POST-body) form.
 *
 * Conservative: an interpolation with no `@cell` (a literal `${1}`) or any
 * non-`@currentUser` `@cell` makes the whole query param-bearing. The `@`-scan
 * is restricted to the INTERIOR of each `${...}` so a literal `@` inside SQL
 * string data (an email) never counts.
 */
export function queryInterpolationsAreServerAmbientOnly(query: string): boolean {
  if (typeof query !== "string" || !query.includes("${")) return false;
  let i = 0;
  let sawInterp = false;
  while (i < query.length) {
    if (query[i] === "$" && query[i + 1] === "{") {
      let depth = 1;
      let j = i + 2;
      while (j < query.length && depth > 0) {
        if (query[j] === "{") depth++;
        else if (query[j] === "}") depth--;
        if (depth > 0) j++;
      }
      const interior = query.slice(i + 2, j);
      sawInterp = true;
      const cells = interior.match(/@([A-Za-z_$][A-Za-z0-9_$]*)/g) ?? [];
      if (cells.length === 0) return false; // non-@cell interpolation → param-bearing
      for (const c of cells) {
        if (c !== "@currentUser") return false; // a client-local @cell → param-bearing
      }
      i = j + 1;
    } else {
      i++;
    }
  }
  return sawInterp;
}

/**
 * @param ambientCurrentUserActive — TRUE iff the file declares no user
 *   `<currentUser>` reactive cell, so `@currentUser` is the server-ambient
 *   identity cell (and a `${@currentUser.id}`-only query is server-resolvable).
 *   Default FALSE (conservative): without this flag a `${...}` query is
 *   param-bearing, the pre-S233 behavior.
 */
export function serverVarDeclLoadKind(
  decl: Node,
  ambientCurrentUserActive = false,
): ServerVarLoadKind {
  const sqlNode = (decl as any).sqlNode;
  if (!sqlNode || sqlNode.kind !== "sql") return "none";
  const query: string = typeof sqlNode.query === "string"
    ? sqlNode.query
    : (typeof sqlNode.body === "string" ? sqlNode.body : "");
  // A param-bearing SELECT interpolates a client-local cell — `${...}` in the
  // raw query text. The POST-body param-passing path is a bounded follow-on.
  if (query.includes("${")) {
    // §52 (S233) Fork-3 row-scope: a query whose ONLY interpolations are the
    // server-ambient `@currentUser` cell is fully server-resolvable (the client
    // POSTs an empty body; the handler binds `_scrml_currentUser`), so it loads
    // as a plain sql-load. Only when the ambient is active (no user `<currentUser>`
    // cell shadows the name) — otherwise `@currentUser` is a client-local cell and
    // the query is genuinely param-bearing.
    if (ambientCurrentUserActive && queryInterpolationsAreServerAmbientOnly(query)) {
      return "sql-load";
    }
    return "param-bearing";
  }
  return "sql-load";
}
