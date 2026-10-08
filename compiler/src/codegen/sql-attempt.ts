/**
 * §19.8.3 / §19.8.4 (S451 R11) — a HANDLED `?{}` query.
 *
 * A `?{}` query is a failable expression everywhere. When it is handled at the
 * site — by a `!{}` handler written after its terminator, or by a `match` on its
 * result — a query that FAILS TO RUN must reach the handler as a `SqlError`
 * variant, and the arm's value replaces the query's result. The driver reports
 * such a failure by throwing; this module turns that throw into the canonical
 * error envelope (`{ __scrml_error, type, variant, data }`, §19.9.1) that the
 * `!{}` / `match` lowering already discriminates on.
 *
 * "No row" is NOT a failure (§19.8.3, §19.8.4): a query that runs and matches
 * nothing returns its ordinary value (`.get()` → `not`, `.all()` → `[]`), which
 * the attempt passes through untouched.
 *
 * Only a HANDLED query is wrapped. An unhandled query is emitted exactly as
 * before (a failure throws into the route's error path — the impl#1 divergence
 * `g-impl1-sql-unhandled-outside-failable-s451`), so no other shape changes.
 *
 * Server-only. The wrapper is emitted only around a query, and a query is only
 * ever emitted into a server bundle; the helper is injected into the server
 * module on use (the same inline-on-use precedent as the protect / bool-coerce
 * helpers).
 */

import type { ExprNode } from "../types/ast.ts";

/** The runtime helper's name. Its presence in an emitted module triggers injection. */
export const SQL_ATTEMPT_FN = "_scrml_sql_attempt";

/**
 * The `SqlError` payload schema (§19.8.1): `QueryFailed(message: string)`,
 * `ConstraintViolation(field: string)`, `ConnectionLost`. Seeded into the
 * codegen variant registries (emit-control-flow.ts) so an arm `.QueryFailed(m)`
 * binds the `message` field, exactly as a file-local enum's arm would.
 */
export const SQL_ERROR_VARIANT_FIELDS: ReadonlyArray<readonly [string, string[]]> = [
  ["QueryFailed", ["message"]],
  ["ConstraintViolation", ["field"]],
  ["ConnectionLost", []],
];

/**
 * The `SqlError` variants a handler on a `?{}` must cover to be exhaustive
 * (E-TYPE-080 / E-TYPE-020, §19.7): §19.8.1's three, plus the variant the SPEC
 * itself adds — §8.9.4's `BatchPrepareFailed` ("surface as a single variant
 * `SqlError::BatchPrepareFailed`"). §19.8.3: "The handler is checked for
 * exhaustiveness against `SqlError` like any other `!{}` handler. Because the
 * compiler MAY add `SqlError` variants (§19.8.4) — §8.9.4's `BatchPrepareFailed`
 * is one — a `_ :>` arm keeps a handler total as the enum grows."
 */
export const SQL_ERROR_EXHAUSTIVE_VARIANTS: readonly string[] = [
  "QueryFailed", "ConstraintViolation", "ConnectionLost", "BatchPrepareFailed",
];

/**
 * The statement emitted on the branch where a handler on a failable result
 * matched NO arm (S454 fix round, F1 — FAIL CLOSED). A handler the type checker
 * accepted is exhaustive, so this branch is unreachable for every variant the
 * checker knows; if a failure the checker did not know still arrives, the error
 * is re-raised as a host error (the route's error path / the §19.6.8 backstop),
 * never yielded as the expression's value — an error envelope is a truthy
 * object, so letting it through as a value fails OPEN (`if (q() !{ … })`).
 * `resultVar` names the envelope.
 */
export function unhandledFailureThrow(resultVar: string): string {
  return `throw new _scrml_g.Error("scrml: no handler arm matched the failure " + ${resultVar}.type + "." + ${resultVar}.variant + " (§19.4.3)");`;
}

/** The SQL chain methods that can follow a `?{}` in an expression (§44.3, §8.9.5, §14.8.10). */
const SQL_CHAIN_METHODS = new Set(["all", "get", "first", "run", "prepare", "nobatch", "acrossTenants"]);

export interface SqlQueryExprShape {
  /** The query's source text, `?{`…`}`. */
  raw: string;
  /** The chain in source order — `?{…}.nobatch().get()` → [nobatch, get]. */
  chain: Array<{ method: string; args: ExprNode[] }>;
}

/**
 * Is `node` exactly an expression-position `?{}` query — a `sql-ref` carrying
 * its source (`raw`), optionally followed by a chain of SQL methods
 * (`.all()` / `.get()` / `.run()` / `.nobatch()` / `.acrossTenants()`)? Returns
 * the query's raw text and chain, or null for anything else (including a query
 * that is only PART of a larger expression, e.g. `?{…}.get().name`).
 */
export function sqlQueryExprShape(node: ExprNode | null | undefined): SqlQueryExprShape | null {
  if (!node) return null;
  const chain: Array<{ method: string; args: ExprNode[] }> = [];
  let cur: ExprNode = node;
  while (cur.kind === "call") {
    const callee = cur.callee;
    if (!callee || callee.kind !== "member" || callee.optional || cur.optional) return null;
    if (!SQL_CHAIN_METHODS.has(callee.property)) return null;
    chain.unshift({ method: callee.property, args: cur.args as ExprNode[] });
    cur = callee.object;
  }
  if (cur.kind !== "sql-ref" || typeof cur.raw !== "string" || !cur.raw.startsWith("?{")) return null;
  return { raw: cur.raw, chain };
}

