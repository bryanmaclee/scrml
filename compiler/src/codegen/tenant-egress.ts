/**
 * §14.8.10 — Server→client confidentiality: tenant-row isolation floor.
 *
 * The ROW-LEVEL twin of §14.8.9 (protect-egress.ts). §14.8.9 strips protected
 * COLUMNS at the compiler-owned client-egress sinks; this floor isolates tenant
 * ROWS at the SAME sinks — one predicate deeper. It owns exactly the isolation
 * invariant: *a row belonging to tenant A never reaches a request whose ambient
 * tenant is B*. Policy (which tenant a user may act as) stays app-owned.
 *
 * Mechanism ("tag at query-lowering, redact at the egress sink", mirroring
 * protect):
 *
 *   1. A `<schema>` table carrying a `tenant_id` column IS tenant-scoped (the
 *      column's PRESENCE is the declaration — no per-table opt-in attribute).
 *      `tenantScopedTables` is built from the same schema registry §14.8.9 uses.
 *
 *   2. At `?{ SELECT ... }` lowering, if the read's FROM tables intersect the
 *      tenant-scoped set, its result rows are tagged with a Symbol-keyed
 *      descriptor (`Symbol.for("scrml.tenant.origin")`) recording the row's
 *      `tenant_id` output column + whether the floor ADDED that column to the
 *      projection (a deterministic projection-column add — NOT a WHERE-parse; the
 *      SQL-WHERE injection is v1.next). `SELECT *` already carries `tenant_id`, so
 *      no add is needed.
 *
 *   3. At the single compiler-owned egress sink, `_scrml_tenant_redact(value,
 *      tenantKey)` drops every row whose `tenant_id` !== the ambient
 *      `@currentUser.tenantId`, and strips the floor-added `tenant_id` column from
 *      the survivors. `tenantKey == null` (an unpinned / anonymous request) →
 *      ZERO rows (fail-closed by construction, the §52.15.3 shape). It composes
 *      with the §14.8.9 protect redact (both descriptors coexist on a row).
 *
 * Enforcement is HYBRID (§14.8.10): redaction guarantees reads; the classes
 * redaction cannot cover fail closed at compile — an aggregate-without-discriminator
 * (`E-TENANT-AGG`), a write (`E-TENANT-WRITE`), or a raw/unanalyzable egress
 * (`E-TENANT-RAW-EGRESS`). `.acrossTenants()` is the sole loud opt-out (fires
 * `I-TENANT-ACROSS`); `I-TENANT-STRIP` names every row-strip (never silent).
 *
 * V1-minimal scope (the freeze): the redact floor + the hard-fails. NO
 * SQL-WHERE-parser (predicate injection is v1.next — the `OR`-precedence hazard).
 */

import { extractSelectProjection } from "../sql-projection.ts";
import type { ProtectContext } from "./protect-egress.ts";

/** The canonical tenant-discriminator column (§14.8.10 declaration convention). */
export const TENANT_COLUMN = "tenant_id";

/**
 * Compile-time tenant context: which tables are tenant-scoped (carry a
 * `tenant_id` column). Built from the §14.8.9 schema registry so a non-tenant
 * app (no table carries `tenant_id`) yields an EMPTY set — the caller treats
 * `tenantScopedTables.size === 0` as "tenant inactive" and emits byte-identical
 * output (zero overhead, verified).
 */
export interface TenantContext {
  tenantScopedTables: Set<string>;
}

/**
 * Build the TenantContext from the §14.8.9 ProtectContext's `schemaByTable`
 * registry (populated for EVERY `<db>`-bound table, regardless of `protect=`).
 * A table is tenant-scoped iff its column list includes `tenant_id`.
 */
export function buildTenantContext(protectCtx: ProtectContext): TenantContext {
  const tenantScopedTables = new Set<string>();
  for (const [table, cols] of protectCtx.schemaByTable) {
    if (cols.some((c) => c.toLowerCase() === TENANT_COLUMN)) tenantScopedTables.add(table);
  }
  return { tenantScopedTables };
}

