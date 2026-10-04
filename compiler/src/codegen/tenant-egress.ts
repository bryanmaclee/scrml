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

import { extractSelectProjection, normalizeSqlText } from "../sql-projection.ts";
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
 * Why a tenant-table read was refused (`E-TENANT-AGG`). Each is a shape whose
 * result rows can fold several tenants' rows into one output row before any
 * row filter runs, or that the floor cannot prove does not:
 *   - "aggregate": GROUP BY / HAVING / DISTINCT without a structural
 *                  `GROUP BY <each tenant source>.tenant_id`;
 *   - "function":  a function call outside the per-row allow-list (an aggregate
 *                  — `json_group_array`, `string_agg`, … — or anything unknown);
 *   - "window":    an `OVER (…)` window (it reads other rows of the result);
 *   - "subquery":  a subquery / CTE / derived table anywhere in the query;
 *   - "setop":     UNION / INTERSECT / EXCEPT;
 *   - "reserved":  the author's SQL names the floor's reserved key alias.
 */
export type TenantRefusal = "aggregate" | "function" | "window" | "subquery" | "setop" | "reserved";

/**
 * The result of resolving a `?{}` read's tenant scoping:
 *   - `null`                    — no floor: not row-producing, or no tenant-scoped
 *                                 table is mentioned. Lowered unchanged.
 *   - `{ kind: "read" }`        — a plain row read of tenant-scoped sources; filtered
 *                                 at the source. `keys` has ONE reserved-alias key
 *                                 column per tenant-scoped source (a row is kept iff
 *                                 every one matches).
 *   - `{ kind: "agg" }`         — refused → `E-TENANT-AGG` (see TenantRefusal).
 *   - `{ kind: "unresolvable" }`— mentions a tenant-scoped table but its sources
 *                                 cannot be resolved → ZERO rows at the source.
 */
export type TenantScoping =
  | { kind: "read"; table: string; keys: TenantKeyColumn[] }
  | { kind: "agg"; table: string; reason: TenantRefusal; detail?: string }
  | { kind: "unresolvable" }
  | null;

/** The leading keyword (SELECT / WITH / INSERT / UPDATE / DELETE / ...) of NORMALIZED text, uppercased. */
function leaderOf(norm: string): string {
  const m = /^([A-Za-z]+)/.exec(norm);
  return m ? m[1].toUpperCase() : "";
}

/**
 * The first tenant-scoped table named (as a whole word) in NORMALIZED text, or
 * null. Returned in the query's own spelling (the set is case-folded).
 */
function firstTenantTableIn(norm: string, ctx: TenantContext): string | null {
  for (const t of ctx.tenantScopedTables) {
    const m = new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").exec(norm);
    if (m) return m[0];
  }
  return null;
}

/**
 * Does `?{}` SQL text mention a tenant-scoped table anywhere (comments and string
 * literals excluded)? The fail-closed gate for every path that cannot apply the
 * row filter itself (e.g. the §8.10 loop hoist refuses to hoist such a query).
 */
export function sqlMentionsTenantTable(sqlContent: string, ctx: TenantContext): boolean {
  return ctx.tenantScopedTables.size > 0 && firstTenantTableIn(normalizeSqlText(sqlContent), ctx) !== null;
}

/**
 * The per-row scalar functions a plain tenant-table read may call. An ALLOW-list
 * (S451: text classification cannot prove a query safe): each of these maps one
 * row's values to one value and never sees another row. Anything else — every
 * aggregate (`count`, `json_group_array`, `string_agg`, …), every table-valued or
 * user-defined function, every name this list does not know — is refused
 * (`E-TENANT-AGG`, reason "function"), unless the query groups by every tenant
 * source's `tenant_id` (then each group holds one tenant's rows only).
 */
export const TENANT_ROW_FUNCTIONS: ReadonlySet<string> = new Set([
  "lower", "upper", "length", "trim", "ltrim", "rtrim", "substr", "substring",
  "replace", "instr", "coalesce", "ifnull", "nullif", "abs", "round",
  "date", "time", "datetime", "julianday", "strftime", "cast",
]);

/**
 * Words a `(` may follow that are NOT a function call. An allow-list too: an
 * identifier followed by `(` that is neither here nor in TENANT_ROW_FUNCTIONS is
 * treated as an unknown function and refused.
 */
const NON_CALL_WORDS: ReadonlySet<string> = new Set([
  "select", "from", "where", "and", "or", "not", "in", "on", "as", "join", "using",
  "when", "then", "else", "case", "is", "like", "glob", "between", "by", "limit",
  "offset", "escape", "values", "exists", "asc", "desc", "end", "null",
]);

