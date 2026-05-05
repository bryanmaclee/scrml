/**
 * @module codegen/reactive-deps
 *
 * AST-based reactive dependency extraction for the CG stage.
 *
 * Provides string-literal-aware extraction of @var references from expression strings,
 * replacing inline regex scanning in emit-event-wiring.js and emit-logic.js.
 *
 * The key improvement over naive regex: a scan of `@var` in `"use @theme here"` will
 * correctly return nothing (the reference is inside a string literal), whereas a bare
 * regex test on the full expression string would produce a false positive.
 *
 * Optionally filters results against a known set of reactive variable names collected
 * from the AST. This provides the scope-chain-based filtering described in Phase 4 of
 * the CG rewrite plan.
 */

import { getNodes } from "./collect.ts";
import { extractReactiveDepsFromAST, forEachIdentInExprNode, emitStringFromTree } from "../expression-parser.ts";

/** A loosely-typed AST node. */
type ASTNode = Record<string, unknown>;

// ---------------------------------------------------------------------------
// extractReactiveDeps
// ---------------------------------------------------------------------------

/**
 * Extract all reactive variable names (@var) referenced in an expression string.
 *
 * Respects string literal boundaries — @var inside quoted strings is NOT extracted.
 * Handles single-quoted, double-quoted, and template literal strings.
 * Handles escaped characters inside strings.
 *
 * @param expr — raw expression string (may contain @var references)
 * @param knownReactiveVars — if provided, only return names in this set
 * @returns set of reactive variable names (without @ prefix)
 */
export function extractReactiveDeps(
  expr: string,
  knownReactiveVars: Set<string> | null = null,
): Set<string> {
  if (!expr || typeof expr !== "string") return new Set();

  // Phase 1 restructure: try acorn-based extraction first.
  // Falls back to manual scanner for expressions acorn can't parse.
  try {
    const astResult = extractReactiveDepsFromAST(expr, knownReactiveVars);
    if (astResult.size > 0) return astResult;
  } catch {
    // Acorn parse failed — fall through to manual scanner
  }

  const found = new Set<string>();
  let inString: string | null = null; // null, '"', "'", or '`'
  let i = 0;

  while (i < expr.length) {
    const ch = expr[i];

    if (inString === null) {
      if (ch === '"' || ch === "'" || ch === '`') {
        inString = ch;
        i++;
        continue;
      }
      // Check for @varName pattern
      if (ch === '@') {
        // Peek ahead: must be followed by an identifier start char
        const rest = expr.slice(i + 1);
        const m = rest.match(/^([A-Za-z_$][A-Za-z0-9_$]*)/);
        if (m) {
          const varName = m[1];
          if (knownReactiveVars === null || knownReactiveVars.has(varName)) {
            found.add(varName);
          }
          i += 1 + varName.length;
          continue;
        }
      }
      i++;
    } else {
      // Inside a string literal
      if (ch === '\\') {
        // Skip the escaped character
        i += 2;
        continue;
      }
      if (ch === inString) {
        inString = null;
      }
      i++;
    }
  }

  return found;
}

// ---------------------------------------------------------------------------
// collectReactiveVarNames
// ---------------------------------------------------------------------------

/**
 * Collect all reactive variable names declared in a fileAST.
 *
 * Walks logic blocks for reactive-decl nodes and returns their names.
 * This gives a fast lookup set for use with extractReactiveDeps filtering.
 *
 * @param fileAST
 * @returns set of reactive variable names (without @ prefix)
 */
