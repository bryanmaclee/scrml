/**
 * §14.8.10 (S456) — `E-TENANT-UNDECLARED`: a table carrying a `tenant_id` column that
 * the compilation does not declare tenant-scoped is REFUSED where the compiler can see it.
 *
 * Ruling (user-voice-scrml.md S456, "b, startup check lands with it"): *"a table carrying
 * `tenant_id` that is not declared in `<schema>` / `<db tables=>` is REFUSED where the
 * compiler can see it and checked at startup where it cannot: (1) a program-body
 * `?{CREATE [TEMP] TABLE … tenant_id …}` → compile error naming the fix (declare it in
 * `<schema>`); (2) a SQLite file the compiler already opens → scan `sqlite_master`,
 * refuse any undeclared `tenant_id` table; (3) Postgres / anything unreadable at compile
 * time → the built server refuses to start."* (3) is `codegen/tenant-startup-check.ts`.
 *
 * WHY. The floor scopes reads of the tables in the compilation's ONE tenant set
 * (`tenant-egress.ts` `compilationTenantSet`: every `<schema>` + the `<db tables=>`
 * registry). A table whose `tenant_id` exists only in a program-body `CREATE TABLE` or
 * a live database file was not in that set, so its reads were emitted unscoped — every
 * tenant's rows to every request — with no diagnostic. NOT silent scoping (the
 * ruling's rejected (a)): the author is told, and declares it. No opt-out: a `tenant_id`
 * column IS the declaration; a table meant to stay unscoped renames the column.
 *
 * Both checks read the SAME tenant set the floor and the `<schema>` rule read (computed
 * once by the api.js TENANT-SCHEMA stage) — never a recomputed one.
 *
 *   (1) `programBodyUndeclaredTenantTables` walks the file AST for every `?{}` OUTSIDE a
 *       `<schema>` (a `sql` node's `query`, an expression-position `sql-ref`'s `raw`)
 *       and reads each with `schema-differ.js` `programTenantTableDecls` — the same
 *       `CREATE TABLE` / `ALTER TABLE` recognizers the `<schema>` reading uses, every
 *       head kind included (`TEMP` / `TEMPORARY` / `VIRTUAL` / …).
 *   (2) `liveUndeclaredTenantTables` reads the relations the protect analyzer found
 *       carrying `tenant_id` in every SQLite FILE it opened for a `<db src=…>` block
 *       (`ProtectAnalysis.liveTenantTables`, protect-analyzer.ts) — every relation, not
 *       only the ones `tables=` names.
 */

import { programStatementVerdicts } from "./schema-differ.js";

/** One `E-TENANT-UNDECLARED` diagnostic (the TENANT-SCHEMA stage's shape). */
export interface TenantUndeclaredDiagnostic {
  code: "E-TENANT-UNDECLARED";
  message: string;
  span: unknown;
  severity: "error";
}

/** A program-body statement refused by the closed allow-list (S456 "a, fix F7/F9 too"). */
export interface ProgramStatementDiagnostic {
  code: "E-TENANT-UNDECLARED" | "E-SQL-PROGRAM-STATEMENT-NOT-ADMITTED";
  message: string;
  span: unknown;
  severity: "error";
}

/** A relation carrying `tenant_id` in a live SQLite file the compile opened (protect-analyzer.ts). */
export interface LiveTenantRelation {
  /** The relation's name as the database spells it. */
  table: string;
  /** "table" | "view"; "unreadable" when its columns could not be read. */
  type: string;
  /** The `src=` display form of the database. */
  db: string;
  /** The declaring `.scrml` file and the `<db>` block's span. */
  filePath: string;
  span: unknown;
  /** Set when the relation's columns could not be read (it is refused: unknown is not clean). */
  error?: string;
}

const FIX =
  "Declare it in `<schema>` so the tenant floor scopes it. A `tenant_id` column IS the declaration " +
  "(§14.8.10) — there is no opt-out: if the table is not tenant data, rename the column.";

