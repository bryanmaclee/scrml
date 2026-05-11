import { genVar } from "./var-counter.ts";
import { emitExpr, emitExprField, type EmitExprContext } from "./emit-expr.ts";
import { exprNodeCollectCallees } from "../expression-parser.ts";
import { emitLogicNode } from "./emit-logic.js";
import { CGError } from "./errors.ts";
import { isServerOnlyNode } from "./collect.ts";

/** A loosely-typed AST node from the pipeline. */
type ASTNode = Record<string, unknown>;

/** A route map with functions Map. */
interface RouteMap {
  functions: Map<string, { boundary?: string; functionName?: string; [key: string]: unknown }>;
}

/** A dependency graph with nodes and edges. */
interface DepGraph {
  nodes?: Map<string, { span?: { start?: number; file?: string }; [key: string]: unknown }>;
  edges?: Array<{ kind?: string; from?: string; to?: string; [key: string]: unknown }>;
}

/**
 * Extract direct callee names from an expression string.
 * @param {string} expr
 * @returns {string[]}
 */
export function extractCalleeNames(expr: string): string[] {
  const names: string[] = [];
  const re = /\b([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;
  let m;
  while ((m = re.exec(expr)) !== null) {
    names.push(m[1]);
  }
  return names;
}

/**
 * Check if a function node has any callees that are server-boundary.
 * @param {ASTNode} fnNode
 * @param {RouteMap} routeMap
 * @param {string} filePath
 * @returns {boolean}
 */
export function hasServerCallees(fnNode: ASTNode, routeMap: RouteMap, filePath: string): boolean {
  // Build a set of server function names from routeMap
  const serverFnNames = new Set<string>();
  for (const [, route] of routeMap.functions) {
    if (route.boundary === "server" && route.functionName) {
      serverFnNames.add(route.functionName as string);
    }
  }
  if (serverFnNames.size === 0) return false;

  const body = (fnNode.body as ASTNode[]) ?? [];
  for (const stmt of body) {
    if (!stmt) continue;
    if ((stmt as ASTNode).kind === "bare-expr") {
      // Phase 4d: ExprNode-first callee extraction, string fallback
      const callees = (stmt as any).exprNode
        ? exprNodeCollectCallees((stmt as any).exprNode)
        : extractCalleeNames(((stmt as ASTNode).expr as string) ?? "");
      for (const callee of callees) {
        if (serverFnNames.has(callee)) return true;
      }
    }
  }
  return false;
}

/**
 * Find the DG node ID matching a logic statement.
 * @param {ASTNode} stmt
 * @param {DepGraph} depGraph
 * @param {string} filePath
 * @returns {string|null}
 */
export function findDGNodeForStmt(stmt: ASTNode, depGraph: DepGraph, filePath: string): string | null {
  if (!depGraph.nodes || !(stmt as ASTNode).span) return null;
  const stmtSpan = (stmt as ASTNode).span as { start?: number; file?: string };
  for (const [nodeId, dgNode] of depGraph.nodes) {
    if (dgNode.span && (dgNode.span as { start?: number }).start === stmtSpan.start &&
        ((dgNode.span as { file?: string }).file === stmtSpan.file || (dgNode.span as { file?: string }).file === filePath)) {
      return nodeId;
    }
  }
  return null;
}

/**
 * Check if a statement is a server call expression.
 * @param {ASTNode} stmt
 * @param {RouteMap} routeMap
 * @param {string} filePath
 * @returns {boolean}
 */
export function isServerCallExpr(stmt: ASTNode, routeMap: RouteMap, filePath: string): boolean {
  if (!stmt) return false;
  // Phase 4d: ExprNode-first callee extraction, string fallback
  const exprNodeField = (stmt as any).exprNode ?? (stmt as any).initExpr;
  const callees = exprNodeField
    ? exprNodeCollectCallees(exprNodeField)
    : extractCalleeNames(typeof ((stmt as ASTNode).expr ?? (stmt as ASTNode).init ?? "") === "string" ? ((stmt as ASTNode).expr ?? (stmt as ASTNode).init ?? "") as string : "");
  if (callees.length === 0) return false;
  // Build a set of server function names from routeMap
  const serverFnNames = new Set<string>();
  for (const [fnNodeId, route] of routeMap.functions) {
    if (route.boundary === "server" && route.functionName) {
      serverFnNames.add(route.functionName as string);
    }
  }
  for (const callee of callees) {
    if (serverFnNames.has(callee)) return true;
  }
  return false;
}

/**
 * Extract the initializer expression from a let-decl or const-decl.
 * @param {ASTNode} stmt
 * @returns {string}
 */
export function extractInitExpr(stmt: ASTNode): string {
  const _exprCtx: EmitExprContext = { mode: "client" };
  // Phase 4d: prefer ExprNode fields, fall back to string fields via emitExprField
  const initStr = typeof (stmt as ASTNode).init === "string" ? (stmt as ASTNode).init as string : "";
  const exprStr = typeof (stmt as ASTNode).expr === "string" ? (stmt as ASTNode).expr as string : "";
  if ((stmt as any).initExpr || initStr) return emitExprField((stmt as any).initExpr, initStr || "undefined", _exprCtx);
  if ((stmt as any).exprNode || exprStr) return emitExprField((stmt as any).exprNode, exprStr || "undefined", _exprCtx);
  return "undefined";
}

/**
 * Schedule statements in a function body using dependency graph information.
 *
 * Identifies groups of independent operations and wraps them in Promise.all.
 * Dependent operations are chained with await.
 *
 * Security invariant: SQL nodes, transaction blocks, and server-context meta nodes
 * MUST NOT be scheduled for client emission. If encountered, emit E-CG-006 and skip.
 *
 * @param {ASTNode[]} body
 * @param {ASTNode} fnNode
 * @param {RouteMap} routeMap
 * @param {DepGraph} depGraph
 * @param {string} filePath
 * @param {CGError[]} [errors]
 * @returns {string[]}
 */
export function scheduleStatements(body: ASTNode[], fnNode: ASTNode, routeMap: RouteMap, depGraph: DepGraph, filePath: string, errors: CGError[] = [], machineBindings?: Map<string, { engineName: string; tableName: string; rules: any[]; auditTarget?: string | null }> | null, engineBindings?: Map<string, { varName: string; forType: string; tableName: string }> | null, engineVarNames?: Set<string> | null, enginesWithHooks?: Set<string> | null, returnTypeAnnotation?: string | null, enclosingFnName?: string | null, enginesWithOnTimeout?: Set<string> | null, enginesWithIdleWatchdog?: Set<string> | null, enginesWithInternalRules?: Set<string> | null): string[] {
  const lines: string[] = [];
  // Track declared names so tilde-decl can detect reassignment vs first declaration
  const declaredNames = new Set<string>();
  // C5: scheduleStatements always emits a function body. State-decl nodes
  // inside are reassignments, not declarations — suppress _scrml_init_set
  // sidecar emission so the reset-to-init thunk preserves the canonical
  // declaration-time init expression.
  // C13: thread engineBindings + engineVarNames so engine direct writes and
  // .advance() calls inside fn bodies dispatch to the runtime hooks.
  // B17.4: thread enginesWithHooks so .advance() / direct-write call sites
  // wrap with the per-engine hook-firing function call.
  // A5-4 (§51.0.M): thread enginesWithOnTimeout so .advance() / direct-write
  // call sites pass the per-engine timer-config table identifier as the 4th
  // arg. Tree-shake at call site (omitted when the engine has no <onTimeout>).
  // C16: thread returnTypeAnnotation + enclosingFnName so return-stmt fires
  // §53.9.3 boundary checks for refinement-typed return types.
  const emitOpts: any = {
    declaredNames,
    insideFunctionBody: true,
    ...(machineBindings ? { machineBindings } : {}),
    ...(engineBindings ? { engineBindings } : {}),
    ...(engineVarNames && engineVarNames.size > 0 ? { engineVarNames } : {}),
    ...(enginesWithHooks && enginesWithHooks.size > 0 ? { enginesWithHooks } : {}),
    ...(enginesWithOnTimeout && enginesWithOnTimeout.size > 0 ? { enginesWithOnTimeout } : {}),
    ...(enginesWithIdleWatchdog && enginesWithIdleWatchdog.size > 0 ? { enginesWithIdleWatchdog } : {}),
    ...(enginesWithInternalRules && enginesWithInternalRules.size > 0 ? { enginesWithInternalRules } : {}),
    ...(returnTypeAnnotation ? { returnTypeAnnotation, enclosingFnName: enclosingFnName ?? null } : {}),
  };

  // Only use complex scheduling (Promise.all) for functions with actual server calls.
  // For purely client-side functions, emit sequentially — wrapping non-async statements
  // in Promise.all produces invalid JavaScript.
  const fnHasServerCalls = hasServerCallees(fnNode, routeMap, filePath);
  if (!fnHasServerCalls || !depGraph || !depGraph.nodes || depGraph.nodes.size === 0) {
    // No server calls or no dependency graph info — emit sequentially
    for (const stmt of body) {
      // Security guard: SQL, transaction-block, and server-context meta nodes must
      // not appear in client-boundary function bodies. RI should have caught this.
      if (isServerOnlyNode(stmt)) {
        errors.push(new CGError(
          "E-CG-006",
          `E-CG-006: ${(stmt as ASTNode).kind} node found in client-boundary function body. ` +
          `This code uses server-only features (${(stmt as ASTNode).kind}) but is marked to run in the browser. ` +
          `Move it to a server function or remove the client boundary.`,
          ((stmt as ASTNode).span ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 }) as object,
        ));
        continue;
      }
      const code = emitLogicNode(stmt, emitOpts);
      if (code) lines.push(code);
    }
    return lines;
  }

  // Build a map of which statements (by index) have awaits edges to other statements
  const stmtNodeIds: (string | null)[] = [];
  for (const stmt of body) {
    if (!stmt || !(stmt as ASTNode).span) {
      stmtNodeIds.push(null);
      continue;
    }
    // Try to find matching DG node
    const matchId = findDGNodeForStmt(stmt as ASTNode, depGraph, filePath);
    stmtNodeIds.push(matchId);
  }

  // Build dependency sets: which statement indices does each stmt depend on?
  const depSets = body.map(() => new Set<number>());
  for (const edge of (depGraph.edges ?? [])) {
    if (edge.kind !== "awaits") continue;
    const fromIdx = stmtNodeIds.indexOf(edge.from ?? null);
    const toIdx = stmtNodeIds.indexOf(edge.to ?? null);
    if (fromIdx >= 0 && toIdx >= 0) {
      depSets[fromIdx].add(toIdx);
    }
  }

  // Group independent statements (those with no inter-dependencies among the group)
  const visited = new Set<number>();
  let i = 0;
  while (i < body.length) {
    if (visited.has(i)) { i++; continue; }

    // Find a maximal group of independent statements starting from i
    const group: number[] = [i];
    visited.add(i);

    for (let j = i + 1; j < body.length; j++) {
      if (visited.has(j)) continue;
      // Check if j is independent of all current group members
      let independent = true;
      for (const gi of group) {
        if (depSets[j].has(gi) || depSets[gi].has(j)) {
          independent = false;
          break;
        }
      }
      if (independent) {
        group.push(j);
        visited.add(j);
      }
    }

    if (group.length > 1) {
      // Multiple independent operations — wrap in Promise.all
      const varNames: string[] = [];
      const callExprs: string[] = [];

      for (const idx of group) {
        const stmt = body[idx];
        // Security guard: skip server-only nodes in client scheduling path
        if (isServerOnlyNode(stmt)) {
          errors.push(new CGError(
            "E-CG-006",
            `E-CG-006: ${(stmt as ASTNode).kind} node found in client-boundary function body. ` +
            `This code uses server-only features (${(stmt as ASTNode).kind}) but is marked to run in the browser. ` +
            `Move it to a server function or remove the client boundary.`,
            ((stmt as ASTNode).span ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 }) as object,
          ));
          continue;
        }
        const code = emitLogicNode(stmt, emitOpts);
        if (!code) continue;

        if ((stmt as ASTNode).kind === "let-decl" || (stmt as ASTNode).kind === "const-decl") {
          varNames.push((stmt as ASTNode).name as string || genVar("tmp"));
          callExprs.push(extractInitExpr(stmt as ASTNode));
        } else {
          varNames.push(genVar("tmp"));
          callExprs.push(code.replace(/;$/, ""));
        }
      }

      if (callExprs.length > 1) {
        lines.push(`const [${varNames.join(", ")}] = await Promise.all([`);
        for (let k = 0; k < callExprs.length; k++) {
          const comma = k < callExprs.length - 1 ? "," : "";
          lines.push(`  ${callExprs[k]}${comma}`);
        }
        lines.push(`]);`);
      } else if (callExprs.length === 1) {
        lines.push(`const ${varNames[0]} = await ${callExprs[0]};`);
      }
    } else {
      // Single statement — emit with await if it has dependencies on prior statements
      const stmt = body[group[0]];
      // Security guard: skip server-only nodes in client scheduling path
      if (isServerOnlyNode(stmt)) {
        errors.push(new CGError(
          "E-CG-006",
          `E-CG-006: ${(stmt as ASTNode).kind} node found in client-boundary function body. ` +
          `This code uses server-only features (${(stmt as ASTNode).kind}) but is marked to run in the browser. ` +
          `Move it to a server function or remove the client boundary.`,
          ((stmt as ASTNode).span ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 }) as object,
        ));
        i++;
        continue;
      }
      const code = emitLogicNode(stmt, emitOpts);
      if (code) {
        if (isServerCallExpr(stmt as ASTNode, routeMap, filePath)) {
          if ((stmt as ASTNode).kind === "let-decl" || (stmt as ASTNode).kind === "const-decl") {
            const name = (stmt as ASTNode).name as string || genVar("tmp");
            lines.push(`const ${name} = await ${extractInitExpr(stmt as ASTNode)};`);
          } else {
            lines.push(`await ${code.replace(/;$/, "")};`);
          }
        } else {
          lines.push(code);
        }
      }
    }

    i++;
  }

  return lines;
}
