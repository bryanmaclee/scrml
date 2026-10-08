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
import { programStatementCount, programStatementVerdicts } from "../schema-differ.js";
import { CGError } from "./errors.ts";
import { registeredFileSource, resolveSpanLineCol } from "./log-loc.ts";

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
export type DriverCallVerdict = "ok" | "multiple-statements" | "text-not-read" | "not-admitted";

// ---------------------------------------------------------------------------
// §14.8.10 item (1) at the LOWERING POINT (S457, g-sql-checker-and-lowering-read-different-text-s457)
// ---------------------------------------------------------------------------
//
// The TENANT-SCHEMA stage holds every program-body `?{}` it can FIND to the closed statement
// allow-list — but it finds them in the RAW scrml text, while codegen lowers REWRITTEN text (the
// text path runs after `@cell` → `_scrml_body["cell"]`), a STRUCTURAL parse (a server
// template-literal slot), or text whose `?{` the parser hid behind a marker (`<#name>` in the same
// template). Three readers of one text: `@new / ?{…DROP TABLE…}`, `{ y: 1 } / ?{…}` and
// `` `${ ?{…} } ${ <#x> }` `` each compiled clean and the DROP ran (executed on SQLite). So the
// allow-list is ALSO decided here, on the SQL text the emitted driver call will send — read by the
// same acorn parse as the one-statement rule — and a site the emitter lowers is a site the check
// reads, by construction. The stage check stays (it reports at the exact `?{` span); this one is
// the authority, and its report is dropped when the stage already reported the same body
// (`sqlBodyKey`, api.js `collectErrors`).

/** The program-body SQL policy of the current compilation (set once per run by `runCG`). */
interface ProgramBodySqlPolicy {
  /** §14.8.10 item (1) governs a compilation with a database (`compilationHasDatabase`). */
  hasDatabase: boolean;
  /** Membership in the compilation's ONE tenant set — the stage's and the floor's. */
  isTenant: (name: string) => boolean;
  dialect: string;
}

/**
 * The policy in force. `null` = no compilation context (an emitter driven directly, e.g. by a
 * unit test): FAIL CLOSED — governed, an empty tenant set, an unknown dialect.
 */
let _policy: ProgramBodySqlPolicy | null = null;
/** The file being emitted (for diagnostics + the dedupe key). */
let _policyFile = "";
/** The source span of the statement being lowered (emit-logic `emitLogicNode`). */
let _loweringSpan: Record<string, unknown> | null = null;

/** Install (or clear, with `null`) the compilation's program-body SQL policy. */
export function setProgramBodySqlPolicy(
  p: { hasDatabase: boolean; tenantTables: Iterable<string>; dialect?: string } | null,
): void {
  if (p === null) { _policy = null; return; }
  const set = new Set<string>();
  for (const t of p.tenantTables) if (typeof t === "string") set.add(t.toLowerCase());
  _policy = { hasDatabase: p.hasDatabase, isTenant: (name) => set.has(String(name).toLowerCase()), dialect: p.dialect ?? "unknown" };
}

/** The file whose `?{}` sites are being lowered (runCG's per-file loop). */
export function setProgramBodySqlFile(filePath: string | null): void {
  _policyFile = typeof filePath === "string" ? filePath : "";
}

/**
 * Swap in the statement emitter's current source span (set on entry to `emitLogicNode`,
 * restored on exit); returns the previous one. A text-path site carries no span of its own —
 * its diagnostic points at the statement that holds it.
 */
export function swapSqlLoweringSpan(span: Record<string, unknown> | null): Record<string, unknown> | null {
  const prev = _loweringSpan;
  _loweringSpan = span;
  return prev;
}

