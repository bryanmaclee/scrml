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
// Phase-2 colorless-async — the clean-family combinator detector, shared with the
// emit-expr lowering site so the fail-closed drain and the lowering agree on which
// callbacks are transformed (and therefore must NOT fail closed).
import { isAsyncCombinatorCall, isKnownDiscardHofCall, callbackReachesAsync } from "./async-combinators.ts";

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
function collectCalleeIdents(node: unknown, out: Set<string>, guardNestedFnValues = false): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) { for (const c of node) collectCalleeIdents(c, out, guardNestedFnValues); return; }
  const n = node as ASTNode;
  // GITI-038 — when `guardNestedFnValues`, a nested function VALUE (a returned
  // `function name(){…}` carried on a return-stmt's `fnExprNode`, or a nested
  // `function-decl` statement) has its OWN async scope: an async call inside it
  // does NOT color the ENCLOSING function's OWN signature (the enclosing body just
  // holds/returns the value). Mirrors scheduling.ts's `hasServerCallees`, which
  // "deliberately does NOT descend into nested function-decl / lambda / sync-callback
  // bodies." A combinator callback (a `lambda` ARG to `.map`/`.some`/…) is NOT a
  // `function-decl`, so it is still descended — #110's combinator coloring intact.
  if (guardNestedFnValues && n.kind === "function-decl") return;
  if (n.kind === "call") {
    if (typeof n.name === "string") out.add(n.name);
    const callee = n.callee as ASTNode | undefined;
    if (callee && callee.kind === "ident" && typeof callee.name === "string") out.add(callee.name);
  }
  for (const key of Object.keys(n)) {
    if (key === "span") continue;
    const v = n[key];
    if (v && typeof v === "object") collectCalleeIdents(v, out, guardNestedFnValues);
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
  // GITI-038 — when true, the OWN-signature callee walk does NOT descend into a
  // nested function VALUE (a returned/held `function-decl`): its async calls color
  // ITS signature, not the enclosing factory's. Opt-in (library path) so existing
  // callers (server/client/tool) are byte-identical.
  guardNestedFnValues?: boolean,
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
    collectCalleeIdents(fn.body, callees, guardNestedFnValues === true);
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
 * GITI-038 (Q2 — the re-emission routing question, distinct from Q1's own-signature
 * async coloring). Compute the set of top-level fn names that must be AST-re-emitted
 * NOT because their OWN body is async, but because they HOLD a nested function VALUE
 * — a returned `function name(){…}` (a return-stmt's `fnExprNode`) or a nested
 * `function-decl` statement — whose body makes an async call. Such a factory must be
 * pulled off the verbatim path so its nested closure picks up `async`+`await` (the
 * verbatim path lowers `!{}` with NO await → a bare Promise → an always-truthy
 * failable check). The factory's OWN signature stays non-async (Q1); only its body
 * lowers server-side so the nested await is legal.
 *
 * Detection reuses the SAME `isPromiseReturningStdlibFn` classifier + the transitive
 * `ownAsyncFnNames` (an async peer) that Q1 uses — so a nested closure calling a
 * SYNC stdlib primitive (`safeCall`, not `safeCallAsync`) does NOT route (invariant
 * 2: the `composeOkSync` control stays verbatim). Absent the classifier (no imports
 * / test harness) only the async-peer terminal fires.
 */
export function computeNestedAsyncFnHolders(
  fns: ASTNode[],
  ownAsyncFnNames: Set<string>,
  calleeMap?: CalleeImportMap | null,
  exportRegistry?: ExportRegistry | null,
): Set<string> {
  const holders = new Set<string>();
  const hasStdlibClassifier = !!(calleeMap && exportRegistry && exportRegistry.size > 0);
  const isAsyncCallee = (name: string): boolean => {
    if (ownAsyncFnNames.has(name)) return true;
    if (hasStdlibClassifier) {
      const src = calleeMap!.get(name);
      if (src && isPromiseReturningStdlibFn(name, src, exportRegistry!)) return true;
    }
    return false;
  };
  // Collect the callees WITHIN every nested function VALUE reachable from `body`
  // (descend once INTO each nested `function-decl`, then keep looking for further
  // nesting). `collectCalleeIdents` with the guard OFF gathers a nested body's own
  // direct calls; the outer recursion crosses the nesting boundary.
  const collectNestedFnBodyCallees = (node: unknown, out: Set<string>): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const c of node) collectNestedFnBodyCallees(c, out); return; }
    const n = node as ASTNode;
    if (n.kind === "function-decl") {
      collectCalleeIdents((n as ASTNode).body, out, /*guardNestedFnValues*/ true);
      collectNestedFnBodyCallees((n as ASTNode).body, out); // doubly-nested closures too
      return;
    }
    for (const key of Object.keys(n)) {
      if (key === "span") continue;
      const v = n[key];
      if (v && typeof v === "object") collectNestedFnBodyCallees(v, out);
    }
  };
  for (const fn of fns) {
    const name = fn.name as string | undefined;
    if (!name) continue;
    const nestedCallees = new Set<string>();
    collectNestedFnBodyCallees(fn.body, nestedCallees);
    for (const c of nestedCallees) {
      if (isAsyncCallee(c)) { holders.add(name); break; }
    }
  }
  return holders;
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
      `here — it sits in a position that CONSUMES the callback's return value where \`await\` is ` +
      `not valid (a value-coercing callback body such as \`.filter\`/\`.find\`/\`.some\`/\`.map\`, ` +
      `a parameter default, or a raw escape-hatch body). scrml has no source \`await\`, so the ` +
      `compiler auto-awaits async calls — but only where \`await\` is legal AND the resulting value ` +
      `is used correctly. A bare \`${calleeName}(…)\` here returns an unawaited Promise (always ` +
      `truthy → an accept-all / wrong-value bug). Restructure so the value is produced in an async ` +
      `body where it can be awaited before it is used — e.g. compute it in the enclosing async ` +
      `function (a \`for\` loop over the collection, or a \`const r = ${calleeName}(…)\` binding) ` +
      `rather than inside the value-consuming callback. (Fire-and-forget scheduler callbacks — ` +
      `\`setTimeout\`/\`setInterval\`/… — DISCARD the return and are handled automatically; this ` +
      `error is only for positions whose value is actually consumed.)`,
    { file: filePath ?? sp.file ?? "", start: sp.start ?? 0, end: sp.end ?? 0, line: sp.line ?? 1, col: sp.col ?? 1 },
    "error",
  );
}

