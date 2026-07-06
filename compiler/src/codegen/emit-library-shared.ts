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

/** A loosely-typed AST node. */
type ASTNode = Record<string, unknown>;

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
 * a `member` callee) is NOT a peer-fn call and is skipped. Structural — never a
 * source-text scan, so a call-shaped token inside a comment or string literal
 * can never register as a call (the S239 fix for the over-matching text regex).
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
  // A peer call can also hide in RAW text the parser never structured into `call`
  // nodes: a BLOCK-BODY lambda/callback (`x => { a() }`) becomes an `escape-hatch`
  // whose call lives only in `.raw`, and a template-literal interpolation
  // (`` `${a()}` ``) keeps its call in the `lit` `.raw`. Recover those callees
  // textually with the SAME shared helper emit-server's peer-emission walk uses
  // (scheduling.extractCalleeNames) — else a fn reaching an async peer ONLY through
  // such a callback is left sync and leaks an un-awaited Promise (the shape the old
  // whole-body source regex caught but a purely structural `call`-node walk misses;
  // over-recovering a non-async name is harmless — the fixpoint colors on
  // `async.has(callee)`).
  if ((n.kind === "escape-hatch" || (n.kind === "lit" && n.litType === "template"))
      && typeof n.raw === "string") {
    for (const c of extractCalleeNames(n.raw)) out.add(c);
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
 * `isAsync`, UNION `seedAsync` (the CROSS-IMPORT async names — a lib fn calling
 * an async fn imported from ANOTHER lib awaits it too). Then fixpoint-propagate
 * over the call graph: a fn calling any async fn is itself async.
 *
 * Call detection is STRUCTURAL (the fn body's `call` nodes), NOT a source-text
 * regex. The prior `\bname\s*\(` text scan over-matched a call-shaped token in a
 * comment or string literal → it mis-colored a sync web-app server export as
 * `async` (S239 regression). `_sourceText` is retained for call-site
 * compatibility but is no longer consulted.
 */
export function computeAsyncFnNames(
  fns: ASTNode[],
  _sourceText?: string | null,
  seedAsync?: Set<string>,
): Set<string> {
  const async = new Set<string>(seedAsync ?? []);
  const calleesByName = new Map<string, Set<string>>();
  for (const fn of fns) {
    const name = fn.name as string | undefined;
    if (!name) continue;
    const callees = new Set<string>();
    collectCalleeIdents(fn.body, callees);
    calleesByName.set(name, callees);
    if (fn.isAsync === true || bodyHasForeignOrSql(fn.body)) async.add(name);
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