/** Lowercased membership in the compilation's tenant set. */
function inSet(set: Iterable<string>): (name: string) => boolean {
  const s = new Set<string>();
  for (const t of set) if (typeof t === "string") s.add(t.toLowerCase());
  return (name: string) => s.has(name.toLowerCase());
}

/** The admitted program-body statements, for messages (SPEC §14.8.10 item (1)). */
const ADMITTED_SUMMARY =
  "A program-body `?{}` admits only: DML (`SELECT` / `WITH` / `INSERT` / `UPDATE` / `DELETE` / `REPLACE`, " +
  "no `SELECT … INTO`); `CREATE [TEMP] TABLE [IF NOT EXISTS] name (col type, …)`; `ALTER TABLE name ADD " +
  "[COLUMN] col type`; `CREATE VIRTUAL TABLE name USING fts5(…)` with the closed fts5 options; `CREATE " +
  "[UNIQUE] INDEX [IF NOT EXISTS] name ON table (cols) [WHERE …]`; `BEGIN` / `COMMIT` / `ROLLBACK` / " +
  "`SAVEPOINT` / `RELEASE`; and `PRAGMA table_info | table_xinfo | index_list | index_info | " +
  "foreign_key_list | busy_timeout | journal_mode`.";

/** The SQL text inside an expression-position `?{ … }` (`sql-ref` `raw`), template backticks removed. */
function sqlRefBody(raw: string): string {
  let s = raw.trim();
  if (s.startsWith("?{") && s.endsWith("}")) s = s.slice(2, -1).trim();
  if (s.startsWith("`") && s.endsWith("`") && s.length >= 2) s = s.slice(1, -1);
  return s;
}

/**
 * (1) Every program-body `?{}` statement, held to the CLOSED allow-list (S456 "a, fix F7/F9
 * too" + "your recs, go"; `schema-differ.js` `programStatementVerdicts`):
 *   - `tenant` — an admitted form that gives a relation outside the tenant set a `tenant_id`
 *     column (or an fts5 `content =` a tenant table) → `E-TENANT-UNDECLARED`;
 *   - `not-admitted` / `unreadable` → `E-SQL-PROGRAM-STATEMENT-NOT-ADMITTED`.
 * A statement that does not begin with a SQL keyword (a bare `${q}` or identifier body) is
 * left to E-SQL-003, which already refuses it.
 */
