/**
 * §14.8.10 — the tenant floor's ALLOW-LISTED SQL SUBSET (S452 r3).
 *
 * A query against a tenant-scoped table is legal (without `.acrossTenants()`)
 * ONLY if it lies in a small SQL subset this module can read EXACTLY. Anything
 * outside it is refused at compile time. This replaces the r2 approach — regex
 * classification over a normalized text — which three security-review rounds beat
 * with lexical forms the database parses differently from the classifier (a
 * quoted function name, a leading `;`, a `{` inside an interpolation's string,
 * Postgres `E'…'` / `$q$…$q$` literals, `REPLACE INTO`, a quoted `"tenant_id"`).
 * S451 durable: text classification cannot prove a query safe — so the floor no
 * longer classifies arbitrary text; it accepts only text whose every token it
 * knows, and refuses the rest.
 *
 * THE SUBSET (a closed token set; ANY other character or form is outside it):
 *   - whitespace: space, tab, newline, carriage return;
 *   - unquoted identifiers `[A-Za-z_][A-Za-z0-9_]*` (qualified `a.b` is three
 *     tokens: ident `.` ident); an identifier immediately followed by `'` is a
 *     prefixed literal (`E'…'`, `X'…'`, `N'…'`, `B'…'`) and is outside;
 *   - numbers `123`, `1.5`, `.5`, `1e9` — not immediately followed by an
 *     identifier character or `.` (`0x1F`, `1_000` are outside);
 *   - plain single-quoted string literals: `''` is the only escape; a backslash,
 *     a `${`, or a control character inside one is outside;
 *   - `${…}` interpolations — the bound parameters (see below);
 *   - punctuation: `( ) , . * = <> != < > <= >= + - / % ||`.
 *   Outside, among others: `"`, `` ` ``, `[`, `]`, `$` (other than `${`), `\`,
 *   `;`, `:`, `?`, `@`, `#`, `&`, `|` (other than `||`), `^`, `~`, `{`, `}`, `--`,
 *   `/*`, any non-ASCII character outside a literal, any other control character.
 *
 * INTERPOLATIONS ARE OPAQUE BOUND PARAMETERS. The `?{}` AST node carries its
 * body as ONE string (`query`; the SQL tokenizer emits a single SQL_RAW token),
 * not as text/interpolation chunks — so the chunk boundaries come from the
 * emitter's own splitter, `liveSqlInterpolations` (the function that decides
 * what is bound). That splitter brace-counts, and JavaScript's template parser
 * does not: `${ "{" } … ${ "}" }` was ONE interpolation to the splitter and two
 * to JS, so the SQL text between them reached the database unseen (r3 C3). This
 * module never parses JS inside an interpolation. It only requires that the
 * payload — after removing plain `"…"` / `'…'` strings (no backslash, no
 * newline) — contain none of the characters that can make the two parsers
 * disagree about where it ends (`{` `}` `'` `"` `` ` `` `/` `\`); then the first
 * `}` is the end for both, by construction — and it cross-checks its spans against
 * `liveSqlInterpolations` (any difference → outside the subset).
 *
 * THE STATEMENT GRAMMAR (over the tokens, never over text):
 *   - exactly ONE statement led by SELECT, INSERT, UPDATE or DELETE (`;` is
 *     outside the token set, so a second statement cannot exist);
 *   - no WITH / subquery (`(` followed by SELECT, WITH or VALUES) / `IN <table>`;
 *     no UNION / INTERSECT / EXCEPT; no OVER / WINDOW;
 *   - no REPLACE statement or `OR REPLACE`; no INSERT … SELECT; no ON CONFLICT;
 *     no RETURNING; no SELECT … INTO; no FOR (locking clauses);
 *   - every function call is on the per-row allow-list (a `.`-qualified callee
 *     never is), except in a read grouped by every tenant source's `tenant_id`;
 *   - INSERT: `INSERT [OR IGNORE|ABORT|FAIL|ROLLBACK] INTO t (plain cols) VALUES
 *     (one row)`, the tenant column not named (compared case-insensitively) —
 *     the floor injects it;
 *   - UPDATE: `UPDATE [OR IGNORE|ABORT|FAIL|ROLLBACK] t SET col = expr, … [WHERE
 *     expr]`, no SET of the tenant column — the floor ANDs `tenant_id = <active
 *     tenant>` onto the parenthesized WHERE (or adds one);
 *   - DELETE: `DELETE FROM t [WHERE expr]` — the same injection.
 *
 * Postgres-specific forms are simply outside the subset — no dialect-aware
 * literal scanning is needed or attempted.
 */

import { liveSqlInterpolations } from "./sql-lex.ts";

/** The canonical tenant-discriminator column (§14.8.10). */
const TENANT_COLUMN = "tenant_id";

/** The reserved alias prefix of the floor's key columns. */
const TENANT_KEY_ALIAS_PREFIX = "__scrml_tenant_";

// ---------------------------------------------------------------------------
// DIALECT (S455 review of ee1a80bc, executed on PG16: `raise(id)` / `julianday(label)`
// are SQLite built-ins but USER functions on Postgres — a user `evil(record)` named
// like a SQLite built-in read every tenant). A name is admitted only where it is a
// BUILT-IN of the database that runs it: the compilation's resolved driver (§44 —
// a `postgres://` URI → Postgres; a SQLite path / `sqlite:` / `:memory:` → SQLite);
// unknown or mixed → the INTERSECTION (a name built in on BOTH).
// ---------------------------------------------------------------------------

/** The database a tenant query / `<schema>` body runs on, as far as the compiler can tell. */
export type SqlDialect = "sqlite" | "postgres" | "unknown";

/** Where a name is a built-in: both databases, SQLite only, Postgres only. */
export type Avail = "both" | "sqlite" | "postgres";

/** Is a name with availability `a` built in on `d` (unknown → built in on BOTH)? */
export function availableOn(a: Avail | undefined, d: SqlDialect): boolean {
  if (a === undefined) return false;
  return a === "both" || a === d;
}

/** Build the allow-list of `table` for dialect `d`. */
export function namesFor(table: ReadonlyMap<string, Avail>, d: SqlDialect): Set<string> {
  const out = new Set<string>();
  for (const [n, a] of table) if (availableOn(a, d)) out.add(n);
  return out;
}

/**
 * THE CLOSED BUILT-IN TYPE LIST a `::` cast may name (S455 "a"; the #1317 expression
 * rule's list, made dialect-aware). Postgres: its built-in types — a domain, enum,
 * composite or extension type runs an input function of its own (code). SQLite has no
 * `::` at all (a syntax error there), so on SQLite a `::` is outside the subset; on an
 * unknown dialect the Postgres list applies (SQLite runs no code for a type name).
 * Multi-word heads (`double precision`, `character varying`, `timestamp with time zone`,
 * `national character`) are read by `readCastType`.
 */
