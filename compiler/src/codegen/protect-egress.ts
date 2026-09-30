/**
 * §14.8.9 — Server→client confidentiality: protected-column egress redaction.
 *
 * This module owns the FLOOR (the load-bearing structural redaction) for
 * `protect=` columns: a column whose resolved source `(table, column)` origin
 * is a protected field SHALL NOT cross the wire to the client unless it is
 * explicitly declassified with `reveal("col")`.
 *
 * The mechanism is "tag at query-lowering, read at the egress sink":
 *
 *   1. At `?{ SELECT ... }` lowering, the resolved per-output-column origins
 *      (reusing the §14.8.7 FROM/JOIN alias map via `extractSelectProjection`)
 *      are turned into the set of OUTPUT column names whose origin is protected.
 *      Each result row is wrapped with `_scrml_protect_tag(rows, cols)`, which
 *      attaches a Symbol-keyed descriptor (`Symbol.for("scrml.protect.origin")`).
 *
 *   2. The descriptor PROPAGATES through every compiler-emitted construction
 *      step for free, because it is an enumerable Symbol-keyed own property:
 *      `{...row}` spread copies it, `.map(r => ({...r}))` preserves it, a helper
 *      `return row` carries it, JOIN rows carry per-output-column origins. A
 *      `JSON.stringify` of the value IGNORES Symbol keys, so the descriptor is
 *      never itself serialized (it is metadata, not data).
 *
 *   3. At the single compiler-owned egress sink (server-fn response serializer
 *      + SSR `/__serverLoad`), `_scrml_protect_redact(value)` walks the value,
 *      reads the descriptor, and drops every protected-origin column that is not
 *      `reveal`-stamped. Redaction is sound BY CONSTRUCTION — the compiler reads
 *      a tag at egress; it never proves a return clean (no value-flow obligation).
 *
 * Soundness bound (§14.8.9 normative — DO NOT over-claim): the RUNTIME strip
 * here is complete only for values that still ARE (or contain) a tagged row. A
 * value EXTRACTED from the row — `return row.pw`, `{ secret: row.pw }`,
 * `"x" + row.pw`, `JSON.stringify(row)` — carries no descriptor and passes this
 * floor untouched. That is NOT the derived-flow boundary (the value IS the
 * column); it is closed at COMPILE time by the provenance flow in
 * `protect-flow.ts` (`E-PROTECT-006`, S441 — until then it shipped, measured).
 * Genuinely derived flows (`{ hasPw: row.pw != "" }` — a value of independent
 * identity) and covert channels remain out of scope. Unresolvable dynamic SQL is
 * stripped WHOLESALE (fail-closed), never accept-unknown.
 *
 * RAW / FOREIGN EGRESS — the closed-world precondition, enforced in THREE places
 * with three different strengths. Read the strengths; they are not interchangeable:
 *
 *   - `_{}` (§23) and `asIs` (§14.1.1) — `E-PROTECT-004`, a per-body SOURCE-TEXT
 *     co-occurrence LINT. Conservative, defeated by function extraction, and NOT
 *     a guarantee. Labelled as such at its definition; do not restate it as one.
 *   - an author-serialized response BODY (§40) — `E-PROTECT-005`, a HARD compile
 *     error raised at EMISSION, when the compiler is about to wrap an author
 *     value in an envelope it cannot mediate. Structural, not source-text.
 *   - anything that reaches the sink anyway — the RUNTIME refusal in
 *     `_scrml_protect_redact` / `_scrml_protect_opaque_refusal()`. `instanceof
 *     Response` is exact, so this limb has no spelling problem and no extraction
 *     hole. **This is the guarantee. The other two are early warnings.**
 *
 * ⚑ **THE UNIT OF ALL THREE IS THE BODY, NOT THE `Response`.** A `Response` with
 * a null body — a redirect, a 204, `Response.error()` — carries no payload, so
 * there is nothing for a `protect=` column to hide in and nothing for the floor
 * to fail to inspect. Limbs 2 and 3 both permit it; `W-PROTECT-005` covers the
 * narrow seam where the compile limb can prove that and the runtime limb cannot.
 * The adopter-facing statement of the whole contract is one sentence: **a
 * `protect=` app keeps full control of STATUS and HEADERS and gives up authoring
 * the BODY.**
 */

import { extractSelectProjection } from "../sql-projection.ts";
// @ts-ignore — acorn ships its own types but the compiler imports it untyped
// elsewhere (expression-parser.ts, validate-emit.ts, egress-field-scan.ts) for
// the same reason. Used by `findAuthoredResponseConstruction` below.
import * as acorn from "acorn";

/**
 * Compile-time protect context: which `(table, column)` origins are protected,
 * plus each protected table's full column list (for `SELECT *` expansion).
 * Built from the PA stage's ProtectAnalysis (`buildProtectContext`).
 */
export interface ProtectContext {
  /** table name -> set of protected column names on that table. */
  protectedByTable: Map<string, Set<string>>;
  /** table name -> all column names on that table (for `SELECT *` expansion). */
  schemaByTable: Map<string, string[]>;
  /**
   * Every base table the compile knows the columns of (lower-cased) — see
   * `ProtectAnalysis.declaredTables`. A query over a table outside this set and
   * outside `schemaByTable` strips its rows wholesale (S443 round 6, P4).
   */
  knownTables?: Set<string>;
}

/**
 * Build the codegen-side ProtectContext from the PA stage's ProtectAnalysis.
 * Duck-typed against the loose `{ views?: Map<...> }` shape threaded through
 * runCG so this composes with both the unit-test FileAST input and the live
 * pipeline TABResult input.
 *
 * Returns a context with EMPTY maps when the app declares no `protect=` fields —
 * the caller treats `protectedByTable.size === 0` as "protect inactive" and
 * emits byte-identical output (zero overhead for non-protect apps).
 */
export function buildProtectContext(protectAnalysis: unknown): ProtectContext {
  const protectedByTable = new Map<string, Set<string>>();
  const schemaByTable = new Map<string, string[]>();
  const views = (protectAnalysis as { views?: Map<string, unknown> } | null | undefined)?.views;
  const declared = (protectAnalysis as { declaredTables?: Set<string> } | null | undefined)?.declaredTables;
  const knownTables = new Set<string>();
  if (declared && typeof (declared as Set<string>).forEach === "function") for (const t of declared) knownTables.add(foldIdent(t));
  if (!views || typeof (views as Map<string, unknown>).forEach !== "function") {
    return { protectedByTable, schemaByTable, knownTables };
  }
  for (const [, dbViews] of views as Map<string, { tables?: Map<string, unknown> }>) {
    const tables = dbViews?.tables;
    if (!tables || typeof (tables as Map<string, unknown>).forEach !== "function") continue;
    for (const [tableName, view] of tables as Map<string, {
      protectedFields?: Set<string>;
      fullSchema?: Array<{ name?: string }>;
    }>) {
      if (view?.protectedFields && view.protectedFields.size > 0) {
        const existing = protectedByTable.get(tableName) ?? new Set<string>();
        for (const f of view.protectedFields) existing.add(f);
        protectedByTable.set(tableName, existing);
      }
      if (Array.isArray(view?.fullSchema)) {
        const cols = view.fullSchema.map((c) => c?.name).filter((n): n is string => typeof n === "string");
        if (cols.length > 0) schemaByTable.set(tableName, cols);
      }
    }
  }
  return { protectedByTable, schemaByTable, knownTables };
}

/**
 * The result of resolving a `?{}` SELECT's protected-origin output columns:
 *   - `{ cols }`  — explicit protected OUTPUT column names (alias-resolved).
 *   - `{ all: true }` — a SELECT whose origins cannot be statically resolved
 *                       (dynamic/CTE/UNION/subquery); the row is stripped
 *                       WHOLESALE at egress (fail-closed, OQ-3).
 *   - `null`      — no protected egress (no protected column selected, or the
 *                   query is not a row-producing SELECT). No tag is emitted.
 */
export type ProtectedColumns = { cols: string[] } | { all: true } | null;

/**
 * Strip leading SQL comments (block `slash-star ... star-slash` and `-- ...`
 * line comments) plus whitespace so the leader test sees the first real keyword.
 * Applied repeatedly because a query may carry several stacked leading comments
 * (e.g. a line comment then a block comment then the SELECT). An unterminated
 * block comment consumes the rest (a malformed / no-op query).
 */
