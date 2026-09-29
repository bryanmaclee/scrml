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
import { paramSignature, indentBodyLines } from "./utils.ts";
import { bodyContains } from "./collect.ts";
import { extractCalleeNames, buildCalleeImportMap } from "./scheduling.ts";
import { isPromiseReturningStdlibFn } from "../module-resolver.js";
import { CGError } from "./errors.ts";
// Phase-2 colorless-async — the clean-family combinator detector, shared with the
// emit-expr lowering site so the fail-closed drain and the lowering agree on which
// callbacks are transformed (and therefore must NOT fail closed).
import { isAsyncCombinatorCall, isKnownDiscardHofCall, callbackReachesAsync, isAsyncCalleeName, ASYNC_COMBINATOR_METHODS, KNOWN_DISCARD_HOF, isSyncCallbackConsumerCall } from "./async-combinators.ts";
import type { AsyncNameFacts } from "./async-combinators.ts";
// s440 — nested-helper async coloring (marks set by `annotateLocalAsyncFns`).
import {
  localCalleeOf,
  localFnRefOf,
  localAsyncDeclRoot,
  annotateLocalAsyncFns,
  calleesThroughDirectlyCalledNestedFns,
  anchorDiagnosticSpan,
  localSyncShadowOf,
  rawAsyncUsesOf,
  BOUND_CALLEE_MARK,
} from "./local-async-fns.ts";
import type { AsyncRoot, AsyncEscapeSite, RawAsyncUses } from "./local-async-fns.ts";
// s441 — scope-aware analysis of raw JS fragments (FP1) and of emitted handler /
// mount bodies (F5); the async-escape check (S440 F4).
import { analyzeRawJsFragment } from "./js-async-analysis.ts";
import type { FreeAsyncResolver, JsAsyncUses } from "./js-async-analysis.ts";

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
 * STRUCTURAL ONLY (S259 colorless-async-boundaries [4]) for every structured node —
 * NEVER a source-text scan. The prior `extractCalleeNames(.raw)` recovery over a
 * block-body lambda / template `.raw` used the over-matching `\bname\s*\(` regex
 * (matches a call-shaped token in a string/comment) → false-positive coloring.
 * Dropped: a call buried in a RAW verbatim body is NOT a coloring signal; that shape
 * is bucket (c) (fail-closed, structurally detected) or bucket (a) (an array-method
 * callback routed to the async combinator), never a raw text-scan for coloring.
 *
 * NARROW EXCEPTION (g-match-arm-server-call-no-autoawait) — a value-form `match`
 * arm carries its RESULT as a raw expression STRING (the ast-builder does not
 * structure the arm-result tail), so a server/async call there has NO structured
 * `call` node to walk. Those specific arm strings ARE text-scanned (string literals
 * pre-stripped to avoid the S239 over-match), so §13.2 auto-await colouring reaches
 * a call the structural walk cannot see. Scoped to match-arm result strings only.
 */
/** Strip string/template/regex-ish literal CONTENTS so a call-shaped token inside a
 *  `"…"`/`'…'`/backtick literal is not mis-read as a callee (S239 over-match guard). */
function _stripStringLiterals(s: string): string {
  return s.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""');
}

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
  // g-match-arm-server-call-no-autoawait (§13.2 / §19.9.3) — a value-form match
  // arm frequently carries its RESULT as a raw expression STRING (`match-arm-inline`
  // `result`, or the whole `test :> result` text on a `bare-expr` arm `expr`) whose
  // call is INVISIBLE to the structural `call`-node walk above — the string field is
  // skipped by the generic recursion. Harvest callee idents from those arm strings
  // so a server/async call buried in a match arm colours the enclosing fn `async`
  // (its emitted arm result is auto-awaited by emitMatchExprDecl →
  // parenthesizeAwaitServerCallsInExpr). String LITERALS are stripped first so a
  // call-shaped token inside a `"…"` pattern/result is not a false coloring signal
  // (the S239 text-scan over-match guard). Structured arm bodies (match-arm-block)
  // are already covered by the generic recursion into their `.body` statement array.
  if (n.kind === "match-expr" || n.kind === "match-stmt") {
    const arms = Array.isArray((n as ASTNode).body) ? ((n as ASTNode).body as ASTNode[]) : [];
    for (const arm of arms) {
      if (!arm || typeof arm !== "object") continue;
      const s = typeof (arm as ASTNode).result === "string" && (arm as ASTNode).result
        ? ((arm as ASTNode).result as string)
        : (typeof (arm as ASTNode).expr === "string" ? ((arm as ASTNode).expr as string) : "");
      if (s) for (const c of extractCalleeNames(_stripStringLiterals(s))) out.add(c);
    }
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
    // s440 — the guarded walk stops at a nested function's body, but a body that
    // CALLS a nested helper awaits it (`local-async-fns.ts`), so the helper's own
    // callees are this function's too. (The unguarded walk already descends.)
    if (guardNestedFnValues === true) {
      for (const c of calleesThroughDirectlyCalledNestedFns(
        fn.body,
        (node, out) => collectCalleeIdents(node, out, true),
      )) callees.add(c);
    }
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
  via?: string | null,
): CGError {
  const sp = diagnosticSpan(span, filePath);
  const viaNote = via && via !== calleeName
    ? ` (\`${calleeName}\` is a nested helper that the compiler emits async because it calls \`${via}(…)\`.)`
    : "";
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
      `error is only for positions whose value is actually consumed.)` + viaNote,
    sp,
    "error",
  );
}

