/**
 * Route Inferrer — Stage 5 of the scrml compiler pipeline (RI).
 *
 * Input:  { files: FileAST[], protectAnalysis: ProtectAnalysis }
 * Output: { routeMap: RouteMap, errors: RIError[] }
 *
 * RouteMap = {
 *   functions: Map<FunctionNodeId, FunctionRoute>,
 * }
 *
 * FunctionRoute = {
 *   functionNodeId: FunctionNodeId,
 *   boundary: 'client' | 'server' | 'middleware',  // middleware = handle() escape hatch (§ 39.3)
 *   escalationReasons: EscalationReason[],  // empty if client
 *   generatedRouteName: string | null,       // null for client functions
 *   serverEntrySpan: Span | null,
 *   cpsSplit: CPSSplit | null,               // non-null when CPS transformation applies
 * }
 *
 * CPSSplit = {
 *   serverStmtIndices: number[],   // indices into the function body that run on server
 *   clientStmtIndices: number[],   // indices into the function body that run on client
 *   returnVarName: string | null,  // the name of the variable that receives the server result
 * }
 *
 * EscalationReason =
 *   | { kind: 'protected-field-access', field: string, stateBlockId: string }
 *   | { kind: 'server-only-resource',   resourceType: string, span: Span }
 *   | { kind: 'explicit-annotation',    span: Span }
 *
 * FunctionNodeId = "{filePath}::{span.start}"
 *
 * Error codes produced:
 *   E-RI-002  server-escalated function assigns to @reactive variable (AT_IDENT in assignment)
 *             A function is server-escalated when it has direct triggers (own ?{} SQL, own
 *             access to a protect= field or server-only resource, or `server` annotation) OR
 *             when it captures a server-tainted function WITHOUT calling it (Step 5b — captures
 *             that propagate by referencing, not by calling). Calling a server function does
 *             NOT escalate the caller (§12 escalation rules) — the call site lowers to a fetch
 *             stub at codegen, so a client function may freely call a server function and assign
 *             reactive state on its result (this is the canonical Promise-chain pattern; see
 *             tests §10 "function calling server fn with reactive in nested if-stmt").
 *             E-RI-002 only fires when (a) the function IS server-escalated by the rules above,
 *             AND (b) the function body contains a `@`-assignment (anywhere, including inside
 *             if/while/for bodies — see findReactiveAssignment), AND (c) CPS cannot split the
 *             body (analyzeCPSEligibility returns null or non-eligible). CPS-eligible patterns
 *             include `@x = ?{...}.method()` and `@x = serverFn()` at top level.
 *   E-ROUTE-001  warning — unresolvable callee (variable-stored function ref, computed member)
 *
 * What RI does NOT do:
 *   - No code generation.
 *   - No type resolution.
 *   - No full alias tracking (DC-011 accepted limitation — direct patterns only).
 *   - No SQL query execution or validation.
 *   - No dependency graph construction.
 *
 * Performance budget: <= 15 ms for the full project.
 */

import type {
  Span,
  FileAST,
  ASTNode,
  LogicStatement,
  FunctionDeclNode,
  StateNode,
  LogicNode,
  ImportDeclNode,
} from "./types/ast.ts";

import type { ProtectAnalysis } from "./protect-analyzer.ts";
import { exprNodeCollectCallees, emitStringFromTree, forEachIdentInExprNode } from "./expression-parser.ts";
import type { ExprNode } from "./types/ast.ts";

// ---------------------------------------------------------------------------
// RI-internal types
// ---------------------------------------------------------------------------

/** A reason why a function was escalated to run on the server. */
export type EscalationReason =
  | { kind: "protected-field-access"; field: string; stateBlockId: string }
  | { kind: "server-only-resource"; resourceType: string; span: Span }
  | { kind: "explicit-annotation"; span: Span };

/**
 * CPS transformation split plan.
 * When applicable, the compiler splits the function at the server/client boundary.
 */
export interface CPSSplit {
  /** Indices into the function body that run on the server. */
  serverStmtIndices: number[];
  /** Indices into the function body that run on the client. */
  clientStmtIndices: number[];
  /** The reactive variable name that receives the server result, or null. */
  returnVarName: string | null;
}

/** A resolved route entry for a single function. */
export interface FunctionRoute {
  functionNodeId: string;
  boundary: "client" | "server" | "middleware";
  escalationReasons: EscalationReason[];
  generatedRouteName: string | null;
  explicitRoute: string | null;
  explicitMethod: string | null;
  isSSE: boolean;
  serverEntrySpan: Span | null;
  cpsSplit: CPSSplit | null;
}

/** A page route entry derived from file-based routing. */
export interface PageRoute {
  filePath: string;
  urlPattern: string;
  params: string[];
  layoutFilePath: string | null;
  isCatchAll: boolean;
}

/** Auth middleware configuration derived from <program auth="required"> or auto-escalation. */
export interface AuthMiddleware {
  filePath: string;
  auth: string;
  loginRedirect: string;
  csrf: string;
  sessionExpiry: string;
  autoEscalated?: boolean;
}

/** The complete route map produced by RI. */
export interface RouteMap {
  functions: Map<string, FunctionRoute>;
  pages: Map<string, PageRoute>;
  authMiddleware: Map<string, AuthMiddleware>;
}

/** Per-function analysis record (used during transitive escalation). */
interface AnalysisRecord {
  fnNodeId: string;
  filePath: string;
  fnNode: FunctionDeclNode;
  isPure: false;
  directTriggers: EscalationReason[];
  callees: string[];
  warnings: RouteWarning[];
  /** Names captured from outer scope (closure variables). */
  closureCaptures: Set<string>;
}

/** An entry in the global function index. */
interface FunctionIndexEntry {
  fnNodeId: string;
  filePath: string;
  fnNode: FunctionDeclNode;
}

/** Result of walkBodyForTriggers. */
interface WalkResult {
  triggers: EscalationReason[];
  callees: string[];
  warnings: RouteWarning[];
}

/** Internal warning record for E-ROUTE-001. */
interface RouteWarning {
  code: string;
  message: string;
  span: Span;
  severity?: "error" | "warning";
}