function stripLeadingSqlNoise(sql: string): string {
  let prev: string;
  let s = sql;
  do {
    prev = s;
    s = s.trimStart();
    if (s.startsWith("/*")) {
      const end = s.indexOf("*/");
      s = end === -1 ? "" : s.slice(end + 2);
    } else if (s.startsWith("--")) {
      const nl = s.indexOf("\n");
      s = nl === -1 ? "" : s.slice(nl + 1);
    }
  } while (s !== prev);
  return s;
}

/**
 * Is this query ROW-PRODUCING (so it can carry a client-facing protected column)?
 * True for a leading `SELECT` OR a leading `WITH` (a CTE — `WITH [RECURSIVE] ...`).
 * The leader test runs AFTER stripping `${...}` bound params and leading SQL
 * comments, so a comment- or CTE-prefixed row still reaches the egress floor
 * (§14.8.9: an unresolvable-origin row is stripped WHOLESALE, never accept-unknown).
 * A CTE degrades to the `{ all: true }` strip-all path in `extractSelectProjection`
 * (WITH is an UNTYPEABLE_LEADER); a comment-prefixed plain SELECT resolves normally.
 */
function isRowProducingQuery(sqlContent: string): boolean {
  const normalized = stripLeadingSqlNoise(sqlContent.replace(/\$\{[^}]*\}/g, " "));
  return /^(?:select|with)\b/i.test(normalized);
}

/**
 * Resolve the protected OUTPUT column names a `?{}` SELECT carries, keyed on the
 * column's resolved `(table, column)` ORIGIN (never its surface name — so
 * `SELECT passwordHash AS h` redacts identically to `SELECT passwordHash`).
 *
 * Reuses `extractSelectProjection` (the §14.8.7 alias-origin map). A `SELECT *`
 * / `table.*` star is expanded against the protected table's column set.
 */
/**
 * Fold a SQLite identifier for comparison: drop a schema qualifier
 * (`main.users`), strip one layer of identifier quoting (`"x"`, `` `x` ``,
 * `[x]`), and lower-case it. SQLite compares identifiers case-insensitively
 * whether or not they are quoted.
 */
export function foldIdent(name: string): string {
  // Last dot-separated segment outside quotes = the identifier itself.
  let s = name.trim();
  const m = /(?:^|\.)("(?:[^"]|"")*"|`[^`]*`|\[[^\]]*\]|[^."`\[\]]+)$/.exec(s);
  if (m) s = m[1];
  const q = /^"((?:[^"]|"")*)"$/.exec(s) ?? /^`([^`]*)`$/.exec(s) ?? /^\[([^\]]*)\]$/.exec(s);
  if (q) s = q[1].replace(/""/g, '"');
  return s.toLowerCase();
}

/** table (folded) -> Map<column (folded) -> declared column name>. */
function protectedIndexCI(ctx: ProtectContext): Map<string, Map<string, string>> {
  const idx = new Map<string, Map<string, string>>();
  for (const [t, cols] of ctx.protectedByTable) {
    const key = foldIdent(t);
    const m = idx.get(key) ?? new Map<string, string>();
    for (const c of cols) m.set(foldIdent(c), c);
    idx.set(key, m);
  }
  return idx;
}

/** Every table the compile knows the full column set of (folded names). */
function knownTablesCI(ctx: ProtectContext): Set<string> {
  const s = new Set<string>();
  for (const t of ctx.schemaByTable.keys()) s.add(foldIdent(t));
  for (const t of ctx.protectedByTable.keys()) s.add(foldIdent(t));
  if (ctx.knownTables) for (const t of ctx.knownTables) s.add(foldIdent(t));
  return s;
}

/**
 * The SQL text with string literals, quoted identifiers and comments blanked
 * out (same length, so indices line up), and `${…}` holes replaced by spaces.
 * Keyword scans run over this so `'… RETURNING …'` in a literal is not a clause.
 */
