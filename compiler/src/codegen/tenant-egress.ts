/**
 * §14.8.10 — Server→client confidentiality: tenant-row isolation floor.
 *
 * The ROW-LEVEL twin of §14.8.9 (protect-egress.ts). §14.8.9 strips protected
 * COLUMNS at the compiler-owned client-egress sinks; this floor isolates tenant
 * ROWS at the SAME sinks — one predicate deeper. It owns exactly the isolation
 * invariant: *a row belonging to tenant A never reaches a request whose ambient
 * tenant is B*. Policy (which tenant a user may act as) stays app-owned.
 *
 * Mechanism ("filter at the SOURCE", S452 ruling "a"; the egress strip stays as
 * defense in depth):
 *
 *   1. A `<schema>` table carrying a `tenant_id` column IS tenant-scoped (the
 *      column's PRESENCE is the declaration — no per-table opt-in attribute).
 *      `tenantScopedTables` is built from the same schema registry §14.8.9 uses.
 *
 *   2. At `?{ SELECT ... }` lowering, if the read's FROM/JOIN sources include a
 *      tenant-scoped table, the projection is made to carry ONE key column per
 *      tenant-scoped source (a deterministic projection-column add — NOT a
 *      WHERE-parse; the SQL-WHERE injection is v1.next), and the driver's result
 *      is wrapped in `_scrml_tenant_scope(rows, keyCols, addedCols)`.
 *
 *   3. `_scrml_tenant_scope` runs IMMEDIATELY after the query, before any program
 *      code holds a row. It keeps a row iff EVERY key column equals the request's
 *      active tenant (NULL never matches), removes the key columns the floor
 *      added, and marks each survivor with the tenant it was admitted for. No
 *      active tenant (an unpinned request, or code running outside any request)
 *      → ZERO rows. Because the rows are scoped before the program sees them,
 *      every value derived from them — a mapped field, a count, a join done in
 *      code — is scoped by construction (the C4 leak: `rows.map(r => r.name)`
 *      used to ship every tenant's names, because the strip below could only see
 *      rows, not strings).
 *
 *   4. At the compiler-owned egress sink, `_scrml_tenant_redact(value, tenantKey)`
 *      re-checks every marked row against the ambient tenant — defense in depth;
 *      under a correct source filter it drops nothing.
 *
 * Enforcement is HYBRID (§14.8.10): the source filter guarantees reads; the
 * classes a row filter cannot cover fail closed at compile — an
 * aggregate-without-discriminator or a tenant table read only inside a
 * subquery / CTE / derived table (`E-TENANT-AGG`), a write (`E-TENANT-WRITE`), or
 * a raw/unanalyzable egress (`E-TENANT-RAW-EGRESS`). `.acrossTenants()` is the
 * sole loud opt-out (fires `I-TENANT-ACROSS`); `I-TENANT-STRIP` names every scoped
 * read (never silent).
 *
 * V1-minimal scope (the freeze): the source filter + the hard-fails. NO
 * SQL-WHERE-parser (predicate injection is v1.next — the `OR`-precedence hazard),
 * so a `LIMIT` / `OFFSET` applies before the filter (a short page, never a
 * foreign row).
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
 * The tenant-scoped table set, with CASE-INSENSITIVE membership.
 *
 * ⚑ SQL TREATS `Assets` AND `assets` AS THE SAME TABLE; THIS FLOOR DID NOT, AND
 * THE MISMATCH WAS A SILENT ESCAPE. Declaring `CREATE TABLE Assets (…, tenant_id
 * TEXT)` (or the DSL `Assets { … }`) and then reading `SELECT … FROM assets`
 * produced `const rows = await _scrml_sql`…`` — no tag, no redact, NO
 * DIAGNOSTIC, exit 0 — because the declared name went into a case-SENSITIVE set
 * and the lookup used the query's spelling. MEASURED in all four combinations
 * (`Assets`/`assets`, `assets`/`ASSETS`, `ASSETS`/`Assets`) and in BOTH
 * declaration forms; the DSL half predates the raw-DDL work and was inherited.
 * `mentionsTenantTable` below was already case-INSENSITIVE, which is what the
 * intent was.
 *
 * ⚑ WHY A SET SUBCLASS RATHER THAN LOWERCASING AT EACH LOOKUP. `has()` is called
 * from FIVE sites, and TWO of them (`emit-server.ts:5155` and `:5401`) are in a
 * file this change may not touch. Folding inside the container fixes every
 * caller — present and future — at one point, and makes it impossible for a new
 * call site to reintroduce the bug by forgetting to fold. Entries are stored
 * lowercased; `has()` folds the probe. Callers keep the ORIGINAL casing of
 * whatever they probed with, which matters: `resolveTenantScoping` returns
 * `table` from `proj.fromTables`, and `rewriteSelectAddTenantId` uses it to find
 * the alias in `proj.aliasMap` and to emit a `<alias>.tenant_id` qualifier that
 * has to match the SQL text verbatim.
 */
