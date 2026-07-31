import { parse as acornParse } from "acorn";
import { genVar } from "./var-counter.ts";
import { emitExpr, emitExprField, type EmitExprContext } from "./emit-expr.ts";
import { exprNodeCollectCallees } from "../expression-parser.ts";
import { emitLogicNode, nodeListContainsTildeRef } from "./emit-logic.js";
import { CGError } from "./errors.ts";
import { isServerOnlyNode } from "./collect.ts";
import { resolveModulePath, isPromiseReturningStdlibFn } from "../module-resolver.js";
import { buildBodyDG } from "../body-dg-builder.ts";

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
 * S89 §13.2 Sub-Phase B Step 3 — per-file resolver from a bare callee name to
 * the absolute file path of the module that exports it. Built from the
 * importing file's `imports: ImportDeclNode[]` plus `resolveModulePath`.
 *
 * Used by `isPromiseReturningCallExpr` to ask `isPromiseReturningStdlibFn`
 * whether a callee resolves to a stdlib `Promise<T>` export. A callee not
 * present in this map is either:
 *   - a same-file function-decl (handled by routeMap.functions for server fns),
 *   - a host-JS global (Math, fetch, etc.),
 *   - a higher-order parameter (not statically resolvable per §13.2.1).
 */
export type CalleeImportMap = Map<string, string>;

/**
 * Build a per-file `name → sourceModuleAbsPath` map from the importing
 * FileAST's imports array. Each named-import specifier produces one entry
 * keyed by the LOCAL binding name (after `as` rename) so call-site lookups
 * use the symbol actually visible at the use-site.
 *
 * Exported for unit testing.
 */
