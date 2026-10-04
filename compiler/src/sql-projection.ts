/**
 * SELECT-projection extraction (SPEC §14.8.7, §8.3).
 *
 * Given the raw `query` text of a `?{ ... }` SQL context, extract the projected
 * columns so the TS stage (Stage 6) can synthesize a typed projection row from
 * the §14.8 generated table types. This is the read-site half of the
 * "typed SQL projection rows" feature (Tranche 1).
 *
 * SCOPE — this is NOT a general SQL parser. It resolves the v1 SQL surface the
 * type-system can statically type:
 *   - explicit column lists:           SELECT a, b, c
 *   - qualified columns:               SELECT l.id, c.name
 *   - AS aliases:                      SELECT c.name AS customer_name
 *   - a FROM / JOIN table-alias map:   FROM loads l LEFT JOIN customers c
 *
 * Everything the extractor cannot resolve degrades gracefully (the caller types
 * the offending column — or the whole row — as `asIs` and emits an info-level
 * W-SQL-ROW-UNTYPED lint). The long tail (CTE / UNION / subquery-in-FROM /
 * window functions / expression columns) is explicitly deferred per the ratified
 * v1 SQL surface — NEVER break compilation.
 */

// ---------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------

/** One projected output column. */
export interface ProjectedColumn {
  /** Output field name (the alias if `AS` is present, else the bare column name). */
  outputName: string;
  /**
   * Resolution against the FROM/JOIN alias map:
   *   - kind "column": resolves to `table`.`column` (a generated table type's field).
   *   - kind "star":   `SELECT *` — single-table expand (table set) or ambiguous.
   *   - kind "opaque": a computed / expression / function-call column. Types `asIs`.
   */
  kind: "column" | "star" | "opaque";
  /** Resolved source table name (FROM/JOIN), present for kind "column"/"star". */
  table?: string;
  /** Source column name on the resolved table, present for kind "column". */
  column?: string;
  /** The raw projection text (for diagnostics). */
  raw: string;
}

/** The extracted SELECT projection. */
export interface SelectProjection {
  /**
   * Whether the query is a typeable single SELECT the extractor handled.
   * `false` means the caller must degrade the WHOLE row to `asIs` (CTE / UNION /
   * subquery-in-FROM / not-a-SELECT / unparseable FROM).
   */
  resolvable: boolean;
  /** Reason the whole query was deemed unresolvable (for the info lint). */
  unresolvableReason?: string;
  /** Projected columns (only meaningful when `resolvable`). */
  columns: ProjectedColumn[];
  /** Alias -> table-name map from FROM / JOIN (e.g. `l` -> `loads`). */
  aliasMap: Map<string, string>;
  /** All FROM/JOIN base table names, in source order (for unqualified-column resolution). */
  fromTables: string[];
}

// ---------------------------------------------------------------------------
// Tokens / keywords
// ---------------------------------------------------------------------------

const UNTYPEABLE_LEADERS = ["WITH", "INSERT", "UPDATE", "DELETE", "CREATE", "ALTER", "DROP", "PRAGMA", "BEGIN", "COMMIT", "ROLLBACK", "REPLACE", "VALUES"];

/**
 * Strip the bound-parameter interpolations (`${...}`) and SQL comments from the
 * query so the lightweight scanners below see a stable shape. `${expr}` is
 * replaced with a single space (it only ever appears in WHERE / value position
 * in the v1 surface, never inside the projection or FROM list we parse).
 */
function normalizeQuery(query: string): string {
  return normalizeSqlText(query);
}

/**
 * THE one SQL-text normalizer every text check shares (§14.8.10 S452 r2 — the
 * tenant floor's checks run on exactly this text; a second copy is how a comment
 * once hid a subquery from one check while another saw it).
 *
 * A single left-to-right scan, so each construct is recognized only where it
 * really starts:
 *   - `${ … }` bound-parameter interpolations (brace-balanced) → one space;
 *   - `-- …` line comments and `/* … *\/` block comments → one space;
 *   - a `'…'` string literal (with `''` escapes) keeps its quotes and its length
 *     but its content becomes `_` — a literal is DATA, so nothing inside it (a
 *     `--`, a `(SELECT`, a table name) can be read as SQL;
 *   - `"…"`, `` `…` `` and `[…]` quoted identifiers are copied through unchanged;
 *   - whitespace runs collapse to one space.
 */
