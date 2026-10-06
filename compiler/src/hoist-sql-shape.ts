/**
 * §8.10 Tier 2 — the ALLOW-LIST of query shapes a loop hoist may rewrite (S455).
 *
 * The rewrite turns N per-iteration queries `… WHERE <key> = ${x.f}` into ONE
 * pre-fetch over all the keys, grouped by key (an `IN (…)` list until S456; now a
 * joined key table, see HOIST_KEY_TABLE — the "IN-rewrite" below names either).
 * That is the same answer only
 * when each per-key result is exactly the per-key slice of the IN result, and that
 * holds for a narrow, recognisable family of queries. Everything else — aggregates,
 * GROUP BY / HAVING, DISTINCT, LIMIT / OFFSET, OR, set operations, subqueries,
 * window functions, functions or expressions in the SELECT list, a second `${}`,
 * comments — changes the answer (`count(*)` → one count for ALL keys; `LIMIT 1` →
 * one row for ALL keys; `OR kind = 'y'` → foreign rows under every key) or cannot be
 * rewritten (`OR id = ${it.alt}` left a raw `${}` in the SQL text). An allow-list,
 * not a deny-list: a shape this file does not recognise is not hoisted (the loop
 * keeps its per-iteration query and the planner records a D-BATCH-001 note).
 *
 * The shape, token by token (case-insensitive keywords):
 *
 *   SELECT item (, item)*                 item  := col [ [AS] ident ] | * | t.*
 *   FROM   tref ( join )*                 tref  := ident [. ident] [ [AS] ident ]
 *                                         join  := [INNER | LEFT [OUTER]] JOIN tref ON cmp (AND cmp)*
 *   WHERE  col = ${ <loopVar>.<field> } ( AND pred )*
 *   [ ORDER BY col [ASC|DESC] [NULLS FIRST|LAST] (, …)* ]
 *
 *   col   := ident [. ident]
 *   pred  := opnd op opnd | opnd IS [NOT] NULL | opnd [NOT] LIKE string
 *          | opnd [NOT] IN ( lit (, lit)* )
 *   opnd  := col | lit        lit := number | 'string' | TRUE | FALSE | NULL
 *   op    := = | <> | != | < | <= | > | >=
 *
 * The decision is made on TOKENS (string literals, quoted identifiers and `${…}`
 * interpolations are single tokens), never by a regex over the text: a `FROM`
 * inside a string literal (`'a FROM b' AS t`) is a string, not a clause boundary.
 */

export interface HoistableQuery {
  /** The key column as written in the WHERE (`id`, `n.id`). */
  keyColumn: string;
  /** The loop binder's field the key is read from (`it.<field>`). */
  keyField: string;
  /** The SELECT list's output names (aliases, else the column name; `*` for a star). */
  selectNames: string[];
  /** The source table names (FROM + JOINs), as written (last dotted segment). */
  tables: string[];
  /**
   * The rewritten pre-fetch: the query joined to the KEY TABLE (HOIST_KEY_TABLE), its
   * `= ${…}` compared against the key table's key column instead, and each row's key
   * SLOT projected under `keyAlias`. `__SCRML_BATCH_VALUES__` is the VALUES rows
   * placeholder the emitter fills at run time (`(0, ?1), (1, ?2), …`).
   */
  inSqlTemplate: string;
}

/**
 * The pre-fetch's key table: one `(slot, key)` row per distinct loop key, the key a
 * BOUND parameter (§8.2) and the slot a compiler-generated integer.
 *
 * WHY A KEY TABLE AND NOT `<key> IN (…)` (S456): the per-iteration query compares
 * `<key> = ?` with SQL's equality — the key column's type affinity and collation
 * apply (`id = '7'` matches the INTEGER 7; `name = 7` matches the TEXT '7'; a NOCASE
 * column matches 'abc' to 'Abc'). An `IN (…)` pre-fetch returned the right rows, but
 * the loop then found each row's key in a JS `Map` by the JS value — identity, no
 * affinity, no collation — so the text key "7" missed the row SQL had matched and
 * read `not`. With the key table SQL does the matching, with the SAME `=` as the
 * per-iteration query (a `VALUES` column has no affinity, exactly like a bound
 * parameter — executed against INTEGER / TEXT / NOCASE / BLOB / REAL / NUMERIC
 * columns), and each row comes back tagged with the slot of the key it matched;
 * the loop looks up the slot, never compares keys itself.
 */