export const PG_CAST_TYPES: ReadonlySet<string> = new Set([
  "int", "int2", "int4", "int8", "integer", "smallint", "bigint", "real", "double", "float", "float4", "float8",
  "numeric", "decimal", "text", "varchar", "char", "character", "national", "nchar", "bpchar", "bool", "boolean",
  "date", "time", "timestamp", "timestamptz", "timetz", "interval", "uuid", "json", "jsonb", "bytea", "money",
  "inet", "cidr", "macaddr", "bit", "varbit", "xml", "oid", "name", "regclass", "tsrange", "tstzrange", "daterange",
  "int4range", "int8range", "numrange", "tsvector", "tsquery",
]);
/** Built-in types that take a size / precision: `varchar(64)`, `numeric(10, 2)`, `timestamp(3)`. */
const SIZED_CAST_TYPES = new Set([
  "varchar", "char", "character", "nchar", "numeric", "decimal", "timestamp", "timestamptz", "time", "timetz",
  "interval", "bit", "varbit", "float",
]);

/**
 * Read the type of a `::` cast starting at `j` (just past `::`). Returns the end offset
 * and the normalized type, or why it is outside the subset. Whitespace may separate the
 * words; the spelling must END the cast (no `.`-qualified type, no trailing identifier
 * character, no `interval` field qualifier — each would be read differently by Postgres).
 */
function readCastType(src: string, j: number, dialect: SqlDialect): { ok: true; end: number; type: string } | { ok: false; why: string } {
  if (dialect === "sqlite") return { ok: false, why: "a `::` cast (not SQLite syntax — write `CAST(x AS t)`)" };
  const n = src.length;
  const ws = (k: number): number => { while (k < n && (src[k] === " " || src[k] === "\t" || src[k] === "\n" || src[k] === "\r")) k++; return k; };
  const word = (k: number): { w: string; end: number } | null => {
    if (!IDENT_START.test(src[k] ?? "")) return null;
    let e = k + 1;
    while (e < n && IDENT_CHAR.test(src[e])) e++;
    return { w: src.slice(k, e).toLowerCase(), end: e };
  };
  const nextWord = (k: number, want: string[]): { w: string; end: number } | null => {
    const s = ws(k);
    if (s === k) return null;
    const w = word(s);
    return w && want.includes(w.w) ? w : null;
  };
  const head = word(ws(j));
  if (!head) return { ok: false, why: "a `::` cast whose type the subset cannot read" };
  if (!PG_CAST_TYPES.has(head.w)) {
    return { ok: false, why: `a \`::\` cast to \`${head.w}\`, a type outside the built-in list (its input function is code)` };
  }
  let type = head.w;
  let k = head.end;
  const size = (): boolean => {
    if (src[k] !== "(") return true;
    let e = k + 1;
    if (!DIGIT.test(src[e] ?? "")) return false;
    while (DIGIT.test(src[e] ?? "")) e++;
    if (src[e] === ",") { e = ws(e + 1); if (!DIGIT.test(src[e] ?? "")) return false; while (DIGIT.test(src[e] ?? "")) e++; }
    if (src[e] !== ")") return false;
    k = e + 1;
    return true;
  };
  if (type === "double") {
    const p = nextWord(k, ["precision"]);
    if (!p) return { ok: false, why: "a `::double` cast without `precision`" };
    type = "double precision"; k = p.end;
  } else if (type === "national") {
    const c = nextWord(k, ["character", "char"]);
    if (!c) return { ok: false, why: "a `::national` cast without `character`" };
    type = `national ${c.w}`; k = c.end;
  }
  if (["character", "char", "bit", "national character", "national char"].includes(type)) {
    const v = nextWord(k, ["varying"]);
    if (v) { type += " varying"; k = v.end; }
  }
  const sized = SIZED_CAST_TYPES.has(type.split(" ")[0]) || type.endsWith("varying");
  if (sized && !size()) return { ok: false, why: `a \`::${type}\` cast whose size the subset cannot read` };
  if (type === "timestamp" || type === "time") {
    const w = nextWord(k, ["with", "without"]);
    if (w) {
      const t = nextWord(w.end, ["time"]);
      const z = t ? nextWord(t.end, ["zone"]) : null;
      if (!z) return { ok: false, why: `a \`::${type} ${w.w} …\` cast the subset cannot read` };
      type += ` ${w.w} time zone`; k = z.end;
    }
  }
  if (type === "interval") {
    const f = nextWord(k, ["year", "month", "day", "hour", "minute", "second"]);
    if (f) return { ok: false, why: "a `::interval` cast with a field qualifier" };
  }
  while (src[k] === "[" && src[k + 1] === "]") { type += "[]"; k += 2; }
  if (k < n && (IDENT_CHAR.test(src[k]) || src[k] === "." || src[k] === "[" || src[k] === "(")) {
    return { ok: false, why: `a \`::${type}\` cast followed by \`${src[k]}\`` };
  }
  return { ok: true, end: k, type };
}

/** One subset token. Offsets index the RAW `?{}` body. */
export interface SqlTok {
  /** `cast` = a `::<built-in type>` cast (S455 "a"), read whole: its type is in `up`. */
  kind: "ident" | "num" | "str" | "param" | "punct" | "cast";
  /** Raw text. */
  text: string;
  /** Uppercased text for identifiers (keyword comparison); raw text otherwise. */
  up: string;
  start: number;
  end: number;
}

export type SubsetLex =
  | { ok: true; toks: SqlTok[] }
  | { ok: false; at: number; why: string };

const IDENT_START = /[A-Za-z_]/;
const IDENT_CHAR = /[A-Za-z0-9_]/;
const DIGIT = /[0-9]/;
const PUNCT2 = new Set(["<>", "!=", "<=", ">=", "||"]);
const PUNCT1 = new Set(["(", ")", ",", ".", "*", "=", "<", ">", "+", "-", "/", "%"]);
const WS = new Set([" ", "\t", "\n", "\r"]);
/**
 * Characters that may make JS's end of an interpolation differ from the first `}`
 * — checked after removing PLAIN JS string literals (`"…"` / `'…'` with no
 * backslash and no newline), scanned left to right as the JS lexer does. With no
 * backslash, backtick or slash in the payload, such a string closes at its next
 * quote; a quote left over after removal is an unclosed string (the first `}` may
 * be inside it) and is refused. A brace inside a removed string is caught by the
 * span cross-check against `liveSqlInterpolations` below (it brace-counts).
 */
const UNSAFE_PAYLOAD = /[{}'"`/\\]/;
const PLAIN_JS_STRING = /"[^"\\\n\r]*"|'[^'\\\n\r]*'/g;

function describeChar(c: string): string {
  const code = c.codePointAt(0) ?? 0;
  if (code < 0x20 || code === 0x7f) return `control character U+${code.toString(16).padStart(4, "0")}`;
  if (code > 0x7e) return `non-ASCII character \`${c}\``;
  return `\`${c}\``;
}

/** Options for `lexTenantSubset`. */
export interface SubsetLexOptions {
  /**
   * Admit `;` as a statement SEPARATOR token (`punct` `;`). Off for a query — a
   * query is exactly one statement, so `;` is outside its subset. On ONLY for a
   * `<schema>` trigger body (§14.8.10, S455 "yes, both"), whose `BEGIN stmt; …;
   * END` is a statement LIST: the separator is then a token the reader sees, and
   * the statement grammar over the tokens (`tenant-schema-hazards.ts`) holds each
   * statement to the subset's leaders. Every other character stays outside.
   */
  statementSeparator?: boolean;
  /**
   * The database the text runs on (S455 "a"): a `::<type>` cast is in the subset only
   * where it is that database's syntax and the type is a built-in of it (`readCastType`).
   * Default `unknown`.
   */
  dialect?: SqlDialect;
}

