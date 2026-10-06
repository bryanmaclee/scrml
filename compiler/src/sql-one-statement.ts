/**
 * §8.1.2 (S456) — `E-SQL-MULTIPLE-STATEMENTS`: a program-body `?{}` holds exactly ONE SQL
 * statement, in any compilation with a database.
 *
 * Ruling (user-voice-scrml.md S456, "one statement per seams reasonable. push"): *"(a) — in any
 * compilation with a database, a program-body `?{}` holds exactly ONE SQL statement (a
 * `;`-chained body is refused). NOT (b) a deny-list of `set_config` / role-setting functions."*
 *
 * WHY (gap g-tenant-set-config-in-program-body-s456, CONFIRMED on PG16 by the S239 r5 review):
 * `?{ SELECT set_config('scrml.tenant','B',true); select … from invoices }.acrossTenants()` was
 * admitted statement by statement (two `SELECT`s), sent as ONE parameterless string through
 * `tx.unsafe` (Postgres' simple-query protocol runs every statement), re-pinned the tenant inside
 * the §14.8.11 tier's per-`?{}` transaction and returned tenant B's rows to a tenant-A request;
 * `set_config('role','none',true)` returned every tenant under a BYPASSRLS / superuser login.
 * A per-function deny-list would be a classifier again; one statement per `?{}` closes the class.
 *
 * The body is read by `schema-differ.js` `programStatementCount` — the same closed-lexical-subset
 * token walk the §14.8.10 program-body allow-list uses, so the two rules agree on where every
 * literal, comment and `${…}` slot ends. A `<schema>` body is the declaration itself, not a
 * program body: it holds many statements and is not read here.
 *
 * The codegen half (defence in depth) is `codegen/sql-one-statement-guard.ts`: an emitted query
 * site never carries a multi-statement string to the driver.
 */

import { programStatementCount } from "./schema-differ.js";
import { scanExpressionTextForSql } from "./sql-in-expression-text.ts";

/** One `E-SQL-MULTIPLE-STATEMENTS` diagnostic (the TENANT-SCHEMA stage's shape). */
export interface MultipleStatementsDiagnostic {
  code: "E-SQL-MULTIPLE-STATEMENTS" | "E-SQL-QUERY-NOT-READABLE";
  message: string;
  span: unknown;
  severity: "error";
}

/** The SQL text inside an expression-position `?{ … }` (`sql-ref` `raw`), template backticks removed. */
export function sqlRefBody(raw: string): string {
  let s = raw.trim();
  if (s.startsWith("?{") && s.endsWith("}")) s = s.slice(2, -1).trim();
  if (s.startsWith("`") && s.endsWith("`") && s.length >= 2) s = s.slice(1, -1);
  return s;
}

/**
 * Call `read(sql, span)` for every program-body `?{}` of a file: a `sql` node's `query` and an
 * expression-position `sql-ref`'s `raw`, OUTSIDE every `<schema>` (a `<schema>` body is the
 * declaration itself — never a program-body statement).
 */
export function forEachProgramBodySql(
  fileAST: unknown,
  read: (sql: string, span: unknown) => void,
  unreadable?: (why: string, span: unknown) => void,
): void {
  const seen = new WeakSet<object>();
  // S456 fix round F2 — a `?{}` inside expression text the parser held unparsed (an
  // `escape-hatch` condition, a template literal, a raw `match` arm) is lowered by codegen's
  // TEXT path; read exactly the body that path sends (sql-in-expression-text.ts), and report a
  // `?{` it does not lower so the compile refuses it instead of emitting an unread query.
  const scanText = (text: string, span: unknown): void => {
    scanExpressionTextForSql(text, {
      sql: (body) => read(body, span),
      unreadable: (why) => { if (unreadable) unreadable(why, span); },
    });
  };
  const visit = (v: unknown, depth: number): void => {
    if (v === null || typeof v !== "object" || depth > 200 || seen.has(v as object)) return;
    seen.add(v as object);
    if (Array.isArray(v)) { for (const x of v) visit(x, depth + 1); return; }
    const n = v as Record<string, unknown>;
    if (n.kind === "state" && n.stateType === "schema") return;
    if (n.kind === "sql" && typeof n.query === "string") read(n.query, n.span);
    else if (n.kind === "sql-ref" && typeof n.raw === "string") read(sqlRefBody(n.raw), n.span);
    else if (n.kind === "escape-hatch" && typeof n.raw === "string") scanText(n.raw, n.span);
    else if (n.kind === "lit" && n.litType === "template" && typeof n.raw === "string") scanText(n.raw, n.span);
    else if (n.kind === "match-expr" && Array.isArray(n.rawArms)) {
      for (const arm of n.rawArms) if (typeof arm === "string") scanText(arm, n.span);
    } else if (n.kind === "expr" && typeof n.raw === "string" && n.exprNode === undefined) scanText(n.raw, n.span);
    for (const key of Object.keys(n)) {
      if (key === "span" || key.startsWith("_")) continue;
      visit(n[key], depth + 1);
    }
  };
  const root = (fileAST as any)?.ast?.nodes ?? (fileAST as any)?.nodes ?? fileAST;
  visit(root, 0);
}

/**
 * Every program-body `?{}` of the file holding more than one SQL statement. A body outside the
 * closed lexical subset is not counted here — §14.8.10 item (1) already refuses it
 * (`E-SQL-PROGRAM-STATEMENT-NOT-ADMITTED`).
 */
export function programBodyMultipleStatements(fileAST: unknown): MultipleStatementsDiagnostic[] {
  const out: MultipleStatementsDiagnostic[] = [];
  const filePath = (fileAST as any)?.filePath ?? (fileAST as any)?.ast?.filePath ?? "";
  const reported = new Set<string>();
  const unreadable = (why: string, span: unknown): void => {
    const key = `${String((span as any)?.start ?? "")}\0unread\0${why}`;
    if (reported.has(key)) return;
    reported.add(key);
    out.push({
      code: "E-SQL-QUERY-NOT-READABLE",
      message:
        `E-SQL-QUERY-NOT-READABLE: this \`?{}\` sits in expression text the compiler holds unparsed, and it is ${why}. ` +
        `No check (one statement per \`?{}\` — §8.1.2; the program-body allow-list — §14.8.10) can read it, so it ` +
        "is refused rather than emitted. Write it as `?{`…`}` (the backtick template), or bind it to a local first: " +
        "`const row = ?{`…`}.get()`, then use `row` in the condition.",
      span: span ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 },
      severity: "error",
    });
  };
  forEachProgramBodySql(fileAST, (sql, span) => {
    const { statements } = programStatementCount(sql);
    if (statements <= 1) return;
    const key = `${String((span as any)?.start ?? "")}\0${sql}`;
    if (reported.has(key)) return;
    reported.add(key);
    out.push({
      code: "E-SQL-MULTIPLE-STATEMENTS",
      message:
        `E-SQL-MULTIPLE-STATEMENTS: this \`?{}\` holds ${statements} SQL statements — a \`?{}\` holds exactly one ` +
        `(§8.1.2). A \`;\` may only end the statement; nothing may follow it. Split it into one \`?{}\` per ` +
        `statement; when they must succeed or fail together, put those \`?{}\`s in a \`transaction { }\` block ` +
        `(§8.5.3, §19.10). (Every statement of one string runs on the database, so a chained statement could ` +
        `change the connection's tenant or role — §14.8.11 — for the statements after it.)`,
      span: span ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 },
      severity: "error",
    });
  }, unreadable);
  return out;
}