/**
 * The result of resolving a `?{}` read's tenant scoping:
 *   - `null`                — no floor (not row-producing, or FROM tables carry no
 *                             tenant-scoped table). No tag is emitted.
 *   - `{ kind: "read" }`    — a resolvable SELECT over a tenant-scoped table; tag +
 *                             redact. `floorAdd` true → the projection lacks
 *                             `tenant_id` and the floor must ADD it (and strip it
 *                             from the output). `tenantCol` is the OUTPUT column
 *                             name the redact keys on.
 *   - `{ kind: "agg" }`     — an aggregate/scalar over a tenant-scoped table with
 *                             NO output tenant discriminator (`GROUP BY tenant_id`)
 *                             → redaction has no row to key on → `E-TENANT-AGG`.
 *   - `{ kind: "strip" }`   — an unresolvable dynamic read that mentions a
 *                             tenant-scoped table name → wholesale strip-all rows
 *                             at the sink (fail-closed, `I-TENANT-STRIP`).
 */
export type TenantScoping =
  | { kind: "read"; floorAdd: boolean; tenantCol: string; table: string }
  | { kind: "agg"; table: string }
  | { kind: "strip" }
  | null;

/**
 * Strip leading SQL comments + whitespace so the leader test sees the first real
 * keyword. (Same shape as protect-egress.ts's `stripLeadingSqlNoise`.)
 */
function stripLeadingSqlNoise(sql: string): string {
  let prev: string;
  let s = sql;
  do {
    prev = s;
    s = s.trimStart();
    if (s.startsWith("/*")) {
      const end = s.indexOf("*/");
      s = end === -1 ? "" : s.slice(end + 2);
    } else if (s.startsWith("--")) {
      const nl = s.indexOf("\n");
      s = nl === -1 ? "" : s.slice(nl + 1);
    }
  } while (s !== prev);
  return s;
}

/** The leading keyword (SELECT / WITH / INSERT / UPDATE / DELETE / ...), uppercased. */
function sqlLeader(sqlContent: string): string {
  const normalized = stripLeadingSqlNoise(sqlContent.replace(/\$\{[^}]*\}/g, " "));
  const m = /^([A-Za-z]+)/.exec(normalized);
  return m ? m[1].toUpperCase() : "";
}

/** Is this a row-producing read (a leading SELECT or a WITH/CTE)? */
function isRowProducingQuery(sqlContent: string): boolean {
  const leader = sqlLeader(sqlContent);
  return leader === "SELECT" || leader === "WITH";
}

/**
 * Does the SQL text mention any tenant-scoped table name as a whole word? Used
 * for the unresolvable-read fail-closed heuristic (strip-all only when a
 * tenant-scoped table is plausibly involved, so a non-tenant CTE is untouched).
 */
function mentionsTenantTable(sqlContent: string, ctx: TenantContext): boolean {
  for (const t of ctx.tenantScopedTables) {
    if (new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(sqlContent)) return true;
  }
  return false;
}