/**
 * Lex a raw `?{}` body into the closed subset token set. Fails (with the offset
 * and a reason naming the offending form) on anything outside it.
 *
 * ONE subset for queries AND `<schema>` bodies (§14.8.10, ruling:user-voice-scrml.md
 * S455 "yes, both"): the tenant floor reads a query with this lexer, and
 * `tenant-schema-hazards.ts` reads every view / trigger / rule / policy body with it.
 */
export function lexTenantSubset(raw: string, opts: SubsetLexOptions = {}): SubsetLex {
  const src = typeof raw === "string" ? raw : "";
  const toks: SqlTok[] = [];
  const n = src.length;
  let i = 0;
  const fail = (at: number, why: string): SubsetLex => ({ ok: false, at, why });
  while (i < n) {
    const c = src[i];
    if (WS.has(c)) { i++; continue; }

    if (c === "$" && src[i + 1] === "{") {
      const close = src.indexOf("}", i + 2);
      if (close === -1) return fail(i, "an unterminated `${` interpolation");
      const payload = src.slice(i + 2, close);
      if (UNSAFE_PAYLOAD.test(payload.replace(PLAIN_JS_STRING, ""))) {
        return fail(i, "an interpolation whose expression contains a brace, backtick, slash, backslash or " +
          "unclosed quote outside a plain string (its end cannot be read without parsing JavaScript)");
      }
      if (payload.trim().length === 0) return fail(i, "an empty `${}` interpolation");
      toks.push({ kind: "param", text: src.slice(i, close + 1), up: "", start: i, end: close + 1 });
      i = close + 1;
      continue;
    }

    if (c === "'") {
      if (i > 0 && IDENT_CHAR.test(src[i - 1])) {
        return fail(i - 1, "a prefixed string literal (`E'…'`, `X'…'`, `N'…'`, …)");
      }
      let j = i + 1;
      let closed = false;
      while (j < n) {
        const d = src[j];
        if (d === "'") {
          if (src[j + 1] === "'") { j += 2; continue; }
          closed = true;
          break;
        }
        if (d === "\\") return fail(j, "a backslash inside a string literal");
        if (d === "$" && src[j + 1] === "{") return fail(j, "a `${` inside a string literal");
        const code = d.charCodeAt(0);
        if ((code < 0x20 && d !== "\t" && d !== "\n" && d !== "\r") || code === 0x7f) {
          return fail(j, `a ${describeChar(d)} inside a string literal`);
        }
        j++;
      }
      if (!closed) return fail(i, "an unterminated string literal");
      toks.push({ kind: "str", text: src.slice(i, j + 1), up: "", start: i, end: j + 1 });
      i = j + 1;
      continue;
    }

    if (IDENT_START.test(c)) {
      let j = i + 1;
      while (j < n && IDENT_CHAR.test(src[j])) j++;
      if (src[j] === "'") return fail(i, "a prefixed string literal (`E'…'`, `X'…'`, `N'…'`, …)");
      const text = src.slice(i, j);
      toks.push({ kind: "ident", text, up: text.toUpperCase(), start: i, end: j });
      i = j;
      continue;
    }

    if (DIGIT.test(c) || (c === "." && DIGIT.test(src[i + 1] ?? ""))) {
      let j = i;
      while (j < n && DIGIT.test(src[j])) j++;
      if (src[j] === ".") { j++; while (j < n && DIGIT.test(src[j])) j++; }
      if ((src[j] === "e" || src[j] === "E") &&
          (DIGIT.test(src[j + 1] ?? "") || ((src[j + 1] === "+" || src[j + 1] === "-") && DIGIT.test(src[j + 2] ?? "")))) {
        j += 2;
        while (j < n && DIGIT.test(src[j])) j++;
      }
      if (j < n && (IDENT_CHAR.test(src[j]) || src[j] === ".")) {
        return fail(i, "a numeric literal form outside the subset (hex, digit separators, …)");
      }
      const text = src.slice(i, j);
      toks.push({ kind: "num", text, up: text, start: i, end: j });
      i = j;
      continue;
    }

    // S455 "a" — `::<built-in type>`, read WHOLE (multi-word, size, `[]` suffix): one token.
    if (c === ":" && src[i + 1] === ":") {
      const ct = readCastType(src, i + 2, opts.dialect ?? "unknown");
      if (!ct.ok) return fail(i, ct.why);
      toks.push({ kind: "cast", text: src.slice(i, ct.end), up: ct.type, start: i, end: ct.end });
      i = ct.end;
      continue;
    }
    if (c === "-" && src[i + 1] === "-") return fail(i, "a `--` comment");
    if (c === "/" && src[i + 1] === "*") return fail(i, "a `/* */` comment");
    const two = src.slice(i, i + 2);
    if (PUNCT2.has(two)) {
      toks.push({ kind: "punct", text: two, up: two, start: i, end: i + 2 });
      i += 2;
      continue;
    }
    if (PUNCT1.has(c) || (c === ";" && opts.statementSeparator === true)) {
      toks.push({ kind: "punct", text: c, up: c, start: i, end: i + 1 });
      i++;
      continue;
    }
    return fail(i, describeChar(c));
  }

  // The bound parameters must be EXACTLY the emitter's: the same spans
  // `liveSqlInterpolations` splits on (it decides what is bound and what is
  // sent as SQL text). Unreachable for a body that lexed, kept as the
  // tripwire that makes a divergence a refusal rather than a leak.
  const mine = toks.filter((t) => t.kind === "param");
  const emitter = liveSqlInterpolations(src);
  if (mine.length !== emitter.length || mine.some((t, k) => t.start !== emitter[k].start || t.end !== emitter[k].end)) {
    return fail(0, "interpolations the SQL emitter splits differently");
  }
  return { ok: true, toks };
}

// ---------------------------------------------------------------------------
// The statement grammar
// ---------------------------------------------------------------------------

/**
 * Per-row scalar functions a tenant query may call (S451: an ALLOW-list), with the
 * database each is a BUILT-IN of. `instr` / `ifnull` / `datetime` / `julianday` /
 * `strftime` are SQLite's; on Postgres they are not built in — a user function of that
 * name is code (S455 review of ee1a80bc, executed). `date(x)` / `time(x)` are Postgres's
 * function-style casts to its built-in types.
 */
export const TENANT_ROW_FUNCTION_DIALECTS: ReadonlyMap<string, Avail> = new Map<string, Avail>([
  ["lower", "both"], ["upper", "both"], ["length", "both"], ["trim", "both"], ["ltrim", "both"], ["rtrim", "both"],
  ["substr", "both"], ["substring", "both"], ["replace", "both"], ["coalesce", "both"], ["nullif", "both"],
  ["abs", "both"], ["round", "both"], ["date", "both"], ["time", "both"], ["cast", "both"],
  ["instr", "sqlite"], ["ifnull", "sqlite"], ["datetime", "sqlite"], ["julianday", "sqlite"], ["strftime", "sqlite"],
]);

