/**
 * @module codegen/emit-library-shared
 *
 * W5b (S239) — the shared async-coloring + per-fn emit machinery for a scrml
 * LIBRARY consumed IN-PROCESS. Both consumer surfaces use it, so they never
 * diverge on async-coloring or the client/server boundary rule:
 *   - the `kind="tool"` dep `<base>.js`  (emit-tool.ts `generateToolLibraryJs`),
 *   - the `<base>.server.js` ss1 value exports (emit-server.ts `emitModuleValueExportLines`).
 *
 * Kept dependency-neutral (imports only emit-logic + utils) to break the
 * emit-tool ⇄ emit-server import cycle — emit-tool references emit-server's
 * `SERVER_STRUCTURAL_EQ_HELPER` at MODULE-INIT, so emit-server MUST NOT import
 * back into emit-tool.
 */

import { emitFnShortcutBody } from "./emit-logic.js";
import { paramSignature } from "./utils.ts";
import { bodyContains } from "./collect.ts";
import { extractCalleeNames } from "./scheduling.ts";
import { isPromiseReturningStdlibFn } from "../module-resolver.js";
import { CGError } from "./errors.ts";

/** A loosely-typed AST node. */
type ASTNode = Record<string, unknown>;

/** A per-file `localName → sourceModuleAbsPath` map (buildCalleeImportMap). */
type CalleeImportMap = Map<string, string>;
/** MOD per-module by-name export metadata (the `isAsync` source of truth). */
type ExportRegistry = Map<
  string,
  Map<string, { kind: string; category: string; isComponent: boolean; isAsync?: boolean }>
>;

/**
 * True iff the fn body carries a directly-async signal: a `?{}` SQL node
 * (`sql` / `sql-ref`) or a `<foreign lang>` crossing. A `<transaction>` block is
 * deliberately NOT a signal — transactions are STAGED (§44.6 / SPEC-ISSUE-018),
 * so a transaction-only fn is not async-colored and is routed away from the
 * in-process emit (codegen/index.ts + emit-tool skip). Delegates to the
 * canonical `bodyContains` (collect.ts) so the SQL/foreign kind membership —
 * notably that `sql-ref` IS SQL (the pre-consolidation local walker missed it,
 * emitting a `sql-ref` lib fn sync/un-awaited) — is shared, not re-hand-rolled.
 */
export function bodyHasForeignOrSql(node: unknown): boolean {
  return bodyContains(node, { sql: true, foreign: true });
}

/**
 * Collect the bare-identifier callee names of every call node beneath `node` — a
 * peer-fn call `foo(...)`, represented as either `{kind:"call", name:"foo"}` or
 * `{kind:"call", callee:{kind:"ident", name:"foo"}}`. A METHOD call (`x.foo()`,
 * a `member` callee) is NOT a peer-fn call and is skipped.
 *
 * STRUCTURAL ONLY (S259 colorless-async-boundaries [4]) — NEVER a source-text
 * scan. The prior `extractCalleeNames(.raw)` recovery over a block-body lambda /
 * template `.raw` used the over-matching `\bname\s*\(` regex (matches a call-shaped
 * token in a string/comment) → false-positive coloring. Dropped: a call buried in
 * a RAW verbatim body is NOT a coloring signal; that shape is bucket (c)
 * (fail-closed, structurally detected) or bucket (a) (an array-method callback
 * routed to the async combinator), never a raw text-scan for coloring.
 */
function collectCalleeIdents(node: unknown, out: Set<string>): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) { for (const c of node) collectCalleeIdents(c, out); return; }
  const n = node as ASTNode;
  if (n.kind === "call") {
    if (typeof n.name === "string") out.add(n.name);
    const callee = n.callee as ASTNode | undefined;
    if (callee && callee.kind === "ident" && typeof callee.name === "string") out.add(callee.name);
  }
  for (const key of Object.keys(n)) {
    if (key === "span") continue;
    const v = n[key];
    if (v && typeof v === "object") collectCalleeIdents(v, out);
  }
}