const AGGREGATE_FN = /\b(count|sum|avg|min|max|total|group_concat)\s*\(/i;

/**
 * Resolve the tenant scoping a `?{}` READ carries. Reads only — writes are
 * classified separately by `classifyTenantWrite`.
 */
export function resolveTenantScoping(sqlContent: string, ctx: TenantContext): TenantScoping {
  if (ctx.tenantScopedTables.size === 0) return null;
  if (!isRowProducingQuery(sqlContent)) return null;

  const proj = extractSelectProjection(sqlContent);
  if (!proj.resolvable) {
    // Unresolvable dynamic read (CTE / UNION / subquery-in-FROM). Fail-closed:
    // strip-all rows IFF a tenant-scoped table name appears (never accept-unknown),
    // else no floor (it is over non-tenant tables — do not nuke a non-tenant CTE).
    return mentionsTenantTable(sqlContent, ctx) ? { kind: "strip" } : null;
  }

  // Which FROM tables are tenant-scoped?
  const scopedFrom = proj.fromTables.filter((t) => ctx.tenantScopedTables.has(t));
  if (scopedFrom.length === 0) return null;
  const table = scopedFrom[0];

  // Aggregate/scalar over a tenant-scoped table: redaction can only key on a
  // per-tenant output row. WITH `GROUP BY tenant_id` the aggregate yields a
  // tenant-discriminated row (redactable, kind "read"); WITHOUT one it folds
  // every tenant into one scalar → E-TENANT-AGG.
  if (AGGREGATE_FN.test(sqlContent)) {
    const hasGroupByTenant = /\bGROUP\s+BY\b[^;]*\btenant_id\b/i.test(sqlContent.replace(/\$\{[^}]*\}/g, " "));
    if (!hasGroupByTenant) return { kind: "agg", table };
    // GROUP BY tenant_id present — the output carries tenant_id; treat as a read
    // whose discriminator is projected (or add it if the projection omitted it).
  }

  // Is `tenant_id` already an OUTPUT column (so the row can be keyed without a
  // projection add)? A `star` includes it (source column name == output name);
  // an explicit `(table, tenant_id)` column projects it under its outputName.
  let tenantOutputName: string | null = null;
  for (const col of proj.columns) {
    if (col.kind === "star") {
      const starTables = col.table ? [col.table] : proj.fromTables;
      if (starTables.includes(table)) { tenantOutputName = TENANT_COLUMN; break; }
    } else if (col.kind === "column" && col.table === table && col.column === TENANT_COLUMN) {
      tenantOutputName = col.outputName;
      break;
    }
  }

  if (tenantOutputName !== null) {
    return { kind: "read", floorAdd: false, tenantCol: tenantOutputName, table };
  }
  return { kind: "read", floorAdd: true, tenantCol: TENANT_COLUMN, table };
}

/**
 * Rewrite a resolvable SELECT to ADD the tenant-scoped table's `tenant_id` to
 * the projection (a deterministic projection-column add, NOT a WHERE-parse). The
 * column is appended just before the first top-level `FROM`. In a multi-table
 * FROM it is qualified with the tenant-scoped table's alias to stay unambiguous.
 * Returns the original SQL unchanged when the add is not applicable.
 */
export function rewriteSelectAddTenantId(sqlContent: string, scoping: TenantScoping): string {
  if (!scoping || scoping.kind !== "read" || !scoping.floorAdd) return sqlContent;

  const proj = extractSelectProjection(sqlContent);
  if (!proj.resolvable) return sqlContent;

  // Qualify with the tenant-scoped table's alias when the FROM has >1 table, so
  // a JOIN does not make `tenant_id` ambiguous. Find an alias that maps to the
  // tenant table (prefer a non-identity alias so `assets a` → `a.tenant_id`).
  let qualifier = "";
  if (proj.fromTables.length > 1) {
    let alias = scoping.table;
    for (const [a, t] of proj.aliasMap) {
      if (t === scoping.table) { alias = a; if (a !== t) break; }
    }
    qualifier = `${alias}.`;
  }

  // Locate the first top-level FROM in the ORIGINAL (un-normalized) text so we
  // insert the column before it, preserving `${...}` params + spacing verbatim.
  const fromIdx = findTopLevelFromInSource(sqlContent);
  if (fromIdx === -1) return sqlContent;
  const before = sqlContent.slice(0, fromIdx);
  const after = sqlContent.slice(fromIdx);
  return `${before.replace(/\s*$/, "")}, ${qualifier}${TENANT_COLUMN} ${after}`;
}

/**
 * Find the byte index of the projection-terminating top-level `FROM` in the
 * ORIGINAL source text (parenthesis-depth aware, word-boundary aware, skipping
 * `${...}` interpolations). Returns -1 when none.
 */