/**
 * S452 r4 — the aggregates a read grouped by every tenant source's `tenant_id`
 * may call (each group is one tenant's rows). An ALLOW-list like the per-row one:
 * before r4 a grouped read could call ANY function, and on Postgres
 * `table_to_xml('assets', …)` / `query_to_xml('select … from assets', …)` run SQL
 * from a string — every tenant's rows, in one value. `total` is SQLite's.
 */
export const TENANT_GROUP_AGGREGATE_DIALECTS: ReadonlyMap<string, Avail> = new Map<string, Avail>([
  ["count", "both"], ["sum", "both"], ["avg", "both"], ["min", "both"], ["max", "both"], ["total", "sqlite"],
]);

/** The per-row allow-list on dialect `d`. */
export function tenantRowFunctions(d: SqlDialect): Set<string> { return namesFor(TENANT_ROW_FUNCTION_DIALECTS, d); }
/** The grouped-read aggregate allow-list on dialect `d`. */
export function tenantGroupAggregates(d: SqlDialect): Set<string> { return namesFor(TENANT_GROUP_AGGREGATE_DIALECTS, d); }

/**
 * Every name either list admits on SOME database (for documentation / tests; NOT an
 * allow-list — the floor uses `tenantRowFunctions(dialect)`).
 */
export const TENANT_ROW_FUNCTIONS: ReadonlySet<string> = new Set(TENANT_ROW_FUNCTION_DIALECTS.keys());
export const TENANT_GROUP_AGGREGATES: ReadonlySet<string> = new Set(TENANT_GROUP_AGGREGATE_DIALECTS.keys());

/**
 * The types `CAST(x AS t)` may name on dialect `d`: Postgres / unknown → its built-ins
 * (`PG_CAST_TYPES`); SQLite → its type-affinity names and the common spellings SQLite
 * accepts (a type name runs no code there). A user type's input function is code.
 */
export const SQLITE_CAST_TYPES: ReadonlySet<string> = new Set([
  "int", "integer", "smallint", "bigint", "tinyint", "mediumint", "int2", "int8", "real", "double", "float", "numeric",
  "decimal", "text", "varchar", "char", "character", "nchar", "nvarchar", "clob", "blob", "bool", "boolean", "date",
  "datetime", "time", "timestamp", "string",
]);
export function castTypesFor(d: SqlDialect): ReadonlySet<string> { return d === "sqlite" ? SQLITE_CAST_TYPES : PG_CAST_TYPES; }

/**
 * Keywords a `(` may follow that are not a function call. NOT here (S455 review of
 * ee1a80bc): the infix operator words — `LIKE (`, `BETWEEN (` are syntax only after an
 * operand; `like(x, y)` at an expression start is a CALL (SQLite's built-in, a user
 * function on Postgres) — see `INFIX_WORDS`; nor `END` / `NULL` / `ASC` / `DESC` /
 * `ESCAPE` / `IS`, which no `(` follows in SQL.
 */
const NON_CALL_WORDS: ReadonlySet<string> = new Set([
  "SELECT", "FROM", "WHERE", "AND", "OR", "NOT", "IN", "ON", "AS", "JOIN", "USING",
  "WHEN", "THEN", "ELSE", "CASE", "BY", "LIMIT", "OFFSET", "VALUES", "EXISTS", "HAVING",
  "DISTINCT", "ALL",
]);
/** Infix keywords: `x LIKE (…)` is syntax; `LIKE(` NOT after an operand is a call. */
const INFIX_WORDS: ReadonlySet<string> = new Set(["LIKE", "ILIKE", "GLOB", "MATCH", "REGEXP", "SIMILAR", "BETWEEN", "IS", "ESCAPE"]);
/** Does token `t` end an operand (so a following infix keyword is an operator)? */
function endsOperandTok(t: SqlTok | undefined): boolean {
  return !!t && (t.kind === "num" || t.kind === "str" || t.kind === "param" || t.kind === "cast" ||
    (t.kind === "punct" && t.text === ")") || (t.kind === "ident" && !NON_CALL_WORDS.has(t.up) && !INFIX_WORDS.has(t.up)));
}

/** Keywords that end a FROM clause / a table reference's alias position. */
const FROM_STOP = new Set(["WHERE", "GROUP", "HAVING", "ORDER", "LIMIT", "OFFSET", "WINDOW"]);
const JOIN_WORDS = new Set(["JOIN", "LEFT", "RIGHT", "FULL", "INNER", "CROSS", "NATURAL", "OUTER"]);
const NOT_AN_ALIAS = new Set([...FROM_STOP, ...JOIN_WORDS, "ON", "USING", "AS", "INDEXED", "NOT"]);

export type TenantCode = "E-TENANT-AGG" | "E-TENANT-WRITE" | "E-TENANT-SQL-SUBSET";

/** Why a tenant-table query was refused. */
export type TenantRefusalReason =
  // E-TENANT-AGG (reads)
  | "aggregate" | "function" | "window" | "subquery" | "setop" | "reserved"
  // E-TENANT-WRITE (writes)
  | "write-shape"
  // E-TENANT-SQL-SUBSET (outside the readable subset)
  | "subset";

/** One tenant-scoped FROM/JOIN source of a read: its table and the SQL reference that keys it. */
export interface TenantSource { table: string; ref: string }

/**
 * The floor's reading of one `?{}` body:
 *   - `null`              — not a tenant query (no tenant-scoped table is named);
 *   - `refuse`            — refused at compile with `code`;
 *   - `read`              — a plain row read; `refs` keys one column per tenant source;
 *   - `unresolvable`      — names a tenant table but not as a source the floor can key → zero rows;
 *   - `insert`            — an injectable single-row INSERT (offsets of the two closing parens);
 *   - `filtered-write`    — an UPDATE / DELETE; `whereEnd` is the offset just past `WHERE` (or -1).
 * `leaderEnd` (writes) is the offset just past the INSERT / UPDATE keyword, where
 * the SQLite `OR ABORT` conflict clause is injected.
 */
export type TenantAnalysis =
  | null
  | { kind: "refuse"; code: TenantCode; reason: TenantRefusalReason; table: string; op: string; detail: string }
  | { kind: "read"; table: string; refs: string[]; fromAt: number }
  | { kind: "unresolvable"; table: string }
  | { kind: "insert"; table: string; colsClose: number; valsClose: number; leaderEnd: number }
  | { kind: "filtered-write"; table: string; op: "UPDATE" | "DELETE"; whereEnd: number; leaderEnd: number };

/** Options for `analyzeTenantSql`. */
export interface TenantAnalyzeOptions {
  /** S452 r4 — the `<schema>` triggers / rules / cascading FKs a write to `table` fires (see TenantContext.writeHazards). */
  writeHazards?: (table: string) => readonly string[] | undefined;
  /**
   * The database the query runs on (S455): the function allow-list, the `::` cast and
   * the `CAST` / typed-literal types are that database's BUILT-INS. Default `unknown`
   * (the intersection — a name built in on both).
   */
  dialect?: SqlDialect;
}

