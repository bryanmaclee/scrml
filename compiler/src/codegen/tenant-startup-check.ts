/**
 * §14.8.10 (S456) — the built server's startup check for UNDECLARED tenant tables.
 *
 * Ruling (user-voice-scrml.md S456, "b, startup check lands with it"): a table carrying a
 * `tenant_id` column that is NOT in the compilation's tenant set (no `<schema>` declares
 * it, no `<db src=… tables=…>` registry lists it) is REFUSED where the compiler can see
 * it (`E-TENANT-UNDECLARED`, compiler/src/tenant-undeclared.ts) and CHECKED AT STARTUP
 * where it cannot — a Postgres / MySQL database, a `<program db=>` SQLite file the
 * compile never opens, a database seeded after the build. The floor scopes reads by the
 * compiled set, so such a table's rows would reach every request unscoped.
 *
 * Two halves:
 *
 *   1. Each server module that declares a database handle exports
 *      `_scrml_tenant_startup_check = { undeclared() }` (emitted here, wired by
 *      `emit-server.ts`). `undeclared()` asks each of the module's handles which
 *      relations carry a `tenant_id` column — SQLite `sqlite_master` ×
 *      `pragma_table_info`, Postgres `pg_catalog`, MySQL `information_schema` — and
 *      returns every one whose name is not in the tenant set compiled into the module.
 *      A database it cannot inspect is returned too (`error`), never treated as clean.
 *
 *   2. `scrml build`'s `_server.js` (commands/build.js `generateServerEntry`) runs every
 *      module's check before it answers any request. While one reports anything, every
 *      request except `/_scrml/health` answers 503, `/_scrml/health` answers 503 (and
 *      re-runs the check, so fixing the database clears it without a restart), and each
 *      finding is printed once to the server log — the §47.14 referenced-database
 *      startup family (`E-DEPLOY-DB-TENANT-UNDECLARED`).
 *
 * Matching is case-insensitive on the relation's own name (SQLite identifiers are
 * case-insensitive; the compiled set is lowercased — `TenantTableSet`). Views count: a
 * view whose rows carry `tenant_id` is read by the floor exactly like a table, so an
 * undeclared one is the same unscoped read (PA reading, S456).
 */

import { redactDbUri } from "../db-uri-redact.ts";

/** The export name `_server.js` imports (commands/build.js `describeServerUnit`). */
export const TENANT_STARTUP_CHECK_EXPORT = "_scrml_tenant_startup_check";

/** One database handle a server module declares, as the startup check reads it. */
export interface TenantCheckHandle {
  /** The emitted handle identifier (`_scrml_sql`, `_scrml_sql_1`, …). */
  ident: string;
  driver: "sqlite" | "postgres" | "mysql";
  /** The `db=` / `src=` value as written — displayed with its secrets redacted. */
  connection: string;
}

/**
 * The runtime helper. A function declaration (hoisted), so the module export below can
 * be appended anywhere after the handle declarations.
 */
export const TENANT_UNDECLARED_HELPER_LINES: readonly string[] = Object.freeze([
  "// §14.8.10 (S456) — which relations in each database carry a `tenant_id` column that",
  "// this build does not declare tenant-scoped. The tenant floor scopes reads by the",
  "// compiled set, so such a table's rows would reach every request unscoped: the built",
  "// server (_server.js) refuses to serve while this returns anything. A database it",
  "// cannot inspect is reported too — never treated as clean.",
  "async function _scrml_tenant_undeclared_in(handles, declared) {",
  "  const found = [];",
  "  for (const h of handles) {",
  "    let rows;",
  "    try {",
  "      if (h.driver === \"sqlite\") {",
  "        // pragma_table_xinfo, not _info: generated and hidden columns (an fts4 languageid=) count.",
  "        rows = await h.handle`SELECT m.name AS name FROM sqlite_master m, pragma_table_xinfo(m.name) p WHERE m.type IN ('table', 'view') AND substr(m.name, 1, 7) <> 'sqlite_' AND lower(p.name) = 'tenant_id'`;",
  "      } else if (h.driver === \"postgres\") {",
  "        // pg_catalog, not information_schema: the latter lists only what the current role may read.",
  "        rows = await h.handle`SELECT n.nspname AS sch, c.relname AS name FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid = a.attrelid JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE lower(a.attname) = 'tenant_id' AND a.attnum > 0 AND NOT a.attisdropped AND c.relkind IN ('r', 'p', 'v', 'm', 'f') AND NOT c.relispartition AND n.nspname <> 'information_schema' AND left(n.nspname, 3) <> 'pg_'`;",
  "      } else {",
  "        rows = await h.handle`SELECT table_schema AS sch, table_name AS name FROM information_schema.columns WHERE table_schema = DATABASE() AND lower(column_name) = 'tenant_id'`;",
  "      }",
  "    } catch (e) {",
  "      found.push({ db: h.label, table: null, error: String((e && e.message) || e) });",
  "      continue;",
  "    }",
  "    for (const r of rows) {",
  "      const name = String(r.name);",
  "      if (declared.has(name.toLowerCase())) continue;",
  "      found.push({ db: h.label, table: r.sch ? `${r.sch}.${name}` : name, error: null });",
  "    }",
  "  }",
  "  return found;",
  "}",
]);

/** The display label of one database in a server-log line: the `db=` value, secrets redacted. */
export function tenantCheckLabel(connection: string): string {
  return redactDbUri(connection);
}

/**
 * The module export `_server.js` runs: the helper above plus
 * `export const _scrml_tenant_startup_check = { undeclared() }` over `handles`, with the
 * compilation's tenant set baked in. Returns no lines when the module has no handle.
 */
export function tenantStartupCheckLines(
  handles: readonly TenantCheckHandle[],
  declaredTenantTables: Iterable<string>,
): string[] {
  if (handles.length === 0) return [];
  const declared = [...new Set([...declaredTenantTables].map((t) => t.toLowerCase()))].sort();
  const lines: string[] = [];
  lines.push("");
  lines.push(...TENANT_UNDECLARED_HELPER_LINES);
  lines.push("// The tables this compilation declares tenant-scoped (§14.8.10: `<schema>` + `<db tables=>`).");
  lines.push(`const _SCRML_TENANT_DECLARED = new Set(${JSON.stringify(declared)});`);
  lines.push(`export const ${TENANT_STARTUP_CHECK_EXPORT} = {`);
  lines.push("  undeclared: () => _scrml_tenant_undeclared_in([");
  for (const h of handles) {
    lines.push(`    { handle: ${h.ident}, driver: ${JSON.stringify(h.driver)}, label: ${JSON.stringify(tenantCheckLabel(h.connection))} },`);
  }
  lines.push("  ], _SCRML_TENANT_DECLARED),");
  lines.push("};");
  return lines;
}