class TenantTableSet extends Set<string> {
  add(value: string): this {
    return super.add(typeof value === "string" ? value.toLowerCase() : value);
  }
  has(value: string): boolean {
    return super.has(typeof value === "string" ? value.toLowerCase() : value);
  }
  delete(value: string): boolean {
    return super.delete(typeof value === "string" ? value.toLowerCase() : value);
  }
}

/**
 * Build the TenantContext from BOTH table registries the compiler holds:
 *
 *  1. the §14.8.9 ProtectContext's `schemaByTable` (every `<db>`-bound table), and
 *  2. the app's own `<schema>` declarations.
 *
 * A table is tenant-scoped iff its column list includes `tenant_id`.
 *
 * **Both are required, and (2) is the one SPEC §14.8.10 actually names.** Its
 * declaration clause is unambiguous — *"A table whose `<schema>` carries a
 * `tenant_id` column IS tenant-scoped; the column's presence is the declaration…
 * There is no per-table opt-in attribute."* Until S288 this function read ONLY
 * the `<db>`-derived registry, so a `<schema>`-only app — no `<db>` block, which
 * is the ordinary shape for an app that lets scrml own its schema — produced an
 * EMPTY tenant set. `_tenantActive` was therefore false, `_scrml_current_user`
 * omitted the `tenantId` projection, and `_scrml_active_tenant()` returned null
 * on every request.
 *
 * That is worse than a missing feature, because the §14.8.11 db-authoritative
 * tier gates on a DIFFERENT signal (the `<schema>` `db-authoritative` marker) and
 * so DID engage: its per-request wrapper faithfully pinned
 * `set_config('scrml.tenant', null)` and dropped to the bounded role, and RLS
 * then matched nothing. Each half was internally consistent; the composition was
 * dead. Found by an adopter's behavioral run (S4), not by any suite — the tier's
 * own tests hand-execute `set_config` inside a transaction and never issue a
 * request, so a session-sourced tenant failing to arrive is invisible to them.
 *
 * @param schemaTables — the `<schema>`-declared tables (`extractDesiredSchema`'s
 *   `tables`). Optional so the existing `<db>`-only callers and the unit tests
 *   that construct a bare ProtectContext keep working unchanged.
 */
export function buildTenantContext(
  protectCtx: ProtectContext,
  schemaTables?: Array<{ name?: unknown; columns?: unknown }>,
): TenantContext {
  const tenantScopedTables = new TenantTableSet();
  for (const [table, cols] of protectCtx.schemaByTable) {
    if (cols.some((c) => c.toLowerCase() === TENANT_COLUMN)) tenantScopedTables.add(table);
  }
  for (const t of schemaTables ?? []) {
    if (typeof t?.name !== "string" || !Array.isArray(t?.columns)) continue;
    const carriesTenant = (t.columns as Array<{ name?: unknown }>).some(
      (c) => typeof c?.name === "string" && c.name.toLowerCase() === TENANT_COLUMN,
    );
    if (carriesTenant) tenantScopedTables.add(t.name);
  }
  return { tenantScopedTables };
}

/**
 * One key column the source filter checks: the OUTPUT column of a result row that
 * holds one tenant-scoped source's `tenant_id`. `add` is the projection fragment
 * the floor appends to produce it (`null` when the author's projection already
 * carries it); an added column is removed from each row after the filter.
 */