/** The reserved alias prefix of the floor's key columns (removed after the filter). */
export const TENANT_KEY_ALIAS_PREFIX = "__scrml_tenant_";

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
 * The GROUP BY column list of NORMALIZED, subquery-free SQL, read structurally:
 * from the top-level `GROUP BY` to the next clause keyword (HAVING, ORDER BY,
 * LIMIT, OFFSET, WINDOW) or the end. Items are lowercased and trimmed. `null`
 * when there is no GROUP BY.
 */
function groupByItems(norm: string): string[] | null {
  const m = /\bGROUP\s+BY\b/i.exec(norm);
  if (!m) return null;
  const rest = norm.slice(m.index + m[0].length);
  const stop = /\b(HAVING|ORDER\s+BY|LIMIT|OFFSET|WINDOW)\b|;/i.exec(rest);
  const clause = stop ? rest.slice(0, stop.index) : rest;
  const items: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of clause) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) { items.push(cur); cur = ""; } else cur += ch;
  }
  items.push(cur);
  return items.map((s) => s.trim().toLowerCase()).filter((s) => s.length > 0);
}

/**
 * Does the GROUP BY list name EVERY tenant source's `tenant_id`? `<ref>.tenant_id`
 * always counts; a bare `tenant_id` counts only for a single-table read. Anything
 * the reader cannot match (an expression, a position number, a quoted name) does
 * not — then the query is not exempt.
 */
function groupsByEveryTenantSource(items: string[], refs: string[], singleTable: boolean): boolean {
  const set = new Set(items);
  return refs.every((ref) =>
    set.has(`${ref.toLowerCase()}.${TENANT_COLUMN}`) || (singleTable && set.has(TENANT_COLUMN)));
}

/**
 * Resolve the tenant scoping a `?{}` READ carries. Reads only — writes are
 * classified separately by `classifyTenantWrite`. Every check runs on ONE text:
 * `normalizeSqlText` (comments removed, string literals blanked) — the same
 * normalization `extractSelectProjection` reads, so no check can see a different
 * query from another.
 */
export function resolveTenantScoping(sqlContent: string, ctx: TenantContext): TenantScoping {
  if (ctx.tenantScopedTables.size === 0) return null;
  const norm = normalizeSqlText(sqlContent);
  const leader = leaderOf(norm);
  if (leader !== "SELECT" && leader !== "WITH") return null;
  const mentioned = firstTenantTableIn(norm, ctx);
  if (mentioned === null) return null;
  const refuse = (reason: TenantRefusal, detail?: string): TenantScoping =>
    ({ kind: "agg", table: mentioned, reason, ...(detail ? { detail } : {}) });

  // The fail-closed shape checks — none of these can be a plain row read.
  if (new RegExp(`\\b${TENANT_KEY_ALIAS_PREFIX}`, "i").test(norm)) return refuse("reserved");
  if (leader === "WITH" || /\(\s*(?:SELECT|WITH|VALUES)\b/i.test(norm)) return refuse("subquery");
  if (/\b(?:UNION|INTERSECT|EXCEPT)\b/i.test(norm)) return refuse("setop");
  if (/\bOVER\b/i.test(norm)) return refuse("window");

  const proj = extractSelectProjection(sqlContent);
  if (!proj.resolvable) return { kind: "unresolvable" };
  const refs = tenantSourceRefs(proj.fromTables, proj.aliasMap, ctx);
  // A tenant table is named, but not as a FROM / JOIN source the floor can key
  // on: nothing is provably the active tenant's → zero rows.
  if (refs.length === 0) return { kind: "unresolvable" };
  const table = proj.aliasMap.get(refs[0]) ?? refs[0];

  // Grouping is allowed ONLY when it groups by every tenant source's key: then
  // each output row is one tenant's group, and the key column carries it.
  const groupItems = groupByItems(norm);
  const exempt = groupItems !== null && groupsByEveryTenantSource(groupItems, refs, proj.fromTables.length === 1);
  if (!exempt) {
    if (groupItems !== null || /\bHAVING\b/i.test(norm) || /\bDISTINCT\b/i.test(norm)) {
      return { kind: "agg", table, reason: "aggregate" };
    }
    const callRe = /\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = callRe.exec(norm)) !== null) {
      const name = m[1].toLowerCase();
      if (NON_CALL_WORDS.has(name) || TENANT_ROW_FUNCTIONS.has(name)) continue;
      return { kind: "agg", table, reason: "function", detail: m[1] };
    }
  }

  // ONE reserved-alias key column per tenant source, always added: the author's
  // projection is never trusted to carry the key (`SELECT *, 'A' AS tenant_id`
  // would forge it), and the alias cannot collide (an author naming it is refused
  // above). Each is removed from the row after the filter.
  return {
    kind: "read",
    table,
    keys: refs.map((ref, i) => ({
      col: `${TENANT_KEY_ALIAS_PREFIX}${i}`,
      add: `${ref}.${TENANT_COLUMN} AS ${TENANT_KEY_ALIAS_PREFIX}${i}`,
    })),
  };
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
  // (If it is not found the key columns are absent and the filter keeps no row.)
  const fromIdx = findTopLevelFromInSource(sqlContent);
  if (fromIdx === -1) return sqlContent;
  const before = sqlContent.slice(0, fromIdx);
  const after = sqlContent.slice(fromIdx);
  return `${before.replace(/\s*$/, "")}, ${adds.join(", ")} ${after}`;
}