/**
 * The SHARED E-SERVER-FN-IN-SYNC-CALLBACK builder — the peer-server-fn twin of
 * `asyncStdlibSyncCallbackError`. emit-server's route-handler drain and the client
 * drain (emit-functions) both use it, so the two sides report one wording.
 * `via` names the server fn a NESTED helper is async through (s440): the helper
 * `inner` calling server fn `isOk` inside a sync callback is reported as
 * `inner`, with `isOk` named as the reason.
 */
export function serverFnSyncCallbackError(
  peerName: string,
  span: unknown,
  filePath?: string | null,
  via?: string | null,
): CGError {
  const sp = diagnosticSpan(span, filePath);
  const subject = via && via !== peerName
    ? `\`${peerName}\` (a nested helper the compiler emits async because it calls server function \`${via}\`)`
    : `server function \`${peerName}\``;
  return new CGError(
    "E-SERVER-FN-IN-SYNC-CALLBACK",
    `E-SERVER-FN-IN-SYNC-CALLBACK: ${subject} is called inside a ` +
    `synchronous callback. A server function runs asynchronously, but \`await\` is ` +
    `not valid in a non-async callback (and making the callback async would make ` +
    `\`.map\`/\`.forEach\` yield Promises instead of values). Refactor to a \`for\` loop ` +
    `so the call runs in the server function's async body, e.g. ` +
    `\`for (const x of xs) { ... ${peerName}(x) ... }\`.`,
    sp,
    "error",
  );
}

/**
 * One recorded non-awaitable async call site. `rootKind`/`via` are present when the
 * callee is a NESTED helper (s440, `local-async-fns.ts`): they name what the helper's
 * asyncness bottoms out in, which decides the diagnostic code.
 */
export interface SyncCallSite {
  name: string;
  span: unknown;
  rootKind?: "server" | "stdlib";
  via?: string;
}

/**
 * Pick the right fail-closed diagnostic for a recorded site: a peer SERVER function
 * (directly, or a nested helper async through one) is E-SERVER-FN-IN-SYNC-CALLBACK;
 * everything else — a Promise-returning stdlib call, a transitively-async local
 * peer, a `?{}` body — is E-ASYNC-STDLIB-IN-SYNC-CALLBACK. Before s440 the client
 * path reported every site with the stdlib code, a peer server fn included.
 */
export function syncCallbackErrorForSite(
  site: SyncCallSite,
  serverFnNames: ReadonlySet<string> | null | undefined,
  filePath?: string | null,
): CGError {
  const isServer = site.rootKind != null
    ? site.rootKind === "server"
    : !!(serverFnNames && serverFnNames.has(site.name));
  return isServer
    ? serverFnSyncCallbackError(site.name, site.span, filePath, site.via ?? null)
    : asyncStdlibSyncCallbackError(site.name, site.span, filePath, site.via ?? null);
}

/**
 * s440 — the Promise-returning-stdlib predicate over a per-file callee map + the
 * export registry (the classifier every drain builds inline), or null when either
 * input is absent. Shared so callers need not import module-resolver themselves.
 */
export function stdlibAsyncPredicate(
  calleeMap: CalleeImportMap | null | undefined,
  exportRegistry: ExportRegistry | null | undefined,
): ((name: string) => boolean) | null {
  if (!calleeMap || !exportRegistry || exportRegistry.size === 0) return null;
  return (name: string): boolean => {
    const src = calleeMap.get(name);
    return !!src && isPromiseReturningStdlibFn(name, src, exportRegistry);
  };
}

/**
 * s440 — run the nested-helper async pre-pass (`annotateLocalAsyncFns`) over one
 * top-level function with an emitter's OUTER async facts. Every emitter calls this
 * with the SAME facts it hands `isAsyncCalleeName`, so "is this nested helper async"
 * and "is this file-scope name async" are one decision. The root classification
 * decides the diagnostic code: a peer server fn is `server`; a stdlib export or a
 * transitively-async local peer is `stdlib` (the code a direct call to that peer
 * already reports).
 */