function findTopLevelFromInSource(src: string): number {
  let depth = 0;
  let i = 0;
  const upper = src.toUpperCase();
  while (i < src.length) {
    // Skip `${...}` interpolations wholesale.
    if (src[i] === "$" && src[i + 1] === "{") {
      let d = 1; let j = i + 2;
      while (j < src.length && d > 0) { if (src[j] === "{") d++; else if (src[j] === "}") d--; j++; }
      i = j;
      continue;
    }
    const ch = src[i];
    if (ch === "(") { depth++; i++; continue; }
    if (ch === ")") { depth = Math.max(0, depth - 1); i++; continue; }
    if (depth === 0 && upper[i] === "F" && upper.startsWith("FROM", i)) {
      const before = i === 0 ? " " : src[i - 1];
      const after = i + 4 >= src.length ? " " : src[i + 4];
      if (!/[A-Za-z0-9_]/.test(before) && !/[A-Za-z0-9_]/.test(after)) return i;
    }
    i++;
  }
  return -1;
}

/**
 * The result of classifying a `?{}` WRITE against a tenant-scoped table:
 *   - `null`                     — not a write, or not against a tenant-scoped table.
 *   - `{ kind: "insert-inject" }`— an INSERT the floor can safely tenant-inject.
 *   - `{ kind: "hard-fail" }`    — an UPDATE/DELETE, or an un-injectable INSERT →
 *                                  `E-TENANT-WRITE` (unless `.acrossTenants()`).
 */
export type TenantWrite =
  | { kind: "insert-inject"; table: string }
  | { kind: "hard-fail"; table: string; op: string }
  | null;

/**
 * Classify a `?{}` write. UPDATE/DELETE always hard-fail (no WHERE-parser → the
 * floor cannot constrain them; a committed cross-tenant write is durable before
 * any redaction). An INSERT into a tenant-scoped table whose column list OMITS
 * `tenant_id` and is the parseable single-row `INSERT INTO t (cols) VALUES (...)`
 * shape is injectable; anything else hard-fails (tightest fail-closed reading of
 * "inject-or-hard-fail" — inject only where provably safe).
 */
export function classifyTenantWrite(sqlContent: string, ctx: TenantContext): TenantWrite {
  if (ctx.tenantScopedTables.size === 0) return null;
  const leader = sqlLeader(sqlContent);
  const norm = sqlContent.replace(/\$\{[^}]*\}/g, " ");

  if (leader === "UPDATE") {
    const m = /^\s*UPDATE\s+([A-Za-z_][A-Za-z0-9_]*)/i.exec(norm);
    const table = m?.[1];
    if (table && ctx.tenantScopedTables.has(table)) return { kind: "hard-fail", table, op: "UPDATE" };
    return null;
  }
  if (leader === "DELETE") {
    const m = /^\s*DELETE\s+FROM\s+([A-Za-z_][A-Za-z0-9_]*)/i.exec(norm);
    const table = m?.[1];
    if (table && ctx.tenantScopedTables.has(table)) return { kind: "hard-fail", table, op: "DELETE" };
    return null;
  }
  if (leader === "INSERT" || leader === "REPLACE") {
    const m = /^\s*(?:INSERT|REPLACE)(?:\s+OR\s+\w+)?\s+INTO\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*VALUES\s*\(/i.exec(norm);
    const table = m?.[1];
    if (!table) {
      // Could not parse the INSERT shape (INSERT ... SELECT, no column list, …).
      const t2 = /^\s*(?:INSERT|REPLACE)(?:\s+OR\s+\w+)?\s+INTO\s+([A-Za-z_][A-Za-z0-9_]*)/i.exec(norm)?.[1];
      if (t2 && ctx.tenantScopedTables.has(t2)) return { kind: "hard-fail", table: t2, op: leader };
      return null;
    }
    if (!ctx.tenantScopedTables.has(table)) return null;
    const cols = m[2].split(",").map((c) => c.trim().toLowerCase());
    // Multi-row VALUES (a `),(` after the first tuple) is not safely injectable.
    if (/\)\s*,\s*\(/.test(norm.slice(m.index))) return { kind: "hard-fail", table, op: leader };
    if (cols.includes(TENANT_COLUMN)) {
      // App explicitly chose a tenant the floor cannot verify → fail closed.
      return { kind: "hard-fail", table, op: leader };
    }
    return { kind: "insert-inject", table };
  }
  return null;
}