/**
 * Find the byte index of the projection-terminating top-level `FROM` in the
 * ORIGINAL source text: parenthesis-depth aware, word-boundary aware, and
 * skipping `${...}` interpolations, comments, string literals and quoted
 * identifiers (a `FROM` inside any of those is not the clause). Returns -1 when none.
 */
function findTopLevelFromInSource(src: string): number {
  let depth = 0;
  let i = 0;
  const upper = src.toUpperCase();
  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === "$" && next === "{") {
      let d = 1; let j = i + 2;
      while (j < src.length && d > 0) { if (src[j] === "{") d++; else if (src[j] === "}") d--; j++; }
      i = j;
      continue;
    }
    if (ch === "-" && next === "-") { const nl = src.indexOf("\n", i); i = nl === -1 ? src.length : nl + 1; continue; }
    if (ch === "/" && next === "*") { const e = src.indexOf("*/", i + 2); i = e === -1 ? src.length : e + 2; continue; }
    if (ch === "'" || ch === '"' || ch === "`" || ch === "[") {
      const close = ch === "[" ? "]" : ch;
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === close && close === "'" && src[j + 1] === "'") { j += 2; continue; }
        if (src[j] === close) break;
        j++;
      }
      i = j + 1;
      continue;
    }
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
 * The result of classifying a `?{}` WRITE that touches a tenant-scoped table:
 *   - `null`                     — not a write, or no tenant-scoped table mentioned.
 *   - `{ kind: "insert-inject" }`— an INSERT the floor can safely tenant-inject.
 *   - `{ kind: "hard-fail" }`    — anything else → `E-TENANT-WRITE` (unless
 *                                  `.acrossTenants()`, see classifyAcrossTenantInsert).
 */
export type TenantWrite =
  | { kind: "insert-inject"; table: string }
  | { kind: "hard-fail"; table: string; op: string }
  | null;

const INJECTABLE_INSERT_RE =
  /^(?:INSERT|REPLACE)(?:\s+OR\s+\w+)?\s+INTO\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^()]*)\)\s*VALUES\s*\(([^()]*)\)\s*;?$/i;

/**
 * Classify a `?{}` write. Fail-closed, on the ONE normalized text: any
 * INSERT / REPLACE / UPDATE / DELETE that mentions a tenant-scoped table anywhere
 * hard-fails, EXCEPT the one shape the floor can provably inject — a single-row
 * `INSERT INTO <tenant table> (cols) VALUES (vals)` whose column list omits
 * `tenant_id`, whose values hold no subquery or call, and which the injection
 * rewrite can actually rewrite. (UPDATE/DELETE have no WHERE-parser behind them;
 * a committed cross-tenant write is durable before any filter could run.)
 */
export function classifyTenantWrite(sqlContent: string, ctx: TenantContext): TenantWrite {
  if (ctx.tenantScopedTables.size === 0) return null;
  const norm = normalizeSqlText(sqlContent);
  const leader = leaderOf(norm);
  if (leader !== "INSERT" && leader !== "REPLACE" && leader !== "UPDATE" && leader !== "DELETE") return null;
  const mentioned = firstTenantTableIn(norm, ctx);
  if (mentioned === null) return null;
  const fail: TenantWrite = { kind: "hard-fail", table: mentioned, op: leader };
  if (leader === "UPDATE" || leader === "DELETE") return fail;
  const m = INJECTABLE_INSERT_RE.exec(norm);
  if (!m || !ctx.tenantScopedTables.has(m[1])) return fail;
  const cols = m[2].split(",").map((c) => c.trim().toLowerCase());
  if (cols.includes(TENANT_COLUMN)) return { kind: "hard-fail", table: m[1], op: leader };
  // The tenant table may be named only as the target (a mention in the values
  // would be a read of other rows into this one).
  if (firstTenantTableIn(m[3], ctx) !== null) return { kind: "hard-fail", table: m[1], op: leader };
  if (rewriteInsertAddTenantId(sqlContent, "X") === sqlContent) return { kind: "hard-fail", table: m[1], op: leader };
  return { kind: "insert-inject", table: m[1] };
}