/** A program-body statement the allow-list refuses. */
export interface ProgramStatementRefusal {
  code: "E-SQL-PROGRAM-STATEMENT-NOT-ADMITTED" | "E-TENANT-UNDECLARED" | "E-SQL-MULTIPLE-STATEMENTS";
  /** The statement's leading keyword (or its first characters); for E-SQL-MULTIPLE-STATEMENTS, "". */
  lead: string;
  /** For `E-TENANT-UNDECLARED`: the relation given a `tenant_id`. */
  name: string | null;
  why: string;
}

/**
 * §14.8.10 item (1) — the first statement of `sql` (SQL text, `${…}` slots in place) the closed
 * allow-list refuses, or `null` when every statement is admitted (or the compilation has no
 * database — not governed). Read with `schema-differ.js` `programStatementVerdicts`, the stage's
 * reader, over the compilation's tenant set and dialect.
 */
export function programStatementRefusal(sql: string): ProgramStatementRefusal | null {
  if (typeof sql !== "string") return null;
  const policy = _policy ?? { hasDatabase: true, isTenant: () => false, dialect: "unknown" };
  if (!policy.hasDatabase) return null;
  for (const d of programStatementVerdicts(sql, { dialect: policy.dialect, isTenant: policy.isTenant }) as any[]) {
    if (d.verdict === "admitted") continue;
    return {
      code: d.verdict === "tenant" ? "E-TENANT-UNDECLARED" : "E-SQL-PROGRAM-STATEMENT-NOT-ADMITTED",
      lead: d.lead ?? "",
      name: d.name ?? null,
      why: d.why ?? "",
    };
  }
  return null;
}

/**
 * §8.1.2 — the compile refusal for a lowered `?{}` whose SQL holds more than one statement, or
 * `null` (one statement, or a database-less compilation — not governed at compile; the site still
 * throws). A body outside the closed lexical subset is not counted: it is the allow-list's
 * `E-SQL-PROGRAM-STATEMENT-NOT-ADMITTED`, exactly as the TENANT-SCHEMA stage reports it.
 * (S457 review nit (a): a multi-statement body in F2/F3/F4 position compiled at exit 0 and only threw.)
 */
export function multipleStatementsRefusal(sql: string): ProgramStatementRefusal | null {
  if (typeof sql !== "string") return null;
  const policy = _policy ?? { hasDatabase: true, isTenant: () => false, dialect: "unknown" };
  if (!policy.hasDatabase) return null;
  const { statements, unreadable } = programStatementCount(sql);
  if (unreadable !== null) return programStatementRefusal(sql);
  if (statements <= 1) return null;
  return { code: "E-SQL-MULTIPLE-STATEMENTS", lead: "", name: null, why: String(statements) };
}

/** The §8.1.2 compile message (the TENANT-SCHEMA stage's and the lowering's). */
export function multipleStatementsMessage(statements: number | string): string {
  return `E-SQL-MULTIPLE-STATEMENTS: this \`?{}\` holds ${statements} SQL statements — a \`?{}\` holds exactly one ` +
    `(§8.1.2). A \`;\` may only end the statement; nothing may follow it. Split it into one \`?{}\` per ` +
    `statement; when they must succeed or fail together, put those \`?{}\`s in a \`transaction { }\` block ` +
    `(§8.5.3, §19.10). (Every statement of one string runs on the database, so a chained statement could ` +
    `change the connection's tenant or role — §14.8.11 — for the statements after it.)`;
}

/** The admitted program-body statements, for messages (SPEC §14.8.10 item (1)). */
export const PROGRAM_STATEMENT_ADMITTED_SUMMARY =
  "A program-body `?{}` admits only: DML (`SELECT` / `WITH` / `INSERT` / `UPDATE` / `DELETE` / `REPLACE`, " +
  "no `SELECT … INTO`); `CREATE [TEMP] TABLE [IF NOT EXISTS] name (col type, …)`; `ALTER TABLE name ADD " +
  "[COLUMN] col type`; `CREATE VIRTUAL TABLE name USING fts5(…)` with the closed fts5 options; `CREATE " +
  "[UNIQUE] INDEX [IF NOT EXISTS] name ON table (cols) [WHERE …]`; `BEGIN` / `COMMIT` / `ROLLBACK` / " +
  "`SAVEPOINT` / `RELEASE`; and `PRAGMA table_info | table_xinfo | index_list | index_info | " +
  "foreign_key_list | busy_timeout | journal_mode`.";

