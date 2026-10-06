/**
 * db-ownership.ts — which SQLite database FILES a `.scrml` file OWNS (§8.1.1).
 *
 * > "A program that declares its own schema (its own `CREATE TABLE`s or a `<schema>`)
 * > owns the database, so the runtime may create the file. A program that only
 * > references a database never creates it and fails loudly if the file is missing."
 * > — ruling:user-voice-scrml.md S445 item 6
 * > "keep your literal ruling, so only a file that declares the schema may create the
 * > database. Other modules then open it once it exists, rather than at load time.
 * > That way the answer doesn't depend on which files are in the build."
 * > — ruling:user-voice-scrml.md S445 (per-file ownership; supersedes the round-2
 * > program-wide reading)
 *
 * ⚑ THE OWNERSHIP DECISION IS ONE FUNCTION: `decideOwnedDbFiles`. Every consumer calls
 * it over ONE declaring file, so a module's answer never depends on which other files
 * are in the build.
 *
 * THE PREDICATE, per database TARGET (one resolved file, `db-target.ts
 * resolveDbFilePath`): a file owns a target when it DECLARES SCHEMA FOR IT —
 *
 *   - a `?{}` block holding a statement that CREATES A TABLE IN THAT DATABASE
 *     (`sqlDeclaresTable`: `CREATE [VIRTUAL] TABLE`, including `… AS SELECT`; not
 *     `TEMP`, not a table qualified to another attached schema), or
 *   - a `<schema>` block (any form — declarative, raw DDL, `schemaFor(T)`).
 *
 * WHICH TARGET (S445 review F6 — one rule with codegen; S451 §8.1.1 nearest scope). A
 * `?{}` block runs against its NEAREST enclosing database scope — a `<program db=>` or
 * a `<db src=>`, whichever is closer (`resolveDbScopes`, which codegen's
 * `collectDbScopes` and every `?{}` lowering also read). So a `?{}` declaration owns
 * exactly the database its statement will run against. A `<schema>` block is not
 * executed; it declares schema for the database the same rule gives its position, else
 * (no scope above it — a §44.7.1 module-with-db-context) for the file's default
 * database (`fileDefaultDbValue`).
 *
 * Consumers (none may decide ownership another way):
 *   - codegen (`codegen/sqlite-file-target.ts`): an owned target's handle may create
 *     the file; any other SQLite file handle refuses to load when it is missing.
 *   - the compile-time schema read (`protect-analyzer.ts`): an owned target whose file
 *     exists but holds NO tables is read like an absent one.
 *
 * Pure: AST walk, SQL tokenizing and path arithmetic — no filesystem access.
 */

import { classifyDbTarget, resolveDbFilePath } from "./db-target.ts";
import { jsInterpolationEnd } from "./codegen/sql-lex.ts";

type AnyNode = Record<string, unknown>;

/** A string-valued attribute's value, across the AST's attribute shapes. */
export function dbAttrValue(node: AnyNode, name: string): string | null {
  const attrs = ((node.attributes ?? node.attrs) as unknown[] | undefined) ?? [];
  for (const a of attrs) {
    if (!a || typeof a !== "object") continue;
    const attr = a as AnyNode;
    if (attr.name !== name) continue;
    const v = attr.value as unknown;
    if (typeof v === "string") return v;
    if (v && typeof v === "object") {
      const o = v as AnyNode;
      if (typeof o.value === "string") return o.value;
      if (typeof o.name === "string") return o.name;
    }
    return null;
  }
  return null;
}

function hasAttr(node: AnyNode, name: string): boolean {
  const attrs = ((node.attributes ?? node.attrs) as unknown[] | undefined) ?? [];
  return attrs.some((a) => !!a && typeof a === "object" && (a as AnyNode).name === name);
}

/**
 * The `db=` / `src=` value codegen binds a file's DEFAULT `_scrml_sql` handle to. It is
 * NOT the rule for which database a `?{}` runs on — that is its nearest scope
 * (`resolveDbScopes`, §8.1.1 S451). The default names the handle a single-database file
 * has always emitted, the compiler's own bookkeeping queries (the §19.9.6 idempotency
 * table), and the §44.7.1 module-with-db-context fallback.
 *
 * Walks `children` depth-first in document order, as `collectDbScopes` always has:
 * the first non-empty `<db src=>` wins; with none, the first `<program db=>` that
 * carries no `name=` (a named program is not a db scope — `annotateDbScopes`).
 */
