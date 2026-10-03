/**
 * @module server-session-guard
 *
 * The codegen BACKSTOP for E-SESSION-AMBIENT-SERVER (§6.6.9 / §20.5, S449 ruling
 * item 1 — ruling:user-voice-scrml.md S449 "RULED — 'your recs.'" item 1).
 *
 * Every server-mode lowering of an `@name` read produces `_scrml_body["name"]`,
 * the CLIENT request body. For `@session` that made identity client-controlled
 * (MEASURED S449: POST `{"session":{"userId":"victim"}}` wrote a row as
 * "victim"). §6.6.9: "`@session` is server-only identity and SHALL NEVER be
 * marshalled from the client".
 *
 * The front end refuses every server `@session` read (route-inference.ts,
 * E-SESSION-AMBIENT-SERVER) before codegen runs. This module is the fail-closed
 * floor UNDER that check, shared by every server lowering path — emit-expr's
 * structured `emitIdent`, rewrite.ts's regex rewriter and post-emit
 * `serverRewriteEmitted`, and the expression-parser AST rewriter. When one of them
 * meets an ambient `@session` in server mode it:
 *   1. emits `SERVER_SESSION_REFUSED` (an identifier nothing defines, so the code
 *      throws a ReferenceError if it ever runs) instead of `_scrml_body["session"]`;
 *   2. records the hit; emit-server drains the hits into
 *      `E-INTERNAL-SESSION-AMBIENT-SERVER` errors (suppressed by api.js when the
 *      front-end E-SESSION-AMBIENT-SERVER already reported — the backstop exists
 *      for a server `@session` the front end missed, which is a compiler bug).
 *
 * A file that declares its own `<session>` reactive cell owns the name: `@session`
 * is then an ordinary client cell (E-REACTIVE-003 / the §19.9.9 CPS marshal govern
 * it), and this guard stands down (`setServerSessionUserCell(true)`).
 *
 * Imports only `errors.ts` (itself import-free): rewrite.ts and expression-parser.ts
 * both use this module, and expression-parser.ts sits below codegen in the import graph.
 */

import { CGError } from "./errors.ts";

/**
 * Does the file declare a FILE-SCOPE `<session>` reactive cell — the only
 * declaration that makes a top-level `@session` read an ordinary cell read?
 *
 * Walks the file's top-level nodes, `${…}` logic bodies and markup children, but
 * NOT into a component's body: a `component-def`, or a markup subtree the
 * component expander produced (`_expandedFrom`) — a `<session>` declared there is
 * local to that component, and a top-level server function's `@session` does not
 * resolve to it. (S449 review F2: a file-wide census let a component-local
 * `${ <session> = {userId:"local"} }` switch off both the front-end check and this
 * backstop, and a top-level server `@session.userId` compiled to the request-body
 * read with 0 errors.) Function bodies are not descended either: a `@x = …` write
 * inside one is collapsed to a `state-decl` by the AST builder and is not a
 * declaration.
 */
export function fileScopeDeclaresSessionCell(nodes: unknown): boolean {
  const visit = (list: unknown): boolean => {
    if (!Array.isArray(list)) return false;
    for (const node of list) {
      if (!node || typeof node !== "object") continue;
      const n = node as Record<string, unknown>;
      if (n.kind === "state-decl" && n.name === "session") return true;
      if (n.kind === "component-def" || n.kind === "function-decl" || n.kind === "fn-decl") continue;
      if (n.kind === "markup" && typeof n._expandedFrom === "string") continue;
      if (n.kind === "logic" && visit(n.body)) return true;
      if (visit(n.children)) return true;
    }
    return false;
  };
  return visit(nodes);
}

/** The FileAST's top-level node list (tolerates the `{ ast: {…} }` wrapper). */
export function fileNodesOf(fileAST: unknown): unknown {
  const f = fileAST as Record<string, unknown> | null | undefined;
  if (!f) return [];
  return f.nodes ?? (f.ast as Record<string, unknown> | undefined)?.nodes ?? [];
}

/** The identifier emitted in place of a refused server `@session` read. */
export const SERVER_SESSION_REFUSED = "_scrml_server_session_refused";

let _userSessionCell = false;
let _hits: Array<{ via: string; span: unknown; context: unknown }> = [];
// The span of the server function being emitted, used when a lowering path has
// no node span of its own (the text rewriters). S449 review F6.
let _contextSpan: unknown = null;