export interface TenantKeyColumn {
  col: string;
  add: string | null;
}

/**
 * The result of resolving a `?{}` read's tenant scoping:
 *   - `null`                    — no floor (not row-producing, or no source is a
 *                                 tenant-scoped table). Lowered unchanged.
 *   - `{ kind: "read" }`        — a resolvable SELECT whose FROM/JOIN sources
 *                                 include a tenant-scoped table; filtered at the
 *                                 source. `keys` has ONE entry per tenant-scoped
 *                                 source (a row is kept iff every one matches).
 *   - `{ kind: "agg" }`         — no row to key on → `E-TENANT-AGG`. `reason`
 *                                 "aggregate": an aggregate/scalar with NO output
 *                                 tenant discriminator (`GROUP BY tenant_id`);
 *                                 "subquery": a tenant-scoped table read inside a
 *                                 subquery / CTE / derived table, whose rows fold
 *                                 into the outer row before any filter can run.
 *   - `{ kind: "unresolvable" }`— a read the extractor cannot resolve (a set
 *                                 operation, an unparseable FROM) that mentions a
 *                                 tenant-scoped table → ZERO rows at the source
 *                                 (fail-closed, `I-TENANT-STRIP`).
 */
export type TenantScoping =
  | { kind: "read"; table: string; keys: TenantKeyColumn[] }
  | { kind: "agg"; table: string; reason: "aggregate" | "subquery" }
  | { kind: "unresolvable" }
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

/** The prefix of a floor-added key column in a multi-source read (removed after the filter). */
export const TENANT_KEY_ALIAS_PREFIX = "_scrml_tenant_key_";

/**
 * Does a parenthesized `SELECT` / `WITH` (a subquery, a derived table, a CTE body)
 * anywhere in the query mention a tenant-scoped table? Such a read folds tenant
 * rows into the OUTER row before any row filter can run (§14.8.10 S452 reading:
 * the aggregate case → E-TENANT-AGG).
 */
function subqueryMentionsTenantTable(sqlContent: string, ctx: TenantContext): boolean {
  const norm = sqlContent.replace(/\$\{[^}]*\}/g, " ");
  const opener = /\(\s*(?:SELECT|WITH)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = opener.exec(norm)) !== null) {
    let depth = 0;
    let end = norm.length;
    for (let i = m.index; i < norm.length; i++) {
      if (norm[i] === "(") depth++;
      else if (norm[i] === ")") { depth--; if (depth === 0) { end = i; break; } }
    }
    if (mentionsTenantTable(norm.slice(m.index, end), ctx)) return true;
  }
  return false;
}

/**
 * The SQL references (alias, or bare table name) of every tenant-scoped source in
 * a resolvable FROM/JOIN list, in source order. A self-join yields one reference
 * per occurrence (`assets a JOIN assets b` → `a`, `b`).
 */
function tenantSourceRefs(
  fromTables: string[],
  aliasMap: Map<string, string>,
  ctx: TenantContext,
): string[] {
  const refs: string[] = [];
  const seenTables = new Set<string>();
  for (const table of fromTables) {
    if (!ctx.tenantScopedTables.has(table) || seenTables.has(table)) continue;
    seenTables.add(table);
    const explicitAliases = [...aliasMap].filter(([a, t]) => t === table && a !== table).map(([a]) => a);
    refs.push(...explicitAliases);
    const occurrences = fromTables.filter((t) => t === table).length;
    if (occurrences > explicitAliases.length) refs.push(table);
  }
  return refs;
}

/**
 * Resolve the tenant scoping a `?{}` READ carries. Reads only — writes are
 * classified separately by `classifyTenantWrite`.
 */