export function annotateNestedAsyncHelpers(
  fnNode: unknown,
  facts: AsyncNameFacts,
  sqlIsAsync: boolean,
  escapes?: AsyncEscapeSite[],
  escapeFacts?: AsyncNameFacts,
): number {
  const outerAsync = (name: string): AsyncRoot | null => outerAsyncRootFromFacts(name, facts);
  return annotateLocalAsyncFns(fnNode, {
    outerAsync,
    sqlIsAsync,
    bodyHasSql: bodyHasForeignOrSql,
    isByRefInvokingCall: (call) => {
      const callee = call.callee as ASTNode | undefined;
      return !!callee && callee.kind === "member" && typeof callee.property === "string" &&
        (ASYNC_COMBINATOR_METHODS.has(callee.property) || isSyncCallbackConsumerCall(call));
    },
    fnArgRole: asyncFnArgRole,
    analyzeRaw: (raw, resolveFree) => analyzeRawJsFragment(raw, resolveFree) as RawAsyncUses | null,
    ...(escapes ? { escapes } : {}),
    ...(escapeFacts ? { escapeOuterAsync: (name: string) => outerAsyncRootFromFacts(name, escapeFacts) } : {}),
    isFileBound: (name: string) => !!facts.boundNames && facts.boundNames.has(name),
  });
}

/**
 * s441 — the emitter's OUTER async facts as a root: a server-boundary fn is
 * `server`; a Promise-returning stdlib export or a transitively-async local peer is
 * `stdlib` (the code a direct call to it already reports). Shared by the nested-
 * helper pre-pass and the text analysis of handler / mount bodies.
 */
export function outerAsyncRootFromFacts(name: string, facts: AsyncNameFacts): AsyncRoot | null {
  if (facts.serverFnNames != null && facts.serverFnNames.has(name)) return { kind: "server", via: name };
  if (facts.isStdlibAsync != null && facts.isStdlibAsync(name)) return { kind: "stdlib", via: name };
  if (facts.asyncFnNames != null && facts.asyncFnNames.has(name)) return { kind: "stdlib", via: name };
  return null;
}

/** s441 — `outerAsyncRootFromFacts` as a free-name resolver for js-async-analysis. */
export function freeAsyncResolverFromFacts(facts: AsyncNameFacts): FreeAsyncResolver {
  return Object.assign(
    (name: string) => {
      const root = outerAsyncRootFromFacts(name, facts);
      return root ? { root, local: false } : null;
    },
    { isBound: (name: string): boolean => !!facts.boundNames && facts.boundNames.has(name) },
  );
}

/**
 * s441 fix round — every name the FILE binds at file scope: function
 * declarations (top-level, and the bodies of top-level logic blocks), top-level
 * `let`/`const`/`tilde`/`lin` declarations, and imported local names. Walks
 * statements without descending into function bodies. Over-collection only makes
 * a scheduler exemption fail CLOSED (the name is treated as a user binding).
 */