export function fileDefaultDbValue(nodes: unknown): string | null {
  return fileDefaultDbDecl(nodes)?.value ?? null;
}

/**
 * The node that declares a file's default `_scrml_sql` database (see
 * `fileDefaultDbValue`, which reads its value) together with that value — so a
 * per-database attribute on the SAME element (`transactions=`, §19.10.6) is read off
 * the declaration the handle is actually bound to.
 */
export function fileDefaultDbDecl(nodes: unknown): { value: string; node: AnyNode } | null {
  let firstDbSrc: { value: string; node: AnyNode } | null = null;
  let firstProgramDb: { value: string; node: AnyNode } | null = null;
  const walk = (children: unknown): void => {
    if (!Array.isArray(children) || firstDbSrc !== null) return;
    for (const n of children) {
      if (!n || typeof n !== "object" || firstDbSrc !== null) continue;
      const node = n as AnyNode;
      if (node.kind === "markup" && node.tag === "program" && firstProgramDb === null && !hasAttr(node, "name")) {
        const v = dbAttrValue(node, "db");
        if (v !== null && v.length > 0) firstProgramDb = { value: v, node };
      }
      if (node.kind === "state" && node.stateType === "db") {
        const v = dbAttrValue(node, "src");
        if (v !== null && v.length > 0) { firstDbSrc = { value: v, node }; return; }
      }
      walk(node.children);
    }
  };
  walk(nodes);
  return firstDbSrc ?? firstProgramDb;
}

// ---------------------------------------------------------------------------
// §8.1.1 — which database each `?{}` runs on: its NEAREST enclosing database scope
// ---------------------------------------------------------------------------

/**
 * One database HANDLE a file's server code opens. Several database scopes that name
 * the SAME database (the same resolved SQLite file, or the same connection string)
 * share one handle — one connection, one §19.10.6 transaction guard — so a
 * `<program db="./app.db">` holding a `<db src="./app.db">` still opens the file once.
 */
export interface DbHandle {
  /** The emitted identifier: `_scrml_sql` for the file's default database, else `_scrml_sql_<n>`. */
  ident: string;
  /** The `db=` / `src=` value as written on `node`. */
  value: string;
  /** The FIRST scope element (document order) that names this database — per-database
   *  attributes (`transactions=`, §19.10.6) are read off it; for the default handle it is
   *  the `fileDefaultDbDecl` node, exactly as before. */
  node: AnyNode;
}

/** A `?{}` (or `<transaction>`) site and the handle its nearest scope resolves to. */
export interface DbSite {
  node: AnyNode;
  /** null = no database scope above it (E-SQL-004 unless the file is a module-with-db-context). */
  handle: DbHandle | null;
}

export interface DbScopeResolution {
  /** Every handle, default (`_scrml_sql`) first, then `_scrml_sql_<n>` ascending. */
  handles: DbHandle[];
  /** Handle by identifier. */
  byIdent: Map<string, DbHandle>;
  /** The file's default handle (`fileDefaultDbDecl`), or null when the file has no scope. */
  defaultHandle: DbHandle | null;
  /** Every `?{}` / `<transaction>` site, document order, with its nearest scope's handle. */
  sites: DbSite[];
  /** Nearest-scope handle for every object visited (null = visited, no scope above). */
  scopeOf: WeakMap<object, DbHandle | null>;
}

/** The `?{}`-class node kinds — the same set as codegen/collect.ts `SQL_KINDS` +
 *  `TRANSACTION_KINDS`: each runs against a database handle. */
const DB_SITE_KINDS: ReadonlySet<string> = new Set(["sql", "sql-ref", "transaction-block"]);

/** The `db=` / `src=` value when `node` is a DATABASE SCOPE (§8.1.1), else null. */
export function dbScopeValueOf(node: AnyNode): string | null {
  if (node.kind === "markup" && node.tag === "program") {
    const v = dbAttrValue(node, "db");
    return v !== null && v.trim().length > 0 ? v : null;
  }
  if (node.kind === "state" && node.stateType === "db") {
    const v = dbAttrValue(node, "src");
    return v !== null && v.trim().length > 0 ? v : null;
  }
  return null;
}