/** Keywords a string literal may follow (anything else before a literal makes it a TYPED literal, `t '…'`). */
const KEYWORDS_BEFORE_STRING: ReadonlySet<string> = new Set([
  "AND", "OR", "NOT", "LIKE", "ILIKE", "GLOB", "MATCH", "REGEXP", "SIMILAR", "ESCAPE", "THEN", "ELSE", "WHEN",
  "IS", "IN", "BETWEEN", "SELECT", "VALUES", "SET", "BY", "AS", "FROM", "WHERE", "ON", "HAVING", "LIMIT", "OFFSET",
  "CASE", "DISTINCT", "ALL", "ANY", "SOME", "COLLATE", "RETURN", "BOTH", "LEADING", "TRAILING", "FOR",
]);

/**
 * The first cast / typed literal whose type is not a built-in of `d`, or null: `CAST(x AS
 * t)` (at the CAST's own paren depth) and `t '…'`. A user type's input function is code
 * (the S455 type rule, shared by the query floor and `<schema>` bodies). A `::` cast is
 * checked by the lexer (`readCastType`).
 */
export function firstNonBuiltinType(toks: SqlTok[], d: SqlDialect): string | null {
  const types = castTypesFor(d);
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.kind === "ident" && t.up === "CAST" && isP(toks[k + 1], "(")) {
      let depth = 0;
      for (let j = k + 1; j < toks.length; j++) {
        if (isP(toks[j], "(")) depth++;
        else if (isP(toks[j], ")")) { depth--; if (depth === 0) break; }
        else if (depth === 1 && isKw(toks[j], "AS")) {
          const ty = toks[j + 1];
          if (!ty || ty.kind !== "ident" || isP(toks[j + 2], ".")) return ty ? ty.text : "?";
          const name = ty.text.toLowerCase();
          const tail = toks[j + 2]?.kind === "ident" ? toks[j + 2].text.toLowerCase() : "";
          const ok = types.has(name) && (name !== "double" || tail === "precision" || d === "sqlite");
          if (!ok) return ty.text;
        }
      }
    }
    if (t.kind === "ident" && toks[k + 1]?.kind === "str" && !KEYWORDS_BEFORE_STRING.has(t.up) && !types.has(t.text.toLowerCase())) {
      return t.text;
    }
  }
  return null;
}

/** Case-insensitive whole-word mention of `name` anywhere in raw text (quotes, comments and interpolations included). */
function rawWordMention(raw: string, name: string): boolean {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^A-Za-z0-9_])${esc}(?:[^A-Za-z0-9_]|$)`, "i").test(raw);
}

/**
 * Does the raw body name a tenant-scoped table? For a body INSIDE the subset an
 * identifier token decides (a literal is data; an interpolation is a bound
 * value). For a body OUTSIDE it nothing can be trusted to be data — any
 * whole-word occurrence anywhere counts, and so does a Postgres `U&"…"`
 * escaped identifier, which can spell a name without containing it.
 */
export function tenantTableMentioned(raw: string, isTenant: (name: string) => boolean, tenantNames: Iterable<string>): string | null {
  const lex = lexTenantSubset(raw);
  if (lex.ok) {
    const t = lex.toks.find((x) => x.kind === "ident" && isTenant(x.text));
    return t ? t.text : null;
  }
  for (const name of tenantNames) if (rawWordMention(raw, name)) return name;
  if (/u&["']/i.test(raw)) return [...tenantNames][0] ?? "?";
  return null;
}

const isKw = (t: SqlTok | undefined, kw: string): boolean => t !== undefined && t.kind === "ident" && t.up === kw;
const isP = (t: SqlTok | undefined, p: string): boolean => t !== undefined && t.kind === "punct" && t.text === p;

/** Index of the matching `)` for the `(` at `open`, or -1. */
function matchParen(toks: SqlTok[], open: number): number {
  let d = 0;
  for (let k = open; k < toks.length; k++) {
    if (isP(toks[k], "(")) d++;
    else if (isP(toks[k], ")")) { d--; if (d === 0) return k; }
  }
  return -1;
}

/** Paren depth BEFORE each token. `null` when the parens do not balance. */
function depths(toks: SqlTok[]): number[] | null {
  const out: number[] = [];
  let d = 0;
  for (const t of toks) {
    out.push(d);
    if (isP(t, "(")) d++;
    else if (isP(t, ")")) { d--; if (d < 0) return null; }
  }
  return d === 0 ? out : null;
}

/**
 * Analyse one raw `?{}` body against the tenant-scoped table set. The ONE
 * decision every tenant check derives from — scoping, injection and refusal
 * cannot read different queries.
 */
export function analyzeTenantSql(
  raw: string,
  isTenant: (name: string) => boolean,
  tenantNames: Iterable<string>,
  opts: TenantAnalyzeOptions = {},
): TenantAnalysis {
  const dialect: SqlDialect = opts.dialect ?? "unknown";
  const fns: CallLists = { row: tenantRowFunctions(dialect), rowAgg: new Set([...tenantRowFunctions(dialect), ...tenantGroupAggregates(dialect)]) };
  const lex = lexTenantSubset(raw, { dialect });
  if (!lex.ok) {
    const named = tenantTableMentioned(raw, isTenant, tenantNames);
    if (named === null) return null;
    return {
      kind: "refuse", code: "E-TENANT-SQL-SUBSET", reason: "subset", table: named, op: "?",
      detail: `${lex.why} at offset ${lex.at}`,
    };
  }
  const toks = lex.toks;
  const mention = toks.find((x) => x.kind === "ident" && isTenant(x.text));
  if (!mention) {
    // S452 r4 — a function can run SQL held in a STRING (Postgres `query_to_xml(
    // 'select name from assets', …)`, `table_to_xml('assets', …)`): the tenant
    // table is then data to this reader, never an identifier. So a query that
    // names a tenant table ANYWHERE in its text — a literal included — may call
    // only allow-listed functions, whatever table it reads.
    const named = [...tenantNames].find((n) => rawWordMention(raw, n));
    if (named !== undefined) {
      const bad = firstDisallowedCall(toks, new Set(), fns.rowAgg) ?? typeIssue(toks, dialect);
      if (bad !== null) {
        return {
          kind: "refuse", code: "E-TENANT-SQL-SUBSET", reason: "subset", table: named, op: toks[0]?.text.toUpperCase() ?? "?",
          detail: `a call to \`${bad}\` (not on the floor's function allow-list) in a query whose text names the ` +
            `tenant-scoped table \`${named}\` — a function can run SQL held in a string`,
        };
      }
    }
    return null;
  }
  const table = mention.text;
  const lead = toks[0];
  const leader = lead && lead.kind === "ident" ? lead.up : "";
  const isRead = leader === "SELECT";
  const refuse = (code: TenantCode, reason: TenantRefusalReason, detail: string, t: string = table): TenantAnalysis =>
    ({ kind: "refuse", code, reason, table: t, op: leader || "?", detail });
  // A refusal in a read is E-TENANT-AGG; the same shape in a write is E-TENANT-WRITE.
  const shape = (reason: TenantRefusalReason, detail: string): TenantAnalysis =>
    isRead ? refuse("E-TENANT-AGG", reason, detail) : refuse("E-TENANT-WRITE", "write-shape", detail);

  // ---- the leader: exactly one SELECT / INSERT / UPDATE / DELETE statement.
  if (leader === "WITH") return refuse("E-TENANT-AGG", "subquery", "a WITH (CTE)");
  if (leader === "REPLACE") return refuse("E-TENANT-WRITE", "write-shape", "a REPLACE statement (it deletes the conflicting row, whoever owns it)");
  if (!["SELECT", "INSERT", "UPDATE", "DELETE"].includes(leader)) {
    return refuse("E-TENANT-SQL-SUBSET", "subset",
      lead === undefined ? "an empty statement"
        : `a statement led by \`${lead.text}\` (only SELECT, INSERT, UPDATE and DELETE are in the subset)`);
  }
  const dep = depths(toks);
  if (dep === null) return refuse("E-TENANT-SQL-SUBSET", "subset", "unbalanced parentheses");

  // ---- token-wide shape rules.
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.kind !== "ident") continue;
    if (t.text.toLowerCase().startsWith(TENANT_KEY_ALIAS_PREFIX)) {
      return isRead ? refuse("E-TENANT-AGG", "reserved", "the reserved key alias") : shape("reserved", "the floor's reserved key alias");
    }
    const u = t.up;
    if (u === "WITH") return shape("subquery", "a WITH (CTE)");
    if ((u === "SELECT" || u === "VALUES") && isP(toks[k - 1], "(")) return shape("subquery", "a subquery");
    if (u === "IN" && toks[k + 1]?.kind === "ident") return shape("subquery", "`IN <table>` (reads a table like a subquery)");
    if (u === "UNION" || u === "INTERSECT" || u === "EXCEPT") return shape("setop", `a set operation (\`${t.text}\`)`);
    if (u === "OVER" || u === "WINDOW") return shape("window", `a window (\`${t.text}\`)`);
    if (u === "RETURNING") {
      return isRead ? refuse("E-TENANT-SQL-SUBSET", "subset", "RETURNING")
        : refuse("E-TENANT-WRITE", "write-shape", "RETURNING (the returned rows bypass the floor)");
    }
    if (u === "CONFLICT") return refuse("E-TENANT-WRITE", "write-shape", "ON CONFLICT (an upsert can update another tenant's row)");
    if (u === "REPLACE" && !isP(toks[k + 1], "(")) {
      return refuse("E-TENANT-WRITE", "write-shape", "REPLACE / OR REPLACE (it deletes the conflicting row, whoever owns it)");
    }
    if (u === "INTO" && isRead) return refuse("E-TENANT-WRITE", "write-shape", "SELECT … INTO (it writes every tenant's rows to a new table)");
    if (u === "FOR" && isRead) return refuse("E-TENANT-SQL-SUBSET", "subset", "a FOR locking clause");
  }

  // ---- casts / typed literals: a type that is not a built-in runs its input function (S455).
  const badType = firstNonBuiltinType(toks, dialect);
  if (badType !== null) {
    const why = `a cast or typed literal of the type \`${badType}\`, which is not a built-in type of the database (its input function is code)`;
    return isRead ? refuse("E-TENANT-SQL-SUBSET", "subset", why) : refuse("E-TENANT-WRITE", "write-shape", why);
  }

  if (isRead) return analyzeSelect(toks, dep, table, isTenant, refuse, fns);
  const write = leader === "INSERT"
    ? analyzeInsert(toks, dep, isTenant, refuse, fns)
    : analyzeFilteredWrite(toks, dep, leader as "UPDATE" | "DELETE", isTenant, refuse, fns);
  // S452 r4 — the floor constrains the STATEMENT; a trigger, rule or cascading
  // foreign key the table's `<schema>` declares runs further writes the floor
  // never sees (measured: an AFTER UPDATE trigger rewrote another tenant's rows).
  if (write !== null && (write.kind === "insert" || write.kind === "filtered-write")) {
    const hazards = opts.writeHazards?.(write.table) ?? [];
    if (hazards.length > 0) {
      return refuse("E-TENANT-WRITE", "write-shape",
        `the table's <schema> declares ${hazards.join(", ")}, which runs further writes the floor cannot ` +
        `constrain to the active tenant`, write.table);
    }
  }
  return write;
}