const TENANT_FIX =
  "Declare it in `<schema>` so the tenant floor scopes it. A `tenant_id` column IS the declaration " +
  "(§14.8.10) — there is no opt-out: if the table is not tenant data, rename the column.";

/** The compile message for a refused program-body statement — the stage's and the lowering's. */
export function programStatementMessage(r: { code: ProgramStatementRefusal["code"]; lead: string; name: string | null; why: string }): string {
  if (r.code === "E-SQL-MULTIPLE-STATEMENTS") return multipleStatementsMessage(r.why);
  if (r.code === "E-TENANT-UNDECLARED") {
    return `E-TENANT-UNDECLARED: this \`?{}\` statement gives \`${r.name}\` tenant data (${r.why}), and \`${r.name}\` is not declared ` +
      `tenant-scoped: no \`<schema>\` and no \`<db tables=>\` of this compilation declares it, so the tenant ` +
      `floor would not scope it and every tenant's rows would reach every request. ${TENANT_FIX} (A temporary table ` +
      `cannot be declared in \`<schema>\` — E-SCHEMA-014 — so keep tenant rows in a declared table.)`;
  }
  return `E-SQL-PROGRAM-STATEMENT-NOT-ADMITTED: this \`?{}\` statement${r.lead ? ` (\`${r.lead}\` …)` : ""} is not ` +
    `admitted in a program body: ${r.why}. Declare the relation in \`<schema>\` instead (§14.8.10 — a ` +
    `statement the compiler cannot read exactly could create a \`tenant_id\` relation the tenant floor ` +
    `does not scope). ${PROGRAM_STATEMENT_ADMITTED_SUMMARY}`;
}

/**
 * The key one refused `?{}` body is reported under: code + file + the author's body (backticks
 * and whitespace runs normalised). The stage's report and the lowering's report of the same body
 * share it, so api.js `collectErrors` keeps the stage's (it carries the exact `?{` span).
 */
export function programStatementKey(code: string, filePath: string, authorBody: string): string {
  let b = String(authorBody ?? "").trim();
  if (b.startsWith("`") && b.endsWith("`") && b.length >= 2) b = b.slice(1, -1);
  return `${code}\0${filePath ?? ""}\0${b.replace(/\s+/g, " ").trim()}`;
}

let _refusals: CGError[] = [];
let _refusalKeys = new Set<string>();

/**
 * A statement span → the span of the `?{` inside it whose body is `authorBody`, read from the
 * file's registered source (log-loc.ts). The diagnostic then points at the query, not at the
 * statement around it. Unchanged when the source or the body cannot be found there.
 */
function narrowToSite(at: Record<string, unknown>, authorBody: string): Record<string, unknown> {
  const file = typeof at.file === "string" ? at.file : "";
  const src = registeredFileSource(file);
  const start = typeof at.start === "number" ? at.start : -1;
  const body = String(authorBody ?? "").trim();
  if (src === undefined || start <= 0 || body.length === 0) return at;
  const end = typeof at.end === "number" && at.end > start ? Math.min(at.end, src.length) : src.length;
  const k = src.slice(start, end).indexOf(body);
  if (k < 0) return at;
  const q = src.lastIndexOf("?{", start + k);
  if (q < start) return at;
  const lc = resolveSpanLineCol({ file, start: q });
  if (lc === null) return at;
  return { ...at, start: q, end: start + k + body.length, line: lc.line, col: lc.col };
}

/**
 * Record the compile diagnostic for a site the lowering refused. `authorBody` is the `?{}` body
 * as written (the dedupe key); `span` the site's own span when it has one, else the statement's.
 */