/**
 * Rewrite an injectable INSERT to add `tenant_id` to its column-set with the
 * ambient tenant value bound as a param expression `${<ambientExpr>}`. The
 * caller supplies the ambient-tenant JS expression (e.g.
 * `_scrml_current_user(_scrml_req).tenantId`). Only touches the single-row
 * `INSERT INTO t (cols) VALUES (vals)` shape validated by `classifyTenantWrite`.
 */
export function rewriteInsertAddTenantId(sqlContent: string, ambientExpr: string): string {
  return sqlContent.replace(
    /(\b(?:INSERT|REPLACE)(?:\s+OR\s+\w+)?\s+INTO\s+[A-Za-z_][A-Za-z0-9_]*\s*\()([^)]*)(\)\s*VALUES\s*\()([^)]*)(\))/i,
    (_full, head: string, cols: string, mid: string, vals: string, tail: string) =>
      `${head}${cols.replace(/\s*$/, "")}, ${TENANT_COLUMN}${mid}${vals.replace(/\s*$/, "")}, \${${ambientExpr}}${tail}`,
  );
}

/**
 * §14.8.10 fail-closed gate (E-TENANT-RAW-EGRESS) — detect a tenant-scoped `?{}`
 * read reaching a RAW / compiler-UNANALYZABLE egress within a single server-fn
 * body (mirror of §14.8.9's `detectProtectedRawEgress`). Suppressed by a
 * `.acrossTenants()` anywhere in the body.
 */