export function buildCalleeImportMap(fileAST: ASTNode | null | undefined): CalleeImportMap {
  const out: CalleeImportMap = new Map();
  if (!fileAST) return out;
  // Cleanup 8 (S239) — the `.imports` normalization folded in here (was hand-rolled
  // at 5 call sites): the TABResult wrapper hoists imports to `.ast.imports`, so
  // prefer `.ast` when it carries them; else the FileAST's own `.imports`.
  const astImports = ((fileAST as { ast?: { imports?: unknown[] } }).ast)?.imports;
  const src = Array.isArray(astImports) ? (fileAST as { ast: ASTNode }).ast : fileAST;
  const imports = (src as { imports?: unknown[] }).imports;
  if (!Array.isArray(imports)) return out;
  const importerFilePath = ((src as { filePath?: string }).filePath)
    ?? ((fileAST as { filePath?: string }).filePath) ?? "";
  for (const imp of imports) {
    if (!imp || typeof imp !== "object") continue;
    const node = imp as { source?: string | null; names?: string[]; specifiers?: Array<{ local?: string; imported?: string }> };
    if (typeof node.source !== "string" || node.source.length === 0) continue;
    const absSource = resolveModulePath(node.source, importerFilePath);
    // Prefer per-item specifiers (LOCAL alias survives `as` rename); fall
    // back to `names` which is the parallel imported-name array.
    if (Array.isArray(node.specifiers) && node.specifiers.length > 0) {
      for (const s of node.specifiers) {
        const local = typeof s.local === "string" ? s.local : (typeof s.imported === "string" ? s.imported : null);
        if (local) out.set(local, absSource);
      }
    } else if (Array.isArray(node.names)) {
      for (const n of node.names) {
        if (typeof n === "string" && n.length > 0) out.set(n, absSource);
      }
    }
  }
  return out;
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
 * Check if a function node has any callees that are server-boundary, OR (S89
 * §13.2 Sub-Phase B Step 3) any callees that resolve to a stdlib
 * `Promise<T>`-returning export. The result drives `async function` emission
 * and the Promise.all-vs-sequential scheduling decision downstream.
 *
 * The classifier branch is BACKWARDS-COMPATIBLE: when `calleeMap` or
 * `exportRegistry` is null/empty (test harness, single-file unit, no imports),
 * the function falls back to the pre-S89 server-only behavior. Threading these
 * params is opt-in.
 *
 * @param {ASTNode} fnNode
 * @param {RouteMap} routeMap
 * @param {string} filePath
 * @param {CalleeImportMap | null} [calleeMap] — per-file name→absSource map
 * @param {Map | null} [exportRegistry] — MOD exportRegistry
 * @returns {boolean}
 */
export function hasServerCallees(
  fnNode: ASTNode,
  routeMap: RouteMap,
  filePath: string,
  calleeMap: CalleeImportMap | null = null,
  exportRegistry: Map<string, Map<string, { kind: string; category: string; isComponent: boolean; isAsync?: boolean }>> | null = null,
): boolean {
  // Build a set of server function names from routeMap
  const serverFnNames = new Set<string>();
  for (const [, route] of routeMap.functions) {
    if (route.boundary === "server" && route.functionName) {
      serverFnNames.add(route.functionName as string);
    }
  }

  // S89 §13.2.1 — also include stdlib Promise<T> classification when the
  // classifier inputs are available.
  const hasStdlibClassifier = !!(calleeMap && exportRegistry && calleeMap.size > 0 && exportRegistry.size > 0);
  if (serverFnNames.size === 0 && !hasStdlibClassifier) return false;

  // Helper — extract callees from a stmt's exprNode/initExpr (with string
  // fallback). Used by the body-walker below.
  const _extractCalleesFromStmt = (stmt: ASTNode): string[] => {
    const exprNodeField = (stmt as any).exprNode ?? (stmt as any).initExpr;
    return exprNodeField
      ? exprNodeCollectCallees(exprNodeField)
      : extractCalleeNames(
        typeof ((stmt as ASTNode).expr ?? (stmt as ASTNode).init ?? "") === "string"
          ? ((stmt as ASTNode).expr ?? (stmt as ASTNode).init ?? "") as string
          : "",
      );
  };

  // Helper — does any of the extracted callees classify as Promise<T>-returning?
  const _matchesPromiseCallee = (callees: string[]): boolean => {
    for (const callee of callees) {
      if (serverFnNames.has(callee)) return true;
      if (hasStdlibClassifier) {
        const sourceModule = calleeMap!.get(callee);
        if (sourceModule && isPromiseReturningStdlibFn(callee, sourceModule, exportRegistry!)) {
          return true;
        }
      }
    }
    return false;
  };

  // S89 §13.2 Sub-Phase B Step 3 — extract callees from bare-expr AND from
  // let/const initializers AND from guarded-expr's inner guardedNode. Pre-
  // S89 walked only bare-expr (server function calls there were the only
  // way to introduce an async boundary). With stdlib auto-await, a
  // `const x = safeCallAsync(thunk)` initializer or a
  // `let x = safeCallAsync(thunk) !{ ... }` failable-handler must
  // propagate "function has async boundaries" up so the outer function
  // emits `async function` prefix.
  //
  // i87 — §13.2 is POSITION-INVARIANT: the walk must ALSO see a server/Promise
  // call one block deep inside `if`/`else`/`for`/`while`/`do-while` bodies, and
  // in the assign/reassign form `res = fn()` (a `tilde-decl` / `lin-decl`).
  // Otherwise `hasServerCallees` returns false → no `async` prefix → the
  // `await` injected into the nested body (emitLogicBody / injectPromiseAwait)
  // is illegal in a sync function. The recursion descends into control-flow
  // STATEMENT bodies ONLY. It deliberately does NOT descend into nested
  // `function-decl` / lambda / sync-callback bodies (those stay fail-closed
  // under E-SERVER-FN-IN-SYNC-CALLBACK) nor into `match`-arm bodies (the client
  // match lowering uses a SYNC IIFE where `await` is illegal — a server call in
  // a client match arm is a separate, out-of-scope concern).
  const _stmtHasPromiseCallee = (stmt: ASTNode): boolean => {
    if (!stmt) return false;
    const kind = (stmt as ASTNode).kind;
    if (kind === "bare-expr" || kind === "let-decl" || kind === "const-decl" ||
        kind === "tilde-decl" || kind === "lin-decl") {
      if (_matchesPromiseCallee(_extractCalleesFromStmt(stmt))) return true;
    } else if (kind === "guarded-expr") {
      const guarded = (stmt as any).guardedNode;
      if (guarded && _matchesPromiseCallee(_extractCalleesFromStmt(guarded))) return true;
    } else if (kind === "if-stmt") {
      const consequent = (stmt as any).consequent;
      if (Array.isArray(consequent) && consequent.some(_stmtHasPromiseCallee)) return true;
      const alternate = (stmt as any).alternate;
      if (Array.isArray(alternate)) {
        if (alternate.some(_stmtHasPromiseCallee)) return true;
      } else if (alternate && typeof alternate === "object" && _stmtHasPromiseCallee(alternate)) {
        return true;
      }
    } else if (kind === "for-stmt" || kind === "while-stmt" || kind === "do-while-stmt") {
      const nested = (stmt as any).body;
      if (Array.isArray(nested) && nested.some(_stmtHasPromiseCallee)) return true;
    }
    return false;
  };

  const body = (fnNode.body as ASTNode[]) ?? [];
  for (const stmt of body) {
    if (_stmtHasPromiseCallee(stmt as ASTNode)) return true;
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
 *
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
 * S89 §13.2 Sub-Phase B Step 3 — extended auto-await classifier.
 *
 * Returns true if a statement's call expression has at least one statically-
 * known `Promise<T>`-returning callee per §13.2.1 Q1 BROAD ratification:
 *
 *   1. **Server functions** — existing surface (delegated to `isServerCallExpr`).
 *   2. **Stdlib Promise<T> functions** — exported from `scrml:*` modules with
 *      `isAsync: true` on the exportRegistry entry (Q5 stdlib carve-out per
 *      §13.1; per-export classification via `isPromiseReturningStdlibFn` in
 *      module-resolver.js).
 *
 * Cross-program function calls (§13.2.2 / E-PROG-004) are NOT classified here
 * — they live behind the cross-program emission boundary which already wraps
 * call sites in `await` per §43.5.1. The classifier only owns the §13.2.1
 * statically-resolvable-callee surface.
 *
 * Dynamic callees (higher-order args, indexed lookups, member dispatch) are
 * NOT classified — §13.2.1 normative bullet 2 requires the callee to be
 * statically-known. Such cases must be wrapped in a named thunk
 * (e.g. `safeCallAsync(() => dynamicFn())`) for auto-await to apply.
 *
 * @param stmt       — statement under inspection (may carry `exprNode` /
 *                     `initExpr` / `expr` / `init` field)
 * @param routeMap   — server function route map
 * @param filePath   — current file path
 * @param calleeMap  — per-file name→absSource map (built once via
 *                     `buildCalleeImportMap`; null for tests/server-only path)
 * @param exportRegistry — MOD exportRegistry; null when not threaded
 */
export function isPromiseReturningCallExpr(
  stmt: ASTNode,
  routeMap: RouteMap,
  filePath: string,
  calleeMap: CalleeImportMap | null,
  exportRegistry: Map<string, Map<string, { kind: string; category: string; isComponent: boolean; isAsync?: boolean }>> | null,
): boolean {
  // Server-function path (existing surface).
  if (isServerCallExpr(stmt, routeMap, filePath)) return true;

  // Stdlib Promise<T> path — requires both calleeMap (per-file import
  // resolution) AND exportRegistry (per-module isAsync flag). When either is
  // absent (test harness, isolated unit), short-circuit to false — matches
  // the current pre-S89 behavior.
  if (!calleeMap || !exportRegistry) return false;
  if (calleeMap.size === 0 || exportRegistry.size === 0) return false;

  // Re-extract callees (same shape as isServerCallExpr).
  const exprNodeField = (stmt as any).exprNode ?? (stmt as any).initExpr;
  const callees = exprNodeField
    ? exprNodeCollectCallees(exprNodeField)
    : extractCalleeNames(
      typeof ((stmt as ASTNode).expr ?? (stmt as ASTNode).init ?? "") === "string"
        ? ((stmt as ASTNode).expr ?? (stmt as ASTNode).init ?? "") as string
        : "",
    );
  if (callees.length === 0) return false;

  for (const callee of callees) {
    const sourceModule = calleeMap.get(callee);
    if (!sourceModule) continue;
    if (isPromiseReturningStdlibFn(callee, sourceModule, exportRegistry)) {
      return true;
    }
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
  // Phase 4d: prefer ExprNode fields, fall back to string fields via emitExprField.
  // M-7C-D-12 Track 3 (S90 OQ-5(a)): the missing-init fallback is "null" — emitting
  // `null` in compiled JS instead of `undefined` keeps scrml absence routed through
  // the canonical JS-null sentinel per §42.5/§42.8.
  const initStr = typeof (stmt as ASTNode).init === "string" ? (stmt as ASTNode).init as string : "";
  const exprStr = typeof (stmt as ASTNode).expr === "string" ? (stmt as ASTNode).expr as string : "";
  if ((stmt as any).initExpr || initStr) return emitExprField((stmt as any).initExpr, initStr || "null", _exprCtx);
  if ((stmt as any).exprNode || exprStr) return emitExprField((stmt as any).exprNode, exprStr || "null", _exprCtx);
  return "null";
}

/**
 * i87 §13.2 — inject `await` into an already-emitted statement whose call
 * expression is a statically-known `Promise<T>`-returning server-fn / stdlib-
 * async callee. Single source of truth for the auto-await lowering, shared by
 * `scheduleStatements` (top-level statement positions) AND `emitLogicBody`
 * (nested control-flow statement positions — if/else/for/while/do-while bodies).
 *
 * §13.2 is POSITION-INVARIANT: a server call written `const x = fn()` at the
 * top of a function body and the identical call one block deep inside an `if`
 * MUST both emit `await` and force the enclosing fn `async`. Before i87 only
 * the top-level const-decl form got it; nested + reassign forms silently
 * emitted a bare unawaited Promise (every `if (res.error)` guard after → dead).
 *
 * The `await` is injected on the INITIALIZER / RHS, never as a whole-statement
 * prefix — `await let x = …` / `await res = …` are both syntax errors. The
 * accepted emitted-code shapes and where the `await` lands:
 *   - `let/const NAME = RHS;`  → reconstructed as `const NAME = await <init>;`
 *     from the AST (mirrors the pre-i87 top-level decl branch exactly).
 *   - emitted code that is ITSELF a `let/const X = RHS;` (a §32 tilde single-
 *     line lowered from a non-decl node) → `let/const X = await RHS;`.
 *   - `return RHS;`            → `return await RHS;`.
 *   - `LHS = RHS;` (reassign / tilde-decl / lin-decl / bare-expr assign; i87
 *     case C) → `LHS = await RHS;`.
 *   - anything else (a bare call statement) → `await <code>;`.
 *
 * A no-op when the statement is not a Promise-returning call (statement-shape
 * nodes — if/for/while/match/guarded-expr — carry no direct callee on
 * `exprNode`/`initExpr`, so the classifier returns false and the code is
 * returned unchanged: this is what keeps nested `if`/`for` wrappers un-awaited
 * while their leaf statements are descended into separately).
 */
export function injectPromiseAwait(
  code: string,
  stmt: ASTNode,
  routeMap: RouteMap,
  filePath: string,
  calleeMap: CalleeImportMap | null,
  // Same shape as isPromiseReturningCallExpr's exportRegistry, referenced via
  // Parameters<> so this stays a pure passthrough type (never a routing read on
  // the value shape — keeps the P3-FOLLOW migration-hygiene budget intact).
  exportRegistry: Parameters<typeof isPromiseReturningCallExpr>[4],
): string {
  if (!code) return code;
  if (!isPromiseReturningCallExpr(stmt, routeMap, filePath, calleeMap, exportRegistry)) return code;

  // i87 fail-safe — do NOT touch a statement whose emitted code is a REACTIVE /
  // DERIVED / ENGINE runtime sink (or an already-async IIFE). A reactive-cell
  // server-call write (`@cell = serverFn()` → `_scrml_reactive_set("cell",
  // serverFn())`) is owned by the emit-client auto-await pass (emit-client.ts),
  // which rewrites it to a self-contained `(async () => _scrml_reactive_set(
  // "cell", await serverFn()))().catch(…)` — awaiting the fetch INSIDE its own
  // async IIFE (so the enclosing handler stays sync). Prepending our `await`
  // here both duplicates that and lands an illegal `await` in the sync handler.
  // The classifier fires on these (the server callee sits as a nested arg), so
  // this guard — not the classifier — is what fences them out.
  if (/^\s*(?:await\s+)?(?:\(async\b|_scrml_reactive_set\b|_scrml_derived_\w*|_scrml_default_set\b|_scrml_init_set\b|_scrml_engine_\w*)/.test(code)) {
    return code;
  }

  const kind = (stmt as ASTNode).kind;
  // let-decl / const-decl: reconstruct `const NAME = await <init>;` from the
  // AST. Mirrors the pre-i87 top-level decl branch (which always emitted
  // `const`, even for a `let-decl`); kept identical to avoid churning existing
  // top-level output.
  if (kind === "let-decl" || kind === "const-decl") {
    const name = (stmt as ASTNode).name as string || genVar("tmp");
    return `const ${name} = await ${extractInitExpr(stmt as ASTNode)};`;
  }

  // Non-decl / emitted-code forms — inject after the binding `=` / `return`.
  const _awaitTail = (s: string): string => (s.startsWith("await ") ? s : `await ${s}`);

  // (1) Emitted code that is itself a let/const declaration (§32 tilde single-
  // line). The await belongs on the initializer, not the decl keyword.
  const declMatch = code.match(/^(\s*(?:let|const)\s+[A-Za-z_$][\w$]*\s*=\s*)(.+?)(;?)$/s);
  if (declMatch) return `${declMatch[1]}${_awaitTail(declMatch[2])}${declMatch[3]}`;

  // (2) return-stmt: `return RHS;` → `return await RHS;`.
  const returnMatch = code.match(/^(\s*return\s+)(.+?)(;?)$/s);
  if (returnMatch) return `${returnMatch[1]}${_awaitTail(returnMatch[2])}${returnMatch[3]}`;

  // (3) assignment (reassign / tilde-decl / lin-decl / bare-expr assign; i87
  // case C): `LHS = RHS;` → `LHS = await RHS;` (await on the RHS, never a
  // whole-statement prefix). LHS is an lvalue (ident with optional `.member` /
  // `[index]` tails); the optional compound operator (`+=`, `*=`, `??=`, …) is
  // preserved so `x += fn()` → `x += await fn()`. The trailing `(?![=<>])`
  // guard rejects the comparison / arrow forms (`==`, `=>`, `>=`).
  const assignMatch = code.match(/^(\s*[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[[^\]]*\])*\s*(?:\*\*|<<|>>>?|&&|\|\||\?\?|[-+*/%&|^])?=\s*)(?![=<>])(.+?)(;?)$/s);
  if (assignMatch) return `${assignMatch[1]}${_awaitTail(assignMatch[2])}${assignMatch[3]}`;

  // (4) fallback — a bare call statement.
  return `await ${code.replace(/;$/, "")};`;
}

/**
 * GH #237 + #264 (§13.2 + §6.7.1a) — apply the §13.2 auto-await to already-EMITTED
 * JS that is about to be placed inside a compiler-generated `async` scope.
 *
 * `on mount { … }` is desugared to a SINGLE `bare-expr` whose `expr` is the raw
 * body text (SPEC §6.7.1a: "SHALL be desugared to a bare expression before the TAB
 * pass completes"), and a multi-statement body fails `safeParseExprToNode`, so
 * codegen receives an `escape-hatch` node and lowers the whole block through the
 * string pipeline (`rewriteExpr`) — there is no statement list to hand
 * `scheduleStatements`. `injectServerCallAwaitsViaAst` parses the emitted text with
 * acorn and walks the REAL AST, injecting `await` before every server-fn call in an
 * await-legal position, position-invariantly per §13.2. Modelling JS scopes with the
 * parser — not flat-text heuristics — is what makes the syntax-error class (an
 * `await` in a sync callback or a param list) unreachable; the GH #264 adversarial
 * rounds 1–5 each found another scope the retired flat-text scanner mis-modelled.
 *
 * On an acorn parse FAILURE the emitted body is already malformed (a separate
 * compiler bug), so this returns it UNCHANGED — it never injects into text the
 * parser cannot model. (The retired GH #237 flat-text fallback that once ran here
 * carried those rounds 1–5 injection bugs and was deleted with the #264 residual.)
 *
 * Returns the rewritten code, or the input unchanged when nothing classified or the
 * body does not parse.
 */
export function liftEmittedStatementAwaits(
  code: string,
  routeMap: RouteMap,
  filePath: string,
): string {
  const serverFnNames = new Set<string>();
  for (const [, route] of routeMap.functions) {
    if (route.boundary === "server" && route.functionName) serverFnNames.add(route.functionName as string);
  }
  if (serverFnNames.size === 0 || !code) return code;
  // GH #264 — the AST pass models JS scopes exactly (see `injectServerCallAwaitsViaAst`).
  // On an acorn parse FAILURE the emitted body is already malformed, so return it
  // UNCHANGED rather than run a flat-text scanner over text the parser cannot model —
  // never risk corrupting an unparseable body. (The retired GH #237 text fallback that
  // once ran here carried the #264 rounds 1–5 injection bugs.)
  const viaAst = injectServerCallAwaitsViaAst(code, serverFnNames);
  return viaAst !== null ? viaAst : code;
}

/**
 * GH #237 + #264 — apply the §13.2 auto-await to already-EMITTED (pre-mangle)
 * mount-body JS about to run inside the compiler-generated `(async () => {…})`
 * scope (§6.7.1a). SPEC §13.2: the compiler SHALL insert `await` at EVERY call
 * site where a server-generated fetch call is made — position-invariantly.
 *
 * The mount body is valid JS text, so this parses it with acorn (wrapped in an
 * async arrow so a top-level `await`/`return` parses) and walks the real AST: an
 * `await` is injected before each server-fn CALL in an await-LEGAL position. A
 * position is await-legal UNLESS it is inside a SYNC function/arrow/method/
 * accessor BODY, or inside ANY formal-PARAMETER list (a callback's params forbid
 * `await` even when the callback is async). Modelling scopes with the parser —
 * not flat-text heuristics — is what makes the syntax-error class (an `await` in
 * a sync callback / a param list) unreachable: acorn knows a method body, getter,
 * class method, arrow, `function`, or param default is a scope, which the text
 * scanner repeatedly did not (GH #264 adversarial rounds 1–5 each found another).
 *
 * Skipped (each keeps a correct/parallel path intact):
 *   - MEMBER calls (`obj.fn()`) — the route name binds a free identifier only.
 *   - already-`await`ed calls.
 *   - the DIRECT value of a `_scrml_reactive_set(cell, stub())` — emit-client's
 *     own IIFE pass owns that lift; a call one level deeper (an argument, a
 *     condition, a `${…}` interpolation) is NOT the direct value and IS awaited.
 *
 * Returns null when acorn cannot parse the body (the caller then returns the body
 * unchanged — never injecting into text the parser cannot model).
 */
export function injectServerCallAwaitsViaAst(code: string, serverFnNames: Set<string>): string | null {
  if (!code || serverFnNames.size === 0) return code;
  const PREFIX = "(async () => {\n";
  let program: any;
  try {
    program = acornParse(PREFIX + code + "\n})", { ecmaVersion: "latest" });
  } catch {
    return null;
  }
  const REACTIVE_WRAPPERS = new Set(["_scrml_reactive_set", "_scrml_cs_reactive_set"]);
  const P = PREFIX.length;
  const insertAt: number[] = [];

  const isFn = (n: any): boolean =>
    !!n && (n.type === "FunctionDeclaration" || n.type === "FunctionExpression" || n.type === "ArrowFunctionExpression");

  const visit = (node: any, awaitLegal: boolean, parent: any): void => {
    if (!node || typeof node !== "object") return;
    if (isFn(node)) {
      // Formal parameters forbid `await` in EVERY case (sync AND async).
      for (const prm of (node.params || [])) visit(prm, false, node);
      // The body is await-legal only when the callback is itself async.
      visit(node.body, node.async === true, node);
      return;
    }
    // A class field initializer runs in the (sync) instance/static-init context —
    // `await` is illegal there. A COMPUTED key, though, is evaluated in the
    // enclosing scope, so it keeps the inherited await-legality.
    if (node.type === "PropertyDefinition") {
      if (node.computed && node.key) visit(node.key, awaitLegal, node);
      if (node.value) visit(node.value, false, node);
      return;
    }
    // A `static { … }` block is a sync initializer — `await` is illegal.
    if (node.type === "StaticBlock") {
      for (const s of (node.body || [])) visit(s, false, node);
      return;
    }
    if (node.type === "CallExpression") {
      const callee = node.callee;
      if (awaitLegal && callee && callee.type === "Identifier" && serverFnNames.has(callee.name)) {
        const alreadyAwaited = !!parent && parent.type === "AwaitExpression";
        const directReactive =
          !!parent && parent.type === "CallExpression" &&
          parent.callee && parent.callee.type === "Identifier" &&
          REACTIVE_WRAPPERS.has(parent.callee.name) &&
          Array.isArray(parent.arguments) && parent.arguments[1] === node;
        if (!alreadyAwaited && !directReactive) insertAt.push(node.start - P);
      }
      visit(node.callee, awaitLegal, node);
      for (const a of (node.arguments || [])) visit(a, awaitLegal, node);
      return;
    }
    for (const key of Object.keys(node)) {
      if (key === "start" || key === "end" || key === "type") continue;
      const child = (node as any)[key];
      if (Array.isArray(child)) { for (const c of child) visit(c, awaitLegal, node); }
      else if (child && typeof child === "object" && typeof child.type === "string") visit(child, awaitLegal, node);
    }
  };
  // Start await-illegal at the module top; the wrapper `(async () => …)` flips
  // its own body await-legal, so the mount body is walked as await-legal.
  visit(program, false, null);

  if (insertAt.length === 0) return code;
  insertAt.sort((a, b) => a - b);
  let out = "";
  let cursor = 0;
  for (const pos of insertAt) {
    if (pos < 0 || pos > code.length) continue;
    out += code.slice(cursor, pos) + "await ";
    cursor = pos;
  }
  out += code.slice(cursor);
  return out;
}

/**
 * GH #237 — does `code` (already-EMITTED JS, pre-name-mangle) call at least one
 * `boundary: "server"` function from `routeMap`? Gates the async-scope lift so a
 * block with no server call emits BYTE-IDENTICALLY to before the fix.
 */
export function emittedCodeCallsServerFn(code: string, routeMap: RouteMap): boolean {
  const serverFnNames = new Set<string>();
  for (const [, route] of routeMap.functions) {
    if (route.boundary === "server" && route.functionName) {
      serverFnNames.add(route.functionName as string);
    }
  }
  if (serverFnNames.size === 0) return false;
  for (const callee of extractCalleeNames(code)) {
    if (serverFnNames.has(callee)) return true;
  }
  return false;
}

/**
 * S212 g-lift-concurrent-transitive-exclusion-tdz (Repro B) — collect the names
 * of every plain local that is REASSIGNED anywhere in `body`, recursing into
 * nested control-flow bodies (loop / branch / match bodies). A declaration
 * whose name appears here must not be lifted into a `const [...]` Promise.all
 * destructure — the later reassignment would crash with "Assignment to constant
 * variable".
 *
 * Two reassignment representations are collected:
 *   1. A `bare-expr` whose `exprNode` is an `assign` with a bare-ident target
 *      (`acc = acc.concat(x)` at the top level).
 *   2. A `tilde-decl` / `lin-decl` re-using an already-declared name — this is
 *      how the pipeline represents a reassignment of an existing local (e.g. a
 *      `let acc = []` followed by `acc = …` inside a `for` body lowers the
 *      `acc = …` to a `tilde-decl` carrying `name: "acc"`). The decl's OWN name
 *      is added only by this rule (a `let`/`const` decl is NOT counted as a
 *      reassignment of itself), so `declIsReassignedLater` flags exactly the
 *      decls that a later statement mutates.
 *
 * `@`-prefixed (reactive) targets are skipped: a reactive cell is not a
 * batch-eligible local decl, so it needs no entry here.
 */
function collectReassignedNames(body: ASTNode[] | undefined, sink: Set<string>): void {
  if (!Array.isArray(body)) return;
  for (const stmt of body) {
    if (!stmt || typeof stmt !== "object") continue;
    const node = stmt as Record<string, unknown>;
    const kind = node.kind;

    if (kind === "bare-expr") {
      const exprNode = node.exprNode as Record<string, unknown> | undefined;
      if (exprNode && exprNode.kind === "assign") {
        const target = exprNode.target as Record<string, unknown> | undefined;
        if (target && target.kind === "ident" && typeof target.name === "string" && target.name) {
          if (!target.name.startsWith("@")) sink.add(target.name);
        }
      }
    } else if (kind === "tilde-decl" || kind === "lin-decl") {
      // A `~`/`lin` decl re-binding an existing local IS a reassignment.
      const name = node.name;
      if (typeof name === "string" && name && !name.startsWith("@")) sink.add(name);
    }

    // Recurse into nested control-flow bodies — the reassignment commonly
    // lives inside a `for` / `while` / `if` / `match` body.
    for (const field of ["body", "consequent", "alternate"]) {
      const nested = node[field];
      if (Array.isArray(nested)) collectReassignedNames(nested as ASTNode[], sink);
    }
  }
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
export function scheduleStatements(body: ASTNode[], fnNode: ASTNode, routeMap: RouteMap, depGraph: DepGraph, filePath: string, errors: CGError[] = [], machineBindings?: Map<string, { engineName: string; tableName: string; rules: any[]; auditTarget?: string | null }> | null, engineBindings?: Map<string, { varName: string; forType: string; tableName: string }> | null, engineVarNames?: Set<string> | null, enginesWithHooks?: Set<string> | null, returnTypeAnnotation?: string | null, enclosingFnName?: string | null, enginesWithOnTimeout?: Set<string> | null, enginesWithIdleWatchdog?: Set<string> | null, enginesWithInternalRules?: Set<string> | null, enginesWithHistory?: Set<string> | null, enginesWithMessageArms?: Set<string> | null, engineMessageVariants?: Map<string, Set<string>> | null, calleeMap?: CalleeImportMap | null, exportRegistry?: Map<string, Map<string, { kind: string; category: string; isComponent: boolean; isAsync?: boolean }>> | null, mapVarNames?: Set<string> | null, orderedMapVarNames?: Set<string> | null, setVarNames?: Set<string> | null, localMapVarNames?: Set<string> | null, localSetVarNames?: Set<string> | null, localOrderedMapVarNames?: Set<string> | null, clientAsyncFnNames?: Set<string> | null, syncPeerCalls?: Array<{ name: string; span: unknown }> | null, clientAsyncBody?: boolean, synthCellKeys?: Set<string> | null): string[] {
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
    // §59 (D4) — map variable names so `@m[k]` / `@m.<method>(…)` / `@m.size`
    // inside scheduled function bodies lower to the `_scrml_map_*` runtime.
    ...(mapVarNames && mapVarNames.size > 0 ? { mapVarNames } : {}),
    // §59.12 (D4) — set cell names so the set-native vocabulary (`.add`/
    // `.elements`/`.union`/`.intersect`/`.difference`) inside a scheduled
    // function body lowers via emit-expr's set interception.
    ...(setVarNames && setVarNames.size > 0 ? { setVarNames } : {}),
    // §59.8 (S169) — ordered-map cell names so a reassignment `@m = [...]`
    // inside a scheduled function body lowers the literal ordered.
    ...(orderedMapVarNames && orderedMapVarNames.size > 0 ? { orderedMapVarNames } : {}),
    // §59 (ss52) — NON-REACTIVE LOCAL map/set names (bare, per-fn scope) so a
    // pure-fn local `let m = [:]; m.insert(...)`/`m.size`/`m[k]` lowers via the
    // bare-receiver `_scrml_map_*` form (the reactive `@`-path stays unchanged).
    ...(localMapVarNames && localMapVarNames.size > 0 ? { localMapVarNames } : {}),
    ...(localSetVarNames && localSetVarNames.size > 0 ? { localSetVarNames } : {}),
    ...(localOrderedMapVarNames && localOrderedMapVarNames.size > 0 ? { localOrderedMapVarNames } : {}),
    ...(engineVarNames && engineVarNames.size > 0 ? { engineVarNames } : {}),
    ...(enginesWithHooks && enginesWithHooks.size > 0 ? { enginesWithHooks } : {}),
    ...(enginesWithOnTimeout && enginesWithOnTimeout.size > 0 ? { enginesWithOnTimeout } : {}),
    ...(enginesWithIdleWatchdog && enginesWithIdleWatchdog.size > 0 ? { enginesWithIdleWatchdog } : {}),
    ...(enginesWithInternalRules && enginesWithInternalRules.size > 0 ? { enginesWithInternalRules } : {}),
    ...(enginesWithHistory && enginesWithHistory.size > 0 ? { enginesWithHistory } : {}),
    // §51.0.S (S155 batch 3) — message-plane routing inputs for `.advance`.
    ...(enginesWithMessageArms && enginesWithMessageArms.size > 0 ? { enginesWithMessageArms } : {}),
    ...(engineMessageVariants && engineMessageVariants.size > 0 ? { engineMessageVariants } : {}),
    ...(returnTypeAnnotation ? { returnTypeAnnotation, enclosingFnName: enclosingFnName ?? null } : {}),
    // S89 §13.2 Sub-Phase B Step 3 — auto-await classifier inputs threaded
    // through opts so `case "guarded-expr"` in emit-logic.ts can auto-await
    // a `Promise<T>` initExpr per §13.2.1 (collapses the S88 two-step
    // safeCallAsync pattern to a single line).
    ...(routeMap ? { asyncRouteMap: routeMap } : {}),
    ...(calleeMap ? { asyncCalleeMap: calleeMap } : {}),
    ...(exportRegistry ? { asyncExportRegistry: exportRegistry } : {}),
    asyncFilePath: filePath,
    // Seam-A colorless-async Gap 2 (GITI-037) — the transitive client async-peer
    // set + the fail-closed sink, so emit-expr awaits a client-mode call to a
    // local async peer (and records a non-awaitable position for the drain).
    ...(clientAsyncFnNames && clientAsyncFnNames.size > 0
        ? { clientAsyncFnNames, syncPeerCalls: syncPeerCalls ?? null }
        : {}),
    // Seam-A finding-4 — gate the client-mode stdlib await on an async fn body.
    ...(clientAsyncBody ? { clientAsyncBody: true } : {}),
    // §32 — a function body is its own tilde scope (SPEC §32.4). Pre-scan
    // for `~` references and set up a per-body tildeContext so bare-expr /
    // value-lift statements capture into the generated tilde var and consume
    // sites lower `~` to that var. Skipped when the body has no `~`.
    ...(nodeListContainsTildeRef(body)
        ? { tildeContext: { var: null as string | null, mode: "single" as "single" | "array" } }
        : {}),
    // Bug 61 / GH #262 — thread the §55 synth-cell key set into scheduled
    // function bodies so `emitMember` collapses an EXPRESSION-position
    // `@<compound>.<synthProp>` read (`if (!@f.isValid)`, `@f.errors` as a
    // call arg, `@f.email.isValid`) to the dotted synth cell
    // (`_scrml_reactive_get("f.isValid")`) — matching the binding/event-wiring
    // paths that already got this at Bug 61. Without it a function-body read
    // fell through to member access on the compound VALUE object
    // (`_scrml_reactive_get("f").isValid` → `undefined`), so a submit guard
    // `if (!@f.isValid) return` returned on every call (fails closed, silent).
    ...(synthCellKeys && synthCellKeys.size > 0 ? { synthCellKeys } : {}),
  };

  // Only use complex scheduling (Promise.all) for functions with actual server calls.
  // For purely client-side functions, emit sequentially — wrapping non-async statements
  // in Promise.all produces invalid JavaScript.
  // S89 §13.2 Sub-Phase B Step 3 — gate the Promise.all dependency-graph path
  // on the NARROW (server-only) classification. The broader Promise<T> stdlib
  // classification drives `async function` emission and per-statement
  // `await` emission, but it should NOT activate the Promise.all grouping
  // logic (which assumes the depGraph has dependency edges between server-fn
  // call sites). Pre-S89 behavior preserved exactly: only actual server-fn
  // fetch call sites trigger Promise.all coalescing.
  const fnHasServerCalls = hasServerCallees(fnNode, routeMap, filePath, null, null);
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
          `Move it to a server-side function or remove the client boundary.`,
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

  // S139 Bug 56 — fold in body-DG intra-statement edges (per SPEC §19.9.9.1).
  // The module-level `depGraph` only carries cross-call `awaits` edges; it does
  // NOT see local-scope `reads` deps (e.g. `const x = serverFn(); @y = x.field;`
  // — stmt 1 reads `x` declared in stmt 0). Without the body-DG fold-in, both
  // statements get grouped into a single Promise.all batch, and stmt 1's
  // expression `x.field` is evaluated BEFORE the await destructures `x` →
  // ReferenceError (TDZ) at runtime. The body-DG's `reads` / `writes` /
  // `awaits` / `invalidates` edges all force ordering; `control-anchors` is
  // a structural fence we skip here. (#165's control-flow reorder is fenced
  // directly in the grouping scan below via `isControlFlowBoundary`, which
  // breaks the batch at ANY control-transfer statement — a stronger guarantee
  // than the anchor edge, which only bound the guard's immediate successor and
  // so missed a server call separated from the guard by filler statements.)
  // Reproducer: the original dashboard's refresh() emitted
  // `Promise.all([readHead(), _scrml_reactive_set("head", sha.slice(0,8))])`
  // where `sha` was the destructuring target of the await — broken pre-fix.
  try {
    const bodyDG = buildBodyDG(body as unknown as Parameters<typeof buildBodyDG>[0], {
      server: [],
      reactive: [],
    });
    for (const edge of bodyDG.edges) {
      if (edge.kind === "control-anchors") continue;
      // body-DG edges carry direct statement indices (numbers) per
      // body-dg-builder.ts. Convention: `from` depends on `to` — `from` runs after.
      if (edge.from >= 0 && edge.from < body.length &&
          edge.to >= 0 && edge.to < body.length) {
        depSets[edge.from].add(edge.to);
      }
    }
  } catch {
    // Defensive: if body-DG construction fails on an unexpected statement
    // shape, fall back to module-DG-only behavior (pre-S139 baseline). The
    // worst case is a missed parallelization opportunity, not a miscompile —
    // the module-DG awaits loop above still catches cross-call deps.
  }

  // #165 — a statement across which a later binding MUST NOT be reordered: any
  // statement that can TRANSFER CONTROL (branch away or exit early), so that a
  // side-effecting binding (a server call) hoisted above it would run when the
  // control flow was meant to prevent it — the silent destructive-write reorder
  // adopter #165 hit (a confirm-guarded delete firing before the confirm).
  //
  // This SUBSUMES the former `isStatementShapeStmt` (S138 Bug 55), which listed
  // only `{guarded-expr, if, while, do-while, for, return}` for a NARROWER
  // purpose: those kinds emit MULTI-STATEMENT output that can't be a
  // `Promise.all([...])` array element. But "can't be an array element" is not
  // the same question as "unsafe to reorder across" — conflating the two is what
  // let the guard kinds slip (`match`/`switch`/`try`/`propagate`/`throw` are
  // reorder-unsafe but were not on the emit-shape list). This set is the union:
  // control-flow constructs (`if`/`for`/`while`/`do-while`/`switch`/`match`/
  // `try`), the early-exit family route-inference already recognises
  // (`return`/`throw`/`propagate-expr`, plus `fail`), and the presence/branch
  // guards (`guarded-expr`/`given-guard`/`break`/`continue`). Because it is a
  // superset, it also serves the S138 Bug-55 role: every multi-statement-shape
  // kind is here, so none can become a `Promise.all` array element.
  //
  // Used as a HARD group boundary in the scan below: hitting one ENDS the batch,
  // which fences EVERY later statement — not just the guard's immediate
  // neighbour (the filler-separated shape the control-anchors edge, anchored
  // only to `k+1`, missed). A pure decl is NOT here, so the S212 skip of a
  // dependent pure decl to reach a later independent one is preserved.
  function isControlFlowBoundary(stmt: ASTNode): boolean {
    switch ((stmt as ASTNode).kind) {
      case "if-stmt":
      case "for-stmt":
      case "while-stmt":
      case "do-while-stmt":
      case "switch-stmt":
      case "match-stmt":
      case "try-stmt":
      case "return-stmt":
      case "throw-stmt":
      case "propagate-expr":
      case "fail-expr":
      case "guarded-expr":
      case "given-guard":
      case "break-stmt":
      case "continue-stmt":
        return true;
      default:
        return false;
    }
  }

  // S139 Bug 56 (companion) — only let-decl / const-decl statements can safely
  // become Promise.all entries. The decl path emits the INIT EXPR as the array
  // entry (so the awaited result destructures into the LHS name). Non-decl
  // statements (reactive writes, expr-stmts, etc.) fall to the else-branch
  // at line 547-549, which shoves the WHOLE emitted code (e.g. the call
  // `_scrml_reactive_set("a", asyncFn())`) into the array entry — but that
  // call is evaluated synchronously when Promise.all builds the array,
  // passing a Promise (not the resolved value) to _scrml_reactive_set. Symptom:
  // adopter cell holds a Promise object instead of the awaited value. The
  // dashboard's `@statuses = loadStatuses()` is the reproducer. Fix: only
  // group decl-shape statements; non-decl statements always go single-stmt
  // (sequential emit handles their await injection correctly).
  function isDeclShapeStmt(stmt: ASTNode): boolean {
    const k = (stmt as ASTNode).kind;
    return k === "let-decl" || k === "const-decl";
  }

  // S212 g-lift-concurrent-transitive-exclusion-tdz (Repro B — the let-
  // accumulator facet) — a Promise.all batch destructures its members with a
  // `const [...]` binding. A `let acc = []` that is REASSIGNED later in the
  // body (e.g. `acc = acc.concat(x)` inside a `for` loop) would be lifted into
  // that const-destructure and then crash at the reassignment with "Assignment
  // to constant variable". A declaration whose name is reassigned anywhere
  // later in the body therefore MUST stay sequential (it emits its own
  // `let`/`const` line, preserving the binding form). Scan the WHOLE body —
  // including nested control-flow bodies — for assignment targets, since the
  // reassignment commonly lives inside a loop/branch body.
  const reassignedNames = new Set<string>();
  collectReassignedNames(body, reassignedNames);
  function declIsReassignedLater(stmt: ASTNode): boolean {
    const name = (stmt as ASTNode).name;
    return typeof name === "string" && name.length > 0 && reassignedNames.has(name);
  }

  // S212 g-lift-concurrent-transitive-exclusion-tdz — transitive dependency
  // closure for the batch-eligibility test below.
  //
  // `depSets[k]` carries DIRECT dependencies of statement `k` (every body-DG
  // `reads`/`writes`/`awaits`/`invalidates` edge folds `from`→`to` as
  // `depSets[from].add(to)`, and the module-DG `awaits` loop the same). Because
  // every such edge runs `to` BEFORE `from`, `depSets[k]` only ever contains
  // indices strictly less than `k`. The Bug-56 fix uses these direct edges to
  // force a batch boundary when a candidate reads a group member directly.
  //
  // The gap that fix left open: a Promise.all batch destructures ALL its
  // members simultaneously, so a member may depend ONLY on statements already
  // declared BEFORE the batch — never on another member (TDZ) and never on a
  // statement emitted AFTER the batch. The direct check missed the TRANSITIVE
  // chain: a candidate `j` that reads a SYNC local `e` which itself depends on
  // an await-bound local got batched ahead of `e`'s declaration → TDZ at the
  // member's read of `e`. Fixpoint the direct edges into a full transitive
  // closure so excluded-ness propagates through any chain of intervening
  // locals.
  const depClosure: Set<number>[] = body.map(() => new Set<number>());
  for (let k = 0; k < body.length; k++) {
    const seen = depClosure[k];
    const stack = [...depSets[k]];
    while (stack.length > 0) {
      const d = stack.pop()!;
      if (seen.has(d)) continue;
      seen.add(d);
      for (const dd of depSets[d]) {
        if (!seen.has(dd)) stack.push(dd);
      }
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

    // #165 — a control-flow / control-transfer SEED can't batch with anything
    // (it is also statement-shape, so it can't be a Promise.all array element).
    const seedIsControlFlowBoundary = isControlFlowBoundary(body[i] as ASTNode);
    // S139 Bug 56 — if the seed stmt is not a decl, group stays size-1.
    // See isDeclShapeStmt comment above for the rationale.
    // S212 — a decl whose binding is reassigned later (a `let` accumulator)
    // also forces the group to stay size-1: a multi-member batch would const-
    // destructure it, breaking the later reassignment.
    const seedIsNonDecl = !isDeclShapeStmt(body[i] as ASTNode) || declIsReassignedLater(body[i] as ASTNode);

    for (let j = i + 1; j < body.length; j++) {
      // #165 g-batch-hoist-across-control-flow — a control-transfer statement
      // between the seed and a candidate is a HARD group boundary: `break` ends
      // the whole forward scan, so NOTHING after it is hoisted into a batch
      // seeded before it — including a server call separated from the guard by
      // filler statements (the case the control-anchors edge, anchored only to
      // the guard's IMMEDIATE successor `k+1`, missed). A control-flow SEED
      // likewise batches with nothing. `break`, not `continue`: `continue` would
      // skip the guard but keep scanning FORWARD and pull a later server-call
      // decl over it — the original silent destructive-write reorder.
      if (seedIsControlFlowBoundary || isControlFlowBoundary(body[j] as ASTNode)) break;
      if (visited.has(j)) continue;
      // §19.9.9.2 step 2 (g-batch-reorder-across-nondecl-sideeffect) — a non-decl
      // statement (a reactive write `@x = …`, a bare call, an expr-stmt) is a
      // client-tier side effect, and "a client-tier statement appearing between
      // two server statements forces a batch boundary": break, NOT skip. The old
      // `continue` skipped the non-decl but kept scanning FORWARD, pulling a
      // later server-fetch decl into a batch seeded ABOVE it — so the client
      // write emitted AFTER a fetch the source placed it BEFORE (a "saving…"
      // indicator painted only after the round-trip, or never). Breaking here
      // preserves observable source order (soundness S3, §19.9.9.1) — the same
      // rule the CPS multi-batch planner already enforces (§19.9.9.5 example: an
      // intervening `@reservationShown` write closes batch 0). Only the
      // cross-server-call parallelization is declined; the write stays put. A
      // non-decl SEED likewise can't batch. (The S212 pure-DECL skip is
      // unaffected — a decl is not a non-decl, so it still `continue`s below.)
      if (seedIsNonDecl || !isDeclShapeStmt(body[j] as ASTNode)) break;
      // S212 — a reassigned-later decl (`let acc = []`) can't be const-
      // destructured into the batch, but it is a pure binding (no observable
      // side effect), so it is SKIPPED, not a boundary — a later independent
      // decl may still batch across it.
      if (declIsReassignedLater(body[j] as ASTNode)) continue;
      // S212 — a Promise.all member may only depend on statements declared
      // BEFORE the batch (index < the seed `i`). The batch is emitted as a
      // unit at the seed's position, and all prior groups (indices < i) are
      // already emitted, so a transitive dependency at an index >= i is either
      // another member (TDZ — both destructure simultaneously) or a statement
      // emitted AFTER the batch (forward-reference). Either way `j` cannot join.
      // depClosure[j] only contains indices < j, so the single guard "every
      // transitive dep < i" subsumes the prior direct group-member check. A
      // dependent PURE decl is skipped (`continue`), preserving the S212 skip
      // that reaches a later independent decl.
      let independent = true;
      for (const dep of depClosure[j]) {
        if (dep >= i) {
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
            `Move it to a server-side function or remove the client boundary.`,
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
          `Move it to a server-side function or remove the client boundary.`,
          ((stmt as ASTNode).span ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 }) as object,
        ));
        i++;
        continue;
      }
      const code = emitLogicNode(stmt, emitOpts);
      if (code) {
        // S89 §13.2 Sub-Phase B Step 3 — extended classifier covers both
        // server functions AND stdlib Promise<T> functions per Q1 BROAD.
        // i87 — the await-injection (incl. the assign-form `res = await …`
        // case C) is centralized in `injectPromiseAwait`, shared with the
        // nested-body path in emitLogicBody so §13.2 is position-invariant.
        lines.push(injectPromiseAwait(code, stmt as ASTNode, routeMap, filePath, calleeMap ?? null, exportRegistry ?? null));
      }
    }

    i++;
  }

  return lines;
}