/**
 * Seam-A no-silent-leak backstop (S239 finding 6 + finding 2 multi-hop) — the
 * SHARED indirect-alias diagnostic. A local `const g = middle` (middle async), or a
 * multi-hop `const g = middle; const h = g`, then a call `g()`/`h()` is an indirect
 * async call: `collectCalleeIdents` sees only DIRECT ident calls, so the aliased
 * call is neither colored, awaited, nor drained → the Promise leaks. `collectAliasedAsyncCalls`
 * now chain-follows the alias to its async terminal (`resolvedName`); we FAIL CLOSED
 * so the leak never ships (consistent with the single-level case — the caller can
 * call the resolved async fn directly for auto-await).
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
 * Seam-A no-silent-leak backstop (S239 finding 6 + finding 2) — structurally detect
 * calls to a LOCAL binding that aliases an async fn, including a MULTI-HOP chain
 * (`const g = middle; const h = g; h()` → `h -> g -> middle(async)`). Pass 1 collects
 * every simple `X = <ident>` decl; Pass 1b chain-follows each to its async terminal
 * (cycle-safe); Pass 2 flags every call to a resolved alias. Returns each indirect
 * call site (with the alias + terminal async name) for the caller to fail-close via
 * `aliasedAsyncCallError`. A computed/non-ident binding is still out of scope — but
 * never a silent leak: an un-resolvable alias simply is not flagged as async, and a
 * resolvable chain of any depth is caught.
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
  // Pass 1 — collect EVERY simple ident alias `X = <ident>` (const/let/tilde/lin
  // decl whose initializer is a bare ident, structurally OR from the raw init text),
  // REGARDLESS of whether the RHS is itself async. A re-alias `h = g` (g not
  // directly async, itself an alias) must be captured so the chain can be followed
  // to its async terminal (finding 2 — the pre-fix single-level scan missed it).
  const declToRhs = new Map<string, string>();
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
      if (rhs && rhs !== n.name) declToRhs.set(n.name, rhs);
    }
    for (const key of Object.keys(n)) {
      if (key === "span") continue;
      const v = n[key];
      if (v && typeof v === "object") collectAliases(v);
    }
  };
  collectAliases(fnBody);
  if (declToRhs.size === 0) return [];
  // Pass 1b — CHAIN-FOLLOW each alias transitively to a terminal async name
  // (`h -> g -> middle(async)`), the ratified full-multi-hop resolution. Cycle-safe:
  // a `visited` set terminates a self/mutual alias cycle (`a = b; b = a`). Only an
  // alias whose chain terminates in an async fn is recorded; a chain ending in a
  // plain sync name (or a cycle) is not a leak and is left out.
  const aliasToResolved = new Map<string, string>();
  for (const start of declToRhs.keys()) {
    const visited = new Set<string>([start]);
    let cur: string | undefined = declToRhs.get(start);
    while (cur !== undefined) {
      if (isAsyncName(cur)) { aliasToResolved.set(start, cur); break; }
      if (visited.has(cur)) break;   // cycle → not async, stop
      visited.add(cur);
      cur = declToRhs.get(cur);      // next hop; undefined ends the chain (sync)
    }
  }
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
 *      sees the inner call to lower it, OR
 *   3. (S239 param-default fix) inside the ENCLOSING fn's OWN parameter default —
 *      `function f(x = safeCallAsync(...))`. A param default is eagerly evaluated
 *      OUTSIDE the fn's async body; `await` is a JS SyntaxError in a default even
 *      in an async fn (DD colorless-async-boundaries position-2, the CONFIRMED
 *      fail-close anchor). `paramSignature` splices `p.defaultValue` as RAW TEXT,
 *      so it is neither in `fnBody` nor structurally reachable — scan the text.
 * Returns each such site for the caller to fail-close via `asyncStdlibSyncCallbackError`.
 *
 * An AWAITABLE-position async call (a top-level statement / decl init / control-flow
 * condition, NOT inside a lambda) is handled by the emit's auto-await and is NOT
 * returned. This is the SAME structural traversal shape as `computeAsyncFnNames`'s
 * coloring, so coloring and this drain cannot drift (the S239 root cause).
 *
 * @param params  the enclosing fn's `fnNode.params` — each `{defaultValue?: string}`
 *                entry's raw default text is scanned (case 3). Omit for a bare-body
 *                scan (back-compatible).
 * @param fnSpan  a fallback span for a param-default site (param entries carry no
 *                span of their own; points the diagnostic at the fn declaration).
 */
