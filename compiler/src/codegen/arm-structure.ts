/**
 * arm-structure.ts — S465 (fix round 1): SERVER arm bodies are emitted from the
 * parsed tree, never re-lowered from their token text.
 *
 * SPEC §13.2: a server function "MAY be called directly (the compiler awaits the
 * call)". The await is decided by the structured expression emitter
 * (`emitExpr`'s call site asks the import classifier, `isStdlibAsyncCallee`).
 * Several arm forms reach codegen with their body carried as TEXT — a literal /
 * alternation / product `match` arm (`"a" :> { … }`, `1 :> expr`), an inline arm's
 * result string, a `!{}` handler arm — and the emitters re-lowered that text
 * through the token rewriters (`rewriteBlockBody`, `rewriteServerExpr`), which
 * never consult the classifier. A call to a Promise-returning import in such a
 * body shipped as a bare Promise: every Promise is truthy, so
 * `"a" :> { if (check(pass, row.pw)) { r = "WELCOME" } }` accepted every password.
 *
 * The fix is not an await patch on the text. On the server the text is PARSED —
 * with the compiler's own statement / expression parsers, the same ones that
 * build every other body — and the resulting nodes go through the normal
 * statement / expression emitters, so the classifier, the injector and the
 * Promise trap see these calls exactly as they see any other.
 *
 *   serverArmBlockStatements(text, mode) → statement nodes for a `{ … }` BLOCK arm
 *     body on the server, else null (client mode, not a block, an object
 *     literal, or the text does not parse — the caller keeps its text path).
 *   serverArmExprNode(text, mode, node?) → the ExprNode for an arm VALUE on the
 *     server (the node the parser already built when there is one), else null.
 *
 * Client mode returns null from both: client arm emission is unchanged here
 * (its own async colouring / `_awaitMatchArmServerCalls` path), so this change
 * moves no client byte.
 */

import { parseExprToNode, hasLostTrailingContent, captureTrailingContentWarnings } from "../expression-parser.ts";
import { armBodyStatementsFromText } from "../arm-body-statements.ts";

type Mode = "client" | "server" | string | undefined | null;

/** Is `text` a `{ … }` statement block (not an object literal)? */
function isStatementBlockText(t: string): boolean {
  if (!(t.startsWith("{") && t.endsWith("}"))) return false;
  let node: any = null;
  const { result } = captureTrailingContentWarnings(() => {
    try { return parseExprToNode(t, "<match-arm-block>", 0); } catch { return null; }
  });
  node = result;
  return !(node && node.kind === "object");
}

/**
 * The statements of a server `{ … }` arm body, parsed (see file header). Returns
 * null when the caller must keep its existing path: not server mode, not a
 * statement block, an empty block, or a body the statement parser rejects.
 */
export function serverArmBlockStatements(text: string, mode: Mode): any[] | null {
  if (mode !== "server") return null;
  const t = (text ?? "").trim();
  if (!isStatementBlockText(t)) return null;
  if (!t.slice(1, -1).trim()) return null;
  const stmts = armBodyStatementsFromText(t);
  return Array.isArray(stmts) && stmts.length > 0 ? stmts : null;
}

/**
 * The parsed ExprNode of a server arm VALUE. `node` (the builder's own parse,
 * when the arm carries one) wins; otherwise the text is parsed. A parse that
 * fails, falls back to an escape hatch, or would drop trailing content returns
 * null — the caller then keeps its text path (never a partial tree).
 */
export function serverArmExprNode(text: string, mode: Mode, node?: any): any | null {
  if (mode !== "server") return null;
  if (node && node.kind !== "escape-hatch" && !hasLostTrailingContent(node)) return node;
  const t = (text ?? "").trim();
  if (!t) return null;
  const { result } = captureTrailingContentWarnings(() => {
    try { return parseExprToNode(t, "<match-arm>", 0); } catch { return null; }
  });
  const parsed: any = result;
  if (!parsed || parsed.kind === "escape-hatch" || hasLostTrailingContent(parsed)) return null;
  return parsed;
}
