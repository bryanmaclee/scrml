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
 * Wrap an emitted query expression (which already carries its own `await`) so a
 * failure becomes a `SqlError` envelope instead of a throw. The result is an
 * expression; it needs an async context, which every server function body is.
 */
export function wrapSqlAttempt(queryExpr: string): string {
  return `await ${SQL_ATTEMPT_FN}(async () => ${queryExpr})`;
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
 * The server-bundle runtime helper. Injected into a server module IFF the module
 * references `_scrml_sql_attempt(`. Readable on purpose: an adopter debugging a
 * handled query lands here.
 */
export const SERVER_SQL_ATTEMPT_HELPER: string = [
  "",
  "// --- §19.8.3 (S451 R11): a ?{} query handled by !{} or match (compiler-generated) ---",
  "// A query that FAILS TO RUN becomes a SqlError value that the handler's arms match on,",
  "// instead of a throw. A query that runs and matches no row is not a failure: its value",
  "// (not / []) passes through unchanged.",
  "async function _scrml_sql_attempt(run) {",
  "  try {",
  "    return await run();",
  "  } catch (err) {",
  "    return _scrml_sql_error(err);",
  "  }",
  "}",
  "// Map a driver error to a SqlError variant (§19.8.1): QueryFailed(message),",
  "// ConstraintViolation(field), ConnectionLost.",
  "function _scrml_sql_error(err) {",
  "  const message = String((err && err.message) || err);",
  "  const code = String((err && (err.code ?? err.errno)) ?? \"\");",
  "  if (/CONSTRAINT/i.test(code) || /^23\\d{3}$/.test(code) || /constraint failed/i.test(message)) {",
  "    const m = /constraint failed: ([\\w.]+)/i.exec(message);",
  "    const field = m ? m[1].split(\".\").pop() : String((err && (err.column ?? err.constraint)) ?? \"\");",
  "    return { __scrml_error: true, type: \"SqlError\", variant: \"ConstraintViolation\", data: { field } };",
  "  }",
  "  if (/ECONNREFUSED|ECONNRESET|EPIPE|ETIMEDOUT|CONNECTION_CLOSED/i.test(code) || /^08\\d{3}$/.test(code) ||",
  "      /connection (?:closed|lost|refused|terminated)/i.test(message)) {",
  "    return { __scrml_error: true, type: \"SqlError\", variant: \"ConnectionLost\", data: null };",
  "  }",
  "  return { __scrml_error: true, type: \"SqlError\", variant: \"QueryFailed\", data: { message } };",
  "}",
].join("\n");
