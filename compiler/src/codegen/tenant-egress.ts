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

import { normalizeSqlText } from "../sql-projection.ts";
import type { ProtectContext } from "./protect-egress.ts";
import { extractDesiredSchema } from "./db-authoritative.ts";
import { fileSchemaTenantNames, compilationSchemaColumns, schemaColumnKnowledge, tenantQueryQualifiedRefIssue } from "../tenant-schema-hazards.ts";
import { resolveDbScopes } from "../db-ownership.ts";
import { getNodes } from "./collect.ts";
import { resolveDbDriver } from "./db-driver.ts";
import {
  analyzeTenantSql,
  tenantTableMentioned,
  lexTenantSubset,
  topLevelFromOffset,
  addKeyColumnsBeforeFrom,
  injectInsertTenant,
  injectWriteTenantFilter,
  TENANT_ROW_FUNCTIONS,
  tenantRowFunctions,
  tenantGroupAggregates,
  type SqlDialect,
  type TenantAnalysis,
} from "./tenant-sql-subset.ts";

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
  /**
   * S452 r4 — per tenant-scoped table (lowercased), the `<schema>`-declared
   * objects that turn ONE write into further, unanalysed writes: triggers, rules,
   * and foreign keys with a CASCADE / SET NULL / SET DEFAULT action that this
   * table's writes fire. A tenant write to such a table is refused (E-TENANT-WRITE)
   * — the floor constrains the statement, not what the database runs because of it.
   * Only what `<schema>` declares is visible: a trigger created outside it (an
   * external database, a `<db src>` with no schema) is not.
   */
  writeHazards?: Map<string, string[]>;
  /** S452 r4 — the driver of a SQL handle (`_scrml_sql`, …), for dialect-specific injection. */
  driverFor?: (dbVar: string) => string | undefined;
  /** S455 — the compilation's dialect (`compilationDialect`): the allow-lists are its built-ins. */
  dialect?: SqlDialect;
  /** S455 — the declared columns a qualified `rel.f` in a tenant query must name (`CompilationTenantSet.columns`). */
  columns?: ReadonlyMap<string, ReadonlySet<string>>;
}