/** CPS eligibility analysis result. */
interface CPSResult {
  eligible: boolean;
  serverStmtIndices: number[];
  clientStmtIndices: number[];
  returnVarName: string | null;
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class RIError {
  code: string;
  message: string;
  span: Span;
  severity?: "error" | "warning";
  filePath?: string;

  constructor(code: string, message: string, span: Span) {
    this.code = code;
    this.message = message;
    this.span = span;
  }
}

// ---------------------------------------------------------------------------
// Server-only resource detection (Trigger 1)
//
// Detects Bun-specific APIs, file-system access, and SQL contexts.
// All ?{} SQL blocks auto-escalate to server per §12.2 Trigger 1.
// ---------------------------------------------------------------------------

/** A pattern that signals server-only resource access in a bare-expr string. */
interface ServerOnlyPattern {
  pattern: RegExp;
  resourceType: string;
}

/**
 * Patterns that indicate server-only resource access.
 * Applied to bare-expr node `expr` strings.
 */
const SERVER_ONLY_PATTERNS: ServerOnlyPattern[] = [
  // SQL context sigil (?{}) — all database access is server-side (§12.2 Trigger 1)
  { pattern: /\?\{/, resourceType: "sql-query" },
  // Bun-specific APIs
  { pattern: /\bBun\.file\s*\(/, resourceType: "Bun.file" },
  { pattern: /\bBun\.write\s*\(/, resourceType: "Bun.write" },
  { pattern: /\bBun\.spawn\s*\(/, resourceType: "Bun.spawn" },
  { pattern: /\bBun\.serve\s*\(/, resourceType: "Bun.serve" },
  { pattern: /\bBun\.env\b/, resourceType: "Bun.env" },
  { pattern: /\bnew\s+Bun\.Server\b/, resourceType: "Bun.Server" },
  { pattern: /\bnew\s+Database\s*\(/, resourceType: "bun:sqlite Database" },
  // §44 Bun.SQL constructor — driver-agnostic SQL client. Server-only because
  // any DB connection is a server-side resource (escalation trigger §12.2).
  { pattern: /\bnew\s+SQL\s*\(/, resourceType: "Bun.SQL" },
  { pattern: /\bnew\s+Bun\.SQL\s*\(/, resourceType: "Bun.SQL" },
  // Node.js fs module calls
  { pattern: /\bfs\.readFile\s*\(/, resourceType: "fs.readFile" },
  { pattern: /\bfs\.writeFile\s*\(/, resourceType: "fs.writeFile" },
  { pattern: /\bfs\.readFileSync\s*\(/, resourceType: "fs.readFileSync" },
  { pattern: /\bfs\.writeFileSync\s*\(/, resourceType: "fs.writeFileSync" },
  { pattern: /\bfs\.unlink\s*\(/, resourceType: "fs.unlink" },
  { pattern: /\bfs\.mkdir\s*\(/, resourceType: "fs.mkdir" },
  { pattern: /\bfs\.rmdir\s*\(/, resourceType: "fs.rmdir" },
  { pattern: /\bfs\.stat\s*\(/, resourceType: "fs.stat" },
  { pattern: /\bfs\.existsSync\s*\(/, resourceType: "fs.existsSync" },
  { pattern: /\breadFileSync\s*\(/, resourceType: "readFileSync" },
  { pattern: /\bwriteFileSync\s*\(/, resourceType: "writeFileSync" },
  // process.env is server-only
  { pattern: /\bprocess\.env\b/, resourceType: "process.env" },
  // Insight 26 Batch 1 — D2: complete process.* server-only set (2026-05-08).
  // Per stdlib-empty-body-audit-2026-05-08.md §3.6, these patterns escape
  // the original regex set and stdlib/process/index.scrml relies on them.
  { pattern: /\bprocess\.cwd\s*\(/, resourceType: "process.cwd" },
  { pattern: /\bprocess\.argv\b/, resourceType: "process.argv" },
  { pattern: /\bprocess\.platform\b/, resourceType: "process.platform" },
  { pattern: /\bprocess\.exit\s*\(/, resourceType: "process.exit" },
  { pattern: /\bprocess\.uptime\s*\(/, resourceType: "process.uptime" },
  { pattern: /\bprocess\.memoryUsage\s*\(/, resourceType: "process.memoryUsage" },
  // Bun.cron — Bun ≥1.3.12 in-process scheduler. Server-only.
  { pattern: /\bBun\.cron\b/, resourceType: "Bun.cron" },
  // env() built-in is server-only unless prefixed with `public`
  { pattern: /(?<!public )\benv\s*\(/, resourceType: "env()" },
  // session object is server-only (§20.5 — available only in server-escalated functions)
  { pattern: /\bsession\b/, resourceType: "session" },
];

/**
 * scrml module names whose exports are server-only.
 * Functions imported from these modules cannot run on the client.
 *
 * Used in CPS analysis and server-trigger detection to recognize calls
 * like hash(password) (from scrml:crypto) as server-side operations
 * even though they are not user-defined functions in the AST.
 */
const SERVER_ONLY_SCRML_MODULES = new Set<string>([
  "scrml:crypto",
  "scrml:auth",
  "scrml:data",
  "scrml:http",
  // Insight 26 Batch 1 — D1 completion (2026-05-08).
  // Each verified server-only by header of stdlib/<name>/index.scrml.
  "scrml:redis",   // wraps Bun.redis (Bun ≥1.3); network-bound server-only
  "scrml:fs",      // node:fs / Bun.file APIs; not available in browser
  "scrml:process", // Node/Bun process APIs; not available in browser
  "scrml:cron",    // wraps Bun.cron (Bun ≥1.3.12); in-process scheduler
  "scrml:oauth",   // OAuth client; network calls + token storage
]);

/**
 * Check a bare-expr string for server-only resource access patterns.
 * Returns the first matching resourceType, or null if none match.
 */
function detectServerOnlyResource(expr: string): string | null {
  for (const { pattern, resourceType } of SERVER_ONLY_PATTERNS) {
    if (pattern.test(expr)) return resourceType;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Protected field detection (Trigger 2)
// ---------------------------------------------------------------------------

/**
 * Build a regex that matches `.fieldName` as a member access in an expression.
 *
 * Per DC-011: this is a conservative structural check. False negatives are
 * possible for aliased accesses. False positives are possible for field names
 * that appear as property names on non-db objects.
 */
function memberAccessRegex(fieldName: string): RegExp {
  return new RegExp(`\\.${escapeRegex(fieldName)}\\b`);
}

/**
 * Build a regex that matches `{ fieldName }` or `{ fieldName,` or `, fieldName }` etc.
 * in a destructuring pattern.
 */
function destructuringRegex(fieldName: string): RegExp {
  return new RegExp(`(?:^|[{,\\s])\\s*${escapeRegex(fieldName)}\\s*(?:[,}:])`);
}

/** Escape a string for use in a RegExp. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Check a bare-expr string for direct member access of a protected field.
 */
function bareExprAccessesField(expr: string, fieldName: string): boolean {
  return memberAccessRegex(fieldName).test(expr);
}

/**
 * Check a let-decl or const-decl node for direct destructuring of a protected field.
 */
function declDestructuresField(init: string, fieldName: string): boolean {
  return destructuringRegex(fieldName).test(init);
}

// ---------------------------------------------------------------------------
// Call site extraction
// ---------------------------------------------------------------------------

/**
 * Pattern to match direct function calls: `identifierName(`
 * Does NOT match: `obj.method(` or `fn[x](`.
 */
const DIRECT_CALL_REGEX = /\b([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;

/**
 * Pattern to detect computed member access.
 * `identifier[` — a computed property access.
 */
const COMPUTED_MEMBER_REGEX = /\b[A-Za-z_$][A-Za-z0-9_$]*\s*\[/;

/**
 * Extract direct callee names from a bare-expr string.
 * Returns an array of name strings (may contain duplicates).
 */
function extractCalleesFromExpr(expr: string): string[] {
  const names: string[] = [];
  const re = new RegExp(DIRECT_CALL_REGEX.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(expr)) !== null) {
    names.push(m[1]);
  }
  return names;
}

/** Phase 4d: ExprNode-first callee extraction with string fallback. */
function extractCalleesFromNode(node: any, stringField: "expr" | "init"): string[] {
  const exprNodeField = stringField === "expr" ? "exprNode" : "initExpr";
  const en = node[exprNodeField] as ExprNode | undefined;
  if (en) return exprNodeCollectCallees(en);
  const str = node[stringField] ?? "";
  return str ? extractCalleesFromExpr(str) : [];
}

// ---------------------------------------------------------------------------
// AST walker utilities
// ---------------------------------------------------------------------------

/**
 * Collect all StateBlock nodes with stateType === 'db' from a FileAST's node tree.
 */
function collectDbBlocks(nodes: ASTNode[]): StateNode[] {
  const result: StateNode[] = [];
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    if (node.kind === "state" && (node as StateNode).stateType === "db") {
      result.push(node as StateNode);
    }
    if ("children" in node && Array.isArray(node.children) && node.children.length > 0) {
      result.push(...collectDbBlocks(node.children as ASTNode[]));
    }
  }
  return result;
}

/**
 * Collect all function/fn nodes from a LogicStatement[] body tree.
 * Recurses into nested function bodies.
 */
function collectFunctionNodes(body: LogicStatement[]): FunctionDeclNode[] {
  const result: FunctionDeclNode[] = [];
  for (const node of body) {
    if (!node || typeof node !== "object") continue;
    if (node.kind === "function-decl") {
      result.push(node as FunctionDeclNode);
      if (Array.isArray((node as FunctionDeclNode).body)) {
        result.push(...collectFunctionNodes((node as FunctionDeclNode).body));
      }
    }
  }
  return result;
}

/**
 * Collect all top-level function nodes from a FileAST.
 * Searches inside LogicBlock nodes at the top level, then recurses.
 */
export function collectFileFunctions(fileAST: FileAST): FunctionDeclNode[] {
  const nodes: ASTNode[] = fileAST.nodes ?? ((fileAST as any).ast ? (fileAST as any).ast.nodes : []);
  const result: FunctionDeclNode[] = [];

  function visitNodes(astNodes: ASTNode[]): void {
    for (const node of astNodes) {
      if (!node || typeof node !== "object") continue;
      if (node.kind === "logic") {
        const logicNode = node as LogicNode;
        if (Array.isArray(logicNode.body)) {
          result.push(...collectFunctionNodes(logicNode.body));
        }
      }
      if (node.kind === "function-decl") {
        result.push(node as FunctionDeclNode);
        const fnNode = node as FunctionDeclNode;
        if (Array.isArray(fnNode.body)) {
          result.push(...collectFunctionNodes(fnNode.body));
        }
      }
      // Recurse into markup/state/meta children
      if ("children" in node && Array.isArray((node as any).children)) {
        visitNodes((node as any).children);
      }
    }
  }

  visitNodes(nodes);
  return result;
}

/**
 * Collect the span.start values of all function nodes that live inside a
 * nested <program name="..."> worker body.
 *
 * Worker programs are markup nodes with tag === "program" AND a non-empty
 * `name` attribute. The root <program> has no name attribute.
 *
 * Functions inside worker bodies cannot access protected fields or shared
 * reactive state — no DB access, no server escalation triggers are meaningful
 * there. E-ROUTE-001 is suppressed for these functions.
 */
function collectWorkerBodyFunctionIds(fileAST: FileAST): Set<number> {
  const nodes: ASTNode[] = fileAST.nodes ?? ((fileAST as any).ast ? (fileAST as any).ast.nodes : []);
  const result = new Set<number>();

  function visitNodes(astNodes: ASTNode[], insideWorker: boolean): void {
    for (const node of astNodes) {
      if (!node || typeof node !== "object") continue;

      // Detect a named <program name="..."> markup node — this is a worker body.
      let enteringWorker = insideWorker;
      if (node.kind === "markup" && (node as any).tag === "program") {
        const attrs: any[] = (node as any).attrs ?? [];
        const hasName = attrs.some(
          (a: any) => a && (a.name === "name" || a.key === "name") && (a.value || a.val),
        );
        if (hasName) {
          enteringWorker = true;
        }
      }

      // Collect all functions inside worker bodies.
      if (enteringWorker && node.kind === "logic") {
        const logicNode = node as LogicNode;
        if (Array.isArray(logicNode.body)) {
          for (const fn of collectFunctionNodes(logicNode.body)) {
            result.add(fn.span.start);
          }
        }
      }

      // Recurse into children.
      if ("children" in node && Array.isArray((node as any).children)) {
        visitNodes((node as any).children, enteringWorker);
      }
    }
  }

  visitNodes(nodes, false);
  return result;
}

// ---------------------------------------------------------------------------
// FunctionNodeId
// ---------------------------------------------------------------------------

/**
 * Construct a FunctionNodeId from a filePath and a function node.
 */
function makeFunctionNodeId(filePath: string, fnNode: FunctionDeclNode): string {
  return `${filePath}::${fnNode.span.start}`;
}

// ---------------------------------------------------------------------------
// Route name generation
// ---------------------------------------------------------------------------

let _routeCounter = 0;

/**
 * Generate a deterministic compiler-internal route name.
 * Uses a counter + function name for human readability in error messages,
 * but this name is NOT user-visible.
 */
export function generateRouteName(functionName: string): string {
  _routeCounter++;
  const safe = (functionName || "anon").replace(/[^A-Za-z0-9_]/g, "_");
  return `__ri_route_${safe}_${_routeCounter}`;
}

// ---------------------------------------------------------------------------
// Trigger detection — body walker
// ---------------------------------------------------------------------------

/**
 * Walk a LogicStatement[] body and collect escalation triggers.
 *
 * Returns:
 *   triggers  — EscalationReason[] from direct body analysis (NOT transitive)
 *   callees   — string[] of directly-called function names (for transitive escalation)
 *   warnings  — RouteWarning[] for unresolvable callees (E-ROUTE-001)
 *
 * @param isWorkerBody — when true, E-ROUTE-001 is suppressed. Worker program bodies
 *   (<program name="...">) are isolated execution contexts with no access to protected
 *   fields or shared reactive state. Computed member access there is safe and expected
 *   (e.g., array indexing in sieve algorithms). Emitting E-ROUTE-001 inside workers
 *   would be noise with no actionable signal.
 */
export function walkBodyForTriggers(
  body: LogicStatement[],
  protectedFields: Set<string>,
  stateBlockIdByField: Map<string, string>,
  filePath: string,
  isWorkerBody: boolean = false,
  /**
   * Insight 26 Batch 1 D2c (2026-05-08): names imported from server-only
   * runtime sources (`bun`, `bun:*`, `node:*`, server-only `scrml:*`).
   * When a bare-expr references such a name as a member-access subject
   * (e.g. `redis.get(key)` where `redis` is imported from "bun"), it
   * triggers server escalation.
   *
   * Defaults to empty set for back-compat with self-host RI and any
   * external callers.
   */
  importedServerNamespaces: Set<string> = new Set(),
): WalkResult {
  const triggers: EscalationReason[] = [];
  const callees: string[] = [];
  const warnings: RouteWarning[] = [];

  /**
   * D2c helper: scan an expression string for member-access references to
   * any name imported from a server-only runtime source. Returns the first
   * matching name, or null.
   *
   * Matches `\bNAME\.` (member access) — does NOT match `NAME(...)` direct
   * calls, which are already handled by `extractCalleesFromExpr` +
   * `importedServerFnNames` at the CPS layer.
   */
  function detectImportedServerNamespaceRef(expr: string): string | null {
    if (importedServerNamespaces.size === 0) return null;
    for (const name of importedServerNamespaces) {
      const re = new RegExp(`\\b${escapeRegex(name)}\\.[A-Za-z_$]`);
      if (re.test(expr)) return name;
    }
    return null;
  }

  function visitNode(node: LogicStatement | ASTNode): void {
    if (!node || typeof node !== "object") return;

    // Trigger 1: ?{} SQL context — all database access is server-side by default.
    if (node.kind === "sql") {
      triggers.push({
        kind: "server-only-resource",
        resourceType: "sql-query",
        span: node.span,
      });
      return;
    }

    if (node.kind === "bare-expr") {
      // Phase 4d Step 8: ExprNode-first; runtime-only string fallback (bare-expr.expr TS field deleted)
      const expr = (node as any).exprNode ? emitStringFromTree((node as any).exprNode) : ((node as any).expr ?? "");

      // Trigger 1: server-only resource access.
      const resourceType = detectServerOnlyResource(expr);
      if (resourceType !== null) {
        triggers.push({
          kind: "server-only-resource",
          resourceType,
          span: node.span,
        });
      }

      // D2c (Insight 26): server-only namespace import member access.
      const nsRef = detectImportedServerNamespaceRef(expr);
      if (nsRef !== null) {
        triggers.push({
          kind: "server-only-resource",
          resourceType: `imported-server-namespace:${nsRef}`,
          span: node.span,
        });
      }

      // Trigger 2: protected field access via direct member expression.
      for (const fieldName of protectedFields) {
        if (bareExprAccessesField(expr, fieldName)) {
          triggers.push({
            kind: "protected-field-access",
            field: fieldName,
            stateBlockId: stateBlockIdByField.get(fieldName) ?? "",
          });
        }
      }

      // Callee extraction for transitive escalation.
      callees.push(...extractCalleesFromNode(node, "expr"));

      // E-ROUTE-001: computed member access warning.
      // Suppressed inside worker bodies — workers have no protected fields or shared
      // reactive state, so computed array indexing (e.g., flags[i]) is safe and expected.
      if (!isWorkerBody && COMPUTED_MEMBER_REGEX.test(expr)) {
        warnings.push({
          code: "E-ROUTE-001",
          message:
            `E-ROUTE-001: Computed member access detected in expression \`${expr.slice(0, 80)}\`. ` +
            `The compiler cannot statically determine the accessed property name. ` +
            `If this accesses a protected field via a computed key, it will not be detected by route inference. ` +
            `Use a direct property access (e.g., \`row.fieldName\`) to ensure correct route placement.`,
          span: node.span,
          severity: "warning",
        });
      }

      return; // Don't recurse into bare-expr text.
    }

    if (
      node.kind === "let-decl" ||
      node.kind === "const-decl" ||
      node.kind === "tilde-decl"
    ) {
      // Phase 4d: ExprNode-first, string fallback
      const init = (node as any).initExpr ? emitStringFromTree((node as any).initExpr) : ((node as any).init ?? "");

      // Trigger 2: protected field access via direct destructuring.
      for (const fieldName of protectedFields) {
        if (declDestructuresField(init, fieldName)) {
          triggers.push({
            kind: "protected-field-access",
            field: fieldName,
            stateBlockId: stateBlockIdByField.get(fieldName) ?? "",
          });
        }
      }

      // Trigger 1: server-only resource in the init expression (e.g. ?{} SQL sigil, Bun.file(), etc.)
      const resourceType = detectServerOnlyResource(init);
      if (resourceType !== null) {
        triggers.push({
          kind: "server-only-resource",
          resourceType,
          span: node.span,
        });
      }

      // D2c (Insight 26): server-only namespace import member access in init.
      const nsRefInit = detectImportedServerNamespaceRef(init);
      if (nsRefInit !== null) {
        triggers.push({
          kind: "server-only-resource",
          resourceType: `imported-server-namespace:${nsRefInit}`,
          span: node.span,
        });
      }

      // Callee extraction from the init expression.
      callees.push(...extractCalleesFromNode(node, "init"));
      return;
    }

    if (node.kind === "state-decl") {
      // @name = expr — state-decl IS an assignment to an @-prefixed identifier.
      // Also scan the init for server-only resources and callees.
      // Phase 4d: ExprNode-first, string fallback
      const init = (node as any).initExpr ? emitStringFromTree((node as any).initExpr) : ((node as any).init ?? "");

      // fix-cg-cps-return-sql-ref-placeholder (S40 follow-up): when the AST
      // builder attached a structured sqlNode (because the initializer was
      // `?{...}.method()` — see ast-builder tryConsumeSqlInit), `init` is
      // "" and `initExpr` is undefined. The SQL site is no longer visible
      // to detectServerOnlyResource(string), so we must trigger escalation
      // explicitly here. Mirrors the trigger-1 path for direct `sql` nodes
      // at the top of visitNode (line ~537). Without this, server-only
      // functions whose ONLY trigger was `@x = ?{...}` lose their route
      // (e.g. refreshList() in combined-007-crud.scrml regressed pre-fix to
      // having no emitted route).
      if ((node as any).sqlNode && (node as any).sqlNode.kind === "sql") {
        triggers.push({
          kind: "server-only-resource",
          resourceType: "sql-query",
          span: node.span,
        });
      }

      // Trigger 1: server-only resource in the init expression (e.g. ?{} SQL sigil).
      // Matches the same check applied to let-decl/const-decl/tilde-decl above.
      const reactDeclResourceType = detectServerOnlyResource(init);
      if (reactDeclResourceType !== null) {
        triggers.push({
          kind: "server-only-resource",
          resourceType: reactDeclResourceType,
          span: node.span,
        });
      }

      // D2c (Insight 26): server-only namespace import member access in init.
      const nsRefStateInit = detectImportedServerNamespaceRef(init);
      if (nsRefStateInit !== null) {
        triggers.push({
          kind: "server-only-resource",
          resourceType: `imported-server-namespace:${nsRefStateInit}`,
          span: node.span,
        });
      }

      callees.push(...extractCalleesFromNode(node, "init"));
      return;
    }

    // For nested function-decl: do NOT recurse into their bodies
    // here — they are separate function nodes with their own analysis entries.
    if (node.kind === "function-decl") {
      return;
    }

    // For all other node kinds, recursively visit array fields.
    for (const key of Object.keys(node)) {
      if (key === "span" || key === "id") continue;
      const val = (node as any)[key];
      if (Array.isArray(val)) {
        for (const child of val) {
          visitNode(child);
        }
      }
    }
  }

  for (const node of body) {
    visitNode(node);
  }

  return { triggers, callees, warnings };
}

/**
 * Check whether a function body directly contains an assignment to an @-prefixed
 * identifier (state-decl nodes) or an AT_IDENT in assignment position in a bare-expr.
 *
 * Per §12.7: "RI walks the parsed function body for assignment expressions where the
 * left-hand side is an AT_IDENT token in assignment position."
 */
function findReactiveAssignment(body: LogicStatement[]): LogicStatement | null {
  function visitNode(node: LogicStatement): LogicStatement | null {
    if (!node || typeof node !== "object") return null;

    // state-decl is the canonical AT_IDENT assignment form.
    if (node.kind === "state-decl") {
      return node;
    }

    // Also check bare-expr for @name = pattern.
    // Phase 4d Step 8: ExprNode-first; runtime-only string fallback (bare-expr.expr TS field deleted)
    if (node.kind === "bare-expr") {
      const expr = (node as any).exprNode ? emitStringFromTree((node as any).exprNode) : ((node as any).expr ?? "");
      if (/\B@[A-Za-z_$][A-Za-z0-9_$]*\s*=[^=]/.test(expr)) {
        return node;
      }
      return null;
    }

    // Do not recurse into nested function bodies.
    if (node.kind === "function-decl") {
      return null;
    }

    // Recurse into array children.
    for (const key of Object.keys(node)) {
      if (key === "span" || key === "id") continue;
      const val = (node as any)[key];
      if (Array.isArray(val)) {
        for (const child of val) {
          const found = visitNode(child);
          if (found !== null) return found;
        }
      }
    }

    return null;
  }

  for (const node of body) {
    const found = visitNode(node);
    if (found !== null) return found;
  }

  return null;
}

// ---------------------------------------------------------------------------
// CPS transformation analysis
// ---------------------------------------------------------------------------

/**
 * Determine whether a function body is eligible for CPS transformation and,
 * if so, compute the split plan.
 *
 * CPS is eligible when:
 *   - There is at least one server-trigger statement
 *   - There is at least one reactive statement
 *   - No single statement is BOTH a server trigger AND a reactive assignment
 */
export function analyzeCPSEligibility(
  body: LogicStatement[],
  protectedFields: Set<string>,
  stateBlockIdByField: Map<string, string>,
  functionIndex: Map<string, FunctionIndexEntry[]>,
  analysisMap: Map<string, AnalysisRecord>,
  resolvedServerFnIds: Set<string>,
  importedServerFnNames: Set<string>,
  /**
   * Insight 26 Batch 1 D2c (2026-05-08): names imported from server-only
   * runtime sources for the file containing this body. Defaults to empty
   * for back-compat with self-host RI and external callers.
   */
  importedServerNamespaces: Set<string> = new Set(),
): CPSResult | null {
  if (!body || body.length === 0) return null;

  const serverIndices: number[] = [];
  const reactiveIndices: number[] = [];
  const reactiveServerIndices: number[] = []; // state-decls whose init calls a server fn
  const mixedIndices: number[] = []; // bare-expr statements that are BOTH server + reactive

  for (let i = 0; i < body.length; i++) {
    const node = body[i];
    if (!node || typeof node !== "object") continue;

    const isReactive = isReactiveStatement(node);
    const isServer = isServerTriggerStatement(
      node,
      protectedFields,
      stateBlockIdByField,
      functionIndex,
      analysisMap,
      resolvedServerFnIds,
      importedServerFnNames,
      importedServerNamespaces,
    );

    // Special case: state-decl with server function call OR server-only
    // resource in init — CPS-eligible.
    const isReactiveServer =
      isReactive &&
      node.kind === "state-decl" &&
      (hasServerCallInInit(node, functionIndex, resolvedServerFnIds, importedServerFnNames) ||
        hasServerOnlyResourceInInit(node, importedServerNamespaces));

    if (isReactiveServer) {
      reactiveServerIndices.push(i);
    } else if (isReactive && isServer) {
      // bare-expr with both @var= and server resource — truly unsplittable
      mixedIndices.push(i);
    } else if (isReactive) {
      reactiveIndices.push(i);
    } else if (isServer) {
      serverIndices.push(i);
    }
    // Statements that are neither are client-side by default
  }

  // CPS is applicable when:
  // 1. There are NO mixed (unsplittable) statements
  // 2. There is at least one reactive statement (pure reactive or reactive-server)
  // 3. There is at least one server-side element (server statement or reactive-server)
  const hasReactive = reactiveIndices.length > 0 || reactiveServerIndices.length > 0;
  const hasServer = serverIndices.length > 0 || reactiveServerIndices.length > 0;

  if (!hasReactive || !hasServer) return null;
  if (mixedIndices.length > 0) return null;

  // Compute the split.
  const allServerIndices = [...serverIndices, ...reactiveServerIndices].sort((a, b) => a - b);
  const clientStmtIndices: number[] = [];
  for (let i = 0; i < body.length; i++) {
    if (!serverIndices.includes(i)) {
      clientStmtIndices.push(i);
    }
    // Note: reactiveServerIndices are in BOTH lists.
  }

  // Detect returnVarName from reactive-server statements.
  let returnVarName: string | null = null;
  for (const ri of reactiveServerIndices) {
    const node = body[ri];
    if (node.kind === "state-decl" && (node as any).name) {
      returnVarName = (node as any).name;
      break;
    }
  }

  return {
    eligible: true,
    serverStmtIndices: allServerIndices,
    clientStmtIndices,
    returnVarName,
  };
}

/**
 * Check if a state-decl node's init expression calls a server-escalated function.
 */
function hasServerCallInInit(
  node: LogicStatement,
  functionIndex: Map<string, FunctionIndexEntry[]>,
  resolvedServerFnIds: Set<string>,
  importedServerFnNames: Set<string>,
): boolean {
  const callees = extractCalleesFromNode(node, "init");
  for (const calleeName of callees) {
    const calleeEntries = functionIndex.get(calleeName);
    if (calleeEntries) {
      for (const { fnNodeId: calleeId } of calleeEntries) {
        if (resolvedServerFnIds.has(calleeId)) return true;
      }
    }
    if (importedServerFnNames.has(calleeName)) return true;
  }
  return false;
}

/**
 * Check if a state-decl node's init expression contains a server-only
 * resource: SQL sigil (?{`), Bun.* APIs, process.env, env(), etc.
 *
 * Per Insight 26 Batch 1 D2c (2026-05-08), also recognizes member-access
 * references to names imported from server-only runtime sources (e.g.
 * `redis.get(key)` where `redis` is imported from "bun").
 */
function hasServerOnlyResourceInInit(
  node: LogicStatement,
  importedServerNamespaces: Set<string> = new Set(),
): boolean {
  // fix-cg-cps-return-sql-ref-placeholder (S40 follow-up): when the AST
  // builder attached a structured sqlNode (because the initializer was
  // `?{...}.method()`), `init` is "" and `initExpr` is undefined. The
  // structured form is the canonical way to detect SQL-init from now on;
  // the legacy string match remains for back-compat / defense-in-depth.
  // Without this, `refreshList()` in combined-007-crud.scrml regressed to
  // E-RI-002 because CPS split was no longer detected for `@users = ?{...}`.
  if ((node as any).sqlNode && (node as any).sqlNode.kind === "sql") return true;

  // Phase 4d: ExprNode-first, string fallback
  const init = (node as any).initExpr ? emitStringFromTree((node as any).initExpr) : (typeof (node as any).init === "string" ? (node as any).init : "");
  if (!init) return false;

  // Check for SQL sigil (?{`)
  if (/\?\{`/.test(init)) return true;

  // Check for other server-only resource patterns
  if (detectServerOnlyResource(init) !== null) return true;

  // Insight 26 D2c — server-only namespace member access (e.g. `redis.get(key)`).
  if (importedServerNamespaces.size > 0) {
    for (const name of importedServerNamespaces) {
      const re = new RegExp(`\\b${escapeRegex(name)}\\.[A-Za-z_$]`);
      if (re.test(init)) return true;
    }
  }

  return false;
}

/**
 * Check if a single statement node is a reactive assignment.
 */
function isReactiveStatement(node: LogicStatement): boolean {
  if (node.kind === "state-decl") return true;
  if (node.kind === "bare-expr") {
    // Phase 4d Step 8: ExprNode-first; runtime-only string fallback (bare-expr.expr TS field deleted)
    const expr = (node as any).exprNode ? emitStringFromTree((node as any).exprNode) : ((node as any).expr ?? "");
    if (/\B@[A-Za-z_$][A-Za-z0-9_$]*\s*=[^=]/.test(expr)) return true;
  }
  return false;
}

/**
 * Check if a single statement node contains a server-only trigger.
 */
function isServerTriggerStatement(
  node: LogicStatement,
  protectedFields: Set<string>,
  stateBlockIdByField: Map<string, string>,
  functionIndex: Map<string, FunctionIndexEntry[]>,
  analysisMap: Map<string, AnalysisRecord>,
  resolvedServerFnIds: Set<string>,
  importedServerFnNames: Set<string>,
  /** Insight 26 D2c (2026-05-08): per-file imported server namespaces. */
  importedServerNamespaces: Set<string> = new Set(),
): boolean {
  if (!node || typeof node !== "object") return false;

  // Insight 26 D2c helper — match `\bNAME\.` (member access).
  const matchesNamespaceRef = (expr: string): boolean => {
    if (importedServerNamespaces.size === 0) return false;
    for (const name of importedServerNamespaces) {
      const re = new RegExp(`\\b${escapeRegex(name)}\\.[A-Za-z_$]`);
      if (re.test(expr)) return true;
    }
    return false;
  };

  // SQL blocks are always server-side
  if (node.kind === "sql") return true;

  if (node.kind === "bare-expr") {
    // Phase 4d Step 8: ExprNode-first; runtime-only string fallback (bare-expr.expr TS field deleted)
    const expr = (node as any).exprNode ? emitStringFromTree((node as any).exprNode) : ((node as any).expr ?? "");

    // Server-only resource access
    if (detectServerOnlyResource(expr) !== null) return true;

    // D2c (Insight 26): server-only namespace member access
    if (matchesNamespaceRef(expr)) return true;

    // Protected field access
    for (const fieldName of protectedFields) {
      if (bareExprAccessesField(expr, fieldName)) return true;
    }

    // Calls to server-escalated functions or scrml: stdlib imports
    for (const calleeName of extractCalleesFromNode(node, "expr")) {
      const calleeEntries = functionIndex.get(calleeName);
      if (calleeEntries) {
        for (const { fnNodeId: calleeId } of calleeEntries) {
          if (resolvedServerFnIds.has(calleeId)) return true;
        }
      }
      if (importedServerFnNames.has(calleeName)) return true;
    }
  }

  if (node.kind === "let-decl" || node.kind === "const-decl") {
    // Phase 4d: ExprNode-first, string fallback
    const init = (node as any).initExpr ? emitStringFromTree((node as any).initExpr) : ((node as any).init ?? "");

    // Protected field via destructuring
    for (const fieldName of protectedFields) {
      if (declDestructuresField(init, fieldName)) return true;
    }

    // Server-only resource in init
    if (detectServerOnlyResource(init) !== null) return true;

    // D2c (Insight 26): server-only namespace member access in init
    if (matchesNamespaceRef(init)) return true;

    // Calls to server-escalated functions or scrml: stdlib imports in init
    const callees = extractCalleesFromNode(node, "init");
    for (const calleeName of callees) {
      const calleeEntries = functionIndex.get(calleeName);
      if (calleeEntries) {
        for (const { fnNodeId: calleeId } of calleeEntries) {
          if (resolvedServerFnIds.has(calleeId)) return true;
        }
      }
      if (importedServerFnNames.has(calleeName)) return true;
    }
  }

  // NOTE: state-decl nodes are NOT checked for server triggers here.
  // A state-decl like `@data = serverCall()` is CPS-eligible.
  // The only truly ineligible case is when a bare-expr contains BOTH
  // a reactive @-assignment AND server access in the same expression string.

  return false;
}

// ---------------------------------------------------------------------------
// Global function registry
// ---------------------------------------------------------------------------

/**
 * Build a global index of all function nodes across all files.
 * Key: function name → array of { fnNodeId, filePath, fnNode }
 */
export function buildFunctionIndex(files: FileAST[]): Map<string, FunctionIndexEntry[]> {
  const index = new Map<string, FunctionIndexEntry[]>();

  for (const fileAST of files) {
    const filePath = fileAST.filePath;
    const fnNodes = collectFileFunctions(fileAST);
    for (const fnNode of fnNodes) {
      const name = fnNode.name;
      if (!name) continue;
      const fnNodeId = makeFunctionNodeId(filePath, fnNode);
      if (!index.has(name)) index.set(name, []);
      index.get(name)!.push({ fnNodeId, filePath, fnNode });
    }
  }

  return index;
}

/**
 * Insight 26 Batch 1 — D2c (2026-05-08).
 * Bun runtime sources whose imports are all server-only. `bun` itself
 * surfaces network/process/file APIs (Bun.file, Bun.serve, redis, etc.) that
 * have no browser equivalent. `bun:*` subpath imports (bun:sqlite, bun:test,
 * bun:ffi, etc.) are also server-only — bun:test is dev-time only and is
 * never bundled into client output.
 */
function isServerOnlyImportSource(source: string): boolean {
  if (SERVER_ONLY_SCRML_MODULES.has(source)) return true;
  if (source === "bun") return true;
  if (source.startsWith("bun:")) return true;
  // node:* subpaths are Node-stdlib namespaces; never browser-available.
  if (source.startsWith("node:")) return true;
  return false;
}

/**
 * Build a set of function names imported from server-only scrml: modules.
 *
 * When a file imports { hash } from 'scrml:crypto', hash is server-only
 * even though it has no AST node in the user's code.
 *
 * Per Insight 26 Batch 1 D2c (2026-05-08), also recognizes Bun and Node
 * runtime sources (`bun`, `bun:*`, `node:*`) so that `import { redis } from "bun"`
 * (the pattern used by stdlib/redis/index.scrml) treats the imported names
 * as server-only.
 */
function buildImportedServerFnNames(files: FileAST[]): Set<string> {
  const names = new Set<string>();
  for (const fileAST of files) {
    const imports: ImportDeclNode[] =
      fileAST.imports ?? ((fileAST as any).ast ? (fileAST as any).ast.imports : []) ?? [];
    for (const node of imports) {
      if (node && node.kind === "import-decl" && node.source) {
        const source = node.source.replace(/^['"]|['"]$/g, "");
        if (isServerOnlyImportSource(source)) {
          for (const name of node.names ?? []) {
            names.add(name);
          }
        }
      }
    }
  }
  return names;
}

/**
 * Insight 26 Batch 1 D2c (2026-05-08).
 * Build a per-file map of names imported from server-only sources,
 * used by walkBodyForTriggers to detect member-access references like
 * `redis.get(key)` where `redis` is imported from "bun".
 *
 * Distinct from `buildImportedServerFnNames` (which collects all such names
 * across all files into a single flat set used at the CPS layer for
 * direct-call escalation): this map is per-file because imports are
 * file-scoped, and a member-access reference like `redis.get(key)` only
 * means "server-only" when `redis` was imported from a server-only source
 * IN THE SAME FILE.
 */
function buildPerFileImportedServerNamespaces(files: FileAST[]): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const fileAST of files) {
    const imports: ImportDeclNode[] =
      fileAST.imports ?? ((fileAST as any).ast ? (fileAST as any).ast.imports : []) ?? [];
    const names = new Set<string>();
    for (const node of imports) {
      if (node && node.kind === "import-decl" && node.source) {
        const source = node.source.replace(/^['"]|['"]$/g, "");
        if (isServerOnlyImportSource(source)) {
          for (const name of node.names ?? []) {
            names.add(name);
          }
        }
      }
    }
    result.set(fileAST.filePath, names);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Closure capture analysis
// ---------------------------------------------------------------------------

/**
 * Collect all names locally declared inside a function body.
 * Includes: let/const/tilde/lin/reactive declarations, nested function names,
 * for-loop iterator variables, try-catch binding names.
 * Does NOT include params (handled separately).
 */
function collectLocalNames(body: LogicStatement[]): Set<string> {
  const names = new Set<string>();

  function visitStmt(node: LogicStatement): void {
    if (!node || typeof node !== "object") return;

    switch (node.kind) {
      case "let-decl":
      case "const-decl":
      case "tilde-decl":
      case "lin-decl":
        if ((node as any).name) names.add((node as any).name);
        break;
      case "state-decl":
      case "reactive-debounced-decl":
        // Phase A1a Step 11.5 — `reactive-derived-decl` folded into state-decl.
        if ((node as any).name) names.add((node as any).name);
        break;
      case "function-decl":
        // Nested function is a local name but do NOT recurse into its body
        // for local name collection — its body has its own scope.
        if ((node as any).name) names.add((node as any).name);
        return; // do not recurse
      case "for-stmt":
        if ((node as any).iteratorVar) names.add((node as any).iteratorVar);
        if ((node as any).indexVar) names.add((node as any).indexVar);
        if (Array.isArray((node as any).body)) {
          for (const child of (node as any).body) visitStmt(child);
        }
        return;
      case "try-stmt":
        if ((node as any).catchNode && (node as any).catchNode.binding) {
          names.add((node as any).catchNode.binding);
        }
        if (Array.isArray((node as any).body)) {
          for (const child of (node as any).body) visitStmt(child);
        }
        if ((node as any).catchNode && Array.isArray((node as any).catchNode.body)) {
          for (const child of (node as any).catchNode.body) visitStmt(child);
        }
        if (Array.isArray((node as any).finallyBody)) {
          for (const child of (node as any).finallyBody) visitStmt(child);
        }
        return;
      case "if-stmt":
        if (Array.isArray((node as any).consequent)) {
          for (const child of (node as any).consequent) visitStmt(child);
        }
        if (Array.isArray((node as any).alternate)) {
          for (const child of (node as any).alternate) visitStmt(child);
        }
        return;
      case "while-stmt":
        if (Array.isArray((node as any).body)) {
          for (const child of (node as any).body) visitStmt(child);
        }
        return;
      case "match-stmt":
        if (Array.isArray((node as any).body)) {
          for (const child of (node as any).body) visitStmt(child);
        }
        return;
    }

    // Generic recursion for other node kinds with array children
    for (const key of Object.keys(node)) {
      if (key === "span" || key === "id") continue;
      const val = (node as any)[key];
      if (Array.isArray(val)) {
        for (const child of val) {
          if (child && typeof child === "object" && child.kind) {
            visitStmt(child);
          }
        }
      }
    }
  }

  for (const stmt of body) {
    visitStmt(stmt);
  }
  return names;
}

/**
 * Collect all identifier names referenced (read or called) in a function body.
 *
 * Implementation: structurally walks every ExprNode-bearing field via
 * `forEachIdentInExprNode`, which:
 *   - Visits only `IdentExpr` nodes (does NOT scan inside `LitExpr` string
 *     content, which is what the prior regex-on-flat-string implementation did
 *     and which caused the F-RI-001 deeper bug — a string literal containing
 *     a token text matching a peer server-fn name was falsely capture-tainting
 *     the function via the cross-file `fnNameToNodeIds` map).
 *   - Skips `MemberExpr.property` (a member-access name is a static string,
 *     not a free-variable reference).
 *   - Does not descend into `LambdaExpr` bodies (new lin scope; identifiers
 *     inside the lambda are not free variables of the outer fn).
 *   - Walks template-literal `${...}` interpolations (real identifier reads).
 *
 * Does NOT recurse into nested function-decl bodies — those have their own scope.
 *
 * Filtering: reactive (`@`) and tilde (`~`) identifiers are excluded — they
 * are not free function-name references and the closure-capture-taint loop
 * looks for fn-name collisions only.
 *
 * JS keywords/builtins are also filtered (preserves prior behavior).
 */
function collectReferencedNames(body: LogicStatement[]): Set<string> {
  const names = new Set<string>();

  function addIdent(name: string): void {
    if (!name) return;
    // Skip reactive (`@x`) and tilde (`~`) refs — not free fn-name references.
    if (name[0] === "@" || name === "~") return;
    if (JS_KEYWORDS.has(name)) return;
    names.add(name);
  }

  function walkExpr(node: ExprNode | undefined | null): void {
    if (!node) return;
    forEachIdentInExprNode(node, (ident) => addIdent(ident.name));
  }

  /**
   * Legacy string-mode fallback: used ONLY when the AST node lacks a structured
   * ExprNode field (the production ast-builder always populates ExprNode; this
   * fallback exists to keep hand-built test fixtures and any legacy callers
   * working). The string-mode path can have the F-RI-001-deeper string-literal
   * pollution issue, but production paths flow through `walkExpr` first.
   */
  const STR_IDENT_RE = /\b([A-Za-z_$][A-Za-z0-9_$]*)\b/g;
  function extractIdentsFromString(str: string): void {
    if (!str) return;
    const re = new RegExp(STR_IDENT_RE.source, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(str)) !== null) {
      addIdent(m[1]);
    }
  }
  function walkExprOrString(node: ExprNode | undefined | null, str: string | undefined): void {
    if (node) {
      walkExpr(node);
      return;
    }
    if (typeof str === "string" && str.length > 0) {
      extractIdentsFromString(str);
    }
  }

  function visitStmt(node: LogicStatement): void {
    if (!node || typeof node !== "object") return;
    const n = node as any;

    // Do NOT recurse into nested function bodies — they have their own scope.
    if (n.kind === "function-decl" || n.kind === "component-def") return;

    switch (n.kind) {
      // ---- Statements that carry an ExprNode in `exprNode` ----
      case "bare-expr":
        walkExprOrString(n.exprNode, n.expr);
        return;
      case "return-stmt":
      case "throw-stmt":
        walkExprOrString(n.exprNode, n.expr);
        return;

      // ---- Decls that carry an init in `initExpr` (or `init` legacy string) ----
      // Phase A1a Step 11.5 — `reactive-derived-decl` folded into state-decl.
      case "let-decl":
      case "const-decl":
      case "tilde-decl":
      case "lin-decl":
      case "state-decl":
      case "reactive-debounced-decl":
        walkExprOrString(n.initExpr, n.init);
        return;

      // ---- Reactive setters with structured exprs ----
      case "reactive-nested-assign":
        walkExprOrString(n.valueExpr, n.value);
        return;
      case "reactive-array-mutation":
      case "reactive-explicit-set":
        // Args remain raw strings on these escape-hatch nodes; nothing to
        // walk structurally. Pre-fix code also only matched whatever the
        // identifier-regex picked up here, so we deliberately skip them
        // (consistent with the structural-walk principle: no string scan).
        return;

      // ---- Control flow ----
      case "if-stmt":
      case "if-expr":
      case "while-stmt":
        walkExprOrString(n.condExpr, n.condition);
        if (Array.isArray(n.consequent)) for (const c of n.consequent) visitStmt(c);
        if (Array.isArray(n.alternate))   for (const c of n.alternate)   visitStmt(c);
        if (Array.isArray(n.body))        for (const c of n.body)        visitStmt(c);
        return;

      case "for-stmt":
      case "for-expr":
        walkExprOrString(n.iterExpr, n.iterable ?? n.iter);
        if (n.cStyleParts) {
          walkExpr(n.cStyleParts.initExpr);
          walkExpr(n.cStyleParts.condExpr);
          walkExpr(n.cStyleParts.updateExpr);
        }
        if (Array.isArray(n.body)) for (const c of n.body) visitStmt(c);
        return;

      case "match-stmt":
      case "match-expr":
        walkExprOrString(n.headerExpr, n.header);
        if (Array.isArray(n.body)) for (const c of n.body) visitStmt(c);
        return;

      case "switch-stmt":
        walkExprOrString(n.headerExpr, n.header);
        if (Array.isArray(n.body)) for (const c of n.body) visitStmt(c);
        return;

      case "try-stmt":
        if (Array.isArray(n.body)) for (const c of n.body) visitStmt(c);
        if (n.catchNode && Array.isArray(n.catchNode.body)) {
          for (const c of n.catchNode.body) visitStmt(c);
        }
        if (n.finallyNode && Array.isArray(n.finallyNode.body)) {
          for (const c of n.finallyNode.body) visitStmt(c);
        }
        if (Array.isArray(n.finallyBody)) {
          for (const c of n.finallyBody) visitStmt(c);
        }
        return;

      case "match-arm-inline":
        // Match arms may carry a result expression; walk if present.
        if (n.resultExpr) walkExpr(n.resultExpr);
        if (Array.isArray(n.body)) for (const c of n.body) visitStmt(c);
        return;

      case "lift-expr":
      case "fail-expr":
      case "propagate-expr":
      case "guarded-expr":
      case "html-fragment":
        // These are markup/control-flow boundary nodes that don't carry free
        // identifier references for RI capture-taint purposes. Pre-fix
        // behavior happened to scan their string fields; structurally they
        // contain no captures-relevant ExprNode references at this RI layer.
        return;
    }

    // ---- Generic fallback: recurse into any LogicStatement[] children ----
    // For statement kinds we haven't enumerated above (e.g. future additions),
    // walk array fields for nested LogicStatement[] bodies. Do NOT walk
    // ExprNode-bearing scalar fields here — that would re-introduce silent
    // misses. Add the kind to the switch above when a new field is needed.
    for (const key of Object.keys(n)) {
      if (key === "span" || key === "id" || key === "name") continue;
      const val = n[key];
      if (Array.isArray(val)) {
        for (const child of val) {
          if (child && typeof child === "object" && child.kind) {
            visitStmt(child);
          }
        }
      }
    }
  }

  for (const stmt of body) {
    visitStmt(stmt);
  }
  return names;
}

/** JS keywords and built-ins to exclude from identifier collection. */
const JS_KEYWORDS = new Set([
  "break", "case", "catch", "continue", "debugger", "default", "delete",
  "do", "else", "finally", "for", "function", "if", "in", "instanceof",
  "new", "return", "switch", "this", "throw", "try", "typeof", "var",
  "void", "while", "with", "class", "const", "enum", "export", "extends",
  "import", "super", "implements", "interface", "let", "package", "private",
  "protected", "public", "static", "yield", "await", "async",
  "true", "false", "null", "undefined", "NaN", "Infinity",
  "console", "Math", "JSON", "Object", "Array", "String", "Number",
  "Boolean", "Date", "RegExp", "Error", "Map", "Set", "Promise",
  "parseInt", "parseFloat", "isNaN", "isFinite", "encodeURIComponent",
  "decodeURIComponent", "setTimeout", "setInterval", "clearTimeout",
  "clearInterval", "document", "window", "navigator", "fetch",
  "not", "is", "some", "match", "fail",
]);

/**
 * Build the closure captures set for a function.
 * Captures = referenced names - local names - params - JS keywords.
 *
 * @param fnNode — the function declaration node
 * @returns Set of captured variable names
 */
function buildClosureCapturesForFunction(fnNode: FunctionDeclNode): Set<string> {
  const body = Array.isArray(fnNode.body) ? fnNode.body : [];
  const params = new Set(fnNode.params ?? []);
  const localNames = collectLocalNames(body);
  const referencedNames = collectReferencedNames(body);

  const captures = new Set<string>();
  for (const name of referencedNames) {
    if (!params.has(name) && !localNames.has(name)) {
      captures.add(name);
    }
  }
  return captures;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/** Input to the RI stage. */
export interface RIInput {
  files: FileAST[];
  protectAnalysis: ProtectAnalysis;
}

/** Output of the RI stage. */
export interface RIOutput {
  routeMap: RouteMap;
  errors: (RIError | { code: string; message: string; severity: string; filePath: string })[];
}

/**
 * Run the Route Inferrer (RI, Stage 5).
 */
export function runRI(input: RIInput): RIOutput {
  const { files, protectAnalysis } = input;

  // Reset the route counter for deterministic output within a single runRI call.
  _routeCounter = 0;

  const functions = new Map<string, FunctionRoute>();
  const errors: (RIError | { code: string; message: string; severity: string; filePath: string })[] = [];

  // ------------------------------------------------------------------
  // Step 1: Build a global set of all protected field names across all
  // db state blocks, and a mapping from field name → StateBlockId.
  // ------------------------------------------------------------------

  const allProtectedFields = new Set<string>();
  const stateBlockIdByField = new Map<string, string>();

  if (protectAnalysis && protectAnalysis.views) {
    for (const [stateBlockId, dbTypeViews] of protectAnalysis.views) {
      if (dbTypeViews.tables) {
        for (const [, tableTypeView] of dbTypeViews.tables) {
          if (tableTypeView.protectedFields) {
            for (const fieldName of tableTypeView.protectedFields) {
              allProtectedFields.add(fieldName);
              stateBlockIdByField.set(fieldName, stateBlockId);
            }
          }
        }
      }
    }
  }

  // ------------------------------------------------------------------
  // Step 2: Build a global function index for transitive escalation.
  // ------------------------------------------------------------------
  const functionIndex = buildFunctionIndex(files);

  // ------------------------------------------------------------------
  // Step 2b: Build a set of function names imported from server-only
  // scrml: modules.
  // ------------------------------------------------------------------
  const importedServerFnNames = buildImportedServerFnNames(files);

  // ------------------------------------------------------------------
  // Step 2c: Insight 26 Batch 1 (2026-05-08) — per-file map of names
  // imported from server-only sources, used by walkBodyForTriggers to
  // detect member-access references like `redis.get(key)`.
  // ------------------------------------------------------------------
  const perFileImportedServerNamespaces = buildPerFileImportedServerNamespaces(files);

  // ------------------------------------------------------------------
  // Step 3: First pass — collect all function nodes and compute DIRECT
  // escalation (no transitive resolution yet).
  // ------------------------------------------------------------------

  const analysisMap = new Map<string, AnalysisRecord>();

  for (const fileAST of files) {
    const filePath = fileAST.filePath;
    const fnNodes = collectFileFunctions(fileAST);

    // Collect the span.start values of functions inside worker bodies
    // (<program name="...">) so we can suppress E-ROUTE-001 for them.
    const workerBodyFnIds = collectWorkerBodyFunctionIds(fileAST);

    // Per-file imported server namespaces (Insight 26 D2c).
    const fileImportedNamespaces = perFileImportedServerNamespaces.get(filePath) ?? new Set<string>();

    for (const fnNode of fnNodes) {
      const fnNodeId = makeFunctionNodeId(filePath, fnNode);

      // Trigger 4: explicit server annotation.
      const explicitTriggers: EscalationReason[] = [];
      if (fnNode.isServer === true) {
        explicitTriggers.push({
          kind: "explicit-annotation",
          span: fnNode.span,
        });
      }

      // Scan the function body for direct triggers and callees.
      // E-ROUTE-001 is suppressed for functions inside worker bodies.
      const body = Array.isArray(fnNode.body) ? fnNode.body : [];
      const isWorkerBody = workerBodyFnIds.has(fnNode.span.start);
      const { triggers: bodyTriggers, callees, warnings } = walkBodyForTriggers(
        body,
        allProtectedFields,
        stateBlockIdByField,
        filePath,
        isWorkerBody,
        fileImportedNamespaces,
      );

      const directTriggers: EscalationReason[] = [...explicitTriggers, ...bodyTriggers];

      // Build closure captures for this function.
      const closureCaptures = buildClosureCapturesForFunction(fnNode);

      analysisMap.set(fnNodeId, {
        fnNodeId,
        filePath,
        fnNode,
        isPure: false,
        directTriggers,
        callees,
        warnings,
        closureCaptures,
      });
    }
  }

  // ------------------------------------------------------------------
  // Step 4: Direct-only escalation — no transitive callee inheritance.
  // A function is server-escalated only by its own direct triggers:
  //   - explicit `server` annotation
  //   - ?{} SQL block in the function body
  //   - access to protect= fields
  //   - access to session object
  //   - access to server-only resources (Bun.file, Bun.env, fs.*, etc.)
  // Calling a server function is NOT a trigger. The caller stays client-side
  // and uses a fetch stub at codegen time (§12 escalation rules, RI spec header).
  // ------------------------------------------------------------------

  /**
   * Resolve escalation reasons for a function node ID.
   * Returns ONLY the function's own direct triggers — does not recurse into callees.
   * A function that calls server functions stays client-side and uses fetch stubs.
   * It can freely mutate reactive state (§12 escalation rules + the F-RI-001
   * canonical Promise-chain pattern). Capture-based taint is layered on top by
   * Step 5b, not here.
   */
  function resolveEscalation(fnNodeId: string): EscalationReason[] {
    const record = analysisMap.get(fnNodeId);
    if (!record) return []; // External function — non-escalating.
    return [...record.directTriggers];
  }

  // ------------------------------------------------------------------
  // Step 5: Pre-resolve all directly server-escalated function IDs.
  // resolvedServerFnIds contains ONLY directly-escalated functions.
  // This set is used by CPS analysis to identify server calls within
  // client function bodies, enabling the server/client boundary split.
  // ------------------------------------------------------------------

  const escalationResults = new Map<string, { allReasons: EscalationReason[]; deduped: EscalationReason[] }>();
  const resolvedServerFnIds = new Set<string>();

  for (const [fnNodeId] of analysisMap) {
    const allReasons = resolveEscalation(fnNodeId);
    const deduped = deduplicateReasons(allReasons);
    escalationResults.set(fnNodeId, { allReasons, deduped });
    if (allReasons.length > 0) {
      resolvedServerFnIds.add(fnNodeId);
    }
  }

  // ------------------------------------------------------------------
  // Step 5b: Capture-based taint propagation via fixed-point iteration.
  //
  // If function A captures variable V, and V is the name of a function
  // that is server-tainted, then A is also server-tainted. This handles
  // closures that close over server-side functions or data.
  //
  // Unlike callee-based escalation (which uses fetch stubs), capture-based
  // taint means the function CLOSES OVER server state/behavior — it cannot
  // be split at the boundary.
  //
  // The lattice is: pure < client < server. Join = max.
  // Fixed-point iteration terminates because:
  //   1. The lattice is finite (3 levels)
  //   2. Each iteration can only promote a function UP the lattice
  //   3. Once server, a function stays server
  //   4. MAX_ITER guard prevents runaway in pathological cases
  // ------------------------------------------------------------------

  // Build name → fnNodeId mapping for capture lookup
  const fnNameToNodeIds = new Map<string, string[]>();
  for (const [fnNodeId, record] of analysisMap) {
    const name = record.fnNode.name;
    if (!name) continue;
    if (!fnNameToNodeIds.has(name)) fnNameToNodeIds.set(name, []);
    fnNameToNodeIds.get(name)!.push(fnNodeId);
  }

  // Also collect all reactive variable names declared at file scope —
  // if a function captures a server @var, it needs server context.
  // (Currently server @var produces server-tainted state-decl nodes,
  // which are not function nodes. For now, capture of @var names does
  // not propagate taint — the @var is accessed via _scrml_reactive_get
  // which is a runtime call, not a compile-time boundary concern.
  // This comment documents the design boundary.)

  const MAX_CAPTURE_TAINT_ITER = analysisMap.size + 1;
  let captureTaintChanged = true;
  let captureTaintIter = 0;

  while (captureTaintChanged && captureTaintIter < MAX_CAPTURE_TAINT_ITER) {
    captureTaintChanged = false;
    captureTaintIter++;

    for (const [fnNodeId, record] of analysisMap) {
      // Already server-tainted — nothing to propagate
      if (resolvedServerFnIds.has(fnNodeId)) continue;

      // Exclude callees from capture taint — calling a server function uses
      // a fetch stub (stays client). Only non-called captures trigger taint.
      const calleesSet = new Set(record.callees);

      // Check if any captured name is a server-tainted function
      for (const capturedName of record.closureCaptures) {
        // Skip names that are called (use fetch stubs) — only pure captures taint.
        if (calleesSet.has(capturedName)) continue;
        const capturedFnIds = fnNameToNodeIds.get(capturedName);
        if (!capturedFnIds) continue;

        for (const capturedFnId of capturedFnIds) {
          if (resolvedServerFnIds.has(capturedFnId)) {
            // This function captures a server-tainted function — propagate taint
            const capturedRecord = analysisMap.get(capturedFnId);
            const captureTaintReason: EscalationReason = {
              kind: "server-only-resource",
              resourceType: `closure-capture:${capturedName}`,
              span: record.fnNode.span,
            };

            // Update the analysis records
            record.directTriggers.push(captureTaintReason);
            resolvedServerFnIds.add(fnNodeId);

            // Update escalationResults
            const existing = escalationResults.get(fnNodeId);
            if (existing) {
              existing.allReasons.push(captureTaintReason);
              existing.deduped = deduplicateReasons(existing.allReasons);
            } else {
              escalationResults.set(fnNodeId, {
                allReasons: [captureTaintReason],
                deduped: [captureTaintReason],
              });
            }

            captureTaintChanged = true;
            break; // One taint reason is sufficient — move to next function
          }
        }
        if (resolvedServerFnIds.has(fnNodeId)) break;
      }
    }
  }

  // ------------------------------------------------------------------
  // Step 5c: Caller-context propagation (Insight 26 Batch 1, 2026-05-08).
  //
  // Forward fixed-point: a function with NO direct triggers and NO
  // capture taint, called ONLY from server-classified callers (and never
  // from any client-classified function), escalates to server.
  //
  // This is the load-bearing precondition that makes Position B safe
  // (server keyword deprecation): functions that exist only to be called
  // from server contexts get correctly classified server even without
  // explicit annotation or body triggers.
  //
  // Rules:
  //   - Function with at least one client caller stays AMBIENT (client-
  //     classified for now; codegen handles the cross-boundary call via
  //     fetch stub at call site, current behavior preserved).
  //   - Function with no callers at all stays unchanged (Step 6's D4
  //     dead-code-warn handles those separately).
  //   - Function called ONLY by server-classified functions promotes to
  //     server.
  //   - Cycles where neither cycle member has direct triggers and the
  //     cycle has no external server callers: stay client (the lattice
  //     join is monotonic; without a "seed" server caller, propagation
  //     never starts).
  //
  // The algorithm is monotonic (only ever PROMOTES client→server, never
  // demotes), so the lattice fixed-point terminates in at most
  // analysisMap.size iterations.
  // ------------------------------------------------------------------

  // Build inverse caller map: calleeFnNodeId → Set<callerFnNodeId>.
  // Resolves callees by name via fnNameToNodeIds (already built for 5b).
  const inverseCallerMap = new Map<string, Set<string>>();
  for (const [callerFnNodeId, callerRecord] of analysisMap) {
    for (const calleeName of callerRecord.callees) {
      const calleeFnIds = fnNameToNodeIds.get(calleeName);
      if (!calleeFnIds) continue;
      for (const calleeFnId of calleeFnIds) {
        if (!inverseCallerMap.has(calleeFnId)) inverseCallerMap.set(calleeFnId, new Set());
        inverseCallerMap.get(calleeFnId)!.add(callerFnNodeId);
      }
    }
  }

  const MAX_CALLER_CTX_ITER = analysisMap.size + 1;
  let callerCtxChanged = true;
  let callerCtxIter = 0;

  while (callerCtxChanged && callerCtxIter < MAX_CALLER_CTX_ITER) {
    callerCtxChanged = false;
    callerCtxIter++;

    for (const [fnNodeId, record] of analysisMap) {
      // Already server-classified — no propagation needed.
      if (resolvedServerFnIds.has(fnNodeId)) continue;

      // §39.3: handle() escape hatch is middleware, not server. Skip.
      if ((record.fnNode as any).isHandleEscapeHatch === true) continue;

      const callers = inverseCallerMap.get(fnNodeId);
      if (!callers || callers.size === 0) continue;

      // Classify callers. Skip self-references (cycles) — a function calling
      // itself doesn't add information for propagation.
      let serverCallerCount = 0;
      let clientCallerCount = 0;
      for (const callerId of callers) {
        if (callerId === fnNodeId) continue; // self-reference
        if (resolvedServerFnIds.has(callerId)) {
          serverCallerCount++;
        } else {
          clientCallerCount++;
        }
      }

      // No non-self callers → cycle-only or self-only → skip.
      if (serverCallerCount === 0 && clientCallerCount === 0) continue;

      // ANY client caller → stay AMBIENT (current behavior preserved).
      if (clientCallerCount > 0) continue;

      // ALL non-self callers are server-classified → promote.
      const propagatedReason: EscalationReason = {
        kind: "server-only-resource",
        resourceType: "caller-context-propagation",
        span: record.fnNode.span,
      };

      record.directTriggers.push(propagatedReason);
      resolvedServerFnIds.add(fnNodeId);

      const existing = escalationResults.get(fnNodeId);
      if (existing) {
        existing.allReasons.push(propagatedReason);
        existing.deduped = deduplicateReasons(existing.allReasons);
      } else {
        escalationResults.set(fnNodeId, {
          allReasons: [propagatedReason],
          deduped: [propagatedReason],
        });
      }

      callerCtxChanged = true;
    }
  }

  // ------------------------------------------------------------------
  // Step 5d: Insight 26 Batch 1 D4+D5 (2026-05-08) — emit deprecation +
  // dead-function diagnostics.
  //
  // D4: W-DEAD-FUNCTION fires for a function with NO callers (anywhere
  //     in the project) AND NOT exported AND NOT explicitly server-
  //     annotated AND whose name does not appear as an identifier in any
  //     markup attribute value or any bare-expr text outside its own body.
  //
  // D5: W-DEPRECATED-SERVER-MODIFIER fires for a function with `isServer`
  //     === true AND at least one OTHER (non-explicit-annotation)
  //     escalation reason. The keyword is redundant in this case;
  //     the function would still be classified server even without it.
  // ------------------------------------------------------------------

  // Build the set of exported function names (per file) — exporting a
  // function makes it potentially-callable from outside the project, so
  // it is never "dead" by RI's body-callee analysis alone.
  // CE wraps FileAST in `.ast`; unit tests pass bare FileAST. Try both.
  const exportedFnNames = new Set<string>();
  for (const fileAST of files) {
    const exps = (fileAST.exports ?? ((fileAST as any).ast ? (fileAST as any).ast.exports : [])) as
      Array<{ exportedName: string | null }>;
    for (const exp of exps ?? []) {
      if (exp && exp.exportedName) exportedFnNames.add(exp.exportedName);
    }
  }

  // Build the set of identifier-like tokens that appear ANYWHERE in the
  // project's markup attribute values, raw markup text, or bare-expr text
  // OUTSIDE the body of the function being analyzed. This is used as a
  // conservative "may be referenced from markup" check.
  //
  // RI does NOT walk markup ASTs in detail (the body-callee pass only
  // looks at function bodies). Without this heuristic, a function called
  // only from `<button onclick={fn}>` would falsely fire W-DEAD-FUNCTION.
  // The cost of this heuristic is at most O(total-source-text length).
  const markupReferencedNames = new Set<string>();
  const IDENT_RE = /[A-Za-z_$][A-Za-z0-9_$]*/g;
  function collectIdentsFromText(text: string): void {
    if (!text) return;
    let m: RegExpExecArray | null;
    while ((m = IDENT_RE.exec(text)) !== null) {
      markupReferencedNames.add(m[0]);
    }
  }
  // Walker collects identifier names ONLY from MARKUP-context text:
  //   - markup attribute values (e.g. onclick="handleClick()")
  //   - markup attribute exprNodes (newer canonical form)
  //   - bare-expr nodes nested inside markup AS markup interpolations
  //   - text nodes (raw markup text)
  //
  // Identifiers found inside FUNCTION BODIES are NOT collected — those
  // are tracked by the body-callee analysis (record.callees), which feeds
  // the inverseCallerMap. Including them here would falsely mask dead
  // self-recursive functions (a function calling only itself is still
  // dead).
  //
  // The walker is intentionally over-inclusive of EXTERNAL references:
  // false positives in markupReferencedNames simply suppress the
  // (advisory) W-DEAD-FUNCTION, which is the safe direction.
  function walkMarkupContext(node: any): void {
    if (!node || typeof node !== "object") return;

    // STOP at function-decl: do NOT collect identifiers from inside any
    // function body. Body-callee analysis handles those references.
    if (node.kind === "function-decl") return;

    if (node.kind === "markup" && Array.isArray(node.attrs)) {
      for (const a of node.attrs) {
        if (!a) continue;
        // Legacy / direct-string attribute values.
        if (typeof a.value === "string") collectIdentsFromText(a.value);
        if (a.exprNode) collectIdentsFromText(emitStringFromTree(a.exprNode));
        if (typeof a.raw === "string") collectIdentsFromText(a.raw);
        // Structured AttrValue forms (canonical AST shape).
        const av = a.value;
        if (av && typeof av === "object") {
          // call-ref: e.g. `onclick=handleClick(arg)` — collect callee name + arg idents.
          if (av.kind === "call-ref") {
            if (av.name) markupReferencedNames.add(av.name);
            if (Array.isArray(av.args)) {
              for (const arg of av.args) {
                if (typeof arg === "string") collectIdentsFromText(arg);
              }
            }
            if (Array.isArray(av.argExprNodes)) {
              for (const en of av.argExprNodes) {
                if (en) collectIdentsFromText(emitStringFromTree(en));
              }
            }
          }
          // variable-ref: e.g. `class=someVar` — collect the reference.
          if (av.kind === "variable-ref" && av.name) {
            markupReferencedNames.add(av.name);
            if (av.exprNode) collectIdentsFromText(emitStringFromTree(av.exprNode));
          }
          // expr: e.g. `class={cond ? 'a' : 'b'}` — collect from raw / exprNode.
          if (av.kind === "expr") {
            if (typeof av.raw === "string") collectIdentsFromText(av.raw);
            if (av.exprNode) collectIdentsFromText(emitStringFromTree(av.exprNode));
            if (Array.isArray(av.refs)) for (const r of av.refs) markupReferencedNames.add(r);
          }
          // string-literal: e.g. `class="foo"` — usually not a fn ref, but
          // be conservative and collect identifiers anyway.
          if (av.kind === "string-literal" && typeof av.value === "string") {
            collectIdentsFromText(av.value);
          }
        }
      }
    }
    // Bare-expr text inside markup interpolations (`${fn()}` in markup).
    // Note: we walk ALL bare-expr at logic-block top level too, but
    // function-decl returns above, so these are limited to non-function
    // contexts (markup interpolations + top-level logic statements).
    if (node.kind === "bare-expr") {
      const txt = node.exprNode ? emitStringFromTree(node.exprNode) : (node.expr ?? "");
      collectIdentsFromText(txt);
    }
    if (node.kind === "text" && typeof node.text === "string") {
      collectIdentsFromText(node.text);
    }
    // Recurse into children/body/etc.
    for (const key of Object.keys(node)) {
      if (key === "span" || key === "id") continue;
      const val = node[key];
      if (Array.isArray(val)) {
        for (const child of val) walkMarkupContext(child);
      } else if (val && typeof val === "object" && val.kind) {
        walkMarkupContext(val);
      }
    }
  }
  for (const fileAST of files) {
    // CE wraps the FileAST in `.ast`; bare-FileAST inputs (unit tests) keep
    // .nodes at the top level. Try both, same idiom as buildImportedServerFnNames.
    const nodes = fileAST.nodes ?? ((fileAST as any).ast ? (fileAST as any).ast.nodes : []) ?? [];
    for (const top of nodes) walkMarkupContext(top);
  }

  // Now emit D4 (W-DEAD-FUNCTION) + D5 (W-DEPRECATED-SERVER-MODIFIER).
  for (const [fnNodeId, record] of analysisMap) {
    const fnName = record.fnNode.name;
    if (!fnName) continue;

    // §39.3: handle() escape hatch is middleware — never dead-warn or
    // deprecation-warn (it is not a normal user function).
    if ((record.fnNode as any).isHandleEscapeHatch === true) continue;

    // -- D4: W-DEAD-FUNCTION --------------------------------------------
    const callers = inverseCallerMap.get(fnNodeId);
    const hasCallers = callers !== undefined && callers.size > 0 &&
      // Only count non-self callers; a function calling only itself is
      // still effectively dead.
      Array.from(callers).some(c => c !== fnNodeId);
    const isExported = exportedFnNames.has(fnName);
    const isExplicitServer = record.fnNode.isServer === true;
    const isMarkupReferenced = markupReferencedNames.has(fnName);

    // Functions that are also generators (SSE) are explicitly intended as
    // entry points; never dead-warn.
    const isGenerator = (record.fnNode as any).isGenerator === true;

    if (!hasCallers && !isExported && !isExplicitServer && !isMarkupReferenced && !isGenerator) {
      const warn = new RIError(
        "W-DEAD-FUNCTION",
        `W-DEAD-FUNCTION: Function \`${fnName}\` has no callers, is not exported, ` +
        `is not server-annotated, and is not referenced from markup. ` +
        `It will be tree-shaken from the output. Remove the declaration if intended dead, ` +
        `or wire it up to a caller. ` +
        `(Note: RI does not yet track all markup reference patterns; ` +
        `if this is a false positive, export the function or add an explicit caller.)`,
        record.fnNode.span,
      );
      warn.severity = "warning";
      errors.push(warn);
    }

    // -- D5: W-DEPRECATED-SERVER-MODIFIER -------------------------------
    if (isExplicitServer) {
      const escalation = escalationResults.get(fnNodeId);
      const otherReasons = (escalation?.deduped ?? []).filter(
        r => r.kind !== "explicit-annotation",
      );

      // Body-trigger evidence (T1/T2/T3 + capture-taint).
      let triggerDesc: string | null = null;
      if (otherReasons.length > 0) {
        const first = otherReasons[0];
        if (first.kind === "server-only-resource") {
          triggerDesc = `server-only resource (${first.resourceType})`;
        } else if (first.kind === "protected-field-access") {
          triggerDesc = `protected field access (${first.field})`;
        } else {
          triggerDesc = first.kind;
        }
      } else if (callers && callers.size > 0) {
        // Caller-context-propagation evidence: D3 didn't run for this
        // function (already server via Trigger 4), but if it WOULD have
        // promoted under D3 (all non-self callers are server), the
        // keyword is redundant.
        let serverCallerCount = 0;
        let clientCallerCount = 0;
        for (const callerId of callers) {
          if (callerId === fnNodeId) continue;
          if (resolvedServerFnIds.has(callerId)) {
            serverCallerCount++;
          } else {
            clientCallerCount++;
          }
        }
        if (serverCallerCount > 0 && clientCallerCount === 0) {
          triggerDesc = "caller-context-propagation";
        }
      }

      if (triggerDesc !== null) {
        // The keyword is redundant — the function would escalate anyway.
        const warn = new RIError(
          "W-DEPRECATED-SERVER-MODIFIER",
          `W-DEPRECATED-SERVER-MODIFIER: 'server' modifier on \`${fnName}\` is redundant ` +
          `— function body already escalates to server via ${triggerDesc}. ` +
          `The 'server' keyword is deprecated; remove from new code. ` +
          `(Per Insight 26, 2026-05-08: body-content inference + caller-context propagation ` +
          `now classify server functions structurally.)`,
          record.fnNode.span,
        );
        warn.severity = "warning";
        errors.push(warn);
      }
    }
  }

  // ------------------------------------------------------------------
  // Step 6: Finalize RouteMap entries, apply CPS analysis, collect errors.
  // ------------------------------------------------------------------

  for (const [fnNodeId, record] of analysisMap) {
    // Accumulate E-ROUTE-001 warnings (with severity propagated).
    for (const w of record.warnings) {
      const riErr = new RIError(w.code, w.message, w.span);
      if (w.severity) riErr.severity = w.severity;
      errors.push(riErr);
    }

    // §39.3: handle() escape hatch — treat as middleware boundary.
    if ((record.fnNode as any).isHandleEscapeHatch === true) {
      functions.set(fnNodeId, {
        functionNodeId: fnNodeId,
        boundary: "middleware",
        escalationReasons: [],
        generatedRouteName: null,
        explicitRoute: null,
        explicitMethod: null,
        isSSE: false,
        serverEntrySpan: null,
        cpsSplit: null,
      });
      continue;
    }

    const { allReasons, deduped } = escalationResults.get(fnNodeId)!;

    const isServer = allReasons.length > 0;
    const boundary: "client" | "server" = isServer ? "server" : "client";

    let cpsSplit: CPSSplit | null = null;

    if (isServer) {
      const body = Array.isArray(record.fnNode.body) ? record.fnNode.body : [];

      // §36: SSE generator functions — skip E-RI-002 and CPS analysis.
      if ((record.fnNode as any).isGenerator === true) {
        // Generator functions skip CPS and E-RI-002. cpsSplit remains null.
      } else {
        const reactiveAssignment = findReactiveAssignment(body);

        if (reactiveAssignment !== null) {
          const cpsResult = analyzeCPSEligibility(
            body,
            allProtectedFields,
            stateBlockIdByField,
            functionIndex,
            analysisMap,
            resolvedServerFnIds,
            importedServerFnNames,
            // Insight 26 D2c: per-file server-only imported namespaces.
            perFileImportedServerNamespaces.get(record.filePath) ?? new Set<string>(),
          );

          if (cpsResult && cpsResult.eligible) {
            cpsSplit = {
              serverStmtIndices: cpsResult.serverStmtIndices,
              clientStmtIndices: cpsResult.clientStmtIndices,
              returnVarName: cpsResult.returnVarName,
            };
          } else {
            // CPS not applicable: fire E-RI-002 for ANY server-escalated function.
            //
            // C18 (§38.4): channel-scoped server functions that write to a
            // channel-cell are spec-permitted per §38.4 line 15677 (writes
            // emit `__sync` wire frames). However, the server-side codegen
            // for `@cell = expr` currently emits `_scrml_reactive_set(...)`
            // which is a client-side runtime symbol — the emitted server
            // module would crash at request time. Rather than claim a
            // feature that breaks at runtime, retain E-RI-002 here and
            // surface the gap explicitly: server-side channel-cell read/
            // write semantics are deferred to a follow-up step. Adopters
            // can still use channel-scoped server functions that take args
            // + call `broadcast()` — the most common Phoenix-style pattern.
            errors.push(new RIError(
              "E-RI-002",
              `E-RI-002: Server-escalated function \`${record.fnNode.name ?? "<anonymous>"}\` ` +
              `assigns to a \`@\` reactive variable. Reactive state is client-side; server ` +
              `functions cannot mutate it directly. Move the reactive assignment to a client-side ` +
              `callback, or restructure the function so the reactive mutation occurs on the client.`,
              (reactiveAssignment as any).span ?? record.fnNode.span,
            ));
          }
        }
      }
    }

    // Build the FunctionRoute entry.
    const hasExplicitRoute = !!(record.fnNode as any).route;
    const generatedRouteName = isServer
      ? (hasExplicitRoute ? (record.fnNode as any).route : generateRouteName(record.fnNode.name ?? "anon"))
      : null;

    const serverEntrySpan = isServer ? record.fnNode.span : null;

    // §36: generator server functions are SSE endpoints (GET, text/event-stream)
    const isSSE = isServer && (record.fnNode as any).isGenerator === true;

    functions.set(fnNodeId, {
      functionNodeId: fnNodeId,
      boundary,
      escalationReasons: deduped,
      generatedRouteName,
      explicitRoute: hasExplicitRoute ? (record.fnNode as any).route : null,
      explicitMethod: isSSE ? "GET" : ((record.fnNode as any).method ?? null),
      isSSE,
      serverEntrySpan,
      cpsSplit,
    });
  }

  // ------------------------------------------------------------------
  // Step 7: Build page route tree from file paths (file-based routing).
  // ------------------------------------------------------------------

  const pages = buildPageRouteTree(files);

  // ------------------------------------------------------------------
  // Step 8: Collect auth middleware from <program auth="required"> across
  // all files.
  // ------------------------------------------------------------------

  const authMiddleware = new Map<string, AuthMiddleware>();

  // 8a: Explicit auth= from <program auth="required">
  for (const fileAST of files) {
    const authConfig = fileAST.authConfig ?? ((fileAST as any).ast ? (fileAST as any).ast.authConfig : null);
    if (!authConfig || authConfig.auth !== "required") continue;

    authMiddleware.set(fileAST.filePath, {
      filePath: fileAST.filePath,
      auth: authConfig.auth,
      loginRedirect: authConfig.loginRedirect ?? "/login",
      csrf: authConfig.csrf ?? "off",
      sessionExpiry: authConfig.sessionExpiry ?? "1h",
    });
  }

  // 8b: Auto-escalate auth for files with protect= fields
  if (protectAnalysis && protectAnalysis.views) {
    const filesWithProtectedFields = new Set<string>();
    for (const [stateBlockId] of protectAnalysis.views) {
      const filePath = stateBlockId.split("::")[0];
      const dbTypeViews = protectAnalysis.views.get(stateBlockId);
      if (dbTypeViews && dbTypeViews.tables) {
        for (const [, tableTypeView] of dbTypeViews.tables) {
          if (tableTypeView.protectedFields && tableTypeView.protectedFields.size > 0) {
            filesWithProtectedFields.add(filePath);
            break;
          }
        }
      }
    }

    for (const filePath of filesWithProtectedFields) {
      if (authMiddleware.has(filePath)) continue; // explicit auth= takes precedence
      authMiddleware.set(filePath, {
        filePath,
        auth: "required",
        loginRedirect: "/login",
        csrf: "auto",
        sessionExpiry: "1h",
        autoEscalated: true,
      });
      errors.push({
        code: "W-AUTH-001",
        message:
          `W-AUTH-001: File has protect= fields but no explicit auth= attribute. ` +
          `Auth middleware auto-injected (auth="required", csrf="auto"). ` +
          `Add <program auth="required"> to control auth settings explicitly.`,
        severity: "warning",
        filePath,
      });
    }
  }

  return {
    routeMap: { functions, pages, authMiddleware },
    errors,
  };
}

// ---------------------------------------------------------------------------
// File-based page routing
// ---------------------------------------------------------------------------

/**
 * Build a page route tree from file paths.
 *
 * Convention:
 *   - Files under a `routes/` directory are page routes.
 *   - `index.scrml` maps to the directory's path (e.g., routes/index.scrml → /).
 *   - `[param].scrml` maps to a dynamic segment (e.g., routes/users/[id].scrml → /users/:id).
 *   - `_layout.scrml` provides a shared layout wrapper for sibling routes.
 *   - `[...slug].scrml` is a catch-all route.
 *   - Files NOT under a `routes/` directory are treated as single-page apps (route = /).
 */
export function buildPageRouteTree(files: FileAST[]): Map<string, PageRoute> {
  const pages = new Map<string, PageRoute>();

  for (const fileAST of files) {
    const filePath = fileAST.filePath;

    const routesIdx = filePath.indexOf("/routes/");
    if (routesIdx === -1) {
      // Not under a routes/ directory — single-page app, mount at /
      pages.set(filePath, {
        filePath,
        urlPattern: "/",
        params: [],
        layoutFilePath: null,
        isCatchAll: false,
      });
      continue;
    }

    // Extract the relative path after routes/
    const relativePath = filePath.slice(routesIdx + "/routes/".length);

    // Skip _layout.scrml files — they are layout wrappers, not pages
    const fileName = relativePath.split("/").pop();
    if (fileName === "_layout.scrml") continue;

    // Convert file path to URL pattern
    const { urlPattern, params, isCatchAll } = filePathToUrlPattern(relativePath);

    // Look for a _layout.scrml in the same directory or ancestor directories
    const layoutFilePath = findLayoutFile(filePath, routesIdx);

    pages.set(filePath, {
      filePath,
      urlPattern,
      params,
      layoutFilePath,
      isCatchAll,
    });
  }

  return pages;
}

/**
 * Convert a relative file path (under routes/) to a URL pattern.
 *
 * Examples:
 *   "index.scrml"              → { urlPattern: "/", params: [], isCatchAll: false }
 *   "about.scrml"              → { urlPattern: "/about", params: [], isCatchAll: false }
 *   "users/[id].scrml"         → { urlPattern: "/users/:id", params: ["id"], isCatchAll: false }
 *   "users/index.scrml"        → { urlPattern: "/users", params: [], isCatchAll: false }
 *   "posts/[...slug].scrml"    → { urlPattern: "/posts/*slug", params: ["slug"], isCatchAll: true }
 */
function filePathToUrlPattern(relativePath: string): { urlPattern: string; params: string[]; isCatchAll: boolean } {
  // Remove .scrml extension
  const withoutExt = relativePath.replace(/\.scrml$/, "");

  // Split into segments
  const segments = withoutExt.split("/").filter(Boolean);

  const params: string[] = [];
  let isCatchAll = false;
  const urlSegments: string[] = [];

  for (const seg of segments) {
    // index at the end means the directory path itself
    if (seg === "index" && segments.indexOf(seg) === segments.length - 1) {
      continue;
    }

    // Catch-all: [...param]
    const catchAllMatch = seg.match(/^\[\.\.\.(\w+)\]$/);
    if (catchAllMatch) {
      params.push(catchAllMatch[1]);
      urlSegments.push(`*${catchAllMatch[1]}`);
      isCatchAll = true;
      continue;
    }

    // Dynamic segment: [param]
    const paramMatch = seg.match(/^\[(\w+)\]$/);
    if (paramMatch) {
      params.push(paramMatch[1]);
      urlSegments.push(`:${paramMatch[1]}`);
      continue;
    }

    // Static segment
    urlSegments.push(seg);
  }

  const urlPattern = "/" + urlSegments.join("/");

  return { urlPattern, params, isCatchAll };
}

/**
 * Find the nearest _layout.scrml file for a given page file.
 * Searches the same directory and ancestor directories up to the routes/ root.
 */
function findLayoutFile(filePath: string, routesIdx: number): string | null {
  const routesRoot = filePath.slice(0, routesIdx + "/routes/".length);
  let dir = filePath.slice(0, filePath.lastIndexOf("/"));

  while (dir.length >= routesRoot.length - 1) {
    const layoutPath = dir + "/_layout.scrml";
    // We cannot check the filesystem here (RI is a pure analysis pass).
    // Instead, we record the expected layout path.
    if (dir + "/" !== routesRoot || dir === routesRoot.slice(0, -1)) {
      return layoutPath;
    }
    // Move to parent directory
    const parentDir = dir.slice(0, dir.lastIndexOf("/"));
    if (parentDir === dir) break;
    dir = parentDir;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Deduplicate EscalationReason[] by kind + distinguishing field.
 * Preserves first occurrence of each unique reason.
 */
function deduplicateReasons(reasons: EscalationReason[]): EscalationReason[] {
  const seen = new Set<string>();
  const result: EscalationReason[] = [];
  for (const r of reasons) {
    let key: string;
    if (r.kind === "protected-field-access") {
      key = `pfa:${r.field}:${r.stateBlockId}`;
    } else if (r.kind === "server-only-resource") {
      key = `sor:${r.resourceType}`;
    } else if (r.kind === "explicit-annotation") {
      key = "ea";
    } else {
      key = JSON.stringify(r);
    }
    if (!seen.has(key)) {
      seen.add(key);
      result.push(r);
    }
  }
  return result;
}