/** A stable id per `:memory:` scope element (see `databaseIdentity`). */
const _memoryScopeIds = new WeakMap<object, number>();
let _memoryScopeNext = 0;
function memoryScopeId(node: AnyNode): number {
  let id = _memoryScopeIds.get(node);
  if (id === undefined) { id = ++_memoryScopeNext; _memoryScopeIds.set(node, id); }
  return id;
}

/** What makes two scope values the SAME database: the declaring element for
 *  `:memory:`; the resolved SQLite file when the declaring file is known; else the
 *  trimmed value. */
function databaseIdentity(value: string, filePath: string | null, node: AnyNode): string {
  // `:memory:` names no shared thing: each scope that declares it is its OWN empty
  // database, so it is keyed by the declaring ELEMENT, never by value (S451 review
  // MED-2: two `<db src=":memory:">` blocks shared one connection, each reading the
  // other's rows).
  if (classifyDbTarget(value).kind === "sqlite-memory") return "memory:" + memoryScopeId(node);
  if (filePath) {
    const f = sqliteFileTarget(value, filePath);
    if (f !== null) return "file:" + f;
  }
  return "value:" + value.trim();
}

/**
 * THE §8.1.1 resolution rule, structurally: "A `?{}` context resolves its database by
 * walking up the ancestor tree from the `?{}` block's position to the closest database
 * scope. Two elements are database scopes: a `<program>` with a `db=` attribute, and a
 * `<db>` state block (its `src=` attribute). The NEAREST one wins."
 *
 * One depth-first walk over every structural field (as `codegen/collect.ts
 * bodyContains` walks — `span` and `_`-prefixed annotation fields skipped) carries the nearest scope down the tree, so
 * each node's answer comes from its ANCESTOR CHAIN, never from text or document order.
 * Document order only NUMBERS the handles (`_scrml_sql_1`, `_scrml_sql_2`, …); the
 * default handle `_scrml_sql` keeps naming the database `fileDefaultDbDecl` names, so a
 * file with one database emits exactly what it always did.
 *
 * `filePath` (the declaring `.scrml` file) lets two spellings of one SQLite file share a
 * handle; without it values are compared as written.
 */
export function resolveDbScopes(nodes: unknown, filePath: string | null = null): DbScopeResolution {
  const handles: DbHandle[] = [];
  const byIdent = new Map<string, DbHandle>();
  const byIdentity = new Map<string, DbHandle>();
  const sites: DbSite[] = [];
  const scopeOf = new WeakMap<object, DbHandle | null>();

  const defaultDecl = fileDefaultDbDecl(nodes);
  let defaultHandle: DbHandle | null = null;
  if (defaultDecl !== null) {
    defaultHandle = { ident: "_scrml_sql", value: defaultDecl.value, node: defaultDecl.node };
    handles.push(defaultHandle);
    byIdent.set(defaultHandle.ident, defaultHandle);
    byIdentity.set(databaseIdentity(defaultDecl.value, filePath, defaultDecl.node), defaultHandle);
  }
  let next = 0;
  const handleFor = (value: string, node: AnyNode): DbHandle => {
    const id = databaseIdentity(value, filePath, node);
    const known = byIdentity.get(id);
    if (known) return known;
    const h: DbHandle = { ident: `_scrml_sql_${++next}`, value, node };
    handles.push(h);
    byIdent.set(h.ident, h);
    byIdentity.set(id, h);
    return h;
  };

  const seen = new WeakSet<object>();
  const visit = (value: unknown, scope: DbHandle | null): void => {
    if (value === null || typeof value !== "object") return;
    if (seen.has(value as object)) return;
    seen.add(value as object);
    if (Array.isArray(value)) {
      for (const item of value) visit(item, scope);
      return;
    }
    const node = value as AnyNode;
    let here = scope;
    const sv = dbScopeValueOf(node);
    // The scope element itself (and so its attributes) is INSIDE its own scope.
    if (sv !== null) here = handleFor(sv, node);
    scopeOf.set(node, here);
    if (typeof node.kind === "string" && DB_SITE_KINDS.has(node.kind)) {
      sites.push({ node, handle: here });
    }
    for (const key of Object.keys(node)) {
      if (key === "span" || key.startsWith("_")) continue; // annotations are not tree edges
      visit(node[key], here);
    }
  };
  visit(nodes, null);

  return { handles, byIdent, defaultHandle, sites, scopeOf };
}

