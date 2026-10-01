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
 * WHICH TARGET (S445 review F6 — one rule with codegen). A `?{}` block runs against
 * the handle codegen binds it to, and codegen binds EVERY `?{}` in a file to the
 * file's DEFAULT handle `_scrml_sql` (`fileDefaultDbValue`: the first `<db src=>` in
 * document order, else the first `<program db=>`) — `collectDbScopes` calls the same
 * function. So a `?{}` declaration owns the file's default target, exactly the
 * database its statement will run against. A `<schema>` block is not executed; it
 * declares schema for its innermost enclosing `<program db=>` / `<db src=>`, else for
 * the file's default target.
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
 * The `db=` / `src=` value codegen binds a file's default `_scrml_sql` handle to —
 * THE rule for which database a `?{}` block runs against (every `?{}` in a file is
 * lowered onto `_scrml_sql`; codegen/index.ts passes `dbVar: "_scrml_sql"`).
 *
 * Walks `children` depth-first in document order, as `collectDbScopes` always has:
 * the first non-empty `<db src=>` wins; with none, the first `<program db=>` that
 * carries no `name=` (a named program is not a db scope — `annotateDbScopes`).
 */
export function fileDefaultDbValue(nodes: unknown): string | null {
  let firstDbSrc: string | null = null;
  let firstProgramDb: string | null = null;
  const walk = (children: unknown): void => {
    if (!Array.isArray(children) || firstDbSrc !== null) return;
    for (const n of children) {
      if (!n || typeof n !== "object" || firstDbSrc !== null) continue;
      const node = n as AnyNode;
      if (node.kind === "markup" && node.tag === "program" && firstProgramDb === null && !hasAttr(node, "name")) {
        const v = dbAttrValue(node, "db");
        if (v !== null && v.length > 0) firstProgramDb = v;
      }
      if (node.kind === "state" && node.stateType === "db") {
        const v = dbAttrValue(node, "src");
        if (v !== null && v.length > 0) { firstDbSrc = v; return; }
      }
      walk(node.children);
    }
  };
  walk(nodes);
  return firstDbSrc ?? firstProgramDb;
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
      let depth = 0; let j = i + 1;
      for (; j < n; j++) { if (sql[j] === "{") depth++; else if (sql[j] === "}") { depth--; if (depth === 0) { j++; break; } } }
      out.push({ k: "punct", v: "${}" }); i = j; continue;
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
  const fileDefault = sqliteFileTarget(fileDefaultDbValue(nodes), filePath);

  const visit = (value: unknown, scope: string | null, depth: number): void => {
    if (value === null || typeof value !== "object" || depth > 96) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, scope, depth + 1);
      return;
    }
    const node = value as AnyNode;
    let here = scope;
    if (node.kind === "markup" && node.tag === "program" && !hasAttr(node, "name")) {
      const t = sqliteFileTarget(dbAttrValue(node, "db"), filePath);
      if (t !== null) here = t;
    } else if (node.kind === "state" && node.stateType === "db") {
      const t = sqliteFileTarget(dbAttrValue(node, "src"), filePath);
      if (t !== null) here = t;
    }
    if (node.kind === "sql" && typeof node.query === "string" && sqlDeclaresTable(node.query as string)) {
      // A `?{}` runs on the file's default handle — own THAT database.
      if (fileDefault !== null) out.add(fileDefault);
    }
    if (node.kind === "state" && node.stateType === "schema") {
      const t = here ?? fileDefault;
      if (t !== null) out.add(t);
    }
    for (const key of Object.keys(node)) {
      if (key === "span" || key.startsWith("_")) continue;
      visit(node[key], here, depth + 1);
    }
  };

  visit(nodes, null, 0);
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
