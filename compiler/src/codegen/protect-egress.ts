/**
 * §14.8.9 — Server→client confidentiality: protected-column egress redaction.
 *
 * This module owns the FLOOR (the load-bearing structural redaction) for
 * `protect=` columns: a column whose resolved source `(table, column)` origin
 * is a protected field SHALL NOT cross the wire to the client unless it is
 * explicitly declassified with `reveal("col")`.
 *
 * The mechanism is "tag at query-lowering, read at the egress sink":
 *
 *   1. At `?{ SELECT ... }` lowering, the resolved per-output-column origins
 *      (reusing the §14.8.7 FROM/JOIN alias map via `extractSelectProjection`)
 *      are turned into the set of OUTPUT column names whose origin is protected.
 *      Each result row is wrapped with `_scrml_protect_tag(rows, cols)`, which
 *      attaches a Symbol-keyed descriptor (`Symbol.for("scrml.protect.origin")`).
 *
 *   2. The descriptor PROPAGATES through every compiler-emitted construction
 *      step for free, because it is an enumerable Symbol-keyed own property:
 *      `{...row}` spread copies it, `.map(r => ({...r}))` preserves it, a helper
 *      `return row` carries it, JOIN rows carry per-output-column origins. A
 *      `JSON.stringify` of the value IGNORES Symbol keys, so the descriptor is
 *      never itself serialized (it is metadata, not data).
 *
 *   3. At the single compiler-owned egress sink (server-fn response serializer
 *      + SSR `/__serverLoad`), `_scrml_protect_redact(value)` walks the value,
 *      reads the descriptor, and drops every protected-origin column that is not
 *      `reveal`-stamped. Redaction is sound BY CONSTRUCTION — the compiler reads
 *      a tag at egress; it never proves a return clean (no value-flow obligation).
 *
 * Soundness bound (§14.8.9 normative — DO NOT over-claim): complete for
 * explicit-column flows of statically-resolvable SQL, by ORIGIN. NOT covered:
 * derived/implicit flows (`{ hasPw: row.pw != "" }` — a value of independent
 * identity carries no descriptor), covert channels, and member-extraction into
 * a re-keyed fresh literal (`{ secret: row.pw }` — same derived-flow boundary).
 * Unresolvable dynamic SQL is stripped WHOLESALE (fail-closed), never
 * accept-unknown. Raw / foreign egress (`_{}`, manual `Response`, `asIs`) the
 * compiler cannot redact fails closed with `E-PROTECT-004`.
 */

import { extractSelectProjection } from "../sql-projection.ts";

/**
 * Compile-time protect context: which `(table, column)` origins are protected,
 * plus each protected table's full column list (for `SELECT *` expansion).
 * Built from the PA stage's ProtectAnalysis (`buildProtectContext`).
 */
export interface ProtectContext {
  /** table name -> set of protected column names on that table. */
  protectedByTable: Map<string, Set<string>>;
  /** table name -> all column names on that table (for `SELECT *` expansion). */
  schemaByTable: Map<string, string[]>;
}

/**
 * Build the codegen-side ProtectContext from the PA stage's ProtectAnalysis.
 * Duck-typed against the loose `{ views?: Map<...> }` shape threaded through
 * runCG so this composes with both the unit-test FileAST input and the live
 * pipeline TABResult input.
 *
 * Returns a context with EMPTY maps when the app declares no `protect=` fields —
 * the caller treats `protectedByTable.size === 0` as "protect inactive" and
 * emits byte-identical output (zero overhead for non-protect apps).
 */
export function buildProtectContext(protectAnalysis: unknown): ProtectContext {
  const protectedByTable = new Map<string, Set<string>>();
  const schemaByTable = new Map<string, string[]>();
  const views = (protectAnalysis as { views?: Map<string, unknown> } | null | undefined)?.views;
  if (!views || typeof (views as Map<string, unknown>).forEach !== "function") {
    return { protectedByTable, schemaByTable };
  }
  for (const [, dbViews] of views as Map<string, { tables?: Map<string, unknown> }>) {
    const tables = dbViews?.tables;
    if (!tables || typeof (tables as Map<string, unknown>).forEach !== "function") continue;
    for (const [tableName, view] of tables as Map<string, {
      protectedFields?: Set<string>;
      fullSchema?: Array<{ name?: string }>;
    }>) {
      if (view?.protectedFields && view.protectedFields.size > 0) {
        const existing = protectedByTable.get(tableName) ?? new Set<string>();
        for (const f of view.protectedFields) existing.add(f);
        protectedByTable.set(tableName, existing);
      }
      if (Array.isArray(view?.fullSchema)) {
        const cols = view.fullSchema.map((c) => c?.name).filter((n): n is string => typeof n === "string");
        if (cols.length > 0) schemaByTable.set(tableName, cols);
      }
    }
  }
  return { protectedByTable, schemaByTable };
}