/**
 * The handles of every `?{}` / `<transaction>` site INSIDE `node` (a server function, a
 * cell declaration, …). A null entry is a site with no scope above it.
 */
export function dbHandlesWithin(res: DbScopeResolution, node: unknown): Set<DbHandle | null> {
  const out = new Set<DbHandle | null>();
  const seen = new WeakSet<object>();
  const visit = (value: unknown): void => {
    if (value === null || typeof value !== "object") return;
    if (seen.has(value as object)) return;
    seen.add(value as object);
    if (Array.isArray(value)) { for (const item of value) visit(item); return; }
    const n = value as AnyNode;
    if (typeof n.kind === "string" && DB_SITE_KINDS.has(n.kind)) {
      const h = res.scopeOf.get(n);
      // A site the resolution walk never reached (a node rebuilt after it ran) has no
      // known scope: report it as unresolved rather than guess one.
      out.add(h === undefined ? null : h);
    }
    for (const key of Object.keys(n)) {
      if (key === "span" || key.startsWith("_")) continue;
      visit(n[key]);
    }
  };
  visit(node);
  return out;
}

/** The absolute FILE a `db=` / `src=` value names, or null when it is not a SQLite file. */
export function sqliteFileTarget(value: string | null, declaringSourceFile: string): string | null {
  if (value === null || !declaringSourceFile) return null;
  const cls = classifyDbTarget(value);
  if (cls.kind !== "sqlite-file" || cls.sqlitePath === null || cls.sqlitePath === ":memory:") return null;
  return resolveDbFilePath(cls, declaringSourceFile);
}

// ---------------------------------------------------------------------------
// SQL: does a statement create a table in THIS database? (S445 review F5)
// ---------------------------------------------------------------------------

type SqlTok = { k: "word" | "ident" | "punct"; v: string };

/**
 * Tokenize SQL text for statement-head recognition. Comments (`--`, `/* *\/`) and
 * string literals (`'…'`) are DROPPED, so a `CREATE TABLE` inside either is not a
 * statement; quoted identifiers (`"…"`, `` `…` ``, `[…]`) are kept as identifiers;
 * a scrml `${…}` interpolation is one opaque token.
 */
function tokenizeSql(sql: string): SqlTok[] {
  const out: SqlTok[] = [];
  const n = sql.length;
  let i = 0;
  while (i < n) {
    const c = sql[i];
    if (c === "-" && sql[i + 1] === "-") { while (i < n && sql[i] !== "\n") i++; continue; }
    if (c === "/" && sql[i + 1] === "*") { const e = sql.indexOf("*/", i + 2); i = e < 0 ? n : e + 2; continue; }
    if (c === "'") {
      i++;
      while (i < n) { if (sql[i] === "'") { if (sql[i + 1] === "'") { i += 2; continue; } i++; break; } i++; }
      continue;
    }
    if (c === '"' || c === "`" || c === "[") {
      const close = c === "[" ? "]" : c;
      let j = i + 1; let v = "";
      while (j < n) { if (sql[j] === close) { if (close !== "]" && sql[j + 1] === close) { v += close; j += 2; continue; } j++; break; } v += sql[j]; j++; }
      out.push({ k: "ident", v }); i = j; continue;
    }
    if (c === "$" && sql[i + 1] === "{") {
      // The emitter's slot extent (sql-lex.ts, JS-aware) — never a re-derived brace count (S456 F1).
      const end = jsInterpolationEnd(sql, i);
      out.push({ k: "punct", v: "${}" }); i = end === -1 ? n : end; continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1; while (j < n && /[A-Za-z0-9_$]/.test(sql[j])) j++;
      out.push({ k: "word", v: sql.slice(i, j) }); i = j; continue;
    }
    if (/\s/.test(c)) { i++; continue; }
    out.push({ k: "punct", v: c }); i++;
  }
  return out;
}