export function normalizeSqlText(query: string): string {
  const src = typeof query === "string" ? query : "";
  let out = "";
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === "$" && next === "{") {
      let depth = 1;
      let j = i + 2;
      while (j < src.length && depth > 0) {
        if (src[j] === "{") depth++;
        else if (src[j] === "}") depth--;
        j++;
      }
      out += " ";
      i = j;
      continue;
    }
    if (ch === "-" && next === "-") {
      const nl = src.indexOf("\n", i);
      out += " ";
      i = nl === -1 ? src.length : nl + 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = src.indexOf("*/", i + 2);
      out += " ";
      i = end === -1 ? src.length : end + 2;
      continue;
    }
    if (ch === "'") {
      let j = i + 1;
      let body = "";
      while (j < src.length) {
        if (src[j] === "'" && src[j + 1] === "'") { body += "__"; j += 2; continue; }
        if (src[j] === "'") break;
        body += "_";
        j++;
      }
      out += "'" + body + "'";
      i = j + 1;
      continue;
    }
    if (ch === '"' || ch === "`" || ch === "[") {
      const close = ch === "[" ? "]" : ch;
      const end = src.indexOf(close, i + 1);
      const stop = end === -1 ? src.length : end + 1;
      out += src.slice(i, stop);
      i = stop;
      continue;
    }
    out += ch;
    i++;
  }
  return out.replace(/\s+/g, " ").trim();
}

/**
 * Split a comma-separated list at top level (depth 0) — does not split on commas
 * inside `(...)` (e.g. a `COUNT(a, b)` function call or a subquery).
 */
function splitTopLevelCommas(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim().length > 0) parts.push(cur);
  return parts;
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

// ---------------------------------------------------------------------------
// FROM / JOIN alias map
// ---------------------------------------------------------------------------

/**
 * Parse the FROM/JOIN clause into an alias->table map plus the ordered base
 * table list. Returns null when the FROM clause contains a subquery
 * (`FROM (SELECT ...)`) or is otherwise not a flat table reference — the caller
 * degrades the whole row.
 *
 * Recognized table reference forms (case-insensitive keywords):
 *   FROM loads l
 *   FROM loads AS l
 *   FROM loads                 (alias = table name)
 *   ... LEFT JOIN customers c ON ...
 *   ... INNER JOIN x AS y ON ...
 */
function parseFromClause(
  region: string,
): { aliasMap: Map<string, string>; fromTables: string[] } | null {
  const aliasMap = new Map<string, string>();
  const fromTables: string[] = [];

  region = region.trim();
  if (region.length === 0) return { aliasMap, fromTables }; // No FROM (e.g. `SELECT 1`).

  // Subquery in FROM — cannot resolve.
  if (region.includes("(")) return null;

  // Split the FROM region into table-reference segments at JOIN boundaries.
  // We normalize all JOIN flavors (LEFT/RIGHT/INNER/OUTER/CROSS/FULL/NATURAL +
  // bare JOIN) to a single delimiter, and drop ON/USING predicates.
  // First, cut each segment's trailing `ON ...` / `USING (...)` predicate.
  const joinSplit = region.split(/\b(?:LEFT|RIGHT|INNER|OUTER|CROSS|FULL|NATURAL)?\s*JOIN\b/i);
  // The very first segment may carry comma-separated tables (old-style join);
  // subsequent segments are single table refs.
  const segments: string[] = [];
  const firstParts = splitTopLevelCommas(joinSplit[0]);
  for (const p of firstParts) segments.push(p);
  for (let i = 1; i < joinSplit.length; i++) segments.push(joinSplit[i]);

  for (let seg of segments) {
    // Drop the join predicate: everything from ` ON ` / ` USING ` onward.
    const onIdx = /\b(ON|USING)\b/i.exec(seg);
    if (onIdx) seg = seg.slice(0, onIdx.index);
    seg = seg.trim();
    if (seg.length === 0) continue;

    // Tokenize: `table`, `table alias`, `table AS alias`.
    const toks = seg.split(/\s+/).filter(Boolean);
    if (toks.length === 0) continue;

    const tableTok = toks[0];
    if (!IDENT.test(tableTok)) return null; // Unexpected shape — degrade whole row.
    const table = tableTok;
    fromTables.push(table);

    let alias = table;
    if (toks.length === 2 && IDENT.test(toks[1])) {
      alias = toks[1];
    } else if (toks.length === 3 && /^AS$/i.test(toks[1]) && IDENT.test(toks[2])) {
      alias = toks[2];
    } else if (toks.length > 1) {
      // Unrecognized trailing tokens on a table ref — degrade whole row.
      return null;
    }
    aliasMap.set(alias, table);
    // A table with no explicit alias is also addressable by its own name.
    if (!aliasMap.has(table)) aliasMap.set(table, table);
  }

  return { aliasMap, fromTables };
}

// ---------------------------------------------------------------------------
// Projection list
// ---------------------------------------------------------------------------