export function collectNonAwaitableAsyncCalls(
  fnBody: unknown,
  calleeMap: CalleeImportMap | null,
  exportRegistry: ExportRegistry | null,
  asyncFnNames: Set<string>,
  params?: unknown,
  fnSpan?: unknown,
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
    // Phase-2 colorless-async — a CLEAN-FAMILY collection-method call with an
    // async first-arg callback is NOT a non-awaitable leak: emit-expr lowers it to
    // `await _scrml_<method>Async(coll, asyncCb)` and RE-EMITS the callback async,
    // so the async call inside becomes an awaited combinator-callback body. Walk
    // the receiver + trailing args normally, and the callback lambda's body as
    // AWAITABLE (insideCallback=false) — but still descend so a DOUBLY-nested SYNC
    // lambda inside the callback is caught. `.sort` is NOT clean-family, so its
    // async-comparator lambda stays a non-awaitable region and correctly fails
    // closed (DD FORK 2).
    if (k === "call" && isAsyncCombinatorCall(n, isAsyncName)) {
      // F2 (S239 review) — the combinator CALL itself is awaitable (it returns a
      // Promise), but if THIS call sits in a non-awaitable position (a sync-lambda
      // param default / a raw region — `insideCallback`), emit-expr emits it BARE
      // `_scrml_<m>Async(...)` (an unawaited Promise → accept-all leak). `await` is
      // illegal there, so fail closed — mode-agnostically, since every drain
      // (library / client / server value-export) runs this scan. The callback body
      // is still walked AWAITABLE below (emit-expr re-emits it async even when the
      // combinator itself is bare).
      const propName = ((n.callee as ASTNode | undefined)?.property);
      if (insideCallback && typeof propName === "string") {
        record(`${propName}(…) async-callback combinator`, n.span);
      }
      const callee = n.callee as ASTNode | undefined;
      if (callee) walk(callee, insideCallback);
      const cbArgs = Array.isArray(n.args) ? (n.args as unknown[]) : [];
      const cb = cbArgs[0] as ASTNode | undefined;
      if (cb && cb.kind === "lambda") {
        walk(cb.body, false);
        for (const p of (Array.isArray(cb.params) ? (cb.params as unknown[]) : [])) walk(p, true);
      } else if (cb) {
        walk(cb, insideCallback);
      }
      for (let ai = 1; ai < cbArgs.length; ai++) walk(cbArgs[ai], insideCallback);
      return;
    }
    // KNOWN-DISCARD-HOF colorless-async (S279 over-fire fix) — a bare-ident call to a
    // global fire-and-forget scheduler (setTimeout/setInterval/…) that DISCARDS its
    // callback's return is NOT a non-awaitable leak: emit-expr re-emits the async
    // callback lambda ASYNC so its inner async call becomes an awaited async-callback
    // body, and the HOF call itself is never awaited (it returns a timer id, not a
    // Promise — so it is NOT recorded even in a non-awaitable position). Walk the
    // callee + non-lambda args normally, and each async-reaching callback lambda's
    // body as AWAITABLE (insideCallback=false) — still descending so a DOUBLY-nested
    // SYNC lambda inside the callback is caught. A member callee (`obj.setTimeout`)
    // does NOT match here and stays fail-closed (deferred user-HOF Case 2).
    if (k === "call" && isKnownDiscardHofCall(n, isAsyncName)) {
      const callee = n.callee as ASTNode | undefined;
      if (callee) walk(callee, insideCallback);
      const hofArgs = Array.isArray(n.args) ? (n.args as unknown[]) : [];
      for (const a of hofArgs) {
        const an = a as ASTNode | undefined;
        if (an && an.kind === "lambda" && callbackReachesAsync(an, isAsyncName)) {
          walk(an.body, false);
          for (const p of (Array.isArray(an.params) ? (an.params as unknown[]) : [])) walk(p, true);
        } else if (an) {
          walk(an, insideCallback);
        }
      }
      return;
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
  // Case 3 — the enclosing fn's OWN parameter defaults. `paramSignature` splices
  // `p.defaultValue` as RAW TEXT, so it lives in neither `fnBody` nor a structural
  // node — scan the text for async callees (mirrors the raw escape-hatch branch).
  // A structured default (a destructure-pattern's `defaultExpr` ExprNode) is walked
  // structurally as an un-awaitable region.
  if (Array.isArray(params)) {
    for (const p of params) {
      if (!p || typeof p !== "object") continue;
      const pd = p as { defaultValue?: unknown; defaultExpr?: unknown; span?: unknown };
      const site = pd.span ?? fnSpan;
      if (typeof pd.defaultValue === "string" && pd.defaultValue.length > 0) {
        for (const c of extractCalleeNames(pd.defaultValue)) if (isAsyncName(c)) record(c, site);
      } else if (pd.defaultValue && typeof pd.defaultValue === "object") {
        walk(pd.defaultValue, true);
      }
      if (pd.defaultExpr && typeof pd.defaultExpr === "object") walk(pd.defaultExpr, true);
    }
  }
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
 *
 * GITI-038 — `nonAsyncReemit` is the Q1/Q2 SPLIT: a factory that HOLDS a nested
 * async closure (`computeNestedAsyncFnHolders`) but whose OWN body awaits nothing.
 * It must lower its body at the SERVER boundary (so the nested closure's stdlib
 * call is auto-awaited + the closure emits `async`) while its OWN signature stays
 * NON-async (its body just returns the closure — no top-level await). Undefined on
 * the server/tool callers → byte-identical to the pre-GITI-038 `isAsync?server:client`.
 */
export function emitLibraryFnMember(
  fnNode: ASTNode,
  opts: { isExported: boolean; asyncFnNames: Set<string>; foreignCrossingErrors?: unknown[]; nonAsyncReemit?: boolean },
): string {
  const name = (fnNode.name ?? "anon") as string;
  const ownAsync = opts.asyncFnNames.has(name);
  // Q1 — the OWN signature carries `async` only when the fn's own body awaits.
  const signatureAsync = ownAsync;
  // Q2 — the body lowers server-side when it is async OR merely holds a nested
  // async closure (so the nested await is legal + the closure is colored async).
  const serverBody = ownAsync || opts.nonAsyncReemit === true;
  const params = (fnNode.params ?? []) as unknown[];
  const paramList = params.map((p, i) => paramSignature(p as never, i)).join(", ");
  const star = fnNode.isGenerator ? "*" : "";
  const declaredNames = new Set<string>(
    params
      .map((p) => (typeof p === "string" ? p.split(/[:=]/)[0].trim() : (p as ASTNode)?.name))
      .filter((n): n is string => typeof n === "string" && n.length > 0),
  );
  const bodyOpts = serverBody
    ? { boundary: "server", serverFnNames: opts.asyncFnNames, declaredNames, insideFunctionBody: true, foreignCrossingErrors: opts.foreignCrossingErrors }
    : { boundary: "client", declaredNames, insideFunctionBody: true };
  const bodyCodes = emitFnShortcutBody(
    (fnNode.body ?? []) as never[],
    bodyOpts as never,
    fnNode.fnKind as string | undefined,
    fnNode.hasReturnType as boolean | undefined,
  );
  const lines: string[] = [
    `${opts.isExported ? "export " : ""}${signatureAsync ? "async " : ""}function${star} ${name}(${paramList}) {`,
  ];
  for (const code of bodyCodes) for (const line of code.split("\n")) lines.push(`  ${line}`);
  lines.push("}");
  return lines.join("\n");
}
