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
import { schemaTableDeclarations, DBAUTH_ROLE } from "./schema-differ.js";

/** The hazard kinds (the `kind` named in the diagnostic). */
export type SchemaHazardKind =
  | "trigger" | "rule" | "foreign key" | "view" | "function" | "statement" | "permissive policy" | "isolation removal";

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
    // A callee may be QUOTED (`"query_to_xml"(…)` is a call in Postgres; `[f](…)` in
    // SQLite) — a quoted name is never a keyword, and is case-exact.
    if ((t.k === "w" || t.k === "q") && isP(toks[k + 1], "(") && !(t.k === "w" && NOT_A_CALL.has(t.up))) {
      const prev = toks[k - 1];
      if (isP(prev, ".")) {
        calls.push(`${toks[k - 2]?.t ?? ""}.${t.t}`);
        continue;
      }
      if (prev && prev.k === "w" && TABLE_BEFORE_PAREN.has(prev.up)) continue;
      if (!ALLOWED_CALLS.has(t.k === "q" ? t.t : t.t.toLowerCase())) calls.push(t.t);
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
 * The statement leaders exempt even when they name a tenant-scoped table — part of
 * the §14.8.10 CLOSED exemption list (ruling:user-voice-scrml.md S455 "yes both"):
 * `CREATE INDEX`, `ALTER TABLE … ADD COLUMN`, `ANALYZE`, `REINDEX`. Anything else that
 * names a tenant-scoped table is charged.
 *
 * Until S455 "yes both" this set also held DROP, PRAGMA, COMMENT, GRANT, REVOKE,
 * VACUUM, BEGIN, COMMIT, END, ROLLBACK, SAVEPOINT, RELEASE and SET — which hid
 * `DROP POLICY scrml_tenant_iso ON assets`, `GRANT … ON assets TO PUBLIC` and
 * `SET row_security = off` (each passed clean). Those leaders are now read like any
 * other statement: charged when they name a tenant table, the isolation-removal
 * shapes under their own kind (`isolationRemoval`).
 */
const INERT_LEADERS = new Set(["ANALYZE", "REINDEX"]);

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
 * True when every action of an `ALTER TABLE` — its action tokens are `[from, to)` —
 * is `ADD [COLUMN] [IF NOT EXISTS] <column> …`: the closed list's `ALTER TABLE … ADD
 * COLUMN` (a non-tenant column, or `tenant_id` itself — the scoping declaration). A
 * `REFERENCES` inside a column definition is the foreign-key rule's business.
 */
function alterOnlyAddsColumns(toks: Tok[], from: number, to: number): boolean {
  const actions: Array<[number, number]> = [];
  let depth = 0;
  let s = from;
  for (let k = from; k < to; k++) {
    if (isP(toks[k], "(")) depth++;
    else if (isP(toks[k], ")")) depth = Math.max(0, depth - 1);
    else if (isP(toks[k], ",") && depth === 0) { actions.push([s, k]); s = k + 1; }
  }
  actions.push([s, to]);
  for (const [a, b] of actions) {
    if (b <= a || !isW(toks[a], "ADD")) return false;
    let k = a + 1;
    if (isW(toks[k], "COLUMN")) k++;
    else if (toks[k]?.k === "w" && ADD_NOT_A_COLUMN.has(toks[k].up)) return false;
    if (isW(toks[k], "IF") && isW(toks[k + 1], "NOT") && isW(toks[k + 2], "EXISTS")) k += 3;
    if (k >= b || !isName(toks[k])) return false;
  }
  return true;
}

/** The grantees of `GRANT … TO a, b [WITH …] [GRANTED BY …]`, from the token after `TO`. */
function granteesOf(toks: Tok[], from: number, end: number): string[] {
  const out: string[] = [];
  for (let k = from; k < end; k++) {
    const t = toks[k];
    if (isW(t, "WITH") || isW(t, "GRANTED")) break;
    if (isP(t, ",") || isW(t, "GROUP") || isW(t, "ROLE")) continue;
    out.push(isName(t) ? t.t.toLowerCase() : `?${t.t}`);
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
    if (!allTables && objs.names.length === 0 && !objs.interp) return null;
    if (onlyApp && !objs.interp && toAt !== -1) return "exempt";
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
    if (t.k === "w" && t.sql && atStart) {
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
      generic.push({ start: i, end, leader: t.up, target, targetEnd, at: t.at });
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
      if (!tainted.has(tbl.name)) continue;
      let mode: string | null = "PERMISSIVE (the default when `AS` is omitted)";
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
      // ISOLATION REMOVAL (S455 "yes both") — its own kind, whatever else the statement names.
      const removal = isolationRemoval(toks, g, tainted, allTenant, tenantsUnder);
      if (removal === "exempt") continue;             // GRANT … ON <tenant> TO scrml_app only
      if (removal !== null) { out.push(removal); continue; }
      // The closed exemption list's `ALTER TABLE … ADD COLUMN`: every action adds a column.
      // (Any OTHER action on a statement naming a tenant table is charged — RENAME, DROP /
      // ALTER COLUMN, ADD CONSTRAINT, ENABLE / FORCE ROW LEVEL SECURITY, … S455 "yes both".)
      if (g.leader === "ALTER" && g.target !== null && g.targetEnd !== -1 && !r.interp &&
          alterOnlyAddsColumns(toks, g.targetEnd, g.end)) continue;
      const hits = r.names;
      if (hits.length || r.interp) {
        out.push({ kind: "statement", object: label, tables: hits.length ? tenantsUnder(hits) : allTenant,
          unattributable: hits.length === 0, offset: g.at,
          why: hits.length
            ? `it names ${hits.map((n) => `\`${n}\``).join(", ")}, and the floor cannot scope what it does with that table ` +
              "(the only statements exempt are `CREATE INDEX`, `ALTER TABLE … ADD COLUMN`, `ANALYZE` and `REINDEX`)"
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