export function recordProgramStatementRefusal(r: ProgramStatementRefusal, authorBody: string, span?: unknown): void {
  const key = programStatementKey(r.code, _policyFile, authorBody);
  if (_refusalKeys.has(key)) return;
  _refusalKeys.add(key);
  const own = span && typeof span === "object" && typeof (span as any).start === "number" && (span as any).start > 0
    ? span as Record<string, unknown>
    : null;
  let at: Record<string, unknown> = { ...(own ?? _loweringSpan ?? { start: 0, end: 0, line: 1, col: 1 }) };
  if (typeof at.file !== "string" || !at.file) at.file = _policyFile;
  if (!own) at = narrowToSite(at, authorBody);
  const err = new CGError(r.code, programStatementMessage(r), at as any);
  (err as any).sqlBodyKey = key;
  _refusals.push(err);
}

/** Reset the refusal sink (once per `runCG`). */
export function resetProgramStatementRefusals(): void {
  _refusals = [];
  _refusalKeys = new Set();
}

/** Drain + clear the recorded refusals (runCG, beside the refused-lowering sink). */
export function drainProgramStatementRefusals(): CGError[] {
  const out = _refusals;
  _refusals = [];
  return out;
}

/** The full verdict on one emitted driver call: the refusal when the allow-list refused it. */
export interface DriverCallJudgement {
  verdict: DriverCallVerdict;
  refusal: ProgramStatementRefusal | null;
}

/** The SQL text a judged call sends (slots as `${_}`) → its one-statement + allow-list verdict. */
function judgeSentSql(sent: string, oneStatement: boolean): DriverCallJudgement {
  if (!oneStatement) return { verdict: "multiple-statements", refusal: multipleStatementsRefusal(sent) };
  const refusal = programStatementRefusal(sent);
  return refusal ? { verdict: "not-admitted", refusal } : { verdict: "ok", refusal: null };
}

/**
 * Read the emitted driver call `call` (`db\`…\`` or `db.unsafe(…)`) with acorn and judge the SQL
 * text it sends. `segments` is the compiler's own split of the body (`extractSqlParams`); for a
 * tagged template the cooked quasis must equal it.
 */
export function judgeDriverCall(call: string, segments: readonly string[] | null): DriverCallVerdict {
  return judgeDriverCallDetail(call, segments).verdict;
}

/**
 * `judgeDriverCall` with the allow-list refusal (S457). The SQL text judged is the text the call
 * SENDS: a tagged template's cooked quasis (parameters as `${_}` slots), an `unsafe` call's string
 * argument — read back into the compiler's segments when its `?N` placeholders sit exactly where
 * the compiler put them, otherwise as written (an author `?` is outside the closed lexical subset
 * and is refused, as the stage refuses it).
 */
