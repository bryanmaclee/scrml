/**
 * bool-coerce.ts — §39/§14 boolean-column SQL-boundary coercion
 * (g-sqlite-bool-column-crosses-the-sql-boundary-as-numeric).
 *
 * A column declared `boolean` in a `<schema>` block stores as INTEGER in SQLite
 * (§39.4), so a `?{ SELECT … }` read returns it as numeric `1`/`0`, not
 * `true`/`false` — and the compiler emitted ZERO coercion, so `@.active is true`
 * evaluated silently false and `${@.active}` rendered `"1"`. Pillar 3 says the
 * compiler owns serialization: when the author writes `boolean` at both ends and
 * receives a number, the abstraction leaked. This coerces the boolean OUTPUT
 * columns of a resolvable SELECT back to JS booleans at the `?{}` decode
 * boundary, keyed on the declared column type the compiler already has.
 *
 * Mirrors the §14.8.9 protect-egress machinery deliberately (same
 * `extractSelectProjection` column resolver, same on-use runtime-helper
 * injection, same set/clear rewriter-context pattern) so the two stay coherent.
 *
 * BOUNDED, and the boundary is the safe direction: a query whose projection
 * cannot be statically resolved (dynamic / CTE / UNION / subquery-in-FROM, an
 * opaque/computed column) is left UNCOERCED — that is exactly today's behaviour,
 * so a non-resolvable query never regresses. Only an exact `0`/`1` is coerced;
 * `null` (a nullable boolean) and any other value pass through untouched.
 */

import { extractSelectProjection } from "../sql-projection.ts";
import { parseSchemaBlock } from "../schema-differ.js";

/** table name -> set of columns on that table DECLARED `boolean` in `<schema>`. */
export type BoolColumns = Map<string, Set<string>>;

/**
 * Resolve which OUTPUT column names of a `?{}` SELECT originate from a
 * boolean-declared source column (alias-resolved, `SELECT *` expanded). Returns
 * `[]` when nothing is coercible OR the projection is not statically resolvable
 * (leave uncoerced — no regression, unlike protect which fails closed).
 */
export function resolveBooleanOutputColumns(
  sqlContent: string,
  boolCols: BoolColumns,
): string[] {
  const proj = extractSelectProjection(sqlContent);
  // Not a resolvable row-producing SELECT (DML/DDL/dynamic/CTE/UNION/subquery) —
  // leave the result exactly as it is today.
  if (!proj.resolvable) return [];

  const out = new Set<string>();
  for (const col of proj.columns) {
    if (col.kind === "column" && col.table && col.column) {
      const bs = boolCols.get(col.table);
      if (bs && bs.has(col.column)) out.add(col.outputName);
    } else if (col.kind === "star") {
      // `SELECT *` expands against every FROM/JOIN table; `t.*` against that one.
      // The output column name of a starred column IS the source column name.
      const tables = col.table ? [col.table] : proj.fromTables;
      for (const t of tables) {
        const bs = boolCols.get(t);
        if (bs) for (const c of bs) out.add(c);
      }
    }
    // kind "opaque" (a computed/expression column) has no resolvable origin —
    // it is left uncoerced.
  }
  return [...out];
}

/**
 * Walk a file AST for `<schema>` blocks and build the table -> boolean-columns
 * map. A column is boolean iff `parseSchemaBlock` preserved its declared
 * `scrmlType === "boolean"` (schema-differ.js:319). Returns an EMPTY map when
 * the file declares no boolean column — the caller treats `size === 0` as
 * "inactive" and emits byte-identical output.
 */
export function buildBoolColumnsFromFileAST(fileAST: any): BoolColumns {
  const map: BoolColumns = new Map();
  const walk = (children: any[]): void => {
    if (!Array.isArray(children)) return;
    for (const node of children) {
      if (!node || typeof node !== "object") continue;
      if (node.kind === "state" && node.stateType === "schema") {
        let body = "";
        for (const c of node.children ?? []) {
          if (c && c.kind === "text" && typeof c.value === "string") body += c.value;
        }
        if (body.trim().length > 0) {
          let parsed: { tables?: Array<{ name?: string; columns?: Array<{ name?: string; scrmlType?: string }> }> } = {};
          try { parsed = parseSchemaBlock(body); } catch { parsed = {}; }
          for (const t of parsed.tables ?? []) {
            if (!t || typeof t.name !== "string" || !Array.isArray(t.columns)) continue;
            const bs = new Set<string>();
            for (const col of t.columns) {
              if (col && col.scrmlType === "boolean" && typeof col.name === "string") bs.add(col.name);
            }
            if (bs.size > 0) map.set(t.name, bs);
          }
        }
      }
      if (Array.isArray(node.children)) walk(node.children);
    }
  };
  // The codegen fileAST carries the node list under `.ast`; a raw parser AST may
  // be an array or expose `.children`/`.nodes`. Accept all shapes.
  const astField = fileAST?.ast;
  const roots = Array.isArray(fileAST)
    ? fileAST
    : Array.isArray(astField)
      ? astField
      : (astField?.children ?? astField?.nodes ?? fileAST?.children ?? fileAST?.nodes ?? []);
  walk(roots);
  return map;
}

/**
 * The server-bundle runtime helper block. Injected into the server module IFF
 * `_scrml_coerce_bool_` is referenced (mirrors SERVER_PROTECT_HELPER's
 * inline-on-use precedent). Server-only — never reaches client.js. Mutates the
 * row(s) in place (matching `_scrml_protect_tag`) and returns them. Only an
 * exact `0`/`1` is coerced, so a `null` nullable boolean is preserved.
 */
export const SERVER_BOOL_COERCE_HELPER: string = [
  "",
  "// --- §39.4 boolean-column decode coercion (SQLite stores boolean as INTEGER) ---",
  "// A `boolean`-declared column crosses the `?{}` SELECT boundary as 1/0; coerce",
  "// the resolved boolean OUTPUT columns back to true/false so `is true` / `${@.x}`",
  "// behave as declared. Only exact 0/1 is coerced (null and other values pass).",
  "function _scrml_coerce_bool_cols(rows, cols) {",
  "  if (Array.isArray(rows)) {",
  "    for (const row of rows) {",
  "      if (row != null && typeof row === \"object\" && !Array.isArray(row)) {",
  "        for (const c of cols) { const v = row[c]; if (v === 0) row[c] = false; else if (v === 1) row[c] = true; }",
  "      }",
  "    }",
  "  }",
  "  return rows;",
  "}",
  "function _scrml_coerce_bool_row(row, cols) {",
  "  if (row != null && typeof row === \"object\" && !Array.isArray(row)) {",
  "    for (const c of cols) { const v = row[c]; if (v === 0) row[c] = false; else if (v === 1) row[c] = true; }",
  "  }",
  "  return row;",
  "}",
].join("\n");