export function fileBoundNamesOf(fileAST: unknown, sourceText?: string | null): Set<string> {
  const out = new Set<string>();
  if (!fileAST || typeof fileAST !== "object") return out;
  // s441 fix round 3 (review N1) — a scheduler name the source BINDS in any form
  // (a destructuring pattern, a `for…of` binding, a parameter, a catch clause, an
  // import alias, …) at any depth is not the global scheduler. Rather than model
  // every binding form, the exemption is narrowed to what can be proven from the
  // text: a scheduler name counts as unbound only when EVERY occurrence in the
  // source is a plain call `name(` (not after `function`) or a member read
  // `.name`. Any other occurrence — including one in a string or comment —
  // withdraws the exemption for the whole file (fail CLOSED: the async fn value
  // is then reported as an escape). `const { setTimeout } = globalThis` is
  // withdrawn too (sound, conservative).
  const rawSrc = typeof sourceText === "string" ? sourceText
    : typeof (fileAST as { _sourceText?: unknown })._sourceText === "string" ? (fileAST as { _sourceText: string })._sourceText
    : null;
  // Comments are not bindings: a `// … setTimeout …` note must not withdraw the
  // exemption (it failed flogence's `setTimeout(() => hydrate(), 0)` calls).
  // Stripped: `/* … */`, `<!-- … -->`, and a `//` comment that starts a line or
  // follows whitespace (a `http://` URL does not match). Strings are NOT stripped —
  // markup prose apostrophes make a text-level string scanner unreliable, and a
  // mis-opened "string" could hide a real binding (fail open); a mention inside a
  // string stays a withdrawal (fail closed).
  const src = rawSrc === null ? null : rawSrc
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/(^|\s)\/\/[^\n]*/g, "$1");
  if (src !== null) {
    for (const nm of KNOWN_DISCARD_HOF) {
      if (!src.includes(nm)) continue;
      const re = new RegExp(`(^|[^A-Za-z0-9_$])${nm}(?![A-Za-z0-9_$])`, "g");
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        const start = m.index + m[1].length;
        const before = src.slice(Math.max(0, start - 40), start);
        const after = src.slice(start + nm.length, start + nm.length + 40);
        const isMember = /\.\s*$/.test(before);
        const isCall = /^\s*\(/.test(after) && !/\bfunction\s*\*?\s*$/.test(before);
        if (!isMember && !isCall) { out.add(nm); break; }
      }
    }
  }
  for (const k of buildCalleeImportMap(fileAST as ASTNode).keys()) out.add(k);
  const seen = new WeakSet<object>();
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object" || seen.has(node as object)) return;
    seen.add(node as object);
    if (Array.isArray(node)) { for (const c of node) visit(c); return; }
    const n = node as ASTNode;
    const kind = n.kind as string | undefined;
    if (kind === "function-decl") {
      if (typeof n.name === "string" && n.name) out.add(n.name);
      return; // not its body
    }
    if (kind === "lambda") return;
    if ((kind === "let-decl" || kind === "const-decl" || kind === "tilde-decl" || kind === "lin-decl") &&
        typeof n.name === "string") {
      const m = n.name.match(/^[A-Za-z_$][A-Za-z0-9_$]*/);
      if (m) out.add(m[0]);
    }
    for (const key of Object.keys(n)) {
      if (key === "span") continue;
      const v = n[key];
      if (v && typeof v === "object") visit(v);
    }
  };
  const f = fileAST as { nodes?: unknown; ast?: { nodes?: unknown } };
  visit(f.nodes ?? f.ast?.nodes ?? []);
  return out;
}

/**
 * s441 (S440 F4) — what a call may do with an async-colored function passed as
 * argument `index`. The ruling: only the AWAITED collection methods may take it —
 * the first argument of a clean-family method (`.some`/`.every`/`.find`/
 * `.findIndex`/`.filter`/`.map`/`.forEach`/`.reduce`/`.flatMap`), which emit-expr
 * lifts to the sequential `_scrml_<m>Async` combinator that awaits every call.
 * Two further positions are not escapes: a sync consumer with no combinator
 * (`.sort(inner)`) already fails closed with its own code, and a fire-and-forget
 * scheduler (`setTimeout(refresh, 1000)`) DISCARDS the return — no Promise reaches
 * a consumer, which is the hazard the ruling closes. Everything else — a user HOF,
 * `Array.from(xs, fn)`, `new Promise(fn)`, `el.addEventListener(…, fn)` — is an
 * escape.
 */
export function asyncFnArgRole(call: ASTNode, index: number): "allowed" | "own-code" | "escape" {
  const callee = call.callee as ASTNode | undefined;
  if (callee && callee.kind === "member" && typeof callee.property === "string" && !callee.optional && !call.optional) {
    if (index === 0 && ASYNC_COMBINATOR_METHODS.has(callee.property)) return "allowed";
    if (isSyncCallbackConsumerCall(call)) return "own-code";
  }
  // Only the GLOBAL scheduler discards the return: a program-bound
  // `function setTimeout(f) { return f(x) }` (local, file-scope, import, param)
  // hands the Promise back — s441 fix round, the reviewer's accept-all.
  if (callee && callee.kind === "ident" && typeof callee.name === "string" && KNOWN_DISCARD_HOF.has(callee.name) &&
      call[BOUND_CALLEE_MARK] !== true) {
    return "allowed";
  }
  return "escape";
}

/**
 * s441 (S440 F4) — the E-ASYNC-FN-ESCAPES-AS-VALUE builder. An async-colored
 * function (the compiler emits it `async`: a server function, a Promise-returning
 * stdlib function, or a helper that calls one) used as a VALUE. Whoever calls it
 * through that value gets an unawaited Promise — always truthy, so a check written
 * against it passes for every input. §13.2 awaits the calls the compiler can SEE;
 * a function value's calls it cannot, so the value may not escape.
 */