/** The last part of a possibly-qualified, possibly-quoted SQL name, lowercased. */
function bareName(name: string): string {
  const parts = name.split(".");
  return parts[parts.length - 1].replace(/^["`[]|["`\]]$/g, "").toLowerCase();
}

/**
 * Read the write hazards a `<schema>` body declares (see `TenantContext.writeHazards`).
 * TEXTUAL and deliberately over-inclusive: a hazard the reader cannot attribute
 * to a table is attributed to EVERY tenant-scoped table (fail-closed), and a
 * commented-out declaration still counts.
 */
export function schemaWriteHazards(schemaText: string, tenantTables: Set<string>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const add = (table: string | null, what: string): void => {
    const targets = table === null ? [...tenantTables] : [table];
    for (const t of targets) {
      if (!tenantTables.has(t)) continue;
      const key = t.toLowerCase();
      const list = out.get(key) ?? [];
      if (!list.includes(what)) list.push(what);
      out.set(key, list);
    }
  };
  const text = typeof schemaText === "string" ? schemaText : "";
  const NAME = `("[^"]+"|\`[^\`]+\`|\\[[^\\]]+\\]|[A-Za-z_][\\w$]*(?:\\.[A-Za-z_][\\w$]*)?)`;
  // Triggers (SQLite / Postgres): `TRIGGER name … ON table`.
  let attributedTriggers = 0;
  const trigRe = new RegExp(`\\bTRIGGER\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${NAME}[\\s\\S]*?\\bON\\s+${NAME}`, "gi");
  for (const m of text.matchAll(trigRe)) {
    attributedTriggers++;
    add(bareName(m[2]), `trigger \`${bareName(m[1])}\``);
  }
  const triggerWords = (text.match(/\bTRIGGER\b/gi) ?? []).length;
  if (triggerWords > attributedTriggers) add(null, "a trigger the floor could not attribute to a table");
  // Postgres rules: `RULE name AS ON event TO table`.
  let attributedRules = 0;
  const ruleRe = new RegExp(`\\bRULE\\s+${NAME}\\s+AS\\s+ON\\s+\\w+\\s+TO\\s+${NAME}`, "gi");
  for (const m of text.matchAll(ruleRe)) {
    attributedRules++;
    add(bareName(m[2]), `rule \`${bareName(m[1])}\``);
  }
  if ((text.match(/\bCREATE\s+(?:OR\s+REPLACE\s+)?RULE\b/gi) ?? []).length > attributedRules) {
    add(null, "a rule the floor could not attribute to a table");
  }
  // Foreign-key actions fire on writes to the REFERENCED (parent) table.
  const ACTION = /\bON\s+(?:DELETE|UPDATE)\s+(?:CASCADE|SET\s+NULL|SET\s+DEFAULT)\b/gi;
  let attributedActions = 0;
  const fkRe = new RegExp(`\\bREFERENCES\\s+${NAME}\\s*(?:\\([^)]*\\))?((?:\\s+(?:ON\\s+(?:DELETE|UPDATE)\\s+(?:CASCADE|SET\\s+NULL|SET\\s+DEFAULT|NO\\s+ACTION|RESTRICT)|MATCH\\s+\\w+|NOT\\s+DEFERRABLE|DEFERRABLE|INITIALLY\\s+\\w+))*)`, "gi");
  for (const m of text.matchAll(fkRe)) {
    // ACTION is /g: String.prototype.match returns null or a NON-EMPTY array.
    const actions = m[2].match(ACTION);
    if (!actions) continue;
    attributedActions += actions.length;
    add(bareName(m[1]), `a foreign key with \`${actions[0].replace(/\s+/g, " ").toUpperCase()}\` referencing it`);
  }
  if ((text.match(ACTION) ?? []).length > attributedActions) {
    add(null, "a foreign-key action (CASCADE / SET NULL / SET DEFAULT) the floor could not attribute to a table");
  }
  return out;
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
  schemaText?: string,
  driverFor?: (dbVar: string) => string | undefined,
  compilation?: CompilationTenantSet,
): TenantContext {
  const tenantScopedTables = new TenantTableSet();
  addRegistryTenantTables(tenantScopedTables, protectCtx);
  addSchemaTenantTables(tenantScopedTables, schemaTables);
  // §14.8.10 (S455) — the compilation's ONE tenant set (see `compilationTenantSet`).
  // It is computed by the same reading over every file compiled together, so it
  // already holds this file's own tables; the file's own reading above is kept so
  // a caller can never NARROW the floor by passing a stale set.
  if (compilation) for (const t of compilation.tables) tenantScopedTables.add(t);
  const dialect: SqlDialect = compilation?.dialect ?? "unknown";
  if (tenantScopedTables.size === 0) return { tenantScopedTables, dialect };
  // without the compilation's knowledge (a caller driving one file), this file's own
  // `<schema>` + desired tables + registry — the same reading, narrower
  const columns = compilation?.columns ??
    declaredColumns(schemaColumnKnowledge([schemaText ?? ""]), (schemaTables ?? []) as Array<{ name?: unknown; columns?: unknown }>, protectCtx);
  // The S452 r4 per-write limb keeps reading THIS file's `<schema>` text ("the
  // program's `<schema>`"): a hazard in any compiled file's `<schema>` is already
  // refused, compilation-wide, at the declaration (E-TENANT-SCHEMA-HAZARD), and
  // joining every file's text would only spread this regex reader's
  // unattributable over-fire across files.
  return { tenantScopedTables, writeHazards: schemaWriteHazards(schemaText ?? "", tenantScopedTables), driverFor, dialect, columns };
}

/**
 * The `<db tables=>` registry's tenant tables (`protectCtx.schemaByTable` — already
 * compilation-wide: the PA stage runs ONE analysis over every file).
 */
function addRegistryTenantTables(into: Set<string>, protectCtx: ProtectContext): void {
  for (const [table, cols] of protectCtx.schemaByTable) {
    if (cols.some((c) => c.toLowerCase() === TENANT_COLUMN)) into.add(table);
  }
}

/** ONE file's `<schema>`-declared tenant tables (`extractDesiredSchema(fileAST).tenantTables`). */
function addSchemaTenantTables(
  into: Set<string>,
  schemaTables?: Array<{ name?: unknown; columns?: unknown }>,
): void {
  for (const t of schemaTables ?? []) {
    if (typeof t?.name !== "string" || !Array.isArray(t?.columns)) continue;
    const carriesTenant = (t.columns as Array<{ name?: unknown }>).some(
      (c) => typeof c?.name === "string" && c.name.toLowerCase() === TENANT_COLUMN,
    );
    if (carriesTenant) into.add(t.name);
  }
}

/**
 * The compilation's ONE tenant set (§14.8.10, S455): every table tenant-scoped by
 * ANY file compiled together — whatever database each file names.
 *
 * ⚑ WHY ONE SET FOR THE WHOLE COMPILATION. Until S455 the floor built its set per
 * file, from that file's own `<schema>`. A project of two `<program>` files sharing a
 * database — `app.scrml` declaring `assets (…, tenant_id)`, `admin.scrml` with no
 * `<schema>` — emitted admin's `SELECT name FROM assets` UNFILTERED and served every
 * tenant's rows to a request pinned to one (executed, S455). Whether two files reach
 * one database cannot be decided from their `db=` strings (S455 #1313 review round
 * 4: a symlink, a `?mode=` URI, two `SCRML_DATA_DIR` roots, a hardlink or a
 * case-insensitive filesystem each make two spellings one file), so the set is the
 * union over every compiled file, any database. Accepted cost (SPEC §14.8.10): two
 * genuinely different databases compiled together share it.
 *
 * ⚑ ONE SOURCE OF TRUTH. `api.js` computes this ONCE (stage TENANT-SCHEMA) and hands
 * the SAME object to the `<schema>` declaration rule (`fileTenantSchemaHazards`) and
 * to codegen (`runCG` input `compilationTenant` → every file's `buildTenantContext`,
 * web app, headless and tool alike). `runCG` computes it with this same function only
 * when it is driven directly (unit tests) without one.
 *
 * The set is the `<db tables=>` registry's tenant tables, and per file the floor's
 * own `<schema>` reading (`addSchemaTenantTables`) UNION every `<schema>`
 * declaration that carries `tenant_id` (`fileSchemaTenantNames` — the recognizer
 * E-SCHEMA-015 reads, which also sees a `tenant_id` added by `ALTER TABLE`).
 */
export interface CompilationTenantSet {
  /** The tenant-scoped tables (case-insensitive membership; entries lowercased). */
  tables: ReadonlySet<string>;
  /**
   * The database every compiled file's handles resolve to (S455): `postgres` / `sqlite`
   * when ALL agree, else `unknown` (mixed, MySQL, unresolvable, none) — the function /
   * type allow-lists are that database's built-ins, `unknown` → the intersection.
   */
  dialect?: SqlDialect;
  /**
   * The columns the compilation DECLARES, per table (S455 `rel.f`, S239 r2 of 7761b813):
   * every `<schema>` (DSL, `CREATE TABLE`, `ALTER … ADD COLUMN`, an expanded `schemaFor`) read
   * fail-closed (`schemaColumnKnowledge`), then — for a table no `<schema>` declares — the
   * `<db tables=>` registry's columns. A qualified `rel.f` in a tenant query or a `<schema>`
   * body must name one of these. Present when the set has a tenant table.
   */
  columns?: ReadonlyMap<string, ReadonlySet<string>>;
}

/**
 * The declared columns (see `CompilationTenantSet.columns`): the `<schema>` reading first,
 * then the desired-schema tables and the registry for a table it does not hold.
 */
export function declaredColumns(
  schemaColumns: ReadonlyMap<string, ReadonlySet<string>>,
  desiredTables: Iterable<{ name?: unknown; columns?: unknown }>,
  protectCtx: ProtectContext | undefined,
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const [t, c] of schemaColumns) out.set(t, new Set(c));
  for (const t of desiredTables) {
    if (typeof t?.name !== "string" || !Array.isArray(t?.columns)) continue;
    const key = t.name.toLowerCase();
    if (out.has(key)) continue;
    out.set(key, new Set((t.columns as Array<{ name?: unknown }>).filter((c) => typeof c?.name === "string").map((c) => (c.name as string).toLowerCase())));
  }
  for (const [table, cols] of protectCtx?.schemaByTable ?? []) {
    const key = table.toLowerCase();
    if (!out.has(key)) out.set(key, new Set(cols.map((c) => c.toLowerCase())));
  }
  return out;
}

/**
 * The file-AST key `runCG` carries the compilation's set on (underscore-led: AST
 * walkers skip it). Read with `compilationTenantOf`.
 */
export const COMPILATION_TENANT_KEY = "_scrmlCompilationTenant";

/** The compilation's tenant set `runCG` attached to this file AST, if any. */
export function compilationTenantOf(fileAST: unknown): CompilationTenantSet | undefined {
  if (fileAST === null || typeof fileAST !== "object") return undefined;
  const v = (fileAST as Record<string, unknown>)[COMPILATION_TENANT_KEY] as CompilationTenantSet | undefined;
  return v && v.tables instanceof Set ? v : undefined;
}

export function compilationTenantSet(files: Iterable<unknown>, protectCtx: ProtectContext): CompilationTenantSet {
  const tables = new TenantTableSet();
  addRegistryTenantTables(tables, protectCtx);
  const list = [...files];
  const desired: Array<{ name?: unknown; columns?: unknown }> = [];
  for (const fileAST of list) {
    const ds = extractDesiredSchema(fileAST);
    addSchemaTenantTables(tables, ds.tenantTables);
    desired.push(...(ds.tables as Array<{ name?: unknown; columns?: unknown }>));
    for (const t of fileSchemaTenantNames(fileAST)) tables.add(t);
  }
  const columns = tables.size > 0 ? declaredColumns(compilationSchemaColumns(list), desired, protectCtx) : new Map<string, Set<string>>();
  return { tables, dialect: compilationDialect(list), columns };
}

/** The dialect a `db=` / `src=` value names (§44): a literal Postgres URI or SQLite target, else `unknown`. */
export function dialectOfDbValue(value: string): SqlDialect {
  if (typeof value !== "string" || /[{}]/.test(value)) return "unknown";   // an interpolated value is not a literal target
  const r = resolveDbDriver(value);
  if (!r.ok) return "unknown";
  return r.info.driver === "postgres" ? "postgres" : r.info.driver === "sqlite" ? "sqlite" : "unknown";
}

/**
 * The ONE dialect of a compilation: every database handle of every file (§8.1.1
 * `resolveDbScopes`) resolves to the same driver → that driver; otherwise (mixed,
 * MySQL, unresolvable, no handle at all) `unknown`, so only names built in on BOTH
 * databases are admitted (S455 review of ee1a80bc).
 */
export function compilationDialect(files: Iterable<unknown>): SqlDialect {
  const seen = new Set<SqlDialect>();
  for (const f of files) {
    const filePath = typeof (f as any)?.filePath === "string" && (f as any).filePath ? (f as any).filePath : null;
    let handles: Array<{ value: string }> = [];
    try { handles = resolveDbScopes(getNodes(f as any), filePath).handles; } catch { seen.add("unknown"); }
    for (const h of handles) seen.add(dialectOfDbValue(h.value));
  }
  return seen.size === 1 ? [...seen][0] : "unknown";
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
 *   - "subquery":  a subquery / CTE / derived table / `IN <table>` anywhere;
 *   - "setop":     UNION / INTERSECT / EXCEPT;
 *   - "reserved":  the author's SQL names the floor's reserved key alias.
 */
export type TenantRefusal = "aggregate" | "function" | "window" | "subquery" | "setop" | "reserved";

/**
 * The result of resolving a `?{}` read's tenant scoping:
 *   - `null`                    — no floor: not a read, or no tenant-scoped table
 *                                 is named. Lowered unchanged.
 *   - `{ kind: "read" }`        — a plain row read of tenant-scoped sources; filtered
 *                                 at the source. `keys` has ONE reserved-alias key
 *                                 column per tenant-scoped source (a row is kept iff
 *                                 every one matches).
 *   - `{ kind: "agg" }`         — refused → `E-TENANT-AGG` (see TenantRefusal).
 *   - `{ kind: "outside" }`     — names a tenant-scoped table but lies outside the
 *                                 floor's SQL subset → `E-TENANT-SQL-SUBSET`.
 *   - `{ kind: "unresolvable" }`— names a tenant-scoped table but not as a source
 *                                 the floor can key → ZERO rows at the source.
 */
export type TenantScoping =
  | { kind: "read"; table: string; keys: TenantKeyColumn[] }
  | { kind: "agg"; table: string; reason: TenantRefusal; detail?: string }
  | { kind: "outside"; table: string; detail: string }
  | { kind: "unresolvable" }
  | null;

/**
 * THE ONE DECISION (S452 r3). Every tenant check — scoping, injection, refusal,
 * the I-TENANT-ACROSS audit, the §8.10 hoist gate — derives from this reading
 * of the raw `?{}` body by the allow-listed SQL subset (`tenant-sql-subset.ts`),
 * so no two checks can read different queries.
 */
export function analyzeTenantQuery(sqlContent: string, ctx: TenantContext): TenantAnalysis {
  if (ctx.tenantScopedTables.size === 0) return null;
  const dialect = ctx.dialect ?? "unknown";
  const a = analyzeTenantSql(sqlContent, (n) => ctx.tenantScopedTables.has(n), ctx.tenantScopedTables, {
    writeHazards: (t) => ctx.writeHazards?.get(t.toLowerCase()),
    dialect,
  });
  if (a !== null && a.kind === "refuse") return a;
  // S455 `rel.f` (S239 r2 of 7761b813, executed on PG16: `SELECT assets.evil FROM assets` ran
  // a user `evil(assets)` and returned every tenant). ONE subset with the `<schema>` bodies:
  // a qualified reference in a tenant query — or in a query whose text names a tenant table —
  // must name a column the compilation declares on the relation it resolves to.
  const named = a !== null || [...ctx.tenantScopedTables].some((n) => new RegExp(`(?:^|[^A-Za-z0-9_])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[^A-Za-z0-9_]|$)`, "i").test(sqlContent));
  if (!named) return a;
  const cols = ctx.columns;
  const issue = tenantQueryQualifiedRefIssue(sqlContent, dialect, (rel) => cols?.get(rel) ?? null);
  if (issue === null) return a;
  const table = a !== null ? a.table : ([...ctx.tenantScopedTables].find((n) => sqlContent.toLowerCase().includes(n)) ?? "?");
  return { kind: "refuse", code: "E-TENANT-SQL-SUBSET", reason: "subset", table, op: "?", detail: issue };
}

/**
 * Does `?{}` SQL text touch a tenant-scoped table? Inside the subset, an
 * identifier decides; outside it, any whole-word occurrence anywhere does
 * (fail-closed). The gate for every path that cannot apply the row filter
 * itself (e.g. the §8.10 loop hoist refuses to hoist such a query).
 */
export function sqlMentionsTenantTable(sqlContent: string, ctx: TenantContext): boolean {
  return ctx.tenantScopedTables.size > 0 &&
    tenantTableMentioned(sqlContent, (n) => ctx.tenantScopedTables.has(n), ctx.tenantScopedTables) !== null;
}

export { TENANT_ROW_FUNCTIONS };

/** The reserved alias prefix of the floor's key columns (removed after the filter). */
export const TENANT_KEY_ALIAS_PREFIX = "__scrml_tenant_";

/** The key columns for a read's tenant sources: ONE reserved alias per source, always added. */
function keysFor(refs: string[]): TenantKeyColumn[] {
  // The author's projection is never trusted to carry the key (`SELECT *, 'A' AS
  // tenant_id` would forge it), and the alias cannot collide (an author naming
  // it is refused). Each is removed from the row after the filter.
  return refs.map((ref, i) => ({
    col: `${TENANT_KEY_ALIAS_PREFIX}${i}`,
    add: `${ref}.${TENANT_COLUMN} AS ${TENANT_KEY_ALIAS_PREFIX}${i}`,
  }));
}

/** Map one analysis to the read view (`null` for anything that is not a read). */
function scopingOf(a: TenantAnalysis): TenantScoping {
  if (a === null) return null;
  switch (a.kind) {
    case "read": return { kind: "read", table: a.table, keys: keysFor(a.refs) };
    case "unresolvable": return { kind: "unresolvable" };
    case "refuse":
      if (a.code === "E-TENANT-AGG") return { kind: "agg", table: a.table, reason: a.reason as TenantRefusal, detail: a.detail };
      if (a.code === "E-TENANT-SQL-SUBSET") return { kind: "outside", table: a.table, detail: a.detail };
      return null;
    default: return null;
  }
}

/** Resolve the tenant scoping a `?{}` READ carries (writes: `classifyTenantWrite`). */
export function resolveTenantScoping(sqlContent: string, ctx: TenantContext): TenantScoping {
  return scopingOf(analyzeTenantQuery(sqlContent, ctx));
}

/**
 * Rewrite a resolvable SELECT to ADD the key columns the source filter needs to
 * the projection (a deterministic projection-column add), just before the
 * top-level `FROM` token. Returns the original SQL unchanged when nothing is
 * added (if the FROM is not found the key columns are absent and the filter
 * keeps no row — fail-closed).
 */
export function rewriteSelectAddTenantId(sqlContent: string, scoping: TenantScoping): string {
  if (!scoping || scoping.kind !== "read") return sqlContent;
  const adds = scoping.keys.map((k) => k.add).filter((a): a is string => a !== null);
  const fromAt = topLevelFromOffset(sqlContent);
  if (adds.length === 0 || fromAt === -1) return sqlContent;
  return addKeyColumnsBeforeFrom(sqlContent, fromAt, adds);
}

/**
 * The result of classifying a `?{}` WRITE that touches a tenant-scoped table:
 *   - `null`                      — not a write, or no tenant-scoped table named.
 *   - `{ kind: "insert-inject" }` — a single-row INSERT; `tenant_id` is injected.
 *   - `{ kind: "filter-inject" }` — an UPDATE / DELETE; `tenant_id = <active
 *                                   tenant>` is ANDed onto its WHERE.
 *   - `{ kind: "hard-fail" }`     — anything else → `E-TENANT-WRITE`.
 * (A write outside the SQL subset is `E-TENANT-SQL-SUBSET` — see tenantFloorViolation.)
 */
export type TenantWrite =
  | { kind: "insert-inject"; table: string }
  | { kind: "filter-inject"; table: string; op: "UPDATE" | "DELETE" }
  | { kind: "hard-fail"; table: string; op: string }
  | null;

export function classifyTenantWrite(sqlContent: string, ctx: TenantContext): TenantWrite {
  const a = analyzeTenantQuery(sqlContent, ctx);
  if (a === null) return null;
  if (a.kind === "insert") return { kind: "insert-inject", table: a.table };
  if (a.kind === "filtered-write") return { kind: "filter-inject", table: a.table, op: a.op };
  if (a.kind === "refuse" && a.code === "E-TENANT-WRITE") return { kind: "hard-fail", table: a.table, op: a.op };
  return null;
}

/**
 * An `.acrossTenants()` INSERT is the sole way to write a tenant-scoped row
 * outside a request (§14.8.10, ruling user-voice-scrml.md S452 "your rec"), and
 * it must NAME the tenant column — the floor injects nothing into an opted-out
 * query, so an omitted `tenant_id` would silently write an unowned row. Returns
 * the target table when an `.acrossTenants()` INSERT / REPLACE into a
 * tenant-scoped table does not name `tenant_id` in a column list (or has no
 * column list at all); `null` otherwise. Read over the subset tokens; a body
 * outside the subset falls back to the text reading (fail-closed: a quoted
 * `"tenant_id"` there does not count as naming it).
 */
export function acrossTenantInsertMissingTenantColumn(sqlContent: string, ctx: TenantContext): string | null {
  if (ctx.tenantScopedTables.size === 0) return null;
  const lex = lexTenantSubset(sqlContent);
  if (lex.ok) {
    const t = lex.toks;
    if (!(t[0]?.kind === "ident" && (t[0].up === "INSERT" || t[0].up === "REPLACE"))) return null;
    const into = t.findIndex((x) => x.kind === "ident" && x.up === "INTO");
    const target = into === -1 ? undefined : t[into + 1];
    if (!target || target.kind !== "ident" || !ctx.tenantScopedTables.has(target.text)) return null;
    const open = t[into + 2];
    if (open && open.kind === "punct" && open.text === "(") {
      for (let k = into + 3; k < t.length && !(t[k].kind === "punct" && t[k].text === ")"); k++) {
        if (t[k].kind === "ident" && t[k].text.toLowerCase() === TENANT_COLUMN) return null;
      }
    }
    return target.text;
  }
  const norm = normalizeSqlText(sqlContent);
  const head = /^(?:INSERT|REPLACE)(?:\s+OR\s+\w+)?\s+INTO\s+([A-Za-z_][A-Za-z0-9_]*)/i.exec(norm);
  if (!head || !ctx.tenantScopedTables.has(head[1])) return null;
  const cols = /^(?:INSERT|REPLACE)(?:\s+OR\s+\w+)?\s+INTO\s+[A-Za-z_][A-Za-z0-9_]*\s*\(([^()]*)\)/i.exec(norm)?.[1];
  if (cols !== undefined && cols.split(",").map((c) => c.trim().toLowerCase()).includes(TENANT_COLUMN)) return null;
  return head[1];
}

/** The INSERT's target name (token after INTO) when the body lexes; used to analyse without a context. */
function insertTargetOf(sqlContent: string): string | null {
  const lex = lexTenantSubset(sqlContent);
  if (!lex.ok) return null;
  const into = lex.toks.findIndex((x) => x.kind === "ident" && x.up === "INTO");
  const t = into === -1 ? undefined : lex.toks[into + 1];
  return t && t.kind === "ident" ? t.text : null;
}

/**
 * S452 r4 — does a tenant write on handle `dbVar` take SQLite's statement-level
 * `OR ABORT` (see `injectInsertTenant`)? Postgres and MySQL have no table-level
 * conflict resolution — a constraint violation always aborts the statement there,
 * and their statement-level upserts (`ON CONFLICT`, `ON DUPLICATE KEY`) are
 * outside the subset — and both REJECT `INSERT OR ABORT` as a syntax error. A
 * handle whose driver is unknown is treated as SQLite: on another database that
 * fails the statement (closed), never the reverse.
 */
function sqliteDialect(ctx: TenantContext | undefined, dbVar: string | undefined): boolean {
  const driver = ctx?.driverFor && dbVar ? ctx.driverFor(dbVar) : undefined;
  return driver === undefined || driver === "sqlite";
}

/**
 * Rewrite an injectable INSERT to add `tenant_id` to its column-set with the
 * ambient tenant value bound as a param expression `${<ambientExpr>}` (and, on
 * SQLite, `OR ABORT`). Only touches the single-row subset shape; anything else
 * is returned unchanged.
 */
export function rewriteInsertAddTenantId(sqlContent: string, ambientExpr: string, ctx?: TenantContext, dbVar?: string): string {
  // With the context: the SAME analysis `classifyTenantWrite` read. Without it
  // (a standalone rewrite), the target is the only tenant table considered.
  let a: TenantAnalysis;
  if (ctx) {
    a = analyzeTenantQuery(sqlContent, ctx);
  } else {
    const target = insertTargetOf(sqlContent);
    if (target === null) return sqlContent;
    a = analyzeTenantSql(sqlContent, (n) => n.toLowerCase() === target.toLowerCase(), [target]);
  }
  if (!a || a.kind !== "insert") return sqlContent;
  return injectInsertTenant(sqlContent, a.colsClose, a.valsClose, ambientExpr,
    sqliteDialect(ctx, dbVar) ? a.leaderEnd : null);
}

/**
 * Constrain a subset UPDATE / DELETE against a tenant-scoped table to the active
 * tenant (`… WHERE (<author's condition>) AND tenant_id = ${<ambientExpr>}`; a
 * SQLite UPDATE also gets `OR ABORT`). Returns the SQL unchanged unless
 * `classifyTenantWrite` reads it as `filter-inject`.
 */
export function rewriteWriteAddTenantFilter(sqlContent: string, ambientExpr: string, ctx: TenantContext, dbVar?: string): string {
  const a = analyzeTenantQuery(sqlContent, ctx);
  if (!a || a.kind !== "filtered-write") return sqlContent;
  return injectWriteTenantFilter(sqlContent, a.whereEnd, ambientExpr,
    a.op === "UPDATE" && sqliteDialect(ctx, dbVar) ? a.leaderEnd : null);
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
      return `${head} through a subquery, CTE, derived table or \`IN <table>\` (${scoping.detail ?? "?"}), which can fold several tenants' rows into one ` +
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
        `(${[...tenantRowFunctions("unknown")].join(", ")}; on SQLite also ` +
        `${[...tenantRowFunctions("sqlite")].filter((f) => !tenantRowFunctions("unknown").has(f)).join(", ")} — a name is ` +
        `allowed only where it is a BUILT-IN of the database the query runs on). An aggregate (or any function the floor cannot prove reads one ` +
        `row) can fold several tenants into one value (§14.8.10). Under \`GROUP BY tenant_id\` the aggregates ${[...tenantGroupAggregates("sqlite")].join(", ")} are also allowed (\`total\` on SQLite only), nothing else. Resolution: add \`GROUP BY tenant_id\` so each ` +
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

/** The §14.8.10 codes a tenant-table query can be refused with at compile time. */
export type TenantViolationCode = "E-TENANT-AGG" | "E-TENANT-WRITE" | "E-TENANT-SQL-SUBSET";

/**
 * The §14.8.10 compile-time refusal for one `?{}` query, or null. Decided at the
 * ONE choke every lowering passes through (`_lowerTenantForQuery`), so it covers
 * every SQL spelling (`?{\`…\`}` and `?{ … }` alike), and from the ONE analysis
 * (`analyzeTenantQuery`) the lowering itself uses.
 *   - `.acrossTenants()`: only an INSERT that omits the tenant column is refused.
 *   - otherwise: a query outside the floor's SQL subset (E-TENANT-SQL-SUBSET), a
 *     refused read (E-TENANT-AGG), or a non-injectable write (E-TENANT-WRITE).
 */
export function tenantFloorViolation(
  sqlContent: string,
  isAcross: boolean,
  ctx: TenantContext,
): { code: TenantViolationCode; message: string } | null {
  if (ctx.tenantScopedTables.size === 0) return null;
  const dispQ = sqlContent.trim().replace(/\s+/g, " ").slice(0, 60);
  const optOut = "mark the query `.acrossTenants()` for a deliberate cross-tenant query";
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
  const a = analyzeTenantQuery(sqlContent, ctx);
  if (a === null || a.kind !== "refuse") return null;
  if (a.code === "E-TENANT-SQL-SUBSET") {
    return {
      code: "E-TENANT-SQL-SUBSET",
      message:
        `E-TENANT-SQL-SUBSET: \`${dispQ}\` names the tenant-scoped table \`${a.table}\` but is outside the SQL ` +
        `subset the tenant floor can read exactly: ${a.detail}. The floor scopes a tenant query only when every ` +
        `token is one it knows — unquoted identifiers, numbers, plain '…' literals (no backslash), \`\${…}\` ` +
        `parameters (no brace, backtick, slash or backslash inside, quotes only as plain strings), the operators ( ) , . * = <> != < > <= >= ` +
        `+ - / % || — in ONE SELECT / INSERT / UPDATE / DELETE statement; anything else (a quoted name, a comment, ` +
        `a \`;\`, a dialect-specific literal, another statement kind) could be read differently by the database ` +
        `(§14.8.10). Resolution: write the query in that subset, or ${optOut}.`,
    };
  }
  if (a.code === "E-TENANT-AGG") {
    return { code: "E-TENANT-AGG", message: tenantAggMessage({ table: a.table, reason: a.reason, detail: a.detail }, dispQ) };
  }
  return {
    code: "E-TENANT-WRITE",
    message:
      `E-TENANT-WRITE: a ${a.op} against the tenant-scoped table \`${a.table}\` in \`${dispQ}\` cannot be ` +
      `tenant-constrained by the floor (a committed cross-tenant write is durable before any filter could run): ` +
      `${a.detail} (§14.8.10). Resolution: write the plain \`INSERT INTO t (cols) VALUES (vals)\` without ` +
      `\`tenant_id\`, \`UPDATE t SET col = … WHERE …\` or \`DELETE FROM t WHERE …\` (the floor injects the ` +
      `request's tenant), or ${optOut}.`,
  };
}

/** Is this `.acrossTenants()` query one the tenant floor would otherwise have scoped or refused (the I-TENANT-ACROSS audit)? */
export function tenantAcrossIsAudited(sqlContent: string, ctx: TenantContext): boolean {
  return analyzeTenantQuery(sqlContent, ctx) !== null;
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
  "const _SCRML_TENANT = _scrml_g.Symbol.for(\"scrml.tenant.origin\");",
  "function _scrml_active_tenant(req) {",
  "  if (req == null) return null;",
  "  const _cu = (typeof _scrml_current_user === \"function\") ? _scrml_current_user(req) : null;",
  "  return _cu ? (_cu.tenantId ?? null) : null;",
  "}",
  "// The request a query runs for. Server functions called in-process (a peer",
  "// callable) have no request parameter, so the request is carried in an",
  "// AsyncLocalStorage opened around every route handler (installed at the end of",
  "// this module) rather than read from a lexical `_scrml_req`.",
  "const _scrml_tenant_req_als = (_scrml_g.__scrml_tenant_req_als ??= new (_scrml_g.process.getBuiltinModule(\"node:async_hooks\").AsyncLocalStorage)());",
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
  "// injected into its tenant_id column; an UPDATE / DELETE gets `AND tenant_id =`",
  "// the active tenant on its WHERE. With NO active tenant (an unpinned request,",
  "// boot code, a scheduled job, a server function reached outside a request) the",
  "// write is REFUSED, by name: writing it with a NULL tenant would store a row no",
  "// tenant owns. The deliberate way to write outside a request is an",
  "// .acrossTenants() INSERT that names its tenant_id column explicitly.",
  "function _scrml_tenant_write_key() {",
  "  const _k = _scrml_tenant_source_key();",
  "  if (_k == null) {",
  "    throw new _scrml_g.Error(",
  "      \"E-TENANT-WRITE (runtime): a write (INSERT / UPDATE / DELETE) to a tenant-scoped table ran with no active \" +",
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
  "  const _caps = (_cu && _scrml_g.Array.isArray(_cu.caps)) ? _cu.caps : [];",
  "  return _scrml_g.JSON.stringify(_caps);",
  "}",
  "// THE MARK MUST STICK, AND SILENCE IS NOT PROOF THAT IT DID. Attaching the",
  "// descriptor is a plain property write, and a plain property write to a FROZEN,",
  "// SEALED or preventExtensions object is a SILENT no-op outside strict mode (and",
  "// a TypeError inside it — this module is an ES module, so always strict). Both",
  "// paths route to one refusal: the floor never reports a success it did not",
  "// achieve. Not reachable from correct emission (the scope wraps the RAW driver",
  "// result, and no author code runs between the await and the scope).",
  "function _scrml_tenant_refuse_untaggable() {",
  "  throw new _scrml_g.Error(",
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
  "  if (row == null || typeof row !== \"object\" || _scrml_g.Array.isArray(row)) return false;",
  "  for (const c of keyCols) {",
  "    const v = row[c];",
  "    if (v == null || _scrml_g.String(v) !== _scrml_g.String(tenantKey)) return false;",
  "  }",
  "  return true;",
  "}",
  "// A surviving row loses the key columns the floor ADDED to the projection (the",
  "// program sees exactly the columns it asked for) and is marked with the tenant it",
  "// was admitted for — the egress re-check compares that mark, not a column.",
  "function _scrml_tenant_admit(row, addedCols, tenantKey) {",
  "  for (const c of addedCols) delete row[c];",
  "  _scrml_tenant_mark(row, { tenant: _scrml_g.String(tenantKey) });",
  "  return row;",
  "}",
  "// THE SOURCE FILTER. `rows` is the driver's result array; it is compacted IN PLACE",
  "// so the driver's array type and its row `count` survive (and `count` is",
  "// corrected — left alone it would still count every tenant's rows). `.get()`",
  "// takes its first row AFTER this, so a lookup of another tenant's row is `not`.",
  "function _scrml_tenant_scope(rows, keyCols, addedCols) {",
  "  if (rows == null) return rows;",
  "  const tenantKey = _scrml_tenant_source_key();",
  "  if (!_scrml_g.Array.isArray(rows)) {",
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
  "  if (!_scrml_g.Array.isArray(rows)) return null;",
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
  "  if (typeof _scrml_g.Response !== \"undefined\" && v instanceof _scrml_g.Response) return true;",
  "  if (typeof _scrml_g.Blob !== \"undefined\" && v instanceof _scrml_g.Blob) return true;",
  "  if (typeof _scrml_g.ReadableStream !== \"undefined\" && v instanceof _scrml_g.ReadableStream) return true;",
  "  if (typeof _scrml_g.ArrayBuffer !== \"undefined\" && (v instanceof _scrml_g.ArrayBuffer || _scrml_g.ArrayBuffer.isView(v))) return true;",
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
  "  throw new _scrml_g.Error(",
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
  "  if (_scrml_g.Array.isArray(value)) {",
  "    const out = [];",
  "    for (const el of value) {",
  "      const d = (el != null && typeof el === \"object\") ? el[_SCRML_TENANT] : null;",
  "      if (d) {",
  "        if (_scrml_tenant_opaque(el)) _scrml_tenant_refuse_opaque();",
  "        if (tenantKey == null || d.tenant !== _scrml_g.String(tenantKey)) continue;",
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
  "    if (tenantKey == null || d.tenant !== _scrml_g.String(tenantKey)) return null;",
  "    return value;",
  "  }",
  "  // UNmarked and opaque: not a tenant-scoped value, and rebuilding it as a",
  "  // plain object would destroy it. Passed through unchanged — this is the",
  "  // shipped binary/PDF egress path (§12.5).",
  "  if (_scrml_tenant_opaque(value)) return value;",
  "  const out = {};",
  "  for (const k of _scrml_g.Object.keys(value)) out[k] = _scrml_tenant_redact(value[k], tenantKey);",
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
  return rowsExpr; // "agg" / "outside" carry no filter — they hard-fail at compile.
}