/**
 * Resolve one projection-list entry into a ProjectedColumn.
 *
 * `aliasMap` maps FROM/JOIN aliases (and bare table names) to table names.
 * `fromTables` is the ordered base-table list (for unqualified-column lookup,
 * which is only unambiguous when there is exactly one FROM table).
 */
function resolveProjectionEntry(
  rawEntry: string,
  aliasMap: Map<string, string>,
  fromTables: string[],
): ProjectedColumn {
  const raw = rawEntry.trim();

  // `AS alias` — split off an explicit alias first (case-insensitive ` AS `).
  let body = raw;
  let alias: string | null = null;
  const asMatch = /\s+AS\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/i.exec(body);
  if (asMatch) {
    alias = asMatch[1];
    body = body.slice(0, asMatch.index).trim();
  } else {
    // Implicit alias: `expr identifier` where expr is a bare/qualified column
    // and the trailing token is a plain identifier (e.g. `c.name customer_name`).
    // Only treat as an alias when the leading part is itself a column reference;
    // an expression with a trailing word is opaque and handled below.
    const implicitMatch = /^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?)\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(body);
    if (implicitMatch) {
      alias = implicitMatch[2];
      body = implicitMatch[1];
    }
  }

  // `*` — star projection.
  if (body === "*") {
    return { outputName: "*", kind: "star", raw };
  }
  // `alias.*` / `table.*` — qualified star.
  const qStar = /^([A-Za-z_][A-Za-z0-9_]*)\.\*$/.exec(body);
  if (qStar) {
    const tbl = aliasMap.get(qStar[1]);
    if (tbl) return { outputName: "*", kind: "star", table: tbl, raw };
    return { outputName: "*", kind: "star", raw };
  }

  // Qualified column: `alias.column`.
  const qualified = /^([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(body);
  if (qualified) {
    const tableAlias = qualified[1];
    const column = qualified[2];
    const table = aliasMap.get(tableAlias);
    if (table) {
      return { outputName: alias ?? column, kind: "column", table, column, raw };
    }
    // Unknown alias — cannot resolve this column; opaque.
    return { outputName: alias ?? column, kind: "opaque", raw };
  }

  // Bare column: `column`.
  if (IDENT.test(body)) {
    // Resolvable only when exactly one FROM table (otherwise ambiguous).
    if (fromTables.length === 1) {
      return { outputName: alias ?? body, kind: "column", table: fromTables[0], column: body, raw };
    }
    // Ambiguous / no FROM — opaque.
    return { outputName: alias ?? body, kind: "opaque", raw };
  }

  // Anything else (function call, arithmetic, subquery, CASE, literal) is an
  // expression column — types `asIs`. The output name is the alias if present,
  // else a synthesized placeholder.
  return { outputName: alias ?? `_expr${body.length}`, kind: "opaque", raw };
}

// ---------------------------------------------------------------------------
// Top-level extractor
// ---------------------------------------------------------------------------

/**
 * Extract the SELECT projection from a `?{ ... }` query string.
 *
 * Returns `{ resolvable: false, unresolvableReason }` for any query the
 * extractor will not type as a struct row (non-SELECT, CTE/WITH, UNION,
 * subquery-in-FROM, unparseable FROM/projection). The caller degrades the whole
 * row to `asIs` in that case.
 */
export function extractSelectProjection(query: string): SelectProjection {
  const empty: SelectProjection = {
    resolvable: false,
    columns: [],
    aliasMap: new Map(),
    fromTables: [],
  };

  if (typeof query !== "string" || query.trim().length === 0) {
    return { ...empty, unresolvableReason: "empty query" };
  }

  const normalized = normalizeQuery(query);

  // Must begin with SELECT (after normalization). A leading CTE/DML/other is
  // deferred per the v1 surface.
  const leaderMatch = /^([A-Za-z]+)/.exec(normalized);
  const leader = leaderMatch ? leaderMatch[1].toUpperCase() : "";
  if (leader !== "SELECT") {
    return { ...empty, unresolvableReason: `query does not begin with SELECT (begins with '${leader || "?"}')` };
  }
  if (UNTYPEABLE_LEADERS.includes(leader)) {
    return { ...empty, unresolvableReason: `'${leader}' query is not a typeable SELECT` };
  }

  // UNION / EXCEPT / INTERSECT — set operations are deferred (the column types
  // come from multiple SELECTs; defer the reconciliation).
  if (/\b(UNION|EXCEPT|INTERSECT)\b/i.test(normalized)) {
    return { ...empty, unresolvableReason: "set-operation (UNION/EXCEPT/INTERSECT) query is deferred" };
  }

  // Isolate the projection list: between `SELECT` and the first top-level `FROM`.
  // `SELECT DISTINCT` — strip the DISTINCT/ALL qualifier.
  let afterSelect = normalized.slice("SELECT".length).trim();
  const distinctMatch = /^(DISTINCT|ALL)\b/i.exec(afterSelect);
  if (distinctMatch) afterSelect = afterSelect.slice(distinctMatch[0].length).trim();

  // Find the top-level FROM (depth 0) that separates projection from the rest.
  const fromAt = findTopLevelFrom(afterSelect);
  let projectionText: string;
  if (fromAt === -1) {
    // SELECT with no FROM (e.g. `SELECT 1`). The projection is the whole rest;
    // such expressions are opaque, but we still parse the list.
    projectionText = afterSelect;
  } else {
    projectionText = afterSelect.slice(0, fromAt).trim();
  }
  if (projectionText.length === 0) {
    return { ...empty, unresolvableReason: "empty projection list" };
  }

  // Slice the top-level FROM region (depth-aware) — everything from just after
  // the top-level FROM keyword up to the next top-level clause keyword. This
  // skips any FROM inside a projection subquery (`(SELECT ... FROM ...)`).
  const fromRegion = fromAt === -1 ? "" : sliceTopLevelFromRegion(afterSelect, fromAt);
  const fromParsed = parseFromClause(fromRegion);
  if (fromParsed === null) {
    return { ...empty, unresolvableReason: "FROM clause contains a subquery or an unparseable table reference" };
  }
  const { aliasMap, fromTables } = fromParsed;

  // Split + resolve the projection entries.
  const entries = splitTopLevelCommas(projectionText);
  const columns: ProjectedColumn[] = [];
  for (const entry of entries) {
    if (entry.trim().length === 0) continue;
    columns.push(resolveProjectionEntry(entry, aliasMap, fromTables));
  }

  if (columns.length === 0) {
    return { ...empty, unresolvableReason: "no projection columns parsed" };
  }

  return {
    resolvable: true,
    columns,
    aliasMap,
    fromTables,
  };
}

/**
 * Slice the top-level FROM region from `afterSelect`, starting at the FROM
 * keyword index `fromAt`. Walks depth-aware (parenthesis tracking) from just
 * past `FROM` to the first top-level clause keyword (WHERE / GROUP BY / HAVING /
 * ORDER BY / LIMIT / OFFSET / WINDOW / UNION / EXCEPT / INTERSECT / RETURNING),
 * so a subquery's own clauses do not truncate the region prematurely.
 */
function sliceTopLevelFromRegion(afterSelect: string, fromAt: number): string {
  const start = fromAt + 4; // past "FROM"
  const upper = afterSelect.toUpperCase();
  const stopWords = ["WHERE", "GROUP", "HAVING", "ORDER", "LIMIT", "OFFSET", "WINDOW", "UNION", "EXCEPT", "INTERSECT", "RETURNING"];
  let depth = 0;
  for (let i = start; i < afterSelect.length; i++) {
    const ch = afterSelect[i];
    if (ch === "(") { depth++; continue; }
    if (ch === ")") { depth = Math.max(0, depth - 1); continue; }
    if (depth !== 0) continue;
    // Word boundary?
    const before = i === 0 ? " " : afterSelect[i - 1];
    if (/[A-Za-z0-9_]/.test(before)) continue;
    for (const w of stopWords) {
      if (upper.startsWith(w, i)) {
        const after = i + w.length >= afterSelect.length ? " " : afterSelect[i + w.length];
        if (!/[A-Za-z0-9_]/.test(after)) {
          return afterSelect.slice(start, i);
        }
      }
    }
  }
  return afterSelect.slice(start);
}

/**
 * Find the byte index of the projection-terminating top-level `FROM` keyword in
 * the post-SELECT text. Returns -1 when there is no top-level FROM (depth tracks
 * parenthesized subqueries so a `FROM` inside `(SELECT ... FROM ...)` is
 * skipped). Word-boundary aware.
 */
function findTopLevelFrom(afterSelect: string): number {
  let depth = 0;
  const re = /\bFROM\b/gi;
  // Track depth by scanning char-by-char while checking for FROM at depth 0.
  // Simpler: walk the string, maintain depth, and at each position test for FROM.
  const upper = afterSelect.toUpperCase();
  for (let i = 0; i < afterSelect.length; i++) {
    const ch = afterSelect[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0 && upper[i] === "F") {
      if (upper.startsWith("FROM", i)) {
        const before = i === 0 ? " " : afterSelect[i - 1];
        const after = i + 4 >= afterSelect.length ? " " : afterSelect[i + 4];
        if (!/[A-Za-z0-9_]/.test(before) && !/[A-Za-z0-9_]/.test(after)) {
          return i;
        }
      }
    }
  }
  void re;
  return -1;
}
