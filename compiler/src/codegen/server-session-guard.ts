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

/** The identifier emitted in place of a refused server `@session` read. */
export const SERVER_SESSION_REFUSED = "_scrml_server_session_refused";

let _userSessionCell = false;
let _hits: Array<{ via: string; span: unknown }> = [];

/** Per file: does the file declare its own `<session>` reactive cell? */
export function setServerSessionUserCell(on: boolean): void {
  _userSessionCell = !!on;
}

/** True when a server-mode `@session` read is the ambient one (no user cell owns the name). */
export function isServerAmbientSession(bareName: string): boolean {
  return bareName === "session" && !_userSessionCell;
}

/** Record a refused server `@session` lowering and return the replacement text. */
export function refuseServerAmbientSession(via: string, span?: unknown): string {
  _hits.push({ via, span });
  return SERVER_SESSION_REFUSED;
}

/** Reset the hit list (start of a file's server emission). */
export function resetServerAmbientSessionRefusals(): void {
  _hits = [];
}

/** Drain + clear the hits recorded since the last reset. */
export function drainServerAmbientSessionRefusals(): Array<{ via: string; span: unknown }> {
  const out = _hits;
  _hits = [];
  return out;
}

/**
 * Drain the hits as `E-INTERNAL-SESSION-AMBIENT-SERVER` build errors. Drained at
 * the end of a file's server emission, at the end of each file's codegen
 * iteration, and once more when codegen returns (later emission — page shells,
 * the route splitter — re-enters expression lowering). `filePath` null = the
 * file is not known at that drain point (the span's own `file`, if any, stands).
 */
export function drainServerAmbientSessionRefusalErrors(filePath: string | null): CGError[] {
  return drainServerAmbientSessionRefusals().map((hit) => {
    const sp = (hit.span && typeof hit.span === "object") ? hit.span as Record<string, unknown> : {};
    const file = filePath ?? (typeof sp.file === "string" ? sp.file : undefined);
    return new CGError(
      "E-INTERNAL-SESSION-AMBIENT-SERVER",
      "E-INTERNAL-SESSION-AMBIENT-SERVER: internal compiler error — a server-side `@session` read " +
      `reached code generation (${hit.via}) without E-SESSION-AMBIENT-SERVER being reported. It was ` +
      "NOT lowered to the client request body; the build is refused instead. `@session` is not read " +
      "on the server — use `session.<field>` (§20.5, §6.6.9). This is a compiler bug; please report it.",
      {
        ...(file !== undefined ? { file } : {}),
        start: typeof sp.start === "number" ? sp.start : 0,
        end: typeof sp.end === "number" ? sp.end : 0,
        line: typeof sp.line === "number" ? sp.line : 1,
        col: typeof sp.col === "number" ? sp.col : 1,
      },
      "error",
    );
  });
}