/** Per file: does the file declare its own FILE-SCOPE `<session>` reactive cell? */
export function setServerSessionUserCell(on: boolean): void {
  _userSessionCell = !!on;
}

/** Set (or clear, with null) the span of the server function now being emitted. */
export function setServerSessionContextSpan(span: unknown): void {
  _contextSpan = span ?? null;
}

/** True when a server-mode `@session` read is the ambient one (no user cell owns the name). */
export function isServerAmbientSession(bareName: string): boolean {
  return bareName === "session" && !_userSessionCell;
}

/** Record a refused server `@session` lowering and return the replacement text. */
export function refuseServerAmbientSession(via: string, span?: unknown): string {
  const usable = span && typeof span === "object" && typeof (span as { start?: unknown }).start === "number";
  _hits.push({ via, span: usable ? span : null, context: _contextSpan });
  return SERVER_SESSION_REFUSED;
}

/** Reset the hit list and the context span (start of a codegen run). */
export function resetServerAmbientSessionRefusals(): void {
  _hits = [];
  _contextSpan = null;
}

/** Drain + clear the hits recorded since the last reset. */
export function drainServerAmbientSessionRefusals(): Array<{ via: string; span: unknown; context: unknown }> {
  const out = _hits;
  _hits = [];
  return out;
}

type LineColResolver = (span: { file?: string; start?: number }) => { line: number; col: number } | null;

/**
 * Drain the hits as `E-INTERNAL-SESSION-AMBIENT-SERVER` build errors. Drained at
 * the end of a file's server emission, at the end of each file's codegen
 * iteration, and once more when codegen returns (later emission — page shells,
 * the route splitter — re-enters expression lowering). `filePath` null = the
 * file is not known at that drain point (the span's own `file`, if any, stands).
 * `resolve` turns a byte offset into line/col (the §20.6 source registry); when
 * no position can be resolved the diagnostic carries none — never a made-up 1:1.
 */
export function drainServerAmbientSessionRefusalErrors(filePath: string | null, resolve?: LineColResolver): CGError[] {
  return drainServerAmbientSessionRefusals().map((hit) => {
    // Expression spans carry a placeholder 1:1 and, when re-parsed from a
    // substring, offsets relative to it. Use the node's offset only when it falls
    // inside the server function being emitted; otherwise point at that function.
    const ctx = (hit.context && typeof hit.context === "object") ? hit.context as Record<string, unknown> : null;
    const own = (hit.span && typeof hit.span === "object") ? hit.span as Record<string, unknown> : null;
    const realLine = (x: Record<string, unknown> | null): boolean =>
      !!x && typeof x.line === "number" && x.line > 0 && !(x.line === 1 && x.col === 1);
    const insideCtx = !!own && typeof own.start === "number" && !!ctx && typeof ctx.start === "number"
      && typeof ctx.end === "number" && (own.start as number) >= (ctx.start as number) && (own.start as number) <= (ctx.end as number);
    const sp: Record<string, unknown> = (own && (realLine(own) || insideCtx || !ctx)) ? own : (ctx ?? {});
    const file = filePath ?? (typeof sp.file === "string" ? sp.file : undefined);
    const start = typeof sp.start === "number" ? sp.start : undefined;
    let line = realLine(sp) ? sp.line as number : undefined;
    let col = realLine(sp) && typeof sp.col === "number" ? sp.col as number : undefined;
    if ((line === undefined || col === undefined) && resolve && file !== undefined && start !== undefined
        && (sp === ctx || insideCtx)) {
      const lc = resolve({ file, start });
      if (lc) { line = lc.line; col = lc.col; }
    }
    return new CGError(
      "E-INTERNAL-SESSION-AMBIENT-SERVER",
      "E-INTERNAL-SESSION-AMBIENT-SERVER: internal compiler error — a server-side `@session` read " +
      `reached code generation (${hit.via}) without E-SESSION-AMBIENT-SERVER being reported. It was ` +
      "NOT lowered to the client request body; the build is refused instead. `@session` is not read " +
      "on the server — use `session.<field>` (§20.5, §6.6.9). This is a compiler bug; please report it.",
      {
        ...(file !== undefined ? { file } : {}),
        start: start ?? 0,
        end: typeof sp.end === "number" ? sp.end : (start ?? 0),
        ...(line !== undefined ? { line } : {}),
        ...(col !== undefined ? { col } : {}),
      },
      "error",
    );
  });
}