export function programBodyUndeclaredTenantTables(
  fileAST: unknown,
  tenantTables: Iterable<string>,
  dialect: string = "unknown",
): ProgramStatementDiagnostic[] {
  const declared = inSet(tenantTables);
  const out: ProgramStatementDiagnostic[] = [];
  const filePath = (fileAST as any)?.filePath ?? (fileAST as any)?.ast?.filePath ?? "";
  const seen = new WeakSet<object>();
  const reported = new Set<string>();
  const read = (sql: string, span: unknown): void => {
    // A body that is one bare identifier (`?{q}`) is E-SQL-003's (a runtime-assembled SQL
    // string) — unless it is one of the single-word statements E-SQL-003 admits, which the
    // allow-list then judges (`BEGIN` admitted, `VACUUM` refused).
    const bare = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*;?\s*$/.exec(sql);
    if (bare && !["VACUUM", "BEGIN", "COMMIT", "END", "ROLLBACK", "ANALYZE", "CHECKPOINT"].includes(bare[1].toUpperCase())) return;
    for (const d of programStatementVerdicts(sql, { dialect, isTenant: declared })) {
      if (d.verdict === "admitted") continue;
      if (d.verdict === "not-admitted" && d.why === "it does not begin with a SQL keyword") continue;
      const key = `${String((span as any)?.start ?? "")}\0${d.offset}\0${d.verdict}`;
      if (reported.has(key)) continue;
      reported.add(key);
      const at = span ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 };
      if (d.verdict === "tenant") {
        out.push({
          code: "E-TENANT-UNDECLARED",
          message:
            `E-TENANT-UNDECLARED: this \`?{}\` statement gives \`${d.name}\` tenant data (${d.why}), and \`${d.name}\` is not declared ` +
            `tenant-scoped: no \`<schema>\` and no \`<db tables=>\` of this compilation declares it, so the tenant ` +
            `floor would not scope it and every tenant's rows would reach every request. ${FIX} (A temporary table ` +
            `cannot be declared in \`<schema>\` — E-SCHEMA-014 — so keep tenant rows in a declared table.)`,
          span: at,
          severity: "error",
        });
        continue;
      }
      out.push({
        code: "E-SQL-PROGRAM-STATEMENT-NOT-ADMITTED",
        message:
          `E-SQL-PROGRAM-STATEMENT-NOT-ADMITTED: this \`?{}\` statement${d.lead ? ` (\`${d.lead}\` …)` : ""} is not ` +
          `admitted in a program body: ${d.why}. Declare the relation in \`<schema>\` instead (§14.8.10 — a ` +
          `statement the compiler cannot read exactly could create a \`tenant_id\` relation the tenant floor ` +
          `does not scope). ${ADMITTED_SUMMARY}`,
        span: at,
        severity: "error",
      });
    }
  };
  const visit = (v: unknown, depth: number): void => {
    if (v === null || typeof v !== "object" || depth > 200 || seen.has(v as object)) return;
    seen.add(v as object);
    if (Array.isArray(v)) { for (const x of v) visit(x, depth + 1); return; }
    const n = v as Record<string, unknown>;
    // A `<schema>` body is the declaration itself — never a program-body statement.
    if (n.kind === "state" && n.stateType === "schema") return;
    if (n.kind === "sql" && typeof n.query === "string") read(n.query, n.span);
    else if (n.kind === "sql-ref" && typeof n.raw === "string") read(sqlRefBody(n.raw), n.span);
    for (const key of Object.keys(n)) {
      if (key === "span" || key.startsWith("_")) continue;
      visit(n[key], depth + 1);
    }
  };
  const root = (fileAST as any)?.ast?.nodes ?? (fileAST as any)?.nodes ?? fileAST;
  visit(root, 0);
  return out;
}

/**
 * (2) Relations in a live SQLite file the compile opened that carry `tenant_id` and are
 * not in the compilation's tenant set — and relations whose columns could not be read.
 */
export function liveUndeclaredTenantTables(
  live: readonly LiveTenantRelation[] | undefined,
  tenantTables: Iterable<string>,
): TenantUndeclaredDiagnostic[] {
  const declared = inSet(tenantTables);
  const out: TenantUndeclaredDiagnostic[] = [];
  const reported = new Set<string>();
  for (const r of live ?? []) {
    if (r.error === undefined && declared(r.table)) continue;
    const key = `${r.db}\0${r.table.toLowerCase()}`;
    if (reported.has(key)) continue;
    reported.add(key);
    const kind = r.type === "view" ? "view" : "table";
    out.push({
      code: "E-TENANT-UNDECLARED",
      message: r.error !== undefined
        ? `E-TENANT-UNDECLARED: the database \`${r.db}\` holds \`${r.table}\`, whose columns could not be read ` +
          `(${r.error}), so the compiler cannot tell whether it carries \`tenant_id\` — an undeclared tenant table ` +
          `would be read unscoped, so an unreadable one is refused (§14.8.10). Repair or remove it.`
        : `E-TENANT-UNDECLARED: the database \`${r.db}\` holds the ${kind} \`${r.table}\`, which has a \`tenant_id\` ` +
          `column, but no \`<schema>\` and no \`<db tables=>\` of this compilation declares it tenant-scoped — so the ` +
          `tenant floor would not scope it and every tenant's rows would reach every request. ` +
          (kind === "view"
            ? "A view is not a declaration (and a `<schema>` view over a tenant table is E-TENANT-SCHEMA-HAZARD): drop " +
              "the view and read the declared tables, or — if its rows are not tenant data — rename the column."
            : FIX),
      span: r.span,
      severity: "error",
    });
  }
  return out;
}