/**
 * Compute the set of library fn names that must be emitted `async` (and whose
 * call sites must be awaited). Seed = fns that directly do `?{}` / `_{}` / carry
 * `isAsync`, OR (Seam-A Gap 1, GITI-037) that STRUCTURALLY call a Promise-
 * returning stdlib/vendor primitive (`safeCallAsync`, a `scrml:auth`/`scrml:http`/
 * `scrml:redis` async export), UNION `seedAsync` (the CROSS-IMPORT async names —
 * a lib fn calling an async fn imported from ANOTHER lib awaits it too). Then
 * fixpoint-propagate over the call graph: a fn calling any async fn is itself
 * async.
 *
 * Call detection is STRUCTURAL (the fn body's `call` nodes), NOT a source-text
 * regex. The prior `\bname\s*\(` text scan over-matched a call-shaped token in a
 * comment or string literal → it mis-colored a sync web-app server export as
 * `async` (S239 regression). `_sourceText` is retained for call-site
 * compatibility but is no longer consulted.
 *
 * The Gap-1 stdlib-Promise seed is OPT-IN: it fires only when BOTH `calleeMap`
 * (the per-file `localName → absSource` resolver, `buildCalleeImportMap`) and
 * `exportRegistry` (the MOD `isAsync` source of truth) are threaded. Absent
 * either (test harness / no imports), behavior is byte-identical to the pre-Gap-1
 * `?{}`/foreign/isAsync seed — the same backward-compatible pattern
 * `hasServerCallees` uses.
 */
export function computeAsyncFnNames(
  fns: ASTNode[],
  _sourceText?: string | null,
  seedAsync?: Set<string>,
  calleeMap?: CalleeImportMap | null,
  exportRegistry?: ExportRegistry | null,
  serverFnNames?: Set<string> | null,
): Set<string> {
  const async = new Set<string>(seedAsync ?? []);
  const calleesByName = new Map<string, Set<string>>();
  const hasStdlibClassifier = !!(
    calleeMap && exportRegistry && calleeMap.size > 0 && exportRegistry.size > 0
  );
  // Cleanup 9 (S239) — the CLIENT server-direct seed derives from THIS single
  // structural callee walk (was a second, non-transitive top-level-only
  // `hasServerCallees` scan that could drift). A fn structurally calling a server
  // fn is async (its call lowers to an awaited fetch stub); `serverFnNames` is NOT
  // added to the result set, only used as a seed trigger. Undefined on the
  // library/tool paths (server placement is a client-emit concept).
  const hasServerSeed = !!(serverFnNames && serverFnNames.size > 0);
  const callsServerFn = (callees: Set<string>): boolean => {
    if (!hasServerSeed) return false;
    for (const c of callees) if (serverFnNames!.has(c)) return true;
    return false;
  };
  // Seam-A Gap 1 — does `callees` reach a Promise-returning stdlib/vendor export?
  // Reuses `isPromiseReturningStdlibFn` (keyed on exportRegistry `isAsync` + the
  // Q5 `<repo>/stdlib/` carve-out), fed by the SAME structural `callees` set the
  // fixpoint uses — never a `\bname\s*\(` text scan (the S239 over-match).
  const callsStdlibPromise = (callees: Set<string>): boolean => {
    if (!hasStdlibClassifier) return false;
    for (const callee of callees) {
      const src = calleeMap!.get(callee);
      if (src && isPromiseReturningStdlibFn(callee, src, exportRegistry!)) return true;
    }
    return false;
  };
  for (const fn of fns) {
    const name = fn.name as string | undefined;
    if (!name) continue;
    const callees = new Set<string>();
    collectCalleeIdents(fn.body, callees);
    calleesByName.set(name, callees);
    if (fn.isAsync === true || bodyHasForeignOrSql(fn.body) || callsStdlibPromise(callees) || callsServerFn(callees)) {
      async.add(name);
    }
  }
  // Fixpoint — a fn that STRUCTURALLY calls any async fn becomes async.
  let changed = true;
  while (changed) {
    changed = false;
    for (const fn of fns) {
      const name = fn.name as string | undefined;
      if (!name || async.has(name)) continue;
      const callees = calleesByName.get(name);
      if (!callees) continue;
      for (const callee of callees) {
        if (callee !== name && async.has(callee)) {
          async.add(name);
          changed = true;
          break;
        }
      }
    }
  }
  return async;
}