export function asyncFnEscapesAsValueError(
  site: { name: string; root: AsyncRoot; local: boolean; position: string },
  span: unknown,
  filePath?: string | null,
): CGError {
  const sp = diagnosticSpan(span, filePath);
  const nm = site.name;
  const why = site.root.via && site.root.via !== nm
    ? `the compiler emits it \`async\` because it calls ${site.root.kind === "server" ? "server function " : ""}\`${site.root.via}(…)\``
    : site.root.kind === "server"
      ? `it runs on the server, and the compiler emits it \`async\` and awaits every call to it`
      : `it returns a Promise, and the compiler emits it \`async\` and awaits every call to it`;
  return new CGError(
    "E-ASYNC-FN-ESCAPES-AS-VALUE",
    `E-ASYNC-FN-ESCAPES-AS-VALUE: \`${nm}\` is an async function — ${why} — and here it is ` +
      `${site.position}. Whoever calls it through that value gets an unawaited Promise, which is ` +
      `always truthy: a check written against it passes for every input. scrml inserts \`await\` ` +
      `only at call sites it can see (§13.2), so an async function may not escape as a value. ` +
      `Call it directly — \`${nm}(…)\` — so the compiler awaits the call, or hand it to an ` +
      `awaited collection method (\`.some\`, \`.every\`, \`.find\`, \`.findIndex\`, \`.filter\`, ` +
      `\`.map\`, \`.forEach\`, \`.reduce\`, \`.flatMap\`), which awaits every call it makes.`,
    sp,
    "error",
  );
}

/** s441 — report the escape sites the nested-helper pre-pass collected. */
export function asyncEscapeErrors(sites: AsyncEscapeSite[], filePath?: string | null): CGError[] {
  const out: CGError[] = [];
  const seen = new Set<string>();
  for (const s of sites) {
    const sp = (s.span ?? {}) as { start?: number };
    const key = `${s.name}@${sp.start ?? -1}|${s.position}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(asyncFnEscapesAsValueError(s, s.span, filePath));
  }
  return out;
}

/**
 * s441 — report a text analysis (js-async-analysis) as diagnostics: each async
 * call the compiler cannot await → the sync-callback code its root names; each
 * async function used as a value → E-ASYNC-FN-ESCAPES-AS-VALUE. `span` anchors
 * every site (text positions inside emitted JS map to no source line).
 */
export function jsAsyncUsesErrors(uses: JsAsyncUses, span: unknown, filePath?: string | null): CGError[] {
  const out: CGError[] = [];
  for (const c of uses.calls) {
    const via = c.local ? c.root.via : null;
    out.push(c.root.kind === "server"
      ? serverFnSyncCallbackError(c.name, span, filePath, via)
      : asyncStdlibSyncCallbackError(c.name, span, filePath, via));
  }
  for (const e of uses.escapes) out.push(asyncFnEscapesAsValueError(e, span, filePath));
  const sp = diagnosticSpan(span, filePath);
  for (const p of uses.promiseMethods ?? []) {
    out.push(new CGError(
      "E-ASYNC-CALL-PROMISE-METHOD",
      `E-ASYNC-CALL-PROMISE-METHOD: \`.${p.method}(…)\` is called on \`${p.name}(…)\`, which the compiler ` +
        `awaits for you (§13.2) — so \`.${p.method}\` would be read off the RESOLVED value, not a ` +
        `Promise, and throw a TypeError at run time. Remove \`.${p.method}(…)\` and use the value ` +
        `directly: \`const r = ${p.name}(…)\` then work with \`r\`` +
        (p.method === "then" ? "." : ` (a failure is handled with \`!{}\`, §19).`),
      sp,
      "error",
    ));
  }
  const seenEvt = new Set<string>();
  for (const c of uses.eventControlAfterAwait ?? []) {
    if (seenEvt.has(c.method)) continue;
    seenEvt.add(c.method);
    const isControl = /^(preventDefault|stopPropagation|stopImmediatePropagation|returnValue|cancelBubble)$/.test(c.method);
    const what = isControl
      ? (c.method === "returnValue" || c.method === "cancelBubble" ? `\`event.${c.method}\`` : `\`event.${c.method}()\``)
      : `\`${c.method.replace(/ \(derived from the event\)$/, "")}\` (the event, or a value derived from it)`;
    const effect = c.method === "preventDefault" || c.method === "returnValue"
      ? "performed the default action (the form submitted / the link navigated)"
      : isControl ? "propagated the event" : "performed the default action and propagated the event";
    out.push(new CGError(
      "E-EVENT-CONTROL-AFTER-AWAIT",
      `E-EVENT-CONTROL-AFTER-AWAIT: ${what} is used after this handler's first server / async call. ` +
        `The compiler awaits that call (§13.2), and by the time the handler resumes the browser has ` +
        `already ${effect} — cancelling or stopping the event then has no effect. After the first ` +
        `await a handler may only READ plain event properties (\`event.target\`, \`event.key\`, …); ` +
        `it may not call or read the event's control members, pass the event (or an alias, a container ` +
        `holding it, or a closure that uses it) anywhere, or alias it. Call \`event.preventDefault()\` / ` +
        `\`stopPropagation()\` before the first server call. If it must depend on the server's answer, call ` +
        `it unconditionally first and perform the action yourself when the answer allows it. (The ` +
        `compiler does not move it for you: that would change which events a conditional call applies to.)`,
      sp,
      "error",
    ));
  }
  for (const u of uses.unanalyzable ?? []) {
    out.push(new CGError(
      "E-ASYNC-HANDLER-UNANALYZABLE",
      `E-ASYNC-HANDLER-UNANALYZABLE: this event handler references the async function \`${u.name}\`, but ` +
        `the compiler could not analyse the handler's code, so it cannot insert the \`await\` §13.2 ` +
        `requires. Rather than ship an unawaited call (a Promise is always truthy), the build fails. ` +
        `Move the handler body into a named function and reference it (\`onclick=handle()\`). ` +
        `This is also a compiler defect worth reporting.`,
      sp,
      "error",
    ));
  }
  return out;
}