export const HOIST_KEY_TABLE = "__scrml_batch_k";
/** The key table's bound-key column (a `SELECT *` pre-fetch carries it; the emitter strips it). */
export const HOIST_VAL_ALIAS = "__scrml_batch_val";
/** The VALUES-rows placeholder in `inSqlTemplate`. */
export const HOIST_VALUES_PLACEHOLDER = "__SCRML_BATCH_VALUES__";

type TokKind = "word" | "qident" | "num" | "str" | "interp" | "op";
interface Tok { kind: TokKind; text: string; start: number; end: number }

const OPS = ["<>", "!=", "<=", ">=", "=", "<", ">", "(", ")", ",", ".", "*"];

/** Tokenize a `?{}` template body. `null` on anything outside the recognised alphabet (comments included). */
function tokenize(sql: string): Tok[] | null {
  const out: Tok[] = [];
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (/\s/.test(c)) { i++; continue; }
    const start = i;
    if (c === "-" && sql[i + 1] === "-") return null; // comment
    if (c === "/" && sql[i + 1] === "*") return null; // comment
    if (c === "'") {
      i++;
      for (;;) {
        if (i >= sql.length) return null;
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") { i += 2; continue; }
          i++;
          break;
        }
        i++;
      }
      out.push({ kind: "str", text: sql.slice(start, i), start, end: i });
      continue;
    }
    if (c === '"') {
      i++;
      for (;;) {
        if (i >= sql.length) return null;
        if (sql[i] === '"') {
          if (sql[i + 1] === '"') { i += 2; continue; }
          i++;
          break;
        }
        i++;
      }
      out.push({ kind: "qident", text: sql.slice(start, i), start, end: i });
      continue;
    }
    if (c === "$" && sql[i + 1] === "{") {
      let depth = 0;
      for (; i < sql.length; i++) {
        if (sql[i] === "{") depth++;
        else if (sql[i] === "}") { depth--; if (depth === 0) { i++; break; } }
      }
      if (depth !== 0) return null;
      out.push({ kind: "interp", text: sql.slice(start, i), start, end: i });
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      while (i < sql.length && /[A-Za-z0-9_]/.test(sql[i])) i++;
      out.push({ kind: "word", text: sql.slice(start, i), start, end: i });
      continue;
    }
    if (/[0-9]/.test(c)) {
      while (i < sql.length && /[0-9.]/.test(sql[i])) i++;
      out.push({ kind: "num", text: sql.slice(start, i), start, end: i });
      continue;
    }
    const op = OPS.find((o) => sql.startsWith(o, i));
    if (!op) return null;
    i += op.length;
    out.push({ kind: "op", text: op, start, end: i });
  }
  return out;
}

/** Words that may never appear anywhere in a hoistable query (clauses / operators outside the shape). */
const FORBIDDEN_WORDS = new Set([
  "GROUP", "HAVING", "LIMIT", "OFFSET", "FETCH", "OR", "UNION", "INTERSECT", "EXCEPT",
  "DISTINCT", "OVER", "WINDOW", "PARTITION", "WITH", "RETURNING", "INTO", "CASE", "EXISTS",
  "VALUES", "TOP", "USING", "NATURAL", "RIGHT", "FULL", "CROSS",
]);

/** Keywords that end an identifier position (cannot be an implicit alias). */
const RESERVED = new Set([
  "SELECT", "FROM", "WHERE", "AND", "ON", "JOIN", "INNER", "LEFT", "OUTER", "ORDER", "BY",
  "AS", "ASC", "DESC", "NULLS", "FIRST", "LAST", "IS", "NOT", "NULL", "LIKE", "IN", "TRUE", "FALSE",
  ...FORBIDDEN_WORDS,
]);

const kw = (t: Tok | undefined, w: string): boolean => !!t && t.kind === "word" && t.text.toUpperCase() === w;
const isIdent = (t: Tok | undefined): boolean =>
  !!t && ((t.kind === "word" && !RESERVED.has(t.text.toUpperCase())) || t.kind === "qident");
const isOp = (t: Tok | undefined, o: string): boolean => !!t && t.kind === "op" && t.text === o;
const unquote = (t: Tok): string => (t.kind === "qident" ? t.text.slice(1, -1).replace(/""/g, '"') : t.text);

