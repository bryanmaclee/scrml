/**
 * §14.8.10 — the tenant floor's SCHEMA boundary (S455, ruling "go, comp-time schema").
 *
 * The tenant floor constrains each QUERY to the active tenant. Four review rounds
 * (S452 r1–r4) found the same class again and again: the database runs SQL the
 * query never contained — a trigger's body, a view's definition, a foreign key's
 * `ON DELETE` action — and that SQL is not scoped. Patching the per-statement
 * classifier closed one spelling at a time. The ruling moves the boundary: a
 * `<schema>` that DECLARES such an object against a tenant-scoped table is a
 * compile error at the declaration (`E-TENANT-SCHEMA-HAZARD`), whatever the
 * program's queries do.
 *
 * THE STATEMENT KINDS ARE AN ALLOW-LIST (S455 "your rec on the allow-list"): in a
 * compilation with a tenant-scoped table a `<schema>` admits only CREATE TABLE / INDEX /
 * VIEW / TRIGGER, admitted ALTER TABLE actions, CREATE POLICY … AS RESTRICTIVE, GRANT …
 * TO scrml_app, COMMENT ON, ANALYZE, REINDEX, VACUUM (`ADMITTED_PLAIN_LEADERS`,
 * `alterAdmission`); everything else is charged ("statement not admitted in a tenant
 * schema"), as is an isolation removal (`isolationRemoval`). WITHIN the admitted kinds:
 *
 * WHAT IS CHARGED (when the compilation declares at least one tenant-scoped table):
 *   1. a TRIGGER (any timing, `INSTEAD OF` included, on a table or a view) declared
 *      ON a tenant-scoped table, or whose body names one;
 *   2. a Postgres RULE on, or whose action names, a tenant-scoped table;
 *   3. a FOREIGN KEY whose `ON DELETE` / `ON UPDATE` action is `CASCADE`,
 *      `SET NULL` or `SET DEFAULT`, when either end is tenant-scoped;
 *   4. a VIEW (materialized included) whose definition names a tenant-scoped
 *      table, directly or through another view;
 *   and, under the ruling's fail-closed clause, any declaration the checker
 *   cannot attribute: a trigger / rule / view whose text it cannot read, or that
 *   calls a function off the floor's allow-list, or holds a `${…}`; a function /
 *   procedure / `DO` body (code the floor never sees, callable from any query);
 *   and any other `<schema>` statement that names a tenant-scoped table (or a view
 *   over one) — `CREATE TABLE … AS SELECT`, `INHERITS`, an FTS `content=` table,
 *   a rename.
 *
 * "Names" is deliberately wide, mirroring §14.8.10 "Detection does not trust a
 * query it cannot read": an identifier token naming the table, OR a whole-word
 * occurrence inside a string literal (Postgres `query_to_xml('select … from
 * assets', …)` reads a table held in a string).
 *
 * COMMENTS. What the DATABASE treats as a comment depends on the dialect (SQLite
 * and Postgres disagree on nesting `/* /* *\/ *\/`; MySQL runs `/*! … *\/` and does
 * not treat `--x` as a comment). The checker therefore reads the body THREE ways
 * and charges the union: comments removed (non-nesting), comments removed
 * (nesting), and every comment's content read as live declarations (so a
 * commented-out declaration still counts, as it did for the S452 r4 per-write
 * limb). No reading can mask another's finding.
 *
 * LIMIT (unchanged, SPEC §14.8.10): only `<schema>` text is visible. A trigger,
 * view, rule or cascading key created outside it — an external database, a
 * `<db src>` with no `<schema>`, a migration run by hand — is not seen.
 *
 * Pure: no I/O, no AST. Called from GCP1 (`gauntlet-phase1-checks.js`, the
 * declaration-time error) and from `codegen/emit-server.ts` (for tables made
 * tenant-scoped by the `<db>` registry rather than by `<schema>`).
 */

import { TENANT_ROW_FUNCTIONS, TENANT_GROUP_AGGREGATES } from "./codegen/tenant-sql-subset.ts";
import { schemaTableDeclarations, DBAUTH_ROLE } from "./schema-differ.js";

/** The hazard kinds (the `kind` named in the diagnostic). */
export type SchemaHazardKind =
  | "trigger" | "rule" | "foreign key" | "view" | "function" | "statement" | "permissive policy" | "isolation removal"
  | "statement not admitted in a tenant schema";

export interface SchemaHazard {
  kind: SchemaHazardKind;
  /** The declared object's name (`t_cfg`), or a description for an FK / statement. */
  object: string;
  /** The tenant-scoped tables involved (every one, for an unattributable hazard). */
  tables: string[];
  /** Why it is charged — the clause of the message after the object. */
  why: string;
  /** True when the checker could not attribute the declaration and charged it to every tenant table. */
  unattributable: boolean;
  /** Offset of the declaration in the `<schema>` body. */
  offset: number;
}

// ---------------------------------------------------------------------------
// The lexer
// ---------------------------------------------------------------------------

/**
 * w = bare word · q = quoted identifier · s = string literal (t = its content)
 * n = number · p = punctuation · b = statement boundary (a `?{` / `}` wrapper edge)
 */
interface Tok {
  k: "w" | "q" | "s" | "n" | "p" | "b"; t: string; up: string; at: number; sql: boolean;
  /**
   * A quoted form whose extent depends on the dialect, so this lexer cannot model it
   * exactly: a backslash inside a quote (MySQL escapes it; SQLite and Postgres do not)
   * or a Postgres `E'…'` / `U&'…'` string. Where one sits, a later token may be code in
   * one dialect and string text in another — the checker charges it (fail-closed).
   */
  odd?: boolean;
}

type CommentMode = "skip" | "skip-nested" | "content";

const WORD_START = /[A-Za-z_\u0080-￿]/;
const WORD_CHAR = /[A-Za-z0-9_$\u0080-￿]/;

/**
 * Tokenize `text[from, to)`. Never throws; an unterminated literal runs to the end.
 * `sql0` = whether the range starts inside a `?{ … }` wrapper.
 */