/**
 * Seam-A no-silent-leak backstop (S239 review) — the SHARED, single-message
 * E-ASYNC-STDLIB-IN-SYNC-CALLBACK builder. One wording across every emit path
 * (server route / server ss1 value-export / library / client), so the diagnostic
 * cannot drift. A Promise-returning async call (stdlib primitive OR a
 * transitively-async peer) that lands in a position where the compiler cannot
 * inject `await` — a sync `.some`/`.find`/`.map` callback body, a parameter
 * default, or a raw escape-hatch body — ships a BARE Promise (always truthy → an
 * accept-all / wrong-boolean bug). Fail CLOSED with a hard error rather than leak.
 */
export function asyncStdlibSyncCallbackError(
  calleeName: string,
  span: unknown,
  filePath?: string | null,
): CGError {
  const sp = (span ?? {}) as { file?: string; start?: number; end?: number; line?: number; col?: number };
  return new CGError(
    "E-ASYNC-STDLIB-IN-SYNC-CALLBACK",
    `E-ASYNC-STDLIB-IN-SYNC-CALLBACK: the async call \`${calleeName}(…)\` cannot be awaited ` +
      `here — it sits in a position where \`await\` is not valid (a \`.some\`/\`.find\`/` +
      `\`.filter\`/\`.map\` callback body, a parameter default, or a raw escape-hatch body). ` +
      `scrml has no source \`await\`, so the compiler auto-awaits async calls — but only where ` +
      `\`await\` is legal. A bare \`${calleeName}(…)\` here returns an unawaited Promise (always ` +
      `truthy → an accept-all / wrong-value bug). Restructure so the call runs in the enclosing ` +
      `function's async body — e.g. hoist it into a \`for\` loop: ` +
      `\`for (const x of xs) { const r = ${calleeName}(…); … }\`.`,
    { file: filePath ?? sp.file ?? "", start: sp.start ?? 0, end: sp.end ?? 0, line: sp.line ?? 1, col: sp.col ?? 1 },
    "error",
  );
}

/**
 * Seam-A no-silent-leak backstop (S239 finding 6) — the SHARED indirect-alias
 * diagnostic. A local `const g = middle` (middle async) then `g()` is an indirect
 * async call: `collectCalleeIdents` sees only DIRECT ident calls, so `g()` is
 * neither colored, awaited, nor drained → the Promise leaks. Bounded single-level
 * alias resolution is a follow-on; for now FAIL CLOSED so the leak never ships.
 */
export function aliasedAsyncCallError(
  aliasName: string,
  resolvedName: string,
  span: unknown,
  filePath?: string | null,
): CGError {
  const sp = (span ?? {}) as { file?: string; start?: number; end?: number; line?: number; col?: number };
  return new CGError(
    "E-ASYNC-STDLIB-IN-SYNC-CALLBACK",
    `E-ASYNC-STDLIB-IN-SYNC-CALLBACK: \`${aliasName}\` is a local alias of the async function ` +
      `\`${resolvedName}\`, and the compiler cannot resolve an INDIRECT async call to inject the ` +
      `\`await\` (only direct calls are colored + awaited). A bare \`${aliasName}(…)\` returns an ` +
      `unawaited Promise (always truthy → a wrong-value bug). Call \`${resolvedName}(…)\` directly ` +
      `so the compiler can await it.`,
    { file: filePath ?? sp.file ?? "", start: sp.start ?? 0, end: sp.end ?? 0, line: sp.line ?? 1, col: sp.col ?? 1 },
    "error",
  );
}

/**
 * Seam-A no-silent-leak backstop (S239 finding 6) — structurally detect calls to a
 * LOCAL binding that aliases an async fn (`const g = middle; g()`). Returns each
 * indirect call site (with the alias + resolved async name) for the caller to
 * fail-close via `aliasedAsyncCallError`. Bounded: single-level DIRECT ident alias
 * (`const/let/tilde/lin-decl X = <asyncName>`); a re-aliased or computed binding is
 * out of scope (a future follow-on) — but never a silent leak within this level.
 */