export function collectReactiveVarNames(fileAST: Record<string, unknown>): Set<string> {
  const names = new Set<string>();
  const nodes = getNodes(fileAST);

  // §51.9 — projected vars from derived machines are not declared via
  // reactive-decl; they're synthesized at runtime in _scrml_derived_fns.
  // Without them in this set, extractReactiveDeps filters out @ui references
  // in markup interpolations, and emit-event-wiring never wraps the DOM
  // binding in _scrml_effect — so writes to the source @order don't flow to
  // the DOM. Include projected var names so downstream effect emission sees
  // them as reactive.
  const machineRegistry = fileAST.machineRegistry as Map<string, unknown> | undefined;
  if (machineRegistry && typeof (machineRegistry as any).values === "function") {
    for (const m of (machineRegistry as Map<string, { isDerived?: boolean; projectedVarName?: string | null }>).values()) {
      if (m && m.isDerived && m.projectedVarName) {
        names.add(m.projectedVarName);
      }
    }
  }

  function visit(nodeList: unknown[]): void {
    if (!Array.isArray(nodeList)) return;
    for (const node of nodeList) {
      if (!node || typeof node !== "object") continue;
      const n = node as ASTNode;
      if (n.kind === "state-decl" && n.name) {
        names.add(n.name as string);
      }
      // Bug 4 fix: derived reactive decls (`const @name = expr`) must be
      // recognized by the markup display-wiring pass. Without them in this
      // set, `extractReactiveDeps` filters `${@isInsert}` out of binding
      // reactive refs, emit-event-wiring sees empty varRefs, no effect wrap
      // is emitted, and the named derived reference never updates in the DOM
      // after the first render. The wiring target calls _scrml_derived_get
      // inside _scrml_effect — on first run the derived fn evaluates, reads
      // its upstream @roots via _scrml_reactive_get, and the outer effect
      // picks up those deps. Subsequent mutations propagate dirty-flags and
      // re-fire the effect normally.
      if (n.kind === "reactive-derived-decl" && n.name) {
        names.add(n.name as string);
      }
      // Tilde-decl with reactive deps compiles to a derived reactive
      // Phase 4d: ExprNode-first — check initExpr for @-prefixed idents, string fallback
      if (n.kind === "tilde-decl" && n.name) {
        const initExpr = n.initExpr;
        const hasReactiveDep = initExpr
          ? _exprNodeHasReactiveRef(initExpr)
          : /@/.test((n.init as string) ?? "");
        if (hasReactiveDep) {
          names.add(n.name as string);
        }
      }
      if (n.kind === "logic" && Array.isArray(n.body)) {
        visit(n.body as unknown[]);
      }
      if (Array.isArray(n.children)) {
        visit(n.children as unknown[]);
      }
      // Recurse into control flow bodies (match arms, if/else, for/while, try)
      if (n.kind === "match-stmt" && Array.isArray((n as any).body)) {
        visit((n as any).body as unknown[]);
      }
      if (n.kind === "if-stmt") {
        if (Array.isArray((n as any).consequent)) visit((n as any).consequent as unknown[]);
        if (Array.isArray((n as any).alternate)) visit((n as any).alternate as unknown[]);
      }
      if ((n.kind === "for-stmt" || n.kind === "while-stmt") && Array.isArray((n as any).body)) {
        visit((n as any).body as unknown[]);
      }
      if (n.kind === "try-stmt") {
        if (Array.isArray((n as any).body)) visit((n as any).body as unknown[]);
        if ((n as any).catchNode && Array.isArray((n as any).catchNode.body)) visit((n as any).catchNode.body as unknown[]);
        if (Array.isArray((n as any).finallyBody)) visit((n as any).finallyBody as unknown[]);
      }
    }
  }

  visit(nodes as unknown[]);
  return names;
}

// ---------------------------------------------------------------------------
// collectDerivedVarNames
// ---------------------------------------------------------------------------

/**
 * Collect all derived reactive variable names declared in a fileAST.
 *
 * Walks logic blocks for reactive-derived-decl nodes and returns their names.
 * This set is used by rewriteReactiveRefs to route reads of derived names through
 * _scrml_derived_get() instead of _scrml_reactive_get().
 *
 * Per §6.6: `const @name = expr` declarations produce `reactive-derived-decl` nodes.
 * Their values live in the derived cache, not the reactive state map. Reads must use
 * _scrml_derived_get to benefit from lazy pull + dirty flag semantics.
 *
 * @param fileAST
 * @returns set of derived variable names (without @ prefix)
 */