export function resolveTenantScoping(sqlContent: string, ctx: TenantContext): TenantScoping {
  if (ctx.tenantScopedTables.size === 0) return null;
  if (!isRowProducingQuery(sqlContent)) return null;

  const proj = extractSelectProjection(sqlContent);
  if (!proj.resolvable) {
    // Never accept-unknown: a read that mentions a tenant-scoped table but whose
    // sources cannot be resolved is either the subquery / CTE / derived-table case
    // (E-TENANT-AGG — its tenant rows fold into the outer row) or an unresolvable
    // read (ZERO rows at the source). A read over non-tenant tables only is left
    // alone (do not nuke a non-tenant CTE).
    if (!mentionsTenantTable(sqlContent, ctx)) return null;
    if (sqlLeader(sqlContent) === "WITH" || subqueryMentionsTenantTable(sqlContent, ctx)) {
      return { kind: "agg", table: firstMentionedTenantTable(sqlContent, ctx), reason: "subquery" };
    }
    return { kind: "unresolvable" };
  }

  // A tenant-scoped table read inside a subquery (in the projection, WHERE,
  // HAVING, …) never reaches the outer row's key columns, whatever the outer
  // sources are.
  if (subqueryMentionsTenantTable(sqlContent, ctx)) {
    return { kind: "agg", table: firstMentionedTenantTable(sqlContent, ctx), reason: "subquery" };
  }

  // Which FROM/JOIN sources are tenant-scoped?
  const refs = tenantSourceRefs(proj.fromTables, proj.aliasMap, ctx);
  if (refs.length === 0) return null;
  const table = proj.aliasMap.get(refs[0]) ?? refs[0];

  // Aggregate/scalar over a tenant-scoped table: the filter can only key on a
  // per-tenant output row. WITH `GROUP BY tenant_id` the aggregate yields a
  // tenant-discriminated row (kind "read"); WITHOUT one it folds every tenant
  // into one scalar → E-TENANT-AGG.
  if (AGGREGATE_FN.test(sqlContent)) {
    const hasGroupByTenant = /\bGROUP\s+BY\b[^;]*\btenant_id\b/i.test(sqlContent.replace(/\$\{[^}]*\}/g, " "));
    if (!hasGroupByTenant) return { kind: "agg", table, reason: "aggregate" };
  }

  // A multi-source read (a JOIN, or a comma join) keys EVERY tenant-scoped source
  // through its own explicitly-aliased column — `SELECT *` over two tenant tables
  // yields ONE `tenant_id` key in the row object (the last one wins), so the
  // author's projection cannot be trusted to carry each source's key.
  if (proj.fromTables.length > 1) {
    return {
      kind: "read",
      table,
      keys: refs.map((ref, i) => ({
        col: `${TENANT_KEY_ALIAS_PREFIX}${i}`,
        add: `${ref}.${TENANT_COLUMN} AS ${TENANT_KEY_ALIAS_PREFIX}${i}`,
      })),
    };
  }

  // A single-table read: is `tenant_id` already an OUTPUT column (so the row can
  // be keyed without a projection add)? A `star` includes it (source column name
  // == output name); an explicit `(table, tenant_id)` column projects it under its
  // outputName.
  for (const col of proj.columns) {
    if (col.kind === "star") {
      return { kind: "read", table, keys: [{ col: TENANT_COLUMN, add: null }] };
    }
    if (col.kind === "column" && col.column.toLowerCase() === TENANT_COLUMN) {
      return { kind: "read", table, keys: [{ col: col.outputName, add: null }] };
    }
  }
  return { kind: "read", table, keys: [{ col: TENANT_COLUMN, add: TENANT_COLUMN }] };
}

/** The first tenant-scoped table name the query mentions (for diagnostics). */
function firstMentionedTenantTable(sqlContent: string, ctx: TenantContext): string {
  for (const t of ctx.tenantScopedTables) {
    if (new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(sqlContent)) return t;
  }
  return "";
}

/**
 * Rewrite a resolvable SELECT to ADD the key columns the source filter needs to
 * the projection (a deterministic projection-column add, NOT a WHERE-parse). The
 * columns are appended just before the first top-level `FROM`. Returns the
 * original SQL unchanged when nothing is added.
 */