/**
 * The result of resolving a `?{}` SELECT's protected-origin output columns:
 *   - `{ cols }`  — explicit protected OUTPUT column names (alias-resolved).
 *   - `{ all: true }` — a SELECT whose origins cannot be statically resolved
 *                       (dynamic/CTE/UNION/subquery); the row is stripped
 *                       WHOLESALE at egress (fail-closed, OQ-3).
 *   - `null`      — no protected egress (no protected column selected, or the
 *                   query is not a row-producing SELECT). No tag is emitted.
 */
export type ProtectedColumns = { cols: string[] } | { all: true } | null;

/** Strip `${...}` bound-param interpolations + leading whitespace for the leader test. */
function isSelectQuery(sqlContent: string): boolean {
  const normalized = sqlContent.replace(/\$\{[^}]*\}/g, " ").trimStart();
  return /^select\b/i.test(normalized);
}

/**
 * Resolve the protected OUTPUT column names a `?{}` SELECT carries, keyed on the
 * column's resolved `(table, column)` ORIGIN (never its surface name — so
 * `SELECT passwordHash AS h` redacts identically to `SELECT passwordHash`).
 *
 * Reuses `extractSelectProjection` (the §14.8.7 alias-origin map). A `SELECT *`
 * / `table.*` star is expanded against the protected table's column set.
 */
export function resolveProtectedOutputColumns(
  sqlContent: string,
  ctx: ProtectContext,
): ProtectedColumns {
  // Only a row-producing SELECT can carry a client-facing protected column.
  // A non-SELECT (INSERT/UPDATE/DELETE/DDL) produces no typed row in the v1 SQL
  // surface; `RETURNING` is part of the deferred long tail (documented).
  if (!isSelectQuery(sqlContent)) return null;

  const proj = extractSelectProjection(sqlContent);
  // Unresolvable SELECT (dynamic / CTE / UNION / subquery-in-FROM) — fail-closed:
  // strip every column wholesale at egress (OQ-3), never accept-unknown.
  if (!proj.resolvable) return { all: true };

  const out = new Set<string>();
  for (const col of proj.columns) {
    if (col.kind === "column" && col.table && col.column) {
      const prot = ctx.protectedByTable.get(col.table);
      if (prot && prot.has(col.column)) out.add(col.outputName);
    } else if (col.kind === "star") {
      // `SELECT *` (no table) expands against every FROM/JOIN table; `table.*`
      // expands against that one table. The output column name of a starred
      // column IS the source column name, so a protected source column appears
      // under its own name in the result row (alias-safe by construction).
      const tables = col.table ? [col.table] : proj.fromTables;
      for (const t of tables) {
        const prot = ctx.protectedByTable.get(t);
        if (prot) for (const c of prot) out.add(c);
      }
    }
    // kind "opaque" (computed/expression column) carries no resolvable origin —
    // it is a derived flow (§14.8.9 out-of-scope), not a protected-origin column.
  }
  if (out.size === 0) return null;
  return { cols: [...out] };
}

/**
 * The server-bundle runtime helper block (§14.8.9). Injected into the server
 * module IFF one of `_scrml_protect_tag` / `_scrml_protect_redact` /
 * `_scrml_protect_reveal` is referenced (mirrors the `_scrml_wire_encode`
 * inline-on-use precedent). Server-only — never reaches client.js.
 */