function lex(text: string, mode: CommentMode, from = 0, to = text.length, sql0 = false): Tok[] {
  const out: Tok[] = [];
  let i = from;
  let wrap = sql0 ? 1 : 0;      // `?{` wrappers open
  let braces = 0;               // `{` opened inside the current wrapper (a `${`)
  const push = (k: Tok["k"], t: string, at: number, odd = false): void => {
    out.push({ k, t, up: k === "w" ? t.toUpperCase() : t, at, sql: wrap > 0, ...(odd ? { odd: true } : {}) });
  };
  const comment = (start: number, end: number, cFrom: number, cTo: number): void => {
    // `content` mode reads a comment's text as declarations (a commented-out one counts).
    if (mode === "content" && cTo > cFrom) {
      for (const t of lex(text, "content", cFrom, cTo, wrap > 0)) out.push(t);
    }
    i = end;
    void start;
  };
  while (i < to) {
    const c = text[i];
    const c2 = text[i + 1];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "-" && c2 === "-") {
      let e = text.indexOf("\n", i);
      if (e === -1 || e > to) e = to;
      comment(i, e, i + 2, e);
      continue;
    }
    if (c === "/" && c2 === "*") {
      let depth = 1;
      let j = i + 2;
      while (j < to && depth > 0) {
        if (text[j] === "*" && text[j + 1] === "/") { depth--; j += 2; continue; }
        if (mode === "skip-nested" && text[j] === "/" && text[j + 1] === "*") { depth++; j += 2; continue; }
        j++;
      }
      const cEnd = depth > 0 ? to : j - 2;
      comment(i, Math.min(j, to), i + 2, cEnd);
      continue;
    }
    if (c === "'") {
      let j = i + 1;
      let s = "";
      while (j < to) {
        if (text[j] === "'" && text[j + 1] === "'") { s += "'"; j += 2; continue; }
        if (text[j] === "'") break;
        s += text[j++];
      }
      const prefixed = (/[Ee]/.test(text[i - 1] ?? "") && !WORD_CHAR.test(text[i - 2] ?? " ")) ||
        (text[i - 1] === "&" && /[Uu]/.test(text[i - 2] ?? ""));
      push("s", s, i, prefixed || s.includes("\\") || s.includes("${") || j >= to);
      i = Math.min(j + 1, to);
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      let s = "";
      while (j < to) {
        if (text[j] === '"' && text[j + 1] === '"') { s += '"'; j += 2; continue; }
        if (text[j] === '"') break;
        s += text[j++];
      }
      push("q", s, i, s.includes("\\") || s.includes("${") || j >= to);
      i = Math.min(j + 1, to);
      continue;
    }
    if (c === "$") {
      // `${` — an interpolation (JavaScript, never SQL text).
      if (c2 === "{") { push("p", "${", i); braces++; i += 2; continue; }
      // Postgres dollar quoting: `$tag$ … $tag$` is a string literal.
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(text.slice(i, Math.min(to, i + 64)));
      if (m) {
        const close = text.indexOf(m[0], i + m[0].length);
        if (close !== -1 && close < to) {
          push("s", text.slice(i + m[0].length, close), i);
          i = close + m[0].length;
          continue;
        }
      }
      push("p", "$", i); i++; continue;
    }
    if (c === "?" && c2 === "{") {
      // A `?{ … }` wrapper: SQL inside. Its template backtick is part of the edge.
      push("b", "?{", i);
      wrap++; braces = 0;
      i += 2;
      while (i < to && /\s/.test(text[i])) i++;
      if (text[i] === "`") i++;
      continue;
    }
    if (c === "`") {
      if (wrap > 0) {
        // Inside a wrapper a backtick is only the template delimiter.
        i++; continue;
      }
      // Outside one: a MySQL quoted identifier, when it closes on the same line.
      const close = text.indexOf("`", i + 1);
      const nl = text.indexOf("\n", i + 1);
      if (close !== -1 && close < to && (nl === -1 || close < nl)) {
        push("q", text.slice(i + 1, close), i);
        i = close + 1;
        continue;
      }
      push("b", "`", i); i++; continue;
    }
    if (c === "{") { if (wrap > 0) braces++; push("p", "{", i); i++; continue; }
    if (c === "}") {
      if (wrap > 0 && braces === 0) { wrap--; push("b", "}", i); i++; continue; }
      if (wrap > 0) braces--;
      push("p", "}", i); i++; continue;
    }
    if (c === "[") {
      const close = text.indexOf("]", i + 1);
      const nl = text.indexOf("\n", i + 1);
      if (close !== -1 && close < to && (nl === -1 || close < nl) && close > i + 1) {
        push("q", text.slice(i + 1, close), i);
        i = close + 1;
        continue;
      }
      push("p", "[", i); i++; continue;
    }
    if (WORD_START.test(c)) {
      let j = i + 1;
      while (j < to && WORD_CHAR.test(text[j])) j++;
      push("w", text.slice(i, j), i);
      i = j;
      continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i + 1;
      while (j < to && /[0-9A-Za-z_.]/.test(text[j])) j++;
      push("n", text.slice(i, j), i);
      i = j;
      continue;
    }
    push("p", c, i);
    i++;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Token helpers
// ---------------------------------------------------------------------------

const isW = (t: Tok | undefined, up?: string): boolean => !!t && t.k === "w" && (up === undefined || t.up === up);
const isP = (t: Tok | undefined, p: string): boolean => !!t && t.k === "p" && t.t === p;
const isName = (t: Tok | undefined): boolean => !!t && (t.k === "w" || t.k === "q");

/** Read a possibly-qualified name at `i`: returns its LAST part (lowercased) and the next index. */
function readName(toks: Tok[], i: number): { name: string; next: number } | null {
  if (!isName(toks[i])) return null;
  let j = i;
  let last = toks[j];
  while (isP(toks[j + 1], ".") && isName(toks[j + 2])) { j += 2; last = toks[j]; }
  return { name: last.t.toLowerCase(), next: j + 1 };
}

/**
 * End of the statement starting at `i` (exclusive): a `;` at paren depth 0, a wrapper
 * edge, the end — or, at depth 0, the start of the NEXT declaration: a `<schema>` body
 * may hold bare DDL with no `;` between statements (`CREATE TABLE a (…)` newline
 * `CREATE TABLE b (…)`), and a DSL `name {` head. No view / trigger / rule body can
 * contain a bare CREATE (SQLite and Postgres trigger and rule bodies are DML), so
 * stopping there never cuts a body short.
 */
function statementEnd(toks: Tok[], i: number): number {
  let depth = 0;
  // In `GRANT` / `REVOKE`, `CREATE` is a PRIVILEGE (`GRANT CREATE ON SCHEMA …`), not the
  // next declaration — the statement runs to its `;` / wrapper edge (S239 review FP).
  const privileges = isW(toks[i], "GRANT") || isW(toks[i], "REVOKE");
  for (let j = i; j < toks.length; j++) {
    const t = toks[j];
    if (t.k === "b") return j;
    if (j > i && depth === 0 && ((isW(t, "CREATE") && !privileges) || (t.k === "w" && !t.sql && isP(toks[j + 1], "{")))) return j;
    if (t.k === "p") {
      if (t.t === "(") depth++;
      else if (t.t === ")") depth = Math.max(0, depth - 1);
      else if (t.t === ";" && depth === 0) return j;
    }
  }
  return toks.length;
}

/** True when token `i` cannot continue the current statement: `;`, a wrapper edge, the next declaration, or the end. */
function endsDeclaration(toks: Tok[], i: number): boolean {
  const t = toks[i];
  if (t === undefined || t.k === "b" || isP(t, ";") || isW(t, "CREATE")) return true;
  return t.k === "w" && !t.sql && isP(toks[i + 1], "{");
}

/** Index just past the `)` matching the `(` at `i`, or -1. */
function closeParen(toks: Tok[], i: number): number {
  let depth = 0;
  for (let j = i; j < toks.length; j++) {
    const t = toks[j];
    if (t.k === "b") return -1;
    if (isP(t, "(")) depth++;
    else if (isP(t, ")")) { depth--; if (depth === 0) return j + 1; }
  }
  return -1;
}

/**
 * Words that can never be a function name (reserved in Postgres, or a column-name keyword
 * that cannot name a function, and reserved in SQLite) — `X (` after one is syntax.
 */
const SYNTAX_WORDS_BEFORE_PAREN = new Set([
  "AND", "OR", "NOT", "IN", "CHECK", "DEFAULT", "UNIQUE", "AS", "WHEN", "THEN", "ELSE", "CASE", "WITH",
  "ANY", "ALL", "SOME", "ARRAY", "FROM", "TO", "ON", "DISTINCT", "USING", "IS", "FOR", "WHERE", "ROW",
  "BETWEEN", "SELECT", "VALUES", "EXISTS", "HAVING", "LIMIT", "OFFSET", "UNION", "INTERSECT", "EXCEPT",
  "LATERAL", "WINDOW", "RETURNING", "FETCH", "ONLY",
]);
/** Infix operator keywords: `x LIKE (…)` is syntax; `LIKE(` NOT after an operand is a call. */
const INFIX_WORDS = new Set(["LIKE", "ILIKE", "GLOB", "MATCH", "REGEXP", "SIMILAR"]);

/** Does token `t` end an operand (so a following infix keyword is an operator)? */
function endsOperand(t: Tok | undefined): boolean {
  return !!t && (t.k === "q" || t.k === "s" || t.k === "n" || isP(t, ")") || (t.k === "w" && !SYNTAX_WORDS_BEFORE_PAREN.has(t.up)));
}

/**
 * THE CLOSED SET of `identifier (` forms that are NOT a function call. Every other
 * `identifier (` — at any depth, after FROM / JOIN / ON included, unreserved keywords such
 * as `match` / `range` included — is a CALL checked against an allow-list (S239 reviews of
 * 8d1e18b6 and d4c4d4ac; S455 PA probe of 50150700). A table reference never takes `(`;
 * the only "name (" forms that are not calls are a column list after `INSERT INTO t`,
 * `REFERENCES t`, `CREATE VIEW v`, a CTE name (`x (…) AS (`), and the syntax below.
 */
function isSyntacticParen(toks: Tok[], k: number): boolean {
  const t = toks[k];
  const prev = toks[k - 1];
  const up = t.k === "w" ? t.up : "";
  if (t.k === "w" && SYNTAX_WORDS_BEFORE_PAREN.has(up)) return true;
  if (up === "JOIN" && (isW(toks[k + 2], "SELECT") || isW(toks[k + 2], "WITH") || isW(toks[k + 2], "VALUES") || isP(toks[k + 2], "("))) return true;
  if (INFIX_WORDS.has(up) && endsOperand(prev)) return true;
  if ((up === "OVER" || up === "FILTER") && isP(prev, ")")) return true;
  if (up === "CONFLICT" && isW(prev, "ON")) return true;
  if (up === "MATERIALIZED" && (isW(prev, "AS") || isW(prev, "NOT"))) return true;
  if (up === "KEY" && (isW(prev, "PRIMARY") || isW(prev, "FOREIGN"))) return true;
  if ((up === "RANGE" || up === "LIST" || up === "HASH") && isW(prev, "BY") && isW(toks[k - 2], "PARTITION")) return true;
  if (up === "IDENTITY" && isW(prev, "AS")) return true;
  if ((up === "INCLUDE" || up === "INHERITS") && isP(prev, ")")) return true;
  if (up === "EXCLUDE" && (isP(prev, ",") || isP(prev, "(") || isW(toks[k - 2], "CONSTRAINT"))) return true;
  if (t.k === "w" && INDEX_METHODS.has(t.t.toLowerCase()) && isW(prev, "USING")) return true;
  // a column list after a table / view name: REFERENCES t (…), INSERT INTO t (…), CREATE VIEW v (…)
  const head = isP(prev, ".") ? toks[k - 3] : prev;
  if (isW(head, "REFERENCES") || isW(head, "INTO") || isW(head, "VIEW")) return true;
  // a CTE with a column list: `x (a, b) AS (` / `AS [NOT] MATERIALIZED (`
  {
    const c = closeParen(toks, k + 1);
    if (c !== -1 && isW(toks[c], "AS") &&
        (isP(toks[c + 1], "(") || isW(toks[c + 1], "MATERIALIZED") || (isW(toks[c + 1], "NOT") && isW(toks[c + 2], "MATERIALIZED")))) return true;
  }
  // a sized built-in type in a type position: `::varchar(64)`, `CAST(x AS numeric(10, 2))`
  if (t.k === "w" && SIZED_TYPES.has(t.t.toLowerCase()) && (isW(prev, "AS") || typePositionAt(toks, k, new Set()))) return true;
  return false;
}

/** The functions a declaration body may call: the floor's per-row allow-list, its aggregates, and `RAISE`. */
const ALLOWED_CALLS: ReadonlySet<string> = new Set([...TENANT_ROW_FUNCTIONS, ...TENANT_GROUP_AGGREGATES, "raise"]);

/**
 * The calls an EXPRESSION in an exempt statement or a column definition may make — an
 * index expression / predicate, a column `DEFAULT` / `GENERATED` / `CHECK`, a table
 * `CHECK`. The criterion is NO SIDE EFFECT AND NO CODE EXECUTION — not determinism:
 * `DEFAULT now()` and `DEFAULT gen_random_uuid()` are on almost every real Postgres
 * table, and neither reads nor writes a table, locks, notifies or runs user code. The
 * view/trigger list above, plus side-effect-free built-ins: Postgres clock functions,
 * UUID / random / hashing, string length / formatting, date arithmetic; SQLite
 * date/time, `unixepoch`, `randomblob`, `hex`. `uuid_generate_v4` is the uuid-ossp
 * extension's — side-effect-free, kept. EXCLUDED: anything that can write, lock,
 * notify or run arbitrary code (`dblink*`, `pg_advisory*`, `set_config`, `lo_*`,
 * `pg_notify`, any user function). `nextval` advances a sequence — a write — and is
 * allowed ONLY directly as a column `DEFAULT` (`readRegion` `columnDefault`): that is
 * how `serial` expands, the advance happens on an INSERT into that column's own table,
 * and a sequence counter carries no tenant's row; anywhere else it is charged.
 */
const EXPRESSION_ALLOWED_CALLS: ReadonlySet<string> = new Set([
  ...ALLOWED_CALLS,
  "now", "current_timestamp", "current_date", "current_time", "clock_timestamp", "statement_timestamp",
  "transaction_timestamp", "localtimestamp", "localtime", "gen_random_uuid", "uuid_generate_v4", "random",
  "md5", "char_length", "octet_length", "to_char", "date_trunc", "extract", "date_part", "make_interval",
  "unixepoch", "randomblob", "hex", "greatest", "least", "position",
  // S239 review FP list — each a pure built-in (reads only its arguments / the session's
  // own settings; writes, locks and notifies nothing): Postgres text search parsing, JSON
  // and array inspection, string / number formatting, date arithmetic; SQLite
  // `json_valid` / `iif` / `typeof` / `printf`. `current_setting` reads a GUC — it is THE
  // tenant pattern of a §14.8.11 policy (`current_setting('scrml.tenant', true)`).
  "to_tsvector", "to_tsquery", "json_valid", "iif", "typeof", "printf", "left", "right", "floor", "ceil",
  "ceiling", "trunc", "concat", "concat_ws", "split_part", "regexp_replace", "regexp_match",
  "regexp_matches", "btrim", "initcap", "lpad", "rpad", "format", "age", "to_timestamp", "to_date",
  "current_setting", "jsonb_typeof", "json_typeof", "array_length", "cardinality", "mod", "power", "sign",
  "sqrt", "overlay", "reverse", "repeat", "starts_with", "ascii", "chr",
]);

interface RegionRead {
  /** Tainted names (tenant tables, views over them) the region names. */
  names: string[];
  /** Calls off the allow-list. */
  calls: string[];
  /** A `${…}` interpolation (JavaScript — the checker cannot read it). */
  interp: boolean;
}

/** Whole-word occurrences of `names` inside a string literal. */
function stringMentions(s: string, names: Iterable<string>): string[] {
  const out: string[] = [];
  const lower = s.toLowerCase();
  for (const n of names) {
    const re = new RegExp(`(^|[^A-Za-z0-9_$])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^A-Za-z0-9_$])`);
    if (re.test(lower)) out.push(n);
  }
  return out;
}

/** What the tokens `[from, to)` name and call. */
function readRegion(toks: Tok[], from: number, to: number, tainted: ReadonlySet<string>): RegionRead {
  const names = new Set<string>();
  const calls: string[] = [];
  let interp = false;
  // EVERY `identifier (` is a CALL unless it is one of the closed syntactic forms
  // (`isSyntacticParen`) — at any depth, in any clause. A table reference never takes
  // `(`: `FROM evil(1)`, `JOIN evil(1) ON true`, `(SELECT * FROM evil())` are table
  // FUNCTIONS (S239 review of d4c4d4ac, executed: `CREATE VIEW v AS SELECT * FROM evil(1)`
  // passed), and inside a call FROM / ON / JOIN introduce nothing (`substring('a' FROM
  // evil(1))`, S455 PA probe of 50150700). A callee may be QUOTED (`"query_to_xml"(…)` is a
  // call in Postgres; `[f](…)` in SQLite) — a quoted name is never a keyword, and is case-exact.
  for (let k = from; k < to; k++) {
    const t = toks[k];
    if (t.k === "p" && t.t === "${") interp = true;
    if ((t.k === "w" || t.k === "q") && tainted.has(t.t.toLowerCase())) names.add(t.t.toLowerCase());
    if (t.k === "s") for (const n of stringMentions(t.t, tainted)) names.add(n);
    if (!((t.k === "w" || t.k === "q") && isP(toks[k + 1], "("))) continue;
    if (isSyntacticParen(toks, k)) continue;
    if (isP(toks[k - 1], ".")) { calls.push(`${toks[k - 2]?.t ?? ""}.${t.t}`); continue; }
    if (!ALLOWED_CALLS.has(t.k === "q" ? t.t : t.t.toLowerCase())) calls.push(t.t);
  }
  return { names: [...names], calls, interp };
}

// ---------------------------------------------------------------------------
// Declarations
// ---------------------------------------------------------------------------

/** Words that may stand between CREATE and the object keyword. */
const CREATE_MODIFIERS = new Set([
  "OR", "REPLACE", "TEMP", "TEMPORARY", "UNLOGGED", "GLOBAL", "LOCAL", "MATERIALIZED", "RECURSIVE",
  "CONSTRAINT", "UNIQUE", "VIRTUAL", "EVENT", "FOREIGN", "ALGORITHM", "DEFINER", "SQL", "SECURITY",
  "INVOKER", "MERGE", "UNDEFINED", "TEMPTABLE", "TRUSTED", "PROCEDURAL", "AGGREGATE",
]);

interface Decl {
  kind: "view" | "trigger" | "rule" | "table" | "index" | "function" | "other";
  name: string;              // lowercased last part, "" when unreadable
  shown: string;             // name as written, for messages
  at: number;                // body offset
  start: number;             // token index of CREATE
  end: number;               // token index past the statement
  /** trigger / rule: the table or view it is declared ON; table: its own name. */
  on?: string;
  /** Token range read for names / calls. */
  region: [number, number];
  /** Why the checker could not read it, or null. */
  unreadable: string | null;
  /** table: the column-list token range (the FK attribution context). */
  cols?: [number, number];
  flags: Set<string>;
  /** "other": the object keyword (`FUNCTION`, `TABLE` for a virtual table, …). */
  object?: string;
}

/** Parse the CREATE statement at token `i`. */
function parseCreate(toks: Tok[], i: number): Decl {
  const flags = new Set<string>();
  let j = i + 1;
  // Modifiers, MySQL `DEFINER = user` / `ALGORITHM = x` / `SQL SECURITY x` included.
  while (j < toks.length) {
    const t = toks[j];
    if (t.k === "w" && CREATE_MODIFIERS.has(t.up)) {
      flags.add(t.up);
      if ((t.up === "DEFINER" || t.up === "ALGORITHM") && isP(toks[j + 1], "=")) {
        j += 2;
        // user, `'u'@'h'`, CURRENT_USER, …
        while (j < toks.length && (isName(toks[j]) || toks[j].k === "s" || isP(toks[j], "@") || isP(toks[j], "(") || isP(toks[j], ")"))) {
          if (isW(toks[j], "SQL") || isW(toks[j], "VIEW") || isW(toks[j], "TRIGGER") || isW(toks[j], "PROCEDURE") || isW(toks[j], "FUNCTION") || isW(toks[j], "EVENT")) break;
          j++;
        }
        continue;
      }
      j++;
      continue;
    }
    break;
  }
  const obj = toks[j];
  const end0 = statementEnd(toks, i);
  const base: Decl = {
    kind: "other", name: "", shown: "", at: toks[i].at, start: i, end: end0,
    region: [j, end0], unreadable: null, flags, object: obj && obj.k === "w" ? obj.up : "?",
  };
  if (!obj || obj.k !== "w") {
    base.unreadable = "the object kind after CREATE could not be read";
    return base;
  }
  let k = j + 1;
  if (isW(toks[k], "IF") && isW(toks[k + 1], "NOT") && isW(toks[k + 2], "EXISTS")) k += 3;
  const nm = readName(toks, k);
  if (nm) { base.name = nm.name; base.shown = toks[nm.next - 1].t; k = nm.next; }

  if (obj.up === "VIEW") {
    base.kind = "view";
    if (!nm) { base.unreadable = "its name could not be read"; return base; }
    // The definition: everything after AS (the column list and WITH options precede it).
    let a = k;
    let depth = 0;
    for (; a < end0; a++) {
      if (isP(toks[a], "(")) depth++;
      else if (isP(toks[a], ")")) depth--;
      else if (depth === 0 && isW(toks[a], "AS")) break;
    }
    if (a >= end0) { base.unreadable = "no `AS <query>` was found"; base.region = [k, end0]; return base; }
    base.region = [a + 1, end0];
    return base;
  }

  if (obj.up === "TRIGGER") {
    base.kind = "trigger";
    if (flags.has("EVENT")) {
      // A Postgres event trigger runs a function on DDL — a body the checker cannot read.
      base.unreadable = "an event trigger runs a function the checker cannot read";
      return base;
    }
    if (!nm) { base.unreadable = "its name could not be read"; return base; }
    // Timing + events up to `ON <table>`.
    let o = k;
    for (; o < toks.length; o++) {
      const t = toks[o];
      if (t.k === "b" || isP(t, ";")) { o = toks.length; break; }
      if (isW(t, "ON")) break;
      if (!(t.k === "w" || t.k === "q" || isP(t, ","))) { o = toks.length; break; }
    }
    const tbl = o < toks.length ? readName(toks, o + 1) : null;
    if (!tbl) { base.unreadable = "the table it is declared ON could not be read"; return base; }
    base.on = tbl.name;
    // The body: a SQLite / MySQL `BEGIN … END`, a Postgres `EXECUTE FUNCTION f()`, or
    // a MySQL single statement after FOR EACH ROW.
    //
    // ⚑ KEYWORDS ARE NOT RESERVED IN SQLITE. `begin`, `end`, `execute`, `case` are
    // ordinary column names there (a `WHEN NEW.begin = 1` clause, an
    // `INSERT INTO audit (v, end)` statement), so a bare keyword word is never by
    // itself a structural boundary: BEGIN / EXECUTE start the body only where a body
    // can start (not after `.`; EXECUTE only before FUNCTION / PROCEDURE), and the body
    // closes only at an END that ends a statement list (after `;`) AND is itself the
    // end of the CREATE (before `;`, a wrapper edge, the next declaration, or the end).
    // Whatever such a reading leaves unread is charged by the caller (`trailing`).
    let depth = 0;
    let b = tbl.next;
    for (; b < toks.length; b++) {
      const t = toks[b];
      if (t.k === "b") break;
      if (isP(t, "(")) depth++;
      else if (isP(t, ")")) depth = Math.max(0, depth - 1);
      else if (depth === 0 && isP(t, ";")) break;
      else if (depth === 0 && !isP(toks[b - 1], ".") &&
        (isW(t, "BEGIN") || (isW(t, "EXECUTE") && (isW(toks[b + 1], "FUNCTION") || isW(toks[b + 1], "PROCEDURE"))))) break;
    }
    const head: [number, number] = [tbl.next, b];
    if (isW(toks[b], "EXECUTE")) {
      const fnAt = isW(toks[b + 1], "FUNCTION") || isW(toks[b + 1], "PROCEDURE") ? b + 2 : b + 1;
      const fn = readName(toks, fnAt);
      base.end = statementEnd(toks, b);
      base.region = [head[0], base.end];
      base.unreadable = `its body is the function \`${fn ? toks[fn.next - 1].t : "?"}\`, which the checker cannot read`;
      return base;
    }
    if (isW(toks[b], "BEGIN")) {
      // The LAST qualifying END before the next declaration or wrapper edge: a nested
      // `BEGIN … END;` block (MySQL) or a following `END` cannot cut the body short;
      // reading too far only over-reads (fail-closed).
      let e = toks.length;
      let k2 = b + 1;
      for (; k2 < toks.length; k2++) {
        const t = toks[k2];
        if (t.k === "b" || isW(t, "CREATE") || (t.k === "w" && !t.sql && isP(toks[k2 + 1], "{"))) break;
        if (isW(t, "END") && isP(toks[k2 - 1], ";") && endsDeclaration(toks, k2 + 1)) e = k2;
      }
      if (e === toks.length) {
        // No closing END before the boundary: read up to it, charge it unclosed.
        base.end = k2;
        base.region = [head[0], k2];
        base.unreadable = "its `BEGIN … END` body is not closed";
        return base;
      }
      base.end = e + 1;
      base.region = [head[0], e + 1];
      return base;
    }
    // MySQL `FOR EACH ROW <statement>`: the statement runs to the `;` found above.
    base.end = b;
    base.region = [head[0], b];
    return base;
  }

  if (obj.up === "RULE") {
    base.kind = "rule";
    if (!nm) { base.unreadable = "its name could not be read"; return base; }
    // `AS ON <event> TO <table>` — then `[WHERE …] DO [ALSO | INSTEAD] …`.
    if (!(isW(toks[k], "AS") && isW(toks[k + 1], "ON") && isW(toks[k + 3], "TO"))) {
      base.unreadable = "its `AS ON <event> TO <table>` could not be read";
      return base;
    }
    const tbl = readName(toks, k + 4);
    if (!tbl) { base.unreadable = "the table it is declared ON could not be read"; return base; }
    base.on = tbl.name;
    base.region = [tbl.next, end0];
    return base;
  }

  if (obj.up === "TABLE" && !flags.has("VIRTUAL") && !flags.has("FOREIGN")) {
    base.kind = "table";
    base.on = base.name;
    if (!nm) { base.unreadable = "its name could not be read"; return base; }
    if (isP(toks[k], "(")) {
      const close = closeParen(toks, k);
      if (close === -1) { base.unreadable = "its column list is not closed"; return base; }
      base.cols = [k, close];
      // Names / calls are read OUTSIDE the column list only (INHERITS, PARTITION OF, …).
      base.region = [close, end0];
      return base;
    }
    // `AS SELECT …`, `LIKE …`, `PARTITION OF …`, `OF type`: the rest is read.
    base.region = [k, end0];
    return base;
  }

  if (obj.up === "INDEX") { base.kind = "index"; return base; }

  if (obj.up === "FUNCTION" || obj.up === "PROCEDURE") {
    base.kind = "function";
    base.unreadable = `a ${obj.up.toLowerCase()} body is code the floor never sees, and any query can call it`;
    return base;
  }

  base.kind = "other";
  return base;
}

/** SQL object kinds a CREATE may name (SQLite, Postgres, MySQL). */
const KNOWN_OBJECTS = new Set([
  "TABLE", "VIEW", "TRIGGER", "RULE", "INDEX", "FUNCTION", "PROCEDURE", "POLICY", "PUBLICATION",
  "SUBSCRIPTION", "SEQUENCE", "TYPE", "DOMAIN", "SCHEMA", "EXTENSION", "SERVER", "STATISTICS",
  "AGGREGATE", "OPERATOR", "CAST", "COLLATION", "CONVERSION", "LANGUAGE", "TRANSFORM", "ROLE", "USER",
  "DATABASE", "TABLESPACE", "EVENT",
]);

/**
 * THE STATEMENT-KIND ALLOW-LIST (§14.8.10, ruling:user-voice-scrml.md S455 "your rec on
 * the allow-list"). In a compilation with ANY tenant-scoped table a `<schema>` admits
 * ONLY: `CREATE TABLE` · `CREATE INDEX` (allow-listed expressions) · `ALTER TABLE` with
 * admitted actions (`alterAdmission`) · `CREATE VIEW` / `CREATE TRIGGER` (hazard-checked) ·
 * `CREATE POLICY … AS RESTRICTIVE` · `GRANT <privileges> ON … TO scrml_app` · `COMMENT ON`
 * · `ANALYZE` · `REINDEX` · `VACUUM`. Every other statement is E-TENANT-SCHEMA-HAZARD,
 * kind "statement not admitted in a tenant schema", whether or not it names a tenant
 * table: privilege statements remove isolation without naming one (`GRANT scrml_app TO
 * evil`, `ALTER DEFAULT PRIVILEGES … TO PUBLIC`, `REASSIGN OWNED`, `CREATE PUBLICATION
 * FOR ALL TABLES`, an extension) and an enumerated deny-list never closes.
 * Supersedes the S455 "yes both" (ii) exemption list over statements naming a tenant table.
 *
 * These leaders evaluate no expression of their own; they are admitted outright (bar a `${…}`).
 */
const ADMITTED_PLAIN_LEADERS = new Set(["COMMENT", "ANALYZE", "REINDEX", "VACUUM"]);

/** The hazard kind for a statement outside the allow-list. */
const NOT_ADMITTED = "statement not admitted in a tenant schema" as const;

function notAdmitted(object: string, offset: number, allTenant: string[], why: string): SchemaHazard {
  return { kind: NOT_ADMITTED, object, tables: allTenant, unattributable: true, offset, why };
}

/**
 * §14.8.11's bounded application role (`schema-differ.js` `DBAUTH_ROLE`, emitted as
 * `CREATE ROLE scrml_app NOLOGIN NOBYPASSRLS`): the one grantee a `GRANT … ON
 * <tenant table>` may name without removing isolation.
 */
const APP_ROLE = DBAUTH_ROLE.toLowerCase();

/** Words after `ADD` in `ALTER TABLE` that add something other than a column. */
const ADD_NOT_A_COLUMN = new Set([
  "CONSTRAINT", "PRIMARY", "UNIQUE", "CHECK", "FOREIGN", "EXCLUDE", "INDEX", "KEY", "FULLTEXT",
  "SPATIAL", "PARTITION", "PERIOD", "SYSTEM",
]);

/**
 * The admitted `ALTER TABLE` actions (S455 "your rec on the allow-list"), over the action
 * tokens `[from, to)` (comma-separated at depth 0):
 *   `ADD [COLUMN] [IF NOT EXISTS] <col> …` · `ALTER [COLUMN] <col> SET NOT NULL | DROP NOT
 *   NULL | SET DEFAULT <expr> | DROP DEFAULT` · `RENAME [COLUMN] <a> TO <b>` · `ADD
 *   [CONSTRAINT <n>] CHECK (…)` · `ADD [CONSTRAINT <n>] FOREIGN KEY (…) REFERENCES …` with no
 *   `CASCADE` / `SET NULL` / `SET DEFAULT` action.
 * Returns the expression regions (column constraints, `SET DEFAULT`, `CHECK`) to hold to
 * the allow-list, or — for the first action not admitted — its leading words.
 */
function isTenantColumn(t: Tok | undefined): boolean {
  return !!t && (t.k === "w" || t.k === "q") && t.t.toLowerCase() === "tenant_id";
}

function alterAdmission(toks: Tok[], from: number, to: number): Array<[number, number]> | string {
  const actions: Array<[number, number]> = [];
  let depth = 0;
  let s = from;
  for (let k = from; k < to; k++) {
    if (isP(toks[k], "(")) depth++;
    else if (isP(toks[k], ")")) depth = Math.max(0, depth - 1);
    else if (isP(toks[k], ",") && depth === 0) { actions.push([s, k]); s = k + 1; }
  }
  actions.push([s, to]);
  const regions: Array<[number, number]> = [];
  for (const [a, b] of actions) {
    const shown = toks.slice(a, Math.min(b, a + 3)).map((t) => t.t).join(" ") || "(empty)";
    if (b <= a) return shown;
    let k = a + 1;
    if (isW(toks[a], "ADD")) {
      if (isW(toks[k], "CONSTRAINT") && isName(toks[k + 1])) k += 2;
      if (isW(toks[k], "CHECK") && isP(toks[k + 1], "(")) { regions.push([k, b]); continue; }
      if (isW(toks[k], "FOREIGN") && isW(toks[k + 1], "KEY")) {
        for (let j = k; j < b; j++) {
          if (isW(toks[j], "ON") && (isW(toks[j + 1], "DELETE") || isW(toks[j + 1], "UPDATE")) &&
              (isW(toks[j + 2], "CASCADE") || isW(toks[j + 2], "SET"))) return shown;
        }
        continue;
      }
      if (k !== a + 1) return shown;                        // ADD CONSTRAINT <n> <not CHECK / FK>
      if (isW(toks[k], "COLUMN")) k++;
      else if (toks[k]?.k === "w" && ADD_NOT_A_COLUMN.has(toks[k].up)) return shown;
      if (isW(toks[k], "IF") && isW(toks[k + 1], "NOT") && isW(toks[k + 2], "EXISTS")) k += 3;
      if (k >= b || !isName(toks[k])) return shown;
      if (columnTypeIssue(toks, k + 1, b)) return `${shown} (a type that is not built in)`;
      regions.push([columnExpressionsStart(toks, k, b), b]);
      continue;
    }
    if (isW(toks[a], "ALTER")) {
      if (isW(toks[k], "COLUMN")) k++;
      if (!isName(toks[k])) return shown;
      const col = toks[k];
      k++;
      const rest = toks.slice(k, b).map((t) => t.up);
      if ((rest[0] === "SET" || rest[0] === "DROP") && rest[1] === "NOT" && rest[2] === "NULL" && rest.length === 3) continue;
      // the tenant column's DEFAULT decides which tenant a row is written for — not the schema's to change
      if (isTenantColumn(col)) return shown;
      if (rest[0] === "DROP" && rest[1] === "DEFAULT" && rest.length === 2) continue;
      if (rest[0] === "SET" && rest[1] === "DEFAULT" && rest.length > 2) { regions.push([k + 2, b]); continue; }
      return shown;
    }
    if (isW(toks[a], "RENAME")) {
      if (isW(toks[k], "COLUMN")) k++;
      // renaming TO or FROM `tenant_id` re-assigns every row's tenant (S239 review of d4c4d4ac)
      if (isName(toks[k]) && !isW(toks[k], "TO") && isW(toks[k + 1], "TO") && isName(toks[k + 2]) && k + 3 === b &&
          !isTenantColumn(toks[k]) && !isTenantColumn(toks[k + 2])) continue;
      return shown;
    }
    return shown;
  }
  return regions;
}

/** Words that end a column's TYPE in a column definition (what follows is constraints / expressions). */
const COLUMN_CONSTRAINT_WORDS = new Set([
  "DEFAULT", "NOT", "NULL", "PRIMARY", "UNIQUE", "CHECK", "REFERENCES", "GENERATED", "COLLATE",
  "CONSTRAINT", "AS", "ON", "AUTO_INCREMENT", "AUTOINCREMENT", "COMMENT",
]);

/**
 * S239 review #6 — an EXEMPT statement still runs code: an index expression or partial-
 * index predicate, a column DEFAULT, a GENERATED expression or a CHECK is evaluated by
 * the database per row, at migration, as the migrating role. Every expression in an
 * exempt statement is held to the SAME function allow-list a view or trigger body is;
 * returns why the statement is charged (a call off the list, or a `${…}`), or null.
 */
function exemptStatementCode(toks: Tok[], regions: Array<[number, number]>, columnDefault = false): string | null {
  for (const [a, b] of regions) {
    const why = expressionRegionCode(toks, a, b, columnDefault);
    if (why) return why;
  }
  return null;
}

// ---------------------------------------------------------------------------
// EXPRESSION mode — the token-level allow-list (S239 review of 8d1e18b6).
//
// Inside an expression region every `identifier (` is a CALL, and a call must be on
// `EXPRESSION_ALLOWED_CALLS` — with NO keyword exceptions (`extract(epoch FROM evil(ts))`,
// `trim(BOTH FROM evil(n))`, `match(name)` / `range(id)` once passed). The ONLY non-call
// `identifier (` forms are `isSyntacticParen`'s closed set (shared with the view / trigger
// reader); a cast to a type not on `BUILTIN_TYPES`, a column / literal type off it, an
// operator class or access method not built in, and an operator outside
// `BUILTIN_OPERATORS` are charged too (a user type runs its input function; a user
// operator, opclass or access method runs its functions).
// ---------------------------------------------------------------------------

/** Index access methods — the word after `USING` (an index, an `EXCLUDE` constraint). */
const INDEX_METHODS = new Set(["btree", "hash", "gist", "spgist", "gin", "brin"]);

/** Built-in types that take a size / precision: `varchar(64)`, `numeric(10, 2)`, `timestamp(3)`. */
const SIZED_TYPES = new Set([
  "varchar", "char", "character", "nchar", "varying", "numeric", "decimal", "timestamp", "timestamptz",
  "time", "timetz", "interval", "bit", "varbit", "float",
]);

/** Words that may precede `varying` / `precision` in a multi-word type. */
const MULTIWORD_TYPE_HEADS = new Set(["character", "bit", "double", "national", "char"]);

/** The built-in types a cast (`::type`, `CAST(… AS type)`) may name — no input-function code of the author's. */
const BUILTIN_TYPES = new Set([
  "int", "int2", "int4", "int8", "integer", "smallint", "bigint", "real", "double", "float", "float4", "float8",
  "numeric", "decimal", "text", "varchar", "char", "character", "bpchar", "bool", "boolean", "date", "time",
  "timestamp", "timestamptz", "timetz", "interval", "uuid", "json", "jsonb", "bytea", "regclass", "money",
  "inet", "cidr", "macaddr", "bit", "varbit", "xml", "oid", "name", "blob", "tsrange", "tstzrange",
  "daterange", "int4range", "int8range", "numrange", "tsvector", "tsquery",
  // column-type spellings with no input function of the author's: Postgres serials, and
  // SQLite's type-affinity names (SQLite runs no code for a declared type at all)
  "serial", "bigserial", "smallserial", "serial2", "serial4", "serial8", "datetime", "clob", "nvarchar",
  "nchar", "tinyint", "mediumint", "int1", "string", "native", "unsigned", "varying",
]);
/** Words that may FOLLOW the first word of a built-in type (`double precision`, `timestamp with time zone`). */
const TYPE_TAIL_WORDS = new Set([
  "varying", "precision", "with", "without", "time", "zone", "unsigned", "big", "int", "integer", "character",
]);

/** Built-in index operator classes (an extension's — `gin_trgm_ops` — is code: charged). */
const BUILTIN_OPCLASSES = new Set([
  "text_pattern_ops", "varchar_pattern_ops", "bpchar_pattern_ops", "text_ops", "varchar_ops", "bpchar_ops",
  "int2_ops", "int4_ops", "int8_ops", "float4_ops", "float8_ops", "numeric_ops", "bool_ops", "date_ops",
  "timestamp_ops", "timestamptz_ops", "time_ops", "timetz_ops", "interval_ops", "uuid_ops", "jsonb_ops",
  "jsonb_path_ops", "array_ops", "tsvector_ops", "range_ops", "inet_ops", "network_ops", "box_ops",
  "point_ops", "poly_ops", "circle_ops", "bytea_ops", "char_ops", "name_ops", "oid_ops", "money_ops",
  "macaddr_ops", "cidr_ops", "bit_ops", "varbit_ops",
]);

/** Keywords a string literal may follow (anything else before a literal is a TYPED literal, `mytype 'x'`). */
const KEYWORDS_BEFORE_LITERAL = new Set([
  "DEFAULT", "LIKE", "ILIKE", "GLOB", "MATCH", "REGEXP", "SIMILAR", "ESCAPE", "THEN", "ELSE", "WHEN", "IS",
  "AND", "OR", "NOT", "TO", "FROM", "BY", "COLLATE", "COMMENT", "IF", "AT", "ZONE", "AS", "IN", "BETWEEN",
  "SELECT", "VALUES", "RETURN", "SET", "USING", "WITH", "CASE", "ANY", "ALL", "SOME",
  "E", "N", "X", "B", "U",                                   // literal prefixes (`E'…'` is handled as odd)
]);

/**
 * Why a column's TYPE (tokens from `k`, just past its name, to the first constraint word)
 * runs code, or null. A type not on the closed built-in list — a domain, an enum or composite,
 * an extension's type — has input / output / check functions of its own (S239 review of
 * d4c4d4ac, item 6). No type at all (SQLite) is fine.
 */
function columnTypeIssue(toks: Tok[], k: number, b: number): string | null {
  let first = true;
  while (k < b && !(toks[k].k === "w" && COLUMN_CONSTRAINT_WORDS.has(toks[k].up))) {
    const t = toks[k];
    if (t.k === "q") return `its type \`${t.t}\` is a quoted name — not a built-in type`;
    if (t.k === "w") {
      const w = t.t.toLowerCase();
      if (first ? !(BUILTIN_TYPES.has(w) || MULTIWORD_TYPE_HEADS.has(w) || SIZED_TYPES.has(w)) : !(TYPE_TAIL_WORDS.has(w) || BUILTIN_TYPES.has(w))) {
        return `its type \`${t.t}\` is not a built-in type (a domain, enum, composite or extension type runs functions of its own)`;
      }
      first = false;
      if (isP(toks[k + 1], ".")) return `its type \`${t.t}.…\` is schema-qualified — not a built-in type`;
      k++;
      if (isP(toks[k], "(")) { const c = closeParen(toks, k); if (c === -1 || c > b) return null; k = c; }
      continue;
    }
    if (isP(t, "[") || isP(t, "]")) { k++; continue; }
    return null;                                          // anything else ends the type
  }
  return null;
}

/** The first column of a `CREATE TABLE` column list (tokens `[from, to)`) whose TYPE runs code, or null. */
function createTableTypeIssue(toks: Tok[], from: number, to: number): string | null {
  let depth = 0;
  let s = from;
  const items: Array<[number, number]> = [];
  for (let k = from; k < to; k++) {
    if (isP(toks[k], "(")) depth++;
    else if (isP(toks[k], ")")) depth = Math.max(0, depth - 1);
    else if (isP(toks[k], ",") && depth === 0) { items.push([s, k]); s = k + 1; }
  }
  items.push([s, to]);
  for (const [a, b] of items) {
    if (b <= a || (toks[a].k === "w" && TABLE_CONSTRAINT_LEADERS.has(toks[a].up))) continue;
    // `LIKE <template> [INCLUDING …]` copies another table's columns (E-SCHEMA-014 owns it) —
    // unless `like` is a column NAME followed by a built-in type (`like VARCHAR(64)`)
    if (isW(toks[a], "LIKE") && !(toks[a + 1]?.k === "w" && BUILTIN_TYPES.has(toks[a + 1].t.toLowerCase()))) continue;
    const why = columnTypeIssue(toks, a + 1, b);
    if (why) return `column \`${toks[a].t}\`: ${why}`;
  }
  return null;
}

/** Why a `CREATE INDEX` column list names an operator class that is not built in, or null. `[a, b)` starts at its `(`. */
function indexOpclassIssue(toks: Tok[], a: number, b: number): string | null {
  if (!isP(toks[a], "(")) return null;
  const close = closeParen(toks, a);
  if (close === -1) return null;
  let s = a + 1;
  const elems: Array<[number, number]> = [];
  let depth = 0;
  for (let k = a + 1; k < close - 1; k++) {
    if (isP(toks[k], "(")) depth++;
    else if (isP(toks[k], ")")) depth--;
    else if (isP(toks[k], ",") && depth === 0) { elems.push([s, k]); s = k + 1; }
  }
  elems.push([s, close - 1]);
  for (const [x, y] of elems) {
    let k = x;
    if (isP(toks[k], "(")) { const c = closeParen(toks, k); if (c === -1) return null; k = c; }
    else {
      while (isName(toks[k]) && isP(toks[k + 1], ".")) k += 2;   // a qualified column
      k++;
      if (isP(toks[k], "(")) { const c = closeParen(toks, k); if (c === -1) return null; k = c; }
    }
    for (; k < y; k++) {
      const t = toks[k];
      if (isW(t, "COLLATE")) { k++; continue; }
      if (isW(t, "ASC") || isW(t, "DESC") || isW(t, "NULLS") || isW(t, "FIRST") || isW(t, "LAST")) continue;
      if (isName(t)) {
        if (!(t.k === "w" && BUILTIN_OPCLASSES.has(t.t.toLowerCase()))) {
          return `it uses the operator class \`${t.t}\`, which is not built in (an extension's opclass runs its support functions)`;
        }
        if (isP(toks[k + 1], "(")) { const c = closeParen(toks, k + 1); if (c === -1) return null; k = c - 1; }
      }
    }
  }
  return null;
}

/** Built-in operators (a user-defined operator runs a user function). */
const BUILTIN_OPERATORS = new Set([
  "=", "<", ">", "<=", ">=", "<>", "!=", "+", "-", "*", "/", "%", "||", "::", "&&", "~", "~*", "!~",
  "!~*", "^", "@>", "<@", "->", "->>", "#>", "#>>", "?", "?|", "?&", "<<", ">>", "&<", "&>", "-|-", "|",
]);
const OPERATOR_CHARS = new Set(["=", "<", ">", "!", "+", "-", "*", "/", "%", "|", "&", "~", "^", "@", "#", "?", ":"]);

/** Is the token at `k` in a TYPE position — after `::`, after `AS` inside `CAST(`, or a type's second word? */
function typePositionAt(toks: Tok[], k: number, castAs: ReadonlySet<number>): boolean {
  const prev = toks[k - 1];
  if (isP(prev, ":") && isP(toks[k - 2], ":")) return true;
  if (castAs.has(k - 1)) return true;
  if (prev && prev.k === "w" && MULTIWORD_TYPE_HEADS.has(prev.t.toLowerCase())) return typePositionAt(toks, k - 1, castAs);
  return false;
}

/** Why the expression tokens `[a, b)` run code (a call / cast / operator off the closed lists), or null. */
function expressionRegionCode(toks: Tok[], a: number, b: number, columnDefault: boolean): string | null {
  const offList = (what: string): string =>
    `it ${what} — the database evaluates it per row, at migration, as the migrating role, and it may read or write any table`;
  // `AS` tokens that sit at depth 1 of a `CAST(` — the type position of a cast.
  const castAs = new Set<number>();
  for (let k = a; k < b; k++) {
    if (!(isW(toks[k], "CAST") && isP(toks[k + 1], "("))) continue;
    let depth = 0;
    for (let j = k + 1; j < b; j++) {
      if (isP(toks[j], "(")) depth++;
      else if (isP(toks[j], ")")) { depth--; if (depth === 0) break; }
      else if (depth === 1 && isW(toks[j], "AS")) castAs.add(j);
    }
  }
  for (let k = a; k < b; k++) {
    const t = toks[k];
    if (isP(t, "${")) return "it holds a `${…}` interpolation the checker cannot read";
    // operators: a run of adjacent operator characters
    if (t.k === "p" && OPERATOR_CHARS.has(t.t)) {
      let op = t.t;
      let j = k + 1;
      while (j < b && toks[j].k === "p" && OPERATOR_CHARS.has(toks[j].t) && toks[j].at === toks[j - 1].at + toks[j - 1].t.length) {
        op += toks[j].t;
        j++;
      }
      if (!BUILTIN_OPERATORS.has(op)) return offList(`uses the operator \`${op}\`, which is not a built-in one`);
      if (op === "::") {
        const ty = toks[j];
        if (!ty || !isName(ty)) return offList("casts to a type the checker cannot read");
        let name = ty.t.toLowerCase();
        if (isP(toks[j + 1], ".")) {
          if (name !== "pg_catalog" || !isName(toks[j + 2])) return offList(`casts to \`${ty.t}.…\`, a type outside the built-in list`);
          name = toks[j + 2].t.toLowerCase();
        }
        if (!BUILTIN_TYPES.has(name) && !MULTIWORD_TYPE_HEADS.has(name)) return offList(`casts to \`${ty.t}\`, a type outside the built-in list (its input function is code)`);
      }
      k = j - 1;
      continue;
    }
    if (castAs.has(k)) {
      const ty = toks[k + 1];
      const name = ty && isName(ty) ? ty.t.toLowerCase() : "";
      if (!BUILTIN_TYPES.has(name) && !MULTIWORD_TYPE_HEADS.has(name)) return offList(`casts to \`${ty?.t ?? "?"}\`, a type outside the built-in list (its input function is code)`);
      continue;
    }
    // a TYPED literal `mytype 'x'` runs the type's input function
    if (isName(t) && toks[k + 1]?.k === "s" && !(t.k === "w" && KEYWORDS_BEFORE_LITERAL.has(t.up)) &&
        !(t.k === "w" && (BUILTIN_TYPES.has(t.t.toLowerCase()) || TYPE_TAIL_WORDS.has(t.t.toLowerCase())))) {
      return offList(`writes a literal of the type \`${t.t}\`, which is not a built-in type (its input function is code)`);
    }
    // an access method (`USING <am>` — an index, an EXCLUDE constraint, a table) must be built in
    if (isW(toks[k - 1], "USING") && isName(t) && !(t.k === "w" && (INDEX_METHODS.has(t.t.toLowerCase()) || t.t.toLowerCase() === "heap"))) {
      return offList(`uses the access method \`${t.t}\`, which is not built in (an extension's access method runs its handler)`);
    }
    if (!isName(t) || !isP(toks[k + 1], "(")) continue;
    // ── the closed SYNTACTIC set: an `identifier (` that is not a call ─────────────
    const prev = toks[k - 1];
    if (isSyntacticParen(toks, k)) continue;
    if (t.k === "w" && SIZED_TYPES.has(t.t.toLowerCase()) && typePositionAt(toks, k, castAs)) continue;
    // ── everything else is a CALL ──────────────────────────────────────────────────
    if (isP(prev, ".")) return offList(`calls \`${toks[k - 2]?.t ?? ""}.${t.t}\`, a qualified function outside the allow-list`);
    const callee = t.k === "q" ? t.t : t.t.toLowerCase();
    if (EXPRESSION_ALLOWED_CALLS.has(callee)) continue;
    if (columnDefault && callee === "nextval" && (isW(prev, "DEFAULT") || (isP(prev, "(") && isW(toks[k - 2], "DEFAULT")))) continue;
    return offList(`calls \`${t.t}\`, which is not on the floor's function allow-list`);
  }
  return null;
}

/** The expression regions of a `CREATE INDEX` statement: everything after `ON <table> [USING <method>]`. */
function indexExpressionRegions(toks: Tok[], start: number, end: number): Array<[number, number]> {
  let depth = 0;
  for (let k = start; k < end; k++) {
    if (isP(toks[k], "(")) depth++;
    else if (isP(toks[k], ")")) depth = Math.max(0, depth - 1);
    else if (depth === 0 && isW(toks[k], "ON")) {
      let j = k + 1;
      if (isW(toks[j], "ONLY") && isName(toks[j + 1])) j++;
      const nm = readName(toks, j);
      if (!nm) return [[k + 1, end]];
      // the region includes `USING <access method>` — the method is checked too
      return [[nm.next, end]];
    }
  }
  return [[start, end]];   // no readable ON: read it all (fail-closed)
}

/**
 * In a column definition starting at its NAME (token `k`), the index where its
 * constraints / expressions begin: past the name and the TYPE — words, and a
 * parenthesized size after one (`VARCHAR(64)`, `NUMERIC(10, 2)`, `TIMESTAMP(3) WITH TIME
 * ZONE`) — up to the first constraint word. A type size is not a call.
 */
function columnExpressionsStart(toks: Tok[], k: number, b: number): number {
  k++;                                                        // the column name
  while (k < b && toks[k].k === "w" && !COLUMN_CONSTRAINT_WORDS.has(toks[k].up)) {
    k++;
    if (isP(toks[k], "(")) { const c = closeParen(toks, k); if (c === -1 || c > b) break; k = c; }
  }
  return k;
}

/** Words that open a TABLE-level constraint in a `CREATE TABLE` column list. */
const TABLE_CONSTRAINT_LEADERS = new Set(["CONSTRAINT", "CHECK", "PRIMARY", "UNIQUE", "FOREIGN", "EXCLUDE", "KEY", "INDEX"]);

/**
 * The expression regions of a `CREATE TABLE` column list (tokens `[from, to)`, inside the
 * parentheses): each column's constraints (DEFAULT / GENERATED / CHECK / …) past its
 * type, and each table-level constraint whole (a table `CHECK`).
 */
function createTableExpressionRegions(toks: Tok[], from: number, to: number): Array<[number, number]> {
  const items: Array<[number, number]> = [];
  let depth = 0;
  let s = from;
  for (let k = from; k < to; k++) {
    if (isP(toks[k], "(")) depth++;
    else if (isP(toks[k], ")")) depth = Math.max(0, depth - 1);
    else if (isP(toks[k], ",") && depth === 0) { items.push([s, k]); s = k + 1; }
  }
  items.push([s, to]);
  return items.filter(([a, b]) => b > a).map(([a, b]): [number, number] =>
    toks[a].k === "w" && TABLE_CONSTRAINT_LEADERS.has(toks[a].up) ? [a, b] : [columnExpressionsStart(toks, a, b), b]);
}

/**
 * The ADMITTED `GRANT` (PA reading of S455 "your rec on the allow-list", in its veto
 * window): ONLY `GRANT {SELECT | INSERT | UPDATE | DELETE}[, …] ON [TABLE] <named tables> TO
 * scrml_app` and `GRANT USAGE[, SELECT] ON SEQUENCE <named sequences> TO scrml_app` — the
 * privileges the §14.8.11 bounded role's requests need, on objects named one by one. NOT
 * admitted: `WITH GRANT OPTION` / `GRANTED BY`, `TRUNCATE` (it bypasses row-level security
 * and empties every tenant's rows), `ALL [PRIVILEGES]`, `ON ALL TABLES | SEQUENCES IN
 * SCHEMA`, `EXECUTE ON FUNCTION`, `USAGE` on a foreign-data wrapper / server / language,
 * `SET` / `ALTER SYSTEM ON PARAMETER`, `CREATE` / `TEMP` on a database or schema,
 * `REFERENCES`, `TRIGGER`, a column-level privilege list. `[a, p)` = privileges, `[p+1, t)` =
 * objects, `[t+1, end)` = grantees (the caller has checked they are all `scrml_app`).
 */
function grantAdmitted(toks: Tok[], a: number, p: number, t: number, end: number): boolean {
  const privs: string[] = [];
  for (let k = a; k < p; k++) {
    if (isP(toks[k], ",")) continue;
    if (toks[k].k !== "w") return false;                    // a column list `(…)`, a quoted word, …
    privs.push(toks[k].up);
  }
  let k = p + 1;
  let allowed: ReadonlySet<string>;
  if (isW(toks[k], "SEQUENCE")) { allowed = new Set(["USAGE", "SELECT"]); k++; }
  else { allowed = new Set(["SELECT", "INSERT", "UPDATE", "DELETE"]); if (isW(toks[k], "TABLE")) k++; }
  if (privs.length === 0 || !privs.every((x) => allowed.has(x))) return false;
  // named objects only: name[.name][, name[.name]]…
  let expectName = true;
  for (; k < t; k++) {
    if (expectName) {
      if (!isName(toks[k]) || isW(toks[k], "ALL")) return false;
      while (isP(toks[k + 1], ".") && isName(toks[k + 2])) k += 2;
      expectName = false;
    } else {
      if (!isP(toks[k], ",")) return false;
      expectName = true;
    }
  }
  if (expectName) return false;
  for (let j = t + 1; j < end; j++) if (isW(toks[j], "WITH") || isW(toks[j], "GRANTED")) return false;
  return true;
}

/** The grantees of `GRANT … TO a, b [WITH …] [GRANTED BY …]`, from the token after `TO`. */
function granteesOf(toks: Tok[], from: number, end: number): string[] {
  const out: string[] = [];
  for (let k = from; k < end; k++) {
    const t = toks[k];
    if (isW(t, "WITH") || isW(t, "GRANTED")) break;
    if (isP(t, ",") || isW(t, "GROUP") || isW(t, "ROLE")) continue;
    // An unquoted name folds case (Postgres folds it to lower case); a QUOTED one is
    // case-exact — `"SCRML_APP"` is a different role from `scrml_app` (S239 review #1),
    // so it is kept quoted and can never equal APP_ROLE unless spelled `"scrml_app"`.
    if (t.k === "w") out.push(t.t.toLowerCase());
    else if (t.k === "q") out.push(t.t === APP_ROLE ? APP_ROLE : `"${t.t}"`);
    else out.push(`?${t.t}`);
  }
  return out;
}

/**
 * ISOLATION REMOVAL (§14.8.10, ruling:user-voice-scrml.md S455 "yes both"): a `<schema>`
 * statement that removes or bypasses the §14.8.11 database-tier isolation of a
 * tenant-scoped table. `g` is one generic statement (tokens `[start, end)`).
 * Returns the hazard, `"exempt"` for a GRANT whose every grantee is the app role, or
 * null when the statement is not one of these shapes (read further as a statement).
 */
function isolationRemoval(
  toks: Tok[],
  g: { start: number; end: number; leader: string; target: string | null; at: number },
  tainted: ReadonlySet<string>,
  allTenant: string[],
  tenantsUnder: (names: string[]) => string[],
): SchemaHazard | "exempt" | null {
  const label = toks.slice(g.start, Math.min(g.end, g.start + 4)).map((t) => t.t).join(" ");
  const everyTable = (why: string): SchemaHazard =>
    ({ kind: "isolation removal", object: label, tables: allTenant, unattributable: true, offset: g.at, why });
  const onTable = (t: string, why: string): SchemaHazard =>
    ({ kind: "isolation removal", object: label, tables: tenantsUnder([t]), unattributable: false, offset: g.at, why });
  const has = (word: string): boolean => {
    for (let k = g.start; k < g.end; k++) if (isW(toks[k], word)) return true;
    return false;
  };
  const lead2 = toks[g.start + 1];
  // DROP POLICY [IF EXISTS] p ON t
  if (g.leader === "DROP" && isW(lead2, "POLICY")) {
    let k = g.start + 2;
    if (isW(toks[k], "IF") && isW(toks[k + 1], "EXISTS")) k += 2;
    const p = readName(toks, k);
    const t = p && isW(toks[p.next], "ON") ? readName(toks, p.next + 1) : null;
    if (!t) return everyTable("the checker cannot read which table the dropped row-security policy is on");
    if (tainted.has(t.name)) {
      return onTable(t.name, `it drops a row-security policy on \`${t.name}\` — the §14.8.11 tier's \`scrml_tenant_iso\` (or a restrictive policy that narrows it) stops isolating its tenants`);
    }
    return null;
  }
  // ALTER TABLE <tenant> DISABLE | NO FORCE ROW LEVEL SECURITY · OWNER TO
  if (g.leader === "ALTER" && g.target !== null && tainted.has(g.target)) {
    for (let k = g.start; k < g.end; k++) {
      if (isW(toks[k], "DISABLE") && isW(toks[k + 1], "ROW") && isW(toks[k + 2], "LEVEL") && isW(toks[k + 3], "SECURITY")) {
        return onTable(g.target, `it disables row-level security on \`${g.target}\` — the database stops applying the §14.8.11 isolation policy`);
      }
      if (isW(toks[k], "NO") && isW(toks[k + 1], "FORCE") && isW(toks[k + 2], "ROW")) {
        return onTable(g.target, `it un-forces row-level security on \`${g.target}\` — the table's owner then reads every tenant's rows`);
      }
      if (isW(toks[k], "OWNER") && isW(toks[k + 1], "TO")) {
        return onTable(g.target, `it changes \`${g.target}\`'s owner — an owner (or a superuser one) can bypass or disable its row-level security`);
      }
    }
    return null;
  }
  // ALTER ROLE | USER … BYPASSRLS | SUPERUSER
  if (g.leader === "ALTER" && (isW(lead2, "ROLE") || isW(lead2, "USER")) && (has("BYPASSRLS") || has("SUPERUSER"))) {
    return everyTable("it gives a role BYPASSRLS / SUPERUSER — that role reads every tenant's rows, whatever the row-security policy says");
  }
  // SET [SESSION | LOCAL] ROLE | row_security | SESSION AUTHORIZATION
  if (g.leader === "SET") {
    let k = g.start + 1;
    if (isW(toks[k], "SESSION") && isW(toks[k + 1], "AUTHORIZATION")) {
      return everyTable("it switches the session's authorization — the statements after it may run as a role that bypasses row-level security");
    }
    if (isW(toks[k], "SESSION") || isW(toks[k], "LOCAL")) k++;
    if (isW(toks[k], "ROLE")) {
      return everyTable("it switches the session's role — the statements after it may run as a role that bypasses row-level security");
    }
    if (isW(toks[k], "ROW_SECURITY") || (toks[k]?.k === "q" && toks[k].t.toLowerCase() === "row_security")) {
      return everyTable("it sets `row_security`, which decides whether row-level security applies to the session");
    }
    return null;
  }
  // GRANT … [ON objects] TO grantees
  if (g.leader === "GRANT") {
    let onAt = -1;
    let toAt = -1;
    let depth = 0;
    for (let k = g.start + 1; k < g.end; k++) {
      if (isP(toks[k], "(")) depth++;
      else if (isP(toks[k], ")")) depth = Math.max(0, depth - 1);
      else if (depth === 0 && onAt === -1 && isW(toks[k], "ON")) onAt = k;
      else if (depth === 0 && isW(toks[k], "TO")) { toAt = k; break; }
    }
    const grantees = toAt === -1 ? [] : granteesOf(toks, toAt + 1, g.end);
    const onlyApp = grantees.length > 0 && grantees.every((n) => n === APP_ROLE);
    if (onAt === -1) {
      // a role grant: `GRANT some_role TO scrml_app` widens the app role itself
      if (grantees.includes(APP_ROLE)) return everyTable(`it grants a role to \`${APP_ROLE}\`, the bounded role the §14.8.11 tier's requests run as`);
      return null;
    }
    const objs = readRegion(toks, onAt + 1, toAt === -1 ? g.end : toAt, tainted);
    const allTables = isW(toks[onAt + 1], "ALL");
    // the admitted kind (S455 "your rec on the allow-list", narrowed by the PA reading below)
    if (onlyApp && !objs.interp && toAt !== -1 && grantAdmitted(toks, g.start + 1, onAt, toAt, g.end)) return "exempt";
    if (onlyApp) return null;                                                 // → not admitted
    if (!allTables && objs.names.length === 0 && !objs.interp) return null;   // → not admitted
    const to = toAt === -1 ? "a grantee the checker cannot read" : grantees.map((n) => `\`${n}\``).join(", ");
    if (allTables || objs.interp) return everyTable(`it grants access to every table it names in bulk to ${to} — any grantee but \`${APP_ROLE}\` is a principal the tier does not bound`);
    return { kind: "isolation removal", object: label, tables: tenantsUnder(objs.names), unattributable: false, offset: g.at,
      why: `it grants access to ${objs.names.map((n) => `\`${n}\``).join(", ")} to ${to} — any grantee but \`${APP_ROLE}\` is a principal the tier does not bound` };
  }
  return null;
}

