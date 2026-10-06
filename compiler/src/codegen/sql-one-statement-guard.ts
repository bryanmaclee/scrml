/**
 * §8.1.2 (S456) — defence in depth for "one SQL statement per `?{}`": an emitted query site
 * NEVER hands the driver a string holding more than one statement, nor SQL text the compiler
 * did not read.
 *
 * The compile check (`sql-one-statement.ts`, `E-SQL-MULTIPLE-STATEMENTS`) refuses a chained body
 * in every compilation with a database. This guard is the invariant at the driver boundary. It
 * reads the EMITTED driver call with a real JavaScript parser (acorn) — the SQL the driver will
 * actually receive, not a re-reading of the source text:
 *   - a tagged template `db\`…\`` — its cooked quasis are the SQL text, its expressions the bound
 *     parameters; the quasis MUST equal the `segments` the compiler read (`extractSqlParams`).
 *     A difference means the JS engine splits the body somewhere the compiler did not (S456 fix
 *     round F1: a brace-counted `${ x + '{' }` ended at a later `}`, and JS sent the text between
 *     as SQL) → E-SQL-001, and the site throws;
 *   - `db.unsafe("…"[, params])` — its string argument is the SQL text.
 * The SQL text (quasis joined at their parameter positions) must hold at most one statement, read
 * with the same token walk as the compile check; otherwise the site throws
 * `E-SQL-MULTIPLE-STATEMENTS`. A `?{}` body is a compile-time literal (E-SQL-003), so this is
 * decided at emit time and the throwing expression replaces the driver call — nothing is sent.
 *
 * Driver paths, executed on Bun 1.4.2 (docs/changes/s456-one-statement-per-sql-block/progress.md):
 *   - Postgres: `unsafe("…")` with no parameters (or `[]`) runs EVERY statement (the simple-query
 *     protocol); a tagged template or `unsafe(…, [params])` is refused by the database ("cannot
 *     insert multiple commands into a prepared statement").
 *   - SQLite (Bun.SQL adapter): EVERY path — tagged, parameterised, `unsafe` with or without
 *     parameters — runs the statements after the first whenever the first returns no rows
 *     (`INSERT …; INSERT …` inserted both; `INSERT … (${1}); DELETE FROM t` emptied `t`). On
 *     SQLite the token walk is the only protection; the database refuses nothing.
 */

import * as acorn from "acorn";
import { programStatementCount } from "../schema-differ.js";

const PARSE_OPTIONS = { ecmaVersion: "latest" as const, sourceType: "module" as const, allowAwaitOutsideFunction: true };

/**
 * Whether `sql` (SQL text, `${…}` slots in place) holds at most one statement — the §8.1.2 token
 * walk. A body outside its closed lexical subset (refused at compile in a database compilation)
 * is judged conservatively: any `;` followed by anything but whitespace counts as a second
 * statement.
 */
export function sqlHoldsOneStatement(sql: string): boolean {
  if (typeof sql !== "string") return true;
  const { statements, unreadable } = programStatementCount(sql);
  if (unreadable === null) return statements <= 1;
  const semi = sql.indexOf(";");
  return semi === -1 || sql.slice(semi + 1).trim().length === 0;
}

/** The verdict on one emitted driver call. */
export type DriverCallVerdict = "ok" | "multiple-statements" | "text-not-read";

/**
 * Read the emitted driver call `call` (`db\`…\`` or `db.unsafe(…)`) with acorn and judge the SQL
 * text it sends. `segments` is the compiler's own split of the body (`extractSqlParams`); for a
 * tagged template the cooked quasis must equal it.
 */
export function judgeDriverCall(call: string, segments: readonly string[] | null): DriverCallVerdict {
  let expr: any;
  try {
    expr = (acorn.parse(`(${call});`, PARSE_OPTIONS) as any).body[0]?.expression;
  } catch {
    // Not yet JavaScript (a text-path parameter a later pass rewrites, e.g. an `@cell`): judge
    // the compiler's own split — the same reader the compile check uses.
    if (segments === null) return "ok";
    return sqlHoldsOneStatement(segments.join("${_}")) ? "ok" : "multiple-statements";
  }
  if (expr?.type === "TaggedTemplateExpression") {
    const quasis: string[] = expr.quasi.quasis.map((q: any) => q.value.cooked);
    if (quasis.some((q) => typeof q !== "string")) return "text-not-read";
    if (segments !== null && (quasis.length !== segments.length || quasis.some((q, k) => q !== segments[k]))) {
      return "text-not-read";
    }
    return sqlHoldsOneStatement(quasis.join("${_}")) ? "ok" : "multiple-statements";
  }
  if (expr?.type === "CallExpression" && expr.callee?.type === "MemberExpression" &&
      expr.callee.property?.name === "unsafe") {
    const arg = expr.arguments[0];
    if (arg?.type !== "Literal" || typeof arg.value !== "string") return "text-not-read";
    return sqlHoldsOneStatement(arg.value) ? "ok" : "multiple-statements";
  }
  return "text-not-read";
}

/** The fail-closed expression emitted in place of a refused driver call (no trailing `;`). */
export function refusedDriverCallExpr(verdict: Exclude<DriverCallVerdict, "ok">): string {
  const msg = verdict === "multiple-statements"
    ? "E-SQL-MULTIPLE-STATEMENTS: a ?{} holds exactly one SQL statement (§8.1.2) — this query holds more " +
      "than one and was not sent to the database. Split it into one ?{} per statement (a transaction { } " +
      "block keeps them atomic)."
    : "E-SQL-001: the emitted query would send SQL text the compiler did not read (a bound parameter's " +
      "extent differs between the compiler and the JavaScript template) — it was not sent (§8.6).";
  return `(()=>{throw new Error(${JSON.stringify(msg)})})()`;
}

/** Kept for callers that only need the multi-statement throw. */
export function multipleStatementsThrowExpr(): string {
  return refusedDriverCallExpr("multiple-statements");
}

/** The compile diagnostic for a `text-not-read` site (a compiler-defect invariant, E-SQL-001). */
export const SQL_TEXT_NOT_READ_MESSAGE =
  "E-SQL-001: the emitted query would send SQL text the compiler did not read — the extent of a `${…}` " +
  "bound parameter differs between the compiler's reading and the JavaScript template it is written into, " +
  "so the text between could reach the database unchecked. The query is not sent (the site throws). " +
  "Simplify the parameter expression (bind it to a local first) and report this as a compiler defect (§8.6).";