/**
 * An `.acrossTenants()` INSERT is the sole way to write a tenant-scoped row
 * outside a request (§14.8.10, ruling user-voice-scrml.md S452 "your rec"), and
 * it must NAME the tenant column — the floor injects nothing into an opted-out
 * query, so an omitted `tenant_id` would silently write an unowned row. Returns
 * the target table when an `.acrossTenants()` INSERT / REPLACE into a
 * tenant-scoped table does not name `tenant_id` in a column list (or has no
 * column list at all); `null` otherwise.
 */
export function acrossTenantInsertMissingTenantColumn(sqlContent: string, ctx: TenantContext): string | null {
  if (ctx.tenantScopedTables.size === 0) return null;
  const norm = normalizeSqlText(sqlContent);
  const leader = leaderOf(norm);
  if (leader !== "INSERT" && leader !== "REPLACE") return null;
  const target = /^(?:INSERT|REPLACE)(?:\s+OR\s+\w+)?\s+INTO\s+([A-Za-z_][A-Za-z0-9_]*)/i.exec(norm)?.[1];
  if (!target || !ctx.tenantScopedTables.has(target)) return null;
  const cols = /^(?:INSERT|REPLACE)(?:\s+OR\s+\w+)?\s+INTO\s+[A-Za-z_][A-Za-z0-9_]*\s*\(([^()]*)\)/i.exec(norm)?.[1];
  if (cols !== undefined && cols.split(",").map((c) => c.trim().toLowerCase()).includes(TENANT_COLUMN)) return null;
  return target;
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
 * The §14.8.10 E-TENANT-AGG message for one refused tenant-table read. Each
 * reason names the shape the floor cannot filter row by row and the way out.
 */
function tenantAggMessage(
  scoping: { table: string; reason: string; detail?: string },
  dispQ: string,
): string {
  const optOut = `or mark the query \`.acrossTenants()\` for a deliberate cross-tenant read`;
  const head = `E-TENANT-AGG: \`${dispQ}\` reads the tenant-scoped table \`${scoping.table}\``;
  switch (scoping.reason) {
    case "subquery":
      return `${head} through a subquery, CTE or derived table, which can fold several tenants' rows into one ` +
        `result row before the tenant floor filters it (§14.8.10). Resolution: read the tenant-scoped table at the ` +
        `top level of the query (FROM / JOIN), ${optOut}.`;
    case "setop":
      return `${head} through UNION / INTERSECT / EXCEPT, whose result rows the floor cannot attribute to one ` +
        `source (§14.8.10). Resolution: run each SELECT as its own query, ${optOut}.`;
    case "window":
      return `${head} with a window function (\`OVER\`), which reads OTHER rows of the result — including other ` +
        `tenants' rows — into each row before the floor filters it (§14.8.10). Resolution: compute it over the ` +
        `filtered rows in server code, ${optOut}.`;
    case "function":
      return `${head} and calls \`${scoping.detail ?? "?"}\`, which is not on the floor's per-row function allow-list ` +
        `(${[...TENANT_ROW_FUNCTIONS].join(", ")}). An aggregate (or any function the floor cannot prove reads one ` +
        `row) can fold several tenants into one value (§14.8.10). Resolution: add \`GROUP BY tenant_id\` so each ` +
        `result row is one tenant's group, compute it over the filtered rows in server code, ${optOut}.`;
    case "reserved":
      return `${head} and names the floor's reserved key alias \`__scrml_tenant_…\`, which the source filter reads ` +
        `the row's tenant from (§14.8.10). Resolution: rename that column.`;
    default:
      return `${head} with GROUP BY / HAVING / DISTINCT but does not group by the \`tenant_id\` of every ` +
        `tenant-scoped source, so one result row can hold several tenants (§14.8.10). Resolution: add ` +
        `\`GROUP BY tenant_id\` (\`<alias>.tenant_id\` for each tenant table in a JOIN), ${optOut}.`;
  }
}

/**
 * The §14.8.10 compile-time refusal for one `?{}` query, or null. Decided at the
 * ONE choke every lowering passes through (`_lowerTenantForQuery`), so it covers
 * every SQL spelling (`?{\`…\`}` and `?{ … }` alike) — a source-text scan over
 * one spelling was how `?{ update assets … }` reached the database unconstrained.
 *   - `.acrossTenants()`: only an INSERT that omits the tenant column is refused.
 *   - otherwise: a refused read (E-TENANT-AGG) or a non-injectable write (E-TENANT-WRITE).
 */
export function tenantFloorViolation(
  sqlContent: string,
  isAcross: boolean,
  ctx: TenantContext,
): { code: "E-TENANT-AGG" | "E-TENANT-WRITE"; message: string } | null {
  if (ctx.tenantScopedTables.size === 0) return null;
  const dispQ = sqlContent.trim().replace(/\s+/g, " ").slice(0, 60);
  if (isAcross) {
    const table = acrossTenantInsertMissingTenantColumn(sqlContent, ctx);
    if (table === null) return null;
    return {
      code: "E-TENANT-WRITE",
      message:
        `E-TENANT-WRITE: the \`.acrossTenants()\` INSERT into the tenant-scoped table \`${table}\` in ` +
        `\`${dispQ}\` does not name the \`tenant_id\` column. An opted-out query gets no tenant injected, so ` +
        `this would write a row no tenant owns (§14.8.10). Resolution: name the column and its value — ` +
        `\`INSERT INTO ${table} (…, tenant_id) VALUES (…, \${tenant})\` — or drop \`.acrossTenants()\` ` +
        `to have the request's tenant injected.`,
    };
  }
  const write = classifyTenantWrite(sqlContent, ctx);
  if (write && write.kind === "hard-fail") {
    const why = write.op === "UPDATE" || write.op === "DELETE"
      ? "An UPDATE/DELETE needs a WHERE constraint the V1 floor does not parse"
      : "This INSERT is not safely tenant-injectable (it sets tenant_id itself, is multi-row, reads rows in its values, is INSERT ... SELECT, or names the table in a form the floor cannot rewrite)";
    return {
      code: "E-TENANT-WRITE",
      message:
        `E-TENANT-WRITE: a ${write.op} against the tenant-scoped table \`${write.table}\` in \`${dispQ}\` ` +
        `cannot be tenant-constrained by the V1 floor (a committed cross-tenant write is durable before any ` +
        `filter could run). ${why} (§14.8.10). Resolution: for a per-tenant INSERT, write the plain ` +
        `\`INSERT INTO t (cols) VALUES (vals)\` without \`tenant_id\` (the floor injects the request's tenant); for a ` +
        `deliberate cross-tenant write, mark the query \`.acrossTenants()\`.`,
    };
  }
  const scoping = resolveTenantScoping(sqlContent, ctx);
  if (scoping && scoping.kind === "agg") return { code: "E-TENANT-AGG", message: tenantAggMessage(scoping, dispQ) };
  return null;
}

/** Is this `.acrossTenants()` query one the tenant floor would otherwise have scoped or refused (the I-TENANT-ACROSS audit)? */
export function tenantAcrossIsAudited(sqlContent: string, ctx: TenantContext): boolean {
  return resolveTenantScoping(sqlContent, ctx) !== null || classifyTenantWrite(sqlContent, ctx) !== null;
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
  "// THE WRITE KEY. An INSERT into a tenant-scoped table gets the active tenant",
  "// injected into its tenant_id column. With NO active tenant (an unpinned request,",
  "// boot code, a scheduled job, a server function reached outside a request) the",
  "// write is REFUSED, by name: writing it with a NULL tenant would store a row no",
  "// tenant owns. The deliberate way to write outside a request is an",
  "// .acrossTenants() INSERT that names its tenant_id column explicitly.",
  "function _scrml_tenant_write_key() {",
  "  const _k = _scrml_tenant_source_key();",
  "  if (_k == null) {",
  "    throw new Error(",
  "      \"E-TENANT-WRITE (runtime): an INSERT into a tenant-scoped table ran with no active \" +",
  "      \"tenant (no request in scope, or the request has no pinned @currentUser.tenantId), \" +",
  "      \"so the \\u00a714.8.10 floor has no tenant to write it under. Refusing the write. \" +",
  "      \"To write outside a request, mark the query .acrossTenants() and name the tenant \" +",
  "      \"column explicitly: INSERT INTO t (..., tenant_id) VALUES (..., ${tenant}).\",",
  "    );",
  "  }",
  "  return _k;",
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
