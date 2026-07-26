/**
 * @module codegen/sql-ident
 * Safe SQL identifier quoting for emitted DDL/queries.
 *
 * Both Postgres and SQLite delimit identifiers with double quotes and escape an
 * embedded `"` by DOUBLING it (`a"b` → `"a""b"`), so one helper serves both
 * drivers. This is the ONLY safe way to interpolate a table/column/constraint
 * name into emitted SQL.
 *
 * WHY THIS IS SECURITY-CRITICAL: a name is not always a trusted `\w+` token.
 * `readActualSchemaPg` / `readActualSchema` read table + column names from the
 * LIVE database (introspection), which an attacker who can influence the schema
 * (a shared cluster, a prior compromise, a hostile migration) controls. A name
 * containing a `"` interpolated naively (`"${name}"`) closes the identifier and
 * lets the remainder execute as injected SQL — and `scrml db-migrate` runs that
 * SQL as the MIGRATOR (the most-privileged principal), so the injection can
 * install a permissive RLS policy (durable tenant-isolation bypass) or, against a
 * superuser migrator, `ALTER ROLE … SUPERUSER` (RCE). Route every identifier
 * interpolation through this helper — never build `"${name}"` by hand.
 */

/**
 * Quote a SQL identifier, escaping any embedded `"` by doubling it. Returns the
 * identifier INCLUDING the surrounding double quotes.
 */
export function quoteIdent(name: string): string {
  return '"' + String(name ?? "").replace(/"/g, '""') + '"';
}