type Refuse = (code: TenantCode, reason: TenantRefusalReason, detail: string, t?: string) => TenantAnalysis;

/** The dialect's call allow-lists: per-row, and per-row ∪ aggregates (a grouped read). */
interface CallLists { row: ReadonlySet<string>; rowAgg: ReadonlySet<string> }

/** `firstNonBuiltinType` as a call-style refusal detail. */
function typeIssue(toks: SqlTok[], d: SqlDialect): string | null {
  const t = firstNonBuiltinType(toks, d);
  return t === null ? null : `${t} (a type outside the built-in list)`;
}

/**
 * The first function call not on `allowed` (default: the per-row allow-list), or
 * null. `skip` = token indices known not to be calls. A name followed by `(` right
 * after INTO / TABLE / EXISTS is a table and its column list, not a call.
 */
function firstDisallowedCall(
  toks: SqlTok[],
  skip: ReadonlySet<number>,
  allowed: ReadonlySet<string>,
): string | null {
  for (let k = 0; k + 1 < toks.length; k++) {
    const t = toks[k];
    if (t.kind !== "ident" || !isP(toks[k + 1], "(") || skip.has(k)) continue;
    if (isP(toks[k - 1], ".")) {
      // A qualified callee (`schema.fn(…)`) may resolve to anything.
      return `${toks[k - 2]?.text ?? ""}.${t.text}`;
    }
    const prev = toks[k - 1];
    if (prev && prev.kind === "ident" && ["INTO", "TABLE", "EXISTS"].includes(prev.up)) continue;
    if (NON_CALL_WORDS.has(t.up) || allowed.has(t.text.toLowerCase())) continue;
    // `x LIKE (…)` is the operator; `like(x, y)` (no operand before it) is a CALL
    if (INFIX_WORDS.has(t.up) && endsOperandTok(prev)) continue;
    return t.text;
  }
  return null;
}