/**
 * §19.8.3 (S455) — the `?{}` query that a STATEMENT-level `!{}` handler guards.
 *
 * A `!{}` written after a statement is parsed as
 * `guarded-expr { guardedNode: <the statement>, arms }`: the WHOLE statement is
 * wrapped, not the query. So a handled query is the same statement an unhandled
 * one is (`@c = ?{…}.get()` is a `state-decl` carrying `sqlNode`, `lift ?{…}` is
 * a `lift-expr` over `{ kind: "sql", node }`, `?{…}.run()` is a bare `sql`
 * statement), one level down. Every analysis that classifies statements by kind
 * must see that inner statement exactly as it sees the unhandled one — the
 * handler adds a failure path and changes nothing else (placement, purity, the
 * client/server split, protect, batching).
 *
 * Returns the guarded statement's query node (a structured `sql` node) — or
 * `"expr"` for an expression-position query that is the WHOLE operand
 * (`const r = (?{…}.get()) !{…}`) — or null when the guard does not handle a
 * `?{}` (a guarded CALL, which keeps its own semantics).
 */
export function handledSqlOfGuardedNode(guardedNode: unknown): Record<string, unknown> | "expr" | null {
  if (!guardedNode || typeof guardedNode !== "object") return null;
  const g = guardedNode as Record<string, any>;
  if (g.kind === "sql") return g;
  if (g.sqlNode && typeof g.sqlNode === "object" && g.sqlNode.kind === "sql") return g.sqlNode;
  if (g.kind === "lift-expr" && g.expr && g.expr.kind === "sql" && g.expr.node && g.expr.node.kind === "sql") return g.expr.node;
  if (sqlQueryExprShape((g.initExpr ?? g.exprNode) as ExprNode | undefined) !== null) return "expr";
  return null;
}

/**
 * The statement a `!{}` on a `?{}` guards, when `node` is such a guard
 * (`guarded-expr` whose guarded statement holds the handled query); else null.
 * The one normalization the statement-classifying consumers share (S455).
 */
export function handledSqlGuardInner(node: unknown): Record<string, any> | null {
  if (!node || typeof node !== "object") return null;
  const n = node as Record<string, any>;
  if (n.kind !== "guarded-expr" || !n.guardedNode || typeof n.guardedNode !== "object") return null;
  return handledSqlOfGuardedNode(n.guardedNode) !== null ? n.guardedNode : null;
}

/**
 * The server-bundle runtime helper. Injected into a server module IFF the module
 * references `_scrml_sql_attempt(`. Readable on purpose: an adopter debugging a
 * handled query lands here.
 */
export const SERVER_SQL_ATTEMPT_HELPER: string = [
  "",
  "// --- §19.8.3 (S451 R11): a ?{} query handled by !{} or match (compiler-generated) ---",
  "// A query that FAILS TO RUN becomes a SqlError value that the handler's arms match on,",
  "// instead of a throw. A query that runs and matches no row is not a failure: its value",
  "// (not / []) passes through unchanged. `args` (the query's parameters) were evaluated",
  "// by the caller and `then` (row shaping, tenant / protect wrappers) runs after the",
  "// try, so ONLY the driver call is attempted: a host error in a parameter, or a floor",
  "// refusal, keeps its own identity instead of becoming QueryFailed.",
  "async function _scrml_sql_attempt(run, args, then) {",
  "  let rows;",
  "  try {",
  "    rows = await run(args);",
  "  } catch (err) {",
  "    return _scrml_sql_error(err);",
  "  }",
  "  return then(rows);",
  "}",
  "// Map a driver error to a SqlError variant (§19.8.1): QueryFailed(message),",
  "// ConstraintViolation(field), ConnectionLost.",
  "function _scrml_sql_error(err) {",
  "  const message = _scrml_g.String((err && err.message) || err);",
  "  const code = _scrml_g.String((err && (err.code ?? err.errno)) ?? \"\");",
  "  if (/CONSTRAINT/i.test(code) || /^23\\d{3}$/.test(code) || /constraint failed/i.test(message)) {",
  "    const m = /constraint failed: ([\\w.]+)/i.exec(message);",
  "    const field = m ? m[1].split(\".\").pop() : _scrml_g.String((err && (err.column ?? err.constraint)) ?? \"\");",
  "    return { __scrml_error: true, type: \"SqlError\", variant: \"ConstraintViolation\", data: { field } };",
  "  }",
  "  if (/ECONNREFUSED|ECONNRESET|EPIPE|ETIMEDOUT|CONNECTION_CLOSED/i.test(code) || /^08\\d{3}$/.test(code) ||",
  "      /connection (?:closed|lost|refused|terminated)/i.test(message)) {",
  "    return { __scrml_error: true, type: \"SqlError\", variant: \"ConnectionLost\", data: null };",
  "  }",
  "  return { __scrml_error: true, type: \"SqlError\", variant: \"QueryFailed\", data: { message } };",
  "}",
].join("\n");