export function collectAliasedAsyncCalls(
  fnBody: unknown,
  calleeMap: CalleeImportMap | null,
  exportRegistry: ExportRegistry | null,
  asyncFnNames: Set<string>,
): Array<{ alias: string; resolved: string; span: unknown }> {
  const hasStdlibClassifier = !!(calleeMap && exportRegistry && exportRegistry.size > 0);
  const isAsyncName = (name: string): boolean => {
    if (asyncFnNames.has(name)) return true;
    if (hasStdlibClassifier) {
      const src = calleeMap!.get(name);
      if (src && isPromiseReturningStdlibFn(name, src, exportRegistry!)) return true;
    }
    return false;
  };
  // Pass 1 — collect `X = <asyncName>` aliases (const/let/tilde/lin decl whose
  // initializer is a bare async ident, structurally OR from the raw init text).
  const aliasToResolved = new Map<string, string>();
  const DECL_KINDS = new Set(["const-decl", "let-decl", "tilde-decl", "lin-decl"]);
  const collectAliases = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const c of node) collectAliases(c); return; }
    const n = node as ASTNode;
    if (typeof n.kind === "string" && DECL_KINDS.has(n.kind) && typeof n.name === "string") {
      const initNode = n.initExpr as ASTNode | undefined;
      let rhs: string | undefined;
      if (initNode && initNode.kind === "ident" && typeof initNode.name === "string") rhs = initNode.name;
      else if (typeof n.init === "string") {
        const m = n.init.trim().match(/^([A-Za-z_$][A-Za-z0-9_$]*)$/);
        if (m) rhs = m[1];
      }
      if (rhs && rhs !== n.name && isAsyncName(rhs)) aliasToResolved.set(n.name, rhs);
    }
    for (const key of Object.keys(n)) {
      if (key === "span") continue;
      const v = n[key];
      if (v && typeof v === "object") collectAliases(v);
    }
  };
  collectAliases(fnBody);
  if (aliasToResolved.size === 0) return [];
  // Pass 2 — flag every call to an aliased name.
  const out: Array<{ alias: string; resolved: string; span: unknown }> = [];
  const seen = new Set<string>();
  const findCalls = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const c of node) findCalls(c); return; }
    const n = node as ASTNode;
    if (n.kind === "call") {
      const name = (typeof n.name === "string" ? n.name : undefined)
        ?? (((n.callee as ASTNode | undefined)?.kind === "ident") ? (n.callee as ASTNode).name as string : undefined);
      if (typeof name === "string" && aliasToResolved.has(name)) {
        const sp = (n.span ?? {}) as { start?: number };
        const key = `${name}@${sp.start ?? -1}`;
        if (!seen.has(key)) { seen.add(key); out.push({ alias: name, resolved: aliasToResolved.get(name)!, span: n.span }); }
      }
    }
    for (const key of Object.keys(n)) {
      if (key === "span") continue;
      const v = n[key];
      if (v && typeof v === "object") findCalls(v);
    }
  };
  findCalls(fnBody);
  return out;
}

/**
 * Seam-A no-silent-leak backstop (S239 review) — the SHARED structural detector.
 * Walk `fnBody` for async call sites (a Promise-returning stdlib primitive via
 * `isPromiseReturningStdlibFn`, OR a call to a name in `asyncFnNames` — the
 * transitive async-peer set) that sit in a NON-awaitable position:
 *   1. inside a nested `lambda` body / parameter default (scrml lambdas are sync —
 *      no source `await` — so any async call in one is un-awaitable), OR
 *   2. inside a raw `escape-hatch` (block-body callback / raw JS) or a template-
 *      literal `.raw` body — emitted VERBATIM, so `emit-expr` never structurally
 *      sees the inner call to lower it.
 * Returns each such site for the caller to fail-close via `asyncStdlibSyncCallbackError`.
 *
 * An AWAITABLE-position async call (a top-level statement / decl init / control-flow
 * condition, NOT inside a lambda) is handled by the emit's auto-await and is NOT
 * returned. This is the SAME structural traversal shape as `computeAsyncFnNames`'s
 * coloring, so coloring and this drain cannot drift (the S239 root cause).
 */