export function detectTenantRawEgress(
  fnSource: string,
  ctx: TenantContext,
): { query: string; egressKind: string } | null {
  if (!fnSource || ctx.tenantScopedTables.size === 0) return null;
  let scopedQuery: string | null = null;
  const sqlRe = /\?\{`([^`]*)`\}/g;
  let m: RegExpExecArray | null;
  while ((m = sqlRe.exec(fnSource)) !== null) {
    const sc = resolveTenantScoping(m[1], ctx);
    if (sc !== null) { scopedQuery = m[1].trim().replace(/\s+/g, " ").slice(0, 60); break; }
  }
  if (!scopedQuery) return null;
  if (/\.\s*acrossTenants\s*\(/.test(fnSource)) return null;
  let egressKind: string | null = null;
  if (/(^|[^A-Za-z0-9_$])_\{/.test(fnSource)) {
    egressKind = "a `_{}` foreign-code block (§23)";
  } else if (/\bnew\s+Response\b/.test(fnSource) || /\bResponse\s*\.\s*json\b/.test(fnSource)) {
    egressKind = "a manual `Response` / `handle()` body (§40)";
  } else if (/\basIs\b/.test(fnSource)) {
    egressKind = "an `asIs`-typed value (§14.1.1)";
  }
  if (!egressKind) return null;
  return { query: scopedQuery, egressKind };
}

/**
 * The server-bundle runtime helper block (§14.8.10). Injected into the server
 * module IFF `_scrml_tenant_tag` / `_scrml_tenant_redact` is referenced (mirrors
 * the §14.8.9 helper's inline-on-use precedent). Server-only — never client.js.
 *
 * `_scrml_active_tenant(req)` resolves the ambient tenant from the §20.5
 * `_scrml_current_user` resolver (always emitted for a tenant app — it uses
 * `session.set("tenantId", …)`). A row's `tenant_id` != that scalar is dropped;
 * a null scalar (unpinned) drops EVERY row (fail-closed).
 */
export const SERVER_TENANT_HELPER: string = [
  "",
  "// --- §14.8.10 Tenant-row isolation floor (server-only confidentiality floor) ---",
  "// A Symbol-keyed descriptor records, per result row, the tenant discriminator",
  "// column + whether the floor ADDED it to the projection. The egress sink drops",
  "// every row whose tenant_id != the ambient @currentUser.tenantId; an unpinned",
  "// request (null tenant) sees ZERO rows (fail-closed). Composes with §14.8.9.",
  "const _SCRML_TENANT = Symbol.for(\"scrml.tenant.origin\");",
  "function _scrml_active_tenant(req) {",
  "  const _cu = (typeof _scrml_current_user === \"function\") ? _scrml_current_user(req) : null;",
  "  return _cu ? (_cu.tenantId ?? null) : null;",
  "}",
  "function _scrml_tenant_tag(value, tenantCol, floorAdded) {",
  "  if (value == null || typeof value !== \"object\") return value;",
  "  if (Array.isArray(value)) {",
  "    for (const row of value) {",
  "      if (row != null && typeof row === \"object\" && !Array.isArray(row)) row[_SCRML_TENANT] = { tenantCol, floorAdded };",
  "    }",
  "    return value;",
  "  }",
  "  value[_SCRML_TENANT] = { tenantCol, floorAdded };",
  "  return value;",
  "}",
  "function _scrml_tenant_tag_all(value) {",
  "  if (value == null || typeof value !== \"object\") return value;",
  "  if (Array.isArray(value)) {",
  "    for (const row of value) {",
  "      if (row != null && typeof row === \"object\" && !Array.isArray(row)) row[_SCRML_TENANT] = { stripAll: true };",
  "    }",
  "    return value;",
  "  }",
  "  value[_SCRML_TENANT] = { stripAll: true };",
  "  return value;",
  "}",
  "function _scrml_tenant_strip_col(row, d) {",
  "  if (!d.floorAdded) return row;",
  "  const out = {};",
  "  for (const k of Object.keys(row)) { if (k === d.tenantCol) continue; out[k] = row[k]; }",
  "  // Preserve the §14.8.9 protect descriptor so a composed protect-redact still fires.",
  "  const _p = Symbol.for(\"scrml.protect.origin\");",
  "  const _pd = row[_p];",
  "  if (_pd != null) out[_p] = _pd;",
  "  return out;",
  "}",
  "function _scrml_tenant_redact(value, tenantKey) {",
  "  if (value == null || typeof value !== \"object\") return value;",
  "  if (typeof Response !== \"undefined\" && value instanceof Response) return value;",
  "  if (Array.isArray(value)) {",
  "    const out = [];",
  "    for (const el of value) {",
  "      const d = (el != null && typeof el === \"object\") ? el[_SCRML_TENANT] : null;",
  "      if (d) {",
  "        if (d.stripAll) continue;",
  "        if (tenantKey == null) continue;",
  "        if (String(el[d.tenantCol]) !== String(tenantKey)) continue;",
  "        out.push(_scrml_tenant_strip_col(el, d));",
  "      } else {",
  "        out.push(_scrml_tenant_redact(el, tenantKey));",
  "      }",
  "    }",
  "    return out;",
  "  }",
  "  const d = value[_SCRML_TENANT];",
  "  if (d) {",
  "    if (d.stripAll) return null;",
  "    if (tenantKey == null) return null;",
  "    if (String(value[d.tenantCol]) !== String(tenantKey)) return null;",
  "    return _scrml_tenant_strip_col(value, d);",
  "  }",
  "  const out = {};",
  "  for (const k of Object.keys(value)) out[k] = _scrml_tenant_redact(value[k], tenantKey);",
  "  return out;",
  "}",
  "",
].join("\n");

/**
 * Build the `_scrml_tenant_tag(<inner>, "<col>", <floorAdded>)` wrap (or the
 * strip-all wrap) for a lowered SQL result expression `inner`.
 */
export function wrapWithTenantTag(inner: string, scoping: TenantScoping): string {
  if (!scoping) return inner;
  if (scoping.kind === "strip") return `_scrml_tenant_tag_all(${inner})`;
  if (scoping.kind === "read") {
    return `_scrml_tenant_tag(${inner}, ${JSON.stringify(scoping.tenantCol)}, ${scoping.floorAdd})`;
  }
  return inner; // "agg" carries no tag — it hard-fails at compile.
}