export function collectDerivedVarNames(fileAST: Record<string, unknown>): Set<string> {
  const names = new Set<string>();
  const nodes = getNodes(fileAST);

  function visit(nodeList: unknown[]): void {
    if (!Array.isArray(nodeList)) return;
    for (const node of nodeList) {
      if (!node || typeof node !== "object") continue;
      const n = node as ASTNode;
      if (n.kind === "reactive-derived-decl" && n.name) {
        names.add(n.name as string);
      }
      if (n.kind === "logic" && Array.isArray(n.body)) {
        visit(n.body as unknown[]);
      }
      if (Array.isArray(n.children)) {
        visit(n.children as unknown[]);
      }
      // Recurse into control flow bodies (match arms, if/else, for/while, try)
      if (n.kind === "match-stmt" && Array.isArray((n as any).body)) {
        visit((n as any).body as unknown[]);
      }
      if (n.kind === "if-stmt") {
        if (Array.isArray((n as any).consequent)) visit((n as any).consequent as unknown[]);
        if (Array.isArray((n as any).alternate)) visit((n as any).alternate as unknown[]);
      }
      if ((n.kind === "for-stmt" || n.kind === "while-stmt") && Array.isArray((n as any).body)) {
        visit((n as any).body as unknown[]);
      }
      if (n.kind === "try-stmt") {
        if (Array.isArray((n as any).body)) visit((n as any).body as unknown[]);
        if ((n as any).catchNode && Array.isArray((n as any).catchNode.body)) visit((n as any).catchNode.body as unknown[]);
        if (Array.isArray((n as any).finallyBody)) visit((n as any).finallyBody as unknown[]);
      }
    }
  }

  visit(nodes as unknown[]);
  return names;
}

// ---------------------------------------------------------------------------
// ExprNode-aware reactive ref detection (Phase 4d)
// ---------------------------------------------------------------------------

/**
 * Check whether an ExprNode tree contains any @-prefixed ident (reactive ref).
 * Used as a fast boolean check — no need to collect all names.
 */
function _exprNodeHasReactiveRef(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;
  let found = false;
  forEachIdentInExprNode(node as any, (ident) => {
    if (!found && typeof ident.name === "string" && ident.name.startsWith("@")) {
      found = true;
    }
  });
  return found;
}

/**
 * Extract all reactive variable names (@var) from an ExprNode tree.
 * ExprNode-first counterpart to extractReactiveDeps (string-based).
 *
 * @param node - An ExprNode tree (e.g. initExpr, condExpr)
 * @param knownReactiveVars - Optional filter set (without @ prefix)
 * @returns Set of reactive variable names (without @ prefix)
 */
export function extractReactiveDepsFromExprNode(
  node: unknown,
  knownReactiveVars: Set<string> | null = null,
): Set<string> {
  const found = new Set<string>();
  if (!node || typeof node !== "object") return found;
  forEachIdentInExprNode(node as any, (ident) => {
    if (typeof ident.name === "string" && ident.name.startsWith("@")) {
      const varName = ident.name.slice(1); // strip @
      if (knownReactiveVars === null || knownReactiveVars.has(varName)) {
        found.add(varName);
      }
    }
  });
  return found;
}

// ---------------------------------------------------------------------------
// Transitive reactive dependency extraction via call-graph BFS (Bug J fix)
// ---------------------------------------------------------------------------

/**
 * A registry of function bodies for call-graph traversal.
 * Maps function name → array of function body statements.
 * Multiple entries per name are possible (overloads, cross-file).
 */
export type FunctionBodyRegistry = Map<string, { body: unknown[]; params: string[] }[]>;

/**
 * Build a FunctionBodyRegistry from a FileAST.
 * Collects all function-decl nodes and indexes them by name.
 */
export function buildFunctionBodyRegistry(fileAST: Record<string, unknown>): FunctionBodyRegistry {
  const registry: FunctionBodyRegistry = new Map();
  const nodes = getNodes(fileAST);

  function collectFunctions(nodeList: unknown[]): void {
    if (!Array.isArray(nodeList)) return;
    for (const node of nodeList) {
      if (!node || typeof node !== "object") continue;
      const n = node as ASTNode;

      if (n.kind === "function-decl" && n.name && Array.isArray(n.body)) {
        const name = n.name as string;
        if (!registry.has(name)) registry.set(name, []);
        registry.get(name)!.push({
          body: n.body as unknown[],
          params: (n.params as string[]) ?? [],
        });
        // Recurse into nested functions
        collectFunctions(n.body as unknown[]);
      }

      if (n.kind === "logic" && Array.isArray(n.body)) {
        collectFunctions(n.body as unknown[]);
      }
      if (Array.isArray(n.children)) {
        collectFunctions(n.children as unknown[]);
      }
    }
  }

  collectFunctions(nodes as unknown[]);
  return registry;
}

/**
 * Extract callee names from an expression string.
 * Simple direct-call extraction: `name(` pattern.
 */