// ---------------------------------------------------------------------------
// The checker
// ---------------------------------------------------------------------------

const lineAt = (body: string, at: number): number => body.slice(0, Math.max(0, at)).split("\n").length;

/**
 * Analyse one token reading of a `<schema>` body. `declsOnly` (the comment-content
 * reading) charges CREATE-led declarations and foreign keys, not other statements:
 * comment prose that merely mentions a table is not a statement.
 */
function analyze(toks: Tok[], tenant: ReadonlySet<string>, declsOnly: boolean): SchemaHazard[] {
  const out: SchemaHazard[] = [];
  const allTenant = [...tenant];
  const decls: Decl[] = [];
  const consumed = new Uint8Array(toks.length);
  const generic: Array<{ start: number; end: number; leader: string; target: string | null; targetEnd: number; at: number }> = [];
  const contexts: Array<{ from: number; to: number; table: string }> = [];

  // 1. Statements.
  for (let i = 0; i < toks.length; i++) {
    if (consumed[i]) continue;
    const t = toks[i];
    if (isW(t, "CREATE")) {
      const d = parseCreate(toks, i);
      // Structural fail-closed: a parse that stopped before its statement's end left text
      // the checker never read (an identifier spelled like a keyword closing a body early,
      // a nested block, a dialect form). That text belongs to the declaration and is
      // unattributable — charged, and read for names, up to the next declaration.
      if (!endsDeclaration(toks, d.end)) {
        let j = d.end;
        while (j < toks.length && !(toks[j].k === "b" || isW(toks[j], "CREATE") ||
          (toks[j].k === "w" && !toks[j].sql && isP(toks[j + 1], "{")))) j++;
        if (d.unreadable === null) {
          const seen = toks.slice(d.end, Math.min(j, d.end + 4)).map((t) => t.t).join(" ");
          d.unreadable = `text after where its reading stopped was not read (\`${seen}…\`)`;
        }
        d.end = j;
        d.region = [d.region[0], j];
      }
      decls.push(d);
      for (let k = i; k < Math.max(d.end, i + 1); k++) consumed[k] = 1;
      if (d.kind === "table" && d.cols && d.name) contexts.push({ from: d.cols[0], to: d.cols[1], table: d.name });
      i = Math.max(d.end, i + 1) - 1;
      continue;
    }
    // A DSL table head `name { … }`: its column text is a declaration, not a statement.
    if (t.k === "w" && isP(toks[i + 1], "{") && !t.sql) {
      let d = 0;
      let e = i + 1;
      for (; e < toks.length; e++) {
        if (isP(toks[e], "{")) d++;
        else if (isP(toks[e], "}")) { d--; if (d === 0) break; }
      }
      contexts.push({ from: i + 1, to: e, table: t.t.toLowerCase() });
      for (let k = i; k <= Math.min(e, toks.length - 1); k++) consumed[k] = 1;
      i = e;
      continue;
    }
    // A SQL statement (inside a `?{}` wrapper, at a statement start).
    const prev = toks[i - 1];
    const atStart = i === 0 || prev.k === "b" || isP(prev, ";");
    // A statement that STARTS with a `${…}` is SQL text the checker cannot see at all.
    if (isP(t, "${") && t.sql && atStart) {
      const end = statementEnd(toks, i);
      generic.push({ start: i, end, leader: "${", target: null, targetEnd: -1, at: t.at });
      for (let k = i; k < Math.max(end, i + 1); k++) consumed[k] = 1;
      i = Math.max(end, i + 1) - 1;
      continue;
    }
    // ANY other token that starts a SQL statement — a word, `(`, a literal, a quoted name —
    // is a statement, judged by its LEADER against the allow-list (S239 review of d4c4d4ac:
    // `(SELECT dblink_exec(…))` started with `(` and was never collected — executed).
    if (t.sql && atStart && t.k !== "b" && !isP(t, ";")) {
      const end = statementEnd(toks, i);
      let target: string | null = null;
      let targetEnd = -1;
      if (t.up === "ALTER" && isW(toks[i + 1], "TABLE")) {
        let k = i + 2;
        if (isW(toks[k], "IF") && isW(toks[k + 1], "EXISTS")) k += 2;
        if (isW(toks[k], "ONLY") && isName(toks[k + 1]) && !isW(toks[k + 1], "ADD")) k++;
        const nm = readName(toks, k);
        if (nm) {
          target = nm.name;
          targetEnd = isP(toks[nm.next], "*") ? nm.next + 1 : nm.next;
          contexts.push({ from: nm.next, to: end, table: nm.name });
        }
      }
      generic.push({ start: i, end, leader: t.k === "w" ? t.up : `<${t.t}>`, target, targetEnd, at: t.at });
      for (let k = i; k < Math.max(end, i + 1); k++) consumed[k] = 1;
      i = Math.max(end, i + 1) - 1;
    }
  }

  // 2. Views over tenant tables, to a fixpoint (a view over a view over `assets`).
  const tainted = new Set<string>(tenant);
  const viewHits = new Map<Decl, string[]>();
  const views = decls.filter((d) => d.kind === "view");
  let grew = true;
  while (grew) {
    grew = false;
    for (const v of views) {
      const r = readRegion(toks, v.region[0], v.region[1], tainted);
      const unattributable = v.unreadable !== null || r.calls.length > 0 || r.interp;
      if ((r.names.length > 0 || unattributable) && v.name && !tainted.has(v.name)) {
        tainted.add(v.name);
        grew = true;
      }
      viewHits.set(v, r.names);
    }
  }
  const viewSources = (names: string[]): string => {
    const direct = names.filter((n) => tenant.has(n));
    const via = names.filter((n) => !tenant.has(n));
    const parts: string[] = [];
    if (direct.length) parts.push(`reads the tenant-scoped table${direct.length > 1 ? "s" : ""} ${direct.map((n) => `\`${n}\``).join(", ")}`);
    if (via.length) parts.push(`reads ${via.map((n) => `\`${n}\``).join(", ")}, itself a view over a tenant-scoped table`);
    return parts.join(" and ");
  };
  const tenantsUnder = (names: string[]): string[] => {
    // The tenant tables reached through `names` (views resolved by their hits).
    const seen = new Set<string>();
    const res = new Set<string>();
    const visit = (n: string): void => {
      if (seen.has(n)) return;
      seen.add(n);
      if (tenant.has(n)) { res.add(n); return; }
      const v = views.find((x) => x.name === n);
      if (!v) return;
      const r = readRegion(toks, v.region[0], v.region[1], tainted);
      if (v.unreadable !== null || r.calls.length > 0 || r.interp) for (const t of allTenant) res.add(t);
      for (const m of r.names) visit(m);
    };
    for (const n of names) visit(n);
    return res.size ? [...res] : allTenant;
  };

  const unattributableWhy = (d: Decl, r: RegionRead): string | null => {
    if (d.unreadable) return d.unreadable;
    if (r.interp) return "it holds a `${…}` interpolation the checker cannot read";
    if (r.calls.length) return `it calls \`${r.calls[0]}\`, which is not on the floor's function allow-list and may read or write any table`;
    return null;
  };

  for (const d of decls) {
    const r = readRegion(toks, d.region[0], d.region[1], tainted);
    const shown = d.shown || "?";
    if (d.kind === "view") {
      const un = unattributableWhy(d, r);
      if (un) {
        out.push({ kind: "view", object: shown, tables: allTenant, unattributable: true, offset: d.at,
          why: `the checker cannot tell which tables it reads: ${un}` });
      } else if (r.names.length) {
        out.push({ kind: "view", object: shown, tables: tenantsUnder(r.names), unattributable: false, offset: d.at,
          why: `it ${viewSources(r.names)}, and reading a view is never scoped to the active tenant` });
      }
      continue;
    }
    if (d.kind === "trigger" || d.kind === "rule") {
      const what = d.kind;
      const before = out.length;
      const onTainted = d.on !== undefined && tainted.has(d.on);
      const un = unattributableWhy(d, r);
      if (onTainted) {
        const viaView = !tenant.has(d.on!);
        out.push({ kind: what, object: shown, tables: tenantsUnder([d.on!]), unattributable: false, offset: d.at,
          why: viaView
            ? `it is declared on \`${d.on}\`, a view over a tenant-scoped table — the database runs its body on every write the floor scoped`
            : `it is declared on the tenant-scoped table \`${d.on}\` — the database runs its body on writes the floor scoped, and that body is not scoped` });
      }
      if (un) {
        out.push({ kind: what, object: shown, tables: allTenant, unattributable: true, offset: d.at,
          why: `the checker cannot tell which tables its body reads or writes: ${un}` });
      } else if (r.names.length) {
        out.push({ kind: what, object: shown, tables: tenantsUnder(r.names), unattributable: false, offset: d.at,
          why: `its body names ${r.names.map((n) => `\`${n}\``).join(", ")}${r.names.every((n) => tenant.has(n)) ? "" : " (a view over a tenant-scoped table)"} — ` +
            `the database runs it outside any query the floor scopes, so one tenant's request reads or writes every tenant's rows` });
      }
      // a Postgres RULE is not an admitted kind at all (S455 "your rec on the allow-list")
      if (what === "rule" && out.length === before) {
        out.push(notAdmitted(`CREATE RULE ${shown}`, d.at, allTenant, "`CREATE RULE` is not an admitted statement kind"));
      }
      continue;
    }
    if (d.kind === "function") {
      out.push({ kind: "function", object: shown, tables: allTenant, unattributable: true, offset: d.at, why: d.unreadable! });
      continue;
    }
    if (d.kind === "table") {
      if (d.unreadable) continue; // E-SCHEMA-012/013/014 own unreadable table heads
      // A column DEFAULT / GENERATED / CHECK (or a table CHECK) is evaluated by the database
      // per row, as whatever role writes it — held to the same function allow-list (S455,
      // the review #6 class), on any table.
      if (d.cols) {
        // (a `${…}` in a table declaration is already charged by the interpolation rule below)
        // the column list, AND everything after it (PARTITION BY, WITH (…), INHERITS, …)
        const code = exemptStatementCode(toks,
          [...createTableExpressionRegions(toks, d.cols[0] + 1, d.cols[1] - 1), [d.cols[1], d.end]], true) ??
          createTableTypeIssue(toks, d.cols[0] + 1, d.cols[1] - 1);
        if (code && !code.includes("interpolation")) {
          out.push({ kind: "statement", object: `CREATE TABLE ${shown}`, tables: allTenant, unattributable: true, offset: d.at, why: code });
        }
      }
      const hits = r.names.filter((n) => n !== d.name);
      if (hits.length) {
        out.push({ kind: "statement", object: `CREATE TABLE ${shown}`, tables: tenantsUnder(hits), unattributable: false, offset: d.at,
          why: `outside its column list it names ${hits.map((n) => `\`${n}\``).join(", ")} (\`AS SELECT\`, \`INHERITS\`, \`PARTITION OF\`, …) — ` +
            `its rows would come from, or be read through, a tenant-scoped table without the floor` });
      }
      continue;
    }
    if (d.kind === "index") {
      // exempt (closed list) — unless an expression in it runs code off the allow-list (S239 #6)
      const regions = indexExpressionRegions(toks, d.start, d.end);
      let listAt = regions[0][0];
      if (isW(toks[listAt], "USING")) listAt += 2;
      const code = exemptStatementCode(toks, regions) ?? indexOpclassIssue(toks, listAt, d.end);
      if (code) {
        out.push({ kind: "statement", object: `CREATE INDEX ${shown}`, tables: allTenant, unattributable: true, offset: d.at, why: code });
      }
      continue;
    }
    // Any other CREATE (a virtual / foreign table, a policy, a publication, …). In the
    // comment-content reading, comment text can split a statement (`CREATE /* x */ VIEW`
    // reads as `CREATE x VIEW`); a CREATE of no known object kind is that artifact, and
    // the comment-free readings own the live statement.
    if (declsOnly && !KNOWN_OBJECTS.has(d.object ?? "")) continue;
    // A row-security POLICY (§14.8.11 expects hand-authored ones beside the tier's own
    // `scrml_tenant_iso`). Postgres combines PERMISSIVE policies with OR — and PERMISSIVE
    // is the DEFAULT when `AS` is omitted — so a permissive policy on a tenant table
    // WIDENS the tier's isolation policy. Only an explicit `AS RESTRICTIVE` (ANDed: it
    // can only narrow) is exempt; a policy whose target or AS clause cannot be read is
    // charged. A policy on a table without `tenant_id` is not this floor's business.
    // ISOLATION REMOVAL (S455 "yes both"): a role created BYPASSRLS / SUPERUSER reads every
    // tenant's rows whatever the row-security policy says. It names no table, so it is
    // charged against every tenant-scoped table (the file is checked only when there is one).
    if (d.object === "ROLE" || d.object === "USER") {
      let bypass: string | null = null;
      for (let k = d.start; k < d.end; k++) if (isW(toks[k], "BYPASSRLS") || isW(toks[k], "SUPERUSER")) { bypass = toks[k].up; break; }
      if (bypass) {
        out.push({ kind: "isolation removal", object: `CREATE ${d.object} ${shown}`, tables: allTenant, unattributable: true, offset: d.at,
          why: `it creates a ${bypass} role — that role reads every tenant's rows, whatever the row-security policy says` });
        continue;
      }
    }
    if (d.object === "POLICY") {
      let p = d.start;
      while (p < d.end && !isW(toks[p], "POLICY")) p++;
      const pname = readName(toks, p + 1);
      const tbl = pname && isW(toks[pname.next], "ON") ? readName(toks, pname.next + 1) : null;
      const pShown = pname ? toks[pname.next - 1].t : "?";
      if (!tbl) {
        out.push({ kind: "permissive policy", object: pShown, tables: allTenant, unattributable: true, offset: d.at,
          why: "the checker cannot read which table it is declared on" });
        continue;
      }
      // A RESTRICTIVE policy's USING / WITH CHECK expressions run per row — held to the
      // expression allow-list (S239 review of d4c4d4ac; `current_setting(…)` is on it).
      if (isW(toks[tbl.next], "AS") && isW(toks[tbl.next + 1], "RESTRICTIVE")) {
        const code = exemptStatementCode(toks, [[tbl.next + 2, d.end]]);
        if (code) {
          out.push({ kind: "statement", object: `CREATE POLICY ${pShown}`, tables: allTenant, unattributable: true, offset: d.at, why: code });
          continue;
        }
      }
      let mode: string | null = "PERMISSIVE (the default when `AS` is omitted)";
      if (!tainted.has(tbl.name)) {
        // admitted only `AS RESTRICTIVE` (S455 "your rec on the allow-list"), on any table
        if (!(isW(toks[tbl.next], "AS") && isW(toks[tbl.next + 1], "RESTRICTIVE"))) {
          out.push(notAdmitted(`CREATE POLICY ${pShown}`, d.at, allTenant, "only `CREATE POLICY … AS RESTRICTIVE` is admitted"));
        }
        continue;
      }
      if (isW(toks[tbl.next], "AS")) {
        const m = toks[tbl.next + 1];
        if (isW(m, "RESTRICTIVE")) mode = null;
        else if (isW(m, "PERMISSIVE")) mode = "PERMISSIVE";
        else {
          out.push({ kind: "permissive policy", object: pShown, tables: tenantsUnder([tbl.name]), unattributable: true, offset: d.at,
            why: `its \`AS\` clause (\`${m ? m.t : "?"}\`) could not be read — write \`AS RESTRICTIVE\`` });
          continue;
        }
      }
      if (mode !== null) {
        out.push({ kind: "permissive policy", object: pShown, tables: tenantsUnder([tbl.name]), unattributable: false, offset: d.at,
          why: `it is ${mode} on \`${tbl.name}\`, and Postgres ORs permissive policies with the tier's own isolation policy ` +
            "(`scrml_tenant_iso`), so it can only WIDEN which tenants' rows a request sees — write `AS RESTRICTIVE` (ANDed; it can only narrow)" });
      }
      continue;
    }
    // Every other CREATE (a role, sequence, type, extension, publication, schema, a virtual /
    // foreign table, …) is outside the allow-list (S455 "your rec on the allow-list").
    const mods = ["VIRTUAL", "FOREIGN"].filter((m) => d.flags.has(m)).join(" ");
    out.push(notAdmitted(`CREATE ${mods ? `${mods} ` : ""}${d.object ?? "?"} ${shown}`.trim(), d.at, allTenant,
      `\`CREATE ${mods ? `${mods} ` : ""}${d.object ?? "?"}\` is not an admitted statement kind`));
  }

  // 3. Other SQL statements in the `<schema>` — the statement-kind ALLOW-LIST
  //    (ruling:user-voice-scrml.md S455 "your rec on the allow-list"): besides the CREATE
  //    kinds above, a tenant compilation's `<schema>` admits ONLY `ALTER TABLE` (admitted
  //    actions), `GRANT … ON … TO scrml_app`, `COMMENT ON`, `ANALYZE`, `REINDEX`, `VACUUM`.
  if (!declsOnly) {
    for (const g of generic) {
      const label = toks.slice(g.start, Math.min(g.end, g.start + 3)).map((t) => t.t).join(" ");
      const interpWhy = "it holds a `${…}` interpolation the checker cannot read";
      // `VACUUM INTO 'file'` writes a copy of the whole database — every tenant's rows — to a file
      if (g.leader === "VACUUM" && toks.slice(g.start, g.end).some((t) => isW(t, "INTO"))) {
        out.push(notAdmitted(label, g.at, allTenant, "`VACUUM INTO` writes every tenant's rows to a file — only a plain `VACUUM` is admitted"));
        continue;
      }
      if (ADMITTED_PLAIN_LEADERS.has(g.leader)) {
        // COMMENT ON / ANALYZE / REINDEX / VACUUM evaluate no expression of their own
        // (`ANALYZE t (col)` is a column list); a `${…}` is still SQL the checker cannot read
        if (readRegion(toks, g.start + 1, g.end, new Set()).interp) {
          out.push({ kind: "statement", object: label, tables: allTenant, unattributable: true, offset: g.at, why: interpWhy });
        }
        continue;
      }
      if (g.leader === "${") {
        out.push({ kind: "statement", object: "`${…}`", tables: allTenant, unattributable: true, offset: g.at,
          why: "the statement is a `${…}` interpolation, SQL the checker cannot read" });
        continue;
      }
      if (g.leader === "DO" || g.leader === "CALL" || g.leader === "EXECUTE") {
        out.push({ kind: "function", object: label, tables: allTenant, unattributable: true, offset: g.at,
          why: "it runs code the floor never sees" });
        continue;
      }
      // ISOLATION REMOVAL (S455 "yes both" (i)) — named as such; `"exempt"` is the admitted
      // `GRANT <privileges> ON … TO scrml_app`.
      const removal = isolationRemoval(toks, g, tainted, allTenant, tenantsUnder);
      if (removal === "exempt") continue;
      if (removal !== null) { out.push(removal); continue; }
      // ALTER TABLE — admitted only when EVERY action is an admitted one.
      if (g.leader === "ALTER" && g.target !== null && g.targetEnd !== -1) {
        if (readRegion(toks, g.start + 1, g.end, new Set()).interp) {
          out.push({ kind: "statement", object: label, tables: allTenant, unattributable: true, offset: g.at, why: interpWhy });
          continue;
        }
        const adm = alterAdmission(toks, g.targetEnd, g.end);
        if (typeof adm === "string") {
          out.push(notAdmitted(label, g.at, allTenant, `its action \`${adm}\` is not an admitted \`ALTER TABLE\` action`));
          continue;
        }
        // …and its DEFAULT / GENERATED / CHECK expressions are held to the allow-list (S239 #6)
        const code = exemptStatementCode(toks, adm, true);
        if (code) out.push({ kind: "statement", object: label, tables: allTenant, unattributable: true, offset: g.at, why: code });
        continue;
      }
      out.push(notAdmitted(label, g.at, allTenant, `\`${g.leader}\` is not an admitted statement kind`));
    }
  }

  // 4. Foreign keys with a CASCADE / SET NULL / SET DEFAULT action.
  const ACTION_AT = (k: number): string | null => {
    if (!isW(toks[k], "ON") || !(isW(toks[k + 1], "DELETE") || isW(toks[k + 1], "UPDATE"))) return null;
    const ev = toks[k + 1].up;
    if (isW(toks[k + 2], "CASCADE")) return `ON ${ev} CASCADE`;
    if (isW(toks[k + 2], "SET") && (isW(toks[k + 3], "NULL") || isW(toks[k + 3], "DEFAULT"))) return `ON ${ev} SET ${toks[k + 3].up}`;
    return null;
  };
  const actionUsed = new Uint8Array(toks.length);
  for (let i = 0; i < toks.length; i++) {
    if (!isW(toks[i], "REFERENCES")) continue;
    const ref = readName(toks, i + 1);
    if (!ref) continue; // an unreadable target: its action (if any) is charged by the backstop below
    let k = ref.next;
    if (isP(toks[k], "(")) { const c = closeParen(toks, k); if (c === -1) continue; k = c; }
    const actions: string[] = [];
    for (;;) {
      const a = ACTION_AT(k);
      if (a) {
        actions.push(a); actionUsed[k] = 1;
        k += a.split(" ").length;
        if (isP(toks[k], "(")) { const c = closeParen(toks, k); if (c !== -1) k = c; }
        continue;
      }
      if (isW(toks[k], "ON") && (isW(toks[k + 1], "DELETE") || isW(toks[k + 1], "UPDATE"))) {
        // RESTRICT / NO ACTION
        k += isW(toks[k + 2], "NO") ? 4 : 3;
        continue;
      }
      if (isW(toks[k], "MATCH")) { k += 2; continue; }
      if (isW(toks[k], "NOT") && isW(toks[k + 1], "DEFERRABLE")) { k += 2; continue; }
      if (isW(toks[k], "DEFERRABLE")) { k += 1; continue; }
      if (isW(toks[k], "INITIALLY")) { k += 2; continue; }
      break;
    }
    if (actions.length === 0) continue;
    const ctx = contexts.filter((c) => i >= c.from && i < c.to).sort((a, b) => (a.to - a.from) - (b.to - b.from))[0];
    const declaring = ctx?.table ?? null;
    const desc = `${declaring ? `on \`${declaring}\` ` : ""}\`REFERENCES ${ref.name} … ${actions.join(" ")}\``;
    if (declaring === null) {
      out.push({ kind: "foreign key", object: desc, tables: allTenant, unattributable: true, offset: toks[i].at,
        why: `the checker cannot tell which table declares it, and its \`${actions[0]}\` action writes rows the floor never scoped` });
      continue;
    }
    const ends = [declaring, ref.name].filter((n) => tenant.has(n));
    if (ends.length) {
      out.push({ kind: "foreign key", object: desc, tables: [...new Set(ends)], unattributable: false, offset: toks[i].at,
        why: `${ends.map((n) => `\`${n}\``).join(" and ")} ${ends.length > 1 ? "are" : "is"} tenant-scoped, and the database applies \`${actions.join("` / `")}\` ` +
          `to every matching row, whichever tenant owns it — a write the floor never sees` });
    }
  }
  // 5. A quoted form whose extent depends on the dialect (a backslash inside a quote, an
  //    `E'…'` / `U&'…'` string, an unterminated quote): where lexers disagree, text that is
  //    code to one database is string data to another, and the reading above may have
  //    missed it. Charged inside SQL and inside any declaration — never guessed.
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (!t.odd) continue;
    if (!t.sql && !decls.some((d) => k >= d.start && k < d.end)) continue;
    out.push({ kind: "statement", object: "a quoted literal", tables: allTenant, unattributable: true, offset: t.at,
      why: "a backslash escape, an `E'…'` / `U&'…'` string, a `${…}` inside quotes or an unclosed quote — " +
        "databases (and the template it sits in) disagree on what it holds, so the checker cannot tell what SQL it makes" });
    break;
  }
  // 6. A `${…}` anywhere else in SQL — a foreign-key action, a column list — is SQL text
  //    the checker cannot read. (Regions that read their own interpolations — a view,
  //    trigger, rule or other CREATE body, a statement — already charge it.)
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (!isP(t, "${")) continue;
    const inRead = decls.some((d) => d.kind !== "table" && d.kind !== "index" && k >= d.region[0] && k < d.region[1]) ||
      generic.some((g) => k >= g.start && k < g.end);
    if (inRead) continue;
    if (!t.sql && !decls.some((d) => k >= d.start && k < d.end)) continue;
    out.push({ kind: "statement", object: "a `${…}` interpolation", tables: allTenant, unattributable: true, offset: t.at,
      why: "it is SQL text the checker cannot read (in a table declaration, a foreign key or a column list)" });
    break;
  }
  // Backstop: an action the REFERENCES reading above did not consume is unattributable.
  for (let k = 0; k < toks.length; k++) {
    const a = ACTION_AT(k);
    if (a && !actionUsed[k]) {
      out.push({ kind: "foreign key", object: `\`${a}\``, tables: allTenant, unattributable: true, offset: toks[k].at,
        why: `the checker could not read the foreign key this \`${a}\` belongs to, and the action writes rows the floor never scoped` });
    }
  }
  return out;
}

