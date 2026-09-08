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
  "// THE TAG MUST STICK, AND SILENCE IS NOT PROOF THAT IT DID. Attaching the",
  "// descriptor is a plain property write, and a plain property write to a FROZEN,",
  "// SEALED or preventExtensions object is a SILENT no-op outside strict mode.",
  "// MEASURED: a frozen row tagged with `tenant_id` kept no descriptor at all, the",
  "// egress redact then found nothing to key on, and a row of tenant B was handed",
  "// to a request whose ambient tenant was A — the same fail-OPEN the redact half",
  "// closes below, one function earlier. So every write is VERIFIED and a failure",
  "// REFUSES; the floor never reports a success it did not achieve.",
  "//",
  "// Not reachable from correct emission today (the tag wraps the RAW driver",
  "// result of a `?{}` query, and no author code can run between the await and the",
  "// tag), so this is defence in depth rather than a live leak — but the cost is a",
  "// property read per row and the failure it prevents is silent cross-tenant",
  "// disclosure.",
  "function _scrml_tenant_refuse_untaggable() {",
  "  throw new Error(",
  "    \"E-TENANT-RAW-EGRESS (runtime): the \\u00a714.8.10 floor could not attach its \" +",
  "    \"tenant descriptor to a query result row (the value is frozen, sealed or \" +",
  "    \"non-extensible), so the egress redact would have no discriminator to key on \" +",
  "    \"and a foreign tenant's row could not be stripped. Refusing to emit it.\",",
  "  );",
  "}",
  "// BOTH FAILURE MODES, because the write fails DIFFERENTLY in the two JS modes",
  "// and this helper runs in the strict one. The emitted `app.server.js` carries",
  "// top-level `import`/`export`, so it is an ES module and therefore ALWAYS",
  "// STRICT: a write to a non-extensible object THROWS a TypeError rather than",
  "// no-opping. The verify-after-write below only ever fires in SLOPPY mode. Both",
  "// paths must route to the same refusal, or the operator gets a bare",
  "// `TypeError: Cannot add property` with none of the guidance.",
  "function _scrml_tenant_mark(target, descriptor) {",
  "  try {",
  "    target[_SCRML_TENANT] = descriptor;",
  "  } catch (_e) {",
  "    _scrml_tenant_refuse_untaggable();   // strict mode: the write threw",
  "  }",
  "  if (target[_SCRML_TENANT] !== descriptor) _scrml_tenant_refuse_untaggable(); // sloppy mode: it no-opped",
  "}",
  "function _scrml_tenant_tag(value, tenantCol, floorAdded) {",
  "  if (value == null || typeof value !== \"object\") return value;",
  "  if (Array.isArray(value)) {",
  "    for (const row of value) {",
  "      if (row != null && typeof row === \"object\" && !Array.isArray(row)) _scrml_tenant_mark(row, { tenantCol, floorAdded });",
  "    }",
  "    return value;",
  "  }",
  "  _scrml_tenant_mark(value, { tenantCol, floorAdded });",
  "  return value;",
  "}",
  "function _scrml_tenant_tag_all(value) {",
  "  if (value == null || typeof value !== \"object\") return value;",
  "  if (Array.isArray(value)) {",
  "    for (const row of value) {",
  "      if (row != null && typeof row === \"object\" && !Array.isArray(row)) _scrml_tenant_mark(row, { stripAll: true });",
  "    }",
  "    return value;",
  "  }",
  "  _scrml_tenant_mark(value, { stripAll: true });",
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
  "// REFUSE WHAT THE MONITOR CANNOT INSPECT. A value carrying the tenant",
  "// descriptor is one the compiler asserted holds tenant-scoped rows. If it is",
  "// also host-opaque, the floor can neither read its tenant_id nor strip a",
  "// foreign row — so it must not cross the wire. Throwing (rather than dropping)",
  "// is deliberate: this state is UNREACHABLE from correct emission — the tag is",
  "// only ever applied to a lowered `?{}` result, which is rows or a scalar and",
  "// never a stream — so reaching it means the §14.8.10 E-TENANT-RAW-EGRESS",
  "// compile gate was bypassed by a value-flow the compiler did not model. A",
  "// silent drop would present as an empty body and be indistinguishable from",
  "// \"this tenant has no rows\"; the invariant breach has to be loud.",
  "function _scrml_tenant_refuse_opaque() {",
  "  throw new Error(",
  "    \"E-TENANT-RAW-EGRESS (runtime): a tenant-scoped value reached the egress \" +",
  "    \"sink inside a host-opaque carrier (Response / Blob / stream / buffer) that \" +",
  "    \"the \\u00a714.8.10 floor cannot inspect. Refusing to emit it. Return the rows \" +",
  "    \"through the normal compiler-emitted response, or mark the query \" +",
  "    \".acrossTenants() for a deliberate cross-tenant read.\",",
  "  );",
  "}",
  "function _scrml_tenant_redact(value, tenantKey) {",
  "  if (value == null || typeof value !== \"object\") return value;",
  "  if (Array.isArray(value)) {",
  "    const out = [];",
  "    for (const el of value) {",
  "      const d = (el != null && typeof el === \"object\") ? el[_SCRML_TENANT] : null;",
  "      if (d) {",
  "        if (_scrml_tenant_opaque(el)) _scrml_tenant_refuse_opaque();",
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
  "    // The descriptor is read BEFORE the opaque passthrough below, and that",
  "    // ORDER is the whole fix: the passthrough used to run first, so a TAGGED",
  "    // Response was handed to the client entirely uninspected — the one",
  "    // fail-OPEN in this redactor.",
  "    if (_scrml_tenant_opaque(value)) _scrml_tenant_refuse_opaque();",
  "    if (d.stripAll) return null;",
  "    if (tenantKey == null) return null;",
  "    if (String(value[d.tenantCol]) !== String(tenantKey)) return null;",
  "    return _scrml_tenant_strip_col(value, d);",
  "  }",
  "  // UNtagged and opaque: not a tenant-scoped value, and rebuilding it as a",
  "  // plain object would destroy it. Passed through unchanged — this is the",
  "  // shipped binary/PDF egress path (§12.5), and it is deliberately NOT",
  "  // touched by the refusal above.",
  "  if (_scrml_tenant_opaque(value)) return value;",
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
