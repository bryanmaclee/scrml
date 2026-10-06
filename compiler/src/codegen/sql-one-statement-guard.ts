/**
 * §8.1.2 (S456) — defence in depth for "one SQL statement per `?{}`": an emitted query site
 * NEVER hands the driver a string holding more than one statement.
 *
 * The compile check (`sql-one-statement.ts`, `E-SQL-MULTIPLE-STATEMENTS`) refuses such a body in
 * every compilation with a database. This guard is the invariant at the driver boundary, for any
 * `?{}` that reaches codegen without passing that check. Each driver path, executed on Bun 1.4.2
 * (PG16 + Bun.SQL sqlite, docs/changes/s456-one-statement-per-sql-block/progress.md):
 *   - `db.unsafe("…")` with no parameters — Postgres' simple-query protocol: EVERY statement runs
 *     (`[[{a:1}],[{b:2}]]`); with `[]` too. SQLite: the statements after the first run when the
 *     first returns no rows (`INSERT …; INSERT …` inserted both).
 *   - `db\`…\`` tagged template, and `db.unsafe("…", [params])` — Postgres' extended protocol:
 *     refused by the database ("cannot insert multiple commands into a prepared statement").
 *     SQLite: only the first statement's rows are returned.
 * A `?{}` body is a compile-time literal (E-SQL-003 refuses a runtime-assembled one), so the
 * guard decides at emit time: a multi-statement body is emitted as a throwing expression — the
 * query is never sent, whatever the driver or the §14.8.11 tier wrapper would have done with it.
 */

import { programStatementCount } from "../schema-differ.js";

/**
 * Whether `sql` (the SQL text of one `?{}`, `${…}` slots in place) holds at most one statement.
 * Read with the §14.8.10 / §8.1.2 token walk. A body outside its closed lexical subset (refused at
 * compile in a database compilation) is judged conservatively: any `;` followed by anything but
 * whitespace counts as a second statement.
 */
export function sqlHoldsOneStatement(sql: string): boolean {
  if (typeof sql !== "string") return true;
  const { statements, unreadable } = programStatementCount(sql);
  if (unreadable === null) return statements <= 1;
  const semi = sql.indexOf(";");
  return semi === -1 || sql.slice(semi + 1).trim().length === 0;
}

/** The fail-closed expression emitted in place of a multi-statement driver call (no trailing `;`). */
export function multipleStatementsThrowExpr(): string {
  const msg =
    "E-SQL-MULTIPLE-STATEMENTS: a ?{} holds exactly one SQL statement (§8.1.2) — this query holds more " +
    "than one and was not sent to the database. Split it into one ?{} per statement (a transaction { } " +
    "block keeps them atomic).";
  return `(()=>{throw new Error(${JSON.stringify(msg)})})()`;
}