/**
 * Classify a loop body's `?{}` template against the allow-list. Returns the
 * rewrite on a match, or `{ reason }` (a D-BATCH-001 near-miss reason) otherwise.
 */
export function classifyHoistableQuery(
  sql: string,
  loopVar: string,
  keyAlias: string,
): HoistableQuery | { reason: string } {
  const toks = tokenize(sql);
  if (!toks) return { reason: "the query contains a comment or a token outside the hoistable SQL subset" };
  const interps = toks.filter((t) => t.kind === "interp");
  if (interps.length !== 1) return { reason: `the query has ${interps.length} \`\${}\` interpolations (a hoistable query has exactly one, the key)` };
  for (const t of toks) {
    if (t.kind === "word" && FORBIDDEN_WORDS.has(t.text.toUpperCase())) {
      return { reason: `the query uses ${t.text.toUpperCase()} — its IN-rewrite is not the per-key answer (§8.10.3)` };
    }
    // The pre-fetch's own names (key alias, key table, its columns) must not collide.
    if ((t.kind === "word" || t.kind === "qident") && /^"?__scrml_batch/i.test(t.text)) {
      return { reason: `the query names \`${t.text}\`, which the pre-fetch reserves` };
    }
  }
  let p = 0;
  const peek = (o = 0) => toks[p + o];
  const fail = (what: string) => ({ reason: `the query is outside the hoistable shape (${what})` });

  // col := ident [. ident]  — returns its source text, or null.
  const col = (): string | null => {
    if (!isIdent(peek())) return null;
    const a = toks[p++];
    if (isOp(peek(), ".") && isIdent(peek(1))) {
      p++;
      const b = toks[p++];
      return `${a.text}.${b.text}`;
    }
    return a.text;
  };
  const lit = (): boolean => {
    const t = peek();
    if (t && (t.kind === "num" || t.kind === "str" || kw(t, "TRUE") || kw(t, "FALSE") || kw(t, "NULL"))) { p++; return true; }
    return false;
  };
  const opnd = (): boolean => col() !== null || lit();
  const cmpOp = (): boolean => {
    const t = peek();
    if (t && t.kind === "op" && ["=", "<>", "!=", "<", "<=", ">", ">="].includes(t.text)) { p++; return true; }
    return false;
  };
  const pred = (): boolean => {
    if (!opnd()) return false;
    if (cmpOp()) return opnd();
    if (kw(peek(), "IS")) { p++; if (kw(peek(), "NOT")) p++; if (!kw(peek(), "NULL")) return false; p++; return true; }
    if (kw(peek(), "NOT")) p++;
    if (kw(peek(), "LIKE")) { p++; if (peek()?.kind !== "str") return false; p++; return true; }
    if (kw(peek(), "IN")) {
      p++;
      if (!isOp(peek(), "(")) return false;
      p++;
      if (!lit()) return false;
      while (isOp(peek(), ",")) { p++; if (!lit()) return false; }
      if (!isOp(peek(), ")")) return false;
      p++;
      return true;
    }
    return false;
  };
  const tref = (tables: string[]): boolean => {
    if (!isIdent(peek())) return false;
    let name = toks[p++];
    if (isOp(peek(), ".") && isIdent(peek(1))) { p++; name = toks[p++]; }
    tables.push(unquote(name));
    if (kw(peek(), "AS")) { p++; if (!isIdent(peek())) return false; p++; }
    else if (isIdent(peek())) p++;
    return true;
  };

  // SELECT list
  if (!kw(peek(), "SELECT")) return fail("not a SELECT");
  p++;
  const selectNames: string[] = [];
  for (;;) {
    if (isOp(peek(), "*")) { p++; selectNames.push("*"); }
    else if (isIdent(peek()) && isOp(peek(1), ".") && isOp(peek(2), "*")) { p += 3; selectNames.push("*"); }
    else {
      const t0 = peek();
      const c = col();
      if (c === null) return fail(`SELECT item at \`${t0?.text ?? "end"}\` is not a plain column`);
      let name = c.includes(".") ? c.slice(c.lastIndexOf(".") + 1) : c;
      if (kw(peek(), "AS")) { p++; if (!isIdent(peek())) return fail("AS without an alias"); name = toks[p++].text; }
      else if (isIdent(peek())) name = toks[p++].text;
      selectNames.push(name.replace(/^"|"$/g, ""));
    }
    if (isOp(peek(), ",")) { p++; continue; }
    break;
  }
  const selectEnd = toks[p - 1].end;
  if (selectNames.some((n) => n.toLowerCase() === keyAlias.toLowerCase())) {
    return { reason: `the SELECT list already names the reserved alias \`${keyAlias}\`` };
  }

  // FROM + simple JOINs
  if (!kw(peek(), "FROM")) return fail("expected FROM after the SELECT list");
  p++;
  const tables: string[] = [];
  if (!tref(tables)) return fail("FROM is not a table name");
  for (;;) {
    const save = p;
    if (kw(peek(), "INNER")) p++;
    else if (kw(peek(), "LEFT")) { p++; if (kw(peek(), "OUTER")) p++; }
    if (!kw(peek(), "JOIN")) { p = save; break; }
    p++;
    if (!tref(tables)) return fail("JOIN is not a table name");
    if (!kw(peek(), "ON")) return fail("JOIN without ON");
    p++;
    if (!(opnd() && cmpOp() && opnd())) return fail("JOIN ON is not a column comparison");
    while (kw(peek(), "AND")) {
      p++;
      if (!(opnd() && cmpOp() && opnd())) return fail("JOIN ON is not a column comparison");
    }
  }

  // WHERE <key> = ${loopVar.field} (AND pred)*
  if (!kw(peek(), "WHERE")) return fail("expected WHERE <key> = ${…}");
  const whereTok = toks[p];
  p++;
  const keyColumn = col();
  if (keyColumn === null) return fail("the WHERE does not start with the key column");
  const eqTok = peek();
  if (!isOp(eqTok, "=")) return fail("the key predicate is not an equality");
  p++;
  const keyTok = peek();
  if (!keyTok || keyTok.kind !== "interp") return fail("the key predicate is not `= ${…}`");
  const km = new RegExp(`^\\$\\{\\s*${loopVar}\\s*\\.\\s*([A-Za-z_]\\w*)\\s*\\}$`).exec(keyTok.text);
  if (!km) return fail(`the key is not \`\${${loopVar}.<field>}\``);
  p++;
  while (kw(peek(), "AND")) {
    p++;
    if (!pred()) return fail("an AND predicate is not a simple comparison");
  }

  // ORDER BY
  if (kw(peek(), "ORDER")) {
    p++;
    if (!kw(peek(), "BY")) return fail("ORDER without BY");
    p++;
    for (;;) {
      if (col() === null) return fail("ORDER BY item is not a column");
      if (kw(peek(), "ASC") || kw(peek(), "DESC")) p++;
      if (kw(peek(), "NULLS")) { p++; if (!(kw(peek(), "FIRST") || kw(peek(), "LAST"))) return fail("NULLS without FIRST/LAST"); p++; }
      if (isOp(peek(), ",")) { p++; continue; }
      break;
    }
  }
  if (p !== toks.length) return fail(`unexpected \`${toks[p].text}\``);

  // SELECT <list>, <key table>.<keyAlias> AS <keyAlias>
  // FROM <sources>, (SELECT column1 AS <keyAlias>, column2 AS <val> FROM (VALUES …)) AS <key table>
  // WHERE <key> = <key table>.<val> <rest>
  // The key table joins after every source (a comma join filtered by the WHERE), so
  // each source row is matched against each distinct key exactly as `<key> = ?` would.
  const keyTable =
    `(SELECT column1 AS ${keyAlias}, column2 AS ${HOIST_VAL_ALIAS} FROM (VALUES ${HOIST_VALUES_PLACEHOLDER})) AS ${HOIST_KEY_TABLE}`;
  const inSqlTemplate =
    sql.slice(0, selectEnd) + `, ${HOIST_KEY_TABLE}.${keyAlias} AS ${keyAlias}` +
    sql.slice(selectEnd, whereTok.start).trimEnd() + `, ${keyTable} ` +
    sql.slice(whereTok.start, eqTok!.start) + `= ${HOIST_KEY_TABLE}.${HOIST_VAL_ALIAS}` + sql.slice(keyTok.end);
  return { keyColumn, keyField: km[1], selectNames, tables, inSqlTemplate };
}