function blankSqlNoise(sql: string): string {
  let out = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    if (c === "$" && sql[i + 1] === "{") {
      let depth = 1;
      let j = i + 2;
      while (j < n && depth > 0) { if (sql[j] === "{") depth++; else if (sql[j] === "}") depth--; j++; }
      out += " ".repeat(j - i);
      i = j;
      continue;
    }
    if (c === "-" && sql[i + 1] === "-") {
      const nl = sql.indexOf("\n", i);
      const j = nl === -1 ? n : nl;
      out += " ".repeat(j - i);
      i = j;
      continue;
    }
    if (c === "/" && sql[i + 1] === "*") {
      const e = sql.indexOf("*/", i + 2);
      const j = e === -1 ? n : e + 2;
      out += " ".repeat(j - i);
      i = j;
      continue;
    }
    if (c === "'" || c === '"' || c === "`" || c === "[") {
      const close = c === "[" ? "]" : c;
      let j = i + 1;
      while (j < n) {
        if (sql[j] === close && close !== "]" && sql[j + 1] === close) { j += 2; continue; }
        if (sql[j] === close) { j++; break; }
        j++;
      }
      // Keep a quoted IDENTIFIER visible as a placeholder word (it is a name, not
      // data); blank a string literal entirely.
      out += c === "'" ? " ".repeat(j - i) : "q" + " ".repeat(Math.max(0, j - i - 1));
      i = j;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Index of the first depth-0 occurrence of keyword `kw` in blanked SQL, or -1. */
function topLevelKeyword(blanked: string, kw: string): number {
  const re = new RegExp(`\\b${kw}\\b`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(blanked)) !== null) {
    let depth = 0;
    for (let k = 0; k < m.index; k++) {
      if (blanked[k] === "(") depth++;
      else if (blanked[k] === ")") depth = Math.max(0, depth - 1);
    }
    if (depth === 0) return m.index;
  }
  return -1;
}

/**
 * ⚑ S443 round 6 (P1) — an INSERT / REPLACE / UPDATE / DELETE with a
 * `RETURNING` clause IS a row-producing query: the driver hands back the
 * written rows, and `UPDATE users SET … RETURNING *` served `passwordHash`
 * (measured; the tag only ever looked at SELECTs). Its `RETURNING` list is a
 * projection over the TARGET table, so it is resolved exactly like
 * `SELECT <list> FROM <target>`. Returns:
 *   - `null`           — not a write, or a write with no RETURNING (no rows);
 *   - `{ all: true }`  — a RETURNING write whose target cannot be read (fail closed);
 *   - `{ select }`     — the equivalent SELECT to resolve.
 */
function returningAsSelect(sqlContent: string): { select: string } | { all: true } | null {
  // `blankSqlNoise` preserves length, so offsets in `blanked` index `original`.
  const original = stripLeadingSqlNoise(sqlContent);
  const blanked = blankSqlNoise(original);
  const lead = /^(insert|replace|update|delete)\b/i.exec(blanked);
  if (!lead) return null;
  const retAt = topLevelKeyword(blanked, "returning");
  if (retAt === -1) return null;
  const list = original.slice(retAt + "returning".length).trim();
  if (list.length === 0) return { all: true };
  const IDENT_RE = "([A-Za-z_][A-Za-z0-9_]*)";
  let m: RegExpExecArray | null;
  let target: string | null = null;
  const verb = lead[1].toLowerCase();
  if (verb === "insert" || verb === "replace") {
    m = new RegExp(`^(?:insert|replace)(?:\\s+or\\s+\\w+)?\\s+into\\s+${IDENT_RE}(?:\\s+as\\s+${IDENT_RE})?(?=[\\s(]|$)`, "i").exec(blanked);
    if (m) target = m[1];
  } else if (verb === "update") {
    m = new RegExp(`^update(?:\\s+or\\s+\\w+)?\\s+${IDENT_RE}(?:\\s+(?:as\\s+)?${IDENT_RE})?\\s+set\\b`, "i").exec(blanked);
    if (m) target = m[1];
    // UPDATE … FROM joins other tables into the statement: fail closed.
    if (topLevelKeyword(blanked, "from") !== -1) return { all: true };
  } else {
    m = new RegExp(`^delete\\s+from\\s+${IDENT_RE}(?:\\s+(?:as\\s+)?${IDENT_RE})?(?=\\s|$)`, "i").exec(blanked);
    if (m) target = m[1];
  }
  if (!target) return { all: true };
  return { select: `SELECT ${list} FROM ${target}` };
}

export function resolveProtectedOutputColumns(
  sqlContent: string,
  ctx: ProtectContext,
): ProtectedColumns {
  // Only a row-producing query can carry a client-facing protected column: a
  // leading SELECT or a WITH/CTE (after stripping leading SQL comments), or —
  // S443 round 6 (P1) — an INSERT / REPLACE / UPDATE / DELETE with a
  // `RETURNING` clause, which is resolved as `SELECT <list> FROM <target>`. A
  // comment- or CTE-prefixed row must NOT slip past this gate untagged (§14.8.9
  // fail-closed): a WITH degrades to strip-all below, never accept-unknown.
  const returning = returningAsSelect(sqlContent);
  if (returning !== null && "all" in returning) return { all: true };
  if (returning === null && !isRowProducingQuery(sqlContent)) return null;

  const proj = extractSelectProjection(returning ? returning.select : sqlContent);
  // Unresolvable SELECT (dynamic / CTE / UNION / subquery-in-FROM) — fail-closed:
  // strip every column wholesale at egress (OQ-3), never accept-unknown.
  if (!proj.resolvable) return { all: true };

  // ⚑ S443 round 6 (P4) — a table the compile does not know the columns of (a
  // view created at runtime, a table no `<db tables=>` names) may carry a
  // protected column under any name: `CREATE VIEW v AS SELECT * FROM users`
  // then `SELECT * FROM v` served `passwordHash` (measured) because an unknown
  // table resolved to "no protected columns". It resolves to strip-all.
  const known = knownTablesCI(ctx);
  for (const t of proj.fromTables) if (!known.has(foldIdent(t))) return { all: true };

  // ⚑ S441 round 4 (F3) — SQLite identifiers are CASE-INSENSITIVE, quoted or
  // not (`users`, `USERS`, `"Users"` and `main.users` name one table;
  // `passwordHash` and `PASSWORDHASH` one column). This lookup was exact-case,
  // so `SELECT * FROM USERS …` emitted NO tag at all — the whole-row runtime
  // strip vanished and the route served the hash (measured, also on main).
  // Origin matching is therefore case-folded; the OUTPUT name stays exactly as
  // SQLite returns it (the key as written in the SELECT, or the declared name
  // for a `*` expansion), because that is the key the row object carries.
  const prot = protectedIndexCI(ctx);
  const out = new Set<string>();
  for (const col of proj.columns) {
    if (col.kind === "column" && col.table && col.column) {
      const cols = prot.get(foldIdent(col.table));
      const declared = cols?.get(foldIdent(col.column));
      // An UNALIASED column comes back keyed by its DECLARED name (SQLite:
      // `SELECT PASSWORDHASH` → key `passwordHash`, measured) — record that,
      // not the surface spelling; an alias comes back exactly as written.
      if (declared !== undefined) out.add(col.outputName === col.column ? declared : col.outputName);
    } else if (col.kind === "star") {
      // `SELECT *` (no table) expands against every FROM/JOIN table; `table.*`
      // expands against that one table. The output column name of a starred
      // column IS the source column name, so a protected source column appears
      // under its own (declared) name in the result row.
      const tables = col.table ? [col.table] : proj.fromTables;
      for (const t of tables) {
        const declared = prot.get(foldIdent(t));
        if (declared) for (const c of declared.values()) out.add(c);
      }
    }
    else if (col.kind === "opaque" && opaqueColumnMayCarryProtected(col.raw, prot)) {
      // ⚑ S441 round 5 (F3) — an EXPRESSION output column computed in SQL from a
      // protected column IS that column's value, re-encoded by the database:
      // `passwordHash || ''`, `lower()` / `hex()` / `CAST` / `substr` /
      // `coalesce` / `json_object` / `group_concat`, `pin + 0`, a quoted or
      // bracketed spelling (`"passwordHash"`, `[passwordHash]`), a
      // table-qualified one, a scalar subquery. Round 4 treated every such
      // column as a derived flow and emitted NO descriptor — MEASURED, each of
      // those shapes served the hash (also on main). Its output key is not
      // statically reliable (an unaliased expression is keyed by its own text,
      // engine-specifically), so the row is stripped WHOLESALE — the same
      // fail-closed degradation as unresolvable SQL (OVER-APPROXIMATION: a
      // derived-in-SQL value such as `length(passwordHash)` or
      // `passwordHash = ${x} AS ok` strips the whole row too).
      return { all: true };
    }
  }
  if (out.size === 0) return null;
  return { cols: [...out] };
}

/**
 * The identifier-like tokens of one SQL projection entry, lexed STRUCTURALLY
 * (not pattern-matched): `'…'` string literals are skipped (they are data, not
 * references); `"…"`, `` `…` `` and `[…]` quoted identifiers are unwrapped;
 * bare words are taken whole; every identifier is folded with `foldIdent`
 * (SQLite identifiers are case-insensitive). A qualified reference
 * `users.passwordHash` yields both segments. Also reports whether the entry
 * contains a nested `SELECT`, and a PROJECTION star — a `*` whose previous
 * token is `SELECT` / `DISTINCT` / `ALL` / `,` / `.` (a nested `SELECT *` or
 * `t.*`), as opposed to `COUNT(*)` (after `(`) or multiplication (after an
 * operand). (S441 round 5: treating EVERY `*` as a projection stripped the
 * trucking-dispatch customer list wholesale over a `(SELECT COUNT(*) …)`.)
 */
export function lexSqlEntry(entry: string): { idents: string[]; hasSelect: boolean; hasStar: boolean } {
  const idents: string[] = [];
  let hasSelect = false;
  let hasStar = false;
  // The previous significant token, for classifying a `*`.
  let prev = "";
  let i = 0;
  const n = entry.length;
  const isWordStart = (c: string) => /[A-Za-z_\u0080-\uffff]/.test(c);
  const isWord = (c: string) => /[A-Za-z0-9_$\u0080-\uffff]/.test(c);
  while (i < n) {
    const c = entry[i];
    if (c === "'") {
      // String literal; `''` is an escaped quote inside it.
      i++;
      while (i < n) {
        if (entry[i] === "'" && entry[i + 1] === "'") { i += 2; continue; }
        if (entry[i] === "'") { i++; break; }
        i++;
      }
      continue;
    }
    if (c === '"' || c === "`" || c === "[") {
      const close = c === "[" ? "]" : c;
      let j = i + 1;
      let s = "";
      while (j < n) {
        if (entry[j] === close && close !== "]" && entry[j + 1] === close) { s += close; j += 2; continue; }
        if (entry[j] === close) { j++; break; }
        s += entry[j];
        j++;
      }
      idents.push(s.toLowerCase());
      prev = "ident";
      i = j;
      continue;
    }
    if (isWordStart(c)) {
      let j = i + 1;
      while (j < n && isWord(entry[j])) j++;
      const w = entry.slice(i, j).toLowerCase();
      if (w === "select") hasSelect = true;
      idents.push(w);
      prev = w;
      i = j;
      continue;
    }
    if (/[0-9]/.test(c)) {
      // A numeric literal (incl. `1e5`, `0x1F`) — not a reference.
      let j = i + 1;
      while (j < n && /[0-9A-Za-z_.]/.test(entry[j])) j++;
      prev = "number";
      i = j;
      continue;
    }
    if (c === "*" && (prev === "select" || prev === "distinct" || prev === "all" || prev === "," || prev === ".")) hasStar = true;
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return { idents, hasSelect, hasStar };
}

/**
 * May an EXPRESSION output column carry a protected column's value? Fail-closed:
 * yes when any identifier in it (case-folded, quote-stripped, either segment of
 * a qualified name) names a protected column of ANY protected table — the
 * table is deliberately not required to match, because a scalar subquery can
 * read a table the outer FROM does not name — or when it contains a nested
 * `SELECT` with a `*` (a subquery whose projected columns are not visible here).
 */
function opaqueColumnMayCarryProtected(raw: string, prot: Map<string, Map<string, string>>): boolean {
  const { idents, hasStar } = lexSqlEntry(raw);
  // ⚑ S443 round 6 (P2) — ANY projection star in an entry the extractor could
  // not resolve is a star over some table: `users . *` (whitespace around the
  // dot) fell through to an opaque entry with no protected identifier and
  // served the whole row (measured). A projection `*` (after `.`, `SELECT`,
  // `DISTINCT`, `ALL` or `,` — never `COUNT(*)` or multiplication) fails closed.
  if (hasStar) return true;
  for (const id of idents) {
    for (const cols of prot.values()) if (cols.has(id)) return true;
  }
  return false;
}

/**
 * The server-bundle runtime helper block (§14.8.9). Injected into the server
 * module IFF one of `_scrml_protect_tag` / `_scrml_protect_redact` /
 * `_scrml_protect_reveal` is referenced (mirrors the `_scrml_wire_encode`
 * inline-on-use precedent). Server-only — never reaches client.js.
 */
export const SERVER_PROTECT_HELPER: string = [
  "",
  "// --- §14.8.9 Protected-column egress redaction (server-only confidentiality floor) ---",
  "// Each result row carries one MARKER per protected OUTPUT column: an own,",
  "// enumerable property keyed `Symbol.for(\"scrml.protect.col:<column>\")`. Enumerable,",
  "// so `{...row}` / `Object.assign` / `.map` copy them; Symbol-keyed, so",
  "// JSON.stringify never serializes them. The egress sink strips every column a",
  "// marker names. ⚑ S443 round 6b: ONE descriptor per object was replaced by one",
  "// marker per column because merging two rows (`{...a, ...b}`,",
  "// `Object.assign({}, a, b)`) let b's descriptor REPLACE a's and a's protected",
  "// column shipped (measured). Markers UNION on merge by construction, and a",
  "// `reveal` on one source removes only that source's marker — it can never",
  "// un-strip a column another source still marks.",
  "const _SCRML_PROTECT_PREFIX = \"scrml.protect.col:\";",
  "// ⚑ THE MEDIATION MARK — THIS IS THE SEAM BETWEEN THE COMPILE-TIME AND",
  "// RUN-TIME LIMBS, AND IT EXISTS BECAUSE THE TWO WERE ANSWERING THE SAME",
  "// QUESTION WITH DIFFERENT PREDICATES.",
  "//",
  "// Both limbs are asking: is this `Response` AUTHOR-owned (unmediated) or",
  "// COMPILER-owned (already mediated)? The compile-time gate answered it by",
  "// PROVENANCE — it scans only the author-body window, so a compiler-emitted",
  "// `Response` is excluded positionally. The runtime guard answered it by SHAPE",
  "// (`.body === null`), which is a proxy for \"carries a payload\", NOT for",
  "// \"who built it\". Every place provenance and shape disagree was a defect:",
  "//   · `Response.redirect(...)` — author-owned, but payload-free  (W-PROTECT-005)",
  "//   · the §53.9.4 `E-CONTRACT-001-RT` 400 — compiler-owned, but body-carrying,",
  "//     so the guard turned the compiler's own 400 into a 500.",
  "// The mark gives the runtime limb access to PROVENANCE, so both limbs now",
  "// decide on the same basis and a new crossing cannot re-open the gap.",
  "const _SCRML_MEDIATED = Symbol.for(\"scrml.protect.mediated\");",
  "function _scrml_protect_mediated(response) {",
  "  // Symbol-keyed like the origin descriptor, for the same reason: invisible to",
  "  // `JSON.stringify`, so marking a response never changes what ships.",
  "  response[_SCRML_MEDIATED] = true;",
  "  return response;",
  "}",
  "// The compiler-owned refusal for an egress the floor cannot inspect (§14.8.9).",
  "// It carries NO application data by construction: the whole point is that the",
  "// payload could not be proven free of a protected column, so none of it ships.",
  "function _scrml_protect_opaque_refusal() {",
  "  return new Response(JSON.stringify({ error: {",
  "    kind: \"ProtectOpaqueEgress\",",
  "    message: \"the server refused a response body it cannot redact: a `protect=` column could not be proven absent (SPEC §14.8.9). Return the value itself — the compiler envelopes and redacts it — instead of a hand-built Response.\",",
  "  } }), { status: 500, headers: { \"Content-Type\": \"application/json\" } });",
  "}",
  "// SQL identifiers are CASE-INSENSITIVE (SQLite; Postgres folds unquoted names),",
  "// so the row key the driver returns need not match the spelling in the SELECT:",
  "// `SELECT PASSWORDHASH` comes back keyed `passwordHash`. Every comparison the",
  "// floor makes — descriptor columns, reveal names, row keys — is on the folded",
  "// name (S441 round 5: an exact-case compare shipped the hash).",
  "function _scrml_protect_fold(c) {",
  "  return typeof c === \"string\" ? c.toLowerCase() : c;",
  "}",
  "// The markers on the row the query returned are NON-CONFIGURABLE: a `delete`",
  "// or a redefinition throws (server modules are strict). They stay WRITABLE, so",
  "// assigning a row onto a row (`Object.assign(a, b)`, a refresh in place) is not",
  "// an error (S443 round 6b: a frozen, non-writable descriptor made that a 500).",
  "// Overwriting a marker's VALUE changes nothing: the sink reads its presence.",
  "// A spread COPY holds ordinary markers again; deleting one there is what the",
  "// compile-time provenance flow rejects (E-PROTECT-006: a computed-key delete or",
  "// property redefinition on a row-bearing value — the key may be a marker).",
  "function _scrml_protect_mark(row, col) {",
  "  const k = Symbol.for(_SCRML_PROTECT_PREFIX + col);",
  "  const prev = Object.getOwnPropertyDescriptor(row, k);",
  "  if (prev && !prev.configurable) return;",
  "  Object.defineProperty(row, k, { value: true, enumerable: true, writable: true, configurable: false });",
  "}",
  "function _scrml_protect_mark_row(row, cols) {",
  "  // `\"*\"` (unresolvable SQL): every column the row has is protected.",
  "  const list = cols === \"*\" ? Object.keys(row).map(_scrml_protect_fold) : cols;",
  "  for (const c of list) _scrml_protect_mark(row, c);",
  "}",
  "// The folded column names an object's markers protect (null when untagged).",
  "function _scrml_protect_marked(value) {",
  "  let out = null;",
  "  for (const s of Object.getOwnPropertySymbols(value)) {",
  "    const k = Symbol.keyFor(s);",
  "    if (typeof k === \"string\" && k.startsWith(_SCRML_PROTECT_PREFIX)) {",
  "      if (!out) out = new Set();",
  "      out.add(k.slice(_SCRML_PROTECT_PREFIX.length));",
  "    }",
  "  }",
  "  return out;",
  "}",
  "function _scrml_protect_tag(value, cols) {",
  "  if (value == null || typeof value !== \"object\") return value;",
  "  if (Array.isArray(cols)) cols = cols.map(_scrml_protect_fold);",
  "  if (Array.isArray(value)) {",
  "    for (const row of value) {",
  "      if (row != null && typeof row === \"object\" && !Array.isArray(row)) _scrml_protect_mark_row(row, cols);",
  "    }",
  "    return value;",
  "  }",
  "  _scrml_protect_mark_row(value, cols);",
  "  return value;",
  "}",
  "function _scrml_protect_reveal(value, col) {",
  "  if (value == null || typeof value !== \"object\") return value;",
  "  if (Array.isArray(value)) return value.map((r) => _scrml_protect_reveal(r, col));",
  "  const marked = _scrml_protect_marked(value);",
  "  if (!marked) return value;",
  "  const f = _scrml_protect_fold(col);",
  "  const next = {};",
  "  for (const k of Object.keys(value)) next[k] = value[k];",
  "  for (const c of marked) if (c !== f) _scrml_protect_mark(next, c);",
  "  return next;",
  "}",
  "// ⛔ S443 round 6d — THE SINK OWNS SERIALIZATION. It returns a SNAPSHOT: a fresh",
  "// tree of plain objects, arrays and primitives in which every property was read",
  "// EXACTLY ONCE, every `toJSON` was invoked once (as the serializer would), every",
  "// function / Symbol / accessor is gone, and every marked column is stripped. The",
  "// serializer then sees only data the author's code can no longer influence.",
  "// Round 6c walked the value and then handed the ORIGINAL (non-plain) object to",
  "// `JSON.stringify` when nothing changed — which read its getters a SECOND time:",
  "// a getter returning `\"ok\"` once and the row the next time shipped the full row",
  "// (review, measured). Two losses to runtime-object tricks (`toJSON`, getters) are",
  "// why this is a snapshot and not a smarter walk: nothing author-reachable is ever",
  "// handed to the serializer. The snapshot follows JSON.stringify's own rules —",
  "// `undefined` / functions / Symbols are dropped from objects and become `null`",
  "// in arrays, boxed primitives unbox, a `Date` becomes its ISO string (through",
  "// the intrinsic captured at load, not a `toJSON` an author could replace), and a",
  "// cycle throws — so for plain data the serialized bytes are unchanged.",
  "const _scrml_date_toJSON = Date.prototype.toJSON;",
  "const _scrml_date_iso = Date.prototype.toISOString;",
  "const _scrml_num_valueOf = Number.prototype.valueOf;",
  "const _scrml_str_valueOf = String.prototype.valueOf;",
  "const _scrml_bool_valueOf = Boolean.prototype.valueOf;",
  "// Marks a position the serializer would OMIT (a function, a Symbol, an absent",
  "// value) — kept distinct from `null`, which it would write.",
  "const _SCRML_OMIT = Symbol(\"scrml.protect.omit\");",
  "function _scrml_protect_redact(value) {",
  "  const _r = _scrml_protect_snap(value, \"\", false, { seen: new Set(), stripped: new Map() });",
  "  return _r === _SCRML_OMIT ? null : _r;",
  "}",
  "// ⚑ S443 round 6e — the `this` an author function runs with. A `toJSON` or a",
  "// getter invoked with `this` = the ORIGINAL tagged row read the protected",
  "// column straight off it (`u.toJSON = function () { return { pw:",
  "// this.passwordHash } }` served the hash — review, measured; base served `{}`).",
  "// Every author function the snapshot invokes runs with `this` bound to a",
  "// STRIPPED COPY of its object instead: same prototype (methods still work),",
  "// every own data property copied with every marked column REMOVED, recursively,",
  "// accessors carried over (so a getter reached through `this` also runs on the",
  "// copy), no marker, no Symbol key. Building it invokes nothing — only property",
  "// descriptors are read — so the \"each property read once\" rule still holds.",
  "function _scrml_protect_stripped(value, ctx) {",
  "  if (value === null || typeof value !== \"object\") return value;",
  "  if (value instanceof Date) return value;",
  "  if (typeof Response !== \"undefined\" && value instanceof Response) return value;",
  "  const _hit = ctx.stripped.get(value);",
  "  if (_hit) return _hit;",
  "  const out = Array.isArray(value) ? [] : Object.create(Object.getPrototypeOf(value));",
  "  ctx.stripped.set(value, out);",
  "  const marked = _scrml_protect_marked(value);",
  "  const descs = Object.getOwnPropertyDescriptors(value);",
  "  for (const k of Object.keys(descs)) {",
  "    if (marked && marked.has(_scrml_protect_fold(k))) continue;",
  "    if (k === \"length\" && Array.isArray(out)) continue;",
  "    const d = descs[k];",
  "    if (\"value\" in d) d.value = _scrml_protect_stripped(d.value, ctx);",
  "    d.configurable = true;",
  "    Object.defineProperty(out, k, d);",
  "  }",
  "  return out;",
  "}",
  "function _scrml_protect_snap(value, _key, _noToJSON, ctx) {",
  "  if (value === null) return null;",
  "  const _t = typeof value;",
  "  if (_t === \"undefined\" || _t === \"function\" || _t === \"symbol\") return _SCRML_OMIT;",
  "  if (_t !== \"object\") return value;",
  "  // §14.8.9 fail-CLOSED on an opaque egress. A Response is a one-shot stream",
  "  // handle: the redactor cannot read its body, so it cannot prove a `protect=`",
  "  // column is absent from it. Refuse what the monitor cannot inspect.",
  "  //",
  "  // This branch used to `return value` — passing the Response through UNTOUCHED,",
  "  // which shipped whatever the author had already serialized into it. That was",
  "  // fail-OPEN: the one direction this floor exists to rule out.",
  "  //",
  "  // A THROW is the mechanism here (not a returned refusal) because this branch",
  "  // is reached from INSIDE the value walk — e.g. `return { receipt: aResponse }`",
  "  // — where there is no response slot to return.",
  "  //",
  "  // ⚠ WHICH SINKS GUARD AGAINST A TOP-LEVEL Response, STATED EXACTLY — THIS",
  "  // COMMENT HAS BEEN WRONG TWICE AND THE SECOND VERSION COST A WHOLE PAGE.",
  "  // Guarded, so a top-level Response is refused one level up and never reaches",
  "  // here: both server-fn arms, the §61 `<endpoint>` envelope, and (since the",
  "  // fix below) `/__mountHydrate`. NOT guarded: `/__serverLoad`, which is safe",
  "  // for a REASON rather than by luck — its `_scrml_rows` / `_scrml_result` /",
  "  // `_scrml_cv` are values the COMPILER built from a lowered `?{}`, so no author",
  "  // construction reaches it.",
  "  //",
  "  // ⛔ DO NOT EXTEND THAT REASON TO `/__mountHydrate`. A previous draft did, and",
  "  // it was false: `_scrml_mh_v<i>` are AUTHOR server-fn return values. MEASURED —",
  "  // a loader returning `Response.redirect(...)` compiled at exit 0 and this throw",
  "  // escaped the handler, losing the ENTIRE hydration payload including every",
  "  // unrelated cell, instead of the shaped 500 the guarded sinks return.",
  "  // The correctness of this file is carried by its comments; an over-claiming",
  "  // one is a defect in it.",
  "  // A `Response` with a NULL body carries no payload at all — there is nothing",
  "  // for a `protect=` column to hide in, so it is not an opaque egress and is",
  "  // returned untouched. `.body === null` is exact and NON-DESTRUCTIVE; anything",
  "  // that measured LENGTH would have to consume the stream and destroy it.",
  "  if (typeof Response !== \"undefined\" && value instanceof Response) {",
  "    // PROVENANCE first, shape second. A response the compiler built is already",
  "    // mediated — refusing it would refuse our own 400s and 403s. (Serialized as",
  "    // the serializer would: a Response has no own enumerable data.)",
  "    if (value[_SCRML_MEDIATED]) return {};",
  "    if (value.body === null) return {};",
  "    // TAGGED, not just thrown. A caller that catches this has to be able to tell",
  "    // a confidentiality refusal apart from an ordinary failure — the §37 SSE",
  "    // stream wrapper does exactly that, and without the tag its generic `catch`",
  "    // swallowed the refusal and ended the stream with a silent 200.",
  "    const _scrml_e = new Error(\"scrml §14.8.9: refusing to redact an opaque `Response` nested in a client-egress payload — the floor cannot inspect a Response body, so a `protect=` column cannot be proven absent. Return the value itself instead of a hand-built Response.\");",
  "    _scrml_e.__scrml_protect_opaque = true;",
  "    throw _scrml_e;",
  "  }",
  "  if (value instanceof Date && !Object.prototype.hasOwnProperty.call(value, \"toJSON\") && value.toJSON === _scrml_date_toJSON) {",
  "    return isFinite(value) ? _scrml_date_iso.call(value) : null;",
  "  }",
  "  // `toJSON` is invoked ONCE per position (S443 round 6c), with the key the",
  "  // serializer would pass, and its RESULT is snapshotted — never re-invoked.",
  "  const _toJSON = _noToJSON ? null : value.toJSON;",
  "  if (typeof _toJSON === \"function\") {",
  "    return _scrml_protect_snap(_toJSON.call(_scrml_protect_stripped(value, ctx), _key), _key, true, ctx);",
  "  }",
  "  if (value instanceof Number) return _scrml_num_valueOf.call(value);",
  "  if (value instanceof String) return _scrml_str_valueOf.call(value);",
  "  if (value instanceof Boolean) return _scrml_bool_valueOf.call(value);",
  "  const _s = ctx.seen;",
  "  if (_s.has(value)) throw new TypeError(\"scrml §14.8.9: cannot serialize a circular structure\");",
  "  _s.add(value);",
  "  // Own properties are read through their DESCRIPTORS: a data value as is, an",
  "  // accessor by calling its getter ONCE with `this` = the stripped copy.",
  "  const _read = (k) => {",
  "    const d = Object.getOwnPropertyDescriptor(value, k);",
  "    if (!d) return value[k];",
  "    if (\"value\" in d) return d.value;",
  "    return typeof d.get === \"function\" ? d.get.call(_scrml_protect_stripped(value, ctx)) : _SCRML_OMIT;",
  "  };",
  "  let out;",
  "  if (Array.isArray(value)) {",
  "    out = [];",
  "    const _n = value.length;",
  "    for (let i = 0; i < _n; i++) {",
  "      const _r = _scrml_protect_snap(_read(String(i)), String(i), false, ctx);",
  "      out.push(_r === _SCRML_OMIT ? null : _r);",
  "    }",
  "  } else {",
  "    const marked = _scrml_protect_marked(value);",
  "    out = {};",
  "    for (const k of Object.keys(value)) {",
  "      if (marked && marked.has(_scrml_protect_fold(k))) continue;",
  "      const _r = _scrml_protect_snap(_read(k), k, false, ctx);",
  "      if (_r !== _SCRML_OMIT) out[k] = _r;",
  "    }",
  "  }",
  "  _s.delete(value);",
  "  return out;",
  "}",
  "",
].join("\n");

/**
 * Build the `_scrml_protect_tag(<inner>, <cols>)` wrap for a lowered SQL result
 * expression `inner`. `cols` is serialized as a JS array literal of output
 * column names, or the `"*"` strip-all sentinel.
 */
export function wrapWithProtectTag(inner: string, resolved: ProtectedColumns): string {
  if (resolved === null) return inner;
  const colsArg = "all" in resolved ? '"*"' : JSON.stringify(resolved.cols);
  return `_scrml_protect_tag(${inner}, ${colsArg})`;
}

/**
 * Every `.reveal("col")` in `fnSource` whose argument is a STRING LITERAL, as a
 * set of the column names named.
 *
 * A `.reveal(x)` with a computed argument names no column this scanner can read
 * and therefore discharges NOTHING — it simply does not join the set, which is
 * already the fail-CLOSED outcome. An earlier draft also returned a `dynamic`
 * flag "so the caller can decide"; no caller ever read it, and a returned value
 * nobody consumes is a claim the code does not actually make. Removed rather
 * than left as decoration.
 */
function revealedColumnsIn(fnSource: string): Set<string> {
  const named = new Set<string>();
  // `.reveal(` + a single argument, captured up to the closing paren.
  const revealRe = /\.\s*reveal\s*\(([^)]*)\)/g;
  let r: RegExpExecArray | null;
  while ((r = revealRe.exec(fnSource)) !== null) {
    const arg = r[1].trim();
    const lit = /^(["'`])([^"'`]*)\1$/.exec(arg);
    if (lit) named.add(foldIdent(lit[2])); // reveal names compare case-insensitively (SQL identifiers)
  }
  return named;
}

/**
 * §14.8.9 fail-closed gate (E-PROTECT-004) — a protected-origin value reaching a
 * RAW / compiler-UNANALYZABLE egress within a single server-function body.
 *
 * ⚑ **THIS IS A CONSERVATIVE LINT OVER THE §14.8.9 DERIVED-FLOW BOUNDARY. IT IS
 * NOT, AND MUST NOT BE DESCRIBED AS, A CONFIDENTIALITY GUARANTEE.** It is a
 * source-text co-occurrence test scoped to ONE function body, so ordinary
 * function extraction defeats it: the same code with the query in a helper and
 * the raw egress in the caller does not fire. That limitation is INHERENT to a
 * source-text predicate and cannot be repaired by recognizing more spellings —
 * a completeness fix on this mechanism has no done-condition. The guarantees on
 * this surface live elsewhere:
 *   - the RUNTIME floor `_scrml_protect_redact`, which reads the actual
 *     descriptor on the actual value at the actual sink (exact, no spelling
 *     problem), and now REFUSES an opaque `Response` rather than passing it; and
 *   - the emission-time `E-PROTECT-005` gate (`findAuthoredResponseConstruction`
 *     below), which refuses to emit a mediated envelope around an
 *     author-constructed `Response` at all on a `protect=` path.
 *
 * Kinds detected — TWO, and the list SHRANK on purpose (S405, arc A item A3):
 *   - a `_{}` foreign-code block (§23) — opaque interior;
 *   - an `asIs`-typed value (§14.1.1) — escapes the type system.
 *
 * ⛔ The `Response` limb was DELETED here, not weakened. It was the one limb
 * whose source-text co-occurrence stood in for a REAL structural fact — that the
 * compiler-owned envelope is fail-open on a `Response` — and that fact is now
 * enforced where it lives: `E-PROTECT-005` at emission, and the runtime refusal
 * at the sink. Keeping a strictly-weaker duplicate of a check that is now made
 * structurally would be keeping the "lint that reads as a guarantee". Do NOT
 * re-add it.
 *
 * Returns the offending query + egress kind (→ E-PROTECT-004), or null.
 *
 * SUPPRESSION IS COLUMN-KEYED, NOT EXISTENCE-KEYED (S405, arc A item A4). A
 * `reveal("col")` discharges the gate only when the offending query's protected
 * OUTPUT columns are ALL named by a reveal in this body. Previously ANY
 * `.reveal(` anywhere in the body disarmed the gate for EVERY protected column
 * in it, so `reveal("email")` silently declassified `passwordHash` — measured.
 * A `{ all: true }` strip-all query (unresolvable SQL) can never be discharged
 * by named reveals: its protected column set is unknown, so no finite list of
 * names covers it. A `.reveal(<non-literal>)` names no readable column and
 * discharges nothing.
 */
export function detectProtectedRawEgress(
  fnSource: string,
  ctx: ProtectContext,
): { query: string; egressKind: string; undischarged: string[] | "*" } | null {
  if (!fnSource) return null;
  // Is a protected-origin `?{}` SELECT present in this body whose protected
  // output columns are NOT all reveal-declassified?
  const revealed = revealedColumnsIn(fnSource);
  let protectedQuery: string | null = null;
  // The columns the author must ACTUALLY name to discharge this. Carried out to
  // the diagnostic because these are the ALIAS-RESOLVED OUTPUT names, which the
  // author cannot always read off their own SQL: `SELECT passwordHash AS h`
  // needs `reveal("h")`, not `reveal("passwordHash")`. A message that says
  // "declassify every protected column" without naming them sends the adopter
  // to guess at the one thing the compiler has already computed.
  let undischarged: string[] | "*" = [];
  const sqlRe = /\?\{`([^`]*)`\}/g;
  let m: RegExpExecArray | null;
  while ((m = sqlRe.exec(fnSource)) !== null) {
    const resolved = resolveProtectedOutputColumns(m[1], ctx);
    if (resolved === null) continue;
    // Strip-all (unresolvable SQL): the protected column set is unknown, so no
    // finite set of `reveal("col")` names can discharge it. Fail closed.
    if ("all" in resolved) {
      undischarged = "*";
    } else {
      const missing = resolved.cols.filter((c) => !revealed.has(foldIdent(c)));
      if (missing.length === 0) continue;
      undischarged = missing;
    }
    protectedQuery = m[1].trim().replace(/\s+/g, " ").slice(0, 60);
    break;
  }
  if (!protectedQuery) return null;
  // Is there a raw / unredactable egress in the same body?
  //
  // ⚑ `_=*\{` — `_` then ZERO OR MORE `=` then `{`, which is SPEC §23.2's own
  // normative opener rule verbatim ("`_` followed by zero or more `=` followed
  // by `{`"), and the pattern `ast-builder.js:18392` already uses. It was
  // `_\{` — LEVEL 0 ONLY — until S405, and that is the one level §23.2 tells
  // authors NOT to write: `W-FOREIGN-001` fires on a level-0 `_{` and
  // recommends `_={}=`. So this limb recognized exactly the spelling the
  // compiler steers authors away from and missed every recommended one.
  // REPRODUCED at `8fa6854d`: `let w = _={ JSON.stringify(v) }=` in a
  // `protect=` body compiled at exit 0 with NO diagnostic and shipped
  // `passwordHash` in full — the foreign block returns a plain string, which
  // carries no descriptor, so the redact at the sink is a no-op on it.
  let egressKind: string | null = null;
  if (/(^|[^A-Za-z0-9_$])_=*\{/.test(fnSource)) {
    egressKind = "a `_{}` foreign-code block (§23)";
  } else if (/\basIs\b/.test(fnSource)) {
    egressKind = "an `asIs`-typed value (§14.1.1)";
  }
  if (!egressKind) return null;
  return { query: protectedQuery, egressKind, undischarged };
}

// ---------------------------------------------------------------------------
// E-PROTECT-005 — the author-constructed `Response` gate (§14.8.9, S405 item A2)
// ---------------------------------------------------------------------------

/**
 * The COMPLETE set of `Response` STATIC members that PRODUCE a `Response`, per
 * the WHATWG Fetch Standard's `Response` interface — `error` · `redirect` ·
 * `json` — plus the `new Response(...)` constructor, matched separately. There
 * is no fourth static producer to add later.
 *
 * ⚑ **THE FULL SET IS LISTED HERE AND ONLY A SUBSET IS GATED. THAT SPLIT IS THE
 * POINT — DO NOT COLLAPSE THIS TO A TWO-MEMBER LIST.** Keeping all four visible,
 * each with its reason, is what stops the next reader from wondering whether the
 * list is truncated (and "re-completing" it back into the S405 defect below).
 */
const RESPONSE_STATIC_PRODUCERS = ["error", "redirect", "json"] as const;
type ResponseStaticProducer = (typeof RESPONSE_STATIC_PRODUCERS)[number];

/**
 * Of those, the ones that can carry a BODY — the only property `E-PROTECT-005`
 * is entitled to care about.
 *
 * ⛔ **`redirect` AND `error` ARE EXCLUDED BECAUSE THE STANDARD GIVES THEM A NULL
 * BODY, NOT AS A CONVENIENCE.** `Response.redirect()` produces a response whose
 * body is null (a status plus a `Location` header); `Response.error()` produces
 * a network-error response with a null body and immutable headers. There is no
 * stream for the floor to fail to inspect, so `E-PROTECT-005`'s own rationale —
 * "an opaque stream the compiler cannot read" — does not hold for them, and its
 * stated resolution ("return the VALUE; the compiler serializes and redacts it")
 * **cannot produce a 302 at all.**
 *
 * ⚑ **S405 FIX-ROUND DEFECT, REPRODUCED: gating them build-broke a shape with NO
 * workaround.** A `protect=` app whose server fn did `SELECT id, name` (the
 * protected column projected OUT) and then `return Response.redirect("/home", 302)`
 * compiled clean at base and hard-failed on the first landing — and because this
 * gate deliberately has no escape hatch, that app could not issue a redirect from
 * a server fn or an `<endpoint>` arm AT ALL. `Response.json` stays gated: it
 * always serializes its argument into a body.
 *
 * The line this draws is the adopter-facing contract, and it is worth stating
 * plainly: **a `protect=` app keeps full control of STATUS and HEADERS; what it
 * gives up is authoring the BODY.** That is a coherent restriction rather than a
 * blanket ban, and it is the one the §14.8.9 floor actually needs.
 */
const RESPONSE_BODY_CARRYING_PRODUCERS: ReadonlySet<ResponseStaticProducer> = new Set(["json"]);

/**
 * The null-body STATICS — the two the RUNTIME guard cannot recognize.
 *
 * ⚑ **THIS SET EXISTS BECAUSE THE COMPILE-TIME AND RUN-TIME LIMBS CAN SEE
 * DIFFERENT THINGS, AND PRETENDING OTHERWISE IS HOW THE FIRST LANDING BROKE
 * REDIRECTS TWICE — once at build time, then again at request time.** Measured
 * on Bun 1.3.14:
 *
 *   `new Response()` / `new Response(null, …)`  ->  `.body === null`  RUNTIME-VISIBLE
 *   `Response.redirect(url, 302)`               ->  `.body` is a 0-byte ReadableStream
 *   `Response.error()`                          ->  `.body` is a 0-byte ReadableStream
 *   `new Response("s3cret", {status:302, headers:{Location:"/h"}})`
 *                                               ->  `.body` is a ReadableStream
 *
 * The last line is the adversarial case and it is why NO runtime heuristic is
 * admissible: a secret-carrying `Response` can be made to present exactly like a
 * redirect — same `location` header, same absent `content-length`, same `.body`
 * shape. Measuring the byte length means CONSUMING the stream, which destroys
 * the response. So the runtime guard can soundly pass through ONLY
 * `.body === null`, and these two fall outside it.
 *
 * They therefore COMPILE (firing `E-PROTECT-005` on them is wrong on that
 * diagnostic's own rationale) but the runtime floor still refuses them.
 * Reporting that at BUILD time as `W-PROTECT-005` is the whole point of this
 * set: the alternative is a shape that compiles clean and then 500s on the first
 * request, which is a worse defect than the build break it replaced.
 */
const RESPONSE_NULL_BODY_STATICS: ReadonlySet<ResponseStaticProducer> = new Set(
  // DERIVED, never re-listed. The two live sets PARTITION the producer set, and
  // deriving this half is what makes the split self-checking: add a member to
  // `RESPONSE_STATIC_PRODUCERS` and it lands here until someone classifies it as
  // body-carrying, so a new producer defaults to the SAFE side (warned, not
  // silently unrecognized). Re-listing `["redirect","error"]` by hand would let
  // the three lists drift, which is exactly the drift that made the parent set
  // "documentation wearing a const" — declared, asserted to be load-bearing, and
  // read by nothing.
  RESPONSE_STATIC_PRODUCERS.filter((m) => !RESPONSE_BODY_CARRYING_PRODUCERS.has(m)),
);

// The partition must be TOTAL and DISJOINT, and this is checked at module load
// rather than asserted in a comment — the whole point of deriving one half.
if (RESPONSE_BODY_CARRYING_PRODUCERS.size + RESPONSE_NULL_BODY_STATICS.size !== RESPONSE_STATIC_PRODUCERS.length) {
  throw new Error(
    "protect-egress: the Response static-producer partition is not total — " +
    `${RESPONSE_BODY_CARRYING_PRODUCERS.size} body-carrying + ${RESPONSE_NULL_BODY_STATICS.size} null-body ` +
    `!= ${RESPONSE_STATIC_PRODUCERS.length} producers. Every producer must be classified as one or the other.`,
  );
}

/** What kind of `Response` construction a scan found, if any. */
export type AuthoredResponseKind =
  /** Carries an author-supplied body the floor cannot inspect -> E-PROTECT-005 (error). */
  | "body"
  /** Provably payload-free, but invisible to the runtime guard -> W-PROTECT-005 (warning). */
  | "null-body-static";

/**
 * Does this `new Response(...)` provably have a NULL body?
 *
 * True for `new Response()` (no arguments) and `new Response(null, …)` — the
 * long-hand spellings of "status/headers only", e.g. a 204 or a hand-rolled 302.
 * The body is argument 0, so this is a purely SYNTACTIC, compile-time-constant
 * test on that one argument — the same class of check as `staticStringKey`, NOT
 * a value-flow analysis. Anything else (an identifier, a call, a template) is
 * treated as a body: proving THOSE null is the permanently-dead analysis.
 */
function isProvablyNullBodyResponse(node: any): boolean {
  const args = Array.isArray(node?.arguments) ? node.arguments : [];
  if (args.length === 0) return true;
  const a0 = args[0];
  return !!a0 && a0.type === "Literal" && a0.value === null;
}

const RESPONSE_SCAN_PARSE_OPTIONS = { ecmaVersion: 2022 as const, sourceType: "module" as const };

/**
 * Which SYNTACTIC CATEGORY a slice handed to the scanner belongs to.
 *
 * ⚑ **THIS PARAMETER IS REQUIRED, AND ITS EXISTENCE IS THE FIX FOR A ROOT CAUSE
 * THAT PRODUCED TWO SEPARATE SILENT HOLES ONE REVIEW ROUND APART.**
 *
 * The scanner cannot parse a bare slice without deciding how to frame it, and it
 * used to GUESS — one wrapper for everything, widened reactively each time a
 * shape failed to parse:
 *
 *   round 1  the wrapper was `async function`, so a §37 generator body's
 *            top-level `yield` did not parse -> `catch` -> null -> `yield new
 *            Response(...)` under `protect=` compiled clean. "Fixed" by adding `*`.
 *   round 2  the same wrapper framed an `<endpoint>` arm's EXPRESSION as a
 *            STATEMENT, so `{ ok: true, r: Response.json({a:1}) }` parsed as a
 *            labeled block and threw -> null. MEASURED: multi-key object arms —
 *            the canonical `<endpoint>` shape — were entirely unscanned, while a
 *            single-key `{ r: new Response(x) }` happened to parse as a label and
 *            WAS scanned. A blind spot that looked like coverage.
 *
 * Both are the same root: **the wrapper grammar was not derived from the shapes
 * it must admit.** Adding a construct each time a hole is found has no
 * done-condition — it is the same unbounded-completeness mistake this whole arc
 * exists to refuse, wearing a parser.
 *
 * The repair is to stop guessing. Every CALL SITE knows statically which
 * category it is passing, so the caller declares it and the compiler enforces
 * that a new call site cannot forget to. **That converts an open question ("did I
 * enumerate every construct that might appear?") into a closed one ("did each of
 * the five call sites pass the right category?").**
 */
export type ScanSliceKind =
  /** A statement list: a server-fn body, a peer callable, a §37 generator body. */
  | "statements"
  /** ONE value-expression: a §61 `<endpoint>` arm's lowered arm value. */
  | "expression";

/**
 * Frame a slice for parsing, per its declared category.
 *
 * **HOW I KNOW EACH WRAPPER IS COMPLETE FOR ITS CATEGORY — the argument, not a list:**
 *
 *   `"statements"` -> the body of an **async generator**. That is the MAXIMAL
 *      statement context in JavaScript: `async` admits `await` (and `for await`),
 *      `function` admits `return`, `*` admits `yield` / `yield*`, and every other
 *      statement form is legal in any function body. There is no statement legal
 *      in a server-fn body that is illegal here, so the set is complete by
 *      CONSTRUCTION rather than by enumeration.
 *   `"expression"` -> the same context, with the slice **parenthesized**. Inside
 *      parentheses the expression grammar is unambiguous and maximal: an object
 *      literal is an object literal (not a labeled block — the round-2 bug), and
 *      `await` is still legal because the enclosing function is async. Every
 *      expression is legal in parentheses, so again complete by construction.
 *
 * The residual risk is no longer "which constructs?" — it is "did a call site
 * declare the wrong category?", which is five sites and a required parameter.
 */
function probeSource(loweredJs: string, sliceKind: ScanSliceKind): string {
  const inner = sliceKind === "expression" ? `(\n${loweredJs}\n);` : loweredJs;
  return `async function* _scrml_response_scan_probe() {\n${inner}\n}`;
}

/**
 * If `node` is a compile-time-constant STRING key, return its value; else null.
 * Same shape as `egress-field-scan.ts`'s helper of the same name, for the same
 * reason: `Response["json"]` names the same static member as `Response.json`.
 */
function staticStringKey(node: any): string | null {
  if (!node || typeof node !== "object") return null;
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (
    node.type === "TemplateLiteral" &&
    Array.isArray(node.expressions) && node.expressions.length === 0 &&
    Array.isArray(node.quasis) && node.quasis.length === 1
  ) {
    const cooked = node.quasis[0]?.value?.cooked;
    if (typeof cooked === "string") return cooked;
  }
  return null;
}

/**
 * Find an author-constructed `Response` in a slice of ALREADY-LOWERED server JS,
 * in CODE POSITION, using acorn — never a text match. Built on the
 * `egress-field-scan.ts` template (iterative walk, no acorn-walk dependency) and
 * for the same reason: a text predicate cannot tell `new Response(...)` in code
 * from the same characters inside a string literal or a comment, and this gate
 * is a HARD ERROR, so a false fire breaks a build.
 *
 * ⚑ **IT CLASSIFIES BY WHETHER A BODY IS CARRIED — it does not simply "find a
 * `Response`".** The §14.8.9 obligation is about a payload the floor cannot
 * inspect, so a construction with no body cannot violate it and MUST NOT be an
 * error (S405 fix round: gating the null-body ones build-broke every `protect=`
 * app that issues a redirect, with no workaround, because this gate has no
 * escape hatch):
 *
 *   "body"             · `new Response(<body>, …)`      — body is argument 0
 *                      · `Response.json(<data>, …)`     — always serializes a body
 *                      · the computed spelling `Response["json"](…)`
 *   "null-body-static" · `Response.redirect(url, code)` — no body, but the runtime
 *                      · `Response.error()`               guard cannot see that
 *   null (silent)      · `new Response()` / `new Response(null, …)` — no body AND
 *                        runtime-recognizable via `.body === null`
 *
 * ⚑ **NOT RECOGNIZED, BY CONSTRUCTION — AND THIS BOUNDARY IS THE POINT, NOT A
 * TODO.** A `Response` reached by ALIASING (`const R = Response; new R()`), by
 * `await fetch(...)`, by `.clone()`, or returned from any callee this slice does
 * not contain, is invisible to ANY syntactic scan. Chasing those spellings is
 * the unbounded completeness fix with no done-condition. **This gate is an
 * EARLY WARNING that fires at build time on the shapes an author actually
 * writes; the GUARANTEE is the runtime refusal in `_scrml_protect_redact` and
 * the compiler-emitted `_scrml_protect_opaque_refusal()` guard at the sink,
 * which are exact because `instanceof Response` is exact.** Do not "complete"
 * this list — completing it is not possible and believing it is complete is the
 * failure this whole arc exists to remove.
 *
 * Fail direction: a slice acorn cannot parse returns `null` (no fire). That is
 * deliberately fail-OPEN *for the warning* and it is only defensible because the
 * warning is not the guarantee: the runtime refusal still holds. The alternative
 * — firing a confidentiality build-break because the compiler's own emitted
 * slice failed to parse — trades a real false-positive class for no security.
 *
 * @param loweredJs a slice of emitted server JS.
 * @param sliceKind which SYNTACTIC CATEGORY that slice is — see `ScanSliceKind`.
 *        REQUIRED, and required on purpose: see the ⚑ note on that type.
 * @returns the recognized spelling + kind (for the diagnostic), or null.
 */
export function findAuthoredResponseConstruction(
  loweredJs: string,
  sliceKind: ScanSliceKind,
): { spelling: string; kind: AuthoredResponseKind } | null {
  if (!loweredJs || !/\bResponse\b/.test(loweredJs)) return null;
  // A body-carrying construction OUTRANKS a null-body one: a body is an error, a
  // null-body static is only a warning, and a body found anywhere in this slice
  // is the verdict regardless of what else the slice contains or of the order
  // the walk happens to visit them in.
  let nullBodyHit: { spelling: string; kind: AuthoredResponseKind } | null = null;
  let root: any;
  try {
    root = acorn.parse(probeSource(loweredJs, sliceKind), RESPONSE_SCAN_PARSE_OPTIONS);
  } catch {
    // ⚑ REACHING HERE IS NOW A COMPILER-DEFECT SIGNAL, NOT AN EXPECTED PATH.
    // With the slice kind declared by the caller, both wrappers admit the FULL
    // grammar of their category (see `probeSource`), and the emitted JS is valid
    // by construction — so an unparseable slice means the emitter produced
    // invalid JS or a call site declared the wrong kind. It still returns null
    // (fail-open FOR THE WARNING ONLY, defensible solely because the runtime
    // refusal is the guarantee); firing a confidentiality build-break on a
    // compiler defect would trade a real false-positive class for no security.
    return null;
  }
  const stack: any[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    if (Array.isArray(node)) {
      for (const child of node) stack.push(child);
      continue;
    }
    if (typeof node.type === "string") {
      if (
        node.type === "NewExpression" &&
        node.callee && node.callee.type === "Identifier" && node.callee.name === "Response"
      ) {
        // `new Response()` / `new Response(null, …)` is reported at NEITHER level:
        // it carries no body (so not an error) AND the runtime guard recognizes it
        // exactly via `.body === null` (so not a warning either). It just works.
        if (!isProvablyNullBodyResponse(node)) return { spelling: "new Response(...)", kind: "body" };
      }
      if (node.type === "CallExpression" && node.callee && node.callee.type === "MemberExpression") {
        const callee = node.callee;
        if (callee.object && callee.object.type === "Identifier" && callee.object.name === "Response") {
          const member = callee.computed
            ? staticStringKey(callee.property)
            : (callee.property && callee.property.type === "Identifier" ? callee.property.name : null);
          // NOTE the set: BODY-CARRYING, not the full producer set. `redirect`
          // and `error` are producers with a null body and must not be an ERROR —
          // see RESPONSE_BODY_CARRYING_PRODUCERS / RESPONSE_NULL_BODY_STATICS.
          if (member !== null && RESPONSE_BODY_CARRYING_PRODUCERS.has(member)) {
            return { spelling: `Response.${member}(...)`, kind: "body" };
          }
          if (member !== null && RESPONSE_NULL_BODY_STATICS.has(member) && !nullBodyHit) {
            nullBodyHit = { spelling: `Response.${member}(...)`, kind: "null-body-static" };
          }
        }
      }
    }
    for (const k in node) {
      if (k === "type" || k === "start" || k === "end" || k === "loc" || k === "range") continue;
      const v = node[k];
      if (v && typeof v === "object") stack.push(v);
    }
  }
  return nullBodyHit;
}