function diagnosticSpan(
  span: unknown,
  filePath?: string | null,
): { file: string; start: number; end: number; line: number; col: number } {
  const sp = (span ?? {}) as { file?: string; start?: number; end?: number; line?: number; col?: number };
  return { file: filePath ?? sp.file ?? "", start: sp.start ?? 0, end: sp.end ?? 0, line: sp.line ?? 1, col: sp.col ?? 1 };
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
 * coloring, so coloring and this drain cannot drift on TRAVERSAL (the S239 root
 * cause).
 *
 * CORRECTION (Limb 1, dpa-023) — matching traversal was never sufficient, and this
 * comment used to imply it was. The two also have to agree on the PREDICATE, and on
 * the client path they did not: `computeAsyncFnNames` uses `serverFnNames` only as a
 * seed trigger, so a client server fn was async to the emitter and sync here. Both
 * now call `isAsyncCalleeName` (`async-combinators.ts`), and this function takes
 * `serverFnNames` so it can be given the fact it was missing.
 *
 * @param params  the enclosing fn's `fnNode.params` — each `{defaultValue?: string}`
 *                entry's raw default text is scanned (case 3). Omit for a bare-body
 *                scan (back-compatible).
 * @param fnSpan  a fallback span for a param-default site (param entries carry no
 *                span of their own; points the diagnostic at the fn declaration).
 * @param serverFnNames
 *                Limb 1 (dpa-023) — the SERVER-BOUNDARY fn names in scope. THE FACT
 *                THIS DRAIN NEVER HAD. `asyncFnNames` comes from
 *                `computeAsyncFnNames`, which treats `serverFnNames` as a seed
 *                TRIGGER (`callsServerFn` colours the CALLER) and never admits the
 *                callee to its result set — so on the CLIENT path this scan asked
 *                "is `loadRows` async?" and got NO while, in the same compilation,
 *                `emit-expr` was answering YES and emitting `await loadRows()`.
 *                The consequence was a MISSING diagnostic, not a wrong emission:
 *                a client server-fn call stranded in a raw escape-hatch, a template
 *                `.raw` body or a fn-SIGNATURE parameter default is unreachable to
 *                `emit-expr`'s own `syncPeerCalls` sink, so nothing caught it.
 *                Omit → THIS PARAMETER contributes nothing (the library / tool /
 *                server-value callers, where server placement is not a concept and
 *                the peer set is already `asyncFnNames`). Note the scope of that
 *                claim: it is about the PARAMETER, not about the function. The
 *                `handlerExpr` skip in `walk` applies on every caller regardless of
 *                this argument, so "omit it and nothing changes for me" is true of
 *                the async-name facts and NOT of `collectNonAwaitableAsyncCalls` as
 *                a whole.
 */
export function collectNonAwaitableAsyncCalls(
  fnBody: unknown,
  calleeMap: CalleeImportMap | null,
  exportRegistry: ExportRegistry | null,
  asyncFnNames: Set<string>,
  params?: unknown,
  fnSpan?: unknown,
  serverFnNames?: ReadonlySet<string> | null,
): SyncCallSite[] {
  const out: SyncCallSite[] = [];
  const seen = new Set<string>();
  const hasStdlibClassifier = !!(calleeMap && exportRegistry && exportRegistry.size > 0);
  // Limb 1 (dpa-023) — the bespoke local closure this used to carry is GONE; the
  // rule now lives once in `isAsyncCalleeName`. `declaredNames` stays absent: this
  // scan walks a whole fn body with no scope tracker, which is the same (slightly
  // over-eager) shadowing posture it has always had.
  const facts: AsyncNameFacts = {
    asyncFnNames,
    serverFnNames: serverFnNames ?? null,
    isStdlibAsync: hasStdlibClassifier
      ? (name: string): boolean => {
          const src = calleeMap!.get(name);
          return !!src && isPromiseReturningStdlibFn(name, src, exportRegistry!);
        }
      : null,
  };
  const isAsyncName = (name: string): boolean => isAsyncCalleeName(name, facts);
  // s440 — the NESTED async helpers declared anywhere in this body, by name, with
  // the root of their asyncness (`local-async-fns.ts` marks them before emission).
  // Structured calls / by-reference uses carry their own lexical resolution; this
  // name map serves the two RAW-TEXT scans (escape-hatch / template `.raw`, and a
  // nested function's text param default), which have no structure to resolve.
  const localAsyncByName = new Map<string, AsyncRoot>();
  {
    const seenN = new WeakSet<object>();
    const gather = (node: unknown): void => {
      if (!node || typeof node !== "object" || seenN.has(node as object)) return;
      seenN.add(node as object);
      if (Array.isArray(node)) { for (const c of node) gather(c); return; }
      const n = node as ASTNode;
      if (n.kind === "function-decl" && typeof n.name === "string") {
        const r = localAsyncDeclRoot(n);
        if (r) localAsyncByName.set(n.name, r);
      }
      for (const key of Object.keys(n)) {
        if (key === "span") continue;
        const v = n[key];
        if (v && typeof v === "object") gather(v);
      }
    };
    gather(fnBody);
  }
  const record = (name: string, span: unknown, root?: AsyncRoot | null): void => {
    const sp = (span ?? {}) as { start?: number };
    const key = `${name}@${sp.start ?? -1}`;
    if (seen.has(key)) return;
    seen.add(key);
    const site: SyncCallSite = { name, span };
    if (root) { site.rootKind = root.kind; site.via = root.via; }
    out.push(site);
  };
  // A raw-text callee: a nested async helper (by name) or an outer async name.
  const recordRawCallee = (c: string, span: unknown): void => {
    const local = localAsyncByName.get(c);
    if (local) record(c, span, local);
    else if (isAsyncName(c)) record(c, span);
  };
  // The nearest enclosing node span that carries a REAL line/col (a statement span);
  // an expression-parser call span is a `1:1` placeholder (s440 — see
  // `anchorDiagnosticSpan`).
  const walk = (node: unknown, insideCallback: boolean, anchor: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const c of node) walk(c, insideCallback, anchor); return; }
    const n = node as ASTNode;
    const k = n.kind as string | undefined;
    const here = anchorDiagnosticSpan(n.span, anchor);
    const at = (span: unknown): unknown => anchorDiagnosticSpan(span, anchor);
    // Raw escape-hatch (block-body callback / raw JS) or template `.raw` — emitted
    // VERBATIM, so any async call inside is un-awaitable regardless of nesting.
    if ((k === "escape-hatch" || (k === "lit" && n.litType === "template")) && typeof n.raw === "string") {
      // s441 (FP1) — the scope-aware analysis the pre-pass attached (strings,
      // member calls and a same-named binding in scope no longer count); the name
      // scan remains only for a fragment that was not analysed (fail closed).
      const uses = rawAsyncUsesOf(n);
      if (uses) { for (const c of uses.calls) record(c.name, at(n.span), c.local ? c.root : null); }
      else for (const c of extractCalleeNames(n.raw)) recordRawCallee(c, at(n.span));
    }
    // s440 — a NESTED function's own parameter defaults. `paramSignature` splices a
    // default as RAW TEXT (evaluated eagerly, outside any async body — `await` is
    // illegal there even in an async fn), so a nested `function g(y = inner(1))`
    // was reached by neither emit-expr nor this walk. Same treatment as the
    // enclosing fn's own defaults (Case 3 below).
    if (k === "function-decl" && Array.isArray(n.params)) {
      scanParamDefaults(n.params as unknown[], here);
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
        record(`${propName}(…) async-callback combinator`, here);
      }
      const callee = n.callee as ASTNode | undefined;
      if (callee) walk(callee, insideCallback, here);
      const cbArgs = Array.isArray(n.args) ? (n.args as unknown[]) : [];
      const cb = cbArgs[0] as ASTNode | undefined;
      if (cb && cb.kind === "lambda") {
        walk(cb.body, false, here);
        for (const p of (Array.isArray(cb.params) ? (cb.params as unknown[]) : [])) walk(p, true, here);
      } else if (cb) {
        walk(cb, insideCallback, here);
      }
      for (let ai = 1; ai < cbArgs.length; ai++) walk(cbArgs[ai], insideCallback, here);
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
      if (callee) walk(callee, insideCallback, here);
      const hofArgs = Array.isArray(n.args) ? (n.args as unknown[]) : [];
      for (const a of hofArgs) {
        const an = a as ASTNode | undefined;
        if (an && an.kind === "lambda" && callbackReachesAsync(an, isAsyncName)) {
          walk(an.body, false, here);
          for (const p of (Array.isArray(an.params) ? (an.params as unknown[]) : [])) walk(p, true, here);
        } else if (an) {
          walk(an, insideCallback, here);
        }
      }
      return;
    }
    if (k === "call") {
      // s440 — a call to a NESTED helper answers from its lexical resolution.
      const local = localCalleeOf(n);
      if (insideCallback) {
        if (local) {
          if (local.async) record(local.name, here, local.root);
        } else if (localSyncShadowOf(n)) {
          // s441 (FP2) — the binding in scope is a SYNC nested fn sharing an async name.
        } else {
          // A structured call to an async name INSIDE a callback/param-default lambda.
          const name = (typeof n.name === "string" ? n.name : undefined)
            ?? (((n.callee as ASTNode | undefined)?.kind === "ident") ? (n.callee as ASTNode).name as string : undefined);
          if (typeof name === "string" && isAsyncName(name)) record(name, here);
        }
      }
      // s440 — an async function passed BY REFERENCE to a collection method that
      // invokes it synchronously, consumes the value, and has no async combinator
      // (`SYNC_CALLBACK_CONSUMER_METHODS` — `xs.sort(inner)` compares Promises). The
      // consuming call is not one the compiler can await, in ANY position. A user
      // HOF is not flagged: it may await what it is given (see the set's doc).
      if (isSyncCallbackConsumerCall(n)) {
        for (const a of (Array.isArray(n.args) ? (n.args as unknown[]) : [])) checkByRefArg(a, here);
      }
    }
    const childInside = insideCallback || k === "lambda";
    for (const key of Object.keys(n)) {
      if (key === "span") continue;
      const v = n[key];
      if (v && typeof v === "object") walk(v, childInside, here);
    }
  };
  const checkByRefArg = (a: unknown, anchor: unknown): void => {
    const an = a as ASTNode | null;
    if (!an || an.kind !== "ident" || typeof an.name !== "string") return;
    const local = localFnRefOf(an);
    if (local) {
      if (local.async) record(local.name, anchorDiagnosticSpan(an.span, anchor), local.root);
      return;
    }
    if (localSyncShadowOf(an)) return; // s441 (FP2) — a SYNC nested fn is in scope
    if (isAsyncName(an.name)) record(an.name, anchorDiagnosticSpan(an.span, anchor));
  };
  const scanParamDefaults = (ps: unknown[], site: unknown): void => {
    for (const p of ps) {
      if (!p || typeof p !== "object") continue;
      const pd = p as { defaultValue?: unknown; defaultExpr?: unknown; span?: unknown };
      const at = anchorDiagnosticSpan(pd.span, site);
      if (typeof pd.defaultValue === "string" && pd.defaultValue.length > 0) {
        const uses = rawAsyncUsesOf(p);
        if (uses) { for (const c of uses.calls) record(c.name, at, c.local ? c.root : null); }
        else for (const c of extractCalleeNames(pd.defaultValue)) recordRawCallee(c, at);
      } else if (pd.defaultValue && typeof pd.defaultValue === "object") {
        walk(pd.defaultValue, true, at);
      }
      if (pd.defaultExpr && typeof pd.defaultExpr === "object") walk(pd.defaultExpr, true, at);
    }
  };
  walk(fnBody, false, fnSpan);
  // Case 3 — the enclosing fn's OWN parameter defaults. `paramSignature` splices
  // `p.defaultValue` as RAW TEXT, so it lives in neither `fnBody` nor a structural
  // node — scan the text for async callees (mirrors the raw escape-hatch branch).
  // A structured default (a destructure-pattern's `defaultExpr` ExprNode) is walked
  // structurally as an un-awaitable region.
  if (Array.isArray(params)) scanParamDefaults(params, fnSpan);
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
  opts: { isExported: boolean; asyncFnNames: Set<string>; foreignCrossingErrors?: unknown[]; preparedStmtErrors?: unknown[]; nonAsyncReemit?: boolean },
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
    ? { boundary: "server", serverFnNames: opts.asyncFnNames, declaredNames, insideFunctionBody: true, foreignCrossingErrors: opts.foreignCrossingErrors, preparedStmtErrors: opts.preparedStmtErrors }
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
  for (const code of bodyCodes) for (const line of indentBodyLines(code, "  ")) lines.push(line);
  lines.push("}");
  return lines.join("\n");
}
