/**
 * arm-structure.ts — S465: SERVER arm bodies are emitted from the parsed tree,
 * never re-lowered from their token text.
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
 * with the compiler's own statement / expression parsers (the statement one IS
 * the function-top-level parser: `parseStatementTextDetailed`) — and the
 * resulting nodes go through the normal statement / expression emitters, so the
 * classifier, the injector and the Promise trap see these calls exactly as they
 * see any other.
 *
 * FAIL CLOSED BY CONSTRUCTION (S465 r2). On the server both readers below return
 * a tree for every non-empty body — never null — so no caller can fall back to
 * its text lowering. A body the parser refuses is a COMPILE ERROR, recorded in
 * the run-wide refused-lowering sink (`recordRefusedLowering`, drained by
 * `runCG`): the code is the one the same statement gets at function top level
 * when the front-end raised one (`switch` → E-SWITCH-FORBIDDEN, `try` →
 * E-TRY-NOT-IN-SCRML, `throw` → E-THROW-NOT-IN-SCRML, `for … in` → E-CTRL-011,
 * `let a = 1, b = 2` → E-STMT-MISSING-SEMICOLON), else E-STMT-UNEXPECTED-TOKEN
 * (§4: "no statement begins here" — content the statement grammar could read
 * only by dropping it, e.g. a label on a non-loop block `blk: { … }`). The
 * returned tree is then an inert `null` placeholder: the compile fails, so the
 * artifact never runs (§2.2.1, S451).
 *
 *   serverArmBlockStatements(text, mode, anchor?) → statement nodes for a
 *     `{ … }` BLOCK arm body on the server; null only in client mode, for a text
 *     that is not a statement block (an object literal / a value), or for an
 *     empty block (`{}` — nothing to lower).
 *   serverArmExprNode(text, mode, node?) → the ExprNode for an arm VALUE on the
 *     server (the node the parser already built when there is one); null only
 *     in client mode or for empty text.
 *
 * Client mode returns null from both: client arm emission is unchanged here
 * (its own async colouring / `_awaitMatchArmServerCalls` path).
 */

import { parseExprToNode, hasLostTrailingContent, captureTrailingContentWarnings } from "../expression-parser.ts";
import { armBlockStatementsDetailed } from "../arm-body-statements.ts";
import { CGError } from "./errors.ts";
import { recordRefusedLowering } from "./refused-lowering-errors.ts";
import { currentLoweringSpan } from "./sql-one-statement-guard.ts";

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
 * Did the expression parser READ this node? Not when it is (or holds) a
 * parse-error escape hatch, or was read only by dropping trailing content. The
 * other escape-hatch kinds (an arrow / function value, a sequence) are JS forms
 * the expression emitter lowers the same way at every position — top level too.
 */
function readableExpr(node: any): boolean {
  if (!node || typeof node !== "object") return false;
  let ok = true;
  const seen = new WeakSet<object>();
  const walk = (n: any): void => {
    if (!ok || !n || typeof n !== "object" || seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) { for (const c of n) walk(c); return; }
    if ((n.kind === "escape-hatch" && n.nativeKind === "ParseError") || hasLostTrailingContent(n)) { ok = false; return; }
    for (const k of Object.keys(n)) if (k !== "span") walk(n[k]);
  };
  walk(node);
  return ok;
}

const NULL_LIT = (): any => ({ kind: "lit", raw: "null", value: null, litType: "null" });

/** Shorten `t` for a diagnostic. */
function excerpt(t: string): string {
  const one = t.replace(/\s+/g, " ").trim();
  return one.length > 80 ? one.slice(0, 77) + "..." : one;
}

/**
 * Record the refusal of a server arm body (see the file header) and return
 * nothing: the caller emits the inert placeholder.
 */
function refuseServerArm(body: string, refusal: { code: string | null; message: string; text: string }, anchor?: object | null, whereText?: string): void {
  const where = whereText ?? "in a server `match` / `!{}` arm body";
  let err: CGError;
  if (refusal.code) {
    // The front-end's own diagnostic for the statement, verbatim — the same text
    // the statement gets at function top level — plus where it was found.
    const msg = refusal.message.startsWith(refusal.code) ? refusal.message : `${refusal.code}: ${refusal.message}`;
    err = new CGError(refusal.code, `${msg} (${where}: \`${excerpt(body)}\`)`, currentLoweringSpan() as any);
  } else {
    err = new CGError(
      "E-STMT-UNEXPECTED-TOKEN",
      `E-STMT-UNEXPECTED-TOKEN: unexpected token — no statement begins at \`${excerpt(refusal.text || body)}\` ` +
        `${where} (\`${excerpt(body)}\`). The statement grammar cannot read it (a label is written only on a ` +
        `\`while\` / \`do\` / \`for\` loop, §49.2.2). Rewrite the statement, or move it into a function and call that.`,
      currentLoweringSpan() as any,
    );
  }
  recordRefusedLowering(err, anchor ?? null);
}

/**
 * The statements of a server `{ … }` arm body, parsed (see file header). Returns
 * null when there is nothing to structure: not server mode, not a statement
 * block, or an empty block. A body the parser refuses is a compile error and
 * reads as an inert placeholder — never null.
 */
export function serverArmBlockStatements(
  text: string,
  mode: Mode,
  anchor?: object | null,
  opts?: { alwaysBlock?: boolean; where?: string },
): any[] | null {
  if (mode !== "server") return null;
  const t = (text ?? "").trim();
  // `alwaysBlock`: a braced `!{}` handler body is a statement block even when its
  // text would also read as an object literal (emitArmBody's rule).
  if (opts?.alwaysBlock ? !(t.startsWith("{") && t.endsWith("}")) : !isStatementBlockText(t)) return null;
  if (!t.slice(1, -1).trim()) return null;
  const r = armBlockStatementsDetailed(t);
  if (r && r.ok && Array.isArray(r.stmts) && r.stmts.length > 0) return r.stmts;
  refuseServerArm(t, r && !r.ok ? r.refusal : { code: null, message: "", text: t }, anchor, opts?.where);
  return [{ kind: "bare-expr", expr: "null", exprNode: NULL_LIT(), _armRefusedPlaceholder: true }];
}

/**
 * The parsed ExprNode of a server arm VALUE. `node` (the builder's own parse,
 * when the arm carries one) wins; otherwise the text is parsed. A parse that
 * fails, falls back to an escape hatch, or would drop trailing content is a
 * compile error (see file header) and reads as an inert `null` — never null.
 */
export function serverArmExprNode(text: string, mode: Mode, node?: any, anchor?: object | null): any | null {
  if (mode !== "server") return null;
  if (readableExpr(node)) return node;
  const t = (text ?? "").trim();
  if (!t) return null;
  const { result } = captureTrailingContentWarnings(() => {
    try { return parseExprToNode(t, "<match-arm>", 0); } catch { return null; }
  });
  const parsed: any = result;
  if (readableExpr(parsed)) return parsed;
  // A `{ … }` value that is a statement block is the block route's to read: its
  // refusal reason (the front-end's own code) is the useful one.
  const asBlock = isStatementBlockText(t) ? armBlockStatementsDetailed(t) : null;
  refuseServerArm(t, asBlock && !asBlock.ok ? asBlock.refusal : { code: null, message: "", text: t }, anchor);
  return NULL_LIT();
}