/**
 * True when some statement in `sql` creates a table in the database the `?{}` runs
 * against: `CREATE [VIRTUAL] TABLE [IF NOT EXISTS] [main.]name …` — with a column
 * list, `AS SELECT …`, or `USING module(…)`. NOT a `TEMP`/`TEMPORARY` table (it lives
 * in the connection's temp schema, not the file), NOT one qualified to another
 * attached schema (`other.t`), and NOT text inside a comment or string literal.
 */
export function sqlDeclaresTable(sql: string): boolean {
  const toks = tokenizeSql(sql);
  const kw = (t: SqlTok | undefined, w: string) => !!t && t.k === "word" && t.v.toUpperCase() === w;
  let atStart = true;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.k === "punct" && t.v === ";") { atStart = true; continue; }
    if (!atStart) continue;
    atStart = false;
    if (!kw(t, "CREATE")) continue;
    let j = i + 1;
    if (kw(toks[j], "TEMP") || kw(toks[j], "TEMPORARY")) continue; // temp schema, not the file
    if (kw(toks[j], "VIRTUAL")) j++;
    if (!kw(toks[j], "TABLE")) continue;
    j++;
    if (kw(toks[j], "IF") && kw(toks[j + 1], "NOT") && kw(toks[j + 2], "EXISTS")) j += 3;
    const name = toks[j];
    if (!name || (name.k !== "word" && name.k !== "ident" && !(name.k === "punct" && name.v === "${}"))) continue;
    if (toks[j + 1]?.k === "punct" && toks[j + 1].v === ".") {
      // schema-qualified: only `main` is this database (`temp` is the temp schema).
      if (name.v.toLowerCase() !== "main") continue;
    }
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Ownership
// ---------------------------------------------------------------------------

/** The SQLite files ONE `.scrml` file declares schema for (see the module comment). */
export function collectOwnedDbFiles(nodes: unknown, filePath: string, out: Set<string> = new Set()): Set<string> {
  // §8.1.1 *Ownership* (S451): "*That database* for a `?{}` block is the database the
  // block runs against, as the resolution rule above gives it: its nearest enclosing
  // database scope … A `<schema>` block declares for the database the same rule gives
  // its position … with neither, for the module-with-db-context's top-level
  // `<db src=>`." — the SAME resolution codegen binds each `?{}` with.
  const res = resolveDbScopes(nodes, filePath);
  const targetOf = (h: DbHandle | null | undefined): string | null => {
    const handle = h ?? res.defaultHandle;
    return handle ? sqliteFileTarget(handle.value, filePath) : null;
  };

  for (const site of res.sites) {
    const node = site.node;
    if (node.kind === "sql" && typeof node.query === "string" && sqlDeclaresTable(node.query as string)) {
      const t = targetOf(site.handle);
      if (t !== null) out.add(t);
    }
  }
  const visit = (value: unknown, depth: number): void => {
    if (value === null || typeof value !== "object" || depth > 96) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    const node = value as AnyNode;
    if (node.kind === "state" && node.stateType === "schema") {
      const t = targetOf(res.scopeOf.get(node));
      if (t !== null) out.add(t);
    }
    for (const key of Object.keys(node)) {
      if (key === "span" || key.startsWith("_")) continue;
      visit(node[key], depth + 1);
    }
  };

  visit(nodes, 0);
  return out;
}

/** The node list of a file AST, across the two shapes the pipeline passes around. */
function fileNodes(f: AnyNode): unknown {
  // Same precedence as codegen/collect.ts `getNodes`.
  if (Array.isArray(f.nodes)) return f.nodes;
  const ast = f.ast as AnyNode | undefined;
  if (ast && Array.isArray(ast.nodes)) return ast.nodes;
  return [];
}

/**
 * THE ownership decision: the SQLite files the given files declare schema for (file
 * ASTs carrying `filePath` + `nodes` / `ast.nodes`). Per the S445 per-file ruling every
 * consumer passes exactly ONE declaring file — the decision for a module is the
 * decision for the file that emits it, whatever else is in the build.
 */
export function decideOwnedDbFiles(files: readonly unknown[]): Set<string> {
  const out = new Set<string>();
  for (const f of files) {
    if (!f || typeof f !== "object") continue;
    const file = f as AnyNode;
    const filePath = typeof file.filePath === "string" ? file.filePath : "";
    if (!filePath) continue;
    collectOwnedDbFiles(fileNodes(file), filePath, out);
  }
  return out;
}