export const SERVER_PROTECT_HELPER: string = [
  "",
  "// --- §14.8.9 Protected-column egress redaction (server-only confidentiality floor) ---",
  "// A Symbol-keyed descriptor records, per result row, which OUTPUT columns",
  "// originate from a `protect=` field. It is enumerable (so `{...row}` spread /",
  "// `.map` carry it) but Symbol-keyed (so JSON.stringify ignores it). The egress",
  "// sink reads it and drops protected columns unless `reveal`-stamped.",
  "const _SCRML_PROTECT = Symbol.for(\"scrml.protect.origin\");",
  "function _scrml_protect_tag(value, cols) {",
  "  if (value == null || typeof value !== \"object\") return value;",
  "  if (Array.isArray(value)) {",
  "    for (const row of value) {",
  "      if (row != null && typeof row === \"object\" && !Array.isArray(row)) row[_SCRML_PROTECT] = { cols, revealed: [] };",
  "    }",
  "    return value;",
  "  }",
  "  value[_SCRML_PROTECT] = { cols, revealed: [] };",
  "  return value;",
  "}",
  "function _scrml_protect_reveal(value, col) {",
  "  if (value == null || typeof value !== \"object\") return value;",
  "  if (Array.isArray(value)) return value.map((r) => _scrml_protect_reveal(r, col));",
  "  const d = value[_SCRML_PROTECT];",
  "  if (!d) return value;",
  "  const next = { ...value };",
  "  next[_SCRML_PROTECT] = { cols: d.cols, revealed: [...d.revealed, col] };",
  "  return next;",
  "}",
  "function _scrml_protect_redact(value) {",
  "  if (value == null || typeof value !== \"object\") return value;",
  "  if (typeof Response !== \"undefined\" && value instanceof Response) return value;",
  "  if (Array.isArray(value)) return value.map(_scrml_protect_redact);",
  "  const d = value[_SCRML_PROTECT];",
  "  const stripAll = d && d.cols === \"*\";",
  "  const protectedCols = d && Array.isArray(d.cols) ? d.cols : null;",
  "  const revealed = d ? d.revealed : null;",
  "  const out = {};",
  "  for (const k of Object.keys(value)) {",
  "    const isRevealed = revealed && revealed.indexOf(k) !== -1;",
  "    if (!isRevealed && (stripAll || (protectedCols && protectedCols.indexOf(k) !== -1))) continue;",
  "    out[k] = _scrml_protect_redact(value[k]);",
  "  }",
  "  return out;",
  "}",
  "",
].join("\n");

/**
 * Build the `_scrml_protect_tag(<inner>, <cols>)` wrap for a lowered SQL result
 * expression `inner`. `cols` is serialized as a JS array literal of output
 * column names, or the `"*"` strip-all sentinel.
 */
export function wrapWithProtectTag(inner: string, resolved: ProtectedColumns): string {
  if (resolved === null) return inner;
  const colsArg = "all" in resolved ? '"*"' : JSON.stringify(resolved.cols);
  return `_scrml_protect_tag(${inner}, ${colsArg})`;
}

/**
 * §14.8.9 fail-closed gate (E-PROTECT-004) — detect a protected-origin value
 * reaching a RAW / compiler-UNANALYZABLE egress within a single server-function
 * body, where the structural redaction floor cannot guarantee the strip:
 *   - a `_{}` foreign-code block (§23) — opaque interior;
 *   - a manual `Response` / `handle()` body (§40) — the floor's redact passes a
 *     `Response` instance through untouched (it cannot introspect a serialized
 *     body), so a row manually serialized there would LEAK;
 *   - an `asIs`-typed value (§14.1.1) — escapes the type system.
 *
 * Returns the offending query + egress kind (→ E-PROTECT-004), or null. The
 * closed-world precondition of §14.8.9 rests on every egress being compiler-
 * emitted and descriptor-preserving; this gate enforces it fail-closed. It scans
 * the fn's SOURCE slice (a manual `Response` / `_{}` / `asIs` is AUTHORED, never
 * compiler-emitted, so a source scan distinguishes it from the codegen's own
 * `new Response(...)` serializer). Conservative: co-occurrence of a protected
 * query and a raw egress in the same body fires (the floor never silently ships
 * a protected column through a path it cannot redact). A `reveal(...)` anywhere
 * in the body SUPPRESSES the gate — the author explicitly declassified (§14.8.9
 * "declassify explicitly with `reveal` or project the column out").
 */
export function detectProtectedRawEgress(
  fnSource: string,
  ctx: ProtectContext,
): { query: string; egressKind: string } | null {
  if (!fnSource) return null;
  // Is a protected-origin `?{}` SELECT present in this body?
  let protectedQuery: string | null = null;
  const sqlRe = /\?\{`([^`]*)`\}/g;
  let m: RegExpExecArray | null;
  while ((m = sqlRe.exec(fnSource)) !== null) {
    if (resolveProtectedOutputColumns(m[1], ctx) !== null) {
      protectedQuery = m[1].trim().replace(/\s+/g, " ").slice(0, 60);
      break;
    }
  }
  if (!protectedQuery) return null;
  // Explicit declassification anywhere in the body suppresses the gate.
  if (/\.\s*reveal\s*\(/.test(fnSource)) return null;
  // Is there a raw / unredactable egress in the same body?
  let egressKind: string | null = null;
  if (/(^|[^A-Za-z0-9_$])_\{/.test(fnSource)) {
    egressKind = "a `_{}` foreign-code block (§23)";
  } else if (/\bnew\s+Response\b/.test(fnSource) || /\bResponse\s*\.\s*json\b/.test(fnSource)) {
    egressKind = "a manual `Response` / `handle()` body (§40)";
  } else if (/\basIs\b/.test(fnSource)) {
    egressKind = "an `asIs`-typed value (§14.1.1)";
  }
  if (!egressKind) return null;
  return { query: protectedQuery, egressKind };
}
