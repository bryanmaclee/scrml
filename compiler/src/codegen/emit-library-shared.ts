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

/** A loosely-typed AST node. */
type ASTNode = Record<string, unknown>;

/**
 * Deep-scan a fn body's AST for a directly-async signal (`_{}` / `?{}`). A
 * `<transaction>` block is deliberately NOT a signal — transactions are STAGED
 * (§44.6 / SPEC-ISSUE-018), so a transaction-only fn is not async-colored and is
 * routed away from the in-process emit (codegen/index.ts + emit-tool skip).
 */
export function bodyHasForeignOrSql(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;
  const n = node as ASTNode;
  if (n.kind === "foreign" || n.kind === "sql") return true;
  if (n.foreignNode || n.sqlNode) return true;
  for (const k of Object.keys(n)) {
    if (k === "span") continue;
    const v = n[k];
    if (Array.isArray(v)) { for (const c of v) if (bodyHasForeignOrSql(c)) return true; }
    else if (v && typeof v === "object") { if (bodyHasForeignOrSql(v)) return true; }
  }
  return false;
}

/**
 * Compute the set of library fn names that must be emitted `async` (and whose
 * call sites must be awaited). Seed = fns that directly do `?{}` / `_{}` / carry
 * `isAsync`, UNION `seedAsync` (the CROSS-IMPORT async names — a lib fn calling
 * an async fn imported from ANOTHER lib awaits it too). Then fixpoint-propagate
 * over the call graph: a fn calling any async fn is itself async. Call detection
 * is a source-text scan of each fn's span for `\bname\s*\(` — reliable and
 * opacity-safe (it never re-parses).
 */
export function computeAsyncFnNames(
  fns: ASTNode[],
  sourceText: string | null,
  seedAsync?: Set<string>,
): Set<string> {
  const async = new Set<string>(seedAsync ?? []);
  const bodyTextByName = new Map<string, string>();
  for (const fn of fns) {
    const name = fn.name as string | undefined;
    if (!name) continue;
    const span = fn.span as { start?: number; end?: number } | undefined;
    const text = sourceText && span && typeof span.start === "number" && typeof span.end === "number"
      ? sourceText.slice(span.start, span.end)
      : "";
    bodyTextByName.set(name, text);
    if (fn.isAsync === true || bodyHasForeignOrSql(fn.body)) async.add(name);
  }
  // Fixpoint — a fn calling any async fn becomes async.
  let changed = true;
  while (changed) {
    changed = false;
    for (const fn of fns) {
      const name = fn.name as string | undefined;
      if (!name || async.has(name)) continue;
      const text = bodyTextByName.get(name) ?? "";
      for (const asyncName of async) {
        if (asyncName === name) continue;
        if (new RegExp(`\\b${asyncName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\(`).test(text)) {
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