export function judgeDriverCallDetail(call: string, segments: readonly string[] | null): DriverCallJudgement {
  let expr: any;
  try {
    expr = (acorn.parse(`(${call});`, PARSE_OPTIONS) as any).body[0]?.expression;
  } catch {
    // Not yet JavaScript (a text-path parameter a later pass rewrites, e.g. an `@cell`): judge
    // the compiler's own split — the same reader the compile check uses.
    if (segments === null) return { verdict: "ok", refusal: null };
    const sent = segments.join("${_}");
    return judgeSentSql(sent, sqlHoldsOneStatement(sent));
  }
  if (expr?.type === "TaggedTemplateExpression") {
    const quasis: string[] = expr.quasi.quasis.map((q: any) => q.value.cooked);
    if (quasis.some((q) => typeof q !== "string")) return { verdict: "text-not-read", refusal: null };
    // JavaScript COOKS a template literal's line terminators: a CR LF in the template source is
    // one LF in the cooked string (ECMA-262 §13.2.8.6 TV of LineTerminatorSequence) — so a `?{}`
    // body from a CRLF checkout reaches the driver with LF line ends. Every compiler reader ends a
    // line / `--` comment at the LF of a CR LF, so the two texts are the same SQL: compare with CR LF
    // read as LF. A LONE CR is cooked to LF as well, but the compiler readers do NOT end a line there
    // (a `--` comment would end earlier for the database than for the checks) — it is left
    // unnormalised, so it still differs and fails closed. (S456 PR #1335 Windows CI regression:
    // `-- WHERE user_id = ${@currentUser.id}\r\n` was refused as E-SQL-001 on a CRLF checkout.)
    const asCooked = (s: string): string => s.replace(/\r\n/g, "\n");
    if (segments !== null && (quasis.length !== segments.length || quasis.some((q, k) => q !== asCooked(segments[k])))) {
      return { verdict: "text-not-read", refusal: null };
    }
    const sent = quasis.join("${_}");
    return judgeSentSql(sent, sqlHoldsOneStatement(sent));
  }
  if (expr?.type === "CallExpression" && expr.callee?.type === "MemberExpression" &&
      expr.callee.property?.name === "unsafe") {
    const arg = expr.arguments[0];
    if (arg?.type !== "Literal" || typeof arg.value !== "string") return { verdict: "text-not-read", refusal: null };
    const one = sqlHoldsOneStatement(arg.value);
    // `?N` placeholders exactly where the compiler's segments put them → judge as the segments.
    const placed = segments !== null && segments.length > 1 && expr.arguments.length > 1
      ? segments.map((seg, k) => (k === 0 ? seg : `?${k}${seg}`)).join("")
      : null;
    const sent = placed !== null && placed === arg.value ? segments!.join("${_}") : arg.value;
    return judgeSentSql(sent, one);
  }
  return { verdict: "text-not-read", refusal: null };
}

/** The fail-closed expression emitted in place of a refused driver call (no trailing `;`). */
export function refusedDriverCallExpr(verdict: Exclude<DriverCallVerdict, "ok">, refusal?: ProgramStatementRefusal | null): string {
  if (verdict === "not-admitted") {
    const msg = refusal?.code === "E-TENANT-UNDECLARED"
      ? `E-TENANT-UNDECLARED: this ?{} statement gives ${refusal.name ?? "a relation"} tenant data, and it is ` +
        "not declared tenant-scoped (§14.8.10) — it was refused at compile and was not sent to the database."
      : `E-SQL-PROGRAM-STATEMENT-NOT-ADMITTED: this ?{} statement${refusal?.lead ? ` (${refusal.lead} …)` : ""} is not ` +
        "admitted in a program body (§14.8.10 item (1)) — it was refused at compile and was not sent to the database.";
    return `(()=>{throw new _scrml_g.Error(${JSON.stringify(msg)})})()`;
  }
  const msg = verdict === "multiple-statements"
    ? "E-SQL-MULTIPLE-STATEMENTS: a ?{} holds exactly one SQL statement (§8.1.2) — this query holds more " +
      "than one and was not sent to the database. Split it into one ?{} per statement (a transaction { } " +
      "block keeps them atomic)."
    : "E-SQL-001: the emitted query would send SQL text the compiler did not read (a bound parameter's " +
      "extent differs between the compiler and the JavaScript template) — it was not sent (§8.6).";
  return `(()=>{throw new _scrml_g.Error(${JSON.stringify(msg)})})()`;
}

/**
 * §8.1.2 at a lowering whose SQL (`sql`, `${…}` slots in place) holds more than one statement:
 * record the compile diagnostic (governed compilations; deduped with the stage's by the author
 * body) and return the throwing expression that replaces the driver call.
 */
export function refuseMultipleStatements(sql: string, authorBody: string, span?: unknown): string {
  const refusal = multipleStatementsRefusal(sql);
  if (refusal) recordProgramStatementRefusal(refusal, authorBody, span);
  return refusedDriverCallExpr("multiple-statements");
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