function analyzeSelect(
  toks: SqlTok[],
  dep: number[],
  mentioned: string,
  isTenant: (name: string) => boolean,
  refuse: Refuse,
  fns: CallLists,
): TenantAnalysis {
  const top = (k: number, kw: string): boolean => dep[k] === 0 && isKw(toks[k], kw);
  const fromIdx = toks.findIndex((_, k) => top(k, "FROM"));
  const distinct = toks.some((t) => isKw(t, "DISTINCT"));
  const having = toks.some((t) => isKw(t, "HAVING"));
  if (fromIdx === -1) return { kind: "unresolvable", table: mentioned };

  // ---- the FROM clause, read structurally.
  let stop = toks.length;
  for (let k = fromIdx + 1; k < toks.length; k++) {
    if (dep[k] === 0 && toks[k].kind === "ident" && FROM_STOP.has(toks[k].up)) { stop = k; break; }
  }
  const sources: TenantSource[] = [];
  let k = fromIdx + 1;
  const unresolvable: TenantAnalysis = { kind: "unresolvable", table: mentioned };
  for (;;) {
    const tt = toks[k];
    if (k >= stop || tt.kind !== "ident" || NOT_AN_ALIAS.has(tt.up) || isP(toks[k + 1], ".")) return unresolvable;
    k++;
    let ref = tt.text;
    if (isKw(toks[k], "AS")) {
      if (k + 1 >= stop || toks[k + 1].kind !== "ident") return unresolvable;
      ref = toks[k + 1].text;
      k += 2;
    } else if (k < stop && toks[k].kind === "ident" && !NOT_AN_ALIAS.has(toks[k].up)) {
      ref = toks[k].text;
      k++;
    }
    sources.push({ table: tt.text, ref });
    if (k < stop && isKw(toks[k], "ON")) {
      k++;
      while (k < stop && !(dep[k] === 0 && (isP(toks[k], ",") || (toks[k].kind === "ident" && JOIN_WORDS.has(toks[k].up))))) k++;
    } else if (k < stop && isKw(toks[k], "USING")) {
      if (!isP(toks[k + 1], "(")) return unresolvable;
      const close = matchParen(toks, k + 1);
      for (let j = k + 2; j < close; j++) {
        if (!(toks[j].kind === "ident" || isP(toks[j], ","))) return unresolvable;
      }
      k = close + 1;
    }
    if (k >= stop) break;
    if (isP(toks[k], ",")) { k++; continue; }
    if (toks[k].kind === "ident" && JOIN_WORDS.has(toks[k].up)) {
      while (k < stop && toks[k].kind === "ident" && JOIN_WORDS.has(toks[k].up) && toks[k].up !== "JOIN") k++;
      if (!isKw(toks[k], "JOIN")) return unresolvable;
      k++;
      continue;
    }
    return unresolvable;
  }
  const refsLower = sources.map((s) => s.ref.toLowerCase());
  if (new Set(refsLower).size !== refsLower.length) return unresolvable;
  const tenantSources = sources.filter((s) => isTenant(s.table));
  if (tenantSources.length === 0) return unresolvable;
  const refs = tenantSources.map((s) => s.ref);
  const table = tenantSources[0].table;

  // ---- grouping: allowed ONLY when it groups by every tenant source's key.
  const groupIdx = toks.findIndex((_, j) => top(j, "GROUP"));
  let exempt = false;
  if (groupIdx !== -1) {
    if (!isKw(toks[groupIdx + 1], "BY")) return refuse("E-TENANT-SQL-SUBSET", "subset", "GROUP without BY", table);
    const items: SqlTok[][] = [[]];
    for (let j = groupIdx + 2; j < toks.length; j++) {
      if (dep[j] === 0 && toks[j].kind === "ident" && ["HAVING", "ORDER", "LIMIT", "OFFSET", "WINDOW"].includes(toks[j].up)) break;
      if (dep[j] === 0 && isP(toks[j], ",")) { items.push([]); continue; }
      items[items.length - 1].push(toks[j]);
    }
    const keyOf = (item: SqlTok[]): string => item.map((t) => t.text.toLowerCase()).join(" ");
    const itemSet = new Set(items.map(keyOf));
    exempt = refs.every((ref) =>
      itemSet.has(`${ref.toLowerCase()} . ${TENANT_COLUMN}`) || (sources.length === 1 && itemSet.has(TENANT_COLUMN)));
  }
  if (!exempt) {
    if (groupIdx !== -1 || having || distinct) {
      return refuse("E-TENANT-AGG", "aggregate", "GROUP BY / HAVING / DISTINCT not on every tenant source's tenant_id", table);
    }
    const bad = firstDisallowedCall(toks, new Set(), fns.row);
    if (bad !== null) return refuse("E-TENANT-AGG", "function", bad, table);
  } else {
    // Grouped by every tenant source: the per-row functions plus an explicit
    // aggregate allow-list (S452 r4) — nothing else, since a function may run
    // SQL held in a string (Postgres `table_to_xml('assets', …)`).
    const bad = firstDisallowedCall(toks, new Set(), fns.rowAgg);
    if (bad !== null) return refuse("E-TENANT-AGG", "function", bad, table);
  }
  return { kind: "read", table, refs, fromAt: toks[fromIdx].start };
}

function analyzeInsert(
  toks: SqlTok[],
  dep: number[],
  isTenant: (name: string) => boolean,
  refuse: Refuse,
  fns: CallLists,
): TenantAnalysis {
  const W = (detail: string, t?: string): TenantAnalysis => refuse("E-TENANT-WRITE", "write-shape", detail, t);
  let k = 1;
  // S452 r4 — the floor writes the conflict clause itself (`OR ABORT` on SQLite);
  // an author-written one is refused, whatever it names.
  if (isKw(toks[k], "OR")) return W("an author-written `INSERT OR …` conflict clause (the floor sets the conflict resolution of a tenant write)");
  if (!isKw(toks[k], "INTO")) return W("an INSERT the floor cannot read (expected INTO)");
  const target = toks[k + 1];
  if (target === undefined || target.kind !== "ident" || isP(toks[k + 2], ".")) return W("a schema-qualified or missing INSERT target");
  if (!isTenant(target.text)) return W("a write that names a tenant-scoped table outside its target");
  k += 2;
  if (!isP(toks[k], "(")) return W("an INSERT without a column list (the floor cannot inject tenant_id)", target.text);
  const colsOpen = k;
  const colsClose = matchParen(toks, colsOpen);
  for (let j = colsOpen + 1; j < colsClose; j++) {
    const expectIdent = (j - colsOpen) % 2 === 1;
    if (expectIdent ? toks[j].kind !== "ident" : !isP(toks[j], ",")) {
      return W("an INSERT column list that is not plain column names", target.text);
    }
    if (expectIdent && toks[j].text.toLowerCase() === TENANT_COLUMN) {
      return W("an INSERT that sets tenant_id itself (the floor cannot verify the chosen tenant)", target.text);
    }
  }
  if (colsClose === colsOpen + 1 || isP(toks[colsClose - 1], ",")) return W("an empty or malformed INSERT column list", target.text);
  k = colsClose + 1;
  if (!isKw(toks[k], "VALUES")) return W("an INSERT whose rows do not come from one VALUES tuple (INSERT … SELECT, DEFAULT VALUES)", target.text);
  if (!isP(toks[k + 1], "(")) return W("a malformed VALUES tuple", target.text);
  const valsOpen = k + 1;
  const valsClose = matchParen(toks, valsOpen);
  if (valsClose !== toks.length - 1) return W("a multi-row INSERT or a trailing clause after VALUES", target.text);
  for (let j = valsOpen + 1; j < valsClose; j++) {
    if (toks[j].kind === "ident" && isTenant(toks[j].text)) return W("an INSERT whose values name a tenant-scoped table", target.text);
  }
  const bad = firstDisallowedCall(toks, new Set([colsOpen - 1]), fns.row);
  if (bad !== null) return W(`a call to \`${bad}\`, which is not on the per-row function allow-list`, target.text);
  void dep;
  return { kind: "insert", table: target.text, colsClose: toks[colsClose].start, valsClose: toks[valsClose].start, leaderEnd: toks[0].end };
}

