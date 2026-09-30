/**
 * db-ownership.ts — which SQLite database FILES a program OWNS (§44.2, S445 ruling).
 *
 * > "A program that declares its own schema (its own `CREATE TABLE`s or a `<schema>`)
 * > owns the database, so the runtime may create the file. A program that only
 * > references a database never creates it and fails loudly if the file is missing."
 * > — ruling:user-voice-scrml.md S445 item 6
 *
 * THE PREDICATE, per database TARGET (one resolved file, `db-target.ts
 * resolveDbFilePath`) and per PROGRAM (the set of `.scrml` files compiled together):
 * the program owns a target when at least one of its files DECLARES SCHEMA FOR IT —
 *
 *   - a `?{}` block containing a `CREATE TABLE` statement (the one recognizer,
 *     `schema-differ.js harvestCreateTables`) that runs against that target, or
 *   - a `<schema>` block (any form — declarative, raw DDL, `schemaFor(T)`) in that
 *     target's scope.
 *
 * "Runs against / in scope of" is the innermost enclosing `<program db=>` or
 * `<db src=>` — the same scoping §44.2 / §44.7.1 give `?{}`. A declaration with NO
 * enclosing target (a library file's `?{}` fns written beside its top-level
 * `<db src>`, the §44.7.1 shape) belongs to the file's target when the file has
 * exactly ONE; with several it is ambiguous and owns nothing (fail-closed: no create).
 *
 * Two consumers, so they cannot disagree about ownership:
 *   - codegen (`codegen/sqlite-file-target.ts`): an owned target's handle opens with
 *     `create: true`; any other SQLite file handle opens with `create: false` and the
 *     module refuses to load when the file is missing.
 *   - the compile-time schema read (`protect-analyzer.ts`): an owned target whose file
 *     exists but holds NO tables is read like an absent one — the schema comes from
 *     the program's own declarations — so `touch app.db` before the first run is not
 *     an E-PA-004 dead end.
 *
 * Pure: AST walk + path arithmetic, no filesystem access.
 */

import { classifyDbTarget, resolveDbFilePath } from "./db-target.ts";
// THE ONE `CREATE TABLE` recognizer — schema-differ.js imports nothing heavy (see the
// protect-analyzer.ts note on why it lives there).
import { harvestCreateTables } from "./schema-differ.js";

type AnyNode = Record<string, unknown>;

/** A string-valued attribute's value, across the AST's attribute shapes. */
function attrValue(node: AnyNode, name: string): string | null {
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

/** The absolute FILE a `db=` / `src=` value names, or null when it is not a SQLite file. */
export function sqliteFileTarget(value: string | null, declaringSourceFile: string): string | null {
  if (value === null || !declaringSourceFile) return null;
  const cls = classifyDbTarget(value);
  if (cls.kind !== "sqlite-file" || cls.sqlitePath === null || cls.sqlitePath === ":memory:") return null;
  return resolveDbFilePath(cls, declaringSourceFile);
}

/** Does this `?{}` text declare a table? */
function declaresTable(query: string): boolean {
  const found = new Map<string, string>();
  harvestCreateTables(query, found, true);
  return found.size > 0;
}

/**
 * The SQLite files ONE `.scrml` file declares schema for. `nodes` is the file's
 * top-level node list (or any subtree); `filePath` its absolute path.
 */
export function collectOwnedDbFiles(nodes: unknown, filePath: string, out: Set<string> = new Set()): Set<string> {
  const targets = new Set<string>();
  let unscopedDeclaration = false;

  const visit = (value: unknown, target: string | null, depth: number): void => {
    if (value === null || typeof value !== "object" || depth > 96) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, target, depth + 1);
      return;
    }
    const node = value as AnyNode;
    let here = target;
    if (node.kind === "markup" && node.tag === "program") {
      const t = sqliteFileTarget(attrValue(node, "db"), filePath);
      if (t !== null) { here = t; targets.add(t); }
    } else if (node.kind === "state" && node.stateType === "db") {
      const t = sqliteFileTarget(attrValue(node, "src"), filePath);
      if (t !== null) { here = t; targets.add(t); }
    }
    const isDeclaration =
      (node.kind === "sql" && typeof node.query === "string" && declaresTable(node.query as string)) ||
      (node.kind === "state" && node.stateType === "schema");
    if (isDeclaration) {
      if (here !== null) out.add(here);
      else unscopedDeclaration = true;
    }
    for (const key of Object.keys(node)) {
      if (key === "span" || key.startsWith("_")) continue;
      visit(node[key], here, depth + 1);
    }
  };

  visit(nodes, null, 0);
  if (unscopedDeclaration && targets.size === 1) out.add([...targets][0]);
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

/** The SQLite files a PROGRAM (every file compiled together) owns. */
export function collectProgramOwnedDbFiles(files: readonly unknown[]): Set<string> {
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