export function collectNonAwaitableAsyncCalls(
  fnBody: unknown,
  calleeMap: CalleeImportMap | null,
  exportRegistry: ExportRegistry | null,
  asyncFnNames: Set<string>,
): Array<{ name: string; span: unknown }> {
  const out: Array<{ name: string; span: unknown }> = [];
  const seen = new Set<string>();
  const hasStdlibClassifier = !!(calleeMap && exportRegistry && exportRegistry.size > 0);
  const isAsyncName = (name: string): boolean => {
    if (asyncFnNames.has(name)) return true;
    if (hasStdlibClassifier) {
      const src = calleeMap!.get(name);
      if (src && isPromiseReturningStdlibFn(name, src, exportRegistry!)) return true;
    }
    return false;
  };
  const record = (name: string, span: unknown): void => {
    const sp = (span ?? {}) as { start?: number };
    const key = `${name}@${sp.start ?? -1}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ name, span });
  };
  const walk = (node: unknown, insideCallback: boolean): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const c of node) walk(c, insideCallback); return; }
    const n = node as ASTNode;
    const k = n.kind as string | undefined;
    // Raw escape-hatch (block-body callback / raw JS) or template `.raw` — emitted
    // VERBATIM, so any async call inside is un-awaitable regardless of nesting.
    if ((k === "escape-hatch" || (k === "lit" && n.litType === "template")) && typeof n.raw === "string") {
      for (const c of extractCalleeNames(n.raw)) if (isAsyncName(c)) record(c, n.span);
    }
    // A structured call to an async name INSIDE a callback/param-default lambda.
    if (k === "call" && insideCallback) {
      const name = (typeof n.name === "string" ? n.name : undefined)
        ?? (((n.callee as ASTNode | undefined)?.kind === "ident") ? (n.callee as ASTNode).name as string : undefined);
      if (typeof name === "string" && isAsyncName(name)) record(name, n.span);
    }
    const childInside = insideCallback || k === "lambda";
    for (const key of Object.keys(n)) {
      if (key === "span") continue;
      const v = n[key];
      if (v && typeof v === "object") walk(v, childInside);
    }
  };
  walk(fnBody, false);
  return out;
}

/**
 * Shared per-fn LIBRARY member emitter — one `[export] [async] function
 * name(params) { <lowered body> }`.
 *
 * An ASYNC fn (in `asyncFnNames` — its body has a `?{}`/`_{}`, OR it transitively
 * calls one) lowers at the SERVER boundary with the async set as its await-set
 * (a peer-call to another async fn is awaited — S218). A SYNC fn lowers at the
 * CLIENT boundary (a server-boundary `match` wraps in `await (async () => …)()`,
 * which would make a non-async fn `await` — a SyntaxError).
 */
export function emitLibraryFnMember(
  fnNode: ASTNode,
  opts: { isExported: boolean; asyncFnNames: Set<string>; foreignCrossingErrors?: unknown[] },
): string {
  const name = (fnNode.name ?? "anon") as string;
  const isAsync = opts.asyncFnNames.has(name);
  const params = (fnNode.params ?? []) as unknown[];
  const paramList = params.map((p, i) => paramSignature(p as never, i)).join(", ");
  const star = fnNode.isGenerator ? "*" : "";
  const declaredNames = new Set<string>(
    params
      .map((p) => (typeof p === "string" ? p.split(/[:=]/)[0].trim() : (p as ASTNode)?.name))
      .filter((n): n is string => typeof n === "string" && n.length > 0),
  );
  const bodyOpts = isAsync
    ? { boundary: "server", serverFnNames: opts.asyncFnNames, declaredNames, insideFunctionBody: true, foreignCrossingErrors: opts.foreignCrossingErrors }
    : { boundary: "client", declaredNames, insideFunctionBody: true };
  const bodyCodes = emitFnShortcutBody(
    (fnNode.body ?? []) as never[],
    bodyOpts as never,
    fnNode.fnKind as string | undefined,
    fnNode.hasReturnType as boolean | undefined,
  );
  const lines: string[] = [
    `${opts.isExported ? "export " : ""}${isAsync ? "async " : ""}function${star} ${name}(${paramList}) {`,
  ];
  for (const code of bodyCodes) for (const line of code.split("\n")) lines.push(`  ${line}`);
  lines.push("}");
  return lines.join("\n");
}
