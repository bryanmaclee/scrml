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
 * WHAT IS CHARGED (when the file declares at least one tenant-scoped table):
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
import { schemaTableDeclarations } from "./schema-differ.js";

/** The hazard kinds (the `kind` named in the diagnostic). */
export type SchemaHazardKind = "trigger" | "rule" | "foreign key" | "view" | "function" | "statement";

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
interface Tok { k: "w" | "q" | "s" | "n" | "p" | "b"; t: string; up: string; at: number; sql: boolean }

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
  const push = (k: Tok["k"], t: string, at: number): void => {
    out.push({ k, t, up: k === "w" ? t.toUpperCase() : t, at, sql: wrap > 0 });
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
      push("s", s, i);
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
      push("q", s, i);
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
  for (let j = i; j < toks.length; j++) {
    const t = toks[j];
    if (t.k === "b") return j;
    if (j > i && depth === 0 && (isW(t, "CREATE") || (t.k === "w" && !t.sql && isP(toks[j + 1], "{")))) return j;
    if (t.k === "p") {
      if (t.t === "(") depth++;
      else if (t.t === ")") depth = Math.max(0, depth - 1);
      else if (t.t === ";" && depth === 0) return j;
    }
  }
  return toks.length;
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

/** Words a `(` may follow that do not make a function call. */
const NOT_A_CALL = new Set([
  "SELECT", "FROM", "WHERE", "AND", "OR", "NOT", "IN", "ON", "AS", "JOIN", "USING", "WHEN", "THEN",
  "ELSE", "CASE", "END", "IS", "LIKE", "GLOB", "BETWEEN", "BY", "LIMIT", "OFFSET", "VALUES", "EXISTS",
  "SET", "KEY", "UNIQUE", "CHECK", "DEFAULT", "OVER", "FILTER", "CONFLICT", "INTO", "TABLE", "HAVING",
  "RETURNING", "ROW", "ROWS", "WITH", "DO", "INSTEAD", "ALSO", "ALL", "ANY", "SOME", "OF", "FOR",
  "EACH", "INSERT", "DELETE", "REPLACE", "UPDATE", "GROUP", "ORDER", "UNION", "INTERSECT", "EXCEPT",
  "DISTINCT", "RECURSIVE", "MATERIALIZED", "NOTHING", "TO", "PRIMARY", "FOREIGN", "CONSTRAINT",
  "REFERENCES", "INDEX", "VIEW", "TRIGGER", "BEGIN", "ESCAPE", "COLLATE", "MATCH", "PARTITION",
  "WINDOW", "RANGE", "GROUPS", "INHERITS", "INCLUDE", "GENERATED", "STORED", "VIRTUAL",
]);
/** A name followed by `(` right after one of these is a table or a CTE and its column list. */
const TABLE_BEFORE_PAREN = new Set(["INTO", "TABLE", "JOIN", "FROM", "REFERENCES", "UPDATE", "WITH", "VIEW", "EXISTS", "ON", "UPSERT"]);
/** The functions a declaration body may call: the floor's per-row allow-list, its aggregates, and `RAISE`. */
const ALLOWED_CALLS: ReadonlySet<string> = new Set([...TENANT_ROW_FUNCTIONS, ...TENANT_GROUP_AGGREGATES, "raise"]);

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
  for (let k = from; k < to; k++) {
    const t = toks[k];
    if (t.k === "p" && t.t === "${") interp = true;
    if ((t.k === "w" || t.k === "q") && tainted.has(t.t.toLowerCase())) names.add(t.t.toLowerCase());
    if (t.k === "s") for (const n of stringMentions(t.t, tainted)) names.add(n);
    if (t.k === "w" && isP(toks[k + 1], "(") && !NOT_A_CALL.has(t.up)) {
      const prev = toks[k - 1];
      if (isP(prev, ".")) {
        calls.push(`${toks[k - 2]?.t ?? ""}.${t.t}`);
        continue;
      }
      if (prev && prev.k === "w" && TABLE_BEFORE_PAREN.has(prev.up)) continue;
      if (!ALLOWED_CALLS.has(t.t.toLowerCase())) calls.push(t.t);
    }
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
    // The body: a SQLite / MySQL `BEGIN … END` (CASE … END nests), a Postgres
    // `EXECUTE FUNCTION f()`, or a MySQL single statement after FOR EACH ROW.
    let depth = 0;
    let b = tbl.next;
    for (; b < toks.length; b++) {
      const t = toks[b];
      if (t.k === "b") break;
      if (isP(t, "(")) depth++;
      else if (isP(t, ")")) depth = Math.max(0, depth - 1);
      else if (depth === 0 && (isW(t, "BEGIN") || isW(t, "EXECUTE") || isP(t, ";"))) break;
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
      let d = 0;
      let e = b;
      for (; e < toks.length; e++) {
        const t = toks[e];
        if (t.k === "b") break;
        if (isW(t, "BEGIN") || isW(t, "CASE")) d++;
        else if (isW(t, "END")) { d--; if (d === 0) break; }
      }
      if (e >= toks.length || toks[e].k === "b") {
        base.end = e;
        base.region = [head[0], e];
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

/** Statement leaders that move or rename nothing the floor reads. */
const INERT_LEADERS = new Set([
  "DROP", "PRAGMA", "COMMENT", "GRANT", "REVOKE", "ANALYZE", "VACUUM", "REINDEX", "BEGIN", "COMMIT",
  "END", "ROLLBACK", "SAVEPOINT", "RELEASE", "SET",
]);

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
  const generic: Array<{ start: number; end: number; leader: string; target: string | null; at: number }> = [];
  const contexts: Array<{ from: number; to: number; table: string }> = [];

  // 1. Statements.
  for (let i = 0; i < toks.length; i++) {
    if (consumed[i]) continue;
    const t = toks[i];
    if (isW(t, "CREATE")) {
      const d = parseCreate(toks, i);
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
      generic.push({ start: i, end, leader: "${", target: null, at: t.at });
      for (let k = i; k < Math.max(end, i + 1); k++) consumed[k] = 1;
      i = Math.max(end, i + 1) - 1;
      continue;
    }
    if (t.k === "w" && t.sql && atStart) {
      const end = statementEnd(toks, i);
      let target: string | null = null;
      if (t.up === "ALTER" && isW(toks[i + 1], "TABLE")) {
        let k = i + 2;
        if (isW(toks[k], "ONLY")) k++;
        if (isW(toks[k], "IF") && isW(toks[k + 1], "EXISTS")) k += 2;
        const nm = readName(toks, k);
        if (nm) { target = nm.name; contexts.push({ from: nm.next, to: end, table: nm.name }); }
      }
      generic.push({ start: i, end, leader: t.up, target, at: t.at });
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
      continue;
    }
    if (d.kind === "function") {
      out.push({ kind: "function", object: shown, tables: allTenant, unattributable: true, offset: d.at, why: d.unreadable! });
      continue;
    }
    if (d.kind === "table") {
      if (d.unreadable) continue; // E-SCHEMA-012/013/014 own unreadable table heads
      const hits = r.names.filter((n) => n !== d.name);
      if (hits.length) {
        out.push({ kind: "statement", object: `CREATE TABLE ${shown}`, tables: tenantsUnder(hits), unattributable: false, offset: d.at,
          why: `outside its column list it names ${hits.map((n) => `\`${n}\``).join(", ")} (\`AS SELECT\`, \`INHERITS\`, \`PARTITION OF\`, …) — ` +
            `its rows would come from, or be read through, a tenant-scoped table without the floor` });
      }
      continue;
    }
    if (d.kind === "index") continue;
    // Any other CREATE (a virtual / foreign table, a policy, a publication, …). In the
    // comment-content reading, comment text can split a statement (`CREATE /* x */ VIEW`
    // reads as `CREATE x VIEW`); a CREATE of no known object kind is that artifact, and
    // the comment-free readings own the live statement.
    if (declsOnly && !KNOWN_OBJECTS.has(d.object ?? "")) continue;
    if (r.names.length || r.interp) {
      const mods = ["VIRTUAL", "FOREIGN"].filter((m) => d.flags.has(m)).join(" ");
      out.push({ kind: "statement", object: `CREATE ${mods ? `${mods} ` : ""}${d.object ?? "?"} ${shown}`.trim(), tables: r.names.length ? tenantsUnder(r.names) : allTenant,
        unattributable: r.names.length === 0, offset: d.at,
        why: r.names.length
          ? `it names ${r.names.map((n) => `\`${n}\``).join(", ")}, and the floor cannot scope what it does with that table`
          : "it holds a `${…}` interpolation the checker cannot read" });
    }
  }

  // 3. Other SQL statements in the `<schema>`.
  if (!declsOnly) {
    for (const g of generic) {
      if (INERT_LEADERS.has(g.leader)) continue;
      if (g.leader === "${") {
        out.push({ kind: "statement", object: "`${…}`", tables: allTenant, unattributable: true, offset: g.at,
          why: "the statement is a `${…}` interpolation, SQL the checker cannot read" });
        continue;
      }
      const r = readRegion(toks, g.start + 1, g.end, tainted);
      const label = toks.slice(g.start, Math.min(g.end, g.start + 3)).map((t) => t.t).join(" ");
      if (g.leader === "DO" || g.leader === "CALL" || g.leader === "EXECUTE") {
        out.push({ kind: "function", object: label, tables: allTenant, unattributable: true, offset: g.at,
          why: "it runs code the floor never sees" });
        continue;
      }
      let hits = r.names;
      if (g.leader === "ALTER" && g.target !== null) {
        // ALTER TABLE <t> …: naming its own target is fine — unless it RENAMEs a tenant table
        // (the renamed table no longer carries the name the floor scopes).
        const renames = toks.slice(g.start, g.end).some((t) => isW(t, "RENAME"));
        hits = hits.filter((n) => n !== g.target || renames);
        // a REFERENCES target is the foreign-key rule's business
        const refTargets = new Set<string>();
        for (let k = g.start; k < g.end; k++) if (isW(toks[k], "REFERENCES")) { const nm = readName(toks, k + 1); if (nm) refTargets.add(nm.name); }
        hits = hits.filter((n) => !refTargets.has(n) || (n === g.target && renames));
      }
      if (hits.length || r.interp) {
        out.push({ kind: "statement", object: label, tables: hits.length ? tenantsUnder(hits) : allTenant,
          unattributable: hits.length === 0, offset: g.at,
          why: hits.length
            ? `it names ${hits.map((n) => `\`${n}\``).join(", ")}, and the floor cannot scope what it does with that table`
            : "it holds a `${…}` interpolation the checker cannot read" });
      }
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
    const key = `${h.kind}|${h.object.toLowerCase()}|${h.why}`;
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

/**
 * A key naming the declared object (de-duplication across call sites): a wider
 * tenant set can change WHICH tables a hazard reaches, never which object it is.
 */
export function schemaHazardKey(h: SchemaHazard): string {
  return `${h.kind}|${h.object.toLowerCase()}`;
}

/** The `E-TENANT-SCHEMA-HAZARD` message for one hazard. */
export function schemaHazardMessage(h: SchemaHazard, body: string): string {
  const tables = h.unattributable
    ? `every tenant-scoped table (${h.tables.map((t) => `\`${t}\``).join(", ")})`
    : `the tenant-scoped table${h.tables.length > 1 ? "s" : ""} ${h.tables.map((t) => `\`${t}\``).join(", ")}`;
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