function analyzeFilteredWrite(
  toks: SqlTok[],
  dep: number[],
  op: "UPDATE" | "DELETE",
  isTenant: (name: string) => boolean,
  refuse: Refuse,
  fns: CallLists,
): TenantAnalysis {
  const W = (detail: string, t?: string): TenantAnalysis => refuse("E-TENANT-WRITE", "write-shape", detail, t);
  let k = 1;
  if (op === "UPDATE" && isKw(toks[k], "OR")) {
    return W("an author-written `UPDATE OR …` conflict clause (the floor sets the conflict resolution of a tenant write)");
  }
  if (op === "DELETE") {
    if (!isKw(toks[k], "FROM")) return W("a DELETE the floor cannot read (expected FROM)");
    k++;
  }
  const target = toks[k];
  if (target === undefined || target.kind !== "ident" || isP(toks[k + 1], ".")) return W(`a schema-qualified or missing ${op} target`);
  if (!isTenant(target.text)) return W("a write that names a tenant-scoped table outside its target");
  k++;
  // Every other tenant-table name must be the target itself (a qualifier, `assets.id`).
  for (const t of toks) {
    if (t.kind === "ident" && isTenant(t.text) && t.text.toLowerCase() !== target.text.toLowerCase()) {
      return W("a write that names a second tenant-scoped table", target.text);
    }
  }
  const T = target.text;
  if (op === "UPDATE") {
    if (!isKw(toks[k], "SET")) return W("an UPDATE the floor cannot read (an alias, INDEXED BY, or no SET)", T);
    k++;
    // col = expr [, col = expr]* until a top-level WHERE or the end.
    for (;;) {
      const col = toks[k];
      if (col === undefined || col.kind !== "ident" || isP(toks[k + 1], ".") || !isP(toks[k + 1], "=")) {
        return W("an UPDATE SET list that is not `column = value` pairs", T);
      }
      if (col.text.toLowerCase() === TENANT_COLUMN) return W("an UPDATE that sets tenant_id (it would move the row to another tenant)", T);
      k += 2;
      const exprStart = k;
      while (k < toks.length && !(dep[k] === 0 && (isP(toks[k], ",") || isKw(toks[k], "WHERE")))) {
        if (dep[k] === 0 && toks[k].kind === "ident" && ["FROM", "ORDER", "LIMIT"].includes(toks[k].up)) {
          return W(`an UPDATE with ${toks[k].up} (only SET and WHERE are in the subset)`, T);
        }
        k++;
      }
      if (k === exprStart) return W("an UPDATE SET with no value", T);
      if (k < toks.length && isP(toks[k], ",")) { k++; continue; }
      break;
    }
  }
  let whereEnd = -1;
  if (k < toks.length) {
    if (!isKw(toks[k], "WHERE")) return W(`a ${op} with a clause the subset does not have (\`${toks[k].text}\`)`, T);
    whereEnd = toks[k].end;
    if (k + 1 >= toks.length) return W(`an empty WHERE`, T);
    for (let j = k + 1; j < toks.length; j++) {
      if (dep[j] === 0 && toks[j].kind === "ident" && ["ORDER", "LIMIT", "GROUP", "HAVING", "FROM"].includes(toks[j].up)) {
        return W(`a ${op} with ${toks[j].up} after WHERE (only the WHERE condition is in the subset)`, T);
      }
    }
  }
  const bad = firstDisallowedCall(toks, new Set(), fns.row);
  if (bad !== null) return W(`a call to \`${bad}\`, which is not on the per-row function allow-list`, T);
  return { kind: "filtered-write", table: T, op, whereEnd, leaderEnd: toks[0].end };
}

// ---------------------------------------------------------------------------
// Rewrites — positions come from the analysis, applied to the RAW body so the
// `${…}` parameters are preserved verbatim.
// ---------------------------------------------------------------------------

/** The raw offset of a subset body's top-level FROM keyword, or -1 (outside the subset / none). */
export function topLevelFromOffset(raw: string): number {
  const lex = lexTenantSubset(raw);
  if (!lex.ok) return -1;
  const dep = depths(lex.toks);
  if (dep === null) return -1;
  const k = lex.toks.findIndex((t, j) => dep[j] === 0 && isKw(t, "FROM"));
  return k === -1 ? -1 : lex.toks[k].start;
}

/** Append the key-column fragments to the projection, just before the top-level FROM. */
export function addKeyColumnsBeforeFrom(raw: string, fromAt: number, adds: string[]): string {
  if (adds.length === 0) return raw;
  return `${raw.slice(0, fromAt).replace(/\s*$/, "")}, ${adds.join(", ")} ${raw.slice(fromAt)}`;
}

/**
 * S452 r4 — SQLite's conflict resolution can be declared on the TABLE
 * (`name TEXT UNIQUE ON CONFLICT REPLACE`), and REPLACE deletes the conflicting
 * row whoever owns it: measured, tenant A's scoped `UPDATE assets SET name =
 * 'B-secret-asset' WHERE id = 1` deleted tenant B's row. A statement-level
 * conflict clause overrides the table's, so every injected SQLite INSERT /
 * UPDATE carries `OR ABORT` (the constraint error surfaces; no other row is
 * touched). `leaderEnd` is the offset just past the INSERT / UPDATE keyword;
 * every other edit lies after it, so it is applied last.
 */
function withOrAbort(edited: string, leaderEnd: number | null): string {
  if (leaderEnd === null) return edited;
  return `${edited.slice(0, leaderEnd)} OR ABORT${edited.slice(leaderEnd)}`;
}

/**
 * Inject `tenant_id` into an analysed INSERT's column list and `${ambientExpr}`
 * into its VALUES tuple; with `orAbortAt` (the SQLite dialect) also `OR ABORT`.
 */
export function injectInsertTenant(
  raw: string, colsClose: number, valsClose: number, ambientExpr: string, orAbortAt: number | null = null,
): string {
  return withOrAbort(
    raw.slice(0, colsClose).replace(/\s*$/, "") + `, ${TENANT_COLUMN}` +
      raw.slice(colsClose, valsClose).replace(/\s*$/, "") + `, \${${ambientExpr}}` +
      raw.slice(valsClose),
    orAbortAt,
  );
}

/**
 * Constrain an analysed UPDATE / DELETE to the active tenant: the author's WHERE
 * is parenthesized whole (the `OR`-precedence hazard cannot arise — the subset
 * has no clause after WHERE) and `tenant_id = ${ambientExpr}` is ANDed on; a
 * statement with no WHERE gets one. With `orAbortAt` (a SQLite UPDATE) also
 * `OR ABORT` (DELETE has no conflict clause).
 */
export function injectWriteTenantFilter(
  raw: string, whereEnd: number, ambientExpr: string, orAbortAt: number | null = null,
): string {
  const pred = `${TENANT_COLUMN} = \${${ambientExpr}}`;
  const edited = whereEnd === -1
    ? `${raw.replace(/\s*$/, "")} WHERE ${pred}`
    : `${raw.slice(0, whereEnd)} (${raw.slice(whereEnd).trim()}) AND ${pred}`;
  return withOrAbort(edited, orAbortAt);
}