export function rewriteSelectAddTenantId(sqlContent: string, scoping: TenantScoping): string {
  if (!scoping || scoping.kind !== "read") return sqlContent;
  const adds = scoping.keys.map((k) => k.add).filter((a): a is string => a !== null);
  if (adds.length === 0) return sqlContent;

  // Locate the first top-level FROM in the ORIGINAL (un-normalized) text so we
  // insert the columns before it, preserving `${...}` params + spacing verbatim.
  const fromIdx = findTopLevelFromInSource(sqlContent);
  if (fromIdx === -1) return sqlContent;
  const before = sqlContent.slice(0, fromIdx);
  const after = sqlContent.slice(fromIdx);
  return `${before.replace(/\s*$/, "")}, ${adds.join(", ")} ${after}`;
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
  // §23.2 — the foreign opener is `_` + ZERO OR MORE `=` + `{`, closed by `}` +
  // the same run of `=`. This test USED to be `_\{`, which is LEVEL 0 ONLY.
  //
  // ⚑ THAT IS BACKWARDS FROM WHICH SPELLINGS MATTER: `W-FOREIGN-001` actively
  // steers authors AWAY from level 0, so the gate recognized exactly the
  // spelling the compiler discourages and missed the ones it recommends.
  //
  // REPRODUCED end-to-end at exit 0 before the fix, and the consequence is a
  // TENANT ISOLATION ESCAPE, not merely a missing diagnostic:
  //
  //   const rows = ?{`SELECT id, name, tenant_id FROM assets`}.all()
  //   let wire   = _={ JSON.stringify(rows) }=
  //   return wire
  //
  // emitted `const rows = _scrml_tenant_tag(await _scrml_sql`…`, "tenant_id",
  // false); let wire = await (async () => { return (JSON.stringify(rows)); })();
  // return wire;` — the foreign block flattens the TAGGED rows into a STRING, so
  // `_scrml_tenant_redact` hits its `typeof value !== "object"` exit and returns
  // it verbatim. EXECUTED: ambient tenant "A", output
  // `[{"id":1,…,"tenant_id":"A"},{"id":2,"name":"THEIRS","tenant_id":"B"}]`.
  // Levels 1, 2 and 3 all compiled with ZERO errors; level 0 correctly hard-failed.
  //
  // The pattern is the one already in-tree at `ast-builder.js:18392` — copied,
  // not re-derived, because a third spelling of this predicate is how the first
  // two drifted apart. Found by the arc-A sibling in `protect-egress.ts` (whose
  // byte-identical twin is the column direction of the same hole) and handed
  // across; reproduced HERE on its own terms before being fixed here.
  if (/(?:^|[^A-Za-z0-9_$])_=*\{/.test(fnSource)) {
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
 * module IFF a `_scrml_tenant_` helper / `_scrml_active_tenant` is referenced
 * (mirrors the §14.8.9 helper's inline-on-use precedent). Server-only — never
 * client.js.
 *
 * `_scrml_active_tenant(req)` resolves the ambient tenant from the §20.5
 * `_scrml_current_user` resolver (emitted when the app uses a session — it pins
 * the tenant with `session.set("tenantId", …)`). `_scrml_tenant_scope` filters a
 * query's rows to that tenant at the source; `_scrml_tenant_redact` re-checks at
 * the egress sink. No tenant (unpinned, or no request at all) → zero rows.
 */
export const SERVER_TENANT_HELPER: string = [
  "",
  "// --- §14.8.10 Tenant-row isolation floor (server-only confidentiality floor) ---",
  "// THE FLOOR FILTERS AT THE SOURCE. A read of a tenant-scoped table is filtered to",
  "// the request's active tenant (@currentUser.tenantId) immediately after the query",
  "// runs, before any program code holds a row — so every value the program derives",
  "// from the rows (a mapped field, a count, a join done in code) is that tenant's",
  "// alone. No active tenant — an unpinned request, or code running outside any",
  "// request (boot, a background job, a WebSocket callback) — means ZERO rows.",
  "// .acrossTenants() is the only unscoped read. The egress strip",
  "// (_scrml_tenant_redact) re-checks every row at the client sink: defense in",
  "// depth, it drops nothing while the source filter is correct. Composes with §14.8.9.",
  "const _SCRML_TENANT = Symbol.for(\"scrml.tenant.origin\");",
  "function _scrml_active_tenant(req) {",
  "  if (req == null) return null;",
  "  const _cu = (typeof _scrml_current_user === \"function\") ? _scrml_current_user(req) : null;",
  "  return _cu ? (_cu.tenantId ?? null) : null;",
  "}",
  "// The request a query runs for. Server functions called in-process (a peer",
  "// callable) have no request parameter, so the request is carried in an",
  "// AsyncLocalStorage opened around every route handler (installed at the end of",
  "// this module) rather than read from a lexical `_scrml_req`.",
  "const _scrml_tenant_req_als = (globalThis.__scrml_tenant_req_als ??= new (process.getBuiltinModule(\"node:async_hooks\").AsyncLocalStorage)());",
  "function _scrml_tenant_request_scope(handler) {",
  "  if (typeof handler !== \"function\") return handler;",
  "  return function (...args) {",
  "    return _scrml_tenant_req_als.run({ req: args[0] ?? null }, () => handler.apply(this, args));",
  "  };",
  "}",
  "// The active tenant of the request this code runs for; null outside any request.",
  "// Read per query, so a tenant switch earlier in the same request is honored.",
  "function _scrml_tenant_source_key() {",
  "  const _s = _scrml_tenant_req_als.getStore();",
  "  return _s ? _scrml_active_tenant(_s.req) : null;",
  "}",
  "// §14.8.11.2 S4 — the principal's capability SET as a JSON array string, pinned",
  "// into the `scrml.principal.caps` GUC by the db-authoritative txn wrapper and read",
  "// by a SECDEF's `scrml_has_cap()`. Server-resolved from the session-derived",
  "// @currentUser (never client-supplied, mirroring tenantId / E-REACTIVE-003); no",
  "// caps source ⇒ `[]` ⇒ fail-closed (no caps ⇒ no privileged mutation).",
  "function _scrml_active_caps(req) {",
  "  const _cu = (typeof _scrml_current_user === \"function\") ? _scrml_current_user(req) : null;",
  "  const _caps = (_cu && Array.isArray(_cu.caps)) ? _cu.caps : [];",
  "  return JSON.stringify(_caps);",
  "}",
  "// THE MARK MUST STICK, AND SILENCE IS NOT PROOF THAT IT DID. Attaching the",
  "// descriptor is a plain property write, and a plain property write to a FROZEN,",
  "// SEALED or preventExtensions object is a SILENT no-op outside strict mode (and",
  "// a TypeError inside it — this module is an ES module, so always strict). Both",
  "// paths route to one refusal: the floor never reports a success it did not",
  "// achieve. Not reachable from correct emission (the scope wraps the RAW driver",
  "// result, and no author code runs between the await and the scope).",
  "function _scrml_tenant_refuse_untaggable() {",
  "  throw new Error(",
  "    \"E-TENANT-RAW-EGRESS (runtime): the \\u00a714.8.10 floor could not attach its \" +",
  "    \"tenant descriptor to a query result row (the value is frozen, sealed or \" +",
  "    \"non-extensible), so the egress re-check would have no tenant to key on. \" +",
  "    \"Refusing to emit it.\",",
  "  );",
  "}",
  "function _scrml_tenant_mark(target, descriptor) {",
  "  try {",
  "    target[_SCRML_TENANT] = descriptor;",
  "  } catch (_e) {",
  "    _scrml_tenant_refuse_untaggable();   // strict mode: the write threw",
  "  }",
  "  if (target[_SCRML_TENANT] !== descriptor) _scrml_tenant_refuse_untaggable(); // sloppy mode: it no-opped",
  "}",
  "// A row is admitted iff EVERY key column — one per tenant-scoped source in the",
  "// query, so a JOIN of two tenant tables checks both — holds the active tenant.",
  "// NULL never matches (the missing side of an outer join is dropped).",
  "function _scrml_tenant_row_admitted(row, keyCols, tenantKey) {",
  "  if (row == null || typeof row !== \"object\" || Array.isArray(row)) return false;",
  "  for (const c of keyCols) {",
  "    const v = row[c];",
  "    if (v == null || String(v) !== String(tenantKey)) return false;",
  "  }",
  "  return true;",
  "}",
  "// A surviving row loses the key columns the floor ADDED to the projection (the",
  "// program sees exactly the columns it asked for) and is marked with the tenant it",
  "// was admitted for — the egress re-check compares that mark, not a column.",
  "function _scrml_tenant_admit(row, addedCols, tenantKey) {",
  "  for (const c of addedCols) delete row[c];",
  "  _scrml_tenant_mark(row, { tenant: String(tenantKey) });",
  "  return row;",
  "}",
  "// THE SOURCE FILTER. `rows` is the driver's result array; it is compacted IN PLACE",
  "// so the driver's array type and its row `count` survive (and `count` is",
  "// corrected — left alone it would still count every tenant's rows). `.get()`",
  "// takes its first row AFTER this, so a lookup of another tenant's row is `not`.",
  "function _scrml_tenant_scope(rows, keyCols, addedCols) {",
  "  if (rows == null) return rows;",
  "  const tenantKey = _scrml_tenant_source_key();",
  "  if (!Array.isArray(rows)) {",
  "    // Not a row array (no driver returns one for a SELECT): one row or nothing.",
  "    if (tenantKey == null || !_scrml_tenant_row_admitted(rows, keyCols, tenantKey)) return null;",
  "    return _scrml_tenant_admit(rows, addedCols, tenantKey);",
  "  }",
  "  let kept = 0;",
  "  for (let i = 0; i < rows.length; i++) {",
  "    const row = rows[i];",
  "    if (tenantKey != null && _scrml_tenant_row_admitted(row, keyCols, tenantKey)) {",
  "      rows[kept++] = _scrml_tenant_admit(row, addedCols, tenantKey);",
  "    }",
  "  }",
  "  rows.length = kept;",
  "  if (typeof rows.count === \"number\") rows.count = kept;",
  "  return rows;",
  "}",
  "// A read the compiler cannot resolve to its sources (a set operation, an",
  "// unparseable FROM) that mentions a tenant-scoped table: nothing is provably the",
  "// active tenant's, so nothing is admitted.",
  "function _scrml_tenant_scope_none(rows) {",
  "  if (rows == null) return rows;",
  "  if (!Array.isArray(rows)) return null;",
  "  rows.length = 0;",
  "  if (typeof rows.count === \"number\") rows.count = 0;",
  "  return rows;",
  "}",
  "// A HOST-OPAQUE carrier: a value whose contents the floor structurally cannot",
  "// read (a streamed/binary body). Enumerated, not guessed — Response, Blob,",
  "// ReadableStream, ArrayBuffer and any ArrayBuffer view (TypedArray/DataView).",
  "// Each is guarded by a typeof check so the helper still runs on a host that",
  "// does not define it.",
  "function _scrml_tenant_opaque(v) {",
  "  if (typeof Response !== \"undefined\" && v instanceof Response) return true;",
  "  if (typeof Blob !== \"undefined\" && v instanceof Blob) return true;",
  "  if (typeof ReadableStream !== \"undefined\" && v instanceof ReadableStream) return true;",
  "  if (typeof ArrayBuffer !== \"undefined\" && (v instanceof ArrayBuffer || ArrayBuffer.isView(v))) return true;",
  "  return false;",
  "}",
  "// REFUSE WHAT THE MONITOR CANNOT INSPECT. A value carrying the tenant mark is",
  "// one the compiler asserted is a tenant-scoped row. If it is also host-opaque,",
  "// the re-check cannot read it — so it must not cross the wire. Throwing (rather",
  "// than dropping) is deliberate: this state is UNREACHABLE from correct emission —",
  "// the mark is only ever applied to a row of a lowered `?{}` result, never a",
  "// stream — so reaching it means a value-flow the compiler did not model. A",
  "// silent drop would be indistinguishable from \"this tenant has no rows\".",
  "function _scrml_tenant_refuse_opaque() {",
  "  throw new Error(",
  "    \"E-TENANT-RAW-EGRESS (runtime): a tenant-scoped value reached the egress \" +",
  "    \"sink inside a host-opaque carrier (Response / Blob / stream / buffer) that \" +",
  "    \"the \\u00a714.8.10 floor cannot inspect. Refusing to emit it. Return the rows \" +",
  "    \"through the normal compiler-emitted response, or mark the query \" +",
  "    \".acrossTenants() for a deliberate cross-tenant read.\",",
  "  );",
  "}",
  "// THE EGRESS RE-CHECK (defense in depth). Drops every marked row whose admitting",
  "// tenant is not the request's tenant now; an unpinned request keeps none.",
  "function _scrml_tenant_redact(value, tenantKey) {",
  "  if (value == null || typeof value !== \"object\") return value;",
  "  if (Array.isArray(value)) {",
  "    const out = [];",
  "    for (const el of value) {",
  "      const d = (el != null && typeof el === \"object\") ? el[_SCRML_TENANT] : null;",
  "      if (d) {",
  "        if (_scrml_tenant_opaque(el)) _scrml_tenant_refuse_opaque();",
  "        if (tenantKey == null || d.tenant !== String(tenantKey)) continue;",
  "        out.push(el);",
  "      } else {",
  "        out.push(_scrml_tenant_redact(el, tenantKey));",
  "      }",
  "    }",
  "    return out;",
  "  }",
  "  const d = value[_SCRML_TENANT];",
  "  if (d) {",
  "    // The mark is read BEFORE the opaque passthrough below, and that ORDER",
  "    // matters: a MARKED opaque value is refused, never passed uninspected.",
  "    if (_scrml_tenant_opaque(value)) _scrml_tenant_refuse_opaque();",
  "    if (tenantKey == null || d.tenant !== String(tenantKey)) return null;",
  "    return value;",
  "  }",
  "  // UNmarked and opaque: not a tenant-scoped value, and rebuilding it as a",
  "  // plain object would destroy it. Passed through unchanged — this is the",
  "  // shipped binary/PDF egress path (§12.5).",
  "  if (_scrml_tenant_opaque(value)) return value;",
  "  const out = {};",
  "  for (const k of Object.keys(value)) out[k] = _scrml_tenant_redact(value[k], tenantKey);",
  "  return out;",
  "}",
  "",
].join("\n");

/**
 * The request-scope installation for the source filter, appended at the END of a
 * tenant app's server module (after every route export it names). Wraps each
 * route's `handler` so `_scrml_tenant_source_key()` can find the request from any
 * code the handler runs — including a server function called in-process, which
 * has no request parameter. Mutates the exported route objects in place, so every
 * dispatcher (`_server.js`, `scrml dev`, the module's own `fetch`) gets it.
 * WebSocket callbacks are deliberately NOT wrapped: they serve no single HTTP
 * request, so a tenant-scoped read there sees zero rows (fail-closed).
 */
export function tenantRequestScopeLines(routeNames: readonly string[]): string[] {
  if (routeNames.length === 0) return [];
  return [
    "",
    "// --- §14.8.10: every route handler carries its request to the tenant source filter (compiler-generated) ---",
    `for (const _scrml_route of [${routeNames.join(", ")}]) _scrml_route.handler = _scrml_tenant_request_scope(_scrml_route.handler);`,
  ];
}

/**
 * Build the source-filter wrap for a lowered SQL read whose value is the driver's
 * row ARRAY (`await sql`…``): `_scrml_tenant_scope(<rows>, [keyCols], [addedCols])`,
 * or `_scrml_tenant_scope_none(<rows>)` for an unresolvable read. A `.get()` takes
 * `[0]` of THIS result (the first row after the filter).
 */
export function wrapWithTenantScope(rowsExpr: string, scoping: TenantScoping): string {
  if (!scoping) return rowsExpr;
  if (scoping.kind === "unresolvable") return `_scrml_tenant_scope_none(${rowsExpr})`;
  if (scoping.kind === "read") {
    const keyCols = scoping.keys.map((k) => k.col);
    const addedCols = scoping.keys.filter((k) => k.add !== null).map((k) => k.col);
    return `_scrml_tenant_scope(${rowsExpr}, ${JSON.stringify(keyCols)}, ${JSON.stringify(addedCols)})`;
  }
  return rowsExpr; // "agg" carries no filter — it hard-fails at compile.
}