/**
 * The `E-TENANT-SCHEMA-HAZARD` hazards one `<schema>` body declares, given the
 * tenant-scoped tables (lowercased or not — compared case-insensitively). Empty
 * when no table is tenant-scoped (the floor is off; nothing to protect).
 */
export function findSchemaTenantHazards(body: string, tenantTables: Iterable<string>): SchemaHazard[] {
  const tenant = new Set<string>();
  for (const t of tenantTables) if (typeof t === "string" && t.length) tenant.add(t.toLowerCase());
  if (tenant.size === 0 || typeof body !== "string" || body.trim().length === 0) return [];
  const all = [
    ...analyze(lex(body, "skip"), tenant, false),
    ...analyze(lex(body, "skip-nested"), tenant, false),
    ...analyze(lex(body, "content"), tenant, true),
  ];
  // The three readings overlap; keep one hazard per (kind, object, why).
  const seen = new Set<string>();
  const out: SchemaHazard[] = [];
  for (const h of all.sort((a, b) => a.offset - b.offset)) {
    // The OFFSET is part of the key: two different statements on one table (an `ADD
    // CONSTRAINT CHECK` and a `DROP COLUMN`) share kind, label and reason, and were
    // reported once (S239 review nit). The three readings agree on offsets, so a hazard
    // they all find is still reported once.
    const key = `${h.kind}|${h.offset}|${h.object.toLowerCase()}|${h.why}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(h);
  }
  return out;
}

/**
 * The tenant-scoped tables a set of `<schema>` bodies declares — a table is
 * tenant-scoped when ANY of its declarations carries a `tenant_id` column
 * (§14.8.10; the union the floor reads, `extractDesiredSchema` `tenantTables`).
 * Read by the same recognizer as the floor (`schemaTableDeclarations`).
 */
export function schemaTenantTableNames(bodies: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const b of bodies) for (const d of schemaTableDeclarations(b)) if (d.tenant) out.add(d.key);
  return out;
}

/** A `<schema>` block as the compiler will finally see it: its text children, after expansion. */
function schemaBlocksOf(fileAST: unknown): Array<{ body: string; span: any }> {
  const out: Array<{ body: string; span: any }> = [];
  const seen = new WeakSet<object>();
  const walk = (v: unknown, depth: number): void => {
    if (v === null || typeof v !== "object" || depth > 64 || seen.has(v as object)) return;
    seen.add(v as object);
    if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return; }
    const n = v as Record<string, any>;
    if (n.kind === "state" && n.stateType === "schema") {
      let body = "";
      for (const c of n.children ?? []) if (c && c.kind === "text" && typeof c.value === "string") body += c.value;
      out.push({ body, span: n.span ?? null });
    }
    for (const k of Object.keys(n)) {
      if (k === "span" || k.startsWith("_")) continue;
      walk(n[k], depth + 1);
    }
  };
  walk(fileAST, 0);
  return out;
}

/** The tenant tables a file's own (expanded) `<schema>` blocks declare. */
export function fileSchemaTenantNames(fileAST: unknown): Set<string> {
  return schemaTenantTableNames(schemaBlocksOf(fileAST).map((b) => b.body));
}

export interface SchemaHazardDiagnostic { code: "E-TENANT-SCHEMA-HAZARD"; message: string; span: any; severity: "error" }

/**
 * THE ONE authoritative E-TENANT-SCHEMA-HAZARD evaluation for a file (S455 review
 * round 2b). It runs as its own pipeline stage AFTER every compile-time expansion of
 * `<schema>` (TS expands `${ schemaFor(T) }` into a table declaration; ME splices
 * meta output) and before CG, over the AST CG consumes — so it sees the schema as it
 * will actually exist. The tenant set is the floor's own (`tenantTables(bodies)`,
 * supplied by the caller from `buildTenantContext` over the same AST) unioned with
 * every `tenant_id` declaration the schema reader finds — never smaller than what
 * the floor scopes.
 *
 * ⚑ THERE IS NO SECOND SITE AND NO "ALREADY REPORTED" SKIP. The S455 first cut ran
 * at GCP1 (before schemaFor expanded — an empty tenant set) and again in emit-server
 * (which skipped hazards it ASSUMED GCP1 had reported): a schemaFor tenant table with
 * a trigger over it was reported by neither. Measured by the reviewer and the PA.
 */
export function fileTenantSchemaHazards(
  fileAST: unknown,
  floorTenantTables: Iterable<string>,
): SchemaHazardDiagnostic[] {
  const blocks = schemaBlocksOf(fileAST);
  if (blocks.length === 0) return [];
  const tenant = new Set<string>();
  for (const t of floorTenantTables) if (typeof t === "string") tenant.add(t.toLowerCase());
  for (const t of schemaTenantTableNames(blocks.map((b) => b.body))) tenant.add(t);
  if (tenant.size === 0) return [];
  const filePath = (fileAST as any)?.filePath ?? (fileAST as any)?.ast?.filePath ?? "";
  const out: SchemaHazardDiagnostic[] = [];
  for (const { body, span } of blocks) {
    const sp = span ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 };
    for (const h of findSchemaTenantHazards(body, tenant)) {
      out.push({ code: "E-TENANT-SCHEMA-HAZARD", message: schemaHazardMessage(h, body), span: sp, severity: "error" });
    }
  }
  return out;
}

/** The `E-TENANT-SCHEMA-HAZARD` message for one hazard. */
export function schemaHazardMessage(h: SchemaHazard, body: string): string {
  const tables = h.unattributable
    ? `every tenant-scoped table (${h.tables.map((t) => `\`${t}\``).join(", ")})`
    : `the tenant-scoped table${h.tables.length > 1 ? "s" : ""} ${h.tables.map((t) => `\`${t}\``).join(", ")}`;
  if (h.kind === NOT_ADMITTED) {
    return (
      `E-TENANT-SCHEMA-HAZARD: this \`<schema>\` holds \`${h.object}\` (line ${lineAt(body, h.offset)} of the \`<schema>\` ` +
      `body), a statement not admitted in a tenant schema: ${h.why}. In a compilation with a tenant-scoped table ` +
      `(${h.tables.map((t) => `\`${t}\``).join(", ")}) a \`<schema>\` admits only \`CREATE TABLE\`, \`CREATE INDEX\`, ` +
      `\`ALTER TABLE\` (\`ADD COLUMN\`, \`ALTER COLUMN … SET | DROP NOT NULL\`, \`SET | DROP DEFAULT\`, \`RENAME COLUMN\`, ` +
      `\`ADD CONSTRAINT\` — a \`CHECK\`, or a foreign key with no cascading action), \`CREATE VIEW\`, \`CREATE TRIGGER\`, ` +
      `\`CREATE POLICY … AS RESTRICTIVE\`, \`GRANT … ON … TO ${DBAUTH_ROLE}\`, \`COMMENT ON\`, \`ANALYZE\`, \`REINDEX\` and ` +
      `\`VACUUM\`. Roles, privileges, publications, extensions, session settings and data changes belong to deploy / ops, ` +
      `not to the schema the compiler checks. (See SPEC §14.8.10.)`
    );
  }
  if (h.kind === "isolation removal") {
    return (
      `E-TENANT-SCHEMA-HAZARD: this \`<schema>\` holds an isolation removal \`${h.object}\` (line ${lineAt(body, h.offset)} of ` +
      `the \`<schema>\` body) that reaches ${tables}${h.unattributable ? " (no table named — charged against every tenant-scoped table)" : ""}: ${h.why}. ` +
      `A tenant-scoped table's isolation in the database (§14.8.11 row-level security, its \`scrml_tenant_iso\` policy and ` +
      `the bounded \`${DBAUTH_ROLE}\` role) is not the \`<schema>\`'s to remove or bypass, so the statement is refused where it ` +
      `is written. Remove it. (See SPEC §14.8.10.)`
    );
  }
  const obj = h.kind === "foreign key" || h.kind === "statement" ? h.object : `\`${h.object}\``;
  return (
    `E-TENANT-SCHEMA-HAZARD: this \`<schema>\` declares a ${h.kind} ${obj} (line ${lineAt(body, h.offset)} of the ` +
    `\`<schema>\` body) that reaches ${tables}${h.unattributable ? " (unattributable — charged, never treated as safe)" : ""}: ${h.why}. ` +
    `The §14.8.10 tenant floor scopes each query to the active tenant; it cannot scope SQL the database runs on its own — ` +
    `a trigger or rule body, a view's definition, a foreign-key action — so such a declaration over a tenant-scoped table ` +
    `is refused where it is declared. Remove it (do the work in server code, where the floor applies), or declare it ` +
    `only over tables that carry no \`tenant_id\`. (See SPEC §14.8.10.)`
  );
}