function extractCalleesFromExprString(expr: string): string[] {
  const names: string[] = [];
  const re = /\b([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(expr)) !== null) {
    names.push(m[1]);
  }
  return names;
}

/**
 * Extract reactive deps from a function body (flat scan — no recursion).
 * Walks body statements for @var patterns in expression strings.
 */
function extractReactiveDepsFromBody(
  body: unknown[],
  knownReactiveVars: Set<string> | null,
): { deps: Set<string>; callees: string[] } {
  const deps = new Set<string>();
  const callees: string[] = [];

  function visitStmt(node: unknown): void {
    if (!node || typeof node !== "object") return;
    const n = node as ASTNode;

    // Skip nested function bodies — they have their own scope
    if (n.kind === "function-decl") return;

    // Extract from expression strings
    let exprStr = "";
    if (n.kind === "bare-expr") {
      exprStr = (n as any).exprNode
        ? emitStringFromTreeSafe((n as any).exprNode)
        : ((n.expr as string) ?? "");
    } else if (
      n.kind === "let-decl" ||
      n.kind === "const-decl" ||
      n.kind === "tilde-decl" ||
      n.kind === "state-decl" ||
      n.kind === "reactive-derived-decl"
    ) {
      exprStr = (n as any).initExpr
        ? emitStringFromTreeSafe((n as any).initExpr)
        : ((n.init as string) ?? "");
    } else if (n.kind === "return-stmt") {
      exprStr = (n as any).exprNode
        ? emitStringFromTreeSafe((n as any).exprNode)
        : ((n.expr as string) ?? "");
    }

    if (exprStr) {
      const exprDeps = extractReactiveDeps(exprStr, knownReactiveVars);
      for (const d of exprDeps) deps.add(d);
      callees.push(...extractCalleesFromExprString(exprStr));
    }

    // Recurse into control flow children (but not nested functions)
    for (const key of Object.keys(n)) {
      if (key === "span" || key === "id" || key === "name") continue;
      const val = (n as any)[key];
      if (Array.isArray(val)) {
        for (const child of val) {
          if (child && typeof child === "object" && (child as ASTNode).kind) {
            visitStmt(child);
          }
        }
      }
    }
  }

  for (const stmt of body) {
    visitStmt(stmt);
  }

  return { deps, callees };
}

/**
 * Safe wrapper for emitStringFromTree that catches errors.
 */
function emitStringFromTreeSafe(node: unknown): string {
  try {
    return emitStringFromTree(node as any);
  } catch {
    return "";
  }
}

/**
 * Extract reactive dependencies transitively through function calls.
 *
 * Given an expression like `${upperOf(getMsg())}`, this function:
 * 1. Extracts direct @var refs from the expression (standard behavior)
 * 2. Extracts callee names from the expression
 * 3. For each callee, looks up its body in the function registry
 * 4. BFS through the call graph collecting reactive deps from each body
 * 5. Returns the union of all reactive deps found
 *
 * This fixes Bug J where markup interpolations using helper functions
 * that wrap reactive reads get no display-wiring because the @var
 * references are inside the helper function's body, not the
 * interpolation expression itself.
 *
 * @param expr — the interpolation expression string
 * @param knownReactiveVars — known reactive variable names for filtering
 * @param fnRegistry — function body registry from buildFunctionBodyRegistry
 * @returns set of reactive variable names (without @ prefix)
 */
export function extractReactiveDepsTransitive(
  expr: string,
  knownReactiveVars: Set<string> | null,
  fnRegistry: FunctionBodyRegistry,
): Set<string> {
  // Step 1: Extract direct deps from the expression itself
  const allDeps = extractReactiveDeps(expr, knownReactiveVars);

  // Step 2: BFS through call graph
  const visited = new Set<string>();
  const queue = extractCalleesFromExprString(expr);

  while (queue.length > 0) {
    const calleeName = queue.shift()!;
    if (visited.has(calleeName)) continue;
    visited.add(calleeName);

    const fnEntries = fnRegistry.get(calleeName);
    if (!fnEntries) continue;

    for (const { body } of fnEntries) {
      const { deps, callees } = extractReactiveDepsFromBody(body, knownReactiveVars);
      for (const d of deps) allDeps.add(d);
      for (const c of callees) {
        if (!visited.has(c)) queue.push(c);
      }
    }
  }

  return allDeps;
}
