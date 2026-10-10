/**
 * escape-hatch-body.ts — the ONE check-time reading of a block-bodied arrow / function
 * expression the expression parser kept as an escape hatch (S462 rounds 5–6).
 *
 * The parser records what it already parsed on the node (types/ast.ts `EscapeHatchExpr`):
 * the STRUCTURED parameters (`params`) and the body text it delimited (`bodyRaw`, a
 * substring of the `raw` codegen emits). A check reads those — never a re-scan of `raw`.
 * The body is parsed by the one handler statement parser as a zero-parameter arrow
 * (parameters are not statements; a consumer that resolves names declares `params`).
 * Shared by the §42.3.5 E-TYPE-046 walk (type-system.ts `checkOptionalMemberAccess`) and
 * the component E-TYPE-031 optional-fn-prop check (component-expander.ts), so both judge
 * the same statements. Returns null when the node is not such a function or the parser
 * could not delimit it (the caller fails closed).
 */
import { parseHandlerStatementsForCheck } from "./ast-builder.js";

export function escapeHatchBodyStatements(n: Record<string, unknown>, filePath: string): unknown[] | null {
  const kind = n.nativeKind;
  if (kind !== "ArrowFunctionExpression" && kind !== "FunctionExpression") return null;
  if (typeof n.bodyRaw !== "string" || !Array.isArray(n.params)) return null;
  try {
    const stmts = parseHandlerStatementsForCheck({ kind: "expr", raw: `() => ${n.bodyRaw}` }, filePath);
    return Array.isArray(stmts) ? (stmts as unknown[]) : null;
  } catch {
    return null;
  }
}
